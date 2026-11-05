#!/usr/bin/env node
// ═══════════════════════════════════════════════════════════════════════════════════════════
// UNA SESIÓN VENCIDA NO PUEDE LEERSE COMO «NO TIENE PERMISO».
//
// ⛔ EL CASO. Carlos Serrano, 05/11/2026, en «Combustible Surtido Hoy»: la lista se veía y al
//    pedir la foto salía *«No se pudo traer la foto: permission denied for function
//    surtida_foto»*. Medido ese día llamando a la base como anónimo:
//      · `surtidas_listar` → P0001 «Sin permiso para ver las surtidas»
//      · `surtida_foto`    → 42501 «permission denied for function surtida_foto»
//    El segundo es textual el de Carlos ⇒ esa llamada llegó SIN SESIÓN. La lista ya estaba
//    dibujada de antes; solo falló lo que se pidió después.
//
//    Un 42501 manda a la persona a pedir un permiso que YA TIENE, y a nosotros a revisar
//    roles que están bien.
//
// ⛔ QUÉ NO PRUEBA: no toca la base ni los permisos. Prueba que `_rpc` distingue los tres
//    casos y que NO miente en el tercero. [[norma-probar-el-camino-no-la-pieza]]
//
// Uso:  node pruebas/ver-sesion-vencida-no-es-falta-de-permiso.mjs
// ═══════════════════════════════════════════════════════════════════════════════════════════
import fs from 'node:fs'
import http from 'node:http'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const PUERTO = Number(process.env.PUERTO_PRUEBA || 8997)
// El error TAL CUAL lo devolvió la base el 05/11/2026.
const ERROR_REAL = { code: '42501', details: null, hint: null, message: 'permission denied for function surtida_foto' }

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
page.on('pageerror', (e) => console.log('   pageerror: ' + e.message))
await page.route('**/*.supabase.co/**', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: '[]' }))

await page.goto(`http://127.0.0.1:${PUERTO}/app.html`, { waitUntil: 'domcontentloaded' })
await page.waitForFunction(() => typeof window._rpc === 'function', { timeout: 25000 })

let fallos = 0
const chequear = (t, ok, d) => { if (!ok) fallos++; console.log(`${ok ? '✅' : '⛔'} ${t}${d ? ' · ' + d : ''}`) }

// Se arma el escenario reemplazando SOLO lo que rodea a `_rpc`: el cliente de base y el de
// identidad. `_rpc` corre tal cual está en el archivo.
const correr = (escenario) => page.evaluate(async (e) => {
  const llamadas = []
  window.DB_READY = true
  window.SESION = e.haySesion ? { usuario: 'carlos', rol: 'superadmin' } : null
  let quedanFallos = e.fallosSeguidos
  window.supabase = {
    rpc: async (nombre, args) => {
      llamadas.push(nombre)
      if (quedanFallos > 0) { quedanFallos--; return { data: null, error: e.error } }
      return { data: 'https://ejemplo/foto.jpg', error: null }
    },
  }
  window.supabaseAuth = {
    auth: {
      getSession: async () => ({ data: { session: e.revive ? { access_token: 'nuevo' } : null } }),
      refreshSession: async () => ({ data: { session: e.revive ? { access_token: 'nuevo' } : null } }),
    },
  }
  const r = await _rpc('surtida_foto', { p_id: 'S1' })
  return { intentos: llamadas.length, data: r.data || null,
           codigo: (r.error && r.error.code) || null, mensaje: (r.error && r.error.message) || null }
}, escenario)

// ── 1 · Sesión viva que solo había que refrescar: se reintenta y sale bien ─────────────────
const a = await correr({ haySesion: true, revive: true, fallosSeguidos: 1, error: ERROR_REAL })
console.log('\n── el token estaba vencido pero el de refresco servía ──')
console.log('   intentos=' + a.intentos + '  data=' + a.data + '  error=' + a.mensaje)
chequear('reintenta UNA vez', a.intentos === 2, a.intentos + ' intentos')
chequear('sale bien y la persona no se entera', a.data === 'https://ejemplo/foto.jpg' && !a.mensaje)

// ── 2 · Sesión muerta de verdad: mensaje humano, NUNCA el de postgres ─────────────────────
const b = await correr({ haySesion: true, revive: false, fallosSeguidos: 9, error: ERROR_REAL })
console.log('\n── la sesión está muerta ──')
console.log('   ' + String(b.mensaje).replace(/\n/g, ' / '))
chequear('dice que la sesión se venció', /sesión se venció/i.test(b.mensaje || ''))
chequear('dice QUÉ hacer', /salga y vuelva a entrar/i.test(b.mensaje || ''))
chequear('aclara que NO es de permisos', /no es un problema de permisos/i.test(b.mensaje || ''))
chequear('NO le muestra el mensaje de postgres', !/permission denied/i.test(b.mensaje || ''), b.mensaje)
chequear('el error original queda para el log', b.codigo === 'SESION_VENCIDA', b.codigo)
chequear('no se queda reintentando para siempre', b.intentos === 1, b.intentos + ' intentos')

// ── 3 · ANTES del login no hay sesión que vencer: el error pasa tal cual ───────────────────
// `marca_publica` y `acceso_recuperar` son anónimas A PROPÓSITO. Decirles «su sesión se
// venció» mandaría a la persona a salir de una pantalla donde todavía no entró.
const c = await correr({ haySesion: false, revive: false, fallosSeguidos: 9, error: ERROR_REAL })
console.log('\n── una llamada anónima de antes del login ──')
console.log('   ' + c.mensaje)
chequear('NO inventa una sesión vencida', !/sesión se venció/i.test(c.mensaje || ''))
chequear('el error llega como vino', c.codigo === '42501', c.codigo)
chequear('ni siquiera intenta revivir nada', c.intentos === 1, c.intentos + ' intentos')

// ── 4 · Un error que NO es de sesión no se disfraza ───────────────────────────────────────
const d = await correr({ haySesion: true, revive: true, fallosSeguidos: 9,
  error: { code: 'P0001', message: 'Sin permiso para ver las surtidas' } })
console.log('\n── un «no tiene permiso» de verdad ──')
console.log('   ' + d.mensaje)
chequear('se respeta el mensaje de la base', /Sin permiso para ver las surtidas/.test(d.mensaje || ''))
chequear('no se reintenta', d.intentos === 1, d.intentos + ' intentos')

await navegador.close(); srv.close()
console.log(`\n${fallos ? '⛔ ' + fallos + ' fallo(s)' : '✅ todo verde'}`)
process.exit(fallos ? 1 : 0)
