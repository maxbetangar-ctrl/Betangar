// ⛔ EL VIAJE QUE NADIE HIZO — y que la base nunca podía desmentir.
//
// Melvin Barboza (JAC-B004) el 11/08/2026: «la aplicación me está arrojando dos viajes realizados
// el día de hoy, el del día de ayer no lo está sumando». Tenía razón, y el fantasma era de la app:
// en la base su día tenía UNA sola fila, numerada `2`. El `1` no existía.
//
// El número del viaje y el contador «hoy» NO salen de la base: salen del mapa `VIAJES_HOY` que vive
// en el teléfono. Y ese mapa solo crecía:
//   • `cargarViajesLocal()` no lo VACIABA cuando el día no tenía nada guardado → se quedaba con lo
//     que hubiera de antes (el viaje de AYER contaba como de HOY).
//   • `cargarViajesSupabase()` SUMABA lo del servidor pero nunca BORRABA lo que sobraba → una vez
//     dentro, el fantasma era eterno: el servidor no tenía forma de desmentirlo.
// Resultado: contador «hoy» = 2 (fantasma + real) y el viaje siguiente numerado de más.
// 19 días de 625 quedaron con la numeración corrida así (B007, B003, B010, B011, B004).
//
// ⚠️ La mitad delicada del arreglo es la que NO borra: un viaje hecho sin señal (`sincronizado:false`
// o esperando en la cola) es trabajo real del chofer. Perderlo sería mucho peor que el fantasma.
// Los casos 4, 5 y 9 son los que cuidan eso, y son los que importan.
//
// Extrae las funciones del chofer.html REAL (no una copia). Verificada al revés: contra el código
// anterior (git show f02cb0b:chofer.html) los casos 1, 2, 3 y 8 se ponen ROJOS.
//
//   node pruebas/viajes-fantasma.test.mjs [ruta-a-chofer.html]
import { readFileSync } from 'fs'

const ruta = process.argv[2] || new URL('../chofer.html', import.meta.url)
const src = readFileSync(ruta, 'utf8')

function extraer(nombre) {
  const ini = src.indexOf('function ' + nombre + '(')
  if (ini < 0) throw new Error('no encontré function ' + nombre)
  return src.slice(ini, src.indexOf('\n}', ini) + 2)
}
// `getSemanaISO` va porque `registrarViaje` todavía la llama (resto de cuando el viaje subía con
// semana/año; esas columnas ya no se mandan). Se extrae igual: la prueba corre el código REAL.
const cuerpo = ['getSemanaISO', 'cargarViajesLocal', 'guardarViajesLocal', 'cargarViajesSupabase', 'registrarViaje']
  .map(extraer).join('\n')

// Arma el teléfono: el mapa en memoria, lo guardado del día, la cola y lo que tiene el servidor.
function telefono({ enMemoria = {}, guardado = null, cola = [], servidor = [], cam = 'JAC-B004', hoy = '2026-08-11' }) {
  const store = new Map()
  if (guardado) store.set('btg_viajes_' + cam + '_' + hoy, JSON.stringify(guardado))

  const ctx = {
    cam, hoy,
    VIAJES_HOY: { ...enMemoria },
    COLA_LOCAL: cola.slice(),
    FLOTA_CHOFERES: { 'JAC-B004': 'MELVIN BARBOZA' },
    chofer: 'MELVIN BARBOZA',
    isOnline: false,                       // registrarViaje cae a la cola: no hay red en la caja
    localStorage: {
      getItem: (k) => (store.has(k) ? store.get(k) : null),
      setItem: (k, v) => store.set(k, v),
      removeItem: (k) => store.delete(k),
    },
    // El servidor contesta lo que le pasamos. La cadena imita al builder de supabase-js.
    supabase: {
      from: () => ({ select: () => ({ eq: () => ({ eq: () => ({ then: (cb) => cb({ data: servidor.slice(), error: null }) }) }) }) }),
    },
    // La pantalla no se dibuja acá: lo que se mide es el MAPA, que es de donde salen el número y el contador.
    renderBotones() {}, renderHistorial() {}, actualizarContador() {}, mostrarToast() {},
    agregarACola(r) { ctx.COLA_LOCAL.push(r) }, idbPut() {}, pedirBackgroundSync() {},
    actualizarBannerCola() {}, cargarSemanaSupabase() {}, navigator: {},
    Date,
  }
  const f = new Function('ctx', `with(ctx){ ${cuerpo};
    return { cargarViajesLocal, guardarViajesLocal, cargarViajesSupabase, registrarViaje } }`)
  return { fn: f(ctx), ctx, store }
}

const nums = (m) => Object.keys(m).map(Number).sort((a, b) => a - b)

let fallas = 0, corridas = 0
function ok(nombre, real, esperado) {
  corridas++
  const a = JSON.stringify(real), b = JSON.stringify(esperado)
  if (a === b) { console.log(`  ✅ ${nombre}`) }
  else { fallas++; console.log(`  ❌ ${nombre}\n       esperaba ${b}\n       dio      ${a}`) }
}

console.log('\n⛔ El viaje que nadie hizo — mapa local vs. base\n')

// 1) DÍA NUEVO: no hay nada guardado del día. El mapa tiene que arrancar VACÍO aunque venga sucio.
{
  const { fn, ctx } = telefono({ enMemoria: { 1: { hora: '02:27 p. m.', sincronizado: true } }, guardado: null })
  fn.cargarViajesLocal()
  ok('1. día sin dato guardado → el mapa arranca vacío (no hereda el viaje de ayer)', nums(ctx.VIAJES_HOY), [])
}

// 2) EL FANTASMA, tal cual estaba: el teléfono da por subido un viaje que el servidor no tiene.
{
  const { fn, ctx } = telefono({
    guardado: { 1: { hora: '02:27 p. m.', sincronizado: true }, 2: { hora: '03:25 p. m.', sincronizado: true } },
    servidor: [{ viaje_num: 2, hora: '03:25 p. m.' }],
  })
  fn.cargarViajesLocal(); fn.cargarViajesSupabase()
  ok('2. el que dice "subido" y el servidor no tiene → se borra', nums(ctx.VIAJES_HOY), [2])
}

// 3) El caso de Melvin ya con la fila renumerada en la base: le tiene que quedar UN viaje.
{
  const { fn, ctx } = telefono({
    guardado: { 1: { hora: '02:27 p. m.', sincronizado: true }, 2: { hora: '03:25 p. m.', sincronizado: true } },
    servidor: [{ viaje_num: 1, hora: '03:25 p. m.' }],
  })
  fn.cargarViajesLocal(); fn.cargarViajesSupabase()
  ok('3. Melvin, con la fila renumerada → HOY = 1 viaje', nums(ctx.VIAJES_HOY), [1])
}

// 4) ⛔ NO BORRAR TRABAJO REAL: un viaje sin señal, esperando en la cola.
{
  const { fn, ctx } = telefono({
    guardado: { 1: { hora: '08:00 a. m.', sincronizado: true }, 2: { hora: '11:00 a. m.', sincronizado: false } },
    servidor: [{ viaje_num: 1, hora: '08:00 a. m.' }],
    cola: [{ cam: 'JAC-B004', fecha: '2026-08-11', viaje_num: 2 }],
  })
  fn.cargarViajesLocal(); fn.cargarViajesSupabase()
  ok('4. viaje sin señal esperando en la cola → NO se toca', nums(ctx.VIAJES_HOY), [1, 2])
}

// 5) ⛔ NI EL QUE VA EN VUELO: registrado hace un segundo, todavía sin respuesta y todavía sin cola.
{
  const { fn, ctx } = telefono({
    guardado: { 1: { hora: '08:00 a. m.', sincronizado: true }, 2: { hora: '11:00 a. m.', sincronizado: false } },
    servidor: [{ viaje_num: 1, hora: '08:00 a. m.' }],
    cola: [],
  })
  fn.cargarViajesLocal(); fn.cargarViajesSupabase()
  ok('5. viaje recién tocado, sin respuesta aún → NO se borra', nums(ctx.VIAJES_HOY), [1, 2])
}

// 6) CAMINO FELIZ: todo coincide. Nada se toca. (Un arreglo que rompe el día normal no es un arreglo.)
{
  const { fn, ctx } = telefono({
    guardado: { 1: { hora: '08:00 a. m.', sincronizado: true }, 2: { hora: '02:00 p. m.', sincronizado: true } },
    servidor: [{ viaje_num: 1, hora: '08:00 a. m.' }, { viaje_num: 2, hora: '02:00 p. m.' }],
  })
  fn.cargarViajesLocal(); fn.cargarViajesSupabase()
  ok('6. día normal, todo coincide → quedan los 2', nums(ctx.VIAJES_HOY), [1, 2])
}

// 7) El servidor sabe MÁS que el teléfono (se reinstaló la app, otro equipo): se suma.
{
  const { fn, ctx } = telefono({
    guardado: null,
    servidor: [{ viaje_num: 1, hora: '08:00 a. m.' }, { viaje_num: 2, hora: '02:00 p. m.' }],
  })
  fn.cargarViajesLocal(); fn.cargarViajesSupabase()
  ok('7. teléfono vacío y servidor con 2 → los trae', nums(ctx.VIAJES_HOY), [1, 2])
}

// 8) EL NÚMERO SIGUIENTE. Es lo que le pasó a Melvin: su primer viaje del día salió como «2».
{
  const { fn, ctx } = telefono({
    guardado: { 1: { hora: '02:27 p. m.', sincronizado: true } },   // fantasma de ayer
    servidor: [],                                                    // hoy no hay nada en la base
  })
  fn.cargarViajesLocal(); fn.cargarViajesSupabase()
  fn.registrarViaje(1)
  ok('8. sin nada en la base, el primer viaje del día es el 1', nums(ctx.VIAJES_HOY), [1])
  ok('8b. y sube como viaje_num 1', ctx.COLA_LOCAL.map((r) => r.viaje_num), [1])
}

// 9) ⛔ EL DÍA SIN SEÑAL COMPLETO: tres viajes hechos offline, servidor vacío. No se pierde ninguno.
{
  const { fn, ctx } = telefono({
    guardado: {
      1: { hora: '08:00 a. m.', sincronizado: false },
      2: { hora: '11:00 a. m.', sincronizado: false },
      3: { hora: '03:00 p. m.', sincronizado: false },
    },
    servidor: [],
    cola: [1, 2, 3].map((n) => ({ cam: 'JAC-B004', fecha: '2026-08-11', viaje_num: n })),
  })
  fn.cargarViajesLocal(); fn.cargarViajesSupabase()
  ok('9. día entero sin señal → los 3 viajes siguen ahí', nums(ctx.VIAJES_HOY), [1, 2, 3])
}

console.log(`\n${fallas === 0 ? '✅' : '❌'} ${corridas - fallas}/${corridas} · ${ruta}\n`)
process.exit(fallas ? 1 : 0)
