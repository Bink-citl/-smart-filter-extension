/* evalset.js v3.2.0：设置 → 评测集（给卡片打标、看漏打率 / 误打率）和 设置 → 岗位知识库（补充叫法）
 * 判定都用当前版本的代码重跑（HRSEval.rerun），所以改了知识库马上能看到两个率的变化
 * v3.3.0 分「打招呼卡片」「智选会话」两类看。智选的会话并排显示以前的判法和统一判法，可以在这里切换
 * 键盘：Y 该打招呼 · N 不该打 · U 拿不准 · ← → 上一张 / 下一张（光标在输入框里时不响应） */
(function () {
  'use strict';
  var $ = function (id) { return document.getElementById(id); };
  if (!$('evCard') || !window.HRSEval || !window.HRSMatcher || !window.HRSJobKB) return;
  var E = window.HRSEval, M = window.HRSMatcher, K = window.HRSJobKB;
  var esc = function (s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); };
  var st = { list: [], settings: {}, jds: [], now: {}, kind: 'card', job: '', flt: 'todo', idx: 0, show: false, kbDirty: false };
  var isChat = function (s) { return s.kind === 'chat'; };
  var inKind = function (s) { return isChat(s) === (st.kind === 'chat'); };
  var VN = { pass: '会打招呼', review: '跳过', reject: '不打招呼' };
  var VC = { pass: '合格', review: '待复核', reject: '不合格' };
  var vn = function (s, v) { return (isChat(s) ? VC : VN)[v] || v || '—'; };

  function notify(t, err) { if (window.HRSNotify) HRSNotify[err ? 'error' : 'success'](t); }
  function send(m) { return new Promise(function (r) { chrome.runtime.sendMessage(m, function (x) { void chrome.runtime.lastError; r(x); }); }); }
  function ropt() { return { industry: window.HRSIndustry, chipWords: st.settings.chipWords, chipExclude: st.settings.chipExclude, chatMode: st.settings.chatEngine === 'unified' ? 'unified' : 'text' }; }
  function rerunOne(s) { try { st.now[s.id] = E.rerun(s, M, ropt()); } catch (e) { st.now[s.id] = { verdict: s.verdict, reason: s.reason }; } }
  function recompute() {
    K.applySettings(st.settings);
    st.now = {};
    st.list.forEach(rerunOne);
  }
  // 智选会话：以前的判法 / 统一判法各自的结论
  var modeV = function (k) { return function (s) { var n = st.now[s.id] || {}; return (n[k] || {}).verdict; }; };
  var cur = function (s) { return (st.now[s.id] || s).verdict; };
  function load() {
    chrome.storage.local.get(['evalSamples', 'settings', 'jds'], function (o) {
      st.list = (o.evalSamples || []).slice().sort(function (a, b) { return (b.at || 0) - (a.at || 0); });
      st.settings = o.settings || {};
      st.jds = o.jds || [];
      recompute();
      paintAll();
    });
  }
  // ---------- 评测集 ----------
  function shown() {
    // v3.6.0 盲测复核：只看挑出来的那 20 张，按挑的顺序
    if (st.blind) return st.blind.ids.map(function (id) { return st.list.filter(function (s) { return s.id === id; })[0]; }).filter(Boolean);
    return st.list.filter(function (s) {
      if (!inKind(s)) return false;
      if (st.job && s.jobTitle !== st.job) return false;
      if (st.flt === 'todo') return !s.label;
      if (st.flt === 'miss') return s.label === 'yes' && !E.greets(cur(s));
      if (st.flt === 'false') return s.label === 'no' && E.greets(cur(s));
      if (st.flt === 'unsure') return s.label === 'unsure';
      return true;
    });
  }
  function kpi() {
    var L = st.list.filter(function (s) { return inKind(s) && (!st.job || s.jobTitle === st.job); });
    var m = E.metrics(L, cur), then = E.metrics(L), chat = st.kind === 'chat';
    var Y = chat ? '合格' : '该打招呼', N = chat ? '不合格' : '不该打', G = chat ? '判合格' : '打了';
    var pct = function (v) { return v == null ? '—' : v + '%'; };
    var cell = function (label, v, sub, tip) { return '<div class="ev-k"' + (tip ? ' data-tip="' + esc(tip) + '"' : '') + '><span>' + label + '</span><b class="num">' + v + '</b><em>' + sub + '</em></div>'; };
    $('evKpi').innerHTML = cell('已采集', L.length, chat ? '个会话' : '张卡片') +
      cell('已打标', m.labeled, (chat ? '合格 ' : '打 ') + m.yes + ' · ' + (chat ? '不合格 ' : '不打 ') + m.no + ' · 拿不准 ' + m.unsure) +
      cell(chat ? '漏选率' : '漏打率', pct(m.missRate), m.miss + ' / ' + m.yes + (then.missRate != null && then.missRate !== m.missRate ? ' · 采集时 ' + then.missRate + '%' : ''), '标了「' + Y + '」、插件没' + G.replace('打了', '打') + '的比例') +
      cell(chat ? '误选率' : '误打率', pct(m.falseRate), m.falsePos + ' / ' + m.no + (then.falseRate != null && then.falseRate !== m.falseRate ? ' · 采集时 ' + then.falseRate + '%' : ''), '标了「' + N + '」、插件' + G + '的比例') +
      cell('一致率', pct(m.agreeRate), chat ? '标了合格 / 不合格的会话里，插件判对的比例' : '标了打 / 不打的卡片里，插件判对的比例') +
      agreeCell(L) +
      stableHint(L, chat);
    paintCmp(L);
    var fb = $('evFlt');
    if (fb) { fb.querySelector('[data-v="miss"]').textContent = chat ? '漏选' : '漏打'; fb.querySelector('[data-v="false"]').textContent = chat ? '误选' : '误打'; }
  }
  // v3.6.0 盲测复核一致率：同一张卡片两次标注一样的比例。低于 80% 说明打标标准没统一，先对齐标准（写进打标说明）
  function agreeCell(L) {
    var a = E.agreement(L);
    if (!a.n) return '';
    return '<div class="ev-k' + (a.ok ? '' : ' warn') + '" data-tip="盲测复核：不看之前的标注再标一遍，两次一样的比例。目标 ' + E.AGREE_TARGET + '% 以上"><span>复核一致率</span><b class="num">' + a.rate + '%</b><em>' + a.same + ' / ' + a.n + (a.ok ? '' : ' · 低于 ' + E.AGREE_TARGET + '%，先对齐打标标准') + '</em></div>';
  }
  /**
   * v3.4.0 两个率要按同一个在招岗位看，每个岗位标够 E.STABLE_N（111）张（打 / 不打，拿不准不算）才稳定
   * 选了岗位：说这个岗位标了多少。全部岗位：列出每个岗位的进度
   */
  function stableHint(L, chat) {
    var N = E.STABLE_N, P = E.progress(L), unit = chat ? '个' : '张';
    if (!P.length) return '';
    if (st.job) {
      var x = P[0];
      return x.ok ? '<p class="ev-hint ok">这个岗位已标 ' + x.n + ' ' + unit + '，两个率可以参考</p>'
        : '<p class="ev-hint">这个岗位标了 ' + x.n + ' ' + unit + '（拿不准不算），标到 ' + N + ' ' + unit + '两个率才稳定，现在的数字仅供参考</p>';
    }
    return '<p class="ev-hint">两个率要按同一个在招岗位看，每个岗位标到 ' + N + ' ' + unit + '才稳定。上面是全部岗位混在一起的数字，仅供参考，选一个岗位看更准</p>' +
      '<div class="ev-prog">' + P.map(function (x) {
        return '<button type="button" class="ev-pg' + (x.ok ? ' ok' : '') + '" data-job="' + esc(x.job) + '" data-tip="点一下只看这个岗位"><span>' + esc(x.job) + '</span><b class="num">' + x.n + ' / ' + N + '</b><i style="width:' + Math.min(100, Math.round(x.n / N * 100)) + '%"></i></button>';
      }).join('') + '</div>';
  }
  /** 智选：以前的判法和统一判法并排比，在这里切换 */
  function paintCmp(L) {
    var box = $('evCmp');
    if (!box) return;
    box.hidden = st.kind !== 'chat';
    if (box.hidden) return;
    var a = E.metrics(L, modeV('text')), b = E.metrics(L, modeV('unified'));
    var pct = function (v) { return v == null ? '—' : v + '%'; };
    var on = st.settings.chatEngine === 'unified';
    var row = function (name, m, sub, act) {
      return '<tr' + (act ? ' class="on"' : '') + '><th>' + name + (act ? '<i>正在用</i>' : '') + '<em>' + sub + '</em></th><td class="num">' + pct(m.missRate) + '<em>' + m.miss + ' / ' + m.yes + '</em></td><td class="num">' + pct(m.falseRate) + '<em>' + m.falsePos + ' / ' + m.no + '</em></td><td class="num">' + pct(m.agreeRate) + '</td></tr>';
    };
    var advice;
    var P = E.progress(L), short = P.filter(function (x) { return !x.ok; });
    if (!P.length || short.length) advice = st.job ? '这个岗位标了合格 / 不合格的会话还不到 ' + E.STABLE_N + ' 个，数字还不稳，先多标一些再决定'
      : '有 ' + short.length + ' 个岗位标的会话还不到 ' + E.STABLE_N + ' 个，数字还不稳。先按岗位标够，再选岗位比较';
    else if (b.missRate <= a.missRate && b.falseRate <= a.falseRate) advice = '统一判法两个率都不比以前差，可以切换';
    else if (b.falseRate < a.falseRate) advice = '统一判法误选少了，但漏选多了 ' + Math.round((b.missRate - a.missRate) * 10) / 10 + ' 个百分点。先看「漏打」里漏的是哪些，多半是职位叫法没收录，到「岗位知识库」补上再比';
    else advice = '统一判法没有比以前好，先不切换';
    box.innerHTML = '<div class="ev-cmp-h"><b>智选：两种判法比一比</b><label class="ev-collect"><input type="checkbox" id="evChatUni"' + (on ? ' checked' : '') + '> 智选用统一判法</label></div>' +
      '<table class="tbl ev-cmp-t"><thead><tr><th>判法</th><th>漏选率</th><th>误选率</th><th>一致率</th></tr></thead><tbody>' +
      row('以前的判法', a, '在整份在线简历里找岗位方向的词，写在项目、技能里的也算', !on) +
      row('统一判法', b, '和打招呼一样按每段工作的职位判：做过本岗位直接合格，没做过看全部工作的整体匹配度', on) +
      '</tbody></table><p class="ev-cmp-a">' + esc(advice) + '</p>';
  }
  function paintJobs() {
    var jobs = {}, n = 0, nc = 0;
    st.list.forEach(function (s) { if (isChat(s)) nc++; if (!inKind(s)) return; n++; jobs[s.jobTitle || '未知岗位'] = (jobs[s.jobTitle || '未知岗位'] || 0) + 1; });
    var ks = $('evKind');
    if (ks) { ks.innerHTML = '<option value="card">打招呼卡片（' + (st.list.length - nc) + '）</option><option value="chat">智选会话（' + nc + '）</option>'; ks.value = st.kind; }
    var sel = $('evJob'), v = st.job;
    if (v && !jobs[v]) v = st.job = '';
    sel.innerHTML = '<option value="">全部岗位（' + n + '）</option>' + Object.keys(jobs).sort().map(function (k) { return '<option value="' + esc(k) + '">' + esc(k) + '（' + jobs[k] + '）</option>'; }).join('');
    sel.value = v;
  }
  function paintCard() {
    var L = shown();
    if (st.idx >= L.length) st.idx = Math.max(0, L.length - 1);
    var s = L[st.idx];
    $('evPos').textContent = L.length ? (st.idx + 1) + ' / ' + L.length : '';
    var btns = document.querySelectorAll('.ev-btns [data-l]');
    paintBtnText();
    if (!s) {
      $('evCard').innerHTML = window.HRSEmpty ? HRSEmpty.html('filter', { compact: !!st.list.length, title: st.list.length ? '这里没有卡片了' : '还没有评测样本',
        text: st.list.length ? '换个岗位或筛选看看' : (st.kind === 'chat' ? '智选每判一个会话会自动存一份（去掉姓名、电话、邮箱）。到 BOSS 沟通页开试运行，跑一会儿再回来打标' : '打招呼每判一张卡片会自动存一份（去掉姓名）。到 BOSS 推荐牛人页开试运行，跑一会儿再回来打标') }) : '没有卡片';
      Array.prototype.forEach.call(btns, function (b) { b.disabled = true; });
      $('evNote').value = ''; $('evNote').disabled = true;
      return;
    }
    var lb = st.blind ? s.label2 : s.label;
    Array.prototype.forEach.call(btns, function (b) { b.disabled = false; b.classList.toggle('ghost', b.getAttribute('data-l') !== (lb || 'yes')); b.classList.toggle('on', b.getAttribute('data-l') === lb); });
    paintBlind();
    $('evNote').disabled = false; $('evNote').value = s.note || '';
    var c = s.card || {}, f = c.fields || {};
    var base = (String(c.summary || '').split(/\n|期望/)[0].match(/\d{2}\s*岁[^|]*(\|[^|]*){0,3}/) || [''])[0].replace(/\s*\|\s*/g, ' · ').trim();
    var lines = isChat(s) ? (window.HRSEngine ? HRSEngine.datedLines(c.workLines) : c.workLines || []) : (c.cardLines && c.cardLines.length ? c.cardLines : c.rowLines || []);
    var rows = lines.map(function (l) {
      var sp = String(l).indexOf(' ');
      return '<li><span>' + esc(sp > 0 ? l.slice(0, sp) : '') + '</span><b>' + esc(sp > 0 ? l.slice(sp + 1) : l) + '</b></li>';
    }).join('');
    var R = s.rules || {};
    var now = st.now[s.id] || {};
    var vline = function (v, extra) { return '<span class="vd v-' + esc(v || '') + '">' + esc(vn(s, v)) + '</span>' + (extra || ''); };
    var verdict = isChat(s)
      ? ['text', 'unified'].map(function (k) {
        var x = now[k] || {}, act = (st.settings.chatEngine === 'unified') === (k === 'unified');
        return '<div class="ev-vrow"><b>' + (k === 'unified' ? '统一判法' : '以前的判法') + (act ? '（正在用）' : '') + '</b>' + vline(x.verdict, x.mode === 'text' && k === 'unified' ? '<em>顶部没读到工作经历，按全文判</em>' : '') + '<p>' + esc(x.reason || '') + '</p></div>';
      }).join('')
      : vline(now.verdict, now.verdict !== s.verdict && s.verdict ? '<em>采集时：' + esc(vn(s, s.verdict)) + '</em>' : '') + '<p>' + esc(now.reason || '') + '</p>';
    $('evCard').innerHTML =
      '<div class="ev-job"><b>' + esc(s.jobTitle || '') + '</b><span>' + new Date(s.at || 0).toLocaleString('zh-CN', { hour12: false }) + ' · ' + (s.site === 'liepin' ? '猎聘' : 'BOSS') + (isChat(s) ? ' · 智选会话' : '') + (s.label && !st.blind ? ' · 已标「' + E.labelOf(s, s.label) + '」' : '') + '</span></div>' +
      '<div class="ev-req">岗位要求：' + esc((R.hardRequirements || []).join(' / ') || '—') + '</div>' +
      '<dl class="ev-who"><dt>基本</dt><dd>' + esc(base || '—') + '</dd><dt>期望</dt><dd>' + esc([f.city, f.expectJob].filter(Boolean).join(' · ') || '—') + '</dd></dl>' +
      '<ul class="ev-rows">' + (rows || '<li><b>' + (isChat(s) ? '会话顶部没读到工作经历' : '卡片上没读到工作经历') + '</b></li>') + '</ul>' +
      (isChat(s) && c.text ? '<details class="ev-full"><summary>在线简历（前 6000 字，已去掉姓名、电话、邮箱）</summary><pre>' + esc(c.text) + '</pre></details>' : '') +
      '<div class="ev-verdict' + (st.show && !st.blind ? '' : ' hide') + '">' + verdict + '</div>';
  }
  // ---------- v3.6.0 每个岗位的打标说明：几个人一起标时按同一个标准 ----------
  function paintGuide() {
    var box = $('evGuide');
    if (!box) return;
    if (!st.job) { box.innerHTML = '<p class="ev-gh">选一个岗位，可以写这个岗位的打标说明（例如「SoC 验证算 IC 验证，FPGA 验证不算」），几个人一起标时按同一个标准</p>'; return; }
    var g = (st.settings.evalGuides || {})[st.job] || '';
    if (document.activeElement && document.activeElement.id === 'evGuideTxt') return;
    box.innerHTML = '<details' + (g ? ' open' : '') + '><summary>打标说明：' + esc(st.job) + (g ? '' : '（还没写）') + '</summary><textarea id="evGuideTxt" placeholder="写清楚什么样的算该打、什么样的不算。导出评测集时一起导出">' + esc(g) + '</textarea></details>';
  }
  document.addEventListener('change', function (e) {
    if (!e.target || e.target.id !== 'evGuideTxt' || !st.job) return;
    var gs = Object.assign({}, st.settings.evalGuides || {});
    var v = e.target.value.trim();
    if (v) gs[st.job] = v; else delete gs[st.job];
    st.settings.evalGuides = gs;
    if (window.HRSOpt) HRSOpt.save({ evalGuides: gs }, '打标说明已保存');
  });
  // ---------- v3.6.0 盲测复核 ----------
  function paintBlind() {
    var bar = $('evBlindBar');
    if (!bar) return;
    bar.hidden = !st.blind;
    if (!st.blind) return;
    var L = shown(), done = L.filter(function (s) { return s.label2 === 'yes' || s.label2 === 'no' || s.label2 === 'unsure'; }).length;
    bar.innerHTML = '<b>盲测复核</b>第 ' + (st.idx + 1) + ' / ' + L.length + ' 张，已标 ' + done + ' 张。不看之前的标注和插件的判定，按现在的理解再标一遍<button class="btn ghost sm" id="evBlindEnd" type="button">结束复核</button>';
  }
  function blindStart() {
    var L = st.list.filter(function (s) { return inKind(s) && (!st.job || s.jobTitle === st.job); });
    var ids = E.blindPick(L, 20);
    if (ids.length < 5) { notify('标过「' + (st.kind === 'chat' ? '合格 / 不合格' : '打 / 不打') + '」的还不到 5 张，先多标一些', true); return; }
    st.blind = { ids: ids };
    st.idx = 0;
    paintCard();
  }
  function blindEnd() {
    var L = shown();
    st.blind = null; st.idx = 0;
    var a = E.agreement(L);
    kpi(); paintCard();
    if (a.n) notify('复核完成：' + a.n + ' 张里两次一样的 ' + a.same + ' 张，一致率 ' + a.rate + '%' + (a.ok ? '' : '，低于 ' + E.AGREE_TARGET + '%。看看哪几张标得不一样，把标准写进打标说明'), !a.ok);
  }
  document.addEventListener('click', function (e) { if (e.target && e.target.id === 'evBlindEnd') blindEnd(); });
  if ($('evBlind')) $('evBlind').addEventListener('click', function () { if (st.blind) blindEnd(); else blindStart(); });

  // ---------- v3.6.0 导入同事导出的评测集 ----------
  function importApply(r, data) {
    var gs = Object.assign({}, (data && data.guides) || {}, st.settings.evalGuides || {});
    var save = function () {
      return send({ type: 'EVAL_IMPORT', list: r.list }).then(function () {
        if (window.HRSOpt && Object.keys(gs).length) HRSOpt.save({ evalGuides: gs }, '打标说明已合并');
        notify('已导入：新增 ' + r.added + ' 张，补上标注 ' + r.labeled + ' 张，一样的 ' + r.same + ' 张' + (r.conflicts.length ? '，标得不一样的 ' + r.conflicts.length + ' 张已按选择处理' : ''));
        $('evImp').hidden = true;
        load();
      });
    };
    if (!r.conflicts.length) { save(); return; }
    var box = $('evImp');
    box.hidden = false;
    box.innerHTML = '<b class="kb-st">两边标得不一样的 ' + r.conflicts.length + ' 张</b><p class="kb-sp">默认保留本机的标注。觉得同事标得对的，选「用导入的」。拿不准的可以先都保留，之后用盲测复核对齐标准</p>' +
      '<table class="cp-tbl"><tr><th>岗位</th><th>本机</th><th>导入的</th><th>用哪个</th></tr>' + r.conflicts.map(function (c, i) {
        var lb = function (l) { return E.labelOf({ kind: c.kind }, l); };
        return '<tr><td>' + esc(c.jobTitle || '') + '</td><td>' + esc(lb(c.local)) + (c.localNote ? '<em>' + esc(c.localNote) + '</em>' : '') + '</td><td>' + esc(lb(c.incoming)) + (c.incomingNote ? '<em>' + esc(c.incomingNote) + '</em>' : '') + '</td>' +
          '<td><label class="chk"><input type="radio" name="evc' + i + '" value="local" checked> 本机的</label> <label class="chk"><input type="radio" name="evc' + i + '" value="in"> 用导入的</label></td></tr>';
      }).join('') + '</table><div class="toolbar" style="margin:8px 0 0;"><button class="btn sm" id="evImpGo" type="button">确认导入</button><button class="btn ghost sm" id="evImpAll" type="button">全部用导入的</button><button class="btn ghost sm" id="evImpCancel" type="button">取消</button></div>';
    var pick = function (all) {
      r.conflicts.forEach(function (c, i) {
        var useIn = all || ((document.querySelector('input[name="evc' + i + '"]:checked') || {}).value === 'in');
        if (!useIn) return;
        var x = r.list.filter(function (s) { return s.id === c.id; })[0];
        if (x) { x.label = c.incoming; x.note = c.incomingNote || x.note; x.labeledAt = Date.now(); }
      });
      save();
    };
    $('evImpGo').onclick = function () { pick(false); };
    $('evImpAll').onclick = function () { pick(true); };
    $('evImpCancel').onclick = function () { box.hidden = true; };
  }
  if ($('evImport')) {
    $('evImport').addEventListener('click', function () { $('evImportFile').value = ''; $('evImportFile').click(); });
    $('evImportFile').addEventListener('change', function () {
      var f = this.files && this.files[0];
      if (!f) return;
      f.text().then(function (t) {
        var data = JSON.parse(t);
        importApply(E.importSet(st.list.map(function (s) { return Object.assign({}, s); }), data), data);
      }).catch(function (e) { notify('导入没成功：' + (e && e.message || e), true); });
    });
  }
  function paintBtnText() {
    var T = { yes: st.kind === 'chat' ? '合格' : '该打招呼', no: st.kind === 'chat' ? '不合格' : '不该打', unsure: '拿不准' }, K0 = { yes: 'Y', no: 'N', unsure: 'U' };
    Array.prototype.forEach.call(document.querySelectorAll('.ev-btns [data-l]'), function (b) { var l = b.getAttribute('data-l'); b.innerHTML = T[l] + ' <kbd>' + K0[l] + '</kbd>'; });
  }
  function paintAll() { paintJobs(); kpi(); paintGuide(); paintCard(); paintKb(); }
  function label(l) {
    var L = shown(), s = L[st.idx];
    if (!s) return;
    if (st.blind) {
      s.label2 = l;
      send({ type: 'EVAL_LABEL2', id: s.id, label2: l });
      if (st.idx >= L.length - 1) { blindEnd(); return; }
      st.idx++;
      paintCard();
      return;
    }
    s.label = s.label === l && st.flt !== 'todo' ? '' : l;
    s.note = $('evNote').value.trim();
    send({ type: 'EVAL_LABEL', id: s.id, label: s.label, note: s.note });
    if (st.flt !== 'todo') st.idx = Math.min(st.idx + 1, L.length - 1);   // 「没标的」里标完这张自然就不在列表里了
    kpi(); paintCard(); paintKb();
  }
  function move(d) { st.idx = Math.max(0, Math.min(shown().length - 1, st.idx + d)); paintCard(); }

  document.querySelector('.ev-btns').addEventListener('click', function (e) {
    var b = e.target.closest('button'); if (!b) return;
    if (b.getAttribute('data-l')) label(b.getAttribute('data-l'));
    if (b.getAttribute('data-nav')) move(+b.getAttribute('data-nav'));
  });
  $('evNote').addEventListener('change', function () {
    var s = shown()[st.idx]; if (!s) return;
    s.note = this.value.trim();
    send({ type: 'EVAL_LABEL', id: s.id, label: s.label || '', note: s.note });
  });
  $('evJob').addEventListener('change', function () { st.job = this.value; st.idx = 0; st.blind = null; kpi(); paintGuide(); paintCard(); });
  $('evKpi').addEventListener('click', function (e) {
    var b = e.target.closest('[data-job]'); if (!b) return;
    st.job = b.getAttribute('data-job'); st.idx = 0; st.blind = null; $('evJob').value = st.job; kpi(); paintGuide(); paintCard();
  });
  if ($('evKind')) $('evKind').addEventListener('change', function () { st.kind = this.value; st.job = ''; st.idx = 0; st.blind = null; try { localStorage.setItem('hrsEvKind', st.kind); } catch (e) {} paintJobs(); kpi(); paintGuide(); paintCard(); });
  try { if (localStorage.getItem('hrsEvKind') === 'chat') st.kind = 'chat'; } catch (e) {}
  if ($('evCmp')) $('evCmp').addEventListener('change', function (e) {
    if (e.target.id !== 'evChatUni') return;
    var v = e.target.checked ? 'unified' : 'text';
    st.settings.chatEngine = v;
    if (window.HRSOpt) HRSOpt.save({ chatEngine: v }, v === 'unified' ? '智选改用统一判法，已打开的沟通页立即生效' : '智选改回以前的判法');
    recompute(); kpi(); paintCard();
  });
  $('evFlt').addEventListener('click', function (e) {
    var b = e.target.closest('button[data-v]'); if (!b) return;
    st.flt = b.getAttribute('data-v'); st.idx = 0;
    Array.prototype.forEach.call(this.children, function (x) { x.classList.toggle('on', x === b); });
    paintCard();
  });
  $('evShow').addEventListener('change', function () { st.show = this.checked; try { localStorage.setItem('hrsEvShow', st.show ? '1' : '0'); } catch (e) {} paintCard(); });
  try { st.show = localStorage.getItem('hrsEvShow') === '1'; $('evShow').checked = st.show; } catch (e) {}
  $('evCollect').addEventListener('change', function () { if (window.HRSOpt) HRSOpt.save({ evalCollect: this.checked }, this.checked ? '已开启采集评测样本' : '已关闭采集评测样本'); });
  $('evExport').addEventListener('click', function () {
    var d = E.exportSet(st.list, st.settings.evalGuides || {});
    if (!d.samples.length) { notify('还没有标过的卡片，先打标再导出', true); return; }
    var blob = new Blob([JSON.stringify(d, null, 2)], { type: 'application/json' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'SmartFilter_评测集_' + new Date().toISOString().slice(0, 10) + '_' + d.samples.length + '张.json';
    a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 60000);
    notify('已导出 ' + d.samples.length + ' 张标过的卡片');
  });
  $('evClear').addEventListener('click', function () {
    var n = st.list.filter(function (s) { return !s.label; }).length;
    if (!n) { notify('没有没标的卡片'); return; }
    if (!confirm('删掉 ' + n + ' 张还没打标的卡片？标过的不动')) return;
    send({ type: 'EVAL_CLEAR' }).then(load);
  });
  document.addEventListener('keydown', function (e) {
    var sec = document.querySelector('.set-sec[data-sec="evalset"]');
    if (!sec || !sec.classList.contains('on') || !sec.offsetParent) return;
    if (/^(INPUT|TEXTAREA|SELECT)$/.test((e.target || {}).tagName || '') || e.ctrlKey || e.metaKey || e.altKey) return;
    var k = e.key.toLowerCase();
    if (k === 'y') label('yes'); else if (k === 'n') label('no'); else if (k === 'u') label('unsure');
    else if (k === 'arrowleft') move(-1); else if (k === 'arrowright') move(1); else return;
    e.preventDefault();
  });

  // ---------- 岗位知识库 ----------
  // v3.4.0 方向可以自己加、自己删：内置的删了可以恢复，自己加的叫法、相近方向都能改
  // 存在设置里：kbExtra（给内置方向补充的叫法）、kbFamilies（自己加的方向）、kbRemoved（删掉的方向）
  var splitWords = function (v) { return String(v || '').split(/[,，、;；\n]+/).map(function (x) { return x.trim(); }).filter(function (x) { return x.length >= 2; }); };
  function extraOf(id) { return ((st.settings.kbExtra || {})[id] || []).slice(); }
  /** 自己加的方向：显示当时填的写法（大小写不变），判断时用的是统一成小写的 */
  function rawKw(f) { var u = (st.settings.kbFamilies || []).filter(function (x) { return x.id === f.id; })[0]; return u && u.kw ? u.kw : f.base; }
  function nearText(f) { return Object.keys(f.near || {}).map(function (k) { return K.name(k) + ' ' + Math.round(f.near[k] * 100) + '%'; }).join('、'); }
  /** 在招岗位里哪些落在这个方向（按岗位名核心部分在知识库里检索） */
  function jobsOf(id) {
    var seen = {}, out = [];
    (st.jds || []).forEach(function (j) {
      var c = M.coreTitle(j.title) || j.title || '';
      if (K.famsOf(c).indexOf(id) < 0) return;
      var k = String(j.title || '').replace(/\s+/g, '');
      if (!seen[k]) { seen[k] = 1; out.push(j.title); }
    });
    return out;
  }
  function paintKb() {
    if (!$('kbTable') || st.kbDirty) return;
    var G = K.GROUPS;
    $('kbTable').innerHTML = '<table class="tbl kb-tbl"><thead><tr><th>方向</th><th>大类</th><th>内置叫法</th><th>相近方向</th><th>补充的叫法（逗号隔开）</th><th></th></tr></thead><tbody>' +
      // 自己加的方向排在最前面，加完马上能看到
      K.KB.filter(function (f) { return f.custom; }).concat(K.KB.filter(function (f) { return !f.custom; })).map(function (f) {
        var js = jobsOf(f.id);
        var who = js.length ? '<em class="kb-jobs" data-tip="' + esc(js.join('、')) + '">在招 ' + js.length + ' 个：' + esc(js.slice(0, 2).join('、')) + (js.length > 2 ? ' 等' : '') + '</em>' : '';
        var head = '<td><b>' + esc(f.n) + '</b>' + (f.custom ? '<i class="kb-tag">自定义</i>' : '') + who + '</td><td>' + esc(G[f.g] || f.g) + '</td>';
        var del = '<td class="kb-op"><button class="btn ghost sm" type="button" data-del="' + esc(f.id) + '">删除</button></td>';
        if (f.custom) {
          return '<tr class="kb-custom">' + head + '<td class="kb-muted">自己加的</td>' +
            '<td><input type="text" data-near="' + esc(f.id) + '" value="' + esc(nearText(f)) + '" placeholder="例如：模拟设计 60%"></td>' +
            '<td><input type="text" data-kwc="' + esc(f.id) + '" value="' + esc(rawKw(f).join('，')) + '" placeholder="至少写一个叫法"></td>' + del + '</tr>';
        }
        return '<tr>' + head + '<td><details><summary>' + f.base.length + ' 个</summary><p>' + esc(f.base.join('、')) + '</p></details></td><td class="kb-near">' + esc(nearText(f) || '—') + '</td>' +
          '<td><input type="text" data-kb="' + esc(f.id) + '" value="' + esc(extraOf(f.id).join('，')) + '" placeholder="例如：芯片功能仿真"></td>' + del + '</tr>';
      }).join('') + '</tbody></table>';
    var rm = K.removedBuiltins(st.settings);
    $('kbRemoved').hidden = !rm.length;
    $('kbRemoved').innerHTML = rm.length ? '<b>已删除的内置方向</b><span>判断时不再用，点「恢复」加回来</span><div>' + rm.map(function (f) {
      return '<span class="kb-rm">' + esc(f.n) + '<button class="btn ghost sm" type="button" data-restore="' + esc(f.id) + '">恢复</button></span>';
    }).join('') + '</div>' : '';
    var nearSel = $('kbNewNear');
    if (nearSel && !nearSel.value) nearSel.placeholder = '相近方向（选填），例如：' + (K.KB[0] ? K.KB[0].n : '数字验证') + ' 60%';
    var sug = E.kbSuggestions(st.list, M, K, function (s) { var n = st.now[s.id] || s; return isChat(s) ? (n.unified || {}).verdict : n.verdict; }).slice(0, 12);
    $('kbSuggest').innerHTML = '<b class="kb-st">建议新增的叫法</b><p class="kb-sp">来自评测集：标了「该打招呼」、插件没打，而且职位在知识库里认不出方向的。确认是同一个方向再加</p>' +
      (sug.length ? '<ul class="kb-sug">' + sug.map(function (x) {
        return '<li><b>' + esc(x.title) + '</b><span>出现 ' + x.count + ' 次 · ' + esc(x.jobs.join('、')) + '</span><button class="btn ghost sm" type="button" data-add="' + esc(x.fam) + '" data-w="' + esc(x.title.replace(/工程师$/, '')) + '">加到「' + esc(x.famName) + '」</button></li>';
      }).join('') + '</ul>' : (window.HRSEmpty ? HRSEmpty.html('filter', { compact: true, text: '暂时没有。评测集里标得越多，这里的建议越准' }) : '暂时没有'));
  }
  /** 表格里现在填的内容 → { kbExtra, kbFamilies }。自己加的方向叫法清空了不保存这个改动，返回 error */
  function collectKb() {
    var extra = {}, err = '';
    Array.prototype.forEach.call(document.querySelectorAll('#kbTable input[data-kb]'), function (i) {
      var ws = splitWords(i.value);
      if (ws.length) extra[i.getAttribute('data-kb')] = ws;
    });
    var fams = (st.settings.kbFamilies || []).map(function (u) {
      var x = JSON.parse(JSON.stringify(u));
      var ki = document.querySelector('#kbTable input[data-kwc="' + u.id + '"]'), ni = document.querySelector('#kbTable input[data-near="' + u.id + '"]');
      if (ki) { var ws = splitWords(ki.value); if (ws.length) x.kw = ws; else err = '「' + u.n + '」至少要有一个叫法'; }
      if (ni) { var pn = K.parseNear(ni.value); x.near = pn.near; if (pn.unknown.length) err = '「' + u.n + '」的相近方向里认不出：' + pn.unknown.join('、') + '。写表格里已有的方向名'; }
      return x;
    });
    return { kbExtra: extra, kbFamilies: fams, error: err };
  }
  function saveKb(patch, msg) {
    var c = collectKb();
    if (c.error) { notify(c.error, true); return Promise.resolve(false); }
    var all = Object.assign({ kbExtra: c.kbExtra, kbFamilies: c.kbFamilies, kbRemoved: (st.settings.kbRemoved || []).slice() }, patch || {});
    var save = window.HRSOpt ? HRSOpt.save(all, msg) : HRSStore.saveSettings(all);
    return Promise.resolve(save).then(function () {
      st.kbDirty = false;
      Object.assign(st.settings, all);
      recompute(); paintAll();
      return true;
    });
  }
  document.addEventListener('input', function (e) { if (e.target.closest && e.target.closest('#kbTable')) st.kbDirty = true; });
  $('kbSuggest').addEventListener('click', function (e) {
    var b = e.target.closest('[data-add]'); if (!b) return;
    var id = b.getAttribute('data-add');
    var inp = document.querySelector('#kbTable input[data-kb="' + id + '"]') || document.querySelector('#kbTable input[data-kwc="' + id + '"]'); if (!inp) return;
    var w = b.getAttribute('data-w');
    inp.value = inp.value ? inp.value + '，' + w : w;
    st.kbDirty = true;
    inp.focus();
    notify('已填到「' + K.name(id) + '」，确认后点「保存修改」');
  });
  $('kbSave').addEventListener('click', function () { saveKb(null, '岗位知识库已保存，已打开的 BOSS / 猎聘页面立即生效'); });
  // 新增方向
  $('kbNewAdd').addEventListener('click', function () {
    var n = $('kbNewName').value.trim(), kw = splitWords($('kbNewKw').value), pn = K.parseNear($('kbNewNear').value);
    if (n.length < 2) { notify('方向名称至少两个字', true); $('kbNewName').focus(); return; }
    var clash = K.KB.concat(K.removedBuiltins(st.settings)).filter(function (f) { return K.clean(f.n) === K.clean(n); })[0];
    if (clash) { notify('已经有「' + clash.n + '」这个方向' + (clash.builtin && (st.settings.kbRemoved || []).indexOf(clash.id) >= 0 ? '（删掉了，到下面点「恢复」）' : '，给它补充叫法就行'), true); return; }
    if (!kw.length) { notify('至少写一个叫法，例如方向名称本身', true); $('kbNewKw').focus(); return; }
    if (pn.unknown.length) { notify('相近方向里认不出：' + pn.unknown.join('、') + '。写表格里已有的方向名', true); return; }
    var fam = { id: 'u_' + Date.now().toString(36), n: n, g: $('kbNewG').value, kw: kw, near: pn.near };
    var cur = collectKb();
    if (cur.error) { notify(cur.error, true); return; }
    st.settings.kbFamilies = cur.kbFamilies.concat([fam]);
    saveKb(null, '已新增方向「' + n + '」，已打开的 BOSS / 猎聘页面立即生效').then(function (ok) {
      if (!ok) return;
      ['kbNewName', 'kbNewKw', 'kbNewNear'].forEach(function (k) { $(k).value = ''; });
    });
  });
  // 删除、恢复
  $('kbTable').addEventListener('click', function (e) {
    var b = e.target.closest('[data-del]'); if (!b) return;
    var id = b.getAttribute('data-del'), f = K.KB.filter(function (x) { return x.id === id; })[0]; if (!f) return;
    var js = jobsOf(id);
    var warn = js.length ? '\n\n在招岗位「' + js.slice(0, 5).join('、') + (js.length > 5 ? '」等 ' + js.length + ' 个' : '」') + '靠这个方向判断「做过本岗位」「和招聘岗位相关」，删掉后这些岗位更容易漏打。' : '';
    if (!confirm('删除方向「' + f.n + '」？' + warn + (f.custom ? '\n\n自己加的方向删了不能恢复，要用得重新加。' : '\n\n内置的方向删了可以在下面恢复。'))) return;
    if (f.custom) {
      var cur = collectKb();
      st.settings.kbFamilies = cur.kbFamilies.filter(function (x) { return x.id !== id; });
      saveKb(null, '已删除方向「' + f.n + '」');
    } else saveKb({ kbRemoved: (st.settings.kbRemoved || []).concat([id]) }, '已删除方向「' + f.n + '」，需要时可以恢复');
  });
  $('kbRemoved').addEventListener('click', function (e) {
    var b = e.target.closest('[data-restore]'); if (!b) return;
    var id = b.getAttribute('data-restore');
    saveKb({ kbRemoved: (st.settings.kbRemoved || []).filter(function (x) { return x !== id; }) }, '已恢复方向「' + K.name(id) + '」');
  });

  chrome.storage.onChanged.addListener(function (ch, area) {
    if (area !== 'local') return;
    if (ch.settings) {
      var was = st.settings.chatEngine, kbWas = JSON.stringify([st.settings.kbExtra, st.settings.kbFamilies, st.settings.kbRemoved]);
      st.settings = ch.settings.newValue || {}; $('evCollect').checked = st.settings.evalCollect !== false;
      if (kbWas !== JSON.stringify([st.settings.kbExtra, st.settings.kbFamilies, st.settings.kbRemoved])) { recompute(); paintAll(); }   // 别的页面改了知识库
      else if (was !== st.settings.chatEngine) { recompute(); kpi(); paintCard(); }
    }
    if (ch.evalSamples) {
      // 别的页面采集了新卡片：数字更新，当前这张不跳
      var keep = {};
      st.list.forEach(function (s) { keep[s.id] = s; });
      st.list = (ch.evalSamples.newValue || []).slice().sort(function (a, b) { return (b.at || 0) - (a.at || 0); });
      var fresh = st.list.filter(function (s) { return !keep[s.id]; });
      if (fresh.length) { K.applySettings(st.settings); fresh.forEach(rerunOne); }
      paintJobs(); kpi();
    }
  });
  chrome.storage.local.get('settings', function (o) { $('evCollect').checked = ((o.settings || {}).evalCollect !== false); });
  load();
})();
