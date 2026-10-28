// ══════════════════════════════════════════════════════════════════════════════
// ⛔ UNA UNIDAD CON ESPACIOS EN EL NOMBRE, Y UN ALTA QUE NO MIENTE
//
// Esta prueba existe por SOP-20261026-BEQI. Alejandra tenía unas llantas de repuesto y
// las dio de alta como unidad para poder emitirles una orden de reparación. Pasaron
// DOS cosas, y las dos eran nuestras:
//
//   (a) El alta dijo «guardada» y la fila NO llegó a la base. Lo dijo DOS VECES —la
//       auditoría tiene `Unidad guardada · Llantas de repuesto` el 23/10 15:20 y el
//       26/10 16:36— porque `guardarUnidad` escribía en memoria y auditaba pase lo que
//       pase, aunque el upsert hubiera fallado. La unidad se veía en la lista hasta
//       recargar la página. `unidad_config` era la ÚNICA tabla del alta sin cola offline,
//       teniéndola ~20 tablas (`_COLA_ONCONFLICT`).
//
//   (b) El campo «Unidades» de la orden partía el texto por ESPACIOS
//       (`split(/[,;\s]+/)`), así que «Llantas de repuesto» se volvía tres tokens y la
//       pantalla acusaba «✗ no existen: Llantas, de, repuesto» — el mensaje exacto que
//       ella fotografió. Esto pasaba IGUAL con la unidad bien dada de alta: cualquier
//       identificador con espacios era irrecuperable. Y peor: el selector con checks
//       reescribe el campo con `join(', ')`, así que ni elegirla de la lista servía.
//       Lo que el selector escribía, el parser no lo sabía leer.
//
// 📌 Lo que esta prueba NO hace: decidir si unas llantas deben ser una unidad. Eso lo
//    decide Máximo. Lo que mide es que el producto no MIENTA ni se trabe si alguien da
//    de alta algo cuyo identificador lleva espacios.
//
// Verificada al revés: contra el app.js anterior, los casos 1, 2, 5, 7 y los 4 estáticos
// se ponen ROJOS.
//   node pruebas/unidad-con-espacios-y-alta-que-no-miente.test.mjs [app.js]
// ══════════════════════════════════════════════════════════════════════════════
import { readFileSync } from 'node:fs'

const src = readFileSync(process.argv[2] || new URL('../app.js', import.meta.url), 'utf8')

let fallos = 0
const ok = (n, cond, detalle) => {
  console.log((cond ? '✅' : '❌') + ' ' + n + (cond ? '' : '  → ' + detalle))
  if (!cond) fallos++
}

// ── Las funciones se EXTRAEN de app.js, no se copian: una copia se desincroniza y la
//    prueba pasaría verde sobre un parser que en producción es otro.
function extraer (nombre) {
  const i = src.indexOf('function ' + nombre + '(')
  if (i < 0) throw new Error('no se encontró ' + nombre + ' en app.js')
  let prof = 0, dentro = false
  for (let j = i; j < src.length; j++) {
    if (src[j] === '{') { prof++; dentro = true } else if (src[j] === '}') {
      prof--
      if (dentro && prof === 0) return src.slice(i, j + 1)
    }
  }
  throw new Error('llaves sin cerrar en ' + nombre)
}

const fab = new Function('FLOTA', '_flotaUnidades', '_placaDe', 'gv',
  extraer('_resolverUnidad') + '\n' + extraer('_osCamsParse') +
  '\nreturn { parse: _osCamsParse, resolver: _resolverUnidad };')

// Flota de prueba: dos camiones normales y una pseudo-unidad CON ESPACIOS.
const FLOTA = {
  'JAC-B001': { placa: 'A11AA1A' },
  'JAC-B002': { placa: 'A22BB2B' },
  'Llantas de repuesto': {}
}
const { parse } = fab(FLOTA, () => Object.keys(FLOTA), (c) => (FLOTA[c] || {}).placa, () => '')

const igual = (a, b) => JSON.stringify((a || []).slice().sort()) === JSON.stringify((b || []).slice().sort())
const caso = (n, txt, cams, malos) => {
  const r = parse(txt)
  ok(n + '   «' + txt + '»', igual(r.cams, cams) && igual(r.malos, malos),
     'entendió cams=' + JSON.stringify(r.cams) + ' malos=' + JSON.stringify(r.malos) +
     ' · esperado cams=' + JSON.stringify(cams) + ' malos=' + JSON.stringify(malos))
}

console.log('── El campo «Unidades» de la orden ──────────────────────────────')

// ── 1. EL DEFECTO QUE REPORTÓ. Es el corazón de la prueba ────────────────────
caso('1. una unidad con espacios se resuelve ENTERA', 'Llantas de repuesto',
     ['Llantas de repuesto'], [])

// ── 2. Y mezclada con otras, separadas por coma ──────────────────────────────
caso('2. con espacios + un camión, por coma', 'JAC-B001, Llantas de repuesto',
     ['JAC-B001', 'Llantas de repuesto'], [])

// ── 3. NO se rompe el atajo de tirarlas de corrido ───────────────────────────
// El espacio sigue separando cuando el trozo completo no resuelve: "1 2" son dos.
caso('3. sigue andando el atajo «1 2» (por sufijo numérico)', '1 2',
     ['JAC-B001', 'JAC-B002'], [])

caso('4. sigue andando la coma de siempre', 'JAC-B001,JAC-B002',
     ['JAC-B001', 'JAC-B002'], [])

// ── 5. Lo que NO existe y lleva espacios se acusa ENTERO, no en pedazos ──────
// Antes decía «no existen: Pepe, de, Nada»: tres culpables inventados para un solo dato.
caso('5. lo inexistente con espacios se acusa como UNO', 'Pepe de Nada',
     [], ['Pepe de Nada'])

// ── 6. Y si parte casa y parte no, se acusa sólo lo que no casa ──────────────
caso('6. mezcla de bueno y malo sin coma', '1 99',
     ['JAC-B001'], ['99'])

caso('7b. campo vacío no acusa nada', '', [], [])

// ── 7. EL SELECTOR Y EL PARSER TIENEN QUE HABLAR EL MISMO IDIOMA ────────────
// `abrirSelectorUnidadesOS` reescribe el campo con `elegidas.join(', ')`. Si el parser
// no sabe volver a leer eso, elegir de la lista NO sirve — y eso es lo que pasaba.
const elegidas = ['Llantas de repuesto', 'JAC-B001']
const vuelta = parse(elegidas.join(', '))
ok('7. ida y vuelta por el selector: lo que escribe, el parser lo lee',
   igual(vuelta.cams, elegidas) && vuelta.malos.length === 0,
   'el selector escribió «' + elegidas.join(', ') + '» y el parser entendió cams=' +
   JSON.stringify(vuelta.cams) + ' malos=' + JSON.stringify(vuelta.malos))

ok('8. el selector sigue escribiendo con `join(\', \')`',
   /sv\('os-cams',elegidas\.join\(', '\)\)/.test(src),
   'cambió cómo escribe el selector: el caso 7 ya no prueba la ida y vuelta real')

console.log('\n── El alta de unidad: que no afirme lo que no pasó ──────────────')

// Recorta comentarios para no confundir una explicación con código ejecutable.
const codigo = (l) => (/^\s*(\/\/|\*|\/\*)/.test(l) ? '' : l)
const ejecutable = src.split(/\r?\n/).map(codigo).join('\n')
const iGuardar = ejecutable.indexOf('async function guardarUnidad()')
const cuerpo = ejecutable.slice(iGuardar, iGuardar + 4200)

// ── 9. `unidad_config` tiene llave de cola, como las otras ~20 tablas ───────
ok('9. `unidad_config` está en _COLA_ONCONFLICT (llave `cam`)',
   /_COLA_ONCONFLICT=\{[^}]*unidad_config:'cam'/.test(ejecutable),
   'sin llave de cola, el reintento no sabría por dónde hacer el upsert')

// ── 10. Si la base no confirma, se ENCOLA (la pieza ya existía) ─────────────
ok('10. el alta encola la ficha cuando la base no confirma',
   /guardarEnCola\('unidad_config',_regCola,'cam'\)/.test(cuerpo),
   'volvió a quedarse sólo en memoria: la ficha se pierde al recargar')

// ── 11. ⛔ LA AUDITORÍA NO PUEDE AFIRMAR UN ALTA QUE NO OCURRIÓ ─────────────
// Es lo que dejó el rastro falso del 23/10 y del 26/10.
ok('11. la auditoría distingue guardada de encolada',
   !/audit\('Unidad guardada',/.test(cuerpo) &&
   /audit\(ok\?'Unidad guardada':/.test(cuerpo),
   'la auditoría vuelve a anotar «Unidad guardada» pase lo que pase')

// ── 12. Y el aviso deja de ser un toast tibio ──────────────────────────────
// «⚠️ No se confirmó el guardado» se pasa por alto; por eso la cargó dos veces.
ok('12. cuando no se confirma, el aviso es un alert que dice qué pasó',
   /EN COLA, sin confirmar/.test(cuerpo) && /NO la cargues de nuevo/.test(cuerpo),
   'sin un aviso que se lea, la persona vuelve a cargar la misma unidad')

// ── 13. Los blobs no viajan a la cola (localStorage) ───────────────────────
// `guardarColaLS` hace JSON.stringify a localStorage y se come el error en silencio:
// un PDF de 4MB en data: URL no reventaría esta ficha, reventaría TODA la cola.
ok('13. foto y título en data: no se encolan, y se dice',
   /\['foto','titulo_pdf'\]\.forEach/.test(cuerpo) && /_pesados/.test(cuerpo),
   'un data: URL grande en la cola puede hacer perder la cola entera, en silencio')

console.log(fallos ? '\n' + fallos + ' fallo(s)' : '\nTodo en verde (14)')
process.exit(fallos ? 1 : 0)
