/* inbox.js v2.5.0：工作台「简历收集」（v2.6.1：只存真 PDF、保存到自选文件夹）
 * 从上到下：工具条 → 总览（收到几份 + 每个岗位一根状态条）→ 图例 → 按岗位分组的简历卡片
 * 每张卡片：头像、姓名、平台、时间、状态；中间是文件名的每一块（姓名、类别、公司…），颜色表示这一块是怎么来的；
 * 最后一行：预览、保存、定位到对话。点某一块弹出小面板：看在线简历和 PDF 各是什么、补上或更正。
 * 取值顺序：自动识别（在线简历 + PDF 互相核对）> 你补的；点了「更正」的那一项以你填的为准。
 */
(function () {
  'use strict';
  function $(id) { return document.getElementById(id); }
  var RI = window.HRSResumeInbox, DBX = window.HRSResumeDB, SD = window.HRSSaveDir;
  if (!RI || !$('p-inbox')) return;
  var ls = {
    get: function (k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
    set: function (k, v) { try { localStorage.setItem(k, v); } catch (e) {} }
  };
  var st = {
    list: [], jds: [], S: {}, recon: [],
    range: ls.get('ibRange') || 'today', site: '', origin: '', q: '', job: '', flt: '',
    seen: 0, locating: {}, locRes: {}, pop: null, refetching: {}, perm: ''
  };
  var SRC = { man: '你填的', online: '在线简历', pdf: 'PDF', jd: '岗位设置', guess: '按岗位名判断' };
  var EDU = ['中专', '大专', '本科', '硕士', '博士'];
  // 文件名里的块 → 记录里的字段
  var TK = { '姓名': 'name', '类别': 'cat', '公司': 'company', '年限': 'years', '年龄': 'age', '学历': 'edu', '城市': 'city' };
  var FL = { name: '姓名', cat: '类别', company: '公司', years: '工作年限', age: '年龄', edu: '学历', city: '城市' };
  // 状态条颜色（已用 dataviz 校验：相邻色盲可分，琥珀色对白底对比不足，所以每段都有文字图例和悬停说明）
  var STATUS = [
    { k: 'saved', label: '已保存', c: 'var(--st-saved)' },
    { k: 'unsaved', label: '未保存', c: 'var(--st-unsaved)' },
    { k: 'miss', label: '待补全', c: 'var(--st-miss)' },
    { k: 'nofile', label: '没拿到 PDF', c: 'var(--st-nofile)' }
  ];
  var ICON = {
    eye: '<svg viewBox="0 0 24 24"><path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z"/><circle cx="12" cy="12" r="2.8"/></svg>',
    save: '<svg viewBox="0 0 24 24"><path d="M12 4v11M7.5 10.5 12 15l4.5-4.5"/><path d="M5 19.5h14"/></svg>',
    loc: '<svg viewBox="0 0 24 24"><path d="M12 21s-6.5-6-6.5-11a6.5 6.5 0 0 1 13 0c0 5-6.5 11-6.5 11z"/><circle cx="12" cy="10" r="2.4"/></svg>',
    more: '<svg viewBox="0 0 24 24"><circle cx="5.5" cy="12" r="1.3"/><circle cx="12" cy="12" r="1.3"/><circle cx="18.5" cy="12" r="1.3"/></svg>',
    ok: '<svg viewBox="0 0 24 24"><path d="M6 12.5l4 4L18 8.5"/></svg>',
    bang: '<svg viewBox="0 0 24 24"><path d="M12 7v6"/><path d="M12 16.6v.4"/></svg>',
    plus: '<svg viewBox="0 0 24 24"><path d="M12 6v12M6 12h12"/></svg>',
    file: '<svg viewBox="0 0 24 24"><path d="M6.5 3.5h7l4 4v13h-11z"/><path d="M13.5 3.5v4h4"/></svg>'
  };

  function esc(x) { return String(x == null ? '' : x).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function dayStart(off) { var d = new Date(); d.setHours(0, 0, 0, 0); return d.getTime() - (off || 0) * 86400000; }
  function tm(t) { var d = new Date(t); return pad(d.getHours()) + ':' + pad(d.getMinutes()); }
  function when(t) { var d = new Date(t); return t >= dayStart() ? tm(t) : (d.getMonth() + 1) + '/' + d.getDate() + ' ' + tm(t); }
  function ymd(t) { var d = new Date(t || Date.now()); return d.getFullYear() + pad(d.getMonth() + 1) + pad(d.getDate()); }
  function notify(kind, text, title) { if (window.HRSNotify) HRSNotify[kind](text, title); }
  function sendBg(msg) {
    return new Promise(function (resolve) {
      chrome.runtime.sendMessage(msg, function (r) { void chrome.runtime.lastError; resolve(r || { ok: false, why: '插件后台没回应，请在扩展页重新加载插件' }); });
    });
  }
  function onPage() { var p = $('p-inbox'); return p && p.classList.contains('on'); }
  function recOf(id) { return st.list.find(function (r) { return r.id === id; }); }

  // ---------- 设置 ----------
  function ri() { return Object.assign({}, st.S.ri || {}); }
  function opt() {
    var r = st.S.ri || {};
    return {
      tpl: r.tpl || RI.DEFAULT_TPL, renameOn: r.renameOn !== false, cats: r.cats || RI.DEFAULT_CATS, cities: r.cities || RI.DEFAULT_CITIES,
      catMap: r.catMap || {}, shortCompany: r.shortCompany !== false, autoExport: r.autoExport !== false, replaceOld: r.replaceOld !== false,
      folder: st.S.exportFolder || 'HR人才库', liepinOnlySelf: r.liepinOnlySelf !== false,
      saveTo: r.saveTo === 'folder' && r.dirName ? 'folder' : 'downloads', dirName: r.dirName || '',
      layout: r.layout === 'job' || r.layout === 'flat' ? r.layout : 'day-job', fetchTab: r.fetchTab !== false
    };
  }
  function saveRi(patch, text) {
    var next = Object.assign(ri(), patch);
    st.S.ri = next;
    return (window.HRSOpt ? HRSOpt.save({ ri: next }, text) : HRSStore.saveSettings({ ri: next })).then(function () { renderAll(); paintSettings(); });
  }

  // ---------- 一份简历的状态 ----------
  function info(rec) {
    var o = opt();
    var miss = o.renameOn ? RI.missing(rec, o) : [];
    var path = RI.savePath(rec, o);
    // v2.6.1 只有拿到 PDF 原件才算有文件（只有预览网页地址的不算，也不会保存）
    var noFile = !(rec.file && rec.file.hasBlob);
    var expTo = rec.exp ? (rec.exp.to || 'downloads') : '';
    var s2 = noFile ? 'nofile' : rec.warn ? 'warn' : miss.length ? 'miss' : rec.expWait === 'perm' ? 'perm' : (!rec.exp || expTo !== o.saveTo) ? 'unsaved' : rec.exp.path !== path ? 'renamed' : 'saved';
    var bar = s2 === 'renamed' || s2 === 'perm' ? 'unsaved' : s2 === 'warn' ? 'miss' : s2;
    return { miss: miss, path: path, name: path.split('/').pop(), st: s2, bar: bar };
  }
  var ST_LABEL = { nofile: '没拿到 PDF', warn: '待核对', miss: '待补全', perm: '等授权', unsaved: '未保存', renamed: '改名待重存', saved: '已保存' };
  // 保存到哪：给提示用
  function whereText(o) { o = o || opt(); return o.saveTo === 'folder' ? '「' + o.dirName + '」文件夹' : '下载目录/' + RI.sanitize(o.folder) + '/简历收集'; }
  function fullPath(o, path) { return o.saveTo === 'folder' ? o.dirName + '/' + path : '下载/' + path; }

  // ---------- 筛选 ----------
  function inRange(r) {
    if (st.range === 'today') return r.at >= dayStart();
    if (st.range === '7d') return r.at >= dayStart(6);
    return true;
  }
  var RANGE_TEXT = { today: '今天', '7d': '近 7 天', all: '全部' };
  function jobKey(r) { return r.jdId || '_none'; }
  function jobTitle(k) {
    if (k === '_none') return '未识别岗位';
    var jd = st.jds.find(function (j) { return j.id === k; });
    if (jd) return jd.title;
    var r = st.list.find(function (x) { return x.jdId === k; });
    return r ? r.jdTitle : '岗位';
  }
  function jobCat(k) {
    if (k === '_none') return '';
    var o = opt();
    return (o.catMap[k] && o.cats.indexOf(o.catMap[k]) >= 0) ? o.catMap[k] : RI.guessCat(jobTitle(k), o.cats);
  }
  function baseRows() {
    var q = st.q.trim().toLowerCase();
    return st.list.filter(function (r) {
      if (!inRange(r)) return false;
      if (st.site && r.site !== st.site) return false;
      if (st.origin && (r.origin || 'none') !== st.origin) return false;
      if (q) {
        var v = RI.values(r, opt());
        if ([r.name0, v['姓名'], v['公司'], r.jdTitle, r.jobText].join(' ').toLowerCase().indexOf(q) < 0) return false;
      }
      return true;
    });
  }
  function rowsShown() {
    return baseRows().filter(function (r) {
      if (st.job && jobKey(r) !== st.job) return false;
      if (st.flt && info(r).bar !== st.flt) return false;
      return true;
    }).sort(function (a, b) { return b.at - a.at; });
  }
  function jobOrder(rows) {
    var cnt = {};
    rows.forEach(function (r) { var k = jobKey(r); cnt[k] = (cnt[k] || 0) + 1; });
    var keys = Object.keys(cnt).sort(function (a, b) { if (a === '_none') return 1; if (b === '_none') return -1; return cnt[b] - cnt[a] || jobTitle(a).localeCompare(jobTitle(b), 'zh'); });
    return { keys: keys, cnt: cnt };
  }

  // ---------- 1. 总览：收到几份 + 每个岗位一根状态条 ----------
  function renderOverview() {
    var rows = baseRows(), jo = jobOrder(rows);
    var tot = { saved: 0, unsaved: 0, miss: 0, nofile: 0 }, per = {}, by = { boss: 0, liepin: 0 }, og = { self: 0, request: 0, none: 0 };
    rows.forEach(function (r) {
      var b = info(r).bar, k = jobKey(r);
      tot[b]++;
      per[k] = per[k] || { saved: 0, unsaved: 0, miss: 0, nofile: 0, n: 0 };
      per[k][b]++; per[k].n++;
      by[r.site] = (by[r.site] || 0) + 1;
      og[r.origin === 'self' || r.origin === 'request' ? r.origin : 'none']++;
    });
    if (st.job && !per[st.job]) st.job = '';
    var last = rows.slice().sort(function (a, b) { return b.at - a.at; })[0];
    var max = jo.keys.reduce(function (m, k) { return Math.max(m, per[k].n); }, 1);
    var n = rows.length;
    // 左：大数字 + 平台占比 + 各状态（点一下只看这类）
    var left = '<div class="ov-hero"><div class="ov-k">' + RANGE_TEXT[st.range] + '收到</div><div class="ov-n"><b>' + n + '</b>份</div>' +
      '<div class="ov-plat">' + (n ? '<span class="pl boss" style="flex:' + (by.boss || 0) + '"></span><span class="pl liepin" style="flex:' + (by.liepin || 0) + '"></span>' : '<span class="pl none"></span>') + '</div>' +
      '<div class="ov-pl"><span><i class="dot boss"></i>BOSS ' + (by.boss || 0) + '</span><span><i class="dot liepin"></i>猎聘 ' + (by.liepin || 0) + '</span></div>' +
      '<div class="ov-og"><span><i class="og og-self">自发</i>' + og.self + '</span><span><i class="og og-request">请求</i>' + og.request + '</span>' + (og.none ? '<span><i class="og og-none">未确认</i>' + og.none + '</span>' : '') + '</div>' +
      '<div class="ov-last">' + (last ? '最近一份 <b>' + tm(last.at) + '</b> ' + esc(RI.values(last, opt())['姓名'] || last.name0 || '') : (st.range === 'today' ? '今天还没有收到' : '这段时间没有收到')) + '</div></div>' +
      '<div class="ov-st">' + STATUS.map(function (s2) {
        return '<button type="button" class="ov-s' + (st.flt === s2.k ? ' on' : '') + (tot[s2.k] ? '' : ' zero') + '" data-flt="' + s2.k + '"><i style="background:' + s2.c + '"></i><span>' + s2.label + '</span><b>' + tot[s2.k] + '</b></button>';
      }).join('') + '</div>';
    // 右：每个岗位一根条，按状态分段
    var bars = jo.keys.map(function (k) {
      var p = per[k], w = Math.max(6, Math.round(p.n / max * 100));
      var segs = STATUS.filter(function (s2) { return p[s2.k]; }).map(function (s2) {
        return '<i class="seg" style="flex:' + p[s2.k] + ';background:' + s2.c + '" data-tip="' + esc(jobTitle(k) + ' · ' + s2.label + ' ' + p[s2.k] + ' 份') + '"></i>';
      }).join('');
      var cat = jobCat(k);
      return '<button type="button" class="jb' + (st.job === k ? ' on' : '') + (st.job && st.job !== k ? ' dim' : '') + (k === '_none' ? ' none' : '') + '" data-job="' + esc(k) + '">' +
        '<span class="jb-n"><span class="jb-t">' + esc(jobTitle(k)) + '</span>' + (cat ? '<i class="ib-cat">' + esc(cat) + '</i>' : '') + '</span>' +
        '<span class="jb-bar"><span class="jb-fill" style="width:' + w + '%">' + segs + '</span><b class="jb-c">' + p.n + '</b></span></button>';
    }).join('');
    var right = '<div class="ov-jobs"><div class="ov-jh"><b>按岗位</b><span class="ov-lg">' + STATUS.map(function (s2) { return '<span><i style="background:' + s2.c + '"></i>' + s2.label + '</span>'; }).join('') + '</span>' +
      (st.job || st.flt ? '<a href="#" class="ov-clear" data-clear>看全部</a>' : '') + '</div>' +
      (bars || '<div class="ov-empty">' + (window.HRSEmpty ? HRSEmpty.html('stats', { compact: true, text: '收到简历后，这里每个岗位一根条，颜色表示保存进度' }) : '收到简历后，这里每个岗位一根条，颜色表示保存进度') + '</div>') + '</div>';
    $('ibOv').innerHTML = left + right;
    // 侧边栏角标：今天待补全 + 未保存
    var t0 = dayStart(), todo = st.list.filter(function (r) { var b = info(r).bar; return r.at >= t0 && (b === 'miss' || b === 'unsaved'); }).length;
    var bd = $('navInboxBd');
    if (bd) { bd.hidden = !todo; bd.textContent = String(todo); bd.title = '今天有 ' + todo + ' 份待补全或未保存'; }
  }
  $('ibOv').addEventListener('click', function (e) {
    var b = e.target.closest('[data-job],[data-flt],[data-clear]');
    if (!b) return;
    e.preventDefault();
    if (b.dataset.clear != null) { st.job = ''; st.flt = ''; }
    else if (b.dataset.job != null) st.job = st.job === b.dataset.job ? '' : b.dataset.job;
    else st.flt = st.flt === b.dataset.flt ? '' : b.dataset.flt;
    closePop();
    renderAll();
  });

  // v2.6.0 简历来源：自发（候选人主动发的）/ 请求（我们索要后发的）
  function originChip(rec) {
    var o = rec.origin === 'self' || rec.origin === 'request' ? rec.origin : 'none';
    var tip = o === 'self' ? '自发：候选人主动发来的' : o === 'request' ? '请求：我们索要后对方发来的' : '来源未确认（点「⋯」可以改）';
    return '<i class="og og-' + o + '" data-tip="' + esc(tip + (rec.originWhy ? '。判断依据：' + rec.originWhy : '')) + '">' + (RI.ORIGIN_LABEL[rec.origin] || '未确认') + '</i>';
  }
  // ---------- 2. 简历卡片 ----------
  function pillClass(x) {
    if (!x || x.v === '' || x.v == null) return 'p-miss';
    if (x.src === 'man') return 'p-man';
    if (x.agree === true) return 'p-agree';
    if (x.agree === false) return 'p-conflict';
    return 'p-auto';
  }
  function pillTip(f, x) {
    if (!x || x.v === '' || x.v == null) return FL[f] + '：没识别到' + (x && x.hint ? '（简历里写的是「' + x.hint + '」，不在选项里）' : '') + '，点一下补上';
    var t = FL[f] + '：' + (SRC[x.src] || x.src);
    if (x.override) t += '（你更正过，自动识别的是「' + (x.auto || '空') + '」）';
    else if (x.agree === true) t += '，和' + (x.src === 'pdf' ? '在线简历' : 'PDF') + '一致';
    else if (x.agree === false) t += '，' + (x.src === 'pdf' ? '在线简历' : 'PDF') + '里是「' + x.other + '」';
    if (x.calc) t += '，按 PDF 里第一段工作算的';
    return t + '。点一下可以更正';
  }
  function pillHtml(rec, key, r) {
    var f = TK[key];
    if (key === '平台') return '<span class="pill p-fixed"><b>' + esc(RI.SITE_LABEL[rec.site] || '') + '</b><i>平台</i></span>';
    if (key === '岗位' || key === '日期') return '<span class="pill p-fixed"><b>' + esc(RI.values(rec, opt())[key]) + '</b><i>' + key + '</i></span>';
    if (key === '年龄学历') return pillHtml(rec, '年龄', r) + pillHtml(rec, '学历', r);
    if (!f) return '';
    var x = r[f], cls = pillClass(x), miss = cls === 'p-miss';
    var shown = miss ? '补' + (f === 'years' ? '年限' : FL[f]) : f === 'years' ? RI.yearsText(x.v) : f === 'age' ? RI.ageText(x.v) : x.v;
    var mark = cls === 'p-agree' ? '<em class="pm">' + ICON.ok + '</em>' : cls === 'p-conflict' ? '<em class="pm">' + ICON.bang + '</em>' : miss ? '<em class="pm">' + ICON.plus + '</em>' : '';
    return '<button type="button" class="pill ' + cls + '" data-f="' + f + '" data-tip="' + esc(pillTip(f, x)) + '">' + mark + '<b>' + esc(shown) + '</b><i>' + (f === 'years' ? '年限' : FL[f]) + '</i></button>';
  }
  function chainHtml(rec) {
    var o = opt(), r = RI.resolve(rec, o);
    if (!o.renameOn) return '<div class="ib-chain off"><span class="ib-off">已关闭自定义重命名，保留原文件名</span></div>';
    var keys = RI.tokensIn(o.tpl);
    return '<div class="ib-chain">' + keys.map(function (k) { return pillHtml(rec, k, r); }).join('') + '</div>';
  }
  function cardHtml(rec) {
    var o = opt(), i = info(rec), v = RI.values(rec, o);
    var lr = st.locRes[rec.id], loc = st.locating[rec.id];
    var site = RI.SITE_LABEL[rec.site] || '';
    var nm = v['姓名'] || rec.name0 || '候选人';
    var stText = i.st === 'miss' ? '缺 ' + i.miss.length + ' 项' : ST_LABEL[i.st];
    var note = i.st === 'nofile' ? '<div class="ib-note n-bad">' + ICON.bang + '<span>' + esc(noFileWhy(rec)) + '</span></div>' :
      i.st === 'warn' ? '<div class="ib-note n-warn">' + ICON.bang + '<span>' + esc(rec.warn) + '</span><button type="button" class="btn ghost sm" data-a="okname">没问题，保存</button></div>' :
      i.st === 'perm' ? '<div class="ib-note n-warn">' + ICON.bang + '<span>保存文件夹要你点一下授权，点上方「授权并保存」</span></div>' : '';
    return '<article class="ib-card s-' + i.bar + (rec.at > st.seen ? ' is-new' : '') + '" data-id="' + esc(rec.id) + '">' +
      '<header class="ib-ch"><span class="ib-av ' + esc(rec.site) + '">' + esc(nm.charAt(0)) + '</span>' +
        '<span class="ib-who"><b>' + esc(nm) + originChip(rec) + '</b><span>' + esc(site) + ' · ' + when(rec.at) + (rec.name0 && rec.name0 !== nm ? ' · 平台上叫「' + esc(rec.name0) + '」' : '') + '</span></span>' +
        '<span class="ib-st st-' + i.bar + '"><i></i>' + stText + '</span></header>' +
      chainHtml(rec) +
      '<div class="ib-fname" title="' + esc(fullPath(o, i.path)) + '">' + ICON.file + '<span>' + esc(i.name) + '</span></div>' + note +
      '<footer class="ib-cf">' +
        '<button type="button" class="ib-b" data-a="view"' + (i.st === 'nofile' ? ' disabled' : '') + '>' + ICON.eye + '<span>预览</span></button>' +
        (i.st === 'nofile' ? '<button type="button" class="ib-b" data-a="refetch"' + (st.refetching[rec.id] ? ' disabled' : '') + ' data-tip="再取一次 PDF 原件（必要时在后台临时打开预览页）">' + ICON.save + '<span>' + (st.refetching[rec.id] ? '正在取…' : '重新取 PDF') + '</span></button>' :
        '<button type="button" class="ib-b" data-a="save" data-tip="' + esc(i.st === 'miss' ? '还缺 ' + i.miss.join('、') + '，也可以先保存' : i.st === 'warn' ? rec.warn : '保存到 ' + fullPath(o, i.path)) + '">' + ICON.save + '<span>' + (i.st === 'saved' ? '已保存' : i.st === 'renamed' ? '重新保存' : '保存') + '</span></button>') +
        '<button type="button" class="ib-b ib-more" data-a="more" aria-label="更多">' + ICON.more + '</button>' +
        '<span class="rl-sp"></span>' +
        '<button type="button" class="ib-loc' + (loc ? ' busy' : '') + (lr ? ' r-' + lr.state : '') + '" data-a="loc" data-tip="' + esc(lr && lr.why ? lr.why : '打开 ' + site + ' 沟通页，找到「' + (rec.name0 || nm) + '」并打开对话') + '">' + ICON.loc + '<span>' + (loc ? '定位中…' : '定位到对话') + '</span></button>' +
      '</footer></article>';
  }
  function renderList() {
    var rows = rowsShown(), box = $('ibList');
    if (!rows.length) {
      var any = st.list.length;
      // v3.0.0 空状态：插画 + 一句说明 + 下一步
      var E = window.HRSEmpty;
      var filtered = st.flt || st.q || st.site || st.job;
      box.innerHTML = '<div class="ib-empty">' + (!E ? '还没有收到简历' : any
        ? (filtered ? E.html('filter', { title: '当前筛选下没有简历', text: '换个条件，或者<a href="#" data-reset>看全部简历</a>' })
          : st.range === 'today' ? E.html('inbox', { title: '今天还没有收到简历', text: '最近几天收到的在 <a href="#" data-range="7d">近 7 天</a> 里' })
            : E.html('inbox', { title: '这段时间没有收到简历', text: '<a href="#" data-range="all">看全部</a>' }))
        : E.html('inbox', { title: '还没有收到简历', text: '在 BOSS / 猎聘的沟通页打开会话，候选人发来的 PDF 会自动出现在这里，智选没在跑也会收',
          actions: [{ label: '去 BOSS 打开一个会话', go: 'https://www.zhipin.com/web/chat/index' }, { label: '打开猎聘', go: 'https://lpt.liepin.com/chat/im' }] })) + '</div>';
      return;
    }
    var groups = {};
    rows.forEach(function (r) { var k = jobKey(r); (groups[k] = groups[k] || []).push(r); });
    var order = jobOrder(rows).keys;
    box.innerHTML = order.map(function (k) {
      var g = groups[k], u = g.filter(function (r) { return info(r).bar === 'unsaved'; }).length, cat = jobCat(k);
      return '<div class="ib-group"><div class="ib-gh"><b>' + esc(jobTitle(k)) + '</b>' + (cat ? '<i class="ib-cat">' + esc(cat) + '</i>' : '') + '<span class="ib-gn">' + g.length + ' 份</span>' +
        '<span class="rl-sp"></span>' + (u ? '<button type="button" class="btn ghost sm" data-savejob="' + esc(k) + '">保存本岗位 ' + u + ' 份</button>' : '') + '</div>' +
        '<div class="ib-cards">' + g.map(cardHtml).join('') + '</div></div>';
    }).join('');
    setTimeout(function () { st.seen = Math.max(st.seen, newest()); }, 1500);
  }
  function newest() { return st.list.reduce(function (m, r) { return Math.max(m, r.at); }, 0); }
  function scrollToCard(id) {
    setTimeout(function () { var el = document.querySelector('.ib-card[data-id="' + id + '"]'); if (el) { el.scrollIntoView({ block: 'center', behavior: 'smooth' }); el.classList.add('flash'); setTimeout(function () { el.classList.remove('flash'); }, 1600); } }, 50);
  }

  // ---------- 3. 点一块：补上 / 更正 ----------
  function closePop() { st.pop = null; $('ibPop').hidden = true; $('ibPop').innerHTML = ''; }
  function placePop(anchor) {
    var pop = $('ibPop'), r = anchor.getBoundingClientRect();
    pop.hidden = false;
    var w = pop.offsetWidth, h = pop.offsetHeight;
    var left = Math.max(12, Math.min(innerWidth - w - 12, r.left));
    var below = r.bottom + 8 + h < innerHeight;
    pop.style.left = left + 'px';
    pop.style.top = (below ? r.bottom + 6 : Math.max(12, r.top - h - 6)) + 'px';
  }
  function cmpLine(rec, f) {
    var on = rec.online || {}, pdf = rec.pdf || {};
    var val = function (src) {
      if (f === 'name') return src === 'online' ? rec.name0 : pdf.name;
      var v = (src === 'online' ? on : pdf)[f];
      if (f === 'years') return RI.yearsText(v);
      if (f === 'age') return RI.ageText(v);
      return v;
    };
    if (f === 'cat') return '<div class="pc"><span>岗位</span><b>' + esc(rec.jdTitle || '未识别') + '</b></div>';
    var a = val('online'), b = val('pdf');
    var pdfState = !rec.file || !rec.file.hasBlob ? '没拿到 PDF' : (rec.pdf && rec.pdf.err) ? '读不出文字' : '';
    return '<div class="pc"><span>在线简历</span><b>' + (a ? esc(a) : '<em>没有</em>') + '</b></div>' +
      '<div class="pc"><span>PDF</span><b>' + (b ? esc(b) : '<em>' + (pdfState || '没有') + '</em>') + '</b></div>';
  }
  function openPop(rec, f, anchor) {
    var o = opt(), r = RI.resolve(rec, o), x = r[f] || { v: '' };
    var has = x.v !== '' && x.v != null;
    var auto = has && x.src !== 'man';
    st.pop = { id: rec.id, f: f };
    var head = '<div class="pop-h"><b>' + FL[f] + '</b><span class="pop-src">' + (has ? (x.src === 'man' ? (x.override ? '你更正过' : '你填的') : '自动识别 · ' + (SRC[x.src] || '')) : '没识别到') + '</span><button type="button" class="pop-x" data-pa="close" aria-label="关闭">×</button></div>';
    var cmp = '<div class="pop-cmp">' + cmpLine(rec, f) + (x.hint ? '<div class="pc hint">简历里的期望城市是「' + esc(x.hint) + '」，不在选项里</div>' : '') + '</div>';
    var body = '';
    var listOf = f === 'cat' ? o.cats : f === 'city' ? o.cities : f === 'edu' ? EDU : null;
    if (listOf) {
      body = '<div class="pop-menu" role="listbox">' + listOf.map(function (v) {
        return '<button type="button" role="option" class="pm-i' + (v === x.v ? ' on' : '') + '" data-pick="' + esc(v) + '"><span>' + esc(v) + '</span>' + (v === x.v ? ICON.ok : '') + '</button>';
      }).join('') + '</div>' +
      (f !== 'edu' ? '<div class="pop-add"><input type="text" data-newopt maxlength="12" placeholder="＋ 新' + (f === 'cat' ? '类别' : '城市') + '"><button type="button" class="btn ghost sm" data-pa="addopt">添加</button></div>' : '');
    } else {
      var alts = [];
      if (f === 'company') {
        [(rec.online || {}).company, (rec.pdf || {}).company].forEach(function (c) {
          if (!c) return;
          [c, o.shortCompany ? RI.shortCompany(c) : ''].forEach(function (y) { if (y && y !== x.v && alts.indexOf(y) < 0) alts.push(y); });
        });
      }
      if (f === 'name' && rec.name0 && rec.name0 !== x.v) alts.push(rec.name0);
      if (f === 'name' && rec.pdf && rec.pdf.name && rec.pdf.name !== x.v && alts.indexOf(rec.pdf.name) < 0) alts.push(rec.pdf.name);
      var num = f === 'years' || f === 'age';
      body = '<div class="pop-in"><input type="' + (num ? 'number' : 'text') + '" data-val value="' + esc(x.v) + '"' + (num ? ' min="0" max="70"' : ' maxlength="40"') + '>' + (num ? '<span>' + (f === 'years' ? '年' : '岁') + '</span>' : '') + '<button type="button" class="btn sm" data-pa="ok">' + (auto ? '更正' : '确定') + '</button></div>' +
        (alts.length ? '<div class="pop-alts">' + alts.map(function (a) { return '<button type="button" data-pick="' + esc(a) + '">' + esc(a) + '</button>'; }).join('') + '</div>' : '');
    }
    var foot = (x.src === 'man' && (x.override || x.auto)) || (rec.man && rec.man._o && rec.man._o[f]) ? '<div class="pop-f"><button type="button" class="btn ghost sm" data-pa="reset">恢复自动识别' + (x.auto ? '（' + esc(f === 'years' ? RI.yearsText(x.auto) : f === 'age' ? RI.ageText(x.auto) : x.auto) + '）' : '') + '</button></div>' :
      auto ? '<div class="pop-f note">自动识别优先。改了就算「更正」，这一项以你填的为准</div>' : '';
    $('ibPop').innerHTML = head + cmp + body + foot;
    placePop(anchor);
    var inp = $('ibPop').querySelector('[data-val],[data-newopt]');
    if (inp && !listOf) { inp.focus(); inp.select && inp.select(); }
  }
  function applyPick(v) {
    var p = st.pop; if (!p) return;
    var rec = recOf(p.id); if (!rec) return closePop();
    var r = RI.resolve(rec, opt()), x = r[p.f] || {};
    var autoHas = x.src && x.src !== 'man' && x.v !== '' && x.v != null;
    var hadAuto = autoHas || x.override;
    if (p.f === 'years' || p.f === 'age') v = v === '' ? '' : Math.max(0, parseInt(v, 10) || 0);
    else v = String(v).trim();
    if (autoHas && String(v) === String(x.v)) { closePop(); return; }   // 没改
    var man = {}, o2 = Object.assign({}, (rec.man && rec.man._o) || {});
    man[p.f] = v;
    if (hadAuto && v !== '') o2[p.f] = true; else delete o2[p.f];
    man._o = o2;
    closePop();
    patch(rec.id, man).then(function () { notify('success', FL[p.f] + (hadAuto ? '已更正' : '已补上') + '：' + (v === '' ? '空' : v)); });
  }
  function resetPick() {
    var p = st.pop; if (!p) return;
    var rec = recOf(p.id); if (!rec) return closePop();
    var o2 = Object.assign({}, (rec.man && rec.man._o) || {}); delete o2[p.f];
    var man = { _o: o2 }; man[p.f] = '';
    closePop();
    patch(rec.id, man).then(function () { notify('success', FL[p.f] + '已恢复自动识别'); });
  }
  $('ibPop').addEventListener('click', function (e) {
    var b = e.target.closest('[data-pick],[data-pa]');
    if (!b) return;
    if (b.dataset.pick != null) { applyPick(b.dataset.pick); return; }
    var a = b.dataset.pa;
    if (a === 'close') closePop();
    else if (a === 'ok') applyPick($('ibPop').querySelector('[data-val]').value);
    else if (a === 'reset') resetPick();
    else if (a === 'addopt') addOpt();
    else if (a === 'reparse' || a === 'del' || a === 'open' || a === 'refetch') moreAct(a);
  });
  $('ibPop').addEventListener('keydown', function (e) {
    if (e.key === 'Escape') { closePop(); return; }
    if (e.key !== 'Enter') return;
    if (e.target.dataset.val != null) applyPick(e.target.value);
    if (e.target.dataset.newopt != null) addOpt();
  });
  function addOpt() {
    var p = st.pop, inp = $('ibPop').querySelector('[data-newopt]');
    var v = String(inp && inp.value || '').trim();
    if (!p || !v) { if (inp) inp.focus(); return; }
    var key = p.f === 'cat' ? 'cats' : 'cities', arr = opt()[key].slice();
    if (arr.indexOf(v) < 0) arr.push(v);
    var pp = {}; pp[key] = arr;
    saveRi(pp, '已添加选项「' + v + '」').then(function () { st.pop = p; applyPick(v); });
  }
  document.addEventListener('mousedown', function (e) {
    if (!st.pop || $('ibPop').contains(e.target) || (e.target.closest && e.target.closest('.pill,[data-a="more"]'))) return;
    closePop();
  }, true);
  // 页面滚动时小面板跟着那一块走；那一块滚出屏幕就关掉
  window.addEventListener('scroll', function () {
    if (!st.pop) return;
    var a = st.pop.f === 'more' ? document.querySelector('.ib-card[data-id="' + st.pop.id + '"] [data-a="more"]') : document.querySelector('.ib-card[data-id="' + st.pop.id + '"] .pill[data-f="' + st.pop.f + '"]');
    if (!a) { closePop(); return; }
    var r = a.getBoundingClientRect();
    if (r.bottom < 0 || r.top > innerHeight) closePop(); else placePop(a);
  }, true);
  function patch(id, man, extra) {
    var rec = recOf(id);
    var msg = Object.assign({ type: 'INBOX_PATCH', id: id, man: man || null, export: !!(rec && !rec.exp) }, extra || {});
    return sendBg(msg).then(function (r) {
      if (!r.ok) notify('error', r.why || '没改成');
      else if (r.exp && r.exp.ok && !r.exp.same) notify('success', '名字齐了，已保存到本地：' + r.exp.filename.split('/').pop());
      return r;
    });
  }
  // 卡片右下「⋯」：换岗位、重新读 PDF、删除
  function openMore(rec, anchor) {
    st.pop = { id: rec.id, f: 'more' };
    var jdOpts = '<select data-jd><option value="">未识别岗位</option>' + st.jds.map(function (j) { return '<option value="' + esc(j.id) + '"' + (j.id === rec.jdId ? ' selected' : '') + '>' + esc(j.title) + '</option>'; }).join('') + '</select>';
    var f = rec.file || {};
    var pdfNote = !f.hasBlob ? noFileWhy(rec) : (rec.pdf && rec.pdf.err) ? rec.pdf.err : (rec.pdf && rec.pdf.parsed) ? 'PDF 已读取' + (VIA[f.via] ? '（' + VIA[f.via] + '）' : '') : '正在读取 PDF';
    $('ibPop').innerHTML = '<div class="pop-h"><b>这份简历</b><button type="button" class="pop-x" data-pa="close" aria-label="关闭">×</button></div>' +
      '<div class="pop-cmp"><div class="pc"><span>原文件</span><b>' + esc(f.name || '') + (f.size ? '（' + Math.max(1, Math.round(f.size / 1024)) + ' KB）' : '') + '</b></div>' +
      '<div class="pc"><span>PDF</span><b>' + esc(pdfNote) + '</b></div>' + (rec.jobText ? '<div class="pc"><span>沟通职位</span><b>' + esc(rec.jobText) + '</b></div>' : '') +
      (rec.exp ? '<div class="pc"><span>上次保存</span><b>' + when(rec.exp.at) + ' · ' + esc(rec.exp.to === 'folder' ? '自选文件夹' : '下载目录') + '</b></div>' : '') + (rec.expErr ? '<div class="pc hint">保存失败：' + esc(rec.expErr) + '</div>' : '') + '</div>' +
      '<div class="pop-row"><span>归到岗位</span>' + jdOpts + '</div>' +
      '<div class="pop-row"><span>简历来源</span><select data-og><option value="self"' + (rec.origin === 'self' ? ' selected' : '') + '>自发（候选人主动发的）</option><option value="request"' + (rec.origin === 'request' ? ' selected' : '') + '>请求（我们索要后发的）</option><option value=""' + (!rec.origin ? ' selected' : '') + '>未确认</option></select></div>' +
      (rec.originWhy ? '<div class="pop-f note" style="margin:-4px 0 6px;text-align:right;">判断依据：' + esc(rec.originWhy) + '</div>' : '') +
      '<div class="pop-f">' + (f.hasBlob ? '<button type="button" class="btn ghost sm" data-pa="reparse">重新读 PDF</button>' : '<button type="button" class="btn ghost sm" data-pa="refetch">重新取 PDF</button>') + '<button type="button" class="btn danger sm" data-pa="del">删除记录</button></div>';
    placePop(anchor);
  }
  $('ibPop').addEventListener('change', function (e) {
    if (e.target.matches('select[data-og]') && st.pop) {
      var oid = st.pop.id, v = e.target.value;
      closePop();
      patch(oid, null, { origin: v }).then(function () { notify('success', '来源已改成「' + (RI.ORIGIN_LABEL[v] || '未确认') + '」'); });
      return;
    }
    if (!e.target.matches('select[data-jd]') || !st.pop) return;
    var id = st.pop.id, jd = st.jds.find(function (j) { return j.id === e.target.value; });
    closePop();
    patch(id, null, { jd: jd ? { id: jd.id, title: jd.title } : null }).then(function () { notify('success', '已归到「' + (jd ? jd.title : '未识别岗位') + '」'); });
  });
  function moreAct(a) {
    var rec = recOf(st.pop && st.pop.id); if (!rec) return closePop();
    closePop();
    if (a === 'refetch') refetch(rec);
    if (a === 'reparse') sendBg({ type: 'INBOX_REPARSE', id: rec.id }).then(function (r) { notify(r.ok && r.pdf && !r.pdf.err ? 'success' : 'warn', r.ok && r.pdf && !r.pdf.err ? 'PDF 已重新读取' : ((r.pdf && r.pdf.err) || r.why || '没读出来')); });
    if (a === 'del' && confirm('删除「' + (RI.values(rec, opt())['姓名'] || '候选人') + '」这条记录？已经保存到本地的文件不受影响')) sendBg({ type: 'INBOX_DELETE', ids: [rec.id] }).then(function () { notify('success', '已删除'); });
  }

  // ---------- 动作 ----------
  function preview(rec) {
    var open = function (u) { var w = window.open(u, '_blank'); if (!w) notify('warn', '浏览器拦住了新窗口，请允许弹出窗口'); };
    if (rec.file && rec.file.hasBlob && DBX) {
      DBX.get(rec.id).then(function (b) {
        if (!b) { notify('error', '本机简历库里没有这份 PDF'); return; }
        var u = URL.createObjectURL(b); open(u); setTimeout(function () { URL.revokeObjectURL(u); }, 60000);
      }).catch(function (e) { notify('error', '打不开：' + (e && e.message || e)); });
    } else notify('warn', '没拿到 PDF 原件，没法预览。可以点「重新取 PDF」，或定位到对话在平台上打开预览');
  }
  // 没拿到原件的原因（给卡片和「⋯」面板用）
  var VIA = { page: '页面里取到', bg: '后台用登录状态取到', seen: '会话里加载过的 PDF', tab: '临时打开预览页取到', preview: '你打开预览时接住', download: '你在平台上下载时接住' };
  function noFileWhy(rec) {
    var f = rec.file || {};
    var t = f.url ? '只拿到预览网页，没拿到 PDF 原件' : '会话里有简历消息，但没拿到 PDF 文件';
    return t + '。在平台上打开一次这份简历的预览或点「下载」，插件会自动接住';
  }
  function refetch(rec) {
    if (st.refetching[rec.id]) return;
    st.refetching[rec.id] = 1;
    renderList();
    notify('info', '正在重新取「' + (rec.name0 || '候选人') + '」的 PDF 原件，最多约 30 秒');
    sendBg({ type: 'INBOX_REFETCH', id: rec.id }).then(function (r) {
      delete st.refetching[rec.id];
      if (r.ok) notify('success', r.exp && r.exp.ok ? '拿到 PDF 了，已保存：' + String(r.exp.filename || '').split('/').pop() : '拿到 PDF 了' + (r.exp && r.exp.needPerm ? '，保存文件夹等你授权' : ''));
      else notify('warn', r.why || '还是没取到', '重新取 PDF');
      renderList();
    });
  }
  function saveIds(ids, force, label) {
    if (!ids.length) { notify('info', '没有要保存的简历'); return Promise.resolve(); }
    return sendBg({ type: 'INBOX_EXPORT', ids: ids, force: !!force }).then(function (r) {
      var res = r.results || [];
      var ok = res.filter(function (x) { return x.ok && !x.same; }).length, same = res.filter(function (x) { return x.same; }).length;
      var bad = res.filter(function (x) { return !x.ok; });
      var perm = bad.filter(function (x) { return x.needPerm; });
      if (perm.length) { notify('warn', perm.length + ' 份等你授权保存文件夹，点上方「授权并保存」', label || '保存到本地'); bad = bad.filter(function (x) { return !x.needPerm; }); }
      if (bad.length) notify('error', bad.length + ' 份没保存成：' + bad[0].why, label || '保存到本地');
      if (ok) notify('success', ids.length === 1 ? '已保存：' + res[0].filename.split('/').pop() : '已保存 ' + ok + ' 份到' + whereText());
      else if (same && !bad.length) notify('info', '已经保存过了，文件名没变');
    });
  }
  function locate(rec) {
    if (st.locating[rec.id]) return;
    st.locating[rec.id] = Date.now();
    delete st.locRes[rec.id];
    renderList();
    sendBg({ type: 'INBOX_LOCATE', id: rec.id }).then(function (r) {
      if (!r.ok) { delete st.locating[rec.id]; st.locRes[rec.id] = { state: 'fail', why: r.why }; notify('error', r.why, '定位'); renderList(); return; }
      notify('info', (r.how === 'reuse' ? '已切到开着的 ' : '已打开 ') + RI.SITE_LABEL[rec.site] + ' 沟通页，正在找「' + rec.name0 + '」', '定位');
      // 页面那边找到 / 没找到会写回 findResult；40 秒没消息就提示去页面看
      setTimeout(function () {
        if (st.locating[rec.id]) { delete st.locating[rec.id]; st.locRes[rec.id] = { state: 'wait', why: '还没收到结果，请看平台页面右下角的Smart Filter 浮层' }; renderList(); }
      }, 40000);
    });
  }
  $('ibList').addEventListener('click', function (e) {
    var a = e.target.closest('a[data-reset],a[data-range]');
    if (a) {
      e.preventDefault();
      if (a.dataset.reset != null) { st.flt = ''; st.q = ''; $('ibQ').value = ''; st.site = ''; $('ibSite').value = ''; st.origin = ''; $('ibOrigin').value = ''; st.job = ''; renderAll(); }
      else { setRange(a.dataset.range); renderAll(); }
      return;
    }
    var sj = e.target.closest('[data-savejob]');
    if (sj) {
      saveIds(rowsShown().filter(function (r) { return jobKey(r) === sj.dataset.savejob && info(r).bar === 'unsaved'; }).map(function (r) { return r.id; }), false, '保存本岗位');
      return;
    }
    var card = e.target.closest('.ib-card[data-id]');
    if (!card) return;
    var rec = recOf(card.dataset.id);
    if (!rec) return;
    var pill = e.target.closest('.pill[data-f]');
    if (pill) {
      if (st.pop && st.pop.id === rec.id && st.pop.f === pill.dataset.f) { closePop(); return; }
      openPop(rec, pill.dataset.f, pill);
      return;
    }
    var btn = e.target.closest('button[data-a]');
    if (!btn || btn.disabled) return;
    var act = btn.dataset.a;
    if (act === 'view') preview(rec);
    else if (act === 'save') saveIds([rec.id], info(rec).st === 'saved');
    else if (act === 'refetch') refetch(rec);
    else if (act === 'okname') patch(rec.id, null, { clearWarn: true, export: true }).then(function (r) { if (r.ok && !(r.exp && r.exp.ok)) notify('success', '已确认'); });
    else if (act === 'loc') locate(rec);
    else if (act === 'more') { if (st.pop && st.pop.id === rec.id && st.pop.f === 'more') closePop(); else openMore(rec, btn); }
  });

  // ---------- 工具条 ----------
  function setRange(v) {
    st.range = v; ls.set('ibRange', v);
    Array.prototype.forEach.call($('ibRange').children, function (x) { x.classList.toggle('on', x.dataset.v === v); });
  }
  $('ibRange').addEventListener('click', function (e) { var b = e.target.closest('button[data-v]'); if (!b) return; setRange(b.dataset.v); closePop(); renderAll(); });
  $('ibSite').addEventListener('change', function () { st.site = this.value; renderAll(); });
  $('ibOrigin').addEventListener('change', function () { st.origin = this.value; renderAll(); });
  $('ibQ').addEventListener('input', function () { st.q = this.value; renderAll(); });
  $('ibSet').addEventListener('click', function () { closePop(); if (window.HRSShell && HRSShell.openCfg) HRSShell.openCfg('cardInboxSet', '命名与收集设置'); });
  $('ibOn').addEventListener('click', function () { $('ibSet').click(); });
  $('ibSaveAll').addEventListener('click', function () {
    var rows = rowsShown();
    var ids = rows.filter(function (r) { return info(r).bar === 'unsaved'; }).map(function (r) { return r.id; });
    var missN = rows.filter(function (r) { return info(r).bar === 'miss'; }).length;
    if (!ids.length) { notify('info', missN ? '还有 ' + missN + ' 份待补全，补全后再保存（也可以在那张卡片上单独点保存）' : '当前列表里的简历都已保存'); return; }
    saveIds(ids, false, '全部保存到本地').then(function () { if (missN) notify('warn', missN + ' 份待补全的没有保存，补全后再保存'); });
  });
  $('ibSheet').addEventListener('click', function () {
    var rows = rowsShown();
    if (!rows.length) { notify('warn', '当前筛选下没有简历'); return; }
    if (!window.HRSXlsx) { notify('error', '导出组件没有加载，请刷新页面'); return; }
    var o = opt();
    var head = ['收到时间', '岗位', '类别', '姓名', '公司', '工作年限', '年龄', '学历', '城市', '平台', '来源', '命名后的文件名', '状态', '沟通职位'];
    var line = function (r) {
      var v = RI.values(r, o), i = info(r), d = new Date(r.at);
      return [d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) + ' ' + tm(r.at), jobTitle(jobKey(r)), v['类别'], v['姓名'], v['公司'], v['年限'], v['年龄'], v['学历'], v['城市'], v['平台'], RI.ORIGIN_LABEL[r.origin] || '未确认', i.name, ST_LABEL[i.st], r.jobText || ''];
    };
    var W = [17, 20, 7, 9, 18, 9, 7, 7, 7, 7, 8, 46, 11, 22];
    var jo = jobOrder(rows);
    var sheets = [{ name: '全部（' + rows.length + '份）', rows: [head].concat(rows.map(line)), widths: W }];
    jo.keys.slice(0, 20).forEach(function (k) {
      sheets.push({ name: jobTitle(k).replace(/[\\/?*[\]:]/g, ' ').slice(0, 24) + '（' + jo.cnt[k] + '）', rows: [head].concat(rows.filter(function (r) { return jobKey(r) === k; }).map(line)), widths: W });
    });
    var blob = HRSXlsx.write(sheets);
    var base = '简历汇总-' + ({ today: '今天', '7d': '近7天', all: '全部' }[st.range]) + '-' + ymd() + '.xlsx';
    // v2.6.1 选了自己的文件夹：汇总表也放进那个文件夹
    if (o.saveTo === 'folder' && SD) {
      SD.get().then(function (h) {
        if (!h) throw new Error('还没有选保存文件夹');
        return SD.perm(h, true).then(function (p) {
          if (p !== 'granted') throw new Error('没有授权写入「' + h.name + '」');
          return SD.write(h, base, blob, {});
        }).then(function (path) { st.perm = 'granted'; renderFix(); notify('success', '已导出到「' + h.name + '/' + path + '」，每个岗位一个工作表'); });
      }).catch(function (e) { notify('error', '汇总表没导出：' + (e && e.message || e)); });
      return;
    }
    var url = URL.createObjectURL(blob);
    var fn = RI.sanitize(o.folder) + '/简历收集/' + base;
    chrome.downloads.download({ url: url, filename: fn, saveAs: false, conflictAction: 'uniquify' }, function () {
      void chrome.runtime.lastError;
      notify('success', '已导出到「下载/' + fn + '」，每个岗位一个工作表');
      setTimeout(function () { URL.revokeObjectURL(url); }, 30000);
    });
  });

  // ---------- 侦察提示 ----------
  function renderRecon() {
    var t0 = dayStart(), n = st.recon.filter(function (x) { return x.at >= t0; }).length;
    var box = $('ibRecon');
    $('ri_recon').textContent = st.recon.length ? '共 ' + st.recon.length + ' 条，最近一条 ' + when(st.recon[st.recon.length - 1].at) + '（' + (st.recon[st.recon.length - 1].name || '') + '）' : '没有';
    if (!n) { box.hidden = true; return; }
    box.hidden = false;
    box.innerHTML = '<i class="rl-ai">' + ICON.bang + '</i><div class="rl-at"><div class="rl-at-h"><b>今天有 ' + n + ' 个会话看到了简历消息，但没拿到 PDF 文件</b></div>' +
      '<div class="rl-at-t">平台的附件可能要先点「同意 / 预览」才会出现文件。打开那份简历的预览后会自动收进来；一直收不到时导出侦察记录发给开发。</div></div>' +
      '<div class="rl-aa"><button class="btn ghost sm" type="button" data-rx="export">导出侦察记录</button></div>';
  }
  // ---------- v2.6.1 两条提示：保存文件夹要授权 / 之前误存的网页文件 ----------
  function renderFix() {
    var o = opt();
    var wait = st.list.filter(function (r) { return r.expWait === 'perm' && r.file && r.file.hasBlob; });
    var pb = $('ibPerm');
    var needAuth = o.saveTo === 'folder' && (wait.length || st.perm === 'prompt' || st.perm === 'denied' || st.perm === 'none');
    if (needAuth) {
      pb.hidden = false;
      pb.className = 'rl-alert a-soft';
      var lost = st.perm === 'none';
      pb.innerHTML = '<i class="rl-ai">' + ICON.bang + '</i><div class="rl-at"><div class="rl-at-h"><b>' + (lost ? '保存文件夹找不到了' : '保存到「' + esc(o.dirName) + '」需要你点一下授权') + '</b>' + (wait.length ? '<span>' + wait.length + ' 份简历在等</span>' : '') + '</div>' +
        '<div class="rl-at-t">' + (lost ? '可能被移动、改名或删除了，请重新选择一个文件夹。' : '浏览器重启后会要求重新授权。弹出的提示里选「每次访问时都允许」，以后就不用再点。') + '</div></div>' +
        '<div class="rl-aa">' + (lost ? '<button class="btn sm" type="button" data-fx="pick">重新选择文件夹</button>' : '<button class="btn sm" type="button" data-fx="auth">授权并保存</button>') + '<button class="btn ghost sm" type="button" data-fx="dl">改存到下载目录</button></div>';
    } else pb.hidden = true;
    var bad = st.list.filter(function (r) { return r.badExp; });
    var bb = $('ibBad');
    if (bad.length) {
      bb.hidden = false;
      bb.className = 'rl-alert';
      bb.innerHTML = '<i class="rl-ai">' + ICON.bang + '</i><div class="rl-at"><div class="rl-at-h"><b>之前有 ' + bad.length + ' 份简历存成了网页文件（.htm），不是 PDF</b></div>' +
        '<div class="rl-at-t">原因是平台只给了预览网页，旧版本把网页当成简历存了。这几份已改回「没拿到 PDF」：在平台上打开一次预览或点「下载」，插件会接住原件按规则保存。旧的 .htm 文件可以一键删掉（只删插件存的那几个）。</div></div>' +
        '<div class="rl-aa"><button class="btn ghost sm" type="button" data-fx="refetchbad">重新取 PDF</button><button class="btn sm" type="button" id="ibCleanBad" data-fx="clean">删掉这些 .htm</button></div>';
    } else bb.hidden = true;
  }
  function authAndSave() {
    if (!SD) return Promise.resolve(false);
    return SD.get().then(function (h) {
      if (!h) { st.perm = 'none'; renderFix(); return false; }
      return SD.perm(h, true).then(function (p) {
        st.perm = p;
        if (p !== 'granted') { notify('warn', '没有授权，简历先留在这里，授权后再保存'); renderFix(); return false; }
        var ids = st.list.filter(function (r) { return r.expWait === 'perm' && r.file && r.file.hasBlob; }).map(function (r) { return r.id; });
        renderFix();
        notify('success', '已授权「' + h.name + '」');
        return ids.length ? saveIds(ids, false, '授权后保存').then(function () { return true; }) : true;
      });
    }).catch(function (e) { notify('error', '授权没成功：' + (e && e.message || e)); return false; });
  }
  function checkPerm() {
    var o = opt();
    if (o.saveTo !== 'folder' || !SD) { st.perm = ''; paintWhere(); renderFix(); return Promise.resolve(''); }
    return SD.get().then(function (h) {
      if (!h) return 'none';
      return SD.perm(h, false).then(function (p) {
        if (p !== 'granted') return p;
        // 已授权：再确认文件夹还在（被删掉、移走时读不了里面的内容）
        return h.values().next().then(function () { return 'granted'; }, function (e) { return e && e.name === 'NotFoundError' ? 'none' : 'granted'; });
      });
    }).catch(function () { return 'none'; }).then(function (p) { st.perm = p; paintWhere(); renderFix(); return p; });
  }
  function pickDir() {
    if (!window.showDirectoryPicker || !SD) { notify('error', '这个浏览器不支持选择文件夹，请用新版 Chrome 或 Edge，或者改存到下载目录'); return; }
    window.showDirectoryPicker({ id: 'hrsResume', mode: 'readwrite', startIn: 'documents' }).then(function (h) {
      return SD.perm(h, true).then(function (p) {
        if (p !== 'granted') throw new Error('没有允许插件往这个文件夹里写文件');
        return SD.set(h);
      }).then(function () {
        st.perm = 'granted';
        return saveRi({ saveTo: 'folder', dirName: h.name }, '保存位置：「' + h.name + '」文件夹');
      }).then(function () {
        var ids = st.list.filter(function (r) { return r.expWait === 'perm' && r.file && r.file.hasBlob; }).map(function (r) { return r.id; });
        if (ids.length) saveIds(ids, false, '保存到新文件夹');
      });
    }).catch(function (e) {
      if (e && e.name === 'AbortError') return;
      notify('error', '没选成：' + (e && e.message || e) + '。桌面、下载这类系统文件夹本身不能选，请选它里面的一个文件夹');
    });
  }
  function useDownloads() { saveRi({ saveTo: 'downloads' }, '保存位置：浏览器下载目录').then(function () { st.perm = ''; renderFix(); }); }
  [$('ibPerm'), $('ibBad')].forEach(function (box) {
    box.addEventListener('click', function (e) {
      var b = e.target.closest('[data-fx]'); if (!b) return;
      var fx = b.dataset.fx;
      if (fx === 'auth') authAndSave();
      else if (fx === 'pick') pickDir();
      else if (fx === 'dl') useDownloads();
      else if (fx === 'clean') {
        if (!confirm('删掉之前误存的网页文件（.htm）？只删插件自己存的、确实是网页的那几个，简历记录保留')) return;
        sendBg({ type: 'INBOX_CLEAN_BAD' }).then(function (r) { notify(r.ok ? 'success' : 'error', r.ok ? '已删掉 ' + r.removed + ' 个网页文件' + (r.total > r.removed ? '（其余 ' + (r.total - r.removed) + ' 个已经不在了）' : '') : (r.why || '没删成')); });
      } else if (fx === 'refetchbad') {
        st.list.filter(function (r) { return r.badExp && !(r.file && r.file.hasBlob); }).slice(0, 10).forEach(function (r, i) { setTimeout(function () { refetch(r); }, i * 400); });
      }
    });
  });

  function exportRecon() {
    // v2.6.1 也带上没拿到 PDF 的那些简历试过哪些地址（不含简历内容），方便下一轮对着改
    var noPdf = st.list.filter(function (r) { return !(r.file && r.file.hasBlob); }).slice(-20).map(function (r) {
      var f = r.file || {};
      return { at: new Date(r.at).toISOString(), site: r.site, name: r.name0, file: f.name, url: f.url || '', alts: f.alts || [], tried: f.tried || [] };
    });
    if (!st.recon.length && !noPdf.length) { notify('info', '没有侦察记录'); return; }
    var blob = new Blob([JSON.stringify({ app: 'Smart Filter', v: chrome.runtime.getManifest().version, at: new Date().toISOString(), recon: st.recon, noPdf: noPdf }, null, 2)], { type: 'application/json' });
    var url = URL.createObjectURL(blob), fn = 'smartfilter-inbox-recon-' + ymd() + '.json';
    chrome.downloads.download({ url: url, filename: fn, saveAs: false, conflictAction: 'uniquify' }, function () { void chrome.runtime.lastError; notify('success', '已导出到「下载/' + fn + '」'); setTimeout(function () { URL.revokeObjectURL(url); }, 30000); });
  }
  $('ibRecon').addEventListener('click', function (e) { if (e.target.closest('[data-rx]')) exportRecon(); });
  $('ri_reconExport').addEventListener('click', exportRecon);
  $('ri_reconClear').addEventListener('click', function () { chrome.storage.local.set({ inboxRecon: [] }, function () { notify('success', '侦察记录已清空'); }); });

  // ---------- 设置：分页 ----------
  var setCard = $('cardInboxSet');
  setCard.querySelector('.ib-tabs').addEventListener('click', function (e) {
    var b = e.target.closest('.ib-tab'); if (!b) return;
    Array.prototype.forEach.call(setCard.querySelectorAll('.ib-tab'), function (x) { x.classList.toggle('on', x === b); });
    Array.prototype.forEach.call(setCard.querySelectorAll('.ib-pane'), function (x) { x.classList.toggle('on', x.dataset.pane === b.dataset.tab); });
  });

  // ---------- 设置：命名积木（拖动换顺序） ----------
  // 格式拆成「块 + 分隔符」；块之间分隔符都一样、前后没有别的字时，可以用积木改
  function parseTpl(tpl) {
    var toks = [], seps = [], re = /\{([^{}]+)\}/g, m, last = 0, lead = '', tail = '';
    while ((m = re.exec(tpl)) !== null) {
      var lit = tpl.slice(last, m.index);
      if (!toks.length) lead = lit; else seps.push(lit);
      toks.push(m[1]);
      last = m.index + m[0].length;
    }
    tail = tpl.slice(last);
    var sep = seps.length ? seps[0] : '—';
    var simple = !lead && !tail && seps.every(function (x) { return x === sep; }) && ['—', '-', '_', ' ', '·'].indexOf(sep) >= 0;
    return { toks: toks, sep: sep, simple: simple };
  }
  function buildTpl(toks, sep) { return toks.map(function (t) { return '{' + t + '}'; }).join(sep); }
  var drag = null;
  function paintBuilder() {
    var o = opt(), p = parseTpl(o.tpl);
    var desc = {}; RI.TOKENS.forEach(function (t) { desc[t.k] = t.d; });
    $('ri_builder').innerHTML = p.toks.map(function (k, i) {
      return (i ? '<span class="bd-sep">' + esc(p.sep === ' ' ? '␣' : p.sep) + '</span>' : '') +
        '<span class="bd-blk" draggable="true" data-i="' + i + '" data-tip="' + esc(desc[k] || '') + '">' +
        '<button type="button" class="bd-mv" data-mv="-1" aria-label="往前"' + (i ? '' : ' disabled') + '>‹</button><b>' + esc(k) + '</b>' +
        '<button type="button" class="bd-mv" data-mv="1" aria-label="往后"' + (i < p.toks.length - 1 ? '' : ' disabled') + '>›</button>' +
        '<button type="button" class="bd-rm" data-rm-i="' + i + '" aria-label="去掉">×</button></span>';
    }).join('') || '<span class="ib-tip" style="margin:0;">一个块都没有，至少加上「姓名」</span>';
    var used = p.toks;
    $('ri_tray').innerHTML = RI.TOKENS.filter(function (t) { return used.indexOf(t.k) < 0; }).map(function (t) {
      return '<button type="button" class="tr-blk" data-add-tok="' + t.k + '" data-tip="' + esc(t.d) + '">＋ ' + t.k + '</button>';
    }).join('') || '<span class="ib-tip" style="margin:0;">都用上了</span>';
    Array.prototype.forEach.call($('ri_sep').children, function (b) { b.classList.toggle('on', p.simple && b.dataset.v === p.sep); });
    $('ri_builder').classList.toggle('locked', !p.simple);
    $('ri_tray').classList.toggle('locked', !p.simple);
  }
  function setToks(toks, sep, text) {
    var tpl = buildTpl(toks, sep);
    $('ri_tpl').value = tpl;
    saveRi({ tpl: tpl }, text || '命名格式已保存');
  }
  function curParsed() { var p = parseTpl(opt().tpl); if (!p.simple) notify('warn', '现在的格式里有块以外的文字，请在「直接编辑格式文字」里改，或先恢复默认格式'); return p.simple ? p : null; }
  $('ri_builder').addEventListener('click', function (e) {
    var b = e.target.closest('[data-mv],[data-rm-i]'); if (!b || b.disabled) return;
    var p = curParsed(); if (!p) return;
    if (b.dataset.rmI != null) {
      if (p.toks.length <= 1) { notify('warn', '至少留一个块'); return; }
      p.toks.splice(+b.dataset.rmI, 1);
    } else {
      var i = +b.closest('.bd-blk').dataset.i, j = i + (+b.dataset.mv);
      var t = p.toks[i]; p.toks[i] = p.toks[j]; p.toks[j] = t;
    }
    setToks(p.toks, p.sep);
  });
  $('ri_builder').addEventListener('dragstart', function (e) { var b = e.target.closest('.bd-blk'); if (!b) return; drag = +b.dataset.i; b.classList.add('dragging'); try { e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', String(drag)); } catch (x) {} });
  $('ri_builder').addEventListener('dragend', function () { drag = null; Array.prototype.forEach.call(document.querySelectorAll('.bd-blk'), function (x) { x.classList.remove('dragging', 'over'); }); });
  $('ri_builder').addEventListener('dragover', function (e) { var b = e.target.closest('.bd-blk'); if (drag == null || !b) return; e.preventDefault(); Array.prototype.forEach.call(document.querySelectorAll('.bd-blk.over'), function (x) { if (x !== b) x.classList.remove('over'); }); b.classList.add('over'); });
  $('ri_builder').addEventListener('drop', function (e) {
    var b = e.target.closest('.bd-blk'); if (drag == null || !b) return;
    e.preventDefault();
    var p = curParsed(); if (!p) return;
    var to = +b.dataset.i, t = p.toks.splice(drag, 1)[0];
    p.toks.splice(to, 0, t);
    drag = null;
    setToks(p.toks, p.sep);
  });
  $('ri_tray').addEventListener('click', function (e) {
    var b = e.target.closest('[data-add-tok]'); if (!b) return;
    var p = curParsed(); if (!p) return;
    p.toks.push(b.dataset.addTok);
    setToks(p.toks, p.sep, '已加上「' + b.dataset.addTok + '」');
  });
  $('ri_sep').addEventListener('click', function (e) {
    var b = e.target.closest('button[data-v]'); if (!b) return;
    var p = parseTpl(opt().tpl);
    setToks(p.toks, b.dataset.v, '分隔符已改成「' + (b.dataset.v === ' ' ? '空格' : b.dataset.v) + '」');
  });

  // ---------- 设置：其余 ----------
  function paintSettings() {
    var o = opt();
    $('ri_autoExport').checked = o.autoExport;
    $('ri_renameOn').checked = o.renameOn;
    setCard.classList.toggle('rn-off', !o.renameOn);
    if (document.activeElement !== $('ri_tpl')) $('ri_tpl').value = o.tpl;
    $('ri_shortCompany').checked = o.shortCompany;
    $('ri_replaceOld').checked = o.replaceOld;
    $('ri_liepinOnlySelf').checked = o.liepinOnlySelf;
    var chips = function (arr, kind) { return arr.map(function (x) { return '<span class="ib-chip">' + esc(x) + '<button type="button" data-rm="' + kind + '" data-v="' + esc(x) + '" aria-label="删除">×</button></span>'; }).join(''); };
    $('ri_cats').innerHTML = chips(o.cats, 'cats');
    $('ri_cities').innerHTML = chips(o.cities, 'cities');
    var jds = st.jds.slice(0, 40);
    $('ri_catMap').innerHTML = jds.length ? jds.map(function (j) {
      var cur = o.catMap[j.id] || '', g = RI.guessCat(j.title, o.cats);
      return '<div class="ib-cm"><span title="' + esc(j.title) + '">' + esc(j.title) + '</span><select data-cm="' + esc(j.id) + '"><option value="">自动' + (g ? '（' + esc(g) + '）' : '（猜不出）') + '</option>' +
        o.cats.map(function (c) { return '<option' + (c === cur ? ' selected' : '') + '>' + esc(c) + '</option>'; }).join('') + '</select></div>';
    }).join('') : '<span class="ib-tip" style="margin:0;">还没有岗位</span>';
    paintBuilder();
    tplExample();
    paintWhere();
  }
  // v2.6.1 保存位置
  function paintWhere() {
    var o = opt(), r = st.S.ri || {};
    Array.prototype.forEach.call(document.querySelectorAll('input[name="ri_saveTo"]'), function (x) { x.checked = x.value === o.saveTo; });
    Array.prototype.forEach.call($('ri_where').querySelectorAll('.ib-wo'), function (x) { x.classList.toggle('on', x.dataset.to === o.saveTo); });
    $('ri_dirName').textContent = r.dirName ? r.dirName : '还没选';
    $('ri_dirName').classList.toggle('none', !r.dirName);
    var dst = $('ri_dirSt');
    if (o.saveTo !== 'folder') dst.textContent = '';
    else dst.innerHTML = st.perm === 'granted' ? '<i class="ok"></i>已授权' : st.perm === 'none' ? '<i class="bad"></i>找不到了' : st.perm ? '<i class="warn"></i>要重新授权' : '';
    $('ri_pickDir').textContent = r.dirName ? '更换…' : '选择文件夹…';
    Array.prototype.forEach.call($('ri_layout').children, function (x) { x.classList.toggle('on', x.dataset.v === o.layout); });
    $('ri_fetchTab').checked = o.fetchTab;
    paintPath();
  }
  function paintPath() {
    var o = opt(), jd = st.jds[0];
    var sample = { at: Date.now(), site: 'boss', name0: '张伟', jdTitle: jd ? jd.title : '数字IC验证工程师', online: { age: 28, years: 5, edu: '本科', city: '上海', company: '上海兆芯集成电路股份有限公司' }, pdf: {}, man: {}, file: { name: '张伟的简历.pdf' } };
    var folderBox = $('exportFolder');
    if (folderBox && document.activeElement === folderBox) o.folder = folderBox.value.trim() || 'HR人才库';
    $('pathPreview').textContent = '例如：' + fullPath(o, RI.savePath(sample, o));
  }
  function tplExample() {
    var o = opt();
    o.tpl = $('ri_tpl').value || RI.DEFAULT_TPL;
    var sample = { at: Date.now(), site: 'boss', name0: '张伟', jdTitle: '数字IC验证工程师', online: { age: 28, years: 5, edu: '本科', city: '上海', company: '上海兆芯集成电路股份有限公司' }, pdf: {}, man: {}, file: { name: '张伟的简历.pdf' } };
    var bad = RI.tokensIn(o.tpl).filter(function (k) { return !RI.TOKENS.some(function (t) { return t.k === k; }); });
    $('ri_eg').innerHTML = '<span class="eg-k">例如</span><b>' + esc(RI.fileName(sample, o)) + '</b>' + (bad.length ? '<br><span class="bad">不认识的字段：' + esc(bad.map(function (k) { return '{' + k + '}'; }).join(' ')) + '，会被当成空</span>' : '');
  }
  $('ri_autoExport').addEventListener('change', function () { saveRi({ autoExport: this.checked }, this.checked ? '自动保存到本地已开启' : '自动保存到本地已关闭，收到后只记在这里'); });
  $('ri_renameOn').addEventListener('change', function () { saveRi({ renameOn: this.checked }, this.checked ? '自定义重命名已开启' : '已关闭重命名，保留原文件名'); });
  $('ri_shortCompany').addEventListener('change', function () { saveRi({ shortCompany: this.checked }, '公司名设置已保存'); });
  $('ri_replaceOld').addEventListener('change', function () { saveRi({ replaceOld: this.checked }, '已保存'); });
  $('ri_liepinOnlySelf').addEventListener('change', function () { saveRi({ liepinOnlySelf: this.checked }, this.checked ? '猎聘只收候选人主动发的简历' : '猎聘的简历都收（主动发的和索要后发的）'); });
  $('ri_tpl').addEventListener('input', tplExample);
  $('ri_tpl').addEventListener('change', function () { var v = this.value.trim() || RI.DEFAULT_TPL; this.value = v; saveRi({ tpl: v }, '命名格式已保存'); });
  $('ri_tplReset').addEventListener('click', function () { $('ri_tpl').value = RI.DEFAULT_TPL; saveRi({ tpl: RI.DEFAULT_TPL }, '已恢复默认命名格式'); });
  function addChip(kind, inp) {
    var v = inp.value.trim(); if (!v) return;
    var arr = opt()[kind].slice(); if (arr.indexOf(v) < 0) arr.push(v);
    inp.value = '';
    var p = {}; p[kind] = arr; saveRi(p, '已添加「' + v + '」');
  }
  $('ri_catAdd').addEventListener('click', function () { addChip('cats', $('ri_catNew')); });
  $('ri_cityAdd').addEventListener('click', function () { addChip('cities', $('ri_cityNew')); });
  $('ri_catNew').addEventListener('keydown', function (e) { if (e.key === 'Enter') addChip('cats', this); });
  $('ri_cityNew').addEventListener('keydown', function (e) { if (e.key === 'Enter') addChip('cities', this); });
  setCard.addEventListener('click', function (e) {
    var b = e.target.closest('[data-rm]'); if (!b) return;
    var kind = b.dataset.rm, arr = opt()[kind].filter(function (x) { return x !== b.dataset.v; });
    if (!arr.length) { notify('warn', '至少留一个选项'); return; }
    var p = {}; p[kind] = arr; saveRi(p, '已删除「' + b.dataset.v + '」（已经选了它的简历不受影响）');
  });
  $('ri_catMap').addEventListener('change', function (e) {
    var s2 = e.target.closest('select[data-cm]'); if (!s2) return;
    var m = Object.assign({}, opt().catMap); if (s2.value) m[s2.dataset.cm] = s2.value; else delete m[s2.dataset.cm];
    saveRi({ catMap: m }, '岗位类别已保存');
  });

  // v2.6.1 保存位置
  $('ri_where').addEventListener('change', function (e) {
    if (!e.target.matches('input[name="ri_saveTo"]')) return;
    var v = e.target.value;
    if (v === 'folder' && !(st.S.ri && st.S.ri.dirName)) { paintWhere(); pickDir(); return; }
    if (v === 'folder') saveRi({ saveTo: 'folder' }, '保存位置：「' + st.S.ri.dirName + '」文件夹').then(checkPerm);
    else useDownloads();
  });
  $('ri_pickDir').addEventListener('click', function (e) { e.preventDefault(); e.stopPropagation(); pickDir(); });
  $('ri_layout').addEventListener('click', function (e) {
    var b = e.target.closest('button[data-v]'); if (!b) return;
    saveRi({ layout: b.dataset.v }, { 'day-job': '按日期和岗位分文件夹', job: '按岗位分文件夹', flat: '不分子文件夹' }[b.dataset.v]);
  });
  $('ri_fetchTab').addEventListener('change', function () { saveRi({ fetchTab: this.checked }, this.checked ? '取不到 PDF 时会临时打开预览页' : '不再临时打开预览页'); });
  $('exportFolder').addEventListener('input', paintPath);

  // ---------- 渲染 ----------
  function renderOn() {
    var on = st.S.resumeAutoSave !== false;
    $('ibOn').className = 'ib-on' + (on ? '' : ' off');
    $('ibOn').querySelector('span').textContent = on ? '收集中' : '收集已关闭';
  }
  function renderAll() {
    renderOn();
    renderOverview();
    renderFix();
    renderRecon();
    if (!onPage()) return;
    renderList();
  }
  // 后台没读完 PDF 时（老版本浏览器、后台被回收），打开本页时在这里补读
  var parsing = {};
  function parseMissing() {
    if (!window.HRSPdfText || !DBX) return;
    st.list.filter(function (r) { return r.file && r.file.hasBlob && !(r.pdf && (r.pdf.parsed || r.pdf.err)) && Date.now() - r.at > 20000 && !parsing[r.id]; }).slice(0, 5).forEach(function (r) {
      parsing[r.id] = 1;
      DBX.get(r.id).then(function (b) { return b ? HRSPdfText.fromBlob(b) : ''; }).then(function (text) {
        var p = RI.fromPdf(text || '');
        p.parsed = Date.now();
        if (p.empty) p.err = 'PDF 里没有文字（可能是扫描件），缺的项请手动补';
        return sendBg({ type: 'INBOX_PATCH', id: r.id, man: null, pdf: p });
      }).catch(function () {});
    });
  }
  function load() {
    chrome.storage.local.get(['resumeInbox', 'jds', 'inboxRecon'], function (o) {
      st.list = Array.isArray(o.resumeInbox) ? o.resumeInbox : [];
      st.jds = o.jds || [];
      st.recon = o.inboxRecon || [];
      if (!st.seen) st.seen = newest();
      HRSStore.loadSettings().then(function (s) { st.S = s || {}; paintSettings(); renderAll(); parseMissing(); checkPerm(); });
    });
  }
  chrome.storage.onChanged.addListener(function (ch, area) {
    if (area !== 'local') return;
    if (ch.resumeInbox) {
      var before = newest();
      st.list = ch.resumeInbox.newValue || [];
      var fresh = st.list.filter(function (r) { return r.at > before; });
      // 一下子到好几份时合成一条提示
      if (fresh.length === 1 && before) notify('success', '收到「' + (fresh[0].name0 || '候选人') + '」的简历' + (fresh[0].jdTitle ? '（' + fresh[0].jdTitle + '）' : ''), '简历收集');
      else if (fresh.length > 1 && before) notify('success', '收到 ' + fresh.length + ' 份新简历：' + fresh.slice(0, 3).map(function (r) { return r.name0 || '候选人'; }).join('、') + (fresh.length > 3 ? ' 等' : ''), '简历收集');
    }
    if (ch.jds) { st.jds = ch.jds.newValue || []; paintSettings(); }
    if (ch.inboxRecon) st.recon = ch.inboxRecon.newValue || [];
    if (ch.settings) { st.S = Object.assign({}, st.S, ch.settings.newValue || {}); paintSettings(); }
    if (ch.findResult && ch.findResult.newValue) {
      var fr = ch.findResult.newValue;
      if (fr.rid && fr.state !== 'going') {
        delete st.locating[fr.rid];
        st.locRes[fr.rid] = { state: fr.state, why: fr.why, at: fr.at };
        notify(fr.state === 'ok' ? 'success' : 'warn', fr.why || (fr.state === 'ok' ? '已打开对话' : '没定位到'), '定位「' + (fr.name || '') + '」');
      }
    }
    if (ch.resumeInbox || ch.jds || ch.inboxRecon || ch.settings || ch.findResult) {
      var keep = st.pop;
      renderAll();
      // 列表重画后弹出的小面板跟着这张卡片重新定位
      if (keep && keep.f !== 'more') { var a = document.querySelector('.ib-card[data-id="' + keep.id + '"] .pill[data-f="' + keep.f + '"]'); if (a && st.pop) placePop(a); }
    }
  });
  new MutationObserver(function () { if (onPage()) { renderAll(); parseMissing(); checkPerm(); } else closePop(); }).observe($('p-inbox'), { attributes: true, attributeFilter: ['class'] });
  setRange(st.range);
  load();
  window.HRSInbox = { reload: load, scrollTo: scrollToCard, paintPath: paintPath };
})();
