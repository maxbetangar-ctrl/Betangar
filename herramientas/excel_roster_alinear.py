#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Alinea la LISTA MAESTRA DE AYUDANTES de la hoja PARAMETROS (columnas AF y AL).

QUÉ PASÓ (2026-08-06)
---------------------
La lista maestra de ayudantes son DOS columnas que se leen en paralelo:

    AF = nombre corto (el que la secretaria escribe en REGISTRO VIAJES)
    AL = nombre completo (el que la app guarda en la planilla)

Alguien insertó `ALEXANDER HERNANDEZ` en la fila 34 **solo en AF**. La columna AL
no se movió, así que de la fila 34 hacia abajo las dos columnas quedaron corridas
una fila entre sí:

    fila | AF (corto)              | AL (completo)                      | -> la app entendía
    -----|-------------------------|------------------------------------|--------------------
      34 | ALEXANDER HERNANDEZ     | ALEXANDER ARTURO PAZ GONZALEZ      | Hernández = Paz
      35 | ALEXANDER PAZ           | CARLOS ALFREDO MONTIEL VILLALOBOS  | Paz = Montiel
      36 | CARLOS ALFREDO  MONTIEL | (vacío)                            | Montiel = sin ficha

Consecuencias reales, medidas contra la base el 2026-08-06:
  · 24 planillas donde el Excel decía ALEXANDER PAZ se guardaron a nombre de
    CARLOS ALFREDO MONTIEL VILLALOBOS.
  · 16 planillas de Montiel quedaron con la grafía corta sin expandir (AL vacío →
    la app cae a `completo = corto`), que es lo que creó la ficha duplicada E342
    sin cédula.
  · `ALEXANDER HERNANDEZ` apuntaba a dos personas distintas (al chofer Hernández
    Prieto en la lista de choferes y a Paz en la de ayudantes). De ahí salió el
    bug de las 47 planillas del 04/08: el código ya aprendió a ABSTENERSE ante esa
    colisión, pero la colisión nacía acá.

NO es un error de la hoja REGISTRO VIAJES: ahí los nombres siempre estuvieron bien
(verificado: 1.297 filas, 0 diferencias en chofer y 0 en viajes contra la base).

QUÉ HACE ESTA HERRAMIENTA
-------------------------
Reescribe TRES celdas de la hoja PARAMETROS y nada más:

    AL34 = ALEXANDER ENRIQUE HERNANDEZ PRIETO   (el mismo completo que ya declara
                                                 la lista de CHOFEREs para ese
                                                 nombre corto — no se inventa uno)
    AL35 = ALEXANDER ARTURO PAZ GONZALEZ
    AL36 = CARLOS ALFREDO MONTIEL VILLALOBOS

POR QUÉ PARCHEA EL ZIP Y NO USA openpyxl
----------------------------------------
El libro es .xlsm: tiene macros (vbaProject.bin), tablas, validaciones y
extensiones que openpyxl no sabe reescribir (avisa "Data Validation extension is
not supported and will be removed"). Se copia el .zip entrada byte a byte y se
cambia UN solo XML, igual que `excel_vertedero.py`.

USO
---
    python herramientas/excel_roster_alinear.py "ENTRADA.xlsm" ["SALIDA.xlsm"]

Es IDEMPOTENTE: si el roster ya está alineado, avisa y no escribe nada.
No modifica la entrada: siempre escribe un archivo nuevo.

NOTA: el .xlsm con datos reales NO va al repositorio (este repo es público).
Solo vive acá la herramienta.
"""
import html
import re
import shutil
import sys
import zipfile
from pathlib import Path

HOJA = 'PARAMETROS'
# Estado final del bloque de ayudantes, confirmado por Alejandra (QA/RRHH) el 2026-08-06:
#   «Alexander Hernandez debe de estar en Chofer».
# La fila 34 se VACÍA entera (corto, estado y completo): era el renglón insertado por error que
# corrió las dos columnas. Él ya está en la lista de CHOFEREs (AA22 → ALEXANDER ENRIQUE HERNANDEZ
# PRIETO), que es donde va. Dejarlo también acá lo volvía "multicargo" y mantenía vivo el nombre
# corto ambiguo que originó el bug de las 47 planillas.
# `leerRoster` recorre las filas 11..80 y salta las que tienen el corto vacío, así que el hueco
# no molesta: no hace falta subir las de abajo.
VACIAR = {34: ['AF', 'AG', 'AL']}
# Fila → nombre completo que DEBE quedar en la columna AL.
ESPERADO = {
    35: 'ALEXANDER ARTURO PAZ GONZALEZ',
    36: 'CARLOS ALFREDO MONTIEL VILLALOBOS',
}
COL = 'AL'


def hoja_xml(z, nombre):
    """Devuelve la ruta del XML de la hoja `nombre` (vía workbook.xml + rels)."""
    wb = z.read('xl/workbook.xml').decode('utf8')
    m = re.search(r'<sheet[^>]*name="%s"[^>]*r:id="([^"]+)"' % re.escape(nombre), wb)
    if not m:
        raise SystemExit('No encuentro la hoja %s' % nombre)
    rid = m.group(1)
    rels = z.read('xl/_rels/workbook.xml.rels').decode('utf8')
    m2 = re.search(r'<Relationship[^>]*Id="%s"[^>]*Target="([^"]+)"' % rid, rels)
    if not m2:
        raise SystemExit('No encuentro el destino de %s' % rid)
    return 'xl/' + m2.group(1).lstrip('/')


def sst_indice(z):
    """{texto: índice} de las cadenas compartidas, para no inventar strings nuevos."""
    try:
        sst = z.read('xl/sharedStrings.xml').decode('utf8')
    except KeyError:
        return {}
    idx = {}
    for i, si in enumerate(re.findall(r'<si>(.*?)</si>', sst, re.S)):
        idx.setdefault(html.unescape(re.sub(r'<.*?>', '', si)), i)
    return idx


def valor_celda(xml, ref, sst_inv):
    """Texto actual de la celda `ref` (o None si no existe)."""
    m = re.search(r'<c r="%s"[^>]*?(?:/>|>(.*?)</c>)' % ref, xml, re.S)
    if not m or not m.group(1):
        return None
    cel = m.group(0)
    v = re.search(r'<v>(.*?)</v>', m.group(1), re.S)
    if not v:
        return None
    if 't="s"' in cel:
        return sst_inv.get(int(v.group(1)))
    return html.unescape(v.group(1))


def borrar_celda(xml, ref):
    """Deja `ref` sin contenido. La celda se quita entera: Excel trata una celda ausente
    como vacía, y así no queda un `<v>` huérfano apuntando a una cadena compartida."""
    return re.sub(r'<c r="%s"[^>]*?(?:/>|>.*?</c>)' % ref, '', xml, count=1, flags=re.S)


def escribir_celda(xml, fila, ref, texto, sst):
    """Deja `ref` con `texto`. Usa la cadena compartida si existe; si no, inline."""
    if texto in sst:
        nueva = '<c r="%s" t="s"><v>%d</v></c>' % (ref, sst[texto])
    else:
        nueva = '<c r="%s" t="inlineStr"><is><t>%s</t></is></c>' % (
            ref, html.escape(texto))

    # ¿ya existe la celda? -> reemplazar en el sitio (conserva el orden de columnas)
    pat = re.compile(r'<c r="%s"[^>]*?(?:/>|>.*?</c>)' % ref, re.S)
    if pat.search(xml):
        return pat.sub(nueva, xml, count=1)

    # no existe -> insertarla al final de su fila (AL es la última columna usada)
    mfila = re.search(r'(<row r="%d"[^>]*>)(.*?)(</row>)' % fila, xml, re.S)
    if not mfila:
        raise SystemExit('La fila %d no existe en la hoja' % fila)
    return xml[:mfila.start()] + mfila.group(1) + mfila.group(2) + nueva + \
        mfila.group(3) + xml[mfila.end():]


def main():
    if len(sys.argv) < 2:
        raise SystemExit(__doc__)
    entrada = Path(sys.argv[1])
    if len(sys.argv) > 2:
        salida = Path(sys.argv[2])
    else:
        salida = entrada.with_name(entrada.stem + ' - ROSTER ALINEADO' + entrada.suffix)

    with zipfile.ZipFile(entrada) as z:
        ruta = hoja_xml(z, HOJA)
        sst = sst_indice(z)
        sst_inv = {v: k for k, v in sst.items()}
        xml = z.read(ruta).decode('utf8')

        actual = {f: valor_celda(xml, COL + str(f), sst_inv) for f in ESPERADO}
        vaciar_actual = {(f, c): valor_celda(xml, c + str(f), sst_inv)
                         for f, cols in VACIAR.items() for c in cols}
        if (all(actual[f] == ESPERADO[f] for f in ESPERADO)
                and not any(vaciar_actual.values())):
            print('✓ El roster YA está alineado. No se escribe nada.')
            return

        print('Hoja %s → %s' % (HOJA, ruta))
        for (f, c), v in sorted(vaciar_actual.items()):
            if v is None:
                continue
            print('  %s%d: %r  →  (vacío)' % (c, f, v))
            xml = borrar_celda(xml, c + str(f))
        for f in sorted(ESPERADO):
            print('  %s%d: %r  →  %r' % (COL, f, actual[f], ESPERADO[f]))
            xml = escribir_celda(xml, f, COL + str(f), ESPERADO[f], sst)

        # Copia byte a byte cambiando SOLO ese XML (así el VBA y todo lo demás
        # llegan intactos; recomprimir el libro entero con openpyxl los pierde).
        with zipfile.ZipFile(salida, 'w', zipfile.ZIP_DEFLATED) as out:
            for it in z.infolist():
                datos = xml.encode('utf8') if it.filename == ruta else z.read(it.filename)
                out.writestr(it, datos)

    # Verificación POST: releer el archivo escrito y comprobar las tres celdas.
    with zipfile.ZipFile(salida) as z2:
        sst2 = sst_indice(z2)
        inv2 = {v: k for k, v in sst2.items()}
        x2 = z2.read(hoja_xml(z2, HOJA)).decode('utf8')
        malas = [f for f in ESPERADO
                 if valor_celda(x2, COL + str(f), inv2) != ESPERADO[f]]
        malas += ['%s%d' % (c, f) for f, cols in VACIAR.items() for c in cols
                  if valor_celda(x2, c + str(f), inv2) is not None]
    if malas:
        raise SystemExit('✗ No quedó bien en las filas %s' % malas)
    print('✓ Verificado sobre el archivo escrito: %s' % salida)


if __name__ == '__main__':
    main()
