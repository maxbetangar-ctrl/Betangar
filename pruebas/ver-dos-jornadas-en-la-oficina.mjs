#!/usr/bin/env node
// ═══════════════════════════════════════════════════════════════════════════════════════════
// LAS DOS JORNADAS, UNA DEBAJO DE LA OTRA (tablero del mecánico).
//
// ⛔ POR QUÉ. Desde el 04/11/2026 una unidad puede tener DOS checklists el mismo día (turno
//    diurno y nocturno). El tablero hacía `salieron[c.cam]=c`: la segunda fila PISABA a la
//    primera. Y peor, marcaba la unidad como «volvió» si CUALQUIERA de las dos tenía hora de
//    entrada — así que una unidad con el diurno cerrado y el nocturno todavía en la calle
//    desaparecía de «sin cerrar la llegada». La jornada abierta se volvía invisible.
//
//    Alejandra eligió cómo verlo (05/11/2026): «las dos jornadas una debajo de la otra».
//
// ⛔ QUÉ NO PRUEBA: no prueba la base ni los permisos — Supabase va interceptado. Prueba lo
//    que la pantalla DIBUJA en los dos casos. [[norma-probar-el-camino-no-la-pieza]]
//
// Uso:  node pruebas/ver-dos-jornadas-en-la-oficina.mjs [--ver]
// ═══════════════════════════════════════════════════════════════════════════════════════════
import fs from 'node:fs'
import http from 'node:http'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const PUERTO = Number(process.env.PUERTO_PRUEBA || 8995)

// Un turno solo (como viene siendo hasta hoy) y el día con dos turnos.
const UN_TURNO = [
  { cam: 'JAC-B001', conductor: 'HENDRICK FUENMAYOR', turno: 'diurno', hora_salida: '06:01', hora_entrada: '20:00' },
  { cam: 'JAC-B002', conductor: 'JOSE ARANGUREN', turno: 'diurno', hora_salida: '05:38', hora_entrada: null },
]
const DOS_TURNOS = [
  { cam: 'JAC-B001', conductor: 'HENDRICK FUENMAYOR', turno: 'diurno', hora_salida: '06:01', hora_entrada: '14:10' },
  { cam: 'JAC-B001', conductor: 'LUIS HURTADO', turno: 'nocturno', hora_salida: '14:20', hora_entrada: null },
  { cam: 'JAC-B002', conductor: 'JOSE ARANGUREN', turno: 'diurno', hora_salida: '05:38', hora_entrada: '17:23' },
]

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
const page = await (await navegador.newContext({ viewport: { width: 1280, height: 900 } })).newPage()
page.on('pageerror', (e) => console.log('   pageerror: ' + e.message))

let filas = UN_TURNO
await page.route('**/*.supabase.co/**', (r) => {
  const u = r.request().url()
  const body = /checklist/.test(u) ? JSON.stringify(filas) : '[]'
  return r.fulfill({ status: 200, contentType: 'application/json', body })
})

await page.goto(`http://127.0.0.1:${PUERTO}/app.html`, { waitUntil: 'domcontentloaded' })
await page.waitForFunction(() => typeof window.mecRenderSalidas === 'function', { timeout: 25000 })
await page.evaluate(() => {
  const ov = document.getElementById('login-overlay'); if (ov) ov.style.display = 'none'
  if (typeof initSupabaseClient === 'function') initSupabaseClient()
  window.UNIDAD_CONFIG = { 'JAC-B001': { activo: true }, 'JAC-B002': { activo: true }, 'JAC-B003': { activo: true } }
  document.querySelectorAll('.page').forEach((p) => { p.classList.remove('active'); p.style.display = 'none' })
  const sec = document.getElementById('sec-mecanico')
  if (sec) { sec.style.display = 'block'; sec.classList.add('active') }
})
const seVe = await page.evaluate(() => {
  const e = document.getElementById('mec-salidas'); return !!(e && e.offsetParent !== null)
})
if (!seVe) { console.log('⛔ el tablero del mecánico no se ve: la captura no probaría nada'); await navegador.close(); srv.close(); process.exit(1) }

let fallos = 0
const chequear = (t, ok, d) => { if (!ok) fallos++; console.log(`${ok ? '✅' : '⛔'} ${t}${d ? ' · ' + d : ''}`) }
const pintar = async () => {
  await page.evaluate(() => mecRenderSalidas())
  await page.waitForTimeout(500)
  return page.evaluate(() => (document.getElementById('mec-salidas') || {}).innerText || '')
}

// ── UN SOLO TURNO: la pantalla no tiene que cambiar ni agregar ruido ───────────────────────
filas = UN_TURNO
const a = await pintar()
console.log('\n── un solo turno (como viene siendo) ──\n   ' + a.replace(/\n/g, '\n   '))
chequear('no aparece el bloque de dos jornadas', !/dos jornadas hoy/i.test(a))
chequear('no se agrega el contador de jornadas', !/jornadas</.test(a) && !/· \d+ jornadas/.test(a))
chequear('la B002, que no volvió, sale como sin cerrar', /B002/.test(a) && /sin cerrar la llegada/i.test(a))
chequear('la B001, que volvió, NO sale en sin cerrar',
  !/sin cerrar la llegada:[\s\S]*B001/i.test(a))
await page.screenshot({ path: path.join(REPO, 'pruebas', '_jornadas-un-turno.png') })

// ── DOS TURNOS: las dos, una debajo de la otra ────────────────────────────────────────────
filas = DOS_TURNOS
const b = await pintar()
console.log('\n── la B001 hizo los dos turnos y el nocturno sigue afuera ──\n   ' + b.replace(/\n/g, '\n   '))
chequear('aparece el bloque de las dos jornadas', /dos jornadas hoy/i.test(b))
chequear('se ve el turno diurno con sus horas', /diurno/.test(b) && /06:01/.test(b) && /14:10/.test(b))
chequear('se ve el turno nocturno debajo, sin cerrar', /nocturno/.test(b) && /14:20/.test(b))
chequear('se nombra al chofer de cada jornada', /HENDRICK/.test(b) && /LUIS HURTADO/.test(b))
chequear('el contador dice cuántas JORNADAS son', /3 jornadas/.test(b), b.split('\n')[0])
// Lo que de verdad se rompía: el nocturno abierto desaparecía porque el diurno había cerrado.
chequear('el nocturno de la B001 SÍ sale en «sin cerrar la llegada»',
  /sin cerrar la llegada:[\s\S]*B001 · nocturno/i.test(b))
chequear('la B002, cerrada, NO sale en sin cerrar',
  !/sin cerrar la llegada:[\s\S]*B002/i.test(b))
await page.screenshot({ path: path.join(REPO, 'pruebas', '_jornadas-dos-turnos.png') })

await navegador.close(); srv.close()
console.log(`\n${fallos ? '⛔ ' + fallos + ' fallo(s)' : '✅ todo verde'} · capturas en pruebas/_jornadas-*.png`)
process.exit(fallos ? 1 : 0)
