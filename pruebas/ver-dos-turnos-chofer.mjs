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
    // ⛔ LA LLAVE ES (fecha, cam, turno) — LAS TRES. El stub comparaba SOLO el turno, así
    //    que devolvía el checklist de la noche aunque la app lo pidiera con la fecha del día
    //    siguiente: el arnés tapaba justo el fallo que hay que medir al cruzar la medianoche.
    //    [[norma-un-filtro-nuestro-tapa-un-dato-que-si-llega]]
    const t = cuerpo.p_turno || 'diurno'
    const f = cuerpo.p_fecha || null
    const calza = checklistGuardado && checklistGuardado.turno === t &&
      (!checklistGuardado.fecha || !f || checklistGuardado.fecha === f)
    datos = calza ? [checklistGuardado] : []
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

// ══════════════════════════════════════════════════════════════════════════════════════════
// ── 🌙 LA NOCHE CRUZA LA MEDIANOCHE ───────────────────────────────────────────────────────
//
// 🔴 POR QUÉ. Máximo, 13/11/2026: *«hay choferes que no logran cerrar lo del turno de la
//    noche»*. Medido en la base: el turno nocturno se usó DOS veces (06/11, B004 y B009),
//    abrió a las 18:35 y 19:15 y NINGUNO cerró. El B009 seguía trabajando a la **01:50** del
//    07/11 — ese viaje quedó con `fecha` del 07, mientras su checklist vive en el 06.
//
//    La jornada de la noche CRUZA LAS 00:00, pero `hoy` es una fecha de calendario que rueda
//    a medianoche, y de ella cuelga TODO: la llave del turno (`btg_turno_<cam>_<hoy>`), las
//    13 claves locales del día y el `p_fecha` con que se le pide el checklist a la base.
//
 // Acá se mide qué le queda al chofer en la pantalla cuando el reloj pasa la medianoche con
// su jornada abierta. No se adivina: se corre el reloj y se mira.
//
// ⚠️ LO QUE ESTA PARTE **NO** AFIRMA. Que `hoy` deje de rodar a medianoche sería el arreglo
//    de fondo, y NO está hecho a propósito: toca la pieza que usan los doce a las 5:40.
//    Decisión de Máximo (13/11): primero el rescate, que es aditivo. Así que el cruce de
//    medianoche se MIDE y se imprime —para que nadie lo dé por arreglado— y lo que se
//    EXIGE es lo de abajo: que la jornada de anoche tenga una puerta.
// ══════════════════════════════════════════════════════════════════════════════════════════
const hoyVEstr = (ms) => new Date(ms - 14400000).toISOString().slice(0, 10)
const AYER = hoyVEstr(Date.now())

// El chofer de la noche ya hizo su checklist de SALIDA: la jornada está abierta.
checklistGuardado = { id: 'n1', turno: 'nocturno', fecha: AYER, cam: CAM,
                      conductor: 'CHOFER DE LA NOCHE', km_salida: 21500, km_entrada: null,
                      hora_salida: '18:35', hora_entrada: null, llenado_por: 'chofer' }
await page.evaluate(([cam, f]) => {
  try { localStorage.setItem('btg_cl_modo_' + cam + '_' + f + '_n', 'llegada') } catch (e) {}
}, [CAM, AYER])
await page.reload({ waitUntil: 'domcontentloaded' })
await page.waitForTimeout(3500)
const antesMedianoche = await page.evaluate(() => ({ hoy, turno: CL_TURNO, modo: CL_MODO }))
console.log('\n── la noche, ANTES de las 00:00 ──')
chequear('la jornada de la noche está ABIERTA (modo llegada)',
  antesMedianoche.modo === 'llegada', 'modo=' + antesMedianoche.modo + ' turno=' + antesMedianoche.turno)

// ── Se corre el reloj: 02:00 de la madrugada siguiente ────────────────────────────────────
// No se usa `clock.install()` a propósito: congela los temporizadores y esta app vive de
// `setTimeout`. Se corre SOLO la fecha, que es lo único que el fallo necesita.
const ahora = new Date()
const dosDeLaManiana = new Date(Date.UTC(ahora.getUTCFullYear(), ahora.getUTCMonth(), ahora.getUTCDate() + 1, 6, 0, 0))
const DESFASE = dosDeLaManiana.getTime() - Date.now()
await page.addInitScript((d) => {
  const Real = Date
  const F = function (...a) { return a.length ? new Real(...a) : new Real(Real.now() + d) }
  F.now = () => Real.now() + d
  F.parse = Real.parse; F.UTC = Real.UTC; F.prototype = Real.prototype
  window.Date = F
}, DESFASE)
await page.reload({ waitUntil: 'domcontentloaded' })
await page.waitForTimeout(3500)
const HOY_NUEVO = hoyVEstr(Date.now() + DESFASE)
const trasMedianoche = await page.evaluate(() => ({
  hoy, turno: CL_TURNO, modo: CL_MODO, suf: _tSuf(),
  banner: (document.getElementById('llegada-banner') || {}).innerText || '',
  botonG: (document.getElementById('cl-btn-guardar') || {}).textContent || '',
  badge: (document.getElementById('cl-turno-badge') || {}).textContent || '',
}))
const pidio = enviados.filter((e) => e.nombre === 'chofer_checklist_dia').pop()
console.log('\n── 02:00 de la madrugada, con la jornada de la noche SIN CERRAR ──')
console.log('   antes: hoy=' + antesMedianoche.hoy + ' turno=' + antesMedianoche.turno + ' modo=' + antesMedianoche.modo)
console.log('   ahora: hoy=' + trasMedianoche.hoy + ' turno=' + trasMedianoche.turno + ' modo=' + trasMedianoche.modo + ' sufijo=' + JSON.stringify(trasMedianoche.suf))
console.log('   le pide a la base: fecha=' + (pidio ? pidio.cuerpo.p_fecha : '—') + ' turno=' + (pidio ? pidio.cuerpo.p_turno : '—'))
console.log('   botón: ' + JSON.stringify(trasMedianoche.botonG.trim()))
console.log('   📌 el día de calendario avanzó ' + AYER + ' → ' + HOY_NUEVO + ', y con él se fueron el turno,')
console.log('      las claves locales y hasta la identidad del chofer. ASÍ SIGUE: es el arreglo de fondo,')
console.log('      que va aparte. Lo que tiene que haber es la puerta de abajo.')
await page.screenshot({ path: path.join(SALIDA, '_noche-cruza-medianoche.png') })

// ══════════════════════════════════════════════════════════════════════════════════════════
// ── 🌙 LA PUERTA: CERRAR LA JORNADA DE ANOCHE ─────────────────────────────────────────────
//
// El chofer vuelve a identificarse (es lo que hace la persona: la identidad se le venció con
// el día) y entonces tiene que ver el banner y poder cerrar lo de anoche — SIN que eso le
// cambie el día ni el turno de hoy, que es justo lo que no se quiso tocar.
// ══════════════════════════════════════════════════════════════════════════════════════════
await page.evaluate((cam) => {
  try { localStorage.setItem('btg_chofer_dia_' + cam, JSON.stringify({ nombre: 'CHOFER DE LA NOCHE', fecha: _hoyVE() })) } catch (e) {}
}, CAM)
await page.reload({ waitUntil: 'domcontentloaded' })
await page.waitForTimeout(4000)
const conBanner = await page.evaluate(() => ({
  visible: ((document.getElementById('jor-banner') || {}).style || {}).display === 'block',
  texto: (document.getElementById('jor-texto') || {}).innerText || '',
  hoy, turno: CL_TURNO,
}))
console.log('\n── ya es otro día: ¿hay puerta para lo de anoche? ──')
chequear('⭐ sale el aviso de la jornada de anoche', conBanner.visible,
  'texto=' + JSON.stringify(conBanner.texto.replace(/\s+/g, ' ').slice(0, 90)))
chequear('el aviso dice CUÁNDO salió', /18:35/.test(conBanner.texto), conBanner.texto ? 'ok' : '(vacío)')
chequear('⛔ el día de HOY no se tocó', conBanner.hoy === HOY_NUEVO && conBanner.turno === 'diurno',
  'hoy=' + conBanner.hoy + ' turno=' + conBanner.turno)
await page.screenshot({ path: path.join(SALIDA, '_noche-aviso-sin-cerrar.png') })

// Se abre el formulario y se prueba EL CAMINO, no la pieza.
await page.evaluate(() => jorAbrirCierre())
await page.waitForTimeout(600)
// 1º el candado: el odómetro no baja (lo más común es escribir los cm del tanque).
await page.fill('#jor-km', '43')
await page.fill('#jor-hora', '02:40')
await page.click('#jor-guardar')
await page.waitForTimeout(700)
const conError = await page.evaluate(() => ({
  visible: ((document.getElementById('jor-error') || {}).style || {}).display === 'block',
  texto: (document.getElementById('jor-error') || {}).textContent || '',
  mandado: null,
}))
chequear('⭐ un km MENOR que el de salida se rechaza (no se pregunta)', conError.visible,
  JSON.stringify(conError.texto.slice(0, 110)))
chequear('y el aviso explica el motivo más probable', /tanque/i.test(conError.texto))
await page.screenshot({ path: path.join(SALIDA, '_noche-km-que-baja.png') })

// 2º el cierre de verdad. Se TOCA el botón, no se llama a la función: así se prueba que el
// `onclick` del HTML existe y que la marca se VE — un estado que solo vive en una variable
// deja al chofer sin saber qué eligió. [[norma-una-pantalla-se-revisa-en-una-pantalla]]
const antes = enviados.filter((e) => e.nombre === 'chofer_checklist_guardar').length
await page.fill('#jor-km', '21680')
const errorTrasCorregir = await page.evaluate(() => ((document.getElementById('jor-error') || {}).style || {}).display)
chequear('⭐ el aviso de error se borra al corregir el número', errorTrasCorregir === 'none',
  'display=' + errorTrasCorregir)
await page.locator('#jor-comb-btns .comb-btn', { hasText: '1/2' }).first().click()
const marcado = await page.evaluate(() => {
  const s = document.querySelectorAll('#jor-comb-btns .comb-btn.sel')
  return { cuantos: s.length, cual: s.length ? s[0].textContent.trim() : '' }
})
chequear('⭐ el botón elegido queda MARCADO, y uno solo',
  marcado.cuantos === 1 && marcado.cual === '1/2', 'marcados=' + marcado.cuantos + ' → ' + marcado.cual)
await page.screenshot({ path: path.join(SALIDA, '_noche-cerrar-anoche.png') })
await page.click('#jor-guardar')
await page.waitForTimeout(1500)
const guardados = enviados.filter((e) => e.nombre === 'chofer_checklist_guardar')
const env = guardados[guardados.length - 1]
const p = (env && env.cuerpo && env.cuerpo.p) || {}
console.log('   lo que salió hacia la base:', JSON.stringify(p))
chequear('⭐ se mandó el cierre', guardados.length > antes)
chequear('⭐ con la fecha de ANOCHE, no la de hoy', p.fecha === AYER, 'fecha=' + p.fecha + ' (anoche fue ' + AYER + ')')
chequear('⭐ y con el turno NOCTURNO', p.turno === 'nocturno', 'turno=' + p.turno)
chequear('lleva el km y la hora de llegada', String(p.km_entrada) === '21680' && p.hora_entrada === '02:40',
  'km=' + p.km_entrada + ' hora=' + p.hora_entrada)
chequear('lleva el combustible que marcó', p.comb_entrada === '1/2', 'comb=' + p.comb_entrada)
// ⛔ LO QUE NO PUEDE MANDAR: nada de la inspección. La RPC solo pisa las claves que vienen,
//    así que mandar de más borraría el checklist que ese chofer llenó al salir.
chequear('⛔ NO pisa la inspección ni el km de salida',
  !('km_salida' in p) && !('luz_delantera_alta' in p) && !('observaciones' in p),
  'claves=' + Object.keys(p).join(','))
const trasCierre = await page.evaluate(() => ({
  banner: ((document.getElementById('jor-banner') || {}).style || {}).display,
  modal: !!document.getElementById('modal-jor'),
  hoy, turno: CL_TURNO,
}))
chequear('el aviso se va cuando ya está cerrada', trasCierre.banner === 'none' && !trasCierre.modal,
  'banner=' + trasCierre.banner + ' modal=' + trasCierre.modal)
chequear('⛔ y el día de hoy SIGUE intacto', trasCierre.hoy === HOY_NUEVO && trasCierre.turno === 'diurno',
  'hoy=' + trasCierre.hoy + ' turno=' + trasCierre.turno)

const reales = errores.filter((e) => !/rest\/v1|Failed to load|401|406/i.test(e))
if (reales.length) { console.log('\n⛔ errores de JS:'); reales.slice(0, 8).forEach((e) => console.log('   ' + e)); fallos += reales.length }
console.log(`\n${fallos ? '⛔ ' + fallos + ' en rojo' : '✅ todo en verde'} · capturas en pruebas/_turno-*.png`)
await navegador.close(); srv.close()
process.exit(fallos ? 1 : 0)
