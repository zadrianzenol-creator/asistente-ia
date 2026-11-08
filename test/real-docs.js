'use strict';
/**
 * Prueba con un modelo REAL (no simulado) a través de la interfaz: documentos, OCR y creación de archivos.
 * Uso: GEMINI_API_KEY=... node test/real-docs.js     (consume cuota de tu clave; unas 8 peticiones)
 * En redes con proxy, añade NODE_USE_ENV_PROXY=1.
 */
const { chromium } = require('playwright');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path'), cp = require('node:child_process');
const { createApp, readConfig } = require('../server');
const FIX = path.join(__dirname, 'fixtures');
if (!process.env.GEMINI_API_KEY) { console.log('Define GEMINI_API_KEY para ejecutar esta prueba real.'); process.exit(0); }

let pass = 0, fail = 0;
const show = (t) => console.log('      ' + String(t).replace(/\s+/g, ' ').slice(0, 330));
async function step(name, fn) { try { await fn(); pass++; console.log('  ✓ ' + name); } catch (e) { fail++; console.log('  ✗ ' + name + '\n      ' + String(e.message).split('\n')[0]); } }
const ok = (c, m) => { if (!c) throw new Error(m); };

(async () => {
  const { server } = createApp(readConfig({ GEMINI_API_KEY: process.env.GEMINI_API_KEY, AI_FALLBACK: 'none' }));
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const dl = fs.mkdtempSync(path.join(os.tmpdir(), 'real-docs-'));
  const browser = await chromium.launch();
  const page = await (await browser.newContext({ viewport: { width: 1280, height: 800 }, acceptDownloads: true })).newPage();
  const errors = []; page.on('pageerror', (e) => errors.push(e.message)); page.on('console', (m) => m.type() === 'error' && errors.push(m.text())); page.on('dialog', (d) => d.accept());
  await page.goto(base); await page.waitForSelector('#input');
  const lastBot = () => page.locator('.msg.bot').last();
  const ask = async (files, text) => {
    await page.click('#newChat');
    if (files.length) { await page.setInputFiles('#fileInput', files.map((f) => path.join(FIX, f))); await page.waitForFunction((n) => document.querySelectorAll('.doc-card, .thumb').length >= n, files.length, { timeout: 40000 }); }
    await page.fill('#input', text); await page.keyboard.press('Enter');
    await page.waitForFunction(() => !document.querySelector('.msg.bot.streaming'), null, { timeout: 120000 });
    const err = await lastBot().locator('.errbox').count() ? await lastBot().locator('.errbox').innerText() : '';
    if (err) throw new Error('el modelo devolvió error: ' + err);
    return lastBot().innerText();
  };
  const download = async (clickFn, name) => { const [d] = await Promise.all([page.waitForEvent('download', { timeout: 40000 }), clickFn()]); const p = path.join(dl, name); await d.saveAs(p); return p; };
  const pause = () => page.waitForTimeout(2500);
  console.log('Prueba REAL con Gemini');

  await step('Word: lee el documento y detecta sus errores de ortografía', async () => {
    const t = await ask(['informe.docx'], '¿Qué errores de ortografía tiene el documento? Respóndelo en una sola línea.'); show(t);
    ok(/ortograf|ortográf|ortograficos|acento|tilde/i.test(t), 'no mencionó el error de «ortograficos»'); await pause();
  });

  await step('Word: «corrige el documento» → bloque de cambios válido → archivo editado que conserva el formato', async () => {
    const t = await ask(['informe.docx'], 'Corrige la ortografía y los acentos del documento y entrégamelo corregido.'); show(t);
    const box = lastBot().locator('.edits'); ok(await box.count() === 1, 'el modelo no devolvió un bloque de cambios utilizable (' + (await lastBot().locator('.code').count()) + ' bloques de código)');
    show('Resumen en pantalla: ' + await box.innerText());
    const f = await download(() => box.locator('[data-act="applyedits"]').click(), 'real-editado.docx');
    const py = process.env.PYTHON || 'python3';
    const r = cp.spawnSync(py, ['-c', `
import docx, zipfile, sys
o = docx.Document(sys.argv[1]); e = docx.Document(sys.argv[2])
def paras(d):
    out = [p.text for p in d.paragraphs]
    for t in d.tables:
        for row in t.rows:
            for c in row.cells: out += [p.text for p in c.paragraphs]
    return out
a, b = paras(o), paras(e)
zo, ze = zipfile.ZipFile(sys.argv[1]), zipfile.ZipFile(sys.argv[2])
print('MISMOS_PARRAFOS=%s' % (len(a) == len(b)))
for x, y in zip(a, b):
    if x != y: print('CAMBIO: %r -> %r' % (x, y))
print('PARTES_IDENTICAS=%s IMAGENES=%d ENCABEZADO=%r' % (all(zo.read(n) == ze.read(n) for n in zo.namelist() if n != 'word/document.xml'), len(e.inline_shapes), e.sections[0].header.paragraphs[0].text))
`, path.join(FIX, 'informe.docx'), f], { encoding: 'utf8' });
    show(r.stdout || r.stderr); ok(/MISMOS_PARRAFOS=True/.test(r.stdout) && /PARTES_IDENTICAS=True IMAGENES=1/.test(r.stdout), 'el archivo editado no conservó la estructura'); ok(/CAMBIO/.test(r.stdout), 'no cambió ningún párrafo'); await pause();
  });

  await step('Excel: calcula el total general a partir de la hoja', async () => {
    const t = await ask(['datos-calculado.xlsx'], 'Suma toda la columna Total de la hoja Ventas. Responde solo con el número.'); show(t);
    ok(/\b68\b/.test(t), 'el total correcto es 68'); await pause();
  });

  await step('PDF escaneado: lee el texto de la imagen con visión (OCR) y responde preguntas', async () => {
    const t = await ask(['escaneado.pdf'], '¿Quién es el cliente y cuál es el monto total del contrato?'); show(t);
    ok(/Gonz[aá]lez/i.test(t) && /4\s?\.?500/.test(t), 'no leyó el cliente o el monto del escaneo'); await pause();
  });

  await step('PowerPoint: «crea una presentación» → se descarga un .pptx con varias diapositivas', async () => {
    const t = await ask([], 'Crea una presentación de 4 diapositivas sobre los beneficios del reciclaje.'); show(t);
    await lastBot().hover(); await lastBot().locator('[data-act="export"]').click();
    const f = await download(() => page.click('#exportMenu [data-fmt="pptx"]'), 'real.pptx');
    const r = cp.spawnSync(process.env.PYTHON || 'python3', ['-c', 'import pptx,sys; p=pptx.Presentation(sys.argv[1]); print(len(p.slides)); [print("  -", next((s.text_frame.text for s in sl.shapes if s.has_text_frame and s.text_frame.text.strip()), "")) for sl in p.slides]', f], { encoding: 'utf8' });
    show(r.stdout.replace(/\n/g, ' | ')); ok(parseInt(r.stdout, 10) >= 3, 'pocas diapositivas'); await pause();
  });

  await step('Excel: «haz una tabla» → se descarga un .xlsx con celdas numéricas', async () => {
    const t = await ask([], 'Haz una tabla con 4 frutas, su precio por kilo en dólares y sus calorías por 100 g.'); show(t);
    await lastBot().hover(); await lastBot().locator('[data-act="export"]').click();
    const f = await download(() => page.click('#exportMenu [data-fmt="xlsx"]'), 'real.xlsx');
    const r = cp.spawnSync(process.env.PYTHON || 'python3', ['-c', 'import openpyxl,sys; ws=openpyxl.load_workbook(sys.argv[1]).active; [print(list(r)) for r in ws.iter_rows(values_only=True)]', f], { encoding: 'utf8' });
    show(r.stdout.replace(/\n/g, ' | ')); ok(/\d/.test(r.stdout) && r.stdout.split('\n').filter(Boolean).length >= 4, 'tabla vacía'); await pause();
  });

  await step('Word APA 7: un ensayo breve se descarga con Times New Roman, doble espacio y sección de referencias', async () => {
    const t = await ask([], 'Escribe un ensayo breve de 3 párrafos en formato APA 7 sobre la importancia del sueño en el aprendizaje. Incluye citas autor-fecha y una sección Referencias.'); show(t.slice(0, 200));
    await lastBot().hover(); await lastBot().locator('[data-act="export"]').click();
    if ((await page.getAttribute('#exportMenu [data-apa]', 'aria-checked')) !== 'true') await page.click('#exportMenu [data-apa]');
    const f = await download(() => page.click('#exportMenu [data-fmt="docx"]'), 'real-apa.docx');
    const r = cp.spawnSync(process.env.PYTHON || 'python3', ['-c', `
import docx, sys, zipfile, re
d = docx.Document(sys.argv[1]); z = zipfile.ZipFile(sys.argv[1]); st = z.read('word/styles.xml').decode()
print('TIMES=%s DOBLE=%s PARRAFOS=%d REFERENCIAS=%s' % ('Times New Roman' in st, 'w:line="480"' in st, len([p for p in d.paragraphs if p.text.strip()]), any(re.match(r'(?i)referencias', p.text.strip()) for p in d.paragraphs)))
`, f], { encoding: 'utf8' });
    show(r.stdout); ok(/TIMES=True DOBLE=True/.test(r.stdout) && /REFERENCIAS=True/.test(r.stdout), 'formato APA incompleto');
    console.log('      Aviso: revisa que las referencias que escribió el modelo existan; los modelos pueden inventarlas.');
  });

  await step('sin errores de JavaScript ni violaciones de CSP', async () => { const real = errors.filter((e) => !/Failed to load resource/.test(e)); ok(!real.length, real.join(' | ')); });

  await browser.close(); server.closeAllConnections(); server.close(); fs.rmSync(dl, { recursive: true, force: true });
  console.log(`\n${pass} correctas, ${fail} con fallo`); process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
