#!/usr/bin/env node
// ═══════════════════════════════════════════════════════════════════════════════════════════
// UN ODÓMETRO QUE SALTA HACIA ARRIBA TIENE QUE SALTAR EN LA AUDITORÍA (R10b).
//
// ⛔ EL CASO. FC04, 17/09/2026: entró con 983.346 km viniendo de 98.154 — un salto de
//    +885.192 km en un día. Estuvo QUINCE DÍAS en la base hasta que lo vio Operaciones a ojo.
//    La auditoría tenía R10 (el odómetro que RETROCEDE) y R12 (día sin cerrar); hacia ARRIBA
//    no miraba nada. Y el candado del teléfono estaba apagado ese mismo día, así que no quedó
//    ninguna red: ni adelante ni atrás.
//
// ⚠️ EL UMBRAL SALE DE LO MEDIDO: 969 jornadas de esta flota, promedio 162 km/día, máximo
//    histórico 1.270. Se avisa recién pasados 5.000 km por día transcurrido — casi cuatro
//    veces el día más largo que existió. Por eso la prueba tiene CONTROLES NEGATIVOS: lo que
//    importa de una alarma no es que suene, es que NO suene cuando no debe.
//
// ⛔ QUÉ NO PRUEBA: no toca la base. Prueba la regla contra jornadas armadas a mano.
//
// Uso:  node pruebas/ver-el-salto-imposible-de-km.mjs
// ═══════════════════════════════════════════════════════════════════════════════════════════
import fs from 'node:fs'
import http from 'node:http'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const PUERTO = Number(process.env.PUERTO_PRUEBA || 8882)

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
const page = await (await navegador.newContext()).newPage()
page.on('pageerror', (e) => console.log('   pageerror: ' + e.message))
await page.route('**/*.supabase.co/**', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: '[]' }))
await page.goto(`http://127.0.0.1:${PUERTO}/app.html`, { waitUntil: 'domcontentloaded' })
await page.waitForFunction(() => typeof window._acAnomalias === 'function', { timeout: 25000 })

let fallos = 0
const chequear = (t, ok, d) => { if (!ok) fallos++; console.log(`${ok ? '✅' : '⛔'} ${t}${d ? ' · ' + d : ''}`) }

const auditar = (jornadas) => page.evaluate((js) => {
  window.AC_JORNADAS = js
  window.AC_TANQUES = []; window.AC_MED = []; window.AC_GASOIL = []; window.AC_SURTIDAS = []; window.AC_CK = []
  try {
    const r = _acAnomalias(js, js[0].fecha, js[js.length - 1].fecha, {}) || []
    return r.map((x) => ({ regla: x.regla || x.cod || '', titulo: x.titulo || '', texto: x.texto || x.detalle || '' }))
  } catch (e) { return [{ regla: 'ERROR', titulo: e.message, texto: '' }] }
}, jornadas)

const J = (cam, fecha, kmS, kmE) => ({ cam, fecha, kmS, kmE, km: (kmE != null && kmS != null) ? kmE - kmS : null,
  salida: null, llegada: null, conf: 'parcial', consumo: null, tol: 0, desp: 0 })

// ── 1 · EL CASO REAL ──────────────────────────────────────────────────────────────────────
let r = await auditar([J('FC04', '2026-09-16', 98100, 98153), J('FC04', '2026-09-17', 98154, 983346)])
const err = r.find((x) => x.regla === 'ERROR')
if (err) { console.log('⛔ la auditoría reventó: ' + err.titulo); fallos++ }
console.log('\n── el caso de la FC04 (98.154 → 983.346) ──')
const r10b = r.filter((x) => x.regla === 'R10b')
chequear('salta R10b', r10b.length === 1, r.map((x) => x.regla).join(',') || '(nada)')
if (r10b[0]) {
  console.log('   ' + r10b[0].texto.slice(0, 190))
  chequear('dice de cuánto venía', /98\.153|98\.154/.test(r10b[0].texto))
  chequear('dice el tamaño del salto', /885\./.test(r10b[0].texto), r10b[0].texto.slice(0, 60))
}

// ── 2 · CONTROLES NEGATIVOS: lo que NO tiene que sonar ────────────────────────────────────
console.log('\n── lo que NO debe disparar ──')
r = await auditar([J('FC04', '2026-09-16', 98100, 98153), J('FC04', '2026-09-17', 98154, 98354)])
chequear('un día normal (200 km) no dispara nada', !r.some((x) => x.regla === 'R10b'), r.map((x) => x.regla).join(',') || '(nada)')

r = await auditar([J('FC04', '2026-09-16', 98100, 99370), J('FC04', '2026-09-17', 99371, 99500)])
chequear('el día más largo de la historia (1.270 km) tampoco', !r.some((x) => x.regla === 'R10b'))

// Entre dos jornadas puede haber fin de semana o taller: el umbral se escala por días.
// ⚠️ El día en sí tiene que ser normal: si se le pone una jornada de 11.800 km, lo que salta
//    es la regla del MISMO día —y bien—, no la de la comparación entre jornadas.
r = await auditar([J('FC04', '2026-09-01', 98100, 98200), J('FC04', '2026-09-30', 110000, 110150)])
chequear('29 días sin aparecer y +11.800 km en el odómetro, tampoco', !r.some((x) => x.regla === 'R10b'),
  r.filter((x) => x.regla === 'R10b').map((x) => x.texto.slice(0, 60)).join(''))

// Pero el mismo salto en UN día sí: es la diferencia entre «estuvo un mes afuera» y «ayer».
r = await auditar([J('FC04', '2026-09-29', 98100, 98200), J('FC04', '2026-09-30', 110000, 110150)])
chequear('el mismo salto de un día para el otro SÍ salta', r.some((x) => x.regla === 'R10b'),
  r.map((x) => x.regla).join(',') || '(nada)')

r = await auditar([J('FC05', '2026-09-16', 50000, 50100), J('FC04', '2026-09-17', 98154, 98354)])
chequear('no se compara una unidad contra OTRA', !r.some((x) => x.regla === 'R10b'))

r = await auditar([J('FC04', '2026-09-17', 98154, 98354)])
chequear('la primera jornada de una unidad no tiene contra qué comparar', !r.some((x) => x.regla === 'R10b'))

// ── 3 · Y el orden: la regla compara contra lo ANTERIOR, no contra el futuro ──────────────
r = await auditar([J('FC04', '2026-09-17', 98154, 983346), J('FC04', '2026-09-16', 98100, 98153)])
chequear('aunque lleguen desordenadas, igual lo caza', r.some((x) => x.regla === 'R10b'),
  r.map((x) => x.regla).join(',') || '(nada)')

await navegador.close(); srv.close()
console.log(`\n${fallos ? '⛔ ' + fallos + ' fallo(s)' : '✅ todo verde'}`)
process.exit(fallos ? 1 : 0)
