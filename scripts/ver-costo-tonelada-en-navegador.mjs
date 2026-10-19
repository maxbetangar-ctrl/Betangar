// ═══════════════════════════════════════════════════════════════════════════════
// VER EL COSTO POR TONELADA EN UN NAVEGADOR DE VERDAD, SIN SESIÓN
//
// Qué revisa: el panel que pidió Máximo el 19/10/2026 («necesito tener mi costo por
// tonelada teniendo en cuenta que cada viaje son 8 tons · que el costo incluya el pago
// mensual a la financiadora de los camiones · todo gasto · que no quede ningún gasto por
// fuera»). Los CUATRO estados en la misma corrida, que es donde las pruebas de `node` no
// llegan: lo que la pantalla DIBUJA y de qué COLOR.
//
//   1. NORMAL — el banco contesta y la deuda se puede leer: sale el número, el desglose
//      renglón por renglón, la cuota de la financiadora y cuánto costaría SIN ella.
//   2. SIN PERMISO A LA DEUDA — el número BAJA y la pantalla tiene que DECIR que le falta
//      la cuota. Un costo más barato sin aviso es el que hace fijar mal una tarifa.
//   3. RANGO PUESTO Y BANCO CAÍDO — no puede salir ningún número: el respaldo sumaría los
//      gastos de TODA la historia sobre las toneladas de un mes.
//   4. SIN VIAJES — no puede salir «$0,00»: no hay toneladas entre las que dividir.
//
// Cómo: se abre el `app.html` DESPLEGADO y se le sirve el `app.js` LOCAL (el que se está
// revisando). Toda la red hacia Supabase está cortada y las RPC se responden armadas, así
// que no se lee ni se escribe NADA real.
//
// ⛔ QUÉ NO PRUEBA: no prueba la RPC `btg_resumen_socio` ni su candado de permisos, ni
//    `deuda_amortizacion`, ni el RLS. Prueba lo que la pantalla DIBUJA con esas respuestas.
//
// Uso: node scripts/ver-costo-tonelada-en-navegador.mjs [app.js local] [url de app.html]
// ═══════════════════════════════════════════════════════════════════════════════
import { pathToFileURL } from 'url';
import { readFileSync } from 'fs';
import path from 'path';

const JS_LOCAL = process.argv[2] || path.join(process.cwd(), 'app.js');
const URL_APP = process.argv[3] || 'https://betangar.com/app.html';
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

const jsLocal = readFileSync(JS_LOCAL, 'utf8');
const HTML_LOCAL = path.join(path.dirname(JS_LOCAL), 'app.html');
const htmlLocal = readFileSync(HTML_LOCAL, 'utf8');
if (!htmlLocal.includes('id="ct-panel"')) {
  console.error('⛔ Ese app.html NO trae el <div id="ct-panel">: el panel no existiria.');
  console.error('   Archivo: ' + HTML_LOCAL);
  process.exit(1);
}
// ⛔ Si el app.js no trae el motor nuevo, esto revisaria la version vieja y saldria verde por nada.
for (const falta of ['function calcCostoPorTonelada', 'function renderCostoTonelada', 'function _tonsPorViaje']) {
  if (!jsLocal.includes(falta)) {
    console.error('⛔ Ese app.js NO trae `' + falta + '`: se estaria revisando la version vieja.');
    console.error('   Archivo: ' + JS_LOCAL);
    process.exit(1);
  }
}

// ── LOS DATOS ARMADOS ─────────────────────────────────────────────────────────
// Salen de lo MEDIDO en la base el 19/10/2026 14:45 VE, para que el panel se vea con los
// ordenes de magnitud reales y no con numeros de juguete:
//   planillas: 5.160 viajes, US$ 1.635.100,80 facturados (04/03 → 18/10)
//   gasto del banco por bloque (23/03 → 19/10, a la tasa de cada dia)
//   AUTO UNION DC: 18 cuotas de US$ 23.417,11 desde el 01/04/2026
const RESUMEN = {
  cobrado_usd: 412307, otras_entradas_usd: 9797,
  operacion_usd: 287996, administracion_usd: 83777, obligaciones_usd: 46052, socio_usd: 66656,
  gasto_usd: 484481, cambiario_usd: 22853,
  utilidad_usd: 0, margen_pct: 0, ahorro_divisas_usd: 181474,
  movs_sin_tasa: 0, divisas_sin_valuar: 0
};
const AMORT = [];
{
  const inter = [3840.00, 3644.23, 3446.50, 3246.79, 3045.09, 2841.37, 2635.61];
  for (let i = 0; i < inter.length; i++) {
    AMORT.push({
      nro: i + 1, vencimiento: '2026-' + String(4 + i).padStart(2, '0') + '-01',
      cuota: 23417.11, interes: inter[i], capital: 23417.11 - inter[i],
      saldo: 0, abono_aplicado: 0, resta: 0, estado: 'Vencida'
    });
  }
  AMORT.push({ nro: 8, vencimiento: '2026-11-01', cuota: 23417.11, interes: 2427.80, capital: 20989.31, saldo: 0, abono_aplicado: 0, resta: 0, estado: 'Por pagar' });
}
// ⛔ LA SEGUNDA VA DENTRO DEL MES EN CURSO A PROPOSITO. Con las dos fuera, el estado «periodo
//    elegido y banco caido» se bloqueaba por NO HABER VIAJES y la asercion del banco pasaba igual
//    — la prueba habria quedado en verde por el motivo equivocado.
//    [[norma-test-que-pasa-por-el-motivo-equivocado]]
const HOY = new Date();
const ISO = (d) => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
const MES_1 = ISO(new Date(HOY.getFullYear(), HOY.getMonth(), 1));
const MES_N = ISO(new Date(HOY.getFullYear(), HOY.getMonth() + 1, 0));
const EN_EL_MES = ISO(new Date(HOY.getFullYear(), HOY.getMonth(), Math.min(HOY.getDate(), 15)));
const PLANILLAS = [
  { f: '2026-03-10', cam: 'JAC-B003', t: 203, m: 203 * 317.88, mes: 'mar-26' },  // ANTES del banco
  { f: '2026-04-15', cam: 'JAC-B001', t: 2580, m: 2580 * 317.88, mes: 'abr-26' },
  { f: EN_EL_MES, cam: 'JAC-B002', t: 2580, m: 2580 * 317.88, mes: 'oct-26' }
];

// El estado que se está revisando lo deciden estas dos banderas, que leen las rutas.
let MODO = { banco: true, deuda: true };

const b = await chromium.launch();
const ctx = await b.newContext();            // contexto NUEVO: el navegador ya usado es otro producto
const page = await ctx.newPage();

// ⛔ EL app.html TAMBIEN TIENE QUE SER EL LOCAL. La primera corrida fallo por esto: se servia
//    el app.js nuevo dentro del app.html DESPLEGADO, que todavia no tiene el <div id="ct-panel">,
//    asi que `renderCostoTonelada()` salia por su propia puerta de «no hay panel» y la prueba
//    reventaba. El panel es HTML nuevo: hay que servir las dos mitades nuevas.
await page.route('**/app.html*', r => r.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: htmlLocal }));
await page.route('**/app.js*', r => r.fulfill({ status: 200, contentType: 'application/javascript; charset=utf-8', body: jsLocal }));

const js = (o) => ({ status: 200, contentType: 'application/json', body: JSON.stringify(o) });
// ⛔ EL ORDEN IMPORTA Y AL REVES DE LO QUE PARECE: Playwright prueba las rutas de la ULTIMA
//    registrada a la primera, asi que el comodin va PRIMERO y las especificas despues. Al
//    registrarlo al final se comia todas las RPC y devolvia `[]`: el panel caia al calculo de
//    respaldo y marcaba $1,92/t — un numero creible, sacado de la nada. Lo mismo le pasaria a
//    cualquiera que lea esta prueba en verde sin mirar los numeros.
await page.route('**/*.supabase.co/**', r => r.fulfill(js([])));          // todo lo demas, cortado
// Lo que la pantalla le PIDE al banco se guarda: es la unica forma de probar que el periodo
// elegido llega de verdad a la consulta y no se queda en el rotulo.
const pedidos = [];
await page.route('**/rpc/btg_resumen_socio*', r => (
  (() => { try { pedidos.push(JSON.parse(r.request().postData() || '{}')); } catch (e) { pedidos.push({ ilegible: true }); } })(),
  MODO.banco
  ? r.fulfill(js([RESUMEN]))
  : r.fulfill({ status: 403, contentType: 'application/json', body: JSON.stringify({ message: 'El modulo financiero no esta disponible para este usuario' }) })));
await page.route('**/rpc/deuda_puede_ver*', r => r.fulfill(js(MODO.deuda)));
await page.route('**/rpc/deuda_amortizacion*', r => r.fulfill(js(AMORT)));
await page.route('**/deuda_financiamientos*', r => r.fulfill(js([{ id: 1, acreedor: 'AUTO UNION DC', estado: 'vigente' }])));
// ⛔ LA PRIMERA FECHA QUE EL BANCO TIENE, que NO es la que se le pide. En Betangar
//    `bnc_movimientos` arranca el 23/03/2026 y las planillas el 04/03: hay toneladas sin gasto
//    detras y el costo sale mas barato de lo real.
await page.route('**/bnc_movimientos*', r => r.fulfill(js([{ fecha: '2026-03-23' }])));

page.on('dialog', async d => { await d.dismiss(); });

await page.goto(URL_APP, { waitUntil: 'domcontentloaded', timeout: 120000 });
await page.waitForFunction('typeof renderCostoTonelada==="function" && typeof calcCostoPorTonelada==="function"', null, { timeout: 120000 });

// La pantalla esta dibujada pero ESCONDIDA detras del login. Se le abre la seccion (no se
// saltea nada del codigo del panel: `renderCostoTonelada()` corre igual) y se siembran los
// datos que en produccion traen las planillas.
await page.evaluate(() => {
  document.querySelectorAll('#login-screen,#login,.login-wrap,#overlay').forEach(e => { e.style.display = 'none'; });
  for (let n = document.getElementById('ct-panel'); n && n !== document.body; n = n.parentElement) {
    n.style.display = ''; n.classList.add('activa', 'active'); n.removeAttribute('hidden');
  }
  const t = document.getElementById('tab-fin-dash'); if (t) t.style.display = 'block';
});

let fallas = 0;
const linea = (ok, txt) => { if (!ok) fallas++; console.log(`  ${ok ? 'OK   ' : 'FALLA'} ${txt}`); };

// ⛔ SE CONDUCE EL SELECTOR, QUE ES EL CAMINO REAL. Antes este panel tenia su propio
//    Desde/Hasta; al conectar el selector de periodo se unifico, porque dos controles de periodo
//    en una pantalla muestran dos meses distintos uno debajo del otro.
//    `modo` es 'todo' | 'mes' | 'semana' y `sem` el numero de semana cuando aplica.
async function pintar(modo, sem, tons) {
  await page.evaluate(([m, w, t]) => {
    window.DEMO_MODE = false;
    window.REGS = window.__PLAN;
    window.cfg = window.cfg || {}; window.cfg.tonsViaje = t;
    const sp = document.getElementById('fin-periodo'); if (sp) sp.value = m;
    if (typeof _finPrepararSelectores === 'function') _finPrepararSelectores();
    const ss = document.getElementById('fin-sem-sel');
    if (ss && w) ss.value = 'Semana ' + w;
  }, [modo || 'todo', sem || '', tons || 8]);
  await page.evaluate(() => renderCostoTonelada());
  await page.waitForFunction('!/Calculando/.test(document.getElementById("ct-panel").innerText)', null, { timeout: 30000 });
  return page.evaluate(() => {
    const el = document.getElementById('ct-panel');
    const grande = el.querySelector('div[style*="font-size:30px"]');
    return {
      texto: el.innerText,
      html: el.innerHTML,
      numero: grande ? grande.innerText.trim() : null,
      colorNumero: grande ? getComputedStyle(grande).color : null,
      borde: el.firstElementChild ? getComputedStyle(el.firstElementChild).borderLeftColor : null
    };
  });
}

await page.evaluate((p) => { window.__PLAN = p; }, PLANILLAS);
// El cliente de Supabase nace en el login, que aca no ocurre: se crea a mano con la MISMA
// funcion de la app, y sus consultas salen a `*.supabase.co`, donde las rutas las interceptan.
// La libreria UMD la carga app.html con un <script> dinamico: hay que esperarla.
await page.waitForFunction('!!(window.supabase&&window.supabase.createClient)||typeof window.createClient==="function"', null, { timeout: 60000 });
await page.evaluate(() => { initSupabaseClient(); window.DEMO_MODE = false; });
const diag = await page.evaluate(() => ({ dbReady: typeof DB_READY!=='undefined'&&DB_READY, cliente: !!window.__btgCreate, url: typeof SUPA_URL!=='undefined'?SUPA_URL:null }));
if (!diag.dbReady) { console.error('⛔ No se pudo crear el cliente de Supabase: ' + JSON.stringify(diag)); await b.close(); process.exit(1); }
await page.evaluate(() => cargarCuotasFinanciamiento());
await page.waitForFunction('DEUDA_CUOTAS_ESTADO!=="no_cargado"', null, { timeout: 30000 });
console.log('\nCuadro de amortizacion leido: estado=' + await page.evaluate(() => DEUDA_CUOTAS_ESTADO) +
            ' cuotas=' + await page.evaluate(() => DEUDA_CUOTAS.length));

// ── 1 · NORMAL ────────────────────────────────────────────────────────────────
console.log('\n── 1 · NORMAL: banco OK + deuda OK ──────────────────────────────────');
let v = await pintar('todo');
// 5.160 viajes × 8 t = 41.280 t. Gasto 484.481 + cambiario 22.853 + 7 cuotas 163.919,77
// = 671.253,77 ⇒ 16,26 $/t. Sin la financiadora: 507.334/41.280 = 12,29 $/t.
// 5.363 viajes × 8 = 42.904 t ⇒ 671.253,77/42.904 = 15,65 $/t
linea(/\$15,65/.test(v.numero || ''), 'el numero grande dice $15,65/t → ' + v.numero);
linea(/42\.904 toneladas/.test(v.texto), 'dice las toneladas: 42.904 = 5.363 viajes × 8 t');
linea(/AUTO UNION DC/.test(v.texto), 'nombra a la financiadora');
linea(/7 cuotas de \$23\.417,11 que vencieron en el per/.test(v.texto), 'dice cuantas cuotas vencieron y de cuanto');
// ⛔ Maximo lo declaro el 19/10/2026: entra la cuota COMPLETA, capital + interes. Que lo diga la
//    pantalla y no solo un comentario del codigo: es la diferencia entre un criterio y una regla.
linea(/entra la CUOTA COMPLETA/.test(v.texto), 'y que entra la CUOTA COMPLETA, no solo el interes');
linea(/capital \$141\.220 \+ interés \$22\.700/.test(v.texto), 'con el desglose, para quien quiera leer solo el interes');
// ⛔ Y los tres tienen que CERRAR: 11,83 + 3,82 = 15,65, el total que dice el cuadro.
linea(/Sin la financiadora el costo ser/.test(v.texto) && /\$11,83/.test(v.texto), 'dice cuanto seria SIN la financiadora ($11,83/t)');
linea(/24% del costo/.test(v.texto), 'y que peso tiene la financiadora en el costo (24%)');
linea(/le ponen \$3,82\/t/.test(v.texto), 'y los tres numeros CIERRAN: 11,83 + 3,82 = 15,65');
linea(/Operaci[oó]n/.test(v.texto) && /Administraci[oó]n/.test(v.texto) && /Obligaciones/.test(v.texto) && /socio/i.test(v.texto) && /cambiaria/i.test(v.texto),
  'el desglose trae los cinco bloques del gasto del banco');
linea(/estado de cuenta del banco/.test(v.texto), 'declara que el gasto sale del banco');
linea(/39,74/.test(v.texto), 'dice lo que cobra por tonelada ($39,74 = 317,88 / 8)');
// ⛔ LOS TRES NUMEROS DE LA LINEA TIENEN QUE CERRAR: 39,74 − 16,26 = 23,48. A precision
//    completa daba 23,47 (la tarifa por tonelada es 317,88/8 = 39,735 exactos) y cualquiera que
//    restara a mano los dos numeros que VE pensaria que el cuadro esta mal.
linea(/24,09/.test(v.texto), 'y lo que le queda: 39,74 − 15,65 = $24,09/t, con los numeros que se VEN');
linea(!/financiadora NO está sumada/.test(v.texto), 'NO avisa de la financiadora: esta sumada');
// ⛔ TONELADAS SIN GASTO DETRAS: el banco arranca el 23/03 y hay 203 viajes antes. El costo sale
//    mas barato de lo real, y eso no se puede callar ni dejar en un comentario del codigo.
linea(/banco solo tiene movimientos desde el 23\/03\/2026/.test(v.texto), 'avisa que el banco arranca despues que las planillas');
linea(/203 viaje\(s\) anteriores \(1\.624 t\)/.test(v.texto), 'con el numero exacto de viajes y toneladas sin respaldo');
linea(/41\.280 t con respaldo dar[ií]a \$16,26/.test(v.texto), 'y cuanto daria contando solo las toneladas con respaldo ($16,26/t)');
linea(/rgb\(/.test(v.colorNumero || '') && !/128, 128, 128/.test(v.colorNumero || ''), 'el numero esta en color de margen positivo → ' + v.colorNumero);

// ── 2 · SIN PERMISO A LA DEUDA ────────────────────────────────────────────────
console.log('\n── 2 · SIN PERMISO A LA DEUDA: el numero baja y TIENE que decirlo ───');
MODO.deuda = false;
await page.evaluate(() => cargarCuotasFinanciamiento());
await page.waitForFunction('DEUDA_CUOTAS_ESTADO==="sin_permiso"', null, { timeout: 30000 });
v = await pintar('todo');
// Aca el titular es el COCIENTE real sin cuota (507.334/42.904 = 11,82). En el estado 1 el
// «sin la financiadora» vale 11,83 porque sale del total MENOS la cuota redondeada, para que
// el cuadro sume. Un centavo de diferencia, y cada uno correcto en su contexto.
linea(/\$11,82/.test(v.numero || ''), 'el numero BAJA a $11,82/t (sin la cuota) → ' + v.numero);
linea(/financiadora NO está sumada/.test(v.texto), '⛔ y el aviso lo dice en la pantalla');
linea(/permiso/.test(v.texto), '…nombrando la causa (permiso), no un «no se pudo» mudo');
MODO.deuda = true;
await page.evaluate(() => cargarCuotasFinanciamiento());
await page.waitForFunction('DEUDA_CUOTAS_ESTADO==="ok"', null, { timeout: 30000 });

// ── 3 · RANGO PUESTO Y BANCO CAIDO ───────────────────────────────────────────
console.log('\n── 3 · PERIODO ELEGIDO Y BANCO CAIDO: no puede salir ningun numero ──');
MODO.banco = false;
v = await pintar('mes');
linea(v.numero === null, 'no dibuja numero grande');
linea(/no se puede calcular/.test(v.texto), 'dice «no se puede calcular»');
linea(/banco/i.test(v.texto) && /rango/i.test(v.texto), 'y por que: el banco y el rango');
linea(!/\$1[0-9],/.test(v.texto), 'no se cuela ninguna cifra por tonelada');
// ⛔ Y que se bloquee por EL BANCO, no por falta de viajes: hay 2.580 viajes en el mes.
linea(!/no hay viajes/i.test(v.texto), 'y se bloquea por el BANCO, no por falta de viajes');
linea(/128, 128, 128|107, 114, 128|156, 163, 175|115, 115, 115/.test(v.borde || '') || !/34, 197, 94/.test(v.borde || ''),
  'el recuadro NO va en verde → borde ' + v.borde);

// ── 3b · SIN RANGO Y BANCO CAIDO: da numero, pero DECLARADO ──────────────────
console.log('\n── 3b · «Todo» y banco caido: da numero y declara que es incompleto ─');
v = await pintar('todo');
linea(v.numero !== null, 'si dibuja numero (un numero incompleto avisado vale mas que ninguno)');
linea(/no viene del banco/i.test(v.texto), 'avisa que el gasto no viene del banco');
linea(/61%/.test(v.texto), 'y cuanto faltaba la ultima vez que se midio (61%)');
linea(/a mano/i.test(v.texto), 'la fuente del encabezado tambien lo dice');
MODO.banco = true;

// ── 4 · SIN VIAJES ───────────────────────────────────────────────────────────
console.log('\n── 4 · SIN VIAJES: no puede salir «$0,00» ───────────────────────────');
await page.evaluate(() => { window.__PLAN = []; });
v = await pintar('todo');
linea(v.numero === null, 'no dibuja numero grande');
linea(/no hay viajes|toneladas/i.test(v.texto), 'dice que no hay toneladas entre las que dividir');
linea(!/\$0,00/.test(v.texto), 'y NO muestra $0,00 en verde');
await page.evaluate((p) => { window.__PLAN = p; }, PLANILLAS);

// ── 5 · LAS TONELADAS POR VIAJE SE DECLARAN ──────────────────────────────────
console.log('\n── 5 · cambiar las toneladas por viaje cambia el numero ─────────────');
const v10 = await pintar('todo', '', 10);
linea(/53\.630 toneladas/.test(v10.texto), 'con 10 t/viaje las toneladas son 53.630');
linea(/\$12,52/.test(v10.numero || ''), 'y el costo baja a $12,52/t → ' + v10.numero);

// ── 6 · EL CAMPO DE CONFIG EXISTE Y SE PRELLENA ──────────────────────────────
console.log('\n── 6 · Config ▸ General: el campo y el prellenado ───────────────────');
const cf = await page.evaluate(() => {
  window.cfg.tonsViaje = 9.5;
  if (typeof cargarConfigForm === 'function') cargarConfigForm();
  const el = document.getElementById('cfg-tons-viaje');
  const tar = document.getElementById('cfg-tarifa');
  return { existe: !!el, valor: el ? el.value : null, tarifa: tar ? tar.value : null, etiqueta: el && el.parentElement ? el.parentElement.innerText : '' };
});
linea(cf.existe, 'el campo «Toneladas por viaje» existe');
linea(String(cf.valor) === '9.5', 'cargarConfigForm lo prellena con lo guardado (9,5) → ' + cf.valor);
linea(/costo por tonelada/i.test(cf.etiqueta), 'y la ayuda dice para que sirve');
// ⛔ El prellenado existe porque guardar REVERTIA lo guardado: los `value=` del HTML son fijos.
linea(String(cf.tarifa) === '317.88', 'y arrastra tambien la tarifa guardada → ' + cf.tarifa);

// ── 7 · RENTABILIDAD: la columna $/ton y que CUADRE con su encabezado ────────
// ⛔ Una columna que no cuadra con su <th> corre toda la tabla y cada numero queda bajo el
//    titulo del de al lado. Eso no lo ve ninguna prueba de `node`: se cuenta en la pantalla.
console.log('\n── 7 · Rentabilidad: la columna $/ton directo ──────────────────');
const rent = await page.evaluate(() => {
  window.REGS = [
    { f: '2026-09-10', cam: 'JAC-B001', t: 10, m: 10 * 317.88, ch: 'A', ay1: 'B' },
    { f: '2026-09-11', cam: 'JAC-B002', t: 5, m: 5 * 317.88, ch: 'C', ay1: 'D' }
  ];
  window.GASOIL = [{ f: '2026-09-10', cam: 'JAC-B001', m: 400, lit: 500, src: 'tumaca' }];
  window.SURT_RENT = [];
  window.cfg.tonsViaje = 8; window.cfg.chofer = 10; window.cfg.ayud = 5;
  const el = document.getElementById('p-rentabilidad');
  if (el) { el.style.display = 'block'; el.classList.add('active'); }
  renderRentabilidad();
  const ths = [...document.querySelectorAll('#rent-tabla')].length
    ? [...document.getElementById('rent-tabla').closest('table').querySelectorAll('thead th')].map(t => t.innerText.trim())
    : [];
  const filas = [...document.querySelectorAll('#rent-tabla tr')].map(tr => [...tr.children].map(td => td.innerText.trim()));
  const kpis = document.getElementById('rent-kpis');
  return { ths, filas, kpi: kpis ? kpis.innerText : '' };
});
linea(/^\$\/ton directo$/i.test(rent.ths[rent.ths.length - 1] || ''), 'el encabezado nuevo es el ultimo: «$/ton directo» → ' + rent.ths[rent.ths.length - 1]);
linea(rent.filas.length > 0 && rent.filas.every(f => f.length === rent.ths.length),
  'cada fila trae tantas celdas como encabezados (' + rent.ths.length + ') → ' + rent.filas.map(f => f.length).join(','));
// JAC-B001: 10 viajes × 8 t = 80 t. Combustible 400 + nomina (10×10 + 10×5) = 550 ⇒ 6,88 $/t
linea((rent.filas[0] || []).slice(-1)[0] === '$6.88', 'JAC-B001 da $6.88/t (550 / 80 t) → ' + (rent.filas[0] || []).slice(-1)[0]);
// JAC-B002: sin combustible, nomina 5×10 + 5×5 = 75, 40 t ⇒ 1,88 $/t
linea((rent.filas[1] || []).slice(-1)[0] === '$1.88', 'JAC-B002 da $1.88/t (75 / 40 t) → ' + (rent.filas[1] || []).slice(-1)[0]);
linea(/Costo DIRECTO por tonelada/i.test(rent.kpi), 'el KPI dice DIRECTO, para no confundirlo con el de Financiero');
linea(/120 t = 15 × 8 t/.test(rent.kpi), 'y declara las toneladas y de donde salen → ' + (rent.kpi.match(/\d+ t = .*?t/) || [''])[0]);
linea(/solo comb\.\+nómina/.test(rent.kpi), 'y que solo cuenta combustible y nomina');

// ── 8 · EL PERIODO ELEGIDO LLEGA DE VERDAD A LA CONSULTA ─────────────────────
// ⛔ Lo unico que prueba que el selector esta CONECTADO es lo que sale hacia la base. Un
//    rotulo que dice «octubre» sobre una consulta sin fechas es exactamente el defecto que se
//    vino a arreglar. [[norma-probar-el-camino-no-la-pieza]]
console.log('\n── 8 · el periodo elegido llega a la consulta del banco ─────────');
pedidos.length = 0;
await pintar('mes');
const pMes = pedidos[pedidos.length - 1] || {};
linea(pMes.p_desde === MES_1 && pMes.p_hasta === MES_N,
  'con «Este Mes» le pide al banco ' + MES_1 + ' → ' + MES_N + ' → ' + JSON.stringify(pMes));
pedidos.length = 0;
await pintar('semana', 2);
const pSem = pedidos[pedidos.length - 1] || {};
const dSem = new Date(pSem.p_desde + 'T12:00:00'), hSem = new Date(pSem.p_hasta + 'T12:00:00');
linea(dSem.getDay() === 1 && hSem.getDay() === 0 && Math.round((hSem - dSem) / 86400000) === 6,
  'con una semana le pide LUNES a DOMINGO, 7 dias → ' + pSem.p_desde + ' → ' + pSem.p_hasta);
pedidos.length = 0;
await pintar('todo');
const pTodo = pedidos[pedidos.length - 1] || {};
linea(pTodo.p_desde === '2026-01-01', 'con «Todo» no manda un rango inventado → ' + JSON.stringify(pTodo));

// ── 9 · EL RESUMEN FINANCIERO, con sus tres periodos ─────────────────────────
// ⛔ Lo que hay que ver es que una fila FUERA del periodo deje de contar. Sin control negativo,
//    «el numero cambio» no prueba que cambio por la razon correcta.
console.log('\n── 9 · el resumen financiero sigue el periodo ───────────────');
await page.evaluate(([enMes]) => {
  // Cada tabla con UNA fila dentro del mes y UNA fuera: si el filtro no corre, los totales son
  // el doble y se nota.
  window.ABONOS = [
    { f: enMes, m: 20000, fact: '0700' },
    { f: '2026-04-10', m: 10000, fact: '0600' }
  ];
  window.GASOIL = [
    { f: enMes, cam: 'COMPRA GRANEL', m: 4000, lit: 5000, src: 'tumaca' },
    { f: '2026-04-10', cam: 'COMPRA GRANEL', m: 7000, lit: 9000, src: 'tumaca' }
  ];
  window.SURT_RENT = [];
  window.GASTOS_FIJOS = [{ id: 'GF1', nombre: 'Alquiler', monto: 1600 }, { id: 'GF2', nombre: 'Contador', monto: 200 }];
  window.GASTOS_VARIABLES = [];
  window.CXP = [
    { id: 'C1', fecha: enMes, prov_nombre: 'REPUESTOS X', descripcion: 'frenos', total_usd: 3000, estado: 'pendiente' },
    { id: 'C2', fecha: '2026-04-02', prov_nombre: 'REPUESTOS X', descripcion: 'cauchos', total_usd: 5000, estado: 'pagada' }
  ];
  window.NOMINA_HIST = [
    { id: 'SEM-A', fecha_desde: enMes, fecha_hasta: enMes, total_usd: 4600 },
    { id: 'SEM-B', fecha_desde: '2026-04-06', fecha_hasta: '2026-04-12', total_usd: 3900 }
  ];
  const fd = document.getElementById('tab-fin-dash'); if (fd) fd.style.display = 'block';
  for (let n = document.getElementById('fin-dash-content'); n && n !== document.body; n = n.parentElement) {
    n.style.display = ''; n.classList.add('activa', 'active'); n.removeAttribute('hidden');
  }
}, [EN_EL_MES]);

async function finDash(modo, sem) {
  await page.evaluate(([m, w]) => {
    const sp = document.getElementById('fin-periodo'); if (sp) sp.value = m;
    if (typeof _finPrepararSelectores === 'function') _finPrepararSelectores();
    const ss = document.getElementById('fin-sem-sel'); if (ss && w) ss.value = 'Semana ' + w;
  }, [modo, sem || '']);
  await page.evaluate(() => renderFinDash());
  await page.waitForFunction('/Per[ií]odo:/.test(document.getElementById("fin-dash-content").innerText)', null, { timeout: 30000 });
  return page.evaluate(() => {
    const el = document.getElementById('fin-dash-content');
    const tarj = {};
    el.querySelectorAll('.stat').forEach(d => {
      const l = d.querySelector('.stat-lbl'), v = d.querySelector('.stat-val'), s2 = d.querySelector('.stat-sub');
      if (l && v) tarj[l.innerText.trim().toUpperCase()] = { val: v.innerText.trim(), sub: s2 ? s2.innerText.trim() : '' };
    });
    return { texto: el.innerText, tarj: tarj, semVisible: (document.getElementById('fin-sem-sel') || {}).style ? document.getElementById('fin-sem-sel').style.display : null };
  });
}

let F = await finDash('todo');
// 5.160 viajes × 317,88 = 1.640.260,80 facturado; abonos 30.000; CxP 8.000; nomina 8.500
linea(/toda la historia cargada/.test(F.texto), '«Todo» lo dice en el encabezado');
linea(F.tarj['FACTURADO'].val === '$1.704.790', 'facturado de TODO → ' + F.tarj['FACTURADO'].val);
linea(F.tarj['NOMINA'].val === '$8.500', 'nomina de TODO (las 2 semanas) → ' + F.tarj['NOMINA'].val);
linea(F.tarj['CXP (TODAS)'].val === '$8.000', 'CxP de TODO (las 2) → ' + F.tarj['CXP (TODAS)'].val);
linea(F.tarj['GASOIL'].val === '$11.000', 'gasoil de TODO (las 2 compras) → ' + F.tarj['GASOIL'].val);
linea(F.semVisible === 'none', 'el desplegable de semana esta ESCONDIDO cuando no aplica');

F = await finDash('mes');
linea(/el mes en curso/.test(F.texto), '«Este Mes» lo dice con las dos fechas');
// ⛔ CONTROL NEGATIVO: la mitad de cada tabla esta fuera del mes y TIENE que dejar de contar.
linea(F.tarj['FACTURADO'].val === '$820.130', 'facturado SOLO del mes (la planilla de abril ya no cuenta) → ' + F.tarj['FACTURADO'].val);
linea(F.tarj['COBRADO'].val === '$20.000', 'cobrado solo del mes → ' + F.tarj['COBRADO'].val);
linea(F.tarj['NOMINA'].val === '$4.600', 'nomina solo de la semana del mes → ' + F.tarj['NOMINA'].val);
linea(F.tarj['CXP (TODAS)'].val === '$3.000', 'CxP solo del mes → ' + F.tarj['CXP (TODAS)'].val);
linea(F.tarj['GASOIL'].val === '$4.000', 'gasoil solo del mes → ' + F.tarj['GASOIL'].val);
// ⛔ Y lo que NO es del periodo, dicho: un saldo y un monto mensual no se vuelven del mes.
linea(/saldo TOTAL a hoy/.test(F.tarj['POR COBRAR'].sub), '«Por Cobrar» se declara saldo TOTAL, no del mes');
linea(F.tarj['POR COBRAR'].val === '$1.674.790', 'y vale el saldo entero → ' + F.tarj['POR COBRAR'].val);
linea(/MENSUAL/.test(F.tarj['GASTOS FIJOS'].sub), '«Gastos Fijos» se declara monto MENSUAL');
linea(/no es del per/i.test(F.texto) && /MENSUAL/.test(F.texto), 'y el pie lista lo que no es del periodo');

F = await finDash('semana', 2);
linea(/Semana 2 de /.test(F.texto), 'una semana lo dice con su numero y su rango');
linea(F.semVisible !== 'none', 'y ahi SI se ve el desplegable de semana');

// ⛔ Con el banco caido y un periodo elegido NO puede salir una Utilidad Neta: `_totalEgresos`
//    ignora las fechas y devolveria el gasto de toda la historia bajo el rotulo del mes.
MODO.banco = false;
F = await finDash('mes');
linea(F.tarj['UTILIDAD NETA'].val === 'no se puede', 'banco caido + mes: la Utilidad Neta NO se inventa → ' + F.tarj['UTILIDAD NETA'].val);
linea(/TODA la historia con el r[oó]tulo/.test(F.texto), 'y dice exactamente por que');
linea(!/Distribucion de Ingresos/.test(F.texto), 'ni se dibuja la rueda de reparto sin el total');
MODO.banco = true;
F = await finDash('todo');
linea(/\$/.test(F.tarj['UTILIDAD NETA'].val), 'con el banco de vuelta, la Utilidad Neta vuelve → ' + F.tarj['UTILIDAD NETA'].val);

// El panel dibujado se VUELCA SIEMPRE, falle o no. Un cuadro de plata se lee; no se da por bueno
// desde una lista de OK — las aserciones miran lo que alguien penso en mirar.
{
  console.log('\n── El panel, tal como quedo dibujado (estado NORMAL) ────────────────');
  const txt = await pintar('todo');
  console.log(txt.texto.split('\n').map(l => '  | ' + l).join('\n'));
}
await b.close();
console.log(fallas
  ? `\n⛔ ${fallas} comprobacion(es) FALLARON\n`
  : '\n✅ todo verde en un navegador real (y esto NO prueba las RPC, ni sus permisos, ni el RLS)\n');
process.exit(fallas ? 1 : 0);
