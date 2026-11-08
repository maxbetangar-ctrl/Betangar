#!/usr/bin/env node
// ═══════════════════════════════════════════════════════════════════════════════
// VER EN UN NAVEGADOR DE VERDAD QUE R17 HABLA DEL TANQUE PROPIO, NO DEL «GALPÓN»
//
//   node pruebas/ver-tanque-propio-en-navegador.mjs
//   node pruebas/ver-tanque-propio-en-navegador.mjs --ver        (abre el navegador)
//   node pruebas/ver-tanque-propio-en-navegador.mjs ../flotilla-app
//
// ⛔ POR QUÉ EN UN NAVEGADOR. Las 43 pruebas del banco corren las funciones en un
//    `vm` y prueban la REGLA. Lo que R17 produce es un PÁRRAFO que una persona
//    tiene que leer y entender, y eso no lo prueba una aserción: se mira.
//    [[norma-una-pantalla-se-revisa-en-una-pantalla]]
//
// ⛔ LOS DOS CASOS SON EL PUNTO, y el segundo es el que nació hoy:
//      1. CON capacidad declarada (tanques en la tabla, `tipo='galpon'`)
//         → tiene que decir los litros expuestos y los dólares.
//      2. SIN capacidad, declarado SOLO en `configuracion.tanques_internos`
//         → NO puede decir «hasta 0 L»: tiene que decir que no se sabe cuánta
//           capacidad tienen, y pedir que se declaren. Antes del 08/11/2026 este
//           caso apagaba la regla entera por la puerta `cap<=0`, en silencio.
//
// ⚠️ LO QUE ESTO NO PRUEBA: ni el RLS, ni que las consultas de la auditoría estén
//    bien. Prueba lo que la pantalla DIBUJA con una respuesta dada.
//    [[norma-probar-el-camino-no-la-pieza]]
// ═══════════════════════════════════════════════════════════════════════════════
import fs from 'node:fs'
import http from 'node:http'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const AQUI = path.dirname(fileURLToPath(import.meta.url))
const argRepo = process.argv.slice(2).find(a => !a.startsWith('--'))
const RAIZ = argRepo ? path.resolve(argRepo) : path.resolve(AQUI, '..')
const VER = process.argv.includes('--ver')
const SALIDA = path.join(AQUI, '_salida', path.basename(RAIZ))

let chromium
try {
  const g = process.platform === 'win32'
    ? path.join(process.env.APPDATA || '', 'npm', 'node_modules', 'playwright', 'index.mjs')
    : '/usr/local/lib/node_modules/playwright/index.mjs'
  chromium = (fs.existsSync(g) ? await import(pathToFileURL(g).href) : await import('playwright')).chromium
} catch {
  console.error('⛔ No encontré Playwright:  npm i -g playwright && npx playwright install chromium')
  process.exit(1)
}

// ⛔ DATOS INVENTADOS, CON LA FORMA REAL. Este repo es público y los otros son de
//    clientes: una prueba no puede llevar el tanque ni el sitio de nadie. Los
//    nombres son `mi_patio` y `cisterna_2`, que no son de ninguna empresa.
const HOY = '2026-11-08'
const DESDE = '2026-10-01'
const TANQUE_VEHICULO = { id: 'tq-u01', tipo: 'vehiculo', capacidad_litros: 600, forma: 'cilindro_horizontal', diametro_cm: 100, largo_cm: 100 }
const PROPIO_CON_CAP = { id: 'tq-mi-patio', tipo: 'galpon', capacidad_litros: 2300, forma: 'cilindro_horizontal', diametro_cm: 150, largo_cm: 130 }

const CASOS = [
  {
    nombre: '1. tanque propio CON capacidad declarada en la tabla',
    tanques: [TANQUE_VEHICULO, PROPIO_CON_CAP],
    tanquesInternos: ['tq-mi-patio'],
    surtidas: [{ id: 's1', fecha: '2026-10-05', cam: 'U01', tanque: 'tq-mi-patio', litros: 400, costo_definido: true, costo_litro_usd: 0.7 }],
    debeDecir: ['2.300', 'no se han medido NI UNA VEZ'],
    noDebeDecir: ['hasta 0 L', 'no se sabe cuánta capacidad'],
  },
  {
    nombre: '2. tanque propio declarado SOLO en la configuración (sin capacidad)',
    tanques: [TANQUE_VEHICULO],
    tanquesInternos: ['mi_patio', 'cisterna_2'],
    surtidas: [
      { id: 's2', fecha: '2026-10-06', cam: 'U01', tanque: 'mi_patio', litros: 900, costo_definido: true, costo_litro_usd: 0.7 },
      { id: 's3', fecha: '2026-10-07', cam: 'U01', tanque: 'cisterna_2', litros: 550, costo_definido: true, costo_litro_usd: 0.7 },
    ],
    debeDecir: ['no se sabe cuánta capacidad', 'no se han medido NI UNA VEZ'],
    noDebeDecir: ['hasta 0 L', '(0 L de capacidad)'],
  },
]

const TIPOS = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml' }
const srv = http.createServer((req, res) => {
  const rel = decodeURIComponent(req.url.split('?')[0]).replace(/^\/+/, '') || 'app.html'
  const f = path.join(RAIZ, rel)
  if (!f.startsWith(RAIZ) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); res.end('no'); return }
  res.writeHead(200, { 'Content-Type': TIPOS[path.extname(f)] || 'application/octet-stream' })
  fs.createReadStream(f).pipe(res)
})
await new Promise(r => srv.listen(0, '127.0.0.1', r))
const BASE = `http://127.0.0.1:${srv.address().port}`
fs.mkdirSync(SALIDA, { recursive: true })

const fallos = []
const ok = (q, m) => { console.log(`   ${q ? '✅' : '⛔'} ${m}`); if (!q) fallos.push(m) }
const navegador = await chromium.launch({ headless: !VER })

// Las tablas que consulta el cargador de la auditoría, en el orden en que las pide.
function respuestas (caso) {
  return {
    combustible_tanques_config: caso.tanques,
    combustible_mediciones: [],
    gasoil: [{ f: '2026-10-01', lit: 1000, m: 700, src: 'Tumaca', tipo_operacion: 'compra', cam: 'COMPRA' }],
    checklist_mecanico: [],
    surtidas: caso.surtidas,
    salidas_tanque: [],
    combustible_periodos: [],
    comb_auditoria_sombra: [],
    unidad_config: [{ cam: 'U01', activo: true, tanque_id: 'tq-u01' }],
  }
}

try {
  for (const caso of CASOS) {
    console.log(`\n${caso.nombre}`)
    const ctx = await navegador.newContext({ viewport: { width: 1480, height: 1200 } })
    const pg = await ctx.newPage()
    const tablas = respuestas(caso)

    // ⛔ EL COMODÍN VA PRIMERO: Playwright da prioridad a la ruta registrada ÚLTIMA.
    await pg.route('**/auth/v1/**', r => r.fulfill({ status: 200, contentType: 'application/json', body: '{}' }))
    await pg.route('**/rest/v1/**', (r) => {
      const u = r.request().url()
      // `configuracion` contesta según la clave pedida: ahí vive `tanques_internos`,
      // que es justo la consulta que el motor NO hacía antes de hoy.
      if (u.includes('/configuracion')) {
        let valor = null
        if (u.includes('tanques_internos')) valor = JSON.stringify(caso.tanquesInternos)
        else if (u.includes('gasoil_precios')) valor = JSON.stringify({ tumaca: 0.83, boscan: 0.78 })
        const body = valor == null ? '[]' : JSON.stringify([{ valor }])
        return r.fulfill({ status: 200, contentType: 'application/json', body })
      }
      const m = /\/rest\/v1\/([a-z_]+)/.exec(u)
      const t = m && tablas[m[1]]
      return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(t || []) })
    })

    await pg.goto(`${BASE}/app.html`, { waitUntil: 'domcontentloaded' })
    await pg.waitForFunction(() => typeof window.sp === 'function', { timeout: 20000 })
    await pg.waitForFunction(() => typeof window.createClient === 'function' || (window.supabase && window.supabase.createClient), { timeout: 20000 })
    await pg.evaluate(() => {
      const crear = window.createClient || (window.supabase && window.supabase.createClient)
      window.supabase = crear(window.SUPA_URL, window.SUPA_KEY, { auth: { persistSession: false } })
      window.DB_READY = true
      window.SESION = { usuario: 'qa', rol: 'superadmin', nombre: 'QA' }
      const lo = document.getElementById('login-overlay'); if (lo) lo.style.display = 'none'
    })
    await pg.evaluate(([d, h]) => {
      try { aplicarPermisos() } catch (e) {}
      // La auditoria del COMBUSTIBLE vive en `aud-combustible`, NO en `auditoria`, que es la de
      // GPS y bitacora. Con la pestana equivocada `#ac-cuerpo` existe igual y las aserciones
      // dan VERDE mientras la captura muestra otra pantalla. Lo destapo la captura, no el test.
      // [[norma-una-pantalla-se-revisa-en-una-pantalla]]
      sp('aud-combustible')
      const a = document.getElementById('ac-desde'); if (a) a.value = d
      const b = document.getElementById('ac-hasta'); if (b) b.value = h
    }, [DESDE, HOY])
    // Se dispara la auditoría por su propio botón/función, no reimplementándola.
    await pg.evaluate(() => { try { acBuscar() } catch (e) { console.log("acBuscar fallo: "+e.message) } })
    await pg.waitForTimeout(2500)

    const txt = await pg.$eval('#ac-cuerpo', e => e.innerText).catch(() => '')
    ok(txt.length > 200, `la pantalla dibujó algo (${txt.length} caracteres)`)
    // La pantalla dibuja el TITULO de la anomalia, no su codigo: se busca lo que la persona lee.
    ok(/no tiene con qué comprobarse/.test(txt), 'la anomalía del tanque propio aparece en la lista')
    ok(/tanques propios|tanque propio/i.test(txt), 'habla de «tanque propio», no solo de «galpón»')
    // Sin distinguir mayúsculas: el énfasis del texto va en MAYÚSCULAS y la frase es la misma.
    const dice = (f) => txt.toLowerCase().includes(f.toLowerCase())
    for (const f of caso.debeDecir) ok(dice(f), `dice «${f}»`)
    for (const f of caso.noDebeDecir) ok(!dice(f), `NO dice «${f}»`)

    const img = path.join(SALIDA, `tanque-propio-${CASOS.indexOf(caso) + 1}.png`)
    await pg.screenshot({ path: img, fullPage: true })
    console.log(`   📷 ${img}`)
    await ctx.close()
  }
} finally {
  await navegador.close()
  srv.close()
}

console.log(fallos.length ? `\n⛔ ${fallos.length} MAL` : '\n✅ TODAS PASAN')
process.exit(fallos.length ? 1 : 0)
