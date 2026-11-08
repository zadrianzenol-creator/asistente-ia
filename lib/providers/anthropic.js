'use strict';
/**
 * Proveedor Anthropic (API de Claude, Messages API) con streaming y visión.
 * Es la API de pago de console.anthropic.com, no la suscripción de claude.ai.
 * No genera imágenes.
 */
const { SYSTEM_PROMPT } = require('../prompt');

const API_VERSION = '2023-06-01';

function toMessages(messages) {
  return messages.map((m) => {
    if (m.role === 'assistant') return { role: 'assistant', content: m.content };
    if (!m.images || !m.images.length) return { role: 'user', content: m.content };
    const content = m.images.map((img) => ({ type: 'image', source: { type: 'base64', media_type: img.mime, data: img.data } }));
    if (m.content) content.push({ type: 'text', text: m.content });
    return { role: 'user', content };
  });
}

function mapUpstreamError(status, bodyText) {
  let err = {}; try { err = JSON.parse(bodyText).error || {}; } catch (e) { /* sin JSON */ }
  const type = String(err.type || ''), detail = String(err.message || bodyText || '').slice(0, 300);
  if (status === 401) return { status: 502, code: 'provider_auth', message: 'El servidor no tiene una clave de Anthropic válida configurada.' };
  if (status === 403) return { status: 502, code: 'provider_auth', message: 'La clave de Anthropic no tiene permiso para este modelo o función.' };
  if (status === 404 || type === 'not_found_error') return { status: 502, code: 'provider_model', message: 'El modelo configurado no existe o tu cuenta no tiene acceso a él.' };
  if (/credit balance|billing|plans & billing/i.test(detail)) {
    return { status: 503, code: 'provider_quota', message: 'El servicio se quedó sin saldo o cuota en el proveedor. Avisa a quien administra la app.' };
  }
  if (status === 429 || type === 'rate_limit_error') return { status: 429, code: 'provider_quota', retryAfter: 20, message: 'El proveedor de IA recibió demasiadas solicitudes. Espera un momento e inténtalo de nuevo.' };
  if (status === 413) return { status: 413, code: 'too_large', message: 'La solicitud es demasiado grande para el proveedor. Prueba con menos o con imágenes más pequeñas.' };
  if (status === 400 && /image|media_type|base64/i.test(detail)) return { status: 400, code: 'bad_image', message: 'El proveedor no pudo procesar la imagen enviada.' };
  if (status === 529 || status >= 500 || type === 'overloaded_error' || type === 'api_error') return { status: 503, code: 'provider_busy', retryAfter: 10, message: 'El proveedor de IA está saturado. Inténtalo de nuevo en unos segundos.' };
  return { status: 502, code: 'provider_error', message: 'El proveedor de IA devolvió un error inesperado.' };
}

/** Errores que llegan DENTRO del stream (evento "error"): se traducen igual que los HTTP. */
function mapStreamError(err) {
  const e = err || {}, t = String(e.type || '');
  const status = t === 'overloaded_error' ? 529 : t === 'rate_limit_error' ? 429 : t === 'api_error' ? 500 : 400;
  return mapUpstreamError(status, JSON.stringify({ error: e }));
}

const STOP = { end_turn: 'STOP', stop_sequence: 'STOP', pause_turn: 'STOP', tool_use: 'STOP', max_tokens: 'MAX_TOKENS', refusal: 'SAFETY' };

async function streamChat({ apiKey, baseUrl, model, messages, signal, maxOutputTokens }) {
  const body = { model, max_tokens: maxOutputTokens, system: SYSTEM_PROMPT, messages: toMessages(messages), stream: true };
  let res;
  try {
    res = await fetch(`${baseUrl}/v1/messages`, {
      method: 'POST', headers: { 'content-type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': API_VERSION }, body: JSON.stringify(body), signal
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
        if (!data) continue;
        let ev; try { ev = JSON.parse(data); } catch (e) { continue; }
        switch (ev.type) {
          case 'content_block_delta':
            if (ev.delta && ev.delta.type === 'text_delta' && ev.delta.text) { sawText = true; yield { text: ev.delta.text }; }
            break;
          case 'message_delta':
            if (ev.delta && ev.delta.stop_reason) finish = STOP[ev.delta.stop_reason] || 'STOP';
            break;
          case 'error': {
            const m = mapStreamError(ev.error);
            yield { error: { code: m.code, status: m.status, retryAfter: m.retryAfter, message: sawText ? 'Se interrumpió la respuesta del proveedor de IA.' : m.message } };
            return;
          }
          default: break;   // message_start, ping, content_block_start/stop, message_stop
        }
      }
    }
    yield { done: true, finish, blocked: null, note: finish === 'SAFETY' ? 'El modelo se negó a responder a esta solicitud.' : null };
  }

  // Se espera al primer evento útil: un error de apertura (sobrecarga, saldo…) permite usar el respaldo.
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

module.exports = { name: 'anthropic', streamChat, mapUpstreamError, supportsImageGeneration: false };
