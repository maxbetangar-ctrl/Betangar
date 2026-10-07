// ══════════════════════════════════════════════════════════════════════════════
// EL CANDADO DE LA LECTURA DE LA REGLA — `clClaseDeLectura` de chofer.html
//
// Por qué existe: «pasó el tope» metía TRES cosas distintas por la misma puerta, y cada una
// necesita otra pregunta. Medido el 07/10/2026 en FLOTILLA, la lectura más alta de cada
// unidad contra su propio tope: FC14 con 7.129 cm (tope 27) · FC01 con 600 (tope 67, y
// 600 L es su capacidad) · FC16 con 525 (tope 83) · FL01 con 75 y FL02 con 76 (tope 48 y
// capacidad 76,8 L). O sea: la gente teclea LITROS en el campo de CENTÍMETROS. Y al revés,
// el FC17 marcaba 48 con el tope en 27 porque su regla DE VERDAD recorre 48.
//
// ⚠️ Esto prueba la función PURA. No prueba la pantalla ni el guardado: eso lo mira
//    `scripts/ver-aforo-en-navegador.mjs` del lado del aforo, y del lado del chofer sigue
//    sin verse en un navegador — está dicho y no se da por hecho.
// ══════════════════════════════════════════════════════════════════════════════
const fs = require('fs');
const vm = require('vm');
const path = require('path');

// `chofer.html` se carga igual que el harness carga `app.js`: el código de nivel superior
// toca el DOM y se detiene, pero las funciones declaradas con `function` ya quedaron
// definidas por hoisting. Es el mismo truco, con los mismos stubs mínimos.
const html = fs.readFileSync(path.join(__dirname, '..', 'chofer.html'), 'utf8');
const bloques = [...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)].map(m => m[1]);

const noop = function () {};
const el = () => ({ style: {}, dataset: {}, classList: { add: noop, remove: noop, toggle: noop, contains: () => false },
  appendChild: noop, setAttribute: noop, getAttribute: () => null, addEventListener: noop,
  querySelector: () => null, querySelectorAll: () => [], focus: noop, select: noop,
  scrollIntoView: noop, innerHTML: '', value: '', textContent: '', checked: false, children: [] });
const sandbox = {
  console, Math, Number, String, Object, Array, JSON, Date, parseFloat, parseInt, isNaN, isFinite,
  setTimeout: noop, clearTimeout: noop, setInterval: noop, clearInterval: noop,
  document: { getElementById: () => el(), querySelector: () => null, querySelectorAll: () => [],
    createElement: () => el(), addEventListener: noop, body: el(), head: el() },
  navigator: { onLine: true, userAgent: 'node', serviceWorker: { register: () => Promise.resolve() } },
  location: { href: '', origin: '', search: '', hash: '' },
  localStorage: { getItem: () => null, setItem: noop, removeItem: noop },
  fetch: () => Promise.resolve({ ok: true, json: () => Promise.resolve({}) }),
  alert: noop, confirm: () => true, supabase: null
};
sandbox.window = sandbox; sandbox.globalThis = sandbox; sandbox.self = sandbox;
vm.createContext(sandbox);
for (const b of bloques) { try { vm.runInContext(b, sandbox, { filename: 'chofer.html' }); } catch (e) { /* el nivel superior toca el DOM: esperado */ } }

// ⛔ LAS CONSTANTES DE NIVEL SUPERIOR NO SOBREVIVEN AL HARNESS, Y ESO NO SE PUEDE TAPAR.
//    Las `function` quedan definidas por hoisting aunque el código de nivel superior se
//    detenga en el DOM — pero un `var X = 2;` queda DECLARADO y sin asignar. Sin esto,
//    `cm <= top + CL_ALTURA_GRACIA_CM` compara contra NaN, da false siempre, y las lecturas
//    normales se clasificaban como «sobre el tope»: cinco pruebas en rojo por el ENTORNO,
//    no por la función. Es la misma familia que el `cubicacion.js` que el harness no cargaba.
//    ⇒ Se leen DEL ARCHIVO (fuente única) y se comprueba que sigan valiendo lo que la
//      prueba supone: si alguien las cambia, esto lo dice en vez de pasar en verde.
const leerConst = (nombre) => {
  const m = html.match(new RegExp('var\\s+' + nombre + '\\s*=\\s*([0-9.]+)\\s*;'));
  if (!m) { console.log('  ✗ no se encontró ' + nombre + ' en chofer.html'); process.exit(1); }
  return parseFloat(m[1]);
};
sandbox.CL_ALTURA_GRACIA_CM = leerConst('CL_ALTURA_GRACIA_CM');
sandbox.CL_REGLA_MAX_CM = leerConst('CL_REGLA_MAX_CM');

let pass = 0, fail = 0;
function eq(q, a, b) {
  const ok = JSON.stringify(a) === JSON.stringify(b);
  console.log((ok ? '  ✓ ' : '  ✗ ') + q + (ok ? '' : '  (dio ' + JSON.stringify(a) + ', se esperaba ' + JSON.stringify(b) + ')'));
  ok ? pass++ : fail++;
}

const clase = (cm) => { const r = sandbox.clClaseDeLectura(cm); return r ? r.clase : null; };
// El tanque de prueba: tope de regla 48 cm, capacidad 150 L — el FC17 tal como quedó.
function montarTanque(tope, cap) {
  const tabla = {};
  for (let i = 1; i <= Math.floor(tope); i++) tabla[i] = Math.round((cap * i / tope) * 100) / 100;
  sandbox.CL_TANQUE_UNIDAD = { tanque_id: 'tanque-prueba', altura_max_cm: tope, tabla: tabla };
}

console.log('\nLa clase de una lectura de regla (tope 48 cm, tanque de 150 L):');
montarTanque(48, 150);
eq('la gracia y el tope físico son los del archivo', [sandbox.CL_ALTURA_GRACIA_CM, sandbox.CL_REGLA_MAX_CM], [2, 260]);
eq('las funciones están definidas', [typeof sandbox.clClaseDeLectura, typeof sandbox.clCapacidadL], ['function', 'function']);
eq('la capacidad se saca de la propia tabla', sandbox.clCapacidadL(), 150);
eq('una lectura normal no es nada', clase(32), null);
eq('el tope exacto tampoco', clase(48), null);
eq('dentro de la gracia de 2 cm tampoco', clase(50), null);
// Pasarse por poco = el tope puede estar CORTO. Es el caso del FC17 y el único que avisa.
eq('pasarse por poco es «sobre el tope»', clase(55), 'sobre_el_tope');
eq('y el FC17 con el tope viejo también lo era', (montarTanque(27, 150), clase(48)), 'sobre_el_tope');
// Los litros tecleados en el campo de centímetros.
montarTanque(48, 150);
eq('un número que es la capacidad en litros: «parece litros»', clase(150), 'parece_litros');
eq('dentro del 5% de la capacidad, también', clase(146), 'parece_litros');
eq('justo afuera del 5% ya no se acusa de litros', clase(130), 'sobre_el_tope');
// El caso real de FL01/FL02: tope 48, capacidad 76,8 — la gente marcó 75 y 76.
montarTanque(48, 76.8);
eq('FL01: 75 con capacidad 76,8 es «parece litros»', clase(75), 'parece_litros');
eq('FL02: 76 con capacidad 76,8 también', clase(76), 'parece_litros');
// Y lo que no es de este mundo.
montarTanque(27, 150);
eq('FC14: 7.129 cm es «imposible»', clase(7129), 'imposible');
eq('261 cm ya es imposible (el tope de cubicacion.js es 260)', clase(261), 'imposible');
eq('260 justo todavía se trata como tope corto', clase(260), 'sobre_el_tope');
// ⚠️ Sin tanque configurado (IVECO y los que no llevan regla) NO se juzga nada.
sandbox.CL_TANQUE_UNIDAD = null;
eq('sin tanque configurado no hay clase', clase(999), null);

console.log('\n──────────────\nPASS: ' + pass + '   FAIL: ' + fail);
process.exit(fail ? 1 : 0);
