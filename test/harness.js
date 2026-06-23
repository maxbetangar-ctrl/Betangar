// Harness de pruebas — carga app.js en un sandbox de Node con stubs del navegador,
// para poder probar las funciones puras/críticas sin un navegador real.
// Las funciones declaradas con `function` quedan en el contexto aunque el código
// de nivel superior (que toca el DOM) no llegue a ejecutarse completo.
const fs = require('fs');
const vm = require('vm');
const path = require('path');

const code = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');

const noop = function () {};
function makeEl() {
  return {
    style: {}, dataset: {}, classList: { add: noop, remove: noop, toggle: noop, contains: () => false },
    appendChild: noop, removeChild: noop, setAttribute: noop, getAttribute: () => null,
    addEventListener: noop, removeEventListener: noop, querySelector: () => null,
    querySelectorAll: () => [], focus: noop, blur: noop, remove: noop, click: noop,
    innerHTML: '', outerHTML: '', value: '', textContent: '', checked: false,
    children: [], parentNode: null, files: []
  };
}
const documentStub = {
  getElementById: () => makeEl(), querySelector: () => null, querySelectorAll: () => [],
  createElement: () => makeEl(), getElementsByTagName: () => [], createTextNode: () => makeEl(),
  body: makeEl(), head: makeEl(), documentElement: makeEl(), addEventListener: noop, cookie: ''
};

const sandbox = {
  console, Date, Math, JSON, RegExp, Set, Map, Promise, Error, Array, Object, Boolean,
  String, Number, parseInt, parseFloat, isNaN, isFinite, encodeURIComponent, decodeURIComponent,
  setTimeout: () => 0, setInterval: () => 0, clearInterval: noop, clearTimeout: noop,
  document: documentStub,
  navigator: { onLine: true, userAgent: 'node-test' },
  localStorage: { getItem: () => null, setItem: noop, removeItem: noop, clear: noop },
  location: { search: '', href: '', hostname: 'test', reload: noop },
  history: { pushState: noop, replaceState: noop },
  fetch: () => Promise.reject(new Error('fetch deshabilitado en tests')),
  alert: noop, confirm: () => true, prompt: () => null,
  Image: function () { return {}; },
  XLSX: undefined, emailjs: { init: noop },
  AbortSignal: { timeout: () => ({}) },
  btoa: (s) => Buffer.from(String(s), 'binary').toString('base64'),
  atob: (s) => Buffer.from(String(s), 'base64').toString('binary')
};
sandbox.window = sandbox;
sandbox.self = sandbox;
sandbox.globalThis = sandbox;

vm.createContext(sandbox);
try {
  vm.runInContext(code, sandbox, { filename: 'app.js' });
} catch (e) {
  // Esperado: parte del código de nivel superior toca el DOM y se detiene aquí.
  // Las funciones `function` ya quedaron definidas por hoisting → siguen usables.
  if (process.env.HARNESS_DEBUG) console.error('[harness] top-level se detuvo:', e.message);
}

module.exports = sandbox;
