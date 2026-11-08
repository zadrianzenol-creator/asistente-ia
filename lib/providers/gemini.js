'use strict';
/**
 * Proveedor Google Gemini (API REST, streaming SSE). Soporta texto e imágenes de entrada.
 * La clave se envía en una cabecera desde el servidor; nunca llega al navegador.
 */
const { SYSTEM_PROMPT } = require('../prompt');

function toGeminiContents(messages) {
  return messages.map((m) => {
    const parts = [];
    if (m.content) parts.push({ text: m.content });
    for (const img of m.images || []) parts.push({ inlineData: { mimeType: img.mime, data: img.data } });
    return { role: m.role === 'assistant' ? 'model' : 'user', parts };
  });
}

/** Traduce errores HTTP del proveedor a algo útil para el usuario. */
function mapUpstreamError(status, bodyText) {
  let detail = '';
  try { detail = JSON.parse(bodyText).error.message || ''; } catch (e) { detail = String(bodyText || '').slice(0, 200); }
  if (status === 429) return { status: 429, code: 'provider_quota', retryAfter: 30,
    message: 'El proveedor de IA alcanzó su límite gratuito por ahora. Espera un momento e inténtalo de nuevo.' };
  if (status === 400 && /api key|API_KEY/i.test(detail)) return { status: 502, code: 'provider_auth',
    message: 'El servidor no tiene una clave de IA válida configurada.' };
  if (status === 400 && /image|inline_?data|mime/i.test(detail)) return { status: 400, code: 'bad_image',
    message: 'El proveedor no pudo procesar la imagen enviada.' };
  if (status === 401 || status === 403) return { status: 502, code: 'provider_auth',
    message: 'El servidor no tiene permiso para usar el proveedor de IA. Revisa la clave configurada.' };
  if (status === 404) return { status: 502, code: 'provider_model',
    message: 'El modelo configurado no existe o ya no está disponible.' };
  if (status === 503 || status === 500) return { status: 503, code: 'provider_busy', retryAfter: 10,
    message: 'El modelo está sobrecargado. Inténtalo de nuevo en unos segundos.' };
  return { status: 502, code: 'provider_error', message: 'El proveedor de IA devolvió un error inesperado.' };
}

const FINISH_MESSAGES = {
  SAFETY: 'La respuesta se detuvo por los filtros de seguridad del modelo.',
  RECITATION: 'La respuesta se detuvo por posible coincidencia con contenido protegido.',
  PROHIBITED_CONTENT: 'La respuesta se detuvo por los filtros de contenido del modelo.',
  MAX_TOKENS: null
};

async function streamChat({ apiKey, baseUrl, model, messages, signal, search, maxOutputTokens, temperature }) {
  const url = `${baseUrl}/v1beta/models/${encodeURIComponent(model)}:streamGenerateContent?alt=sse`;
  const body = {
    systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
    contents: toGeminiContents(messages),
    generationConfig: { temperature, maxOutputTokens }
  };
  if (search) body.tools = [{ google_search: {} }];

  let res;
  try {
    res = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json', 'x-goog-api-key': apiKey }, body: JSON.stringify(body), signal });
  } catch (err) {
    if (err.name === 'AbortError') return { ok: false, aborted: true };
    return { ok: false, error: { status: 502, code: 'provider_unreachable', message: 'No se pudo contactar al proveedor de IA.' } };
  }
  if (!res.ok) return { ok: false, error: mapUpstreamError(res.status, await res.text().catch(() => '')) };

  async function* events() {
    const decoder = new TextDecoder();
    let buf = '', finish = null, blocked = null;
    for await (const chunk of res.body) {
      buf += decoder.decode(chunk, { stream: true });
      let idx;
      while ((idx = buf.search(/\r?\n\r?\n/)) >= 0) {
        const raw = buf.slice(0, idx);
        buf = buf.slice(idx).replace(/^\r?\n\r?\n/, '');
        const data = raw.split(/\r?\n/).filter((l) => l.startsWith('data:')).map((l) => l.slice(5).trimStart()).join('');
        if (!data) continue;
        let obj; try { obj = JSON.parse(data); } catch (e) { continue; }
        if (obj.promptFeedback && obj.promptFeedback.blockReason) blocked = obj.promptFeedback.blockReason;
        const cand = obj.candidates && obj.candidates[0];
        if (cand) {
          const parts = (cand.content && cand.content.parts) || [];
          const text = parts.filter((p) => typeof p.text === 'string' && !p.thought).map((p) => p.text).join('');
          if (text) yield { text };
          if (cand.finishReason) finish = cand.finishReason;
        }
      }
    }
    yield { done: true, finish, blocked, note: finish ? FINISH_MESSAGES[finish] || null : null };
  }
  return { ok: true, events: events() };
}

module.exports = { name: 'gemini', streamChat, mapUpstreamError, supportsImageGeneration: false };
