#!/usr/bin/env node
// ══════════════════════════════════════════════════════════════════════════════
//  BETANGAR · RELACIÓN DE GASTOS Y COBROS — el archivo que lleva la administración
//  ──────────────────────────────────────────────────────────────────────────
//  QUÉ REEMPLAZA
//  El archivo que llevaba la administradora a mano, movimiento por movimiento.
//  Aurelys deja el puesto; lo toma Alejandra hasta que entre la nueva
//  administradora. Máximo (09/08/2026): que el archivo nuevo sea «más fácil y
//  más difícil de cometer errores para todos», y que se lleve EN PARALELO al
//  sistema.
//
//  LA DIFERENCIA DE FONDO: ACÁ NO SE TECLEA NINGÚN MOVIMIENTO
//  El banco entrega el 99,6% de los movimientos solo, tres veces al día, con
//  fecha, monto, beneficiario, cédula/RIF y su número de control. Este archivo
//  sale YA LLENO con todo eso. Lo único que hay que decidir es la CATEGORÍA de
//  lo que el sistema no supo clasificar — que sobre 4 meses y medio fueron
//  10 movimientos, unos 2 al mes.
//
//  LAS CUATRO COSAS QUE ESTE ARCHIVO HACE DISTINTO, Y POR QUÉ (cada una costó
//  un problema real, no son adornos):
//
//   1. LA CATEGORÍA SE ELIGE DE UNA LISTA, NO SE ESCRIBE.
//      En el archivo viejo era texto libre y «E/S EL PALOTAL» quedó escrito de
//      34 formas distintas en 74 pagos. Ningún cuadro podía sumarlo: mostraba
//      un pedazo y lo presentaba como el total.
//
//   2. VIENEN LAS DOS VERSIONES DEL CONCEPTO: la del banco y la de la oficina.
//      No son lo mismo y ninguna gana siempre. El fiel cumplimiento de la
//      factura 000627 quedó anotado como «Credito Inmediato Recibido» y el
//      banco lo llama «fc segun factura EMISOR : INSTITUTO MUNICIPAL DEL ASEO».
//      Con una sola versión ese cobro estuvo tres meses sin dueño.
//
//   3. «SALIÓ DEL BANCO» Y «ES UN GASTO» SON DOS COLUMNAS DISTINTAS.
//      La compra de dólares sale de la cuenta y NO es gasto: es ahorro. En
//      Betangar eso era el 23,7% de las salidas — Bs 55 millones que hacían ver
//      la utilidad más baja de lo que era. [[norma-salida-de-banco-no-es-gasto]]
//
//   4. CADA FILA TRAE SU NÚMERO DE CONTROL DEL BANCO.
//      Es lo que permite volver a cargar el archivo sin duplicar nada, y lo que
//      distingue dos filas idénticas de un pago de nómina en lote (el 30/04 hay
//      13 filas de Bs 2.435,60 iguales en fecha, monto y referencia).
//
//  ⛔ Es una COPIA de trabajo. El archivo original de la administración se
//     conserva aparte: es la única constancia de los gastos uno a uno.
//
//  Uso:
//    node herramientas/relacion-gastos-excel.mjs                  → últimos 60 días
//    node herramientas/relacion-gastos-excel.mjs 2026-03-23 2026-08-09
// ══════════════════════════════════════════════════════════════════════════════
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
const require = createRequire(import.meta.url);
const ExcelJS = require('C:/Users/Maxbetangar/maxware-tools/excel/node_modules/exceljs');
const MX = require('C:/Users/Maxbetangar/maxware-tools/excel/maxware-excel.js');
const GUARDIA = require('C:/Users/Maxbetangar/maxware-tools/excel/guardia-marca.js');
const { getPAT } = await import('file:///C:/Users/Maxbetangar/maxware-tools/pat.mjs');

MX.usar(ExcelJS);
const REF = 'hrkjddehqnzcqwlkklqm';
const PAT = getPAT();
const sql = async (q) => {
  const r = await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`, {
    method: 'POST', headers: { Authorization: `Bearer ${PAT}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: q }),
  });
  const j = await r.json();
  if (!r.ok) throw new Error(JSON.stringify(j).slice(0, 300));
  return j;
};

// ── período ──
const A = process.argv.slice(2).filter((x) => !x.startsWith('--'));
const hoy = new Date().toISOString().slice(0, 10);
const dMas = (f, n) => { const d = new Date(f + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const DESDE = A[0] || dMas(hoy, -60);
const HASTA = A[1] || hoy;

// ── formato venezolano. [[norma-fecha-venezolana-dd-mm-yyyy]] [[norma-numeros-puntos-de-miles]]
const fecha = (f) => { const s = String(f || '').slice(0, 10); const p = s.split('-'); return p.length === 3 ? `${p[2]}/${p[1]}/${p[0]}` : s; };
const bs = (v) => Number(v || 0).toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const lim = (s) => String(s ?? '').replace(/\s+/g, ' ').trim();

// De qué se llama cada categoría en castellano. La lista de la columna sale de acá,
// así que agregar una categoría nueva es agregar una línea — y si falta alguna, se ve.
const NOMBRE_CAT = {
  cobro_alcaldia: 'Cobro de la Alcaldía', nomina: 'Nómina', combustible: 'Combustible',
  compra_divisas: 'Compra de dólares (NO es gasto)', pago_socio: 'Pago a socio',
  asignacion_1b: 'Comisión 1B', impuestos: 'Impuestos y retenciones', resp_social: 'Responsabilidad social',
  mantenimiento: 'Mantenimiento', servicios: 'Servicios', alquiler: 'Alquiler', seguro: 'Seguros',
  dotacion: 'Dotación y uniformes', tramites: 'Trámites y permisos', compra_software: 'Software',
  software: 'Software', comision_banco: 'Comisión bancaria', caja_chica: 'Caja chica',
  reembolso: 'Reembolso', prestamo_empleado: 'Préstamo a empleado (NO es gasto)',
  bienestar_personal: 'Bienestar del personal', parafiscales: 'Parafiscales',
  implantacion_maxware: 'Apoyo administrativo', traspaso_interno: 'Traspaso entre cuentas propias (NO es gasto)',
  reverso: 'Devolución / reverso', otro_ingreso: 'Otra entrada', otro: 'Otro',
  duplicado: 'Pago duplicado', prueba_sistema: 'Prueba del sistema',
  '⏳pendiente_explicar': 'PENDIENTE DE EXPLICAR', sin_clasificar: '⚠️ FALTA CLASIFICAR',
};

// ── lo que el banco dice de cada movimiento ────────────────────────────────
// El beneficiario y la cédula se sacan del texto del banco, que es donde de verdad están.
const beneficiarioDe = (t) => {
  const m = lim(t).match(/A FAVOR DE:\s*([^]+?)(?:\s+PARA LA CUENTA|\s+CED\.|$)/i)
        || lim(t).match(/A NOMBRE DE:\s*(?:[VEJGvejg]-?\d+\s+)?([^]+?)(?:\s+DE LA CUENTA|$)/i)
        || lim(t).match(/EMISOR\s*:\s*([^]+?)(?:\s{2,}|$)/i);
  return m ? lim(m[1]).slice(0, 46) : '';
};
const identDe = (t) => { const m = lim(t).match(/(?:CED\.?:?|RIF\.?:?)\s*([VEJGvejg]-?\d{6,10})/i) || lim(t).match(/\b([VEJG]-\d{6,9})\b/); return m ? m[1].toUpperCase() : ''; };

const movs = await sql(`
  select m.fecha, m.tipo, m.monto, m.descripcion, m.concepto_banco, m.referencia,
         m.categoria, m.es_gasto, m.clasificado_por, m.factura, m.pata, m.control_number, m.cuenta,
         t.bcv_dolar tasa
    from bnc_movimientos m
    left join tasas_diarias t on t.fecha = m.fecha::date
   where m.fecha >= '${DESDE}' and m.fecha <= '${HASTA}'
   order by m.fecha, m.control_number`);
console.log(`${movs.length} movimientos del ${fecha(DESDE)} al ${fecha(HASTA)}`);

const CATS = [...new Set([...Object.values(NOMBRE_CAT)])].sort();
const H = ['Fecha', 'Tipo', 'Monto Bs', 'Tasa del día', 'Monto US$', 'Lo que dice el BANCO',
  'Lo que anotó la oficina', 'Beneficiario', 'RIF / Cédula', 'CATEGORÍA', '¿Es gasto?',
  'Factura', 'Observación', 'Nº de control'];
const W = [11, 9, 16, 12, 13, 46, 34, 30, 14, 30, 11, 10, 26, 13];

const filaDe = (m) => {
  const t = lim(m.concepto_banco) || lim(m.descripcion);
  const tasa = Number(m.tasa) || 0;
  const cat = NOMBRE_CAT[m.categoria] || m.categoria || '⚠️ FALTA CLASIFICAR';
  return [
    fecha(m.fecha),
    m.tipo === 'credito' ? 'Entrada' : 'Salida',
    bs(m.monto),
    tasa ? bs(tasa) : '— sin tasa —',
    tasa ? bs(Number(m.monto) / tasa) : '',
    lim(m.concepto_banco) || '(el banco no lo trae)',
    lim(m.descripcion) || '',
    beneficiarioDe(t),
    identDe(t),
    cat,
    m.tipo === 'credito' ? 'No (es una entrada)' : (m.es_gasto === false ? 'No' : 'Sí'),
    m.factura ? `${m.factura} ${m.pata || ''}`.trim() : '',
    '',
    m.control_number || '',
  ];
};

const wb = MX.libro();

// ⚠️ EL BANNER LLEVA LA MARCA DEL CLIENTE, y hay que pasarlo a mano.
// `MX.marca()` lee la configuración del clon, que existe en el NAVEGADOR; corriendo desde Node no
// la encuentra y cae al genérico «MAXWARE». El archivo lo va a abrir la administración de
// Betangar y tiene que decir Betangar. La línea «por Maxware C.A.» sigue yendo debajo, que es
// lo que corresponde. [[flotamax-clon-debrand-logo-checklist]]
const BANNER = 'INVERSIONES BETANGAR, C.A.';

// ── HOJA 1 · POR REVISAR — va primera a propósito: es lo único que hay que hacer ──
// ⛔ ESTA HOJA NO LLEVA FILTRO DE FECHA, y es a propósito. Las demás miran el período (60 días por
// defecto); si "Por revisar" hiciera lo mismo, un movimiento que nadie clasificó en su momento se
// caería del archivo al mes siguiente y NUNCA MÁS volvería a pedirse — quedaría sin clasificar para
// siempre, y el Excel se vería impecable justo porque perdió lo que faltaba. Lo pendiente se arrastra
// hasta que alguien lo resuelva. (Con el rango de 60 días salían 9 de los 22 reales.)
const pend = await sql(`
  select m.fecha, m.tipo, m.monto, m.descripcion, m.concepto_banco, m.referencia,
         m.categoria, m.es_gasto, m.clasificado_por, m.factura, m.pata, m.control_number, m.cuenta,
         t.bcv_dolar tasa
    from bnc_movimientos m
    left join tasas_diarias t on t.fecha = m.fecha::date
   where m.categoria is null or m.categoria in ('sin_clasificar','⏳pendiente_explicar')
   order by m.fecha, m.control_number`);
console.log(`${pend.length} por revisar (TODA la historia, no solo el período)`);
const ws1 = MX.hoja(wb, {
  banner: BANNER, name: 'Por revisar', headers: H, widths: W, rows: pend.map(filaDe), vacias: 6,
  subtitulo: `LO ÚNICO QUE HAY QUE LLENAR — ${pend.length} movimiento(s) que el sistema no supo clasificar, ` +
             `de TODA la historia (no solo del período de las otras hojas): lo que queda pendiente se arrastra hasta que se resuelva. ` +
             `Elegí la CATEGORÍA de la lista y, si es una salida, decidí si es gasto. Lo demás ya viene puesto.`,
});

// ── HOJA 2 · TODOS LOS MOVIMIENTOS ──
const ws2 = MX.hoja(wb, {
  banner: BANNER, name: 'Movimientos', headers: H, widths: W, rows: movs.map(filaDe),
  subtitulo: `Los ${movs.length} movimientos del período, tal como los entrega el banco. ` +
             `No hay que teclear ninguno: se revisan. Si una categoría está mal, se corrige en la columna CATEGORÍA.`,
});

// ── las listas desplegables. Es lo que impide los 34 nombres para un proveedor ──
for (const [ws, n] of [[ws1, Math.max(pend.length, 6) + 6], [ws2, movs.length + 2]]) {
  for (let r = 5; r < 5 + n; r++) {
    ws.getCell(r, 10).dataValidation = { type: 'list', allowBlank: true, formulae: [`"${CATS.join(',')}"`],
      showErrorMessage: true, errorTitle: 'Elegí una de la lista',
      error: 'La categoría se elige de la lista, no se escribe. Si falta una, avisá y se agrega.' };
    ws.getCell(r, 11).dataValidation = { type: 'list', allowBlank: true, formulae: ['"Sí,No,No (es una entrada)"'],
      showErrorMessage: true, errorTitle: 'Sí o No',
      error: 'Que la plata salga del banco NO la hace un gasto: la compra de dólares es ahorro y el traspaso a otra cuenta nuestra tampoco es gasto.' };
  }
}

// ── HOJA 3 · COBROS DE LA ALCALDÍA ──
const cob = await sql(`select * from v_cobro_facturas order by fecha`);
MX.hoja(wb, {
  banner: BANNER, name: 'Cobros de la Alcaldía',
  headers: ['Factura', 'Fecha', 'Viajes', 'Base US$', 'Neto esperado US$', '¿Neto cobrado?', 'Fiel 10% esperado US$', '¿Fiel cobrado?', 'Fecha del neto', 'Fecha del fiel', 'Cobrado Bs'],
  widths: [10, 12, 8, 13, 17, 14, 19, 14, 14, 14, 18],
  rows: cob.map((c) => [c.factura, fecha(c.fecha), c.viajes, bs(c.base_usd), bs(c.neto_esperado_usd),
    c.neto_cobrado ? 'Sí' : '🔴 NO', bs(c.fiel_esperado_usd), c.fiel_cobrado ? 'Sí' : '🔴 NO',
    c.fecha_neto ? fecha(c.fecha_neto) : '', c.fecha_fiel ? fecha(c.fecha_fiel) : '', bs(c.cobrado_bs)]),
  subtitulo: 'La Alcaldía paga cada factura en DOS partes: el neto con la factura, y el 10% de fiel cumplimiento unos días después. Un 🔴 NO en una factura vieja es plata que todavía deben.',
});

// ── HOJA 4 · RESUMEN ──
const res = await sql(`select categoria, tipo, count(*) q, sum(monto) bs from bnc_movimientos
  where fecha >= '${DESDE}' and fecha <= '${HASTA}' group by 1,2 order by 4 desc`);
MX.hoja(wb, {
  banner: BANNER, name: 'Resumen', headers: ['Categoría', 'Entrada o salida', 'Movimientos', 'Total Bs', '¿Cuenta como gasto?'],
  widths: [34, 18, 13, 20, 20],
  rows: res.map((r) => [NOMBRE_CAT[r.categoria] || r.categoria, r.tipo === 'credito' ? 'Entrada' : 'Salida',
    r.q, bs(r.bs), r.tipo === 'credito' ? 'No — es una entrada' : (/NO es gasto/.test(NOMBRE_CAT[r.categoria] || '') ? 'No' : 'Sí')]),
  subtitulo: 'Totales del período por categoría. La última columna es la que decide si el movimiento entra en la utilidad.',
});

// ── HOJA 5 · CÓMO SE LLENA ──
MX.hoja(wb, {
  banner: BANNER, name: 'Cómo se llena', headers: ['Punto', 'Qué hay que saber'], widths: [30, 118],
  rows: [
    ['Lo único que hay que hacer', 'Ir a la hoja «Por revisar» y ponerle CATEGORÍA a lo que está ahí. Nada más. Todo lo demás ya viene del banco.'],
    ['No se teclea ningún movimiento', 'El banco los entrega solo, tres veces al día, con fecha, monto, beneficiario y cédula. Copiarlos a mano solo agrega errores.'],
    ['La categoría se ELIGE', 'La columna CATEGORÍA tiene una lista. No se escribe a mano: si se escribe, el mismo proveedor termina con varios nombres y ningún total lo suma completo.'],
    ['Si falta una categoría', 'No inventar una nueva escribiéndola: avisar y se agrega a la lista. Una categoría suelta no aparece en ningún cuadro.'],
    ['Salir del banco NO es ser un gasto', 'La compra de dólares sale de la cuenta y es AHORRO, no gasto. Pasa a gasto recién cuando se aplica a la deuda de los camiones. Lo mismo el traspaso a otra cuenta nuestra: es la misma plata cambiando de bolsillo.'],
    ['Las dos columnas de concepto', 'Una dice lo que puso el BANCO y otra lo que anotó la oficina. No siempre dicen lo mismo, y cada una acierta a veces. Si se contradicen, gana el identificador fiscal (RIF o cédula).'],
    ['El Nº de control', 'Es el número que le pone el banco a cada movimiento. No se toca ni se borra: es lo que evita que un movimiento entre dos veces, y lo que distingue dos pagos idénticos de un lote de nómina.'],
    ['Cobros de la Alcaldía', 'Cada factura se cobra en DOS partes: el neto (≈90%) y el 10% de fiel cumplimiento días después. La hoja «Cobros de la Alcaldía» marca en rojo lo que falta.'],
    ['Este archivo es una COPIA', 'El archivo original de la administración se conserva aparte. Este no lo reemplaza: se lleva en paralelo hasta que los dos coincidan.'],
  ],
  subtitulo: 'Leer esto una vez alcanza. Está en orden de importancia.',
});

// ── guardar ──
const salida = path.join('C:/Users/Maxbetangar/OneDrive/Escritorio', `Betangar - Relacion de gastos y cobros ${HASTA}.xlsx`);
const dir = path.dirname(salida);
const destino = fs.existsSync(dir) ? salida : path.join(process.cwd(), `Betangar - Relacion de gastos y cobros ${HASTA}.xlsx`);
await MX.descargar(wb, destino);
console.log(`\n✅ ${destino}`);

// ⛔ El candado: nada que salga al cliente puede insinuar IA. Revisa texto, celdas Y metadatos.
// [[norma-nada-que-insinue-ia-al-cliente]]
GUARDIA.exigirLimpio({ texto: 'Relación de gastos y cobros de Betangar', xlsx: destino }, ExcelJS);
console.log('✅ guardia de marca: limpio (texto, celdas y metadatos)');
console.log(`\n   Por revisar : ${pend.length} movimiento(s)`);
console.log(`   Movimientos : ${movs.length}`);
console.log(`   Facturas    : ${cob.length} · sin cobrar entero: ${cob.filter((c) => !c.neto_cobrado || !c.fiel_cobrado).length}`);
