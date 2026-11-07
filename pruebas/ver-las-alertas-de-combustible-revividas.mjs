// LAS ALERTAS DE COMBUSTIBLE: ¿volvieron a medir, y miden lo que corresponde?
//
// ⛔ Llevaban MUERTAS DESDE EL 23/06/2026 — 8 filas, todas de ese día. No estaban
//    rotas: `ccLitrosCamFecha` leía `gasoil`, cuya última fila es del **02/09**,
//    mientras el combustible por unidad vive en `surtidas` (última: 04/11). Como
//    `real<=0` hacía `return`, ninguna alerta podía dispararse. Leer una fuente
//    vacía se ve exactamente igual que «no hubo nada que avisar».
//
// ⛔ Y LA PREMISA TAMBIÉN ESTABA MAL: comparaba UNA CARGA contra los viajes de UN
//    DÍA. Nadie tanquea todos los días. Medido sobre el 02/11, la regla vieja
//    habría gritado «CRÍTICA, 50 L/viaje» por la B009 y la B011, que en 14 días
//    promedian 20,5 y 22,6 — las dos MÁS eficientes de la flota.
//
// Uso:  node pruebas/ver-las-alertas-de-combustible-revividas.mjs
import fs from 'node:fs'; import http from 'node:http'; import path from 'node:path'; import os from 'node:os'
import { pathToFileURL } from 'node:url'
const REPO = path.join(os.homedir(), process.argv[2] || 'Betangar')
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
await new Promise((r) => srv.listen(8892, '127.0.0.1', r))
const nav = await pw.chromium.launch({ headless: true })
const page = await (await nav.newContext()).newPage()
page.on('dialog', async (d) => { await d.dismiss() })
await page.route('**/*.supabase.co/**', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: '[]' }))
await page.goto('http://127.0.0.1:8892/app.html', { waitUntil: 'domcontentloaded' })
await page.waitForFunction(() => typeof window.checkAlertasCombustible === 'function', { timeout: 25000 })

const r = await page.evaluate(async () => {
  // Datos de los 14 días reales medidos en la base, recortados a lo que importa.
  const CAMS = [
    { id: 'JAC-B003', viajes: 32, lit: 1078 },  // 33,7 L/viaje → CRÍTICA (>32)
    { id: 'JAC-B007', viajes: 33, lit: 1050 },  // 31,8 → advertencia (>27)
    { id: 'JAC-B009', viajes: 37, lit: 760 },   // 20,5 → NADA (la que la regla vieja acusaba)
    { id: 'JAC-B011', viajes: 31, lit: 700 },   // 22,6 → NADA (idem)
    { id: 'JAC-B008', viajes: 32, lit: 0 },     // trabajó y NO cargó → crítica nueva
    { id: 'JAC-B099', viajes: 0, lit: 300 },    // cargó y no trabajó → crítica
  ]
  window.DB_READY = true
  window.COMB_VEHICULOS = CAMS.map((c) => ({ id: c.id, nombre: c.id, activo: true }))
  window.COMB_TANQUES = []; window.COMB_MEDICIONES = []; window.COMB_ALERTAS = []
  window.GASOIL = []
  // Las surtidas, repartidas en 3 cargas dentro de la ventana — como pasa de verdad.
  window.SURTIDAS = []
  CAMS.forEach((c) => {
    if (c.lit <= 0) return
    ;['2026-10-21', '2026-10-27', '2026-11-01'].forEach((f, i) => {
      window.SURTIDAS.push({ fecha: f, cam: c.id, litros: c.lit / 3, anulada: false })
    })
  })
  window.REGS = []
  CAMS.forEach((c) => {
    if (c.viajes <= 0) return
    window.REGS.push({ cam: c.id, f: '2026-11-02', t: c.viajes })
  })
  const insertadas = []
  window.supabase = {
    from: (t) => ({
      select: () => ({ order: () => ({ limit: async () => ({ data: [] }) }), like: async () => ({ data: [] }) }),
      insert: (rows) => { insertadas.push(...rows); return { select: async () => ({ data: rows.map((x, i) => ({ ...x, id: i + 1 })) }) } },
      update: () => ({ eq: async () => ({ data: null }) }),
    }),
  }
  const waEnviados = []
  window.sendWA = (txt) => { waEnviados.push(txt) }
  window.mostrarToast = () => {}
  await checkAlertasCombustible(true)
  return { insertadas, waEnviados }
})

// ── EL CASO DE LOS CLONES: surtidas cargadas y CERO planillas ─────────────────
const sinPlanillas = await page.evaluate(async () => {
  window.COMB_ALERTAS = []
  window.REGS = []   // ← FLOTILLA: su operación son entregas, no planillas
  const insertadas = []
  window.supabase = {
    from: () => ({
      select: () => ({ order: () => ({ limit: async () => ({ data: [] }) }), like: async () => ({ data: [] }) }),
      insert: (rows) => { insertadas.push(...rows); return { select: async () => ({ data: rows }) } },
      update: () => ({ eq: async () => ({ data: null }) }),
    }),
  }
  const waEnviados = []; const log = []
  window.sendWA = (t) => { waEnviados.push(t) }
  const _cl = console.log
  console.log = function () { log.push([].slice.call(arguments).join(' ')); _cl.apply(console, arguments) }
  try { await checkAlertasCombustible(true) } finally { console.log = _cl }
  return { insertadas, waEnviados, log }
})

const porCam = {}
r.insertadas.forEach((a) => { porCam[a.vehiculo_id] = a })
const criticas = r.insertadas.filter((a) => a.severidad === 'critica')

const pruebas = [
  // ⛔ CONTROL POSITIVO: sin alertas, toda negación se cumple sola.
  ['volvió a generar alertas (control positivo)', r.insertadas.length > 0, `generó ${r.insertadas.length}`],
  ['marca la B003, que sí excede', !!porCam['JAC-B003'] && /crítico|critico/i.test(porCam['JAC-B003'].tipo), JSON.stringify(porCam['JAC-B003'] || null)],
  ['y la B007 como advertencia', !!porCam['JAC-B007'] && porCam['JAC-B007'].severidad === 'advertencia'],
  // ⛔ LA CONTRAPRUEBA QUE DEFINE EL ARREGLO: las dos que la regla vieja acusaba.
  ['NO acusa a la B009 (20,5 L/viaje)', !porCam['JAC-B009'], JSON.stringify(porCam['JAC-B009'] || null)],
  ['NO acusa a la B011 (22,6 L/viaje)', !porCam['JAC-B011'], JSON.stringify(porCam['JAC-B011'] || null)],
  // ⛔ El caso que la regla vieja NO MIRABA por hacer `return` en cero litros.
  ['marca la B008: trabajó y no cargó nada', !!porCam['JAC-B008'] && /sin cargar/i.test(porCam['JAC-B008'].tipo), JSON.stringify(porCam['JAC-B008'] || null)],
  ['y dice las dos explicaciones posibles', !!porCam['JAC-B008'] && /no se le est[áa] registrando/i.test(porCam['JAC-B008'].descripcion) && /por fuera/i.test(porCam['JAC-B008'].descripcion)],
  ['marca la que cargó sin viajes', !!porCam['JAC-B099'] && /sin viajes/i.test(porCam['JAC-B099'].tipo)],
  // El texto tiene que decir de qué período habla, o el número no se puede juzgar.
  ['cada alerta dice su período', r.insertadas.every((a) => /del \d/.test(a.descripcion) || /sin viajes en planilla/.test(a.descripcion)), r.insertadas.map((a) => a.descripcion.slice(0, 40)).join(' | ')],
  // ⛔ Y el WhatsApp: solo las críticas, y pocas. Un aviso que llega de a diez no se lee.
  ['solo las críticas mandan WhatsApp', r.waEnviados.length === criticas.length, `wa=${r.waEnviados.length} criticas=${criticas.length}`],
  ['y no son más de 4', r.waEnviados.length <= 4, `wa=${r.waEnviados.length}`],
  // ⛔ EL CANDADO QUE EVITA EL DESASTRE EN LOS CLONES: sin planillas no hay con qué
  //    comparar, y tratar ese vacío como «cero viajes» haría que CADA unidad con
  //    combustible dispare una crítica a los socios. FLOTILLA tiene 0 planillas.
  ['sin planillas NO dispara ninguna alerta por viaje', sinPlanillas.insertadas.length === 0,
    JSON.stringify(sinPlanillas.insertadas.map((a) => a.tipo))],
  ['y tampoco manda WhatsApp', sinPlanillas.waEnviados.length === 0, `wa=${sinPlanillas.waEnviados.length}`],
  ['pero lo DICE en el log, no se calla', /sin planillas/i.test(sinPlanillas.log.join(' ')), sinPlanillas.log.join(' | ')],
]
let mal = 0
pruebas.forEach(([t, ok, det]) => { if (!ok) mal++; console.log(`${ok ? '✅' : '⛔'} ${t}${!ok && det ? `\n     ${det}` : ''}`) })
console.log(mal ? `⛔ ${mal} fallo(s)` : '✅ todo verde')
await nav.close(); srv.close()
process.exit(mal ? 1 : 0)
