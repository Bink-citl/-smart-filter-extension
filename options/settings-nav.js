/* settings-nav.js v2.4.0：设置页的左侧分组导航
 * - 左：按模块分组的设置项列表（运行监控 / 执行方式 / 数据与维护 / 规则与诊断），分组可折叠，整栏可收起成图标栏
 * - 右：一次只显示一个设置项，不再整页长滚动
 * - 顶部可搜索设置项；记住上次打开的设置项、折叠的分组和侧栏收起状态
 * - 其他模块用 HRSSettings.go('rpa') 之类直接跳到某个设置项
 */
(function () {
  'use strict';
  function $(id) { return document.getElementById(id); }
  var panel = $('p-debug'), nav = $('setNav'), main = $('setMain'), layout = $('setLayout');
  if (!panel || !nav || !main) return;
  var store = {
    get: function (k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
    set: function (k, v) { try { localStorage.setItem(k, v); } catch (e) {} }
  };
  var items = Array.prototype.slice.call(nav.querySelectorAll('.set-i'));
  var groups = Array.prototype.slice.call(nav.querySelectorAll('.set-g'));
  var secs = Array.prototype.slice.call(main.querySelectorAll('.set-sec'));
  var ids = items.map(function (it) { return it.dataset.sec; });
  var cur = store.get('hrsSetSec');
  if (ids.indexOf(cur) < 0) cur = ids[0];

  function itemOf(k) { return items.filter(function (it) { return it.dataset.sec === k; })[0]; }
  function labelOf(k) { var it = itemOf(k); return it ? it.querySelector('span').textContent : ''; }
  function visible() { return panel.classList.contains('on'); }

  function paint() {
    items.forEach(function (it) { it.classList.toggle('cur', it.dataset.sec === cur); it.setAttribute('aria-current', it.dataset.sec === cur ? 'page' : 'false'); });
    secs.forEach(function (s) { s.classList.toggle('on', s.dataset.sec === cur); });
    // 当前项所在分组一定展开
    var it = itemOf(cur), g = it && it.closest('.set-g');
    if (g && !g.classList.contains('open')) { g.classList.add('open'); saveGroups(); }
    groups.forEach(function (x) { x.classList.toggle('has-cur', x === g); });
    if (visible() && window.HRSShell && HRSShell.setSub) HRSShell.setSub(labelOf(cur));
  }
  /** 跳到某个设置项。opts.noScroll：不滚回顶部 */
  function go(k, opts) {
    if (ids.indexOf(k) < 0) return;
    var changed = k !== cur;
    cur = k;
    store.set('hrsSetSec', k);
    // 抽屉里借走的卡片（例如 RPA 连接）先放回原处
    if (window.HRSShell && HRSShell.closeCfg) HRSShell.closeCfg();
    if (!visible()) {
      var tab = document.querySelector('.hrs-side .tab[data-t="debug"]');
      if (tab) tab.click();
    }
    paint();
    if (changed && !(opts && opts.noScroll)) window.scrollTo(0, 0);
    document.dispatchEvent(new CustomEvent('hrs-set-sec', { detail: { sec: k } }));
  }
  items.forEach(function (it) {
    it.addEventListener('click', function (e) { e.preventDefault(); go(it.dataset.sec); });
  });

  // ---------- 分组折叠 ----------
  function saveGroups() {
    store.set('hrsSetFold', groups.filter(function (g) { return !g.classList.contains('open'); }).map(function (g) { return g.dataset.g; }).join(','));
  }
  (store.get('hrsSetFold') || '').split(',').forEach(function (k) {
    var g = nav.querySelector('.set-g[data-g="' + k + '"]');
    if (g) g.classList.remove('open');
  });
  groups.forEach(function (g) {
    g.querySelector('.set-gh').addEventListener('click', function () {
      if (findBox.value.trim()) return;      // 搜索时分组固定展开
      g.classList.toggle('open');
      saveGroups();
    });
  });

  // ---------- 侧栏收起成图标栏 ----------
  var fold = $('setFold');
  function setMini(on) {
    layout.classList.toggle('set-mini', on);
    store.set('hrsSetMini', on ? '1' : '');
    fold.setAttribute('data-tip', on ? '展开侧栏' : '收起侧栏');
    fold.setAttribute('aria-label', on ? '展开侧栏' : '收起侧栏');
    // 收起时鼠标悬停显示名字
    items.forEach(function (it) {
      if (on) it.setAttribute('data-tip', it.querySelector('span').textContent); else it.removeAttribute('data-tip');
    });
  }
  fold.addEventListener('click', function () { setMini(!layout.classList.contains('set-mini')); });
  var m0 = store.get('hrsSetMini');
  setMini(m0 === '1' || (m0 == null && window.innerWidth < 1200));   // 窄屏第一次进来默认收起

  // ---------- 搜索设置项 ----------
  var findBox = $('setFind');
  function filter() {
    var q = findBox.value.trim().toLowerCase();
    nav.classList.toggle('searching', !!q);
    var any = false;
    groups.forEach(function (g) {
      var hit = 0;
      Array.prototype.forEach.call(g.querySelectorAll('.set-i'), function (it) {
        var t = (it.textContent + ' ' + (it.dataset.kw || '')).toLowerCase();
        var ok = !q || t.indexOf(q) >= 0;
        it.hidden = !ok;
        if (ok) hit++;
      });
      g.hidden = !hit;
      if (hit) any = true;
    });
    $('setNone').hidden = any;
  }
  findBox.addEventListener('input', filter);
  findBox.addEventListener('keydown', function (e) {
    if (e.key === 'Enter') { var f = items.filter(function (it) { return !it.hidden && !it.closest('.set-g').hidden; })[0]; if (f) go(f.dataset.sec); }
    if (e.key === 'Escape') { findBox.value = ''; filter(); }
  });

  // ---------- 进入设置页时刷新标题 ----------
  // 抽屉里借走的卡片（例如顶栏点开的 RPA 连接）放回设置页
  new MutationObserver(function () { if (visible()) { if (window.HRSShell && HRSShell.closeCfg) HRSShell.closeCfg(); setTimeout(paint, 0); } }).observe(panel, { attributes: true, attributeFilter: ['class'] });

  // ---------- 导航上的状态：运行记录今天失败数、RPA 连接状态 ----------
  function dayStart() { var d = new Date(); d.setHours(0, 0, 0, 0); return d.getTime(); }
  function paintFail(log) {
    var t0 = dayStart(), n = 0;
    (log || []).forEach(function (e) { if (e.t >= t0 && e.act !== '状态' && e.ok === false) n++; });
    var b = $('sbRunlog');
    b.hidden = !n;
    b.textContent = n > 99 ? '99+' : String(n);
    b.setAttribute('title', '今天失败 ' + n + ' 次');
  }
  chrome.storage.local.get('runLog', function (o) { paintFail(o.runLog); });
  chrome.storage.onChanged.addListener(function (ch, area) { if (area === 'local' && ch.runLog) paintFail(ch.runLog.newValue); });
  window.HRSSettingsRpa = function (r) {   // runlog-page / 本文件检测 RPA 后调用
    var d = $('sbRpa');
    if (!d) return;
    d.className = 'set-dot ' + (!r ? '' : r.off ? 'off' : r.ok ? 'ok' : 'bad');
    d.setAttribute('title', !r ? '检测中' : r.off ? 'Boss 用脚本点击（旧版）' : r.ok ? 'RPA 助手已连接' : 'RPA 助手没连上');
  };

  // ---------- 链接直达：options.html#set=runlog ----------
  function fromHash() {
    var m = location.hash.match(/set=([a-z]+)/);
    if (m && ids.indexOf(m[1]) >= 0) { go(m[1]); return true; }
    return false;
  }
  window.addEventListener('hashchange', fromHash);

  window.HRSSettings = {
    go: go,
    current: function () { return cur; },
    isActive: function (k) { return visible() && cur === k; }
  };
  paint();
  // 等外壳把首页选好再处理 #set=
  setTimeout(fromHash, 50);
})();
