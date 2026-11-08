// ⛔ EL PUNTAJE DEL MÓDULO — Y POR QUÉ NO ES UN PUNTAJE
//
// 🔴 EL PROBLEMA. La respuesta a «¿puedo usar estos números para decidir algo?» ya existía, pero
//    repartida en seis lugares: el % de días auditables en una tarjeta, el piso de detección en
//    otro panel, el galpón más abajo, el examen del modo sombra al final de todo, R16 entre las
//    anomalías. Nadie la ve junta.
//
// ⛔ Y NO ES UN 0-100. Un promedio ponderado necesita pesos, y los pesos los inventaría yo: el
//    número saldría preciso y no estaría medido. Es una LISTA DE CONDICIONES, cada una con su
//    cifra real y con qué falta para cerrarla. «4 de 5» no finge una exactitud que no existe.
//
// ⚠️ Y cada condición tiene que decir QUÉ FALTA. Un tablero que marca rojo sin el próximo paso se
//    vuelve parte del paisaje.
//
//   node pruebas/cuanto-se-le-puede-creer.test.mjs [app.js]
import { readFileSync } from 'fs'
import { cargarAuditoria } from './_banco-combustible.mjs'

const rutaApp = process.argv[2] || new URL('../app.js', import.meta.url)
const js = readFileSync(rutaApp, 'utf8')
const ctx = cargarAuditoria(rutaApp)

let fallos = 0
const ok = (n, c, d) => { console.log((c ? '✅' : '❌') + ' ' + n + (c ? '' : '  → ' + d)); if (!c) fallos++ }

const TODO_BIEN = {
  pctAud: 95, completas: 95, total: 100,
  piso: { piso: 30, pctDelDia: 50 },
  galpon: { mediciones: 2, sinGalpon: false },
  r16: 0,
  sombra: { examenOk: true, ev: 20, prec: 0.95, min: 15, prec_min: 0.9, pend: 0 },
}
const todoBien = ctx._acConfianza(TODO_BIEN)
ok('1. con todo en orden, se cumplen TODAS', todoBien.ok === todoBien.total && todoBien.total === 5,
   'dio ' + todoBien.ok + ' de ' + todoBien.total)

const TODO_MAL = {
  pctAud: 60, completas: 60, total: 100,
  piso: { piso: 70, pctDelDia: 113 },
  galpon: { mediciones: 0, sinGalpon: false },
  r16: 8,
  sombra: { examenOk: false, ev: 2, prec: 0.5, min: 15, prec_min: 0.9, pend: 25 },
}
const todoMal = ctx._acConfianza(TODO_MAL)
ok('2. con todo mal, no se cumple NINGUNA', todoMal.ok === 0, 'dio ' + todoMal.ok + ' cumplidas')

// ── ⛔ CADA CONDICIÓN SE PRUEBA SOLA, o un «4 de 5» no significa nada ───────────────────────
// Si dos condiciones leyeran la misma cosa, el contador diría 5 y estaría midiendo 4.
const soloUna = (clave, cambio) => {
  const r = ctx._acConfianza({ ...TODO_BIEN, ...cambio })
  const rotas = r.cond.filter((x) => !x.ok).map((x) => x.clave)
  return rotas.length === 1 && rotas[0] === clave
}
ok('3. la cobertura se rompe sola', soloUna('cobertura', { pctAud: 60 }), 'rompió otra condición también')
ok('4. el piso se rompe solo', soloUna('piso', { piso: { piso: 70, pctDelDia: 113 } }), 'rompió otra también')
ok('5. el galpón se rompe solo', soloUna('galpon', { galpon: { mediciones: 1, sinGalpon: false } }), 'rompió otra también')
ok('6. la factura se rompe sola', soloUna('factura', { r16: 3 }), 'rompió otra también')
ok('7. el examen se rompe solo', soloUna('examen', { sombra: { ...TODO_BIEN.sombra, examenOk: false } }), 'rompió otra también')

// ── Los bordes exactos ─────────────────────────────────────────────────────────────────────
ok('8. 90% de cobertura CUMPLE (es el umbral, no «más de»)',
   ctx._acConfianza({ ...TODO_BIEN, pctAud: 90 }).cond.find((x) => x.clave === 'cobertura').ok, 'el borde quedó afuera')
ok('9. un piso de exactamente 100% de un día NO cumple',
   !ctx._acConfianza({ ...TODO_BIEN, piso: { piso: 60, pctDelDia: 100 } }).cond.find((x) => x.clave === 'piso').ok,
   'si el piso es todo un día, «0 anomalías» no dice nada')

// ── ⛔ UNA EMPRESA SIN GALPÓN NO ARRASTRA UNA CONDICIÓN QUE NO LE TOCA ──────────────────────
// Los clones de FlotaMax pueden no tener tanque propio. Marcarles rojo para siempre por algo que
// no existe en su operación es un aviso que salta siempre: deja de avisar.
ok('10. sin tanque de galpón, esa condición dice «no aplica» y CUMPLE',
   ctx._acConfianza({ ...TODO_BIEN, galpon: { mediciones: 0, sinGalpon: true } }).cond.find((x) => x.clave === 'galpon').ok,
   'un rojo permanente por algo que la empresa no tiene enseña a ignorar el tablero')

// ── ⛔ CADA CONDICIÓN DICE QUÉ FALTA ────────────────────────────────────────────────────────
ok('11. todas las condiciones traen el próximo paso', todoMal.cond.every((x) => x.falta && x.falta.length > 20),
   'alguna marca rojo sin decir qué hacer: ' + todoMal.cond.filter((x) => !x.falta).map((x) => x.clave).join(','))
ok('12. y todas traen su cifra real, no solo un sí/no', todoMal.cond.every((x) => x.cifra && String(x.cifra) !== '—'),
   'alguna no dice su número: ' + todoMal.cond.filter((x) => !x.cifra).map((x) => x.clave).join(','))
ok('13. el que falta veredictos dice CUÁNTOS, no «[object Object]»',
   /25 faltantes/.test(todoMal.cond.find((x) => x.clave === 'examen').falta),
   'salió: ' + todoMal.cond.find((x) => x.clave === 'examen').falta)

// ── Y que la pantalla lo muestre, ARRIBA ───────────────────────────────────────────────────
const plano = js.replace(/\s+/g, ' ')
ok('14. el panel existe', /¿Cuánto se le puede creer a estos números hoy\?/.test(plano),
   'la función existe pero nadie la dibuja')
ok('15. dice explícitamente que NO es un puntaje', /No es un puntaje/.test(plano),
   'sin esa frase «4 de 5» se lee como una nota, y una nota invita a promediarla')
// ⛔ ARRIBA DE LOS KPIs: su trabajo es decir si los números de abajo sirven. Abajo del todo ya
//    los leíste. Se mide por POSICIÓN en el HTML, no por una frase.
ok('16. va ANTES de las tarjetas de números',
   js.indexOf('¿Cuánto se le puede creer') < js.indexOf("_acCard('Consumo del período'"),
   'quedó debajo de los números que tiene que calificar')

console.log('\n' + (fallos === 0 ? '✅ TODAS PASAN' : '⛔ ' + fallos + ' MAL'))
process.exit(fallos === 0 ? 0 : 1)
