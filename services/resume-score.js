/**
 * resume-score.js v1.9.27：简历详情打分 + AI 判断接口
 * 硬性关键词 60 分、加分关键词 40 分，各自按词数平分；
 * 一票否决：简历里出现否决词，或硬性词一个都没中，直接不合格。通过线每个岗位自己设（默认 60）。
 * AI：设置里填了接口地址就把简历和 JD 发给 AI，按 AI 的结论判（AI 出错时退回关键词打分）。
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.HRSResumeScore = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // 「编译器|LLVM、工具链」「期望职位：验证|DV」这类写法拆成一个个词
  function terms(list) {
    var out = [];
    (list || []).forEach(function (s) {
      String(s || '').replace(/^[^：:]{1,8}[：:]/, '').split(/[|｜、,，;；\n]+/).forEach(function (w0) {
        // v2.6.4「IC验证/数字IC」用 / 分开也算几个词；「C/C++」这种拆出单个字母的不拆
        var p = w0.split(/\s*[/／]\s*/);
        (p.length > 1 && p.every(function (y) { return y.trim().length >= 2; }) ? p : [w0]).forEach(function (w) {
          w = w.trim();
          if (w && out.indexOf(w) < 0) out.push(w);
        });
      });
    });
    return out;
  }
  // v3.3.0 找词和打招呼、智选用同一个办法（job-kb.js 的 kwHit）：不分大小写、全角半角、忽略空格，DV 这种短缩写要整词
  var KB = (typeof HRSJobKB !== 'undefined' && HRSJobKB) || (typeof require === 'function' ? require('./job-kb.js') : null);
  function hit(text, w) { return KB.kwHit(text, w); }

  // v1.9.38 去掉页面自带的「推荐职位 / 沟通职位」行和我们自己的职位名：
  // 猎聘简历页顶上写着「推荐职位：编译器开发工程师(LLVM)」，不去掉的话 LLVM 会算成候选人命中
  function clean(text, names) {
    var t = String(text || '').split(/\n+/).filter(function (l) {
      return !/^\s*(推荐职位|沟通职位|投递职位|应聘职位|意向职位|职位名称|当前职位|招聘职位)\s*[:：]/.test(l);
    }).join('\n');
    (names || []).forEach(function (n) {
      n = String(n || '').split(/[_＿]/)[0].trim();
      if (n.length < 2) return;
      t = t.split(n).join(' ');
      try { var nk = n.normalize('NFKC'); if (nk !== n) t = t.split(nk).join(' '); } catch (e) {}
    });
    return t;
  }
  function score(text, o) {
    o = o || {};
    text = clean(text, o.names);
    var H = terms(o.hard), B = terms(o.bonus), V = terms(o.veto);
    // v2.6.4 硬性词按职位相关性：同方向的说法都算（写「IC验证」，简历里是「DV」「UVM 验证」也算）
    var MT = typeof HRSMatcher !== 'undefined' && HRSMatcher.relTarget ? HRSMatcher : null;
    var hh = H.filter(function (w) { return hit(text, w) || (MT ? !!MT.relInText(text, MT.relTarget([w])) : false); });
    var bh = B.filter(function (w) { return hit(text, w); });
    var vh = V.filter(function (w) { return hit(text, w); });
    var hs = H.length ? 60 * hh.length / H.length : 60;
    var bs = B.length ? 40 * bh.length / B.length : 0;
    var total = Math.round(hs + bs);
    var passLine = isFinite(parseInt(o.passLine, 10)) ? parseInt(o.passLine, 10) : 60;
    var vetoWhy = vh.length ? '出现否决词：' + vh.join('、') : (H.length && !hh.length ? '硬性关键词一个都没中' : '');
    var pass = !vetoWhy && total >= passLine;
    return {
      total: total, hardScore: Math.round(hs), bonusScore: Math.round(bs), passLine: passLine,
      hard: H, hardHit: hh, bonus: B, bonusHit: bh, veto: V, vetoHit: vh, vetoWhy: vetoWhy, pass: pass,
      reason: vetoWhy ? '一票否决（' + vetoWhy + '）' : '简历详情 ' + total + ' 分（硬性 ' + Math.round(hs) + '/60，加分 ' + Math.round(bs) + '/40），通过线 ' + passLine + (pass ? '，通过' : '，没到通过线')
    };
  }

  /**
   * 合并：base = 卡片 / 会话顶部的基础条件判定结果（matcher 的格式），sc = score()，ai = AI 结论或 null
   * 返回 matcher 同格式的结果，核对卡直接显示。
   */
  function combine(base, sc, ai) {
    var r = JSON.parse(JSON.stringify(base || { verdict: 'pass', reasons: [], hits: {} }));
    r.hits = r.hits || {};
    var rows = r.hits.rows || [];
    rows.push({ rule: '详情·硬性 ' + sc.hard.join(' | '), got: sc.hard.length ? '中 ' + sc.hardHit.length + '/' + sc.hard.length + (sc.hardHit.length ? '：' + sc.hardHit.join('、') : '') + '（' + sc.hardScore + ' 分）' : '没设硬性词（60 分）', ok: !sc.hard.length || sc.hardHit.length > 0 });
    if (sc.veto.length) rows.push({ rule: '否决词 ' + sc.veto.join(' | '), got: sc.vetoHit.length ? '出现：' + sc.vetoHit.join('、') : '没出现', ok: !sc.vetoHit.length });
    rows.push({ rule: '简历详情总分', got: sc.total + ' 分 / 通过线 ' + sc.passLine, ok: sc.pass });
    if (ai) rows.push({ rule: 'AI 判断', got: (ai.pass ? '通过' : '不通过') + (ai.score != null ? ' ' + ai.score + ' 分' : '') + (ai.reason ? '：' + ai.reason : ''), ok: !!ai.pass });
    r.hits.rows = rows;
    r.hits.bonusAll = sc.bonus; r.hits.optionalHit = sc.bonusHit;
    r.score = sc.total;
    var ok = ai && !sc.vetoWhy ? !!ai.pass : sc.pass;
    var why = ai && !sc.vetoWhy ? 'AI：' + (ai.reason || (ai.pass ? '通过' : '不通过')) : sc.reason;
    if (!ok) { r.verdict = 'reject'; r.reasons = [why]; }
    else if (r.verdict === 'review') { r.reasons = [why].concat(r.reasons || []); }
    else { r.verdict = 'pass'; r.reasons = [why]; }
    return r;
  }

  // 发给 AI 的提示词（OpenAI 兼容接口）。AI 只回一段 JSON：{"pass":true/false,"score":0-100,"reason":"一句话"}
  function aiMessages(jd, text, sc) {
    return [
      { role: 'system', content: '你是招聘筛选助手。根据岗位要求判断候选人简历是否值得进入下一步沟通。只输出 JSON：{"pass":true或false,"score":0到100的整数,"reason":"不超过40字的中文理由"}，不要输出其他内容。' },
      { role: 'user', content: '【岗位】' + (jd.title || '') + '\n【硬性要求】' + sc.hard.join('、') + '\n【加分项】' + sc.bonus.join('、') + '\n【JD】\n' + String(jd.jdText || '').slice(0, 3000) + '\n\n【候选人简历】\n' + String(text || '').slice(0, 8000) }
    ];
  }
  function parseAi(content) {
    var m = String(content || '').match(/\{[\s\S]*\}/);
    if (!m) return null;
    try { var o = JSON.parse(m[0]); return { pass: !!o.pass, score: isFinite(+o.score) ? +o.score : null, reason: String(o.reason || '').slice(0, 80) }; } catch (e) { return null; }
  }

  return { clean: clean, terms: terms, hit: hit, score: score, combine: combine, aiMessages: aiMessages, parseAi: parseAi };
});
