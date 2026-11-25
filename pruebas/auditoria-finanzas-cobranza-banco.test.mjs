// Regresión de la auditoría del Bloque 4/6: Finanzas, Cobranza y Banco
// Verifica errores críticos de dinero, fiscal, conciliación, permisos y Edge Functions.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const APP = fs.readFileSync(new URL('../app.js', import.meta.url), 'utf8');
const HTML = fs.readFileSync(new URL('../app.html', import.meta.url), 'utf8');
const BNC_SALDO = fs.readFileSync(new URL('../supabase/functions/bnc-saldo/index.ts', import.meta.url), 'utf8');
const COBROS_ALC = fs.readFileSync(new URL('../supabase/functions/cobros-alcaldia/index.ts', import.meta.url), 'utf8');
const BNC_WEBHOOK = fs.readFileSync(new URL('../supabase/functions/bnc-webhook/index.ts', import.meta.url), 'utf8');
const DIVISAS_BANCO = fs.readFileSync(new URL('../supabase/functions/divisas-banco/index.ts', import.meta.url), 'utf8');
const BNC_TRAER = fs.readFileSync(new URL('../supabase/functions/bnc-traer/index.ts', import.meta.url), 'utf8');

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

test('E1: _parseMontoBsInput no multiplica por 100 al recibir punto decimal y concCobroMarcar valida r.data.length', () => {
  const parseSrc = extractFn(APP, '_parseMontoBsInput');
  const ctx = {};
  vm.createContext(ctx);
  vm.runInContext(parseSrc, ctx);

  assert.equal(ctx._parseMontoBsInput('12345.67'), 12345.67);
  assert.equal(ctx._parseMontoBsInput('12.345,67'), 12345.67);
  assert.equal(ctx._parseMontoBsInput('12345,67'), 12345.67);
  assert.equal(ctx._parseMontoBsInput('12.345'), 12345);

  const concFn = extractFn(APP, 'concCobroMarcar');
  assert.ok(concFn.includes('_parseMontoBsInput(mIn)'), 'concCobroMarcar debe usar _parseMontoBsInput');
  assert.ok(concFn.includes('r.data.length'), 'concCobroMarcar debe validar filas retornadas');
});

test('E2/E3: Abonos usa #ab-f, conserva centavos con parseFloat y borra/edita por (fact, ref)', () => {
  const calcFn = extractFn(APP, 'calcMontoAbono');
  assert.ok(calcFn.includes("tarifaDe(gv('ab-f'))"), 'calcMontoAbono debe leer #ab-f');
  assert.ok(HTML.includes('id="ab-f" type="date" onchange="calcMontoAbono()"'), 'app.html #ab-f debe disparar calcMontoAbono()');

  const delFn = extractFn(APP, 'eliminarAbono');
  const editFn = extractFn(APP, 'abrirEditarAbono');
  assert.ok(delFn.includes("'&ref=eq.'"), 'eliminarAbono debe filtrar por fact Y ref');
  assert.ok(editFn.includes("'&ref=eq.'"), 'abrirEditarAbono debe filtrar por fact Y ref');
  assert.ok(!editFn.includes('m:parseInt(nm)'), 'abrirEditarAbono no debe truncar centavos con parseInt');
  assert.ok(editFn.includes('descuento:descFlag'), 'abrirEditarAbono debe preservar descuento');
});

test('E4/E5/F4: bncFilaBanco preserva moneda USD sin convertir a VES; Banco suma con bncMontoBs y fechaVE', () => {
  const filaFn = extractFn(APP, 'bncFilaBanco');
  assert.ok(filaFn.includes('moneda:mon'), 'bncFilaBanco debe escribir columna moneda');
  assert.ok(filaFn.includes("mon!=='VES'"), 'bncFilaBanco debe respetar monto original en cuentas USD');

  const guardarFn = extractFn(APP, 'bncGuardarDesdeBanco');
  assert.ok(!guardarFn.includes("guardarEnCola('bnc_movimientos'"), 'bncGuardarDesdeBanco no debe encolar sin ignoreDuplicates');

  const dashFn = extractFn(APP, 'renderBNCDash');
  const movFn = extractFn(APP, 'renderMovBNC');
  assert.ok(dashFn.includes('bncMontoBs'), 'renderBNCDash debe sumar en Bs con bncMontoBs');
  assert.ok(movFn.includes('bncMontoBs'), 'renderMovBNC debe sumar en Bs con bncMontoBs');
});

test('E6: cargarTasas no fabrica bcvEuro * 1.13 y marca TASAS_DISPONIBLES = true', () => {
  const tasasFn = extractFn(APP, 'cargarTasas');
  assert.ok(!tasasFn.includes('Math.round(bcvN*1.13'), 'cargarTasas no debe fabricar bcvEuro = bcvN * 1.13');
  assert.ok(tasasFn.includes('TASAS_DISPONIBLES=true'), 'cargarTasas debe asignar TASAS_DISPONIBLES=true');
});

test('E7/E8/E9/E10/E11: Caja Chica, Dev.Fiel, Gastos Variables y Reporte Financiero consistentes y con bloqueo de período', () => {
  const ccRender = extractFn(APP, 'renderCajaChica');
  const ccSave = extractFn(APP, 'guardarGastoCaja');
  const ccRep = extractFn(APP, 'guardarReposicion');
  assert.ok(!ccRender.includes('calcCajachica()'), 'renderCajaChica no debe usar callback calcCajachica');
  assert.ok(ccSave.includes('_bloqueoPeriodo'), 'guardarGastoCaja debe respetar PERIODOS_CERRADOS');
  assert.ok(ccSave.includes('.select()'), 'guardarGastoCaja debe validar .select()');
  assert.ok(ccRep.includes('.select()'), 'guardarReposicion debe validar .select()');

  const fielFn = extractFn(APP, 'marcarFielDevuelto');
  assert.ok(fielFn.includes("from('pagos_alcaldia').update({fiel_devuelto:true})"), 'marcarFielDevuelto debe persistir en pagos_alcaldia');

  const gvFn = extractFn(APP, 'guardarGastoVar');
  assert.ok(gvFn.includes('_bloqueoPeriodo'), 'guardarGastoVar debe respetar PERIODOS_CERRADOS');
  assert.ok(gvFn.includes('.select()'), 'guardarGastoVar debe validar .select()');

  const rptFn = extractFn(APP, 'imprimirReporteFinanciero');
  assert.ok(rptFn.includes('_utilReal'), 'imprimirReporteFinanciero debe usar _utilReal');
  assert.ok(rptFn.includes('_cxpCuentaEnEgresos'), 'imprimirReporteFinanciero debe excluir SENIAT en CxP');
});

test('E12/E13/E14/C1/C4/F1/F2: Permisos hub finanzas, borrarFactura/correlativo .select(), proveedores y tokens', () => {
  const permFn = extractFn(APP, 'aplicarPermisos');
  assert.ok(permFn.includes("_tieneHubFin"), 'aplicarPermisos no debe borrar mi-financiero si tiene proveedores/cajachica');

  const provTab = extractFn(APP, 'switchProvTab');
  assert.ok(provTab.includes("tienePermiso('cxp')"), 'switchProvTab debe restringir pestañas cxp/ret/hist');

  const borFac = extractFn(APP, 'borrarFactura');
  assert.ok(borFac.includes(".delete().eq('id',id).select()"), 'borrarFactura debe validar .select() antes de done()');

  const emRet = extractFn(APP, 'emitirComprobanteRet');
  assert.ok(emRet.includes(".update(up).eq('id',f.id).select()"), 'emitirComprobanteRet debe validar .select()');

  const gFac = extractFn(APP, 'guardarFactura');
  assert.ok(gFac.includes('_repeCtrl=_ctrl ?'), 'guardarFactura solo debe buscar control repetido si _ctrl no está vacío');

  const cancOrd = extractFn(APP, '_osCancelarOrden');
  assert.ok(cancOrd.includes('solicitarToken'), '_osCancelarOrden debe pedir solicitarToken');
  assert.ok(cancOrd.includes('orden_id'), '_osCancelarOrden debe advertir si hay CxP ligada');

  const seniatFn = extractFn(APP, 'pagarRetencionSeniat');
  assert.ok(seniatFn.includes('solicitarToken'), 'pagarRetencionSeniat debe pedir solicitarToken');

  const desmFn = extractFn(APP, 'concCxpDesmarcar');
  assert.ok(desmFn.includes('solicitarToken'), 'concCxpDesmarcar debe pedir solicitarToken');
  assert.ok(desmFn.includes("from('bnc_movimientos').update({cxp_pago_id:null,conciliado:false})"), 'concCxpDesmarcar debe limpiar bnc_movimientos');

  const wncFn = extractFn(APP, 'registrarAbonoDesdeWNC');
  assert.ok(wncFn.includes("sv('ab-f'"), 'registrarAbonoDesdeWNC debe escribir en #ab-f (no #ab-fecha)');
});

test('E15/E16/E17/E18: Edge Functions BNC y Cobranza corregidas', () => {
  assert.ok(BNC_SALDO.includes('Range:'), 'bnc-saldo saldoDeMovimientos debe paginar con Range');
  assert.ok(!BNC_SALDO.includes('crÃ©dito'), 'bnc-saldo no debe tener mojibake en crédito');
  assert.ok(COBROS_ALC.includes('conciliado: true'), 'cobros-alcaldia debe marcar conciliado: true en bnc_movimientos');
  assert.ok(COBROS_ALC.includes('filasMap'), 'cobros-alcaldia debe deduplicar filas por id antes del batch upsert');
  assert.ok(BNC_WEBHOOK.includes('-04:00'), 'bnc-webhook parseFechaBNC debe usar offset -04:00 VET');
  assert.ok(BNC_WEBHOOK.includes('status: "duplicado"'), 'bnc-webhook debe deduplicar reintentos por referencia');
  assert.ok(DIVISAS_BANCO.includes('divisa_banco_prelim_'), 'divisas-banco debe separar clave preliminar de definitiva');
  assert.ok(BNC_TRAER.includes('4 * 3600 * 1000'), 'bnc-traer hoyISO debe usar hora Venezuela UTC-4');
  assert.ok(BNC_TRAER.includes('moneda: monedaAcc'), 'bnc-traer debe escribir moneda real de la cuenta');
});
