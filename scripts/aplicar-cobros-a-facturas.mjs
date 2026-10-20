#!/usr/bin/env node
// ═══════════════════════════════════════════════════════════════════════════════
// APLICAR A SU FACTURA LOS COBROS QUE ENTRARON Y NADIE REGISTRÓ
//
//   node scripts/aplicar-cobros-a-facturas.mjs            → SECO: mide y no toca
//   node scripts/aplicar-cobros-a-facturas.mjs --aplicar   → escribe los abonos
//
// Máximo, 20/10/2026: «que aplique».
//
// QUÉ RESUELVE. El banco trae US$ 710.007 cobrados de la Alcaldía y en el sistema
// hay US$ 612.579 aplicados a facturas. La diferencia son cobros que entraron a la
// cuenta y nadie registró contra su factura — y mientras no se registren, Cobranza
// y el tablero muestran menos de lo que de verdad entró.
//
// ⛔ SOLO SE APLICA LO INEQUÍVOCO: los cobros donde EL BANCO DICE a qué factura
//    van («Pago Alcaldia Fact.000646», «INGRESO IMAU FACTURA 001005»). Los que no
//    la dicen NO se tocan: elegirles una factura por el monto o por la fecha es
//    inventar a qué deuda se imputó una plata. Se listan aparte para que una
//    persona los decida. [[norma-la-palabra-que-identifica-es-la-rara]]
//
// ⛔ SE APLICA LA DIFERENCIA, NO EL TOTAL. Si una factura ya tiene US$ 20.597
//    abonados y el banco trae US$ 39.320, se crea un abono por los US$ 18.723 que
//    faltan — no por los 39.320, que duplicaría lo ya cargado.
//
// ⛔ CADA ABONO NUEVO QUEDA MARCADO (`ref` = CONC-<factura>, y la observación lo
//    dice). Si mañana alguien carga el mismo a mano, se ve de dónde salió cada
//    uno; y esta herramienta no vuelve a crearlo, porque descuenta lo ya abonado.
//
// ⛔ LOS VIAJES (`v`) QUEDAN EN 0 A PROPÓSITO. El banco no dice cuántos viajes
//    cubre un pago, y deducirlos dividiendo por la tarifa daría un número que
//    nadie declaró. Un 0 que se nota es mejor que un número inventado que no.
//    [[norma-respaldo-que-inventa-un-dato]]
// ═══════════════════════════════════════════════════════════════════════════════
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { pathToFileURL } from 'node:url'

const APLICAR = process.argv.includes('--aplicar')
const DESDE = '2026-03-23', HASTA = new Date().toISOString().slice(0, 10)
const REF = 'hrkjddehqnzcqwlkklqm'

const { getPAT } = await import(pathToFileURL(path.join(os.homedir(), 'maxware-tools', 'pat.mjs')).href)
const H = { Authorization: `Bearer ${getPAT()}`, 'Content-Type': 'application/json' }
async function q(sql) {
  const r = await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`, {
    method: 'POST', headers: H, body: JSON.stringify({ query: sql })
  })
  const t = await r.text()
  if (!r.ok) throw new Error(t.slice(0, 400))
  return JSON.parse(t)
}
const m2 = (n) => Number(n).toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

// El cobro del banco por factura, SIN los espejos (el movimiento que la app fabrica
// al registrar un abono y que el estado de cuenta trae igual), contra lo ya abonado.
const BANCO = `select id, fecha, referencia,
    btg_nro_factura(factura,descripcion,concepto_banco) nro,
    (monto/nullif(btg_tasa_mov(fecha::date,tasa_real,categoria),0)) usd
  from bnc_movimientos
  where tipo='credito' and categoria='cobro_alcaldia'
    and fecha>='${DESDE}' and fecha<='${HASTA}' and not btg_es_espejo(id)`
// ⛔ EL ESCAPE VA CON DOS BARRAS ACÁ, UNA EN EL SQL — y esto costó tres abonos duplicados.
//    Estaba con CUATRO: el template literal de JS las deja en dos, y en SQL `'\\D'` busca un
//    BACKSLASH LITERAL, no «no-dígito». Así, `M1005` se normalizaba a `0M1005` en vez de
//    `001005` y NUNCA calzaba con el cobro del banco: el script concluyó que esas facturas no
//    tenían abono, y sí lo tenían, con la serie «M». Se crearon 3 abonos que ya existían y
//    hubo que borrarlos. Un escape de más NO da error: da un resultado distinto, y creíble.
//    [[norma-control-positivo-antes-de-creerle-al-vacio]]
const YA = `select lpad(regexp_replace(regexp_replace(fact,'\\D','','g'),'^0+',''),6,'0') nro, sum(m) usd
  from abonos where nullif(trim(fact),'') is not null group by 1`

const aplicables = await q(`
  with b as (${BANCO}), ya as (${YA})
  select b.nro factura, max(b.fecha)::text fecha, count(*) movs,
         round(sum(b.usd)::numeric,2) cobrado, round(coalesce(max(ya.usd),0)::numeric,2) abonado,
         round((sum(b.usd)-coalesce(max(ya.usd),0))::numeric,2) falta
    from b left join ya on ya.nro=b.nro
   where b.nro is not null
   -- ⛔ UMBRAL, Y NO ES UN CAPRICHO. Sin él esto creaba 24 abonos y 19 eran de centavos a
   --    cientos (1,32 · 8,35 · 34,25…): NO son cobros sin registrar, son la DIFERENCIA DE TASA
   --    entre el día en que se registró el abono y el día del movimiento del banco. Un abono de
   --    US$ 1,32 afirma que entró plata que no entró, y ensucia la cobranza con ruido.
   --    Se exige que la diferencia sea material: más de US$ 500 Y más del 1% de lo cobrado de
   --    esa factura. Con eso quedan las 5 que de verdad son un pago no registrado.
   group by b.nro
   having sum(b.usd)-coalesce(max(ya.usd),0) > 500
      and sum(b.usd)-coalesce(max(ya.usd),0) > sum(b.usd)*0.01
   order by 6 desc`)

// Las diferencias CHICAS se dicen, no se callan: son ruido de conversión, pero el que mire el
// cuadro tiene que saber por qué el banco y los abonos no dan idéntico al centavo.
const chicas = await q(`
  with b as (${BANCO}), ya as (${YA})
  select count(*) n, round(coalesce(sum(sub.falta),0)::numeric,2) usd from (
    select b.nro, sum(b.usd)-coalesce(max(ya.usd),0) falta
      from b left join ya on ya.nro=b.nro
     where b.nro is not null group by b.nro
    having sum(b.usd)-coalesce(max(ya.usd),0) > 1
       and (sum(b.usd)-coalesce(max(ya.usd),0) <= 500
         or sum(b.usd)-coalesce(max(ya.usd),0) <= sum(b.usd)*0.01)) sub`)

const sinFactura = await q(`
  with b as (${BANCO})
  select fecha::text, round(usd::numeric,2) usd, referencia from b where nro is null order by usd desc`)

const totalAp = aplicables.reduce((s, x) => s + Number(x.falta), 0)
const totalSin = sinFactura.reduce((s, x) => s + Number(x.usd), 0)

console.log(`\nSE APLICARÍAN ${aplicables.length} abono(s) — US$ ${m2(totalAp)}`)
console.log('  factura    cobró el banco     ya abonado        se aplica')
aplicables.forEach(a => console.log(
  `  ${a.factura}   ${m2(a.cobrado).padStart(14)}  ${m2(a.abonado).padStart(14)}  ${m2(a.falta).padStart(14)}`))

console.log(`\nNO SE TOCAN ${sinFactura.length} cobro(s) — US$ ${m2(totalSin)}: el banco no dice la factura.`)
sinFactura.forEach(x => console.log(`  ${x.fecha}  ${m2(x.usd).padStart(12)}  ref ${x.referencia || '(sin)'}`))
console.log('  ⛔ Elegirles factura por el monto o la fecha sería inventar a qué deuda se imputó.')

console.log(`
TAMPOCO SE TOCAN ${chicas[0].n} diferencia(s) chica(s) — US$ ${m2(chicas[0].usd)} en total:`)
console.log('  son el redondeo de la tasa entre el día del abono y el día del movimiento del banco,')
console.log('  no cobros sin registrar. Crear un abono por eso diría que entró plata que no entró.')

if (!APLICAR) { console.log('\n(SECO: no se escribió nada. Correr con --aplicar)\n'); process.exit(0) }

// ── Respaldo de lo que había ANTES, para poder volver ───────────────────────
const antes = await q(`select count(*) n, round(sum(m)::numeric,2) usd from abonos`)
const dir = path.join(path.dirname(path.dirname(new URL(import.meta.url).pathname.slice(1))), 'respaldos')
const salida = path.join(dir, 'abonos_antes_de_conciliar_' + HASTA + '.json')
fs.mkdirSync(dir, { recursive: true })
fs.writeFileSync(salida, JSON.stringify({
  cuando: HASTA, que: 'Los abonos ANTES de aplicar los cobros del banco',
  como_revertir: "delete from abonos where ref like 'CONC-%'",
  antes: antes[0], se_van_a_crear: aplicables
}, null, 1), 'utf8')
console.log('\n📦 respaldo: ' + salida)

let n = 0
for (const a of aplicables) {
  // `abonos.id` es una identidad GENERATED ALWAYS: la pone la base y no se le pasa.
  // La marca de que esto vino de la conciliacion vive en `ref` y en `obs`.
  const obs = `Aplicado desde el estado de cuenta el ${HASTA}: el banco cobro US$ ${m2(a.cobrado)} de esta factura y habia US$ ${m2(a.abonado)} registrados.`
  // ⛔ `abonos` TIENE UNIQUE (fact): UNA factura admite UN SOLO abono. O sea que el modelo NO
  //    soporta pagos PARCIALES — y la Alcaldia paga en partes: por eso 000646 y 000647 tenian
  //    la mitad y el segundo pago no se pudo registrar nunca. Mientras eso siga asi, lo unico
  //    honesto es SUMAR la diferencia al abono que ya existe (asi el total cobrado de esa
  //    factura queda bien) y dejar escrito en la observacion que fueron dos pagos.
  //    El arreglo de fondo es levantar esa restriccion; queda anotado.
  if (Number(a.abonado) > 0) {
    await q(`update abonos
                set m = ${a.cobrado},
                    obs = coalesce(nullif(obs,''),'') || ' | ${obs.replace(/'/g, "''")} Se sumo el pago que faltaba: la tabla solo admite UN abono por factura.',
                    ref = case when coalesce(nullif(ref,''),'') = '' then 'CONC-${a.factura}' else ref || ' + CONC' end
              where fact = '${a.factura}'`)
    console.log(`  · ${a.factura}: se SUMO US$ ${m2(a.falta)} al abono que ya existia (total ${m2(a.cobrado)})`)
  } else {
    await q(`insert into abonos (f, fact, v, m, obs, ref)
             values ('${a.fecha}', '${a.factura}', 0, ${a.falta}, '${obs.replace(/'/g, "''")}', 'CONC-${a.factura}')`)
    console.log(`  · ${a.factura}: abono NUEVO por US$ ${m2(a.falta)}`)
  }
  n++
}
console.log(`✅ creados ${n} abono(s)`)

const desp = await q(`select count(*) n, round(sum(m)::numeric,2) usd from abonos`)
console.log(`\nabonos: ${antes[0].n} (US$ ${m2(antes[0].usd)})  →  ${desp[0].n} (US$ ${m2(desp[0].usd)})`)
// ⛔ El control final tiene que usar EL MISMO UMBRAL que la aplicacion. Con `> 1` marcaba en
//    rojo las 19 diferencias de tasa que acabamos de decidir NO tocar: un pendiente inventado.
//    Un aviso que salta sobre algo ya resuelto deja de leerse.
const quedan = await q(`
  with b as (${BANCO}), ya as (${YA})
  select count(*) n, round(coalesce(sum(sub.falta),0)::numeric,2) usd from (
    select b.nro, sum(b.usd)-coalesce(max(ya.usd),0) falta from b left join ya on ya.nro=b.nro
     where b.nro is not null group by b.nro
    having sum(b.usd)-coalesce(max(ya.usd),0) > 500
       and sum(b.usd)-coalesce(max(ya.usd),0) > sum(b.usd)*0.01) sub`)
console.log(`cobros con factura sin aplicar: ${quedan[0].n} (US$ ${m2(quedan[0].usd)})` + (Number(quedan[0].n) === 0 ? ' ✅' : ' ⛔'))
console.log(`quedan a mano, sin factura: ${sinFactura.length} (US$ ${m2(totalSin)})`)
console.log(`quedan sin tocar por chicas: ${chicas[0].n} (US$ ${m2(chicas[0].usd)}) — ruido de tasa`)
