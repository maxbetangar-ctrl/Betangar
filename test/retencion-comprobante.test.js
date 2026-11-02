// EL COMPROBANTE DE RETENCIÓN. Esta prueba existe por lo que se emitía antes.
//
// Hasta el 02/11/2026 Betangar imprimía un recibo en DÓLARES, con el IVA y el ISLR
// en el mismo papel y el porcentaje en «0%», porque leía `cxp` (la deuda) en vez de
// `cxp_facturas` (la factura). Ese papel no se le puede entregar a un proveedor, así
// que las retenciones se seguían haciendo por fuera, en GALAC.
//
// Lo que esta prueba fija, usando como patrón los comprobantes REALES que Betangar
// ya emitió y que sabemos que están bien:
//   1. el número se arma igual que el de GALAC (IVA 8 dígitos, ISLR 10)
//   2. los montos del sistema coinciden al céntimo con el comprobante 571
//   3. un RIF al que le falta el dígito verificador NO pasa
//   4. sin número de control NO se emite
//   5. el comprobante de IVA no habla de ISLR, y al revés

const R = require('../retencion-comprobante.js');

let pass = 0, fail = 0;
function eq(name, got, exp) {
  const c = JSON.stringify(got) === JSON.stringify(exp);
  if (c) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ ' + name + '  → got ' + JSON.stringify(got) + ', exp ' + JSON.stringify(exp)); }
}
function ok(name, cond) { eq(name, !!cond, true); }

console.log('\nCOMPROBANTE DE RETENCIÓN');

// ── 1. El número, contra los comprobantes reales ────────────────────────────
eq('IVA: AAAAMM + 8 dígitos (como el 571 real)',
   R.retNumComprobante('IVA', 571, '2026-09-30'), '20260900000571');
eq('IVA: el de octubre, 632',
   R.retNumComprobante('IVA', 632, '2026-10-29'), '20261000000632');
eq('ISLR: AAAAMM + 10 dígitos (como el 199 real)',
   R.retNumComprobante('ISLR', 199, '2026-10-29'), '2026100000000199');
eq('el correlativo NO se reinicia cada mes: sólo cambia el prefijo',
   R.retNumComprobante('IVA', 633, '2026-11-02'), '20261100000633');

// ── 2. El RIF, que es lo que el SENIAT cruza ────────────────────────────────
ok('RIF del agente válido',            R.retRevisarRif('J-29566107-0').ok);
ok('RIF de la cauchera válido',        R.retRevisarRif('V-168778240').ok);
ok('RIF de INCONSUMMCA válido',        R.retRevisarRif('J41093708-4').ok);
eq('un RIF sin dígito verificador se rechaza y se dice cuál sería',
   R.retRevisarRif('V-16877824').sugerido, 'V-16877824-0');
ok('un verificador equivocado se detecta', !R.retRevisarRif('J-29566107-5').ok);
ok('un RIF vacío se rechaza',              !R.retRevisarRif('').ok);

// ── 3. Los montos, contra el comprobante 20260900000571 ─────────────────────
const d571 = {
  fecha: '2026-09-30', nro_factura: '000346', num_control: '00-00000346',
  base_bs: 161281.44, iva_pct: 16, iva_bs: 25805.03,
  ret_iva_pct: 75, ret_iva_bs: 19353.77, total_bs: 187086.47,
  agente_nombre: 'INVERSIONES BETANGAR, C.A.', agente_rif: 'J-29566107-0',
  agente_direccion: 'AV 18A CON CALLE 96 CASA NRO S/N SECTOR LA FLORIDA',
  prov_nombre: 'CAUCHERA SR. PACCINI', prov_rif: 'V-16877824-0', ciudad: 'Maracaibo',
};
eq('base imponible como en el papel',  R.retBs(d571.base_bs),   '161.281,44');
eq('monto IVA como en el papel',       R.retBs(d571.iva_bs),    '25.805,03');
eq('IVA retenido como en el papel',    R.retBs(d571.ret_iva_bs),'19.353,77');
eq('total compra como en el papel',    R.retBs(d571.total_bs),  '187.086,47');
eq('la fecha va dd/mm/aaaa',           R.retFecha('2026-09-30'),'30/09/2026');

// ── 4. Lo que bloquea la emisión ────────────────────────────────────────────
eq('con todo en regla, no hay problemas', R.retProblemas(d571, 'IVA'), []);

const sinControl = Object.assign({}, d571, { num_control: '' });
ok('sin número de control NO se emite', R.retProblemas(sinControl, 'IVA').length > 0);

const rifCorto = Object.assign({}, d571, { prov_rif: 'V-16877824' });
ok('con el RIF corto NO se emite', R.retProblemas(rifCorto, 'IVA').length > 0);

const sinDir = Object.assign({}, d571, { agente_direccion: '' });
ok('sin dirección fiscal NO se emite', R.retProblemas(sinDir, 'IVA').length > 0);

ok('pedir ISLR a una factura que sólo tiene IVA se rechaza',
   R.retProblemas(d571, 'ISLR').length > 0);

// ── 5. Cada papel habla de lo suyo ──────────────────────────────────────────
const htmlIva = R.retHtmlIVA(d571, '20260900000571');
ok('el de IVA lleva su título',        htmlIva.indexOf('IMPUESTO AL VALOR AGREGADO') > -1);
ok('el de IVA cita la Providencia',    htmlIva.indexOf('SNAT/2015/0049') > -1);
ok('el de IVA NO habla de ISLR',       htmlIva.indexOf('I.S.L.R') === -1);
ok('el de IVA lleva el nº de control', htmlIva.indexOf('00-00000346') > -1);
ok('el de IVA lleva el RIF del sujeto',htmlIva.indexOf('V-16877824-0') > -1);
ok('el de IVA lleva el período fiscal',htmlIva.indexOf('AÑO: 2026 / MES: 09') > -1);
ok('el de IVA va en Bs, no en $',      htmlIva.indexOf('$') === -1);
ok('el de IVA trae la firma del agente',htmlIva.indexOf('Agente de Retención (Fecha de Entrega)') > -1);

const dIslr = {
  fecha: '2026-10-29', nro_factura: '0000364', num_control: '00-000364',
  base_bs: 346283.00, ret_islr_pct: 2, sustraendo_bs: 0, ret_islr_bs: 6925.66,
  agente_nombre: 'INVERSIONES BETANGAR, C.A.', agente_rif: 'J-29566107-0',
  agente_direccion: 'AV 18A CON CALLE 96 CASA NRO S/N SECTOR LA FLORIDA',
  prov_nombre: 'INCONSUMMCA, C.A', prov_rif: 'J-41093708-4', ciudad: 'Maracaibo',
};
const htmlIslr = R.retHtmlISLR(dIslr, '2026100000000199');
ok('el de ISLR lleva su título',       htmlIslr.indexOf('RETENCIONES VARIAS DE I.S.L.R') > -1);
ok('el de ISLR lleva el sustraendo',   htmlIslr.indexOf('Sustraendo') > -1);
ok('el de ISLR NO cita la Providencia del IVA', htmlIslr.indexOf('SNAT/2015/0049') === -1);
ok('el de ISLR lleva «Firma y Sello»', htmlIslr.indexOf('Firma y Sello') > -1);
eq('el ISLR retenido como en el papel', R.retBs(dIslr.ret_islr_bs), '6.925,66');

// ── 5b. La razón social NO es el nombre interno ─────────────────────────────
// Medido contra los comprobantes reales: ninguno trae la coletilla de la casa.
eq('la razón social guardada manda',
   R.retRazonSocial('HUMBERTO PACCINI', 'HUMBERTO PACCINI (ATLAS)'), 'HUMBERTO PACCINI');
eq('sin razón social, se le quita la coletilla «(ATLAS)»',
   R.retRazonSocial('', 'HUMBERTO PACCINI (ATLAS)'), 'HUMBERTO PACCINI');
eq('…y a «INCONSUMMCA, C.A. (ATLAS)»',
   R.retRazonSocial(null, 'INCONSUMMCA, C.A. (ATLAS)'), 'INCONSUMMCA, C.A.');
eq('un nombre sin coletilla se deja igual',
   R.retRazonSocial('', 'AUTO UNION DC, C.A.'), 'AUTO UNION DC, C.A.');
eq('sólo se quita el paréntesis FINAL, no uno del medio',
   R.retRazonSocial('', 'FERRE (NORTE) MATERIALES'), 'FERRE (NORTE) MATERIALES');
ok('el comprobante sale con la razón social, no con el nombre interno',
   R.retHtmlIVA(Object.assign({}, d571, { prov_nombre: R.retRazonSocial('', 'HUMBERTO PACCINI (ATLAS)') }),
                '20260900000571').indexOf('(ATLAS)') === -1);

// ── 6. El botón en la tabla, contra la app de verdad ────────────────────────
// Se carga `app.js` en el harness: si el botón se rompe, la pestaña Retenciones
// deja de pintar y eso no lo ve ninguna prueba del módulo suelto.
const S = require('./harness.js');
ok('la app ve el módulo del comprobante', typeof S.retHtmlIVA === 'function');
ok('existe el emisor',                    typeof S.emitirComprobanteRet === 'function');

eq('una factura sin retención no muestra botón',
   S._btnComprobante({ id: 'F1', ret_iva_bs: 0, ret_islr_bs: 0 }, 'IVA'), '');
const conIva = { id: 'F2', ret_iva_bs: 19353.77, ret_islr_bs: 0 };
ok('con retención de IVA sale el botón de IVA',  S._btnComprobante(conIva, 'IVA').indexOf('IVA') > -1);
eq('…y NO el de ISLR, que no le corresponde',    S._btnComprobante(conIva, 'ISLR'), '');
ok('el botón lleva el id de la factura',         S._btnComprobante(conIva, 'IVA').indexOf("'F2','IVA'") > -1);
ok('si ya se emitió, el botón muestra el número',
   S._btnComprobante({ id: 'F3', ret_iva_bs: 100, comp_iva: '20260900000571' }, 'IVA')
     .indexOf('20260900000571') > -1);
const ambas = { id: 'F4', ret_iva_bs: 100, ret_islr_bs: 50 };
ok('una factura con las dos retenciones muestra los dos botones',
   !!S._btnComprobante(ambas, 'IVA') && !!S._btnComprobante(ambas, 'ISLR'));

console.log('\n  ' + pass + ' pasaron, ' + fail + ' fallaron\n');
process.exit(fail ? 1 : 0);
