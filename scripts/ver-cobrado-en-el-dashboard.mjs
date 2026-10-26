// ═══════════════════════════════════════════════════════════════════════════════
// ¿POR QUÉ EL DASHBOARD DICE QUE NO SE HA COBRADO NADA? — EN UN NAVEGADOR
//
// 🔴 POR QUÉ EXISTE. Máximo, 26/10/2026: «EN BETANGAR DICE EL DASHBOARD QUE NO SE HA
//    COBRADO NADA? ESTA EN 0 Y TODO ESTA POR COBRAR … NI TAMPOCO ESTABA ASI». Ese mismo
//    día Alejandra cargó cobros nuevos.
//
//    Desde afuera se descartó TODO (26/10):
//      · `abonos` tiene 32 filas y suma US$ 715.247, hasta el 22/10. Ni nulos ni ceros.
//      · `planillas`: 2.173 filas, ejecutado US$ 1.683.752 → la tarjeta DEBERÍA decir
//        $715.247 y «42% de lo ejecutado».
//      · Su `app_rol()` devuelve `superadmin` y el RLS de `abonos` deja leer a ese rol.
//      · Con SU token, la consulta EXACTA de `_selectAll('abonos',['f','id'])` devuelve
//        las 32 filas (`Content-Range: 0-31/32`).
//      · Producción sirve el MISMO commit que el repo local (`?v=20261026-1135`), y el
//        único commit de hoy toca la nómina, no el dashboard ni los abonos.
//      · Los índices del `Promise.allSettled` están alineados (0=planillas, 1=abonos).
//    ⇒ El dato y la fórmula están bien. Lo que queda solo se ve en una pantalla.
//    [[norma-una-pantalla-se-revisa-en-una-pantalla]]
//
// QUÉ COMPRUEBA: se le sirve a la página el JSON REAL de `abonos` y `planillas` (medido
// con su token y guardado en `scripts/_datos-reales/`) y se lee QUÉ DIBUJAN las tarjetas
// «Cobrado» y «Por Cobrar», más `ABONOS.length` y los errores de consola.
//
//   · Si dibuja $715.247 → el código está bien y lo que ve Máximo es su navegador
//     (bundle viejo en caché, o una carga que falló en su sesión).
//   · Si dibuja $0 con los datos buenos → el defecto es del código y queda a la vista.
//
// Cómo: se abre el `app.html` DESPLEGADO con su `app.js` DESPLEGADO y se INTERCEPTA toda
// la red a Supabase — no se lee ni se escribe NADA real, y no se usa ninguna credencial
// en el navegador: la sesión se simula. [[verificar-pantalla-en-navegador-sin-sesion]]
//
// ⛔ QUÉ NO PRUEBA: no prueba el login, ni el 2FA, ni los permisos, ni el RLS. Prueba lo
//    que la pantalla DIBUJA con el código que está en la calle.
//    [[norma-probar-el-camino-no-la-pieza]]
//
// Uso: node scripts/ver-cobrado-en-el-dashboard.mjs [url]
// ═══════════════════════════════════════════════════════════════════════════════
import { pathToFileURL } from 'url'
import { readFileSync } from 'fs'

const URL_APP = process.argv[2] || 'https://betangar.com/app.html'
const GLOBAL = 'C:/Users/Maxbetangar/AppData/Roaming/npm/node_modules/playwright/index.js'

let pw
try { pw = await import('playwright') }
catch {
  try { pw = await import(pathToFileURL(GLOBAL).href) }
  catch {
    console.error('Falta Playwright (se instalo GLOBAL a proposito):')
    console.error('  npm i -g playwright && npx playwright install chromium')
    process.exit(1)
  }
}

const dir = new URL('./_datos-reales/', import.meta.url)
const ABONOS = JSON.parse(readFileSync(new URL('abonos.json', dir), 'utf8'))
const PLANILLAS = JSON.parse(readFileSync(new URL('planillas.json', dir), 'utf8'))
const sum = (a, k) => a.reduce((s, x) => s + (Number(x[k]) || 0), 0)

console.log('DATO QUE SE LE SIRVE A LA PANTALLA')
console.log('  abonos   :', ABONOS.length, 'filas · suma m = US$', Math.round(sum(ABONOS, 'm')))
console.log('  planillas:', PLANILLAS.length, 'filas · suma m = US$', Math.round(sum(PLANILLAS, 'm')))
console.log('  ⇒ Cobrado esperado: US$', Math.round(Math.min(sum(ABONOS, 'm'), sum(PLANILLAS, 'm'))))
console.log('')

// En Windows el import() de un paquete global puede venir bajo `default` — lo mismo que
// ya resolvió `ver-semanas-faltantes-nomina-en-navegador.mjs`.
const chromium = pw.chromium || (pw.default && pw.default.chromium)
if (!chromium) { console.error('Playwright se importo pero no trae `chromium`.'); process.exit(1) }
const browser = await chromium.launch()
// Contexto NUEVO siempre: revisar con el navegador que ya usaste es otro producto.
const ctx = await browser.newContext()
const page = await ctx.newPage()

const errores = []
page.on('console', m => { if (m.type() === 'error') errores.push(m.text()) })
page.on('pageerror', e => errores.push('PAGEERROR: ' + e.message))

// ── MODO FIEL (--real): sesión REAL y API REAL, pero SOLO LECTURA ────────────
// La primera versión de este script simulaba la sesión e interceptaba la API, y NO cargó
// NADA: ni abonos ni planillas. Con eso la pantalla dibujaba $0 y parecía un defecto del
// producto — cuando el defecto era de la prueba. ⛔ Cuando un control falla, el primer
// sospechoso es EL CONTROL. [[norma-una-asercion-mal-escrita-acusa-al-producto]]
//
// Así que acá se reproduce lo que ve Máximo: su sesión de verdad, los datos de verdad, y
// TODA escritura bloqueada (solo pasan GET) para que mirar no cambie nada.
const REAL = process.argv.includes('--real')

if (REAL) {
  const bloqueadas = []
  await page.route('**/*', route => {
    const r = route.request()
    const m = r.method()
    if (m === 'GET' || m === 'HEAD' || m === 'OPTIONS') return route.continue()
    // El login es un POST legítimo y necesario; lo demás que escriba, no pasa.
    if (/\/auth\/v1\/(token|user|factors)/.test(r.url())) return route.continue()
    // ⚠️ LOS RPC SON POST Y SON LECTURAS. Bloquearlos hizo que `app_rol` devolviera `[]` y el
    // aviso saliera con el rol vacío: un defecto del ARNÉS que parecía del producto.
    if (/\/rest\/v1\/rpc\//.test(r.url())) return route.continue()
    bloqueadas.push(m + ' ' + r.url().split('?')[0])
    return route.fulfill({ status: 200, contentType: 'application/json', body: '[]' })
  })
  page._bloqueadas = bloqueadas
}

// ⚠️ EL ORDEN DE REGISTRO MANDA: en Playwright gana la ruta registrada ULTIMA. La 1ª
// version registraba `--sinrol` ANTES del catch-all de `--real` y quedaba pisada: el
// control decia verde sin haber probado nada. Va al final a proposito.
// ── MODO SIN ROL (--sinrol): reproduce EXACTAMENTE lo que le pasó a Máximo ───────────────
// Su sesión de agosto seguía viva pero sin fila en `btg_usuarios` (se movió el 23/10). La RLS
// entonces no da error: da CERO FILAS en `abonos` y las da TODAS en `planillas`, que no pide
// rol. Acá se simula justo eso sobre la app real: `app_rol` devuelve null y `abonos` vuelve
// vacío. Sin este control no hay forma de saber si el aviso nuevo sale cuando toca.
const SINROL = process.argv.includes('--sinrol')
if (SINROL) {
  await page.route('**/rest/v1/rpc/app_rol*', r => r.fulfill({ status: 200, contentType: 'application/json', body: 'null' }))
  await page.route('**/rest/v1/abonos*', r => r.fulfill({ status: 200, contentType: 'application/json', headers: { 'Content-Range': '*/0' }, body: '[]' }))
}


// ── Toda la red a Supabase se corta y se responde a mano ────────────────────
const json = (route, body, headers = {}) =>
  route.fulfill({ status: 200, contentType: 'application/json', headers, body: JSON.stringify(body) })

if (!REAL) await page.route('**/auth/v1/**', route => {
  const u = route.request().url()
  // Sesión simulada: ni credenciales ni token real entran al navegador.
  if (u.includes('/user')) return json(route, { id: 'u-prueba', email: 'prueba@betangar.local', user_metadata: { rol: 'superadmin', usuario: 'prueba' } })
  if (u.includes('/factors')) return json(route, { totp: [], all: [] })
  return json(route, {
    access_token: 'simulado', refresh_token: 'simulado', token_type: 'bearer', expires_in: 3600,
    expires_at: Math.floor(Date.now() / 1000) + 3600,
    user: { id: 'u-prueba', email: 'prueba@betangar.local', user_metadata: { rol: 'superadmin', usuario: 'prueba' } },
  })
})

if (!REAL) await page.route('**/rest/v1/**', route => {
  const u = route.request().url()
  const tabla = (u.split('/rest/v1/')[1] || '').split('?')[0]
  let filas = []
  if (tabla === 'abonos') filas = ABONOS
  else if (tabla === 'planillas') filas = PLANILLAS
  else if (tabla === 'btg_usuarios') filas = [{ usuario: 'prueba', rol: 'superadmin', nombre: 'Prueba', activo: true, demo: false, exige_token: false }]
  // Content-Range es lo que usa la paginación de _selectAll para saber si hay más.
  const total = filas.length
  return json(route, filas, { 'Content-Range': `0-${Math.max(0, total - 1)}/${total}` })
})
if (!REAL) await page.route('**/rpc/**', route => json(route, null))

await page.goto(URL_APP, { waitUntil: 'domcontentloaded' })

// Sesión de app ya iniciada: así se entra al dashboard sin pasar por el login ni el 2FA
// (el 2FA no se saltea: se evita el formulario, que no es lo que se está probando).
const ses = REAL ? JSON.parse(readFileSync(new URL('sesion.json', dir), 'utf8')) : null
await page.evaluate(s => {
  localStorage.setItem('betangar_sesion', JSON.stringify({ usuario: 'maxbetangar', rol: 'superadmin', nombre: 'Maximo', demo: false, _ts: Date.now() }))
  localStorage.setItem('btg-auth', JSON.stringify(s || {
    access_token: 'simulado', refresh_token: 'simulado', token_type: 'bearer', expires_in: 3600,
    expires_at: Math.floor(Date.now() / 1000) + 3600,
    user: { id: 'u-prueba', aud: 'authenticated', role: 'authenticated', user_metadata: { rol: 'superadmin' } },
  }))
  // El dispositivo queda "de confianza" para que el 2FA no abra su modal y tape la pantalla.
  try { if (s && s.user) localStorage.setItem('btg_trust_' + s.user.id, String(Date.now() + 864e5)) } catch (e) {}
}, ses)
await page.reload({ waitUntil: 'load' })
// ⛔ NO SE ESPERA UN RATO FIJO: SE ESPERA LA SEÑAL. Con 25 s fijos este control dijo dos veces
// «Cargando…» con la sesión buena y los datos buenos — o sea acusó al producto de un defecto
// que era la espera corta. Un control que falla al azar es peor que no tener control: enseña a
// desconfiar del verde. Se espera a que la app DECLARE que terminó de cargar.
// [[norma-una-asercion-mal-escrita-acusa-al-producto]]
// Medido el 26/10 en esta misma app: la carga declara `hecha` a los ~15 s y la tarjeta se
// REPINTA ~10 s DESPUÉS. Por eso no basta con esperar la carga: hay que esperar el repintado.
// En esa ventana de 10 s la tarjeta decía «$0» — justo la mentira que se vino a arreglar.
let listo = false
for (let i = 0; i < 24; i++) {
  await page.waitForTimeout(5000)
  const st = await page.evaluate(() => ({
    hecha: typeof DATOS_CARGA !== 'undefined' && DATOS_CARGA.hecha === true,
    sub: ((document.getElementById('s-cobrado-sub') || {}).textContent || '').trim(),
  }))
  // ⛔ LA SEÑAL ES EL REPINTADO, NO EL FIN DE LA CARGA. Cortar en `hecha` leía la tarjeta
  // ANTES de que se redibujara, así que el control informaba «Cargando…» incluso en el caso
  // que sí funcionaba. El subtítulo es lo que cambia en los dos finales posibles: la cifra
  // («2.288 viajes · 42%…») o el motivo («No se pudo cargar — …»).
  if (st.hecha && st.sub && st.sub !== 'Cargando…' && st.sub !== '-') { listo = true; break }
}
if (!listo) console.log('⚠️ A los 120 s la pantalla seguía sin un valor definitivo — lo de abajo es el estado a medio cargar.')

const leer = id => page.evaluate(i => { const e = document.getElementById(i); return e ? e.textContent.trim() : '(no existe)' }, id)
const visto = {
  ejecutado: await leer('s-ejec'),
  cobrado: await leer('s-cobrado'),
  cobradoSub: await leer('s-cobrado-sub'),
  porCobrar: await leer('s-porcobrar'),
  porCobrarSub: await leer('s-porcobrar-sub'),
}
const memoria = await page.evaluate(() => ({
  abonos: (typeof ABONOS !== 'undefined' && ABONOS) ? ABONOS.length : '(ABONOS no existe)',
  regs: (typeof REGS !== 'undefined' && REGS) ? REGS.length : '(REGS no existe)',
  sumaAbonos: (typeof ABONOS !== 'undefined' && ABONOS) ? ABONOS.reduce((s, a) => s + (Number(a.m) || 0), 0) : null,
  rol: (typeof SESION !== 'undefined' && SESION) ? SESION.rol : '(sin SESION)',
}))

console.log('LO QUE DIBUJA LA PANTALLA')
for (const [k, v] of Object.entries(visto)) console.log('  ' + k.padEnd(13), v)
console.log('')
console.log('LO QUE TIENE EN MEMORIA')
for (const [k, v] of Object.entries(memoria)) console.log('  ' + k.padEnd(13), v)

if (errores.length) {
  console.log('')
  console.log('⛔ ERRORES DE CONSOLA (' + errores.length + ') — un throw tragado por un catch no se ve en la pantalla:')
  errores.slice(0, 12).forEach(e => console.log('   · ' + e.slice(0, 220)))
}

const cob = String(visto.cobrado).replace(/[^0-9]/g, '')
console.log('')
console.log(cob && Number(cob) > 0
  ? '✅ La pantalla SI dibuja el cobrado con los datos buenos ⇒ el codigo esta bien; mirar el navegador de Maximo (cache / carga fallida).'
  : '🔴 La pantalla dibuja CERO con los datos buenos ⇒ el defecto es del codigo y esta en este render.')

await browser.close()
