// El reporte financiero: se mira RENDERIZADO, interceptando la ventana de impresión.
import fs from 'node:fs'; import http from 'node:http'; import path from 'node:path'; import os from 'node:os'
import { pathToFileURL } from 'node:url'
const REPO = path.join(os.homedir(), process.argv[2] || 'flotilla-app')
const g = (await import('node:child_process')).execSync('npm root -g', { encoding: 'utf8' }).trim()
const mod = await import(pathToFileURL(path.join(g, 'playwright', 'index.js')).href)
const pw = mod.chromium ? mod : mod.default
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css' }
const srv = http.createServer((q, s) => {
  const rel = decodeURIComponent(q.url.split('?')[0]).replace(/^\/+/, '') || 'app.html'
  const f = path.join(REPO, rel)
  if (!fs.existsSync(f) || fs.statSync(f).isDirectory()) { s.writeHead(404); s.end('no'); return }
  s.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream' })
  fs.createReadStream(f).pipe(s)
})
await new Promise((r) => srv.listen(8886, '127.0.0.1', r))
const nav = await pw.chromium.launch({ headless: true })
const page = await (await nav.newContext({ viewport: { width: 1000, height: 1400 } })).newPage()
page.on('dialog', async (d) => { await d.dismiss() })
await page.route('**/*.supabase.co/**', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: '[]' }))
await page.goto('http://127.0.0.1:8886/app.html', { waitUntil: 'domcontentloaded' })
await page.waitForFunction(() => typeof window.imprimirReporteFinanciero === 'function', { timeout: 25000 })
const html = await page.evaluate(() => {
  window.TASAS = { bcvDolar: 894.89 }
  window.REGS = [{ mes: '2026-09', t: 40, m: 12000 }, { mes: '2026-10', t: 52, m: 16000 }]
  window.ABONOS = [{ f: '2026-10-05', fact: 'F1', v: 40, m: 12000 }, { f: '2026-10-28', fact: 'F2', v: 30, m: 9000 }]
  window.GASOIL = [{ m: 3200, tipo: 'compra' }]
  window.GASTOS_FIJOS = [{ monto: 1800 }]
  window.GASTOS_VARIABLES = [
    { fecha: '2026-10-05', cat: 'Peajes', usd: 2.25, bs: 2000 },
    { fecha: '2026-10-20', cat: 'Repuestos', usd: 450, bs: 400000 },
    { fecha: '2026-10-28', cat: 'Peajes', usd: 3.94, bs: 3500 },
    { fecha: '2026-10-30', cat: 'Herramientas', usd: 120, bs: 107000 },
  ]
  window.CXP = [{ neto_pagar: 865 }]; window.MULTAS = []; window.PAGOS_ALC = []
  let out = null
  const orig = window.open
  window.open = function () { return { document: { open () {}, close () {}, write (h) { out = h } }, print () {} } }
  try { imprimirReporteFinanciero() } finally { window.open = orig }
  return out
})
if (!html) { console.log('⛔ no se capturó el papel'); await nav.close(); srv.close(); process.exit(1) }
const p2 = await (await nav.newContext({ viewport: { width: 1000, height: 1500 } })).newPage()
await p2.setContent(html, { waitUntil: 'domcontentloaded' })
await p2.waitForTimeout(600)
await p2.screenshot({ path: path.join(REPO, 'pruebas', '_reporte-financiero.png'), fullPage: true })
// ⚠️ Las dos últimas dependen del PRODUCTO, y escritas a ciegas acusaban a Betangar de un
//    defecto que no tiene: allá el aporte a socios ES suyo (7 % / 7,5 % por factura) y el
//    subtítulo lo redactó otra sesión con mejores palabras.
//    [[norma-una-asercion-mal-escrita-acusa-al-producto]]
// ⚠️ El discriminante es `_aporteUsd` —la vía del porcentaje DECLARADO—, no la mención de
//    `pagoSocioDesglose`, que aparece también en los clones y daba el producto equivocado.
const aportePropio = !/function _aporteUsd/.test(fs.readFileSync(path.join(REPO, 'app.js'), 'utf8'))
const pruebas = [
  ['trae la sección de Egresos', /Egresos/.test(html)],
  ['trae el detalle por categoría', /Gastos variables por categor/.test(html)],
  ['nombra las categorías cargadas', /Peajes/.test(html) && /Repuestos/.test(html) && /Herramientas/.test(html)],
  ['trae la utilidad neta', /UTILIDAD NETA/.test(html)],
  ['el papel dice de qué período habla', /Toda la historia cargada|Historia completa/.test(html)],
  [aportePropio ? 'el aporte propio SÍ aparece' : 'NO muestra el 7,5% ajeno',
    aportePropio ? /socios/i.test(html) : !/7[.,]5%/.test(html)],
]
let mal = 0
pruebas.forEach(([t, ok]) => { if (!ok) mal++; console.log(`${ok ? '✅' : '⛔'} ${t}`) })
console.log(mal ? `⛔ ${mal} fallo(s)` : '✅ todo verde · captura en pruebas/_reporte-financiero.png')
await nav.close(); srv.close()
process.exit(mal ? 1 : 0)
