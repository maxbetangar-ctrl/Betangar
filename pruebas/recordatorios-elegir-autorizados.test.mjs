// ⛔ LA PRUEBA QUE FALTABA: elegir a DOS personas que no están en la nómina.
//
// Alejandra lo reportó dos veces —11/09 y 14/09/2026, Tony Gas—: «Sandra está
// creando un recordatorio, seleccionó a Miguel Rey y al seleccionar a Tibisay y
// Maribel Rey no las tomó, pero a otras personas sí».
//
// LA CAUSA. Los tres son de la junta, o sea que NO están en la nómina: entran al
// directorio desde `rec_destinos_extra` con `persona_id: null`. La pantalla
// descartaba al repetido comparando `x.persona_id === p.persona_id`, y con dos
// nulos eso da `true`: el segundo se tiraba SIN avisar. Y «a otras personas sí»
// porque las de nómina traen su persona_id.
//
// Medido en la base de Tony Gas el 15/09/2026: los tres Rey están cargados,
// activos y con TELÉFONOS DISTINTOS (+34 dos de ellos, +1 el otro). No faltaba
// ningún dato; sobraba una comparación.
//
// Esta prueba saca `claveDest` del maxrecuerda.js REAL y rehace el bucle de
// elegir. Verificada al revés: con la comparación vieja se pone roja.
//
//   node pruebas/recordatorios-elegir-autorizados.test.mjs
import { readFileSync } from 'fs'

const src = readFileSync(new URL('../maxrecuerda.js', import.meta.url), 'utf8')
const ini = src.indexOf('function claveDest(p) {')
if (ini < 0) { console.log('🔴 no está `claveDest` en maxrecuerda.js'); process.exit(1) }
const cuerpo = src.slice(ini, src.indexOf('\n          }', ini) + 12)
const claveDest = new Function(`${cuerpo}; return claveDest`)()

// El directorio tal cual lo arma la pantalla: nómina con ficha, junta sin ficha.
const DIRECTORIO = [
  { persona_id: 'E13006350', nombre: 'SANDRA VERDI',     telefono: '584220273171' },
  { persona_id: null, nombre: 'Miguel Á. Rey N.',  telefono: '17543084552', extra: true },
  { persona_id: null, nombre: 'Tibisay Rey N.',    telefono: '34638104430', extra: true },
  { persona_id: null, nombre: 'Maribel Rey N.',    telefono: '34648776122', extra: true },
]

// El bucle de `data-elegir`, con la comparación que hoy tiene la pantalla.
function elegir(indices) {
  const sel = []
  for (const i of indices) {
    const p = DIRECTORIO[i]
    if (p && !sel.some((x) => claveDest(x) === claveDest(p))) sel.push(p)
  }
  return sel
}

let fallas = 0
const revisar = (que, real, esperado) => {
  const ok = JSON.stringify(real) === JSON.stringify(esperado)
  console.log(`${ok ? '✅' : '🔴'} ${que}${ok ? '' : `\n     esperado ${JSON.stringify(esperado)}\n     dio      ${JSON.stringify(real)}`}`)
  if (!ok) fallas++
}

revisar('los 3 directivos sin ficha entran los 3',
  elegir([1, 2, 3]).map((p) => p.nombre),
  ['Miguel Á. Rey N.', 'Tibisay Rey N.', 'Maribel Rey N.'])

revisar('mezclados con alguien de nómina, entran los 4',
  elegir([0, 1, 2, 3]).length, 4)

revisar('el MISMO sin ficha elegido dos veces sigue entrando una sola',
  elegir([2, 2, 2]).length, 1)

revisar('el mismo DE NÓMINA elegido dos veces sigue entrando una sola',
  elegir([0, 0]).length, 1)

// ⛔ El caso que el teléfono NO puede resolver: dos sin ficha que comparten
//    número son la misma línea de WhatsApp, y mandarle dos veces es mandarle dos.
revisar('dos sin ficha con el MISMO teléfono cuentan como uno',
  (() => { const sel = []
    for (const p of [{ persona_id: null, nombre: 'A', telefono: '584141112233' },
                     { persona_id: null, nombre: 'B', telefono: '04141112233' }])
      if (!sel.some((x) => claveDest(x) === claveDest(p))) sel.push(p)
    return sel.length })(), 1)

console.log(fallas ? `\n🔴 ${fallas} falla(s)` : '\n✅ todo bien')
process.exit(fallas ? 1 : 0)
