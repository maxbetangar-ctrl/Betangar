// ⛔ UN DÍA CON DOS PLANILLAS PERDÍA SU RECARGO EN EL DESGLOSE.
//
// Alejandra (QA), 11/08/2026: «no reconoce los viajes nocturnos que se pagan a 1.5 — Andry Cuba el
// día 06/08». Ese día tuvo DOS planillas en el JAC-B003: una de 2 nocturnos en Resimara (1,5×) y
// otra de 2 diurnos + 1 nocturno en La Concepción. El dinero salía bien ($60), pero el desglose
// guardaba el tipo del día con `=` y la última planilla procesada pisaba a la anterior: el día
// quedaba etiquetado «normal» y la lupa decía que el nocturno no se había reconocido.
//
// La etiqueta ahora se queda con la de MAYOR jerarquía y NUNCA baja:
//     domingo > feriado > nocturno > normal
//
// Corre la función REAL de app.js. Verificada al revés: contra el código anterior no había función
// que extraer — el `=` estaba en línea, y por eso el defecto no lo veía ninguna prueba.
//
//   node pruebas/dia-con-dos-planillas.test.mjs
import { readFileSync } from 'fs'

const src = readFileSync(new URL('../app.js', import.meta.url), 'utf8')
function extraer(nombre) {
  const ini = src.indexOf('function ' + nombre + '(')
  if (ini < 0) throw new Error('no encontré function ' + nombre)
  return src.slice(ini, src.indexOf('\n}', ini) + 2)
}
const rango = src.slice(src.indexOf('var _TIPO_DIA_RANGO='), src.indexOf('\n', src.indexOf('var _TIPO_DIA_RANGO=')))
const { _tipoDiaMayor } = new Function(`${rango}\n${extraer('_tipoDiaMayor')}\nreturn { _tipoDiaMayor }`)()

let fallas = 0, n = 0
const ok = (t, real, esp) => {
  n++
  if (real === esp) console.log(`  ✅ ${t}`)
  else { fallas++; console.log(`  ❌ ${t} — esperaba «${esp}», dio «${real}»`) }
}

console.log('\n⛔ El tipo del día no puede bajar de categoría\n')

// EL CASO DE ANDRY CUBA, en los dos órdenes posibles de proceso.
ok('1. nocturno y después normal → sigue nocturno', _tipoDiaMayor('nocturno', 'normal'), 'nocturno')
ok('2. normal y después nocturno → pasa a nocturno', _tipoDiaMayor('normal', 'nocturno'), 'nocturno')

// El domingo manda sobre todo lo demás (paga 1,5× TODOS los viajes del día).
ok('3. domingo no lo baja un nocturno', _tipoDiaMayor('domingo', 'nocturno'), 'domingo')
ok('4. domingo no lo baja un normal', _tipoDiaMayor('domingo', 'normal'), 'domingo')
ok('5. nocturno sí sube a domingo', _tipoDiaMayor('nocturno', 'domingo'), 'domingo')

// Feriado queda entre medio.
ok('6. feriado no lo baja un nocturno', _tipoDiaMayor('feriado', 'nocturno'), 'feriado')
ok('7. feriado sí sube a domingo', _tipoDiaMayor('feriado', 'domingo'), 'domingo')
ok('8. nocturno sube a feriado', _tipoDiaMayor('nocturno', 'feriado'), 'feriado')

// Camino feliz: un día con UNA sola planilla se comporta igual que antes.
ok('9. día normal de una sola planilla', _tipoDiaMayor('normal', 'normal'), 'normal')
ok('10. día de domingo de una sola planilla', _tipoDiaMayor('normal', 'domingo'), 'domingo')

// Y no se rompe con basura (el arranque pasa undefined la primera vez).
ok('11. sin valor previo toma el nuevo', _tipoDiaMayor(undefined, 'nocturno'), 'nocturno')
ok('12. valor desconocido no borra el bueno', _tipoDiaMayor('domingo', 'loquesea'), 'domingo')

console.log(`\n${fallas === 0 ? '✅' : '❌'} ${n - fallas}/${n}\n`)
process.exit(fallas ? 1 : 0)
