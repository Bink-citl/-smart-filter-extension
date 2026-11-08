/**
 * engine.js v3.3.0：统一判定引擎
 *
 * 打招呼（推荐牛人卡片）、智选（沟通页会话）、报表里的简历解析、评测集重跑，都从这里进。规则只有一份：
 *   基础条件、Job relevance：matcher.js（职位方向、叫法、相近关系查岗位知识库 job-kb.js）
 *   简历详情打分：resume-score.js（硬性词同样按知识库判方向，加分词、否决词用 job-kb.js 的 kwHit）
 * 这里只做一件事：把各处读到的内容整理成同一种格式（profile），再交给 matcher。
 * 以前每个入口自己拼 profile，同一个人在打招呼和智选里可能判得不一样，评测集重跑也和线上对不齐
 *
 * 智选有两种判法：
 *   text（以前的判法）：在整份在线简历里找岗位方向的词，写在项目经历、技能里的也算
 *   unified（统一判法）：和打招呼一样，按每段工作的职位判。做过本岗位直接通过，没做过看全部工作的整体匹配度
 *   会话顶部读不到工作经历时，unified 自动退回 text
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.HRSEngine = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  var M = (typeof HRSMatcher !== 'undefined' && HRSMatcher) || (typeof require === 'function' ? require('./matcher.js') : null);

  var DATE_HEAD = /^(?:19|20)\d{2}|^-$/;
  /** 行首没有时间的（猎聘会话顶部只有「公司 · 职位」）补一个「-」，workRows 才能按「时间 公司 · 职位」拆 */
  function datedLines(lines) {
    return (lines || []).map(function (l) { var s = String(l || '').trim(); return !s || DATE_HEAD.test(s) ? s : '- ' + s; }).filter(Boolean);
  }
  function kwTextOf(W) { return W.map(function (w) { return w.kwText; }).join('\n'); }

  /**
   * 推荐牛人卡片 → profile
   * c: { site, summary, fields, rowLines（认出来的工作经历行）, cardLines（右栏原样，含教育）, workRows（可选，已经算好的）,
   *      keywordText（可选，工作经历一行都没认出来时的卡片文字）, keywordLoose }
   */
  function cardProfile(c, opt) {
    c = c || {}; opt = opt || {};
    var W = c.workRows || M.workRows(c.rowLines || [], { titleOnly: c.site === 'liepin', now: opt.now });
    var lines = c.cardLines || c.rowLines || [];
    var p = {
      text: c.summary || '', summary: c.summary || '', summaryExpected: true,
      fields: Object.assign({}, c.fields || {}), workRows: W, workLines: lines, cardLines: lines,
      keywordText: kwTextOf(W), keywordPartial: W.some(function (w) { return w.partial; })
    };
    if (!W.length && c.keywordText) { p.keywordText = c.keywordText; p.keywordLoose = c.keywordLoose !== false; }
    if (c.site === 'liepin') { p.industryText = ''; p.workLines = W.map(function (w) { return w.line; }); }   // 猎聘：公司判行业，职位判方向
    return p;
  }

  /**
   * 沟通页会话 → profile
   * c: { site, text（会话里的完整在线简历）, summary（顶部摘要）, fields, summaryExpected, workLines（顶部的工作经历行） }
   * opt.mode：'text' 以前的判法 | 'unified' 和打招呼一样按每段工作判
   * 返回 { profile, mode }：mode 是实际用的判法（unified 读不到工作经历时退回 text）
   */
  function chatProfile(c, opt) {
    c = c || {}; opt = opt || {};
    var p = { text: c.text || '', summary: c.summary || '', fields: c.fields || {}, summaryExpected: !!c.summaryExpected, workLines: c.workLines || [] };
    if (opt.mode !== 'unified') return { profile: p, mode: 'text' };
    var lines = datedLines(c.workLines);
    var W = M.workRows(lines, { titleOnly: c.site === 'liepin', now: opt.now });
    if (!W.some(function (w) { return w.title; })) return { profile: p, mode: 'text' };
    p.workRows = W; p.cardLines = lines;
    p.keywordText = kwTextOf(W); p.keywordPartial = W.some(function (w) { return w.partial; });
    return { profile: p, mode: 'unified' };
  }

  function matchOpt(opt, withJob) {
    opt = opt || {};
    return { now: opt.now, jobTitle: withJob ? opt.jobTitle : undefined, industry: opt.industry || (typeof HRSIndustry !== 'undefined' ? HRSIndustry : null), chipWords: opt.chipWords, chipExclude: opt.chipExclude };
  }

  /** 判一张卡片。rules：{ hardRequirements, optionalKeywords, requireChip }。返回 matcher 的结果 */
  function judgeCard(c, rules, opt) { return M.match(cardProfile(c, opt), rules || {}, matchOpt(opt, true)); }

  /**
   * 判一个会话。opt.mode 决定用哪种判法，opt.both 为 true 时两种都算（评测集对比用）
   * 返回 { res, mode, text?, unified? }：res 是 opt.mode 那种判法的结果
   */
  function judgeChat(c, rules, opt) {
    opt = opt || {};
    var want = opt.mode === 'unified' ? 'unified' : 'text';
    var out = {};
    ['text', 'unified'].forEach(function (m) {
      if (m !== want && !opt.both) return;
      var cp = chatProfile(c, { mode: m, now: opt.now });
      out[m] = M.match(cp.profile, rules || {}, matchOpt(opt, cp.mode === 'unified'));
      out[m].engineMode = cp.mode;
    });
    return { res: out[want], mode: out[want].engineMode, text: out.text, unified: out.unified };
  }

  /** 一段完整简历（报表里上传的 PDF / Word）：没有按行的工作经历，按全文判 */
  function judgeText(text, fields, rules, opt) { return M.match({ text: text || '', fields: fields || {} }, rules || {}, matchOpt(opt, false)); }

  return { cardProfile: cardProfile, chatProfile: chatProfile, judgeCard: judgeCard, judgeChat: judgeChat, judgeText: judgeText, datedLines: datedLines };
});
