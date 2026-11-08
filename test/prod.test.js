'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const net = require('node:net');
const zlib = require('node:zlib');
const fs = require('node:fs');
const path = require('node:path');
const cp = require('node:child_process');
const { createApp, readConfig } = require('../server');
const { startMockGemini } = require('./mock-gemini');

async function boot(env = {}, overrides = {}) {
  const mock = await startMockGemini();
  const cfg = Object.assign(readConfig({ GEMINI_API_KEY: 'test-key', GEMINI_API_BASE: mock.url, ...env }), overrides);
  const { server } = createApp(cfg);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  return { port: server.address().port, base: `http://127.0.0.1:${server.address().port}`, mock, close: async () => { server.closeAllConnections(); await new Promise((r) => server.close(r)); await mock.close(); } };
}
// fetch de Node descomprime solo; para ver los bytes reales se usa http en crudo
function rawGet(port, p, headers = {}) {
  return new Promise((resolve, reject) => {
    const req = require('node:http').get({ host: '127.0.0.1', port, path: p, headers }, (res) => {
      const chunks = []; res.on('data', (c) => chunks.push(c)); res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) }));
    }); req.on('error', reject);
  });
}
const PUB = path.join(__dirname, '..', 'public');

test('compresión: brotli y gzip bajan mucho el peso y se descomprimen idénticos; sin Accept-Encoding no se comprime', async () => {
  const t = await boot();
  try {
    const f = '/vendor/pdfjs/pdf.worker.min.mjs', orig = fs.readFileSync(path.join(PUB, f));
    const br = await rawGet(t.port, f, { 'accept-encoding': 'gzip, br' });
    assert.equal(br.headers['content-encoding'], 'br'); assert.equal(br.headers.vary, 'Accept-Encoding');
    assert.ok(br.body.length < orig.length * 0.5, `brotli ${br.body.length} vs ${orig.length}`);
    assert.ok(zlib.brotliDecompressSync(br.body).equals(orig));
    const gz = await rawGet(t.port, '/app.js', { 'accept-encoding': 'gzip' });
    assert.equal(gz.headers['content-encoding'], 'gzip'); assert.ok(zlib.gunzipSync(gz.body).equals(fs.readFileSync(path.join(PUB, 'app.js'))));
    const hit = await rawGet(t.port, '/app.js', { 'accept-encoding': 'gzip' });   // segunda vez: desde la caché en memoria
    assert.ok(hit.body.equals(gz.body));
    const none = await rawGet(t.port, '/app.js'); assert.equal(none.headers['content-encoding'], undefined); assert.equal(none.body.length, fs.statSync(path.join(PUB, 'app.js')).size);
    const png = await rawGet(t.port, '/icons/icon-512.png', { 'accept-encoding': 'gzip, br' }); assert.equal(png.headers['content-encoding'], undefined, 'las imágenes ya están comprimidas');
    const head = await new Promise((resolve) => require('node:http').request({ host: '127.0.0.1', port: t.port, path: '/app.js', method: 'HEAD', headers: { 'accept-encoding': 'gzip' } }, (r) => { r.resume(); r.on('end', () => resolve(r)); }).end());
    assert.equal(head.statusCode, 200); assert.equal(head.headers['content-encoding'], 'gzip');
  } finally { await t.close(); }
});

test('ETag: 304 si no cambió, y las respuestas de IA (SSE) nunca se comprimen', async () => {
  const t = await boot();
  try {
    const a = await rawGet(t.port, '/style.css'); assert.match(a.headers.etag, /^W\//);
    const b = await rawGet(t.port, '/style.css', { 'if-none-match': a.headers.etag }); assert.equal(b.status, 304); assert.equal(b.body.length, 0);
    const c = await rawGet(t.port, '/style.css', { 'if-none-match': 'W/"otro"' }); assert.equal(c.status, 200);
    const chat = await new Promise((resolve, reject) => {
      const body = JSON.stringify({ messages: [{ role: 'user', content: 'hola' }] });
      const r = require('node:http').request({ host: '127.0.0.1', port: t.port, path: '/api/chat', method: 'POST', headers: { 'content-type': 'application/json', 'accept-encoding': 'gzip, br', 'content-length': Buffer.byteLength(body) } }, (res) => { const ch = []; res.on('data', (x) => ch.push(x)); res.on('end', () => resolve({ res, body: Buffer.concat(ch).toString() })); });
      r.on('error', reject); r.end(body);
    });
    assert.equal(chat.res.headers['content-encoding'], undefined); assert.match(chat.body, /"text"/);
  } finally { await t.close(); }
});

test('carga lenta (slowloris): la solicitud se corta con 408 y el servidor sigue atendiendo', async () => {
  const t = await boot({}, { bodyTimeoutMs: 400 });
  try {
    const status = await new Promise((resolve) => {
      const s = net.connect(t.port, '127.0.0.1'); let data = '';
      s.on('data', (d) => { data += d; }); s.on('close', () => resolve(data.split('\r\n')[0]));
      s.write('POST /api/chat HTTP/1.1\r\nHost: x\r\nContent-Type: application/json\r\nContent-Length: 5000\r\n\r\n{"mess');   // y no manda más
    });
    assert.match(status, /408/);
    const ok = await fetch(t.base + '/api/health'); assert.equal(ok.status, 200);
  } finally { await t.close(); }
});

test('límite de cuerpos grandes simultáneos: el excedente recibe 503 y se libera al terminar o abortar', async () => {
  const t = await boot({}, { maxInflightBodies: 1, bodyTimeoutMs: 5000 });
  try {
    const slow = net.connect(t.port, '127.0.0.1');
    slow.write('POST /api/chat HTTP/1.1\r\nHost: x\r\nContent-Type: application/json\r\nContent-Length: 5000\r\n\r\n{"mess');
    await new Promise((r) => setTimeout(r, 200));
    const busy = await fetch(t.base + '/api/chat', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ messages: [{ role: 'user', content: 'x' }] }) });
    assert.equal(busy.status, 503); assert.equal((await busy.json()).error.code, 'service_busy');
    slow.destroy();   // el cliente se va a mitad de la carga
    await new Promise((r) => setTimeout(r, 200));
    const again = await fetch(t.base + '/api/chat', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ messages: [{ role: 'user', content: 'hola' }] }) });
    assert.equal(again.status, 200); await again.text();
  } finally { await t.close(); }
});

test('HSTS solo si hay proxy de confianza y la petición llegó por HTTPS', async () => {
  const t = await boot({ TRUST_PROXY: '1' });
  try {
    assert.match((await rawGet(t.port, '/', { 'x-forwarded-proto': 'https' })).headers['strict-transport-security'], /max-age=\d+/);
    assert.equal((await rawGet(t.port, '/', { 'x-forwarded-proto': 'http' })).headers['strict-transport-security'], undefined);
    assert.equal((await rawGet(t.port, '/')).headers['strict-transport-security'], undefined);
  } finally { await t.close(); }
  const u = await boot({ TRUST_PROXY: '0' });
  try { assert.equal((await rawGet(u.port, '/', { 'x-forwarded-proto': 'https' })).headers['strict-transport-security'], undefined, 'sin TRUST_PROXY no se confía en la cabecera'); } finally { await u.close(); }
});

test('proceso real: arranca, responde, y SIGTERM deja terminar la respuesta en curso y sale con código 0', { timeout: 40000 }, async () => {
  const mock = await startMockGemini();
  const port = 20000 + Math.floor(Math.random() * 20000);
  const child = cp.spawn(process.execPath, [path.join(__dirname, '..', 'server.js')], { env: { ...process.env, PORT: String(port), GEMINI_API_KEY: 'test-key', GEMINI_API_BASE: mock.url, OPENAI_API_KEY: '', ANTHROPIC_API_KEY: '' }, stdio: ['ignore', 'pipe', 'pipe'] });
  let out = ''; child.stdout.on('data', (d) => { out += d; }); child.stderr.on('data', (d) => { out += d; });
  const exited = new Promise((r) => child.on('exit', (code, sig) => r({ code, sig })));
  try {
    for (let i = 0; i < 50 && !/Servidor listo/.test(out); i++) await new Promise((r) => setTimeout(r, 100));
    assert.match(out, /Servidor listo en http:\/\/localhost:\d+/); assert.match(out, /Proveedor: gemini/);
    assert.equal((await fetch(`http://127.0.0.1:${port}/api/health`)).status, 200);
    const res = await fetch(`http://127.0.0.1:${port}/api/chat`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ messages: [{ role: 'user', content: 'SLOW' }] }) });
    const reader = res.body.getReader(); await reader.read();
    child.kill('SIGTERM');
    await new Promise((r) => setTimeout(r, 300));
    const refused = await fetch(`http://127.0.0.1:${port}/api/health`).then(() => false, () => true);
    assert.ok(refused, 'tras SIGTERM ya no acepta conexiones nuevas');
    const more = await reader.read(); assert.ok(!more.done && more.value.length > 0, 'la respuesta en curso sigue llegando');
    const { code } = await exited; assert.equal(code, 0); assert.match(out, /SIGTERM recibido/);
  } finally { child.kill('SIGKILL'); await mock.close(); }
});

test('OPERATOR rellena la página de privacidad (y se escapa); sin él queda el marcador', async () => {
  const t = await boot({ OPERATOR: 'Ana <script>x</script> "López" · ana@ejemplo.com' });
  try {
    const html = (await rawGet(t.port, '/privacidad.html')).body.toString();
    assert.ok(!html.includes('[completa aquí'));
    assert.ok(html.includes('Ana &lt;script&gt;x&lt;/script&gt; &quot;López&quot; · ana@ejemplo.com'));
    assert.ok(!html.includes('<script>x</script>'));
  } finally { await t.close(); }
  const u = await boot();
  try { assert.ok((await rawGet(u.port, '/privacidad.html')).body.toString().includes('[completa aquí')); } finally { await u.close(); }
});
