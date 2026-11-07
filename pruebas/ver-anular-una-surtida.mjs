#!/usr/bin/env node
// ═══════════════════════════════════════════════════════════════════════════════════════════
// UNA SURTIDA MAL CARGADA SE PUEDE ANULAR — Y ANULAR ES ANULAR TAMBIÉN LA PLATA.
//
// ⛔ POR QUÉ. Carlos Serrano, 03/10/2026, tres mensajes el mismo día:
//      · «La unidad una unidad realizó dos registros de combustible, uno de 50 L y otro de 30 L. El
//         registro de 30 L solicito su eliminación»
//      · «Me permite editarlo pero solo modificar el litraje, no eliminarlo»
//      · «Ya intenté colocarlo en cero… no me guarda, me pide colocar un litraje»
//    Tenía razón y lo había resuelto solo: lo único que se lo impedía era la validación
//    `if(!(lit>0))`. Un mes y dos días esperando por eso.
//
//    Mientras tanto, cada caso lo terminaba tocando el servicio técnico A MANO en la base, y
//    una de esas veces quedó a medias: **US$ 192 y 100 L vivos dentro del inventario**.
//
// ⛔ NO SE BORRA LA FILA, SE ANULA. La foto del surtidor es la prueba de que alguien cargó
//    algo; el historial dice qué decía antes y por qué cambió. Borrar se lleva las dos cosas.
//
// ⛔ QUÉ NO PRUEBA: no toca la base. Prueba qué MANDA la pantalla y qué DIBUJA.
//    [[norma-probar-el-camino-no-la-pieza]]
//
// Uso:  node pruebas/ver-anular-una-surtida.mjs [--ver]
// ═══════════════════════════════════════════════════════════════════════════════════════════
import fs from 'node:fs'
import http from 'node:http'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const PUERTO = Number(process.env.PUERTO_PRUEBA || 8891)

// El caso de Carlos: la de 30 L que hay que sacar. Sin `costo_litro_usd`, que es el caso en
// que la plata NO se recalcula sola y se quedaba viva.
const SURTIDA = { id: 'S30', cam: 'FC03', fecha: '2026-10-03', hora: '10:20', tanque: 'la_limpia',
  tipo_combustible: 'gasoil', litros: 30, litros_transporte: 10, costo_litro_usd: null,
  costo_usd: 22.5, costo_bs: 20000, tasa_bcv: 889, corregido_por: null, valor_anterior: null }

let pw
try {
  const g = (await import('node:child_process')).execSync('npm root -g', { encoding: 'utf8' }).trim()
  const mod = await import(pathToFileURL(path.join(g, 'playwright', 'index.js')).href)
  pw = mod.chromium ? mod : mod.default
  if (!pw?.chromium) throw new Error('el módulo cargó pero no trae chromium')
} catch (e) {
  console.error('⛔ Falta Playwright (global): npm i -g playwright ·', e.message); process.exit(1)
}

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.png': 'image/png',
  '.webmanifest': 'application/manifest+json', '.ico': 'image/x-icon' }
const srv = http.createServer((q, s) => {
  const rel = decodeURIComponent(q.url.split('?')[0]).replace(/^\/+/, '') || 'app.html'
  const f = path.join(REPO, rel)
  if (!f.startsWith(REPO) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { s.writeHead(404); s.end('no'); return }
  s.writeHead(200, { 'Content-Type': MIME[path.extname(f).toLowerCase()] || 'application/octet-stream' })
  fs.createReadStream(f).pipe(s)
})
await new Promise((ok, mal) => {
  srv.once('error', (e) => mal(new Error(`puerto ${PUERTO}: ${e.code}`)))
  srv.listen(PUERTO, '127.0.0.1', ok)
})

const navegador = await pw.chromium.launch({ headless: !process.argv.includes('--ver') })
const page = await (await navegador.newContext({ viewport: { width: 1280, height: 900 } })).newPage()
page.on('pageerror', (e) => console.log('   pageerror: ' + e.message))

const dichos = []
let decirQueSi = true
page.on('dialog', async (d) => {
  dichos.push({ tipo: d.type(), texto: d.message() })
  if (d.type() === 'confirm' && decirQueSi) await d.accept(); else await d.dismiss()
})

const escrituras = []
await page.route('**/*.supabase.co/**', (r) => {
  const req = r.request()
  if (req.method() !== 'GET') {
    let cuerpo = null
    try { cuerpo = JSON.parse(req.postData() || 'null') } catch (e) {}
    escrituras.push({ url: req.url(), metodo: req.method(), cuerpo })
  }
  return r.fulfill({ status: 200, contentType: 'application/json', body: '[]' })
})

await page.goto(`http://127.0.0.1:${PUERTO}/app.html`, { waitUntil: 'domcontentloaded' })
await page.waitForFunction(() => typeof window.surCorregirGuardar === 'function', { timeout: 25000 })
await page.evaluate(() => {
  const ov = document.getElementById('login-overlay'); if (ov) ov.style.display = 'none'
})
await page.waitForFunction(() => {
  try { if (typeof initSupabaseClient === 'function') initSupabaseClient() } catch (e) {}
  return typeof DB_READY !== 'undefined' && DB_READY === true
}, { timeout: 20000 }).catch(() => {})
if (!await page.evaluate(() => typeof DB_READY !== 'undefined' && DB_READY === true)) {
  console.log('⛔ no se armó el cliente de base: la prueba no mediría nada'); await navegador.close(); srv.close(); process.exit(1)
}

let fallos = 0
const chequear = (t, ok, d) => { if (!ok) fallos++; console.log(`${ok ? '✅' : '⛔'} ${t}${d ? ' · ' + d : ''}`) }

const preparar = (s) => page.evaluate((s) => {
  window.SURTIDAS = [JSON.parse(JSON.stringify(s))]
  window.SESION = { usuario: 'carlos', rol: 'superadmin' }
  window._surCorrigiendo = s.id
  // ⛔ SE GUARDA LA ORIGINAL PARA PODER DEVOLVERLA. `renderSurtidasHoy` se declara con
  //    `function`, así que su binding en `window` NO es configurable: un `delete` después
  //    **falla en silencio** y deja puesto este reemplazo. La prueba del dibujo medía el
  //    muñeco y daba rojo con el código bueno. [[norma-una-asercion-mal-escrita-acusa-al-producto]]
  if (!window._renderOriginal) window._renderOriginal = window.renderSurtidasHoy
  window.renderSurtidasHoy = function () {}
  const poner = (id, v) => { let e = document.getElementById(id); if (!e) { e = document.createElement('input'); e.id = id; document.body.appendChild(e) } e.value = v }
  poner('sur-cor-litros', ''); poner('sur-cor-motivo', '')
  return null
}, s)
const escribir = (litros, motivo) => page.evaluate(([l, m]) => {
  document.getElementById('sur-cor-litros').value = l
  document.getElementById('sur-cor-motivo').value = m
  return surCorregirGuardar()
}, [litros, motivo])

// ── 1 · La casilla VACÍA no es un cero ────────────────────────────────────────────────────
await preparar(SURTIDA); dichos.length = 0; escrituras.length = 0
await escribir('', 'lo que sea')
await page.waitForTimeout(400)
console.log('\n── se deja la casilla vacía ──')
chequear('NO pregunta si quiere anular', !dichos.some((d) => /ANULAR/i.test(d.texto)),
  dichos.map((d) => d.texto.slice(0, 30)).join(' | ') || '(ningún diálogo)')
chequear('no escribe nada', escrituras.length === 0, escrituras.length + ' escrituras')

// ── 2 · Cero y SIN motivo: no se guarda ───────────────────────────────────────────────────
await preparar(SURTIDA); dichos.length = 0; escrituras.length = 0
await escribir('0', '')
await page.waitForTimeout(400)
console.log('\n── pone 0 pero no escribe el motivo ──')
chequear('pregunta si quiere anular', dichos.some((d) => /ANULAR/i.test(d.texto)))
chequear('sin motivo NO guarda', escrituras.length === 0, escrituras.length + ' escrituras')

// ── 3 · Si dice que NO en la pregunta, no pasa nada ───────────────────────────────────────
await preparar(SURTIDA); dichos.length = 0; escrituras.length = 0; decirQueSi = false
await escribir('0', 'duplicada: la de 50 L es la buena')
await page.waitForTimeout(400)
console.log('\n── se arrepiente en la pregunta ──')
chequear('no escribe nada', escrituras.length === 0, escrituras.length + ' escrituras')
decirQueSi = true

// ── 4 · La anulación completa ─────────────────────────────────────────────────────────────
await preparar(SURTIDA); dichos.length = 0; escrituras.length = 0
await escribir('0', 'duplicada: la de 50 L es la buena')
await page.waitForTimeout(600)
const aviso = (dichos.find((d) => /ANULAR/i.test(d.texto)) || {}).texto || ''
console.log('\n── se anula de verdad ──\n   ' + aviso.replace(/\n/g, ' / '))
chequear('avisa que NO se borra', /NO se borra/i.test(aviso))
chequear('avisa que deja de sumar plata', /deja de sumar plata/i.test(aviso))
const env = (escrituras[0] || {}).cuerpo || {}
console.log('   lo que manda: ' + JSON.stringify(env))
chequear('los litros van a 0', env.litros === 0, String(env.litros))
// ⛔ Lo que ya falló una vez a mano: quedaron US$192 vivos. Esta surtida NO tiene
//    `costo_litro_usd`, que es justo el caso en que el costo no se recalculaba solo.
chequear('el costo en dólares va a 0 (acá es donde quedaron US$192 vivos)', env.costo_usd === 0, String(env.costo_usd))
chequear('el costo en bolívares va a 0', env.costo_bs === 0, String(env.costo_bs))
chequear('los litros «para llevar» también van a 0', env.litros_transporte === 0, String(env.litros_transporte))
chequear('queda quién la anuló', !!env.corregido_por, env.corregido_por)
const h = (env.valor_anterior && env.valor_anterior.historial) || []
chequear('el historial guarda lo que decía antes', h.length === 1 && h[0].litros === 30, JSON.stringify(h[0] || {}))
chequear('y guarda el motivo', /duplicada/.test((h[0] || {}).motivo || ''), (h[0] || {}).motivo)

// ── 5 · En la lista se ve ANULADA, no un cero cualquiera ──────────────────────────────────
const vista = await page.evaluate((s) => {
  // ⚠️ El tablero solo pinta las de HOY (`_surtidasHoy()`), y el contenedor es `dash-surtidas`.
  //    Con la fecha del caso real (03/10) la lista sale vacía y la prueba no mediría nada.
  const anul = Object.assign({}, s, { fecha: fechaVE(), litros: 0, costo_usd: 0, litros_transporte: 0,
    corregido_por: 'carlos',
    valor_anterior: { historial: [{ litros: 30, motivo: 'duplicada: la de 50 L es la buena' }] } })
  window.SURTIDAS = [anul]
  let cont = document.getElementById('dash-surtidas')
  if (!cont) { cont = document.createElement('div'); cont.id = 'dash-surtidas'; document.body.appendChild(cont) }
  if (window._renderOriginal) window.renderSurtidasHoy = window._renderOriginal
  try { renderSurtidasHoy() } catch (e) { return 'ERROR: ' + e.message }
  return cont.innerHTML
}, SURTIDA)
if (/Sin surtidas registradas|^ERROR/.test(vista)) {
  console.log('\n⛔ la lista salió vacía o reventó: la prueba del dibujo NO corrió\n   ' + vista.slice(0, 160))
  fallos++
}
console.log('\n── cómo se ve en la lista ──')
chequear('dice ANULADA', /ANULADA/.test(vista))
chequear('el número va tachado', /line-through/.test(vista))
chequear('el motivo queda a la vista al pasar por encima', /duplicada/.test(vista))
chequear('no se confunde con una corregida normal', !/✏️ corregida/.test(vista))

await navegador.close(); srv.close()
console.log(`\n${fallos ? '⛔ ' + fallos + ' fallo(s)' : '✅ todo verde'}`)
process.exit(fallos ? 1 : 0)
