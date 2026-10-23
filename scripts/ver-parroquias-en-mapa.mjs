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
//   3. SOLO las CUATRO de Betangar se dibujan. Las otras 14 quedan guardadas
//      en la base pero NO se pintan: catorce contornos cruzando la ciudad son
//      ruido encima del recorrido, que es lo que de verdad hay que leer.
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
<button id="bDenUndo"></button><button id="bRec"></button><button id="bSurt"></button><button id="bParr"></button><button id="bLimp"></button>
<button id="bSitio"></button><button id="bCerrar"></button><button id="bDeshacer"></button><button id="bClave"></button>
<button id="bTv"></button><button id="bPleno"></button><span id="verSello"></span>
<a id="sNo"></a><button id="sOk"></button><a id="eNo"></a><button id="eOk"></button>
<button id="eRedib"></button><a id="eOff"></a>
<div id="mapa"></div><select id="selFondo"></select><input id="brillo" type="range">
<script>
  window.__dibujos = []
  const capa = (tipo) => (a, o) => { const c = { tipo, pts: a, opts: o || {}, quitada: false }
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
  // Se declara que hoy toca Santa Lucia: es lo que decide el resaltado.
  CRONO = [{ dia:'lunes', tipo:'parroquia', parroquia:'Parroquia Santa Lucía', camiones:2 }]
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
  // Ya no se dibujan las ajenas: lo que llegue de mas es una regresion.
  const otras = regiones.filter(x => !!x.opts.dashArray)
  // ⛔ NINGUNA puede tener relleno. Es la regresión que hay que impedir: una
  //    tinta sobre la parroquia apaga justo la zona donde andan los camiones, y
  //    multiplicada por 18 apaga la ciudad. Máximo lo dijo mirando la pantalla:
  //    «ahora me quitaste la vista del recorrido».
  // El tinte vuelve, pero muy bajo: marca territorio sin apagar la zona por
  // donde andan los camiones. Mas de 0.12 ya opaca el recorrido.
  const relleveSuave = regiones.every(x => (x.opts.fillOpacity || 0) <= 0.12)
  const out = {
    poligonos: pol.length, etiquetas: eti.length, halos: halos.length,
    regiones: regiones.length, mias: mias.length, otras: otras.length,
    // ⛔ El halo tiene que ser MÁS ANCHO que el borde: es lo que despega el
    // límite de un fondo oscuro lleno de rutas de neón. Si algún día alguien
    // los iguala, el límite vuelve a desaparecer y nadie se entera.
    // Lo que importa es la RELACIÓN, no un número mágico: la franja oscura
    // tiene que sobresalir a los dos lados de la línea de color, o no separa.
    // ⛔ EMPAREJADOS, no cruzados. Al existir dos grosores (la del dia y las
    // otras), comparar cada halo contra TODAS las lineas hacia fallar al halo
    // flaco contra la linea gruesa, que no son la misma parroquia. Se ordenan
    // los dos y se comparan de a pares.
    haloMasAncho: (() => {
      if (!halos.length || halos.length !== mias.length) return false
      const h = halos.map(x => x.opts.weight).sort((a, b) => a - b)
      const l = mias.map(x => x.opts.weight).sort((a, b) => a - b)
      return l.every(w => w >= 4) && h.every((w, i) => w >= l[i] + 3)
    })(),
    // El casing tiene que ser OSCURO, no del color de la linea. Un halo del
    // mismo color suma brillo y no separa: contra una marana de rutas de neon,
    // mas color es mas ruido. Si alguien lo vuelve a pintar del color, esto cae.
    casingOscuro: halos.every(h => /^#0{3,6}$/i.test(String(h.opts.color))),
    relleveSuave,
    // La que TOCA ese dia se dibuja mas fuerte que las otras tres. Antes esta
    // comprobacion distinguia «mias vs ajenas», pero ya no se dibujan las
    // ajenas: lo que hay que proteger ahora es que la del dia se despegue.
    tocaMasFuerte: (() => {
      const t = mias.filter(m => m.opts.weight >= 8)
      const n = mias.filter(m => m.opts.weight < 8)
      return t.length === 1 && n.length === mias.length - 1
             && t[0].opts.opacity >= 0.9 && n.every(x => x.opts.opacity < 0.9)
    })(),
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
  // ── ⛔ LA ZONA DE TRABAJO ─────────────────────────────────────────────────
  //  Venancio: el limite legal son 71,5 km2 y los camiones solo tocan 11,66.
  //  Cuando hay zona calculada SE DIBUJA LA ZONA, no el limite — si no, la
  //  parte trabajada se ve diminuta dentro de un campo que no se recoge.
  const LEJOS = [[10.60,-71.80],[10.60,-71.60],[10.78,-71.60],[10.78,-71.80]]  // el limite legal
  const ZONA1 = [[10.70,-71.70],[10.70,-71.68],[10.72,-71.68],[10.72,-71.70]]
  const ZONA2 = [[10.74,-71.66],[10.74,-71.65],[10.745,-71.65],[10.745,-71.66]]
  CRONO = [{ dia:'miercoles', tipo:'parroquia', parroquia:'Parroquia Venancio Pulgar', camiones:12 }]
  PARROQUIAS = [{ nombre:'Parroquia Venancio Pulgar', es_nuestra:true,
                  poligono: LEJOS, poligono_zona: [ZONA1, ZONA2] }]
  window.__dibujos = []
  pintarParroquias()
  const dz = window.__dibujos
  const polz = dz.filter(x => x.tipo === 'polygon')
  const etiz = dz.filter(x => x.tipo === 'marker')
  const puntos = [].concat.apply([], polz.map(x => x.pts || []))
  out.zona = {
    poligonos: polz.length,
    // ⛔ Si aparece UN SOLO punto del limite legal, se dibujo el limite y no la zona.
    usaLimiteLegal: puntos.some(v => Math.abs(v[1] - (-71.80)) < 1e-9 || Math.abs(v[0] - 10.60) < 1e-9),
    usaZona: puntos.some(v => Math.abs(v[0] - 10.70) < 1e-9 && Math.abs(v[1] - (-71.70)) < 1e-9),
    // La etiqueta tiene que caer DENTRO de la zona grande, no en medio del campo.
    etiqueta: etiz.length ? etiz[0].pts : null
  }

  return out
}, PARR)

const fallos = []
const exige = (ok, q) => { if (!ok) fallos.push(q) }
exige(r.halos === 4, `${r.halos} halos: uno por cada parroquia nuestra`)
exige(r.relleveSuave, 'el relleno paso de 0.12: a partir de ahi apaga el recorrido de los camiones')
exige(r.regiones === 4, `se dibujaron ${r.regiones} parroquias: solo van las 4 de Betangar`)
exige(r.otras === 0, `se dibujaron ${r.otras} parroquias ajenas: no deben pintarse`)
exige(r.casingOscuro, '⛔ el halo volvio a ser del color de la linea: suma brillo pero no separa')
exige(r.haloMasAncho, '⛔ el halo no es más ancho que el borde: el límite no se despega del fondo')
exige(r.tocaMasFuerte, 'la parroquia que TOCA ese dia no se despega de las otras tres')
exige(r.etiquetas === 4, `${r.etiquetas} etiquetas: solo las 4 nuestras llevan nombre`)
exige(r.todosEnPanel, '⛔ alguna parroquia NO va al panel de abajo: taparía los recorridos')
exige(r.etiquetasEnPanel, 'alguna etiqueta no va al panel de abajo')
exige(r.ningunoInteractivo, '⛔ las parroquias roban el clic: no se podría marcar un punto encima')
exige(r.coloresDistintos === 4, `las 4 nuestras comparten color (${r.coloresDistintos} distintos)`)
exige(r.miasSinPuntear, 'las nuestras salieron punteadas como las ajenas')
exige(r.apagado === false && r.prendido === true, 'el interruptor no alterna')
exige(r.quedanVivas === 0, `al apagar quedaron ${r.quedanVivas} capas colgadas`)
// ── La zona de trabajo ───────────────────────────────────────────────────────
exige(r.zona.poligonos === 4,
  `con 2 anillos de zona se esperaban 4 poligonos (halo + borde por anillo), hubo ${r.zona.poligonos}`)
exige(!r.zona.usaLimiteLegal,
  '⛔ SE SIGUE DIBUJANDO EL LIMITE LEGAL teniendo zona de trabajo: en Venancio eso pinta 71,5 km2 '
  + 'de los que el 83% es campo donde no se recoge')
exige(r.zona.usaZona, '⛔ no se dibujo la zona de trabajo')
exige(r.zona.etiqueta && r.zona.etiqueta[0] > 10.69 && r.zona.etiqueta[0] < 10.73
      && r.zona.etiqueta[1] > -71.71 && r.zona.etiqueta[1] < -71.67,
  `⛔ la etiqueta cae fuera de la zona dibujada (${JSON.stringify(r.zona.etiqueta)}): en Venancio `
  + 'el centro del limite legal esta en pleno campo, a kilometros de donde se trabaja')
exige(errores.length === 0, 'errores de JS: ' + errores.join(' · '))

console.log(`\nregiones ${r.regiones} · resaltadas ${r.mias} (+${r.halos} halos) · de fondo ${r.otras} · etiquetas ${r.etiquetas}`)
console.log(`todas en el panel de abajo: ${r.todosEnPanel} · ninguna roba el clic: ${r.ningunoInteractivo}`)
if (fallos.length) { console.log(`\n⛔ ${fallos.length} falla(s):`); fallos.forEach(f => console.log('   · ' + f)) }
else console.log('\n✅ Las 4 resaltadas con nombre, las otras de fondo, todas por DEBAJO de los recorridos y sin robar el clic.')

await nav.close()
process.exit(fallos.length ? 1 : 0)
