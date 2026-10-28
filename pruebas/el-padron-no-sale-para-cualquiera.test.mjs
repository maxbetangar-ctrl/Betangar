// ══════════════════════════════════════════════════════════════════════════════
// ⛔ EL PADRÓN DE PERSONAL NO SE BAJA DESDE LA BARRA SUPERIOR
//
// Alejandra, 12/10/2026 (SOP-20261012-XXIG). El botón ⬇ de la barra superior —que está en
// TODAS las pantallas, al lado del de imprimir— llamaba a `exportExcelCompleto()` sin mirar
// ningún rol, y la hoja «Empleados» llevaba **nombre, cédula, banco y número de cuenta** de
// las 88 personas de la nómina (69 cuentas bancarias reales).
//
// Quiénes podían bajarlo y no debían:
//   · `visualizador` y `directivo` NO tienen 'empleados' ni 'nomina' en el menú, pero sí
//     'entregas', así que entraban y se bajaban el padrón. Hay 3 visualizadores activos.
//   · Los TRES roles `demo_*` SÍ tienen 'empleados'. O sea que **el candado de permiso solo
//     no los tapa**: si el demo se muestra afuera, el demo se lleva las cuentas reales.
//     Por eso hacen falta las DOS condiciones, no una.
//
// Quedó abierto 16 días: el 28/10 el código estaba idéntico al del diagnóstico.
//
// 📌 Lo que esta prueba NO decide: si además conviene sacarle cédula/banco/cuenta al export
//    para TODO el mundo. Eso lo decide Máximo. Esto es el piso: lo que no podía seguir así.
//
// Verificada al revés: contra el app.js anterior se ponen ROJOS los casos 1, 2, 3 y 5.
//   node pruebas/el-padron-no-sale-para-cualquiera.test.mjs [app.js]
// ══════════════════════════════════════════════════════════════════════════════
import { readFileSync } from 'node:fs'

const src = readFileSync(process.argv[2] || new URL('../app.js', import.meta.url), 'utf8')

let fallos = 0
const ok = (n, cond, detalle) => {
  console.log((cond ? '✅' : '❌') + ' ' + n + (cond ? '' : '  → ' + detalle))
  if (!cond) fallos++
}

const i = src.indexOf('async function exportExcelCompleto()')
if (i < 0) { console.error('FALLA: no existe exportExcelCompleto en app.js'); process.exit(1) }
const cuerpo = src.slice(i, i + 2600)
// Un comentario que cuenta la historia no es código ejecutable.
const ejec = cuerpo.split(/\r?\n/).map(l => (/^\s*\/\//.test(l) ? '' : l)).join('\n')

// ── 1. ⛔ SIN EL PERMISO DEL MÓDULO, LA HOJA NO VA ──────────────────────────
ok('1. la hoja Empleados exige el permiso del módulo',
   /_veEmpleados=_perms\.indexOf\('empleados'\)>=0\|\|_perms\.indexOf\('nomina'\)>=0/.test(ejec) &&
   /if\(EMPLEADOS\.length&&_veEmpleados\)/.test(ejec),
   'la hoja vuelve a salir sin mirar rol: visualizador y directivo se bajan 69 cuentas bancarias')

// ── 2. ⛔ Y EN DEMO NO SALEN LOS DATOS BANCARIOS ────────────────────────────
// Los tres demo_* tienen 'empleados', así que el permiso solo no alcanza.
ok('2. en demo la hoja va SIN cédula, banco ni cuenta',
   /_demo=\(typeof DEMO_MODE!=='undefined'&&DEMO_MODE\)/.test(ejec) &&
   /if\(!_demo\)\{ o\.Cedula=e\.cedula; o\.Banco=e\.banco; o\.Cuenta=e\.ncuenta; \}/.test(ejec),
   'un demo mostrado afuera se lleva las cuentas bancarias reales del personal')

// ── 3. Las columnas sensibles ya no son incondicionales ─────────────────────
ok('3. no quedó ninguna hoja que escriba Cedula/Banco/Cuenta sin condición',
   !/Cedula:e\.cedula,Banco:e\.banco,Cuenta:e\.ncuenta/.test(ejec),
   'volvió el mapeo directo de las tres columnas sensibles')

// ── 4. Lo que NO se rompió: las otras hojas siguen saliendo ─────────────────
// Planillas, Abonos y GastosVariables son datos del negocio: el export sigue sirviendo.
ok('4. las demás hojas siguen exportándose igual',
   /_xlAgregar\(wb,\(ABONOS\),'Abonos'\)/.test(ejec) &&
   /_xlAgregar\(wb,\(GASTOS_VARIABLES\),'GastosVariables'\)/.test(ejec) &&
   /'Planillas'/.test(ejec),
   'se rompió el export para todos en vez de cerrarle la puerta al padrón')

// ── 5. La auditoría dice QUÉ se llevó ──────────────────────────────────────
// Antes anotaba 'Excel completo exportado' a secas: no había forma de saber, después, si en
// esa descarga salieron o no las cuentas bancarias.
ok('5. la auditoría registra si salió el padrón y con qué rol',
   !/audit\('Excel completo exportado',''\)/.test(ejec) &&
   /audit\('Excel completo exportado',\(_hojaEmp\|\|/.test(ejec),
   'la auditoría no distingue una descarga con cuentas bancarias de una sin ellas')

// ── 6. El botón sigue siendo uno solo y en la barra ────────────────────────
// Si alguien agrega otra llamada, este candado deja de ser el único camino.
const llamadas = (src.match(/exportExcelCompleto\(\)/g) || []).length
ok('6. `exportExcelCompleto` se invoca desde un solo lugar del JS',
   llamadas <= 1,
   llamadas + ' llamadas en app.js: hay más de un camino al export y este candado no los cubre')

console.log(fallos ? '\n' + fallos + ' fallo(s)' : '\nTodo en verde (6)')
process.exit(fallos ? 1 : 0)
