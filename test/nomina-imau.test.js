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
  app.NOMINA_HIST = [];
  // Asistencia: el IMAU cobra solo si fue. Por defecto acá se los da por PRESENTES vía fichaje,
  // para poder probar el escalón sin que la asistencia lo tape. Los casos de ausencia y de
  // "sin dato" tienen su propio bloque más abajo.
  app.IMAU_ASIS = {};
  app.FICHAJES_SET = new Set();
  ['E039', 'E047', 'E046', 'E900'].forEach(function (id) {
    ['2026-07-20', '2026-07-21', '2026-07-22', '2026-07-23'].forEach(function (f) {
      app.FICHAJES_SET.add(id + '|' + f);
    });
  });
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
// ⛔ ANTES acá se esperaba `0` días: la lista de cada IMAU se armaba con los días de SU unidad, así
// que a quien no tenía unidad (o cuya unidad no salió) no se le podía declarar nada. Máximo,
// 2026-08-09: «todos pueden montarse en diversas unidades… se pueden cambiar a otra sin problema».
// Con eso, filtrar por la unidad de la ficha ESCONDE los días en que la persona anduvo en otro
// camión — que es precisamente lo que hay que poder declarar. Ahora se ofrecen TODOS los días con
// actividad; los que no le correspondan quedan en $0, que es lo que ya pasaba.
eq('igual se le ofrecen los días para declarar dónde anduvo', sinUnidad.dias.length, 3);
eq('pero sin unidad y sin declaración no paga nada', sinUnidad.dias.filter(d => d.usd > 0).length, 0);

// ── 4b. SE CAMBIAN DE UNIDAD ────────────────────────────────────────────────────────────────
// Máximo, 2026-08-09: «todos pueden montarse en diversas unidades; puede que casi siempre un
// tiempo se monten en una, pero se pueden cambiar a otra sin problema».
// El pago salía SIEMPRE de la unidad de la ficha, así que a quien se cambiaba se le pagaba por un
// camión en el que no estuvo — y no había forma de notarlo, porque el dato del día no existía.
console.log('\nSe monta en otra unidad: cobra por donde ANDUVO, no por la de su ficha:');
sembrar();
app.IMAU_ASIS = { 'E900': { '2026-07-20': { e: 'P', u: 'JAC-B001' } } };   // el lunes anduvo en el B001 (3v)
app.calcNom();
eq('el que no tenía unidad cobra el escalón del camión en que se montó', imau('IMAU SIN UNIDAD').usd, 5);
eq('y solo ese día: los otros siguen en $0', imau('IMAU SIN UNIDAD').dias.filter(d => d.usd > 0).length, 1);
eq('a los del B001 no les cambia nada', imau('EDWIN MONTIEL').usd, 7);

// ── 4c. EL DÍA PARTIDO ──────────────────────────────────────────────────────────────────────
// Máximo, 2026-08-09: «pudieran hacer 2 en una unidad y, si quieren seguir trabajando y su unidad
// se guarda, se montan y hacen 1 en otra». El escalón va sobre el TOTAL de la persona, no sobre lo
// que hizo un camión: 2 + 1 = 3 viajes = $5.
// El martes el B001 hizo UN viaje: por la unidad, Edwin cobraría $0. Si además hizo otro en otro
// camión, son 2 y le tocan $2. Ese reparto no lo sabe el sistema — lo declara RRHH.
console.log('\nEl día partido entre dos unidades paga por el TOTAL de la persona:');
sembrar();
app.IMAU_ASIS = { 'E039': { '2026-07-21': { e: 'P', v: 2 } } };   // martes: 1 en el suyo + 1 en otro
app.calcNom();
const _mar = imau('EDWIN MONTIEL').dias.find(d => d.f === '2026-07-21');
eq('el martes deja de valer $0 y pasa a $2', _mar.usd, 2);
eq('porque cuentan 2 viajes, no el 1 de su unidad', _mar.viajes, 2);
eq('y la semana le sube de $7 a $9', imau('EDWIN MONTIEL').usd, 9);
// ⛔ El candado: sin declaración escrita NO se inventan viajes. Vacío = los de su unidad.
sembrar(); app.calcNom();
eq('sin esa declaración el martes sigue en $0, no se supone nada', imau('EDWIN MONTIEL').dias.find(d => d.f === '2026-07-21').usd, 0);
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

// ── 8. Varios IMAU en la misma unidad: CADA UNO cobra su escalón completo ───────────────────
// Confirmado por Alejandra el 07/08: «Cobran 5 cada uno». No se reparte entre ellos.
console.log('\nVarios IMAU en la misma unidad cobran cada uno su escalón completo:');
sembrar(); app.calcNom();
eq('Wuillibaldo (B007, 3 viajes el lunes) cobra $5', imau('WUILLIBALDO ATENCIO').usd, 5);
eq('Alberto, en la MISMA unidad y el mismo día, también $5', imau('ALBERTO ATENCIO').usd, 5);
eq('o sea $10 por un día de 3 viajes en esa unidad, no $5 repartido',
  imau('WUILLIBALDO ATENCIO').usd + imau('ALBERTO ATENCIO').usd, 10);

// ── 9. Si NO fue, NO cobra ──────────────────────────────────────────────────────────────────
// Confirmado por Alejandra el 07/08: «No, no se le paga. Eso va de la mano con la asistencia.»
console.log('\nSi no fue a trabajar, no cobra (va de la mano con la asistencia):');
sembrar();
app.IMAU_ASIS = { 'E039': { '2026-07-20': 'A' } };   // RRHH declara que Edwin NO fue el lunes
app.calcNom();
eq('el lunes que no fue queda en $0 aunque su unidad hizo 3 viajes',
  imau('EDWIN MONTIEL').dias.find(d => d.f === '2026-07-20').usd, 0);
eq('su semana baja de $7 a $2 (solo le queda el miércoles)', imau('EDWIN MONTIEL').usd, 2);
eq('queda registrado como día de ausencia, no como día sin viajes', imau('EDWIN MONTIEL').diasAusente, 1);
eq('y NO como día sin dato: acá sí sabemos', imau('EDWIN MONTIEL').diasSinDato, 0);

// La declaración de RRHH MANDA sobre el fichaje: si la máquina dice que fichó pero RRHH dice que
// no fue, gana RRHH. El estado lo declara una persona.
eq('lo declarado por RRHH manda sobre el fichaje', imau('EDWIN MONTIEL').diasPagos, 1);

// ── 10. «No fue» y «no sabemos si fue» NO son lo mismo ──────────────────────────────────────
// Es lo más delicado de toda la regla: hoy el fichaje empieza el 20/07 y de los 16 del IMAU solo
// 5 han fichado alguna vez. Si el sistema pagara $0 en silencio por falta de dato, le quitaría la
// semana a gente que sí trabajó y nadie se enteraría.
console.log('\nSin dato de asistencia: no se paga, pero se avisa (no es lo mismo que no haber ido):');
sembrar();
app.FICHAJES_SET = new Set();   // nadie fichó y nadie declaró nada: no se sabe
app.calcNom();
const e2 = imau('EDWIN MONTIEL');
eq('no se le paga nada todavía', e2.usd, 0);
eq('pero queda contado: 2 días sin declarar', e2.diasSinDato, 2);
eq('y se sabe CUÁNTO está en espera ($5 del lunes + $2 del miércoles)', e2.usdRetenido, 7);
eq('el día de 1 viaje NO cuenta como pendiente: no pagaba de todos modos', e2.dias.find(d => d.f === '2026-07-21').tarifa, 0);
const b = String(app._bannersNomina || '');
ok('la pantalla avisa que hay plata del IMAU sin pagar por falta de asistencia', /sin pagar por falta de asistencia/.test(b));
ok('dice cuánto', /\$/.test(b) && /IMAU/.test(b));
ok('y nombra a quién le falta', /EDWIN MONTIEL/.test(b));

// Declarar que SÍ fue lo destraba, sin necesidad de fichaje.
app.IMAU_ASIS = { 'E039': { '2026-07-20': 'P', '2026-07-22': 'P' } };
app.calcNom();
eq('declarando que sí fue, cobra sus $7', imau('EDWIN MONTIEL').usd, 7);
eq('y ya no queda nada en espera para él', imau('EDWIN MONTIEL').diasSinDato, 0);
ok('deja de aparecer en el aviso', !/EDWIN MONTIEL/.test(String(app._bannersNomina || '')));
// Pero el aviso SIGUE, porque a los del B007 todavía les falta declarar. Que a uno se le resuelva
// no puede apagar la alarma de los otros: ahí es donde se pierde la plata del que nadie miró.
ok('el aviso sigue por los que todavía no se declararon', /sin pagar por falta de asistencia/.test(String(app._bannersNomina || '')));
ok('y los nombra a ellos', /WUILLIBALDO ATENCIO/.test(String(app._bannersNomina || '')));

// Declarados todos, la alarma se apaga.
app.IMAU_ASIS = { 'E039': { '2026-07-20': 'P', '2026-07-22': 'P' }, 'E047': { '2026-07-20': 'P' }, 'E046': { '2026-07-20': 'P' } };
app.calcNom();
ok('con todos declarados, el aviso desaparece', !/sin pagar por falta de asistencia/.test(String(app._bannersNomina || '')));
eq('y el total IMAU vuelve a ser $17', app._ultimaNomina.totImau, 17);

console.log('\n──────────────');
console.log('PASS: ' + pass + '   FAIL: ' + fail);
if (fail) process.exit(1);
