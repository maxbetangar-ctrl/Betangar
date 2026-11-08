#!/usr/bin/env node
// ═══════════════════════════════════════════════════════════════════════════════════════════
// EL TANQUE DEL GALPÓN QUE NADIE MIDIÓ, EN UNA PANTALLA
//
// ⛔ POR QUÉ ESTE ARNÉS. R17 ya tiene 14 aserciones verdes, y eso prueba el MOTOR. No prueba
//    que la pantalla lo dibuje — y en este mismo módulo la pantalla de «dónde se cargó» llevaba
//    MESES reventando por llamar a una función que no existía, sin que `node --check` ni una
//    sola prueba unitaria lo notaran. Lo que cambié acá es justamente un bloque de HTML.
//    [[norma-probar-el-camino-no-la-pieza]] · [[norma-revisar-antes-de-soltar]]
//
// 🔴 QUÉ SE VERIFICA. Que el bloque del galpón ya NO sea texto gris: que traiga el saldo en
//    libros, los litros sin comprobar, la plata, y la explicación de por qué un saldo negativo
//    no es un faltante. El defecto que arregla es que un hueco de 4.600 L se leía como un
//    detalle de configuración porque no tenía una sola cifra.
//
// ⛔ EL FIXTURE ES NEUTRO (U01, tanques 'g1'/'g2'): este arnés vive en los 5 repos y un código
//    de la flota de una empresa dentro del repo de otra lo bloquea el candado de datos ajenos.
//
// Uso:  node pruebas/ver-el-galpon-sin-medir.mjs [--ver]
// ═══════════════════════════════════════════════════════════════════════════════════════════
import fs from 'node:fs'
import http from 'node:http'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const PUERTO = Number(process.env.PUERTO_PRUEBA || 8991)

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

  // ── Dos tanques de galpón con tabla de cubicación y CERO lecturas ──────────────────────
  // Tabla recta a propósito: lo que se mira acá es el bloque de texto, no la interpolación.
  const tabla = {}; for (let cm = 0; cm <= 100; cm++) tabla[cm] = cm * 23
  const tq = (id) => ({ id, nombre: 'Tanque ' + id, tipo: 'galpon', cap: 2300, hmax: 100, tabla })
  window.AC_TANQUES = [tq('g1'), tq('g2')]
  window.AC_MED = []            // ⛔ NI UNA medición: es el caso real
  window.AC_SALIDAS_TANQUE = []
  // Entró menos de lo que salió ⇒ saldo NEGATIVO, que es el caso real de Betangar (−1.561 L)
  window.AC_GASOIL = [
    { f: '2026-03-05', cam: 'U01', lit: 1000, src: 'Tumaca', tipo_operacion: 'compra' },
    { f: '2026-04-10', cam: 'U01', lit: 900, src: 'Tumaca', tipo_operacion: 'despacho' },
    // ⛔ ESTE NO DEBE CONTAR: se compró en la bomba y fue directo al camión. Contarlo era el
    //    defecto de `_acSalidasGalpon` (389 filas, 55.367 L) que fabricaba un faltante falso.
    { f: '2026-04-11', cam: 'U01', lit: 50000, src: 'Estacion', tipo_operacion: 'despacho' },
  ]
  window.AC_SURTIDAS = [
    { fecha: '2026-08-02', cam: 'U01', litros: 600, tanque: 'tanque-galpon-1', turno: 'diurno' },
  ]
  window.AC_JORNADAS = []
  window.AC_ANOM = []
  window.AC_META = Object.assign({}, window.AC_META || {}, { modo: 'cubicacion', corteSurtidas: '2026-07-18' })
  window.AC_META.galpon = window._acCuadreGalpon('2026-07-24', '2026-09-07')
  window._acRender()
  const e = document.getElementById('ac-cuerpo')
  return !!(e && e.offsetParent !== null && (e.innerText || '').length > 50)
})

let fallos = 0
const ok = (t, c, d) => { if (!c) fallos++; console.log(`${c ? '✅' : '⛔'} ${t}${c ? '' : ' · ' + d}`) }
ok('el tablero de la auditoría se ve', seVe, 'quedó oculto: la captura no probaría nada')

const r = await page.evaluate(() => {
  const card = [...document.querySelectorAll('#ac-cuerpo .card')]
    .find((c) => /Cuadre del tanque del galpón/.test(c.innerText))
  return { hay: !!card, texto: card ? card.innerText : '', todo: document.getElementById('ac-cuerpo').innerText }
})
ok('el bloque del galpón se dibuja', r.hay, 'no apareció: ' + r.todo.slice(0, 160).replace(/\n/g, ' | '))
ok('dice que SÍ se movió combustible', /sí movió combustible/.test(r.texto), 'falta el hecho: ' + r.texto.slice(0, 160))
ok('dice que no se midió NI UNA VEZ', /NI UNA VEZ/.test(r.texto), 'esa es la frase que lo distingue de «falta una lectura más»')
ok('trae el saldo en libros con su cifra', /Los papeles dicen/.test(r.texto) && /-?[\d.,]+ L/.test(r.texto),
   'volvió a ser un texto sin números, que es el defecto que esto arregla')
ok('explica que el saldo negativo NO es un faltante',
   /no puede pasar/.test(r.texto) && /falta asentar/.test(r.texto),
   'presentado como faltante, esto acusaría a alguien con un error de papeles')
ok('dice cuántos litros quedan sin comprobar', /Sin comprobar quedan hasta/.test(r.texto), 'falta la exposición')
ok('y dice cómo se cierra', /Cómo se cierra/.test(r.texto), 'un aviso sin salida es una queja')
// ⛔ EL CONTROL QUE PRUEBA EL ARREGLO DE `src`: los 50.000 L de 'Estacion' NO pueden figurar
//    como salida del galpón. Si figuran, el saldo se va a −50.000 y el aviso miente a lo grande.
// ⛔ LA CIFRA EXACTA, no un «no aparece 50». El primer intento pedía `!/-50/` y dio ROJO sobre
//    código correcto, porque el saldo legítimo del fixture es −500 y ahí adentro está «-50».
//    Una asersión floja acusa al producto. [[norma-una-asercion-mal-escrita-acusa-al-producto]]
//    Las cuentas del fixture: entraron 1.000 (compra Tumaca) y salieron 900 (despacho Tumaca,
//    anterior al corte) + 600 (surtida del galpón) = 1.500 ⇒ saldo −500 L.
//    Si los 50.000 de 'Estacion' se contaran, saldrían 51.500 y el saldo sería −50.500.
ok('las salidas acumuladas son 1.500 L, no 51.500: lo de la bomba no cuenta',
   /1\.500 L que salieron/.test(r.texto) && !/51\.500/.test(r.texto) && !/-50\.500/.test(r.texto),
   'el despacho de estación se está contando como salida del tanque: ' + r.texto.slice(0, 400))

const img = path.join(REPO, 'pruebas', '_galpon-sin-medir.png')
const card = await page.evaluateHandle(() => [...document.querySelectorAll('#ac-cuerpo .card')]
  .find((c) => /Cuadre del tanque del galpón/.test(c.innerText)))
try { await card.asElement().screenshot({ path: img }); console.log('\n📷 ' + img) } catch (e) { console.log('sin captura: ' + e.message) }
console.log('\n' + (fallos === 0 ? '✅ el bloque del galpón dibuja los números, no gris' : '⛔ ' + fallos + ' MAL'))
await navegador.close(); srv.close()
process.exit(fallos === 0 ? 0 : 1)
