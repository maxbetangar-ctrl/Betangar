// ════════════════════════════════════════════════════════════════════════════════
// PRUEBA: DASHBOARD OPERATIVO DEDICADO (Betangar ERP)
//
// Verifica que la vista operativa dedicada (sec-operativo):
// 1. Sea una pantalla ejecutiva completa (no limitada a 560px).
// 2. Tenga acceso en el menú lateral con rótulo 'Dashboard Operativo'.
// 3. Esté disponible para roles operativos y de coordinación (operativo, operador, admin, superadmin).
// 4. Contenga las 5 tarjetas KPI operativas esenciales (flota, taller, viajes, combustible, fallas).
// 5. Contenga el grid interactivo de monitoreo de unidades JAC-B001...B012 y servicios.
// 6. Contenga el cronograma y cobertura de rutas del IMAU con cálculo dinámico según el día.
// 7. Contenga las herramientas de combustible de patio (salida de tanque, traslados) y despachos del día.
// 8. Contenga el seguimiento de anomalías abiertas del checklist.
// 9. Cuente con botón e informe imprimible exclusivo de operaciones (imprimirDashboardOperativo).
// 10. Mantenga aislamiento financiero estricto (sin cobranzas, $317.88/viaje, BNC, bancos ni utilidades).
// ════════════════════════════════════════════════════════════════════════════════
import { readFileSync } from 'fs'

const html = readFileSync(process.argv[2] || new URL('../app.html', import.meta.url), 'utf8')
const js   = readFileSync(process.argv[3] || new URL('../app.js',   import.meta.url), 'utf8')

let fallos = 0
const ok = (n, cond, detalle) => {
  console.log((cond ? '✅' : '❌') + ' ' + n + (cond ? '' : '  → ' + detalle))
  if (!cond) fallos++
}

console.log('\n── 1. Menú lateral y navegación ──────────────────────────────────')
const mItem = html.match(/<div class="menu-item"[^>]*id="mi-operativo"[^>]*>([^<]+)<\/div>/)
ok('1. El menú lateral tiene el ítem "Dashboard Operativo"',
   !!mItem && mItem[1].includes('Dashboard Operativo'),
   'Texto encontrado: ' + (mItem ? mItem[1] : 'no encontrado'))

ok('2. NAV_LABELS tiene mapeado operativo a "Dashboard Operativo"',
   js.includes("operativo:'Dashboard Operativo'"),
   'Falta operativo en NAV_LABELS o tiene otro nombre')

ok('3. PERMISOS.operador incluye el permiso "operativo"',
   /operador:\s*\[[^\]]*'operativo'/.test(js),
   'El rol operador debe poder acceder al Dashboard Operativo')

console.log('\n── 2. Estructura y diseño de la sección sec-operativo ────────────')
const secOper = html.match(/<div class="section"[^>]*id="sec-operativo"[\s\S]*?<\/div>\s*<\/div>\s*<\/div>/)
ok('4. La sección sec-operativo existe y no está confinada a max-width:560px',
   html.includes('id="sec-operativo"') && !html.includes('id="sec-operativo" style="display:none;flex:1;overflow-y:auto;padding:14px 18px">\n  <div style="max-width:560px'),
   'sec-operativo debe tener layout responsive de dashboard')

ok('5. Contiene el indicador de turno en vivo (oper-turno-badge)',
   html.includes('id="oper-turno-badge"'),
   'Falta #oper-turno-badge en sec-operativo')

ok('6. Contiene enlace directo a Flota en Vivo (mapa.html / GPS)',
   html.includes("location.href='mapa.html'") && html.includes('Flota en Vivo (GPS)'),
   'Falta botón de acceso a Flota en Vivo')

ok('7. Contiene botón para imprimir reporte operativo',
   html.includes('imprimirDashboardOperativo()'),
   'Falta llamada a imprimirDashboardOperativo')

console.log('\n── 3. Tarjetas KPI operativas ────────────────────────────────────')
ok('8. Tarjeta KPI de Flota Operativa presente',
   html.includes('id="oper-kpi-operativos"'),
   'Falta #oper-kpi-operativos')

ok('9. Tarjeta KPI de Taller / Inoperativos presente',
   html.includes('id="oper-kpi-taller"'),
   'Falta #oper-kpi-taller')

ok('10. Tarjeta KPI de Viajes en Vivo presente',
   html.includes('id="oper-kpi-viajes"'),
   'Falta #oper-kpi-viajes')

ok('11. Tarjeta KPI de Combustible Hoy presente',
   html.includes('id="oper-kpi-combustible"'),
   'Falta #oper-kpi-combustible')

ok('12. Tarjeta KPI de Anomalías Abiertas presente',
   html.includes('id="oper-kpi-anomalias"'),
   'Falta #oper-kpi-anomalias')

console.log('\n── 4. Monitoreo de unidades y cronograma IMAU ────────────────────')
ok('13. Contenedor de unidades en tiempo real (oper-flota-grid) presente',
   html.includes('id="oper-flota-grid"'),
   'Falta #oper-flota-grid')

ok('14. Contenedor de rutas asignadas hoy (oper-parroquias) presente',
   html.includes('id="oper-parroquias"'),
   'Falta #oper-parroquias')

ok('15. Contenedor de estadísticas históricas (oper-stats) presente',
   html.includes('id="oper-stats"'),
   'Falta #oper-stats')

console.log('\n── 5. Combustible de patio y anomalías ───────────────────────────')
ok('16. Formulario de salida de tanque (stq) y traslado (trs) presentes',
   html.includes('id="oper-panel-stq"') && html.includes('id="oper-panel-trs"'),
   'Faltan paneles stq y trs')

ok('17. Lista de despachos de combustible hoy a unidades presente',
   html.includes('id="oper-surtidas-hoy"'),
   'Falta #oper-surtidas-hoy')

ok('18. Contenedor de anomalías del checklist presente',
   html.includes('id="oper-anomalias"'),
   'Falta #oper-anomalias')

console.log('\n── 6. Lógica en app.js y aislamiento financiero ─────────────────')
ok('19. Función operParroquiasHoy calcula las parroquias por día del IMAU',
   js.includes('function operParroquiasHoy(') && js.includes('OLEGARIO VILLALOBOS') && js.includes('VENANCIO PULGAR'),
   'Falta operParroquiasHoy con cronograma IMAU')

ok('20. Funciones operRenderKPIs, operRenderFlotaGrid, operRenderSurtidasHoy existen en app.js',
   js.includes('function operRenderKPIs(') && js.includes('function operRenderFlotaGrid(') && js.includes('function operRenderSurtidasHoy('),
   'Faltan funciones de renderizado operativo')

ok('21. Función modal de cambio de estado de unidad existe en app.js',
   js.includes('function operModalEstado(') && js.includes('function operGuardarEstadoModal('),
   'Faltan operModalEstado / operGuardarEstadoModal')

ok('22. Función imprimirDashboardOperativo implementada',
   js.includes('function imprimirDashboardOperativo(') && js.includes("abrirImpresionPremium('Reporte Diario de Operaciones'"),
   'Falta imprimirDashboardOperativo')

// Aislamiento financiero: sec-operativo NO debe contener palabras ni variables de cobranza ni tarifas en dólares
const secOperativoHtml = html.substring(html.indexOf('id="sec-operativo"'), html.indexOf('id="sec-histfallas"'))
const tieneFinanzas = /317\.88|totalCob|saldo-bnc|porcobrar|Utilidad Real/i.test(secOperativoHtml)
ok('23. Aislamiento financiero total: sec-operativo no expone datos de cobros, bancos ni utilidades',
   !tieneFinanzas,
   'sec-operativo no debe contener datos financieros confidenciales')

console.log('\nResultado final: ' + (fallos === 0 ? 'TODO EN VERDE (23)' : fallos + ' fallo(s)'))
if (fallos > 0) process.exit(1)
