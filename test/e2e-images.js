'use strict';
/** Pruebas de navegador de imágenes: adjuntar, pegar, arrastrar, analizar, crear, editar, descargar. */
const { chromium } = require('playwright');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const { createApp, readConfig } = require('../server');
const { startMockOpenAI } = require('./mock-openai');
const { startMockGemini } = require('./mock-gemini');

let pass = 0, fail = 0;
async function step(name, fn) { try { await fn(); pass++; console.log('  ✓ ' + name); } catch (e) { fail++; console.log('  ✗ ' + name + '\n      ' + String(e.message).split('\n')[0]); } }
const eq = (a, b, m) => { if (a !== b) throw new Error((m || 'valor') + ': esperado ' + JSON.stringify(b) + ', recibido ' + JSON.stringify(a)); };
const ok = (c, m) => { if (!c) throw new Error(m); };

async function start(env) {
  const { server } = createApp(readConfig(env));
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  return { server, base: `http://127.0.0.1:${server.address().port}` };
}

(async () => {
  const oa = await startMockOpenAI(), gm = await startMockGemini();
  const full = await start({ OPENAI_API_KEY: 'test-openai', OPENAI_API_BASE: oa.url, GEMINI_API_KEY: 'test-key', GEMINI_API_BASE: gm.url, RATE_PER_MINUTE: '500', RATE_PER_DAY: '5000', RATE_GLOBAL_PER_DAY: '5000', MAX_CONCURRENT_PER_IP: '9', IMAGE_PER_MINUTE: '100', IMAGE_PER_DAY: '500', IMAGE_GLOBAL_PER_DAY: '500' });
  const only = await start({ GEMINI_API_KEY: 'test-key', GEMINI_API_BASE: gm.url });

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-img-'));
  const browser = await chromium.launch();
  // 1) Archivos de prueba generados con un canvas real
  const tmp = await browser.newPage();
  const made = await tmp.evaluate(() => {
    const mk = (w, h, type, draw) => { const c = document.createElement('canvas'); c.width = w; c.height = h; const x = c.getContext('2d'); x.fillStyle = '#336699'; x.fillRect(0, 0, w, h); x.fillStyle = '#fff'; x.font = 'bold 40px Arial'; x.fillText('FOTO', 20, 60); return c.toDataURL(type, 0.9).split(',')[1]; };
    return { png: mk(300, 200, 'image/png'), jpg: mk(300, 200, 'image/jpeg'), webp: mk(300, 200, 'image/webp'), big: mk(4000, 3000, 'image/png') };
  });
  const w = (n, b64) => { const f = path.join(dir, n); fs.writeFileSync(f, Buffer.from(b64, 'base64')); return f; };
  const F = { png: w('foto.png', made.png), webp: w('foto.webp', made.webp), big: w('enorme.png', made.big) };
  // JPEG con un bloque EXIF falso que contiene "GPS-SECRETO"
  const jpg = Buffer.from(made.jpg, 'base64'), payload = Buffer.from('Exif\0\0GPS-SECRETO-40.4168N');
  const seg = Buffer.concat([Buffer.from([0xff, 0xe1, (payload.length + 2) >> 8, (payload.length + 2) & 255]), payload]);
  F.exif = path.join(dir, 'con-exif.jpg'); fs.writeFileSync(F.exif, Buffer.concat([jpg.slice(0, 2), seg, jpg.slice(2)]));
  F.pdf = path.join(dir, 'doc.pdf'); fs.writeFileSync(F.pdf, '%PDF-1.4 falso');
  F.fake = path.join(dir, 'falsa.png'); fs.writeFileSync(F.fake, 'MZ esto es un ejecutable renombrado a .png');
  await tmp.close();

  const ctx = await browser.newContext({ viewport: { width: 1280, height: 780 }, acceptDownloads: true });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
  page.on('dialog', (d) => d.accept());
  const lastBot = () => page.locator('.msg.bot').last();
  const idle = () => page.waitForFunction(() => !document.querySelector('.msg.bot.streaming'), null, { timeout: 20000 });
  const sendMsg = async (t) => { await page.fill('#input', t); await page.keyboard.press('Enter'); };
  const lastOA = () => oa.requests[oa.requests.length - 1];
  const toastText = async () => { await page.waitForSelector('#toast.on'); return page.innerText('#toast'); };
  const pngWidth = (b64) => Buffer.from(b64, 'base64').readUInt32BE(16);

  console.log('E2E imágenes');
  await page.goto(full.base); await page.waitForSelector('#input');

  await step('adjuntar: JPG/PNG/WEBP con vista previa y botón para quitar', async () => {
    await page.setInputFiles('#fileInput', [F.png, F.exif, F.webp]);
    await page.waitForSelector('.thumb', { timeout: 8000 });
    await page.waitForFunction(() => document.querySelectorAll('.thumb').length === 3);
    ok((await page.locator('.thumb img').first().getAttribute('src')).startsWith('blob:'), 'vista previa local');
    await page.locator('.thumb button').nth(2).click();
    eq(await page.locator('.thumb').count(), 2);
    eq(await page.isEnabled('#send'), true, 'se puede enviar solo con imágenes');
  });

  await step('enviar imágenes sin texto: el modelo las recibe y se ven en el chat', async () => {
    await page.keyboard.press('Enter'); // el foco puede estar en el textarea
    await page.click('#send').catch(() => {});
    await idle();
    const req = oa.requests.filter((r) => r.path === '/v1/responses').pop();
    const parts = req.body.input[0].content;
    eq(parts.filter((p) => p.type === 'input_image').length, 2, 'dos imágenes');
    eq(parts[0].text, 'Describe esta imagen.', 'texto por defecto');
    ok((await lastBot().innerText()).includes('2 imágenes'), 'respuesta del modelo');
    eq(await page.locator('.msg.user .imgs img').count(), 2, 'miniaturas en el mensaje');
    await page.waitForFunction(() => [...document.querySelectorAll('.msg.user .imgs img')].every((i) => i.naturalWidth > 0));
    eq(await page.locator('.thumb').count(), 0, 'adjuntos limpiados tras enviar');
  });

  await step('privacidad: se eliminan los metadatos EXIF antes de enviar', async () => {
    const req = oa.requests.filter((r) => r.path === '/v1/responses').pop();
    const imgs = req.body.input[0].content.filter((p) => p.type === 'input_image');
    for (const i of imgs) {
      const bytes = Buffer.from(i.image_url.split(',')[1], 'base64');
      ok(!bytes.includes(Buffer.from('GPS-SECRETO')) && !bytes.includes(Buffer.from('Exif')), 'quedó metadato EXIF');
    }
  });

  await step('seguimiento: la conversación conserva las imágenes anteriores en el contexto', async () => {
    await sendMsg('¿De qué color es el fondo?'); await idle();
    const req = oa.requests.filter((r) => r.path === '/v1/responses').pop();
    const n = req.body.input.reduce((a, m) => a + (Array.isArray(m.content) ? m.content.filter((p) => p.type === 'input_image').length : 0), 0);
    eq(n, 2, 'imágenes del primer mensaje siguen en contexto');
  });

  await step('imagen enorme se reduce a ≤2048 px y archivos no válidos se rechazan', async () => {
    await page.click('#newChat');
    await page.setInputFiles('#fileInput', [F.big]);
    await page.waitForSelector('.thumb', { timeout: 15000 });
    await sendMsg('mira'); await idle();
    const img = oa.requests.filter((r) => r.path === '/v1/responses').pop().body.input[0].content.find((p) => p.type === 'input_image');
    const w = pngWidth(img.image_url.split(',')[1]);
    ok(w <= 2048 && w > 1000, 'ancho enviado: ' + w);
    await page.setInputFiles('#fileInput', [F.pdf]);
    await page.waitForFunction(() => /dañado/.test(document.getElementById('toast').textContent), null, { timeout: 8000 });   // un «PDF» falso se lee como documento y se reporta dañado
    await page.waitForTimeout(2600);
    await page.setInputFiles('#fileInput', [F.fake]);
    await page.waitForFunction(() => /formato no admitido/.test(document.getElementById('toast').textContent), null, { timeout: 8000 });   // ejecutable renombrado a .png: se rechaza por su contenido
    eq(await page.locator('.thumb').count(), 0);
  });

  await step('pegar imagen desde el portapapeles y arrastrar y soltar', async () => {
    await page.click('#newChat');
    await page.evaluate((b64) => {
      const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
      const dt = new DataTransfer(); dt.items.add(new File([bytes], 'pegada.png', { type: 'image/png' }));
      document.getElementById('input').dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
    }, made.png);
    await page.waitForFunction(() => document.querySelectorAll('.thumb').length === 1);
    await page.evaluate((b64) => {
      const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
      const dt = new DataTransfer(); dt.items.add(new File([bytes], 'arrastrada.png', { type: 'image/png' }));
      window.dispatchEvent(new DragEvent('dragenter', { dataTransfer: dt, bubbles: true, cancelable: true }));
    }, made.png);
    ok(await page.locator('#dropzone').isVisible(), 'aparece la zona para soltar');
    await page.evaluate((b64) => {
      const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
      const dt = new DataTransfer(); dt.items.add(new File([bytes], 'arrastrada.png', { type: 'image/png' }));
      window.dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true }));
    }, made.png);
    await page.waitForFunction(() => document.querySelectorAll('.thumb').length === 2);
    ok(!(await page.locator('#dropzone').isVisible()), 'la zona se oculta al soltar');
    await page.setInputFiles('#fileInput', [F.png, F.png, F.png]);
    await page.waitForFunction(() => document.querySelectorAll('.thumb').length === 4);
    eq(await page.locator('.thumb').count(), 4, 'máximo 4 imágenes');
    await page.locator('.thumb button').first().click();
  });

  await step('elegir la herramienta con una imagen adjunta no envía el formulario por error', async () => {
    await page.click('#newChat');
    await page.setInputFiles('#fileInput', [F.png]); await page.waitForSelector('.thumb');
    const before = oa.requests.length;
    await page.click('#toolsBtn'); await page.click('[data-tool="image"]');
    await page.waitForTimeout(400);
    ok(!(await page.innerText('#toast')).includes('Describe la imagen'), 'se disparó un envío vacío');
    eq(oa.requests.length, before, 'no debe salir ninguna petición');
    eq(await page.locator('.msg').count(), 0, 'no debe crearse ningún mensaje');
    eq(await page.locator('.thumb').count(), 1, 'el adjunto sigue ahí');
    await page.click('#modeChip');
  });

  await step('Herramientas → crear imagen: chip, placeholder, resultado visible, y el modo se apaga', async () => {
    await page.click('#newChat');
    await page.click('#toolsBtn'); await page.click('[data-tool="image"]');
    ok(await page.locator('#modeChip').isVisible(), 'chip de modo imagen');
    ok(!(await page.innerText('#toast')).includes('Describe la imagen'), 'elegir la herramienta no debe enviar el formulario');
    ok((await page.getAttribute('#input', 'placeholder')).includes('imagen'), 'placeholder cambia');
    await sendMsg('un gato astronauta'); await idle();
    const r = oa.requests.filter((x) => x.path === '/v1/images/generations').pop();
    eq(r.body.prompt, 'un gato astronauta');
    await page.waitForFunction(() => { const i = document.querySelector('.msg.bot .imgs.gen img'); return i && i.naturalWidth > 0; });
    ok((await page.getAttribute('.msg.bot .imgs.gen img', 'src')).startsWith('blob:'));
    ok(!(await page.locator('#modeChip').isVisible()), 'el modo se apaga tras enviar');
  });

  await step('descargar la imagen y ampliarla en el visor', async () => {
    const [dl] = await Promise.all([page.waitForEvent('download'), lastBot().locator('[data-act="dl"]').click()]);
    ok(/^imagen-\d{8}-\d{6}\.png$/.test(dl.suggestedFilename()), 'nombre: ' + dl.suggestedFilename());
    const p = await dl.path(); eq(fs.readFileSync(p).slice(1, 4).toString(), 'PNG', 'el archivo es un PNG');
    await page.click('.msg.bot .imgs.gen img');
    ok(await page.locator('#lightbox').isVisible(), 'visor abierto');
    await page.keyboard.press('Escape');
    ok(!(await page.locator('#lightbox').isVisible()), 'Esc cierra el visor');
  });

  await step('editar la imagen creada: usa /v1/images/edits con fondo transparente', async () => {
    await lastBot().locator('[data-act="edit"]').click();
    await page.waitForFunction(() => document.querySelectorAll('.thumb').length === 1);
    ok(await page.locator('#modeChip').isVisible(), 'modo imagen activo');
    await sendMsg('quita el fondo'); await idle();
    const r = oa.requests.filter((x) => x.path === '/v1/images/edits').pop();
    ok(r.raw.includes('name="image[]"') && /name="prompt"\r\n\r\nquita el fondo/.test(r.raw), 'multipart correcto');
    ok(/name="background"\r\n\r\ntransparent/.test(r.raw), 'pide fondo transparente');
    eq(await page.locator('.msg.bot .imgs.gen img').count(), 2, 'ahora hay dos imágenes en el chat');
  });

  await step('volver a crear la imagen (regenerar)', async () => {
    const before = oa.requests.length;
    await lastBot().locator('[data-act="redo"]').click(); await idle();
    ok(oa.requests.length > before, 'nueva petición');
  });

  await step('las imágenes persisten tras recargar (IndexedDB)', async () => {
    await page.reload(); await page.waitForSelector('.msg.bot .imgs.gen img');
    await page.waitForFunction(() => [...document.querySelectorAll('.msg img[data-img-id]')].every((i) => i.naturalWidth > 0), null, { timeout: 8000 });
    ok(await page.locator('.msg img[data-img-id]').count() >= 2);
  });

  await step('política de contenido: aviso claro y sin botón Reintentar', async () => {
    await page.click('#newChat'); await page.click('#toolsBtn'); await page.click('[data-tool="image"]');
    await sendMsg('POLICY'); await idle();
    const box = lastBot().locator('.errbox');
    ok((await box.innerText()).includes('políticas de contenido'));
    eq(await box.locator('button').count(), 0);
  });

  await step('cancelar la creación de una imagen en curso', async () => {
    await page.click('#newChat'); await page.click('#toolsBtn'); await page.click('[data-tool="image"]');
    await sendMsg('SLOWIMG');
    await page.waitForSelector('.retrying');
    eq(await page.getAttribute('#send', 'aria-label'), 'Detener respuesta');
    await page.click('#send'); await idle();
    ok((await lastBot().locator('.errbox').innerText()).includes('Cancelado'));
    eq(await page.getAttribute('#send', 'aria-label'), 'Enviar mensaje');
  });

  await step('eliminar un chat borra también sus imágenes del almacén local', async () => {
    const count = () => page.evaluate(() => new Promise((res) => { const r = indexedDB.open('asistente-img', 1); r.onsuccess = () => { const q = r.result.transaction('imgs').objectStore('imgs').count(); q.onsuccess = () => res(q.result); }; }));
    ok(await count() > 0, 'hay imágenes guardadas');
    for (let i = await page.locator('.row').count(); i > 0; i--) {
      await page.hover('.row'); await page.click('.row .more'); await page.click('#chatMenu [data-do="delete"]');
    }
    await page.waitForTimeout(400);
    eq(await count(), 0, 'imágenes restantes');
  });

  await step('sin OpenAI: se puede adjuntar y analizar con Gemini, pero no se ofrece crear imágenes', async () => {
    const p2 = await ctx.newPage(); await p2.goto(only.base); await p2.waitForSelector('#input');
    await p2.waitForTimeout(500);
    ok(!(await p2.locator('#toolsBtn').isVisible()), 'sin botón de herramientas');
    await p2.setInputFiles('#fileInput', [F.png]); await p2.waitForSelector('.thumb');
    await p2.fill('#input', '¿qué es esto?'); await p2.keyboard.press('Enter');
    await p2.waitForFunction(() => !document.querySelector('.msg.bot.streaming'), null, { timeout: 15000 });
    ok((await p2.locator('.msg.bot').last().innerText()).includes('Imágenes: 1'), 'Gemini recibió la imagen');
    await p2.close();
  });

  await step('móvil: miniaturas y mensajes con imágenes sin desbordar', async () => {
    const m = await browser.newContext({ viewport: { width: 390, height: 780 }, deviceScaleFactor: 2 });
    const p = await m.newPage(); await p.goto(full.base); await p.waitForSelector('#input');
    await p.setInputFiles('#fileInput', [F.png, F.webp]); await p.waitForSelector('.thumb');
    await p.fill('#input', 'describe'); await p.keyboard.press('Enter');
    await p.waitForFunction(() => !document.querySelector('.msg.bot.streaming'), null, { timeout: 15000 });
    await p.waitForFunction(() => [...document.querySelectorAll('.msg.user img')].every((i) => i.naturalWidth > 0));
    eq(await p.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true, 'sin overflow horizontal');
    await p.screenshot({ path: process.env.E2E_SHOT2 || '/tmp/e2e-images-mobile.png' });
    await m.close();
  });

  await step('sin errores de JavaScript ni violaciones de CSP en consola', async () => {
    const real = errors.filter((e) => !/Failed to load resource.*(4\d\d|5\d\d)|ERR_INTERNET|Failed to fetch/.test(e));
    eq(real.join(' | '), '', 'errores');
  });

  await browser.close(); fs.rmSync(dir, { recursive: true, force: true });
  for (const s of [full.server, only.server]) { s.closeAllConnections(); s.close(); }
  await oa.close(); await gm.close();
  console.log(`\n${pass} correctas, ${fail} con fallo`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
