// ═══════════════════════════════════════════════════════════════════════════
// EL REPORTE IMPRIMIBLE DEL MAPA, mirado como sale.
//
// Máximo: «poder imprimir el mapa como quedó la ruta en un pdf, sin que salga
// el menú de un lado, sólo la parroquia, en formato profesional, en cualquier
// momento del día por si me piden un reporte».
//
// ⛔ ESTO NO SE PRUEBA MIRANDO EL CSS. Un `@media print` se lee perfecto y
//    produce un papel en blanco: el mapa de Leaflet puede imprimirse con el
//    alto de la pantalla, los mosaicos pueden no estar cargados, y el panel
//    puede sobrevivir por una regla con más peso. Se genera el PDF y se cuenta
//    lo que hay adentro. [[norma-una-pantalla-se-revisa-en-una-pantalla]]
//
// Uso: node pruebas/ver-reporte-del-mapa.mjs
// ═══════════════════════════════════════════════════════════════════════════
const { chromium } = await import(
  'file:///C:/Users/Maxbetangar/AppData/Roaming/npm/node_modules/playwright/index.mjs')
import fs from 'node:fs'
import http from 'node:http'
import path from 'node:path'
import { getPAT } from '../../maxware-tools/pat.mjs'

const RAIZ = 'C:/Users/Maxbetangar/Betangar'
const PUERTO = 8753
const SALIDA = 'pruebas/_reporte-mapa.pdf'

async function sql(q) {
  const pat = await getPAT()
  const r = await fetch('https://api.supabase.com/v1/projects/hrkjddehqnzcqwlkklqm/database/query', {
    method: 'POST', headers: { Authorization: `Bearer ${pat}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: q }),
  })
  if (!r.ok) throw new Error(`SQL ${r.status}`)
  return r.json()
}
const ZONAS = await sql('select * from zonas_mapa(current_date)')
const PARR = await sql('select nombre, es_nuestra, poligono, poligono_zona from parroquias order by nombre')
const CRONO = await sql(`select c.tipo, c.parroquia, c.camiones, c.nota from cronograma_recoleccion c
  where c.dia_semana = extract(dow from current_date)::int
    and c.vigente_desde = (select max(vigente_desde) from cronograma_recoleccion
                            where dia_semana = extract(dow from current_date)::int)`)
const DEL_DIA = CRONO.filter((c) => c.parroquia).map((c) => c.parroquia.replace('Parroquia ', ''))

const tipos = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon' }
const srv = http.createServer((q, r) => {
  const f = path.join(RAIZ, decodeURIComponent(q.url.split('?')[0]).replace(/^\/+/, '') || 'mapa.html')
  if (!fs.existsSync(f) || fs.statSync(f).isDirectory()) { r.writeHead(404); return r.end('no') }
  r.writeHead(200, { 'content-type': tipos[path.extname(f)] || 'application/octet-stream' })
  fs.createReadStream(f).pipe(r)
}).listen(PUERTO)

const sesion = { access_token: 'p', token_type: 'bearer', expires_in: 3600,
  expires_at: Math.floor(Date.now() / 1000) + 3600, refresh_token: 'p',
  user: { id: '00000000-0000-0000-0000-000000000001', email: 'p@b', role: 'authenticated', aud: 'authenticated', app_metadata: {}, user_metadata: {} } }

const nav = await chromium.launch()
const ctx = await nav.newContext({ viewport: { width: 1500, height: 950 }, colorScheme: 'light' })
await ctx.addInitScript((s) => {
  try { localStorage.setItem('btg_mapa_zona', '1'); localStorage.setItem('btg-mapa-fondo', 'calles') } catch (e) {}
  // ⛔ `window.print()` en headless abre un diálogo que nunca vuelve y cuelga la
  //    prueba. Se anula y el PDF lo genera Playwright con el mismo CSS de
  //    impresión — que es exactamente lo que el navegador le daría a la
  //    impresora.
  window.print = function () { window.__imprimio = true }
  let g
  Object.defineProperty(window, 'supabase', { configurable: true, get() { return g },
    set(v) { if (v && v.createClient && !v.__p) { const o = v.createClient.bind(v)
        v.createClient = (...a) => { const c = o(...a)
          c.auth.getSession = async () => ({ data: { session: s }, error: null })
          c.auth.getUser = async () => ({ data: { user: s.user }, error: null })
          c.auth.onAuthStateChange = () => ({ data: { subscription: { unsubscribe() {} } } })
          return c }
        v.__p = true } g = v } })
}, sesion)
const p = await ctx.newPage()
const err = []
p.on('pageerror', (e) => err.push(String(e)))
await p.route('**/auth/v1/**', (r) => r.fulfill({ status: 200, contentType: 'application/json',
  body: JSON.stringify(/\/user/.test(r.request().url()) ? sesion.user : sesion) }))
await p.route('**/rest/v1/**', (r) => {
  const u = r.request().url()
  const dar = (d) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(d) })
  if (u.includes('/rpc/zonas_mapa')) return dar(ZONAS)
  if (u.includes('/rpc/app_rol')) return dar('superadmin')
  if (u.includes('/rpc/cronograma_del_dia')) return dar(CRONO)
  if (u.includes('/parroquias')) return dar(PARR)
  return dar([])
})
await p.goto(`http://127.0.0.1:${PUERTO}/mapa.html`, { waitUntil: 'networkidle' })
await p.waitForTimeout(2500)

// Se aprieta como lo apretaria una persona: PRIMERO se abre el desplegable.
// El boton vive dentro de <details> «Herramientas» y nace cerrado — la prueba
// lo dijo: «element is not visible». Hacer clic por JS sin abrirlo probaria
// una pieza que un usuario no puede alcanzar.
await p.click('.flot summary:has-text("Herramientas")')
await p.waitForTimeout(350)
await p.click('#bReporte')
await p.waitForTimeout(1800)

let fallos = 0
const llamo = await p.evaluate(() => !!window.__imprimio)
console.log(llamo ? '✅ el botón pide imprimir' : '⛔ el botón no llegó a pedir impresión')
if (!llamo) fallos++

// ── Lo que tiene que decir la cabecera ──────────────────────────────────────
const cab = await p.evaluate(() => ({
  parr: (document.getElementById('repParr') || {}).textContent || '',
  dia: (document.getElementById('repDia') || {}).textContent || '',
  hora: (document.getElementById('repHora') || {}).textContent || '',
  pie: (document.getElementById('repPie') || {}).textContent || '',
}))
console.log(`  Parroquia: «${cab.parr}» · Día: «${cab.dia}» · Generado: «${cab.hora}»`)
const falta = []
if (DEL_DIA.length && !DEL_DIA.every((x) => cab.parr.includes(x))) falta.push('la parroquia del día')
if (!/^\d{2}\/\d{2}\/\d{4}$/.test(cab.dia.trim())) falta.push('la fecha en dd/mm/aaaa')
if (!/^\d{2}:\d{2}/.test(cab.hora.trim())) falta.push('la hora')
if (!/GPS/.test(cab.pie)) falta.push('la fuente en el pie')
if (falta.length) { console.log('⛔ a la cabecera le falta: ' + falta.join(' · ')); fallos++ }
else console.log('✅ la cabecera dice parroquia, fecha, hora y fuente')

// ── Y lo que de verdad se imprime ───────────────────────────────────────────
await p.emulateMedia({ media: 'print' })
await p.waitForTimeout(900)
const enPapel = await p.evaluate(() => {
  const ver = (sel) => { const e = document.querySelector(sel); if (!e) return false
    const c = getComputedStyle(e); return c.display !== 'none' && c.visibility !== 'hidden' }
  const m = document.getElementById('mapa').getBoundingClientRect()
  let tope = -1e9
  document.querySelectorAll('#mapa .leaflet-tile-loaded').forEach((t) => {
    const b = t.getBoundingClientRect(); if (b.bottom > tope) tope = b.bottom
  })
  return { panel: ver('#panel'), cabeceraApp: ver('header'), menus: ver('.flotantes'),
    repCab: ver('#repCab'), repPie: ver('#repPie'),
    mapaAlto: Math.round(m.height),
    huecoAbajo: tope > -1e8 ? Math.round(m.bottom - tope) : null }
})
console.log('  En papel:', enPapel)
const mal = []
if (enPapel.panel) mal.push('el panel de unidades sigue saliendo')
if (enPapel.cabeceraApp) mal.push('la barra de la app sigue saliendo')
if (enPapel.menus) mal.push('los menús flotantes siguen saliendo')
if (!enPapel.repCab) mal.push('no sale la cabecera del reporte')
if (!enPapel.repPie) mal.push('no sale el pie')
if (enPapel.mapaAlto < 300) mal.push(`el mapa queda en ${enPapel.mapaAlto} px`)
if (enPapel.huecoAbajo === null || enPapel.huecoAbajo > 12) mal.push(`quedan ${enPapel.huecoAbajo} px sin mosaico`)
if (mal.length) { console.log('⛔ ' + mal.join(' · ')); fallos++ }
else console.log('✅ en papel: sin panel, sin barra, sin menús, con cabecera y pie, y el mapa cubierto')

// Una captura con el CSS de impresion puesto: el PDF no se puede mirar desde
// aca, pero esto es lo mismo que va a la pagina.
await p.setViewportSize({ width: 1123, height: 794 })
await p.waitForTimeout(600)
await p.screenshot({ path: 'pruebas/_reporte-mapa.png' })

await p.pdf({ path: SALIDA, format: 'A4', landscape: true, printBackground: true, preferCSSPageSize: true })
const bytes = fs.readFileSync(SALIDA)
const pags = (bytes.toString('latin1').match(/\/Type\s*\/Page[^s]/g) || []).length
console.log(`\n${SALIDA} · ${pags} página(s) · ${(bytes.length / 1048576).toFixed(2)} MB`)
if (pags !== 1) { console.log(`⛔ el reporte debería ser UNA página y salieron ${pags}`); fallos++ }

if (err.length) { console.log('⛔ errores de JS: ' + err.slice(0, 3).join(' | ')); fallos++ }
console.log(fallos ? `\n⛔ ${fallos} fallo(s)` : '\n✅ el reporte sale como tiene que salir')
await nav.close(); srv.close()
process.exit(fallos ? 1 : 0)
