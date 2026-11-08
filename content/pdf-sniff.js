/* pdf-sniff.js v2.6.1：在 Boss / 猎聘 的每个页面和每个框架里，看页面自己加载了哪些「像 PDF 文件」的地址
 * 平台的简历预览窗口通常先出一个网页，再由网页去取真正的 PDF。这里把那个 PDF 地址告诉后台，
 * 后台用你的登录状态再取一次原件（只认开头是 %PDF 的内容）。只读，不点任何东西。
 */
(function () {
  'use strict';
  if (window.__hrsPdfSniff) return;
  window.__hrsPdfSniff = 1;
  var F = window.HRSPdfFind;
  if (!F) return;
  var sent = {}, SKIP_INIT = { img: 1, script: 1, link: 1, css: 1, beacon: 1, video: 1, audio: 1, track: 1, icon: 1 };
  function report(urls, how) {
    var list = F.pickLikely(urls).filter(function (u) { return !sent[u] && F.score(u) >= 5; }).slice(0, 10);
    if (!list.length) return;
    list.forEach(function (u) { sent[u] = 1; });
    try {
      chrome.runtime.sendMessage({ type: 'PDF_SEEN', urls: list, frame: String(location.href).slice(0, 300), top: window === window.top, how: how }, function () { void chrome.runtime.lastError; });
    } catch (e) {}
  }
  // 这个框架本身就是一份 PDF（浏览器自带的 PDF 查看器）
  if (document.contentType === 'application/pdf') {
    sent[location.href] = 1;
    try { chrome.runtime.sendMessage({ type: 'PDF_SEEN', urls: [location.href], frame: String(location.href).slice(0, 300), top: window === window.top, how: 'doc' }, function () { void chrome.runtime.lastError; }); } catch (e) {}
  }
  try {
    var po = new PerformanceObserver(function (list) {
      report(list.getEntries().filter(function (e) { return !SKIP_INIT[e.initiatorType]; }).map(function (e) { return e.name; }), 'res');
    });
    po.observe({ type: 'resource', buffered: true });
  } catch (e) {}
  // iframe / embed / object 指向的地址（预览窗口）
  function scanFrames() {
    var urls = [];
    Array.prototype.forEach.call(document.querySelectorAll('iframe[src],embed[src],object[data]'), function (el) {
      urls.push(el.src || el.getAttribute('src') || el.getAttribute('data') || '');
    });
    if (urls.length) report(urls.map(function (u) { try { return new URL(u, location.href).href; } catch (e) { return ''; } }), 'frame');
  }
  var t = null;
  try {
    new MutationObserver(function () { if (!t) t = setTimeout(function () { t = null; scanFrames(); }, 800); })
      .observe(document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ['src', 'data'] });
  } catch (e) {}
  scanFrames();
})();
