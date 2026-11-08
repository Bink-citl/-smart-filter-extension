/**
 * HRSStore —— 设置(chrome.storage.local) + 人才库/事件(IndexedDB)
 * 浏览器端专用。数据全部保存在本地，不向任何服务器上传。
 */
(function (root, factory) {
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = factory(null);
  } else {
    root.HRSStore = factory(chrome);
  }
})(this, function (chromeRef) {
  'use strict';

  var DEFAULT_SETTINGS = {
    version: 8,
    // 运行模式由 masterEnabled + dryRun 组合表示：停止=false/* | 试运行=true/true | 正式运行=true/false
    masterEnabled: true,          // 总开关
    dryRun: true,                 // 试运行：仅判定不动手（首次安装默认开启）
    paceSec: 20,                  // v1.2.0 筛选节拍：每处理一个候选人占用多少秒（从打开会话起算）
    paceJitter: true,
    baseDefaults: { cities: '北京|上海', ageMax: null, edu: 3 },
    ai: { on: false, url: '', model: '', key: '' },   // v1.9.27 AI 判断接口（OpenAI 兼容）   // v1.9.23 新岗位默认基础条件：北京|上海、40 岁以下、本科及以上
    chipWords: null,              // v1.5.0 芯片公司识别词，null = 用内置名单
    chipExclude: null,            // v1.5.0 带「微」「芯」但不是芯片公司的排除词
    smartUnreadFirst: true,       // v1.8.1 智选先处理「未读」，再处理「全部」
    greetMode: 'stop',            // v1.6.0 打招呼：stop 停止 / dry 试运行 / live 正式运行
    greetPaceSec: 45,             // v1.6.0 打招呼节拍（秒/个），默认比沟通筛选慢
    greetDailyCap: 180,           // v1.6.0 打招呼每日总上限（v3.6.0 默认 180，见下方 v8 迁移）
    greetPlatformFilter: true,
    greetTrustedClick: true,
    bossExec: 'rpa',              // v1.9.48 Boss 打招呼 + 智选的执行方式：rpa 本机 RPA 助手（真实鼠标键盘）/ script 旧版（脚本点击 + 调试器真实点击）
    rpaPort: 17861,               // v1.9.48 RPA 助手端口（只监听 127.0.0.1）
    rpaSpeed: 1,                  // v1.9.48 鼠标和打字速度倍数：0.7 慢 / 1 正常 / 1.4 快
    rpaIdleSec: 8,                // v1.9.48 你停手多少秒后 RPA 才接手鼠标
    // v2.3.0 拟人操作节奏（services/rhythm.js）：动作间随机停顿、偶尔犹豫、节拍浮动、每几人小憩、速度浮动
    rhythm: { on: true, gapMin: 0.4, gapMax: 1.8, hesitatePct: 12, hesitateMin: 2, hesitateMax: 5, paceVar: 30, breakEveryMin: 6, breakEveryMax: 12, breakMin: 30, breakMax: 90, speedVar: 25, typePause: true },
    schedule: { enabled: false, startAt: '00:00', order: 'greet-screen', greetMode: 'live', screenMode: 'live', autoOpen: true },   // v1.8.0 计划任务      // v1.7.6 脚本点击没反应时，用真实鼠标点击    // v1.7.5 切换岗位时按基础条件设置 Boss 自带筛选（经验、学历）
    planWindowOn: false,          // v1.3.0 今日计划：是否限定执行时段
    planStart: '09:00',
    planEnd: '18:00',             // 节拍加 0~20% 随机浮动，降低固定频率被风控识别的概率
    activeJdId: null,             // 当前启用的JD
    company: '示例科技（Example Tech）',
    position: '示例·嵌入式软件工程师',
    // 自动化动作
    autoReject: true,             // 是否自动处理不合格简历
    rejectMode: 'chat',           // chat=打开会话发拒绝话术+已读 | read=仅已读 | skip=只记录不动手
    rejectTapInappropriate: true, // 拒绝时同步点击网页端「不合适」按钮（可在平台该栏目查看到）
    autoRequest: true,            // 合格者自动索要简历/发沟通话术
    autoMarkRead: true,           // 打开会话后自动已读
    rateLimitSec: 20,             // 每个候选人动作间隔（防风控）
    dailyCap: 0,                  // 每日自动动作上限（v1.9.1 起默认不限）
    confirmHighRisk: false,       // v1.1.0 默认自动执行；可在设置中重新开启人工确认
    scopeToActiveJd: true,        // 只处理当前岗位JD对应职位的候选人（不跨岗位乱筛）
    onlyUnrepliedCandidateMessages: true, // 只处理最后一条由候选人发出且我尚未回复的会话
    showPageOverlay: true,        // 页面右下角工作痕迹浮层（引擎状态+动作日志）
    showCardBadge: true,          // 候选人卡片判定角标（通过/拒绝/待复核+得分）
    // 导出
    exportFolder: 'HR人才库',
    exportFormat: 'pdf+docx',     // pdf | docx | pdf+docx（人才库简历文件导出格式）
    autoExportPass: false,        // 判定通过时不生成占位JSON；以候选人回传PDF为准
    resumeAutoSave: true,         // 自动保存候选人发来的 PDF
    exportByJd: true,             // 按岗位JD自动建子文件夹（根目录/岗位JD/姓名_简历.json）
    exportToCustomDir: false,     // 是否导出到自定义根目录（File System Access API，用户授权目录）
    // 站点
    siteConfig: null,             // 覆盖用选择器（null=使用默认）
    // 话术
    scripts: {
      rejection: '您好，感谢您投递【{company}】的【{position}】岗位。经过综合评估，您的经历与该岗位当前要求匹配度有限，暂不考虑推进，祝您找到更合适的岗位，前程似锦！',
      request: '您好！我是【{company}】HR，看到您的简历与我们的【{position}】岗位很契合，想邀请您进一步沟通，方便的话可以交换一下在线简历吗？',
      contact: '您好，我是【{company}】的HR，正在招聘【{position}】。请问您目前是在职看机会还是已离职？期望薪资和到岗时间大概是怎样的呢？',
      interviewQuestions: '1. 请简单做下自我介绍，重点介绍与【{position}】相关的项目经验。\n2. 你上一份工作的离职原因是什么？\n3. 期望薪资是多少？最快到岗时间？\n4. 有没有我们岗位相关的作品/项目可以展示？',
      followup: '感谢您的回复！方便的话我们约个时间电话/视频沟通一下？',
      interview: '{name}您好，感谢您对【{company}】【{position}】岗位的关注。我们想邀请您参加面试，请问您这周哪个时间段方便？线上或到公司面试都可以。'
    },
    // v3.6.0 合规（设置 · 合规）
    rejectConfirm: true,          // 智选判不合格：先放进「待确认拒绝」，HR 点确认才发拒绝话术 / 点不合适
    decisionDays: 90,             // 自动决定明细保留天数（每月汇总不含个人信息，保留 3 年）
    retention: { on: true, rejectDays: 180, resumeDays: 365 },   // 人才库保留期限：不合适 / 没沟通 180 天，收到简历未面试 1 年，面试 / 录用不自动删
    aiDailyCap: 200,              // AI 判断每天最多调用几次（0 = 不限）
    aiRedact: true,               // 发给 AI 前去掉姓名、电话、邮箱、微信、证件号
    pia: { version: '', approvedAt: '', approver: '', nextReview: '', note: '' },   // 个人信息影响评估登记
    backupAuto: false,            // 每天自动做一份加密备份
    selectorConfigUrl: '',        // 远程选择器配置地址（平台改版时管理员更新一处，大家每天自动拿到）
    evalGuides: {},               // 评测集：每个岗位的打标说明 { 岗位名: 说明 }
    // 诊断/自愈
    diagMode: false,              // 页面诊断模式（高亮卡片并展示提取结果）
    lastHealthCheck: 0
  };

  // ---------- 设置 ----------
  var settingsCache = null;
  function getSettings(fresh) {
    if (!fresh && settingsCache) return Promise.resolve(settingsCache);
    return loadSettings();
  }
  function loadSettings() {
    return new Promise(function (resolve) {
      chromeRef.storage.local.get('settings', function (obj) {
        var raw = obj.settings || {};
        var s = deepMerge(JSON.parse(JSON.stringify(DEFAULT_SETTINGS)), raw);
        // v3 迁移：旧配置升级后直接进入自动发送，避免总开关未开或确认弹窗卡住。
        if (!raw.version || raw.version < 3) {
          s.masterEnabled = true;
          s.confirmHighRisk = false;
        }
        // v4 迁移（v1.2.0 简化设置）：界面上已移除的开关固定为安全默认值，避免旧值藏在后台改不回来。
        if (!raw.version || raw.version < 4) {
          s.version = 4;
          if (raw.paceSec == null) s.paceSec = clampPace(raw.rateLimitSec || 20);
          s.scopeToActiveJd = true;
          s.onlyUnrepliedCandidateMessages = true;
          s.showPageOverlay = true;
          s.showCardBadge = true;
          s.exportByJd = true;
          s.confirmHighRisk = false;
          chromeRef.storage.local.set({ settings: s });
        }
        // v5 迁移（v1.5.4）：公司名占位符换成默认值。芯片识别词如果自己存过，把新的默认词补进去
        if (!raw.version || raw.version < 5) {
          s.version = 5;
          if (!s.company || s.company === 'XX科技有限公司') s.company = '示例科技（Example Tech）';
          var IND = (typeof self !== 'undefined' && self.HRSIndustry) || (typeof window !== 'undefined' && window.HRSIndustry) || null;
          if (Array.isArray(s.chipWords) && IND) {
            IND.DEFAULT_WORDS.forEach(function (w) { if (s.chipWords.indexOf(w) < 0) s.chipWords.push(w); });
          }
          chromeRef.storage.local.set({ settings: s });
        }
        // v7 迁移（v1.9.1）：不再设每日动作上限
        if (raw.version < 7) { s.version = 7; s.dailyCap = 0; chromeRef.storage.local.set({ settings: s }); }
        // v6 迁移（v1.7.8）：芯片识别词新增默认词，自己存过名单的也补进去
        if (raw.version < 6) {
          s.version = 6;
          var IND6 = (typeof self !== 'undefined' && self.HRSIndustry) || (typeof window !== 'undefined' && window.HRSIndustry) || null;
          if (Array.isArray(s.chipWords) && IND6) IND6.DEFAULT_WORDS.forEach(function (w) { if (s.chipWords.indexOf(w) < 0) s.chipWords.push(w); });
          chromeRef.storage.local.set({ settings: s });
        }
        // v8 迁移（v3.6.0）：打招呼每日总上限默认 180。原来是旧默认值 50 或内置岗位带来的 200 的，改成 180，只改一次
        if (!(raw.version >= 8)) {
          s.version = 8;
          var cap8 = capMigrate(raw.greetDailyCap);
          if (cap8.changed) { s.greetDailyCap = cap8.to; s.greetCapMigrated = { from: cap8.from, to: cap8.to, at: Date.now() }; }
          chromeRef.storage.local.set({ settings: s });
        }
        s.paceSec = clampPace(s.paceSec);
        settingsCache = s;
        resolve(s);
      });
    });
  }
  // 设置被任何页面/后台修改时，失效本地缓存，避免读到旧值（修复"改完设置自检仍报错"类问题）
  if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.onChanged) {
    chrome.storage.onChanged.addListener(function (ch, area) {
      if (area === 'local' && ch.settings) settingsCache = null;
    });
  }
  // v1.9.46 Boss / 猎聘 的运行模式各自独立：siteMode.boss / siteMode.liepin 各存一份智选（masterEnabled、dryRun）和打招呼（greetMode）
  var MODE_KEYS = ['masterEnabled', 'dryRun', 'greetMode'];
  function siteView(s, site) {
    var v = Object.assign({}, s || {});
    var m = v.siteMode && site && v.siteMode[site];
    if (m) MODE_KEYS.forEach(function (k) { if (m[k] !== undefined) v[k] = m[k]; });
    return v;
  }
  function saveSettings(patch) {
    return getSettings().then(function (s) {
      patch = Object.assign({}, patch || {});
      var site = patch.__site; delete patch.__site;
      var touched = MODE_KEYS.filter(function (k) { return k in patch; });
      if (touched.length) {
        var sm = JSON.parse(JSON.stringify(s.siteMode || {}));
        ['boss', 'liepin'].forEach(function (k) { if (!sm[k]) sm[k] = { masterEnabled: !!s.masterEnabled, dryRun: s.dryRun !== false, greetMode: s.greetMode || 'stop' }; });
        (site ? [site] : ['boss', 'liepin']).forEach(function (k) { touched.forEach(function (m) { sm[k][m] = patch[m]; }); });
        if (site) touched.forEach(function (m) { delete patch[m]; });
        patch.siteMode = sm;
      }
      Object.keys(patch || {}).forEach(function (k) { s[k] = patch[k]; });
      settingsCache = s;
      return new Promise(function (resolve) {
        chromeRef.storage.local.set({ settings: s }, function () { resolve(s); });
      });
    });
  }
  /**
   * v1.4.0 岗位条件简化为「硬性要求 + 加分项」。旧数据一次性迁移：
   * 硬性要求保留，并入最低学历（如「本科」）和最低经验（如「5年以上」）
   * 必备关键词并入加分项。其他旧字段原样留在数据里，但不再参与判定。
   */
  var EDU_NAMES = ['', '高中', '大专', '本科', '硕士', '博士'];
  var CHIP_ALTS = ['半导体', '芯片', '集成电路', '微电子', '芯', 'ic'];
  function migrateJd(j) {
    if (!j) return false;
    if (j.schema === 4) {
      // v1.9.0 上限按平台分开，默认不限。原来打招呼默认 20 的当作没设
      var gq = j.greet && parseInt(j.greet.quota, 10) > 0 && parseInt(j.greet.quota, 10) !== 20 ? parseInt(j.greet.quota, 10) : 0;
      var dq = parseInt(j.dailyQuota, 10) > 0 ? parseInt(j.dailyQuota, 10) : 0;
      j.quota = Object.assign({ bossScreen: dq, liepinScreen: dq, bossGreet: gq, liepinGreet: 0 }, j.quota || {});
      j.schema = 5;
      return true;
    }
    if (j.schema >= 5) return false;
    if (j.schema !== 3) migrateV3(j);
    // v1.7.0：芯片行业移到基础条件；打招呼原来单独填过条件的，保留为「单独一套」
    if (!j.base) j.base = { from: '', cities: '', ageMin: null, ageMax: null, edu: 0, exp: null, chip: !!j.requireChip };
    j.greet = j.greet || {};
    if (j.greet.same == null) j.greet.same = !((j.greet.hard && j.greet.hard.length) || (j.greet.bonus && j.greet.bonus.length));
    j.schema = 4;
    migrateJd(j);
    return true;
  }
  function migrateV3(j) {
    if (j.schema !== 2) migrateV2(j);
    // v1.5.0：硬性要求里只写行业词的那一行（如「半导体|芯片|集成电路」）改成勾选「芯片行业」
    j.hardRequirements = (j.hardRequirements || []).filter(function (line) {
      var alts = String(line).split(/\s*(?:\||｜|或)\s*/).map(function (x) { return x.trim().toLowerCase(); }).filter(Boolean);
      var chipOnly = alts.length && alts.every(function (x) { return CHIP_ALTS.indexOf(x) >= 0; });
      if (chipOnly) j.requireChip = true;
      return !chipOnly;
    });
    j.schema = 3;
  }
  function migrateV2(j) {
    var hard = (j.hardRequirements || []).slice();
    if (j.minEdu >= 2 && EDU_NAMES[j.minEdu] && hard.indexOf(EDU_NAMES[j.minEdu]) < 0) hard.push(EDU_NAMES[j.minEdu]);
    if (j.minExpYears > 0) hard.push(j.minExpYears + '年以上');
    var bonus = [];
    (j.mustKeywords || []).concat(j.optionalKeywords || []).forEach(function (k) { if (k && bonus.indexOf(k) < 0 && hard.indexOf(k) < 0) bonus.push(k); });
    j.hardRequirements = hard;
    j.optionalKeywords = bonus;
    j.schema = 2;
  }
  function getJds() {
    return new Promise(function (resolve) {
      chromeRef.storage.local.get('jds', function (obj) {
        var jds = obj.jds || [];
        var changed = false;
        jds.forEach(function (j) { if (migrateJd(j)) changed = true; });
        if (changed) chromeRef.storage.local.set({ jds: jds }, function () { resolve(jds); });
        else resolve(jds);
      });
    });
  }
  function saveJds(jds) {
    return new Promise(function (resolve) {
      chromeRef.storage.local.set({ jds: jds }, function () { resolve(jds); });
    });
  }
  function getActiveJd() {
    return Promise.all([getJds(), getSettings()]).then(function (r) {
      var jds = r[0], s = r[1];
      if (!s.activeJdId) return null;
      return jds.find(function (j) { return j.id === s.activeJdId; }) || null;
    });
  }

  // ---------- IndexedDB ----------
  var DB_NAME = 'hrscreener', DB_VER = 2;   // v3.6.0 加 decisions 表（自动决定记录）
  var dbPromise = null;
  function openDb() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise(function (resolve, reject) {
      var req = indexedDB.open(DB_NAME, DB_VER);
      req.onupgradeneeded = function (e) {
        var db = e.target.result;
        if (!db.objectStoreNames.contains('candidates')) {
          var st = db.createObjectStore('candidates', { keyPath: 'id' });
          st.createIndex('verdict', 'verdict');
          st.createIndex('source', 'source');
          st.createIndex('jdId', 'jdId');
          st.createIndex('seenAt', 'seenAt');
        }
        if (!db.objectStoreNames.contains('events')) {
          var st2 = db.createObjectStore('events', { keyPath: 'id', autoIncrement: true });
          st2.createIndex('ts', 'ts');
          st2.createIndex('type', 'type');
        }
        if (!db.objectStoreNames.contains('decisions')) {
          var st3 = db.createObjectStore('decisions', { keyPath: 'id', autoIncrement: true });
          st3.createIndex('ts', 'ts');
          st3.createIndex('name', 'name');
        }
      };
      req.onsuccess = function (e) {
        var db = e.target.result;
        // 插件升级时别的页面要升级数据库：这里让出连接，下次用时重新打开
        db.onversionchange = function () { try { db.close(); } catch (x) {} dbPromise = null; };
        resolve(db);
      };
      req.onerror = function (e) { dbPromise = null; reject(e); };
    });
    return dbPromise;
  }
  function tx(store, mode, fn) {
    return openDb().then(function (db) {
      return new Promise(function (resolve, reject) {
        var t = db.transaction(store, mode);
        var s = t.objectStore(store);
        var out = fn(s);
        t.oncomplete = function () { resolve(out && out.result !== undefined ? out.result : undefined); };
        t.onerror = function () { reject(t.error); };
        t.onabort = function () { reject(t.error || new Error('abort')); };
      });
    });
  }

  function addCandidate(c) {
    c.id = c.id || 'c_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8);
    c.seenAt = c.seenAt || Date.now();
    c.updatedAt = Date.now();
    return tx('candidates', 'readwrite', function (s) {
      var get = s.get(c.id);
      get.onsuccess = function () {
        if (get.result) { s.put(Object.assign(get.result, c, { updatedAt: Date.now() })); }
        else { s.put(c); }
      };
      return get;
    });
  }
  function getCandidate(id) {
    return tx('candidates', 'readonly', function (s) { return s.get(id); });
  }
  function updateCandidate(id, patch) {
    return tx('candidates', 'readwrite', function (s) {
      var g = s.get(id);
      g.onsuccess = function () {
        if (g.result) s.put(Object.assign(g.result, patch, { updatedAt: Date.now() }));
      };
      return g;
    });
  }
  function deleteCandidate(id) {
    return tx('candidates', 'readwrite', function (s) { return s.delete(id); });
  }
  function getAllCandidates() {
    return tx('candidates', 'readonly', function (s) { return s.getAll(); }).then(function (r) {
      if (!r) { // 兼容：部分实现需手动
        return openDb().then(function (db) {
          return new Promise(function (res) {
            var t = db.transaction('candidates', 'readonly');
            var req = t.objectStore('candidates').getAll();
            req.onsuccess = function () { res(req.result); };
          });
        });
      }
      return r;
    });
  }
  function addEvent(ev) {
    ev.ts = ev.ts || Date.now();
    return tx('events', 'readwrite', function (s) { return s.add(ev); }).catch(function () { return null; });
  }
  function getEvents(limit, type) {
    return openDb().then(function (db) {
      return new Promise(function (resolve) {
        var t = db.transaction('events', 'readonly');
        var idx = type ? t.objectStore('events').index('type') : t.objectStore('events').index('ts');
        var req = idx.openCursor(null, 'prev');
        var out = [];
        req.onsuccess = function () {
          var cur = req.result;
          if (cur && out.length < (limit || 200)) {
            if (!type || cur.value.type === type) out.push(cur.value);
            cur.continue();
          } else resolve(out);
        };
        req.onerror = function () { resolve(out); };
      });
    });
  }

  // ---------- v3.6.0 自动决定记录（services/decision-log.js 整理格式） ----------
  function addDecisions(list) {
    if (!list || !list.length) return Promise.resolve(0);
    return tx('decisions', 'readwrite', function (s) { list.forEach(function (d) { delete d.id; s.add(d); }); return null; }).then(function () { return list.length; });
  }
  /** q: { name, cid, jdId, since, until, limit }，新到旧 */
  function getDecisions(q) {
    q = q || {};
    return openDb().then(function (db) {
      return new Promise(function (resolve) {
        var t = db.transaction('decisions', 'readonly'), st = t.objectStore('decisions');
        var useName = !!q.name;
        var req = useName ? st.index('name').openCursor(IDBKeyRange.only(q.name), 'prev') : st.index('ts').openCursor(q.since ? IDBKeyRange.lowerBound(q.since) : null, 'prev');
        var out = [], lim = q.limit || 500;
        req.onsuccess = function () {
          var cur = req.result;
          if (!cur || out.length >= lim) { resolve(useName ? out.sort(function (a, b) { return b.ts - a.ts; }) : out); return; }
          var v = cur.value;
          var ok = (!q.jdId || v.jdId === q.jdId) && (!q.cid || !v.cid || v.cid === q.cid) && (!q.since || v.ts >= q.since) && (!q.until || v.ts <= q.until);
          if (ok) out.push(v);
          cur.continue();
        };
        req.onerror = function () { resolve(out); };
      });
    });
  }
  /** 删掉 ts 早于 before 的记录（store：decisions / events）。返回删了几条 */
  function purgeBefore(store, before) {
    return openDb().then(function (db) {
      return new Promise(function (resolve) {
        var n = 0, t = db.transaction(store, 'readwrite');
        var req = t.objectStore(store).index('ts').openCursor(IDBKeyRange.upperBound(before, true));
        req.onsuccess = function () { var cur = req.result; if (cur) { cur.delete(); n++; cur.continue(); } };
        t.oncomplete = function () { resolve(n); };
        t.onerror = function () { resolve(n); };
      });
    });
  }
  /** 按条件删记录（按要求删除某个人时用）。match(v) 返回 true 的删掉 */
  function purgeWhere(store, match) {
    return openDb().then(function (db) {
      return new Promise(function (resolve) {
        var n = 0, t = db.transaction(store, 'readwrite');
        var req = t.objectStore(store).openCursor();
        req.onsuccess = function () { var cur = req.result; if (cur) { if (match(cur.value)) { cur.delete(); n++; } cur.continue(); } };
        t.oncomplete = function () { resolve(n); };
        t.onerror = function () { resolve(n); };
      });
    });
  }
  /** 整表读（备份用） */
  function getAll(store) {
    return openDb().then(function (db) {
      return new Promise(function (resolve) {
        var req = db.transaction(store, 'readonly').objectStore(store).getAll();
        req.onsuccess = function () { resolve(req.result || []); };
        req.onerror = function () { resolve([]); };
      });
    });
  }
  /** 一次写入多条（恢复备份、合并同一个人时用）。clear=true 先清空 */
  function putAll(store, list, clear) {
    return tx(store, 'readwrite', function (s) {
      if (clear) s.clear();
      (list || []).forEach(function (x) { s.put(x); });
      return null;
    });
  }

  // ---------- 工具 ----------
  function deepMerge(base, over) {
    if (over == null) return base;
    var out = JSON.parse(JSON.stringify(base));
    Object.keys(over).forEach(function (k) {
      var v = over[k];
      if (v && typeof v === 'object' && !Array.isArray(v) && base[k] && typeof base[k] === 'object' && !Array.isArray(base[k])) {
        out[k] = deepMerge(base[k], v);
      } else {
        out[k] = v;
      }
    });
    return out;
  }
  // v3.6.0 打招呼每日总上限：默认 180，界面上超过 180 会提示，但不拦
  var GREET_CAP = 180;
  function capMigrate(v) {
    var n = parseInt(v, 10);
    if (v == null || v === '' || !isFinite(n)) return { changed: false, to: GREET_CAP };
    if (n === 200 || n === 50) return { changed: true, from: n, to: GREET_CAP };
    return { changed: false, to: n };
  }
  var PACE_MIN = 3, PACE_MAX = 600;
  function clampPace(v) {
    var n = parseInt(v, 10);
    if (!isFinite(n)) n = 20;
    return Math.min(PACE_MAX, Math.max(PACE_MIN, n));
  }
  function uid() { return 'j_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6); }

  // ---------- 导出目录句柄（File System Access API，持久授权） ----------
  var IDB_NAME = 'hrs-fs', IDB_STORE = 'handles';
  function idb() {
    return new Promise(function (resolve, reject) {
      if (typeof indexedDB === 'undefined') { reject(new Error('当前环境不支持IndexedDB')); return; }
      var req = indexedDB.open(IDB_NAME, 1);
      req.onupgradeneeded = function () { req.result.createObjectStore(IDB_STORE); };
      req.onsuccess = function () { resolve(req.result); };
      req.onerror = function () { reject(req.error); };
    });
  }
  function saveDirHandle(handle) {
    return idb().then(function (db) {
      return new Promise(function (resolve, reject) {
        var tx = db.transaction(IDB_STORE, 'readwrite');
        tx.objectStore(IDB_STORE).put(handle, 'exportRoot');
        tx.oncomplete = function () { resolve(true); };
        tx.onerror = function () { reject(tx.error); };
      });
    });
  }
  function getDirHandle() {
    return idb().then(function (db) {
      return new Promise(function (resolve, reject) {
        var tx = db.transaction(IDB_STORE, 'readonly');
        var req = tx.objectStore(IDB_STORE).get('exportRoot');
        req.onsuccess = function () { resolve(req.result || null); };
        req.onerror = function () { reject(req.error); };
      });
    });
  }

  // v1.9.23 新岗位的基础条件：按设置里的默认值；平台给的城市并进去，平台给的学历优先
  function newBase(settings, fromPlatform) {
    var d = (settings && settings.baseDefaults) || DEFAULT_SETTINGS.baseDefaults;
    var fp = fromPlatform || {};
    var cities = String(d.cities || '').split('|').concat(String(fp.cities || '').split('|')).map(function (x) { return x.trim(); }).filter(Boolean);
    cities = cities.filter(function (x, i) { return cities.indexOf(x) === i; });
    return { from: '', cities: cities.join('|'), ageMin: null, ageMax: d.ageMax != null && d.ageMax !== '' ? Number(d.ageMax) : null,
      edu: fp.edu ? fp.edu : (Number(d.edu) || 0), exp: fp.exp != null ? fp.exp : null, chip: false };
  }

  return {
    newBase: newBase,
    DEFAULT_SETTINGS: DEFAULT_SETTINGS,
    PACE_MIN: PACE_MIN,
    GREET_CAP: GREET_CAP,
    capMigrate: capMigrate,
    PACE_MAX: PACE_MAX,
    clampPace: clampPace,
    migrateJd: migrateJd,
    getSettings: getSettings,
    loadSettings: loadSettings,
    saveSettings: saveSettings,
    siteView: siteView,
    getJds: getJds,
    saveJds: saveJds,
    getActiveJd: getActiveJd,
    addCandidate: addCandidate,
    getCandidate: getCandidate,
    updateCandidate: updateCandidate,
    deleteCandidate: deleteCandidate,
    getAllCandidates: getAllCandidates,
    addEvent: addEvent,
    getEvents: getEvents,
    addDecisions: addDecisions,
    getDecisions: getDecisions,
    purgeBefore: purgeBefore,
    purgeWhere: purgeWhere,
    getAll: getAll,
    putAll: putAll,
    uid: uid,
    deepMerge: deepMerge,
    saveDirHandle: saveDirHandle,
    getDirHandle: getDirHandle
  };
});
