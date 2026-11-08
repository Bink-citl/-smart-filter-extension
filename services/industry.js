/**
 * industry.js v1.5.0：从过往公司名判断是否芯片行业
 * 公司名来源：Boss 顶部简历摘要的工作经历行「2014.01-至今 某某公司 · 职位」
 * 规则：公司名包含任一识别词，且不包含排除词，就算芯片公司
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.HRSIndustry = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // v1.5.4 默认识别词（Judy 提供的名单，去重后保留原顺序）
  var DEFAULT_WORDS = ["半导体", "平头哥", "叩持", "海飞科", "浪潮", "华为", "芯片", "芯", "集成电路", "微电子", "微", "矽", "晶圆", "封测", "IC", "硅", "晶", "ASIC", "FPGA", "IP", "芯创", "芯源", "芯和", "芯动", "芯哲", "类比", "数模", "海思", "展锐", "韦尔", "豪威", "兆易", "澜起", "汇顶", "寒武纪", "地平线", "联发科", "瑞昱", "联咏", "圣邦", "思瑞浦", "纳芯", "华虹", "长江存储", "长鑫", "华大九天", "概伦", "新思科技", "楷登", "高通", "英特尔", "英伟达", "德州仪器", "亚德诺", "恩智浦", "瑞萨", "博通", "美光", "海光", "龙芯", "安森美", "英飞凌", "台积电", "格芯", "晶晨", "全志", "瑞芯微", "禾赛", "芯原", "格科", "复旦微", "贝岭", "昂宝", "艾为", "燧原", "酷芯", "卓胜", "聚辰", "思特威", "乐鑫", "灵动", "加特兰", "天数智芯", "兆芯", "安路", "普冉", "景略", "矽睿", "唯捷创芯", "黑芝麻", "赛昉", "芯华章", "雅创", "晶丰明源", "陆芯", "思立微", "麦歌恩", "锐迪科", "小华", "云途", "旗芯微", "芯旺", "琪埔维", "四维图新", "君正", "杰发", "杰开", "伏达", "中颖", "芯驰", "芯力特", "芯海", "帝奥微", "裕太微", "矽力杰", "国芯", "芯圣", "晟矽", "盛芯", "赛腾", "灿芯", "奕斯伟", "芯擎", "龙迅", "紫光", "曦华", "先楫", "宏晶", "旋智", "中科海芯", "辰至", "傅里叶", "格见构知", "意瑞", "朔集", "Synopsys", "Cadence", "Qualcomm", "Intel", "NVIDIA", "Broadcom", "MediaTek", "Infineon", "NXP", "Marvell", "Awinic", "Gcore", "Montage", "Ambarella", "Synthe", "芯创科技", "芯源微", "芯和半导体", "芯动科技", "芯哲微", "类比半导体", "数模混合", "华为海思", "紫光展锐", "上海韦尔半导体", "豪威（韦尔旗下）", "兆易创新", "澜起科技", "汇顶科技", "地平线机器人", "联发科技", "瑞昱半导体", "联咏科技", "圣邦微电子", "思瑞浦微电子", "纳芯微电子", "华虹半导体", "长鑫存储", "华大九天（EDA）", "概伦电子（EDA）", "Synopsys（新思）", "Cadence（楷登）", "TI", "ADI", "Renesas", "Micron", "海光信息", "龙芯中科", "onsemi", "TSMC", "GlobalFoundries", "晶晨股份", "全志科技", "禾赛科技", "芯原股份", "格科微", "复旦微电子集团", "上海贝岭", "昂宝电子", "上海艾为电子", "燧原科技", "酷芯微", "卓胜微电子", "聚辰半导体", "思特威（CMOS图像）", "乐鑫科技", "灵动微电子/灵动科技", "加特兰微", "兆芯集成电路", "安路科技", "普冉半导体", "景略半导体", "矽睿科技", "黑芝麻智能", "赛昉科技", "芯华章（EDA）", "雅创电子", "上海陆芯", "锐迪科（紫光）", "小华半导体", "苏州云途半导体", "苏州旗芯微半导体", "上海芯旺微电子", "上海琪埔维半导体", "北京四维图新科技", "北京君正集成电路", "合肥杰发科技（联发科系）", "武汉杰开科技（联发科系）", "北京伏达科技", "中颖电子", "南京芯驰半导体", "芯力特电子", "芯海科技（深圳）", "江苏帝奥微电子", "裕太微电子", "矽力杰半导体（杭州）", "苏州国芯科技", "上海芯圣电子", "上海晟矽微电子", "成都盛芯微科技", "安徽赛腾微电子", "灿芯半导体（上海）", "北京奕斯伟计算技术", "湖北芯擎科技", "龙迅半导体（合肥）", "紫光芯能/展锐系", "深圳曦华科技", "上海先楫半导体", "宏晶微电子", "旋智电子科技（上海）", "北京中科海芯科技", "北京辰至半导体", "上海傅里叶半导体", "上海格见构知半导体", "上海意瑞半导体", "上海朔集半导体", "迈威尔", "安霸"];
  // 「微」「晶」「硅」「芯」太宽，这些公司虽然带字但不是芯片公司
  var DEFAULT_EXCLUDE = ['微软', '微信', '微博', '微众', '微盟', '微医', '微店', '微创', '微播', '微念', '微拍', '微贷', '微梦', '晶科', '晶澳', '水晶', '晶华酒店', '硅谷', '芯意'];

  /**
   * 名单整理：去掉括号里的备注（如「华大九天（EDA）」「豪威（韦尔旗下）」），「/」两边各算一个词。
   * 4 个字母以内的英文词（IC、IP、TI、ADI、NXP）必须是独立单词才算，避免 Electric、VIP 被误判。
   */
  function prepWords(list) {
    var out = [];
    (list || []).forEach(function (w) {
      String(w || '').replace(/[（(][^）)]*[）)]/g, '').split(/[/／]/).forEach(function (x) {
        x = x.trim();
        if (x && out.indexOf(x) < 0) out.push(x);
      });
    });
    return out;
  }
  function wordHit(companyRaw, w) {
    if (/^[a-z0-9]{1,4}$/i.test(w)) {
      return new RegExp('(^|[^a-z0-9])' + w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '([^a-z0-9]|$)', 'i').test(companyRaw);
    }
    return norm(companyRaw).indexOf(norm(w)) >= 0;
  }

  function norm(s) { return String(s == null ? '' : s).replace(/\s+/g, '').toLowerCase(); }

  // 时间段：横杠有多种写法（- – — － ~ 至 到），中间可能有空格
  var DATE = '(?:19|20)\\d{2}(?:\\s*[.\\-/年]\\s*\\d{1,2}月?)?\\s*[-–—－‒―~～至到]\\s*(?:至今|今|现在|(?:19|20)\\d{2}(?:\\s*[.\\-/年]\\s*\\d{1,2}月?)?)';
  var SCHOOL = /(大学|学院|学校|中学|高中|职校|University|College)/i;
  // 只在括号外按「、，,」拆，避免把「GL中国(半导体/芯片)」拆碎
  function splitNames(seg) {
    var out = [], depth = 0, cur = '';
    for (var i = 0; i < seg.length; i++) {
      var ch = seg.charAt(i);
      if (ch === '(' || ch === '（') depth++;
      if (ch === ')' || ch === '）') depth = Math.max(0, depth - 1);
      if (depth === 0 && /[、,，;；]/.test(ch)) { out.push(cur); cur = ''; } else cur += ch;
    }
    out.push(cur);
    return out.map(function (c) { return c.replace(/[…]+$|\.{2,}$/, '').trim(); }).filter(Boolean);
  }
  function addCompany(out, c) {
    c = String(c || '').replace(/^(沟通职位|期望)[:：].*$/, '').trim();
    if (c && c.length <= 40 && !SCHOOL.test(c) && out.indexOf(c) < 0) out.push(c);
  }
  /** 公司名：先用插件从页面结构里直接取到的（lines），再从摘要文字里按时间段切 */
  function companiesOf(summary, lines) {
    var out = [];
    (lines || []).forEach(function (ln) {
      var head = String(ln || '').split(/\s*[·•]\s*/)[0];
      if (SCHOOL.test(ln)) return;
      // v1.9.7 猎聘时间段后面带时长「(3个月)」，一起去掉
      splitNames(head.replace(new RegExp('^\\s*' + DATE + '\\s*'), '').replace(/^[（(][^）)]*[）)]\s*/, '')).forEach(function (c) { addCompany(out, c); });
    });
    if (out.length) return out;
    var s = String(summary || '');
    var re = new RegExp(DATE, 'g');
    var marks = [], m;
    while ((m = re.exec(s)) !== null) marks.push({ start: m.index, end: m.index + m[0].length });
    marks.forEach(function (mk, i) {
      var seg = s.slice(mk.end, i + 1 < marks.length ? marks[i + 1].start : Math.min(s.length, mk.end + 80));
      seg = seg.split(/[·•|｜\n]/)[0].trim();
      if (!seg || SCHOOL.test(seg)) return;
      splitNames(seg).forEach(function (c) { addCompany(out, c); });
    });
    // 兜底：时间和公司分在两列时，按「公司 · 职位」的写法找
    if (!out.length) {
      s.split(/\n/).forEach(function (line) {
        var parts = line.split(/\s*[·•]\s*/);
        if (parts.length < 2 || SCHOOL.test(line) || /期望|沟通职位/.test(line)) return;
        splitNames(parts[0].replace(new RegExp(DATE, 'g'), '').slice(-40)).forEach(function (c) { addCompany(out, c); });
      });
    }
    return out;
  }

  /** → { known: bool, chip: bool, companies: [], hit: '公司名', word: '识别词' } */
  function judge(summary, words, exclude, lines) {
    var cs = companiesOf(summary, lines);
    var ws = prepWords(words && words.length ? words : DEFAULT_WORDS);
    var ex = prepWords(exclude && exclude.length ? exclude : DEFAULT_EXCLUDE).map(norm).filter(Boolean);
    for (var i = 0; i < cs.length; i++) {
      var c = norm(cs[i]);
      if (ex.some(function (e) { return c.indexOf(e) >= 0; })) continue;
      for (var j = 0; j < ws.length; j++) {
        if (wordHit(cs[i], ws[j])) return { known: true, chip: true, companies: cs, hit: cs[i], word: ws[j] };
      }
    }
    return { known: cs.length > 0, chip: false, companies: cs };
  }

  return { prepWords: prepWords, DEFAULT_WORDS: DEFAULT_WORDS, DEFAULT_EXCLUDE: DEFAULT_EXCLUDE, companiesOf: companiesOf, judge: judge };
});
