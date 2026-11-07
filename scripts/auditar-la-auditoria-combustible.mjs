// ═══════════════════════════════════════════════════════════════════════════════
// AUDITAR LA AUDITORÍA DE COMBUSTIBLE
//
// Máximo, 06/11/2026: «analiza bien el modulo de auditoria de combustible como
// un experto para ver que tan bien esta trabajando y que tome los datos del
// sitio correcto el dato correcto y el analisis correcto».
//
// Esto NO es una prueba de que el código hace lo que dice: es una medición de
// si lo que dice es CIERTO sobre los datos reales. Cada bloque contesta una
// pregunta que, si se contesta mal, el módulo miente sin fallar.
//
// ⛔ SOLO LEE. Ni una escritura.
//
//   node scripts/auditar-la-auditoria-combustible.mjs [--desde AAAA-MM-DD]
// ═══════════════════════════════════════════════════════════════════════════════
import { pathToFileURL } from 'url'
import { readFileSync } from 'fs'
import { getPAT } from '../../maxware-tools/pat.mjs'

const i = process.argv.indexOf('--desde')
const DESDE = i > -1 ? process.argv[i + 1] : '2026-08-01'
const REF = 'hrkjddehqnzcqwlkklqm'
const RAIZ = new URL('../', import.meta.url)
const GLOBAL = 'C:/Users/Maxbetangar/AppData/Roaming/npm/node_modules/playwright/index.js'

let pw
try { pw = await import('playwright') }
catch { try { pw = await import(pathToFileURL(GLOBAL).href) }
        catch { console.error('Falta Playwright'); process.exit(1) } }

const pat = await getPAT()
const sql = async (q) => {
  const r = await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`, {
    method: 'POST', headers: { Authorization: `Bearer ${pat}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: q }),
  })
  if (!r.ok) { console.error('⛔ ' + (await r.text()).slice(0, 250)); process.exit(1) }
  return r.json()
}

const MED = await sql(`select id, fecha::text fecha, vehiculo_id, momento, turno, tanque_id,
                              altura_cm::text altura_cm, litros_calculados::text litros_calculados,
                              coalesce(no_confiable,false) no_confiable
                         from combustible_mediciones where fecha::date >= '${DESDE}' order by fecha, id`)
const TAN = await sql(`select * from combustible_tanques_config`)
const CK = await sql(`select fecha::text fecha, cam, turno, conductor,
                             km_salida::text km_salida, km_entrada::text km_entrada
                        from checklist where fecha::date >= '${DESDE}'`)
const SUR = await sql(`select fecha::text fecha, cam, turno, litros::text litros, chofer, hora
                         from surtidas where fecha::date >= '${DESDE}'`)

console.log(`\n═══ AUDITORÍA DE LA AUDITORÍA · desde ${DESDE} ═══`)
console.log(`   ${MED.length} mediciones · ${CK.length} checklists · ${SUR.length} surtidas · ${TAN.length} tanques\n`)

const chromium = pw.chromium || (pw.default && pw.default.chromium)
const browser = await chromium.launch()
const page = await (await browser.newContext()).newPage()
await page.route('**/app.js*', (r) => r.fulfill({ contentType: 'application/javascript',
                                                  body: readFileSync(new URL('./app.js', RAIZ), 'utf8') }))
await page.route('**/*.supabase.co/**', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: '[]' }))
await page.goto('https://betangar.com/app.html', { waitUntil: 'domcontentloaded' })
await page.waitForFunction(() => typeof window._acCubicar === 'function', { timeout: 20000 })

const R = await page.evaluate(([med, tan]) => {
  window.AC_TANQUES = tan.map((t) => {
    let tabla = t.tabla_cubicacion
    if (typeof tabla === 'string') { try { tabla = JSON.parse(tabla) } catch (e) { tabla = null } }
    return { id: t.id, nombre: t.nombre, tipo: t.tipo, cap: Number(t.capacidad_litros),
             hmax: Number(t.altura_max_cm), tabla, forma: t.forma || null,
             origen: t.tabla_origen || null, tablaDesde: t.tabla_desde || null }
  })
  const out = { sinTabla: [], difieren: [], fueraDeTabla: [], tanques: [] }
  for (const t of window.AC_TANQUES) {
    const ps = t.tabla ? Object.keys(t.tabla).map(Number).filter(isFinite).sort((a, b) => a - b) : []
    out.tanques.push({ id: t.id, nombre: t.nombre, tipo: t.tipo, hmax: t.hmax, cap: t.cap,
                       puntos: ps.length, desde: ps[0], hasta: ps[ps.length - 1], origen: t.origen })
  }
  for (const m of med) {
    const t = window._acTanqueDe(m)
    const cm = Number(m.altura_cm)
    if (!t || !t.tabla) { out.sinTabla.push({ id: m.id, veh: m.vehiculo_id, tanque: m.tanque_id }); continue }
    const js = window._acCubicar(t, cm)
    const db = m.litros_calculados == null ? null : Number(m.litros_calculados)
    if (js != null && db != null && Math.abs(js - db) > 0.5) {
      out.difieren.push({ fecha: m.fecha, veh: m.vehiculo_id, momento: m.momento, cm,
                          navegador: Math.round(js * 100) / 100, base: db,
                          dif: Math.round((js - db) * 100) / 100 })
    }
    const ps = Object.keys(t.tabla).map(Number).filter(isFinite).sort((a, b) => a - b)
    if (cm > ps[ps.length - 1] || cm < ps[0]) {
      out.fueraDeTabla.push({ fecha: m.fecha, veh: m.vehiculo_id, cm, tope: ps[ps.length - 1], noConf: m.no_confiable })
    }
  }
  return out
}, [MED, TAN])

console.log('── 1 · LOS TANQUES Y SU TABLA ─────────────────────────────────────────')
for (const t of R.tanques) {
  console.log(`   ${String(t.nombre || t.id).padEnd(26)} ${String(t.tipo).padEnd(9)} ` +
              `tabla ${String(t.puntos).padStart(4)} puntos  ${t.desde}–${t.hasta} cm` +
              `   hmax=${t.hmax}  cap=${t.cap}  origen=${t.origen || '—'}`)
  if (t.puntos && t.hasta < t.hmax) console.log(`      ⚠️ la tabla llega a ${t.hasta} cm y el tanque mide ${t.hmax}: lo de arriba se extrapola plano`)
  if (!t.puntos) console.log('      ⛔ SIN TABLA DE CUBICACIÓN: sus litros no se pueden calcular')
}

console.log('\n── 2 · ¿LA BASE Y EL NAVEGADOR CALCULAN LO MISMO? ─────────────────────')
console.log('   Hay DOS implementaciones de la cubicación: `tanque_veredicto` (base, la que')
console.log('   guarda `litros_calculados`) y `_acCubicar` (navegador, la que audita).')
if (!R.difieren.length) console.log('   ✓ coinciden en todas las mediciones del período (tolerancia 0,5 L)')
else {
  console.log(`   ⛔ DIFIEREN en ${R.difieren.length} de ${MED.length} mediciones:`)
  R.difieren.slice(0, 10).forEach((d) => console.log(
    `      ${d.fecha} ${d.veh} ${d.momento} ${d.cm} cm → base ${d.base} L · navegador ${d.navegador} L  (${d.dif > 0 ? '+' : ''}${d.dif})`))
  const peor = R.difieren.reduce((a, b) => (Math.abs(b.dif) > Math.abs(a.dif) ? b : a))
  console.log(`      peor caso: ${Math.abs(peor.dif)} L`)
}
if (R.sinTabla.length) console.log(`   ⛔ ${R.sinTabla.length} medición(es) de un tanque SIN tabla`)

console.log('\n── 3 · LECTURAS FUERA DE LA TABLA ─────────────────────────────────────')
if (!R.fueraDeTabla.length) console.log('   ✓ ninguna')
else {
  console.log(`   ⚠️ ${R.fueraDeTabla.length}: se topan al extremo de la tabla, no se interpolan`)
  R.fueraDeTabla.slice(0, 8).forEach((f) => console.log(
    `      ${f.fecha} ${f.veh} ${f.cm} cm (tabla hasta ${f.hasta ?? f.tope})  ${f.noConf ? '· marcada NO CONFIABLE' : '· SIN marcar'}`))
}

// ── 4 · Los km, que son el otro término del rendimiento ────────────────────
console.log('\n── 4 · LOS KM DE LA JORNADA ───────────────────────────────────────────')
const ckKey = {}
for (const c of CK) ckKey[`${c.cam}|${c.fecha}|${c.turno || 'diurno'}`] = c
const medDias = {}
for (const m of MED) medDias[`${m.vehiculo_id}|${m.fecha}|${m.turno || 'diurno'}`] = true
let sinCk = 0, kmRaros = 0, kmCero = 0
const ejemplos = []
for (const k of Object.keys(medDias)) {
  const c = ckKey[k]
  if (!c) { sinCk++; continue }
  const s = Number(c.km_salida), e = Number(c.km_entrada)
  if (!isFinite(s) || s <= 0 || !isFinite(e) || e <= 0) { kmCero++; continue }
  const d = e - s
  if (d < 0 || d > 400) { kmRaros++; if (ejemplos.length < 6) ejemplos.push(`${k} → ${s}→${e} = ${d} km`) }
}
console.log(`   jornadas con medición: ${Object.keys(medDias).length}`)
console.log(`   ${sinCk} sin checklist que le corresponda  ·  ${kmCero} con el odómetro en 0/vacío  ·  ${kmRaros} con km imposibles`)
ejemplos.forEach((e) => console.log('      ' + e))
if (sinCk) console.log('   ⚠️ sin checklist no hay km: esas jornadas NO tienen rendimiento, y eso debe VERSE')

// ── 5 · Las surtidas y su turno ────────────────────────────────────────────
console.log('\n── 5 · LAS SURTIDAS ───────────────────────────────────────────────────')
const sinTurno = SUR.filter((s) => !s.turno)
const sinChofer = SUR.filter((s) => !s.chofer)
const sinHora = SUR.filter((s) => !s.hora)
console.log(`   ${SUR.length} surtidas · ${sinTurno.length} sin turno · ${sinChofer.length} sin chofer · ${sinHora.length} sin hora`)
if (sinTurno.length) console.log('   ⚠️ las que no tienen turno no se le cargan a ninguna jornada (sí al período)')

await browser.close()
console.log('')
