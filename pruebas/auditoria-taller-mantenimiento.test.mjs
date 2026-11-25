// Regresión de la auditoría del Bloque 3/6: Taller y Mantenimiento
// Verifica errores críticos y conexiones entre Mecánico, Checklist Oficina, Km,
// Preventivos, Órdenes de Servicio, Llantas, Inventario y Documentos.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const APP = fs.readFileSync(new URL('../app.js', import.meta.url), 'utf8');

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

test('E16 y C5: mecanico y operativo tienen histfallas y cargarDatosMinimos carga unidad_config y checklist', () => {
  const permM = /mecanico:\[([^\]]+)\]/.exec(APP);
  const permO = /operativo:\[([^\]]+)\]/.exec(APP);
  assert.ok(permM && permM[1].includes("'histfallas'"), 'PERMISOS.mecanico debe incluir histfallas');
  assert.ok(permO && permO[1].includes("'histfallas'"), 'PERMISOS.operativo debe incluir histfallas');

  const minFn = extractFn(APP, 'cargarDatosMinimos');
  assert.ok(minFn.includes("from('unidad_config')"), 'cargarDatosMinimos debe cargar unidad_config para mecánico');
  assert.ok(minFn.includes("from('checklist')"), 'cargarDatosMinimos debe cargar checklist reciente para mecánico');
});

test('E10: mecSelEstado y clSelEstado soportan el estado taller', () => {
  const mecFn = extractFn(APP, 'mecSelEstado');
  const clFn = extractFn(APP, 'clSelEstado');
  assert.ok(mecFn.includes('taller:'), 'mecSelEstado debe tener color para taller');
  assert.ok(clFn.includes('taller:'), 'clSelEstado debe tener color para taller');
});

test('E1/E2/E11/E13: clCargarExistente y clGuardar preservan turno, modo noche sin borrar mañana y rol WA mecanica', () => {
  const loadFn = extractFn(APP, 'clCargarExistente');
  const saveFn = extractFn(APP, 'clGuardar');
  assert.ok(loadFn.includes('window._clModoNocheRow'), 'clCargarExistente debe manejar _clModoNocheRow');
  assert.ok(loadFn.includes('window._clTurnoActual'), 'clCargarExistente debe rastrear _clTurnoActual');
  assert.ok(/from\('checklist'\)\.update\(updLle\)\.eq\('id',\s*rowNoche\.id\)\.select\(\)/.test(saveFn), 'clGuardar en modo noche debe actualizar solo llegada por id');
  assert.ok(/sendWA\([^)]*'mecanica'/.test(saveFn), 'clGuardar debe notificar al rol mecanica (no mecanico)');
  assert.ok(!/sendWA\([^)]*'mecanico'/.test(saveFn), 'clGuardar no debe usar el rol inexistente mecanico');
});

test('E4/E15/E9: cierre de orden carga INV_MOV, filtra inventario activo y valida .select() en BD', () => {
  const abrirFn = extractFn(APP, '_iniciarCierreCompra');
  const invFn = extractFn(APP, '_ccPoblarInv');
  const updFn = extractFn(APP, '_ccActualizarOrden');
  const cerrarFn = extractFn(APP, '_cerrarOrdenTrasMant');
  assert.ok(abrirFn.includes('cargarInvMov'), '_iniciarCierreCompra debe cargar INV_MOV si falta');
  assert.ok(invFn.includes('_invActivos'), '_ccPoblarInv debe usar _invActivos()');
  assert.ok(updFn.includes(".update(patch).eq('id',ordenId).select()"), '_ccActualizarOrden debe esperar .select()');
  assert.ok(cerrarFn.includes(".update(patch).eq('id',ordenId).select()"), '_cerrarOrdenTrasMant debe esperar .select()');
});

test('E5/F3/E14: borrarOdo pide token y usa ult_srv; guardarKm usa kmActualCam y ult_srv con await .select()', () => {
  const delFn = extractFn(APP, 'borrarOdo');
  const saveFn = extractFn(APP, 'guardarKm');
  const syncFn = extractFn(APP, '_syncKmDataSiSube');
  assert.ok(delFn.includes('solicitarToken'), 'borrarOdo debe requerir token');
  assert.ok(delFn.includes('ult_srv:0'), 'borrarOdo debe escribir columna ult_srv (no ultsrv)');
  assert.ok(!delFn.includes('ultsrv:0,f:null'), 'borrarOdo no debe usar columna inexistente ultsrv');
  assert.ok(saveFn.includes('kmActualCam(cam)'), 'guardarKm debe comparar rollback contra kmActualCam(cam)');
  assert.ok(saveFn.includes('kmUpdate.ult_srv=km'), 'guardarKm debe escribir ult_srv');
  assert.ok(saveFn.includes("await supabase.from('km_data').upsert([kmUpdate],{onConflict:'cam'}).select()"), 'guardarKm debe esperar upsert con .select()');
  assert.ok(syncFn.includes("from('km_data').upsert"), '_syncKmDataSiSube debe persistir en km_data');
});

test('E6/E7/E12: _diasEntre devuelve NaN en fecha inválida y _mantEstadoCalc convierte aviso en meses a días', () => {
  const diasEntreSrc = extractFn(APP, '_diasEntre');
  const diasEntreIsoSrc = extractFn(APP, '_diasEntreISO');
  const calcSrc = extractFn(APP, '_mantEstadoCalc');

  const ctx = {
    addDays(iso, d) {
      const dt = new Date(String(iso).slice(0, 10) + 'T12:00:00Z');
      dt.setUTCDate(dt.getUTCDate() + d);
      return dt.toISOString().slice(0, 10);
    },
    formatFecha(iso) { return String(iso || ''); }
  };
  vm.createContext(ctx);
  vm.runInContext(`${diasEntreSrc}\n${diasEntreIsoSrc}\n${calcSrc}`, ctx);

  assert.ok(Number.isNaN(ctx._diasEntre('fecha-invalida', '2026-11-25')), '_diasEntre debe retornar NaN en fecha inválida');
  // Batería cada 12 meses (360d) con aviso de 1 mes (30d): si faltan 20 días debe ser 'proximo'
  const resMeses = ctx._mantEstadoCalc('meses', 12, 1, { fecha: '2025-12-20' }, null, '2026-11-25');
  assert.equal(resMeses.estado, 'proximo', 'Con base=meses y aviso=1 (30d), faltando 20d debe marcar proximo');
  // Si fecha última es inválida debe devolver sin_dato
  const resInv = ctx._mantEstadoCalc('dias', 30, 5, { fecha: 'bad-date' }, null, '2026-11-25');
  assert.equal(resInv.estado, 'sin_dato');

  const prevFn = extractFn(APP, 'calcMantPreventivo');
  assert.ok(prevFn.includes('_prevUnidadesActivas'), 'calcMantPreventivo debe iterar solo unidades activas');
  const srvFn = extractFn(APP, 'verificarAlertasServicio');
  assert.ok(srvFn.includes('kmActualCam(cam)'), 'verificarAlertasServicio debe usar kmActualCam');
  assert.ok(srvFn.includes('proxServicio(km,cam)'), 'verificarAlertasServicio debe usar proxServicio');
});

test('E3/E8/E17/F5: guardarDocs blindado, llantas con .select() y paginado, sin ciclarLlanta ni herencia vieja', () => {
  const docsFn = extractFn(APP, 'guardarDocs');
  const llFn = extractFn(APP, '_guardarLlanta');
  const desgFn = extractFn(APP, 'renderDesgasteLlantas');
  const cambFn = extractFn(APP, 'registrarCambioLl');

  assert.ok(docsFn.includes('_docsCargadosOk===false'), 'guardarDocs debe bloquear sobrescritura si no cargó desde BD');
  assert.ok(docsFn.includes('_ensureJWT'), 'guardarDocs debe refrescar JWT');
  assert.ok(docsFn.includes('return=representation'), 'guardarDocs debe verificar representación devuelta');
  assert.ok(llFn.includes('.select()'), '_guardarLlanta debe usar .select()');
  assert.ok(desgFn.includes("_selectAllG('llantas_mediciones'"), 'renderDesgasteLlantas debe paginar con _selectAllG');
  assert.ok(!/function\s+ciclarLlanta\s*\(/.test(APP), 'ciclarLlanta (muerta) debe haberse eliminado');
  assert.ok(!cambFn.includes('ll.marca=marca||ll.marca'), 'registrarCambioLl no debe heredar marca de la llanta vieja');
});
