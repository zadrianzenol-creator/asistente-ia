"""Genera los archivos de prueba de test/fixtures (requiere python-docx, openpyxl, python-pptx, pillow, img2pdf y LibreOffice)."""
import os, struct, zlib, subprocess, shutil, tempfile
from docx import Document
from docx.shared import Inches, Pt
import openpyxl
from pptx import Presentation
from PIL import Image, ImageDraw, ImageFont
import img2pdf

OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'fixtures'); os.makedirs(OUT, exist_ok=True)
tmp = tempfile.mkdtemp()

# imagen pequeña para insertar en el Word
im = Image.new('RGB', (120, 60), (51, 102, 153)); ImageDraw.Draw(im).text((10, 20), 'LOGO', fill='white'); png = os.path.join(tmp, 'logo.png'); im.save(png)

# --- informe.docx: estilos, negritas parciales, tabla, imagen, encabezado y pie, márgenes propios
d = Document()
sec = d.sections[0]; sec.left_margin = Inches(1.5); sec.right_margin = Inches(1.5)
sec.header.paragraphs[0].text = 'ENCABEZADO CONFIDENCIAL'; sec.footer.paragraphs[0].text = 'Pie de página de la empresa'
d.add_heading('Informe trimestral', level=1)                                   # P1
p = d.add_paragraph('Este documento contiene '); r = p.add_run('errores'); r.bold = True; p.add_run(' ortograficos y una frase mal escrita.')   # P2
d.add_paragraph('El segundo parrafo no necesita cambios y debe quedar identico.')   # P3
t = d.add_table(rows=2, cols=2); t.style = 'Table Grid'
for (i, j), v in {(0, 0): 'Concepto', (0, 1): 'Valor', (1, 0): 'Ventas', (1, 1): '100'}.items(): t.cell(i, j).text = v    # P4..P7
d.add_picture(png, width=Inches(1.2))
d.add_paragraph('Fin del informe.')                                            # P8
d.save(os.path.join(OUT, 'informe.docx'))

# --- datos.xlsx (sin valores en caché) y datos-calculado.xlsx (recalculado por LibreOffice)
wb = openpyxl.Workbook(); ws = wb.active; ws.title = 'Ventas'
ws.append(['Producto', 'Cantidad', 'Precio', 'Total'])
for i, (n, q, pr) in enumerate([('Lápiz', 10, 1.5), ('Cuaderno', 4, 3.25), ('Mochila', 2, 20)], start=2): ws.append([n, q, pr, f'=B{i}*C{i}'])
ws2 = wb.create_sheet('Notas'); ws2.append(['Nota']); ws2.append(['Datos de ejemplo, con ñ y acentos'])
wb.save(os.path.join(OUT, 'datos.xlsx'))
subprocess.run(['soffice', '--headless', '--convert-to', 'xlsx:Calc MS Excel 2007 XML', '--outdir', tmp, os.path.join(OUT, 'datos.xlsx')], capture_output=True, timeout=120)
shutil.copy(os.path.join(tmp, 'datos.xlsx'), os.path.join(OUT, 'datos-calculado.xlsx'))

# --- presentacion.pptx con notas
pr = Presentation(); s = pr.slides.add_slide(pr.slide_layouts[1]); s.shapes.title.text = 'Resultados'
s.placeholders[1].text_frame.text = 'Ventas +12%'; s.placeholders[1].text_frame.add_paragraph().text = 'Costos -3%'
s.notes_slide.notes_text_frame.text = 'Mencionar el crecimiento del segundo semestre'
s2 = pr.slides.add_slide(pr.slide_layouts[1]); s2.shapes.title.text = 'Próximos pasos'; s2.placeholders[1].text_frame.text = 'Contratar personal'
pr.save(os.path.join(OUT, 'presentacion.pptx'))

# --- PDF con texto (desde el docx) y PDF escaneado (solo imagen)
subprocess.run(['soffice', '--headless', '--convert-to', 'pdf', '--outdir', tmp, os.path.join(OUT, 'informe.docx')], capture_output=True, timeout=120)
shutil.copy(os.path.join(tmp, 'informe.pdf'), os.path.join(OUT, 'texto.pdf'))
sc = Image.new('RGB', (1240, 1754), 'white'); dr = ImageDraw.Draw(sc)
f = ImageFont.load_default(size=56)
for k, line in enumerate(['CONTRATO DE SERVICIOS', 'Cliente: Maria Gonzalez', 'Monto total: 4500 euros', 'Fecha de firma: 12 de marzo']): dr.text((100, 200 + k * 110), line, fill='black', font=f)
scan = os.path.join(tmp, 'scan.png'); sc.save(scan)
open(os.path.join(OUT, 'escaneado.pdf'), 'wb').write(img2pdf.convert(scan))

open(os.path.join(OUT, 'viejo.doc'), 'wb').write(b'\xd0\xcf\x11\xe0 documento antiguo falso')
shutil.rmtree(tmp)
print('fixtures:', sorted(os.listdir(OUT)))
