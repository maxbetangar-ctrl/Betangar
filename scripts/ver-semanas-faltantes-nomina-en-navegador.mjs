// ═══════════════════════════════════════════════════════════════════════════════
// ¿DÓNDE ESTÁ EL BOTÓN PARA CERRAR UNA SEMANA DE NÓMINA? — EN UN NAVEGADOR, SIN SESIÓN
//
// 🔴 POR QUÉ EXISTE. El 23/10/2026 se le mandó a Alejandra (QA, superadmin) esta
//    instrucción: «Entre a Nómina → Historial. Arriba le va a aparecer un aviso amarillo
//    con un botón por cada semana». Contestó: *«ESTE BOTON NO ESTA»* y *«no no esta»*.
//    Son 17 semanas sin cerrar y la Utilidad Real de Betangar inflada ~US$ 80-90 mil,
//    así que el botón importa.
//    Desde afuera se descartó todo: el código está comiteado (04/08) y DESPLEGADO (el
//    `app.html` de betangar.com es byte a byte el local), el contenedor `nm-hist-faltan`
//    existe, el RLS de `planillas` deja leer a cualquier autenticado (`using=true`), la
//    carga pagina de a 1000 (hay 2.147 planillas), faltan 17 semanas de verdad en la base
//    y ella es `superadmin`. Todo dice que el botón TIENE que estar.
//    ⇒ Lo que queda solo se ve en una pantalla. [[norma-una-pantalla-se-revisa-en-una-pantalla]]
//
// QUÉ COMPRUEBA, los dos estados en una corrida:
//   1. Con la pantalla recién abierta y SIN calcular  → ¿el aviso está?
//   2. Después de que corre `renderNominaHist()`      → ¿aparecen los botones, uno por semana?
//
// La sospecha que vino a confirmar o tumbar: `renderNominaHist()` se llama al FINAL del
// cálculo de nómina (app.js, junto a `renderNomAdm()`), no al abrir la pantalla. Si es así,
// la instrucción que se le mandó está mal y el producto no tiene la culpa.
//
// Cómo: se abre el `app.html` DESPLEGADO con su `app.js` DESPLEGADO y se CORTA toda la red
// hacia Supabase — no se lee ni se escribe NADA real. Los datos se ponen a mano en la página.
//
// ⛔ QUÉ NO PRUEBA: no prueba el login, ni los permisos, ni el RLS, ni el guardado de la
//    semana. Prueba QUÉ DIBUJA la pantalla con el código que está en la calle.
//    [[norma-probar-el-camino-no-la-pieza]]
//
// Uso: node scripts/ver-semanas-faltantes-nomina-en-navegador.mjs [url]
// ═══════════════════════════════════════════════════════════════════════════════
import { pathToFileURL } from 'url';

const URL_APP = process.argv[2] || 'https://betangar.com/app.html';
const GLOBAL = 'C:/Users/Maxbetangar/AppData/Roaming/npm/node_modules/playwright/index.js';

let pw;
try { pw = await import('playwright'); }
catch {
  try { pw = await import(pathToFileURL(GLOBAL).href); }
  catch {
    console.error('Falta Playwright (se instalo GLOBAL a proposito):');
    console.error('  npm i -g playwright && npx playwright install chromium');
    process.exit(1);
  }
}
const chromium = pw.chromium || (pw.default && pw.default.chromium);
if (!chromium) { console.error('Playwright se importo pero no trae `chromium`.'); process.exit(1); }

const navegador = await chromium.launch();
// Contexto NUEVO siempre: un navegador ya usado es otro producto.
// [[norma-revisar-con-el-navegador-que-ya-usaste-es-otro-producto]]
const ctx = await navegador.newContext();
const page = await ctx.newPage();

// ⛔ NADA DE RED REAL hacia la base. Si algo se escapara, esto lo corta.
await page.route('**/rest/v1/**', r => r.fulfill({ status: 200, contentType: 'application/json', body: '[]' }));
await page.route('**/auth/v1/**', r => r.fulfill({ status: 200, contentType: 'application/json', body: '{}' }));

const errores = [];
page.on('pageerror', e => errores.push(String(e.message).slice(0, 160)));
// ⛔ EL ERROR VIVE EN LA CONSOLA, NO EN UNA EXCEPCION. `renderNominaHist()` envuelve el
//    pintado del aviso en un try/catch que solo hace `console.log('faltantes nomina:', ...)`.
//    Sin escuchar la consola, el fallo se ve como «no hay nada que mostrar».
//    [[norma-la-red-que-traga-el-error-tapa-la-pieza]]
const consola = [];
page.on('console', m => { const t = m.text(); if (/faltantes nomina|hist nomina|Error|error/i.test(t)) consola.push(t.slice(0, 200)); });

await page.goto(URL_APP, { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => typeof window.renderNominaHist === 'function', { timeout: 30000 });

// ── Datos de juguete: 4 semanas con planillas, 1 sola cerrada ⇒ tienen que faltar 3.
const resultado = await page.evaluate(() => {
  const lunes = ['2026-06-22', '2026-06-29', '2026-07-06', '2026-07-13'];
  window.REGS = lunes.flatMap(l => ([
    { p: 'P-' + l, f: l, cam: 'JAC-B001', ch: 'PRUEBA', d: 1, n: 0, t: 1, m: 100 },
  ]));
  window.NOMINA_HIST = [{ fecha_desde: '2026-06-22', semana: 'S1', total_usd: 10, total_bs: 10, detalle: {} }];

  const caja = () => document.getElementById('nm-hist-faltan');
  const cuenta = () => {
    const c = caja();
    if (!c) return { existe: false };
    const html = c.innerHTML || '';
    return {
      existe: true,
      vacio: html.trim() === '',
      avisoAmarillo: html.includes('NO están en el historial'),
      botones: (html.match(/irASemanaNomina/g) || []).length,
    };
  };

  const antes = cuenta();                 // 1) la pantalla "recién abierta"
  let fallo = null;
  try { window.renderNominaHist(); } catch (e) { fallo = String(e.message).slice(0, 160); }
  const despues = cuenta();               // 2) después de que corre el pintado

  const faltantes = (typeof window._semanasFaltantesNomina === 'function')
    ? window._semanasFaltantesNomina().length : null;

  return { antes, despues, fallo, faltantes };
});

const { antes, despues, fallo, faltantes } = resultado;
console.log('\n¿DÓNDE ESTÁ EL BOTÓN DE CERRAR LA SEMANA? ·', new Date().toLocaleString('es-VE'));
console.log('   url:', URL_APP, '\n');
console.log('   el contenedor `nm-hist-faltan` existe:', antes.existe ? '✅ sí' : '⛔ NO');
console.log('   semanas que el cálculo da por faltantes:', faltantes, '(se sembraron 4 con planillas y 1 cerrada ⇒ 3)');
console.log('');
console.log('   1) pantalla abierta, SIN que corra el pintado:');
console.log('        aviso amarillo:', antes.avisoAmarillo ? '✅ se ve' : '⛔ NO se ve', ' · botones:', antes.botones);
console.log('   2) después de `renderNominaHist()`:');
console.log('        aviso amarillo:', despues.avisoAmarillo ? '✅ se ve' : '⛔ NO se ve', ' · botones:', despues.botones);
if (fallo) console.log('   ⛔ `renderNominaHist()` reventó:', fallo);
if (errores.length) console.log('   ⚠️ errores de la página:', errores.slice(0, 3).join(' | '));
if (consola.length) { console.log('   📣 lo que dijo la consola (ahí se esconde el fallo):'); consola.slice(0,6).forEach(l => console.log('        ·', l)); }
else console.log('   📣 la consola no dijo nada.');

console.log('\n   VEREDICTO');
if (!antes.avisoAmarillo && despues.avisoAmarillo && despues.botones >= 3) {
  console.log('   ⇒ El botón EXISTE y funciona, pero SOLO después de que la nómina se pinta.');
  console.log('      Abrir «Nómina → Historial» no alcanza: hay que calcular la nómina (o tocar el');
  console.log('      ↻ del recuadro «📚 Historial de Nómina»). La instrucción que se mandó estaba mal.');
} else if (despues.botones === 0) {
  console.log('   ⇒ El botón NO aparece ni forzando el pintado: el problema es del producto.');
} else {
  console.log('   ⇒ Resultado mixto: mirar los números de arriba antes de afirmar nada.');
}

await navegador.close();
