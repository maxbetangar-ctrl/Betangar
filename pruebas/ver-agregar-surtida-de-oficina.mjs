#!/usr/bin/env node
// ═══════════════════════════════════════════════════════════════════════════════════════════
// «AGREGAR SURTIDA QUE EL CHOFER NO CARGÓ», EN UNA PANTALLA
//
// 🔴 POR QUÉ EXISTE ESTA PANTALLA. Alejandra lo pidió por WhatsApp: la oficina podía CORREGIR
//    los litros de una surtida pero no AGREGAR una que el chofer nunca registró.
//    El caso: el 20/10/2026 la factura de E/S Las Banderas era de **3.000 L** —250 L a cada uno
//    de los 12 camiones— y en el sistema había **9 surtidas, 2.250 L**. Faltaban **750 L de 3
//    choferes**. Esos litros no se veían por ningún lado y el consumo de esas 3 unidades
//    quedaba inflado.
//
// ⚠️ QUÉ NO PRUEBA: no prueba el candado de rol ni los topes. Eso vive en
//    `surtida_agregar_oficina()` del lado del servidor y acá la RPC va interceptada. Esto
//    prueba que la pantalla PIDE lo que tiene que pedir y MANDA lo que tiene que mandar.
//
// Uso:  node pruebas/ver-agregar-surtida-de-oficina.mjs [--ver]
// ═══════════════════════════════════════════════════════════════════════════════════════════
import fs from 'node:fs'
import http from 'node:http'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const PUERTO = Number(process.env.PUERTO_PRUEBA || 8999)

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

const navegador = await pw.chromium.launch({ headless: !process.argv.includes('--ver') })
const page = await (await navegador.newContext({ viewport: { width: 1100, height: 1000 } })).newPage()
const errores = []
page.on('pageerror', (e) => errores.push('pageerror: ' + e.message))
page.on('dialog', (d) => d.accept())

const rpcs = []
await page.route('**/*.supabase.co/**', async (r) => {
  const u = r.request().url()
  if (/\/rpc\//.test(u)) {
    let cuerpo = {}
    try { cuerpo = JSON.parse(r.request().postData() || '{}') } catch (e) {}
    rpcs.push({ nombre: u.split('/rpc/').pop().split('?')[0], cuerpo })
    return r.fulfill({ status: 200, contentType: 'application/json', body: '"JAC-B008-OF-2026-10-20-250-abc123"' })
  }
  return r.fulfill({ status: 200, contentType: 'application/json', body: '[]' })
})
await page.goto(`http://127.0.0.1:${PUERTO}/app.html`, { waitUntil: 'domcontentloaded' })
await page.waitForFunction(() => typeof window.abrirModalSurtidaOficina === 'function', { timeout: 25000 })

let fallos = 0
const ok = (t, c, d) => { if (!c) fallos++; console.log(`${c ? '✅' : '⛔'} ${t}${c ? '' : ' · ' + d}`) }

// ── ⛔ PRIMERO EL CANDADO: sin el permiso, no se abre ────────────────────────────────────────
// Si esto fallara, el resto de la prueba estaría midiendo una pantalla que no debería existir.
const sinPermiso = await page.evaluate(() => {
  const ov = document.getElementById('login-overlay'); if (ov) ov.style.display = 'none'
  window.SESION = { nombre: 'QUIEN SEA', rol: 'mecanico' }
  let aviso = ''
  const o = window.mostrarToast; window.mostrarToast = (t) => { aviso = String(t) }
  window.abrirModalSurtidaOficina()
  window.mostrarToast = o
  return { aviso, hayModal: !!document.getElementById('so-fecha') }
})
ok('sin el permiso NO se abre', !sinPermiso.hayModal && /administraci/i.test(sinPermiso.aviso),
   'se abrió para un rol que no puede: ' + JSON.stringify(sinPermiso))

// ── Con permiso: lo que la pantalla pide ────────────────────────────────────────────────────
const abierto = await page.evaluate(() => {
  window.SESION = { nombre: 'ALEJANDRA DE PRUEBA', rol: 'admin' }
  window.SURT_ADMIN = [
    { id: 'a', fecha: '2026-10-20', cam: 'U01', litros: 250, estacion_nombre: 'E/S Las Banderas', tanque: 'estacion' },
    { id: 'b', fecha: '2026-10-20', cam: 'U02', litros: 250, estacion_nombre: 'E/S Las Banderas', tanque: 'estacion' },
  ]
  window.UNIDADES = [{ cam: 'U01' }, { cam: 'U02' }, { cam: 'U03' }]
  window.COMB_PERIODOS = []
  window.abrirModalSurtidaOficina()
  return {
    campos: ['so-fecha', 'so-cam', 'so-lit', 'so-est', 'so-nota'].filter((x) => !!document.getElementById(x)),
    texto: document.body.innerText,
  }
})
ok('con permiso se abre y pide los 5 datos', abierto.campos.length === 5, 'faltan: ' + abierto.campos.join(','))
ok('dice que queda marcada como de la oficina', /cargada por la oficina/i.test(abierto.texto),
   'sin eso parece una surtida del chofer')

// ── ⛔ LA AYUDA QUE EVITA DUPLICAR ───────────────────────────────────────────────────────────
const ayuda = await page.evaluate(() => {
  document.getElementById('so-fecha').value = '2026-10-20'
  document.getElementById('so-cam').value = 'U01'
  window._soSugerir()
  const a = document.getElementById('so-aviso').innerText
  document.getElementById('so-cam').value = 'U03'
  window._soSugerir()
  return { conU01: a, conU03: document.getElementById('so-aviso').innerText }
})
ok('dice cuántos cargaron ese día y con cuántos litros', /2 unidad/.test(ayuda.conU03) && /250/.test(ayuda.conU03),
   'salió: ' + JSON.stringify(ayuda.conU03))
ok('⛔ avisa si esa unidad YA tiene surtida ese día', /YA tiene/.test(ayuda.conU01),
   'sin ese aviso se duplica la carga: ' + JSON.stringify(ayuda.conU01))
ok('…y NO avisa cuando la unidad no está', !/YA tiene/.test(ayuda.conU03),
   'avisa siempre, o sea que no avisa de nada')

// La captura se toma CON EL MODAL ABIERTO y los campos llenos: una captura del final muestra
// el toast de exito, que es justo lo unico que no hace falta revisar.
await page.evaluate(() => {
  document.getElementById('so-lit').value = '250'
  document.getElementById('so-est').value = 'E/S Las Banderas'
  document.getElementById('so-nota').value = 'Factura E/S Las Banderas 20/10: 3.000 L, 250 por camion a los 12. Este chofer no la cargo.'
})
try { await page.screenshot({ path: path.join(REPO, 'pruebas', '_agregar-surtida-oficina.png') }) } catch (e) {}

// ── ⛔ EL MOTIVO ES OBLIGATORIO ──────────────────────────────────────────────────────────────
// El servidor lo exige igual; acá se avisa ANTES para no hacerle escribir todo de nuevo.
const sinMotivo = await page.evaluate(async () => {
  document.getElementById('so-cam').value = 'U03'
  document.getElementById('so-lit').value = '250'
  document.getElementById('so-nota').value = 'corto'
  let aviso = ''
  const o = window.mostrarToast; window.mostrarToast = (t) => { aviso = String(t) }
  await window._soGuardar()
  window.mostrarToast = o
  return aviso
})
ok('sin motivo NO guarda', /por qu[eé]/i.test(sinMotivo) && rpcs.length === 0,
   'guardó sin explicación: ' + JSON.stringify(sinMotivo))

// ── Con todo, qué manda ─────────────────────────────────────────────────────────────────────
// ⛔ EL CLIENTE SE SUSTITUYE POR UNO QUE HACE LA LLAMADA DE VERDAD, no por uno que devuelve ok.
//    Si el doble solo dijera «salió bien», la prueba no vería QUÉ se manda —que es lo único que
//    importa acá— y pasaría igual con un payload vacío.
//    [[norma-test-que-pasa-por-el-motivo-equivocado]]
await page.evaluate(async () => {
  window.DB_READY = true
  window.supabase = {
    rpc: async (nombre, args) => {
      const r = await fetch('https://prueba.supabase.co/rest/v1/rpc/' + nombre,
        { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(args) })
      return { data: await r.json(), error: null }
    },
  }
  document.getElementById('so-nota').value = 'Factura E/S Las Banderas 20/10: 3.000 L, 250 por camion a los 12. Este no la cargo.'
  document.getElementById('so-est').value = 'E/S Las Banderas'
  await window._soGuardar()
})
await page.waitForTimeout(500)
const envio = rpcs.find((r) => r.nombre === 'surtida_agregar_oficina')
ok('manda la RPC del servidor', !!envio, 'RPCs vistas: ' + rpcs.map((r) => r.nombre).join(', '))
if (envio) {
  const p = envio.cuerpo.p || {}
  ok('manda unidad, fecha y litros', p.cam === 'U03' && p.fecha === '2026-10-20' && Number(p.litros) === 250,
     JSON.stringify([p.cam, p.fecha, p.litros]))
  ok('manda el motivo completo', String(p.nota || '').length > 30, 'mandó: ' + JSON.stringify(p.nota))
  // ⛔ QUIÉN la puso va en el payload: sin eso, la nota dice «por qué» pero no «quién», y una
  //    corrección sin autor no se le puede preguntar a nadie.
  ok('manda QUIÉN la está agregando', /ALEJANDRA/.test(String(p.quien || '')), 'mandó: ' + JSON.stringify(p.quien))
  ok('manda la estación de la factura', p.estacion_nombre === 'E/S Las Banderas', 'mandó: ' + JSON.stringify(p.estacion_nombre))
}
ok('la pantalla no tiró ningún error', errores.length === 0, errores.join(' · '))

const img = path.join(REPO, 'pruebas', '_agregar-surtida-oficina.png')
// ⛔ NO se vuelve a capturar acá: a esta altura el modal ya se cerró y la foto saldría del toast
//    de éxito, que es justo lo único que no hace falta revisar. La buena se tomó más arriba.
console.log('\n📷 ' + img)
console.log('\n' + (fallos === 0 ? '✅ la oficina ya puede poner la surtida que el chofer no cargó' : '⛔ ' + fallos + ' MAL'))
await navegador.close(); srv.close()
process.exit(fallos === 0 ? 0 : 1)
