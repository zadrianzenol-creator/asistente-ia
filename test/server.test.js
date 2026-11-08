'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createApp, readConfig, validateChat } = require('../server');
const { createLimiter } = require('../lib/limits');
const { startMockGemini } = require('./mock-gemini');

async function boot(overrides = {}, env = {}) {
  const mock = await startMockGemini();
  const cfg = Object.assign(readConfig({ GEMINI_API_KEY: 'test-key', GEMINI_API_BASE: mock.url, ...env }), overrides);
  const { server } = createApp(cfg);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  return { base, mock, cfg, close: async () => { server.closeAllConnections(); await new Promise((r) => server.close(r)); await mock.close(); } };
}
const post = (base, body, headers = {}) => fetch(base + '/api/chat', { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: typeof body === 'string' ? body : JSON.stringify(body) });
async function readSse(res) {
  const text = await res.text();
  return text.split('\n\n').filter(Boolean).map((b) => JSON.parse(b.replace(/^data: /, '')));
}
const U = (t) => ({ role: 'user', content: t });
const A = (t) => ({ role: 'assistant', content: t });

test('streaming: reensambla SSE y reenvía el historial completo (contexto)', async () => {
  const t = await boot();
  try {
    const res = await post(t.base, { model: 'fast', messages: [U('primera'), A('respuesta uno'), U('segunda')] });
    assert.equal(res.status, 200);
    assert.match(res.headers.get('content-type'), /text\/event-stream/);
    const evs = await readSse(res);
    const text = evs.filter((e) => e.text).map((e) => e.text).join('');
    assert.match(text, /Turnos recibidos: 3/);
    assert.match(text, /Primer mensaje: «primera»/);
    assert.match(text, /Último: «segunda»/);
    assert.equal(evs[evs.length - 1].done, true);
    assert.equal(evs[evs.length - 1].finish, 'STOP');
    const r = t.mock.requests[0];
    assert.equal(r.key, 'test-key');
    assert.match(r.path, /gemini-flash-lite-latest:streamGenerateContent$/);
    assert.equal(r.body.contents[1].role, 'model');
    assert.ok(r.body.systemInstruction.parts[0].text.length > 50);
    assert.equal(r.body.tools, undefined);
  } finally { await t.close(); }
});

test('el modelo "pro" usa otro modelo y GEMINI_SEARCH añade búsqueda', async () => {
  const t = await boot({}, { GEMINI_SEARCH: '1', GEMINI_MODEL_PRO: 'modelo-pro-x' });
  try {
    await (await post(t.base, { model: 'pro', messages: [U('hola')] })).text();
    assert.match(t.mock.requests[0].path, /modelo-pro-x:/);
    assert.deepEqual(t.mock.requests[0].body.tools, [{ google_search: {} }]);
  } finally { await t.close(); }
});

test('la clave nunca aparece en respuestas ni en archivos estáticos', async () => {
  const t = await boot();
  try {
    const chat = await (await post(t.base, { messages: [U('hola')] })).text();
    const health = await (await fetch(t.base + '/api/health')).text();
    const html = await (await fetch(t.base + '/')).text();
    const js = await (await fetch(t.base + '/app.js')).text();
    for (const body of [chat, health, html, js]) assert.ok(!body.includes('test-key'));
  } finally { await t.close(); }
});

test('sin GEMINI_API_KEY responde 503 claro, sin llamar al proveedor', async () => {
  const t = await boot({}, { GEMINI_API_KEY: '' });
  try {
    const res = await post(t.base, { messages: [U('hola')] });
    assert.equal(res.status, 503);
    assert.equal((await res.json()).error.code, 'not_configured');
    assert.equal(t.mock.requests.length, 0);
  } finally { await t.close(); }
});

test('validación: JSON roto, formato, último mensaje, tamaños y tipo', async () => {
  const t = await boot({ maxMessageChars: 100 });
  try {
    assert.equal((await post(t.base, '{rota')).status, 400);
    assert.equal((await post(t.base, { messages: 'x' })).status, 400);
    assert.equal((await post(t.base, { messages: [] })).status, 400);
    assert.equal((await post(t.base, { messages: [{ role: 'system', content: 'x' }] })).status, 400);
    assert.equal((await post(t.base, { messages: [U('a'), A('b')] })).status, 400);
    assert.equal((await post(t.base, { messages: [U('x'.repeat(101))] })).status, 400);
    assert.equal((await fetch(t.base + '/api/chat', { method: 'POST', headers: { 'content-type': 'text/plain' }, body: 'hola' })).status, 415);
    assert.equal((await fetch(t.base + '/api/chat')).status, 405);
    assert.equal(t.mock.requests.length, 0);
  } finally { await t.close(); }
});

test('cuerpo demasiado grande → 413', async () => {
  const t = await boot({ maxBodyBytes: 500 });
  try {
    const res = await post(t.base, { messages: [U('x'.repeat(2000))] }).catch((e) => e);
    if (res instanceof Error) return;   // el servidor puede cortar la conexión antes
    assert.equal(res.status, 413);
  } finally { await t.close(); }
});

test('rechaza peticiones con Origin distinto al host', async () => {
  const t = await boot();
  try {
    const res = await post(t.base, { messages: [U('hola')] }, { origin: 'https://otro-sitio.example' });
    assert.equal(res.status, 403);
    const ok = await post(t.base, { messages: [U('hola')] }, { origin: t.base });
    assert.equal(ok.status, 200); await ok.text();
  } finally { await t.close(); }
});

test('errores del proveedor se traducen a mensajes útiles', async () => {
  const t = await boot();
  try {
    const q = await post(t.base, { messages: [U('ERROR429')] });
    assert.equal(q.status, 429);
    assert.match((await q.json()).error.message, /límite gratuito/);
    const b = await post(t.base, { messages: [U('ERROR503')] });
    assert.equal(b.status, 503);
    assert.equal((await b.json()).error.code, 'provider_busy');
  } finally { await t.close(); }
});

test('clave inválida en el proveedor → 502 provider_auth (sin filtrar detalles)', async () => {
  const t = await boot({}, { GEMINI_API_KEY: 'clave-mala' });
  try {
    const res = await post(t.base, { messages: [U('hola')] });
    assert.equal(res.status, 502);
    const j = await res.json();
    assert.equal(j.error.code, 'provider_auth');
    assert.ok(!JSON.stringify(j).includes('clave-mala'));
  } finally { await t.close(); }
});

test('filtro de seguridad del proveedor llega como finish=SAFETY con nota', async () => {
  const t = await boot();
  try {
    const evs = await readSse(await post(t.base, { messages: [U('SAFETY')] }));
    const done = evs.find((e) => e.done);
    assert.equal(done.finish, 'SAFETY');
    assert.match(done.note, /seguridad/);
  } finally { await t.close(); }
});

test('límite por minuto: la petición N+1 recibe 429 con Retry-After', async () => {
  const t = await boot({ limits: { perMinute: 2, perDay: 100, globalPerDay: 100, maxConcurrent: 5 } });
  try {
    for (let i = 0; i < 2; i++) await (await post(t.base, { messages: [U('hola')] })).text();
    const res = await post(t.base, { messages: [U('hola')] });
    assert.equal(res.status, 429);
    assert.ok(Number(res.headers.get('retry-after')) >= 1);
    assert.equal((await res.json()).error.code, 'rate_limit');
  } finally { await t.close(); }
});

test('límite global diario protege la cuota del proveedor', async () => {
  const t = await boot({ limits: { perMinute: 100, perDay: 100, globalPerDay: 1, maxConcurrent: 5 } });
  try {
    await (await post(t.base, { messages: [U('hola')] })).text();
    const res = await post(t.base, { messages: [U('hola')] });
    assert.equal(res.status, 503);
    assert.equal((await res.json()).error.code, 'service_busy');
  } finally { await t.close(); }
});

test('límite de generaciones simultáneas por IP', async () => {
  const t = await boot({ limits: { perMinute: 100, perDay: 100, globalPerDay: 100, maxConcurrent: 1 } });
  try {
    const ac = new AbortController();
    const first = await fetch(t.base + '/api/chat', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ messages: [U('SLOW')] }), signal: ac.signal });
    const second = await post(t.base, { messages: [U('hola')] });
    assert.equal(second.status, 429);
    assert.equal((await second.json()).error.code, 'too_many_active');
    ac.abort(); await first.body.cancel().catch(() => {});
  } finally { await t.close(); }
});

test('cancelar desde el cliente corta la petición al proveedor y libera el cupo', async () => {
  const t = await boot({ limits: { perMinute: 100, perDay: 100, globalPerDay: 100, maxConcurrent: 1 } });
  try {
    const ac = new AbortController();
    const res = await fetch(t.base + '/api/chat', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ messages: [U('SLOW')] }), signal: ac.signal });
    const reader = res.body.getReader(); await reader.read();
    ac.abort(); await reader.read().catch(() => {});
    await new Promise((r) => setTimeout(r, 200));
    const again = await post(t.base, { messages: [U('hola')] });   // si no se liberó, sería 429
    assert.equal(again.status, 200); await again.text();
  } finally { await t.close(); }
});

test('corte a mitad de stream del proveedor → evento de error al cliente', async () => {
  const t = await boot();
  try {
    const evs = await readSse(await post(t.base, { messages: [U('CUT')] }));
    assert.ok(evs.some((e) => e.text && /parcial/.test(e.text)));
    assert.ok(evs.some((e) => e.error));
    assert.ok(!evs.some((e) => e.done));
  } finally { await t.close(); }
});

test('estáticos: cabeceras de seguridad, SPA, 404 y sin salida del directorio', async () => {
  const t = await boot();
  try {
    const r = await fetch(t.base + '/');
    assert.match(r.headers.get('content-security-policy'), /default-src 'self'/);
    assert.equal(r.headers.get('x-content-type-options'), 'nosniff');
    assert.equal(r.headers.get('x-frame-options'), 'DENY');
    assert.equal((await fetch(t.base + '/no-existe.js')).status, 404);
    assert.equal((await fetch(t.base + '/%2e%2e/server.js')).status === 200, false);
    assert.equal((await fetch(t.base + '/..%2fserver.js')).status === 200, false);
    const manifest = await fetch(t.base + '/manifest.webmanifest');
    assert.match(manifest.headers.get('content-type'), /manifest\+json/);
    assert.equal(r.headers.get('cache-control'), 'no-cache');
  } finally { await t.close(); }
});

test('validateChat: fusiona turnos repetidos y recorta por presupuesto de contexto', () => {
  const cfg = { ...readConfig({}), maxContextChars: 50 };
  const v = validateChat({ messages: [U('a'.repeat(30)), A('b'.repeat(30)), U('c'), U('d')] }, cfg);
  assert.equal(v.messages[0].role, 'user');
  assert.equal(v.messages[v.messages.length - 1].content, 'c\n\nd');
  const roles = v.messages.map((m) => m.role);
  for (let i = 1; i < roles.length; i++) assert.notEqual(roles[i], roles[i - 1]);
});

test('limitador: ventana, diario y limpieza', () => {
  const l = createLimiter({ perMinute: 2, perDay: 3, globalPerDay: 100, maxConcurrent: 1 });
  const t0 = Date.UTC(2026, 10, 3, 12, 0, 0);
  assert.ok(l.check('ip', t0).ok); l.consume('ip', t0);
  l.consume('ip', t0 + 1000);
  assert.equal(l.check('ip', t0 + 2000).code, 'rate_limit');
  assert.ok(l.check('ip', t0 + 61000).ok);
  l.consume('ip', t0 + 61000);
  assert.equal(l.check('ip', t0 + 130000).code, 'daily_limit');
  assert.ok(l.check('ip', t0 + 86400000).ok);   // día siguiente
  l.begin('x'); assert.equal(l.check('x', t0).code, 'too_many_active'); l.end('x'); assert.ok(l.check('x', t0).ok);
  l.sweep(t0 + 86400000 * 2); assert.equal(l._state().day.size, 0);
});

test('saturación temporal (503): reintenta una vez y el usuario no ve el error', async () => {
  const t = await boot();
  try {
    const res = await post(t.base, { messages: [U('FLAKY por favor')] });
    assert.equal(res.status, 200);
    assert.match((await readSse(res)).filter((e) => e.text).map((e) => e.text).join(''), /Turnos recibidos: 1/);
    assert.equal(t.mock.requests.length, 2, 'primer intento 503 + reintento correcto');
    // Si sigue saturado tras el reintento, se informa con 503 claro
    const bad = await post(t.base, { messages: [U('ERROR503')] });
    assert.equal(bad.status, 503); assert.equal((await bad.json()).error.code, 'provider_busy');
  } finally { await t.close(); }
});

test('modelo Pro saturado: degrada al rápido, avisa con cabecera y responde igualmente', async () => {
  const t = await boot();
  try {
    const res = await post(t.base, { model: 'pro', messages: [U('PROBUSY hola')] });
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('x-ai-degraded'), '1');
    assert.match((await readSse(res)).filter((e) => e.text).map((e) => e.text).join(''), /Turnos recibidos: 1/);
    const paths = t.mock.requests.map((r) => r.path);
    assert.equal(paths.filter((p) => p.includes('3.8-flash')).length, 2, 'pro + reintento');
    assert.ok(paths[paths.length - 1].includes('flash-lite-latest'), 'el último intento usa el modelo rápido');
    const fast = await post(t.base, { model: 'fast', messages: [U('PROBUSY hola')] });   // el modelo rápido no se degrada
    assert.equal(fast.headers.get('x-ai-degraded'), null); await fast.text();
  } finally { await t.close(); }
});
