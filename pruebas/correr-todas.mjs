// ══════════════════════════════════════════════════════════════════════════════════════════════
// CORRER TODAS LAS PRUEBAS DE ESTE REPO — descubriéndolas, no listándolas
//
// 🔴 POR QUÉ EXISTE. Máximo, 07/11/2026: *«ACTUA COMO UN EXPERTO ANALIZA BIEN Y REPARALO»*.
//    `npm test` era una lista escrita a mano con 18 de las 33 pruebas, y las 5 que se rompieron
//    el 04-06/11 no estaban en ella: el CI quedaba VERDE con el repo rojo.
//
// ⛔ Y POR QUÉ NO ALCANZA CON UN GLOB. Lo primero que puse fue
//       node --test "test/**/*.test.js" "pruebas/**/*.test.mjs"
//    Anda perfecto acá (Node 24) y el CI siguió ROJO. El glob de `--test` depende de la versión
//    de Node, y cuando no expande, `node --test` **no encuentra ningún archivo y eso lo trata
//    como fallo** — o sea que el síntoma de «no encontré pruebas» es idéntico al de «las pruebas
//    fallaron». Acá el descubrimiento lo hace `readdir`, que se comporta igual en toda versión y
//    en todo sistema. [[norma-un-filtro-nuestro-tapa-un-dato-que-si-llega]]
//
// ⛔ Y DICE CUÁNTAS ENCONTRÓ. Si encuentra 0, falla a propósito y lo explica: un conjunto de
//    pruebas vacío que sale 0 es la peor de las mentiras — informa «todo bien» sin haber mirado
//    nada. [[norma-control-positivo-antes-de-creerle-al-vacio]]
//
// Uso:  node pruebas/correr-todas.mjs
// ══════════════════════════════════════════════════════════════════════════════════════════════
import { readdirSync, existsSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import path from 'node:path'

const RAIZ = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..')

// Dónde buscar y qué cuenta como prueba. Un archivo `ver-*.mjs` NO es una prueba: abre un
// navegador y mira una pantalla, y eso no corre en el CI.
const CARPETAS = ['test', 'pruebas']
const ES_PRUEBA = /\.test\.(js|mjs|cjs)$/

const archivos = []
for (const c of CARPETAS) {
  const dir = path.join(RAIZ, c)
  if (!existsSync(dir)) continue
  for (const n of readdirSync(dir)) if (ES_PRUEBA.test(n)) archivos.push(path.join(c, n))
}
archivos.sort()

if (!archivos.length) {
  console.error('⛔ NO ENCONTRÉ NINGUNA PRUEBA en test/ ni pruebas/.')
  console.error('   Eso no es «todo bien»: es que el descubrimiento no funcionó. Se falla a propósito.')
  process.exit(1)
}

console.log(`▶ ${archivos.length} prueba(s) descubierta(s) en ${CARPETAS.filter((c) => existsSync(path.join(RAIZ, c))).join(' y ')}\n`)
const r = spawnSync(process.execPath, ['--test', ...archivos], { cwd: RAIZ, stdio: 'inherit' })
if (r.error) { console.error('⛔ no pude arrancar el corredor:', r.error.message); process.exit(1) }
process.exit(r.status === null ? 1 : r.status)
