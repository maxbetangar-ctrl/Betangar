#!/usr/bin/env node
// ═══════════════════════════════════════════════════════════════════════════════
// EL PDF DEL INFORME DE LLENADO, CON LOS DATOS REALES DE UNA EMPRESA
//
//   node piezas/pdf-llenado.mjs --repo ../tonygas-app --base <ref> \
//        [--desde 2026-10-20] [--hasta 2026-11-08] [--salida <carpeta>]
//
// Sin `--desde`, usa el PISO de esa empresa (`configuracion.llenado_piso_atribucion`);
// sin `--hasta`, hoy.
//
// ⛔ POR QUÉ EXISTE Y NO SE HACE A MANO. El 08/11 armé este PDF con el script de
//    PRUEBA, que usa el fixture ANÓNIMO: salió perfecto —7 páginas, logo,
//    cabecera— diciendo ANA BLANCO y BRUNO CASTRO donde iban los empleados
//    reales. Estaba a un envío de mandarle al dueño un informe de su propio
//    personal con gente inventada.
//    ⇒ Acá los datos salen de la BASE, y al final se comprueba que estén los
//      nombres reales Y que no haya quedado ninguno del fixture. Las dos
//      mitades: la primera sola se cumple por casualidad.
//    [[norma-un-entregable-no-se-arma-con-el-fixture]]
//
// ⛔ Y SE MIRA ANTES DE MANDARLO. Este script deja también un PNG de la primera
//    plana. Un PDF no está revisado hasta que alguien lo vio.
//    [[norma-una-pantalla-se-revisa-en-una-pantalla]]
// ═══════════════════════════════════════════════════════════════════════════════
import fs from 'node:fs'
import os from 'node:os'
import http from 'node:http'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { fileURLToPath, pathToFileURL } from 'node:url'

const AQUI = path.dirname(fileURLToPath(import.meta.url))
const arg = (n, d) => { const i = process.argv.indexOf('--' + n); return i > 0 ? process.argv[i + 1] : d }
const REPO = path.resolve(arg('repo', path.resolve(AQUI, '..')))
const BASE = arg('base')
const SALIDA = arg('salida', path.join(os.homedir(), 'OneDrive', 'Escritorio'))
if (!BASE) { console.error('⛔ falta --base <ref de Supabase>'); process.exit(1) }

const CORRER = path.join(os.homedir(), 'maxware-tools', 'correr-sql.mjs')
const CHROME = ['C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe'].find(p => fs.existsSync(p))
if (!CHROME) { console.error('⛔ no encontré Chrome'); process.exit(1) }

// ⛔ POR ARCHIVO Y CON `--completo`. El informe de una empresa entera pasa
//    largo de lo que `correr-sql` imprime por defecto, y lo RECORTA: el JSON
//    llega partido a la mitad y `JSON.parse` revienta con «Bad control
//    character», que no se parece en nada a «te falta una bandera».
const sql = (q) => {
  const tmp = path.join(os.tmpdir(), `llenado-${process.pid}.sql`)
  fs.writeFileSync(tmp, q, 'utf8')
  try {
    const o = execFileSync('node', [CORRER, BASE, tmp, '--completo'], { encoding: 'utf8', maxBuffer: 256e6 })
    const i = o.indexOf('[')
    if (i < 0) throw new Error(o.slice(0, 400))
    if (/RECORTADO/.test(o)) throw new Error('la salida vino recortada: el informe no entra entero')
    return JSON.parse(o.slice(i))
  } finally { try { fs.unlinkSync(tmp) } catch {} }
}

// Un superadmin de ESA base: la función exige sesión, a propósito.
const uid = (sql(`select auth_user_id::text u from btg_usuarios
  where activo and rol='superadmin' and auth_user_id is not null limit 1`)[0] || {}).u
if (!uid) { console.error('⛔ esa base no tiene un superadmin con auth: no puedo pedirle el informe'); process.exit(1) }

const piso = (sql(`select valor v from configuracion where clave='llenado_piso_atribucion'`)[0] || {}).v
const desde = arg('desde', piso || null)
const hasta = arg('hasta', new Date().toISOString().slice(0, 10))
if (!desde) { console.error('⛔ esa base no tiene piso declarado: pasá --desde'); process.exit(1) }

console.log(`base ${BASE} · ${desde} → ${hasta}${piso && !arg('desde') ? ' (piso de la empresa)' : ''}`)
const datos = sql(`
  set local role authenticated;
  set local request.jwt.claims = '{"sub":"${uid}","role":"authenticated"}';
  select public.btg_informe_llenado(date '${desde}', date '${hasta}') r`)[0].r
if (!datos || datos.vacio) { console.error('⛔ el informe vino vacío:', datos && datos.aviso); process.exit(1) }
const R = datos.resumen || {}
console.log(`  ${R.empleados} empleados · cumple ${R.cumple} · observado ${R.observado} · a corregir ${R.corregir} · sin evaluar ${R.sin_evaluar}`)

// ── Se dibuja con el app.js DE ESE REPO: cada empresa tiene su marca ────────
const { chromium } = await import(pathToFileURL(
  path.join(process.env.APPDATA || '', 'npm', 'node_modules', 'playwright', 'index.mjs')).href)
const TIPOS = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml' }
const srv = http.createServer((q, s) => {
  const rel = decodeURIComponent(q.url.split('?')[0]).replace(/^\/+/, '') || 'app.html'
  const f = path.join(REPO, rel)
  if (!f.startsWith(REPO) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { s.writeHead(404); s.end('no'); return }
  s.writeHead(200, { 'Content-Type': TIPOS[path.extname(f)] || 'application/octet-stream' })
  fs.createReadStream(f).pipe(s)
})
await new Promise(r => srv.listen(0, '127.0.0.1', r))
const URL_LOCAL = `http://127.0.0.1:${srv.address().port}`

const nav = await chromium.launch({ headless: true })
const ctx = await nav.newContext({ viewport: { width: 1400, height: 1000 } })
const pg = await ctx.newPage()
await pg.route('**/auth/v1/**', r => r.fulfill({ status: 200, contentType: 'application/json', body: '{}' }))
await pg.route('**/rest/v1/**', r => r.fulfill({ status: 200, contentType: 'application/json', body: '[]' }))
await pg.route('**/rest/v1/rpc/btg_informe_llenado*', r =>
  r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(datos) }))
await pg.goto(`${URL_LOCAL}/app.html`, { waitUntil: 'domcontentloaded' })
await pg.waitForFunction(() => typeof window.imprimirLlenado === 'function', { timeout: 25000 })
await pg.waitForFunction(() => typeof window.createClient === 'function' ||
  (window.supabase && window.supabase.createClient), { timeout: 25000 })
await pg.evaluate(() => {
  const c = window.createClient || (window.supabase && window.supabase.createClient)
  window.supabase = c(window.SUPA_URL, window.SUPA_KEY, { auth: { persistSession: false } })
  window.DB_READY = true
  window.SESION = { usuario: 'informe', rol: 'superadmin', nombre: 'Informe' }
  const lo = document.getElementById('login-overlay'); if (lo) lo.style.display = 'none'
  window.__papel = ''
  window.open = function () {
    return { document: { open () {}, write (h) { window.__papel += h }, close () {} }, focus () {}, print () {}, closed: false, onload: null }
  }
})
await pg.evaluate(() => { try { aplicarPermisos() } catch (e) {} ; sp('llenado') })
await pg.waitForTimeout(1200)
await pg.evaluate(() => imprimirLlenado())
await pg.waitForTimeout(800)
const papel = await pg.evaluate(() => window.__papel || '')
if (!papel || papel.length < 5000) { console.error('⛔ el papel salió vacío'); await nav.close(); srv.close(); process.exit(1) }

// ── El control de DOS mitades, antes de dejar el archivo ───────────────────
const hoja = await ctx.newPage()
await hoja.setContent(papel, { waitUntil: 'domcontentloaded' })
const leido = await hoja.evaluate(() => document.body.innerText)
const empresa = await hoja.evaluate(() => (document.querySelector('.hdr .empresa .nombre') || {}).textContent || '')
// ⛔ SE COMPARA CON LOS ESPACIOS NORMALIZADOS. En el roster de Tony Gas hay
//    nombres con espacio doble y espacio final («FELIX  ANTONIO GALEA
//    CARRASQUERO »); el HTML los colapsa al dibujar, así que comparar la cadena
//    CRUDA contra el texto RENDERIZADO daba 4 de 12 y frenaba un PDF perfecto.
//    Esto no afloja el control —los nombres siguen teniendo que estar—: arregla
//    una diferencia de formato que no existe en la pantalla.
const esp = (s) => String(s || '').replace(/\s+/g, ' ').trim()
const leidoN = esp(leido)
const nombresReales = (datos.personas || []).slice(0, 12).map(p => esp(p.nombre)).filter(Boolean)
const hayReales = nombresReales.filter(n => leidoN.includes(n)).length
const FIXTURE = ['ANA BLANCO', 'BRUNO CASTRO', 'CARLA DIAZ', 'DIEGO ESPINA', 'ELENA FABRA']
const falsos = FIXTURE.filter(f => leido.includes(f))
const malo = []
if (hayReales < Math.min(5, nombresReales.length)) malo.push(`solo ${hayReales}/${nombresReales.length} nombres reales en el papel`)
if (falsos.length) malo.push(`quedaron nombres del fixture: ${falsos.join(', ')}`)
if (!empresa.trim()) malo.push('el papel no trae el nombre de la empresa')
if (/undefined|NaN|\[object/.test(leido)) malo.push('el papel muestra undefined/NaN')
if (malo.length) { console.error('⛔ NO se genera el PDF:\n   - ' + malo.join('\n   - ')); await nav.close(); srv.close(); process.exit(1) }
console.log(`  ✅ ${hayReales} nombres reales · 0 del fixture · empresa: ${empresa.trim()}`)

await hoja.screenshot({ path: path.join(SALIDA, 'llenado-primera-plana.png') })
await nav.close(); srv.close()

// ── El PDF ──────────────────────────────────────────────────────────────────
fs.mkdirSync(SALIDA, { recursive: true })
const tmpHtml = path.join(SALIDA, '_llenado-tmp.html')
fs.writeFileSync(tmpHtml, papel, 'utf8')
const slug = (empresa.trim() || path.basename(REPO)).replace(/[^A-Za-z0-9]+/g, '-').replace(/^-|-$/g, '')
const PDF = path.join(SALIDA, `${slug}-llenado-${hasta}.pdf`)
execFileSync(CHROME, ['--headless=new', '--disable-gpu', '--no-sandbox',
  `--user-data-dir=${path.join(os.tmpdir(), 'perfil-llenado')}`,
  '--print-to-pdf-no-header', `--print-to-pdf=${PDF}`, pathToFileURL(tmpHtml).href],
  { stdio: 'pipe', timeout: 120000 })
fs.unlinkSync(tmpHtml)
if (!fs.existsSync(PDF)) { console.error('⛔ Chrome no dejó el PDF'); process.exit(1) }
const kb = Math.round(fs.statSync(PDF).size / 1024)
if (kb < 15) { console.error(`⛔ el PDF pesa ${kb} KB: eso es una hoja en blanco`); process.exit(1) }
console.log(`\n✅ ${PDF} (${kb} KB)`)
console.log(`   primera plana: ${path.join(SALIDA, 'llenado-primera-plana.png')}`)
