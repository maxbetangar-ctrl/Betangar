#!/usr/bin/env node
// ===========================================================================================
// EL PANEL DE CONFIANZA DEL MODULO, EN UNA PANTALLA
//
// POR QUE. Su trabajo es decir si los numeros de abajo sirven para decidir algo. Si no se
// dibuja, el modulo vuelve a presentar cifras sin decir cuanto se les puede creer -- y un panel
// que no aparece se ve igual que uno que dice que todo esta bien.
//
// Uso:  node pruebas/ver-cuanto-se-le-puede-creer.mjs [--ver]
// ===========================================================================================
import fs from 'node:fs'
import http from 'node:http'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const PUERTO = Number(process.env.PUERTO_PRUEBA || 8995)

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
const page = await (await navegador.newContext({ viewport: { width: 1400, height: 1000 } })).newPage()
page.on('pageerror', (e) => console.log('   pageerror: ' + e.message))
await page.route('**/*.supabase.co/**', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: '[]' }))
await page.goto(`http://127.0.0.1:${PUERTO}/app.html`, { waitUntil: 'domcontentloaded' })
await page.waitForFunction(() => typeof window._acRender === 'function', { timeout: 25000 })

const seVe = await page.evaluate(() => {
  const ov = document.getElementById('login-overlay'); if (ov) ov.style.display = 'none'
  document.querySelectorAll('.page').forEach((p) => { p.classList.remove('active'); p.style.display = 'none' })
  let n = document.getElementById('ac-cuerpo')
  while (n && n !== document.body) { n.style.display = 'block'; n.classList.add('active'); n = n.parentElement }

  // ── Jornadas con tolerancia: la mitad CIEGAS (piso por encima del consumo del dia) ─────
  const dia = (f, tol, consumo) => ({
    cam: 'U01', fecha: f, turno: 'diurno', tanque: { cap: 600, hmax: 52.5 },
    salida: 500, salidaCm: 44, llegada: 500 - consumo, llegadaCm: 40, km: 120, conf: 'completa',
    noConf: null, corregida: false, salidaMala: false, llegadaMala: false,
    desp: 0, despJornada: 0, despPost: 0, cargaPostFuera: false, tol, consumo,
    salidaAt: f + ' 06:00:00+00', llegadaAt: f + ' 18:00:00+00',
  })
  window.AC_TANQUES = []; window.AC_MED = []; window.AC_SURTIDAS = []; window.AC_GASOIL = []
  window.AC_SALIDAS_TANQUE = []; window.AC_ANOM = []
  window.AC_META = Object.assign({}, window.AC_META || {}, { modo: 'surtidas', corteSurtidas: '' })
  window.AC_JORNADAS = [
    dia('2026-11-02', 10, 100), dia('2026-11-03', 10, 100),
    dia('2026-11-04', 40, 50), dia('2026-11-05', 40, 50),   // piso 80 > consumo 50: CIEGAS
  ]
  window._acRender()
  const e = document.getElementById('ac-cuerpo')
  return !!(e && e.offsetParent !== null && (e.innerText || '').length > 50)
})

let fallos = 0
const ok = (t, c, d) => { if (!c) fallos++; console.log(`${c ? '✅' : '⛔'} ${t}${c ? '' : ' · ' + d}`) }
ok('el tablero de la auditoría se ve', seVe, 'quedó oculto: la captura no probaría nada')

const r = await page.evaluate(() => {
  const card = [...document.querySelectorAll('#ac-cuerpo .card')]
    .find((c) => /Cuánto se le puede creer/.test(c.innerText))
  return { hay: !!card, texto: card ? card.innerText : '', todo: document.getElementById('ac-cuerpo').innerText }
})
ok('el panel se dibuja', r.hay, 'no aparecio: ' + r.todo.slice(0, 160).split(String.fromCharCode(10)).join(' | '))
ok('lleva el contador de condiciones', /\d de \d/.test(r.texto), 'salio: ' + r.texto.slice(0, 200))
ok('dice que NO es un puntaje', /No es un puntaje/.test(r.texto), 'sin eso se lee como una nota')
ok('lista las 5 condiciones', (r.texto.match(/[OK!]/g) || []).length >= 0 && /datos completos/.test(r.texto)
   && /menos de un día de consumo/.test(r.texto) && /tanque del galpón/.test(r.texto)
   && /factura de la estación/.test(r.texto) && /examen/.test(r.texto),
   'falta alguna condicion: ' + r.texto.slice(0, 400))
ok('cada condicion rota dice el proximo paso', /\u25b6\ufe0f/.test(r.texto),
   'un tablero que marca rojo sin decir que hacer se vuelve paisaje')
// El rotulo de las tarjetas se dibuja en MAYUSCULAS por CSS (`text-transform`), asi que
// `innerText` devuelve 'CONSUMO DEL PERIODO'. Comparar con el texto del codigo fuente daba rojo
// sobre una pantalla correcta. Se mide sin distinguir mayusculas.
const plano_ = r.todo.toLowerCase()
ok('va ARRIBA de las tarjetas de numeros',
   plano_.indexOf('cuánto se le puede creer') >= 0 &&
   plano_.indexOf('consumo del período') >= 0 &&
   plano_.indexOf('cuánto se le puede creer') < plano_.indexOf('consumo del período'),
   'quedo debajo de los numeros que tiene que calificar')

const img = path.join(REPO, 'pruebas', '_cuanto-se-le-puede-creer.png')
const card = await page.evaluateHandle(() => [...document.querySelectorAll('#ac-cuerpo .card')]
  .find((c) => /Cuánto se le puede creer/.test(c.innerText)))
try { await card.asElement().screenshot({ path: img }); console.log('\n📷 ' + img) } catch (e) { console.log('sin captura: ' + e.message) }
console.log('\n' + (fallos === 0 ? '✅ el panel de confianza dibuja las condiciones' : '⛔ ' + fallos + ' MAL'))
await navegador.close(); srv.close()
process.exit(fallos === 0 ? 0 : 1)
