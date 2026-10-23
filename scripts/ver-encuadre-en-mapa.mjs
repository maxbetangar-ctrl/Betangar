// ═══════════════════════════════════════════════════════════════════════════════
// VER CÓMO ENCUADRA EL MAPA — EN UN NAVEGADOR
//
// QUÉ PROBLEMA VIGILA (23/10/2026, Máximo con una foto del televisor). El mapa se
// abría con `fitBounds` sobre TODAS las posiciones del día. Basta que una unidad
// suba a Mojón o Sinamaica —pasa, hay viajes largos— para que el encuadre se abra
// 80 km: en la foto, las cuatro parroquias quedaron apretadas en una esquina y
// medio cortadas, y el 80% del televisor era lago y campo donde no se recoge.
//
// El sujeto de esta pantalla es LA ZONA QUE SE TRABAJA HOY, no el camión que más
// se alejó. Pedido textual: «debe ampliarse y verse las parroquias que se están
// trabajando ese día, de manera que se vea completa pero lo más cerca posible».
//
// Qué revisa:
//   1. Con parroquias del día: encuadra ESAS, no los camiones.
//   2. ⛔ LA QUE DECIDE: un camión a 80 km NO abre el encuadre. Es el bug exacto.
//   3. La parroquia entra COMPLETA (el encuadre la contiene, no la recorta).
//   4. Domingo / sin cronograma: vuelve al encuadre por posiciones, no deja el
//      mapa sin encuadrar.
//   5. Solo la PRIMERA vez: si no, cada repaso te arrastra el mapa y no se puede
//      mirar nada de cerca.
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
for (const q of ['function encuadrar', 'function cajaDelDia'])
  if (!codigo.includes(q)) morir('no se encontró ' + q + '() en mapa.html')
// ⛔ Y que NADIE encuadre POR FUERA de `encuadrar()`. No importa cuántas llamadas
//    a `fitBounds` haya —hay varias ramas— sino que TODAS vivan adentro: si una
//    queda suelta, esta prueba mide una mitad y la otra hace lo que quiere.
const iEnc = codigo.indexOf('function encuadrar(')
const finEnc = codigo.indexOf('\nfunction ', iEnc + 10)
const dentro = [...codigo.slice(iEnc, finEnc).matchAll(/mapa\.fitBounds\(/g)].length
const total  = [...codigo.matchAll(/mapa\.fitBounds\(/g)].length
if (total !== dentro) morir(`${total - dentro} llamada(s) a mapa.fitBounds() FUERA de encuadrar(). `
  + 'El encuadre tiene que pasar por un solo lugar.')
if (!dentro) morir('encuadrar() no llama a fitBounds: la prueba no mediría nada')

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
<button id="bDenUndo"></button><button id="bRec"></button><button id="bSurt"></button><button id="bParr"></button><button id="bLimp"></button>
<button id="bFalta"></button><button id="bSitio"></button><button id="bCerrar"></button><button id="bDeshacer"></button>
<button id="bClave"></button><button id="bTv"></button><button id="bPleno"></button><span id="verSello"></span>
<a id="sNo"></a><button id="sOk"></button><a id="eNo"></a><button id="eOk"></button>
<button id="eRedib"></button><a id="eOff"></a>
<div id="mapa"></div><select id="selFondo"></select><input id="brillo" type="range">
<script>
  window.__fit = [];   // el espía: qué se le pidió encuadrar y con qué margen
  var cap = function(){ var o = {
    addTo:function(){return o}, on:function(){return o}, off:function(){return o},
    setLatLng:function(){return o}, setLatLngs:function(){return o},
    setStyle:function(){return o}, setOpacity:function(){return o},
    bindTooltip:function(){return o}, remove:function(){return o},
    getLatLng:function(){return {lat:10.66, lng:-71.63}} }; return o; };
  window.L = { map:function(){ return { setView:function(){return this}, on:function(){}, off:function(){},
      getContainer:function(){return document.body}, removeLayer:function(){}, getZoom:function(){return 15},
      addLayer:function(){}, createPane:function(){}, getPane:function(){ return { style:{} } },
      fitBounds:function(b, o){ window.__fit.push({ puntos:b, opc:o }); } }; },
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
  mapa = L.map('mapa', {})
  const out = {}

  // Una parroquia chica y realista: Caracciolo, ~3 km de lado.
  const CARACCIOLO = [[10.650, -71.640], [10.650, -71.610], [10.678, -71.610], [10.678, -71.640]]
  // Y otra que NO toca hoy: si entrara, el encuadre se abriría de más.
  const VENANCIO   = [[10.700, -71.700], [10.700, -71.670], [10.730, -71.670], [10.730, -71.700]]

  PARROQUIAS = [
    { nombre: 'Parroquia Caracciolo Parra Pérez', es_nuestra: true, poligono: CARACCIOLO },
    { nombre: 'Parroquia Venancio Pulgar',        es_nuestra: true, poligono: VENANCIO }
  ]
  DIA = fechaVE(new Date())
  CRONO = [{ f: DIA, dia: 'viernes', tipo: 'parroquia',
             parroquia: 'Parroquia Caracciolo Parra Pérez', camiones: 12, nota: null }]

  // ⛔ EL CAMIÓN LEJOS: Sinamaica, ~80 km al norte. Es el caso de la foto.
  const bordes = [[10.660, -71.630], [11.350, -71.850]]

  // 1 y 2. Con parroquia del día: encuadra la parroquia, no el camión lejano.
  primeraVez = true; LIM_PARR = null; window.__fit = []
  encuadrar(bordes)
  out.conZona = window.__fit.slice()

  // 5. Segunda llamada: no puede volver a mover el mapa.
  encuadrar(bordes)
  out.repetido = window.__fit.length

  // 4. Domingo: sin parroquia asignada, vuelve a las posiciones.
  primeraVez = true; LIM_PARR = null; window.__fit = []
  CRONO = [{ f: DIA, dia: 'domingo', tipo: 'operativo_imau', parroquia: null, camiones: null,
             nota: 'Lo define el IMAU.' }]
  encuadrar(bordes)
  out.domingo = window.__fit.slice()

  // ⛔ 6. LAS PARROQUIAS TODAVIA NO CARGARON. Es el arranque real: `repaso()`
  //    pinta antes de que lleguen. Si acá se diera el encuadre por hecho, el
  //    mapa quedaria abierto hasta Sinamaica PARA SIEMPRE.
  primeraVez = true; LIM_PARR = null; window.__fit = []
  const guardadas = PARROQUIAS
  PARROQUIAS = []
  CRONO = [{ f: DIA, dia: 'viernes', tipo: 'parroquia',
             parroquia: 'Parroquia Caracciolo Parra Pérez', camiones: 12, nota: null }]
  encuadrar(bordes)
  out.sinCargar = { fits: window.__fit.length, sigueAbierto: primeraVez }
  // Y en cuanto llegan, el encuadre bueno TIENE que poder corregirlo.
  PARROQUIAS = guardadas
  LIM_PARR = null
  encuadrar(bordes)
  out.alLlegar = window.__fit.slice(-1)

  // Y sin cronograma NI posiciones: no se encuadra nada, pero tampoco revienta.
  primeraVez = true; LIM_PARR = null; window.__fit = []
  CRONO = []
  encuadrar([])
  out.sinNada = window.__fit.length

  return out
})

const fallos = []
const exige = (ok, q) => { if (!ok) fallos.push(q) }

exige(r.conZona.length === 1, `con parroquia del día encuadró ${r.conZona.length} veces, se esperaba 1`)
const pts = (r.conZona[0] && r.conZona[0].puntos) || []
const lats = pts.map(p => p[0]), lons = pts.map(p => p[1])
const norte = Math.max(...lats), sur = Math.min(...lats)
const oeste = Math.min(...lons), este = Math.max(...lons)

// ⛔ LA QUE DECIDE. Si el camión de Sinamaica (11.350) entró, el encuadre se abrió
//    80 km y estamos otra vez en la foto del televisor.
exige(norte < 10.70,
  `⛔ EL CAMIÓN LEJANO ABRIÓ EL ENCUADRE: el borde norte quedó en ${norte}, y la parroquia `
  + 'termina en 10.678. Es exactamente el defecto de la foto del televisor.')
exige(!pts.some(p => p[0] > 11), '⛔ el encuadre incluye una posición de otra punta del estado')

// 3. La parroquia tiene que entrar ENTERA.
exige(norte >= 10.678 && sur <= 10.650 && oeste <= -71.640 && este >= -71.610,
  `la parroquia del día NO entra completa en el encuadre: N${norte} S${sur} O${oeste} E${este}`)
// Y no puede traerse la parroquia que hoy no toca.
exige(oeste > -71.70,
  `el encuadre se llevó una parroquia que hoy no toca (borde oeste ${oeste}, Venancio está en -71.70)`)
// «Lo más cerca posible»: margen chico, y sin tope de acercamiento.
const opc = (r.conZona[0] && r.conZona[0].opc) || {}
exige((opc.padding || [99, 99])[0] <= 30, `el margen es ${JSON.stringify(opc.padding)}: se pidió lo más cerca posible`)
exige(opc.maxZoom === undefined,
  `hay un tope de acercamiento (maxZoom ${opc.maxZoom}) que impide acercarse todo lo que se pueda`)

exige(r.repetido === 1, '⛔ encuadra en cada repaso: te arrastraría el mapa mientras lo mirás')
exige(r.domingo.length === 1, 'el domingo no encuadró nada: la pantalla queda donde cayó')
exige(r.domingo.length === 1 && r.domingo[0].puntos.some(p => p[0] > 11),
  'el domingo no usó las posiciones de reserva')
exige(r.sinNada === 0, 'sin cronograma y sin posiciones inventó un encuadre')
// ⛔ LA OTRA QUE DECIDE: el arranque real pinta antes de tener las parroquias.
exige(r.sinCargar.sigueAbierto === true,
  '⛔ CON LAS PARROQUIAS SIN CARGAR EL ENCUADRE SE DA POR HECHO: el mapa queda abierto hasta '
  + 'el camión más lejano para siempre, porque el encuadre bueno ya no puede corregirlo')
const tras = (r.alLlegar[0] || {}).puntos || []
exige(tras.length > 0 && !tras.some(p => p[0] > 11),
  '⛔ cuando las parroquias llegan, el encuadre no se corrige a la zona del día')
exige(errores.length === 0, 'errores de JS: ' + errores.join(' · '))

console.log('\n── EL ENCUADRE ──')
console.log('con parroquia del día : N' + norte + ' S' + sur + ' O' + oeste + ' E' + este
  + '  (la parroquia es N10.678 S10.65 O-71.64 E-71.61)')
console.log('margen                : ' + JSON.stringify(opc))
console.log('domingo (reserva)     : ' + (r.domingo[0] ? JSON.stringify(r.domingo[0].puntos) : '—'))
if (fallos.length) { console.log(`\n⛔ ${fallos.length} falla(s):`); fallos.forEach(f => console.log('   · ' + f)) }
else console.log('\n✅ Encuadra la parroquia del día entera y de cerca; el camión a 80 km ya no abre el mapa.')
await nav.close()
process.exit(fallos.length ? 1 : 0)
