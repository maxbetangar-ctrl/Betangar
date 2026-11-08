// ⛔ LA HORA REAL DE LA CARGA, Y POR QUÉ TIENE TRES RESPUESTAS
//
// 🔴 Toda la complejidad del módulo alrededor de las cargas —`yaEnElNivel`, `_acDespDelCuadre`,
//    los 15 min de margen, tres correcciones distintas (29/08, 08/09, 07/11)— existe porque
//    `surtidas.hora` la escribe la persona y `created_at` es cuando se GUARDÓ la fila. Ninguno
//    es la hora en que el combustible entró al tanque.
//
// ✅ El GPS del camión sí lo sabe, y desde el 08/11/2026 está en `hora_gps`/`hora_gps_fin`.
//    Medido: 82% de cobertura sobre las surtidas con coordenada; **el 93% de las horas
//    declaradas cae DENTRO de la parada**; la parada dura 14 min de mediana.
//
// ⛔ ES UN INTERVALO, NO UN INSTANTE, y de ahí salen TRES respuestas:
//      la parada TERMINÓ antes  → 'no'   el combustible ya estaba, seguro
//      la parada EMPEZÓ después → 'si'   no estaba, seguro
//      el instante cae ADENTRO  → null   el chofer midió EN la bomba: nadie lo sabe por el reloj
//
// ⚠️ 🔴 Y EL GPS NO MANDA SOLO. Maximo, 08/11/2026: «el gps no es 100% confiable por esos
//    apagones y tiene margen de error, pero entre los 2 se complementan». Por eso `null` NO
//    significa «no entró después»: significa «no se sabe», y quien llama CAE EN SU REGLA
//    ANTERIOR. Confundir las dos cosas es [[norma-falta-de-dato-no-es-un-dato]].
//
// 📌 Y una leccion sobre mi propio metodo: valide que la señal fuera CORRECTA (93% dentro de la
//    parada, 8 de 8 de acuerdo con el nivel) pero no que fuera UTIL. Medido despues: cambia la
//    clasificacion en 1 jornada y el consumo en NINGUNA, porque la regla del nivel ya acertaba.
//    Las dos cosas hay que medirlas ANTES de construir.
//
//   node pruebas/hora-real-de-la-carga.test.mjs [app.js]
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
const fD = saca('_acEntroDespuesDe'), fTs = saca('_acTs')
ok('0. _acEntroDespuesDe y _acTs existen', !!fD && !!fTs, 'falta alguna')
if (!fD || !fTs) { console.log('\n⛔ sin las funciones no se prueba nada.'); process.exit(1) }
const dec = new Function(fTs + '\n' + fD + '\n return _acEntroDespuesDe;')()

const T = (s) => '2026-11-04 ' + s + ':00+00'
const ms = (s) => Date.parse('2026-11-04T' + s + ':00Z')

// ── Las tres respuestas ─────────────────────────────────────────────────────────────────────
ok('1. la parada TERMINÓ antes de la lectura ⇒ el combustible YA estaba',
   dec({ hora_gps: T('16:07'), hora_gps_fin: T('16:40') }, ms('16:51')) === 'no', 'dio otra cosa')
ok('2. la parada EMPEZÓ después de la lectura ⇒ NO estaba',
   dec({ hora_gps: T('17:27'), hora_gps_fin: T('19:32') }, ms('15:55')) === 'si', 'dio otra cosa')
ok('3. la lectura cae ADENTRO de la parada ⇒ NO SE SABE',
   dec({ hora_gps: T('16:07'), hora_gps_fin: T('16:52') }, ms('16:51')) === null,
   'se atrevió a decidir con el chofer midiendo en la bomba')

// ── ⛔ EL GPS NO MANDA SOLO: sin dato, no opina ──────────────────────────────────────────────
ok('4. sin hora_gps devuelve null (apagón, sin cobertura)', dec({ hora_gps: null, hora_gps_fin: null }, ms('16:00')) === null,
   'inventó una respuesta sin dato')
ok('5. con el inicio pero SIN el fin tampoco opina', dec({ hora_gps: T('16:07'), hora_gps_fin: null }, ms('16:00')) === null,
   'media parada no es una parada: con un solo extremo no se puede ubicar la lectura')
ok('6. sin instante contra el cual comparar, tampoco', dec({ hora_gps: T('16:07'), hora_gps_fin: T('16:40') }, null) === null,
   'comparó contra nada')
ok('7. una fila sin nada no rompe', dec(null, ms('16:00')) === null && dec({}, ms('16:00')) === null, 'tiró excepción')

// ── Los bordes exactos ──────────────────────────────────────────────────────────────────────
ok('8. si la parada termina EXACTO en la lectura, ya estaba',
   dec({ hora_gps: T('16:00'), hora_gps_fin: T('16:51') }, ms('16:51')) === 'no', 'cambió de criterio en el borde')
ok('9. si la parada empieza EXACTO en la lectura, es ambiguo (no "si")',
   dec({ hora_gps: T('16:51'), hora_gps_fin: T('17:10') }, ms('16:51')) === null,
   'dijo que NO estaba cuando la lectura cae justo al arrancar la parada')

// ── CONTROL POSITIVO: los 2 casos REALES donde la hora declarada mentía ──────────────────────
// 17/10: declaró 16:13 (después de la llegada de 16:11); el GPS dice 16:06→16:18 ⇒ AMBIGUO,
//        y ahí manda el nivel, que dice que sí estaba. El reloj declarado habría dicho que no.
// 04/11: declaró 17:05 (después de 16:51); el GPS dice 16:07→16:52 ⇒ AMBIGUO, idem.
ok('10. CONTROL POSITIVO: en los 2 casos donde la hora declarada mentía, el GPS NO repite la mentira',
   dec({ hora_gps: T('16:06'), hora_gps_fin: T('16:18') }, ms('16:11')) !== 'si' &&
   dec({ hora_gps: T('16:07'), hora_gps_fin: T('16:52') }, ms('16:51')) !== 'si',
   'el GPS estaría confirmando que la carga entró después, que es justo lo falso')

// ── Y que el producto lo USE, con el respaldo intacto ───────────────────────────────────────
const plano = js.replace(/\s+/g, ' ')
ok('11. `_acEntradas` consulta al GPS primero', /var _v=_acEntroDespuesDe\(s,despuesDe\);/.test(plano),
   'la función existe pero el filtro no la usa: tenerlo no es usarlo')
ok('12. y cuando el GPS no sabe, cae en created_at como siempre',
   /if\(_v==null\)\{ var _ts=_acTs\(s\.created_at\);/.test(plano),
   'sin respaldo, un apagón del rastreador cambiaría el resultado en silencio')
// ⛔ Solo Betangar tiene volcado y GPS. En los clones esta asercion NO aplica, y se dice
//    que no aplica en vez de darla por buena: un verde que no midio nada es peor que un hueco.
// ⛔ ESTO SE MIDE SOBRE EL VOLCADO, NO SOBRE EL TEXTO DE LA CONSULTA. La primera version buscaba
//    la cadena `hora_gps,hora_gps_fin from surtidas` dentro de `bajar.mjs`, y se puso ROJA el
//    08/11/2026 cuando esa consulta paso a `select *` — un cambio que trae MAS columnas, no menos.
//    La asercion acusaba al producto por mejorar. [[norma-una-asercion-mal-escrita-acusa-al-producto]]
//    📌 Una lista de columnas escrita a mano DENTRO de una prueba es una lista a mano igual: se
//      desincroniza. Lo que hay que exigir es el EFECTO —que la columna este y traiga datos—, que
//      es lo unico de lo que depende el banco. [[norma-dos-listas-a-mano-se-desincronizan]]
let bajar = null
try { bajar = readFileSync(new URL('./datos/bajar.mjs', import.meta.url), 'utf8') } catch (e) { bajar = null }
if (bajar === null) console.log('—  13. (no aplica: este repo no tiene volcado de pruebas ni GPS)')
else {
  // El volcado solo existe en Betangar; en los clones esta prueba corre igual con los casos de arriba.
  let datos = null
  try { datos = JSON.parse(readFileSync(new URL('./datos/combustible.json', import.meta.url), 'utf8')) } catch (e) { datos = null }
  if (!datos) { console.log('—  13. (no aplica: este repo no versiona el volcado)'); process.exit(fallos === 0 ? 0 : 1) }
  const unaSurtida = (datos.surt || [])[0] || {}
  ok('13. el volcado de pruebas TRAE las columnas del GPS',
     'hora_gps' in unaSurtida && 'hora_gps_fin' in unaSurtida,
     'el banco mediria SIEMPRE el camino de respaldo — el mismo defecto que la columna `turno`')
  // ⛔ Y CON DATOS ADENTRO: una columna presente y toda vacia se lee igual que «el GPS no sirve».
  const conGps = (datos.surt || []).filter((s) => s.hora_gps && s.hora_gps_fin).length
  ok('13b. …y con horas de verdad adentro, no la columna vacia', conGps > 0,
     'las ' + (datos.surt || []).length + ' surtidas del volcado tienen `hora_gps` nulo: el caso 10 no prueba nada')
}

console.log('\n' + (fallos === 0 ? '✅ TODAS PASAN' : '⛔ ' + fallos + ' MAL'))
process.exit(fallos === 0 ? 0 : 1)
