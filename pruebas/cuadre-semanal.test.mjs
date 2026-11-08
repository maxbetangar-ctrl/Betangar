// ⛔ EL CUADRE SEMANAL POR UNIDAD — lunes a domingo
//
// 🔴 POR QUÉ EXISTE, medido el 08/11/2026: el consumo MEDIANO de una jornada es 59,7 L y el
//    umbral del módulo (2·TOL) es 67,6 L — el **113%** de lo que el camión gasta en todo el día.
//    En 681 de 1.224 jornadas (56%) el umbral SUPERA al consumo entero. Sobre una semana el
//    consumo mediano es 357 L y el umbral queda en el 19%: el mismo dato, ~6 veces más sensible.
//    La tolerancia no crece con los días porque son siempre las MISMAS dos lecturas.
//
// ⛔ NO ES UNA REGLA QUE ACUSE, y eso se decidió MIDIENDO. El primer diseño señalaba 78 semanas;
//    75 eran «consumió de menos» con hasta 86 km/L en camiones que hacen 1,9 — no eran robos,
//    eran cargas que nadie asentó, que es lo que ya dice R13. Repetirlo contaría el mismo hecho
//    dos veces. Lo que agrega información es la DESCOMPOSICIÓN.
//
// ✅ LA INVARIANTE QUE ESTA PRUEBA CUIDA, y es una identidad algebraica, no una estimación:
//
//        desvío = porDías − porNoches + cargasCorridas + resto
//
//    El cuadre semanal usa solo los dos extremos; sumar los días arrastra además lo que pasó
//    entre la llegada de un día y la salida del siguiente (`porNoches`), y las cargas que
//    salieron del cuadre de SU día por asentarse tarde pero siguen contando en la semana
//    (`cargasCorridas`). `resto` queda SOLO para los días que no se pudieron cuadrar.
//
// 📌 LOS DOS TÉRMINOS DE MÁS LOS ENCONTRÓ ESTA PRUEBA, no el razonamiento:
//    · sin `resto` la identidad fallaba en 22 de 184 semanas, con error de hasta 550 L;
//    · con `resto` pero sin `cargasCorridas`, quedaban 4 semanas donde el resto tapaba algo que
//      NO eran días sin cuadrar — las aserciones 8 y 9 lo cazaron.
//    ⛔ Un término residual sin nombre es donde se esconde el próximo defecto. Por eso las
//      aserciones 8 y 9 exigen que `resto` SOLO exista cuando hay días sin cuadrar.
//    **Una descomposición que no cierra es peor que no tenerla.**
//
//   node pruebas/cuadre-semanal.test.mjs [app.js]
import { readFileSync } from 'fs'
import { cargarAuditoria, sembrar } from './_banco-combustible.mjs'

const rutaApp = process.argv[2] || new URL('../app.js', import.meta.url)
const js = readFileSync(rutaApp, 'utf8')
const datos = JSON.parse(readFileSync(new URL('./datos/combustible.json', import.meta.url), 'utf8'))
const ctx = cargarAuditoria(rutaApp)
sembrar(ctx, datos)

let fallos = 0
const ok = (n, c, d) => { console.log((c ? '✅' : '❌') + ' ' + n + (c ? '' : '  → ' + d)); if (!c) fallos++ }

ok('0. _acCuadreSemanal y _acLunesDe existen', typeof ctx._acCuadreSemanal === 'function' && typeof ctx._acLunesDe === 'function',
   'sin ellas no se prueba nada')
if (typeof ctx._acCuadreSemanal !== 'function') { console.log('\n⛔ no está la función.'); process.exit(1) }

// ── 1. LUNES A DOMINGO, que es como cierra toda la casa ──────────────────────────────────────
// ⛔ `getUTCDay()` da 0 para DOMINGO. Sin el (+6)%7 el domingo se iria a la semana SIGUIENTE y
//    los viajes del domingo no entrarian en ningun cierre — el mismo error que ya costo una
//    correccion en nomina el 04/11.
const L = ctx._acLunesDe
ok('1. el lunes cae en sí mismo', L('2026-11-02') === '2026-11-02', 'dio ' + L('2026-11-02'))
ok('2. el martes vuelve al lunes', L('2026-11-03') === '2026-11-02', 'dio ' + L('2026-11-03'))
ok('3. el SÁBADO sigue en esa semana', L('2026-11-07') === '2026-11-02', 'dio ' + L('2026-11-07'))
ok('4. el DOMINGO CIERRA esa semana, no abre la siguiente', L('2026-11-08') === '2026-11-02', 'dio ' + L('2026-11-08'))
ok('5. el lunes siguiente ya es otra semana', L('2026-11-09') === '2026-11-09', 'dio ' + L('2026-11-09'))

// ── 2. LA IDENTIDAD, sobre los datos REALES del volcado ──────────────────────────────────────
const J = ctx._acArmarJornadas('2026-07-01', '2026-09-07')
const ref = ctx._acRefRend(J)
const S = ctx._acCuadreSemanal(J, ref)
const medibles = S.filter((x) => x.mide && x.desvio != null)
ok('6. CONTROL POSITIVO: el volcado produce semanas medibles', medibles.length >= 20,
   'solo ' + medibles.length + ': la prueba pasaría sin medir nada')

let malas = 0, peor = 0, peorQ = null
medibles.forEach((x) => {
  const e = Math.abs(x.desvio - (x.porDias - x.porNoches + x.cargasCorridas + x.resto))
  if (e > 0.02) { malas++; if (e > peor) { peor = e; peorQ = x } }
})
ok('7. desvío = porDías − porNoches + cargasCorridas + resto, SIEMPRE', malas === 0,
   malas + ' semanas no cierran, la peor por ' + peor.toFixed(2) + ' L' +
   (peorQ ? ' (' + peorQ.semana + ' ' + peorQ.cam + ')' : ''))

// ── 3. El `resto` nombra lo que no se pudo cuadrar, no es un cajón de sastre ─────────────────
const conResto = medibles.filter((x) => Math.abs(x.resto) > 0.02)
ok('8. todo `resto` distinto de cero tiene días sin cuadrar que lo expliquen',
   conResto.every((x) => x.diasSinCuadrar > 0),
   conResto.filter((x) => !x.diasSinCuadrar).length + ' semanas con resto y 0 días sin cuadrar: el término taparía otra cosa')
ok('9. y al revés: sin días sin cuadrar, el resto es cero',
   medibles.filter((x) => x.diasSinCuadrar === 0).every((x) => Math.abs(x.resto) <= 0.02),
   'hay semanas con todos los días cuadrados y resto distinto de cero')

// ── 4. Lo que NO se mide, se dice por qué ───────────────────────────────────────────────────
const noMide = S.filter((x) => !x.mide)
ok('10. toda semana no medible trae su motivo', noMide.every((x) => !!x.motivo),
   noMide.filter((x) => !x.motivo).length + ' sin motivo: un hueco mudo no se puede auditar')

// ── 5. ⛔ NO INVENTA UN CUADRE SIN LOS KM COMPLETOS ──────────────────────────────────────────
// Si falta el km de un dia del medio, lo esperado sale corto y la semana parece consumir de mas.
ok('11. sin los km completos NO se cuadra', /faltan los km de/.test(js),
   'no está el candado de los km: es la única forma de inventar un faltante acá')
ok('12. los extremos se validan por la LECTURA', /!a\[i\]\.salidaMala&&!a\[i\]\.noConf&&!a\[i\]\.corregida/.test(js.replace(/\s+/g, '')),
   'podría cuadrar contra una lectura descartada')

// ── 6. Y que NO acuse: esto devuelve filas, no hallazgos ────────────────────────────────────
const cuerpo = (() => { const i = js.indexOf('function _acCuadreSemanal('); const j = js.indexOf('\n}', i); return js.slice(i, j) })()
ok('13. el cuadre semanal NO emite hallazgos (no llama a add)', !/\badd\(/.test(cuerpo),
   'empezó a acusar: contaría dos veces lo que R1/R13/R14 ya dicen')

console.log('\n' + (fallos === 0 ? '✅ TODAS PASAN' : '⛔ ' + fallos + ' MAL'))
process.exit(fallos === 0 ? 0 : 1)
