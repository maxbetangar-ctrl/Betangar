// ═══════════════════════════════════════════════════════════════════════════════
// 🎯 EL BLOQUE «PARA DECIDIR» NO PUEDE DEJAR UNA REGLA AFUERA
//
// 🔴 PARA QUÉ EXISTE EL BLOQUE. Máximo, 08/11/2026: *«necesito que me arroje
//    información que me permita tomar decisiones correctas y oportunas sin yo tener
//    que tener muchos conocimientos, de manera que entienda un tonto»*. La pantalla
//    le mostraba 44 avisos, cada uno un párrafo con centímetros y km/L — y esos 44
//    son cinco o seis cosas repetidas, la mayoría papeleo y no plata.
//
// ⛔ EL RIESGO DE AGRUPAR. Un resumen que se come un aviso es PEOR que no tener
//    resumen: el dueño lee «4 grupos», decide con eso, y lo que falta no deja rastro.
//    Por eso el mapa es explícito y lo que no está en él se DICE. Esta prueba se
//    asegura de las dos cosas: que el mapa cubra todas las reglas que existen, y que
//    cuando no las cubra, el bloque lo avise en vez de callarse.
//    [[norma-la-barra-que-no-dice-que-sigue]] [[norma-falta-de-dato-no-es-un-dato]]
//
// ⚠️ LO QUE ESTO NO PRUEBA: no prueba que la redacción sea clara —eso se mira— ni
//    que el grupo elegido para cada regla sea el correcto; eso es un criterio, y está
//    escrito en el comentario de `AC_GRUPOS` para que se pueda discutir.
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
  return fin > 0 ? js.slice(i, fin) : null
}

// ── 0. CONTROL POSITIVO ──────────────────────────────────────────────────────────
const mapaTxt = (js.match(/var AC_GRUPOS=\[[\s\S]*?\n\];/) || [])[0]
const fGrupo = saca('_acGrupoDe')
const fDec = saca('_acParaDecidir')
ok('0. CONTROL POSITIVO: existen el mapa y las dos funciones', !!mapaTxt && !!fGrupo && !!fDec,
   'falta: ' + [['AC_GRUPOS', mapaTxt], ['_acGrupoDe', fGrupo], ['_acParaDecidir', fDec]].filter(x => !x[1]).map(x => x[0]).join(', '))
if (!mapaTxt || !fGrupo || !fDec) { console.log('\n⛔ sin el mapa no se prueba nada.'); process.exit(1) }

// ── 1. TODA REGLA QUE EXISTE ESTÁ EN ALGÚN GRUPO ─────────────────────────────────
// Los códigos salen del archivo, no de una lista a mano: una regla nueva aparece acá
// sola el día que alguien la escribe. [[norma-dos-listas-a-mano-se-desincronizan]]
// ⛔ LA SEVERIDAD PUEDE SER UNA EXPRESIÓN, no solo `sev` o una cadena. R16 la calcula
//    (`Math.abs(dif)>200?'alta':'media'`) y el patrón anterior —que listaba las formas
//    literales— **no la veía**: la regla existía y esta prueba daba verde sin mirarla.
//    Ahora se acepta cualquier primer argumento sin comas, que es lo que de verdad define
//    la forma de la llamada. [[norma-control-positivo-antes-de-creerle-al-vacio]]
const codigos = [...new Set([...js.matchAll(/\badd\(\s*[^,()]*(?:\([^()]*\))?[^,]*,\s*'(R\d+[a-z]?)'/g)].map(m => m[1]))]
ok('1. CONTROL POSITIVO: se encontraron las reglas del archivo', codigos.length >= 10,
   `solo ${codigos.length}: el patrón dejó de calzar`)

const enMapa = new Set([...mapaTxt.matchAll(/'(R\d+[a-z]?)'/g)].map(m => m[1]))
const huerfanas = codigos.filter(c => !enMapa.has(c))
ok('2. ninguna regla quedó fuera del mapa', huerfanas.length === 0,
   'sin agrupar: ' + huerfanas.join(', ') + ' — el resumen mostraría menos avisos de los que hay')

// ── 2. Y EL MAPA NO NOMBRA REGLAS QUE NO EXISTEN ─────────────────────────────────
// Una regla borrada que queda en el mapa no rompe nada, pero miente sobre lo que cubre.
const fantasmas = [...enMapa].filter(c => !codigos.includes(c))
ok('3. el mapa no nombra reglas que ya no existen', fantasmas.length === 0,
   'sobran: ' + fantasmas.join(', '))

// ── 3. EL BLOQUE AVISA CUANDO NO PUEDE CLASIFICAR ────────────────────────────────
// Es la red de seguridad de todo lo anterior: aunque el mapa se quede corto, el dueño
// se entera en la pantalla en vez de leer un resumen incompleto.
ok('4. el bloque avisa de lo que no pudo agrupar', /todav[ií]a no est[áa]n agrupados/.test(fDec),
   'si el mapa se queda corto, el resumen se come avisos en silencio')
ok('5. …y lo no clasificado NO se mete en un grupo por descarte', /return null;/.test(fGrupo),
   '`_acGrupoDe` tiene que devolver null, no un grupo cualquiera')

// ── 4. LA PLATA SOLO DONDE ES PLATA ──────────────────────────────────────────────
// «Falta cargar» y «se contradicen» no son pérdidas: ponerles un monto en dólares los
// haría leer como plata perdida, que es justo la confusión que el bloque viene a quitar.
ok("6. el monto en dólares solo se muestra en el grupo de plata y en el no comprobable",
   /g\.k==='plata'/.test(fDec) && /g\.k==='sincomp'/.test(fDec) && !/g\.k==='cargar'[^)]*\$/.test(fDec),
   'un grupo de papeleo con un monto al lado se lee como dinero perdido')

// ── 5. CONTROL NEGATIVO: la prueba sabe fallar ───────────────────────────────────
{
  const mapaFalso = "var AC_GRUPOS=[{k:'x', reglas:['R1']}];"
  const enFalso = new Set([...mapaFalso.matchAll(/'(R\d+[a-z]?)'/g)].map(m => m[1]))
  const huerfanasFalso = codigos.filter(c => !enFalso.has(c))
  ok('7. CONTROL NEGATIVO: con un mapa incompleto, la detección se enciende',
     huerfanasFalso.length > 0, 'el chequeo no detecta ni el caso evidente')
}

console.log(fallos ? `\n⛔ ${fallos} MAL` : '\n✅ TODAS PASAN')
process.exit(fallos ? 1 : 0)
