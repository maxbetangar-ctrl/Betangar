// Regresión del Informe de Surtidas del Día (Cotejo con Estación de Servicio)
// Verifica agrupación por unidad, suma total de litros, exclusión de anuladas y controles UI.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const APP = fs.readFileSync(new URL('../app.js', import.meta.url), 'utf8');
const HTML = fs.readFileSync(new URL('../app.html', import.meta.url), 'utf8');

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

test('Agrupa surtidas por unidad, suma el total exacto para pagar a la E/S y excluye anuladas', () => {
  const fnSrc = extractFn(APP, '_resumenCotejoSurtidas');
  const ctx = { _surCostoUsd: (s) => parseFloat(s.costo_usd) || 0 };
  vm.createContext(ctx);
  vm.runInContext(fnSrc, ctx);

  const surtidasDia = [
    { cam: 'JAC-B001', litros: 100, tanque: 'estacion', costo_usd: 83, foto_url: 'f1.jpg' },
    { cam: 'JAC-B002', litros: 180, tanque: 'estacion', costo_usd: 149.4, foto_url: 'f2.jpg' },
    { cam: 'JAC-B002', litros: 120, tanque: 'estacion', costo_usd: 99.6, foto_url: 'f3.jpg' },
    { cam: 'JAC-B003', litros: 100, tanque: 'estacion', costo_usd: 83, foto_url: 'f4.jpg' },
    { cam: 'JAC-B004', litros: 0, tanque: 'estacion', corregido_por: 'admin' }, // anulada
  ];

  const r = ctx._resumenCotejoSurtidas(surtidasDia);
  assert.equal(r.nUnidades, 3, 'Debe contar 3 unidades válidas (excluyendo anulada)');
  assert.equal(r.totLit, 500, 'Total de litros del día debe ser exactamente 500 L');
  assert.equal(r.unidades.find((u) => u.cam === 'JAC-B001').litros, 100);
  assert.equal(r.unidades.find((u) => u.cam === 'JAC-B002').litros, 300);
  assert.equal(r.unidades.find((u) => u.cam === 'JAC-B002').cargas, 2);
  assert.equal(r.unidades.find((u) => u.cam === 'JAC-B003').litros, 100);
});

test('app.html y app.js exponen selector de fecha, filtro de origen, copiar e imprimir en Superadmin y Operativo', () => {
  // Dashboard Superadmin
  assert.ok(HTML.includes('id="dash-surt-fecha"'));
  assert.ok(HTML.includes('id="dash-surt-origen"'));
  assert.ok(HTML.includes('onclick="copiarCotejoSurtidas()"'));
  assert.ok(HTML.includes('onclick="imprimirCotejoSurtidas()"'));
  // Dashboard Operativo
  assert.ok(HTML.includes('id="oper-surt-fecha"'));
  assert.ok(HTML.includes('id="oper-surt-origen"'));
  assert.ok(HTML.includes("onclick=\"copiarCotejoSurtidas('oper')\""));
  assert.ok(HTML.includes("onclick=\"imprimirCotejoSurtidas('oper')\""));
  assert.ok(APP.includes('function copiarCotejoSurtidas(modo)'));
  assert.ok(APP.includes('function imprimirCotejoSurtidas(modo)'));
  assert.ok(APP.includes("modo:'oper'"));
});

test('Dashboard Operativo nunca muestra montos financieros ($/Bs)', () => {
  const fnSrc = extractFn(APP, '_surPuedeVerPlata');
  const ctxSuper = { SESION: { rol: 'superadmin' }, misPermisos: () => ['financiero', 'dashboard'] };
  vm.createContext(ctxSuper);
  vm.runInContext(fnSrc, ctxSuper);
  assert.equal(ctxSuper._surPuedeVerPlata('dash'), true, 'Superadmin en su dashboard sí ve costo');
  assert.equal(ctxSuper._surPuedeVerPlata('oper'), false, 'Dashboard Operativo nunca muestra costo');

  const ctxOper = { SESION: { rol: 'operativo' }, misPermisos: () => ['operativo'] };
  vm.createContext(ctxOper);
  vm.runInContext(fnSrc, ctxOper);
  assert.equal(ctxOper._surPuedeVerPlata('dash'), false, 'Rol operativo nunca ve costo');
  assert.equal(ctxOper._surPuedeVerPlata('oper'), false, 'Rol operativo nunca ve costo en operativo');
});

test('Coherencia con medición de regla (cm -> L) y capacidad del tanque', () => {
  const fnSrc = extractFn(APP, '_cotejoCoherenciaUnidad');
  const ctx = {};
  vm.createContext(ctx);
  vm.runInContext(fnSrc, ctx);

  const tanques = [{ id: 'tq-jac', capacidad_litros: 300 }];
  const vehiculos = [{ id: 'JAC-B001', tanque_id: 'tq-jac' }];

  // 1) Cuadra con cm: salió con 150 L, surtió 100 L, llegó con 130 L => consumo 120 L (OK)
  const medsOk = [
    { vehiculo_id: 'JAC-B001', fecha: '2026-11-25', momento: 'salida', altura_cm: 30, litros_calculados: 150, tanque_id: 'tq-jac', created_at: '2026-11-25T07:00:00Z' },
    { vehiculo_id: 'JAC-B001', fecha: '2026-11-25', momento: 'llegada', altura_cm: 26, litros_calculados: 130, tanque_id: 'tq-jac', created_at: '2026-11-25T17:00:00Z' },
  ];
  const rOk = ctx._cotejoCoherenciaUnidad('JAC-B001', '2026-11-25', 100, medsOk, tanques, vehiculos);
  assert.equal(rOk.estado, 'ok');
  assert.equal(rOk.consumo, 120);

  // 2) Excede capacidad del tanque: surtió 350 L en tanque de 300 L => alerta
  const rCap = ctx._cotejoCoherenciaUnidad('JAC-B001', '2026-11-25', 350, medsOk, tanques, vehiculos);
  assert.equal(rCap.estado, 'alerta');
  assert.ok(rCap.badge.includes('Excede'));

  // 3) Balance negativo incoherente: salió con 80 L, surtió 100 L, llegó con 250 L => consumo -70 L => alerta
  const medsNeg = [
    { vehiculo_id: 'JAC-B001', fecha: '2026-11-25', momento: 'salida', altura_cm: 16, litros_calculados: 80, tanque_id: 'tq-jac' },
    { vehiculo_id: 'JAC-B001', fecha: '2026-11-25', momento: 'llegada', altura_cm: 50, litros_calculados: 250, tanque_id: 'tq-jac' },
  ];
  const rNeg = ctx._cotejoCoherenciaUnidad('JAC-B001', '2026-11-25', 100, medsNeg, tanques, vehiculos);
  assert.equal(rNeg.estado, 'alerta');
  assert.equal(rNeg.consumo, -70);

  // 4) Sin mediciones de regla => sin_med (no acusa falso positivo)
  const rSin = ctx._cotejoCoherenciaUnidad('JAC-B001', '2026-11-25', 100, [], tanques, vehiculos);
  assert.equal(rSin.estado, 'sin_med');
});
