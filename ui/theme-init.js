/* theme-init.js v2.9.0：工作台 / 报表 / 弹窗的浅色、深色
 * - 放在 <head> 最前面同步执行，页面画出来之前就把 <html data-theme> 设好，不会先白后黑闪一下
 * - 设置存在 chrome.storage.local 的 uiTheme：system（跟随系统，默认）/ light / dark
 *   本页 localStorage 里存一份副本，开页时先用副本，再和 chrome.storage 对一次
 * - 别的页面改了设置（例如在工作台切到深色），已打开的报表、弹窗、BOSS 浮层同时跟着变
 * - window.HRSTheme：get / set / resolved / tok（读当前令牌值，给图表用）/ onChange
 */
(function () {
  'use strict';
  if (window.HRSTheme) return;
  var KEY = 'hrsTheme';
  var root = document.documentElement;
  var listeners = [];
  var mq = null;
  try { mq = window.matchMedia('(prefers-color-scheme: dark)'); } catch (e) {}
  function norm(m) { return m === 'light' || m === 'dark' ? m : 'system'; }
  var mode = 'system';
  try { mode = norm(localStorage.getItem(KEY)); } catch (e) {}
  function resolved() { return mode === 'system' ? (mq && mq.matches ? 'dark' : 'light') : mode; }
  var last = '';
  function paint() {
    var r = resolved();
    root.setAttribute('data-theme', r);
    root.setAttribute('data-theme-mode', mode);
    if (r === last) return;
    var first = !last;
    last = r;
    if (!first) listeners.forEach(function (fn) { try { fn(r, mode); } catch (e) {} });
  }
  function apply(m, fromStore) {
    mode = norm(m);
    try { localStorage.setItem(KEY, mode); } catch (e) {}
    paint();
    if (!fromStore) { try { chrome.storage.local.set({ uiTheme: mode }); } catch (e) {} }
    try { document.dispatchEvent(new CustomEvent('hrs-theme-mode', { detail: { mode: mode, theme: resolved() } })); } catch (e) {}
  }
  paint();
  if (mq) { try { mq.addEventListener('change', paint); } catch (e) {} }
  try {
    chrome.storage.local.get('uiTheme', function (o) { if (o && norm(o.uiTheme) !== mode) apply(o.uiTheme, true); });
    chrome.storage.onChanged.addListener(function (ch, area) { if (area === 'local' && ch.uiTheme) apply(ch.uiTheme.newValue, true); });
  } catch (e) {}

  window.HRSTheme = {
    get: function () { return mode; },
    set: function (m) { apply(m, false); },
    resolved: resolved,
    /** 读令牌当前值，例如 tok('--chart-1') → '#0B3A6E'（深色时是深色值） */
    tok: function (name) {
      try { return getComputedStyle(root).getPropertyValue(name).trim(); } catch (e) { return ''; }
    },
    onChange: function (fn) { listeners.push(fn); }
  };
})();
