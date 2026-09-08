// ⛔ LA AUDITORÍA ACUSABA DE ROBO CON UN NÚMERO QUE SE DESMENTÍA SOLO.
//
// En pantalla, en rojo y de primera: «JAC-B003 quedó el 29/08 con 556,8 L y amaneció el 30/08 con
// 556,8 L: faltan 300,0 L = $203,70. Revisá quién tuvo acceso al patio esa noche.»
// Los mismos litros a la noche y a la mañana, y un faltante de 300. Cualquiera que lo lea deja de
// creerle al módulo entero — y con razón.
//
// LA CAUSA, medida el 07/09/2026 contra la base real:
//   `created_at` es cuándo se ESCRIBIÓ LA FILA, no cuándo entró el gasoil, y la auditoría usaba lo
//   primero como si fuera lo segundo. Dos formas de que eso mienta, y las dos estaban vivas:
//
//   (1) LA CARGA EN LOTE. 40 de las 86 surtidas —6.862 L de 10 camiones, con fechas del 22/07 al
//       01/08— entraron en UN volcado el 18/08 a las 12:20:34: mismo `created_at` al microsegundo,
//       `hora` en null las 40. Para el cuadre de la noche, 6.862 L de julio «entraron a los
//       camiones» el 18 de agosto a mediodía. A la B012 le salió «faltan 506 L».
//       El código creía tener un freno para esto (`_acEntradasSinHora`) y estaba MUERTO: pedía
//       `created_at` vacío, y esa columna tiene `default now()`. La condición no era falsa nunca.
//
//   (2) EL CHOFER TECLEA CUANDO PUEDE. La B003 surtió 300 L durante el día del 29/08 (salió con
//       285,1 y volvió con 556,8) y los registró a las 21:25, ya en el patio. La auditoría los
//       contó como carga de la noche y los restó dos veces: una en la lectura de la regla y otra
//       en la resta. Faltante = carga, exacto, al décimo de litro.
//
// EL ARREGLO ES EL MECANISMO, no el caso: la REGLA es testigo de la carga y nadie le preguntaba.
// Si de noche entraron 300 L, el nivel TIENE que haber subido. Si no subió —o si esos litros ni
// siquiera CABÍAN en el hueco que había— los dos testigos se contradicen, y el instrumento físico
// manda sobre el sello de una fila. R1 se calla y sale R1C, que no acusa a nadie.
//
// 📌 Medido sobre TODA la historia (24/07 al 07/09): antes 5 faltantes, 3 de ellos FALSOS
//    (1.271 L ≈ $863 de robo que nunca existió: 3 de 5, el 60%). Después quedan 2, y las dos son
//    noches SIN ninguna carga de por medio, que es cuando R1 tiene derecho a hablar.
//
// Corre la auditoría REAL de `app.js` contra un volcado REAL de la base. Verificada al revés:
// contra `git show HEAD:app.js` los casos 1, 2 y 3 se ponen ROJOS.
//
//   node pruebas/carga-que-la-regla-no-ve.test.mjs [ruta-a-app.js]
import { readFileSync } from 'fs'
import { cargarAuditoria, sembrar, auditar } from './_banco-combustible.mjs'

const rutaApp = process.argv[2] || new URL('../app.js', import.meta.url)
const datos = JSON.parse(readFileSync(new URL('./datos/combustible.json', import.meta.url), 'utf8'))

const ctx = cargarAuditoria(rutaApp)
sembrar(ctx, datos)
const anom = auditar(ctx, '2026-07-24', '2026-09-07')

const R1  = anom.filter((a) => a.cod === 'R1')
const R1C = anom.filter((a) => a.cod === 'R1C')
const enR1  = (cam, fecha) => R1.some((a) => a.cam === cam && a.fecha === fecha)
const enR1C = (cam, fecha) => R1C.some((a) => a.cam === cam && a.fecha === fecha)

let fallos = 0
const caso = (n, desc, ok, detalle) => {
  if (ok) { console.log(`✅ ${n}. ${desc}`) }
  else { fallos++; console.log(`❌ ${n}. ${desc}\n      ${detalle}`) }
}

// ── Los tres que acusaban en falso ────────────────────────────────────────────────────────────
caso(1, 'B003 30/08: NO se le acusa de faltante (la regla no se movió y la carga no cabía)',
  !enR1('JAC-B003', '2026-08-30'),
  'sigue en R1: ' + JSON.stringify(R1.find((a) => a.cam === 'JAC-B003' && a.fecha === '2026-08-30')))

caso(2, 'B003 16/08: tampoco (577,5 → 577,5 con 465 L "cargados" en un hueco de 22,5 L)',
  !enR1('JAC-B003', '2026-08-16'), 'sigue en R1')

caso(3, 'B012 18/08: tampoco (seis cargas de JULIO volcadas en lote el 18/08 a las 12:20:34)',
  !enR1('JAC-B012', '2026-08-18'), 'sigue en R1')

// ── Y se dice lo que de verdad hay: la contradicción, sin señalar a nadie ─────────────────────
caso(4, 'B003 30/08 y 16/08 salen como R1C — contradicción, no faltante',
  enR1C('JAC-B003', '2026-08-30') && enR1C('JAC-B003', '2026-08-16'),
  'R1C tiene: ' + JSON.stringify(R1C.map((a) => a.cam + ' ' + a.fecha)))

caso(5, 'R1C no nombra a ningún chofer: de noche el custodio es el patio',
  R1C.every((a) => !a.quien), 'alguno trae chofer: ' + JSON.stringify(R1C.map((a) => a.quien)))

// No alcanza con que R1C no diga "faltan": tiene que decir EXPRESAMENTE que no lo es. Quien lee
// esto en pantalla acaba de ver otras líneas rojas que sí acusan, y si esta no se despega de
// aquellas, la va a leer igual. Y nunca manda a buscar culpables: manda a buscar el RECIBO.
caso(6, 'R1C dice que NO es un faltante y no manda a revisar quién tuvo acceso al patio',
  R1C.every((a) => /NO es un faltante/.test(a.texto) && !/acceso al patio/i.test(a.texto)),
  'R1C no se despega de la acusación')

// ── Lo que NO se puede perder: los faltantes de verdad siguen saliendo ────────────────────────
// Noches sin ninguna carga de por medio, odómetro quieto y el nivel bajó. Si el arreglo callara
// también estos, habría cambiado un módulo que miente por uno que no sirve.
// ⚠️ Esta lista se midió DOS veces. La primera salió de un banco calibrado a ojo (σ=0,5 cm) y
// traía 5 casos; con la σ real del producto (1 cm) la tolerancia es el doble y tres de ellos
// —35,8 · 59,7 · 35,8 L— caen dentro de ±2·TOL y el módulo nunca los reportó. La prueba pasaba
// midiendo con otra vara que la pantalla. Ahora el banco lee σ del `app.js` real.
const deVerdad = [['JAC-B004', '2026-08-08'], ['JAC-B002', '2026-08-08']]
caso(7, 'los faltantes SIN carga de por medio siguen acusándose',
  deVerdad.every(([c, f]) => enR1(c, f)),
  'faltan: ' + JSON.stringify(deVerdad.filter(([c, f]) => !enR1(c, f))))

caso(8, 'no quedó ningún R1 con carga de por medio (que es donde se mentía)',
  R1.every((a) => /no hay despacho registrado/.test(a.texto)),
  'hay R1 con carga: ' + JSON.stringify(R1.filter((a) => !/no hay despacho registrado/.test(a.texto)).map((a) => a.cam + ' ' + a.fecha)))

// ── El freno que estaba muerto ────────────────────────────────────────────────────────────────
// Contra el código ANTERIOR esta función ni existe: se informa así en vez de reventar, para que
// la corrida al revés muestre los 11 casos y no se corte en el 9.
const ubic = ctx._acSurtidaUbicable
caso(9, 'una surtida sin `hora` no puede ubicarse en el tiempo',
  typeof ubic === 'function' &&
  ubic({ cam: 'X', hora: null, created_at: '2026-08-18 12:20:34.849141+00' }) === false,
  typeof ubic === 'function' ? 'la dio por ubicable' : 'no existe `_acSurtidaUbicable`')

caso(10, 'una surtida de un LOTE (mismo created_at que otra) tampoco',
  typeof ubic === 'function' &&
  ubic(datos.surt.find((s) => s.created_at === '2026-08-18 12:20:34.849141+00')) === false,
  typeof ubic === 'function' ? 'la dio por ubicable' : 'no existe `_acSurtidaUbicable`')

caso(11, 'la surtida que SÍ asentó el chofer en el momento sigue ubicando',
  typeof ubic === 'function' &&
  ubic({ cam: 'X', hora: '09:14', created_at: '2026-09-01 13:14:02.111+00' }) === true,
  typeof ubic === 'function' ? 'la dejó de ubicar — se perdería el cuadre fino'
                             : 'no existe `_acSurtidaUbicable`')

console.log(fallos ? `\n⛔ ${fallos} caso(s) en rojo` : '\n✅ los 11 casos en verde')
process.exit(fallos ? 1 : 0)
