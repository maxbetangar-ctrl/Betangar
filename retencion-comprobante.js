// ═══════════════════════════════════════════════════════════════════════════════
// COMPROBANTES DE RETENCIÓN — los dos formularios legales, en bolívares
//
// ⛔ POR QUÉ EXISTE (02/11/2026). `imprimirComprobante()` sacaba un recibo interno
//    en DÓLARES, con el IVA y el ISLR mezclados en un solo papel y el porcentaje
//    en 0%, porque leía `cxp` (la deuda) en vez de `cxp_facturas` (la factura).
//    Ese papel no se le puede entregar a un proveedor ni presentar al SENIAT, y
//    por eso las retenciones se seguían haciendo por fuera, en GALAC.
//    Los montos del sistema SÍ eran correctos: coinciden al céntimo con el
//    comprobante 20260900000571 que GALAC emitió. Lo que faltaba era el papel.
//
// ⛔ SON DOS FORMULARIOS DISTINTOS Y NO SE PUEDEN MEZCLAR:
//      · IVA  — Providencia SNAT/2015/0049, art. 16. Nº = AAAAMM + 8 dígitos.
//      · ISLR — Decreto 1.808.                        Nº = AAAAMM + 10 dígitos.
//    Cada uno lleva SU PROPIO correlativo, y los dos son continuos: no se
//    reinician cada mes, sólo cambia el prefijo del período.
//
// ⛔ Y LOS CORRELATIVOS NO ARRANCAN EN 1. GALAC ya emitió hasta IVA 632 e
//    ISLR 201 (ambos en 10/2026). Dos series para el mismo RIF es un problema
//    fiscal, no un detalle: esto CONTINÚA la numeración.
//
// Las funciones de acá son puras: reciben datos y devuelven texto. Quien las
// llama es `app.js`, que pone los datos y abre la ventana de impresión.
// ═══════════════════════════════════════════════════════════════════════════════

// ── El RIF, que es lo que el SENIAT cruza ────────────────────────────────────
// Algoritmo oficial: pesos [4,3,2,7,6,5,4,3,2], el 4 va por la LETRA.
var RET_LETRAS_RIF = { V: 1, E: 2, J: 3, P: 4, G: 5, C: 3 };

function retDigitoVerificador(letra, ocho) {
  var pesos = [3, 2, 7, 6, 5, 4, 3, 2];
  var suma = (RET_LETRAS_RIF[letra] || 0) * 4;
  for (var i = 0; i < 8; i++) suma += Number(ocho[i]) * pesos[i];
  var dv = 11 - (suma % 11);
  return dv > 9 ? 0 : dv;
}

/** {ok, motivo, sugerido, formateado}. Un RIF corto NO se ve roto: se ve corto. */
function retRevisarRif(rif) {
  var limpio = String(rif || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (!limpio) return { ok: false, motivo: 'no tiene RIF cargado' };
  var letra = limpio.charAt(0), nums = limpio.slice(1);
  if (!RET_LETRAS_RIF[letra]) return { ok: false, motivo: 'el RIF empieza por "' + letra + '", que no es un tipo válido' };
  if (!/^\d+$/.test(nums)) return { ok: false, motivo: 'el RIF tiene caracteres que no son dígitos' };
  if (nums.length === 8) {
    return { ok: false, motivo: 'al RIF le falta el dígito verificador',
             sugerido: letra + '-' + nums + '-' + retDigitoVerificador(letra, nums) };
  }
  if (nums.length !== 9) return { ok: false, motivo: 'el RIF tiene ' + nums.length + ' dígitos y deberían ser 9' };
  var dv = retDigitoVerificador(letra, nums.slice(0, 8));
  if (dv !== Number(nums.charAt(8))) {
    return { ok: false, motivo: 'el dígito verificador del RIF dice ' + nums.charAt(8) + ' y debería ser ' + dv,
             sugerido: letra + '-' + nums.slice(0, 8) + '-' + dv };
  }
  return { ok: true, formateado: letra + '-' + nums.slice(0, 8) + '-' + nums.charAt(8) };
}

// ── El número de comprobante ─────────────────────────────────────────────────
/**
 * AAAAMM del PERÍODO FISCAL + el correlativo con ceros delante.
 * IVA 8 dígitos, ISLR 10. Medido sobre los comprobantes reales de Betangar:
 *   IVA  20260900000571   ISLR 2026100000000201
 */
function retNumComprobante(tipo, correlativo, fechaDoc) {
  var f = String(fechaDoc || '').slice(0, 7);          // 'AAAA-MM'
  var periodo = f.replace('-', '');
  var largo = (tipo === 'ISLR') ? 10 : 8;
  var n = String(correlativo);
  while (n.length < largo) n = '0' + n;
  return periodo + n;
}

// ── Formato venezolano: 1.234.567,89 ─────────────────────────────────────────
function retBs(n) {
  var v = Number(n || 0);
  var s = Math.abs(v).toFixed(2).split('.');
  s[0] = s[0].replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return (v < 0 ? '-' : '') + s[0] + ',' + s[1];
}

function retFecha(iso) {
  var p = String(iso || '').slice(0, 10).split('-');
  return p.length === 3 ? (p[2] + '/' + p[1] + '/' + p[0]) : String(iso || '');
}

var RET_MESES = ['', 'ENERO', 'FEBRERO', 'MARZO', 'ABRIL', 'MAYO', 'JUNIO', 'JULIO',
                 'AGOSTO', 'SEPTIEMBRE', 'OCTUBRE', 'NOVIEMBRE', 'DICIEMBRE'];

function retEsc(s) {
  return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// ── Lo que NO se puede emitir ────────────────────────────────────────────────
/**
 * Devuelve la lista de motivos por los que ESTE comprobante no se puede emitir.
 * Vacía = se puede. Un comprobante fiscal mal emitido es peor que no emitirlo:
 * ya tiene número, ya consumió correlativo y el proveedor ya lo recibió.
 */
function retProblemas(d, tipo) {
  var p = [];
  var rifProv = retRevisarRif(d.prov_rif);
  if (!rifProv.ok) p.push('El proveedor «' + (d.prov_nombre || '?') + '»: ' + rifProv.motivo +
                          (rifProv.sugerido ? ' (sería ' + rifProv.sugerido + ')' : ''));
  var rifAg = retRevisarRif(d.agente_rif);
  if (!rifAg.ok) p.push('El RIF de la empresa: ' + rifAg.motivo);
  if (!String(d.nro_factura || '').trim()) p.push('La factura no tiene número.');
  // ⛔ El número de control es obligatorio en el formulario: es lo que ata el
  //    comprobante a la factura impresa del proveedor.
  if (!String(d.num_control || '').trim()) p.push('Falta el número de control de la factura.');
  if (!String(d.agente_direccion || '').trim()) p.push('Falta la dirección fiscal de la empresa.');
  if (!d.fecha) p.push('La factura no tiene fecha.');
  if (tipo === 'IVA' && !(Number(d.ret_iva_bs) > 0)) p.push('Esta factura no tiene retención de IVA.');
  if (tipo === 'ISLR' && !(Number(d.ret_islr_bs) > 0)) p.push('Esta factura no tiene retención de ISLR.');
  return p;
}

// ── Estilos comunes a los dos formularios ────────────────────────────────────
var RET_CSS =
  '@page{size:letter landscape;margin:10mm}' +
  'body{font-family:Arial,Helvetica,sans-serif;font-size:9px;color:#000;margin:0}' +
  '.t{width:100%;border-collapse:collapse;table-layout:fixed}' +
  '.t td,.t th{border:1px solid #000;padding:3px 4px;vertical-align:top}' +
  '.lbl{font-size:7.5px;color:#000}' +
  '.val{font-size:10px;font-weight:700}' +
  '.c{text-align:center}.r{text-align:right}' +
  '.tit{text-align:center;font-size:12px;font-weight:700;margin:2px 0 4px}' +
  '.legal{font-size:6.5px;text-align:justify;line-height:1.25;margin:4px 0}' +
  '.num{font-family:"Courier New",monospace}' +
  // Aire sobre las firmas: ahí va el sello de la empresa, que se estampa encima
  // de la raya. Sin espacio, el sello se achica o pisa la tabla.
  '.firmas{width:100%;margin-top:120px}' +
  '.firmas td{text-align:center;font-size:8px;padding-top:2px;width:50%}' +
  '.raya{border-top:1px solid #000;width:62%;margin:0 auto 3px}' +
  '@media print{body{margin:0}}';

function retCabecera(d, titulo, numero, etiquetaNum) {
  var per = String(d.fecha || '').slice(0, 7).split('-');
  return '' +
  '<div class="tit">' + titulo + '</div>' +
  '<table class="t">' +
    '<tr>' +
      '<td style="width:58%"><span class="lbl">' + etiquetaNum + '</span><br>' +
        '<span class="val num">' + retEsc(numero) + '</span></td>' +
      '<td style="width:21%"><span class="lbl">FECHA DE EMISIÓN</span><br>' +
        '<span class="val">' + retFecha(d.fecha_emision || d.fecha) + '</span></td>' +
      '<td style="width:21%"><span class="lbl">Período Fiscal</span><br>' +
        '<span class="val">AÑO: ' + per[0] + ' / MES: ' + (per[1] || '') + '</span></td>' +
    '</tr>' +
    '<tr>' +
      '<td><span class="lbl">Nombre o Razón Social del Agente de Retención</span><br>' +
        '<span class="val">' + retEsc(d.agente_nombre) + '</span></td>' +
      '<td colspan="2"><span class="lbl">RIF del Agente de Retención</span><br>' +
        '<span class="val num">' + retEsc(retRevisarRif(d.agente_rif).formateado || d.agente_rif) + '</span></td>' +
    '</tr>' +
    '<tr><td colspan="3"><span class="lbl">Dirección Fiscal del Agente de Retención</span><br>' +
      '<span class="val">' + retEsc(d.agente_direccion) + '</span></td></tr>' +
    '<tr>' +
      '<td><span class="lbl">Nombre o Razón Social del Sujeto Retenido</span><br>' +
        '<span class="val">' + retEsc(d.prov_nombre) + '</span></td>' +
      '<td colspan="2"><span class="lbl">RIF del Sujeto Retenido</span><br>' +
        '<span class="val num">' + retEsc(retRevisarRif(d.prov_rif).formateado || d.prov_rif) + '</span></td>' +
    '</tr>' +
  '</table>';
}

function retFirmas(izq, der) {
  return '<table class="firmas"><tr>' +
    '<td><div class="raya"></div>' + izq + '</td>' +
    '<td><div class="raya"></div>' + der + '</td>' +
  '</tr></table>';
}

// ── Comprobante de retención de IVA ──────────────────────────────────────────
function retHtmlIVA(d, numero) {
  var tipoDoc = d.tipo_doc_fiscal || '01';
  var base = Number(d.base_bs || 0), iva = Number(d.iva_bs || 0), ret = Number(d.ret_iva_bs || 0);
  var total = Number(d.total_bs || 0) || (base + iva);
  return '<!DOCTYPE html><html><head><meta charset="UTF-8">' +
  '<title>Retención IVA ' + retEsc(numero) + '</title><style>' + RET_CSS + '</style></head><body>' +
  '<div class="legal">Decreto con Rango, Valor y Fuerza de Ley de Reforma de la Ley de Impuesto al Valor Agregado ' +
    'Nº 1.436 del 17 de Noviembre de 2014. <b>Artículo 11:</b> "La Administración Tributaria podrá designar como ' +
    'responsable del pago del impuesto, en calidad de agente de retención, a quienes por sus funciones públicas o ' +
    'por razón de sus actividades privadas intervengan en operaciones gravadas con el impuesto establecido en este ' +
    'Decreto con Rango, Valor y Fuerza de Ley. (...)"</div>' +
  retCabecera(d, 'COMPROBANTE DE RETENCIÓN DEL IMPUESTO AL VALOR AGREGADO I.V.A.',
              numero, 'NÚMERO DE COMPROBANTE') +
  '<table class="t" style="margin-top:4px">' +
    '<tr>' +
      '<th style="width:4%" class="c lbl">No.</th>' +
      '<th style="width:10%" class="c lbl">Fecha del Documento</th>' +
      '<th style="width:12%" class="c lbl">Número de Factura</th>' +
      '<th style="width:12%" class="c lbl">Número de Control</th>' +
      '<th style="width:9%" class="c lbl">Número N/D</th>' +
      '<th style="width:9%" class="c lbl">Número N/C</th>' +
      '<th style="width:8%" class="c lbl">Tipo Doc.</th>' +
      '<th style="width:12%" class="c lbl">Base Imponible</th>' +
      '<th style="width:12%" class="c lbl">Monto I.V.A.</th>' +
      '<th style="width:12%" class="c lbl">I.V.A. Retenido</th>' +
    '</tr>' +
    '<tr>' +
      '<td class="c num">1</td>' +
      '<td class="c num">' + retFecha(d.fecha) + '</td>' +
      '<td class="c num">' + retEsc(d.nro_factura) + '</td>' +
      '<td class="c num">' + retEsc(d.num_control) + '</td>' +
      '<td class="c num">' + retEsc(d.num_nd || '') + '</td>' +
      '<td class="c num">' + retEsc(d.num_nc || '') + '</td>' +
      '<td class="c num">' + retEsc(tipoDoc) + '</td>' +
      '<td class="r num">' + retBs(base) + '</td>' +
      '<td class="r num">' + retBs(iva) + '</td>' +
      '<td class="r num">' + retBs(ret) + '</td>' +
    '</tr>' +
    '<tr><td colspan="7" class="r lbl"><b>TOTALES</b></td>' +
      '<td class="r num"><b>' + retBs(base) + '</b></td>' +
      '<td class="r num"><b>' + retBs(iva) + '</b></td>' +
      '<td class="r num"><b>' + retBs(ret) + '</b></td></tr>' +
  '</table>' +
  '<table class="t" style="margin-top:4px;width:62%">' +
    '<tr>' +
      '<th class="c lbl">Total Compra con I.V.A.</th>' +
      '<th class="c lbl">Compras sin crédito</th>' +
      '<th class="c lbl">% Alícuota</th>' +
      '<th class="c lbl">Base Imponible</th>' +
    '</tr>' +
    '<tr>' +
      '<td class="r num">' + retBs(total) + '</td>' +
      '<td class="r num">' + retBs(d.compras_sin_credito || 0) + '</td>' +
      '<td class="r num">' + retBs(d.iva_pct || 0) + '</td>' +
      '<td class="r num">' + retBs(base) + '</td>' +
    '</tr>' +
  '</table>' +
  '<div class="legal">Este comprobante se emite según lo establecido en el Artículo Nº 16 de la Providencia ' +
    'SNAT/2015/0049 de fecha 14/07/2015, publicada en Gaceta Oficial Nº 40.720 del 10 de Agosto de 2015.</div>' +
  retFirmas('Agente de Retención (Fecha de Entrega)', 'Sujeto Retenido (Fecha de Recepción)') +
  '</body></html>';
}

// ── Comprobante de retención de ISLR ─────────────────────────────────────────
function retHtmlISLR(d, numero) {
  var per = String(d.fecha || '').slice(0, 7).split('-');
  var base = Number(d.base_bs || 0);
  var sus = Number(d.sustraendo_bs || 0);
  var ret = Number(d.ret_islr_bs || 0);
  return '<!DOCTYPE html><html><head><meta charset="UTF-8">' +
  '<title>Retención ISLR ' + retEsc(numero) + '</title><style>' + RET_CSS + '</style></head><body>' +
  '<div class="tit">COMPROBANTE DE RETENCIONES VARIAS DE I.S.L.R.</div>' +
  '<table class="t">' +
    '<tr>' +
      '<td style="width:58%"><span class="lbl">Número de Comprobante</span><br>' +
        '<span class="val num">' + retEsc(numero) + '</span></td>' +
      '<td style="width:21%"><span class="lbl">Lugar y Fecha</span><br>' +
        '<span class="val">' + retEsc((d.ciudad || '').toUpperCase()) + ', ' + retFecha(d.fecha_emision || d.fecha) + '</span></td>' +
      '<td style="width:21%"><span class="lbl">Período Fiscal</span><br>' +
        '<span class="val">Año: ' + per[0] + ' / Mes: ' + (RET_MESES[Number(per[1])] || '') + '</span></td>' +
    '</tr>' +
    '<tr>' +
      '<td><span class="lbl">Nombre o Razón Social del Agente de Retención</span><br>' +
        '<span class="val">' + retEsc(d.agente_nombre) + '</span></td>' +
      '<td colspan="2"><span class="lbl">RIF del Agente de Retención</span><br>' +
        '<span class="val num">' + retEsc(retRevisarRif(d.agente_rif).formateado || d.agente_rif) + '</span></td>' +
    '</tr>' +
    '<tr><td colspan="3"><span class="lbl">Dirección Fiscal del Agente de Retención</span><br>' +
      '<span class="val">' + retEsc(d.agente_direccion) + '</span></td></tr>' +
    '<tr>' +
      '<td><span class="lbl">Nombre o Razón Social del Sujeto Retenido</span><br>' +
        '<span class="val">' + retEsc(d.prov_nombre) + '</span></td>' +
      '<td colspan="2"><span class="lbl">RIF del Sujeto Retenido</span><br>' +
        '<span class="val num">' + retEsc(retRevisarRif(d.prov_rif).formateado || d.prov_rif) + '</span></td>' +
    '</tr>' +
  '</table>' +
  '<table class="t" style="margin-top:4px">' +
    '<tr>' +
      '<th style="width:12%" class="c lbl">Fecha del Documento</th>' +
      '<th style="width:13%" class="c lbl">Número de Factura</th>' +
      '<th style="width:12%" class="c lbl">Número de Nota de Débito</th>' +
      '<th style="width:13%" class="c lbl">Número de Control</th>' +
      '<th style="width:10%" class="c lbl">Tipo de Doc.</th>' +
      '<th style="width:14%" class="c lbl">Base Afectada</th>' +
      '<th style="width:8%" class="c lbl">% de Retención</th>' +
      '<th style="width:9%" class="c lbl">Sustraendo</th>' +
      '<th style="width:14%" class="c lbl">I.S.L.R. Retenido</th>' +
    '</tr>' +
    '<tr>' +
      '<td class="c num">' + retFecha(d.fecha) + '</td>' +
      '<td class="c num">' + retEsc(d.nro_factura) + '</td>' +
      '<td class="c num">' + retEsc(d.num_nd || '') + '</td>' +
      '<td class="c num">' + retEsc(d.num_control) + '</td>' +
      '<td class="c">' + retEsc(d.tipo_doc_texto || 'FACTURA') + '</td>' +
      '<td class="r num">' + retBs(base) + '</td>' +
      '<td class="c num">' + (Number(d.ret_islr_pct || 0)) + '%</td>' +
      '<td class="r num">' + retBs(sus) + '</td>' +
      '<td class="r num">' + retBs(ret) + '</td>' +
    '</tr>' +
    '<tr><td colspan="8" class="r lbl"><b>Total I.S.L.R. Retenido</b></td>' +
      '<td class="r num"><b>' + retBs(ret) + '</b></td></tr>' +
  '</table>' +
  retFirmas('Firma y Sello<br>Agente de Retención', 'Firma<br>Sujeto Retenido') +
  '</body></html>';
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { retRevisarRif: retRevisarRif, retDigitoVerificador: retDigitoVerificador,
                     retNumComprobante: retNumComprobante, retBs: retBs, retFecha: retFecha,
                     retProblemas: retProblemas, retHtmlIVA: retHtmlIVA, retHtmlISLR: retHtmlISLR };
}
