/**
 * HRSMatcher v1.4.0：简化判定
 * 岗位只有两类条件：
 *   硬性要求（必须全部满足）：每行一条。一行里用 | 或「或」隔开表示命中任意一个即可，如「半导体|芯片|集成电路」
 *     特殊写法：学历词（大专 / 本科 / 硕士 / 博士）按「最低学历」判断，「5年以上」按「最低经验」判断
 *   加分项（不必满足）：每行一条，命中越多排序越靠前，不影响合格与否
 * 结论：硬性全满足 = 合格(pass)，有一条不满足 = 不合格(reject)，
 *       学历 / 经验读不到、或没读到简历摘要 = 待复核(review)，不自动拒绝
 */
(function (root, factory) {
  if (typeof module !== 'undefined' && module.exports) module.exports = factory();
  else root.HRSMatcher = factory();
})(this, function () {
  'use strict';

  var EDU_LEVEL = { 初中: 1, 高中: 1, 中专: 2, 中技: 2, 职高: 2, 大专: 2, 专科: 2, 本科: 3, 学士: 3, 硕士: 4, 研究生: 4, 博士: 5, 博士后: 5 };
  var EDU_TEXT = { 1: '高中', 2: '大专', 3: '本科', 4: '硕士', 5: '博士' };

  function norm(s) { return String(s == null ? '' : s).replace(/\s+/g, '').toLowerCase(); }

  /** 兼容旧接口：返回 { hit, miss } */
  function findKeywords(text, keywords) {
    var t = norm(text), hit = [], miss = [];
    (keywords || []).forEach(function (kw) {
      var k = norm(kw);
      if (!k) return;
      if (t.indexOf(k) >= 0) hit.push(kw); else miss.push(kw);
    });
    return { hit: hit, miss: miss };
  }


  // ================= Job relevance（职位相关性） =================
  // v2.9.1 方向、叫法、相近关系都放到岗位知识库 services/job-kb.js（所有岗位通用，芯片方向沿用 v2.6.9 收窄后的相近关系）
  // 这里先在知识库里检索候选人每段工作的职位属于哪些方向，再和招聘岗位比
  var KB = (typeof HRSJobKB !== 'undefined' && HRSJobKB) || (typeof self !== 'undefined' && self.HRSJobKB) ||
    (typeof require === 'function' ? require('./job-kb.js') : null);
  function relNorm(x) { var t = String(x == null ? '' : x); try { t = t.normalize('NFKC'); } catch (e) {} return t.toLowerCase().replace(/\s+/g, ' ').trim(); }
  // v2.6.9 太泛的词单独出现不算（「数字」「芯片」「设计」…能命中几乎所有职位）
  var GENERIC_RE = /^(数字|模拟|芯片|ic|集成电路|半导体|设计|开发|工程师|研发|技术|电子)$/i;
  function isGeneric(w) { return GENERIC_RE.test(relNorm(w).replace(/\s+/g, '')); }
  // 认不出方向的原词：和以前一样，去掉空格后包含就算
  function litHit(t, w) { var k = relNorm(w).replace(/\s+/g, '').replace(/(…|\.\.\.)$/, ''); return !!k && String(t).replace(/\s+/g, '').indexOf(k) >= 0; }
  /** 一段文字（职位名 / 岗位要求里的一个词）属于哪些方向（知识库检索） */
  function famsOf(text) { return KB.famsOf(text); }
  /** 岗位要求的几个词 → { fams:[方向], spec:[具体方向，用来算相近], lit:[认不出方向的词，按原词找] } */
  function relTarget(alts) {
    var fams = [], spec = [], lit = [];
    (alts || []).forEach(function (a) {
      var f = famsOf(a), u = f.length ? [] : KB.umbOf(a);   // v2.6.9「数字IC验证」是具体方向，不再按「数字IC」大方向展开
      if (!u.length && !f.length) { if (!isGeneric(a)) lit.push(a); return; }
      f.forEach(function (k) { if (fams.indexOf(k) < 0) fams.push(k); if (spec.indexOf(k) < 0) spec.push(k); });
      u.forEach(function (k) { if (fams.indexOf(k) < 0) fams.push(k); });
    });
    return { fams: fams, spec: spec, lit: lit, alts: (alts || []).slice() };
  }
  /**
   * 一段工作和岗位要求相不相关。title：职位名；full：公司 + 职位（认不出方向的原词在这里找）
   * 返回 { level: 'direct'|'near'|'', pct, why, same }。same：就是正在招的这个岗位
   */
  function relOfRow(title, full, tg) {
    var tl = relNorm(title), fl = relNorm(full);
    // 做过的就是正在招的这个岗位（名字一致、向量相似度高、或同一个具体方向）：直接相关
    if (tg.job && tl) {
      if (litHit(tl, tg.job)) return { level: 'direct', pct: 100, same: true, why: '做过正在招的「' + tg.job + '」' };
      var sp = KB.samePosition(title, tg.job);
      if (sp.same) return { level: 'direct', pct: 100, same: true, why: '和正在招的「' + tg.job + '」是同一个岗位（' + sp.why + '）' };
    }
    // 职位里直接有 Job relevance 写的词（例如写「IC验证」，职位是「数字IC验证工程师」）：直接相关
    var same = (tg.alts || []).filter(function (a) { return relNorm(a).replace(/\s+/g, '').length >= 2 && !isGeneric(a) && litHit(tl, a); });
    var cf = famsOf(title);
    var spec = cf.filter(function (k) { return tg.spec.indexOf(k) >= 0; });
    if (same.length) return { level: 'direct', pct: 100, same: !tg.job && spec.length > 0, why: '职位里有「' + same[0] + '」' };
    var d = cf.filter(function (k) { return tg.fams.indexOf(k) >= 0; });
    if (d.length) return { level: 'direct', pct: 100, same: !tg.job && spec.length > 0, why: KB.name(d[0]) };
    var lit = tg.lit.filter(function (w) { return litHit(fl, w); });
    if (lit.length) return { level: 'direct', pct: 100, why: '有「' + lit[0] + '」' };
    // 相近方向：知识库里两个方向的相近程度（≥ 0.5 才算），匹配度按相近程度给
    var best = null;
    cf.forEach(function (x) {
      tg.spec.forEach(function (y) { var w = KB.nearW(x, y); if (w >= 0.5 && (!best || w > best.w)) best = { w: w, x: x, y: y }; });
    });
    if (best) return { level: 'near', pct: Math.round(best.w * 100), why: KB.name(best.x) + '，和' + KB.name(best.y) + '相近' };
    return { level: '', pct: 0, why: cf.length ? cf.map(KB.name).join('、') : '' };
  }
  /** 整段文字（会话里的完整简历）有没有要求方向的词：同方向的叫法都算 */
  function relInText(text, tg) {
    var t = relNorm(text);
    var same = (tg.alts || []).filter(function (a) { return relNorm(a).replace(/\s+/g, '').length >= 2 && !isGeneric(a) && litHit(t, a); });
    if (same.length) return same[0];
    var lit = tg.lit.filter(function (w) { return litHit(t, w); });
    if (lit.length) return lit[0];
    for (var i = 0; i < tg.fams.length; i++) {
      var f = KB.KB.filter(function (x) { return x.id === tg.fams[i]; })[0];
      var w = f && f.kw.filter(function (x) { return x.length >= 2 && KB.hasWord(t, x); })[0];
      if (w) return w;
    }
    return '';
  }
  // ---------- v3.5.0 岗位一一对应（打招呼卡片） ----------
  // 「IC / 芯片设计」「软件开发」是大方向：有更具体的（数字设计、嵌入式…）时不拿它比；只写了它的职位看不出是哪一种
  // 「软件开发」也是大方向：招嵌入式软件时，只写了「软件开发」「Java开发」的不算对上
  var UMBRELLA = { icgen: ['de', 'analog', 'ams', 'arch', 'icgen'], sw: ['emb', 'compiler', 'algo', 'sw'] };
  function specOf(fams) { var x = fams.filter(function (k) { return !UMBRELLA[k]; }); return x.length ? x : fams.slice(); }
  /**
   * 正在招的岗位对应哪些具体方向：岗位名在知识库里检索 + Job relevance 里写的方向
   * 返回 { fams, names, open }：open = 招的就是大方向（例如「IC设计工程师」），下面几个具体方向都算
   */
  function positionTarget(jc, tg, raw) {
    var f = jc ? famsOf(jc) : [];
    if (!f.length && raw) f = famsOf(String(raw).split(/[_＿]/)[0]);   // 「实习生（人事行政）」：核心部分认不出时看括号里的
    (tg.spec || []).forEach(function (k) { if (f.indexOf(k) < 0) f.push(k); });
    var sp = specOf(f), open = sp.length === 1 && UMBRELLA[sp[0]] ? UMBRELLA[sp[0]] : null;
    return { fams: open || sp, names: sp.map(KB.name), open: !!open };
  }
  /**
   * 一段工作和正在招的岗位对不对得上。返回 { ok, level, why }
   *   level：same 就是这个岗位 / direct 同一个具体方向 / other 不是这个岗位 / ambiguous 看不出具体方向 / unknown 职位看不全
   */
  function rowMatch(title, full, T, tg, partial) {
    var tl = relNorm(title);
    if (!tl) return { ok: false, level: 'unknown', why: '职位看不全' };
    var rf = famsOf(title), rs = specOf(rf);
    var inT = rs.filter(function (k) { return T.fams.indexOf(k) >= 0; });
    // 职位里还混着别的方向：和招聘方向相近（数字设计验证）可以，不相近的说明主要不是这个岗位（FPGA验证、芯片测试验证）
    var extra = rs.filter(function (k) { return T.fams.indexOf(k) < 0; });
    var clash = extra.filter(function (k) { return !T.fams.some(function (t) { return KB.nearW(k, t) >= 0.5; }); });
    var nm = function (ks) { return ks.map(KB.name).join('、'); };
    if (T.fams.length) {
      if (inT.length && !clash.length) {
        var same = tg.job && (litHit(tl, tg.job) || KB.samePosition(title, tg.job).same);
        return { ok: true, level: same ? 'same' : 'direct', why: nm(inT) };
      }
      if (inT.length) return { ok: false, level: 'other', why: '主要是' + nm(clash) + '，不是' + nm(inT) };
      if (!rs.length && partial) return { ok: false, level: 'unknown', why: '职位看不全' };
      // 只写了大方向（「IC设计工程师」），招的又正好是它下面的一种（数字设计、模拟设计）：看不出是哪一种，跳过
      var umb = rs.length === 1 && UMBRELLA[rs[0]] ? UMBRELLA[rs[0]] : null;
      if (umb && !T.open && T.fams.some(function (k) { return umb.indexOf(k) >= 0; })) return { ok: false, level: 'ambiguous', why: '只写了「' + nm(rs) + '」，看不出是不是' + T.names.join(' / ') };
      return { ok: false, level: 'other', why: rs.length ? nm(rs) : (partial ? '职位看不全' : '知识库里认不出这个职位') };
    }
    // 招聘岗位在知识库里认不出方向：按岗位名、Job relevance 写的词原样找
    if (tg.job && (litHit(tl, tg.job) || KB.samePosition(title, tg.job).same)) return { ok: true, level: 'same', why: '职位名一致' };
    var lit = (tg.alts || []).concat(tg.lit || []).filter(function (a) { return relNorm(a).replace(/\s+/g, '').length >= 2 && !isGeneric(a) && litHit(relNorm(full), a); });
    if (lit.length) return { ok: true, level: 'direct', why: '有「' + lit[0] + '」' };
    return { ok: false, level: partial ? 'unknown' : 'other', why: partial ? '职位看不全' : (rs.length ? nm(rs) : '') };
  }
  /** 招聘岗位名的核心部分：「资深 IC 验证工程师 / 专家-苏州」→「IC验证工程师」，「ic验证工程师 _ 苏州 25-35K」→「ic验证工程师」 */
  function coreTitle(t) {
    var x = String(t || '').split(/[_＿]/)[0].split(/[/／]/)[0];
    x = x.replace(/[-－—–]\s*[\u4e00-\u9fa5]{2,3}\s*$/, '').replace(/[（(][^)）]*[)）]/g, '');
    x = x.replace(/资深|高级|中级|初级|首席|senior|junior|staff|principal|专家/gi, '').replace(/\s+/g, '');
    return x.length >= 3 ? x : '';
  }
  /** 「IC验证/数字IC」「验证|DV」「A、B」拆成几个词。「C/C++」「I/O」这种拆出来有单个字母的不按 / 拆 */
  function splitAlts(raw) {
    var a = String(raw || '').split(/\s*(?:\||｜|或|、|，|,)\s*/);
    var out = [];
    a.forEach(function (x) {
      var p = x.split(/\s*[/／]\s*/);
      if (p.length > 1 && p.every(function (y) { return y.trim().length >= 2; })) out = out.concat(p); else out.push(x);
    });
    return out.map(function (x) { return x.trim(); }).filter(Boolean);
  }

  /** 一行硬性要求 → { kind: 'edu'|'exp'|'kw', ... } */
  function parseRule(line) {
    var raw = String(line || '').trim();
    var s = raw.replace(/\s+/g, '');
    // v1.6.0 城市 / 期望职位：「城市：北京|上海」「期望职位：验证|DV」
    var pm = s.match(/^(城市|地点|期望城市|工作地点|职位|期望职位|岗位|期望岗位)[:：](.+)$/);
    if (pm) {
      var kind = /城市|地点/.test(pm[1]) ? 'city' : 'job';
      return { kind: kind, alts: splitAlts(pm[2]), text: raw };
    }
    if (/^第一学历(不要|不能是|非|不接受|不可以是)(大专|专科)$/.test(s)) return { kind: 'firstEdu', text: raw };
    var e = s.replace(/(及以上|以上|学历|统招|全日制)/g, '');
    if (EDU_LEVEL[e] && EDU_LEVEL[e] >= 2) return { kind: 'edu', min: EDU_LEVEL[e], text: raw };
    // v1.5.3 年龄：37岁以下 / 37岁及以下 / 25岁以上 / 25-37岁
    var ag = s.match(/^(?:年龄)?(\d{2})(?:周)?岁(及以下|以下|以内|及以上|以上)$/);
    if (ag) {
      var n = parseInt(ag[1], 10);
      return /上/.test(ag[2]) ? { kind: 'age', min: n, max: null, text: raw } : { kind: 'age', min: null, max: n, text: raw };
    }
    var ar = s.match(/^(?:年龄)?(\d{2})(?:岁)?[-~～至到](\d{2})(?:周)?岁$/);
    if (ar) return { kind: 'age', min: parseInt(ar[1], 10), max: parseInt(ar[2], 10), text: raw };
    var m = s.match(/^(?:工作)?(?:经验)?(\d{1,2})年(?:及)?(?:以上)?(?:工作)?(?:经验)?$/);
    if (m) return { kind: 'exp', min: parseInt(m[1], 10), text: raw };
    var alts = splitAlts(raw.replace(/^(职位相关性|职位相关|job ?relevance|相关方向|工作方向)[:：]/i, ''));
    return { kind: 'kw', alts: alts, text: raw };
  }

  // 学历：优先看顶部摘要（Boss 头部「50岁 | 10年以上 | 本科」就是最高学历），再看全文里最高的那个
  function eduOf(summary, text, fields) {
    var re = /(博士后|博士|硕士|研究生|本科|学士|大专|专科)/g;
    var best = 0, m;
    var src = summary || '';
    while ((m = re.exec(src)) !== null) best = Math.max(best, EDU_LEVEL[m[1]] || 0);
    if (best) return best;
    if (fields && fields.eduLevel) return fields.eduLevel;
    re.lastIndex = 0; src = text || '';
    while ((m = re.exec(src)) !== null) best = Math.max(best, EDU_LEVEL[m[1]] || 0);
    return best || null;
  }
  // 经验：Boss 头部写法「10年以上」「3年」「1年以内」「应届生」
  function expOf(summary, text, fields) {
    // v2.6.8 卡片左栏「29岁 | 4年 | 硕士」里的年限优先（以前在整张卡片文字里找，「优势」里写了「应届」之类就被当成 0 年）
    if (fields && fields.expYearsCard != null) return fields.expYearsCard;
    var srcs = [summary || '', text || ''];
    for (var i = 0; i < srcs.length; i++) {
      var s = srcs[i];
      if (!s) continue;
      if (/(\d{2}|\d)\s*年应届|应届生|在校生/.test(s) && i === 0) return 0;
      if (/1\s*年以内/.test(s)) return 0;
      var m = s.match(/(\d{1,2})\s*年以上/) || s.match(/(\d{1,2})\s*年(?:的)?(?:工作)?经验/) || s.match(/(?:经验|年限)[：:\s]*(\d{1,2})\s*年/) || s.match(/工作\s*(\d{1,2})\s*年/);
      if (m) return parseInt(m[1], 10);
      if (i === 0) {
        var m2 = s.match(/(?:^|[|｜\s])(\d{1,2})\s*年(?:[|｜\s]|$)/);
        if (m2) return parseInt(m2[1], 10);
      }
    }
    return fields && fields.expYears != null ? fields.expYears : null;
  }

  // 期望城市 / 期望职位：优先用页面脚本直接读到的 fields.city / fields.expectJob，再从摘要「期望: 苏州 · 数字IC验证工程师」里解析
  function expectOf(summary, fields) {
    var f = fields || {};
    // v1.9.40 城市以顶部「期望 / 求职期望」那一行为准。正文第一个城市常是公司名（北京小米…），不能拿来当期望城市
    var city = '', job = '';
    var lp = String(summary || '').match(/求职期望[:：]?\s*([\u4e00-\u9fa5、,，/]{2,40}?)[\s|｜·•・]+([^\n|｜]+)/);
    if (lp) { city = lp[1]; job = lp[2].replace(/\s*\d+(?:\.\d+)?\s*[-~].*$|面议.*$/, '').trim(); }
    if (!city || !job) {
      var m = String(summary || '').match(/期望[:：]?\s*[|｜]?\s*([^·•・|｜\n]+?)\s*[·•・|｜]\s*([^|｜\n]+)/)
        || String(summary || '').match(/期望[:：]?\s*([\u4e00-\u9fa5]{2,4})\s+([^|｜\n]+)/);   // 猎聘：「求职期望: 上海 招聘经理/主管 17-20k」
      if (m) { city = city || m[1].trim(); job = job || m[2].replace(/\s*\d+(?:\.\d+)?\s*[-~].*$|面议.*$/, '').trim(); }
    }
    if (!city) city = f.city || '';
    if (!job) job = f.expectJob || '';
    return { city: city, job: job };
  }

  // 年龄：Boss 顶部「35岁」。只认摘要里的，聊天里出现的数字不算
  function ageOf(summary, fields) {
    var m = String(summary || '').match(/(\d{2})\s*岁/);
    if (m) return parseInt(m[1], 10);
    return fields && fields.age != null ? fields.age : null;
  }

  // ---------- v2.6.2 卡片右栏的经历：分出工作 / 教育，算每段多长 ----------
  var DEG_RE = /(?:^|\s)(本科|硕士|博士|博士后|大专|专科|学士|研究生|MBA|EMBA|MPA|中专|高中)$/i;
  var SCHOOL_RE = /(大学|(?<!科)学院|学校|中学|University|College|Institute of Technology|School)/i;
  var TITLE_RE = /(工程师|经理|研究员|专员|主管|总监|助理|顾问|设计|开发|验证|测试|架构|负责人|主任|总裁|CEO|CTO|Engineer|Manager|Designer|Developer)/i;
  function ym(x) {
    var m = String(x || '').match(/((?:19|20)\d{2})(?:\s*[.\-/年]\s*(\d{1,2}))?/);
    return m ? m[1] * 12 + ((m[2] ? parseInt(m[2], 10) : 1) - 1) : null;
  }
  /**
   * 卡片上的经历行（「2021.05-至今 公司 · 职位」）→ 工作经历行 { line, dt, parts, company, title, kwText, months, partial }
   * 教育行（学校 · 专业 · 学历）去掉。opt.titleOnly：关键词只看职位（猎聘），否则看公司 + 职位（BOSS）
   * partial：这一行看不到职位，或文字被截断
   */
  function workRows(lines, opt) {
    opt = opt || {};
    var now = opt.now ? new Date(opt.now) : new Date();
    var nowYm = now.getFullYear() * 12 + now.getMonth();
    var out = [];
    (lines || []).forEach(function (l) {
      var str = String(l || '').trim();
      if (!str) return;
      var sp = str.indexOf(' ');
      var dt = sp > 0 ? str.slice(0, sp) : str, rest = sp > 0 ? str.slice(sp + 1).trim() : '';
      var parts = rest.split(/\s*[·•・]\s*/).map(function (x) { return x.trim(); }).filter(Boolean);
      var restN = parts.join(' ');
      var dm = dt.replace(/[（(][^)）]*[)）]/g, '').match(/^(.+?)[-–—－~～至到](.+)$/);
      if (DEG_RE.test(restN) || /统招|非统招/.test(restN) || (SCHOOL_RE.test(restN) && !TITLE_RE.test(restN))) {   // 教育经历
        if (opt.edu && dm) opt.edu.push({ line: str, end: /至今|今|现在/.test(dm[2]) ? null : ym(dm[2]), endHasMonth: /\d{4}\s*[.\-/年]\s*\d{1,2}/.test(dm[2]) });
        return;
      }
      var from = dm ? ym(dm[1]) : null;
      var to = dm ? (/至今|今|现在|present|now/i.test(dm[2]) ? nowYm : ym(dm[2])) : null;
      var months = from != null && to != null && to >= from ? to - from + (/至今|今|现在/.test(dm[2]) ? 0 : 1) : null;
      var company = parts[0] || '', title = parts.length > 1 ? parts.slice(1).join(' ') : '';
      out.push({
        line: str, dt: dt, parts: parts, company: company, title: title,
        kwText: opt.titleOnly ? title : parts.join(' '), months: months, from: from,
        partial: !title || /…|\.\.\.$/.test(rest)
      });
    });
    return out;
  }
  function ymText(v) { return Math.floor(v / 12) + '.' + String(v % 12 + 1).padStart(2, '0'); }
  /**
   * v2.6.2 从第一份工作算起的年限（卡片右栏）
   * 返回 { from, fromText, months, reliable, why }。reliable：能确定这就是第一份工作
   *   - 最早那段工作在毕业后一年内开始（卡片上有教育经历），或
   *   - 卡片上几段工作加起来已经覆盖了左侧写的年限
   */
  function firstJob(lines, opt) {
    opt = opt || {};
    var now = opt.now ? new Date(opt.now) : new Date();
    var nowYm = now.getFullYear() * 12 + now.getMonth();
    var edu = [];
    var W = workRows(lines, { now: opt.now, edu: edu });
    var starts = W.map(function (w) { return w.from; }).filter(function (x) { return x != null; });
    if (!starts.length) return null;
    var from = Math.min.apply(null, starts);
    var grads = edu.filter(function (e) { return e.end != null; }).map(function (e) { return e.endHasMonth ? e.end : e.end + 6; });   // 只写年份的按 7 月毕业
    var grad = grads.length ? Math.max.apply(null, grads) : null;
    var cover = W.reduce(function (n, w) { return n + (w.months || 0); }, 0);
    var afterGrad = grad != null && from - grad <= 12;
    var covers = opt.years != null && cover >= opt.years * 12 - 12;
    return {
      from: from, fromText: ymText(from), months: Math.max(0, nowYm - from), grad: grad,
      reliable: afterGrad || covers,
      why: afterGrad ? '毕业后就参加工作' : covers ? '卡片上的工作覆盖了全部年限' : ''
    };
  }
  function yearsText(months) { var y = Math.round(months / 12 * 10) / 10; return (y % 1 ? y.toFixed(1) : String(y)) + ' 年'; }

  /**
   * v2.6.8 第一学历是不是大专。卡片：看教育经历行（学校 · 专业 · 大专）和左栏；完整简历：看有没有「专升本」或某段学历是大专
   * 返回 { dz: true|false, why }
   */
  function firstEduOf(profile, text, summary) {
    var p = profile || {}, f = p.fields || {};
    var lines = [];
    if (p.cardLines && p.cardLines.length) lines = p.cardLines.concat(f.baseLine ? [f.baseLine] : []);
    else lines = String((text || '') + '\n' + (summary || '')).split(/\n+/);
    for (var i = 0; i < lines.length; i++) {
      var l = String(lines[i] || '');
      if (/专升本/.test(l)) return { dz: true, why: '「专升本」' };
      if (/(大专|专科)(?!及?以上|以下|学历要求)/.test(l.replace(/\s+/g, '')) && !/要求|以上学历/.test(l)) {
        return { dz: true, why: l.replace(/\s+/g, ' ').trim().slice(0, 50) };
      }
    }
    return { dz: false, why: p.cardLines ? '卡片上的学历里没有大专' : '简历里没看到大专' };
  }

  /**
   * @param profile { text, summary, fields }  summary = 顶部简历摘要（可选）
   * @param jd      { hardRequirements: [], optionalKeywords: [] }
   */
  function match(profile, jd, opts) {
    opts = opts || {};
    var text = (profile && profile.text) || '';
    var summary = (profile && profile.summary) || '';
    var f = (profile && profile.fields) || {};
    var d = jd || {};
    // v1.9.7 keywordText：硬性关键词只在这段文字里找（猎聘卡片 = 工作经历的公司 + 职位，不含期望和标签）
    var kwOnly = !!(profile && profile.keywordText != null);
    var kw = kwOnly ? norm(profile.keywordText) : '';
    var rules = (d.hardRequirements || []).map(parseRule).filter(function (r) { return r.text; });
    // v2.6.6 Job relevance 写了好几行（「IC验证」「数字IC验证」「IC设计」…）：合成一条，和其中任何一个方向相关就算过
    var kwIdx = -1, kwAll = [];
    rules.forEach(function (r, i) { if (r.kind === 'kw') { if (kwIdx < 0) kwIdx = i; r.alts.forEach(function (a) { if (kwAll.indexOf(a) < 0) kwAll.push(a); }); } });
    if (kwIdx >= 0) {
      var merged = { kind: 'kw', alts: kwAll, text: kwAll.join(' / ') };
      rules = rules.filter(function (r, i) { return r.kind !== 'kw' || i === kwIdx; }).map(function (r) { return r.kind === 'kw' ? merged : r; });
    }
    var miss = [], unknown = [], okList = [];
    var relevance = [];   // v2.6.5 每段工作和岗位的匹配度（给打招呼面板显示）
    var rows = [];   // v1.5.2 每条条件的核对结果，给网页卡片逐行显示：{ rule, ok: true|false|null, got }

    rules.forEach(function (r) {
      if (r.kind === 'edu') {
        var lv = eduOf(summary, text, f);
        if (lv == null) unknown.push('学历读不到（要求' + EDU_TEXT[r.min] + '）');
        else if (lv >= r.min) okList.push('学历' + EDU_TEXT[lv]);
        else miss.push('学历' + EDU_TEXT[lv] + '，要求' + EDU_TEXT[r.min]);
        rows.push({ rule: '学历 ≥ ' + EDU_TEXT[r.min], ok: lv == null ? null : lv >= r.min, got: lv == null ? '读不到' : EDU_TEXT[lv] });
      } else if (r.kind === 'age') {
        var a = ageOf(summary, f);
        var want = r.min != null && r.max != null ? r.min + '到' + r.max + '岁' : (r.max != null ? r.max + '岁及以下' : r.min + '岁及以上');
        var okA = a == null ? null : ((r.min == null || a >= r.min) && (r.max == null || a <= r.max));
        if (okA === null) unknown.push('年龄读不到（要求' + want + '）');
        else if (okA) okList.push(a + '岁');
        else miss.push(a + '岁，要求' + want);
        rows.push({ rule: '年龄 ' + want, ok: okA, got: a == null ? '读不到' : a + '岁' });
      } else if (r.kind === 'firstEdu') {
        var fe = firstEduOf(profile, text, summary);
        if (fe.dz) miss.push('第一学历是大专（' + fe.why + '）');
        else okList.push('第一学历不是大专');
        rows.push({ rule: '第一学历不要大专', ok: !fe.dz, got: fe.dz ? '大专：' + fe.why : fe.why });
      } else if (r.kind === 'city' || r.kind === 'job') {
        var ex = expectOf(summary, f);
        var val = r.kind === 'city' ? ex.city : ex.job;
        var lbl = r.kind === 'city' ? '期望城市' : '期望职位';
        var hitE = val ? r.alts.filter(function (x) { return norm(val).indexOf(norm(x)) >= 0; }) : [];
        var okE = val ? hitE.length > 0 : null;
        if (okE === null) unknown.push(lbl + '读不到');
        else if (okE) okList.push(lbl + val);
        else miss.push(lbl + '「' + val + '」不在 ' + r.alts.join('/'));
        rows.push({ rule: lbl + '：' + r.alts.join(' | '), ok: okE, got: val || '读不到' });
      } else if (r.kind === 'exp') {
        var y = expOf(summary, text, f);
        if (y == null) unknown.push('经验读不到（要求' + r.min + '年）');
        else if (y >= r.min) okList.push('经验' + y + '年');
        else miss.push('经验' + y + '年，要求' + r.min + '年');
        rows.push({ rule: '经验 ≥ ' + r.min + '年', ok: y == null ? null : y >= r.min, got: y == null ? '读不到' : y + '年' });
        // v2.6.2 年限：左侧写的年限为准；再按右栏「第一份工作开始的时间」算到今天，核对一遍
        var CL = profile && profile.cardLines;
        var fj = CL && CL.length ? firstJob(CL, { now: opts.now, years: y }) : null;
        if (fj) {
          var fjY = yearsText(fj.months);
          var enough = fj.months >= r.min * 12 - 6;   // 差半年以内算够
          if (y == null) {
            // 左侧没写年限：第一份工作能确定时按它判
            if (fj.reliable) {
              unknown.pop();
              if (enough) okList.push('从 ' + fj.fromText + ' 参加工作算起约' + fjY.replace(' ', ''));
              else miss.push('从 ' + fj.fromText + ' 参加工作算起约' + fjY.replace(' ', '') + '，要求' + r.min + '年');
              rows[rows.length - 1] = { rule: '经验 ≥ ' + r.min + '年', ok: enough, got: '左侧没写，' + fj.fromText + ' 参加工作，约 ' + fjY };
            }
          } else if (y >= r.min) {
            if (enough) rows.push({ rule: '从参加工作算起', ok: true, got: fj.fromText + ' 起约 ' + fjY + (fj.reliable ? '' : '（卡片上最早一段）') });
            else if (fj.reliable) {
              miss.push('左侧写' + y + '年，但从第一份工作 ' + fj.fromText + ' 算起只有约' + fjY.replace(' ', '') + '，要求' + r.min + '年');
              rows.push({ rule: '从参加工作算起', ok: false, got: fj.fromText + ' 起只有约 ' + fjY + '（' + fj.why + '）' });
            } else rows.push({ rule: '从参加工作算起', ok: true, got: '卡片上最早一段 ' + fj.fromText + ' 起约 ' + fjY + '，更早的没显示，按左侧 ' + y + ' 年算' });
          }
        }
      } else if (kwOnly && !kw) {
        // v1.9.7 猎聘卡片：关键词只在工作经历里找，工作经历读不到就不判
        unknown.push('工作经历读不到（' + r.alts.join('/') + '）');
        rows.push({ rule: r.alts.join(' | '), ok: null, got: '工作经历读不到' });
      } else {
        // v2.6.4 职位相关性：按方向判断，不要求一字不差
        var tg = relTarget(r.alts);
        var jc = coreTitle(opts.jobTitle);
        if (jc) {
          tg.job = jc;
          famsOf(jc).forEach(function (k) { if (tg.fams.indexOf(k) < 0) tg.fams.push(k); if (tg.spec.indexOf(k) < 0) tg.spec.push(k); });
        }
        var label = 'Job relevance：' + r.alts.join(' / ');
        var wr = profile && profile.workRows;
        if (kwOnly && wr && wr.length) {
          // v3.5.0 判断顺序（所有岗位通用）：只看卡片右栏的工作经历，和正在招的岗位一一对应
          //  ① 有一段做的就是正在招的岗位，或者和它是同一个具体方向（招 IC验证：SoC验证、DV 都算）→ 通过
          //  ② 职位里混着别的方向、而且和招聘方向不相近的不算（招 IC验证：FPGA验证、芯片测试验证、应用工程师都不算）
          //  ③ 方向不一样的不算，相近也不算（招 IC验证：数字IC设计不通过）。期望岗位只显示，不影响结果
          //  ④ 职位看不全、或只写了「IC设计」看不出数字模拟的，跳过，不打招呼
          //  在校期间就结束的经历（实习）不计入
          var eduL = [];
          var CLx = profile && profile.cardLines;
          if (CLx && CLx.length) workRows(CLx, { now: opts.now, edu: eduL });
          var grads = eduL.filter(function (e) { return e.end != null; }).map(function (e) { return e.endHasMonth ? e.end : e.end + 6; });
          var grad = grads.length ? Math.max.apply(null, grads) : null;
          var T = positionTarget(jc, tg, opts.jobTitle);
          var relRows = [];
          wr.forEach(function (w) {
            var end = w.from != null && w.months != null ? w.from + Math.max(0, w.months - 1) : null;
            var school = grad != null && end != null && end < grad;
            var pm = school ? null : rowMatch(w.title, w.kwText + ' ' + w.title, T, tg, w.partial);
            relRows.push({ dt: w.dt === '-' ? '' : w.dt, text: w.parts.join(' · ') || w.line, level: school ? 'school' : pm.level,
              why: school ? '在校期间，不计入' : pm.why, pct: school || pm.level === 'unknown' || pm.level === 'ambiguous' ? null : (pm.ok ? 100 : 0),
              months: w.months, same: !!(pm && pm.level === 'same'), ok: !!(pm && pm.ok), from: w.from });
          });
          var counted = relRows.filter(function (x) { return x.level !== 'school'; });
          var starts = counted.map(function (x) { return x.from; }).filter(function (x) { return x != null; });
          var since = starts.length ? ymText(Math.min.apply(null, starts)) : '';
          var hit = counted.filter(function (x) { return x.ok; });
          var hitOne = hit.filter(function (x) { return x.same; })[0] || hit[0];
          var unsure = counted.filter(function (x) { return x.level === 'unknown' || x.level === 'ambiguous'; });
          var tName = T.names.join(' / ') || (jc || r.alts.join(' / '));
          var expJob = expectOf(summary, f).job || '';
          relevance.push({ target: r.alts.join(' / '), position: tName, score: hit.length ? 100 : (unsure.length ? null : 0), grade: hit.length ? '对上' : (unsure.length ? '看不全' : '没对上'),
            rows: relRows, since: since, strict: true, expect: expJob ? '期望「' + expJob + '」（只作参考，不影响结果）' : '' });
          var R = relevance[relevance.length - 1];
          var seen = counted.slice(0, 3).map(function (x) { return x.text; }).join('、');
          if (hitOne) {
            if (hitOne.same) R.did = hitOne.text; else R.match = hitOne.text;
            okList.push((hitOne.same ? '做过本岗位' : '做过同方向岗位') + '（' + hitOne.text + (hitOne.same ? '' : ' · ' + hitOne.why) + '）');
            rows.push({ rule: label, ok: true, got: (hitOne.same ? '做过本岗位：' : '同方向：') + hitOne.text + (hitOne.same ? '' : '（' + hitOne.why + '）') });
          } else if (unsure.length) {
            var uw = unsure[0].level === 'ambiguous' ? unsure[0].why : '职位看不全';
            unknown.push('有 ' + unsure.length + ' 段工作没法和「' + tName + '」对上（' + uw + '），其余的都不是这个岗位');
            rows.push({ rule: label, ok: null, got: uw + '：' + unsure.map(function (x) { return x.text; }).join('、') });
          } else {
            var others = counted.map(function (x) { return x.why; }).filter(Boolean);
            var whyR = '从 ' + (since || '参加工作') + ' 起的工作经历里没有做过「' + tName + '」的（' + seen + (others.length ? '：' + others.filter(function (x, i) { return others.indexOf(x) === i; }).join('、') : '') + '）';
            miss.push(whyR);
            rows.push({ rule: label, ok: false, got: whyR });
          }
        } else {
          var src = kwOnly ? (profile.keywordText || '') : text + '\n' + summary;
          var jcl = coreTitle(opts.jobTitle);
          var hw = (kwOnly && jcl && litHit(relNorm(src), jcl)) ? jcl : relInText(src, tg);
          var loose = hw && profile && profile.keywordLoose ? '（工作经历没按行认出来，按卡片文字判断）' : '';
          if (hw) okList.push('相关「' + hw + '」' + loose);
          else miss.push(kwOnly ? '工作经历和「' + r.alts.join('/') + '」不相关' : '简历里没有和「' + r.alts.join('/') + '」相关的内容');
          rows.push({ rule: label, ok: !!hw, got: hw ? '有「' + hw + '」' + loose : (kwOnly ? '工作经历里没有' : '简历里没有') });
        }
      }
    });

    // v1.5.0 芯片行业：看过往公司名，不在全文里搜「芯片」两个字
    var industry = null;
    if (d.requireChip) {
      var IND = opts.industry || (typeof HRSIndustry !== 'undefined' ? HRSIndustry : null);
      if (IND) {
        industry = IND.judge(profile && profile.industryText != null ? profile.industryText : summary, opts.chipWords, opts.chipExclude, profile && profile.workLines);
        if (industry.chip) okList.push('芯片公司：' + industry.hit);
        else if (!industry.known) unknown.push('过往公司读不到（要求芯片行业）');
        else miss.push('过往公司都不是芯片公司（' + industry.companies.slice(0, 4).join('、') + (industry.companies.length > 4 ? '等' : '') + '）');
        rows.push({ rule: '芯片行业', ok: industry.chip ? true : (industry.known ? false : null),
          got: industry.chip ? '「' + industry.hit + '」命中「' + industry.word + '」' : (industry.known ? industry.companies.join('、') + ' 都不是' : '没读到公司名') });
      }
    }

    var bonus = (d.optionalKeywords || []).filter(function (k) { return norm(k); });
    // v3.3.0 加分项和简历详情用同一个找词办法（KB.kwHit）：短英文缩写要整词，DV 不再命中 DVD
    var bonusSrc = text + '\n' + summary;
    var bonusHit = bonus.filter(function (k) { return KB.kwHit(bonusSrc, k); });
    // 分数只用来排序：硬性满足给 60 分底，加分项按命中比例再加最多 40 分
    var bonusScore = bonus.length ? Math.round(40 * bonusHit.length / bonus.length) : 0;
    var detail = { relevance: relevance, rows: rows, companies: industry ? industry.companies : null, bonusAll: bonus, hardMiss: miss, hardUnknown: unknown, hardOk: okList, optionalHit: bonusHit, keywordHit: bonusHit, keywordMiss: [] };
    var bonusText = bonus.length ? '加分 ' + bonusHit.length + '/' + bonus.length + (bonusHit.length ? '：' + bonusHit.slice(0, 5).join('、') : '') : '';

    if (profile && profile.summaryExpected && !summary && (rules.length || d.requireChip)) {
      return { score: 0, verdict: 'review', reasons: ['没读到顶部简历信息，不自动判定，请人工看'], hits: detail };
    }
    if (miss.length) {
      return { score: 0, verdict: 'reject', reasons: ['不满足要求：' + miss.join('，')].concat(bonusText ? [bonusText] : []), hits: detail };
    }
    if (unknown.length) {
      return { score: 50 + Math.round(bonusScore / 4), verdict: 'review', reasons: [unknown.join('，') + '，请人工确认'].concat(bonusText ? [bonusText] : []), hits: detail };
    }
    var reasons = [okList.length ? '要求全部满足：' + okList.join('、') : '未设置要求'];
    if (bonusText) reasons.push(bonusText);
    return { score: 60 + bonusScore, verdict: 'pass', reasons: reasons, hits: detail };
  }

  return { positionTarget: positionTarget, rowMatch: rowMatch, expectOf: expectOf, match: match, workRows: workRows, firstJob: firstJob, relTarget: relTarget, relOfRow: relOfRow, coreTitle: coreTitle, firstEduOf: firstEduOf, relInText: relInText, splitAlts: splitAlts, famsOf: famsOf, findKeywords: findKeywords, parseRule: parseRule, EDU_LEVEL: EDU_LEVEL, norm: norm };
});
