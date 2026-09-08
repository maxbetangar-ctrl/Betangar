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
out.med     = await q("select vehiculo_id,fecha,momento,altura_cm,litros_calculados,registrado_por,created_at,corregida,no_confiable,tanque_id from combustible_mediciones order by vehiculo_id,created_at")
out.surt    = await q("select id,cam,fecha,hora,chofer,tanque,litros,created_at from surtidas order by created_at")
out.gasoil  = await q("select * from gasoil order by f")
out.tanques = await q("select * from combustible_tanques_config")
out.ck      = await q("select cam,fecha,conductor,km_salida,km_entrada from checklist order by fecha")
// ⛔ LA CONFIGURACIÓN VA EN EL VOLCADO, NO SE INVENTA EN EL BANCO. Dos veces el 08/09 el banco
// midió con otra vara que el producto —σ puesta a ojo, y el corte de surtidas en 24/07 cuando el
// real es 18/07— y la prueba pasaba midiendo otra cosa. [[norma-test-que-pasa-por-el-motivo-equivocado]]
out.cfg     = await q("select clave,valor from configuracion where clave in ('surtidas_corte','aud_comb_rend_ref','aud_comb_avisar')")
out.unidades= await q("select cam,modelo,capacidad_tanque_l,activo from unidad_config order by cam")
fs.writeFileSync(new URL('./combustible-real.json', import.meta.url), JSON.stringify(out))
console.log(Object.entries(out).map(([k,v]) => `${k} ${v.length}`).join(' · '))
