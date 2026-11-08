/**
 * resume-inbox.js v2.5.0：简历收集的纯逻辑（页面、后台、node 测试共用，不碰 DOM 和网络）
 * - 从在线简历（沟通页顶部摘要 + 工作经历行）和 PDF 文字里提取：姓名、最近一家公司、工作年限、年龄、学历、期望城市
 * - 按自定义模板生成文件名：默认 {姓名}—{类别}—{公司}—{年限}—{年龄学历}—{城市}—{平台}
 * - 字段取值优先级：手动填的 > 在线简历 > PDF（姓名例外：在线是「张先生」这类称呼时用 PDF 里的真名）
 */
(function (root, factory) {
  if (typeof module !== 'undefined' && module.exports) module.exports = factory();
  else root.HRSResumeInbox = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var DEFAULT_TPL = '{姓名}—{类别}—{公司}—{年限}—{年龄学历}—{城市}—{平台}';
  var DEFAULT_CATS = ['DE', 'DV', 'FPGA', 'IT', 'HR', 'SW', 'Analog'];   // v2.6.0 加了 HR / SW / Analog
  var ORIGIN_LABEL = { self: '自发', request: '请求' };
  var DEFAULT_CITIES = ['上海', '苏州'];
  var TOKENS = [
    { k: '姓名', d: '候选人姓名' },
    { k: '类别', d: '岗位类别（DE / DV / FPGA / IT，可自己加）' },
    { k: '公司', d: '最近一家公司' },
    { k: '年限', d: '工作年限，例如 5年' },
    { k: '年龄学历', d: '例如 28岁本科' },
    { k: '城市', d: '期望城市（上海 / 苏州，可自己加）' },
    { k: '平台', d: 'BOSS / 猎聘' },
    { k: '岗位', d: '插件里的岗位名' },
    { k: '日期', d: '收到日期，例如 1029' },
    { k: '年龄', d: '例如 28岁' },
    { k: '学历', d: '例如 本科' },
    { k: '来源', d: '自发（候选人主动发的）/ 请求（我们索要后发的）' }
  ];
  var SITE_LABEL = { boss: 'BOSS', liepin: '猎聘' };
  var EDU = [['博士', 5], ['硕士', 4], ['研究生', 4], ['MBA', 4], ['本科', 3], ['学士', 3], ['大专', 2], ['专科', 2], ['高职', 2], ['中专', 1], ['高中', 1]];
  var EDU_TEXT = { 1: '中专', 2: '大专', 3: '本科', 4: '硕士', 5: '博士' };
  var CITIES = ['上海', '苏州', '北京', '深圳', '杭州', '南京', '无锡', '合肥', '成都', '武汉', '西安', '广州', '厦门', '长沙', '重庆', '天津', '青岛', '宁波', '常州', '南通', '嘉兴', '珠海', '济南', '郑州', '福州', '大连', '沈阳', '昆山', '张家港', '常熟'];
  var DATE = '(?:19|20)\\d{2}(?:\\s*[.\\-/年]\\s*\\d{1,2}月?)?\\s*[-–—－‒―~～至到]\\s*(?:至今|今|现在|目前|(?:19|20)\\d{2}(?:\\s*[.\\-/年]\\s*\\d{1,2}月?)?)';
  var SCHOOL = /(大学|学院|学校|中学|高中|职校|University|College|School|本科|硕士|博士|学士|研究生|专业[:：])/i;
  var COMPANY_WORD = /(有限公司|有限责任公司|股份公司|公司|集团|研究院|研究所|实验室|科技|微电子|半导体|电子|技术|集成电路|芯|Inc\.?|Ltd\.?|Corp\.?|Co\.)/i;
  var SECTION_START = /(工作经历|工作经验|职业经历|实习经历|Work\s*Experience|Employment)/i;
  var SECTION_END = /(项目经历|项目经验|教育经历|教育背景|专业技能|技能特长|个人技能|自我评价|个人评价|证书|荣誉|获奖|Education|Projects?|Skills)/i;

  function s(x) { return String(x == null ? '' : x); }
  function nz(x) { return s(x).replace(/\s+/g, ''); }

  // ---------- 小工具 ----------
  function eduOf(text) {
    var t = s(text), best = 0;
    EDU.forEach(function (e) { if (t.indexOf(e[0]) >= 0 && e[1] > best) best = e[1]; });
    return best ? EDU_TEXT[best] : '';
  }
  function cityIn(text) {
    var t = s(text), best = '', pos = 1e9;
    CITIES.forEach(function (c) { var i = t.indexOf(c); if (i >= 0 && i < pos) { pos = i; best = c; } });
    return best;
  }
  /** 时间段 → { start, end }（月份数，便于比较；至今 = 很大） */
  function parseRange(str) {
    var m = s(str).match(new RegExp(DATE));
    if (!m) return null;
    var nums = function (seg) {
      var y = seg.match(/(19|20)\d{2}/);
      if (!y) return null;
      var after = seg.slice(seg.indexOf(y[0]) + 4);
      var mo = after.match(/^\s*[.\-/年]\s*(\d{1,2})/);
      return parseInt(y[0], 10) * 12 + (mo ? Math.min(12, parseInt(mo[1], 10)) - 1 : 0);
    };
    var parts = m[0].split(/\s*[-–—－‒―~～至到]\s*/);
    var start = nums(parts[0]);
    var endRaw = parts.slice(1).join('-');
    var end = /至今|今|现在|目前/.test(endRaw) ? 999999 : nums(endRaw);
    if (start == null) return null;
    return { start: start, end: end == null ? start : end, text: m[0] };
  }
  /** 一段文字里取公司名：去掉时间、括号时长、职位 */
  function companyFromSeg(seg) {
    var t = s(seg).replace(new RegExp(DATE, 'g'), ' ').replace(/^[\s·•|｜:：,，]+/, '')
      .replace(/^[（(]\s*\d+\s*(?:年|个月|月)[^）)]*[）)]\s*/, '').trim();
    if (!t) return '';
    // 「公司 · 职位」「公司 | 职位」「公司  职位」
    var first = t.split(/\s*[·•|｜]\s*|\s{2,}|\t/)[0].trim();
    // 有公司特征词时，截到特征词为止
    var m = first.match(/^(.{2,40}?(?:股份有限公司|有限责任公司|有限公司|集团有限公司|集团|研究院|研究所|公司))/);
    if (m) return m[1].trim();
    if (first.length > 40) {
      var m2 = t.match(/([一-龥A-Za-z0-9（）()&·]{2,30}?(?:股份有限公司|有限责任公司|有限公司|集团|研究院|研究所|公司))/);
      return m2 ? m2[1] : '';
    }
    return first.trim();
  }
  /** 公司简称：去掉「有限公司」等后缀、括号里的地区、开头的城市名 */
  function shortCompany(name) {
    var t = s(name).trim();
    if (!t) return '';
    t = t.replace(/[（(][^）)]{1,8}[）)]/g, '');
    t = t.replace(/(股份有限公司|有限责任公司|集团有限公司|有限公司|股份公司|集团公司|分公司|公司|Co\.?,?\s*Ltd\.?|Inc\.?|Ltd\.?|Corp\.?)$/i, '').trim();
    var pre = t.match(/^(上海|北京|深圳|广州|杭州|南京|苏州|无锡|合肥|成都|武汉|西安|天津|重庆|厦门|珠海|宁波|常州|南通|中国|江苏|浙江|广东|安徽|四川|湖北|陕西|福建|山东)(?:市|省)?/);
    if (pre && t.length - pre[0].length >= 2) t = t.slice(pre[0].length);
    return t.trim() || s(name).trim();
  }

  // ---------- 在线简历（Boss 沟通页顶部摘要 + 工作经历行） ----------
  function fromOnline(summary, workLines, extra) {
    var out = {};
    var sm = s(summary);
    var lines = (workLines || []).map(s);
    var age = sm.match(/(\d{2})岁/);
    if (age) out.age = parseInt(age[1], 10);
    var yr = sm.match(/(?:^|[\s|｜·,，])(\d{1,2})年(?:以上)?(?:经验|工作经验)?(?=[\s|｜·,，]|$)/m) || sm.match(/工作(?:经验|年限)[:：]?\s*(\d{1,2})年/);
    if (yr) out.years = parseInt(yr[1], 10);
    else if (/应届|在校|暂无经验/.test(sm)) out.years = 0;
    out.edu = eduOf(sm.replace(/期望[^\n]*/g, ''));
    // 期望城市：「期望」那一行里的第一个城市
    var exp = sm.split(/\n/).filter(function (l) { return /期望/.test(l); }).join(' ');
    out.city = cityIn(exp);
    // 最近一家公司：工作经历行里结束时间最晚的
    var best = null;
    lines.forEach(function (ln) {
      if (SCHOOL.test(ln.replace(/^[^\s]+\s*/, ''))) return;
      var r = parseRange(ln);
      if (!r) return;
      var c = companyFromSeg(ln.slice(ln.indexOf(r.text) + r.text.length));
      if (!c || SCHOOL.test(c)) return;
      if (!best || r.end > best.end || (r.end === best.end && r.start > best.start)) best = { end: r.end, start: r.start, c: c };
    });
    if (best) {
      if (/(…|\.{2,})$/.test(best.c)) out.companyCut = true;   // Boss 显示不下被截断
      out.company = best.c.replace(/(…|\.{2,})$/, '').trim();
    }
    if (extra && extra.fields) {
      var f = extra.fields;
      if (out.age == null && f.age) out.age = f.age;
      if (out.years == null && f.expYears != null) out.years = f.expYears;
      if (!out.edu && f.eduText) out.edu = f.eduText;
    }
    Object.keys(out).forEach(function (k) { if (out[k] === '' || out[k] == null) delete out[k]; });
    return out;
  }

  // ---------- PDF 文字 ----------
  function guessPdfName(text) {
    var lines = s(text).split(/\n/).map(function (l) { return l.trim(); }).filter(Boolean).slice(0, 12);
    var lab = s(text).match(/姓\s*名[:：\s]\s*([一-龥·]{2,4})/);
    if (lab) return lab[1];
    for (var i = 0; i < lines.length; i++) {
      var m = lines[i].match(/^([一-龥]{2,4})(?:\s|$|[|｜,，])/);
      if (m && !/^(个人|简历|求职|基本|联系|电话|邮箱|教育|工作|项目|男|女|应聘|意向|期望)/.test(m[1])) return m[1];
    }
    return '';
  }
  function workSection(text) {
    var t = s(text);
    var a = t.search(SECTION_START);
    if (a < 0) return t;
    var rest = t.slice(a + 4);
    var b = rest.search(SECTION_END);
    return t.slice(a, a + 4 + (b < 0 ? rest.length : b));
  }
  /** PDF 里字距拉开的标题会读成「李 娜」「工 作 经 历」：单字之间的空格去掉（「复旦大学 微电子」这种词之间的空格不动） */
  function tightenCjk(text) {
    return s(text).split('\n').map(function (ln) {
      return ln.replace(/(^|[^\u4e00-\u9fa5])((?:[\u4e00-\u9fa5] )+[\u4e00-\u9fa5])(?=[^\u4e00-\u9fa5]|$)/g, function (m0, pre, run) { return pre + run.replace(/ /g, ''); });
    }).join('\n');
  }
  function fromPdf(text) {
    var t = tightenCjk(text);
    if (nz(t).length < 30) return { empty: true };
    var out = {};
    out.name = guessPdfName(t);
    var age = t.match(/(?:年\s*龄[:：\s]*)?(\d{2})\s*岁/);
    if (age && +age[1] >= 16 && +age[1] <= 70) out.age = parseInt(age[1], 10);
    if (out.age == null) {
      var b = t.match(/(?:出生(?:年月|日期)?|生日)[:：\s]*((?:19|20)\d{2})/);
      if (b) out.age = new Date().getFullYear() - parseInt(b[1], 10);
    }
    var yr = t.match(/(?:工作年限|工作经验)[:：\s]*(\d{1,2})\s*年/) || t.match(/(\d{1,2})\s*年(?:以上)?(?:工作|相关|行业)?经验/);
    if (yr) out.years = parseInt(yr[1], 10);
    out.edu = eduOf(t.replace(/期望[^\n]*/g, ''));
    var ec = t.match(/(?:期望|意向)(?:工作)?(?:城市|地点|地区)[:：\s]*([^\n]{0,20})/);
    if (ec) out.city = cityIn(ec[1]);
    // 最近一家公司：工作经历段里结束时间最晚的
    var sec = workSection(t);
    var re = new RegExp(DATE, 'g'), m, best = null, firstStart = null;
    while ((m = re.exec(sec)) !== null) {
      var r = parseRange(m[0]);
      if (!r) continue;
      // 公司名可能在时间前面（同一行）也可能在后面
      var lineStart = sec.lastIndexOf('\n', m.index) + 1;
      var lineEnd = sec.indexOf('\n', m.index + m[0].length);
      var line = sec.slice(lineStart, lineEnd < 0 ? sec.length : lineEnd);
      var before = line.slice(0, m.index - lineStart), after = line.slice(m.index - lineStart + m[0].length);
      if (SCHOOL.test(line)) continue;
      var c = '';
      if (COMPANY_WORD.test(before)) c = companyFromSeg(before);
      if (!c || !COMPANY_WORD.test(c)) { var c2 = companyFromSeg(after); if (c2 && (COMPANY_WORD.test(c2) || !c)) c = c2; }
      if (!c) {
        var nextEnd = sec.indexOf('\n', (lineEnd < 0 ? sec.length : lineEnd) + 1);
        var next = lineEnd < 0 ? '' : sec.slice(lineEnd + 1, nextEnd < 0 ? sec.length : nextEnd);
        if (COMPANY_WORD.test(next) && !SCHOOL.test(next)) c = companyFromSeg(next);
      }
      if (!c || SCHOOL.test(c) || /项目|负责|参与/.test(c)) continue;
      if (firstStart == null || r.start < firstStart) firstStart = r.start;
      if (!best || r.end > best.end || (r.end === best.end && r.start > best.start)) best = { end: r.end, start: r.start, c: c };
    }
    if (best) out.company = best.c;
    if (out.years == null && firstStart != null) {
      var now = new Date(), nowM = now.getFullYear() * 12 + now.getMonth();
      var y = Math.floor((nowM - firstStart) / 12);
      if (y >= 0 && y <= 45) { out.years = y; out.yearsCalc = true; }
    }
    Object.keys(out).forEach(function (k) { if (out[k] === '' || out[k] == null) delete out[k]; });
    return out;
  }

  // ---------- 类别 ----------
  function guessCat(text, cats) {
    var t = s(text);
    var list = cats && cats.length ? cats : DEFAULT_CATS;
    // v2.6.0 归类规则（按顺序，先对上的算）：
    //   FPGA → FPGA；验证 → DV；模拟设计 → Analog；数字设计 → DE；测试 / DFT / 编译器 / 嵌入式 / 软件 → SW；人事 / 招聘 / 行政 → HR；IT / 运维 → IT
    var analogOnly = /模拟|Analog|\bAMS\b/i.test(t) && !/数字|Digital/i.test(t);
    var rules = [
      ['FPGA', /FPGA/i],
      ['DV', /验证|\bDV\b|verif|UVM/i],
      ['Analog', /模拟|Analog|\bAMS\b/i, function () { return analogOnly; }],
      ['DE', /设计|\bDE\b|design|RTL|前端|数字\s*IC|IC\s*设计|架构/i, function () { return !analogOnly; }],
      ['SW', /测试|\bDFT\b|可测性|编译器|Compiler|LLVM|嵌入式|固件|Firmware|软件|\bBSP\b|Boot\s*ROM|驱动开发|\bATE\b/i],
      ['HR', /人事|人力|\bHRBP?\b|\bHRM\b|招聘|行政|薪酬|绩效/i],
      ['IT', /\bIT\b|运维|网络管理|系统管理|桌面支持|信息安全|IT支持/i]
    ];
    for (var i = 0; i < rules.length; i++) {
      var r = rules[i];
      if (r[2] && !r[2]()) continue;
      if (list.indexOf(r[0]) >= 0 && r[1].test(t)) return r[0];
    }
    // 自己加的类别：岗位名里直接带这个词
    for (var j = 0; j < list.length; j++) if (DEFAULT_CATS.indexOf(list[j]) < 0 && t.toLowerCase().indexOf(list[j].toLowerCase()) >= 0) return list[j];
    return '';
  }

  // ---------- 取值 ----------
  var FIELDS = ['name', 'cat', 'company', 'years', 'age', 'edu', 'city'];
  var FIELD_LABEL = { name: '姓名', cat: '类别', company: '公司', years: '工作年限', age: '年龄', edu: '学历', city: '城市' };
  function isHonorific(n) { return /^[一-龥]{1,2}(先生|女士|小姐|同学)$/.test(nz(n)); }
  /** 每个字段的最终值和来源 → { name: {v, src}, ... } */
  // 在线简历和 PDF 两处的值是不是一回事（自主识别：两处都有时互相核对）
  function same(k, a, b) {
    if (a === '' || a == null || b === '' || b == null) return null;
    if (k === 'years' || k === 'age') return Math.abs(Number(a) - Number(b)) <= 1;
    if (k === 'company') { var x = nz(shortCompany(a)), y = nz(shortCompany(b)); return !!x && !!y && (x.indexOf(y) >= 0 || y.indexOf(x) >= 0); }
    return nz(a) === nz(b);
  }
  /**
   * 每个字段的最终值 → { name: {v, src, agree, other, auto, hint}, ... }
   * v2.5.0 审核后的优先级：
   *   第一层：自动识别（在线简历 + PDF，两处都有时互相核对，agree = true / false）
   *   第二层：自动识别不到的项，用你手动填的
   *   例外：你在某一项上点了「更正」（man._o[字段] = true），这一项以你填的为准
   */
  function resolve(rec, opt) {
    rec = rec || {};
    opt = opt || {};
    var on = rec.online || {}, pdf = rec.pdf || {}, man = rec.man || {}, ov = man._o || {};
    var cities = opt.cities && opt.cities.length ? opt.cities : DEFAULT_CITIES;
    var cats = opt.cats && opt.cats.length ? opt.cats : DEFAULT_CATS;
    var A = {};
    var two = function (k, onV, pdfV, prefer) {
      var x = { v: '', src: '' };
      if (prefer === 'pdf' && pdfV) x = { v: pdfV, src: 'pdf' };
      else if (onV !== '' && onV != null) x = { v: onV, src: 'online' };
      else if (pdfV !== '' && pdfV != null) x = { v: pdfV, src: 'pdf' };
      x.agree = same(k, onV, pdfV);
      if (x.agree === false) x.other = x.src === 'online' ? pdfV : onV;
      return x;
    };
    // 姓名：平台上的名字（不是「张先生」这种称呼时）> PDF 里的名字
    var n0 = rec.name0 && !isHonorific(rec.name0) ? rec.name0 : '';
    A.name = two('name', n0, pdf.name, n0 ? '' : 'pdf');
    if (!A.name.v && rec.name0) A.name = { v: rec.name0, src: 'online' };
    // 公司：在线简历里被截断时用 PDF 的全称
    A.company = two('company', on.company, pdf.company, on.companyCut ? 'pdf' : '');
    if (on.companyCut && A.company.src === 'pdf') A.company.agree = same('company', on.company, pdf.company);
    A.years = two('years', on.years, pdf.years, '');
    if (A.years.src === 'pdf' && pdf.yearsCalc) A.years.calc = true;
    A.age = two('age', on.age, pdf.age, '');
    A.edu = two('edu', on.edu, pdf.edu, '');
    // 城市：只认选项里有的；简历里提到别的城市时记下来提示
    var cOn = on.city && cities.indexOf(on.city) >= 0 ? on.city : '', cPdf = pdf.city && cities.indexOf(pdf.city) >= 0 ? pdf.city : '';
    A.city = two('city', cOn, cPdf, '');
    if (!A.city.v && (on.city || pdf.city)) A.city.hint = on.city || pdf.city;
    // 类别：岗位设置里指定的 > 按岗位名判断
    if (rec.jdId && opt.catMap && opt.catMap[rec.jdId] && cats.indexOf(opt.catMap[rec.jdId]) >= 0) A.cat = { v: opt.catMap[rec.jdId], src: 'jd', agree: null };
    else { var g = guessCat((rec.jdTitle || '') + ' ' + (rec.jobText || ''), cats); A.cat = { v: g, src: g ? 'guess' : '', agree: null }; }
    if (opt.shortCompany !== false && A.company.v) {
      A.company.full = A.company.v;
      A.company.v = shortCompany(A.company.v);
    }
    var r = {};
    FIELDS.forEach(function (k) {
      var auto = A[k] || { v: '', src: '' };
      var m = man[k];
      var has = m !== undefined && m !== null && m !== '';
      if (has && ov[k]) r[k] = { v: m, src: 'man', override: true, auto: auto.v, hint: auto.hint };
      else if (auto.v !== '' && auto.v != null) r[k] = auto;
      else if (has) r[k] = { v: m, src: 'man', hint: auto.hint };
      else r[k] = auto;
    });
    return r;
  }
  function yearsText(y) { if (y === '' || y == null) return ''; y = Number(y); return isFinite(y) ? (y <= 0 ? '应届' : y + '年') : String(y); }
  function ageText(a) { if (a === '' || a == null) return ''; a = Number(a); return isFinite(a) && a > 0 ? a + '岁' : ''; }
  function values(rec, opt) {
    var r = resolve(rec, opt);
    var d = new Date(rec.at || Date.now());
    return {
      '姓名': r.name.v, '类别': r.cat.v, '公司': r.company.v, '年限': yearsText(r.years.v),
      '年龄学历': ageText(r.age.v) + (r.edu.v || ''), '年龄': ageText(r.age.v), '学历': r.edu.v || '',
      '城市': r.city.v, '平台': SITE_LABEL[rec.site] || '', '岗位': rec.jdTitle || '', '来源': ORIGIN_LABEL[rec.origin] || '',
      '日期': String(d.getMonth() + 1).padStart(2, '0') + String(d.getDate()).padStart(2, '0')
    };
  }
  /** 模板里出现、但现在是空的字段 → ['公司', '城市'] */
  function missing(rec, opt) {
    var tpl = (opt && opt.tpl) || DEFAULT_TPL;
    var v = values(rec, opt), out = [];
    tokensIn(tpl).forEach(function (k) {
      if (k === '年龄学历') { var r = resolve(rec, opt); if (!r.age.v) out.push('年龄'); if (!r.edu.v) out.push('学历'); return; }
      if (!v[k]) out.push(k);
    });
    return out;
  }
  function tokensIn(tpl) {
    var out = [], re = /\{([^{}]+)\}/g, m;
    while ((m = re.exec(s(tpl))) !== null) if (out.indexOf(m[1]) < 0) out.push(m[1]);
    return out;
  }
  function cleanPart(v) { return s(v).replace(/[\\/:*?"<>|\r\n\t]/g, ' ').replace(/\s+/g, ' ').trim(); }
  /** 按模板生成文件名（不含扩展名）。空字段连同它前面的分隔符一起去掉，不会出现「——」 */
  function render(tpl, vals) {
    tpl = s(tpl) || DEFAULT_TPL;
    var parts = [], re = /\{([^{}]+)\}/g, m, last = 0;
    while ((m = re.exec(tpl)) !== null) {
      parts.push({ lit: tpl.slice(last, m.index) });
      parts.push({ key: m[1] });
      last = m.index + m[0].length;
    }
    parts.push({ lit: tpl.slice(last) });
    var out = '', pendingSep = '', skipped = false;
    var SEP = /^[\s—\-_·|,，、]*$/;
    for (var i = 0; i < parts.length; i++) {
      var p = parts[i];
      if (p.lit != null) {
        // 前一个字段是空的：它后面的分隔符不要，避免「——」
        if (skipped && SEP.test(p.lit)) { skipped = false; continue; }
        skipped = false;
        pendingSep += p.lit;
        continue;
      }
      var v = cleanPart(vals[p.key] != null ? vals[p.key] : '');
      if (!v) { skipped = true; continue; }
      out += pendingSep + v;
      pendingSep = '';
    }
    // 结尾的文字（不是分隔符的话）保留
    if (pendingSep && !/^[\s—\-_·|,，]+$/.test(pendingSep)) out += pendingSep;
    out = out.replace(/^[\s—\-_·|,，]+/, '');
    return sanitize(out);
  }
  function sanitize(name) {
    var t = s(name).replace(/[\\/:*?"<>|\r\n\t]/g, '_').replace(/\s+/g, ' ').replace(/^[.\s]+|[.\s]+$/g, '');
    if (/^(CON|PRN|AUX|NUL|COM\d|LPT\d)$/i.test(t)) t = '_' + t;
    return t.slice(0, 120) || '简历';
  }
  /** 最终文件名（带 .pdf） */
  function fileName(rec, opt) {
    opt = opt || {};
    if (opt.renameOn === false) {
      var orig = s(rec.file && rec.file.name || '简历.pdf').replace(/\.pdf$/i, '');
      var nm = resolve(rec, opt).name.v;
      if (nm && orig.indexOf(nm) < 0) orig = nm + '_' + orig;
      return sanitize(orig) + '.pdf';
    }
    return render(opt.tpl || DEFAULT_TPL, values(rec, opt)) + '.pdf';
  }
  /** 本地保存的相对路径：{根目录}/简历收集/{日期}/{岗位}/{文件名} */
  /** v2.6.1 保存位置里的子文件夹 + 文件名。opt.layout：day-job（日期/岗位/，默认）、job（岗位/）、flat（不分文件夹） */
  function relPath(rec, opt) {
    opt = opt || {};
    var d = new Date(rec.at || Date.now());
    var day = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
    var job = sanitize(rec.jdTitle || '未识别岗位');
    var parts = opt.layout === 'flat' ? [] : opt.layout === 'job' ? [job] : [day, job];
    return parts.concat([fileName(rec, opt)]).join('/');
  }
  /**
   * 保存路径。opt.saveTo = 'folder'（你选的文件夹）时是相对那个文件夹的路径；
   * 否则是相对浏览器下载目录的路径：{归档文件夹}/简历收集/…
   */
  function savePath(rec, opt) {
    opt = opt || {};
    if (opt.saveTo === 'folder') return relPath(rec, opt);
    return [sanitize(opt.folder || 'HR人才库'), '简历收集', relPath(rec, opt)].join('/');
  }
  /** 去重指纹：同平台、同会话 / 同名、同文件名、同大小 */
  function fingerprint(r) {
    return [r.site || '', r.chatId || nz(r.name0), nz(r.file && r.file.name).toLowerCase(), (r.file && r.file.size) || 0].join('|');
  }
  /** 把沟通职位文字对到插件里的岗位 */
  function matchJd(jobText, jds, CT) {
    var t = s(jobText);
    if (!t || !jds || !jds.length) return null;
    var bestLen = 0, ties = [];
    jds.forEach(function (jd) {
      var hits = CT && CT.findHits ? CT.findHits(t, jd) : (nz(t).indexOf(nz(jd.title)) >= 0 ? [jd.title] : []);
      var len = hits.reduce(function (m, h) { return Math.max(m, nz(h).length); }, 0);
      if (!len) return;
      if (len > bestLen) { bestLen = len; ties = [jd]; } else if (len === bestLen) ties.push(jd);
    });
    if (ties.length <= 1) return ties[0] || null;
    // v2.6.0 同名岗位分城市（例如「编译器开发工程师(LLVM)」苏州 / 上海两个）：看沟通职位里写的城市
    var city = cityIn(t);
    if (city) {
      var byCity = ties.filter(function (jd) { return (jd.title + ' ' + (jd.greetJob || '')).indexOf(city) >= 0; });
      if (byCity.length) return byCity[0];
    }
    return ties[0];
  }
  function dayKey(t) { var d = new Date(t); return d.getFullYear() + '-' + (d.getMonth() + 1) + '-' + d.getDate(); }

  return {
    DEFAULT_TPL: DEFAULT_TPL, DEFAULT_CATS: DEFAULT_CATS, ORIGIN_LABEL: ORIGIN_LABEL, DEFAULT_CITIES: DEFAULT_CITIES, TOKENS: TOKENS,
    SITE_LABEL: SITE_LABEL, FIELDS: FIELDS, FIELD_LABEL: FIELD_LABEL, CITIES: CITIES,
    fromOnline: fromOnline, fromPdf: fromPdf, tightenCjk: tightenCjk, parseRange: parseRange, companyFromSeg: companyFromSeg, shortCompany: shortCompany,
    guessCat: guessCat, resolve: resolve, same: same, values: values, missing: missing, tokensIn: tokensIn, render: render,
    sanitize: sanitize, fileName: fileName, savePath: savePath, relPath: relPath, fingerprint: fingerprint, matchJd: matchJd,
    yearsText: yearsText, ageText: ageText, isHonorific: isHonorific, eduOf: eduOf, cityIn: cityIn, dayKey: dayKey
  };
});
