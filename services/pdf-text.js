/**
 * pdf-text.js v2.5.0：用 pdf.js 把 PDF 读成「按行」的文字（简历收集用：工作经历要按行找时间段和公司）
 * 页面、PDF 解析页（offscreen）共用。扫描版 PDF 没有文字层，返回空字符串，由调用方提示手动填写。
 */
(function (root) {
  'use strict';
  var ready = false;
  function setup() {
    if (ready || !root.pdfjsLib) return;
    try {
      var base = root.chrome && root.chrome.runtime && root.chrome.runtime.getURL ? root.chrome.runtime.getURL('lib/') : '../lib/';
      root.pdfjsLib.GlobalWorkerOptions.workerSrc = base + 'pdf.worker.min.js';
    } catch (e) {}
    ready = true;
  }
  function pageLines(page) {
    return page.getTextContent().then(function (tc) {
      var lines = [], cur = '', lastY = null;
      tc.items.forEach(function (it) {
        var y = it.transform ? Math.round(it.transform[5]) : null;
        if (lastY != null && y != null && Math.abs(y - lastY) > 3 && cur.trim()) { lines.push(cur); cur = ''; }
        cur += (cur && it.str && !/\s$/.test(cur) && !/^\s/.test(it.str) ? ' ' : '') + (it.str || '');
        if (y != null) lastY = y;
        if (it.hasEOL) { if (cur.trim()) lines.push(cur); cur = ''; lastY = null; }
      });
      if (cur.trim()) lines.push(cur);
      return lines.map(function (l) { return l.replace(/\s+/g, ' ').trim(); }).filter(Boolean).join('\n');
    });
  }
  function fromBuffer(buf, maxPages) {
    if (!root.pdfjsLib) return Promise.reject(new Error('pdf.js 没有加载'));
    setup();
    return root.pdfjsLib.getDocument({ data: new Uint8Array(buf), isEvalSupported: false }).promise.then(function (doc) {
      var n = Math.min(doc.numPages, maxPages || 6), jobs = [];
      for (var i = 1; i <= n; i++) jobs.push(doc.getPage(i).then(pageLines));
      return Promise.all(jobs).then(function (pages) { try { doc.destroy(); } catch (e) {} return pages.join('\n'); });
    });
  }
  function fromBlob(blob, maxPages) {
    return blob.arrayBuffer().then(function (b) { return fromBuffer(b, maxPages); });
  }
  root.HRSPdfText = { fromBuffer: fromBuffer, fromBlob: fromBlob };
})(typeof self !== 'undefined' ? self : this);
