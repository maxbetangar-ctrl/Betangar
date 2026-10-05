// ⛔ UN SOLO REGISTRO DE UNIDADES — y esta prueba existe porque el segundo me hizo
// medir mal y reportarle un número falso al dueño.
//
// 04/10/2026: le dije a Máximo que **Tony Gas tenía CERO unidades** —su cliente que paga,
// con un producto de flota— y lo puse en rojo. Tiene **26** y las usa todos los días.
// Conté `select count(*) from unidades` y la flota vive en `unidad_config`.
//
// El producto tenía DOS registros de la misma cosa:
//   · `unidad_config` — el MAESTRO. 28 columnas: seriales, foto, título, capacidad del
//     tanque, odómetro, chofer. 23 unidades en FLOTILLA, 26 en Tony Gas, 13 en Betangar.
//   · `unidades` — el de Operación/Contratos. 8 columnas, 7 ya en el maestro. **0 filas
//     en las 5 bases**, y aun así el código la leía y escribía en 4 lugares.
//
// Máximo: «eso no debería estar en un solo sitio unificado y no en 4 sitios?». Esto es
// lo que impide que vuelva: la prueba no mira que el arreglo esté, mira que **no haya
// una segunda fuente**. Un comentario pidiendo que no se agregue otra no es un candado.
//
// Verificada al revés: contra el código anterior los casos 1, 2, 3 y 5 se ponen ROJOS.
//   node pruebas/un-solo-registro-de-unidades.test.mjs [app.js] [app.html]
import { readFileSync } from 'fs'

const js = readFileSync(process.argv[2] || new URL('../app.js', import.meta.url), 'utf8')
const html = readFileSync(process.argv[3] || new URL('../app.html', import.meta.url), 'utf8')

let fallos = 0
const ok = (n, cond, detalle) => {
  console.log((cond ? '✅' : '❌') + ' ' + n + (cond ? '' : '  → ' + detalle))
  if (!cond) fallos++
}

// Recorta lo que viene después de `//`, salteando el de las URL. Un comentario que
// cuenta la historia no es una segunda fuente: es la bitácora dentro del código.
const codigo = (l) => {
  if (/^\s*(\/\/|\*|\/\*|<!--)/.test(l)) return ''
  let q = null
  for (let i = 0; i < l.length - 1; i++) {
    const c = l[i]
    if (q) { if (c === '\\') i++; else if (c === q) q = null; continue }
    if (c === '"' || c === "'" || c === '`') { q = c; continue }
    if (c === '/' && l[i + 1] === '/' && l[i - 1] !== ':') return l.slice(0, i)
  }
  return l
}
const ejecutable = js.split(/\r?\n/).map(codigo).join('\n')

// ── 1. NINGUNA consulta a la tabla `unidades`. Es el corazón de la prueba ─────
const toques = (ejecutable.match(/from\(['"]unidades['"]\)/g) || []).length
ok('1. el código no lee ni escribe la tabla `unidades`',
   toques === 0,
   toques + ' consulta(s) a `unidades`: volvió el segundo registro')

// ── 2. El maestro es el que se consulta ──────────────────────────────────────
ok('2. `unidad_config` sigue siendo el registro que se usa',
   /from\(['"]unidad_config['"]\)/.test(ejecutable),
   'no quedó ninguna consulta al registro maestro')

// ── 3. `contrato_id` viaja desde la base, en las DOS mitades ─────────────────
// `cols` es una lista EXPLÍCITA y el objeto se mapea campo por campo. Si falta en
// cualquiera de las dos, `u.contrato_id` es undefined SIEMPRE y la pantalla queda
// vacía sin un solo error. Es la falla que no avisa.
ok('3. cargarUnidadConfig pide contrato_id Y lo mapea',
   /var cols='cam,[^']*contrato_id/.test(js) && /contrato_id:x\.contrato_id/.test(js),
   'pide la columna pero no la mapea (o al revés): quedaría undefined en silencio')

// ── 4. UNIDADES se DERIVA, no se carga ───────────────────────────────────────
ok('4. UNIDADES se deriva del maestro',
   /function _unidadesDelRegistro\(\)/.test(js) && /UNIDADES=_unidadesDelRegistro\(\)/.test(ejecutable),
   'UNIDADES volvió a tener su propia fuente')

// ── 5. ⛔ Y EL BORRADO NO TOCA EL MAESTRO ────────────────────────────────────
// Al unificar, la tentación es reapuntar el `delete` de la pantalla de contratos al
// maestro. Eso dejaría que un botón "x" en Contratos destruya la ficha completa de la
// unidad: seriales, foto, título, capacidad del tanque, odómetro.
ok('5. nada borra filas de `unidad_config`',
   !/from\(['"]unidad_config['"]\)\s*\.delete\(/.test(ejecutable),
   'la pantalla de contratos puede destruir la ficha maestra de una unidad')

ok('6. quitar del contrato es un update a null, no un delete',
   /function quitarContratoUnidadMC/.test(js) && /update\(\{contrato_id:null\}\)/.test(ejecutable),
   'no existe el camino para sacar una unidad de su contrato sin borrarla')

// ── 7. El formulario no vuelve a dar de alta unidades acá ────────────────────
ok('7. la pantalla de contratos no registra unidades',
   !/id="mc-uni-placa"/.test(html) && /id="mc-uni-unidad"/.test(html),
   'volvió el alta de unidades en la pantalla de contratos')

console.log(fallos ? '\n' + fallos + ' fallo(s)' : '\nTodo en verde (7)')
process.exit(fallos ? 1 : 0)
