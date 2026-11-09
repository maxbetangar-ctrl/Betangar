#!/usr/bin/env node
// ═══════════════════════════════════════════════════════════════════════════════
// 🖨️ EL INFORME DE COMBUSTIBLE EN PDF, CON LOS DATOS REALES
//
//   node pruebas/informe-pdf.mjs 2026-08-01 2026-11-08
//
// ⛔ POR QUÉ ASÍ. El informe lo arma `acImprimirInforme()` DENTRO de la app, que es lo
//    que la oficina va a usar todos los meses. Esto abre esa misma pantalla en un
//    navegador de verdad con los datos de verdad y guarda lo que imprimiría. Un
//    generador aparte sería una segunda verdad que se desincroniza en una semana.
//
// ⛔ LO QUE SE REEMPLAZA ES **SOLO EL TRANSPORTE**, y en un punto quirúrgico:
//    `_acPaginar`. Esa función pide de a 1.000 filas con `.range()` y corta cuando
//    recibe menos de 1.000. Simulando el servidor por red, el bucle no terminaba nunca
//    —1.476 peticiones y la pantalla clavada en «Analizando el período…»— porque el
//    encabezado `Range` no aparece en `request.headers()` de Playwright. Sustituyendo
//    la función entera, no hay bucle que pueda colgarse y TODO el resto de `acCargar`
//    —la normalización de tanques, el dedupe, el costo, los modelos— sigue siendo el
//    del producto. [[norma-probar-el-camino-no-la-pieza]]
//
// ⚠️ SOLO LECTURA. No escribe nada en la base.
// ═══════════════════════════════════════════════════════════════════════════════
import fs from 'node:fs'
import http from 'node:http'
import path from 'node:path'
import os from 'node:os'
import { fileURLToPath, pathToFileURL } from 'node:url'

const AQUI = path.dirname(fileURLToPath(import.meta.url))
const RAIZ = path.resolve(AQUI, '..')
const VER = process.argv.includes('--ver')
const args = process.argv.slice(2).filter((a) => !a.startsWith('--'))
const DESDE = args[0] || '2026-08-01'
const HASTA = args[1] || new Date().toISOString().slice(0, 10)
const SALIDA = path.join(AQUI, '_salida')

let chromium
try {
  const g = process.platform === 'win32'
    ? path.join(process.env.APPDATA || '', 'npm', 'node_modules', 'playwright', 'index.mjs')
    : '/usr/local/lib/node_modules/playwright/index.mjs'
  chromium = (fs.existsSync(g) ? await import(pathToFileURL(g).href) : await import('playwright')).chromium
} catch {
  console.error('⛔ falta Playwright: npm i -g playwright && npx playwright install chromium')
  process.exit(1)
}

// ── Datos, por la API de gestión, paginados ──────────────────────────────────
const { getPAT } = await import(pathToFileURL(path.join(os.homedir(), 'maxware-tools', 'pat.mjs')).href)
const REF = 'hrkjddehqnzcqwlkklqm'
const PAT = await getPAT()
const sql = async (q) => {
  const r = await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`,
    { method: 'POST', headers: { Authorization: 'Bearer ' + PAT, 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: q }) })
  if (!r.ok) { console.error('⛔ ' + (await r.text()).slice(0, 180)); return [] }
  return r.json()
}
// ⛔ SE BAJA TODO Y EL FILTRO LO PONE EL SIMULADOR, consulta por consulta. Bajarlo ya
//    recortado hacía que la consulta de HISTORIA del tanque —que a propósito NO lleva filtro—
//    recibiera igual el recorte: el saldo salía 1.000/2.460 cuando la historia real es
//    5.300/4.760. Un dato recortado en el origen no se puede desrecortar después.
//    [[norma-falta-de-dato-no-es-un-dato]]
console.log('Bajando la historia completa…')
const D = {
  combustible_tanques_config: await sql('select * from combustible_tanques_config'),
  combustible_mediciones: await sql('select * from combustible_mediciones'),
  gasoil: await sql('select * from gasoil'),
  checklist: await sql('select * from checklist'),
  surtidas: await sql('select * from surtidas'),
  salidas_tanque: await sql('select * from salidas_tanque'),
  combustible_periodos: await sql('select * from combustible_periodos'),
  comb_auditoria_sombra: await sql('select * from comb_auditoria_sombra'),
  unidad_config: await sql('select * from unidad_config'),
  empleados: await sql('select * from empleados'),
  planillas: await sql('select * from planillas'),
  configuracion: await sql('select clave, valor from configuracion'),
}
for (const [k, v] of Object.entries(D)) console.log(`   ${k.padEnd(28)} ${v.length}`)

// ── Servidor local ───────────────────────────────────────────────────────────
const TIPOS = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml' }
const srv = http.createServer((req, res) => {
  const rel = decodeURIComponent(req.url.split('?')[0]).replace(/^\/+/, '') || 'app.html'
  const f = path.join(RAIZ, rel)
  if (!f.startsWith(RAIZ) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); res.end('no'); return }
  res.writeHead(200, { 'Content-Type': TIPOS[path.extname(f)] || 'application/octet-stream' })
  fs.createReadStream(f).pipe(res)
})
await new Promise((r) => srv.listen(0, '127.0.0.1', r))
const BASE = `http://127.0.0.1:${srv.address().port}`
fs.mkdirSync(SALIDA, { recursive: true })

const nav = await chromium.launch({ headless: !VER })
const ctx = await nav.newContext({ viewport: { width: 1480, height: 1100 } })
const pg = await ctx.newPage()
pg.on('pageerror', (e) => console.log('   [error] ' + String(e.message).slice(0, 160)))
pg.on('dialog', async (d) => { console.log('   [aviso] ' + d.message().slice(0, 140)); await d.dismiss() })

// Las consultas NO paginadas se contestan acá; las paginadas ni llegan a la red.
await pg.route('**/auth/v1/**', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: '{}' }))
await pg.route('**/rest/v1/**', (r) => {
  const u = r.request().url()
  const m = /\/rest\/v1\/([a-z_]+)/.exec(u)
  let d = (m && D[m[1]]) || []
  if (m && m[1] === 'configuracion') {
    const mk = /clave=eq\.([a-z_]+)/.exec(u)
    d = mk ? d.filter((x) => x.clave === mk[1]) : d
  }
  const campo = (m && (m[1] === 'gasoil' || m[1] === 'planillas')) ? 'f' : 'fecha'
  const ge = /[?&](?:fecha|f)=gte\.([0-9-]{10})/.exec(u)
  const le = /[?&](?:fecha|f)=lte\.([0-9-]{10})/.exec(u)
  if (ge) d = d.filter((x) => String(x[campo] || '').slice(0, 10) >= ge[1])
  if (le) d = d.filter((x) => String(x[campo] || '').slice(0, 10) <= le[1])
  return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(d) })
})

await pg.goto(`${BASE}/app.html`, { waitUntil: 'domcontentloaded' })
await pg.waitForFunction(() => typeof window.sp === 'function', { timeout: 30000 })
await pg.waitForFunction(() => typeof window.createClient === 'function' || (window.supabase && window.supabase.createClient), { timeout: 30000 })

await pg.evaluate((datos) => {
  const crear = window.createClient || (window.supabase && window.supabase.createClient)
  window.supabase = crear(window.SUPA_URL, window.SUPA_KEY, { auth: { persistSession: false } })
  window.DB_READY = true
  window.SESION = { usuario: 'direccion', rol: 'superadmin', nombre: 'Direccion' }
  const lo = document.getElementById('login-overlay'); if (lo) lo.style.display = 'none'
  window.EMPLEADOS = datos.empleados
  window.REGS = datos.planillas
  window.__DATOS = datos
  // `AC_HIST` lo arma `acCargar` con su propia consulta sin filtro: no se inyecta a mano.

  // ⛔ EL ÚNICO REEMPLAZO: el transporte paginado. Se lee de qué tabla es la consulta
  //    mirando la URL que arma el propio cliente, y se devuelve todo de una.
  window._acPaginar = async function (armar) {
    try {
      const b = armar()
      const url = String((b && (b.url || (b.then && b._url))) || '')
      const m = /\/rest\/v1\/([a-z_]+)/.exec(url)
      const tabla = m ? m[1] : null
      let d = (tabla && window.__DATOS[tabla]) ? window.__DATOS[tabla].slice() : []
      const ge = /[?&](?:fecha|f)=gte\.([0-9-]{10})/.exec(url)
      const le = /[?&](?:fecha|f)=lte\.([0-9-]{10})/.exec(url)
      const campo = (tabla === 'gasoil' || tabla === 'planillas') ? 'f' : 'fecha'
      if (ge) d = d.filter((x) => String(x[campo] || '').slice(0, 10) >= ge[1])
      if (le) d = d.filter((x) => String(x[campo] || '').slice(0, 10) <= le[1])
      return { data: d, error: null }
    } catch (e) { return { data: [], error: { message: e.message } } }
  }
}, D)

await pg.evaluate(([d, h]) => {
  try { aplicarPermisos() } catch (e) {}
  sp('aud-combustible')
  const a = document.getElementById('ac-desde'); if (a) a.value = d
  const b = document.getElementById('ac-hasta'); if (b) b.value = h
}, [DESDE, HASTA])
await pg.evaluate(() => { try { acBuscar() } catch (e) { window.__e = e.message } })

// Se espera el ESTADO DEL MOTOR, no el texto de la pantalla: con el texto se captura
// un informe a medio correr y sale con ceros que parecen reales.
let listo = false
try {
  await pg.waitForFunction(() => (typeof _acCargando !== 'undefined') && _acCargando === false &&
    (window.AC_JORNADAS || []).length > 0 && !!(window.AC_META || {}).desde,
  { timeout: 300000, polling: 1000 })
  listo = true
} catch {
  const e = await pg.evaluate(() => ({ cargando: typeof _acCargando !== 'undefined' ? _acCargando : '?',
    j: (window.AC_JORNADAS || []).length, desde: (window.AC_META || {}).desde || null, err: window.__e || null }))
  console.error('⛔ la auditoría no terminó: ' + JSON.stringify(e))
}
if (!listo) { await nav.close(); srv.close(); process.exit(1) }

const n = await pg.evaluate(() => ({ j: AC_JORNADAS.length, a: AC_ANOM.length, r: (window.REGS || []).length }))
console.log(`\nAuditoría: ${n.j} jornadas · ${n.a} anomalías · ${n.r} planillas`)

const html = await pg.evaluate(() => {
  let cap = null
  const orig = window.abrirVentanaImpresion
  window.abrirVentanaImpresion = (h) => { cap = h }
  try { acImprimirInforme() } catch (e) { return 'ERROR: ' + e.message }
  window.abrirVentanaImpresion = orig
  return cap || '(vacío)'
})
if (!html || /^ERROR|^\(vac/.test(html)) { console.error('⛔ ' + html); await nav.close(); srv.close(); process.exit(1) }

const pg2 = await ctx.newPage()
await pg2.setContent(html, { waitUntil: 'networkidle' })
const pdf = path.join(SALIDA, `Informe de combustible ${DESDE} a ${HASTA}.pdf`)
await pg2.pdf({ path: pdf, format: 'A4', printBackground: true,
  margin: { top: '12mm', bottom: '12mm', left: '10mm', right: '10mm' } })
await pg2.screenshot({ path: path.join(SALIDA, 'informe.png'), fullPage: true })
await nav.close(); srv.close()
console.log(`\n✅ ${pdf}`)
