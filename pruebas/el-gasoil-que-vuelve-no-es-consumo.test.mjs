// ⛔ EL GASOIL QUE SE LE SACA A UNA UNIDAD NO ES CONSUMO DE ESA UNIDAD.
//
// 🔴 10/11/2026: se le sacó gasoil a 10 unidades de Betangar y se echó al tanque aéreo del
//    galpón — 1.265 L declarados. Ese combustible BAJA LA REGLA del camión exactamente igual
//    que si lo hubiera quemado, así que sin un término que lo reste, el día lo cuenta como
//    consumo: la B002 figuraba consumiendo 404,5 L contra un típico de 60.
//
//    Eso no es un número feo. Es una ACUSACIÓN a un chofer por algo que hizo la empresa, y
//    el módulo la emite con la misma cara con la que emite un dato bueno.
//    [[norma-una-asercion-mal-escrita-acusa-al-producto]]
//
// Y rompe por el OTRO lado a la vez: los litros entran al tanque sin origen, que es justo lo
// que dispara R14 «amaneció con más». Un movimiento que no está anotado desordena las dos
// puntas y cada punta señala a una persona distinta.
//
// Acá se prueban las dos, y en los dos sentidos:
//   1. el consumo de la unidad descuenta lo devuelto
//   2. lo devuelto ENTRA al saldo del tanque, pero NO como compra (no le debemos a nadie)
//   3. un período con sólo devoluciones NO está «en reposo» (si no, el reposo acusa un faltante)
//   4. ⭐ CONTROL NEGATIVO: una devolución a un tanque AJENO no se cuenta
//   5. ⭐ sin devoluciones, todo da exactamente lo mismo que antes
//
//   node pruebas/el-gasoil-que-vuelve-no-es-consumo.test.mjs [ruta-a-app.js]
import test from 'node:test'
import assert from 'node:assert/strict'
import { cargarAuditoria } from './_banco-combustible.mjs'

const ctx = cargarAuditoria(process.argv[2] || undefined)

// Un tanque propio y uno ajeno, para poder probar el descarte.
ctx.AC_TANQUES = [
  { id: 'tanque-galpon-1', nombre: 'Galpón 1', tipo: 'galpon', cap: 2198.61, hmax: 108, tabla: null },
]
ctx.AC_META = { ...ctx.AC_META, corteSurtidas: '2000-01-01', tanquesPropios: ['tanque-galpon-1'], tanquesPropiosLeido: true }

const dev = (fecha, cam, tanque, litros) => ({ fecha, cam, tanque, litros })

test('lo devuelto entra al tanque, y NO como compra', () => {
  ctx.AC_GASOIL = []            // ni una compra
  ctx.AC_SURTIDAS = []
  ctx.AC_SALIDAS_TANQUE = []
  ctx.AC_DEVOLUCIONES = [dev('2026-11-10', 'JAC-B002', 'tanque-galpon-1', 160)]

  const compras = ctx._acComprasGalpon('2026-11-01', '2026-11-30')
  const devs = ctx._acDevolucionesGalpon('2026-11-01', '2026-11-30')
  assert.equal(compras, 0, 'una devolución NO puede contarse como compra: crearía una deuda que no existe')
  assert.equal(devs, 160, 'la devolución tiene que entrar por su propio término')

  const saldo = ctx._acSaldoLibrosGalpon()
  assert.equal(saldo.devoluciones, 160, 'el saldo tiene que poder decir cuánto vino devuelto')
  assert.equal(saldo.entradas, 160, 'y sumarlo a lo que entró')
  assert.equal(saldo.saldo, 160, 'entradas − salidas')
})

test('⭐ CONTROL NEGATIVO: una devolución a un tanque que no es nuestro no se cuenta', () => {
  ctx.AC_DEVOLUCIONES = [dev('2026-11-10', 'JAC-B002', 'tanque-de-un-tercero', 160)]
  assert.equal(ctx._acDevolucionesGalpon('2026-11-01', '2026-11-30'), 0,
    'contar una entrada ajena fabricaría un sobrante inventado en nuestro tanque')
})

test('fuera del período no se cuenta', () => {
  ctx.AC_DEVOLUCIONES = [dev('2026-10-01', 'JAC-B002', 'tanque-galpon-1', 160)]
  assert.equal(ctx._acDevolucionesGalpon('2026-11-01', '2026-11-30'), 0)
})

test('⭐ un período con SÓLO devoluciones no está en reposo', () => {
  ctx.AC_GASOIL = []; ctx.AC_SURTIDAS = []; ctx.AC_SALIDAS_TANQUE = []
  ctx.AC_MED = []
  ctx.AC_DEVOLUCIONES = [dev('2026-11-10', 'JAC-B002', 'tanque-galpon-1', 160)]
  const c = ctx._acCuadreGalpon('2026-11-01', '2026-11-30')
  assert.equal(c.devoluciones, 160)
  assert.equal(c.reposo, false,
    'en reposo el cuadre exige el MISMO nivel: con una devolución sin contar, acusaría un faltante de 160 L')
})

test('⭐ sin devoluciones, todo queda exactamente como antes', () => {
  ctx.AC_DEVOLUCIONES = []
  assert.equal(ctx._acDevolucionesGalpon('2026-11-01', '2026-11-30'), 0)
  const saldo = ctx._acSaldoLibrosGalpon()
  assert.equal(saldo.devoluciones, 0)
  const c = ctx._acCuadreGalpon('2026-11-01', '2026-11-30')
  assert.equal(c.reposo, true, 'sin un solo movimiento el tanque SÍ está en reposo')
})

// ── El lado de la UNIDAD ─────────────────────────────────────────────────────────────────
// Se arma la jornada con el mismo motor de la pantalla: salida 45 cm, llegada 25 cm, sin
// cargas. Lo que baje de más tiene que explicarse por la devolución, no por el chofer.
test('⭐ el consumo de la unidad descuenta lo que le sacaron', () => {
  const cam = 'JAC-B003'
  ctx.AC_TANQUES = [
    { id: 'tanque-galpon-1', nombre: 'Galpón 1', tipo: 'galpon', cap: 2198.61, hmax: 108, tabla: null },
    // Tanque de camión con una cubicación LINEAL simple: 10 L por cm, para que la cuenta se
    // pueda verificar a mano y el test no dependa de la tabla real del JAC.
    { id: 'tq-cam', nombre: 'Camión', tipo: 'vehiculo', cap: 600, hmax: 60,
      tabla: Object.fromEntries(Array.from({ length: 61 }, (_, h) => [String(h), h * 10])) },
  ]
  ctx.FLOTA = { [cam]: {} }
  ctx.UNIDAD_CONFIG = { [cam]: { capacidad_tanque_l: 600 } }
  ctx.AC_META = { ...ctx.AC_META, modeloCam: { [cam]: '' }, corregidas: {}, noConf: {},
                  tanquesPropios: ['tanque-galpon-1'], tanquesPropiosLeido: true }
  ctx.AC_SURTIDAS = []
  ctx.AC_GASOIL = []
  ctx.AC_MED = [
    { id: 1, fecha: '2026-11-10', vehiculo_id: cam, tanque_id: 'tq-cam', momento: 'salida',  altura_cm: 45, created_at: '2026-11-10 06:00:00+00' },
    { id: 2, fecha: '2026-11-10', vehiculo_id: cam, tanque_id: 'tq-cam', momento: 'llegada', altura_cm: 25, created_at: '2026-11-10 18:00:00+00' },
  ]

  // Sin devolución: bajó 20 cm = 200 L, y todo eso se le cuenta al camión.
  ctx.AC_DEVOLUCIONES = []
  let j = ctx._acArmarJornadas('2026-11-10', '2026-11-10').find((x) => x.cam === cam)
  assert.ok(j, 'la jornada tiene que armarse')
  assert.equal(j.consumo, 200, 'sin devolución, los 200 L son consumo')

  // Con 160 L sacados ese día: al camión le quedan 40.
  ctx.AC_DEVOLUCIONES = [dev('2026-11-10', cam, 'tanque-galpon-1', 160)]
  j = ctx._acArmarJornadas('2026-11-10', '2026-11-10').find((x) => x.cam === cam)
  assert.equal(j.devuelto, 160, 'la jornada tiene que saber cuánto se le sacó')
  assert.equal(j.consumo, 40, '200 que bajaron − 160 que se le sacaron = 40 de consumo real')

  // ⭐ Y la devolución de OTRA unidad no le toca el consumo a ésta.
  ctx.AC_DEVOLUCIONES = [dev('2026-11-10', 'JAC-B999', 'tanque-galpon-1', 160)]
  j = ctx._acArmarJornadas('2026-11-10', '2026-11-10').find((x) => x.cam === cam)
  assert.equal(j.consumo, 200, 'lo que se le sacó a otro camión no puede descontarse de éste')

  // ⭐ Ni la de OTRO DÍA.
  ctx.AC_DEVOLUCIONES = [dev('2026-11-09', cam, 'tanque-galpon-1', 160)]
  j = ctx._acArmarJornadas('2026-11-10', '2026-11-10').find((x) => x.cam === cam)
  assert.equal(j.consumo, 200, 'una devolución de otro día no puede descontarse de esta jornada')
})
