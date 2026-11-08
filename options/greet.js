/* greet.js v1.6.0：设置页「打招呼」标签 + 岗位JD页「从平台抓取职位」 */
(function () {
  'use strict';
  function $(id) { return document.getElementById(id); }
  var O = window.HRSOpt, P = window.HRSPlan;
  var jds = [], settings = {}, glog = {}, fetched = { boss: [], liepin: [] };

  function today() { return glog && glog.date === P.localDate() ? glog : { total: 0, counts: {} }; }
  function saveJds(msg) {
    return HRSStore.saveJds(jds).then(function () { O.toast('[完成] ' + msg); renderTable(); }).catch(O.fail('保存'));
  }

  // ---------------- 运行设置 ----------------
  function paintMode(m) { document.querySelectorAll('#greetSeg button').forEach(function (b) { b.classList.toggle('on', b.dataset.m === m); }); }
  document.querySelectorAll('#greetSeg button').forEach(function (b) {
    b.addEventListener('click', function () {
      if (b.dataset.m === 'live' && !confirm('正式运行会在 Boss 推荐牛人页自动点「打招呼」。确认已用试运行核对过判定？')) return;
      paintMode(b.dataset.m);
      O.save({ greetMode: b.dataset.m }, '打招呼：' + b.textContent);
    });
  });
  $('greetPaceSec').addEventListener('change', function () {
    var n = Math.min(600, Math.max(10, parseInt(this.value, 10) || 45)); this.value = n;
    O.save({ greetPaceSec: n }, '打招呼节拍 ' + n + ' 秒/个');
  });
  $('greetTrustedClick').addEventListener('change', function () {
    O.save({ greetTrustedClick: this.checked }, this.checked ? '已开启真实鼠标点击' : '已关闭真实鼠标点击');
  });
  $('greetMsgDefault').addEventListener('change', function () {
    O.save({ greetMsgDefault: this.value.trim() }, '默认打招呼语已保存');
  });
  $('greetPlatformFilter').addEventListener('change', function () {
    O.save({ greetPlatformFilter: this.checked }, this.checked ? '已开启平台初筛' : '已关闭平台初筛');
  });
  // v3.6.0 默认 180。超过 180 照样能存，只提示一句
  var CAP = 180;
  function capWarn(n) { var w = $('greetCapWarn'); if (w) w.hidden = !(n > CAP); }
  $('greetDailyCap').addEventListener('input', function () { capWarn(parseInt(this.value, 10) || 0); });
  $('greetDailyCap').addEventListener('change', function () {
    var n = Math.min(500, Math.max(1, parseInt(this.value, 10) || CAP)); this.value = n;
    capWarn(n);
    O.save({ greetDailyCap: n }, '每日总上限 ' + n + (n > CAP ? '（超过建议值 180）' : ''));
  });

  // ---------------- 岗位表（岗位和条件来自「岗位管理」，这里只管开关、推荐页职位名、上限） ----------------
  window.HRSGreetRender = function () { try { renderTable(); } catch (e) {} };
  function renderTable() {
    var T = today();
    $('greetToday').textContent = '今天已打 ' + (T.total || 0) + ' 个。';
    var allOn = jds.length && jds.every(function (j) { return (j.greet || {}).enabled; });
    var h = '<tr><th style="width:80px;"><label class="chk" style="font-size:var(--fs-sm);"><input type="checkbox" data-a="all"' + (allOn ? ' checked' : '') + '> 全选</label></th><th>岗位</th><th style="width:170px;">推荐页职位名</th><th>打招呼语</th>' +
      '<th style="width:70px;text-align:center;">简历详情</th><th style="width:90px;text-align:center;">Boss 上限</th><th style="width:90px;text-align:center;">猎聘上限</th><th style="width:70px;">今日</th></tr>';
    if (!jds.length) h += '<tr><td colspan="8" style="color:var(--muted);">还没有岗位，先到「岗位管理」抓取或新建。</td></tr>';
    // v1.9.28 开了打招呼的排前面，没开的放在一起、置灰
    var ordered = P.sortBy(jds, settings.greetOrder);
    ordered = ordered.filter(function (j) { return (j.greet || {}).enabled; }).concat(ordered.filter(function (j) { return !(j.greet || {}).enabled; }));
    ordered.forEach(function (j) {
      var g = j.greet || {}, d = (T.counts || {})[j.id] || 0;
      var r = P.rulesOf(j, jds, 'greet');
      var n = r.hardRequirements.length + (r.requireChip ? 1 : 0);
      var qb = P.quotaOf(j, 'boss', 'Greet'), ql = P.quotaOf(j, 'liepin', 'Greet');
      h += '<tr data-id="' + O.esc(j.id) + '"' + (g.enabled ? '' : ' data-off="1" style="opacity:.45;"') + '>' +
        '<td><input type="checkbox" data-a="on"' + (g.enabled ? ' checked' : '') + '></td>' +
        '<td><span class="ttl">' + O.esc(j.title) + '</span>' + (O.srcTag ? O.srcTag(j) : '') + '<span class="pj">' + (n ? n + ' 条要求' : '没有条件，推荐里每个人都会打') + (g.same === false ? ' · 单独一套' : ' · 同智选') + '</span></td>' +
        '<td><input type="text" data-a="gj" value="' + O.esc(j.greetJob || '') + '" placeholder="如：人事主管 _ 上海" style="width:100%;"></td>' +
        '<td><input type="text" data-a="msg" value="' + O.esc(g.msg || '') + '" placeholder="留空用默认打招呼语" style="width:100%;"></td>' +
        '<td style="text-align:center;"><input type="checkbox" data-a="dt"' + ((j.detail || {}).greet ? ' checked' : '') + ' title="勾上后卡片只判基础条件，关键词点开完整简历打分"></td>' +
        '<td style="text-align:center;">' + O.qCell(j, 'boss', 'bossGreet', qb || '', 'gq') + '</td>' +
        '<td style="text-align:center;">' + O.qCell(j, 'liepin', 'liepinGreet', ql || '', 'gq') + '</td>' +
        '<td>' + d + '/' + (P.onSite(j, 'boss') ? (qb || '不限') : 0) + '</td></tr>';
    });
    $('greetTable').innerHTML = h;
    // v2.6.0 和岗位列表、智选共用一套排序（开着同步时三处一起变）
    if (O.dragSort) O.dragSort($('greetTable'), function (ids, moved) {
      if (O.reorder) O.reorder('greet', ids, moved);
      else { settings.greetOrder = ids; O.save({ greetOrder: ids }, '打招呼岗位顺序已保存，排在前面的先打'); }
    });
  }
  $('greetTable').addEventListener('change', function (e) {
    var a = e.target.getAttribute('data-a'), tr = e.target.closest('tr[data-id]');
    if (a === 'all') {
      var on = e.target.checked;
      var empty = jds.filter(function (x) { var r = P.rulesOf(x, jds, 'greet'); return !r.hardRequirements.length && !r.requireChip; });
      if (on && empty.length && !confirm('有 ' + empty.length + ' 个岗位没有任何条件（' + empty.map(function (x) { return x.title; }).join('、') + '），开启后推荐里每个人都会打招呼。这些岗位跳过不开？\n确定 = 跳过它们，取消 = 也一起开')) empty = [];
      else if (!on) empty = [];
      jds.forEach(function (x) { x.greet = x.greet || {}; x.greet.enabled = on && empty.indexOf(x) < 0; });
      saveJds(on ? '已开启打招呼' + (empty.length ? '（跳过 ' + empty.length + ' 个没有条件的岗位）' : '') : '已全部关闭打招呼');
      return;
    }
    var j = tr && jds.find(function (x) { return x.id === tr.dataset.id; });
    if (!j || !a) return;
    j.greet = j.greet || {};
    if (a === 'on') {
      var r = P.rulesOf(j, jds, 'greet');
      if (e.target.checked && !r.hardRequirements.length && !r.requireChip && !confirm('「' + j.title + '」没有任何条件，推荐里每个人都会打招呼。确定开启？')) { e.target.checked = false; return; }
      j.greet.enabled = e.target.checked;
    }
    var k = e.target.getAttribute('data-k');
    if (a === 'gq') { var nq = parseInt(e.target.value, 10); j.quota = j.quota || {}; j.quota[k] = isFinite(nq) && nq > 0 ? Math.min(999, nq) : 0; if (k === 'bossGreet') j.greet.quota = j.quota[k]; }
    if (a === 'gj') j.greetJob = e.target.value.trim();
    if (a === 'dt') { j.detail = j.detail || {}; j.detail.greet = e.target.checked; return saveJds(j.title + (e.target.checked ? ' 打招呼改为看简历详情打分' : ' 打招呼不看简历详情')); }
    if (a === 'msg') j.greet.msg = e.target.value.trim();
    saveJds(j.title + (a === 'on' ? (j.greet.enabled ? ' 已开启打招呼' : ' 已关闭打招呼') : (a === 'gj' ? ' 推荐页职位名已保存' : a === 'msg' ? ' 打招呼语已保存' : ' ' + (k === 'bossGreet' ? 'Boss' : '猎聘') + ' 打招呼上限 ' + (j.quota[k] || '不限'))));
  });

  // ---------------- 抓取职位 ----------------
  function renderFetch() {
    var b = (fetched.boss || []).length, l = (fetched.liepin || []).length;
    var at = fetched.at ? '，' + new Date(fetched.at).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }) : '';
    $('fetchCount').textContent = (b || l) ? '已抓：Boss ' + b + ' 个，猎聘 ' + l + ' 个' + at : '';
  }
  // 第 1 步：打开（或切到）平台页面，进入「职位管理」列表后自动开始抓
  $('btnFetchGo').addEventListener('click', function () {
    var site = $('fetchSite').value;
    var home = site === 'boss' ? 'https://www.zhipin.com/web/chat/index' : 'https://www.liepin.com/';
    var pat = site === 'boss' ? ['https://www.zhipin.com/*', 'https://*.zhipin.com/*'] : ['https://www.liepin.com/*', 'https://*.liepin.com/*'];
    chrome.storage.local.set({ autoFetch: { site: site, until: Date.now() + 10 * 60000 } }, function () {
      chrome.tabs.query({ url: pat }, function (tabs) {
        if (tabs && tabs.length) chrome.tabs.update(tabs[0].id, { active: true }, function () { chrome.windows.update(tabs[0].windowId, { focused: true }); });
        else chrome.tabs.create({ url: home });
        O.toast('已打开' + (site === 'boss' ? ' Boss' : '猎聘') + '，进入「职位管理」列表页就会自动开始抓取（10 分钟内有效）');
      });
    });
  });
  $('btnFetchSheet').addEventListener('click', function () {
    // 用「岗位管理」列表生成（抓到的职位已经自动并进列表）
    var EDU = ['不限', '高中', '大专', '本科', '硕士', '博士'];
    var list = jds.map(function (j) {
      var b = j.base || {};
      return { source: (j.sources || [])[0], title: j.platformJob || j.title, greetJob: j.greetJob, city: b.cities || '', exp: b.exp ? b.exp + '年以上' : '', edu: b.edu ? EDU[b.edu] : '', salary: j.salary || '', tags: [], jd: j.jdText || '' };
    });
    if (!list.length) { O.toast('还没有岗位，先到平台的职位管理页点「Smart Filter：抓取职位JD」', true); return; }
    try {
      var blob = HRSXlsx.write(HRSJdSheet.fetchSheets(list, []));
      var a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = 'SmartFilter_职位原文_给AI_' + P.localDate() + '.xlsx';
      document.body.appendChild(a); a.click(); a.remove();
      O.toast('[完成] 已生成（' + list.length + ' 个岗位），把这个 Excel 整个发给 AI');
    } catch (e) { O.fail('生成表格')(e); }
  });

  // ---------------- 加载 ----------------
  function load() {
    chrome.storage.local.get(['jds', 'settings', 'greetLog', 'jobFetch'], function (o) {
      jds = o.jds || []; settings = o.settings || {}; glog = o.greetLog || {}; fetched = o.jobFetch || { boss: [], liepin: [] };
      paintMode(settings.greetMode || 'stop');
      $('greetPaceSec').value = settings.greetPaceSec || 45;
      $('greetDailyCap').value = settings.greetDailyCap || CAP;
      capWarn(parseInt($('greetDailyCap').value, 10) || 0);
      $('greetPlatformFilter').checked = settings.greetPlatformFilter !== false;
      if (document.activeElement !== $('greetMsgDefault')) $('greetMsgDefault').value = settings.greetMsgDefault || '';
      $('greetTrustedClick').checked = settings.greetTrustedClick !== false;
      renderTable(); renderFetch();
    });
  }
  chrome.storage.onChanged.addListener(function (ch, area) {
    if (area !== 'local') return;
    if (ch.jds) { jds = ch.jds.newValue || []; renderTable(); }
    if (ch.greetLog) { glog = ch.greetLog.newValue || {}; renderTable(); }
    if (ch.jobFetch) { fetched = ch.jobFetch.newValue || { boss: [], liepin: [] }; renderFetch(); }
    if (ch.settings && ch.settings.newValue) {
      var o0 = ch.settings.oldValue || {};
      settings = ch.settings.newValue; paintMode(settings.greetMode || 'stop');
      // v2.6.0 顺序在岗位列表或智选里改了：打招呼表格跟着重画（以前要刷新页面才变）
      if (JSON.stringify(o0.greetOrder) !== JSON.stringify(settings.greetOrder)) renderTable();
    }
  });
  load();
})();
