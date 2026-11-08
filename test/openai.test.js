'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createApp, readConfig } = require('../server');
const { startMockOpenAI, PNG_1X1 } = require('./mock-openai');
const { startMockGemini } = require('./mock-gemini');

async function boot({ gemini = false, env = {}, overrides = {} } = {}) {
  const oa = await startMockOpenAI();
  const gm = gemini ? await startMockGemini() : null;
  const e = { OPENAI_API_KEY: 'test-openai', OPENAI_API_BASE: oa.url, ...(gm ? { GEMINI_API_KEY: 'test-key', GEMINI_API_BASE: gm.url } : {}), ...env };
  const cfg = Object.assign(readConfig(e), overrides);
  const { server } = createApp(cfg);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  return { base: `http://127.0.0.1:${server.address().port}`, oa, gm, close: async () => { server.closeAllConnections(); await new Promise((r) => server.close(r)); await oa.close(); if (gm) await gm.close(); } };
}
const post = (base, p, body, headers = {}) => fetch(base + p, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: typeof body === 'string' ? body : JSON.stringify(body) });
const sse = async (res) => (await res.text()).split('\n\n').filter(Boolean).map((b) => JSON.parse(b.replace(/^data: /, '')));
const U = (t, images) => ({ role: 'user', content: t, ...(images ? { images } : {}) });
const A = (t) => ({ role: 'assistant', content: t });
const PNG = { mime: 'image/png', data: PNG_1X1 };
const JPG = { mime: 'image/jpeg', data: Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 16, 0x4a, 0x46, 0x49, 0x46]).toString('base64') };
const WEBP = { mime: 'image/webp', data: Buffer.concat([Buffer.from('RIFF'), Buffer.from([0, 0, 0, 0]), Buffer.from('WEBPVP8 ')]).toString('base64') };

test('OpenAI: chat en streaming con la API Responses, sin guardar en OpenAI', async () => {
  const t = await boot();
  try {
    const res = await post(t.base, '/api/chat', { model: 'fast', messages: [U('uno'), A('dos'), U('tres')] });
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('x-ai-provider'), 'openai');
    const evs = await sse(res);
    const text = evs.filter((e) => e.text).map((e) => e.text).join('');
    assert.match(text, /3 turnos, 0 imágenes, modelo gpt-4\.1-mini/);
    assert.equal(evs[evs.length - 1].done, true); assert.equal(evs[evs.length - 1].finish, 'STOP');
    const r = t.oa.requests[0];
    assert.equal(r.path, '/v1/responses'); assert.equal(r.auth, 'Bearer test-openai');
    assert.equal(r.body.stream, true); assert.equal(r.body.store, false);
    assert.ok(r.body.instructions.length > 50);
    assert.deepEqual(r.body.input[1], { role: 'assistant', content: 'dos' });
    const pro = await post(t.base, '/api/chat', { model: 'pro', messages: [U('x')] }); await pro.text();
    assert.equal(t.oa.requests[1].body.model, 'gpt-5');
  } finally { await t.close(); }
});

test('visión: las imágenes llegan al modelo como input_image (OpenAI y Gemini)', async () => {
  const t = await boot({ gemini: true });
  try {
    await (await post(t.base, '/api/chat', { messages: [U('¿qué ves?', [PNG, JPG, WEBP])] })).text();
    const content = t.oa.requests[0].body.input[0].content;
    assert.equal(content[0].type, 'input_text');
    assert.equal(content.filter((p) => p.type === 'input_image').length, 3);
    assert.match(content[1].image_url, /^data:image\/png;base64,/);

    const g = await boot({ env: { AI_PROVIDER: 'gemini', OPENAI_API_KEY: '' }, gemini: true });
    try {
      const evs = await sse(await post(g.base, '/api/chat', { messages: [U('mira', [PNG])] }));
      assert.match(evs.filter((e) => e.text).map((e) => e.text).join(''), /Imágenes: 1/);
      const part = g.gm.requests[0].body.contents[0].parts.find((p) => p.inlineData);
      assert.equal(part.inlineData.mimeType, 'image/png');
    } finally { await g.close(); }
  } finally { await t.close(); }
});

test('imagen sin texto es válida (solo la foto)', async () => {
  const t = await boot();
  try {
    const res = await post(t.base, '/api/chat', { messages: [U('', [PNG])] });
    assert.equal(res.status, 200); await res.text();
    assert.equal(t.oa.requests[0].body.input[0].content.length, 1);
  } finally { await t.close(); }
});

test('seguridad de archivos: rechaza tipo falso, contenido falso, base64 inválido, exceso y tamaño', async () => {
  const t = await boot({ overrides: { maxImageBytes: 100 } });
  try {
    const bad = async (images, re) => {
      const r = await post(t.base, '/api/chat', { messages: [U('x', images)] });
      assert.equal(r.status, 400); assert.match((await r.json()).error.message, re);
    };
    await bad([{ mime: 'image/gif', data: PNG.data }], /JPG, PNG o WEBP/);
    await bad([{ mime: 'image/svg+xml', data: Buffer.from('<svg onload=alert(1)>').toString('base64') }], /JPG, PNG o WEBP/);
    await bad([{ mime: 'image/png', data: Buffer.from('MZ ejecutable disfrazado').toString('base64') }], /no coincide/);
    await bad([{ mime: 'image/jpeg', data: PNG.data }], /no coincide/);
    await bad([{ mime: 'image/png', data: 'esto no es base64!!' }], /codificada/);
    await bad([{ mime: 'image/png', data: Buffer.alloc(200, 1).toString('base64') }], /tamaño máximo/);
    await bad(Array(7).fill(PNG), /Demasiadas imágenes/);
    await bad('no-es-lista', /inválido/);
    const asst = await post(t.base, '/api/chat', { messages: [{ role: 'assistant', content: 'x', images: [PNG] }, U('y')] });
    assert.equal(asst.status, 400);
    assert.equal(t.oa.requests.length, 0, 'nada llegó al proveedor');
  } finally { await t.close(); }
});

test('errores de OpenAI: sin saldo, límite, saturación y clave inválida', async () => {
  const t = await boot();
  try {
    const q = await post(t.base, '/api/chat', { messages: [U('ERROR_QUOTA')] });
    assert.equal(q.status, 503); const qj = await q.json(); assert.equal(qj.error.code, 'provider_quota'); assert.match(qj.error.message, /saldo/);
    const r = await post(t.base, '/api/chat', { messages: [U('ERROR429')] });
    assert.equal(r.status, 429); assert.match((await r.json()).error.message, /demasiadas solicitudes/);
    const b = await post(t.base, '/api/chat', { messages: [U('ERROR500')] });
    assert.equal(b.status, 503); assert.equal((await b.json()).error.code, 'provider_busy');
  } finally { await t.close(); }
  const bad = await boot({ env: { OPENAI_API_KEY: 'sk-incorrecta' } });
  try {
    const res = await post(bad.base, '/api/chat', { messages: [U('hola')] });
    assert.equal(res.status, 502); const j = await res.json(); assert.equal(j.error.code, 'provider_auth');
    assert.ok(!JSON.stringify(j).includes('sk-incorrecta'));
  } finally { await bad.close(); }
});

test('sin saldo anunciado DENTRO del stream (200 + evento error): mensaje claro y respaldo a Gemini', async () => {
  const solo = await boot();
  try {
    const res = await post(solo.base, '/api/chat', { messages: [U('STREAMQUOTA')] });
    assert.equal(res.status, 503, 'se traduce a error HTTP porque aún no se envió nada al usuario');
    const j = await res.json();
    assert.equal(j.error.code, 'provider_quota'); assert.match(j.error.message, /saldo/);
  } finally { await solo.close(); }
  const t = await boot({ gemini: true });
  try {
    const res = await post(t.base, '/api/chat', { messages: [U('STREAMQUOTA hola')] });
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('x-ai-provider'), 'gemini');
    assert.match((await sse(res)).filter((e) => e.text).map((e) => e.text).join(''), /Turnos recibidos: 1/);
  } finally { await t.close(); }
});

test('respaldo: si OpenAI se queda sin saldo, la app responde con Gemini', async () => {
  const t = await boot({ gemini: true });
  try {
    const res = await post(t.base, '/api/chat', { messages: [U('ERROR_QUOTA hola')] });
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('x-ai-provider'), 'gemini');
    assert.match((await sse(res)).filter((e) => e.text).map((e) => e.text).join(''), /Turnos recibidos: 1/);
    // Un error que no es de cuota (p. ej. petición inválida) no activa el respaldo
    const ok = await post(t.base, '/api/chat', { messages: [U('normal')] });
    assert.equal(ok.headers.get('x-ai-provider'), 'openai'); await ok.text();
  } finally { await t.close(); }
});

test('AI_FALLBACK=none desactiva el respaldo; AI_PROVIDER=gemini invierte el orden', async () => {
  const t = await boot({ gemini: true, env: { AI_FALLBACK: 'none' } });
  try {
    const res = await post(t.base, '/api/chat', { messages: [U('ERROR_QUOTA')] });
    assert.equal(res.status, 503); await res.json();
    const h = await (await fetch(t.base + '/api/health')).json();
    assert.equal(h.provider, 'openai'); assert.equal(h.fallback, null);
  } finally { await t.close(); }
  const g = await boot({ gemini: true, env: { AI_PROVIDER: 'gemini' } });
  try {
    const res = await post(g.base, '/api/chat', { messages: [U('hola')] });
    assert.equal(res.headers.get('x-ai-provider'), 'gemini'); await res.text();
    const h = await (await fetch(g.base + '/api/health')).json();
    assert.deepEqual([h.provider, h.fallback, h.imageGen], ['gemini', 'openai', true]);
  } finally { await g.close(); }
});

test('OpenAI: respuesta cortada por longitud y fallo a mitad de stream', async () => {
  const t = await boot();
  try {
    const a = await sse(await post(t.base, '/api/chat', { messages: [U('MAXTOK')] }));
    assert.equal(a.find((e) => e.done).finish, 'MAX_TOKENS');
    const b = await sse(await post(t.base, '/api/chat', { messages: [U('FAILED')] }));
    assert.ok(b.some((e) => e.text === 'Empiezo y ')); assert.ok(b.some((e) => e.error)); assert.ok(!b.some((e) => e.done));
  } finally { await t.close(); }
});

test('imágenes: crear (generations) devuelve PNG en base64', async () => {
  const t = await boot();
  try {
    const res = await post(t.base, '/api/image', { prompt: 'un gato astronauta', size: '1024x1024', quality: 'high' });
    assert.equal(res.status, 200);
    const j = await res.json();
    assert.equal(j.edited, false); assert.equal(j.images[0].mime, 'image/png'); assert.equal(j.images[0].data, PNG_1X1);
    const r = t.oa.requests[0];
    assert.equal(r.path, '/v1/images/generations');
    assert.deepEqual([r.body.model, r.body.size, r.body.quality, r.body.n], ['gpt-image-1', '1024x1024', 'high', 1]);
    assert.equal(r.body.background, undefined);
  } finally { await t.close(); }
});

test('imágenes: parámetros inválidos se normalizan y "quita el fondo" pide PNG transparente', async () => {
  const t = await boot();
  try {
    await (await post(t.base, '/api/image', { prompt: 'logo con fondo transparente', size: '9999x9999', quality: 'ultra' })).json();
    const b = t.oa.requests[0].body;
    assert.equal(b.size, 'auto'); assert.equal(b.quality, 'medium');   // valores por defecto seguros
    assert.equal(b.background, 'transparent'); assert.equal(b.output_format, 'png');
  } finally { await t.close(); }
});

test('imágenes: editar envía multipart con las imágenes y el prompt a /v1/images/edits', async () => {
  const t = await boot();
  try {
    const res = await post(t.base, '/api/image', { prompt: 'quita el fondo', images: [PNG, JPG] });
    assert.equal(res.status, 200); assert.equal((await res.json()).edited, true);
    const r = t.oa.requests[0];
    assert.equal(r.path, '/v1/images/edits'); assert.match(r.ctype, /multipart\/form-data/);
    assert.equal((r.raw.match(/name="image\[\]"/g) || []).length, 2);
    assert.match(r.raw, /name="prompt"\r\n\r\nquita el fondo/);
    assert.match(r.raw, /name="model"\r\n\r\ngpt-image-1/);
    assert.match(r.raw, /name="background"\r\n\r\ntransparent/);
    assert.match(r.raw, /filename="imagen1\.png"/); assert.match(r.raw, /filename="imagen2\.jpg"/);
  } finally { await t.close(); }
});

test('imágenes: validación, política de contenido y disponibilidad', async () => {
  const t = await boot();
  try {
    assert.equal((await post(t.base, '/api/image', { prompt: '   ' })).status, 400);
    assert.equal((await post(t.base, '/api/image', { prompt: 'x'.repeat(4001) })).status, 400);
    assert.equal((await post(t.base, '/api/image', { prompt: 'x', images: [{ mime: 'image/png', data: Buffer.from('MZ').toString('base64') }] })).status, 400);
    assert.equal((await post(t.base, '/api/image', { prompt: 'x', images: Array(5).fill(PNG) })).status, 400);
    const pol = await post(t.base, '/api/image', { prompt: 'POLICY' });
    assert.equal(pol.status, 422); assert.equal((await pol.json()).error.code, 'content_policy');
    const pol2 = await post(t.base, '/api/image', { prompt: 'POLICY', images: [PNG] });
    assert.equal(pol2.status, 422);
    assert.equal((await post(t.base, '/api/image', { prompt: 'x' }, { origin: 'https://otro.example' })).status, 403);
    assert.equal((await fetch(t.base + '/api/image')).status, 405);
  } finally { await t.close(); }
  const g = await boot({ env: { OPENAI_API_KEY: '' }, gemini: true });
  try {
    const res = await post(g.base, '/api/image', { prompt: 'un gato' });
    assert.equal(res.status, 501); assert.equal((await res.json()).error.code, 'image_unavailable');
    assert.equal((await (await fetch(g.base + '/api/health')).json()).imageGen, false);
  } finally { await g.close(); }
});

test('imágenes: límites propios (más estrictos) y separados del chat', async () => {
  const t = await boot({ overrides: { imageLimits: { perMinute: 2, perDay: 100, globalPerDay: 100, maxConcurrent: 1 } } });
  try {
    for (let i = 0; i < 2; i++) assert.equal((await post(t.base, '/api/image', { prompt: 'a' })).status, 200);
    const r = await post(t.base, '/api/image', { prompt: 'a' });
    assert.equal(r.status, 429); assert.equal((await r.json()).error.code, 'rate_limit');
    const chat = await post(t.base, '/api/chat', { messages: [U('hola')] });   // el chat sigue funcionando
    assert.equal(chat.status, 200); await chat.text();
  } finally { await t.close(); }
  const d = await boot({ overrides: { imageLimits: { perMinute: 50, perDay: 1, globalPerDay: 100, maxConcurrent: 1 } } });
  try {
    await (await post(d.base, '/api/image', { prompt: 'a' })).json();
    assert.equal((await (await post(d.base, '/api/image', { prompt: 'a' })).json()).error.code, 'daily_limit');
  } finally { await d.close(); }
});

test('la clave de OpenAI no aparece en ninguna respuesta ni archivo estático', async () => {
  const t = await boot({ env: { OPENAI_API_KEY: 'test-openai' } });
  try {
    const bodies = [await (await post(t.base, '/api/chat', { messages: [U('hola')] })).text(), await (await fetch(t.base + '/api/health')).text(),
      await (await post(t.base, '/api/image', { prompt: 'x' })).text(), await (await fetch(t.base + '/')).text(), await (await fetch(t.base + '/app.js')).text()];
    for (const b of bodies) assert.ok(!b.includes('test-openai'));
  } finally { await t.close(); }
});
