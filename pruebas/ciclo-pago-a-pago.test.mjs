import { readFileSync } from 'node:fs'
import assert from 'node:assert/strict'

const sql = readFileSync('migrations/ciclo_alcaldia_pago_a_pago_2026-11-25.sql', 'utf8')
const fn = readFileSync('supabase/functions/resumen-socios/index.ts', 'utf8')
const app = readFileSync('app.js', 'utf8')
const html = readFileSync('app.html', 'utf8')

let ok = 0
function test(nombre, cond) {
  assert.ok(cond, 'FALLO: ' + nombre)
  ok++
  console.log('✅ ' + ok + '. ' + nombre)
}

test('SQL define btg_es_pago_abre_ciclo excluyendo fiel 10%',
  sql.includes('function public.btg_es_pago_abre_ciclo') && sql.includes("<> 'fiel'"))
test('SQL define btg_ciclo_alcaldia_listo que nunca corta el día en curso (usa ayer)',
  sql.includes('function public.btg_ciclo_alcaldia_listo') && sql.includes('as ayer') && sql.includes('f_sig - 1'))
test('btg_ciclo_alcaldia garantiza desde <= hasta (sin rango invertido)',
  sql.includes('greatest(r.h, r.d) as hasta'))
test('btg_resumen_socios expone ves_posterior_neto_bs para cuadrar bolívares al cierre histórico',
  sql.includes("'ves_posterior_neto_bs'") && sql.includes("m.fecha::date > p_hasta"))
test('Cron reprogramado a revisión diaria 0 13 * * * y acuse 45 13 * * *',
  sql.includes("'0 13 * * *'") && sql.includes("'45 13 * * *'"))
test('Edge function descuenta ves_posterior_neto_bs al deducir saldo de apertura en Bs',
  fn.includes('r.ves_posterior_neto_bs') && fn.includes('saldoHoy - vesPost'))
test('Edge function en envío automático consulta btg_ciclo_alcaldia_listo y no manda si ciclo sigue abierto',
  fn.includes('rpc("btg_ciclo_alcaldia_listo")') && fn.includes('!ciclo.listo'))
test('Edge function en acuse=1 evita falsa alarma cuando el ciclo sigue abierto',
  fn.includes('!estado?.listo') && fn.includes('habia ciclo listo y no hubo corrida'))
test('app.js maneja textos de nuevo_pago, seguimiento_sin_pago y horario diario sin "los al cerrar"',
  app.includes("c.arranque==='nuevo_pago'") && app.includes("/^(al |cuando |no |est)/i.test(cuando)"))
test('app.html tiene cache-buster actualizado',
  html.includes('app.js?v=20261125-ciclo-pago-a-pago'))

console.log('\nTodo en verde (' + ok + ')')
