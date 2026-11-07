// ═══════════════════════════════════════════════════════════════════════════════
// R14 «AMANECIÓ CON MÁS», EN UN NAVEGADOR Y CON LOS DATOS REALES DE ESA NOCHE
//
// 🔴 POR QUÉ EXISTE. El aviso de la mañana siguiente y la pantalla tienen que
//    decir LO MISMO. Si el WhatsApp pregunta por 5 unidades y el módulo muestra
//    un total de 9 mezclado con lo del día, el que recibe la pregunta no puede
//    contestarla — y deja de creerle a las dos. Las dos piezas son gemelas a
//    propósito, así que acá se comprueba la de pantalla contra la misma noche
//    que ya se verificó en la edge function (?manana=1&fecha=2026-10-15).
//
// ⛔ LO QUE ESTA PRUEBA MIRA Y NINGUNA OTRA PUEDE. `_acAnomalias` solo existe
//    dentro del navegador: corre el `app.js` de verdad con las mediciones de
//    verdad y LEE EL TEXTO que quedó en la tarjeta. No reimplementa la regla.
//    [[norma-probar-el-camino-no-la-pieza]] [[norma-una-pantalla-se-revisa-en-una-pantalla]]
//
// ⛔ NO ESCRIBE NADA: todo Supabase está interceptado.
//
// Uso: node scripts/ver-amanecio-con-mas.mjs [--desplegado] [AAAA-MM-DD]
//      (la fecha es la MAÑANA; se carga también la noche anterior)
// ═══════════════════════════════════════════════════════════════════════════════
import { pathToFileURL } from 'url'
import { readFileSync } from 'fs'
import { getPAT } from '../../maxware-tools/pat.mjs'

const MANANA = process.argv.slice(2).find((a) => /^\d{4}-\d{2}-\d{2}$/.test(a)) || '2026-10-15'
const NOCHE = new Date(new Date(MANANA + 'T12:00:00Z').getTime() - 86400000).toISOString().slice(0, 10)
const DESPLEGADO = process.argv.includes('--desplegado')
const REF = 'hrkjddehqnzcqwlkklqm'
const RAIZ = new URL('../', import.meta.url)
const GLOBAL = 'C:/Users/Maxbetangar/AppData/Roaming/npm/node_modules/playwright/index.js'

let pw
try { pw = await import('playwright') }
catch { try { pw = await import(pathToFileURL(GLOBAL).href) }
        catch { console.error('Falta Playwright: npm i -g playwright'); process.exit(1) } }

const JS_APP = readFileSync(new URL('./app.js', RAIZ), 'utf8')
// Control de versión: sin esto la prueba podría pasar contra un app.js viejo que
// todavía mete las noches dentro de R13, y el verde no significaría nada.
if (!JS_APP.includes("'R14'")) {
  console.error('⛔ El app.js de disco no tiene R14. Estarías revisando la versión vieja.')
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
                         from combustible_mediciones
                        where fecha::date between '${NOCHE}' and '${MANANA}' order by created_at`)
const TAN = await sql(`select * from combustible_tanques_config`)
const VEH = await sql(`select * from combustible_vehiculos_config`)
const SUR = await sql(`select * from surtidas where fecha::date between '${NOCHE}' and '${MANANA}'`)
const CK = await sql(`select fecha::text fecha, cam, conductor, km_salida, km_entrada, turno
                        from checklist where fecha::date between '${NOCHE}' and '${MANANA}'`)
console.log(`Noche del ${NOCHE} → mañana del ${MANANA}`)
console.log(`  mediciones ${MED.length} · surtidas ${SUR.length} · checklists ${CK.length}\n`)

const chromium = pw.chromium || (pw.default && pw.default.chromium)
const browser = await chromium.launch()
const page = await (await browser.newContext()).newPage()
const errores = []
page.on('pageerror', (e) => errores.push(e.message))
if (!DESPLEGADO) await page.route('**/app.js*', (r) => r.fulfill({ contentType: 'application/javascript', body: JS_APP }))
else console.log('⚠️  --desplegado: el código DE LA CALLE.\n')
await page.route('**/*.supabase.co/**', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: '[]' }))
await page.goto('https://betangar.com/app.html', { waitUntil: 'domcontentloaded' })
await page.waitForFunction(() => typeof window._acAnomalias === 'function', { timeout: 20000 })

const out = await page.evaluate(([med, tan, veh, sur, ck, noche, manana]) => {
  // Los tanques se mapean IGUAL que en la carga real: servirle la fila cruda deja
  // todos los litros en null y la prueba mentiría diciendo que no hay hallazgos.
  window.AC_TANQUES = tan.map((t) => {
    let tabla = t.tabla_cubicacion
    if (typeof tabla === 'string') { try { tabla = JSON.parse(tabla) } catch (e) { tabla = null } }
    return { id: t.id, nombre: t.nombre, tipo: t.tipo, cap: Number(t.capacidad_litros),
             hmax: Number(t.altura_max_cm), tabla, forma: t.forma || null,
             origen: t.tabla_origen || null, tablaDesde: t.tabla_desde || null }
  })
  window.AC_VEH = veh
  window.AC_SURTIDAS = sur
  window.AC_CK = ck
  window.AC_GASOIL = []
  window.AC_SALIDAS_TANQUE = []
  window.AC_META = window.AC_META || {}
  window.AC_MED = window._acDedupe ? window._acDedupe(med) : med
  const todas = window._acArmarJornadas(noche, manana)
  const ref = window._acRefRend ? window._acRefRend(todas) : null
  const anom = window._acAnomalias(todas, noche, manana, ref)
  return { anom, jornadas: todas.length }
}, [MED, TAN, VEH, SUR, CK, NOCHE, MANANA])

let fallos = 0
const chk = (n, c, d = '') => { if (c) console.log('  ✓ ' + n); else { console.log('  ✗ ' + n + (d ? '  → ' + d : '')); fallos++ } }

const r14 = out.anom.filter((a) => a.cod === 'R14')
const r13 = out.anom.filter((a) => a.cod === 'R13')

console.log('LO QUE QUEDÓ DICIENDO LA PANTALLA')
for (const a of out.anom) console.log(`   [${a.cod}] ${a.titulo}${a.litros != null ? '  ' + a.litros + ' L' : ''}`)
console.log('')
if (r14.length) { console.log('TEXTO DE R14:\n   ' + r14[0].texto.replace(/ · /g, '\n   · ') + '\n') }

// Lo verificado en la edge function para esta misma noche: 5 unidades, 759,9 L.
chk('R14 aparece como hallazgo propio', r14.length === 1, r14.length + ' encontrados')
chk('R14 lo dice en litros', r14.length === 1 && r14[0].litros > 0, JSON.stringify(r14.map((x) => x.litros)))
chk('R14 nombra las unidades una por una (no un total suelto)',
    r14.length === 1 && (r14[0].texto.match(/JAC-B\d+|B\d{3}/g) || []).length >= 2,
    r14.length ? JSON.stringify((r14[0].texto.match(/JAC-B\d+|B\d{3}/g) || []).slice(0, 8)) : '')
chk('R14 dice la NOCHE, no solo la mañana',
    r14.length === 1 && /noche del \d{2}\/\d{2}/.test(r14[0].texto),
    r14.length ? r14[0].texto.slice(0, 90) : '')
chk('R14 no acusa a ningún chofer',
    r14.length === 1 && !r14[0].quien && /no señala a ningún chofer/i.test(r14[0].texto))
// El punto de haber partido R13: lo de la noche ya no se cuenta dos veces.
chk('R13 ya no se lleva lo de la noche',
    !r13.length || !/amaneci/i.test(r13[0].texto),
    r13.length ? r13[0].texto.slice(0, 90) : 'sin R13')
chk('los litros de R14 no están también en R13',
    !r13.length || Math.abs((r13[0].litros || 0) - (r14[0] ? r14[0].litros : 0)) > 1,
    'R13 ' + (r13.length ? r13[0].litros : '—') + ' L · R14 ' + (r14[0] ? r14[0].litros : '—') + ' L')

// ── LA COMPROBACIÓN QUE DE VERDAD IMPORTA: LAS DOS GEMELAS DICEN LO MISMO ────────────────────
// 🔴 La primera versión de esta prueba daba TODO VERDE mientras la pantalla decía 8 unidades y
//    1.205 L y la edge function decía 5 y 759,9 L — porque solo comprobaba la FORMA del hallazgo.
//    El desacuerdo entre las dos es el único fallo que importa acá: si el WhatsApp pregunta por 5
//    y el módulo muestra 8, el que contesta no puede contestar. Así que se le pregunta a la edge
//    function de verdad y se comparan los números.
const edge = await (async () => {
  const r = await fetch(`https://${REF}.supabase.co/functions/v1/auditar-combustible?manana=1&dry=1&fecha=${MANANA}`,
    { method: 'POST', headers: { 'Content-Type': 'application/json' } })
  if (!r.ok) return null
  return r.json()
})()
if (!edge) {
  console.log('  ⚠️ no se pudo consultar la edge function: la comparación de gemelas NO corrió')
  fallos++
} else {
  const camsEdge = [...new Set((edge.detalle?.entraronNoche || []).map((x) => x.u))].sort()
  const litrosEdge = (edge.detalle?.entraronNoche || []).reduce((s, x) => s + x.litros, 0)
  // La pantalla audita un RANGO (dos mañanas); la edge, una sola. Se comparan solo las de ESTA noche.
  const deEstaNoche = (r14[0]?.texto || '').match(/JAC-B\d+/g) || []
  const camsPant = [...new Set(deEstaNoche)].sort()
  console.log('\n  edge:     ' + camsEdge.join(', ') + '  → ' + litrosEdge.toFixed(1) + ' L')
  console.log('  pantalla: ' + camsPant.join(', ') + '  → ' + (r14[0]?.litros ?? '—') + ' L')
  chk('la pantalla y el WhatsApp nombran las MISMAS unidades',
      JSON.stringify(camsEdge) === JSON.stringify(camsPant),
      'sobran en pantalla: ' + camsPant.filter((c) => !camsEdge.includes(c)).join(', ') +
      ' · faltan: ' + camsEdge.filter((c) => !camsPant.includes(c)).join(', '))
  chk('y los MISMOS litros (±2 L por el redondeo)',
      r14[0] != null && Math.abs(r14[0].litros - litrosEdge) <= 2,
      (r14[0]?.litros ?? '—') + ' vs ' + litrosEdge.toFixed(1))
}

if (errores.length) { console.log('\n  ⚠️ consola:'); errores.slice(0, 5).forEach((e) => console.log('     ' + e)) }
await browser.close()
console.log('\n  ' + (fallos ? '⛔ ' + fallos + ' fallaron' : '✅ todo en verde') + '\n')
process.exit(fallos ? 1 : 0)
