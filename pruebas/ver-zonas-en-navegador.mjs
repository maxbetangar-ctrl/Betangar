// ═══════════════════════════════════════════════════════════════════════════════
// VER LA CAPA DE ZONAS EN UN NAVEGADOR DE VERDAD, sin sesión.
//
// ⛔ Para mirar una pantalla detrás de login NO hace falta una sesión: se
//    INTERCEPTA la API y se le sirven respuestas armadas. El navegador es real y
//    la página es la misma que se despliega.
//    [[verificar-pantalla-en-navegador-sin-sesion]]
//
// Lo que esto SÍ prueba: que la capa se dibuja, que el contorno cae donde debe,
// que la chapa dice la zona y el camión, y que tocar el mapa contesta.
// ⛔ Lo que NO prueba: el RLS, los permisos ni que la RPC exista en producción.
//    Eso se comprueba aparte, contra la base. [[norma-probar-el-camino-no-la-pieza]]
//
// Uso:  node pruebas/ver-zonas-en-navegador.mjs [--puerto 8745]
// ═══════════════════════════════════════════════════════════════════════════════
import fs from 'node:fs'
import http from 'node:http'
import path from 'node:path'
import { getPAT } from '../../maxware-tools/pat.mjs'

const { chromium } = await import(
  'file:///C:/Users/Maxbetangar/AppData/Roaming/npm/node_modules/playwright/index.mjs')

const REF = 'hrkjddehqnzcqwlkklqm'
const PUERTO = Number(process.argv[process.argv.indexOf('--puerto') + 1]) || 8745
// El fondo del mapa. Por defecto el oscuro, que es como vive en el televisor
// de la oficina; pero Maximo lo mira en CLARO desde su maquina y los colores
// de las zonas se eligieron para el oscuro. Hay que poder ver los dos.
const FONDO = process.argv.includes('--fondo')
  ? process.argv[process.argv.indexOf('--fondo') + 1] : 'oscuroCasa'
const RAIZ = path.resolve(path.dirname(new URL(import.meta.url).pathname.slice(1)), '..')

async function sql(q) {
  const pat = await getPAT()
  const r = await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`, {
    method: 'POST', headers: { Authorization: `Bearer ${pat}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: q }),
  })
  if (!r.ok) throw new Error(`SQL ${r.status}: ${(await r.text()).slice(0, 300)}`)
  return r.json()
}

// ── Los datos de verdad, de la base ──────────────────────────────────────────
// ⛔ No se inventan: si se le dan zonas de mentira, lo que se mira no es el
//    producto. Son las mismas filas que va a devolver la RPC en producción.
const ZONAS = (await sql(`select * from zonas_mapa(current_date)`))
const PARR = await sql(`select nombre, es_nuestra, poligono, poligono_zona from parroquias order by nombre`)
// El cronograma DE VERDAD del dia de hoy.
// No se inventa: si se le dan parroquias de mentira, lo que se prueba no es el
// producto. `cronograma_del_dia` no se puede llamar desde aca (exige rol), asi
// que se lee la tabla con el mismo criterio que usa ella.
const CRONO = await sql(`
  select c.tipo, c.parroquia, c.camiones, c.nota
    from cronograma_recoleccion c
   where c.dia_semana = extract(dow from current_date)::int
     and c.vigente_desde = (select max(vigente_desde) from cronograma_recoleccion
                             where dia_semana = extract(dow from current_date)::int)`)
const DEL_DIA = CRONO.filter((c) => c.parroquia).map((c) => c.parroquia)
console.log(`Cronograma de hoy: ${DEL_DIA.map((x) => x.replace('Parroquia ', '')).join(' + ') || '(ninguna)'}`)
console.log(`Traído de la base: ${ZONAS.length} zonas, ${ZONAS.filter(z => z.cam).length} con camión.`)

const tipos = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.png': 'image/png',
  '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.webmanifest': 'application/manifest+json' }
const servidor = http.createServer((req, res) => {
  const f = path.join(RAIZ, decodeURIComponent(req.url.split('?')[0]).replace(/^\/+/, '') || 'mapa.html')
  if (!f.startsWith(RAIZ) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end('no') }
  res.writeHead(200, { 'content-type': tipos[path.extname(f)] || 'application/octet-stream' })
  fs.createReadStream(f).pipe(res)
}).listen(PUERTO)

const navegador = await chromium.launch()
const ctx = await navegador.newContext({ viewport: { width: 1500, height: 950 } })

// ── La API, servida por nosotros ─────────────────────────────────────────────
const sesion = {
  access_token: 'prueba', token_type: 'bearer', expires_in: 3600,
  expires_at: Math.floor(Date.now() / 1000) + 3600, refresh_token: 'prueba',
  user: { id: '00000000-0000-0000-0000-000000000001', email: 'prueba@betangar', role: 'authenticated',
    aud: 'authenticated', app_metadata: {}, user_metadata: {} },
}
await ctx.addInitScript((s) => {
  // ⛔ NO SE FALSIFICA LA SESIÓN EN localStorage. El cliente v2 DECODIFICA el
  //    `access_token` como JWT para sacarle el vencimiento; con un token
  //    inventado lo descarta en silencio, la pantalla muestra la tapa de login
  //    y uno se queda mirando una captura vacía creyendo que la capa no anda.
  //    Se intercepta el CLIENTE: `getSession` contesta lo que queremos.
  try {
    localStorage.setItem('btg_mapa_zona', '1')     // la capa, puesta
    localStorage.setItem('btg-mapa-fondo', s.__fondo)
  } catch (e) {}
  let guardado
  Object.defineProperty(window, 'supabase', {
    configurable: true,
    get() { return guardado },
    set(v) {
      if (v && v.createClient && !v.__parcheado) {
        const orig = v.createClient.bind(v)
        v.createClient = (...a) => {
          const c = orig(...a)
          c.auth.getSession = async () => ({ data: { session: s }, error: null })
          c.auth.getUser = async () => ({ data: { user: s.user }, error: null })
          c.auth.onAuthStateChange = () => ({ data: { subscription: { unsubscribe() {} } } })
          return c
        }
        v.__parcheado = true
      }
      guardado = v
    },
  })
}, Object.assign({ __fondo: FONDO }, sesion))

const p = await ctx.newPage()
const errores = []
p.on('pageerror', (e) => errores.push(String(e)))
p.on('console', (m) => { if (m.type() === 'error') errores.push('console: ' + m.text()) })

await p.route('**/auth/v1/**', (r) => {
  // ⛔ `/token` devuelve una SESIÓN y `/user` devuelve un USUARIO. Con un solo
  //    cuerpo para los dos, el refresco devolvía un usuario, el cliente lo leía
  //    como sesión inválida y volvía a la tapa de login.
  const u = r.request().url()
  const cuerpo = /\/user/.test(u) ? sesion.user : sesion
  return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(cuerpo) })
})

let conCronograma = true
await p.route('**/rest/v1/**', (ruta) => {
  const u = ruta.request().url()
  const dar = (d) => ruta.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(d) })
  if (u.includes('/rpc/zonas_mapa')) return dar(ZONAS)
  if (u.includes('/rpc/zona_en_punto')) {
    // ⛔ Se contesta con la zona de VERDAD del punto pedido, no con una fija:
    //    si se devolviera siempre lo mismo, el popup «anda» aunque esté roto.
    const b = (() => { try { return JSON.parse(ruta.request().postData() || '{}') } catch (e) { return {} } })()
    const z = ZONAS.find((x) => dentro(b.p_lat, b.p_lon, x.anillos))
    return dar(z ? [{ parroquia: z.parroquia, zona: z.zona, color: z.color, cam: z.cam,
      por: 'calle', calle: 'Calle de prueba', a_metros: 12 }] : [])
  }
  if (u.includes('/rpc/app_rol')) return dar('superadmin')
  // El cronograma se sirve o NO segun el caso que se este probando: con el,
  // solo se rotulan las zonas del dia; sin el tienen que salir TODAS, porque
  // esconderlas se veria igual que 'no hay zonas'. Los dos casos se prueban.
  if (u.includes('/rpc/cronograma_del_dia')) return dar(conCronograma ? CRONO : [])
  if (u.includes('/parroquias')) return dar(PARR)
  return dar([])          // lo demás, vacío: no estorba
})

function dentro(la, lo, anillos) {
  let n = 0
  for (const ring of anillos || []) {
    let d = false
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const [ai, oi] = ring[i], [aj, oj] = ring[j]
      if ((oi > lo) !== (oj > lo) && la < (aj - ai) * (lo - oi) / (oj - oi) + ai) d = !d
    }
    if (d) n++
  }
  return n % 2 === 1
}

await p.goto(`http://127.0.0.1:${PUERTO}/mapa.html`, { waitUntil: 'networkidle' })
await p.waitForTimeout(2500)

// ── Acercar, que es como se mira de verdad ──────────────────────────────────
//
// ⛔ Todo el JS de la pantalla vive dentro de un IIFE, así que NO hay `window.mapa`
//    ni ninguna otra variable global que tocar — y la primera medición, que las
//    buscaba en `window`, informaba ceros con la capa perfectamente dibujada.
//    Se maneja como una persona: la rueda del mouse sobre la zona.
const z0 = ZONAS.find((z) => z.parroquia.includes('Olegario') && z.zona === 7) || ZONAS[0]
// ⛔ La chapa ahora lidera con el CAMIÓN («B012» grande, «z7» chico) porque la
//    pregunta es de quién es la zona. Su texto queda como «B012z7».
//    Y OJO: el camión solo NO identifica — el mismo tiene zona en tres
//    parroquias distintas. Por eso después se exige también la parroquia.
const marca = `${String(z0.cam || '').replace(/^JAC-/, '')}z${z0.zona}`
const chapa = () => p.locator('.chapaZona', { hasText: marca }).first()

const acercar = async (n) => {
  for (let i = 0; i < n; i++) {
    const c = await chapa().boundingBox().catch(() => null)
    if (!c) break
    await p.mouse.move(c.x + c.width / 2, c.y + c.height / 2)
    await p.mouse.wheel(0, -400)
    await p.waitForTimeout(450)
  }
  await p.waitForTimeout(800)
}
// Dos alturas, porque contestan cosas distintas: de lejos se ve si las zonas
// se distinguen entre si; de cerca, si el globo dice lo que tiene que decir.
// ⛔ DOS ALTURAS Y LAS DOS SE CAPTURAN. De lejos se contesta «¿esta todo
//    montado?» —las cuatro parroquias con sus 34 zonas— y de cerca «¿el borde
//    cae donde debe?». Una sola captura deja una de las dos sin probar.
await acercar(1)

// ── Lo que se exige ──────────────────────────────────────────────────────────
const medida = await p.evaluate(() => ({
  chapasZona: document.querySelectorAll('.chapaZona').length,
  sinCamion: [...document.querySelectorAll('.chapaZona')]
    .filter((d) => /sin camión/.test(d.textContent || '')).length,
  botonPrendido: !!document.querySelector('#bZona.on'),
  tapa: getComputedStyle(document.getElementById('tapa')).display,
}))
console.log('En pantalla:', medida)
let fallos = 0
// Con el cronograma puesto, solo se rotulan las del dia.
const esperadas = ZONAS.filter((z) => DEL_DIA.includes(z.parroquia)).length
if (medida.chapasZona !== esperadas) {
  console.log(`\u26d4 se esperaban ${esperadas} chapas (las del dia) y hay ${medida.chapasZona}`); fallos++
} else console.log(`\u2705 solo se rotulan las ${esperadas} zonas del dia, de ${ZONAS.length}`)
await p.screenshot({ path: `pruebas/_zonas-lejos-${FONDO}.png` })
await acercar(4)
await p.screenshot({ path: `pruebas/_zonas-mapa-${FONDO}.png` })
await acercar(2)

// ── El camino entero: tocar el mapa y leer la respuesta ─────────────────────
const c = await chapa().boundingBox().catch(() => null)
if (!c) { console.log(`⛔ no se encontró la chapa «${marca}»`); fallos++ }
else {
  await p.mouse.click(c.x + c.width / 2, c.y + c.height / 2)
  await p.waitForTimeout(1000)
  const globo = (await p.textContent('.leaflet-popup-content').catch(() => '')) || ''
  const corto = z0.parroquia.replace(/^Parroquia /, '')
  const faltan = [z0.cam, corto, `zona ${z0.zona}`].filter((x) => !globo.includes(x))
  console.log(`Clic en el centro de la zona ${z0.zona} → «${globo.replace(/\s+/g, ' ').trim().slice(0, 95)}»`)
  if (!faltan.length) console.log(`✅ el globo dice el camión, la parroquia y la zona`)
  else { console.log(`⛔ al globo le falta: ${faltan.join(' · ')}`); fallos++ }
  await p.screenshot({ path: `pruebas/_zonas-clic-${FONDO}.png` })
}
// EL CASO DEL DATO AUSENTE, que es el que se olvida: sin cronograma
// (domingo, o la consulta fallo) tienen que salir LAS 34, no cero.
conCronograma = false
await p.reload({ waitUntil: 'networkidle' })
await p.waitForTimeout(2200)
const sinCrono = await p.evaluate(() => document.querySelectorAll('.chapaZona').length)
if (sinCrono === ZONAS.length) console.log(`\u2705 sin cronograma salen las ${ZONAS.length}, no cero`)
else { console.log(`\u26d4 sin cronograma salieron ${sinCrono} y debian ser ${ZONAS.length}`); fallos++ }

console.log(fallos ? `\n⛔ ${fallos} fallo(s)` : '\n✅ la capa de zonas se dibuja y contesta')
console.log(`capturas: pruebas/_zonas-*-${FONDO}.png`)
if (errores.length) console.log('⛔ errores:\n  ' + errores.slice(0, 6).join('\n  '))
else console.log('✅ sin errores de JS')

await navegador.close()
servidor.close()
