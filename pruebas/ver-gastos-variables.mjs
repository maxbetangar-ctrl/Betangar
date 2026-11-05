#!/usr/bin/env node
// ═══════════════════════════════════════════════════════════════════════════════════════════
// VER EN NAVEGADOR los Gastos Variables: categorías que pone la casa y bolívares corregibles.
//
// ⛔ Lo reportado el 04/11/2026: las categorías «no son las indicadas» (en Flotilla eran las
//    de Betangar, quedaron del clonado) y el monto en bolívares «se calcula solo a la tasa
//    actual y no se puede editar», así que un gasto cargado días después no coincide con el
//    desembolso real.
//
// ⛔ Corre contra el repo que se le pase, porque el arreglo va en LOS DOS.
// Uso:  node pruebas/ver-gastos-variables.mjs [ruta-al-repo] [--ver]
// ═══════════════════════════════════════════════════════════════════════════════════════════
import fs from 'node:fs'
import http from 'node:http'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const AQUI = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const REPO = (process.argv[2] && !process.argv[2].startsWith('--')) ? path.resolve(process.argv[2]) : AQUI
const PUERTO = Number(process.env.PUERTO_PRUEBA || 8997)

const g = (await import('node:child_process')).execSync('npm root -g', { encoding: 'utf8' }).trim()
const mod = await import(pathToFileURL(path.join(g, 'playwright', 'index.js')).href)
const pw = mod.chromium ? mod : mod.default

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.png': 'image/png' }
const srv = http.createServer((q, s) => {
  const rel = decodeURIComponent(q.url.split('?')[0]).replace(/^\/+/, '') || 'app.html'
  const f = path.join(REPO, rel)
  if (!f.startsWith(REPO) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { s.writeHead(404); s.end('no'); return }
  s.writeHead(200, { 'Content-Type': MIME[path.extname(f).toLowerCase()] || 'application/octet-stream' })
  fs.createReadStream(f).pipe(s)
})
await new Promise((ok, mal) => { srv.once('error', mal); srv.listen(PUERTO, '127.0.0.1', ok) })
console.log(`repo: ${path.basename(REPO)}`)

const nav = await pw.chromium.launch({ headless: !process.argv.includes('--ver') })
const page = await (await nav.newContext({ viewport: { width: 1400, height: 1000 } })).newPage()
const errores = []
page.on('pageerror', (e) => errores.push(e.message))

const S = { access_token: 'x', token_type: 'bearer', expires_in: 3600,
  expires_at: Math.floor(Date.now() / 1000) + 3600, refresh_token: 'x',
  user: { id: '00000000-0000-0000-0000-000000000001', email: 'p@b.local', role: 'authenticated',
          aud: 'authenticated', app_metadata: {}, user_metadata: { rol: 'operador', nombre: 'Prueba', usuario: 'p' } } }
await page.route('**/auth/v1/**', (r) => r.fulfill({ status: 200, contentType: 'application/json',
  body: JSON.stringify(/\/user/.test(r.request().url()) ? S.user : S) }))
// `configuracion` sin la clave de categorías: se prueba el camino de la PRIMERA vez, que es
// cuando tiene que sembrarlas sin perder ninguna.
await page.route('**/rest/v1/**', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: '[]' }))

await page.goto(`http://127.0.0.1:${PUERTO}/app.html`, { waitUntil: 'domcontentloaded' })
await page.waitForFunction(() => typeof window.gvAgregarCat === 'function', { timeout: 20000 })
await page.fill('#login-user', 'p'); await page.fill('#login-pass', 'p')
await page.click('button[onclick="doLogin()"]').catch(() => page.keyboard.press('Enter'))
const entro = await page.waitForFunction(() => {
  const o = document.getElementById('login-overlay'); return !o || getComputedStyle(o).display === 'none'
}, { timeout: 20000 }).then(() => true).catch(() => false)
if (!entro) { console.error('⛔ no se pasó el login'); await nav.close(); srv.close(); process.exit(1) }

await page.evaluate(() => { if (typeof sp === 'function') sp('financiero') })
await page.waitForTimeout(500)
await page.evaluate(() => { if (typeof switchFinTab === 'function') switchFinTab('vars') })
await page.evaluate(() => cargarGvCats())
await page.waitForTimeout(600)

let fallos = 0
const chk = (t, ok, d) => { if (!ok) fallos++; console.log(`${ok ? '✅' : '⛔'} ${t}${d ? ' · ' + d : ''}`) }

const est = await page.evaluate(() => ({
  cats: [...document.querySelectorAll('#gv-cat option')].map((o) => o.textContent),
  bsReadonly: (document.getElementById('gv-bs') || {}).readOnly,
  hayAdmin: !!document.getElementById('gv-cat-nueva'),
  chips: (document.getElementById('gv-cats-admin') || {}).innerText || '',
}))
chk('las categorías se pintan desde la base (sembradas)', est.cats.length === 8, est.cats.length + ' opciones')
chk('⭐ los bolívares YA NO son de solo lectura', est.bsReadonly === false, 'readOnly=' + est.bsReadonly)
chk('hay dónde agregar una categoría', est.hayAdmin)
chk('se ven las categorías actuales para quitarlas', /Peajes/.test(est.chips))

// Agregar una categoría nueva
await page.fill('#gv-cat-nueva', 'Grúa y remolque')
await page.evaluate(() => gvAgregarCat())
await page.waitForTimeout(500)
const cats2 = await page.evaluate(() => [...document.querySelectorAll('#gv-cat option')].map((o) => o.textContent))
chk('se puede agregar una categoría propia', cats2.includes('Grúa y remolque'), cats2.length + ' opciones')

// Repetida (sin distinguir mayúsculas/tildes) → se rechaza
await page.fill('#gv-cat-nueva', 'GRUA Y REMOLQUE')
await page.evaluate(() => gvAgregarCat())
await page.waitForTimeout(400)
const cats3 = await page.evaluate(() => [...document.querySelectorAll('#gv-cat option')].map((o) => o.textContent))
chk('⭐ no deja repetir una categoría escrita distinto', cats3.length === cats2.length,
  cats3.length + ' opciones (no crecio)')

// Los bolívares escritos a mano mandan
await page.fill('#gv-fecha', '2026-10-15')
await page.fill('#gv-usd', '100')
await page.evaluate(() => calcGastoVar())
await page.waitForTimeout(300)
await page.fill('#gv-bs', '88500')
await page.evaluate(() => gvBsEditado())
await page.evaluate(() => calcGastoVar())   // recalcular NO puede pisarlo
await page.waitForTimeout(300)
const tras = await page.evaluate(() => ({
  bs: (document.getElementById('gv-bs') || {}).value,
  hint: (document.getElementById('gv-tasa-hint') || {}).textContent || '',
}))
chk('⭐ recalcular NO pisa los bolívares escritos a mano', tras.bs === '88500', 'quedó ' + tras.bs)
chk('dice qué tasa implica lo escrito', /885|tasa de/i.test(tras.hint), JSON.stringify(tras.hint.slice(0, 90)))

const reales = errores.filter((e) => !/rest\/v1|401|406|Failed to load/i.test(e))
if (reales.length) { console.log('⛔ errores de JS:'); reales.slice(0, 6).forEach((e) => console.log('   ' + e)); fallos += reales.length }
console.log(`${fallos ? '⛔ ' + fallos + ' en rojo' : '✅ todo en verde'}\n`)
await nav.close(); srv.close()
process.exit(fallos ? 1 : 0)
