"""Valida con librerías de terceros los archivos descargados por test/e2e-docs.js. Salida: JSON. Código 2 = faltan librerías."""
import sys, json, zipfile, os
try:
    import docx, openpyxl, pptx, pypdf
except ImportError as e:
    print(json.dumps({'missing': str(e)})); sys.exit(2)

d = sys.argv[1]; fix = sys.argv[2]; R = {}

# 1) Word editado vs original
orig = docx.Document(os.path.join(fix, 'informe.docx')); ed = docx.Document(os.path.join(d, 'informe-editado.docx'))
def allparas(doc):
    out = [p.text for p in doc.paragraphs]
    for t in doc.tables:
        for row in t.rows:
            for c in row.cells: out += [p.text for p in c.paragraphs]
    return out
a, b = allparas(orig), allparas(ed)
R['editado'] = {
  'mismos_parrafos': len(a) == len(b),
  'cambiados': [i for i, (x, y) in enumerate(zip(a, b)) if x != y],
  'p2_nuevo': next((y for x, y in zip(a, b) if x.startswith('Este documento')), None),
  'celda_valor': ed.tables[0].cell(1, 1).text,
  'encabezado': ed.sections[0].header.paragraphs[0].text, 'pie': ed.sections[0].footer.paragraphs[0].text,
  'imagenes': len(ed.inline_shapes), 'margen_izq_pulg': round(ed.sections[0].left_margin.inches, 2),
  'estilo_tabla': ed.tables[0].style.name, 'estilo_p1': ed.paragraphs[0].style.name,
  'p3_igual_y_sin_negrita': ed.paragraphs[2].text == orig.paragraphs[2].text,
}
zo, ze = zipfile.ZipFile(os.path.join(fix, 'informe.docx')), zipfile.ZipFile(os.path.join(d, 'informe-editado.docx'))
R['editado']['partes_identicas'] = all(zo.read(n) == ze.read(n) for n in zo.namelist() if n != 'word/document.xml')
R['editado']['mismas_partes'] = sorted(zo.namelist()) == sorted(ze.namelist())

# 2) Word generado
for name in ['informe-prueba.docx', 'informe-prueba-apa.docx']:
    p = os.path.join(d, name)
    if not os.path.exists(p): continue
    g = docx.Document(p); sty = [x.style.name for x in g.paragraphs if x.text.strip()]
    R[name] = {'tablas': len(g.tables), 'filas': len(g.tables[0].rows) if g.tables else 0, 'cols': len(g.tables[0].columns) if g.tables else 0,
               'estilos': sorted(set(sty)), 'titulo': g.paragraphs[0].text, 'celda': g.tables[0].cell(1, 0).text if g.tables else None,
               'listas': sum(1 for x in g.paragraphs if x.text.strip() in ('Punto uno', 'Punto dos'))}
# 3) Excel generado
p = os.path.join(d, 'informe-de-prueba.xlsx')
if os.path.exists(p):
    wb = openpyxl.load_workbook(p); ws = wb['Datos']
    R['xlsx'] = {'hojas': wb.sheetnames, 'filas': [list(r) for r in ws.iter_rows(values_only=True)], 'congelado': ws.freeze_panes}
# 4) PowerPoint generado
p = os.path.join(d, 'informe-de-prueba.pptx')
if os.path.exists(p):
    pr = pptx.Presentation(p); R['pptx'] = {'diapositivas': len(pr.slides), 'titulos': [next((sh.text_frame.text for sh in s.shapes if sh.has_text_frame and sh.text_frame.text.strip()), '') for s in pr.slides]}
# 5) PDF generado
p = os.path.join(d, 'informe-de-prueba.pdf')
if os.path.exists(p):
    r = pypdf.PdfReader(p); t = ''.join(pg.extract_text() for pg in r.pages); R['pdf'] = {'paginas': len(r.pages), 'titulo': r.metadata.title, 'texto_ok': all(s in t for s in ['Informe de prueba', 'Conclusi', 'Cuaderno'])}
print(json.dumps(R, ensure_ascii=False))
