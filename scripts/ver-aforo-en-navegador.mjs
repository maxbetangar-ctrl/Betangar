// ═══════════════════════════════════════════════════════════════════════════════
// VER LO QUE LA PANTALLA DEL AFORO LE DICE A QUIEN MIDE — EN UN NAVEGADOR, SIN SESIÓN
//
// Qué revisa: que antes de guardar un aforo, la pantalla DIGA qué va a pasar con el
// RECORRIDO DE LA REGLA, que no es el alto del tanque. Los dos estados en una corrida:
//   · la regla la midió alguien  → se dice que NO se toca y por dónde se indexa la tabla
//   · nadie midió la regla       → se dice que es un SUPUESTO, y qué hacer si el chofer
//                                   marca más que eso
//
// 🔴 POR QUÉ EXISTE. El 05/10/2026 un re-aforo por geometría bajó el recorrido de la regla
//    del FC17 de 48 a 27 cm, y la pantalla no dijo una palabra. Dos días de un chofer
//    peleando —«ustedes tienen un error gravísimo»—, 150 L cantados donde había 75, y la
//    auditoría de esa unidad 48 h sin un solo litro. Un default que no se declara no se
//    puede discutir, así que ahora se declara EN LA PANTALLA; esto comprueba que se vea.
//
// Cómo: se abre el `app.html` DESPLEGADO con su `app.js` y su `cubicacion.js` DESPLEGADOS,
// se corta toda la red hacia Supabase (no se lee ni se escribe NADA real) y se le pregunta
// a la página misma qué texto produce en cada estado.
//
// ⛔ QUÉ NO PRUEBA: no maneja el formulario del aforo (vive detrás del login de
//    administración), así que no prueba el guardado ni los permisos ni el RLS. Prueba lo
//    que la pantalla DICE y lo que la tabla CALCULA, con el código que está en la calle.
//
// Uso: node scripts/ver-aforo-en-navegador.mjs [url]
// ═══════════════════════════════════════════════════════════════════════════════
import { pathToFileURL } from 'url';

const URL_APP = process.argv[2] || 'https://betangar.com/app.html';
const GLOBAL = 'C:/Users/Maxbetangar/AppData/Roaming/npm/node_modules/playwright/index.js';

let pw;
try { pw = await import('playwright'); }
catch {
  try { pw = await import(pathToFileURL(GLOBAL).href); }
  catch {
    console.error('Falta Playwright. Se instalo GLOBAL a proposito (en el package.json haria');
    console.error('que Vercel lo bajara en cada despliegue para algo que se usa a mano):');
    console.error('  npm i -g playwright && npx playwright install chromium');
    process.exit(1);
  }
}
// Importado como CJS (el global) viene envuelto en `.default`; como ESM, no. Los dos sirven.
const chromium = pw.chromium || (pw.default && pw.default.chromium);
if (!chromium) { console.error('Playwright se importo pero no trae `chromium`.'); process.exit(1); }

// Las medidas REALES del FC17: 51 x 27 x 109 cm = 150,09 L, y su regla recorre 48 cm.
const FC17 = { ancho_cm: 51, alto_cm: 27, largo_cm: 109, radio_cm: 1 };

const b = await chromium.launch();
const ctx = await b.newContext();           // contexto NUEVO siempre
const page = await ctx.newPage();
await page.route('**/*.supabase.co/**', r =>
  r.fulfill({ status: 200, contentType: 'application/json', body: '[]' }));

await page.goto(URL_APP, { waitUntil: 'domcontentloaded', timeout: 120000 });
await page.waitForFunction(
  'typeof _tqAvisoRegla==="function" && typeof tablaCubicacion==="function" && typeof _tqRegla==="function"',
  null, { timeout: 120000 }
);
console.log('Pagina: ' + URL_APP + '\n');

const preguntar = (prev, m) => page.evaluate(x => {
  window._tqExistente = x.prev;
  const texto = window._tqAvisoRegla('redondeado', x.m)
    .replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
  const r = window._tqRegla(x.prev, 'redondeado', x.m);
  const t = window.tablaCubicacion('redondeado', x.m, r.cm);
  return { texto, cm: r.cm, origen: r.origen, claves: Object.keys(t).length, tope: t[r.cm], en24: t[24], en32: t[32] };
}, { prev, m: m });

// ── ESTADO 1 · la regla la midió alguien (el FC17 de hoy) ────────────────────
const medida = await preguntar(
  { altura_max_cm: 48, regla_origen: 'historial_del_chofer', alto_cm: 27, forma: 'redondeado' }, FC17);
console.log('(1) La regla la midio alguien:');
console.log('    dice   : ' + medida.texto);
console.log('    usa    : ' + medida.cm + ' cm (' + medida.origen + ')');
console.log('    tabla  : ' + medida.claves + ' claves · tope ' + medida.tope + ' L · 24cm=' + medida.en24 + ' · 32cm=' + medida.en32 + '\n');

// ── ESTADO 2 · nadie la midió (tanque nuevo) ─────────────────────────────────
const supuesta = await preguntar(null, FC17);
console.log('(2) Nadie midio la regla:');
console.log('    dice   : ' + supuesta.texto);
console.log('    usa    : ' + supuesta.cm + ' cm (' + supuesta.origen + ')');
console.log('    tabla  : ' + supuesta.claves + ' claves · tope ' + supuesta.tope + ' L\n');

await b.close();

const ok = [
  ['con la regla medida, usa 48 y no el alto', medida.cm === 48],
  ['y lo DICE en la pantalla', /no se toca/i.test(medida.texto) && /48/.test(medida.texto)],
  ['la tabla llega a 48 y da los 150 L', medida.claves === 48 && medida.tope === 150],
  ['24 cm dan 75 L, no 133', Math.abs(medida.en24 - 75) <= 0.3],
  ['sin medicion, avisa que es un SUPUESTO', /supon/i.test(supuesta.texto) && /nadie midio la regla/i.test(supuesta.texto.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, ''))],
  ['y le dice al que afora que hacer si el chofer marca mas', /reporte/i.test(supuesta.texto)],
  ['sin medicion la tabla vuelve al alto (identica a antes)', supuesta.claves === 27 && supuesta.tope === 150]
];
ok.forEach(([q, v]) => console.log((v ? '  OK  ' : '  ✗   ') + q));
process.exit(ok.every(([, v]) => v) ? 0 : 1);
