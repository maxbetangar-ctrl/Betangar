// ═══════════════════════════════════════════════════════════════════════════════
// ⛽ LITROS POR VIAJE — LA REGLA Y, SOBRE TODO, CÓMO SE LEE
//
// 🔴 LA IDEA ES DE MÁXIMO (08/11/2026): saber cuántos litros gasta cada camión por
//    viaje, y quién se sale del promedio, como refuerzo para detectar desvío.
//
// 📌 LO QUE HACE VÁLIDA LA IDEA, medido antes de construirla sobre 3 meses reales:
//    los km POR VIAJE tienen **5% de dispersión** (47,9 a 59,7 km). Un viaje es un
//    viaje. Si las rutas fueran de largos muy distintos, comparar litros por viaje
//    no diría nada y esto sería un aviso que acusa al azar.
//
// ⛔ LO QUE ESTA PRUEBA PROTEGE DE VERDAD es la LECTURA, no la cuenta:
//      · por ENCIMA → mirar al chofer y al camión;
//      · por DEBAJO → mirar el REGISTRO. Gastar mucho menos haciendo los mismos
//        kilómetros casi siempre significa que faltan surtidas por asentar. Si el
//        producto lo pintara como virtud, premiaría al que no registra — que es
//        exactamente al revés de para qué existe el módulo.
//
// ⚠️ LO QUE NO PRUEBA: no prueba que la banda de ±20% sea la correcta para siempre
//    (sale de la dispersión medida hoy), ni que un camión fuera de banda esté
//    robando. Prueba que la cuenta no mienta y que el texto no engañe.
// ═══════════════════════════════════════════════════════════════════════════════
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const AQUI = path.dirname(fileURLToPath(import.meta.url))
const js = readFileSync(path.join(AQUI, '..', 'app.js'), 'utf8')

let fallos = 0
const ok = (n, c, d) => { console.log((c ? '✅' : '❌') + ' ' + n + (c ? '' : '  → ' + d)); if (!c) fallos++ }

const saca = (nombre) => {
  const i = js.indexOf('function ' + nombre + '(')
  if (i < 0) return null
  let p = 0, fin = -1
  for (let k = js.indexOf('{', i); k < js.length; k++) {
    if (js[k] === '{') p++
    else if (js[k] === '}') { p--; if (p === 0) { fin = k + 1; break } }
  }
  return js.slice(i, fin)
}

// ── 0. CONTROL POSITIVO ──────────────────────────────────────────────────────────
const fCalc = saca('_acLitrosPorViaje'), fHtml = saca('_acLpvHtml')
ok('0. CONTROL POSITIVO: las dos funciones existen', !!fCalc && !!fHtml,
   'falta: ' + [['_acLitrosPorViaje', fCalc], ['_acLpvHtml', fHtml]].filter(x => !x[1]).map(x => x[0]).join(', '))
if (!fCalc || !fHtml) { console.log('\n⛔ sin las funciones no se prueba nada.'); process.exit(1) }

// ── 1. LA CUENTA, con datos armados a mano ───────────────────────────────────────
const api = new Function(
  'REGS', '_acNum',
  fCalc + '\n return {_acLitrosPorViaje:_acLitrosPorViaje};')
const num = (x) => { const v = parseFloat(x); return isFinite(v) ? v : null }

{
  // ⛔ EL MÍNIMO DE MUESTRA SUBIÓ A 120 VIAJES (unos dos meses). Con 30 el cuadro señalaba 8 de
  //    12 unidades en un informe de un mes — ruido, no hallazgos. Medido: a 1 mes la dispersión
  //    es 26%; a 3 meses, 13%.
  const REGS = [
    { cam: 'U01', f: '2026-10-01', t: 4, ch: 'ANA ROJAS' },
  ]
  const J = [{ cam: 'U01', fecha: '2026-10-01', desp: 80, km: 200 }]
  const r = api(REGS, num)._acLitrosPorViaje(J, '2026-09-01', '2026-10-31')
  ok('1. CONTROL POSITIVO: con pocos viajes NO entra nadie', r.unidades.filas.length === 0,
     'el mínimo de muestra no se aplica: juzgaría a un camión por un día')
  ok('1b. …y se dice cuántas quedaron afuera por muestra corta', r.cortos === 1 && r.minViajes === 120,
     `cortos=${r.cortos} min=${r.minViajes} — una unidad ausente se lee como «esa está bien»`)
}

{
  // ⚠️ 31 días (octubre entero) × 4 viajes = 124 por unidad, que pasa el mínimo de 120.
  //    La primera versión iba hasta 40 y generaba «2026-10-32»: fechas que no existen, que
  //    quedaban fuera del rango y mandaban sus litros a «sin planilla». El fixture mentía.
  //   U01 y U04: 20 L/viaje · 2,50 km/L   ← la norma
  //   U02: 30 L/viaje · 1,67 km/L         ← gasta más, y el km/L lo CONFIRMA
  //   U05: 30 L/viaje · 2,50 km/L         ← gasta más por viaje pero su RUTA es más larga
  const REGS = [], J = []
  for (let d = 1; d <= 31; d++) {
    const fe = '2026-10-' + String(d).padStart(2, '0')
    // ⚠️ CINCO unidades, no cuatro: con [20,20,30,30] la mediana cae en 30 y los que estaban
    //    BIEN quedaban marcados. Hace falta mayoría clara en la norma para que la mediana sea
    //    la norma de verdad.
    for (const [cam, ch] of [['U01', 'ANA ROJAS'], ['U04', 'DORA PAZ'], ['U06', 'FELIX SOTO'],
      ['U02', 'BRUNO SILVA'], ['U05', 'ELSA MORA']]) {
      REGS.push({ cam, f: fe, t: 4, ch })
    }
    J.push({ cam: 'U01', fecha: fe, desp: 80, km: 200 })
    J.push({ cam: 'U04', fecha: fe, desp: 80, km: 200 })
    J.push({ cam: 'U06', fecha: fe, desp: 80, km: 200 })
    J.push({ cam: 'U02', fecha: fe, desp: 120, km: 200 })   // +50% L/viaje, km/L peor
    J.push({ cam: 'U05', fecha: fe, desp: 120, km: 300 })   // +50% L/viaje, km/L IGUAL
  }
  const r = api(REGS, num)._acLitrosPorViaje(J, '2026-09-01', '2026-10-31')
  const c = {}
  r.unidades.filas.forEach((x) => { c[x.cam] = x })

  ok('2. la norma es la MEDIANA, no el promedio', Math.abs(r.unidades.norma - 20) < 0.01 ||
     Math.abs(r.unidades.norma - 30) < 0.01,
     `dio ${r.unidades.norma}`)
  ok('3. litros por viaje se calcula bien',
     c.U01 && Math.abs(c.U01.lv - 20) < 0.01 && c.U02 && Math.abs(c.U02.lv - 30) < 0.01,
     'alguno no dio lo esperado')
  ok('4. ⛔ y el KM POR LITRO también', c.U01 && Math.abs(c.U01.kl - 2.5) < 0.01 &&
     c.U02 && Math.abs(c.U02.kl - 1.6667) < 0.01,
     'sin km/L no hay con qué contestar «es que mi ruta es más larga»')

  // ⛔ EL CONTROL QUE MÁS IMPORTA, y nació de una objeción de Alejandra:
  //    «¿no sería más preciso gasto de combustible contra kilometraje?».
  ok('5. ⛔ se CONFIRMA al que se sale en las DOS medidas', c.U02 && c.U02.confirmado === true,
     'U02 gasta 50% más por viaje Y rinde peor por km: eso sí es del camión')
  ok('6. ⛔ y NO se confirma al que solo se sale por viaje',
     c.U05 && c.U05.confirmado !== true && c.U05.soloViajes === true,
     'U05 gasta 50% más por viaje pero rinde IGUAL por km: su ruta es más larga, no es el camión. ' +
     'Señalarlo sería acusar a quien le tocó la parroquia lejos.')
  ok('7. los que están en la norma no se marcan',
     c.U01 && !c.U01.confirmado && !c.U01.soloViajes, 'se marcó a uno que está bien')

  // Un día SIN planilla no se reparte, y además se CUENTA.
  // Un camión que NO tiene planilla ninguna: así el día queda sin dueño de verdad.
  const J2 = J.concat([{ cam: 'U09', fecha: '2026-10-20', desp: 500, km: 100 }])
  const r2 = api(REGS, num)._acLitrosPorViaje(J2, '2026-09-01', '2026-10-31')
  ok('8. ⛔ un día sin planilla NO se reparte, y se cuenta aparte',
     Math.abs(r2.litSinDuenio - 500) < 0.01 && r2.diasSinPlanilla === 1 && r2.fechasSinPlanilla === 1,
     `litSinDuenio=${r2.litSinDuenio} dias=${r2.diasSinPlanilla} — el informe decía «25 días» ` +
     'contando anomalías R11, que miden kilómetros y no días')
}

// ── 2. LA LECTURA: el texto no puede premiar al que no registra ──────────────────
ok('8. ⛔ «por debajo» manda a revisar el REGISTRO, no felicita al chofer',
   /FALTAN SURTIDAS POR ASENTAR/.test(fHtml) && !/ahorr|eficien|felicit/i.test(fHtml.replace(/no que ahorre/g, '')),
   'si lo pinta como virtud, el producto premia al que no registra')
ok('9. «por encima» manda a preguntarle al chofer y revisar el camión',
   /preguntarle al chofer/.test(fHtml) && /revisar el cami/.test(fHtml),
   'una desviación hacia arriba sin a quién preguntarle no es accionable')
// ⛔ LO QUE FALTA SE DICE COMO COBERTURA, NO COMO ERROR. El texto anterior prometía que las
//    cifras «se vuelven exactas» cuando entren las planillas — FALSO, y peor que un error de
//    cuenta: hace desconfiar de números que están bien. Medido el 08/11: calcular con el
//    período completo y cortado en la última planilla da **0,0% de diferencia** en las 12
//    unidades, y el mismo orden. Un día sin planilla se excluye ENTERO, no contamina nada.
ok('10a. ⛔ lo que falta se dice, y se dice como COBERTURA',
   /cubren el <b>/.test(fHtml) && /del combustible del per/.test(fHtml),
   'si se calla, las cifras parecen cubrir todo el combustible del período y no es así')
ok('10b. ⛔ y NO promete que las cifras cambien cuando entren las planillas',
   !/se vuelven exactas/.test(fHtml) && /no cambia cuando esas planillas entren/.test(fHtml),
   'prometer exactitud futura implica que lo de hoy está mal, y no lo está')
ok('11. y se explica que la norma sale de los datos, no de un número a mano',
   /MEDIANA del período/.test(fHtml), 'un umbral sin origen se discute para siempre')

// ── 2b. EL NOMBRE SE RESUELVE CON LO QUE YA EXISTE ───────────────────────────────
// ⛔ Ya habia un resolvedor en el producto (`_nombreCanonico` + `_empPorNombre` +
//    el mapa de alias). Medido contra los 26 nombres reales de chofer: resuelve 25,
//    incluido "YURBENIS BERMUDEZ" -> "YURVENIS FRANCISCO BERMUDEZ SUAREZ". Escribir
//    un septimo mecanismo al lado habria sido otra lista a mano que se desincroniza.
//    [[norma-antes-de-escribir-una-regla-buscar-si-ya-esta]]
ok('13. el chofer pasa por el resolvedor que YA EXISTE',
   /_nombreCanonico/.test(fCalc),
   'si agrupa por el texto crudo, el mismo senor escrito de dos formas sale en dos filas')
ok('14. ...y si el resolvedor falla, no revienta el reporte',
   /catch\s*\(/.test(fCalc) && /typeof _nombreCanonico==='function'/.test(fCalc),
   'una excepcion al resolver un nombre no puede tumbar toda la tarjeta')

// ── 3. CONTROL NEGATIVO ──────────────────────────────────────────────────────────
{
  const falso = 'gasta menos: excelente rendimiento, felicitar al chofer'
  ok('12. CONTROL NEGATIVO: un texto que felicita se detectaría', /felicit/i.test(falso),
     'el patrón no detecta ni el caso evidente')
}

console.log(fallos ? `\n⛔ ${fallos} MAL` : '\n✅ TODAS PASAN')
process.exit(fallos ? 1 : 0)
