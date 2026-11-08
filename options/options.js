/* options.js v1.2.0：设置页（运行 / 岗位JD / 话术 / 排错），运行与话术改动自动保存 */
(function () {
  'use strict';

  function $(id) { return document.getElementById(id); }
  function lines(v) { return String(v == null ? '' : v).split('\n').map(function (s) { return s.trim(); }).filter(Boolean); }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  var VERSION = chrome.runtime.getManifest().version;
  $('ver').textContent = 'v' + VERSION;

  var toastTimer = null;
  function toast(text, isErr) {
    var t = $('toast');
    t.textContent = text;
    t.className = 'toast' + (isErr ? ' err' : '');
    t.style.display = 'block';
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.style.display = 'none'; }, isErr ? 6000 : 1800);
  }
  // v1.9.23 新岗位默认基础条件
  function fillBaseDef(s) {
    var d = (s && s.baseDefaults) || HRSStore.DEFAULT_SETTINGS.baseDefaults;
    if (!$('bd_city')) return;
    $('bd_city').value = d.cities || '';
    $('bd_ageMax').value = d.ageMax != null ? d.ageMax : '';
    $('bd_edu').value = String(d.edu || 0);
  }
  function readBaseDef() {
    var a = parseInt($('bd_ageMax').value, 10);
    return { cities: $('bd_city').value.trim().replace(/[、,，/\s]+/g, '|').replace(/^\||\|$/g, ''), ageMax: isFinite(a) ? a : null, edu: parseInt($('bd_edu').value, 10) || 0 };
  }
  // v1.9.27 AI 判断接口
  function fillAi(s) {
    var ai = (s && s.ai) || {};
    if (!$('ai_on')) return;
    $('ai_on').checked = !!ai.on; $('ai_url').value = ai.url || ''; $('ai_model').value = ai.model || ''; $('ai_key').value = ai.key || '';
  }
  function readAi() { return { on: $('ai_on').checked, url: $('ai_url').value.trim(), model: $('ai_model').value.trim(), key: $('ai_key').value.trim() }; }
  function aiPermit(url) {
    return new Promise(function (resolve) {
      var o; try { o = new URL(url).origin + '/*'; } catch (e) { return resolve(false); }
      try { chrome.permissions.request({ origins: [o] }, function (ok) { void chrome.runtime.lastError; resolve(!!ok); }); } catch (e) { resolve(false); }
    });
  }
  function fail(what) { return function (e) { toast('[失败] ' + what + '：' + (e && e.message || e), true); }; }
  var curSettings = null;
  function save(patch, okText) {
    return HRSStore.saveSettings(patch).then(function (s) { curSettings = s || curSettings; toast('[完成] ' + (okText || '已保存')); return s; }).catch(fail('保存设置'));
  }
  // v1.9.1 岗位来源标签：Boss / 猎聘 / 两边都有（看岗位记录的来源，再对一下抓取记录里的同名职位）
  var fetchedAll = { boss: [], liepin: [] };
  function nz(x) { return String(x || '').replace(/\s+/g, '').toLowerCase(); }
  function srcOf(j) {
    var set = {};
    (j.sources || []).forEach(function (x) { set[x] = 1; });
    // v1.9.14 标签只看岗位自己记的来源（和插件运行时判断一致）；抓取记录在 loadFetched 时一次性并进 sources
    if (j.greetJob) set.boss = 1;
    return set;
  }
  function mergeFetchedSources() {
    var changed = false;
    jds.forEach(function (j) {
      var names = [nz(j.title), nz(j.platformJob)];
      ['boss', 'liepin'].forEach(function (site) {
        if ((j.sources || []).indexOf(site) >= 0) return;
        var hit = (fetchedAll[site] || []).some(function (f) { var t = nz(f.title); return t && names.indexOf(t) >= 0; });
        if (hit) { j.sources = (j.sources || []).concat([site]); changed = true; }
      });
    });
    return changed ? HRSStore.saveJds(jds) : Promise.resolve();
  }
  function srcTag(j) {
    var s = srcOf(j);
    if (s.boss && s.liepin) return '<span class="src boss">Boss 抓取</span><span class="src lp">猎聘抓取</span>';
    if (s.boss) return '<span class="src boss">Boss 抓取</span>';
    if (s.liepin) return '<span class="src lp">猎聘抓取</span>';
    return '<span class="src none" title="没有抓取记录，打开岗位在「来源平台」里勾一下">未标平台</span>';
  }
  // v1.9.47 来源平台筛选
  var platFilter = '';
  function loadFetched() { chrome.storage.local.get(['jobFetch', 'srcMerged'], function (o) { fetchedAll = o.jobFetch || { boss: [], liepin: [] };
    if (!o.srcMerged && jds && jds.length) { mergeFetchedSources().then(function () { chrome.storage.local.set({ srcMerged: 1 }); try { renderJobTable(); renderPlanTable(); if (window.HRSGreetRender) window.HRSGreetRender(); } catch (e) {} }); }
    try { renderJobTable(); renderPlanTable(); if (window.HRSGreetRender) window.HRSGreetRender(); } catch (e) {} }); }
  // v1.9.17 表格行拖动排序：拖完把 id 顺序交给 done(ids)
  function dragSort(table, done, sel) {
    sel = sel || 'tr[data-id]';
    var dragTr = null, before = null;
    var ids = function () { return Array.prototype.map.call(table.querySelectorAll(sel), function (x) { return x.dataset.id; }); };
    table.querySelectorAll(sel).forEach(function (tr) {
      tr.draggable = true;
      tr.style.cursor = 'grab';
      tr.addEventListener('dragstart', function (e) { dragTr = tr; before = ids(); tr.style.opacity = '.4'; try { e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', tr.dataset.id); } catch (x) {} });
      // v1.9.28 松手时鼠标常常正好停在被拖的那一行上，drop 不触发，顺序没存。改成拖完就存
      tr.addEventListener('dragend', function () {
        var moved = tr.dataset.id;   // v2.6.0 把挪的是哪一个也交出去，用来套到完整顺序上
        tr.style.opacity = tr.dataset.off ? '.45' : ''; dragTr = null;
        var now = ids();
        if (before && now.join() !== before.join()) done(now, moved);
        before = null;
      });
      tr.addEventListener('dragover', function (e) {
        if (!dragTr || dragTr === tr) return;
        e.preventDefault();
        var r = tr.getBoundingClientRect();
        tr.parentNode.insertBefore(dragTr, e.clientY < r.top + r.height / 2 ? tr : tr.nextSibling);
      });
      tr.addEventListener('drop', function (e) { e.preventDefault(); });
    });
  }
  // v2.6.0 三处拖动排序统一走这里：开着「拖动排序同步」时，在岗位列表、智选、打招呼任何一处拖，三处一起变
  function orderSyncOn() { return settingsCache.jobOrderSync !== false; }
  var ORDER_KEY = { job: 'jobOrder', plan: 'planOrder', greet: 'greetOrder' };
  var ORDER_NAME = { job: '岗位顺序', plan: '智选岗位顺序', greet: '打招呼岗位顺序' };
  function reorder(kind, shown, moved) {
    var key = ORDER_KEY[kind];
    var base = orderSyncOn() ? P.unifiedOrder(jds, settingsCache) : P.fullOrder(jds, settingsCache[key]);
    var next = moved ? P.applyMove(base, shown, moved) : shown.slice();
    var patch = {};
    if (orderSyncOn()) { patch.jobOrder = next; patch.planOrder = next; patch.greetOrder = next; } else patch[key] = next;
    Object.keys(patch).forEach(function (k) { settingsCache[k] = patch[k]; });
    return save(patch, ORDER_NAME[kind] + '已保存' + (orderSyncOn() ? '，岗位列表、智选、打招呼三处同步' : '')).then(function (st) {
      if (st) settingsCache = st;
      renderJobTable(); renderPlanTable(); if (window.HRSGreetRender) window.HRSGreetRender();
    });
  }
  // 打开页面时三处顺序不一样（例如旧版本备份只带了打招呼的顺序）：开着同步就合成一份，以岗位列表的为准
  function unifyOrdersOnce() {
    if (!orderSyncOn() || !jds.length || P.ordersInSync(jds, settingsCache)) return Promise.resolve();
    var u = P.unifiedOrder(jds, settingsCache);
    settingsCache.jobOrder = u; settingsCache.planOrder = u; settingsCache.greetOrder = u;
    return HRSStore.saveSettings({ jobOrder: u, planOrder: u, greetOrder: u }).then(function (st) { if (st) settingsCache = st; });
  }
  window.HRSOpt = { reorder: reorder, dragSort: dragSort, qCell: qCell, toast: toast, save: function (p, t) { return save(p, t); }, fail: fail, esc: esc, lines: lines, srcTag: srcTag };


  function show(t) {
    if (t === 'talent') { var f = $('talentFrame'); if (f && !f.src) f.src = f.getAttribute('data-src'); }
    document.querySelectorAll('.tab').forEach(function (x) { x.classList.toggle('on', x.dataset.t === t); });
    document.querySelectorAll('.panel').forEach(function (x) { x.classList.toggle('on', x.id === 'p-' + t); });
  }
  document.querySelectorAll('.tab').forEach(function (x) { x.addEventListener('click', function () { show(x.dataset.t); }); });


  // ================= 运行 =================
  var MODE_NOTE = {
    stop: '不扫描、不动作。',
    dry: '逐个打开会话并判定，结果只显示在网页浮层，不发任何消息，不标记已处理。',
    live: '按下面「判定后的动作」自动执行。'
  };
  function paintMode(m) {
    document.querySelectorAll('#modeSeg button').forEach(function (b) { b.classList.toggle('on', b.dataset.m === m); });
    $('modeNote').textContent = MODE_NOTE[m];
  }
  document.querySelectorAll('#modeSeg button').forEach(function (b) {
    b.addEventListener('click', function () {
      paintMode(b.dataset.m);
      save({ masterEnabled: b.dataset.m !== 'stop', dryRun: b.dataset.m !== 'live' }, '运行模式：' + b.textContent);
    });
  });
  function paintPace(v) {
    var n = HRSStore.clampPace(v);
    $('paceSec').value = n;
    $('paceRate').textContent = '最快约 ' + Math.floor(3600 / n) + ' 个/小时';
    return n;
  }
  $('paceSec').addEventListener('change', function () { var n = paintPace(this.value); save({ paceSec: n }, '节拍 ' + n + ' 秒/个'); });
  document.querySelectorAll('.pace .chip').forEach(function (c) {
    c.addEventListener('click', function () { var n = paintPace(c.dataset.p); save({ paceSec: n }, '节拍 ' + n + ' 秒/个'); });
  });
  function pathPreview() {
    if (window.HRSInbox && HRSInbox.paintPath) { HRSInbox.paintPath(); return; }   // v2.6.1 保存位置可选文件夹，由「简历收集」页统一显示
    var d = new Date();
    var ym = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
    var jd = currentJd();
    // v2.5.0 简历收集的保存位置：根目录/简历收集/日期/岗位/文件名
    var day = ym + '-' + String(d.getDate()).padStart(2, '0');
    $('pathPreview').textContent = '例如：下载目录/' + ($('exportFolder').value.trim() || 'HR人才库') + '/简历收集/' + day + '/' + (jd ? jd.title : '数字IC验证工程师') + '/';
  }

  // 自动保存：勾选框和下拉框 change 即存，文本框失焦存
  var RUN_FIELDS = {
    paceJitter: { t: 'chk', label: '随机浮动' },
    smartUnreadFirst: { t: 'chk', label: '先处理未读' },
    dailyCap: { t: 'int', label: '每日上限', min: 0, max: 1000, def: 0 },
    autoRequest: { t: 'chk', label: '合格者索要简历' },
    rejectMode: { t: 'sel', label: '不合格处理方式' },
    rejectTapInappropriate: { t: 'chk', label: '点「不合适」' },
    company: { t: 'txt', label: '公司名称' },
    resumeAutoSave: { t: 'chk', label: '自动保存PDF' },
    exportFolder: { t: 'txt', label: '归档文件夹名', def: 'HR人才库' },
    exportFormat: { t: 'sel', label: '导出格式' }
  };
  Object.keys(RUN_FIELDS).forEach(function (k) {
    var f = RUN_FIELDS[k], el = $(k);
    el.addEventListener('change', function () {
      var v;
      if (f.t === 'chk') v = el.checked;
      else if (f.t === 'int') { v = parseInt(el.value, 10); if (!isFinite(v)) v = f.def; v = Math.min(f.max, Math.max(f.min, v)); el.value = v; }
      else if (f.t === 'txt') { v = el.value.trim() || f.def || ''; el.value = v; }
      else v = el.value;
      var p = {}; p[k] = v;
      save(p, f.label + ' 已保存');
      if (k === 'exportFolder') pathPreview();
    });
  });
  function fillRun(s) {
    paintMode(!s.masterEnabled ? 'stop' : (s.dryRun ? 'dry' : 'live'));
    paintPace(s.paceSec);
    $('paceJitter').checked = s.paceJitter !== false;
    $('smartUnreadFirst').checked = s.smartUnreadFirst !== false;
    $('dailyCap').value = s.dailyCap || '';
    $('autoRequest').checked = !!s.autoRequest;
    $('rejectMode').value = s.autoReject === false ? 'skip' : (s.rejectMode || 'chat');
    $('rejectTapInappropriate').checked = s.rejectTapInappropriate !== false;
    $('company').value = s.company || '';
    $('resumeAutoSave').checked = s.resumeAutoSave !== false;
    $('exportFolder').value = s.exportFolder || 'HR人才库';
    $('exportFormat').value = (s.exportFormat === 'pdf' || s.exportFormat === 'docx') ? s.exportFormat : 'pdf+docx';
    // 旧版「自动处理不合格」开关并入处理方式下拉：选「不动作」即等价于关闭
    if (s.autoReject === false) HRSStore.saveSettings({ autoReject: true, rejectMode: 'skip' });
    pathPreview();
  }

  // ================= 在招岗位 + 智选计划 =================
  var jds = [], editId = null, settingsCache = {}, progress = {};
  var P = window.HRSPlan, SHEETX = window.HRSJdSheet, XL = window.HRSXlsx;
  function currentJd() { return jds.find(function (x) { return x.id === editId; }) || null; }

  // ---------- 智选计划表（只管加入 / 上限 / 进度，条件去「岗位管理」改） ----------
  function renderPlanHead() {
    var sum = P.summary(jds, settingsCache, progress);
    $('planTotal').textContent = '计划 ' + sum.planned.length + ' 个岗位，今日已处理 ' + sum.done + ' 人' + (sum.unlimited ? '（有岗位不限量）' : ' / 上限 ' + sum.quota + ' 人') + (sum.allFull ? '，已全部完成' : '');
    $('windowNow').textContent = settingsCache.planWindowOn ? (sum.window.ok ? '现在在时段内' : '现在不在时段内') : '';
  }
  function condText(j, kind) {
    var r = P.rulesOf(j, jds, kind);
    var n = r.hardRequirements.length + (r.requireChip ? 1 : 0);
    return n ? n + ' 条要求' + (r.requireChip ? '（含芯片行业）' : '') : '没有条件，所有人合格';
  }
  function qv(j, k) { var q = j.quota || {}; var v = q[k] != null ? q[k] : (k === 'bossScreen' || k === 'liepinScreen' ? j.dailyQuota : 0); return parseInt(v, 10) > 0 ? parseInt(v, 10) : ''; }
  // v1.9.14 没有这个平台标签：上限固定 0，不能改
  function qCell(j, site, key, val, a) {
    if (!P.onSite(j, site)) return '<input type="number" value="0" disabled title="这个岗位没有' + (site === 'boss' ? 'Boss' : '猎聘') + '标签，在这个平台不处理" style="background:var(--bg);color:var(--muted);">';
    return '<input type="number" min="0" max="999" data-a="' + a + '" data-k="' + key + '" value="' + val + '" placeholder="不限">';
  }
  function renderPlanTable() {
    var allOn = jds.length && jds.every(function (j) { return P.isPlanned(j, settingsCache); });
    var h = '<tr><th style="width:80px;"><label class="chk" style="font-size:var(--fs-sm);"><input type="checkbox" data-a="all"' + (allOn ? ' checked' : '') + '> 全选</label></th><th>岗位</th>' +
      '<th style="width:70px;text-align:center;">简历详情</th><th style="width:96px;text-align:center;">Boss 上限</th><th style="width:96px;text-align:center;">猎聘上限</th><th style="width:150px;">今日 Boss / 猎聘</th></tr>';
    if (!jds.length) h += '<tr><td colspan="6" style="color:var(--muted);">还没有岗位，先到「岗位管理」抓取或新建。</td></tr>';
    // v1.9.28 勾选的排前面，没勾的放在一起、置灰
    var ordered = P.sortBy(jds, settingsCache.planOrder);
    ordered = ordered.filter(function (j) { return P.isPlanned(j, settingsCache); }).concat(ordered.filter(function (j) { return !P.isPlanned(j, settingsCache); }));
    ordered.forEach(function (j) {
      var on = P.isPlanned(j, settingsCache);
      var db = P.doneOf(j, progress, 'boss'), dl = P.doneOf(j, progress, 'liepin');
      var qb = P.quotaOf(j, 'boss'), ql = P.quotaOf(j, 'liepin');
      h += '<tr data-id="' + esc(j.id) + '"' + (on ? '' : ' data-off="1" style="opacity:.45;"') + '>' +
        '<td><input type="checkbox" data-a="plan"' + (on ? ' checked' : '') + '></td>' +
        '<td><a href="#" data-a="edit" class="lnk ttl">' + esc(j.title) + '</a>' + srcTag(j) + '<span class="pj' + (j.platformJob ? '' : ' miss') + '">' + (j.platformJob ? esc(j.platformJob) : '未填平台职位名') + ' · ' + esc(condText(j, 'screen')) + '</span></td>' +
        '<td style="text-align:center;"><input type="checkbox" data-a="dt"' + ((j.detail || {}).screen ? ' checked' : '') + ' title="勾上后会话顶部只判基础条件，关键词点开完整简历打分"></td>' +
        '<td style="text-align:center;">' + qCell(j, 'boss', 'bossScreen', qv(j, 'bossScreen'), 'q') + '</td>' +
        '<td style="text-align:center;">' + qCell(j, 'liepin', 'liepinScreen', qv(j, 'liepinScreen'), 'q') + '</td>' +
        '<td>' + (on ? db + '/' + (P.onSite(j, 'boss') ? (qb || '不限') : 0) + '　' + dl + '/' + (P.onSite(j, 'liepin') ? (ql || '不限') : 0) : '<span style="color:var(--muted);">未加入</span>') + '</td></tr>';
    });
    $('planTable').innerHTML = h;
    dragSort($('planTable'), function (ids, moved) { reorder('plan', ids, moved); });
    renderPlanHead();
  }
  $('planTable').addEventListener('click', function (e) {
    if (e.target.getAttribute('data-a') !== 'edit') return;
    e.preventDefault();
    editId = e.target.closest('tr').dataset.id;
    // v1.10.0 在右侧抽屉里编辑，不离开当前页面
    if (window.HRSShell && window.HRSShell.openJob) { renderJobTable(); fillJdForm(); window.HRSShell.openJob(); return; }
    show('jd'); showSub('list'); renderJobTable(); fillJdForm(); window.scrollTo(0, 0);
  });
  $('planTable').addEventListener('change', function (e) {
    var a = e.target.getAttribute('data-a'), tr = e.target.closest('tr[data-id]');
    if (a === 'all') {
      var on = e.target.checked;
      jds.forEach(function (x) { x.planEnabled = on; });
      HRSStore.saveJds(jds).then(function () { toast('[完成] ' + (on ? '全部加入智选' : '全部移出智选')); renderPlanTable(); renderJobTable(); }).catch(fail('保存计划'));
      return;
    }
    var j = tr && jds.find(function (x) { return x.id === tr.dataset.id; });
    if (!j || !a) return;
    if (a === 'plan') j.planEnabled = e.target.checked;
    if (a === 'dt') {
      j.detail = j.detail || {}; j.detail.screen = e.target.checked;
      return HRSStore.saveJds(jds).then(function () { toast('[完成] ' + j.title + (j.detail.screen ? ' 智选改为看简历详情打分' : ' 智选不看简历详情')); renderPlanTable(); }).catch(fail('保存计划'));
    }
    var k = e.target.getAttribute('data-k'), n;
    if (a === 'q') { n = parseInt(e.target.value, 10); j.quota = j.quota || {}; j.quota[k] = isFinite(n) && n > 0 ? Math.min(999, n) : 0; }
    HRSStore.saveJds(jds).then(function () {
      toast('[完成] ' + j.title + (a === 'plan' ? (j.planEnabled ? ' 已加入智选' : ' 已移出智选') : ' ' + (k === 'bossScreen' ? 'Boss' : '猎聘') + ' 智选上限 ' + (j.quota[k] || '不限')));
      renderPlanTable();
    }).catch(fail('保存计划'));
  });
  ['planWindowOn', 'planStart', 'planEnd'].forEach(function (k) {
    $(k).addEventListener('change', function () {
      var p = {}; p[k] = k === 'planWindowOn' ? $(k).checked : $(k).value;
      save(p, '执行时段已保存').then(function (s) { if (s) { settingsCache = s; renderPlanHead(); } });
    });
  });
  $('btnResetProgress').addEventListener('click', function () {
    if (!confirm('把今天所有岗位的已处理人数清零？已处理过的候选人仍不会重复处理。')) return;
    chrome.storage.local.set({ planProgress: { date: P.localDate(), counts: {} } }, function () { toast('[完成] 今日进度已清零'); });
  });

  // ---------- 在招岗位：子标签 ----------
  function showSub(k) {
    document.querySelectorAll('.stab').forEach(function (x) { x.classList.toggle('on', x.dataset.s === k); });
    document.querySelectorAll('.spanel').forEach(function (x) { x.classList.toggle('on', x.id === 's-' + k); });
  }
  document.querySelectorAll('.stab').forEach(function (x) { x.addEventListener('click', function () { showSub(x.dataset.s); }); });

  // ---------- 在招岗位：左边列表 ----------
  var PRI = { high: '高', mid: '中', low: '低' };
  function jobTags(j, forList) {
    var from = j.base && j.base.from ? jds.find(function (x) { return x.id === j.base.from; }) : null;
    var g = j.greet || {}, tags = [];
    if (j.priority && PRI[j.priority]) tags.push('<span class="tag p-' + j.priority + '">' + PRI[j.priority] + '优先</span>');
    // v1.9.33 左边列表不再重复显示智选 / 打招呼，右边简介里有
    if (!forList && P.isPlanned(j, settingsCache)) tags.push('<span class="tag g">智选</span>');
    if (!forList && g.enabled) tags.push('<span class="tag g">打招呼</span>');
    if (from) tags.push('<span class="tag">复用 ' + esc(from.title) + '</span>');
    if (!j.jdText) tags.push('<span class="tag">无JD原文</span>');
    if (!(j.hardRequirements || []).length && !P.baseSummary(j, jds).length) tags.push('<span class="tag" style="background:var(--bad-50);color:var(--bad);">没有条件</span>');
    return tags;
  }
  // v1.9.29 岗位简介（基础条件、标签、优先级）放到右边编辑区顶部，左边列表只留名字和标签
  function renderJdSummary(j) {
    if (!j || !$('jdSummary')) return;
    var bs = P.baseSummary(j, jds).join('、') || '基础条件不限';
    var pri = '<span class="pri">' + ['high', 'mid', 'low'].map(function (k) { return '<span data-p="' + k + '"' + (j.priority === k ? ' class="on"' : '') + '>' + PRI[k] + '</span>'; }).join('') + '</span>';
    $('jdSummary').innerHTML = '<div style="display:flex;align-items:center;gap:8px;"><span>' + esc(bs) + '</span>' + pri + '</div><div class="tags">' + srcTag(j) + jobTags(j).filter(function (t) { return !/p-(high|mid|low)/.test(t); }).join('') + '</div>' + sensNote(j);
  }
  // v3.6.0 岗位条件里有年龄、性别、第一学历这类条件，或者数字明显填错：提醒一句（不拦）
  function sensNote(j) {
    var DLg = window.HRSDecisionLog;
    if (!DLg) return '';
    var lines = P.rulesOf(j, jds, 'screen').hardRequirements.concat(P.rulesOf(j, jds, 'greet').hardRequirements, (j.detail && j.detail.veto) || []);
    var t = DLg.sensitiveText(DLg.sensitive(lines));
    var odd = DLg.oddBase(P.baseOf ? P.baseOf(j, jds) : (j.base || {}));
    var out = '';
    if (odd.length) out += '<div class="sens bad"><b>条件可能填错了</b>' + esc(odd.join('、')) + '，会把几乎所有人判为不合格，请核对</div>';
    if (t) out += '<div class="sens"><b>敏感条件</b>' + esc(t) + '</div>';
    return out;
  }
  function orderedJobs() { return P.sortBy(jds, settingsCache.jobOrder); }
  function renderJobTable() {
    var q = P.norm($('jobFilter').value);
    var cnt = { all: jds.length, boss: 0, liepin: 0, none: 0 };
    jds.forEach(function (j) { var s = srcOf(j); if (!s.boss && !s.liepin) cnt.none++; if (s.boss) cnt.boss++; if (s.liepin) cnt.liepin++; });
    if ($('pfAll')) { $('pfAll').textContent = cnt.all; $('pfBoss').textContent = cnt.boss; $('pfLiepin').textContent = cnt.liepin; $('pfNone').textContent = cnt.none;
      $('pfNone').parentNode.style.display = cnt.none ? '' : 'none'; }
    var list = orderedJobs().filter(function (j) {
      if (platFilter) { var s = srcOf(j); if (platFilter === 'none' ? (s.boss || s.liepin) : !s[platFilter === 'liepin' ? 'liepin' : 'boss']) return false; }
      return !q || P.norm(j.title + (j.platformJob || '') + (j.liepinJob || '') + (j.greetJob || '')).indexOf(q) >= 0;
    });
    // v3.0.0 空状态：插画 + 一句说明 + 下一步
    var E = window.HRSEmpty;
    if (!jds.length) { $('jobTable').innerHTML = E ? E.html('jobs', { title: '还没有岗位', text: '在 BOSS / 猎聘的职位管理页点「Smart Filter：抓取职位JD」，或者用 Excel 导入，也可以手动新建',
      actions: [{ label: '抓取导入', click: '.hrs-side .tab[data-t="jd"][data-s="ai"]' }, { label: '手动新建', click: '#btnNewJd' }] }) : '还没有岗位'; return; }
    $('jobTable').innerHTML = list.map(function (j) {
      var tags = jobTags(j, true);
      return '<div class="jrow' + (j.id === editId ? ' on' : '') + '" data-id="' + esc(j.id) + '">' +
        '<span class="jact"><a data-act="dup" title="复制这个岗位">复制</a><a data-act="del" class="del" title="删除这个岗位">删除</a></span>' +
        '<div class="t">' + esc(j.title) + srcTag(j) + '</div>' +
        (tags.length ? '<div class="tags">' + tags.join('') + '</div>' : '') + '</div>';
    }).join('') || (E ? E.html('filter', { compact: true, title: '没有匹配的岗位', text: '换个搜索词，或者看全部平台', actions: [{ label: '清除筛选', reset: 'jobFilter', primary: false }, { label: '看全部平台', click: '#jobPlat [data-pf=""]', primary: false }] }) : '没有匹配的岗位');
    // 搜索或按平台筛选时不让拖，免得只拖了一部分把顺序打乱
    if (!q && !platFilter) dragSort($('jobTable'), function (ids, moved) { reorder('job', ids, moved); }, '.jrow[data-id]');
  }
  $('jobFilter').addEventListener('input', renderJobTable);
  document.querySelectorAll('#jobPlat [data-pf]').forEach(function (b) {
    b.addEventListener('click', function () {
      platFilter = b.dataset.pf;
      document.querySelectorAll('#jobPlat [data-pf]').forEach(function (x) { x.classList.toggle('on', x === b); });
      renderJobTable();
    });
  });
  // v1.9.33 「平台上的职位名」「城市、年龄、学历」：模块右上角点开 / 收起，记住上次状态
  document.querySelectorAll('.sec .tg[data-fold]').forEach(function (tg) {
    var id = tg.getAttribute('data-fold'), box = $(id);
    var set = function (on) { box.classList.toggle('open', on); tg.classList.toggle('open', on); };
    var on0 = false; try { on0 = localStorage.getItem('hrsFold_' + id) === '1'; } catch (e) {}
    set(on0);
    tg.addEventListener('click', function () { var on = !box.classList.contains('open'); set(on); try { localStorage.setItem('hrsFold_' + id, on ? '1' : '0'); } catch (e) {} });
  });
  $('jdSummary').addEventListener('click', function (e) {
    var k = e.target.getAttribute && e.target.getAttribute('data-p'); if (!k) return;
    var j = currentJd(); if (!j) return;
    j.priority = j.priority === k ? '' : k;
    persistJds(j.title + (j.priority ? ' 设为' + PRI[j.priority] + '优先' : ' 取消优先级'));
  });
  $('jobOrderSync').addEventListener('change', function () {
    var on = this.checked;
    save({ jobOrderSync: on }, on ? '拖动岗位顺序会同步到智选、打招呼' : '岗位列表顺序只管这里，智选、打招呼各排各的').then(function (st) {
      if (st) settingsCache = st;
      // v2.6.0 重新打开同步时，三处马上按岗位列表的顺序对齐
      if (on) unifyOrdersOnce().then(function () { renderJobTable(); renderPlanTable(); if (window.HRSGreetRender) window.HRSGreetRender(); });
    });
  });
  $('jobTable').addEventListener('click', function (e) {
    var row = e.target.closest && e.target.closest('.jrow[data-id]');
    if (!row) return;
    var act = e.target.getAttribute && e.target.getAttribute('data-act');
    editId = row.dataset.id; renderJobTable(); fillJdForm();
    if (act === 'dup') $('btnDupJd').click();
    if (act === 'del') $('btnDelJd').click();
  });

  // ---------- 岗位编辑 ----------
  function numStr(v) { return v == null || v === '' || !isFinite(v) ? '' : String(v); }
  function fillBaseFields(b, disabled) {
    $('b_city').value = b.cities || '';
    $('b_ageMin').value = numStr(b.ageMin);
    $('b_ageMax').value = numStr(b.ageMax);
    $('b_edu').value = String(b.edu || 0);
    $('b_exp').value = numStr(b.exp);
    $('b_chip').checked = !!b.chip;
    // v2.6.8 第一学历不要大专：没设过时，最低学历本科及以上默认勾上
    $('b_nodz').checked = b.noDazhuan === true || (b.noDazhuan == null && (b.edu || 0) >= 3);
    ['b_city', 'b_ageMin', 'b_ageMax', 'b_edu', 'b_exp', 'b_chip', 'b_nodz'].forEach(function (id) { $(id).disabled = !!disabled; });
  }
  function fillJdForm() {
    var j = currentJd();
    $('jobEditor').style.display = j ? '' : 'none';
    $('jobEmpty').style.display = j ? 'none' : '';
    if (!j) return;
    $('jdEditTitle').textContent = j.title;
    $('jd_title').value = j.title || '';
    $('jd_platform').value = j.platformJob || '';
    $('jd_liepinjob').value = j.liepinJob || '';
    $('jd_greetjob').value = j.greetJob || '';
    var sp = srcOf(j);
    $('jd_pf_boss').checked = !!sp.boss;
    $('jd_pf_liepin').checked = !!sp.liepin;
    var sel = $('jd_basefrom');
    sel.innerHTML = '<option value="">不复用，单独设置</option>' + jds.filter(function (x) { return x.id !== j.id && !(x.base && x.base.from); })
      .map(function (x) { return '<option value="' + esc(x.id) + '">' + esc(x.title) + '</option>'; }).join('');
    var from = (j.base && j.base.from) || '';
    sel.value = from;
    fillBaseFields(from ? P.baseOf(j, jds) : (j.base || {}), !!from);
    $('jd_hard').value = (j.hardRequirements || []).join('\n');
    $('jd_opt').value = (j.optionalKeywords || []).join('\n');
    var g = j.greet || {};
    $('g_same').checked = g.same !== false;
    $('greetOwn').style.display = g.same === false ? '' : 'none';
    $('g_hard').value = (g.hard || []).join('\n');
    $('g_bonus').value = (g.bonus || []).join('\n');
    var dt = j.detail || {};
    $('dt_screen').checked = !!dt.screen; $('dt_greet').checked = !!dt.greet;
    $('dt_pass').value = dt.passLine != null && dt.passLine !== '' ? dt.passLine : '';
    $('dt_veto').value = (dt.veto || []).join('\n');
    $('jd_text').value = j.jdText || '';
    renderJdSummary(j);
    pathPreview();
  }
  $('jd_basefrom').addEventListener('change', function () {
    var j = currentJd(); if (!j) return;
    var v = this.value;
    if (v) { var src = jds.find(function (x) { return x.id === v; }); fillBaseFields((src && src.base) || {}, true); }
    else fillBaseFields(j.base && !j.base.from ? j.base : {}, false);
  });
  $('g_same').addEventListener('change', function () {
    $('greetOwn').style.display = this.checked ? 'none' : '';
    if (!this.checked && !$('g_hard').value) { $('g_hard').value = $('jd_hard').value; $('g_bonus').value = $('jd_opt').value; }
  });
  function intOrNull(id) { var n = parseInt($(id).value, 10); return isFinite(n) ? n : null; }
  function readJdForm(j) {
    j.title = $('jd_title').value.trim() || '未命名岗位';
    j.platformJob = $('jd_platform').value.trim();
    j.liepinJob = $('jd_liepinjob').value.trim();
    j.greetJob = $('jd_greetjob').value.trim();
    var want = [];
    if ($('jd_pf_boss').checked) want.push('boss');
    if ($('jd_pf_liepin').checked) want.push('liepin');
    var other = (j.sources || []).filter(function (x) { return x !== 'boss' && x !== 'liepin'; });
    j.sources = want.concat(other);
    var from = $('jd_basefrom').value;
    j.base = from ? Object.assign({}, j.base || {}, { from: from }) : {
      from: '', cities: $('b_city').value.trim().replace(/[、,，/]/g, '|'), ageMin: intOrNull('b_ageMin'), ageMax: intOrNull('b_ageMax'),
      edu: parseInt($('b_edu').value, 10) || 0, exp: intOrNull('b_exp'), chip: $('b_chip').checked, noDazhuan: $('b_nodz').checked
    };
    j.hardRequirements = lines($('jd_hard').value);
    j.optionalKeywords = lines($('jd_opt').value);
    j.greet = j.greet || {};
    j.greet.same = $('g_same').checked;
    j.greet.hard = lines($('g_hard').value);
    j.greet.bonus = lines($('g_bonus').value);
    var pl = parseInt($('dt_pass').value, 10);
    j.detail = { screen: $('dt_screen').checked, greet: $('dt_greet').checked, passLine: isFinite(pl) ? Math.max(0, Math.min(100, pl)) : null, veto: lines($('dt_veto').value) };
    j.jdText = $('jd_text').value;
    j.schema = 5;
    return j;
  }
  function persistJds(msg) {
    return HRSStore.saveJds(jds).then(function () { toast('[完成] ' + msg); renderJobTable(); renderPlanTable(); fillJdForm(); }).catch(fail('保存岗位'));
  }
  function newJob() {
    return { id: HRSStore.uid(), schema: 5, quota: { bossScreen: 0, liepinScreen: 0, bossGreet: 0, liepinGreet: 0 }, title: '未命名岗位', platformJob: '', greetJob: '', jdText: '', planEnabled: false, dailyQuota: 0, hardRequirements: [], optionalKeywords: [],
      base: HRSStore.newBase(curSettings), greet: { enabled: false, quota: 20, same: true } };
  }
  // v1.7.8 编辑页自动保存：改完停 0.8 秒就存，不用每次点按钮
  var autoTimer = null;
  function autoSave() {
    clearTimeout(autoTimer);
    autoTimer = setTimeout(function () {
      var cur = currentJd(); if (!cur) return;
      readJdForm(cur);
      HRSStore.saveJds(jds).then(function () {
        $('autoSaved').textContent = '已自动保存 ' + new Date().toLocaleTimeString('zh-CN', { hour12: false });
        $('jdEditTitle').textContent = cur.title;
        renderJdSummary(cur);
        renderJobTable(); renderPlanTable();
      }).catch(fail('自动保存'));
    }, 800);
  }
  $('jobEditor').addEventListener('input', function (e) { if (e.target.id !== 'jd_basefrom') autoSave(); });
  $('jobEditor').addEventListener('change', autoSave);
  $('btnSaveJd').addEventListener('click', function () {
    var cur = currentJd(); if (!cur) return;
    readJdForm(cur);
    if (cur.greetJob && jds.some(function (x) { return x.id !== cur.id && P.norm(x.greetJob) === P.norm(cur.greetJob); })) toast('[注意] 有其他岗位的推荐页职位名和这个相同', true);
    persistJds('岗位「' + cur.title + '」已保存');
  });
  $('btnNewJd').addEventListener('click', function () {
    var j = newJob(); jds.push(j); editId = j.id;
    persistJds('已新建岗位，填好后点「保存岗位」');
  });
  $('btnDupJd').addEventListener('click', function () {
    var cur = currentJd(); if (!cur) { toast('先在列表里点选一个岗位', true); return; }
    var j = JSON.parse(JSON.stringify(readJdForm(JSON.parse(JSON.stringify(cur)))));
    j.id = HRSStore.uid(); j.title += '（副本）'; j.platformJob = ''; j.greetJob = ''; j.planEnabled = false; j.greet.enabled = false;
    jds.push(j); editId = j.id;
    persistJds('已复制为「' + j.title + '」，平台职位名已清空');
  });
  $('btnDelJd').addEventListener('click', function () {
    var j = currentJd(); if (!j) { toast('先在列表里点选一个岗位', true); return; }
    var users = jds.filter(function (x) { return x.base && x.base.from === j.id; });
    if (!confirm('删除岗位「' + j.title + '」？已入库的候选人不受影响。' + (users.length ? '\n有 ' + users.length + ' 个岗位复用了它的基础条件，删除后它们改为不限。' : ''))) return;
    users.forEach(function (x) { x.base = { from: '', cities: '', ageMin: null, ageMax: null, edu: 0, exp: null, chip: false }; });
    chrome.runtime.sendMessage({ type: 'DELETE_JD', id: j.id }, function (r) {
      if (chrome.runtime.lastError || (r && r.error)) { toast('[失败] 删除岗位：' + (chrome.runtime.lastError ? chrome.runtime.lastError.message : r.error), true); return; }
      editId = null;
      if (users.length) HRSStore.getJds().then(function (list) { list.forEach(function (x) { var u = users.find(function (y) { return y.id === x.id; }); if (u) x.base = u.base; }); return HRSStore.saveJds(list); }).then(loadAll);
      else loadAll();
      toast('[完成] 已删除「' + j.title + '」');
    });
  });

  // ---------- 芯片公司识别规则 ----------
  $('btnSaveChip').addEventListener('click', function () {
    var w = lines($('chipWords').value), x = lines($('chipExclude').value);
    if (!w.length) { toast('识别词不能为空', true); return; }
    save({ chipWords: w, chipExclude: x }, '芯片公司识别规则已保存');
  });
  if ($('btnAiSave')) $('btnAiSave').addEventListener('click', function () {
    var ai = readAi();
    if (ai.on && !/^https?:\/\//.test(ai.url)) { toast('[失败] 接口地址要以 https:// 开头', true); return; }
    (ai.url ? aiPermit(ai.url) : Promise.resolve(true)).then(function (ok) {
      if (ai.url && !ok) { toast('[失败] 没有授权访问这个接口地址，AI 判断用不了', true); return; }
      save({ ai: ai }, ai.on ? 'AI 判断已开启' : 'AI 设置已保存（未开启）');
    });
  });
  if ($('btnAiTest')) $('btnAiTest').addEventListener('click', function () {
    var ai = readAi();
    $('aiState').textContent = '测试中…';
    aiPermit(ai.url).then(function () { return save({ ai: Object.assign({}, ai, { on: true }) }, ''); }).then(function () {
      chrome.runtime.sendMessage({ type: 'AI_JUDGE', jd: { title: '测试岗位', jdText: '负责 LLVM 编译器后端开发' }, text: '5 年 LLVM 后端开发经验，熟悉 TableGen、SelectionDAG', sc: { hard: ['LLVM'], bonus: ['TableGen'] } }, function (r) {
        void chrome.runtime.lastError;
        $('aiState').textContent = r && r.ok ? '接口可用：' + (r.pass ? '通过' : '不通过') + (r.score != null ? ' ' + r.score + ' 分' : '') + '，' + (r.reason || '') : '失败：' + (r && (r.why || r.error) || '没有回应');
        if (!ai.on) save({ ai: ai }, '');
      });
    });
  });
  if ($('btnSaveBaseDef')) $('btnSaveBaseDef').addEventListener('click', function () { save({ baseDefaults: readBaseDef() }, '新岗位默认条件已保存'); });
  if ($('btnApplyBaseDef')) $('btnApplyBaseDef').addEventListener('click', function () {
    var d = readBaseDef(), n = 0;
    if (!confirm('把默认条件填到现有岗位的空白项？\n只填空着的：期望城市为空、年龄上限为空、学历为不限的岗位。已经填了的不动。')) return;
    jds.forEach(function (j) {
      if (j.base && j.base.from) return;   // 沿用别的岗位的不动
      j.base = j.base || {};
      var c = false;
      if (!j.base.cities && d.cities) { j.base.cities = d.cities; c = true; }
      if ((j.base.ageMax == null || j.base.ageMax === '') && d.ageMax != null) { j.base.ageMax = d.ageMax; c = true; }
      if (!j.base.edu && d.edu) { j.base.edu = d.edu; c = true; }
      if (c) n++;
    });
    save({ baseDefaults: d }, '').then(function () { persistJds('已给 ' + n + ' 个岗位补上默认条件'); });
  });
  $('btnResetChip').addEventListener('click', function () {
    if (!confirm('恢复内置识别词和排除词？你加的词会丢失。')) return;
    save({ chipWords: null, chipExclude: null }, '已恢复内置名单').then(function () {
      $('chipWords').value = window.HRSIndustry.DEFAULT_WORDS.join('\n');
      $('chipExclude').value = window.HRSIndustry.DEFAULT_EXCLUDE.join('\n');
    });
  });

  // ---------- Excel 导入导出 ----------
  function downloadBlob(blob, name) {
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url; a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 3000);
  }
  var pendingImport = null;
  $('btnImport').addEventListener('click', function () { $('importFile').value = ''; $('importFile').click(); });
  $('importFile').addEventListener('change', function () {
    var f = this.files && this.files[0];
    if (!f) return;
    if (!/\.xlsx$/i.test(f.name)) { toast('[失败] 只支持 .xlsx。旧版 .xls 或 .csv 请先用 Excel 另存为 .xlsx', true); return; }
    f.arrayBuffer().then(function (buf) { return XL.read(buf); }).then(function (sheets) {
      var pv = SHEETX.preview(sheets, jds);
      if (pv.error) { toast('[失败] ' + pv.error, true); return; }
      pendingImport = pv;
      renderImportPreview(pv, f.name);
    }).catch(fail('读取 Excel'));
  });
  function renderImportPreview(pv, fileName) {
    var c = { add: 0, update: 0, same: 0, error: 0 };
    pv.items.forEach(function (it) { c[it.action]++; });
    var desc = esc(fileName) + '：新增 <b>' + c.add + '</b> 个，更新 <b>' + c.update + '</b> 个，无变化 ' + c.same + ' 个' +
      (c.error ? '，<span class="bad">有错误 ' + c.error + ' 行（不会导入）</span>' : '') +
      '。系统里有、表里没有的岗位不受影响。';
    if (pv.unknownCols && pv.unknownCols.length) desc += '<br><span class="warn">以下列名不认识，已忽略：' + esc(pv.unknownCols.join('、')) + '</span>';
    if (!pv.present.planEnabled) desc += '<br>表里没有「加入计划」列，计划开关保持原样，新增岗位默认不加入计划。';
    $('importDesc').innerHTML = desc;
    var h = '<tr><th>行</th><th>结果</th><th>岗位</th><th>平台职位名</th><th>说明</th></tr>';
    pv.items.forEach(function (it) {
      var tag = { add: '<span class="tag add">新增</span>', update: '<span class="tag upd">更新</span>', same: '<span class="tag">无变化</span>', error: '<span class="tag err">错误</span>' }[it.action];
      var note = it.action === 'error' ? '<span class="bad">' + esc(it.errors.join('；')) + '</span>' : (it.action === 'update' ? '改动：' + esc(it.changes.join('、')) : '');
      h += '<tr><td>' + it.row + '</td><td>' + tag + '</td><td>' + esc(it.title) + '</td><td>' + esc(it.platformJob || '') + '</td><td>' + note + '</td></tr>';
    });
    $('importTable').innerHTML = h;
    $('btnImportOk').style.display = (c.add + c.update) ? '' : 'none';
    $('importCard').style.display = 'block';
    $('importCard').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
  $('btnImportOk').addEventListener('click', function () {
    if (!pendingImport) return;
    var r = SHEETX.apply(pendingImport, jds, HRSStore.uid, HRSStore.newBase(curSettings));
    jds = r.jds;
    pendingImport = null;
    $('importCard').style.display = 'none';
    persistJds('导入完成：新增 ' + r.added + ' 个，更新 ' + r.updated + ' 个').then(function () { showSub('list'); });
  });
  $('btnImportCancel').addEventListener('click', function () {
    pendingImport = null;
    $('importCard').style.display = 'none';
    $('btnImportOk').style.display = '';
  });

  // ================= 话术（失焦自动保存） =================
  var SC = { sc_reject: 'rejection', sc_request: 'request', sc_contact: 'contact', sc_follow: 'followup', sc_interview: 'interview', sc_questions: 'interviewQuestions' };
  function readScripts() { var o = {}; Object.keys(SC).forEach(function (id) { o[SC[id]] = $(id).value; }); return o; }
  function fillScripts(sc) { sc = sc || {}; Object.keys(SC).forEach(function (id) { $(id).value = sc[SC[id]] || ''; }); }
  Object.keys(SC).forEach(function (id) {
    $(id).addEventListener('change', function () { save({ scripts: readScripts() }, '话术已保存'); });
  });
  $('btnResetScripts').addEventListener('click', function () {
    if (!confirm('把全部话术恢复为默认内容？')) return;
    save({ scripts: JSON.parse(JSON.stringify(HRSStore.DEFAULT_SETTINGS.scripts)) }, '已恢复默认话术').then(function (s) { if (s) fillScripts(s.scripts); });
  });

  // ================= 排错：选择器 =================
  function loadSelectors(siteConfig) {
    var cfg = siteConfig || {};
    document.querySelectorAll('.selgroup').forEach(function (g) {
      var site = g.dataset.site;
      var sc = cfg[site] || (window.HRSSiteConfig && HRSSiteConfig.get(site)) || {};
      g.querySelectorAll('textarea[data-k]').forEach(function (ta) { ta.value = (sc[ta.dataset.k] || []).join('\n'); });
    });
  }
  $('btnSaveSel').addEventListener('click', function () {
    HRSStore.loadSettings().then(function (s) {
      var cfg = JSON.parse(JSON.stringify(s.siteConfig || {}));
      document.querySelectorAll('.selgroup').forEach(function (g) {
        var site = g.dataset.site;
        var sc = cfg[site] || JSON.parse(JSON.stringify((window.HRSSiteConfig && HRSSiteConfig.get(site)) || {}));
        g.querySelectorAll('textarea[data-k]').forEach(function (ta) { sc[ta.dataset.k] = lines(ta.value); });
        cfg[site] = sc;
      });
      return save({ siteConfig: cfg }, '选择器已保存，请刷新站点页面');
    });
  });
  $('btnRestoreSel').addEventListener('click', function () {
    if (!confirm('恢复默认选择器？你手动修复过的选择器会丢失。')) return;
    save({ siteConfig: null }, '已恢复默认选择器').then(function () { loadSelectors(null); });
  });
  $('btnDiagBoss').addEventListener('click', function () {
    save({ diagMode: true }, '诊断模式已开启').then(function () { chrome.tabs.create({ url: 'https://www.zhipin.com/web/chat/index' }); });
  });
  $('btnDiagLiepin').addEventListener('click', function () {
    save({ diagMode: true }, '诊断模式已开启').then(function () { chrome.tabs.create({ url: 'https://www.liepin.com/' }); });
  });
  $('btnDiagOff').addEventListener('click', function () { save({ diagMode: false }, '诊断模式已关闭'); });
  $('btnViewDiag').addEventListener('click', function () {
    chrome.runtime.sendMessage({ type: 'GET_DIAG' }, function (d) {
      var box = $('diagBox');
      box.style.display = 'block';
      box.textContent = JSON.stringify(d || { note: '暂无诊断日志' }, null, 2);
    });
  });
  $('btnClearDiag').addEventListener('click', function () {
    chrome.runtime.sendMessage({ type: 'RESET_DIAG' }, function () { toast('[完成] 诊断日志已清空'); });
  });

  // ================= 备份与恢复 =================
  var BACKUP_SKIP = ['lastHealthCheck'];
  $('btnGoBackup').addEventListener('click', function () { if (window.HRSSettings) HRSSettings.go('backup'); else show('debug'); });   // v2.4.0 设置页按模块分开显示
  function pad2(n) { return String(n).padStart(2, '0'); }
  $('btnBackupExport').addEventListener('click', function () {
    chrome.storage.local.get(['settings', 'jds'], function (o) {
      var st = Object.assign({}, o.settings || {});
      BACKUP_SKIP.forEach(function (k) { delete st[k]; });
      if (st.ai) st.ai = Object.assign({}, st.ai, { key: '' });   // v1.9.27 API Key 不导出
      var data = { app: 'Smart Filter', type: 'settings-backup', format: 1, version: VERSION, exportedAt: new Date().toISOString(), settings: st, jds: o.jds || [] };
      var d = new Date();
      var name = 'smartfilter-settings-' + d.getFullYear() + pad2(d.getMonth() + 1) + pad2(d.getDate()) + '_' + pad2(d.getHours()) + pad2(d.getMinutes()) + '.json';
      downloadBlob(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }), name);
      toast('[完成] 已导出 ' + data.jds.length + ' 个岗位和全部设置');
    });
  });
  var pendingBackup = null;
  $('btnBackupImport').addEventListener('click', function () { $('backupFile').value = ''; $('backupFile').click(); });
  // v2.5.0 插件里自带的岗位备份（data/preset-backup.json）：和导入设置文件走同一套预览 → 确认 → 可撤销
  function previewBackup(data, label) {
    if (!data || data.type !== 'settings-backup' || !data.settings || !Array.isArray(data.jds)) throw new Error('这不是Smart Filter导出的设置文件');
    pendingBackup = data;
    var jobs = data.jds.map(function (j) { return '  ' + j.title + (j.greetJob ? '（' + j.greetJob + '）' : ''); }).slice(0, 30).join('\n');
    $('backupPreview').style.display = 'block';
    $('backupPreview').textContent = '文件：' + label + '\n导出时间：' + new Date(data.exportedAt).toLocaleString('zh-CN') + '　导出版本：v' + data.version + '　当前版本：v' + VERSION +
      '\n岗位 ' + data.jds.length + ' 个：\n' + jobs + (data.jds.length > 30 ? '\n  …' : '') +
      '\n\n导入会覆盖当前的全部岗位和设置。当前设置会先自动备份，可以点「撤销上次导入」恢复。';
    $('backupConfirm').style.display = 'flex';
    $('backupCard').scrollIntoView({ block: 'nearest' });
  }
  $('btnBackupPreset').addEventListener('click', function () {
    fetch(chrome.runtime.getURL('data/preset-backup.json')).then(function (r) { return r.json(); })
      .then(function (data) { previewBackup(data, '插件内置的岗位备份'); }).catch(fail('读取内置岗位备份'));
  });
  fetch(chrome.runtime.getURL('data/preset-backup.json')).then(function (r) { return r.json(); }).then(function (d) {
    if (d && Array.isArray(d.jds)) $('btnBackupPreset').textContent = '导入内置岗位（' + d.jds.length + ' 个，' + new Date(d.exportedAt).toLocaleDateString('zh-CN') + ' 备份）';
  }).catch(function () { $('btnBackupPreset').style.display = 'none'; });
  // 新装后第一次打开：告诉你已经自动导入了内置岗位
  chrome.storage.local.get('presetSeed', function (o) {
    var p = o.presetSeed;
    if (!p || !p.auto || !p.notice) return;
    setTimeout(function () {
      if (window.HRSNotify) HRSNotify.info('已自动导入内置的 ' + p.count + ' 个岗位和设置（' + new Date(p.from).toLocaleDateString('zh-CN') + ' 备份）。智选和打招呼都已设为停止，确认无误后再打开', '岗位已导入');
      chrome.storage.local.set({ presetSeed: Object.assign({}, p, { notice: false }) });
    }, 1200);
  });
  $('backupFile').addEventListener('change', function () {
    var f = this.files && this.files[0];
    if (!f) return;
    f.text().then(function (txt) {
      var data;
      try { data = JSON.parse(txt); } catch (e) { throw new Error('不是有效的设置文件（JSON 解析失败）'); }
      if (!data || data.type !== 'settings-backup' || !data.settings || !Array.isArray(data.jds)) throw new Error('这不是Smart Filter导出的设置文件');
      pendingBackup = data;
      var jobs = data.jds.map(function (j) { return '  ' + j.title + (j.greetJob ? '（' + j.greetJob + '）' : ''); }).slice(0, 30).join('\n');
      $('backupPreview').style.display = 'block';
      $('backupPreview').textContent = '文件：' + f.name + '\n导出时间：' + new Date(data.exportedAt).toLocaleString('zh-CN') + '　导出版本：v' + data.version + '　当前版本：v' + VERSION +
        '\n岗位 ' + data.jds.length + ' 个：\n' + jobs + (data.jds.length > 30 ? '\n  …' : '') +
        '\n\n导入会覆盖当前的全部岗位和设置。当前设置会先自动备份，可以点「撤销上次导入」恢复。';
      $('backupConfirm').style.display = 'flex';
    }).catch(fail('读取设置文件'));
  });
  $('btnBackupCancel').addEventListener('click', function () {
    pendingBackup = null; $('backupPreview').style.display = 'none'; $('backupConfirm').style.display = 'none';
  });
  $('btnBackupApply').addEventListener('click', function () {
    if (!pendingBackup) return;
    var data = pendingBackup;
    chrome.storage.local.get(['settings', 'jds'], function (cur) {
      var prev = { savedAt: new Date().toISOString(), settings: cur.settings || {}, jds: cur.jds || [] };
      // v2.5.0 以当前设置为底，再盖上备份里的值：旧版本备份里没有的设置（简历收集命名、操作节奏等）保留现在的，不被重置成默认
      var st = Object.assign({}, cur.settings || {}, JSON.parse(JSON.stringify(data.settings)));
      if (st.ai && !st.ai.key && cur.settings && cur.settings.ai && cur.settings.ai.key) st.ai = Object.assign({}, st.ai, { key: cur.settings.ai.key });   // v1.9.27 保留本机的 API Key
      BACKUP_SKIP.forEach(function (k) { delete st[k]; });
      // 安全起见：导入后智选和打招呼都先停止
      st.masterEnabled = false;
      st.greetMode = 'stop';
      if (st.schedule) st.schedule = Object.assign({}, st.schedule, { enabled: false });
      // v2.5.0 两个平台各自的运行模式也停掉（备份里的 siteMode 会覆盖上面两项）
      var sm = st.siteMode || {};
      st.siteMode = {};
      ['boss', 'liepin'].forEach(function (k) { st.siteMode[k] = Object.assign({}, sm[k] || {}, { masterEnabled: false, greetMode: 'stop' }); });
      var jdsIn = data.jds.map(function (j) { var x = JSON.parse(JSON.stringify(j)); if (!x.id) x.id = HRSStore.uid(); return x; });
      chrome.storage.local.set({ settingsBackupPrev: prev, settings: st, jds: jdsIn }, function () {
        if (chrome.runtime.lastError) { toast('[失败] 导入：' + chrome.runtime.lastError.message, true); return; }
        pendingBackup = null;
        $('backupPreview').style.display = 'none'; $('backupConfirm').style.display = 'none';
        // 重新读一遍：旧版本导出的文件在这里自动迁移
        HRSStore.getJds().then(function () { return loadAll(); }).then(function () {
          refreshUndo();
          toast('[完成] 已导入 ' + jdsIn.length + ' 个岗位和全部设置。智选、打招呼已设为停止');
        });
      });
    });
  });
  function refreshUndo() {
    chrome.storage.local.get('settingsBackupPrev', function (o) {
      var p = o.settingsBackupPrev;
      $('btnBackupUndo').style.display = p ? '' : 'none';
      if (p) $('btnBackupUndo').textContent = '撤销上次导入（恢复到 ' + new Date(p.savedAt).toLocaleString('zh-CN') + ' 的设置）';
    });
  }
  $('btnBackupUndo').addEventListener('click', function () {
    chrome.storage.local.get('settingsBackupPrev', function (o) {
      var p = o.settingsBackupPrev;
      if (!p || !confirm('恢复到导入前的设置？现在的岗位和设置会被替换。')) return;
      chrome.storage.local.set({ settings: p.settings, jds: p.jds }, function () {
        chrome.storage.local.remove('settingsBackupPrev', function () { loadAll().then(function () { refreshUndo(); toast('[完成] 已恢复到导入前的设置'); }); });
      });
    });
  });
  refreshUndo();

  // ================= 排错：自检 =================
  $('btnHealth').addEventListener('click', function () {
    $('healthBox').textContent = '自检中';
    chrome.runtime.sendMessage({ type: 'HEALTH_CHECK' }, function (r) {
      if (chrome.runtime.lastError) r = { error: chrome.runtime.lastError.message };
      renderHealth(r);
    });
  });
  $('btnExportReport').addEventListener('click', function () {
    chrome.runtime.sendMessage({ type: 'EXPORT_REPORT' }, function (r) {
      if (chrome.runtime.lastError || (r && r.error)) toast('[失败] 导出自检报告：' + (chrome.runtime.lastError ? chrome.runtime.lastError.message : r.error), true);
      else toast('[完成] 自检报告已导出到下载目录');
    });
  });
  function renderHealth(r) {
    var box = $('healthBox');
    if (!r || r.error) { box.innerHTML = '<span class="bad">[失败] 自检未完成：' + esc(r && r.error || '后台无响应') + '</span>'; return; }
    var html = '<span class="' + (r.ok ? 'ok' : 'bad') + '">' + (r.ok ? '[完成] 自检通过' : '[失败] 发现问题') + '</span>  v' + VERSION + '  ' + new Date(r.at).toLocaleString('zh-CN') + '\n\n';
    var probs = r.problems || [], warns = r.warnings || [];
    html += '需处理：' + (probs.length ? '\n' + probs.map(function (x) { return '  <span class="bad">' + esc(x) + '</span>'; }).join('\n') : '无') + '\n\n';
    html += '建议：' + (warns.length ? '\n' + warns.map(function (x) { return '  <span class="warn">' + esc(x) + '</span>'; }).join('\n') : '无') + '\n\n';
    html += '人才库人数：' + ((r.stats && r.stats.candidates) || 0) + '    计划岗位：' + esc((r.stats && r.stats.activeJd) || '无') + '\n';
    html += '设置快照：' + esc(JSON.stringify(r.settings || {}));
    box.innerHTML = html;
  }

  // ================= 加载 =================
  loadFetched();
  chrome.storage.onChanged.addListener(function (ch, area) { if (area === 'local' && ch.jobFetch) loadFetched(); });
  function loadAll() {
    return HRSStore.getJds().then(function (j) {
      jds = j || [];
      return HRSStore.loadSettings();
    }).then(function (s) {
      settingsCache = s;
      jds.forEach(function (jd) {
        jd.hardRequirements = jd.hardRequirements || [];
        jd.optionalKeywords = jd.optionalKeywords || [];
        if (jd.planEnabled == null) jd.planEnabled = P.isPlanned(jd, s);   // 旧版「当前JD」迁移为加入计划
      });
      if (!editId || !currentJd()) editId = (jds[0] && jds[0].id) || null;
      curSettings = s;
      if ($('jobOrderSync')) $('jobOrderSync').checked = s.jobOrderSync !== false;
      // v2.6.0 三处顺序不一致时（旧版本备份只带了打招呼顺序等）先对齐，不动岗位本身
      unifyOrdersOnce().then(function () { try { renderJobTable(); renderPlanTable(); if (window.HRSGreetRender) window.HRSGreetRender(); } catch (e) {} });
      // v1.9.29 一次性：没设年龄上限的岗位，按默认（40）补上
      if (!s.ageFilled) {
        var dAge = ((s.baseDefaults || {}).ageMax) || 40, nAge = 0;
        jds.forEach(function (x) { if (x.base && !x.base.from && (x.base.ageMax == null || x.base.ageMax === '')) { x.base.ageMax = dAge; nAge++; } });
        HRSStore.saveJds(jds).then(function () { return HRSStore.saveSettings({ ageFilled: true }); }).then(function () { if (nAge) toast('[完成] ' + nAge + ' 个岗位没设年龄上限，已按默认补成 ' + dAge + ' 岁'); renderJobTable(); fillJdForm(); });
      }
      fillBaseDef(s);
      fillAi(s);
      $('chipWords').value = (s.chipWords || window.HRSIndustry.DEFAULT_WORDS).join('\n');
      $('chipExclude').value = (s.chipExclude || window.HRSIndustry.DEFAULT_EXCLUDE).join('\n');
      $('planWindowOn').checked = !!s.planWindowOn;
      $('planStart').value = s.planStart || '09:00';
      $('planEnd').value = s.planEnd || '18:00';
      return new Promise(function (res) { chrome.storage.local.get('planProgress', function (o) { progress = o.planProgress || {}; res(); }); }).then(function () {
        renderPlanTable();
        renderJobTable();
        fillJdForm();
        fillScripts(s.scripts);
        fillRun(s);
        loadSelectors(s.siteConfig);
        return s;
      });
    }).catch(fail('读取设置'));
  }
  // 其他页面（弹窗/网页浮层）改了节拍或模式时同步显示
  chrome.storage.onChanged.addListener(function (ch, area) {
    if (area === 'local' && ch.planProgress) { progress = ch.planProgress.newValue || {}; renderPlanTable(); }
    // 打招呼标签页也会改岗位数据，这里同步，避免保存岗位时把打招呼设置覆盖掉
    if (area === 'local' && ch.jds && ch.jds.newValue) {
      var had = currentJd() ? JSON.stringify(currentJd()) : '';
      jds = ch.jds.newValue;
      if (!currentJd()) editId = jds[0] && jds[0].id;
      renderPlanTable(); renderJobTable();
      if (!had) fillJdForm();
    }
    if (area !== 'local' || !ch.settings || !ch.settings.newValue) return;
    settingsCache = ch.settings.newValue;
    var n = ch.settings.newValue, o = ch.settings.oldValue || {};
    // v2.6.0 顺序在别处改了（打招呼表格、导入备份、后台对齐）：岗位列表和智选表格跟着重画
    if (['jobOrder', 'planOrder', 'greetOrder', 'jobOrderSync'].some(function (k) { return JSON.stringify(n[k]) !== JSON.stringify(o[k]); })) { renderJobTable(); renderPlanTable(); }
    if (n.paceSec !== o.paceSec && document.activeElement !== $('paceSec')) paintPace(n.paceSec);
    if (n.masterEnabled !== o.masterEnabled || n.dryRun !== o.dryRun) paintMode(!n.masterEnabled ? 'stop' : (n.dryRun ? 'dry' : 'live'));
  });
  loadAll();
})();
