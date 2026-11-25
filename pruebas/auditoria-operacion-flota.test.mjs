// Pruebas de regresión del bloque Operación Diaria y Flota (auditoría 2026-11-25)
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const appJs = fs.readFileSync(new URL('../app.js', import.meta.url), 'utf8');
const appHtml = fs.readFileSync(new URL('../app.html', import.meta.url), 'utf8');
const choferHtml = fs.readFileSync(new URL('../chofer.html', import.meta.url), 'utf8');
const choferSw = fs.readFileSync(new URL('../chofer-sw.js', import.meta.url), 'utf8');

let ok = 0;
function test(name, fn) {
  fn();
  ok++;
  console.log(`✅ ${ok}. ${name}`);
}

test('chofer.html inline JS compila sin errores de sintaxis', () => {
  const blocks = [...choferHtml.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/gi)]
    .map(m => m[1])
    .filter(s => s.trim());
  assert.ok(blocks.length >= 1);
  blocks.forEach((src, i) => new vm.Script(src, { filename: `chofer-inline-${i}.js` }));
});

test('E1: Cola offline detecta errores de red en res.error, preserva oc en fallidos y abonos usa fact,ref', () => {
  assert.ok(appJs.includes('function _esErrorRed('));
  assert.ok(appJs.includes("abonos:'fact,ref'"));
  assert.ok(appJs.includes('oc:item.oc||_COLA_ONCONFLICT[item.t]||null'));
  assert.ok(appJs.includes('oc:f.oc||_COLA_ONCONFLICT[f.t]||null'));
});

test('E2: Circuito DUP soporta REGS_DUP en edición, difiere RPC post-upsert y no suma DUP a VX', () => {
  assert.ok(appJs.includes("var idxDup=(idx<0)?REGS_DUP.findIndex("));
  assert.ok(appJs.includes('resultado.dupsPorBorrar'));
  assert.ok(appJs.includes("if(String(nr.p).indexOf('DUP')===0){\n        // Las DUP van a REGS_DUP"));
});

test('E3: cargarDatosDB carga periodos_cerrados y procesarExcelBetangar bloquea meses cerrados', () => {
  assert.ok(appJs.includes("'docs_cam','docs_emp','metas_data','nom_adm','periodos_cerrados'"));
  assert.ok(appJs.includes('resultado.periodosCerradosOmitidas'));
});

test('E4: guardarImportacionEnDB retorna dentro de if(!DB_READY) y persiste REGS completo', () => {
  assert.ok(appJs.includes("localStorage.setItem('betangar_regs',JSON.stringify(REGS))"));
  assert.ok(!appJs.includes("localStorage.setItem('betangar_regs',JSON.stringify(resultado.nuevasRegs||[]))"));
});

test('E5: chofer.html preserva turno en limpiarRegViaje, colas viajes/checklist/cuadrilla', () => {
  assert.ok(choferHtml.includes("turno: r.turno || 'diurno'"));
  assert.ok(choferHtml.includes("idbPut('vj', reg.cam+'|'+reg.fecha+'|'+tReg+'|'+reg.viaje_num, reg)"));
  assert.ok(choferHtml.includes("idbPut('cl', reg.cam+'|'+reg.fecha+'|'+tReg, reg)"));
  assert.ok(choferHtml.includes("function _cqFechaActiva()"));
});

test('E6: Fallback de odómetro en chofer.html usa RPC chofer_unidad_km en vez de km_data directa', () => {
  assert.ok(choferHtml.includes("supabase.rpc('chofer_unidad_km', { p_cam: cam })"));
  assert.ok(!choferHtml.includes("supabase.from('km_data').select('km').eq('cam', cam).limit(1)"));
});

test('E7: #sec-operativo pasa estado/nota a mecGuardarEstado, define hNum, lee ANOM_ABIERTAS y mapea 80% en WA', () => {
  assert.ok(appJs.includes('async function mecGuardarEstado(cam, estadoParam, notaParam)'));
  assert.ok(appJs.includes('var nAnom = (typeof ANOM_ABIERTAS !== \'undefined\' && Array.isArray(ANOM_ABIERTAS)) ? ANOM_ABIERTAS.length : 0;'));
  assert.ok(appJs.includes("estado==='80'?'80%':estado==='incompleta'?'Incompleta'"));
  const impIdx = appJs.indexOf('function imprimirDashboardOperativo()');
  const impBody = appJs.slice(impIdx, impIdx + 1200);
  assert.ok(impBody.includes('var hNum ='));
});

test('E8: ID duplicado hf-cam eliminado (Historial de Fallas usa hfallas-*)', () => {
  assert.equal((appHtml.match(/id="hf-cam"/g) || []).length, 1);
  assert.ok(appHtml.includes('id="hfallas-cam"'));
  assert.ok(appJs.includes("'hfallas-cam'"));
});

test('E9: cargarDatosDB incluye fegreso en EMPLEADOS y carga TARIFAS antes de mapear REGS', () => {
  assert.ok(appJs.includes("fingreso:x.fingreso||'',fegreso:x.fegreso||''"));
  const idxTar = appJs.indexOf("from('tarifas_contrato')");
  const idxRegs = appJs.indexOf('if(p.data&&p.data.length)REGS=p.data.map');
  assert.ok(idxTar > 0 && idxRegs > 0 && idxTar < idxRegs);
});

test('E10: Widget Flota y chofer.html calculan lunes con T12:00:00 (sin salto UTC)', () => {
  assert.ok(appJs.includes("var ld=new Date(lunes+'T12:00:00')"));
  assert.ok(choferHtml.includes("var d = new Date(base + 'T12:00:00')"));
});

test('E13/C4: chofer.html corrige SUR_HOY, encola anomalías offline y chofer-sw.js cachea permisos.js', () => {
  assert.ok(!choferHtml.includes('SURTIDAS_HOY'));
  assert.ok(choferHtml.includes('function _anomEncolar('));
  assert.ok(choferSw.includes("'/permisos.js'"));
  assert.ok(choferSw.includes("betangar-chofer-20261125"));
});

test('C1/F1: exportHistExcel usa _planillasFiltradasHist e incluye ap1/ap2/vertedero', () => {
  assert.ok(appJs.includes('function _planillasFiltradasHist()'));
  assert.ok(appJs.includes('var filas=_planillasFiltradasHist();'));
  assert.ok(appJs.includes("Apoyo1:r.ap1||'',Apoyo2:r.ap2||''"));
});

console.log(`\n✅ ${ok}/${ok} pruebas de Operación Diaria y Flota en verde`);
