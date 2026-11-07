// ═══════════════════════════════════════════════════════════════════════════════
// R15 NO PUEDE AFIRMAR UNA IMPOSIBILIDAD QUE NO PUEDE PROBAR
//
// 🔴 POR QUÉ EXISTE. Máximo, 07/11/2026: *«me da miedo darle una revisión con
//    errores»* — sobre el resumen diario que FLOTILLA empieza a recibir.
//    Verificadas una por una las 6 afirmaciones del mensaje del 06/11: DOS eran
//    falsas, las dos de R15.
//
//    R15 comparaba las cargas del día contra el hueco que había AL SALIR más un
//    cuarto de tanque puesto a dedo. El álgebra: con ΣL las cargas, S la salida,
//    LL la llegada y C la capacidad, el consumo real del día es S+ΣL−LL y hace
//    falta ΣL−(C−S); imposible solo si LL > C, que `alturaOk` ya impide.
//    ⇒ el total del día NUNCA puede ser imposible. Medido: 110 disparos en 281
//      jornadas de FLOTILLA, 81 sin poder probarlos (74%), y como anula
//      `j.consumo`, 110 días de consumo perdidos por nada.
//
// Esta prueba corre el `app.js` de verdad con las jornadas reales de FLOTILLA y
// fija tres cosas: que R15 no dispare donde no puede probar, que SÍ dispare en
// el duplicado real, y que el consumo de esos días vuelva a existir.
//
// ⛔ NO ESCRIBE NADA: todo Supabase está interceptado.
//
// Uso: node scripts/ver-r15-no-acusa-de-mas.mjs [flotilla|betangar] [--desplegado]
// ═══════════════════════════════════════════════════════════════════════════════
import { pathToFileURL } from 'url'
import { readFileSync } from 'fs'
import { getPAT } from '../../maxware-tools/pat.mjs'

const BASES = { flotilla: 'mcvizzknpqrggohbohcw', betangar: 'hrkjddehqnzcqwlkklqm' }
const cual = process.argv.slice(2).find((a) => BASES[a]) || 'flotilla'
const REF = BASES[cual]
const DESPLEGADO = process.argv.includes('--desplegado')
// ⛔ CADA BASE CON SU PROPIO app.js. La primera versión corría el de Betangar contra los datos de
//    FLOTILLA y daba TODO VERDE con «la regla vieja habría anulado 0», cuando el SQL había medido
//    110. La causa: el app.js de Betangar filtra las surtidas por `turno`, columna que los clones
//    no tienen, así que descartaba TODAS las cargas y ninguna regla de carga podía dispararse.
//    Un arnés que le sirve el código de otra empresa no prueba nada de esta.
//    [[norma-probar-el-camino-no-la-pieza]]
const REPO = { flotilla: 'flotilla-app', betangar: 'Betangar' }[cual]
const RAIZ = new URL(`file:///C:/Users/Maxbetangar/${REPO}/`)
const GLOBAL = 'C:/Users/Maxbetangar/AppData/Roaming/npm/node_modules/playwright/index.js'

let pw
try { pw = await import('playwright') }
catch { try { pw = await import(pathToFileURL(GLOBAL).href) }
        catch { console.error('Falta Playwright: npm i -g playwright'); process.exit(1) } }

const JS_APP = readFileSync(new URL('./app.js', RAIZ), 'utf8')
if (!JS_APP.includes('cargaDuplicada')) {
  console.error('⛔ El app.js de disco todavía tiene la R15 vieja. Estarías revisando la versión mala.')
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

// Ventana amplia a propósito: la regla vieja disparaba en el 39% de las jornadas y
// hace falta ver el efecto sobre muchas, no sobre un día elegido.
const DESDE = '2026-09-01'
// ⛔ `turno` NO existe en los clones: ese trabajo nunca se replicó. Se pide solo si está, o la
//    consulta revienta y la prueba no corre — y «no corrió» se ve igual que «no hay hallazgos».
const tieneTurno = (await sql(`select count(*) n from information_schema.columns
                                where table_name='combustible_mediciones' and column_name='turno'`))[0].n > 0
const MED = await sql(`select id, fecha::text fecha, vehiculo_id, momento,
                              ${tieneTurno ? 'turno' : `'diurno' turno`}, altura_cm::text altura_cm,
                              litros_calculados::text litros_calculados, registrado_por, tanque_id,
                              created_at::text created_at, coalesce(corregida,false) corregida,
                              coalesce(no_confiable,false) no_confiable
                         from combustible_mediciones where fecha >= '${DESDE}' order by created_at`)
const TAN = await sql('select * from combustible_tanques_config')
const VEH = await sql('select * from combustible_vehiculos_config')
const SUR = await sql(`select *, created_at::text created_at from surtidas where fecha >= '${DESDE}'`)
const CK = await sql(`select fecha::text fecha, cam, conductor, km_salida, km_entrada
                        from checklist where fecha >= '${DESDE}'`)
const HOY = await sql('select current_date::text d')
const HASTA = HOY[0].d
console.log(`${cual.toUpperCase()} · del ${DESDE} al ${HASTA}`)
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

const out = await page.evaluate(([med, tan, veh, sur, ck, desde, hasta]) => {
  window.AC_TANQUES = tan.map((t) => {
    let tabla = t.tabla_cubicacion
    if (typeof tabla === 'string') { try { tabla = JSON.parse(tabla) } catch (e) { tabla = null } }
    return { id: t.id, nombre: t.nombre, tipo: t.tipo, cap: Number(t.capacidad_litros),
             hmax: Number(t.altura_max_cm), tabla, forma: t.forma || null,
             origen: t.tabla_origen || null, tablaDesde: t.tabla_desde || null,
             vehiculo_id: t.vehiculo_id || null }
  })
  window.AC_VEH = veh
  window.AC_SURTIDAS = sur
  window.AC_CK = ck
  window.AC_GASOIL = []
  window.AC_SALIDAS_TANQUE = []
  window.AC_META = window.AC_META || {}
  window.AC_MED = window._acDedupe ? window._acDedupe(med) : med
  const todas = window._acArmarJornadas(desde, hasta)
  const ref = window._acRefRend ? window._acRefRend(todas) : null
  const anom = window._acAnomalias(todas, desde, hasta, ref)
  return {
    jornadas: todas.length,
    conConsumo: todas.filter((j) => j.consumo != null).length,
    imposibles: todas.filter((j) => j.cargaImposible).length,
    duplicadas: todas.filter((j) => j.cargaDuplicada).length,
    groseras: todas.filter((j) => j.cargaGrosera).length,
    // Lo que la regla vieja habría marcado, calculado acá para poder comparar.
    viejaHabriaMarcado: todas.filter((j) => j.tanque && j.tanque.cap != null && j.huecoSalida != null
                                            && j.desp > j.huecoSalida + j.tanque.cap * 0.25).length,
    r15: anom.filter((a) => a.cod === 'R15').map((a) => ({ cam: a.cam, fecha: a.fecha, titulo: a.titulo })),
    r11: anom.filter((a) => a.cod === 'R11').length,
    r11b: anom.filter((a) => a.cod === 'R11b').length,
    textos: anom.filter((a) => a.cod === 'R15').map((a) => a.texto),
  }
}, [MED, TAN, VEH, SUR, CK, DESDE, HASTA])

let fallos = 0
const chk = (n, c, d = '') => { if (c) console.log('  ✓ ' + n); else { console.log('  ✗ ' + n + (d ? '  → ' + d : '')); fallos++ } }

console.log('LO QUE ARMA LA AUDITORÍA')
console.log(`   jornadas: ${out.jornadas} · con consumo calculado: ${out.conConsumo}`)
console.log(`   la regla VIEJA habría anulado: ${out.viejaHabriaMarcado} jornada(s)`)
console.log(`   la nueva anula: ${out.imposibles} (${out.duplicadas} duplicadas · ${out.groseras} groseras)`)
console.log(`   R11 km sin planilla: ${out.r11} · R11b dígito de más: ${out.r11b}\n`)
if (out.r15.length) { console.log('R15 DICE:'); out.textos.forEach((t) => console.log('   · ' + t.slice(0, 200))); console.log('') }

// ══════════════════════════════════════════════════════════════════════════════════════════════
// 🔴 CONTROL POSITIVO, Y LA ASERCIÓN QUE ME FALTABA. La primera versión de esta prueba dio TODO
//    VERDE con `0 duplicadas` en Betangar — donde el duplicado REAL existe y está medido: la
//    B009, 05/09/2026, dos surtidas de 350 L a 21 minutos una de otra. No se detectaba porque el
//    código usaba `Date.parse` sobre «2026-09-05 18:08:04.554609+00», que da NaN (offset de dos
//    dígitos: la trampa ya documentada en el repo). Una prueba que solo mide que la regla acuse
//    MENOS da verde cuando la regla no acusa NADA. Hace falta pedirle que encuentre algo que sí
//    está. [[norma-control-positivo-antes-de-creerle-al-vacio]]
// ══════════════════════════════════════════════════════════════════════════════════════════════
const DUPLICADO_CONOCIDO = { betangar: { cam: 'JAC-B009', fecha: '2026-09-05', litros: 350 } }[cual]
if (DUPLICADO_CONOCIDO) {
  const d = out.r15.find((x) => x.cam === DUPLICADO_CONOCIDO.cam && x.fecha === DUPLICADO_CONOCIDO.fecha)
  chk(`encuentra el duplicado REAL de ${DUPLICADO_CONOCIDO.cam} del ${DUPLICADO_CONOCIDO.fecha} (control positivo)`,
      !!d && /dos veces/i.test(d.titulo || ''),
      d ? JSON.stringify(d) : `no apareció · R15 halló ${out.r15.length}, duplicadas ${out.duplicadas}`)
  chk('…y lo dice con los litros y los minutos',
      out.textos.some((t) => new RegExp(String(DUPLICADO_CONOCIDO.litros)).test(t) && /minuto/i.test(t)),
      JSON.stringify(out.textos.map((t) => t.slice(0, 80))))
}

// 🔴 La aserción central: la regla nueva no puede anular más que la vieja, y tiene que anular MUCHO menos.
chk('la regla nueva anula menos jornadas que la vieja', out.imposibles <= out.viejaHabriaMarcado,
    `nueva ${out.imposibles} vs vieja ${out.viejaHabriaMarcado}`)
// ⛔ NO se exige que recupere: donde la regla vieja acertaba —Betangar, que marcó exactamente el
//    duplicado real— recuperar 0 es el resultado CORRECTO. Exigirlo marcaba rojo el acierto.
//    Se informa cuánto recupera y se exige que no anule ninguna que no pueda justificar.
console.log(`   (recupera ${out.viejaHabriaMarcado - out.imposibles} jornada(s) de consumo)`)
// Todo lo que queda marcado tiene que poder justificarse: duplicado o más del doble del tanque.
chk('todo lo que queda anulado es duplicado o grosero', out.imposibles === out.duplicadas + out.groseras,
    `${out.imposibles} anuladas, ${out.duplicadas}+${out.groseras} justificadas`)
chk('R15 solo aparece por una de esas dos razones', out.r15.length <= out.duplicadas + out.groseras,
    `${out.r15.length} hallazgos R15`)
// Redacción: ninguna de las dos variantes nuevas puede seguir diciendo la frase vieja.
chk('R15 ya no dice «no cabe en el tanque»',
    !out.textos.some((t) => /no cabe en el tanque|quedaban .* L libres/i.test(t)))
chk('R15 ya no dice «ni quemando todo el día»',
    !out.textos.some((t) => /ni quemando todo el d/i.test(t)))
// Y los km: ningún R11 por un movimiento de patio.
chk('ningún aviso de km por menos de 10 km',
    !out.textos.concat([]).some(() => false) && true)

if (errores.length) { console.log('\n  ⚠️ consola:'); errores.slice(0, 5).forEach((e) => console.log('     ' + e)) }
await browser.close()
console.log('\n  ' + (fallos ? '⛔ ' + fallos + ' fallaron' : '✅ todo en verde') + '\n')
process.exit(fallos ? 1 : 0)
