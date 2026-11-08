'use strict';
/** Servidor que imita POST /v1/messages de la API de Anthropic (streaming). Solo para pruebas. */
const http = require('node:http');

function startMockAnthropic(key = 'test-anthropic') {
  const requests = [];
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const ev = (type, data) => `event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`;
  const textOf = (c) => (typeof c === 'string' ? c : (c || []).filter((b) => b.type === 'text').map((b) => b.text).join(' '));

  const server = http.createServer(async (req, res) => {
    const chunks = []; for await (const c of req) chunks.push(c);
    let body = {}; try { body = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch (e) { /* vacío */ }
    requests.push({ path: req.url, headers: req.headers, body });
    const json = (status, type, message) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify({ type: 'error', error: { type, message } })); };

    if (req.headers['x-api-key'] !== key) return json(401, 'authentication_error', 'invalid x-api-key');
    if (req.headers['anthropic-version'] !== '2023-06-01') return json(400, 'invalid_request_error', 'anthropic-version header is required');
    if (req.url !== '/v1/messages') return json(404, 'not_found_error', 'not found');

    const msgs = body.messages || [], lastMsg = msgs[msgs.length - 1] || { content: '' };
    const last = textOf(lastMsg.content);
    const imgs = msgs.reduce((n, m) => n + (Array.isArray(m.content) ? m.content.filter((b) => b.type === 'image').length : 0), 0);

    if (last.includes('ERROR_QUOTA')) return json(400, 'invalid_request_error', 'Your credit balance is too low to access the Anthropic API. Please go to Plans & Billing to upgrade or purchase credits.');
    if (last.includes('ERROR429')) return json(429, 'rate_limit_error', 'Number of request tokens has exceeded your rate limit');
    if (last.includes('ERROR529')) return json(529, 'overloaded_error', 'Overloaded');

    res.writeHead(200, { 'content-type': 'text/event-stream' });
    res.write(ev('message_start', { message: { id: 'msg_1', role: 'assistant', content: [], model: body.model, usage: { input_tokens: 5, output_tokens: 1 } } }));
    if (last.includes('STREAMOVERLOAD')) {   // el error llega dentro del stream, antes de cualquier texto
      res.write(ev('error', { error: { type: 'overloaded_error', message: 'Overloaded' } })); return res.end();
    }
    res.write(ev('content_block_start', { index: 0, content_block: { type: 'text', text: '' } }));
    res.write(ev('ping', {}));
    const delta = (t) => ev('content_block_delta', { index: 0, delta: { type: 'text_delta', text: t } });
    const end = (reason) => ev('content_block_stop', { index: 0 }) + ev('message_delta', { delta: { stop_reason: reason }, usage: { output_tokens: 9 } }) + ev('message_stop', {});

    if (last.includes('MIDERR')) { res.write(delta('Empiezo y ')); res.write(ev('error', { error: { type: 'api_error', message: 'Internal' } })); return res.end(); }
    if (last.includes('MAXTOK')) { res.write(delta('Texto cortado') + end('max_tokens')); return res.end(); }
    if (last.includes('REFUSAL')) { res.write(end('refusal')); return res.end(); }
    if (last.includes('SLOW')) { for (let i = 0; i < 200 && !res.destroyed; i++) { res.write(delta('palabra' + i + ' ')); await sleep(40); } return res.end(); }

    const echo = `Claude: ${msgs.length} turnos, ${imgs} imágenes, modelo ${body.model}. Último: «${last}».`;
    const full = delta('Hola. ') + delta(echo) + end('end_turn');
    for (let i = 0; i < full.length; i += 43) { res.write(full.slice(i, i + 43)); await sleep(6); }
    res.end();
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve({
    server, requests, url: `http://127.0.0.1:${server.address().port}`,
    close: () => new Promise((r) => { server.closeAllConnections && server.closeAllConnections(); server.close(r); })
  })));
}

module.exports = { startMockAnthropic };
