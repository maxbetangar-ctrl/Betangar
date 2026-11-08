// ⛔ UNA CARGA ASENTADA DESPUÉS DE LA LECTURA DE LLEGADA NO ESTÁ EN ESA LECTURA
//
// 🔴 Medido el 07/11/2026: 12 jornadas reales con la carga asentada después de la medición de
//    llegada. En 7 de ellas el sistema sumaba al día un combustible que todavía no estaba en el
//    tanque y le imputaba al chofer hasta 446,3 L para 91 km ⇒ R4, que es la ÚNICA regla que le
//    atribuye a una PERSONA cómo manejó, salía con nombre y apellido por un consumo inexistente.
//
// ⛔ Y LA REGLA INGENUA («si la hora es mayor, se resta») ROMPE LAS OTRAS 5: ahí el tanque SUBIÓ
//    durante el día —una de 10 a 36 cm— con la carga guardada 14 min después de la llegada. El
//    combustible SÍ estaba en la lectura; la fila se guardó tarde. Restarla da consumo NEGATIVO,
//    que es una acusación PEOR: dice que entró combustible sin asentarse, cuando se asentó con
//    foto y GPS. Dos de esas 5 son el caso del 29/08 que se arregló el 08/09 — esto NO lo revierte.
//
// ✅ Lo que decide es EL NIVEL, no el reloj: un tanque no puede ganar combustible que no está.
//
// ⛔ La función se SACA de app.js, no se copia acá. Una copia de la regla en la prueba hace que la
//    prueba pase mientras el producto está roto. [[norma-dos-listas-a-mano-se-desincronizan]]
//
//   node pruebas/carga-despues-de-la-llegada.test.mjs [app.js]
import { readFileSync } from 'fs'

const js = readFileSync(process.argv[2] || new URL('../app.js', import.meta.url), 'utf8')

let fallos = 0
const ok = (n, cond, detalle) => {
  console.log((cond ? '✅' : '❌') + ' ' + n + (cond ? '' : '  → ' + detalle))
  if (!cond) fallos++
}

const saca = (nombre) => {
  const i = js.indexOf('function ' + nombre + '(')
  if (i < 0) return null
  let j = js.indexOf('{', i), prof = 0, fin = -1
  for (let k = j; k < js.length; k++) {
    if (js[k] === '{') prof++
    else if (js[k] === '}') { prof--; if (prof === 0) { fin = k + 1; break } }
  }
  return fin > 0 ? js.slice(i, fin) : null
}

const fCuadre = saca('_acDespDelCuadre')
const fEntradas = saca('_acEntradas')
const fTs = saca('_acTs')
const fNum = saca('_acNum')
// ⛔ `_acEntradas` consulta al GPS antes que al sello de guardado, asi que el sandbox
//    tiene que traer tambien esa funcion. Sin ella revienta con un ReferenceError adentro
//    del `new Function` -- la misma clase de defecto que la lista a mano del banco.
const fGps = saca('_acEntroDespuesDe') || ''
ok('0. las piezas existen en app.js', !!fCuadre && !!fEntradas && !!fTs && !!fNum,
   'falta alguna de _acDespDelCuadre / _acEntradas / _acTs / _acNum')
if (!fCuadre || !fEntradas || !fTs || !fNum) { console.log('\n⛔ Sin las funciones no se prueba nada.'); process.exit(1) }

const cuadre = new Function(fCuadre + '\n return _acDespDelCuadre;')()

// ── Las 12 jornadas REALES, con unidades neutras: la regla es aritmética, no es de nadie ──────
// cA = salida − llegada (en estas TODA la carga del día es posterior a la llegada, así que la
// carga "no posterior" es 0).
//
// ⛔ EL UMBRAL ES CERO, NO LA TOLERANCIA (±33,7 L en este tanque). Con −TOL, las 4 últimas
//    —jornadas reales del 28/07, donde media flota cargó 100 L y el tanque SUBIÓ— quedaban con
//    consumo NEGATIVO que ninguna regla caza. Una de ellas daba 1,75 km/L antes de tocar nada.
//    📌 Un arreglo que empeora un caso que estaba bien no está terminado. Esas 4 entran acá para
//      que no se pueda volver a aflojar el umbral sin que esta prueba lo diga.
const CASOS = [
  // [caso, salida, llegada, carga, cuenta_en_el_dia]
  ['U01 · el tanque bajó 43,3 L',   600.00, 556.75,  80.00, false],
  ['U02 · el tanque bajó 47,7 L',   153.74, 106.06, 200.00, false],
  ['U03 · el tanque bajó 47,7 L',   153.74, 106.06, 200.00, false],
  ['U04 · el tanque bajó 46,9 L',   117.93,  71.08, 350.00, false],
  ['U05 · el tanque bajó 107,5 L',  416.42, 308.96, 200.00, false],
  ['U06 · el tanque bajó 35,8 L',   201.50, 165.68, 400.00, false],  // el positivo MÁS chico
  ['U07 · el tanque bajó 46,3 L',   106.06,  59.76, 400.00, false],
  ['U08 · el tanque SUBIÓ 119,4 L', 344.78, 464.18, 150.00, true],   // el negativo MÁS chico
  ['U09 · el tanque SUBIÓ 238,8 L', 141.80, 380.60, 300.00, true],
  ['U10 · el tanque SUBIÓ 271,7 L', 285.08, 556.75, 300.00, true],   // histórico 29/08
  ['U11 · el tanque SUBIÓ 310,4 L', 106.06, 416.42, 350.00, true],
  ['U12 · el tanque SUBIÓ 349,9 L', 237.32, 587.18, 417.35, true],   // histórico 29/08
  // Las 4 del 28/07: SUBIDAS CHICAS, adentro de la tolerancia. Son las que delataron el umbral.
  ['U13 · subió 10,2 L (daba 1,75 km/L)', 567.35, 577.53, 100.00, true],
  ['U14 · subió 17,0 L',                  523.18, 540.21, 100.00, true],
  ['U15 · subió 31,7 L',                  545.81, 577.53, 100.00, true],
  ['U16 · subió 47,4 L',                  464.18, 511.58, 100.00, true],
  // Y el borde exacto: el tanque quedó IGUAL. Excluir deja consumo 0, que es posible (≥ 0) —
  // y si ese día hubo km, `rendImposible` lo caza y la jornada no se cuadra. Acá no se inventa.
  ['U17 · el tanque quedó igual',         499.85, 499.85, 100.00, false],
]

let bien = 0
CASOS.forEach(([n, sal, lle, carga, cuenta]) => {
  const r = cuadre(sal, lle, carga, carga)
  const esperado = cuenta ? carga : 0
  const pasa = Math.abs(r - esperado) < 0.01
  if (pasa) bien++
  ok('1.' + n, pasa, 'devolvió ' + r + ' y se esperaba ' + esperado +
     ' (consumo que resultaría: ' + Math.round((sal + r - lle) * 100) / 100 + ' L)')
})
ok('2. las 17 jornadas reales se resuelven bien', bien === CASOS.length, bien + ' de ' + CASOS.length)

// ── ⛔ EL CONSUMO NUNCA PUEDE QUEDAR NEGATIVO ────────────────────────────────────────────────
// Es la propiedad que hace falsa a la regla ingenua, y la que de verdad protege al chofer.
let negativos = 0
CASOS.forEach(([n, sal, lle, carga]) => {
  const c = sal + cuadre(sal, lle, carga, carga) - lle
  if (c < 0) { negativos++; console.log('   ⛔ ' + n + ' quedó en ' + c.toFixed(1) + ' L') }
})
ok('3. NINGUNA jornada queda con consumo negativo (ni por poco)', negativos === 0, negativos + ' quedaron')

// ── Control POSITIVO: la regla INGENUA tiene que FALLAR acá ──────────────────────────────────
// Si esta aserción se pusiera verde, la prueba no estaría midiendo nada: significaría que restar
// siempre da el mismo resultado que la regla buena. [[norma-control-positivo-antes-de-creerle-al-vacio]]
const ingenua = CASOS.filter(([, sal, lle, , cuenta]) => cuenta && (sal - lle) < 0).length
ok('4. CONTROL POSITIVO: la regla ingenua rompería 9 jornadas', ingenua === 9,
   'rompería ' + ingenua + ': si da 0, los casos de prueba no distinguen las dos reglas')

// ── Los bordes ───────────────────────────────────────────────────────────────────────────────
ok('5. sin carga posterior no toca nada', cuadre(300, 200, 150, 0) === 150,
   'alteró el despacho de un día que no tiene carga posterior')
ok('6. sin lectura de salida no decide: deja el despacho como está',
   cuadre(null, 200, 150, 150) === 150, 'decidió sin tener con qué')
ok('7. sin lectura de llegada tampoco', cuadre(300, null, 150, 150) === 150, 'decidió sin tener con qué')
ok('8. una carga posterior PARCIAL deja la otra adentro',
   cuadre(300, 260, 150, 100) === 50, 'quedó ' + cuadre(300, 260, 150, 100) + ' y debía quedar 50')
// ⛔ UN SOLO LITRO DE SUBIDA YA ES PRUEBA: el combustible esta ahi. No hay banda gris.
ok('9. con el tanque 1 L mas arriba la carga YA se cuenta',
   cuadre(100, 101, 200, 200) === 200, 'dejo pasar un consumo negativo de 1 L')

// ── El filtro de `_acEntradas`: que SEPARE por el sello de tiempo ────────────────────────────
const T = (s) => '2026-11-04 ' + s + ':00+00'
const SUR = [
  { cam: 'U01', fecha: '2026-11-04', litros: 100, created_at: T('12:00') },   // antes
  { cam: 'U01', fecha: '2026-11-04', litros: 250, created_at: T('23:00') },   // después
]
const armar = () => new Function('AC_META', 'AC_SURTIDAS', 'AC_GASOIL',
  fNum + '\n' + fTs + '\n' + fGps + '\n' + fEntradas + '\n return _acEntradas;')({}, SUR, [])
const ent = armar()
const corte = Date.parse('2026-11-04T20:00:00Z')
ok('10. sin `despuesDe` cuenta todo', ent('U01', '2026-11-04', '2026-11-04', true) === 350,
   'quedó ' + ent('U01', '2026-11-04', '2026-11-04', true))
ok('11. con `despuesDe` cuenta SOLO lo posterior',
   ent('U01', '2026-11-04', '2026-11-04', true, null, corte) === 250,
   'quedó ' + ent('U01', '2026-11-04', '2026-11-04', true, null, corte))
// ⛔ El histórico `gasoil` no tiene hora: no se puede ubicar y NO puede colarse en el subconjunto.
const entG = new Function('AC_META', 'AC_SURTIDAS', 'AC_GASOIL',
  fNum + '\n' + fTs + '\n' + fGps + '\n' + fEntradas + '\n return _acEntradas;')({}, [], [{ cam: 'U01', f: '2026-11-04', lit: 500 }])
ok('12. el histórico sin hora NUNCA entra en lo "posterior"',
   entG('U01', '2026-11-04', '2026-11-04', true, null, corte) === 0,
   'se coló un dato sin hora, que es justo lo que no se puede ubicar')
ok('13. …pero sí cuenta cuando no se pide el subconjunto',
   entG('U01', '2026-11-04', '2026-11-04', true) === 500, 'se perdió el histórico')

// ── Y que el PRODUCTO lo use: tenerlo no es usarlo ───────────────────────────────────────────
ok('14. el consumo del día usa `despJornada`, no `desp`',
   /j\.consumo=.*j\.salida\+j\.despJornada-j\.llegada/.test(js.replace(/\s+/g, ' ')),
   'la función existe pero el consumo sigue sumando el despacho entero')
ok('15. la tolerancia va sobre lo que entró al cuadre',
   /j\.tol=_acTol\(j\.tanque,j\.salidaCm,j\.llegadaCm,j\.despJornada\)/.test(js.replace(/\s+/g, ' ')),
   'la tolerancia sigue contando volumen que no entró al balance')
// Lo que importa no es la FORMA de escribirlo sino que el numero apartado LLEGUE A LA PANTALLA:
// si no, la fila muestra salida, despacho, llegada y consumo, y los cuatro no suman.
ok('16. lo apartado se DICE, no se esconde',
   /_acFmt\(j\.despPost/.test(js) && /cargaPostFuera/.test(js),
   'se descuenta en silencio: los numeros que ve el dueno no sumarian')

console.log('\n' + (fallos === 0 ? '✅ TODAS PASAN' : '⛔ ' + fallos + ' MAL'))
process.exit(fallos === 0 ? 0 : 1)
