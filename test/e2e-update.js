'use strict';
/** Prueba el flujo de actualización de la PWA: nueva VERSION del service worker → aviso → recarga. */
const { chromium } = require('playwright');
const fs = require('node:fs');
const path = require('node:path');
const { createApp, readConfig } = require('../server');

(async () => {
  const swPath = path.join(__dirname, '..', 'public', 'sw.js');
  const original = fs.readFileSync(swPath, 'utf8');
  const { server } = createApp(readConfig({ GEMINI_API_KEY: 'x' }));
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const browser = await chromium.launch(); const page = await (await browser.newContext()).newPage();
  let failed = false;
  const check = (c, m) => { console.log((c ? '  ✓ ' : '  ✗ ') + m); if (!c) failed = true; };
  try {
    await page.goto(base); await page.evaluate(() => navigator.serviceWorker.ready);
    await page.reload(); await page.waitForFunction(() => !!navigator.serviceWorker.controller);
    check(!(await page.locator('#updateBar.on').count()), 'sin aviso de actualización en la primera instalación');
    await page.evaluate(() => { window.__marker = 'sin-recargar'; });

    fs.writeFileSync(swPath, original.replace("const VERSION = 'v3'", "const VERSION = 'v4-test'"));
    await page.evaluate(() => navigator.serviceWorker.getRegistration().then((r) => r.update()));
    await page.waitForSelector('#updateBar.on', { timeout: 10000 });
    check(true, 'aparece el aviso «Hay una versión nueva»');
    check(await page.evaluate(() => window.__marker) === 'sin-recargar', 'no recarga sola mientras el usuario trabaja');

    await Promise.all([page.waitForEvent('load'), page.click('#updateBtn')]);
    await page.waitForFunction(() => !!navigator.serviceWorker.controller);
    const keys = await page.evaluate(() => caches.keys());
    check(keys.includes('asistente-v4-test') && !keys.includes('asistente-v3'), 'la caché antigua se elimina: ' + keys.join(','));
  } catch (e) { console.log('  ✗ ' + e.message.split('\n')[0]); failed = true; }
  finally { fs.writeFileSync(swPath, original); await browser.close(); server.closeAllConnections(); server.close(); }
  process.exit(failed ? 1 : 0);
})();
