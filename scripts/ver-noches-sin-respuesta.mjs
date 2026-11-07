// ═══════════════════════════════════════════════════════════════════════════════
// LA LISTA DE NOCHES SIN RESPUESTA, Y QUE NO CONTAMINE EL PORTÓN DEL AVISO
//
// 🔴 POR QUÉ EXISTE. Al empezar a guardar R14 (sobrantes nocturnos) en
//    `comb_auditoria_sombra`, sus filas entraron a `_acSombraEstado`, que es lo
//    que calcula el EXAMEN del kill-switch — el único candado que impide que el
//    sistema vuelva a insinuarle a una persona que se robó combustible. Marcar
//    «sí, esa noche le cargaron» habría contado como un faltante bien detectado
//    y podía ABRIR el portón con cero faltantes verificados.
//
//    Esta prueba fija las dos cosas: que el examen cuente SOLO R1, y que las
//    noches se vean en su propia lista, redactadas como pregunta.
//
// ⛔ NO ESCRIBE NADA: todo Supabase está interceptado.
//
// Uso: node scripts/ver-noches-sin-respuesta.mjs [--desplegado]
// ═══════════════════════════════════════════════════════════════════════════════
import { pathToFileURL } from 'url'
import { readFileSync } from 'fs'
import { getPAT } from '../../maxware-tools/pat.mjs'

const DESPLEGADO = process.argv.includes('--desplegado')
const REF = 'hrkjddehqnzcqwlkklqm'
const RAIZ = new URL('../', import.meta.url)
const GLOBAL = 'C:/Users/Maxbetangar/AppData/Roaming/npm/node_modules/playwright/index.js'

let pw
try { pw = await import('playwright') }
catch { try { pw = await import(pathToFileURL(GLOBAL).href) }
        catch { console.error('Falta Playwright: npm i -g playwright'); process.exit(1) } }

const JS_APP = readFileSync(new URL('./app.js', RAIZ), 'utf8')
if (!JS_APP.includes('pendNoche')) {
  console.error('⛔ El app.js de disco no separa las noches. Estarías revisando la versión vieja.')
  process.exit(1)
}

const pat = await getPAT()
const sql = async (q) => {
  const r = await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`, {
    method: 'POST', headers: { Authorization: `Bearer ${pat}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: q }),
  })
  if (!r.ok) { console.error('⛔ ' + (await r.text()).slice(0, 250)); process.exit(1) }
  return r.json()
}

const SOMBRA = await sql(`select id::text, alert_key, fecha::text fecha, regla, cam,
                                 litros::text litros, tolerancia::text tolerancia, detalle, veredicto
                            from comb_auditoria_sombra order by fecha desc limit 500`)
const TAN = await sql(`select * from combustible_tanques_config`)
const porRegla = {}
for (const s of SOMBRA) porRegla[s.regla] = (porRegla[s.regla] || 0) + 1
console.log('Filas reales en sombra:', SOMBRA.length, JSON.stringify(porRegla), '\n')

const chromium = pw.chromium || (pw.default && pw.default.chromium)
const browser = await chromium.launch()
const page = await (await browser.newContext()).newPage()
const errores = []
page.on('pageerror', (e) => errores.push(e.message))
if (!DESPLEGADO) await page.route('**/app.js*', (r) => r.fulfill({ contentType: 'application/javascript', body: JS_APP }))
else console.log('⚠️  --desplegado: el código DE LA CALLE.\n')
await page.route('**/*.supabase.co/**', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: '[]' }))
await page.goto('https://betangar.com/app.html', { waitUntil: 'domcontentloaded' })
await page.waitForFunction(() => typeof window._acSombraEstado === 'function', { timeout: 20000 })

const out = await page.evaluate(([somb, tan]) => {
  window.AC_TANQUES = tan.map((t) => {
    let tabla = t.tabla_cubicacion
    if (typeof tabla === 'string') { try { tabla = JSON.parse(tabla) } catch (e) { tabla = null } }
    return { id: t.id, nombre: t.nombre, tipo: t.tipo, cap: Number(t.capacidad_litros),
             hmax: Number(t.altura_max_cm), tabla, forma: t.forma || null,
             origen: t.tabla_origen || null, tablaDesde: t.tabla_desde || null }
  })
  window.AC_SOMBRA = somb
  window.AC_META = window.AC_META || {}
  // ⛔ Los botones de veredicto solo se dibujan para superadmin/admin/socios, y sin eso la prueba
  //    medía una lista SIN botones y no podía decir nada de su redacción. Se pone el rol: es lo
  //    que va a ver la persona que de verdad tiene que cerrar estas noches.
  window.SESION = Object.assign({}, window.SESION || {}, { rol: 'superadmin', usuario: 'prueba' })
  const e = window._acSombraEstado()
  // El HTML se renderiza de verdad y se mide en el DOM, no se inspecciona la cadena:
  // una pantalla se revisa en una pantalla.
  const caja = document.createElement('div')
  caja.innerHTML = window._acSombraHtml()
  document.body.appendChild(caja)
  const titulos = [...caja.querySelectorAll('.st')].map((n) => n.textContent.trim())
  // ⛔ La redacción se mide EN LA TARJETA DE LAS NOCHES, no en todo el panel: el panel incluye la
  //    de faltantes, que dice «faltan» con todo derecho. Una aserción que no acota dónde mira
  //    acusa al producto de lo que escribió otra tarjeta.
  //    [[norma-una-asercion-mal-escrita-acusa-al-producto]]
  const tarjetas = [...caja.querySelectorAll(':scope > .card')]
  const tNoche = tarjetas.find((t) => /amaneció con más/i.test(t.querySelector('.st')?.textContent || ''))
  const tFalta = tarjetas.find((t) => /faltantes esperando/i.test(t.querySelector('.st')?.textContent || ''))
  const bot = (t) => (t ? [...t.querySelectorAll('button')].map((b) => b.textContent.trim()) : [])
  return { ev: e.ev, ok: e.ok, prec: e.prec, examenOk: e.examenOk,
           pend: e.pend.length, pendNoche: (e.pendNoche || []).length,
           pendReglas: [...new Set(e.pend.map((x) => x.regla))],
           pendNocheReglas: [...new Set((e.pendNoche || []).map((x) => x.regla))],
           titulos, textoNoche: tNoche ? tNoche.textContent : '', textoFalta: tFalta ? tFalta.textContent : '',
           botonesNoche: bot(tNoche), botonesFalta: bot(tFalta) }
}, [SOMBRA, TAN])

let fallos = 0
const chk = (n, c, d = '') => { if (c) console.log('  ✓ ' + n); else { console.log('  ✗ ' + n + (d ? '  → ' + d : '')); fallos++ } }

console.log('EL PANEL MUESTRA')
out.titulos.forEach((t) => console.log('   · ' + t))
console.log(`\n   examen: ${out.ev} evaluados · acierto ${out.prec == null ? '—' : Math.round(out.prec * 100) + '%'} · aprobado=${out.examenOk}`)
console.log(`   cola del examen (R1): ${out.pend}  ${JSON.stringify(out.pendReglas)}`)
console.log(`   noches sin respuesta: ${out.pendNoche}  ${JSON.stringify(out.pendNocheReglas)}\n`)

const r14enBase = SOMBRA.filter((s) => s.regla === 'R14').length
const r1enBase = SOMBRA.filter((s) => (s.regla || 'R1') === 'R1').length
const r1pendEnBase = SOMBRA.filter((s) => (s.regla || 'R1') === 'R1' && s.veredicto === 'pendiente').length
const r14pendEnBase = SOMBRA.filter((s) => s.regla === 'R14' && s.veredicto === 'pendiente').length

// 🔴 La aserción que importa: ni una fila de R14 puede estar en el examen.
chk('el EXAMEN no cuenta ninguna fila de R14',
    out.ev === SOMBRA.filter((s) => (s.regla || 'R1') === 'R1' && (s.veredicto === 'verdadera' || s.veredicto === 'falsa')).length,
    `examen=${out.ev}, evaluadas R1 en base=${SOMBRA.filter((s) => (s.regla || 'R1') === 'R1' && (s.veredicto === 'verdadera' || s.veredicto === 'falsa')).length}, R14 en base=${r14enBase}`)
chk('la cola del examen es SOLO R1', out.pendReglas.every((r) => (r || 'R1') === 'R1') && out.pend === r1pendEnBase,
    JSON.stringify(out.pendReglas) + ' · ' + out.pend + ' vs ' + r1pendEnBase)
chk('las noches salen en su propia lista, completas', out.pendNoche === r14pendEnBase,
    out.pendNoche + ' vs ' + r14pendEnBase + ' en base')
chk('y son todas R14', out.pendNocheReglas.every((r) => r === 'R14'), JSON.stringify(out.pendNocheReglas))
chk('la lista de noches aparece en el panel', out.titulos.some((t) => /amaneció con más/i.test(t)), JSON.stringify(out.titulos))
// Redacción: acá no falta combustible, SOBRA. Lo que estaría mal es decir que falta —«faltan 150 L»,
// «faltó combustible»—, no la palabra «falta» suelta: «falta asentar la surtida» es exactamente lo
// que hay que decir. La primera versión de esta aserción prohibía la palabra y se marcó roja contra
// su propio botón. Una aserción gruesa acusa al producto de lo que no hizo.
// [[norma-una-asercion-mal-escrita-acusa-al-producto]]
// Nombrar «el aviso de faltantes» está bien —es la otra alerta, y conviene decir que no se toca—.
// Lo que no puede aparecer es la AFIRMACIÓN de que falta combustible: «faltan 150 L», «faltó
// combustible». Por eso la expresión pide la cifra o la palabra combustible al lado, no la palabra sola.
const DICE_QUE_FALTA = /falt(an|ó|aron)\s+(unos\s+)?[\d.,]+\s*L|falt(ó|a)\s+combustible/i
chk('la lista de noches NO dice que falte combustible', !DICE_QUE_FALTA.test(out.textoNoche),
    'calza en: ' + JSON.stringify((out.textoNoche.match(DICE_QUE_FALTA) || [])[0] || ''))
// Y el control positivo de esa misma aserción: en la tarjeta de los faltantes SÍ tiene que calzar,
// o estaría probando una expresión que no sabe reconocer la frase que busca.
chk('…y esa misma expresión SÍ reconoce la tarjeta de faltantes (control positivo)',
    r1pendEnBase === 0 || DICE_QUE_FALTA.test(out.textoFalta),
    JSON.stringify(out.textoFalta.slice(0, 100)))
chk('dice qué hacer: asentar la surtida', /asentar la surtida/i.test(out.textoNoche))
chk('aclara que no acusa a nadie ni mueve el aviso de faltantes',
    /no acusa a nadie/i.test(out.textoNoche))
chk('los botones de la noche PREGUNTAN, no acusan',
    out.botonesNoche.some((b) => /Sí le cargaron/i.test(b)) && out.botonesNoche.some((b) => /No le cargaron/i.test(b)),
    JSON.stringify(out.botonesNoche))
chk('y ningún botón de la noche dice "era de verdad" (eso es del faltante)',
    !out.botonesNoche.some((b) => /Era de verdad/i.test(b)), JSON.stringify(out.botonesNoche))
chk('el faltante conserva SUS botones',
    r1pendEnBase === 0 || out.botonesFalta.some((b) => /Era de verdad/i.test(b)),
    JSON.stringify(out.botonesFalta))

if (errores.length) { console.log('\n  ⚠️ consola:'); errores.slice(0, 5).forEach((e) => console.log('     ' + e)) }
await browser.close()
console.log('\n  ' + (fallos ? '⛔ ' + fallos + ' fallaron' : '✅ todo en verde') + '\n')
process.exit(fallos ? 1 : 0)
