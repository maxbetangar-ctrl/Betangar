#!/usr/bin/env node
// ═══════════════════════════════════════════════════════════════════════════════════════════
// GASTOS VARIABLES: FILTRAR POR PERÍODO Y CATEGORÍA, Y SACAR EL REPORTE.
//
// ⛔ POR QUÉ. el jefe de operaciones de otra empresa, 05/11/2026, probando el módulo que se le arregló esa mañana:
//      «No tiene opción para filtrar por categoría y fecha»
//      «El resumen variable me muestra un solo total de todo lo cargado sin importar la
//       fecha. Es recomendable poder visualizarlo en un lapso de fecha determinado»
//      «No tiene la opción de, una vez seleccionados los parámetros requeridos, poder generar
//       un Reporte para compartir o imprimir»
//    Un total sin período no se puede comparar con nada: ni con el mes anterior, ni con un
//    presupuesto, ni con una factura.
//
// ⛔ QUÉ NO PRUEBA: no toca la base. Prueba qué filtra, qué suma y qué sale en el papel.
//    [[norma-probar-el-camino-no-la-pieza]]
//
// Uso:  node pruebas/ver-gastos-variables-por-periodo.mjs [--ver]
// ═══════════════════════════════════════════════════════════════════════════════════════════
import fs from 'node:fs'
import http from 'node:http'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const PUERTO = Number(process.env.PUERTO_PRUEBA || 8883)

// Tres meses, tres categorías. Los números están elegidos para que cada total sea único:
// si el filtro se equivoca, el número canta cuál agarró de más.
const GASTOS = [
  { id: 'g1', fecha: '2026-09-10', cat: 'Peajes', desc: 'peaje sept', bs: 1000, usd: 1, ref: 'R1', fact: 'F1' },
  { id: 'g2', fecha: '2026-10-05', cat: 'Peajes', desc: 'peaje oct', bs: 2000, usd: 2, ref: 'R2', fact: 'F2' },
  { id: 'g3', fecha: '2026-10-20', cat: 'Repuestos', desc: 'filtro', bs: 4000, usd: 4, ref: 'R3', fact: 'F3' },
  { id: 'g4', fecha: '2026-11-03', cat: 'Peajes', desc: 'peaje nov', bs: 8000, usd: 8, ref: 'R4', fact: 'F4' },
  { id: 'g5', fecha: '2026-11-04', cat: 'Herramientas', desc: 'llave', bs: 16000, usd: 16, ref: 'R5', fact: 'F5' },
]

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
const ctx = await navegador.newContext({ viewport: { width: 1280, height: 950 } })
const page = await ctx.newPage()
page.on('pageerror', (e) => console.log('   pageerror: ' + e.message))
page.on('dialog', async (d) => { dichos.push(d.message()); await d.dismiss() })
const dichos = []
await page.route('**/*.supabase.co/**', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: '[]' }))

await page.goto(`http://127.0.0.1:${PUERTO}/app.html`, { waitUntil: 'domcontentloaded' })
await page.waitForFunction(() => typeof window.renderGastosVariables === 'function', { timeout: 25000 })
await page.evaluate((gs) => {
  const ov = document.getElementById('login-overlay'); if (ov) ov.style.display = 'none'
  window.GASTOS_VARIABLES = gs
  window.GV_CATS = ['Peajes', 'Repuestos', 'Herramientas', 'Administrativo']
  try { renderGvCats() } catch (e) {}
  document.querySelectorAll('.page').forEach((p) => { p.classList.remove('active'); p.style.display = 'none' })
  const sec = document.getElementById('p-financiero') || document.querySelector('#tab-fin-vars')
  if (sec) { sec.style.display = 'block'; sec.classList.add('active') }
  const tv = document.getElementById('tab-fin-vars'); if (tv) tv.style.display = 'block'
}, GASTOS)

let fallos = 0
const chequear = (t, ok, d) => { if (!ok) fallos++; console.log(`${ok ? '✅' : '⛔'} ${t}${d ? ' · ' + d : ''}`) }

const ver = (desde, hasta, cat) => page.evaluate(([d, h, c]) => {
  const set = (id, v) => { const e = document.getElementById(id); if (e) e.value = v }
  set('gv-f-desde', d); set('gv-f-hasta', h); set('gv-f-cat', c)
  renderGastosVariables()
  return {
    resumen: (document.getElementById('gv-resumen') || {}).innerText || '',
    filas: ((document.getElementById('tb-gv') || {}).querySelectorAll ? document.getElementById('tb-gv').querySelectorAll('tr').length : 0),
    tabla: (document.getElementById('tb-gv') || {}).innerText || '',
  }
}, [desde, hasta, cat])

// ── 1 · Sin filtro: todo, y lo DICE ───────────────────────────────────────────────────────
let v = await ver('', '', '')
console.log('\n── sin filtro ──\n   ' + v.resumen.replace(/\n/g, ' · '))
chequear('suma los 5', /31000|31\.000/.test(v.resumen), v.resumen.split('\n')[1] || '')
chequear('dice que es TODO lo cargado', /TODO lo cargado/.test(v.resumen))
chequear('se ven las 5 filas', v.filas === 5, v.filas + ' filas')

// ── 2 · Un mes ────────────────────────────────────────────────────────────────────────────
v = await ver('2026-10-01', '2026-10-31', '')
console.log('\n── octubre ──\n   ' + v.resumen.replace(/\n/g, ' · '))
chequear('suma solo octubre (2.000 + 4.000 = 6.000)', /6000|6\.000/.test(v.resumen), v.resumen.split('\n')[1] || '')
chequear('dice el período', /del 05\/10\/2026 al 31\/10\/2026|01\/10\/2026 al 31\/10\/2026/.test(v.resumen), v.resumen.split('\n')[0])
chequear('se ven 2 filas', v.filas === 2, v.filas + ' filas')
chequear('no se cuela el de septiembre', !/peaje sept/.test(v.tabla))

// ── 3 · Una categoría ─────────────────────────────────────────────────────────────────────
v = await ver('', '', 'Peajes')
console.log('\n── solo Peajes ──\n   ' + v.resumen.replace(/\n/g, ' · '))
chequear('suma los 3 peajes (1.000+2.000+8.000 = 11.000)', /11000|11\.000/.test(v.resumen), v.resumen.split('\n')[1] || '')
chequear('nombra la categoría', /Peajes/.test(v.resumen))
chequear('no se cuela el filtro ni la llave', !/filtro|llave/.test(v.tabla))

// ── 4 · Las dos cosas juntas ──────────────────────────────────────────────────────────────
v = await ver('2026-10-01', '2026-11-30', 'Peajes')
chequear('período + categoría (2.000 + 8.000 = 10.000)', /10000|10\.000/.test(v.resumen), v.resumen.split('\n')[1] || '')

// ── 5 · Un filtro que no deja nada NO se lee como «no hay nada cargado» ───────────────────
v = await ver('2026-01-01', '2026-01-31', '')
console.log('\n── un mes sin gastos ──\n   ' + v.tabla.replace(/\n/g, ' '))
chequear('dice que es el FILTRO, no que no haya nada', /Ningún gasto/.test(v.tabla))
chequear('dice cuántos hay en total', /5 cargados en total/.test(v.tabla))

// ── 6 · El reporte sale de LO QUE SE ESTÁ VIENDO ─────────────────────────────────────────
await ver('2026-10-01', '2026-10-31', '')
const papel = await page.evaluate(() => {
  let capt = null
  const orig = window.abrirImpresionPremium
  window.abrirImpresionPremium = function (t, s, st, b) { capt = { titulo: t, sub: s, stats: st, body: b } }
  try { imprimirGastosVariables() } finally { window.abrirImpresionPremium = orig }
  return capt
})
console.log('\n── el reporte de octubre ──')
chequear('se arma el reporte', !!papel, papel ? papel.titulo : '(no salió)')
if (papel) {
  console.log('   ' + papel.sub)
  chequear('el papel dice el mismo período que la pantalla', /al 31\/10\/2026/.test(papel.sub), papel.sub)
  chequear('trae el desglose por categoría', /Por categoría/.test(papel.body))
  chequear('trae el detalle', /Detalle/.test(papel.body))
  chequear('suma lo mismo que la pantalla (6.000)', /6\.000/.test(papel.body))
  chequear('NO trae lo de septiembre', !/peaje sept/.test(papel.body))
  chequear('NO trae lo de noviembre', !/peaje nov/.test(papel.body))
}

// ── 7 · Sin nada que reportar, avisa en vez de sacar un papel vacío ──────────────────────
await ver('2026-01-01', '2026-01-31', '')
dichos.length = 0
await page.evaluate(() => { try { imprimirGastosVariables() } catch (e) {} })
await page.waitForTimeout(300)
chequear('con el filtro vacío avisa y no imprime', dichos.some((d) => /No hay gastos en ese período/.test(d)),
  dichos.join(' | ') || '(ningún aviso)')

await navegador.close(); srv.close()
console.log(`\n${fallos ? '⛔ ' + fallos + ' fallo(s)' : '✅ todo verde'}`)
process.exit(fallos ? 1 : 0)
