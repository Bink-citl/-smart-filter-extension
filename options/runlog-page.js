/* runlog-page.js v2.4.0：设置 · 运行记录
 * 从上到下只有三块，位置固定、不随内容跳动：
 *   1. 状态条：RPA 助手 + 4 个引擎，一行五格，每格只显示「名字 / 状态 / 一句话」
 *   2. 问题提示：当前时间范围里最多的失败原因 + 怎么处理（长说明只在这里出现一次，不再每行重复）
 *   3. 记录列表：结果页签带数量（全部 / 失败 / 让位 / 成功 / 状态变化），一行一条、单行不折行；
 *      连续相同的失败合并成一行并显示次数；点一行展开完整说明和处理建议；状态变化显示成分隔行
 */
(function () {
  'use strict';
  function $(id) { return document.getElementById(id); }
  var L = window.HRSRunLog;
  if (!L || !$('p-runlog')) return;
  var STALE = 60000;   // 超过 60 秒没收到页面心跳，就当页面已经不在跑
  var SITE_NAME = { boss: 'Boss', liepin: '猎聘' };
  var PAGE = 200;
  var data = { log: [], status: {}, rpa: null, shown: PAGE, res: '', range: 'today', open: {}, seen: 0 };

  // 每类失败怎么处理，以及能直接跳去的设置项
  var FIX = {
    rpa_off: { tip: '打开插件文件夹里的 rpa-helper 文件夹，在资源管理器地址栏输入 cmd /k py install_autostart.py 回车（没有 py 就换成 python）。只做一次，以后开机自动在后台运行。', go: 'rpa', goText: '去 RPA 连接' },
    covered: { tip: '运行时让 Boss / 猎聘窗口保持在最前面，不要被其他窗口挡住，也不要最小化。', go: 'rpa', goText: '去 RPA 连接' },
    miss: { tip: '运行中改过显示器缩放或浏览器缩放会点偏。把浏览器缩放调回 100%，重新开始。', go: 'rpa', goText: '去 RPA 连接' },
    verify: { tip: '到对应平台页面手动完成验证，再重新开启。经常出现时把操作节奏调成「稳妥」。', go: 'rhythm', goText: '去操作节奏' },
    limit: { tip: '平台今天给的次数用完了。明天再跑，或调低每日上限。' },
    gone: { tip: '平台页面可能改版或没加载完。先刷新页面重试，一直出现就修复选择器。', go: 'sel', goText: '去选择器与诊断' },
    nofocus: { tip: '运行时不要点其他输入框，窗口保持在最前面。', go: 'rpa', goText: '去 RPA 连接' },
    unverified: { tip: '动作做了但没看到预期变化，一般会自动重试。连续出现时刷新平台页面。' },
    user: { tip: '你在用电脑时会自动让位，停手几秒后继续，不用处理。' },
    locked: { tip: '屏幕锁定时不能操作，解锁后自动继续。' },
    busy: { tip: '同时有多个平台页面在跑，会轮流使用鼠标，不用处理。' },
    other: { tip: '展开记录看原始说明。' }
  };
  var ICO = {
    ok: '<svg viewBox="0 0 24 24"><path d="M7 12.5l3.2 3.2L17 9"/></svg>',
    bang: '<svg viewBox="0 0 24 24"><path d="M12 7v6.5"/><path d="M12 16.8v.2"/></svg>'
  };
  var RANGE_TEXT = { '1h': '近 1 小时', today: '今天', '7d': '近 7 天' };

  function esc(x) { return String(x == null ? '' : x).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function tm(t) { var d = new Date(t); return pad(d.getHours()) + ':' + pad(d.getMinutes()) + ':' + pad(d.getSeconds()); }
  function dt(t) { var d = new Date(t); return (d.getMonth() + 1) + '/' + d.getDate() + ' ' + tm(t); }
  function dayKey(t) { var d = new Date(t); return d.getFullYear() + '-' + (d.getMonth() + 1) + '-' + d.getDate(); }
  function dayLabel(t) {
    var d = new Date(t), t0 = dayStart();
    var w = '日一二三四五六'.charAt(d.getDay());
    var pre = t >= t0 ? '今天 · ' : (t >= t0 - 86400000 ? '昨天 · ' : '');
    return pre + (d.getMonth() + 1) + '月' + d.getDate() + '日 周' + w;
  }
  function ago(t) {
    var s = Math.max(0, Math.round((Date.now() - t) / 1000));
    if (s < 60) return s + ' 秒前';
    if (s < 3600) return Math.floor(s / 60) + ' 分钟前';
    if (s < 86400) return Math.floor(s / 3600) + ' 小时前';
    return Math.floor(s / 86400) + ' 天前';
  }
  function dayStart() { var d = new Date(); d.setHours(0, 0, 0, 0); return d.getTime(); }
  function onPage() { return window.HRSSettings ? HRSSettings.isActive('runlog') : false; }
  function kind(e) { return e.act === '状态' ? 'state' : (e.ok === true ? 'ok' : (e.ok === 'wait' ? 'wait' : 'fail')); }
  function goSet(k) { if (window.HRSSettings) HRSSettings.go(k); }

  // ---------- 读数据 ----------
  function load() {
    chrome.storage.local.get(['runLog', 'runStatus'], function (o) {
      data.log = o.runLog || [];
      data.status = o.runStatus || {};
      if (!data.seen) data.seen = lastT();
      fillOptions();
      render();
    });
  }
  function lastT() { return data.log.length ? data.log[data.log.length - 1].t : 0; }
  function pingRpa() {
    chrome.storage.local.get('settings', function (o) {
      var s = o.settings || {};
      if (s.bossExec === 'script') { data.rpa = { off: true, at: Date.now() }; done(); return; }
      chrome.runtime.sendMessage({ type: 'RPA_PING' }, function (r) {
        void chrome.runtime.lastError;
        data.rpa = r || { ok: false, why: '插件后台没回应' };
        data.rpa.at = Date.now();
        done();
      });
    });
    function done() { if (window.HRSSettingsRpa) HRSSettingsRpa(data.rpa); renderStatus(); renderAlert(); }
  }

  // ---------- 1. 状态条 ----------
  function engineState(e) {
    var v = data.status[e.key];
    if (!v) return { state: 'never', label: '未启动', text: '打开对应平台页面后出现', at: 0 };
    if (v.state !== 'stopped' && Date.now() - v.at > STALE) return { state: 'stopped', label: L.STATE_LABEL.stopped, text: '页面已关闭或离开', at: v.at };
    var text = v.text || '';
    if (v.state === 'resting' && v.until > Date.now()) text = text.replace(/约 \d+ 秒/, '约 ' + Math.ceil((v.until - Date.now()) / 1000) + ' 秒');
    return { state: v.state, label: L.STATE_LABEL[v.state] || v.state, text: text, at: v.at };
  }
  function cell(cls, name, label, text, at, attrs) {
    var full = text + (at ? ' · ' + at : '');
    return '<button type="button" class="rl-sc s-' + cls + '" ' + (attrs || '') + ' data-tip="' + esc(full) + '">' +
      '<span class="rl-sc-n">' + esc(name) + '</span>' +
      '<span class="rl-sc-s"><i></i>' + esc(label) + '</span>' +
      '<span class="rl-sc-t">' + esc(text || '—') + '</span>' +
      '<span class="rl-sc-a">' + esc(at || '') + '</span></button>';
  }
  function renderStatus() {
    var r = data.rpa;
    var rs = !r ? ['wait', '检测中', '正在检测本机 RPA 助手'] :
      (r.off ? ['never', '未使用', 'Boss 用脚本点击（旧版）'] :
      (r.ok ? ['running', '已连接', 'v' + r.version + (r.locked ? '，屏幕已锁定' : '') + (r.hook ? '' : '，输入钩子没装上')] : ['fail', '没连上', r.why || '']));
    var html = cell(rs[0], 'RPA 助手', rs[1], rs[2], r && r.at ? '检测于 ' + ago(r.at) : '', 'data-go="rpa"');
    html += L.ENGINES.map(function (e) {
      var s = engineState(e);
      return cell(s.state, e.name, s.label, s.text, s.at ? ago(s.at) : '', 'data-site="' + e.site + '" data-mod="' + esc(e.mod) + '"');
    }).join('');
    $('rlStatus').innerHTML = html;
  }
  $('rlStatus').addEventListener('click', function (e) {
    var c = e.target.closest('.rl-sc');
    if (!c) return;
    if (c.dataset.go) { goSet(c.dataset.go); return; }
    // 点引擎：只看这个模块的记录，再点一次取消
    var same = $('rlSite').value === c.dataset.site && $('rlMod').value === c.dataset.mod;
    $('rlSite').value = same ? '' : c.dataset.site;
    $('rlMod').value = same ? '' : c.dataset.mod;
    refilter();
  });

  // ---------- 2. 问题提示 ----------
  function inRange(e) {
    var from = data.range === '1h' ? Date.now() - 3600000 : (data.range === 'today' ? dayStart() : 0);
    return e.t >= from;
  }
  function renderAlert() {
    var box = $('rlAlert');
    var cats = {}, last = {}, fails = 0;
    data.log.forEach(function (e) {
      if (!inRange(e) || kind(e) !== 'fail') return;
      fails++;
      var c = e.cat || 'other';
      cats[c] = (cats[c] || 0) + 1;
      last[c] = Math.max(last[c] || 0, e.t);
    });
    if (!fails) {
      box.hidden = false;
      box.className = 'rl-alert a-ok';
      box.innerHTML = '<i class="rl-ai">' + ICO.ok + '</i><div class="rl-at"><b>' + RANGE_TEXT[data.range] + '没有失败</b></div>';
      return;
    }
    var keys = Object.keys(cats).sort(function (a, b) { return cats[b] - cats[a]; });
    var top = keys[0], fix = FIX[top] || FIX.other;
    var note = '';
    if (top === 'rpa_off' && data.rpa && data.rpa.ok && data.rpa.at > last[top]) note = '<span class="rl-fixed">RPA 助手现在已连接，这些是之前的失败，之后不再出现就不用处理</span>';
    var others = keys.slice(1).map(function (c) { return '<a href="#" data-cat="' + esc(c) + '">' + esc(L.catLabel(c)) + ' <b>' + cats[c] + '</b></a>'; }).join('');
    box.hidden = false;
    box.className = 'rl-alert a-fail' + (note ? ' a-soft' : '');
    box.innerHTML = '<i class="rl-ai">' + ICO.bang + '</i><div class="rl-at">' +
      '<div class="rl-at-h"><b>' + RANGE_TEXT[data.range] + '失败 ' + fails + ' 次</b><span>最多的是</span><a href="#" class="rl-top" data-cat="' + esc(top) + '">' + esc(L.catLabel(top)) + ' <b>' + cats[top] + '</b></a>' + (others ? '<span class="rl-oth">' + others + '</span>' : '') + '</div>' +
      '<div class="rl-at-t">' + note + '<span class="rl-fix">处理：' + esc(fix.tip) + '</span></div></div>' +
      '<div class="rl-aa">' + (fix.go ? '<button class="btn ghost sm" type="button" data-go="' + fix.go + '">' + esc(fix.goText) + '</button>' : '') +
      '<button class="btn ghost sm" type="button" data-cat="' + esc(top) + '">只看这类</button></div>';
  }
  $('rlAlert').addEventListener('click', function (e) {
    var a = e.target.closest('[data-cat],[data-go]');
    if (!a) return;
    e.preventDefault();
    if (a.dataset.go) { goSet(a.dataset.go); return; }
    $('rlCat').value = a.dataset.cat; data.res = 'fail';
    refilter();
  });

  // ---------- 筛选项 ----------
  function fillOptions() {
    var acts = {}, cats = {};
    data.log.forEach(function (e) { if (e.act !== '状态') acts[e.act] = 1; if (e.cat) cats[e.cat] = 1; });
    ['点击', '输入', '按键', '打开会话', '发消息', '已读', '索要简历', '切职位', '切列表', '打招呼', '休息', '验证', '提示'].forEach(function (a) { acts[a] = acts[a] || 0; });
    var sa = $('rlAct'), cur = sa.value;
    sa.innerHTML = '<option value="">全部动作</option>' + Object.keys(acts).map(function (a) { return '<option value="' + esc(a) + '">' + esc(a) + '</option>'; }).join('');
    sa.value = cur;
    var sc = $('rlCat'), cc = sc.value;
    Object.keys(L.CATS).forEach(function (c) { cats[c] = 1; });
    sc.innerHTML = '<option value="">全部原因</option>' + Object.keys(cats).map(function (c) { return '<option value="' + esc(c) + '">' + esc(L.catLabel(c)) + '</option>'; }).join('');
    sc.value = cc;
  }
  // 除了「结果」以外的筛选（页签上的数量按这个算）
  function baseFiltered() {
    var site = $('rlSite').value, mod = $('rlMod').value, act = $('rlAct').value, cat = $('rlCat').value;
    var q = $('rlQ').value.trim().toLowerCase();
    return data.log.filter(function (e) {
      if (!inRange(e)) return false;
      if (site && e.site !== site) return false;
      if (mod && e.mod !== mod) return false;
      if (act && e.act !== act) return false;
      if (cat && e.cat !== cat) return false;
      if (q && (String(e.target || '') + ' ' + (e.why || '') + ' ' + (e.detail || '')).toLowerCase().indexOf(q) < 0) return false;
      return true;
    });
  }
  function filtered() {
    var base = baseFiltered();
    return (data.res ? base.filter(function (e) { return kind(e) === data.res; }) : base).reverse();
  }
  function anyFilter() {
    return !!($('rlSite').value || $('rlMod').value || $('rlAct').value || $('rlCat').value || $('rlQ').value.trim() || data.res);
  }

  // ---------- 3. 页签 ----------
  function renderTabs(base) {
    var n = { '': 0, fail: 0, wait: 0, ok: 0, state: 0 };
    base.forEach(function (e) { n[kind(e)]++; if (kind(e) !== 'state') n['']++; });
    var tabs = [['', '全部'], ['fail', '失败'], ['wait', '让位等待'], ['ok', '成功'], ['state', '状态变化']];
    $('rlTabs').innerHTML = tabs.map(function (t) {
      var on = data.res === t[0];
      return '<button type="button" role="tab" aria-selected="' + on + '" class="rl-tab t-' + (t[0] || 'all') + (on ? ' on' : '') + (n[t[0]] ? '' : ' zero') + '" data-r="' + t[0] + '">' + t[1] + '<b>' + n[t[0]] + '</b></button>';
    }).join('');
  }
  $('rlTabs').addEventListener('click', function (e) {
    var b = e.target.closest('.rl-tab');
    if (!b) return;
    data.res = b.dataset.r;
    refilter();
  });

  // ---------- 列表 ----------
  // 连续相同的失败 / 让位合并：同平台、同模块、同动作、同原因、同说明，且相邻两条间隔不超过 10 分钟
  var MERGE_GAP = 600000;
  function group(rows) {
    var merge = $('rlMerge').checked, out = [];
    rows.forEach(function (e) {
      var k = kind(e);
      var key = (k === 'fail' || k === 'wait') ? [e.site, e.mod, e.act, k, e.cat, e.why].join('|') : '';
      var prev = out[out.length - 1];
      if (merge && key && prev && prev.key === key && prev.items[prev.items.length - 1].t - e.t <= MERGE_GAP) { prev.items.push(e); return; }
      out.push({ key: key, e: e, items: [e] });
    });
    return out;
  }
  function gid(g) { return g.e.t + '|' + g.e.act + '|' + (g.e.target || ''); }
  function srcCell(e) {
    var s = SITE_NAME[e.site];
    return '<span class="rl-src ' + (e.site || 'x') + '">' + (s ? esc(s) + '<i>·</i>' : '') + esc(e.mod || '—') + '</span>';
  }
  function resCell(k) {
    return '<span class="rl-res r-' + k + '">' + ({ ok: '成功', wait: '让位', fail: '失败' }[k]) + '</span>';
  }
  function rowHtml(g, showDate) {
    var e = g.e, k = kind(e), n = g.items.length;
    var t = showDate ? dt(e.t) : tm(e.t);
    if (k === 'state') {
      var st = { '运行中': 'running', '休息中': 'resting', '已停止': 'stopped' }[e.target] || 'stopped';
      return '<div class="rl-row is-state' + (e.t > data.seen ? ' is-new' : '') + '"><span class="rl-t">' + t + '</span><span>' + srcCell(e) + '</span>' +
        '<span class="rl-stline"><span class="rl-pill p-' + st + '"><i></i>' + esc(e.target) + '</span><span class="rl-d">' + esc(e.detail || '') + '</span></span></div>';
    }
    var id = gid(g), open = !!data.open[id];
    var why = k === 'ok' ? '<span class="rl-d">' + esc(e.detail || '') + '</span>' :
      '<b class="rl-why">' + esc(L.catLabel(e.cat)) + '</b><span class="rl-d">' + esc(e.why || e.detail || '') + '</span>';
    var hasMore = k !== 'ok' || (e.detail && e.detail.length > 30) || n > 1;
    var html = '<div class="rl-row r-' + k + (open ? ' open' : '') + (hasMore ? ' can-open' : '') + (e.t > data.seen ? ' is-new' : '') + '" data-id="' + esc(id) + '">' +
      '<span class="rl-t">' + t + '</span><span>' + srcCell(e) + '</span>' +
      '<span class="rl-a">' + esc(e.act) + (e.via === 'script' ? '<i class="rl-via" data-tip="脚本点击（不是真实鼠标）">脚本</i>' : '') + '</span>' +
      '<span class="rl-o" title="' + esc(e.target || '') + '">' + esc(e.target || '') + '</span>' +
      '<span>' + resCell(k) + (n > 1 ? '<em class="rl-x" data-tip="连续 ' + n + ' 次，首次 ' + tm(g.items[n - 1].t) + '">×' + n + '</em>' : '') + '</span>' +
      '<span class="rl-w">' + why + '</span>' +
      '<span class="rl-chev">' + (hasMore ? '<svg viewBox="0 0 24 24"><path d="m9 6 6 6-6 6"/></svg>' : '') + '</span></div>';
    if (open) html += detailHtml(g);
    return html;
  }
  function detailHtml(g) {
    var e = g.e, k = kind(e), n = g.items.length;
    var rows = [];
    if (n > 1) {
      var tg = {};
      g.items.forEach(function (x) { if (x.target) tg[x.target] = 1; });
      rows.push(['发生', '连续 ' + n + ' 次 · ' + dt(g.items[n - 1].t) + ' 到 ' + tm(e.t)]);
      if (Object.keys(tg).length > 1) rows.push(['对象', Object.keys(tg).join('、')]);
    } else rows.push(['时间', dt(e.t)]);
    if (e.why) rows.push(['原始说明', e.why]);
    if (e.detail && e.detail !== e.why) rows.push(['说明', e.detail]);
    if (e.code) rows.push(['错误代码', e.code]);
    if (e.via) rows.push(['执行方式', e.via === 'script' ? '脚本点击' : 'RPA 真实鼠标键盘']);
    var fix = k !== 'ok' ? (FIX[e.cat] || FIX.other) : null;
    return '<div class="rl-det">' + rows.map(function (r) { return '<div class="rl-kv"><span>' + r[0] + '</span><div>' + esc(r[1]) + '</div></div>'; }).join('') +
      (fix ? '<div class="rl-kv fix"><span>怎么处理</span><div>' + esc(fix.tip) + (fix.go ? ' <a href="#" data-go="' + fix.go + '">' + esc(fix.goText) + ' ›</a>' : '') + '</div></div>' : '') + '</div>';
  }
  function renderTable() {
    var base = baseFiltered();
    renderTabs(base);
    var rows = filtered();
    var groups = group(rows);
    var show = groups.slice(0, data.shown);
    var multiDay = data.range === '7d';
    var lastDay = '', html = '';
    show.forEach(function (g) {
      if (multiDay) {
        var dk = dayKey(g.e.t);
        if (dk !== lastDay) { html += '<div class="rl-day">' + dayLabel(g.e.t) + '</div>'; lastDay = dk; }
      }
      html += rowHtml(g, false);
    });
    if (!html) {
      // v3.0.0 空状态：插画 + 一句说明 + 下一步
      var E = window.HRSEmpty;
      html = '<div class="rl-empty">' + (!E ? (data.log.length ? '没有符合条件的记录' : '还没有记录') : data.log.length
        ? E.html('filter', { title: '没有符合条件的记录', text: anyFilter() ? '换个条件，或者<a href="#" data-reset>清除筛选</a>' : '换个时间范围看看' })
        : E.html('runlog', { title: '还没有运行记录', text: '打开 BOSS / 猎聘页面，开启智选或打招呼后，每一个动作的结果和失败原因都会出现在这里',
          actions: [{ label: '打开 BOSS 推荐牛人', go: 'https://www.zhipin.com/web/chat/recommend' }, { label: '打开 BOSS 沟通页', go: 'https://www.zhipin.com/web/chat/index' }] })) + '</div>';
    }
    $('rlBody').innerHTML = html;
    var merged = rows.length - groups.length;
    $('rlCount').textContent = rows.length + ' 条' + (merged > 0 ? '（合并后 ' + groups.length + ' 行）' : '') + (groups.length > show.length ? '，先显示最新 ' + show.length + ' 行' : '');
    $('rlMore').hidden = groups.length <= show.length;
    $('rlReset').hidden = !anyFilter();
    // 已经看过的不再闪
    setTimeout(function () { data.seen = Math.max(data.seen, lastT()); }, 1500);
  }
  $('rlBody').addEventListener('click', function (e) {
    var a = e.target.closest('a[data-go],a[data-reset]');
    if (a) { e.preventDefault(); if (a.dataset.go) goSet(a.dataset.go); else resetFilters(); return; }
    if (e.target.closest('.rl-det')) return;
    var row = e.target.closest('.rl-row.can-open');
    if (!row) return;
    var id = row.dataset.id;
    if (data.open[id]) delete data.open[id]; else data.open[id] = 1;
    renderTable();
  });

  function render() {
    renderStatus();
    renderAlert();
    renderTable();
  }
  function refilter() { data.shown = PAGE; renderTable(); }
  function resetFilters() {
    ['rlSite', 'rlMod', 'rlAct', 'rlCat'].forEach(function (id) { $(id).value = ''; });
    $('rlQ').value = ''; data.res = '';
    refilter();
  }

  // ---------- 操作 ----------
  ['rlSite', 'rlMod', 'rlAct', 'rlCat', 'rlMerge'].forEach(function (id) { $(id).addEventListener('change', refilter); });
  $('rlQ').addEventListener('input', refilter);
  $('rlReset').addEventListener('click', function (e) { e.preventDefault(); resetFilters(); });
  $('rlRange').addEventListener('click', function (e) {
    var b = e.target.closest('button[data-v]');
    if (!b) return;
    data.range = b.dataset.v;
    Array.prototype.forEach.call($('rlRange').children, function (x) { x.classList.toggle('on', x === b); });
    renderAlert(); refilter();
  });
  $('rlMore').addEventListener('click', function () { data.shown += PAGE; renderTable(); });
  $('rlClear').addEventListener('click', function () {
    if (!confirm('清空全部运行记录？（不影响人才库和今日进度）')) return;
    chrome.runtime.sendMessage({ type: 'RUNLOG_CLEAR' }, function () { void chrome.runtime.lastError; if (window.HRSOpt) HRSOpt.toast('[完成] 运行记录已清空'); load(); });
  });
  $('rlExport').addEventListener('click', function () {
    var rows = filtered();
    if (!rows.length) { if (window.HRSNotify) HRSNotify.warn('当前筛选下没有记录可导出'); return; }
    var head = ['时间', '平台', '模块', '动作', '对象', '结果', '原因', '说明', '方式'];
    var csv = [head].concat(rows.map(function (e) {
      return [dt(e.t), SITE_NAME[e.site] || '', e.mod || '', e.act, e.target || '', e.act === '状态' ? e.target : (e.ok === true ? '成功' : (e.ok === 'wait' ? '让位等待' : '失败')),
        e.ok === true ? '' : L.catLabel(e.cat), (e.why || '') + (e.detail && e.detail !== e.why ? ' ' + e.detail : ''), e.via === 'script' ? '脚本' : (e.via === 'rpa' ? 'RPA' : '')];
    })).map(function (r) { return r.map(function (c) { c = String(c == null ? '' : c); return /[",\n]/.test(c) ? '"' + c.replace(/"/g, '""') + '"' : c; }).join(','); }).join('\r\n');
    var blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' });
    var d = new Date();
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'smartfilter-runlog-' + d.getFullYear() + pad(d.getMonth() + 1) + pad(d.getDate()) + '-' + pad(d.getHours()) + pad(d.getMinutes()) + '.csv';
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 5000);
  });

  // 自动刷新：记录 / 状态一变就重画；倒计时和「x 秒前」每秒更新
  chrome.storage.onChanged.addListener(function (ch, area) {
    if (area !== 'local') return;
    if (ch.runLog) data.log = ch.runLog.newValue || [];
    if (ch.runStatus) data.status = ch.runStatus.newValue || {};
    if (!onPage()) return;
    if (ch.runLog) { fillOptions(); renderAlert(); renderTable(); }
    if (ch.runStatus) renderStatus();
  });
  setInterval(function () { if (onPage()) renderStatus(); }, 1000);
  setInterval(function () { if (onPage()) pingRpa(); }, 30000);
  // 切到本页时立即刷新一次（含 RPA 检测）
  var wasOn = false;
  function check() {
    var on = onPage();
    if (on && !wasOn) { chrome.runtime.sendMessage({ type: 'RUNLOG_FLUSH' }, function () { void chrome.runtime.lastError; }); load(); pingRpa(); }
    wasOn = on;
  }
  new MutationObserver(function () { setTimeout(check, 0); }).observe($('p-debug'), { attributes: true, attributeFilter: ['class'] });
  document.addEventListener('hrs-set-sec', function () { setTimeout(check, 0); });
  load();
  pingRpa();   // 导航上的 RPA 状态点也要用
  check();
})();
