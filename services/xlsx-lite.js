/**
 * xlsx-lite.js v1.3.0：无第三方依赖的 .xlsx 读写（只用于岗位JD导入导出）
 * 写：不压缩 zip + 内联字符串，Excel / WPS 都能直接打开。
 * 读：支持 Excel / WPS 正常保存的文件（deflate 压缩、共享字符串、内联字符串、数字、布尔）。
 * 依赖浏览器自带的 DecompressionStream('deflate-raw') 和 DOMParser。
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.HRSXlsx = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // ---------------- zip 写 ----------------
  var CRC_TABLE = (function () {
    var t = new Uint32Array(256);
    for (var n = 0; n < 256; n++) {
      var c = n;
      for (var k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
      t[n] = c >>> 0;
    }
    return t;
  })();
  function crc32(bytes) {
    var c = 0xFFFFFFFF;
    for (var i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xFF] ^ (c >>> 8);
    return (c ^ 0xFFFFFFFF) >>> 0;
  }
  var enc = new TextEncoder();
  function zipStore(files) {
    var parts = [], central = [], offset = 0;
    files.forEach(function (f) {
      var name = enc.encode(f.name), data = enc.encode(f.data), crc = crc32(data);
      var lh = new DataView(new ArrayBuffer(30));
      lh.setUint32(0, 0x04034b50, true); lh.setUint16(4, 20, true); lh.setUint16(6, 0x0800, true);
      lh.setUint16(8, 0, true); lh.setUint16(10, 0, true); lh.setUint16(12, 0x21, true);
      lh.setUint32(14, crc, true); lh.setUint32(18, data.length, true); lh.setUint32(22, data.length, true);
      lh.setUint16(26, name.length, true); lh.setUint16(28, 0, true);
      parts.push(new Uint8Array(lh.buffer), name, data);
      var ch = new DataView(new ArrayBuffer(46));
      ch.setUint32(0, 0x02014b50, true); ch.setUint16(4, 20, true); ch.setUint16(6, 20, true); ch.setUint16(8, 0x0800, true);
      ch.setUint16(10, 0, true); ch.setUint16(12, 0, true); ch.setUint16(14, 0x21, true);
      ch.setUint32(16, crc, true); ch.setUint32(20, data.length, true); ch.setUint32(24, data.length, true);
      ch.setUint16(28, name.length, true); ch.setUint32(42, offset, true);
      central.push(new Uint8Array(ch.buffer), name);
      offset += 30 + name.length + data.length;
    });
    var cdSize = central.reduce(function (n, p) { return n + p.length; }, 0);
    var end = new DataView(new ArrayBuffer(22));
    end.setUint32(0, 0x06054b50, true); end.setUint16(8, files.length, true); end.setUint16(10, files.length, true);
    end.setUint32(12, cdSize, true); end.setUint32(16, offset, true);
    return parts.concat(central, [new Uint8Array(end.buffer)]);
  }

  // ---------------- xlsx 写 ----------------
  function esc(s) {
    return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; })
      .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '');
  }
  function colName(i) { var s = ''; i++; while (i > 0) { var m = (i - 1) % 26; s = String.fromCharCode(65 + m) + s; i = Math.floor((i - 1) / 26); } return s; }
  function sheetXml(sh) {
    var rows = sh.rows || [];
    var x = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">';
    x += '<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>';
    if (sh.widths) x += '<cols>' + sh.widths.map(function (w, i) { return '<col min="' + (i + 1) + '" max="' + (i + 1) + '" width="' + (w || 14) + '" customWidth="1"/>'; }).join('') + '</cols>';
    x += '<sheetData>';
    rows.forEach(function (r, ri) {
      x += '<row r="' + (ri + 1) + '">';
      r.forEach(function (v, ci) {
        if (v === null || v === undefined || v === '') return;
        var ref = colName(ci) + (ri + 1), st = ri === 0 ? 1 : 2;
        if (typeof v === 'number' && isFinite(v)) x += '<c r="' + ref + '" s="' + st + '"><v>' + v + '</v></c>';
        else x += '<c r="' + ref + '" s="' + st + '" t="inlineStr"><is><t xml:space="preserve">' + esc(v) + '</t></is></c>';
      });
      x += '</row>';
    });
    x += '</sheetData>';
    if (sh.lists && sh.lists.length) {
      x += '<dataValidations count="' + sh.lists.length + '">' + sh.lists.map(function (l) {
        var c = colName(l.col);
        return '<dataValidation type="list" allowBlank="1" showErrorMessage="1" sqref="' + c + '2:' + c + '1000"><formula1>"' + esc(l.values.join(',')) + '"</formula1></dataValidation>';
      }).join('') + '</dataValidations>';
    }
    return x + '</worksheet>';
  }
  /** sheets: [{ name, rows: [[...]], widths: [..], lists: [{col, values}] }] → Blob */
  function write(sheets) {
    var ct = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>' +
      sheets.map(function (s, i) { return '<Override PartName="/xl/worksheets/sheet' + (i + 1) + '.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>'; }).join('') + '</Types>';
    var rels = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>';
    var wb = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>' +
      sheets.map(function (s, i) { return '<sheet name="' + esc(s.name) + '" sheetId="' + (i + 1) + '" r:id="rId' + (i + 1) + '"/>'; }).join('') + '</sheets></workbook>';
    var wbRels = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      sheets.map(function (s, i) { return '<Relationship Id="rId' + (i + 1) + '" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet' + (i + 1) + '.xml"/>'; }).join('') +
      '<Relationship Id="rId' + (sheets.length + 1) + '" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>';
    var styles = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
      '<fonts count="2"><font><sz val="11"/><name val="Microsoft YaHei"/></font><font><b/><sz val="11"/><name val="Microsoft YaHei"/></font></fonts>' +
      '<fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FFDBEAFE"/><bgColor indexed="64"/></patternFill></fill></fills>' +
      '<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>' +
      '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>' +
      '<cellXfs count="3"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>' +
      '<xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1" applyAlignment="1"><alignment vertical="center" wrapText="1"/></xf>' +
      '<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf></cellXfs>' +
      '<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>';
    var files = [
      { name: '[Content_Types].xml', data: ct },
      { name: '_rels/.rels', data: rels },
      { name: 'xl/workbook.xml', data: wb },
      { name: 'xl/_rels/workbook.xml.rels', data: wbRels },
      { name: 'xl/styles.xml', data: styles }
    ].concat(sheets.map(function (s, i) { return { name: 'xl/worksheets/sheet' + (i + 1) + '.xml', data: sheetXml(s) }; }));
    return new Blob(zipStore(files), { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  }

  // ---------------- zip 读 ----------------
  function inflateRaw(bytes) {
    if (typeof DecompressionStream === 'undefined') return Promise.reject(new Error('当前浏览器不支持解压，请升级 Chrome / Edge'));
    var ds = new DecompressionStream('deflate-raw');
    var stream = new Blob([bytes]).stream().pipeThrough(ds);
    return new Response(stream).arrayBuffer().then(function (b) { return new Uint8Array(b); });
  }
  function unzip(buf) {
    var u8 = new Uint8Array(buf), dv = new DataView(buf);
    var eocd = -1;
    for (var i = u8.length - 22; i >= Math.max(0, u8.length - 66000); i--) {
      if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
    }
    if (eocd < 0) return Promise.reject(new Error('不是有效的 .xlsx 文件（可能是 .xls 旧格式或 .csv，请用 Excel 另存为 .xlsx）'));
    var count = dv.getUint16(eocd + 10, true), p = dv.getUint32(eocd + 16, true);
    var dec = new TextDecoder('utf-8'), entries = {};
    var jobs = [];
    for (var n = 0; n < count; n++) {
      if (dv.getUint32(p, true) !== 0x02014b50) break;
      var method = dv.getUint16(p + 10, true), csize = dv.getUint32(p + 20, true);
      var nlen = dv.getUint16(p + 28, true), xlen = dv.getUint16(p + 30, true), clen = dv.getUint16(p + 32, true);
      var off = dv.getUint32(p + 42, true);
      var name = dec.decode(u8.subarray(p + 46, p + 46 + nlen));
      var dataStart = off + 30 + dv.getUint16(off + 26, true) + dv.getUint16(off + 28, true);
      var raw = u8.subarray(dataStart, dataStart + csize);
      (function (name, method, raw) {
        if (!/\.(xml|rels)$/i.test(name)) return;
        var pr = method === 0 ? Promise.resolve(raw) : method === 8 ? inflateRaw(raw) : Promise.reject(new Error('不支持的压缩方式 ' + method));
        jobs.push(pr.then(function (b) { entries[name] = dec.decode(b); }));
      })(name, method, raw);
      p += 46 + nlen + xlen + clen;
    }
    return Promise.all(jobs).then(function () { return entries; });
  }

  // ---------------- xlsx 读 ----------------
  function colIndex(ref) {
    var m = String(ref || '').match(/^([A-Z]+)/i);
    if (!m) return -1;
    var s = m[1].toUpperCase(), n = 0;
    for (var i = 0; i < s.length; i++) n = n * 26 + (s.charCodeAt(i) - 64);
    return n - 1;
  }
  function byTag(node, tag) { return Array.prototype.slice.call(node.getElementsByTagName(tag)); }
  function textOfSi(si) {
    // 只取正文 <t>，忽略拼音注音 <rPh>
    return byTag(si, 't').filter(function (t) {
      var p = t.parentNode; while (p && p !== si) { if (p.nodeName === 'rPh') return false; p = p.parentNode; } return true;
    }).map(function (t) { return t.textContent; }).join('');
  }
  /** 读取 → Promise<[{ name, rows: [[...]] }]>，单元格为字符串 / 数字 / 布尔 */
  function read(buf, ParserCtor) {
    var Parser = ParserCtor || (typeof DOMParser !== 'undefined' ? DOMParser : null);
    if (!Parser) return Promise.reject(new Error('缺少 XML 解析器'));
    return unzip(buf).then(function (e) {
      var parse = function (x) { return new Parser().parseFromString(x, 'application/xml'); };
      if (!e['xl/workbook.xml']) throw new Error('文件里找不到工作簿，可能不是 Excel 文件');
      var wb = parse(e['xl/workbook.xml']);
      var rels = {};
      if (e['xl/_rels/workbook.xml.rels']) {
        byTag(parse(e['xl/_rels/workbook.xml.rels']), 'Relationship').forEach(function (r) {
          var t = r.getAttribute('Target') || '';
          rels[r.getAttribute('Id')] = t.charAt(0) === '/' ? t.slice(1) : 'xl/' + t.replace(/^\.\//, '');
        });
      }
      var shared = [];
      if (e['xl/sharedStrings.xml']) shared = byTag(parse(e['xl/sharedStrings.xml']), 'si').map(textOfSi);
      return byTag(wb, 'sheet').map(function (sh, i) {
        var rid = sh.getAttribute('r:id') || sh.getAttributeNS('http://schemas.openxmlformats.org/officeDocument/2006/relationships', 'id');
        var path = rels[rid] || ('xl/worksheets/sheet' + (i + 1) + '.xml');
        var rows = [];
        if (e[path]) {
          byTag(parse(e[path]), 'row').forEach(function (row, ri) {
            var rn = parseInt(row.getAttribute('r'), 10) || (ri + 1);
            var out = [];
            byTag(row, 'c').forEach(function (c, ci) {
              var idx = c.getAttribute('r') ? colIndex(c.getAttribute('r')) : ci;
              var t = c.getAttribute('t'), v = byTag(c, 'v')[0], val = '';
              if (t === 's') val = v ? (shared[parseInt(v.textContent, 10)] || '') : '';
              else if (t === 'inlineStr') { var is = byTag(c, 'is')[0]; val = is ? textOfSi(is) : ''; }
              else if (t === 'b') val = v ? v.textContent === '1' : '';
              else if (t === 'str' || t === 'e') val = v ? v.textContent : '';
              else if (v) { var num = Number(v.textContent); val = isFinite(num) ? num : v.textContent; }
              out[idx] = val;
            });
            for (var k = 0; k < out.length; k++) if (out[k] === undefined) out[k] = '';
            rows[rn - 1] = out;
          });
        }
        for (var r = 0; r < rows.length; r++) if (!rows[r]) rows[r] = [];
        return { name: sh.getAttribute('name') || ('Sheet' + (i + 1)), rows: rows };
      });
    });
  }

  return { write: write, read: read, _crc32: crc32 };
});
