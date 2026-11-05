#!/usr/bin/env node
// ═══════════════════════════════════════════════════════════════════════════════════════════
// VER EN NAVEGADOR los tres arreglos del 04/11/2026 (tarde):
//   1) Retenciones: el mes arranca donde HAY facturas, y un mes vacío lo DICE.
//   2) Personal: quien tiene cargo no cae en «Sin cargo».
//   3) Ficha del empleado: existe el campo «Fecha de Egreso».
//
// ⛔ Los tres son cosas que se VEN. El 04/11 por la mañana una aserción mal escrita dio verde
//    sobre un login que no había pasado, y lo que lo delató fue mirar la captura.
//    [[norma-una-asercion-mal-escrita-acusa-al-producto]] · [[norma-revisar-antes-de-soltar]]
//
// ⛔ QUÉ NO PRUEBA: ni RLS, ni permisos, ni que el guardado entre. Prueba lo que se DIBUJA.
//
// Uso:  node pruebas/ver-arreglos-04-11.mjs [--ver]
// ═══════════════════════════════════════════════════════════════════════════════════════════
import fs from 'node:fs'
import http from 'node:http'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const PUERTO = Number(process.env.PUERTO_PRUEBA || 8981)
const SALIDA = path.join(REPO, 'pruebas')

let playwright
try {
  const g = (await import('node:child_process')).execSync('npm root -g', { encoding: 'utf8' }).trim()
  const mod = await import(pathToFileURL(path.join(g, 'playwright', 'index.js')).href)
  playwright = mod.chromium ? mod : mod.default
  if (!playwright?.chromium) throw new Error('el módulo cargó pero no trae `chromium`')
} catch (e) {
  console.error('⛔ Falta Playwright (está GLOBAL en esta máquina): npm i -g playwright')
  console.error('   Detalle:', e.message); process.exit(1)
}

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.png': 'image/png',
  '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.webmanifest': 'application/manifest+json' }
const servidor = http.createServer((req, res) => {
  const rel = decodeURIComponent(req.url.split('?')[0]).replace(/^\/+/, '') || 'app.html'
  const f = path.join(REPO, rel)
  if (!f.startsWith(REPO) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); res.end('no'); return }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(f).toLowerCase()] || 'application/octet-stream' })
  fs.createReadStream(f).pipe(res)
})
await new Promise((ok, mal) => {
  servidor.once('error', (e) => mal(new Error(`no se pudo abrir el puerto ${PUERTO}: ${e.code}`)))
  servidor.listen(PUERTO, '127.0.0.1', ok)
})

const navegador = await playwright.chromium.launch({ headless: !process.argv.includes('--ver') })
const ctx = await navegador.newContext({ viewport: { width: 1480, height: 1000 } })
const page = await ctx.newPage()
const errores = []
page.on('pageerror', (e) => errores.push('pageerror: ' + e.message))

const SESION = {
  access_token: 'prueba-local', token_type: 'bearer', expires_in: 3600,
  expires_at: Math.floor(Date.now() / 1000) + 3600, refresh_token: 'prueba-local',
  user: { id: '00000000-0000-0000-0000-000000000001', email: 'prueba@betangar.local',
          role: 'authenticated', aud: 'authenticated', app_metadata: {},
          user_metadata: { rol: 'operador', nombre: 'Prueba local', usuario: 'prueba' } },
}
await page.route('**/auth/v1/**', (r) => r.fulfill({ status: 200, contentType: 'application/json',
  body: JSON.stringify(/\/user/.test(r.request().url()) ? SESION.user : SESION) }))

// Datos armados: los MISMOS cargos que en la base real caían fuera de todo grupo.
const EMPLEADOS = [
  { id: 'E001', nombre: 'SAMUEL MENDOZA MENDOZA', cargo: 'Jefe de Operaciones', activo: true },
  { id: 'E002', nombre: 'MAXIMO BETANCOURT', cargo: 'Gerente General', activo: true },
  { id: 'E054', nombre: 'ANA FUENMAYOR', cargo: 'Contadora', activo: true },
  { id: 'E055', nombre: 'ARIANNY MORAN', cargo: 'Auditora', activo: true },
  { id: 'E060', nombre: 'JJGC SOCIO', cargo: 'Socio', activo: true },
  { id: 'E099', nombre: 'FICHA SIN CARGO', cargo: '', activo: true },
  { id: 'E035', nombre: 'LUIS ALEJANDRO FERNANDEZ FERRER', cargo: 'Ayudante', activo: true },
]
await page.route('**/rest/v1/**', (r) => {
  const u = r.request().url()
  const cuerpo = /\/empleados/.test(u) ? EMPLEADOS : []
  // `cxp_facturas` va VACÍA a propósito: es el caso que hizo creer que el módulo no estaba.
  return r.fulfill({ status: 200, contentType: 'application/json',
    headers: { 'Content-Range': `0-0/${cuerpo.length}` }, body: JSON.stringify(cuerpo) })
})

await page.goto(`http://127.0.0.1:${PUERTO}/app.html`, { waitUntil: 'domcontentloaded' })
await page.waitForFunction(() => typeof window.renderRetenciones === 'function', { timeout: 20000 })
await page.fill('#login-user', 'prueba'); await page.fill('#login-pass', 'prueba')
await page.click('button[onclick="doLogin()"]').catch(() => page.keyboard.press('Enter'))
const entro = await page.waitForFunction(() => {
  const o = document.getElementById('login-overlay')
  return !o || getComputedStyle(o).display === 'none'
}, { timeout: 20000 }).then(() => true).catch(() => false)
if (!entro) {
  await page.screenshot({ path: path.join(SALIDA, '_fix-login.png') })
  console.error('⛔ no se pasó el login'); await navegador.close(); servidor.close(); process.exit(1)
}
console.log('✅ entró')

// ── 1) RETENCIONES con CERO facturas: la tabla tiene que DECIRLO ──
await page.evaluate(() => { if (typeof sp === 'function') sp('cxp') })
await page.waitForTimeout(500)
const ret = await page.evaluate(() => {
  try { renderRetenciones() } catch (e) { return { error: e.message } }
  const tb = document.getElementById('tb-ret')
  return { texto: tb ? tb.innerText.replace(/\s+/g, ' ').trim() : null,
           filas: tb ? tb.querySelectorAll('tr').length : 0,
           mes: (document.getElementById('ret-mes') || {}).value }
})
console.log(`\n1) Retenciones · mes=${ret.mes} · filas=${ret.filas}`)
console.log(`   dice: "${(ret.texto || '(NADA — sigue muda)').slice(0, 170)}"`)
const ok1 = !!(ret.texto && /no hay facturas/i.test(ret.texto) && /no es que falte el módulo/i.test(ret.texto))
console.log(ok1 ? '   ✅ un mes sin facturas lo DICE, y explica que el botón va por factura'
                : '   ⛔ la tabla sigue sin explicar el vacío')

// ── 2) PERSONAL: quien tiene cargo NO cae en «Sin cargo» ──
await page.evaluate(() => { if (typeof sp === 'function') sp('empleados') })
await page.waitForTimeout(700)
// ⛔ La primera versión de esta prueba exigía ver «OTROS CARGOS» y daba ROJO con el arreglo
//    puesto: Samuel ya no cae en el cajón de sobras porque ahora está en DIRECCIÓN, que es
//    justo lo que se quería. La aserción medía el parche, no el resultado. Acá se mide lo que
//    importa: a quién rotula «Sin cargo» la pantalla.
//    [[norma-una-asercion-mal-escrita-acusa-al-producto]]
const per = await page.evaluate(() => {
  const t = (document.getElementById('emp-grid') || document.body).innerText
  // ⛔ Anclar en /SIN CARGO/ a secas NO sirve: lo primero que dice la pantalla es el banner
  //    «⚠️ 1 persona activa sin cargo cargado», así que el recorte se llevaba TODO el grid y
  //    daba que Samuel estaba en el cajón estando en Dirección. El ancla es el RÓTULO del
  //    cajón, que lleva su contador: «👤 SIN CARGO (1)».
  const m = t.match(/👤\s*SIN CARGO\s*\(/i)
  const cajon = m ? t.slice(m.index) : ''
  return {
    grid: t.replace(/\s+/g, ' ').slice(0, 320),
    samuelEnCajon: /SAMUEL/i.test(cajon),
    samuelEnDireccion: /DIRECCI[OÓ]N[^]*?SAMUEL/i.test(t),
    contadoraFuera: !/ANA FUENMAYOR/i.test(cajon),
    auditoraFuera: !/ARIANNY/i.test(cajon),
    socioFuera: !/SOCIO/i.test(cajon),
    // La ficha con el cargo VACÍO sí tiene que seguir ahí: es la única a la que el rótulo
    // le dice la verdad.
    vaciaEnCajon: /FICHA SIN CARGO/i.test(cajon),
  }
})
console.log(`\n2) Personal · "${per.grid.slice(0, 200)}"`)
console.log(`   Samuel en Dirección: ${per.samuelEnDireccion} · Samuel rotulado «Sin cargo»: ${per.samuelEnCajon}`)
console.log(`   Contadora/Auditora/Socio fuera del cajón: ${per.contadoraFuera && per.auditoraFuera && per.socioFuera}`)
console.log(`   la ficha con cargo VACÍO sigue en el cajón: ${per.vaciaEnCajon}`)
const ok2 = !per.samuelEnCajon && per.samuelEnDireccion && per.contadoraFuera &&
            per.auditoraFuera && per.socioFuera && per.vaciaEnCajon
console.log(ok2 ? '   ✅ quien tiene cargo ya no sale como «Sin cargo»; el rótulo solo acusa a quien lo tiene vacío'
                : '   ⛔ algún cargo real sigue cayendo en «Sin cargo»')
await page.screenshot({ path: path.join(SALIDA, '_fix-personal.png'), fullPage: false })

// ── 3) La ficha tiene campo de Fecha de Egreso ──
const egr = await page.evaluate(() => {
  const i = document.getElementById('ne-fegreso')
  if (!i) return { existe: false }
  const lbl = i.closest('.fg') ? i.closest('.fg').innerText.trim() : ''
  return { existe: true, tipo: i.type, etiqueta: lbl.replace(/\s+/g, ' ') }
})
console.log(`\n3) Ficha · campo de egreso: ${egr.existe ? `✅ existe (${egr.tipo}) — "${egr.etiqueta}"` : '⛔ NO existe'}`)

const reales = errores.filter((e) => !/rest\/v1|401|406|PGRST|Failed to load/i.test(e))
if (reales.length) { console.log('\n⛔ errores de JS:'); reales.slice(0, 8).forEach((e) => console.log('   ' + e)) }
await navegador.close(); servidor.close()
process.exit(ok1 && ok2 && egr.existe && !reales.length ? 0 : 1)
