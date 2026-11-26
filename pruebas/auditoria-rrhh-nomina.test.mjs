// Regresión de la auditoría del Bloque 5/6: RRHH y Nómina
// Verifica protección de semanas Excel, detalle IMAU, bloqueo de períodos cerrados,
// validaciones .select() en préstamos/multas/empleados/asistencia y supervisor-nomina en USD.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const APP = fs.readFileSync(new URL('../app.js', import.meta.url), 'utf8');
const SUP_NOM = fs.readFileSync(new URL('../supabase/functions/supervisor-nomina/index.ts', import.meta.url), 'utf8');

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

test('E1/C2: reguardarTodasNominas protege semanas Excel y conserva imau; aplicarAvanceDescuentos valida .select()', () => {
  const regFn = extractFn(APP, 'reguardarTodasNominas');
  assert.ok(regFn.includes('!/excel/i.test'), 'reguardarTodasNominas debe excluir semanas con fuente excel');
  assert.ok(regFn.includes('imau:n.imau||[]'), 'reguardarTodasNominas debe conservar detalle.imau');

  const avFn = extractFn(APP, 'aplicarAvanceDescuentos');
  assert.ok(avFn.includes("from('prestamos').upsert(") && avFn.includes('.select()'), 'aplicarAvanceDescuentos debe validar .select()');
});

test('E2: supervisor-nomina etiqueta en US$ y pagina planillas con Range', () => {
  assert.ok(SUP_NOM.includes('US$ ${facturado'), 'supervisor-nomina debe imprimir US$, no Bs');
  assert.ok(!SUP_NOM.includes('Bs ${facturado'), 'supervisor-nomina no debe etiquetar dólares como Bs');
  assert.ok(SUP_NOM.includes('Range:'), 'supervisor-nomina debe paginar planillas');
});

test('E3/E4/C1: Préstamos, multas, planilla especial y nómina validan monto > 0, _bloqueoPeriodo y .select()', () => {
  const gp = extractFn(APP, 'guardarPrestamo');
  const gm = extractFn(APP, 'guardarMulta');
  const ep = extractFn(APP, 'elimPrestamo');
  const em = extractFn(APP, 'elimMulta');
  const pe = extractFn(APP, 'guardarPlanillaEspecial');
  const ene = extractFn(APP, 'elimNominaExtra');
  const rpn = extractFn(APP, 'registrarPagoNom');

  assert.ok(gp.includes('!(monto>0)') && gp.includes('_bloqueoPeriodo') && gp.includes('.select()'));
  assert.ok(gm.includes('!(monto>0)') && gm.includes('_bloqueoPeriodo') && gm.includes('.select()'));
  assert.ok(ep.includes('_bloqueoPeriodo') && ep.includes('.delete().eq(\'id\',id).select()'));
  assert.ok(em.includes('_bloqueoPeriodo') && em.includes('.delete().eq(\'id\',id).select()'));
  assert.ok(pe.includes('_bloqueoPeriodo') && pe.includes('.select()'));
  assert.ok(ene.includes('_bloqueoPeriodo') && ene.includes('.delete().eq(\'id\',id).select()'));
  assert.ok(rpn.includes('_bloqueoPeriodo'));
});

test('E5/E6/E7/F1: montarNominaBNC usa fechaVE y .select(); guardarEmpleado/Asistencia/NomAdm blindados', () => {
  const bncNom = extractFn(APP, 'montarNominaBNC');
  assert.ok(bncNom.includes('fechaVE') && bncNom.includes("from('pagos_bnc').insert(rows).select()"));

  const gEmp = extractFn(APP, 'guardarEmpleado');
  assert.ok(gEmp.includes('.select()'), 'guardarEmpleado debe validar .select()');
  assert.ok(gEmp.includes('dupCed'), 'guardarEmpleado debe alertar cédula duplicada');

  const gAsis = extractFn(APP, 'guardarAsistencia');
  assert.ok(gAsis.includes('_asistenciaCargadaOk===false') && gAsis.includes('.select()'));

  const gAdm = extractFn(APP, 'guardarNomAdm');
  assert.ok(gAdm.includes('_nomAdmCargadoOk===false') && gAdm.includes('.select()'));
});
