// ⛔ UNA SURTIDA CARGADA DOS VECES LE ECHABA 334,6 L DE MÁS A UN CHOFER, CON NOMBRE Y APELLIDO.
//
// 08/09/2026. La JAC-B009 tiene DOS surtidas de 350 L el 05/09, a las 18:08 y 18:28, con fotos
// DISTINTAS: el chofer la mandó dos veces —pasa cuando la pantalla dice «guardada» y la persona
// vuelve a intentar; está documentado en `chofer.html` que un rechazo del servidor se le mostraba
// como éxito—. 700 L en un tanque de 600 que había salido con 297.
//
// Con esos 700 adentro el cuadre daba «consumió 409,8 L para 143 km (0,35 km/L)» y R4 salía a
// decirle a RICHARD VILLALOBOS que quemó 334,6 L de más. Con la carga real —350— el día da 59,8 L
// y 2,39 km/L: absolutamente normal.
//
// ⛔ R15 existía para esto y no lo veía: MIRABA CADA FILA POR SEPARADO, y 350 L sí caben.
//    La pregunta no es si cabe UNA carga: es si cabe LA DEL DÍA.
//
// Y el mismo día, R4 le echaba 105,6 L de más a EDIOBER BARRIOS (B012, 26/07) con una carga de
// 140 L que viene del volcado del 18/08 —`hora` en null, tecleada semanas después desde un papel—
// y que no cabía: el tanque salió con 577,5 de 600. R4 es la única regla que le atribuye a una
// PERSONA cómo manejó, y no puede hacerlo sobre un día cuyo dato de carga nadie asentó en el
// momento.
//
// Verificada al revés contra `git show 6074815:app.js`: los casos 1, 2, 3 y 4 se ponen ROJOS.
// ⚠️ El 5 NO, y hay que decirlo: contra el código viejo esa fila de 140 L caía fuera de su día
//    (se ubicaba por `created_at`, del 18/08) y el R4 ni salía. Aparece recién al contar la carga
//    por la FECHA declarada — o sea que es una falsa acusación que ESTE MISMO cambio podía
//    introducir. El caso 5 no prueba un arreglo viejo: es el candado para que no vuelva.
//
//   node pruebas/carga-duplicada-no-acusa.test.mjs [ruta-a-app.js]
import { readFileSync } from 'fs'
import { cargarAuditoria, sembrar, auditar } from './_banco-combustible.mjs'

const rutaApp = process.argv[2] || new URL('../app.js', import.meta.url)
const datos = JSON.parse(readFileSync(new URL('./datos/combustible.json', import.meta.url), 'utf8'))
const ctx = cargarAuditoria(rutaApp)
sembrar(ctx, datos)
const anom = auditar(ctx, '2026-07-24', '2026-09-07')
const jor = (cam, f) => ctx.AC_JORNADAS.find((j) => j.cam === cam && j.fecha === f)

let fallos = 0
const caso = (n, desc, ok, detalle) => {
  if (ok) console.log(`✅ ${n}. ${desc}`)
  else { fallos++; console.log(`❌ ${n}. ${desc}\n      ${detalle}`) }
}

const b9 = jor('JAC-B009', '2026-09-05')
caso(1, 'B009 05/09: las dos cargas de 350 L se ven como 700 L, y 700 no caben en 600',
  !!b9 && b9.desp === 700 && b9.cargaImposible === true,
  'desp=' + (b9 && b9.desp) + ' cargaImposible=' + (b9 && b9.cargaImposible))

caso(2, 'ese día NO se cuadra: el consumo queda en null y no ensucia ningún número',
  !!b9 && b9.consumo === null && b9.conf === 'carga_imposible',
  'consumo=' + (b9 && b9.consumo) + ' conf=' + (b9 && b9.conf))

caso(3, 'y NADIE queda acusado de haber quemado de más ese día',
  !anom.some((a) => a.cod === 'R4' && a.cam === 'JAC-B009' && a.fecha === '2026-09-05'),
  'sigue el R4 contra el chofer de la B009')

const r15 = anom.find((a) => a.cod === 'R15' && a.cam === 'JAC-B009' && a.fecha === '2026-09-05')
caso(4, 'pero SÍ se dice: R15 lo reporta, sin nombrar a nadie, y sugiere mirar las fotos',
  !!r15 && !r15.quien && /dos veces/.test(r15.texto) && /fotos/.test(r15.texto),
  r15 ? ('quien=' + r15.quien) : 'R15 no salió — el día desaparecería en silencio')

caso(5, 'B012 26/07: R4 no acusa sobre un día cuya carga vino del volcado en lote',
  !anom.some((a) => a.cod === 'R4' && a.cam === 'JAC-B012' && a.fecha === '2026-07-26'),
  'sigue acusando con una carga de papel')

// Lo que NO se puede perder: los consumos altos de verdad, en días sin ninguna carga rara.
caso(6, 'los consumos altos con el tanque limpio siguen saliendo',
  anom.some((a) => a.cod === 'R4' && a.cam === 'JAC-B012' && a.fecha === '2026-07-31'),
  'se perdió el R4 legítimo de la B012 del 31/07')

console.log(fallos ? `\n⛔ ${fallos} caso(s) en rojo` : '\n✅ los 6 casos en verde')
process.exit(fallos ? 1 : 0)
