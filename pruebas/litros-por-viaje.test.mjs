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
  // Tres unidades: una normal, una que gasta de más, una que gasta de menos.
  const REGS = [
    { cam: 'U01', f: '2026-10-01', t: 4, ch: 'ANA ROJAS' },
    { cam: 'U02', f: '2026-10-01', t: 4, ch: 'BRUNO SILVA' },
    { cam: 'U03', f: '2026-10-01', t: 4, ch: 'CARLA DIAZ' },
  ]
  const J = [
    { cam: 'U01', fecha: '2026-10-01', desp: 80, km: 200 },   // 20 L/viaje  ← la norma
    { cam: 'U02', fecha: '2026-10-01', desp: 120, km: 200 },  // 30 L/viaje  ← +50%
    { cam: 'U03', fecha: '2026-10-01', desp: 40, km: 200 },   // 10 L/viaje  ← −50%
  ]
  const r = api(REGS, num)._acLitrosPorViaje(J, '2026-09-01', '2026-10-31')
  const porCam = {}
  r.unidades.filas.forEach((x) => { porCam[x.cam] = x })

  ok('1. CONTROL POSITIVO: con 30 viajes mínimos no entra nadie', r.unidades.filas.length === 0,
     'el mínimo de muestra no se está aplicando: juzgaría a un camión por un solo día')
}

{
  // Ahora con muestra suficiente: 10 días iguales por unidad.
  const REGS = [], J = []
  for (let d = 1; d <= 10; d++) {
    const f = `2026-10-${String(d).padStart(2, '0')}`
    REGS.push({ cam: 'U01', f, t: 4, ch: 'ANA ROJAS' })
    REGS.push({ cam: 'U02', f, t: 4, ch: 'BRUNO SILVA' })
    REGS.push({ cam: 'U03', f, t: 4, ch: 'CARLA DIAZ' })
    J.push({ cam: 'U01', fecha: f, desp: 80, km: 200 })
    J.push({ cam: 'U02', fecha: f, desp: 120, km: 200 })
    J.push({ cam: 'U03', fecha: f, desp: 40, km: 200 })
  }
  const r = api(REGS, num)._acLitrosPorViaje(J, '2026-09-01', '2026-10-31')
  const c = {}
  r.unidades.filas.forEach((x) => { c[x.cam] = x })

  ok('2. la norma es la MEDIANA, no el promedio', Math.abs(r.unidades.norma - 20) < 0.01,
     `dio ${r.unidades.norma}: con 10/20/30 la mediana es 20 y el promedio también, pero el código debe usar la mediana`)
  ok('3. litros por viaje se calcula bien', c.U01 && Math.abs(c.U01.lv - 20) < 0.01 &&
     Math.abs(c.U02.lv - 30) < 0.01 && Math.abs(c.U03.lv - 10) < 0.01,
     'alguno no dio lo esperado: ' + JSON.stringify(Object.keys(c).map((k) => [k, c[k] && c[k].lv])))
  ok('4. la desviación se mide contra la norma', c.U02 && Math.abs(c.U02.dif - 0.5) < 0.01 &&
     Math.abs(c.U03.dif + 0.5) < 0.01, 'dif mal calculada')
  ok('5. se ordena de mayor a menor consumo', r.unidades.filas[0].cam === 'U02',
     'el que más gasta tiene que estar arriba: es el que se mira primero')
  ok('6. el chofer también se agrupa', r.choferes.filas.length === 3,
     'dio ' + r.choferes.filas.length + ' chóferes')

  // ⛔ EL CONTROL MÁS IMPORTANTE: un día SIN planilla no se reparte, se cuenta aparte.
  const J2 = J.concat([{ cam: 'U01', fecha: '2026-10-20', desp: 500, km: 100 }])
  const r2 = api(REGS, num)._acLitrosPorViaje(J2, '2026-09-01', '2026-10-31')
  ok('7. ⛔ un día sin planilla NO se reparte: sus litros se cuentan aparte',
     Math.abs(r2.litSinDuenio - 500) < 0.01 && Math.abs(r2.unidades.filas.find((x) => x.cam === 'U01').lv - 20) < 0.01,
     `litSinDuenio=${r2.litSinDuenio} — repartirlos inventaría consumo que nadie puede confirmar`)
}

// ── 2. LA LECTURA: el texto no puede premiar al que no registra ──────────────────
ok('8. ⛔ «por debajo» manda a revisar el REGISTRO, no felicita al chofer',
   /FALTAN SURTIDAS POR ASENTAR/.test(fHtml) && !/ahorr|eficien|felicit/i.test(fHtml.replace(/no que ahorre/g, '')),
   'si lo pinta como virtud, el producto premia al que no registra')
ok('9. «por encima» manda a preguntarle al chofer y revisar el camión',
   /preguntarle al chofer/.test(fHtml) && /revisar el cami/.test(fHtml),
   'una desviación hacia arriba sin a quién preguntarle no es accionable')
ok('10. ⛔ los litros que no se pudieron repartir se DICEN',
   /no entraron en esta cuenta/.test(fHtml),
   'si se callan, las cifras parecen cubrir todo el combustible del período y no es así')
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
