// Regresión de la auditoría del Bloque 6/6: Seguridad, Alertas e Infra
// Verifica cierre de autenticación en bnc-saldo, tokens compuestos en abonos/cxp_facturas,
// refresco JWT en tokens, config.toml y hardening de alertas/worker.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const APP = fs.readFileSync(new URL('../app.js', import.meta.url), 'utf8');
const BNC_SALDO = fs.readFileSync(new URL('../supabase/functions/bnc-saldo/index.ts', import.meta.url), 'utf8');
const CONFIG_TOML = fs.readFileSync(new URL('../supabase/config.toml', import.meta.url), 'utf8');
const ALERTAS = fs.readFileSync(new URL('../supabase/functions/alertas-diarias/index.ts', import.meta.url), 'utf8');
const WORKER = fs.readFileSync(new URL('../supabase/functions/procesar_cola_wassenger/index.ts', import.meta.url), 'utf8');

function extractFn(src, name) {
  const re = new RegExp(`(?:async\\s+)?function\\s+${name}\\s*\\(`);
  const m = re.exec(src);
  assert.ok(m, `No se encontró la función ${name}`);
  let i = m.index;
  let brace = src.indexOf('{', i);
  let depth = 0;
  for (let j = brace; j < src.length; j++) {
    const ch = src[j];
    if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) return src.slice(i, j + 1);
    }
  }
  throw new Error(`No se cerró el bloque de ${name}`);
}

test('E1: bnc-saldo exige JWT autenticado o SERVICE_ROLE_KEY para acciones distintas de tasas y app.js usa _bncSaldoHdr', () => {
  assert.ok(BNC_SALDO.includes("if (action !== 'tasas')"), 'bnc-saldo debe validar auth en acciones distintas de tasas');
  assert.ok(BNC_SALDO.includes('supabase.auth.getUser(token)'), 'bnc-saldo debe validar JWT de usuario con getUser');
  const hdrFn = extractFn(APP, '_bncSaldoHdr');
  assert.ok(hdrFn.includes('_ensureJWT') && hdrFn.includes('_tokRestHdr'));
  const probarFn = extractFn(APP, 'bncProbarSaldo');
  const consFn = extractFn(APP, 'consultarSaldoBNC');
  const testFn = extractFn(APP, 'testBNC');
  const dashFn = extractFn(APP, 'renderBncDashResumen');
  assert.ok(probarFn.includes('_bncSaldoHdr()'));
  assert.ok(consFn.includes('_bncSaldoHdr()'));
  assert.ok(testFn.includes('_bncSaldoHdr()'));
  assert.ok(dashFn.includes('_bncSaldoHdr()'));
});

test('E2/E3: aprobarTokenPend respeta clave compuesta ref en abonos, valida return=representation y refresca tablas; rechazar/generar refrescan JWT', () => {
  const aprFn = extractFn(APP, 'aprobarTokenPend');
  const recFn = extractFn(APP, 'recargarTrasTokenAccion');
  const rechFn = extractFn(APP, 'rechazarTokenPend');
  const genFn = extractFn(APP, 'generarTokenAprobacion');

  assert.ok(aprFn.includes("ad.tabla==='abonos'&&ad.ref!==undefined"), 'aprobarTokenPend debe respetar ref en abonos');
  assert.ok(aprFn.includes('return=representation'), 'aprobarTokenPend debe verificar filas afectadas');
  assert.ok(recFn.includes("ad.tabla==='cxp_facturas'"), 'recargarTrasTokenAccion debe refrescar cxp_facturas');
  assert.ok(recFn.includes("ad.tabla==='nomina_extras'"), 'recargarTrasTokenAccion debe refrescar nomina_extras');
  assert.ok(rechFn.includes('_ensureJWT'), 'rechazarTokenPend debe refrescar JWT');
  assert.ok(genFn.includes('_ensureJWT'), 'generarTokenAprobacion debe refrescar JWT');
});

test('E4/C1/F1: config.toml declara divisas-banco; alertas-diarias y worker loguean errores de escritura', () => {
  assert.ok(CONFIG_TOML.includes('[functions.divisas-banco]'), 'config.toml debe declarar divisas-banco');
  assert.ok(ALERTAS.includes('alertas_log insert err'), 'alertas-diarias debe verificar rLog.ok');
  assert.ok(WORKER.includes('errResc'), 'procesar_cola_wassenger debe verificar error en rescate');
});
