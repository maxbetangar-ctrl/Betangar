// ══════════════════════════════════════════════════════════════════════════════
// LA MITAD QUE LEE: mapear encabezados y CRUZAR contra lo que ya existe
//
// Máximo, 05/11/2026: «todo modulo deberia tener su excel y su modulo de carga
// en batch desde el excel […] para que asi sea automanejable por cada empresa
// […] y que no siempre dependan de nosotros».
//
// `maxware-excel.js` era la fuente única del Excel que SALE. El que ENTRA no
// tenía nada: las seis líneas de FileReader + XLSX.read estaban copiadas en
// cada importador, cinco veces sólo en Betangar.
//
// Lo que esta prueba fija, y por qué cada cosa:
//   1. el encabezado se reconoce aunque venga con tilde, en mayúsculas o con
//      otro nombre — el que llena la plantilla no la escribió
//   2. los campos que FALTAN se devuelven TODOS JUNTOS, no de a uno
//   3. `cruzar()` separa cuatro cosas que no son lo mismo: lo que CAMBIA, lo
//      que ya estaba igual, lo que NO EXISTE y lo que vino REPETIDO
//   4. un valor vacío en el Excel NO borra lo que ya estaba
//
// El caso real que la pidió: 35 facturas a las que les falta el número de
// control. No es dar de alta nada — es completarle un dato a filas que ya
// están, y eso no existía.
//
//   node test/excel-leer.test.js
// ══════════════════════════════════════════════════════════════════════════════
const M = require('../maxware-excel.js');

let pass = 0, fail = 0;
function eq(name, got, exp) {
  const c = JSON.stringify(got) === JSON.stringify(exp);
  if (c) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ ' + name + '  → got ' + JSON.stringify(got) + ', exp ' + JSON.stringify(exp)); }
}
const ok = (n, c) => eq(n, !!c, true);

console.log('\nEXCEL — LA MITAD QUE LEE\n');

// ── 1. El encabezado, como venga ───────────────────────────────────────────
const ALIAS = {
  factura: ['n_de_factura', 'numero_de_factura', 'factura', 'nro_factura'],
  control: ['n_de_control', 'numero_de_control', 'control'],
};
const filas = [{ 'N° de Factura': 'F-001', 'Número de Control': '00-123' }];
const m = M.mapear(filas, ALIAS, ['factura', 'control']);
eq('reconoce «N° de Factura» aunque la plantilla diga otra cosa', m.col.factura, 'N° de Factura');
eq('…y «Número de Control» con tilde y mayúsculas', m.col.control, 'Número de Control');
eq('no falta nada', m.faltan, []);
eq('saca el valor ya limpio', M.texto(filas[0], m.col, 'control'), '00-123');

// Los que faltan salen TODOS, no de a uno: avisar de a uno obliga a subir el
// archivo, corregir, subir, corregir.
const m2 = M.mapear([{ 'Otra cosa': 1 }], ALIAS, ['factura', 'control']);
eq('los campos que faltan se devuelven todos juntos', m2.faltan, ['factura', 'control']);

// ── 2. Números y fechas como los escribe la gente ──────────────────────────
eq('número a la venezolana: 1.234,56', M.numero('1.234,56'), 1234.56);
eq('…y a la inglesa: 1234.56', M.numero('1234.56'), 1234.56);
eq('vacío NO es cero', M.numero(''), null);
eq('fecha dd/mm/aaaa', M.fecha('14/07/2026'), '2026-07-14');
eq('fecha ISO se deja', M.fecha('2026-07-14'), '2026-07-14');
eq('una Date de Excel', M.fecha(new Date(2026, 6, 14)), '2026-07-14');
eq('lo que no es fecha devuelve null', M.fecha('mañana'), null);

// ── 3. CRUZAR: las cuatro cosas que no son lo mismo ────────────────────────
// El caso real: facturas que YA ESTÁN, a las que se les completa el control.
const enSistema = [
  { id: 1, nro_factura: 'F-0023952', num_control: '' },
  { id: 2, nro_factura: 'F-0023988', num_control: '' },
  { id: 3, nro_factura: 'F-0023999', num_control: '00-9999' },   // ya la tiene
];
const delExcel = [
  { nro_factura: 'F-0023952', num_control: '00-24152' },  // cambia
  { nro_factura: 'F-0023999', num_control: '00-9999' },   // igual
  { nro_factura: 'F-NO-EXISTE', num_control: '00-777' },  // no está
  { nro_factura: 'F-0023952', num_control: '00-OTRO' },   // repetida
];
const r = M.cruzar(enSistema, delExcel, 'nro_factura', ['num_control']);

eq('sólo 1 cambia de verdad', r.cambios.length, 1);
eq('…y dice qué le cambia', r.cambios[0].cambios, { num_control: '00-24152' });
eq('la que ya estaba igual no se toca', r.iguales.length, 1);
eq('⛔ la que no existe NO se descarta en silencio', r.sinCalzar.length, 1);
eq('…y dice por qué', r.sinCalzar[0].motivo, 'no existe en el sistema');
eq('⛔ la repetida se avisa aparte', r.ambiguos.length, 1);

// Dice la FILA del Excel (contando el encabezado), que es lo que la persona ve.
eq('señala la fila del Excel, no el índice', r.cambios[0].fila, 2);

// ⛔ Un vacío NO borra: si el Excel trae la celda en blanco, se deja lo que había.
const r2 = M.cruzar([{ nro_factura: 'F-1', num_control: '00-YA' }],
                    [{ nro_factura: 'F-1', num_control: '' }], 'nro_factura', ['num_control']);
eq('una celda vacía NO borra lo que ya estaba', r2.cambios.length, 0);
eq('…y cuenta como «ya estaba»', r2.iguales.length, 1);

// La llave se compara sin tildes ni mayúsculas ni símbolos.
const r3 = M.cruzar([{ k: 'J-29566107-0', v: '' }], [{ k: 'j295661070', v: 'x' }], 'k', ['v']);
eq('la llave calza aunque cambien guiones y mayúsculas', r3.cambios.length, 1);

// Y una llave compuesta, por función.
const r4 = M.cruzar(
  [{ prov: 'ACME', fac: '1', v: '' }],
  [{ prov: 'acme', fac: '1', v: 'z' }],
  (x) => M.llave(x.prov) + '|' + M.llave(x.fac), ['v']);
eq('acepta una llave compuesta', r4.cambios.length, 1);

// ── 4. El resumen que ve la persona antes de confirmar ─────────────────────
const txt = M.resumen(r);
ok('el resumen dice cuántas se actualizan', txt.indexOf('ACTUALIZAR 1') > -1);
ok('…y avisa de las que no se encontraron', txt.indexOf('NO se encontraron') > -1);
ok('…y de las repetidas', txt.indexOf('repetidas') > -1);

console.log('\n  ' + pass + ' pasaron, ' + fail + ' fallaron\n');
process.exit(fail ? 1 : 0);
