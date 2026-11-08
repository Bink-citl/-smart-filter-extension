/**
 * job-kb.js v2.9.1：岗位知识库 + 本地向量检索（打招呼 Job relevance 的底层，所有岗位通用）
 *
 * 做法（检索增强：先在知识库里检索，再按检索结果判断）
 *  1. 知识库：每个岗位方向一条，写清楚这个方向的各种叫法（中文、英文、缩写）和它挨着哪些方向（相近程度 0 到 1）
 *     芯片方向沿用 v2.6.9 收窄后的相近关系（例如 FPGA、测试、版图都不算数字验证的相近方向）
 *     另外补了通用岗位：人事、行政、财务、法务、IT、软件、嵌入式、编译器、硬件、算法、销售、市场、产品、项目、采购供应链、质量
 *  2. 向量：职位名切成二字片段（中文）和单词（英文），做成词频向量
 *  3. 检索：一个职位名 → 和每个方向的叫法逐个比，返回命中的方向和相似度
 *     - 叫法整个出现在职位名里：相似度 1。太泛的叫法（「验证」「软件」）只在没有别的方向命中时才算
 *     - 职位名被截断（「数字IC验…」）：叫法的开头和职位名的结尾接得上，按接上的比例算
 *  4. 两个职位名是不是同一个岗位：向量余弦相似度 ≥ 0.75，或一个包含另一个，或落在同一个具体方向
 *
 * 全部在本机算，不调用外部模型，不上传候选人信息。页面、后台、Node 测试共用。
 *
 * v3.4.0 知识库可以自定义：设置里能新增方向（settings.kbFamilies）、删除方向（settings.kbRemoved，内置的删了可以恢复），
 *        给方向补充叫法（settings.kbExtra）。页面打开和设置变化时调 applySettings(settings)，以设置为准重建
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.HRSJobKB = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // ---------------- 知识库 ----------------
  // g：大类（ic 芯片 / tech 其他技术 / biz 职能）。kw：叫法。near：相近方向和相近程度（≥ 0.5 才算相近）
  var KB = [
    // ---- 芯片 ----
    { id: 'dv', n: '数字验证', g: 'ic', kw: ['验证', 'ic验证', '数字验证', '数字ic验证', '芯片验证', 'soc验证', 'ip验证', '验证工程师', 'dv', 'design verification', 'verification', 'uvm', '前仿', 'emulation', 'formal'], near: { de: 0.6, icgen: 0.6 } },
    { id: 'de', n: '数字设计', g: 'ic', kw: ['数字设计', '数字ic设计', '数字芯片设计', '数字前端', '前端设计', 'rtl', '逻辑设计', 'asic', 'soc设计', '数字电路', 'ip设计', 'cpu设计', 'gpu设计', 'npu设计', '微架构', 'digital design', 'asic design', 'ic前端', '数字ic工程师', '数字芯片工程师', 'de'], near: { dv: 0.6, icgen: 0.6 } },
    { id: 'dft', n: 'DFT', g: 'ic', kw: ['dft', '可测性', 'design for test', 'mbist', '扫描链'], near: { de: 0.6, dv: 0.6 } },
    { id: 'pd', n: '数字后端', g: 'ic', kw: ['后端', '物理设计', 'physical design', 'apr', '布局布线', 'sta', '时序', 'signoff', 'pnr'], near: { dft: 0.6 } },
    { id: 'fpga', n: 'FPGA', g: 'ic', kw: ['fpga', '原型验证', 'prototyp', '逻辑工程师', '逻辑开发'], near: {} },
    { id: 'arch', n: '芯片架构', g: 'ic', kw: ['芯片架构', 'soc架构', '架构师', 'architect', '系统架构'], near: { de: 0.6 } },
    { id: 'icgen', n: 'IC / 芯片设计', g: 'ic', kw: ['ic设计', '芯片设计', '集成电路设计', '集成电路ic', '芯片研发', 'ic研发', '芯片工程师', 'ic工程师', '集成电路工程师', 'ic design', 'chip design'], near: { de: 0.6, dv: 0.6, analog: 0.6 } },
    { id: 'analog', n: '模拟设计', g: 'ic', kw: ['模拟设计', '模拟ic', '模拟电路', '模拟芯片', 'analog', '射频', 'rf', 'pll', 'adc', 'dac', 'serdes', '电源管理', 'pmu', 'ldo', 'dcdc', 'dc-dc', '混合信号设计'], near: { ams: 0.6, icgen: 0.6 } },
    { id: 'ams', n: '混合信号', g: 'ic', kw: ['混合信号', 'ams', '模拟验证', 'mixed signal', 'mixed-signal', '数模混合'], near: { analog: 0.6 } },
    { id: 'layout', n: '版图', g: 'ic', kw: ['版图', 'layout'], near: {} },
    { id: 'test', n: '芯片测试', g: 'ic', kw: ['芯片测试', 'ate', '测试开发', '量产测试', '测试工程师', '产品工程师', 'test engineer', '封测'], near: {} },
    { id: 'cad', n: 'CAD / EDA', g: 'ic', kw: ['cad', 'eda', '方法学'], near: {} },
    { id: 'proc', n: '工艺 / 器件 / 封装', g: 'ic', kw: ['器件', '工艺', '封装', '失效分析', '可靠性', '制程', 'tcad', 'pie', 'device engineer', 'process engineer'], near: {} },
    { id: 'ae', n: '应用 / 技术支持', g: 'ic', kw: ['fae', 'ae工程师', '应用工程师', '技术支持', 'field application', '现场应用'], near: { sales: 0.5 } },
    // ---- 其他技术 ----
    { id: 'sw', n: '软件开发', g: 'tech', kw: ['软件', '软件开发', '软件工程师', '后端开发', '前端开发', '全栈', 'java', 'python开发', 'c++开发', 'golang', 'web开发', 'software', 'linux'], near: { emb: 0.6, compiler: 0.6, algo: 0.5, swtest: 0.5 } },
    { id: 'emb', n: '嵌入式 / 固件', g: 'tech', kw: ['嵌入式', '固件', 'firmware', '驱动', 'bsp', 'mcu', 'rtos', '单片机'], near: { sw: 0.6, hw: 0.6, compiler: 0.5 } },
    { id: 'compiler', n: '编译器 / 工具链', g: 'tech', kw: ['编译器', 'compiler', 'llvm', 'gcc', 'mlir', '工具链', 'toolchain'], near: { sw: 0.6, emb: 0.5 } },
    { id: 'algo', n: '算法', g: 'tech', kw: ['算法', '机器学习', '深度学习', '视觉算法', '图像算法', '信号处理', 'machine learning', 'deep learning', 'algorithm'], near: { sw: 0.5 } },
    { id: 'hw', n: '硬件', g: 'tech', kw: ['硬件', '硬件工程师', '硬件开发', '板级', 'pcb', '原理图', '单板', 'hardware'], near: { emb: 0.6 } },
    { id: 'swtest', n: '软件测试', g: 'tech', kw: ['软件测试', '自动化测试', 'qa工程师'], near: { sw: 0.5 } },
    { id: 'it', n: 'IT / 运维', g: 'tech', kw: ['it工程师', 'it运维', 'it支持', '运维', '网络工程师', '系统管理员', '桌面支持', 'devops', '信息安全', 'it专员', 'it经理'], near: {} },
    // ---- 职能 ----
    { id: 'hr', n: '人事', g: 'biz', kw: ['人事', '人力资源', 'hrbp', 'hr', '招聘', '薪酬', '绩效', '员工关系', '培训', '组织发展', 'recruit', 'talent acquisition'], near: { admin: 0.6 } },
    { id: 'admin', n: '行政', g: 'biz', kw: ['行政', '前台', '办公室', '文员', '后勤', 'office manager'], near: { hr: 0.6 } },
    { id: 'fin', n: '财务', g: 'biz', kw: ['财务', '会计', '出纳', '税务', '审计', '成本会计', 'fp&a', 'accounting', 'finance'], near: {} },
    { id: 'legal', n: '法务 / 知识产权', g: 'biz', kw: ['法务', '律师', '合规', '知识产权', '专利工程师', '专利代理', 'legal', 'ip counsel'], near: {} },
    { id: 'sales', n: '销售 / 商务', g: 'biz', kw: ['销售', '商务', '客户经理', '大客户', '渠道', 'bd', 'business development', 'sales', 'key account'], near: { mkt: 0.5, ae: 0.5 } },
    { id: 'mkt', n: '市场 / 运营', g: 'biz', kw: ['市场', '品牌', '运营', '公关', 'marketing', '新媒体'], near: { sales: 0.5 } },
    { id: 'prod', n: '产品经理', g: 'biz', kw: ['产品经理', '产品专员', 'product manager', '产品总监'], near: { pm: 0.5 } },
    { id: 'pm', n: '项目管理', g: 'biz', kw: ['项目经理', '项目管理', 'pmo', 'program manager', 'project manager', '项目主管'], near: { prod: 0.5 } },
    { id: 'scm', n: '采购 / 供应链', g: 'biz', kw: ['采购', '供应链', '物流', '生产计划', '物料', '外协', 'supply chain', 'procurement'], near: { qa: 0.5 } },
    { id: 'qa', n: '质量', g: 'biz', kw: ['质量', '品质', 'sqe', 'iqc', '质量工程师', 'quality'], near: { scm: 0.5, proc: 0.5 } }
  ];
  // 太泛的叫法：只靠它命中、同时又有别的方向被明确命中时，不算这个方向
  // （「FPGA原型验证」不算数字验证，「软件测试工程师」不算软件开发和芯片测试）
  var WEAK = { dv: ['验证'], sw: ['软件', 'linux', 'software'], hw: ['硬件', 'hardware'], pd: ['后端', '时序', 'sta'], test: ['测试工程师'], mkt: ['市场', '运营'], qa: ['质量', 'quality'], hr: ['培训'], analog: ['rf'] };
  var BUILTIN = KB.slice();   // 内置的方向（删了也留在这里，可以恢复）
  BUILTIN.forEach(function (f) { f.base = f.kw.slice(); f.builtin = true; });
  var BY = {}, ALL = {};   // BY：正在用的方向；ALL：包括删掉的，显示名字用
  BUILTIN.forEach(function (f) { BY[f.id] = ALL[f.id] = f; });
  var GROUPS = { ic: '芯片', tech: '其他技术', biz: '职能' };

  /**
   * 以设置为准重建知识库（每次调用都先恢复成内置的，再按设置改）
   *   extra：{ 方向id: ['叫法', …] } 给方向补充的叫法（v3.2.0）
   *   custom：{ families: [{ id, n, g, kw: [], near: { 方向id: 0.6 } }]（自己加的方向）, removed: [方向id]（删掉的方向） }
   * KB 数组原地改，别处拿着的 HRSJobKB.KB 引用一直有效
   */
  function extend(extra, custom) {
    custom = custom || {};
    var removed = custom.removed || [];
    KB.length = 0; BY = {};
    BUILTIN.forEach(function (f) {
      f.kw = f.base.slice(); f.added = [];
      if (removed.indexOf(f.id) >= 0) return;
      KB.push(f); BY[f.id] = f;
    });
    (custom.families || []).forEach(function (u) {
      if (!u || !u.id || !u.n || BY[u.id] || removed.indexOf(u.id) >= 0) return;
      var kw = [];
      (u.kw || []).forEach(function (w) { var k = clean(w); if (k.length >= 2 && kw.indexOf(k) < 0) kw.push(k); });
      if (!kw.length) return;
      var near = {};
      Object.keys(u.near || {}).forEach(function (k) { var w = +u.near[k]; if (k !== u.id && w > 0 && w <= 1) near[k] = w; });
      var f = { id: u.id, n: String(u.n).trim(), g: GROUPS[u.g] ? u.g : 'tech', kw: kw, base: kw.slice(), near: near, added: [], custom: true };
      KB.push(f); BY[f.id] = ALL[f.id] = f;
    });
    Object.keys(extra || {}).forEach(function (id) {
      var f = BY[id];
      if (!f || f.custom) return;   // 自己加的方向，叫法直接写在方向里
      (extra[id] || []).forEach(function (w) {
        var k = clean(w);
        if (k.length < 2 || f.kw.indexOf(k) >= 0) return;
        f.kw.push(k); f.added.push(k);
      });
    });
  }
  /** 按设置重建：页面、后台、工作台都调这一个 */
  function applySettings(st) {
    st = st || {};
    extend(st.kbExtra, { families: st.kbFamilies, removed: st.kbRemoved });
  }
  /** 内置方向里被删掉的那些（工作台显示「恢复」用） */
  function removedBuiltins(st) {
    var r = (st && st.kbRemoved) || [];
    return BUILTIN.filter(function (f) { return r.indexOf(f.id) >= 0; });
  }
  /** 「数字验证 60%，数字设计」→ { dv: 0.6, de: 0.6 }。不写百分比按 60% 算，认不出的名字放进 unknown */
  function parseNear(text) {
    var out = {}, unknown = [];
    String(text || '').split(/[,，、;；\n]+/).forEach(function (x) {
      var m = x.trim().match(/^(.+?)\s*(\d{1,3})\s*%?$/), nm = (m ? m[1] : x).trim(), w = m ? Math.min(100, +m[2]) / 100 : 0.6;
      if (!nm) return;
      var f = KB.filter(function (y) { return clean(y.n) === clean(nm) || clean(y.n).replace(/\s+/g, '') === clean(nm).replace(/\s+/g, ''); })[0];
      if (f && w > 0) out[f.id] = w; else unknown.push(nm);
    });
    return { near: out, unknown: unknown };
  }
  // 「芯片」大方向的写法：写这些词等于写了下面几个方向
  var UMB = [
    { re: /数字(ic|芯片|集成电路)|数字方向|digital ?ic/, f: ['dv', 'de', 'dft', 'pd', 'fpga', 'arch', 'icgen'] },
    { re: /^(ic|芯片|集成电路|半导体芯片)(方向|研发|相关)?$/, f: ['dv', 'de', 'dft', 'pd', 'fpga', 'arch', 'icgen', 'analog', 'ams', 'layout'] },
    { re: /模拟(ic|芯片|方向)|analog ?ic/, f: ['analog', 'ams', 'layout'] },
    { re: /^前端$/, f: ['dv', 'de'] }
  ];

  // ---------------- 文字处理 ----------------
  function clean(x) {
    var t = String(x == null ? '' : x);
    try { t = t.normalize('NFKC'); } catch (e) {}
    return t.toLowerCase().replace(/\s+/g, ' ').trim();
  }
  function compact(x) { return clean(x).replace(/\s+/g, ''); }
  var ELL_RE = /(…|\.\.\.|。。。)\s*$/;
  function truncated(x) { return ELL_RE.test(String(x || '')); }
  function stripEll(x) { return String(x || '').replace(ELL_RE, ''); }
  // 短英文缩写（hr、bd、dv、rf…）要整词出现，避免 hr 命中 「three」
  function hasWord(t, w) {
    if (/^[a-z][a-z&-]{0,3}$/.test(w)) return new RegExp('(^|[^a-z])' + w.replace(/[-&]/g, '\\$&') + '([^a-z]|$)').test(t);
    return t.indexOf(w) >= 0 || t.replace(/\s+/g, '').indexOf(w.replace(/\s+/g, '')) >= 0;
  }
  /** v3.3.0 一个关键词在一段文字里有没有出现（加分项、否决词、简历详情都用这一个）：不分大小写、全角半角、忽略空格，短英文缩写要整词 */
  function kwHit(text, w) {
    var k = clean(w);
    return !!k && hasWord(clean(text), k);
  }

  // ---------------- 向量 ----------------
  // 级别、修饰词不参与比较（资深 IC验证工程师 和 IC验证工程师 是同一个岗位）
  var LEVEL_RE = /资深|高级|中级|初级|首席|主任|专家|senior|junior|staff|principal|lead|实习生?|兼职|助理/g;
  function vec(text) {
    var t = compact(stripEll(text)).replace(LEVEL_RE, '').replace(/[（(][^)）]*[)）]/g, '').replace(/[^0-9a-z一-龥+#&]/g, '');
    var v = {};
    var add = function (k) { v[k] = (v[k] || 0) + 1; };
    (clean(text).match(/[a-z][a-z+#&]{1,}/g) || []).forEach(function (w) { add('w:' + w); });
    for (var i = 0; i < t.length - 1; i++) add(t.slice(i, i + 2));
    if (t.length === 1) add(t);
    return v;
  }
  function cosine(a, b) {
    var dot = 0, na = 0, nb = 0, k;
    for (k in a) { na += a[k] * a[k]; if (b[k]) dot += a[k] * b[k]; }
    for (k in b) nb += b[k] * b[k];
    return na && nb ? dot / Math.sqrt(na * nb) : 0;
  }
  function sim(a, b) { return cosine(vec(a), vec(b)); }

  // ---------------- 检索 ----------------
  /**
   * 一个职位名属于哪些方向：返回 [{ id, n, s, by }]，s 是相似度（0 到 1），按 s 从高到低
   * by：'kw' 叫法出现在职位名里 / 'cut' 职位名被截断，按开头接上算
   */
  function retrieve(text) {
    var t = clean(text);
    if (!t) return [];
    var cut = truncated(text), tail = cut ? compact(stripEll(text)).split(/[·•・]/).pop() : '';
    var out = [];
    KB.forEach(function (f) {
      var best = 0, by = '', weak = WEAK[f.id] || [];
      for (var i = 0; i < f.kw.length; i++) {
        var w = f.kw[i];
        if (hasWord(t, w)) {
          if (weak.indexOf(w) >= 0) { if (best < 1) { best = 1; by = 'weak'; } continue; }
          best = 1; by = 'kw'; break;
        }
        if (cut && tail) {
          // 「数字IC验…」：叫法「数字ic验证」的开头 和 截断后的结尾接得上
          var wc = w.replace(/\s+/g, '');
          if (wc.length < 3) continue;
          for (var L = Math.min(wc.length - 1, tail.length); L >= 2; L--) {
            if (tail.slice(-L) === wc.slice(0, L)) { var s = L / wc.length; if (s >= 0.6 && s > best) { best = s; by = 'cut'; } break; }
          }
        }
      }
      if (best > 0) out.push({ id: f.id, n: f.n, s: Math.round(best * 100) / 100, by: by });
    });
    if (out.some(function (x) { return x.by !== 'weak'; })) out = out.filter(function (x) { return x.by !== 'weak'; });
    out.sort(function (a, b) { return b.s - a.s; });
    return out;
  }
  /** 只要方向 id */
  function famsOf(text) { return retrieve(text).map(function (x) { return x.id; }); }
  /** 大方向写法（「数字IC」「芯片」）展开成几个方向 */
  function umbOf(term) {
    var t = compact(term), out = [];
    UMB.forEach(function (u) { if (u.re.test(t)) u.f.forEach(function (k) { if (out.indexOf(k) < 0) out.push(k); }); });
    return out;
  }
  /** 两个方向的相近程度：同一个 1，知识库里写了相近按写的，没写 0 */
  function nearW(a, b) {
    if (a === b) return 1;
    var fa = BY[a], fb = BY[b];
    if (!fa || !fb) return 0;   // 删掉的方向不算相近
    return Math.max(fa.near[b] || 0, fb.near[a] || 0);
  }
  function name(id) { return ALL[id] ? ALL[id].n : id; }
  /**
   * 两个职位名是不是同一个岗位（「做过正在招的岗位」）
   * 返回 { same, s, why }
   */
  // 只有「工程师」「经理」这类通用词，不能拿来判断同一个岗位
  var GEN_TITLE = /^(工程师|经理|专员|主管|助理|开发|设计|研发|技术|总监|engineer|manager|developer)+$/;
  function samePosition(a, b) {
    var ca = compact(stripEll(a)).replace(LEVEL_RE, ''), cb = compact(stripEll(b)).replace(LEVEL_RE, '');
    if (!ca || !cb) return { same: false, s: 0, why: '' };
    var shortOne = ca.length <= cb.length ? ca : cb;
    if (shortOne.length >= 3 && !GEN_TITLE.test(shortOne) && (ca.indexOf(cb) >= 0 || cb.indexOf(ca) >= 0)) return { same: true, s: 1, why: '职位名一致' };
    var s = Math.round(sim(a, b) * 100) / 100;
    if (s >= 0.75) return { same: true, s: s, why: '职位名相似度 ' + Math.round(s * 100) + '%' };
    // 同一个具体方向（例如「DV Engineer」和「IC验证工程师」都是数字验证）
    var ra = retrieve(a), rb = retrieve(b);
    var top = function (r) { return r.filter(function (x) { return x.s >= 0.75; }).map(function (x) { return x.id; }); };
    var ta = top(ra), tb = top(rb);
    // 大类方向（IC / 芯片设计）太宽，不单独算同一个岗位
    var both = ta.filter(function (k) { return tb.indexOf(k) >= 0 && k !== 'icgen'; });
    if (both.length && tb.length && tb.every(function (k) { return k === 'icgen' || ta.indexOf(k) >= 0; })) return { same: true, s: Math.max(s, 0.8), why: '同一方向：' + name(both[0]) };
    return { same: false, s: s, why: '' };
  }

  return { KB: KB, GROUPS: GROUPS, extend: extend, applySettings: applySettings, removedBuiltins: removedBuiltins, parseNear: parseNear, hasWord: hasWord, kwHit: kwHit, retrieve: retrieve, famsOf: famsOf, umbOf: umbOf, nearW: nearW, name: name, samePosition: samePosition, sim: sim, vec: vec, truncated: truncated, clean: clean };
});
