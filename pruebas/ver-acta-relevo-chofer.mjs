#!/usr/bin/env node
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PUERTO = 8994;
const CAM = 'JAC-B001';

let pw;
try {
  const g = (await import('node:child_process')).execSync('npm root -g', { encoding: 'utf8' }).trim();
  const mod = await import(pathToFileURL(path.join(g, 'playwright', 'index.js')).href);
  pw = mod.chromium ? mod : mod.default;
  if (!pw?.chromium) throw new Error('el módulo cargó pero no trae chromium');
} catch (e) {
  console.error('⛔ Falta Playwright (global):', e.message);
  process.exit(1);
}

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.png': 'image/png',
  '.ico': 'image/x-icon'
};

const srv = http.createServer((q, s) => {
  const rel = decodeURIComponent(q.url.split('?')[0]).replace(/^\/+/, '') || 'chofer.html';
  const arch = path.join(REPO, rel);
  if (!fs.existsSync(arch) || !fs.statSync(arch).isFile()) {
    s.writeHead(404);
    s.end('no existe');
    return;
  }
  const ext = path.extname(arch);
  s.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
  s.end(fs.readFileSync(arch));
});

await new Promise(res => srv.listen(PUERTO, res));

try {
  const browser = await pw.chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 412, height: 915 } });
  const page = await context.newPage();

  // Interceptar llamadas a Supabase
  await page.route('**/rest/v1/rpc/**', async route => {
    const u = route.request().url();
    if (u.includes('chofer_ultima_medicion')) {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          altura_cm: 28.0,
          litros_calculados: 252.0,
          fecha: '2026-11-17',
          momento: 'llegada',
          registrado_por: 'CARLOS SERRANO'
        })
      });
    }
    if (u.includes('chofer_checklist_dia')) {
      return route.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
    }
    if (u.includes('chofer_unidad_km')) {
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([{ km: 22000 }]) });
    }
    if (u.includes('chofer_medicion')) {
      return route.fulfill({ status: 200, contentType: 'application/json', body: 'null' });
    }
    return route.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
  });

  await page.goto(`http://localhost:${PUERTO}/chofer.html?cam=${CAM}`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => typeof window.arrancarApp === 'function', { timeout: 20000 });
  await page.evaluate((cam) => {
    try {
      localStorage.setItem('btg_chofer_dia_' + cam, JSON.stringify({ nombre: 'CHOFER DE PRUEBA', fecha: _hoyVE() }));
    } catch (e) {}
  }, CAM);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2000);

  // Cambiar a la pestaña de Checklist usando switchTab
  await page.evaluate(() => {
    if (typeof switchTab === 'function') switchTab('checklist');
  });
  await page.waitForTimeout(500);

  // 1. Validar que el campo cl-cm-salida arranca en blanco
  const valorInicial = await page.$eval('#cl-cm-salida', el => el.value);
  console.log('1. Valor inicial de cl-cm-salida:', JSON.stringify(valorInicial));
  if (valorInicial !== '') throw new Error('El campo cl-cm-salida debe arrancar vacío');

  // 2. Validar que se muestre el aviso inicial con la última entrega de referencia
  await page.waitForSelector('#cl-relevo-aviso');
  const txtInicial = await page.$eval('#cl-relevo-aviso', el => el.innerText);
  console.log('2. Aviso inicial de relevo:', txtInicial.replace(/\n/g, ' '));
  if (!txtInicial.includes('28') || !txtInicial.includes('Última entrega')) {
    throw new Error('No se mostró la referencia de la entrega previa');
  }

  // 3. Escribir un valor conforme (28 cm)
  await page.fill('#cl-cm-salida', '28');
  await page.dispatchEvent('#cl-cm-salida', 'input');
  await page.waitForTimeout(200);
  const txtConforme = await page.$eval('#cl-relevo-aviso', el => el.innerText);
  console.log('3. Feedback con 28 cm:', txtConforme);
  if (!txtConforme.includes('Conforme')) {
    throw new Error('No se detectó la conformidad con la entrega previa');
  }

  // 4. Escribir un valor con faltante en patio (22 cm, -6 cm)
  await page.fill('#cl-cm-salida', '22');
  await page.dispatchEvent('#cl-cm-salida', 'input');
  await page.waitForTimeout(200);
  const txtDiscrepancia = await page.$eval('#cl-relevo-aviso', el => el.innerText);
  console.log('4. Feedback con 22 cm (-6 cm):', txtDiscrepancia.replace(/\n/g, ' '));
  if (!txtDiscrepancia.includes('Discrepancia') || !txtDiscrepancia.includes('-6')) {
    throw new Error('No se detectó la advertencia de discrepancia');
  }

  console.log('\n✅ PRUEBA DE NAVEGADOR EXITOSA: El Acta de Relevo Asistida opera correctamente.');
  await browser.close();
} finally {
  srv.close();
}
