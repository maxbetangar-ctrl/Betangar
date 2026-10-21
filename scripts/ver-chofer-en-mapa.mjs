// ═══════════════════════════════════════════════════════════════════════════════
// VER QUE EL MAPA DIGA QUIÉN MANEJA — EN UN NAVEGADOR
//
// Qué revisa, y por qué hace falta un navegador y no una prueba de texto:
//   1. Los CUATRO estados de la línea del chofer (con teléfono, sin nombre, sin
//      ficha, y planilla≠checklist) salen escritos como corresponde.
//   2. ⛔ QUE EL TELÉFONO ESTÉ ESCONDIDO HASTA QUE SE ELIJA LA UNIDAD. Eso es una
//      regla de CSS (`.u .u-tel{display:none}` / `.u.sel .u-tel{display:inline}`)
//      y es justo lo que una prueba de texto NO puede ver: el HTML trae el número
//      en los dos casos. Si esa regla se rompe, la pantalla de la oficina queda
//      con doce teléfonos a la vista y nadie se entera.
//
// ⛔ CÓMO, Y POR QUÉ ASÍ. El script de `mapa.html` vive dentro de una IIFE con
//    `use strict`, así que NADA suyo queda en `window` y no se le puede pedir
//    nada desde afuera. La salida fácil era agregarle al archivo de producción un
//    gancho `window.__prueba = ...`; no se hizo: una pantalla no lleva puertas
//    que existen solo para la prueba.
//    En vez de eso se EXTRAE del propio `mapa.html` su bloque `<style>` y el
//    código de `lineaChofer` y `esc`, y se corre eso. O sea que lo que se prueba
//    es el texto del archivo, no una copia escrita a mano acá.
//    ⚠️ Si la extracción falla, la prueba REVIENTA en vez de dar verde: una
//    prueba que no encuentra qué probar y pasa igual es peor que no tenerla.
//
// ⛔ QUÉ NO PRUEBA: ni la función de la base ni los permisos — eso lo prueba el
//    control positivo de `migrations/gps_chofer_del_dia_2026-10-21.sql` contra la
//    base de verdad. Acá se prueba la PANTALLA.
//
// Uso: node scripts/ver-chofer-en-mapa.mjs
// ═══════════════════════════════════════════════════════════════════════════════
import { pathToFileURL } from 'url'
import fs from 'fs'
import path from 'path'

const ARCHIVO = path.resolve('mapa.html')
const GLOBAL = 'C:/Users/Maxbetangar/AppData/Roaming/npm/node_modules/playwright/index.js'

const html = fs.readFileSync(ARCHIVO, 'utf8')

/** Saca un trozo del archivo, o revienta diciendo qué no encontró. */
function sacar(re, que) {
  const m = html.match(re)
  if (!m) {
    console.error(`⛔ No se pudo extraer ${que} de mapa.html. La prueba NO corrió.`)
    console.error('   (cambió el archivo: hay que actualizar este script, no ignorarlo)')
    process.exit(2)
  }
  return m[1]
}

const css        = sacar(/<style>([\s\S]*?)<\/style>/, 'el bloque <style>')
const fnEsc      = sacar(/(function esc\(s\)\{[\s\S]*?\}\); \})/, 'la función esc()')
const fnLinea    = sacar(/(\/\*\* La línea de la tarjeta[\s\S]*?\n\})/, 'la función lineaChofer()')

if (!/\.u-tel\{display:none\}/.test(css) || !/\.u\.sel \.u-tel\{display:inline\}/.test(css)) {
  console.error('⛔ El CSS del archivo ya no trae las reglas del teléfono. La prueba NO corrió.')
  process.exit(2)
}

let pw
try { pw = await import('playwright') }
catch { pw = await import(pathToFileURL(GLOBAL).href) }
const chromium = pw.chromium || (pw.default && pw.default.chromium)
if (!chromium) {
  console.error('Falta Playwright (está instalado GLOBAL a propósito):')
  console.error('  npm i -g playwright && npx playwright install chromium')
  process.exit(1)
}

const nav = await chromium.launch()
const pag = await (await nav.newContext()).newPage()
const errores = []
pag.on('pageerror', e => errores.push(String(e.message).slice(0, 180)))

// Una página de laboratorio: el CSS y el código SON los del archivo.
await pag.setContent(`<!doctype html><html><head><style>${css}</style></head>
<body><div id="lista"></div><script>
${fnEsc}
var CHOFERES={};
${fnLinea}
window.__esc=esc; window.__linea=lineaChofer;
window.__set=function(c){ CHOFERES=c; };
</script></body></html>`, { waitUntil: 'load' })

const CASOS = {
  'JAC-B001': { cam: 'JAC-B001', nombre: 'YOHENDRY JOSE TAPIA TAPIA', telefono: '584126514694',
                wa: '584126514694', fuente: 'checklist', nota: null, otro_nombre: null },
  'JAC-B002': { cam: 'JAC-B002', nombre: null, telefono: null, wa: null, fuente: 'checklist',
                nota: 'nadie firmó el checklist de esta unidad todavía', otro_nombre: null },
  'JAC-B003': { cam: 'JAC-B003', nombre: 'PEPE SIN FICHA', telefono: null, wa: null, fuente: 'checklist',
                nota: 'ese nombre no figura en el padrón de empleados: no se puede dar un teléfono',
                otro_nombre: null },
  'JAC-B004': { cam: 'JAC-B004', nombre: 'UNO DE LA PLANILLA', telefono: '584140000000',
                wa: '584140000000', fuente: 'planilla', nota: null, otro_nombre: 'OTRO DEL CHECKLIST' },
  // Un nombre con comillas y `<` : si no se escapa, rompe la tarjeta.
  'JAC-B005': { cam: 'JAC-B005', nombre: 'JOSE "EL <b>MALO</b>"', telefono: '584140000001',
                wa: '584140000001', fuente: 'checklist', nota: null, otro_nombre: null },
}

const r = await pag.evaluate((casos) => {
  window.__set(casos)
  const out = {}
  for (const cam of Object.keys(casos)) out[cam] = window.__linea(cam)

  // Tarjeta de verdad, para medir el CSS y no el HTML.
  const cont = document.getElementById('lista')
  cont.innerHTML = '<div class="u" data-cam="JAC-B001">' + out['JAC-B001'] + '</div>'
  const tarjeta = cont.querySelector('.u')
  const tel = tarjeta.querySelector('.u-tel')
  const antes = getComputedStyle(tel).display
  tarjeta.classList.add('sel')
  const despues = getComputedStyle(tel).display
  const a = tel.querySelector('a')

  // El nombre con `<b>` NO debe producir negrita de verdad.
  cont.innerHTML = '<div class="u sel">' + out['JAC-B005'] + '</div>'
  const negritas = cont.querySelectorAll('.u-chof b').length

  return { out, antes, despues, enlace: a ? a.getAttribute('href') : null, negritas }
}, CASOS)

const fallos = []
const exige = (ok, que) => { if (!ok) fallos.push(que) }

exige(/Chofer/.test(r.out['JAC-B001']) && /YOHENDRY/.test(r.out['JAC-B001']), 'con chofer: no muestra el nombre')
exige(/584126514694/.test(r.out['JAC-B001']), 'con chofer: no muestra el teléfono')
exige(/Sin chofer declarado/.test(r.out['JAC-B002']), 'sin nombre: no dice «Sin chofer declarado»')
exige(!/undefined|>null</.test(r.out['JAC-B002']), 'sin nombre: se escapó un undefined/null a la pantalla')
exige(/no figura en el padrón/.test(r.out['JAC-B003']), 'sin ficha: no dice por qué no hay teléfono')
exige(/OTRO DEL CHECKLIST/.test(r.out['JAC-B004']), 'planilla≠checklist: no avisa de la diferencia')
exige(/planilla/.test(r.out['JAC-B004']), 'no dice de dónde salió el dato')
// El `<b>` del dato no puede crear un `<b>` en la página: solo queda el de «Chofer <b>».
exige(r.negritas === 1, `un nombre con HTML adentro produjo ${r.negritas} negritas (debería ser 1)`)

// ⛔ LAS DOS QUE SOLO SE PUEDEN HACER EN UN NAVEGADOR
exige(r.antes === 'none', `el teléfono se ve SIN elegir la unidad (display=${r.antes})`)
exige(r.despues !== 'none', `el teléfono NO aparece al elegir la unidad (display=${r.despues})`)
exige(r.enlace === 'https://wa.me/584126514694', `el enlace de WhatsApp es ${r.enlace}`)
exige(errores.length === 0, 'errores de JS: ' + errores.join(' · '))

console.log('\n── LO QUE LA PANTALLA ESCRIBE ──')
for (const cam of Object.keys(r.out)) {
  const t = r.out[cam].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
  console.log(`${cam}: ${t || '(nada)'}`)
}
console.log(`\nteléfono sin elegir la unidad: ${r.antes}   ·   al elegirla: ${r.despues}`)

if (fallos.length) {
  console.log(`\n⛔ ${fallos.length} falla(s):`)
  for (const f of fallos) console.log('   · ' + f)
} else {
  console.log('\n✅ Los 5 casos salen bien, el nombre se escapa, y el teléfono SOLO se ve al elegir la unidad.')
}

await nav.close()
process.exit(fallos.length ? 1 : 0)
