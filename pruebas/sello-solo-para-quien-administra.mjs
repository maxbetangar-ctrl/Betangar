// ══════════════════════════════════════════════════════════════════════════════
// ⛔ EL SELLO Y LA FIRMA DE LA EMPRESA NO LOS VE CUALQUIERA
//
// 05/11/2026. Máximo: «que la retención venga de una con el sello y mi firma de
// betangar». Para eso el sello tiene que estar donde la app lo alcance — y
// quedó en la base (`empresa_sello`), NO en el repo: Betangar se publica por
// GitHub Pages y cualquier archivo del repo se baja sin sesión. Puesto ahí, la
// firma de Máximo la descarga quien sepa la URL y firma lo que quiera.
//
// Entonces la pregunta de esta prueba no es si la política está escrita. Es si
// DEJA AFUERA a quien tiene que dejar afuera.
//
// ⛔ POR QUÉ NO SE PRUEBA EN EL NAVEGADOR. Interceptando la API se ve lo que la
//    pantalla DIBUJA, no lo que el servidor PERMITE. El RLS quedaría sin probar
//    y se vería igual que probado. Acá se corre la política de verdad, adentro
//    de Postgres, poniéndose el `auth.uid()` real de cada persona.
//    [[norma-probar-el-camino-no-la-pieza]]
//
// ⛔ Y LLEVA CONTROL POSITIVO. Que una consulta devuelva 0 filas no prueba que
//    el candado sirva: puede que la tabla esté vacía, o que falle otra cosa. Si
//    Keily (admin) no ve su fila en la MISMA corrida, los ceros no valen nada y
//    esta prueba se declara ROTA, no verde.
//    [[norma-control-positivo-antes-de-creerle-al-vacio]]
//
// 📌 La Management API corre como `postgres`, que SALTA el RLS: sin
//    `set local role authenticated` todo daría 1 y la prueba saldría verde por
//    nada. Eso es lo que hace cada bloque de abajo.
//
//   node pruebas/sello-solo-para-quien-administra.mjs
// ══════════════════════════════════════════════════════════════════════════════
import { getPAT } from '../../maxware-tools/pat.mjs'

const REF = 'hrkjddehqnzcqwlkklqm'
const pat = await getPAT()

// Los `auth.uid()` reales de cada rol en Betangar. No son credenciales: son el
// id público de la fila, y la consulta la autoriza el PAT, no ellos.
const CASOS = [
  { quien: 'Keily Marín',        rol: 'admin',       uid: '8a682eac-22d7-4c97-a8ab-1252710e81f6', espera: 1, control: true },
  { quien: 'cristina',           rol: 'operador',    uid: 'bd2d6ec3-4258-4140-9a7b-0e973f7bb17f', espera: 0 },
  { quien: 'Vigilante Portería', rol: 'vigilante',   uid: 'd3357fff-c277-4c3d-8c0f-9f60aeb724eb', espera: 0 },
  { quien: 'sin ficha en btg_usuarios', rol: '(sin rol)', uid: '00000000-0000-0000-0000-000000000000', espera: 0 },
]

async function correr(sql) {
  const r = await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${pat}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: sql }),
  })
  const t = await r.text()
  return { status: r.status, cuerpo: t }
}

let fallos = 0, controlOk = false
console.log('\nEL SELLO DE LA EMPRESA — quién lo puede leer\n')

for (const c of CASOS) {
  const claims = JSON.stringify({ sub: c.uid, role: 'authenticated' })
  const sql = `begin; set local role authenticated;
    set local request.jwt.claims = '${claims}';
    select coalesce(app_rol(),'(sin rol)') rol, count(*)::int filas from empresa_sello; commit`
  const { status, cuerpo } = await correr(sql)
  if (status >= 400) { console.log(`  ✗ ${c.quien}: la consulta falló → ${cuerpo.slice(0, 160)}`); fallos++; continue }
  const fila = JSON.parse(cuerpo)[0]
  const bien = fila.filas === c.espera && fila.rol === c.rol
  if (bien) { console.log(`  ✓ ${c.quien} (${fila.rol}) → ${fila.filas} fila(s)` + (c.control ? '   ← CONTROL POSITIVO' : '')) }
  else { console.log(`  ✗ ${c.quien}: rol «${fila.rol}» y ${fila.filas} fila(s); esperaba rol «${c.rol}» y ${c.espera}`); fallos++ }
  if (c.control && fila.filas === c.espera) controlOk = true
}

// `anon` no llega ni al RLS: no tiene el privilegio de tabla. Un 42501 es la prueba.
const { cuerpo: anonC } = await correr('begin; set local role anon; select count(*) from empresa_sello; commit')
if (anonC.includes('42501')) console.log('  ✓ anon no tiene ni el privilegio de tabla (42501)')
else { console.log('  ✗ anon NO recibió 42501 → ' + anonC.slice(0, 200)); fallos++ }

if (!controlOk) {
  console.log('\n  ⛔ EL CONTROL POSITIVO NO PASÓ. Los ceros de arriba no prueban nada:')
  console.log('     puede que la tabla esté vacía o que falle otra cosa. PRUEBA ROTA.\n')
  process.exit(1)
}
console.log('\n  ' + (CASOS.length + 1 - fallos) + ' pasaron, ' + fallos + ' fallaron\n')
process.exit(fallos ? 1 : 0)
