// ══════════════════════════════════════════════════════════════════════════════
// ⛔ TRABAJÓ Y NO FICHÓ NO ES FALTAR
//
// `verificarCruceExcel` cruza la planilla contra `asistencia_dia` y señala a quien está
// en la planilla y no tiene fichaje. Su propio comentario decía:
//
//     «Acá TODAS las filas son fichajes (origen='fichaje', medido: 1.785 de 1.785),
//      así que la presencia es la fila misma.»
//
// Era cierto cuando se midió. **Una medición tiene fecha**, y el 28/10/2026 dejó de serlo:
// se cargaron las dos asistencias de Yohendry (27/09 y 02/10) derivadas del CHECKLIST, con
// `origen='checklist'`, porque trabajó esos días y el fichaje no entró.
//
// Sin este arreglo eso rompía el control en las DOS direcciones:
//   · daba por FICHADO a quien no fichó (la fila existe, el control no miraba `origen`);
//   · y al revés, antes de cargarlas, ACUSABA DE FALTAR a quien tenía el checklist cargado.
//
// Y este control **acusa personas**: lo que decide es si el nombre de alguien sale o no
// en una lista de faltas que lee la administración.
//
// Verificada al revés: contra el app.js anterior se ponen ROJOS los casos 1, 2, 3, 5 y 6.
//   node pruebas/trabajo-y-no-ficho-no-es-faltar.test.mjs [app.js]
// ══════════════════════════════════════════════════════════════════════════════
import { readFileSync } from 'node:fs'

const src = readFileSync(process.argv[2] || new URL('../app.js', import.meta.url), 'utf8')

let fallos = 0
const ok = (n, cond, detalle) => {
  console.log((cond ? '✅' : '❌') + ' ' + n + (cond ? '' : '  → ' + detalle))
  if (!cond) fallos++
}

const i = src.indexOf('function verificarCruceExcel(')
if (i < 0) { console.error('FALLA: no existe verificarCruceExcel'); process.exit(1) }
// ⛔ La función se recorta hasta la SIGUIENTE declaración a nivel de archivo, no a tantos
//    caracteres. Un tope fijo de 9.000 dejaba el bloque del aviso FUERA del trozo y dos
//    casos salían rojos contra el código ya arreglado: la prueba medía menos de lo que creía.
const sig = src.slice(i + 1).search(/\n(function |var |async function )/)
const fn = sig > 0 ? src.slice(i, i + 1 + sig) : src.slice(i)
if (fn.length < 6000) { console.error('FALLA: el recorte de la función quedó en ' + fn.length + ' caracteres, sospechosamente corto'); process.exit(1) }
const ejec = fn.split(/\r?\n/).map(l => (/^\s*\/\//.test(l) ? '' : l)).join('\n')

// ── 1. Sin pedir `origen` no se puede distinguir nada ───────────────────────
ok('1. el control pide la columna `origen`',
   /from\('asistencia_dia'\)\.select\('nombre,fecha,origen'\)/.test(ejec),
   'sin `origen` toda fila se lee igual: no hay forma de saber si fichó o si solo trabajó')

// ── 2. ⛔ FICHÓ y TRABAJÓ son dos índices distintos ─────────────────────────
ok('2. separa quién FICHÓ de quién TRABAJÓ',
   /var fichoEse=\{\}, fichoAlguna=\{\}, trabajoEse=\{\}/.test(ejec) &&
   /if\(\(r\.origen\|\|'fichaje'\)!=='fichaje'\)return;/.test(ejec),
   'una asistencia derivada del checklist vuelve a contarse como fichaje')

// ── 3. ⛔ Y NO SE ACUSA A QUIEN TIENE EL CHECKLIST CARGADO ──────────────────
ok('3. quien trabajó y no fichó no entra en las discrepancias',
   /if\(trabajoEse\[fecha\+'\|'\+n\]\)\{ faltaFichaje\[n\]=\(faltaFichaje\[n\]\|\|0\)\+1; return; \}/.test(ejec),
   'vuelve a acusar de faltar a alguien que puede probar que trabajó')

// ── 4. También por la otra forma del nombre ────────────────────────────────
// El control ya resolvía el nombre corto contra la nómina para `fichoEse`; si no se hace
// lo mismo con `trabajoEse`, "YOHENDRY TAPIA" en la planilla se acusa igual.
ok('4. lo mismo vale cuando el nombre de la planilla viene corto',
   /if\(emp && trabajoEse\[fecha\+'\|'\+_nn\(emp\.nombre\)\]\)/.test(ejec),
   'el nombre corto de la planilla se sigue acusando aunque la nómina lo resuelva')

// ── 5. ⛔ Y SE DICE. Un caso que no se cuenta y no se nombra desaparece ─────
ok('5. el caso se muestra en el aviso, no se traga en silencio',
   /hayRuido=[^;]*Object\.keys\(faltaFichaje\)\.length/.test(ejec) &&
   /Trabajó pero le falta el fichaje/.test(fn),
   'el caso deja de acusar pero tampoco se ve: un fichaje que falta es trabajo nuestro')

ok('6. y el texto dice que la corrección es nuestra, no de la persona',
   /la corrección es del lado nuestro, no de la persona/.test(fn),
   'sin eso el renglón se lee como un reproche a quien no hizo nada mal')

// ── 7. Lo que NO se rompió ─────────────────────────────────────────────────
ok('7. sigue sin acusar los días en que no fichó NADIE',
   /var huboFichaje=filas\.some/.test(ejec) && /if\(!huboFichaje\)return;/.test(ejec),
   'se perdió el candado que evita acusar por una caída del fichaje')

ok('8. la dirección inversa sigue apagada (saltaba 411 veces)',
   /nSinPlan\+\+/.test(ejec),
   'cambió el conteo de «fichó y no está en planilla»')

console.log(fallos ? '\n' + fallos + ' fallo(s)' : '\nTodo en verde (8)')
process.exit(fallos ? 1 : 0)
