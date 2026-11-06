// ═══════════════════════════════════════════════════════════════════════════════
// LA CARGA MASIVA DESDE EXCEL, EN UN NAVEGADOR — proveedores y nº de control
//
// 🔴 POR QUÉ EXISTE. Máximo, 05/11/2026: «todo modulo deberia tener su excel y
//    su modulo de carga en batch desde el excel […] para que asi sea
//    automanejable por cada empresa […] y que no siempre dependan de nosotros».
//
// ⛔ POR QUÉ NO ALCANZA CON `test/excel-leer.test.js`. Esa prueba mide la pieza
//    (mapear, cruzar, resumen) con objetos en memoria. Acá se prueba EL CAMINO:
//    un .xlsx de verdad, generado por la MISMA plantilla que baja el cliente,
//    leído por el navegador con el código que está en la pantalla. Una
//    plantilla cuyos encabezados no calzan con su propio importador pasa todas
//    las pruebas de unidad y falla en la primera fila real.
//    [[norma-probar-el-camino-no-la-pieza]]
//
// QUÉ HACE:
//   · Abre el `app.html` DESPLEGADO con el `app.js` + `maxware-excel.js` DE DISCO.
//   · INTERCEPTA todo Supabase: no se lee ni se escribe NADA real.
//   · Siembra proveedores y facturas de verdad (bajadas con el PAT) en memoria.
//   · Genera el .xlsx con la plantilla REAL, lo vuelve a leer, y mide qué
//     decidió el importador — sin dejarlo guardar.
//
// ⛔ QUÉ NO PRUEBA: ni el RLS, ni el guardado. El `upsert` está interceptado a
//    propósito: una prueba que escribe en la base del cliente no es una prueba.
//
// Uso: node scripts/ver-carga-masiva-excel.mjs [--desplegado] [url]
// ═══════════════════════════════════════════════════════════════════════════════
import { pathToFileURL, fileURLToPath } from 'url'
import { readFileSync, mkdirSync } from 'fs'
import { getPAT } from '../../maxware-tools/pat.mjs'

const URL_APP = process.argv.slice(2).find((a) => a.startsWith('http')) || 'https://betangar.com/app.html'
const REF = 'hrkjddehqnzcqwlkklqm'
const RAIZ = new URL('../', import.meta.url)
const GLOBAL = 'C:/Users/Maxbetangar/AppData/Roaming/npm/node_modules/playwright/index.js'

let pw
try { pw = await import('playwright') }
catch {
  try { pw = await import(pathToFileURL(GLOBAL).href) }
  catch { console.error('Falta Playwright:  npm i -g playwright && npx playwright install chromium'); process.exit(1) }
}

const JS_APP = readFileSync(new URL('./app.js', RAIZ), 'utf8')
const JS_XL = readFileSync(new URL('./maxware-excel.js', RAIZ), 'utf8')
if (!JS_APP.includes('_importarControles') || !JS_XL.includes('function cruzar')) {
  console.error('⛔ El código de disco NO trae la carga masiva. Estarías revisando la versión vieja.')
  process.exit(1)
}

// ── Datos REALES, para que la plantilla salga como la del cliente ───────────
const pat = await getPAT()
const sql = async (q) => {
  const r = await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`, {
    method: 'POST', headers: { Authorization: `Bearer ${pat}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: q }),
  })
  if (!r.ok) { console.error('⛔ la base: ' + (await r.text()).slice(0, 200)); process.exit(1) }
  return r.json()
}
const PROV = await sql(`select id, nombre, rif, coalesce(categoria,'') categoria, coalesce(tel,'') tel
                          from proveedores order by nombre limit 40`)
const FACS = await sql(`select f.id, f.fecha, f.nro_factura, coalesce(f.num_control,'') num_control,
                               coalesce(p.razon_social,p.nombre,'') prov_nombre,
                               coalesce(f.base_bs,0) base_bs, coalesce(f.ret_iva_bs,0) ret_iva_bs,
                               coalesce(f.ret_islr_bs,0) ret_islr_bs
                          from cxp_facturas f left join proveedores p on p.id=f.prov_id
                         order by f.fecha`)
const sinControl = FACS.filter((f) => (Number(f.ret_iva_bs) > 0 || Number(f.ret_islr_bs) > 0) && !f.num_control)
console.log(`Datos reales: ${PROV.length} proveedores · ${FACS.length} facturas · ${sinControl.length} sin nº de control\n`)

const chromium = pw.chromium || (pw.default && pw.default.chromium)
const browser = await chromium.launch()
const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, acceptDownloads: true })
const page = await ctx.newPage()
const errores = []
page.on('pageerror', (e) => errores.push('PAGEERROR: ' + e.message))
page.on('console', (m) => { if (m.type() === 'error') errores.push(m.text()) })

const DESPLEGADO = process.argv.includes('--desplegado')
if (!DESPLEGADO) {
  await page.route('**/app.js*', (r) => r.fulfill({ contentType: 'application/javascript', body: JS_APP }))
  await page.route('**/maxware-excel.js*', (r) => r.fulfill({ contentType: 'application/javascript', body: JS_XL }))
} else console.log('⚠️  --desplegado: se mira el código DE LA CALLE.\n')

// ⛔ NADA real sale ni entra.
await page.route('**/*.supabase.co/**', (r) =>
  r.fulfill({ status: 200, contentType: 'application/json', body: '[]' }))

await page.goto(URL_APP, { waitUntil: 'domcontentloaded' })
await page.waitForFunction(() => typeof window.MaxwareExcel === 'object', { timeout: 20000 })

let fallos = 0
const chk = (n, c, d = '') => {
  if (c) console.log('  ✓ ' + n)
  else { console.log('  ✗ ' + n + (d ? '  → ' + d : '')); fallos++ }
}

const out = await page.evaluate(async ([prov, facs]) => {
  const R = { pasos: [] }
  window.PROVEEDORES = prov.map((p) => ({ id: p.id, nombre: p.nombre, rif: p.rif, cat: p.categoria, tel: p.tel }))
  window.CXP_FACTURAS = facs
  window.DB_READY = false
  // Se le roba la confirmación y el guardado: queremos saber QUÉ decidió, no que lo haga.
  let ultimoAviso = ''
  window.alert = (m) => { ultimoAviso = String(m) }
  window.confirm = (m) => { ultimoAviso = String(m); return false }   // ⛔ siempre CANCELA
  window.mostrarToast = () => {}
  window.audit = () => {}

  // El .xlsx se arma con la MISMA plantilla que baja el cliente, interceptando
  // la descarga para quedarnos con los bytes.
  const capturar = async (fn) => {
    let blob = null
    const crear = URL.createObjectURL
    URL.createObjectURL = (b) => { blob = b; return 'blob:fake' }
    const click = HTMLAnchorElement.prototype.click
    HTMLAnchorElement.prototype.click = function () {}
    try { await fn() } finally { URL.createObjectURL = crear; HTMLAnchorElement.prototype.click = click }
    if (!blob) return null
    return new Uint8Array(await blob.arrayBuffer())
  }

  // ── 1. La plantilla de números de control ────────────────────────────────
  const bytes = await capturar(() => window.descargarPlantillaControles())
  R.plantillaBytes = bytes ? bytes.length : 0
  if (bytes) {
    const wb = XLSX.read(bytes, { type: 'array' })
    const hojas = wb.SheetNames
    const ALIAS0 = { nro_factura: ['n_de_factura', 'numero_de_factura', 'factura', 'nro_factura'],
                     num_control: ['n_de_control', 'numero_de_control', 'control', 'n_control'] }
    // La plantilla pone un banner de marca arriba: los encabezados NO estan en
    // la fila 1. Se busca igual que lo hace la app.
    const mz = XLSX.utils.sheet_to_json(wb.Sheets[hojas[0]], { header: 1, defval: '' })
    const iC = window.MaxwareExcel.filaDeEncabezado(mz, ALIAS0)
    R.filaEncabezado = iC + 1
    const cab0 = (mz[iC] || []).map((c) => String(c == null ? '' : c).trim())
    const filas = mz.slice(iC + 1).map((f) => {
      const o = {}; cab0.forEach((h, j) => { if (h) o[h] = f[j] == null ? '' : f[j] }); return o
    }).filter((o) => Object.keys(o).some((k) => String(o[k]).trim() !== ''))
    R.hojas = hojas
    R.filasPlantilla = filas.length
    R.cabeceras = cab0.filter(Boolean)
    // ⛔ LA PRUEBA QUE IMPORTA: ¿su propio importador reconoce esos encabezados?
    const m = window.MaxwareExcel.mapear(filas, ALIAS0, ['nro_factura', 'num_control'])
    R.mapeo = { col: m.col, faltan: m.faltan }
    // Se llena como lo haría administración y se cruza.
    filas.forEach((f, i) => { if (i < 3) f[m.col.num_control] = '00-PRUEBA' + i })
    const delExcel = filas.map((f) => ({
      nro_factura: window.MaxwareExcel.texto(f, m.col, 'nro_factura'),
      num_control: window.MaxwareExcel.texto(f, m.col, 'num_control') }))
    const x = window.MaxwareExcel.cruzar(window.CXP_FACTURAS, delExcel, 'nro_factura', ['num_control'])
    R.cruce = { cambios: x.cambios.length, iguales: x.iguales.length,
                sinCalzar: x.sinCalzar.length, ambiguos: x.ambiguos.length }
    R.resumen = window.MaxwareExcel.resumen(x)
  }

  // ── 2. La plantilla de proveedores, y que su importador la entienda ──────
  const bp = await capturar(() => window.descargarPlantillaProveedores())
  R.provBytes = bp ? bp.length : 0
  if (bp) {
    const wb = XLSX.read(bp, { type: 'array' })
    const ALIASP = { nombre: ['nombre_razon_social', 'nombre', 'razon_social', 'proveedor'], rif: ['rif'] }
    const mz = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, defval: '' })
    const iC = window.MaxwareExcel.filaDeEncabezado(mz, ALIASP)
    const cab0 = (mz[iC] || []).map((c) => String(c == null ? '' : c).trim())
    const filas = mz.slice(iC + 1).map((f) => {
      const o = {}; cab0.forEach((h, j) => { if (h) o[h] = f[j] == null ? '' : f[j] }); return o
    }).filter((o) => Object.keys(o).some((k) => String(o[k]).trim() !== ''))
    R.provHojas = wb.SheetNames
    R.provCabeceras = cab0.filter(Boolean)
    const m = window.MaxwareExcel.mapear(filas, ALIASP, ['nombre'])
    R.provMapeo = { col: m.col, faltan: m.faltan }
  }
  R.ultimoAviso = ultimoAviso
  return R
}, [PROV, FACS])

console.log('PLANTILLA DE NÚMEROS DE CONTROL')
chk('se genera el .xlsx', out.plantillaBytes > 0, out.plantillaBytes + ' bytes')
chk('trae la hoja de Instrucciones', (out.hojas || []).includes('Instrucciones'), JSON.stringify(out.hojas))
chk('trae SOLO las que faltan (' + sinControl.length + ')', out.filasPlantilla === sinControl.length,
    out.filasPlantilla + ' filas en la hoja')
chk('⛔ su propio importador reconoce los encabezados', (out.mapeo || {}).faltan && out.mapeo.faltan.length === 0,
    JSON.stringify(out.mapeo))
console.log('    cabeceras: ' + JSON.stringify(out.cabeceras))

console.log('\nEL CRUCE CONTRA LO QUE YA EXISTE')
chk('reconoce los 3 que se llenaron', (out.cruce || {}).cambios === 3, JSON.stringify(out.cruce))
chk('las vacías NO cuentan como cambio', (out.cruce || {}).cambios + (out.cruce || {}).iguales === out.filasPlantilla,
    JSON.stringify(out.cruce))
chk('ninguna queda sin calzar (salieron de la misma base)', (out.cruce || {}).sinCalzar === 0,
    JSON.stringify(out.cruce))
console.log('    resumen que vería la persona:\n      ' + String(out.resumen).split('\n').join('\n      '))

console.log('\nPLANTILLA DE PROVEEDORES')
chk('se genera el .xlsx', out.provBytes > 0, out.provBytes + ' bytes')
chk('trae la hoja de Instrucciones', (out.provHojas || []).includes('Instrucciones'), JSON.stringify(out.provHojas))
chk('⛔ su propio importador reconoce los encabezados',
    (out.provMapeo || {}).faltan && out.provMapeo.faltan.length === 0, JSON.stringify(out.provMapeo))
console.log('    cabeceras: ' + JSON.stringify(out.provCabeceras))

if (errores.length) { console.log('\n  ⚠️ errores de consola:'); errores.slice(0, 6).forEach((e) => console.log('     ' + e)) }
await browser.close()
console.log('\n  ' + (fallos ? '⛔ ' + fallos + ' fallaron' : '✅ todo en verde') + '\n')
process.exit(fallos ? 1 : 0)
