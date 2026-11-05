#!/usr/bin/env node
// ═══════════════════════════════════════════════════════════════════════════════════════════
// VER EN NAVEGADOR LA PANTALLA DE CHECKLIST cuando la llegada YA ESTÁ CERRADA.
//
// ⛔ POR QUÉ. Alejandra, 04/11/2026: «al seleccionar una unidad me da su kilometraje de salida
//    y hora, pero el kilometraje de llegada no es el correcto y la leyenda indica que no se ha
//    realizado el cierre del check list de llegada cuando sí se realizó».
//    Eran dos defectos con una sola cara:
//      1) el cartel decía SIEMPRE «Solo completa los datos de llegada», mirara o no el dato;
//      2) `clModoNoche` precargaba solo la SALIDA, y 500 ms después `clVerificarKmChofer`
//         rellenaba el km de llegada con `km_data.km_entrada_ayer` — el de AYER.
//    Lo segundo no era cosmético: guardar desde ahí reemplazaba el km real de la llegada.
//
// ⛔ QUÉ NO PRUEBA: no prueba la base, ni los permisos, ni el RLS — Supabase va interceptado.
//    Prueba LO QUE LA PANTALLA DIBUJA en los dos estados. [[norma-probar-el-camino-no-la-pieza]]
//
// Uso:  node pruebas/ver-llegada-cerrada-en-navegador.mjs [--ver]
// ═══════════════════════════════════════════════════════════════════════════════════════════
import fs from 'node:fs'
import http from 'node:http'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const PUERTO = Number(process.env.PUERTO_PRUEBA || 8993)
const SALIDA = path.join(REPO, 'pruebas')

// El km con el que la unidad ENTRÓ AYER. Es también con el que SALIÓ hoy: por eso usarlo
// como «llegada» no se nota a simple vista, y es justo lo que hacía el defecto.
const KM_DE_AYER = 21408
const FILA_CERRADA = {
  cam: 'JAC-B001', conductor: 'HENDRICK JOSE FUENMAYOR LOPEZ', turno: 'diurno',
  km_salida: 21408, hora_salida: '06:01', km_entrada: 21541, hora_entrada: '20:00',
  comb_salida: '1/1', comb_entrada: '1/2',
}
const FILA_ABIERTA = { cam: 'JAC-B001', conductor: 'HENDRICK JOSE FUENMAYOR LOPEZ',
  turno: 'diurno', km_salida: 21408, hora_salida: '06:01', comb_salida: '1/1' }

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
const ctx = await navegador.newContext({ viewport: { width: 1280, height: 900 } })
const page = await ctx.newPage()
page.on('pageerror', (e) => console.log('   pageerror: ' + e.message))

// ⛔ Nada real se lee ni se escribe. `km_data` devuelve el km de AYER a propósito: si la
//    pantalla lo vuelve a usar como llegada, esta prueba lo tiene que ver.
await page.route('**/*.supabase.co/**', (r) => {
  const u = r.request().url()
  const body = u.includes('km_data') ? JSON.stringify([{ km_entrada_ayer: KM_DE_AYER }]) : '[]'
  return r.fulfill({ status: 200, contentType: 'application/json', body })
})

let fallos = 0
const chequear = (titulo, ok, detalle) => {
  if (!ok) fallos++
  console.log(`${ok ? '✅' : '⛔'} ${titulo}${detalle ? ' · ' + detalle : ''}`)
}

await page.goto(`http://127.0.0.1:${PUERTO}/app.html`, { waitUntil: 'domcontentloaded' })
await page.waitForFunction(() => typeof window.clModoNoche === 'function', { timeout: 25000 })

// La pantalla se mira de verdad. Para eso hay que SACAR el login de encima: `sp()` pide
// permisos y sin sesión no hay ninguno, así que la captura salía del formulario de entrada y
// no probaba nada. No se simula una sesión —esto no prueba permisos ni RLS—: se destapa el
// panel que ya está en el HTML. [[verificar-pantalla-en-navegador-sin-sesion]]
await page.evaluate(() => {
  try { DB_READY = false } catch (e) {}          // que no intente guardar nada
  const ov = document.getElementById('login-overlay'); if (ov) ov.style.display = 'none'
  document.querySelectorAll('.page').forEach((p) => { p.classList.remove('active'); p.style.display = 'none' })
  const sec = document.getElementById('sec-checklist')
  if (sec) { sec.style.display = 'block'; sec.classList.add('active') }
})
await page.waitForTimeout(400)
const seVe = await page.evaluate(() => {
  const i = document.getElementById('cl-km-entrada')
  return !!(i && i.offsetParent !== null)        // visible de verdad, no solo presente
})
if (!seVe) { console.log('⛔ el panel de checklist NO se ve: la captura no probaría nada'); process.exit(1) }

const correr = async (fila) => page.evaluate((f) => {
  ;['cl-km-salida', 'cl-km-entrada', 'cl-hora-salida', 'cl-hora-entrada'].forEach((id) => {
    const el = document.getElementById(id); if (el) { el.value = ''; el.readOnly = false; el.disabled = false }
  })
  const b = document.getElementById('cl-modo-banner'); if (b) b.remove()
  clModoNoche(f)
  clVerificarKmChofer(f.cam)                      // lo mismo que hace clCargarUnidad a los 500 ms
  return null
}, fila)

const leer = async () => page.evaluate(() => ({
  banner: (document.getElementById('cl-modo-banner') || {}).innerText || '(no hay cartel)',
  kmSalida: (document.getElementById('cl-km-salida') || {}).value || '',
  kmEntrada: (document.getElementById('cl-km-entrada') || {}).value || '',
  horaSalida: (document.getElementById('cl-hora-salida') || {}).value || '',
  horaEntrada: (document.getElementById('cl-hora-entrada') || {}).value || '',
  diff: (document.getElementById('cl-km-diff') || {}).innerText || '',
}))

// ── ESTADO 1 · la jornada YA cerró ─────────────────────────────────────────────────────────
await correr(FILA_CERRADA)
await page.waitForTimeout(900)                    // el relleno viejo entraba a los 500 ms
const a = await leer()
console.log('\n── la llegada YA está cerrada (km 21541, hora 20:00) ──')
console.log('   cartel: ' + a.banner.replace(/\n/g, ' / '))
console.log(`   salida ${a.kmSalida} ${a.horaSalida}  ·  llegada ${a.kmEntrada} ${a.horaEntrada}  ·  ${a.diff}`)
chequear('el cartel dice que la jornada está CERRADA', /cerrada/i.test(a.banner), a.banner.slice(0, 40))
chequear('el cartel NO pide completar la llegada', !/Solo completa los datos de llegada/i.test(a.banner))
chequear('el km de llegada es el GUARDADO, no el de ayer', a.kmEntrada === '21541',
  `se ve ${a.kmEntrada || '(vacío)'} · el de ayer era ${KM_DE_AYER}`)
chequear('la hora de llegada se muestra', a.horaEntrada === '20:00', a.horaEntrada || '(vacía)')
chequear('el recorrido del día sale bien', /133/.test(a.diff), a.diff)
await page.screenshot({ path: path.join(SALIDA, '_llegada-cerrada.png'), fullPage: false })

// ── ESTADO 2 · salió pero todavía no volvió ────────────────────────────────────────────────
await correr(FILA_ABIERTA)
await page.waitForTimeout(900)
const b = await leer()
console.log('\n── salió y todavía NO volvió ──')
console.log('   cartel: ' + b.banner.replace(/\n/g, ' / '))
console.log(`   salida ${b.kmSalida} ${b.horaSalida}  ·  llegada ${b.kmEntrada || '(vacío)'} ${b.horaEntrada || ''}`)
chequear('el cartel SÍ pide completar la llegada', /Solo completa los datos de llegada/i.test(b.banner))
chequear('el km de llegada queda VACÍO, no con el de ayer', b.kmEntrada === '',
  `se ve ${b.kmEntrada || '(vacío)'} · el de ayer era ${KM_DE_AYER}`)
chequear('la salida sí se precarga', b.kmSalida === '21408' && b.horaSalida === '06:01',
  `${b.kmSalida} ${b.horaSalida}`)
await page.screenshot({ path: path.join(SALIDA, '_llegada-abierta.png'), fullPage: false })

await navegador.close(); srv.close()
console.log(`\n${fallos ? '⛔ ' + fallos + ' fallo(s)' : '✅ todo verde'} · capturas en pruebas/_llegada-*.png`)
process.exit(fallos ? 1 : 0)
