'use strict';
const gemini = require('./gemini');
const openai = require('./openai');
const anthropic = require('./anthropic');

/** Errores del proveedor principal tras los cuales se prueba el siguiente de la cadena. */
const FALLBACK_CODES = new Set(['provider_quota', 'provider_auth', 'provider_busy', 'provider_unreachable', 'provider_model']);
const ORDER = ['openai', 'anthropic', 'gemini'];   // prioridad por defecto

/**
 * Elige proveedor principal, cadena de respaldo y proveedor de imágenes según la configuración.
 *  - AI_PROVIDER fija el principal; si no, el primero con clave en el orden openai > anthropic > gemini.
 *  - AI_FALLBACK = none | lista separada por comas; si está vacío, el resto de proveedores con clave, en orden.
 */
function createProviders(cfg) {
  const mods = { openai, anthropic, gemini };
  const available = ORDER.filter((n) => cfg[n] && cfg[n].apiKey);

  const primaryName = available.includes(cfg.provider) ? cfg.provider : (available[0] || null);
  let chain;
  if (cfg.fallback === 'none') chain = [];
  else if (cfg.fallback) chain = cfg.fallback.split(',').map((x) => x.trim()).filter((n) => available.includes(n));
  else chain = available.filter((n) => n !== primaryName);
  chain = chain.filter((n, i) => n !== primaryName && chain.indexOf(n) === i);

  const bind = (name) => {
    if (!name) return null;
    const c = cfg[name];
    return {
      name,
      streamChat: (o) => mods[name].streamChat({ ...o, apiKey: c.apiKey, baseUrl: c.baseUrl, model: c.models[o.modelTier], search: c.search, maxOutputTokens: cfg.maxOutputTokens, temperature: cfg.temperature }),
      createImage: name === 'openai'
        ? (o) => openai.createImage({ ...o, apiKey: c.apiKey, baseUrl: c.baseUrl, model: c.imageModel, defaultQuality: cfg.imageQuality })
        : null
    };
  };

  const fallbacks = chain.map(bind);
  return { primary: bind(primaryName), fallbacks, fallback: fallbacks[0] || null, imageProvider: available.includes('openai') ? bind('openai') : null };
}

/**
 * Abre el streaming con el principal (con un reintento si está saturado; el modelo "pro" degrada al rápido)
 * y, si sigue fallando por cuota/clave/saturación, recorre la cadena de respaldo.
 */
async function openChatStream(providers, opts, { retryDelayMs = 1500 } = {}) {
  let up = await providers.primary.streamChat(opts);
  let used = providers.primary.name, degraded = false;
  if (!up.ok && !up.aborted && up.error.code === 'provider_busy' && !opts.signal.aborted) {
    await new Promise((r) => setTimeout(r, retryDelayMs));
    if (!opts.signal.aborted) up = await providers.primary.streamChat(opts);
  }
  if (!up.ok && !up.aborted && up.error.code === 'provider_busy' && opts.modelTier === 'pro' && !opts.signal.aborted) {
    const lite = await providers.primary.streamChat({ ...opts, modelTier: 'fast' });
    if (lite.ok) { up = lite; degraded = true; }
  }
  for (const fb of providers.fallbacks) {
    if (up.ok || up.aborted || !FALLBACK_CODES.has(up.error.code) || opts.signal.aborted) break;
    const next = await fb.streamChat(opts);
    if (next.ok) { up = next; used = fb.name; }
  }
  up.provider = used; up.degraded = degraded;
  return up;
}

module.exports = { createProviders, openChatStream, FALLBACK_CODES };
