// ════════════════════════════════════════════════════════════════════════════════════════════════
// BANCO DE PRUEBAS DE LA AUDITORÍA DE COMBUSTIBLE
//
// Por qué existe: el 2026-07-24 se descubrió que el módulo venía acusando en falso — la regla de
// "merma estacionada" afirmaba que el camión había estado parado sin haber mirado nunca el
// odómetro, y 12 de 26 casos de julio eran camiones que habían rodado hasta 208 km. Un módulo que
// señala personas no se puede tocar a ciegas: cada vez que se cambie una regla, hay que poder ver
// qué le pasa a los datos REALES antes de que salga por WhatsApp.
//
// Cómo funciona: extrae el módulo de auditoría TAL CUAL está en app.js (no lo reimplementa: si el
// código cambia, la prueba cambia con él), lo corre contra un volcado de la base y muestra qué
// anomalía saldría por cada regla.
//
// Uso:
//   node test/auditoria-combustible.mjs <archivo-datos.json> [desde] [hasta]
//
// El JSON de datos lleva: { tanques, mediciones, checklist, gasoil, unidades }, tal cual salen de
// sus tablas. Se arma con un volcado del período que se quiera revisar.
// ════════════════════════════════════════════════════════════════════════════════════════════════
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const APP = path.join(AQUI, '..', 'app.js');
const DATOS = process.argv[2];
const DESDE = process.argv[3] || '2026-07-01';
const HASTA = process.argv[4] || '2026-12-31';
if (!DATOS) { console.error('falta el archivo de datos: node test/auditoria-combustible.mjs datos.json [desde] [hasta]'); process.exit(1); }

// Los límites se buscan por marca, no por número de línea: si el módulo crece, la prueba lo sigue.
const lineas = fs.readFileSync(APP, 'utf8').split(/\r?\n/);
const ini = lineas.findIndex((l) => l.startsWith('var AC_TANQUES='));
const fin = lineas.findIndex((l) => l.startsWith('// ── FUNCIÓN PRINCIPAL'));
if (ini < 0 || fin <= ini) throw new Error('no encuentro el módulo de auditoría en app.js');

// Lo mínimo que el módulo espera del resto de la app.
const stubs = `
  function formatFecha(f){ const p=String(f).slice(0,10).split('-'); return p[2]+'/'+p[1]+'/'+p[0]; }
  function _lblUnidad(c){ return c; }
  function fechaVE(){ return HOY; }
  function g(){ return null; } function gv(){ return ''; } function sv(){}
  var FLOTA={}, supabase=null, DB_READY=false;
`;

const ctx = { console, Date, Math, JSON, Object, String, Number, Array, isFinite, parseFloat, parseInt,
              HOY: new Date().toISOString().slice(0, 10) };
vm.createContext(ctx);
vm.runInContext(stubs + '\n' + lineas.slice(ini, fin).join('\n'), ctx, { filename: 'app.js#auditoria' });

const d = JSON.parse(fs.readFileSync(DATOS, 'utf8').replace(/^﻿/, ''));
ctx.AC_TANQUES = (d.tanques || []).map((t) => ({
  id: t.id, nombre: t.nombre, tipo: t.tipo,
  cap: Number(t.capacidad_litros), hmax: Number(t.altura_max_cm),
  tabla: typeof t.tabla_cubicacion === 'string' ? JSON.parse(t.tabla_cubicacion) : t.tabla_cubicacion,
}));
ctx.AC_GASOIL = d.gasoil || [];
ctx.AC_CK = d.checklist || [];
ctx.AC_META = { costoL: d.costoLitro || null, rendRefMapa: d.rendRef || { '1131': 1.9 }, modeloCam: {} };
(d.unidades || []).forEach((u) => { ctx.AC_META.modeloCam[u.cam] = u.modelo || ''; ctx.FLOTA[u.cam] = 1; });
ctx.AC_MED = vm.runInContext('_acDedupe', ctx)(d.mediciones || []);

const todas = vm.runInContext('_acArmarJornadas', ctx)(DESDE, HASTA);
const ref = vm.runInContext('_acRefRend', ctx)(todas);
const anom = vm.runInContext('_acAnomalias', ctx)(todas, DESDE, HASTA, ref);

const tqV = ctx.AC_TANQUES.find((t) => t.tipo === 'vehiculo');
console.log(`Período ${DESDE} → ${HASTA}`);
if (tqV) console.log('Tolerancia de una jornada tipo (regla a 25 y 21 cm):', vm.runInContext('_acTol', ctx)(tqV, 25, 21, 0), 'L');
console.log('Jornadas:', todas.length,
  '· completas:', todas.filter((j) => j.conf === 'completa').length,
  '· corregidas:', todas.filter((j) => j.conf === 'corregida').length,
  '· incompletas:', todas.filter((j) => j.conf === 'incompleta').length);
console.log('Mediciones repetidas idénticas:', ctx.AC_META.duplicadas,
  '· momentos con alturas distintas:', ctx.AC_META.nCorregidas);

const porCod = {};
anom.forEach((a) => { (porCod[a.cod] = porCod[a.cod] || []).push(a); });
console.log('\n=== ANOMALÍAS POR REGLA ===');
Object.keys(porCod).sort().forEach((c) => {
  console.log(`\n${c} (${porCod[c].length})  ${porCod[c][0].titulo}`);
  porCod[c].slice(0, 40).forEach((a) => {
    console.log(`   ${a.sev.padEnd(5)} ${String(a.cam || '—').padEnd(9)} ${a.fecha || '—'}  ${a.litros == null ? '' : a.litros + ' L'}`);
  });
  if (porCod[c].length > 40) console.log(`   …y ${porCod[c].length - 40} más`);
});

// R1 es la única regla que insinúa una pérdida. Si alguna vez vuelve a dispararse de a decenas,
// es que se rompió una precondición: revisar antes de dejar que salga por WhatsApp.
const r1 = (porCod['R1'] || []).length;
console.log(`\n>>> R1 (faltó combustible en el patio): ${r1} caso(s).` +
  (r1 > 5 ? '  ⚠️ Son muchos: revisá las precondiciones antes de creerle.' : ''));
