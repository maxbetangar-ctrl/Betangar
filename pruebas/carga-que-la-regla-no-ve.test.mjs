// ⛔ LA AUDITORÍA ACUSABA DE ROBO CON UN NÚMERO QUE SE DESMENTÍA SOLO — Y EL OTRO NÚMERO, EL DEL
//    CARTEL, CONTABA COMO «NO REGISTRADO» COMBUSTIBLE QUE SÍ ESTABA REGISTRADO.
//
// En pantalla, en rojo y de primera: «JAC-B003 quedó el 29/08 con 556,8 L y amaneció el 30/08 con
// 556,8 L: faltan 300,0 L. Revisá quién tuvo acceso al patio esa noche.» Los mismos litros a la
// noche y a la mañana, y una acusación de robo.
//
// UNA SOLA CAUSA, dos daños opuestos: `created_at` es cuándo se ESCRIBIÓ LA FILA, no cuándo entró
// el gasoil, y la auditoría lo usaba como si fuera lo segundo. Y `hora` tampoco sirve: la escribe
// la PWA con el reloj del teléfono AL GUARDAR (`chofer.html`, `hora:p2(now.getHours())…`).
//
//   (1) EL LOTE. 40 de las 86 surtidas —6.862 L de 10 camiones, con fechas del 22/07 al 01/08—
//       entraron en UN volcado el 18/08 a las 12:20:34, mismo `created_at` al microsegundo y
//       `hora` en null. Litros de julio contados como la carga de una noche de agosto: a la B012
//       le salió «faltan 506 L» de un tanque de 600 que esa noche tenía 464.
//   (2) EL CHOFER TECLEA CUANDO PUEDE. La B003 surtió 300 L durante el día del 29/08 (salió con
//       285,1 y volvió con 556,8) y los registró a las 21:25, ya en el patio. Esa fila caía FUERA
//       de su propio día —y por eso R13 la reportaba como «entró combustible sin registrarse»— y
//       DENTRO de la noche, donde se restaba y fabricaba el faltante. Justo al revés de donde va.
//
// EL ARREGLO ES EL MECANISMO: una surtida declara una FECHA, no una hora.
//   • El DÍA cuenta la carga por la fecha que declaró quien surtió. Es lo único que la fila sabe.
//   • La NOCHE dejó de restar cargas: no hay forma de saber si entraron antes o después de la
//     lectura. Si hay carga declarada en cualquiera de los dos días, R1 SE CALLA. Cuando no la
//     hay, el cuadre es limpio —salió con X, amaneció con Y— y R1 sigue hablando.
//
// 📌 Medido sobre la base real, contra el código anterior (`git show 6074815:app.js`):
//     · faltantes acusados en toda la historia: 1.485 L → 214 L (3 de 5 eran FALSOS)
//     · R13 «entró sin registrarse» en el período de pantalla: 4.040 L → 3.419 L (621,6 L estaban
//       registrados, con foto y GPS)
//     · consumo del período: 4.895 L → 5.612 L, porque esa carga vuelve al día que le toca
//
// ⚠️ LO QUE SE PIERDE: una noche en la que además hubo carga ese día ya no se audita. No hay forma
//    de auditarla con los datos que existen, y acusar con datos que no distinguen es exactamente
//    lo que trajo los tres faltantes falsos. Se recupera capturando la hora REAL de la surtida.
//
// Corre la auditoría REAL de `app.js` (no una copia) contra un recorte real de la base.
// Verificada al revés: contra `6074815:app.js` los casos 1, 2, 3, 5, 6, 7, 9 y 11 se ponen ROJOS.
//
//   node pruebas/carga-que-la-regla-no-ve.test.mjs [ruta-a-app.js]
import { readFileSync } from 'fs'
import { cargarAuditoria, sembrar, auditar } from './_banco-combustible.mjs'

const rutaApp = process.argv[2] || new URL('../app.js', import.meta.url)
const datos = JSON.parse(readFileSync(new URL('./datos/combustible.json', import.meta.url), 'utf8'))

const ctx = cargarAuditoria(rutaApp)
sembrar(ctx, datos)
const anom = auditar(ctx, '2026-07-24', '2026-09-07')
const R1 = anom.filter((a) => a.cod === 'R1')
const enR1 = (cam, fecha) => R1.some((a) => a.cam === cam && a.fecha === fecha)

let fallos = 0
const caso = (n, desc, ok, detalle) => {
  if (ok) console.log(`✅ ${n}. ${desc}`)
  else { fallos++; console.log(`❌ ${n}. ${desc}\n      ${detalle}`) }
}

// ── Los tres que acusaban en falso ────────────────────────────────────────────────────────────
caso(1, 'B003 30/08: ya no se le acusa de faltante (556,8 → 556,8 con 300 L declarados ese día)',
  !enR1('JAC-B003', '2026-08-30'),
  'sigue: ' + JSON.stringify(R1.find((a) => a.cam === 'JAC-B003' && a.fecha === '2026-08-30')))
caso(2, 'B003 16/08: tampoco (577,5 → 577,5 con 465 L declarados el 15/08)',
  !enR1('JAC-B003', '2026-08-16'), 'sigue en R1')
caso(3, 'B012 18/08: tampoco (seis cargas de JULIO volcadas en lote el 18/08 a las 12:20:34)',
  !enR1('JAC-B012', '2026-08-18'), 'sigue en R1')

// ── Lo que NO se puede perder: los faltantes de verdad siguen saliendo ────────────────────────
// Noches sin ninguna carga declarada, odómetro quieto y el nivel bajó. Si el arreglo callara
// también estos, habría cambiado un módulo que miente por uno que no sirve.
const deVerdad = [['JAC-B004', '2026-08-08'], ['JAC-B002', '2026-08-08']]
caso(4, 'los faltantes SIN ninguna carga declarada siguen acusándose',
  deVerdad.every(([c, f]) => enR1(c, f)),
  'faltan: ' + JSON.stringify(deVerdad.filter(([c, f]) => !enR1(c, f))))
caso(5, 'y todo R1 que quede dice que no hay carga registrada en esos dos días',
  R1.every((a) => /no hay ninguna carga registrada/.test(a.texto)),
  'hay R1 con carga cerca: ' + JSON.stringify(R1.filter((a) => !/no hay ninguna carga registrada/.test(a.texto)).map((a) => a.cam + ' ' + a.fecha)))

// ── La otra mitad: la carga vuelve al día que le toca ─────────────────────────────────────────
const jor = (cam, fecha) => ctx.AC_JORNADAS.find((j) => j.cam === cam && j.fecha === fecha)
const j29 = jor('JAC-B003', '2026-08-29')
caso(6, 'B003 29/08: los 300 L tecleados a las 21:25 cuentan en SU día (285,1 + 300 − 556,8)',
  j29 && Math.abs(j29.desp - 300) < 0.01 && Math.abs(j29.consumo - 28.33) < 0.5,
  'desp=' + (j29 && j29.desp) + ' consumo=' + (j29 && j29.consumo))

// Y por eso ese día deja de salir por R13. Antes: `desp`=0 → consumo −271,7 L → «entró
// combustible sin registrarse». Ahora: `desp`=300 → consumo +28,3 L → el día cuadra y no dice nada.
caso(7, 'B003 29/08 deja de salir como «entró combustible sin registrarse»',
  !!j29 && j29.consumo > -2 * (j29.tol || 0),
  'sigue marcado: consumo=' + (j29 && j29.consumo) + ' tol=' + (j29 && j29.tol))

// ⚠️ Y lo que NO se puede perder: el hallazgo de verdad. La flota surte cada 7 días —08/08, 15/08,
// 22/08, 29/08, 05/09— y esas cargas no se asientan. Si el arreglo se llevara esto por delante,
// habría cambiado un número inflado por uno ciego.
const R13 = anom.find((a) => a.cod === 'R13')
caso(8, 'el hallazgo real sigue: la B012 del 22/08 subió ~400 L sin ninguna carga declarada',
  (() => { const j = jor('JAC-B012', '2026-08-22'); return !!j && j.desp === 0 && j.consumo < -2 * j.tol })() && !!R13,
  'se perdió el hallazgo real de R13')

// ── Y una carga de JULIO no puede contar en un día de AGOSTO ──────────────────────────────────
caso(9, 'el lote del 18/08 no aporta ni un litro a ningún día de agosto de la B012',
  ctx._acEntradas('JAC-B012', '2026-08-18', '2026-08-18', true) === 0,
  'aporta ' + ctx._acEntradas('JAC-B012', '2026-08-18', '2026-08-18', true) + ' L')
caso(10, '…y sí cuenta en su fecha declarada (22/07: 120 + 80 = 200 L)',
  ctx._acEntradas('JAC-B012', '2026-07-22', '2026-07-22', true) === 200,
  'da ' + ctx._acEntradas('JAC-B012', '2026-07-22', '2026-07-22', true) + ' L')

// ── No quedó ninguna regla nueva haciendo ruido ───────────────────────────────────────────────
// R1C existió unas horas el 08/09 y se quitó el mismo día: con la carga contada por fecha saltaba
// 66 veces en 45 días. Un aviso que salta siempre no avisa de nada.
caso(11, 'no hay ninguna anomalía R1C (la regla se quitó, no quedó apagada a medias)',
  !anom.some((a) => a.cod === 'R1C'), anom.filter((a) => a.cod === 'R1C').length + ' R1C vivas')

console.log(fallos ? `\n⛔ ${fallos} caso(s) en rojo` : '\n✅ los 11 casos en verde')
process.exit(fallos ? 1 : 0)
