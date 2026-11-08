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
// ⛔ `_surEsExterna` ya NO decide sola: delega en `_acTanquePropio`, el criterio unico de "este
//    tanque es de la empresa" que reemplazo a cinco listas escritas a mano. Se extrae del MISMO
//    app.js, no se escribe una copia aca: una prueba con su propia version del criterio prueba la
//    copia. [[norma-probar-el-camino-no-la-pieza]]
const fT = saca('_acTanquePropio')
ok('0. CONTROL POSITIVO: las cuatro funciones existen', !!fE && !!fP && !!fC && !!fT,
   'falta alguna: ' + [['_surEsExterna', fE], ['_surPendiente', fP], ['_surCostoUsd', fC], ['_acTanquePropio', fT]].filter((x) => !x[1]).map((x) => x[0]).join(', '))
if (!fE || !fP || !fC || !fT) { console.log('\n⛔ sin las funciones no se prueba nada.'); process.exit(1) }
// El estado de partida: ni tanques en la tabla ni clave leida. Asi el criterio cae en el
// substring, que es la compatibilidad con el dato viejo, y los casos 1-4 miden eso.
const armar = (tanques, propios) => new Function(
  'var AC_TANQUES=' + JSON.stringify(tanques) + ', AC_META={tanquesPropios:' + JSON.stringify(propios) + '};\n' +
  fT + '\n' + fE + '\n' + fP + '\n' + fC + '\n' +
  ' return {_surEsExterna,_surPendiente,_surCostoUsd,_acTanquePropio};')()
const api = armar([], [])

// ── 1. Los tres estados ─────────────────────────────────────────────────────────────────────
ok('1. una de estación es EXTERNA', api._surEsExterna({ tanque: 'estacion' }) === true, 'dio otra cosa')
ok('2. una «sin ubicar» TAMBIÉN es externa', api._surEsExterna({ tanque: 'sin_confirmar' }) === true,
   'si no, se cuenta como litros del galpón por descarte — el error que esto arregla')
ok('3. ⛔ el galpón NO es externa', api._surEsExterna({ tanque: 'galpon_1' }) === false &&
   api._surEsExterna({ tanque: 'galpon_2' }) === false, 'el combustible propio no es una compra')
ok('4. una fila sin tanque no revienta ni se cuenta como galpón',
   api._surEsExterna({}) === true && api._surEsExterna(null) === false,
   'un tanque vacío no es el galpón: el galpón hay que declararlo')

// ── 1b. ⛔ EL TANQUE PROPIO QUE NO SE LLAMA «GALPÓN» ───────────────────────────────
// Antes del 08/11/2026 «es nuestro» se decidia buscando la palabra `galpon` en el id, o el
// `tipo='galpon'` en la tabla de tanques. Una empresa que declara sus tanques SOLO en la clave
// `tanques_internos` de la configuracion —y que los llama con el nombre de su sitio— tenia todas
// sus salidas contadas como combustible comprado en la bomba. Estos tres casos son el control
// positivo de que eso ya no pasa, y el negativo de que no se adivina.
{
  const conClave = armar([], ['mi_patio', 'cisterna_2'])
  ok('4b. CONTROL POSITIVO: un tanque declarado SOLO en la configuración es PROPIO',
     conClave._surEsExterna({ tanque: 'mi_patio' }) === false &&
     conClave._surEsExterna({ tanque: 'cisterna_2' }) === false,
     'sigue contándose como compra en la bomba: es el defecto que esto arregla')
  ok('4c. y el que NO está declarado en ningún lado sigue siendo externo',
     conClave._surEsExterna({ tanque: 'bomba_de_la_esquina' }) === true,
     'un id que nadie declaró no se vuelve propio porque el nombre suene conocido')
  const porTabla = armar([{ id: 'tq-patio', tipo: 'galpon', cap: 2300 }], [])
  ok('4d. y el declarado en la TABLA de tanques también, sin la palabra «galpón» en el id',
     porTabla._surEsExterna({ tanque: 'tq-patio' }) === false,
     'las dos formas de declararlo tienen que valer: por eso hay un solo criterio')
}

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
