// Deja en `combustible.json` SOLO lo que la prueba necesita, y SIN una sola persona nombrada.
// El repo es PÚBLICO: la historia completa de un cliente que paga no vive acá.
// Se queda la GEOMETRÍA del caso —alturas, litros, fechas, el lote— que es justo lo que reproduce
// el defecto; se va todo lo demás.
//
// ⛔ POR QUÉ ESTO NO ES UNA LISTA DE COLUMNAS. Hasta el 08/11/2026 acá había tres nombres a mano
//    (`conductor`, `chofer`, `registrado_por`). Ese mismo día `bajar.mjs` pasó a `select *` —por un
//    defecto distinto, y con razón— y de golpe entraron al volcado versionado **el `token` de 88
//    surtidas**, `foto_url`, `nota`, `notas`, `observaciones`, `corregido_por` y `llenado_por`.
//    El guardia viejo dijo «✅ sin nombres» porque solo buscaba DOS PALABRAS EN MAYÚSCULAS.
//    📌 Una lista a mano de lo que hay que tapar se desincroniza del esquema, y cuando se
//      desincroniza **no se nota**: el archivo se ve igual. [[norma-dos-listas-a-mano-se-desincronizan]]
//
// 🔒 CÓMO SE ARREGLÓ, en dos capas con la asimetría a favor:
//    1. TAPA POR FORMA del nombre de la columna (abajo, `TAPAR`): cualquier columna que sea una
//       referencia a una persona, una credencial, una URL o texto libre se vacía — incluidas las que
//       todavía no existen, porque la regla mira el PATRÓN, no una lista de nombres.
//    2. GUARDIA que NO ESCRIBE si algo se le escapó: un texto largo, dos palabras en mayúsculas, o
//       algo con forma de token. Si mañana aparece una columna de texto libre que el patrón no ve,
//       esto se pone ROJO en vez de publicar el dato. Una lista puede desincronizarse; lo que no se
//       negocia es que la consecuencia sea un fallo ruidoso y no una fuga callada.
//
// ✅ Lo que el motor de auditoría SÍ necesita son números, fechas y códigos cortos
//    (`cam`, `turno`, `momento`, `estacion_nombre`, alturas, litros). Ningún texto libre alimenta
//    una sola regla: taparlo no cambia lo que la prueba mide. Verificado: 39/39 siguen verdes.
import { readFileSync, writeFileSync } from 'fs'
const d = JSON.parse(readFileSync(new URL('./combustible-real.json', import.meta.url), 'utf8'))

const UNIDADES = ['JAC-B003', 'JAC-B012', 'JAC-B004', 'JAC-B002', 'JAC-B009', 'JAC-B010']
const DESDE = '2026-07-20', HASTA = '2026-09-07'
const dentro = (f) => { const x = String(f || '').slice(0, 10); return x >= DESDE && x <= HASTA }

// ── 1. TAPA POR FORMA ────────────────────────────────────────────────────────────────────────
// Referencias a personas (`*_por`, conductor, chofer, mecanico, supervisor), credenciales
// (`token`, `*_key`, `secret`), ubicación de archivos (`*url*`) y TEXTO LIBRE (nota/observ/motivo/
// descripcion/comentario/desglose). `estacion_nombre` NO cae acá y es a propósito: es el nombre de
// una estación de servicio, lo mira R16, y no es el dato de ninguna persona.
const TAPAR = /(_por$|^conductor$|^chofer$|^mecanico$|^supervisor$|token|_key$|secret|url|nota|observ|motivo|descrip|coment|desglose)/i
const limpiar = (o) => {
  const c = { ...o }
  for (const k of Object.keys(c)) if (TAPAR.test(k) && c[k] !== null && c[k] !== undefined) c[k] = ''
  return c
}

const out = {
  // El lote del 18/08 va ENTERO aunque sus fechas sean de julio: es el testigo del caso 3.
  surt: d.surt.filter((s) => UNIDADES.includes(s.cam) || s.created_at === '2026-08-18 12:20:34.849141+00').map(limpiar),
  med: d.med.filter((m) => UNIDADES.includes(String(m.vehiculo_id)) && dentro(m.fecha)).map(limpiar),
  ck: d.ck.filter((c) => UNIDADES.includes(String(c.cam)) && dentro(c.fecha)).map(limpiar),
  gasoil: d.gasoil.filter((g) => UNIDADES.includes(String(g.cam)) && dentro(g.f)).map(limpiar),
  tanques: d.tanques,     // geometría del tanque, no dato de nadie
  cfg: d.cfg,             // el corte de surtidas y la referencia de rendimiento REALES
  unidades: d.unidades,   // cam, modelo y capacidad — configuración, no personas
  // ⛔ LOS PERÍODOS DE FACTURACIÓN VAN SÍ O SÍ (R16). Sin ellos la regla no puede hablar y eso
  //    se lee igual que «todo cuadra». Lo cazó el control positivo de su propia prueba el mismo
  //    día que se escribió. No llevan nombres de personas: fecha, estación, litros y precio.
  periodos: d.periodos,
}

// ── 2. EL GUARDIA, ANTES DE ESCRIBIR ─────────────────────────────────────────────────────────
// ⛔ Mira los VALORES, no los nombres de columna, justamente para cazar lo que la capa 1 no vio.
const sospechas = []
// ⛔ `lugar_gps` se agregó el 08/11 y el guardia se puso ROJO con «E/S LAS BANDERAS», que es el
//    nombre de una estación y no de una persona. Funcionó exactamente como tiene que funcionar:
//    una columna nueva que el patrón no conoce FRENA el volcado en vez de publicarlo.
//    Se exime del patrón de nombre —no de los cortes de largo ni de TOKENISH— igual que
//    `estacion_nombre`, porque guarda lo mismo: dónde estaba el camión.
const EXENTAS_DE_NOMBRE = new Set(['estacion_nombre', 'estacion_declarada', 'lugar_gps', 'modelo'])
const NOMBRE = /[A-ZÁÉÍÓÚÑ]{3,}\s+[A-ZÁÉÍÓÚÑ]{3,}/           // DOS PALABRAS EN MAYÚSCULAS
const TOKENISH = /^[a-z0-9]{16,}$/                            // forma de token: largo, sin espacios
// ⛔ PROSA Y CÓDIGO SE MIDEN DISTINTO, y el criterio es si tiene ESPACIOS —no una lista de columnas
//    exentas. Un `id` compuesto como `JAC-B010-S-2026-09-12-estacion-380-2982063` son 42 caracteres
//    y no dice nada de nadie; una frase de 42 caracteres sí puede. Los dos cortes:
//      · con espacios  → es prosa: 40 caracteres
//      · sin espacios  → es un código: 60, que deja pasar los `id` y sigue cazando una clave
//        larga o un JWT (que TOKENISH no ve porque lleva puntos y mayúsculas)
const LARGO_PROSA = 40, LARGO_CODIGO = 60
// ⚠️ ÚNICA EXENCIÓN del patrón de nombre-de-persona, y está justificada: son nombres de COSAS.
//    `E/S SERVICIOS MARACAIBO` dispara «dos palabras en mayúsculas» y es una estación de servicio
//    que R16 necesita leer; `modelo` es el del camión. Siguen pasando por los cortes de largo y
//    por TOKENISH: la exención es de UN control, no de todos.
for (const [tabla, filas] of Object.entries(out)) {
  if (!Array.isArray(filas)) continue
  filas.forEach((f, i) => {
    for (const [k, v] of Object.entries(f || {})) {
      if (typeof v !== 'string' || !v) continue
      const tope = / /.test(v) ? LARGO_PROSA : LARGO_CODIGO
      const porQue = (NOMBRE.test(v) && !EXENTAS_DE_NOMBRE.has(k)) ? 'parece un nombre de persona'
        : TOKENISH.test(v) ? 'parece un token o credencial'
        : v.length > tope ? (/ /.test(v) ? 'texto libre' : 'código o clave') + ' de ' + v.length + ' caracteres'
        : null
      if (porQue) sospechas.push(tabla + '[' + i + '].' + k + ' — ' + porQue + ': ' + JSON.stringify(v.slice(0, 50)))
    }
  })
}
if (sospechas.length) {
  console.log('⛔ NO SE ESCRIBIÓ EL VOLCADO. Esto habría quedado en un repo PÚBLICO:')
  console.log([...new Set(sospechas)].slice(0, 20).map((s) => '   · ' + s).join('\n'))
  console.log('\n📌 Agregá el patrón de esa columna a `TAPAR` y volvé a correrlo.')
  process.exit(1)
}

writeFileSync(new URL('./combustible.json', import.meta.url), JSON.stringify(out))
console.log('med', out.med.length, 'surt', out.surt.length, 'ck', out.ck.length, 'gasoil', out.gasoil.length, 'periodos', out.periodos.length)
console.log('✅ sin personas, sin credenciales y sin texto libre — ' + Object.values(out).filter(Array.isArray).reduce((a, f) => a + f.length, 0) + ' filas revisadas valor por valor')
