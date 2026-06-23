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

// ── compCostoUnit: precio $/L FIJO por fuente (sin DOM → usa defaults) ──
console.log('\ncompCostoUnit (defaults, sin inputs en el DOM stub):');
app.compCostoUnit('tumaca', function (v) { eq("tumaca default 0.54", v, 0.54); });
app.compCostoUnit('boscan', function (v) { eq("boscan default 0.50", v, 0.50); });

// ── _parseHistBCV: extrae fecha+precio del histórico pydolarve en cualquier forma ──
console.log('\n_parseHistBCV (robusto a la anidación):');
ok("_parseHistBCV definida", typeof app._parseHistBCV === 'function');
eq("arreglo plano DD-MM-YYYY",
  app._parseHistBCV([{date:'22-06-2026',price:617.6},{date:'21-06-2026',price:616}]),
  [{fecha:'2026-06-21',bcv_dolar:616,fuente:'pydolarve (historico)'},{fecha:'2026-06-22',bcv_dolar:617.6,fuente:'pydolarve (historico)'}]);
eq("anidado bcv[] con datetime.date",
  app._parseHistBCV({bcv:[{datetime:{date:'22-06-2026'},price:617.6}]}).map(r=>r.fecha+'='+r.bcv_dolar),
  ['2026-06-22=617.6']);
eq("anidado bcv.history con fecha/promedio (ISO)",
  app._parseHistBCV({bcv:{history:[{fecha:'2026-06-20',promedio:615}]}}).map(r=>r.fecha+'='+r.bcv_dolar),
  ['2026-06-20=615']);
eq("anidado monitors.usd",
  app._parseHistBCV({monitors:{usd:[{date:'20-06-2026',price:615}]}}).map(r=>r.fecha),
  ['2026-06-20']);
eq("sin datos → []", app._parseHistBCV({error:'no data'}), []);
eq("ignora precios basura (<100)", app._parseHistBCV([{date:'22-06-2026',price:0}]), []);

// ── Resumen ──
console.log('\n──────────────');
console.log('PASS: ' + pass + '   FAIL: ' + fail);
process.exit(fail > 0 ? 1 : 0);
