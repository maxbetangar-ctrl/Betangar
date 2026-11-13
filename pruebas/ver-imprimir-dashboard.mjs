// ═══════════════════════════════════════════════════════════════════════════════
// EL BOTÓN «🖨 Imprimir / PDF» DEL DASHBOARD — EN UN NAVEGADOR
//
// 🔴 POR QUÉ EXISTE. Máximo, 13/11/2026: «no me está dejando imprimir el dashboard».
//    No salía ningún aviso: el botón simplemente no hacía NADA.
//
//    La causa: en `imprimirDashboard()`, la fila de «⛽ Combustible surtido hoy» arma el
//    HTML con una variable `corr` —la marca de «corregida» / «⛔ ANULADA»— que NUNCA se
//    declaró en esa función. Vino en el commit 1878953 (25/07), portada de la tabla de
//    PANTALLA, donde sí está declarada; al papel se copió el USO y no la DECLARACIÓN.
//
//    ⛔ Y por eso tardó meses en verse: la línea vive dentro de `if(_surHoy.length)`.
//       Un día SIN surtidas cargadas imprime perfecto. Un día CON surtidas revienta con
//       `ReferenceError: corr is not defined` — y como `imprimirDashboard` es `async`,
//       el throw se vuelve una promesa rechazada: ni toast, ni alerta, ni nada.
//       Es el mismo accidente que «VX is not defined» del 21/08.
//
// QUÉ COMPRUEBA — los TRES estados en una corrida:
//   1. SIN el arreglo (se le quita la declaración al vuelo) → el papel NO sale y la
//      consola dice `corr is not defined`. Es el CONTROL POSITIVO: sin este caso, el
//      verde de abajo no probaría nada. [[norma-una-asercion-mal-escrita-acusa-al-producto]]
//   2. CON el arreglo y CON surtidas de hoy → el papel sale, trae la tabla de combustible
//      y las marcas «✏️ corregida» y «⛔ ANULADA» de las surtidas tocadas.
//   3. CON el arreglo y SIN surtidas de hoy → el papel sale igual (el camino que SIEMPRE
//      funcionó no se tocó). [[norma-una-seccion-condicional-sin-datos-parece-que-no-existe]]
//
// Cómo: se abre el `app.html` DESPLEGADO y se le sirve el `app.js` DE DISCO —el que se
// está tocando—, con toda la red a Supabase interceptada. No se lee ni se escribe NADA
// real y no entra ninguna credencial al navegador: la sesión se simula.
// [[verificar-pantalla-en-navegador-sin-sesion]]
//
// ⛔ QUÉ NO PRUEBA: ni el login, ni el 2FA, ni los permisos, ni el RLS, ni que la
//    impresora imprima. Prueba lo que la pantalla DIBUJA.
//    [[norma-probar-el-camino-no-la-pieza]]
//
// ⚠️ Los datos son INVENTADOS a propósito: este repo es PÚBLICO.
//
// Uso: node pruebas/ver-imprimir-dashboard.mjs [url]
// ═══════════════════════════════════════════════════════════════════════════════
import { pathToFileURL, fileURLToPath } from 'url'
import { readFileSync, writeFileSync } from 'fs'

const URL_APP = process.argv[2] || 'https://betangar.com/app.html'
const JS_LOCAL = new URL('../app.js', import.meta.url)
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
const chromium = pw.chromium || (pw.default && pw.default.chromium)
if (!chromium) { console.error('Playwright se importo pero no trae `chromium`.'); process.exit(1) }

// ── El app.js de disco, y el mismo SIN el arreglo ────────────────────────────
const JS_SANO = readFileSync(JS_LOCAL, 'utf8')
const RE_DECL = /var corr=s\.corregido_por\?[\s\S]*?\):'';/
// ⛔ El script se NIEGA a correr si el app.js de disco no trae el arreglo: si no, se
//    revisaría la versión vieja y los tres casos saldrían verdes por nada.
if (!RE_DECL.test(JS_SANO)) {
  console.error('⛔ El app.js de disco NO declara `corr` dentro de imprimirDashboard.')
  console.error('   Esta prueba revisa ESE arreglo: sin él no hay nada que verificar.')
  process.exit(1)
}
const JS_ROTO = JS_SANO.replace(RE_DECL, '')

// ── Datos INVENTADOS ─────────────────────────────────────────────────────────
const hoyVE = new Date(Date.now() - 4 * 3600e3).toISOString().slice(0, 10)
const SURTIDAS_HOY = [
  { id: 's1', fecha: hoyVE, hora: '07:12', cam: 'XXX-001', tanque: 'tanque-jac', litros: 180, costo_usd: 63, costo_definido: true, corregido_por: null },
  { id: 's2', fecha: hoyVE, hora: '09:40', cam: 'XXX-002', tanque: 'estacion', litros: 95, costo_usd: 38, costo_definido: true, corregido_por: 'oficina' },
  { id: 's3', fecha: hoyVE, hora: '11:05', cam: 'XXX-003', tanque: 'tanque-jac', litros: 0, costo_usd: 0, costo_definido: true, corregido_por: 'oficina', valor_anterior: { historial: [{ motivo: 'cargada dos veces', litros: 120 }] } },
]
const PLANILLAS = Array.from({ length: 6 }, (_, i) => ({
  id: 'p' + i, f: hoyVE, cam: 'XXX-00' + ((i % 3) + 1), t: 8 + i, m: 300, viajes: 1,
  mes: 'nov-26', chofer: 'CHOFER DE PRUEBA ' + (i + 1), parroquia: 'PRUEBA',
}))
const ABONOS = [{ id: 'a1', f: hoyVE, m: 900, v: 3, factura: 'M0001' }]

// ── La corrida de UN caso ────────────────────────────────────────────────────
async function correr({ nombre, js, surtidas, esperaPapel }) {
  const browser = await chromium.launch()
  const ctx = await browser.newContext()          // contexto NUEVO siempre
  const page = await ctx.newPage()

  const errores = []
  page.on('console', m => { if (m.type() === 'error') errores.push(m.text()) })
  page.on('pageerror', e => errores.push('PAGEERROR: ' + e.message))

  const json = (route, body, headers = {}) =>
    route.fulfill({ status: 200, contentType: 'application/json', headers, body: JSON.stringify(body) })

  // ⚠️ EL ORDEN MANDA: en Playwright gana la ruta registrada ÚLTIMA. El comodín va PRIMERO.
  await page.route('**/*.supabase.co/**', route => json(route, []))
  await page.route('**/auth/v1/**', route => {
    const u = route.request().url()
    const user = { id: 'u-prueba', email: 'prueba@betangar.local', user_metadata: { rol: 'superadmin', usuario: 'prueba' } }
    if (u.includes('/user')) return json(route, user)
    if (u.includes('/factors')) return json(route, { totp: [], all: [] })
    return json(route, {
      access_token: 'simulado', refresh_token: 'simulado', token_type: 'bearer',
      expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600, user,
    })
  })
  await page.route('**/rest/v1/**', route => {
    const u = route.request().url()
    const tabla = (u.split('/rest/v1/')[1] || '').split('?')[0]
    let filas = []
    if (tabla === 'surtidas') filas = surtidas
    else if (tabla === 'planillas') filas = PLANILLAS
    else if (tabla === 'abonos') filas = ABONOS
    else if (tabla === 'btg_usuarios') filas = [{ usuario: 'prueba', rol: 'superadmin', nombre: 'Prueba', activo: true, demo: false, exige_token: false }]
    return json(route, filas, { 'Content-Range': `0-${Math.max(0, filas.length - 1)}/${filas.length}` })
  })
  await page.route('**/rpc/**', route => json(route, null))
  // ⚠️ `app_rol` NO puede caer en el comodín de arriba. Con `null` la app declara «su sesión
  //    no tiene rol en la base» y el dashboard se niega a imprimir — un fallo del ARNÉS que
  //    parecía del producto. Va DESPUÉS porque gana la ruta registrada última.
  //    [[norma-una-asercion-mal-escrita-acusa-al-producto]]
  await page.route('**/rest/v1/rpc/app_rol*', route => json(route, 'superadmin'))
  // El app.js de DISCO dentro del app.html DESPLEGADO.
  await page.route('**/app.js*', route => route.fulfill({ status: 200, contentType: 'application/javascript', body: js }))

  await page.goto(URL_APP, { waitUntil: 'domcontentloaded' })
  await page.evaluate(() => {
    localStorage.setItem('betangar_sesion', JSON.stringify({ usuario: 'prueba', rol: 'superadmin', nombre: 'Prueba', demo: false, _ts: Date.now() }))
    localStorage.setItem('btg-auth', JSON.stringify({
      access_token: 'simulado', refresh_token: 'simulado', token_type: 'bearer', expires_in: 3600,
      expires_at: Math.floor(Date.now() / 1000) + 3600,
      user: { id: 'u-prueba', aud: 'authenticated', role: 'authenticated', user_metadata: { rol: 'superadmin' } },
    }))
  })
  await page.reload({ waitUntil: 'load' })

  // ⛔ NO SE ESPERA UN RATO FIJO: SE ESPERA LA SEÑAL. El papel se niega a salir mientras
  //    `_dashSinDatos()` diga «Cargando…», así que apurarse acá acusaría al producto de
  //    un defecto que es de la espera.
  let cargada = false
  for (let i = 0; i < 24; i++) {
    await page.waitForTimeout(2500)
    cargada = await page.evaluate(() => typeof DATOS_CARGA !== 'undefined' && DATOS_CARGA.hecha === true)
    if (cargada) break
  }

  // ⛔ UN «NO SALIÓ EL PAPEL» SIN MOTIVO NO SIRVE DE NADA: es la barra que no dice qué
  //    sigue. Antes de tocar el botón se le pregunta a la propia app por qué se negaría,
  //    y se enganchan las promesas rechazadas — que es justo como se perdía el error.
  const motivo = await page.evaluate(() => {
    try { return (typeof _dashSinDatos === 'function') ? (_dashSinDatos() || '(sin motivo: deberia imprimir)') : '(no existe _dashSinDatos)' }
    catch (e) { return 'EXCEPCION al preguntar: ' + e.message }
  })
  await page.evaluate(() => {
    window.__rechazos = []
    window.addEventListener('unhandledrejection', ev => {
      window.__rechazos.push(String((ev.reason && ev.reason.message) || ev.reason))
    })
  })

  // El botón de verdad, no la función a mano: se prueba el CAMINO.
  const btn = page.locator('button', { hasText: 'Imprimir / PDF' }).first()
  let papel = null
  try {
    const [pop] = await Promise.all([
      page.waitForEvent('popup', { timeout: 25000 }),
      btn.click(),
    ])
    await pop.waitForLoadState('domcontentloaded')
    papel = pop
  } catch { papel = null }

  const rechazos = await page.evaluate(() => window.__rechazos || []).catch(() => [])
  const r = { nombre, cargada, motivo, rechazos, salioPapel: !!papel, errores, titulo: '', tieneTabla: false, corregida: false, anulada: false }
  if (papel) {
    r.titulo = await papel.title()
    const txt = await papel.evaluate(() => document.body.innerText)
    r.tieneTabla = /Combustible surtido hoy/i.test(txt)
    r.corregida = /corregida/i.test(txt)
    r.anulada = /ANULADA/i.test(txt)
    const png = new URL('./_imprimir-' + nombre.replace(/[^a-z0-9]+/gi, '-').toLowerCase() + '.png', import.meta.url)
    await papel.screenshot({ path: fileURLToPath(png), fullPage: true })
    r.captura = png.pathname.split('/').pop()
  }
  await browser.close()
  return { ...r, esperaPapel }
}

// ── Los tres estados ─────────────────────────────────────────────────────────
const casos = [
  { nombre: 'sin el arreglo', js: JS_ROTO, surtidas: SURTIDAS_HOY, esperaPapel: false },
  { nombre: 'con surtidas de hoy', js: JS_SANO, surtidas: SURTIDAS_HOY, esperaPapel: true },
  { nombre: 'sin surtidas de hoy', js: JS_SANO, surtidas: [], esperaPapel: true },
]

let fallos = 0
for (const c of casos) {
  const r = await correr(c)
  const ok = r.salioPapel === r.esperaPapel
  const refErr = r.errores.some(e => /corr is not defined/.test(e))
  console.log('')
  console.log('── ' + r.nombre.toUpperCase())
  console.log('   carga terminada :', r.cargada)
  console.log('   _dashSinDatos() :', r.motivo)
  console.log('   salió el papel  :', r.salioPapel, '(se esperaba ' + r.esperaPapel + ')')
  if (r.rechazos.length) console.log('   promesa rechazada:', r.rechazos.slice(0, 3).join(' | '))
  if (r.salioPapel) {
    console.log('   título          :', r.titulo)
    console.log('   tabla de combustible:', r.tieneTabla, '| ✏️ corregida:', r.corregida, '| ⛔ ANULADA:', r.anulada)
    console.log('   captura         :', r.captura)
  }
  if (r.errores.length) console.log('   consola         : ' + r.errores.slice(0, 4).map(e => e.slice(0, 160)).join(' | '))

  let veredicto = ok ? '✅' : '🔴'
  if (c.nombre === 'sin el arreglo') {
    // El control positivo tiene que fallar POR EL MOTIVO BUENO, no por cualquiera.
    if (!refErr) { veredicto = '🔴'; console.log('   ⛔ falló, pero NO por `corr is not defined` — el arnés no está probando lo que dice') }
  }
  if (c.nombre === 'con surtidas de hoy' && ok && !(r.tieneTabla && r.corregida && r.anulada)) {
    veredicto = '🔴'
    console.log('   ⛔ el papel salió pero SIN la tabla o SIN las marcas: el arreglo no está haciendo su trabajo')
  }
  console.log('   ' + veredicto)
  if (veredicto === '🔴') fallos++
}

console.log('')
console.log(fallos ? '🔴 ' + fallos + ' caso(s) en rojo.' : '✅ Los 3 casos en verde: sin el arreglo el papel NO sale, con el arreglo sale (haya o no surtidas).')
process.exit(fallos ? 1 : 0)
