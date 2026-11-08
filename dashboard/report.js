/* report.js v2.2.2：招聘分析看板 + 人事部输出（周报 / 月报 Word、数据 Excel、人才库清单 Excel）
 * 只读数据，不改任何筛选、打招呼、存储逻辑。
 * 数据来源：人才库（候选人进入时间 seenAt、判定、来源、岗位、简历状态、跟进状态）、
 *           处理记录（索要简历、收到简历）、打招呼记录（greetHistory / greetHistoryLiepin，按平台各保留 180 天）。 */
(function () {
  'use strict';
  function $(id) { return document.getElementById(id); }
  var DAY = 86400000;
  // v2.9.0 图表颜色读令牌，浅色、深色各自正确
  var K = function (n, d) { return window.HRSChart ? HRSChart.c(n, d) : d; };
  var D = { cands: [], events: [], jds: [], greet: { boss: [], liepin: [] }, loaded: false };
  // 周一打开时默认看上周（写周报的时候），其他日子默认看本周
  var ST = { period: new Date().getDay() === 1 ? 'lastweek' : 'week', site: '', jd: '' };
  var charts = {};

  // ---------------- 工具 ----------------
  function esc(s) { return String(s == null ? '' : s).replace(/[<>&"]/g, function (c) { return { '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c]; }); }
  function p2(n) { return String(n).padStart(2, '0'); }
  function ymd(t) { var d = new Date(t); return d.getFullYear() + '-' + p2(d.getMonth() + 1) + '-' + p2(d.getDate()); }
  function md(t) { var d = new Date(t); return (d.getMonth() + 1) + '/' + d.getDate(); }
  function day0(t) { var d = new Date(t); d.setHours(0, 0, 0, 0); return d.getTime(); }
  function pct(a, b) { return b ? Math.round(a / b * 1000) / 10 : 0; }
  function srcName(s) { return s === 'boss' ? 'Boss直聘' : s === 'liepin' ? '猎聘' : '手动上传'; }
  function vName(v) { return v === 'pass' ? '通过' : v === 'review' ? '待复核' : '拒绝'; }
  function statusName(s) { return { new: '新获取', contacted: '已联系', interview: '已约面', offer: '已发Offer', rejected: '已淘汰', review: '待复核' }[s] || s || '新获取'; }
  function safe(s) { return String(s || '').replace(/[\\/:*?"<>|]/g, '_'); }

  // ---------------- 统计周期 ----------------
  var PERIODS = { week: '本周', lastweek: '上周', month: '本月', lastmonth: '上月', d30: '近 30 天' };
  function range(k) {
    var now = new Date(), t0 = day0(now), dow = (now.getDay() + 6) % 7, s, e;
    if (k === 'week') { s = t0 - dow * DAY; e = t0 + DAY; }
    else if (k === 'lastweek') { e = t0 - dow * DAY; s = e - 7 * DAY; }
    else if (k === 'month') { s = new Date(now.getFullYear(), now.getMonth(), 1).getTime(); e = t0 + DAY; }
    else if (k === 'lastmonth') { s = new Date(now.getFullYear(), now.getMonth() - 1, 1).getTime(); e = new Date(now.getFullYear(), now.getMonth(), 1).getTime(); }
    else { s = t0 - 29 * DAY; e = t0 + DAY; }
    // 上一期：本周 / 本月 对比上期同样天数，方便看「到今天为止」快了还是慢了
    var len = e - s, ps, pe;
    if (k === 'month') { ps = new Date(now.getFullYear(), now.getMonth() - 1, 1).getTime(); pe = ps + len; }
    else if (k === 'lastmonth') { ps = new Date(now.getFullYear(), now.getMonth() - 2, 1).getTime(); pe = s; }
    else { ps = s - len; pe = s; }
    return { s: s, e: e, ps: ps, pe: pe, label: PERIODS[k], text: ymd(s) + ' 至 ' + ymd(e - 1) };
  }
  function reportName(k) { return /week/.test(k) ? '周报' : /month/.test(k) ? '月报' : '报告'; }

  // ---------------- 读数据 ----------------
  function load() {
    var store = window.HRSStore;
    if (!store) return Promise.resolve();
    return Promise.all([
      store.getAllCandidates(),
      store.getEvents(50000),
      store.getJds(),
      new Promise(function (r) { chrome.storage.local.get(['greetHistory', 'greetHistoryLiepin'], r); })
    ]).then(function (x) {
      D.cands = x[0] || []; D.events = x[1] || []; D.jds = x[2] || [];
      var vals = function (o) { return Object.keys(o || {}).map(function (k) { return +o[k]; }).filter(function (t) { return t > 0; }); };
      D.greet = { boss: vals(x[3].greetHistory), liepin: vals(x[3].greetHistoryLiepin) };
      D.loaded = true;
    });
  }

  // ---------------- 计算 ----------------
  function inR(t, s, e) { return t >= s && t < e; }
  function candsIn(s, e, site, jd) {
    return D.cands.filter(function (c) {
      if (!inR(+c.seenAt || 0, s, e)) return false;
      if (site && c.source !== site) return false;
      if (jd && c.jdId !== jd) return false;
      return true;
    });
  }
  function greetIn(s, e, site) {
    var n = 0;
    ['boss', 'liepin'].forEach(function (k) { if (!site || site === k) D.greet[k].forEach(function (t) { if (inR(t, s, e)) n++; }); });
    return n;
  }
  function received(c) { return c.resumeStatus === 'received' || (c.resumeFiles || []).length > 0; }
  function asked(c) { return received(c) || c.resumeStatus === 'waiting' || c.resumeStatus === 'requested'; }
  function met(c) { return c.contactStatus === 'interview' || c.contactStatus === 'offer'; }
  // 一个周期的全部指标。site / jd 为空表示全部
  function metrics(s, e, site, jd) {
    var cs = candsIn(s, e, site, jd).filter(function (c) { return c.source === 'boss' || c.source === 'liepin' || (!site && c.source === 'upload'); });
    var pass = cs.filter(function (c) { return c.verdict === 'pass'; });
    var scored = cs.filter(function (c) { return c.score != null; });
    return {
      greet: jd ? null : greetIn(s, e, site),
      screen: cs.length,
      pass: pass.length,
      review: cs.filter(function (c) { return c.verdict === 'review'; }).length,
      reject: cs.filter(function (c) { return c.verdict === 'reject'; }).length,
      passRate: pct(pass.length, cs.length),
      asked: cs.filter(asked).length,
      resume: cs.filter(received).length,
      interview: cs.filter(met).length,
      offer: cs.filter(function (c) { return c.contactStatus === 'offer'; }).length,
      avgScore: scored.length ? Math.round(scored.reduce(function (a, c) { return a + (+c.score || 0); }, 0) / scored.length) : 0,
      list: cs
    };
  }
  function daily(s, e, site, jd) {
    var days = [], g = [], sc = [], ps = [];
    for (var t = s; t < e; t += DAY) {
      var m = metrics(t, t + DAY, site, jd);
      days.push(md(t)); g.push(m.greet || 0); sc.push(m.screen); ps.push(m.pass);
    }
    return { days: days, greet: g, screen: sc, pass: ps };
  }
  function reasons(list) {
    var map = {};
    list.filter(function (c) { return c.verdict === 'reject'; }).forEach(function (c) {
      var r = String((c.reasons || [])[0] || '其他');
      if (/排除词|否决/.test(r)) r = '命中排除词';
      else if (/缺少必备|未命中|关键词/.test(r)) r = '缺少必备技能';
      else if (/学历/.test(r)) r = '学历不符';
      else if (/经验|年限|应届/.test(r)) r = '经验不足';
      else if (/薪资|期望/.test(r)) r = '薪资不符';
      else if (/城市|地点/.test(r)) r = '城市不符';
      else if (/年龄/.test(r)) r = '年龄不符';
      else r = '其他';
      map[r] = (map[r] || 0) + 1;
    });
    return Object.keys(map).map(function (k) { return { name: k, value: map[k] }; }).sort(function (a, b) { return b.value - a.value; });
  }
  function delta(cur, prev) {
    if (cur == null || prev == null) return null;
    if (!prev) return cur ? { up: true, txt: '新增' } : { up: null, txt: '持平' };
    var d = Math.round((cur - prev) / prev * 100);
    return { up: d > 0 ? true : d < 0 ? false : null, txt: (d > 0 ? '+' : '') + d + '%' };
  }
  var STEPS = [['screen', '筛选'], ['pass', '合格'], ['asked', '已索要简历'], ['resume', '收到简历'], ['interview', '约面'], ['offer', 'Offer']];
  function snapshot() {
    var r = range(ST.period);
    var cur = metrics(r.s, r.e, ST.site, ST.jd), prev = metrics(r.ps, r.pe, ST.site, ST.jd);
    var jds = D.jds.filter(function (j) { return !ST.jd || j.id === ST.jd; }).map(function (j) {
      var m = metrics(r.s, r.e, ST.site, j.id); m.title = j.title; return m;
    }).filter(function (m) { return m.screen > 0; }).sort(function (a, b) { return b.screen - a.screen; });
    var ch = { boss: metrics(r.s, r.e, 'boss', ST.jd), liepin: metrics(r.s, r.e, 'liepin', ST.jd) };
    return { r: r, cur: cur, prev: prev, jds: jds, ch: ch, day: daily(r.s, Math.min(r.e, day0(Date.now()) + DAY), ST.site, ST.jd), reasons: reasons(cur.list) };
  }

  // ---------------- 画面 ----------------
  function mk(id) {
    var el = $(id);
    if (!el) return null;
    if (!charts[id]) charts[id] = echarts.init(el);
    return charts[id];
  }
  var KPI = [
    ['greet', '打招呼', '人', '在推荐页主动打招呼'],
    ['screen', '智选筛选', '人', '沟通列表里判定过的候选人'],
    ['pass', '合格', '人', '符合岗位要求'],
    ['passRate', '合格率', '%', '合格 ÷ 筛选'],
    ['resume', '收到简历', '份', '候选人回传的简历'],
    ['interview', '约面', '人', '跟进状态为已约面或已发 Offer'],
    ['offer', '发 Offer', '人', '跟进状态为已发 Offer']
  ];
  function renderKpis(S) {
    $('rpKpis').innerHTML = KPI.map(function (k) {
      var v = S.cur[k[0]], dl = delta(v, S.prev[k[0]]);
      if (v == null) return '';
      return '<div class="rp-kpi' + (k[0] === 'passRate' ? ' hl' : '') + '"><span class="l">' + k[1] + '</span>' +
        '<b class="num">' + v + '<small>' + k[2] + '</small></b>' +
        '<span class="d' + (dl && dl.up === true ? ' up' : dl && dl.up === false ? ' down' : '') + '" data-tip="' + k[3] + '。上一期：' + S.prev[k[0]] + k[2] + '">' + (dl ? '较上期 ' + dl.txt : '') + '</span></div>';
    }).join('');
    $('rpRange').textContent = S.r.text;
    var n = reportName(ST.period);
    $('rpDocx').textContent = '导出' + n + ' Word';
  }
  function renderTrend(S) {
    var c = mk('rpTrend'); if (!c) return;
    var series = [];
    if (!ST.jd) series.push({ name: '打招呼', type: 'line', smooth: true, symbol: 'none', data: S.day.greet, lineStyle: { width: 2, color: K('--chart-4', '#9DB3CB') }, itemStyle: { color: K('--chart-4', '#9DB3CB') } });
    series.push({ name: '筛选', type: 'line', smooth: true, symbol: 'none', data: S.day.screen, lineStyle: { width: 2.5, color: K('--chart-1', '#0B3A6E') }, itemStyle: { color: K('--chart-1', '#0B3A6E') }, areaStyle: { color: K('--chart-1', '#0B3A6E'), opacity: .1 } });
    series.push({ name: '合格', type: 'bar', barMaxWidth: 14, data: S.day.pass, itemStyle: { color: K('--chart-2', '#0E9AA7'), borderRadius: [3, 3, 0, 0] } });
    c.setOption({
      tooltip: { trigger: 'axis', confine: true }, legend: { top: 0, right: 0, itemWidth: 10, itemHeight: 10, icon: 'roundRect' },
      grid: { left: 32, right: 8, top: 34, bottom: 22 },
      xAxis: { type: 'category', data: S.day.days, axisLabel: { interval: S.day.days.length > 14 ? 3 : 0 } },
      yAxis: { type: 'value', minInterval: 1 }, series: series
    }, true);
  }
  function renderFunnel(S) {
    var c = mk('rpFunnel'); if (!c) return;
    var data = STEPS.map(function (s) { return { name: s[1], value: S.cur[s[0]] }; });
    c.setOption({
      tooltip: { trigger: 'item', confine: true, formatter: function (p) { return p.name + '：' + p.value + (p.dataIndex ? '<br>占筛选 ' + pct(p.value, data[0].value) + '%' : ''); } },
      series: [{
        type: 'funnel', left: 8, right: 96, top: 6, bottom: 6, minSize: '14%', sort: 'none', gap: 3,
        label: { position: 'right', color: K('--text-2', '#4A5568'), fontSize: 12, formatter: function (p) { return p.name + '  ' + p.value; } },
        labelLine: { show: false },
        itemStyle: { borderWidth: 0, color: function (p) { return [K('--chart-6', '#2F6690'), K('--chart-1', '#0B3A6E'), K('--chart-3', '#5D7FA8'), K('--chart-4', '#9DB3CB'), K('--chart-2', '#0E9AA7'), K('--chart-ok', '#157F3B')][p.dataIndex]; } },
        data: data
      }]
    }, true);
  }
  function renderJdFunnel(S) {
    var box = $('rpJdFunnel');
    if (!S.jds.length) { box.innerHTML = window.HRSEmpty ? HRSEmpty.html('pool', { compact: true, title: '本期还没有候选人进入人才库', text: '智选或打招呼判为合格、待复核的人会按岗位出现在这里' }) : '<div class="rp-empty">本期还没有候选人进入人才库</div>'; return; }
    box.innerHTML = '<div class="rp-jf rp-jf-h"><span>岗位</span>' + STEPS.map(function (s) { return '<span>' + s[1] + '</span>'; }).join('') + '<span>合格率</span></div>' +
      S.jds.map(function (m) {
        return '<div class="rp-jf"><span class="t" title="' + esc(m.title) + '">' + esc(m.title) + '</span>' + STEPS.map(function (s, i) {
          var v = m[s[0]], base = m.screen || 1;
          return '<span class="c"><b class="num">' + v + '</b><i style="width:' + Math.max(v ? 4 : 0, Math.round(v / base * 100)) + '%"></i>' +
            (i ? '<em>占筛选 ' + pct(v, m.screen) + '%</em>' : '') + '</span>';
        }).join('') + '<span class="r num">' + m.passRate + '%</span></div>';
      }).join('');
  }
  var CH = [['greet', '打招呼', '人'], ['screen', '智选筛选', '人'], ['pass', '合格', '人'], ['passRate', '合格率', '%'], ['avgScore', '平均匹配分', '分'], ['resume', '收到简历', '份'], ['interview', '约面', '人']];
  function renderChannel(S) {
    var b = S.ch.boss, l = S.ch.liepin;
    var rows = CH.filter(function (k) { return b[k[0]] != null; });
    $('rpChannel').innerHTML = '<div class="rp-bf rp-bf-h"><span class="lb"><i class="pdot boss"></i>Boss直聘</span><span></span><span class="rb">猎聘<i class="pdot lp"></i></span></div>' +
      rows.map(function (k) {
        var x = +b[k[0]] || 0, y = +l[k[0]] || 0, mx = Math.max(x, y) || 1, win = x === y ? '' : x > y ? 'l' : 'r';
        return '<div class="rp-bf"><span class="bar l' + (win === 'l' ? ' win' : '') + '"><em class="num">' + x + k[2] + '</em><i style="width:' + Math.round(x / mx * 100) + '%"></i></span>' +
          '<span class="k">' + k[1] + '</span>' +
          '<span class="bar r' + (win === 'r' ? ' win' : '') + '"><i style="width:' + Math.round(y / mx * 100) + '%"></i><em class="num">' + y + k[2] + '</em></span></div>';
      }).join('') +
      '<div class="rp-foot">' + channelSummary(S) + '</div>';
  }
  function channelSummary(S) {
    var b = S.ch.boss, l = S.ch.liepin;
    if (!b.screen && !l.screen) return '本期两个平台都还没有筛选记录';
    var who = b.passRate === l.passRate ? '两个平台合格率相同' : (b.passRate > l.passRate ? 'Boss直聘' : '猎聘') + '的合格率更高（' + Math.max(b.passRate, l.passRate) + '% 对 ' + Math.min(b.passRate, l.passRate) + '%）';
    var more = b.pass === l.pass ? '' : '，合格人数' + (b.pass > l.pass ? 'Boss直聘' : '猎聘') + '更多';
    return who + more;
  }
  function renderReasons(S) {
    var c = mk('rpReason'); if (!c) return;
    var d = S.reasons.slice(0, 7).reverse();
    c.setOption({
      tooltip: { confine: true }, grid: { left: 84, right: 34, top: 4, bottom: 4 },
      xAxis: { type: 'value', show: false }, yAxis: { type: 'category', data: d.map(function (x) { return x.name; }), axisLine: { show: false } },
      series: [{ type: 'bar', data: d.map(function (x) { return x.value; }), barWidth: 12, itemStyle: { color: K('--chart-coral', '#C7685F'), borderRadius: [0, 6, 6, 0] }, label: { show: true, position: 'right', color: K('--text-2', '#4A5568'), fontSize: 11 }, showBackground: true, backgroundStyle: { color: '#F3F5F8', borderRadius: [0, 6, 6, 0] } }]
    }, true);
    $('rpReasonEmpty').style.display = d.length ? 'none' : 'block';
  }
  function topList(S) {
    return S.cur.list.filter(function (c) { return c.verdict !== 'reject'; }).sort(function (a, b) { return (b.score || 0) - (a.score || 0); });
  }
  function renderList(S) {
    var L = topList(S);
    $('rpListN').textContent = L.length ? '共 ' + L.length + ' 人，按匹配分从高到低' : '';
    $('rpList').innerHTML = L.length ? '<table class="tbl rp-tbl"><thead><tr><th>姓名</th><th>岗位</th><th>来源</th><th>学历</th><th>经验</th><th>城市</th><th>匹配分</th><th>判定</th><th>简历</th><th>跟进</th></tr></thead><tbody>' +
      L.slice(0, 12).map(function (c) {
        var f = c.fields || {};
        return '<tr><td><b>' + esc(c.name || f.name || '-') + '</b></td><td>' + esc(c.jdTitle || '-') + '</td><td>' + srcName(c.source) + '</td><td>' + esc(f.eduText || '-') + '</td><td>' + (f.expYears != null ? f.expYears + ' 年' : '-') + '</td><td>' + esc(f.city || '-') + '</td>' +
          '<td><span class="rp-score"><s><i style="width:' + (+c.score || 0) + '%"></i></s><b class="num">' + (c.score || 0) + '</b></span></td>' +
          '<td><span class="verdict v-' + (c.verdict === 'pass' ? 'pass' : 'review') + '">' + vName(c.verdict) + '</span></td><td>' + (received(c) ? '已收到' : asked(c) ? '已索要' : '-') + '</td><td>' + statusName(c.contactStatus) + '</td></tr>';
      }).join('') + '</tbody></table>' + (L.length > 12 ? '<div class="rp-more">只显示前 12 人，完整名单点右上角「导出人才库清单」</div>' : '')
      : (window.HRSEmpty ? HRSEmpty.html('pool', { compact: true, title: '本期没有合格或待复核的候选人', text: '换个时间范围或岗位看看' }) : '<div class="rp-empty">本期没有合格或待复核的候选人</div>');
  }
  function fillJd() {
    var sel = $('rpJd'), cur = sel.value;
    sel.innerHTML = '<option value="">全部岗位</option>' + D.jds.map(function (j) { return '<option value="' + esc(j.id) + '">' + esc(j.title) + '</option>'; }).join('');
    sel.value = cur;
  }
  var last = null;
  function render() {
    if (!D.loaded || !$('rpKpis')) return;
    fillJd();
    var S = last = snapshot();
    renderKpis(S); renderTrend(S); renderFunnel(S); renderJdFunnel(S); renderChannel(S); renderReasons(S); renderList(S);
    $('rpSummary').textContent = summaryText(S);
    renderEmpty(S);
    if (window.HRSEmpty) HRSEmpty.ready();
  }
  // v3.0.0 这个周期一点数据都没有：上面先放一张空状态，告诉下一步做什么
  function renderEmpty(S) {
    var box = $('rpEmptyAll');
    if (!box || !window.HRSEmpty) return;
    var c = S.cur;
    var none = !c.greet && !c.screen && !c.resume && !c.interview && !c.offer && !(c.list || []).length;
    box.hidden = !none;
    if (!none) { box.innerHTML = ''; return; }
    var acts = [];
    if (ST.period !== 'd30') acts.push({ label: '看近 30 天', click: '#rpPeriod span[data-p="d30"]' });
    acts.push({ label: '打开 BOSS 推荐牛人', go: 'https://www.zhipin.com/web/chat/recommend', primary: !acts.length });
    box.innerHTML = HRSEmpty.html('stats', { title: S.r.label + '还没有数据', text: '在 BOSS / 猎聘上打招呼、智选以后，这里会按天统计打招呼、筛选、合格、收到简历和约面的人数', actions: acts });
  }
  function summaryText(S) {
    var c = S.cur, p = S.prev, parts = [];
    var cmp = function (a, b) { var d = delta(a, b); return d && d.txt !== '持平' ? '（较上期 ' + d.txt + '）' : ''; };
    if (c.greet != null) parts.push('打招呼 ' + c.greet + ' 人' + cmp(c.greet, p.greet));
    parts.push('智选筛选 ' + c.screen + ' 人' + cmp(c.screen, p.screen));
    parts.push('合格 ' + c.pass + ' 人，合格率 ' + c.passRate + '%');
    parts.push('收到简历 ' + c.resume + ' 份，约面 ' + c.interview + ' 人，发 Offer ' + c.offer + ' 人');
    var s = S.r.label + '（' + S.r.text + '）' + parts.join('，') + '。';
    if (S.jds.length) s += '筛选量最多的岗位是「' + S.jds[0].title + '」（' + S.jds[0].screen + ' 人，合格率 ' + S.jds[0].passRate + '%）。';
    if (S.reasons.length) s += '不合格的主要原因是' + S.reasons.slice(0, 2).map(function (x) { return '「' + x.name + '」' + x.value + ' 人'; }).join('、') + '。';
    return s;
  }

  // ---------------- 输出 ----------------
  function save(path, blob) {
    var url = URL.createObjectURL(blob);
    chrome.downloads.download({ url: url, filename: path, saveAs: false }, function () { void chrome.runtime.lastError; });
    setTimeout(function () { URL.revokeObjectURL(url); }, 120000);
  }
  function note(t, err) { if (window.HRSNotify) window.HRSNotify[err ? 'error' : 'success'](t); else alert(t); }
  function scopeText() {
    var j = D.jds.find(function (x) { return x.id === ST.jd; });
    return (ST.site ? srcName(ST.site) : '全部平台') + ' · ' + (j ? j.title : '全部岗位');
  }
  function candRows(L) {
    return [['姓名', '岗位', '来源', '性别', '年龄', '学历', '经验(年)', '城市', '期望薪资', '联系方式', '匹配分', '判定', '简历', '跟进状态', '进入人才库时间', '判定原因']].concat(L.map(function (c) {
      var f = c.fields || {};
      return [c.name || f.name || '', c.jdTitle || '', srcName(c.source), f.gender || '', f.age != null ? +f.age : '', f.eduText || '', f.expYears != null ? +f.expYears : '', f.city || '',
        f.salaryMin != null ? f.salaryMin + '-' + (f.salaryMax != null ? f.salaryMax : '') + '万' : (f.salary || ''), f.phone || '', +c.score || 0, vName(c.verdict),
        received(c) ? '已收到' : asked(c) ? '已索要' : '', statusName(c.contactStatus), c.seenAt ? new Date(c.seenAt).toLocaleString('zh-CN', { hour12: false }) : '', (c.reasons || []).join('；')];
    }));
  }
  var CW = [10, 18, 10, 6, 6, 8, 8, 8, 12, 14, 8, 8, 8, 10, 18, 40];
  function exportXlsx() {
    var S = last; if (!S || !window.HRSXlsx) return note('导出组件没有加载，请刷新页面', true);
    var kpi = [['指标', S.r.label, '上一期', '变化']].concat(KPI.filter(function (k) { return S.cur[k[0]] != null; }).map(function (k) { var d = delta(S.cur[k[0]], S.prev[k[0]]); return [k[1] + '（' + k[2] + '）', S.cur[k[0]], S.prev[k[0]], d ? d.txt : '']; }));
    var jf = [['岗位'].concat(STEPS.map(function (s) { return s[1]; })).concat(['合格率', '平均匹配分'])].concat(S.jds.map(function (m) { return [m.title].concat(STEPS.map(function (s) { return m[s[0]]; })).concat([m.passRate + '%', m.avgScore]); }));
    var ch = [['指标', 'Boss直聘', '猎聘']].concat(CH.map(function (k) { return [k[1] + '（' + k[2] + '）', S.ch.boss[k[0]] == null ? '' : S.ch.boss[k[0]], S.ch.liepin[k[0]] == null ? '' : S.ch.liepin[k[0]]]; }));
    var dd = [['日期', '打招呼', '筛选', '合格']].concat(S.day.days.map(function (d, i) { return [d, S.day.greet[i], S.day.screen[i], S.day.pass[i]]; }));
    var rs = [['不合格原因', '人数']].concat(S.reasons.map(function (x) { return [x.name, x.value]; }));
    var blob = HRSXlsx.write([
      { name: '核心指标', rows: [['Smart Filter 招聘' + reportName(ST.period) + '数据', S.r.text + ' · ' + scopeText()]].concat([[]]).concat(kpi), widths: [22, 14, 14, 12] },
      { name: '岗位漏斗', rows: jf, widths: [24, 8, 8, 12, 10, 8, 8, 10, 12] },
      { name: '渠道对比', rows: ch, widths: [18, 12, 12] },
      { name: '每日明细', rows: dd, widths: [10, 10, 10, 10] },
      { name: '不合格原因', rows: rs, widths: [18, 10] },
      { name: '本期候选人', rows: candRows(S.cur.list.slice().sort(function (a, b) { return (b.score || 0) - (a.score || 0); })), widths: CW }
    ]);
    var fn = 'HR招聘报表/SmartFilter-招聘数据-' + S.r.label.replace(/\s/g, '') + '-' + ymd(S.r.s) + '.xlsx';
    save(fn, blob); note('已保存到「下载/' + fn + '」');
  }
  function exportPool() {
    if (!window.HRSXlsx) return note('导出组件没有加载，请刷新页面', true);
    var L = D.cands.filter(function (c) { return c.verdict !== 'reject'; }).sort(function (a, b) { return (b.score || 0) - (a.score || 0); });
    if (!L.length) return note('人才库里还没有合格或待复核的候选人', true);
    var byJd = {};
    L.forEach(function (c) { var k = c.jdTitle || '未分类'; (byJd[k] = byJd[k] || []).push(c); });
    var sheets = [{ name: '全部（' + L.length + '人）', rows: candRows(L), widths: CW }];
    Object.keys(byJd).slice(0, 20).forEach(function (k) { sheets.push({ name: safe(k).slice(0, 24), rows: candRows(byJd[k]), widths: CW }); });
    var fn = 'HR招聘报表/SmartFilter-人才库清单-' + ymd(Date.now()) + '.xlsx';
    save(fn, HRSXlsx.write(sheets)); note('已保存到「下载/' + fn + '」，共 ' + L.length + ' 人，每个岗位一个工作表');
  }
  function chartPng(id, w, h) {
    var c = charts[id]; if (!c) return null;
    var el = $(id), ow = el.style.width, oh = el.style.height;
    try {
      c.resize({ width: w, height: h });
      var url = c.getDataURL({ type: 'png', pixelRatio: 2, backgroundColor: K('--surface', '#ffffff') });
      return url;
    } finally { c.resize(); el.style.width = ow; el.style.height = oh; }
  }
  function exportDocx() {
    var S = last; if (!S || typeof docx === 'undefined') return note('Word 组件没有加载，请刷新页面', true);
    var X = docx, F = '微软雅黑', BR = '0B3A6E';
    var T = function (t, o) { return new X.TextRun(Object.assign({ text: String(t), font: F, size: 21 }, o || {})); };
    var P = function (kids, o) { return new X.Paragraph(Object.assign({ children: kids, spacing: { after: 120 } }, o || {})); };
    var H = function (t) { return P([T(t, { bold: true, size: 26, color: BR })], { spacing: { before: 280, after: 120 } }); };
    var NB = { top: { style: X.BorderStyle.NONE, size: 0, color: 'FFFFFF' }, bottom: { style: X.BorderStyle.SINGLE, size: 2, color: 'E2E7EE' }, left: { style: X.BorderStyle.NONE, size: 0, color: 'FFFFFF' }, right: { style: X.BorderStyle.NONE, size: 0, color: 'FFFFFF' } };
    var cell = function (t, head) {
      return new X.TableCell({ borders: NB, shading: head ? { fill: 'EEF3F9', type: X.ShadingType.CLEAR, color: 'auto' } : undefined, margins: { top: 60, bottom: 60, left: 100, right: 100 },
        children: [P([T(t, head ? { bold: true, size: 19, color: '4A5568' } : { size: 19 })], { spacing: { after: 0 } })] });
    };
    var table = function (rows) {
      return new X.Table({ width: { size: 100, type: X.WidthType.PERCENTAGE }, rows: rows.map(function (r, i) { return new X.TableRow({ tableHeader: i === 0, children: r.map(function (v) { return cell(v == null ? '' : v, i === 0); }) }); }) });
    };
    var img = function (id, w, h) { var u = chartPng(id, w, h); return u ? P([new X.ImageRun({ data: u, transformation: { width: w * 0.75, height: h * 0.75 } })]) : P([T('（图表未生成）')]); };
    var name = reportName(ST.period);
    var kids = [
      P([T('Smart Filter 招聘' + name, { bold: true, size: 40, color: '0B2545' })], { spacing: { after: 60 } }),
      P([T(S.r.text + '　·　' + scopeText() + '　·　生成于 ' + new Date().toLocaleString('zh-CN', { hour12: false }), { size: 18, color: '8792A2' })], { spacing: { after: 240 } }),
      H('一、本期概况'), P([T(summaryText(S))]),
      table([['指标', S.r.label, '上一期', '变化']].concat(KPI.filter(function (k) { return S.cur[k[0]] != null; }).map(function (k) { var d = delta(S.cur[k[0]], S.prev[k[0]]); return [k[1], S.cur[k[0]] + ' ' + k[2], S.prev[k[0]] + ' ' + k[2], d ? d.txt : '']; }))),
      H('二、每日趋势'), img('rpTrend', 900, 300),
      H('三、招聘漏斗'), img('rpFunnel', 760, 300),
      H('四、岗位招聘漏斗'),
      S.jds.length ? table([['岗位'].concat(STEPS.map(function (s) { return s[1]; })).concat(['合格率'])].concat(S.jds.map(function (m) { return [m.title].concat(STEPS.map(function (s) { return m[s[0]]; })).concat([m.passRate + '%']); })))
        : P([T('本期没有候选人进入人才库')]),
      H('五、渠道对比（Boss直聘 / 猎聘）'), P([T(channelSummary(S) + '。')]),
      table([['指标', 'Boss直聘', '猎聘']].concat(CH.map(function (k) { return [k[1], (S.ch.boss[k[0]] == null ? '-' : S.ch.boss[k[0]] + ' ' + k[2]), (S.ch.liepin[k[0]] == null ? '-' : S.ch.liepin[k[0]] + ' ' + k[2])]; }))),
      H('六、不合格原因'),
      S.reasons.length ? table([['原因', '人数', '占不合格比例']].concat(S.reasons.map(function (x) { return [x.name, x.value, pct(x.value, S.cur.reject) + '%']; }))) : P([T('本期没有不合格记录')]),
      H('七、本期合格与待复核候选人')
    ];
    var L = topList(S);
    kids.push(L.length ? table([['姓名', '岗位', '来源', '学历', '经验', '匹配分', '判定', '简历', '跟进']].concat(L.slice(0, 60).map(function (c) { var f = c.fields || {}; return [c.name || f.name || '', c.jdTitle || '', srcName(c.source), f.eduText || '', f.expYears != null ? f.expYears + '年' : '', c.score || 0, vName(c.verdict), received(c) ? '已收到' : asked(c) ? '已索要' : '', statusName(c.contactStatus)]; }))) : P([T('本期没有合格或待复核的候选人')]));
    if (L.length > 60) kids.push(P([T('只列前 60 人，完整名单见「导出人才库清单」Excel。', { size: 18, color: '8792A2' })]));
    kids.push(P([T('口径说明：筛选、合格、约面、Offer 按候选人进入人才库的时间统计，约面和 Offer 取自人才库里的跟进状态。打招呼按两个平台的打招呼记录统计。', { size: 17, color: '8792A2' })], { spacing: { before: 240 } }));
    var doc = new X.Document({ styles: { default: { document: { run: { font: F } } } }, sections: [{ properties: { page: { margin: { top: 1000, bottom: 1000, left: 1000, right: 1000 } } }, children: kids }] });
    X.Packer.toBlob(doc).then(function (blob) {
      var fn = 'HR招聘报表/SmartFilter-招聘' + name + '-' + ymd(S.r.s) + '至' + ymd(S.r.e - 1) + '.docx';
      save(fn, blob); note('已保存到「下载/' + fn + '」');
    }).catch(function (e) { note('Word 生成失败：' + (e && e.message || e), true); });
  }

  // ---------------- 交互 ----------------
  function seg(id, key, attr) {
    var el = $(id); if (!el) return;
    el.addEventListener('click', function (e) {
      var s = e.target.closest('[data-' + attr + ']'); if (!s) return;
      [].forEach.call(el.children, function (x) { x.classList.toggle('on', x === s); });
      ST[key] = s.getAttribute('data-' + attr); render();
    });
  }
  function init() {
    if (!$('rpKpis')) return;
    [].forEach.call($('rpPeriod').children, function (x) { x.classList.toggle('on', x.getAttribute('data-p') === ST.period); });
    seg('rpPeriod', 'period', 'p'); seg('rpSite', 'site', 's');
    $('rpJd').addEventListener('change', function () { ST.jd = this.value; render(); });
    $('rpXlsx').addEventListener('click', exportXlsx);
    $('rpDocx').addEventListener('click', exportDocx);
    $('rpPool').addEventListener('click', exportPool);
    var pb = $('btnExportPool'); if (pb) pb.addEventListener('click', function () { load().then(exportPool); });
    var rb = $('btnRefresh'); if (rb) rb.addEventListener('click', function () { load().then(render); });
    window.addEventListener('resize', function () { Object.keys(charts).forEach(function (k) { charts[k].resize(); }); });
    load().then(render);
    try { chrome.storage.onChanged.addListener(function (ch) { if (ch.greetHistory || ch.greetHistoryLiepin) load().then(render); }); } catch (e) {}
  }
  window.HRSReport = { refresh: function () { return load().then(render); }, _metrics: metrics, _range: range, _snapshot: function () { return last; } };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
