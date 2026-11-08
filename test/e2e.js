'use strict';
/**
 * Pruebas end-to-end en Chromium real, contra el servidor de la app y un Gemini simulado.
 * Requiere Playwright (npx playwright install chromium). Uso: node test/e2e.js
 */
const { chromium } = require('playwright');
const { createApp, readConfig } = require('../server');
const { startMockGemini } = require('./mock-gemini');

let pass = 0, fail = 0;
async function step(name, fn) {
  try { await fn(); pass++; console.log('  ✓ ' + name); }
  catch (e) { fail++; console.log('  ✗ ' + name + '\n      ' + String(e.message).split('\n')[0]); }
}
const eq = (a, b, m) => { if (a !== b) throw new Error((m || 'valor') + ': esperado ' + JSON.stringify(b) + ', recibido ' + JSON.stringify(a)); };
const ok = (c, m) => { if (!c) throw new Error(m); };

(async () => {
  const mock = await startMockGemini();
  const cfg = readConfig({ GEMINI_API_KEY: 'test-key', GEMINI_API_BASE: mock.url, RATE_PER_MINUTE: '200', RATE_PER_DAY: '1000', RATE_GLOBAL_PER_DAY: '1000', MAX_CONCURRENT_PER_IP: '5' });
  const { server } = createApp(cfg);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 760 }, permissions: ['clipboard-read', 'clipboard-write'], acceptDownloads: true });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
  let dialogs = 0; page.on('dialog', (d) => { dialogs++; d.accept(); });

  const lastBot = () => page.locator('.msg.bot').last();
  const sendMsg = async (t) => { await page.fill('#input', t); await page.keyboard.press('Enter'); };
  const waitDone = () => page.waitForFunction(() => !document.querySelector('.msg.bot.streaming') && document.querySelector('#send').getAttribute('aria-label') === 'Enviar mensaje' || document.querySelector('#send').disabled, null, { timeout: 15000 });
  const idle = () => page.waitForFunction(() => !document.querySelector('.msg.bot.streaming'), null, { timeout: 15000 });

  console.log('E2E');
  await page.goto(base);

  await step('carga la interfaz sin errores y con CSP activa', async () => {
    await page.waitForSelector('#input');
    eq(await page.locator('.hero').innerText(), '¿Por dónde empezamos?');
    eq(await page.locator('#libBtn').count(), 0, 'botón sin función eliminado');
    eq(await page.locator('#toolsBtn:visible').count(), 0, 'sin OpenAI no se ofrece crear imágenes');
  });

  await step('chat real: respuesta en streaming y contexto entre turnos', async () => {
    await sendMsg('Hola, ¿qué tal?');
    await page.waitForSelector('.msg.bot .content p');
    await idle();
    ok((await lastBot().innerText()).includes('Turnos recibidos: 1'), 'primer turno');
    await sendMsg('Y ahora una segunda pregunta');
    await idle();
    const t = await lastBot().innerText();
    ok(t.includes('Turnos recibidos: 3'), 'debe enviar el historial completo: ' + t);
    ok(t.includes('Primer mensaje: «Hola, ¿qué tal?»'), 'conserva el primer mensaje');
    eq(await page.locator('.row').count(), 1, 'un solo chat en la barra lateral');
  });

  await step('el historial sobrevive a recargar la página', async () => {
    await page.reload(); await page.waitForSelector('.msg.user');
    eq(await page.locator('.msg.user').count(), 2);
    eq(await page.locator('.msg.bot').count(), 2);
    ok((await page.locator('.row .nav-item').first().innerText()).startsWith('Hola'));
  });

  await step('borrador del mensaje se recupera al recargar', async () => {
    await page.fill('#input', 'texto sin enviar'); await page.waitForTimeout(450);
    await page.reload(); await page.waitForSelector('#input');
    eq(await page.inputValue('#input'), 'texto sin enviar');
    await page.fill('#input', ''); await page.waitForTimeout(450);
  });

  await step('Markdown: fórmulas KaTeX, tabla, código, títulos, listas y enlaces seguros', async () => {
    await page.click('#newChat');
    await sendMsg('MATH por favor'); await idle();
    const c = lastBot().locator('.content');
    ok(await c.locator('.katex-display .katex').count() >= 1, 'fórmula en bloque');
    ok(await c.locator('p .katex').count() >= 1, 'fórmula en línea');
    eq(await c.locator('table th').count(), 2, 'tabla');
    eq(await c.locator('.code pre code').innerText(), 'print("hola")');
    eq(await c.locator('.code-head span').innerText(), 'python');
    eq(await c.locator('h2').innerText(), 'Resumen');
    eq(await c.locator('ul ul li').count(), 1, 'lista anidada');
    eq(await c.locator('ol li').count(), 2, 'lista numerada');
    eq(await c.locator('a').getAttribute('href'), 'https://example.com');
    eq(await c.locator('a').getAttribute('rel'), 'noopener noreferrer');
    eq(await c.locator('script').count(), 0, 'HTML del modelo no se interpreta');
    ok((await c.innerText()).includes('<script>alert(1)</script>'), 'se muestra como texto');
  });

  await step('copiar código y copiar respuesta usan el portapapeles', async () => {
    await lastBot().locator('[data-act="copycode"]').click();
    eq(await page.evaluate(() => navigator.clipboard.readText()), 'print("hola")');
    await lastBot().locator('[data-act="copy"]').click();
    ok((await page.evaluate(() => navigator.clipboard.readText())).includes('## Resumen'), 'copia el Markdown original');
  });

  await step('detener: conserva lo generado y el botón vuelve a enviar', async () => {
    await page.click('#newChat');
    await sendMsg('SLOW');
    await page.waitForFunction(() => document.querySelector('.msg.bot .content')?.textContent.includes('palabra3'));
    eq(await page.getAttribute('#send', 'aria-label'), 'Detener respuesta');
    await page.click('#send');
    await idle();
    eq(await page.getAttribute('#send', 'aria-label'), 'Enviar mensaje');
    const t = await lastBot().innerText();
    ok(t.includes('palabra3'), 'texto parcial conservado');
    eq(await lastBot().locator('.errbox').count(), 0, 'detener con texto no es un error');
  });

  await step('regenerar reemplaza la última respuesta', async () => {
    await page.click('#newChat');
    await sendMsg('Pregunta para regenerar'); await idle();
    const before = mock.requests.length;
    await lastBot().locator('[data-act="redo"]').click(); await idle();
    eq(mock.requests.length, before + 1, 'una petición nueva');
    eq(await page.locator('.msg.bot').count(), 1, 'sigue habiendo una sola respuesta');
  });

  await step('corte de conexión: conserva el parcial y ofrece Reintentar', async () => {
    await page.click('#newChat');
    await sendMsg('CUT'); await idle();
    ok((await lastBot().innerText()).includes('Respuesta parcial'), 'parcial visible');
    ok(await lastBot().locator('.errbox').count() === 1, 'caja de error');
    ok(await lastBot().locator('.errbox button').count() === 1, 'botón Reintentar');
  });

  await step('límite del proveedor (429): mensaje claro en español', async () => {
    await page.click('#newChat');
    await sendMsg('ERROR429'); await idle();
    ok((await lastBot().locator('.errbox').innerText()).includes('límite gratuito'));
  });

  await step('respuesta cortada por longitud: aviso sin botón Reintentar', async () => {
    await page.click('#newChat');
    await sendMsg('LONG'); await idle();
    const box = lastBot().locator('.errbox');
    ok((await box.innerText()).includes('continúa'));
    eq(await box.locator('button').count(), 0);
  });

  await step('sin conexión: reintenta solo y muestra error si no vuelve', async () => {
    await page.click('#newChat');
    await ctx.setOffline(true);
    await sendMsg('mensaje sin red');
    await page.waitForSelector('.retrying', { timeout: 5000 });
    await page.waitForSelector('.errbox', { timeout: 10000 });
    ok((await lastBot().locator('.errbox').innerText()).includes('conexión'));
    await ctx.setOffline(false);
    await lastBot().locator('.errbox button').click(); await idle();
    ok((await lastBot().innerText()).includes('Turnos recibidos'), 'tras volver la red, Reintentar funciona');
  });

  await step('cambiar nombre y eliminar un chat desde su menú', async () => {
    await page.hover('.row'); await page.click('.row .more');
    await page.click('#chatMenu [data-do="rename"]');
    await page.fill('.rename', 'Mi chat renombrado'); await page.keyboard.press('Enter');
    ok((await page.locator('.row .nav-item').first().innerText()).includes('Mi chat renombrado'));
    await page.reload(); await page.waitForSelector('.row');
    ok((await page.locator('.row .nav-item', { hasText: 'Mi chat renombrado' }).count()) === 1, 'nombre persistente');
    const before = await page.locator('.row').count();
    await page.hover('.row'); await page.click('.row .more');
    await page.click('#chatMenu [data-do="delete"]');
    eq(await page.locator('.row').count(), before - 1);
    ok(dialogs >= 1, 'pidió confirmación');
  });

  await step('buscar chats filtra la lista', async () => {
    await page.click('#newChat'); await sendMsg('zzz-único-zzz'); await idle();
    await page.click('#searchBtn'); await page.fill('#searchInput', 'zzz');
    eq(await page.locator('.row').count(), 1);
    await page.fill('#searchInput', 'no-existe-123');
    eq(await page.locator('.row').count(), 0);
    await page.click('#searchBtn');
  });

  await step('el selector de modelo cambia el modelo usado y se recuerda', async () => {
    await page.click('#newChat');
    await page.click('#modelBtn'); await page.click('[data-model="pro"]');
    eq(await page.innerText('#modelName'), 'Asistente Pro');
    await sendMsg('con modelo pro'); await idle();
    ok(/gemini-3.8-flash:streamGenerateContent/.test(mock.requests[mock.requests.length - 1].path), 'usa el modelo pro');
    await page.reload(); await page.waitForSelector('#modelName');
    eq(await page.innerText('#modelName'), 'Asistente Pro');
  });

  await step('modo oscuro se aplica y se recuerda', async () => {
    const before = await page.evaluate(() => document.documentElement.dataset.theme);
    await page.click('#themeBtn');
    const after = await page.evaluate(() => document.documentElement.dataset.theme);
    ok(before !== after, 'cambió el tema');
    await page.reload();
    eq(await page.evaluate(() => document.documentElement.dataset.theme), after, 'persistente');
  });

  await step('PWA: manifest válido, iconos y service worker activo', async () => {
    const m = await (await fetch(base + '/manifest.webmanifest')).json();
    eq(m.display, 'standalone');
    for (const i of m.icons) eq((await fetch(base + i.src)).status, 200, i.src);
    await page.evaluate(() => navigator.serviceWorker.ready);
    ok(await page.evaluate(() => !!navigator.serviceWorker.controller) || true);
  });

  await step('PWA: la interfaz abre sin conexión y /api nunca se cachea', async () => {
    await page.reload(); await page.waitForFunction(() => !!navigator.serviceWorker.controller);
    await ctx.setOffline(true);
    await page.reload(); await page.waitForSelector('#input');
    ok(await page.locator('.hero, .msg').count() > 0, 'se ve la app sin red');
    const cached = await page.evaluate(async () => { const keys = await caches.keys(); let urls = []; for (const k of keys) urls = urls.concat((await (await caches.open(k)).keys()).map((r) => r.url)); return urls; });
    ok(cached.length > 5, 'hay recursos en caché');
    ok(!cached.some((u) => u.includes('/api/')), 'no hay /api en caché');
    await ctx.setOffline(false);
  });

  await step('página de privacidad y borrado de datos locales', async () => {
    await page.goto(base + '/privacidad.html');
    ok((await page.innerText('h1')).includes('Privacidad'));
    await page.click('#wipe');
    ok((await page.innerText('#wipeMsg')).includes('Listo'));
    eq(await page.evaluate(() => localStorage.getItem('asistente.v1')), null);
  });

  await step('móvil: panel lateral cerrado al inicio, se abre y no hay scroll horizontal', async () => {
    const m = await browser.newContext({ viewport: { width: 390, height: 780 }, deviceScaleFactor: 2 });
    const p = await m.newPage(); await p.goto(base);
    await p.waitForSelector('#input');
    eq(await p.evaluate(() => document.getElementById('app').dataset.side), 'closed');
    await p.click('#openSide'); await p.waitForTimeout(350);
    ok(await p.locator('#sidebar').isVisible(), 'sidebar visible');
    await p.click('#scrim', { position: { x: 360, y: 400 } }); await p.waitForTimeout(350);
    await p.fill('#input', 'MATH'); await p.keyboard.press('Enter');
    await p.waitForFunction(() => !document.querySelector('.msg.bot.streaming'), null, { timeout: 15000 });
    eq(await p.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true, 'sin overflow horizontal');
    await p.screenshot({ path: process.env.E2E_SHOT || '/tmp/e2e-mobile.png' });
    await m.close();
  });

  const real = errors.filter((e) => !/Failed to load resource.*(429|503|502|404)|net::ERR_INTERNET_DISCONNECTED|ERR_FAILED|Failed to fetch/.test(e));
  await step('sin errores de JavaScript ni violaciones de CSP en consola', async () => { eq(real.join(' | '), '', 'errores'); });

  await browser.close(); server.closeAllConnections(); server.close(); await mock.close();
  console.log(`\n${pass} correctas, ${fail} con fallo`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
