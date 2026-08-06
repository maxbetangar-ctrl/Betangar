/* ==========================================================================
   MaxRecuerda — la pantalla
   ==========================================================================

   Una sola pieza, sin build y sin framework, que se monta igual en:
     · JS puro (Betangar, Flotilla, VIDECA, FlotaMax)
           MaxRecuerda.montar(document.getElementById('p-recordatorios'), {supabase});
     · React / Next.js (MaxPersonal, Geppetto, Ranita, MaxStock, MaxSalón)
           useEffect(() => MaxRecuerda.montar(ref.current, {supabase}), []);
           // devuelve una función de desmontaje: se le pasa tal cual al return

   ⛔ Lo que hace bien esta pantalla, y por qué está aquí:
      · el RESUMEN EN PALABRAS que se reescribe mientras se elige la
        repetición. Es lo que evita el error caro — «creí que era el primero de
        cada mes y lo puse todos los lunes» — porque lo dice en cristiano ANTES
        de guardar;
      · la persona se ELIGE de la lista del software, no se escribe de memoria;
      · la importancia se ve, no se lee;
      · y si el módulo no puede trabajar, LO GRITA arriba, en rojo.
   ========================================================================== */
(function (raiz) {
  'use strict';

  // ── Cosas de siempre ─────────────────────────────────────────────────────
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  var MESES = ['ENE','FEB','MAR','ABR','MAY','JUN','JUL','AGO','SEP','OCT','NOV','DIC'];
  var MESES_L = ['enero','febrero','marzo','abril','mayo','junio','julio','agosto',
                 'septiembre','octubre','noviembre','diciembre'];
  var DIAS_L = ['lunes','martes','miércoles','jueves','viernes','sábado','domingo'];
  var DIAS_C = ['L','M','X','J','V','S','D'];

  // ⚠️ dd/mm/yyyy SIEMPRE. Aquí un 03/08 nunca es el 8 de marzo.
  function fechaVE(iso) {
    if (!iso) return '';
    var p = String(iso).slice(0, 10).split('-');
    return p.length === 3 ? p[2] + '/' + p[1] + '/' + p[0] : '';
  }
  function hoyISO() {
    var d = new Date();
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' +
           String(d.getDate()).padStart(2, '0');
  }
  // "2026-08-10 15:00" → partes para la tarjeta de fecha
  function partes(local) {
    var f = String(local || '').slice(0, 10).split('-');
    var h = String(local || '').slice(11, 16);
    if (f.length !== 3) return { dia: '—', mes: '', hora: '' };
    return { dia: f[2], mes: MESES[parseInt(f[1], 10) - 1] || '', hora: h,
             iso: f.join('-'),
             diaSem: DIAS_L[(new Date(+f[0], +f[1] - 1, +f[2]).getDay() + 6) % 7] };
  }
  function enBreve(local) {
    // «hoy», «mañana», «en 3 días» — un dato relativo se entiende sin restar.
    var f = String(local || '').slice(0, 10);
    if (!f) return '';
    var a = new Date(hoyISO() + 'T00:00:00'), b = new Date(f + 'T00:00:00');
    var d = Math.round((b - a) / 86400000);
    if (d === 0) return 'hoy';
    if (d === 1) return 'mañana';
    if (d === -1) return 'ayer';
    if (d > 1 && d < 8) return 'en ' + d + ' días';
    if (d < 0) return 'hace ' + Math.abs(d) + ' días';
    return '';
  }

  function toast(txt, clase) {
    var t = document.createElement('div');
    t.className = 'mrq-toast ' + (clase || '');
    t.textContent = txt;
    document.body.appendChild(t);
    setTimeout(function () { t.style.opacity = '0'; t.style.transition = 'opacity .3s'; }, 2600);
    setTimeout(function () { if (t.parentNode) t.parentNode.removeChild(t); }, 3000);
  }

  var IMPORTANCIAS = [
    { v: 'normal',     t: 'Normal',     d: 'Rutina del día',        ic: '🔵' },
    { v: 'importante', t: 'Importante', d: 'No se puede olvidar',   ic: '🟠' },
    { v: 'urgente',    t: 'Urgente',    d: 'Si falla, cuesta plata', ic: '🔴' }
  ];
  function impIc(v) {
    var x = IMPORTANCIAS.filter(function (i) { return i.v === v; })[0];
    return x ? x.ic : '🔵';
  }
  function impNom(v) {
    var x = IMPORTANCIAS.filter(function (i) { return i.v === v; })[0];
    return x ? x.t : 'Normal';
  }

  // «lunes y jueves», no «lunes, jueves». Espejo de lo que hace la base.
  function listar(a) {
    if (a.length <= 1) return a.join('');
    return a.slice(0, -1).join(', ') + ' y ' + a[a.length - 1];
  }

  // ── EL RESUMEN EN PALABRAS ───────────────────────────────────────────────
  // Espejo exacto de `rec_en_palabras()` en la base. Se calcula aquí también
  // para que se reescriba mientras la persona elige, sin ir al servidor.
  // ⚠️ Si un día cambia la regla de recurrencia, cambia en LOS DOS SITIOS o la
  // pantalla promete una cosa y el motor hace otra.
  function enPalabras(f) {
    var s = '';
    if (f.patron === 'unica') {
      s = 'Una sola vez el ' + fechaVE(f.desde);
    } else if (f.patron === 'diaria') {
      s = f.cada === 1 ? 'Todos los días' : 'Cada ' + f.cada + ' días';
    } else if (f.patron === 'semanal') {
      var ds = (f.dias_semana || []).slice().sort(function (a, b) { return a - b; })
                .map(function (x) { return DIAS_L[x - 1]; });
      s = (f.cada === 1 ? 'Todas las semanas' : 'Cada ' + f.cada + ' semanas') +
          (ds.length ? ' los ' + listar(ds) : ' (falta elegir los días)');
    } else if (f.patron === 'mensual') {
      s = (f.cada === 1 ? 'Todos los meses' : 'Cada ' + f.cada + ' meses') +
          ' el ' + (f.dia_mes === 0 ? 'último día' : 'día ' + f.dia_mes);
    } else if (f.patron === 'anual') {
      s = (f.cada === 1 ? 'Todos los años' : 'Cada ' + f.cada + ' años') +
          ' el ' + (f.dia_mes === 0 ? 'último día de ' : f.dia_mes + ' de ') +
          MESES_L[(f.mes || 1) - 1];
    }
    s += ' a las ' + (f.hora || '--:--');
    if (f.patron !== 'unica') {
      s += ', desde el ' + fechaVE(f.desde);
      if (f.fin === 'fecha' && f.hasta) s += ' hasta el ' + fechaVE(f.hasta);
      else if (f.fin === 'veces' && f.veces) s += ', ' + f.veces + ' veces';
      else s += ', hasta que lo apagues';
    }
    return s;
  }

  // ── Modal — se cuelga de <body>, nunca del árbol de la app ───────────────
  // Si un ancestro tiene `transform` o `backdrop-filter`, el `position:fixed`
  // se mide contra ÉL y el modal queda encerrado en el área de contenido: se
  // corta abajo y no se llega al botón de guardar. Es la queja repetida.
  function abrirModal(op) {
    var fondo = document.createElement('div');
    fondo.className = 'mrq-fondo mrq-portal';
    if (op.tema) fondo.setAttribute('data-mrq-tema', op.tema);
    fondo.innerHTML =
      '<div class="mrq-modal" role="dialog" aria-modal="true">' +
        '<div class="mrq-modal-cab">' +
          '<div><h3>' + esc(op.titulo) + '</h3>' +
          (op.sub ? '<p>' + esc(op.sub) + '</p>' : '') + '</div>' +
          '<button class="mrq-x" data-cerrar aria-label="Cerrar">&times;</button>' +
        '</div>' +
        '<div class="mrq-modal-cuerpo"></div>' +
        '<div class="mrq-modal-pie"></div>' +
      '</div>';
    document.body.appendChild(fondo);

    var cuerpo = fondo.querySelector('.mrq-modal-cuerpo');
    var pie = fondo.querySelector('.mrq-modal-pie');
    cuerpo.innerHTML = op.cuerpo || '';
    pie.innerHTML = op.pie || '';

    function cerrar() {
      document.removeEventListener('keydown', tecla);
      if (fondo.parentNode) fondo.parentNode.removeChild(fondo);
      if (op.alCerrar) op.alCerrar();
    }
    // ⬅️ Toda pantalla tiene salida: la X, el clic afuera y Escape.
    function tecla(e) { if (e.key === 'Escape') cerrar(); }
    document.addEventListener('keydown', tecla);
    fondo.addEventListener('click', function (e) {
      if (e.target === fondo || e.target.closest('[data-cerrar]')) cerrar();
    });

    if (op.alAbrir) op.alAbrir(cuerpo, pie, cerrar);
    // El foco al primer campo, siempre. Un formulario que obliga a buscar el
    // cursor con el ratón es un formulario que se llena mal.
    var pri = cuerpo.querySelector('input, textarea, select');
    if (pri) setTimeout(function () { pri.focus(); }, 40);
    return cerrar;
  }

  // ── El widget ────────────────────────────────────────────────────────────
  function montar(el, op) {
    op = op || {};
    var sb = op.supabase;
    if (!el) throw new Error('MaxRecuerda: falta el elemento donde montarse.');
    if (!sb) throw new Error('MaxRecuerda: falta el cliente de Supabase.');

    var est = {
      tab: 'proximos',
      cargando: true,
      diag: [],
      directorio: [],
      recordatorios: [],
      proximos: [],
      pendientes: [],
      cumplimiento: null,
      puedeEscribir: true,
      vivo: true
    };

    el.classList.add('mrq');
    if (op.tema) el.setAttribute('data-mrq-tema', op.tema);

    // ── Datos ──────────────────────────────────────────────────────────────
    function pedir() {
      return Promise.all([
        sb.rpc('rec_diagnostico'),
        // ⚠️ PostgREST corta en 1.000 filas y NO avisa. El límite se pone a
        // mano para que, si un día una nómina lo pasa, se vea el aviso en vez
        // de un directorio silenciosamente incompleto.
        sb.from('rec_directorio').select('*').order('nombre').limit(1500),
        sb.from('rec_recordatorios')
          .select('*, rec_destinatarios(id,persona_id,nombre,telefono,papel)')
          .order('activo', { ascending: false }).order('id', { ascending: false }).limit(500),
        sb.rpc('rec_agenda', { p_dias: 30 }),
        sb.rpc('rec_mis_pendientes')
      ]).then(function (r) {
        est.diag = (r[0].data || []);
        est.directorio = (r[1].data || []);
        est.recordatorios = (r[2].data || []);
        est.proximos = (r[3].data || []);
        est.pendientes = (r[4].data || []);
        est.cargando = false;

        if (est.directorio.length >= 1500) {
          est.diag.push({ pieza: 'directorio', bien: false,
            detalle: 'la lista llegó al tope de 1.500: puede estar incompleta' });
        }
        // Un error de permisos no puede verse igual que «no hay nada».
        var err = r.filter(function (x) { return x && x.error; })[0];
        if (err) est.diag.push({ pieza: 'lectura', bien: false, detalle: err.error.message });
        return est;
      });
    }

    function refrescar() { return pedir().then(pintar); }

    // ── Pintar ─────────────────────────────────────────────────────────────
    function pintar() {
      if (!est.vivo) return;
      var rotos = est.diag.filter(function (d) { return !d.bien; });
      var urgentes = est.pendientes.filter(function (p) { return p.importancia === 'urgente'; }).length;

      var html = '';

      // Cabecera
      html +=
        '<div class="mrq-top">' +
          '<div>' +
            '<h2><span class="mrq-ic">⏰</span> ' + esc(op.titulo || 'Recordatorios') + '</h2>' +
            '<div class="mrq-sub">Se avisa solo por WhatsApp y aquí dentro. No depende de que nadie se acuerde.</div>' +
          '</div>' +
          '<div class="mrq-top-der">' +
            '<button class="mrq-btn" data-acc="refrescar" title="Actualizar">↻</button>' +
            '<button class="mrq-btn mrq-btn-p" data-acc="nuevo">＋ Nuevo recordatorio</button>' +
          '</div>' +
        '</div>';

      // ⛔ Si el módulo no puede trabajar, lo grita. Un canal caído se ve
      // exactamente igual que «no había nada que avisar».
      if (rotos.length) {
        html +=
          '<div class="mrq-aviso mrq-aviso-rojo">' +
            '<div style="font-size:17px">⛔</div>' +
            '<div><b>MaxRecuerda no está trabajando completo</b>' +
              '<ul>' + rotos.map(function (d) {
                return '<li>' + esc(d.pieza) + ' — ' + esc(d.detalle) + '</li>';
              }).join('') + '</ul>' +
            '</div>' +
          '</div>';
      }

      // Pestañas
      html +=
        '<div class="mrq-tabs">' +
          tab('proximos', '📅 Próximos', est.proximos.length) +
          tab('todos', '📋 Programados', est.recordatorios.filter(function (r) { return r.activo; }).length) +
          tab('mios', '🔔 Para mí', est.pendientes.length, urgentes > 0) +
          tab('cumplimiento', '✅ Cumplimiento', null) +
        '</div>';

      if (est.cargando) {
        html += '<div class="mrq-cargando"><span class="mrq-spin"></span> Cargando…</div>';
      } else if (est.tab === 'proximos')      html += vistaProximos();
      else if (est.tab === 'todos')           html += vistaTodos();
      else if (est.tab === 'mios')            html += vistaMios();
      else if (est.tab === 'cumplimiento')    html += vistaCumplimiento();

      el.innerHTML = html;
    }

    function tab(id, txt, n, alarma) {
      return '<button class="mrq-tab' + (est.tab === id ? ' on' : '') + '" data-tab="' + id + '">' +
        esc(txt) + (n ? '<span class="mrq-cont' + (alarma ? ' mrq-cont-alarma' : '') + '">' + n + '</span>' : '') +
      '</button>';
    }

    function vacio(ic, tit, txt, ejemplos) {
      return '<div class="mrq-vacio">' +
        '<div class="mrq-vacio-ic">' + ic + '</div>' +
        '<h4>' + esc(tit) + '</h4><p>' + esc(txt) + '</p>' +
        (ejemplos ? '<button class="mrq-btn mrq-btn-p" data-acc="nuevo">＋ Crear el primero</button>' +
          '<div class="mrq-ejemplos">' + ejemplos.map(function (e) {
            return '<button class="mrq-ejemplo" data-ejemplo="' + esc(e) + '">' + esc(e) + '</button>';
          }).join('') + '</div>' : '') +
      '</div>';
    }

    function vistaProximos() {
      if (!est.proximos.length) {
        return vacio('📭', 'No hay nada agendado en los próximos 30 días',
          'Un recordatorio se programa una vez y llega solo el día que tiene que llegar.',
          ['Llamar al contador el lunes', 'Pagar el seguro el 1º de cada mes',
           'Revisar los cauchos cada 15 días']);
      }
      // Agrupados por día: una lista corrida de treinta filas no se lee.
      var grupos = {}, orden = [];
      est.proximos.forEach(function (p) {
        var d = String(p.cuando).slice(0, 10);
        if (!grupos[d]) { grupos[d] = []; orden.push(d); }
        grupos[d].push(p);
      });
      return orden.map(function (d) {
        var pp = partes(d + ' 00:00');
        var rel = enBreve(d);
        return '<div class="mrq-titulillo">' +
                 esc(pp.diaSem) + ' ' + fechaVE(d) + (rel ? ' · ' + esc(rel) : '') +
               '</div><div class="mrq-lista">' +
          grupos[d].map(function (p) {
            var q = partes(p.cuando);
            return '<div class="mrq-card mrq-i-' + esc(p.importancia) + '">' +
              '<div class="mrq-cuando"><div class="mrq-hora-g">' + esc(q.hora) + '</div></div>' +
              '<div class="mrq-card-cuerpo">' +
                '<div class="mrq-card-tit">' + esc(p.titulo) + chip(p.importancia) +
                  (p.confirmar ? '<span class="mrq-chip">✅ pide confirmar</span>' : '') + '</div>' +
                '<div class="mrq-card-pie">' +
                  '<span>👤 <b>' + esc(p.a_quien || 'sin destinatario') + '</b></span>' +
                  '<span>🔁 ' + esc(p.en_palabras) + '</span>' +
                '</div>' +
              '</div>' +
              '<div class="mrq-card-acc">' +
                '<button class="mrq-btn mrq-btn-s" data-editar="' + p.recordatorio_id + '">Editar</button>' +
              '</div>' +
            '</div>';
          }).join('') + '</div>';
      }).join('');
    }

    function chip(imp) {
      return '<span class="mrq-chip mrq-chip-' + esc(imp) + '">' + impIc(imp) + ' ' + esc(impNom(imp)) + '</span>';
    }

    function vistaTodos() {
      if (!est.recordatorios.length) {
        return vacio('🗒️', 'Todavía no hay recordatorios',
          'Todo lo que hoy depende de que alguien se acuerde, puede vivir aquí.',
          ['Llamar al contador el lunes', 'Pagar el seguro el 1º de cada mes',
           'Felicitar al equipo los viernes']);
      }
      var prox = {};
      est.proximos.forEach(function (p) { if (!prox[p.recordatorio_id]) prox[p.recordatorio_id] = p.cuando; });

      return '<div class="mrq-lista">' + est.recordatorios.map(function (r) {
        var dests = (r.rec_destinatarios || []).filter(function (d) { return d.papel === 'destino'; });
        var jefes = (r.rec_destinatarios || []).filter(function (d) { return d.papel === 'escalada'; });
        var sig = prox[r.id] ? partes(prox[r.id]) : null;
        return '<div class="mrq-card mrq-i-' + esc(r.importancia) + (r.activo ? '' : ' mrq-apagado') + '">' +
          (sig ? '<div class="mrq-cuando">' +
                   '<div class="mrq-dia">' + esc(sig.dia) + '</div>' +
                   '<div class="mrq-mes">' + esc(sig.mes) + '</div>' +
                   '<div class="mrq-hora">' + esc(sig.hora) + '</div>' +
                 '</div>'
               : '<div class="mrq-cuando"><div class="mrq-dia">—</div><div class="mrq-mes">apagado</div></div>') +
          '<div class="mrq-card-cuerpo">' +
            '<div class="mrq-card-tit">' + esc(r.titulo) + chip(r.importancia) +
              (r.activo ? '' : '<span class="mrq-chip">⏸ apagado</span>') + '</div>' +
            (r.detalle ? '<div class="mrq-card-det">' + esc(r.detalle) + '</div>' : '') +
            '<div class="mrq-card-pie">' +
              '<span>👤 <b>' + esc(dests.map(function (d) { return d.nombre; }).join(', ') || 'sin destinatario') + '</b></span>' +
              (r.confirmar ? '<span class="mrq-chip mrq-chip-ok">✅ pide confirmar</span>' : '') +
              (jefes.length ? '<span>⚠️ si no confirman en ' + fmtMin(r.escalar_min) +
                              ' → <b>' + esc(jefes.map(function (d) { return d.nombre; }).join(', ')) + '</b></span>' : '') +
            '</div>' +
          '</div>' +
          '<div class="mrq-card-acc">' +
            '<button class="mrq-btn mrq-btn-s" data-editar="' + r.id + '">Editar</button>' +
            '<button class="mrq-btn mrq-btn-s" data-apagar="' + r.id + '">' + (r.activo ? '⏸' : '▶') + '</button>' +
          '</div>' +
        '</div>';
      }).join('') + '</div>';
    }

    function fmtMin(m) {
      if (!m) return '';
      if (m < 60) return m + ' min';
      if (m % 1440 === 0) return (m / 1440) + (m === 1440 ? ' día' : ' días');
      if (m % 60 === 0) return (m / 60) + (m === 60 ? ' hora' : ' horas');
      return Math.round(m / 60) + ' horas';
    }

    function vistaMios() {
      if (!est.pendientes.length) {
        return vacio('🎉', 'No tienes nada pendiente',
          'Cuando te toque algo, te llega por WhatsApp y aparece aquí.');
      }
      return '<div class="mrq-lista">' + est.pendientes.map(function (p) {
        var q = partes(p.cuando);
        return '<div class="mrq-card mrq-i-' + esc(p.importancia) + '">' +
          '<div class="mrq-cuando"><div class="mrq-dia">' + esc(q.dia) + '</div>' +
            '<div class="mrq-mes">' + esc(q.mes) + '</div>' +
            '<div class="mrq-hora">' + esc(q.hora) + '</div></div>' +
          '<div class="mrq-card-cuerpo">' +
            '<div class="mrq-card-tit">' + esc(p.titulo) + chip(p.importancia) +
              (p.papel === 'escalada' ? '<span class="mrq-chip mrq-chip-alarma">⚠️ nadie lo confirmó</span>' : '') +
              // Que el WhatsApp no saliera NO puede quedar en un log: se dice.
              (p.sin_whatsapp ? '<span class="mrq-chip mrq-chip-alarma">📵 no salió por WhatsApp</span>' : '') +
            '</div>' +
            (p.detalle ? '<div class="mrq-card-det">' + esc(p.detalle) + '</div>' : '') +
          '</div>' +
          '<div class="mrq-card-acc">' +
            (p.confirmar
              ? '<button class="mrq-btn mrq-btn-ok mrq-btn-s" data-hecho="' + p.entrega_id + '">✓ Ya lo hice</button>'
              : '<button class="mrq-btn mrq-btn-s" data-hecho="' + p.entrega_id + '">Listo</button>') +
          '</div>' +
        '</div>';
      }).join('') + '</div>';
    }

    function vistaCumplimiento() {
      var c = est.cumplimiento;
      if (!c) {
        cargarCumplimiento();
        return '<div class="mrq-cargando"><span class="mrq-spin"></span> Contando…</div>';
      }
      var pct = c.avisados ? Math.round((c.hechos / c.avisados) * 100) : 0;
      // Cuatro cifras, no un párrafo. Y las dos últimas se pintan de rojo solas
      // cuando dejan de ser cero: eso es lo que hace que un tablero se mire.
      return '' +
        '<div class="mrq-titulillo">Últimos 30 días</div>' +
        '<div class="mrq-kpis">' +
          kpi(c.avisados, 'Avisos enviados', '', '') +
          kpi(c.hechos + ' <span style="font-size:15px;font-weight:600">(' + pct + '%)</span>',
              'Confirmados', 'de los que pedían confirmación',
              c.avisados && pct >= 80 ? 'mrq-kpi-bien' : '',
              '<div class="mrq-barra"><i style="width:' + pct + '%"></i></div>') +
          kpi(c.sin_canal, 'No salieron por WhatsApp',
              c.sin_canal ? 'Llegaron solo a la pantalla. Revisa el número o la lista blanca.'
                          : 'Todos salieron.',
              c.sin_canal ? 'mrq-kpi-mal' : 'mrq-kpi-bien') +
          kpi(c.vencidos, 'Se pasaron de hora',
              c.vencidos ? 'El sistema estuvo caído y NO se enviaron. Esto se reporta, no se limpia.'
                         : 'Ninguno se perdió.',
              c.vencidos ? 'mrq-kpi-mal' : 'mrq-kpi-bien') +
        '</div>' +
        (c.sin_confirmar.length
          ? '<div class="mrq-titulillo">Sin confirmar</div><div class="mrq-lista">' +
            c.sin_confirmar.map(function (e) {
              return '<div class="mrq-card mrq-i-importante">' +
                '<div class="mrq-card-cuerpo"><div class="mrq-card-tit">' + esc(e.titulo) + '</div>' +
                '<div class="mrq-card-pie"><span>👤 <b>' + esc(e.nombre || '—') + '</b></span>' +
                '<span>📅 ' + esc(fechaVE(e.cuando)) + '</span>' +
                '<span class="mrq-chip mrq-chip-alarma">' + esc(e.estado) + '</span></div></div></div>';
            }).join('') + '</div>'
          : '<div class="mrq-vacio"><div class="mrq-vacio-ic">👌</div>' +
            '<h4>Todo lo que pidió confirmación, se confirmó</h4>' +
            '<p>Ningún pendiente quedó abierto en los últimos 30 días.</p></div>');
    }

    function kpi(n, tit, det, clase, extra) {
      return '<div class="mrq-kpi ' + (clase || '') + '">' +
        '<div class="mrq-kpi-n">' + n + '</div>' +
        '<div class="mrq-kpi-t">' + esc(tit) + '</div>' +
        (extra || '') +
        (det ? '<div class="mrq-kpi-d">' + esc(det) + '</div>' : '') +
      '</div>';
    }

    function cargarCumplimiento() {
      var desde = new Date(Date.now() - 30 * 86400000).toISOString();
      Promise.all([
        sb.from('rec_entregas').select('id,estado,nombre,recordatorio_id,creado_at')
          .gte('creado_at', desde).limit(2000),
        sb.from('rec_disparos').select('id,estado,momento_local,recordatorio_id')
          .gte('creado_at', desde).limit(2000)
      ]).then(function (r) {
        var ents = r[0].data || [], disp = r[1].data || [];
        var titulos = {};
        est.recordatorios.forEach(function (x) { titulos[x.id] = x.titulo; });
        est.cumplimiento = {
          avisados: ents.filter(function (e) { return e.estado !== 'pendiente'; }).length,
          hechos: ents.filter(function (e) { return e.estado === 'hecho'; }).length,
          sin_canal: ents.filter(function (e) { return e.estado === 'sin_canal'; }).length,
          vencidos: disp.filter(function (d) { return d.estado === 'vencido'; }).length,
          sin_confirmar: ents.filter(function (e) {
            return e.estado === 'encolado' || e.estado === 'visto' || e.estado === 'escalado';
          }).slice(0, 25).map(function (e) {
            return { titulo: titulos[e.recordatorio_id] || 'Recordatorio',
                     nombre: e.nombre, cuando: e.creado_at, estado: e.estado };
          })
        };
        pintar();
      });
    }

    // ── El formulario ──────────────────────────────────────────────────────
    function formulario(rec) {
      var f = rec ? {
        id: rec.id, titulo: rec.titulo, detalle: rec.detalle || '',
        importancia: rec.importancia, hora: String(rec.hora).slice(0, 5),
        patron: rec.patron, cada: rec.cada,
        dias_semana: (rec.dias_semana || []).slice(),
        dia_mes: rec.dia_mes, mes: rec.mes,
        desde: rec.desde, hasta: rec.hasta, veces: rec.veces,
        fin: rec.hasta ? 'fecha' : (rec.veces ? 'veces' : 'nunca'),
        confirmar: rec.confirmar, escalar_min: rec.escalar_min || 120,
        escalar: !!rec.escalar_min,
        destinos: (rec.rec_destinatarios || []).filter(function (d) { return d.papel === 'destino'; })
                  .map(function (d) { return { persona_id: d.persona_id, nombre: d.nombre, telefono: d.telefono }; }),
        jefes: (rec.rec_destinatarios || []).filter(function (d) { return d.papel === 'escalada'; })
                  .map(function (d) { return { persona_id: d.persona_id, nombre: d.nombre, telefono: d.telefono }; })
      } : {
        titulo: op.borrador || '', detalle: '', importancia: 'normal', hora: '08:00',
        patron: 'unica', cada: 1, dias_semana: [], dia_mes: 1, mes: new Date().getMonth() + 1,
        desde: hoyISO(), hasta: null, veces: null, fin: 'nunca',
        confirmar: false, escalar: false, escalar_min: 120, destinos: [], jefes: []
      };
      op.borrador = '';

      var cerrar = abrirModal({
        titulo: rec ? 'Editar recordatorio' : 'Nuevo recordatorio',
        sub: rec ? 'Los cambios valen desde el próximo aviso.' : 'Se avisa solo, aunque nadie abra el sistema.',
        tema: op.tema,
        cuerpo: '<div data-form></div>',
        pie: '<button class="mrq-btn mrq-btn-fantasma" data-cerrar>Cancelar</button>' +
             '<div class="mrq-der">' +
               (rec ? '<button class="mrq-btn mrq-btn-peligro" data-borrar>Borrar</button>' : '') +
               '<button class="mrq-btn mrq-btn-p" data-guardar>Guardar</button>' +
             '</div>',
        alAbrir: function (cuerpo, pie, cerrarFn) {
          var caja = cuerpo.querySelector('[data-form]');

          function pintarForm(foco) {
            caja.innerHTML =
              campo('¿Qué hay que recordar?', '<input class="mrq-in" data-c="titulo" maxlength="140" ' +
                'placeholder="Llamar a Carlos por el contrato" value="' + esc(f.titulo) + '">') +

              campo('Detalle <span class="mrq-pista">— opcional, va en el mismo mensaje</span>',
                '<textarea class="mrq-area" data-c="detalle" maxlength="600" ' +
                'placeholder="Preguntarle por la factura de julio">' + esc(f.detalle) + '</textarea>') +

              campo('¿Qué tan importante es?', '<div class="mrq-imp">' +
                IMPORTANCIAS.map(function (i) {
                  return '<button type="button" data-imp="' + i.v + '" data-v="' + i.v + '"' +
                    (f.importancia === i.v ? ' class="on"' : '') + '>' +
                    '<span class="mrq-imp-t">' + i.ic + ' ' + i.t + '</span>' +
                    '<span class="mrq-imp-d">' + i.d + '</span></button>';
                }).join('') + '</div>') +

              campo('¿A quién le llega?' +
                ' <span class="mrq-pista">— los que hagan falta; cada uno recibe el suyo</span>',
                personas('destinos', 'Escribe un nombre o un cargo…')) +

              '<div class="mrq-fila">' +
                campo('Primera vez', '<input type="date" class="mrq-in" data-c="desde" value="' + esc(f.desde) + '">') +
                campo('Hora', '<input type="time" class="mrq-in" data-c="hora" value="' + esc(f.hora) + '">') +
              '</div>' +

              campo('¿Se repite?',
                '<select class="mrq-sel" data-c="patron">' +
                  opcion('unica', 'No, una sola vez', f.patron) +
                  opcion('diaria', 'Todos los días', f.patron) +
                  opcion('semanal', 'Cada semana, ciertos días', f.patron) +
                  opcion('mensual', 'Cada mes, un día fijo', f.patron) +
                  opcion('anual', 'Una vez al año', f.patron) +
                '</select>') +

              (f.patron === 'semanal'
                ? campo('¿Qué días?', '<div class="mrq-dias">' + DIAS_C.map(function (d, i) {
                    return '<button type="button" data-dia="' + (i + 1) + '"' +
                      (f.dias_semana.indexOf(i + 1) >= 0 ? ' class="on"' : '') + '>' + d + '</button>';
                  }).join('') + '</div>') : '') +

              (f.patron === 'mensual'
                ? campo('¿Qué día del mes?',
                    '<select class="mrq-sel" data-c="dia_mes">' +
                      Array.apply(null, Array(31)).map(function (_, i) {
                        return opcion(String(i + 1), 'Día ' + (i + 1), String(f.dia_mes));
                      }).join('') +
                      opcion('0', 'El último día del mes', String(f.dia_mes)) +
                    '</select>' +
                    (f.dia_mes > 28 ? '<div class="mrq-card-pie" style="margin-top:6px">' +
                      'ℹ️ En los meses que no tienen ese día, se avisa el último.</div>' : '')) : '') +

              (f.patron === 'anual'
                ? '<div class="mrq-fila">' +
                    campo('Mes', '<select class="mrq-sel" data-c="mes">' + MESES_L.map(function (m, i) {
                      return opcion(String(i + 1), m.charAt(0).toUpperCase() + m.slice(1), String(f.mes));
                    }).join('') + '</select>') +
                    campo('Día', '<input type="number" class="mrq-in" data-c="dia_mes" min="1" max="31" value="' +
                      esc(f.dia_mes || 1) + '">') +
                  '</div>' : '') +

              (f.patron !== 'unica'
                ? campo('¿Hasta cuándo?',
                    '<select class="mrq-sel" data-c="fin">' +
                      opcion('nunca', 'Hasta que lo apague', f.fin) +
                      opcion('fecha', 'Hasta una fecha', f.fin) +
                      opcion('veces', 'Un número de veces', f.fin) +
                    '</select>' +
                    (f.fin === 'fecha' ? '<input type="date" class="mrq-in" style="margin-top:8px" ' +
                      'data-c="hasta" value="' + esc(f.hasta || '') + '">' : '') +
                    (f.fin === 'veces' ? '<input type="number" class="mrq-in" style="margin-top:8px" ' +
                      'data-c="veces" min="1" max="999" value="' + esc(f.veces || 12) + '">' : '')) : '') +

              // El resumen. Lo último que se lee antes de guardar, y lo que
              // evita el error caro.
              '<div class="mrq-resumen">' +
                '<div class="mrq-resumen-ic">📣</div>' +
                '<div><div class="mrq-resumen-t">' + esc(enPalabras(f)) + '</div>' +
                '<div class="mrq-resumen-d">' + esc(resumenDestinos()) + '</div></div>' +
              '</div>' +

              '<div class="mrq-titulillo">¿Hay que confirmar que se hizo?</div>' +
              '<label class="mrq-check"><input type="checkbox" data-c="confirmar"' +
                (f.confirmar ? ' checked' : '') + '>' +
                '<div><div class="mrq-check-t">Pedir confirmación</div>' +
                '<div class="mrq-check-d">El mensaje lleva un botón «ya lo hice». ' +
                'Mientras nadie lo toque, queda pendiente y se ve.</div></div></label>' +

              (f.confirmar
                ? '<div style="margin-top:10px">' +
                    '<label class="mrq-check"><input type="checkbox" data-c="escalar"' +
                      (f.escalar ? ' checked' : '') + '>' +
                      '<div><div class="mrq-check-t">Y si nadie confirma, avisarle a alguien más</div>' +
                      '<div class="mrq-check-d">Esto es lo que convierte el recordatorio en control.</div></div></label>' +
                    (f.escalar
                      ? '<div class="mrq-fila" style="margin-top:12px">' +
                          campo('Esperar', '<select class="mrq-sel" data-c="escalar_min">' +
                            [30, 60, 120, 240, 480, 1440, 2880].map(function (m) {
                              return opcion(String(m), fmtMin(m), String(f.escalar_min));
                            }).join('') + '</select>') +
                        '</div>' +
                        campo('Y avisarle a', personas('jefes', 'El jefe, el dueño…')) : '') +
                  '</div>' : '');

            // El foco vuelve donde estaba la mano. Sin esto, elegir a diez
            // personas cuesta diez viajes al ratón — y a la tercera se
            // abandona y se escribe «el equipo» en el detalle.
            if (foco) {
              var s = caja.querySelector('[data-personas="' + foco + '"] [data-buscar]');
              if (s) { s.focus(); return; }
            }
            var t = caja.querySelector('[data-c="titulo"]');
            if (t && !f.titulo) t.focus();
          }

          function campo(lab, dentro) {
            return '<div class="mrq-campo"><label>' + lab + '</label>' + dentro + '</div>';
          }
          function opcion(v, t, sel) {
            return '<option value="' + esc(v) + '"' + (String(sel) === String(v) ? ' selected' : '') + '>' +
              esc(t) + '</option>';
          }
          function nombres(lista) {
            // «Ana, Luis y Carlos» — con la ‘y’ delante del último, como se
            // habla. Una lista con comas hasta el final se lee como un listado
            // de sistema, no como una frase.
            var n = lista.map(function (d) { return d.nombre; });
            if (n.length <= 1) return n.join('');
            return n.slice(0, -1).join(', ') + ' y ' + n[n.length - 1];
          }
          function resumenDestinos() {
            if (!f.destinos.length) return '⚠️ Falta elegir a quién le llega.';
            var s = f.destinos.length === 1
              ? 'Le llega a ' + f.destinos[0].nombre + '.'
              : 'Le llega a ' + f.destinos.length + ' personas: ' + nombres(f.destinos) + '.';
            // Que cada uno confirme por separado no es un detalle técnico: es
            // lo que hace que «se hizo» signifique algo cuando son varios.
            if (f.confirmar) {
              s += f.destinos.length === 1
                ? ' Tiene que confirmar que lo hizo.'
                : ' Cada uno confirma el suyo por separado.';
            }
            if (f.escalar && f.jefes.length) {
              s += ' Si alguno no confirma, a las ' + fmtMin(f.escalar_min) +
                   ' se le avisa a ' + nombres(f.jefes) + '.';
            }
            return s;
          }

          // Grupos por cargo — «los 12 choferes» de un toque. Escribir doce
          // nombres a mano es donde se olvida uno, y el que se olvida es
          // justo el que no se entera.
          function grupos(cual) {
            var sel = f[cual], porRol = {};
            est.directorio.forEach(function (p) {
              var r = (p.rol || '').trim();
              if (!r) return;
              (porRol[r] = porRol[r] || []).push(p);
            });
            var chips = Object.keys(porRol).sort().filter(function (r) {
              // Solo grupos que aporten: uno de una persona ya está en el buscador,
              // y uno ya completo no tiene nada que agregar.
              return porRol[r].length > 1 && porRol[r].some(function (p) {
                return !sel.some(function (x) { return x.persona_id === p.persona_id; });
              });
            }).slice(0, 6);
            if (!chips.length) return '';
            return '<div class="mrq-ejemplos" style="justify-content:flex-start;margin-top:8px">' +
              chips.map(function (r) {
                return '<button type="button" class="mrq-ejemplo" data-grupo="' + esc(r) + '">' +
                  '＋ ' + esc(r) + ' <b>(' + porRol[r].length + ')</b></button>';
              }).join('') + '</div>';
          }

          function personas(cual, ph) {
            var sel = f[cual];
            return '<div class="mrq-personas" data-personas="' + cual + '">' +
              (sel.length ? '<div class="mrq-elegidos">' + sel.map(function (d, i) {
                return '<span class="mrq-elegido">' + esc(d.nombre) +
                  '<button type="button" data-quitar="' + i + '" aria-label="Quitar">&times;</button></span>';
              }).join('') +
              (sel.length > 1
                ? '<button type="button" class="mrq-ejemplo" data-vaciar>Quitar todos (' + sel.length + ')</button>'
                : '') + '</div>' : '') +
              '<input class="mrq-in" data-buscar placeholder="' + esc(ph) + '" autocomplete="off">' +
              '<div class="mrq-sugeridos" hidden></div>' +
              grupos(cual) +
            '</div>';
          }

          // ── Eventos del formulario ─────────────────────────────────────
          caja.addEventListener('input', function (e) {
            var c = e.target.getAttribute('data-c');
            if (!c) return;
            if (c === 'titulo' || c === 'detalle') { f[c] = e.target.value; refrescarResumen(); return; }
            f[c] = e.target.type === 'checkbox' ? e.target.checked : e.target.value;
            if (c === 'dia_mes' || c === 'mes' || c === 'veces' || c === 'cada') f[c] = parseInt(f[c], 10) || 0;
            if (c === 'escalar_min') f[c] = parseInt(f[c], 10);
            if (c === 'hora' || c === 'desde' || c === 'hasta' || c === 'veces') { refrescarResumen(); return; }
            pintarForm();
          });
          caja.addEventListener('change', function (e) {
            var c = e.target.getAttribute('data-c');
            if (c === 'patron' || c === 'fin' || c === 'confirmar' || c === 'escalar' ||
                c === 'dia_mes' || c === 'mes') {
              f[c] = e.target.type === 'checkbox' ? e.target.checked : e.target.value;
              if (c === 'dia_mes' || c === 'mes') f[c] = parseInt(f[c], 10);
              if (c === 'patron' && f.patron === 'semanal' && !f.dias_semana.length) {
                f.dias_semana = [((new Date(f.desde + 'T00:00:00').getDay() + 6) % 7) + 1];
              }
              pintarForm();
            }
          });

          function refrescarResumen() {
            var r = caja.querySelector('.mrq-resumen-t'), d = caja.querySelector('.mrq-resumen-d');
            if (r) r.textContent = enPalabras(f);
            if (d) d.textContent = resumenDestinos();
          }

          caja.addEventListener('click', function (e) {
            var b;
            if ((b = e.target.closest('[data-imp]'))) {
              f.importancia = b.getAttribute('data-imp'); pintarForm(); return;
            }
            if ((b = e.target.closest('[data-dia]'))) {
              var d = parseInt(b.getAttribute('data-dia'), 10);
              var i = f.dias_semana.indexOf(d);
              if (i >= 0) f.dias_semana.splice(i, 1); else f.dias_semana.push(d);
              pintarForm(); return;
            }
            if ((b = e.target.closest('[data-quitar]'))) {
              var cual = b.closest('[data-personas]').getAttribute('data-personas');
              f[cual].splice(parseInt(b.getAttribute('data-quitar'), 10), 1);
              pintarForm(); return;
            }
            if ((b = e.target.closest('[data-elegir]'))) {
              var cual2 = b.closest('[data-personas]').getAttribute('data-personas');
              var p = est.directorio[parseInt(b.getAttribute('data-elegir'), 10)];
              if (p && !f[cual2].some(function (x) { return x.persona_id === p.persona_id; })) {
                f[cual2].push({ persona_id: p.persona_id, nombre: p.nombre, telefono: p.telefono });
              }
              // Se vuelve al buscador con el cursor puesto: elegir a diez
              // personas no puede costar diez viajes con el ratón.
              pintarForm(cual2); return;
            }
            if ((b = e.target.closest('[data-grupo]'))) {
              var cual3 = b.closest('[data-personas]').getAttribute('data-personas');
              var rol = b.getAttribute('data-grupo'), n = 0;
              est.directorio.forEach(function (q) {
                if ((q.rol || '').trim() !== rol) return;
                if (f[cual3].some(function (x) { return x.persona_id === q.persona_id; })) return;
                f[cual3].push({ persona_id: q.persona_id, nombre: q.nombre, telefono: q.telefono });
                n++;
              });
              toast('Agregados ' + n + ' · ' + rol, 'mrq-toast-ok');
              pintarForm(cual3); return;
            }
            if ((b = e.target.closest('[data-vaciar]'))) {
              var cual4 = b.closest('[data-personas]').getAttribute('data-personas');
              f[cual4] = [];
              pintarForm(cual4); return;
            }
          });

          // Buscador: filtra por nombre o por cargo, sin acentos.
          caja.addEventListener('input', function (e) {
            if (!e.target.hasAttribute('data-buscar')) return;
            var q = norm(e.target.value);
            var lista = e.target.parentNode.querySelector('.mrq-sugeridos');
            if (!q) { lista.hidden = true; return; }
            var hits = [];
            for (var i = 0; i < est.directorio.length && hits.length < 8; i++) {
              var p = est.directorio[i];
              if (norm(p.nombre).indexOf(q) >= 0 || norm(p.rol || '').indexOf(q) >= 0) {
                hits.push({ i: i, p: p });
              }
            }
            lista.hidden = false;
            lista.innerHTML = hits.length
              ? hits.map(function (h) {
                  return '<div class="mrq-sug" data-elegir="' + h.i + '">' +
                    '<span class="mrq-sug-n">' + esc(h.p.nombre) + '</span>' +
                    '<span class="mrq-sug-r">' + esc(h.p.rol || '') + '</span></div>';
                }).join('')
              : '<div class="mrq-sug" style="cursor:default;color:var(--mrq-tinta-3)">' +
                'Nadie con ese nombre. Solo aparece la gente activa y con teléfono cargado.</div>';
          });

          function norm(s) {
            return String(s || '').toLowerCase()
              .replace(/[áàä]/g, 'a').replace(/[éèë]/g, 'e').replace(/[íìï]/g, 'i')
              .replace(/[óòö]/g, 'o').replace(/[úùü]/g, 'u').replace(/ñ/g, 'n').trim();
          }

          // ── Guardar ────────────────────────────────────────────────────
          pie.addEventListener('click', function (e) {
            if (e.target.closest('[data-guardar]')) return guardar(e.target.closest('[data-guardar]'));
            if (e.target.closest('[data-borrar]')) return borrar();
          });

          function guardar(btn) {
            // Los avisos se dan uno a uno y en cristiano: «falta X» se arregla,
            // «datos inválidos» no.
            if (!f.titulo.trim()) return toast('Ponle un título: qué hay que recordar.', 'mrq-toast-mal');
            if (!f.destinos.length) return toast('Falta elegir a quién le llega.', 'mrq-toast-mal');
            if (!f.hora) return toast('Falta la hora.', 'mrq-toast-mal');
            if (!f.desde) return toast('Falta la fecha.', 'mrq-toast-mal');
            if (f.patron === 'semanal' && !f.dias_semana.length)
              return toast('Elige al menos un día de la semana.', 'mrq-toast-mal');
            if (f.escalar && !f.jefes.length)
              return toast('Si nadie confirma, ¿a quién se le avisa? Falta esa persona.', 'mrq-toast-mal');
            if (f.fin === 'fecha' && (!f.hasta || f.hasta < f.desde))
              return toast('La fecha de fin tiene que ser posterior a la primera vez.', 'mrq-toast-mal');

            // ⛔ Guardar que no se nota, se repite. El botón cambia AL INSTANTE
            // y no deja pulsar dos veces.
            btn.disabled = true;
            var antes = btn.textContent;
            btn.textContent = 'Guardando…';

            var p = {
              id: f.id || null, titulo: f.titulo.trim(), detalle: f.detalle.trim(),
              importancia: f.importancia, hora: f.hora, patron: f.patron, cada: f.cada || 1,
              dias_semana: f.patron === 'semanal' ? f.dias_semana : [],
              dia_mes: (f.patron === 'mensual' || f.patron === 'anual') ? f.dia_mes : null,
              mes: f.patron === 'anual' ? f.mes : null,
              desde: f.desde,
              hasta: f.patron !== 'unica' && f.fin === 'fecha' ? f.hasta : null,
              veces: f.patron !== 'unica' && f.fin === 'veces' ? f.veces : null,
              confirmar: !!f.confirmar,
              escalar_min: (f.confirmar && f.escalar) ? f.escalar_min : null,
              activo: true,
              destinatarios: f.destinos.map(function (d) {
                return { persona_id: d.persona_id, nombre: d.nombre, telefono: d.telefono, papel: 'destino' };
              }).concat((f.confirmar && f.escalar ? f.jefes : []).map(function (d) {
                return { persona_id: d.persona_id, nombre: d.nombre, telefono: d.telefono, papel: 'escalada' };
              }))
            };

            sb.rpc('rec_guardar', { p: p }).then(function (r) {
              btn.disabled = false; btn.textContent = antes;
              if (r.error) return toast('No se guardó: ' + r.error.message, 'mrq-toast-mal');
              var d = r.data || {};
              // Se confirma con el DATO, no con un «listo» genérico: la persona
              // tiene que poder verificar que quedó como quería.
              toast(d.proximo ? 'Guardado. Primer aviso: ' + d.proximo.replace(' ', ' a las ')
                              : 'Guardado.', 'mrq-toast-ok');
              cerrarFn();
              refrescar();
            });
          }

          function borrar() {
            if (!confirm('¿Borrar «' + f.titulo + '»?\n\nLo ya enviado queda en el historial.')) return;
            sb.from('rec_recordatorios').delete().eq('id', f.id).then(function (r) {
              if (r.error) return toast('No se pudo borrar: ' + r.error.message, 'mrq-toast-mal');
              toast('Borrado.', 'mrq-toast-ok');
              cerrarFn(); refrescar();
            });
          }

          pintarForm();
        }
      });
      return cerrar;
    }

    // ── Eventos de la pantalla ─────────────────────────────────────────────
    function alClic(e) {
      var b;
      if ((b = e.target.closest('[data-tab]'))) {
        est.tab = b.getAttribute('data-tab'); pintar(); return;
      }
      if (e.target.closest('[data-acc="nuevo"]')) { formulario(null); return; }
      if (e.target.closest('[data-acc="refrescar"]')) { est.cumplimiento = null; refrescar(); return; }
      if ((b = e.target.closest('[data-ejemplo]'))) {
        op.borrador = b.getAttribute('data-ejemplo'); formulario(null); return;
      }
      if ((b = e.target.closest('[data-editar]'))) {
        var id = parseInt(b.getAttribute('data-editar'), 10);
        var rec = est.recordatorios.filter(function (r) { return r.id === id; })[0];
        if (rec) formulario(rec); else toast('No encuentro ese recordatorio.', 'mrq-toast-mal');
        return;
      }
      if ((b = e.target.closest('[data-apagar]'))) {
        var id2 = parseInt(b.getAttribute('data-apagar'), 10);
        var r2 = est.recordatorios.filter(function (x) { return x.id === id2; })[0];
        if (!r2) return;
        sb.from('rec_recordatorios').update({ activo: !r2.activo }).eq('id', id2).then(function (rr) {
          if (rr.error) return toast('No se pudo: ' + rr.error.message, 'mrq-toast-mal');
          toast(r2.activo ? 'Apagado. No volverá a avisar.' : 'Encendido.', 'mrq-toast-ok');
          refrescar();
        });
        return;
      }
      if ((b = e.target.closest('[data-hecho]'))) {
        var eid = parseInt(b.getAttribute('data-hecho'), 10);
        b.disabled = true;
        sb.rpc('rec_marcar_hecho', { p_entrega_id: eid }).then(function (rr) {
          if (rr.error || !(rr.data && rr.data.ok)) {
            b.disabled = false;
            return toast('No se pudo marcar: ' + ((rr.data && rr.data.motivo) || (rr.error && rr.error.message) || ''),
                         'mrq-toast-mal');
          }
          toast('✓ Listo.', 'mrq-toast-ok');
          refrescar();
        });
        return;
      }
    }

    el.addEventListener('click', alClic);
    pintar();
    refrescar();

    // Se refresca solo cada 2 minutos: un pendiente que aparece cuando ya
    // pasó la hora no sirve. Se apaga al desmontar para no dejar temporizadores
    // apilados — el mismo bug que hacía disparar avisos a horas raras.
    var reloj = setInterval(function () { if (est.vivo) refrescar(); }, 120000);

    return function desmontar() {
      est.vivo = false;
      clearInterval(reloj);
      el.removeEventListener('click', alClic);
      el.innerHTML = '';
    };
  }

  // ── La campanita, para la barra superior de cualquier app ────────────────
  function campanita(el, op) {
    op = op || {};
    var sb = op.supabase;
    var abierto = false, datos = [], vivo = true;

    el.classList.add('mrq', 'mrq-campana');
    if (op.tema) el.setAttribute('data-mrq-tema', op.tema);

    function pedir() {
      return sb.rpc('rec_mis_pendientes').then(function (r) {
        datos = r.data || []; pintar();
      });
    }

    function pintar() {
      if (!vivo) return;
      var urg = datos.filter(function (d) { return d.importancia === 'urgente'; }).length;
      el.innerHTML =
        '<button class="mrq-campana-btn" data-abrir aria-label="Recordatorios">🔔' +
          (datos.length ? '<span class="mrq-punto' + (urg ? '' : ' mrq-punto-suave') + '">' +
            (datos.length > 9 ? '9+' : datos.length) + '</span>' : '') +
        '</button>' +
        (abierto ? panel() : '');
    }

    function panel() {
      return '<div class="mrq-panel">' +
        '<div class="mrq-panel-cab"><b>Pendientes tuyos</b>' +
          '<button class="mrq-x" data-cerrar style="margin-left:auto" aria-label="Cerrar">&times;</button></div>' +
        '<div class="mrq-panel-cuerpo">' +
          (datos.length ? datos.map(function (p) {
            var q = partes(p.cuando);
            return '<div class="mrq-pend mrq-i-' + esc(p.importancia) + '">' +
              '<div class="mrq-pend-t">' + impIc(p.importancia) + ' ' + esc(p.titulo) + '</div>' +
              '<div class="mrq-pend-c">' + esc(q.dia + '/' + (q.mes || '')) + ' · ' + esc(q.hora) +
                (p.sin_whatsapp ? ' · 📵 no salió por WhatsApp' : '') +
                (p.papel === 'escalada' ? ' · ⚠️ nadie lo confirmó' : '') + '</div>' +
              (p.detalle ? '<div class="mrq-pend-c" style="margin-top:4px">' + esc(p.detalle) + '</div>' : '') +
              '<div class="mrq-pend-acc">' +
                '<button class="mrq-btn mrq-btn-ok mrq-btn-s" data-hecho="' + p.entrega_id + '">✓ Ya lo hice</button>' +
              '</div></div>';
          }).join('')
          : '<div class="mrq-vacio" style="padding:28px 16px;border:0">' +
            '<div class="mrq-vacio-ic">🎉</div><h4>Nada pendiente</h4>' +
            '<p>Cuando te toque algo, aparece aquí.</p></div>') +
        '</div></div>';
    }

    el.addEventListener('click', function (e) {
      if (e.target.closest('[data-abrir]')) { abierto = !abierto; pintar(); if (abierto) pedir(); return; }
      if (e.target.closest('[data-cerrar]')) { abierto = false; pintar(); return; }
      var b = e.target.closest('[data-hecho]');
      if (b) {
        b.disabled = true;
        sb.rpc('rec_marcar_hecho', { p_entrega_id: parseInt(b.getAttribute('data-hecho'), 10) })
          .then(function () { toast('✓ Listo.', 'mrq-toast-ok'); pedir(); });
      }
    });
    // ⛔ EN FASE DE CAPTURA, y no en la de burbuja. El manejador de arriba
    // repinta `el`, así que para cuando el evento llega a `document` el botón
    // que se pulsó YA NO EXISTE en el árbol: `el.contains(e.target)` da falso,
    // esto lo tomaba por «clic afuera» y cerraba el panel en el mismo gesto
    // que lo abría. La campanita simplemente no se abría nunca.
    // En captura, el DOM todavía está intacto.
    document.addEventListener('click', function (e) {
      if (!abierto) return;
      if (el.contains(e.target)) return;
      abierto = false; pintar();
    }, true);

    pintar(); pedir();
    var reloj = setInterval(function () { if (vivo) pedir(); }, 120000);
    return function () { vivo = false; clearInterval(reloj); el.innerHTML = ''; };
  }

  raiz.MaxRecuerda = { montar: montar, campanita: campanita, enPalabras: enPalabras, version: '1.0.0' };

  if (typeof module !== 'undefined' && module.exports) module.exports = raiz.MaxRecuerda;
})(typeof window !== 'undefined' ? window : this);
