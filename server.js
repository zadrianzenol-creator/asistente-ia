'use strict';
/**
 * Servidor: sirve la app estática y hace de proxy seguro hacia los proveedores de IA.
 * Sin dependencias externas (Node 18+).
 */
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');
const { createLimiter } = require('./lib/limits');
const { createProviders, openChatStream } = require('./lib/providers');
const { validateImages } = require('./lib/images');

/* ---------- .env mínimo (sin dependencias) ---------- */
function loadEnvFile(file) {
  try {
    for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
      if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
    }
  } catch (e) { /* sin .env: se usan variables del entorno */ }
}

function readConfig(env = process.env) {
  const int = (v, d) => (Number.isFinite(parseInt(v, 10)) ? parseInt(v, 10) : d);
  return {
    port: int(env.PORT, 3000),
    provider: (env.AI_PROVIDER || '').toLowerCase(),          // openai | anthropic | gemini (vacío = el primero con clave)
    fallback: (env.AI_FALLBACK || '').toLowerCase(),          // none | lista (p. ej. anthropic,gemini); vacío = los demás con clave
    openai: {
      apiKey: env.OPENAI_API_KEY || '',
      baseUrl: (env.OPENAI_API_BASE || 'https://api.openai.com').replace(/\/$/, ''),
      models: { fast: env.OPENAI_MODEL_FAST || 'gpt-4.1-mini', pro: env.OPENAI_MODEL_PRO || 'gpt-5' },
      imageModel: env.OPENAI_IMAGE_MODEL || 'gpt-image-1'
    },
    // Nombres propios (ANTHROPIC_API_BASE, no ANTHROPIC_BASE_URL) para no heredar variables de otras herramientas.
    anthropic: {
      apiKey: env.ANTHROPIC_API_KEY || '',
      baseUrl: (env.ANTHROPIC_API_BASE || 'https://api.anthropic.com').replace(/\/$/, ''),
      models: { fast: env.ANTHROPIC_MODEL_FAST || 'claude-haiku-5-5', pro: env.ANTHROPIC_MODEL_PRO || 'claude-sonnet-5-5' }
    },
    gemini: {
      apiKey: env.GEMINI_API_KEY || '',
      baseUrl: (env.GEMINI_API_BASE || 'https://generativelanguage.googleapis.com').replace(/\/$/, ''),
      models: { fast: env.GEMINI_MODEL_FAST || 'gemini-flash-lite-latest', pro: env.GEMINI_MODEL_PRO || 'gemini-3.8-flash' },
      search: env.GEMINI_SEARCH === '1'
    },
    trustProxy: env.TRUST_PROXY === '1',
    operator: (env.OPERATOR || '').trim().slice(0, 200),     // responsable del servicio, se muestra en la página de privacidad
    maxOutputTokens: int(env.MAX_OUTPUT_TOKENS, 4096),
    temperature: Number.isFinite(parseFloat(env.TEMPERATURE)) ? parseFloat(env.TEMPERATURE) : 0.7,
    imageQuality: ['low', 'medium', 'high', 'auto'].includes(env.IMAGE_QUALITY) ? env.IMAGE_QUALITY : 'medium',
    limits: {
      perMinute: int(env.RATE_PER_MINUTE, 12),
      perDay: int(env.RATE_PER_DAY, 150),
      globalPerDay: int(env.RATE_GLOBAL_PER_DAY, 1500),
      maxConcurrent: int(env.MAX_CONCURRENT_PER_IP, 2)
    },
    // Las imágenes cuestan dinero real por uso: límites propios y más estrictos.
    imageLimits: {
      perMinute: int(env.IMAGE_PER_MINUTE, 3),
      perDay: int(env.IMAGE_PER_DAY, 10),
      globalPerDay: int(env.IMAGE_GLOBAL_PER_DAY, 200),
      maxConcurrent: 1
    },
    maxBodyBytes: int(env.MAX_BODY_BYTES, 28 * 1024 * 1024),
    maxImages: 6,
    maxImageBytes: int(env.MAX_IMAGE_BYTES, 5 * 1024 * 1024),
    maxImagesTotalBytes: int(env.MAX_IMAGES_TOTAL_BYTES, 20 * 1024 * 1024),
    maxMessages: 60,
    maxMessageChars: 20000,
    maxDocs: 3,                                                // documentos por mensaje
    maxDocChars: int(env.MAX_DOC_CHARS, 120000),              // caracteres de texto por documento
    maxDocsTotalChars: int(env.MAX_DOCS_TOTAL_CHARS, 240000), // total por solicitud
    maxContextChars: int(env.MAX_CONTEXT_CHARS, 60000),
    bodyTimeoutMs: int(env.BODY_TIMEOUT_MS, 120000),          // tiempo máximo para recibir un cuerpo (protege de cargas lentas)
    maxInflightBodies: int(env.MAX_INFLIGHT_BODIES, 24),      // cuerpos grandes leyéndose a la vez en todo el servidor
    upstreamTimeoutMs: int(env.UPSTREAM_TIMEOUT_MS, 120000),
    imageTimeoutMs: int(env.IMAGE_TIMEOUT_MS, 180000),
    publicDir: path.join(__dirname, 'public')
  };
}

const MIME = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.txt': 'text/plain; charset=utf-8'
};

const CSP = [
  "default-src 'self'", "script-src 'self'", "style-src 'self' 'unsafe-inline'",   // KaTeX genera estilos en línea
  "img-src 'self' data: blob:", "font-src 'self'", "connect-src 'self'", "worker-src 'self'", "manifest-src 'self'",
  "object-src 'none'", "base-uri 'none'", "form-action 'self'", "frame-ancestors 'none'"
].join('; ');

function securityHeaders(res, req, cfg) {
  // Solo si la petición llegó por HTTPS a través del proxy de confianza (si no, se bloquearía el acceso por HTTP en desarrollo).
  if (cfg && cfg.trustProxy && req && req.headers['x-forwarded-proto'] === 'https') res.setHeader('Strict-Transport-Security', 'max-age=15552000');
  res.setHeader('Content-Security-Policy', CSP);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Permissions-Policy', 'camera=(), geolocation=(), microphone=(self)');
}

function sendJson(res, status, obj, headers) {
  const body = JSON.stringify(obj);
  res.writeHead(status, Object.assign({ 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'content-length': Buffer.byteLength(body) }, headers));
  res.end(body);
}
const fail = (res, status, code, message, headers) => sendJson(res, status, { error: { code, message } }, headers);

function clientIp(req, cfg) {
  if (cfg.trustProxy) {
    const xf = req.headers['x-forwarded-for'];
    if (xf) return String(xf).split(',')[0].trim();
  }
  return req.socket.remoteAddress || 'unknown';
}

function readBody(req, max, timeoutMs) {
  return new Promise((resolve, reject) => {
    let size = 0, done = false; const chunks = [];
    const finish = (fn, v) => { if (done) return; done = true; clearTimeout(timer); fn(v); };
    const timer = setTimeout(() => finish(reject, Object.assign(new Error('timeout'), { code: 'timeout' })), timeoutMs || 120000);
    req.on('data', (c) => {
      if (done) return;   // ya se respondió: se descarta lo que siga llegando
      size += c.length;
      if (size > max) { finish(reject, Object.assign(new Error('too_large'), { code: 'too_large' })); return; }
      chunks.push(c);
    });
    req.on('end', () => finish(resolve, Buffer.concat(chunks).toString('utf8')));
    req.on('error', (e) => finish(reject, e));
    req.on('close', () => finish(reject, Object.assign(new Error('aborted'), { code: 'aborted' })));
  });
}

/** Valida los documentos (texto ya extraído en el navegador). Devuelve { docs } o { error }. */
function validateDocs(list, cfg) {
  if (list == null) return { docs: [] };
  if (!Array.isArray(list)) return { error: 'Formato de documentos inválido.' };
  if (list.length > cfg.maxDocs) return { error: `Demasiados documentos en un mensaje (máximo ${cfg.maxDocs}).` };
  const docs = [];
  for (const d of list) {
    if (!d || typeof d.name !== 'string' || typeof d.text !== 'string') return { error: 'Formato de documento inválido.' };
    const text = d.text.replace(/\u0000/g, '');
    if (text.length > cfg.maxDocChars) return { error: `Un documento supera los ${cfg.maxDocChars} caracteres de texto.` };
    docs.push({ name: d.name.replace(/[\u0000-\u001f"<>]/g, ' ').trim().slice(0, 120) || 'documento', text });
  }
  return { docs };
}
/** Envuelve los documentos en etiquetas; el texto no puede cerrar la etiqueta antes de tiempo. */
function docsToText(docs) {
  return docs.map((d) => `<documento nombre="${d.name}">\n${d.text.replace(/<\/documento/gi, '<\\/documento')}\n</documento>`).join('\n\n');
}

/** Valida y recorta el historial. Devuelve { messages, model } o { error }. */
function validateChat(body, cfg) {
  if (!body || typeof body !== 'object') return { error: 'Cuerpo inválido.' };
  const model = body.model === 'pro' ? 'pro' : 'fast';
  const msgs = body.messages;
  if (!Array.isArray(msgs) || msgs.length < 1) return { error: 'Falta el historial de mensajes.' };
  if (msgs.length > cfg.maxMessages) return { error: `Demasiados mensajes (máximo ${cfg.maxMessages}).` };
  const clean = []; let imageCount = 0, imageBytes = 0, docChars = 0;
  for (const m of msgs) {
    if (!m || (m.role !== 'user' && m.role !== 'assistant') || typeof m.content !== 'string') return { error: 'Formato de mensaje inválido.' };
    const content = m.content.replace(/\u0000/g, '');
    if (content.length > cfg.maxMessageChars) return { error: `Un mensaje supera los ${cfg.maxMessageChars} caracteres.` };
    let images = [];
    if (m.images != null) {
      if (m.role !== 'user') return { error: 'Solo los mensajes del usuario pueden llevar imágenes.' };
      const v = validateImages(m.images, { maxImages: cfg.maxImages, maxImageBytes: cfg.maxImageBytes, maxTotalBytes: cfg.maxImagesTotalBytes });
      if (v.error) return { error: v.error };
      images = v.images;
    }
    let docsText = '';
    if (m.docs != null) {
      if (m.role !== 'user') return { error: 'Solo los mensajes del usuario pueden llevar documentos.' };
      const dv = validateDocs(m.docs, cfg);
      if (dv.error) return { error: dv.error };
      docChars += dv.docs.reduce((n, d) => n + d.text.length, 0);
      if (docChars > cfg.maxDocsTotalChars) return { error: 'Los documentos adjuntos son demasiado extensos en total. Adjunta menos o pide un resumen por partes.' };
      docsText = docsToText(dv.docs);
    }
    imageCount += images.length; imageBytes += images.reduce((n, i) => n + i.buffer.length, 0);
    if (imageCount > cfg.maxImages) return { error: `Demasiadas imágenes en la conversación (máximo ${cfg.maxImages}).` };
    if (imageBytes > cfg.maxImagesTotalBytes) return { error: 'Las imágenes adjuntas pesan demasiado en total.' };
    if (!content.trim() && !images.length && !docsText) continue;
    const prev = clean[clean.length - 1];
    if (prev && prev.role === m.role) {   // el proveedor espera turnos alternados
      prev.content = [prev.content, content].filter(Boolean).join('\n\n'); prev.images = (prev.images || []).concat(images);
      prev.docsText = [prev.docsText, docsText].filter(Boolean).join('\n\n');
    } else clean.push({ role: m.role, content, images, docsText });
  }
  if (!clean.length || clean[clean.length - 1].role !== 'user') return { error: 'El último mensaje debe ser del usuario.' };
  let total = clean.reduce((n, m) => n + m.content.length, 0);
  while (total > cfg.maxContextChars && clean.length > 1) total -= clean.shift().content.length;
  while (clean.length > 1 && clean[0].role !== 'user') clean.shift();
  // Los documentos van antes de la pregunta del usuario.
  for (const m of clean) { if (m.docsText) m.content = m.docsText + (m.content ? '\n\n' + m.content : ''); delete m.docsText; }
  return { messages: clean, model };
}

function validateImageRequest(body, cfg) {
  if (!body || typeof body !== 'object') return { error: 'Cuerpo inválido.' };
  const prompt = typeof body.prompt === 'string' ? body.prompt.replace(/\u0000/g, '').trim() : '';
  if (!prompt) return { error: 'Escribe qué imagen quieres crear o cómo editarla.' };
  if (prompt.length > 4000) return { error: 'La descripción es demasiado larga (máximo 4000 caracteres).' };
  const v = validateImages(body.images, { maxImages: 4, maxImageBytes: cfg.maxImageBytes, maxTotalBytes: cfg.maxImagesTotalBytes });
  if (v.error) return { error: v.error };
  return { prompt, images: v.images, size: body.size, quality: body.quality };
}

const COMPRESSIBLE = new Set(['.html', '.css', '.js', '.mjs', '.json', '.webmanifest', '.svg', '.txt']);
const zcache = new Map();
let zcacheBytes = 0;

function createApp(cfg = readConfig()) {
  const limiter = createLimiter(cfg.limits);
  const imageLimiter = createLimiter(cfg.imageLimits);
  const providers = createProviders(cfg);
  const timers = [setInterval(() => { limiter.sweep(); imageLimiter.sweep(); }, 60000)]; timers.forEach((t) => t.unref());

  function originOk(req) {
    const origin = req.headers.origin; if (!origin) return true;
    try { return new URL(origin).host === req.headers.host; } catch (e) { return false; }
  }

  /** Comprobaciones comunes de las rutas POST de IA. Devuelve la IP o null si ya respondió. */
  function gate(req, res, lim) {
    if (!originOk(req)) { fail(res, 403, 'forbidden_origin', 'Origen no permitido.'); return null; }
    if (!/^application\/json/i.test(req.headers['content-type'] || '')) { fail(res, 415, 'bad_type', 'Se esperaba JSON.'); return null; }
    if (!providers.primary) { fail(res, 503, 'not_configured', 'El servidor aún no tiene configurada ninguna clave de IA (OPENAI_API_KEY, ANTHROPIC_API_KEY o GEMINI_API_KEY).'); return null; }
    const ip = clientIp(req, cfg);
    const r = lim.check(ip);
    if (!r.ok) { fail(res, r.status, r.code, r.message, { 'retry-after': String(r.retryAfter) }); return null; }
    return ip;
  }
  let inflight = 0;
  async function parseJson(req, res) {
    if (inflight >= cfg.maxInflightBodies) { fail(res, 503, 'service_busy', 'El servidor está recibiendo muchas solicitudes grandes. Inténtalo de nuevo en unos segundos.', { 'retry-after': '5' }); return undefined; }
    inflight++;
    try { return JSON.parse(await readBody(req, cfg.maxBodyBytes, cfg.bodyTimeoutMs)); }
    catch (e) {
      // Se responde primero y la conexión se cierra después (si no, el cliente vería un corte sin explicación).
      const closeAfter = () => res.once('finish', () => req.destroy());
      if (e.code === 'too_large') { closeAfter(); fail(res, 413, 'too_large', 'La solicitud es demasiado grande. Prueba con menos o con imágenes más pequeñas.', { connection: 'close' }); }
      else if (e.code === 'timeout') { if (!res.writableEnded && !res.destroyed) { closeAfter(); fail(res, 408, 'timeout', 'La solicitud tardó demasiado en llegar.', { connection: 'close' }); } }
      else if (e.code === 'aborted') { /* el cliente cerró la conexión */ }
      else fail(res, 400, 'bad_json', 'JSON inválido.');
      return undefined;
    } finally { inflight--; }
  }

  async function handleChat(req, res) {
    const ip = gate(req, res, limiter); if (!ip) return;
    const parsed = await parseJson(req, res); if (parsed === undefined) return;
    const v = validateChat(parsed, cfg);
    if (v.error) return fail(res, 400, 'invalid', v.error);

    limiter.consume(ip); limiter.begin(ip);
    let ended = false;
    const finish = () => { if (!ended) { ended = true; limiter.end(ip); } };
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), cfg.upstreamTimeoutMs);
    res.on('close', () => { clearTimeout(timer); ac.abort(); finish(); });

    const up = await openChatStream(providers, { modelTier: v.model, messages: v.messages, signal: ac.signal });
    if (!up.ok) {
      finish();
      if (up.aborted) { if (!res.writableEnded) res.end(); return; }
      const h = up.error.retryAfter ? { 'retry-after': String(up.error.retryAfter) } : undefined;
      return fail(res, up.error.status, up.error.code, up.error.message, h);
    }

    res.writeHead(200, { 'content-type': 'text/event-stream; charset=utf-8', 'cache-control': 'no-store, no-transform', connection: 'keep-alive', 'x-accel-buffering': 'no', 'x-ai-provider': up.provider, ...(up.degraded ? { 'x-ai-degraded': '1' } : {}) });
    const send = (o) => { if (!res.writableEnded) res.write('data: ' + JSON.stringify(o) + '\n\n'); };
    try {
      for await (const ev of up.events) {
        if (ev.text) send({ text: ev.text });
        else if (ev.error) send({ error: ev.error });
        else if (ev.done) send({ done: true, finish: ev.finish, blocked: ev.blocked || null, note: ev.note || null });
      }
    } catch (err) {
      if (err.name !== 'AbortError') send({ error: { code: 'stream_error', message: 'Se interrumpió la respuesta del proveedor de IA.' } });
      else if (!res.writableEnded && ac.signal.aborted && !res.destroyed) send({ error: { code: 'timeout', message: 'La respuesta tardó demasiado y se canceló.' } });
    } finally {
      finish(); if (!res.writableEnded) res.end();
    }
  }

  async function handleImage(req, res) {
    if (!providers.imageProvider) {
      // Se comprueba antes de leer el cuerpo para no procesar imágenes inútilmente.
      if (!originOk(req)) return fail(res, 403, 'forbidden_origin', 'Origen no permitido.');
      return fail(res, 501, 'image_unavailable', 'Crear o editar imágenes no está disponible en este servidor (requiere configurar OpenAI).');
    }
    const ip = gate(req, res, imageLimiter); if (!ip) return;
    const parsed = await parseJson(req, res); if (parsed === undefined) return;
    const v = validateImageRequest(parsed, cfg);
    if (v.error) return fail(res, 400, 'invalid', v.error);

    imageLimiter.consume(ip); imageLimiter.begin(ip);
    let ended = false;
    const finish = () => { if (!ended) { ended = true; imageLimiter.end(ip); } };
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), cfg.imageTimeoutMs);
    res.on('close', () => { clearTimeout(timer); ac.abort(); finish(); });
    try {
      const out = await providers.imageProvider.createImage({ prompt: v.prompt, images: v.images, size: v.size, quality: v.quality, signal: ac.signal });
      if (out.aborted) { if (!res.writableEnded && !res.destroyed) fail(res, 504, 'timeout', 'La imagen tardó demasiado y se canceló.'); return; }
      if (!out.ok) { const h = out.error.retryAfter ? { 'retry-after': String(out.error.retryAfter) } : undefined; return fail(res, out.error.status, out.error.code, out.error.message, h); }
      sendJson(res, 200, { images: out.images, edited: v.images.length > 0 });
    } catch (err) {
      fail(res, 502, 'provider_error', 'No se pudo completar la imagen.');
    } finally { clearTimeout(timer); finish(); }
  }

  /** Página de privacidad con el responsable del servicio (variable OPERATOR) en lugar del marcador. */
  function servePrivacy(req, res, file) {
    fs.readFile(file, 'utf8', (err, html) => {
      if (err) { res.writeHead(404); return res.end(); }
      const safe = cfg.operator.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
      const body = Buffer.from(html.replace('[completa aquí el nombre y un contacto]', safe));
      res.writeHead(200, { 'content-type': MIME['.html'], 'cache-control': 'no-cache', 'content-length': body.length });
      res.end(req.method === 'HEAD' ? undefined : body);
    });
  }

  function serveStatic(req, res, urlPath) {
    let rel;
    try { rel = decodeURIComponent(urlPath); } catch (e) { res.writeHead(400); return res.end(); }
    if (rel.endsWith('/')) rel += 'index.html';
    const file = path.normalize(path.join(cfg.publicDir, rel));
    if (!file.startsWith(cfg.publicDir + path.sep)) { res.writeHead(403); return res.end('Forbidden'); }
    if (cfg.operator && file === path.join(cfg.publicDir, 'privacidad.html')) return servePrivacy(req, res, file);
    fs.stat(file, (err, st) => {
      if (err || !st.isFile()) {
        if (!path.extname(rel)) return serveStatic(req, res, '/index.html');
        res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' }); return res.end('No encontrado');
      }
      const ext = path.extname(file).toLowerCase();
      const noCache = ext === '.html' || ext === '.webmanifest' || file.endsWith(path.sep + 'sw.js');
      const etag = 'W/"' + st.size.toString(16) + '-' + Math.floor(st.mtimeMs).toString(16) + '"';
      const headers = { 'content-type': MIME[ext] || 'application/octet-stream', 'cache-control': noCache ? 'no-cache' : 'public, max-age=3600', etag, vary: 'Accept-Encoding' };
      if (req.headers['if-none-match'] === etag) { res.writeHead(304, headers); return res.end(); }
      const ae = String(req.headers['accept-encoding'] || '');
      const enc = COMPRESSIBLE.has(ext) && st.size > 1024 ? (/\bbr\b/.test(ae) ? 'br' : /\bgzip\b/.test(ae) ? 'gzip' : null) : null;
      if (!enc) {
        res.writeHead(200, { ...headers, 'content-length': st.size });
        if (req.method === 'HEAD') return res.end();
        return fs.createReadStream(file).pipe(res);
      }
      const key = file + '|' + etag + '|' + enc, hit = zcache.get(key);
      const send = (buf) => { res.writeHead(200, { ...headers, 'content-encoding': enc, 'content-length': buf.length }); res.end(req.method === 'HEAD' ? undefined : buf); };
      if (hit) return send(hit);
      fs.readFile(file, (e2, data) => {
        if (e2) { res.writeHead(500); return res.end(); }
        const done = (e3, buf) => {
          if (e3) { res.writeHead(500); return res.end(); }
          if (zcacheBytes + buf.length < 32 * 1024 * 1024) { zcache.set(key, buf); zcacheBytes += buf.length; }
          send(buf);
        };
        if (enc === 'br') zlib.brotliCompress(data, { params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 5 } }, done); else zlib.gzip(data, { level: 6 }, done);
      });
    });
  }

  const server = http.createServer(async (req, res) => {
    securityHeaders(res, req, cfg);
    let pathname;
    try { pathname = new URL(req.url, 'http://x').pathname; } catch (e) { res.writeHead(400); return res.end(); }
    try {
      if (pathname === '/api/health' && req.method === 'GET') {
        return sendJson(res, 200, {
          ok: true, configured: !!providers.primary,
          provider: providers.primary && providers.primary.name, fallback: providers.fallback && providers.fallback.name, fallbacks: providers.fallbacks.map((f) => f.name),
          vision: true, imageGen: !!providers.imageProvider
        });
      }
      if (pathname === '/api/chat' || pathname === '/api/image') {
        if (req.method !== 'POST') return fail(res, 405, 'method', 'Método no permitido.', { allow: 'POST' });
        return await (pathname === '/api/chat' ? handleChat(req, res) : handleImage(req, res));
      }
      if (pathname.startsWith('/api/')) return fail(res, 404, 'not_found', 'No encontrado.');
      if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405); return res.end(); }
      return serveStatic(req, res, pathname);
    } catch (err) {
      console.error('Error no controlado:', err && err.message);
      if (!res.headersSent) fail(res, 500, 'internal', 'Error interno del servidor.');
      else res.end();
    }
  });
  server.requestTimeout = 0;   // las respuestas en streaming pueden durar más de 5 min
  server.headersTimeout = 20000;
  return { server, limiter, imageLimiter, providers };
}

if (require.main === module) {
  loadEnvFile(path.join(__dirname, '.env'));
  const cfg = readConfig();
  const { server, providers } = createApp(cfg);
  // Cierre ordenado (los hostings envían SIGTERM al reiniciar): deja de aceptar conexiones y espera a que terminen las respuestas en curso.
  let closing = false;
  const shutdown = (sig) => {
    if (closing) return; closing = true;
    console.log(`${sig} recibido: cerrando…`);
    server.close(() => process.exit(0));
    server.closeIdleConnections && server.closeIdleConnections();
    setTimeout(() => { server.closeAllConnections && server.closeAllConnections(); process.exit(0); }, 10000).unref();
  };
  process.on('SIGTERM', () => shutdown('SIGTERM')); process.on('SIGINT', () => shutdown('SIGINT'));
  server.listen(cfg.port, () => {
    console.log(`Servidor listo en http://localhost:${cfg.port}`);
    if (!providers.primary) console.warn('Aviso: no hay ninguna clave (OPENAI_API_KEY, ANTHROPIC_API_KEY o GEMINI_API_KEY). La app abre, pero el chat responderá con un error de configuración.');
    else console.log(`Proveedor: ${providers.primary.name}  respaldo: ${providers.fallbacks.length ? providers.fallbacks.map((f) => f.name).join(' → ') : 'ninguno'}  imágenes: ${providers.imageProvider ? 'sí' : 'no'}`);
  });
}

module.exports = { createApp, readConfig, validateChat, validateImageRequest, loadEnvFile };
