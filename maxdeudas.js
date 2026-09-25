/* ==========================================================================
   MaxDeudas — financiamientos y su cuadro de amortización
   ==========================================================================
   Una sola pieza, sin build y sin framework, que se monta igual en:
     · JS puro (Betangar, Flotilla, VIDECA, FlotaMax, Tony Gas)
           MaxDeudas.montar(document.getElementById('p-deudas'), {supabase});
     · React / Next.js (MaxPersonal, Geppetto, Ranita, MaxStock, MaxSalón)
           useEffect(() => MaxDeudas.montar(ref.current, {supabase}), []);

   Máximo, 24/09/2026: «tengo un cuadro de excel de esa deuda de los camiones
   que quisiera que esa información me la muestre el sistema de betangar, que
   exista un módulo que puede o no pueda meterlo en los otros software tipo
   lego, donde lleve deudas de bancos».

   ⛔ ESTA PANTALLA NO CALCULA NADA. La cuota, la amortización, lo vencido y el
      saldo salen de `deuda_amortizacion()` y `deuda_estado()`. Si un número se
      calculara acá, en un mes habría dos verdades: la de la base y la de la
      pantalla. [[norma-dos-listas-a-mano-se-desincronizan]]

   ⛔ LO PRIMERO QUE SE VE ES LO QUE DUELE. Las cuotas vencidas arriba y en
      rojo, antes que el saldo: un vencimiento enterrado en una tabla de 18
      filas es un vencimiento que nadie mira. Hoy son 2 por US$ 29.184,64.

   ⚠️ UN ERROR DE PERMISOS NO PUEDE VERSE IGUAL QUE «NO HAY NADA». Si la
      consulta falla, se dice; la pantalla vacía no distingue «no te dejan ver»
      de «no hay deudas». Es lo que se arregló el mismo día en las 8 funciones
      financieras de Betangar, que devolvían cero filas sin avisar.
   ========================================================================== */
(function (raiz) {
  'use strict';

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  // Los montos van SIEMPRE con separador de miles. Un número largo sin puntos
  // se lee mal y un cero de más pasa desapercibido — el mismo criterio que los
  // litros del chofer, que ya costó una carga de 25.115 L.
  function m2(n) {
    var v = Number(n);
    if (!isFinite(v)) return '—';
    return v.toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }
  function fechaVE(iso) {
    if (!iso) return '—';
    var p = String(iso).slice(0, 10).split('-');
    return p.length === 3 ? p[2] + '/' + p[1] + '/' + p[0] : String(iso);
  }
  // ⛔ Se compara contra HOY en fecha, no en texto: comparar fechas formateadas
  //    es una de las trampas que esta casa ya pagó.
  function diasHasta(iso) {
    if (!iso) return null;
    var h = new Date(); h.setHours(0, 0, 0, 0);
    var d = new Date(String(iso).slice(0, 10) + 'T00:00:00');
    return Math.round((d - h) / 86400000);
  }

  function montar(el, op) {
    op = op || {};
    var sb = op.supabase;
    if (!el) return function () {};
    if (!sb) { el.innerHTML = '<div class="mdz-vacio">Falta la conexión a la base.</div>'; return function () {}; }

    var est = { vivo: true, cargando: true, puede: false, puedeCargar: false, deudas: [], sel: null,
                estado: null, tabla: [], abonos: [], origenes: [], compras: [], error: null,
                form: { abierto: false, guardando: false, error: null, dup: null, ok: null, valores: null } };
    el.classList.add('mdz');

    // ⛔ SE PREGUNTA PRIMERO SI PUEDE VER. Las tablas tienen RLS, y una RLS que
    //    no deja pasar devuelve CERO FILAS, no un error: sin esto, «no te dejan
    //    ver» y «no hay deudas» se verian exactamente igual. Es el defecto que se
    //    corrigio el mismo dia en las 8 funciones financieras de Betangar.
    // ⛔ SON DOS PREGUNTAS DISTINTAS Y SE HACEN LAS DOS. Ver la deuda lo puede
    //    hacer un directivo o la auditora externa; cargarle un abono, no. Si la
    //    pantalla asumiera que quien ve puede cargar, le mostraria el boton a
    //    gente que va a recibir un «no tiene permiso» despues de escribir todo.
    function pedirPermiso() {
      return Promise.all([sb.rpc('deuda_puede_ver'), sb.rpc('deuda_puede_cargar')])
        .then(function (r) {
          if (r[0].error) throw r[0].error;
          est.puede = r[0].data === true;
          // ⚠️ Que ESTA falle no puede tumbar la pantalla: se lee igual, sin el
          //    boton. Un modulo LEGO cae en apps donde la funcion puede no estar.
          est.puedeCargar = !r[1].error && r[1].data === true;
        });
    }

    // Lo que necesita el formulario: los origenes y las compras de dolares. Solo
    // se piden si hay algo que cargar — a quien solo mira no se le gasta el viaje.
    function pedirParaElForm() {
      if (!est.puedeCargar) return Promise.resolve();
      return Promise.all([sb.rpc('deuda_origenes'), sb.rpc('deuda_compras_disponibles')])
        .then(function (r) {
          est.origenes = (!r[0].error && r[0].data) || [];
          est.compras  = (!r[1].error && r[1].data) || [];
        });
    }

    function pedirLista() {
      if (!est.puede) return Promise.resolve();
      return sb.from('deuda_financiamientos').select('*').order('id')
        .then(function (r) {
          if (r.error) throw r.error;
          est.deudas = r.data || [];
          if (!est.sel && est.deudas.length) est.sel = est.deudas[0].id;
        });
    }

    function pedirDetalle() {
      if (!est.sel) return Promise.resolve();
      return Promise.all([
        sb.rpc('deuda_estado', { p_deuda: est.sel }),
        sb.rpc('deuda_amortizacion', { p_deuda: est.sel }),
        sb.from('deuda_abonos').select('*').eq('deuda_id', est.sel).order('fecha'),
        sb.rpc('deuda_cuotas', { p_deuda: est.sel })
      ]).then(function (r) {
        // ⛔ Un error de cualquiera de las tres se DICE. Antes se mostraba la
        //    pantalla a medias y parecía que no había datos.
        var err = r.filter(function (x) { return x && x.error; })[0];
        if (err) throw err.error;
        est.estado = (r[0].data || [])[0] || null;
        est.tabla = r[1].data || [];
        est.abonos = r[2].data || [];
        est.cuotas = (r[3] && r[3].data && r[3].data[0]) || null;
      });
    }

    function refrescar() {
      est.cargando = true; est.error = null; pintar();
      return pedirPermiso().then(pedirLista).then(pedirDetalle).then(pedirParaElForm)
        .catch(function (e) { est.error = (e && (e.message || e.hint)) || String(e); })
        .then(function () { est.cargando = false; pintar(); });
    }

    function pintar() {
      if (!est.vivo) return;

      if (est.cargando) { el.innerHTML = '<div class="mdz-vacio">Cargando…</div>'; return; }

      if (est.error) {
        el.innerHTML = '<div class="mdz-error"><b>No se pudo leer el módulo de deudas.</b>' +
          '<div class="mdz-err-d">' + esc(est.error) + '</div>' +
          '<div class="mdz-err-n">Esto NO quiere decir que no haya deudas: quiere decir que la consulta falló.</div></div>';
        return;
      }

      if (!est.puede) {
        el.innerHTML = '<div class="mdz-error"><b>Este módulo no está disponible para su usuario.</b>' +
          '<div class="mdz-err-n">No es que no haya deudas cargadas: es que este usuario no tiene permiso ' +
          'para ver la información financiera. Lo habilita quien administre los accesos.</div></div>';
        return;
      }

      if (!est.deudas.length) {
        el.innerHTML = '<div class="mdz-vacio"><div class="q">No hay financiamientos cargados.</div>' +
          '<div class="s">Cuando se cargue uno, acá se ve su cuadro de amortización, lo abonado y lo que vence.</div></div>';
        return;
      }

      var d = est.deudas.filter(function (x) { return x.id === est.sel; })[0] || est.deudas[0];
      var e = est.estado || {};
      var venc = Number(e.cuotas_vencidas || 0);
      var dias = diasHasta(e.proxima_cuota);
      var pct = Number(e.total_a_pagar) > 0
        ? Math.round((Number(e.total_abonado) / Number(e.total_a_pagar)) * 100) : 0;

      var h = '';

      // ── Encabezado y, si hay más de un financiamiento, el selector ──────────
      h += '<div class="mdz-top"><div><h2>💳 ' + esc(d.acreedor) + '</h2>' +
        '<div class="mdz-sub">' + esc(d.concepto) +
           (d.deudor ? ' · deudor: ' + esc(d.deudor) : '') + '</div></div>';
      h += '<div class="mdz-top-der">';
      if (est.deudas.length > 1) {
        h += '<select class="mdz-sel" data-acc="cambiar">' + est.deudas.map(function (x) {
          return '<option value="' + x.id + '"' + (x.id === d.id ? ' selected' : '') + '>' + esc(x.acreedor) + '</option>';
        }).join('') + '</select>';
      }
      // El boton solo existe si la BASE dijo que si. Esconderlo no es el candado
      // —el candado esta en `deuda_abonar()`— pero mostrarselo a quien no puede
      // es mandarlo a llenar un formulario para que le digan que no.
      if (est.puedeCargar && !est.form.abierto) {
        h += '<button type="button" class="mdz-btn" data-acc="abrir">＋ Registrar abono</button>';
      }
      h += '</div></div>';

      if (est.form.ok) h += '<div class="mdz-ok">✅ ' + esc(est.form.ok) + '</div>';
      if (est.form.abierto) h += formHtml(d);

      // ── LO QUE DUELE, PRIMERO ──────────────────────────────────────────────
      if (venc > 0) {
        h += '<div class="mdz-alarma">🔴 <b>' + venc + ' cuota' + (venc > 1 ? 's' : '') + ' vencida' + (venc > 1 ? 's' : '') + '</b>' +
             ' · US$ ' + m2(e.monto_vencido) + ' sin pagar</div>';
      }

      // ── Las cifras ─────────────────────────────────────────────────────────
      h += '<div class="mdz-kpis">' +
        kpi('Saldo pendiente', 'US$ ' + m2(e.saldo_pendiente), 'de US$ ' + m2(e.total_a_pagar) + ' a pagar') +
        kpi('Abonado', 'US$ ' + m2(e.total_abonado), pct + '% del total') +
        kpi('Cuota mensual', 'US$ ' + m2(e.cuota_mensual), d.plazo_meses + ' cuotas · ' + (Number(d.tasa_anual) * 100).toFixed(0) + '% anual') +
        kpi('Próxima a vencer', fechaVE(e.proxima_cuota),
            dias === null ? '—' : (dias < 0 ? 'hace ' + Math.abs(dias) + ' días' : dias === 0 ? 'HOY' : 'en ' + dias + ' días'),
            dias !== null && dias >= 0 && dias <= 7 ? 'urge' : '') +
        '</div>';

      // ⚠️ Un abono sin origen declarado no es un detalle: es el renglón que
      //    impide cuadrar la deuda contra la plata que salió del banco.
      var sd = Number(e.abonos_sin_declarar || 0);
      if (sd > 0) {
        h += '<div class="mdz-aviso">⚠️ <b>' + sd + ' abono' + (sd > 1 ? 's' : '') + ' sin declarar de dónde salió la plata.</b> ' +
             'Sin eso, la deuda y el banco no se pueden cuadrar.</div>';
      }

      h += '<div class="mdz-barra"><div class="mdz-barra-in" style="width:' + Math.min(100, pct) + '%"></div></div>';

      // ⚠️ Las VENCIDAS van DENTRO de las por pagar: 4 + 14 = 18, no 4+2+14. Se
      //    escribe «de las cuales» para que nadie sume las tres y le den 20.
      var c = est.cuotas;
      if (c) {
        h += '<div class="mdz-cuotas">📋 <b>' + c.pagadas + ' de ' + c.total + '</b> cuotas pagadas · <b>' +
             c.por_pagar + '</b> por pagar' +
             (Number(c.vencidas) > 0 ? ' <span class="mdz-venc">(de las cuales ' + c.vencidas +
               ' vencida' + (Number(c.vencidas) > 1 ? 's' : '') + ')</span>' : '') + '</div>';
      }

      // ── La tabla ───────────────────────────────────────────────────────────
      h += '<h3 class="mdz-h3">Cuadro de amortización</h3>' +
        '<div class="mdz-scroll"><table class="mdz-tabla"><thead><tr>' +
        '<th>#</th><th>Vence</th><th class="n">Cuota</th><th class="n">Interés</th>' +
        '<th class="n">Capital</th><th class="n">Saldo</th><th class="n">Abonado</th>' +
        '<th class="n">Resta</th><th>Estado</th></tr></thead><tbody>';
      est.tabla.forEach(function (f) {
        var cls = f.estado === 'Pagada' ? 'ok' : f.estado === 'Vencida' ? 'mal' : '';
        h += '<tr class="' + cls + '"><td>' + f.nro + '</td><td>' + fechaVE(f.vencimiento) + '</td>' +
          '<td class="n">' + m2(f.cuota) + '</td><td class="n">' + m2(f.interes) + '</td>' +
          '<td class="n">' + m2(f.capital) + '</td><td class="n">' + m2(f.saldo) + '</td>' +
          '<td class="n">' + m2(f.abono_aplicado) + '</td><td class="n">' + m2(f.resta) + '</td>' +
          '<td><span class="mdz-est ' + cls + '">' + esc(f.estado) + '</span></td></tr>';
      });
      h += '</tbody></table></div>';

      // ── Los abonos, que son los hechos ─────────────────────────────────────
      h += '<h3 class="mdz-h3">Abonos registrados <span class="mdz-cnt">' + est.abonos.length + '</span></h3>';
      if (!est.abonos.length) {
        h += '<div class="mdz-vacio"><div class="q">Todavía no hay abonos cargados.</div></div>';
      } else {
        h += '<div class="mdz-scroll"><table class="mdz-tabla"><thead><tr>' +
          '<th>Fecha</th><th class="n">Monto</th><th>De dónde salió</th><th>Nota</th></tr></thead><tbody>';
        est.abonos.forEach(function (a) {
          var sinDecl = a.origen === 'sin_declarar';
          h += '<tr' + (sinDecl ? ' class="mal"' : '') + '><td>' + fechaVE(a.fecha) + '</td>' +
            '<td class="n">' + m2(a.monto) + '</td>' +
            '<td>' + (sinDecl ? '<span class="mdz-est mal">sin declarar</span>' : esc(a.origen).replace(/_/g, ' ')) + '</td>' +
            '<td class="mdz-nota">' + esc(a.nota || '') + '</td></tr>';
        });
        h += '</tbody></table></div>';
      }

      h += '<div class="mdz-pie">Los montos salen de <code>deuda_amortizacion()</code> y <code>deuda_estado()</code>. ' +
           'Esta pantalla no calcula: muestra.</div>';

      el.innerHTML = h;

      var s = el.querySelector('[data-acc="cambiar"]');
      if (s) s.addEventListener('change', function () { est.sel = Number(s.value); refrescar(); });

      var clic = function (acc, fn) {
        var b = el.querySelector('[data-acc="' + acc + '"]');
        if (b) b.addEventListener('click', fn);
      };
      clic('abrir',  function () { est.form.abierto = true; est.form.error = null; est.form.ok = null; est.form.valores = null; pintar(); });
      clic('cerrar', function () { est.form.abierto = false; est.form.error = null; pintar(); });
      clic('guardar', function () { guardar(false); });
      clic('forzar',  function () { guardar(true); });

      // El selector de la compra aparece y desaparece SIN repintar: repintar
      // aca borraria el monto y la nota que la persona ya escribio.
      var so = el.querySelector('#mdz-f-origen'), caja = el.querySelector('#mdz-f-mov-caja');
      if (so && caja) {
        var ver = function () {
          var o = so.options[so.selectedIndex];
          var pide = !!(o && o.getAttribute('data-mov'));
          caja.style.display = pide ? '' : 'none';
          if (!pide) { var mv = el.querySelector('#mdz-f-mov'); if (mv) mv.value = ''; }
        };
        so.addEventListener('change', ver);
        ver();
      }
    }

    // ═════════════════════════════════════════════════════════════════════════
    // EL FORMULARIO
    //
    // ⛔ NO VALIDA NADA POR SU CUENTA, y es a proposito. Los seis controles
    //    viven en `deuda_abonar()`, que es la unica puerta de escritura: si la
    //    pantalla repitiera las reglas, en un mes habria dos criterios y el de
    //    la pantalla seria el mentiroso. Lo que hace es MOSTRAR el mensaje que
    //    devuelve la base — ya esta escrito para una persona.
    //    [[norma-dos-listas-a-mano-se-desincronizan]]
    //
    // ⚠️ El maximo del campo fecha se arma en HORA LOCAL. Con `toISOString()`
    //    —que pasa a UTC— a las 20:30 de Venezuela el tope ya seria MAÑANA.
    //    [[norma-las-pruebas-corren-en-utc-como-vercel]]
    // ═════════════════════════════════════════════════════════════════════════
    function hoyLocal() {
      var d = new Date(), p2 = function (n) { return (n < 10 ? '0' : '') + n; };
      return d.getFullYear() + '-' + p2(d.getMonth() + 1) + '-' + p2(d.getDate());
    }

    function formHtml(d) {
      var f = est.form;
      var hoy = hoyLocal();
      // ⛔ LO QUE LA PERSONA ESCRIBIÓ NO SE BORRA CUANDO EL GUARDADO FALLA.
      //    `pintar()` rehace el HTML entero, así que sin esto los cinco campos
      //    volvían vacíos justo cuando hay que corregir UNO. Y era peor que
      //    molesto: el botón «cargarlo igual» del duplicado leía los campos ya
      //    vacíos y mandaba el monto en NULL, así que confirmar no cargaba nada
      //    y devolvía un error distinto. Lo cazó el banco de pruebas mirando lo
      //    que se ENVÍA, no solo que el botón existiera.
      //    [[norma-test-que-pasa-por-el-motivo-equivocado]]
      var v = f.valores || {};
      var val = function (k, x) { return esc(v[k] == null || v[k] === '' ? (x == null ? '' : x) : v[k]); };

      // Las compras de dolares, con lo que le queda libre a cada una. Las que no
      // sirven salen IGUAL pero apagadas y diciendo por que: una opcion que
      // desaparece deja al que carga buscando algo que el ve en su banco.
      var libreTotal = 0, conLibre = 0;
      var ops = est.compras.map(function (c) {
        var libre = Number(c.usd_libre);
        var motivo = c.problema ? c.problema
                   : (!(libre > 0.009) ? 'ya está aplicada entera' : null);
        if (!motivo) { libreTotal += libre; conLibre++; }
        // ⚠️ «quedan US$ X» solo se dice si algo YA se aplicó a esa compra. Hoy no
        //    hay ningún abono atado a su compra, así que el libre es igual al
        //    total: repetirlo al lado haría ver un dato donde no hay ninguno.
        var algoAplicado = Number(c.usd_aplicado) > 0.009;
        return '<option value="' + esc(c.mov_id) + '"' + (motivo ? ' disabled' : '') +
          (c.mov_id === v.p_mov_id ? ' selected' : '') + '>' +
          fechaVE(c.fecha) + ' · ' + esc(c.quien) + ' · US$ ' + m2(c.usd) +
          (motivo ? ' — ' + esc(motivo)
                  : (algoAplicado ? ' · quedan US$ ' + m2(libre) : '')) + '</option>';
      }).join('');

      var h = '<div class="mdz-form"><h3 class="mdz-form-t">Registrar un abono a ' + esc(d.acreedor) + '</h3>';

      if (f.error) {
        h += '<div class="mdz-form-err"><b>No se guardó.</b><div>' + esc(f.error) + '</div>' +
             (f.dup ? '<button type="button" class="mdz-btn mdz-btn-peligro" data-acc="forzar">' +
                      'Sí, son dos pagos distintos — cargarlo igual</button>' : '') + '</div>';
      }

      h += '<div class="mdz-campos">' +
        campo('Fecha del pago', '<input type="date" id="mdz-f-fecha" class="mdz-in" max="' + hoy + '" value="' + val('p_fecha', hoy) + '">') +
        campo('Monto en US$', '<input type="number" id="mdz-f-monto" class="mdz-in" step="0.01" min="0" placeholder="0,00" value="' + val('p_monto') + '">') +
        campo('De dónde salió la plata',
          '<select id="mdz-f-origen" class="mdz-in">' +
          est.origenes.map(function (o) {
            return '<option value="' + esc(o.valor) + '" data-mov="' + (o.pide_movimiento ? '1' : '') + '"' +
                   (o.valor === (v.p_origen || 'compra_divisas') ? ' selected' : '') + '>' + esc(o.etiqueta) + '</option>';
          }).join('') + '</select>') +
        '</div>';

      // El selector de la compra. Arranca visible porque «compra de dólares» es
      // el origen de los 10 abonos que hay: es el caso normal, no la excepcion.
      h += '<div class="mdz-campo mdz-ancho" id="mdz-f-mov-caja">' +
        '<label class="mdz-lab">¿De cuál compra de dólares?</label>' +
        '<select id="mdz-f-mov" class="mdz-in"><option value="">— elegí la compra —</option>' + ops + '</select>' +
        '<div class="mdz-ayuda">' + ayudaCompras(libreTotal, conLibre) + '</div></div>';

      h += '<div class="mdz-campo mdz-ancho"><label class="mdz-lab">Nota <span class="mdz-opt">(opcional)</span></label>' +
        '<input type="text" id="mdz-f-nota" class="mdz-in" maxlength="160" placeholder="Ej.: transferencia a Auto Unión" value="' + val('p_nota') + '"></div>';

      h += '<div class="mdz-form-pie">' +
        '<button type="button" class="mdz-btn mdz-btn-ok" data-acc="guardar"' + (f.guardando ? ' disabled' : '') + '>' +
          (f.guardando ? 'Guardando…' : 'Guardar abono') + '</button>' +
        '<button type="button" class="mdz-btn mdz-btn-flojo" data-acc="cerrar">Cancelar</button>' +
        '</div></div>';
      return h;
    }

    // ⛔ EL NÚMERO GRANDE NO PUEDE DECIR MENOS DE LO QUE SE SABE. Hoy las 21
    //    compras suman US$ 127.219,01 y NINGUNA tiene un abono atado, porque los
    //    10 abonos que hay se cargaron por script el 24/09 sin decir de cuál
    //    compra salieron. Mostrar «quedan US$ 127.219,01 sin aplicar» a secas
    //    sería falso por US$ 111.318: esa plata YA está abonada, lo que falta es
    //    la atadura. Se dicen los dos números y se dice qué falta.
    //    [[norma-numero-que-el-dueno-no-puede-explicar]]
    function ayudaCompras(libreTotal, conLibre) {
      if (!est.compras.length) return 'No hay movimientos del banco marcados como compra de dólares.';
      var sinAtar = 0;
      est.abonos.forEach(function (a) { if (!a.mov_id) sinAtar += Number(a.monto) || 0; });
      var t = 'Hay <b>US$ ' + m2(libreTotal) + '</b> de compras sin atar a un abono, en ' +
              conLibre + ' movimiento' + (conLibre === 1 ? '' : 's') + '. ';
      if (sinAtar > 0.009) {
        t += '⚠️ Pero <b>US$ ' + m2(sinAtar) + '</b> de esta deuda ya están abonados <b>sin decir de cuál compra salieron</b> ' +
             '(es la historia cargada a mano). Hasta que esa historia se ate, esa primera cifra está de más por esa misma plata. ';
      }
      t += 'Si un pago se fondeó con dos compras, cargá <b>dos abonos</b>, uno por cada una.';
      return t;
    }

    function campo(rot, ctrl) {
      return '<div class="mdz-campo"><label class="mdz-lab">' + esc(rot) + '</label>' + ctrl + '</div>';
    }

    // Lo que hay escrito en la pantalla AHORA. No se guarda en `est` a cada
    // tecla: repintar en cada letra le roba el foco al campo que se esta usando.
    function leerForm() {
      var v = function (id) { var e = el.querySelector('#' + id); return e ? e.value : ''; };
      var mo = parseFloat(String(v('mdz-f-monto')).replace(',', '.'));
      return {
        p_deuda: est.sel,
        p_fecha: v('mdz-f-fecha') || null,
        p_monto: isFinite(mo) ? mo : null,
        p_origen: v('mdz-f-origen') || null,
        p_mov_id: v('mdz-f-mov') || null,
        p_nota: v('mdz-f-nota') || null
      };
    }

    function guardar(forzar) {
      var f = est.form;
      if (f.guardando) return;
      var datos = leerForm();
      datos.p_forzar = !!forzar;
      f.valores = datos;          // para que un repintado no borre lo escrito
      f.guardando = true; f.error = null; f.dup = null; pintar();

      sb.rpc('deuda_abonar', datos).then(function (r) {
        f.guardando = false;
        if (r.error) {
          // ⚠️ SE MUESTRA EL MENSAJE DE LA BASE, TAL CUAL. Está escrito para una
          //    persona y dice el número exacto. Cambiarlo por un «no se pudo
          //    guardar» generico es tapar justo el dato que hace falta.
          f.error = r.error.message || String(r.error);
          // 23505 = ya hay uno igual. No es un error: es un freno que pide confirmar.
          f.dup = (r.error.code === '23505');
          pintar();
          return;
        }
        f.abierto = false;
        f.valores = null;         // el que sigue arranca limpio
        f.ok = 'Abono registrado. El saldo y el cuadro de cuotas ya lo tienen adentro.';
        // El widget del dashboard y el PDF leen su propia copia: si no se les
        // avisa, siguen mostrando el saldo viejo hasta que alguien recargue.
        if (typeof op.alCambiar === 'function') { try { op.alCambiar(); } catch (e) {} }
        refrescar();
      }, function (e) {
        f.guardando = false;
        f.error = (e && e.message) || String(e);
        pintar();
      });
    }

    function kpi(rot, val, sub, cls) {
      return '<div class="mdz-kpi ' + (cls || '') + '"><div class="r">' + esc(rot) + '</div>' +
        '<div class="v">' + esc(val) + '</div><div class="s">' + esc(sub || '') + '</div></div>';
    }

    refrescar();

    est.vivo = true;
    return function desmontar() {
      est.vivo = false;
      el.innerHTML = '';
      el.classList.remove('mdz');
    };
  }

  raiz.MaxDeudas = { montar: montar, version: '0.2.0' };
  if (typeof module !== 'undefined' && module.exports) module.exports = raiz.MaxDeudas;
})(typeof window !== 'undefined' ? window : globalThis);
