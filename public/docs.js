/* Lectura de documentos en el navegador (nada se sube al servidor para leerlos):
 * DOCX, PPTX, XLSX, CSV/TXT/MD y PDF (con modo visual para PDF escaneados).
 * Las librerías pesadas se cargan solo cuando hacen falta. */
(function () {
  'use strict';

  var MAX_CHARS = 120000;      // debe coincidir con MAX_DOC_CHARS del servidor
  var MAX_FILE_BYTES = 25 * 1024 * 1024;
  var MAX_PDF_PAGES = 80;
  var SCAN_PAGES = 4;          // páginas que se envían como imágenes en un PDF escaneado
  var W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
  var A = 'http://schemas.openxmlformats.org/drawingml/2006/main';
  var DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

  /* ---------- carga perezosa de librerías ---------- */
  var scripts = {}, LIBS = {
    jszip: '/vendor/jszip/jszip.min.js', exceljs: '/vendor/exceljs/exceljs.min.js',
    pdflib: '/vendor/pdf-lib/pdf-lib.min.js', pptx: '/vendor/pptxgenjs/pptxgen.bundle.js'
  };
  function lib(name) {
    if (!scripts[name]) scripts[name] = new Promise(function (res, rej) {
      var s = document.createElement('script'); s.src = LIBS[name];
      s.onload = res; s.onerror = function () { delete scripts[name]; rej(new Error('lib')); };
      document.head.appendChild(s);
    });
    return scripts[name];
  }
  var pdfjsP = null;
  function pdfjs() {
    if (!pdfjsP) pdfjsP = import('/vendor/pdfjs/pdf.min.mjs').then(function (m) {
      m.GlobalWorkerOptions.workerSrc = '/vendor/pdfjs/pdf.worker.min.mjs'; return m;
    }).catch(function (e) { pdfjsP = null; throw e; });
    return pdfjsP;
  }

  function fail(code, extra) { var e = new Error(code); e.code = code; if (extra) Object.assign(e, extra); return e; }
  function extOf(name) { var m = /\.([a-z0-9]+)$/i.exec(name || ''); return m ? m[1].toLowerCase() : ''; }
  function parseXml(str) {
    var d = new DOMParser().parseFromString(str, 'application/xml');
    if (d.getElementsByTagName('parsererror').length) throw fail('corrupto');
    return d;
  }
  function clip(text) {
    if (text.length <= MAX_CHARS) return { text: text, truncated: false };
    return { text: text.slice(0, MAX_CHARS - 120) + '\n[... el documento continúa; se muestra solo el principio por su extensión ...]', truncated: true };
  }

  /* ---------- DOCX: párrafos numerados (también los usa el editor) ---------- */
  function ancestorIs(node, local, stopAt) {
    for (var n = node.parentNode; n && n !== stopAt; n = n.parentNode) if (n.localName === local) return true;
    return false;
  }
  function nearestP(n) { for (var x = n.parentNode; x; x = x.parentNode) if (x.localName === 'p' && x.namespaceURI === W) return x; return null; }
  function paragraphText(p) {
    var out = '', nodes = p.getElementsByTagNameNS(W, '*');
    for (var i = 0; i < nodes.length; i++) {
      var n = nodes[i], l = n.localName;
      if (l !== 't' && l !== 'tab' && l !== 'br' && l !== 'cr') continue;
      if (nearestP(n) !== p || ancestorIs(n, 'Fallback', p)) continue;   // sin duplicar cuadros de texto
      out += l === 't' ? n.textContent : l === 'tab' ? '\t' : '\n';
    }
    return out;
  }
  /** Párrafos con texto, en orden del documento. El índice (1-based) es el «[P12]» que ve el modelo. */
  function docxParagraphs(doc) {
    var all = doc.getElementsByTagNameNS(W, 'p'), out = [];
    for (var i = 0; i < all.length; i++) {
      if (ancestorIs(all[i], 'Fallback', null)) continue;
      var text = paragraphText(all[i]);
      if (text.trim()) out.push({ el: all[i], text: text, inTable: ancestorIs(all[i], 'tc', null) });
    }
    return out;
  }
  function loadDocxXml(buf) {
    return lib('jszip').then(function () { return JSZip.loadAsync(buf); }).then(function (zip) {
      var f = zip.file('word/document.xml');
      if (!f) throw fail('corrupto');
      return f.async('string').then(function (xml) { return { zip: zip, doc: parseXml(xml) }; });
    });
  }
  function readDocx(file, buf) {
    return loadDocxXml(buf).then(function (r) {
      var paras = docxParagraphs(r.doc);
      if (!paras.length) throw fail('vacio');
      var text = paras.map(function (p, i) { return '[P' + (i + 1) + '] ' + (p.inTable ? '(tabla) ' : '') + p.text.replace(/\n/g, ' '); }).join('\n');
      return { text: text, detail: paras.length + ' párrafos', original: file };
    });
  }

  /* ---------- PPTX ---------- */
  function readPptx(file, buf) {
    return lib('jszip').then(function () { return JSZip.loadAsync(buf); }).then(function (zip) {
      var names = Object.keys(zip.files).filter(function (n) { return /^ppt\/slides\/slide\d+\.xml$/.test(n); })
        .sort(function (a, b) { return parseInt(a.match(/(\d+)\.xml/)[1], 10) - parseInt(b.match(/(\d+)\.xml/)[1], 10); });
      if (!names.length) throw fail('corrupto');
      return Promise.all(names.map(function (n, i) {
        var notesName = n.replace('slides/slide', 'notesSlides/notesSlide');
        return Promise.all([zip.file(n).async('string'), zip.file(notesName) ? zip.file(notesName).async('string') : Promise.resolve('')]).then(function (xs) {
          var lines = function (xml) {
            if (!xml) return [];
            var d = parseXml(xml), ps = d.getElementsByTagNameNS(A, 'p'), out = [];
            for (var k = 0; k < ps.length; k++) {
              var ts = ps[k].getElementsByTagNameNS(A, 't'), s = '';
              for (var j = 0; j < ts.length; j++) s += ts[j].textContent;
              if (s.trim()) out.push(s.trim());
            }
            return out;
          };
          var body = lines(xs[0]), notes = lines(xs[1]).filter(function (l) { return !/^\d+$/.test(l); });
          return '## Diapositiva ' + (i + 1) + '\n' + (body.join('\n') || '(sin texto)') + (notes.length ? '\nNotas del orador: ' + notes.join(' ') : '');
        });
      })).then(function (parts) { return { text: parts.join('\n\n'), detail: names.length + ' diapositivas' }; });
    });
  }

  /* ---------- XLSX / CSV ---------- */
  function csvCell(v) {
    if (v === null || v === undefined) return '';
    if (v instanceof Date) v = v.toISOString().slice(0, 10);
    else if (typeof v === 'object') {
      if (v.richText) v = v.richText.map(function (r) { return r.text; }).join('');
      else if (v.formula !== undefined || v.sharedFormula !== undefined || v.result !== undefined) {   // fórmula: su valor; si no hay, la propia fórmula
        var res = v.result;
        v = res === undefined ? '=' + (v.formula || '') : res instanceof Date ? res.toISOString().slice(0, 10) : (res && res.error ? res.error : res);
      }
      else if (v.text !== undefined) v = v.text;
      else if (v.error) v = v.error;
      else v = String(v);
    }
    v = String(v);
    return /[",\n\r]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v;
  }
  function readXlsx(file, buf) {
    return lib('exceljs').then(function () {
      var wb = new ExcelJS.Workbook();
      return wb.xlsx.load(buf).then(function () {
        var parts = [], sheets = 0, budget = MAX_CHARS, omitted = 0;
        wb.eachSheet(function (ws) {
          sheets++;
          var rows = ws.actualRowCount, cols = ws.actualColumnCount, head = '## Hoja «' + ws.name + '» (' + rows + ' filas × ' + cols + ' columnas)';
          var lines = [];
          ws.eachRow({ includeEmpty: false }, function (row) {
            var vals = []; for (var c = 1; c <= cols; c++) vals.push(csvCell(row.getCell(c).value));
            var line = vals.join(',');
            if (budget - line.length - 1 < 0) { omitted++; return; }
            budget -= line.length + 1; lines.push(line);
          });
          parts.push(head + '\n' + lines.join('\n'));
        });
        if (!sheets) throw fail('vacio');
        var text = parts.join('\n\n') + (omitted ? '\n[... se omitieron ' + omitted + ' filas por la extensión ...]' : '');
        return { text: text, detail: sheets + (sheets === 1 ? ' hoja' : ' hojas'), truncatedAlready: omitted > 0 };
      });
    });
  }

  /* ---------- PDF ---------- */
  function pageLines(items) {
    var out = '', prev = null;
    items.forEach(function (it) {
      if (!it.str && !it.hasEOL) return;
      if (prev && !/\s$/.test(out) && !/^\s/.test(it.str)) {
        var gap = it.transform[4] - (prev.transform[4] + prev.width), size = Math.abs(it.transform[0]) || 10;
        if (Math.abs(it.transform[5] - prev.transform[5]) > size * 0.5 || gap > size * 0.15) out += ' ';   // otra línea, o hueco entre palabras
      }
      out += it.str + (it.hasEOL ? '\n' : ''); prev = it;
    });
    return out.replace(/[ \t]{2,}/g, ' ').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
  }
  function renderPage(page, maxSide) {
    var vp0 = page.getViewport({ scale: 1 }), scale = Math.min(2, maxSide / Math.max(vp0.width, vp0.height));
    var vp = page.getViewport({ scale: scale }), c = document.createElement('canvas');
    c.width = Math.round(vp.width); c.height = Math.round(vp.height);
    var ctx = c.getContext('2d'); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height);
    return page.render({ canvasContext: ctx, viewport: vp }).promise.then(function () {
      return new Promise(function (res) { c.toBlob(res, 'image/jpeg', 0.85); });
    });
  }
  function readPdf(file, buf) {
    return pdfjs().then(function (pdfjsLib) {
      return pdfjsLib.getDocument({ data: new Uint8Array(buf), isEvalSupported: false, useSystemFonts: false }).promise.catch(function (e) {
        if (e && e.name === 'PasswordException') throw fail('clave');
        throw fail('corrupto');
      }).then(function (pdf) {
        var n = Math.min(pdf.numPages, MAX_PDF_PAGES), texts = [], chain = Promise.resolve();
        for (var i = 1; i <= n; i++) (function (num) {
          chain = chain.then(function () { return pdf.getPage(num); }).then(function (pg) { return pg.getTextContent(); })
            .then(function (tc) { texts.push(pageLines(tc.items)); });
        })(i);
        return chain.then(function () {
          var chars = texts.join('').replace(/\s/g, '').length;
          var detail = pdf.numPages + (pdf.numPages === 1 ? ' página' : ' páginas') + (pdf.numPages > n ? ' (se leyeron ' + n + ')' : '');
          if (chars < 30 * n) {   // casi sin texto: es un escaneo → se envían páginas como imágenes para OCR con visión
            var pages = Math.min(SCAN_PAGES, pdf.numPages), imgs = [], c2 = Promise.resolve();
            for (var k = 1; k <= pages; k++) (function (num) {
              c2 = c2.then(function () { return pdf.getPage(num); }).then(function (pg) { return renderPage(pg, 1600); })
                .then(function (blob) { imgs.push({ blob: blob, mime: 'image/jpeg', name: file.name.replace(/\.pdf$/i, '') + ' (pág. ' + num + ').jpg' }); });
            })(k);
            return c2.then(function () { return { text: '', detail: detail, scanned: true, images: imgs, totalPages: pdf.numPages }; });
          }
          var text = texts.map(function (t, i) { return '--- Página ' + (i + 1) + ' ---\n' + t; }).join('\n\n');
          return { text: text, detail: detail };
        });
      });
    });
  }

  /* ---------- texto plano / CSV ---------- */
  function readText(file) {
    return file.text().then(function (t) {
      t = t.replace(/\u0000/g, '');
      if (!t.trim()) throw fail('vacio');
      var ext = extOf(file.name);
      var detail = (ext === 'csv' || ext === 'tsv') ? (t.split(/\r?\n/).filter(Boolean).length + ' filas') : (t.length + ' caracteres');
      return { text: t, detail: detail };
    });
  }

  var TEXT_EXT = { txt: 1, md: 1, csv: 1, tsv: 1, json: 1 };
  var KIND = { docx: 'docx', pptx: 'pptx', xlsx: 'xlsx', pdf: 'pdf' };
  var LEGACY = { doc: 'Word antiguo (.doc)', xls: 'Excel antiguo (.xls)', ppt: 'PowerPoint antiguo (.ppt)' };

  /** ¿Es un tipo de documento que sabemos leer? */
  function isDocument(file) { var e = extOf(file.name); return !!(KIND[e] || TEXT_EXT[e] || LEGACY[e]); }

  function readDocument(file) {
    var ext = extOf(file.name);
    if (LEGACY[ext]) return Promise.reject(fail('antiguo', { legacy: LEGACY[ext] }));
    if (file.size > MAX_FILE_BYTES) return Promise.reject(fail('grande'));
    var kind = KIND[ext] || 'texto';
    var p = kind === 'texto' ? readText(file) : file.arrayBuffer().then(function (buf) {
      return kind === 'docx' ? readDocx(file, buf) : kind === 'pptx' ? readPptx(file, buf) : kind === 'xlsx' ? readXlsx(file, buf) : readPdf(file, buf);
    });
    return p.then(function (r) {
      var c = clip(r.text || '');
      return { name: file.name, kind: kind, text: c.text, truncated: c.truncated || !!r.truncatedAlready, detail: r.detail,
        scanned: !!r.scanned, images: r.images || [], original: r.original || null, size: file.size };
    }, function (e) {
      if (e && e.code) throw e;
      if (e && e.message === 'lib') throw fail('lib');
      throw fail('corrupto');
    });
  }

  window.DocTools = {
    readDocument: readDocument, isDocument: isDocument, lib: lib, docxParagraphs: docxParagraphs,
    parseXml: parseXml, MAX_CHARS: MAX_CHARS, DOCX_MIME: DOCX_MIME, extOf: extOf
  };
})();
