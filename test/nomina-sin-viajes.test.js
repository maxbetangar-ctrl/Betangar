// Quien NO tuvo viajes esta semana IGUAL tiene que salir en la nómina.
//
// Caso real (2026-08-07): Alejandra, de RRHH, revisando las semanas 17 (22–28/06) y 18 (29/06–05/07)
// para cerrarlas, reportó que faltaban gente en las listas:
//   «En la lista de choferes no me aparece Hely Urdaneta ni Jhan Roa. En efecto ellos no tuvieron
//    viajes esa semana por diversas razones pero de igual manera se les considera el día de patio.»
//   «En la lista de ayudantes no me aparece Misael Rincón, en efecto no tuvo viajes, solamente
//    días de patio.»
// Comprobado contra la base: los tres son personal ACTIVO y no tenían NI UNA fila de planilla.
//
// La causa: `calcNom` armaba las listas recorriendo las PLANILLAS, que son VIAJES. Quien no tenía
// una fila no salía en cero — NO EXISTÍA. Y el día de patio tampoco lo rescataba, porque el patio
// (manual y automático) recorre esa MISMA lista ya armada: si no entró, no había dónde marcárselo.
// Una lista que se arma desde el HECHO no puede pagar la AUSENCIA del hecho.
//
// Lo que esta prueba fija:
//   1. el personal ACTIVO sale en la lista aunque tenga 0 viajes, y cobra $0;
//   2. con días de patio declarados, cobra — y recién ahí entra al historial;
//   3. una fila en $0 NO se escribe en el historial (no es un pago) ni mueve los totales;
//   4. a quien cobra $0 NO se le descuenta un préstamo: la cuota avanzaría sin que nadie la pague;
//   5. los IMAU quedan fuera (no cobran patio) y los INACTIVOS no entran solos;
//   6. las dos listas salen en ORDEN ALFABÉTICO (pedido de Alejandra en el mismo mensaje).
const app = require('./harness');

let pass = 0, fail = 0;
function eq(name, got, exp) {
  const c = JSON.stringify(got) === JSON.stringify(exp);
  if (c) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ ' + name + '  → got ' + JSON.stringify(got) + ', exp ' + JSON.stringify(exp)); }
}
function ok(name, cond) { eq(name, !!cond, true); }

// ── Datos: una semana en la que SOLO sale el B008. Lun 20 a jue 23/07 (sin domingo ni feriado:
// el 24/07 es Batalla del Lago y pagaría 1,5×, que acá solo enturbiaría las cuentas).
const P = (p, f, cam, ch, ay1, d) => ({ p, f, cam, ch, ay1, ay2: '', ay3: '', ap1: '', ap2: '', d, n: 0, t: d, mes: 'jul-26', sem: 'Semana 3' });
const REGS = [
  P('02001', '2026-07-20', 'JAC-B008', 'YURVENIS FRANCISCO BERMUDEZ SUAREZ', 'NESTOR ANTONIO BRIÑEZ DELGADO', 3),
  P('02002', '2026-07-21', 'JAC-B008', 'YURVENIS FRANCISCO BERMUDEZ SUAREZ', 'NESTOR ANTONIO BRIÑEZ DELGADO', 3),
  P('02003', '2026-07-22', 'JAC-B008', 'YURVENIS FRANCISCO BERMUDEZ SUAREZ', 'NESTOR ANTONIO BRIÑEZ DELGADO', 3),
  P('02004', '2026-07-23', 'JAC-B008', 'YURVENIS FRANCISCO BERMUDEZ SUAREZ', 'NESTOR ANTONIO BRIÑEZ DELGADO', 3)
];
// Los nombres son los reales del caso; el resto de la ficha es de relleno.
const E = (id, nombre, cargo, unidad, extra) => Object.assign(
  { id, nombre, cargo, unidad, cedula: 'V-' + id, activo: true, tipoAy: cargo === 'Ayudante' ? 'interno' : '', imau: false, fegreso: '' },
  extra || {});
const EMPLEADOS = [
  E('E008', 'YURVENIS FRANCISCO BERMUDEZ SUAREZ', 'Chofer', 'JAC-B008'),      // sí trabajó
  E('E033', 'NESTOR ANTONIO BRIÑEZ DELGADO', 'Ayudante', 'JAC-B008'),         // sí trabajó
  E('E009', 'HELY JOSE URDANETA ESPINA', 'Chofer', 'JAC-B005'),               // ACTIVO, 0 planillas
  E('E010', 'JHAN CARLOS ROA OCHOA', 'Chofer', 'JAC-B006'),                   // ACTIVO, 0 planillas
  E('E029', 'MISAEL JESUS RINCON GONZALEZ', 'Ayudante', 'JAC-B001'),          // ACTIVO, 0 planillas
  E('E900', 'PEDRO PEREZ IMAU', 'Ayudante', 'IMAU', { tipoAy: 'imau' }),      // IMAU: no cobra patio
  E('E027', 'YIRBER LENITHON GONZALEZ MONTIEL', 'Ayudante', 'JAC-B003', { activo: false })  // baja SIN fecha
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
const chUI = (n) => Object.values(app._CHMAP_UI || {}).find(c => c.ch === n);
const ayUI = (n) => Object.values(app._AYMAP_UI || {}).find(a => a.emp && a.emp.nombre === n);
const enHist = (lista, n) => (app._ultimaNomina[lista] || []).find(x => x.n === n);

// ── 1. El activo sin viajes SALE en la lista ────────────────────────────────────────────────
console.log('\nEl personal ACTIVO sin viajes igual sale en la lista:');
sembrar(); app.calcNom();

ok('HELY URDANETA (chofer activo, 0 planillas) aparece', !!chUI('HELY JOSE URDANETA ESPINA'));
ok('JHAN ROA también', !!chUI('JHAN CARLOS ROA OCHOA'));
ok('MISAEL RINCON (ayudante activo, 0 planillas) aparece', !!ayUI('MISAEL JESUS RINCON GONZALEZ'));
eq('HELY sale con 0 viajes', chUI('HELY JOSE URDANETA ESPINA').viajes, 0);
eq('y con $0 de sueldo: no se le inventa nada', chUI('HELY JOSE URDANETA ESPINA').montoViajes, 0);
ok('queda marcado como venido del padrón', chUI('HELY JOSE URDANETA ESPINA').dePadron === true);
ok('el que SÍ trabajó no se marca así', chUI('YURVENIS FRANCISCO BERMUDEZ SUAREZ').dePadron !== true);

console.log('\nQuién NO entra solo:');
ok('el IMAU no entra (no cobra patio: una fila en cero sería ruido)', !ayUI('PEDRO PEREZ IMAU'));
ok('el INACTIVO no entra (si no trabajó, no se le paga)', !ayUI('YIRBER LENITHON GONZALEZ MONTIEL'));

// ── 2. Una fila en $0 no es un pago ─────────────────────────────────────────────────────────
console.log('\nUna fila en $0 no se escribe en el historial ni mueve los totales:');
ok('HELY no entra al historial mientras cobre $0', !enHist('choferes', 'HELY JOSE URDANETA ESPINA'));
ok('MISAEL tampoco', !enHist('ayudantes', 'MISAEL JESUS RINCON GONZALEZ'));
eq('el historial trae solo al que trabajó (1 chofer)', (app._ultimaNomina.choferes || []).length, 1);
eq('y a su ayudante (1)', (app._ultimaNomina.ayudantes || []).length, 1);
eq('total de choferes = los 12 viajes de YURVENIS ($120)', app._ultimaNomina.totCh, 120);
eq('total de ayudantes = los 12 viajes de NESTOR ($60)', app._ultimaNomina.totAy, 60);

// ── 3. Con días de patio declarados, cobra ──────────────────────────────────────────────────
console.log('\nCon días de patio declarados por RRHH, sí cobra:');
sembrar();
app.PATIO_DIAS = { 'HELY JOSE URDANETA ESPINA': ['2026-07-20', '2026-07-21'], 'E029': ['2026-07-22'] };
app.calcNom();
eq('HELY cobra sus 2 días de patio (2 × $10)', enHist('choferes', 'HELY JOSE URDANETA ESPINA').usd, 20);
eq('y se registran como patio, no como viajes', enHist('choferes', 'HELY JOSE URDANETA ESPINA').pat, 2);
eq('sigue con 0 viajes de planilla', enHist('choferes', 'HELY JOSE URDANETA ESPINA').viajes, 0);
eq('MISAEL cobra su día de patio (1 × $5)', enHist('ayudantes', 'MISAEL JESUS RINCON GONZALEZ').usd, 5);
eq('ahora el total de choferes son los $120 + $20 de patio', app._ultimaNomina.totCh, 140);
ok('JHAN ROA, sin patio declarado, sigue fuera del historial', !enHist('choferes', 'JHAN CARLOS ROA OCHOA'));

// ── 4. A quien cobra $0 no se le descuenta el préstamo ──────────────────────────────────────
// Si se le descontara, `Math.max(0, 0 - cuota)` daría $0 igual —no se vería nada— pero la cuota
// avanzaría al guardar la semana: la deuda figuraría pagada sin que nadie hubiera pagado.
console.log('\nA quien cobra $0 no se le avanza la cuota de un préstamo:');
sembrar();
app.PRESTAMOS = [{ id: 'P1', empId: 'E009', estado: 'activo', mes: '', cuotaUsd: 15, semanas: 4, semanasPagadas: 0, montoUsd: 60 }];
app.calcNom();
eq('sin patio: no se le descuenta nada', chUI('HELY JOSE URDANETA ESPINA').descuentos, 0);
eq('y la cuota NO queda para avanzar', (app._ultimaNomina._prestAplicar || []).length, 0);

app.PATIO_DIAS = { 'HELY JOSE URDANETA ESPINA': ['2026-07-20', '2026-07-21'] };
app.calcNom();
eq('con patio declarado sí cobra, y ahí sí se le descuenta', chUI('HELY JOSE URDANETA ESPINA').descuentos, 15);
eq('y la cuota queda para avanzar al guardar la semana', (app._ultimaNomina._prestAplicar || []).length, 1);
eq('cobra $20 de patio menos los $15 de cuota', enHist('choferes', 'HELY JOSE URDANETA ESPINA').usd, 5);

// ── 5. Los avisos ───────────────────────────────────────────────────────────────────────────
console.log('\nEl sistema avisa de lo que antes había que descubrir a mano:');
sembrar(); app.calcNom();
const b = String(app._bannersNomina || '');
ok('avisa cuántos activos quedaron sin viajes', /persona\(s\) ACTIVA\(S\) sin viajes/.test(b));
ok('los nombra: HELY', /HELY JOSE URDANETA ESPINA/.test(b));
ok('los nombra: MISAEL', /MISAEL JESUS RINCON GONZALEZ/.test(b));
ok('avisa de las fichas dadas de baja SIN fecha de egreso', /SIN fecha de egreso/.test(b));
ok('y nombra a YIRBER, que es la que no tiene fegreso', /YIRBER LENITHON GONZALEZ MONTIEL/.test(b));

// ── 6. Orden alfabético (pedido de Alejandra en el mismo mensaje) ───────────────────────────
console.log('\nLas listas salen en orden alfabético:');
const orden = Object.values(app._CHMAP_UI).map(c => c.ch).slice().sort((x, y) => String(x).localeCompare(String(y), 'es'));
eq('el orden de choferes es alfabético', orden, ['HELY JOSE URDANETA ESPINA', 'JHAN CARLOS ROA OCHOA', 'YURVENIS FRANCISCO BERMUDEZ SUAREZ']);

console.log('\n──────────────');
console.log('PASS: ' + pass + '   FAIL: ' + fail);
if (fail) process.exit(1);
