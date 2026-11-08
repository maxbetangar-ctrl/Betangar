// ⛔ UNA SURTIDA «SIN UBICAR» NO ES DEL GALPÓN, Y TAMPOCO ES GRATIS
//
// 🔴 QUÉ PASÓ. El 08/11/2026 el tanque de una surtida pasó a decidirlo el GPS, y apareció un
//    TERCER valor: `sin_confirmar`, para cuando no hay señal o el camión está lejos de toda
//    estación. La oficina estaba escrita para DOS cajones —`if (tanque==='estacion') … else
//    galpón`— así que cada carga sin ubicar se iba al galpón por descarte:
//    exactamente el error que la corrección vino a borrar, reaparecido del otro lado.
//
// ⛔ Y HAY UN SEGUNDO AGUJERO, más callado: el costeo preguntaba `tanque==='estacion'`. Una
//    surtida sin ubicar no figuraba como pendiente de costear, valía $0, y seguía valiendo $0
//    **aun después** de que administración le pusiera precio, porque tampoco entraba al gasto.
//    Un dato que no suma y que nadie ve es peor que uno mal: no se reclama.
//
// 📌 EL CRITERIO CORRECTO es «NO ES DEL GALPÓN», no «es igual a estación». `sin_confirmar`
//    significa «no sé CUÁL estación», no «no sé si se compró» — y nunca es el galpón, porque
//    el galpón ahora exige una marca deliberada de la oficina.
//    [[norma-falta-de-dato-no-es-un-dato]]
//
//   node pruebas/surtida-sin-ubicar-no-es-del-galpon.test.mjs [app.js]
import { readFileSync } from 'fs'

const rutaApp = process.argv[2] || new URL('../app.js', import.meta.url)
const js = readFileSync(rutaApp, 'utf8')

let fallos = 0
const ok = (n, c, d) => { console.log((c ? '✅' : '❌') + ' ' + n + (c ? '' : '  → ' + d)); if (!c) fallos++ }

const saca = (nombre) => {
  const i = js.indexOf('function ' + nombre + '(')
  if (i < 0) return null
  let p = 0, fin = -1
  for (let k = js.indexOf('{', i); k < js.length; k++) {
    if (js[k] === '{') p++
    else if (js[k] === '}') { p--; if (p === 0) { fin = k + 1; break } }
  }
  return fin > 0 ? js.slice(i, fin) : null
}

const fE = saca('_surEsExterna'), fP = saca('_surPendiente'), fC = saca('_surCostoUsd')
ok('0. CONTROL POSITIVO: las tres funciones existen', !!fE && !!fP && !!fC,
   'falta alguna: ' + [['_surEsExterna', fE], ['_surPendiente', fP], ['_surCostoUsd', fC]].filter((x) => !x[1]).map((x) => x[0]).join(', '))
if (!fE || !fP || !fC) { console.log('\n⛔ sin las funciones no se prueba nada.'); process.exit(1) }
const api = new Function(fE + '\n' + fP + '\n' + fC + '\n return {_surEsExterna,_surPendiente,_surCostoUsd};')()

// ── 1. Los tres estados ─────────────────────────────────────────────────────────────────────
ok('1. una de estación es EXTERNA', api._surEsExterna({ tanque: 'estacion' }) === true, 'dio otra cosa')
ok('2. una «sin ubicar» TAMBIÉN es externa', api._surEsExterna({ tanque: 'sin_confirmar' }) === true,
   'si no, se cuenta como litros del galpón por descarte — el error que esto arregla')
ok('3. ⛔ el galpón NO es externa', api._surEsExterna({ tanque: 'galpon_1' }) === false &&
   api._surEsExterna({ tanque: 'galpon_2' }) === false, 'el combustible propio no es una compra')
ok('4. una fila sin tanque no revienta ni se cuenta como galpón',
   api._surEsExterna({}) === true && api._surEsExterna(null) === false,
   'un tanque vacío no es el galpón: el galpón hay que declararlo')

// ── 2. ⛔ LO QUE FALTA COSTEAR ───────────────────────────────────────────────────────────────
ok('5. la de estación sin costear está PENDIENTE',
   api._surPendiente({ tanque: 'estacion', costo_definido: false }) === true, 'dio otra cosa')
ok('6. la «sin ubicar» sin costear TAMBIÉN está pendiente',
   api._surPendiente({ tanque: 'sin_confirmar', costo_definido: false }) === true,
   'quedaría en $0 para siempre y sin aparecer en ninguna lista: nadie la reclamaría')
ok('7. la del galpón NUNCA está pendiente', api._surPendiente({ tanque: 'galpon_1', costo_definido: false }) === false,
   'el galpón se valúa al costo del tanque, no lo cuesta administración')
ok('8. una ya costeada deja de estar pendiente',
   api._surPendiente({ tanque: 'sin_confirmar', costo_definido: true }) === false, 'sigue pidiendo precio')

// ── 3. El costo ─────────────────────────────────────────────────────────────────────────────
ok('9. sin costear vale 0 —no se inventa un precio—',
   api._surCostoUsd({ tanque: 'sin_confirmar', costo_definido: false, costo_usd: 999 }) === 0,
   'usó un costo que todavía nadie confirmó')
ok('10. ya costeada vale lo que dice',
   api._surCostoUsd({ tanque: 'sin_confirmar', costo_definido: true, costo_usd: 120.5 }) === 120.5,
   'después de costearla seguía valiendo 0, que es el agujero callado')
ok('11. la del galpón vale su costo horneado siempre',
   api._surCostoUsd({ tanque: 'galpon_1', costo_definido: false, costo_usd: 80 }) === 80,
   'el galpón ya viene valuado al costo del tanque')

// ── 4. Y que la pantalla lo muestre aparte, no repartido ────────────────────────────────────
const plano = js.replace(/\s+/g, ' ')
ok('12. el tablero cuenta los litros sin ubicar por separado', /var litGal=0,litEst=0,litPend=0,litSin=0/.test(plano),
   'si no tienen su propio contador, se suman a uno de los otros dos')
ok('13. …y solo se muestran cuando los hay', /litSin>0\?chip\('Sin ubicar/.test(plano),
   'una tarjeta en cero todos los días deja de leerse')
ok('14. `sin_confirmar` tiene etiqueta en castellano', /sin_confirmar:'[^']+'/.test(plano),
   'en la tabla se leería literalmente «sin_confirmar»')
// ⛔ La comparación vieja no puede quedar NI UNA: cada una es un lugar donde las sin ubicar
//    vuelven a caer en el cajón del galpón o a valer cero.
ok('15. no queda ninguna comparación `tanque===\'estacion\'`', !/tanque==='estacion'/.test(js),
   'quedan ' + (js.match(/tanque==='estacion'/g) || []).length + ': cada una es un agujero')

console.log('\n' + (fallos === 0 ? '✅ TODAS PASAN' : '⛔ ' + fallos + ' MAL'))
process.exit(fallos === 0 ? 0 : 1)
