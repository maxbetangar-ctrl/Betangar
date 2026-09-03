// ════════════════════════════════════════════════════════════════════════════════════════════
// LA MONEDA DE UN MOVIMIENTO DEL BANCO — que US$ 2.500 no se sumen como Bs 2.500
//
// 🔬 POR QUÉ EXISTE. El 02/09/2026 se descubrió que el abono de una «Intervención Cambiaria»
//    trae los DÓLARES comprados en la misma columna `monto` donde todo lo demás son bolívares.
//    Se contaban como Bs — y como el número es chico (4.500 sobre 322 millones), el error no
//    se nota mirando: se cuela. Por eso hace falta una prueba y no una revisión a ojo.
//
// 📌 Las funciones se EXTRAEN del `app.js` real, no se reescriben acá. Una copia de la lógica
//    dentro del test pasa siempre, incluso cuando el código de verdad ya está roto.
//
// ⛔ Lleva CONTROL NEGATIVO: una fila normal tiene que seguir contando igual que antes, y una
//    fila que llegue SIN el campo `moneda` (un select viejo) tiene que seguir siendo bolívares.
//    Sin eso, esta prueba pasaría igual aunque `bncMontoBs` devolviera 0 para todo.
//
// Uso:  node pruebas/moneda-del-movimiento.test.mjs
// ════════════════════════════════════════════════════════════════════════════════════════════
import fs from 'node:fs'
import { getPAT } from '../../maxware-tools/pat.mjs'

const src = fs.readFileSync(new URL('../app.js', import.meta.url), 'utf8')

// Se extraen las tres funciones del archivo, tal cual están escritas.
function sacar(nombre) {
  const i = src.indexOf('function ' + nombre + '(')
  if (i < 0) throw new Error('no está ' + nombre + ' en app.js')
  let d = 0, j = src.indexOf('{', i)
  for (let k = j; k < src.length; k++) {
    if (src[k] === '{') d++
    else if (src[k] === '}') { d--; if (d === 0) return src.slice(i, k + 1) }
  }
  throw new Error('no cerró ' + nombre)
}
const codigo = ['bncEsBs', 'bncMontoBs', 'bncMontoTxt'].map(sacar).join('\n')
const { bncEsBs, bncMontoBs, bncMontoTxt } =
  new Function(codigo + '\nreturn {bncEsBs,bncMontoBs,bncMontoTxt}')()
console.log('✅ las 3 funciones se extrajeron del app.js real\n')

// ── Los datos REALES ────────────────────────────────────────────────────────────────────────
const PAT = await getPAT(); const REF = 'hrkjddehqnzcqwlkklqm'
const q = async (sql) => {
  const r = await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`, {
    method: 'POST', headers: { Authorization: 'Bearer ' + PAT, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: sql }),
  })
  if (!r.ok) throw new Error(await r.text())
  return await r.json()
}

const filas = await q(`select id, monto::float8 monto, moneda, tipo, categoria
  from bnc_movimientos where fecha in ('2026-08-24','2026-09-01')
    and tipo_banco ilike '%Intervencion Camb%' order by fecha, tipo desc`)

let fallos = 0
const chequear = (que, real, esperado) => {
  const ok = String(real) === String(esperado)
  if (!ok) fallos++
  console.log(`${ok ? '✅' : '⛔'} ${que}: ${real}${ok ? '' : `  ← se esperaba ${esperado}`}`)
}

console.log('── Cada línea del banco ──')
for (const f of filas) {
  console.log(`   ${f.categoria.padEnd(18)} ${bncMontoTxt(f)}`)
}

console.log('\n── El camino feliz ──')
const abonos = filas.filter((f) => f.categoria === 'divisas_recibidas')
const cargos = filas.filter((f) => f.categoria === 'compra_divisas')

chequear('los 2 abonos están en USD', abonos.every((a) => !bncEsBs(a)), 'true')
chequear('los abonos NO suman bolívares', abonos.reduce((s, a) => s + bncMontoBs(a), 0), 0)
chequear('los abonos suman US$ 4.500 de verdad', abonos.reduce((s, a) => s + a.monto, 0), 4500)
chequear('los cargos SÍ son bolívares', cargos.every(bncEsBs), 'true')
chequear('los cargos suman sus Bs', cargos.reduce((s, c) => s + bncMontoBs(c), 0).toFixed(2), '3558310.25')
chequear('el abono se escribe con US$', bncMontoTxt(abonos[0]).startsWith('US$ '), 'true')
chequear('el cargo se escribe con Bs', bncMontoTxt(cargos[0]).startsWith('Bs '), 'true')

console.log('\n── El control negativo: una fila normal no cambia de comportamiento ──')
const normal = (await q(`select monto::float8 monto, moneda from bnc_movimientos
  where categoria='nomina' order by fecha desc limit 1`))[0]
chequear('una fila de nómina cuenta como bolívares', bncEsBs(normal), 'true')
chequear('y suma su monto completo', bncMontoBs(normal), normal.monto)
// Lo que llega de un select viejo que no pidió `moneda`: tiene que seguir contando como Bs.
chequear('una fila SIN el campo moneda sigue siendo Bs', bncMontoBs({ monto: 1234 }), 1234)
chequear('y un objeto vacío no rompe', bncMontoBs(null), 0)

console.log(fallos === 0 ? '\n✅ TODO BIEN' : `\n⛔ ${fallos} FALLO(S)`)
process.exit(fallos === 0 ? 0 : 1)
