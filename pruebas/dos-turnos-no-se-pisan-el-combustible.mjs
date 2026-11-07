// ══════════════════════════════════════════════════════════════════════════════
// ⛔ EL SEGUNDO TURNO NO PISA LA MEDICIÓN DEL PRIMERO
//
// 🔴 Máximo, 06/11/2026: «el sistema indica que inicio con 34cm y termino con
//    34 cm osea no gasto combustible hoy […] Salio con 37 y regreso con 34.
//    Segun la captura del chofer, pero en auditoria dice que salio y entro con
//    34». Y: «ese modulo es la auditoria de combustible y le tengo puesto el
//    ojo. Diario reviso la auditoria».
//
//    LA CAUSA: `combustible_mediciones` tenía la llave única
//    `(vehiculo_id, fecha, momento)` — SIN turno. Desde que hay dos turnos
//    (04/11) el segundo chofer que medía NO agregaba su lectura: PISABA la del
//    primero. Ese día hubo exactamente 2 unidades con dos turnos y exactamente
//    esas 2 perdieron la salida del diurno.
//
// ⛔ POR QUÉ ESTA PRUEBA EXISTE Y NO ALCANZA CON MIRAR EL ÍNDICE. Que el índice
//    tenga la columna no prueba que la función la use: `chofer_medicion_guardar`
//    tenía el `on conflict` clavado en la llave vieja, y al soltar esa llave el
//    guardado del chofer quedó ROTO — el arreglo de la tabla rompió la pieza
//    que la escribe. Esto prueba EL CAMINO: guarda como guarda el chofer.
//    [[norma-probar-el-camino-no-la-pieza]]
//
// ⛔ Y DESHACE LO QUE ESCRIBE. Corre contra la base de verdad porque la lógica
//    vive en la base, pero con una unidad y una fecha de prueba, y borra sus
//    filas al terminar — pasen o fallen las comprobaciones.
//
//   node pruebas/dos-turnos-no-se-pisan-el-combustible.mjs
// ══════════════════════════════════════════════════════════════════════════════
import path from 'node:path'
import os from 'node:os'
import { pathToFileURL } from 'node:url'

const { getPAT } = await import(pathToFileURL(path.join(os.homedir(), 'maxware-tools', 'pat.mjs')).href)
const REF = 'hrkjddehqnzcqwlkklqm'
const pat = await getPAT()

const sql = async (q) => {
  const r = await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`, {
    method: 'POST', headers: { Authorization: `Bearer ${pat}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: q }),
  })
  const t = await r.text()
  if (!r.ok) throw new Error(t.slice(0, 300))
  try { return JSON.parse(t) } catch { return [] }
}

// Una unidad real (para que exista su tanque) pero una FECHA que no existe:
// así nada de lo que escriba esta prueba se mezcla con datos de trabajo.
const UNIDAD = 'JAC-B009'
const FECHA = '2001-01-01'
const esc = (s) => String(s).replace(/'/g, "''")

let pass = 0, fail = 0
const ok = (n, c, d = '') => { if (c) { pass++; console.log('  ✓ ' + n) } else { fail++; console.log('  ✗ ' + n + (d ? '  → ' + d : '')) } }

const limpiar = () => sql(`delete from combustible_mediciones
                            where vehiculo_id='${esc(UNIDAD)}' and fecha='${FECHA}'`)

console.log('\nDOS TURNOS NO SE PISAN EL COMBUSTIBLE\n')
try {
  await limpiar()

  // Se escribe como lo hace la pieza: insert ... on conflict con la llave real.
  // (La RPC exige ser el chofer de esa unidad; acá se prueba la LLAVE, que es
  //  lo que se cambió. Que la RPC use esta misma llave se comprueba abajo.)
  const guardar = (momento, turno, cm, quien) => sql(`
    insert into combustible_mediciones (fecha, tanque_id, vehiculo_id, momento, turno, altura_cm, registrado_por, notas)
    values ('${FECHA}','tanque-jac','${esc(UNIDAD)}','${momento}','${turno}',${cm},'${esc(quien)}','PRUEBA dos turnos')
    on conflict (vehiculo_id, fecha, momento, turno) do update set
      altura_cm = excluded.altura_cm, registrado_por = excluded.registrado_por`)

  // El caso real del 06/11: el diurno sale con 37, el nocturno con 34.
  await guardar('salida', 'diurno', 37, 'CHOFER DIURNO PRUEBA')
  await guardar('salida', 'nocturno', 34, 'CHOFER NOCTURNO PRUEBA')

  const filas = await sql(`select momento, turno, altura_cm::text alt, registrado_por
                             from combustible_mediciones
                            where vehiculo_id='${esc(UNIDAD)}' and fecha='${FECHA}'
                            order by turno`)
  ok('las DOS salidas quedan, no una', filas.length === 2, JSON.stringify(filas))
  const diurno = filas.find((f) => f.turno === 'diurno')
  const noct = filas.find((f) => f.turno === 'nocturno')
  ok('la del diurno conserva sus 37 cm', diurno && Number(diurno.alt) === 37,
     diurno ? diurno.alt : 'no está')
  ok('la del nocturno tiene sus 34 cm', noct && Number(noct.alt) === 34,
     noct ? noct.alt : 'no está')
  ok('cada una guarda a SU chofer',
     diurno && noct && diurno.registrado_por !== noct.registrado_por)

  // ⛔ CONTROL POSITIVO: la llave TIENE que seguir frenando un duplicado de
  //    verdad — mismo turno, mismo momento. Si dejara pasar todo, los tres
  //    verdes de arriba no probarían nada.
  await guardar('salida', 'diurno', 40, 'CHOFER DIURNO PRUEBA')
  const tras = await sql(`select count(*)::int n from combustible_mediciones
                           where vehiculo_id='${esc(UNIDAD)}' and fecha='${FECHA}'`)
  ok('CONTROL POSITIVO: repetir el MISMO turno sigue siendo una sola fila', tras[0].n === 2,
     tras[0].n + ' filas')
  const d2 = await sql(`select altura_cm::text alt from combustible_mediciones
                         where vehiculo_id='${esc(UNIDAD)}' and fecha='${FECHA}' and turno='diurno'`)
  ok('…y ésa sí se actualiza (37 → 40)', Number(d2[0].alt) === 40, d2[0].alt)

  // La pieza que escribe de verdad usa esta misma llave.
  const fn = await sql(`select pg_get_functiondef(oid) d from pg_proc where proname='chofer_medicion_guardar'`)
  ok('la RPC del chofer usa la llave CON turno',
     fn[0].d.includes('on conflict (vehiculo_id, fecha, momento, turno)'))
  ok('…y la RPC ya no usa la vieja',
     !fn[0].d.includes('on conflict (vehiculo_id, fecha, momento) '))
  ok('la RPC DEDUCE el turno del checklist, no le cree al teléfono',
     fn[0].d.includes('from public.checklist c') && fn[0].d.includes('v_turno'))

  const idx = await sql(`select indexname from pg_indexes
                          where tablename='combustible_mediciones' and indexname like 'uq_%'`)
  ok('queda UNA sola llave única, la que lleva turno',
     idx.length === 1 && idx[0].indexname.endsWith('_turno'), JSON.stringify(idx))
} catch (e) {
  console.log('  ✗ la prueba no pudo correr: ' + e.message)
  fail++
} finally {
  // Pase lo que pase, no se deja basura en la base del cliente.
  try { await limpiar() } catch (e) { console.log('  ⚠️ no pude limpiar: ' + e.message) }
}

console.log('\n  ' + pass + ' pasaron, ' + fail + ' fallaron\n')
process.exit(fail ? 1 : 0)
