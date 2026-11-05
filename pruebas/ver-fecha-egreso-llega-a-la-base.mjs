#!/usr/bin/env node
// ═══════════════════════════════════════════════════════════════════════════════════════════
// LA FECHA DE EGRESO TIENE QUE SALIR EN EL UPSERT.
//
// ⛔ POR QUÉ. El campo «Fecha de Egreso (último día trabajado)» se agregó a la ficha el
//    04/11/2026. Se veía, se llenaba y la pantalla decía «guardado correctamente» — pero la
//    columna NO IBA en el `upsert` de `guardarEmpleado`, así que nunca llegaba a la base.
//    Nómina tiene un cartel pidiendo cargar las 25 fechas de egreso que faltan: RRHH las
//    habría cargado una por una y se habrían perdido todas, con la app diciendo que sí.
//    Un campo que se ve, se llena y se confirma es indistinguible de uno que guarda.
//
//    Es la TERCERA vez que una columna nueva se olvida en ese mismo upsert (`fnac`/`fingreso`
//    primero, `forma_pago` después). Por eso esto queda como prueba y no como revisión a ojo:
//    la próxima columna que se agregue a la ficha y se olvide acá, la agarra esto.
//
// ⛔ QUÉ NO PRUEBA: no escribe NADA en la base — Supabase va interceptado. Prueba que la app
//    MANDA el dato. Que la base lo acepte es otra mitad: la columna `fegreso` existe en
//    `empleados` (date, nullable), comprobado el 05/11/2026.
//    [[norma-probar-el-camino-no-la-pieza]]
//
// Uso:  node pruebas/ver-fecha-egreso-llega-a-la-base.mjs
// ═══════════════════════════════════════════════════════════════════════════════════════════
import fs from 'node:fs'
import http from 'node:http'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const PUERTO = Number(process.env.PUERTO_PRUEBA || 8994)
const EGRESO = '2026-10-31'

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
page.on('dialog', (d) => d.dismiss().catch(() => {}))   // el alert de error no traba la corrida

// Nada real se escribe: se guarda lo que la app MANDA para poder mirarlo.
const mandado = []
await page.route('**/*.supabase.co/**', (r) => {
  const req = r.request()
  if (req.method() !== 'GET') {
    let cuerpo = null
    try { cuerpo = JSON.parse(req.postData() || 'null') } catch (e) {}
    mandado.push({ url: req.url(), metodo: req.method(), cuerpo })
  }
  return r.fulfill({ status: 200, contentType: 'application/json', body: '[]' })
})

await page.goto(`http://127.0.0.1:${PUERTO}/app.html`, { waitUntil: 'domcontentloaded' })
await page.waitForFunction(() => typeof window.guardarEmpleado === 'function', { timeout: 25000 })

await page.evaluate(async (egreso) => {
  const ov = document.getElementById('login-overlay'); if (ov) ov.style.display = 'none'
  // El cliente de Supabase se arma al iniciar sesión, y acá no hay sesión. Se arma igual:
  // todo lo que salga por él está interceptado, así que no toca nada real.
  if (typeof initSupabaseClient === 'function') initSupabaseClient()
  const poner = (id, v) => { const e = document.getElementById(id); if (e) e.value = v }
  poner('ne-id', 'E999'); poner('ne-nombre', 'EMPLEADO DE PRUEBA'); poner('ne-cargo', 'Chofer')
  poner('ne-ced', 'V-00000000'); poner('ne-fingreso', '2026-01-02'); poner('ne-fegreso', egreso)
  await guardarEmpleado()
}, EGRESO)
await page.waitForTimeout(1200)

let fallos = 0
const chequear = (t, ok, d) => { if (!ok) fallos++; console.log(`${ok ? '✅' : '⛔'} ${t}${d ? ' · ' + d : ''}`) }

const aEmpleados = mandado.filter((m) => /\/empleados/.test(m.url))
console.log(`\n${mandado.length} escritura(s) interceptada(s), ${aEmpleados.length} a \`empleados\``)
chequear('la ficha se guarda contra `empleados`', aEmpleados.length > 0)

const fila = aEmpleados.flatMap((m) => Array.isArray(m.cuerpo) ? m.cuerpo : [m.cuerpo]).filter(Boolean)
  .find((f) => f && f.id === 'E999')
chequear('la fila del empleado sale en el upsert', !!fila, fila ? Object.keys(fila).length + ' columnas' : '—')
if (fila) {
  chequear('`fegreso` VA en el upsert', Object.prototype.hasOwnProperty.call(fila, 'fegreso'),
    'columnas: ' + Object.keys(fila).join(','))
  chequear('`fegreso` lleva la fecha que se escribió', fila.fegreso === EGRESO,
    'se mandó ' + JSON.stringify(fila.fegreso) + ', se esperaba ' + EGRESO)
  // Control negativo: si la ficha se deja vacía tiene que viajar `null`, no '' — la columna
  // es `date` y un texto vacío la haría fallar entera.
  chequear('`fingreso` sigue viajando (no se rompió lo de antes)', fila.fingreso === '2026-01-02', String(fila.fingreso))
}

await page.evaluate(() => {
  const e = document.getElementById('ne-fegreso'); if (e) e.value = ''
  const i = document.getElementById('ne-id'); if (i) i.value = 'E998'
  const n = document.getElementById('ne-nombre'); if (n) n.value = 'SIN EGRESO'
  const o = document.getElementById('ne-id-original'); if (o) o.value = ''
  return guardarEmpleado()
})
await page.waitForTimeout(1000)
const vacia = mandado.filter((m) => /\/empleados/.test(m.url))
  .flatMap((m) => Array.isArray(m.cuerpo) ? m.cuerpo : [m.cuerpo]).filter(Boolean)
  .find((f) => f && f.id === 'E998')
chequear('sin fecha viaja `null`, no cadena vacía (la columna es `date`)',
  !!vacia && vacia.fegreso === null, vacia ? JSON.stringify(vacia.fegreso) : 'no salió la fila')

await navegador.close(); srv.close()
console.log(`\n${fallos ? '⛔ ' + fallos + ' fallo(s)' : '✅ todo verde'}`)
process.exit(fallos ? 1 : 0)
