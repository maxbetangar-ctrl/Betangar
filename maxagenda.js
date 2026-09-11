/* ==========================================================================
   MaxAgenda — la pantalla (ETAPA 2: se LEE y se reparten los permisos)
   ==========================================================================

   Una sola pieza, sin build y sin framework, que se monta igual en:
     · JS puro (Betangar, Flotilla, VIDECA, FlotaMax, Tony Gas)
           MaxAgenda.montar(document.getElementById('p-agenda'), {supabase});
     · React / Next.js (MaxPersonal, Geppetto, Ranita, MaxStock, MaxSalón)
           useEffect(() => MaxAgenda.montar(ref.current, {supabase}), []);
           // devuelve una función de desmontaje: se le pasa tal cual al return

   ETAPA 3 (10/09): ya se PROPONE, se RESPONDE y se AVISA. El botón «Nueva
   reunión» aparece solo si tenés agenda propia — si no, no hay desde dónde
   convocar, y un botón que no puede funcionar se ve igual que uno roto.

   ⛔ LO QUE TODAVÍA NO HACE: el choque de la SALA se muestra y se puede seguir
      igual o cambiar la hora, pero «unirme a la reunión que ya está» —la otra
      salida que pidió Máximo— es la etapa 4. No se dibuja lo que no existe.
      [[norma-la-puerta-que-no-existe]]

   ⛔ LA PRIVACIDAD NO ESTÁ ACÁ. Esta pantalla no esconde nada: lo que no podés
      ver no llega. `agn_dia()` devuelve `visibilidad` y los campos que no
      corresponden vienen en null desde la base. Si alguna vez hay que «ocultar»
      un campo en este archivo, el error está en la base y no acá.
   ========================================================================== */
(function (raiz) {
  'use strict';

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  var DIAS = ['domingo','lunes','martes','miércoles','jueves','viernes','sábado'];
  var MESES = ['enero','febrero','marzo','abril','mayo','junio','julio','agosto',
               'septiembre','octubre','noviembre','diciembre'];

  // ⚠️ dd/mm/yyyy SIEMPRE, y la fecha se arma con trozos de texto, NO con `new
  //    Date(iso)`: ahí un '2026-09-10' se interpreta en UTC y en Venezuela
  //    retrocede un día. [[norma-no-comparar-fechas-formateadas]]
  function hoyISO() {
    var d = new Date();
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' +
           String(d.getDate()).padStart(2, '0');
  }
  function partesISO(iso) {
    var p = String(iso || '').slice(0, 10).split('-');
    return { a: +p[0], m: +p[1], d: +p[2] };
  }
  function enLetras(iso) {
    var p = partesISO(iso);
    if (!p.a) return '';
    var js = new Date(p.a, p.m - 1, p.d);
    return DIAS[js.getDay()] + ' ' + String(p.d).padStart(2, '0') + '/' +
           String(p.m).padStart(2, '0') + '/' + p.a;
  }
  function corrido(iso, dias) {
    var p = partesISO(iso);
    var js = new Date(p.a, p.m - 1, p.d + dias);
    return js.getFullYear() + '-' + String(js.getMonth() + 1).padStart(2, '0') + '-' +
           String(js.getDate()).padStart(2, '0');
  }
  function hhmm(ts) { return String(ts || '').slice(11, 16); }
  function minutos(ts) {
    var h = String(ts || '').slice(11, 16).split(':');
    return (+h[0]) * 60 + (+h[1] || 0);
  }
  function duracion(a, b) {
    var m = minutos(b) - minutos(a);
    if (m < 0) m += 1440;                       // cruzó la medianoche
    if (m < 60) return m + ' min';
    var h = Math.floor(m / 60), r = m % 60;
    return h + ' h' + (r ? ' ' + r : '');
  }
  function iniciales(nombre) {
    var w = String(nombre || '').trim().split(/\s+/).filter(Boolean);
    if (!w.length) return '··';
    return (w[0][0] + (w.length > 1 ? w[w.length > 2 ? 2 : 1][0] : '')).toUpperCase();
  }

  // El nombre de nómina es el legal —cuatro palabras— y en una columna de la
  // rejilla no entra ni se lee. Se muestra nombre + primer apellido y el
  // completo queda en el `title`: se acorta lo que se VE, nunca el dato.
  function nombreCorto(nombre) {
    var w = String(nombre || '').trim().split(/\s+/).filter(Boolean);
    if (w.length <= 2) return w.join(' ');
    return w[0] + ' ' + w[w.length >= 4 ? 2 : 1];
  }

  var NIVELES = [
    ['nada',    'No la ve',                   'ni sabe que existís en la agenda'],
    ['ocupado', 'Solo cuándo estoy ocupado',  've bloques grises, sin título'],
    ['ver',     'Ve el detalle',              'lee el asunto, el lugar y quién va'],
    ['agendar', 'Ve el detalle y me agenda',  'además te propone reuniones']
  ];

  function montar(el, op) {
    op = op || {};
    var sb = op.supabase;
    if (!el) throw new Error('MaxAgenda: falta el elemento donde montarse.');
    if (!sb) throw new Error('MaxAgenda: falta el cliente de Supabase.');

    var est = {
      tab: 'mia',
      fecha: hoyISO(),
      cargando: true,
      diag: [],
      agendas: [],
      dia: [],
      yo: null,           // mi agenda, si tengo
      permAgenda: null,   // qué agenda se está repartiendo
      permisos: [],
      cambios: {},
      grupos: [],          // del directorio: «todos los choferes», etc.
      form: null,          // la reunión que se está escribiendo
      mover: null,         // la que se está moviendo
      borrar: null,        // la que se está por cancelar
      enviando: false,
      aviso: null,
      todoElDia: false,
      vivo: true
    };

    el.classList.add('mag');
    if (op.tema) el.setAttribute('data-mag-tema', op.tema);

    // ── Datos ──────────────────────────────────────────────────────────────
    // ⚠️ `agn_diagnostico()` se pide UNA sola vez, al montar, y no en cada
    //    refresco: prueba el trigger de verdad (escribe y deshace), así que
    //    llamarla cada vez que alguien cambia de día sería hacer trabajo de
    //    escritura para pintar una pantalla de lectura.
    function pedirDiag() {
      return sb.rpc('agn_diagnostico').then(function (r) {
        est.diag = r.data || [];
        if (r.error) est.diag.push({ pieza: 'diagnóstico', bien: false, detalle: r.error.message });
      });
    }

    function pedir() {
      return Promise.all([
        sb.rpc('agn_agendas_visibles'),
        sb.rpc('agn_dia', { p_fecha: est.fecha, p_agendas: null }),
        // Los grupos salen del DIRECTORIO, no de una lista clavada acá: cada
        // empresa tiene sus cargos y esta pantalla no puede saberlos.
        sb.rpc('grp_catalogo')
      ]).then(function (r) {
        est.agendas = r[0].data || [];
        est.dia = r[1].data || [];
        est.grupos = r[2].data || [];
        est.yo = est.agendas.filter(function (a) { return a.es_mia; })[0] || null;
        est.cargando = false;

        // ⛔ Un error de permisos NO puede verse igual que «no hay nada». Es la
        //    misma trampa que el rebote sin rastro: la pantalla vacía no dice
        //    si no te dejan o si no hay.
        var err = r.filter(function (x) { return x && x.error; })[0];
        if (err) est.diag = est.diag.concat([{ pieza: 'lectura', bien: false, detalle: err.error.message }]);
        return est;
      });
    }

    function refrescar() { return pedir().then(pintar); }

    // ── Pintar ─────────────────────────────────────────────────────────────
    function pintar() {
      if (!est.vivo) return;
      var rotos = est.diag.filter(function (d) { return !d.bien; });
      // ⛔ POR EVENTO, NO POR FILA. `agn_dia()` devuelve UNA fila por
      //    (agenda, evento): la misma reunión sale en la columna de cada
      //    invitado. Contar filas decía «2» cuando había UNA sola reunión
      //    esperando respuesta — un número que el que lo ve no puede explicar.
      var vistos = {};
      est.dia.forEach(function (e) {
        if (e.mi_respuesta === 'pendiente' && !e.soy_organizador) vistos[e.evento_id] = 1;
      });
      var esperan = Object.keys(vistos).length;

      var html =
        '<div class="mag-top">' +
          '<div>' +
            '<h2><span>🗓️</span> ' + esc(op.titulo || 'Agenda') + '</h2>' +
            '<div class="mag-sub">' +
              (est.yo ? esc(est.yo.nombre) + ' · ' : '') + esc(enLetras(est.fecha)) +
            '</div>' +
          '</div>' +
          '<div class="mag-top-der">' +
            '<div class="mag-fecha">' +
              '<button class="mag-btn" data-acc="ayer" title="El día anterior">‹</button>' +
              '<button class="mag-btn" data-acc="hoy">Hoy</button>' +
              '<button class="mag-btn" data-acc="manana" title="El día siguiente">›</button>' +
            '</div>' +
            '<button class="mag-btn" data-acc="refrescar" title="Actualizar">↻</button>' +
            // Solo con agenda propia: desde dónde se convoca es TU agenda.
            (est.yo ? '<button class="mag-btn mag-btn-p" data-acc="nueva">＋ Nueva reunión</button>' : '') +
          '</div>' +
        '</div>';

      // ⛔ Si el módulo no puede trabajar, LO GRITA arriba y en rojo. Un módulo
      //    roto con una pantalla prolija es peor que uno que no abre.
      if (rotos.length) {
        html +=
          '<div class="mag-roto"><b>⛔ La agenda no está trabajando bien</b>' +
            '<ul>' + rotos.map(function (d) {
              return '<li>' + esc(d.pieza) + ' — ' + esc(d.detalle) + '</li>';
            }).join('') + '</ul></div>';
      }

      html +=
        '<div class="mag-tabs" role="tablist">' +
          tab('mia', 'Mi agenda', esperan) +
          tab('dia', 'El día', 0) +
          tab('permisos', '¿Quién ve mi agenda?', 0) +
        '</div>';

      if (est.cargando) {
        html += '<div class="mag-cargando">Cargando la agenda…</div>';
      } else if (est.form)               { html += verNueva(); }
      else if (est.tab === 'mia')        { html += verMia(); }
      else if (est.tab === 'dia')        { html += verDia(); }
      else                               { html += verPermisos(); }

      el.innerHTML = html;
    }

    function tab(id, txt, pin) {
      return '<button class="mag-tab" role="tab" data-tab="' + id + '" aria-selected="' +
        (est.tab === id ? 'true' : 'false') + '">' + esc(txt) +
        (pin ? '<span class="mag-pin">' + pin + '</span>' : '') + '</button>';
    }

    // ── Mi agenda ──────────────────────────────────────────────────────────
    // ⛔ NI `confirm()` NI `prompt()`. Un diálogo del navegador tranca la
    //    pantalla, se ve distinto en cada teléfono y —lo que importa— no se
    //    puede leer: «¿Seguro?» a secas no dice a QUIÉN se le va a avisar que
    //    la reunión se cayó. Las dos cosas se preguntan acá adentro, con el
    //    nombre y la hora a la vista.
    function panelMover() {
      var m = est.mover;
      if (!m) return '';
      return '<div class="mag-nota">' +
        '<b>Mover «' + esc(m.titulo) + '»</b><br>' +
        'Los que ya habían aceptado vuelven a «pendiente» y se les pregunta otra vez: ' +
        'aceptaron <i>otra</i> hora.' +
        '<div class="mag-tres" style="margin-top:10px">' +
          '<label class="mag-campo"><span>Día</span>' +
            '<input class="mag-in" type="date" data-m="fecha" value="' + esc(m.fecha) + '"></label>' +
          '<label class="mag-campo"><span>Hora</span>' +
            '<input class="mag-in" type="time" data-m="hora" value="' + esc(m.hora) + '"></label>' +
        '</div>' +
        '<div class="mag-acc">' +
          '<button class="mag-btn mag-btn-p mag-btn-s" data-acc="mover-ok"' +
            (est.enviando ? ' disabled' : '') + '>' + (est.enviando ? 'Moviendo…' : 'Mover y volver a preguntar') + '</button>' +
          '<button class="mag-btn mag-btn-s" data-acc="mover-no">Dejarla como está</button>' +
        '</div></div>';
    }

    function panelCancelar() {
      var c = est.borrar;
      if (!c) return '';
      return '<div class="mag-roto">' +
        '<b>⛔ Cancelar «' + esc(c.titulo) + '»</b>' +
        '<div style="margin-top:5px;font-size:13px">Se le avisa por WhatsApp a los que ya habían ' +
        'dicho que iban, y el aviso previo NO va a salir.</div>' +
        '<div class="mag-acc">' +
          '<button class="mag-btn mag-btn-no mag-btn-s" data-acc="cancelar-ok"' +
            (est.enviando ? ' disabled' : '') + '>' + (est.enviando ? 'Cancelando…' : 'Sí, cancelarla') + '</button>' +
          '<button class="mag-btn mag-btn-s" data-acc="cancelar-no">No, dejarla</button>' +
        '</div></div>';
    }

    function verMia() {
      if (!est.yo) {
        // ⚠️ Dos motivos distintos y NO se pueden decir igual: o no te
        //    reconoce, o no te abrieron agenda. El que lee tiene que saber a
        //    quién pedirle qué.
        var reconocido = est.agendas.length > 0;
        return vacio('🙋',
          reconocido ? 'Todavía no tenés agenda abierta'
                     : 'No te tengo identificado',
          reconocido
            ? 'Las agendas se abren a quien las necesita. Pedile a Administración que te abra la tuya.'
            : 'Tu cuenta de usuario no está enganchada a una persona de la nómina, así que no puedo saber ' +
              'cuál es tu agenda. Lo arregla Administración en tu ficha de usuario.');
      }

      var mios = est.dia.filter(function (e) { return e.agenda_id === est.yo.agenda_id; });
      var cabeza = est.aviso
        ? '<div class="mag-aviso mag-aviso-' + (est.aviso.ok ? 'ok' : 'mal') + '">' +
          esc(est.aviso.txt) + '</div>' : '';
      if (!mios.length) {
        return vacio('☕', 'Nada anotado el ' + enLetras(est.fecha),
          'Ojo: «nada anotado» no es «libre». Solo significa que el sistema no tiene nada a esa hora.');
      }

      var espera = mios.filter(function (e) { return e.mi_respuesta === 'pendiente' && !e.soy_organizador; });
      var resto  = mios.filter(function (e) { return !(e.mi_respuesta === 'pendiente' && !e.soy_organizador); });

      var h = cabeza + panelMover() + panelCancelar();
      if (espera.length) {
        h += '<div class="mag-grupo-tit">Esperan tu respuesta · ' + espera.length + '</div>' +
             '<div class="mag-lista">' + espera.map(tarjeta).join('') + '</div>';
      }
      if (resto.length) {
        h += '<div class="mag-grupo-tit">' + esc(enLetras(est.fecha)) + '</div>' +
             '<div class="mag-lista">' + resto.map(tarjeta).join('') + '</div>';
      }
      return h;
    }

    function tarjeta(e) {
      var estado = e.mi_respuesta === 'pendiente' && !e.soy_organizador ? 'espera'
                 : e.estado === 'confirmado' ? 'confirmada'
                 : e.estado === 'no_realizado' ? 'caida' : 'propuesta';

      var pill = '';
      if (e.soy_obligatorio && e.mi_respuesta === 'pendiente') {
        pill = '<span class="mag-pill mag-pill-ob">Obligatorio</span>';
      } else if (e.pendientes > 0) {
        pill = '<span class="mag-pill mag-pill-es">Faltan ' + e.pendientes + ' por responder</span>';
      } else if (e.estado === 'confirmado') {
        pill = '<span class="mag-pill mag-pill-ok">Confirmada</span>';
      } else if (e.visibilidad === 'personal' || e.clase === 'personal') {
        pill = '<span class="mag-pill mag-pill-pe">Personal</span>';
      }

      var titulo = e.visibilidad === 'detalle' ? e.titulo
                 : e.visibilidad === 'personal' ? 'Algo personal suyo'
                 : 'Ocupado';

      var donde = [];
      if (e.recurso_nombre) donde.push(e.recurso_nombre);
      if (e.sitio) donde.push(e.sitio);
      if (e.enlace) donde.push('Videollamada');
      if (!donde.length && e.visibilidad !== 'detalle') {
        donde.push(e.visibilidad === 'personal'
          ? 'Los demás solo ven que estás ocupado'
          : 'No tenés permiso para ver de qué es');
      }

      var acc = '';
      if (e.visibilidad === 'detalle' && e.enlace) {
        acc += '<a class="mag-btn mag-btn-p mag-btn-s" target="_blank" rel="noopener noreferrer" href="' +
               esc(e.enlace) + '">Entrar</a>';
      }
      // Lo que espera TU respuesta: las mismas tres del WhatsApp, para que la
      // persona que ya está adentro de la app no tenga que ir a buscar el chat.
      if (e.mi_respuesta === 'pendiente' && !e.soy_organizador) {
        acc += '<button class="mag-btn mag-btn-ok mag-btn-s" data-resp="acepto" data-ev="' + e.evento_id + '">Acepto</button>' +
               '<button class="mag-btn mag-btn-no mag-btn-s" data-resp="no_puedo" data-ev="' + e.evento_id + '">No puedo</button>' +
               '<button class="mag-btn mag-btn-s" data-resp="otra_hora" data-ev="' + e.evento_id + '">Otra hora</button>';
      }
      // Mover y cancelar solo las tuyas: la de otro se le pide a quien la lleva.
      if (e.soy_organizador && e.estado !== 'cancelado') {
        acc += '<button class="mag-btn mag-btn-s" data-acc="mover" data-ev="' + e.evento_id + '">Mover</button>' +
               '<button class="mag-btn mag-btn-no mag-btn-s" data-acc="cancelar" data-ev="' + e.evento_id + '">Cancelar</button>';
      }

      return '<div class="mag-card" data-est="' + estado + '">' +
        '<div class="mag-hhmm"><div class="h">' + esc(hhmm(e.inicio)) + '</div>' +
          '<div class="d">' + esc(duracion(e.inicio, e.fin)) + '</div></div>' +
        '<div><h4>' + esc(titulo) + pill + '</h4>' +
          (donde.length ? '<div class="mag-donde">' + esc(donde.join(' · ')) + '</div>' : '') +
          (e.visibilidad === 'detalle' && e.organizador_nombre && !e.soy_organizador
            ? '<div class="mag-quienes">Te la propuso ' + esc(e.organizador_nombre) + '</div>' : '') +
          (e.visibilidad === 'detalle' && e.asistentes > 1
            ? '<div class="mag-quienes">' + e.asistentes + ' personas invitadas</div>' : '') +
          (e.visibilidad === 'detalle' && e.aviso_min != null
            ? '<div class="mag-quienes">Aviso ' + e.aviso_min + ' min antes' +
              // ⚠️ Se DICE cuándo saldría, sin pedir permiso ni retenerlo: la
              //    persona aceptó ESA reunión a ESA hora. Es la excepción a la
              //    franja 8:00–20:00, y se muestra para que no sorprenda.
              (function () {
                var m = minutos(e.inicio) - e.aviso_min;
                if (m < 0) m += 1440;
                var hh = String(Math.floor(m / 60)).padStart(2, '0') + ':' +
                         String(m % 60).padStart(2, '0');
                return (m < 8 * 60 || m >= 20 * 60)
                  ? ' — saldría ' + hh + ', fuera del horario habitual de envío' : '';
              })() + '</div>' : '') +
          (acc ? '<div class="mag-acc">' + acc + '</div>' : '') +
        '</div></div>';
    }

    // ── Nueva reunión ──────────────────────────────────────────────────────
    // ⛔ El lugar es OBLIGATORIO y lo dice la base: sin recurso, sin sitio y sin
    //    enlace, el WhatsApp diría «reunión a las 3» sin decir dónde, y el que lo
    //    recibe tendría que llamar por teléfono. Acá se avisa ANTES de intentar
    //    guardar, para que no llegue como un mensaje de PostgreSQL.
    var DURACIONES = [[30, '30 min'], [45, '45 min'], [60, '1 hora'],
                      [90, '1 h 30'], [120, '2 horas'], [180, '3 horas']];
    var AVISOS = [['', 'sin aviso'], [10, '10 min antes'], [15, '15 min antes'],
                  [30, '30 min antes'], [60, '1 hora antes'], [1440, '1 día antes']];

    function formNuevo() {
      return { titulo: '', fecha: est.fecha, hora: '09:00', dur: 60, clase: 'trabajo',
               recurso_id: '', sitio: '', enlace: '', aviso_min: 30, grupo_id: '',
               invitados: {}, obligatorios: {}, choques: null, error: null };
    }

    function campo(et, ctrl) {
      return '<label class="mag-campo"><span>' + esc(et) + '</span>' + ctrl + '</label>';
    }
    function sel(nombre, ops, valor) {
      return '<select class="mag-in" data-f="' + nombre + '">' + ops.map(function (o) {
        return '<option value="' + esc(o[0]) + '"' +
               (String(o[0]) === String(valor) ? ' selected' : '') + '>' + esc(o[1]) + '</option>';
      }).join('') + '</select>';
    }

    // ⚠️ Se DICE a qué hora saldría el aviso cuando cae fuera del horario
    //    habitual. No se retiene y no se pide permiso: la persona aceptó ESA
    //    reunión a ESA hora, y el aviso es suyo. Pero que no sorprenda a quien
    //    la convoca. Es la excepción escrita a la franja 8:00–20:00.
    function avisoFuera(f) {
      if (!f.aviso_min) return '';
      var m = minutos(f.fecha + ' ' + f.hora) - (+f.aviso_min);
      if (m < 0) m += 1440;
      if (m >= 8 * 60 && m < 20 * 60) return '';
      var hh = String(Math.floor(m / 60)).padStart(2, '0') + ':' + String(m % 60).padStart(2, '0');
      return '<div class="mag-nota">El aviso saldría a las <b>' + hh + '</b>, fuera del horario ' +
             'habitual de envío. <b>Sale igual</b>: la reunión es a esa hora y quien acepte lo sabe.</div>';
    }

    // ⛔ EL NÚMERO SE CANTA ANTES DE MANDAR, y se canta entero: no «le llega a
    //    15» sino «le llega a 15 de 35». La diferencia es la que deja ver el
    //    punto ciego — 20 personas que nadie va a alcanzar nunca, porque no
    //    tienen teléfono y se decidió dejarlo así. Un número sin su total
    //    parece completo.
    function alcanceGrupo(f) {
      if (!f.grupo_id) return '';
      var g = est.grupos.filter(function (x) { return String(x.grupo_id) === String(f.grupo_id); })[0];
      if (!g) return '';
      var fuera = g.total - g.alcanzables;
      return '<div class="mag-nota">A este grupo se le <b>avisa</b>: no se le pregunta si puede ' +
        'ni se le mira el choque de horario.<br>' +
        'Son <b>' + g.total + '</b> y el WhatsApp le llega a <b>' + g.alcanzables + '</b>.' +
        (fuera > 0
          ? '<br>⚠️ <b>' + fuera + ' no tienen teléfono cargado</b>: a ésos hay que avisarles por otra vía.'
          : '') + '</div>';
    }

    function verNueva() {
      var f = est.form;
      var personas = est.agendas.filter(function (a) { return a.clase === 'persona' && !a.es_mia; });
      var recursos = est.agendas.filter(function (a) { return a.clase === 'recurso'; });

      var h = '<div class="mag-top"><div><h2 style="font-size:17px">Nueva reunión</h2>' +
              '<div class="mag-sub">La convocás vos · ' + esc(est.yo ? est.yo.nombre : '') + '</div></div></div>';

      if (f.error) h += '<div class="mag-aviso mag-aviso-mal">' + esc(f.error) + '</div>';

      // ⛔ EL CHOQUE NO TRANCA: PREGUNTA. Que la sala esté ocupada no prueba que
      //    haya un error — «puede ser que precisamente no se sabía que se tenía
      //    esa reunión». Las dos salidas de acá son seguir igual o cambiar la
      //    hora; «unirme a la que ya está» es la etapa 4 y todavía no existe,
      //    así que no se dibuja.
      if (f.choques && f.choques.length) {
        h += '<div class="mag-roto"><b>⛔ A esa hora ya hay algo</b><ul>' +
          f.choques.map(function (c) {
            return '<li>' + esc(c.quien) + ' · ' + esc(hhmm(c.inicio)) + '–' + esc(hhmm(c.fin)) +
                   (c.titulo ? ' · ' + esc(c.titulo) : '') + '</li>';
          }).join('') + '</ul>' +
          '<div class="mag-acc">' +
            '<button class="mag-btn mag-btn-s" data-acc="form-igual">Proponerla igual</button>' +
            '<button class="mag-btn mag-btn-s mag-btn-p" data-acc="form-volver">Cambiar la hora</button>' +
          '</div></div>';
      }

      h += '<div class="mag-perm" style="padding:6px 15px 15px">' +
        campo('Asunto', '<input class="mag-in" data-f="titulo" value="' + esc(f.titulo) +
              '" placeholder="Junta directiva mensual" maxlength="140">') +
        '<div class="mag-tres">' +
          campo('Día', '<input class="mag-in" type="date" data-f="fecha" value="' + esc(f.fecha) + '">') +
          campo('Hora', '<input class="mag-in" type="time" data-f="hora" value="' + esc(f.hora) + '">') +
          campo('Dura', sel('dur', DURACIONES, f.dur)) +
        '</div>' +
        campo('Tipo', sel('clase', [['trabajo', 'De trabajo'],
              ['personal', 'Personal — los demás solo ven que estás ocupado']], f.clase)) +

        '<div class="mag-grupo-tit">Dónde · hace falta al menos uno</div>' +
        campo('Un recurso reservable', sel('recurso_id',
              [['', '— ninguno —']].concat(recursos.map(function (r) {
                return [String(r.agenda_id), r.nombre]; })), String(f.recurso_id))) +
        campo('Un sitio, escrito a mano', '<input class="mag-in" data-f="sitio" value="' + esc(f.sitio) +
              '" placeholder="Panadería La Esquina, av. Principal">') +
        campo('Un enlace de videollamada', '<input class="mag-in" data-f="enlace" value="' + esc(f.enlace) +
              '" placeholder="https://…">') +

        '<div class="mag-grupo-tit">Quiénes</div>' +
        (personas.length
          ? personas.map(function (a) {
              var va = !!f.invitados[a.persona_id];
              return '<div class="mag-fila">' +
                '<div class="mag-ini">' + esc(iniciales(a.nombre)) + '</div>' +
                '<div><div class="nom">' + esc(nombreCorto(a.nombre)) + '</div>' +
                  '<div class="ayuda">' + esc(etiquetaNivel(a.nivel)) + '</div></div>' +
                '<div class="mag-chks">' +
                  '<label class="mag-chk"><input type="checkbox" data-inv="' + esc(a.persona_id) + '"' +
                    (va ? ' checked' : '') + '> va</label>' +
                  '<label class="mag-chk"><input type="checkbox" data-obl="' + esc(a.persona_id) + '"' +
                    (f.obligatorios[a.persona_id] ? ' checked' : '') + (va ? '' : ' disabled') +
                    '> obligatorio</label>' +
                '</div></div>';
            }).join('')
          : '<div class="mag-vacio" style="padding:16px"><div class="q">No hay otras agendas abiertas ' +
            'todavía. Se abren desde Administración.</div></div>') +

        '<div class="mag-grupo-tit">O convocar a un grupo entero</div>' +
        campo('Convocar a', sel('grupo_id',
              [['', '— a nadie —']].concat(est.grupos.map(function (x) {
                return [String(x.grupo_id),
                        x.nombre + '  (' + x.total + ' personas · le llega a ' + x.alcanzables + ')'];
              })), String(f.grupo_id))) +
        alcanceGrupo(f) +

        '<div class="mag-grupo-tit">Aviso</div>' +
        campo('Avisar por WhatsApp', sel('aviso_min', AVISOS, String(f.aviso_min))) +
        avisoFuera(f) +
      '</div>';

      h += '<div class="mag-acc">' +
        '<button class="mag-btn mag-btn-p" data-acc="form-guardar"' + (est.enviando ? ' disabled' : '') + '>' +
          (est.enviando ? 'Guardando…' : 'Proponer y avisar') + '</button>' +
        '<button class="mag-btn" data-acc="form-cerrar">Cancelar</button>' +
      '</div>';
      return h;
    }

    function guardarForm(igual) {
      var f = est.form;
      f.error = null; f.choques = null;
      if (!f.titulo.trim()) { f.error = 'Falta el asunto.'; pintar(); return; }
      if (!f.recurso_id && !f.sitio.trim() && !f.enlace.trim()) {
        f.error = 'Falta el lugar: un recurso, un sitio escrito a mano o un enlace.';
        pintar(); return;
      }

      var ini = f.fecha + ' ' + f.hora;
      var m = minutos(ini) + (+f.dur);
      var finFecha = f.fecha, mm = m;
      // Una reunión puede cruzar la medianoche: no hay horario laboral.
      if (m >= 1440) { finFecha = corrido(f.fecha, 1); mm = m - 1440; }
      var fin = finFecha + ' ' + String(Math.floor(mm / 60)).padStart(2, '0') + ':' +
                String(mm % 60).padStart(2, '0');

      var asistentes = Object.keys(f.invitados)
        .filter(function (k) { return f.invitados[k]; })
        .map(function (k) { return { persona_id: k, obligatorio: !!f.obligatorios[k] }; });

      est.enviando = true; pintar();
      sb.rpc('agn_guardar', { p: {
        titulo: f.titulo.trim(), inicio: ini, fin: fin, clase: f.clase,
        recurso_id: f.recurso_id || null,
        sitio: f.sitio.trim() || null, enlace: f.enlace.trim() || null,
        aviso_min: f.aviso_min ? +f.aviso_min : null,
        asistentes: asistentes,
        igual_encimo: !!igual
      } }).then(function (r) {
        est.enviando = false;
        if (r.error) { f.error = r.error.message; pintar(); return; }
        var d = r.data || {};
        if (!d.ok) {
          if (d.motivo === 'choque') { f.choques = d.choques || []; pintar(); return; }
          f.error = d.motivo || 'No se pudo guardar.'; pintar(); return;
        }
        // Guardar y avisar son DOS cosas: si el aviso falla, la reunión ya está
        // guardada y no se pierde. Y se dice a cuántos de cuántos les llegó.
        sb.rpc('agn_invitar', { p_evento_id: d.id }).then(function (i) {
          var q = i.data || {};
          var txt = i.error
            ? 'La reunión quedó guardada, pero la invitación no salió: ' + i.error.message
            : 'Propuesta. Invitación enviada a ' + (q.enviadas || 0) + ' de ' + (q.total || 0) +
              ((q.sin_canal || 0) > 0
                ? ' — ' + q.sin_canal + ' sin teléfono al que escribirle' : '') + '.';

          if (!f.grupo_id) {
            est.form = null;
            est.aviso = { ok: !i.error, txt: txt };
            refrescar();
            return;
          }
          // La convocatoria va DESPUÉS y por separado: si falla, la reunión ya
          // está guardada y las invitaciones ya salieron. Son dos cosas.
          sb.rpc('agn_convocar', { p_evento_id: d.id, p_grupo_id: +f.grupo_id })
            .then(function (c) {
              var v = c.data || {};
              est.form = null;
              est.aviso = { ok: !c.error,
                txt: c.error
                  ? txt + ' La convocatoria NO salió: ' + c.error.message
                  : txt + ' Convocados «' + v.grupo + '»: le llega a ' + v.avisados +
                    ' de ' + v.total +
                    ((v.sin_canal || 0) > 0
                      ? ' — ' + v.sin_canal + ' sin teléfono, hay que avisarles por otra vía' : '') +
                    '. Sale por el carril de fondo, sin trabar los avisos urgentes.' };
              refrescar();
            });
        });
      });
    }

    // ── El día ─────────────────────────────────────────────────────────────
    function verDia() {
      if (!est.agendas.length) {
        return vacio('🚪', 'No ves ninguna agenda',
          'O todavía no hay ninguna abierta, o no te dieron permiso sobre ninguna.');
      }

      // La franja se calcula de lo que HAY, no de un horario laboral que no
      // existe (decisión de Máximo: «puedo cuadrar una cena a las 10 pm»).
      var desde = 8, hasta = 19;
      if (est.todoElDia) { desde = 0; hasta = 24; }
      else {
        est.dia.forEach(function (e) {
          desde = Math.min(desde, Math.floor(minutos(e.inicio) / 60));
          hasta = Math.max(hasta, Math.ceil(minutos(e.fin) / 60));
        });
        desde = Math.max(0, desde); hasta = Math.min(24, Math.max(hasta, desde + 1));
      }
      var filas = hasta - desde;

      var horas = '<div class="mag-horas"><div class="mag-cabeza"></div><div class="mag-pista">';
      for (var i = desde; i < hasta; i++) {
        horas += '<div class="mag-hfila">' + String(i).padStart(2, '0') + ':00</div>';
      }
      horas += '</div></div>';

      var cols = est.agendas.map(function (a) {
        var suyos = est.dia.filter(function (e) { return e.agenda_id === a.agenda_id; });
        var pista = '';
        for (var i = 0; i < filas; i++) pista += '<div class="mag-hlinea"></div>';
        pista += suyos.map(function (e) { return bloque(e, desde, a); }).join('');

        return '<div class="mag-col" data-clase="' + esc(a.clase) + '" data-mia="' +
          (a.es_mia ? '1' : '0') + '">' +
          '<div class="mag-cabeza">' +
            '<div class="mag-ini">' + esc(a.clase === 'recurso' ? '▦' : iniciales(a.nombre)) + '</div>' +
            '<div><div class="n" title="' + esc(a.nombre) + '">' +
              esc(a.clase === 'recurso' ? a.nombre : nombreCorto(a.nombre)) + '</div>' +
              '<div class="v">' + esc(a.es_mia ? 'tu agenda' : etiquetaNivel(a.nivel)) + '</div></div>' +
          '</div>' +
          '<div class="mag-pista">' + pista + '</div></div>';
      }).join('');

      return '<div class="mag-rejilla-wrap"><div class="mag-rejilla">' + horas + cols + '</div></div>' +
        '<div class="mag-pie-rejilla">' +
          '<span>Se muestra de ' + String(desde).padStart(2, '0') + ':00 a ' +
            String(hasta).padStart(2, '0') + ':00 — que es lo que hay hoy. ' +
            'No hay horario de trabajo: la hora la decide quien acepta.</span>' +
          '<button class="mag-btn mag-btn-s" data-acc="24h">' +
            (est.todoElDia ? 'Volver a la franja con algo' : 'Ver las 24 h') + '</button>' +
        '</div>';
    }

    function bloque(e, desde, a) {
      var ini = minutos(e.inicio), fin = minutos(e.fin);
      if (fin <= ini) fin = ini + 30;                 // cruzó la medianoche: se corta en el día
      var top = ((ini - desde * 60) / 60);
      var alto = Math.max((fin - ini) / 60, 0.45);    // mínimo legible, pero lo dice el texto
      var titulo, sub;

      if (e.visibilidad === 'detalle') {
        titulo = e.titulo;
        sub = [e.recurso_nombre, e.sitio, e.enlace ? 'videollamada' : null]
                .filter(Boolean).join(' · ') || (e.asistentes > 1 ? e.asistentes + ' personas' : '');
      } else if (e.visibilidad === 'personal') {
        titulo = 'Ocupado';
        sub = 'algo personal suyo';
      } else {
        titulo = a.clase === 'recurso' ? 'Tomada' : 'Ocupado';
        sub = a.clase === 'recurso' && e.organizador_nombre
          ? 'la tiene ' + e.organizador_nombre
          : 'no tenés permiso para ver de qué es';
      }

      return '<div class="mag-bloque" data-v="' + esc(e.visibilidad) + '" data-est="' + esc(e.estado) + '"' +
        ' style="top:calc(' + top + ' * var(--mag-hora));height:calc(' + alto + ' * var(--mag-hora) - 3px)"' +
        ' title="' + esc(hhmm(e.inicio) + '–' + hhmm(e.fin) + ' · ' + titulo) + '">' +
        '<span class="t">' + esc(titulo) + '</span>' +
        (sub ? '<span class="s">' + esc(sub) + '</span>' : '') + '</div>';
    }

    function etiquetaNivel(n) {
      for (var i = 0; i < NIVELES.length; i++) if (NIVELES[i][0] === n) return NIVELES[i][1].toLowerCase();
      return n;
    }

    // ── ¿Quién ve mi agenda? ───────────────────────────────────────────────
    function verPermisos() {
      var cual = est.permAgenda || (est.yo && est.yo.agenda_id);
      if (!cual) {
        return vacio('🔐', 'No tenés agenda que repartir',
          'Los permisos se reparten sobre una agenda propia. Cuando te abran la tuya, esto se llena.');
      }

      var quien = est.agendas.filter(function (a) { return a.agenda_id === cual; })[0];
      var h = '';

      if (est.aviso) {
        h += '<div class="mag-aviso mag-aviso-' + (est.aviso.ok ? 'ok' : 'mal') + '">' +
             esc(est.aviso.txt) + '</div>';
      }

      h += '<div class="mag-top"><div><h2 style="font-size:17px">¿Quién ve ' +
           (quien && !quien.es_mia ? 'la agenda de ' + esc(quien.nombre) : 'mi agenda') + '?</h2>' +
           '<div class="mag-sub">Lo decidís vos, persona por persona.</div></div></div>';

      if (!est.permisos.length) {
        h += '<div class="mag-cargando">Cargando los permisos…</div>';
      } else {
        h += '<div class="mag-perm">' + est.permisos.map(function (p) {
          var nivel = est.cambios[p.persona_id] != null ? est.cambios[p.persona_id] : p.nivel;
          var ctrl = p.fijo
            ? '<span class="mag-fijo">Dueño del negocio · no se cambia</span>'
            : '<select data-persona="' + esc(p.persona_id) + '">' + NIVELES.map(function (n) {
                return '<option value="' + n[0] + '"' + (n[0] === nivel ? ' selected' : '') + '>' +
                       esc(n[1]) + '</option>';
              }).join('') + '</select>';

          return '<div class="mag-fila" data-fijo="' + (p.fijo ? '1' : '0') + '">' +
            '<div class="mag-ini">' + esc(iniciales(p.nombre)) + '</div>' +
            '<div><div class="nom">' + esc(p.nombre) + '</div>' +
              '<div class="ayuda">' + esc(p.fijo
                ? 'Ve tu agenda entera, incluido lo personal'
                : (p.explicito ? 'lo elegiste vos' : 'por omisión: ve cuándo estás ocupado')) +
              '</div></div>' + ctrl + '</div>';
        }).join('') + '</div>';
      }

      h += '<div class="mag-nota">' +
        '<b>Lo que marques como personal</b> sale como «Ocupado» para todos los demás, ' +
        'incluso para los que ven el detalle: sin el título y sin el lugar. Solo lo ve el dueño del negocio.<br>' +
        '<b>Para poder proponerte algo</b> hay que ver, al menos, cuándo estás ocupado — si no, ' +
        'propondría a ciegas.<br>' +
        '<b>Los cambios valen desde ya</b>, también para lo que ya está agendado.' +
        '</div>';

      var hay = Object.keys(est.cambios).length;
      h += '<div class="mag-acc">' +
        '<button class="mag-btn mag-btn-p" data-acc="guardar-perm"' + (hay ? '' : ' disabled') + '>' +
          (hay ? 'Guardar ' + hay + ' cambio' + (hay > 1 ? 's' : '') : 'Guardar') + '</button>' +
        '<button class="mag-btn" data-acc="cancelar-perm">' + (hay ? 'Descartar' : 'Volver') + '</button>' +
        '</div>';
      return h;
    }

    function vacio(ic, tit, q) {
      return '<div class="mag-vacio"><span class="ic">' + ic + '</span><b>' + esc(tit) +
             '</b><div class="q">' + esc(q) + '</div></div>';
    }

    function cargarPermisos() {
      var cual = est.permAgenda || (est.yo && est.yo.agenda_id);
      if (!cual) { pintar(); return Promise.resolve(); }
      est.permisos = []; est.cambios = {};
      pintar();
      return sb.rpc('agn_permisos_de', { p_agenda_id: cual }).then(function (r) {
        if (r.error) {
          est.aviso = { ok: false, txt: 'No pude leer los permisos: ' + r.error.message };
          est.permisos = [];
        } else {
          est.permisos = r.data || [];
        }
        pintar();
      });
    }

    // ── Clics ──────────────────────────────────────────────────────────────
    // ⚠️ `input` guarda y NO repinta: repintar en cada tecla rehace el HTML y el
    //    cursor se va al principio de la caja. Repintar es cosa del `change`.
    el.addEventListener('input', function (ev) {
      var t = ev.target;
      if (!t || !t.getAttribute) return;
      var f = t.getAttribute('data-f');
      if (f && est.form) est.form[f] = t.value;
      var m = t.getAttribute('data-m');
      if (m && est.mover) est.mover[m] = t.value;
    });

    el.addEventListener('change', function (ev) {
      var t = ev.target;
      if (t && t.getAttribute) {
        var campoF = t.getAttribute('data-f');
        if (campoF && est.form) { est.form[campoF] = t.value; pintar(); return; }
        var campoM = t.getAttribute('data-m');
        if (campoM && est.mover) { est.mover[campoM] = t.value; pintar(); return; }
        var inv = t.getAttribute('data-inv');
        if (inv && est.form) {
          est.form.invitados[inv] = t.checked;
          // Dejar «obligatorio» marcado para alguien que ya no va sería una
          // casilla que dice una cosa y significa otra.
          if (!t.checked) delete est.form.obligatorios[inv];
          pintar(); return;
        }
        var obl = t.getAttribute('data-obl');
        if (obl && est.form) { est.form.obligatorios[obl] = t.checked; pintar(); return; }
      }

      var s = ev.target.closest && ev.target.closest('select[data-persona]');
      if (!s) return;
      var pid = s.getAttribute('data-persona');
      var original = est.permisos.filter(function (p) { return p.persona_id === pid; })[0];
      // Si lo dejó como estaba, NO es un cambio: guardar lo mismo reescribiría
      // `puesto_at` y ese campo dejaría de decir cuándo cambió de verdad.
      if (original && original.nivel === s.value) delete est.cambios[pid];
      else est.cambios[pid] = s.value;
      pintar();
    });

    el.addEventListener('click', function (ev) {
      // Responder a una invitación desde adentro de la app: la misma respuesta
      // que el enlace del WhatsApp, por la misma puerta.
      var rb = ev.target.closest && ev.target.closest('button[data-resp]');
      if (rb) {
        var evId = +rb.getAttribute('data-ev');
        var resp = rb.getAttribute('data-resp');
        rb.disabled = true; rb.textContent = '…';
        sb.rpc('agn_responder_yo', { p_evento_id: evId, p_respuesta: resp, p_nota: null })
          .then(function (r) {
            var d = (r.data || {});
            if (r.error || !d.ok) {
              // ⛔ Un choque no es un error: es una respuesta, y se dice entera.
              est.aviso = { ok: false, txt: d.texto || (r.error && r.error.message) ||
                            'No se pudo registrar la respuesta.' };
            } else {
              est.aviso = { ok: true, txt: resp === 'acepto' ? 'Quedó anotado que asistís.'
                          : resp === 'no_puedo' ? 'Avisado: no podés. Se lo dijimos a quien convocó.'
                          : 'Avisado: pedís otra hora. Se lo dijimos a quien convocó.' };
            }
            refrescar();
          });
        return;
      }

      var t = ev.target.closest && ev.target.closest('[data-tab],[data-acc]');
      if (!t) return;

      var tb = t.getAttribute('data-tab');
      if (tb) {
        est.tab = tb; est.aviso = null;
        if (tb === 'permisos') { cargarPermisos(); } else { pintar(); }
        return;
      }

      var acc = t.getAttribute('data-acc');
      if (acc === 'ayer')      { est.fecha = corrido(est.fecha, -1); refrescar(); }
      else if (acc === 'manana'){ est.fecha = corrido(est.fecha, 1);  refrescar(); }
      else if (acc === 'hoy')  { est.fecha = hoyISO();                refrescar(); }
      else if (acc === 'refrescar') { refrescar(); }
      else if (acc === '24h')  { est.todoElDia = !est.todoElDia; pintar(); }

      // ── Nueva reunión ─────────────────────────────────────────────────────
      else if (acc === 'nueva')        { est.aviso = null; est.form = formNuevo(); pintar(); }
      else if (acc === 'form-cerrar')  { est.form = null; pintar(); }
      else if (acc === 'form-volver')  { est.form.choques = null; pintar(); }
      else if (acc === 'form-guardar') { guardarForm(false); }
      else if (acc === 'form-igual')   { guardarForm(true); }

      // ── Mover ─────────────────────────────────────────────────────────────
      else if (acc === 'mover') {
        var e1 = est.dia.filter(function (x) { return x.evento_id === +t.getAttribute('data-ev'); })[0];
        if (!e1) return;
        est.borrar = null;
        est.mover = { ev: e1.evento_id, titulo: e1.titulo || 'la reunión',
                      fecha: String(e1.inicio).slice(0, 10), hora: hhmm(e1.inicio) };
        pintar();
      }
      else if (acc === 'mover-no') { est.mover = null; pintar(); }
      else if (acc === 'mover-ok') {
        var m = est.mover;
        est.enviando = true; pintar();
        sb.rpc('agn_mover', { p_evento_id: m.ev, p_inicio: m.fecha + ' ' + m.hora, p_fin: null })
          .then(function (r) {
            est.enviando = false;
            var d = (r.data || {});
            if (r.error || !d.ok) {
              est.aviso = { ok: false, txt: d.motivo === 'choque'
                ? 'A esa hora ya hay algo. Elegí otra.'
                : (r.error && r.error.message) || 'No se pudo mover.' };
              pintar(); return;
            }
            est.mover = null;
            est.aviso = { ok: true, txt: 'Movida al ' + d.movida_a + '. Vuelven a pendiente ' +
              d.volvieron_a_pendiente + ' y se les preguntó de nuevo' +
              (d.organizador_aceptado === false
                ? '. ⚠️ Vos quedaste en pendiente: a esa hora tenías otra cosa aceptada' : '') + '.' };
            refrescar();
          });
      }

      // ── Cancelar ──────────────────────────────────────────────────────────
      else if (acc === 'cancelar') {
        var e2 = est.dia.filter(function (x) { return x.evento_id === +t.getAttribute('data-ev'); })[0];
        if (!e2) return;
        est.mover = null;
        est.borrar = { ev: e2.evento_id, titulo: e2.titulo || 'la reunión' };
        pintar();
      }
      else if (acc === 'cancelar-no') { est.borrar = null; pintar(); }
      else if (acc === 'cancelar-ok') {
        var c = est.borrar;
        est.enviando = true; pintar();
        sb.rpc('agn_cancelar', { p_evento_id: c.ev, p_motivo: null }).then(function (r) {
          est.enviando = false; est.borrar = null;
          var d = (r.data || {});
          est.aviso = (r.error || !d.ok)
            ? { ok: false, txt: (r.error && r.error.message) || 'No se pudo cancelar.' }
            : { ok: true, txt: 'Cancelada. Avisados ' + (d.avisados || 0) +
                ' de los que habían aceptado, y el aviso previo ya no va a salir.' };
          refrescar();
        });
      }
      else if (acc === 'cancelar-perm') {
        if (Object.keys(est.cambios).length) { est.cambios = {}; est.aviso = null; pintar(); }
        else { est.tab = 'mia'; est.aviso = null; pintar(); }   // ⚠️ TODA pantalla tiene salida
      }
      else if (acc === 'guardar-perm') {
        var cual = est.permAgenda || (est.yo && est.yo.agenda_id);
        var pares = Object.keys(est.cambios).map(function (k) { return [k, est.cambios[k]]; });
        if (!pares.length || !cual) return;
        t.disabled = true; t.textContent = 'Guardando…';

        // Uno por uno y a propósito: si uno falla, los demás ya quedaron, y la
        // pantalla tiene que decir CUÁL falló. Un «no se pudo guardar» que no
        // dice qué quedó y qué no obliga a recargar para saber dónde estás.
        Promise.all(pares.map(function (p) {
          return sb.rpc('agn_fijar_permiso',
            { p_agenda_id: cual, p_persona_id: p[0], p_nivel: p[1] })
            .then(function (r) { return { pid: p[0], error: r.error }; });
        })).then(function (rs) {
          var malos = rs.filter(function (x) { return x.error; });
          if (malos.length) {
            var nom = function (pid) {
              var q = est.permisos.filter(function (p) { return p.persona_id === pid; })[0];
              return q ? q.nombre : pid;
            };
            est.aviso = { ok: false, txt: 'No se guardaron ' + malos.length + ': ' +
              malos.map(function (x) { return nom(x.pid) + ' (' + x.error.message + ')'; }).join('; ') };
          } else {
            est.aviso = { ok: true, txt: 'Guardado. Vale desde ya, también para lo que ya está agendado.' };
          }
          return cargarPermisos();
        });
      }
    });

    pintar();
    // ⛔ EL AUTODIAGNÓSTICO NO VA EN EL CAMINO DE ABRIR LA PANTALLA.
    //    Medido el 11/09/2026 contra la base real: `agn_diagnostico()` tarda
    //    **7,6 segundos** — prueba los triggers de verdad, escribiendo y
    //    deshaciendo. Y acá se lo esperaba ANTES de cargar y pintar, así que
    //    la agenda tardaba eso en aparecer… y cuando la base estaba un poco
    //    cargada se pasaba del tope de 8 s y la pantalla moría con
    //    «canceling statement due to statement timeout».
    //    Eso fue lo que reportó Alejandra: «dice que la agenda no está
    //    trabajando bien». No estaba rota: estaba esperando su propio examen.
    // ⇒ Primero se carga y se pinta. El diagnóstico va DETRÁS y, si falla, se
    //   anota como un chequeo más — nunca deja la pantalla sin abrir.
    refrescar();
    pedirDiag().then(pintar).catch(function (e) {
      est.diag = (est.diag || []).concat([{ pieza: 'diagnóstico', bien: false,
        detalle: 'no se pudo correr: ' + ((e && e.message) || e) }]);
      pintar();
    });

    est.vivo = true;
    return function desmontar() {
      est.vivo = false;
      el.innerHTML = '';
      el.classList.remove('mag');
    };
  }

  raiz.MaxAgenda = { montar: montar, version: '0.2.0' };
  if (typeof module !== 'undefined' && module.exports) module.exports = raiz.MaxAgenda;
})(typeof window !== 'undefined' ? window : globalThis);
