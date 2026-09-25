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
                form: { abierto: false, guardando: false, error: null, dup: null, ok: null, valores: null },
                alta: { abierto: false, guardando: false, error: null, dup: null, ok: null, valores: null } };
    el.classList.add('mdz');

    // ⛔ UNA SOLA LISTA DE CÓDIGOS «esto se puede confirmar», y vive acá. La base
    //    distingue dos clases de freno por SQLSTATE: unos son errores duros (falta
    //    un dato, es imposible) y otros son avisos que la persona puede confirmar
    //    —ya hay uno igual, los números no cierran, la tasa parece un porcentaje
    //    mal escrito—. Si la pantalla se pusiera a leer el TEXTO del mensaje para
    //    decidir, cualquier corrección de redacción apagaría el botón sin que nadie
    //    se enterara. [[norma-el-guardia-mira-el-texto-no-la-intencion]]
    // ⚠️ Son DOS códigos porque `deuda_abonar()` salió anoche con 23505 (que es
    //    literalmente «ya hay uno igual») y `deuda_crear()` usa 23000 para los
    //    cuatro casos confirmables que tiene. Están los dos en esta única lista a
    //    propósito: un criterio, un lugar.
    function sePuedeConfirmar(cod) { return cod === '23000' || cod === '23505'; }

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

      // ⛔ CUANDO NO HAY NINGUNO TAMBIÉN TIENE QUE HABER POR DÓNDE EMPEZAR. Hasta
      //    hoy este caso se iba con un cartel y sin un solo botón: en Betangar no
      //    se notaba porque el financiamiento de Auto Unión lo cargué por script,
      //    pero este módulo es LEGO y en la app donde caiga limpio la pantalla
      //    quedaba en un callejón sin salida. Es el mismo defecto de anoche —el
      //    módulo se dibujaba perfecto y no se podía llegar a él— un piso más abajo.
      if (!est.deudas.length) {
        var h0 = '<div class="mdz-top"><div><h2>💳 Deudas</h2>' +
          '<div class="mdz-sub">Financiamientos, su cuadro de amortización y lo que se abonó</div></div>' +
          '<div class="mdz-top-der">' + botonAlta() + '</div></div>';
        if (est.alta.ok) h0 += '<div class="mdz-ok">✅ ' + esc(est.alta.ok) + '</div>';
        if (est.alta.abierto) {
          h0 += altaHtml();
        } else {
          h0 += '<div class="mdz-vacio"><div class="q">No hay financiamientos cargados.</div>' +
            '<div class="s">' + (est.puedeCargar
              ? 'Cargá el primero con el botón de arriba: con el monto, la tasa, el plazo y la primera cuota, el cuadro de amortización sale solo.'
              : 'Cuando se cargue uno, acá se ve su cuadro de amortización, lo abonado y lo que vence. Darlo de alta lo hace quien administre.') +
            '</div></div>';
        }
        el.innerHTML = h0;
        enganchar();
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
      if (est.puedeCargar && !est.form.abierto && !est.alta.abierto) {
        h += '<button type="button" class="mdz-btn" data-acc="abrir">＋ Registrar abono</button>';
      }
      h += botonImprimir();
      h += botonAlta();
      h += '</div></div>';

      if (est.form.ok) h += '<div class="mdz-ok">✅ ' + esc(est.form.ok) + '</div>';
      if (est.alta.ok)  h += '<div class="mdz-ok">✅ ' + esc(est.alta.ok) + '</div>';
      // Un formulario por vez: dos cajas abiertas a la vez son dos botones
      // «Guardar» en pantalla y ninguna manera de saber cuál se está llenando.
      if (est.form.abierto) h += formHtml(d);
      if (est.alta.abierto) h += altaHtml();

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
      enganchar();
    }

    // El botón del alta. Se escribe UNA vez porque lo usan las dos ramas de
    // `pintar()` —la que tiene financiamientos y la que no—, y un botón copiado
    // en dos lugares es el que un día aparece en una rama y no en la otra.
    function botonAlta() {
      if (!est.puedeCargar || est.form.abierto || est.alta.abierto) return '';
      return '<button type="button" class="mdz-btn" data-acc="abrir-alta">＋ Nuevo financiamiento</button>';
    }

    // ⛔ IMPRIMIR LO PUEDE HACER QUIEN VE, NO SOLO QUIEN CARGA. Leer la deuda y
    //    llevarse el papel es la misma acción: el directivo y la auditora externa
    //    entran a esta pantalla justamente para eso.
    function botonImprimir() {
      if (!est.puede || !est.deudas.length || est.form.abierto || est.alta.abierto) return '';
      return '<button type="button" class="mdz-btn" data-acc="imprimir">🖨 Imprimir</button>';
    }

    // ⛔ TODOS LOS ENGANCHES EN UN SOLO LUGAR, y se llama desde TODAS las ramas
    //    que dibujan algo. Antes vivían al final de `pintar()`, después del último
    //    `return`: la rama de «no hay financiamientos» salía sin engancharlos, y el
    //    día que esa rama tuviera un botón —hoy— el botón no habría hecho nada.
    //    Un botón que no responde se ve igual que un botón roto.
    function enganchar() {
      var s = el.querySelector('[data-acc="cambiar"]');
      if (s) s.addEventListener('change', function () { est.sel = Number(s.value); refrescar(); });

      var clic = function (acc, fn) {
        var b = el.querySelector('[data-acc="' + acc + '"]');
        if (b) b.addEventListener('click', fn);
      };
      clic('abrir',  function () { cerrarTodo(); est.form.abierto = true; pintar(); });
      clic('cerrar', function () { est.form.abierto = false; est.form.error = null; pintar(); });
      clic('guardar', function () { guardar(false); });
      clic('forzar',  function () { guardar(true); });

      clic('imprimir', function () { imprimir(); });
      clic('abrir-alta',  function () { cerrarTodo(); est.alta.abierto = true; pintar(); });
      clic('cerrar-alta', function () { est.alta.abierto = false; est.alta.error = null; pintar(); });
      clic('guardar-alta', function () { guardarAlta(false); });
      clic('forzar-alta',  function () { guardarAlta(true); });

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

    // Abrir uno cierra el otro y limpia SU error y SU aviso de éxito: un «✅
    // guardado» del abono colgado arriba mientras se llena el alta hace pensar
    // que lo que se está llenando ya se guardó.
    function cerrarTodo() {
      est.form.abierto = false; est.form.error = null; est.form.dup = null; est.form.ok = null; est.form.valores = null;
      est.alta.abierto = false; est.alta.error = null; est.alta.dup = null; est.alta.ok = null; est.alta.valores = null;
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

    // ⚠️ `rot` entra como HTML, no escapado, porque `obl()` y `opc()` le agregan un
    //    <span>. Todos los rótulos de este archivo son literales escritos acá: no
    //    hay ni uno que venga de la base o de lo que teclee alguien. Si algún día
    //    hiciera falta un rótulo con un dato adentro, ese dato se pasa por `esc()`.
    function campo(rot, ctrl, ayuda) {
      return '<div class="mdz-campo"><label class="mdz-lab">' + rot + '</label>' + ctrl +
        (ayuda ? '<div class="mdz-ayuda">' + ayuda + '</div>' : '') + '</div>';
    }
    // El rótulo de lo que no puede faltar lo dice el rótulo, no un asterisco que
    // hay que ir a buscar al pie.
    function obl(t) { return esc(t) + ' <span class="mdz-obl">obligatorio</span>'; }
    function opc(t) { return esc(t) + ' <span class="mdz-opt">(opcional)</span>'; }

    // ═════════════════════════════════════════════════════════════════════════
    // EL FORMULARIO DE ALTA DE UN FINANCIAMIENTO
    //
    // ⛔ TAMPOCO VALIDA NADA POR SU CUENTA. Los siete bloques de control viven en
    //    `deuda_crear()`, que es la unica puerta de escritura —la tabla no tiene
    //    policy de INSERT y a `authenticated` se le quitaron los permisos de
    //    escribir—. Esta pantalla muestra el mensaje que devuelve la base, que ya
    //    esta escrito para una persona y trae los numeros exactos adentro.
    //
    // ⛔ NO SE PIDE EL «VALOR TOTAL», Y ES LA DECISION MAS IMPORTANTE DE ESTA
    //    PANTALLA. Lo calcula la base por sus dos caminos —cantidad × valor
    //    unitario, e inicial + financiado— y frena si no dan lo mismo. Ese cruce es
    //    el que encontro los US$ 10.400 repetidos en el Excel de Maximo. Un campo
    //    tecleado a mano al lado de los otros dos que lo determinan es la tercera
    //    lista que se desincroniza. [[norma-dos-listas-a-mano-se-desincronizan]]
    //
    // ⛔ LA PRIMERA CUOTA ARRANCA VACIA, a proposito. De esa fecha cuelga el cuadro
    //    entero, lo vencido y la proxima a pagar. Un `hoy` puesto de regalo en un
    //    campo que la persona TIENE que declarar se acepta sin mirarlo, y despues
    //    nadie sabe si esa fecha la eligio alguien o la puso el formulario.
    //    [[norma-default-en-campo-que-se-declara]]
    // ═════════════════════════════════════════════════════════════════════════
    function altaHtml() {
      var f = est.alta;
      var v = f.valores || {};
      // Lo que la persona escribio no se borra cuando el guardado falla: es el
      // mismo defecto que ya se pago en el formulario de abonos, donde el boton de
      // confirmar leia los campos vacios y mandaba el monto en NULL.
      var val = function (k) { return esc(v[k] == null ? '' : v[k]); };

      var h = '<div class="mdz-form"><h3 class="mdz-form-t">Dar de alta un financiamiento</h3>';

      if (f.error) {
        h += '<div class="mdz-form-err"><b>No se guardó.</b><div>' + esc(f.error) + '</div>' +
             (f.dup ? '<button type="button" class="mdz-btn mdz-btn-peligro" data-acc="forzar-alta">' +
                      'Ya lo revisé — cargarlo igual</button>' : '') + '</div>';
      }

      // ── A quién se le debe y por qué ────────────────────────────────────────
      h += '<div class="mdz-campos">' +
        campo(obl('A quién se le debe'),
          '<input type="text" id="mdz-a-acreedor" class="mdz-in" maxlength="80" placeholder="Ej.: AUTO UNION DC" value="' + val('p_acreedor') + '">') +
        campo(obl('Qué se financió'),
          '<input type="text" id="mdz-a-concepto" class="mdz-in" maxlength="120" placeholder="Ej.: 12 camiones JAC 1131" value="' + val('p_concepto') + '">') +
        campo(opc('Quién queda como deudor'),
          '<input type="text" id="mdz-a-deudor" class="mdz-in" maxlength="80" placeholder="Ej.: TRANSPORTE ATLAS" value="' + val('p_deudor') + '">',
          'Si la deuda quedó a nombre de otra empresa del grupo.') +
        '</div>';

      // ── El financiamiento, que es de donde sale TODO el cuadro ──────────────
      h += '<h4 class="mdz-form-h4">El financiamiento</h4>' +
        '<div class="mdz-campos">' +
        campo(obl('Monto financiado en US$'),
          '<input type="number" id="mdz-a-financiado" class="mdz-in" step="0.01" min="0" placeholder="384000,00" value="' + val('p_monto_financiado') + '">',
          'Lo que se debe, sin la inicial.') +
        campo(obl('Tasa % anual'),
          '<input type="number" id="mdz-a-tasa" class="mdz-in" step="0.01" min="0" placeholder="12" value="' + val('_pct') + '">',
          'El porcentaje: <b>12</b> para 12% anual. Poné 0 si no tiene intereses.') +
        campo(obl('Cuántas cuotas'),
          '<input type="number" id="mdz-a-plazo" class="mdz-in" step="1" min="1" placeholder="18" value="' + val('p_plazo_meses') + '">',
          'Mensuales.') +
        campo(obl('Primera cuota'),
          '<input type="date" id="mdz-a-primera" class="mdz-in" value="' + val('p_primera_cuota') + '">',
          'De esta fecha cuelga el cuadro entero.') +
        '</div>';

      // ── Lo que se compró: opcional, pero si viene sirve de control ──────────
      h += '<h4 class="mdz-form-h4">Lo que se compró <span class="mdz-opt">(si aplica — sirve de control)</span></h4>' +
        '<div class="mdz-campos">' +
        campo(opc('Cuántas unidades'),
          '<input type="number" id="mdz-a-cantidad" class="mdz-in" step="0.01" min="0" placeholder="12" value="' + val('p_cantidad') + '">') +
        campo(opc('Valor de cada una en US$'),
          '<input type="number" id="mdz-a-unitario" class="mdz-in" step="0.01" min="0" placeholder="65000,00" value="' + val('p_valor_unitario') + '">') +
        campo(opc('Inicial que se pagó en US$'),
          '<input type="number" id="mdz-a-inicial" class="mdz-in" step="0.01" min="0" placeholder="0,00" value="' + val('p_inicial') + '">',
          'Si no hubo inicial, dejalo vacío.') +
        '</div>' +
        '<div class="mdz-ayuda mdz-ancho">⚠️ <b>El valor total no se pide: lo calcula la base por sus dos caminos</b> ' +
        '—cantidad × valor de cada una, y inicial + financiado— y <b>frena si no dan lo mismo</b>. ' +
        'Ese cruce es el que encontró los US$ 10.400 repetidos en el Excel. ' +
        'La cantidad y el valor unitario van juntos o ninguno: con uno solo no hay nada que cruzar.</div>';

      h += '<div class="mdz-campo mdz-ancho"><label class="mdz-lab">' + opc('Nota') + '</label>' +
        '<input type="text" id="mdz-a-nota" class="mdz-in" maxlength="200" placeholder="Ej.: contrato firmado el 15/03, garantía sobre las unidades" value="' + val('p_nota') + '"></div>';

      h += '<div class="mdz-form-pie">' +
        '<button type="button" class="mdz-btn mdz-btn-ok" data-acc="guardar-alta"' + (f.guardando ? ' disabled' : '') + '>' +
          (f.guardando ? 'Guardando…' : 'Dar de alta') + '</button>' +
        '<button type="button" class="mdz-btn mdz-btn-flojo" data-acc="cerrar-alta">Cancelar</button>' +
        '</div></div>';
      return h;
    }

    // Lo que hay escrito en el formulario de alta AHORA.
    //
    // ⚠️ EL CAMPO DICE «%» Y LA BASE GUARDA FRACCIÓN. Nadie escribe 0,12 en un
    //    campo que dice tasa: escribe 12. La conversión se hace en un solo lugar
    //    —acá— y la base igual frena si le llega algo mayor que 1, porque este
    //    módulo es LEGO y mañana lo llama otra pantalla que quizás no convierta.
    //    Se redondea a 8 decimales: 1,1 / 100 en coma flotante da
    //    0.011000000000000001 y eso no es una tasa, es basura guardada.
    function leerAlta() {
      var t = function (id) { var e = el.querySelector('#' + id); return e ? e.value.trim() : ''; };
      var n = function (id) {
        var x = parseFloat(String(t(id)).replace(',', '.'));
        return isFinite(x) ? x : null;
      };
      var pct = n('mdz-a-tasa');
      return {
        p_acreedor: t('mdz-a-acreedor') || null,
        p_concepto: t('mdz-a-concepto') || null,
        p_monto_financiado: n('mdz-a-financiado'),
        p_tasa_anual: pct === null ? null : Number((pct / 100).toFixed(8)),
        p_plazo_meses: n('mdz-a-plazo'),
        p_primera_cuota: t('mdz-a-primera') || null,
        p_deudor: t('mdz-a-deudor') || null,
        p_cantidad: n('mdz-a-cantidad'),
        p_valor_unitario: n('mdz-a-unitario'),
        p_inicial: n('mdz-a-inicial'),
        p_nota: t('mdz-a-nota') || null,
        // Lo que la persona TECLEÓ en el campo de la tasa, para volver a pintarlo
        // tal cual si el guardado falla. Si se repintara desde la fracción, quien
        // escribió 12 vería 0.12 y creería que el formulario le cambió el dato.
        _pct: t('mdz-a-tasa')
      };
    }

    function guardarAlta(forzar) {
      var f = est.alta;
      if (f.guardando) return;
      var datos = leerAlta();
      f.valores = datos;              // para que un repintado no borre lo escrito
      f.guardando = true; f.error = null; f.dup = null; pintar();

      // La fracción y el `_pct` no van juntos a la base: `_pct` es de la pantalla.
      var envio = {};
      Object.keys(datos).forEach(function (k) { if (k.charAt(0) !== '_') envio[k] = datos[k]; });
      envio.p_forzar = !!forzar;

      sb.rpc('deuda_crear', envio).then(function (r) {
        f.guardando = false;
        if (r.error) {
          // Se muestra el mensaje de la base TAL CUAL: dice qué número no cierra.
          f.error = r.error.message || String(r.error);
          f.dup = sePuedeConfirmar(r.error.code);
          pintar();
          return;
        }
        f.abierto = false;
        f.valores = null;
        f.ok = 'Financiamiento dado de alta. El cuadro de amortización, la cuota y lo que vence ya salen de la base.';
        // ⚠️ SE SALTA AL NUEVO. Sin esto la pantalla se quedaba mirando el que
        //    estaba seleccionado y el alta parecía no haber hecho nada.
        if (r.data) est.sel = Number(r.data);
        // El widget del dashboard y el PDF leen su propia copia: si no se les
        // avisa, siguen mostrando la deuda vieja hasta que alguien recargue.
        if (typeof op.alCambiar === 'function') { try { op.alCambiar(); } catch (e) {} }
        refrescar();
      }, function (e) {
        f.guardando = false;
        f.error = (e && e.message) || String(e);
        pintar();
      });
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
          // No es un error: es un freno que pide confirmar. Los códigos están en
          // UNA lista, arriba, compartida con el alta.
          f.dup = sePuedeConfirmar(r.error.code);
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

    // ═════════════════════════════════════════════════════════════════════════
    // EL INFORME PARA IMPRIMIR
    //
    // Máximo, 25/09/2026, mirando la pantalla: «esto deberia yo poder imprimirlo
    // en formato profesional como los otros».
    //
    // ⛔ SALE DE LO QUE LA PERSONA ESTÁ VIENDO, NO DE UNA CONSULTA NUEVA. Todo lo
    //    que se imprime ya está en `est`: el estado, el cuadro, los abonos y el
    //    conteo de cuotas, traídos en el mismo viaje. Volver a pedirlo abriría la
    //    puerta a que el papel diga un saldo y la pantalla otro, del mismo momento
    //    y delante de la misma persona. Es el mismo criterio por el que el widget
    //    del dashboard y el PDF comparten una sola copia.
    //    [[norma-dos-listas-a-mano-se-desincronizan]]
    //
    // ⛔ EL MÓDULO PONE LOS DATOS; LA APP PONE SU MOLDE. Este archivo no sabe —ni
    //    debe saber— cómo es el encabezado de Betangar: es LEGO y el mes que viene
    //    cae en FlotaMax y en Tony Gas, que tienen el suyo. Devuelve título,
    //    subtítulo, cifras y tablas, y la app las envuelve con su logo, su RIF y su
    //    pie. Si la app no da molde, imprime con uno propio mínimo — feo, pero sale.
    // ═════════════════════════════════════════════════════════════════════════
    function armarInforme() {
      var d = est.deudas.filter(function (x) { return x.id === est.sel; })[0] || est.deudas[0];
      var e = est.estado || {}, c = est.cuotas;
      var pct = Number(e.total_a_pagar) > 0
        ? Math.round((Number(e.total_abonado) / Number(e.total_a_pagar)) * 100) : 0;
      var venc = Number(e.cuotas_vencidas || 0);
      var dias = diasHasta(e.proxima_cuota);

      // El subtítulo dice de QUÉ financiamiento habla el papel. ⚠️ Si hay varios, lo
      // dice también: un informe que no aclara que es UNO de tres se archiva como si
      // fuera la deuda entera. [[norma-numero-que-el-dueno-no-puede-explicar]]
      var sub = d.concepto + (d.deudor ? ' · deudor: ' + d.deudor : '') +
        ' · ' + d.plazo_meses + ' cuotas al ' + m2(Number(d.tasa_anual) * 100) + '% anual' +
        ' · primera el ' + fechaVE(d.primera_cuota);
      if (est.deudas.length > 1) {
        sub += ' — ⚠️ este informe cubre UNO de los ' + est.deudas.length + ' financiamientos cargados';
      }

      var stats = [
        { l: 'Saldo pendiente', v: 'US$ ' + m2(e.saldo_pendiente), s: 'de US$ ' + m2(e.total_a_pagar) + ' a pagar' },
        { l: 'Abonado', v: 'US$ ' + m2(e.total_abonado), s: pct + '% del total' },
        { l: 'Cuota mensual', v: 'US$ ' + m2(e.cuota_mensual), s: c ? (c.pagadas + ' de ' + c.total + ' pagadas') : '' },
        { l: 'Próxima a vencer', v: fechaVE(e.proxima_cuota),
          s: dias === null ? '' : (dias < 0 ? 'hace ' + Math.abs(dias) + ' días' : dias === 0 ? 'HOY' : 'en ' + dias + ' días') },
      ];
      if (venc > 0) stats.push({ l: 'Vencido sin pagar', v: 'US$ ' + m2(e.monto_vencido), s: venc + ' cuota' + (venc > 1 ? 's' : '') });

      // ⛔ LO QUE DUELE VA ARRIBA TAMBIÉN EN EL PAPEL. En la pantalla las vencidas
      //    van antes que el saldo; un informe que las entierra en la fila 5 de una
      //    tabla de 18 es un informe que nadie mira dos veces.
      var alarma = venc > 0
        ? venc + ' cuota' + (venc > 1 ? 's' : '') + ' VENCIDA' + (venc > 1 ? 'S' : '') +
          ' sin pagar · US$ ' + m2(e.monto_vencido)
        : '';

      var cuerpo = '';
      if (c) {
        // «de las cuales» y no tres números seguidos: 4 + 14 = 18, no 4 + 2 + 14.
        cuerpo += '<p class="mdz-p"><b>' + c.pagadas + ' de ' + c.total + '</b> cuotas pagadas · <b>' +
          c.por_pagar + '</b> por pagar' +
          (Number(c.vencidas) > 0 ? ' (de las cuales <b>' + c.vencidas + '</b> vencida' +
            (Number(c.vencidas) > 1 ? 's' : '') + ')' : '') + '.</p>';
      }

      cuerpo += '<h2 class="mdz-h2p">Cuadro de amortización</h2>' +
        '<table><thead><tr><th>#</th><th>Vence</th><th class="n">Cuota</th><th class="n">Interés</th>' +
        '<th class="n">Capital</th><th class="n">Saldo</th><th class="n">Abonado</th>' +
        '<th class="n">Resta</th><th>Estado</th></tr></thead><tbody>';
      est.tabla.forEach(function (f) {
        cuerpo += '<tr><td>' + f.nro + '</td><td>' + fechaVE(f.vencimiento) + '</td>' +
          '<td class="n">' + m2(f.cuota) + '</td><td class="n">' + m2(f.interes) + '</td>' +
          '<td class="n">' + m2(f.capital) + '</td><td class="n">' + m2(f.saldo) + '</td>' +
          '<td class="n">' + m2(f.abono_aplicado) + '</td><td class="n">' + m2(f.resta) + '</td>' +
          '<td' + (f.estado === 'Vencida' ? ' class="mdz-mal"' : '') + '>' + esc(f.estado) + '</td></tr>';
      });
      cuerpo += '</tbody></table>';

      cuerpo += '<h2 class="mdz-h2p">Abonos registrados (' + est.abonos.length + ')</h2>';
      if (!est.abonos.length) {
        cuerpo += '<p class="mdz-p">No hay abonos cargados.</p>';
      } else {
        var suma = 0;
        cuerpo += '<table><thead><tr><th>Fecha</th><th class="n">Monto US$</th>' +
          '<th>De dónde salió</th><th>Nota</th></tr></thead><tbody>';
        est.abonos.forEach(function (a) {
          suma += Number(a.monto) || 0;
          var sinDecl = a.origen === 'sin_declarar';
          cuerpo += '<tr><td>' + fechaVE(a.fecha) + '</td><td class="n">' + m2(a.monto) + '</td>' +
            '<td' + (sinDecl ? ' class="mdz-mal"' : '') + '>' +
            (sinDecl ? 'SIN DECLARAR' : esc(a.origen).replace(/_/g, ' ')) + '</td>' +
            '<td>' + esc(a.nota || '') + '</td></tr>';
        });
        // ⛔ LA SUMA VA EN EL PAPEL. Quien recibe un listado de abonos lo primero que
        //    hace es sumarlo a mano; si el total no está, o lo suma mal o desconfía.
        cuerpo += '<tr class="tr-total"><td>TOTAL ABONADO</td><td class="n">' + m2(suma) +
          '</td><td colspan="2"></td></tr></tbody></table>';
      }

      // ⚠️ Un abono sin origen declarado se dice en el papel igual que en la
      //    pantalla: es el renglón que impide cuadrar la deuda contra el banco.
      var sd = Number(e.abonos_sin_declarar || 0);
      if (sd > 0) {
        cuerpo += '<p class="mdz-p"><b>⚠️ ' + sd + ' abono' + (sd > 1 ? 's' : '') +
          ' sin declarar de dónde salió la plata.</b> Mientras eso falte, esta deuda y ' +
          'los movimientos del banco no se pueden cuadrar.</p>';
      }

      cuerpo += '<p class="mdz-pie-p">La cuota, la amortización, lo vencido y el saldo los calcula la base ' +
        'a partir de dos datos: el financiamiento y los abonos. Este informe no recalcula nada: ' +
        'muestra exactamente lo que estaba en pantalla al imprimirlo.</p>';

      return {
        titulo: 'ESTADO DE LA DEUDA — ' + d.acreedor,
        sub: sub,
        stats: stats,
        alarma: alarma,
        cuerpo: cuerpo,
        deuda: d
      };
    }

    function imprimir() {
      var inf;
      try { inf = armarInforme(); }
      catch (err) {
        // ⛔ NO SE IMPRIME A MEDIAS EN SILENCIO. Un papel al que le falta una sección
        //    se archiva igual que uno completo. [[norma-la-red-que-traga-el-error-tapa-la-pieza]]
        est.form.error = null;
        alert('No se pudo armar el informe: ' + ((err && err.message) || err) +
              '\n\nNo se imprimió nada. La pantalla sigue mostrando los datos.');
        return;
      }
      // La app pone su molde. Si no lo puso, sale con uno propio: feo, pero sale, y
      // con los mismos números.
      if (op.informe && typeof op.informe === 'function') { op.informe(inf); return; }
      var h = '<!doctype html><html><head><meta charset="utf-8"><title>' + esc(inf.titulo) + '</title>' +
        '<style>body{font-family:Arial,Helvetica,sans-serif;color:#17212b;margin:22px}' +
        'h1{font-size:18px;margin:0 0 3px}.s{color:#4a5765;font-size:12px;margin-bottom:12px}' +
        'table{width:100%;border-collapse:collapse;font-size:11px;margin-bottom:12px}' +
        'th{background:#1e3a5f;color:#fff;padding:5px 7px;text-align:left}' +
        'td{padding:4px 7px;border-bottom:1px solid #dbe2ea}.n{text-align:right}' +
        '.mdz-mal{color:#8c1d18;font-weight:700}.tr-total td{background:#1e3a5f;color:#fff;font-weight:800}' +
        '.mdz-h2p{font-size:13px;margin:14px 0 5px}.mdz-p{font-size:11px;margin:6px 0}' +
        '.mdz-pie-p{font-size:10px;color:#4a5765;margin-top:14px}' +
        '.al{background:#fdecea;color:#8c1d18;font-weight:800;padding:6px 10px;margin-bottom:10px}</style></head><body>' +
        '<h1>' + esc(inf.titulo) + '</h1><div class="s">' + esc(inf.sub) + '</div>' +
        (inf.alarma ? '<div class="al">' + esc(inf.alarma) + '</div>' : '') +
        inf.stats.map(function (s) {
          return '<div class="mdz-p"><b>' + esc(s.l) + ':</b> ' + esc(s.v) + (s.s ? ' — ' + esc(s.s) : '') + '</div>';
        }).join('') +
        inf.cuerpo + '</body></html>';
      var w = window.open('', '_blank');
      if (!w) { alert('El navegador bloqueó la ventana de impresión. Permití las ventanas emergentes y probá otra vez.'); return; }
      w.document.open(); w.document.write(h); w.document.close();
      setTimeout(function () { try { w.focus(); w.print(); } catch (x) {} }, 300);
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

  raiz.MaxDeudas = { montar: montar, version: '0.3.0' };
  if (typeof module !== 'undefined' && module.exports) module.exports = raiz.MaxDeudas;
})(typeof window !== 'undefined' ? window : globalThis);
