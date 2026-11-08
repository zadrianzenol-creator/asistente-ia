'use strict';
/**
 * Servidor que imita el endpoint streamGenerateContent de Gemini, solo para pruebas.
 * El comportamiento depende de una palabra clave en el último mensaje del usuario.
 */
const http = require('node:http');

function startMockGemini() {
  const requests = [];
  const sse = (obj) => 'data: ' + JSON.stringify(obj) + '\r\n\r\n';
  const chunk = (text, finish) => ({ candidates: [{ content: { role: 'model', parts: [{ text }] }, ...(finish ? { finishReason: finish } : {}) }] });
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  const server = http.createServer(async (req, res) => {
    let body = '';
    for await (const c of req) body += c;
    let json = {}; try { json = JSON.parse(body); } catch (e) { /* vacío */ }
    const url = new URL(req.url, 'http://x');
    const rec = { path: url.pathname, query: url.search, key: req.headers['x-goog-api-key'], body: json };
    requests.push(rec);

    if (req.headers['x-goog-api-key'] !== 'test-key') {
      res.writeHead(400, { 'content-type': 'application/json' });
      return res.end(JSON.stringify({ error: { code: 400, message: 'API key not valid. Please pass a valid API key.' } }));
    }
    const contents = json.contents || [];
    const textPart = (c) => ((c && c.parts) || []).find((x) => typeof x.text === 'string');
    const imgCount = contents.reduce((n, c) => n + c.parts.filter((x) => x.inlineData).length, 0);
    const last = (textPart(contents[contents.length - 1]) || { text: '' }).text;
    const send = (o) => res.write(sse(o));

    if (last.includes('ERROR429')) {
      res.writeHead(429, { 'content-type': 'application/json' });
      return res.end(JSON.stringify({ error: { code: 429, message: 'Resource has been exhausted' } }));
    }
    if (last.includes('FLAKY') && !(server.flaky = (server.flaky || 0) + 1, server.flaky > 1)) {
      res.writeHead(503, { 'content-type': 'application/json' });
      return res.end(JSON.stringify({ error: { code: 503, message: 'high demand' } }));
    }
    if (last.includes('PROBUSY') && url.pathname.includes('3.8-flash')) {
      res.writeHead(503, { 'content-type': 'application/json' });
      return res.end(JSON.stringify({ error: { code: 503, message: 'high demand' } }));
    }
    if (last.includes('ERROR503')) {
      res.writeHead(503, { 'content-type': 'application/json' });
      return res.end(JSON.stringify({ error: { code: 503, message: 'overloaded' } }));
    }
    res.writeHead(200, { 'content-type': 'text/event-stream' });

    if (last.includes('SAFETY')) {
      send({ candidates: [{ finishReason: 'SAFETY' }] });
      return res.end();
    }
    if (last.includes('EXPORT')) {
      const parts = ['# Informe de prueba\n\n', 'Un párrafo con **negrita** y *cursiva*.\n\n', '## Datos\n\n', '| Producto | Cantidad | Precio |\n|:--|--:|--:|\n| Lápiz | 10 | 1,5 |\n| Cuaderno | 4 | 3.25 |\n| Total | =SUM(B2:B3) | |\n\n', '## Conclusión\n\n- Punto uno\n- Punto dos\n'];
      for (const p of parts) { send(chunk(p)); await sleep(10); }
      send(chunk('', 'STOP')); return res.end();
    }
    if (last.includes('EDITS')) {
      const name = ((last.match(/<documento nombre="([^"]+)"/) || [])[1]) || 'informe.docx';
      const json = JSON.stringify({ doc: name, edits: [{ p: 2, text: 'Este documento contiene errores ortográficos y una frase mal escrita corregida.' }, { p: 7, text: '150' }, { p: 99, text: 'no existe' }] });
      const parts = ['Corregí la ortografía del párrafo 2 y actualicé el valor de la tabla.\n\n', '```edits\n', json.slice(0, 40), json.slice(40), '\n```\n'];
      for (const p of parts) { send(chunk(p)); await sleep(10); }
      send(chunk('', 'STOP')); return res.end();
    }
    if (last.includes('MATH')) {
      const parts = ['Resolvamos:\n\n', '$$x = \\frac{-b \\pm \\sqrt{b^2-4ac}}{2a}$$\n\n', 'Con $a=1$ resulta `x`.\n\n',
        '| Concepto | Valor |\n|---|---:|\n| Raíz | 2 |\n| Total | 10 |\n\n', '```python\nprint("hola")\n```\n\n', '## Resumen\n\n- uno\n  - anidado\n- dos\n\n1. primero\n2. segundo\n\n[enlace](https://example.com) y <script>alert(1)</script>'];
      for (const p of parts) { send(chunk(p)); await sleep(15); }
      send(chunk('', 'STOP')); return res.end();
    }
    if (last.includes('SLOW')) {
      for (let i = 0; i < 200 && !res.destroyed; i++) { send(chunk('palabra' + i + ' ')); await sleep(40); }
      send(chunk('', 'STOP')); return res.end();
    }
    if (last.includes('CUT')) {
      send(chunk('Respuesta parcial antes del corte '));
      await sleep(60);
      return res.destroy();
    }
    if (last.includes('LONG')) {
      send(chunk('Texto largo '));
      send(chunk('', 'MAX_TOKENS')); return res.end();
    }
    const echo = `Turnos recibidos: ${contents.length}. Imágenes: ${imgCount}. Primer mensaje: «${((textPart(contents[0]) || { text: '' }).text).slice(0, 300)}». Último: «${last.length > 300 ? last.slice(0, 300) + '…' : last}».`;
    // Partimos en trozos y los separamos a mitad de línea SSE para probar el re-ensamblado.
    const full = sse(chunk('Hola. ')) + sse(chunk(echo)) + sse(chunk(' Fin.', 'STOP'));
    for (let i = 0; i < full.length; i += 37) { res.write(full.slice(i, i + 37)); await sleep(8); }
    res.end();
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => {
    resolve({ server, requests, url: `http://127.0.0.1:${server.address().port}`, close: () => new Promise((r) => { server.closeAllConnections && server.closeAllConnections(); server.close(r); }) });
  }));
}

module.exports = { startMockGemini };
