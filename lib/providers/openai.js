'use strict';
/**
 * Proveedor OpenAI (API oficial, no la app de ChatGPT).
 *  - Chat con visión: Responses API (/v1/responses) en streaming.
 *  - Imágenes: Image API (/v1/images/generations y /v1/images/edits).
 * Los nombres de modelo se configuran por variables de entorno.
 */
const { SYSTEM_PROMPT } = require('../prompt');
const { EXT } = require('../images');

function toInput(messages) {
  return messages.map((m) => {
    if (m.role === 'assistant') return { role: 'assistant', content: m.content };
    if (!m.images || !m.images.length) return { role: 'user', content: m.content };
    const content = [];
    if (m.content) content.push({ type: 'input_text', text: m.content });
    for (const img of m.images) content.push({ type: 'input_image', image_url: `data:${img.mime};base64,${img.data}` });
    return { role: 'user', content };
  });
}

function mapUpstreamError(status, bodyText) {
  let err = {}; try { err = JSON.parse(bodyText).error || {}; } catch (e) { /* sin JSON */ }
  const code = String(err.type || '') + ' ' + String(err.code || ''), detail = String(err.message || bodyText || '').slice(0, 300);
  if (status === 401) return { status: 502, code: 'provider_auth', message: 'El servidor no tiene una clave de OpenAI válida configurada.' };
  if (status === 403) return { status: 502, code: 'provider_auth', message: 'La clave de OpenAI no tiene permiso para este modelo o función.' };
  if (status === 429 && /insufficient_quota|billing|credit_balance|no credits/i.test(code + ' ' + detail)) {
    return { status: 503, code: 'provider_quota', message: 'El servicio se quedó sin saldo o cuota en el proveedor. Avisa a quien administra la app.' };
  }
  if (status === 429) return { status: 429, code: 'provider_quota', retryAfter: 20, message: 'El proveedor de IA recibió demasiadas solicitudes. Espera un momento e inténtalo de nuevo.' };
  if (/content_policy|moderation|safety/i.test(code + detail)) {
    return { status: 422, code: 'content_policy', message: 'La solicitud fue rechazada por las políticas de contenido del proveedor.' };
  }
  if (status === 404 || /model_not_found/.test(code)) return { status: 502, code: 'provider_model', message: 'El modelo configurado no existe o tu cuenta no tiene acceso a él.' };
  if (status === 400 && /image|mime|format/i.test(detail)) return { status: 400, code: 'bad_image', message: 'El proveedor no pudo procesar la imagen enviada.' };
  if (status >= 500) return { status: 503, code: 'provider_busy', retryAfter: 10, message: 'El proveedor de IA está saturado. Inténtalo de nuevo en unos segundos.' };
  return { status: 502, code: 'provider_error', message: 'El proveedor de IA devolvió un error inesperado.' };
}

/**
 * OpenAI puede responder 200 y mandar el error DENTRO del stream (p. ej. sin saldo: credit_balance_exhausted).
 * Se traduce igual que un error HTTP para que el respaldo y los mensajes funcionen igual.
 */
function mapStreamError(err) {
  const e = err || {};
  const tag = String(e.type || '') + ' ' + String(e.code || '');
  const status = /insufficient_quota|credit|billing|rate_limit/i.test(tag) ? 429 : /server_error|overloaded|unavailable/i.test(tag) ? 500 : 400;
  return mapUpstreamError(status, JSON.stringify({ error: e }));
}

async function streamChat({ apiKey, baseUrl, model, messages, signal, maxOutputTokens }) {
  const body = { model, instructions: SYSTEM_PROMPT, input: toInput(messages), stream: true, store: false, max_output_tokens: maxOutputTokens };
  let res;
  try {
    res = await fetch(`${baseUrl}/v1/responses`, {
      method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` }, body: JSON.stringify(body), signal
    });
  } catch (err) {
    if (err.name === 'AbortError') return { ok: false, aborted: true };
    return { ok: false, error: { status: 502, code: 'provider_unreachable', message: 'No se pudo contactar al proveedor de IA.' } };
  }
  if (!res.ok) return { ok: false, error: mapUpstreamError(res.status, await res.text().catch(() => '')) };

  async function* events() {
    const decoder = new TextDecoder();
    let buf = '', finish = null, sawText = false;
    for await (const chunk of res.body) {
      buf += decoder.decode(chunk, { stream: true });
      let idx;
      while ((idx = buf.search(/\r?\n\r?\n/)) >= 0) {
        const raw = buf.slice(0, idx);
        buf = buf.slice(idx).replace(/^\r?\n\r?\n/, '');
        const data = raw.split(/\r?\n/).filter((l) => l.startsWith('data:')).map((l) => l.slice(5).trimStart()).join('');
        if (!data || data === '[DONE]') continue;
        let ev; try { ev = JSON.parse(data); } catch (e) { continue; }
        switch (ev.type) {
          case 'response.output_text.delta':
          case 'response.refusal.delta':
            if (ev.delta) { sawText = true; yield { text: ev.delta }; }
            break;
          case 'response.completed': finish = 'STOP'; break;
          case 'response.incomplete': {
            const r = ev.response && ev.response.incomplete_details && ev.response.incomplete_details.reason;
            finish = r === 'max_output_tokens' ? 'MAX_TOKENS' : r === 'content_filter' ? 'SAFETY' : 'STOP';
            break;
          }
          case 'response.failed':
          case 'error': {
            const m = mapStreamError(ev.type === 'error' ? (ev.error || ev) : ((ev.response && ev.response.error) || {}));
            yield { error: { code: m.code, status: m.status, retryAfter: m.retryAfter, message: sawText ? 'Se interrumpió la respuesta del proveedor de IA.' : m.message } };
            return;
          }
          default: break;
        }
      }
    }
    yield { done: true, finish, blocked: null, note: finish === 'SAFETY' ? 'La respuesta se detuvo por los filtros de contenido del modelo.' : null };
  }
  // Se espera al primer evento útil: si es un error (sin saldo, límite…) se devuelve como fallo "de apertura",
  // igual que un error HTTP, para que el servidor pueda usar el proveedor de respaldo.
  const gen = events();
  let first;
  try { first = await gen.next(); }
  catch (err) {
    if (err.name === 'AbortError') return { ok: false, aborted: true };
    return { ok: false, error: { status: 502, code: 'provider_unreachable', message: 'Se interrumpió la conexión con el proveedor de IA.' } };
  }
  if (!first.done && first.value.error) return { ok: false, error: first.value.error };
  async function* chained() { if (!first.done) yield first.value; yield* gen; }
  return { ok: true, events: chained() };
}

const SIZES = new Set(['auto', '1024x1024', '1536x1024', '1024x1536']);
const QUALITIES = new Set(['auto', 'low', 'medium', 'high']);
const TRANSPARENT = /fondo transparente|sin fondo|quita(r|le)? (el )?fondo|elimina(r)? (el )?fondo|remove (the )?background|transparent background/i;

function imageParams({ prompt, size, quality, defaultQuality }) {
  const p = { size: SIZES.has(size) ? size : 'auto', quality: QUALITIES.has(quality) ? quality : defaultQuality };
  if (TRANSPARENT.test(prompt)) { p.background = 'transparent'; p.output_format = 'png'; }
  return p;
}

async function readImages(res) {
  let j; try { j = await res.json(); } catch (e) { j = null; }
  const items = (j && j.data) || [];
  const images = items.filter((d) => d && d.b64_json).map((d) => ({ mime: 'image/png', data: d.b64_json }));
  if (!images.length) return { ok: false, error: { status: 502, code: 'provider_error', message: 'El proveedor no devolvió ninguna imagen.' } };
  return { ok: true, images };
}

/** Crea una imagen (sin imágenes de entrada) o edita las recibidas. */
async function createImage({ apiKey, baseUrl, model, prompt, images, size, quality, defaultQuality, signal }) {
  const params = imageParams({ prompt, size, quality, defaultQuality });
  let res;
  try {
    if (images && images.length) {
      const form = new FormData();
      form.append('model', model); form.append('prompt', prompt); form.append('n', '1');
      for (const [k, v] of Object.entries(params)) form.append(k, v);
      images.forEach((img, i) => form.append('image[]', new Blob([img.buffer], { type: img.mime }), `imagen${i + 1}.${EXT[img.mime]}`));
      res = await fetch(`${baseUrl}/v1/images/edits`, { method: 'POST', headers: { authorization: `Bearer ${apiKey}` }, body: form, signal });
    } else {
      res = await fetch(`${baseUrl}/v1/images/generations`, {
        method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({ model, prompt, n: 1, ...params }), signal
      });
    }
  } catch (err) {
    if (err.name === 'AbortError') return { ok: false, aborted: true };
    return { ok: false, error: { status: 502, code: 'provider_unreachable', message: 'No se pudo contactar al proveedor de IA.' } };
  }
  if (!res.ok) return { ok: false, error: mapUpstreamError(res.status, await res.text().catch(() => '')) };
  return readImages(res);
}

module.exports = { name: 'openai', streamChat, createImage, mapUpstreamError, supportsImageGeneration: true };
