// ⛔ EL VEREDICTO DE UN TRAMO DE PATIO: CADA CAUSA EMPUJA EL NIVEL EN UN SOLO SENTIDO
//
// Acá vive R1, la regla que dice que FALTÓ COMBUSTIBLE. Es la afirmación más cara del módulo:
// manda a revisar quién tuvo acceso al patio. Una falsa cuesta la confianza entera.
//
// Lo que puede cambiar el nivel entre dos lecturas, y hacia dónde:
//    rodar    → el nivel solo puede BAJAR, hasta `volKm`      ⇒ se le resta al FALTANTE
//    cargar   → el nivel solo puede SUBIR, hasta `cargaCerca` ⇒ se le resta al SOBRANTE
//    la regla → ±2·TOL para cualquier lado                     ⇒ se les resta a las dos
//
// ⛔ LA PARTE CONTRAINTUITIVA, y la que estaba mal: el FALTANTE no resta la carga. No se sabe
//    cuándo entró, pero si entró DENTRO del tramo la pérdida real es `caída + carga`, y si entró
//    ANTES es `caída`. En los dos casos es mayor o igual a la caída medida ⇒ ignorarla SUBESTIMA,
//    nunca inventa. Hasta el 07/11/2026 esto se callaba entero y dejaba 277 tramos sin mirar.
//
// ⛔ Y LA TRAMPA DEL OTRO LADO: una regla que solo mirara los litros habría inventado 3
//    acusaciones en tramos de fin de semana donde el camión rodó 177, 335 y 240 km. Esos 3 casos
//    REALES están acá abajo justamente para que no se pueda aflojar el descuento de los km.
//
// ⛔ La función se SACA de app.js, no se copia. [[norma-dos-listas-a-mano-se-desincronizan]]
//
//   node pruebas/noche-cada-causa-un-sentido.test.mjs [app.js]
import { readFileSync } from 'fs'

const js = readFileSync(process.argv[2] || new URL('../app.js', import.meta.url), 'utf8')
let fallos = 0
const ok = (n, c, d) => { console.log((c ? '✅' : '❌') + ' ' + n + (c ? '' : '  → ' + d)); if (!c) fallos++ }

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

const fuente = saca('_acVeredictoNoche')
ok('0. _acVeredictoNoche existe en app.js', !!fuente, 'no está: la prueba no puede medir nada')
if (!fuente) { console.log('\n⛔ Sin la función no se prueba nada.'); process.exit(1) }
const veredicto = new Function(fuente + '\n return _acVeredictoNoche;')()

const TOL = 33.7            // el tanque típico: ~11,9 L/cm y σ=1 cm ⇒ 2·TOL ≈ 67,4 L

// ── Los casos REALES, con unidades neutras ────────────────────────────────────────────────────
// [nombre, delta (salida−llegada: negativo = bajó), volKm, cargaCerca, veredicto esperado]
const CASOS = [
  // Los DOS que el criterio nuevo recupera, y que antes nadie miraba
  ['U01 · bajó 167,2 L y solo rodó 33 km (17,4 L)', -167.2, 17.4, 0, 'falta'],
  ['U02 · bajó 86,0 L, quieto, con 200 L cargados cerca', -86.0, 0, 200, 'falta'],

  // ⛔ LOS TRES DE FIN DE SEMANA: el camión TRABAJÓ. Si estos dan 'falta', la regla inventa.
  ['U03 · bajó 107,5 L pero rodó 177 km (88,5 L)', -107.5, 88.5, 0, null],
  ['U04 · bajó 95,5 L pero rodó 335 km (167,5 L)', -95.5, 167.5, 200, null],
  ['U05 · bajó 95,5 L pero rodó 240 km (120,0 L)', -95.5, 120.0, 0, null],

  // El faltante clásico, que NO puede dejar de funcionar
  ['U06 · bajó 150 L, quieto, sin cargas', -150, 0, 0, 'falta'],
  ['U07 · bajó 50 L, quieto: adentro del error de la regla', -50, 0, 0, null],

  // ⛔ EL SOBRANTE SÍ RESTA LA CARGA. Estos protegen el fallo del 14/10, donde se acusó en
  //    noches con 200 y 400 L asentados ese mismo día.
  ['U08 · subió 150 L con 200 L cargados: la carga lo explica', 150, 0, 200, null],
  ['U09 · subió 380 L con 400 L cargados: la carga lo explica', 380, 0, 400, null],
  ['U10 · subió 300 L con solo 30 L cargados', 300, 0, 30, 'sobra'],
  ['U11 · subió 300 L sin ninguna carga', 300, 0, 0, 'sobra'],
  ['U12 · subió 50 L: adentro del error de la regla', 50, 0, 0, null],

  // Los km NO achican un sobrante (rodar no puede subir el nivel)
  ['U13 · subió 300 L y además rodó: los km no lo explican', 300, 200, 0, 'sobra'],
]

let bien = 0
CASOS.forEach(([n, delta, volKm, carga, esp]) => {
  const r = veredicto(delta, TOL, volKm, carga)
  const pasa = r === esp
  if (pasa) bien++
  ok('1.' + n, pasa, 'dio «' + r + '» y se esperaba «' + esp + '»')
})
ok('2. los ' + CASOS.length + ' casos se resuelven bien', bien === CASOS.length, bien + ' de ' + CASOS.length)

// ── CONTROL POSITIVO: la regla SIMÉTRICA (restarle la carga a las dos direcciones) ────────────
// Es la que estaba antes en espíritu. Si no rompiera nada, esta prueba no mediría nada.
const simetrica = (d, t, vk, c) => {
  const f = -d
  if (f > 2 * t + (vk || 0) + (c || 0)) return 'falta'
  if (d > 2 * t + (c || 0)) return 'sobra'
  return null
}
const difieren = CASOS.filter(([, d, vk, c, esp]) => simetrica(d, TOL, vk, c) !== esp).length
ok('3. CONTROL POSITIVO: la regla simétrica falla en 1 caso', difieren === 1,
   'falla en ' + difieren + ': si da 0, los casos no distinguen las dos reglas')

// ── CONTROL POSITIVO 2: la regla que IGNORA los km ───────────────────────────────────────────
// Es la que habría inventado 3 acusaciones de fin de semana.
const sinKm = (d, t, vk, c) => {
  const f = -d
  if (f > 2 * t) return 'falta'
  if (d > 2 * t + (c || 0)) return 'sobra'
  return null
}
const inventa = CASOS.filter(([, d, vk, c, esp]) => sinKm(d, TOL, vk, c) === 'falta' && esp !== 'falta').length
ok('4. CONTROL POSITIVO: ignorar los km inventa 3 acusaciones', inventa === 3,
   'inventa ' + inventa + ': los casos de fin de semana no están discriminando')

// ── Y que el PRODUCTO lo use, con los ingredientes bien armados ──────────────────────────────
const plano = js.replace(/\s+/g, ' ')
ok('5. el bloque de la noche decide con esta función',
   /_veredicto=_acVeredictoNoche\(delta,tolN,volKm,cargaCerca\)/.test(plano),
   'la función existe pero el bloque no la usa: tenerlo no es usarlo')
ok('6. volKm sale de los km fantasma y del rendimiento de ESA unidad',
   /volKm=\(kmFantasma>0&&_refNoche>0\)\?/.test(plano), 'volKm no se calcula del odómetro')
ok('7. sin referencia de rendimiento NO se descuenta nada (más exigente, no menos)',
   /volKm=\(kmFantasma>0&&_refNoche>0\)\?[^:]+:0/.test(plano),
   'si falta la referencia podría estar descontando basura')
ok('8. la ventana de cargas cubre TODO el tramo, no las dos puntas',
   /cargaCerca=Math\.round\(_acEntradas\(u,fLle,hoy\.fecha,true\)/.test(plano),
   'una carga del sábado quedaría fuera de la cuenta')
ok('9. R11 ya NO hace continue: R1 evalúa igual', !/continue; \/\/ rodó: R1 no tiene nada que decir/.test(plano),
   'R11 sigue llevándose puesta a R1')
ok('10. hay tope de días y está declarado como constante', /var AC_NOCHE_DIAS_MAX=\d+;/.test(plano),
   'el tope está clavado en el código o no existe')

// ── ⛔ EL TEXTO NO PUEDE AFIRMAR LO QUE NO SABE ──────────────────────────────────────────────
// Antes decía SIEMPRE «el odómetro confirma que no se movió» y «no hay ninguna carga registrada».
// Con la regla nueva las dos frases pueden ser falsas, y un aviso que afirma algo falso se
// desarma la primera vez que alguien lo comprueba.
ok('11. el aviso dice los km SOLO si rodó', /kmFantasma>0 \? \('rodó '/.test(plano) || /kmFantasma>0\?\('rodó '/.test(plano),
   'el texto no se arma con los hechos del tramo')
ok('12. el aviso dice la carga SOLO si hubo', /cargaCerca>0 \? \('hubo '/.test(plano) || /cargaCerca>0\?\('hubo '/.test(plano),
   'el texto puede estar afirmando que no hay cargas cuando sí las hay')

console.log('\n' + (fallos === 0 ? '✅ TODAS PASAN' : '⛔ ' + fallos + ' MAL'))
process.exit(fallos === 0 ? 0 : 1)
