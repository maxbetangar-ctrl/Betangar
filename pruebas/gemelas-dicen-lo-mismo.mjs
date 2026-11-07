#!/usr/bin/env node
// ══════════════════════════════════════════════════════════════════════════════════════════════
// LAS DOS GEMELAS TIENEN QUE DECIR LO MISMO
//
// ⛔ POR QUÉ EXISTE. La auditoría de combustible está escrita DOS VECES: en `app.js` (lo que ve
//    el dueño en pantalla) y en `auditar-combustible/index.ts` (lo que sale por WhatsApp y lo que
//    se guarda en la tabla sombra). El código lo dice en varios lugares —«si se toca una, se toca
//    la otra»— pero NADA lo comprobaba.
//
// 🔴 Y ya falló: el 14/10/2026 la pantalla reportaba 8 unidades con faltante y la edge 5. Las 3
//    de más eran acusaciones falsas. Se descubrió de casualidad. Un comentario que pide
//    coherencia no es un candado. [[norma-dos-listas-a-mano-se-desincronizan]]
//
// ⛔ QUÉ NO PRUEBA: no prueba que la regla sea correcta — prueba que las dos implementaciones
//    dan el MISMO resultado sobre los MISMOS datos reales. Las dos pueden estar mal juntas.
//
// Uso:  node pruebas/gemelas-dicen-lo-mismo.mjs [fecha] [fecha2 ...]
//       sin fechas, usa los últimos 10 días con mediciones.
// ══════════════════════════════════════════════════════════════════════════════════════════════
import { readFileSync } from 'fs'
import { execSync } from 'node:child_process'
import { pathToFileURL } from 'node:url'

const REF = 'hrkjddehqnzcqwlkklqm'
const CASA = 'C:/Users/Maxbetangar'
const { cargarAuditoria, sembrar } = await import(pathToFileURL(CASA + '/Betangar/pruebas/_banco-combustible.mjs').href)
const { getPAT } = await import(pathToFileURL(CASA + '/maxware-tools/pat.mjs').href)

const dump = CASA + '/Betangar/pruebas/datos/combustible-real.json'
let datos
try { datos = JSON.parse(readFileSync(dump, 'utf8')) }
catch { console.error('⛔ falta el volcado: corré `node pruebas/datos/bajar.mjs`'); process.exit(1) }

// Las fechas: las pedidas, o los últimos 10 días con mediciones.
let fechas = process.argv.slice(2).filter((x) => /^\d{4}-\d{2}-\d{2}$/.test(x))
if (!fechas.length) {
  fechas = [...new Set(datos.med.map((m) => String(m.fecha).slice(0, 10)))].sort().slice(-10)
}

// La llave para llamar a la edge sale de la Management API y no se imprime nunca.
const H = { Authorization: `Bearer ${await getPAT()}`, 'Content-Type': 'application/json' }
const rk = await fetch(`https://api.supabase.com/v1/projects/${REF}/api-keys`, { headers: H })
if (!rk.ok) { console.error('⛔ no pude pedir las llaves: ' + rk.status); process.exit(1) }
const KEY = (await rk.json()).find((x) => /service/i.test(x.name || ''))?.api_key
if (!KEY) { console.error('⛔ no vino la service_role'); process.exit(1) }

const ctx = cargarAuditoria(CASA + '/Betangar/app.js')
sembrar(ctx, datos)

let fallos = 0
console.log('fecha        pantalla R1 / edge graves   ·   pantalla R14 / edge amaneció')
for (const f of fechas) {
  // ⛔ LAS JORNADAS SE ARMAN CON UNA VENTANA, LOS HALLAZGOS SE ACOTAN AL DÍA.
  //    El primer intento pasaba `_acArmarJornadas(f, f)` —un solo día— y entonces la pantalla no
  //    tenía la LLEGADA DEL DÍA ANTERIOR, que es la mitad de un tramo de patio. Daba desacuerdos
  //    que no eran del producto sino del arnés. Una prueba mal armada acusa al código.
  //    [[norma-una-asercion-mal-escrita-acusa-al-producto]]
  const desdeVent = new Date(new Date(f + 'T12:00:00Z').getTime() - 6 * 86400000).toISOString().slice(0, 10)
  const todas = ctx._acArmarJornadas(desdeVent, f)
  const ref = ctx._acRefRend(ctx._acArmarJornadas(String(datos.med[0].fecha).slice(0, 10), f))
  const anom = ctx._acAnomalias(todas, f, f, ref)
  const pantallaR1 = anom.filter((a) => (a.cod || a.regla) === 'R1').length
  // ⛔ R14 NO SE CUENTA IGUAL EN LOS DOS LADOS, Y ESO NO ES UN DEFECTO:
  //    la pantalla emite UN aviso agrupado («En N noche(s) el tanque subió…») y la edge devuelve
  //    `amanecio_con_mas` contando NOCHES. Comparar 1 aviso contra N noches da un desacuerdo que
  //    no existe — me pasó al escribir esto. El número comparable es el que el propio aviso dice.
  const avisoR14 = anom.find((a) => (a.cod || a.regla) === 'R14')
  const pantallaR14 = avisoR14
    ? Number((String(avisoR14.msg || avisoR14.texto || avisoR14.detalle || '').match(/En (\d+) noche/) || [0, 0])[1])
    : 0

  // La EDGE, en seco: no manda nada ni escribe en sombra.
  let edge
  try {
    const r = await fetch(`https://${REF}.supabase.co/functions/v1/auditar-combustible?dry=1&fecha=${f}`,
      { headers: { Authorization: `Bearer ${KEY}`, apikey: KEY } })
    edge = await r.json()
    if (!r.ok || edge.ok === false) throw new Error(JSON.stringify(edge).slice(0, 160))
  } catch (e) { console.log(`${f}  ⛔ la edge no contestó: ${e.message}`); fallos++; continue }

  const okR1 = pantallaR1 === (edge.graves ?? -1)
  const okR14 = pantallaR14 === (edge.amanecio_con_mas ?? -1)
  if (!okR1 || !okR14) fallos++
  console.log(`${f}   ${okR1 ? '✅' : '❌'} ${pantallaR1} / ${edge.graves}` +
              `              ${okR14 ? '✅' : '❌'} ${pantallaR14} / ${edge.amanecio_con_mas}`)
}
console.log('\n' + (fallos === 0 ? '✅ las dos gemelas dicen lo mismo' : `⛔ ${fallos} fecha(s) en desacuerdo`))
process.exit(fallos === 0 ? 0 : 1)
