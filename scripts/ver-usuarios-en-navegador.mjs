// ═══════════════════════════════════════════════════════════════════════════════
// VER LA PANTALLA DE USUARIOS EN UN NAVEGADOR DE VERDAD, SIN SESIÓN
//
// Qué revisa: el CAMBIO DE ROL que pidió Alejandra el 07/10/2026 («¿dónde está el botón
// para cambiar rol? porque en la pantalla de usuarios no está» — no estaba). Mira cuatro
// cosas en la misma corrida:
//
//   1. Cada usuario normal dibuja un DESPLEGABLE y el valor que muestra es SU rol real
//      (un <select> que muestra otro rol es peor que no tener desplegable).
//   2. `superadmin` y los roles que no se ofrecen (`demo_*`) dibujan ETIQUETA, no
//      desplegable: no se les cambia el rol desde acá.
//   3. CAMINO COMPLETO: se elige otro rol, se acepta el aviso y se comprueba QUÉ SALE
//      hacia la API (`accion:'rol'` con el usuario y el rol nuevo).
//   4. Que al CANCELAR el aviso el desplegable vuelva a lo que era — si se queda en el
//      rol nuevo, la pantalla dice que el cambio entró y no entró.
//
// Cómo: se abre el `app.html` DESPLEGADO y se le sirve el `app.js` LOCAL (el que se está
// revisando). Se corta toda la red hacia Supabase y se intercepta la API de usuarios, así
// que no se lee ni se escribe NADA real y ninguna cuenta cambia de rol.
//
// ⛔ QUÉ NO PRUEBA: no prueba la API ni sus permisos. No prueba que el servidor rechace
//    `superadmin` (eso vive en `geppetto-app/pages/api/btg-usuarios.js` y se verifica
//    aparte), ni que se cierren las sesiones, ni el RLS. Prueba lo que la pantalla DIBUJA
//    y lo que MANDA. Las dos mitades no se ven pegadas hasta que haya un login de verdad.
//
// Uso: node scripts/ver-usuarios-en-navegador.mjs [app.js local] [url de app.html]
// ═══════════════════════════════════════════════════════════════════════════════
import { pathToFileURL } from 'url';
import { readFileSync } from 'fs';
import path from 'path';

const JS_LOCAL = process.argv[2] || path.join(process.cwd(), 'app.js');
const URL_APP = process.argv[3] || 'https://betangar.com/app.html';
const GLOBAL = 'C:/Users/Maxbetangar/AppData/Roaming/npm/node_modules/playwright/index.js';

let pw;
try { pw = await import('playwright'); }
catch {
  try { pw = await import(pathToFileURL(GLOBAL).href); }
  catch {
    console.error('Falta Playwright. Se instalo GLOBAL a proposito (en el package.json haria');
    console.error('que Vercel lo bajara en cada despliegue para algo que se usa a mano):');
    console.error('  npm i -g playwright && npx playwright install chromium');
    process.exit(1);
  }
}

// Los cuatro casos que importan, en una sola lista.
//  · maxbetangar  → superadmin        ⇒ etiqueta (no se toca)
//  · demovisor    → demo_admin        ⇒ etiqueta (rol que no se ofrece)
//  · aurelys      → operador          ⇒ desplegable
//  · katty        → rrhh              ⇒ desplegable
//  · compras1     → compras           ⇒ desplegable (rol que vive en la base)
const USUARIOS = [
  { usuario: 'maxbetangar', nombre: 'Maximo Betancourt', rol: 'superadmin', activo: true },
  { usuario: 'demovisor', nombre: 'Demo visor', rol: 'demo_admin', activo: true },
  { usuario: 'aurelys', nombre: 'Aurelys Gonzalez', rol: 'operador', activo: true },
  { usuario: 'katty', nombre: 'Katty Perez', rol: 'rrhh', activo: false },
  { usuario: 'compras1', nombre: 'Compras Uno', rol: 'compras', activo: true },
];

const chromium = pw.chromium || (pw.default && pw.default.chromium);
if (!chromium) { console.error('Playwright se importo pero no trae `chromium`.'); process.exit(1); }

const jsLocal = readFileSync(JS_LOCAL, 'utf8');
if (!/function cambiarUsuarioRol/.test(jsLocal)) {
  console.error('⛔ Ese app.js NO trae `cambiarUsuarioRol`: se estaria revisando la version vieja.');
  console.error('   Archivo: ' + JS_LOCAL);
  process.exit(1);
}

const b = await chromium.launch();
const ctx = await b.newContext();          // contexto NUEVO: el navegador ya usado es otro producto
const page = await ctx.newPage();

// El app.js que se revisa es el LOCAL, no el desplegado.
await page.route('**/app.js*', r => r.fulfill({ status: 200, contentType: 'application/javascript; charset=utf-8', body: jsLocal }));
// Toda la red hacia Supabase cortada: ni auth ni rest.
await page.route('**/*.supabase.co/**', r => r.fulfill({ status: 200, contentType: 'application/json', body: '[]' }));

// La API de usuarios: el GET devuelve la lista armada; el POST se GUARDA para mirarlo.
const mandado = [];
await page.route('**/btg-usuarios**', r => {
  const req = r.request();
  if (req.method() === 'POST') {
    let cuerpo = null;
    try { cuerpo = JSON.parse(req.postData() || '{}'); } catch (e) { cuerpo = { _ilegible: req.postData() }; }
    mandado.push(cuerpo);
    return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, rol: cuerpo.rol, rol_anterior: 'operador', sesiones_cerradas: 2 }) });
  }
  return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, usuarios: USUARIOS, instancia: 'Principal (Betangar)' }) });
});

const avisos = [];
page.on('dialog', async d => { avisos.push(d.type() + ': ' + d.message().replace(/\n+/g, ' | ')); await d.accept(); });

await page.goto(URL_APP, { waitUntil: 'domcontentloaded', timeout: 120000 });
await page.waitForFunction('typeof renderUsuarios==="function" && typeof cambiarUsuarioRol==="function"', null, { timeout: 120000 });

// ── 1 y 2: qué dibuja cada fila ────────────────────────────────────────────────
await page.evaluate(() => renderUsuarios());
await page.waitForFunction('document.querySelectorAll("#tb-usuarios tr").length >= 5', null, { timeout: 30000 });

// ⛔ LA PANTALLA ESTA DIBUJADA PERO ESCONDIDA detrás del login y del cambio de sección, y
//    Playwright NO toca lo que no se ve — con razón: un `force:true` probaría un clic que
//    un humano no puede dar. Se le abre la sección a mano (no se saltea nada del código de
//    la pantalla: ya se renderizó con `renderUsuarios()`), y así el `change` es real.
await page.evaluate(() => {
  for (let n = document.getElementById('tb-usuarios'); n && n !== document.body; n = n.parentElement) {
    n.style.display = '';
    n.classList.add('activa', 'active');
    n.removeAttribute('hidden');
  }
  document.querySelectorAll('#login-screen,#login,.login-wrap,#overlay').forEach(e => { e.style.display = 'none'; });
});

const filas = await page.evaluate(() => [...document.querySelectorAll('#tb-usuarios tr')].map(tr => {
  const celda = tr.children[2];
  const sel = celda && celda.querySelector('select');
  return {
    usuario: tr.children[0] ? tr.children[0].innerText.trim() : '?',
    tipo: sel ? 'select' : 'etiqueta',
    muestra: sel ? sel.value : (celda ? celda.innerText.trim() : '?'),
    opciones: sel ? sel.options.length : 0,
    era: sel ? sel.getAttribute('data-rol-era') : null,
  };
}));

console.log('\n── Lo que dibuja la celda «Rol» ──────────────────────────────────────');
let fallas = 0;
const esperado = { maxbetangar: 'etiqueta', demovisor: 'etiqueta', aurelys: 'select', katty: 'select', compras1: 'select' };
for (const f of filas) {
  const real = (USUARIOS.find(u => u.usuario === f.usuario) || {}).rol;
  const tipoOk = esperado[f.usuario] === f.tipo;
  const valorOk = f.tipo === 'etiqueta' ? f.muestra === real : (f.muestra === real && f.era === real);
  if (!tipoOk || !valorOk) fallas++;
  console.log(`  ${(tipoOk && valorOk) ? 'OK  ' : 'FALLA'} ${f.usuario.padEnd(13)} ${f.tipo.padEnd(9)} muestra=${String(f.muestra).padEnd(12)} opciones=${f.opciones}  (su rol: ${real})`);
}

// ── 4: cancelar tiene que revertir ─────────────────────────────────────────────
page.removeAllListeners('dialog');
page.once('dialog', async d => { avisos.push('CANCELADO ' + d.message().replace(/\n+/g, ' | ')); await d.dismiss(); });
await page.selectOption('#tb-usuarios select[data-rol-de="aurelys"]', 'admin');
await page.waitForTimeout(400);
const trasCancelar = await page.evaluate(() => document.querySelector('#tb-usuarios select[data-rol-de="aurelys"]').value);
const cancelOk = trasCancelar === 'operador' && mandado.length === 0;
if (!cancelOk) fallas++;
console.log('\n── Cancelar el aviso ─────────────────────────────────────────────────');
console.log(`  ${cancelOk ? 'OK  ' : 'FALLA'} el desplegable volvio a «${trasCancelar}» y se mandaron ${mandado.length} peticiones (se esperaba 0)`);

// ── 3: aceptar tiene que mandar la accion correcta ─────────────────────────────
page.on('dialog', async d => { avisos.push(d.message().replace(/\n+/g, ' | ')); await d.accept(); });
await page.selectOption('#tb-usuarios select[data-rol-de="aurelys"]', 'supervisor');
await page.waitForTimeout(1500);
const envio = mandado.find(m => m && m.accion === 'rol');
const envioOk = !!envio && envio.usuario === 'aurelys' && envio.rol === 'supervisor';
if (!envioOk) fallas++;
console.log('\n── Aceptar el aviso ──────────────────────────────────────────────────');
console.log(`  ${envioOk ? 'OK  ' : 'FALLA'} salio: ${JSON.stringify(envio)}`);

console.log('\n── Lo que le dijo la pantalla a quien lo hizo ────────────────────────');
avisos.forEach(a => console.log('  · ' + a.slice(0, 190)));

await b.close();
console.log(fallas ? `\n⛔ ${fallas} comprobacion(es) FALLARON\n` : '\n✅ todo verde (y esto NO prueba la API ni los permisos)\n');
process.exit(fallas ? 1 : 0);
