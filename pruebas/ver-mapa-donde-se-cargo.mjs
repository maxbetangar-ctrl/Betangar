#!/usr/bin/env node
// ═══════════════════════════════════════════════════════════════════════════════════════════
// EL MAPA DE «DÓNDE SE CARGÓ EL COMBUSTIBLE»
//
// ⛔ POR QUÉ. La tabla dice «a 5.643 m de Las Banderas» y con eso no se decide nada: no se sabe
//    si ese punto es otra estación, el patio o un GPS que saltó. El 08/11/2026 cuatro cargas que
//    la tabla mostraba como cuatro anomalías sueltas resultaron ser UNA estación que faltaba
//    cargar — se vio dibujándolas.
//
// ⛔ QUÉ NO PRUEBA: Supabase va interceptado, así que no prueba la base ni los permisos. Prueba
//    lo que la pantalla DIBUJA. [[norma-probar-el-camino-no-la-pieza]] · [[norma-revisar-antes-de-soltar]]
//
// Uso:  node pruebas/ver-mapa-donde-se-cargo.mjs [--ver]
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

// ── Los datos: las coordenadas REALES del caso que motivó el mapa ──────────────────────────
const ESTACIONES = [
  { nombre: 'E/S SERVICIOS MARACAIBO', poligono: [[10.648818, -71.621435], [10.648818, -71.620703], [10.647918, -71.620703], [10.647918, -71.621435]] },
  { nombre: 'E/S LAS BANDERAS', poligono: [[10.59651916093102, -71.6246983408928], [10.59583401702395, -71.62472516298295], [10.595905201811583, -71.62183105945589], [10.59669312170108, -71.62191957235338]] },
]
const FILAS = [
  { id: 1, fecha: '2026-11-02', hora: '18:35', cam: 'JAC-B009', litros: 150, tanque: 'estacion', dice_la_surtida: 'E/S Las Banderas', precision_m: 17, estacion_mas_cerca: 'E/S SERVICIOS MARACAIBO', m_al_borde: 0, veredicto: 'en estación', lat: 10.64827, lng: -71.62128 },
  { id: 2, fecha: '2026-11-02', hora: '18:41', cam: 'JAC-B005', litros: 150, tanque: 'estacion', dice_la_surtida: 'E/S Las Banderas', precision_m: 26, estacion_mas_cerca: 'E/S SERVICIOS MARACAIBO', m_al_borde: 0, veredicto: 'en estación', lat: 10.64835, lng: -71.62104 },
  { id: 3, fecha: '2026-11-01', hora: '08:02', cam: 'JAC-B009', litros: 60, tanque: 'galpon_1', dice_la_surtida: '', precision_m: 17, estacion_mas_cerca: 'E/S SERVICIOS MARACAIBO', m_al_borde: 1424, veredicto: 'carga del galpón', lat: 10.63517, lng: -71.61844 },
  { id: 4, fecha: '2026-09-19', hora: '19:26', cam: 'JAC-B005', litros: 200, tanque: 'estacion', dice_la_surtida: 'E/S Las Banderas', precision_m: 27, estacion_mas_cerca: 'E/S LAS BANDERAS', m_al_borde: 1093, veredicto: 'FUERA de toda estación', lat: 10.59604, lng: -71.63466 },
  { id: 5, fecha: '2026-10-07', hora: '10:11', cam: 'JAC-B002', litros: 300, tanque: 'estacion', dice_la_surtida: 'E/S Las Banderas', precision_m: 14, estacion_mas_cerca: 'E/S LAS BANDERAS', m_al_borde: 20, veredicto: 'dentro de la tolerancia', lat: 10.59640, lng: -71.62490 },
]

const navegador = await pw.chromium.launch({ headless: !process.argv.includes('--ver') })
const page = await (await navegador.newContext({ viewport: { width: 1280, height: 1000 } })).newPage()
page.on('pageerror', (e) => console.log('   pageerror: ' + e.message))
await page.route('**/*.supabase.co/**', (r) => {
  const u = r.request().url()
  // ⛔ LA PANTALLA SE NIEGA A CORRER SI NO HAY GEOCERCAS, y lo comprueba con un HEAD + count
  //    exacto: PostgREST devuelve el total en la cabecera `Content-Range`, no en el cuerpo. Sin
  //    esa cabecera `count` viene null, la pantalla dice «no hay estaciones marcadas» y no dibuja
  //    nada — que es justo lo que tiene que hacer. El primer intento de este arnés no la mandaba
  //    y las 5 aserciones salieron rojas acusando al código.
  // ⛔ Y HAY QUE EXPONER LA CABECERA. La página corre en 127.0.0.1 y la petición va a
  //    *.supabase.co: es otro origen, y el navegador NO deja que el JS lea `content-range` si no
  //    está en `access-control-expose-headers`. Sin eso `count` llega null aunque la cabecera
  //    viaje, y la pantalla concluye —bien— que no hay geocercas. Costó dos corridas en rojo.
  const CORS = { 'access-control-allow-origin': '*', 'access-control-expose-headers': 'content-range' }
  if (/v_estaciones_poligono/.test(u)) {
    return r.fulfill({ status: 200, contentType: 'application/json',
      headers: Object.assign({ 'content-range': '0-' + (ESTACIONES.length - 1) + '/' + ESTACIONES.length }, CORS),
      body: '[]' })
  }
  const body = /v_surtidas_ubicacion/.test(u) ? JSON.stringify(FILAS)
             : /sitios_asistencia/.test(u) ? JSON.stringify(ESTACIONES)
             : '[]'
  return r.fulfill({ status: 200, contentType: 'application/json', headers: CORS, body })
})

await page.goto(`http://127.0.0.1:${PUERTO}/app.html`, { waitUntil: 'domcontentloaded' })
await page.waitForFunction(() => typeof window.renderSurtidasUbicacion === 'function', { timeout: 25000 })
const seVe = await page.evaluate(async () => {
  const ov = document.getElementById('login-overlay'); if (ov) ov.style.display = 'none'
  document.querySelectorAll('.page').forEach((p) => { p.classList.remove('active'); p.style.display = 'none' })
  let n = document.getElementById('sfe-tabla')
  while (n && n !== document.body) { n.style.display = 'block'; n.classList.add('active'); n = n.parentElement }
  // ⛔ `DB_READY` SE PONE A MANO. `initSupabaseClient()` crea el cliente pero la bandera la
  //    levanta el arranque real de la app, que acá no corre: sin esto la pantalla dice «Sin
  //    conexión con la base» y no dibuja nada. (Me costó una corrida con las 5 en rojo.)
  // ⛔ HAY QUE ESPERAR A QUE BAJE LA LIBRERÍA DEL CDN. `initSupabaseClient()` pone DB_READY en
  //    FALSE si todavía no está, y entonces la pantalla dice «Sin conexión con la base». Es una
  //    carrera: una corrida pasaba y la siguiente no. Se reintenta hasta que el cliente exista.
  const listo = () => window.supabase && typeof window.supabase.from === 'function'
  for (let i = 0; i < 40 && !listo(); i++) {
    if (typeof initSupabaseClient === 'function') initSupabaseClient()
    if (listo()) break
    await new Promise((r) => setTimeout(r, 250))
  }
  if (!listo()) return false
  window.DB_READY = true
  await window.renderSurtidasUbicacion()
  await new Promise((r) => setTimeout(r, 2500))      // que el mapa baje sus tiles
  const e = document.getElementById('sfe-mapa')
  return !!(e && e.offsetParent !== null && e.offsetHeight > 100)
})

let fallos = 0
const ok = (t, c, d) => { if (!c) fallos++; console.log(`${c ? '✅' : '⛔'} ${t}${c ? '' : ' · ' + d}`) }
ok('el mapa se ve y tiene alto', seVe, 'quedó oculto o con 0 px: la captura no probaría nada')

const _diag = await page.evaluate(() => ({
  tabla: ((document.getElementById('sfe-tabla')||{}).innerText||'').slice(0,300),
  resumen: ((document.getElementById('sfe-resumen')||{}).innerText||'').slice(0,200),
  mapaDisplay: (document.getElementById('sfe-mapa')||{}).style ? document.getElementById('sfe-mapa').style.display : 'no existe',
  hayL: typeof L,
}))
console.log('DIAG ' + JSON.stringify(_diag))
const r = await page.evaluate(() => ({
  resumen: (document.getElementById('sfe-resumen') || {}).innerText || '',
  marcadores: document.querySelectorAll('#sfe-mapa path.leaflet-interactive').length,
  tiles: document.querySelectorAll('#sfe-mapa img.leaflet-tile').length,
}))
ok('la tarjeta del GALPÓN está en el resumen', /Del galp[oó]n/i.test(r.resumen), 'quedó: ' + r.resumen.replace(/\n/g, ' | ').slice(0, 160))
ok('el resumen cuenta 1 carga del galpón', /Del galp[oó]n\s*1\b/i.test(r.resumen.replace(/\n/g, ' ')), r.resumen.replace(/\n/g, ' ').slice(0, 160))
// 5 puntos + 2 polígonos = 7 formas dibujadas
ok('se dibujaron los 5 puntos y las 2 geocercas', r.marcadores === 7, 'hay ' + r.marcadores + ' formas')
ok('el mapa cargó tiles de verdad', r.tiles > 0, 'sin tiles: el mapa quedaría gris')

const img = path.join(REPO, 'pruebas', '_mapa-donde-se-cargo.png')
await page.locator('#sfe-resumen').screenshot({ path: img.replace('.png', '-resumen.png') }).catch(() => {})
await page.locator('#sfe-mapa').screenshot({ path: img })
console.log('\n📷 ' + img)
console.log('\n' + (fallos === 0 ? '✅ el mapa dibuja lo que tiene que dibujar' : '⛔ ' + fallos + ' MAL'))
await navegador.close(); srv.close()
process.exit(fallos === 0 ? 0 : 1)
