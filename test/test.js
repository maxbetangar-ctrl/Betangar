// Pruebas de las funciones críticas de Betangar (app.js).
// Correr: `node test/test.js`  (sale con código 1 si algo falla → sirve de gate).
const app = require('./harness');

let pass = 0, fail = 0;
function ok(name, cond) {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ ' + name); }
}
function eq(name, got, exp) {
  const c = JSON.stringify(got) === JSON.stringify(exp);
  if (c) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ ' + name + '  → got ' + JSON.stringify(got) + ', exp ' + JSON.stringify(exp)); }
}

// Confirmar que las funciones se cargaron desde app.js
console.log('Funciones cargadas:');
['_normNom', '_nomCasa', 'getTasaFecha', 'compCostoUnit'].forEach(function (f) {
  ok(f + ' definida', typeof app[f] === 'function');
});

// ── _normNom: normaliza (mayúsculas, sin acentos, sin dobles espacios) ──
console.log('\n_normNom:');
eq("acentos + espacios", app._normNom('  José   Pérez  '), 'JOSE PEREZ');
eq("Ñ + símbolos se ELIMINAN (guion/apóstrofe unen, no separan)", app._normNom("Núñez-D'Angelo"), 'NUNEZDANGELO');
eq("vacío", app._normNom(null), '');

// ── _nomCasa: match nombre planilla vs empleado (conservador) ──
console.log('\n_nomCasa:');
ok("exacto", app._nomCasa('REINALDO FARIA', 'REINALDO FARIA') === true);
ok("corto vs completo casa", app._nomCasa('REINALDO FARIA', 'REINALDO ENRIQUE FARIA PARRA') === true);
ok("typo de primer nombre NO casa (YURBENIS/YURVENIS)",
  app._nomCasa('YURBENIS BERMUDEZ', 'YURVENIS FRANCISCO BERMUDEZ SUAREZ') === false);
ok("homónimo de apellido NO casa (distinto primer nombre)",
  app._nomCasa('AMERICO GONZALEZ', 'RICHARD ANTONIO GONZALEZ URDANETA') === false);
ok("mismo primer nombre + apellido común casa",
  app._nomCasa('AMERICO GONZALEZ', 'AMERICO GONZALEZ URDANETA') === true);
ok("vacío NO casa", app._nomCasa('', 'AMERICO GONZALEZ') === false);

// ── getTasaFecha: tasa congelada por fecha (regla contable) ──
console.log('\ngetTasaFecha:');
app.TASAS_DIARIAS = { '2026-06-23': { dolar: 617.64, euro: 634.4, binance: 788.49 } };
eq("fecha existente (dolar)", app.getTasaFecha('2026-06-23', 'dolar'), 617.64);
eq("acepta timestamp (slice a 10)", app.getTasaFecha('2026-06-23T10:00:00Z', 'dolar'), 617.64);
eq("euro", app.getTasaFecha('2026-06-23', 'euro'), 634.4);
eq("fecha sin tasa → null (nunca USD=Bs)", app.getTasaFecha('2026-06-22', 'dolar'), null);
eq("default tipo = dolar", app.getTasaFecha('2026-06-23'), 617.64);
// Fin de semana / feriado → usa el día hábil anterior (≤7 días atrás)
app.TASAS_DIARIAS = { '2026-06-19': { dolar: 611.5 } }; // viernes
eq("sábado usa la tasa del viernes", app.getTasaFecha('2026-06-20', 'dolar'), 611.5);
eq("domingo usa la tasa del viernes", app.getTasaFecha('2026-06-21', 'dolar'), 611.5);
eq("más de 7 días sin tasa previa → null", app.getTasaFecha('2026-07-01', 'dolar'), null);

// ── compCostoUnit: precio $/L FIJO por fuente (sin DOM → usa defaults) ──
console.log('\ncompCostoUnit (defaults, sin inputs en el DOM stub):');
app.compCostoUnit('tumaca', function (v) { eq("tumaca default 0.83", v, 0.83); });
app.compCostoUnit('boscan', function (v) { eq("boscan default 0.78", v, 0.78); });

// ── _nombreCanonico: alias de nombres mal escritos en planillas ──
console.log('\n_nombreCanonico (alias de typos):');
eq("YURBENIS -> YURVENIS (full)", app._nombreCanonico('YURBENIS BERMUDEZ'), 'YURVENIS FRANCISCO BERMUDEZ SUAREZ');
eq("Jose Arangure -> ARANGUREN", app._nombreCanonico('Jose Arangure'), 'JOSE ELITE ARANGUREN GONZALEZ');
eq("YIBER -> YIRBER", app._nombreCanonico('yiber gonzalez'), 'YIRBER LENITHON GONZALEZ MONTIEL');
eq("nombre sin alias ni empleado -> uppercase", app._nombreCanonico('Pedro Perez'), 'PEDRO PEREZ');

// ── imauViajesPlanilla: cuenta la marca "IMAU" en la planilla (ay1/ay2/ay3) × viajes ──
console.log('\nimauViajesPlanilla (marca "IMAU", sin nombres):');
eq("una fila IMAU = sus viajes", app.imauViajesPlanilla([{ay1:'IMAU',t:3}]), 3);
eq("ignora ayudantes con nombre", app.imauViajesPlanilla([{ay1:'IMAU',t:3},{ay1:'JUAN PEREZ',t:2}]), 3);
eq("minúsculas/espacios cuentan", app.imauViajesPlanilla([{ay2:'  imau ',t:4}]), 4);
eq("dos IMAU en la fila = 2× viajes", app.imauViajesPlanilla([{ay1:'IMAU',ay2:'IMAU',t:3}]), 6);
eq("sin IMAU = 0", app.imauViajesPlanilla([{ay1:'PEDRO',ay2:'',t:5}]), 0);
eq("'IMAU' parcial NO cuenta (exacto)", app.imauViajesPlanilla([{ay1:'IMAUX',t:5}]), 0);
eq("lista vacía = 0", app.imauViajesPlanilla([]), 0);

// ── DINERO: retenciones (money.js) — la fórmula que cobra/concilia. Si cambia un %, esto avisa. ──
console.log('\ncalcRetenciones / perfilRetencion (money.js):');
const aprox = (name, got, exp) => ok(name + ' (' + got + '≈' + exp + ')', Math.abs(got - exp) < 0.005);
ok('calcRetenciones definida', typeof app.calcRetenciones === 'function');
ok('perfilRetencion definida', typeof app.perfilRetencion === 'function');
if (typeof app.calcRetenciones === 'function') {
  const r = app.calcRetenciones(10000, app.RET_DEFAULT, null);
  aprox('IVA 16%', r.iva, 1600);
  aprox('total c/IVA', r.total, 11600);
  aprox('ret IVA 75%', r.retIVA, 1200);
  aprox('ret ISLR 2%', r.retISLR, 200);
  aprox('ret Municipal 1%', r.retMun, 100);
  aprox('timbre 0.1%', r.timbre, 10);
  aprox('fiel 10%', r.fiel, 1000);
  aprox('NETO Alcaldía', r.neto, 9090);
  aprox('resp. social 3%', r.respSocial, 300);
  const sumaRet = r.retIVA + r.retISLR + r.retMun + r.timbre + r.fiel + r.laboral;
  aprox('neto + retenciones = total (no se pierde un centavo)', r.neto + sumaRet, r.total);
  aprox('laboral manual 500 -> neto 8590', app.calcRetenciones(10000, app.RET_DEFAULT, 500).neto, 8590);
  const p = app.perfilRetencion({ id: 'X', retenciones: { fiel: 0, respSocial: 0, retISLR: 0.03 } });
  aprox('perfil propio: ISLR 3%', p.retISLR, 0.03);
  aprox('perfil propio: IVA sigue default', p.iva, 0.16);
  const r2 = app.calcRetenciones(10000, p, 0);
  aprox('contrato sin fiel -> 0', r2.fiel, 0);
  aprox('contrato sin resp.social -> 0', r2.respSocial, 0);
  ok('perfilRetencion(null) = RET_DEFAULT', JSON.stringify(app.perfilRetencion(null)) === JSON.stringify(app.RET_DEFAULT));
  aprox('base invalida -> neto 0', app.calcRetenciones('abc', app.RET_DEFAULT, null).neto, 0);
}

// ── PERSISTENCIA: cola offline / dead-letter / reintento (la capa donde vivían los bugs) ──
// Es justo lo que el audit pedía cubrir: que un fallo NO se pierda en silencio (cae al
// dead-letter), que la red reintente y tras 3 intentos también caiga al dead-letter, y que
// la cola reintente como UPSERT (no INSERT) cuando la tabla tiene clave de conflicto.
function respCola(b){
  if(b==='neterr')return Promise.reject(new Error('sin red'));        // falla de red → reintentar
  if(b==='srverr')return Promise.resolve({error:{message:'dup key'}}); // error de servidor → dead-letter
  return Promise.resolve({error:null});                                // ok
}
function mkSupa(behavior, calls){
  return { from:function(t){ return {
    insert:function(rows){ calls.push({t:t,method:'insert'}); return respCola(behavior); },
    upsert:function(rows,opts){ calls.push({t:t,method:'upsert',oc:opts&&opts.onConflict}); return respCola(behavior); }
  };}};
}
function resetCola(){ app.COLA_OFFLINE=[]; app.COLA_FALLIDOS=[]; app._procesandoCola=false; }

(async function runAsync(){
  console.log('\nguardarEnCola (onConflict por tabla):');
  ok('guardarEnCola definida', typeof app.guardarEnCola === 'function');
  ok('procesarColaOffline definida', typeof app.procesarColaOffline === 'function');
  resetCola();
  app.guardarEnCola('abonos', { fact: 'M1', m: 5 });
  eq('abonos → onConflict "fact"', app.COLA_OFFLINE[0].oc, 'fact');
  app.guardarEnCola('planillas', { p: '00251' });
  eq('planillas → onConflict "p"', app.COLA_OFFLINE[1].oc, 'p');
  app.guardarEnCola('km_data', { cam: 'JAC-B001' });
  eq('tabla sin clave → oc null', app.COLA_OFFLINE[2].oc, null);
  app.guardarEnCola('abonos', { fact: 'M2' }, 'custom');
  eq('oc explícito gana sobre el mapa', app.COLA_OFFLINE[3].oc, 'custom');
  eq('_try arranca en 0', app.COLA_OFFLINE[0]._try, 0);

  app.DB_READY = true;

  console.log('\nprocesarColaOffline — ÉXITO:');
  resetCola();
  var calls = [];
  app.supabase = mkSupa('ok', calls);
  app.COLA_OFFLINE = [{ t: 'abonos', d: { fact: 'M9' }, _try: 0, oc: 'fact' }];
  await app.procesarColaOffline();
  eq('cola vacía tras sincronizar', app.COLA_OFFLINE.length, 0);
  eq('nada al dead-letter', app.COLA_FALLIDOS.length, 0);
  eq('con oc → reintenta como UPSERT (no INSERT)', calls[0] && calls[0].method, 'upsert');
  eq('UPSERT lleva el onConflict', calls[0] && calls[0].oc, 'fact');

  console.log('\nprocesarColaOffline — sin clave usa INSERT:');
  resetCola();
  var calls2 = [];
  app.supabase = mkSupa('ok', calls2);
  app.COLA_OFFLINE = [{ t: 'km_data', d: { cam: 'X' }, _try: 0, oc: null }];
  await app.procesarColaOffline();
  eq('sin oc → INSERT plano', calls2[0] && calls2[0].method, 'insert');

  console.log('\nprocesarColaOffline — ERROR DE SERVIDOR → dead-letter (no se pierde):');
  resetCola();
  app.supabase = mkSupa('srverr', []);
  app.COLA_OFFLINE = [{ t: 'abonos', d: { fact: 'DUP' }, _try: 0, oc: 'fact' }];
  await app.procesarColaOffline();
  eq('no se reencola (error del servidor no es de red)', app.COLA_OFFLINE.length, 0);
  eq('cae al dead-letter visible', app.COLA_FALLIDOS.length, 1);
  ok('dead-letter guarda el motivo', /servidor/.test((app.COLA_FALLIDOS[0] || {}).motivo || ''));

  console.log('\nprocesarColaOffline — RED falla: reintenta y a los 3 intentos → dead-letter:');
  resetCola();
  app.supabase = mkSupa('neterr', []);
  app.COLA_OFFLINE = [{ t: 'planillas', d: { p: '1' }, _try: 0, oc: 'p' }];
  await app.procesarColaOffline();
  eq('1er fallo de red → reencolado', app.COLA_OFFLINE.length, 1);
  eq('_try incrementado a 1', app.COLA_OFFLINE[0]._try, 1);
  eq('aún no al dead-letter', app.COLA_FALLIDOS.length, 0);
  await app.procesarColaOffline(); // intento 2
  eq('_try=2 sigue reencolado', app.COLA_OFFLINE.length === 1 && app.COLA_OFFLINE[0]._try, 2);
  await app.procesarColaOffline(); // intento 3 → dead-letter
  eq('tras 3 intentos sale de la cola', app.COLA_OFFLINE.length, 0);
  eq('tras 3 intentos → dead-letter (no se pierde en silencio)', app.COLA_FALLIDOS.length, 1);

  console.log('\nexportNomExcel (arma hojas desde _ultimaNomina):');
  ok('exportNomExcel definida', typeof app.exportNomExcel === 'function');
  var sheets = [];
  app.XLSX = {
    utils: {
      book_new: function () { return {}; },
      json_to_sheet: function (rows) { return { __rows: rows }; },
      book_append_sheet: function (wb, ws, name) { sheets.push({ name: name, rows: ws.__rows }); }
    },
    writeFile: function (wb, fname) { sheets._fname = fname; }
  };
  app.TASAS.bcvDolar = 617; // simula tasa ya cargada de la API (si no, exportNomExcel pediría la manual)
  app._ultimaNomina = {
    sem: 'S1', mes: '2026-06', tasa: 617, totCh: 100, totAy: 50, totAdm: 0, totImau: 0, totBs: 92550,
    fdesde: '2026-06-01', fhasta: '2026-06-07',
    choferes: [{ n: 'JUAN', u: 'JAC-B001', viajes: 10, pat: 0, usd: 80, bs: 49360 }],
    ayudantes: [{ n: 'PEDRO', u: 'JAC-B001', tipo: 'interno', viajes: 8, pat: 0, usd: 40, bs: 24680 }]
  };
  app.exportNomExcel();
  eq('genera 3 hojas (Choferes, Ayudantes, Resumen)', sheets.map(function (s) { return s.name; }), ['Choferes', 'Ayudantes', 'Resumen']);
  eq('hoja Choferes lleva el neto $', (sheets[0].rows[0] || {})['Neto $'], 80);
  ok('nombre de archivo con sufijo de semana', /S1/.test(sheets._fname || ''));
  var resumen = sheets[2].rows;
  ok('Resumen incluye la tasa', resumen.some(function (r) { return r.Concepto === 'Tasa Bs/$' && r.Valor === 617; }));
  sheets.length = 0;
  app._ultimaNomina = null;
  app.exportNomExcel(); // sin nómina calculada → no debe armar hojas ni lanzar
  eq('sin nómina calculada no exporta', sheets.length, 0);

  console.log('\ntasaOManual (prioridad API, manual solo si falla):');
  ok('tasaOManual definida', typeof app.tasaOManual === 'function');
  app.TASAS.bcvDolar = 620;
  var gotTasa = null, llamado = 0;
  app.tasaOManual('bcvDolar', function (v) { gotTasa = v; llamado++; });
  eq('con tasa de la API → callback directo con esa tasa (sin pedir manual)', gotTasa, 620);
  eq('callback se ejecuta una sola vez', llamado, 1);
  eq('getTasa devuelve la de la API', app.getTasa('bcvDolar'), 620);
  app.TASAS.bcvDolar = 0;
  eq('sin tasa cargada getTasa → null (no inventa un número)', app.getTasa('bcvDolar'), null);

  console.log('\nmulta en divisa (USD/EUR) → USD para nómina, congela Bs al pagar:');
  ok('_multaDivToUsd definida', typeof app._multaDivToUsd === 'function');
  ok('_multaCuotaUsd definida', typeof app._multaCuotaUsd === 'function');
  app.TASAS.bcvDolar = 617;
  app.TASAS.bcvEuro = 634;
  eq('USD se queda igual', app._multaDivToUsd(100, 'USD'), 100);
  eq('EUR → USD vía euro/dolar (100€ × 634/617)', Math.round(app._multaDivToUsd(100, 'EUR') * 100) / 100, Math.round(100 * 634 / 617 * 100) / 100);
  eq('EUR sin tasa euro → 0 (no inventa)', (function () { app.TASAS.bcvEuro = 0; var r = app._multaDivToUsd(100, 'EUR'); app.TASAS.bcvEuro = 634; return r; })(), 0);
  // multa USD: cuota en USD directa; legacy Bs: cuotaBs/tasa
  eq('cuota USD multa nueva', app._multaCuotaUsd({ moneda: 'USD', cuotaDiv: 25 }), 25);
  eq('cuota legacy Bs → USD (15420/617=25)', Math.round(app._multaCuotaUsd({ cuotaBs: 15420 })), 25);
  eq('monto empresa EUR → USD', Math.round(app._multaMontoUsd({ moneda: 'EUR', montoDiv: 200 })), Math.round(200 * 634 / 617));
  // Congelamiento al pagar: cuotaBs frozen = cuotaUsd × tasa$ del día del pago
  var cuotaUsdUSD = app._multaCuotaUsd({ moneda: 'USD', cuotaDiv: 25 });
  eq('congela 25 USD a Bs con tasa pago 620 = 15500', Math.round(cuotaUsdUSD * 620), 15500);
  eq('restante divisa (4 cuotas, 1 paga, 25$ c/u) = $75', app._multaRestTxt({ moneda: 'USD', resp: 'chofer', cuotas: 4, cuotasPagas: 1, cuotaDiv: 25 }), '$75');

  console.log('\nmulti-contrato Paso 3 (unidades ↔ contratos):');
  ok('abrirMultiContrato definida', typeof app.abrirMultiContrato === 'function');
  ok('guardarUnidadMC definida', typeof app.guardarUnidadMC === 'function');
  ok('switchMCTab definida', typeof app.switchMCTab === 'function');
  app.CONTRATOS = [{ id: 'CNT1', nombre: 'Alcaldía Maracaibo', estado: 'activo' }];
  eq('_contratoNombre mapea id→nombre (enlace unidad↔contrato)', app._contratoNombre('CNT1'), 'Alcaldía Maracaibo');
  eq('_contratoNombre id desconocido → el id', app._contratoNombre('XX'), 'XX');

  console.log('\nmulti-contrato Paso 4 (operaciones → ingreso/egreso, conversión a USD):');
  ok('guardarOperacionMC definida', typeof app.guardarOperacionMC === 'function');
  app.TASAS.bcvDolar = 617; app.TASAS.bcvEuro = 634;
  eq('contrato USD → monto se queda', app._mcDivAUsd(100, { moneda: 'USD' }), 100);
  eq('contrato Bs → /tasa (61700/617=100)', Math.round(app._mcDivAUsd(61700, { moneda: 'Bs' })), 100);
  eq('contrato EUR → vía euro/dolar', Math.round(app._mcDivAUsd(100, { moneda: 'EUR' })), Math.round(100 * 634 / 617));
  eq('sin contrato (USD por defecto) se queda', app._mcDivAUsd(50, null), 50);
  app.OPERACIONES = [
    { id: 'O1', contrato_id: 'CNT1', fecha: '2026-06-10', monto_cliente: 100, monto_operador: 40 },
    { id: 'O2', contrato_id: 'CNT1', fecha: '2026-07-01', monto_cliente: 200, monto_operador: 80 }
  ];
  eq('filtro por rango incluye solo junio', app._operacionesFiltradas('2026-06-01', '2026-06-30', null).length, 1);
  eq('filtro por contrato trae las 2', app._operacionesFiltradas(null, null, 'CNT1').length, 2);

  console.log('\nmulti-contrato Paso 5/6 (P&L por contrato + consolidado):');
  ok('_pnlPorContrato definida', typeof app._pnlPorContrato === 'function');
  app.CONTRATOS = [{ id: 'CNT1', nombre: 'PDVSA', moneda: 'USD', estado: 'activo' }];
  app.OPERACIONES = [
    { id: 'O1', contrato_id: 'CNT1', fecha: '2026-06-10', monto_cliente: 100, monto_operador: 40 },
    { id: 'O2', contrato_id: 'CNT1', fecha: '2026-06-11', monto_cliente: 50, monto_operador: 20 }
  ];
  var pnl = app._pnlPorContrato('', '');
  eq('agrupa en 1 contrato', pnl.length, 1);
  eq('ingreso sumado (100+50)', pnl[0].ingreso, 150);
  eq('pago operadores sumado (40+20)', pnl[0].pago, 60);
  eq('margen = ingreso − pago', pnl[0].margen, 90);

  console.log('\nmulti-contrato Paso 7 (nómina operadores):');
  ok('_nominaOperadores definida', typeof app._nominaOperadores === 'function');
  app.OPERACIONES = [
    { id: 'O1', contrato_id: 'CNT1', operador: 'JUAN', monto_operador: 40 },
    { id: 'O2', contrato_id: 'CNT1', operador: 'JUAN', monto_operador: 20 },
    { id: 'O3', contrato_id: 'CNT1', operador: 'PEDRO', monto_operador: 30 }
  ];
  var nom = app._nominaOperadores('', '');
  eq('agrupa 2 operadores', nom.length, 2);
  eq('JUAN suma 60 y va primero (mayor pago)', nom[0].operador + '=' + nom[0].pago, 'JUAN=60');

  console.log('\nmulti-contrato: 1 unidad → varios clientes en días distintos (caso venta):');
  app.CONTRATOS = [
    { id: 'CA', nombre: 'PDVSA', moneda: 'USD', forma_cobro: 'viaje', tarifa_cliente: 50, tarifa_operador: 10, estado: 'activo' },
    { id: 'CB', nombre: 'Empresa X', moneda: 'USD', forma_cobro: 'viaje', tarifa_cliente: 80, tarifa_operador: 15, estado: 'activo' }
  ];
  // mismo camión UN1: lunes le trabaja a PDVSA, martes a Empresa X
  app.OPERACIONES = [
    { id: 'OP1', contrato_id: 'CA', unidad_id: 'UN1', fecha: '2026-06-10', operador: 'JUAN', monto_cliente: 150, monto_operador: 30 },
    { id: 'OP2', contrato_id: 'CB', unidad_id: 'UN1', fecha: '2026-06-11', operador: 'JUAN', monto_cliente: 160, monto_operador: 30 }
  ];
  var pm = app._pnlPorContrato('', '');
  eq('P&L separa por cliente (2 filas) aunque sea el mismo camión', pm.length, 2);
  var nm2 = app._nominaOperadores('', '');
  eq('nómina junta al operador entre clientes (JUAN 1 fila)', nm2.length, 1);
  eq('JUAN cobra 60 (30+30) por los 2 clientes', nm2[0].pago, 60);

  console.log('\nnómina: alias de nombres + planilla especial:');
  ok('agregarAlias definida', typeof app.agregarAlias === 'function');
  app._ALIAS_NOMBRES[app._normNom('Alexander Hernandez')] = 'ALEXANDER JOSE HERNANDEZ PEREZ';
  eq('alias resuelve nombre corto → completo (cotejo lo reconoce)', app._nombreCanonico('Alexander Hernandez'), 'ALEXANDER JOSE HERNANDEZ PEREZ');
  ok('guardarPlanillaEspecial definida', typeof app.guardarPlanillaEspecial === 'function');
  app.EMPLEADOS = [{ id: 'E1', nombre: 'JUAN PEREZ', cargo: 'Chofer' }, { id: 'E2', nombre: 'PEDRO LOPEZ', cargo: 'Ayudante', tipoAy: 'interno' }];
  eq('extra monto fijo = el monto', app._extraUsd({ modo: 'monto', monto: 15 }), 15);
  eq('extra viajes chofer (2 × $10)', app._extraUsd({ modo: 'viajes', viajes: 2, empId: 'E1' }), 20);
  eq('extra viajes ayudante (3 × $5)', app._extraUsd({ modo: 'viajes', viajes: 3, empId: 'E2' }), 15);
  app.NOMINA_EXTRAS = [
    { id: 'NE1', fecha: '2026-06-10', empId: 'E1', modo: 'monto', monto: 15 },
    { id: 'NE2', fecha: '2026-07-01', empId: 'E1', modo: 'monto', monto: 20 }
  ];
  eq('extras filtrados por período (solo junio)', app._extrasNominaPeriodo('2026-06-01', '2026-06-30').length, 1);

  console.log('\ninteligencia de flota (#6 disponibilidad + #1 costo):');
  ok('calcDisponibilidadFlota definida', typeof app.calcDisponibilidadFlota === 'function');
  app.FLOTA = { 'JAC-B001': {}, 'JAC-B002': {}, 'JAC-B003': {} };
  app.KM_DATA = { 'JAC-B002': { estado: 'En taller' } };
  var disp = app.calcDisponibilidadFlota();
  eq('total flota JAC', disp.total, 3);
  eq('2 operativas (1 en taller)', disp.operativas, 2);
  eq('67% disponibilidad', disp.pct, 67);
  ok('en riesgo (67% < 80%)', disp.enRiesgo === true);
  app.KM_DATA = {};
  eq('todas operativas → 100%', app.calcDisponibilidadFlota().pct, 100);
  ok('100% no está en riesgo', app.calcDisponibilidadFlota().enRiesgo === false);
  // interconexión: disponibilidad usa la MISMA fuente que el widget (_estadoCamReal), no solo KM_DATA
  ok('_estadoCamReal definida (fuente única)', typeof app._estadoCamReal === 'function');
  app.FLOTA = { 'JAC-B001': {}, 'JAC-B002': { estado: 'taller' }, 'JAC-B003': { estado: 'operativo' }, 'JAC-B004': {} };
  app.KM_DATA = {};
  var d2 = app.calcDisponibilidadFlota();
  eq('cuenta el taller de FLOTA.estado, no solo KM_DATA (3/4 operativas)', d2.operativas, 3);
  ok('el camión en taller aparece en "fuera"', d2.fuera.some(function (x) { return x.cam === 'JAC-B002'; }));
  // #1 flag de costo por viaje sobre el promedio +15%
  ok('calcRentabilidadCamiones definida', typeof app.calcRentabilidadCamiones === 'function');
  app.REGS = [
    { cam: 'JAC-B001', f: '2026-06-10', t: 10, m: 3000 },
    { cam: 'JAC-B002', f: '2026-06-10', t: 10, m: 3000 }
  ];
  app.GASOIL = [];
  var Rr = app.calcRentabilidadCamiones('', '');
  ok('cada fila trae costoViaje', Rr.rows.every(function (r) { return typeof r.costoViaje === 'number'; }));
  ok('cada fila trae el flag sobreCosto', Rr.rows.every(function (r) { return typeof r.sobreCosto === 'boolean'; }));
  ok('avgCostoViaje calculado', typeof Rr.avgCostoViaje === 'number');

  console.log('\ninteligencia de flota (#3 compras + #4 scoring):');
  ok('calcComprasSugeridas definida', typeof app.calcComprasSugeridas === 'function');
  app.FLOTA = { 'JAC-B001': {} };
  app.KM_DATA = { 'JAC-B001': { km: 59800 } }; // a 200 km del próximo servicio (60000)
  app.INVENTARIO = [{ nombre: 'Filtro aceite', stock: 1, stockMin: 3, precio: 10 }, { nombre: 'Correa', stock: 5, stockMin: 2, precio: 20 }];
  app.REGS = [];
  var cs = app.calcComprasSugeridas();
  ok('detecta servicio próximo (faltan ≤1000 km)', cs.servicios.some(function (s) { return s.cam === 'JAC-B001'; }));
  eq('detecta 1 insumo bajo mínimo (filtro)', cs.bajos.length, 1);
  eq('sugiere reponer filtro (min×2 − stock = 5)', cs.bajos[0].sugerido, 5);
  ok('calcScoringChoferes definida', typeof app.calcScoringChoferes === 'function');
  app.EMPLEADOS = [{ id: 'C1', nombre: 'JUAN PEREZ', cargo: 'Chofer', activo: true }];
  app.REGS = [{ cam: 'JAC-B001', f: '2026-06-10', t: 10, ch: 'JUAN PEREZ' }];
  app.MULTAS = [{ resp: 'chofer', choferId: 'C1', fecha: '2026-06-10' }, { resp: 'chofer', choferId: 'C1', fecha: '2026-06-11' }];
  app.GASOIL = [];
  var sc = app.calcScoringChoferes('', '');
  ok('scorea al chofer', sc.rows.length === 1 && sc.rows[0].id === 'C1');
  eq('2 multas → score 100−16 = 84', sc.rows[0].score, 84);

  console.log('\n#5 llantas por mm (estado + costo/mm + rendimiento por marca):');
  ok('_estadoLlMm definida', typeof app._estadoLlMm === 'function');
  eq('mm<3 → Cambiar Urgente', app._estadoLlMm(2), 'Cambiar Urgente');
  eq('mm 4 → Regular', app._estadoLlMm(4), 'Regular');
  eq('mm 8 → Buena', app._estadoLlMm(8), 'Buena');
  eq('costo/mm = precio / mm gastados (300/(14-6)=37.5)', app._llCostoMm({ precio: 300, mmInicial: 14, mm: 6 }), 37.5);
  eq('costo/mm null si falta dato', app._llCostoMm({ precio: 300, mm: 6 }), null);
  app.LLANTAS = {
    'JAC-B001': [
      { posicion: 'DI', marca: 'Goodyear', precio: 300, mmInicial: 14, mm: 6 },   // 300/8 = 37.5
      { posicion: 'DD', marca: 'Pirelli', precio: 200, mmInicial: 14, mm: 4 }     // 200/10 = 20 (rinde más)
    ]
  };
  var rm = app._llRendimientoMarca();
  eq('2 marcas comparadas', rm.length, 2);
  eq('Pirelli rinde más (menor $/mm) va primero', rm[0].marca, 'Pirelli');

  console.log('\n#2 auditoría de insumos (alerta de garantía):');
  ok('_garantiaAlerta definida', typeof app._garantiaAlerta === 'function');
  var hoyG = new Date().toISOString().slice(0, 10);
  app.INV_MOV = [{ tipo: 'Uso', cam: 'JAC-B001', item: 'Alternador', fecha: hoyG }];
  ok('detecta cambio reciente de la misma pieza (¿garantía?)', app._garantiaAlerta('Alternador', 'JAC-B001') !== null);
  eq('otra pieza no alerta', app._garantiaAlerta('Filtro', 'JAC-B001'), null);
  eq('otro camión no alerta', app._garantiaAlerta('Alternador', 'JAC-B002'), null);
  app.INV_MOV = [{ tipo: 'Uso', cam: 'JAC-B001', item: 'Alternador', fecha: '2024-01-01' }];
  eq('cambio viejo (>4 meses) no alerta', app._garantiaAlerta('Alternador', 'JAC-B001'), null);

  console.log('\n#F multa al chofer correcto (_choferDeMulta — fuente única):');
  ok('_choferDeMulta definida', typeof app._choferDeMulta === 'function');
  app.EMPLEADOS = [{ id: 'C1', nombre: 'JUAN', cargo: 'Chofer', unidad: 'JAC-B001' }, { id: 'C2', nombre: 'PEDRO', cargo: 'Chofer', unidad: 'JAC-B009' }];
  eq('usa el choferId REGISTRADO (no el actual del camión)', app._choferDeMulta({ choferId: 'C2', camId: 'JAC-B001' }).id, 'C2');
  eq('sin choferId → cae al chofer del camión', app._choferDeMulta({ camId: 'JAC-B001' }).id, 'C1');

  console.log('\n#B combustible cuenta UNA vez (compra vía CxP, sin doble conteo):');
  ok('_esCxpCombustible definida', typeof app._esCxpCombustible === 'function');
  ok('detecta CxP de compra de combustible', app._esCxpCombustible({ descripcion: 'Compra combustible 100 L @ $0.8/L' }) === true);
  ok('CxP normal NO es de combustible', app._esCxpCombustible({ descripcion: 'Repuesto alternador' }) === false);
  app.REGS = []; app.GASTOS_FIJOS = []; app.GASTOS_VARIABLES = []; app.MULTAS = [];
  app.GASOIL = [{ cam: 'COMPRA · Tumaca', m: 1000, tipo_operacion: 'compra' }, { cam: 'JAC-B001', m: 300 }];
  app.CXP = [{ descripcion: 'Compra combustible 1000 L', neto_pagar: 1000 }, { descripcion: 'Repuesto', neto_pagar: 200 }];
  // Antes: egGas(1000+300) + egCxP(1000+200) = 2500 (combustible 2-3 veces). Ahora: compra 1000 (una vez) + repuesto 200 = 1200.
  eq('combustible una sola vez: 1000 compra + 200 repuesto = 1200 (no 2500)', app._totalEgresos(0), 1200);

  console.log('\n#C patio "manual manda" (sin doble pago):');
  ok('_patioEfectivo definida', typeof app._patioEfectivo === 'function');
  eq('manual cargado manda (manual=2, asistencia=3 → 2)', app._patioEfectivo(3, 2), 2);
  eq('sin manual usa asistencia (manual=0, asistencia=3 → 3)', app._patioEfectivo(3, 0), 3);
  eq('ninguno → 0', app._patioEfectivo(0, 0), 0);
  // ayudante: a.viajes ya trae el patio de asistencia (a.patio). Con manual debe NO duplicar.
  app.PATIO_DIAS = { 'E9': 2 };
  var vpa = app._ayPatio({ viajes: 12, patio: 3, emp: { id: 'E9', tipoAy: 'interno' } }); // 12 incluye 3 de asistencia; manual=2 manda
  eq('ayudante: viajes efectivos = (12-3)+2 = 11 (no 12+2=14)', vpa.viajes, 11);
  eq('ayudante: patio efectivo = 2 (manual)', vpa.patio, 2);

  console.log('\n#A CXP normalizada (sin $NaN, pagado=pagada):');
  ok('_normCxpRow definida', typeof app._normCxpRow === 'function');
  var cxRaw = { id: 'CX1', neto_pagar: 500, base_usd: 430, total_usd: 500, estado: 'pendiente', prov_nombre: 'Tumaca' };
  var cn = app._normCxpRow(cxRaw);
  eq('fila cruda snake_case → también trae netoPagar (legacy no ve NaN)', cn.netoPagar, 500);
  eq('conserva neto_pagar (módulo nuevo)', cn.neto_pagar, 500);
  eq('prov en ambos nombres', cn.prov, 'Tumaca');
  ok('_cxpPagada acepta pagada y pagado', app._cxpPagada({ estado: 'pagada' }) === true && app._cxpPagada({ estado: 'pagado' }) === true);
  ok('_cxpPagada false en pendiente', app._cxpPagada({ estado: 'pendiente' }) === false);

  console.log('\n#K matching alias-aware (_empPorNombre no marca "no identificado" a quien la nómina paga):');
  app.EMPLEADOS = [{ id: 'E1', nombre: 'YIRBER LENITHON GONZALEZ MONTIEL', cargo: 'Chofer' }];
  app._ALIAS_NOMBRES[app._normNom('Yiber Gonzalez')] = 'YIRBER LENITHON GONZALEZ MONTIEL';
  var emA = app._empPorNombre('Yiber Gonzalez');
  ok('_empPorNombre resuelve por alias (corto→empleado completo)', emA && emA.id === 'E1');

  console.log('\n#J caja chica (saldo desde la última reposición, sin borrar gastos del período):');
  ok('calcSaldoCaja definida', typeof app.calcSaldoCaja === 'function');
  app.TASAS.bcvDolar = 100;
  app.CAJACHICA = {
    montoFijo: 150,
    reposiciones: [{ fecha: '2026-06-01', tasa: 100, montoBs: 15000, montoUsd: 150 }],
    gastos: [
      { fecha: '2026-05-20', concepto: 'viejo (otro período)', montoBs: 9000, factura: 'no' }, // antes de la reposición → NO cuenta
      { fecha: '2026-06-10', concepto: 'gasto1', montoBs: 4000, factura: 'si' },
      { fecha: '2026-06-12', concepto: 'gasto2', montoBs: 1000, factura: 'no' }
    ]
  };
  var sc2 = app.calcSaldoCaja();
  eq('saldo = 15000 − (4000+1000) del período, ignora el viejo = 10000', sc2.saldoBs, 10000);
  eq('saldo USD = 10000/100 = 100', sc2.saldoUsd, 100);

  console.log('\n#1 planilla especial: mes de la fecha (mismo formato que las planillas):');
  ok('_mesDeF definida', typeof app._mesDeF === 'function');
  eq('_mesDeF jun-26', app._mesDeF('2026-06-30'), 'jun-26');
  eq('_mesDeF ene-26', app._mesDeF('2026-01-05'), 'ene-26');
  eq('_mesDeF dic-25', app._mesDeF('2025-12-15'), 'dic-25');

  console.log('\n#2 cotejo: 3 estados (OK / planilla en otra fecha / sin planilla en el sistema):');
  ok('_audConstruir definida', typeof app._audConstruir === 'function');
  app.cfg = { chofer: 10, ayud: 5, imau: 2.5, tarifa: 317.88 };
  app.EMPLEADOS = [];
  app.TEMPORALES = {};
  app.REGS = [
    { cam: 'JAC-B001', f: '2026-06-10', t: 10, ch: 'JUAN PEREZ' },   // dentro del rango de la semana
    { cam: 'JAC-B002', f: '2026-01-05', t: 8, ch: 'PEDRO OTRA' }     // SÍ tiene planilla, pero FUERA del rango
  ];
  var hAud = {
    semana: 'SEM-X', fecha_desde: '2026-06-08', fecha_hasta: '2026-06-14',
    detalle: { choferes: [
      { n: 'JUAN PEREZ', usd: 100, pat: 0 },  // 10 viajes × $10 = $100 → cuadra
      { n: 'PEDRO OTRA', usd: 50, pat: 0 },   // planilla en otra fecha → a revisar, NO infla el $
      { n: 'EX CHOFER',  usd: 40, pat: 0 }    // sin planilla en ningún lado → informativo
    ], ayudantes: [], extras: [] }
  };
  var agA = app._audConstruir(hAud, false);
  function _filaDe(n){ return agA.filas.find(function(x){ return x.n === n; }); }
  eq('JUAN (cuadra) flag vacío', _filaDe('JUAN PEREZ').flag, '');
  eq('PEDRO → OTRA_FECHA (tiene planilla pero fuera de rango)', _filaDe('PEDRO OTRA').flag, 'OTRA_FECHA');
  eq('EX CHOFER → SIN_SISTEMA (no hay planilla suya)', _filaDe('EX CHOFER').flag, 'SIN_SISTEMA');
  eq('nSin cuenta solo el ex-chofer', agA.nSin, 1);
  eq('sumOver NO se infla con pagos sin planilla', agA.sumOver, 0);
  eq('nFlag cuenta el OTRA_FECHA a revisar', agA.nFlag, 1);
  var agSinRango = app._audConstruir({ semana: 'SEM-VIEJA', detalle: { choferes: [], ayudantes: [], extras: [] } }, false);
  ok('sinRango=true cuando el historial no tiene fecha_desde/hasta', agSinRango.sinRango === true);

  // #C matching de choferes robusto a espacios dobles / acentos (_normNom en ambos lados):
  // planilla "JOSE  ELITE" (doble espacio, viene del nombre del empleado) vs historial "JOSE ELITE" (un espacio)
  app.EMPLEADOS = [];
  app.REGS = [{ cam: 'JAC-B005', f: '2026-06-10', t: 9, ch: 'JOSE  ELITE ARANGUREN GONZALEZ' }];
  var hC = {
    semana: 'SEM-Y', fecha_desde: '2026-06-08', fecha_hasta: '2026-06-14',
    detalle: { choferes: [{ n: 'JOSE ELITE ARANGUREN GONZALEZ', usd: 90, pat: 0 }], ayudantes: [], extras: [] }
  };
  var agC = app._audConstruir(hC, false);
  var fJose = agC.filas.find(function (x) { return /ARANGUREN/.test(x.n); });
  eq('chofer con doble espacio SÍ se reconoce (9 viajes)', fJose.vj, 9);
  ok('no lo marca "sin planilla en el sistema"', fJose.flag !== 'SIN_SISTEMA');
  eq('cuadra: corr 90 = pag 90, diff 0', fJose.diff, 0);

  console.log('\ndd/mm/yyyy en todo el software (formatFecha / fmtFechaHora / fmtFechaDow):');
  ok('formatFecha definida', typeof app.formatFecha === 'function');
  eq('formatFecha YYYY-MM-DD → dd/mm/yyyy', app.formatFecha('2026-06-07'), '07/06/2026');
  eq('formatFecha con hora (slice) → dd/mm/yyyy', app.formatFecha('2026-06-07T12:00:00'), '07/06/2026');
  eq('formatFecha Date → dd/mm/yyyy', app.formatFecha(new Date(2026, 5, 7)), '07/06/2026');
  eq('formatFecha ya formateado se respeta', app.formatFecha('07/06/2026'), '07/06/2026');
  eq('formatFecha vacío → ""', app.formatFecha(''), '');
  ok('fmtFechaHora definida', typeof app.fmtFechaHora === 'function');
  eq('fmtFechaHora → dd/mm/yyyy HH:MM', app.fmtFechaHora(new Date(2026, 5, 7, 9, 5)), '07/06/2026 09:05');
  ok('fmtFechaDow definida', typeof app.fmtFechaDow === 'function');
  eq('fmtFechaDow → día + dd/mm/yyyy', app.fmtFechaDow(new Date(2026, 5, 7)), 'domingo 07/06/2026');

  console.log('\nMantenimiento — Hoja de vida (fuente única + catálogo por tipo):');
  ok('_seedMantItemsDefault definida', typeof app._seedMantItemsDefault === 'function');
  var _seed = app._seedMantItemsDefault();
  ok('catálogo trae batería y filtro trampa', _seed.some(function (x) { return x.id === 'bateria'; }) && _seed.some(function (x) { return x.id === 'filtro_trampa'; }));
  app.MANT_ITEMS = _seed; app.UNIDAD_CONFIG = {};
  var itsAll = app._hvItemsDeUnidad('JAC-B001');
  ok('unidad sin tipo NO hereda el ítem diésel (filtro trampa)', !itsAll.some(function (x) { return x.id === 'filtro_trampa'; }));
  app.UNIDAD_CONFIG = { 'JAC-B001': { tipo: 'diesel' } };
  ok('unidad diésel SÍ hereda el filtro trampa', app._hvItemsDeUnidad('JAC-B001').some(function (x) { return x.id === 'filtro_trampa'; }));
  app.MANTENIMIENTOS = [
    { id: 'm1', cam: 'JAC-B001', fecha: '2026-01-10', km: 1000, itemId: 'bateria' },
    { id: 'm2', cam: 'JAC-B001', fecha: '2026-06-01', km: 8000, itemId: 'bateria' },
    { id: 'm3', cam: 'JAC-B002', fecha: '2026-06-15', km: 5000, itemId: 'bateria' }
  ];
  eq('_ultimoMantItem devuelve el más reciente (por fecha)', app._ultimoMantItem('JAC-B001', 'bateria').fecha, '2026-06-01');
  eq('_ultimoMantItem respeta la unidad', app._ultimoMantItem('JAC-B002', 'bateria').km, 5000);
  ok('_ultimoMantItem null si no hay registro', app._ultimoMantItem('JAC-B999', 'bateria') === null);
  eq('_mantItem resuelve por id', app._mantItem('bateria').nombre, 'Batería');

  console.log('\nMantenimiento preventivo (motor puro _mantEstadoCalc):');
  ok('_mantEstadoCalc definida', typeof app._mantEstadoCalc === 'function');
  // Por KM: intervalo 5000, último a 1000 km → vence a 6000. Km actual 6200 → vencido.
  eq('km vencido', app._mantEstadoCalc('km', 5000, 500, { km: 1000, fecha: '2026-01-01' }, 6200, '2026-06-30').estado, 'vencido');
  // Km actual 5600 → restan 400 ≤ aviso 500 → próximo.
  eq('km próximo (dentro del aviso)', app._mantEstadoCalc('km', 5000, 500, { km: 1000, fecha: '2026-01-01' }, 5600, '2026-06-30').estado, 'proximo');
  // Km actual 3000 → restan 3000 → al día.
  eq('km al día', app._mantEstadoCalc('km', 5000, 500, { km: 1000, fecha: '2026-01-01' }, 3000, '2026-06-30').estado, 'al_dia');
  // Por MESES: batería 12 meses desde 2025-01-01 → vence 2025-12-27 aprox → hoy 2026-06-30 → vencido.
  eq('tiempo vencido (batería 12m)', app._mantEstadoCalc('meses', 12, 15, { km: 0, fecha: '2025-01-01' }, 0, '2026-06-30').estado, 'vencido');
  // Por DÍAS: filtro trampa cada 2 días desde 2026-06-29 → vence 07-01 → hoy 06-30 → resta 1 día ≤ aviso 0? no (1>0) → al día... usar aviso 2 → próximo.
  eq('días próximo (aviso cubre)', app._mantEstadoCalc('dias', 2, 2, { km: 0, fecha: '2026-06-29' }, 0, '2026-06-30').estado, 'proximo');
  eq('sin registro → sin_dato', app._mantEstadoCalc('km', 5000, 500, null, 9000, '2026-06-30').estado, 'sin_dato');
  eq('sin intervalo → sin_intervalo', app._mantEstadoCalc('km', 0, 0, { km: 0, fecha: '2026-01-01' }, 100, '2026-06-30').estado, 'sin_intervalo');

  // ── Resumen ──
  console.log('\n──────────────');
  console.log('PASS: ' + pass + '   FAIL: ' + fail);
  process.exit(fail > 0 ? 1 : 0);
})();
