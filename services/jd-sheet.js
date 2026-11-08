/**
 * jd-sheet.js v1.3.0：岗位JD 与 Excel 表格互转 + 导入预览
 * 规则：表里有的列以表为准（空单元格 = 清空或默认值），表里没有的列保留原值。
 * 对应依据：先按「平台职位名」，没填再按「JD标题」。
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.HRSJdSheet = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var EDU = ['不限', '高中', '大专', '本科', '硕士', '博士'];
  var COLS = [
    { h: '平台职位名', k: 'platformJob', t: 'text', w: 22, note: '沟通列表里候选人卡片上显示的职位名，智选靠它归岗位', ex: '人事主管' },
    { h: '推荐页职位名', k: 'greetJob', t: 'text', w: 22, note: 'Boss 推荐牛人页右上角下拉里的名称，写到城市为止，如「人事主管 _ 上海」。打招呼靠它切换职位，也是导入时对应已有岗位的第一依据', ex: '人事主管 _ 上海' },
    { h: 'JD标题', k: 'title', t: 'text', w: 22, note: '必填。话术里的 {position}。同名岗位在后面加城市', ex: '示例·人事主管' },
    { h: '期望城市', k: 'base.cities', t: 'text', w: 14, note: '候选人期望城市，多个用 | 隔开。新岗位留空 = 默认（北京|上海）', ex: '北京|上海' },
    { h: '年龄下限', k: 'base.ageMin', t: 'numN', w: 10, note: '数字，留空不限', ex: '' },
    { h: '年龄上限', k: 'base.ageMax', t: 'numN', w: 10, note: '数字。新岗位留空 = 默认（40）', ex: 37 },
    { h: '最低学历', k: 'base.edu', t: 'edu', w: 10, note: '只能填：不限、大专、本科、硕士、博士。新岗位留空 = 默认（本科）', ex: '本科' },
    { h: '最低经验', k: 'base.exp', t: 'numN', w: 10, note: '年数，留空不限', ex: 5 },
    { h: '芯片行业', k: 'base.chip', t: 'bool', w: 10, note: '是 / 否。是 = 过往公司里必须有芯片公司', ex: '是' },
    { h: '硬性要求', k: 'hardRequirements', t: 'list', w: 40, note: '基础条件之外、必须满足的要求，通常 1 到 3 条。多条用顿号或换行分隔，一条里用 | 表示有一个就行，如「人力资源|人事|HR」「期望职位：验证|DV」', ex: '人力资源|人事|HR' },
    { h: '加分项', k: 'optionalKeywords', t: 'list', w: 36, note: '不必满足，命中越多排序越靠前，多个用顿号分隔', ex: '绩效、薪酬、企业文化、招聘' },
    { h: '打招呼同智选', k: 'greet.same', t: 'bool', def: true, w: 12, note: '是 / 否。是 = 打招呼用上面同一套硬性要求和加分项，留空为是', ex: '是' },
    { h: '打招呼硬性要求', k: 'greet.hard', t: 'list', w: 30, note: '「打招呼同智选」填否时才用', ex: '' },
    { h: '打招呼加分项', k: 'greet.bonus', t: 'list', w: 26, note: '「打招呼同智选」填否时才用', ex: '' },
    { h: '加入智选', k: 'planEnabled', t: 'bool', w: 10, note: '是 / 否。今天智选要不要跑这个岗位', ex: '否' },
    { h: 'Boss智选上限', k: 'quota.bossScreen', t: 'int', w: 12, note: '每天最多点开并判定多少人，0 或留空不限', ex: '' },
    { h: '猎聘智选上限', k: 'quota.liepinScreen', t: 'int', w: 12, note: '0 或留空不限', ex: '' },
    { h: '打招呼开关', k: 'greet.enabled', t: 'bool', w: 10, note: '是 / 否', ex: '否' },
    { h: 'Boss打招呼上限', k: 'quota.bossGreet', t: 'int', w: 13, note: '0 或留空不限', ex: '' },
    { h: '猎聘打招呼上限', k: 'quota.liepinGreet', t: 'int', w: 13, note: '0 或留空不限', ex: '' },
    { h: '猎聘职位名', k: 'liepinJob', t: 'text', w: 22, note: '两边平台都发、猎聘上的名字和平台职位名不一样时填，留空 = 一样', ex: '' }
  ];
  var ALIAS = { '加入计划': 'planEnabled', '每日上限': 'quota.bossScreen', '智选每日上限': 'quota.bossScreen', '打招呼每日上限': 'quota.bossGreet', '打招呼芯片行业': 'base.chip' };
  // 支持「greet.hard」这种两层字段
  function getK(o, k) { var p = k.split('.'); var v = o; for (var i = 0; i < p.length; i++) { v = v == null ? undefined : v[p[i]]; } return v; }
  function setK(o, k, v) { var p = k.split('.'); var cur = o; for (var i = 0; i < p.length - 1; i++) { if (!cur[p[i]] || typeof cur[p[i]] !== 'object') cur[p[i]] = {}; cur = cur[p[i]]; } cur[p[p.length - 1]] = v; }
  var SHEET = '岗位JD';

  function norm(s) { return String(s == null ? '' : s).replace(/[\s【】[\]（）()·,，、/|:：-]+/g, '').toLowerCase(); }
  function hnorm(s) { return String(s == null ? '' : s).replace(/[\s（）()]/g, '').replace(/\*$/, '').toLowerCase(); }
  function str(v) { return v == null ? '' : String(v).trim(); }

  // ---------- 导出 ----------
  function cellOf(col, jd) {
    var v = getK(jd, col.k);
    switch (col.t) {
      case 'bool': return v ? '是' : '否';
      case 'list': return (v || []).join('、');
      case 'lines': return (v || []).join('\n');
      case 'edu': return EDU[v || 0] || '不限';
      case 'int': case 'num0': case 'numN': return v == null || v === '' ? '' : Number(v);
      default: return v == null ? '' : String(v);
    }
  }
  function lists() {
    return COLS.map(function (c, i) {
      if (c.t === 'bool') return { col: i, values: ['是', '否'] };
      if (c.t === 'edu') return { col: i, values: ['不限', '大专', '本科', '硕士', '博士'] };
      return null;
    }).filter(Boolean);
  }
  function guideSheet() {
    var rows = [['列名', '说明', '示例']];
    COLS.forEach(function (c) { rows.push([c.h, c.note || '', c.ex == null ? '' : c.ex]); });
    rows.push(['', '', '']);
    rows.push(['导入规则', '表里有的列以表为准，空单元格表示清空或用默认值。表里没有的列，系统里原来的值保留。', '']);
    rows.push(['对应规则', '先按「平台职位名」对应已有岗位，没填再按「JD标题」。对不上的作为新岗位新增。系统里有、表里没有的岗位不会被删除。', '']);
    return { name: '填写说明', rows: rows, widths: [18, 70, 36] };
  }
  /** 全部岗位 → sheets（交给 HRSXlsx.write） */
  function toSheets(jds) {
    var rows = [COLS.map(function (c) { return c.h; })];
    (jds || []).forEach(function (jd) { rows.push(COLS.map(function (c) { return cellOf(c, jd); })); });
    return [{ name: SHEET, rows: rows, widths: COLS.map(function (c) { return c.w; }), lists: lists() }, guideSheet()];
  }
  function templateSheets() {
    var rows = [COLS.map(function (c) { return c.h; }), COLS.map(function (c) { return c.ex == null ? '' : c.ex; })];
    return [{ name: SHEET, rows: rows, widths: COLS.map(function (c) { return c.w; }), lists: lists() }, guideSheet()];
  }

  // ---------- 导入 ----------
  function splitList(v) { return str(v).split(/[\n\r、,，;；]+/).map(function (x) { return x.trim(); }).filter(Boolean); }
  function splitLines(v) {
    return str(v).split(/[\n\r;；]+/).map(function (x) { return x.replace(/^\s*(\d+[.、)）]|[-•·*])\s*/, '').trim(); }).filter(Boolean);
  }
  function parseCell(col, raw, errs) {
    var s = str(raw);
    switch (col.t) {
      case 'text': return s;
      case 'list': return splitList(raw);
      case 'lines': return splitLines(raw);
      case 'bool':
        if (raw === true || raw === false) return raw;
        if (!s) return col.def != null ? col.def : false;
        if (/^(是|y|yes|true|1|启用|开|√)$/i.test(s)) return true;
        if (/^(否|n|no|false|0|停用|关|×)$/i.test(s)) return false;
        errs.push('「' + col.h + '」只能填 是 / 否，现在是「' + s + '」');
        return false;
      case 'edu': {
        if (!s) return 0;
        var e = s.replace(/及以上|以上|学历|毕业/g, '').replace(/^(硕士)?研究生$/, '硕士').replace(/^博士研究生$/, '博士').replace(/^专科$/, '大专').replace(/^中专$/, '高中');
        var i = EDU.indexOf(e);
        if (i >= 0) return i;
        if (/^[0-5]$/.test(s)) return parseInt(s, 10);
        errs.push('「最低学历」无法识别「' + s + '」，只能填：' + EDU.join('、'));
        return 0;
      }
      case 'int': case 'num0': case 'numN': {
        if (s === '') return col.t === 'numN' ? null : (col.t === 'num0' ? 0 : (col.def != null ? col.def : 0));
        var n = Number(s.replace(/[年万分人]/g, ''));
        if (!isFinite(n)) { errs.push('「' + col.h + '」应为数字，现在是「' + s + '」'); return col.t === 'numN' ? null : (col.def || 0); }
        return col.t === 'int' ? Math.round(n) : n;
      }
    }
    return s;
  }
  // 比较时把「没填」的各种写法看成一样：undefined、null、空串、空数组，布尔 false，计数类的 0
  function canon(col, v) {
    if (v == null || v === '' || (Array.isArray(v) && !v.length)) v = null;
    if (col.t === 'bool') return !!v;
    if (col.t === 'num0' || col.k === 'dailyQuota' || col.t === 'edu') return Number(v || 0);
    if (/^quota\./.test(col.k) && v == null) return 0;
    if (col.k === 'greet.same' && v == null) return true;
    if ((col.t === 'int') && v == null) return col.def != null ? col.def : 0;
    return v;
  }
  function same(col, a, b) { return JSON.stringify(canon(col, a)) === JSON.stringify(canon(col, b)); }

  /**
   * sheets（HRSXlsx.read 的结果）+ 现有岗位 → 预览
   * 返回 { items: [{ row, action: 'add'|'update'|'same'|'error', title, platformJob, errors, changes, data, targetId }], unknownCols, error }
   */
  function preview(sheets, jds) {
    var sh = (sheets || []).find(function (s) { return s.name === SHEET; }) || (sheets || [])[0];
    if (!sh || !sh.rows.length) return { error: '表格是空的', items: [] };
    // 找表头：前 5 行里第一个包含「JD标题」或「平台职位名」的行
    var hi = -1;
    for (var r = 0; r < Math.min(5, sh.rows.length); r++) {
      var hs = (sh.rows[r] || []).map(hnorm);
      if (hs.indexOf(hnorm('JD标题')) >= 0 || hs.indexOf(hnorm('平台职位名')) >= 0) { hi = r; break; }
    }
    if (hi < 0) return { error: '找不到表头。第一行要有「JD标题」或「平台职位名」列，可先下载模板对照', items: [] };
    var header = sh.rows[hi].map(str);
    var map = [], unknown = [];
    header.forEach(function (h, i) {
      if (!h) return;
      var col = COLS.find(function (c) { return hnorm(c.h) === hnorm(h) || (c.k === 'title' && hnorm(h) === hnorm('岗位名称')) || ALIAS[h] === c.k; });
      if (col) map[i] = col; else unknown.push(h);
    });
    var present = {};
    map.forEach(function (c) { if (c) present[c.k] = true; });
    var items = [], seenKeys = {};
    for (var ri = hi + 1; ri < sh.rows.length; ri++) {
      var row = sh.rows[ri] || [];
      if (!row.some(function (v) { return str(v) !== ''; })) continue;
      var errs = [], data = {};
      map.forEach(function (c, i) { if (c) data[c.k] = parseCell(c, row[i], errs); });
      var title = data.title || '', pj = data.platformJob || '';
      if (!title && !pj) { items.push({ row: ri + 1, action: 'error', title: '', platformJob: '', errors: ['「JD标题」和「平台职位名」都是空的'], changes: [] }); continue; }
      if (!title && present.title) errs.push('「JD标题」是空的');
      var key = data.greetJob ? 'g:' + norm(data.greetJob) : (pj ? 'p:' + norm(pj) + '|' + norm(title) : 't:' + norm(title));
      if (seenKeys[key]) errs.push('和第 ' + seenKeys[key] + ' 行是同一个岗位（' + (pj ? '平台职位名' : 'JD标题') + '重复）');
      seenKeys[key] = ri + 1;
      if (present.hardRequirements && !(data.hardRequirements || []).length) errs.push('「硬性要求」是空的，所有人都会判为合格');
      var gj = data.greetJob || '';
      var target = (jds || []).find(function (j) { return gj && norm(j.greetJob) === norm(gj); })
        || (!gj && (jds || []).find(function (j) { return pj && norm(j.platformJob) === norm(pj); }))
        || (jds || []).find(function (j) { return title && norm(j.title) === norm(title); });
      var changes = [];
      if (target) {
        COLS.forEach(function (c) { if (present[c.k] && !same(c, getK(target, c.k), data[c.k])) changes.push(c.h); });
      }
      items.push({
        row: ri + 1,
        action: errs.length ? 'error' : (target ? (changes.length ? 'update' : 'same') : 'add'),
        title: title || (target && target.title) || pj,
        platformJob: pj,
        errors: errs,
        changes: changes,
        data: data,
        targetId: target ? target.id : null
      });
    }
    return { items: items, unknownCols: unknown, present: present };
  }

  /** 把预览结果写回岗位列表（只应用 add / update，error 行跳过）。newId: 生成 id 的函数 */
  function apply(pv, jds, newId, baseDef) {
    var out = (jds || []).map(function (j) { return Object.assign({}, j); });
    var added = 0, updated = 0;
    pv.items.forEach(function (it) {
      if (it.action === 'add') {
        var j = { id: newId(), schema: 5, quota: { bossScreen: 0, liepinScreen: 0, bossGreet: 0, liepinGreet: 0 }, title: '未命名岗位', platformJob: '', greetJob: '', planEnabled: false, dailyQuota: 0, hardRequirements: [], optionalKeywords: [],
          base: { from: '', cities: '', ageMin: null, ageMax: null, edu: 0, exp: null, chip: false }, greet: { enabled: false, quota: 20, same: true } };
        if (baseDef) j.base = Object.assign({}, baseDef);
        // v1.9.23 新岗位：期望城市、年龄上限、最低学历留空 = 用默认值
        Object.keys(it.data).forEach(function (k) {
          var v = it.data[k];
          if (baseDef && /^base\.(cities|ageMax|edu)$/.test(k) && (v == null || v === '' || v === 0)) return;
          setK(j, k, v);
        });
        if (!j.title) j.title = j.platformJob || '未命名岗位';
        out.push(j); added++;
      } else if (it.action === 'update') {
        var t = out.find(function (x) { return x.id === it.targetId; });
        if (t) { Object.keys(it.data).forEach(function (k) { setK(t, k, it.data[k]); }); t.schema = 5; if (!t.title) t.title = t.platformJob || '未命名岗位'; updated++; }
      }
    });
    return { jds: out, added: added, updated: updated };
  }

  /** 发给 AI 的提示词 */
  function aiPrompt() {
    return [
      '请把我下面提供的岗位JD整理成一张 Excel 表（.xlsx 文件）。如果你不能直接生成文件，就输出一个可以整段复制粘贴到 Excel 的表格。',
      '',
      '要求：',
      '1. 第一行是列名，每个岗位一行。列名必须一字不差，按这个顺序：' + COLS.map(function (c) { return c.h; }).join(' | '),
      '2. 各列填写规则：',
      COLS.map(function (c) { return '   ' + c.h + '：' + c.note; }).join('\n'),
      '3. 基础条件放进对应列，不要写进硬性要求：期望城市、年龄上下限、最低学历、最低经验、芯片行业（JD 要求芯片、半导体、集成电路行业经验的填「是」）。不要写性别。默认值：期望城市「北京|上海」、年龄上限 40、最低学历本科，JD 没写不同要求时就填默认值。',
      '4. 硬性要求只放基础条件之外、不满足就不要的条件，通常 1 到 3 条，必须是简历里看得到的词，比如职能「人力资源|人事|HR」、期望职位「期望职位：验证|DV」。同一意思几种写法用 | 连起来。不要写「沟通能力强」「抗压」这类看不出来的要求。',
      '5. 加分项放 3 到 8 个具体的技能、工具或经历关键词。',
      '6. 不确定的单元格留空，不要编造。「平台职位名」「推荐页职位名」我没给就留空。「加入智选」「打招呼开关」填「否」。',
      '',
      '岗位JD如下：',
      '（在这里粘贴一个或多个岗位JD原文）'
    ].join('\n');
  }

  /** v1.6.0 抓取职位后生成给 AI 的表：第一个表是提示词，第二个表是职位原文 */
  function fetchSheets(jobs, jds) {
    var prompt = [
      '请根据本文件第二个工作表「职位原文」，为每个职位生成一行，输出一张 Excel 导入表（.xlsx）。不能生成文件就输出可整段复制到 Excel 的表格。',
      '',
      '1. 第一行列名必须一字不差，按这个顺序：' + COLS.map(function (c) { return c.h; }).join(' | '),
      '2. 「平台职位名」「推荐页职位名」从第二个工作表照抄，一个字都不要改。「JD标题」可以照抄平台职位名，同名职位在后面加城市，如「示例·人事主管」。',
      '3. 各列填写规则：',
      COLS.map(function (c) { return '   ' + c.h + '：' + c.note; }).join('\n'),
      '4. 基础条件放进对应列，不要写进硬性要求：期望城市、年龄上下限、最低学历、最低经验、芯片行业（JD 要求芯片、半导体、集成电路行业经验的填「是」）。不要写性别。默认值：期望城市「北京|上海」、年龄上限 40、最低学历本科，JD 没写不同要求时就填默认值。',
      '5. 硬性要求只放基础条件之外、不满足就不要的条件，通常 1 到 3 条，必须是简历里看得到的词，比如职能「人力资源|人事|HR」、期望职位「期望职位：验证|DV」。同一意思几种写法用 | 连起来。不要写「沟通能力强」「抗压」这类看不出来的要求。',
      '6. 加分项放 3 到 8 个具体的技能、工具或经历关键词。',
      '7. 「打招呼同智选」填「是」。「加入智选」「打招呼开关」填「否」，我自己开。',
      '8. 不确定的单元格留空，不要编造。'
    ];
    var guide = { name: 'AI提示词', rows: [['把这个文件整个发给 AI，让它按下面的要求生成导入表']].concat(prompt.map(function (x) { return [x]; })), widths: [140] };
    var have = {};
    (jds || []).forEach(function (j) { have[norm(j.greetJob || '') + '|' + norm(j.platformJob || j.title)] = j.title; have['p|' + norm(j.platformJob || '')] = j.title; });
    var rows = [['来源', '平台职位名', '推荐页职位名', '城市', '经验', '学历', '薪资', '标签', '系统里已有', 'JD原文']];
    (jobs || []).forEach(function (x) {
      var exist = have[norm(x.greetJob || '') + '|' + norm(x.title)] || '';
      rows.push([x.source === 'liepin' ? '猎聘' : 'Boss', x.title || '', x.greetJob || '', x.city || '', x.exp || '', x.edu || '', x.salary || '', (x.tags || []).join('、'), exist, x.jd || '']);
    });
    var src = { name: '职位原文', rows: rows, widths: [8, 24, 26, 10, 10, 8, 16, 30, 16, 90] };
    return [guide, src];
  }

  return { fetchSheets: fetchSheets, getK: getK, setK: setK, COLS: COLS, EDU: EDU, SHEET: SHEET, toSheets: toSheets, templateSheets: templateSheets, preview: preview, apply: apply, aiPrompt: aiPrompt };
});
