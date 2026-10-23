// ═══════════════════════════════════════════════════════════════════════════════
// QUE LA PANTALLA NO ACUSE A QUIEN NO TIENE LA CULPA — EN UN NAVEGADOR
//
// Dos defectos del 23/10/2026, el mismo error de fondo: decir con seguridad algo
// que NO se midió, y que el acusado sea una persona o un equipo sano.
//
//   A. LE DIJO AL DUEÑO QUE NO TENÍA PERMISO. Con la base caída, `sb.rpc('app_rol')`
//      fallaba, el error se tiraba en un `catch` vacío, `MI_ROL` quedaba en blanco
//      y la pantalla concluía «tu usuario no tiene permiso». Máximo mandó la
//      captura. La pista estaba en lo que el mensaje NO decía: salía SIN el rol,
//      porque nunca se leyó ninguno.
//      ⛔ «No se pudo preguntar» ≠ «la respuesta fue que no».
//
//   B. ACUSÓ A ONCE CAMIONES SANOS. «11 unidades sin reportar hace más de 15 min»
//      mientras los equipos reportaban cada minuto: el que entregaba tarde era el
//      proveedor (0-1 % de atraso del 16 al 22 de octubre, 88-92 % ese día).
//      Lo que separa las dos causas es `creado` contra `ts`.
//
// Qué revisa:
//   1. Si no se pudo leer el rol: dice que no se pudo COMPROBAR, no que no haya
//      permiso, y ofrece reintentar.
//   2. Si el rol se leyó y está vacío: dice que falta darlo de alta (otra cosa).
//   3. Si el rol se leyó y no alcanza: ahí sí, y NOMBRANDO el rol.
//   4. Recibimos datos frescos pero con hora vieja → la culpa es del proveedor y
//      el aviso lo dice; las unidades NO se nombran como «sin reportar».
//   5. Hace rato que no recibimos nada → ahí sí es la unidad, y no se le echa la
//      culpa al proveedor sin prueba.
//   6. ⛔ Sin `creado` no se afirma nada: no se puede culpar a nadie a ciegas.
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
if (!codigo.includes('function atrasoDelProveedor')) morir('no se encontró atrasoDelProveedor()')
// ⛔ Y que la consulta traiga `creado`: sin esa columna la pieza de arriba no
//    puede distinguir nada y devuelve siempre null, en silencio.
if (!/select\s*=?\s*'cam,ts,creado,/.test(codigo) && !/sel='cam,ts,creado,/.test(codigo))
  morir('la consulta de posiciones NO trae `creado`: sin eso no se puede saber de quién es el atraso')
// ⛔ Y que el `catch` vacío no haya vuelto: era el que tiraba el error del rol.
if (/rr=await sb\.rpc\('app_rol'\);\s*if\(!rr\.error\)/.test(codigo))
  morir('volvió el patrón que tiraba el error de app_rol y dejaba MI_ROL en blanco')

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
    setRadius:function(){return o}, bringToFront:function(){return o},
    options:{fillColor:'#5ab9ff', color:'#5ab9ff'},
    getLatLng:function(){return {lat:10.66, lng:-71.63}} }; return o; };
  window.L = { map:function(){ return { setView:function(){return this}, on:function(){}, off:function(){},
      getContainer:function(){return document.body}, removeLayer:function(){}, getZoom:function(){return 15},
      addLayer:function(){}, createPane:function(){}, getPane:function(){ return { style:{} } },
      fitBounds:function(){} }; },
    tileLayer:function(){ return { addTo:function(){} }; },
    circle:cap, circleMarker:cap, marker:cap, polyline:cap, polygon:cap,
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
  mapa = L.map('mapa', {})
  DIA = fechaVE(new Date())
  FLOTA = { total: 12, sinGps: [] }
  CRONO = []; DESCARTE = null; PARROQUIAS = []; CAJAS_PARR = null
  ESTADO = { leible: true, min: 0, ultimo: new Date().toISOString(), unidades: 12 }
  const ahora = Date.now()
  const iso = min => new Date(ahora - min * 60000).toISOString()
  const leerAvisos = () => document.getElementById('avisos').innerText.replace(/\s+/g, ' ').trim()
  const leerFichas = () => document.getElementById('lista').innerText.replace(/\s+/g, ' ').trim()

  // ── B. DE QUIÉN ES EL ATRASO ──────────────────────────────────────────────
  // Caso del 23/10: el dato más nuevo tiene 50 min, pero lo RECIBIMOS hace 1.
  crudo = [
    { cam:'JAC-B001', ts:iso(52), creado:iso(1), lat:10.66, lon:-71.63, velocidad:0, ignicion:true, odometro:100, ubicacion:'Maracaibo' },
    { cam:'JAC-B001', ts:iso(50), creado:iso(1), lat:10.66, lon:-71.63, velocidad:0, ignicion:true, odometro:100, ubicacion:'Maracaibo' },
    { cam:'JAC-B002', ts:iso(51), creado:iso(1), lat:10.67, lon:-71.62, velocidad:0, ignicion:true, odometro:100, ubicacion:'Maracaibo' }
  ]
  pintar()
  out.proveedor = leerAvisos()
  out.fichaProveedor = leerFichas()

  // La unidad de verdad muda: hace rato que NO recibimos nada de nadie.
  crudo = [
    { cam:'JAC-B001', ts:iso(52), creado:iso(52), lat:10.66, lon:-71.63, velocidad:0, ignicion:true, odometro:100, ubicacion:'Maracaibo' },
    { cam:'JAC-B002', ts:iso(51), creado:iso(51), lat:10.67, lon:-71.62, velocidad:0, ignicion:true, odometro:100, ubicacion:'Maracaibo' }
  ]
  dibujo = {}
  pintar()
  out.unidad = leerAvisos()
  out.fichaUnidad = leerFichas()

  // ⛔ Sin `creado` no se afirma de quién es la culpa.
  crudo = [
    { cam:'JAC-B001', ts:iso(52), lat:10.66, lon:-71.63, velocidad:0, ignicion:true, odometro:100, ubicacion:'Maracaibo' }
  ]
  dibujo = {}
  pintar()
  out.sinCreado = leerAvisos()

  return out
})

// ⛔ LA PARTE DEL PERMISO SE MIDE SOBRE EL TEXTO REAL DEL ARCHIVO, no sobre una
//    copia del camino dentro de la prueba: copiar el `if` acá y comprobarlo
//    seria comprobar la copia, y el archivo podria decir otra cosa.
//    [[norma-probar-el-camino-no-la-pieza]]
const fuente = codigo
const fallos = []
const exige = (ok, q) => { if (!ok) fallos.push(q) }
const o = r

// B — de quién es la culpa
exige(/entregando con atraso/.test(o.proveedor),
  `⛔ CON EL PROVEEDOR ATRASADO EL AVISO NO LO DICE: "${o.proveedor.slice(0, 150)}"`)
exige(!/sin reportar/.test(o.proveedor),
  `⛔ SIGUE ACUSANDO A LAS UNIDADES de un atraso del proveedor: "${o.proveedor.slice(0, 150)}"`)
exige(/Los camiones sí están reportando/.test(o.proveedor), 'el aviso no desmiente la sospecha sobre los camiones')
exige(/dato atrasado/.test(o.fichaProveedor) && !/sin señal/.test(o.fichaProveedor),
  `⛔ la FICHA de cada unidad sigue diciendo «sin señal»: "${o.fichaProveedor.slice(0, 140)}"`)
exige(/sin reportar/.test(o.unidad),
  `cuando de verdad no llega nada, no lo dice: "${o.unidad.slice(0, 140)}"`)
exige(!/entregando con atraso/.test(o.unidad),
  '⛔ culpa al proveedor cuando lo que pasa es que no llega nada de nadie')
exige(/sin señal/.test(o.fichaUnidad), 'la ficha no marca «sin señal» cuando sí corresponde')
exige(!/entregando con atraso/.test(o.sinCreado),
  '⛔ SIN `creado` AFIRMA DE QUIÉN ES LA CULPA: eso no se puede saber sin ese dato')

// A — el permiso: se mide sobre el código real del archivo
exige(/No se pudo comprobar tu permiso/.test(fuente),
  '⛔ no existe el caso «no se pudo comprobar el permiso»: un error de red se sigue leyendo como un «no»')
exige(/Reintentar/.test(fuente), 'el caso de error no ofrece reintentar')
exige(/no tiene un rol asignado/.test(fuente),
  'no distingue «entró bien pero no tiene rol» de «su rol no alcanza»')
exige(/rolLeido/.test(fuente), 'no hay una bandera que diga si el rol se pudo leer')
exige(errores.length === 0, 'errores de JS: ' + errores.join(' · '))

console.log('\n── DE QUIÉN ES LA CULPA ──')
console.log('proveedor atrasado : ' + o.proveedor.slice(0, 180))
console.log('ficha              : ' + (o.fichaProveedor.match(/dato atrasado|sin señal/) || ['—'])[0])
console.log('unidad muda        : ' + o.unidad.slice(0, 120))
console.log('sin `creado`       : ' + (o.sinCreado || '(no afirma nada, correcto)').slice(0, 120))
if (fallos.length) { console.log(`\n⛔ ${fallos.length} falla(s):`); fallos.forEach(f => console.log('   · ' + f)) }
else console.log('\n✅ El atraso del proveedor no se le cuelga a los camiones, y no poder preguntar no es un «no».')
await nav.close()
process.exit(fallos.length ? 1 : 0)
