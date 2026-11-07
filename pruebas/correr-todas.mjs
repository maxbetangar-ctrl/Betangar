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

// ── EN EL CI, EL FALLO TIENE QUE EXPLICARSE SOLO ──────────────────────────────────────────────
// 🔴 Medido el 07/11/2026: el workflow fallaba y lo único visible desde afuera era «Process
//    completed with exit code 1». Los logs piden credenciales, así que no se podía saber QUÉ
//    prueba fallaba sin entrar a GitHub — y entrar a GitHub es justamente lo que no se puede
//    hacer desde acá. Un fallo que no dice qué falló obliga a adivinar, y adivinar fue lo que
//    me hizo perder dos intentos (el import del repo hermano y el glob).
// ⇒ Bajo GitHub Actions se corre con el reportero TAP y cada archivo rojo sale como `::error`,
//   que GitHub convierte en una ANOTACIÓN — y las anotaciones sí se leen sin credenciales.
const enCI = !!process.env.GITHUB_ACTIONS
if (!enCI) {
  const r = spawnSync(process.execPath, ['--test', ...archivos], { cwd: RAIZ, stdio: 'inherit' })
  if (r.error) { console.error('⛔ no pude arrancar el corredor:', r.error.message); process.exit(1) }
  process.exit(r.status === null ? 1 : r.status)
}

const r = spawnSync(process.execPath, ['--test', '--test-reporter=tap', ...archivos],
                    { cwd: RAIZ, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 })
const salida = (r.stdout || '') + (r.stderr || '')
console.log(salida)                                   // el log completo, igual que antes
if (r.error) { console.log(`::error::no pude arrancar el corredor: ${r.error.message}`); process.exit(1) }

// `not ok N - <archivo>` es la línea que marca un archivo rojo en TAP.
const rojos = [...salida.matchAll(/^not ok \d+ - (.+)$/gm)].map((m) => m[1].trim())
// Y el motivo de cada uno: TAP lo pone en el bloque YAML de abajo, en `error:` o `failureType:`.
const motivo = (arch) => {
  const i = salida.indexOf(`not ok`), trozo = salida.slice(Math.max(0, salida.indexOf(arch)), salida.indexOf(arch) + 1400)
  const m = /error:\s*'?([^\n']{5,220})/.exec(trozo)
  return m ? m[1].trim() : 'sin detalle en el TAP'
}
for (const a of [...new Set(rojos)]) {
  console.log(`::error file=${a},title=prueba en rojo::${motivo(a).replace(/\r?\n/g, ' ')}`)
}
if (!rojos.length && r.status !== 0) {
  console.log(`::error::el corredor salió ${r.status} y ninguna prueba figura como 'not ok' — mirá el log entero`)
}
process.exit(r.status === null ? 1 : r.status)
