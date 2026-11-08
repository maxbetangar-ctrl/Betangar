// ═══════════════════════════════════════════════════════════════════════════════
// ⛔ EL TEXTO DE UNA ANOMALÍA VA EN TEXTO PLANO, SIN HTML
//
// 🔴 QUÉ PASÓ (08/11/2026). R17 escribía `<b>…</b>` dentro del texto de la anomalía.
//    Ese texto se dibuja con `_mEsc()`, que ESCAPA el HTML — y tiene que escaparlo,
//    porque el texto interpola datos que escribe gente: el nombre de la estación,
//    la unidad, el chofer. Resultado: en la pantalla se leía, literal,
//      «Los tanques propios <b>no se han medido NI UNA VEZ</b> desde que…»
//    Las otras 20 reglas escriben plano; esta era la única con dos convenciones.
//
// ⛔ POR QUÉ ESTA PRUEBA EXISTE. Las 43 aserciones del banco estaban en VERDE: ninguna
//    mira cómo se VE el texto, solo qué dice. Lo destapó mirar la captura del
//    navegador. Una prueba que se pueda correr sola es más barata que acordarse de
//    mirar. [[norma-una-pantalla-se-revisa-en-una-pantalla]]
//
// ⚠️ LO QUE ESTO NO PRUEBA: no prueba que el texto esté BIEN REDACTADO, ni que diga
//    la verdad. Prueba que no lleve marcas que la pantalla va a mostrar crudas.
// ═══════════════════════════════════════════════════════════════════════════════
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const AQUI = path.dirname(fileURLToPath(import.meta.url))
const RAIZ = path.resolve(AQUI, '..')
const js = readFileSync(path.join(RAIZ, 'app.js'), 'utf8')

let fallos = 0
const ok = (n, c, d) => { console.log((c ? '✅' : '❌') + ' ' + n + (c ? '' : '  → ' + d)); if (!c) fallos++ }

// ── 0. CONTROL POSITIVO ──────────────────────────────────────────────────────────
// Si no encuentro las llamadas, esta prueba daría verde sin haber mirado nada: un
// vacío por fallo de lectura se ve igual que un vacío de verdad.
const RX = /\badd\(\s*(?:sev|'alta'|'media'|'baja')\s*,\s*'(R\d+[a-z]?)'/g
const codigos = [...js.matchAll(RX)].map(m => m[1])
ok('0. CONTROL POSITIVO: se encontraron las reglas en el archivo', codigos.length >= 10,
   `solo encontré ${codigos.length}: el patrón dejó de calzar y esto no estaría midiendo nada`)
if (codigos.length < 10) { console.log('\n⛔ sin las reglas no se prueba nada.'); process.exit(1) }

// ── 1. Ninguna lleva HTML en su texto ────────────────────────────────────────────
// Se recorta desde cada `add(` hasta su paréntesis de cierre, contando niveles: así
// se mira el texto DE ESA llamada y no el del comentario que viene después.
const sucias = []
RX.lastIndex = 0
let m
while ((m = RX.exec(js)) !== null) {
  let p = 0, fin = -1
  for (let k = js.indexOf('(', m.index); k < js.length; k++) {
    if (js[k] === '(') p++
    else if (js[k] === ')') { p--; if (p === 0) { fin = k; break } }
  }
  if (fin < 0) continue
  const cuerpo = js.slice(m.index, fin)
  // Solo las líneas de CÓDIGO: un comentario que menciona `<b>` explicando esto mismo
  // no es un defecto. [[norma-una-asercion-mal-escrita-acusa-al-producto]]
  const codigo = cuerpo.split('\n').filter(l => !/^\s*(\/\/|\*)/.test(l)).join('\n')
  const tags = codigo.match(/<\/?(b|i|u|br|div|span|strong|em)\b[^>]*>/g)
  if (tags) sucias.push(`${m[1]} → ${[...new Set(tags)].join(' ')}`)
}
ok('1. ninguna regla mete HTML en el texto de la anomalía', sucias.length === 0,
   'la pantalla lo escapa y se ven las etiquetas crudas: ' + sucias.join(' · '))

// ── 2. CONTROL NEGATIVO: la prueba sabe fallar ───────────────────────────────────
// Una prueba que no se puede poner roja no prueba nada. Se le da el defecto a mano.
{
  const falso = "add(sev,'R99','t','algo <b>en negrita</b> acá','', h, 0, '')"
  const tieneTags = /<\/?(b|i|u|br|div|span|strong|em)\b[^>]*>/.test(falso)
  ok('2. CONTROL NEGATIVO: con HTML de verdad, la detección se enciende', tieneTags,
     'el patrón no detecta ni el caso evidente')
}

// ── 3. Y el énfasis sigue existiendo, en mayúsculas ──────────────────────────────
// Quitar el HTML no puede dejar el texto sin jerarquía: el aviso tiene que seguir
// gritando lo que importa.
ok('3. R17 conserva el énfasis, en mayúsculas', /NO SE HAN MEDIDO NI UNA VEZ/.test(js),
   'se quitó el HTML y también el énfasis: el aviso quedó plano')

console.log(fallos ? `\n⛔ ${fallos} MAL` : '\n✅ TODAS PASAN')
process.exit(fallos ? 1 : 0)
