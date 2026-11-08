/**
 * decision-log.js v3.6.0：自动决定记录、每月汇总、决定说明、敏感条件提示
 *   个人信息保护法第 24 条：用个人信息做自动化决策，要透明、结果公平公正，个人可以要求说明、可以拒绝只由自动化作出的决定
 *   - 每判一个人记一条明细：时间、平台、模块、岗位、结论、原因、按哪几段工作判的、规则版本、试运行还是正式运行、做了什么动作
 *     明细默认保留 90 天（设置 · 合规 里可改），到期自动删
 *   - 每月汇总只有数字，不含姓名等个人信息，保留 3 年（第 56 条：影响评估报告和处理情况记录至少保存三年）
 *   - 这里只放纯函数，存取由后台做（IndexedDB 的 decisions 表 + chrome.storage 的 procStats）
 */
(function (root, factory) {
  if (typeof module !== 'undefined' && module.exports) module.exports = factory();
  else root.HRSDecisionLog = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var DEFAULT_DAYS = 90, MIN_DAYS = 30, MAX_DAYS = 1095, AGG_MONTHS = 36;
  var MODULES = { greet: '打招呼', screen: '智选', detail: '简历详情', hr: 'HR 操作' };
  var VERDICTS = { pass: '合格', reject: '不合格', review: '待复核' };
  var ACTIONS = {
    none: '没有动手', greet: '打招呼', ask: '先问一句', request: '索要简历', reject_sent: '自动拒绝',
    reject_pending: '等 HR 确认拒绝', reject_confirmed: 'HR 确认拒绝', overturn: 'HR 改为合格', manual_review: '转人工复核', explain: '生成决定说明'
  };

  function clip(x, n) { var t = String(x == null ? '' : x).replace(/\s+/g, ' ').trim(); return t.length > n ? t.slice(0, n) + '…' : t; }
  function days(v) { var n = parseInt(v, 10); if (!isFinite(n)) n = DEFAULT_DAYS; return Math.min(MAX_DAYS, Math.max(MIN_DAYS, n)); }

  /** 从判定结果里取「原因」和「按哪几段工作判的」 */
  function fromResult(res) {
    res = res || {};
    var h = res.hits || {}, rows = [];
    (h.rows || []).forEach(function (r) {
      if (!r || !r.rule) return;
      rows.push(clip(r.rule + '：' + (r.ok ? '符合' : (r.ok === false ? '不符合' : '看不出')) + (r.got ? '（' + r.got + '）' : ''), 90));
    });
    (h.relevance || []).forEach(function (R) {
      (R.rows || []).forEach(function (w) { rows.push(clip((w.dt ? w.dt + ' ' : '') + (w.text || '') + (w.why ? '：' + w.why : ''), 90)); });
    });
    return { reasons: (res.reasons || []).slice(0, 4).map(function (x) { return clip(x, 160); }), rows: rows.slice(0, 10) };
  }

  /** 整理一条明细（content 页面、后台都用） */
  function entry(o, now) {
    o = o || {};
    var fr = o.res ? fromResult(o.res) : { reasons: (o.reasons || []).slice(0, 4).map(function (x) { return clip(x, 160); }), rows: (o.rows || []).slice(0, 10).map(function (x) { return clip(x, 90); }) };
    var e = {
      ts: o.ts || now || Date.now(),
      site: o.site === 'liepin' ? 'liepin' : (o.site === 'boss' ? 'boss' : String(o.site || '')),
      module: MODULES[o.module] ? o.module : 'screen',
      jdId: o.jdId || '', job: clip(o.job, 60),
      name: clip(o.name, 30), cid: clip(o.cid, 80), cand: o.cand || '',
      verdict: VERDICTS[o.verdict] ? o.verdict : (o.res && VERDICTS[o.res.verdict] ? o.res.verdict : 'review'),
      reasons: fr.reasons, rows: fr.rows,
      engine: clip(o.engine, 40), kb: clip(o.kb, 40),
      dry: !!o.dry, action: ACTIONS[o.action] ? o.action : 'none',
      by: o.by === 'hr' ? 'hr' : 'auto', note: clip(o.note, 200)
    };
    return e;
  }

  function pad(n) { return String(n).padStart(2, '0'); }
  function monthOf(ts) { var d = new Date(ts); return d.getFullYear() + '-' + pad(d.getMonth() + 1); }
  function cutoff(now, d) { return (now || Date.now()) - days(d) * 86400000; }

  /** 每月汇总：只有数字。e 可以是一条或一批 */
  function addToAgg(agg, list) {
    agg = agg && agg.months ? agg : { months: {} };
    (Array.isArray(list) ? list : [list]).forEach(function (e) {
      if (!e) return;
      var k = monthOf(e.ts || Date.now());
      var M = agg.months[k] || (agg.months[k] = { total: 0, dry: 0, mod: {}, act: {}, hr: 0 });
      M.total++;
      if (e.dry) M.dry++;
      if (e.by === 'hr') M.hr++;
      var m = M.mod[e.module] || (M.mod[e.module] = { pass: 0, reject: 0, review: 0 });
      if (m[e.verdict] != null) m[e.verdict]++;
      M.act[e.action] = (M.act[e.action] || 0) + 1;
    });
    return agg;
  }
  /** 汇总保留最近 36 个月 */
  function pruneAgg(agg, now) {
    agg = agg && agg.months ? agg : { months: {} };
    var d = new Date(now || Date.now());
    var keep = [];
    for (var i = 0; i < AGG_MONTHS; i++) keep.push(monthOf(new Date(d.getFullYear(), d.getMonth() - i, 1).getTime()));
    Object.keys(agg.months).forEach(function (k) { if (keep.indexOf(k) < 0) delete agg.months[k]; });
    return agg;
  }
  /** 月报表（CSV 的行），从新到旧 */
  function aggRows(agg) {
    var months = (agg && agg.months) || {};
    return Object.keys(months).sort().reverse().map(function (k) {
      var M = months[k], g = M.mod.greet || {}, s = M.mod.screen || {}, dt = M.mod.detail || {}, a = M.act || {};
      return {
        month: k, total: M.total, dry: M.dry, live: M.total - M.dry,
        greetPass: g.pass || 0, greetReject: g.reject || 0, greetReview: g.review || 0,
        screenPass: (s.pass || 0) + (dt.pass || 0), screenReject: (s.reject || 0) + (dt.reject || 0), screenReview: (s.review || 0) + (dt.review || 0),
        pending: a.reject_pending || 0, confirmed: a.reject_confirmed || 0, overturn: a.overturn || 0, manual: a.manual_review || 0, autoReject: a.reject_sent || 0, explain: a.explain || 0
      };
    });
  }
  var CSV_HEAD = [['month', '月份'], ['total', '自动判定总数'], ['live', '正式运行'], ['dry', '试运行'], ['greetPass', '打招呼·合格'], ['greetReject', '打招呼·不合格'], ['greetReview', '打招呼·跳过'],
    ['screenPass', '智选·合格'], ['screenReject', '智选·不合格'], ['screenReview', '智选·待复核'], ['pending', '待 HR 确认拒绝'], ['confirmed', 'HR 确认拒绝'], ['overturn', 'HR 改为合格'],
    ['manual', '转人工复核'], ['autoReject', '未经确认自动拒绝'], ['explain', '生成决定说明']];
  function aggCsv(agg) {
    var q = function (v) { v = String(v == null ? '' : v); return /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; };
    return '﻿' + [CSV_HEAD.map(function (h) { return h[1]; }).join(',')].concat(aggRows(agg).map(function (r) {
      return CSV_HEAD.map(function (h) { return q(r[h[0]]); }).join(',');
    })).join('\n') + '\n';
  }

  function dt(ts) { var d = new Date(ts); return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) + ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes()); }
  /**
   * 决定说明：候选人问「为什么没通过」时，HR 复制给他（或留档）的文字。
   * c = 人才库记录，list = 这个人的决定明细（新到旧都行），opts.company
   */
  function explain(c, list, opts) {
    c = c || {}; opts = opts || {};
    var L = (list || []).slice().sort(function (a, b) { return a.ts - b.ts; });
    var last = L.filter(function (e) { return e.by !== 'hr'; }).slice(-1)[0];
    var hr = L.filter(function (e) { return e.by === 'hr'; });
    var lines = [];
    lines.push('关于' + (opts.company ? '「' + opts.company + '」' : '我司') + '「' + (c.jdTitle || (last && last.job) || '该岗位') + '」岗位初筛结果的说明');
    lines.push('');
    lines.push('初筛方式：招聘工具按岗位要求自动比对您在招聘平台上公开的简历信息（工作经历、学历、工作年限、期望城市等），HR 可以复核和改判。');
    if (last) {
      lines.push('自动判定时间：' + dt(last.ts) + '（' + (MODULES[last.module] || '') + '）');
      lines.push('自动判定结论：' + (VERDICTS[last.verdict] || last.verdict));
      if (last.reasons && last.reasons.length) { lines.push('主要原因：'); last.reasons.forEach(function (r) { lines.push('  - ' + r); }); }
      if (last.rows && last.rows.length) { lines.push('比对明细：'); last.rows.forEach(function (r) { lines.push('  - ' + r); }); }
    } else {
      lines.push('结论：' + (VERDICTS[c.verdict] || c.verdict || '—'));
      (c.reasons || []).slice(0, 4).forEach(function (r) { lines.push('  - ' + r); });
    }
    if (hr.length) {
      lines.push('人工处理：');
      hr.forEach(function (e) { lines.push('  - ' + dt(e.ts) + ' ' + (ACTIONS[e.action] || e.action) + (e.note ? '（' + e.note + '）' : '')); });
    }
    lines.push('');
    lines.push('如果您认为判定有误（例如平台上的信息不完整），可以回复补充材料，我们会由 HR 人工重新评估。');
    return lines.join('\n');
  }

  /**
   * 敏感条件提示：岗位条件里出现这些词时，在岗位编辑页提醒（不拦）
   *   ban：法律明确不能作为招聘条件（就业促进法第 3、27、30 条，妇女权益保障法第 43 条）
   *   care：没有明文禁止，但容易引起投诉，用作自动淘汰条件时建议 HR 确认，并写进影响评估
   */
  var SENS = [
    { k: '性别', lv: 'ban', re: /性别|男性|女性|限男|限女|仅限男|仅限女|^男$|^女$/ },
    { k: '婚育', lv: 'ban', re: /已婚|未婚|婚育|婚姻|生育|怀孕|孕期/ },
    { k: '民族', lv: 'ban', re: /民族|汉族/ },
    { k: '宗教', lv: 'ban', re: /宗教|信仰/ },
    { k: '健康', lv: 'ban', re: /乙肝|传染病|病原携带|残疾/ },
    { k: '户籍', lv: 'care', re: /户籍|户口|籍贯|本地人/ },
    { k: '年龄', lv: 'care', re: /\d+\s*岁|年龄/ },
    { k: '第一学历', lv: 'care', re: /第一学历|全日制|统招|985|211|双一流/ }
  ];
  /** lines：岗位的全部条件行（基础条件 + 硬性要求 + 打招呼单独条件） */
  function sensitive(lines) {
    var out = [];
    (lines || []).forEach(function (l) {
      var t = String(l || '').replace(/\s+/g, '');
      if (!t) return;
      SENS.forEach(function (s) {
        if (!s.re.test(t)) return;
        var o = out.filter(function (x) { return x.k === s.k; })[0];
        if (!o) out.push(o = { k: s.k, lv: s.lv, lines: [] });
        if (o.lines.indexOf(t) < 0) o.lines.push(t);
      });
    });
    return out;
  }
  /** 提示文字 */
  function sensitiveText(found) {
    if (!found || !found.length) return '';
    var ban = found.filter(function (x) { return x.lv === 'ban'; }), care = found.filter(function (x) { return x.lv === 'care'; });
    var t = [];
    if (ban.length) t.push(ban.map(function (x) { return x.k; }).join('、') + '：法律规定招聘不能以此为条件，建议删掉这一条');
    if (care.length) t.push(care.map(function (x) { return x.k; }).join('、') + '：会让插件自动淘汰人，属于容易引起投诉的条件。建议保留「不合格先给 HR 确认」，并写进个人信息影响评估');
    return t.join('。');
  }
  /** 岗位条件里明显填错的数字（例如年龄上限 16 岁，会把所有人判不合格） */
  function oddBase(b) {
    b = b || {};
    var out = [];
    var a1 = parseInt(b.ageMin, 10), a2 = parseInt(b.ageMax, 10);
    if (isFinite(a2) && a2 < 18) out.push('年龄上限 ' + a2 + ' 岁');
    if (isFinite(a1) && isFinite(a2) && a1 > a2) out.push('年龄下限 ' + a1 + ' 大于上限 ' + a2);
    var e = parseInt(b.exp, 10);
    if (isFinite(e) && e > 30) out.push('经验 ' + e + ' 年以上');
    return out;
  }

  return {
    DEFAULT_DAYS: DEFAULT_DAYS, MIN_DAYS: MIN_DAYS, MAX_DAYS: MAX_DAYS, AGG_MONTHS: AGG_MONTHS,
    MODULES: MODULES, VERDICTS: VERDICTS, ACTIONS: ACTIONS,
    days: days, fromResult: fromResult, entry: entry, monthOf: monthOf, cutoff: cutoff,
    addToAgg: addToAgg, pruneAgg: pruneAgg, aggRows: aggRows, aggCsv: aggCsv,
    explain: explain, sensitive: sensitive, sensitiveText: sensitiveText, oddBase: oddBase
  };
});
