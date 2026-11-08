'use strict';
/** Servidor que imita los endpoints de OpenAI usados por la app. Solo para pruebas. */
const http = require('node:http');

const PNG_1X1 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

function startMockOpenAI(key = 'test-openai') {
  const requests = [];
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const ev = (type, data) => `event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`;

  const server = http.createServer(async (req, res) => {
    const chunks = []; for await (const c of req) chunks.push(c);
    const raw = Buffer.concat(chunks);
    const ctype = req.headers['content-type'] || '';
    const rec = { path: req.url, auth: req.headers.authorization, ctype, raw: ctype.includes('multipart') ? raw.toString('latin1') : null, body: null };
    if (ctype.includes('json')) { try { rec.body = JSON.parse(raw.toString('utf8')); } catch (e) { /* vacío */ } }
    requests.push(rec);

    const json = (status, obj) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(obj)); };
    if (rec.auth !== `Bearer ${key}`) return json(401, { error: { message: 'Incorrect API key provided', type: 'invalid_request_error', code: 'invalid_api_key' } });

    if (req.url === '/v1/responses') {
      const input = rec.body.input || [];
      const lastItem = input[input.length - 1] || { content: '' };
      const textOf = (c) => (typeof c === 'string' ? c : (c || []).filter((p) => p.type === 'input_text').map((p) => p.text).join(' '));
      const last = textOf(lastItem.content);
      const imgCount = input.reduce((n, m) => n + (Array.isArray(m.content) ? m.content.filter((p) => p.type === 'input_image').length : 0), 0);
      if (last.includes('ERROR_QUOTA')) return json(429, { error: { message: 'You exceeded your current quota', type: 'insufficient_quota', code: 'insufficient_quota' } });
      if (last.includes('ERROR429')) return json(429, { error: { message: 'Rate limit reached', type: 'requests', code: 'rate_limit_exceeded' } });
      if (last.includes('ERROR500')) return json(500, { error: { message: 'server error' } });
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      res.write(ev('response.created', { response: { status: 'in_progress' } }));
      if (last.includes('STREAMQUOTA')) {   // comportamiento REAL observado: 200 y el error llega dentro del stream
        const err = { type: 'insufficient_quota', code: 'credit_balance_exhausted', message: 'You have no credits remaining.' };
        res.write(ev('error', { ...err, error: err }));
        res.write(ev('response.failed', { response: { status: 'failed', error: err } }));
        return res.end();
      }
      if (last.includes('FAILED')) {
        res.write(ev('response.output_text.delta', { delta: 'Empiezo y ' }));
        res.write(ev('response.failed', { response: { status: 'failed', error: { code: 'server_error', message: 'boom' } } }));
        return res.end();
      }
      if (last.includes('MAXTOK')) {
        res.write(ev('response.output_text.delta', { delta: 'Texto cortado' }));
        res.write(ev('response.incomplete', { response: { status: 'incomplete', incomplete_details: { reason: 'max_output_tokens' } } }));
        return res.end();
      }
      if (last.includes('SLOW')) {
        for (let i = 0; i < 200 && !res.destroyed; i++) { res.write(ev('response.output_text.delta', { delta: 'palabra' + i + ' ' })); await sleep(40); }
        return res.end();
      }
      const echo = `OpenAI: ${input.length} turnos, ${imgCount} imágenes, modelo ${rec.body.model}. Último: «${last}».`;
      const full = ev('response.output_text.delta', { delta: 'Hola. ' }) + ev('response.output_text.delta', { delta: echo }) + ev('response.completed', { response: { status: 'completed' } });
      for (let i = 0; i < full.length; i += 41) { res.write(full.slice(i, i + 41)); await sleep(6); }
      return res.end();
    }
    if (req.url === '/v1/images/generations') {
      if ((rec.body.prompt || '').includes('SLOWIMG')) await sleep(4000);
      if ((rec.body.prompt || '').includes('POLICY')) return json(400, { error: { message: 'Your request was rejected by the safety system.', type: 'invalid_request_error', code: 'content_policy_violation' } });
      return json(200, { created: 1, data: [{ b64_json: PNG_1X1 }] });
    }
    if (req.url === '/v1/images/edits') {
      if (rec.raw.includes('POLICY')) return json(400, { error: { message: 'moderation_blocked', code: 'moderation_blocked' } });
      return json(200, { created: 1, data: [{ b64_json: PNG_1X1 }] });
    }
    json(404, { error: { message: 'not found' } });
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve({
    server, requests, url: `http://127.0.0.1:${server.address().port}`, PNG_1X1,
    close: () => new Promise((r) => { server.closeAllConnections && server.closeAllConnections(); server.close(r); })
  })));
}

module.exports = { startMockOpenAI, PNG_1X1 };
