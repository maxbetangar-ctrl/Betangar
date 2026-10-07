// ═══════════════════════════════════════════════════════════════════════════════
// VER LA PANTALLA DE CUENTAS POR PAGAR EN UN NAVEGADOR DE VERDAD, SIN SESIÓN
//
// Qué revisa: que las 5 cuentas que reportó Alejandra el 05/10/2026 (OS-73 y OS-79 de
// Mangueras Perijá; OS-114, OS-115 y OS-126 de INCONSUMMCA) dejen de dibujar saldo
// pendiente. Los dos estados en LA MISMA corrida: ANTES (lo que ella veía) y DESPUÉS.
//
// Cómo: se abre `app.html` DESPLEGADO con el `app.js` DESPLEGADO, se corta toda la red
// hacia Supabase (ni auth ni rest: no se lee ni se escribe NADA real) y se le sirven a
// la pantalla los datos reales de la base. Después se llama a `renderCXP()` y se lee lo
// que quedó dibujado en el panel «Deuda por proveedor».
//
// ⛔ QUÉ NO PRUEBA: no prueba la API, ni los permisos, ni el RLS. Prueba lo que la
//    pantalla DIBUJA. Las dos mitades no se ven pegadas hasta que haya un login de verdad.
//
// Uso: node scripts/ver-cxp-en-navegador.mjs [url]
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

// Los datos REALES, tal cual estaban en la base antes de la corrección del 07/10.
const PAGOS = [
  { id: 91, cxp_id: 'CXP1788806458466', fecha: '2026-09-22', monto_bs: 22127.20, tasa_val: 857.88, monto_usd: 25.79 },
  { id: 92, cxp_id: 'CXP1790784626926', fecha: '2026-09-22', monto_bs: 22127.19, tasa_val: 857.88, monto_usd: 25.79 },
  { id: 93, cxp_id: 'CXP1791217369808', fecha: '2026-09-29', monto_bs: 74458.21, tasa_val: 974.71, monto_usd: 76.39 },
  { id: 94, cxp_id: 'CXP1791217384164', fecha: '2026-09-29', monto_bs: 39711.05, tasa_val: 974.71, monto_usd: 40.74 },
  { id: 95, cxp_id: 'CXP1791217431791', fecha: '2026-09-29', monto_bs: 148916.43, tasa_val: 974.71, monto_usd: 152.78 }
];
const LINEAS = [
  { id: 49, factura_id: 49, cxp_id: 'CXP1788806458466', orden_id: 'OS-2026-0073', base_bs: 21276.15, iva_bs: 3404.19, ret_iva_bs: 2553.14, ret_islr_bs: 0, neto_bs: 22127.20, tasa_val: 857.88 },
  { id: 51, factura_id: 49, cxp_id: 'CXP1790784626926', orden_id: 'OS-2026-0079', base_bs: 21276.15, iva_bs: 3404.18, ret_iva_bs: 2553.14, ret_islr_bs: 0, neto_bs: 22127.19, tasa_val: 857.88 },
  { id: 52, factura_id: 50, cxp_id: 'CXP1791217369808', orden_id: 'OS-2026-0114', base_bs: 72998.25, iva_bs: 11679.72, ret_iva_bs: 8759.79, ret_islr_bs: 1459.96, neto_bs: 74458.21, tasa_val: 974.71 },
  { id: 53, factura_id: 50, cxp_id: 'CXP1791217384164', orden_id: 'OS-2026-0115', base_bs: 38932.40, iva_bs: 6229.18, ret_iva_bs: 4671.89, ret_islr_bs: 778.65, neto_bs: 39711.05, tasa_val: 974.71 },
  { id: 54, factura_id: 50, cxp_id: 'CXP1791217431791', orden_id: 'OS-2026-0126', base_bs: 145996.50, iva_bs: 23359.44, ret_iva_bs: 17519.58, ret_islr_bs: 2919.93, neto_bs: 148916.43, tasa_val: 974.71 }
];
const FACTURAS = [
  { id: 49, cxp_id: 'CXP1788806458466', orden_id: 'OS-2026-0073', nro_factura: 'F-00000339', fecha: '2026-09-22', base_bs: 42552.30, iva_pct: 16, iva_bs: 6808.37, ret_iva_bs: 5106.28, ret_islr_bs: 0, neto_bs: 44254.39, tasa_val: 857.88 },
  { id: 50, cxp_id: 'CXP1791217369808', orden_id: 'OS-2026-0114', nro_factura: 'F-0000349', fecha: '2026-09-29', base_bs: 257927.15, iva_pct: 16, iva_bs: 41268.34, ret_iva_bs: 30951.26, ret_islr_bs: 5158.54, neto_bs: 263085.69, tasa_val: 974.71 }
];
const CXP_ANTES = [
  { id: 'CXP1788806458466', orden_id: 'OS-2026-0073', prov_id: 'P-MP', prov_nombre: 'MANGUERAS PERIJA, C.A.', base_usd: 24.96, iva_usd: 3.97, total_usd: 28.93, ret_iva_usd: 2.98, ret_islr_usd: 0, neto_pagar: 25.95, estado: 'pendiente', tasa_val: 857.88, fecha: '2026-09-03' },
  { id: 'CXP1790784626926', orden_id: 'OS-2026-0079', prov_id: 'P-MP', prov_nombre: 'MANGUERAS PERIJA, C.A.', base_usd: 24.96, iva_usd: 3.97, total_usd: 28.93, ret_iva_usd: 2.98, ret_islr_usd: 0, neto_pagar: 25.95, estado: 'pendiente', tasa_val: 857.88, fecha: '2026-09-09' },
  { id: 'CXP1791217369808', orden_id: 'OS-2026-0114', prov_id: 'P-IC', prov_nombre: 'INCONSUMMCA, C.A. (ATLAS)', base_usd: 75, iva_usd: 11.98, total_usd: 86.98, ret_iva_usd: 8.99, ret_islr_usd: 1.50, neto_pagar: 76.50, estado: 'pendiente', tasa_val: 974.71, fecha: '2026-09-26' },
  { id: 'CXP1791217384164', orden_id: 'OS-2026-0115', prov_id: 'P-IC', prov_nombre: 'INCONSUMMCA, C.A. (ATLAS)', base_usd: 40, iva_usd: 6.39, total_usd: 46.39, ret_iva_usd: 4.79, ret_islr_usd: 0.80, neto_pagar: 40.80, estado: 'pendiente', tasa_val: 974.71, fecha: '2026-09-26' },
  { id: 'CXP1791217431791', orden_id: 'OS-2026-0126', prov_id: 'P-IC', prov_nombre: 'INCONSUMMCA, C.A. (ATLAS)', base_usd: 150, iva_usd: 23.97, total_usd: 173.97, ret_iva_usd: 17.97, ret_islr_usd: 3.00, neto_pagar: 153.00, estado: 'pendiente', tasa_val: 974.71, fecha: '2026-09-25' }
];

// Importado como CJS (el global) viene envuelto en `.default`; como ESM, no. Los dos sirven.
const chromium = pw.chromium || (pw.default && pw.default.chromium);
if (!chromium) { console.error('Playwright se importo pero no trae `chromium`.'); process.exit(1); }

const b = await chromium.launch();
// Contexto NUEVO: revisar con el navegador que ya usaste es revisar otro producto.
const ctx = await b.newContext();
const page = await ctx.newPage();

// Se corta TODA la red hacia Supabase: ni auth ni rest. No se lee ni se escribe nada real.
let tocoSupabase = 0;
await page.route('**/*.supabase.co/**', r => {
  tocoSupabase++;
  return r.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
});

await page.goto(URL_APP, { waitUntil: 'domcontentloaded', timeout: 120000 });
await page.waitForFunction(
  'typeof renderCXP==="function" && typeof _aplicarFacturasACxp==="function"',
  null, { timeout: 120000 }
);

const leer = () => page.evaluate(() => {
  const el = document.getElementById('cxp-por-prov');
  return {
    panel: el ? el.innerText.replace(/\n+/g, ' | ').trim() : '(no existe #cxp-por-prov)',
    netos: (window.CXP || []).map(c => c.orden_id + '=' + Number(c.neto_pagar).toFixed(2) + '/' + (c.estado || '-')),
    saldoTotal: (window.CXP || []).reduce((s, c) => s + Math.max(0, window._cxpSaldoUsd(c)), 0).toFixed(2)
  };
});

const sembrar = d => page.evaluate(x => {
  window.CXP = x.cxp; window.CXP_PAGOS = x.pagos;
  window.CXP_FACTURAS = x.facturas; window.CXP_FAC_LINEAS = x.lineas;
  window.DB_READY = false;                       // nada de escribir
  const ov = document.getElementById('login-overlay'); if (ov) ov.style.display = 'none';
  window.renderCXP();
}, d);

console.log('Pagina: ' + URL_APP + '\n');

// ── ESTADO 1 · ANTES: lo que Alejandra veia ──────────────────────────────────
await sembrar({ cxp: JSON.parse(JSON.stringify(CXP_ANTES)), pagos: PAGOS, facturas: FACTURAS, lineas: LINEAS });
const antes = await leer();
console.log('(1) ANTES, con los datos tal cual estaban el 05/10:');
console.log('    netos: ' + antes.netos.join('  '));
console.log('    saldo: US$ ' + antes.saldoTotal);
console.log('    panel "Deuda por proveedor": ' + antes.panel + '\n');

// ── ESTADO 2 · DESPUES: el codigo desplegado recalcula desde la factura ──────
await page.evaluate(() => { window.CXP.forEach(c => window._aplicarFacturasACxp(c)); window.renderCXP(); });
const despues = await leer();
console.log('(2) DESPUES, el app.js desplegado recalcula desde la factura:');
console.log('    netos: ' + despues.netos.join('  '));
console.log('    saldo: US$ ' + despues.saldoTotal);
console.log('    panel "Deuda por proveedor": ' + despues.panel + '\n');

await page.screenshot({ path: 'scripts/_cxp-despues.png' }).catch(() => {});

// ── Veredicto ────────────────────────────────────────────────────────────────
const ok = [
  ['el ANTES reproduce el saldo fantasma', Number(antes.saldoTotal) > 0.005 && Number(antes.saldoTotal) < 1],
  ['el DESPUES no deja saldo', Number(despues.saldoTotal) <= 0.005],
  ['las 5 quedan en pagada', despues.netos.every(s => s.endsWith('/pagada'))],
  ['el panel ya no nombra deuda', /Sin deudas por pagar/i.test(despues.panel)]
];
ok.forEach(([q, v]) => console.log((v ? '  OK  ' : '  ✗   ') + q));
console.log('\n  (llamadas a Supabase interceptadas, ninguna llego a la base: ' + tocoSupabase + ')');
await b.close();
process.exit(ok.every(([, v]) => v) ? 0 : 1);
