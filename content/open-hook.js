/**
 * open-hook.js v1.9.7（运行在页面自己的环境里，只在猎聘加载）
 * 猎聘「预览」是脚本 window.open 打开新标签页，插件的脚本点击会被浏览器的弹窗拦截挡掉。
 * 抓职位时插件在页面上打个标记（html[data-hrs-catch-open]），这期间页面要打开的新标签地址
 * 不直接打开，而是交给插件，由插件后台打开（后台打开不受弹窗拦截）。没有标记时一切照旧。
 */
(function () {
  'use strict';
  if (window.__HRS_OPEN_HOOK__) return;
  window.__HRS_OPEN_HOOK__ = true;
  function catching() { try { return document.documentElement.hasAttribute('data-hrs-catch-open'); } catch (e) { return false; } }
  function post(url) {
    try { url = new URL(String(url), location.href).href; } catch (e) { return; }
    if (!/^https?:/i.test(url)) return;
    window.postMessage({ __hrs_open__: true, url: url }, '*');
  }
  var origOpen = window.open;
  window.open = function (url) {
    if (!catching()) return origOpen.apply(this, arguments);
    if (url && String(url) !== 'about:blank') post(url);
    // 有的页面先 open('') 再给新窗口设地址：返回一个假窗口，把设的地址也接住
    var loc = { assign: post, replace: post, toString: function () { return ''; } };
    Object.defineProperty(loc, 'href', { set: post, get: function () { return ''; } });
    var fake = { closed: false, opener: null, close: function () {}, focus: function () {}, blur: function () {}, postMessage: function () {}, document: { write: function () {}, close: function () {}, open: function () {} } };
    Object.defineProperty(fake, 'location', { set: post, get: function () { return loc; } });
    return fake;
  };
  // 新标签链接（<a target="_blank">）被点击时也接住
  function anchorUrl(a) { return a && a.href && /_blank/i.test(a.target || '') ? a.href : ''; }
  document.addEventListener('click', function (e) {
    if (!catching()) return;
    var a = e.target && e.target.closest ? e.target.closest('a[href]') : null;
    var u = anchorUrl(a);
    if (!u) return;
    e.preventDefault();
    post(u);
  }, true);
  var origClick = HTMLAnchorElement.prototype.click;
  HTMLAnchorElement.prototype.click = function () {
    if (catching() && !this.isConnected && anchorUrl(this)) { post(this.href); return; }
    return origClick.apply(this, arguments);
  };
})();
