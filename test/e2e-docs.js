'use strict';
/** Pruebas de navegador de documentos: leer Word/PDF/Excel/PowerPoint, escaneados, exportar y editar Word. */
const { chromium } = require('playwright');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path'), cp = require('node:child_process');
const { createApp, readConfig } = require('../server');
const { startMockGemini } = require('./mock-gemini');

let pass = 0, fail = 0, skipped = 0;
async function step(name, fn) { try { await fn(); pass++; console.log('  ✓ ' + name); } catch (e) { fail++; console.log('  ✗ ' + name + '\n      ' + String(e.message).split('\n')[0]); } }
const eq = (a, b, m) => { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error((m || 'valor') + ': esperado ' + JSON.stringify(b) + ', recibido ' + JSON.stringify(a)); };
const ok = (c, m) => { if (!c) throw new Error(m); };
const FIX = path.join(__dirname, 'fixtures');

(async () => {
  const gm = await startMockGemini();
  const { server } = createApp(readConfig({ GEMINI_API_KEY: 'test-key', GEMINI_API_BASE: gm.url, RATE_PER_MINUTE: '500', RATE_PER_DAY: '5000', RATE_GLOBAL_PER_DAY: '5000', MAX_CONCURRENT_PER_IP: '9' }));
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const dl = fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-docs-'));
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 780 }, acceptDownloads: true });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
  page.on('dialog', (d) => d.accept());
  const idle = () => page.waitForFunction(() => !document.querySelector('.msg.bot.streaming'), null, { timeout: 25000 });
  const lastBot = () => page.locator('.msg.bot').last();
  const sendMsg = async (t) => { await page.fill('#input', t); await page.keyboard.press('Enter'); };
  const lastReq = () => gm.requests[gm.requests.length - 1];
  const sentText = () => lastReq().body.contents.slice(-1)[0].parts.find((p) => p.text).text;
  const toastText = async () => { await page.waitForSelector('#toast.on'); return page.innerText('#toast'); };
  const attach = async (f) => { await page.setInputFiles('#fileInput', path.join(FIX, f)); };
  const download = async (clickFn, name) => { const [d] = await Promise.all([page.waitForEvent('download', { timeout: 30000 }), clickFn()]); const p = path.join(dl, name); await d.saveAs(p); return { p, suggested: d.suggestedFilename() }; };
  const exportAs = async (fmt, saveName) => {
    await lastBot().hover(); await lastBot().locator('[data-act="export"]').click();
    return download(() => page.click(`#exportMenu [data-fmt="${fmt}"]`), saveName);
  };

  console.log('E2E documentos');
  await page.goto(base); await page.waitForSelector('#input');

  await step('Word: se lee, muestra tarjeta con nº de párrafos y llega al modelo numerado y en etiquetas', async () => {
    await attach('informe.docx');
    await page.waitForSelector('.doc-card', { timeout: 20000 });
    ok((await page.innerText('.doc-card')).includes('informe.docx') && /párrafos/.test(await page.innerText('.doc-card')), 'tarjeta');
    await sendMsg('Resume el documento'); await idle();
    const t = sentText();
    ok(t.startsWith('<documento nombre="informe.docx">'), 'etiqueta'); ok(t.endsWith('Resume el documento'), 'pregunta al final');
    ok(t.includes('[P1] Informe trimestral') && t.includes('[P2] Este documento contiene errores ortograficos'), 'párrafos numerados');
    ok(/\[P4\] \(tabla\) Concepto/.test(t), 'celdas de tabla marcadas');
    ok(!t.includes('ENCABEZADO CONFIDENCIAL'), 'el encabezado no entra al contexto numerado');
    eq(await page.locator('.msg.user .doc-chip').count(), 1, 'chip del documento en el mensaje');
  });

  await step('Excel (con y sin valores en caché), CSV, PowerPoint y texto se leen a texto', async () => {
    await page.click('#newChat');
    await attach('datos.xlsx'); await page.waitForSelector('.doc-card'); await sendMsg('Analiza'); await idle();
    let t = sentText();
    ok(t.includes('## Hoja «Ventas» (4 filas × 4 columnas)') && t.includes('Lápiz,10,1.5,=B2*C2'), 'xlsx sin caché: muestra la fórmula'); ok(t.includes('## Hoja «Notas»') && t.includes('ñ'), 'segunda hoja y acentos');
    await page.click('#newChat'); await attach('datos-calculado.xlsx'); await page.waitForSelector('.doc-card'); await sendMsg('Analiza'); await idle();
    ok(sentText().includes('Cuaderno,4,3.25,13'), 'xlsx recalculado: muestra el valor de la fórmula (4×3.25=13)');
    await page.click('#newChat'); await attach('presentacion.pptx'); await page.waitForSelector('.doc-card'); await sendMsg('Resume'); await idle();
    t = sentText(); ok(t.includes('## Diapositiva 1') && t.includes('Resultados') && t.includes('Ventas +12%') && t.includes('Notas del orador: Mencionar el crecimiento'), 'pptx con notas'); ok(t.includes('## Diapositiva 2') && t.includes('Contratar personal'), 'segunda diapositiva');
    await page.click('#newChat');
    fs.writeFileSync(path.join(dl, 'tabla.csv'), 'nombre,edad\nAna,30\nLuis,25\n'); await page.setInputFiles('#fileInput', path.join(dl, 'tabla.csv'));
    await page.waitForSelector('.doc-card'); await sendMsg('Calcula el promedio'); await idle();
    ok(sentText().includes('nombre,edad\nAna,30'), 'csv tal cual'); ok(/3 filas/.test(await page.innerText('.msg.user .doc-chip')), 'detalle de filas');
  });

  await step('PDF con texto se lee por páginas; PDF escaneado pasa a imágenes para OCR con visión', async () => {
    await page.click('#newChat'); await attach('texto.pdf'); await page.waitForSelector('.doc-card', { timeout: 30000 }); await sendMsg('Resume el PDF'); await idle();
    const t = sentText(); ok(t.includes('--- Página 1 ---') && t.includes('Informe trimestral') && t.includes('errores ortograficos'), 'texto del PDF');
    await page.click('#newChat'); await attach('escaneado.pdf');
    await page.waitForSelector('.thumb', { timeout: 30000 });
    eq(await page.locator('.doc-card').count(), 0, 'no es documento de texto'); eq(await page.locator('.thumb').count(), 1, 'una página como imagen');
    ok((await toastText()).includes('escaneo'), 'aviso de escaneo');
    await sendMsg('Lee el contrato'); await idle();
    const parts = lastReq().body.contents.slice(-1)[0].parts;
    eq(parts.filter((p) => p.inlineData).length, 1, 'la página llegó como imagen'); eq(parts.find((p) => p.inlineData).inlineData.mimeType, 'image/jpeg');
  });

  await step('formatos no admitidos o inválidos: aviso claro sin romper nada', async () => {
    await page.click('#newChat');
    await attach('viejo.doc'); ok((await toastText()).includes('.docx'), 'Word antiguo');
    await page.waitForTimeout(2600);
    fs.writeFileSync(path.join(dl, 'roto.docx'), 'no soy un zip'); await page.setInputFiles('#fileInput', path.join(dl, 'roto.docx'));
    await page.waitForFunction(() => /dañado/.test(document.getElementById('toast').textContent));
    eq(await page.locator('.doc-card').count(), 0);
    await page.waitForTimeout(2600);
    fs.writeFileSync(path.join(dl, 'vacio.txt'), '   '); await page.setInputFiles('#fileInput', path.join(dl, 'vacio.txt'));
    await page.waitForFunction(() => /no contiene texto/.test(document.getElementById('toast').textContent));
  });

  await step('documento enorme: se recorta dentro del límite y se avisa; máximo 3 documentos', async () => {
    await page.click('#newChat');
    fs.writeFileSync(path.join(dl, 'enorme.txt'), 'línea de relleno número 1234567890\n'.repeat(8000));   // ~290 000 caracteres
    await page.setInputFiles('#fileInput', path.join(dl, 'enorme.txt')); await page.waitForSelector('.doc-card');
    await page.waitForFunction(() => /muy extenso/.test(document.getElementById('toast').textContent), null, { timeout: 8000 });
    await sendMsg('Resume'); await idle();
    const t = sentText(); ok(t.length < 125000 && t.includes('el documento continúa'), 'longitud enviada: ' + t.length);
    await page.click('#newChat');
    for (const f of ['informe.docx', 'datos.xlsx', 'presentacion.pptx']) { await attach(f); await page.waitForFunction((n) => document.querySelectorAll('.doc-card').length >= n, ['informe.docx', 'datos.xlsx', 'presentacion.pptx'].indexOf(f) + 1, { timeout: 20000 }); }
    await page.waitForTimeout(2600); await attach('texto.pdf');
    await page.waitForFunction(() => /Máximo 3 documentos/.test(document.getElementById('toast').textContent), null, { timeout: 8000 });
    eq(await page.locator('.doc-card').count(), 3);
    await page.fill('#input', ''); await page.click('#newChat');
  });

  await step('crear archivos: la respuesta se descarga como Word, PDF, Excel, PowerPoint y Markdown', async () => {
    await page.click('#newChat'); await sendMsg('EXPORT'); await idle();
    await lastBot().hover();
    const w = await exportAs('docx', 'informe-prueba.docx'); eq(w.suggested, 'informe-de-prueba.docx');
    const p = await exportAs('pdf', 'informe-de-prueba.pdf'); eq(p.suggested, 'informe-de-prueba.pdf');
    const x = await exportAs('xlsx', 'informe-de-prueba.xlsx'); eq(x.suggested, 'informe-de-prueba.xlsx');
    const s = await exportAs('pptx', 'informe-de-prueba.pptx'); eq(s.suggested, 'informe-de-prueba.pptx');
    const m = await exportAs('md', 'informe-de-prueba.md'); ok(fs.readFileSync(m.p, 'utf8').includes('# Informe de prueba'), 'markdown');
    // APA se recuerda y cambia el archivo
    await lastBot().locator('[data-act="export"]').click(); await page.click('#exportMenu [data-apa]');
    eq(await page.getAttribute('#exportMenu [data-apa]', 'aria-checked'), 'true');
    const a = await download(() => page.click('#exportMenu [data-fmt="docx"]'), 'informe-prueba-apa.docx'); eq(a.suggested, 'informe-de-prueba.docx');
    await lastBot().locator('[data-act="export"]').click(); await page.click('#exportMenu [data-apa]'); await page.keyboard.press('Escape');   // restaurar
  });

  await step('Excel sin tablas: aviso claro', async () => {
    await page.click('#newChat'); await sendMsg('hola sin tabla'); await idle();
    await lastBot().hover(); await lastBot().locator('[data-act="export"]').click(); await page.click('#exportMenu [data-fmt="xlsx"]');
    await page.waitForFunction(() => /no tiene tablas/.test(document.getElementById('toast').textContent), null, { timeout: 8000 });
  });

  await step('editar Word: resumen de cambios, y el archivo descargado conserva todo salvo los párrafos cambiados', async () => {
    await page.click('#newChat'); await attach('informe.docx'); await page.waitForSelector('.doc-card', { timeout: 20000 });
    await sendMsg('EDITS corrige la ortografía y cambia el valor a 150'); await idle();
    const box = lastBot().locator('.edits'); ok(await box.count() === 1, 'caja de cambios');
    ok((await box.innerText()).includes('3 párrafos') && (await box.innerText()).includes('P2'), 'resumen'); eq(await lastBot().locator('.code').count(), 0, 'el JSON no se muestra como código');
    const r = await download(() => box.locator('[data-act="applyedits"]').click(), 'informe-editado.docx'); eq(r.suggested, 'informe-editado.docx');
    await page.waitForFunction(() => /2 párrafos modificados · 1 no se pudieron aplicar/.test(document.getElementById('toast').textContent), null, { timeout: 8000 });
  });

  await step('el documento original sigue disponible tras recargar (para editar más tarde)', async () => {
    await page.reload(); await page.waitForSelector('.msg.bot .edits');
    ok(await page.locator('.msg.user .doc-chip').count() === 1, 'chip persistente');
    const r = await download(() => page.click('.edits [data-act="applyedits"]'), 'informe-editado-2.docx'); eq(r.suggested, 'informe-editado.docx');
    ok(fs.statSync(r.p).size > 5000, 'archivo no vacío');
  });

  await step('validación con python-docx, openpyxl, python-pptx y pypdf (lectores independientes)', async () => {
    const py = process.env.PYTHON || 'python3';
    const res = cp.spawnSync(py, [path.join(__dirname, 'validate_outputs.py'), dl, FIX], { encoding: 'utf8' });
    if (res.status === 2) { skipped++; console.log('      (omitida: faltan python-docx/openpyxl/python-pptx/pypdf; usa PYTHON=ruta/al/python)'); return; }
    ok(res.status === 0, 'validador falló: ' + (res.stderr || res.stdout).slice(0, 300));
    const R = JSON.parse(res.stdout), E = R.editado;
    eq(E.mismos_parrafos, true, 'mismo nº de párrafos'); eq(E.cambiados.length, 2, 'solo 2 párrafos cambian: ' + E.cambiados);
    ok(E.p2_nuevo.includes('ortográficos') && E.p2_nuevo.includes('corregida'), 'texto nuevo del P2'); eq(E.celda_valor, '150', 'celda de tabla');
    eq([E.encabezado, E.pie], ['ENCABEZADO CONFIDENCIAL', 'Pie de página de la empresa'], 'encabezado y pie'); eq(E.imagenes, 1, 'imagen'); eq(E.margen_izq_pulg, 1.5, 'márgenes');
    eq([E.estilo_tabla, E.estilo_p1], ['Table Grid', 'Heading 1'], 'estilos'); eq(E.p3_igual_y_sin_negrita, true);
    eq([E.partes_identicas, E.mismas_partes], [true, true], 'todas las demás partes del .docx idénticas byte a byte');
    for (const n of ['informe-prueba.docx', 'informe-prueba-apa.docx']) { const g = R[n]; eq([g.tablas, g.filas, g.cols, g.celda, g.listas], [1, 4, 3, 'Lápiz', 2], n); ok(g.estilos.includes('Title') && g.estilos.some((s) => /Heading/.test(s)), 'estilos de título en ' + n); }
    eq(R.xlsx.hojas, ['Datos'], 'hoja'); eq(R.xlsx.filas[1], ['Lápiz', 10, 1.5], 'fila con coma decimal'); eq(R.xlsx.filas[3][1], '=SUM(B2:B3)', 'fórmula'); eq(R.xlsx.congelado, 'A2', 'fila de encabezado fija');
    ok(R.pptx.diapositivas >= 3 && R.pptx.titulos[0] === 'Informe de prueba', 'pptx: ' + JSON.stringify(R.pptx)); eq(R.pdf.texto_ok, true, 'texto del PDF'); eq(R.pdf.titulo, 'Informe de prueba', 'título del PDF');
  });

  await step('eliminar el chat borra también los documentos y originales guardados', async () => {
    const count = () => page.evaluate(() => new Promise((res) => { const r = indexedDB.open('asistente-img', 1); r.onsuccess = () => { const q = r.result.transaction('imgs').objectStore('imgs').count(); q.onsuccess = () => res(q.result); }; }));
    ok(await count() > 0, 'hay datos guardados');
    for (let i = await page.locator('.row').count(); i > 0; i--) { await page.hover('.row'); await page.click('.row .more'); await page.click('#chatMenu [data-do="delete"]'); }
    await page.waitForTimeout(500); eq(await count(), 0, 'registros restantes');
  });

  await step('móvil: tarjetas de documento y menú de descarga sin desbordar', async () => {
    const m = await browser.newContext({ viewport: { width: 390, height: 780 }, deviceScaleFactor: 2 }); const p = await m.newPage(); await p.goto(base); await p.waitForSelector('#input');
    await p.setInputFiles('#fileInput', [path.join(FIX, 'informe.docx'), path.join(FIX, 'datos.xlsx')]); await p.waitForFunction(() => document.querySelectorAll('.doc-card').length === 2, null, { timeout: 20000 });
    await p.fill('#input', 'EXPORT'); await p.keyboard.press('Enter'); await p.waitForFunction(() => !document.querySelector('.msg.bot.streaming'), null, { timeout: 20000 });
    await p.locator('.msg.bot').last().locator('[data-act="export"]').click(); ok(await p.locator('#exportMenu').isVisible(), 'menú visible');
    const box = await p.locator('#exportMenu').boundingBox(); ok(box.x >= 0 && box.x + box.width <= 390 && box.y >= 0, 'el menú cabe en pantalla: ' + JSON.stringify(box));
    eq(await p.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true, 'sin overflow horizontal');
    await p.screenshot({ path: process.env.E2E_SHOT3 || '/tmp/e2e-docs-mobile.png' }); await m.close();
  });

  await step('sin errores de JavaScript ni violaciones de CSP en consola (incluido pdf.js y los workers)', async () => {
    const real = errors.filter((e) => !/Failed to load resource.*(4\d\d|5\d\d)|ERR_INTERNET|Failed to fetch/.test(e)); eq(real.join(' | '), '', 'errores');
  });

  await browser.close(); server.closeAllConnections(); server.close(); await gm.close(); fs.rmSync(dl, { recursive: true, force: true });
  console.log(`\n${pass} correctas, ${fail} con fallo${skipped ? ', ' + skipped + ' omitida(s)' : ''}`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
