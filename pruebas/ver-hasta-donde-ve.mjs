#!/usr/bin/env node
// ═══════════════════════════════════════════════════════════════════════════════════════════
// HASTA DONDE VE LA AUDITORIA, EN UNA PANTALLA
//
// ⛔ POR QUE. El panel existe para impedir que «0 anomalias» se lea como «no falta nada». Si no
//    se dibuja, el modulo vuelve a afirmar de mas y nadie se entera: un panel que no aparece se
//    ve igual que uno que dice que todo esta bien. [[norma-probar-el-camino-no-la-pieza]]
//
// 📌 Medido sobre 1.401 jornadas reales: piso 67,6 L = 113% de lo que gasta un camion en un dia,
//    y 689 de 1.234 jornadas (56%) con el piso por encima del consumo del dia.
//
// Uso:  node pruebas/ver-hasta-donde-ve.mjs [--ver]
// ═══════════════════════════════════════════════════════════════════════════════════════════
import fs from 'node:fs'
import http from 'node:http'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const PUERTO = Number(process.env.PUERTO_PRUEBA || 8993)

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
    .find((c) => /Hasta dónde ve esta auditoría/.test(c.innerText))
  return { hay: !!card, texto: card ? card.innerText : '', todo: document.getElementById('ac-cuerpo').innerText }
})
ok('el panel se dibuja', r.hay, 'no apareció: ' + r.todo.slice(0, 160).split(String.fromCharCode(10)).join(' | '))
ok('dice el piso en litros', /50,0 L en una jornada/.test(r.texto),
   'la mediana de [20,20,80,80] es 50 — salió: ' + r.texto.slice(0, 200))
ok('dice cuánto gasta un día típico', /75,0 L/.test(r.texto), 'falta el consumo mediano: ' + r.texto.slice(0, 200))
ok('dice que el piso es el 67% de un día', /67%/.test(r.texto), 'salió: ' + r.texto.slice(0, 200))
ok('cuenta las jornadas ciegas', /2 de 4 jornadas \(50%\)/.test(r.texto), 'salió: ' + r.texto.slice(0, 250))
ok('⛔ dice que ahí NO se puede detectar ningún faltante', /no se puede detectar ningún faltante/.test(r.texto),
   'esa frase es todo el punto del panel')
ok('y dice cómo se baja el piso', /medio centímetro/.test(r.texto), 'un límite sin salida es una excusa')
ok('el margen del método aparece junto al consumo del período',
   /margen del método ±/.test(r.todo), 'un número sin su margen se lee como exacto')

const img = path.join(REPO, 'pruebas', '_hasta-donde-ve.png')
const card = await page.evaluateHandle(() => [...document.querySelectorAll('#ac-cuerpo .card')]
  .find((c) => /Hasta dónde ve esta auditoría/.test(c.innerText)))
try { await card.asElement().screenshot({ path: img }); console.log('\n📷 ' + img) } catch (e) { console.log('sin captura: ' + e.message) }
console.log('\n' + (fallos === 0 ? '✅ el panel dice hasta donde ve la auditoria' : '⛔ ' + fallos + ' MAL'))
await navegador.close(); srv.close()
process.exit(fallos === 0 ? 0 : 1)
