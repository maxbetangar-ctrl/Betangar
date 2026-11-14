// ⛔ EL COMBUSTIBLE QUE LA UNIDAD DEVOLVIÓ SE LE ACREDITA — PERO NO SE BORRA DEL GASTO.
//
// 🔴 Máximo, 14/11/2026: «si ese combustible ya se pagó cuando se les puso a los camiones,
//    al sacarlo de los camiones y ponerlos en el tanque no debería aumentar la cuenta por
//    pagar ¿o sí?». No. Y el problema tampoco era la CxP: era la ATRIBUCIÓN.
//
//    El 10/11 diez unidades entregaron 1.265 L al tanque y quedaron cargando US$ 847,84 de
//    combustible que NO quemaron. La B010 sola arrastraba US$ 118,43 ajenos — en la pantalla
//    que existe justo para comparar unidades entre sí.
//
// ⛔ LA LÍNEA QUE NO SE PUEDE CRUZAR. Mover combustible no crea ni destruye gasto: la plata
//    salió de verdad y tiene que seguir en el resultado de la empresa. Esto se resta SOLO
//    del costo POR UNIDAD. Restarlo del total sería borrar un egreso real, que es un error
//    mucho peor que el que vino a arreglar. [[norma-salida-de-banco-no-es-gasto]]
//
//   node --test pruebas/lo-devuelto-se-acredita-a-la-unidad.test.mjs
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'fs'
import vm from 'node:vm'

const RUTA = process.argv.find((a) => a.endsWith('.js')) || 'app.js'
const src = readFileSync(RUTA, 'utf8')

function sacar(nombre) {
  const m = src.match(new RegExp('function ' + nombre + '\\s*\\('))
  if (!m) throw new Error('no encontré function ' + nombre + ' en ' + RUTA)
  const ini = m.index
  let i = src.indexOf('{', ini), n = 0
  for (let j = i; j < src.length; j++) {
    if (src[j] === '{') n++
    else if (src[j] === '}') { n--; if (!n) return src.slice(ini, j + 1) }
  }
  throw new Error('no cerré ' + nombre)
}

const ctx = { DEVOL_UNIDAD: [], parseFloat, Math, String, console }
vm.createContext(ctx)
vm.runInContext(sacar('_devUnidad'), ctx)

const dev = (fecha, cam, litros, costo_usd) => ({ fecha, cam, litros, costo_usd })

test('lo devuelto por una unidad se suma en litros y en dólares', () => {
  ctx.DEVOL_UNIDAD = [
    dev('2026-11-10', 'JAC-B010', 180, 118.43),
    dev('2026-11-10', 'JAC-B011', 165, 109.94),
  ]
  const b010 = ctx._devUnidad('JAC-B010', '2026-11-01', '2026-11-30')
  assert.equal(b010.litros, 180)
  assert.equal(b010.usd, 118.43)
})

test('⭐ no se le acredita a la unidad equivocada', () => {
  ctx.DEVOL_UNIDAD = [dev('2026-11-10', 'JAC-B010', 180, 118.43)]
  const r = ctx._devUnidad('JAC-B011', '2026-11-01', '2026-11-30')
  assert.equal(r.usd, 0); assert.equal(r.litros, 0)
})

test('⭐ ni fuera del período', () => {
  ctx.DEVOL_UNIDAD = [dev('2026-10-10', 'JAC-B010', 180, 118.43)]
  const r = ctx._devUnidad('JAC-B010', '2026-11-01', '2026-11-30')
  assert.equal(r.usd, 0); assert.equal(r.litros, 0)
})

test('⭐ una devolución SIN valorizar suma litros y CERO dólares, no un precio inventado', () => {
  // Si no se pudo derivar el $/L, el informe tiene que mostrar litros que no cuadran con los
  // dólares. Eso es una PREGUNTA. Inventarle un precio sería un número falso con cara de bueno.
  ctx.DEVOL_UNIDAD = [dev('2026-11-10', 'JAC-B010', 180, null)]
  const r = ctx._devUnidad('JAC-B010', '2026-11-01', '2026-11-30')
  assert.equal(r.litros, 180)
  assert.equal(r.usd, 0)
})

test('⭐ el caso real del 10/11: 1.265 L y US$ 847,84 repartidos en 10 unidades', () => {
  const reales = [
    // Copiados de `devoluciones_tanque`, no de memoria: los de B010 y B011 se habian
    // escrito a ojo sobre una consulta RECORTADA (120,20 y 110,81) y son otros.
    ['JAC-B001', 120, 82.15], ['JAC-B002', 160, 107.32], ['JAC-B003', 160, 109.15],
    ['JAC-B004', 160, 109.09], ['JAC-B007', 40, 26.72], ['JAC-B008', 140, 91.82],
    ['JAC-B009', 80, 53.79], ['JAC-B010', 180, 118.43], ['JAC-B011', 165, 109.94],
    ['JAC-B012', 60, 39.43],
  ]
  ctx.DEVOL_UNIDAD = reales.map(([c, l, u]) => dev('2026-11-10', c, l, u))
  let lit = 0, usd = 0
  for (const [c] of reales) {
    const r = ctx._devUnidad(c, '2026-11-10', '2026-11-10')
    lit += r.litros; usd += r.usd
  }
  assert.equal(lit, 1265, 'los litros tienen que dar lo declarado por Máximo')
  assert.equal(Math.round(usd * 100) / 100, 847.84, 'y los dólares, lo valorizado')
})

// ── ⛔ LA LÍNEA QUE NO SE CRUZA ───────────────────────────────────────────────────────────
// Se mira el CÓDIGO, no el resultado: que las devoluciones NO aparezcan en los dos lugares
// donde se arma el gasto de la EMPRESA (`egGas`). Si un día alguien las resta ahí, el
// resultado del mes mejora solo y nadie va a saber por qué.
test('⭐⭐ las devoluciones NO tocan el gasto de la empresa', () => {
  const gasto = src.split('egGas+=')
  assert.ok(gasto.length > 1, 'no encontré dónde se arma el gasto de combustible de la empresa')
  for (let i = 1; i < gasto.length; i++) {
    const bloque = gasto[i].slice(0, 900)
    assert.ok(!/DEVOL_UNIDAD|_devUnidad/.test(bloque),
      'alguien restó las devoluciones del gasto de la empresa: eso BORRA un egreso real. ' +
      'El combustible se pagó; lo único que cambia es a qué unidad se le atribuye.')
  }
})

test('⭐ y sí tocan el costo POR UNIDAD, en las DOS pantallas', () => {
  // Centro de costos y rentabilidad atribuyen el mismo costo. Si sólo se acredita en una,
  // las dos dicen cosas distintas del mismo camión.
  assert.ok(/f\.comb-=dv\.usd/.test(src.replace(/\s+/g, '')),
    'el centro de costos no acredita lo devuelto')
  assert.ok(/map\[c\]\.combustible=\(map\[c\]\.combustible\|\|0\)-\(parseFloat\(d\.costo_usd\)\|\|0\)/.test(src.replace(/\s+/g, '')),
    'la pantalla de rentabilidad no acredita lo devuelto')
})
