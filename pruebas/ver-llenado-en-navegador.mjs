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
// ⛔ LOS TRES ESTADOS EN LA MISMA CORRIDA, y el que más importa es el que no
//    tiene datos: una sección condicional sin datos parece que no existe.
//      1. con datos        → tiene que dibujar las 66 personas
//      2. sin permiso (42501) → tiene que decir «tu rol no los puede ver»,
//                               NUNCA una tabla vacía
//      3. período anterior al 12/09 → tiene que mostrar el aviso del piso
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
    await pg.screenshot({ path: path.join(SALIDA, 'llenado-1-con-datos.png'), fullPage: true })
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
    await pg.screenshot({ path: path.join(SALIDA, 'llenado-2-sin-permiso.png'), fullPage: true })
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
    await pg.screenshot({ path: path.join(SALIDA, 'llenado-3-aviso.png'), fullPage: true })
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
