// El botón «Eliminar duplicado» le enseñó al cliente el atajo malo.
//
// ⛔ EL CASO REAL (Tony Gas, 05/10/2026). Néstor Daniel Morales Morales tenía DOS fichas con la
//    misma cédula V-13330017. El cliente pidió borrar la repetida y el control le contestó
//    «Este registro no parece ser un duplicado. Usa "Dar de Baja" en su lugar.»
//    Comparaba `e.nombre === nombre`, exacto, y los dos nombres se diferencian en UN ESPACIO:
//      'NESTOR DANIEL  MORALES MORALES'  (30 caracteres)
//      'NESTOR DANIEL MORALES MORALES'   (29 caracteres)
//    Hizo lo que el cartel le sugería — dos veces, con dos personas — y la base quedó con dos
//    cédulas duplicadas y dos fichas de baja sin fecha de egreso.
//
// Lo que esta prueba fija: que el duplicado se reconozca por la CÉDULA, que el nombre normalizado
// sirva de respaldo, y que a una ficha que NO es duplicada se la siga negando (si no, el arreglo
// abre la puerta a borrar gente de verdad).
//
// ⚠️ EL PREDICADO SE SACA DE `app.js`, NO SE REESCRIBE ACÁ. Una prueba que reimplementa la regla
//    comprueba la copia y pasa aunque el producto esté roto.
//    [[norma-probar-el-camino-no-la-pieza]] · [[norma-test-que-pasa-por-el-motivo-equivocado]]

import fs from 'node:fs';
import path from 'node:path';

const APP = path.join(path.dirname(new URL(import.meta.url).pathname.slice(1)), '..', 'app.js');
const src = fs.readFileSync(APP, 'utf8');

let pass = 0, fail = 0;
function eq(name, got, exp) {
  const c = JSON.stringify(got) === JSON.stringify(exp);
  if (c) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ ' + name + '  → dio ' + JSON.stringify(got) + ', esperaba ' + JSON.stringify(exp)); }
}

// ── 1) SE EXTRAE DEL PRODUCTO: `_normNom` y el bloque que arma `duplicados` ──────────────────
const mNorm = src.match(/function _normNom\(s\)\{[^\n]*\}/);
if (!mNorm) { console.log('  ✗ no se encontró `_normNom` en app.js'); process.exit(1); }

const desde = src.indexOf('  var _ced=function(s){');
const hasta = src.indexOf('  if(duplicados.length<2){', desde);
if (desde < 0 || hasta < 0) {
  console.log('  ✗ no se encontró el bloque del duplicado en app.js — ¿se aplicó el parche?');
  process.exit(1);
}
const bloque = src.slice(desde, hasta);

// CONTROL POSITIVO DE LA EXTRACCIÓN: si el recorte saliera vacío o sin la regla, la prueba
// pasaría por no comparar nada. Se exige que lo extraído CONTENGA la cédula como criterio.
eq('el bloque extraído compara por cédula', /_ced\(e\.cedula\)===_cedYo/.test(bloque), true);

const reglaNueva = new Function('EMPLEADOS', 'id', 'nombre',
  mNorm[0] + '\n' + bloque + '\nreturn duplicados.length;');

// La regla VIEJA, para demostrar que el caso real fallaba. No sale de app.js a propósito: ya no está.
const reglaVieja = (EMPLEADOS, id, nombre) => EMPLEADOS.filter(e => e.nombre === nombre).length;

// ── 2) LOS DATOS REALES, tal como estaban en la base de Tony Gas ─────────────────────────────
const NESTOR = [
  { id: 'E13330017', nombre: 'NESTOR DANIEL  MORALES MORALES', cedula: 'V-13330017', activo: true  },
  { id: 'E712',      nombre: 'NESTOR DANIEL MORALES MORALES',  cedula: 'V-13330017', activo: false },
  { id: 'E468',      nombre: 'NESTOR CHIRINOS',                cedula: 'V-16248926', activo: false },
  { id: 'E16248926', nombre: 'NESTOR ELIECER  CHIRINO AÑEZ',   cedula: 'V-16248926', activo: true  },
  { id: 'E22120061', nombre: 'ABRAHAM ELIEZER  MORALES P',     cedula: 'V-22120061', activo: true  },
];

console.log('\nEl caso que lo pidió — Néstor Morales, dos fichas, misma cédula:');
eq('la regla VIEJA NO lo veía (por eso dijo «usa Dar de Baja»)',
   reglaVieja(NESTOR, 'E712', 'NESTOR DANIEL MORALES MORALES') < 2, true);
eq('la regla NUEVA sí lo ve, por la cédula',
   reglaNueva(NESTOR, 'E712', 'NESTOR DANIEL MORALES MORALES') >= 2, true);
eq('y lo ve igual desde la otra ficha (la del espacio de más)',
   reglaNueva(NESTOR, 'E13330017', 'NESTOR DANIEL  MORALES MORALES') >= 2, true);

console.log('\nEl otro caso real — Néstor Chirino, cédula V-16248926:');
eq('también se reconoce', reglaNueva(NESTOR, 'E468', 'NESTOR CHIRINOS') >= 2, true);

console.log('\n⛔ Y LO QUE NO DEBE PASAR: que ahora se pueda borrar a quien NO está duplicado.');
eq('una persona con cédula única se sigue negando',
   reglaNueva(NESTOR, 'E22120061', 'ABRAHAM ELIEZER  MORALES P') < 2, true);

console.log('\nEl nombre normalizado, como respaldo cuando no hay cédula cargada:');
const SINCED = [
  { id: 'A', nombre: 'JOSE  PEREZ', cedula: '' },
  { id: 'B', nombre: 'JOSE PEREZ',  cedula: '' },
  { id: 'C', nombre: 'MARIA LOPEZ', cedula: '' },
];
eq('dos fichas sin cédula y el mismo nombre con otro espaciado = duplicado',
   reglaNueva(SINCED, 'A', 'JOSE  PEREZ') >= 2, true);
eq('sin cédula y con nombre distinto NO es duplicado',
   reglaNueva(SINCED, 'C', 'MARIA LOPEZ') < 2, true);

console.log('\n' + (fail ? '⛔ ' + fail + ' fallaron, ' + pass + ' pasaron' : '✅ las ' + pass + ' pasaron'));
process.exit(fail ? 1 : 0);
