#!/usr/bin/env node
// ═══════════════════════════════════════════════════════════════════════════════════════════
// LA PANTALLA DE SURTIR YA NO PREGUNTA DE DÓNDE: LO DICE EL GPS
//
// ⛔ POR QUÉ ESTE ARNÉS NO ES OPCIONAL. Esta es la pantalla del chofer, y ya se rompió en
//    caliente un sábado: la v47 puso un candado que rechazaba al guardar, los choferes se
//    encontraron un error rojo donde antes daba «Registrar y listo», y hubo que revertirla.
//    Un cambio acá que se vea bien en el código y mal en el teléfono le tranca el día a 12
//    personas. [[norma-una-pantalla-se-revisa-en-una-pantalla]] · [[norma-revisar-antes-de-soltar]]
//
// 🔴 QUÉ CAMBIÓ (08/11/2026). Se quitaron los tres botones «Galpón 1 / Galpón 2 / Estación».
//    Medido sobre las 213 surtidas reales: 11 cargas (2.101 L) quedaron marcadas galpón siendo
//    de estación, y el tanque del galpón terminó con un saldo en libros de −1.561 L, imposible.
//    8 de esas 11 son anteriores al 29/08, cuando el selector venía con `galpon_1` por omisión.
//    Máximo: «que ellos no escojan de dónde... ellos simplemente ponen cuántos litros».
//
// ⚠️ QUÉ NO PRUEBA: no prueba la base. El disparador `tg_surtidas_ubicar`, que es quien de
//    verdad decide el lugar, vive en Supabase y acá las RPC van interceptadas. Esto prueba que
//    la PANTALLA dejó de preguntar y que MANDA lo que tiene que mandar.
//
// Uso:  node pruebas/ver-surtir-sin-preguntar-tanque.mjs [--ver]
// ═══════════════════════════════════════════════════════════════════════════════════════════
import fs from 'node:fs'
import http from 'node:http'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const PUERTO = Number(process.env.PUERTO_PRUEBA || 8997)
const CAM = 'JAC-B001'

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
  const rel = decodeURIComponent(q.url.split('?')[0]).replace(/^\/+/, '') || 'chofer.html'
  const f = path.join(REPO, rel)
  if (!f.startsWith(REPO) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { s.writeHead(404); s.end('no'); return }
  s.writeHead(200, { 'Content-Type': MIME[path.extname(f).toLowerCase()] || 'application/octet-stream' })
  fs.createReadStream(f).pipe(s)
})
await new Promise((ok, mal) => { srv.once('error', (e) => mal(new Error(`puerto ${PUERTO}: ${e.code}`))); srv.listen(PUERTO, '127.0.0.1', ok) })

const navegador = await pw.chromium.launch({ headless: !process.argv.includes('--ver') })
const ctx = await navegador.newContext({ viewport: { width: 420, height: 900 } })
const page = await ctx.newPage()
const errores = []
page.on('pageerror', (e) => errores.push('pageerror: ' + e.message))
page.on('dialog', (d) => d.accept())
const avisos = []
await page.exposeFunction('_capturarAviso', (t) => avisos.push(t))


// ⛔ EL GENERAL PRIMERO Y EL ESPECÍFICO ÚLTIMO: en Playwright gana la ruta registrada al final.
const enviados = []
// La subida de la foto NO va por /rest/: va por /storage/. Sin esto, `surGuardar` se cuelga
// esperando una subida que nunca responde y la prueba 'no manda nada' acusa al producto.
await page.route('**/storage/v1/**', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: '{"Key":"surtidas/x.png"}' }))
await page.route('**/rest/v1/**', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: '[]' }))
await page.route('**/rest/v1/rpc/**', async (r) => {
  const nombre = r.request().url().split('/').pop().split('?')[0]
  let cuerpo = {}
  try { cuerpo = JSON.parse(r.request().postData() || '{}') } catch (e) {}
  enviados.push({ nombre, cuerpo })
  let datos = []
  if (nombre === 'chofer_puede_ver') datos = true
  if (nombre === 'hay_conexion') datos = true
  if (nombre === 'surtida_registrar') datos = cuerpo?.p?.id || 'ok'
  return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(datos) })
})

let fallos = 0
const ok = (t, c, d) => { if (!c) fallos++; console.log(`${c ? '✅' : '⛔'} ${t}${c ? '' : ' · ' + d}`) }

// ⛔ SE DEJA EL CHOFER IDENTIFICADO **Y SE RECARGA**. Sin la recarga el portón «¿Quién maneja
//    hoy?» vuelve a taparlo todo y la captura sale del portón, no de la pantalla que se quiere
//    revisar. Es la misma secuencia que usa `ver-dos-turnos-chofer.mjs`, que ya funciona.
await page.goto(`http://127.0.0.1:${PUERTO}/chofer.html?cam=${CAM}`, { waitUntil: 'domcontentloaded' })
await page.waitForFunction(() => typeof window.switchTab === 'function', { timeout: 20000 })
await page.evaluate((cam) => {
  try { localStorage.setItem('btg_chofer_dia_' + cam, JSON.stringify({ nombre: 'CHOFER DE PRUEBA', fecha: _hoyVE() })) } catch (e) {}
}, CAM)
await page.reload({ waitUntil: 'domcontentloaded' })
await page.waitForTimeout(3500)
await page.evaluate(() => window.switchTab('surtir'))
await page.waitForTimeout(500)

// ── 1. La pregunta ya no está ───────────────────────────────────────────────────────────────
const pantalla = await page.evaluate(() => ({
  botones: ['galpon_1', 'galpon_2', 'estacion'].filter((x) => !!document.getElementById('sur-tanque-' + x)),
  texto: (document.getElementById('tab-surtir') || document.body).innerText,
  btn: (document.getElementById('sur-btn') || {}).textContent || '',
  visible: !!(document.getElementById('sur-btn') || {}).offsetParent,
}))
ok('los tres botones de tanque ya no existen', pantalla.botones.length === 0,
   'siguen: ' + pantalla.botones.join(', '))
ok('la pantalla dice que el lugar lo toma el GPS', /lo toma el GPS/i.test(pantalla.texto),
   'el chofer no sabe por qué desapareció la pregunta: ' + pantalla.texto.slice(0, 160).replace(/\n/g, ' | '))
// ⛔ El botón ya NO puede decir «Primero toque de dónde surtió»: esos botones no existen. Un
//    botón que pide tocar algo que no está es peor que no tener botón.
ok('el botón dice REGISTRAR, no «primero toque…»', /Registrar surtida/.test(pantalla.btn) && !/Primero toque/.test(pantalla.btn),
   'dice: ' + JSON.stringify(pantalla.btn))
ok('el botón se ve', pantalla.visible, 'quedó oculto')

// ── 2. ⛔ EL GPS SIGUE SIENDO OBLIGATORIO ────────────────────────────────────────────────────
// Ahora es el ÚNICO dato que dice dónde se surtió: si se pudiera guardar sin él, cada carga
// sin señal quedaría sin lugar para siempre. Antes, al menos, estaba lo que marcó la persona.
//
// ⛔ LA FOTO SE PONE **ANTES**, Y NO ES UN DETALLE. `surGuardar` también exige foto, y la
//    exige DESPUÉS del GPS. Sin ponerla, esta aserción se pondría verde porque faltaba la
//    FOTO y yo estaría creyendo que probé el candado del GPS.
//    Una prueba que pasa por el motivo equivocado es peor que una que falla.
//    [[norma-test-que-pasa-por-el-motivo-equivocado]]
// ⛔ TIENE QUE SER UN PNG QUE DECODIFIQUE DE VERDAD. El primer intento usaba los 8 bytes de la
//    firma PNG y la app fallaba con «Error al registrar: [object Event]»: antes de subirla, la
//    foto se carga en un <img> para comprimirla, y una firma suelta no es una imagen. El error
//    parecía del producto y era del fixture. Esto es un PNG de 1×1 completo.
const PNG_1x1 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='
const ponerFoto = () => page.evaluate((b64) => {
  const bin = atob(b64)
  const b = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) b[i] = bin.charCodeAt(i)
  window.SUR_FOTO_FILE = new File([b], 'surtidor.png', { type: 'image/png' })
}, PNG_1x1)
await page.evaluate(() => { const o = window.mostrarToast; window.mostrarToast = function(t, k){ try{ window._capturarAviso(String(k||"")+": "+String(t)) }catch(e){}; return o && o.apply(this, arguments) } })
await ponerFoto()
await page.evaluate(() => {
  window.SUR_GPS = null; window.SUR_GPS_FAILS = 0
  const el = document.getElementById('sur-litros'); if (el) { el.value = '200'; el.dispatchEvent(new Event('input')) }
})
await page.evaluate(() => window.surGuardar && window.surGuardar())
await page.waitForTimeout(500)
ok('sin GPS NO se guarda', enviados.filter((e) => e.nombre === 'surtida_registrar').length === 0,
   'guardó una surtida sin ubicación: quedaría sin lugar para siempre')

// ── 3. Con GPS y litros, qué manda ──────────────────────────────────────────────────────────
await ponerFoto()
await page.evaluate(() => {
  window.SUR_GPS = { lat: 10.5959317, lng: -71.6219167, acc: 15 }   // E/S Las Banderas
  const el = document.getElementById('sur-litros'); if (el) { el.value = '200'; el.dispatchEvent(new Event('input')) }
})
await page.evaluate(() => window.surGuardar && window.surGuardar())
await page.waitForTimeout(900)

const reg = enviados.filter((e) => e.nombre === 'surtida_registrar').map((e) => e.cuerpo.p || e.cuerpo)
ok('con GPS y litros SÍ se registra', reg.length >= 1, 'no mandó nada. AVISOS: ' + JSON.stringify(avisos))
if (reg.length) {
  const r = reg[reg.length - 1]
  // ⛔ 'estacion' Y NO null: el RPC decide el PRECIO mirando `tanques_internos` (["galpon_1"]).
  //    Con 'estacion' el costo queda NULL y lo pone administración, que es lo correcto.
  ok('manda tanque="estacion"', r.tanque === 'estacion', 'mandó: ' + JSON.stringify(r.tanque))
  ok('⛔ NO manda nada de galpón', !/galpon/i.test(JSON.stringify(r.tanque || '')), 'mandó: ' + r.tanque)
  // ⛔ El costo lo define administración al cierre. Antes la app mandaba 0,812 cuando el chofer
  //    decía «galpón», y ese número se colaba como si fuera un precio real de compra.
  ok('el costo por litro va VACÍO, lo pone administración',
     r.costo_litro_usd === null || r.costo_litro_usd === undefined,
     'mandó un precio inventado: ' + JSON.stringify(r.costo_litro_usd))
  ok('manda la coordenada', Number(r.lat) === 10.5959317 && Number(r.lng) === -71.6219167,
     'sin coordenada el disparador no puede ubicar nada: ' + JSON.stringify([r.lat, r.lng]))
  ok('y la precisión del GPS', Number(r.precision_gps) === 15,
     'el margen del disparador depende de esto: ' + JSON.stringify(r.precision_gps))
  ok('manda los litros', Number(r.litros) === 200, 'mandó: ' + JSON.stringify(r.litros))
}

ok('la pantalla no tiró ningún error', errores.length === 0, errores.join(' · '))

const img = path.join(REPO, 'pruebas', '_surtir-sin-preguntar.png')
try { await page.screenshot({ path: img }); console.log('\n📷 ' + img) } catch (e) { console.log('sin captura: ' + e.message) }
console.log('\n' + (fallos === 0 ? '✅ la pantalla dejó de preguntar y manda lo correcto' : '⛔ ' + fallos + ' MAL'))
await navegador.close(); srv.close()
process.exit(fallos === 0 ? 0 : 1)
