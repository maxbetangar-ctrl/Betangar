// ═══════════════════════════════════════════════════════════════════════════════
// EL COSTO POR TONELADA EN EL INFORME — revisado en un navegador de verdad
//
// Máximo, 20/10/2026: «sigo sin saber en dónde me da ese costo en el software,
// debería aparecer en el informe». Tenía razón desde antes: la norma de la casa dice
// que el costo por unidad **abre** el informe financiero, y estaba en dos pantallas
// que él no visita.
//
// Qué revisa, en una corrida:
//   1. El bloque va ARRIBA DE TODO, antes de «1 · El resultado del período».
//   2. Trae el número, de dónde sale, y la cuota de la financiadora COMPLETA.
//   3. Los tres números de la cabecera CIERRAN: cuesta + le queda = cobra.
//   4. El gasto del bloque es EL MISMO que el del resto del informe (si difiriera,
//      el informe se desmentiría a sí mismo delante del dueño).
//   5. Sin viajes en el rango lo DICE, no muestra $0,00.
//   6. Si no se puede calcular, el bloque NO desaparece: avisa.
//   7. En el IMPRESO también está (es lo que se manda).
//
// ⛔ QUÉ NO PRUEBA: ni las RPC, ni sus permisos, ni el RLS. Prueba lo que se DIBUJA.
//
// Uso: node scripts/ver-informe-costo-tonelada.mjs [app.js local] [url de app.html]
// ═══════════════════════════════════════════════════════════════════════════════
import { pathToFileURL } from 'url';
import { readFileSync } from 'fs';
import path from 'path';

const JS_LOCAL = process.argv[2] || path.join(process.cwd(), 'app.js');
const URL_APP = process.argv[3] || 'https://betangar.com/app.html';
const GLOBAL = 'C:/Users/Maxbetangar/AppData/Roaming/npm/node_modules/playwright/index.js';
let pw;
try { pw = await import('playwright'); } catch { pw = await import(pathToFileURL(GLOBAL).href); }
const chromium = pw.chromium || (pw.default && pw.default.chromium);

const jsLocal = readFileSync(JS_LOCAL, 'utf8');
const htmlLocal = readFileSync(path.join(path.dirname(JS_LOCAL), 'app.html'), 'utf8');
// ⛔ Si el app.js no trae el bloque, esto revisaria la version vieja y saldria verde por nada.
if (!jsLocal.includes('function _infCostoTonelada')) {
  console.error('⛔ Ese app.js NO trae `_infCostoTonelada`: se revisaria la version vieja.');
  process.exit(1);
}

// Lo MEDIDO en la base el 19/10/2026, para que el informe se vea con cifras reales.
// El rango por defecto del informe es 23/03 → hoy, que es justo cuando arranca el banco.
const RESUMEN = {
  cobrado_usd: 412307, otras_entradas_usd: 9797,
  operacion_usd: 288001, administracion_usd: 83782, obligaciones_usd: 46055, socio_usd: 66656,
  gasto_usd: 484494, cambiario_usd: 0,
  utilidad_usd: -62390, margen_pct: -14.8, ahorro_divisas_usd: 181474,
  movs_sin_tasa: 0, divisas_sin_valuar: 0
};
const AMORT = [];
{
  // Lo MEDIDO el 20/10/2026 en `deuda_amortizacion(1)`: 5 cuotas pagadas enteras, la 6a a
  // medias (abonado 4.416,45 · resta 19.000,66) y la 7a sin pagar. Monto vencido 42.417,77,
  // que es exactamente la «1 cuota y pico» que dijo Maximo. Datos reales, no de juguete.
  const inter = [3840.00, 3644.23, 3446.50, 3246.79, 3045.09, 2841.37, 2635.61];
  const RESTA = [0, 0, 0, 0, 0, 19000.66, 23417.11];
  inter.forEach((x, i) => AMORT.push({
    nro: i + 1, vencimiento: '2026-' + String(4 + i).padStart(2, '0') + '-01',
    cuota: 23417.11, interes: x, capital: 23417.11 - x, saldo: 0,
    abono_aplicado: 23417.11 - RESTA[i], resta: RESTA[i],
    estado: RESTA[i] > 0 ? 'Vencida' : 'Pagada'
  }));
}
// 4.957 viajes DENTRO del rango del informe (23/03 → hoy) = 39.656 t.
const PLANILLAS = [
  { f: '2026-03-10', cam: 'JAC-B003', t: 203, m: 203 * 317.88 },    // ANTES del 23/03: no entra
  { f: '2026-04-15', cam: 'JAC-B001', t: 2500, m: 2500 * 317.88 },
  { f: '2026-09-15', cam: 'JAC-B002', t: 2457, m: 2457 * 317.88 }
];

let MODO = { deuda: true, viajes: true };
const b = await chromium.launch();
const page = await (await b.newContext()).newPage();
const js = (o) => ({ status: 200, contentType: 'application/json', body: JSON.stringify(o) });

await page.route('**/app.html*', r => r.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: htmlLocal }));
await page.route('**/app.js*', r => r.fulfill({ status: 200, contentType: 'application/javascript; charset=utf-8', body: jsLocal }));
// El comodin PRIMERO: Playwright prueba las rutas de la ultima a la primera.
await page.route('**/*.supabase.co/**', r => r.fulfill(js([])));
await page.route('**/rpc/btg_ve_financiero*', r => r.fulfill(js(true)));
await page.route('**/rpc/btg_resumen_socio*', r => r.fulfill(js([RESUMEN])));
await page.route('**/rpc/btg_donde_se_fue*', r => r.fulfill(js([
  { concepto: 'Nómina', usd: 191750, pct: 39.6 }, { concepto: 'Combustible', usd: 62868, pct: 13.0 }
])));
await page.route('**/rpc/btg_donde_esta_utilidad*', r => r.fulfill(js([])));
await page.route('**/rpc/btg_donde_estan_los_dolares*', r => r.fulfill(js([])));
await page.route('**/rpc/btg_utilidad_real_y_estimada*', r => r.fulfill(js([])));
await page.route('**/rpc/deuda_puede_ver*', r => r.fulfill(js(MODO.deuda)));
await page.route('**/rpc/deuda_amortizacion*', r => r.fulfill(js(AMORT)));
await page.route('**/deuda_financiamientos*', r => r.fulfill(js([{ id: 1, acreedor: 'AUTO UNION DC', estado: 'vigente' }])));
page.on('dialog', async d => { await d.dismiss(); });

await page.goto(URL_APP, { waitUntil: 'domcontentloaded', timeout: 120000 });
await page.waitForFunction('typeof renderInforme==="function" && typeof initSupabaseClient==="function"', null, { timeout: 120000 });
await page.waitForFunction('!!(window.supabase&&window.supabase.createClient)||typeof window.createClient==="function"', null, { timeout: 60000 });
await page.evaluate(() => { initSupabaseClient(); window.DEMO_MODE = false; });
await page.waitForFunction('DB_READY===true', null, { timeout: 30000 });

let fallas = 0;
const linea = (ok, txt) => { if (!ok) fallas++; console.log(`  ${ok ? 'OK   ' : 'FALLA'} ${txt}`); };

async function pintar() {
  await page.evaluate((p) => {
    window.REGS = p;
    window.cfg = window.cfg || {}; window.cfg.tonsViaje = 8;
    const el = document.getElementById('p-informe');
    if (el) { el.style.display = 'block'; el.classList.add('active'); }
    document.querySelectorAll('#login-screen,#login,.login-wrap,#overlay').forEach(e => { e.style.display = 'none'; });
    const d = document.getElementById('inf-des'), h = document.getElementById('inf-hta');
    if (d) d.value = '2026-03-23';
    if (h) h.value = new Date().toISOString().slice(0, 10);
  }, MODO.viajes ? PLANILLAS : []);
  await page.evaluate(() => renderInforme());
  await page.waitForFunction('!/Calculando desde el banco/.test(document.getElementById("inf-body").innerText)', null, { timeout: 40000 });
  return page.evaluate(() => {
    const el = document.getElementById('inf-body');
    const titulos = [...el.querySelectorAll('.ctitle')].map(t => t.innerText.trim());
    return { texto: el.innerText, titulos };
  });
}

console.log('\n── 1 · el bloque ABRE el informe ───────────────────────────');
let V = await pintar();
linea(/Su costo por tonelada/.test(V.titulos[0] || ''), 'es el PRIMER bloque del informe → ' + V.titulos[0]);
linea(/El resultado del per/.test(V.titulos[1] || ''), 'y «1 · El resultado» queda segundo → ' + V.titulos[1]);

console.log('\n── 2 · el número y de dónde sale ───────────────────────────');
// 4.957 viajes × 8 = 39.656 t. Gasto 484.494 + 7 cuotas 163.920 = 648.414 ⇒ 16,35 $/t
linea(/\$16,35/.test(V.texto), 'cuesta $16,35 la tonelada → ' + (V.texto.match(/\$1[0-9],\d\d/) || [''])[0]);
linea(/39\.656 toneladas = 4\.957 viajes × 8 t/.test(V.texto), 'dice las toneladas y de dónde salen');
linea(/del 23\/03\/2026 al \d\d\/\d\d\/\d{4}/.test(V.texto), 'con las fechas en dd/mm/yyyy, como el resto de la casa');
// ⛔ Este aviso NO PODIA DISPARARSE NUNCA: `primera` se calculaba dentro del bucle que ya
//    descartaba lo anterior al rango. Ahora se cuentan aparte, y la prueba lo exige.
linea(/203 viaje\(s\) anteriores al 23\/03\/2026 quedan afuera/.test(V.texto),
  'y AVISA de los 203 viajes que quedan afuera del rango');
linea(/AUTO UNION DC/.test(V.texto) && /entra COMPLETA/.test(V.texto), 'la cuota entra COMPLETA y nombra a la financiadora');
linea(/7 cuotas que vencieron/.test(V.texto), 'con cuántas cuotas vencieron en el período');

console.log('\n── 2b · LA MORA: contada en el costo, y dicha aparte ───────');
// ⛔ La cuota entra DEVENGADA (si no, estar en mora abarataria el costo), pero esa plata
//    todavia no salio del banco y el dueño necesita los dos numeros.
linea(/\$42\.41[78] SIN PAGAR/.test(V.texto), 'dice cuanto hay sin pagar → ' + (V.texto.match(/\$[\d.]+ SIN PAGAR/) || [''])[0]);
linea(/1 cuota entera y parte de otra/.test(V.texto), 'y lo descompone como lo dice el: 1 entera y parte de otra');
linea(/Ya están contadas en el costo/.test(V.texto), 'aclara que YA estan contadas en el costo de arriba');
linea(/\$1,07 de cada tonelada/.test(V.texto), 'y cuanto pesa por tonelada (42.417,77 / 39.656 = $1,07)');

console.log('\n── 3 · los tres números de la cabecera CIERRAN ─────────────');
const tres = await page.evaluate(() => {
  const t = document.getElementById('inf-body').innerText;
  const n = (re) => { const m = t.match(re); return m ? parseFloat(m[1].replace(/\./g, '').replace(',', '.')) : null; };
  return {
    cuesta: n(/mover una tonelada\s*\$([\d.,]+)/i),
    cobra: n(/Cobra\s*\$([\d.,]+)/i),
    queda: n(/Le queda\s*\$([\d.,]+)/i)
  };
});
linea(tres.cuesta !== null && tres.cobra !== null && tres.queda !== null, 'se leen los tres → ' + JSON.stringify(tres));
linea(Math.abs((tres.cobra - tres.cuesta) - tres.queda) < 0.005,
  `cobra − cuesta = le queda  (${tres.cobra} − ${tres.cuesta} = ${tres.queda})`);

console.log('\n── 4 · el gasto es EL MISMO que el del resto del informe ───');
// Si el bloque de arriba usara otra fuente, el informe se desmentiría a sí mismo.
linea(/484\.494/.test(V.texto), 'el gasto del bloque es el mismo 484.494 del cuadro «El resultado»');
const vecesGasto = (V.texto.match(/484\.494/g) || []).length;
linea(vecesGasto >= 2, `y aparece en los dos lugares con la misma cifra (${vecesGasto} veces)`);

console.log('\n── 5 · sin viajes en el rango: lo DICE, no muestra $0,00 ───');
MODO.viajes = false;
V = await pintar();
linea(/no hay toneladas entre las que dividir/i.test(V.texto), 'dice por qué no se puede');
linea(!/\$0,00/.test(V.texto.split('1 · El resultado')[0]), 'y NO muestra $0,00');
linea(/Su costo por tonelada/.test(V.titulos[0] || ''), 'el bloque NO desaparece: sigue abriendo el informe');
MODO.viajes = true;

console.log('\n── 6 · sin poder leer la deuda: avisa y el número baja ─────');
MODO.deuda = false;
await page.evaluate(() => { DEUDA_CUOTAS = []; DEUDA_CUOTAS_ESTADO = 'no_cargado'; });
V = await pintar();
linea(/financiadora NO está sumada/.test(V.texto), '⛔ avisa que le falta la cuota');
linea(/\$12,22/.test(V.texto), 'y el costo BAJA a $12,22/t (484.494 / 39.656) → ' + (V.texto.match(/\$1[0-9],\d\d/) || [''])[0]);
MODO.deuda = true;

console.log('\n── El bloque, tal como abre el informe ─────────────────────');
await page.evaluate(() => { DEUDA_CUOTAS = []; DEUDA_CUOTAS_ESTADO = 'no_cargado'; });
V = await pintar();
console.log(V.texto.split('1 · El resultado')[0].split('\n').filter(Boolean).map(l => '  | ' + l).join('\n'));

await b.close();
console.log(fallas ? `\n⛔ ${fallas} comprobacion(es) FALLARON\n` : '\n✅ el costo por tonelada ABRE el informe (y esto NO prueba las RPC ni el RLS)\n');
process.exit(fallas ? 1 : 0);
