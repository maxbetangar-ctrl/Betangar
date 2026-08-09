// Le agrega la hoja PERSONAL IMAU al formato que ya usa la operación, SIN tocar nada más.
//
// ⛔ NO se regenera el archivo. `FORMATO REGISTRO DE VIAJES BETANGAR.xlsm` tiene 10 hojas
// (DASHBOARD, RESUMEN, NOMINA SEMANAL, CONTROL DE VIAJES Y PAGOS, los reportes) y **macros VBA**.
// Cualquier herramienta que lo reescriba entero borra el `vbaProject.bin` en silencio: el archivo
// abre igual, las hojas están todas y los botones no hacen nada. Por eso acá se abre el .xlsm como
// lo que es —un zip— se copian TODAS las piezas tal cual, y solo se agregan las tres entradas de
// la hoja nueva. Al final se comprueba que las macros sigan adentro.
// [[norma-bitacora-nombrar-la-pieza-que-ya-existe]]
//
// La hoja es nueva porque el IMAU no cabe en la planilla del camión:
//   · Alejandra, 07/08: «en las planillas no podemos colocar a los ayudantes IMAU… es personal
//     EXTERNO y sus condiciones de pago son diferentes».
//   · Máximo, 09/08: se cambian de unidad, y el día puede quedar partido — «2 en una unidad y, si
//     su unidad se guarda, 1 en otra»: son 3 viajes y el escalón va sobre el TOTAL de la persona.
//   Como columnas del camión, el que se cambia no tendría dónde anotarse.
//
// Uso:  node herramientas/imau-hoja-en-formato.mjs [desde YYYY-MM-DD]
import { getPAT } from 'file:///C:/Users/Maxbetangar/maxware-tools/pat.mjs';
import { createRequire } from 'node:module';
import fs from 'node:fs';
const require = createRequire(import.meta.url);
const JSZip = require('C:/Users/Maxbetangar/maxware-tools/excel/node_modules/jszip');

const ORIGEN = 'C:/Users/Maxbetangar/OneDrive/Escritorio/FORMATO REGISTRO DE VIAJES BETANGAR con vertedero (hasta 21-07).xlsm';
const PAT = getPAT(), REF = 'hrkjddehqnzcqwlkklqm';
const sql = async (q) => {
  const r = await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`,
    { method: 'POST', headers: { Authorization: `Bearer ${PAT}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ query: q }) });
  const j = await r.json(); if (!Array.isArray(j)) throw new Error(JSON.stringify(j).slice(0, 300)); return j;
};
const esc = (s) => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
// ⛔ LAS FÓRMULAS NO SE ESCAPAN IGUAL QUE EL TEXTO. `<f>` es un nodo de texto: dentro solo hay que
// escapar `&` y `<`. Si se le pasa el escapador general, `>=` se convierte en `&gt;=` y Excel lee
// eso LITERAL — la fórmula queda rota y el archivo abre igual, solo que la columna del pago da
// error. Pasó acá y se detectó al releer el XML generado, no al generarlo.
const escF = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;');

// ── Los datos. Salen del sistema: no se le pide a nadie lo que ya sabemos.
const DESDE = process.argv[2] || '2026-07-22';           // el formato llega hasta el 21/07
const HASTA = (await sql(`select max(f) m from planillas`))[0].m;
const imau = await sql(`select nombre, coalesce(unidad,'') unidad from empleados
  where cargo='Ayudante' and tipo_ay='imau' and activo is not false order by nombre`);
const vj = await sql(`select f, cam, sum(t)::int t from planillas
  where f >= '${DESDE}' and f <= '${HASTA}' group by 1,2`);
const dias = [...new Set(vj.map((x) => x.f))].sort();
const porUni = {}; vj.forEach((x) => { porUni[x.cam + '|' + x.f] = x.t; });
if (!imau.length || !dias.length) { console.log('⛔ sin gente o sin días: no se genera nada'); process.exit(1); }
console.log(`${imau.length} personas del IMAU · ${dias.length} días con planilla, del ${DESDE} al ${HASTA}`);

const NOMDIA = ['Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo'];
const dow = (f) => (new Date(f + 'T12:00:00Z').getUTCDay() + 6) % 7;
const dmy = (f) => { const p = f.split('-'); return `${p[2]}/${p[1]}/${p[0]}`; };

// ── La hoja. Encabezado en la fila 4, datos desde la 5 (como el resto del libro).
const TIT = 'PERSONAL IMAU — se llena APARTE de la planilla de viajes';
const SUB = 'El nombre, su unidad habitual y los viajes que hizo esa unidad YA VIENEN PUESTOS. Solo se llenan las columnas F, G y H — y F y G casi siempre se dejan vacías.';
const H = ['FECHA', 'DIA', 'NOMBRE', 'UNIDAD HABITUAL', 'VIAJES QUE HIZO SU UNIDAD',
  '¿EN QUE UNIDAD ANDUVO? (vacio = la habitual)', 'VIAJES QUE HIZO LA PERSONA (solo si el dia quedo partido)',
  '¿FUE A TRABAJAR? (Si / No)', 'PAGO $', 'OBSERVACIONES'];

const filas = [];
for (const p of imau)
  for (const f of dias)
    filas.push({ f, dia: NOMDIA[dow(f)], nom: p.nombre, uni: p.unidad || '- sin asignar -',
                 vjUni: porUni[(p.unidad || '') + '|' + f] || 0 });

const celda = (col, r, v, tipo) => {
  if (tipo === 'f') return `<c r="${col}${r}"><f>${escF(v)}</f></c>`;
  if (tipo === 'n') return `<c r="${col}${r}"><v>${v}</v></c>`;
  return `<c r="${col}${r}" t="inlineStr"><is><t xml:space="preserve">${esc(v)}</t></is></c>`;
};
const COLS = 'ABCDEFGHIJ'.split('');
let xml = '';
xml += `<row r="1">${celda('A', 1, TIT)}</row>`;
xml += `<row r="2">${celda('A', 2, SUB)}</row>`;
xml += `<row r="4">${H.map((h, i) => celda(COLS[i], 4, h)).join('')}</row>`;
filas.forEach((x, i) => {
  const r = 5 + i;
  // El PAGO es una fórmula, para que se vea la plata mientras se llena y nadie tenga que acordarse
  // del escalón. Los viajes que mandan son los de LA PERSONA (G); si G está vacía, los de su
  // unidad (E). Y solo se paga si fue.
  // No se usa EXACT: distingue mayúsculas y "SI" o "sí" no pagarían. `<>` en Excel no distingue,
  // y se aceptan las dos formas de escribirlo para que nadie se quede sin cobrar por una tilde.
  const v = `IF(G${r}="",E${r},G${r})`;
  const pago = `IF(AND(H${r}<>"Si",H${r}<>"Sí"),0,IF(${v}>=3,5,IF(${v}=2,2,0)))`;
  xml += `<row r="${r}">` +
    celda('A', r, dmy(x.f)) + celda('B', r, x.dia) + celda('C', r, x.nom) + celda('D', r, x.uni) +
    celda('E', r, x.vjUni, 'n') + celda('F', r, '') + celda('G', r, '') + celda('H', r, '') +
    celda('I', r, pago, 'f') + celda('J', r, '') + `</row>`;
});

const UNID = [...new Set(vj.map((x) => x.cam))].sort();
const ULT = 4 + filas.length;
const hoja = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<sheetPr><tabColor rgb="FF7030A0"/></sheetPr>
<sheetViews><sheetView workbookViewId="0"><pane ySplit="4" topLeftCell="A5" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>
<sheetFormatPr defaultRowHeight="15"/>
<cols>${[13, 12, 32, 16, 14, 26, 26, 18, 9, 28].map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`).join('')}</cols>
<sheetData>${xml}</sheetData>
<dataValidations count="3">
<dataValidation type="list" allowBlank="1" showErrorMessage="1" errorTitle="Elegi la unidad" error="Se elige de la lista. Vacio = anduvo en su unidad habitual, que es lo normal." sqref="F5:F${ULT}"><formula1>"${UNID.join(',')}"</formula1></dataValidation>
<dataValidation type="list" allowBlank="1" showErrorMessage="1" errorTitle="Si o No" error="Vacio NO es 'no fue': es que falta el dato, y esa plata queda en espera." sqref="H5:H${ULT}"><formula1>"Si,No"</formula1></dataValidation>
<dataValidation type="whole" operator="between" allowBlank="1" showErrorMessage="1" errorTitle="Viajes de LA PERSONA" error="Se escribe solo si el dia quedo partido entre dos unidades. Vacio = los viajes de su unidad." sqref="G5:G${ULT}"><formula1>0</formula1><formula2>30</formula2></dataValidation>
</dataValidations>
</worksheet>`;

// ── Injertar en el .xlsm sin regenerarlo ──────────────────────────────────────────────────────
const zip = await JSZip.loadAsync(fs.readFileSync(ORIGEN));
const vbaOrig = zip.file('xl/vbaProject.bin');
if (!vbaOrig) { console.log('⛔ el original no trae macros: ¿es el archivo correcto?'); process.exit(1); }
const vbaLen = (await vbaOrig.async('nodebuffer')).length;
const hojasAntes = Object.keys(zip.files).filter((n) => /^xl\/worksheets\/sheet\d+\.xml$/.test(n)).length;

const wbxml = await zip.file('xl/workbook.xml').async('string');
const rels = await zip.file('xl/_rels/workbook.xml.rels').async('string');
const ct = await zip.file('[Content_Types].xml').async('string');
if (/name="PERSONAL IMAU"/.test(wbxml)) { console.log('⛔ el archivo YA tiene la hoja PERSONAL IMAU: no se duplica'); process.exit(1); }
const nId = 'rId' + (Math.max(...[...rels.matchAll(/Id="rId(\d+)"/g)].map((m) => +m[1])) + 1);
const nSheet = Math.max(...Object.keys(zip.files)
  .map((n) => (n.match(/^xl\/worksheets\/sheet(\d+)\.xml$/) || [])[1]).filter(Boolean).map(Number)) + 1;
const nIdSheet = Math.max(...[...wbxml.matchAll(/sheetId="(\d+)"/g)].map((m) => +m[1])) + 1;

zip.file(`xl/worksheets/sheet${nSheet}.xml`, hoja);
zip.file('xl/workbook.xml', wbxml.replace('</sheets>', `<sheet name="PERSONAL IMAU" sheetId="${nIdSheet}" r:id="${nId}"/></sheets>`));
zip.file('xl/_rels/workbook.xml.rels', rels.replace('</Relationships>',
  `<Relationship Id="${nId}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${nSheet}.xml"/></Relationships>`));
zip.file('[Content_Types].xml', ct.replace('</Types>',
  `<Override PartName="/xl/worksheets/sheet${nSheet}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>`));

const SALIDA = 'C:/Users/Maxbetangar/OneDrive/Escritorio/FORMATO REGISTRO DE VIAJES BETANGAR (con PERSONAL IMAU).xlsm';
fs.writeFileSync(SALIDA, await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' }));

// ── Comprobar que no se rompió nada. Un .xlsm sin macros abre igual y no sirve para nada.
const v = await JSZip.loadAsync(fs.readFileSync(SALIDA));
const hojas = Object.keys(v.files).filter((n) => /^xl\/worksheets\/sheet\d+\.xml$/.test(n)).length;
const vba = v.file('xl/vbaProject.bin');
const mismo = vba && (await vba.async('nodebuffer')).length === vbaLen;
console.log(`\n✅ ${SALIDA}`);
console.log(`   hojas: ${hojas} (antes ${hojasAntes})`);
console.log(`   macros VBA: ${vba ? 'SÍ, siguen adentro' : '⛔ SE PERDIERON'}${mismo ? ' · byte a byte del mismo tamaño que el original' : ' ⛔ CAMBIÓ DE TAMAÑO'}`);
console.log(`   filas puestas: ${filas.length} (${imau.length} personas × ${dias.length} días)`);
if (!vba || !mismo || hojas !== hojasAntes + 1) { console.log('\n⛔ NO SE ENVÍA: el archivo no pasó la verificación'); process.exit(1); }
