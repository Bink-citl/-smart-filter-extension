/**
 * pdf-find.js v2.6.1：拿到候选人简历的「PDF 原件」
 * 平台给的链接经常是一个预览网页（HTML），直接下载就会存成 .htm。
 * 这里只认文件开头是 %PDF 的内容；拿到网页时，从网页里找出真正的 PDF 地址再取一次（最多两层、8 次请求）。
 * 页面（content script）和后台（service worker）共用。没有 DOM 依赖，Node 里可测。
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.HRSPdfFind = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  var STATIC_RE = /\.(?:js|mjs|css|png|jpe?g|gif|svg|ico|woff2?|ttf|otf|eot|map|webp|mp4|mp3|wasm|bcmap|ftl|properties)(?:[?#]|$)/i;
  var MAX_BYTES = 25 * 1024 * 1024;

  /** 字节开头 1KB 内有 %PDF- 才算 PDF（PDF 规范允许前面有少量杂字节） */
  function isPdfHead(u8) {
    if (!u8 || !u8.length) return false;
    var n = Math.min(u8.length - 4, 1024);
    for (var i = 0; i < n; i++) {
      if (u8[i] === 0x25 && u8[i + 1] === 0x50 && u8[i + 2] === 0x44 && u8[i + 3] === 0x46 && u8[i + 4] === 0x2D) return true;
    }
    return false;
  }
  function headOf(blob) {
    return blob.slice(0, 1029).arrayBuffer().then(function (b) { return new Uint8Array(b); });
  }
  function checkBlob(blob) {
    if (!blob || !blob.size) return Promise.resolve(false);
    return headOf(blob).then(isPdfHead).catch(function () { return false; });
  }

  /** 这个地址像不像文件（简历、附件、下载、pdf）。0 = 不像，越大越像 */
  function score(u) {
    var x = String(u || '');
    if (!/^https?:/i.test(x) || STATIC_RE.test(x.replace(/[?#].*$/, ''))) return 0;
    var low = x.toLowerCase(), p = 0;
    if (/\.pdf(?:[?#&]|$)/.test(low)) p += 10;
    else if (/pdf/.test(low)) p += 5;
    if (/download/.test(low)) p += 3;
    if (/attach|annex/.test(low)) p += 3;
    if (/resume|\bcv\b/.test(low)) p += 2;
    if (/\/file|fileid|file_id|filekey/.test(low)) p += 2;
    if (/preview/.test(low)) p += 1;
    if (/viewer\.html|\/viewer\b/.test(low) && !/[?&](file|url|src)=/.test(low)) p -= 3;
    return p > 0 ? p : 0;
  }
  function unescapeText(t) {
    return String(t || '')
      .replace(/\\u002[fF]/g, '/').replace(/\\u0026/g, '&').replace(/\\u003[dD]/g, '=').replace(/\\u003[fF]/g, '?')
      .replace(/\\\//g, '/').replace(/&amp;/g, '&').replace(/&#x2F;/gi, '/').replace(/&#47;/g, '/');
  }
  function abs(u, base) {
    try { return new URL(u, base || undefined).href; } catch (e) { return ''; }
  }
  /** 从地址里的 file= / url= / src= 参数拆出内层地址 */
  function innerUrls(u) {
    var out = [];
    try {
      var x = new URL(u);
      ['file', 'url', 'src', 'fileUrl', 'pdf', 'path', 'downloadUrl'].forEach(function (k) {
        var v = x.searchParams.get(k);
        if (v && /^(https?:|\/)/i.test(v)) out.push(abs(v, u));
      });
    } catch (e) {}
    return out;
  }
  /** 从网页 / JSON 文字里找可能是 PDF 原件的地址，按像不像排序 */
  function urlsFromText(text, base) {
    var t = unescapeText(String(text || '').slice(0, 2 * 1024 * 1024));
    var found = [], m;
    var attrRe = /(?:src|href|data|data-url|data-src|data-file-url|file|fileUrl|downloadUrl|pdfUrl|url)\s*[=:]\s*["']([^"'<>\s]{4,1500})["']/gi;
    while ((m = attrRe.exec(t))) found.push(m[1]);
    var absRe = /https?:\/\/[^\s"'<>()\\,]{6,1500}/gi;
    while ((m = absRe.exec(t))) found.push(m[0]);
    var seen = {}, out = [];
    found.forEach(function (raw) {
      var u = abs(raw.replace(/[).;]+$/, ''), base);
      if (!u) return;
      [u].concat(innerUrls(u)).forEach(function (v) {
        if (!v || seen[v]) return;
        seen[v] = 1;
        var sc = score(v);
        if (sc) out.push({ u: v, s: sc });
      });
    });
    out.sort(function (a, b) { return b.s - a.s; });
    return out.map(function (x) { return x.u; }).slice(0, 12);
  }
  /** 一组地址里挑出像文件的（页面资源记录、iframe 地址等） */
  function pickLikely(urls) {
    var seen = {}, out = [];
    (urls || []).forEach(function (u) {
      [u].concat(innerUrls(u)).forEach(function (v) {
        if (!v || seen[v]) return;
        seen[v] = 1;
        var sc = score(v);
        if (sc) out.push({ u: v, s: sc });
      });
    });
    out.sort(function (a, b) { return b.s - a.s; });
    return out.map(function (x) { return x.u; });
  }

  /**
   * 从一个或多个地址取 PDF 原件。
   * opts.fetch：用哪个 fetch（页面 / 后台各自传入），opts.max：最多请求几次（默认 8），opts.depth：网页里再找几层（默认 2）
   * 返回 { blob, url, tried:[{url, why}] }，没找到时 blob 为 null
   */
  function resolve(urls, opts) {
    opts = opts || {};
    var f = opts.fetch || (typeof fetch === 'function' ? fetch.bind(typeof self !== 'undefined' ? self : this) : null);
    var max = opts.max || 8, depthMax = opts.depth == null ? 2 : opts.depth;
    var queue = [], seen = {}, tried = [], count = 0;
    (Array.isArray(urls) ? urls : [urls]).forEach(function (u) {
      [u].concat(innerUrls(u)).forEach(function (v) { if (v && /^(https?:|blob:|data:)/i.test(v) && !seen[v]) { seen[v] = 1; queue.push({ u: v, d: 0 }); } });
    });
    function next() {
      if (!f || !queue.length || count >= max) return Promise.resolve({ blob: null, url: '', tried: tried });
      var it = queue.shift();
      count++;
      return f(it.u, { credentials: 'include' }).then(function (r) {
        if (!r || !r.ok) { tried.push({ url: it.u, why: 'HTTP ' + (r ? r.status : '?') }); return null; }
        var ct = String((r.headers && r.headers.get && r.headers.get('content-type')) || '').toLowerCase();
        var len = Number((r.headers && r.headers.get && r.headers.get('content-length')) || 0);
        if (len > MAX_BYTES) { tried.push({ url: it.u, why: '文件超过 25MB' }); return null; }
        return r.blob().then(function (blob) {
          return checkBlob(blob).then(function (ok) {
            if (ok) return { blob: blob.type === 'application/pdf' ? blob : blob.slice(0, blob.size, 'application/pdf'), url: r.url || it.u };
            tried.push({ url: it.u, why: /html/.test(ct) ? '是网页' : /json/.test(ct) ? '是数据' : '不是 PDF（' + (ct || '未知类型') + '）' });
            // 网页 / 数据：在里面找真正的文件地址
            if (it.d < depthMax && blob.size < 3 * 1024 * 1024 && /html|json|text|javascript|^$/.test(ct)) {
              return blob.text().then(function (t) {
                urlsFromText(t, r.url || it.u).forEach(function (v) { if (!seen[v]) { seen[v] = 1; queue.push({ u: v, d: it.d + 1 }); } });
                return null;
              });
            }
            return null;
          });
        });
      }).catch(function (e) { tried.push({ url: it.u, why: String(e && e.message || e).slice(0, 60) }); return null; })
        .then(function (hit) { return hit ? { blob: hit.blob, url: hit.url, tried: tried } : next(); });
    }
    return next();
  }

  return { isPdfHead: isPdfHead, checkBlob: checkBlob, score: score, urlsFromText: urlsFromText, pickLikely: pickLikely, innerUrls: innerUrls, resolve: resolve };
});
