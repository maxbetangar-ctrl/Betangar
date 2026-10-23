// ═══════════════════════════════════════════════════════════════════════════════
// VER EL AVISO DEL DESCARTE SILENCIOSO — EN UN NAVEGADOR
//
// QUÉ PROBLEMA VIGILA. El conector puede estar recibiendo posiciones y tirándolas,
// y eso se ve EXACTAMENTE igual que todo en orden. Pasó el 23/10/2026: el
// proveedor habilitó JAC-B011 y JAC-B012, `gps-sondeo` supo desde el primer
// minuto que le llegaban dos placas que no reconocía, descartó sus posiciones y
// no quedó rastro — no se puede saber cuántos días. Lo encontró Máximo mirando la
// pantalla, no el sistema.
//
// Qué revisa:
//   1. Con descartes: el aviso aparece, SE VE, nombra las placas y dice desde cuándo.
//   2. ⛔ SIN NI UNA POSICIÓN: el aviso SIGUE saliendo. Es el camino en que
//      `pintar()` se devuelve temprano, y es el caso peor — si el conector
//      descartara TODAS las placas habría cero posiciones y la pantalla diría
//      «todavía no hay posiciones de hoy» sin explicar por qué. El aviso faltaría
//      justo cuando lo explica todo. Este caso cazó un error real de emplazamiento.
//   3. Sin descartes: NO aparece nada. Un aviso que se queda puesto después de
//      arreglado es la otra forma de mentir.
//   4. Una sola placa habla en singular.
//   5. La antigüedad se lee: «hace 3 h», «hace 2 días», no 51.7 horas.
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
// ⛔ Si lo que se prueba no está, la prueba MUERE en vez de pasar en verde.
for (const q of ['function avisoDescarte', 'function antiguedad', 'function pintar'])
  if (!codigo.includes(q)) morir('no se encontró ' + q + '() en mapa.html')

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
<div id="crono"></div>
<div id="lista"></div><div id="avisos"></div><div id="sello"></div><div id="vivo"><span id="vivoTxt"></span></div>
<input id="selDia"><button id="bHoy"></button><button id="bDen"></button><button id="bDenOk"></button>
<button id="bDenUndo"></button><button id="bRec"></button><button id="bSurt"></button><button id="bParr"></button>
<button id="bFalta"></button><button id="bSitio"></button><button id="bCerrar"></button><button id="bDeshacer"></button>
<button id="bClave"></button><button id="bTv"></button><button id="bPleno"></button><span id="verSello"></span>
<a id="sNo"></a><button id="sOk"></button><a id="eNo"></a><button id="eOk"></button>
<button id="eRedib"></button><a id="eOff"></a>
<div id="mapa"></div><select id="selFondo"></select><input id="brillo" type="range">
<script>
  // Un objeto de Leaflet que acepta lo que mapa.html le pide de verdad. Se
  // enumeran los metodos a proposito: un stub que acepta CUALQUIER cosa haria
  // pasar la prueba tambien el dia que el archivo llame a algo que no existe.
  var cap = function(){ var o = {
    addTo:function(){return o}, on:function(){return o}, off:function(){return o},
    setLatLng:function(){return o}, setLatLngs:function(){return o},
    setStyle:function(){return o}, setOpacity:function(){return o},
    bindTooltip:function(){return o}, remove:function(){return o},
    getLatLng:function(){return {lat:10.66, lng:-71.63}} }; return o; };
  window.L = { map:function(){ return { setView:function(){return this}, on:function(){}, off:function(){},
      getContainer:function(){return document.body}, removeLayer:function(){}, getZoom:function(){return 15},
      addLayer:function(){}, fitBounds:function(){}, createPane:function(){}, getPane:function(){ return { style:{} } } }; },
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
  const av = document.getElementById('avisos')
  const leer = () => av.innerText.replace(/\s+/g, ' ').trim()
  // ⛔ Y SI SE VE, no solo qué dice. Un `display:none` de la hoja de estilos le
  //    gana al `style.display` del JS, y `innerText` devuelve el texto igual:
  //    así se perdió la franja del cronograma en producción.
  const seVe = () => {
    const d = av.querySelector('.aviso')
    return !!d && getComputedStyle(d).display !== 'none' && d.offsetHeight > 0
  }
  const out = {}

  // `arrancar()` esta neutralizado, asi que el mapa no se creo: lo monta la
  // prueba con el mismo L falso. Sin esto `pintar()` muere en `fitBounds`.
  mapa = L.map('mapa', {})
  DIA = fechaVE(new Date())
  FLOTA = { total: 12, sinGps: [] }
  CRONO = []

  // Una posición cualquiera, para que `pintar()` NO tome el camino corto.
  const unaPos = [{ cam: 'JAC-B001', lat: 10.66, lon: -71.63, vel: 20,
                    ts: new Date().toISOString(), ubicacion: 'Parroquia Santa Lucía' }]

  // 1. CON descartes, y la flota andando.
  DESCARTE = { placas: ['A15EN3P', 'A07EV6P'], horas: 51.7 }
  crudo = unaPos
  pintar(); out.conDescarte = leer(); out.conDescarteSeVe = seVe()

  // 2. ⛔ EL CASO QUE DECIDE: sin NI UNA posición. `pintar()` se devuelve
  //    temprano por otro camino, y el aviso tiene que salir igual.
  crudo = []
  pintar(); out.sinPosiciones = leer(); out.sinPosicionesSeVe = seVe()

  // 3. SIN descartes: no puede quedar nada puesto.
  DESCARTE = null
  crudo = unaPos
  pintar(); out.sinDescarte = leer()
  crudo = []
  pintar(); out.sinDescarteSinPos = leer()

  // 4. Una sola placa: singular.
  DESCARTE = { placas: ['A15EN3P'], horas: 2 }
  crudo = unaPos
  pintar(); out.unaSola = leer()

  // 5. La antigüedad, legible.
  out.horas = {
    media:  antiguedad(0.4),
    tres:   antiguedad(3.2),
    unDia:  antiguedad(26),
    dias:   antiguedad(51.7),
    cero:   antiguedad(null)
  }
  return out
})

const fallos = []
const exige = (ok, q) => { if (!ok) fallos.push(q) }

exige(/no tenemos registradas/.test(r.conDescarte), 'con descartes no sale el aviso')
exige(/A15EN3P/.test(r.conDescarte) && /A07EV6P/.test(r.conDescarte),
  'el aviso no nombra las placas que se están descartando')
exige(/hace 2 días/.test(r.conDescarte), `el aviso no dice desde cuándo: "${r.conDescarte.slice(0, 160)}"`)
exige(r.conDescarteSeVe, '⛔ el aviso tiene el texto pero NO SE VE')
// ⛔ LA QUE CAZÓ EL ERROR DE EMPLAZAMIENTO.
exige(/no tenemos registradas/.test(r.sinPosiciones),
  '⛔ SIN NI UNA POSICIÓN EL AVISO DESAPARECE: `pintar()` se devuelve temprano por ese camino, '
  + 'y es justo el caso en que el descarte explica la pantalla vacía')
exige(r.sinPosicionesSeVe, 'sin posiciones el aviso está en el HTML pero no se ve')
exige(!/no tenemos registradas|A15EN3P/.test(r.sinDescarte),
  `⛔ sin descartes el aviso se queda puesto: "${r.sinDescarte.slice(0, 160)}"`)
exige(!/no tenemos registradas|A15EN3P/.test(r.sinDescarteSinPos),
  'sin descartes y sin posiciones el aviso se queda puesto')
exige(/1 placa que no tenemos registrada\b/.test(r.unaSola.replace(/\s+/g, ' ')),
  `con una sola placa habla en plural: "${r.unaSola.slice(0, 160)}"`)
exige(r.horas.media === 'hace menos de una hora', 'una antigüedad corta no se redacta: ' + r.horas.media)
exige(r.horas.tres === 'hace 3 h', 'horas mal redactadas: ' + r.horas.tres)
exige(r.horas.unDia === 'hace 1 día', '26 h no se dice en días singular: ' + r.horas.unDia)
exige(r.horas.dias === 'hace 2 días', '51,7 h no se dice en días: ' + r.horas.dias)
exige(!/NaN|undefined/.test(JSON.stringify(r.horas)), 'la antigüedad devuelve NaN/undefined: ' + JSON.stringify(r.horas))
exige(errores.length === 0, 'errores de JS: ' + errores.join(' · '))

console.log('\n── EL AVISO ──')
console.log('con flota andando : ' + r.conDescarte)
console.log('sin posiciones    : ' + r.sinPosiciones)
console.log('sin descartes     : ' + (r.sinDescarte || '(nada, correcto)'))
console.log('una sola placa    : ' + r.unaSola)
console.log('antigüedad        : ' + JSON.stringify(r.horas))
if (fallos.length) { console.log(`\n⛔ ${fallos.length} falla(s):`); fallos.forEach(f => console.log('   · ' + f)) }
else console.log('\n✅ El descarte se ve, nombra las placas, dice desde cuándo, sale TAMBIÉN sin posiciones y desaparece solo.')
await nav.close()
process.exit(fallos.length ? 1 : 0)
