// ═══════════════════════════════════════════════════════════════════════════════════════════════
// COSTO POR TONELADA — las pruebas del motor que pidió Máximo el 19/10/2026
//
// Lo que se prueba acá no es «da un número»: es que NO da un número cuando no puede, porque ese
// es el modo de fallar que hace daño. Un costo por tonelada demasiado bajo se ve igual que uno
// correcto, y con él se decide si una tarifa deja o no deja.
//
// Cada prueba va con CONTROL POSITIVO y NEGATIVO donde importa: no basta ver que la cuota de la
// financiadora suma — hay que ver que SIN ella el número es otro, o la prueba pasa por el motivo
// equivocado. [[norma-test-que-pasa-por-el-motivo-equivocado]]
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
const cerca = (a, b, tol) => Math.abs(a - b) <= (tol == null ? 0.005 : tol);

console.log('Funciones cargadas:');
['_tonsPorViaje', 'financiadoraDevengadaUsd', 'calcCostoPorTonelada', '_gastoBancoRango', 'cargarCuotasFinanciamiento']
  .forEach((f) => ok(f + ' definida', typeof app[f] === 'function'));

// ── _tonsPorViaje: 8 por defecto, y la basura NO apaga el cálculo ──────────────────────────────
console.log('\n_tonsPorViaje (la unidad de costo la declara la empresa):');
app.cfg.tonsViaje = undefined;
eq('sin declarar → 8 (lo que dijo Máximo el 19/10/2026)', app._tonsPorViaje(), 8);
app.cfg.tonsViaje = 12.5;
eq('declarado 12,5 → 12,5', app._tonsPorViaje(), 12.5);
app.cfg.tonsViaje = '10';
eq('declarado como texto "10" → 10', app._tonsPorViaje(), 10);
// ⛔ Un 0 acá no significa «cero toneladas»: significa que no hay nada entre lo que dividir, y el
//    costo por tonelada dejaría de existir sin que nadie lo pidiera.
app.cfg.tonsViaje = 0;
eq('0 NO apaga el cálculo: vuelve a 8', app._tonsPorViaje(), 8);
app.cfg.tonsViaje = -3;
eq('negativo tampoco', app._tonsPorViaje(), 8);
app.cfg.tonsViaje = 'ocho';
eq('basura tampoco', app._tonsPorViaje(), 8);
app.cfg.tonsViaje = 8;

// ── La financiadora: DEVENGADA, no pagada ─────────────────────────────────────────────────────
console.log('\nfinanciadoraDevengadaUsd (la cuota que venció, pagada o no):');
// El cuadro real de AUTO UNIÓN: 18 cuotas de US$ 23.417,11 desde el 01/04/2026.
app.DEUDA_CUOTAS = [
  { nro: 1, vencimiento: '2026-04-01', cuota: 23417.11, interes: 3840.00, capital: 19577.11, acreedor: 'AUTO UNION DC' },
  { nro: 2, vencimiento: '2026-05-01', cuota: 23417.11, interes: 3644.23, capital: 19772.88, acreedor: 'AUTO UNION DC' },
  { nro: 3, vencimiento: '2026-06-01', cuota: 23417.11, interes: 3446.50, capital: 19970.61, acreedor: 'AUTO UNION DC' },
  { nro: 18, vencimiento: '2027-09-01', cuota: 23417.03, interes: 231.85, capital: 23185.18, acreedor: 'AUTO UNION DC' }
];
app.DEUDA_CUOTAS_ESTADO = 'ok';
app.DEUDA_CUOTAS_ERROR = '';

let f = app.financiadoraDevengadaUsd('2026-04-01', '2026-06-30');
eq('3 cuotas vencidas en el trimestre', f.n, 3);
ok('suman 3 × 23.417,11', cerca(f.usd, 70251.33));
ok('capital + interés = la cuota (los tres números cierran)', cerca(f.capital + f.interes, f.usd));
eq('dice de quién es la deuda', f.acreedores, ['AUTO UNION DC']);

f = app.financiadoraDevengadaUsd('2026-05-01', '2026-05-31');
eq('un mes = una cuota', f.n, 1);
ok('una cuota = 23.417,11', cerca(f.usd, 23417.11));

// ⛔ CONTROL NEGATIVO: la cuota de 2027 NO puede caer en un rango de 2026. Cargarle a un período
//    una cuota que todavía no venció es restarle un gasto que no ocurrió.
f = app.financiadoraDevengadaUsd('2026-01-01', '2026-12-31');
eq('la cuota de 2027 queda afuera de 2026', f.n, 3);
f = app.financiadoraDevengadaUsd('2026-07-01', '2026-07-31');
eq('un mes sin vencimientos da 0 cuotas', f.n, 0);
eq('…y 0 dólares, no un arrastre del rango anterior', f.usd, 0);

// El estado viaja con el resultado: quien lo muestre tiene que poder decir POR QUÉ falta.
app.DEUDA_CUOTAS = [];
app.DEUDA_CUOTAS_ESTADO = 'sin_permiso';
app.DEUDA_CUOTAS_ERROR = 'este usuario no puede ver los financiamientos';
f = app.financiadoraDevengadaUsd('2026-04-01', '2026-06-30');
eq('sin permiso → 0 y el estado lo dice', [f.usd, f.estado], [0, 'sin_permiso']);
ok('…y trae la causa en texto', String(f.error).length > 0);

// ── El motor completo ─────────────────────────────────────────────────────────────────────────
// Planillas de prueba: 100 viajes en abril, 50 en mayo. Tarifa 317,88 → 8 t por viaje.
app.REGS = [
  { f: '2026-04-10', cam: 'JAC-B001', t: 60, m: 60 * 317.88 },
  { f: '2026-04-20', cam: 'JAC-B002', t: 40, m: 40 * 317.88 },
  { f: '2026-05-15', cam: 'JAC-B003', t: 50, m: 50 * 317.88 }
];
app.DEUDA_CUOTAS = [
  { nro: 1, vencimiento: '2026-04-01', cuota: 23417.11, interes: 3840.00, capital: 19577.11, acreedor: 'AUTO UNION DC' }
];
app.DEUDA_CUOTAS_ESTADO = 'ok';
app.DEUDA_CUOTAS_ERROR = '';

(async function () {
  console.log('\ncalcCostoPorTonelada — SIN banco y CON rango: se niega, no inventa:');
  // En el harness no hay Supabase, así que `_gastoBancoRango` falla igual que cuando el banco no
  // contesta en producción. Con un rango puesto, el camino viejo sumaría los gastos de TODA la
  // historia y los dividiría entre las toneladas del rango: un número falso, no incompleto.
  let R = await app.calcCostoPorTonelada('2026-04-01', '2026-04-30');
  ok('no devuelve número: devuelve el motivo', !!R.bloqueado);
  ok('…y el motivo nombra al banco y al rango',
    /banco/i.test(R.bloqueado) && /rango/i.test(R.bloqueado));
  eq('el costo por tonelada queda en 0 y NO se muestra', R.costoTon, 0);

  console.log('\ncalcCostoPorTonelada — SIN rango: el respaldo da número y lo DECLARA:');
  R = await app.calcCostoPorTonelada('', '');
  ok('da número (o lo bloquea por falta de viajes, nunca en silencio)', R.bloqueado === null);
  eq('las toneladas son viajes × 8', R.tons, 150 * 8);
  eq('y los viajes son los de las planillas', R.viajes, 150);
  ok('avisa que el gasto NO viene del banco',
    R.avisos.some((a) => /no viene del banco/i.test(a)));
  ok('la fuente lo dice también', /a mano/i.test(R.fuente));

  console.log('\nLa cuota de la financiadora SUMA al costo (control positivo y negativo):');
  // Positivo: con la cuota cargada, el costo total la incluye.
  const conFin = R.costoTon, finUsd = R.fin.usd;
  ok('la cuota del período entró (1 cuota)', R.fin.n === 1 && cerca(finUsd, 23417.11));
  ok('costoTotal = gasto + cambiario + cuota',
    cerca(R.costoTotal, R.gasto + R.cambiario + finUsd, 0.01));
  ok('el costo por tonelada SIN financiadora es MENOR', R.costoTonSinFin < conFin);
  // Tolerancia de un centavo: los dos por-tonelada se redondean a centavos a propósito, para que
  // los tres números de la pantalla cierren cuando alguien los resta a mano.
  ok('y la diferencia es la cuota entre las toneladas (al centavo)',
    cerca(conFin - R.costoTonSinFin, finUsd / R.tons, 0.01));

  // Negativo: si la deuda no se pudo leer, el número baja Y la pantalla tiene que poder decirlo.
  app.DEUDA_CUOTAS = [];
  app.DEUDA_CUOTAS_ESTADO = 'sin_permiso';
  app.DEUDA_CUOTAS_ERROR = 'este usuario no puede ver los financiamientos';
  const R2 = await app.calcCostoPorTonelada('', '');
  ok('sin poder leer la deuda el costo por tonelada BAJA', R2.costoTon < conFin);
  ok('⛔ y lo avisa en vez de callarlo',
    R2.avisos.some((a) => /financiadora NO está sumada/i.test(a)));
  app.DEUDA_CUOTAS_ESTADO = 'ok';
  app.DEUDA_CUOTAS = [
    { nro: 1, vencimiento: '2026-04-01', cuota: 23417.11, interes: 3840.00, capital: 19577.11, acreedor: 'AUTO UNION DC' }
  ];

  console.log('\nSin viajes NO hay costo por tonelada (dividir por cero no da «barato»):');
  const regs = app.REGS;
  app.REGS = [];
  const R3 = await app.calcCostoPorTonelada('', '');
  ok('se bloquea en vez de mostrar $0,00', !!R3.bloqueado);
  ok('…y dice que no hay toneladas entre las que dividir', /toneladas/i.test(R3.bloqueado));
  eq('el costo no se pinta', R3.costoTon, 0);
  app.REGS = regs;

  console.log('\nLas toneladas por viaje mandan en el resultado:');
  app.cfg.tonsViaje = 10;
  const R4 = await app.calcCostoPorTonelada('', '');
  eq('con 10 t/viaje las toneladas cambian', R4.tons, 150 * 10);
  ok('y el costo por tonelada BAJA al repartirse entre más toneladas', R4.costoTon < conFin);
  app.cfg.tonsViaje = 8;

  console.log('\n⛔ Consultar un rango NO puede pisar el gasto del período completo:');
  // `EGRESOS_BANCO` es el global que usan el dashboard y la Utilidad Real. Si la consulta por
  // rango lo sobreescribiera, el dueño vería la utilidad de un mes donde dice la del año, y nada
  // se lo diría. [[norma-un-candado-que-vacia-una-columna-no-se-nota]]
  app.EGRESOS_BANCO = { gasto: 484481, cobrado: 412307, utilidad: 70060, desde: '2026-01-01', hasta: '2026-10-19' };
  const antes = JSON.stringify(app.EGRESOS_BANCO);
  await app._gastoBancoRango('2026-05-01', '2026-05-31');
  await app.calcCostoPorTonelada('2026-05-01', '2026-05-31');
  eq('EGRESOS_BANCO quedó intacto', JSON.stringify(app.EGRESOS_BANCO), antes);
  app.EGRESOS_BANCO = null;

  console.log('\nPASS: ' + pass + '   FAIL: ' + fail);
  process.exit(fail ? 1 : 0);
})();
