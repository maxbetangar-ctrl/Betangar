// ═══════════════════════════════════════════════════════════════════════════════
// VER LA FRANJA DEL CRONOGRAMA — EN UN NAVEGADOR
//
// Qué revisa:
//   1. Un día normal: dice qué parroquia toca y con cuántos camiones.
//   2. Lunes y jueves: las DOS parroquias, y la suma de camiones.
//   3. Domingo: «operativo que define el IMAU» — nunca una parroquia heredada.
//   4. ⛔ SIN CRONOGRAMA VIGENTE: lo dice, y aclara que NO es «no tocaba nada».
//      Es el tercer estado, y es el que evita leer un día anterior a la carga
//      del cronograma como una jornada sin trabajo.
//   5. ⛔ QUE LAS UNIDADES QUE NO SE VEN SE DIGAN EN LA FRANJA, no en un tooltip:
//      esta pantalla a veces la mira la Alcaldía, y un asterisco escondido es
//      lo que después parece ocultamiento. Y QUE SALGAN DEL DATO: la prueba usa
//      una unidad DISTINTA de las dos de siempre, porque el texto estuvo escrito
//      a mano («JAC-B011 y JAC-B012») y siguió diciéndolo después de que el
//      proveedor las habilitó el 23/10/2026. Si alguien lo vuelve a fijar, el
//      caso de JAC-B007 falla. Y con la flota completa la salvedad DESAPARECE.
//   6. Un día pasado habla en pasado («tocaba»), no en presente.
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
if (!codigo.includes('function pintarCronograma')) morir('no se encontró pintarCronograma()')

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
<button id="bDenUndo"></button><button id="bRec"></button><button id="bSurt"></button><button id="bParr"></button><button id="bLimp"></button>
<button id="bFalta"></button><button id="bSitio"></button><button id="bCerrar"></button><button id="bDeshacer"></button>
<button id="bClave"></button><button id="bTv"></button><button id="bPleno"></button><span id="verSello"></span>
<a id="sNo"></a><button id="sOk"></button><a id="eNo"></a><button id="eOk"></button>
<button id="eRedib"></button><a id="eOff"></a>
<div id="mapa"></div><select id="selFondo"></select><input id="brillo" type="range">
<script>
  window.L = { map:function(){ return { setView:function(){return this}, on:function(){}, off:function(){},
      getContainer:function(){return document.body}, removeLayer:function(){}, getZoom:function(){return 15},
      addLayer:function(){}, fitBounds:function(){}, createPane:function(){}, getPane:function(){ return { style:{} } } }; },
    tileLayer:function(){ return { addTo:function(){} }; },
    circle:function(){ return { addTo:function(){return this}, on:function(){} }; },
    marker:function(){ return { addTo:function(){return this}, on:function(){} }; },
    polyline:function(){ return { addTo:function(){return this} }; },
    polygon:function(){ return { addTo:function(){return this} }; },
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
  const leer = () => document.getElementById('crono').innerText.replace(/\s+/g, ' ').trim()
  // ⛔ Y SI SE VE, NO SOLO QUÉ DICE. Esta prueba estuvo CIEGA a un error real:
  //    el CSS tenía `#crono{display:none}` fijo y el JS la "mostraba" con
  //    `style.display=''`, que no le gana a la hoja de estilos — la franja NUNCA
  //    apareció en producción. La prueba pasaba igual porque `innerText`, en un
  //    elemento oculto, devuelve el texto lo mismo. Medía lo que DICE, no si se VE.
  const seVe = () => getComputedStyle(document.getElementById('crono')).display !== 'none'
  const out = {}

  // La flota que la franja va a describir. Se declara por escenario, porque la
  // salvedad SALE DE ACÁ y no de un texto fijo.
  const flota = sinGps => ({ total: 12, sinGps: sinGps })

  // Hoy, un martes: una sola parroquia, y 2 unidades sin GPS.
  DIA = fechaVE(new Date())
  FLOTA = flota(['JAC-B011', 'JAC-B012'])
  CRONO = [{ f: DIA, dia: 'martes', tipo: 'parroquia',
             parroquia: 'Parroquia Caracciolo Parra Pérez', camiones: 12, nota: null }]
  pintarCronograma(); out.unaSola = leer(); out.unaSolaSeVe = seVe()
  out.tocaUna = parroquiasDeHoy()

  // Lunes: dos parroquias, 7 + 2. Menos comprometidos que visibles.
  CRONO = [{ f: DIA, dia: 'lunes', tipo: 'parroquia', parroquia: 'Parroquia Olegario Villalobos', camiones: 7, nota: null },
           { f: DIA, dia: 'lunes', tipo: 'parroquia', parroquia: 'Parroquia Santa Lucía', camiones: 2, nota: null }]
  pintarCronograma(); out.dos = leer()
  out.tocaDos = parroquiasDeHoy()

  // ⛔ EL CONTROL QUE DECIDE SI EL TEXTO ES FIJO: otra unidad, y una sola.
  //    Si la franja sigue nombrando a B011 y B012, está escrita a mano.
  FLOTA = flota(['JAC-B007'])
  pintarCronograma(); out.otra = leer()

  // Y la misma unidad sola con la flota entera comprometida: el tope tiene que
  // dar 11, no el 10 de siempre. Un tope escrito a mano se cazaría acá.
  CRONO = [{ f: DIA, dia: 'martes', tipo: 'parroquia',
             parroquia: 'Parroquia Caracciolo Parra Pérez', camiones: 12, nota: null }]
  pintarCronograma(); out.otra12 = leer()

  // ⛔ Y CON LA FLOTA COMPLETA LA SALVEDAD TIENE QUE DESAPARECER. Si se queda,
  //    la pantalla miente al revés: avisa de un problema que ya no existe, y el
  //    día que vuelva a existir nadie le va a creer.
  FLOTA = flota([])
  pintarCronograma(); out.completa = leer(); out.completaSeVe = seVe()

  // Y si NO SE PUDO leer la flota, eso no se puede ver igual que «están todas».
  FLOTA = null
  pintarCronograma(); out.noSeSabe = leer()
  FLOTA = flota(['JAC-B011', 'JAC-B012'])

  // Domingo.
  CRONO = [{ f: DIA, dia: 'domingo', tipo: 'operativo_imau', parroquia: null, camiones: null,
             nota: 'El operativo del domingo lo define el IMAU; no hay parroquia asignada de antemano.' }]
  pintarCronograma(); out.domingo = leer()
  out.tocaDomingo = parroquiasDeHoy()

  // Sin cronograma vigente: el tercer estado.
  CRONO = []
  pintarCronograma(); out.sinVigencia = leer(); out.sinVigenciaSeVe = seVe()

  // Un día pasado: tiene que hablar en pasado.
  DIA = '2026-10-19'
  CRONO = [{ f: DIA, dia: 'lunes', tipo: 'parroquia', parroquia: 'Parroquia Olegario Villalobos', camiones: 7, nota: null }]
  pintarCronograma(); out.pasado = leer()

  // Un error de lectura se dice, no se esconde.
  pintarCronograma('permiso denegado'); out.conError = leer()
  return out
})

const fallos = []
const exige = (ok, q) => { if (!ok) fallos.push(q) }
exige(/Caracciolo/.test(r.unaSola) && /12 camiones/.test(r.unaSola), 'un día normal no nombra parroquia y camiones')
exige(/Hoy martes/.test(r.unaSola), 'no dice que es hoy')
exige(r.unaSolaSeVe, '⛔ la franja tiene el texto pero NO SE VE: un display:none de la hoja de estilos le gana al style.display del JS')
exige(r.sinVigenciaSeVe, 'la franja sin cronograma vigente tampoco se ve')
exige(/JAC-B011 y JAC-B012/.test(r.unaSola), '⛔ no dice en la franja cuáles camiones no se ven')
exige(/máximo 10/.test(r.unaSola), 'con 12 comprometidos no dice el tope de 10 visibles')
// Con 9 comprometidos, decir «se ven como máximo 10» confunde: la salvedad va
// igual, pero redactada de otra forma.
exige(!/máximo 10/.test(r.dos), 'con 9 comprometidos repite un tope de 10 que no aplica')
exige(/JAC-B011/.test(r.dos), 'con 9 comprometidos deja de decir que hay 2 sin GPS')
// ⛔ LAS TRES QUE PRUEBAN QUE EL TEXTO SALE DEL DATO.
exige(/JAC-B007/.test(r.otra) && !/B011|B012/.test(r.otra),
  `⛔ LA SALVEDAD ESTÁ ESCRITA A MANO: con JAC-B007 sin GPS la franja dice "${r.otra.slice(-110)}"`)
exige(/no tiene GPS/.test(r.otra), 'con una sola unidad sigue hablando en plural')
exige(!/máximo/.test(r.otra), 'con 9 comprometidos y 11 visibles menciona un tope que no aplica')
exige(/máximo 11/.test(r.otra12), 'con 1 sin GPS y 12 comprometidos no calcula el tope de 11 visibles')
exige(!/GPS|B0\d\d|máximo/.test(r.completa),
  `⛔ CON LA FLOTA COMPLETA SIGUE AVISANDO de unidades sin GPS: "${r.completa.slice(-110)}"`)
exige(r.completaSeVe, 'con la flota completa la franja dejó de verse')
exige(/Caracciolo/.test(r.completa), 'con la flota completa se perdió la parroquia del día')
exige(/No se pudo comprobar/.test(r.noSeSabe),
  '⛔ si no se pudo leer la flota se ve igual que «están todas»')
exige(/Olegario/.test(r.dos) && /Santa Lucía/.test(r.dos), 'el lunes no muestra las dos parroquias')
exige(/9 camiones comprometidos/.test(r.dos), `el lunes no suma 7+2: "${r.dos.slice(0, 120)}"`)
exige(r.tocaDos.length === 2, `parroquiasDeHoy() devolvió ${r.tocaDos.length} el lunes`)
exige(/IMAU/.test(r.domingo), 'el domingo no dice que lo define el IMAU')
exige(!/Venancio|Olegario|Caracciolo|Santa Lucía/.test(r.domingo), '⛔ el domingo hereda una parroquia')
exige(r.tocaDomingo.length === 0, 'el domingo resalta una parroquia en el mapa')
exige(/Sin cronograma vigente/.test(r.sinVigencia), 'no distingue «sin cronograma vigente»')
exige(/no es que no tocara/i.test(r.sinVigencia), '⛔ sin cronograma no aclara que NO es «no tocaba nada»')
exige(/tocaba/.test(r.pasado), 'un día pasado no habla en pasado')
exige(/No se pudo leer/.test(r.conError), 'un error de lectura no se dice')
exige(errores.length === 0, 'errores de JS: ' + errores.join(' · '))

console.log('\n── LA FRANJA ──')
console.log('martes  : ' + r.unaSola)
console.log('lunes   : ' + r.dos)
console.log('domingo : ' + r.domingo)
console.log('sin vig.: ' + r.sinVigencia)
console.log('pasado  : ' + r.pasado)
console.log('otra uni: ' + r.otra)
console.log('completa: ' + r.completa)
console.log('no se sab: ' + r.noSeSabe)
if (fallos.length) { console.log(`\n⛔ ${fallos.length} falla(s):`); fallos.forEach(f => console.log('   · ' + f)) }
else console.log('\n✅ Los cinco estados salen bien, el domingo no hereda parroquia y los 2 sin GPS se dicen en la franja.')
await nav.close()
process.exit(fallos.length ? 1 : 0)
