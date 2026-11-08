/* popup.js v1.2.0：运行模式三态 + 节拍（秒/个）+ 当前页面自检 */
(function () {
  'use strict';

  function $(id) { return document.getElementById(id); }
  var VERSION = chrome.runtime.getManifest().version;
  // v1.10.1 告诉后台弹窗开着：这期间不切窗口、不动鼠标，弹窗不会被关掉
  try { chrome.runtime.connect({ name: 'hrs-popup' }); } catch (e) {}
  $('ver').textContent = 'v' + VERSION;

  // v1.9.46 弹窗里切运行模式只改当前标签页所在的平台
  var TAB_SITE = '';
  try { chrome.tabs.query({ active: true, currentWindow: true }, function (t) { var u = t && t[0] && t[0].url || ''; TAB_SITE = /zhipin\.com/.test(u) ? 'boss' : (/liepin\.com/.test(u) ? 'liepin' : ''); }); } catch (e) {}
  var toastTimer = null;
  function toast(text, isErr) {
    var t = $('toast');
    t.textContent = text;
    t.className = 'toast' + (isErr ? ' err' : '');
    t.style.display = 'block';
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.style.display = 'none'; }, isErr ? 5000 : 1800);
  }
  function save(patch, okText) {
    return HRSStore.saveSettings(patch).then(function () { if (okText) toast(okText); })
      .catch(function (e) { toast('保存失败：' + (e && e.message || e), true); });
  }

  var MODE_NOTE = {
    stop: '不扫描、不动作。',
    dry: '会逐个打开会话并判定，只在网页浮层显示结果，不发任何消息。首次使用或改了JD后先跑这个。',
    live: '合格者自动索要简历，不合格者按设置发拒绝话术。'
  };
  function modeOf(s) { return !s.masterEnabled ? 'stop' : (s.dryRun ? 'dry' : 'live'); }
  function paintMode(m) {
    document.querySelectorAll('#modeSeg button').forEach(function (b) { b.classList.toggle('on', b.dataset.m === m); });
    $('modeNote').textContent = MODE_NOTE[m];
  }
  document.querySelectorAll('#modeSeg button').forEach(function (b) {
    b.addEventListener('click', function () {
      var m = b.dataset.m;
      paintMode(m);
      save({ masterEnabled: m !== 'stop', dryRun: m !== 'live', __site: TAB_SITE || undefined }, '已切换为「' + b.textContent + '」');
      setTimeout(diag, 600);
    });
  });

  function paintPace(v) {
    var n = HRSStore.clampPace(v);
    $('pace').value = n;
    $('paceRate').textContent = '最快约 ' + Math.floor(3600 / n) + ' 个/小时';
    return n;
  }
  function setPace(v) {
    var n = paintPace(v);
    save({ paceSec: n }, '节拍已改为 ' + n + ' 秒/个');
  }
  $('dec').addEventListener('click', function () { var c = HRSStore.clampPace($('pace').value); setPace(c - (c > 10 ? 5 : 1)); });
  $('inc').addEventListener('click', function () { var c = HRSStore.clampPace($('pace').value); setPace(c + (c >= 10 ? 5 : 1)); });
  $('pace').addEventListener('change', function () { setPace(this.value); });
  document.querySelectorAll('.presets button').forEach(function (b) {
    b.addEventListener('click', function () { setPace(b.dataset.p); });
  });

  function paintGreet(m) { document.querySelectorAll('#greetSeg button').forEach(function (b) { b.classList.toggle('on', b.dataset.m === m); }); }
  document.querySelectorAll('#greetSeg button').forEach(function (b) {
    b.addEventListener('click', function () {
      if (b.dataset.m === 'live' && !confirm('正式运行会在推荐牛人页自动点「打招呼」，确定？')) return;
      paintGreet(b.dataset.m);
      save({ greetMode: b.dataset.m, __site: TAB_SITE || undefined }, '打招呼：' + b.textContent);
    });
  });
  chrome.storage.local.get(['settings', 'schedState'], function (o) {
    var c = (o.settings || {}).schedule || {}, st = o.schedState || {};
    if (!c.enabled) return;
    var L = { 'boss-greet': 'Boss 打招呼', 'boss-screen': 'Boss 智选', 'liepin-screen': '猎聘智选', 'liepin-greet': '猎聘打招呼' };
    var list = Array.isArray(c.steps) && c.steps.length ? c.steps.map(function (x) { return x.task; }) : (c.order || 'greet-screen').split('-').map(function (x) { return 'boss-' + x; });
    var txt = st.date !== HRSPlan.localDate() ? '今天还没开始，' + (c.startAt || '00:00') + ' 自动开始'
      : (st.status === 'running' ? '进行中：第 ' + ((st.step || 0) + 1) + ' 步 ' + L[list[st.step || 0]] : ({ done: '今天已全部完成', stopped: '今天已手动停止', waiting: '等待打开 Boss 页面' }[st.status] || ''));
    $('schedCard').style.display = '';
    $('schedInfo').textContent = '顺序：' + list.map(function (x) { return L[x]; }).join(' → ') + '。' + txt;
  });
  chrome.storage.local.get('greetLog', function (o) {
    var g = o.greetLog || {};
    $('greetInfo').textContent = g.date === HRSPlan.localDate() ? '· 今日已打 ' + (g.total || 0) + ' 个' : '· 今日 0 个';
  });
  HRSStore.loadSettings().then(function (s) {
    paintMode(modeOf(s));
    paintGreet(s.greetMode || 'stop');
    paintPace(s.paceSec);
    // v1.9.17 今日智选 / 打招呼 扫 · 过 · 拒（两个平台合计，下面一行分平台）
    chrome.storage.local.get(['screenToday', 'greetLog', 'greetLogLiepin'], function (o) {
      var d = HRSPlan.localDate(), T = o.screenToday && o.screenToday.date === d ? o.screenToday : {};
      var z = { scan: 0, pass: 0, reject: 0 };
      var B = T.boss || z, Lp = T.liepin || z;
      $('scScan').textContent = (B.scan || 0) + (Lp.scan || 0); $('scPass').textContent = (B.pass || 0) + (Lp.pass || 0); $('scReject').textContent = (B.reject || 0) + (Lp.reject || 0);
      $('scSplit').textContent = 'Boss 扫 ' + (B.scan || 0) + ' 过 ' + (B.pass || 0) + ' 拒 ' + (B.reject || 0) + '　猎聘 扫 ' + (Lp.scan || 0) + ' 过 ' + (Lp.pass || 0) + ' 拒 ' + (Lp.reject || 0);
      var gb = o.greetLog && o.greetLog.date === d ? o.greetLog : z, gl = o.greetLogLiepin && o.greetLogLiepin.date === d ? o.greetLogLiepin : z;
      $('grScan').textContent = (gb.scan || 0) + (gl.scan || 0); $('grPass').textContent = (gb.pass || 0) + (gl.pass || 0); $('grReject').textContent = (gb.reject || 0) + (gl.reject || 0);
      $('grSplit').textContent = 'Boss 扫 ' + (gb.scan || 0) + ' 过 ' + (gb.pass || 0) + ' 拒 ' + (gb.reject || 0) + ' 已打 ' + (gb.total || 0) + '　猎聘 扫 ' + (gl.scan || 0) + ' 过 ' + (gl.pass || 0) + ' 拒 ' + (gl.reject || 0) + ' 已打 ' + (gl.total || 0);
    });
    document.querySelectorAll('[data-go]').forEach(function (el) {
      el.style.cursor = 'pointer';
      el.addEventListener('click', function () { chrome.tabs.create({ url: chrome.runtime.getURL('dashboard/dashboard.html#today=' + el.getAttribute('data-go')) }); });
    });
    return HRSStore.getJds().then(function (jds) {
      chrome.storage.local.get('planProgress', function (o) { renderPlan(jds, s, o.planProgress || {}); });
    });
  });
  function esc(x) { return String(x == null ? '' : x).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function renderPlan(jds, s, progress) {
    var sum = HRSPlan.summary(jds, s, progress);
    $('jdSub').textContent = sum.planned.length ? '计划 ' + sum.planned.length + ' 个岗位 · 今日 ' + sum.done + '/' + (sum.unlimited ? '不限' : sum.quota) : '计划里没有岗位';
    var box = $('planList');
    if (!sum.planned.length) { box.innerHTML = '<div class="empty">还没有岗位加入计划，到「智选 · 岗位计划」勾选</div>'; return; }
    box.innerHTML = sum.planned.map(function (j) {
      var q = HRSPlan.quotaOf(j), d = HRSPlan.doneOf(j, progress);
      var pct = q ? Math.min(100, Math.round(d / q * 100)) : 0;
      return '<div class="r"><span class="nm" title="' + esc(j.title) + '">' + esc(j.title) + '</span>' +
        (q ? '<span class="bar"><i class="' + (d >= q ? 'full' : '') + '" style="width:' + pct + '%"></i></span><span>' + d + '/' + q + '</span>' : '<span>' + d + '（不限）</span>') + '</div>';
    }).join('');
  }

  $('btnDash').addEventListener('click', function () { chrome.tabs.create({ url: chrome.runtime.getURL('dashboard/dashboard.html') }); });
  $('btnOpts').addEventListener('click', function () { chrome.runtime.openOptionsPage(); });
  $('btnBoss').addEventListener('click', function () { chrome.tabs.create({ url: 'https://www.zhipin.com/web/chat/index' }); });
  $('btnLiepin').addEventListener('click', function () { chrome.tabs.create({ url: 'https://www.liepin.com/' }); });
  $('btnRecheck').addEventListener('click', diag);

  // ---------- 当前页面自检（含版本一致性：扩展更新后旧页面仍跑旧脚本） ----------
  function diag() {
    $('diagText').textContent = '检测中';
    chrome.tabs.query({ active: true, currentWindow: true }, function (tabs) {
      var tab = tabs && tabs[0];
      var url = (tab && tab.url) || '';
      var site = /zhipin\.com/i.test(url) ? 'boss' : /liepin\.com/i.test(url) ? 'liepin' : null;
      if (!site) {
        $('diagText').innerHTML = '<span class="warn">当前不是 Boss直聘 / 猎聘页面</span><br>点下方按钮打开沟通页并登录招聘端。';
        return;
      }
      if (/\/web\/chat\/recommend/i.test(url)) {
        $('diagText').innerHTML = '<span class="warn">这是「推荐牛人」页</span><br>插件只处理「我的沟通」，会自动切过去。';
      }
      chrome.tabs.sendMessage(tab.id, { type: 'HRS_PING' }, function (resp) {
        if (chrome.runtime.lastError || !resp || !resp.ok) {
          $('diagText').innerHTML = '<span class="bad">[失败] 页面里的插件没有运行</span><br>请按 F5 刷新该页面，右下角出现「Smart Filter」浮条即正常。';
          return;
        }
        if (resp.version && resp.version !== VERSION) {
          $('diagText').innerHTML = '<span class="bad">[失败] 页面里跑的是旧版 v' + resp.version + '</span><br>插件已更新到 v' + VERSION + '，请按 F5 刷新该页面。';
          return;
        }
        var modeTxt = !resp.enabled ? '<span class="warn">已停止</span>' : (resp.dryRun ? '<span class="warn">试运行</span>' : '<span class="ok">正式运行</span>');
        var state = resp.paused ? '<span class="warn">已暂停（手动）</span>' : (resp.queue ? '排队 ' + resp.queue + ' 位' + (resp.nextIn ? '，下一位 ' + resp.nextIn + ' 秒后' : '') : '等待新消息');
        $('diagText').innerHTML =
          '<span class="ok">[完成] 引擎运行中 v' + resp.version + '</span> · ' + (site === 'boss' ? 'Boss直聘' : '猎聘') + ' · ' + modeTxt +
          '<br>节拍 ' + resp.paceSec + ' 秒/个 · ' + state +
          '<br>本页：扫描 ' + resp.stats.scanned + ' · 通过 ' + resp.stats.passed + ' · 拒绝 ' + resp.stats.rejected + (resp.stats.review ? ' · 待复核 ' + resp.stats.review : '') +
          (resp.lastError ? '<br><span class="bad">最近失败：' + String(resp.lastError).replace(/</g, '&lt;') + '</span>' : '');
      });
    });
  }
  diag();
})();
