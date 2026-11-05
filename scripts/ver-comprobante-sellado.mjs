// ═══════════════════════════════════════════════════════════════════════════════
// EL COMPROBANTE DE RETENCIÓN, SELLADO, EN UN NAVEGADOR
//
// 🔴 POR QUÉ EXISTE. Máximo, 05/11/2026: «que la retencion venga de una con el
//    sello y mi firma de betangar, [...] pero por favor revisas en vivo antes
//    para ver que todo esta bien». Hasta hoy el comprobante salía con la raya
//    vacía y el sello se ponía por el otro camino: Keily lo mandaba por
//    WhatsApp y la PC de Máximo lo sellaba con `sellar-retenciones.py`.
//
// ⛔ POR QUÉ HAY QUE MIRARLO Y NO ALCANZA CON LAS PRUEBAS. Lo que cambió es
//    DÓNDE CAE una imagen sobre una hoja: 445×333 estampada encima de la raya
//    de firma, en una página `letter landscape`. `test/retencion-comprobante.
//    test.js` prueba que el `<img>` está en la celda del agente y no en la del
//    proveedor — pero un sello corrido 3 cm, o que pise la tabla de montos, o
//    que salga en blanco al imprimir, pasa esas pruebas igual.
//    Ya pasó el 28/10: las consultas en verde y el PDF renderizado mostró una
//    etiqueta PISANDO el monto. [[norma-una-pantalla-se-revisa-en-una-pantalla]]
//
// QUÉ HACE, y por qué así:
//   · Abre el `app.html` DESPLEGADO y le sirve el `app.js` + el
//     `retencion-comprobante.js` DE DISCO: la página es la real y el código es
//     el nuevo, el que se está por soltar.
//   · INTERCEPTA todo Supabase: no se lee ni se escribe nada real.
//   · Le siembra una factura que YA TIENE número de comprobante
//     (`comp_iva`/`comp_islr`), así `emitirComprobanteRet()` entra por el
//     camino de REIMPRESIÓN. ⛔ Eso es a propósito: emitir de nuevo pediría un
//     número a la base y QUEMARÍA un correlativo fiscal de verdad. Un número
//     que salió no se devuelve.
//   · El sello se baja de la base en el momento (con el PAT, desde la PC) y se
//     le sirve a la página. ⛔ NO vive en el repo: Betangar se publica por
//     GitHub Pages y la firma de Máximo quedaría descargable por cualquiera.
//   · Captura la ventana de impresión con `emulateMedia({media:'print'})` —
//     que es la hoja que va a salir, no la pantalla.
//
// ⛔ QUÉ NO PRUEBA: ni el login, ni los permisos, ni el RLS del sello (eso lo
//    mide `pruebas/sello-solo-para-quien-administra.mjs`, adentro de Postgres,
//    con control positivo). Ni el reparto del correlativo, que no se tocó.
//    Esto prueba LA HOJA. [[norma-probar-el-camino-no-la-pieza]]
//
// Uso: node scripts/ver-comprobante-sellado.mjs [url]
// ═══════════════════════════════════════════════════════════════════════════════
import { pathToFileURL, fileURLToPath } from 'url'
import { readFileSync, writeFileSync, mkdirSync } from 'fs'
import { getPAT } from '../../maxware-tools/pat.mjs'

const URL_APP = process.argv[2] || 'https://betangar.com/app.html'
const REF = 'hrkjddehqnzcqwlkklqm'
const RAIZ = new URL('../', import.meta.url)
const SALIDA = new URL('./pruebas/_sello/', RAIZ)
const GLOBAL = 'C:/Users/Maxbetangar/AppData/Roaming/npm/node_modules/playwright/index.js'

let pw
try { pw = await import('playwright') }
catch {
  try { pw = await import(pathToFileURL(GLOBAL).href) }
  catch {
    console.error('Falta Playwright (se instalo GLOBAL a proposito):')
    console.error('  npm i -g playwright && npx playwright install chromium')
    process.exit(1)
  }
}

// ── El código local, y el arnés se NIEGA a correr si no trae lo nuevo ────────
// Sin esto se revisaría la versión vieja y saldría verde por nada.
const JS_APP = readFileSync(new URL('./app.js', RAIZ), 'utf8')
const JS_RET = readFileSync(new URL('./retencion-comprobante.js', RAIZ), 'utf8')
if (!JS_APP.includes('retTraerSello')) {
  console.error('⛔ El app.js de disco NO trae `retTraerSello`. Estarías revisando la version vieja.')
  process.exit(1)
}
if (!JS_RET.includes('retEscAttr') || !JS_RET.includes('class="sello"')) {
  console.error('⛔ El retencion-comprobante.js de disco NO trae el sello. Nada que revisar.')
  process.exit(1)
}

// ── El sello, de la base, ahora ──────────────────────────────────────────────
const pat = await getPAT()
const r = await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`, {
  method: 'POST',
  headers: { Authorization: `Bearer ${pat}`, 'Content-Type': 'application/json' },
  body: JSON.stringify({ query: "select png_dataurl from empresa_sello where clave='retencion'" }),
})
if (!r.ok) { console.error('⛔ No pude traer el sello de la base: ' + (await r.text()).slice(0, 200)); process.exit(1) }
const fila = (await r.json())[0]
if (!fila || !fila.png_dataurl) { console.error('⛔ La base no tiene la fila «retencion» en empresa_sello.'); process.exit(1) }
const SELLO = fila.png_dataurl
console.log('Sello traido de la base: ' + SELLO.length + ' caracteres · ' + SELLO.slice(0, 30) + '…')

// ── La factura: datos REALES de Betangar, con el número ya emitido ───────────
// Es la 571 que GALAC emitió y que el módulo ya reproduce al céntimo, más un
// número de control inventado SOLO para esta prueba — en la base esa factura no
// lo tiene, y por eso hoy no se puede emitir de verdad. Va marcado como tal.
const FAC = {
  id: 'PRUEBA-SELLO', prov_id: 'PRV1', prov_nombre: 'HUMBERTO PACCINI (ATLAS)',
  fecha: '2026-09-30', nro_factura: '00012345', num_control: '00-9999999 (DE PRUEBA)',
  base_bs: 120960.00, iva_pct: 16, iva_bs: 19353.60,
  ret_iva_pct: 75, ret_iva_bs: 14515.20,
  ret_islr_pct: 2, sustraendo_bs: 0, ret_islr_bs: 2419.20,
  total_bs: 140313.60,
  comp_iva: '20260900000571', comp_islr: '2026100000000199',
}
const PRV = { id: 'PRV1', nombre: 'HUMBERTO PACCINI (ATLAS)', razon_social: 'HUMBERTO PACCINI', rif: 'V-16877824-0' }

const chromium = pw.chromium || (pw.default && pw.default.chromium)
if (!chromium) { console.error('Playwright se importo pero no trae `chromium`.'); process.exit(1) }
const browser = await chromium.launch()
// Contexto NUEVO siempre: revisar con el navegador que ya usaste es otro producto.
const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } })
const page = await ctx.newPage()

const errores = []
page.on('console', m => { if (m.type() === 'error') errores.push(m.text()) })
page.on('pageerror', e => errores.push('PAGEERROR: ' + e.message))

// El código de disco en lugar del desplegado.
await page.route('**/app.js*', route => route.fulfill({ contentType: 'application/javascript', body: JS_APP }))
await page.route('**/retencion-comprobante.js*', route => route.fulfill({ contentType: 'application/javascript', body: JS_RET }))

// ⛔ NADA real: todo Supabase se contesta acá. El sello se sirve a mano porque
//    su RLS se prueba aparte, adentro de la base.
await page.route('**/*.supabase.co/**', route => {
  const url = route.request().url()
  if (url.includes('empresa_sello')) {
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ png_dataurl: SELLO }) })
  }
  if (url.includes('/auth/v1/')) {
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ user: null, session: null }) })
  }
  return route.fulfill({ status: 200, contentType: 'application/json', body: '[]' })
})

await page.goto(URL_APP, { waitUntil: 'domcontentloaded' })
await page.waitForFunction(() => typeof window.retHtmlIVA === 'function', { timeout: 20000 })

// ── Se le siembra la factura y se llama al EMISOR de la app ──────────────────
// No se arma el HTML a mano: se pasa por `emitirComprobanteRet()`, que es el
// camino que va a usar Keily. Al tener `comp_iva` puesto, reimprime y no pide
// número. Se le roba el `window.open` para quedarnos con el HTML.
const salida = await page.evaluate(async ([fac, prv]) => {
  // El cliente de base NO existe antes del login, y `window.supabase` a esta
  // altura es LA LIBRERIA del CDN. Se crea el cliente a mano: toda la red esta
  // interceptada, asi que no sale nada ni entra nada real.
  if (typeof window.initSupabaseClient === 'function') window.initSupabaseClient()
  window.CXP_FACTURAS = [fac]
  window.PROVEEDORES = [prv]
  window.DB_READY = false
  const abiertas = []
  window.open = function () {
    const w = { document: { write: h => abiertas.push(h), close: () => {} }, focus: () => {}, print: () => {} }
    return w
  }
  window.alert = m => abiertas.push('ALERT: ' + m)
  window.confirm = m => { abiertas.push('CONFIRM: ' + m); return false }
  await window.emitirComprobanteRet(fac.id, 'IVA')
  const iva = abiertas.slice()
  abiertas.length = 0
  await window.emitirComprobanteRet(fac.id, 'ISLR')
  return { iva, islr: abiertas.slice() }
}, [FAC, PRV])

mkdirSync(SALIDA, { recursive: true })
let fallos = 0
const chequear = (nombre, cond, detalle) => {
  if (cond) console.log('  ✓ ' + nombre)
  else { console.log('  ✗ ' + nombre + (detalle ? '  → ' + detalle : '')); fallos++ }
}

console.log('\nLO QUE EL EMISOR DE LA APP DEVOLVIO')
for (const [tipo, lista] of [['IVA', salida.iva], ['ISLR', salida.islr]]) {
  const avisos = lista.filter(x => /^(ALERT|CONFIRM): /.test(x))
  const html = lista.find(x => !/^(ALERT|CONFIRM): /.test(x))
  if (avisos.length) console.log('  ⚠️ ' + tipo + ': ' + avisos.join(' | ').slice(0, 300))
  chequear(tipo + ': salió una hoja', !!html, 'no se abrió ninguna ventana')
  if (!html) continue
  chequear(tipo + ': la hoja trae el sello', html.includes('class="sello"'))
  chequear(tipo + ': el sello es el de la base', html.includes(SELLO.slice(0, 60)))

  // Se renderiza la hoja de verdad, en media `print`, y se mide DONDE cayó el
  // sello respecto de la raya del agente. Un `<img>` presente no es un sello
  // bien puesto.
  const hoja = await ctx.newPage()
  await hoja.setViewportSize({ width: 1100, height: 850 })
  await hoja.setContent(html)
  await hoja.emulateMedia({ media: 'print' })
  await hoja.waitForLoadState('load')
  // ⛔ SE MIDE LA TINTA, NO LA CAJA. El PNG del sello es 88% transparente:
  //    su `<img>` puede cruzar la raya mientras lo que se VE flota 1 cm por
  //    encima. Eso fue exactamente lo que paso en la primera corrida — las
  //    nueve medidas en verde y la hoja mal. Asi que acá se dibuja el PNG en
  //    un canvas, se busca el recuadro de los píxeles con alfa, y se lo lleva
  //    a coordenadas de la página. Lo que se mide es lo que el ojo ve.
  const geo = await hoja.evaluate(() => {
    const img = document.querySelector('img.sello')
    const celdas = document.querySelectorAll('table.firmas td')
    const raya = celdas[0] && celdas[0].querySelector('.raya')
    const tablas = Array.from(document.querySelectorAll('table.t'))
    const ultima = tablas[tablas.length - 1]
    const r = x => x ? x.getBoundingClientRect() : null
    const b = { img: r(img), raya: r(raya), celdaDer: r(celdas[1]), tabla: r(ultima) }

    let tinta = null
    if (img && img.complete && img.naturalWidth > 0) {
      const c = document.createElement('canvas')
      c.width = img.naturalWidth; c.height = img.naturalHeight
      const cx = c.getContext('2d')
      cx.drawImage(img, 0, 0)
      const d = cx.getImageData(0, 0, c.width, c.height).data
      let x0 = c.width, y0 = c.height, x1 = -1, y1 = -1
      for (let y = 0; y < c.height; y++) for (let x = 0; x < c.width; x++) {
        if (d[(y * c.width + x) * 4 + 3] > 10) {
          if (x < x0) x0 = x; if (x > x1) x1 = x
          if (y < y0) y0 = y; if (y > y1) y1 = y
        }
      }
      if (x1 >= 0) {
        const k = b.img.width / c.width          // la misma escala en los dos ejes
        tinta = { x: b.img.x + x0 * k, y: b.img.y + y0 * k,
                  w: (x1 - x0 + 1) * k, h: (y1 - y0 + 1) * k }
      }
    }
    return {
      img: b.img && { x: b.img.x, y: b.img.y, w: b.img.width, h: b.img.height },
      tinta: tinta,
      raya: b.raya && { x: b.raya.x, y: b.raya.y, w: b.raya.width },
      celdaDer: b.celdaDer && { x: b.celdaDer.x, w: b.celdaDer.width },
      tablaAbajo: b.tabla && b.tabla.bottom,
      visible: img ? (img.complete && img.naturalWidth > 0) : false,
      natural: img ? [img.naturalWidth, img.naturalHeight] : null,
    }
  })
  chequear(tipo + ': el PNG CARGÓ (no es un cuadro roto)', geo.visible,
           'naturalWidth=' + JSON.stringify(geo.natural))
  chequear(tipo + ': el PNG es el de 445×333', JSON.stringify(geo.natural) === '[445,333]',
           JSON.stringify(geo.natural))
  chequear(tipo + ': se pudo medir la TINTA del sello', !!geo.tinta)
  if (geo.tinta && geo.raya) {
    const t = geo.tinta
    const centroTinta = t.x + t.w / 2
    const centroRaya = geo.raya.x + geo.raya.w / 2
    chequear(tipo + ': la tinta está CENTRADA sobre la raya del agente (±8 px)',
             Math.abs(centroTinta - centroRaya) <= 8,
             'desvío de ' + Math.abs(centroTinta - centroRaya).toFixed(1) + ' px')
    // Como un sello puesto a mano: arranca arriba de la raya y la CRUZA.
    const abajo = t.y + t.h
    chequear(tipo + ': la tinta CRUZA la raya, no flota encima',
             abajo > geo.raya.y && t.y < geo.raya.y,
             'tinta ' + t.y.toFixed(0) + '→' + abajo.toFixed(0) + ', raya en ' + geo.raya.y.toFixed(0))
    // Que la cruce poco: un sello 3 cm por debajo tapa el texto del pie.
    chequear(tipo + ': y la cruza por poco (≤ 12 px por debajo)',
             abajo - geo.raya.y <= 12, (abajo - geo.raya.y).toFixed(1) + ' px por debajo')
    // Se ve: ni un sello de 10 px ni uno que desborde la raya.
    chequear(tipo + ': la tinta ocupa entre el 35% y el 95% del ancho de la raya',
             t.w >= geo.raya.w * 0.35 && t.w <= geo.raya.w * 0.95,
             'tinta ' + t.w.toFixed(0) + ' px sobre una raya de ' + geo.raya.w.toFixed(0))
    // ⛔ Y NO PISA LA TABLA DE MONTOS: es el defecto del 28/10 otra vez.
    chequear(tipo + ': la tinta NO pisa la última tabla de montos',
             t.y > geo.tablaAbajo,
             'tinta arranca en ' + t.y.toFixed(0) + ' y la tabla termina en ' + geo.tablaAbajo.toFixed(0))
    // Y se queda en su mitad: la derecha la firma el proveedor.
    chequear(tipo + ': la tinta no se mete en la mitad del sujeto retenido',
             t.x + t.w <= geo.celdaDer.x + 2,
             'tinta termina en ' + (t.x + t.w).toFixed(0) + ', la celda derecha arranca en ' + geo.celdaDer.x.toFixed(0))
  }
  // En Windows `screenshot({path})` quiere una ruta de TEXTO: pasarle un URL
  // revienta con «path67.lastIndexOf is not a function», que no dice nada.
  const png = fileURLToPath(new URL('comprobante-' + tipo + '.png', SALIDA))
  await hoja.screenshot({ path: png, fullPage: true })
  writeFileSync(fileURLToPath(new URL('comprobante-' + tipo + '.html', SALIDA)), html)
  console.log('    🖼  ' + png)
  await hoja.close()
}

if (errores.length) { console.log('\n  ⚠️ errores de consola:'); errores.slice(0, 8).forEach(e => console.log('     ' + e)) }
await browser.close()

console.log('\n  ' + (fallos ? '⛔ ' + fallos + ' fallaron' : '✅ todo en verde') +
            ' — y ahora MIRÁ los PNG: una medida en verde no es una hoja bien hecha.\n')
process.exit(fallos ? 1 : 0)
