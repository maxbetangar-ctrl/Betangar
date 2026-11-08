#!/usr/bin/env node
// ═══════════════════════════════════════════════════════════════════════════════════════════
// EL PANEL DEL CUADRE SEMANAL, EN UNA PANTALLA
//
// ⛔ POR QUÉ. La función ya está probada con 14 aserciones, incluida la identidad exacta sobre
//    4,5 meses de datos reales. Eso prueba el MOTOR. No prueba que la pantalla lo dibuje: el
//    08/11/2026 la pantalla de «dónde se cargó» llevaba meses reventando por llamar a una
//    función que no existe, y `node --check` no lo veía. Y acá casi repito el mismo error:
//    el primer intento usaba `ref`, que no existe en `_acRender`.
//    [[norma-probar-el-camino-no-la-pieza]] · [[norma-revisar-antes-de-soltar]]
//
// Uso:  node pruebas/ver-cuadre-semanal.mjs [--ver]
// ═══════════════════════════════════════════════════════════════════════════════════════════
import fs from 'node:fs'
import http from 'node:http'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const PUERTO = Number(process.env.PUERTO_PRUEBA || 8989)

let pw
try {
  const g = (await import('node:child_process')).execSync('npm root -g', { encoding: 'utf8' }).trim()
  const mod = await import(pathToFileURL(path.join(g, 'playwright', 'index.js')).href)
  pw = mod.chromium ? mod : mod.default
  if (!pw?.chromium) throw new Error('el módulo cargó pero no trae chromium')
} catch (e) { console.error('⛔ Falta Playwright (global): npm i -g playwright ·', e.message); process.exit(1) }

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
await new Promise((ok, mal) => { srv.once('error', (e) => mal(new Error(`puerto ${PUERTO}: ${e.code}`))); srv.listen(PUERTO, '127.0.0.1', ok) })

const navegador = await pw.chromium.launch({ headless: !process.argv.includes('--ver') })
const page = await (await navegador.newContext({ viewport: { width: 1400, height: 900 } })).newPage()
page.on('pageerror', (e) => console.log('   pageerror: ' + e.message))
await page.route('**/*.supabase.co/**', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: '[]' }))
await page.goto(`http://127.0.0.1:${PUERTO}/app.html`, { waitUntil: 'domcontentloaded' })
await page.waitForFunction(() => typeof window._acRender === 'function', { timeout: 25000 })

const seVe = await page.evaluate(() => {
  const ov = document.getElementById('login-overlay'); if (ov) ov.style.display = 'none'
  document.querySelectorAll('.page').forEach((p) => { p.classList.remove('active'); p.style.display = 'none' })
  let n = document.getElementById('ac-cuerpo')
  while (n && n !== document.body) { n.style.display = 'block'; n.classList.add('active'); n = n.parentElement }
  // ── Una semana LUNES→DOMINGO que no cuadra, y se sabe por qué ───────────────────────────
  // La unidad sale el lunes con 577,5 L y cierra el viernes con 320,9 L, sin ninguna carga:
  // 256,6 L para 600 km, cuando a 1,9 km/L le tocarían 315,8. Y la noche del jueves al viernes
  // el tanque subió 60 L sin carga asentada — ahí está la mitad del agujero.
  const T = { cap: 600, hmax: 52.5 }
  const dia = (f, sal, salCm, lle, lleCm, km) => ({
    cam: 'JAC-B001', fecha: f, turno: 'diurno', tanque: T, chofer: 'CHOFER DE PRUEBA',
    salida: sal, salidaCm: salCm, llegada: lle, llegadaCm: lleCm, km, conf: 'completa',
    noConf: null, corregida: false, salidaMala: false, llegadaMala: false,
    desp: 0, despJornada: 0, despPost: 0, cargaPostFuera: false, tol: 33.7,
    consumo: Math.round((sal - lle) * 100) / 100, salidaAt: f + ' 06:00:00+00', llegadaAt: f + ' 18:00:00+00',
  })
  window.AC_SURTIDAS = []; window.AC_GASOIL = []
  window.AC_META = Object.assign({}, window.AC_META || {}, { ref: { 'JAC-B001': { mediana: 1.9, n: 99, fija: true } }, corteSurtidas: '' })
  window.AC_JORNADAS = [
    dia('2026-11-02', 577.53, 50, 512.00, 45, 120),
    dia('2026-11-03', 512.00, 45, 452.00, 40, 115),
    dia('2026-11-04', 452.00, 40, 392.00, 35, 118),
    dia('2026-11-05', 392.00, 35, 332.00, 30, 122),
    dia('2026-11-06', 392.00, 35, 320.90, 28, 125),   // amaneció con +60 L sin carga
  ]
  window.AC_ANOM = []
  window._acRender()
  const e = document.getElementById('ac-cuerpo')
  return !!(e && e.offsetParent !== null && (e.innerText || '').length > 50)
})

let fallos = 0
const ok = (t, c, d) => { if (!c) fallos++; console.log(`${c ? '✅' : '⛔'} ${t}${c ? '' : ' · ' + d}`) }
ok('el tablero de la auditoría se ve', seVe, 'quedó oculto: la captura no probaría nada')

const r = await page.evaluate(() => {
  const t = document.getElementById('ac-cuerpo').innerText
  const tabla = [...document.querySelectorAll('#ac-cuerpo table')]
    .find((x) => /Cuadre semanal/.test(x.closest('.card')?.innerText || ''))
  const fila = tabla ? [...tabla.querySelectorAll('tbody tr')].map((f) => f.innerText.replace(/\s+/g, ' ').trim()) : []
  return { texto: t, filas: fila }
})
ok('el panel del cuadre semanal aparece', /Cuadre semanal por unidad/.test(r.texto),
   'no se dibujó: ' + r.texto.slice(0, 140).replace(/\n/g, ' | '))
ok('dice que cierra lunes → domingo', /lunes → domingo/.test(r.texto), 'falta el rótulo del cierre')
ok('la semana que no cuadra sale listada', r.filas.length >= 1, 'no salió ninguna fila')
ok('la fila trae las cuatro causas del desvío',
   r.filas.length > 0 && (r.filas[0].match(/[+-]\d/g) || []).length >= 3,
   'quedó: ' + (r.filas[0] || ''))
ok('se explica que un desvío negativo suele ser carga sin asentar',
   /carga que no se asent/.test(r.texto), 'falta la frase que evita leerlo como robo')

const img = path.join(REPO, 'pruebas', '_cuadre-semanal.png')
const card = await page.evaluateHandle(() => [...document.querySelectorAll('#ac-cuerpo .card')]
  .find((c) => /Cuadre semanal/.test(c.innerText)))
try { await card.asElement().screenshot({ path: img }); console.log('\n📷 ' + img) } catch (e) { console.log('sin captura: ' + e.message) }
console.log('\n' + (fallos === 0 ? '✅ el panel dibuja lo que tiene que dibujar' : '⛔ ' + fallos + ' MAL'))
await navegador.close(); srv.close()
process.exit(fallos === 0 ? 0 : 1)
