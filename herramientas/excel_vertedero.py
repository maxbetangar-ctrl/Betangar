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
OPCIONES = ['La Concepción', 'Resimara']

# El catálogo va en la hoja PARAMETROS, como TODOS los demás desplegables del libro
# (parroquia → PARAMETROS!$J$11:$J$50, ruta → $L$11:$L$61, mantenimiento → $P$11:$P$40…).
# Así, cuando aparezca un tercer vertedero se agrega ahí y el desplegable crece solo:
# la lista NO se clava dentro de la validación.
HOJA_PARAM = 'PARAMETROS'
PARAM_COL = 'Q'        # libre, justo después de P=MANTENIMIENTO (los títulos van en la fila 10)
PARAM_ENC = 10
PARAM_FIN = 20         # hasta dónde llega el rango del desplegable (sitio para 10 vertederos)


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


def buscar_hoja(z, nombre=HOJA):
    """Devuelve la ruta del XML de una hoja, por su nombre."""
    wbxml = z.read('xl/workbook.xml').decode('utf8')
    m = re.search(r'<sheet[^>]*name="%s"[^>]*r:id="(rId\d+)"' % re.escape(nombre), wbxml)
    if not m:
        raise SystemExit('✗ No encontré la hoja "%s" en el libro.' % nombre)
    rels = z.read('xl/_rels/workbook.xml.rels').decode('utf8')
    m2 = re.search(r'<Relationship[^>]*Id="%s"[^>]*Target="([^"]+)"' % m.group(1), rels)
    if not m2:
        raise SystemExit('✗ La hoja "%s" no resuelve a un archivo.' % HOJA)
    destino = m2.group(1).lstrip('/')
    return destino if destino.startswith('xl/') else 'xl/' + destino


def poner_celda(sh, col, fila, texto):
    """Escribe una celda de texto en una fila QUE YA EXISTE, respetando el orden de columnas
    (Excel exige que las celdas de una fila vengan ordenadas). Si la celda ya tiene algo, no
    la pisa. Devuelve (xml, escribió?)."""
    ref = '%s%d' % (col, fila)
    if re.search(r'<c r="%s"[ />]' % ref, sh):
        return sh, False                                   # ya existe: no se toca
    mrow = re.search(r'<row r="%d"[^>]*>' % fila, sh)
    if not mrow:
        return sh, False                                   # la fila no existe: no inventamos filas
    ini = mrow.end()
    fin = sh.index('</row>', ini)
    cuerpo, nueva = sh[ini:fin], '<c r="%s" t="inlineStr"><is><t>%s</t></is></c>' % (ref, texto)
    destino = col_num(col)
    pos = len(cuerpo)                                      # por defecto, al final de la fila
    for m in re.finditer(r'<c r="([A-Z]+)\d+"', cuerpo):
        if col_num(m.group(1)) > destino:
            pos = m.start(); break
    return sh[:ini] + cuerpo[:pos] + nueva + cuerpo[pos:] + sh[fin:], True


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

    param_path = buscar_hoja(z, HOJA_PARAM)
    par = z.read(param_path).decode('utf8')
    hechos, ref_viejo, ref_nuevo = [], None, None

    # ── 1) la columna VERTEDERO en la tabla de REGISTRO VIAJES ──
    nombres = re.findall(r'<tableColumn [^>]*name="([^"]*)"', tbl)
    m_ref = re.search(r'<table [^>]*ref="C%d:([A-Z]+)(\d+)"' % FILA_ENC, tbl)
    ult_letra, ult_fila = m_ref.group(1), m_ref.group(2)
    ya = [n for n in nombres if re.search(r'vertedero', n, re.I)]
    if ya:
        nueva = col_letra(col_num('C') + nombres.index(ya[0]))
        hechos.append('la columna VERTEDERO ya estaba (columna %s)' % nueva)
    else:
        nueva = col_letra(col_num(ult_letra) + 1)
        ref_viejo = 'C%d:%s%s' % (FILA_ENC, ult_letra, ult_fila)
        ref_nuevo = 'C%d:%s%s' % (FILA_ENC, nueva, ult_fila)
        # table*.xml: rango, autofiltro, cantidad de columnas, columna nueva
        tbl = tbl.replace('ref="%s"' % ref_viejo, 'ref="%s"' % ref_nuevo)   # tabla + autoFilter
        m_cnt = re.search(r'<tableColumns count="(\d+)"', tbl)
        tbl = tbl.replace(m_cnt.group(0), '<tableColumns count="%d"' % (int(m_cnt.group(1)) + 1))
        ids = [int(i) for i in re.findall(r'<tableColumn id="(\d+)"', tbl)]
        m_dxf = re.search(r'dataDxfId="(\d+)"[^>]*/>\s*</tableColumns>', tbl)
        dxf = ' dataDxfId="%s"' % m_dxf.group(1) if m_dxf else ''
        tbl = tbl.replace('</tableColumns>', '<tableColumn id="%d" name="VERTEDERO"%s/></tableColumns>'
                          % ((max(ids) + 1 if ids else 1), dxf))
        # sheet*.xml: dimensión, spans de la fila de encabezados, celda del encabezado
        m_dim = re.search(r'<dimension ref="([A-Z]+\d+):([A-Z]+)(\d+)"/>', sh)
        if m_dim and col_num(m_dim.group(2)) < col_num(nueva):
            sh = sh.replace(m_dim.group(0), '<dimension ref="%s:%s%s"/>' % (
                m_dim.group(1), nueva, m_dim.group(3)))
        m_row = re.search(r'<row r="%d"([^>]*)spans="(\d+):(\d+)"' % FILA_ENC, sh)
        if m_row and int(m_row.group(3)) < col_num(nueva):
            sh = sh.replace(m_row.group(0), '<row r="%d"%sspans="%s:%d"' % (
                FILA_ENC, m_row.group(1), m_row.group(2), col_num(nueva)))
        m_ult = re.search(r'<c r="%s%d"(?: s="(\d+)")?[^>]*>' % (ult_letra, FILA_ENC), sh)
        if not m_ult:
            raise SystemExit('✗ No encontré la celda de encabezado %s%d.' % (ult_letra, FILA_ENC))
        estilo = ' s="%s"' % m_ult.group(1) if m_ult.group(1) else ''
        fin_ult = sh.index('</c>', sh.index(m_ult.group(0))) + 4
        sh = (sh[:fin_ult] + '<c r="%s%d"%s t="inlineStr"><is><t>VERTEDERO</t></is></c>'
              % (nueva, FILA_ENC, estilo) + sh[fin_ult:])
        hechos.append('columna VERTEDERO agregada en la %s' % nueva)

    # ── 2) el CATÁLOGO en PARAMETROS (como parroquia, ruta, mantenimiento…) ──
    if re.search(r'<is><t>VERTEDERO</t>', par) or ('VERTEDERO' in par and PARAM_COL + str(PARAM_ENC) in par):
        hechos.append('el catálogo de PARAMETROS ya estaba')
    else:
        par, ok = poner_celda(par, PARAM_COL, PARAM_ENC, 'VERTEDERO')
        if not ok:
            raise SystemExit('✗ No pude escribir el título en %s!%s%d (¿la fila %d existe?).'
                             % (HOJA_PARAM, PARAM_COL, PARAM_ENC, PARAM_ENC))
        escritas = 0
        for i, opcion in enumerate(OPCIONES):
            par, ok = poner_celda(par, PARAM_COL, PARAM_ENC + 1 + i, opcion)
            escritas += 1 if ok else 0
        hechos.append('catálogo en %s!%s%d con %d vertedero(s)'
                      % (HOJA_PARAM, PARAM_COL, PARAM_ENC, escritas))

    # ── 3) el desplegable APUNTA AL CATÁLOGO (no a una lista clavada) ──
    sqref = '%s%d:%s%s' % (nueva, FILA_ENC + 1, nueva, ult_fila)
    rango = "%s!$%s$%d:$%s$%d" % (HOJA_PARAM, PARAM_COL, PARAM_ENC + 1, PARAM_COL, PARAM_FIN)
    # si ya había una validación nuestra (lista literal o rango viejo), se reemplaza
    sh_sin = re.sub(r'<x14:dataValidation[^>]*>(?:(?!</x14:dataValidation>).)*?'
                    r'<xm:sqref>%s</xm:sqref></x14:dataValidation>' % re.escape(sqref), '', sh, flags=re.S)
    if sh_sin != sh:
        sh, previa = sh_sin, True
    else:
        previa = False
    if '</x14:dataValidations>' in sh:
        dv = ('<x14:dataValidation type="list" allowBlank="1" showInputMessage="1" showErrorMessage="1">'
              '<x14:formula1><xm:f>%s</xm:f></x14:formula1>'
              '<xm:sqref>%s</xm:sqref></x14:dataValidation>') % (rango, sqref)
        sh = sh.replace('</x14:dataValidations>', dv + '</x14:dataValidations>')
    else:
        dv = ('<dataValidation type="list" allowBlank="1" showInputMessage="1" showErrorMessage="1" '
              'sqref="%s"><formula1>%s</formula1></dataValidation>') % (sqref, rango)
        if '</dataValidations>' in sh:
            m_c = re.search(r'<dataValidations count="(\d+)"', sh)
            if m_c:
                sh = sh.replace(m_c.group(0), '<dataValidations count="%d"' % (int(m_c.group(1)) + 1))
            sh = sh.replace('</dataValidations>', dv + '</dataValidations>')
        else:
            anchor = '<pageMargins' if '<pageMargins' in sh else '</worksheet>'
            sh = sh.replace(anchor, '<dataValidations count="1">' + dv + '</dataValidations>' + anchor, 1)
    hechos.append(('desplegable REAPUNTADO' if previa else 'desplegable creado') + ' a ' + rango)

    # ── reescribir el .zip: TODO byte a byte salvo los XML tocados (el VBA no se toca) ──
    cambios = {tabla_path: tbl, hoja_path: sh, param_path: par}
    zout = zipfile.ZipFile(out, 'w', zipfile.ZIP_DEFLATED)
    for item in z.infolist():
        data = cambios[item.filename].encode('utf8') if item.filename in cambios else z.read(item.filename)
        zi = zipfile.ZipInfo(item.filename, date_time=item.date_time)
        zi.compress_type = item.compress_type
        zi.external_attr = item.external_attr
        zi.internal_attr = item.internal_attr
        zi.create_system = item.create_system
        zout.writestr(zi, data)
    zout.close()
    z.close()

    for h in hechos:
        print('  ✓ ' + h)
    if ref_nuevo:
        print('  Tabla:  %s  (%s → %s)' % (tabla_path, ref_viejo, ref_nuevo))
    print('  Salida: %s' % out)
    print('\nPara agregar un vertedero nuevo: escribilo en PARAMETROS, columna %s (debajo de los'
          ' que ya están) y el desplegable lo toma solo.' % PARAM_COL)
    print('Recordá: la app busca la columna POR SU NOMBRE ("VERTEDERO"), no por la letra.')


if __name__ == '__main__':
    main()
