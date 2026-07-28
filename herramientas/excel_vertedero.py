#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Agrega la columna VERTEDERO al Excel de REGISTRO DE VIAJES de Betangar.

POR QUÉ EXISTE
--------------
Los viajes NOCTURNOS botados en Resimara se pagan 1.5× (regla de Máximo, 2026-07-22).
La app lee ese dato del Excel que carga la secretaria; si la columna no está, TODO entra
como "La Concepción" y el 1.5× no se paga. Esta herramienta le agrega la columna al
archivo, con una lista desplegable (La Concepción / Resimara) para que no haya typos.

POR QUÉ UN SCRIPT Y NO "ABRIR EXCEL Y AGREGARLA"
-----------------------------------------------
El libro es .xlsm (tiene macros) y la hoja está dentro de una TABLA de Excel. Hay que
tocar tres cosas a la vez (el rango de la tabla, el encabezado y la validación) y
reescribir el .zip sin romper el VBA. Se hace copiando todo byte a byte y cambiando
solo dos XML.

USO
---
    python herramientas/excel_vertedero.py "ENTRADA.xlsm" ["SALIDA.xlsm"]

Es IDEMPOTENTE: si el archivo ya trae la columna, avisa y no toca nada.
No modifica la entrada: siempre escribe un archivo nuevo.

NOTA: el .xlsm con datos reales (nombres, cédulas, planillas) NO va al repositorio;
este repo es público. Solo vive acá la herramienta.
"""
import re
import shutil
import sys
import zipfile
from pathlib import Path

HOJA = 'REGISTRO VIAJES'
FILA_ENC = 20          # los encabezados de la tabla viven en la fila 20
OPCIONES = 'La Concepción,Resimara'


def col_letra(n):
    """1 -> A, 27 -> AA"""
    s = ''
    while n > 0:
        n, r = divmod(n - 1, 26)
        s = chr(65 + r) + s
    return s


def col_num(letra):
    n = 0
    for c in letra:
        n = n * 26 + (ord(c) - 64)
    return n


def buscar_hoja(z):
    """Devuelve la ruta del XML de la hoja REGISTRO VIAJES."""
    wbxml = z.read('xl/workbook.xml').decode('utf8')
    m = re.search(r'<sheet[^>]*name="%s"[^>]*r:id="(rId\d+)"' % re.escape(HOJA), wbxml)
    if not m:
        raise SystemExit('✗ No encontré la hoja "%s" en el libro.' % HOJA)
    rels = z.read('xl/_rels/workbook.xml.rels').decode('utf8')
    m2 = re.search(r'<Relationship[^>]*Id="%s"[^>]*Target="([^"]+)"' % m.group(1), rels)
    if not m2:
        raise SystemExit('✗ La hoja "%s" no resuelve a un archivo.' % HOJA)
    destino = m2.group(1).lstrip('/')
    return destino if destino.startswith('xl/') else 'xl/' + destino


def buscar_tabla(z, hoja_path):
    """Devuelve (ruta_tabla_xml, xml) de la tabla de la hoja que arranca en C20."""
    rels_path = hoja_path.replace('xl/worksheets/', 'xl/worksheets/_rels/') + '.rels'
    candidatas = []
    if rels_path in z.namelist():
        rels = z.read(rels_path).decode('utf8')
        for t in re.findall(r'Target="([^"]*tables/table\d+\.xml)"', rels):
            candidatas.append('xl/' + t.replace('../', ''))
    if not candidatas:
        candidatas = [n for n in z.namelist() if n.startswith('xl/tables/table')]
    for ruta in candidatas:
        xml = z.read(ruta).decode('utf8')
        m = re.search(r'<table [^>]*ref="([A-Z]+%d:[A-Z]+\d+)"' % FILA_ENC, xml)
        if m and m.group(1).startswith('C%d' % FILA_ENC):
            return ruta, xml
    raise SystemExit('✗ No encontré la tabla de la hoja "%s" (la que arranca en C%d).' % (HOJA, FILA_ENC))


def main():
    if len(sys.argv) < 2:
        raise SystemExit(__doc__)
    src = Path(sys.argv[1])
    if not src.exists():
        raise SystemExit('✗ No existe: %s' % src)
    out = Path(sys.argv[2]) if len(sys.argv) > 2 else src.with_name(src.stem + ' (con vertedero)' + src.suffix)

    z = zipfile.ZipFile(src, 'r')
    hoja_path = buscar_hoja(z)
    tabla_path, tbl = buscar_tabla(z, hoja_path)
    sh = z.read(hoja_path).decode('utf8')

    nombres = re.findall(r'<tableColumn [^>]*name="([^"]*)"', tbl)
    if any(re.search(r'vertedero', n, re.I) for n in nombres):
        letra = col_letra(col_num('C') + nombres.index(
            next(n for n in nombres if re.search(r'vertedero', n, re.I))))
        print('✓ El archivo YA tiene la columna VERTEDERO (columna %s). No se tocó nada.' % letra)
        print('  Copiando igual a: %s' % out)
        z.close()
        shutil.copy2(src, out)
        return

    # ── dónde va la columna nueva: justo después de la última de la tabla ──
    m_ref = re.search(r'<table [^>]*ref="C%d:([A-Z]+)(\d+)"' % FILA_ENC, tbl)
    ult_letra, ult_fila = m_ref.group(1), m_ref.group(2)
    nueva = col_letra(col_num(ult_letra) + 1)
    ref_viejo = 'C%d:%s%s' % (FILA_ENC, ult_letra, ult_fila)
    ref_nuevo = 'C%d:%s%s' % (FILA_ENC, nueva, ult_fila)

    # ── table*.xml: rango, autofiltro, cantidad de columnas, columna nueva ──
    tbl = tbl.replace('ref="%s"' % ref_viejo, 'ref="%s"' % ref_nuevo)   # tabla + autoFilter
    m_cnt = re.search(r'<tableColumns count="(\d+)"', tbl)
    tbl = tbl.replace(m_cnt.group(0), '<tableColumns count="%d"' % (int(m_cnt.group(1)) + 1))
    ids = [int(i) for i in re.findall(r'<tableColumn id="(\d+)"', tbl)]
    nuevo_id = max(ids) + 1 if ids else 1
    m_dxf = re.search(r'dataDxfId="(\d+)"[^>]*/>\s*</tableColumns>', tbl)
    dxf = ' dataDxfId="%s"' % m_dxf.group(1) if m_dxf else ''
    tbl = tbl.replace('</tableColumns>',
                      '<tableColumn id="%d" name="VERTEDERO"%s/></tableColumns>' % (nuevo_id, dxf))

    # ── sheet*.xml: dimensión, spans de la fila de encabezados, celda del encabezado ──
    m_dim = re.search(r'<dimension ref="([A-Z]+\d+):([A-Z]+)(\d+)"/>', sh)
    if m_dim and col_num(m_dim.group(2)) < col_num(nueva):
        sh = sh.replace(m_dim.group(0), '<dimension ref="%s:%s%s"/>' % (
            m_dim.group(1), nueva, m_dim.group(3)))
    m_row = re.search(r'<row r="%d"([^>]*)spans="(\d+):(\d+)"' % FILA_ENC, sh)
    if m_row and int(m_row.group(3)) < col_num(nueva):
        sh = sh.replace(m_row.group(0), '<row r="%d"%sspans="%s:%d"' % (
            FILA_ENC, m_row.group(1), m_row.group(2), col_num(nueva)))
    # el encabezado copia el ESTILO de la última celda de encabezado (para que no desentone)
    m_ult = re.search(r'<c r="%s%d"(?: s="(\d+)")?[^>]*>' % (ult_letra, FILA_ENC), sh)
    if not m_ult:
        raise SystemExit('✗ No encontré la celda de encabezado %s%d.' % (ult_letra, FILA_ENC))
    estilo = ' s="%s"' % m_ult.group(1) if m_ult.group(1) else ''
    celda = '<c r="%s%d"%s t="inlineStr"><is><t>VERTEDERO</t></is></c>' % (nueva, FILA_ENC, estilo)
    fin_ult = sh.index('</c>', sh.index(m_ult.group(0))) + 4
    sh = sh[:fin_ult] + celda + sh[fin_ult:]

    # ── lista desplegable (La Concepción / Resimara) sobre toda la columna de datos ──
    sqref = '%s%d:%s%s' % (nueva, FILA_ENC + 1, nueva, ult_fila)
    if '</x14:dataValidations>' in sh:
        dv = ('<x14:dataValidation type="list" allowBlank="1" showInputMessage="1" showErrorMessage="1">'
              '<x14:formula1><xm:f>"%s"</xm:f></x14:formula1>'
              '<xm:sqref>%s</xm:sqref></x14:dataValidation>') % (OPCIONES, sqref)
        sh = sh.replace('</x14:dataValidations>', dv + '</x14:dataValidations>')
        modo_dv = 'x14'
    else:
        dv = ('<dataValidation type="list" allowBlank="1" showInputMessage="1" showErrorMessage="1" '
              'sqref="%s"><formula1>"%s"</formula1></dataValidation>') % (sqref, OPCIONES)
        if '</dataValidations>' in sh:
            m_c = re.search(r'<dataValidations count="(\d+)"', sh)
            if m_c:
                sh = sh.replace(m_c.group(0), '<dataValidations count="%d"' % (int(m_c.group(1)) + 1))
            sh = sh.replace('</dataValidations>', dv + '</dataValidations>')
        else:
            # va después de la hoja de datos, antes de pageMargins (orden que exige el esquema)
            anchor = '<pageMargins' if '<pageMargins' in sh else '</worksheet>'
            sh = sh.replace(anchor, '<dataValidations count="1">' + dv + '</dataValidations>' + anchor, 1)
        modo_dv = 'estándar'

    # ── reescribir el .zip: TODO byte a byte salvo los dos XML (así el VBA no se toca) ──
    zout = zipfile.ZipFile(out, 'w', zipfile.ZIP_DEFLATED)
    for item in z.infolist():
        data = z.read(item.filename)
        if item.filename == tabla_path:
            data = tbl.encode('utf8')
        elif item.filename == hoja_path:
            data = sh.encode('utf8')
        zi = zipfile.ZipInfo(item.filename, date_time=item.date_time)
        zi.compress_type = item.compress_type
        zi.external_attr = item.external_attr
        zi.internal_attr = item.internal_attr
        zi.create_system = item.create_system
        zout.writestr(zi, data)
    zout.close()
    z.close()

    print('✓ Columna VERTEDERO agregada en la columna %s (desplegable %s: %s)' % (nueva, modo_dv, OPCIONES))
    print('  Hoja:   %s' % hoja_path)
    print('  Tabla:  %s  (%s → %s)' % (tabla_path, ref_viejo, ref_nuevo))
    print('  Salida: %s' % out)
    print('\nRecordá: la app busca la columna POR SU NOMBRE ("VERTEDERO"), no por la letra.')


if __name__ == '__main__':
    main()
