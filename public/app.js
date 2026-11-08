(function () {
  'use strict';

  /* =====================================================================
   * Iconos
   * ===================================================================== */
  var IC = {
    spark: '<path d="M12 3l1.9 5.6 5.6 1.9-5.6 1.9L12 18l-1.9-5.6L4.5 10.5l5.6-1.9z"/>',
    panel: '<rect x="3" y="3" width="18" height="18" rx="3"/><path d="M9 3v18"/>',
    edit: '<path d="M12 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.4 2.6a1.9 1.9 0 0 1 3 3L12.4 14.6a2 2 0 0 1-.85.5l-2.87.84a.5.5 0 0 1-.62-.62l.84-2.87a2 2 0 0 1 .5-.85z"/>',
    search: '<circle cx="11" cy="11" r="7.5"/><path d="m21 21-4.3-4.3"/>',
    down: '<path d="m6 9 6 6 6-6"/>',
    check: '<path d="M20 6 9 17l-5-5"/>',
    mic: '<path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2M12 19v3"/>',
    up: '<path d="M12 19V5M5 12l7-7 7 7"/>',
    stop: '<rect x="4" y="4" width="16" height="16" rx="3"/>',
    copy: '<rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>',
    redo: '<path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/><path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16"/><path d="M8 16H3v5"/>',
    sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41"/>',
    moon: '<path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9z"/>',
    dots: '<circle class="f" cx="5" cy="12" r="1.6"/><circle class="f" cx="12" cy="12" r="1.6"/><circle class="f" cx="19" cy="12" r="1.6"/>',
    pencil: '<path d="M17 3a2.8 2.8 0 0 1 4 4L7.5 20.5 2 22l1.5-5.5z"/>',
    trash: '<path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m3 0v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/>',
    download: '<path d="M12 3v12M7 10l5 5 5-5M5 21h14"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    file: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6M8 13h8M8 17h6"/>',
    x: '<path d="M18 6 6 18M6 6l12 12"/>',
    image: '<rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-3.1-3.1a2 2 0 0 0-2.8 0L6 21"/>',
    sliders: '<path d="M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3M1 14h6M9 8h6M17 16h6"/>'
  };
  function icon(name, extra) {
    return '<svg class="i ' + (extra || '') + '" viewBox="0 0 24 24" aria-hidden="true">' + IC[name] + '</svg>';
  }
  function paintIcons(root) {
    (root || document).querySelectorAll('svg[data-ic]').forEach(function (s) {
      s.setAttribute('viewBox', '0 0 24 24'); s.setAttribute('aria-hidden', 'true');
      s.innerHTML = IC[s.getAttribute('data-ic')] || '';
      s.removeAttribute('data-ic');
    });
  }
  paintIcons();

  var $ = function (id) { return document.getElementById(id); };
  var app = $('app'), thread = $('thread'), inner = $('threadInner'), input = $('input'),
      sendBtn = $('send'), form = $('form'), list = $('chatList');

  /* =====================================================================
   * Almacenamiento local (sin cuenta)
   * ===================================================================== */
  var KEY = 'asistente.v1', DRAFT = 'asistente.draft';
  var MAX_CHATS = 100;
  var state = { chats: [], currentId: null, model: 'fast' };
  var saveTimer = null;

  function uid() {
    return (window.crypto && crypto.randomUUID) ? crypto.randomUUID() : 'c' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  }
  function load() {
    try {
      var raw = localStorage.getItem(KEY);
      if (!raw) return;
      var d = JSON.parse(raw);
      if (!d || !Array.isArray(d.chats)) return;
      state.chats = d.chats.filter(function (c) { return c && typeof c.id === 'string' && Array.isArray(c.messages); }).map(function (c) {
        c.title = String(c.title || 'Chat').slice(0, 80);
        c.messages = c.messages.filter(function (m) { return m && (m.role === 'user' || m.role === 'bot') && typeof m.text === 'string'; });
        c.messages.forEach(function (m) {
          // Una respuesta que quedó a medias (se cerró la página mientras se generaba).
          if (m.partial) { m.partial = false; m.err = 'La respuesta se interrumpió al cerrarse la página.'; }
        });
        return c;
      });
      state.currentId = d.currentId || null;
      state.model = d.model === 'pro' ? 'pro' : 'fast';
    } catch (e) { /* almacenamiento vacío o corrupto: se empieza de cero */ }
  }
  function saveNow() {
    clearTimeout(saveTimer); saveTimer = null;
    var payload = function () { return JSON.stringify({ chats: state.chats, currentId: state.currentId, model: state.model }); };
    try { localStorage.setItem(KEY, payload()); }
    catch (e) {
      // Sin espacio: descarta los chats más antiguos y reintenta una vez.
      try {
        state.chats = state.chats.slice(0, Math.max(5, Math.floor(state.chats.length / 2)));
        localStorage.setItem(KEY, payload());
        toast('Poco espacio: se borraron chats antiguos');
      } catch (e2) { /* almacenamiento no disponible */ }
    }
  }
  function save() { clearTimeout(saveTimer); saveTimer = setTimeout(saveNow, 500); }
  window.addEventListener('pagehide', saveNow);
  document.addEventListener('visibilitychange', function () { if (document.visibilityState === 'hidden') saveNow(); });

  /* =====================================================================
   * Imágenes: almacén local (IndexedDB, con respaldo en memoria) y adjuntos
   * ===================================================================== */
  var IMG_DB = 'asistente-img', memImgs = new Map(), urlCache = new Map(), dbp = null;
  function idb() {
    if (!dbp) dbp = new Promise(function (res, rej) {
      if (!window.indexedDB) return rej(new Error('sin indexedDB'));
      var r = indexedDB.open(IMG_DB, 1);
      r.onupgradeneeded = function () { r.result.createObjectStore('imgs'); };
      r.onsuccess = function () { res(r.result); };
      r.onerror = function () { rej(r.error); };
    });
    return dbp;
  }
  function imgPut(id, blob) {
    memImgs.set(id, blob);
    return idb().then(function (db) {
      return new Promise(function (res, rej) { var tx = db.transaction('imgs', 'readwrite'); tx.objectStore('imgs').put(blob, id); tx.oncomplete = res; tx.onerror = function () { rej(tx.error); }; });
    }).catch(function () { /* queda solo en memoria durante esta sesión */ });
  }
  function imgGet(id) {
    if (memImgs.has(id)) return Promise.resolve(memImgs.get(id));
    return idb().then(function (db) {
      return new Promise(function (res, rej) { var q = db.transaction('imgs').objectStore('imgs').get(id); q.onsuccess = function () { res(q.result || null); }; q.onerror = function () { rej(q.error); }; });
    }).catch(function () { return null; });
  }
  function imgDel(ids) {
    ids.forEach(function (id) { memImgs.delete(id); var u = urlCache.get(id); if (u) { URL.revokeObjectURL(u); urlCache.delete(id); } });
    if (!ids.length) return;
    idb().then(function (db) { var tx = db.transaction('imgs', 'readwrite'); ids.forEach(function (id) { tx.objectStore('imgs').delete(id); }); }).catch(function () {});
  }
  function imgUrl(id) {
    if (urlCache.has(id)) return Promise.resolve(urlCache.get(id));
    return imgGet(id).then(function (b) { if (!b) return null; var u = URL.createObjectURL(b); urlCache.set(id, u); return u; });
  }
  function chatImageIds(chat) {
    var ids = [];
    chat.messages.forEach(function (m) {
      (m.images || []).forEach(function (i) { ids.push(i.id); });
      (m.docs || []).forEach(function (d) { ids.push(d.id); if (d.orig) ids.push(d.id + ':orig'); });
    });
    return ids;
  }
  function blobToB64(blob) {
    return new Promise(function (res, rej) { var fr = new FileReader(); fr.onload = function () { res(String(fr.result).split(',')[1]); }; fr.onerror = function () { rej(fr.error); }; fr.readAsDataURL(blob); });
  }
  function b64ToBlob(b64, mime) { var bin = atob(b64), a = new Uint8Array(bin.length); for (var i = 0; i < bin.length; i++) a[i] = bin.charCodeAt(i); return new Blob([a], { type: mime }); }
  function resolveImgs(root) {
    root.querySelectorAll('img[data-img-id]').forEach(function (im) {
      imgUrl(im.getAttribute('data-img-id')).then(function (u) {
        if (u) im.src = u;
        else { var s = document.createElement('span'); s.className = 'missing'; s.textContent = 'Imagen no disponible en este dispositivo'; im.replaceWith(s); }
      });
    });
  }

  var MAX_ATTACH = 4, MAX_SRC_BYTES = 15 * 1024 * 1024, MAX_OUT_BYTES = 4.5 * 1024 * 1024, MAX_SIDE = 2048;
  var pending = [];        // adjuntos aún sin enviar: { id, blob, mime, name, url }
  var imageMode = false;   // modo "crear o editar imagen"
  var caps = { imageGen: false };

  function sniffImage(h) {
    if (h[0] === 0xff && h[1] === 0xd8 && h[2] === 0xff) return 'image/jpeg';
    if (h[0] === 0x89 && h[1] === 0x50 && h[2] === 0x4e && h[3] === 0x47) return 'image/png';
    if (h[0] === 0x52 && h[1] === 0x49 && h[2] === 0x46 && h[3] === 0x46 && h[8] === 0x57 && h[9] === 0x45 && h[10] === 0x42 && h[11] === 0x50) return 'image/webp';
    return null;
  }
  // Reescala (máx. 2048 px) y vuelve a codificar: reduce el peso y elimina metadatos (EXIF, ubicación).
  async function processImage(file) {
    var type = sniffImage(new Uint8Array(await file.slice(0, 12).arrayBuffer()));
    if (!type) throw new Error('formato');
    var bmp = await createImageBitmap(file, { imageOrientation: 'from-image' });
    var scale = Math.min(1, MAX_SIDE / Math.max(bmp.width, bmp.height)), outType = type, blob = null, tries = 0;
    for (;;) {
      var w = Math.max(1, Math.round(bmp.width * scale)), h = Math.max(1, Math.round(bmp.height * scale));
      var c = document.createElement('canvas'); c.width = w; c.height = h;
      var ctx = c.getContext('2d');
      if (outType === 'image/jpeg') { ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, w, h); }
      ctx.drawImage(bmp, 0, 0, w, h);
      blob = await new Promise(function (res) { c.toBlob(res, outType, 0.9); });
      if (!blob) throw new Error('codificar');
      if (blob.type !== outType && outType === 'image/webp') { outType = 'image/png'; continue; }   // navegador sin codificador WebP
      if (blob.size <= MAX_OUT_BYTES || tries >= 5) break;
      scale *= 0.75; tries++;
    }
    if (bmp.close) bmp.close();
    if (blob.size > MAX_OUT_BYTES) throw new Error('grande');
    return { blob: blob, mime: blob.type };
  }
  async function addFiles(files) {
    files = Array.prototype.slice.call(files);
    var docs = [], imgs = [];
    files.forEach(function (f) { (window.DocTools && DocTools.isDocument(f) ? docs : imgs).push(f); });
    if (docs.length) await addDocs(docs);
    if (imgs.length) await addImages(imgs);
  }
  var pendingDocs = [], MAX_DOCS = 3;
  async function addDocs(files) {
    for (var i = 0; i < files.length; i++) {
      var f = files[i], nm = f.name || 'documento';
      if (pendingDocs.length >= MAX_DOCS) { toast('Máximo ' + MAX_DOCS + ' documentos por mensaje'); break; }
      toast('Leyendo «' + nm + '»…');
      try {
        var d = await DocTools.readDocument(f);
        if (d.scanned) {   // PDF sin texto: se envían páginas como imágenes y el modelo las lee con visión (OCR)
          var room = MAX_ATTACH - pending.length, use = d.images.slice(0, Math.max(0, room));
          if (!use.length) { toast('Quita alguna imagen para añadir las páginas de «' + nm + '»'); continue; }
          use.forEach(function (im) { pending.push({ id: uid(), blob: im.blob, mime: im.mime, name: im.name, url: URL.createObjectURL(im.blob), scan: true }); });
          toast('«' + nm + '» es un escaneo: se enviarán ' + use.length + ' página' + (use.length > 1 ? 's' : '') + ' como imágenes para leerlas con visión' + (d.totalPages > use.length ? ' (de ' + d.totalPages + ')' : ''));
        } else {
          pendingDocs.push({ id: uid(), name: d.name, kind: d.kind, text: d.text, chars: d.text.length, detail: d.detail, original: d.original });
          if (d.truncated) toast('«' + nm + '» es muy extenso: se usará solo el principio');
          else toast('«' + nm + '» listo (' + d.detail + ')');
        }
      } catch (e) {
        var c = e && e.code;
        toast(c === 'antiguo' ? '«' + nm + '»: ' + e.legacy + ' no se puede leer. Guárdalo como .docx, .xlsx o .pptx'
          : c === 'grande' ? '«' + nm + '» pesa más de 25 MB'
          : c === 'clave' ? '«' + nm + '» está protegido con contraseña'
          : c === 'vacio' ? '«' + nm + '» no contiene texto'
          : c === 'lib' ? 'No se pudo cargar el lector de documentos (¿sin conexión?)'
          : 'No se pudo leer «' + nm + '»: el archivo parece dañado');
      }
    }
    renderAttach(); grow();
  }
  async function addImages(files) {
    if (!files.length) return;
    var room = MAX_ATTACH - pending.length;
    if (room <= 0) { toast('Máximo ' + MAX_ATTACH + ' imágenes por mensaje'); return; }
    if (files.length > room) { toast('Solo se añadieron ' + room + ' (máximo ' + MAX_ATTACH + ' por mensaje)'); files = files.slice(0, room); }
    for (var i = 0; i < files.length; i++) {
      var f = files[i], nm = f.name || 'archivo';
      if (f.size > MAX_SRC_BYTES) { toast('«' + nm + '» pesa más de 15 MB'); continue; }
      try {
        var r = await processImage(f);
        pending.push({ id: uid(), blob: r.blob, mime: r.mime, name: nm, url: URL.createObjectURL(r.blob) });
      } catch (e) {
        toast(e.message === 'formato' ? '«' + nm + '»: formato no admitido. Acepto imágenes (JPG, PNG, WEBP) y documentos (Word, PDF, Excel, PowerPoint, CSV, TXT)'
          : e.message === 'grande' ? '«' + nm + '» es demasiado grande' : 'No se pudo leer «' + nm + '»');
      }
    }
    renderAttach(); grow();
  }
  function renderAttach() {
    var box = $('attach'); box.innerHTML = '';
    pending.forEach(function (p) {
      var d = document.createElement('div'); d.className = 'thumb';
      var im = document.createElement('img'); im.src = p.url; im.alt = p.name; d.appendChild(im);
      var x = document.createElement('button'); x.type = 'button'; x.setAttribute('aria-label', 'Quitar ' + p.name); x.innerHTML = icon('x');
      x.onclick = function () { removePending(p.id); }; d.appendChild(x);
      box.appendChild(d);
    });
    pendingDocs.forEach(function (p) {
      var d = document.createElement('div'); d.className = 'doc-card';
      d.innerHTML = icon('file');
      var t = document.createElement('div'); t.className = 'doc-meta';
      var n = document.createElement('b'); n.textContent = p.name; t.appendChild(n);
      var s = document.createElement('small'); s.textContent = p.detail || p.kind; t.appendChild(s); d.appendChild(t);
      var x = document.createElement('button'); x.type = 'button'; x.setAttribute('aria-label', 'Quitar ' + p.name); x.innerHTML = icon('x');
      x.onclick = function () { pendingDocs = pendingDocs.filter(function (q) { return q.id !== p.id; }); renderAttach(); grow(); }; d.appendChild(x);
      box.appendChild(d);
    });
    box.hidden = !(pending.length || pendingDocs.length);
  }
  function removePending(id) {
    pending = pending.filter(function (p) { if (p.id === id) URL.revokeObjectURL(p.url); return p.id !== id; });
    renderAttach(); grow();
  }
  function clearPending() { pending.forEach(function (p) { URL.revokeObjectURL(p.url); }); pending = []; pendingDocs = []; renderAttach(); }
  function setImageMode(on) {
    imageMode = !!on; $('modeChip').hidden = !imageMode;
    input.placeholder = imageMode ? 'Describe la imagen que quieres crear o editar' : 'Pregunta lo que quieras';
    grow();
  }
  function canSend() { return !!input.value.trim() || pending.length > 0 || pendingDocs.length > 0; }

  /* =====================================================================
   * Markdown seguro (todo el texto se escapa; los enlaces solo http/https/mailto)
   * ===================================================================== */
  var mathCache = new Map();
  function esc(s) { return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }

  function renderMath(src, display) {
    var k = (display ? 'D' : 'I') + src;
    if (mathCache.has(k)) return mathCache.get(k);
    var html;
    if (window.katex) {
      try { html = window.katex.renderToString(src, { displayMode: display, throwOnError: false, strict: 'ignore', trust: false }); }
      catch (e) { html = '<code>' + esc(src) + '</code>'; }
    } else { html = '<code>' + esc(src) + '</code>'; }
    if (mathCache.size > 500) mathCache.clear();
    mathCache.set(k, html);
    return html;
  }

  function renderMarkdown(src) {
    var stash = [];
    function put(html) { stash.push(html); return '\u0000' + (stash.length - 1) + '\u0000'; }

    // 1) Bloques de código (también si aún no se cerró, mientras llega el texto)
    src = src.replace(/```([^\n`]*)\n([\s\S]*?)(?:```|$)/g, function (_, lang, code) {
      lang = (lang || '').trim().split(/\s+/)[0].replace(/[^\w+#.-]/g, '').slice(0, 20);
      if (lang === 'edits' && window.Exporter) {   // cambios propuestos a un Word adjunto: se muestran como resumen + botón
        var ed = Exporter.parseEdits(code);
        if (ed) {
          var items = ed.edits.slice(0, 6).map(function (e) { return '<li><b>P' + esc(String(parseInt(e.p, 10))) + '</b> ' + esc(e.text.slice(0, 110)) + (e.text.length > 110 ? '…' : '') + '</li>'; }).join('');
          if (ed.edits.length > 6) items += '<li>y ' + (ed.edits.length - 6) + ' más…</li>';
          return '\n' + put('<div class="edits"><div class="edits-head">Cambios propuestos' + (ed.doc ? ' en «' + esc(ed.doc) + '»' : '') + ': ' + ed.edits.length + (ed.edits.length === 1 ? ' párrafo' : ' párrafos') + '</div><ul>' + items + '</ul>' +
            '<button type="button" data-act="applyedits" data-doc="' + esc(ed.doc) + '">Descargar documento editado (.docx)</button>' +
            '<small>Se conservan tablas, imágenes, encabezados, márgenes y estilos. En los párrafos modificados se pierde el formato parcial dentro de la frase (por ejemplo, una palabra en negrita).</small></div>') + '\n';
        }
      }
      return '\n' + put('<div class="code"><div class="code-head"><span>' + esc(lang || 'código') + '</span>' +
        '<button type="button" data-act="copycode">Copiar</button></div><pre><code>' + esc(code.replace(/\n$/, '')) + '</code></pre></div>') + '\n';
    });
    // 2) Código en línea
    src = src.replace(/`([^`\n]+)`/g, function (_, c) { return put('<code>' + esc(c) + '</code>'); });
    // 3) Fórmulas
    src = src.replace(/\$\$([\s\S]+?)\$\$/g, function (_, m) { return '\n' + put(renderMath(m.trim(), true)) + '\n'; });
    src = src.replace(/\\\[([\s\S]+?)\\\]/g, function (_, m) { return '\n' + put(renderMath(m.trim(), true)) + '\n'; });
    src = src.replace(/\\\(([\s\S]+?)\\\)/g, function (_, m) { return put(renderMath(m.trim(), false)); });
    src = src.replace(/(^|[^\\$\w])\$(?!\s)([^$\n]+?)(?<!\s)\$(?![\w$])/g, function (_, pre, m) { return pre + put(renderMath(m, false)); });

    src = esc(src);

    function inline(s) {
      s = s.replace(/\[([^\]\n]+)\]\((https?:\/\/[^\s)]+|mailto:[^\s)]+)\)/g, function (_, t, u) {
        return put('<a href="' + u + '" target="_blank" rel="noopener noreferrer">' + t + '</a>');
      });
      s = s.replace(/(^|[\s(])(https?:\/\/[^\s<)]+[^\s<).,;:!?])/g, function (_, pre, u) {
        return pre + put('<a href="' + u + '" target="_blank" rel="noopener noreferrer">' + u + '</a>');
      });
      s = s.replace(/\*\*(?=\S)([\s\S]+?)(?<=\S)\*\*/g, '<strong>$1</strong>');
      s = s.replace(/(^|[^*\w])\*(?=[^\s*])([^*\n]+?)(?<=[^\s*])\*(?!\*)/g, '$1<em>$2</em>');
      s = s.replace(/~~(?=\S)([\s\S]+?)(?<=\S)~~/g, '<del>$1</del>');
      return s;
    }

    var lines = src.split('\n'), out = [], i = 0, para = [];
    function flush() { if (para.length) { out.push('<p>' + inline(para.join('\n')).replace(/\n/g, '<br>') + '</p>'); para = []; } }
    var isTableSep = function (l) { return /^\s*\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)*\|?\s*$/.test(l) && l.indexOf('-') >= 0 && l.indexOf('|') >= 0; };
    var splitRow = function (l) { return l.trim().replace(/^\||\|$/g, '').split('|').map(function (c) { return c.trim(); }); };
    var listRe = /^(\s*)([-*+]|\d{1,3}[.)])\s+(.*)$/;

    while (i < lines.length) {
      var line = lines[i], m;
      if (!line.trim()) { flush(); i++; continue; }
      if (/^\u0000\d+\u0000$/.test(line.trim())) { flush(); out.push(line.trim()); i++; continue; }
      if ((m = line.match(/^(#{1,6})\s+(.*?)\s*#*\s*$/))) { flush(); out.push('<h' + m[1].length + '>' + inline(m[2]) + '</h' + m[1].length + '>'); i++; continue; }
      if (/^\s*([-*_])(\s*\1){2,}\s*$/.test(line)) { flush(); out.push('<hr>'); i++; continue; }
      if (/^&gt;\s?/.test(line)) {
        flush(); var q = [];
        while (i < lines.length && /^&gt;\s?/.test(lines[i])) { q.push(lines[i].replace(/^&gt;\s?/, '')); i++; }
        out.push('<blockquote>' + inline(q.join('\n')).replace(/\n/g, '<br>') + '</blockquote>'); continue;
      }
      if (line.indexOf('|') >= 0 && i + 1 < lines.length && isTableSep(lines[i + 1])) {
        flush();
        var head = splitRow(line), aligns = splitRow(lines[i + 1]).map(function (c) { return /^:-+:$/.test(c) ? 'center' : /-:$/.test(c) ? 'right' : 'left'; });
        i += 2; var rows = [];
        while (i < lines.length && lines[i].trim() && lines[i].indexOf('|') >= 0) { rows.push(splitRow(lines[i])); i++; }
        var cell = function (tag, t, k) { return '<' + tag + ' style="text-align:' + (aligns[k] || 'left') + '">' + inline(t) + '</' + tag + '>'; };
        out.push('<div class="table-wrap"><table><thead><tr>' + head.map(function (c, k) { return cell('th', c, k); }).join('') + '</tr></thead><tbody>' +
          rows.map(function (r) { return '<tr>' + head.map(function (_, k) { return cell('td', r[k] || '', k); }).join('') + '</tr>'; }).join('') + '</tbody></table></div>');
        continue;
      }
      if (listRe.test(line)) {
        flush(); var items = [];
        while (i < lines.length && (listRe.test(lines[i]) || (/^\s{2,}\S/.test(lines[i]) && items.length))) {
          var lm = lines[i].match(listRe);
          if (lm) items.push({ indent: lm[1].replace(/\t/g, '    ').length, ordered: /\d/.test(lm[2]), text: lm[3] });
          else items[items.length - 1].text += '\n' + lines[i].trim();
          i++;
        }
        out.push(buildList(items)); continue;
      }
      para.push(line); i++;
    }
    flush();

    function buildList(items) {
      var html = '', stack = [];   // pila de { indent, tag }
      items.forEach(function (it) {
        while (stack.length && it.indent < stack[stack.length - 1].indent) { html += '</li></' + stack.pop().tag + '>'; }
        var top = stack[stack.length - 1], tag = it.ordered ? 'ol' : 'ul';
        if (!top || it.indent > top.indent) { html += '<' + tag + '>'; stack.push({ indent: it.indent, tag: tag }); }
        else { html += '</li>'; }
        html += '<li>' + inline(it.text).replace(/\n/g, '<br>');
      });
      while (stack.length) { html += '</li></' + stack.pop().tag + '>'; }
      return html;
    }

    var html = out.join('');
    for (var r = 0; r < 2; r++) html = html.replace(/\u0000(\d+)\u0000/g, function (_, n) { return stash[+n]; });
    return html;
  }

  /* =====================================================================
   * Render de mensajes
   * ===================================================================== */
  var TYPING = '<span class="typing" aria-label="Escribiendo"></span>';

  function fillBot(el, m, live) {
    var content = el.querySelector('.content');
    if (m.kind === 'image' && m.images && m.images.length && !live) {
      var alt = esc('Imagen creada: ' + String(m.prompt || '').slice(0, 120));
      content.innerHTML = '<div class="imgs gen">' + m.images.map(function (i) { return '<img data-img-id="' + esc(i.id) + '" alt="' + alt + '">'; }).join('') + '</div>';
      resolveImgs(content);
    } else {
      content.innerHTML = m.text ? renderMarkdown(m.text) : (live ? (m.retrying ? '<span class="retrying">Reconectando…</span>' : TYPING) : '');
    }
    var old = el.querySelector('.errbox'); if (old) old.remove();
    if (m.err && !live) {
      var box = document.createElement('div'); box.className = 'errbox'; box.setAttribute('role', 'alert');
      var span = document.createElement('span'); span.textContent = m.err; box.appendChild(span);
      if (!m.noRetry) {
        var b = document.createElement('button'); b.type = 'button'; b.setAttribute('data-act', 'redo'); b.textContent = 'Reintentar'; box.appendChild(b);
      }
      el.insertBefore(box, el.querySelector('.actions'));
    }
    el.querySelector('.actions').hidden = !(m.text || (m.images && m.images.length));
  }
  function msgEl(m) {
    var d = document.createElement('div');
    if (m.role === 'user') {
      d.className = 'msg user';
      if (m.images && m.images.length) {
        var g = document.createElement('div'); g.className = 'imgs';
        m.images.forEach(function (i) {
          var im = document.createElement('img'); im.setAttribute('data-img-id', i.id); im.alt = 'Imagen adjunta: ' + (i.name || ''); g.appendChild(im);
        });
        d.appendChild(g); resolveImgs(g);
      }
      if (m.docs && m.docs.length) {
        var dg = document.createElement('div'); dg.className = 'docs';
        m.docs.forEach(function (dd) {
          var c = document.createElement('div'); c.className = 'doc-chip'; c.innerHTML = icon('file');
          var s1 = document.createElement('span'); s1.textContent = dd.name; c.appendChild(s1);
          if (dd.detail) { var s2 = document.createElement('small'); s2.textContent = dd.detail; c.appendChild(s2); }
          dg.appendChild(c);
        });
        d.appendChild(dg);
      }
      if (m.text) { var b = document.createElement('div'); b.className = 'bubble'; b.textContent = m.text; d.appendChild(b); }
    } else {
      d.className = 'msg bot';
      var first = m.kind === 'image'
        ? '<button class="icon-btn" data-act="dl" aria-label="Descargar imagen">' + icon('download') + '</button>' +
          '<button class="icon-btn" data-act="edit" aria-label="Editar esta imagen">' + icon('edit') + '</button>'
        : '<button class="icon-btn" data-act="copy" aria-label="Copiar respuesta">' + icon('copy') + '</button>' +
          '<button class="icon-btn" data-act="export" aria-haspopup="menu" aria-expanded="false" aria-label="Descargar como archivo (Word, PDF, Excel, PowerPoint)">' + icon('download') + '</button>';
      d.innerHTML = '<div class="content"></div><div class="actions">' + first +
        '<button class="icon-btn" data-act="redo" aria-label="' + (m.kind === 'image' ? 'Volver a crear la imagen' : 'Regenerar respuesta') + '">' + icon('redo') + '</button></div>';
      fillBot(d, m, false);
    }
    return d;
  }
  function current() { return state.chats.filter(function (c) { return c.id === state.currentId; })[0] || null; }
  function renderThread() {
    inner.innerHTML = '';
    var c = current(); if (!c) return;
    c.messages.forEach(function (m) { inner.appendChild(msgEl(m)); });
    markLast();
    thread.scrollTop = thread.scrollHeight;
  }
  function markLast() {
    var bots = inner.querySelectorAll('.msg.bot');
    bots.forEach(function (b) { b.classList.remove('last'); });
    if (bots.length) bots[bots.length - 1].classList.add('last');
  }

  /* ---------- Lista de chats ---------- */
  function renderList() {
    var q = $('searchInput').value.trim().toLowerCase();
    var shown = state.chats.filter(function (c) { return !q || c.title.toLowerCase().indexOf(q) >= 0; });
    list.innerHTML = '';
    if (!shown.length) {
      var e = document.createElement('div'); e.className = 'empty-list';
      e.textContent = q ? 'Sin resultados' : 'Aún no hay chats'; list.appendChild(e); return;
    }
    shown.forEach(function (c) {
      var row = document.createElement('div'); row.className = 'row'; row.setAttribute('role', 'listitem'); row.dataset.id = c.id;
      var b = document.createElement('button');
      b.className = 'nav-item' + (c.id === state.currentId ? ' active' : '');
      var s = document.createElement('span'); s.textContent = c.title; b.appendChild(s);
      b.onclick = function () { if (c.id !== state.currentId) { stopGen(); openChat(c.id); } if (isMobile()) setSide(false); };
      var more = document.createElement('button'); more.className = 'more'; more.type = 'button';
      more.setAttribute('aria-label', 'Opciones de ' + c.title); more.setAttribute('aria-haspopup', 'menu'); more.setAttribute('aria-expanded', 'false');
      more.innerHTML = icon('dots');
      more.onclick = function (ev) { ev.stopPropagation(); openChatMenu(c.id, more); };
      row.appendChild(b); row.appendChild(more); list.appendChild(row);
    });
  }
  function openChat(id) {
    clearPending(); setImageMode(false);   // los adjuntos y el modo imagen no se arrastran a otro chat
    state.currentId = id; app.dataset.mode = id ? 'chat' : 'home';
    renderThread(); renderList(); saveNow();
    if (!isMobile()) input.focus();
  }

  /* ---------- Menú de un chat: cambiar nombre / eliminar ---------- */
  var chatMenu = $('chatMenu'), menuChatId = null, menuBtn = null;
  function closeChatMenu() {
    chatMenu.hidden = true; if (menuBtn) menuBtn.setAttribute('aria-expanded', 'false'); menuBtn = null; menuChatId = null;
  }
  function openChatMenu(id, btn) {
    if (menuBtn === btn) { closeChatMenu(); return; }
    closeChatMenu(); togglePop(false);
    menuChatId = id; menuBtn = btn; btn.setAttribute('aria-expanded', 'true');
    chatMenu.hidden = false;
    var r = btn.getBoundingClientRect(), w = chatMenu.offsetWidth;
    chatMenu.style.top = Math.min(r.bottom + 4, window.innerHeight - chatMenu.offsetHeight - 8) + 'px';
    chatMenu.style.left = Math.max(8, Math.min(r.left, window.innerWidth - w - 8)) + 'px';
    chatMenu.querySelector('button').focus();
  }
  chatMenu.addEventListener('click', function (e) {
    var b = e.target.closest('[data-do]'); if (!b) return;
    var id = menuChatId; closeChatMenu();
    if (b.dataset.do === 'rename') startRename(id); else deleteChat(id);
  });
  function startRename(id) {
    var c = state.chats.filter(function (x) { return x.id === id; })[0]; if (!c) return;
    var row = list.querySelector('.row[data-id="' + id + '"]'); if (!row) return;
    var inp = document.createElement('input'); inp.className = 'rename'; inp.value = c.title; inp.maxLength = 80; inp.setAttribute('aria-label', 'Nuevo nombre del chat');
    row.innerHTML = ''; row.appendChild(inp); inp.focus(); inp.select();
    var done = false;
    function finish(commit) {
      if (done) return; done = true;
      if (commit) { var t = inp.value.trim(); if (t) { c.title = t.slice(0, 80); saveNow(); } }
      renderList();
    }
    inp.addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); finish(true); } else if (e.key === 'Escape') { e.preventDefault(); finish(false); } });
    inp.addEventListener('blur', function () { finish(true); });
  }
  function deleteChat(id) {
    var c = state.chats.filter(function (x) { return x.id === id; })[0]; if (!c) return;
    if (!window.confirm('¿Eliminar «' + c.title + '»? Esta acción no se puede deshacer.')) return;
    if (gen && gen.chat === c) stopGen();
    imgDel(chatImageIds(c));
    state.chats = state.chats.filter(function (x) { return x.id !== id; });
    if (state.currentId === id) { state.currentId = null; app.dataset.mode = 'home'; renderThread(); }
    renderList(); saveNow(); toast('Chat eliminado');
  }

  /* =====================================================================
   * Generación: streaming real contra /api/chat
   * ===================================================================== */
  var gen = null;   // { ac, msg, el, chat }

  function setBusy(on) {
    sendBtn.innerHTML = on ? icon('stop', 'fill') : icon('up');
    sendBtn.setAttribute('aria-label', on ? 'Detener respuesta' : 'Enviar mensaje');
    sendBtn.disabled = on ? false : !canSend();
  }
  function stopGen() { if (gen) gen.ac.abort(); }
  function sleep(ms, signal) {
    return new Promise(function (res, rej) {
      var t = setTimeout(res, ms);
      signal.addEventListener('abort', function () { clearTimeout(t); rej(new DOMException('Abort', 'AbortError')); }, { once: true });
    });
  }
  function apiError(message, extra) { var e = new Error(message); e.userMessage = message; Object.assign(e, extra || {}); return e; }

  // Solo se reenvían las imágenes y los documentos de los últimos mensajes que los tienen: ahorra datos y costo.
  async function buildHistory(chat, upto) {
    var msgs = chat.messages.slice(0, upto), out = [], keepImg = {}, keepDoc = {}, imgTotal = 0, imgKept = 0, docKept = 0, docChars = 0;
    for (var i = msgs.length - 1; i >= 0; i--) {
      var mm = msgs[i]; if (mm.role !== 'user') continue;
      var n = mm.images ? mm.images.length : 0;
      if (n && imgKept < 2 && imgTotal + n <= 6) { keepImg[i] = true; imgTotal += n; imgKept++; }
      var dc = (mm.docs || []).reduce(function (a, d) { return a + d.chars; }, 0);
      if (dc && docKept < 2 && docChars + dc <= 230000) { keepDoc[i] = true; docChars += dc; docKept++; }
    }
    for (var j = 0; j < msgs.length; j++) {
      var m = msgs[j];
      if (m.role === 'user') {
        var item = { role: 'user', content: m.text };
        if (keepImg[j]) {
          var imgs = [];
          for (var k = 0; k < m.images.length; k++) {
            var b = await imgGet(m.images[k].id);
            if (b) imgs.push({ mime: m.images[k].mime, data: await blobToB64(b) });
          }
          if (imgs.length) item.images = imgs;
        } else if (m.images && m.images.length) item.content += ' [con imágenes adjuntas anteriormente]';
        if (keepDoc[j]) {
          var ds = [];
          for (var q = 0; q < m.docs.length; q++) {
            var tb = await imgGet(m.docs[q].id);
            if (tb) ds.push({ name: m.docs[q].name, text: await tb.text() });
          }
          if (ds.length) item.docs = ds;
        } else if (m.docs && m.docs.length) item.content += ' [con documentos adjuntos anteriormente: ' + m.docs.map(function (d) { return d.name; }).join(', ') + ']';
        out.push(item);
      } else if (m.kind === 'image') {
        if (m.images && m.images.length) out.push({ role: 'assistant', content: '[Se creó una imagen a partir de: «' + (m.prompt || '') + '»]' });
      } else if (m.text) out.push({ role: 'assistant', content: m.text });
    }
    return out.slice(-40);
  }

  async function streamOnce(chat, msg, signal, onText) {
    var res, hist;
    try { hist = await buildHistory(chat, chat.messages.indexOf(msg)); }
    catch (e) { throw apiError('No se pudieron leer las imágenes adjuntas de este dispositivo.'); }
    try {
      res = await fetch('/api/chat', {
        method: 'POST', signal: signal, headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ model: state.model, messages: hist })
      });
    } catch (e) {
      if (e.name === 'AbortError') throw e;
      throw apiError('No hay conexión con el servidor. Revisa tu internet.', { network: true });
    }
    if (!res.ok) {
      var j = null; try { j = await res.json(); } catch (e) { /* sin cuerpo JSON */ }
      var wait = parseInt(res.headers.get('retry-after') || '0', 10);
      throw apiError((j && j.error && j.error.message) || 'El servidor respondió con un error (' + res.status + ').', { status: res.status, wait: wait });
    }
    if (res.headers.get('x-ai-degraded') === '1') toast('El modelo Pro está saturado: se usó el rápido.');
    var reader = res.body.getReader(), dec = new TextDecoder(), buf = '', sawDone = false;
    try {
      for (;;) {
        var r = await reader.read();
        if (r.done) break;
        buf += dec.decode(r.value, { stream: true });
        var idx;
        while ((idx = buf.indexOf('\n\n')) >= 0) {
          var raw = buf.slice(0, idx); buf = buf.slice(idx + 2);
          var line = raw.split('\n').filter(function (l) { return l.indexOf('data:') === 0; })[0];
          if (!line) continue;
          var ev; try { ev = JSON.parse(line.slice(5)); } catch (e) { continue; }
          if (ev.text) onText(ev.text);
          else if (ev.error) throw apiError(ev.error.message || 'Error del servidor.');
          else if (ev.done) {
            sawDone = true;
            if (ev.blocked) { msg.err = 'La solicitud fue bloqueada por los filtros de seguridad del modelo.'; msg.noRetry = false; }
            else if (ev.finish === 'MAX_TOKENS') { msg.err = 'La respuesta alcanzó el límite de longitud. Escribe «continúa» para seguir.'; msg.noRetry = true; }
            else if (ev.note) { msg.err = ev.note; msg.noRetry = true; }
            else if (!msg.text) { msg.err = 'El modelo no devolvió texto. Inténtalo de nuevo.'; }
          }
        }
      }
    } catch (e) {
      if (e.name === 'AbortError' || e.userMessage) throw e;
      throw apiError('Se perdió la conexión mientras se generaba la respuesta.', { network: true });
    }
    if (!sawDone) throw apiError('Se interrumpió la respuesta. Puedes reintentar.');
  }

  async function runGeneration(chat, msg, el) {
    var ac = new AbortController();
    gen = { ac: ac, msg: msg, el: el, chat: chat };
    setBusy(true);
    msg.partial = true; msg.err = ''; msg.noRetry = false; msg.retrying = false;
    var content = el.querySelector('.content'), pending = false;
    function paint() {
      pending = false;
      var near = thread.scrollHeight - thread.scrollTop - thread.clientHeight < 90;
      content.innerHTML = msg.text ? renderMarkdown(msg.text) : (msg.retrying ? '<span class="retrying">Reconectando…</span>' : TYPING);
      if (near) thread.scrollTop = thread.scrollHeight;
    }
    function onText(t) { msg.text += t; if (!pending) { pending = true; requestAnimationFrame(paint); } save(); }

    var attempt = 0;
    for (;;) {
      try { await streamOnce(chat, msg, ac.signal, onText); break; }
      catch (e) {
        if (e.name === 'AbortError') { if (!msg.text) { msg.err = 'Respuesta detenida.'; } break; }
        if (e.network && !msg.text && attempt < 2) {
          attempt++; msg.retrying = true; paint();
          try { await sleep(attempt * 1500, ac.signal); } catch (x) { msg.err = 'Respuesta detenida.'; break; }
          msg.retrying = false; continue;
        }
        msg.err = e.userMessage || 'Ocurrió un error inesperado.';
        if (e.wait) msg.err += ' (reintenta en ' + e.wait + ' s)';
        if (e.status === 400 || e.status === 413) msg.noRetry = true;
        break;
      }
    }
    msg.partial = false; msg.retrying = false;
    gen = null; setBusy(false);
    el.classList.remove('streaming');
    fillBot(el, msg, false);
    markLast(); saveNow();
    thread.scrollTop = thread.scrollHeight;
  }

  function respond(chat) {
    var msg = { role: 'bot', text: '' };
    chat.messages.push(msg);
    var el = msgEl(msg); el.classList.add('streaming');
    el.querySelector('.content').innerHTML = TYPING;
    inner.appendChild(el); markLast();
    thread.scrollTop = thread.scrollHeight;
    runGeneration(chat, msg, el);
  }

  function respondImage(chat) {
    var umsg = chat.messages[chat.messages.length - 1];
    var msg = { role: 'bot', text: '', kind: 'image', prompt: umsg.text };
    chat.messages.push(msg);
    var el = msgEl(msg); el.classList.add('streaming');
    el.querySelector('.content').innerHTML = '<span class="retrying">' + (umsg.images && umsg.images.length ? 'Editando imagen… puede tardar hasta un minuto' : 'Creando imagen… puede tardar hasta un minuto') + '</span> ' + TYPING;
    inner.appendChild(el); markLast();
    thread.scrollTop = thread.scrollHeight;
    runImage(chat, msg, el, umsg);
  }
  async function runImage(chat, msg, el, umsg) {
    var ac = new AbortController();
    gen = { ac: ac, msg: msg, el: el, chat: chat }; setBusy(true);
    msg.err = ''; msg.noRetry = false; msg.partial = true;
    try {
      var imgs = [];
      for (var k = 0; k < (umsg.images || []).length; k++) {
        var b = await imgGet(umsg.images[k].id);
        if (b) imgs.push({ mime: umsg.images[k].mime, data: await blobToB64(b) });
      }
      var res;
      try {
        res = await fetch('/api/image', { method: 'POST', signal: ac.signal, headers: { 'content-type': 'application/json' }, body: JSON.stringify({ prompt: umsg.text, images: imgs }) });
      } catch (e) {
        if (e.name === 'AbortError') throw e;
        throw apiError('No hay conexión con el servidor. Revisa tu internet.');
      }
      var j = null; try { j = await res.json(); } catch (e) { /* sin JSON */ }
      if (!res.ok) {
        var wait = parseInt(res.headers.get('retry-after') || '0', 10);
        if ([400, 413, 422, 501].indexOf(res.status) >= 0) msg.noRetry = true;
        throw apiError(((j && j.error && j.error.message) || 'El servidor respondió con un error (' + res.status + ').') + (wait && res.status === 429 ? ' (reintenta en ' + wait + ' s)' : ''));
      }
      if (!j || !j.images || !j.images.length) throw apiError('No se recibió ninguna imagen.');
      var out = [];
      for (var n = 0; n < j.images.length; n++) {
        var id = uid(); await imgPut(id, b64ToBlob(j.images[n].data, j.images[n].mime)); out.push({ id: id, mime: j.images[n].mime });
      }
      msg.images = out;
    } catch (e) {
      msg.err = e.name === 'AbortError' ? 'Cancelado.' : (e.userMessage || 'No se pudo crear la imagen.');
    }
    msg.partial = false; gen = null; setBusy(false);
    el.classList.remove('streaming'); fillBot(el, msg, false); markLast(); saveNow();
    thread.scrollTop = thread.scrollHeight;
  }

  function send(text) {
    text = text.trim();
    if (gen || (!text && !pending.length && !pendingDocs.length)) return;
    if (imageMode && !text) { toast('Describe la imagen que quieres crear o editar'); return; }
    if (imageMode && pendingDocs.length) { toast('Quita los documentos para crear o editar una imagen'); return; }
    if (!text) text = pendingDocs.length ? 'Resume este documento.' : pending.some(function (p) { return p.scan; }) ? 'Lee y resume el contenido de estas páginas.' : 'Describe esta imagen.';
    var chat = current();
    if (!chat) {
      chat = { id: uid(), title: text.length > 34 ? text.slice(0, 34) + '…' : text, messages: [] };
      state.chats.unshift(chat);
      if (state.chats.length > MAX_CHATS) { state.chats.splice(MAX_CHATS).forEach(function (old) { imgDel(chatImageIds(old)); }); }
      state.currentId = chat.id; app.dataset.mode = 'chat'; inner.innerHTML = '';
    }
    var umsg = { role: 'user', text: text };
    if (pending.length) {
      umsg.images = pending.map(function (p) { imgPut(p.id, p.blob); return { id: p.id, mime: p.mime, name: p.name }; });
    }
    if (pendingDocs.length) {
      umsg.docs = pendingDocs.map(function (d) {
        imgPut(d.id, new Blob([d.text], { type: 'text/plain;charset=utf-8' }));
        if (d.original) imgPut(d.id + ':orig', d.original);
        return { id: d.id, name: d.name, kind: d.kind, chars: d.chars, detail: d.detail, orig: !!d.original };
      });
    }
    chat.messages.push(umsg);
    inner.appendChild(msgEl(umsg));
    var asImage = imageMode;
    clearPending(); setImageMode(false);   // el modo imagen se usa una vez, para evitar gastos por descuido
    input.value = ''; grow(); clearDraft(); renderList(); saveNow();
    thread.scrollTop = thread.scrollHeight;
    if (asImage) respondImage(chat); else respond(chat);
  }

  /* =====================================================================
   * Borrador del mensaje (recuperación de sesión)
   * ===================================================================== */
  var draftTimer = null;
  function saveDraft() { clearTimeout(draftTimer); draftTimer = setTimeout(function () { try { if (input.value) localStorage.setItem(DRAFT, input.value); else localStorage.removeItem(DRAFT); } catch (e) {} }, 300); }
  function clearDraft() { try { localStorage.removeItem(DRAFT); } catch (e) {} }

  /* =====================================================================
   * Eventos de la interfaz
   * ===================================================================== */
  function grow() {
    input.style.height = 'auto'; input.style.height = Math.min(input.scrollHeight, 200) + 'px';
    if (!gen) sendBtn.disabled = !canSend();
  }
  input.addEventListener('input', function () { grow(); saveDraft(); });
  input.addEventListener('keydown', function (e) {
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); if (!gen) send(input.value); }
  });
  form.addEventListener('submit', function (e) { e.preventDefault(); if (gen) stopGen(); else send(input.value); });
  form.addEventListener('click', function (e) { if (e.target === form) input.focus(); });

  $('chips').addEventListener('click', function (e) {
    var b = e.target.closest('.chip'); if (!b) return;
    input.value = b.textContent + ': '; grow(); input.focus();
  });

  function copyText(text, btn, restore) {
    var ok = function () { var old = btn.innerHTML; if (restore) { btn.innerHTML = restore.done; setTimeout(function () { btn.innerHTML = old; }, 1400); } else toast('Copiado'); };
    var fallback = function () {
      try {
        var ta = document.createElement('textarea'); ta.value = text; ta.setAttribute('readonly', ''); ta.style.position = 'fixed'; ta.style.opacity = '0';
        document.body.appendChild(ta); ta.select(); var r = document.execCommand('copy'); ta.remove();
        if (r) ok(); else toast('No se pudo copiar');
      } catch (e) { toast('No se pudo copiar'); }
    };
    if (navigator.clipboard && window.isSecureContext) navigator.clipboard.writeText(text).then(ok, fallback); else fallback();
  }
  inner.addEventListener('click', function (e) {
    var b = e.target.closest('[data-act]'); if (!b) return;
    var act = b.dataset.act, el = b.closest('.msg'), chat = current(); if (!chat) return;
    if (act === 'copycode') {
      var pre = b.closest('.code').querySelector('pre');
      var prev = b.textContent;
      copyText(pre.textContent, b, null);
      b.textContent = 'Copiado'; setTimeout(function () { b.textContent = prev; }, 1400);
      return;
    }
    var idx = Array.prototype.indexOf.call(inner.children, el), m = chat.messages[idx];
    if (!m) return;
    if (act === 'copy') copyText(m.text, b, { done: icon('check') });
    else if (act === 'export') { e.stopPropagation(); openExportMenu(idx, b); }
    else if (act === 'applyedits') applyEditsFrom(m, b.dataset.doc);
    else if (act === 'dl' && m.images && m.images[0]) downloadImage(m.images[0]);
    else if (act === 'edit' && m.images && m.images[0]) editFromImage(m.images[0]);
    else if (act === 'redo' && !gen) {
      chat.messages.splice(idx, 1); el.remove();
      if (m.kind === 'image') { if (m.images) imgDel(m.images.map(function (i) { return i.id; })); respondImage(chat); } else respond(chat);
    }
  });
  inner.addEventListener('click', function (e) {
    var im = e.target.closest('img[data-img-id]'); if (im && im.src) openLightbox(im.getAttribute('data-img-id'));
  });

  /* Descargar la respuesta como archivo (Word, PDF, Excel, PowerPoint, Markdown) */
  function saveBlob(blob, name) {
    var a = document.createElement('a'), u = URL.createObjectURL(blob);
    a.href = u; a.download = name; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(u); }, 4000);
  }
  var exportMenu = $('exportMenu'), exportIdx = -1, exportBtn = null, apaOn = false, exporting = false;
  try { apaOn = localStorage.getItem('asistente.apa') === '1'; } catch (e) {}
  function paintApa() { var b = exportMenu.querySelector('[data-apa]'); b.setAttribute('aria-checked', String(apaOn)); b.querySelector('svg').classList.toggle('off', !apaOn); }
  function closeExportMenu() { exportMenu.hidden = true; if (exportBtn) exportBtn.setAttribute('aria-expanded', 'false'); exportBtn = null; exportIdx = -1; }
  function openExportMenu(idx, btn) {
    if (exportBtn === btn) { closeExportMenu(); return; }
    closeExportMenu(); closeChatMenu(); togglePop(false); toggleTools(false);
    exportIdx = idx; exportBtn = btn; btn.setAttribute('aria-expanded', 'true'); paintApa();
    exportMenu.hidden = false;
    var r = btn.getBoundingClientRect(), h = exportMenu.offsetHeight, w = exportMenu.offsetWidth;
    exportMenu.style.top = (r.top - h - 6 >= 8 ? r.top - h - 6 : Math.min(r.bottom + 6, window.innerHeight - h - 8)) + 'px';
    exportMenu.style.left = Math.max(8, Math.min(r.left, window.innerWidth - w - 8)) + 'px';
    exportMenu.querySelector('button').focus();
  }
  exportMenu.addEventListener('click', function (e) {
    var b = e.target.closest('button'); if (!b) return;
    if (b.hasAttribute('data-apa')) { apaOn = !apaOn; try { localStorage.setItem('asistente.apa', apaOn ? '1' : '0'); } catch (x) {} paintApa(); return; }
    var fmt = b.dataset.fmt; if (!fmt) return;
    var chat = current(), m = chat && chat.messages[exportIdx]; closeExportMenu();
    if (m) doExport(fmt, m.text);
  });
  function doExport(fmt, md) {
    if (exporting) return; exporting = true; toast('Generando archivo…');
    var p = window.Exporter ? Exporter.build(fmt, md, { apa: apaOn && (fmt === 'docx' || fmt === 'pdf') }) : Promise.reject(new Error('lib'));
    p.then(function (r) { saveBlob(r.blob, r.filename); toast('Descargado: ' + r.filename); })
      .catch(function (e) {
        toast(e && e.code === 'NO_TABLES' ? 'Esta respuesta no tiene tablas para pasar a Excel. Pídele al asistente que organice los datos en una tabla.'
          : e && e.code === 'EMPTY' ? 'No hay contenido para armar la presentación.'
          : e && e.message === 'lib' ? 'No se pudo cargar el generador de archivos (¿sin conexión?).' : 'No se pudo generar el archivo.');
      }).then(function () { exporting = false; });
  }
  /* Aplicar los cambios propuestos por el asistente a un Word adjunto, conservando su formato */
  function applyEditsFrom(m, docName) {
    var chat = current(), re = /```edits\s*\n([\s\S]*?)```/g, mm, ed = null, last = null;
    while ((mm = re.exec(m.text))) { var cand = Exporter.parseEdits(mm[1]); if (cand) last = cand; }
    ed = last;
    if (!ed) { toast('No se pudieron leer los cambios propuestos'); return; }
    var want = String(docName || ed.doc || '').toLowerCase(), target = null;
    for (var k = chat.messages.indexOf(m); k >= 0 && !(target && target.name.toLowerCase() === want); k--) {
      var um = chat.messages[k]; if (um.role !== 'user' || !um.docs) continue;
      um.docs.forEach(function (d) { if (d.kind === 'docx' && d.orig && (!target || d.name.toLowerCase() === want)) target = d; });
    }
    if (!target) { toast('No encuentro el documento Word original en esta conversación'); return; }
    toast('Aplicando cambios…');
    imgGet(target.id + ':orig').then(function (blob) {
      if (!blob) { toast('El documento original ya no está disponible en este dispositivo'); return null; }
      return Exporter.applyDocxEdits(blob, ed.edits);
    }).then(function (r) {
      if (!r) return;
      saveBlob(r.blob, target.name.replace(/\.docx$/i, '') + '-editado.docx');
      toast(r.changed + (r.changed === 1 ? ' párrafo modificado' : ' párrafos modificados') + (r.skipped.length ? ' · ' + r.skipped.length + ' no se pudieron aplicar' : ''));
    }).catch(function () { toast('No se pudo editar el documento'); });
  }

  var EXT = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp' };
  function downloadImage(img) {
    imgGet(img.id).then(function (blob) {
      if (!blob) { toast('La imagen ya no está disponible en este dispositivo'); return; }
      var a = document.createElement('a'), u = URL.createObjectURL(blob), t = new Date();
      var stamp = t.getFullYear() + ('0' + (t.getMonth() + 1)).slice(-2) + ('0' + t.getDate()).slice(-2) + '-' + ('0' + t.getHours()).slice(-2) + ('0' + t.getMinutes()).slice(-2) + ('0' + t.getSeconds()).slice(-2);
      a.href = u; a.download = 'imagen-' + stamp + '.' + (EXT[blob.type] || 'png');
      document.body.appendChild(a); a.click(); a.remove(); setTimeout(function () { URL.revokeObjectURL(u); }, 4000);
    });
  }
  function editFromImage(img) {
    if (pending.length >= MAX_ATTACH) { toast('Máximo ' + MAX_ATTACH + ' imágenes por mensaje'); return; }
    imgGet(img.id).then(function (blob) {
      if (!blob) { toast('La imagen ya no está disponible en este dispositivo'); return; }
      pending.push({ id: uid(), blob: blob, mime: blob.type, name: 'imagen.' + (EXT[blob.type] || 'png'), url: URL.createObjectURL(blob) });
      renderAttach(); if (caps.imageGen) setImageMode(true); else grow();
      input.focus(); toast(caps.imageGen ? 'Describe qué quieres cambiar' : 'Imagen añadida: pregunta lo que quieras sobre ella');
    });
  }

  /* Visor de imágenes */
  var lb = $('lightbox'), lbId = null;
  function openLightbox(id) {
    imgUrl(id).then(function (u) { if (!u) return; lbId = id; $('lbImg').src = u; lb.hidden = false; $('lbClose').focus(); });
  }
  function closeLightbox() { lb.hidden = true; lbId = null; $('lbImg').removeAttribute('src'); }
  $('lbClose').onclick = closeLightbox;
  $('lbDl').onclick = function () { if (lbId) downloadImage({ id: lbId }); };
  lb.addEventListener('click', function (e) { if (e.target === lb) closeLightbox(); });

  /* Adjuntar: botón, arrastrar y soltar, pegar */
  $('attachBtn').onclick = function () { $('fileInput').click(); };
  $('fileInput').addEventListener('change', function (e) { addFiles(e.target.files); e.target.value = ''; });
  var dz = $('dropzone'), dragDepth = 0;
  function hasFiles(e) { return e.dataTransfer && Array.prototype.indexOf.call(e.dataTransfer.types || [], 'Files') >= 0; }
  window.addEventListener('dragenter', function (e) { if (!hasFiles(e)) return; e.preventDefault(); dragDepth++; dz.hidden = false; });
  window.addEventListener('dragover', function (e) { if (hasFiles(e)) e.preventDefault(); });
  window.addEventListener('dragleave', function (e) { if (!hasFiles(e)) return; dragDepth = Math.max(0, dragDepth - 1); if (!dragDepth) dz.hidden = true; });
  window.addEventListener('drop', function (e) { if (!hasFiles(e)) return; e.preventDefault(); dragDepth = 0; dz.hidden = true; addFiles(e.dataTransfer.files); });
  document.addEventListener('paste', function (e) {
    var files = [], items = (e.clipboardData && e.clipboardData.items) || [];
    for (var i = 0; i < items.length; i++) if (items[i].kind === 'file' && /^image\//.test(items[i].type)) { var f = items[i].getAsFile(); if (f) files.push(f); }
    if (files.length) { e.preventDefault(); addFiles(files); }
  });

  /* Herramientas: crear o editar imagen */
  var toolsMenu = $('toolsMenu'), toolsBtn = $('toolsBtn');
  function toggleTools(v) { toolsMenu.hidden = !v; toolsBtn.setAttribute('aria-expanded', String(v)); }
  toolsBtn.onclick = function (e) { e.stopPropagation(); togglePop(false); closeChatMenu(); toggleTools(toolsMenu.hidden); };
  toolsMenu.addEventListener('click', function (e) {
    var b = e.target.closest('[data-tool]'); if (!b) return;
    toggleTools(false); setImageMode(true); input.focus();
  });
  $('modeChip').onclick = function () { setImageMode(false); input.focus(); };
  document.addEventListener('click', function () { toggleTools(false); });
  fetch('/api/health').then(function (r) { return r.json(); }).then(function (h) {
    caps.imageGen = !!h.imageGen; toolsBtn.hidden = !caps.imageGen;
  }).catch(function () { /* sin conexión: las herramientas se muestran al volver */ });

  $('newChat').onclick = function () { stopGen(); closeChatMenu(); input.value = ''; clearDraft(); grow(); openChat(null); if (isMobile()) setSide(false); };
  $('searchBtn').onclick = function () {
    var w = $('searchWrap'); w.hidden = !w.hidden;
    if (!w.hidden) $('searchInput').focus(); else { $('searchInput').value = ''; renderList(); }
  };
  $('searchInput').addEventListener('input', renderList);

  /* Sidebar */
  function isMobile() { return matchMedia('(max-width: 768px)').matches; }
  function setSide(open) { app.dataset.side = open ? 'open' : 'closed'; }
  $('closeSide').onclick = function () { setSide(false); };
  $('openSide').onclick = function () { setSide(true); };
  $('scrim').onclick = function () { setSide(false); };
  if (isMobile()) setSide(false);

  /* Selector de modelo (cada opción usa un modelo distinto en el servidor) */
  var pop = $('modelPop'), mbtn = $('modelBtn');
  var MODEL_LABEL = { fast: 'Asistente', pro: 'Asistente Pro' };
  function togglePop(v) { pop.hidden = !v; mbtn.setAttribute('aria-expanded', String(v)); }
  function paintModel() {
    $('modelName').textContent = MODEL_LABEL[state.model];
    pop.querySelectorAll('[data-model]').forEach(function (x) {
      var on = x.dataset.model === state.model; x.setAttribute('aria-checked', on);
      x.querySelector('svg').classList.toggle('off', !on);
    });
  }
  mbtn.onclick = function (e) { e.stopPropagation(); closeChatMenu(); togglePop(pop.hidden); };
  pop.addEventListener('click', function (e) {
    var b = e.target.closest('[data-model]'); if (!b) return;
    state.model = b.dataset.model; paintModel(); saveNow(); togglePop(false);
  });
  document.addEventListener('click', function (e) { togglePop(false); if (!chatMenu.contains(e.target)) closeChatMenu(); if (!exportMenu.contains(e.target)) closeExportMenu(); });
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') { if (!lb.hidden) { closeLightbox(); return; } togglePop(false); closeChatMenu(); closeExportMenu(); toggleTools(false); if (isMobile()) setSide(false); }
  });
  window.addEventListener('resize', closeChatMenu);
  list.addEventListener('scroll', closeChatMenu);

  /* Tema */
  function setTheme(t) {
    document.documentElement.setAttribute('data-theme', t);
    try { localStorage.setItem('theme', t); } catch (e) {}
    $('themeIc').innerHTML = IC[t === 'dark' ? 'sun' : 'moon'];
    $('themeBtn').setAttribute('aria-label', t === 'dark' ? 'Cambiar a tema claro' : 'Cambiar a tema oscuro');
  }
  $('themeBtn').onclick = function () { setTheme(document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark'); };
  setTheme(document.documentElement.getAttribute('data-theme'));

  /* Aviso */
  var tt;
  function toast(msg) {
    var t = $('toast'); t.textContent = msg; t.classList.add('on');
    clearTimeout(tt); tt = setTimeout(function () { t.classList.remove('on'); }, 2400);
  }
  window.addEventListener('offline', function () { toast('Sin conexión a internet'); });
  window.addEventListener('online', function () { toast('Conexión restablecida'); });

  /* =====================================================================
   * Dictado por voz (Web Speech API; solo si el navegador lo ofrece)
   * ===================================================================== */
  var SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  var micBtn = $('micBtn'), rec = null;
  if (SR) {
    micBtn.hidden = false;
    micBtn.onclick = function () {
      if (rec) { rec.stop(); return; }
      rec = new SR(); rec.lang = navigator.language || 'es-ES'; rec.interimResults = true; rec.continuous = true;
      var base = input.value;
      rec.onresult = function (ev) {
        var t = ''; for (var k = 0; k < ev.results.length; k++) t += ev.results[k][0].transcript;
        input.value = base + (base && !/\s$/.test(base) ? ' ' : '') + t; grow(); saveDraft();
      };
      rec.onerror = function (ev) {
        var map = { 'not-allowed': 'Permiso de micrófono denegado', 'service-not-allowed': 'El dictado no está permitido en este navegador', 'no-speech': 'No se detectó voz', 'network': 'El dictado necesita conexión a internet', 'audio-capture': 'No se encontró micrófono' };
        if (ev.error !== 'aborted') toast(map[ev.error] || 'Error de dictado');
      };
      rec.onend = function () { rec = null; micBtn.classList.remove('rec'); micBtn.setAttribute('aria-pressed', 'false'); input.focus(); };
      try { rec.start(); micBtn.classList.add('rec'); micBtn.setAttribute('aria-pressed', 'true'); }
      catch (e) { rec = null; toast('No se pudo iniciar el dictado'); }
    };
  }

  /* =====================================================================
   * PWA: service worker, actualizaciones e instalación
   * ===================================================================== */
  if ('serviceWorker' in navigator && location.protocol !== 'file:') {
    var reloading = false, hadController = !!navigator.serviceWorker.controller;
    // Recarga solo al actualizar una versión ya instalada; en la primera visita el worker toma el control sin recargar.
    navigator.serviceWorker.addEventListener('controllerchange', function () {
      if (!hadController) { hadController = true; return; }
      if (!reloading) { reloading = true; location.reload(); }
    });
    navigator.serviceWorker.register('/sw.js').then(function (reg) {
      function offer(worker) {
        var bar = $('updateBar'); bar.classList.add('on');
        $('updateBtn').onclick = function () { worker.postMessage({ type: 'SKIP_WAITING' }); };
      }
      if (reg.waiting && navigator.serviceWorker.controller) offer(reg.waiting);
      reg.addEventListener('updatefound', function () {
        var w = reg.installing; if (!w) return;
        w.addEventListener('statechange', function () { if (w.state === 'installed' && navigator.serviceWorker.controller) offer(w); });
      });
      document.addEventListener('visibilitychange', function () { if (document.visibilityState === 'visible') reg.update().catch(function () {}); });
    }).catch(function () { /* sin service worker: la app sigue funcionando */ });
  }
  var deferredInstall = null, installBtn = $('installBtn');
  window.addEventListener('beforeinstallprompt', function (e) { e.preventDefault(); deferredInstall = e; installBtn.hidden = false; });
  installBtn.onclick = function () {
    if (!deferredInstall) return;
    deferredInstall.prompt();
    deferredInstall.userChoice.finally(function () { deferredInstall = null; installBtn.hidden = true; });
  };
  window.addEventListener('appinstalled', function () { installBtn.hidden = true; });

  /* =====================================================================
   * Arranque
   * ===================================================================== */
  load();
  paintModel();
  if (state.currentId && !current()) state.currentId = null;
  app.dataset.mode = state.currentId ? 'chat' : 'home';
  renderThread(); renderList(); setBusy(false);
  try { var d = localStorage.getItem(DRAFT); if (d) { input.value = d; grow(); } } catch (e) {}
  if (!isMobile()) input.focus();
  saveNow();

  // Gancho para pruebas automáticas
  window.__app = { state: state };
})();
