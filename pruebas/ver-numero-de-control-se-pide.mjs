#!/usr/bin/env node
// ═══════════════════════════════════════════════════════════════════════════════════════════
// EL N° DE CONTROL SE PIDE AL CARGAR, Y LAS VIEJAS SE PUEDEN COMPLETAR.
//
// ⛔ POR QUÉ. Sin el N° de Control el comprobante de retención NO SE PUEDE EMITIR legalmente.
//    El campo existía pero era opcional, y no había NINGUNA forma de cargarlo después: al
//    05/11/2026 había 48 de 53 facturas sin él —ninguna de septiembre ni de octubre— y sus
//    comprobantes quedaban imposibles para siempre. El único aviso aparecía al intentar
//    emitir, o sea cuando ya no se podía hacer nada.
//    Alejandra eligió cómo resolverlo: «pedirlo al cargar cada factura».
//
// ⛔ QUÉ NO PRUEBA: no escribe nada real — Supabase va interceptado. Prueba que la pantalla
//    FRENA sin el número, que lo MANDA cuando se carga una vieja, y que NO se traga un error
//    de la base. [[norma-probar-el-camino-no-la-pieza]]
//
// Uso:  node pruebas/ver-numero-de-control-se-pide.mjs
// ═══════════════════════════════════════════════════════════════════════════════════════════
import fs from 'node:fs'
import http from 'node:http'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const PUERTO = Number(process.env.PUERTO_PRUEBA || 8996)
const CONTROL = '00-00012345'

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

const navegador = await pw.chromium.launch({ headless: true })
const page = await (await navegador.newContext({ viewport: { width: 1280, height: 900 } })).newPage()
page.on('pageerror', (e) => console.log('   pageerror: ' + e.message))

// Los diálogos se contestan desde acá: lo que nos interesa es QUÉ dicen.
const dichos = []
let respuestaDelPrompt = CONTROL
let decirQueSi = true          // qué se contesta a un confirm
page.on('dialog', async (d) => {
  dichos.push({ tipo: d.type(), texto: d.message() })
  if (d.type() === 'prompt') await d.accept(respuestaDelPrompt)
  else if (d.type() === 'confirm' && decirQueSi) await d.accept()
  else await d.dismiss()
})

// Supabase interceptado. El PATCH se guarda para mirarlo; se puede hacer fallar a pedido.
const escrituras = []
let elPatchFalla = false
await page.route('**/*.supabase.co/**', (r) => {
  const req = r.request()
  if (req.method() === 'PATCH') {
    let cuerpo = null
    try { cuerpo = JSON.parse(req.postData() || 'null') } catch (e) {}
    escrituras.push({ url: req.url(), cuerpo })
    if (elPatchFalla) return r.fulfill({ status: 403, contentType: 'application/json',
      body: JSON.stringify({ message: 'permission denied for table cxp_facturas' }) })
    return r.fulfill({ status: 200, contentType: 'application/json',
      body: JSON.stringify([{ id: 'F1', num_control: cuerpo && cuerpo.num_control }]) })
  }
  return r.fulfill({ status: 200, contentType: 'application/json', body: '[]' })
})

await page.goto(`http://127.0.0.1:${PUERTO}/app.html`, { waitUntil: 'domcontentloaded' })
await page.waitForFunction(() => typeof window.facPonerControl === 'function', { timeout: 25000 })
await page.evaluate(() => {
  const ov = document.getElementById('login-overlay'); if (ov) ov.style.display = 'none'
})
// ⛔ El cliente de base se arma al iniciar sesión, y el CDN de supabase-js puede no haber
//    cargado todavía. Sin esperarlo, `DB_READY` queda en false y la prueba vería «sin
//    conexión» — y eso NO sería un defecto del código, sería la prueba midiendo mal.
//    [[norma-una-asercion-mal-escrita-acusa-al-producto]]
await page.waitForFunction(() => {
  try { if (typeof initSupabaseClient === 'function') initSupabaseClient() } catch (e) {}
  return typeof DB_READY !== 'undefined' && DB_READY === true &&
         window.supabase && typeof window.supabase.from === 'function'
}, { timeout: 20000 }).catch(() => {})
const hayBase = await page.evaluate(() => (typeof DB_READY !== 'undefined' && DB_READY === true))
if (!hayBase) { console.log('⛔ no se pudo armar el cliente de base: la prueba no mediría nada'); await navegador.close(); srv.close(); process.exit(1) }

let fallos = 0
const chequear = (t, ok, d) => { if (!ok) fallos++; console.log(`${ok ? '✅' : '⛔'} ${t}${d ? ' · ' + d : ''}`) }

// ── 1 · Al cargar una factura, sin N° de Control se PREGUNTA ──────────────────────────────
dichos.length = 0; decirQueSi = false
await page.evaluate(() => {
  // El formulario, completo salvo el N° de Control. Las dos piezas que leen la grilla de
  // órdenes se reemplazan: lo que se prueba es la validación, no el reparto.
  window._facLineasForm = () => [{ cxp_id: 'C1', base: 100 }]
  window._calcFacVals = () => ({ base: 100, iva: 16, ivaPct: 16, retIva: 12, retIvaPct: 75,
    islrAplica: false, islrPct: 0, sustr: 0, retIslr: 0, total: 116, neto: 104, tasa: 890, contrib: 'especial' })
  window._FAC_FOTO_RUTA = 'x.jpg'
  // `fac-prov` es un <select>: sin la opción cargada, asignarle el valor no hace nada y
  // `guardarFactura` se iría por «elegí el proveedor» sin llegar nunca a la validación.
  const sel = document.getElementById('fac-prov')
  if (sel) sel.innerHTML = '<option value="P1">PACCINI</option>'
  const poner = (id, v) => { const e = document.getElementById(id); if (e) e.value = v }
  poner('fac-prov', 'P1'); poner('fac-num', 'F-00012345'); poner('fac-control', '')
  window.CXP_FACTURAS = []
  guardarFactura()
})
await page.waitForTimeout(500)
const aviso = (dichos.find((d) => /control/i.test(d.texto)) || {}).texto || ''
console.log('\n── se intenta guardar sin N° de Control ──\n   ' + aviso.replace(/\n/g, ' / '))
chequear('frena y lo dice', /Falta el N° de Control/i.test(aviso))
chequear('explica QUÉ se pierde sin él', /no se va a poder emitir el comprobante/i.test(aviso))
chequear('dice DÓNDE está en el papel', /impreso en la factura/i.test(aviso))
// ⚠️ Tiene que ser un `confirm`, no un `alert`: si fuera un muro, un papel que de verdad no
//    trae número dejaría a la administradora sin poder cargar una deuda que la empresa SÍ
//    tiene. Se pide y se explica; la decisión es de quien mira el papel.
chequear('es una pregunta, no un muro', (dichos.find((d) => /control/i.test(d.texto)) || {}).tipo === 'confirm',
  (dichos.find((d) => /control/i.test(d.texto)) || {}).tipo || '(ninguno)')
chequear('al decir que NO, no se escribió nada', escrituras.length === 0, escrituras.length + ' escrituras')

// ── 2 · Una factura VIEJA sin control se puede completar ──────────────────────────────────
dichos.length = 0; escrituras.length = 0; decirQueSi = true
const ok1 = await page.evaluate(async () => {
  window.CXP_FACTURAS = [{ id: 'F1', prov_id: 'P1', prov_nombre: 'PACCINI', nro_factura: 'F-349',
    fecha: '2026-10-13', num_control: '' }]
  window.renderRetenciones = function () {}      // no nos interesa el repintado acá
  await facPonerControl('F1')
  return (CXP_FACTURAS[0].num_control || '')
})
const pedido = (dichos.find((d) => d.tipo === 'prompt') || {}).texto || ''
console.log('\n── se completa una factura vieja ──\n   ' + pedido.replace(/\n/g, ' / '))
dichos.filter((d) => d.tipo !== 'prompt').forEach((d) => console.log('   ⚠️ además dijo: ' + d.texto.replace(/\n/g, ' / ')))
chequear('se pregunta nombrando la factura y el proveedor', /F-349/.test(pedido) && /PACCINI/.test(pedido))
chequear('se manda el PATCH a cxp_facturas', escrituras.some((e) => /cxp_facturas/.test(e.url)),
  escrituras.length + ' escrituras')
chequear('va el número que se escribió',
  escrituras.some((e) => e.cuerpo && e.cuerpo.num_control === CONTROL),
  JSON.stringify(escrituras.map((e) => e.cuerpo)))
chequear('la fila en memoria queda con el número', ok1 === CONTROL, ok1 || '(vacío)')

// ── 3 · Si la base RECHAZA, la pantalla NO dice que guardó ────────────────────────────────
// Es el defecto de la Fecha de Egreso: decir que sí cuando es no.
dichos.length = 0; escrituras.length = 0; elPatchFalla = true
const ok2 = await page.evaluate(async () => {
  window.CXP_FACTURAS = [{ id: 'F1', prov_id: 'P1', prov_nombre: 'PACCINI', nro_factura: 'F-349',
    fecha: '2026-10-13', num_control: '' }]
  await facPonerControl('F1')
  return (CXP_FACTURAS[0].num_control || '')
})
const err = (dichos.find((d) => /no se pudo guardar/i.test(d.texto)) || {}).texto || ''
console.log('\n── la base rechaza el guardado ──\n   ' + err.replace(/\n/g, ' / '))
chequear('el error se dice, no se traga', /No se pudo guardar/i.test(err))
chequear('la fila NO queda con el número puesto', ok2 === '', ok2 || '(vacío)')

// ── 4 · Cancelar no toca nada ─────────────────────────────────────────────────────────────
dichos.length = 0; escrituras.length = 0; elPatchFalla = false
page.removeAllListeners('dialog')
page.on('dialog', async (d) => { dichos.push({ tipo: d.type(), texto: d.message() }); await d.dismiss() })
await page.evaluate(async () => {
  window.CXP_FACTURAS = [{ id: 'F1', prov_id: 'P1', prov_nombre: 'PACCINI', nro_factura: 'F-349',
    fecha: '2026-10-13', num_control: '' }]
  await facPonerControl('F1')
})
chequear('cancelar el prompt no escribe nada', escrituras.length === 0, escrituras.length + ' escrituras')

await navegador.close(); srv.close()
console.log(`\n${fallos ? '⛔ ' + fallos + ' fallo(s)' : '✅ todo verde'}`)
process.exit(fallos ? 1 : 0)
