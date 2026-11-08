/**
 * eval.js v3.2.0：评测集（打招呼卡片判定对不对，用数字说话）
 *
 * 样本：打招呼每判一张卡片，后台存一份判定的输入和当时的结果（去掉姓名、电话、邮箱）
 * 打标：HR 在「设置 → 评测集」里给每张卡片标「打 / 不打 / 拿不准」，作为标准答案
 * 指标（只算标了「打」「不打」的）：
 *   漏打率 = 标了「打」、插件没打（判为跳过或不打）的比例
 *   误打率 = 标了「不打」、插件打了的比例
 *   一致率 = 插件和标注一致的比例
 * 换了判定规则或知识库以后，用同一批样本重跑一遍（rerun），两个率都不变差才算改好
 * v3.3.0 智选的会话也存样本（kind: 'chat'），标「合格 / 不合格」。重跑时以前的判法和统一判法各算一遍，
 *        在评测集页面并排看，统一判法不比以前差再切换
 *
 * 工作台页面、Node 命令（npm run eval）共用。没有 DOM 依赖
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.HRSEval = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  var LABELS = { yes: '打招呼', no: '不打', unsure: '拿不准' };
  // v3.4.0 同一个在招岗位标够这么多张（标了「打」「不打」的，拿不准不算），这个岗位的两个率才稳定，可以拿来参考
  var STABLE_N = 111;
  var LABELS_CHAT = { yes: '合格', no: '不合格', unsure: '拿不准' };
  function labelOf(s, l) { return (s && s.kind === 'chat' ? LABELS_CHAT : LABELS)[l] || ''; }
  var EN = (typeof HRSEngine !== 'undefined' && HRSEngine) || (typeof require === 'function' ? require('./engine.js') : null);

  function brief(r) {
    if (!r) return null;
    var R = r.hits && r.hits.relevance && r.hits.relevance[0];
    return { verdict: r.verdict, reason: (r.reasons || [])[0] || '', score: R ? R.score : null, mode: r.engineMode };
  }
  /**
   * 用当前版本的判定规则重跑一张样本，返回 { verdict, reason, score }
   * 智选的样本另外带 text（以前的判法）、unified（统一判法）两个结论，verdict 是 opts.chatMode 那种（默认以前的判法）
   * M 参数留着兼容以前的调用，判定统一走 engine.js
   */
  function rerun(s, M, opts) {
    opts = opts || {};
    var c = s.card || {};
    var now = s.at ? new Date(s.at) : new Date();
    var o = { now: now, jobTitle: s.jobTitle, industry: opts.industry, chipWords: opts.chipWords, chipExclude: opts.chipExclude };
    if (s.kind === 'chat') {
      var J = EN.judgeChat({ site: s.site, text: c.text, summary: c.summary, fields: c.fields, summaryExpected: c.summaryExpected, workLines: c.workLines },
        s.rules || {}, Object.assign(o, { mode: opts.chatMode, both: true }));
      return Object.assign(brief(J.res), { text: brief(J.text), unified: brief(J.unified) });
    }
    return brief(EN.judgeCard({ site: s.site, summary: c.summary, fields: c.fields, rowLines: c.rowLines || [], cardLines: c.cardLines || [],
      keywordText: c.keywordLoose ? c.keywordText : '', keywordLoose: !!c.keywordLoose }, s.rules || {}, o));
  }

  /** 插件会不会打招呼：只有 pass 会打，review（跳过）和 reject 都不打 */
  function greets(verdict) { return verdict === 'pass'; }

  /**
   * 指标。verdictOf(sample) 返回要评的判定（默认用采集时的判定）
   * 返回 { total, labeled, yes, no, unsure, miss, falsePos, agree, missRate, falseRate, agreeRate, missList, falseList }
   */
  function metrics(samples, verdictOf) {
    verdictOf = verdictOf || function (s) { return s.verdict; };
    var m = { total: samples.length, labeled: 0, yes: 0, no: 0, unsure: 0, miss: 0, falsePos: 0, agree: 0, missList: [], falseList: [] };
    samples.forEach(function (s) {
      if (!s.label) return;
      m.labeled++;
      if (s.label === 'unsure') { m.unsure++; return; }
      var g = greets(verdictOf(s));
      if (s.label === 'yes') { m.yes++; if (g) m.agree++; else { m.miss++; m.missList.push(s); } }
      if (s.label === 'no') { m.no++; if (!g) m.agree++; else { m.falsePos++; m.falseList.push(s); } }
    });
    var pct = function (a, b) { return b ? Math.round(a / b * 1000) / 10 : null; };
    m.missRate = pct(m.miss, m.yes); m.falseRate = pct(m.falsePos, m.no); m.agreeRate = pct(m.agree, m.yes + m.no);
    return m;
  }

  /**
   * 每个岗位打标的进度：返回 [{ job, n, ok }]，n = 标了打 / 不打的张数，ok = 够 STABLE_N 张
   * 两个率要按同一个岗位看：不同岗位的标准不一样，混在一起算出来的比例没法参考
   */
  function progress(samples) {
    var g = {};
    samples.forEach(function (s) {
      var k = s.jobTitle || '未知岗位';
      g[k] = g[k] || 0;
      if (s.label === 'yes' || s.label === 'no') g[k]++;
    });
    return Object.keys(g).sort().map(function (k) { return { job: k, n: g[k], ok: g[k] >= STABLE_N }; });
  }

  /** 按岗位分组的指标 */
  function byJob(samples, verdictOf) {
    var g = {};
    samples.forEach(function (s) { (g[s.jobTitle || '未知岗位'] = g[s.jobTitle || '未知岗位'] || []).push(s); });
    return Object.keys(g).sort().map(function (k) { return { job: k, m: metrics(g[k], verdictOf) }; });
  }

  /**
   * 和基线比：两个率都不变差才算通过。没有基线时只报数
   * 返回 { ok, lines: [说明] }
   */
  function compare(cur, base) {
    if (!base) return { ok: true, lines: ['没有基线，本次结果可以存为基线'] };
    var lines = [], ok = true;
    [['missRate', '漏打率'], ['falseRate', '误打率']].forEach(function (k) {
      var a = cur[k[0]], b = base[k[0]];
      if (a == null || b == null) { lines.push(k[1] + '：样本不够，没法比'); return; }
      if (a > b) { ok = false; lines.push(k[1] + ' 变差：' + b + '% → ' + a + '%'); } else lines.push(k[1] + ' ' + b + '% → ' + a + '%' + (a < b ? '（变好）' : '（不变）'));
    });
    return { ok: ok, lines: lines };
  }

  /**
   * 知识库建议：标了「打」、插件没打的样本里，职位在知识库里认不出方向的，列出来建议加到招聘岗位的方向里
   * verdictOf(s)：用哪个结论算「没打」，默认采集时的结论（智选样本用统一判法的结论）
   * 返回 [{ title, fam, famName, count, jobs }]
   */
  function kbSuggestions(samples, M, KB, verdictOf) {
    var out = {};
    // 智选的样本看统一判法的结论：以前的判法在全文里找词，认不认得职位名都会通过
    verdictOf = verdictOf || function (s) { return s.kind === 'chat' && s.verdicts && s.verdicts.unified ? s.verdicts.unified.verdict : s.verdict; };
    samples.forEach(function (s) {
      if (s.label !== 'yes' || greets(verdictOf(s))) return;
      var core = M.coreTitle(s.jobTitle);
      var fam = core ? KB.famsOf(core)[0] : null;
      if (!fam) return;
      var lines = s.kind === 'chat' ? EN.datedLines((s.card || {}).workLines) : (s.card || {}).rowLines || [];
      var W = M.workRows(lines, { titleOnly: s.site === 'liepin', now: s.at ? new Date(s.at) : new Date() });
      W.forEach(function (w) {
        var t = String(w.title || '').replace(/(…|\.\.\.)$/, '').trim();
        if (t.length < 2 || KB.famsOf(t).length) return;
        var k = fam + '|' + t;
        var x = out[k] = out[k] || { title: t, fam: fam, famName: KB.name(fam), count: 0, jobs: [] };
        x.count++;
        if (x.jobs.indexOf(s.jobTitle) < 0) x.jobs.push(s.jobTitle);
      });
    });
    return Object.keys(out).map(function (k) { return out[k]; }).sort(function (a, b) { return b.count - a.count; });
  }

  /**
   * v3.6.0 导入同事导出的评测集，和本机的合并（几个人分工打标，最后合成一份）
   * 同一张样本（id 一样）两边标得不一样：先保留本机的，列进 conflicts，由人决定用哪个
   * 返回 { list, added, same, conflicts: [{ id, jobTitle, local, incoming, localNote, incomingNote }] }
   */
  function importSet(local, data) {
    var inc = (data && Array.isArray(data.samples)) ? data.samples : (Array.isArray(data) ? data : null);
    if (!inc) throw new Error('这不是 Smart Filter 导出的评测集');
    var list = (local || []).slice(), byId = {}, out = { list: list, added: 0, same: 0, labeled: 0, conflicts: [] };
    list.forEach(function (s) { byId[s.id] = s; });
    inc.forEach(function (s) {
      if (!s || !s.id || !s.card) return;
      var x = byId[s.id];
      if (!x) { var n = Object.assign({}, s, { importedAt: Date.now() }); list.push(n); byId[s.id] = n; out.added++; return; }
      if (!s.label || x.label === s.label) { out.same++; return; }
      if (!x.label) { x.label = s.label; x.note = s.note || x.note || ''; x.labeledAt = Date.now(); out.labeled++; return; }
      out.conflicts.push({ id: s.id, jobTitle: s.jobTitle || x.jobTitle, kind: x.kind || 'card', local: x.label, incoming: s.label, localNote: x.note || '', incomingNote: s.note || '' });
    });
    return out;
  }
  /** v3.6.0 盲测复核：从标过的样本里随机挑 n 张（不看之前的标注再标一遍，看两次一不一致）。seed 固定时结果固定 */
  function blindPick(samples, n, seed) {
    var pool = samples.filter(function (s) { return s.label === 'yes' || s.label === 'no'; });
    var x = (seed == null ? Date.now() : seed) % 2147483647 || 1;
    var rnd = function () { x = x * 16807 % 2147483647; return (x - 1) / 2147483646; };
    for (var i = pool.length - 1; i > 0; i--) { var j = Math.floor(rnd() * (i + 1)); var t = pool[i]; pool[i] = pool[j]; pool[j] = t; }
    return pool.slice(0, n || 20).map(function (s) { return s.id; });
  }
  /** 复核一致率：两次都标了打 / 不打的里，标得一样的比例。目标 ≥ 80%，太低说明打标标准不统一，先对齐标准再看两个率 */
  var AGREE_TARGET = 80;
  function agreement(samples) {
    var n = 0, same = 0, diff = [];
    samples.forEach(function (s) {
      if (!(s.label === 'yes' || s.label === 'no') || !(s.label2 === 'yes' || s.label2 === 'no')) return;
      n++;
      if (s.label === s.label2) same++; else diff.push(s);
    });
    var rate = n ? Math.round(same / n * 1000) / 10 : null;
    return { n: n, same: same, rate: rate, ok: rate != null && rate >= AGREE_TARGET, diff: diff };
  }
  /**
   * v3.6.0 分岗位和基线比（npm run eval 用）：只有标够 STABLE_N 张的岗位才卡（不够的只报数，不算失败）
   * base：{ 岗位名: { missRate, falseRate, yes, no } }
   */
  function compareJobs(samples, verdictOf, base) {
    var out = { ok: true, jobs: [] };
    byJob(samples, verdictOf).forEach(function (j) {
      var n = j.m.yes + j.m.no, stable = n >= STABLE_N;
      var c = stable ? compare(j.m, base && base[j.job]) : { ok: true, lines: ['标了 ' + n + ' 张，不到 ' + STABLE_N + ' 张，只报数不卡'] };
      if (!c.ok) out.ok = false;
      out.jobs.push({ job: j.job, n: n, stable: stable, m: j.m, ok: c.ok, lines: c.lines });
    });
    return out;
  }
  function jobBaseline(samples, verdictOf) {
    var o = {};
    byJob(samples, verdictOf).forEach(function (j) { if (j.m.yes + j.m.no >= STABLE_N) o[j.job] = { missRate: j.m.missRate, falseRate: j.m.falseRate, yes: j.m.yes, no: j.m.no }; });
    return o;
  }

  /** 导出：只留判定要用的内容，再去一遍电话、邮箱 */
  function exportSet(samples, guides) {
    var clean = function (x) {
      return JSON.parse(JSON.stringify(x).replace(/1[3-9]\d{9}/g, '<电话>').replace(/[\w.+-]+@[\w-]+\.[\w.]+/g, '<邮箱>')
        .replace(/(微信|wechat|vx)\s*[:：号]?\s*[A-Za-z][\w-]{5,19}/gi, '$1<微信>').replace(/\d{17}[\dXx]/g, '<证件号>'));
    };
    return { format: 'smart-filter-eval', version: 1, exportedAt: new Date().toISOString(), guides: guides || {},
      samples: samples.filter(function (s) { return s.label; }).map(function (s) {
        return clean({ id: s.id, kind: s.kind || 'card', site: s.site, at: s.at, jobTitle: s.jobTitle, detail: s.detail, rules: s.rules, card: s.card, verdict: s.verdict, reason: s.reason, engine: s.engine, verdicts: s.verdicts, label: s.label, note: s.note || '', label2: s.label2 || undefined });
      }) };
  }

  return { importSet: importSet, blindPick: blindPick, agreement: agreement, AGREE_TARGET: AGREE_TARGET, compareJobs: compareJobs, jobBaseline: jobBaseline, STABLE_N: STABLE_N, progress: progress, LABELS: LABELS, LABELS_CHAT: LABELS_CHAT, labelOf: labelOf, rerun: rerun, greets: greets, metrics: metrics, byJob: byJob, compare: compare, kbSuggestions: kbSuggestions, exportSet: exportSet };
});
