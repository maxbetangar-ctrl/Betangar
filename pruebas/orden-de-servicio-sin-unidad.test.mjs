// ══════════════════════════════════════════════════════════════════════════════
// ⛔ UNA ORDEN DE SERVICIO QUE NO VA A UN VEHÍCULO
//
// Alejandra necesitaba emitir una orden de REPARACIÓN a unas llantas de repuesto. Las
// llantas no son un camión, pero el selector «Destino» (🏭 Patio / 📦 Inventario) sólo
// aparecía en las órdenes de COMPRA: en servicio el destino era SIEMPRE una unidad
// (`destino = esCompra ? gv('os-destino') : 'unidad'`). Para poder emitir la orden había
// que inventar una unidad, y eso ensucia toda la flota — una fila que no es un camión
// dividía cada promedio por 14 en vez de 13 (7,7% de error, borrada el 27/10/2026).
//
// Decisión de Máximo (28/10/2026): abrir el Destino «Patio» a las órdenes de servicio,
// reusando la cañería de PATIO que ya existía de punta a punta, en vez de volver a meter
// una pseudo-unidad en `unidad_config`.
//
// Lo que esta prueba cuida son los CUATRO sitios que se desincronizan si uno se olvida:
//   · emitir      — el destino se lee para los dos tipos de orden
//   · cerrar      — una orden sin unidad NO puede cerrar por la Hoja de Vida (pide unidad
//                   y km; `sv('hv-cam','PATIO')` no calza nada y la orden no cerraría nunca)
//   · contabilizar— el gasto del patio tenía `tipo_trabajo` FIJO en 'compra': una
//                   reparación se contaba como compra en «Por tipo de gasto»
//   · imprimir    — con cam='PATIO' el papel sacaba KM 0 y «Próx. Servicio 5.000» para
//                   unas llantas: un impreso afirmando un servicio que no existe
//
// Verificada al revés: contra el código anterior se ponen ROJOS los casos 1, 2, 4, 5, 6,
// 7, 8 y 9.
//   node pruebas/orden-de-servicio-sin-unidad.test.mjs [app.js] [app.html]
// ══════════════════════════════════════════════════════════════════════════════
import { readFileSync } from 'node:fs'

const js = readFileSync(process.argv[2] || new URL('../app.js', import.meta.url), 'utf8')
const html = readFileSync(process.argv[3] || new URL('../app.html', import.meta.url), 'utf8')

let fallos = 0
const ok = (n, cond, detalle) => {
  console.log((cond ? '✅' : '❌') + ' ' + n + (cond ? '' : '  → ' + detalle))
  if (!cond) fallos++
}

// Un comentario que cuenta la historia no es código: se recorta antes de medir.
const ejecutable = js.split(/\r?\n/).map(l => (/^\s*(\/\/|\*|\/\*)/.test(l) ? '' : l)).join('\n')
const trozo = (desde, largo) => {
  const i = ejecutable.indexOf(desde)
  return i < 0 ? '' : ejecutable.slice(i, i + largo)
}

console.log('── EMITIR: el destino vale para los dos tipos ───────────────────')

// ── 1. ⛔ EL DEFECTO. El destino ya no depende de que sea una compra ────────
const emitir = trozo('async function _osEmitirOrden()', 1200)
ok('1. al emitir, el destino se lee siempre (no sólo en compra)',
   /var destino=gv\('os-destino'\)\|\|'unidad';/.test(emitir) &&
   !/var destino=esCompra\?\(gv\('os-destino'\)\|\|'unidad'\):'unidad';/.test(emitir),
   'el destino vuelve a forzarse a «unidad» cuando no es compra: no se puede emitir al patio')

// ── 2. El selector de destino se MUESTRA en servicio ───────────────────────
const tipoOrden = trozo('function _osTipoOrden()', 2600)
ok('2. el selector Destino se muestra en los dos tipos',
   /patioWrap\.style\.display='block'/.test(tipoOrden) &&
   !/patioWrap\.style\.display=compra\?'block':'none'/.test(tipoOrden),
   'el selector volvió a esconderse en servicio: la opción existe pero nadie la ve')

// ── 3. INVENTARIO sigue siendo sólo de compra: una reparación no entra a existencia ──
ok('3. en servicio se esconde la opción Inventario',
   /invOpt\.hidden=!compra/.test(tipoOrden) &&
   /if\(!esCompra && destino==='inventario'\)destino='unidad'/.test(emitir),
   'se puede emitir una REPARACIÓN con destino Inventario, que no significa nada')

ok('4. el option de Inventario tiene id para poder esconderlo',
   /<option value="inventario" id="os-destino-inv">/.test(html),
   'sin id hay que buscarlo por posición, y una posición se desacomoda')

console.log('\n── CERRAR: por destino, no por tipo de orden ────────────────────')

// ── 5. ⛔ Una orden sin unidad no puede cerrar por la Hoja de Vida ─────────
const render = trozo('function renderOrdenesServicio()', 3000)
ok('5. el cierre se enruta por DESTINO, no por tipo de orden',
   /_sinUnidad=\(o\.cams\|\|\[\]\)\.length===1&&\(o\.cams\[0\]==='PATIO'\|\|o\.cams\[0\]==='INVENTARIO'\)/.test(render) &&
   /cerrar=\(esCompra\|\|_sinUnidad\)\?'_iniciarCierreCompra':'_iniciarCierreOrden'/.test(render),
   'una orden de servicio al patio cerraría por la Hoja de Vida, que pide unidad y km: no cerraría nunca')

console.log('\n── CONTABILIZAR: una reparación no es una compra ────────────────')

// ── 6. ⛔ El tipo de gasto se DERIVA de la orden ───────────────────────────
const linea = trozo('async function _ccAgregarLinea()', 6000)
ok('6. el gasto de patio deriva su tipo de trabajo de la orden',
   /_ttPatio=\(o\.tipoOrden==='compra'\)\?'compra'/.test(linea),
   'el tipo de gasto volvió a ser fijo: una reparación se cuenta como compra')

ok('7. y ya no queda ningún tipo_trabajo fijo en «compra» en el patio',
   !/cam:'PATIO'[^}]*tipo_trabajo:'compra'/.test(linea),
   'quedó una escritura a PATIO con tipo_trabajo fijo en compra')

console.log('\n── IMPRIMIR: sin unidad no hay km ni próximo servicio ───────────')

// ── 8. ⛔ El papel no puede afirmar un próximo servicio que no existe ──────
const imprimir = trozo('function _osImprimirOrden(o)', 4000)
ok('8. el impreso sin unidad no saca la tabla de km',
   /var filas=_sinUnidad\?'':/.test(imprimir) &&
   /_tabla=_sinUnidad/.test(imprimir),
   'el impreso vuelve a sacar KM 0 y «Próx. Servicio» para algo que no es un vehículo')

ok('9. y en su lugar imprime el DESTINO y dice que no lleva km',
   /no es sobre un veh/.test(imprimir) && /Destino/.test(imprimir),
   'el papel no dice por qué no hay kilometraje: el del taller no sabe qué le llegó')

// ── 10. El título del cierre deja de llamar «compra» a una reparación ─────
ok('10. la pantalla de cierre dice qué se está cerrando',
   /id="cc-titulo"/.test(html) && /Cerrar orden de servicio/.test(ejecutable),
   'cerrando una reparación la pantalla sigue diciendo «Cerrar orden de compra»')

// ── 11. PATIO no se cuela como unidad en ningún conteo de flota ───────────
// Es el motivo de todo esto: lo que no es un camión no puede entrar en unidad_config.
ok('11. PATIO sigue siendo una pseudo-unidad, no una fila de unidad_config',
   !/unidad_config[^\n]*PATIO/.test(ejecutable),
   'PATIO se escribió en unidad_config: volvería el sesgo de dividir entre 14 en vez de 13')

console.log(fallos ? '\n' + fallos + ' fallo(s)' : '\nTodo en verde (11)')
process.exit(fallos ? 1 : 0)
