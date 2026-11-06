#!/usr/bin/env node
// ═══════════════════════════════════════════════════════════════════════════════════════════
// UN PORCENTAJE QUE NO ES DE ESTE CLIENTE NO SE MUESTRA — Y SOBRE TODO NO SE RESTA.
//
// ⛔ EL CASO. Alejandra, 06/11/2026, con la foto del tablero de FLOTILLA:
//      «también figura un 7.5% de flotilla que no corresponde ya que eso es de betangar»
//      «esta pantalla es de flotilla y aparece 7.5% de flotilla, pero ese dato no corresponde
//       a ellos aunque lleve su nombre»
//    Tenía razón, y NO era solo la etiqueta: el 7,5 % estaba escrito en el código
//    (`totalCob*0.075`), entraba en `_totalEgresos` y por lo tanto **le bajaba la utilidad
//    neta** a un cliente por un concepto que no es suyo. En Betangar sí existe —es el pago a
//    los socios de su contrato con la Alcaldía— y allá se calcula aparte.
//
// ⇒ Ahora lo DECLARA la instancia (`BTG_CONFIG.aporte_socios_pct`). En 0, o sin declarar: no
//   se dibuja la tarjeta, no va el gajo del gráfico, y no se resta de nada.
//
// ⛔ QUÉ NO PRUEBA: no toca la base. Prueba qué dibuja y qué suma el tablero financiero.
//
// Uso:  node pruebas/ver-el-aporte-que-no-es-de-este-cliente.mjs
// ═══════════════════════════════════════════════════════════════════════════════════════════
import fs from 'node:fs'
import http from 'node:http'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const PUERTO = Number(process.env.PUERTO_PRUEBA || 8885)

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
await page.route('**/*.supabase.co/**', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: '[]' }))
await page.goto(`http://127.0.0.1:${PUERTO}/app.html`, { waitUntil: 'domcontentloaded' })
await page.waitForFunction(() => typeof window._aportePct === 'function', { timeout: 25000 })

let fallos = 0
const chequear = (t, ok, d) => { if (!ok) fallos++; console.log(`${ok ? '✅' : '⛔'} ${t}${d ? ' · ' + d : ''}`) }

// Se cobran 10.000 y no hay ningún otro gasto: así el 7,5 % se ve solo, sin ruido.
const correr = (pct) => page.evaluate((p) => {
  BTG_CONFIG.aporte_socios_pct = p
  window.ABONOS = [{ f: '2026-10-01', fact: 'F1', v: 1, m: 10000 }]
  window.REGS = []; window.GASOIL = []; window.GASTOS_FIJOS = []; window.GASTOS_VARIABLES = []
  window.CXP = []; window.MULTAS = []; window.PAGOS_ALC = []
  const eg = _totalEgresos(10000)
  let el = document.getElementById('fin-dashboard') || document.getElementById('rent-dash')
  return { pct: _aportePct(), aporte: _aporteUsd(10000), egresos: eg }
}, pct)

console.log('\n── el cliente que NO tiene ese concepto (0) ──')
let r = await correr(0)
console.log('   pct=' + r.pct + '  aporte=$' + r.aporte + '  egresos=$' + r.egresos)
chequear('el porcentaje es 0', r.pct === 0)
chequear('el aporte es $0', r.aporte === 0)
// ⭐ Lo que de verdad importa: no le baja la utilidad.
chequear('⭐ NO se le resta nada de los egresos', r.egresos === 0, '$' + r.egresos)

console.log('\n── el cliente que SÍ lo tiene (7,5) ──')
r = await correr(7.5)
console.log('   pct=' + r.pct + '  aporte=$' + r.aporte + '  egresos=$' + r.egresos)
chequear('el porcentaje queda en 0,075', Math.abs(r.pct - 0.075) < 1e-9, String(r.pct))
chequear('el aporte son $750 de los $10.000', r.aporte === 750, '$' + r.aporte)
chequear('⭐ y SÍ entra en los egresos', r.egresos === 750, '$' + r.egresos)

// ── Lo que se DIBUJA ──────────────────────────────────────────────────────────────────────
const pintar = (pct) => page.evaluate((p) => {
  BTG_CONFIG.aporte_socios_pct = p
  window.ABONOS = [{ f: '2026-10-01', fact: 'F1', v: 1, m: 10000 }]
  window.REGS = []; window.GASOIL = []; window.GASTOS_FIJOS = []; window.GASTOS_VARIABLES = []
  window.CXP = []; window.MULTAS = []; window.PAGOS_ALC = []
  // Se busca el contenedor que usa `renderFinDash` buscando la función por su nombre real.
  const fn = window.renderFinDash
  if (typeof fn !== 'function') return { err: 'no encuentro la función del tablero' }
  let caja = null
  try { fn() } catch (e) { return { err: e.message } }
  const cands = ['fin-dash-content']
  for (const id of cands) { const e = document.getElementById(id); if (e && e.innerHTML) { caja = e; break } }
  return { html: caja ? caja.innerHTML : '(no encontré el contenedor)' }
}, pct)

console.log('\n── el tablero ──')
let v = await pintar(0)
// ⛔ CONTROL POSITIVO ANTES DE CREERLE A LOS «NO APARECE». Si el contenedor no se encontrara,
//    las tres comprobaciones de abajo son negativas y pasarían TODAS sin haber mirado nada.
//    Primero hay que probar que estamos mirando el tablero de verdad.
//    [[norma-control-positivo-antes-de-creerle-al-vacio]]
const hayTablero = !v.err && /Facturado|Cobrado|Utilidad/i.test(v.html || '')
chequear('se está mirando el tablero de verdad (control positivo)', hayTablero,
  v.err || (v.html || '').slice(0, 70))
if (hayTablero) {
  chequear('con 0 NO aparece la tarjeta del porcentaje', !/7[.,]5%/.test(v.html),
    (v.html.match(/7[.,]5%/) || ['(no está)'])[0])
  chequear('con 0 el gráfico NO lleva ese gajo', !/>7[.,]5%</.test(v.html))
  v = await pintar(7.5)
  // ⚠️ El nombre NO se escribe acá: se le pregunta a la app. Esta misma prueba corre en los
  //    cinco productos, y con «FLOTILLA» escrito a mano daba rojo en los otros cuatro por el
  //    nombre, no por el defecto. [[norma-una-asercion-mal-escrita-acusa-al-producto]]
  const marca = await page.evaluate(() => (typeof brandNom === 'function' ? brandNom() : ''))
  const esperado = new RegExp('7[.,]5%\\s*' + marca.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i')
  chequear('con 7,5 SÍ aparece, y con el nombre de la casa (' + marca + ')',
    esperado.test(v.html || ''),
    ((v.html || '').replace(/\s+/g, ' ').match(/7[.,]5%[^<]{0,30}/) || ['(no está)'])[0])
}

await navegador.close(); srv.close()
console.log(`\n${fallos ? '⛔ ' + fallos + ' fallo(s)' : '✅ todo verde'}`)
process.exit(fallos ? 1 : 0)
