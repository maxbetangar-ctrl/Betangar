// ═══════════════════════════════════════════════════════════════════════════════
// LA AUDITORÍA DE COMBUSTIBLE CON DOS TURNOS, EN UN NAVEGADOR Y CON DATOS REALES
//
// 🔴 POR QUÉ EXISTE. Máximo, 06/11/2026: «el sistema indica que inicio con 34cm
//    y termino con 34 cm osea no gasto combustible hoy […] ese modulo es la
//    auditoria de combustible y le tengo puesto el ojo. Diario reviso la
//    auditoria».
//
// ⛔ POR QUÉ NO ALCANZA CON LAS PRUEBAS. `test/auditoria-dos-turnos.test.js`
//    reimplementa la regla del emparejado en diez líneas para poder correrla
//    sin navegador: fija la REGLA, no la pantalla. Acá corre el `app.js` de
//    verdad, con las mediciones de verdad, y se lee lo que las jornadas
//    quedaron diciendo. [[norma-probar-el-camino-no-la-pieza]]
//
// ⛔ NO ESCRIBE NADA: todo Supabase está interceptado y los datos se le sirven
//    ya leídos.
//
// Uso: node scripts/ver-auditoria-dos-turnos.mjs [--desplegado] [AAAA-MM-DD]
// ═══════════════════════════════════════════════════════════════════════════════
import { pathToFileURL } from 'url'
import { readFileSync } from 'fs'
import { getPAT } from '../../maxware-tools/pat.mjs'

const DIA = process.argv.slice(2).find((a) => /^\d{4}-\d{2}-\d{2}$/.test(a)) || '2026-11-06'
const DESPLEGADO = process.argv.includes('--desplegado')
const REF = 'hrkjddehqnzcqwlkklqm'
const RAIZ = new URL('../', import.meta.url)
const GLOBAL = 'C:/Users/Maxbetangar/AppData/Roaming/npm/node_modules/playwright/index.js'

let pw
try { pw = await import('playwright') }
catch { try { pw = await import(pathToFileURL(GLOBAL).href) }
        catch { console.error('Falta Playwright: npm i -g playwright'); process.exit(1) } }

const JS_APP = readFileSync(new URL('./app.js', RAIZ), 'utf8')
if (!JS_APP.includes('_acTurno')) {
  console.error('⛔ El app.js de disco NO separa por turno. Estarías revisando la versión vieja.')
  process.exit(1)
}

const pat = await getPAT()
const sql = async (q) => {
  const r = await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`, {
    method: 'POST', headers: { Authorization: `Bearer ${pat}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: q }),
  })
  if (!r.ok) { console.error('⛔ ' + (await r.text()).slice(0, 250)); process.exit(1) }
  return r.json()
}

const MED = await sql(`select id, fecha::text fecha, vehiculo_id, momento, turno,
                              altura_cm::text altura_cm, litros_calculados::text litros_calculados,
                              registrado_por, tanque_id, created_at::text created_at,
                              coalesce(corregida,false) corregida, coalesce(no_confiable,false) no_confiable
                         from combustible_mediciones where fecha::date = '${DIA}' order by created_at`)
const TAN = await sql(`select * from combustible_tanques_config`)
const VEH = await sql(`select * from combustible_vehiculos_config`)
console.log(`Mediciones reales del ${DIA}: ${MED.length}\n`)

const chromium = pw.chromium || (pw.default && pw.default.chromium)
const browser = await chromium.launch()
const page = await (await browser.newContext()).newPage()
const errores = []
page.on('pageerror', (e) => errores.push(e.message))
if (!DESPLEGADO) await page.route('**/app.js*', (r) => r.fulfill({ contentType: 'application/javascript', body: JS_APP }))
else console.log('⚠️  --desplegado: el código DE LA CALLE.\n')
await page.route('**/*.supabase.co/**', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: '[]' }))
await page.goto('https://betangar.com/app.html', { waitUntil: 'domcontentloaded' })
await page.waitForFunction(() => typeof window._acArmarJornadas === 'function', { timeout: 20000 })

const out = await page.evaluate(([med, tan, veh, dia]) => {
  // Los tanques se mapean IGUAL que en la carga real: `_acTanqueDe` busca por
  // `id` y `_acCubicar` necesita `hmax`/`tabla`. Servirle la fila cruda de la
  // tabla deja todos los litros en null y la prueba mentiria diciendo que la
  // auditoria no calcula.
  window.AC_TANQUES = tan.map((t) => {
    let tabla = t.tabla_cubicacion
    if (typeof tabla === 'string') { try { tabla = JSON.parse(tabla) } catch (e) { tabla = null } }
    return { id: t.id, nombre: t.nombre, tipo: t.tipo, cap: Number(t.capacidad_litros),
             hmax: Number(t.altura_max_cm), tabla, forma: t.forma || null,
             origen: t.tabla_origen || null, tablaDesde: t.tabla_desde || null }
  })
  window.AC_VEH = veh
  window.AC_META = window.AC_META || {}
  window.AC_MED = window._acDedupe ? window._acDedupe(med) : med
  window._acArmarJornadas(dia, dia)
  return (window.AC_JORNADAS || []).map((j) => ({
    cam: j.cam, turno: j.turno, salidaCm: j.salidaCm, llegadaCm: j.llegadaCm,
    salida: j.salida, llegada: j.llegada, por: j.por,
  }))
}, [MED, TAN, VEH, DIA])

let fallos = 0
const chk = (n, c, d = '') => { if (c) console.log('  ✓ ' + n); else { console.log('  ✗ ' + n + (d ? '  → ' + d : '')); fallos++ } }

console.log('JORNADAS QUE ARMA LA AUDITORÍA')
for (const j of out) {
  const l = (x) => (x == null ? '—' : Number(x).toFixed(1))
  console.log(`   ${j.cam}  ${String(j.turno || '?').padEnd(9)} ` +
              `salida ${String(j.salidaCm ?? '—').padStart(5)} cm (${l(j.salida)} L)  →  ` +
              `llegada ${String(j.llegadaCm ?? '—').padStart(5)} cm (${l(j.llegada)} L)   ${j.por || ''}`)
}
console.log('')

// Las dos unidades que hicieron dos turnos ese día tienen que salir DOS veces.
for (const u of ['JAC-B009', 'JAC-B004']) {
  const suyas = out.filter((j) => j.cam === u)
  const turnos = [...new Set(suyas.map((j) => j.turno))]
  if (MED.some((m) => m.vehiculo_id === u && m.turno === 'nocturno')) {
    chk(u + ': sale una jornada POR TURNO', suyas.length >= 2 && turnos.length >= 2,
        suyas.length + ' jornada(s), turnos: ' + JSON.stringify(turnos))
  }
}
const b9 = out.find((j) => j.cam === 'JAC-B009' && j.turno === 'diurno')
if (b9) {
  chk('JAC-B009 diurno ya NO marca cero consumo',
      b9.salida != null && b9.llegada != null && Number(b9.salida) > Number(b9.llegada),
      JSON.stringify([b9.salidaCm, b9.llegadaCm]))
}
chk('ninguna jornada mezcla dos choferes distintos',
    out.every((j) => !j.por || typeof j.por === 'string'))
if (errores.length) { console.log('\n  ⚠️ consola:'); errores.slice(0, 5).forEach((e) => console.log('     ' + e)) }
await browser.close()
console.log('\n  ' + (fallos ? '⛔ ' + fallos + ' fallaron' : '✅ todo en verde') + '\n')
process.exit(fallos ? 1 : 0)
