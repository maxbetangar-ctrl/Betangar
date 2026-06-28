// ════════════════════════════════════════════════════════════════════════════
// MONEY.JS — Matemática de DINERO, pura y testeable (ISO 25010 fiabilidad/madurez).
// Se carga ANTES de app.js (script en app.html) → expone funciones globales que usa la app.
// Y se exporta para Node (tests/money.test.js) → las pruebas corren la MISMA fórmula que producción.
// REGLA: estas funciones son PURAS (no tocan DOM ni red). Si necesitas el DOM, queda en app.js.
// ════════════════════════════════════════════════════════════════════════════

// Perfil de retenciones por defecto = contrato Alcaldía (IMAU Maracaibo). Cada contrato puede traer
// el suyo (columna contratos.retenciones JSON); perfilRetencion() hace merge sobre este default.
var RET_DEFAULT={iva:0.16, retIVA:0.75, retISLR:0.02, retMun:0.01, timbre:0.001, fiel:0.10, laboral:0, respSocial:0.03, fielDevuelve:true};

// Devuelve el perfil de retenciones de un contrato (merge sobre el default). Acepta el objeto
// contrato o su id (string). null/sin perfil → perfil Alcaldía (comportamiento histórico).
function perfilRetencion(contrato){
  var c=contrato;
  if(typeof contrato==='string'&&contrato){ c=(typeof CONTRATOS!=='undefined'?CONTRATOS:[]).find(function(x){return String(x.id)===String(contrato);}); }
  var p={}; for(var k in RET_DEFAULT)p[k]=RET_DEFAULT[k];
  if(c&&c.retenciones&&typeof c.retenciones==='object'){ for(var k2 in c.retenciones){ var v=c.retenciones[k2]; if(v!==''&&v!=null&&!(typeof v==='number'&&isNaN(v)))p[k2]=v; } }
  return p;
}

// Calcula el desglose de retenciones de UNA factura. base USD; perfil de perfilRetencion();
// laboralUsd = monto MANUAL de retención laboral (override). Si no se pasa, usa perfil.laboral×base.
// Fuente ÚNICA de la fórmula: la usan el preview (calcPagoAlc), el guardado y la conciliación.
function calcRetenciones(base, perfil, laboralUsd){
  var p=perfil||RET_DEFAULT; base=Number(base)||0;
  var iva=base*p.iva, total=base+iva;
  var retIVA=iva*p.retIVA, retISLR=base*p.retISLR, retMun=base*p.retMun, timbre=base*p.timbre, fiel=base*p.fiel;
  var laboral=(laboralUsd!=null&&laboralUsd!==''&&!isNaN(parseFloat(laboralUsd)))?parseFloat(laboralUsd):base*(p.laboral||0);
  var neto=total-retIVA-retISLR-retMun-timbre-fiel-laboral;
  return {base:base,iva:iva,total:total,retIVA:retIVA,retISLR:retISLR,retMun:retMun,timbre:timbre,fiel:fiel,laboral:laboral,neto:neto,respSocial:base*(p.respSocial||0)};
}

// Export para Node (tests). En el navegador este bloque se ignora (no hay module).
if(typeof module!=='undefined'&&module.exports){ module.exports={RET_DEFAULT:RET_DEFAULT, perfilRetencion:perfilRetencion, calcRetenciones:calcRetenciones}; }
