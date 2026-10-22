// ═══════════════════════════════════════════════════════════════════════════════
// VER LA CAPA DE PARROQUIAS — EN UN NAVEGADOR
//
// Qué revisa, y por qué cada cosa:
//   1. ⛔ QUE NO TAPEN LOS CAMIONES. Van a un panel propio (`pane:'parroquias'`)
//      con z-index MENOR que el de los recorridos. Si una sola se dibujara sin
//      ese panel, la mancha de color quedaría encima de la ruta y escondería
//      justo lo que hay que leer. Esto no se ve en una captura: se comprueba
//      mirando con qué opciones se dibuja cada polígono.
//   2. ⛔ QUE NO ROBEN EL CLIC (`interactive:false`). Si lo robaran, el botón
//      «¿Pasamos por aquí?» dejaría de poder marcar un punto sobre una
//      parroquia — o sea, sobre toda la ciudad.
//   3. Las CUATRO de Betangar: color propio, borde más marcado y su nombre.
//      Las otras: grises, punteadas y SIN etiqueta (18 nombres son ruido).
//   4. El interruptor apaga y prende, y no deja capas colgadas.
//
// Cómo: se corre el código REAL de `mapa.html` (se le quita solo la envoltura
// IIFE y la llamada a `arrancar()`), con un Leaflet de mentira que ANOTA con qué
// opciones se le pidió cada dibujo. La red no se toca.
//
// Uso: node scripts/ver-parroquias-en-mapa.mjs
// ═══════════════════════════════════════════════════════════════════════════════
import { pathToFileURL } from 'url'
import fs from 'fs'
import path from 'path'

const ARCHIVO = path.resolve('mapa.html')
const GLOBAL = 'C:/Users/Maxbetangar/AppData/Roaming/npm/node_modules/playwright/index.js'
const html = fs.readFileSync(ARCHIVO, 'utf8')
function morir(m) { console.error('⛔ ' + m + '\n   La prueba NO corrió.'); process.exit(2) }

const mEstilo = html.match(/<style>([\s\S]*?)<\/style>/)
if (!mEstilo) morir('no se encontró el <style>')
const bloques = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m => m[1])
let codigo = bloques[bloques.length - 1]
if (!codigo || !/\(function\(\)\{/.test(codigo)) morir('no se encontró el script propio')
codigo = codigo.replace(/^\s*\(function\(\)\{/, '').replace(/\}\)\(\);\s*$/, '')
if (!/arrancar\(\);/.test(codigo)) morir('no se encontró `arrancar();`')
codigo = codigo.replace(/\n\s*arrancar\(\);/, '\n/* neutralizado por la prueba */')
if (!codigo.includes('function pintarParroquias')) morir('no se encontró pintarParroquias()')

let pw
try { pw = await import('playwright') } catch { pw = await import(pathToFileURL(GLOBAL).href) }
const chromium = pw.chromium || (pw.default && pw.default.chromium)
if (!chromium) morir('falta Playwright global')

const nav = await chromium.launch()
const pag = await (await nav.newContext()).newPage()
const errores = []
pag.on('pageerror', e => errores.push(String(e.message).slice(0, 200)))

await pag.setContent(`<!doctype html><html><head><style>${mEstilo[1]}</style></head><body>
<div id="tapa" style="display:none"><div class="caja"><p id="tapaTxt"></p><button id="tapaBtn"></button></div></div>
<div id="lista"></div><div id="avisos"></div><div id="sello"></div><div id="vivo"><span id="vivoTxt"></span></div>
<input id="selDia"><button id="bHoy"></button><button id="bDen"></button><button id="bDenOk"></button>
<button id="bDenUndo"></button><button id="bRec"></button><button id="bSurt"></button><button id="bParr"></button>
<button id="bSitio"></button><button id="bCerrar"></button><button id="bDeshacer"></button><button id="bClave"></button>
<button id="bTv"></button><button id="bPleno"></button><span id="verSello"></span>
<a id="sNo"></a><button id="sOk"></button><a id="eNo"></a><button id="eOk"></button>
<button id="eRedib"></button><a id="eOff"></a>
<div id="mapa"></div><select id="selFondo"></select><input id="brillo" type="range">
<script>
  window.__dibujos = []
  const capa = (tipo) => (a, o) => { const c = { tipo, opts: o || {}, quitada: false }
    window.__dibujos.push(c); return { addTo: function(){ return this }, on: function(){}, __c: c } }
  window.L = { map:function(){ return { setView:function(){return this}, on:function(){}, off:function(){},
      getContainer:function(){return document.body}, removeLayer:function(l){ if(l&&l.__c) l.__c.quitada=true },
      getZoom:function(){return 15}, addLayer:function(){}, fitBounds:function(){},
      createPane:function(){}, getPane:function(){ return { style:{} } } }; },
    tileLayer:function(){ return { addTo:function(){} }; },
    circle:capa('circle'), marker:capa('marker'), polyline:capa('polyline'), polygon:capa('polygon'),
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
</body></html>`, { waitUntil: 'load' })

const cuadro = (lat, lon) => [[lat, lon], [lat, lon + 0.01], [lat + 0.01, lon + 0.01], [lat + 0.01, lon]]
const PARR = [
  { nombre: 'Parroquia Santa Lucía',            es_nuestra: true,  poligono: cuadro(10.67, -71.60) },
  { nombre: 'Parroquia Olegario Villalobos',    es_nuestra: true,  poligono: cuadro(10.68, -71.61) },
  { nombre: 'Parroquia Caracciolo Parra Pérez', es_nuestra: true,  poligono: cuadro(10.69, -71.62) },
  { nombre: 'Parroquia Venancio Pulgar',        es_nuestra: true,  poligono: cuadro(10.70, -71.63) },
  { nombre: 'Parroquia Bolívar',                es_nuestra: false, poligono: cuadro(10.64, -71.60) },
  { nombre: 'Parroquia Coquivacoa',             es_nuestra: false, poligono: cuadro(10.72, -71.60) },
]

const r = await pag.evaluate((parr) => {
  // iniciarMapa() PRIMERO: sin `mapa` el quitado de capas lanza, el try/catch
  // se lo traga, y una fuga de capas quedaria invisible para esta prueba.
  // `iniciarMapa()` asigna `mapa` en su primera linea y despues monta el fondo,
  // que necesita un Leaflet de verdad. Lo que esta prueba necesita es `mapa`:
  // sin el, el quitado de capas lanza, el try/catch del producto se lo traga, y
  // una fuga de capas quedaria INVISIBLE para esta prueba.
  try { iniciarMapa() } catch (e) { /* el fondo no se prueba aca */ }
  if (!window.mapa && typeof mapa === 'undefined') throw new Error('no quedo `mapa`')
  PARROQUIAS = parr; VER_PARR = true
  window.__dibujos = []
  pintarParroquias()
  const d = window.__dibujos
  const pol = d.filter(x => x.tipo === 'polygon')
  const eti = d.filter(x => x.tipo === 'marker')
  // Cada parroquia nuestra se dibuja DOS veces: un halo ancho sin relleno y
  // encima el borde nítido. Las ajenas, una sola vez y punteadas.
  // El casing se reconoce por ser NEGRO; el resto son los contornos.
  const halos    = pol.filter(x => /^#0{3,6}$/i.test(String(x.opts.color)))
  const regiones = pol.filter(x => !/^#0{3,6}$/i.test(String(x.opts.color)))
  const mias  = regiones.filter(x => !x.opts.dashArray)
  const otras = regiones.filter(x => !!x.opts.dashArray)
  // ⛔ NINGUNA puede tener relleno. Es la regresión que hay que impedir: una
  //    tinta sobre la parroquia apaga justo la zona donde andan los camiones, y
  //    multiplicada por 18 apaga la ciudad. Máximo lo dijo mirando la pantalla:
  //    «ahora me quitaste la vista del recorrido».
  const sinRelleno = pol.every(x => x.opts.fill === false
                                 || x.opts.fillOpacity === 0
                                 || x.opts.fillOpacity === undefined)
  const out = {
    poligonos: pol.length, etiquetas: eti.length, halos: halos.length,
    regiones: regiones.length, mias: mias.length, otras: otras.length,
    // ⛔ El halo tiene que ser MÁS ANCHO que el borde: es lo que despega el
    // límite de un fondo oscuro lleno de rutas de neón. Si algún día alguien
    // los iguala, el límite vuelve a desaparecer y nadie se entera.
    // Lo que importa es la RELACIÓN, no un número mágico: la franja oscura
    // tiene que sobresalir a los dos lados de la línea de color, o no separa.
    haloMasAncho: halos.length > 0
                  && mias.every(m => m.opts.weight >= 4)
                  && halos.every(h => mias.every(m => h.opts.weight >= m.opts.weight + 3)),
    // El casing tiene que ser OSCURO, no del color de la linea. Un halo del
    // mismo color suma brillo y no separa: contra una marana de rutas de neon,
    // mas color es mas ruido. Si alguien lo vuelve a pintar del color, esto cae.
    casingOscuro: halos.every(h => /^#0{3,6}$/i.test(String(h.opts.color))),
    sinRelleno,
    miasMasFuertes: mias.every(m => m.opts.opacity >= 0.9)
                    && otras.every(o => o.opts.opacity < 0.9),
    todosEnPanel: pol.every(x => x.opts.pane === 'parroquias'),
    etiquetasEnPanel: eti.every(x => x.opts.pane === 'parroquias'),
    ningunoInteractivo: pol.concat(eti).every(x => x.opts.interactive === false),
    coloresDistintos: new Set(mias.map(x => x.opts.color)).size,
    otrasPunteadas: otras.every(x => !!x.opts.dashArray),
    miasSinPuntear: mias.every(x => !x.opts.dashArray),
  }
  // El interruptor: apagar tiene que quitar TODO lo dibujado.
  ciclarParroquias()
  out.apagado = VER_PARR
  out.quedanVivas = window.__dibujos.filter(x => !x.quitada && x.tipo === 'polygon').length
  ciclarParroquias()
  out.prendido = VER_PARR
  return out
}, PARR)

const fallos = []
const exige = (ok, q) => { if (!ok) fallos.push(q) }
exige(r.regiones === 6, `se dibujaron ${r.regiones} regiones de 6`)
exige(r.halos === 4, `${r.halos} halos: uno por cada parroquia nuestra`)
exige(r.sinRelleno, 'ALGUNA parroquia trae relleno: eso apaga el recorrido de los camiones')
exige(r.casingOscuro, '⛔ el halo volvio a ser del color de la linea: suma brillo pero no separa')
exige(r.haloMasAncho, '⛔ el halo no es más ancho que el borde: el límite no se despega del fondo')
exige(r.miasMasFuertes, 'las nuestras no se distinguen de las ajenas por intensidad')
exige(r.mias === 4 && r.otras === 2, `resaltadas ${r.mias} (deberían ser 4), de fondo ${r.otras}`)
exige(r.etiquetas === 4, `${r.etiquetas} etiquetas: solo las 4 nuestras llevan nombre`)
exige(r.todosEnPanel, '⛔ alguna parroquia NO va al panel de abajo: taparía los recorridos')
exige(r.etiquetasEnPanel, 'alguna etiqueta no va al panel de abajo')
exige(r.ningunoInteractivo, '⛔ las parroquias roban el clic: no se podría marcar un punto encima')
exige(r.coloresDistintos === 4, `las 4 nuestras comparten color (${r.coloresDistintos} distintos)`)
exige(r.otras === 2 && r.otrasPunteadas, 'las parroquias ajenas no van punteadas')
exige(r.miasSinPuntear, 'las nuestras salieron punteadas como las ajenas')
exige(r.apagado === false && r.prendido === true, 'el interruptor no alterna')
exige(r.quedanVivas === 0, `al apagar quedaron ${r.quedanVivas} capas colgadas`)
exige(errores.length === 0, 'errores de JS: ' + errores.join(' · '))

console.log(`\nregiones ${r.regiones} · resaltadas ${r.mias} (+${r.halos} halos) · de fondo ${r.otras} · etiquetas ${r.etiquetas}`)
console.log(`todas en el panel de abajo: ${r.todosEnPanel} · ninguna roba el clic: ${r.ningunoInteractivo}`)
if (fallos.length) { console.log(`\n⛔ ${fallos.length} falla(s):`); fallos.forEach(f => console.log('   · ' + f)) }
else console.log('\n✅ Las 4 resaltadas con nombre, las otras de fondo, todas por DEBAJO de los recorridos y sin robar el clic.')

await nav.close()
process.exit(fallos.length ? 1 : 0)
