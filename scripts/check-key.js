'use strict';
/**
 * Verifica con llamadas reales que tus claves y modelos funcionan. Uso: npm run check-key
 * Con --images también prueba la creación de una imagen (cuesta unos centavos en OpenAI).
 */
const path = require('node:path');
const { loadEnvFile, readConfig } = require('../server');
const gemini = require('../lib/providers/gemini');
const openai = require('../lib/providers/openai');
const anthropic = require('../lib/providers/anthropic');

(async () => {
  loadEnvFile(path.join(__dirname, '..', '.env'));
  const cfg = readConfig();
  const withImages = process.argv.includes('--images');
  const jobs = [];
  if (cfg.openai.apiKey) jobs.push(['openai', openai, cfg.openai]);
  if (cfg.anthropic.apiKey) jobs.push(['anthropic', anthropic, cfg.anthropic]);
  if (cfg.gemini.apiKey) jobs.push(['gemini', gemini, cfg.gemini]);
  if (!jobs.length) { console.error('No hay claves: define OPENAI_API_KEY, ANTHROPIC_API_KEY y/o GEMINI_API_KEY en .env o como variable de entorno.'); process.exit(1); }

  let bad = 0;
  for (const [name, mod, c] of jobs) {
    for (const tier of ['fast', 'pro']) {
      process.stdout.write(`${name} · ${tier} (${c.models[tier]}): `);
      const r = await mod.streamChat({
        apiKey: c.apiKey, baseUrl: c.baseUrl, model: c.models[tier], search: false, maxOutputTokens: 64, temperature: 0,
        messages: [{ role: 'user', content: 'Responde solo con la palabra: listo', images: [] }], signal: AbortSignal.timeout(45000)
      });
      if (!r.ok) { console.log('ERROR →', r.error ? `${r.error.code}: ${r.error.message}` : 'cancelado'); bad++; continue; }
      let text = '';
      for await (const ev of r.events) { if (ev.text) text += ev.text; if (ev.error) { text = ''; console.log('ERROR →', ev.error.message); bad++; break; } }
      if (text) console.log('OK → «' + text.trim().slice(0, 40) + '»');
    }
  }
  if (withImages && cfg.openai.apiKey) {
    process.stdout.write(`openai · imagen (${cfg.openai.imageModel}, calidad low): `);
    const r = await openai.createImage({ apiKey: cfg.openai.apiKey, baseUrl: cfg.openai.baseUrl, model: cfg.openai.imageModel, prompt: 'un círculo negro sobre fondo blanco', images: [], size: '1024x1024', quality: 'low', defaultQuality: 'low', signal: AbortSignal.timeout(120000) });
    if (r.ok) console.log('OK → imagen recibida (' + Math.round(r.images[0].data.length * 0.75 / 1024) + ' KB)'); else { console.log('ERROR →', r.error ? `${r.error.code}: ${r.error.message}` : 'cancelado'); bad++; }
  }
  process.exit(bad ? 1 : 0);
})();
