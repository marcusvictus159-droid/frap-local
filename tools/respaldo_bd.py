#!/usr/bin/env python3
"""
respaldo_bd.py — convierte el respaldo SQL (phpMyAdmin / mysqldump) del sistema
FRAP Digital anterior en archivos que se pueden abrir sin MySQL:

    respaldo/csv/<tabla>.csv      una por tabla (UTF-8 con BOM, abre bien en Excel)
    respaldo/historial.xlsx       un libro con una hoja por tabla
    respaldo/resumen.txt          cuántas filas tiene cada tabla

Uso:
    python3 tools/respaldo_bd.py ruta/al/respaldo.sql [carpeta_de_salida]

Notas importantes
  * NO exporta contraseñas (la columna `password` se omite siempre).
  * El resultado contiene datos de pacientes: guárdalo en un lugar privado y
    NUNCA lo subas a GitHub (el .gitignore de este proyecto ya excluye la
    carpeta `respaldo/`).
  * Solo usa la biblioteca estándar; el .xlsx requiere `openpyxl`
    (pip install openpyxl). Si no está instalada, solo se generan los CSV.
"""
import csv
import os
import re
import sys

OMITIR_COLUMNAS = {"password"}

ESCAPES = {"n": "\n", "r": "\r", "t": "\t", "0": "\0", "b": "\b", "Z": "\x1a", "\\": "\\", "'": "'", '"': '"', "%": "\\%", "_": "\\_"}


def leer_valores(texto, i):
    """Lee una lista de tuplas SQL a partir de la posición i (después de VALUES).
    Devuelve (filas, posición_final)."""
    n = len(texto)
    filas = []
    while i < n:
        c = texto[i]
        if c == ";":
            return filas, i + 1
        if c != "(":
            i += 1
            continue
        i += 1
        fila = []
        while True:
            while texto[i] in " \t\r\n":
                i += 1
            c = texto[i]
            if c == "'":
                i += 1
                buf = []
                while True:
                    c = texto[i]
                    if c == "\\":
                        i += 1
                        buf.append(ESCAPES.get(texto[i], texto[i]))
                    elif c == "'":
                        if texto[i + 1:i + 2] == "'":
                            buf.append("'")
                            i += 1
                        else:
                            i += 1
                            break
                    else:
                        buf.append(c)
                    i += 1
                fila.append("".join(buf))
            else:
                j = i
                while texto[j] not in ",)":
                    j += 1
                bruto = texto[i:j].strip()
                i = j
                fila.append(None if bruto.upper() == "NULL" else bruto)
            while texto[i] in " \t\r\n":
                i += 1
            if texto[i] == ",":
                i += 1
                continue
            if texto[i] == ")":
                i += 1
                break
            raise ValueError("Formato inesperado cerca de: " + texto[i - 40:i + 40])
        filas.append(fila)
    return filas, i


def leer_dump(ruta):
    texto = open(ruta, encoding="utf8", errors="replace").read()
    tablas = {}
    for m in re.finditer(r"INSERT INTO `([^`]+)` \(([^)]*)\) VALUES", texto):
        nombre = m.group(1)
        columnas = [c.strip().strip("`") for c in m.group(2).split(",")]
        filas, _ = leer_valores(texto, m.end())
        t = tablas.setdefault(nombre, {"columnas": columnas, "filas": []})
        for f in filas:
            if len(f) != len(columnas):
                raise ValueError(f"{nombre}: una fila trae {len(f)} valores y hay {len(columnas)} columnas")
            t["filas"].append(f)
    # Tablas que existen pero no tienen datos
    for m in re.finditer(r"CREATE TABLE `([^`]+)` \((.*?)\n\) ENGINE", texto, flags=re.S):
        if m.group(1) not in tablas:
            cols = re.findall(r"^\s+`([^`]+)`", m.group(2), flags=re.M)
            tablas[m.group(1)] = {"columnas": cols, "filas": []}
    return tablas


def main():
    if len(sys.argv) < 2:
        print(__doc__)
        sys.exit(1)
    ruta = sys.argv[1]
    salida = sys.argv[2] if len(sys.argv) > 2 else "respaldo"
    carpeta_csv = os.path.join(salida, "csv")
    os.makedirs(carpeta_csv, exist_ok=True)

    tablas = leer_dump(ruta)
    resumen = []
    limpias = {}
    for nombre, t in sorted(tablas.items()):
        idx = [k for k, c in enumerate(t["columnas"]) if c not in OMITIR_COLUMNAS]
        cols = [t["columnas"][k] for k in idx]
        filas = [[f[k] for k in idx] for f in t["filas"]]
        limpias[nombre] = (cols, filas)
        with open(os.path.join(carpeta_csv, nombre + ".csv"), "w", newline="", encoding="utf-8-sig") as fh:
            w = csv.writer(fh)
            w.writerow(cols)
            w.writerows(["" if v is None else v for v in fila] for fila in filas)
        omitidas = [c for c in t["columnas"] if c in OMITIR_COLUMNAS]
        resumen.append(f"{nombre}: {len(filas)} filas" + (f"  (columna omitida: {', '.join(omitidas)})" if omitidas else ""))

    try:
        from openpyxl import Workbook
        from openpyxl.styles import Font, PatternFill
        from openpyxl.utils import get_column_letter
        libro = Workbook()
        libro.remove(libro.active)
        for nombre, (cols, filas) in limpias.items():
            hoja = libro.create_sheet(nombre[:31])
            hoja.append(cols)
            for celda in hoja[1]:
                celda.font = Font(bold=True, color="FFFFFF")
                celda.fill = PatternFill("solid", fgColor="CC0000")
            for fila in filas:
                hoja.append([("" if v is None else (v if len(v) < 32000 else v[:32000])) for v in fila])
            hoja.freeze_panes = "A2"
            for k, c in enumerate(cols, start=1):
                ancho = max([len(str(c))] + [min(len(str(f[k - 1] or "")), 40) for f in filas[:200]]) + 2
                hoja.column_dimensions[get_column_letter(k)].width = min(ancho, 45)
        libro.save(os.path.join(salida, "historial.xlsx"))
        resumen.append("Excel: historial.xlsx")
    except ImportError:
        resumen.append("Excel: no se generó (instala openpyxl con: pip install openpyxl)")

    with open(os.path.join(salida, "resumen.txt"), "w", encoding="utf8") as fh:
        fh.write("\n".join(resumen) + "\n")
    print("\n".join(resumen))
    print("\nListo. Carpeta:", os.path.abspath(salida))


if __name__ == "__main__":
    main()
