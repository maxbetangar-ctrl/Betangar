// ═══════════════════════════════════════════════════════════════════════════════
// VER LA CAPA «SIN REGISTRO DE PASO» — EN UN NAVEGADOR
//
// Qué revisa, y por qué:
//   1. ⛔ QUE SOLO SE PINTE LO QUE FALTA. Las cubiertas no se dibujan: en
//      Olegario son 515 de 595, y pintarlas taparía el recorrido para mostrar
//      justo lo que NO hay que mirar.
//   2. ⛔ QUE VAYA ENTRE MEDIO: encima de las parroquias y DEBAJO del recorrido.
//      Si tapara la ruta, la pantalla perdería lo que de verdad hay que leer.
//   3. ⛔ QUE EL PANEL DIGA QUE «SIN REGISTRO» NO ES «NO PASARON». Esto se
//      parece a una acusación y lo mira gente que decide sobre choferes.
//   4. Que rojo y ámbar se distingan, y que el interruptor no deje capas colgadas.
//
// Corre el código REAL de mapa.html, quitándole solo la IIFE.
// Uso: node scripts/ver-sin-registro-en-mapa.mjs
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
for (const f of ['function pintarFaltantes', 'function panelFaltantes'])
  if (!codigo.includes(f)) morir('no se encontró ' + f)

let pw
try { pw = await import('playwright') }
catch { pw = await import(pathToFileURL('C:/Users/Maxbetangar/AppData/Roaming/npm/node_modules/playwright/index.js').href) }
const chromium = pw.chromium || (pw.default && pw.default.chromium)
if (!chromium) morir('falta Playwright global')

const nav = await chromium.launch()
const pag = await (await nav.newContext()).newPage()
const errores = []
pag.on('pageerror', e => errores.push(String(e.message).slice(0, 200)))

const laboratorio = `<!doctype html><html><head><style>${mEstilo[1]}</style></head><body>
<div id="tapa" style="display:none"><div class="caja"><p id="tapaTxt"></p><button id="tapaBtn"></button></div></div>
<div id="lista"></div><div id="avisos"></div><div id="sello"></div><div id="vivo"><span id="vivoTxt"></span></div>
<input id="selDia"><button id="bHoy"></button><button id="bDen"></button><button id="bDenOk"></button>
<button id="bDenUndo"></button><button id="bRec"></button><button id="bSurt"></button><button id="bParr"></button>
<button id="bFalta"></button><button id="bSitio"></button><button id="bCerrar"></button><button id="bDeshacer"></button>
<button id="bClave"></button><button id="bTv"></button><button id="bPleno"></button><span id="verSello"></span>
<a id="sNo"></a><button id="sOk"></button><a id="eNo"></a><button id="eOk"></button>
<button id="eRedib"></button><a id="eOff"></a>
<div id="mapa"></div><select id="selFondo"></select><input id="brillo" type="range">
<script>
  window.__dib = []
  const capa = (tipo) => (a, o) => { const c = { tipo, opts: o || {}, quitada: false }
    window.__dib.push(c); return { addTo: function(){ return this }, on: function(){}, __c: c } }
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
</body></html>`

await pag.setContent(laboratorio, { waitUntil: 'load' })

const tramo = (a, b) => [[a, b], [a + 0.001, b + 0.001]]
const DATOS = [
  { parroquia: 'Parroquia Olegario Villalobos', calle_id: 1, nombre: null, metros: 464, cobertura: 0, estado: 'sin registro', geom: tramo(10.685, -71.620) },
  { parroquia: 'Parroquia Olegario Villalobos', calle_id: 2, nombre: 'Av 3', metros: 200, cobertura: 0.3, estado: 'parcial', geom: tramo(10.686, -71.621) },
  { parroquia: 'Parroquia Venancio Pulgar', calle_id: 3, nombre: null, metros: 900, cobertura: 0, estado: 'sin registro', geom: tramo(10.700, -71.640) },
]

const r = await pag.evaluate((datos) => {
  try { iniciarMapa() } catch (e) { /* el fondo no se prueba acá */ }
  DIA = '2026-10-23'
  FALTAN = datos; VER_FALTA = true
  window.__dib = []
  pintarFaltantes()
  const pol = window.__dib.filter(x => x.tipo === 'polyline')
  const casing = pol.filter(x => /^#0{3,6}$/i.test(String(x.opts.color)))
  const color = pol.filter(x => !/^#0{3,6}$/i.test(String(x.opts.color)))
  const rojas = color.filter(x => /^#ff3b30$/i.test(String(x.opts.color)))
  const ambar = color.filter(x => /^#ffb020$/i.test(String(x.opts.color)))
  const out = {
    lineas: pol.length, casing: casing.length, rojas: rojas.length, ambar: ambar.length,
    enPanelPropio: pol.every(x => x.opts.pane === 'faltantes'),
    ningunaInteractiva: pol.every(x => x.opts.interactive === false),
    casingMasAncho: casing.every(c => color.every(k => c.opts.weight > k.opts.weight)),
    ambarPunteada: ambar.every(x => !!x.opts.dashArray),
    rojaEntera: rojas.every(x => !x.opts.dashArray),
  }
  panelFaltantes()
  out.panel = document.querySelector('#tapa .caja').innerText
  VER_FALTA = false; pintarFaltantes()
  out.quedanVivas = window.__dib.filter(x => !x.quitada && x.tipo === 'polyline').length
  return out
}, DATOS)

const fallos = []
const exige = (ok, q) => { if (!ok) fallos.push(q) }
exige(r.rojas === 2, `rojas: ${r.rojas} (deberían ser 2)`)
exige(r.ambar === 1, `ámbar: ${r.ambar} (debería ser 1)`)
exige(r.casing === 3, `casing: ${r.casing} (uno por calle)`)
exige(r.enPanelPropio, '⛔ alguna va fuera del panel propio: podría tapar el recorrido')
exige(r.ningunaInteractiva, 'las calles pintadas roban el clic')
exige(r.casingMasAncho, 'el casing no es más ancho que la línea: no separa del fondo')
exige(r.ambarPunteada && r.rojaEntera, 'rojo y ámbar no se distinguen por el trazo')
exige(/no es .*no pasaron/i.test(r.panel), '⛔ el panel NO aclara que «sin registro» no es «no pasaron»')
exige(/57 minutos/.test(r.panel), 'el panel no explica por qué puede faltar registro')
exige(/Venancio Pulgar/.test(r.panel) && /Olegario/.test(r.panel), 'el panel no resume por parroquia')
exige(r.quedanVivas === 0, `al apagar quedaron ${r.quedanVivas} capas colgadas`)
exige(errores.length === 0, 'errores de JS: ' + errores.join(' · '))

console.log(`\nlíneas ${r.lineas} · rojas ${r.rojas} · ámbar ${r.ambar} · casing ${r.casing}`)
console.log(`panel propio: ${r.enPanelPropio} · no roban el clic: ${r.ningunaInteractiva}`)
console.log('\n── EL PANEL ──\n' + r.panel.trim().slice(0, 430))
if (fallos.length) { console.log(`\n⛔ ${fallos.length} falla(s):`); fallos.forEach(f => console.log('   · ' + f)) }
else console.log('\n✅ Solo se pinta lo que falta, entre las parroquias y el recorrido, y el panel aclara que no es una acusación.')
await nav.close()
process.exit(fallos.length ? 1 : 0)
