/* sched.js v1.8.0：设置页「计划任务」 */
(function () {
  'use strict';
  function $(id) { return document.getElementById(id); }
  var O = window.HRSOpt, P = window.HRSPlan;
  var DEF = { enabled: false, startAt: '00:00', order: 'greet-screen', greetMode: 'live', screenMode: 'live', autoOpen: true };
  var TASK = { 'boss-greet': 'Boss 打招呼', 'boss-screen': 'Boss 智选', 'liepin-screen': '猎聘智选', 'liepin-greet': '猎聘打招呼' };
  var NA = {};
  var steps = [];
  function stepsFrom(c) {
    if (Array.isArray(c.steps) && c.steps.length) return c.steps.map(function (x) { return { task: x.task, mode: x.mode || 'live' }; });
    return (c.order || 'greet-screen').split('-').filter(function (x) { return x === 'greet' || x === 'screen'; }).map(function (x) { return { task: 'boss-' + x, mode: c[x + 'Mode'] || 'live' }; });
  }
  function drawSteps() {
    $('sc_steps').innerHTML = steps.map(function (x, i) {
      return '<li draggable="true" data-i="' + i + '"><span class="no">' + (i + 1) + '</span><span class="nm' + (NA[x.task] ? ' na' : '') + '">' + TASK[x.task] + (NA[x.task] ? '（开发中，会跳过）' : '') + '</span>' +
        '<select data-i="' + i + '"><option value="live"' + (x.mode === 'live' ? ' selected' : '') + '>正式运行</option><option value="dry"' + (x.mode === 'dry' ? ' selected' : '') + '>试运行</option></select><a data-del="' + i + '">移除</a></li>';
    }).join('') || '<li style="cursor:default;color:var(--muted);">还没有任务，点上面的按钮添加</li>';
  }
  function saveSteps(msg) { cfg = read(); O.save({ schedule: cfg }, msg || '任务顺序已保存'); drawSteps(); render(); }
  document.querySelectorAll('.pchip').forEach(function (c) { c.addEventListener('click', function () { steps.push({ task: c.dataset.task, mode: 'live' }); saveSteps('已添加「' + TASK[c.dataset.task] + '」'); }); });
  $('sc_steps').addEventListener('change', function (e) { var i = e.target.getAttribute('data-i'); if (i != null && e.target.tagName === 'SELECT') { steps[+i].mode = e.target.value; saveSteps(); } });
  $('sc_steps').addEventListener('click', function (e) { var d = e.target.getAttribute('data-del'); if (d != null) { steps.splice(+d, 1); saveSteps('已移除'); } });
  var dragFrom = null;
  $('sc_steps').addEventListener('dragstart', function (e) { var li = e.target.closest('li[data-i]'); if (!li) return; dragFrom = +li.dataset.i; li.classList.add('drag'); });
  $('sc_steps').addEventListener('dragend', function (e) { var li = e.target.closest('li'); if (li) li.classList.remove('drag'); });
  $('sc_steps').addEventListener('dragover', function (e) { e.preventDefault(); });
  $('sc_steps').addEventListener('drop', function (e) {
    e.preventDefault();
    var li = e.target.closest('li[data-i]');
    if (!li || dragFrom == null) return;
    var to = +li.dataset.i, it = steps.splice(dragFrom, 1)[0];
    steps.splice(to, 0, it); dragFrom = null;
    saveSteps('顺序已调整');
  });
  var cfg = Object.assign({}, DEF);

  function read() {
    return {
      enabled: $('sc_enabled').checked, startAt: $('sc_start').value || '00:00', steps: steps.slice(), autoOpen: $('sc_autoOpen').checked
    };
  }
  function fill(c) {
    $('sc_enabled').checked = !!c.enabled; $('sc_start').value = c.startAt || '00:00'; $('sc_autoOpen').checked = c.autoOpen !== false;
    steps = stepsFrom(c); drawSteps();
  }
  ['sc_enabled', 'sc_start', 'sc_autoOpen'].forEach(function (id) {
    $(id).addEventListener('change', function () {
      cfg = read();
      if (id === 'sc_enabled' && cfg.enabled && cfg.steps.some(function (x) { return x.mode === 'live'; }) &&
        !confirm('计划任务会每天自动切换 Boss 页面并以「正式运行」发消息、打招呼。确定开启？')) { $('sc_enabled').checked = false; cfg.enabled = false; return; }
      O.save({ schedule: cfg }, '计划任务已保存');
    });
  });
  $('sc_run').addEventListener('click', function () {
    if (!confirm('现在按计划从第一步开始？会切换 Boss 页面并设置运行模式。')) return;
    chrome.runtime.sendMessage({ type: 'SCHED_START' }, function () { O.toast('[完成] 已开始'); render(); });
  });
  $('sc_stopBtn').addEventListener('click', function () {
    chrome.runtime.sendMessage({ type: 'SCHED_STOP' }, function () { O.toast('[完成] 今天的计划已停止，智选和打招呼都已停'); render(); });
  });

  // ---------- 简历分发（只读，状态来自 示例工作台） ----------
  function renderRec() {
    chrome.runtime.sendMessage({ type: 'REC_STATUS' }, function (r) {
      r = r || {};
      var wb = r.workbench;
      if (!wb) { $('rc_wb').innerHTML = '<span class="bad">没找到已启用的「示例工作台」</span>'; ['rc_cfg', 'rc_task'].forEach(function (id) { $(id).textContent = '—'; }); $('rc_last').textContent = '—'; return; }
      var ok3 = String(wb.version).localeCompare('3.8.0', undefined, { numeric: true }) >= 0;
      $('rc_wb').innerHTML = '<span class="' + (ok3 ? 'ok' : 'bad') + '">' + O.esc(wb.name) + ' v' + O.esc(wb.version) + '</span>' + (ok3 ? '' : '　需要升级到 v3.8.0 以上才有每日自动分发');
      var st = r.reply && r.reply.status;
      if (!st) { $('rc_cfg').textContent = ok3 ? '工作台还没打开过「自动分发」设置页' : '—'; $('rc_task').textContent = '—'; $('rc_last').textContent = '—'; return; }
      var c = st.cfg || {};
      $('rc_cfg').textContent = c.enabled ? '已启用：每天 ' + c.time + '，' + (c.method === 'rpa' ? 'RPA 操作 团队消息' : '后台接口发送') + '，汇总' + (c.notify === 'mail' ? '发邮件' : '发 团队消息私聊') : '未启用';
      var t = st.task;
      $('rc_task').textContent = !t ? '还没登记' : (t['已安装'] ? '已登记，下次运行 ' + (t['下次运行'] || '未知') : (t['说明'] || '未登记'));
      var l = st.last;
      if (!l) { $('rc_last').textContent = '还没运行过'; return; }
      var lines = [l['开始'] + '（' + l['触发'] + '）　' + l['状态'], '收到 ' + l['收到简历'] + ' 份新简历，已发 ' + l['已发'] + ' 份'];
      if ((l['各群'] || []).length) lines.push('各群：' + l['各群'].join('；'));
      if ((l['未匹配'] || []).length) lines.push('规则没对上：' + l['未匹配'].join('；'));
      if ((l['失败'] || []).length) lines.push('失败：' + l['失败'].join('；'));
      if (l['说明']) lines.push('说明：' + l['说明']);
      lines.push('（工作台读取于 ' + new Date(st.at).toLocaleString('zh-CN') + '）');
      $('rc_last').textContent = lines.join('\n');
    });
  }
  $('rc_open').addEventListener('click', function () {
    chrome.runtime.sendMessage({ type: 'REC_OPEN' }, function (r) { if (!r || !r.workbench) O.toast('没找到「示例工作台」插件', true); });
  });
  $('rc_refresh').addEventListener('click', renderRec);
  function render() {
    renderRec();
    chrome.storage.local.get(['settings', 'jds', 'schedState', 'greetLog', 'planProgress'], function (o) {
      var s = o.settings || {}, c = Object.assign({}, DEF, s.schedule || {}), st = o.schedState || {}, jds = o.jds || [];
      var list = stepsFrom(c);
      var today = P.localDate();
      var g = o.greetLog && o.greetLog.date === today ? o.greetLog : { total: 0 };
      var lines = [];
      lines.push('计划任务：' + (c.enabled ? '已启用，每天 ' + c.startAt + ' 开始' : '未启用'));
      if (st.date !== today) lines.push('今天：还没开始' + (c.enabled ? '（到 ' + c.startAt + ' 自动开始）' : ''));
      else lines.push('今天：' + ({ running: '进行中', done: '全部完成', stopped: '已手动停止', waiting: '等待打开平台页面' }[st.status] || st.status) + (st.note ? '（' + st.note + '）' : ''));
      list.forEach(function (x, i) {
        var mark = st.date !== today ? '○' : (i < (st.step || 0) || st.status === 'done' ? '✓' : (i === (st.step || 0) && st.status === 'running' ? '▶' : '○'));
        var site = x.task.split('-')[0];
        var prog = NA[x.task] ? '开发中，会跳过' : (/greet/.test(x.task) ? '今日已打招呼 ' + (g.total || 0) + ' / 总上限 ' + (s.greetDailyCap || 180)
          : (function () { var sm = P.summary(jds, s, o.planProgress || {}, site); return '今日已智选 ' + sm.done + (sm.unlimited ? '（有岗位不限量）' : ' / ' + sm.quota); })());
        lines.push('  ' + mark + ' 第 ' + (i + 1) + ' 步 ' + TASK[x.task] + '（' + (x.mode === 'dry' ? '试运行' : '正式运行') + '）  ' + prog);
      });
      $('sc_status').textContent = lines.join('\n');
    });
  }
  chrome.storage.local.get('settings', function (o) { cfg = Object.assign({}, DEF, (o.settings || {}).schedule || {}); fill(cfg); render(); });
  chrome.storage.onChanged.addListener(function (ch, area) { if (area === 'local' && (ch.schedState || ch.greetLog || ch.planProgress || ch.settings)) render(); });
})();
