// ══════════════════════════════════════════════════════════════════════════════
// CHOFER_MEDICION RESPETA EL TURNO Y NO ENTREGA LA SALIDA DEL TURNO ANTERIOR
//
// Alejandra, 19/11/2026: «el turno nocturno declara 26 cm al salir pero al cerrar
// le marca 31 cm (la salida de la mañana)».
// ══════════════════════════════════════════════════════════════════════════════
import { readFileSync } from 'node:fs'
import vm from 'node:vm'

const ruta = new URL('../chofer.html', import.meta.url)
const html = readFileSync(ruta, 'utf8')

let fallos = 0
const ok = (c, m) => { console.log(`${c ? '  ✅' : '  ⛔'} ${m}`); if (!c) fallos++ }

function montar(fuente, turno) {
  const trozo = (re, nombre) => {
    const m = fuente.match(re)
    if (!m) throw new Error(`no encontré ${nombre}`)
    return m[0]
  }
  const piezas = [
    trozo(/^var CL_DRAFT_CAMPOS = [\s\S]*?\];/m, 'CL_DRAFT_CAMPOS'),
    trozo(/^function setVal\(id, val\).*$/m, 'setVal'),
    trozo(/^function gv\(id\).*$/m, 'gv'),
    (fuente.match(/^function clTraerMedicionSalida\(\)\{[\s\S]*?^}$/m) || [''])[0],
  ]

  const cajas = {
    'cl-cm-salida': { value: '' }
  }
  const ctx = {
    console,
    document: { getElementById: (id) => cajas[id] || null },
    cam: 'JAC-B005',
    hoy: '2026-11-18',
    CL_TURNO: turno,
    supabase: null,
    clCalcLitrosCm: () => {},
    _cajas: cajas,
  }
  vm.createContext(ctx)
  vm.runInContext(piezas.join('\n'), ctx)
  return ctx
}

console.log('\nCHOFER_MEDICION PIDE EL TURNO CORRECTO')
{
  const cDiurno = montar(html, 'diurno')
  let pedidoDiurno = null
  cDiurno.supabase = { rpc: (fn, args) => { pedidoDiurno = { fn, args }; return Promise.resolve({ data: 31 }) } }
  vm.runInContext('clTraerMedicionSalida()', cDiurno)
  await Promise.resolve(); await Promise.resolve()
  ok(pedidoDiurno && pedidoDiurno.args.p_turno === 'diurno', 'el turno diurno pide p_turno="diurno"')
  ok(cDiurno._cajas['cl-cm-salida'].value === 31, 'recibe los 31 cm del diurno')

  const cNoct = montar(html, 'nocturno')
  let pedidoNoct = null
  cNoct.supabase = { rpc: (fn, args) => { pedidoNoct = { fn, args }; return Promise.resolve({ data: 26 }) } }
  vm.runInContext('clTraerMedicionSalida()', cNoct)
  await Promise.resolve(); await Promise.resolve()
  ok(pedidoNoct && pedidoNoct.args.p_turno === 'nocturno', 'el turno nocturno pide p_turno="nocturno"')
  ok(cNoct._cajas['cl-cm-salida'].value === 26, 'recibe los 26 cm del nocturno y no los 31')
}

if (fallos > 0) {
  console.log(`\n⛔ ${fallos} comprobación(es) fallaron`);
  process.exit(1);
} else {
  console.log('\n✅ Todas las comprobaciones pasaron con éxito');
}
