/* Genera archivos descargables (DOCX, PDF, XLSX, PPTX) a partir del Markdown de una respuesta,
 * y aplica ediciones de texto a un DOCX existente conservando su formato.
 * Todo ocurre en el navegador. Depende de docs.js (carga perezosa de librerías). */
(function () {
  'use strict';
  var DT = window.DocTools;

  /* =====================================================================
   * LaTeX → texto legible (Word/PDF/Excel no renderizan LaTeX)
   * ===================================================================== */
  var GREEK = { alpha: 'α', beta: 'β', gamma: 'γ', delta: 'δ', epsilon: 'ε', varepsilon: 'ε', zeta: 'ζ', eta: 'η', theta: 'θ', lambda: 'λ', mu: 'μ', nu: 'ν', xi: 'ξ', pi: 'π', rho: 'ρ', sigma: 'σ', tau: 'τ', phi: 'φ', chi: 'χ', psi: 'ψ', omega: 'ω', Gamma: 'Γ', Delta: 'Δ', Theta: 'Θ', Lambda: 'Λ', Pi: 'Π', Sigma: 'Σ', Phi: 'Φ', Psi: 'Ψ', Omega: 'Ω' };
  var SYM = { pm: '±', mp: '∓', times: '×', cdot: '·', div: '÷', leq: '≤', le: '≤', geq: '≥', ge: '≥', neq: '≠', ne: '≠', approx: '≈', infty: '∞', rightarrow: '→', to: '→', leftarrow: '←', Rightarrow: '⇒', sum: 'Σ', prod: 'Π', int: '∫', partial: '∂', nabla: '∇', ldots: '…', dots: '…', in: '∈', subset: '⊂', cup: '∪', cap: '∩', forall: '∀', exists: '∃', circ: '°' };
  var SUP = { 0: '⁰', 1: '¹', 2: '²', 3: '³', 4: '⁴', 5: '⁵', 6: '⁶', 7: '⁷', 8: '⁸', 9: '⁹', '+': '⁺', '-': '⁻', n: 'ⁿ', i: 'ⁱ' };
  var SUB = { 0: '₀', 1: '₁', 2: '₂', 3: '₃', 4: '₄', 5: '₅', 6: '₆', 7: '₇', 8: '₈', 9: '₉', '+': '₊', '-': '₋' };
  function mapAll(x, table, fallback) {
    var out = ''; for (var i = 0; i < x.length; i++) { if (!table[x[i]]) return fallback(x); out += table[x[i]]; } return out;
  }
  function latexToText(s) {
    s = s.replace(/\\(?:left|right|bigl|bigr|big|Big)(?![A-Za-z])/g, '').replace(/\\[,;:! ]/g, ' ').replace(/\\\\/g, ' ');
    s = s.replace(/\\(?:text|textbf|textit|mathrm|mathbf|operatorname)\{([^{}]*)\}/g, '$1');
    for (var k = 0; k < 4; k++) {
      s = s.replace(/\\frac\{([^{}]*)\}\{([^{}]*)\}/g, function (m, a, b) { var w = function (t) { return /^[\w.]+$/.test(t) ? t : '(' + t + ')'; }; return w(a) + '/' + w(b); })
        .replace(/\\sqrt\[(\d+)\]\{([^{}]*)\}/g, '$1√($2)').replace(/\\sqrt\{([^{}]*)\}/g, '√($1)');
    }
    s = s.replace(/\\([A-Za-z]+)/g, function (m, n) { return GREEK[n] || SYM[n] || n; });
    s = s.replace(/\^\{([^{}]*)\}/g, function (m, x) { return mapAll(x, SUP, function (t) { return '^(' + t + ')'; }); })
      .replace(/\^([0-9a-zA-Z+-])/g, function (m, x) { return mapAll(x, SUP, function (t) { return '^' + t; }); });
    s = s.replace(/_\{([^{}]*)\}/g, function (m, x) { return mapAll(x, SUB, function (t) { return '_(' + t + ')'; }); })
      .replace(/_([0-9])/g, function (m, x) { return SUB[x]; });
    return s.replace(/[{}]/g, '').replace(/\s+/g, ' ').trim();
  }

  /* =====================================================================
   * Markdown → bloques
   * ===================================================================== */
  function assign(a, b) { var o = {}, k; for (k in a) o[k] = a[k]; for (k in b) o[k] = b[k]; return o; }
  function inlineRuns(src) {
    var runs = [];
    function push(text, st) { if (text) runs.push({ text: text, b: !!st.b, i: !!st.i, s: !!st.s, code: !!st.code, url: st.url || null }); }
    function walk(s, st) {
      var i = 0, buf = '', m;
      function flush() { push(buf, st); buf = ''; }
      while (i < s.length) {
        var rest = s.slice(i);
        if ((m = /^`([^`\n]+)`/.exec(rest))) { flush(); push(m[1], assign(st, { code: true })); i += m[0].length; continue; }
        if ((m = /^\[([^\]\n]+)\]\((https?:\/\/[^\s)]+|mailto:[^\s)]+)\)/.exec(rest))) { flush(); walk(m[1], assign(st, { url: m[2] })); i += m[0].length; continue; }
        if ((m = /^\*\*(?=\S)([\s\S]+?)(?<=\S)\*\*/.exec(rest))) { flush(); walk(m[1], assign(st, { b: true })); i += m[0].length; continue; }
        if ((m = /^~~(?=\S)([\s\S]+?)(?<=\S)~~/.exec(rest))) { flush(); walk(m[1], assign(st, { s: true })); i += m[0].length; continue; }
        if ((m = /^\*(?=[^\s*])([^*\n]+?)(?<=[^\s*])\*(?!\*)/.exec(rest))) { flush(); walk(m[1], assign(st, { i: true })); i += m[0].length; continue; }
        if ((m = /^\\\((.+?)\\\)/.exec(rest)) || ((m = /^\$(?!\s)([^$\n]+?)(?<!\s)\$(?![\w$])/.exec(rest)))) { flush(); push(latexToText(m[1]), assign(st, { i: true })); i += m[0].length; continue; }
        buf += s[i]; i++;
      }
      flush();
    }
    walk(src, {});
    return runs;
  }
  function plain(runs) { return runs.map(function (r) { return r.text; }).join(''); }

  function parseMd(md) {
    var lines = md.replace(/\r\n/g, '\n').split('\n'), blocks = [], i = 0, para = [];
    function flush() { if (para.length) { blocks.push({ t: 'p', runs: inlineRuns(para.join(' ')) }); para = []; } }
    var sepRe = /^\s*\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)*\|?\s*$/;
    var splitRow = function (l) { return l.trim().replace(/^\||\|$/g, '').split('|').map(function (c) { return c.trim(); }); };
    var listRe = /^(\s*)([-*+]|\d{1,3}[.)])\s+(.*)$/;
    while (i < lines.length) {
      var line = lines[i], m;
      if ((m = /^\s*```\s*([\w+#.-]*)/.exec(line))) {
        flush(); var code = []; i++;
        while (i < lines.length && !/^\s*```/.test(lines[i])) { code.push(lines[i]); i++; }
        i++; blocks.push({ t: 'code', lang: m[1], text: code.join('\n') }); continue;
      }
      if (!line.trim()) { flush(); i++; continue; }
      if (/^\s*\$\$\s*$/.test(line)) { flush(); var mt = []; i++; while (i < lines.length && !/^\s*\$\$\s*$/.test(lines[i])) { mt.push(lines[i]); i++; } i++; blocks.push({ t: 'math', text: latexToText(mt.join(' ')) }); continue; }
      if ((m = /^\s*\$\$(.+)\$\$\s*$/.exec(line)) || (m = /^\s*\\\[(.+)\\\]\s*$/.exec(line))) { flush(); blocks.push({ t: 'math', text: latexToText(m[1]) }); i++; continue; }
      if ((m = /^(#{1,6})\s+(.*?)\s*#*\s*$/.exec(line))) { flush(); blocks.push({ t: 'h', l: m[1].length, runs: inlineRuns(m[2]) }); i++; continue; }
      if (/^\s*([-*_])(\s*\1){2,}\s*$/.test(line)) { flush(); blocks.push({ t: 'hr' }); i++; continue; }
      if (/^>\s?/.test(line)) {
        flush(); var q = [];
        while (i < lines.length && /^>\s?/.test(lines[i])) { q.push(lines[i].replace(/^>\s?/, '')); i++; }
        blocks.push({ t: 'quote', runs: inlineRuns(q.join(' ')) }); continue;
      }
      if (line.indexOf('|') >= 0 && i + 1 < lines.length && sepRe.test(lines[i + 1]) && lines[i + 1].indexOf('-') >= 0) {
        flush();
        var head = splitRow(line).map(inlineRuns);
        var aligns = splitRow(lines[i + 1]).map(function (c) { return /^:-+:$/.test(c) ? 'center' : /-:$/.test(c) ? 'right' : 'left'; });
        i += 2; var rows = [];
        while (i < lines.length && lines[i].trim() && lines[i].indexOf('|') >= 0) { rows.push(splitRow(lines[i]).map(inlineRuns)); i++; }
        blocks.push({ t: 'table', head: head, rows: rows, aligns: aligns }); continue;
      }
      if (listRe.test(line)) {
        flush(); var items = [], ordered = /\d/.test(listRe.exec(line)[2]);
        while (i < lines.length && listRe.test(lines[i])) {
          var lm = listRe.exec(lines[i]);
          items.push({ level: Math.min(2, Math.floor(lm[1].replace(/\t/g, '    ').length / 2)), runs: inlineRuns(lm[3]) }); i++;
        }
        blocks.push({ t: 'list', ordered: ordered, items: items }); continue;
      }
      para.push(line.trim()); i++;
    }
    flush();
    return blocks;
  }
  /** Quita los bloques ```edits (son instrucciones para la app, no contenido). */
  function cleanMd(md) { return md.replace(/```edits[\s\S]*?(```|$)/g, '').trim(); }
  function firstTitle(blocks) { for (var i = 0; i < blocks.length; i++) if (blocks[i].t === 'h') return plain(blocks[i].runs); return ''; }
  function slug(s) { return (s || 'documento').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 50) || 'documento'; }
  var REFS_RE = /^(referencias|references|bibliograf[ií]a|referencias bibliogr[aá]ficas)$/i;

  /* =====================================================================
   * DOCX
   * ===================================================================== */
  var NS_W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
  var NS_R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
  function esc(s) { return String(s).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }

  function docxStyles(apa) {
    var font = apa ? 'Times New Roman' : 'Calibri', sz = apa ? 24 : 22;
    var line = apa ? '<w:spacing w:after="0" w:line="480" w:lineRule="auto"/>' : '<w:spacing w:after="160" w:line="276" w:lineRule="auto"/>';
    var head = function (id, name, size, extra, ppr) {
      return '<w:style w:type="paragraph" w:styleId="' + id + '"><w:name w:val="' + name + '"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/>' +
        '<w:pPr><w:keepNext/>' + (ppr || '') + '</w:pPr><w:rPr>' + (extra || '<w:b/>') + '<w:sz w:val="' + size + '"/></w:rPr></w:style>';
    };
    var spaceH = function (b, a) { return '<w:spacing w:before="' + b + '" w:after="' + a + '"/>'; };
    var heads = apa
      ? head('Title', 'Title', 24, '<w:b/>', '<w:jc w:val="center"/>') +
        head('Heading1', 'heading 1', 24, '<w:b/>', '<w:jc w:val="center"/>') +
        head('Heading2', 'heading 2', 24, '<w:b/>', '<w:jc w:val="left"/>') +
        head('Heading3', 'heading 3', 24, '<w:b/><w:i/>', '<w:jc w:val="left"/>') +
        head('Heading4', 'heading 4', 24, '<w:b/>', '<w:ind w:firstLine="720"/>') +
        head('Heading5', 'heading 5', 24, '<w:b/><w:i/>', '<w:ind w:firstLine="720"/>') +
        head('Heading6', 'heading 6', 24, '<w:i/>', '<w:ind w:firstLine="720"/>')
      : head('Title', 'Title', 44, '<w:b/>', spaceH(0, 240)) +
        head('Heading1', 'heading 1', 36, '<w:b/>', spaceH(360, 120)) + head('Heading2', 'heading 2', 30, '<w:b/>', spaceH(280, 100)) +
        head('Heading3', 'heading 3', 26, '<w:b/>', spaceH(240, 80)) + head('Heading4', 'heading 4', 24, '<w:b/>', spaceH(200, 60)) +
        head('Heading5', 'heading 5', 22, '<w:b/><w:i/>', spaceH(160, 60)) + head('Heading6', 'heading 6', 22, '<w:i/>', spaceH(160, 60));
    return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:styles xmlns:w="' + NS_W + '">' +
      '<w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="' + font + '" w:hAnsi="' + font + '" w:eastAsia="' + font + '" w:cs="' + font + '"/><w:sz w:val="' + sz + '"/><w:szCs w:val="' + sz + '"/><w:lang w:val="es-ES"/></w:rPr></w:rPrDefault>' +
      '<w:pPrDefault><w:pPr>' + line + '</w:pPr></w:pPrDefault></w:docDefaults>' +
      '<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:qFormat/></w:style>' + heads +
      '<w:style w:type="paragraph" w:styleId="Cuerpo"><w:name w:val="Cuerpo"/><w:basedOn w:val="Normal"/><w:qFormat/><w:pPr>' + (apa ? '<w:ind w:firstLine="720"/>' : '') + '</w:pPr></w:style>' +
      '<w:style w:type="paragraph" w:styleId="Referencia"><w:name w:val="Referencia"/><w:basedOn w:val="Normal"/><w:qFormat/><w:pPr><w:ind w:left="720" w:hanging="720"/></w:pPr></w:style>' +
      '<w:style w:type="paragraph" w:styleId="Lista"><w:name w:val="Lista"/><w:basedOn w:val="Normal"/><w:qFormat/><w:pPr><w:spacing w:after="' + (apa ? 0 : 60) + '"/></w:pPr></w:style>' +
      '<w:style w:type="paragraph" w:styleId="Codigo"><w:name w:val="Codigo"/><w:basedOn w:val="Normal"/><w:pPr><w:shd w:val="clear" w:color="auto" w:fill="F2F2F2"/><w:spacing w:before="0" w:after="0" w:line="240" w:lineRule="auto"/></w:pPr><w:rPr><w:rFonts w:ascii="Consolas" w:hAnsi="Consolas" w:cs="Consolas"/><w:sz w:val="19"/></w:rPr></w:style>' +
      '<w:style w:type="paragraph" w:styleId="Cita"><w:name w:val="Cita"/><w:basedOn w:val="Normal"/><w:pPr><w:ind w:left="720"/></w:pPr><w:rPr><w:i/><w:color w:val="595959"/></w:rPr></w:style>' +
      '<w:style w:type="paragraph" w:styleId="TextoTabla"><w:name w:val="TextoTabla"/><w:basedOn w:val="Normal"/><w:pPr><w:spacing w:before="40" w:after="40" w:line="240" w:lineRule="auto"/></w:pPr><w:rPr><w:sz w:val="' + (apa ? 22 : 20) + '"/></w:rPr></w:style>' +
      '<w:style w:type="paragraph" w:styleId="Header"><w:name w:val="header"/><w:basedOn w:val="Normal"/><w:pPr><w:spacing w:after="0" w:line="240" w:lineRule="auto"/></w:pPr></w:style>' +
      '<w:style w:type="paragraph" w:styleId="Footer"><w:name w:val="footer"/><w:basedOn w:val="Normal"/><w:pPr><w:spacing w:after="0" w:line="240" w:lineRule="auto"/></w:pPr></w:style>' +
      '<w:style w:type="character" w:styleId="Hyperlink"><w:name w:val="Hyperlink"/><w:rPr><w:color w:val="0563C1"/><w:u w:val="single"/></w:rPr></w:style>' +
      '</w:styles>';
  }

  function docxNumbering(orderedCount) {
    var lvl = function (i, fmt, text) {
      return '<w:lvl w:ilvl="' + i + '"><w:start w:val="1"/><w:numFmt w:val="' + fmt + '"/><w:lvlText w:val="' + text + '"/><w:lvlJc w:val="left"/><w:pPr><w:ind w:left="' + (720 * (i + 1)) + '" w:hanging="360"/></w:pPr></w:lvl>';
    };
    var bullets = ['•', '–', '▪'], out = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:numbering xmlns:w="' + NS_W + '">';
    out += '<w:abstractNum w:abstractNumId="0"><w:multiLevelType w:val="hybridMultilevel"/>' + [0, 1, 2].map(function (i) { return lvl(i, 'bullet', bullets[i]); }).join('') + '</w:abstractNum>';
    out += '<w:abstractNum w:abstractNumId="1"><w:multiLevelType w:val="hybridMultilevel"/>' + lvl(0, 'decimal', '%1.') + lvl(1, 'lowerLetter', '%2.') + lvl(2, 'lowerRoman', '%3.') + '</w:abstractNum>';
    out += '<w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num>';
    for (var k = 0; k < orderedCount; k++) out += '<w:num w:numId="' + (2 + k) + '"><w:abstractNumId w:val="1"/><w:lvlOverride w:ilvl="0"><w:startOverride w:val="1"/></w:lvlOverride></w:num>';
    return out + '</w:numbering>';
  }

  function toDocx(md, opts) {
    return DT.lib('jszip').then(function () {
      var apa = !!opts.apa, blocks = parseMd(cleanMd(md));
      var rels = [], relId = 10, orderedCount = 0, inRefs = false, firstH1 = true;
      var pageW = apa ? 12240 : 11906, pageH = apa ? 15840 : 16838, textW = pageW - 2880;

      function rXml(r, base) {
        var b = r.b || base.b, i = r.i || base.i, pr = '';
        if (r.url) pr += '<w:rStyle w:val="Hyperlink"/>';
        if (r.code) pr += '<w:rFonts w:ascii="Consolas" w:hAnsi="Consolas" w:cs="Consolas"/>';
        if (b) pr += '<w:b/>';
        if (i) pr += '<w:i/>';
        if (r.s) pr += '<w:strike/>';
        if (r.code) pr += '<w:sz w:val="20"/>';
        var run = '<w:r>' + (pr ? '<w:rPr>' + pr + '</w:rPr>' : '') + '<w:t xml:space="preserve">' + esc(r.text) + '</w:t></w:r>';
        if (!r.url) return run;
        var id = 'rId' + (relId++); rels.push({ id: id, url: r.url });
        return '<w:hyperlink r:id="' + id + '" w:history="1">' + run + '</w:hyperlink>';
      }
      function runs(rs, base) { return rs.map(function (r) { return rXml(r, base || {}); }).join(''); }
      function para(style, rs, ppr, base) {
        return '<w:p><w:pPr>' + (style ? '<w:pStyle w:val="' + style + '"/>' : '') + (ppr || '') + '</w:pPr>' + runs(rs, base) + '</w:p>';
      }
      function cell(rs, width, align, header) {
        return '<w:tc><w:tcPr><w:tcW w:w="' + width + '" w:type="dxa"/>' + (header ? '<w:shd w:val="clear" w:color="auto" w:fill="E7E6E6"/>' : '') + '</w:tcPr>' +
          '<w:p><w:pPr><w:pStyle w:val="TextoTabla"/><w:jc w:val="' + (align === 'right' ? 'right' : align === 'center' ? 'center' : 'left') + '"/></w:pPr>' + runs(rs, header ? { b: true } : {}) + '</w:p></w:tc>';
      }

      var body = '';
      blocks.forEach(function (b) {
        if (b.t === 'h') {
          var text = plain(b.runs), lvl = b.l, style, ppr = '';
          if (apa) {
            if (lvl === 1 && firstH1) { style = 'Title'; firstH1 = false; }
            else style = 'Heading' + Math.min(5, Math.max(1, lvl - 1));
            inRefs = REFS_RE.test(text.trim());
            if (inRefs) { style = 'Heading1'; ppr = '<w:pageBreakBefore/>'; }
          } else { style = lvl === 1 && firstH1 ? 'Title' : 'Heading' + Math.min(6, lvl); if (lvl === 1) firstH1 = false; inRefs = REFS_RE.test(text.trim()); }
          body += para(style, b.runs, ppr);
        } else if (b.t === 'p') {
          body += para(inRefs ? 'Referencia' : 'Cuerpo', b.runs);
        } else if (b.t === 'quote') {
          body += para('Cita', b.runs);
        } else if (b.t === 'math') {
          body += para('Cuerpo', [{ text: b.text, i: true }], '<w:jc w:val="center"/>');
        } else if (b.t === 'hr') {
          body += '<w:p><w:pPr><w:pBdr><w:bottom w:val="single" w:sz="6" w:space="1" w:color="808080"/></w:pBdr></w:pPr></w:p>';
        } else if (b.t === 'code') {
          (b.text.split('\n').length ? b.text.split('\n') : ['']).forEach(function (l) {
            body += '<w:p><w:pPr><w:pStyle w:val="Codigo"/></w:pPr><w:r><w:t xml:space="preserve">' + esc(l.replace(/\t/g, '    ')) + '</w:t></w:r></w:p>';
          });
          body += '<w:p><w:pPr><w:spacing w:after="0"/></w:pPr></w:p>';
        } else if (b.t === 'list') {
          var numId = 1; if (b.ordered) { numId = 2 + orderedCount; orderedCount++; }
          b.items.forEach(function (it) {
            body += para('Lista', it.runs, '<w:numPr><w:ilvl w:val="' + it.level + '"/><w:numId w:val="' + numId + '"/></w:numPr>');
          });
        } else if (b.t === 'table') {
          var n = Math.max(1, b.head.length), w = Math.floor(textW / n), bd = function (nm) { return '<w:' + nm + ' w:val="single" w:sz="4" w:space="0" w:color="808080"/>'; };
          body += '<w:tbl><w:tblPr><w:tblW w:w="' + textW + '" w:type="dxa"/><w:tblBorders>' + ['top', 'left', 'bottom', 'right', 'insideH', 'insideV'].map(bd).join('') + '</w:tblBorders><w:tblLayout w:type="fixed"/><w:tblCellMar><w:left w:w="100" w:type="dxa"/><w:right w:w="100" w:type="dxa"/></w:tblCellMar></w:tblPr><w:tblGrid>' +
            b.head.map(function () { return '<w:gridCol w:w="' + w + '"/>'; }).join('') + '</w:tblGrid>' +
            '<w:tr><w:trPr><w:tblHeader/></w:trPr>' + b.head.map(function (h, k) { return cell(h, w, b.aligns[k], true); }).join('') + '</w:tr>' +
            b.rows.map(function (r) { return '<w:tr>' + b.head.map(function (_, k) { return cell(r[k] || [], w, b.aligns[k], false); }).join('') + '</w:tr>'; }).join('') + '</w:tbl>' +
            '<w:p><w:pPr><w:spacing w:after="0"/></w:pPr></w:p>';
        }
      });
      if (!body) body = '<w:p/>';

      var hf = apa ? 'header' : 'footer';
      var field = '<w:r><w:fldChar w:fldCharType="begin"/></w:r><w:r><w:instrText xml:space="preserve"> PAGE </w:instrText></w:r><w:r><w:fldChar w:fldCharType="separate"/></w:r><w:r><w:t>1</w:t></w:r><w:r><w:fldChar w:fldCharType="end"/></w:r>';
      var hfXml = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:' + (apa ? 'hdr' : 'ftr') + ' xmlns:w="' + NS_W + '"><w:p><w:pPr><w:pStyle w:val="' + (apa ? 'Header' : 'Footer') + '"/><w:jc w:val="' + (apa ? 'right' : 'center') + '"/></w:pPr>' + field + '</w:p></w:' + (apa ? 'hdr' : 'ftr') + '>';
      var sect = '<w:sectPr><w:' + hf + 'Reference w:type="default" r:id="rId9"/><w:pgSz w:w="' + pageW + '" w:h="' + pageH + '"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="708" w:footer="708" w:gutter="0"/></w:sectPr>';
      var docXml = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="' + NS_W + '" xmlns:r="' + NS_R + '"><w:body>' + body + sect + '</w:body></w:document>';

      var relsXml = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
        '<Relationship Id="rId7" Type="' + NS_R + '/styles" Target="styles.xml"/><Relationship Id="rId8" Type="' + NS_R + '/numbering" Target="numbering.xml"/>' +
        '<Relationship Id="rId9" Type="' + NS_R + '/' + hf + '" Target="' + hf + '1.xml"/>' +
        rels.map(function (r) { return '<Relationship Id="' + r.id + '" Type="' + NS_R + '/hyperlink" Target="' + esc(r.url) + '" TargetMode="External"/>'; }).join('') + '</Relationships>';
      var ct = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>' +
        '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
        '<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>' +
        '<Override PartName="/word/numbering.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml"/>' +
        '<Override PartName="/word/' + hf + '1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.' + hf + '+xml"/>' +
        '<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>' +
        '<Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/></Types>';
      var title = firstTitle(blocks) || 'Documento', now = new Date().toISOString().replace(/\.\d+Z$/, 'Z');
      var core = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:title>' + esc(title) + '</dc:title><dc:creator>Asistente</dc:creator><dcterms:created xsi:type="dcterms:W3CDTF">' + now + '</dcterms:created><dcterms:modified xsi:type="dcterms:W3CDTF">' + now + '</dcterms:modified></cp:coreProperties>';
      var app = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties"><Application>Asistente</Application></Properties>';
      var rootRels = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="' + NS_R + '/officeDocument" Target="word/document.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/><Relationship Id="rId3" Type="' + NS_R + '/extended-properties" Target="docProps/app.xml"/></Relationships>';

      var zip = new JSZip(), put = function (n, d) { zip.file(n, d, { createFolders: false }); };
      put('[Content_Types].xml', ct); zip.file('_rels/.rels', rootRels);
      put('word/document.xml', docXml); put('word/_rels/document.xml.rels', relsXml);
      put('word/styles.xml', docxStyles(apa)); put('word/numbering.xml', docxNumbering(orderedCount));
      put('word/' + hf + '1.xml', hfXml); put('docProps/core.xml', core); put('docProps/app.xml', app);
      return zip.generateAsync({ type: 'blob', mimeType: DT.DOCX_MIME, compression: 'DEFLATE' }).then(function (blob) {
        return { blob: blob, filename: slug(title) + '.docx', title: title };
      });
    });
  }

  /* =====================================================================
   * PDF (pdf-lib, fuentes estándar: solo caracteres Latin-1; el resto se sustituye)
   * ===================================================================== */
  var FALLBACK = { '→': '->', '←': '<-', '⇒': '=>', '≤': '<=', '≥': '>=', '≠': '!=', '≈': '~', '−': '-', '∞': 'inf', 'π': 'pi', 'α': 'alfa', 'β': 'beta', 'γ': 'gamma', 'δ': 'delta', 'θ': 'theta', 'λ': 'lambda', 'μ': 'mu', 'σ': 'sigma', 'Σ': 'suma', 'Δ': 'Delta', 'Ω': 'Omega', '√': 'raiz', '∑': 'suma', '∫': 'int', '✓': 'v', '“': '"', '”': '"', '‘': "'", '’': "'", '\t': '    ' };
  function toPdf(md, opts) {
    return DT.lib('pdflib').then(function () {
      var PL = window.PDFLib, apa = !!opts.apa, blocks = parseMd(cleanMd(md));
      return PL.PDFDocument.create().then(function (doc) {
        var SF = PL.StandardFonts, pick = apa ? [SF.TimesRoman, SF.TimesRomanBold, SF.TimesRomanItalic, SF.TimesRomanBoldItalic] : [SF.Helvetica, SF.HelveticaBold, SF.HelveticaOblique, SF.HelveticaBoldOblique];
        return Promise.all(pick.concat([SF.Courier]).map(function (f) { return doc.embedFont(f); })).then(function (fonts) {
          var F = { n: fonts[0], b: fonts[1], i: fonts[2], bi: fonts[3], m: fonts[4] };
          var charset = new Set(F.n.getCharacterSet());
          var safe = function (s) {
            var out = '';
            Array.from(s).forEach(function (c) {
              if (charset.has(c.codePointAt(0))) out += c; else if (FALLBACK[c] !== undefined) out += FALLBACK[c]; else if (c.codePointAt(0) < 0x10000) out += '?';
            });
            return out;
          };
          var size = apa ? [612, 792] : [595.28, 841.89], M = apa ? 72 : 64, CW = size[0] - 2 * M, page, y, pages = [];
          var newPage = function () { page = doc.addPage(size); pages.push(page); y = size[1] - M; };
          newPage();
          var widthCache = new Map();
          function wd(font, text, sz) {   // ancho SIN kerning, igual que lo que se dibuja
            var m = widthCache.get(font); if (!m) { m = new Map(); widthCache.set(font, m); }
            var total = 0;
            for (var ch of text) { var w = m.get(ch); if (w === undefined) { w = font.widthOfTextAtSize(ch, 1000) / 1000; m.set(ch, w); } total += w; }
            return total * sz;
          }
          var gray = PL.rgb(0.35, 0.35, 0.35), black = PL.rgb(0, 0, 0);
          var baseSize = apa ? 12 : 11, lh = apa ? 2 : 1.35;

          function fontFor(r, base) { var b = r.b || base.b, i = r.i || base.i; return r.code ? F.m : b && i ? F.bi : b ? F.b : i ? F.i : F.n; }
          function tokens(rs, base) {
            var out = [];
            rs.forEach(function (r) {
              var f = fontFor(r, base);
              safe(r.text).split(/(\s+)/).forEach(function (w) { if (w) out.push({ w: w, f: f, link: !!r.url }); });
            });
            return out;
          }
          /** Devuelve líneas [{ items:[{w,f,link}], width }] ajustadas al ancho. */
          function wrap(toks, width, sz, pre) {
            var lines = [], cur = [], cw = 0;
            toks.forEach(function (t) {
              var tw = wd(t.f, t.w, sz), isSp = /^\s+$/.test(t.w);
              if (!isSp && cw + tw > width && cur.length) {
                while (cur.length && /^\s+$/.test(cur[cur.length - 1].w)) cur.pop();
                lines.push({ items: cur, width: cw }); cur = []; cw = 0;
              }
              if (isSp && !cur.length && !pre) return;
              cur.push(t); cw += tw;
            });
            if (cur.length) { while (cur.length && /^\s+$/.test(cur[cur.length - 1].w)) cur.pop(); lines.push({ items: cur, width: cur.reduce(function (a, t) { return a + wd(t.f, t.w, sz); }, 0) }); }
            return lines;
          }
          function drawLines(lines, x0, width, sz, o) {
            o = o || {};
            var step = sz * (o.lh || lh);
            lines.forEach(function (ln, idx) {
              if (y - step < M) newPage();
              y -= step;
              var x = x0 + (idx === 0 ? (o.first || 0) : 0);
              if (o.align === 'center') x = x0 + (width - ln.width) / 2; else if (o.align === 'right') x = x0 + width - ln.width;
              if (o.bg) page.drawRectangle({ x: x0 - 4, y: y - sz * 0.3, width: width + 8, height: step, color: PL.rgb(0.95, 0.95, 0.95) });
              mergeRuns(ln.items).forEach(function (t) {   // un solo texto por tramo del mismo estilo: se puede copiar y buscar
                page.drawText(t.w, { x: x, y: y, size: sz, font: t.f, color: t.link ? PL.rgb(0.02, 0.39, 0.76) : (o.color || black) });
                x += wd(t.f, t.w, sz);
              });
            });
          }
          function mergeRuns(items) {
            var out = [];
            items.forEach(function (t) { var l = out[out.length - 1]; if (l && l.f === t.f && l.link === t.link) l.w += t.w; else out.push({ w: t.w, f: t.f, link: t.link }); });
            return out;
          }
          function paragraph(rs, o) {
            o = o || {};
            var sz = o.size || baseSize, x0 = M + (o.indent || 0), width = CW - (o.indent || 0) - (o.right || 0);
            var ln = wrap(tokens(rs, o.base || {}), width - (o.first || 0 ? 0 : 0), sz);
            if (o.before) y -= o.before;
            drawLines(ln, x0, width, sz, o);
            y -= (o.after !== undefined ? o.after : (apa ? 0 : 6));
          }
          var firstH1 = true, inRefs = false;
          blocks.forEach(function (b) {
            if (b.t === 'h') {
              var text = plain(b.runs), refs = REFS_RE.test(text.trim());
              if (apa) {
                var level = b.l === 1 && firstH1 ? 0 : Math.min(5, Math.max(1, b.l - 1)); if (b.l === 1) firstH1 = false;
                if (refs) { newPage(); level = 1; }
                paragraph(b.runs, { base: { b: true, i: level === 3 || level === 5 }, align: level <= 1 ? 'center' : 'left', first: level >= 4 ? 36 : 0, after: 0 });
              } else {
                var sizes = [20, 16, 13.5, 12, 11, 11], lv = Math.min(b.l, 6) - 1;
                paragraph(b.runs, { base: { b: true }, size: sizes[lv], before: lv === 0 ? 2 : 10, after: 5, lh: 1.25 });
              }
              inRefs = refs;
            } else if (b.t === 'p') {
              paragraph(b.runs, apa ? (inRefs ? { indent: 36, first: -36, after: 0 } : { first: 36 }) : {});
            } else if (b.t === 'quote') {
              paragraph(b.runs, { indent: 24, color: gray, base: { i: true } });
            } else if (b.t === 'math') {
              paragraph([{ text: b.text, i: true }], { align: 'center' });
            } else if (b.t === 'hr') {
              y -= 6; page.drawLine({ start: { x: M, y: y }, end: { x: M + CW, y: y }, thickness: 0.7, color: PL.rgb(0.6, 0.6, 0.6) }); y -= 8;
            } else if (b.t === 'code') {
              var csz = 9.5;
              b.text.split('\n').forEach(function (l) {
                var ln = wrap(tokens([{ text: l.replace(/\t/g, '    '), code: true }], {}), CW, csz, true);
                drawLines(ln.length ? ln : [{ items: [], width: 0 }], M, CW, csz, { bg: true, lh: 1.3 });
              });
              y -= 8;
            } else if (b.t === 'list') {
              var n = 0;
              b.items.forEach(function (it) {
                var ind = 18 + it.level * 18, marker = b.ordered ? (++n) + '.' : (it.level ? '-' : '•');
                var ln = wrap(tokens(it.runs, {}), CW - ind, baseSize);
                if (y - baseSize * lh < M) newPage();
                page.drawText(safe(marker), { x: M + ind - 14, y: y - baseSize * lh, size: baseSize, font: F.n, color: black });
                drawLines(ln, M + ind, CW - ind, baseSize, {});
                y -= apa ? 0 : 2;
              });
              y -= apa ? 0 : 4;
            } else if (b.t === 'table') {
              var cols = Math.max(1, b.head.length), cwid = CW / cols, tsz = apa ? 11 : 9.5, pad = 4;
              var drawRow = function (cells, header) {
                var wrapped = []; for (var c = 0; c < cols; c++) wrapped.push(wrap(tokens(cells[c] || [], header ? { b: true } : {}), cwid - 2 * pad, tsz));
                var rows = Math.max.apply(null, wrapped.map(function (w) { return w.length || 1; })), step = tsz * 1.3, hgt = rows * step + 2 * pad;
                if (y - hgt < M) newPage();
                var top = y;
                for (var k = 0; k < cols; k++) {
                  var x = M + k * cwid;
                  page.drawRectangle({ x: x, y: top - hgt, width: cwid, height: hgt, borderColor: PL.rgb(0.5, 0.5, 0.5), borderWidth: 0.6, color: header ? PL.rgb(0.9, 0.9, 0.9) : undefined });
                  var yy = top - pad;
                  wrapped[k].forEach(function (ln) {
                    yy -= step;
                    var tx = x + pad; if (b.aligns[k] === 'right') tx = x + cwid - pad - ln.width; else if (b.aligns[k] === 'center') tx = x + (cwid - ln.width) / 2;
                    mergeRuns(ln.items).forEach(function (t) { page.drawText(t.w, { x: tx, y: yy + 2, size: tsz, font: t.f, color: black }); tx += wd(t.f, t.w, tsz); });
                  });
                }
                y = top - hgt;
              };
              drawRow(b.head, true); b.rows.forEach(function (r) { drawRow(r, false); }); y -= 10;
            }
          });
          var total = pages.length;
          pages.forEach(function (pg, i) {
            var s = String(i + 1), w = wd(F.n, s, 10);
            pg.drawText(s, apa ? { x: size[0] - M - w, y: size[1] - 40, size: 10, font: F.n, color: black } : { x: (size[0] - w) / 2, y: 30, size: 10, font: F.n, color: gray });
          });
          var title = firstTitle(blocks) || 'Documento';
          doc.setTitle(safe(title)); doc.setCreator('Asistente'); doc.setProducer('Asistente');
          return doc.save().then(function (bytes) { return { blob: new Blob([bytes], { type: 'application/pdf' }), filename: slug(title) + '.pdf', title: title, pages: total }; });
        });
      });
    });
  }

  /* =====================================================================
   * XLSX (cada tabla de la respuesta → una hoja)
   * ===================================================================== */
  function cellValue(runs) {
    var t = plain(runs).trim();
    if (/^=.+/.test(t)) return { formula: t.slice(1) };
    if (/^-?\d+(\.\d+)?$/.test(t)) return { v: parseFloat(t) };
    if (/^-?\d+,\d+$/.test(t)) return { v: parseFloat(t.replace(',', '.')) };
    var pc = /^(-?\d+(?:[.,]\d+)?)\s*%$/.exec(t); if (pc) return { v: parseFloat(pc[1].replace(',', '.')) / 100, fmt: '0.##%' };
    var cur = /^([$€£])\s*(-?\d{1,3}(?:,\d{3})*(?:\.\d+)?|-?\d+(?:\.\d+)?)$/.exec(t);
    if (cur) return { v: parseFloat(cur[2].replace(/,/g, '')), fmt: '"' + cur[1] + '"#,##0.00' };
    return { v: t };
  }
  function toXlsx(md) {
    return DT.lib('exceljs').then(function () {
      var blocks = parseMd(cleanMd(md)), wb = new ExcelJS.Workbook(), lastHeading = '', used = {}, n = 0, firstTitleText = firstTitle(blocks);
      wb.creator = 'Asistente'; wb.created = new Date();
      blocks.forEach(function (b) {
        if (b.t === 'h') { lastHeading = plain(b.runs); return; }
        if (b.t !== 'table') return;
        n++;
        var name = (lastHeading || 'Hoja ' + n).replace(/[\[\]:*?\/\\]/g, ' ').trim().slice(0, 31) || 'Hoja ' + n, base = name, k = 2;
        while (used[name.toLowerCase()]) name = base.slice(0, 28) + ' ' + (k++);
        used[name.toLowerCase()] = 1;
        var ws = wb.addWorksheet(name), widths = [];
        var addRow = function (cells, header) {
          var row = ws.addRow(cells.map(function (c) { var v = header ? { v: plain(c).trim() } : cellValue(c); return v.formula ? { formula: v.formula } : v.v; }));
          cells.forEach(function (c, i) {
            var v = header ? { v: plain(c).trim() } : cellValue(c), cl = row.getCell(i + 1);
            if (v.fmt) cl.numFmt = v.fmt;
            cl.border = { top: { style: 'thin', color: { argb: 'FFBFBFBF' } }, left: { style: 'thin', color: { argb: 'FFBFBFBF' } }, bottom: { style: 'thin', color: { argb: 'FFBFBFBF' } }, right: { style: 'thin', color: { argb: 'FFBFBFBF' } } };
            if (header) { cl.font = { bold: true }; cl.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE7E6E6' } }; }
            if (!header && typeof v.v === 'number') cl.alignment = { horizontal: 'right' };
            widths[i] = Math.max(widths[i] || 8, Math.min(60, String(v.formula ? '' : (v.v === undefined ? '' : v.v)).length + 2));
          });
        };
        addRow(b.head, true); b.rows.forEach(function (r) { addRow(b.head.map(function (_, i) { return r[i] || []; }), false); });
        widths.forEach(function (w, i) { ws.getColumn(i + 1).width = w; });
        ws.views = [{ state: 'frozen', ySplit: 1 }];
        ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: b.head.length } };
      });
      if (!n) { var e = new Error('NO_TABLES'); e.code = 'NO_TABLES'; throw e; }
      return wb.xlsx.writeBuffer().then(function (buf) {
        return { blob: new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), filename: slug(firstTitleText || 'hoja-de-calculo') + '.xlsx', title: firstTitleText, sheets: n };
      });
    });
  }

  /* =====================================================================
   * PPTX (pptxgenjs): H1 = portada, cada H2 = diapositiva
   * ===================================================================== */
  function toPptx(md) {
    return DT.lib('pptx').then(function () {
      var blocks = parseMd(cleanMd(md)), pres = new PptxGenJS();
      pres.layout = 'LAYOUT_WIDE'; pres.author = 'Asistente';
      var title = '', slides = [], cur = null, sub = '';
      blocks.forEach(function (b) {
        if (b.t === 'h' && b.l === 1 && !title) { title = plain(b.runs); return; }
        if (b.t === 'h' && b.l <= 2) { cur = { title: plain(b.runs), items: [], tables: [], code: [] }; slides.push(cur); return; }
        if (!cur) { if (b.t === 'p' && !sub) { sub = plain(b.runs); return; } else if (b.t === 'list' || b.t === 'p') { cur = { title: title || 'Contenido', items: [], tables: [], code: [] }; slides.push(cur); } else return; }
        if (b.t === 'h') cur.items.push({ text: plain(b.runs), bold: true, level: 0 });
        else if (b.t === 'p' || b.t === 'quote') cur.items.push({ text: plain(b.runs), level: 0 });
        else if (b.t === 'list') b.items.forEach(function (it) { cur.items.push({ text: plain(it.runs), level: Math.min(it.level, 2), bullet: true }); });
        else if (b.t === 'table') cur.tables.push(b);
        else if (b.t === 'code') cur.code.push(b.text);
        else if (b.t === 'math') cur.items.push({ text: b.text, level: 0, italic: true });
      });
      if (!title && slides.length) title = slides[0].title;
      var count = 0;
      if (title) {
        var s0 = pres.addSlide(); count++;
        s0.background = { color: 'FFFFFF' };
        s0.addText(title, { x: 0.8, y: 2.3, w: 11.7, h: 1.6, fontFace: 'Calibri', fontSize: 40, bold: true, color: '111111', align: 'left', valign: 'middle', fit: 'shrink' });
        if (sub) s0.addText(sub, { x: 0.8, y: 4.0, w: 11.7, h: 1.0, fontFace: 'Calibri', fontSize: 20, color: '595959', align: 'left', valign: 'top', fit: 'shrink' });
      }
      slides.forEach(function (sl) {
        var MAXB = 7, chunks = [], items = sl.items.slice();
        if (!items.length && !sl.tables.length && !sl.code.length) items.push({ text: ' ', level: 0 });
        for (var i = 0; i < Math.max(1, Math.ceil(items.length / MAXB)); i++) chunks.push(items.slice(i * MAXB, (i + 1) * MAXB));
        chunks.forEach(function (chunk, ci) {
          var s = pres.addSlide(); count++;
          s.background = { color: 'FFFFFF' };
          s.addText(sl.title + (ci ? ' (cont.)' : ''), { x: 0.6, y: 0.35, w: 12.1, h: 0.9, fontFace: 'Calibri', fontSize: 30, bold: true, color: '111111', valign: 'middle', fit: 'shrink' });
          s.addShape(pres.ShapeType.line, { x: 0.6, y: 1.3, w: 12.1, h: 0, line: { color: 'BFBFBF', width: 1 } });
          var hasExtra = ci === chunks.length - 1 && (sl.tables.length || sl.code.length);
          if (chunk.length && chunk[0].text.trim()) {
            s.addText(chunk.map(function (it) {
              return { text: it.text, options: { bullet: it.bullet !== false && !it.bold ? { indent: 18 } : false, bold: !!it.bold, italic: !!it.italic, indentLevel: it.level || 0, breakLine: true, fontSize: it.level ? 18 : 22 } };
            }), { x: 0.7, y: 1.5, w: 11.9, h: hasExtra ? 2.6 : 5.3, fontFace: 'Calibri', color: '222222', valign: 'top', paraSpaceAfter: 8, fit: 'shrink' });
          }
          if (ci === chunks.length - 1) {
            var ty = chunk.length && chunk[0].text.trim() ? (hasExtra ? 4.2 : 1.5) : 1.5;
            sl.tables.forEach(function (t) {
              var rows = [t.head.map(function (h) { return { text: plain(h), options: { bold: true, fill: { color: 'E7E6E6' } } }; })].concat(t.rows.map(function (r) { return t.head.map(function (_, k) { return { text: plain(r[k] || []) }; }); }));
              s.addTable(rows, { x: 0.7, y: ty, w: 11.9, fontFace: 'Calibri', fontSize: 14, color: '222222', border: { type: 'solid', pt: 0.75, color: 'A6A6A6' }, autoPage: false });
              ty += 0.4 * rows.length + 0.3;
            });
            sl.code.forEach(function (c) {
              s.addText(c, { x: 0.7, y: Math.min(ty, 5.6), w: 11.9, h: 1.6, fontFace: 'Consolas', fontSize: 12, color: '222222', fill: { color: 'F2F2F2' }, valign: 'top', fit: 'shrink' });
              ty += 1.7;
            });
          }
        });
      });
      if (!count) { var e = new Error('EMPTY'); e.code = 'EMPTY'; throw e; }
      return pres.write({ outputType: 'blob' }).then(function (blob) {
        return { blob: blob, filename: slug(title || 'presentacion') + '.pptx', title: title, slides: count };
      });
    });
  }

  /* =====================================================================
   * Editar un DOCX existente conservando todo lo demás
   * ===================================================================== */
  function setParagraphText(p, text) {
    var W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main', all = p.getElementsByTagNameNS(W, 't'), mine = [];
    for (var i = 0; i < all.length; i++) {
      var x = all[i].parentNode; while (x && !(x.localName === 'p' && x.namespaceURI === W)) x = x.parentNode;
      if (x === p) mine.push(all[i]);
    }
    if (!mine.length) return false;
    mine[0].textContent = text;
    mine[0].setAttributeNS('http://www.w3.org/XML/1998/namespace', 'xml:space', 'preserve');
    for (var j = 1; j < mine.length; j++) mine[j].parentNode.removeChild(mine[j]);
    return true;
  }
  /** edits: [{ p: número (1-based, el [P12] que vio el modelo), text }]. Devuelve { blob, changed, skipped[] }. */
  function applyDocxEdits(origBlob, edits) {
    return DT.lib('jszip').then(function () { return origBlob.arrayBuffer(); }).then(function (buf) { return JSZip.loadAsync(buf); }).then(function (zip) {
      return zip.file('word/document.xml').async('string').then(function (xml) {
        var doc = DT.parseXml(xml), paras = DT.docxParagraphs(doc), changed = 0, skipped = [], seen = {};
        edits.forEach(function (e) {
          var idx = parseInt(e && e.p, 10), item = paras[idx - 1];
          if (!item || typeof e.text !== 'string' || !e.text.trim() || seen[idx]) { skipped.push(e && e.p); return; }
          seen[idx] = 1;
          if (item.text.trim() === e.text.trim()) return;
          if (setParagraphText(item.el, e.text.replace(/[\r\n]+/g, ' '))) changed++; else skipped.push(idx);
        });
        var out = new XMLSerializer().serializeToString(doc);
        if (!/^<\?xml/.test(out)) out = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' + out;
        zip.file('word/document.xml', out, { createFolders: false });
        return zip.generateAsync({ type: 'blob', mimeType: DT.DOCX_MIME, compression: 'DEFLATE' }).then(function (blob) { return { blob: blob, changed: changed, skipped: skipped }; });
      });
    });
  }

  /** Extrae el JSON de un bloque ```edits (o null si no es válido). */
  function parseEdits(code) {
    try {
      var o = JSON.parse(code);
      if (Array.isArray(o)) o = { edits: o };
      if (!o || !Array.isArray(o.edits) || !o.edits.length) return null;
      var edits = o.edits.filter(function (e) { return e && Number.isFinite(parseInt(e.p, 10)) && typeof e.text === 'string'; });
      return edits.length ? { doc: typeof o.doc === 'string' ? o.doc : '', edits: edits } : null;
    } catch (e) { return null; }
  }

  function build(format, md, opts) {
    opts = opts || {};
    if (format === 'docx') return toDocx(md, opts);
    if (format === 'pdf') return toPdf(md, opts);
    if (format === 'xlsx') return toXlsx(md, opts);
    if (format === 'pptx') return toPptx(md, opts);
    if (format === 'md') { var t = cleanMd(md); return Promise.resolve({ blob: new Blob([t], { type: 'text/markdown;charset=utf-8' }), filename: slug(firstTitle(parseMd(t))) + '.md' }); }
    return Promise.reject(new Error('formato'));
  }

  window.Exporter = { build: build, applyDocxEdits: applyDocxEdits, parseEdits: parseEdits, parseMd: parseMd, latexToText: latexToText, cleanMd: cleanMd, hasTables: function (md) { return parseMd(cleanMd(md)).some(function (b) { return b.t === 'table'; }); } };
})();
