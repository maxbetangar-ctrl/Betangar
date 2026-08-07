// El personal IMAU cobra POR SU UNIDAD, en su propia lista, todas las semanas.
//
// Regla dictada por Alejandra (RRHH) el 2026-08-07, después de reportar que EDWIN MONTIEL y
// WUILLIBALDO ATENCIO figuraban entre los ayudantes internos con el monto errado:
//
//   «Debe estar aparte. Sabemos que son ayudantes pero al final del día es un personal EXTERNO y
//    sus condiciones de pago son diferentes: no podemos mezclar peras con manzanas.»
//   «En las planillas NO podemos colocar a los ayudantes IMAU. Se asignan a una unidad y su pago
//    sale de acuerdo a los viajes que realizó ESE DÍA LA UNIDAD.»
//   «Que aparezcan en TODAS las semanas: el pago que se les realiza también cuenta en la utilidad.»
//
// Escalón por día, sobre los viajes de la UNIDAD:  4v → $5 · 3v → $5 · 2v → $2 · 1v → $0
//
// Su propio ejemplo, que es el caso 1 de esta prueba:
//   «Edwin Montiel se asigna a la unidad B001 y su pago sale de acuerdo a los viajes que realizó
//    ese día la unidad. Lunes 3 viajes = $5. Martes 1 viaje = $0. Miércoles 2 viajes [= $2].»
const app = require('./harness');

let pass = 0, fail = 0;
function eq(name, got, exp) {
  const c = JSON.stringify(got) === JSON.stringify(exp);
  if (c) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ ' + name + '  → got ' + JSON.stringify(got) + ', exp ' + JSON.stringify(exp)); }
}
function ok(name, cond) { eq(name, !!cond, true); }

// Lun 20 a jue 23/07 — sin domingo ni feriado, para que el escalón se vea limpio.
const P = (p, f, cam, ch, ay1, d) => ({ p, f, cam, ch, ay1, ay2: '', ay3: '', ap1: '', ap2: '', d, n: 0, t: d, mes: 'jul-26', sem: 'Semana 3' });
const REGS = [
  // B001 — el ejemplo de Alejandra: lunes 3, martes 1, miércoles 2. El jueves no salió.
  P('03001', '2026-07-20', 'JAC-B001', 'CHOFER UNO', 'AYUDANTE INTERNO UNO', 3),
  P('03002', '2026-07-21', 'JAC-B001', 'CHOFER UNO', 'AYUDANTE INTERNO UNO', 1),
  P('03003', '2026-07-22', 'JAC-B001', 'CHOFER UNO', 'AYUDANTE INTERNO UNO', 2),
  // B007 — 3 viajes el lunes y NINGÚN ayudante escrito. Este es el caso exacto de la semana 19:
  // antes, esos 3 viajes se le adjudicaban a los DOS IMAU del B007 como ayudantes internos.
  P('03004', '2026-07-20', 'JAC-B007', 'CHOFER DOS', '', 3)
];
const E = (id, nombre, cargo, unidad, extra) => Object.assign(
  { id, nombre, cargo, unidad, cedula: 'V-' + id, activo: true, tipoAy: cargo === 'Ayudante' ? 'interno' : '', imau: false, fegreso: '' },
  extra || {});
const EMPLEADOS = [
  E('E101', 'CHOFER UNO', 'Chofer', 'JAC-B001'),
  E('E102', 'CHOFER DOS', 'Chofer', 'JAC-B007'),
  E('E103', 'AYUDANTE INTERNO UNO', 'Ayudante', 'JAC-B001'),
  E('E039', 'EDWIN MONTIEL', 'Ayudante', 'JAC-B001', { tipoAy: 'imau', imau: true }),      // el del ejemplo
  E('E047', 'WUILLIBALDO ATENCIO', 'Ayudante', 'JAC-B007', { tipoAy: 'imau', imau: true }),
  E('E046', 'ALBERTO ATENCIO', 'Ayudante', 'JAC-B007', { tipoAy: 'imau', imau: true }),    // 2º IMAU en la misma unidad
  E('E900', 'IMAU SIN UNIDAD', 'Ayudante', '', { tipoAy: 'imau', imau: true }),            // su unidad no salió
  E('E901', 'IMAU DE BAJA', 'Ayudante', 'JAC-B001', { tipoAy: 'imau', imau: true, activo: false })
];

function sembrar() {
  app.REGS = REGS;
  app.EMPLEADOS = EMPLEADOS;
  app.cfg = Object.assign({}, app.cfg || {}, { chofer: 10, ayud: 5, imau: 2.5, tasa: 100 });
  app.TASAS = { bcvDolar: 100 };
  app.PRESTAMOS = []; app.MULTAS = []; app.NOMINA_EXTRAS = []; app.NOM_ADM = [];
  app.PATIO_DIAS = {}; app.TEMPORALES = {}; app.ASISTENCIA = {}; app.IMAU_APOYO = [];
  app.NOMINA_HIST = []; app.FICHAJES_SET = new Set();
}
const imau = (n) => (app._ultimaNomina.imau || []).find(x => x.n === n);
const ayud = (n) => (app._ultimaNomina.ayudantes || []).find(x => x.n === n);

sembrar(); app.calcNom();

// ── 1. El ejemplo tal cual lo dio Alejandra ─────────────────────────────────────────────────
console.log('\nEl ejemplo de Alejandra: Edwin en el B001 (lun 3v, mar 1v, mié 2v):');
const edwin = imau('EDWIN MONTIEL');
ok('Edwin sale en la lista de IMAU', !!edwin);
eq('lunes: 3 viajes de la unidad = $5', edwin.dias.find(d => d.f === '2026-07-20').usd, 5);
eq('martes: 1 viaje = $0', edwin.dias.find(d => d.f === '2026-07-21').usd, 0);
eq('miércoles: 2 viajes = $2', edwin.dias.find(d => d.f === '2026-07-22').usd, 2);
eq('la semana le queda en $7', edwin.usd, 7);
eq('días pagos: 2 (el de 1 viaje no paga)', edwin.diasPagos, 2);
eq('el jueves no aparece: su unidad no salió', edwin.dias.length, 3);

// ── 2. Peras y manzanas: el IMAU NO va en la lista de ayudantes internos ────────────────────
console.log('\nEl IMAU no se mezcla con los ayudantes internos:');
ok('Edwin NO está entre los ayudantes', !ayud('EDWIN MONTIEL'));
ok('Wuillibaldo tampoco', !ayud('WUILLIBALDO ATENCIO'));
ok('el ayudante INTERNO sí está donde le toca', !!ayud('AYUDANTE INTERNO UNO'));

// ── 3. El caso de la semana 19: planilla sin ayudante escrito ───────────────────────────────
// Antes, esos 3 viajes del B007 se le adjudicaban a los dos IMAU como ayudantes internos, a $5 el
// viaje: $15 cada uno, $30 en total por 3 viajes. Ahora cobran su escalón: $5 cada uno.
console.log('\nLa planilla del B007 sin ayudante escrito ya no los paga como internos:');
eq('Wuillibaldo cobra el escalón del día (3 viajes = $5)', imau('WUILLIBALDO ATENCIO').usd, 5);
eq('Alberto, el otro IMAU de esa unidad, igual', imau('ALBERTO ATENCIO').usd, 5);
ok('y ninguno de los dos aparece como ayudante interno', !ayud('WUILLIBALDO ATENCIO') && !ayud('ALBERTO ATENCIO'));

// ── 4. Aparecen TODAS las semanas, aunque cobren $0 ─────────────────────────────────────────
console.log('\nAparecen aunque no cobren (su pago cuenta en la utilidad):');
const sinUnidad = imau('IMAU SIN UNIDAD');
ok('el IMAU cuya unidad no salió igual aparece', !!sinUnidad);
eq('con $0', sinUnidad.usd, 0);
eq('y sin días', sinUnidad.dias.length, 0);
ok('el IMAU dado de baja NO aparece', !imau('IMAU DE BAJA'));
eq('en total son 4 personas IMAU activas', (app._ultimaNomina.imau || []).length, 4);

// ── 5. Su pago entra en el total de la semana ───────────────────────────────────────────────
console.log('\nEl pago del IMAU cuenta en el total:');
eq('total IMAU = $7 (Edwin) + $5 + $5 (los del B007) + $0', app._ultimaNomina.totImau, 17);

// ── 6. El escalón completo, tal como lo dictó ──────────────────────────────────────────────
console.log('\nEl escalón, tal como lo dictó RRHH:');
eq('4 viajes → $5', app.tarifaApoyoDia(4), 5);
eq('3 viajes → $5', app.tarifaApoyoDia(3), 5);
eq('2 viajes → $2', app.tarifaApoyoDia(2), 2);
eq('1 viaje  → $0', app.tarifaApoyoDia(1), 0);
eq('0 viajes → $0', app.tarifaApoyoDia(0), 0);

// ── 7. Varias planillas de la misma unidad el mismo día SUMAN antes del escalón ─────────────
// Si el B001 hace 1 viaje en el recorrido normal y 1 en la jornada especial, ese día hizo 2 → $2.
// Aplicar el escalón por planilla daría $0 + $0 = $0, que no es lo que trabajó la unidad.
console.log('\nDos planillas de la misma unidad el mismo día son UN día de 2 viajes:');
app.REGS = REGS.concat([P('03005', '2026-07-21', 'JAC-B001', 'CHOFER UNO', 'AYUDANTE INTERNO UNO', 1)]);
app.calcNom();
eq('el martes pasa de 1 viaje ($0) a 2 viajes ($2)', imau('EDWIN MONTIEL').dias.find(d => d.f === '2026-07-21').usd, 2);
eq('y su semana pasa de $7 a $9', imau('EDWIN MONTIEL').usd, 9);

console.log('\n──────────────');
console.log('PASS: ' + pass + '   FAIL: ' + fail);
if (fail) process.exit(1);
