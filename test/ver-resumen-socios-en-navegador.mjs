// ══════════════════════════════════════════════════════════════════════════════════════════════
// MIRAR LA PANTALLA «RESUMEN A SOCIOS» EN UN NAVEGADOR DE VERDAD
//
// ⛔ POR QUÉ EXISTE. `npm test` pasa en verde y NO VE el color, el ancho de una columna, ni una
//    sección condicional que queda invisible porque nunca se le pasaron datos. El 28/10/2026 el
//    PDF de este mismo módulo tenía una etiqueta montada encima de un monto con todas las
//    consultas en verde. [[norma-una-pantalla-se-revisa-en-una-pantalla]]
//
// 📌 NO HACE FALTA UNA SESIÓN. Lo que se revisa es lo que la pantalla DIBUJA, así que se le
//    sirven respuestas armadas. Conseguir un login para esto fue lo que tuvo trancada la
//    verificación de Geppetto cinco sesiones. [[verificar-pantalla-en-navegador-sin-sesion]]
//
// ⛔ SE ENCHUFA EN EL CLIENTE, NO EN LA RED. Interceptar `**/rest/v1/**` no alcanza en esta app:
//    sin sesión `DB_READY` queda en `false` y `supabase` ni siquiera se construye —es `null`—,
//    así que no hay petición que interceptar. La costura correcta es el objeto cliente.
//    (Medido: con la interceptación de red la pantalla dibujaba 246 caracteres y dos errores.)
//
// ⛔ LO QUE ESTO NO PRUEBA: ni el RLS, ni los permisos, ni que la función de la base devuelva
//    estos números. Eso se mide aparte, contra la base real. Acá se mira el dibujo.
//    [[norma-probar-el-camino-no-la-pieza]]
//
// ⛔ CORRE LOS TRES ESTADOS, no solo el bonito: el ciclo con pago, la semana SIN pago (donde casi
//    todo queda vacío) y el período sin nada. Un bloque condicional sin datos no se ve mal: NO SE
//    VE. [[norma-una-seccion-condicional-sin-datos-parece-que-no-existe]]
//
//   python -m http.server 8777     (desde la raíz del repo)
//   node test/ver-resumen-socios-en-navegador.mjs
// ══════════════════════════════════════════════════════════════════════════════════════════════
import { chromium } from 'file:///C:/Users/Maxbetangar/AppData/Roaming/npm/node_modules/playwright/index.mjs'

const URL_APP = process.env.URL_APP || 'http://127.0.0.1:8777/app.html'

// Los números son los REALES del ciclo del 22 al 28/10/2026, copiados de `btg_resumen_socios()`.
// Inventar cifras redondas acá escondería justo lo que se quiere ver: cómo queda la columna de
// montos cuando los números son largos de verdad.
const CON_PAGO = {
  periodo: { desde: '2026-10-22', hasta: '2026-10-28', dias: 7 },
  entro: {
    alcaldia: [{ fecha: '2026-10-22', factura: '000651', pata: 'neto', bs: 34661022.88, usd: 39176.08 }],
    otros: [], alcaldia_bs: 34661022.88, alcaldia_usd: 39176.08, otros_bs: 0, otros_usd: 0, total_usd: 39176.08,
  },
  salio_gasto: {
    por_categoria: [
      { categoria: 'nomina', n: 65, bs: 7740138.25, usd: 8721.95 },
      { categoria: 'mantenimiento', n: 18, bs: 4338047.13, usd: 4889.03 },
      { categoria: 'combustible', n: 3, bs: 1869851.66, usd: 2109.9 },
      { categoria: 'otro', n: 6, bs: 1216026.67, usd: 1371.73 },
      { categoria: 'sin_clasificar', n: 5, bs: 752688.45, usd: 848.15 },
      { categoria: 'seguro', n: 1, bs: 322562.74, usd: 363.2 },
      { categoria: 'servicios', n: 2, bs: 117512.78, usd: 132.6 },
      { categoria: 'comision_banco', n: 45, bs: 64231.73, usd: 72.39 },
    ], total_bs: 16421059.41, total_usd: 18508.93,
  },
  salio_no_gasto: {
    camiones: [{ fecha: '2026-10-24', bs: 14000000, tasa: 1000, usd: 14000 }],
    divisas_sin_destino: [], camiones_usd: 14000, camiones_bs: 14000000, total_bs: 14000000, total_usd: 14000,
  },
  proveedores: [
    { nombre: 'AUTO UNION DC, C.A.', identificado: true, n: 18, bs: 4338047.13, usd: 4889.03, muestra: '' },
    { nombre: '(sin identificar)', identificado: false, n: 8, bs: 2867020.45, usd: 3233.14, muestra: 'TRANSFERENCIA A FAVOR DE: GRUPO 7F INTERNACIONAL C.A. PARA L' },
    { nombre: 'INCONSUMMCA, C.A. (ATLAS)', identificado: true, n: 2, bs: 377370.4, usd: 425.82, muestra: '' },
    { nombre: 'SOLUCIONES DE LOCALIZACION TRACKER C.A.', identificado: true, n: 1, bs: 284034.41, usd: 320.5, muestra: '' },
    { nombre: 'COMERCIALIZADORA PAZ JIMENEZ (E/S PALOTAL)', identificado: true, n: 1, bs: 78082.4, usd: 88.11, muestra: '' },
  ],
  avisos: {
    fiel_sin_entrar: [
      { factura: 'M1006', desde: '2026-08-31', dias: 58, en_plazo: false, neto_bs: 8665321.62, fiel_estimada_bs: 953280.71 },
      { factura: '000650', desde: '2026-10-15', dias: 13, en_plazo: false, neto_bs: 13674198.12, fiel_estimada_bs: 1504312.22 },
      { factura: '000651', desde: '2026-10-22', dias: 6, en_plazo: true, neto_bs: 34661022.88, fiel_estimada_bs: 3813093.83 },
    ],
    fiel_atrasadas: 2, fiel_atrasada_bs: 2457592.93,
    sin_clasificar: { n: 5, bs: 752688.45, usd: 848.15 }, movimientos_sin_tasa: 0,
  },
  saldo_usd: 6667.15,
}

// ⛔ LA SEMANA SIN PAGO. Es el estado que más se va a repetir —la Alcaldía no paga todas las
//    semanas— y el que deja casi todo vacío. Si esta pantalla queda muda acá, va a parecer rota.
const SIN_PAGO = {
  periodo: { desde: '2026-10-16', hasta: '2026-10-21', dias: 6 },
  entro: { alcaldia: [], otros: [], alcaldia_bs: 0, alcaldia_usd: 0, otros_bs: 0, otros_usd: 0, total_usd: 0 },
  salio_gasto: { por_categoria: [{ categoria: 'nomina', n: 58, bs: 6900000, usd: 7790.12 }], total_bs: 6900000, total_usd: 7790.12 },
  salio_no_gasto: { camiones: [], divisas_sin_destino: [], camiones_usd: 0, camiones_bs: 0, total_bs: 0, total_usd: 0 },
  proveedores: [],
  avisos: { fiel_sin_entrar: [], fiel_atrasadas: 0, fiel_atrasada_bs: 0, sin_clasificar: { n: 0, bs: 0, usd: 0 }, movimientos_sin_tasa: 0 },
  saldo_usd: -7790.12,
}

const CICLO = [{ desde: '2026-10-22', hasta: '2026-10-28', dias: 7, cobros: 1, arranque: 'primera' }]
// Dos registros de envío y, a propósito, el último VIEJO: así se ve el aviso rojo de «el último
// salió hace N días», que es la mitad de la respuesta a «¿cómo sé que me va a llegar?».
const CORRIDAS_AL_DIA = [{ desde: '2026-10-22', hasta: '2026-10-28', enviado_at: new Date().toISOString(), destinos: ['a', 'b', 'c', 'd'] }]
const CORRIDAS_VIEJAS = [{ desde: '2026-09-29', hasta: '2026-10-05', enviado_at: '2026-10-06T13:00:00Z', destinos: ['a', 'b', 'c', 'd'] }]

const CASOS = [
  { nombre: 'con-pago', resumen: CON_PAGO, corridas: CORRIDAS_AL_DIA },
  { nombre: 'sin-pago', resumen: SIN_PAGO, corridas: CORRIDAS_AL_DIA },
  { nombre: 'envio-atrasado', resumen: CON_PAGO, corridas: CORRIDAS_VIEJAS },
  { nombre: 'sin-envios', resumen: CON_PAGO, corridas: [] },
]

const navegador = await chromium.launch()
let fallas = 0

for (const caso of CASOS) {
  // Contexto NUEVO en cada caso: reusar el navegador que ya se usó es revisar otro producto.
  const ctx = await navegador.newContext({ viewport: { width: 1180, height: 1600 } })
  const p = await ctx.newPage()
  const errores = []
  p.on('console', (m) => { if (m.type() === 'error') errores.push(m.text()) })
  p.on('pageerror', (e) => errores.push('pageerror: ' + e.message))

  const j = (b) => ({ status: 200, contentType: 'application/json', body: JSON.stringify(b) })
  await p.route('**/rest/v1/**', (r) => r.fulfill(j([])))
  await p.route('**/auth/v1/**', (r) => r.fulfill(j({})))
  await p.route('**/functions/v1/**', (r) => r.fulfill(j({})))

  await p.goto(URL_APP, { waitUntil: 'domcontentloaded' })
  await p.waitForFunction(() => typeof window.renderResumenSocios === 'function', { timeout: 25000 })

  // El cliente armado: devuelve lo mismo que devolvería la base. Se pone DESPUÉS de cargar la
  // página, porque la app lo deja en `null` cuando no hay sesión.
  await p.evaluate(([resumen, ciclo, corridas]) => {
    window.DB_READY = true
    window.supabase = {
      rpc: (fn) => Promise.resolve({ data: fn === 'btg_ciclo_alcaldia' ? ciclo : resumen, error: null }),
      from: () => ({ select: () => ({ order: () => ({ limit: () => Promise.resolve({ data: corridas, error: null }) }) }) }),
    }
  }, [caso.resumen, CICLO, caso.corridas])

  await p.evaluate(async () => {
    // Las páginas de esta app son `.page` con id `p-<seccion>`, y las muestra `sp()`.
    // ⛔ No se llama a `sp('financiero')` porque valida permisos contra la sesión y acá no hay:
    //    se abre la página a mano y se usa el conmutador real de pestañas, que es lo que importa.
    // ⛔ La capa de acceso tapa TODO con z-index 9999. El texto del DOM estaba bien y la foto
    //    salía del login: una aserción sobre `innerText` no se entera de que la pantalla está
    //    debajo de otra cosa. Esto es exactamente lo que una prueba no ve y un navegador sí.
    const ov = document.getElementById('login-overlay'); if (ov) ov.style.display = 'none'
    document.querySelectorAll('.page').forEach((e) => { e.classList.remove('active'); e.style.display = 'none' })
    const fin = document.getElementById('p-financiero')
    fin.classList.add('active'); fin.style.display = 'block'
    window.switchFinTab('socios')
    // El camino real, no solo el pintor: se piden las dos fechas y se dibuja todo.
    await window.rsCicloActual()
    await window.rsCorridas()
  })
  await p.waitForTimeout(1200)

  const caja = await p.$('#tab-fin-socios')
  await caja.screenshot({ path: `test/_pantalla-${caso.nombre}.png` })

  // Lo que tiene que estar escrito. Un screenshot sin aserciones es una foto bonita: si mañana la
  // pantalla deja de dibujar los proveedores, la foto cambia y nadie lo nota.
  const texto = await p.evaluate(() => document.getElementById('tab-fin-socios').innerText)
  const debe = caso.nombre === 'sin-pago'
    ? ['La Alcaldia no pago en este periodo', 'TOTAL GASTO', 'DIFERENCIA DEL CICLO', 'No hubo pagos a proveedores']
    : ['ENTRO', 'TOTAL GASTO', 'NO ES GASTO', 'DIFERENCIA DEL CICLO', 'A QUIEN SE LE PAGO']
  if (caso.nombre === 'envio-atrasado') debe.push('El ultimo salio hace')
  if (caso.nombre === 'sin-envios') debe.push('Todavia no salio ninguno')

  const faltan = debe.filter((t) => !texto.includes(t))
  const ok = !faltan.length && !errores.length
  if (!ok) fallas++
  console.log(`${ok ? '✅' : '⛔'} ${caso.nombre.padEnd(16)} ${texto.length} caracteres dibujados` +
    (faltan.length ? ` · FALTA: ${faltan.join(' / ')}` : '') +
    (errores.length ? ` · CONSOLA: ${errores.join(' | ').slice(0, 200)}` : ''))
  await ctx.close()
}

await navegador.close()
console.log(fallas ? `\n⛔ ${fallas} caso(s) con problemas` : '\n✅ los 4 estados se dibujan y sin errores de consola')
process.exit(fallas ? 1 : 0)
