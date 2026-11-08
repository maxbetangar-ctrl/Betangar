// ⛔ EL PISO DE DETECCIÓN — «0 anomalías» NO ES «no falta nada»
//
// 🔴 EL PROBLEMA. Las reglas disparan cuando la diferencia pasa de `2·TOL`, y TOL sale de la
//    varilla: cuánto cambia el volumen por centímetro, por el error de leer en centímetros
//    enteros. Debajo de ese piso la auditoría no ve nada — y no tiene manera de verlo. La
//    pantalla decía «0 anomalías» sin decir esto, y así se lee como «no falta nada».
//
// 📌 MEDIDO el 08/11/2026 sobre las 1.401 jornadas reales:
//      piso mediano  67,6 L  ·  consumo mediano de un día  59,7 L  ⇒ el piso es el 113% de un día
//      689 de 1.234 jornadas (56%) tienen el piso POR ENCIMA del consumo del día: ahí no se puede
//      detectar ningún faltante, por grande que sea en proporción.
//
// ⚠️ NO SE ARREGLA CON CÓDIGO: baja a la mitad leyendo la regla al medio centímetro (la PWA ya
//    acepta décimas; el 96,9% de las lecturas son enteras por costumbre). Lo que sí era un defecto
//    es no decirlo. [[norma-falta-de-dato-no-es-un-dato]]
//
//   node pruebas/hasta-donde-ve-la-auditoria.test.mjs [app.js]
import { readFileSync } from 'fs'
import { cargarAuditoria, sembrar, auditar } from './_banco-combustible.mjs'

const rutaApp = process.argv[2] || new URL('../app.js', import.meta.url)
const js = readFileSync(rutaApp, 'utf8')
const ctx = cargarAuditoria(rutaApp)

let fallos = 0
const ok = (n, c, d) => { console.log((c ? '✅' : '❌') + ' ' + n + (c ? '' : '  → ' + d)); if (!c) fallos++ }

// ── 1. ⛔ LA CUADRATURA, que es la parte que es fácil hacer mal ──────────────────────────────
// Los errores de lectura de días distintos son INDEPENDIENTES: se combinan como √Σtol², no
// sumándose. Sumarlos daría 184 jornadas × 34 L = 6.200 L y haría parecer que el consumo del
// período no se sabe, cuando se sabe bastante mejor que el de un día suelto.
const tresIguales = [{ tol: 10, consumo: 100 }, { tol: 10, consumo: 100 }, { tol: 10, consumo: 100 }]
const pd3 = ctx._acPisoDeteccion(tresIguales)
ok('1. el margen del período se combina en CUADRATURA, no sumando',
   Math.abs(pd3.margenPeriodo - Math.sqrt(300)) < 0.1,
   'dio ' + pd3.margenPeriodo + ' y √(3·10²)=' + Math.sqrt(300).toFixed(1) + ' — si diera 30 estaría sumando')
ok('2. …y por eso el margen crece con √n, no con n',
   ctx._acPisoDeteccion(Array(12).fill({ tol: 10, consumo: 100 })).margenPeriodo < 40,
   '12 jornadas de ±10 dan ±34,6, no ±120')

// ── 2. El piso y las jornadas ciegas ────────────────────────────────────────────────────────
const mezcla = [
  { tol: 10, consumo: 100 },   // ve: piso 20 < 100
  { tol: 10, consumo: 100 },
  { tol: 40, consumo: 50 },    // CIEGA: piso 80 > 50
  { tol: 40, consumo: 50 },    // CIEGA
]
const pdm = ctx._acPisoDeteccion(mezcla)
ok('3. el piso es 2·TOL, no TOL', pdm.piso === 50, 'dio ' + pdm.piso + ' y la mediana de [20,20,80,80] es 50')
ok('4. cuenta las jornadas donde el piso tapa el día entero', pdm.ciegas === 2 && pdm.pctCiegas === 50,
   'dio ' + pdm.ciegas + ' ciegas de ' + pdm.conAmbos)
ok('5. y dice qué porcentaje de un día típico es el piso', pdm.pctDelDia === Math.round(50 * 100 / 75),
   'dio ' + pdm.pctDelDia + '% con piso 50 y consumo mediano 75')

// ── 3. ⛔ CONTROL POSITIVO: sin datos NO INVENTA un piso ────────────────────────────────────
// Un piso `null` se tiene que leer como «no se sabe», no como «el piso es cero» — que sería
// decir que la auditoría lo ve todo. [[norma-falta-de-dato-no-es-un-dato]]
const vacio = ctx._acPisoDeteccion([])
ok('6. sin jornadas devuelve null, NO cero', vacio.piso === null && vacio.margenPeriodo === null,
   'un piso de 0 significaría «se ve absolutamente todo», que es lo contrario de no saber')
ok('7. con jornadas sin tolerancia tampoco se inventa',
   ctx._acPisoDeteccion([{ consumo: 100 }, { consumo: 90 }]).piso === null, 'inventó un piso sin tolerancia')

// ── 4. Sobre los datos REALES del volcado ───────────────────────────────────────────────────
let datos = null
try { datos = JSON.parse(readFileSync(new URL('./datos/combustible.json', import.meta.url), 'utf8')) } catch (e) { datos = null }
if (!datos) console.log('—  8-9. (no aplica: este repo no versiona el volcado)')
else {
  sembrar(ctx, datos)
  auditar(ctx, '2026-07-24', '2026-09-07')
  const pd = ctx._acPisoDeteccion(ctx.AC_JORNADAS || [])
  ok('8. sobre datos reales el piso es del orden de decenas de litros',
     pd.piso != null && pd.piso > 10 && pd.piso < 200,
     'dio ' + pd.piso + ' L — fuera de rango, la fórmula de TOL cambió y esto hay que volver a medir')
  // ⛔ ESTA ES LA CIFRA QUE JUSTIFICA TODO EL PANEL. Si algún día baja de 100%, el módulo pasó a
  //    ver un día entero y el texto de la pantalla hay que volver a escribirlo: ya no sería cierto.
  ok('9. y el piso sigue siendo MAYOR que el consumo de un día típico',
     pd.pctDelDia != null && pd.pctDelDia >= 100,
     'dio ' + pd.pctDelDia + '%: si bajó de 100 el panel está diciendo algo que ya no es cierto')
}

// ── 5. Y que la pantalla lo muestre ─────────────────────────────────────────────────────────
const plano = js.replace(/\s+/g, ' ')
ok('10. el panel existe en la pantalla', /Hasta dónde ve esta auditoría/.test(plano),
   'la función existe pero nadie la dibuja: tenerlo no es mostrarlo')
ok('11. el margen va PEGADO al consumo del período, no en una nota al pie',
   /margen del método ±/.test(plano), 'un número sin su margen se lee como exacto')
ok('12. el panel dice que debajo del piso NO SE VE NADA',
   /no se ve nada/.test(plano), 'sin esa frase el piso se lee como un detalle técnico')
ok('13. y dice cómo se baja el piso', /medio centímetro/.test(plano),
   'un límite sin salida es una excusa')

console.log('\n' + (fallos === 0 ? '✅ TODAS PASAN' : '⛔ ' + fallos + ' MAL'))
process.exit(fallos === 0 ? 0 : 1)
