// LLENADO DE LA APP POR EMPLEADO
//
// ⛔ ACÁ NO SE CALCULA NINGUNA NOTA. El veredicto de cada persona, su motivo y qué exigirle los
//    arma `btg_informe_llenado(p_desde, p_hasta)` en la base. Si la regla se escribiera también
//    acá serían dos listas a mano, y se desincronizan [[norma-dos-listas-a-mano-se-desincronizan]].
//    Esta pieza pide, dibuja e imprime. Nada más.
// ══════════════════════════════════════════════════════════════════════════════════════════════
// ⛔ ESCAPE PROPIO. Antes usaba `relEsc`, que SOLO existe en Betangar (es de la
//    relacion de gastos): copiado tal cual a los clones, la pantalla reventaba
//    al dibujar la primera fila. Este modulo no depende de nada del repo.
function _lleEsc(s){ return String(s==null?'':s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }

var LLE_DATA=null;
var LLE_COL={'A corregir':'bk-err','Observado':'bk-warn','Cumple':'bk-ok','Sin evaluar':''};

// El primer día que el checklist dice QUIÉN lo llenó. Antes guardaba el nombre de una lista fija
// camión→chofer. La base aplica el mismo piso; acá sólo sirve para el botón «Todo lo medible».
// ⛔ NO SE ESCRIBE NINGUNA FECHA DE NINGUNA EMPRESA ACÁ. El día desde el cual el
//    checklist dice QUIÉN lo llenó es distinto en cada base (Betangar 12/09,
//    FLOTILLA 25/07, TONY GAS 20/10, la demo nunca falló), y este módulo es el
//    MISMO en las seis. Antes decía '2026-09-12' —el de Betangar— y las otras
//    cinco arrancaban con una fecha ajena. Lo dice la base: viene en `piso`.
var LLE_PISO=null;
// Un comienzo neutro mientras la base no haya contestado todavía.
function _lleHace(dias){ var d=new Date(); d.setDate(d.getDate()-dias); return d.toISOString().slice(0,10); }

function llenadoRapido(v){
  if(!v)return;
  var hoy=new Date(), f=function(d){ return d.toISOString().slice(0,10); };
  var d,h=f(hoy);
  if(v==='7'||v==='30'){ var x=new Date(hoy); x.setDate(x.getDate()-(Number(v)-1)); d=f(x); }
  else if(v==='mes'){ d=f(new Date(hoy.getFullYear(),hoy.getMonth(),1)); }
  else if(v==='mespas'){
    d=f(new Date(hoy.getFullYear(),hoy.getMonth()-1,1));
    h=f(new Date(hoy.getFullYear(),hoy.getMonth(),0));
  }
  // Si la base todavia no dijo su piso, se pide ANCHO: la funcion recorta sola
  // y avisa, y de su respuesta queda sabido el piso para la proxima vez.
  else if(v==='todo'){ d=LLE_PISO||_lleHace(365); }
  if(d){ sv('lle-des',d); sv('lle-hta',h); renderLlenado(); }
}

async function renderLlenado(){
  var el=g('lle-body'); if(!el)return;
  if(!(DB_READY&&supabase)){ el.innerHTML='<div class="card" style="color:var(--text3)">Conectá la base.</div>'; return; }
  var hoy=new Date().toISOString().slice(0,10);
  if(g('lle-des')&&!gv('lle-des'))sv('lle-des',LLE_PISO||_lleHace(60));
  if(g('lle-hta')&&!gv('lle-hta'))sv('lle-hta',hoy);
  var d=gv('lle-des')||LLE_PISO||_lleHace(60), h=gv('lle-hta')||hoy;
  el.innerHTML='<div style="text-align:center;color:var(--text3);padding:30px">Midiendo el período…</div>';
  var r=await _rpc('btg_informe_llenado',{p_desde:d,p_hasta:h});
  if(r.error){
    LLE_DATA=null;
    // ⛔ «Sin permiso» y «sin datos» NO se dicen igual. La base levanta 42501 a propósito
    //    para que esto se pueda distinguir; si acá se mostrara una tabla vacía, el jefe
    //    concluiría que nadie llenó nunca.
    var sinPermiso=(r.error.code==='42501'||/permiso/i.test(r.error.message||''));
    el.innerHTML='<div class="card" style="color:var(--'+(sinPermiso?'text2':'red')+')">'+
      (sinPermiso
        ? '<b>Este informe no está disponible para tu usuario.</b><br><span style="font-size:12px;color:var(--text3)">Lo ven dirección, RRHH y auditoría. No es que no haya registros: es que tu rol no los puede ver.</span>'
        : 'No se pudo armar el informe: '+_lleEsc(r.error.message||r.error))+'</div>';
    return;
  }
  var D=Array.isArray(r.data)?r.data[0]:r.data;
  // Con QUÉ fechas se armó, para que imprimir no mezcle cabecera de un período con números de otro.
  if(D){ D._d=d; D._h=h; }
  // La base dice cual es SU piso: queda sabido para «Todo lo medible».
  if(D && D.piso) LLE_PISO=String(D.piso).slice(0,10);
  LLE_DATA=D;
  el.innerHTML=_lleHtml(D,false);
}

function _llePct(n){ return (Math.round(Number(n||0)*1000)/10).toLocaleString('es-VE')+'%'; }
function _lleNum(n){ return Number(n||0).toLocaleString('es-VE'); }

// Las áreas, en el orden en que se recorren en una reunión: primero los que
// manejan, después la cuadrilla, después quien controla, al final la oficina.
// ⛔ SE AGRUPA POR LA FUNCIÓN QUE CALCULA LA BASE (`fn`), NO POR EL TEXTO DEL
//    CARGO. Esto decía `cargos:['Chofer']`, `['Ayudante']`, `['Mecanico',
//    'Supervisor']` — los cargos de Betangar. En TONY GAS, donde el cargo es
//    «Conductor Auto Tanque» o «Ayudante de Baranda», NINGUNO calzaba y las 65
//    personas caían enteras en «Oficina y dirección»: los veredictos salían
//    bien y el informe igual era ilegible. Es el mismo error que ya se había
//    sacado del SQL, sobreviviendo en la capa que dibuja.
//    [[norma-replicar-a-los-clones-es-medir-no-copiar]]
var LLE_AREAS=[
  {id:'conduce',   t:'Choferes',
   mide:'De los días que registró, cuántos cerró con salida y llegada; y cuántos días fichó sin dejar checklist.'},
  {id:'cuadrilla', t:'Ayudantes',
   mide:'Constancia del fichaje de asistencia con foto, sobre los días que la flota operó estando ya en la empresa.'},
  {id:'vigila',    t:'Vigilancia',
   mide:'Días con registros de portería. El fichaje se mira aparte: la portería ya prueba que estuvo.'},
  {id:'taller',    t:'Taller',
   mide:'Firmas en el checklist del chofer y cierre de las fallas que él reporta.'},
  {id:'supervisa', t:'Supervisión y jefaturas',
   mide:'Firmas en el checklist del chofer y cierre de las fallas que él reporta.'},
  {id:'oficina',   t:'Oficina y dirección',
   mide:'Días con actividad propia en la aplicación dentro del período.'},
  {id:'sincargo',  t:'Sin cargo en la ficha',
   mide:'No se les puede exigir nada todavía: hasta que la ficha diga el cargo, no entran en ninguna medición.'}
];
// `fn` viene de la base; si faltara, la persona va al grupo de «sin cargo» y se
// ve, en vez de disolverse en oficina.
function _lleArea(fn){
  for(var i=0;i<LLE_AREAS.length;i++){ if(LLE_AREAS[i].id===fn) return LLE_AREAS[i]; }
  return LLE_AREAS[LLE_AREAS.length-1];
}
var LLE_ORDEN={'A corregir':0,'Observado':1,'Cumple':2,'Sin evaluar':3};

function _lleBadge(v, imp){
  if(imp){
    var c=v==='A corregir'?'bk-err':v==='Observado'?'bk-warn':v==='Cumple'?'bk-ok':'';
    return c?('<span class="'+c+'">'+_lleEsc(v)+'</span>'):('<span style="color:#6b7280">'+_lleEsc(v)+'</span>');
  }
  var col=v==='A corregir'?'var(--red)':v==='Observado'?'#d97706':v==='Cumple'?'var(--green)':'var(--text3)';
  return '<b style="color:'+col+'">'+_lleEsc(v)+'</b>';
}

// Una fila de persona con las columnas que su área hace falta mirar.
function _lleFilaArea(p, area, imp){
  var c='<td>'+_lleEsc(p.nombre)+'</td><td style="color:'+(imp?'#555':'var(--text3)')+'">'+_lleEsc(p.cargo)+'</td>';
  if(area.id==='conduce'){
    c+='<td style="color:'+(imp?'#555':'var(--text3)')+'">'+_lleEsc(p.unidad)+'</td>'+
      '<td class="mono">'+_lleNum(p.dias_exigibles)+'</td>'+
      '<td class="mono">'+_lleNum(p.dias_registro)+'</td>'+
      '<td class="mono">'+_lleNum(p.dias_cerrados)+'</td>'+
      '<td class="mono'+(Number(p.dias_sin_cerrar)>2?' rv':'')+'">'+_lleNum(p.dias_sin_cerrar)+'</td>'+
      '<td class="mono">'+_llePct(p.cierre)+'</td>'+
      '<td class="mono'+(Number(p.ficho_sin_checklist)>2?' rv':'')+'">'+_lleNum(p.ficho_sin_checklist)+'</td>'+
      '<td class="mono">'+_lleNum(p.dias_con_obs)+'</td>'+
      '<td class="mono">'+_lleNum(p.viajes)+'</td><td class="mono">'+_lleNum(p.surtidas)+'</td>';
  } else if(area.id==='vigila'){
    c+='<td class="mono">'+_lleNum(p.dias_exigibles)+'</td>'+
      '<td class="mono">'+_lleNum(p.dias_porteria)+'</td>'+
      '<td class="mono">'+_lleNum(p.porteria_registros)+'</td>'+
      '<td class="mono">'+_lleNum(p.dias_ficho)+'</td>';
  } else if(area.id==='oficina'||area.id==='taller'||area.id==='supervisa'){
    c+='<td class="mono">'+_lleNum(p.dias_exigibles)+'</td>'+
      '<td class="mono">'+_lleNum(p.dias_ficho)+'</td>'+
      '<td class="mono">'+_lleNum(p.dias_oficina)+'</td>'+
      '<td class="mono">'+_lleNum(p.acciones_oficina)+'</td>';
  } else {
    c+='<td class="mono">'+_lleNum(p.dias_exigibles)+'</td>'+
      '<td class="mono">'+_lleNum(p.dias_ficho)+'</td>'+
      '<td class="mono">'+_llePct(p.tasa_fichaje)+'</td>';
  }
  return '<tr>'+c+'<td>'+_lleBadge(p.veredicto,imp)+'</td>'+
    '<td style="font-size:11px">'+_lleEsc(p.motivo)+'</td></tr>';
}
function _lleCabArea(area){
  var c='<th>Persona</th><th>Cargo</th>';
  if(area.id==='conduce')c+='<th>Unidad</th><th>Exig.</th><th>Registró</th><th>Cerrados</th><th>Sin cerrar</th><th>% cierre</th><th>Fichó sin llenar</th><th>Reportó</th><th>Viajes</th><th>Surtidas</th>';
  else if(area.id==='vigila')c+='<th>Exig.</th><th>Días portería</th><th>Registros</th><th>Fichó</th>';
  else if(area.id==='oficina'||area.id==='taller'||area.id==='supervisa')c+='<th>Exig.</th><th>Fichó</th><th>Días en app</th><th>Acciones</th>';
  else c+='<th>Exig.</th><th>Fichó</th><th>%</th>';
  return '<tr>'+c+'<th>Veredicto</th><th>Motivo</th></tr>';
}

// ── LA PANTALLA ──────────────────────────────────────────────────────────────
function _lleHtml(D, imp){
  if(!D) return '<div class="card" style="color:var(--text3)">Sin datos.</div>';
  if(D.vacio) return '<div class="card" style="color:var(--text2)">'+_lleEsc(D.aviso||'No hay días medibles en ese período.')+'</div>';
  if(imp) return _llePapel(D);
  var R=D.resumen||{}, P=D.personas||[], F=D.fallas||[], M=D.modulos||[];
  var aviso=D.aviso?('<div class="card" style="border-left:3px solid #d97706;color:var(--text2);font-size:12px;margin-bottom:10px">⚠️ '+_lleEsc(D.aviso)+'</div>'):'';

  var titular='<div class="card" style="margin-bottom:10px;font-size:13px;line-height:1.55">'+
    'De <b>'+_lleNum(R.empleados)+'</b> empleados activos, <b>'+_lleNum(R.corregir)+'</b> hay que corregir y <b>'+
    _lleNum(R.observado)+'</b> están observados. Los choferes cerraron <b>'+_lleNum(R.cierre_pct)+'%</b> de los días que trabajaron'+
    (F.length?(', y <b>'+_lleNum(F.length)+'</b> reportes que ellos escribieron seguían sin cerrar al '+formatFecha(D.hasta)+'.'):'.')+
    ((Number(R.firmas_mecanico)===0&&Number(R.firmas_supervisor)===0)
      ? ' <b>Nadie firmó el checklist después del chofer</b> en todo el período.' : '')+
    '</div>';

  var tiles='<div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:12px">'+
    _lleTile('Cumple',R.cumple,'var(--green)')+_lleTile('Observado',R.observado,'#d97706')+
    _lleTile('A corregir',R.corregir,'var(--red)')+_lleTile('Sin evaluar',R.sin_evaluar,'var(--text3)')+
    _lleTile('Días que operó',R.dias_opero,'var(--text1)')+_lleTile('Checklists',R.checklists,'var(--text1)')+
    '</div>';

  // 1. Lo que hay que atender: la lista con la que se entra a la reunión.
  var corregir=P.filter(function(p){return p.veredicto==='A corregir';});
  var accion=!corregir.length
    ? '<div class="card" style="color:var(--green)">Nadie quedó en «A corregir» en este período.</div>'
    : '<div class="card" style="padding:0;overflow:hidden"><table style="margin:0"><thead><tr>'+
      '<th style="width:28px">#</th><th>Persona</th><th>Cargo</th><th>Qué le pide la app</th><th>Motivo</th><th>Qué se le exige</th>'+
      '</tr></thead><tbody>'+corregir.map(function(p,i){
        return '<tr><td class="mono" style="color:var(--text3)">'+(i+1)+'</td>'+
          '<td><b>'+_lleEsc(p.nombre)+'</b></td><td style="color:var(--text3)">'+_lleEsc(p.cargo)+'</td>'+
          '<td style="font-size:11px;color:var(--text3)">'+_lleEsc(p.que_le_toca)+'</td>'+
          '<td style="font-size:11px;color:var(--red)">'+_lleEsc(p.motivo)+'</td>'+
          '<td style="font-size:11px">'+_lleEsc(p.se_le_exige)+'</td></tr>';
      }).join('')+'</tbody></table></div>';

  // 2. El detalle, área por área.
  var areas=LLE_AREAS.map(function(a){
    var lista=P.filter(function(p){return _lleArea(p.fn).id===a.id;})
      .sort(function(x,y){ return (LLE_ORDEN[x.veredicto]-LLE_ORDEN[y.veredicto])||String(x.nombre).localeCompare(String(y.nombre),'es'); });
    if(!lista.length)return '';
    return '<h3 style="margin-top:18px">'+a.t+' <span style="font-weight:400;color:var(--text3)">('+lista.length+')</span></h3>'+
      '<div style="font-size:11px;color:var(--text3);margin-bottom:6px">'+a.mide+'</div>'+
      '<table><thead>'+_lleCabArea(a)+'</thead><tbody>'+
      lista.map(function(p){return _lleFilaArea(p,a,false);}).join('')+'</tbody></table>';
  }).join('');

  var fallas=!F.length?'':('<h3 style="margin-top:18px">Reportes del chofer sin cerrar <span style="font-weight:400;color:var(--text3)">('+F.length+')</span></h3>'+
    '<div style="font-size:11px;color:var(--text3);margin-bottom:6px">Seguían abiertos al '+formatFecha(D.hasta)+'. «Días reportando» son los días en que el chofer de esa unidad escribió algo.</div>'+
    '<table><thead><tr><th>Unidad</th><th>Tipo</th><th>Último texto del chofer</th><th>Quién lo reportó</th><th>Días abierta</th><th>Días reportando</th></tr></thead><tbody>'+
    F.map(function(f){
      return '<tr><td>'+_lleEsc(f.unidad)+'</td><td style="color:var(--text3);font-size:11px">'+_lleEsc(f.tipo)+'</td>'+
        '<td style="font-size:11px">'+_lleEsc(f.ultimo_reporte)+'</td><td style="color:var(--text3);font-size:11px">'+_lleEsc(f.quien_reporto)+'</td>'+
        '<td class="mono'+(Number(f.dias_abierta)>30?' rv':'')+'">'+_lleNum(f.dias_abierta)+'</td><td class="mono">'+_lleNum(f.dias_reportando)+'</td></tr>';
    }).join('')+'</tbody></table>');

  var mods=!M.length?'':('<h3 style="margin-top:18px">Qué módulo se usa y quién lo llena</h3><table><thead><tr><th>Módulo</th><th>A quién le toca</th><th>Registros</th></tr></thead><tbody>'+
    M.map(function(m){
      var cero=Number(m.registros)===0;
      return '<tr><td'+(cero?' style="color:var(--red)"':'')+'>'+_lleEsc(m.modulo)+'</td>'+
        '<td style="color:var(--text3)">'+_lleEsc(m.a_quien_toca)+'</td>'+
        '<td class="mono'+(cero?' rv':'')+'">'+_lleNum(m.registros)+'</td></tr>';
    }).join('')+'</tbody></table>');

  var adv=(D.advertencias||[]).map(function(a){return '<li style="margin-bottom:3px">'+_lleEsc(a)+'</li>';}).join('');
  var notas=!adv?'':('<h3 style="margin-top:18px">Lo que esta medición no puede decir</h3><ul style="font-size:11px;color:var(--text3);padding-left:16px;line-height:1.5">'+adv+'</ul>');

  // ⛔ LOS CARGOS QUE EL PATRÓN NO RECONOCIÓ SE MUESTRAN. La base los devuelve
  //    justamente para que no caigan callados en «oficina»; si la pantalla no
  //    los dibujara, el dato existiría y nadie lo vería nunca.
  var revisar=_lleRevisar(D,false);

  return aviso+titular+tiles+
    '<h3>Lo que hay que atender</h3>'+
    '<div style="font-size:11px;color:var(--text3);margin-bottom:6px">Con esta lista se entra a la reunión. El resto del informe la respalda.</div>'+
    accion+areas+fallas+mods+revisar+notas;
}

// ── EL PAPEL ─────────────────────────────────────────────────────────────────
// Secciones numeradas, cada una diciendo qué mide, y el detalle agrupado POR
// ÁREA: a un chofer no se le miden las mismas cosas que a un ayudante, y una
// sola tabla de 66 filas mezcladas no se puede leer en una reunión.
function _llePapel(D){
  var R=D.resumen||{}, P=D.personas||[], F=D.fallas||[], M=D.modulos||[];
  var n=0;
  var sec=function(t,sub){ n++; return '<h3 style="page-break-after:avoid">'+n+'. '+t+'</h3>'+
    (sub?'<div style="font-size:10px;color:#555;margin:-6px 0 8px">'+sub+'</div>':''); };
  var salto='<div style="page-break-before:always"></div>';
  var out='';

  if(D.aviso){
    out+='<div style="border-left:3px solid #d97706;background:#fffbeb;padding:8px 12px;margin-bottom:14px;font-size:10px;color:#92400e">'+
      '<b>Atención.</b> '+_lleEsc(D.aviso)+'</div>';
  }

  // Resumen en una frase, que es lo que se lee primero y a veces lo único.
  out+='<div style="background:#f8fafc;border-left:4px solid #0f2544;padding:11px 14px;margin-bottom:16px;font-size:11.5px;line-height:1.6">'+
    'De <b>'+_lleNum(R.empleados)+'</b> empleados activos, <b>'+_lleNum(R.corregir)+'</b> hay que corregir y <b>'+
    _lleNum(R.observado)+'</b> están observados. Los choferes cerraron <b>'+_lleNum(R.cierre_pct)+'%</b> de los días que trabajaron'+
    (F.length?(', y <b>'+_lleNum(F.length)+'</b> reportes que ellos escribieron seguían sin cerrar al '+formatFecha(D.hasta)+'.'):'.')+
    ((Number(R.firmas_mecanico)===0&&Number(R.firmas_supervisor)===0)
      ? ' <b>Nadie firmó el checklist después del chofer</b> en todo el período.':'')+
    '</div>';

  // 1 — la lista de acción
  var corregir=P.filter(function(p){return p.veredicto==='A corregir';});
  out+=sec('Lo que hay que atender','Con esta lista se entra a la reunión. Las secciones siguientes la respaldan.');
  out+=!corregir.length
    ? '<div style="font-size:11px;color:#15803d">Nadie quedó en «A corregir» en este período.</div>'
    : '<table><thead><tr><th style="width:26px">#</th><th>Persona</th><th>Cargo</th><th>Qué le pide la app</th><th>Motivo</th><th>Qué se le exige</th></tr></thead><tbody>'+
      corregir.map(function(p,i){
        return '<tr><td class="mono">'+(i+1)+'</td><td><b>'+_lleEsc(p.nombre)+'</b></td>'+
          '<td>'+_lleEsc(p.cargo)+'</td><td style="font-size:10px">'+_lleEsc(p.que_le_toca)+'</td>'+
          '<td style="font-size:10px;color:#b91c1c">'+_lleEsc(p.motivo)+'</td>'+
          '<td style="font-size:10px">'+_lleEsc(p.se_le_exige)+'</td></tr>';
      }).join('')+'</tbody></table>';

  // 2 — observados
  var obs=P.filter(function(p){return p.veredicto==='Observado';});
  if(obs.length){
    out+=sec('Observados','Lo hacen, pero dejan días sueltos. No es falta grave; es el aviso antes de que lo sea.');
    out+='<table><thead><tr><th>Persona</th><th>Cargo</th><th>Motivo</th><th>Qué se le exige</th></tr></thead><tbody>'+
      obs.map(function(p){
        return '<tr><td>'+_lleEsc(p.nombre)+'</td><td>'+_lleEsc(p.cargo)+'</td>'+
          '<td style="font-size:10px">'+_lleEsc(p.motivo)+'</td>'+
          '<td style="font-size:10px">'+_lleEsc(p.se_le_exige)+'</td></tr>';
      }).join('')+'</tbody></table>';
  }

  // 3 — cumplen (compacto: el reconocimiento también es parte de la reunión)
  var cumple=P.filter(function(p){return p.veredicto==='Cumple';});
  if(cumple.length){
    out+=sec('Cumplen ('+cumple.length+')','Hacen lo que su cargo les pide, sin huecos. Conviene nombrarlos.');
    out+='<table><thead><tr><th>Persona</th><th>Cargo</th><th>Motivo</th><th>Persona</th><th>Cargo</th><th>Motivo</th></tr></thead><tbody>';
    for(var i=0;i<cumple.length;i+=2){
      var a=cumple[i], b=cumple[i+1];
      out+='<tr><td>'+_lleEsc(a.nombre)+'</td><td style="font-size:10px">'+_lleEsc(a.cargo)+'</td>'+
        '<td style="font-size:10px">'+_lleEsc(a.motivo)+'</td>'+
        (b?('<td>'+_lleEsc(b.nombre)+'</td><td style="font-size:10px">'+_lleEsc(b.cargo)+'</td><td style="font-size:10px">'+_lleEsc(b.motivo)+'</td>')
           :'<td></td><td></td><td></td>')+'</tr>';
    }
    out+='</tbody></table>';
  }

  // 4 — sin evaluar (se dice POR QUÉ, para que nadie crea que se los saltó)
  var sinev=P.filter(function(p){return p.veredicto==='Sin evaluar';});
  if(sinev.length){
    out+=sec('Sin evaluar ('+sinev.length+')','No se les pone nota, y acá está la razón de cada uno. Que no tengan nota NO es que estén mal.');
    out+='<table><thead><tr><th>Persona</th><th>Cargo</th><th>Por qué no se evalúa</th></tr></thead><tbody>'+
      sinev.map(function(p){
        return '<tr><td>'+_lleEsc(p.nombre)+'</td><td>'+_lleEsc(p.cargo)+'</td>'+
          '<td style="font-size:10px">'+_lleEsc(p.motivo)+'</td></tr>';
      }).join('')+'</tbody></table>';
  }

  // 5 — el detalle, área por área
  out+=salto+sec('El detalle, área por área','A cada cargo se lo mide contra lo que la aplicación le pide a él, y sólo sobre los días en que ya estaba trabajando. «Exig.» son esos días. Un día libre no cuenta como falta.');
  out+=LLE_AREAS.map(function(a){
    var lista=P.filter(function(p){return _lleArea(p.fn).id===a.id;})
      .sort(function(x,y){ return (LLE_ORDEN[x.veredicto]-LLE_ORDEN[y.veredicto])||String(x.nombre).localeCompare(String(y.nombre),'es'); });
    if(!lista.length)return '';
    return '<h3 style="font-size:10px;color:#0f2544;margin-top:14px;page-break-after:avoid">'+a.t+' ('+lista.length+')</h3>'+
      '<div style="font-size:9.5px;color:#666;margin:-6px 0 6px">'+a.mide+'</div>'+
      '<table><thead>'+_lleCabArea(a)+'</thead><tbody>'+
      lista.map(function(p){return _lleFilaArea(p,a,true);}).join('')+'</tbody></table>';
  }).join('');

  // 6 — fallas
  if(F.length){
    out+=salto+sec('Reportes del chofer sin cerrar ('+F.length+')',
      'Seguían abiertos al '+formatFecha(D.hasta)+'. «Días reportando» son los días en que el chofer de esa unidad escribió algo en el checklist.');
    out+='<table><thead><tr><th>Unidad</th><th>Tipo</th><th>Último texto del chofer</th><th>Quién lo reportó</th><th>Días abierta</th><th>Días rep.</th></tr></thead><tbody>'+
      F.map(function(f){
        return '<tr><td>'+_lleEsc(f.unidad)+'</td><td style="font-size:10px">'+_lleEsc(f.tipo)+'</td>'+
          '<td style="font-size:10px">'+_lleEsc(f.ultimo_reporte)+'</td>'+
          '<td style="font-size:10px">'+_lleEsc(f.quien_reporto)+'</td>'+
          '<td class="mono'+(Number(f.dias_abierta)>30?' rv':'')+'">'+_lleNum(f.dias_abierta)+'</td>'+
          '<td class="mono">'+_lleNum(f.dias_reportando)+'</td></tr>';
      }).join('')+'</tbody></table>';
  }

  // 7 — módulos
  if(M.length){
    out+=sec('Qué módulo se usa y quién lo llena','Las filas en rojo son trabajo que la aplicación pide y nadie hace. Eso no es de una persona: es del proceso.');
    out+='<table><thead><tr><th>Módulo</th><th>A quién le toca</th><th>Registros</th></tr></thead><tbody>'+
      M.map(function(m){
        var cero=Number(m.registros)===0;
        return '<tr><td'+(cero?' style="color:#b91c1c;font-weight:700"':'')+'>'+_lleEsc(m.modulo)+'</td>'+
          '<td>'+_lleEsc(m.a_quien_toca)+'</td>'+
          '<td class="mono'+(cero?' rv':'')+'">'+_lleNum(m.registros)+'</td></tr>';
      }).join('')+'</tbody></table>';
  }

  // 8 — cómo se midió
  // Antes de la metodología: lo que la empresa tiene que confirmar.
  var rev=_lleRevisar(D,true);
  if(rev){
    out+=sec('Para confirmar con la empresa',
      'No son errores: son cargos que el informe no supo clasificar solo y midió como oficina. Confirmarlos una vez deja el informe fino de ahí en adelante.');
    out+=rev.replace(/^<h3[^>]*>[\s\S]*?<\/h3>/, '');
  }

  out+=sec('Cómo se midió, y qué no puede decir esta medición',
    'Período del '+formatFecha(D.desde)+' al '+formatFecha(D.hasta)+'. Los números salen de los registros de la propia aplicación.');
  var adv=(D.advertencias||[]).map(function(a){return '<li style="margin-bottom:4px">'+_lleEsc(a)+'</li>';}).join('');
  out+='<ul style="font-size:10px;color:#444;padding-left:16px;line-height:1.55;margin-top:4px">'+adv+
    '<li style="margin-bottom:4px">Con menos de 10 días exigibles no se pone nota: la muestra es demasiado chica para sostener una exigencia.</li>'+
    '</ul>';
  return out;
}

// ── LOS CARGOS A CONFIRMAR, y los checklists que no se le contaron a nadie ──
// ⛔ Esto NO es una lista de errores: es una lista de CONFIRMAR. El patrón
//    manda a «oficina» todo lo que no reconoce, y a veces acierta (un Contador
//    es oficina) y a veces no (un «Operador de Llenado de GLP» no lo es). Si no
//    se mostrara, media plantilla quedaría medida por lo que no hace y el
//    informe se vería impecable. [[norma-falta-de-dato-no-es-un-dato]]
function _lleRevisar(D, imp){
  var C=D.cargos_sin_clasificar||[], sinAtrib=Number(D.checklists_sin_atribuir||0);
  if(!C.length && !sinAtrib) return '';
  var dim=imp?'#555':'var(--text3)';
  var out='<h3 style="margin-top:18px">Para confirmar con la empresa</h3>';
  if(C.length){
    var total=C.reduce(function(a,c){return a+Number(c.personas||0);},0);
    out+='<div style="font-size:11px;color:'+dim+';margin-bottom:6px">'+
      'A estos <b>'+_lleNum(total)+'</b> empleados se los midió como <b>oficina</b> porque su cargo no se reconoció solo. '+
      'Si alguno conduce, va en cuadrilla, vigila o es del taller, hay que decirlo una vez y el informe lo toma de ahí en adelante.</div>'+
      '<table><thead><tr><th>Cargo</th><th>Personas</th><th>Se lo está midiendo como</th></tr></thead><tbody>'+
      C.map(function(c){
        var sin=/sin cargo/i.test(c.cargo||'');
        return '<tr><td'+(sin?' style="color:'+(imp?'#b91c1c':'var(--red)')+'"':'')+'>'+_lleEsc(c.cargo)+'</td>'+
          '<td class="mono">'+_lleNum(c.personas)+'</td>'+
          '<td style="color:'+dim+';font-size:11px">'+(sin
            ? 'nada: sin cargo en la ficha no entra en ninguna medición'
            : 'oficina (días con actividad en la aplicación)')+'</td></tr>';
      }).join('')+'</tbody></table>';
  }
  if(sinAtrib){
    out+='<div style="font-size:11px;color:'+(imp?'#b91c1c':'var(--red)')+';margin-top:8px">'+
      '⛔ <b>'+_lleNum(sinAtrib)+'</b> checklists del período llevan un nombre que no está en el roster: '+
      'esos días <b>no se le cuentan a nadie</b>. O falta esa gente en Personal, o el checklist guardó un nombre viejo.</div>';
  }
  return out;
}

function _lleTile(lbl,val,col){
  return '<div class="card" style="flex:1;min-width:110px;padding:10px 12px;margin:0">'+
    '<div style="font-size:10px;text-transform:uppercase;letter-spacing:.6px;color:var(--text3)">'+lbl+'</div>'+
    '<div style="font-size:22px;font-weight:900;color:'+col+';font-family:var(--m)">'+_lleNum(val)+'</div></div>';
}

async function imprimirLlenado(){
  var hoy=new Date().toISOString().slice(0,10);
  var d=gv('lle-des')||LLE_PISO||_lleHace(60), h=gv('lle-hta')||hoy;
  // ⛔ LA CABECERA Y LOS NÚMEROS TIENEN QUE SER DEL MISMO PERÍODO. Los `input[type=date]` disparan
  //    `change` al PERDER EL FOCO: si alguien escribe una fecha y hace clic directo en «Imprimir»,
  //    el clic dispara el change (que arranca renderLlenado, asíncrono) y acto seguido esta
  //    función, que leería las fechas NUEVAS y los números VIEJOS. Mismo bug que tuvo
  //    `imprimirInforme()`: sale un PDF que dice un período y muestra otro, y no hay forma de
  //    notarlo mirándolo.
  if(!LLE_DATA||LLE_DATA._d!==d||LLE_DATA._h!==h) await renderLlenado();
  if(!LLE_DATA||LLE_DATA._d!==d||LLE_DATA._h!==h){ alert('No se pudo armar el informe para ese período.'); return; }
  var R=LLE_DATA.resumen||{};
  var stats=
    mkStat('Cumple',_lleNum(R.cumple),'hace lo que le toca','verde')+
    mkStat('Observado',_lleNum(R.observado),'deja días sueltos','amari')+
    mkStat('A corregir',_lleNum(R.corregir),'exigirle en la reunión','rojo')+
    mkStat('Sin evaluar',_lleNum(R.sin_evaluar),'entró hace poco o no le toca','azul')+
    mkStat('Cierre del checklist',_lleNum(R.cierre_pct)+'%','de los días trabajados','azul')+
    mkStat('Días que operó',_lleNum(R.dias_opero),_lleNum(R.checklists)+' checklists','azul');
  abrirImpresionPremium('Llenado de la app por empleado',
    'Del '+formatFecha(LLE_DATA.desde)+' al '+formatFecha(LLE_DATA.hasta),
    stats, _lleHtml(LLE_DATA,true), {lbl:'Informe'});
}

