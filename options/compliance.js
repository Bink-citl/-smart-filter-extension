/* compliance.js v3.6.0：设置 → 合规（影响评估登记、自动决定、保留期限、AI 去标识、按要求删除、月度报告）
 *   设置 → 备份与恢复 里的「全量加密备份」，设置 → 选择器与诊断 里的「远程选择器配置」，工作台顶部的提醒条（没登记影响评估、太久没备份）
 *   数据都在本机：决定记录、人才库在插件自己的数据库里，月度汇总只有数字 */
(function () {
  'use strict';
  var $ = function (id) { return document.getElementById(id); };
  if (!$('cpPia')) return;
  var DL = window.HRSDecisionLog, PP = window.HRSPeople, BK = window.HRSBackup;
  var esc = function (s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); };
  var VERSION = chrome.runtime.getManifest().version;
  var st = { s: {}, c: null };
  function send(m) { return new Promise(function (r) { chrome.runtime.sendMessage(m, function (x) { void chrome.runtime.lastError; r(x || {}); }); }); }
  function notify(t, err) { if (window.HRSNotify) HRSNotify[err ? 'error' : 'success'](t); else if (window.HRSOpt) HRSOpt.toast(t); }
  function save(p, msg) { return window.HRSOpt ? HRSOpt.save(p, msg) : HRSStore.saveSettings(p); }
  function dstr(t) { if (!t) return '—'; var d = new Date(t); return d.toLocaleDateString('zh-CN') + ' ' + d.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false }); }
  function download(blob, name) {
    var u = URL.createObjectURL(blob), a = document.createElement('a');
    a.href = u; a.download = name; document.body.appendChild(a); a.click();
    setTimeout(function () { URL.revokeObjectURL(u); a.remove(); }, 2000);
  }
  function num(id, lo, hi, def) { var n = parseInt($(id).value, 10); if (!isFinite(n)) n = def; n = Math.min(hi, Math.max(lo, n)); $(id).value = n; return n; }

  // ---------- 工作台顶部的提醒条 ----------
  function paintNotice(c) {
    var box = $('sfNotice');
    if (!box || !c) return;
    var out = [];
    var pia = c.pia || {};
    if (!pia.version || !pia.approvedAt) out.push('<div class="sfn warn"><b>还没登记个人信息影响评估</b>插件会自动筛选、自动打招呼，按个人信息保护法第 55 条要先做影响评估。<a data-go="comp">去登记</a></div>');
    else if (pia.nextReview && new Date(pia.nextReview).getTime() < Date.now()) out.push('<div class="sfn warn"><b>影响评估到复核时间了</b>登记的下次复核日期是 ' + esc(pia.nextReview) + '。<a data-go="comp">去更新</a></div>');
    var a = BK.age(c.backup && c.backup.lastAt);
    if (a.level === 'bad') out.push('<div class="sfn bad"><b>' + esc(a.text) + '</b>人才库和简历只存在这台电脑的浏览器里，卸载插件或重装浏览器会全部丢失。<a data-go="backup">去备份</a></div>');
    if (c.backup && c.backup.err && c.backup.errAt && (!c.backup.lastAt || c.backup.errAt > c.backup.lastAt)) out.push('<div class="sfn bad"><b>自动备份没成功</b>' + esc(c.backup.err) + '。<a data-go="backup">去看看</a></div>');
    box.innerHTML = out.join('');
    box.hidden = !out.length;
    var bd = $('sbComp');
    if (bd) { var n = (c.pending || 0); bd.hidden = !(n || !pia.version); bd.textContent = n ? (n > 99 ? '99+' : String(n)) : '!'; bd.setAttribute('title', n ? n + ' 人等 HR 确认拒绝' : '还没登记影响评估'); }
  }
  document.addEventListener('click', function (e) {
    var a = e.target.closest && e.target.closest('#sfNotice [data-go], #cpBanner [data-go]');
    if (!a) return;
    e.preventDefault();
    if (window.HRSSettings) HRSSettings.go(a.getAttribute('data-go'));
  });

  // ---------- 合规页 ----------
  function paint(c) {
    st.c = c;
    var s = st.s, pia = c.pia || {};
    $('piaVer').value = pia.version || ''; $('piaDate').value = pia.approvedAt || ''; $('piaBy').value = pia.approver || ''; $('piaNext').value = pia.nextReview || ''; $('piaNote').value = pia.note || '';
    $('piaState').textContent = pia.version && pia.approvedAt ? '已登记：' + pia.version + '，' + pia.approvedAt + ' 批准' : '还没登记';
    $('cpBanner').hidden = !!(pia.version && pia.approvedAt);
    $('cpBanner').innerHTML = '<b>还没登记影响评估</b>评估报告的草稿可以在仓库 docs/ 中获取模板（对照第 56 条写的三部分：目的和方式是否合法正当必要、对个人的影响和风险、保护措施）。批准后把版本和日期填在下面';
    $('cpConfirm').checked = s.rejectConfirm !== false;
    $('cpPend').textContent = c.pending ? '现在有 ' + c.pending + ' 人等确认（在 Boss / 猎聘沟通页的智选浮层「待确认」里）' : '现在没有等确认的人';
    $('cpDays').value = DL.days(s.decisionDays);
    var r = c.retention || PP.DEFAULT_RET;
    $('retOn').checked = r.on !== false; $('retReject').value = r.rejectDays; $('retResume').value = r.resumeDays;
    var pl = c.plan || { counts: {}, soon: [], due: [] };
    $('retCounts').innerHTML = '<span>人才库 <b>' + (c.candidates || 0) + '</b> 人</span><span>面试 / 录用（不自动删）<b>' + (pl.counts.keep || 0) + '</b></span><span>收到简历未面试 <b>' + (pl.counts.resume || 0) + '</b></span><span>不合适 / 没沟通 <b>' + (pl.counts.reject || 0) + '</b></span>' +
      '<span class="' + (pl.due.length ? 'bad' : '') + '">已到期 <b>' + pl.due.length + '</b></span>';
    $('retSoon').innerHTML = pl.soon.length ? '<div class="cp-soon-h">7 天内到期（' + pl.soon.length + ' 人）。还要用的点「延长 90 天」</div><table class="cp-tbl"><tr><th>姓名</th><th>岗位</th><th>类别</th><th>到期</th><th></th></tr>' +
      pl.soon.slice(0, 30).map(function (x) { return '<tr><td>' + esc(x.name) + '</td><td>' + esc(x.job) + '</td><td>' + (x.cls === 'resume' ? '收到简历' : '不合适 / 没沟通') + '</td><td>' + new Date(x.dueAt).toLocaleDateString('zh-CN') + '</td><td><button class="btn ghost sm" data-ext="' + esc(x.id) + '">延长 90 天</button></td></tr>'; }).join('') + '</table>' : '';
    $('aiRedact').checked = s.aiRedact !== false;
    $('aiCap').value = s.aiDailyCap == null ? 200 : s.aiDailyCap;
    var u = c.ai && c.ai.date === HRSPlan.localDate() ? c.ai : null;
    $('aiUsed').textContent = u ? '今天已用 ' + u.n + ' 次，去掉 ' + (u.redacted || 0) + ' 处个人信息' : '今天还没用';
    var KIND = { request: '按要求删除', retention: '到期自动删除', manual: '工作台里删除', expire: '记录到期' };
    var cnt = function (k) { var x = k || {}; var p = []; if (x.cand) p.push('人才库 ' + x.cand); if (x.inbox) p.push('简历收集 ' + x.inbox); if (x.pdf) p.push('PDF ' + x.pdf); if (x.files) p.push('文件 ' + x.files); if (x.decisions) p.push('决定记录 ' + x.decisions); if (x.events) p.push('处理记录 ' + x.events); if (x.pending) p.push('待确认 ' + x.pending); return p.join('，') || '—'; };
    $('delLog').innerHTML = (c.deletions || []).length ? '<table class="cp-tbl"><tr><th>时间</th><th>类型</th><th>删了什么</th><th>说明</th></tr>' + c.deletions.map(function (d) { return '<tr><td>' + dstr(d.at) + '</td><td>' + esc(KIND[d.kind] || d.kind) + '</td><td>' + esc(cnt(d.counts)) + '</td><td>' + esc(d.note || '') + '</td></tr>'; }).join('') + '</table>' : '<div class="n">还没有删除记录</div>';
    var M = c.months || [];
    $('cpMonths').innerHTML = M.length ? '<table class="cp-tbl"><tr><th>月份</th><th>自动判定</th><th>其中试运行</th><th>打招呼 合格 / 不合格</th><th>智选 合格 / 不合格 / 待复核</th><th>待确认</th><th>HR 确认拒绝</th><th>HR 改为合格</th><th>转人工</th><th>未经确认自动拒绝</th></tr>' +
      M.map(function (r) { return '<tr><td>' + r.month + '</td><td>' + r.total + '</td><td>' + r.dry + '</td><td>' + r.greetPass + ' / ' + r.greetReject + '</td><td>' + r.screenPass + ' / ' + r.screenReject + ' / ' + r.screenReview + '</td><td>' + r.pending + '</td><td>' + r.confirmed + '</td><td>' + r.overturn + '</td><td>' + r.manual + '</td><td>' + r.autoReject + '</td></tr>'; }).join('') + '</table>' : '<div class="n">还没有数据。开着智选或打招呼，每判一个人都会计进当月</div>';
    var mg = c.merge || {};
    $('cpMerge').hidden = !(mg.mark && mg.mark.groups);
    if (mg.mark && mg.mark.groups) $('cpMergeTxt').textContent = 'v3.6.0 升级时，人才库里同一个人（会话编号、手机号、邮箱或姓名 + 公司一样）合成了一条：' + mg.mark.before + ' 条记录合成 ' + mg.mark.after + ' 人。每个岗位一条投递记录，在人才库详情里能看到。' + (mg.canUndo ? '合并前的数据还留着，觉得合错了可以撤销' : '已撤销');
    $('cpUndoMerge').hidden = !mg.canUndo;
    paintNotice(c);
    paintBackup(c);
    paintSel(c);
  }
  function load() {
    chrome.storage.local.get('settings', function (o) {
      st.s = o.settings || {};
      send({ type: 'COMPLIANCE_STATE' }).then(paint);
    });
  }

  $('piaSave').addEventListener('click', function () {
    var p = { version: $('piaVer').value.trim(), approvedAt: $('piaDate').value, approver: $('piaBy').value.trim(), nextReview: $('piaNext').value, note: $('piaNote').value.trim() };
    if (!p.version || !p.approvedAt) { notify('版本和批准日期都要填', true); return; }
    save({ pia: p }, '影响评估已登记').then(load);
  });
  $('cpConfirm').addEventListener('change', function () {
    if (!this.checked && !confirm('关掉以后，智选判不合格的人会直接发拒绝话术，没有 HR 确认这一步。个人信息保护法第 24 条规定候选人有权拒绝只由自动化作出的决定。确定关掉？')) { this.checked = true; return; }
    save({ rejectConfirm: this.checked }, this.checked ? '不合格先给 HR 确认：已开启' : '不合格先给 HR 确认：已关闭').then(load);
  });
  $('cpDays').addEventListener('change', function () { var n = num('cpDays', DL.MIN_DAYS, DL.MAX_DAYS, DL.DEFAULT_DAYS); save({ decisionDays: n }, '决定明细保留 ' + n + ' 天'); });
  function saveRet() {
    var r = { on: $('retOn').checked, rejectDays: num('retReject', 30, 3650, 180), resumeDays: num('retResume', 30, 3650, 365) };
    return save({ retention: r }, '保留期限已保存：不合适 / 没沟通 ' + r.rejectDays + ' 天，收到简历 ' + r.resumeDays + ' 天' + (r.on ? '' : '（自动删除已关闭）')).then(load);
  }
  ['retOn', 'retReject', 'retResume'].forEach(function (id) { $(id).addEventListener('change', saveRet); });
  $('retRun').addEventListener('click', function () {
    var n = st.c && st.c.plan ? st.c.plan.due.length : 0;
    if (!n) { notify('现在没有到期的人'); return; }
    if (!confirm('删掉已到期的 ' + n + ' 人？连同他们的简历收集记录、PDF、已保存的简历文件、决定记录一起删，删了不能恢复')) return;
    send({ type: 'RETENTION_RUN' }).then(function (r) { notify('已删除 ' + (r.n || 0) + ' 人'); load(); });
  });
  $('retSoon').addEventListener('click', function (e) {
    var b = e.target.closest && e.target.closest('[data-ext]');
    if (!b) return;
    send({ type: 'RETENTION_EXTEND', id: b.getAttribute('data-ext'), days: 90 }).then(function () { notify('已延长 90 天'); load(); });
  });
  $('aiRedact').addEventListener('change', function () {
    if (!this.checked && !confirm('关掉以后，简历里的姓名、手机号、邮箱会原样发给 AI 接口。确定关掉？')) { this.checked = true; return; }
    save({ aiRedact: this.checked }, this.checked ? '发给 AI 前去标识：已开启' : '发给 AI 前去标识：已关闭');
  });
  $('aiCap').addEventListener('change', function () { var n = num('aiCap', 0, 5000, 200); save({ aiDailyCap: n }, n ? 'AI 判断每天最多 ' + n + ' 次' : 'AI 判断不限次数'); });
  $('cpReport').addEventListener('click', function () {
    chrome.storage.local.get('procStats', function (o) {
      var d = new Date(), p = function (n) { return String(n).padStart(2, '0'); };
      download(new Blob([DL.aggCsv(o.procStats)], { type: 'text/csv;charset=utf-8' }), 'SmartFilter-月度处理报告-' + d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate()) + '.csv');
    });
  });
  $('cpMaint').addEventListener('click', function () {
    this.disabled = true; var b = this;
    send({ type: 'MAINT_NOW' }).then(function (r) {
      b.disabled = false;
      notify('检查完成：到期删除 ' + (r.retention || 0) + ' 人，过期决定记录 ' + (r.decisions || 0) + ' 条，过期处理记录 ' + (r.events || 0) + ' 条' + (r.backup && r.backup.ok && !r.backup.skip ? '，已自动备份' : ''));
      load();
    });
  });
  $('cpUndoMerge').addEventListener('click', function () {
    if (!confirm('恢复成合并前的人才库？合并之后新进来的候选人会丢掉')) return;
    send({ type: 'PEOPLE_UNDO_MERGE' }).then(function (r) { notify(r.ok ? '已恢复成 ' + r.n + ' 条记录' : r.why, !r.ok); load(); });
  });

  // ---------- 按要求删除 ----------
  function findPeople() {
    var q = $('delQ').value.trim().toLowerCase().replace(/\s+/g, '');
    if (!q) { $('delList').innerHTML = ''; return; }
    send({ type: 'GET_DASHBOARD_DATA' }).then(function (d) {
      var hit = (d.candidates || []).filter(function (c) {
        var f = c.fields || {};
        return [c.name, f.name, f.phone, c.phone, f.email, c.email].some(function (x) { return x && String(x).toLowerCase().replace(/\s+/g, '').indexOf(q) >= 0; });
      }).slice(0, 20);
      $('delList').innerHTML = hit.length ? '<table class="cp-tbl"><tr><th>姓名</th><th>岗位</th><th>平台</th><th>最近处理</th><th></th></tr>' + hit.map(function (c) {
        var apps = PP.apps(c).map(function (a) { return a.jdTitle; }).filter(Boolean);
        return '<tr><td>' + esc(c.name || '') + '</td><td>' + esc(apps.join('、') || c.jdTitle || '') + '</td><td>' + (c.source === 'liepin' ? '猎聘' : c.source === 'boss' ? 'Boss' : '上传') + '</td><td>' + dstr(PP.lastAt(c)) + '</td><td><button class="btn danger sm" data-del="' + esc(c.id) + '" data-nm="' + esc(c.name || '') + '">删除这个人的全部信息</button></td></tr>';
      }).join('') + '</table>' : '<div class="n">人才库里没找到</div>';
    });
  }
  $('delFind').addEventListener('click', findPeople);
  $('delQ').addEventListener('keydown', function (e) { if (e.key === 'Enter') findPeople(); });
  $('delList').addEventListener('click', function (e) {
    var b = e.target.closest && e.target.closest('[data-del]');
    if (!b) return;
    if (!confirm('删除「' + b.getAttribute('data-nm') + '」在插件里的全部信息？人才库、简历收集和 PDF、已保存的简历文件、决定记录、处理记录都会删掉，删了不能恢复')) return;
    send({ type: 'PERSON_PURGE', id: b.getAttribute('data-del') }).then(function (r) {
      if (!r.ok) { notify(r.why || '没删成', true); return; }
      var k = r.counts || {};
      notify('已删除：人才库 1 条，简历收集 ' + (k.inbox || 0) + ' 份，PDF ' + (k.pdf || 0) + ' 份，文件 ' + (k.files || 0) + ' 个，决定记录 ' + (k.decisions || 0) + ' 条，处理记录 ' + (k.events || 0) + ' 条');
      findPeople(); load();
    });
  });

  // ---------- 全量加密备份 ----------
  function paintBackup(c) {
    var b = c.backup || {};
    var a = BK.age(b.lastAt);
    $('fbAge').textContent = a.text + (b.lastAt ? '（' + dstr(b.lastAt) + '）' : '');
    $('fbAge').className = 'fb-age ' + a.level;
    $('fbPwState').textContent = b.hasKey ? '已设置密码。' : '还没设置密码。';
    $('fbAuto').checked = !!st.s.backupAuto;
    $('fbWhere').textContent = b.where ? '上次存到：' + b.where + '。' : '';
  }
  $('fbPwSave').addEventListener('click', function () {
    var a = $('fbPw').value, b = $('fbPw2').value;
    var bad = BK.checkPw(a);
    if (bad) { notify(bad, true); return; }
    if (a !== b) { notify('两次输入的密码不一样', true); return; }
    chrome.storage.local.set({ backupKey: a }, function () { $('fbPw').value = ''; $('fbPw2').value = ''; notify('备份密码已保存。请把密码记在公司的密码管理里'); load(); });
  });
  $('fbAuto').addEventListener('change', function () {
    var on = this.checked, box = this;
    chrome.storage.local.get('backupKey', function (o) {
      if (on && !o.backupKey) { box.checked = false; notify('先设置备份密码', true); return; }
      save({ backupAuto: on }, on ? '每天自动备份：已开启' : '每天自动备份：已关闭').then(function () { if (on) send({ type: 'BACKUP_AUTO_NOW' }).then(function (r) { notify(r.ok ? '已做了一份：' + (r.where || '') : '自动备份没成功：' + (r.why || ''), !r.ok); load(); }); });
    });
  });
  function api() {
    return {
      get: function (k) { return new Promise(function (r) { chrome.storage.local.get(k, r); }); },
      all: function (store) { return HRSStore.getAll(store); },
      pdf: function (id) { return window.HRSResumeDB ? HRSResumeDB.get(id) : Promise.resolve(null); },
      toDataUrl: function (blob) { return new Promise(function (r) { var fr = new FileReader(); fr.onload = function () { r(fr.result); }; fr.onerror = function () { r(''); }; fr.readAsDataURL(blob); }); }
    };
  }
  function makeBackup(withPdf) {
    chrome.storage.local.get('backupKey', function (o) {
      var pw = o.backupKey;
      if (!pw) { notify('先设置备份密码', true); $('fbPw').focus(); return; }
      var out = $('fbOut'); out.hidden = false; out.textContent = '正在收集数据…';
      BK.collect(api(), { withPdf: withPdf }).then(function (d) {
        out.textContent = '正在加密：人才库 ' + d.candidates.length + ' 人，简历收集 ' + d.resumeInbox.length + ' 份' + (withPdf ? '，PDF ' + Object.keys(d.pdfs).length + ' 份' : '') + '…';
        return BK.encrypt(d, pw, { version: VERSION });
      }).then(function (file) {
        var name = BK.fileName(new Date(), false);
        download(new Blob([JSON.stringify(file)], { type: 'application/octet-stream' }), name);
        var k = file.counts;
        out.textContent = '已导出 ' + name + '：人才库 ' + k.candidates + ' 人，岗位 ' + k.jds + ' 个，简历收集 ' + k.inbox + ' 份，PDF ' + k.pdfs + ' 份，决定记录 ' + k.decisions + ' 条，评测样本 ' + k.evalSamples + ' 张。文件已加密，放到公司共享盘或 U 盘保存';
        return send({ type: 'BACKUP_DONE', where: '手动导出 ' + name, counts: k });
      }).then(load).catch(function (e) { out.textContent = '备份没成功：' + (e && e.message || e); });
    });
  }
  $('fbMakePdf').addEventListener('click', function () { makeBackup(true); });
  $('fbMake').addEventListener('click', function () { makeBackup(false); });
  var pendingFile = null;
  $('fbRestore').addEventListener('click', function () { $('fbFile').value = ''; $('fbFile').click(); });
  $('fbFile').addEventListener('change', function () {
    var f = this.files && this.files[0];
    if (!f) return;
    f.text().then(function (t) {
      var j = JSON.parse(t);
      if (!BK.isBackup(j)) throw new Error('这不是 Smart Filter 的加密备份文件（.sfbak）。只有设置的备份请用上面的「导入设置文件」');
      pendingFile = j;
      var k = j.counts || {};
      $('fbRsInfo').textContent = '文件：' + f.name + '\n备份时间：' + new Date(j.createdAt).toLocaleString('zh-CN') + '　备份版本：v' + j.version + (j.auto ? '（自动备份）' : '') +
        '\n里面有：人才库 ' + (k.candidates || 0) + ' 人，岗位 ' + (k.jds || 0) + ' 个，简历收集 ' + (k.inbox || 0) + ' 份，PDF ' + (k.pdfs || 0) + ' 份，决定记录 ' + (k.decisions || 0) + ' 条，评测样本 ' + (k.evalSamples || 0) + ' 张';
      $('fbRs').hidden = false; $('fbRsPw').value = ''; $('fbRsPw').focus();
    }).catch(function (e) { notify(e && e.message || String(e), true); });
  });
  $('fbRsCancel').addEventListener('click', function () { pendingFile = null; $('fbRs').hidden = true; });
  $('fbRsGo').addEventListener('click', function () {
    if (!pendingFile) return;
    var mode = (document.querySelector('input[name="fbMode"]:checked') || {}).value || 'merge';
    if (mode === 'replace' && !confirm('覆盖会把本机的人才库、简历收集、岗位、设置都换成备份里的，现在本机多出来的会丢掉。确定覆盖？')) return;
    var out = $('fbOut'); out.hidden = false; out.textContent = '正在解密…';
    var inc;
    BK.decrypt(pendingFile, $('fbRsPw').value).then(function (d) {
      inc = d;
      out.textContent = '正在恢复…';
      return BK.collect(api(), { withPdf: false });
    }).then(function (cur) { return applyRestore(cur, inc, mode); }).then(function (txt) {
      out.textContent = txt + (mode === 'replace' ? '。智选和打招呼都已设为停止，确认无误再打开' : '');
      pendingFile = null; $('fbRs').hidden = true;
      load();
    }).catch(function (e) { out.textContent = '恢复没成功：' + (e && e.message || e); });
  });
  function applyRestore(cur, inc, mode) {
    var plan = BK.restorePlan(cur, inc, mode), d = plan.data;
    var stop = function (s) {
      s = Object.assign({}, s); s.masterEnabled = false; s.greetMode = 'stop';
      if (s.schedule) s.schedule = Object.assign({}, s.schedule, { enabled: false });
      var sm = s.siteMode || {}; s.siteMode = {};
      ['boss', 'liepin'].forEach(function (k) { s.siteMode[k] = Object.assign({}, sm[k] || {}, { masterEnabled: false, greetMode: 'stop' }); });
      return s;
    };
    var setL = function (o) { return new Promise(function (r) { chrome.storage.local.set(o, r); }); };
    var pdfs = d.pdfs || {};
    var putPdfs = function () {
      return Object.keys(pdfs).reduce(function (p, id) {
        return p.then(function () { var b = HRSResumeDB.dataUrlToBlob(pdfs[id]); return b ? HRSResumeDB.put(id, b) : null; }).catch(function () {});
      }, Promise.resolve());
    };
    if (mode === 'replace') {
      return setL({ settings: stop(d.settings || {}), jds: d.jds || [], resumeInbox: d.resumeInbox || [], evalSamples: d.evalSamples || [], procStats: d.procStats || null, deletionLog: d.deletionLog || [], talentAlias: d.talentAlias || {}, rejectPending: d.rejectPending || [] })
        .then(function () { return HRSStore.putAll('candidates', d.candidates || [], true); })
        .then(function () { return HRSStore.putAll('events', d.events || [], true); })
        .then(function () { return HRSStore.putAll('decisions', d.decisions || [], true); })
        .then(putPdfs).then(function () { return BK.statText(plan.stat); });
    }
    return setL({ jds: d.jds, resumeInbox: d.resumeInbox, evalSamples: d.evalSamples, talentAlias: d.talentAlias })
      .then(function () { return HRSStore.putAll('candidates', d.candidates, true); })
      .then(function () { return HRSStore.putAll('events', d.eventsAdd || [], false); })
      .then(function () { return HRSStore.addDecisions(d.decisionsAdd || []); })
      .then(putPdfs).then(function () { return BK.statText(plan.stat); });
  }

  // ---------- 远程选择器配置 ----------
  function paintSel(c) {
    if (document.activeElement !== $('selUrl')) $('selUrl').value = st.s.selectorConfigUrl || '';
    var r = c.selector;
    $('selRemoteState').textContent = !st.s.selectorConfigUrl ? '没填地址，用的是插件内置的选择器（或你在下面手动改的）' :
      !r ? '还没取过' : (r.ok ? '上次更新 ' + dstr(r.at) + '，版本 ' + (r.version || '—') + '，' + r.keys + ' 项' + (r.warn ? '。提示：' + r.warn : '') : '上次没取到（' + dstr(r.at) + '）：' + (r.why || ''));
  }
  $('selUrlSave').addEventListener('click', function () {
    var u = $('selUrl').value.trim();
    if (u && !/^https?:\/\/[^\s/]+\/\S*$/i.test(u)) { notify('地址要以 http:// 或 https:// 开头', true); return; }
    var go = function () { return save({ selectorConfigUrl: u }, u ? '远程选择器地址已保存' : '已清空远程选择器地址').then(load); };
    if (!u) { go(); return; }
    var origin;
    try { origin = new URL(u).origin + '/*'; } catch (e) { notify('地址不对', true); return; }
    // 插件默认只能访问 Boss、猎聘。取远程配置要你同意访问这个地址所在的网站
    chrome.permissions.request({ origins: [origin] }, function (ok) {
      void chrome.runtime.lastError;
      if (!ok) { notify('没有同意访问 ' + origin.replace('/*', '') + '，取不到配置', true); return; }
      go().then(function () { return send({ type: 'SELCFG_FETCH' }); }).then(function (r) { notify(r.ok ? '已更新选择器：' + r.keys + ' 项，刷新 Boss / 猎聘页面后生效' : '没取到：' + r.why, !r.ok); load(); });
    });
  });
  $('selUrlNow').addEventListener('click', function () {
    send({ type: 'SELCFG_FETCH' }).then(function (r) { notify(r.ok ? '已更新选择器：' + r.keys + ' 项，刷新 Boss / 猎聘页面后生效' : '没取到：' + r.why, !r.ok); load(); });
  });

  document.addEventListener('hrs-set-sec', function (e) { if (e.detail && /comp|backup|sel/.test(e.detail.sec)) load(); });
  chrome.storage.onChanged.addListener(function (ch, area) { if (area === 'local' && (ch.rejectPending || ch.backupState)) load(); });
  load();
  window.HRSCompliance = { reload: load };
})();
