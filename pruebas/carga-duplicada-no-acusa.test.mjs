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
// ⛔ EL CASO SE REPRODUCE EN UN FIXTURE, NO SE LEE DEL DATO VIVO.
//    Esta prueba se puso ROJA el 08/11/2026 **porque el duplicado se arregló**: la segunda carga
//    de 350 L de la B009 del 05/09 se anuló (quedó en 0 L, con su historial), así que ya no hay
//    700 L que detectar. Una prueba cuyo fixture es el dato de producción **no distingue «se
//    arregló» de «se rompió»**, y encima castiga a quien corrige los datos.
//    📌 Lo que hay que proteger para siempre es la REGLA: que una carga duplicada se vea, que
//      el día no se cuadre con ella adentro, y que NADIE quede acusado. Eso se prueba sembrando
//      el duplicado a propósito. El caso real queda documentado arriba, que es donde va la
//      historia. [[norma-el-pendiente-viejo-se-verifica-contra-el-producto]]
const DUP = { id: 'DUP-PRUEBA', fecha: '2026-09-05', cam: 'JAC-B009', litros: 350,
  tanque: 'estacion', turno: 'diurno', hora: '18:28', created_at: '2026-09-05 22:28:00+00' }
const base = (datos.surt || []).filter((x) => !(x.cam === 'JAC-B009' && String(x.fecha).slice(0, 10) === '2026-09-05'))
// La carga REAL de 350 L mas su duplicado: los mismos 700 L del caso del 08/09/2026.
const conDup = base.concat([{ ...DUP, id: 'REAL-PRUEBA', hora: '18:08', created_at: '2026-09-05 22:08:00+00' }, DUP])
const ctx = cargarAuditoria(rutaApp)
sembrar(ctx, { ...datos, surt: conDup })
const anom = auditar(ctx, '2026-07-24', '2026-09-07')

// ⛔ Y EL CONTROL POSITIVO DEL FIXTURE: sin el duplicado, el dia tiene que cuadrar. Si no, la
//    prueba de abajo podria estar verde por cualquier otro motivo del dia.
const ctxLimpio = cargarAuditoria(rutaApp)
sembrar(ctxLimpio, { ...datos, surt: base.concat([{ ...DUP, id: 'REAL-PRUEBA', hora: '18:08', created_at: '2026-09-05 22:08:00+00' }]) })
// Las jornadas se arman al AUDITAR, no al sembrar: sin esta llamada `AC_JORNADAS` esta vacio
// y el control positivo daria rojo por un motivo que no es el suyo.
auditar(ctxLimpio, '2026-07-24', '2026-09-07')
const jLimpio = ctxLimpio.AC_JORNADAS.find((j) => j.cam === 'JAC-B009' && j.fecha === '2026-09-05')
const jor = (cam, f) => ctx.AC_JORNADAS.find((j) => j.cam === cam && j.fecha === f)

let fallos = 0
const caso = (n, desc, ok, detalle) => {
  if (ok) console.log(`✅ ${n}. ${desc}`)
  else { fallos++; console.log(`❌ ${n}. ${desc}\n      ${detalle}`) }
}

caso(0, 'CONTROL POSITIVO: con UNA sola carga de 350 L el dia cuadra normal',
  !!jLimpio && jLimpio.desp === 350 && !jLimpio.cargaImposible,
  'desp=' + (jLimpio && jLimpio.desp) + ' cargaImposible=' + (jLimpio && jLimpio.cargaImposible) +
  ' — si esto falla, el verde de abajo no prueba que el duplicado sea lo detectado')

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
// ⚠️ Se mira el TITULO y el CUERPO juntos. El 07/11 R15 se reescribio —el total del dia no podia
//    probar nada, ver `norma-antes-de-afirmar-imposible-hacer-el-algebra`— y la duplicacion quedo
//    dicha en el titulo («Una carga quedo asentada dos veces»). La asercion buscaba «dos veces»
//    solo en el cuerpo y se puso roja contra un mensaje que dice exactamente lo que tiene que
//    decir. Lo que esta prueba defiende es el SENTIDO, no donde cae la frase.
const r15txt = r15 ? ((r15.titulo || '') + ' ' + (r15.texto || '')) : ''
caso(4, 'pero SÍ se dice: R15 lo reporta, sin nombrar a nadie, y sugiere mirar las fotos',
  !!r15 && !r15.quien && /dos veces|DOS cargas/.test(r15txt) && /fotos/.test(r15txt),
  r15 ? ('quien=' + r15.quien + ' · titulo=' + r15.titulo) : 'R15 no salió — el día desaparecería en silencio')

caso(5, 'B012 26/07: R4 no acusa sobre un día cuya carga vino del volcado en lote',
  !anom.some((a) => a.cod === 'R4' && a.cam === 'JAC-B012' && a.fecha === '2026-07-26'),
  'sigue acusando con una carga de papel')

// Lo que NO se puede perder: los consumos altos de verdad, en días sin ninguna carga rara.
caso(6, 'los consumos altos con el tanque limpio siguen saliendo',
  anom.some((a) => a.cod === 'R4' && a.cam === 'JAC-B012' && a.fecha === '2026-07-31'),
  'se perdió el R4 legítimo de la B012 del 31/07')

console.log(fallos ? `\n⛔ ${fallos} caso(s) en rojo` : '\n✅ los 6 casos en verde')
process.exit(fallos ? 1 : 0)
