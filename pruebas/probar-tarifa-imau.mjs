#!/usr/bin/env node
// ═══════════════════════════════════════════════════════════════════════════════════════════
// LA TARIFA DEL APOYO IMAU, a lo largo de sus TRES REGLAS
//
// ⛔ Esto es plata, y la regla cambió dos veces. Una semana vieja que se recalcule tiene que
//    dar lo que se pagó ENTONCES. Se prueba la función REAL de `app.js`, no una copia.
//
// ⛔ Y se prueba lo que NO cambia: al apoyo IMAU no le aplican los recargos de feriado ni de
//    nocturno — ésos son de los choferes y ayudantes de Betangar. Aclaración de Máximo el
//    04/11/2026, comprobada contra el Excel (SEM-33, con el feriado del 12/10, todo múltiplo
//    de $2,50).
// ═══════════════════════════════════════════════════════════════════════════════════════════
import fs from 'node:fs'
import path from 'node:path'
import vm from 'node:vm'
import { fileURLToPath } from 'node:url'

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const a = fs.readFileSync(path.join(REPO, 'app.js'), 'utf8')
const trozo = (n) => {
  const i = a.indexOf(`function ${n}(`)
  if (i < 0) throw new Error(`no hallé function ${n} en app.js — ¿se renombró?`)
  const r = a.slice(i); const f = r.search(/\r?\n\}/)
  return r.slice(0, f + 3)
}
const ctx = { console, Date, Math, String, Number, parseInt, parseFloat, isFinite }
vm.createContext(ctx)
// `cfg` vacío: se prueban los valores POR OMISIÓN, que son los que rigen hoy.
vm.runInContext('var cfg={};', ctx)
// ⚠️ La declaración viene alineada con espacios (`var X   = ...`), así que buscarla con un
//    solo espacio no la encuentra. Se busca con expresión regular.
for (const v of ['IMAU_REGLA_POR_VIAJE', 'IMAU_REGLA_DOMINGO']) {
  const m = a.match(new RegExp('var\\s+' + v + '\\s*=\\s*[^;]+;'))
  if (!m) throw new Error(`no hallé la declaración de ${v} en app.js`)
  vm.runInContext(m[0], ctx)
}
for (const n of ['_esDomingoISO', 'tarifaApoyoDia']) vm.runInContext(trozo(n), ctx)

const t = (v, f) => vm.runInContext(`tarifaApoyoDia(${v}, ${JSON.stringify(f)})`, ctx)
let fallos = 0, total = 0
const caso = (titulo, dio, esperado) => {
  total++
  const ok = Math.abs(dio - esperado) < 0.005
  if (!ok) fallos++
  console.log(`${ok ? '✅' : '⛔'} ${titulo.padEnd(62)} dio ${String(dio).padStart(7)}  esperado ${esperado}`)
}

console.log('── Hasta el 31/08/2026: ESCALÓN (2 viajes $2 · 3 o más $5) ──')
caso('1 viaje en agosto no paga',            t(1, '2026-08-20'), 0)
caso('2 viajes en agosto pagan $2',          t(2, '2026-08-20'), 2)
caso('3 viajes en agosto pagan $5',          t(3, '2026-08-20'), 5)
caso('9 viajes en agosto siguen pagando $5', t(9, '2026-08-20'), 5)
caso('el 31/08 todavía es el escalón',       t(2, '2026-08-31'), 2)

console.log('\n── Desde el 01/09/2026: POR VIAJE, $2,50 ──')
caso('el 01/09 ya es por viaje: 2 viajes = $5',   t(2, '2026-09-01'), 5)
caso('1 viaje AHORA SÍ paga $2,50',               t(1, '2026-09-01'), 2.5)
caso('13 viajes = $32,50 (Anderson, SEM-34)',     t(13, '2026-10-21'), 32.5)
caso('15 viajes = $37,50 (Meraldo, SEM-34)',      t(15, '2026-10-21'), 37.5)
caso('17 viajes = $42,50 (Alberto Venega)',       t(17, '2026-10-21'), 42.5)
caso('5 viajes = $12,50 (Gregorio Vílchez)',      t(5, '2026-10-21'), 12.5)

console.log('\n── Desde la SEM-35 (02/11/2026): el DOMINGO a $7,50 por viaje ──')
caso('domingo 08/11: 2 viajes = $15',             t(2, '2026-11-08'), 15)
caso('lunes 09/11 sigue a $2,50: 2 = $5',         t(2, '2026-11-09'), 5)
caso('⭐ un domingo ANTES de la SEM-35 va a $2,50', t(2, '2026-10-25'), 5)

console.log('\n── Lo que NO le aplica al IMAU (son de los choferes/ayudantes) ──')
caso('⭐ el FERIADO del 12/10 NO lleva recargo',   t(10, '2026-10-12'), 25)
caso('⭐ el 01/05 (feriado) tampoco',              t(4, '2026-05-01'), 5)   // mayo: aún escalón
caso('sin viajes nunca paga, en cualquier regla',  t(0, '2026-11-08'), 0)

console.log('\n── Y sin fecha: la regla VIEJA, para no pagar distinto de callada ──')
caso('sin fecha, 2 viajes = $2 (escalón)',        t(2, ''), 2)
caso('sin fecha, 5 viajes = $5 (escalón)',        t(5, null), 5)

console.log(`\n${fallos ? '⛔ ' + fallos + ' en rojo' : '✅ las ' + total + ' en verde'}`)
process.exit(fallos ? 1 : 0)
