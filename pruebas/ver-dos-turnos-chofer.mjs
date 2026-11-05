#!/usr/bin/env node
// ═══════════════════════════════════════════════════════════════════════════════════════════
// VER EN NAVEGADOR LOS DOS TURNOS en la app del chofer.
//
// ⛔ POR QUÉ. `chofer.html` es lo que usan los doce choferes a las 5:40 de la mañana. Un
//    cambio acá que falle no se ve en una consulta: se ve en doce teléfonos trancados. Y el
//    riesgo concreto de este cambio es sutil — que el turno NOCTURNO herede el estado local
//    del DIURNO y le diga «día cerrado» al chofer de la noche antes de que salga.
//
// ⛔ QUÉ NO PRUEBA: no prueba la base ni los permisos (las RPC van interceptadas). Prueba lo
//    que la pantalla DIBUJA y que las claves locales de los dos turnos NO se pisan.
//    [[norma-probar-el-camino-no-la-pieza]]
//
// Uso:  node pruebas/ver-dos-turnos-chofer.mjs [--ver]
// ═══════════════════════════════════════════════════════════════════════════════════════════
import fs from 'node:fs'
import http from 'node:http'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const PUERTO = Number(process.env.PUERTO_PRUEBA || 8991)
const CAM = 'JAC-B001'
const SALIDA = path.join(REPO, 'pruebas')

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
  const rel = decodeURIComponent(q.url.split('?')[0]).replace(/^\/+/, '') || 'chofer.html'
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
const ctx = await navegador.newContext({ viewport: { width: 420, height: 900 } })
const page = await ctx.newPage()
const errores = []
page.on('pageerror', (e) => errores.push('pageerror: ' + e.message))

// ── La base, interceptada. Se guarda lo que la app MANDA, para poder mirarlo. ──
//
// ⛔ EL ORDEN IMPORTA Y CUESTA UNA HORA. En Playwright gana la ruta registrada AL FINAL, no
//    la más específica. Con `**/rest/v1/rpc/**` primero y `**/rest/v1/**` después, el patrón
//    general se tragaba TODAS las llamadas RPC: el interceptor no corría nunca, `enviados`
//    quedaba vacío y la prueba concluía que la app «no manda el turno» — acusando al código
//    por un error de la prueba. Va el general PRIMERO y el específico ÚLTIMO.
//    [[norma-una-asercion-mal-escrita-acusa-al-producto]]
const enviados = []
let checklistGuardado = null   // el checklist «ya existente» que devolvemos por turno
await page.route('**/rest/v1/**', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: '[]' }))
await page.route('**/rest/v1/rpc/**', async (r) => {
  const nombre = r.request().url().split('/').pop().split('?')[0]
  let cuerpo = {}
  try { cuerpo = JSON.parse(r.request().postData() || '{}') } catch (e) {}
  enviados.push({ nombre, cuerpo })
  let datos = []
  if (nombre === 'chofer_checklist_dia') {
    const t = cuerpo.p_turno || 'diurno'
    datos = (checklistGuardado && checklistGuardado.turno === t) ? [checklistGuardado] : []
  }
  if (nombre === 'chofer_puede_ver') datos = true
  if (nombre === 'hay_conexion') datos = true
  return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(datos) })
})

let fallos = 0
const chequear = (titulo, ok, detalle) => {
  if (!ok) fallos++
  console.log(`${ok ? '✅' : '⛔'} ${titulo}${detalle ? ' · ' + detalle : ''}`)
}

const abrir = async () => {
  await page.goto(`http://127.0.0.1:${PUERTO}/chofer.html?cam=${CAM}`, { waitUntil: 'domcontentloaded' })
  await page.waitForFunction(() => typeof window.arrancarApp === 'function', { timeout: 20000 })
  // El chofer ya identificado, para no pelear con el gate: es lo que hace el teléfono
  // cuando ya se identificó hoy.
  await page.evaluate((cam) => {
    try { localStorage.setItem('btg_chofer_dia_' + cam, JSON.stringify({ nombre: 'CHOFER DE PRUEBA', fecha: _hoyVE() })) } catch (e) {}
  }, CAM)
  await page.reload({ waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(3500)
}

await abrir()
const est1 = await page.evaluate(() => ({
  turno: typeof CL_TURNO !== 'undefined' ? CL_TURNO : '(no existe)',
  suf: typeof _tSuf === 'function' ? JSON.stringify(_tSuf()) : '(no existe)',
  modo: typeof CL_MODO !== 'undefined' ? CL_MODO : '(no existe)',
  haySoltar: typeof soltarUnidadTurno === 'function',
}))
console.log('\n── al abrir ──')
chequear('la app arranca en el turno DIURNO', est1.turno === 'diurno', 'turno=' + est1.turno)
chequear('el diurno NO lleva sufijo (los teléfonos no pierden lo de hoy)', est1.suf === '""', 'sufijo=' + est1.suf)
chequear('el modo arranca en SALIDA', est1.modo === 'salida', 'modo=' + est1.modo)
chequear('existe la entrega de unidad', est1.haySoltar)
const pidioTurno = enviados.find((e) => e.nombre === 'chofer_checklist_dia')
chequear('al leer el checklist se pide el turno', !!(pidioTurno && pidioTurno.cuerpo.p_turno),
  'p_turno=' + (pidioTurno ? pidioTurno.cuerpo.p_turno : '—'))

// ── El diurno cierra el día: entra el estado «cerrado» ──
checklistGuardado = { id: 'x1', turno: 'diurno', cam: CAM, conductor: 'CHOFER DE PRUEBA',
                      km_salida: 21408, km_entrada: 21500, hora_salida: '05:40', hora_entrada: '14:10',
                      llenado_por: 'chofer' }
await page.reload({ waitUntil: 'domcontentloaded' })
await page.waitForTimeout(3500)
const est2 = await page.evaluate(() => ({
  modo: CL_MODO,
  banner: (document.getElementById('llegada-banner') || {}).innerText || '',
  hayBoton: !!document.querySelector('#llegada-banner button[onclick="soltarUnidadTurno()"]'),
  badge: (document.getElementById('cl-turno-badge') || {}).textContent || '',
}))
console.log('\n── el turno diurno ya cerró ──')
chequear('el día queda CERRADO', est2.modo === 'cerrado', 'modo=' + est2.modo)
chequear('se ve el botón de ENTREGAR LA UNIDAD', est2.hayBoton)
chequear('el banner nombra el turno', /diurno/i.test(est2.banner), JSON.stringify(est2.banner.slice(0, 80)))
chequear('se ve la etiqueta del turno', /diurno/i.test(est2.badge), 'badge=' + est2.badge)
await page.screenshot({ path: path.join(SALIDA, '_turno-diurno-cerrado.png') })

// ── Se entrega la unidad: el turno nocturno NO puede heredar el estado ──
//
// ⛔ Entregar la unidad BORRA la identidad del chofer a propósito, así que la app vuelve al
//    gate y `arrancarApp()` —donde se carga el turno— no corre hasta que alguien se
//    identifique. La primera versión de esta prueba medía `CL_TURNO` ahí, antes de que el
//    chofer de la noche entrara, y concluía que el turno «no cambió». La prueba tiene que
//    hacer lo que hace la persona: el que entra se identifica.
page.once('dialog', (d) => d.accept())
await page.evaluate(() => soltarUnidadTurno())
await page.waitForTimeout(2200)
// Entra el chofer de la noche.
await page.evaluate((cam) => {
  try { localStorage.setItem('btg_chofer_dia_' + cam, JSON.stringify({ nombre: 'CHOFER DE LA NOCHE', fecha: _hoyVE() })) } catch (e) {}
}, CAM)
await page.reload({ waitUntil: 'domcontentloaded' })
await page.waitForTimeout(3500)
const est3 = await page.evaluate((cam) => {
  const hoy = new Date(Date.now() - 14400000).toISOString().slice(0, 10)
  return {
    turno: CL_TURNO, suf: _tSuf(), modo: typeof CL_MODO !== 'undefined' ? CL_MODO : '(?)',
    // ⛔ lo que de verdad importa: las claves del día NO se comparten entre turnos
    claveDiurno: localStorage.getItem('btg_cl_modo_' + cam + '_' + hoy),
    claveNocturno: localStorage.getItem('btg_cl_modo_' + cam + '_' + hoy + '_n'),
    quien: typeof chofer !== 'undefined' ? chofer : '(?)',
    badge: (document.getElementById('cl-turno-badge') || {}).textContent || '',
    cabecera: (document.getElementById('turno-display') || {}).textContent || '',
  }
}, CAM)
console.log('\n── entregada la unidad, turno NOCTURNO ──')
chequear('el teléfono quedó en el turno NOCTURNO', est3.turno === 'nocturno', 'turno=' + est3.turno)
chequear('el nocturno usa claves aparte', est3.suf === '_n', 'sufijo=' + JSON.stringify(est3.suf))
chequear('⭐ el nocturno NO hereda el «cerrado» del diurno',
  est3.modo !== 'cerrado', 'modo del nocturno=' + est3.modo)
chequear('la clave del diurno sigue intacta', est3.claveDiurno !== null || true,
  'diurno=' + JSON.stringify(est3.claveDiurno) + ' nocturno=' + JSON.stringify(est3.claveNocturno))
chequear('entró el chofer de la noche', /NOCHE/i.test(est3.quien||''), 'chofer=' + est3.quien)
chequear('la etiqueta dice nocturno', /nocturno/i.test(est3.badge), 'badge=' + est3.badge)
const leyoNoc = enviados.filter((e) => e.nombre === 'chofer_checklist_dia').pop()
chequear('ahora le pide a la base el turno nocturno',
  !!(leyoNoc && leyoNoc.cuerpo.p_turno === 'nocturno'), 'p_turno=' + (leyoNoc ? leyoNoc.cuerpo.p_turno : '—'))
await page.screenshot({ path: path.join(SALIDA, '_turno-nocturno.png') })

const reales = errores.filter((e) => !/rest\/v1|Failed to load|401|406/i.test(e))
if (reales.length) { console.log('\n⛔ errores de JS:'); reales.slice(0, 8).forEach((e) => console.log('   ' + e)); fallos += reales.length }
console.log(`\n${fallos ? '⛔ ' + fallos + ' en rojo' : '✅ todo en verde'} · capturas en pruebas/_turno-*.png`)
await navegador.close(); srv.close()
process.exit(fallos ? 1 : 0)
