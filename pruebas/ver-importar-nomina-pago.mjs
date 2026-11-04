#!/usr/bin/env node
// ═══════════════════════════════════════════════════════════════════════════════════════════
// VER EN NAVEGADOR el módulo «Importar RELACIÓN DE PAGO» del módulo Nómina.
//
// ⛔ POR QUÉ. Una pantalla se revisa en una PANTALLA. El parseo ya se probó dos veces fuera
//    del navegador (un prototipo en Python y el módulo real con el mismo SheetJS vendorizado),
//    y las dos dieron lo mismo — pero eso NO prueba que la tarjeta se dibuje, ni que el
//    <input type=file> esté bien cableado, ni que no salte un error de JS al renderizar.
//    El 28/10 ya pasó: consultas en verde y el PDF mostrando una etiqueta encima del monto.
//    [[norma-revisar-antes-de-soltar]] · [[norma-probar-el-camino-no-la-pieza]]
//
// ⛔ NO HACE FALTA UNA SESIÓN DE VERDAD: se intercepta la API y se le sirven respuestas
//    armadas. El navegador es real y la página es la misma que se despliega.
//    [[verificar-pantalla-en-navegador-sin-sesion]]
//
// ⛔ QUÉ NO PRUEBA: no prueba el RLS, ni los permisos del servidor, ni que el upsert entre.
//    Prueba lo que la pantalla DIBUJA y que el camino del archivo funciona.
//
// Uso:  node pruebas/ver-importar-nomina-pago.mjs [--ver]     (--ver = con ventana)
// ═══════════════════════════════════════════════════════════════════════════════════════════
import fs from 'node:fs'
import http from 'node:http'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const EXCEL = process.env.EXCEL_PAGO ||
  'C:/Users/Maxbetangar/nomina-betangar-2026-11-04/relacion de pago octubre.xlsx'
const PUERTO = Number(process.env.PUERTO_PRUEBA || 8974)
const SALIDA = path.join(REPO, 'pruebas')

// En Windows, import() de una ruta absoluta necesita pathToFileURL o falla sin decir por qué.
let playwright
try {
  const g = (await import('node:child_process')).execSync('npm root -g', { encoding: 'utf8' }).trim()
  const mod = await import(pathToFileURL(path.join(g, 'playwright', 'index.js')).href)
  // Playwright global se carga como CommonJS: lo que trae `chromium` es `.default`, no la
  // raíz del namespace. Sin esto el error es «Cannot read properties of undefined (reading
  // 'launch')», que no dice nada de lo que pasa.
  playwright = mod.chromium ? mod : mod.default
  if (!playwright || !playwright.chromium) throw new Error('el módulo cargó pero no trae `chromium`')
} catch (e) {
  console.error('⛔ No se halló Playwright. Está instalado GLOBAL en esta máquina, no en el repo.')
  console.error('   Si falta:  npm i -g playwright && npx playwright install chromium')
  console.error('   Detalle:', e.message)
  process.exit(1)
}

if (!fs.existsSync(EXCEL)) {
  console.error(`⛔ No está el Excel de prueba: ${EXCEL}`)
  console.error('   Pasá otro con  EXCEL_PAGO="C:/ruta/al.xlsx"')
  process.exit(1)
}

// ── Servidor estático del repo (la app es HTML plano: no hay build) ──
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.png': 'image/png',
  '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.webmanifest': 'application/manifest+json' }
const servidor = http.createServer((req, res) => {
  const rel = decodeURIComponent(req.url.split('?')[0]).replace(/^\/+/, '') || 'app.html'
  const f = path.join(REPO, rel)
  if (!f.startsWith(REPO) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) {
    res.writeHead(404); res.end('no'); return
  }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(f).toLowerCase()] || 'application/octet-stream' })
  fs.createReadStream(f).pipe(res)
})
// ⛔ Un `listen` que falla con el puerto ocupado no llama a su callback: la promesa queda
//    colgada y la prueba muere mucho después, en el `goto`, con un «Timeout 30000ms» que
//    acusa a la página. El error se escucha y se DICE.
await new Promise((resolver, rechazar) => {
  servidor.once('error', (e) => rechazar(new Error(
    `no se pudo abrir el puerto ${PUERTO}: ${e.code}. Probá con  PUERTO_PRUEBA=8975 node ...`)))
  servidor.listen(PUERTO, '127.0.0.1', resolver)
})
console.log(`servidor local en http://127.0.0.1:${PUERTO}`)

const navegador = await playwright.chromium.launch({ headless: !process.argv.includes('--ver') })
// Contexto NUEVO siempre: revisar con el navegador que ya usaste es otro producto.
const ctx = await navegador.newContext({ viewport: { width: 1480, height: 1000 } })
const page = await ctx.newPage()

const errores = []
page.on('pageerror', (e) => errores.push('pageerror: ' + e.message))
page.on('console', (m) => { if (m.type() === 'error') errores.push('console.error: ' + m.text().slice(0, 300)) })

// ── La API, interceptada ──
const SESION = {
  access_token: 'prueba-local-no-es-un-token', token_type: 'bearer', expires_in: 3600,
  expires_at: Math.floor(Date.now() / 1000) + 3600, refresh_token: 'prueba-local',
  // ⛔ El rol va en `user_metadata` porque la app lo lee de ahí: sin rol, Auth dice que sí y la
  //    app igual no deja entrar («su clave es correcta, pero esta cuenta no tiene acceso»).
  //    Y va `operador` a propósito: ve el módulo Nómina y NO está en la lista de roles que
  //    exigen 2FA (superadmin/revisor/auditor/admin/rrhh), que trancaría la prueba.
  user: { id: '00000000-0000-0000-0000-000000000001', email: 'prueba@betangar.local',
          role: 'authenticated', aud: 'authenticated', app_metadata: {},
          user_metadata: { rol: 'operador', nombre: 'Prueba local', usuario: 'prueba' } },
}
await page.route('**/auth/v1/**', (route) => {
  const u = route.request().url()
  if (/\/user/.test(u)) return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(SESION.user) })
  return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(SESION) })
})
// Todo lo demás de la base: vacío. Acá se mira la tarjeta, no los datos.
await page.route('**/rest/v1/**', (route) =>
  route.fulfill({ status: 200, contentType: 'application/json',
    headers: { 'Content-Range': '0-0/0' }, body: '[]' }))

await page.goto(`http://127.0.0.1:${PUERTO}/app.html`, { waitUntil: 'domcontentloaded' })
await page.waitForFunction(() => typeof window.importarNominaPago === 'function', { timeout: 20000 })
console.log('✅ la página cargó y el módulo está cableado (importarNominaPago existe)')

// ── Entrar. El overlay de login se va cuando Supabase cree que hay sesión ──
await page.fill('#login-user', 'prueba')
await page.fill('#login-pass', 'prueba')
await page.click('button[onclick="doLogin()"]').catch(() => page.keyboard.press('Enter'))
// ⛔ 04/11/2026: acá se preguntaba `o.offsetParent === null`. En un elemento `position:fixed`
//    —y el overlay del login lo es— `offsetParent` es SIEMPRE null, esté visible o no. La
//    prueba escribió «✅ el overlay de login se fue» con el login en pantalla y el cartel
//    rojo «su clave es correcta, pero esta cuenta no tiene acceso» bien visible, y después
//    siguió «midiendo» una tarjeta que nadie podía ver, porque el DOM está igual detrás del
//    overlay. Lo que lo delató fue MIRAR la captura, no leer el resultado.
//    Ahora se pregunta por el `display` calculado, que es lo que decide si se ve.
//    [[norma-una-asercion-mal-escrita-acusa-al-producto]] · [[norma-la-vista-no-mide-lo-que-crees]]
const entro = await page.waitForFunction(() => {
  const o = document.getElementById('login-overlay')
  return !o || getComputedStyle(o).display === 'none' || getComputedStyle(o).visibility === 'hidden'
}, { timeout: 20000 }).then(() => true).catch(() => false)
if (!entro) {
  const motivo = await page.evaluate(() => {
    const e = document.getElementById('login-error')
    return e && getComputedStyle(e).display !== 'none' ? e.textContent.trim() : '(el login no dijo nada)'
  })
  console.error('⛔ el overlay de login NO se fue. La pantalla dice: ' + motivo)
}
console.log(entro ? '✅ el overlay de login se fue (display calculado)' : '')
if (!entro) {
  await page.screenshot({ path: path.join(SALIDA, '_np-login-trancado.png') })
  console.error('   Sin pasar el login no se puede mirar la tarjeta: lo que se dibuje detrás del')
  console.error('   overlay NO es lo que ve nadie. Captura en pruebas/_np-login-trancado.png')
  await navegador.close(); servidor.close(); process.exit(1)
}

// ── Ir al módulo Nómina y comprobar que la tarjeta ESTÁ ANTES de subir nada ──
// (Una sección que solo aparece con datos se ve igual que una que no existe.)
await page.evaluate(() => { if (typeof sp === 'function') sp('nomina') })
await page.waitForTimeout(600)
// La visibilidad se mide por el RECTÁNGULO que ocupa, no por `offsetParent` (ver arriba por
// qué eso no sirve). Una tarjeta que existe en el DOM y no se ve es una tarjeta que no está.
const tarjeta = await page.evaluate(() => {
  const inp = document.getElementById('np-file')
  const pan = document.getElementById('np-panel')
  const caja = pan && pan.parentElement ? pan.parentElement.getBoundingClientRect() : null
  return { input: !!inp, panel: !!pan,
           visible: !!(caja && caja.width > 100 && caja.height > 20),
           alto: caja ? Math.round(caja.height) : 0,
           textoTarjeta: pan && pan.parentElement ? pan.parentElement.innerText.slice(0, 90) : null }
})
console.log('   tarjeta:', JSON.stringify(tarjeta))
if (!tarjeta.visible) {
  await page.screenshot({ path: path.join(SALIDA, '_np-tarjeta-invisible.png'), fullPage: true })
  console.error('⛔ La tarjeta está en el DOM pero NO se ve (alto ' + tarjeta.alto + 'px).')
  await navegador.close(); servidor.close(); process.exit(1)
}
if (!tarjeta.input || !tarjeta.panel) {
  await page.screenshot({ path: path.join(SALIDA, '_np-sin-tarjeta.png'), fullPage: true })
  console.error('⛔ La tarjeta no está en la pantalla de Nómina.')
  await navegador.close(); servidor.close(); process.exit(1)
}
console.log('✅ la tarjeta está en pantalla con el panel VACÍO (se ve antes de subir nada)')

// ── EL CAMINO: subir el archivo de verdad por el <input type=file> ──
await page.setInputFiles('#np-file', EXCEL)
await page.waitForFunction(() => {
  const p = document.getElementById('np-panel')
  return p && p.innerHTML.length > 200
}, { timeout: 30000 })
await page.waitForTimeout(400)

const leido = await page.evaluate(() => ({
  semanas: (window._NP_RES && window._NP_RES.semanas || []).map((s) => ({
    semana: s.semana, lunes: s.lunes, domingo: s.domingo, tasa: s.tasa,
    totUsd: s.totUsd, nPers: s.nPers, faltan: s.faltan,
    bloques: Object.keys(s.bloques), tasaInconsistente: s.tasaInconsistente,
  })),
  textoPanel: document.getElementById('np-panel').innerText,
  hayBotonCerrar: !!document.querySelector('#np-panel button[onclick^="guardarNomPagoSemana"]'),
}))
console.log('\n── lo que la PANTALLA dice que entendió ──')
for (const s of leido.semanas) {
  console.log(`  ${s.semana}  ${s.lunes}→${s.domingo}  tasa ${s.tasa}  $${s.totUsd}  ` +
    `${s.nPers} pers  [${s.bloques.join(' ')}]` +
    (s.faltan.length ? `  ⛔ faltan ${s.faltan}` : '') +
    (s.tasaInconsistente ? '  ⚠ tasas distintas entre bloques' : ''))
}
console.log('  botón «Cerrar la semana» dibujado:', leido.hayBotonCerrar)

// El detalle persona por persona, que es un modal aparte: también se mira.
await page.evaluate(() => verNomPagoDetalle(0))
await page.waitForTimeout(400)
const modal = await page.evaluate(() => {
  const m = document.getElementById('np-modal')
  return m ? { filas: m.querySelectorAll('tbody tr').length, tablas: m.querySelectorAll('table').length } : null
})
console.log('  modal del detalle:', JSON.stringify(modal))
await page.screenshot({ path: path.join(SALIDA, '_np-detalle.png'), fullPage: false })
await page.evaluate(() => { const m = document.getElementById('np-modal'); if (m) m.remove() })
await page.waitForTimeout(200)

const caja = await page.locator('#np-panel').boundingBox()
await page.screenshot({ path: path.join(SALIDA, '_np-panel.png'),
  clip: caja ? { x: caja.x, y: caja.y, width: caja.width, height: Math.min(caja.height, 1800) } : undefined })

console.log('\ncapturas: pruebas/_np-panel.png · pruebas/_np-detalle.png')
if (errores.length) {
  console.log('\n⛔ ERRORES DE JS EN LA PÁGINA (' + errores.length + '):')
  // Los de la base interceptada no cuentan: se sirvieron vacíos a propósito.
  const reales = errores.filter((e) => !/Failed to load resource|rest\/v1|401|406|PGRST/i.test(e))
  reales.slice(0, 15).forEach((e) => console.log('   ' + e))
  console.log(`   (${errores.length - reales.length} descartados por venir de la base interceptada)`)
  if (reales.length) { await navegador.close(); servidor.close(); process.exit(1) }
}
console.log('\n✅ la pantalla dibuja el módulo sin errores de JS propios')
await navegador.close()
servidor.close()
