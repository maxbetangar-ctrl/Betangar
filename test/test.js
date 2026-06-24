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
app.compCostoUnit('tumaca', function (v) { eq("tumaca default 0.54", v, 0.54); });
app.compCostoUnit('boscan', function (v) { eq("boscan default 0.50", v, 0.50); });

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

// ── Resumen ──
console.log('\n──────────────');
console.log('PASS: ' + pass + '   FAIL: ' + fail);
process.exit(fail > 0 ? 1 : 0);
