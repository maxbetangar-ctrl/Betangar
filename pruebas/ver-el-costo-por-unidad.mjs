// ¿EL CENTRO DE COSTOS IMPRIME COSTOS, O SIGUE IMPRIMIENDO KM Y MANTENIMIENTO?
//
// El reporte se mira RENDERIZADO, interceptando la ventana de impresión: lo que
// importa es lo que el PAPEL dibuja, no que la consulta salga en verde.
// [[norma-probar-el-camino-no-la-pieza]]
//
// Uso:  node pruebas/ver-el-costo-por-unidad.mjs [repo]
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
await new Promise((r) => srv.listen(8887, '127.0.0.1', r))
const nav = await pw.chromium.launch({ headless: true })
const page = await (await nav.newContext({ viewport: { width: 1200, height: 1400 } })).newPage()
const avisos = []
page.on('dialog', async (d) => { avisos.push(d.message()); await d.dismiss() })
await page.route('**/*.supabase.co/**', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: '[]' }))
await page.goto('http://127.0.0.1:8887/app.html', { waitUntil: 'domcontentloaded' })
await page.waitForFunction(() => typeof window.imprimirCentroCostos === 'function', { timeout: 25000 })

const r = await page.evaluate(async () => {
  // Las dos unidades: una con km (para que el $/km exista) y otra SIN km, que es
  // el control de que no se inventa un «$0,00/km».
  window.MANTENIMIENTOS = [
    { cam: 'FC01', fecha: '2026-10-05', costo: 320.5, tipoTrabajo: 'reparacion', proveedor: 'Taller A' },
    { cam: 'FC01', fecha: '2026-10-20', costo: 180, tipoTrabajo: 'preventivo', proveedor: 'Taller A' },
    { cam: 'FC09', fecha: '2026-10-11', costo: 95.25, tipoTrabajo: 'cambio', proveedor: 'Taller B' },
    { cam: 'FC01', fecha: '2026-09-02', costo: 999, tipoTrabajo: 'reparacion' },   // FUERA del rango
  ]
  window.INV_MOV = [
    { fecha: '2026-10-07', cam: 'FC01', tipo: 'Uso', precio: 40, cantidad: -2, mantId: '' },     // cuenta: 80
    { fecha: '2026-10-08', cam: 'FC01', tipo: 'Uso', precio: 50, cantidad: -1, mantId: 'M1' },   // NO: ya está en el mantenimiento
    { fecha: '2026-10-09', cam: '', tipo: 'Entrada', precio: 70, cantidad: 3, mantId: '' },      // NO: sin unidad
  ]
  window.DB_READY = true
  const SURT = [
    { fecha: '2026-10-06', cam: 'FC01', litros: 200, costo_usd: 150 },
    { fecha: '2026-10-19', cam: 'FC01', litros: 100, costo_usd: 75 },
    { fecha: '2026-10-21', cam: 'FC09', litros: 80, costo_usd: 60 },
    { fecha: '2026-09-01', cam: 'FC01', litros: 500, costo_usd: 400 },   // FUERA del rango
  ]
  const CK = [
    { cam: 'FC01', km_salida: 10000, km_entrada: 10400 },
    { cam: 'FC01', km_salida: 10400, km_entrada: 10700 },
    { cam: 'FC01', km_salida: 10700, km_entrada: 10650 },   // llegada MENOR: no se cuenta
    { cam: 'FC01', km_salida: 10700, km_entrada: 99999 },   // salto imposible: no se promedia
    { cam: 'FC09', km_salida: 5000, km_entrada: 0 },        // jornada SIN cerrar: FC09 queda sin km
  ]
  window._rpc = async (n) => (n === 'surtidas_listar' ? { data: SURT } : { data: [] })
  window.supabase = { from: () => ({ select: () => ({ gte: () => ({ lte: async () => ({ data: CK }) }) }) }) }
  document.getElementById('cc-rep-desde').value = '2026-10-01'
  document.getElementById('cc-rep-hasta').value = '2026-10-31'
  let out = null
  const orig = window.open
  window.open = function () { return { document: { open () {}, close () {}, write (h) { out = h } }, print () {} } }
  try { await imprimirCentroCostos() } finally { window.open = orig }
  return out
})
if (!r) { console.log('⛔ no se capturó el papel' + (avisos.length ? ` · avisó: ${avisos.join(' | ')}` : '')); await nav.close(); srv.close(); process.exit(1) }
const p2 = await (await nav.newContext({ viewport: { width: 1200, height: 1500 } })).newPage()
await p2.setContent(r, { waitUntil: 'domcontentloaded' })
await p2.waitForTimeout(500)
await p2.screenshot({ path: path.join(REPO, 'pruebas', '_costo-por-unidad.png'), fullPage: true })
const texto = await p2.evaluate(() => document.body.innerText)

// ⛔ CONTROL POSITIVO antes de creerle a cualquier «no aparece»: si el papel no se
//    dibujó, toda negación se cumple sola. [[norma-control-positivo-antes-de-creerle-al-vacio]]
const dibujo = /Costo por unidad/i.test(texto) && /FC01/.test(texto)
const pruebas = [
  ['el papel se dibujó (control positivo)', dibujo],
  ['NO es el reporte de mantenimiento', !/Historial de mantenimiento/i.test(texto)],
  ['dice de qué período habla', /2026|octubre/i.test(texto)],
  ['trae combustible, mantenimiento y repuestos', /Combustible/i.test(texto) && /Mantenim/i.test(texto) && /Repuestos/i.test(texto)],
  // 320,50 + 180 = 500,50 de mantenimiento; el de septiembre NO entra
  ['el mantenimiento del rango suma 500,50', /500,50/.test(texto)],
  ['y deja afuera el de septiembre', !/999/.test(texto)],
  // 150 + 75 = 225 de combustible; 300 L
  ['el combustible de FC01 son $225', /225,00/.test(texto)],
  // repuestos: solo el que NO tiene mantId → 80
  ['los repuestos no se cuentan dos veces ($80)', /80,00/.test(texto)],
  // km de FC01: 400 + 300 = 700 (la llegada menor y el salto imposible quedan afuera)
  ['los km de FC01 son 700', /\b700\b/.test(texto)],
  ['el salto imposible no entró', !/99\.?999/.test(texto) && !/89\.?299/.test(texto)],
  // costo FC01 = 500,50 + 225 + 80 = 805,50 → /km = 1,151
  ['el costo total de FC01 es $805,50', /805,50/.test(texto)],
  ['y su costo por km es $1,151', /1,151/.test(texto)],
  ['FC09 aparece', /FC09|FC-09/.test(texto)],
  // ⛔ FC09 no tiene jornada cerrada: su $/km tiene que ser «—», nunca 0
  ['sin km no inventa un costo por km', !/\$0,000/.test(texto)],
  // ⛔ El $/km del TOTAL no puede incluir el costo de una unidad que no recorrió nada:
  //    FC09 ($155,25 y 0 km) llevaba el total de 1,151 a 1,373 sin haber andado.
  ['el $/km del total no se infla con las unidades sin km', /1,151/.test(texto) && !/1,373/.test(texto)],
  ['y dice cuántas quedaron fuera de ese promedio', /sin jornadas cerradas/i.test(texto)],
  ['dice qué NO incluye y por qué', /gastos variables/i.test(texto) && /sin unidad/i.test(texto)],
  ['nombra que la nómina y los fijos no son de la unidad', /n[óo]mina/i.test(texto)],
  ['no quedó ningún aviso de error', avisos.length === 0],
]
let mal = 0
pruebas.forEach(([t, ok]) => { if (!ok) mal++; console.log(`${ok ? '✅' : '⛔'} ${t}`) })
console.log(mal ? `⛔ ${mal} fallo(s)${avisos.length ? ` · avisó: ${avisos.join(' | ')}` : ''}`
  : '✅ todo verde · captura en pruebas/_costo-por-unidad.png')
await nav.close(); srv.close()
process.exit(mal ? 1 : 0)
