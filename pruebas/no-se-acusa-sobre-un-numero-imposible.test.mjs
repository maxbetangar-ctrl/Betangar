// ⛔ UNA REGLA NO HABLA SOBRE UN NÚMERO QUE NO PUEDE EXISTIR
//
// 🔴 Medido el 07/11/2026 sobre los 4,5 meses de la base real: de los 74 avisos de R4c
//    («Consumo por debajo de lo creíble»), **72 eran sobre jornadas con consumo NEGATIVO**.
//    El peor decía «figura gastando solo −399,9 L para 132 km»: el tanque GANÓ 400 L.
//
//    Un consumo negativo no es «consumió menos»: es que ENTRÓ combustible. Esa pregunta ya
//    existe y es otra —R13, «entraron N L sin ninguna carga registrada»—, que señala el agujero
//    de registro y no a una jornada.
//
// 📌 Una regla que es 97% ruido no se desactiva: se IGNORA, y con ella se ignora el módulo
//    entero. Por eso esto no es cosmética. [[norma-una-asercion-mal-escrita-acusa-al-producto]]
//
// ⛔ Y EL CONTROL QUE IMPORTA: que al sacarle el ruido la regla no quede MUERTA. Medido: quedan
//    1.156 jornadas candidatas y la más cercana está a 12,3 L de disparar. Una regla que no puede
//    disparar nunca da una falsa sensación de cobertura, que es peor que no tenerla.
//
//   node pruebas/no-se-acusa-sobre-un-numero-imposible.test.mjs [app.js]
import { readFileSync } from 'fs'
import { cargarAuditoria, sembrar, auditar } from './_banco-combustible.mjs'

const rutaApp = process.argv[2] || new URL('../app.js', import.meta.url)
const js = readFileSync(rutaApp, 'utf8')
const datos = JSON.parse(readFileSync(new URL('./datos/combustible.json', import.meta.url), 'utf8'))
const ctx = cargarAuditoria(rutaApp)
sembrar(ctx, datos)
const DESDE = '2026-07-24', HASTA = '2026-09-07'
const anom = auditar(ctx, DESDE, HASTA)
const J = new Map(ctx.AC_JORNADAS.map((j) => [j.cam + '|' + j.fecha, j]))

let fallos = 0
const ok = (n, c, d) => { console.log((c ? '✅' : '❌') + ' ' + n + (c ? '' : '  → ' + d)); if (!c) fallos++ }

// ── 1. Lo que no puede pasar ─────────────────────────────────────────────────────────────────
const r4c = anom.filter((a) => (a.cod || a.regla) === 'R4c')
const sobreImposible = r4c.filter((a) => { const j = J.get(a.cam + '|' + a.fecha); return j && j.consumo <= 0 })
ok('1. ningún R4c habla sobre un consumo negativo o cero', sobreImposible.length === 0,
   sobreImposible.length + ' lo hacen, p.ej. ' + (sobreImposible[0] ? sobreImposible[0].fecha + ' con consumo ' +
     J.get(sobreImposible[0].cam + '|' + sobreImposible[0].fecha).consumo + ' L' : ''))

// ── 2. El dato imposible EXISTE en este período: si no, la prueba no mide nada ───────────────
const negativas = ctx.AC_JORNADAS.filter((j) => j.consumo != null && j.consumo < 0)
ok('2. CONTROL POSITIVO: el período TIENE jornadas con consumo negativo', negativas.length > 0,
   'sin ellas esta prueba pasaría por el motivo equivocado')

// ── 3. …y esas jornadas NO quedan en silencio: R13 las recoge ────────────────────────────────
// R13 es un aviso AGRUPADO (una línea para toda la flota), así que se comprueba que exista
// cuando hay tanques que subieron, no que haya uno por jornada.
const grandes = negativas.filter((j) => j.consumo < -2 * (j.tol || 0))
const r13 = anom.filter((a) => (a.cod || a.regla) === 'R13')
ok('3. si hay tanques que subieron, R13 lo dice', grandes.length === 0 || r13.length > 0,
   grandes.length + ' jornadas con el tanque subido y ni un R13: quedarían mudas')

// ── 4. La regla sigue VIVA: que el guardián no la haya matado ────────────────────────────────
const ref = ctx._acRefRend(ctx.AC_JORNADAS)
const candidatas = ctx.AC_JORNADAS.filter((j) => {
  if (j.conf !== 'completa' || j.consumo == null || j.consumo <= 0) return false
  if (j.km == null || j.km < 30 || j.km > 350) return false
  const r = ref[j.cam]
  return !!(r && (r.fija || r.n >= 3) && r.mediana > 0)
})
ok('4. quedan jornadas donde R4c PODRÍA hablar (no quedó muerta)', candidatas.length > 50,
   'solo ' + candidatas.length + ' candidatas: el guardián dejó la regla sin alcance')

// ── 5. El guardián está en el código, y es el de consumo ─────────────────────────────────────
const plano = js.replace(/\s+/g, ' ')
ok('5. R4c exige consumo positivo', /if\(j\.consumo<=0\)return;/.test(plano),
   'falta el guardián: volvería a acusar sobre números imposibles')
ok('6. R4b ya lo exigía y lo sigue exigiendo', /j\.consumo!=null&&j\.consumo>0&&j\.km!=null/.test(plano),
   'R4b perdió su propia guarda')

console.log('\n' + (fallos === 0 ? '✅ TODAS PASAN' : '⛔ ' + fallos + ' MAL'))
process.exit(fallos === 0 ? 0 : 1)
