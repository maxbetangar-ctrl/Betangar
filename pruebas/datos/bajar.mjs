// Baja el volcado COMPLETO de la base para el banco de auditoría de combustible.
// ⛔ NO se versiona: el repo es público y esto trae nombres de choferes. Lo recorta `reducir.mjs`.
//   node pruebas/datos/bajar.mjs
import fs from 'node:fs'
import { getPAT } from 'file:///C:/Users/Maxbetangar/maxware-tools/pat.mjs'
const REF = 'hrkjddehqnzcqwlkklqm'
const pat = await getPAT()
async function q(sql) {
  const r = await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`,
    { method:'POST', headers:{ Authorization:'Bearer '+pat, 'Content-Type':'application/json' },
      body: JSON.stringify({ query: sql }) })
  if (!r.ok) throw new Error(await r.text())
  return r.json()
}
const out = {}
// TURNO VA SI O SI. Desde el 04/11/2026 hay dos turnos y `_acEntradas` filtra por el: con
// la columna ausente, `String(s.turno||'')` nunca iguala a "diurno" y el banco descartaba
// TODAS las surtidas -- `j.desp` daba 0 en cada jornada y el consumo medido era una ficcion.
// Un banco que mide con otra vara que el producto no prueba el producto.
out.med     = await q("select * from combustible_mediciones order by vehiculo_id,created_at")
// ⛔ `select *` Y NO UNA LISTA DE COLUMNAS. Esto se arregló el 08/11/2026 después de que el
//    MISMO defecto mordiera CUATRO veces: una columna que el producto lee y el volcado no trae
//    hace que el banco mida un camino que no es el del producto, y **se ve igual que un resultado
//    legítimo**.
//      · `turno`           (07/11) → el banco descartaba TODAS las surtidas: consumo 0 en cada jornada
//      · `hora_gps`        (08/11) → medía siempre el camino de respaldo; parecía «el GPS no sirve»
//      · `hora_gps_fin`    (08/11) → idem
//      · `estacion_nombre` (08/11) → R16 reportó los 27 períodos en vez de 8
//    📌 Una lista de columnas a mano se desincroniza del código que la usa, igual que una lista
//      de funciones. [[norma-dos-listas-a-mano-se-desincronizan]]
//    ⚠️ Lo que NO debe versionarse (nombres de personas) lo saca `reducir.mjs`, que es su trabajo.
out.surt    = await q("select * from surtidas order by created_at")
out.gasoil  = await q("select * from gasoil order by f")
out.tanques = await q("select * from combustible_tanques_config")
out.ck      = await q("select * from checklist order by fecha")
// ⛔ LA CONFIGURACIÓN VA EN EL VOLCADO, NO SE INVENTA EN EL BANCO. Dos veces el 08/09 el banco
// midió con otra vara que el producto —σ puesta a ojo, y el corte de surtidas en 24/07 cuando el
// real es 18/07— y la prueba pasaba midiendo otra cosa. [[norma-test-que-pasa-por-el-motivo-equivocado]]
out.cfg     = await q("select clave,valor from configuracion where clave in ('surtidas_corte','aud_comb_rend_ref','aud_comb_avisar')")
out.periodos = await q("select id,desde,hasta,estacion_nombre,litros_facturados,litros_surtidos,precio_mezclado from combustible_periodos order by desde")
out.unidades= await q("select cam,modelo,capacidad_tanque_l,activo from unidad_config order by cam")
fs.writeFileSync(new URL('./combustible-real.json', import.meta.url), JSON.stringify(out))
console.log(Object.entries(out).map(([k,v]) => `${k} ${v.length}`).join(' · '))
