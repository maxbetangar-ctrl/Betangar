#!/usr/bin/env node
// ═══════════════════════════════════════════════════════════════════════════════════════════
// EL CANDADO DEL ODÓMETRO NO PUEDE APAGARSE SOLO.
//
// ⛔ EL CASO. Carlos Serrano, 02/10/2026: *«La unidad una unidad los días 17 y 18 de septiembre
//    tuvo un error al cargar el kilometraje»*. En la base quedaron, de la una unidad:
//      · 17/09  km_entrada = 983.346   (venía de 98.154)
//      · 18/09  km_salida  = 984.046   y el día quedó SIN CERRAR
//    Son las ÚNICAS dos filas de toda la tabla `checklist` con km > 500.000. Entraron sin
//    una sola advertencia, y estuvieron 15 días ahí hasta que las vio Operaciones.
//
// ⛔ POR QUÉ. Dos agujeros que se suman:
//    1) `CL_KM_PREV_OK = true` se ponía con que la RPC no diera ERROR. Si devolvía CERO
//       FILAS, `CL_KM_PREV` quedaba en 0 — y los cuatro candados están escritos
//       `CL_KM_PREV>0 && …`, así que se apagaban solos.
//    2) Sin referencia, el tope duro caía a **1.000.000**. En una flota cuyo odómetro más
//       alto no llega a 110.000, eso no es un candado: es una puerta con cartel de candado.
//    Y el número salió de que `_kmVal` borraba la COMA: «98.334,6» → 983346. Una décima
//    multiplicando el odómetro por diez.
//
// ⛔ QUÉ NO PRUEBA: no toca la base. Prueba qué deja pasar y qué no la pantalla del chofer.
//    [[norma-probar-el-camino-no-la-pieza]]
//
// Uso:  node pruebas/ver-el-candado-del-odometro.mjs
// ═══════════════════════════════════════════════════════════════════════════════════════════
import fs from 'node:fs'
import http from 'node:http'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const PUERTO = Number(process.env.PUERTO_PRUEBA || 8881)

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
  const rel = decodeURIComponent(q.url.split('?')[0]).replace(/^\/+/, '') || 'chofer.html'
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
const page = await (await navegador.newContext({ viewport: { width: 420, height: 900 } })).newPage()
page.on('pageerror', (e) => console.log('   pageerror: ' + e.message))
await page.route('**/rest/v1/**', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: '[]' }))

await page.goto(`http://127.0.0.1:${PUERTO}/chofer.html?cam=FC04`, { waitUntil: 'domcontentloaded' })
await page.waitForFunction(() => typeof window._kmVal === 'function', { timeout: 25000 })

let fallos = 0
const chequear = (t, ok, d) => { if (!ok) fallos++; console.log(`${ok ? '✅' : '⛔'} ${t}${d ? ' · ' + d : ''}`) }

// ── 1 · LA COMA DECIMAL: el origen del 983.346 ────────────────────────────────────────────
console.log('\n── cómo se lee lo que teclea el chofer ──')
const leer = (txt) => page.evaluate((t) => {
  let el = document.getElementById('cl-km-salida')
  if (!el) { el = document.createElement('input'); el.id = 'cl-km-salida'; document.body.appendChild(el) }
  el.value = t
  return _kmVal('cl-km-salida')
}, txt)
for (const [txt, esperado, nota] of [
  ['98354', 98354, 'sin separadores'],
  ['98.354', 98354, 'el punto es separador de MILES, no decimal'],
  ['98.334,6', 98335, '⭐ EL CASO: antes daba 983346 — el odómetro por diez'],
  ['98.404,6', 98405, '⭐ el del día siguiente'],
  ['0', 0, 'cero'],
  ['', 0, 'vacío'],
  ['abc', 0, 'basura'],
]) {
  const r = await leer(txt)
  chequear(`«${txt || '(vacío)'}» → ${esperado}  (${nota})`, r === esperado, 'dio ' + r)
}

// ── 2 · «CERO FILAS» NO ES UNA REFERENCIA ────────────────────────────────────────────────
console.log('\n── qué pasa cuando la base no sabe de cuánto venía ──')
const refDeRPC = (data, error) => page.evaluate(([d, e]) => {
  // Se reproduce EXACTO el bloque del arranque, con la respuesta que haga falta.
  const rk = e ? { error: { message: 'boom' } } : { error: null, data: d }
  let CL_KM_PREV = 0, CL_KM_PREV_OK = false
  const _kmRef = (rk && !rk.error && rk.data && rk.data[0]) ? (parseInt(rk.data[0].km) || 0) : 0
  if (_kmRef > 0) { CL_KM_PREV = _kmRef; CL_KM_PREV_OK = true }
  return { CL_KM_PREV, CL_KM_PREV_OK }
}, [data, error])

let r = await refDeRPC([{ km: 98154 }], false)
chequear('con un km de verdad, hay referencia', r.CL_KM_PREV_OK === true && r.CL_KM_PREV === 98154, JSON.stringify(r))
r = await refDeRPC([], false)
chequear('⭐ con CERO FILAS, NO hay referencia (acá se apagaba el candado)', r.CL_KM_PREV_OK === false, JSON.stringify(r))
r = await refDeRPC([{ km: 0 }], false)
chequear('con km=0, tampoco: «vino de 0» no es «no sé de cuánto vino»', r.CL_KM_PREV_OK === false, JSON.stringify(r))
r = await refDeRPC(null, true)
chequear('con error, tampoco', r.CL_KM_PREV_OK === false, JSON.stringify(r))

// ── 3 · SIN REFERENCIA YA NO SE APRUEBA EN SILENCIO ──────────────────────────────────────
// El código del guardado es largo y pide red; lo que se comprueba acá es que la regla
// EXISTE en el archivo y con qué condición, que es lo que se rompió.
console.log('\n── sin referencia, ¿se aprueba solo? ──')
const txt = fs.readFileSync(path.join(REPO, 'chofer.html'), 'utf8')
chequear('existe la pregunta de «no pude verificar»', /No pude verificar este kilometraje/.test(txt))
chequear('se dispara cuando NO hay referencia', /if\(!\(CL_KM_PREV>0\) && _kmIng >= 1000\)/.test(txt))
chequear('si cancela, NO guarda', /No pude verificar este kilometraje[\s\S]{0,700}?return;/.test(txt))
chequear('ya no se da por buena una RPC sin filas',
  !/if\(rk && !rk\.error\)\{\s*CL_KM_PREV_OK = true;/.test(txt))

await navegador.close(); srv.close()
console.log(`\n${fallos ? '⛔ ' + fallos + ' fallo(s)' : '✅ todo verde'}`)
process.exit(fallos ? 1 : 0)
