// ═══════════════════════════════════════════════════════════════════════════════
// VER EL RECORTE «SOLO LO LIMPIADO» — EN UN NAVEGADOR
//
// QUÉ PROBLEMA VIGILA (23/10/2026, segunda foto del televisor). Los recorridos se
// estiraban desde Maracaibo hasta el VERTEDERO DE LA CONCEPCIÓN, ~25 km al
// suroeste. Ese tramo es acarreo por carretera, no limpieza, y es lo que abría el
// mapa y dejaba la zona de trabajo chiquita en una esquina. Pedido textual: «no
// me interesa ver las idas al vertedero sino las rutas que limpió más de cerca
// exclusivamente».
//
// Qué revisa:
//   1. El tramo dentro de la parroquia se dibuja.
//   2. ⛔ LA QUE DECIDE: el viaje al vertedero NO se dibuja.
//   3. ⛔ Y NO SE UNE LO DE ANTES CON LO DE DESPUÉS: si el camión sale y vuelve,
//      tienen que quedar DOS tramos, no una recta por una carretera que nunca
//      recorrió limpiando. Una recta inventada es peor que un hueco.
//   4. Apagado, se dibuja todo: el dato no se perdió, solo no se mostraba.
//   5. Sin parroquias cargadas NO se recorta — si no, al arrancar se vería el
//      mapa vacío y parecería que los camiones no salieron.
//   6. La caja envolvente descarta sin mirar el polígono, que es lo que hace
//      viable el recorte con 4.000 posiciones en cada repaso.
//
// Corre el código REAL de mapa.html, quitándole solo la IIFE.
// ═══════════════════════════════════════════════════════════════════════════════
import { pathToFileURL } from 'url'
import fs from 'fs'
import path from 'path'

const html = fs.readFileSync(path.resolve('mapa.html'), 'utf8')
const morir = m => { console.error('⛔ ' + m + '\n   La prueba NO corrió.'); process.exit(2) }
const mEstilo = html.match(/<style>([\s\S]*?)<\/style>/); if (!mEstilo) morir('sin <style>')
const bloques = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m => m[1])
let codigo = bloques[bloques.length - 1]
if (!codigo || !/\(function\(\)\{/.test(codigo)) morir('no se encontró el script propio')
codigo = codigo.replace(/^\s*\(function\(\)\{/, '').replace(/\}\)\(\);\s*$/, '')
if (!/arrancar\(\);/.test(codigo)) morir('no se encontró arrancar();')
codigo = codigo.replace(/\n\s*arrancar\(\);/, '\n/* neutralizado */')
for (const q of ['function soloLimpiado', 'function cajasNuestras', 'function enAlgunaParroquia'])
  if (!codigo.includes(q)) morir('no se encontró ' + q + '() en mapa.html')
// ⛔ Y que el recorte esté ENCHUFADO. Una función perfecta que nadie llama se ve
//    exactamente igual que un arreglo que funciona.
if (!/tramos\.medidos\s*=\s*soloLimpiado\(/.test(codigo))
  morir('soloLimpiado() existe pero NO se aplica a los tramos que se dibujan')

let pw
try { pw = await import('playwright') }
catch { pw = await import(pathToFileURL('C:/Users/Maxbetangar/AppData/Roaming/npm/node_modules/playwright/index.js').href) }
const chromium = pw.chromium || (pw.default && pw.default.chromium)
if (!chromium) morir('falta Playwright global')

const nav = await chromium.launch()
const pag = await (await nav.newContext()).newPage()
const errores = []
pag.on('pageerror', e => errores.push(String(e.message).slice(0, 200)))

const lab = `<!doctype html><html><head><style>${mEstilo[1]}</style></head><body>
<div id="tapa" style="display:none"><div class="caja"><p id="tapaTxt"></p><button id="tapaBtn"></button></div></div>
<div id="crono"></div><div id="lista"></div><div id="avisos"></div><div id="sello"></div>
<div id="vivo"><span id="vivoTxt"></span></div>
<input id="selDia"><button id="bHoy"></button><button id="bDen"></button><button id="bDenOk"></button>
<button id="bDenUndo"></button><button id="bRec"></button><button id="bSurt"></button><button id="bParr"></button>
<button id="bLimp"></button>
<button id="bFalta"></button><button id="bSitio"></button><button id="bCerrar"></button><button id="bDeshacer"></button>
<button id="bClave"></button><button id="bTv"></button><button id="bPleno"></button><span id="verSello"></span>
<a id="sNo"></a><button id="sOk"></button><a id="eNo"></a><button id="eOk"></button>
<button id="eRedib"></button><a id="eOff"></a>
<div id="mapa"></div><select id="selFondo"></select><input id="brillo" type="range">
<script>
  var cap = function(){ var o = {
    addTo:function(){return o}, on:function(){return o}, off:function(){return o},
    setLatLng:function(){return o}, setLatLngs:function(){return o},
    setStyle:function(){return o}, setOpacity:function(){return o},
    bindTooltip:function(){return o}, remove:function(){return o},
    getLatLng:function(){return {lat:10.66, lng:-71.63}} }; return o; };
  window.L = { map:function(){ return { setView:function(){return this}, on:function(){}, off:function(){},
      getContainer:function(){return document.body}, removeLayer:function(){}, getZoom:function(){return 15},
      addLayer:function(){}, createPane:function(){}, getPane:function(){ return { style:{} } },
      fitBounds:function(){} }; },
    tileLayer:function(){ return { addTo:function(){} }; },
    circle:cap, marker:cap, polyline:cap, polygon:cap,
    divIcon:function(){ return {}; }, DomEvent:{ stop:function(){} } };
  window.supabase = { createClient:function(){ return {
      rpc:function(){ return Promise.resolve({data:[],error:null}); },
      from:function(){ return { select:function(){ return { order:function(){ return Promise.resolve({data:[],error:null}); },
          not:function(){ return this }, eq:function(){ return this }, limit:function(){ return Promise.resolve({data:[],error:null}); } }; } }; },
      auth:{ getSession:function(){ return Promise.resolve({data:{session:null}}); },
             onAuthStateChange:function(){}, signInWithPassword:function(){} },
      channel:function(){ return { on:function(){ return this; }, subscribe:function(){} }; } }; } };
<\/script>
<script>${codigo.replace(/<\/script>/g, '<\\/script>')}<\/script>
</body></html>`

await pag.setContent(lab, { waitUntil: 'load' })

const r = await pag.evaluate(() => {
  const out = {}
  // Caracciolo, chiquita de verdad; y el vertedero de La Concepción, lejos.
  const CARACCIOLO = [[10.650, -71.640], [10.650, -71.610], [10.678, -71.610], [10.678, -71.640]]
  PARROQUIAS = [{ nombre: 'Parroquia Caracciolo Parra Pérez', es_nuestra: true, poligono: CARACCIOLO }]
  CAJAS_PARR = null

  // Un recorrido con la forma real: limpia, se va al vertedero, vuelve y limpia.
  const limpiaA = [[10.655, -71.635], [10.657, -71.633], [10.659, -71.631]]
  const alVert  = [[10.600, -71.700], [10.520, -71.790], [10.480, -71.840]]
  const limpiaB = [[10.665, -71.625], [10.667, -71.623], [10.669, -71.621]]
  const entero  = [limpiaA.concat(alVert).concat(limpiaB)]

  SOLO_LIMP = true
  const cort = soloLimpiado(entero)
  out.tramos = cort.length
  out.puntos = cort.reduce((a, t) => a + t.length, 0)
  out.hayVertedero = cort.some(t => t.some(p => p[1] < -71.68))

  SOLO_LIMP = false
  out.apagadoPuntos = soloLimpiado(entero).reduce((a, t) => a + t.length, 0)

  // Sin parroquias: no se recorta (si no, al arrancar el mapa se ve vacío).
  SOLO_LIMP = true; PARROQUIAS = []; CAJAS_PARR = null
  out.sinParrPuntos = soloLimpiado(entero).reduce((a, t) => a + t.length, 0)

  // La caja descarta sin mirar el polígono.
  PARROQUIAS = [{ nombre: 'Parroquia Caracciolo Parra Pérez', es_nuestra: true, poligono: CARACCIOLO }]
  CAJAS_PARR = null
  const cajas = cajasNuestras()
  out.caja = cajas && cajas[0] ? { n: cajas[0].n, s: cajas[0].s, o: cajas[0].o, e: cajas[0].e } : null
  out.dentro = enAlgunaParroquia(10.66, -71.63, cajas)
  out.fuera = enAlgunaParroquia(10.48, -71.84, cajas)

  // El botón dice lo que se está VIENDO, no lo que haría al tocarlo.
  SOLO_LIMP = true;  pintarBotonLimpiado(); out.rotuloOn  = document.getElementById('bLimp').textContent
  SOLO_LIMP = false; pintarBotonLimpiado(); out.rotuloOff = document.getElementById('bLimp').textContent
  return out
})

const fallos = []
const exige = (ok, q) => { if (!ok) fallos.push(q) }
exige(!r.hayVertedero, '⛔ EL VIAJE AL VERTEDERO SE SIGUE DIBUJANDO: es lo que abre el mapa')
exige(r.puntos === 6, `se dibujaron ${r.puntos} puntos, se esperaban los 6 de limpieza`)
exige(r.tramos === 2,
  `⛔ quedaron ${r.tramos} tramo(s): salir y volver tiene que dar DOS, o se dibuja una recta `
  + 'por una carretera que nunca recorrió limpiando')
exige(r.apagadoPuntos === 9, `apagado debería dibujar los 9 puntos, dibujó ${r.apagadoPuntos}`)
exige(r.sinParrPuntos === 9,
  '⛔ sin parroquias cargadas RECORTA: al arrancar el mapa se vería vacío y parecería que los '
  + 'camiones no salieron')
exige(r.caja && r.caja.n === 10.678 && r.caja.s === 10.650, 'la caja envolvente está mal: ' + JSON.stringify(r.caja))
exige(r.dentro === true, 'un punto dentro de la parroquia dio FUERA')
exige(r.fuera === false, 'el vertedero dio DENTRO de la parroquia')
exige(/Solo lo limpiado/.test(r.rotuloOn) && /Todo el recorrido/.test(r.rotuloOff),
  `el botón no dice lo que se ve: "${r.rotuloOn}" / "${r.rotuloOff}"`)
exige(errores.length === 0, 'errores de JS: ' + errores.join(' · '))

console.log('\n── EL RECORTE ──')
console.log('encendido: ' + r.tramos + ' tramo(s), ' + r.puntos + ' puntos · ¿se coló el vertedero? '
  + (r.hayVertedero ? 'SÍ ⛔' : 'no'))
console.log('apagado  : ' + r.apagadoPuntos + ' puntos (el recorrido entero)')
console.log('sin parr.: ' + r.sinParrPuntos + ' puntos (no recorta, correcto)')
console.log('botón    : ' + r.rotuloOn + '  /  ' + r.rotuloOff)
if (fallos.length) { console.log(`\n⛔ ${fallos.length} falla(s):`); fallos.forEach(f => console.log('   · ' + f)) }
else console.log('\n✅ Se dibuja solo lo limpiado, el vertedero queda afuera y no se inventa ninguna recta.')
await nav.close()
process.exit(fallos.length ? 1 : 0)
