// LIMPIAR LOS 7 COBROS DUPLICADOS — pedido de Maximo el 20/10/2026.
// ⛔ NO SE BORRA NADA: se marca `categoria='duplicado'`. Para un CREDITO esa categoria
//    cae en el bloque PATRIMONIAL de `btg_estado_financiero`, o sea que deja de contar
//    como ingreso (que es el efecto que se quiere) PERO la fila queda con su rastro y
//    se puede revertir. Borrar un movimiento del estado de cuenta es perder evidencia.
// ⛔ El ABONO asociado NO se toca: ese es el registro de la aplicacion a la factura y
//    tiene que seguir. Lo que sobra es el movimiento bancario espejo.
import fs from 'node:fs'
import { getPAT } from 'file:///C:/Users/Maxbetangar/maxware-tools/pat.mjs'
const APLICAR = process.argv.includes('--aplicar')
async function q(sql){const r=await fetch('https://api.supabase.com/v1/projects/hrkjddehqnzcqwlkklqm/database/query',{method:'POST',headers:{Authorization:`Bearer ${getPAT()}`,'Content-Type':'application/json'},body:JSON.stringify({query:sql})});const t=await r.text();if(!r.ok)throw new Error(t.slice(0,400));return JSON.parse(t)}
const usd = `round(sum(monto/nullif(btg_tasa_mov(fecha::date,tasa_real,categoria),0))::numeric,0)`
const antes = await q(`select count(*) n, ${usd} usd from bnc_movimientos
  where tipo='credito' and categoria='cobro_alcaldia' and fecha>='2026-03-23' and fecha<='2026-10-20'`)
console.log('ANTES  — cobros de la Alcaldia: '+antes[0].n+' movs · US$ '+antes[0].usd)

const resp = JSON.parse(fs.readFileSync(process.argv[2],'utf8'))
const ids = resp.filas.map(f=>f.id)
if(ids.length!==7) throw new Error('el respaldo no trae 7 filas')
console.log('A marcar: '+ids.length+' movimientos')

if(!APLICAR){ console.log('\n(SECO: no se toco nada. Correr con --aplicar)'); process.exit(0) }

// Candado: solo estos ids Y solo si siguen siendo cobro_alcaldia. Si otra cosa los movio,
// no se pisa nada.
const lista = ids.map(i=>`'${i}'`).join(',')
const upd = await q(`update bnc_movimientos
  set categoria='duplicado',
      descripcion = coalesce(descripcion,'') || ' [DUPLICADO del estado de cuenta, marcado 20/10/2026]'
  where id in (${lista}) and categoria='cobro_alcaldia' and tipo='credito'
  returning id`)
console.log('marcados: '+upd.length)

const desp = await q(`select count(*) n, ${usd} usd from bnc_movimientos
  where tipo='credito' and categoria='cobro_alcaldia' and fecha>='2026-03-23' and fecha<='2026-10-20'`)
console.log('DESPUES — cobros de la Alcaldia: '+desp[0].n+' movs · US$ '+desp[0].usd)
const quedan = await q(`select count(*) n from btg_cobros_duplicados('2026-03-23','2026-10-20')`)
console.log('duplicados que quedan: '+quedan[0].n+(Number(quedan[0].n)===0?' ✅':' ⛔'))
