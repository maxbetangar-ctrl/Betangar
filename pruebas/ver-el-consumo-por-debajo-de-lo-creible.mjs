// R4c — ¿LA AUDITORÍA MARCA UN CONSUMO IMPOSIBLEMENTE BAJO?
//
// ⛔ EL CASO, medido el 07/11/2026 sobre la foto que mandó Máximo: JAC-B006 el
//    04/11 salió con 6,0 cm (59,8 L), le cargaron 350,0 L y llegó con 35,0 cm
//    (404,5 L) ⇒ 59,8 + 350 − 404,5 = **5,3 L para 104 km**. Ningún camión de aseo
//    hace eso. Y nada lo marcó: la auditoría solo miraba el consumo ALTO (R4).
//
// ⛔ Y la prueba tiene que medir las DOS caras. Una regla que grita siempre no
//    avisa de nada, así que acá se exige también que un consumo NORMAL y uno ALTO
//    no disparen R4c.  [[norma-un-aviso-que-salta-siempre-no-avisa]]
//
// Uso:  node pruebas/ver-el-consumo-por-debajo-de-lo-creible.mjs [repo]
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
await new Promise((r) => srv.listen(8891, '127.0.0.1', r))
const nav = await pw.chromium.launch({ headless: true })
const page = await (await nav.newContext()).newPage()
page.on('dialog', async (d) => { await d.dismiss() })
await page.route('**/*.supabase.co/**', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: '[]' }))
await page.goto('http://127.0.0.1:8891/app.html', { waitUntil: 'domcontentloaded' })
await page.waitForFunction(() => typeof window._acAnomalias === 'function', { timeout: 25000 })

const r = await page.evaluate(() => {
  // Referencia del propio historial de cada unidad: 2,5 km/L.
  // Para 104 km lo esperado son 41,6 L.
  const ref = {
    'JAC-B006': { fija: true, mediana: 2.5, n: 9 },
    'JAC-B010': { fija: true, mediana: 2.5, n: 9 },
    'JAC-B011': { fija: true, mediana: 2.5, n: 9 },
  }
  const jor = (cam, fecha, km, consumo) => ({ cam, fecha, km, consumo, conf: 'completa', tol: 3, turno: 'diurno' })
  window.AC_JORNADAS = [
    jor('JAC-B006', '2026-11-04', 104, 5.3),    // EL CASO: muy por debajo
    jor('JAC-B010', '2026-11-04', 104, 40),     // normal: no debe sonar
    jor('JAC-B011', '2026-11-04', 104, 95),     // ALTO: es R4, no R4c
  ]
  window.AC_MED = []; window.AC_SURTIDAS = []; window.AC_GASOIL = []
  window.AC_CK = []; window.AC_TANQUES = []; window.AC_SALIDAS_TANQUE = []
  window.AC_META = window.AC_META || {}
  let anom = []
  try { anom = _acAnomalias([], '2026-11-01', '2026-11-30', ref) || [] } catch (e) { return { error: String(e && e.message) } }
  return {
    todas: anom.map((a) => ({ cod: a.cod || a.codigo, cam: a.cam, sev: a.sev || a.severidad, txt: String(a.texto || a.descripcion || ''), tit: String(a.titulo || '') })),
  }
})
if (r.error) { console.log('⛔ reventó: ' + r.error); await nav.close(); srv.close(); process.exit(1) }

const r4c = r.todas.filter((a) => String(a.cod) === 'R4c')
const r4 = r.todas.filter((a) => String(a.cod) === 'R4')
const delCaso = r4c.find((a) => String(a.cam).indexOf('B006') >= 0)

const pruebas = [
  // ⛔ CONTROL POSITIVO: si no salió NINGUNA anomalía, toda negación se cumple sola.
  ['la auditoría devolvió anomalías (control positivo)', r.todas.length > 0, `devolvió ${r.todas.length}`],
  ['marca el caso de la B006', !!delCaso, r4c.map((a) => a.cam).join(',')],
  ['lo llama consumo por debajo de lo creíble', !!delCaso && /por debajo de lo cre[íi]ble/i.test(delCaso.tit), delCaso && delCaso.tit],
  ['dice los litros que figuran y los que tocarían', !!delCaso && /5,3 L/.test(delCaso.txt) && /41,6|41,/.test(delCaso.txt), delCaso && delCaso.txt.slice(0, 180)],
  ['explica que NO es un ahorro', !!delCaso && /no es un ahorro/i.test(delCaso.txt)],
  ['nombra las dos causas probables', !!delCaso && /carga/i.test(delCaso.txt) && /medici[óo]n/i.test(delCaso.txt)],
  // ⛔ LAS DOS CARAS: la regla tiene que CALLAR donde corresponde.
  ['NO suena con un consumo normal', !r4c.some((a) => String(a.cam).indexOf('B010') >= 0), r4c.map((a) => a.cam).join(',')],
  ['NO suena con un consumo ALTO (ese es R4)', !r4c.some((a) => String(a.cam).indexOf('B011') >= 0), r4c.map((a) => a.cam).join(',')],
  ['y R4 sí marca el consumo alto', r4.some((a) => String(a.cam).indexOf('B011') >= 0), r4.map((a) => a.cam).join(',')],
  ['R4 NO se queda con el caso bajo', !r4.some((a) => String(a.cam).indexOf('B006') >= 0), r4.map((a) => a.cam).join(',')],
]
let mal = 0
pruebas.forEach(([t, ok, det]) => { if (!ok) mal++; console.log(`${ok ? '✅' : '⛔'} ${t}${!ok && det ? `\n     ${det}` : ''}`) })
console.log(mal ? `⛔ ${mal} fallo(s)` : '✅ todo verde')
await nav.close(); srv.close()
process.exit(mal ? 1 : 0)
