// ═══════════════════════════════════════════════════════════════════════════════
// PROBAR `accion:'rol'` CON UNA SESIÓN DE VERDAD, DESDE LA APP DESPLEGADA
//
// Entra a betangar.com con un usuario real, y desde DENTRO de la página —con el
// token que la propia sesión le dio— llama a `/api/btg-usuarios`. O sea: el
// camino completo, no la pieza. [[norma-probar-el-camino-no-la-pieza]]
//
// ⛔ LA CLAVE NO VIVE ACÁ. Se pasa por variable de entorno, y el script la tapa
//    en todo lo que imprime. Un archivo del repo con una clave adentro es una
//    filtración, no una prueba.
//
//   BTG_USER=pruebarol BTG_PASS=... node scripts/probar-cambio-de-rol-con-sesion.mjs [--objetivo pruebarol] [--rol operador]
//
// QUÉ MIDE, y cada cosa dice algo distinto:
//   1. Que la sesión se abre de verdad en la app desplegada (y con qué rol).
//   2. Que `/api/btg-usuarios` reconoce ESTA instancia — si el `ref` de la base no
//      estuviera en `BTG_TENANTS` del servidor, contestaría 403 «no está
//      habilitada» en vez de mirar el rol. Esa era una pregunta abierta.
//   3. Que el candado de autorización funciona: con un rol que no es superadmin,
//      la respuesta tiene que ser 403 «Solo un superadmin puede gestionar
//      usuarios», ANTES de tocar ninguna fila.
//   4. Con un superadmin, que el cambio de rol entre y que el servidor devuelva
//      `rol`, `rol_anterior` y `sesiones_cerradas`.
//
// ⛔ QUÉ NO MIDE: si corre con un rol que no es superadmin, NO prueba que el
//    cambio funcione — prueba que está bien cerrado. Las dos cosas hacen falta y
//    no son la misma.
// ═══════════════════════════════════════════════════════════════════════════════
import { pathToFileURL } from 'url';

const USER = process.env.BTG_USER || '';
const PASS = process.env.BTG_PASS || '';
const arg = (n, d) => { const i = process.argv.indexOf(n); return i > 0 ? process.argv[i + 1] : d; };
const OBJETIVO = arg('--objetivo', 'pruebarol');
const ROL_NUEVO = arg('--rol', 'operador');
const URL_APP = arg('--url', 'https://betangar.com/app.html');
const GLOBAL = 'C:/Users/Maxbetangar/AppData/Roaming/npm/node_modules/playwright/index.js';

if (!USER || !PASS) {
  console.error('Faltan BTG_USER y BTG_PASS (por variable de entorno, no por argumento).');
  process.exit(2);
}
// Nada de lo que se imprima puede llevar la clave.
const tapar = (s) => String(s).split(PASS).join('«clave tapada»');

let pw;
try { pw = await import('playwright'); }
catch {
  try { pw = await import(pathToFileURL(GLOBAL).href); }
  catch { console.error('Falta Playwright: npm i -g playwright && npx playwright install chromium'); process.exit(1); }
}
const chromium = pw.chromium || (pw.default && pw.default.chromium);

const b = await chromium.launch();
const ctx = await b.newContext();     // contexto NUEVO: el navegador ya usado es otro producto
const page = await ctx.newPage();
const errores = [];
page.on('pageerror', e => errores.push(String(e.message).slice(0, 160)));

await page.goto(URL_APP, { waitUntil: 'domcontentloaded', timeout: 120000 });
await page.waitForFunction('typeof doLogin==="function" && typeof cambiarUsuarioRol==="function"', null, { timeout: 120000 });

// Lo primero: ¿la app desplegada trae el cambio? Si no, todo lo demás no dice nada.
const version = await page.evaluate(() => {
  const s = [...document.querySelectorAll('script')].map(x => x.getAttribute('src') || '').find(x => x.includes('app.js'));
  return { src: s || '(sin app.js)', tieneFuncion: typeof window.cambiarUsuarioRol === 'function' };
});
console.log('\n── La app que se está probando ───────────────────────────────────────');
console.log('  ' + version.src + '   cambiarUsuarioRol: ' + version.tieneFuncion);

// ── 1) Entrar de verdad ────────────────────────────────────────────────────────
await page.fill('#login-user', USER);
await page.fill('#login-pass', PASS);
await page.click('button:has-text("Entrar"), #btn-login, [onclick*="doLogin"]').catch(async () => {
  await page.evaluate(() => doLogin());
});
await page.waitForTimeout(6000);

const sesion = await page.evaluate(async () => {
  let tok = '', rol = null, usuario = null;
  try {
    const s = await supabaseAuth.auth.getSession();
    tok = (s && s.data && s.data.session) ? s.data.session.access_token : '';
    const u = (s && s.data && s.data.session) ? s.data.session.user : null;
    rol = u && u.user_metadata ? u.user_metadata.rol : null;
    usuario = u ? u.email : null;
  } catch (e) {}
  // ⛔ EL CARTEL SE MIDE COMO SE VE, NO POR SU `style.display`. La primera versión de
  //    esto preguntaba `err.style.display !== 'none'` —el estilo EN LÍNEA, que arranca
  //    vacío— y daba «la pantalla dice: Usuario o contrasena incorrectos» en un login
  //    que había entrado perfecto: la aserción acusaba al producto de un defecto que
  //    era mío. `offsetParent === null` es lo que de verdad significa «no se ve».
  //    [[norma-una-asercion-mal-escrita-acusa-al-producto]]
  const err = document.getElementById('login-error');
  const seVe = !!(err && err.offsetParent !== null && (err.textContent || '').trim());
  return { haySesion: !!tok, largoToken: tok.length, rolEnElToken: rol, correo: usuario,
           errorEnPantalla: seVe ? err.textContent : null };
});
console.log('\n── La sesión ─────────────────────────────────────────────────────────');
console.log('  sesión abierta: ' + sesion.haySesion + '   correo: ' + sesion.correo +
            '   rol en el token: ' + sesion.rolEnElToken + '   token: ' + sesion.largoToken + ' car.');
if (sesion.errorEnPantalla) console.log('  la pantalla dice: ' + tapar(sesion.errorEnPantalla));
if (!sesion.haySesion) { console.log('\n⛔ Sin sesión no se puede probar el endpoint.\n'); await b.close(); process.exit(1); }

// ── 2, 3 y 4) El endpoint, llamado DESDE la página con su propio token ─────────
const r = await page.evaluate(async ([objetivo, rolNuevo]) => {
  const j = await btgUsuariosAPI('POST', { accion: 'rol', usuario: objetivo, rol: rolNuevo });
  return j;
}, [OBJETIVO, ROL_NUEVO]);

console.log('\n── Lo que contestó /api/btg-usuarios ─────────────────────────────────');
console.log('  ' + tapar(JSON.stringify(r)));

const txt = JSON.stringify(r);
if (/Solo un superadmin/.test(txt)) {
  console.log('\n  ✅ El candado de autorización FUNCIONA: un rol que no es superadmin se rechaza.');
  console.log('  ✅ Y esta instancia SÍ está en BTG_TENANTS: llegó a mirar el rol en vez de');
  console.log('     contestar «esta instancia no está habilitada».');
  console.log('  ⛔ Lo que NO queda probado: que el cambio entre. Eso pide un superadmin.');
} else if (/no está habilitada/.test(txt)) {
  console.log('\n  ⛔ Esta instancia NO está en BTG_TENANTS del servidor: la pantalla de');
  console.log('     Usuarios no va a poder listar ni cambiar nada acá.');
} else if (r && r.ok) {
  console.log('\n  ✅ El cambio ENTRÓ: ' + r.rol_anterior + ' → ' + r.rol +
              ' · sesiones cerradas: ' + r.sesiones_cerradas + (r.aviso ? (' · aviso: ' + r.aviso) : ''));
} else if (/Acción no reconocida/.test(txt)) {
  console.log('\n  ⛔ El servidor NO tiene la acción `rol`: el endpoint desplegado es el viejo.');
} else {
  console.log('\n  ⚠️ Respuesta inesperada, hay que mirarla.');
}

if (errores.length) { console.log('\n── Errores de JavaScript en la página ───────────'); errores.forEach(e => console.log('  · ' + tapar(e))); }
await b.close();
console.log('');
