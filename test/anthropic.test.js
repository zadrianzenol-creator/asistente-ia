'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createApp, readConfig } = require('../server');
const { startMockAnthropic } = require('./mock-anthropic');
const { startMockOpenAI, PNG_1X1 } = require('./mock-openai');
const { startMockGemini } = require('./mock-gemini');

/** parts: qué proveedores simulados levantar */
async function boot({ openai = false, gemini = false, env = {}, overrides = {} } = {}) {
  const an = await startMockAnthropic();
  const oa = openai ? await startMockOpenAI() : null;
  const gm = gemini ? await startMockGemini() : null;
  const e = {
    ANTHROPIC_API_KEY: 'test-anthropic', ANTHROPIC_API_BASE: an.url,
    ...(oa ? { OPENAI_API_KEY: 'test-openai', OPENAI_API_BASE: oa.url } : {}),
    ...(gm ? { GEMINI_API_KEY: 'test-key', GEMINI_API_BASE: gm.url } : {}), ...env
  };
  const { server } = createApp(Object.assign(readConfig(e), overrides));
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  return { base: `http://127.0.0.1:${server.address().port}`, an, oa, gm, close: async () => { server.closeAllConnections(); await new Promise((r) => server.close(r)); await an.close(); if (oa) await oa.close(); if (gm) await gm.close(); } };
}
const post = (base, p, body, headers = {}) => fetch(base + p, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) });
const sse = async (res) => (await res.text()).split('\n\n').filter(Boolean).map((b) => JSON.parse(b.replace(/^data: /, '')));
const U = (t, images) => ({ role: 'user', content: t, ...(images ? { images } : {}) });
const A = (t) => ({ role: 'assistant', content: t });
const PNG = { mime: 'image/png', data: PNG_1X1 };

test('Claude: streaming con la Messages API, cabeceras y modelos correctos', async () => {
  const t = await boot();
  try {
    const res = await post(t.base, '/api/chat', { model: 'fast', messages: [U('uno'), A('dos'), U('tres')] });
    assert.equal(res.status, 200); assert.equal(res.headers.get('x-ai-provider'), 'anthropic');
    const evs = await sse(res);
    assert.match(evs.filter((e) => e.text).map((e) => e.text).join(''), /Claude: 3 turnos, 0 imágenes, modelo claude-haiku-5-5/);
    assert.deepEqual([evs.at(-1).done, evs.at(-1).finish], [true, 'STOP']);
    const r = t.an.requests[0];
    assert.equal(r.headers['x-api-key'], 'test-anthropic'); assert.equal(r.headers['anthropic-version'], '2023-06-01');
    assert.equal(r.body.stream, true); assert.ok(r.body.max_tokens > 0); assert.ok(r.body.system.length > 50);
    assert.deepEqual(r.body.messages[1], { role: 'assistant', content: 'dos' });
    await (await post(t.base, '/api/chat', { model: 'pro', messages: [U('x')] })).text();
    assert.equal(t.an.requests[1].body.model, 'claude-sonnet-5-5');
  } finally { await t.close(); }
});

test('Claude: visión con bloques image antes del texto, y solo imagen', async () => {
  const t = await boot();
  try {
    await (await post(t.base, '/api/chat', { messages: [U('¿qué ves?', [PNG, PNG])] })).text();
    const c = t.an.requests[0].body.messages[0].content;
    assert.deepEqual(c.map((b) => b.type), ['image', 'image', 'text']);
    assert.deepEqual([c[0].source.type, c[0].source.media_type, c[0].source.data], ['base64', 'image/png', PNG_1X1]);
    await (await post(t.base, '/api/chat', { messages: [U('', [PNG])] })).text();
    assert.deepEqual(t.an.requests[1].body.messages[0].content.map((b) => b.type), ['image']);
  } finally { await t.close(); }
});

test('Claude: errores HTTP traducidos (clave, saldo, límite, saturación)', async () => {
  const bad = await boot({ env: { ANTHROPIC_API_KEY: 'sk-ant-mala' } });
  try {
    const r = await post(bad.base, '/api/chat', { messages: [U('hola')] });
    assert.equal(r.status, 502); const j = await r.json();
    assert.equal(j.error.code, 'provider_auth'); assert.ok(!JSON.stringify(j).includes('sk-ant-mala'));
  } finally { await bad.close(); }
  const t = await boot();
  try {
    const q = await post(t.base, '/api/chat', { messages: [U('ERROR_QUOTA')] });
    assert.equal(q.status, 503); const qj = await q.json(); assert.equal(qj.error.code, 'provider_quota'); assert.match(qj.error.message, /saldo/);
    const r = await post(t.base, '/api/chat', { messages: [U('ERROR429')] });
    assert.equal(r.status, 429); assert.match((await r.json()).error.message, /demasiadas solicitudes/);
    const o = await post(t.base, '/api/chat', { messages: [U('ERROR529')] });
    assert.equal(o.status, 503); assert.equal((await o.json()).error.code, 'provider_busy');
  } finally { await t.close(); }
});

test('Claude: error DENTRO del stream antes de texto → fallo de apertura (permite respaldo); después de texto → evento de error', async () => {
  const t = await boot();
  try {
    const a = await post(t.base, '/api/chat', { messages: [U('STREAMOVERLOAD')] });
    assert.equal(a.status, 503); assert.equal((await a.json()).error.code, 'provider_busy');
    const b = await sse(await post(t.base, '/api/chat', { messages: [U('MIDERR')] }));
    assert.ok(b.some((e) => e.text === 'Empiezo y ')); assert.ok(b.some((e) => e.error)); assert.ok(!b.some((e) => e.done));
  } finally { await t.close(); }
  const g = await boot({ gemini: true });
  try {
    const res = await post(g.base, '/api/chat', { messages: [U('STREAMOVERLOAD hola')] });
    assert.equal(res.status, 200); assert.equal(res.headers.get('x-ai-provider'), 'gemini'); await res.text();
  } finally { await g.close(); }
});

test('Claude: límite de longitud y rechazo del modelo llegan con su aviso', async () => {
  const t = await boot();
  try {
    assert.equal((await sse(await post(t.base, '/api/chat', { messages: [U('MAXTOK')] }))).find((e) => e.done).finish, 'MAX_TOKENS');
    const d = (await sse(await post(t.base, '/api/chat', { messages: [U('REFUSAL')] }))).find((e) => e.done);
    assert.equal(d.finish, 'SAFETY'); assert.match(d.note, /negó/);
  } finally { await t.close(); }
});

test('cadena de respaldo: OpenAI sin saldo → Claude; ambos sin saldo → Gemini', async () => {
  const t = await boot({ openai: true, gemini: true });
  try {
    const h = await (await fetch(t.base + '/api/health')).json();
    assert.deepEqual([h.provider, h.fallbacks], ['openai', ['anthropic', 'gemini']]);
    const a = await post(t.base, '/api/chat', { messages: [U('STREAMQUOTA hola')] });   // solo OpenAI falla
    assert.equal(a.headers.get('x-ai-provider'), 'anthropic');
    assert.match((await sse(a)).filter((e) => e.text).map((e) => e.text).join(''), /Claude: 1 turnos/);
    const b = await post(t.base, '/api/chat', { messages: [U('ERROR_QUOTA STREAMQUOTA hola')] });   // fallan OpenAI y Claude
    assert.equal(b.headers.get('x-ai-provider'), 'gemini'); await b.text();
  } finally { await t.close(); }
});

test('AI_PROVIDER y AI_FALLBACK controlan el orden; none lo desactiva', async () => {
  const t = await boot({ openai: true, gemini: true, env: { AI_PROVIDER: 'anthropic', AI_FALLBACK: 'gemini,openai' } });
  try {
    const h = await (await fetch(t.base + '/api/health')).json();
    assert.deepEqual([h.provider, h.fallbacks], ['anthropic', ['gemini', 'openai']]);
    const r = await post(t.base, '/api/chat', { messages: [U('ERROR_QUOTA hola')] });
    assert.equal(r.headers.get('x-ai-provider'), 'gemini'); await r.text();
  } finally { await t.close(); }
  const n = await boot({ openai: true, env: { AI_PROVIDER: 'anthropic', AI_FALLBACK: 'none' } });
  try {
    assert.equal((await post(n.base, '/api/chat', { messages: [U('ERROR_QUOTA')] })).status, 503);
  } finally { await n.close(); }
});

test('solo con Claude: chat y visión sí; crear imágenes no está disponible', async () => {
  const t = await boot();
  try {
    const h = await (await fetch(t.base + '/api/health')).json();
    assert.deepEqual([h.provider, h.imageGen, h.vision], ['anthropic', false, true]);
    const r = await post(t.base, '/api/image', { prompt: 'un gato' });
    assert.equal(r.status, 501); assert.equal((await r.json()).error.code, 'image_unavailable');
  } finally { await t.close(); }
});

test('ANTHROPIC_BASE_URL de otras herramientas NO se hereda (solo ANTHROPIC_API_BASE)', () => {
  const cfg = readConfig({ ANTHROPIC_API_KEY: 'k', ANTHROPIC_BASE_URL: 'https://proxy-ajeno.example' });
  assert.equal(cfg.anthropic.baseUrl, 'https://api.anthropic.com');
  assert.equal(readConfig({ ANTHROPIC_API_BASE: 'https://mi-proxy.example/' }).anthropic.baseUrl, 'https://mi-proxy.example');
});

test('la clave de Anthropic no aparece en respuestas ni en estáticos', async () => {
  const t = await boot();
  try {
    const bodies = [await (await post(t.base, '/api/chat', { messages: [U('hola')] })).text(), await (await fetch(t.base + '/api/health')).text(),
      await (await fetch(t.base + '/')).text(), await (await fetch(t.base + '/app.js')).text()];
    for (const b of bodies) assert.ok(!b.includes('test-anthropic'));
  } finally { await t.close(); }
});
