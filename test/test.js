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

// ── Resumen ──
console.log('\n──────────────');
console.log('PASS: ' + pass + '   FAIL: ' + fail);
process.exit(fail > 0 ? 1 : 0);
