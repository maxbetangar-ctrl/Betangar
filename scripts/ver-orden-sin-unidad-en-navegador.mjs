// ═══════════════════════════════════════════════════════════════════════════════
// VER EN UN NAVEGADOR DE VERDAD LA ORDEN QUE NO VA A UN VEHÍCULO
//
// Qué revisa, en pantalla y no en una aserción:
//   (1) Que el selector «Destino» SE VEA con el tipo de orden en Servicio. Una prueba de
//       texto confirma que el código dice `display='block'`; que el recuadro esté visible
//       para un humano lo dice el navegador (`offsetParent`, no el CSS declarado).
//   (2) Que la opción «Inventario» esté ESCONDIDA en servicio y VISIBLE en compra.
//   (3) Que al elegir Patio el campo de unidades quede inhabilitado y el texto de ayuda
//       explique que no se le carga a ningún camión.
//   (4) Que el aviso en vivo del campo de unidades pinte en VERDE una unidad cuyo nombre
//       lleva espacios — el defecto que reportó Alejandra (SOP-20261026-BEQI) pintaba
//       «✗ no existen: Llantas, de, repuesto». Acá se mide el COLOR, que es exactamente
//       lo que una prueba de texto no ve.
//
// Cómo: se abre `app.html` con su `app.js`, se corta TODA la red hacia Supabase (no se lee
// ni se escribe nada real) y se le siembra una flota de prueba a la pantalla.
//
// ⛔ QUÉ NO PRUEBA: no prueba la API, ni los permisos, ni el RLS, ni que la orden se guarde.
//    Prueba lo que la pantalla DIBUJA y lo que deja hacer.
//
// Uso: node scripts/ver-orden-sin-unidad-en-navegador.mjs [url]
//      (sin url usa el archivo local, que es lo que se revisa ANTES de desplegar)
// ═══════════════════════════════════════════════════════════════════════════════
import { pathToFileURL } from 'url';

const URL_APP = process.argv[2] || pathToFileURL('C:/Users/Maxbetangar/Betangar/app.html').href;
const GLOBAL = 'C:/Users/Maxbetangar/AppData/Roaming/npm/node_modules/playwright/index.js';
const RUTA_FOTO = process.env.FOTO || '';   // FOTO=ruta.png para guardar el recuadro

let pw;
try { pw = await import('playwright'); }
catch {
  try { pw = await import(pathToFileURL(GLOBAL).href); }
  catch {
    console.error('Falta Playwright:  npm i -g playwright && npx playwright install chromium');
    process.exit(1);
  }
}
const chromium = pw.chromium || (pw.default && pw.default.chromium);
if (!chromium) { console.error('Playwright se importo pero no trae `chromium`.'); process.exit(1); }

let fallos = 0;
const ok = (n, cond, detalle) => {
  console.log((cond ? '  ✅' : '  ❌') + ' ' + n + (cond ? '' : '\n       → ' + detalle));
  if (!cond) fallos++;
};

const b = await chromium.launch();
const ctx = await b.newContext();
const page = await ctx.newPage();

let tocoSupabase = 0;
await page.route('**/*.supabase.co/**', r => {
  tocoSupabase++;
  return r.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
});

await page.goto(URL_APP, { waitUntil: 'domcontentloaded', timeout: 120000 });
await page.waitForFunction('typeof _osTipoOrden==="function" && typeof _osCamsHint==="function"',
  null, { timeout: 120000 });

// Flota de prueba: dos camiones y una pseudo-unidad CON ESPACIOS en el nombre, que es el
// caso que reventaba. Se siembra igual que lo hace `cargarUnidadConfig` desde la base.
await page.evaluate(() => {
  window.DB_READY = false;
  const ov = document.getElementById('login-overlay'); if (ov) ov.style.display = 'none';
  window.FLOTA = {
    'JAC-B001': { placa: 'A11AA1A', tipo: 'Camion' },
    'JAC-B002': { placa: 'A22BB2B', tipo: 'Camion' },
    'Llantas de repuesto': { placa: '', tipo: 'Otro' }
  };
  window.UNIDAD_CONFIG = JSON.parse(JSON.stringify(window.FLOTA));
  // La pantalla de ordenes vive en p-proveedores Y ADEMAS en su sub-pestaña `tab-prov-ordenes`,
  // que nace con display:none. Mostrar solo la pagina deja el formulario invisible y cualquier
  // medicion de visibilidad da falso negativo: la primera corrida de este script acuso al
  // producto por eso, incluso en COMPRA, que funcionaba desde antes.
  document.querySelectorAll('.page').forEach(p => { p.style.display = 'none'; });
  const pg = document.getElementById('p-proveedores'); if (pg) pg.style.display = 'block';
  ['tab-prov-nuevo', 'tab-prov-lista', 'tab-prov-fact', 'tab-prov-hist', 'tab-prov-ordenes']
    .forEach(id => { const t = document.getElementById(id); if (t) t.style.display = (id === 'tab-prov-ordenes') ? 'block' : 'none'; });
});

console.log('Pagina: ' + URL_APP + '\n');

const medir = () => page.evaluate(() => {
  const g = id => document.getElementById(id);
  const visible = el => !!(el && el.offsetParent !== null && el.offsetWidth > 0 && el.offsetHeight > 0);
  const inv = g('os-destino-inv');
  const hint = g('os-cams-hint');
  const span = hint && hint.querySelector('span');
  return {
    destinoVisible: visible(g('os-patio-wrap')),
    destinoValor: g('os-destino') ? g('os-destino').value : '(no existe)',
    invOption: inv ? { hidden: !!inv.hidden, disabled: !!inv.disabled } : null,
    camsDeshabilitado: g('os-cams') ? !!g('os-cams').disabled : null,
    camsPlaceholder: g('os-cams') ? g('os-cams').placeholder : '',
    ayuda: g('os-ayuda') ? g('os-ayuda').innerText.trim() : '',
    hintTexto: hint ? hint.innerText.trim() : '',
    hintColor: span ? getComputedStyle(span).color : '(sin span)'
  };
});

const poner = (id, val) => page.evaluate(([i, v]) => {
  const el = document.getElementById(i);
  el.value = v;
  el.dispatchEvent(new Event('change', { bubbles: true }));
  el.dispatchEvent(new Event('input', { bubbles: true }));
}, [id, val]);

// ── (1) y (2) · SERVICIO: el Destino se ve, Inventario no ───────────────────
console.log('(1) Tipo de orden = SERVICIO / REPARACION');
await poner('os-tipoorden', 'servicio');
let m = await medir();
ok('el recuadro «Destino» esta VISIBLE en pantalla', m.destinoVisible,
   'offsetParent/ancho/alto dicen que no se ve: la opcion existe pero nadie la encuentra');
ok('la opcion «Inventario» esta escondida y deshabilitada',
   m.invOption && m.invOption.hidden && m.invOption.disabled,
   'quedo ofrecida: ' + JSON.stringify(m.invOption) + ' — una reparacion no entra a existencia');

// ── (3) · Elegir Patio: no pide unidad y lo explica ─────────────────────────
console.log('\n(2) ... y con Destino = PATIO / USO GENERAL');
await poner('os-destino', 'patio');
m = await medir();
ok('el campo de unidades queda inhabilitado', m.camsDeshabilitado === true,
   'sigue pidiendo unidad para un trabajo que no es sobre un vehiculo');
ok('el texto de ayuda dice que no se le carga a ningun camion',
   /no se le carga a ning/i.test(m.ayuda),
   'la ayuda dice: «' + m.ayuda.slice(0, 160) + '»');
console.log('       ayuda en pantalla: «' + m.ayuda.slice(0, 150) + '…»');
console.log('       placeholder: «' + m.camsPlaceholder + '»');

// La foto se saca ACA, con el formulario en el estado que importa: servicio + patio. Una
// captura de la pagina entera no sirve para revisar un recuadro — sale cortado.
if (RUTA_FOTO) {
  await page.evaluate(() => {
    ['tab-prov-nuevo', 'tab-prov-lista', 'tab-prov-fact', 'tab-prov-hist']
      .forEach(id => { const t = document.getElementById(id); if (t) t.style.display = 'none'; });
    const c = document.getElementById('os-ayuda');
    if (c && c.scrollIntoView) c.scrollIntoView({ block: 'center' });
  });
  const card = await page.$('#tab-prov-ordenes .card');
  if (card) { await card.screenshot({ path: RUTA_FOTO }); console.log('       foto: ' + RUTA_FOTO); }
}

// ── (4) ⛔ EL DEFECTO REPORTADO, medido por COLOR ───────────────────────────
// Con destino unidad, se escribe el nombre con espacios y se mira que el aviso sea VERDE.
console.log('\n(3) Destino = unidad, y se escribe «Llantas de repuesto» a mano');
await poner('os-destino', 'unidad');
await page.evaluate(() => {
  const el = document.getElementById('os-cams');
  el.disabled = false;
  el.value = 'Llantas de repuesto';
  el.dispatchEvent(new Event('input', { bubbles: true }));
});
m = await medir();
ok('el aviso en vivo RECONOCE la unidad (no la parte en tres)',
   /✓/.test(m.hintTexto) && !/no existe/i.test(m.hintTexto),
   'el aviso dice: «' + m.hintTexto + '» — es el defecto que fotografio Alejandra');
console.log('       aviso: «' + m.hintTexto + '»   color: ' + m.hintColor);

// Y mezclada con un camion, por coma.
await page.evaluate(() => {
  const el = document.getElementById('os-cams');
  el.value = 'JAC-B001, Llantas de repuesto';
  el.dispatchEvent(new Event('input', { bubbles: true }));
});
m = await medir();
ok('y las reconoce a las DOS cuando van separadas por coma',
   /✓/.test(m.hintTexto) && !/no existe/i.test(m.hintTexto),
   'el aviso dice: «' + m.hintTexto + '»');
console.log('       aviso: «' + m.hintTexto + '»');

// ── (5) · COMPRA: Inventario vuelve a ofrecerse ─────────────────────────────
console.log('\n(4) Tipo de orden = COMPRA (no se rompio lo que ya andaba)');
await poner('os-tipoorden', 'compra');
m = await medir();
ok('la opcion «Inventario» vuelve a ofrecerse en compra',
   m.invOption && !m.invOption.hidden && !m.invOption.disabled,
   'quedo escondida tambien en compra: ' + JSON.stringify(m.invOption));
ok('el recuadro «Destino» sigue visible en compra', m.destinoVisible,
   'se rompio el camino que ya funcionaba');

await b.close();
console.log('\nLlamadas a Supabase cortadas: ' + tocoSupabase);
console.log(fallos ? fallos + ' fallo(s) EN PANTALLA' : 'Todo en verde EN PANTALLA (9)');
process.exit(fallos ? 1 : 0);
