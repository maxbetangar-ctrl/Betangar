// ═══════════════════════════════════════════════════════════════════════════════════════════════
// EL PERÍODO DEL RESUMEN FINANCIERO — pruebas de `_finPeriodo()`
//
// El selector «Esta Semana / Este Mes / Todo» estuvo en la pantalla sin hacer NADA: quien
// eligiera «Este Mes» veía los números de toda la historia. Lo que se prueba acá es la traducción
// del selector a dos fechas, que es donde un error no se ve: un rango corrido por un día da un
// número creíble y equivocado.
//
// ⛔ La semana es LUNES a DOMINGO y se numera DENTRO del mes — la misma definición que usan
//    nómina y el histórico, no una segunda. [[norma-semana-real-no-bloque-de-dias]]
// ═══════════════════════════════════════════════════════════════════════════════════════════════
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

// El harness devuelve un elemento nuevo en cada `getElementById`, así que `gv()` no puede leer un
// valor puesto a mano. Se sustituye `gv` por una tabla de valores: lo que se prueba es la
// TRADUCCIÓN del selector a fechas, no el DOM (eso lo mira el script del navegador).
const SEL = {};
app.gv = function (id) { return SEL[id] != null ? SEL[id] : ''; };

console.log('Funciones cargadas:');
['_finPeriodo', '_finPrepararSelectores', '_lunesMes1', '_numSemanaMes', 'mesBtg']
  .forEach((f) => ok(f + ' definida', typeof app[f] === 'function'));

// ── TODO: sin fechas, y eso es lo que la pantalla venía mostrando ─────────────────────────────
console.log('\nTodo (el default, porque es lo que la pantalla mostraba de verdad):');
SEL['fin-periodo'] = 'todo';
let P = app._finPeriodo();
eq('modo todo', P.modo, 'todo');
eq('sin fecha desde', P.des, '');
eq('sin fecha hasta', P.hta, '');
ok('la etiqueta lo dice', /toda la historia/i.test(P.etiqueta));
// ⛔ Un selector vacío o con basura NO puede filtrar por un rango inventado: cae en «todo».
SEL['fin-periodo'] = '';
eq('vacío cae en todo', app._finPeriodo().modo, 'todo');
SEL['fin-periodo'] = 'trimestre-que-no-existe';
eq('un valor que no existe cae en todo, no en un rango raro', app._finPeriodo().modo, 'todo');

// ── MES: del día 1 al ÚLTIMO del mes en curso ────────────────────────────────────────────────
console.log('\nEste mes (del 1 al último día, no «hasta hoy»):');
SEL['fin-periodo'] = 'mes';
P = app._finPeriodo();
const hoy = new Date();
const pad = (n) => String(n).padStart(2, '0');
const primero = hoy.getFullYear() + '-' + pad(hoy.getMonth() + 1) + '-01';
const ultimo = app._isoLocal(new Date(hoy.getFullYear(), hoy.getMonth() + 1, 0, 12, 0, 0));
eq('arranca el día 1 del mes en curso', P.des, primero);
eq('termina el ÚLTIMO día del mes', P.hta, ultimo);
ok('la etiqueta trae las dos fechas en dd/mm/yyyy',
  /\d{2}\/\d{2}\/\d{4} al \d{2}\/\d{2}\/\d{4}/.test(P.etiqueta));
// ⛔ CONTROL: el último día NO es «hoy». Si lo fuera, el gasto del período se cortaría a mitad de
//    mes mientras las toneladas siguieran contando, y el costo por tonelada saldría más barato.
ok('el último día del mes es ≥ hoy', P.hta >= app._isoLocal(hoy));

// ── SEMANA: lunes a domingo, numerada dentro del mes ─────────────────────────────────────────
console.log('\nUna semana (lunes a domingo, numerada dentro del mes):');
SEL['fin-periodo'] = 'semana';
SEL['fin-sem-sel'] = 'Semana 1';
P = app._finPeriodo();
eq('la semana 1 arranca en el lunes de la semana del día 1', P.des, app._isoLocal(app._lunesMes1(app.mesBtg())));
const d1 = new Date(P.des + 'T12:00:00'), h1 = new Date(P.hta + 'T12:00:00');
eq('el desde es LUNES', d1.getDay(), 1);
eq('el hasta es DOMINGO', h1.getDay(), 0);
eq('son 7 días exactos', Math.round((h1 - d1) / 86400000), 6);
ok('la etiqueta nombra la semana y el mes', /Semana 1 de /.test(P.etiqueta));

// Cada semana que se elige corre el rango 7 días, sin huecos ni solapes.
SEL['fin-sem-sel'] = 'Semana 3';
const P3 = app._finPeriodo();
eq('la semana 3 arranca 14 días después de la 1', P3.des, app._isoLocal(
  new Date(app._lunesMes1(app.mesBtg()).getTime() + 14 * 86400000)));
SEL['fin-sem-sel'] = 'Semana 2';
const P2 = app._finPeriodo();
eq('la semana 2 empieza justo el día después de que termina la 1',
  P2.des, app._isoLocal(new Date(new Date(P.hta + 'T12:00:00').getTime() + 86400000)));
eq('y la 3 justo después de la 2',
  P3.des, app._isoLocal(new Date(new Date(P2.hta + 'T12:00:00').getTime() + 86400000)));

// ⛔ Sin semana elegida NO se cae en la 1: se usa la semana EN CURSO. Mostrar la primera semana
//    del mes cuando estamos en la tercera es un número viejo con cara de nuevo.
SEL['fin-sem-sel'] = '';
const Pw = app._finPeriodo();
eq('sin semana elegida usa la semana EN CURSO', Pw.sem, app._numSemanaMes(app._isoLocal(hoy)));
ok('y el día de hoy cae DENTRO de ese rango',
  app._isoLocal(hoy) >= Pw.des && app._isoLocal(hoy) <= Pw.hta);

// ── El período y el costo por tonelada tienen que ser EL MISMO ───────────────────────────────
// Los dos paneles de la pantalla leen `_finPeriodo()`. Si el costo por tonelada volviera a tener
// su propio Desde/Hasta, la pantalla mostraría dos períodos distintos uno debajo del otro.
console.log('\nUn solo período para toda la pantalla:');
ok('renderCostoTonelada NO lee campos de fecha propios',
  !/gv\('ct-des'\)/.test(String(app.renderCostoTonelada)));
ok('…lee _finPeriodo()', /_finPeriodo/.test(String(app.renderCostoTonelada)));

console.log('\nPASS: ' + pass + '   FAIL: ' + fail);
process.exit(fail ? 1 : 0);
