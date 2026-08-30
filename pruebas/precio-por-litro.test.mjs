// ══════════════════════════════════════════════════════════════════════════════
// EL CANDADO DEL PRECIO POR LITRO (oficina) — pruebas
//
// Las varas se EXTRAEN DE `app.js`, no se copian acá: una copia se desincroniza y
// esta prueba pasaría verde sobre un candado que en producción es otro.
//
// Contexto: el 26/08 se puso un candado para esto en el archivo equivocado
// (`chofer.html`, donde el chofer ni escribe el precio) y encima llamaba a una
// función inexistente: dejó tres días a la flota sin poder cargar combustible.
// Ésta es la versión puesta donde el precio SÍ se teclea, y con prueba.
//
//   node pruebas/precio-por-litro.test.mjs
// ══════════════════════════════════════════════════════════════════════════════
import { readFileSync } from 'node:fs';

const src = readFileSync(new URL('../app.js', import.meta.url), 'utf8');

const m = src.match(/var PRECIO_MAX_L=([\d.]+), PRECIO_AVISO_L=([\d.]+);/);
if (!m) { console.error('FALLA: no se encontró la vara del precio en app.js'); process.exit(1); }
const PRECIO_MAX_L = parseFloat(m[1]), PRECIO_AVISO_L = parseFloat(m[2]);

// Y que el bloque siga estando DESPUÉS de que existan litF y cUsd: si alguien lo
// mueve arriba, el mensaje muestra "NaN L" y "undefined". Ya pasó al escribirlo.
const iVars = src.indexOf('var cUsd=parseFloat(g(\'per-calc\').dataset.cusd)||0;');
const iCand = src.indexOf('var PRECIO_MAX_L=');
const iGuarda = src.indexOf("from('combustible_periodos').insert");
if (!(iVars < iCand && iCand < iGuarda)) {
  console.error('FALLA: el candado tiene que ir DESPUÉS de litF/cUsd y ANTES de guardar el período.');
  process.exit(1);
}

// La misma cuenta que hace `app.js`: el precio más alto de todos los tramos.
const masAlto = (tramos) => Math.max.apply(null,
  (tramos || []).map(t => parseFloat(t && t.precio_usd)).filter(v => !isNaN(v) && v > 0).concat([0]));

const veredicto = (tramos) => {
  const p = masAlto(tramos);
  if (p > PRECIO_MAX_L) return 'RECHAZA';
  if (p > PRECIO_AVISO_L) return 'PREGUNTA';
  return 'PASA';
};

// Los precios REALES pagados, medidos el 29/08 sobre 58 surtidas con costo definido.
const CASOS = [
  ['0,500 — el más barato que se pagó',        [{ precio_usd: 0.5 }],                 'PASA'],
  ['0,812 — el más caro que se pagó',          [{ precio_usd: 0.812 }],               'PASA'],
  ['1,00 — el dólar del que habla Carlos',     [{ precio_usd: 1 }],                   'PASA'],
  ['1,49 — justo debajo del aviso',            [{ precio_usd: 1.49 }],                'PASA'],
  ['1,60 — el precio subió de verdad',         [{ precio_usd: 1.6 }],                 'PREGUNTA'],
  ['5,00 — el tope exacto, todavía no rechaza',[{ precio_usd: 5 }],                   'PREGUNTA'],
  ['5,01 — pasado el tope',                    [{ precio_usd: 5.01 }],                'RECHAZA'],
  ['100 — EL CASO DEL FC16 (era 1)',           [{ precio_usd: 100 }],                 'RECHAZA'],
  ['escalera: 0,50 y un 100 escondido atrás',  [{ precio_usd: 0.5 }, { precio_usd: 100 }], 'RECHAZA'],
  ['escalera normal 0,55 + 0,75',              [{ precio_usd: 0.55 }, { precio_usd: 0.75 }], 'PASA'],
  // El arreglo de la escalera mete un tramo {escalera:{…}} SIN precio_usd: no puede romper.
  ['con el tramo de escalera sin precio',      [{ precio_usd: 0.8 }, { escalera: { litros: 300 } }], 'PASA'],
  ['sin tramos',                               [],                                    'PASA'],
  ['tramos nulo',                              null,                                  'PASA'],
];

let malos = 0;
for (const [nombre, tramos, esperado] of CASOS) {
  const r = veredicto(tramos);
  if (r !== esperado) { console.error(`MAL: ${nombre} → ${r} (esperaba ${esperado})`); malos++; }
}

console.log(`vara leída de app.js: rechaza sobre $${PRECIO_MAX_L}/L · pregunta sobre $${PRECIO_AVISO_L}/L`);
console.log(`casos probados: ${CASOS.length}`);
if (malos) { console.error(`\nFALLA: ${malos} caso(s) mal.`); process.exit(1); }
console.log('OK — deja pasar lo que se paga de verdad y frena el error de tipeo del FC16.');
