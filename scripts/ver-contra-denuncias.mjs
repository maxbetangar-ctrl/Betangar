// ═══════════════════════════════════════════════════════════════════════════════
// VER EL BOTÓN «¿PASAMOS POR AQUÍ?» — EN UN NAVEGADOR
//
// Qué revisa:
//   1. Con jornadas: el titular dice cuántas y cuál fue la más reciente, y la
//      tabla sale con fecha, horario, unidades y distancia.
//   2. ⛔ SIN jornadas: dice que NO hay paso comprobado. Un panel vacío se leería
//      como «no se pudo consultar», que es lo contrario.
//   3. ⛔ EL RESUMEN QUE SE COPIA LLEVA SIEMPRE LA SALVEDAD de los días que no se
//      pueden afirmar — también cuando conviene callarla. Un resumen que solo
//      cuenta lo bueno se cae el primer día que lo revisen.
//   4. ⛔ QUE LOS BOTONES DE RADIO Y DÍAS QUEDEN VIVOS. Todo el archivo vive en
//      una IIFE: un `onclick="..."` en el HTML no encontraría la función y el
//      botón quedaría muerto SIN dar ningún error. Acá se comprueba que cada
//      botón tenga su manejador enganchado de verdad.
//
// Cómo: se toma el `<script>` del propio `mapa.html` y se le quita SOLO la
// envoltura `(function(){ … })();` y la llamada final a `arrancar()`. O sea que
// lo que corre es el código del archivo, no una copia. La red no se toca.
//
// Uso: node scripts/ver-contra-denuncias.mjs
// ═══════════════════════════════════════════════════════════════════════════════
import { pathToFileURL } from 'url'
import fs from 'fs'
import path from 'path'

const ARCHIVO = path.resolve('mapa.html')
const GLOBAL = 'C:/Users/Maxbetangar/AppData/Roaming/npm/node_modules/playwright/index.js'
const html = fs.readFileSync(ARCHIVO, 'utf8')

function morir(m) { console.error('⛔ ' + m + '\n   La prueba NO corrió.'); process.exit(2) }

const mEstilo = html.match(/<style>([\s\S]*?)<\/style>/)
if (!mEstilo) morir('no se encontró el <style> de mapa.html')

// El último <script> sin src es el propio de la pantalla.
const bloques = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m => m[1])
const propio = bloques[bloques.length - 1]
if (!propio || !/\(function\(\)\{/.test(propio)) morir('no se encontró el script propio envuelto en IIFE')

// Se le quita la envoltura y la llamada de arranque: queremos las funciones, no que corra.
let codigo = propio.replace(/^\s*\(function\(\)\{/, '').replace(/\}\)\(\);\s*$/, '')
if (!/arrancar\(\);/.test(codigo)) morir('no se encontró la llamada `arrancar();` que hay que neutralizar')
codigo = codigo.replace(/\n\s*arrancar\(\);/, '\n/* arrancar() neutralizado por la prueba */')
for (const f of ['function pintarPanelDenuncia', 'function textoResumenDen', 'function modoDenuncia']) {
  if (!codigo.includes(f)) morir(`no se encontró ${f} en mapa.html`)
}

let pw
try { pw = await import('playwright') } catch { pw = await import(pathToFileURL(GLOBAL).href) }
const chromium = pw.chromium || (pw.default && pw.default.chromium)
if (!chromium) morir('falta Playwright global: npm i -g playwright && npx playwright install chromium')

const nav = await chromium.launch()
const pag = await (await nav.newContext()).newPage()
const errores = []
pag.on('pageerror', e => errores.push(String(e.message).slice(0, 200)))

await pag.setContent(`<!doctype html><html><head><style>${mEstilo[1]}</style></head><body>
<div id="tapa" style="display:none"><div class="caja"><p id="tapaTxt"></p><button id="tapaBtn"></button></div></div>
<div id="lista"></div><div id="avisos"></div><div id="sello"></div><div id="vivo"><span id="vivoTxt"></span></div>
<input id="selDia"><button id="bHoy"></button><button id="bDen"></button><button id="bRec"></button><button id="bLimp"></button>
<button id="bSurt"></button><button id="bSitio"></button><button id="bCerrar"></button><button id="bDeshacer"></button>
<button id="bClave"></button><span id="verSello"></span>
<button id="bTv"></button><button id="bPleno"></button>
<a id="sNo"></a><button id="sOk"></button><a id="eNo"></a><button id="eOk"></button>
<button id="eRedib"></button><a id="eOff"></a>
<script>
  // Lo mínimo para que el archivo cargue sin red ni mapa: no se prueba nada de esto.
  window.L = { map:function(){ return { setView:function(){return this}, on:function(){}, off:function(){},
      getContainer:function(){return document.body}, removeLayer:function(){}, getZoom:function(){return 15},
      addLayer:function(){}, fitBounds:function(){} }; },
    tileLayer:function(){ return { addTo:function(){} }; },
    circle:function(){ return { addTo:function(){ return this; } }; },
    marker:function(){ return { addTo:function(){ return this; }, on:function(){} }; },
    divIcon:function(){ return {}; }, polyline:function(){ return { addTo:function(){ return this; } }; },
    DomEvent:{ stop:function(){} } };
  window.supabase = { createClient:function(){ return {
      rpc:function(){ return Promise.resolve({data:[],error:null}); },
      from:function(){ return { select:function(){ return Promise.resolve({data:[],error:null}); } }; },
      auth:{ getSession:function(){ return Promise.resolve({data:{session:null}}); },
             onAuthStateChange:function(){}, signInWithPassword:function(){} },
      channel:function(){ return { on:function(){ return this; }, subscribe:function(){} }; } }; } };
<\/script>
<script>${codigo.replace(/<\/script>/g, '<\\/script>')}<\/script>
</body></html>`, { waitUntil: 'load' })

const CON = [
  { f:'2026-10-19', estado:'pasó', unidades:'JAC-B001, JAC-B005', pasadas:58, primera:'06:28', ultima:'15:30', dist_min_m:32, hueco_max_min:9 },
  { f:'2026-10-15', estado:'pasó', unidades:'JAC-B003', pasadas:47, primera:'06:11', ultima:'16:27', dist_min_m:13, hueco_max_min:7 },
  { f:'2026-10-14', estado:'NO pasó', unidades:'—', pasadas:0, primera:null, ultima:null, dist_min_m:null, hueco_max_min:6 },
  { f:'2026-10-13', estado:'no se puede afirmar', unidades:'—', pasadas:0, primera:null, ultima:null, dist_min_m:null, hueco_max_min:41 },
]
const SIN = CON.filter(f => f.estado !== 'pasó')

const r = await pag.evaluate(([con, sin]) => {
  const out = {}
  DIA = '2026-10-22'   // en la pantalla real lo pone `arrancarVista`
  DEN.lat = 10.67038; DEN.lon = -71.60379; DEN.radio = 100; DEN.dias = 30

  pintarPanelDenuncia(con)
  const caja = document.querySelector('#tapa .caja')
  out.conHTML = caja.innerText
  out.filas = caja.querySelectorAll('table tr').length
  // ¿Los botones quedaron vivos? Se mira que tengan manejador, no que existan.
  const rads = [...caja.querySelectorAll('[data-den-radio]')]
  const dias = [...caja.querySelectorAll('[data-den-dias]')]
  out.radios = rads.length
  out.radiosVivos = rads.filter(b => typeof b.onclick === 'function').length
  out.diasVivos = dias.filter(b => typeof b.onclick === 'function').length
  out.cerrarVivo = typeof caja.querySelector('#denCerrar')?.onclick === 'function'
  out.copiarVivo = typeof caja.querySelector('#denCopiar')?.onclick === 'function'
  out.textoCon = textoResumenDen(con.filter(f => f.estado === 'pasó'), con)

  pintarPanelDenuncia(sin)
  out.sinHTML = document.querySelector('#tapa .caja').innerText

  // Un período donde TODO fue «pasó»: la salvedad igual tiene que ir.
  const todoBien = con.filter(f => f.estado === 'pasó')
  out.textoTodoBien = textoResumenDen(todoBien, todoBien)
  out.fechaMenos = fechaMenos(30)

  // MODO ZONA. Con 3 esquinas la pregunta es otra: entro o no entro. El radio
  // deja de tener sentido y NO puede seguir ofreciendose.
  DEN.vertices = [[10.6695,-71.6045],[10.6695,-71.5995],[10.6750,-71.5995]]
  out.esZona3 = denEsZona()
  pintarPanelDenuncia(con)
  const c2 = document.querySelector('#tapa .caja')
  out.zonaHTML = c2.innerText
  out.zonaRadios = c2.querySelectorAll('[data-den-radio]').length
  out.zonaDiasVivos = [...c2.querySelectorAll('[data-den-dias]')]
    .filter(b => typeof b.onclick === 'function').length
  out.textoZona = textoResumenDen(con.filter(f => f.estado === 'pasó'), con)
  // Con 2 esquinas todavia NO es zona: la base exige 3.
  DEN.vertices = [[10.6695,-71.6045],[10.6695,-71.5995]]
  out.esZona2 = denEsZona()
  DEN.vertices = []
  return out
}, [CON, SIN])

const fallos = []
const exige = (ok, q) => { if (!ok) fallos.push(q) }

exige(/2 jornadas/.test(r.conHTML), 'no dice cuántas jornadas')
exige(/19\/10|19-10|19 de octubre/.test(r.conHTML), 'no nombra la jornada más reciente')
exige(r.filas >= 3, `la tabla salió con ${r.filas} filas`)
exige(/no se puede afirmar/.test(r.conHTML), 'no muestra la salvedad de los días dudosos')
exige(/No hay ninguna jornada con paso comprobado/.test(r.sinHTML), 'sin jornadas: no lo dice')
exige(r.radios === 4 && r.radiosVivos === 4, `botones de radio vivos: ${r.radiosVivos}/${r.radios}`)
exige(r.diasVivos === 3, `botones de días vivos: ${r.diasVivos}/3`)
exige(r.cerrarVivo, 'el botón Cerrar quedó muerto')
exige(r.copiarVivo, 'el botón Copiar quedó muerto')
exige(/no puede afirmarse/.test(r.textoCon), 'el texto copiado no lleva la salvedad')
exige(/no puede afirmarse/.test(r.textoTodoBien), '⛔ con todo en verde, el texto copiado OMITE la salvedad')
exige(/^\d{4}-\d{2}-\d{2}$/.test(r.fechaMenos), `fechaMenos devolvió ${r.fechaMenos}`)
exige(r.esZona3 === true, 'con 3 esquinas no se considera zona')
exige(r.esZona2 === false, 'con 2 esquinas ya se considera zona (la base exige 3)')
exige(/Zona dibujada de .*3 esquinas/.test(r.zonaHTML), 'la zona no se anuncia en el panel')
exige(r.zonaRadios === 0, `sobre una zona se siguen ofreciendo ${r.zonaRadios} botones de radio`)
exige(r.zonaDiasVivos === 3, `en modo zona los botones de dias quedaron ${r.zonaDiasVivos}/3`)
exige(/poligono de 3 vertices|pol.gono de 3 v.rtices/.test(r.textoZona), 'el texto copiado no describe la zona')
exige(r.textoZona.indexOf('10.66950,-71.60450') >= 0, 'el texto copiado no lleva los vertices')
exige(r.textoZona.indexOf('radio de') < 0, 'el texto copiado de una zona habla de un radio que no existe')
exige(errores.length === 0, 'errores de JS: ' + errores.join(' · '))

console.log('\n── EL PANEL, CON JORNADAS ──\n' + r.conHTML.trim())
console.log('\n── EL PANEL, SIN JORNADAS ──\n' + r.sinHTML.trim().split('\n').slice(0, 3).join('\n'))
console.log('\n── EL TEXTO QUE SE COPIA ──\n' + r.textoCon.trim())

if (fallos.length) { console.log(`\n⛔ ${fallos.length} falla(s):`); fallos.forEach(f => console.log('   · ' + f)) }
else console.log('\n✅ Los dos estados salen bien, los 7 botones quedaron vivos, y el resumen lleva la salvedad SIEMPRE.')

await nav.close()
process.exit(fallos.length ? 1 : 0)
