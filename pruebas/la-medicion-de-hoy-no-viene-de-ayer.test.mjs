// ⛔ LA CASILLA DE LA REGLA TRAÍA PUESTA LA MEDICIÓN DE AYER, Y SE GUARDÓ ESA.
//
// 🔴 Betangar, 29/10/2026. ANDRY JOEL ORTEGA FARIA (JAC-B010) midió la regla al salir y
//    marcaba 12 cm. La casilla «CM al SALIR del galpón» ya traía 18 — los de la jornada
//    anterior. Se guardó 18: 201,50 L en lugar de 129,86 L. 71,64 litros que nadie echó.
//    En la MISMA fila el odómetro también venía puesto: km_salida 24233, el mismo del 28/10
//    y el mismo con el que la unidad había llegado el 27/10 — y el 28 hizo tres viajes.
//
// DE DÓNDE SALÍA. Por eliminación: ninguna línea de `chofer.html` escribía `cl-cm-salida`.
// El borrador no podía ser (su llave lleva la fecha y solo rellena lo VACÍO). Quedaba el
// navegador: repone el valor de una casilla de texto cuando la página se recarga. Y la app
// se recarga SOLA al cambiar el día (`hr!==hoy` → `location.reload()`). Pasada la medianoche
// con la app abierta, los números de ayer vuelven a la pantalla de hoy, donde ya no hay base
// ni borrador que los pise.
//
// 📌 Medido en la base de Betangar: 15 salidas repiten exacto el cm de la salida anterior
//    (11 con una llegada DISTINTA en medio, que es la huella afilada: el tanque no sube solo
//    de noche) y 9 repiten el km_salida, sobre 1.089 pares de días consecutivos.
//
// Corre las funciones REALES de `chofer.html` (no una copia) sobre un DOM de juguete.
// ⛔ VERIFICADA AL REVÉS: los mismos casos corren contra el `chofer.html` ANTERIOR
//    (`git show HEAD:chofer.html`) y ahí el caso del residuo tiene que FALLAR. Si pasa en
//    los dos, la prueba no está probando nada.
//
//   node pruebas/la-medicion-de-hoy-no-viene-de-ayer.test.mjs [ruta-a-chofer.html]
import { readFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import vm from 'node:vm'

const ruta = process.argv[2] || new URL('../chofer.html', import.meta.url)
const html = readFileSync(ruta, 'utf8')

let fallos = 0
const ok = (c, m) => { console.log(`${c ? '  ✅' : '  ⛔'} ${m}`); if (!c) fallos++ }

// ── Un DOM de juguete y las funciones reales sacadas del archivo ─────────────
function montar (fuente) {
  const trozo = (re, nombre) => {
    const m = fuente.match(re)
    if (!m) throw new Error(`no encontré ${nombre} en el chofer.html`)
    return m[0]
  }
  const piezas = [
    trozo(/^var CL_DRAFT_CAMPOS = [\s\S]*?\];/m, 'CL_DRAFT_CAMPOS'),
    trozo(/^function setVal\(id, val\).*$/m, 'setVal'),
    trozo(/^function gv\(id\).*$/m, 'gv'),
    // Las dos piezas del arreglo. Si no están (archivo anterior), se montan igual y los
    // casos las encuentran ausentes — que es justo lo que la verificación al revés mira.
    (fuente.match(/^var _CL_YA_VACIADO[\s\S]*?^}$/m) || [''])[0],
    (fuente.match(/^function clTraerMedicionSalida\(\)\{[\s\S]*?^}$/m) || [''])[0],
  ]

  const cajas = {}
  const ctx = {
    console,
    setTimeout,
    document: {
      getElementById: (id) => cajas[id] || null,
    },
    // el tanque y la unidad
    cam: 'JAC-B010',
    hoy: '2026-10-29',
    supabase: null,
    clCalcLitrosCm: () => {},
    _cajas: cajas,
  }
  for (const id of ['cl-km-salida', 'cl-km-llegada', 'cl-hora-salida', 'cl-hora-llegada',
                    'cl-cm-salida', 'cl-cm-llegada', 'cl-observaciones', 'cl-motivo']) {
    cajas[id] = { value: '' }
  }
  vm.createContext(ctx)
  vm.runInContext(piezas.join('\n'), ctx)
  return ctx
}

// ══ 1 · el caso de Andry: el residuo de ayer NO sobrevive al arranque ════════
console.log('\n1 · lo que quedó en la casilla no es un dato')
{
  const c = montar(html)
  c._cajas['cl-cm-salida'].value = '18'      // lo que el navegador repuso al recargar
  c._cajas['cl-km-salida'].value = '24233'   // y el odómetro, igual
  vm.runInContext('clVaciarCamposUnaVez()', c)
  ok(c._cajas['cl-cm-salida'].value === '', 'los 18 cm de ayer ya no están en la casilla')
  ok(c._cajas['cl-km-salida'].value === '', 'los 24233 km de ayer tampoco')
}

// ══ 2 · y NO le borra al chofer lo que está escribiendo ══════════════════════
//    `verificarConexion()` vuelve a llamar a la carga del checklist cada vez que vuelve
//    internet. Si el vaciado corriera ahí de nuevo, le borraría la medición al chofer justo
//    cuando se le reconecta el teléfono — el error del borrador, al revés.
console.log('\n2 · al volver internet no se borra lo tecleado')
{
  const c = montar(html)
  c._cajas['cl-cm-salida'].value = '18'
  vm.runInContext('clVaciarCamposUnaVez()', c)          // arranque
  c._cajas['cl-cm-salida'].value = '12'                 // el chofer mide y escribe
  vm.runInContext('clVaciarCamposUnaVez()', c)          // vuelve internet
  ok(c._cajas['cl-cm-salida'].value === '12', 'los 12 cm que midió el chofer siguen ahí')
}

// ══ 3 · el cm de la mañana se LEE DE LA BASE, no de la pantalla ══════════════
console.log('\n3 · en modo llegada la referencia sale de la base')
{
  const c = montar(html)
  let pedido = null
  c.supabase = { rpc: (fn, args) => { pedido = { fn, args }; return Promise.resolve({ data: 12 }) } }
  vm.runInContext('clTraerMedicionSalida()', c)
  await Promise.resolve(); await Promise.resolve()
  ok(pedido && pedido.fn === 'chofer_medicion', 'le pregunta a `chofer_medicion`')
  ok(pedido && pedido.args.p_momento === 'salida' && pedido.args.p_fecha === '2026-10-29',
     'por la salida de HOY y de esta unidad')
  ok(c._cajas['cl-cm-salida'].value === 12, 'pinta los 12 cm que tiene la base')
}

// ══ 4 · pero no pisa lo que el chofer está escribiendo ═══════════════════════
console.log('\n4 · lo que el chofer tecleó no se pisa con el de la base')
{
  const c = montar(html)
  c._cajas['cl-cm-salida'].value = '9'
  c.supabase = { rpc: () => Promise.resolve({ data: 12 }) }
  vm.runInContext('clTraerMedicionSalida()', c)
  await Promise.resolve(); await Promise.resolve()
  ok(c._cajas['cl-cm-salida'].value === '9', 'siguen los 9 cm del chofer, no los 12 de la base')
}

// ══ 5 · el navegador tiene prohibido reponer esas casillas ═══════════════════
console.log('\n5 · las ocho casillas con autocomplete="off"')
for (const id of ['cl-km-salida', 'cl-km-llegada', 'cl-hora-salida', 'cl-hora-llegada',
                  'cl-cm-salida', 'cl-cm-llegada', 'cl-observaciones', 'cl-motivo']) {
  const re = new RegExp(`<(?:input|textarea)[^>]*autocomplete="off"[^>]*id="${id}"`)
  ok(re.test(html), id)
}

// ══ 6 · VERIFICACIÓN AL REVÉS: contra el archivo anterior, el caso 1 falla ═══
console.log('\n6 · al revés: con el código anterior el residuo SOBREVIVE')
{
  // ⛔ EL «ANTES» NO PUEDE SER `HEAD`, Y ESO TUVO LA SUITE EN ROJO DESDE EL 29/10/2026.
  //    Mientras el arreglo vivía en una rama, `HEAD:chofer.html` era el código viejo y el
  //    control al revés corría. En cuanto se mergeó, HEAD YA TRAE EL ARREGLO: el control se
  //    declara a sí mismo imposible y suma un fallo — para siempre, en cada corrida.
  //    ⇒ Una suite que está roja pase lo que pase no avisa de nada: se vuelve ruido y se
  //      deja de mirar. Costó que nadie notara nada en siete días.
  //    El «antes» correcto es FIJO: el padre del commit que introdujo el arreglo. Ese
  //    commit no se mueve nunca, así que el control sigue pudiendo correr para siempre.
  //    [[norma-un-aviso-que-salta-siempre-no-avisa]]
  let antes = null
  // El repo del archivo QUE SE ESTÁ PROBANDO, no el de esta prueba: así la verificación
  // al revés sirve igual cuando se corre apuntando a otro de los seis clones.
  const repo = path.dirname(ruta instanceof URL ? fileURLToPath(ruta) : path.resolve(ruta))
  const git = (args) => execFileSync('git', args, { cwd: repo, encoding: 'utf8', maxBuffer: 50 * 1024 * 1024 })
  let dondeSalio = ''
  try {
    // El commit más viejo que tocó esa función en este archivo = el que la agregó.
    const commits = git(['log', '-S', 'clVaciarCamposUnaVez', '--format=%H', '--', 'chofer.html'])
      .trim().split('\n').filter(Boolean)
    const introdujo = commits[commits.length - 1]
    if (!introdujo) throw new Error('no encuentro el commit que agregó `clVaciarCamposUnaVez`')
    dondeSalio = introdujo.slice(0, 7) + '^'
    antes = git(['show', `${introdujo}^:chofer.html`])
  } catch (e) {
    // ⛔ HAY QUE DISTINGUIR DOS COSAS QUE SE VEÍAN IGUAL. Si el repo es un clon SUPERFICIAL no
    //    hay historia que mirar: eso es el entorno, no un defecto, y contarlo como fallo pone la
    //    prueba en rojo por algo que el producto no hizo. `actions/checkout` clona superficial
    //    por omisión, y por esto el CI estuvo rojo. Si en cambio SÍ hay historia y aun así no
    //    pude armar el «antes», eso sí es un problema y se cuenta.
    //    [[norma-un-filtro-nuestro-tapa-un-dato-que-si-llega]]
    let superficial = false
    try { superficial = git(['rev-parse', '--is-shallow-repository']).trim() === 'true' } catch (_) {}
    const porque = String(e.message).split('\n')[0].slice(0, 80)
    if (superficial) {
      console.log('  ⏭  clon SUPERFICIAL (sin historia): la verificación al revés no se puede hacer acá.')
      console.log('     No cuenta como fallo. Para que corra en el CI: `fetch-depth: 0` en actions/checkout.')
    } else {
      console.log(`  ⚠️  no pude armar el «antes» (${porque}) — la verificación al revés NO corrió`)
      fallos++
    }
  }
  if (antes) {
    // Control positivo del control negativo: si el «antes» YA trajera el arreglo, no estaría
    // probando nada y hay que decirlo — pero ahora eso sería un error de la prueba, no del
    // producto. [[norma-control-positivo-antes-de-creerle-al-vacio]]
    if (antes.includes('clVaciarCamposUnaVez')) {
      console.log(`  ⚠️  el «antes» (${dondeSalio}) ya trae el arreglo: la prueba está mal armada`)
      fallos++
    } else {
      const c = montar(antes)
      c._cajas['cl-cm-salida'].value = '18'
      let reventó = false
      try { vm.runInContext('clVaciarCamposUnaVez()', c) } catch (e) { reventó = true }
      ok(reventó || c._cajas['cl-cm-salida'].value === '18',
         `sin el arreglo (${dondeSalio}) los 18 cm de ayer se quedan en la casilla`)
    }
  }
}

console.log(fallos === 0 ? '\n✅ todo bien\n' : `\n⛔ ${fallos} fallo(s)\n`)
process.exit(fallos === 0 ? 0 : 1)
