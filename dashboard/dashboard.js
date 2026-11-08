/* dashboard.js —— 简历分析面板逻辑 */
(function () {
  'use strict';

  function $(id) { return document.getElementById(id); }
  try { $('verTag').textContent = 'v' + chrome.runtime.getManifest().version; } catch (e) {}
  var charts = {}, data = { candidates: [], events: [], jds: [], settings: null };

  function refresh() {
    chrome.runtime.sendMessage({ type: 'GET_DASHBOARD_DATA' }, function (r) {
      if (!r || r.error) { alert('读取数据失败：' + (r && r.error || '')); return; }
      data = r;
      render();
    });
  }

  function render() {
    if (window.HRSEmpty) HRSEmpty.ready();   // v3.0.0 数据读完了，图表占位去掉
    var cands = data.candidates || [];
    var s = data.settings || {};
    var jd = (data.jds || []).find(function (j) { return j.id === s.activeJdId; });
    $('jdNote').textContent = '当前JD：' + (jd ? jd.title : '未启用，请到设置页配置JD') + '（自动化只处理当前岗位职位的候选人）';

    var today = new Date().toISOString().slice(0, 10);
    var todayEv = (data.events || []).filter(function (e) { return new Date(e.ts).toISOString().slice(0, 10) === today; });
    var todayReject = todayEv.filter(function (e) { return e.type === 'reject'; }).length;

    $('stTotal').textContent = cands.length;
    $('stToday').textContent = todayEv.length;
    $('stPass').textContent = cands.filter(function (c) { return c.verdict === 'pass'; }).length;
    $('stReview').textContent = cands.filter(function (c) { return c.verdict === 'review'; }).length;
    $('stReject').textContent = todayReject;

    drawCharts(cands, data.events || []);
    fillJdFilter();
    renderTable();
    renderToday();
    renderTagCloud();
    renderEvents();
    renderBoard();
  }

  function fillJdFilter() {
    var sel = $('fJd');
    if (!sel) return;
    var cur = sel.value;
    sel.innerHTML = '<option value="">全部岗位</option>' + (data.jds || []).map(function (j) {
      return '<option value="' + j.id + '">' + esc(j.title) + '</option>';
    }).join('');
    sel.value = cur;
  }

  // ---------- 人才匹配度分析看板 ----------
  function renderBoard() {
    var cands = data.candidates || [];
    var n = cands.length;
    // 得分分布
    var bins = [0, 0, 0, 0, 0];
    cands.forEach(function (c) { var s = +c.score || 0; bins[s < 20 ? 0 : s < 40 ? 1 : s < 60 ? 2 : s < 80 ? 3 : 4]++; });
    var b1 = mkChart('bScore');
    b1.setOption({
      tooltip: { trigger: 'axis', confine: true }, grid: { left: 36, right: 10, top: 20, bottom: 24 },
      xAxis: { type: 'category', data: ['0-20', '20-40', '40-60', '60-80', '80-100'], axisLabel: { fontSize: 11 } },
      yAxis: { type: 'value', minInterval: 1, axisLabel: { fontSize: 11 } },
      series: [{ type: 'bar', data: bins, itemStyle: { color: (window.HRSChart ? HRSChart.c('--chart-1', '#0B3A6E') : '#0B3A6E'), borderRadius: [4, 4, 0, 0] }, label: { show: true, position: 'top', fontSize: 10 } }]
    });
    // 判定占比
    var pass = cands.filter(function (c) { return c.verdict === 'pass'; }).length;
    var review = cands.filter(function (c) { return c.verdict === 'review'; }).length;
    var reject = cands.filter(function (c) { return c.verdict === 'reject'; }).length;
    var b2 = mkChart('bVerdict');
    b2.setOption({
      tooltip: { confine: true }, legend: { bottom: 0, textStyle: { fontSize: 11 } },
      series: [{
        type: 'pie', radius: ['35%', '62%'], center: ['50%', '44%'],
        data: [
          { name: '通过', value: pass, itemStyle: { color: (window.HRSChart ? HRSChart.c('--chart-ok', '#157F3B') : '#157F3B') } },
          { name: '待复核', value: review, itemStyle: { color: (window.HRSChart ? HRSChart.c('--chart-warn', '#C98A1B') : '#C98A1B') } },
          { name: '拒绝(已入库)', value: reject, itemStyle: { color: (window.HRSChart ? HRSChart.c('--chart-bad', '#B42318') : '#B42318') } }
        ],
        label: { fontSize: 11, formatter: '{b}\n{d}%' }
      }]
    });
    // 六维度
    var DIMS = [['keyword', '关键词'], ['edu', '学历'], ['exp', '经验'], ['salary', '薪资'], ['city', '城市'], ['position', '职位方向']];
    var dimVals = DIMS.map(function (dm) {
      var vals = cands.map(function (c) { return (c.fields && c.fields.dims && c.fields.dims[dm[0]]) || 0; });
      return n ? Math.round(vals.reduce(function (a, b) { return a + b; }, 0) / n) : 0;
    });
    var b3 = mkChart('bDim');
    b3.setOption({
      tooltip: { trigger: 'axis', confine: true }, grid: { left: 70, right: 30, top: 10, bottom: 20 },
      xAxis: { type: 'value', max: 100, axisLabel: { fontSize: 11, formatter: '{value}%' } },
      yAxis: { type: 'category', data: DIMS.map(function (d) { return d[1]; }), axisLabel: { fontSize: 11 } },
      series: [{
        type: 'bar', data: dimVals, barWidth: 14,
        itemStyle: { color: function (p) { return p.value < 60 ? (window.HRSChart ? HRSChart.c('--chart-bad', '#B42318') : '#B42318') : p.value < 75 ? (window.HRSChart ? HRSChart.c('--chart-warn', '#C98A1B') : '#C98A1B') : (window.HRSChart ? HRSChart.c('--chart-1', '#0B3A6E') : '#0B3A6E'); }, borderRadius: [0, 4, 4, 0] },
        label: { show: true, position: 'right', fontSize: 10, formatter: '{c}%' }
      }]
    });
    // 各JD汇总
    var jdMap = {};
    cands.forEach(function (c) {
      if (!jdMap[c.jdTitle]) jdMap[c.jdTitle] = { n: 0, sum: 0, pass: 0, review: 0, reject: 0 };
      var j = jdMap[c.jdTitle]; j.n++; j.sum += (+c.score || 0);
      if (c.verdict === 'pass') j.pass++; else if (c.verdict === 'review') j.review++; else j.reject++;
    });
    $('bJd').innerHTML = Object.keys(jdMap).map(function (k) {
      var j = jdMap[k];
      return '<tr><td>' + esc(k) + '</td><td>' + j.n + '</td><td>' + Math.round(j.sum / j.n) + '</td><td>' +
        Math.round(j.pass / j.n * 100) + '%</td><td>' + j.review + '</td><td>' + j.reject + '</td><td>' +
        Math.round(j.sum / j.n) + '/100</td></tr>';
    }).join('') || '<tr><td colspan="7" style="color:var(--muted);text-align:center;">暂无数据</td></tr>';
    // 候选人明细（表头点击排序）
    renderBoardList(cands);
  }

  var bKey = null, bDir = 'desc';
  var bThs = document.querySelectorAll('#bListTable th');
  for (var bi = 0; bi < bThs.length; bi++) {
    bThs[bi].addEventListener('click', function () {
      var k = this.getAttribute('data-bk');
      if (k === bKey) { bDir = bDir === 'asc' ? 'desc' : 'asc'; }
      else { bKey = k; bDir = 'desc'; }
      renderBoard();
    });
  }
  function renderBoardList(cands) {
    var list = cands.slice();
    if (bKey) {
      list.sort(function (a, b) {
        var x = a[bKey], y = b[bKey];
        if (bKey === 'score' || bKey === 'age') { x = +x || 0; y = +y || 0; }
        else { x = String(x == null ? '' : x); y = String(y == null ? '' : y); }
        var r = x < y ? -1 : x > y ? 1 : 0;
        return bDir === 'desc' ? -r : r;
      });
    } else {
      list.sort(function (a, b) { return (b.score || 0) - (a.score || 0); });
    }
    $('bList').innerHTML = list.map(function (c) {
      var fl = c.fields || {};
      return '<tr><td>' + esc(c.name || fl.name || '-') + '</td><td>' + esc(fl.gender || '-') + '</td><td>' + (fl.age != null ? fl.age : '-') + '</td><td>' + esc(fl.phone || '-') + '</td>' +
        '<td>' + esc(c.jdTitle || '-') + '</td><td><b>' + c.score + '</b></td><td><span class="badge ' + (c.verdict === 'pass' ? 'badge-ok' : c.verdict === 'reject' ? 'badge-no' : 'badge-warn') + '">' +
        (c.verdict === 'pass' ? '通过' : c.verdict === 'reject' ? '拒绝' : '待复核') + '</span></td></tr>';
    }).join('') || '<tr><td colspan="7" style="color:var(--muted);text-align:center;">暂无数据</td></tr>';
    // 表头箭头
    var ths = document.querySelectorAll('#bListTable th');
    for (var i = 0; i < ths.length; i++) {
      var k = ths[i].getAttribute('data-bk');
      var base = ths[i].getAttribute('data-bl') || ths[i].textContent.replace(/[▲▼]/g, '');
      ths[i].setAttribute('data-bl', base);
      ths[i].textContent = base + (k === bKey ? (bDir === 'asc' ? ' ▲' : ' ▼') : '');
    }
  }

  // ---------- 图表 ----------
  function mkChart(id) {
    // v2.2.2 招聘分析改版后，「近7日趋势」「匹配度得分分布」并进了上面的趋势和匹配分分布，这两个图不再单独显示
    if (!$(id)) return { setOption: function () {} };
    if (!charts[id]) charts[id] = echarts.init($(id));
    return charts[id];
  }
  function drawCharts(cands, events) {
    // 得分分布
    var bins = [0, 0, 0, 0, 0];
    cands.forEach(function (c) {
      var sc = c.score || 0;
      if (sc < 20) bins[0]++; else if (sc < 40) bins[1]++; else if (sc < 60) bins[2]++; else if (sc < 80) bins[3]++; else bins[4]++;
    });
    mkChart('chScore').setOption({
      tooltip: {}, grid: { left: 40, right: 10, bottom: 24, top: 10 },
      xAxis: { type: 'category', data: ['0-19', '20-39', '40-59', '60-79', '80-100'] },
      yAxis: { type: 'value', minInterval: 1 },
      series: [{ type: 'bar', data: bins, itemStyle: { color: (window.HRSChart ? HRSChart.c('--chart-1', '#0B3A6E') : '#0B3A6E'), borderRadius: [6, 6, 0, 0] }, barWidth: '55%' }]
    }, true);

    // 学历分布
    var eduMap = {};
    cands.forEach(function (c) { var e = (c.fields && c.fields.eduText) || '未知'; eduMap[e] = (eduMap[e] || 0) + 1; });
    mkChart('chEdu').setOption({
      tooltip: { trigger: 'item' }, legend: { bottom: 0, textStyle: { fontSize: 11 } },
      series: [{ type: 'pie', radius: ['35%', '68%'], center: ['50%', '45%'],
        data: Object.keys(eduMap).map(function (k) { return { name: k, value: eduMap[k] }; }),
        label: { fontSize: 11 } }]
    }, true);

    // 来源分布
    var srcMap = {};
    cands.forEach(function (c) { var k = c.source === 'boss' ? 'Boss直聘' : c.source === 'liepin' ? '猎聘' : '手动上传'; srcMap[k] = (srcMap[k] || 0) + 1; });
    mkChart('chSrc').setOption({
      tooltip: { trigger: 'item' }, legend: { bottom: 0, textStyle: { fontSize: 11 } },
      series: [{ type: 'pie', radius: ['35%', '68%'], center: ['50%', '45%'],
        data: Object.keys(srcMap).map(function (k) { return { name: k, value: srcMap[k] }; }),
        label: { fontSize: 11 } }]
    }, true);

    // 经验分布
    var expMap = { '0年': 0, '1-3年': 0, '3-5年': 0, '5-10年': 0, '10年+': 0, '未知': 0 };
    cands.forEach(function (c) {
      var y = c.fields && c.fields.expYears;
      if (y == null) expMap['未知']++;
      else if (y === 0) expMap['0年']++;
      else if (y <= 3) expMap['1-3年']++;
      else if (y <= 5) expMap['3-5年']++;
      else if (y <= 10) expMap['5-10年']++;
      else expMap['10年+']++;
    });
    mkChart('chExp').setOption({
      tooltip: {}, grid: { left: 40, right: 10, bottom: 24, top: 10 },
      xAxis: { type: 'category', data: Object.keys(expMap) },
      yAxis: { type: 'value', minInterval: 1 },
      series: [{ type: 'bar', data: Object.keys(expMap).map(function (k) { return expMap[k]; }), itemStyle: { color: (window.HRSChart ? HRSChart.c('--chart-2', '#0E9AA7') : '#0E9AA7'), borderRadius: [6, 6, 0, 0] }, barWidth: '55%' }]
    }, true);

    // 近7日趋势
    var days = [], vals = [];
    for (var i = 6; i >= 0; i--) {
      var d = new Date(); d.setDate(d.getDate() - i);
      var key = d.toISOString().slice(0, 10);
      days.push((d.getMonth() + 1) + '/' + d.getDate());
      vals.push(events.filter(function (e) { return new Date(e.ts).toISOString().slice(0, 10) === key; }).length);
    }
    mkChart('chTrend').setOption({
      tooltip: { trigger: 'axis' }, grid: { left: 40, right: 10, bottom: 24, top: 10 },
      xAxis: { type: 'category', data: days },
      yAxis: { type: 'value', minInterval: 1 },
      series: [{ type: 'line', data: vals, smooth: true, areaStyle: { opacity: .15 }, itemStyle: { color: (window.HRSChart ? HRSChart.c('--chart-1', '#0B3A6E') : '#0B3A6E') } }]
    }, true);

    // 拒绝原因 TOP
    var reasonMap = {};
    (data.events || []).filter(function (e) { return e.type === 'reject'; }).forEach(function (e) {
      (e.detail || '').split('；').forEach(function (r) {
        r = r.trim();
        if (!r) return;
        if (r.indexOf('命中排除词') >= 0) r = '命中排除词';
        if (r.indexOf('缺少必备') >= 0) r = '缺少必备关键词';
        if (r.indexOf('未命中') >= 0) r = '未命中必备关键词';
        if (r.indexOf('学历') >= 0) r = '学历偏低';
        if (r.indexOf('经验') >= 0) r = '经验不足';
        if (r.indexOf('薪资') >= 0) r = '期望薪资偏高';
        if (r.indexOf('城市') >= 0) r = '城市不符';
        reasonMap[r] = (reasonMap[r] || 0) + 1;
      });
    });
    var reasonData = Object.keys(reasonMap).map(function (k) { return { name: k, value: reasonMap[k] }; })
      .sort(function (a, b) { return b.value - a.value; }).slice(0, 8);
    mkChart('chReason').setOption({
      tooltip: {}, grid: { left: 100, right: 20, bottom: 24, top: 10 },
      xAxis: { type: 'value', minInterval: 1 },
      yAxis: { type: 'category', data: reasonData.map(function (d) { return d.name; }).reverse() },
      series: [{ type: 'bar', data: reasonData.map(function (d) { return d.value; }).reverse(), itemStyle: { color: (window.HRSChart ? HRSChart.c('--chart-bad', '#B42318') : '#B42318'), borderRadius: [0, 6, 6, 0] }, barWidth: 14 }]
    }, true);
  }

  // ---------- 不合格原因标签云（v1.0.6：拒绝候选人自动归类统计） ----------
  function classifyReject(c) {
    var rs = ((c.reasons || []).join(' ') + ' ' + ((c.fields && c.fields.skills) || []).join(' ') + ' ' + (c.rawText || '')).toLowerCase();
    if (/跨岗位|人事|行政|管理岗/.test(rs)) return '跨岗位';
    if (/学历|本科|硕士|大专|统招/.test(rs)) return '未满足学历';
    if (/经验|应届|年限/.test(rs)) return '经验不足';
    if (/薪资|期望|薪酬/.test(rs)) return '薪资不符';
    if (/技能|方向|不匹配|转行/.test(rs)) return '技能不匹配';
    return '其他';
  }
  var TAG_COLORS = { '未满足学历': 'var(--chart-1)', '经验不足': 'var(--chart-2)', '薪资不符': 'var(--chart-3)', '跨岗位': 'var(--chart-5)', '技能不匹配': 'var(--chart-6)', '其他': 'var(--muted)' };
  function renderTagCloud() {
    var box = $('tagCloud');
    if (!box) return;
    var rejects = (data.candidates || []).filter(function (c) { return c.verdict === 'reject'; });
    var groups = {};
    rejects.forEach(function (c) { var k = classifyReject(c); (groups[k] = groups[k] || []).push(c); });
    var keys = Object.keys(groups).sort(function (a, b) { return groups[b].length - groups[a].length; });
    box.innerHTML = '';
    if (!keys.length) { box.innerHTML = '<span style="font-size:var(--fs-sm);color:var(--muted);">暂无拒绝候选人，自动筛选产生拒绝后此处自动统计</span>'; return; }
    keys.forEach(function (k) {
      var n = groups[k].length;
      var fs = Math.min(26, 13 + n * 5);
      var col = TAG_COLORS[k] || 'var(--muted)';
      var b = document.createElement('button');
      b.className = 'miniBtn';
      b.style.cssText = 'font-size:' + fs + 'px;padding:4px 14px;border-radius:var(--r-lg);border:1.5px solid ' + col + ';color:' + col + ';background:var(--surface);cursor:pointer;font-weight:600;';
      b.textContent = k + ' (' + n + ')';
      b.title = '点击筛选该类拒绝候选人';
      b.addEventListener('click', function () {
        $('fVerdict').value = 'reject';
        $('fReason').value = k;
        renderTable();
        document.querySelector('.talent-scroll, .card').scrollIntoView({ behavior: 'smooth', block: 'start' });
      });
      box.appendChild(b);
    });
  }

  // ---------- 人才库表格 ----------
  // ---------- v1.9.17 今日工作：智选 / 打招呼 扫 · 过 · 拒，点开看明细 ----------
  var todayData = null, todayPick = '';
  function renderToday() {
    chrome.storage.local.get(['screenToday', 'greetLog', 'greetLogLiepin'], function (o) {
      var d = (function (x) { var p = function (n) { return String(n).padStart(2, '0'); }; return x.getFullYear() + '-' + p(x.getMonth() + 1) + '-' + p(x.getDate()); })(new Date());
      var T = o.screenToday && o.screenToday.date === d ? o.screenToday : {};
      var gB = o.greetLog && o.greetLog.date === d ? o.greetLog : {}, gL = o.greetLogLiepin && o.greetLogLiepin.date === d ? o.greetLogLiepin : {};
      var tag = function (arr, site) { return (arr || []).map(function (x) { return Object.assign({ site: site }, x); }); };
      todayData = {
        screen: tag((T.boss || {}).items, 'boss').concat(tag((T.liepin || {}).items, 'liepin')),
        greet: tag(gB.items, 'boss').concat(tag(gL.items, 'liepin'))
      };
      var cnt = function (list, v) { return list.filter(function (x) { return !v || x.v === v; }).length; };
      var box = function (kind, label) {
        var L = todayData[kind];
        return '<div style="flex:1;min-width:260px;border:1px solid var(--line);border-radius:var(--r-md);padding:8px 12px;"><b>' + label + '</b><div style="display:flex;gap:8px;margin-top:6px;">' +
          [['', '扫'], ['pass', '过'], ['reject', '拒']].map(function (x) {
            var on = todayPick === kind + '-' + (x[0] || 'all');
            return '<a href="#" data-today="' + kind + '-' + (x[0] || 'all') + '" style="flex:1;text-align:center;border-radius:var(--r-md);padding:6px 0;text-decoration:none;background:' + (on ? 'var(--brand)' : 'var(--surface-2)') + ';color:' + (on ? 'var(--on-color)' : 'var(--text)') + ';"><b style="font-size:var(--fs-xl);">' + cnt(L, x[0]) + '</b><br><span style="font-size:var(--fs-sm);">' + x[1] + '</span></a>';
          }).join('') + '</div></div>';
      };
      $('todayStats').innerHTML = box('screen', '智选') + box('greet', '打招呼');
      showTodayList();
    });
  }
  function showTodayList() {
    var el = $('todayList');
    if (!todayPick || !todayData) { el.style.display = 'none'; return; }
    var p = todayPick.split('-'), kind = p[0], v = p[1] === 'all' ? '' : p[1];
    var rows = (todayData[kind] || []).filter(function (x) { return !v || x.v === v; }).sort(function (a, b) { return b.t - a.t; });
    var VN = { pass: '通过', reject: '拒绝', review: '跳过/待复核' };
    el.innerHTML = '<table class="tbl"><thead><tr><th>时间</th><th>姓名</th><th>平台</th><th>岗位</th><th>判定</th><th>原因</th><th>模式</th></tr></thead><tbody>' +
      (rows.length ? rows.map(function (x) {
        return '<tr><td style="font-size:var(--fs-sm);color:var(--text-2);">' + new Date(x.t).toLocaleTimeString('zh-CN', { hour12: false }) + '</td><td><b>' + esc(x.name) + '</b></td><td>' + srcName(x.site) + '</td><td>' + esc(x.job) + '</td>' +
          '<td><span class="verdict v-' + (x.v === 'pass' ? 'pass' : x.v === 'reject' ? 'reject' : 'review') + '">' + (VN[x.v] || x.v) + '</span></td><td style="font-size:var(--fs-sm);color:var(--text-2);max-width:420px;">' + esc(x.why) + '</td><td style="font-size:var(--fs-sm);">' + (x.dry ? '试运行' : '正式') + '</td></tr>';
      }).join('') : '<tr><td colspan="7" style="text-align:center;color:var(--muted);padding:20px;">今天还没有记录（v1.9.17 起开始记录）</td></tr>') + '</tbody></table>';
    el.style.display = 'block';
  }
  document.addEventListener('click', function (e) {
    var a = e.target.closest && e.target.closest('[data-today]');
    if (!a) return;
    e.preventDefault();
    var k = a.getAttribute('data-today');
    todayPick = todayPick === k ? '' : k;
    renderToday();
  });
  // 首页（弹窗）点数字跳过来：dashboard.html#today=screen-pass
  (function () { var m = location.hash.match(/today=([a-z]+-[a-z]+)/); if (m) todayPick = m[1]; })();
  // 上面五个统计卡片：点一下，人才库列表按它过滤
  var todayOnly = false;
  [['stTotal', function () { todayOnly = false; $('fVerdict').value = ''; $('fReason').value = ''; }],
   ['stToday', function () { todayOnly = true; $('fVerdict').value = ''; $('fReason').value = ''; }],
   ['stPass', function () { todayOnly = false; $('fVerdict').value = 'pass'; $('fReason').value = ''; }],
   ['stReview', function () { todayOnly = false; $('fVerdict').value = 'review'; $('fReason').value = ''; }],
   ['stReject', function () { todayOnly = true; $('fVerdict').value = 'reject'; $('fReason').value = ''; }]].forEach(function (x) {
    var card = $(x[0]) && $(x[0]).parentElement;
    if (!card) return;
    card.style.cursor = 'pointer';
    card.title = '点击在下面的人才库列表里查看';
    card.addEventListener('click', function () { x[1](); renderTable(); $('tblBody').scrollIntoView({ behavior: 'smooth', block: 'start' }); });
  });
  function renderTable() {
    var j = $('fJd').value, v = $('fVerdict').value, s = $('fSource').value, st = $('fStatus').value, r = $('fReason').value, q = $('fSearch').value.trim().toLowerCase();
    var rows = (data.candidates || []).filter(function (c) {
      // v3.6.0 一个人一条记录：投过这个岗位就算（不只看最近一次）
      if (j && c.jdId !== j && !(c.applications || []).some(function (a) { return a.jdId === j; })) return false;
      if (todayOnly && new Date(c.seenAt || 0).toDateString() !== new Date().toDateString()) return false;
      if (v && c.verdict !== v) return false;
      if (r && c.verdict !== 'reject') return false;
      if (r && classifyReject(c) !== r) return false;
      if (s && c.source !== s) return false;
      if (st && (c.contactStatus || 'new') !== st) return false;
      if (q) {
        var f = c.fields || {};
        var hay = [c.name, f.name, (f.skills || []).join(' '), (f.companies || []).join(' '), f.city].join(' ').toLowerCase();
        if (hay.indexOf(q) < 0) return false;
      }
      return true;
    }).sort(function (a, b) { return (b.seenAt || 0) - (a.seenAt || 0); });

    $('tblCount').textContent = '共 ' + rows.length + ' 条';
    var body = $('tblBody');
    body.innerHTML = '';
    rows.forEach(function (c) {
      var f = c.fields || {};
      var tr = document.createElement('tr');
      tr.innerHTML =
        '<td><b>' + esc(c.name || f.name || '未知') + '</b></td>' +
        '<td>' + esc(f.gender || c.gender || '—') + '</td>' +
        '<td>' + (f.age != null ? f.age : (c.age != null ? c.age : '—')) + '</td>' +
        '<td>' + esc(f.phone || c.phone || '—') + '</td>' +
        '<td>' + srcName(c.source) + '</td>' +
        '<td style="max-width:150px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">' + esc(c.jdTitle || '') + '</td>' +
        '<td><b>' + (c.score || 0) + '</b></td>' +
        '<td><span class="verdict v-' + (c.verdict === 'pass' ? 'pass' : c.verdict === 'review' ? 'review' : 'reject') + '">' +
        (c.verdict === 'pass' ? '通过' : c.verdict === 'review' ? '待复核' : '拒绝(已入库)') + '</span></td>' +
        (c.verdict === 'reject'
          ? '<td><span style="font-size:var(--fs-xs);background:var(--bad-50);color:var(--bad);border-radius:var(--r-md);padding:1px 8px;border:1px solid var(--bad-200);">' + esc(classifyReject(c)) + '</span></td>'
          : '<td style="color:var(--muted);">—</td>') +
        '<td>' + statusName(c.contactStatus || 'new') + '</td>' +
        '<td style="font-size:var(--fs-xs);color:var(--muted);">' + new Date(c.seenAt || Date.now()).toLocaleDateString('zh-CN') + '</td>' +
        '<td style="white-space:nowrap;">' +
        '<button class="miniBtn" data-act="detail" style="font-size:var(--fs-xs);padding:2px 8px;border:1px solid var(--field);border-radius:var(--r-sm);background:var(--surface);cursor:pointer;">详情</button> ' +
        '<button class="miniBtn" data-act="open" style="font-size:var(--fs-xs);padding:2px 8px;border:1px solid var(--brand);border-radius:var(--r-sm);background:var(--brand-50);color:var(--brand);cursor:pointer;">打开沟通会话</button> ' +
        (c.verdict === 'pass' ? '<button class="miniBtn" data-act="interview" title="打开会话并发送「话术」里的面试安排（发送前会让你确认）" style="font-size:var(--fs-xs);padding:2px 8px;border:1px solid var(--ok);border-radius:var(--r-sm);background:var(--ok-50);color:var(--ok);cursor:pointer;">面试安排</button> ' : '') +
        '<button class="miniBtn" data-act="del" style="font-size:var(--fs-xs);padding:2px 8px;border:1px solid var(--bad-50);border-radius:var(--r-sm);background:var(--surface);color:var(--bad-700);cursor:pointer;">删除</button>' +
        '</td>';
      tr.addEventListener('click', function (e) {
        var act = e.target && e.target.getAttribute && e.target.getAttribute('data-act');
        if (act === 'open') { e.stopPropagation(); openCandidatePage(c); return; }
        if (act === 'interview') { e.stopPropagation(); openCandidatePage(c, 'interview'); return; }
        if (act === 'del') { e.stopPropagation(); delCandidate(c); return; }
        openDrawer(c);
      });
      body.appendChild(tr);
    });
    // v3.0.0 空状态：人才库是空的 / 筛选下没有
    if (!rows.length) {
      var E = window.HRSEmpty;
      body.innerHTML = !E ? '<tr><td colspan="12">暂无数据</td></tr>' : (data.candidates || []).length
        ? E.row(12, 'filter', { title: '当前筛选下没有候选人', text: '岗位、判定、原因、来源、状态或搜索词放宽一点再看', actions: [{ label: '清除筛选', reset: 'fJd,fVerdict,fReason,fSource,fStatus,fSearch' }] })
        : E.row(12, 'pool', { title: '人才库还是空的', text: '开启智选或打招呼后，判为合格、待复核的候选人会自动进来。也可以上传已有的简历批量解析',
          actions: [{ label: '上传简历解析', click: '#dtabs span[data-dp="parse"]' }, { label: '打开 BOSS 推荐牛人', go: 'https://www.zhipin.com/web/chat/recommend' }] });
    }
  }
  function esc(s) { return String(s == null ? '' : s).replace(/[<>&"]/g, function (c) { return { '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c]; }); }
  function srcName(s) { return s === 'boss' ? 'Boss' : s === 'liepin' ? '猎聘' : '上传'; }
  function statusName(s) {
    return { new: '新获取', contacted: '已联系', interview: '已约面', offer: '已发Offer', rejected: '已淘汰', review: '待复核', reject_pending: '待确认拒绝' }[s] || s;
  }
  ['fJd', 'fVerdict', 'fSource', 'fStatus', 'fReason'].forEach(function (id) {
    $(id).addEventListener('change', function () {
      if (id === 'fVerdict' && this.value !== 'reject') $('fReason').value = '';
      if (id === 'fReason' && this.value !== '') $('fVerdict').value = 'reject';
      renderTable();
    });
  });
  $('fSearch').addEventListener('input', renderTable);

  // ---------- 打开候选人网页端页面（带chatId的具体会话页） ----------
  // v1.9.17 打开沟通会话：没有具体会话链接时，打开沟通页后由插件在左侧列表里按姓名搜索并点开；tpl = 打开后发的固定话术
  function openCandidatePage(c, tpl) {
    var name = c.name || (c.fields || {}).name || '';
    var url = c.sourceUrl || '';
    if (!url || !/chatId=|\/chat\//.test(url)) url = c.source === 'liepin' ? 'https://lpt.liepin.com/chat/im' : (c.source === 'boss' ? 'https://www.zhipin.com/web/chat/index' : '');
    // v1.9.49 Boss 网页端不支持 ?chatId= 直接打开某个人，带上它反而让插件误以为「已经打开了」。
    // Boss 一律打开沟通页本身，由插件在左侧列表里按「姓名 + 沟通职位」找到这个人再真实点开
    if (c.source === 'boss' || /zhipin\.com/i.test(url)) url = 'https://www.zhipin.com/web/chat/index';
    if (!url) { alert('该候选人没有站内链接（手动上传，无来源页面）'); return; }
    var job = c.appliedPosition || '';   // 候选人在 Boss 列表上显示的沟通职位，用来区分同名的人
    url = url.replace(/#.*$/, '') + '#hrs_find=' + encodeURIComponent(name) + (tpl ? '&hrs_tpl=' + tpl : '') +
      (job ? '&hrs_job=' + encodeURIComponent(job) : '') + (c.jdTitle ? '&hrs_jd=' + encodeURIComponent(c.jdTitle) : '') + (c.chatId ? '&hrs_cid=' + encodeURIComponent(c.chatId) : '');
    var req = { name: name, tpl: tpl || '', job: job, jd: c.jdTitle || '', cid: c.chatId || '', at: Date.now() };
    chrome.tabs.create({ url: url }, function (tab) {
      // v1.9.49 找人信息同时交给后台：页面加载时如果平台把地址里的 # 部分去掉了，插件照样知道要找谁
      if (!tab || tab.id == null) return;
      chrome.storage.local.get('pendingFind', function (o) {
        var pf = o.pendingFind || {};
        Object.keys(pf).forEach(function (k) { if (!pf[k] || Date.now() - (pf[k].at || 0) > 600000) delete pf[k]; });
        pf[tab.id] = req;
        chrome.storage.local.set({ pendingFind: pf });
      });
    });
  }
  function delCandidate(c) {
    if (!confirm('从人才库删除「' + (c.name || '') + '」？')) return;
    chrome.runtime.sendMessage({ type: 'TALENT_DELETE', id: c.id }, function () { refresh(); });
  }

  // v3.6.0 同一个人投过的岗位
  function apps(c) {
    var A = (c.applications || []).slice().sort(function (a, b) { return (b.at || 0) - (a.at || 0); });
    if (A.length < 2) return '';
    var vn = { pass: '通过', reject: '不合格', review: '待复核' };
    return '<div class="sect">投过的岗位（' + A.length + '）</div><table class="dc-apps"><tr><th>岗位</th><th>结论</th><th>状态</th><th>时间</th></tr>' + A.map(function (a) {
      return '<tr><td>' + esc(a.jdTitle || '') + '</td><td>' + esc(vn[a.verdict] || a.verdict || '—') + '</td><td>' + esc(statusName(a.contactStatus || 'new')) + '</td><td>' + new Date(a.at || Date.now()).toLocaleDateString('zh-CN') + '</td></tr>';
    }).join('') + '</table>';
  }
  // ---------- 详情抽屉（结构化清晰展示） ----------
  function openDrawer(c) {
    var f = c.fields || {};
    var b = c.verdict === 'pass' ? 'v-pass' : c.verdict === 'reject' ? 'v-reject' : 'v-review';
    var vn = c.verdict === 'pass' ? '通过' : c.verdict === 'reject' ? '拒绝(已入库)' : '待复核';
    var msgs = (c.messages || []).slice().reverse().map(function (m) {
      return '<div class="msg ' + (m.dir === 'out' ? 'out' : 'in') + '"><span style="color:var(--muted);font-size:var(--fs-xs);margin-right:8px;">' + esc(m.time || '') + '</span>' + (m.dir === 'out' ? '我→候选人' : '候选人→我') + ' · ' + esc(m.type || '') + '<br>' + esc(m.text || '') + '</div>';
    }).join('') || '<div style="font-size:var(--fs-sm);color:var(--muted);">暂无沟通记录（插件自动发送的邀请/拒绝话术会记录在这里，与网页端聊天一致）</div>';
    var statusSel = ['new', 'contacted', 'interview', 'offer', 'rejected'].map(function (s) {
      return '<option value="' + s + '"' + ((c.contactStatus || 'new') === s ? ' selected' : '') + '>' + statusName(s) + '</option>';
    }).join('');
    $('drawerBody').innerHTML =
      '<h2 style="font-size:var(--fs-xl);margin-bottom:6px;">' + esc(c.name || f.name || '未知') + ' <span class="verdict ' + b + '">' + vn + '</span> <span style="font-size:var(--fs-md);color:var(--text-2);">得分 ' + (c.score || 0) + '/100</span></h2>' +
      '<div style="font-size:var(--fs-sm);color:var(--text-2);margin-bottom:10px;">' + esc(c.jdTitle || '') + ' · ' + srcName(c.source) +
      (c.sourceUrl ? ' <button class="miniBtn" data-open="' + esc(c.sourceUrl) + '" style="font-size:var(--fs-xs);padding:2px 8px;border:1px solid var(--brand);border-radius:var(--r-sm);background:var(--brand-50);color:var(--brand);cursor:pointer;">打开沟通会话</button> <button class="miniBtn" data-copy="' + esc(c.sourceUrl) + '" style="font-size:var(--fs-xs);padding:2px 8px;border:1px solid var(--field);border-radius:var(--r-sm);background:var(--surface);cursor:pointer;">复制链接</button>' : '') + '</div>' +
      '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(120px,1fr));gap:8px;margin:10px 0;">' +
      '<div class="kvbox"><b>性别</b>' + esc(f.gender || c.gender || '—') + '</div>' +
      '<div class="kvbox"><b>年龄</b>' + (f.age != null ? f.age : (c.age != null ? c.age : '—')) + '</div>' +
      '<div class="kvbox"><b>联系方式</b>' + esc(f.phone || c.phone || '—') + '</div>' +
      '<div class="kvbox"><b>学历</b>' + esc(f.eduText || f.edu || '—') + '</div>' +
      '<div class="kvbox"><b>经验</b>' + (f.expYears != null ? f.expYears + '年' : '—') + '</div>' +
      '<div class="kvbox"><b>城市</b>' + esc(f.city || '—') + '</div>' +
      '<div class="kvbox"><b>期望薪资</b>' + (f.salaryMin != null ? f.salaryMin + '-' + (f.salaryMax != null ? f.salaryMax : '') + '万' : (f.salary || '—')) + '</div>' +
      '</div>' +
      '<div class="sect">匹配判定原因</div><div style="font-size:var(--fs-sm);color:var(--text-2);line-height:1.8;">' + ((c.reasons || []).map(function (r) { return '· ' + esc(r); }).join('<br>') || '—') + '</div>' +
      // v3.6.0 自动决定：候选人要求说明时生成说明文字；不同意自动结论时转人工复核；要求删除时删掉全部信息
      '<div class="sect">自动决定</div><div class="dc-act">' +
      '<button class="btn ghost sm" id="dExplain" type="button" title="把判定时间、结论、原因、比对明细整理成一段话，候选人问为什么没通过时可以发给他">生成决定说明</button>' +
      '<button class="btn ghost sm" id="dReview" type="button" title="不按插件的结论，改成待复核，由 HR 人工看">转人工复核</button>' +
      '<button class="btn danger sm" id="dPurge" type="button" title="候选人要求删除时用：人才库、简历收集和 PDF、已保存的文件、决定记录都删掉">按要求删除</button></div>' +
      '<div class="dc-out" id="dExplainOut" hidden><textarea id="dExplainTxt" readonly></textarea><button class="btn sm" id="dExplainCopy" type="button">复制</button></div>' +
      apps(c) +
      '<div class="sect">技能</div><div style="font-size:var(--fs-sm);color:var(--text-2);">' + esc((f.skills || []).join('、') || '—') + '</div>' +
      '<div class="sect">工作经历 / 职位</div><div style="font-size:var(--fs-sm);color:var(--text-2);">' + ((f.companies || []).map(function (co, i) { return esc(co) + (f.positions && f.positions[i] ? ' · ' + esc(f.positions[i]) : ''); }).join('<br>') || '—') + '</div>' +
      '<div class="sect">处理状态</div><div><select id="dStatus" style="padding:4px 10px;border:1px solid var(--field);border-radius:var(--r-sm);font-size:var(--fs-sm);">' + statusSel + '</select></div>' +
      '<div class="sect">与候选人的沟通记录（对方页面可见）</div>' + msgs +
      '<div class="sect">简历文件收集</div><div style="font-size:var(--fs-sm);color:var(--text-2);line-height:1.8;">' +
      ((c.resumeFiles || []).length ? (c.resumeFiles || []).map(function (x) { return '· ' + esc(x.filename || x.name || 'PDF') + '（' + new Date(x.receivedAt || Date.now()).toLocaleString('zh-CN') + '）'; }).join('<br>') : (c.resumeStatus === 'requested' ? '已自动索要，等待候选人回传 PDF' : '暂无回传 PDF')) + '</div>' +
      '<div class="sect">简历原文（结构化展示，可展开）</div>' +
      '<div class="raw" id="dRaw" style="display:none;">' + esc(c.rawText || '（无原文）') + '</div>' +
      '<button class="btn ghost" id="btnRawToggle" style="margin-top:8px;font-size:var(--fs-sm);padding:4px 12px;">展开原文</button>';
    $('drawer').classList.add('open');
    $('btnRawToggle').addEventListener('click', function () {
      var r = $('dRaw');
      r.style.display = r.style.display === 'none' ? 'block' : 'none';
      this.textContent = r.style.display === 'none' ? '展开原文' : '收起原文';
    });
    $('dStatus').addEventListener('change', function () {
      chrome.runtime.sendMessage({ type: 'TALENT_UPDATE', id: c.id, patch: { contactStatus: this.value } }, function () { refresh(); });
    });
    $('dExplain').addEventListener('click', function () {
      chrome.runtime.sendMessage({ type: 'DECISION_LIST', name: c.name || '', cid: c.chatId || '', limit: 50 }, function (list) {
        void chrome.runtime.lastError;
        var mine = (Array.isArray(list) ? list : []).filter(function (e) { return !c.jdId || !e.jdId || e.jdId === c.jdId || (c.applications || []).some(function (a) { return a.jdId === e.jdId; }); });
        chrome.storage.local.get('settings', function (o) {
          var txt = window.HRSDecisionLog ? HRSDecisionLog.explain(c, mine, { company: (o.settings || {}).company || '' }) : (c.reasons || []).join('\n');
          $('dExplainOut').hidden = false; $('dExplainTxt').value = txt;
          chrome.runtime.sendMessage({ type: 'TALENT_HR', id: c.id, action: 'explain' }, function () { void chrome.runtime.lastError; });
        });
      });
    });
    $('dExplainCopy').addEventListener('click', function () {
      var b = this;
      try { navigator.clipboard.writeText($('dExplainTxt').value); b.textContent = '已复制'; setTimeout(function () { b.textContent = '复制'; }, 1500); } catch (e) { $('dExplainTxt').select(); }
    });
    $('dReview').addEventListener('click', function () {
      if (!confirm('把「' + (c.name || '') + '」改成待复核，由 HR 人工看？插件不会再自动拒绝他')) return;
      chrome.runtime.sendMessage({ type: 'TALENT_HR', id: c.id, action: 'manual_review', note: '人才库里转人工复核' }, function () { void chrome.runtime.lastError; $('drawer').classList.remove('open'); refresh(); });
    });
    $('dPurge').addEventListener('click', function () {
      if (!confirm('候选人要求删除：删掉「' + (c.name || '') + '」在插件里的全部信息（人才库、简历收集和 PDF、已保存的简历文件、决定记录、处理记录），删了不能恢复。确定？')) return;
      chrome.runtime.sendMessage({ type: 'PERSON_PURGE', id: c.id }, function (r) {
        void chrome.runtime.lastError;
        $('drawer').classList.remove('open');
        if (r && r.ok) alert('已删除。删除记录（只记数量，不记姓名）在「设置 · 合规」里');
        refresh();
      });
    });
    var openBtn = $('drawerBody').querySelector('[data-open]');
    if (openBtn) openBtn.addEventListener('click', function () { openCandidatePage(c); });
    var copyBtn = $('drawerBody').querySelector('[data-copy]');
    if (copyBtn) copyBtn.addEventListener('click', function (ev) {
      ev.preventDefault();
      var txt = this.getAttribute('data-copy');
      try { navigator.clipboard.writeText(txt); this.textContent = '已复制'; var b = this; setTimeout(function () { b.textContent = '复制链接'; }, 1500); } catch (e) { prompt('复制链接：', txt); }
    });
  }
  $('drawerClose').addEventListener('click', function () { $('drawer').classList.remove('open'); });

  // ---------- 处理记录（含被拒候选人追溯） ----------
  function renderEvents() {
    var evs = (data.events || []).slice().sort(function (a, b) { return (b.ts || 0) - (a.ts || 0); }).slice(0, 200);
    var actMap = { reject: ['拒绝', 'v-reject'], request: ['索要简历', 'v-pass'], resume_received: ['收到PDF', 'v-pass'], log: ['日志', 'v-review'], health: ['自检', 'v-review'], pass: ['通过', 'v-pass'] };
    var jdMap = {};
    (data.jds || []).forEach(function (j) { jdMap[j.id] = j.title; });
    var box = $('evBody');
    box.innerHTML = evs.length ? evs.map(function (e) {
      var a = actMap[e.type] || ['记录', 'v-review'];
      return '<tr><td>' + new Date(e.ts).toLocaleString('zh-CN') + '</td>' +
        '<td><span class="verdict ' + a[1] + '">' + a[0] + '</span></td>' +
        '<td>' + esc(e.name || '—') + '</td>' +
        '<td>' + esc(jdMap[e.jdId] || '—') + '</td>' +
        '<td>' + (e.site === 'boss' ? 'Boss直聘' : e.site === 'liepin' ? '猎聘' : '—') + '</td>' +
        '<td style="color:var(--text-2);">' + esc((e.detail || '').slice(0, 60)) + '</td></tr>';
    }).join('') : '<tr><td colspan="6" style="color:var(--muted);text-align:center;">暂无处理记录</td></tr>';
  }

  // ---------- 上传解析 ----------
  var drop = $('drop'), lastUpload = null;
  drop.addEventListener('click', function () { $('file').click(); });
  drop.addEventListener('dragover', function (e) { e.preventDefault(); drop.classList.add('drag'); });
  drop.addEventListener('dragleave', function () { drop.classList.remove('drag'); });
  drop.addEventListener('drop', function (e) {
    e.preventDefault(); drop.classList.remove('drag');
    if (e.dataTransfer.files.length) handleFiles(e.dataTransfer.files);
  });
  $('file').addEventListener('change', function () {
    if (this.files.length) handleFiles(this.files);
  });

  function handleFiles(files) {
    var list = Array.prototype.slice.call(files);
    $('upResult').style.display = 'block';
    $('upResult').innerHTML = '<b>解析中…</b><br><span style="font-size:var(--fs-sm);color:var(--text-2);">' + list.map(function (f) { return f.name; }).join('、') + '</span>';
    parseOne(list, 0, []);
  }
  function parseOne(list, idx, results) {
    if (idx >= list.length) { renderUploadResults(results); return; }
    HRSParsers.parseFile(list[idx]).then(function (text) {
      var fields = HRSExtractor.extract(text);
      results.push({ name: list[idx].name, text: text, fields: fields });
      parseOne(list, idx + 1, results);
    }).catch(function (err) {
      results.push({ name: list[idx].name, text: '', fields: null, error: String(err && err.message || err) });
      parseOne(list, idx + 1, results);
    });
  }
  function renderUploadResults(results) {
    var jd = (data.jds || []).find(function (j) { return j.id === (data.settings || {}).activeJdId; });
    var html = '';
    var first = results[0];
    if (results.length === 1 && !first.error && first.fields) {
      lastUpload = first;
      var f = first.fields;
      html += '<table><tr><th>姓名</th><td>' + esc(f.name || '—') + '</td><th>电话</th><td>' + esc(f.phone || '—') + '</td></tr>' +
        '<tr><th>学历</th><td>' + esc(f.eduText || '—') + '</td><th>经验</th><td>' + (f.expYears != null ? f.expYears + '年' : '—') + '</td></tr>' +
        '<tr><th>期望薪资</th><td>' + (f.salaryMin != null ? f.salaryMin + '-' + (f.salaryMax != null ? f.salaryMax : '') + '万/月' : '—') + '</td><th>城市</th><td>' + esc(f.city || '—') + '</td></tr>' +
        '<tr><th>邮箱</th><td>' + esc(f.email || '—') + '</td><th>性别/年龄</th><td>' + esc((f.gender || '') + (f.age ? ' ' + f.age + '岁' : '')) + '</td></tr>' +
        '<tr><th>技能</th><td colspan="3">' + esc((f.skills || []).join('、') || '—') + '</td></tr>' +
        '<tr><th>公司</th><td colspan="3">' + esc((f.companies || []).join('、') || '—') + '</td></tr>' +
        '<tr><th>求职意向</th><td colspan="3">' + esc((f.positions || []).join('、') || '—') + '</td></tr></table>' +
        '<div style="font-size:var(--fs-xs);color:var(--muted);margin-top:6px;">提取置信度：' + (f.confidence || 0) + '/11（字段越多越完整）</div>';
      // 匹配
      var matchHtml;
      if (jd) {
        // v3.3.0 统一判定引擎：和打招呼、智选同一套规则，岗位知识库里补充的叫法也算
        var ds = data.settings || {};
        if (window.HRSJobKB && HRSJobKB.applySettings) HRSJobKB.applySettings(ds);
        var res = window.HRSEngine ? HRSEngine.judgeText(first.text, f, jd, { chipWords: ds.chipWords, chipExclude: ds.chipExclude }) : HRSMatcher.match({ text: first.text, fields: f }, jd);
        var vcls = res.verdict === 'pass' ? 'pass' : res.verdict === 'review' ? 'review' : 'reject';
        matchHtml = '<div style="font-size:var(--fs-lg);font-weight:700;margin-bottom:8px;">匹配得分：<b>' + res.score + '</b>/100' +
          ' <span class="verdict v-' + vcls + '">' + (res.verdict === 'pass' ? '通过' : res.verdict === 'review' ? '待复核' : '拒绝') + '</span></div>' +
          '<div style="font-size:var(--fs-sm);color:var(--text-2);line-height:1.9;">' + (res.reasons || []).map(function (r) { return '· ' + esc(r); }).join('<br>') + '</div>';
        lastUpload._match = res;
      } else {
        matchHtml = '<div style="color:var(--warn);">未启用JD，无法匹配。请先在设置中启用JD。</div>';
      }
      $('matchBox').innerHTML = matchHtml;
      $('btnAddPool').style.display = 'inline-block';
      $('btnCopyText').style.display = 'inline-block';
    } else {
      results.forEach(function (r) {
        html += '<div style="margin-bottom:8px;"><b>' + esc(r.name) + '</b>：' +
          (r.error ? '<span style="color:var(--bad);">解析失败 ' + esc(r.error) + '</span>' : '解析成功，提取' + (r.fields ? r.fields.confidence : 0) + '个字段') + '</div>';
      });
      $('matchBox').innerHTML = '<div style="color:var(--text-2);">多文件模式：请逐个上传进行详细解析。</div>';
    }
    $('upResult').innerHTML = html;
  }
  $('btnAddPool').addEventListener('click', function () {
    if (!lastUpload) return;
    var jd = (data.jds || []).find(function (j) { return j.id === (data.settings || {}).activeJdId; });
    var c = {
      name: lastUpload.fields.name || lastUpload.name.replace(/\.[^.]+$/, ''),
      source: 'upload',
      jdId: jd ? jd.id : null,
      jdTitle: jd ? jd.title : null,
      score: lastUpload._match ? lastUpload._match.score : 0,
      verdict: lastUpload._match ? lastUpload._match.verdict : 'review',
      reasons: lastUpload._match ? lastUpload._match.reasons : ['手动上传'],
      fields: lastUpload.fields,
      rawText: lastUpload.text,
      contactStatus: 'new'
    };
    chrome.runtime.sendMessage({ type: 'TALENT_ADD', candidate: c }, function () {
      alert('已加入人才库');
      refresh();
    });
  });
  $('btnCopyText').addEventListener('click', function () {
    if (lastUpload) { navigator.clipboard.writeText(lastUpload.text).then(function () { alert('已复制全文'); }); }
  });

  // ---------- 导出简历文件（PDF / Word） ----------
  $('btnExport').addEventListener('click', function () {
    var format = (data.settings || {}).exportFormat || 'pdf+docx';
    if (format === 'pdf') {
      $('btnExportPDF').click();
    } else if (format === 'docx') {
      $('btnExportDocx').click();
    } else {
      $('btnExportPDF').click();
      setTimeout(function () { $('btnExportDocx').click(); }, 1200);
    }
  });
  $('btnOpts').addEventListener('click', function () { chrome.runtime.openOptionsPage(); });
  $('btnRefresh').addEventListener('click', refresh);

  // ---------- 导出 PDF / Word（v1.0.6：每候选人单独一个文件，按岗位文件夹归档，WPS可直接打开） ----------
  function exportCands() {
    var jdId = $('fJd').value;
    return (data.candidates || []).filter(function (c) { return !jdId || c.jdId === jdId; });
  }
  function ym() { var d = new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0'); }
  function saveBlobToDownloads(path, blob) {
    if (typeof chrome !== 'undefined' && chrome.downloads) {
      var url = URL.createObjectURL(blob);
      // filename 含子目录：浏览器自动在下载目录创建「HR人才库导出/年月/岗位名/」文件夹
      chrome.downloads.download({ url: url, filename: path, saveAs: false });
      setTimeout(function () { URL.revokeObjectURL(url); }, 120000);
    } else {
      var a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = path.split('/').pop(); a.click();
    }
  }
  function exportPath(c) {
    return 'HR人才库导出/' + ym() + '/' + ((c.jdTitle || '未分类').replace(/[\\/:*?"<>|]/g, '_')) + '/' + ((c.name || '候选人').replace(/[\\/:*?"<>|]/g, '_')) + '-简历';
  }
  $('btnExportPDF').addEventListener('click', function () {
    var cs = exportCands();
    if (!cs.length) { alert('没有可导出的候选人'); return; }
    if (typeof jspdf === 'undefined' || typeof html2canvas === 'undefined') { alert('PDF导出库加载失败，请重新加载扩展'); return; }
    alert('开始生成 PDF：共 ' + cs.length + ' 份，每候选人单独一个文件，自动保存到「下载/HR人才库导出/年月/岗位名/」');
    var i = 0;
    (function next() {
      if (i >= cs.length) { alert('PDF导出完成：下载/HR人才库导出/' + ym() + '/（每岗位一个文件夹，每候选人一个PDF）'); return; }
      var c = cs[i++];
      renderOnePdf(c).then(function (blob) {
        saveBlobToDownloads(exportPath(c) + '.pdf', blob);
        next();
      }).catch(function (e) { alert('PDF生成失败：' + (e && e.message || e)); next(); });
    })();
  });
  function candPdfHtml(c, jdTitle) {
    var f = c.fields || {};
    var b = c.verdict === 'pass' ? '通过' : c.verdict === 'reject' ? '拒绝(已入库)' : '待复核';
    return '<div style="font-size:var(--fs-2xl);font-weight:700;border-bottom:3px solid var(--brand);padding-bottom:12px;">' + esc(c.name || f.name || '未知') + ' <span style="font-size:var(--fs-lg);color:var(--text-2);font-weight:400;">' + esc(jdTitle) + ' · 匹配度 ' + (c.score || 0) + '/100 · 判定 ' + b + '</span></div>' +
      '<div style="margin-top:16px;font-size:var(--fs-sm);color:var(--text-2);">来源：' + srcName(c.source) + ' · 会话链接：' + esc(c.sourceUrl || '-') + '</div>' +
      '<table style="width:100%;border-collapse:collapse;margin-top:16px;font-size:var(--fs-md);">' +
      '<tr><td style="padding:8px;border:1px solid var(--line);background:var(--surface-2);width:110px;">性别</td><td style="padding:8px;border:1px solid var(--line);">' + esc(f.gender || c.gender || '-') + '</td><td style="padding:8px;border:1px solid var(--line);background:var(--surface-2);width:110px;">年龄</td><td style="padding:8px;border:1px solid var(--line);">' + (f.age != null ? f.age : (c.age != null ? c.age : '-')) + '</td></tr>' +
      '<tr><td style="padding:8px;border:1px solid var(--line);background:var(--surface-2);">联系方式</td><td style="padding:8px;border:1px solid var(--line);">' + esc(f.phone || c.phone || '-') + '</td><td style="padding:8px;border:1px solid var(--line);background:var(--surface-2);">学历</td><td style="padding:8px;border:1px solid var(--line);">' + esc(f.eduText || f.edu || '-') + '</td></tr>' +
      '<tr><td style="padding:8px;border:1px solid var(--line);background:var(--surface-2);">经验</td><td style="padding:8px;border:1px solid var(--line);">' + (f.expYears != null ? f.expYears + '年' : '-') + '</td><td style="padding:8px;border:1px solid var(--line);background:var(--surface-2);">城市/薪资</td><td style="padding:8px;border:1px solid var(--line);">' + esc(f.city || '-') + ' / ' + (f.salaryMin != null ? f.salaryMin + '-' + (f.salaryMax != null ? f.salaryMax : '') + '万' : (f.salary || '-')) + '</td></tr>' +
      '</table>' +
      '<div style="margin-top:16px;font-size:var(--fs-lg);font-weight:600;color:var(--brand);">技能</div><div style="font-size:var(--fs-md);margin-top:4px;">' + esc((f.skills || []).join('、') || '-') + '</div>' +
      '<div style="margin-top:14px;font-size:var(--fs-lg);font-weight:600;color:var(--brand);">工作经历</div><div style="font-size:var(--fs-md);margin-top:4px;">' + esc((f.companies || []).map(function (co, i) { return co + (f.positions && f.positions[i] ? ' · ' + f.positions[i] : ''); }).join('；') || '-') + '</div>' +
      '<div style="margin-top:14px;font-size:var(--fs-lg);font-weight:600;color:var(--brand);">匹配判定原因</div><div style="font-size:var(--fs-md);margin-top:4px;">' + esc((c.reasons || []).join('；') || '-') + '</div>' +
      '<div style="margin-top:14px;font-size:var(--fs-lg);font-weight:600;color:var(--brand);">沟通记录（已发送话术）</div><div style="font-size:var(--fs-sm);margin-top:4px;">' + esc((c.messages || []).map(function (m) { return '[' + (m.time || '') + '] ' + (m.type || '') + '：' + (m.text || ''); }).join('\n') || '-') + '</div>' +
      '<div style="margin-top:14px;font-size:var(--fs-lg);font-weight:600;color:var(--brand);">简历原文</div><div style="font-size:var(--fs-sm);color:var(--text-2);margin-top:4px;line-height:1.8;white-space:pre-wrap;">' + esc(c.rawText || '') + '</div>';
  }
  function renderOnePdf(c) {
    return new Promise(function (resolve, reject) {
      var d = document.createElement('div');
      d.style.cssText = 'position:absolute;left:-9999px;top:0;width:794px;min-height:1040px;background:var(--surface);color:var(--text);font-family:"Microsoft YaHei",sans-serif;padding:48px;box-sizing:border-box;';
      d.innerHTML = candPdfHtml(c, c.jdTitle || '未分类');
      document.body.appendChild(d);
      html2canvas(d, { scale: 2, backgroundColor: (window.HRSTheme && HRSTheme.tok('--surface')) || '#ffffff', useCORS: true }).then(function (canvas) {
        var pdf = new jspdf.jsPDF({ orientation: 'portrait', unit: 'px', format: [794, 1123], hotfixes: ['px_scaling'] });
        pdf.addImage(canvas.toDataURL('image/jpeg', 0.92), 'JPEG', 0, 0, 794, 1123);
        d.remove();
        resolve(pdf.output('blob'));
      }).catch(function (e) { d.remove(); reject(e); });
    });
  }
  $('btnExportDocx').addEventListener('click', function () {
    var cs = exportCands();
    if (!cs.length) { alert('没有可导出的候选人'); return; }
    if (typeof docx === 'undefined') { alert('Word导出库加载失败，请重新加载扩展'); return; }
    alert('开始生成 Word：共 ' + cs.length + ' 份，每候选人单独一个文件，自动保存到「下载/HR人才库导出/年月/岗位名/」');
    var i = 0;
    (function next() {
      if (i >= cs.length) { alert('Word导出完成：下载/HR人才库导出/' + ym() + '/（每岗位一个文件夹，每候选人一个.docx）'); return; }
      var c = cs[i++];
      var f = c.fields || {};
      var b = c.verdict === 'pass' ? '通过' : c.verdict === 'reject' ? '拒绝(已入库)' : '待复核';
      var kids = [];
      kids.push(new docx.Paragraph({ children: [new docx.TextRun({ text: c.name + ' · ' + (c.jdTitle || '未分类') + ' · 匹配度 ' + (c.score || 0) + '/100 · ' + b, bold: true, size: 30, font: '微软雅黑' })] }));
      kids.push(new docx.Paragraph({ children: [new docx.TextRun({ text: '性别：' + (f.gender || c.gender || '-') + ' | 年龄：' + (f.age != null ? f.age : (c.age != null ? c.age : '-')) + ' | 联系方式：' + (f.phone || c.phone || '-') + ' | 学历：' + (f.eduText || f.edu || '-') + ' | 经验：' + (f.expYears != null ? f.expYears + '年' : '-'), size: 22, font: '微软雅黑' })] }));
      kids.push(new docx.Paragraph({ children: [new docx.TextRun({ text: '城市/薪资：' + (f.city || '-') + ' / ' + (f.salaryMin != null ? f.salaryMin + '-' + (f.salaryMax != null ? f.salaryMax : '') + '万' : (f.salary || '-')) + ' | 来源：' + srcName(c.source), size: 22, font: '微软雅黑' })] }));
      kids.push(new docx.Paragraph({ children: [new docx.TextRun({ text: '技能：' + ((f.skills || []).join('、') || '-'), size: 22, font: '微软雅黑' })] }));
      kids.push(new docx.Paragraph({ children: [new docx.TextRun({ text: '判定原因：' + ((c.reasons || []).join('；') || '-'), size: 22, font: '微软雅黑' })] }));
      kids.push(new docx.Paragraph({ children: [new docx.TextRun({ text: '沟通记录：' + ((c.messages || []).map(function (m) { return '[' + (m.time || '') + '] ' + (m.type || '') + '：' + (m.text || ''); }).join('\n') || '-'), size: 20, font: '微软雅黑' })] }));
      kids.push(new docx.Paragraph({ children: [new docx.TextRun({ text: '简历原文：' + (c.rawText || ''), size: 20, font: '微软雅黑' })] }));
      var doc = new docx.Document({ sections: [{ properties: {}, children: kids }] });
      docx.Packer.toBlob(doc).then(function (blob) {
        saveBlobToDownloads(exportPath(c) + '.docx', blob);
        next();
      });
    })();
  });

  refresh();
})();
