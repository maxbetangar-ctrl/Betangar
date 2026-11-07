// ══════════════════════════════════════════════════════════════════════════════
// LA EXACTITUD DEL MÓDULO DE COMBUSTIBLE
//
// 🔴 Máximo, 06/11/2026: «todo hay que arreglar como expertos todo para que
//    quede lo mas optimo». Esto fija los tres arreglos que salieron del
//    análisis del módulo.
//
//   node test/combustible-exactitud.test.js
// ══════════════════════════════════════════════════════════════════════════════
const fs = require('fs');
const path = require('path');
const APP = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
const CHOFER = fs.readFileSync(path.join(__dirname, '..', 'chofer.html'), 'utf8');

let pass = 0, fail = 0;
function eq(name, got, exp) {
  const c = JSON.stringify(got) === JSON.stringify(exp);
  if (c) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ ' + name + '  → got ' + JSON.stringify(got) + ', exp ' + JSON.stringify(exp)); }
}
const ok = (n, c) => eq(n, !!c, true);

console.log('\nEXACTITUD DEL MÓDULO DE COMBUSTIBLE\n');

// ── 1. La tolerancia sale de la PRECISIÓN de cada lectura ──────────────────
// 1 cm = 11,94 L en este tanque. Con ±1 cm la tolerancia de una jornada es
// 33,8 L y un TURNO consume ~29: la tolerancia era más grande que todo lo que
// el camión gastaba. Al medio centímetro cae a 16,9 L.
ok('existe `_acSigmaDe`', APP.includes('function _acSigmaDe(h){'));
ok('`_acTol` la usa en vez del sigma fijo',
   APP.includes('var eA=sA*_acSigmaDe(hA), eB=sB*_acSigmaDe(hB)'));
ok('ya no se castiga a todos con ±1 cm',
   !APP.includes('var eA=sA*AC_SIGMA_CM, eB=sB*AC_SIGMA_CM'));

// La regla, reproducida: entera ±1 · media ±0,5 · más fina ±0,25
function sigma(h) {
  const n = Number(h); if (!isFinite(n)) return 1;
  const r = Math.round(n * 100) / 100;
  if (r === Math.round(r)) return 1;
  if (Math.abs(r * 2 - Math.round(r * 2)) < 1e-9) return 0.5;
  return 0.25;
}
eq('34 cm → ±1 cm', sigma(34), 1);
eq('34,5 cm → ±0,5 cm', sigma(34.5), 0.5);
eq('34,25 cm → ±0,25 cm', sigma(34.25), 0.25);
eq('un entero escrito con decimal (34,0) sigue siendo ±1', sigma(34.0), 1);

// Y lo que eso hace con la tolerancia, que es el punto:
const LCM = 11.94;
const tol = (sA, sB) => 2 * Math.sqrt((LCM * sA) ** 2 + (LCM * sB) ** 2);
eq('dos lecturas al centímetro → 33,8 L de tolerancia', Math.round(tol(1, 1) * 10) / 10, 33.8);
eq('dos lecturas al medio → 16,9 L', Math.round(tol(0.5, 0.5) * 10) / 10, 16.9);
ok('…o sea la mitad', Math.abs(tol(1, 1) / tol(0.5, 0.5) - 2) < 1e-9);
ok('un turno (~29 L) deja de estar tapado por la tolerancia', tol(0.5, 0.5) < 28.9);

// ── 2. El odómetro que va para atrás ───────────────────────────────────────
ok('existe la regla R10c', APP.includes("'R10c','El odómetro va para atrás'"));
ok('mira el caso contrario al de R10b',
   APP.includes('j.kmS < _acPrevKm[j.cam]'));
ok('R10b (el salto hacia adelante) sigue estando',
   APP.includes("'R10b','Kilometraje imposible'"));
ok('y nombra al chofer del TURNO, no al primero del día',
   APP.split("_quien(j.cam,j.fecha,j.turno)").length - 1 >= 10);

// ── 3. La cubicación topa igual en los dos lados ───────────────────────────
// `tanque_veredicto` (base) hace `least(cm, altura_max_cm)`. El navegador
// topaba en el último punto de la TABLA, que desde que la tabla se extendió a
// 53 ya no es lo mismo.
ok('`_acCubicar` topa en la altura del tanque',
   APP.includes('var hmax=_acNum(tanque.hmax);') && APP.includes('if(hmax!=null&&hmax>0&&h>hmax)h=hmax;'));

// ── 4. Al chofer se le pide el medio centímetro ────────────────────────────
ok('la casilla acepta decimales', CHOFER.includes('step="0.1"'));
ok('y la pantalla lo PIDE, que es lo que hace que ocurra',
   CHOFER.includes('con el medio') && CHOFER.includes('34,5'));


// ── 5. R4b: CONSUMIÓ MENOS DE LO QUE EL CAMIÓN PUEDE ──────────────────────
// Máximo mandó la foto: B006 el 04/11 figura con 5,3 L para 104 km (19,7 km/L
// en un camión que hace 2,1). Ninguna regla lo miraba: R4 ve el consumo de
// MÁS y R1/R13 ven el tanque que GANA litros. Un consumo positivo pero
// absurdamente bajo caía justo en el medio — y es el caso más peligroso,
// porque así se ve un robo cuando además se infla la lectura de llegada.
ok('existe la regla R4b', APP.includes("'R4b','Consumió menos de lo que el camión puede'"));
ok('la jornada queda marcada', APP.includes('j.rendImposible='));
ok('y NO cuenta como jornada completa', APP.includes("j.rendImposible ? 'rend_imposible'"));
ok('su rendimiento no ensucia la mediana', APP.includes('&&!j.rendImposible)?(j.km/j.consumo):null'));
ok('queda fuera del total de jornadas buenas', APP.includes('!j.cargaImposible&&!j.rendImposible'));

// Hacen falta LAS DOS condiciones: la proporción imposible Y que el faltante
// supere el error de lectura. Medido sobre 1.303 jornadas: sólo con el techo
// saltan 60 y 48 caen en el borde, dentro de la incertidumbre. Con las dos, 43.
ok('pide el techo de km/L', APP.includes('(j.km/j.consumo)>_refMod*2'));
ok('y además que supere la tolerancia', APP.includes('(_esperaJ-j.consumo)>j.tol'));
ok('la tolerancia se calcula ANTES de usarla',
   APP.indexOf('j.tol=_acTol(j.tanque,j.salidaCm,j.llegadaCm,j.desp);') < APP.indexOf('j.rendImposible='));
ok('no acusa a nadie: lo dice como contradicción',
   APP.includes('No es una acusación'));

// La cuenta del caso real, fijada.
const salida = 59.76, carga = 350, llegada = 404.48, kmB006 = 104;
eq('B006 04/11: 5,28 L de consumo', Math.round((salida + carga - llegada) * 100) / 100, 5.28);
ok('…o sea 19,7 km/L', Math.abs(kmB006 / 5.28 - 19.7) < 0.1);
ok('…más del doble del techo del modelo (1,9 x 2 = 3,8)', kmB006 / 5.28 > 1.9 * 2);

console.log('\n  ' + pass + ' pasaron, ' + fail + ' fallaron\n');
process.exit(fail ? 1 : 0);
