// ¿EL AVISO DE QUE NO PUDO ENTRAR SE ENTIENDE, Y DICE QUÉ HACER?
//
// ⛔ 07/11/2026 — Gladis: «No pude entrar» · «Dice mensaje invalido». Lo que la
//    pantalla mostraba era «No se pudo entrar: Invalid login credentials», el texto
//    crudo de Supabase EN INGLÉS. Ella lo tradujo como pudo y con eso no se podía
//    saber si falló el usuario, la clave o el rol.
// ⛔ Y su causa real, medida: pidió la clave TRES VECES en menos de dos minutos
//    (`acceso_recuperacion`, 10:00:57 · 10:01:55 · 10:02:41). Cada pedido genera una
//    clave nueva y PISA la anterior. Usó una de las dos primeras.
//
// Uso:  node pruebas/ver-el-error-de-entrar-en-castellano.mjs [repo]
import fs from 'node:fs'; import http from 'node:http'; import path from 'node:path'; import os from 'node:os'
import { pathToFileURL } from 'node:url'
const REPO = path.join(os.homedir(), process.argv[2] || 'flotilla-app')
const g = (await import('node:child_process')).execSync('npm root -g', { encoding: 'utf8' }).trim()
const mod = await import(pathToFileURL(path.join(g, 'playwright', 'index.js')).href)
const pw = mod.chromium ? mod : mod.default
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css' }
const srv = http.createServer((q, s) => {
  const rel = decodeURIComponent(q.url.split('?')[0]).replace(/^\/+/, '') || 'app.html'
  const f = path.join(REPO, rel)
  if (!fs.existsSync(f) || fs.statSync(f).isDirectory()) { s.writeHead(404); s.end('no'); return }
  s.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream' })
  fs.createReadStream(f).pipe(s)
})
await new Promise((r) => srv.listen(8890, '127.0.0.1', r))
const nav = await pw.chromium.launch({ headless: true })
const page = await (await nav.newContext()).newPage()
page.on('dialog', async (d) => { await d.dismiss() })
await page.route('**/*.supabase.co/**', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: '[]' }))
await page.goto('http://127.0.0.1:8890/app.html', { waitUntil: 'domcontentloaded' })
await page.waitForFunction(() => typeof window._authEnCastellano === 'function', { timeout: 25000 })

const r = await page.evaluate(() => ({
  credenciales: _authEnCastellano('Invalid login credentials'),
  sinConfirmar: _authEnCastellano('Email not confirmed'),
  demasiados: _authEnCastellano('Too many requests'),
  red: _authEnCastellano('Failed to fetch'),
  noExiste: _authEnCastellano('User not found'),
  raro: _authEnCastellano('Weird backend explosion 500'),
}))

const pruebas = [
  ['la función existe (control positivo)', typeof r.credenciales === 'string' && r.credenciales.length > 10],
  ['el caso de Gladis ya no sale en inglés', !/Invalid login credentials/i.test(r.credenciales), r.credenciales],
  ['y dice usuario o clave incorrectos', /Usuario o clave incorrectos/i.test(r.credenciales)],
  // ⛔ Lo que de verdad la habría destrabado: que solo sirve la ÚLTIMA clave.
  ['avisa que solo sirve la ÚLTIMA clave provisional', /ÚLTIMO mensaje/i.test(r.credenciales) && /anula/i.test(r.credenciales), r.credenciales],
  ['la cuenta sin confirmar se explica', /no está confirmada/i.test(r.sinConfirmar) && !/Email not confirmed/.test(r.sinConfirmar)],
  ['el exceso de intentos dice cuánto esperar', /Espere un minuto/i.test(r.demasiados)],
  ['la falta de red no culpa a la clave', /conexi[óo]n/i.test(r.red) && !/clave/i.test(r.red), r.red],
  ['el usuario inexistente se nombra como tal', /No existe una cuenta/i.test(r.noExiste)],
  // ⛔ Lo desconocido NO se disfraza: un mensaje inventado manda a buscar el
  //    problema donde no está.
  ['un error desconocido se muestra tal cual', /Weird backend explosion 500/.test(r.raro), r.raro],
]
let mal = 0
pruebas.forEach(([t, ok, det]) => { if (!ok) mal++; console.log(`${ok ? '✅' : '⛔'} ${t}${!ok && det ? `\n     ${det}` : ''}`) })
console.log(mal ? `⛔ ${mal} fallo(s)` : '✅ todo verde')
await nav.close(); srv.close()
process.exit(mal ? 1 : 0)
