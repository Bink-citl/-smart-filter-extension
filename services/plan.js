/**
 * plan.js v1.3.0：今日计划（多职位同时筛选 + 每职位每日上限 + 执行时段）
 * 内容脚本、设置页、弹窗、后台共用。
 * 计数口径：正式运行中「点开并完成判定」的人数（合格、不合格、待复核都算），试运行不计入。
 * 进度存在 chrome.storage.local.planProgress = { date: 'YYYY-MM-DD'(本地日期), counts: { jdId: n } }
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.HRSPlan = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  function pad(n) { return String(n).padStart(2, '0'); }
  // 本地日期。旧版用 toISOString 取的是 UTC 日期，北京时间早上 8 点才换日。
  function localDate(d) {
    d = d || new Date();
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  }
  function norm(s) { return String(s == null ? '' : s).replace(/[\s【】[\]（）()·,，、/|:：-]+/g, '').toLowerCase(); }

  // 是否加入今日计划。旧数据没有 planEnabled 字段时，沿用旧版「当前JD」。
  function isPlanned(jd, settings) {
    if (!jd) return false;
    if (jd.planEnabled != null) return !!jd.planEnabled;
    return !!(settings && jd.id === settings.activeJdId);
  }
  /**
   * v1.9.0 上限按平台分开：jd.quota = { bossScreen, liepinScreen, bossGreet, liepinGreet }，0 或空 = 不限（默认不限）。
   * 进度按「岗位@平台」计数。不传 site 时把两个平台加起来（设置页、弹窗总览用）。
   */
  var SITES = ['boss', 'liepin'];
  function num(v) { var q = parseInt(v, 10); return isFinite(q) && q > 0 ? q : 0; }
  function quotaOf(jd, site, kind) {
    if (!jd) return 0;
    kind = kind || 'Screen';
    var q = jd.quota || {};
    if (site) {
      if (q[site + kind] != null) return num(q[site + kind]);
      return kind === 'Screen' ? num(jd.dailyQuota) : (site === 'boss' ? num(jd.greet && jd.greet.quota) : 0);
    }
    var a = quotaOf(jd, 'boss', kind), b = quotaOf(jd, 'liepin', kind);
    return a && b ? a + b : 0;   // 有一个平台不限，合计就算不限
  }
  function countsToday(progress) {
    if (!progress || progress.date !== localDate()) return {};
    return progress.counts || {};
  }
  function doneOf(jd, progress, site) {
    var c = countsToday(progress);
    if (site) return (c[jd.id + '@' + site] || 0) + (site === 'boss' ? (c[jd.id] || 0) : 0);
    var n = c[jd.id] || 0;
    SITES.forEach(function (x) { n += c[jd.id + '@' + x] || 0; });
    return n;
  }
  /**
   * v1.9.14 岗位有没有这个平台的标签：sources 里有，或者（Boss）填了推荐页职位名。
   * 没有对应平台标签的岗位，在这个平台上的智选、打招呼量都按 0 算（直接跳过）。
   */
  function onSite(jd, site) {
    if (!jd || !site) return true;
    if (site === 'boss' && jd.greetJob) return true;
    return (jd.sources || []).indexOf(site) >= 0;
  }
  // ---------- v1.9.15 同一个岗位两边平台都发：一条岗位记录，Boss 名和猎聘名可以不同 ----------
  /** 这个平台上候选人卡片 / 推荐页标签显示的职位名 */
  function nameOn(jd, site) { return site === 'liepin' ? (jd.liepinJob || jd.platformJob || jd.title) : (jd.platformJob || jd.title); }
  function namesOf(jd) { return [jd.platformJob, jd.liepinJob].filter(Boolean); }
  function grams(s) {
    var t = String(s || '').replace(/[\s\u3000\-—_*#·•、，,。.；;：:（）()【】[\]/|]+/g, '').toLowerCase().slice(0, 4000), m = {};
    for (var i = 0; i < t.length - 1; i++) { var g = t.substr(i, 2); m[g] = (m[g] || 0) + 1; }
    return { m: m, n: Math.max(0, t.length - 1) };
  }
  /** JD 原文相似度 0~1（字符二元组 Dice），排版、空行、标点不同不影响 */
  function jdSim(a, b) {
    var A = grams(a), B = grams(b);
    if (A.n < 20 || B.n < 20) return 0;
    var hit = 0;
    Object.keys(A.m).forEach(function (g) { if (B.m[g]) hit += Math.min(A.m[g], B.m[g]); });
    return 2 * hit / (A.n + B.n);
  }
  var CITY_RE = /[-－_＿（(]?\s*(北京|上海|北京|深圳|杭州|南京|无锡|成都|西安|武汉|合肥)[^)）]*[)）]?/g;
  /** 职位名是否像同一个（去掉城市后，一个包含另一个） */
  function nameLike(a, b) {
    var x = norm(String(a || '').replace(CITY_RE, '')), y = norm(String(b || '').replace(CITY_RE, ''));
    return !!x && !!y && (x === y || x.indexOf(y) >= 0 || y.indexOf(x) >= 0);
  }
  /** Boss 岗位的城市：推荐页职位名「人事主管 _ 上海」下划线后面那段 */
  function bossCity(jd) { var m = String(jd.greetJob || '').split(/[_＿]/); return m.length > 1 ? m[m.length - 1].replace(/\s+/g, '').slice(0, 4) : ''; }
  /**
   * 抓到的职位（来源 site、职位名、城市、JD 原文）对应在招岗位里的哪一条：
   * 1) 这个平台的职位名完全一样（Boss 还要推荐页职位名一样）
   * 2) 另一个平台的岗位：JD 原文相似（≥0.8）+ 职位名像 + 城市一致（Boss 分城市发的岗位按城市分开）
   */
  function matchFetched(jds, job) {
    var site = job.source, t = norm(job.title), city = String(job.city || '').replace(/\s+/g, '').slice(0, 4);
    var cityOk = function (j) {
      var bc = bossCity(j);
      if (bc) return !city || city.indexOf(bc) === 0 || bc.indexOf(city) === 0;
      return !city || !j.base || !j.base.cities || norm(j.base.cities).indexOf(norm(city)) >= 0;
    };
    var hit = null;
    if (site === 'boss' && job.greetJob) hit = (jds || []).find(function (j) { return norm(j.greetJob) === norm(job.greetJob); });
    if (!hit) hit = (jds || []).find(function (j) { return norm(nameOn(j, site)) === t && onSite(j, site) && cityOk(j); });
    if (!hit && site === 'liepin') hit = (jds || []).find(function (j) { return norm(j.liepinJob) === t && cityOk(j); });
    if (hit) return { jd: hit, how: 'name' };
    if (!job.jd) return null;
    var best = null;
    (jds || []).forEach(function (j) {
      if (onSite(j, site) && (j.sources || []).length) return;   // 这个平台已经有自己的岗位了，不合并
      if (!j.jdText || !cityOk(j) || !namesOf(j).concat([j.title]).some(function (n) { return nameLike(n, job.title); })) return;
      var s = jdSim(j.jdText, job.jd);
      if (s >= 0.8 && (!best || s > best.sim)) best = { jd: j, how: 'jd', sim: s };
    });
    return best;
  }
  /** 已有的两条岗位（一条只有 Boss 标签、一条只有猎聘标签）其实是同一个岗位：JD 相似 + 职位名像 + 城市一致 */
  function dupPairs(jds) {
    var out = [], used = {};
    var only = function (j, s) { var src = (j.sources || []).slice(); if (j.greetJob && src.indexOf('boss') < 0) src.push('boss'); return src.length === 1 && src[0] === s; };
    (jds || []).filter(function (j) { return only(j, 'liepin'); }).forEach(function (l) {
      var lc = l.base && l.base.cities ? norm(l.base.cities) : '';
      var best = null;
      (jds || []).filter(function (j) { return only(j, 'boss') && !used[j.id]; }).forEach(function (b) {
        var bc = bossCity(b);
        if (bc && lc && lc.indexOf(norm(bc)) < 0) return;
        if (!nameLike(b.platformJob || b.title, l.platformJob || l.title)) return;
        var s = jdSim(b.jdText, l.jdText);
        if (s >= 0.8 && (!best || s > best.sim)) best = { boss: b, liepin: l, sim: s };
      });
      if (best) { used[best.boss.id] = 1; out.push(best); }
    });
    return out;
  }
  /** v1.9.17 按拖拽排好的顺序（id 列表）排岗位：排过的在前，新岗位按原顺序跟在后面 */
  function sortBy(jds, order) {
    var pos = {};
    (order || []).forEach(function (id, i) { pos[id] = i; });
    return (jds || []).map(function (j, i) { return { j: j, k: pos[j.id] != null ? pos[j.id] : 100000 + i }; })
      .sort(function (a, b) { return a.k - b.k; }).map(function (x) { return x.j; });
  }
  // ---------- v2.6.0 岗位顺序：岗位列表 / 智选 / 打招呼开着「拖动排序同步」时共用一份 ----------
  function fullOrder(jds, order) { return sortBy(jds, order).map(function (j) { return j.id; }); }
  /**
   * 拖动后，显示顺序 shown 里 movedId 换了位置：把这一挪套到完整顺序 base 上，别的岗位相对位置不变。
   * 智选、打招呼表格把「开着的」排在前面，显示顺序和完整顺序不一样，所以不能直接拿显示顺序当完整顺序
   */
  function applyMove(base, shown, movedId) {
    var out = (base || []).filter(function (id) { return id !== movedId; });
    var i = (shown || []).indexOf(movedId);
    if (i < 0 || (base || []).indexOf(movedId) < 0) return (base || []).slice();
    for (var k = i + 1; k < shown.length; k++) { var p = out.indexOf(shown[k]); if (p >= 0) { out.splice(p, 0, movedId); return out; } }
    for (var k2 = i - 1; k2 >= 0; k2--) { var q = out.indexOf(shown[k2]); if (q >= 0) { out.splice(q + 1, 0, movedId); return out; } }
    out.push(movedId);
    return out;
  }
  /** 三处顺序合成一份：以岗位列表的顺序为准，没有就用打招呼的，再没有用智选的 */
  function unifiedOrder(jds, s) {
    s = s || {};
    var base = (s.jobOrder && s.jobOrder.length) ? s.jobOrder : ((s.greetOrder && s.greetOrder.length) ? s.greetOrder : s.planOrder);
    return fullOrder(jds, base);
  }
  function ordersInSync(jds, s) {
    s = s || {};
    var u = unifiedOrder(jds, s).join('|');
    return fullOrder(jds, s.jobOrder).join('|') === u && fullOrder(jds, s.planOrder).join('|') === u && fullOrder(jds, s.greetOrder).join('|') === u;
  }
  function isFull(jd, progress, site) {
    if (site && !onSite(jd, site)) return true;
    var q = quotaOf(jd, site);
    return q > 0 && doneOf(jd, progress, site) >= q;
  }
  function bump(progress, jdId, site) {
    var p = progress && progress.date === localDate() ? progress : { date: localDate(), counts: {} };
    p.counts = p.counts || {};
    var k = site ? jdId + '@' + site : jdId;
    p.counts[k] = (p.counts[k] || 0) + 1;
    return p;
  }

  function toMin(hhmm) {
    var m = String(hhmm || '').match(/^(\d{1,2}):(\d{2})$/);
    if (!m) return null;
    return parseInt(m[1], 10) * 60 + parseInt(m[2], 10);
  }
  /** 执行时段。planWindowOn=false 表示全天。跨零点（如 22:00 到 02:00）也支持。 */
  function inWindow(settings, now) {
    settings = settings || {};
    if (!settings.planWindowOn) return { ok: true, text: '全天' };
    var a = toMin(settings.planStart), b = toMin(settings.planEnd);
    var text = (settings.planStart || '?') + ' 到 ' + (settings.planEnd || '?');
    if (a == null || b == null || a === b) return { ok: true, text: '全天（时段填写有误）' };
    now = now || new Date();
    var cur = now.getHours() * 60 + now.getMinutes();
    var ok = a < b ? (cur >= a && cur < b) : (cur >= a || cur < b);
    return { ok: ok, text: text };
  }

  /**
   * 判断候选人属于哪个职位。
   * 1) 平台职位名精确包含（最可靠，和 Boss 职位下拉里的名称一致）
   * 2) 退回关键词：JD 标题、岗位定位词（由 HRSChatTarget.findHits 提供）
   * 多个命中时取命中文本最长的那个，避免「工程师」这类短词抢走。
   */
  function resolveJd(text, jds, findHits) {
    var t = norm(text);
    if (!t) return null;
    var best = null;
    (jds || []).forEach(function (jd) {
      namesOf(jd).forEach(function (nm) {   // v1.9.15 Boss 名、猎聘名都认
        var p = norm(nm);
        if (p && t.indexOf(p) >= 0 && (!best || best.how !== 'platform' || p.length > best.len)) {
          best = { jd: jd, how: 'platform', len: p.length, hits: [nm] };
        }
      });
    });
    if (best) return best;
    if (typeof findHits !== 'function') return null;
    (jds || []).forEach(function (jd) {
      var hits = findHits(text, jd) || [];
      if (!hits.length) return;
      var len = Math.max.apply(null, hits.map(function (h) { return norm(h).length; }));
      if (!best || len > best.len) best = { jd: jd, how: 'keyword', len: len, hits: hits };
    });
    return best;
  }

  /** 计划总览，供浮层、弹窗、设置页显示。 */
  function summary(jds, settings, progress, site) {
    var planned = (jds || []).filter(function (j) { return isPlanned(j, settings); });
    var done = 0, quota = 0, unlimited = false, fullCount = 0;
    if (site) planned = planned.filter(function (j) { return onSite(j, site); });
    planned.forEach(function (j) {
      var d = doneOf(j, progress, site), q = quotaOf(j, site);
      done += d;
      if (q) { quota += q; if (d >= q) fullCount++; } else unlimited = true;
    });
    return {
      planned: planned,
      done: done,
      quota: quota,
      unlimited: unlimited,
      allFull: planned.length > 0 && !unlimited && fullCount === planned.length,
      window: inWindow(settings)
    };
  }

  /**
   * v1.7.0 岗位条件 = 基础条件（城市、年龄、学历、经验、芯片行业，可复用其他职位）+ 硬性要求 + 加分项
   * kind: 'screen' 智选 / 'greet' 打招呼（打招呼可以单独一套硬性和加分，基础条件共用）
   */
  var EDU_NAME = ['', '高中', '大专', '本科', '硕士', '博士'];
  function baseOf(jd, jds) {
    if (!jd) return {};
    var b = jd.base;
    if (b && b.from) {
      var src = (jds || []).find(function (x) { return x.id === b.from && x.id !== jd.id; });
      if (src && src.base && !src.base.from) return src.base;
      if (src && src.base) return src.base;
    }
    if (!b) return { chip: !!jd.requireChip };
    return b;
  }
  function baseLines(b) {
    var out = [];
    if (b.cities && String(b.cities).trim()) out.push('城市：' + String(b.cities).trim());
    var a1 = parseInt(b.ageMin, 10), a2 = parseInt(b.ageMax, 10);
    if (isFinite(a1) && isFinite(a2)) out.push(a1 + '-' + a2 + '岁');
    else if (isFinite(a2)) out.push(a2 + '岁及以下');
    else if (isFinite(a1)) out.push(a1 + '岁以上');
    if (b.edu >= 2 && EDU_NAME[b.edu]) out.push(EDU_NAME[b.edu]);
    // v2.6.8 第一学历是大专的不要：最低学历本科及以上的岗位默认开，岗位里可以关
    if (b.noDazhuan === true || (b.noDazhuan == null && b.edu >= 3)) out.push('第一学历不要大专');
    var e = parseInt(b.exp, 10);
    if (isFinite(e) && e > 0) out.push(e + '年以上');
    return out;
  }
  function rulesOf(jd, jds, kind) {
    var b = baseOf(jd, jds);
    var g = (jd && jd.greet) || {};
    var own = kind === 'greet' && g.same === false;
    return {
      title: jd ? jd.title : '',
      hardRequirements: baseLines(b).concat(own ? (g.hard || []) : ((jd && jd.hardRequirements) || [])),
      optionalKeywords: own ? (g.bonus || []) : ((jd && jd.optionalKeywords) || []),
      requireChip: !!b.chip
    };
  }
  /**
   * v1.9.27 简历详情筛选：jd.detail = { screen, greet, passLine, veto }
   * 开了的岗位，卡片 / 会话顶部只判基础条件，关键词改看完整简历：硬性词 60 分 + 加分词 40 分，按词数平分，
   * 否决词出现或硬性词一个都没中直接不合格。
   */
  function detailOn(jd, kind) {
    var d = (jd && jd.detail) || {};
    return !!(kind === 'greet' ? d.greet : d.screen);
  }
  function detailRules(jd, jds, kind) {
    var r = rulesOf(jd, jds, kind), b = baseOf(jd, jds), bl = baseLines(b);
    var d = (jd && jd.detail) || {};
    var pl = parseInt(d.passLine, 10);
    return {
      base: { title: r.title, hardRequirements: bl, optionalKeywords: [], requireChip: r.requireChip },
      hard: r.hardRequirements.slice(bl.length),
      bonus: r.optionalKeywords,
      veto: d.veto || [],
      passLine: isFinite(pl) ? pl : 60,
      names: [jd && jd.title, jd && jd.platformJob, jd && jd.liepinJob, jd && jd.greetJob].filter(Boolean)
    };
  }
  function baseSummary(jd, jds) {
    var b = baseOf(jd, jds);
    var t = baseLines(b);
    if (b.chip) t.push('芯片行业');
    return t;
  }

  return {
    EDU_NAME: EDU_NAME,
    baseOf: baseOf,
    baseLines: baseLines,
    rulesOf: rulesOf,
    detailOn: detailOn,
    detailRules: detailRules,
    baseSummary: baseSummary,
    localDate: localDate,
    isPlanned: isPlanned,
    quotaOf: quotaOf,
    onSite: onSite,
    nameOn: nameOn,
    namesOf: namesOf,
    jdSim: jdSim,
    nameLike: nameLike,
    matchFetched: matchFetched,
    dupPairs: dupPairs,
    sortBy: sortBy,
    fullOrder: fullOrder,
    applyMove: applyMove,
    unifiedOrder: unifiedOrder,
    ordersInSync: ordersInSync,
    countsToday: countsToday,
    doneOf: doneOf,
    isFull: isFull,
    bump: bump,
    inWindow: inWindow,
    resolveJd: resolveJd,
    summary: summary,
    norm: norm
  };
});
