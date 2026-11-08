/**
 * HRSExtractor —— 从简历文本中提取结构化字段（纯逻辑，双端可用）
 * 输出字段：name, phone, email, gender, age, eduLevel, eduText, expYears, salaryMin, salaryMax(万/月),
 *          city, positions[], companies[], skills[], lines[], confidence
 */
(function (root, factory) {
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = factory();
  } else {
    root.HRSExtractor = factory();
  }
})(this, function () {
  'use strict';

  var EDU_LEVEL = { 初中: 1, 高中: 1, 中专: 2, 中技: 2, 职高: 2, 大专: 2, 本科: 3, 学士: 3, 硕士: 4, 研究生: 4, 博士: 5, 博士后: 5 };
  var EDU_TEXT = { 1: '高中', 2: '大专/中专', 3: '本科', 4: '硕士', 5: '博士' };

  var CITIES = ['北京', '上海', '广州', '深圳', '杭州', '南京', '成都', '武汉', '西安', '苏州', '长沙', '重庆', '天津', '郑州', '青岛', '厦门', '福州', '合肥', '宁波', '无锡', '济南', '兰州', '东莞', '佛山', '珠海', '昆明', '大连', '沈阳', '哈尔滨', '南昌', '南宁', '贵阳', '太原', '石家庄', '乌鲁木齐', '呼和浩特', '海口', '三亚', '西宁', '银川', '拉萨', '长春', '温州', '泉州', '常州', '徐州', '南通', '嘉兴', '绍兴', '台州', '金华', '烟台', '潍坊', '淄博', '洛阳', '襄阳', '宜昌'];

  function extract(text) {
    var s = String(text == null ? '' : text).replace(/\r/g, '\n');
    var fields = { name: null, phone: null, email: null, gender: null, age: null, eduLevel: null, eduText: null, expYears: null, salaryMin: null, salaryMax: null, salaryUnit: null, city: null, positions: [], companies: [], skills: [], rawText: s };
    var found = [];

    // 电话
    var phoneM = s.match(/1[3-9]\d[\s-]?\d{4}[\s-]?\d{4}/);
    if (phoneM) { fields.phone = phoneM[0].replace(/[\s-]/g, ''); found.push('phone'); }
    // 邮箱
    var emailM = s.match(/[\w.+-]+@[\w-]+(\.[\w-]+)+/);
    if (emailM) { fields.email = emailM[0]; found.push('email'); }
    // 性别
    var g = s.match(/(性别[：:]\s*)?(男|女)/);
    if (g && /性别/.test(g[0])) { fields.gender = g[2]; found.push('gender'); }
    else { var g2 = s.match(/^\s*(男|女)[，,、\s|]/m); if (g2) { fields.gender = g2[1]; found.push('gender'); } }
    // 年龄
    var ageM = s.match(/(\d{2})\s*岁/);
    if (ageM) { fields.age = parseInt(ageM[1], 10); found.push('age'); }

    // 学历（从高到低取第一个出现的）
    var eduRe = /(博士后|博士研究生|硕士|硕士研究生|研究生|本科|学士|大专|专科|中专|中技|职高|高中)/;
    var em = s.match(eduRe);
    if (em) {
      var key = em[1].replace('硕士研究生', '硕士').replace('博士研究生', '博士').replace('专科', '大专');
      var lv = null;
      Object.keys(EDU_LEVEL).forEach(function (k) { if (key.indexOf(k) >= 0) lv = EDU_LEVEL[k]; });
      if (lv) { fields.eduLevel = lv; fields.eduText = EDU_TEXT[lv]; found.push('edu'); }
    }

    // 经验年限
    var expRe = /(?:工作)?(?:经验|年限)[：:\s]*(\d{1,2})\s*年|(\d{1,2})\s*年(?:以上)?(?:的)?(?:工作)?经验/;
    var xm = s.match(expRe);
    if (xm) {
      var y = parseInt(xm[1] || xm[2], 10);
      if (y >= 0 && y <= 45) { fields.expYears = y; found.push('exp'); }
    }
    if (fields.expYears == null) {
      // 从日期区间推算：20XX-20XX / 20XX.XX-至今
      var dateRe = /(20\d{2})[.\-/年]?\d{0,2}[.\-/月]?\s*[-~至到]\s*(至今|现在|20\d{2})/g;
      var m, ranges = [];
      while ((m = dateRe.exec(s)) !== null) {
        var end = m[2] === '至今' || m[2] === '现在' ? new Date().getFullYear() : parseInt(m[2], 10);
        ranges.push(end - parseInt(m[1], 10));
      }
      if (ranges.length) { fields.expYears = Math.max.apply(null, ranges); found.push('exp'); }
    }

    // 期望薪资 → 万/月
    var sal = extractSalary(s);
    if (sal) { fields.salaryMin = sal.min; fields.salaryMax = sal.max; fields.salaryUnit = '万/月'; found.push('salary'); }

    // 城市（优先"现居/所在地/期望城市/城市"等标签后的词，其次全文城市表）
    var cityLabel = s.match(/(?:现居|居住地|所在地|期望城市|期望工作地|城市|工作城市)[：:]\s*([\u4e00-\u9fa5]{2,5})/);
    if (cityLabel) {
      var c = firstCity(cityLabel[1]);
      if (c) { fields.city = c; found.push('city'); }
    }
    if (!fields.city) {
      var head = s.slice(0, 600);
      var c2 = firstCity(head);
      if (c2) { fields.city = c2; found.push('city'); }
    }

    // 求职意向 / 期望职位
    var posM = s.match(/(?:求职意向|期望职位|意向岗位|应聘岗位|目标岗位|期望岗位)[：:]\s*([^\n，,。；;]{2,30})/);
    if (posM) { fields.positions.push(posM[1].trim()); found.push('position'); }
    var posM2 = s.match(/(?:职位|岗位)[：:]\s*([\u4e00-\u9fa5A-Za-z0-9/]{2,20})/);
    if (posM2 && fields.positions.length === 0) { fields.positions.push(posM2[1].trim()); found.push('position'); }

    // 公司（行内含"公司"且短于40字符，或"就职于/任职于/曾在"）
    var compRe = /(?:就职于|任职于|曾在|供职于)[：:]?\s*([\u4e00-\u9fa5A-Za-z0-9（）()·]{2,30}?)(?:担任|从事|，|,|。|$)/g;
    var cm;
    while ((cm = compRe.exec(s)) !== null && fields.companies.length < 6) {
      var cn = cm[1].trim();
      if (/公司/.test(cn) || /集团/.test(cn) || /科技/.test(cn) || /有限/.test(cn)) fields.companies.push(cn);
    }
    if (fields.companies.length === 0) {
      var compRe2 = /([\u4e00-\u9fa5A-Za-z0-9（）()·]{2,25}?(?:公司|集团|工作室|事务所|中心))(?=[\s，,。；;、]|$)/g;
      var cm2;
      while ((cm2 = compRe2.exec(s)) !== null && fields.companies.length < 6) {
        var cn2 = cm2[1].trim();
        if (!/职位|岗位|简历/.test(cn2) && fields.companies.indexOf(cn2) < 0) fields.companies.push(cn2);
      }
    }
    if (fields.companies.length) found.push('companies');

    // 技能：常见的技能词表（命中即记）
    var SKILLS = ['Java', 'Python', 'C语言', 'C++', 'C#', 'Go', 'Golang', 'JavaScript', 'TypeScript', 'Vue', 'React', 'Node.js', 'Spring', 'SpringBoot', 'MySQL', 'Redis', 'MongoDB', 'Kafka', 'Linux', 'Docker', 'Kubernetes', 'K8s', 'Git', '单片机', 'STM32', '嵌入式', 'ARM', 'FPGA', 'Verilog', 'PCB', 'Cortex', 'RTOS', 'FreeRTOS', 'ucos', 'Altium', 'PADS', 'Multisim', 'Keil', 'IAR', 'Candence', 'SolidWorks', 'CAD', 'UG', 'CATIA', 'ANSYS', 'MATLAB', 'Python爬虫', '机器学习', '深度学习', 'TensorFlow', 'PyTorch', 'Pandas', 'NumPy', '数据分析', 'Excel', 'SQL', 'Power BI', 'Tableau', 'SPSS', 'Photoshop', 'PS', 'Illustrator', 'Figma', 'PR', 'AE', 'CAD制图', '测试', '自动化测试', 'Selenium', 'JMeter', 'Postman', '接口测试', '功能测试', '硬件', '软件', '结构', '外观', '供应链', '采购', '销售', '市场', '运营', '客服', '招聘', 'HR', '猎头', '商务', '外贸', '英语', '六级', '四级'];
    var uniq = {};
    SKILLS.forEach(function (sk) {
      if (s.indexOf(sk) >= 0) { if (!uniq[sk]) { uniq[sk] = 1; fields.skills.push(sk); } }
    });
    if (fields.skills.length) found.push('skills');

    // 姓名：启发式（简历首行常见：姓名/中文2-4字，排除已知标签词）
    fields.name = guessName(s);
    if (fields.name) found.push('name');

    fields.confidence = found.length;
    fields.lines = s.split('\n').map(function (l) { return l.trim(); }).filter(Boolean).slice(0, 200);
    return fields;
  }

  function extractSalary(s) {
    // 1) 15-25万/年（年薪 → 折成月薪万）
    var mw = s.match(/(\d+(?:\.\d+)?)\s*[-~～至到]\s*(\d+(?:\.\d+)?)\s*万\s*[/／]?\s*年/);
    if (mw) return { min: Math.round(parseFloat(mw[1]) / 12 * 100) / 100, max: Math.round(parseFloat(mw[2]) / 12 * 100) / 100 };
    // 2) 15-25万（月薪万）
    var mw2 = s.match(/(\d+(?:\.\d+)?)\s*[-~～至到]\s*(\d+(?:\.\d+)?)\s*万/);
    if (mw2) return { min: parseFloat(mw2[1]), max: parseFloat(mw2[2]) };
    // 3) 20000-25000元/月
    var my = s.match(/(\d{4,6})\s*[-~～至到]\s*(\d{4,6})\s*元\s*[/／]\s*月/);
    if (my) return { min: Math.round(parseFloat(my[1]) / 10000 * 100) / 100, max: Math.round(parseFloat(my[2]) / 10000 * 100) / 100 };
    // 4) 20-25K / 20K-25K / 20K~25K（区间后紧跟K/k 才视为K单位）
    var kRe = /(\d+(?:\.\d+)?)\s*[Kk]?\s*[-~～至到]\s*(\d+(?:\.\d+)?)\s*[Kk]?/;
    var mk = s.match(kRe);
    if (mk) {
      var region = s.slice(mk.index, mk.index + mk[0].length + 2);
      if (/[Kk]/.test(region)) {
        return { min: Math.round(parseFloat(mk[1]) / 10 * 100) / 100, max: Math.round(parseFloat(mk[2]) / 10 * 100) / 100 };
      }
    }
    // 5) 单独 25K
    var single = s.match(/(\d+(?:\.\d+)?)\s*[Kk]/);
    if (single) { var v = parseFloat(single[1]) / 10; return { min: v, max: v }; }
    // 6) 单独 25万
    var singleW = s.match(/(\d+(?:\.\d+)?)\s*万/);
    if (singleW) { var vw = parseFloat(singleW[1]); return { min: vw, max: vw }; }
    return null;
  }

  function firstCity(str) {
    for (var i = 0; i < CITIES.length; i++) {
      if (str.indexOf(CITIES[i]) >= 0) return CITIES[i];
    }
    return null;
  }

  function guessName(s) {
    var lines = s.split('\n').map(function (l) { return l.trim(); }).filter(Boolean);
    for (var i = 0; i < Math.min(lines.length, 4); i++) {
      var l = lines[i];
      // 跳过明显非姓名的行（"姓名：XX" 除外，交给下方正则捕获）
      if (/^(简历|个人|求职|应聘|基本信息|教育|工作|项目|自我|联系方式|电话|手机|邮箱)/.test(l)) continue;
      var m = l.match(/^(?:姓\s*名[：:]\s*)?([\u4e00-\u9fa5]{2,4})(?:[，,、\s|]|$)/);
      if (m) {
        var n = m[1];
        if (/性别|女|男|岁/.test(n)) continue;
        if (/^(北京|上海|广州|深圳|重庆|成都|武汉|西安|杭州|南京|郑州|长沙|天津|青岛|沈阳|大连|兰州|苏州|无锡|宁波|合肥|福州|厦门|济南|哈尔滨|长春|南昌|昆明|贵阳|南宁|太原|石家庄|乌鲁木齐|呼和浩特|海口|三亚|西宁|银川|拉萨)$/.test(n)) continue;
        if (n.length >= 2 && !/信息|简历|求职/.test(n)) return n;
      }
    }
    return null;
  }

  return { extract: extract, extractSalary: extractSalary, EDU_LEVEL: EDU_LEVEL, EDU_TEXT: EDU_TEXT, CITIES: CITIES, guessName: guessName };
});
