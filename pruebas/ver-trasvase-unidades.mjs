#!/usr/bin/env node
// ═══════════════════════════════════════════════════════════════════════════════════════════
// VER EN NAVEGADOR la tarjeta «Pasar gasoil de una unidad a otra».
//
// ⛔ Lo que importa mirar: que los desplegables se LLENEN con las unidades (uno vacío se ve
//    igual que uno que no cargó), que avise al elegir la misma unidad de los dos lados, y
//    que rechace un número imposible en vez de topearlo.
// ⛔ QUÉ NO PRUEBA: ni RLS ni que el insert entre (la base va interceptada).
//
// Uso:  node pruebas/ver-trasvase-unidades.mjs [--ver]
// ═══════════════════════════════════════════════════════════════════════════════════════════
import fs from 'node:fs'
import http from 'node:http'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const PUERTO = Number(process.env.PUERTO_PRUEBA || 8995)
const SALIDA = path.join(REPO, 'pruebas')

const g = (await import('node:child_process')).execSync('npm root -g', { encoding: 'utf8' }).trim()
const mod = await import(pathToFileURL(path.join(g, 'playwright', 'index.js')).href)
const pw = mod.chromium ? mod : mod.default
if (!pw?.chromium) { console.error('⛔ falta Playwright global'); process.exit(1) }

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.png': 'image/png' }
const srv = http.createServer((q, s) => {
  const rel = decodeURIComponent(q.url.split('?')[0]).replace(/^\/+/, '') || 'app.html'
  const f = path.join(REPO, rel)
  if (!f.startsWith(REPO) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { s.writeHead(404); s.end('no'); return }
  s.writeHead(200, { 'Content-Type': MIME[path.extname(f).toLowerCase()] || 'application/octet-stream' })
  fs.createReadStream(f).pipe(s)
})
await new Promise((ok, mal) => { srv.once('error', (e) => mal(e)); srv.listen(PUERTO, '127.0.0.1', ok) })

const navegador = await pw.chromium.launch({ headless: !process.argv.includes('--ver') })
const page = await (await navegador.newContext({ viewport: { width: 1400, height: 1000 } })).newPage()
const errores = []
page.on('pageerror', (e) => errores.push(e.message))

const SESION = { access_token: 'x', token_type: 'bearer', expires_in: 3600,
  expires_at: Math.floor(Date.now() / 1000) + 3600, refresh_token: 'x',
  // `operativo` a propósito: es el rol que la base deja escribir en `trasvases_unidad`,
  // el mismo que ya tiene Samuel para sacar gasoil del tanque.
  user: { id: '00000000-0000-0000-0000-000000000001', email: 'p@b.local', role: 'authenticated',
          aud: 'authenticated', app_metadata: {}, user_metadata: { rol: 'operativo', nombre: 'Prueba', usuario: 'p' } } }
await page.route('**/auth/v1/**', (r) => r.fulfill({ status: 200, contentType: 'application/json',
  body: JSON.stringify(/\/user/.test(r.request().url()) ? SESION.user : SESION) }))
const UNIDADES = ['JAC-B001', 'JAC-B002', 'JAC-B003'].map((c) => ({ cam: c, activo: true }))
await page.route('**/rest/v1/**', (r) => {
  const u = r.request().url()
  const cuerpo = /unidad_config/.test(u) ? UNIDADES : []
  return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(cuerpo) })
})

await page.goto(`http://127.0.0.1:${PUERTO}/app.html`, { waitUntil: 'domcontentloaded' })
await page.waitForFunction(() => typeof window.trsGuardar === 'function', { timeout: 20000 })
await page.fill('#login-user', 'p'); await page.fill('#login-pass', 'p')
await page.click('button[onclick="doLogin()"]').catch(() => page.keyboard.press('Enter'))
const entro = await page.waitForFunction(() => {
  const o = document.getElementById('login-overlay'); return !o || getComputedStyle(o).display === 'none'
}, { timeout: 20000 }).then(() => true).catch(() => false)
if (!entro) { console.error('⛔ no se pasó el login'); await navegador.close(); srv.close(); process.exit(1) }

await page.evaluate(() => { if (typeof sp === 'function') sp('operativo') })
await page.waitForTimeout(1200)
// Las unidades se siembran a mano: acá se mira la TARJETA, no de dónde salen.
await page.evaluate((us) => {
  window.UNIDAD_CONFIG = {}; us.forEach((c) => { window.UNIDAD_CONFIG[c] = { activo: true } })
  trsLlenarSelects()
}, UNIDADES.map((u) => u.cam))
await page.waitForTimeout(400)

let fallos = 0
const chequear = (t, ok, d) => { if (!ok) fallos++; console.log(`${ok ? '✅' : '⛔'} ${t}${d ? ' · ' + d : ''}`) }

const vis = await page.evaluate(() => {
  const o = document.getElementById('trs-origen'), d = document.getElementById('trs-destino')
  const caja = o && o.closest('.card') ? o.closest('.card').getBoundingClientRect() : null
  return { opciones: o ? o.options.length : 0, destino: d ? d.options.length : 0,
           visible: !!(caja && caja.width > 100 && caja.height > 50),
           titulo: o && o.closest('.card') ? o.closest('.card').innerText.split('\n')[0] : '' }
})
chequear('la tarjeta se ve', vis.visible, 'alto/ancho ok')
chequear('los desplegables se llenaron con las unidades', vis.opciones === 4 && vis.destino === 4,
  `origen=${vis.opciones} destino=${vis.destino} (1 "elegir" + 3 unidades)`)
chequear('el título es el que corresponde', /una unidad a otra/i.test(vis.titulo), vis.titulo)

// Misma unidad de los dos lados → tiene que avisar EN EL MOMENTO
await page.selectOption('#trs-origen', 'JAC-B001')
await page.selectOption('#trs-destino', 'JAC-B001')
await page.waitForTimeout(250)
const mismo = await page.evaluate(() => (document.getElementById('trs-lit-hint') || {}).textContent || '')
chequear('avisa si es la misma unidad de los dos lados', /misma unidad/i.test(mismo), JSON.stringify(mismo))

// Número imposible → tiene que DECIRLO mientras escribe
await page.selectOption('#trs-destino', 'JAC-B002')
await page.fill('#trs-lit', '5000')
await page.waitForTimeout(250)
const imposible = await page.evaluate(() => (document.getElementById('trs-lit-hint') || {}).textContent || '')
chequear('avisa el litraje imposible mientras escribe', /no caben/i.test(imposible), JSON.stringify(imposible))

// Un número normal → lo muestra limpio
await page.fill('#trs-lit', '120')
await page.waitForTimeout(250)
const normal = await page.evaluate(() => (document.getElementById('trs-lit-hint') || {}).textContent || '')
chequear('un litraje normal se muestra sin alarma', /^120\s*L$/.test(normal.trim()), JSON.stringify(normal))

await page.evaluate(() => { const c = document.getElementById('trs-origen').closest('.card'); c.scrollIntoView() })
await page.waitForTimeout(300)
const caja = await page.locator('#trs-origen').evaluate((e) => { const r = e.closest('.card').getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height } })
await page.screenshot({ path: path.join(SALIDA, '_trasvase.png'), clip: caja })

const reales = errores.filter((e) => !/rest\/v1|401|406|Failed to load/i.test(e))
if (reales.length) { console.log('⛔ errores de JS:'); reales.slice(0, 6).forEach((e) => console.log('   ' + e)); fallos += reales.length }
console.log(`\n${fallos ? '⛔ ' + fallos + ' en rojo' : '✅ todo en verde'} · captura en pruebas/_trasvase.png`)
await navegador.close(); srv.close()
process.exit(fallos ? 1 : 0)
