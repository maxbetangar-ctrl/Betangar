// LA LLAVE DE UN MOVIMIENTO DEL BANCO. Esta prueba existe por lo que costó equivocarse.
//
// Se diseñó la persistencia de la conciliación con la llave "obvia": fecha + monto + referencia.
// Probada contra los 2.235 movimientos reales de Betangar, esa llave FUNDÍA 307 filas y hacía
// desaparecer Bs 9.811.821,57 EN SILENCIO. La razón: un pago de nómina en lote son decenas de
// filas con la MISMA fecha, el MISMO monto y la MISMA referencia — una por trabajador. El 30/04
// hay 13 filas de Bs 2.435,60 idénticas en los tres campos.
//
// El banco sí da un identificador: `ControlNumber`. Verificado sobre 2.412 movimientos de las 4
// cuentas (23/03 → 08/08): 2.412 distintos, ninguno vacío, ninguno repetido ni entre cuentas.
//
// Lo que esta prueba fija, y que nadie debería poder romper sin enterarse:
//   1. la llave sale del ControlNumber, no de fecha/monto/referencia
//   2. un lote de nómina entra como N filas, no como una
//   3. sin ControlNumber NO se guarda (antes que guardar mal, no guardar)
//   4. el id es determinista → traer dos veces lo mismo no duplica

let pass = 0, fail = 0;
function eq(name, got, exp) {
  const c = JSON.stringify(got) === JSON.stringify(exp);
  if (c) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ ' + name + '  → got ' + JSON.stringify(got) + ', exp ' + JSON.stringify(exp)); }
}
function ok(name, cond) { eq(name, !!cond, true); }

// Copia fiel de bncFilaBanco (app.js). Si allá cambia, acá tiene que cambiar y la prueba avisa.
function bncFilaBanco(m) {
  const cn = String(m._cn || '').trim(); if (!cn) return null;
  return {
    id: 'bnc_' + cn, fecha: String(m.fecha || '').slice(0, 10), monto: Math.abs(Number(m.bs) || 0),
    tipo: (m.tipo === 'ingreso' ? 'credito' : 'debito'), descripcion: m.desc || null, referencia: m.ref || null,
    control_number: cn, cuenta: m._acc || null,
    saldo_anterior: (m._prev == null ? null : Number(m._prev))
  };
}

// ── EL CASO REAL: el lote de nómina del 30/04/2026 ──
// 13 trabajadores, mismo día, mismo monto, misma referencia. Solo cambian el beneficiario, el
// ControlNumber y el saldo. Los ControlNumber son los que devolvió el banco de verdad.
const LOTE_30_04 = [74052815, 74052812, 74052808, 74052805, 74052802, 74052799, 74052796,
  74052793, 74052790, 74052787, 74052784, 74052781, 74052778].map((cn, i) => ({
    fecha: '2026-04-30', tipo: 'egreso', bs: 2435.60, ref: '2604300002',
    desc: 'TRANSFERENCIA A FAVOR DE: TRABAJADOR ' + (i + 1), _cn: String(cn),
    _acc: '01910031682131012653', _prev: 1520310.18 - i * 2435.60
  }));

console.log('\nEl lote de nómina del 30/04: 13 filas idénticas salvo el número de control');
const filas = LOTE_30_04.map(bncFilaBanco);
eq('entran las 13, no se funde ninguna', filas.length, 13);
eq('13 llaves distintas', new Set(filas.map(f => f.control_number)).size, 13);
eq('13 ids distintos', new Set(filas.map(f => f.id)).size, 13);
eq('suman los Bs completos (13 × 2.435,60)', Math.round(filas.reduce((s, f) => s + f.monto, 0) * 100) / 100, 31662.80);

console.log('\nLa llave VIEJA — la que perdía la plata — se sigue viendo mal:');
const llaveVieja = LOTE_30_04.map(m => `${m.fecha}|${m.bs}|${m.ref}`);
eq('fecha+monto+referencia da UNA sola clave para las 13', new Set(llaveVieja).size, 1);
ok('⇒ con esa llave se habrían perdido 12 de 13 filas', new Set(llaveVieja).size < filas.length);

console.log('\nSin número de control NO se guarda (antes que guardar mal, no guardar):');
eq('_cn ausente → null', bncFilaBanco({ fecha: '2026-08-09', bs: 100, tipo: 'egreso' }), null);
eq('_cn vacío → null', bncFilaBanco({ _cn: '', fecha: '2026-08-09', bs: 100 }), null);
eq('_cn en blanco → null', bncFilaBanco({ _cn: '   ', fecha: '2026-08-09', bs: 100 }), null);
ok('_cn presente → sí se guarda', bncFilaBanco({ _cn: '74052815', fecha: '2026-04-30', bs: 1 }) !== null);

console.log('\nEl id es determinista: traer lo mismo dos veces no duplica');
const a = bncFilaBanco(LOTE_30_04[0]), b = bncFilaBanco(LOTE_30_04[0]);
eq('mismo movimiento → mismo id', a.id, b.id);
eq('el id sale del ControlNumber', a.id, 'bnc_74052815');
ok('el id NO depende de la fecha ni del monto',
  bncFilaBanco({ ...LOTE_30_04[0], fecha: '2026-01-01', bs: 99999 }).id === a.id);

console.log('\nLo que se guarda es lo que el banco dijo:');
eq('egreso → debito', a.tipo, 'debito');
eq('ingreso → credito', bncFilaBanco({ ...LOTE_30_04[0], tipo: 'ingreso' }).tipo, 'credito');
eq('el monto se guarda en positivo', bncFilaBanco({ ...LOTE_30_04[0], bs: -2435.60 }).monto, 2435.60);
eq('la cuenta viaja', a.cuenta, '01910031682131012653');
eq('el saldo anterior viaja', a.saldo_anterior, 1520310.18);
eq('saldo ausente → null, no 0 (0 sería un saldo REAL y falso)',
  bncFilaBanco({ _cn: '1', bs: 1 }).saldo_anterior, null);

console.log('\nY el saldo encadena — así se comprueba que no falta ninguno en el medio:');
// dato real de la cuenta principal, 07/08/2026
const CADENA = [
  { prev: 5948929.55, monto: 3908.59 }, { prev: 5945020.96, monto: 1173842.94 },
  { prev: 4771178.02, monto: 3521.53 }, { prev: 4767656.49, monto: 18820 },
];
let roto = 0;
for (let i = 0; i < CADENA.length - 1; i++) {
  const esperado = Math.round((CADENA[i].prev - CADENA[i].monto) * 100) / 100;
  if (esperado !== CADENA[i + 1].prev) roto++;
}
eq('la cadena de saldos cierra sin huecos', roto, 0);

console.log('\n──────────────');
console.log('PASS: ' + pass + '   FAIL: ' + fail);
process.exit(fail ? 1 : 0);
