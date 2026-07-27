// ⛔ LA PRUEBA QUE FALTABA: comprueba CÓMO SE VE, no solo qué devuelve la base.
//
// El 2026-07-27 una migración cargó `color_primario: '#0f1923'` —el color del
// FONDO— y `hidratarMarcaDesdeBD` lo aplicaba como color de RESALTE. Los botones
// de VIDECA quedaron casi invisibles EN VIVO. El SQL era correcto, el RPC devolvía
// lo que debía, y las 28 pruebas de la Torre pasaban: nadie miraba la pantalla.
//
// Esta prueba extrae la función del app.js REAL (no una copia) y la corre contra
// las marcas que de verdad hay en las bases. Verificada al revés: contra el código
// anterior se pone roja.
//
//   node pruebas/mapeo-marca.test.mjs
import { readFileSync } from 'fs'
const src = readFileSync(new URL('../app.js', import.meta.url), 'utf8')
const ini = src.indexOf('async function hidratarMarcaDesdeBD')
const cuerpo = src.slice(ini, src.indexOf('\n}', src.indexOf('MARCA_HIDRATADA=true', ini)) + 2)

function correr(marca, accentPrevio) {
  const BTG_CONFIG = { accent: accentPrevio || null }
  let MARCA_HIDRATADA = false
  const supabase = { rpc: async () => ({ data: marca }) }
  const document = { getElementById: () => null, querySelector: () => null,
                     createElement: () => ({}), head: { appendChild(){} },
                     documentElement: { style: { setProperty(){} } } }
  const ctx = { BTG_CONFIG, MARCA_HIDRATADA, supabase, document,
                LOGO_SVG: null, aplicarMarcaAccent(){}, console }
  const f = new Function('ctx', `with(ctx){ ${cuerpo}; return hidratarMarcaDesdeBD() }`)
  return f(ctx).then(() => BTG_CONFIG)
}

const PRUEBAS = [
  ['VIDECA como estaba (el caso que rompió)', { nombre:'VIDECA', color_primario:'#0f1923', color_acento:'#7dc941' }, '#7dc941'],
  ['solo primario cargado',                   { nombre:'X', color_primario:'#0f1923' },                              undefined],
  ['sin colores (como quedó hoy)',            { nombre:'VIDECA' },                                                   undefined],
]
let fallos = 0
for (const [caso, marca, esperado] of PRUEBAS) {
  const cfg = await correr(marca)
  const verde = cfg.accent?.green
  const ok = verde === esperado
  if (!ok) fallos++
  console.log(`  ${ok ? '✅' : '❌'} ${caso.padEnd(42)} acento = ${verde ?? '(ninguno, usa el suyo)'}`)
  if (verde === '#0f1923') console.log('      ⛔ ESTÁ PINTANDO EL FONDO COMO RESALTE')
}
// Y que no pise el acento propio de un clon
const cfg = await correr({ nombre:'X', color_acento:'#ff0000' }, { green:'#abcdef' })
console.log(`  ${cfg.accent.green === '#abcdef' ? '✅' : '❌'} no pisa el acento propio del clon${' '.repeat(11)} acento = ${cfg.accent.green}`)
process.exit(fallos ? 1 : 0)
