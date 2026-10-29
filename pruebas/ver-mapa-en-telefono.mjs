// ═══════════════════════════════════════════════════════════════════════════
// EL MAPA EN UN TELEFONO: cuantos pixeles le quedan DE VERDAD.
//
// Maximo: «desde el celular nunca puedo ver el mapa porque lo del lado
// izquierdo quita toda la vista». Habia una regla para movil desde antes, asi
// que la pregunta no era «existe?» sino CUANTO ALTO le queda al mapa. Medido
// en 390x844: 347 px, el 41%. La cabecera sola se comia 186.
//
// Prueba el CAMINO, no la pieza: abre la manija y exige que el mosaico cubra
// el mapa entero — si no se le avisa a Leaflet del cambio de tamano, quedan
// franjas grises y eso una medicion de altos no lo ve.
//
// Uso: node pruebas/ver-mapa-en-telefono.mjs
// ═══════════════════════════════════════════════════════════════════════════
const { chromium } = await import(
  'file:///C:/Users/Maxbetangar/AppData/Roaming/npm/node_modules/playwright/index.mjs')
import fs from 'node:fs'
import http from 'node:http'
import path from 'node:path'
import { getPAT } from 'file:///C:/Users/Maxbetangar/maxware-tools/pat.mjs'

const RAIZ = 'C:/Users/Maxbetangar/Betangar'
const PUERTO = 8751
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
// Un teléfono de verdad: 390x844 y DPR 3, que es un iPhone/Android comun.
const ctx = await nav.newContext({
  viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true,
})
await ctx.addInitScript((s) => {
  try { localStorage.setItem('btg_mapa_zona', '1'); localStorage.setItem('btg-mapa-fondo', 'calles') } catch (e) {}
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

const m = await p.evaluate(() => {
  const r = (id) => { const e = document.getElementById(id); if (!e) return null
    const b = e.getBoundingClientRect(); return { y: Math.round(b.y), alto: Math.round(b.height), ancho: Math.round(b.width) } }
  return { ventana: [innerWidth, innerHeight], mapa: r('mapa'), panel: r('panel'), cuerpo: r('cuerpo'),
    cabecera: Math.round((document.querySelector('header') || {}).getBoundingClientRect?.().height || 0) }
})
console.log('Teléfono 390x844:')
console.log('  ventana  ', m.ventana.join(' x '))
console.log('  cabecera ', m.cabecera, 'px')
console.log('  MAPA     ', m.mapa ? `${m.mapa.ancho} x ${m.mapa.alto} px (arranca en y=${m.mapa.y})` : 'NO ESTA')
console.log('  panel    ', m.panel ? `${m.panel.ancho} x ${m.panel.alto} px (arranca en y=${m.panel.y})` : 'NO ESTA')
const pct = m.mapa ? Math.round(100 * m.mapa.alto / m.ventana[1]) : 0
console.log(`  → el mapa se lleva el ${pct}% de la pantalla`)
if (pct < 40) console.log('  ⛔ con menos del 40% el mapa no se puede usar')
await p.screenshot({ path: 'C:/Users/Maxbetangar/Betangar/pruebas/_movil-cerrado.png' })

// ── Y que la manija ABRA de verdad, con el mapa reajustandose ──────────────
// Probar el CAMINO, no la pieza: si se abre pero Leaflet no se entera, quedan
// franjas grises donde antes habia mapa.
await p.click('#manija')
await p.waitForTimeout(700)
const m2 = await p.evaluate(() => {
  const r = (id) => { const e = document.getElementById(id); const b = e.getBoundingClientRect();
    return { alto: Math.round(b.height) } }
  // #mapa ES el contenedor de Leaflet (la clase se la pone al elemento que se
  // le pasa), asi que buscar '#mapa .leaflet-container' da null. Lo que hay que
  // medir no es un elemento: es si quedan FRANJAS SIN MOSAICO, que es como se
  // ve un mapa al que no le avisaron que cambio de tamano.
  const caja = document.getElementById('mapa').getBoundingClientRect()
  let tope = -1e9, piso = 1e9
  document.querySelectorAll('#mapa .leaflet-tile-loaded').forEach((t) => {
    const b = t.getBoundingClientRect()
    if (b.bottom > tope) tope = b.bottom
    if (b.top < piso) piso = b.top
  })
  return { panel: r('panel').alto, mapa: r('mapa').alto,
    abierto: document.body.classList.contains('panelAbierto'),
    mosaicos: document.querySelectorAll('#mapa .leaflet-tile-loaded').length,
    huecoAbajo: tope > -1e8 ? Math.round(caja.bottom - tope) : null,
    huecoArriba: piso < 1e8 ? Math.round(piso - caja.top) : null }
})
console.log('Con la manija ABIERTA:')
console.log('  panel', m2.panel, 'px · mapa', m2.mapa, 'px ·', m2.mosaicos, 'mosaicos')
console.log(m2.abierto && m2.panel > 300 ? '  ✅ el panel sube' : '  ⛔ el panel no se abrio')
const hueco = Math.max(m2.huecoAbajo || 0, m2.huecoArriba || 0)
console.log(hueco <= 8
  ? '  ✅ el mosaico cubre el mapa entero: Leaflet se reajusto'
  : '  ⛔ quedan ' + hueco + ' px sin mosaico: a Leaflet no le avisaron del cambio')
await p.screenshot({ path: 'C:/Users/Maxbetangar/Betangar/pruebas/_movil-abierto.png' })
if (err.length) console.log('errores:', err.slice(0, 3))
await nav.close(); srv.close()
