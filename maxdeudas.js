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

    var est = { vivo: true, cargando: true, puede: false, deudas: [], sel: null, estado: null, tabla: [], abonos: [], error: null };
    el.classList.add('mdz');

    // ⛔ SE PREGUNTA PRIMERO SI PUEDE VER. Las tablas tienen RLS, y una RLS que
    //    no deja pasar devuelve CERO FILAS, no un error: sin esto, «no te dejan
    //    ver» y «no hay deudas» se verian exactamente igual. Es el defecto que se
    //    corrigio el mismo dia en las 8 funciones financieras de Betangar.
    function pedirPermiso() {
      return sb.rpc('deuda_puede_ver').then(function (r) {
        if (r.error) throw r.error;
        est.puede = r.data === true;
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
      return pedirPermiso().then(pedirLista).then(pedirDetalle)
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
      if (est.deudas.length > 1) {
        h += '<select class="mdz-sel" data-acc="cambiar">' + est.deudas.map(function (x) {
          return '<option value="' + x.id + '"' + (x.id === d.id ? ' selected' : '') + '>' + esc(x.acreedor) + '</option>';
        }).join('') + '</select>';
      }
      h += '</div>';

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

  raiz.MaxDeudas = { montar: montar, version: '0.1.0' };
  if (typeof module !== 'undefined' && module.exports) module.exports = raiz.MaxDeudas;
})(typeof window !== 'undefined' ? window : globalThis);
