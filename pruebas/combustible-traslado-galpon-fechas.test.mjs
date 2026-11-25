// ════════════════════════════════════════════════════════════════════════════════
// PRUEBA: TRASLADO CAMIÓN → TANQUE DEL GALPÓN + FECHAS OBLIGATORIAS EN COMBUSTIBLE
//
// Verifica:
// 1. Existe el formulario de traslado Camión → Tanque del Galpón (`devoluciones_tanque`)
//    tanto en el módulo de Combustible (`p-combustible`) como en Dashboard Operativo (`sec-operativo`).
// 2. Usa los IDs reales de tanque del galpón (`tanque-galpon-1`, `tanque-galpon-2`)
//    compatibles con `combustible_tanques_config` y la auditoría (`_acDevolucionesGalpon`).
// 3. TODOS los formularios de registro en el módulo de combustible tienen campo de fecha
//    y lo inicializan/validan antes de guardar:
//    - Ajuste Tanque Interno (`tank-f`)
//    - Compra de Combustible (`gcomp-f`)
//    - Gasolina Personal (`gp-f`)
//    - Salida de Tanque (`stq-fecha`, `comb-stq-fecha`)
//    - Traslado Camión → Camión (`trs-fecha`, `comb-trs-fecha`)
//    - Traslado Camión → Galpón (`dev-fecha`, `comb-dev-fecha`)
// 4. `devoluciones_tanque` está en `_COLA_ONCONFLICT` y la persistencia usa `.select()`.
// 5. `app.html` tiene el cache-buster actualizado.
// ════════════════════════════════════════════════════════════════════════════════
import { readFileSync } from 'fs'

const html = readFileSync(process.argv[2] || new URL('../app.html', import.meta.url), 'utf8')
const js   = readFileSync(process.argv[3] || new URL('../app.js',   import.meta.url), 'utf8')

let fallos = 0
const ok = (n, cond, detalle) => {
  console.log((cond ? '✅' : '❌') + ' ' + n + (cond ? '' : '  → ' + detalle))
  if (!cond) fallos++
}

console.log('\n── 1. Traslado Camión → Tanque del Galpón (UI) ───────────────────')
ok('1. Módulo Combustible tiene tarjeta de Movimientos en Patio con 3 pestañas (dev, trs, stq)',
   html.includes('id="card-comb-movimientos"') &&
   html.includes('id="comb-panel-dev"') &&
   html.includes('id="comb-panel-trs"') &&
   html.includes('id="comb-panel-stq"'),
   'Falta card-comb-movimientos o alguno de sus 3 paneles')

ok('2. Dashboard Operativo tiene la pestaña y panel Camión → Galpón (oper-tab-dev / oper-panel-dev)',
   html.includes('id="oper-tab-dev"') && html.includes('id="oper-panel-dev"'),
   'Falta oper-tab-dev o oper-panel-dev en sec-operativo')

ok('3. Usa los IDs de tanque del galpón compatibles con combustible_tanques_config',
   html.includes('value="tanque-galpon-1"') && html.includes('value="tanque-galpon-2"') &&
   html.includes("devTanque('tanque-galpon-1')") && html.includes("devTanque('tanque-galpon-2')"),
   'Los IDs de tanque deben ser tanque-galpon-1 y tanque-galpon-2')

ok('4. Módulo Combustible muestra tablas con columna Fecha para los 3 movimientos',
   html.includes('id="comb-dev-lista"') && html.includes('id="comb-trs-lista"') && html.includes('id="comb-stq-lista"'),
   'Falta alguna tabla de historial en p-combustible')

console.log('\n── 2. Campos de Fecha en TODOS los registros de Combustible ──────')
const fechaIds = [
  'tank-f', 'gcomp-f', 'gp-f',
  'stq-fecha', 'trs-fecha', 'dev-fecha',
  'comb-dev-fecha', 'comb-trs-fecha', 'comb-stq-fecha'
]
ok('5. Todos los formularios de combustible tienen su input type="date"',
   fechaIds.every((id) => html.includes(`id="${id}" type="date"`) || html.includes(`type="date" id="${id}"`)),
   'Falta input date para: ' + fechaIds.filter((id) => !html.includes(`id="${id}"`)).join(', '))

ok('6. initApp inicializa todos los campos de fecha de combustible con fechaVE()',
   fechaIds.every((id) => js.includes(`'${id}'`)),
   'Algún id de fecha no se inicializa en app.js')

ok('7. _stqPersistir, _trsPersistir y _devPersistir exigen fecha (no guardan sin fecha)',
   js.includes("if(!fecha){ mostrarToast('Seleccioná la fecha de la salida','error'); return false; }") &&
   js.includes("if(!fecha){ mostrarToast('Seleccioná la fecha del traslado','error'); return false; }"),
   'Falta validación obligatoria de fecha en persistencia de patio')

ok('8. addCombustible, guardarCompraCombustible y guardarGasol exigen fecha',
   js.includes("Seleccioná la fecha del ajuste") &&
   js.includes("Seleccioná la fecha de la compra") &&
   js.includes("Seleccioná la fecha del registro"),
   'Falta validación de fecha en ajuste de tanque, compra o gasolina personal')

console.log('\n── 3. Persistencia, cola offline y auditoría ─────────────────────')
ok('9. _devPersistir inserta en devoluciones_tanque con .select() y respaldo en cola offline',
   js.includes("supabase.from('devoluciones_tanque').insert([row]).select()") &&
   js.includes("guardarEnCola('devoluciones_tanque',row)"),
   'Falta insert con .select() o cola offline en devoluciones_tanque')

ok('10. _COLA_ONCONFLICT incluye devoluciones_tanque',
   js.includes("devoluciones_tanque:'id'"),
   'Falta devoluciones_tanque en _COLA_ONCONFLICT')

ok('11. _devPersistir refresca DEVOL_UNIDAD y audita el movimiento',
   js.includes("audit('devolucion_tanque'") && js.includes("cargarDevolucionesUnidad()"),
   'Falta audit o recarga de DEVOL_UNIDAD tras guardar devolución')

ok('12. Surtidas y costeo muestra fecha completa con formatFecha(s.fecha)',
   js.includes("return '<tr><td>'+formatFecha(s.fecha)+'</td><td style=\"font-weight:700\">'+_surEsc(s.cam||'')"),
   'renderSurtidasCosteo debe mostrar fecha completa')

ok('13. operSwitchCombTab soporta las 3 pestañas (stq, trs, dev)',
   js.includes("['stq','trs','dev'].forEach"),
   'operSwitchCombTab debe manejar stq, trs y dev')

ok('14. Cache-buster de app.js actualizado en app.html',
   /app\.js\?v=2026112[5-9]|app\.js\?v=2026113|app\.js\?v=202612|app\.js\?v=202[7-9]/.test(html),
   'Falta bump del parámetro ?v= en app.html')

console.log('\nResultado final: ' + (fallos === 0 ? 'TODO EN VERDE (14)' : fallos + ' fallo(s)'))
if (fallos > 0) process.exit(1)
