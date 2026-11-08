// ⛔ R16 — LA FACTURA DE LA ESTACIÓN CONTRA LO ASIGNADO A LAS UNIDADES
//
// 🔴 POR QUÉ ES DISTINTA A TODAS LAS DEMÁS REGLAS. Cada regla de este módulo verifica el
//    combustible contra el TANQUE: la varilla, la cubicación, la tolerancia. Si la varilla se lee
//    mal, TODO el módulo se equivoca a la vez — no hay forma de notarlo desde adentro.
//    R16 mira la PLATA contra la OPERACIÓN: la estación facturó N litros, ¿están los N repartidos
//    entre unidades? No toca una sola lectura. **Es el único testigo que no depende de la regla.**
//
// 📌 MEDIDO ANTES DE ESCRIBIRLA, sobre los 27 períodos reales: detecta **16.816 L facturados y no
//    asignados** en 8 períodos hasta el 29/08, y **CERO** en los 16 siguientes. El defecto existió,
//    se corrigió, y esta regla lo habría visto el mismo día en vez de cuatro meses después.
//
// ⚠️ NO ACUSA A NADIE: un litro facturado y no asignado es un agujero de REGISTRO.
//
//   node pruebas/factura-contra-surtidas.test.mjs [app.js]
import { readFileSync } from 'fs'
import { cargarAuditoria, sembrar, auditar } from './_banco-combustible.mjs'

const rutaApp = process.argv[2] || new URL('../app.js', import.meta.url)
const js = readFileSync(rutaApp, 'utf8')
const datos = JSON.parse(readFileSync(new URL('./datos/combustible.json', import.meta.url), 'utf8'))
const ctx = cargarAuditoria(rutaApp)
sembrar(ctx, datos)

let fallos = 0
const ok = (n, c, d) => { console.log((c ? '✅' : '❌') + ' ' + n + (c ? '' : '  → ' + d)); if (!c) fallos++ }

// ── ⛔ CONTROL POSITIVO ANTES QUE NADA ───────────────────────────────────────────────────────
// Un volcado SIN períodos haría que R16 no dispare nunca, y eso se lee igual que «todo cuadra».
// Si esta asercion se pone roja, el resto de la prueba no significa nada.
ok('0. CONTROL POSITIVO: el volcado trae períodos de facturación',
   Array.isArray(ctx.AC_PERIODOS) && ctx.AC_PERIODOS.length > 0,
   'sin períodos R16 no puede hablar — corré `node pruebas/datos/bajar.mjs`')
if (!ctx.AC_PERIODOS || !ctx.AC_PERIODOS.length) { console.log('\n⛔ sin períodos no se prueba nada.'); process.exit(1) }

// ── 1. Sobre los datos REALES del período del volcado ────────────────────────────────────────
const DESDE = '2026-07-24', HASTA = '2026-09-07'
const anom = auditar(ctx, DESDE, HASTA)
const r16 = anom.filter((a) => (a.cod || a.regla) === 'R16')
ok('1. R16 encuentra los períodos que no cuadran en el volcado', r16.length > 0,
   'no encontró ninguno: el defecto de 16.816 L quedaría invisible')
// ⛔ Y NO PUEDE DISPARAR EN TODOS. Esta asercion existe por dos defectos reales del mismo dia:
//    · el bloque quedo DENTRO del forEach de jornadas y disparo 37.827 veces (1.400 x 27);
//    · y despues, con `estacion_nombre` ausente del volcado, reporto los 27 periodos en vez de 8.
//    Las dos veces la prueba vieja pasaba porque solo pedia «mas de cero». Un «mas de cero» no
//    distingue una regla que funciona de una que grita. [[norma-una-asercion-mal-escrita-acusa-al-producto]]
const enRango = (ctx.AC_PERIODOS || []).filter((p) => String(p.hasta).slice(0, 10) >= DESDE && String(p.desde).slice(0, 10) <= HASTA)
ok('1b. …y NO dispara en los que sí cuadran', r16.length < enRango.length,
   'dispara en ' + r16.length + ' de ' + enRango.length + ' períodos del rango: está gritando, no midiendo')
ok('1c. un aviso por período, no uno por jornada', r16.length <= enRango.length,
   r16.length + ' avisos para ' + enRango.length + ' períodos: la regla está adentro de un bucle que no le toca')
ok('2. y lo dice en litros, no en vaguedades', r16.every((a) => /\d+ L/.test(String(a.msg || a.texto || a.detalle || ''))),
   'algún aviso no nombra la cantidad')
ok('3. deja claro que NO viene de la regla del tanque',
   r16.every((a) => /NO usa la regla del tanque/.test(String(a.msg || a.texto || a.detalle || ''))),
   'sin esa frase se lee como un error de medición más')

// ── 2. ⛔ NO SE OPINA DE PERÍODOS FUERA DEL RANGO AUDITADO ───────────────────────────────────
// Si la pantalla mira octubre, un descuadre de julio no es de este informe.
const anomCorto = auditar(ctx, '2026-09-01', '2026-09-07')
const fuera = anomCorto.filter((a) => (a.cod || a.regla) === 'R16')
  .filter((a) => String(a.fecha || '') < '2026-09-01')
ok('4. no reporta períodos anteriores al rango pedido', fuera.length === 0,
   fuera.length + ' avisos de fechas fuera del rango')

// ── 3. El código ─────────────────────────────────────────────────────────────────────────────
const plano = js.replace(/\s+/g, ' ')
// ⛔ ESTA ASERCION FIJABA LA EXPRESION LITERAL `r[r.length-1]`, que es un DETALLE de como se
//    indexa el arreglo de consultas, no la regla. El 08/11/2026 se cambio a un indice guardado
//    (`_iPeriodos`) justo para poder agregar una consulta al final sin romper nada — y la
//    asercion se puso roja sobre codigo correcto, acusando al producto de un cambio que lo
//    mejoraba. Ahora mide las DOS cosas que de verdad importan, sin atarse a la forma:
//      a) que la consulta de periodos este en el cargador de la auditoria, y
//      b) que su resultado termine en `AC_PERIODOS`, que es lo que R16 lee.
//    [[norma-una-asercion-mal-escrita-acusa-al-producto]]
ok('5a. el motor CONSULTA los períodos de facturación',
   /from\('combustible_periodos'\)/.test(plano),
   'la regla existiría pero sin datos que mirar')
ok('5b. …y el resultado termina en `AC_PERIODOS`, que es lo que lee R16',
   /AC_PERIODOS=\(r\[[^\]]+\]/.test(plano),
   'se consulta pero no se guarda: R16 miraria un arreglo vacio y diria que todo cuadra')
ok('6. el nombre de estación se compara sin distinguir mayúsculas',
   /toLowerCase\(\)!==est\.toLowerCase\(\)/.test(plano),
   'en `surtidas` lo escribe el chofer y en los períodos la oficina: se separarían por una mayúscula')
ok('7. hay un margen chico por redondeo de factura, no la tolerancia del tanque',
   /if\(Math\.abs\(dif\)<=2\)return;/.test(plano),
   'o no hay margen, o se está usando la tolerancia de la varilla, que acá no corresponde')
ok('8. un período sin litros facturados NO se inventa un cuadre',
   /var lf=_acNum\(p\.litros_facturados\); if\(lf==null\|\|lf<=0\)return;/.test(plano),
   'un período vacío daría «faltan todos los litros»')

console.log('\n' + (fallos === 0 ? '✅ TODAS PASAN' : '⛔ ' + fallos + ' MAL'))
process.exit(fallos === 0 ? 0 : 1)
