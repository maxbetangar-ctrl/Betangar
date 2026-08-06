// Un nombre de planilla paga a UNA sola persona.
//
// Caso real (semana del 20 al 26/07/2026): la misma persona tenía DOS fichas —"CARLOS ALFREDO
// MONTIEL" (E342) y "CARLOS ALFREDO MONTIEL VILLALOBOS" (E706)— y `calcNom` recorría EMPLEADOS
// pagándole a cada ficha TODA planilla cuyo nombre le "casara" con `_nomCasa`. Las dos reclamaban
// las mismas filas: salieron con 26 viajes CADA UNA cuando 26 era el total ENTRE LAS DOS.
//
// La prueba usa las planillas REALES de esa semana (B008 lleva a MONTIEL VILLALOBOS; B005/B012
// llevan a MONTIEL) y exige el reparto correcto: 16 y 10. Si alguien vuelve a recorrer EMPLEADOS
// con match tolerante, los dos vuelven a 26 y esto falla.
const app = require('./harness');

let pass = 0, fail = 0;
function eq(name, got, exp) {
  const c = JSON.stringify(got) === JSON.stringify(exp);
  if (c) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ ' + name + '  → got ' + JSON.stringify(got) + ', exp ' + JSON.stringify(exp)); }
}
function ok(name, cond) { eq(name, !!cond, true); }

// ── Datos: las planillas reales de la semana 21 que tocan a los dos Montiel ──────────────────
// t = viajes del día; el ayudante fijo del B008 es NESTOR, el 2º slot es el que estaba duplicado.
const P = (p, f, cam, ch, ay1, ay2, d, n) => ({ p, f, cam, ch, ay1, ay2, ay3: '', ap1: '', ap2: '', d, n, t: d + n, mes: 'jul-26', sem: 'Semana 3' });
const REGS = [
  // JAC-B008 — "CARLOS ALFREDO MONTIEL VILLALOBOS" (E706): 3+3+2+3+3+2 = 16 viajes
  P('01187', '2026-07-20', 'JAC-B008', 'YURVENIS FRANCISCO BERMUDEZ SUAREZ', 'NESTOR ANTONIO BRIÑEZ DELGADO', 'CARLOS ALFREDO MONTIEL VILLALOBOS', 3, 0),
  P('01201', '2026-07-21', 'JAC-B008', 'YURVENIS FRANCISCO BERMUDEZ SUAREZ', 'NESTOR ANTONIO BRIÑEZ DELGADO', 'CARLOS ALFREDO MONTIEL VILLALOBOS', 2, 1),
  P('01214', '2026-07-22', 'JAC-B008', 'YURVENIS FRANCISCO BERMUDEZ SUAREZ', 'NESTOR ANTONIO BRIÑEZ DELGADO', 'CARLOS ALFREDO MONTIEL VILLALOBOS', 2, 0),
  P('01225', '2026-07-23', 'JAC-B008', 'YURVENIS FRANCISCO BERMUDEZ SUAREZ', 'NESTOR ANTONIO BRIÑEZ DELGADO', 'CARLOS ALFREDO MONTIEL VILLALOBOS', 3, 0),
  P('01236', '2026-07-24', 'JAC-B008', 'YURVENIS FRANCISCO BERMUDEZ SUAREZ', 'NESTOR ANTONIO BRIÑEZ DELGADO', 'CARLOS ALFREDO MONTIEL VILLALOBOS', 2, 1),
  P('01249', '2026-07-25', 'JAC-B008', 'YURVENIS FRANCISCO BERMUDEZ SUAREZ', 'NESTOR ANTONIO BRIÑEZ DELGADO', 'CARLOS ALFREDO MONTIEL VILLALOBOS', 2, 0),
  // JAC-B005 y JAC-B012 — "CARLOS ALFREDO  MONTIEL" (E342, con doble espacio): 3+3+1+2+1 = 10 viajes
  P('01192', '2026-07-20', 'JAC-B005', 'HELY JOSE URDANETA ESPINA', 'ALEXIS ALBERTO FERRER MAVAREZ', 'CARLOS ALFREDO  MONTIEL', 3, 0),
  P('01203', '2026-07-21', 'JAC-B012', 'EDIOBER GREGORIO BARRIOS GONZALEZ', 'LUIS ALEJANDRO FERNANDEZ FERRER', 'CARLOS ALFREDO  MONTIEL', 3, 0),
  P('01211', '2026-07-22', 'JAC-B012', 'EDIOBER GREGORIO BARRIOS GONZALEZ', 'LUIS ALEJANDRO FERNANDEZ FERRER', 'CARLOS ALFREDO  MONTIEL', 1, 0),
  P('01248', '2026-07-25', 'JAC-B012', 'EDIOBER GREGORIO BARRIOS GONZALEZ', 'LUIS ALEJANDRO FERNANDEZ FERRER', 'CARLOS ALFREDO  MONTIEL', 2, 0),
  P('01255', '2026-07-26', 'JAC-B012', 'EDIOBER GREGORIO BARRIOS GONZALEZ', 'CARLOS ALFREDO  MONTIEL', '', 1, 0)
];
const E = (id, nombre, cargo, unidad, cedula) => ({ id, nombre, cargo, unidad, cedula, activo: true, tipoAy: cargo === 'Ayudante' ? 'interno' : '', imau: false });
const EMPLEADOS = [
  E('E706', 'CARLOS ALFREDO MONTIEL VILLALOBOS', 'Ayudante', 'JAC-B005', 'V-19307663'),
  E('E342', 'CARLOS ALFREDO  MONTIEL', 'Ayudante', 'JAC-B008', ''),
  E('E033', 'NESTOR ANTONIO BRIÑEZ DELGADO', 'Ayudante', 'JAC-B008', 'V-11111111'),
  E('E020', 'ALEXIS ALBERTO FERRER MAVAREZ', 'Ayudante', 'JAC-B005', 'V-22222222'),
  E('E035', 'LUIS ALEJANDRO FERNANDEZ FERRER', 'Ayudante', 'JAC-B012', 'V-33333333'),
  E('E008', 'YURVENIS FRANCISCO BERMUDEZ SUAREZ', 'Chofer', 'JAC-B008', 'V-44444444'),
  E('E009', 'HELY JOSE URDANETA ESPINA', 'Chofer', 'JAC-B005', 'V-55555555'),
  E('E013', 'EDIOBER GREGORIO BARRIOS GONZALEZ', 'Chofer', 'JAC-B012', 'V-66666666')
];

// ── Sembrar el estado que lee calcNom ────────────────────────────────────────────────────────
app.REGS = REGS;
app.EMPLEADOS = EMPLEADOS;
app.cfg = Object.assign({}, app.cfg || {}, { chofer: 10, ayud: 5, imau: 2.5, tasa: 100 });
app.TASAS = { bcvDolar: 100 };
app.PRESTAMOS = []; app.MULTAS = []; app.NOMINA_EXTRAS = []; app.NOM_ADM = [];
app.PATIO_DIAS = {}; app.TEMPORALES = {}; app.ASISTENCIA = {}; app.IMAU_APOYO = [];
app.NOMINA_HIST = []; app.FICHAJES_SET = new Set();

console.log('\nUn nombre de planilla paga a UNA sola persona:');
app.calcNom();
const nom = app._ultimaNomina;
const viajes = (nombre) => {
  const a = (nom.ayudantes || []).filter(x => x.n === nombre);
  return a.length === 1 ? a[0].viajes : ('filas=' + a.length);
};

eq('MONTIEL VILLALOBOS (E706) cobra solo los 16 viajes del B008', viajes('CARLOS ALFREDO MONTIEL VILLALOBOS'), 16);
eq('MONTIEL (E342) cobra solo los 10 viajes de B005/B012', viajes('CARLOS ALFREDO  MONTIEL'), 10);
eq('los dos juntos suman los 26 viajes reales, no 52',
  viajes('CARLOS ALFREDO MONTIEL VILLALOBOS') + viajes('CARLOS ALFREDO  MONTIEL'), 26);
eq('cada ficha aparece UNA vez en la nómina', (nom.ayudantes || []).length, 5);
eq('NESTOR (ayudante fijo del B008) mantiene sus 16 viajes', viajes('NESTOR ANTONIO BRIÑEZ DELGADO'), 16);

// El ayudante que ese día salió de CHOFER no cobra dos veces por la misma fila.
console.log('\nEl que sale de chofer no cobra además de ayudante ese día:');
app.REGS = REGS.concat([P('09999', '2026-07-27', 'JAC-B012', 'LUIS ALEJANDRO FERNANDEZ FERRER', 'LUIS ALEJANDRO FERNANDEZ FERRER', '', 2, 0)]);
app.calcNom();
const luis = (app._ultimaNomina.ayudantes || []).find(x => x.n === 'LUIS ALEJANDRO FERNANDEZ FERRER');
const luisCh = (app._ultimaNomina.choferes || []).find(x => x.n === 'LUIS ALEJANDRO FERNANDEZ FERRER');
eq('cobra los 2 viajes como CHOFER', luisCh ? luisCh.viajes : null, 2);
eq('y NO se los cobra otra vez como ayudante (sigue en 6)', luis ? luis.viajes : null, 6);

// ── El desglose del ayudante existe y cuadra con lo que se paga ──────────────────────────────
console.log('\nDesglose día por día del ayudante:');
app.REGS = REGS; app.calcNom();
const nestor = (app._ultimaNomina.ayudantes || []).find(x => x.n === 'NESTOR ANTONIO BRIÑEZ DELGADO');
eq('trae el día por día (6 días en el B008)', Object.keys(nestor.dia || {}).length, 6);
eq('la suma de los días es su sueldo', Math.round(Object.values(nestor.dia).reduce((s, d) => s + d.usd, 0) * 100) / 100, nestor.usd);
eq('el domingo 26/07 no le tocó (no salió en B008)', nestor.dom, 0);
// El B012 del domingo 26/07 lo hizo MONTIEL: 1 viaje × $5 × 1,5 = $7,50
const mont = (app._ultimaNomina.ayudantes || []).find(x => x.n === 'CARLOS ALFREDO  MONTIEL');
eq('MONTIEL tiene 1 viaje en domingo', mont.dom, 1);
eq('ese domingo se le paga 1,5× ($7,50, no $5)', mont.dia['2026-07-26'].usd, 7.5);
eq('su total = 9 viajes normales ($45) + el domingo a 1,5× ($7,50)', mont.usd, 52.5);

// El 24/07 (Batalla del Lago) es feriado NACIONAL: ese día paga 1,5×, igual que a los choferes.
console.log('\nEl feriado nacional también le paga 1,5× al ayudante:');
const v706 = (app._ultimaNomina.ayudantes || []).find(x => x.n === 'CARLOS ALFREDO MONTIEL VILLALOBOS');
eq('el 24/07 sale marcado como feriado', v706.dia['2026-07-24'].tipo, 'feriado');
eq('3 viajes de feriado', v706.fer, 3);
eq('ese día paga $22,50 y no $15', v706.dia['2026-07-24'].usd, 22.5);
eq('base = 13 viajes normales ($65) + el feriado a 1,5× ($22,50)', v706.usd, 87.5);

// ── Patio por DÍA (formato nuevo) y compatibilidad con el número viejo ───────────────────────
console.log('\nPatio: se guardan los días, y lo viejo (un número) se sigue leyendo:');
app.PATIO_DIAS = { 'E706': ['2026-07-26'] };            // formato nuevo: una fecha
app.calcNom();
const m706 = (app._ultimaNomina.ayudantes || []).find(x => x.n === 'CARLOS ALFREDO MONTIEL VILLALOBOS');
eq('1 día de patio marcado se paga (+1 viaje = $5)', m706.pat, 1);
eq('sueldo = base ($87,50) + 1 patio ($5)', m706.usd, 92.5);
app.PATIO_DIAS = { 'E706': 2 };                          // formato viejo: una cantidad
app.calcNom();
const m706b = (app._ultimaNomina.ayudantes || []).find(x => x.n === 'CARLOS ALFREDO MONTIEL VILLALOBOS');
eq('el número suelto sigue valiendo como cantidad', m706b.pat, 2);
eq('sueldo = base ($87,50) + 2 patio ($10)', m706b.usd, 97.5);
app.PATIO_DIAS = {};

// ── Una persona no puede estar en dos camiones el mismo día ──────────────────────────────────
// RRHH confirmó (2026-08-05) que "CARLOS ALFREDO MONTIEL" y "CARLOS ALFREDO MONTIEL VILLALOBOS"
// son LA MISMA persona. Siendo una sola, las planillas del 20/07 la ponen en el B008 y en el B005
// a la vez: imposible. El aviso tiene que saltar aunque las dos fichas sigan sin unificar.
console.log('\nAviso: la misma persona en dos unidades el mismo día:');
const banner = () => { app.calcNom(); return String(app._bannersNomina || ''); };
app.PATIO_DIAS = {}; app.REGS = REGS;
const b = banner();
ok('avisa que hay días con la persona en dos unidades', /MISMA persona en dos unidades/.test(b));
ok('nombra el 20/07, que es uno de los días imposibles', /20\/07/.test(b));
ok('muestra las dos unidades del choque', /JAC-B008/.test(b) && /JAC-B005/.test(b));
ok('además avisa que las dos fichas pueden ser la misma persona', /podrían ser LA MISMA persona/.test(b));

console.log('\n──────────────');
console.log('PASS: ' + pass + '   FAIL: ' + fail);
if (fail) process.exit(1);
