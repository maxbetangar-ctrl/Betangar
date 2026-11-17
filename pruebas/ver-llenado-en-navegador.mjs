#!/usr/bin/env node
// ═══════════════════════════════════════════════════════════════════════════════
// VER LA PANTALLA DE LLENADO EN UN NAVEGADOR DE VERDAD, SIN SESIÓN
//
//   node pruebas/ver-llenado-en-navegador.mjs
//   node pruebas/ver-llenado-en-navegador.mjs --ver     (abre el navegador)
//
// ⛔ POR QUÉ. Una pantalla se revisa EN UNA PANTALLA: `node --check` no dibuja
//    nada, y esta pantalla es casi toda dibujo. Pero para verla NO hace falta una
//    sesión: se intercepta la llamada a la base y se le sirve el JSON que la
//    función devuelve de verdad. El navegador es real y el `app.js` es el mismo
//    que se despliega. [[verificar-pantalla-en-navegador-sin-sesion]]
//
// ⛔ LOS ESTADOS EN LA MISMA CORRIDA, y el que más importa es el que no tiene
//    datos: una sección condicional sin datos parece que no existe.
//      1.  con datos        → tiene que dibujar las 66 personas Y las 5 causas
//      1b. sin ningún bloqueo anotado → tiene que DECIR que todavía no se anotó
//                               ninguno, en vez de dejar un «0» que se lee como
//                               «el sistema nunca falló»
//      2.  sin permiso (42501) → tiene que decir «tu rol no los puede ver»,
//                               NUNCA una tabla vacía
//      3.  período anterior al 12/09 → tiene que mostrar el aviso del piso
//      3b. el papel         → las causas también salen impresas
//      4.  sin días medibles → lo dice con palabras
//
// ⚠️ LO QUE ESTO NO PRUEBA: no prueba el RLS, ni los permisos del servidor, ni
//    que la función SQL esté bien. Prueba lo que la pantalla DIBUJA con una
//    respuesta dada. [[norma-probar-el-camino-no-la-pieza]]
// ═══════════════════════════════════════════════════════════════════════════════
import fs from 'node:fs'
import http from 'node:http'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const AQUI = path.dirname(fileURLToPath(import.meta.url))
// Sirve para CUALQUIER repo de la familia: el módulo de llenado es el mismo en
// los seis. Sin argumento, revisa el repo donde vive esta prueba.
//   node pruebas/ver-llenado-en-navegador.mjs ../flotilla-app
const argRepo = process.argv.slice(2).find(a => !a.startsWith('--'))
const RAIZ = argRepo ? path.resolve(argRepo) : path.resolve(AQUI, '..')
const VER = process.argv.includes('--ver')
const SALIDA = process.env.LLENADO_SALIDA || path.join(AQUI, "_salida", path.basename(RAIZ))

let chromium
try {
  // Playwright está instalado GLOBAL en esta máquina, no en el package.json.
  const g = process.platform === 'win32'
    ? path.join(process.env.APPDATA || '', 'npm', 'node_modules', 'playwright', 'index.mjs')
    : '/usr/local/lib/node_modules/playwright/index.mjs'
  chromium = (fs.existsSync(g) ? await import(pathToFileURL(g).href) : await import('playwright')).chromium
} catch {
  console.error('⛔ No encontré Playwright. Se instala UNA vez, global:')
  console.error('   npm i -g playwright && npx playwright install chromium')
  process.exit(1)
}

// ⛔ EL FIXTURE VA CON GENTE Y UNIDADES INVENTADAS. Tiene la FORMA de lo que
//    devuelve `btg_informe_llenado()` y los números reales, pero los nombres son
//    ANA BLANCO, BRUNO CASTRO… y las unidades U01…U12. Este repo es público: una
//    prueba no puede depender del personal ni de la flota real de nadie.
const PAYLOAD = path.join(AQUI, 'llenado-payload.json')
if (!fs.existsSync(PAYLOAD)) {
  console.error(`⛔ Falta ${PAYLOAD}: es la forma de la respuesta de btg_informe_llenado().`)
  process.exit(1)
}
const datos = JSON.parse(fs.readFileSync(PAYLOAD, 'utf8'))

// ── Servidor estático: la página se sirve por http, no por file:// ───────────
const TIPOS = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css',
  '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml' }
const srv = http.createServer((req, res) => {
  const rel = decodeURIComponent(req.url.split('?')[0]).replace(/^\/+/, '') || 'app.html'
  const f = path.join(RAIZ, rel)
  if (!f.startsWith(RAIZ) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) {
    res.writeHead(404); res.end('no'); return
  }
  res.writeHead(200, { 'Content-Type': TIPOS[path.extname(f)] || 'application/octet-stream' })
  fs.createReadStream(f).pipe(res)
})
await new Promise(r => srv.listen(0, '127.0.0.1', r))
const BASE = `http://127.0.0.1:${srv.address().port}`

fs.mkdirSync(SALIDA, { recursive: true })
const fallos = []
const ok = (q, m) => { console.log(`   ${q ? '✅' : '⛔'} ${m}`); if (!q) fallos.push(m) }

const navegador = await chromium.launch({ headless: !VER })

async function montar (respuesta) {
  // Contexto NUEVO siempre: revisar con el que ya usaste es otro producto.
  const ctx = await navegador.newContext({ viewport: { width: 1480, height: 1000 } })
  const pg = await ctx.newPage()
  // Todo lo que vaya a Supabase se contesta acá. La RPC del informe devuelve lo
  // que le pasemos; cualquier otra llamada devuelve vacío para que no estorbe.
  // ⛔ EL ORDEN IMPORTA Y ES AL REVÉS DE LO QUE PARECE: Playwright da prioridad a
  //    la ruta registrada ÚLTIMA. Con el comodín al final, `**/rest/v1/**` se
  //    comía la llamada del informe y devolvía `[]` — la pantalla decía «Sin
  //    datos» y las 11 comprobaciones salían en rojo como si el código estuviera
  //    roto. El comodín va PRIMERO; lo específico, después.
  await pg.route('**/auth/v1/**', r =>
    r.fulfill({ status: 200, contentType: 'application/json', body: '{}' }))
  await pg.route('**/rest/v1/**', r =>
    r.fulfill({ status: 200, contentType: 'application/json', body: '[]' }))
  await pg.route('**/rest/v1/rpc/btg_informe_llenado*', r =>
    r.fulfill({ status: respuesta.status || 200, contentType: 'application/json',
      body: JSON.stringify(respuesta.body) }))
  await pg.goto(`${BASE}/app.html`, { waitUntil: 'domcontentloaded' })
  await pg.waitForFunction(() => typeof window.sp === 'function' && typeof window.renderLlenado === 'function', { timeout: 20000 })
  // ⛔ EL CLIENTE TIENE QUE SER EL DE VERDAD. `_rpc` llama a `supabase.rpc(...)`:
  //    con un objeto inventado no sale ninguna petición y no hay nada que
  //    interceptar — la primera corrida dio las 11 comprobaciones en rojo por
  //    esto. Se arma el cliente real (la librería ya cargó del CDN) y lo que se
  //    falsea es la RED, que es donde vive la costura.
  await pg.waitForFunction(() => typeof window.createClient === 'function' ||
    (window.supabase && window.supabase.createClient), { timeout: 20000 })
  await pg.evaluate(() => {
    const crear = window.createClient || (window.supabase && window.supabase.createClient)
    window.supabase = crear(window.SUPA_URL, window.SUPA_KEY, { auth: { persistSession: false } })
    window.DB_READY = true
    window.SESION = { usuario: 'maxbetangar', rol: 'superadmin', nombre: 'Maximo Betancourt' }
    // ⛔ Y SE BAJA EL LOGIN. Sin esto la pantalla QUEDA DEBAJO del overlay: el
    //    `innerText` de `#lle-body` da bien —el DOM está— y las comprobaciones
    //    salen todas en verde mientras la captura muestra la pantalla de entrada.
    //    Pasó en esta misma prueba: la agarró la imagen, no las aserciones.
    //    [[norma-una-pantalla-se-revisa-en-una-pantalla]]
    const lo = document.getElementById('login-overlay')
    if (lo) lo.style.display = 'none'
  })
  await pg.evaluate(() => { try { aplicarPermisos() } catch (e) {} ; sp('llenado') })
  await pg.waitForTimeout(900)
  return { ctx, pg }
}

const txt = (pg) => pg.$eval('#lle-body', e => e.innerText)

// ⛔ `fullPage: true` ACÁ NO CAPTURA LA PÁGINA: devuelve el viewport y nada más.
//    El informe scrollea DENTRO de su contenedor, así que el documento mide 1000
//    px y la captura sale de 1480x1000 siempre. Durante un tiempo todas las
//    imágenes de esta prueba mostraron sólo la primera pantalla — y lo que se
//    agregó abajo (la sección de causas) no se vio NUNCA. Se delató porque dos
//    estados distintos dieron dos PNG **idénticos byte por byte** mientras las
//    aserciones de los dos salían en verde.
//    ⇒ Se estira el viewport a la altura real del contenido antes de la foto.
//    [[norma-una-pantalla-se-revisa-en-una-pantalla]]
async function foto (pg, ctx, destino) {
  const alto = await pg.evaluate(() => {
    const b = document.getElementById('lle-body')
    return Math.min(14000, Math.max(1000, (b ? b.scrollHeight : 0) + 220))
  })
  await pg.setViewportSize({ width: 1480, height: alto })
  await pg.waitForTimeout(250)
  await pg.screenshot({ path: destino, fullPage: true })
  await pg.setViewportSize({ width: 1480, height: 1000 })
}

// Y la sección que se está revisando, SOLA: una foto de 14.000 px de alto no se
// mira, y entonces vuelve a no revisarse nada.
async function fotoSeccion (pg, sel, destino) {
  const el = await pg.$(sel)
  if (!el) return false
  await el.scrollIntoViewIfNeeded()
  await pg.waitForTimeout(150)
  await el.screenshot({ path: destino })
  return true
}

try {
  // ── 1. CON DATOS ───────────────────────────────────────────────────────────
  console.log('\n1. Con datos (12/09 → 07/11)')
  {
    const { ctx, pg } = await montar({ body: datos })
    const t = await txt(pg)
    // ⛔ ANTES QUE NADA: que se VEA. El `innerText` existe aunque el informe
    //    quede tapado por el login, y entonces todo lo demás da verde sobre una
    //    pantalla que nadie puede leer.
    ok(await pg.isVisible('#lle-body'), 'el informe se ve (no lo tapa la pantalla de entrada)')
    ok(await pg.isHidden('#login-overlay'), 'la pantalla de entrada está abajo')
    const filas = await pg.$$eval('#lle-body table tbody tr', r => r.length)
    ok(filas >= 66, `dibuja las filas de las personas (${filas} filas en total)`)
    ok(/ANA BLANCO/.test(t), 'el peor evaluado aparece primero')
    ok(/A corregir/.test(t), 'muestra el veredicto «A corregir»')
    ok(/Nadie firmó el checklist después del chofer/.test(t), 'el titular dice que nadie firma')
    ok(/96,9%|96.9%/.test(t), 'el titular trae el % de cierre')
    ok(/Lo que esta medición no puede decir/.test(t), 'las advertencias viajan con el informe')
    ok(!/undefined|NaN|\[object/.test(t), 'no hay undefined, NaN ni [object Object]')
    // ⛔ UNA COLUMNA VACÍA NO SE QUEJA. «Motivo» y «Qué se le exige» salieron en
    //    blanco en la primera versión —la función SQL nunca los calculaba— y
    //    todo lo demás daba verde: son las dos columnas que se usan en la
    //    reunión. Lo agarró la captura. Ahora se cuentan, y se cuentan POR
    //    NOMBRE DE COLUMNA: con el rediseño el índice fijo dejó de apuntar a
    //    donde yo creía, y la comprobación seguía en verde midiendo otra cosa.
    const accion = await pg.$$eval('#lle-body table', ts => {
      const t = ts.find(x => /Qué se le exige/i.test(x.tHead?.innerText || ''))
      if (!t) return null
      const cab = [...t.tHead.rows[0].cells].map(c => c.innerText.trim())
      const iM = cab.findIndex(c => /^Motivo$/i.test(c))
      const iE = cab.findIndex(c => /Qué se le exige/i.test(c))
      return [...t.tBodies[0].rows].map(f =>
        [f.cells[iM]?.innerText.trim() || '', f.cells[iE]?.innerText.trim() || ''])
    })
    const huecos = accion ? accion.filter(c => !c[0] || !c[1]).length : -1
    ok(accion && accion.length >= 1 && huecos === 0,
      `la lista de acción trae motivo y exigencia en cada fila (${accion ? accion.length : 0} filas, ${huecos} incompletas)`)
    // Y que estén TODAS las personas repartidas por área, no sólo las de acción.
    const nombres = await pg.$$eval('#lle-body table tbody tr td:first-child',
      c => new Set(c.map(x => x.innerText.trim())).size)
    ok(nombres >= 40, `el detalle por área reparte a toda la gente (${nombres} nombres distintos)`)
    // ⛔ Los cargos que el patrón no reconoció TIENEN que verse: la base los
    //    devuelve justamente para eso. Si la pantalla no los dibuja, el dato
    //    existe y nadie lo ve — que es igual a no tenerlo.
    ok(/Para confirmar con la empresa/.test(t), 'muestra los cargos a confirmar')
    ok(/se los midió como/i.test(t), 'dice CÓMO se los está midiendo mientras tanto')

    // ── LA CAUSA DE CADA JORNADA SIN CERRAR ──────────────────────────────────
    // ⛔ SE COMPRUEBAN LAS CINCO CAUSAS UNA POR UNA. Con una sola aserción de que
    //    «la sección existe», cuatro de las cinco ramas podrían no dibujarse
    //    nunca y la prueba seguiría verde. El fixture trae una de cada.
    ok(/Por qué no se cerró cada día/.test(t), 'dibuja la sección de causas')
    for (const c of ['bloqueo del sistema', 'la jornada todavia no termina',
      'la cola lo retuvo', 'del chofer, probado', 'no decidible']) {
      ok(t.includes(c), `dibuja la causa «${c}»`)
    }
    ok(/el kilometraje no puede ir para atras/.test(t),
      'la prueba del bloqueo trae lo que decía la pantalla del chofer')
    ok(/desde el mismo telefono/.test(t), 'la prueba del chofer dice CON QUÉ se lo refuta')
    // ⛔ LO QUE MÁS IMPORTA DEL TITULAR: que DESCUENTE lo que no es del chofer. Si
    //    lo cuenta como falla, el número grande señala a gente que está
    //    manejando — que es justo el error que esta sección vino a arreglar.
    // ⛔ EL NÚMERO EXACTO, Y ES EL DE LA BASE (`juzgables`), no una resta de la
    //    pantalla. Así escrito cazó que `app.js` restaba solo las jornadas en
    //    curso y decía 15 donde van 13: el informe tampoco le cuenta al chofer
    //    las que trancó el sistema. Una aserción de «hay un número» no lo habría
    //    visto. [[norma-test-que-pasa-por-el-motivo-equivocado]]
    const titular = t.replace(/\s+/g, ' ')
    ok(/De las 13 que quedan para juzgar/.test(titular),
      'el titular dice cuántas quedan para juzgar, con el número de la base (13 de 18)')
    ok(/esas 5 no se le cuentan a nadie/.test(titular),
      'dice cuántas no se le cuentan a nadie (3 en curso + 2 que trancó el sistema)')
    ok(/todavía no terminaron/.test(titular) && /las trancó el sistema/.test(titular),
      'y dice POR QUÉ no se le cuentan, los dos motivos')
    // ⛔ EL CONTROL QUE FALTABA: que el desglose SUME lo que el titular anuncia.
    //    La primera versión decía «Quedan 13» y listaba 11+2+1+1 = 15 —metía los
    //    bloqueos que acababa de descontar— y todas las aserciones estaban en
    //    verde. Lo vio la captura. Un número seguido de una lista que no le suma
    //    tira abajo la confianza en el informe entero.
    const desglose = (titular.match(/De las 13 que quedan para juzgar:(.+?)\./) || [, ''])[1]
    const suma = (desglose.match(/\d+/g) || []).reduce((a, x) => a + Number(x), 0)
    ok(suma === 13, `el desglose suma exactamente lo que anuncia el titular (${suma} de 13)`)
    // El tipeo es la tercera pata de la pregunta de Máximo y va en su propio bloque.
    ok(/Días cerrados con el dato mal cargado/.test(t), 'dibuja el bloque de tipeo')
    ok(/que es ANTES/.test(t), 'el tipeo dice qué tiene de malo el registro')
    ok(/El turno nocturno no entra/.test(t),
      'avisa que el nocturno no cuenta como tipeo (cruza la medianoche)')
    // ⛔ CON DATOS, LA LÍNEA TIENE QUE DECIR LA FECHA, no el texto del vacío. Las
    //    dos capturas salieron IDÉNTICAS byte por byte la primera vez, y ninguna
    //    aserción lo vio: las dos ramas del condicional caían en la misma.
    ok(/Los bloqueos del sistema se anotan desde el 16\/11\/2026/.test(t),
      'con datos, dice DESDE CUÁNDO se anotan los bloqueos')
    if (process.env.LLENADO_DEPURAR) {
      console.log('   [1] linea del bloqueo:',
        (t.match(/(Los bloqueos del sistema se anotan[^\n]*|Todavía no se ha anotado[^\n]*)/) || ['(ninguna)'])[0].slice(0, 110))
    }
    await foto(pg, ctx, path.join(SALIDA, 'llenado-1-con-datos.png'))
    ok(await fotoSeccion(pg, '#lle-causas', path.join(SALIDA, 'llenado-1c-causas.png')),
      'la seccion de causas se puede fotografiar sola (existe #lle-causas)')
    await ctx.close()
  }

  // ── 1b. SIN NINGÚN BLOQUEO ANOTADO TODAVÍA ─────────────────────────────────
  // ⛔ ES LA RAMA QUE NADIE VERÍA. Cuando `chofer_bloqueos` está vacía, «0
  //    bloqueos del sistema» se lee como «el sistema nunca falló», y lo que pasa
  //    es que nadie lo estaba anotando. La pantalla TIENE que decirlo con
  //    palabras. [[norma-falta-de-dato-no-es-un-dato]]
  console.log('\n1b. Sin ningún bloqueo anotado (la tabla recién nace)')
  {
    const sinBloq = JSON.parse(JSON.stringify(datos))
    sinBloq.causas.bloqueos_se_anotan_desde = null
    sinBloq.causas.resumen.bloqueo_del_sistema = 0
    sinBloq.causas.dias = sinBloq.causas.dias.filter(d => d.causa !== 'bloqueo del sistema')
    const { ctx, pg } = await montar({ body: sinBloq })
    const t = await txt(pg)
    ok(/Todavía no se ha anotado ningún bloqueo/.test(t),
      'dice que todavía no se anotó ninguno, en vez de dejar un 0 mudo')
    ok(/no significa que no los hubo/.test(t), 'aclara que el cero NO prueba que no los hubo')
    ok(!/bloqueo del sistema/.test(t) || /Todavía no se ha anotado/.test(t),
      'no muestra una causa que no tiene filas')
    if (process.env.LLENADO_DEPURAR) {
      console.log('   [1b] linea del bloqueo:',
        (t.match(/(Los bloqueos del sistema se anotan[^\n]*|Todavía no se ha anotado[^\n]*)/) || ['(ninguna)'])[0].slice(0, 110))
    }
    await fotoSeccion(pg, '#lle-causas', path.join(SALIDA, 'llenado-1b-sin-bloqueos.png'))
    await ctx.close()
  }

  // ── 2. SIN PERMISO ─────────────────────────────────────────────────────────
  console.log('\n2. Sin permiso (la base levanta 42501)')
  {
    const { ctx, pg } = await montar({ status: 403, body: { code: '42501',
      message: 'El informe de llenado no esta disponible para este usuario.' } })
    const t = await txt(pg)
    ok(/no está disponible para tu usuario/i.test(t), 'dice que no tiene permiso')
    ok(/no es que no haya registros/i.test(t), 'aclara que NO es que no haya datos')
    ok(!/<table/i.test(await pg.$eval('#lle-body', e => e.innerHTML)), 'no dibuja ninguna tabla vacía')
    await foto(pg, ctx, path.join(SALIDA, 'llenado-2-sin-permiso.png'))
    await ctx.close()
  }

  // ── 3. PERÍODO ANTERIOR AL PISO ────────────────────────────────────────────
  console.log('\n3. Período anterior al 12/09 (tiene que avisar)')
  {
    const conAviso = JSON.parse(JSON.stringify(datos))
    conAviso.aviso = 'Pediste desde el 01/08/2026, pero hasta el 11/09/2026 el checklist guardaba un nombre sacado de una lista fija camion-chofer.'
    const { ctx, pg } = await montar({ body: conAviso })
    const t = await txt(pg)
    ok(/11\/09\/2026/.test(t), 'muestra el aviso del piso del 12/09')
    ok(/lista fija/.test(t), 'explica por qué, no solo que no se puede')
    await foto(pg, ctx, path.join(SALIDA, 'llenado-3-aviso.png'))
    await ctx.close()
  }

  // ── 3b. LO QUE SALE AL PAPEL ───────────────────────────────────────────────
  // Esto es lo que Máximo pidió: poder imprimirlo. Se atrapa el HTML que
  // `abrirImpresionPremium` manda a la ventana nueva y se dibuja aparte, así se
  // mira el papel de verdad y no una suposición.
  console.log('\n3b. El papel (Imprimir / PDF)')
  {
    const { ctx, pg } = await montar({ body: datos })
    await pg.evaluate(() => {
      window.__papel = ''
      window.open = function () {
        return { document: { open () {}, write (h) { window.__papel += h }, close () {} },
          focus () {}, print () {}, closed: false, onload: null }
      }
    })
    await pg.evaluate(() => imprimirLlenado())
    await pg.waitForTimeout(700)
    const papel = await pg.evaluate(() => window.__papel || '')
    ok(papel.length > 4000, `el papel se arma (${papel.length} caracteres)`)
    ok(/Llenado de la app por empleado/.test(papel), 'lleva el título del informe')
    ok(/Del \d{2}\/\d{2}\/\d{4} al \d{2}\/\d{2}\/\d{4}/.test(papel), 'la cabecera dice QUÉ período')
    ok(/A corregir/.test(papel) && /Qué se le exige/.test(papel), 'lleva los veredictos y las exigencias')
    // Las secciones numeradas: es lo que hace que se pueda leer en una reunión.
    // ⛔ Se comprueba el TÍTULO, no el número. Al intercalar una sección nueva
    //    todas las de abajo se corren, y una aserción con el número escrito
    //    («8. Cómo se midió») se pone roja sin que nada esté mal. Mismo vicio
    //    que la columna por índice fijo.
    for (const s of ['Lo que hay que atender', 'El detalle, área por área',
      'Por qué no se cerró cada día',
      'Para confirmar con la empresa', 'Cómo se midió']) {
      ok(new RegExp('\\d+\\.\\s*' + s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).test(papel),
        `el papel trae la sección «${s}», numerada`)
    }
    // Las áreas salen de `LLE_AREAS`, que se agrupa por la FUNCIÓN que calcula
    // la base. Si se agrega o renombra una, se actualiza acá.
    for (const a of ['Choferes', 'Ayudantes', 'Vigilancia', 'Taller',
      'Supervisión y jefaturas', 'Oficina y dirección']) {
      ok(papel.includes(a), `el detalle separa el área «${a}»`)
    }
    if (papel) {
      const hoja = await ctx.newPage()
      await hoja.setContent(papel, { waitUntil: 'domcontentloaded' })
      // ⛔ EL `undefined` SE BUSCA EN EL TEXTO QUE SE LEE, no en el HTML crudo:
      //    el logo viaja como base64 y adentro aparecen «NaN» y «undefined» por
      //    pura casualidad. Buscarlo en el fuente daba rojo sobre un papel
      //    perfecto — el control también necesita control.
      //    [[norma-una-asercion-mal-escrita-acusa-al-producto]]
      const leido = await hoja.evaluate(() => document.body.innerText)
      ok(!/undefined|NaN|\[object/.test(leido), 'el papel no muestra undefined ni NaN')
      // ⛔ La cabecera se comprueba GENÉRICA: esta prueba corre en los seis
      //    repos y cada empresa tiene su nombre. Antes decía «Inversiones
      //    Betangar» y daba rojo en los cinco clones por culpa de la aserción,
      //    no del producto. Lo que debe estar es el bloque de marca: el RIF y
      //    un nombre no vacío, los pone `abrirImpresionPremium()`.
      const marca = await hoja.evaluate(() => {
        const h = document.querySelector('.hdr .empresa')
        return h ? { nom: (h.querySelector('.nombre') || {}).textContent || '',
                     rif: (h.querySelector('.rif') || {}).textContent || '' } : null
      })
      ok(!!marca && marca.nom.trim().length > 2 && /RIF/i.test(marca.rif),
        `el papel sale con la cabecera de la empresa (${marca ? marca.nom.trim().slice(0, 28) : 'sin cabecera'})`)
      // ⛔ LA CAUSA TIENE QUE SALIR EN EL PAPEL, no solo en la pantalla: el papel
      //    es el que se lleva a la reunión, y es ahí donde se dice «el sistema no
      //    me dejó». Tenerla y no llevarla sería el error completo.
      ok(/bloqueo del sistema/.test(leido) && /del chofer, probado/.test(leido),
        'el papel trae las causas, no solo la pantalla')
      ok(/la jornada todavia no termina/.test(leido),
        'el papel distingue la jornada en curso (no acusa a quien está manejando)')
      ok(/que es ANTES/.test(leido), 'el papel trae el bloque de tipeo')
      await hoja.screenshot({ path: path.join(SALIDA, 'llenado-4-papel.png'), fullPage: false })
      await hoja.close()
    }
    await ctx.close()
  }

  // ── 4. SIN NADA QUE MOSTRAR ────────────────────────────────────────────────
  console.log('\n4. Período sin días medibles')
  {
    const { ctx, pg } = await montar({ body: { vacio: true,
      aviso: 'No queda ningun dia medible en ese periodo.' } })
    const t = await txt(pg)
    ok(/No queda ningun dia medible/.test(t), 'lo dice con palabras, no con una tabla vacía')
    await ctx.close()
  }
} finally {
  await navegador.close()
  srv.close()
}

console.log(`\nCapturas en ${SALIDA}`)
if (fallos.length) { console.error(`\n⛔ ${fallos.length} comprobación(es) en rojo`); process.exit(1) }
console.log('\n✅ los cuatro estados dibujan lo que tienen que dibujar')
