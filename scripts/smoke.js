'use strict';
/**
 * Verifica un despliegue ya publicado. Uso:  node scripts/smoke.js https://tu-dominio.com [--chat]
 *   --chat   además hace UNA pregunta real al modelo (consume un poco de cuota) y comprueba que la respuesta llega en streaming.
 */
const url = (process.argv[2] || '').replace(/\/$/, '');
const withChat = process.argv.includes('--chat');
if (!/^https?:\/\//.test(url)) { console.error('Uso: node scripts/smoke.js https://tu-dominio.com [--chat]'); process.exit(2); }
const https = url.startsWith('https://');
let bad = 0, warn = 0;
const line = (ok, name, extra = '', soft = false) => { console.log(`  ${ok ? '✓' : soft ? '!' : '✗'} ${name}${extra ? '  → ' + extra : ''}`); if (!ok) soft ? warn++ : bad++; };
const get = (p, h = {}, o = {}) => fetch(url + p, { headers: h, redirect: 'manual', signal: AbortSignal.timeout(30000), ...o });

(async () => {
  console.log(`Verificando ${url}\n`);
  try {
    const t0 = Date.now(), r = await get('/', { 'accept-encoding': 'gzip, br' }), html = await r.text();
    line(r.status === 200 && /<title>Asistente<\/title>/.test(html), 'La página principal carga', `${r.status} en ${Date.now() - t0} ms (la primera visita puede tardar si el servicio estaba dormido)`);
    const h = r.headers;
    line(/default-src 'self'/.test(h.get('content-security-policy') || ''), 'Política de seguridad de contenido (CSP)');
    line(h.get('x-content-type-options') === 'nosniff' && h.get('x-frame-options') === 'DENY', 'Cabeceras anti-sniffing y anti-iframe');
    if (https) line(/max-age/.test(h.get('strict-transport-security') || ''), 'HSTS activo', 'si falta: pon TRUST_PROXY=1 en el servidor', true);
    const hr = await get('/api/health'), hj = await hr.json().catch(() => ({}));
    line(hr.ok && hj.ok, 'API de salud responde', JSON.stringify(hj));
    line(hj.configured === true, 'Hay al menos una clave de IA configurada', hj.provider ? `principal: ${hj.provider}${hj.fallbacks && hj.fallbacks.length ? ', respaldo: ' + hj.fallbacks.join(' → ') : ''}` : 'define OPENAI_API_KEY, ANTHROPIC_API_KEY o GEMINI_API_KEY');
    console.log(`      imágenes (crear/editar): ${hj.imageGen ? 'disponible' : 'no disponible (requiere OPENAI_API_KEY con saldo)'}`);
    const js = await get('/vendor/pdfjs/pdf.worker.min.mjs', { 'accept-encoding': 'gzip, br' }); const raw = await js.arrayBuffer();
    line(js.ok && !!js.headers.get('content-encoding') && /javascript/.test(js.headers.get('content-type') || ''), 'Archivos pesados comprimidos y con tipo correcto', `${js.headers.get('content-encoding') || 'SIN compresión'}, ${(Number(js.headers.get('content-length') || raw.byteLength) / 1024).toFixed(0)} KB por la red (${(raw.byteLength / 1024).toFixed(0)} KB descomprimido)`, true);
    for (const p of ['/manifest.webmanifest', '/icons/icon-192.png', '/icons/icon-512.png', '/sw.js', '/privacidad.html']) { const x = await get(p); line(x.ok, `Recurso PWA/legal ${p}`, String(x.status)); await x.arrayBuffer(); }
    const sw = await get('/sw.js'); line(/no-cache/.test(sw.headers.get('cache-control') || ''), 'El service worker no se cachea (las actualizaciones llegan)'); await sw.text();
    const bp = await fetch(url + '/api/chat', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"messages": []}', signal: AbortSignal.timeout(30000) });
    const bj = await bp.json().catch(() => ({}));
    line(bp.status === 400 && bj.error, 'Las peticiones POST llegan a la API (el proxy no las bloquea)', `${bp.status} ${bj.error ? bj.error.code : ''}`);
    const pp = await get('/privacidad.html'); const ph = await pp.text();
    line(!/\[completa aquí/.test(ph), 'La página de privacidad ya no tiene el marcador del responsable', 'define OPERATOR en el servidor (o edita public/privacidad.html)', true);
    if (https) { const ins = await fetch(url.replace('https://', 'http://') + '/', { redirect: 'manual', signal: AbortSignal.timeout(15000) }).catch(() => null); line(!ins || (ins.status >= 300 && ins.status < 400), 'HTTP redirige a HTTPS (o no está expuesto)', ins ? String(ins.status) : 'sin respuesta', true); }

    if (withChat) {
      console.log('\n  Pregunta real al modelo…');
      const t1 = Date.now(); let first = 0, chunks = 0, text = '';
      const c = await fetch(url + '/api/chat', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ messages: [{ role: 'user', content: 'Escribe un párrafo de unas 90 palabras sobre el mar.' }] }), signal: AbortSignal.timeout(120000) });
      if (!c.ok) { const j = await c.json().catch(() => ({})); line(false, 'La IA respondió', `${c.status} ${j.error ? j.error.message : ''}`); }
      else {
        const reader = c.body.getReader(), dec = new TextDecoder(); let sawDone = false;
        for (;;) { const { value, done } = await reader.read(); if (done) break; const s = dec.decode(value, { stream: true }); if (!first) first = Date.now() - t1; chunks++; for (const m of s.matchAll(/data: (\{.*\})/g)) { try { const o = JSON.parse(m[1]); if (o.text) text += o.text; if (o.done) sawDone = true; } catch (e) { /* fragmento parcial */ } } }
        const total = Date.now() - t1;
        line(sawDone && text.trim().length > 0, 'La IA respondió', `«${text.trim().slice(0, 50)}» (proveedor: ${c.headers.get('x-ai-provider')})`);
        line(chunks >= 3, 'La respuesta llega en streaming (no toda de golpe)', `${chunks} trozos de red; primer dato a los ${first} ms, fin a los ${total} ms` + (chunks < 3 ? ' — un proxy podría estar acumulando la respuesta' : ''), true);
      }
    }
  } catch (e) { line(false, 'No se pudo completar la verificación', e.message); }
  console.log(`\n${bad ? 'HAY PROBLEMAS: ' + bad + ' comprobación(es) fallida(s)' : 'Todo lo esencial está bien'}${warn ? ` · ${warn} aviso(s) a revisar` : ''}`);
  process.exit(bad ? 1 : 0);
})();
