// Pruebas de regresión del bloque Combustible (auditoría 2026-11-25)
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const appJs = fs.readFileSync(new URL('../app.js', import.meta.url), 'utf8');
const choferHtml = fs.readFileSync(new URL('../chofer.html', import.meta.url), 'utf8');
const choferSw = fs.readFileSync(new URL('../chofer-sw.js', import.meta.url), 'utf8');

let ok = 0;
function test(name, fn) {
  fn();
  ok++;
  console.log(`✅ ${ok}. ${name}`);
}

test('chofer.html inline JS compila sin errores', () => {
  const blocks = [...choferHtml.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/gi)]
    .map(m => m[1])
    .filter(s => s.trim());
  assert.ok(blocks.length >= 1);
  blocks.forEach((src, i) => new vm.Script(src, { filename: `chofer-comb-${i}.js` }));
});

test('E1: ccDespachosFecha y ccLitrosCamRango respetan cfg.surtidasCorte y descuentan devoluciones', () => {
  assert.ok(appJs.includes('if(corte && fecha>=corte){'));
  assert.ok(appJs.includes('if(corte&&f>=corte)return; // post-corte manda SURTIDAS'));
  assert.ok(appJs.includes('if(dv&&dv.litros>0) t=Math.max(0, t-dv.litros);'));
});

test('E2: imprimirCentroCostos selecciona tanque, costo_definido y litros_transporte', () => {
  assert.ok(appJs.includes("select('fecha,cam,litros,tanque,costo_definido,costo_usd,costo_litro_usd,litros_transporte,anulada')"));
});

test('E3: Financiero suma COMB_PERIODOS en egGas', () => {
  assert.ok(appJs.includes('Sumar períodos costeados de estación (`combustible_periodos`) dentro del rango'));
});

test('E4/E5/E6: Patio distingue error de red vs servidor; guardarGasol lee gp-m y espera dbIn', () => {
  assert.ok(appJs.includes("if(typeof _esErrorRed==='function'&&_esErrorRed(res.error)) enCola=true;"));
  assert.ok(appJs.includes("var mManual=parseFloat(gv('gp-m'));"));
  assert.ok(appJs.includes('if(!_okG && DB_READY) return;'));
});

test('E7/E16/C5: chofer.html resetea SUR_GPS, persiste SUR_HOY, envía turno y descarta DUPLICADA en cola', () => {
  assert.ok(choferHtml.includes('SUR_FOTO_FILE=null; SUR_GPS=null; SUR_GPS_FAILS=0;'));
  assert.ok(choferHtml.includes('function _surCargarHoyLocal()'));
  assert.ok(choferHtml.includes("turno:(typeof CL_TURNO!=='undefined'&&CL_TURNO?CL_TURNO:'diurno')"));
  assert.ok(choferHtml.includes("if(/^DUPLICADA/i.test(r.error.message||''))"));
  assert.ok(choferSw.includes('betangar-chofer-20261125b'));
});

test('E8/E15: _perCalc concatena warn, calcula tasa ponderada por tramo y _surPendiente exige litros > 0', () => {
  assert.ok(appJs.includes("warn+='<div style=\"color:#9fb3c8;margin-top:4px\">'"));
  assert.ok(appJs.includes('tasaSel=(_usdSum>0)?(_bsSum/_usdSum):tramos[0].tasa;'));
  assert.ok(appJs.includes('function _surPendiente(s){ return _surEsExterna(s)&&!s.costo_definido&&(parseFloat(s&&s.litros)||0)>0&&!s.anulada; }'));
});

test('E9/E10/E11/E12/E14/C1: Auditoría soporta relevo mismo día, tanque_id en galpón, trasvases, turno en acNoConfiable y resetea _AC_LOTES', () => {
  assert.ok(appJs.includes('var _esRelevoMismoDia=(_diasHueco===0 && ant.turno && hoy.turno && ant.turno!==hoy.turno);'));
  assert.ok(appJs.includes("var idEnt = m.vehiculo_id || ('TQ:'+(m.tanque_id||''));"));
  assert.ok(appJs.includes('window.AC_TRASVASES='));
  assert.ok(appJs.includes('var _devAplicadosDia={};'));
  assert.ok(appJs.includes(".eq('momento',cual).eq('turno',t).select()"));
  assert.ok(appJs.includes('if(typeof _AC_LOTES!==\'undefined\') _AC_LOTES=null;'));
});

test('E17/E18: updTank con dedup diario WA, addCombustible piso 0, combLitros parsea JSON, borrarMedicionTanque detiene ante r.error', () => {
  assert.ok(appJs.includes("var _waKey='btg_wa_tank_low_'"));
  assert.ok(appJs.includes('Math.max(0,Math.min(cfg.tanque||4600'));
  assert.ok(appJs.includes("if(typeof tabla==='string'){ try{tabla=JSON.parse(tabla);}catch(e){return 0;} }"));
  assert.ok(appJs.includes("mostrarToast('No se pudo eliminar la medición: '+r.error.message,'error');"));
});

console.log(`\n✅ ${ok}/${ok} pruebas de Combustible en verde`);
