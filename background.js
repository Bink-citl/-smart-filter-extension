/**
 * Smart Filter 后台 Service Worker —— 消息路由 / 人才库写入 / 导出 / 定时自检
 */
importScripts('services/store.js');
importScripts('services/exporter.js');
importScripts('services/plan.js');
importScripts('services/industry.js');
importScripts('services/scheduler.js');
importScripts('services/job-kb.js');
importScripts('services/resume-score.js');
importScripts('services/rhythm.js');
importScripts('services/runlog.js');
importScripts('services/chat-target.js');
importScripts('services/resume-inbox.js');
importScripts('services/resume-db.js');
importScripts('services/pdf-find.js');
importScripts('services/people.js');
importScripts('services/decision-log.js');
importScripts('services/backup.js');
importScripts('services/site-config.js');
importScripts('services/remote-config.js');

(() => {
  'use strict';

  // ---------- 初始化 ----------
  function ensureDefaults() {
    return new Promise((resolve) => {
      chrome.storage.local.get('settings', (obj) => {
        if (!obj.settings) {
          const def = HRSStore.DEFAULT_SETTINGS;
          chrome.storage.local.set({ settings: def });
        }
        chrome.storage.local.get('jds', (o2) => {
          if (!o2.jds || !o2.jds.length) {
            const jd = {
              id: HRSStore.uid(),
              schema: 3,
              requireChip: false,
              title: '示例JD：嵌入式软件工程师',
              platformJob: '',
              planEnabled: true,
              dailyQuota: 0,
              hardRequirements: ['嵌入式|单片机', 'C语言', '本科', '1年以上'],
              optionalKeywords: ['STM32', 'RTOS', 'Linux', 'ARM', 'Python'],
              note: '示例岗位，请在「岗位管理 · 岗位列表」改成你自己的'
            };
            chrome.storage.local.set({ jds: [jd] }, () => {
              HRSStore.saveSettings({ activeJdId: jd.id });
              resolve();
            });
          } else resolve();
        });
      });
    });
  }

  // ---------- 徽标 ----------
  function refreshBadge() {
    HRSStore.getEvents(1).then(() => {});
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    chrome.storage.local.get('statsToday', (o) => {
      const st = o.statsToday || { date: today.toISOString(), count: 0, passed: 0, rejected: 0 };
      if (st.date !== today.toISOString()) {
        Object.assign(st, { date: today.toISOString(), count: 0, passed: 0, rejected: 0 });
      }
      const text = st.count > 0 ? String(st.count) : '';
      chrome.action.setBadgeText({ text });
      chrome.action.setBadgeBackgroundColor({ color: st.rejected > st.passed ? '#dc2626' : '#2563eb' });
    });
  }

  function bumpStats(delta) {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    chrome.storage.local.get('statsToday', (o) => {
      const st = o.statsToday || { date: today.toISOString(), count: 0, passed: 0, rejected: 0 };
      if (st.date !== today.toISOString()) st.count = st.passed = st.rejected = 0;
      st.count += delta.count || 0;
      st.passed += delta.passed || 0;
      st.rejected += delta.rejected || 0;
      chrome.storage.local.set({ statsToday: st }, refreshBadge);
    });
  }

  // ---------- 健康自检 ----------
  function healthCheck(verbose) {
    // 用 fresh 读取，避免读到后台缓存旧设置（修复"改了设置仍误报"）
    return Promise.all([HRSStore.loadSettings(), HRSStore.getJds(), HRSStore.getAllCandidates()]).then((r) => {
      const s = r[0], jds = r[1], cands = r[2];
      const problems = [], warnings = [];
      if (!s.masterEnabled) problems.push('运行模式为「停止」，引擎不会扫描');
      if (s.masterEnabled && s.dryRun) warnings.push('当前为「试运行」，只判定不发消息。核对无误后到弹窗或「设置 · 运行」切到「正式运行」');
      if (!jds.length) problems.push('未配置任何岗位JD，请到「岗位管理 · 岗位列表」抓取或新建');
      else {
        const planned = jds.filter((j) => HRSPlan.isPlanned(j, s));
        if (!planned.length) problems.push('今日计划里没有岗位，请到「智选 · 岗位计划」勾选「加入计划」');
        planned.forEach((j) => {
          if (!j.platformJob) warnings.push('岗位「' + j.title + '」未填「平台职位名」，只能靠关键词猜候选人投的岗位');
          if (!j.hardRequirements || !j.hardRequirements.length) warnings.push('岗位「' + j.title + '」没有硬性要求，所有人都会判为合格');
        });
        const names = {};
        jds.forEach((j) => { const k = HRSPlan.norm(j.platformJob); if (k) { if (names[k]) warnings.push('「' + j.title + '」和「' + names[k] + '」的平台职位名相同，候选人会被归到其中一个'); names[k] = j.title; } });
      }
      const win = HRSPlan.inWindow(s);
      if (s.planWindowOn && !win.ok) warnings.push('现在不在执行时段（' + win.text + '），引擎会等到时段内才开始');
      if (s.paceSec < 10) warnings.push('筛选节拍 ' + s.paceSec + ' 秒/个 偏快，平台可能风控，建议不低于 10 秒');
      const company = (s.company || '').trim();
      if (s.rejectMode === 'chat' && !company) {
        warnings.push('不合格处理方式为「发送拒绝话术」，但公司名称是空的，请到「设置 · 运行 · 公司名称」填写');
      }
      if (!s.scripts.rejection || !String(s.scripts.rejection).trim()) warnings.push('拒绝话术为空，自动拒绝时将发送空白内容');
      if (!s.scripts.request || !String(s.scripts.request).trim()) warnings.push('索要简历话术为空');
      const cfg = s.siteConfig || null;
      ['boss', 'liepin'].forEach((site) => {
        if (cfg && cfg[site] && (!cfg[site].cardSelectors || !cfg[site].cardSelectors.length)) warnings.push(site + ' 卡片选择器为空');
      });
      const report = {
        at: new Date().toISOString(),
        ok: problems.length === 0,
        problems,
        warnings,
        stats: { candidates: cands.length, activeJd: jds.filter((j) => HRSPlan.isPlanned(j, s)).map((j) => j.title + (HRSPlan.quotaOf(j) ? '（上限' + HRSPlan.quotaOf(j) + '）' : '（不限）')).join('、') || null },
        settings: { version: chrome.runtime.getManifest().version, mode: !s.masterEnabled ? '停止' : (s.dryRun ? '试运行' : '正式运行'), paceSec: s.paceSec, paceJitter: s.paceJitter !== false, dailyCap: s.dailyCap, rejectMode: s.rejectMode, autoRequest: s.autoRequest }
      };
      HRSStore.addEvent({
        type: 'health',
        detail: problems.length ? '自检发现问题：' + problems.join('；') : (warnings.length ? '自检通过，但有建议' + warnings.join('；') : '自检通过'),
        name: '自检'
      });
      if (verbose) {
        HRSStore.saveSettings({ lastHealthCheck: Date.now() });
        return report;
      }
      return report;
    });
  }

  // ---------- v2.5.0 内置岗位备份（data/preset-backup.json） ----------
  // 新装、或者插件里还只有「示例JD」时，自动导入备份里的全部岗位和设置；已经有自己岗位的不覆盖，在「设置 · 备份与恢复」里手动导入
  function presetLoad() {
    return fetch(chrome.runtime.getURL('data/preset-backup.json')).then((r) => r.json())
      .then((d) => (d && d.type === 'settings-backup' && d.settings && Array.isArray(d.jds) ? d : null)).catch(() => null);
  }
  // 导入规则和「导入设置文件」一致：智选、打招呼一律停止（两个平台各自的模式也停），计划任务关闭，本机的 AI Key 保留
  function safeImportSettings(cur, incoming) {
    cur = cur || {};
    const st = Object.assign({}, cur, JSON.parse(JSON.stringify(incoming || {})));
    delete st.lastHealthCheck;
    if (st.ai && !st.ai.key && cur.ai && cur.ai.key) st.ai = Object.assign({}, st.ai, { key: cur.ai.key });
    st.masterEnabled = false;
    st.greetMode = 'stop';
    if (st.schedule) st.schedule = Object.assign({}, st.schedule, { enabled: false });
    const sm = st.siteMode || {};
    st.siteMode = {};
    ['boss', 'liepin'].forEach((k) => { st.siteMode[k] = Object.assign({}, sm[k] || {}, { masterEnabled: false, greetMode: 'stop' }); });
    return st;
  }
  function seedPreset() {
    return new Promise((res) => chrome.storage.local.get(['jds', 'settings', 'presetSeed'], res)).then((o) => {
      if (o.presetSeed) return null;
      const jds = o.jds || [];
      const onlySample = jds.every((j) => /^示例JD/.test(String(j && j.title || '')));
      return presetLoad().then((data) => {
        if (!data) return null;
        const mark = { at: Date.now(), from: data.exportedAt || '', count: data.jds.length };
        if (!onlySample) return chrome.storage.local.set({ presetSeed: Object.assign(mark, { auto: false }) });
        const prev = { savedAt: new Date().toISOString(), settings: o.settings || {}, jds };
        const st = safeImportSettings(o.settings, data.settings);
        const jdsIn = data.jds.map((j) => Object.assign(JSON.parse(JSON.stringify(j)), { id: j.id || HRSStore.uid() }));
        return chrome.storage.local.set({ settingsBackupPrev: prev, settings: st, jds: jdsIn, presetSeed: Object.assign(mark, { auto: true, notice: true }) })
          .then(() => HRSStore.getJds());   // 旧版本岗位格式在这里自动迁移
      });
    }).catch(() => null);
  }

  // v2.6.0 开着「拖动排序同步」时，岗位列表 / 智选 / 打招呼三处顺序对齐（以岗位列表为准）。只改顺序，不动岗位本身
  function unifyOrders() {
    return Promise.all([HRSStore.getSettings(true), HRSStore.getJds()]).then(([s, jds]) => {
      if (s.jobOrderSync === false || !jds.length || HRSPlan.ordersInSync(jds, s)) return null;
      const u = HRSPlan.unifiedOrder(jds, s);
      return HRSStore.saveSettings({ jobOrder: u, planOrder: u, greetOrder: u });
    }).catch(() => null);
  }

  // v2.6.0 简历收集新加了 HR / SW / Analog 三个类别：之前自己改过类别选项的，把这三个补进去（只补一次，删掉后不再补回来）
  function migrateInboxCats() {
    return HRSStore.getSettings(true).then((s) => {
      const ri = s.ri;
      if (!ri || !Array.isArray(ri.cats) || ri.cats26) return null;
      const cats = ri.cats.slice();
      ['HR', 'SW', 'Analog'].forEach((c) => { if (cats.indexOf(c) < 0) cats.push(c); });
      return HRSStore.saveSettings({ ri: Object.assign({}, ri, { cats, cats26: true }) });
    }).catch(() => null);
  }

  // v3.6.0 打招呼每日总上限从旧值改成 180 的那一次，记进处理记录和运行记录（只记一次）
  function noteCapMigration() {
    return HRSStore.getSettings(true).then((s) => {
      const m = s.greetCapMigrated;
      if (!m || m.noted) return null;
      const text = '打招呼每日总上限从 ' + m.from + ' 改为 ' + m.to + '（v3.6.0 默认值）。需要更多可以到「打招呼 · 每日总上限」改，超过 180 会有提示';
      runlogAdd({ mod: '打招呼', act: '设置', target: '每日总上限', ok: true, detail: text }, null);
      return HRSStore.addEvent({ type: 'settings', name: '设置', detail: text })
        .then(() => HRSStore.saveSettings({ greetCapMigrated: Object.assign({}, m, { noted: true }) }));
    }).catch(() => null);
  }

  // ---------- 每日定时自检 ----------
  chrome.runtime.onInstalled.addListener(() => {
    chrome.alarms.create('hrsDailyHealth', { periodInMinutes: 24 * 60 });
    ensureDefaults().then(() => seedPreset()).then(() => unifyOrders()).then(() => migrateInboxCats()).then(() => migrateInbox261()).then(() => noteCapMigration()).then(() => refreshBadge());
  });
  chrome.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === 'hrsDailyHealth') healthCheck(false).then((r) => {
      if (!r.ok) chrome.action.setBadgeText({ text: '!' });
    });
  });
  chrome.runtime.onStartup.addListener(() => { unifyOrders().then(() => migrateInboxCats()).then(() => migrateInbox261()).then(() => refreshBadge()); });
  // v2.6.0 后台每次启动都检查一遍（覆盖文件夹升级时浏览器不一定发「已更新」事件）：两项都只在需要时才改
  setTimeout(() => { unifyOrders().then(() => migrateInboxCats()).then(() => migrateInbox261()).then(() => noteCapMigration()); }, 1500);

  // ---------- v1.7.0 抓到的职位直接进「岗位管理」 ----------
  const EDU_IDX = { 不限: 0, 高中: 1, 中专: 1, 大专: 2, 本科: 3, 硕士: 4, 博士: 5 };
  const nrm = (x) => String(x == null ? '' : x).replace(/\s+/g, '').toLowerCase();
  const junkJd = (x) => { x = String(x || '').trim(); return x.length < 60 || /招聘工作台|邀请同事|我的权益|集团管理员/.test(x.slice(0, 80)); };
  function upsertFetchedJob(job) {
    const junk = junkJd;
    return Promise.all([HRSStore.getJds(), HRSStore.getSettings()]).then(([jds, settings]) => {
      const title = String(job.title || '').trim();
      if (!title) return null;
      // v1.9.15 先按这个平台的职位名找；找不到再按「JD 原文 + 职位名 + 城市」找另一个平台的同一个岗位，找到就合并成一条
      const mt = HRSPlan.matchFetched(jds, job);
      let t = mt ? mt.jd : null;
      if (t) {
        // 已有岗位：只更新抓到的原文和平台信息，你设置过的条件不动
        // v1.9.16 不用导航文字 / 太短的内容覆盖 JD；两边都有的岗位（有推荐页职位名），JD 和薪资以 Boss 为准，猎聘抓到的不覆盖
        const bossOwned = job.source === 'liepin' && !!t.greetJob;
        if (job.jd && !junk(job.jd) && !bossOwned && (!t.jdText || junk(t.jdText) || mt.how === 'name')) t.jdText = job.jd;
        else if (job.jd && !junk(job.jd) && (!t.jdText || junk(t.jdText))) t.jdText = job.jd;
        if (job.salary && !bossOwned) t.salary = job.salary;
        if (job.greetJob && !t.greetJob) t.greetJob = job.greetJob;
        if (job.source === 'liepin') {
          if (!t.platformJob) t.platformJob = title;
          else if (nrm(t.platformJob) !== nrm(title) && !t.liepinJob) t.liepinJob = title;
        } else if (!t.platformJob) t.platformJob = title;
        else if (mt.how === 'jd' && nrm(t.platformJob) !== nrm(title)) {
          // 原来是猎聘的岗位，并进 Boss：平台职位名改成 Boss 的，猎聘名单独记
          if (!t.liepinJob && (t.sources || []).indexOf('liepin') >= 0) t.liepinJob = t.platformJob;
          t.platformJob = title;
        }
        if (mt.how === 'jd') job.mergedInto = t.title;
        t.sources = Array.from(new Set((t.sources || []).concat([job.source])));
      } else {
        const sameTitle = jds.filter((j) => nrm(j.platformJob || j.title) === nrm(title)).length;
        const m = String(job.exp || '').match(/(\d+)/);
        t = {
          id: HRSStore.uid(), schema: 5, quota: { bossScreen: 0, liepinScreen: 0, bossGreet: 0, liepinGreet: 0 },
          title: sameTitle || jds.some((j) => nrm(j.title) === nrm(title)) ? title + '（' + (job.city || job.source) + '）' : title,
          platformJob: title, greetJob: job.greetJob || '', jdText: junkJd(job.jd) ? '' : job.jd, salary: job.salary || '', sources: [job.source],
          base: HRSStore.newBase(settings, { cities: job.city || '', edu: EDU_IDX[String(job.edu || '').replace(/及以上|以上/, '')] || 0, exp: m && !/以内|应届|在校/.test(job.exp) ? parseInt(m[1], 10) : null }),
          hardRequirements: [], optionalKeywords: [],
          planEnabled: false, dailyQuota: 0,
          greet: { enabled: false, quota: 20, same: true }
        };
        jds.push(t);
      }
      return HRSStore.saveJds(jds);
    });
  }

  // ---------- v1.9.48 BOSS RPA（复用 v1.9.2 的本机 Python RPA 助手）：插件只决定「点哪里、点完对不对」，本机 RPA 助手用真实鼠标键盘去做 ----------
  // 同一时间只允许一个页面（标签页 + 内嵌页面）占用鼠标：打招呼和智选同时开着时轮流来，不会抢鼠标。
  // 不再对 Boss 页面挂浏览器调试器：顶部不会再出现「已开始调试此浏览器」提示条。
  const rpa = { owner: null, lastUse: 0 };
  const RPA_LEASE_IDLE = 20000;
  function rpaOwnerOf(sender) { return sender && sender.tab ? sender.tab.id + ':' + (sender.frameId || 0) : 'ext'; }
  function rpaFree() {
    if (rpa.owner && Date.now() - rpa.lastUse > RPA_LEASE_IDLE) rpa.owner = null;   // 占用方页面没了，自动释放
    return !rpa.owner;
  }
  function rpaAcquire(owner, timeoutMs) {
    return new Promise((resolve) => {
      const end = Date.now() + (timeoutMs || 45000);
      (function tryIt() {
        if (rpa.owner === owner || rpaFree()) { rpa.owner = owner; rpa.lastUse = Date.now(); return resolve({ ok: true }); }
        if (Date.now() > end) return resolve({ ok: false, code: 'busy', why: '另一个页面正在用 RPA 动鼠标（同一时间只能有一个），稍后再试', wait: 5 });
        setTimeout(tryIt, 200);
      })();
    });
  }
  function rpaFetch(s, path, body, timeoutMs) {
    const ctl = new AbortController();
    const ms = timeoutMs || 20000;
    const t = setTimeout(() => ctl.abort(), ms);
    const port = parseInt(s && s.rpaPort, 10) || 17861;
    const opt = body
      ? { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-HRS-RPA': '1' }, body: JSON.stringify(body), signal: ctl.signal, cache: 'no-store' }
      : { method: 'GET', headers: { 'X-HRS-RPA': '1' }, signal: ctl.signal, cache: 'no-store' };
    return fetch('http://127.0.0.1:' + port + path, opt)
      .then((r) => r.json().catch(() => ({ ok: false, code: 'error', why: 'RPA 助手返回了看不懂的内容（HTTP ' + r.status + '）' })))
      .catch((e) => {
        const m = String(e && e.message || e);
        if (/abort/i.test(m)) return { ok: false, code: 'timeout', why: 'RPA 助手 ' + Math.round(ms / 1000) + ' 秒没回应', wait: 5 };
        if (/address space|local network|private network/i.test(m)) return { ok: false, code: 'lna', why: '浏览器拦下了到本机 RPA 助手的连接。到 扩展管理 → Smart Filter → 详细信息 → 网站设置，把「本地网络访问」改为「允许」', wait: 30 };
        return { ok: false, code: 'offline', why: '连不上本机 RPA 助手（127.0.0.1:' + port + '）。打开插件文件夹里的 rpa-helper 文件夹，在资源管理器地址栏输入 cmd /k py install_autostart.py 回车（没有 py 就换成 python）（只做一次，以后开机自动在后台运行）', wait: 15 };
      })
      .finally(() => clearTimeout(t));
  }
  // v1.10.1 插件弹窗打开期间不抢焦点、不动鼠标：否则弹窗一打开就被切走的窗口关掉（看起来像闪退）
  let popupPorts = 0;
  chrome.runtime.onConnect.addListener((port) => {
    if (!port || port.name !== 'hrs-popup') return;
    popupPorts++;
    port.onDisconnect.addListener(() => { popupPorts = Math.max(0, popupPorts - 1); });
  });
  function popupIdle(maxMs) {
    const end = Date.now() + (maxMs || 60000);
    return new Promise((r) => (function w() { if (!popupPorts || Date.now() > end) return r(); setTimeout(w, 300); })());
  }
  // 动作前把 Boss 标签页切到前台、窗口还原并置顶，真实鼠标才能点到它
  function rpaFocus(tab) {
    return new Promise((resolve) => {
      if (!tab) return resolve();
      chrome.windows.update(tab.windowId, { focused: true }, (w) => {
        void chrome.runtime.lastError;
        const next = () => {
          if (tab.active) return setTimeout(resolve, 150);
          chrome.tabs.update(tab.id, { active: true }, () => { void chrome.runtime.lastError; setTimeout(resolve, 450); });
        };
        if (w && w.state === 'minimized') chrome.windows.update(tab.windowId, { state: 'normal', focused: true }, () => { void chrome.runtime.lastError; setTimeout(next, 350); });
        else next();
      });
    });
  }
  function rpaOp(msg, sender) {
    const owner = rpaOwnerOf(sender);
    const op = String(msg.op || '');
    return HRSStore.getSettings().then((s) => {
      if (op === 'release') { if (rpa.owner === owner) rpa.owner = null; return { ok: true }; }
      if (op === 'acquire') return rpaAcquire(owner, msg.args && msg.args.timeout);
      const idle = parseInt(s.rpaIdleSec, 10);
      const a0 = msg.args || {};
      // v2.3.0 拟人节奏：每个动作的鼠标 / 打字速度在设定速度上随机快慢一点；长话术分段打时带上整体提速倍数
      let speed = (Number(s.rpaSpeed) || 1) * (self.HRSRhythm ? self.HRSRhythm.speedFactor(s.rhythm) : 1);
      if (op === 'type' && Number(a0.speedMul) > 1) speed *= Math.min(4, Number(a0.speedMul));
      const args = Object.assign({}, a0, { op: op, speed: Math.round(speed * 100) / 100, idle: typeof a0.idle === 'number' ? a0.idle : (isFinite(idle) && idle >= 0 ? idle : 8) });
      delete args.speedMul;
      if (sender && sender.tab) args.title = sender.tab.title || '';
      if (op === 'probe') return rpaFetch(s, '/op', args, 8000);
      if (popupPorts) return { ok: false, code: 'user_active', why: '插件弹窗开着，关掉弹窗后继续', wait: 3 };
      if (rpa.owner && rpa.owner !== owner && !rpaFree()) return { ok: false, code: 'busy', why: '另一个页面正在用 RPA 动鼠标，稍后再试', wait: 5 };
      rpa.owner = owner; rpa.lastUse = Date.now();
      const pre = (op === 'prepare' && sender && sender.tab)
        ? rpaFocus(sender.tab).then(() => new Promise((r) => chrome.tabs.get(sender.tab.id, (t) => { void chrome.runtime.lastError; if (t && t.title) args.title = t.title; r(); })))
        : Promise.resolve();
      return pre.then(() => rpaFetch(s, '/op', args, op === 'type' ? 60000 : 25000)).then((r) => { rpa.lastUse = Date.now(); return r; });
    });
  }

  // ---------- v2.3.0 运行记录：页面上报的每个动作 + 各引擎状态，统一由后台写入本机 ----------
  const RUNLOG_MAX = 3000, RUNLOG_DAYS = 7, STALE_MS = 60000;
  const runlog = { buf: [], timer: null, chain: Promise.resolve() };
  function siteOfUrl(u) { return /zhipin\.com/i.test(u || '') ? 'boss' : (/liepin\.com/i.test(u || '') ? 'liepin' : ''); }
  function modOfUrl(u) {
    u = String(u || '');
    if (/recommend/i.test(u)) return '打招呼';
    if (/zhipin\.com\/web\/chat\/(index|im)/i.test(u) || /liepin\.com\/.*\/(chat|im|message|msg)(\/|$|\?|#)/i.test(u)) return '智选';
    return '';
  }
  function runlogAdd(ev, sender) {
    if (!ev) return;
    const url = sender && sender.tab ? sender.tab.url : '';
    ev.t = ev.t || Date.now();
    ev.site = ev.site || siteOfUrl(url);
    ev.mod = ev.mod || modOfUrl(url) || '其他';
    if (sender && sender.tab) ev.tab = sender.tab.id;
    runlog.buf.push(ev);
    if (!runlog.timer) runlog.timer = setTimeout(runlogFlush, 1200);
  }
  function runlogFlush() {
    runlog.timer = null;
    const add = runlog.buf.splice(0);
    if (!add.length) return runlog.chain;
    runlog.chain = runlog.chain.then(() => chrome.storage.local.get('runLog')).then((o) => {
      const cut = Date.now() - RUNLOG_DAYS * 86400000;
      let arr = (o.runLog || []).concat(add).filter((e) => e && e.t >= cut);
      if (arr.length > RUNLOG_MAX) arr = arr.slice(-RUNLOG_MAX);
      return chrome.storage.local.set({ runLog: arr });
    }).catch(() => {});
    return runlog.chain;
  }
  function runstateSet(msg, sender) {
    const key = String(msg.key || '');
    if (!key) return Promise.resolve({ ok: false });
    runlog.chain = runlog.chain.then(() => chrome.storage.local.get('runStatus')).then((o) => {
      const all = o.runStatus || {};
      const prev = all[key] || {};
      const next = { state: msg.state, text: msg.text || '', until: msg.until || 0, at: Date.now(), tab: sender && sender.tab ? sender.tab.id : null, url: sender && sender.tab ? sender.tab.url : '' };
      // 状态变了（运行中 → 休息中 → 已停止）记一条，方便在记录里看到什么时候停、为什么停
      const wasStale = prev.at && Date.now() - prev.at > STALE_MS;
      if (prev.state !== next.state || wasStale) {
        const eng = (self.HRSRunLog.ENGINES.filter((x) => x.key === key)[0]) || {};
        runlogAdd({ act: '状态', mod: eng.mod || '', site: eng.site || '', target: (self.HRSRunLog.STATE_LABEL[next.state] || next.state), ok: true, detail: next.text }, sender);
      }
      all[key] = next;
      return chrome.storage.local.set({ runStatus: all });
    }).catch(() => {});
    return runlog.chain.then(() => ({ ok: true }));
  }
  // 标签页关了：上面跑的引擎记为已停止
  chrome.tabs.onRemoved.addListener((tabId) => {
    runlog.chain = runlog.chain.then(() => chrome.storage.local.get('runStatus')).then((o) => {
      const all = o.runStatus || {};
      let changed = false;
      Object.keys(all).forEach((k) => {
        const v = all[k];
        if (v && v.tab === tabId && v.state !== 'stopped') {
          all[k] = Object.assign({}, v, { state: 'stopped', text: '页面已关闭', at: Date.now() });
          const eng = (self.HRSRunLog.ENGINES.filter((x) => x.key === k)[0]) || {};
          runlogAdd({ act: '状态', mod: eng.mod || '', site: eng.site || '', target: '已停止', ok: true, detail: '页面已关闭' }, null);
          changed = true;
        }
      });
      return changed ? chrome.storage.local.set({ runStatus: all }) : null;
    }).catch(() => {});
  });

  function bossRpaBlocked(sender) {
    const url = sender && sender.tab && sender.tab.url || (sender && sender.url) || '';
    if (!/^https:\/\/([^/]+\.)?zhipin\.com\//i.test(url)) return Promise.resolve(false);
    return HRSStore.getSettings().then((s) => (s.bossExec || 'rpa') !== 'script');
  }

  // ---------- v1.7.6 真实鼠标点击（chrome.debugger Input 域，只发鼠标事件，不开调试器面板） ----------
  let dbg = { tabId: null, timer: null };
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  function cdp(tabId, method, params) {
    return new Promise((resolve, reject) => {
      chrome.debugger.sendCommand({ tabId }, method, params || {}, (r) => {
        if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message)); else resolve(r);
      });
    });
  }
  function attach(tabId) {
    if (dbg.tabId === tabId) return Promise.resolve();
    return releaseDebugger().then(() => new Promise((resolve, reject) => {
      chrome.debugger.attach({ tabId }, '1.3', () => {
        if (chrome.runtime.lastError) return reject(new Error(chrome.runtime.lastError.message));
        dbg.tabId = tabId; resolve();
      });
    }));
  }
  function releaseDebugger() {
    if (dbg.timer) { clearTimeout(dbg.timer); dbg.timer = null; }
    if (dbg.tabId == null) return Promise.resolve();
    const t = dbg.tabId; dbg.tabId = null;
    return new Promise((r) => chrome.debugger.detach({ tabId: t }, () => { void chrome.runtime.lastError; r(); }));
  }
  chrome.debugger.onDetach.addListener((src) => { if (src.tabId === dbg.tabId) dbg.tabId = null; });
  function trustedMove(tabId, x, y) {
    if (tabId == null) return Promise.resolve({ ok: false });
    return popupIdle(20000).then(() => new Promise((resolve) => chrome.tabs.getZoom(tabId, (z) => resolve(z || 1))).then((zoom) =>
      attach(tabId).then(() => cdp(tabId, 'Input.dispatchMouseEvent', { type: 'mouseMoved', x: Math.round(x * zoom), y: Math.round(y * zoom) }))
        .then(() => ({ ok: true })).catch((e) => ({ ok: false, why: String(e.message) }))));
  }

  // ---------- v1.9.27 简历详情：后台打开详情页读全文再关掉 / 接住页面自己弹出的新标签 / AI 判断 ----------
  const sleepMs = (ms) => new Promise((r) => setTimeout(r, ms));
  function waitTabLoaded(tabId, maxMs) {
    const t0 = Date.now();
    return (function poll() {
      return new Promise((r) => chrome.tabs.get(tabId, (t) => r(chrome.runtime.lastError ? null : t))).then((t) => {
        if (!t) return false;
        if (t.status === 'complete') return true;
        if (Date.now() - t0 > (maxMs || 15000)) return true;
        return sleepMs(400).then(poll);
      });
    })();
  }
  function readTabText(tabId) {
    return chrome.scripting.executeScript({ target: { tabId, allFrames: true }, func: () => (document.body ? document.body.innerText : '') })   // eslint-disable-line no-undef -- 这个函数在网页里运行
      .then((rs) => (rs || []).map((r) => String(r.result || '')).sort((a, b) => b.length - a.length).join('\n'))
      .catch((e) => '');
  }
  function readAndClose(tabId, backTo, src) {
    const enough = (t) => t.replace(/\s+/g, '').length >= 200;
    return waitTabLoaded(tabId, 15000).then(() => sleepMs(2500)).then(() => readTabText(tabId)).then((txt) => {
      if (enough(txt)) return txt;
      return sleepMs(2500).then(() => readTabText(tabId));
    }).then((txt) => {
      // v1.9.36 后台标签页里页面可能不渲染：切到前台读一次，读完再切回原页面
      if (enough(txt)) return txt;
      return popupIdle(30000).then(() => new Promise((r) => chrome.tabs.update(tabId, { active: true }, () => { void chrome.runtime.lastError; r(); })))
        .then(() => sleepMs(3000)).then(() => readTabText(tabId)).then((t2) => (t2.length > txt.length ? t2 : txt))
        .then((t3) => { if (backTo == null && src != null) backTo = src; return t3; });
    }).then((txt) => new Promise((resolve) => chrome.tabs.get(tabId, (t) => {
      const url = t ? (t.url || t.pendingUrl || '') : '';
      chrome.tabs.remove(tabId, () => {
        void chrome.runtime.lastError;
        if (backTo != null) chrome.tabs.update(backTo, { active: true }, () => void chrome.runtime.lastError);
        const n = txt.replace(/\s+/g, '').length;
        resolve({ ok: n >= 80, text: txt, url, why: n >= 80 ? '' : '简历页只读到 ' + n + ' 个字（' + String(url).slice(0, 80) + '）' });
      });
    })));
  }
  function detailReadUrl(url, src) {
    // v1.9.37 新标签页必须开在原页面同一个窗口里，否则 Chrome 报「Tab opener must be in the same window」
    const getWin = src == null ? Promise.resolve(null) : new Promise((r) => chrome.tabs.get(src, (t) => r(chrome.runtime.lastError || !t ? null : t.windowId)));
    return getWin.then((win) => {
      const opt = { url, active: false };
      if (win != null) { opt.windowId = win; opt.openerTabId = src; }
      return chrome.tabs.create(opt).catch(() => chrome.tabs.create({ url, active: false }));
    }).then((t) => readAndClose(t.id, null, src))
      .catch((e) => ({ ok: false, why: '打开简历页失败：' + (e && e.message || e) + '（' + String(url).slice(0, 80) + '）' }));
  }
  // 页面自己打开了新标签（猎聘点卡片）：接住这个新标签，读完关掉，切回原标签
  function detailCatchTab(src, timeout) {
    return new Promise((resolve) => {
      let got = false;
      const onC = (tab) => {
        if (got) return;
        if (tab.openerTabId !== src && !(tab.openerTabId == null && /liepin|zhipin/.test(tab.pendingUrl || tab.url || ''))) return;
        got = true;
        chrome.tabs.onCreated.removeListener(onC);
        readAndClose(tab.id, src).then(resolve);
      };
      chrome.tabs.onCreated.addListener(onC);
      setTimeout(() => { if (!got) { chrome.tabs.onCreated.removeListener(onC); resolve({ ok: false, why: '没有打开新的简历页面' }); } }, timeout || 12000);
    });
  }
  // v3.2.0 评测样本：打招呼每判一张卡片存一份（去掉姓名），「设置 → 评测集」里打标。最多 1500 张，满了先丢最早的没打标的
  let evalQ = Promise.resolve();
  function evalKey(x) {
    const t = (x.kind === 'chat' ? 'c|' : '') + (x.jdId || '') + '|' + ((x.card && x.card.summary) || '');   // v3.3.0 智选的样本和打招呼的分开
    let h = 0;
    for (let i = 0; i < t.length; i++) h = (h * 31 + t.charCodeAt(i)) | 0;
    return 'e' + (h >>> 0).toString(36) + t.length.toString(36);
  }
  /** 改评测样本都排队做（采集和打标同时发生时不互相覆盖）。fn 可以原地改，也可以返回新数组 */
  function evalEdit(fn) {
    evalQ = evalQ.then(() => new Promise((resolve) => {
      chrome.storage.local.get('evalSamples', (o) => {
        let list = o.evalSamples || [];
        const r = fn(list);
        if (Array.isArray(r)) list = r;
        chrome.storage.local.set({ evalSamples: list }, () => resolve({ ok: true, n: list.length }));
      });
    }));
    return evalQ;
  }
  function evalAdd(sample) {
    if (!sample || !sample.card) return Promise.resolve({ ok: false });
    evalQ = evalQ.then(() => new Promise((resolve) => {
      chrome.storage.local.get('evalSamples', (o) => {
        const list = o.evalSamples || [];
        const id = evalKey(sample);
        const old = list.find((x) => x.id === id);
        if (old) Object.assign(old, { at: sample.at, verdict: sample.verdict, reason: sample.reason, score: sample.score, rules: sample.rules, card: sample.card, engine: sample.engine, verdicts: sample.verdicts });
        else list.push(Object.assign({ id, label: '' }, sample));
        while (list.length > 1500) {
          const i = list.findIndex((x) => !x.label);
          list.splice(i >= 0 ? i : 0, 1);
        }
        chrome.storage.local.set({ evalSamples: list }, () => resolve({ ok: true, id, n: list.length }));
      });
    }));
    return evalQ;
  }

  // v3.6.0 AI 判断：发出去之前去掉姓名、电话、邮箱、微信、证件号（设置 · 合规 可关）；每天最多调用 aiDailyCap 次
  function aiUse(cap) {
    const d = HRSPlan.localDate();
    return chrome.storage.local.get('aiUsage').then((o) => {
      const u = o.aiUsage && o.aiUsage.date === d ? o.aiUsage : { date: d, n: 0, redacted: 0 };
      if (cap > 0 && u.n >= cap) return { ok: false, u };
      u.n++;
      return chrome.storage.local.set({ aiUsage: u }).then(() => ({ ok: true, u }));
    });
  }
  function aiJudge(msg) {
    return HRSStore.getSettings(true).then((s) => {
      const ai = s.ai || {};
      if (!ai.on || !ai.url) return { ok: false, why: '没开 AI' };
      const cap = parseInt(s.aiDailyCap, 10) || 0;
      return aiUse(cap).then((g) => {
        if (!g.ok) return { ok: false, why: '今天 AI 判断已经用了 ' + g.u.n + ' 次，到了上限（设置 · 合规 里可改）' };
        const red = s.aiRedact === false ? { text: msg.text || '', n: 0 } : HRSPeople.redact(msg.text || '', [msg.name]);
        if (red.n) { g.u.redacted = (g.u.redacted || 0) + red.n; chrome.storage.local.set({ aiUsage: g.u }); }
        return aiCall(ai, Object.assign({}, msg, { text: red.text }));
      });
    });
  }
  function aiCall(ai, msg) {
    const body = { model: ai.model || '', messages: HRSResumeScore.aiMessages(msg.jd || {}, msg.text || '', msg.sc || { hard: [], bonus: [] }), temperature: 0 };
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), 45000);
    return fetch(ai.url, { method: 'POST', signal: ctl.signal, headers: Object.assign({ 'Content-Type': 'application/json' }, ai.key ? { Authorization: 'Bearer ' + ai.key } : {}), body: JSON.stringify(body) })
      .then((r) => r.text().then((t) => ({ status: r.status, t })))
      .then(({ status, t }) => {
        clearTimeout(timer);
        if (status >= 300) return { ok: false, why: 'AI 接口返回 ' + status + '：' + t.slice(0, 120) };
        let content = t;
        try { const j = JSON.parse(t); content = (j.choices && j.choices[0] && (j.choices[0].message || {}).content) || (j.content && j.content[0] && j.content[0].text) || j.output_text || t; } catch (e) {}
        const r = HRSResumeScore.parseAi(content);
        return r ? Object.assign({ ok: true }, r) : { ok: false, why: 'AI 返回的不是约定的 JSON：' + String(content).slice(0, 120) };
      })
      .catch((e) => { clearTimeout(timer); return { ok: false, why: 'AI 接口调用失败：' + (e && e.message || e) }; });
  }

  function trustedClick(tabId, x, y) {
    if (tabId == null) return Promise.resolve({ ok: false, why: '找不到标签页' });
    return popupIdle(20000).then(() => new Promise((resolve) => chrome.tabs.getZoom(tabId, (z) => resolve(z || 1)))).then((zoom) => {
      const px = Math.round(x * zoom), py = Math.round(y * zoom);
      return attach(tabId)
        .then(() => cdp(tabId, 'Input.dispatchMouseEvent', { type: 'mouseMoved', x: px, y: py }))
        .then(() => sleep(60 + Math.random() * 120))
        .then(() => cdp(tabId, 'Input.dispatchMouseEvent', { type: 'mousePressed', x: px, y: py, button: 'left', clickCount: 1 }))
        .then(() => sleep(50 + Math.random() * 90))
        .then(() => cdp(tabId, 'Input.dispatchMouseEvent', { type: 'mouseReleased', x: px, y: py, button: 'left', clickCount: 1 }))
        .then(() => {
          // 2 分钟没再用就断开，顶部提示条随之消失
          if (dbg.timer) clearTimeout(dbg.timer);
          dbg.timer = setTimeout(releaseDebugger, 120000);
          return { ok: true };
        })
        .catch((e) => ({ ok: false, why: /already attached|Another debugger/i.test(String(e.message)) ? '这个页面开着开发者工具（F12），请关掉后再试' : String(e.message) }));
    });
  }

  // ---------- v1.6.0 猎聘预览页捕获 ----------
  let pendingCapture = null;
  const captureTabs = new Map();
  chrome.tabs.onCreated.addListener((tab) => {
    if (!pendingCapture || Date.now() - pendingCapture.at > 15000) return;
    if (tab.openerTabId != null && pendingCapture.opener != null && tab.openerTabId !== pendingCapture.opener) return;
    captureTabs.set(tab.id, pendingCapture.info);
    pendingCapture = null;
  });

  // ---------- v2.5.0 简历收集：收 PDF → 存本机 → 读 PDF 文字 → 按模板命名 → 自动保存到本地 ----------
  const RI = self.HRSResumeInbox, RDB = self.HRSResumeDB;
  const inbox = { chain: Promise.resolve() };
  function inboxGet() { return new Promise((r) => chrome.storage.local.get('resumeInbox', (o) => r(Array.isArray(o.resumeInbox) ? o.resumeInbox : []))); }
  // 所有改动排队执行，避免两份简历同时到达时互相覆盖
  function inboxEdit(fn) {
    const p = inbox.chain.then(() => inboxGet()).then((list) => Promise.resolve(fn(list)).then((ret) => chrome.storage.local.set({ resumeInbox: list }).then(() => ret)));
    inbox.chain = p.catch(() => {});
    return p;
  }
  function inboxOpt(s) {
    const ri = (s && s.ri) || {};
    return {
      tpl: ri.tpl || RI.DEFAULT_TPL, renameOn: ri.renameOn !== false, cats: ri.cats || RI.DEFAULT_CATS, cities: ri.cities || RI.DEFAULT_CITIES,
      liepinOnlySelf: ri.liepinOnlySelf !== false,
      catMap: ri.catMap || {}, shortCompany: ri.shortCompany !== false, autoExport: ri.autoExport !== false,
      replaceOld: ri.replaceOld !== false, folder: (s && s.exportFolder) || 'HR人才库',
      // v2.6.1 保存位置：downloads = 浏览器下载目录下的文件夹；folder = 你选的任意文件夹
      saveTo: ri.saveTo === 'folder' && ri.dirName ? 'folder' : 'downloads', dirName: ri.dirName || '',
      layout: ri.layout === 'job' || ri.layout === 'flat' ? ri.layout : 'day-job', fetchTab: ri.fetchTab !== false
    };
  }
  function blobToDataUrl(blob) {
    return blob.arrayBuffer().then((buf) => {
      const bytes = new Uint8Array(buf);
      let bin = '';
      for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
      return 'data:application/pdf;base64,' + btoa(bin);
    });
  }
  // v2.6.1 只认真正的 PDF：开头 1KB 内有 %PDF-（以前把平台的预览网页当成 PDF 存，存出了 .htm）
  const PF = self.HRSPdfFind;
  function isPdfBlob(blob) { return PF.checkBlob(blob); }
  function shaOf(blob) {
    return blob.arrayBuffer().then((b) => crypto.subtle.digest('SHA-256', b))
      .then((h) => Array.from(new Uint8Array(h)).slice(0, 16).map((x) => x.toString(16).padStart(2, '0')).join('')).catch(() => '');
  }
  function bgFetch(u, o) { return fetch(u, o); }
  function isPlatformUrl(u) { return /^https:\/\/([^/]+\.)?(zhipin\.com|bosszhipin\.com|liepin\.com|lietou\.com|lietou-static\.com)\//i.test(String(u || '')); }
  function siteOfAny(u) { return /liepin|lietou/i.test(String(u || '')) ? 'liepin' : /zhipin/i.test(String(u || '')) ? 'boss' : ''; }

  // ---------- v2.6.1 页面里看到的 PDF 地址（content/pdf-sniff.js 报上来的），按标签页记最近 15 分钟 ----------
  const pdfSeen = new Map();       // tabId -> [{ u, at }]
  const usedPdf = new Map();       // 已经认给某份简历的 PDF 地址 -> 简历编号（同一份不认给第二个人）
  const fetchTabs = new Map();     // 后台临时打开取 PDF 的标签页 -> 收到地址时的回调
  function seenAdd(tabId, urls) {
    const now = Date.now();
    const arr = (pdfSeen.get(tabId) || []).filter((x) => now - x.at < 15 * 60000);
    urls.forEach((u) => { if (!arr.some((x) => x.u === u)) arr.push({ u, at: now }); });
    pdfSeen.set(tabId, arr.slice(-30));
  }
  function seenSince(tabId, since) {
    if (tabId == null) return [];
    return (pdfSeen.get(tabId) || []).filter((x) => x.at >= (since || 0) - 2000 && !usedPdf.has(x.u)).map((x) => x.u);
  }
  chrome.tabs.onRemoved.addListener((tid) => { pdfSeen.delete(tid); });
  // 你在沟通页打开了某份简历的预览：页面加载了 PDF → 认出是哪个会话 → 收进来（和「打开预览就收」的说明一致）
  const previewTimers = new Map(), previewTried = new Set();
  function previewCapture(tabId) {
    clearTimeout(previewTimers.get(tabId));
    previewTimers.set(tabId, setTimeout(() => {
      previewTimers.delete(tabId);
      const urls = seenSince(tabId, Date.now() - 120000).filter((u) => !previewTried.has(u));
      if (!urls.length) return;
      urls.forEach((u) => previewTried.add(u));
      chrome.tabs.get(tabId, (tab) => {
        if (chrome.runtime.lastError || !tab) return;
        const site = siteOfAny(tab.url);
        if (!site || !self.HRSChatTarget.isCommunicationUrl(site, tab.url || '')) return;
        HRSStore.getSettings(true).then((s) => {
          if (s.resumeAutoSave === false) return null;
          return PF.resolve(urls, { fetch: bgFetch, max: 5, depth: 1 }).then((got) => {
            if (!got.blob) return null;
            return tabCtx(tabId).then((ctx) => {
              if (!ctx) return null;
              const base = decodeURIComponent(String(got.url || '').split(/[?#]/)[0].split('/').pop() || '');
              return inboxIngest(Object.assign({}, ctx, { file: { name: /\.pdf$/i.test(base) ? base : (ctx.name || '候选人') + '的简历.pdf', url: '', pdfUrl: got.url } }), got.blob, { via: 'preview', checkName: true, usedUrl: got.url }, { tab });
            });
          });
        }).catch(() => null);
      });
    }, 1500));
  }
  // 问某个标签页：现在打开的是谁的会话
  function tabCtx(tabId) {
    return new Promise((resolve) => {
      try {
        chrome.tabs.sendMessage(tabId, { type: 'HRS_INBOX_CTX' }, { frameId: 0 }, (r) => {
          if (chrome.runtime.lastError) return resolve(null);
          resolve(r && r.ok && r.ctx && r.ctx.name ? r.ctx : null);
        });
      } catch (e) { resolve(null); }
    });
  }
  // 预览链接取不到 PDF 时：在后台临时标签页打开一次那个预览页，看它加载哪个 PDF，取到就关（最多 20 秒，同时只开一个）
  let fetchTabChain = Promise.resolve();
  function viaTab(url) {
    const job = fetchTabChain.then(() => new Promise((resolve) => {
      let tabId = null, done = false, busy = false;
      const queue = [];
      const finish = (r) => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        if (tabId != null) { fetchTabs.delete(tabId); chrome.tabs.remove(tabId, () => void chrome.runtime.lastError); }
        resolve(r || { blob: null, url: '', tried: [{ url, why: '临时打开预览页也没看到 PDF' }] });
      };
      const pump = () => {
        if (busy || done || !queue.length) return;
        busy = true;
        const urls = queue.splice(0, queue.length);
        PF.resolve(urls, { fetch: bgFetch, max: 4, depth: 1 }).then((got) => { busy = false; if (got.blob) finish(got); else pump(); }, () => { busy = false; });
      };
      const timer = setTimeout(() => finish(null), 20000);
      let heard = false;
      chrome.tabs.create({ url, active: false }, (tab) => {
        if (chrome.runtime.lastError || !tab) return finish({ blob: null, url: '', tried: [{ url, why: '没能打开临时标签页' }] });
        tabId = tab.id;
        fetchTabs.set(tabId, (urls) => { heard = true; urls.forEach((u) => { if (queue.indexOf(u) < 0) queue.push(u); }); pump(); });
        // 网络抖一下页面没打开（后台标签页浏览器不会自动重试）：6 秒还没动静就刷新一次
        setTimeout(() => { if (!done && !heard) chrome.tabs.reload(tabId, () => void chrome.runtime.lastError); }, 6000);
      });
    }));
    fetchTabChain = job.catch(() => null);
    return job;
  }
  /**
   * 取 PDF 原件。f：页面报来的文件信息 { dataUrl, url, pdfUrl, alts }；ctx：{ tabId, since, allowTab }
   * 顺序：页面已经取到的字节 → 后台用你的登录状态取（网页里再找真实地址）→ 临时标签页打开预览页
   */
  function acquire(f, ctx) {
    const page = f.dataUrl ? Promise.resolve(RDB.dataUrlToBlob(f.dataUrl)).then((b) => (b ? isPdfBlob(b).then((ok) => (ok ? { blob: b, url: f.pdfUrl || '', via: f.fromSeen ? 'seen' : 'page', checkName: !!f.fromSeen } : null)) : null)).catch(() => null) : Promise.resolve(null);
    return page.then((hit) => {
      if (hit) return hit;
      const own = [f.pdfUrl, f.url].filter((u) => /^https?:/i.test(u || ''));
      const alts = (f.alts || []).concat(seenSince(ctx.tabId, ctx.since)).filter((u) => /^https?:/i.test(u || '') && own.indexOf(u) < 0 && !usedPdf.has(u));
      const tried = [].concat(f.tried || []);
      // 先试这份附件自己的地址；不行再试这个会话打开后页面加载过的 PDF（这类要核对名字）
      return PF.resolve(own, { fetch: bgFetch, max: 6 }).then((g1) => {
        tried.push.apply(tried, g1.tried || []);
        if (g1.blob) return { blob: g1.blob, url: g1.url, via: 'bg' };
        if (!alts.length) return null;
        return PF.resolve(alts, { fetch: bgFetch, max: 4, depth: 1 }).then((g2) => {
          tried.push.apply(tried, g2.tried || []);
          return g2.blob ? { blob: g2.blob, url: g2.url, via: 'seen', checkName: true } : null;
        });
      }).then((hit2) => {
        if (hit2) return hit2;
        const pageUrl = own.find((u) => isPlatformUrl(u) && !self.HRSChatTarget.isCommunicationUrl(siteOfAny(u), u));
        if (!ctx.allowTab || !pageUrl) return { blob: null, tried };
        return viaTab(pageUrl).then((g3) => (g3.blob ? { blob: g3.blob, url: g3.url, via: 'tab' } : { blob: null, tried: tried.concat(g3.tried || []) }));
      });
    });
  }
  // PDF 里读出的名字和会话里的名字明显对不上（都是中文名时才比）：先不自动保存，等你核对
  function nameWarn(rec) {
    const a = String(rec.name0 || '').replace(/\s+/g, ''), b = String((rec.pdf && rec.pdf.name) || '').replace(/\s+/g, '');
    if (!a || !b || !/^[一-龥·]{2,6}$/.test(b) || !/[一-龥]/.test(a)) return '';
    if (RI.isHonorific(a)) return a.charAt(0) === b.charAt(0) ? '' : 'PDF 里的名字是「' + b + '」，会话里是「' + a + '」';
    if (a === b || a.indexOf(b) >= 0 || b.indexOf(a) >= 0) return '';
    return 'PDF 里的名字是「' + b + '」，会话里是「' + a + '」';
  }
  // PDF 文字：Service Worker 里不能跑 pdf.js，交给隐藏的解析页
  let offscreenReady = null;
  function ensureOffscreen() {
    if (!chrome.offscreen) return Promise.reject(new Error('浏览器版本太旧，不支持后台读 PDF（打开「简历收集」页时会再读一次）'));
    if (offscreenReady) return offscreenReady;
    offscreenReady = (chrome.runtime.getContexts ? chrome.runtime.getContexts({ contextTypes: ['OFFSCREEN_DOCUMENT'] }) : Promise.resolve([]))
      .then((ctx) => (ctx && ctx.length) ? null : chrome.offscreen.createDocument({ url: 'offscreen/pdf-text.html', reasons: ['WORKERS', 'BLOBS'], justification: '读取候选人 PDF 简历里的文字用来自动命名，并把简历保存到你选的文件夹' }))
      .catch((e) => { if (!/single offscreen|already/i.test(String(e && e.message))) { offscreenReady = null; throw e; } });
    return offscreenReady;
  }
  function pdfText(id) {
    return ensureOffscreen().then(() => new Promise((resolve) => {
      const timer = setTimeout(() => resolve({ ok: false, why: '读 PDF 超时' }), 30000);
      chrome.runtime.sendMessage({ target: 'offscreen', type: 'PDF_TEXT', id }, (r) => {
        clearTimeout(timer);
        if (chrome.runtime.lastError) return resolve({ ok: false, why: chrome.runtime.lastError.message });
        resolve(r || { ok: false, why: 'PDF 解析页没回应' });
      });
    })).catch((e) => ({ ok: false, why: String(e && e.message || e) }));
  }
  function inboxParse(id) {
    return pdfText(id).then((r) => inboxEdit((list) => {
      const rec = list.find((x) => x.id === id);
      if (!rec) return null;
      if (r.ok) {
        rec.pdf = Object.assign(RI.fromPdf(r.text), { parsed: Date.now() });
        if (rec.pdf.empty) rec.pdf.err = 'PDF 里没有文字（可能是扫描件），缺的项请手动填';
      } else rec.pdf = { err: r.why, parsed: 0 };
      return rec;
    }));
  }
  function offscreenCall(msg, timeout) {
    return ensureOffscreen().then(() => new Promise((resolve) => {
      const timer = setTimeout(() => resolve({ ok: false, why: '后台隐藏页没回应（超时）' }), timeout || 30000);
      chrome.runtime.sendMessage(Object.assign({ target: 'offscreen' }, msg), (r) => {
        clearTimeout(timer);
        if (chrome.runtime.lastError) return resolve({ ok: false, why: chrome.runtime.lastError.message });
        resolve(r || { ok: false, why: '后台隐藏页没回应' });
      });
    })).catch((e) => ({ ok: false, why: String(e && e.message || e) }));
  }
  // 本机简历库里这份简历的 PDF（再核一次开头是 %PDF）
  function recBlob(id) {
    return RDB.get(id).then((b) => (b ? isPdfBlob(b).then((ok) => (ok ? b : null)) : null)).catch(() => null);
  }
  /** 没拿到原件的记录：后台再取一次。allowTab：允许临时打开预览页。成功返回 true */
  function refetch(rec, allowTab) {
    const f = rec.file || {};
    return acquire({ url: f.url, pdfUrl: f.pdfUrl, alts: f.alts || [] }, { tabId: null, since: 0, allowTab }).then((got) => {
      if (!got || !got.blob) return inboxEdit((l) => { const x = l.find((y) => y.id === rec.id); if (x) { x.file.tried = (got && got.tried || []).slice(-8); x.file.triedAt = Date.now(); } }).then(() => false);
      return shaOf(got.blob).then((sha) => RDB.put(rec.id, got.blob).then(() => inboxEdit((l) => {
        const x = l.find((y) => y.id === rec.id);
        if (x) { x.file = Object.assign({}, x.file, { hasBlob: true, size: got.blob.size, sha, pdfUrl: got.url || x.file.pdfUrl || '', via: got.via }); delete x.file.tried; delete x.expErr; }
      }))).then(() => { if (got.url) usedPdf.set(got.url, rec.id); return inboxParse(rec.id).catch(() => null); }).then(() => true);
    });
  }
  /** 保存到本地。返回 { ok, filename, to } 或 { ok:false, why, nofile?, needPerm? } */
  function inboxExportOne(id, s, force) {
    const opt = inboxOpt(s);
    return inboxGet().then((list) => {
      const rec = list.find((x) => x.id === id);
      if (!rec) return { ok: false, why: '记录不存在' };
      const to = opt.saveTo;
      const path = RI.savePath(rec, opt);
      const old = rec.exp || null;
      const sameTo = old && (old.to || 'downloads') === to;
      if (sameTo && old.path === path && !force) return { ok: true, same: true, filename: path, to };
      // 只保存真正的 PDF：本机简历库里没有就再取一次；还是没有就不保存（绝不把预览网页存成文件）
      const blobP = (rec.file && rec.file.hasBlob ? recBlob(id) : Promise.resolve(null))
        .then((b) => b || refetch(rec, false).then((ok) => (ok ? recBlob(id) : null)));
      return blobP.then((blob) => {
        if (!blob) return { ok: false, nofile: true, why: '没拿到 PDF 原件（平台给的是预览网页），不会把网页存成文件。请点「定位到对话」，在平台上打开一次这份简历的预览或点「下载」，插件会自动接住' };
        if (to === 'folder') {
          return offscreenCall({ type: 'DIR_WRITE', id, path, overwrite: !!(sameTo && old.path === path), removeOld: sameTo && opt.replaceOld && old.path !== path ? old.path : '' })
            .then((r) => (r.ok ? { ok: true, filename: r.path, to, dir: r.dir } : r));
        }
        // 同一份简历改了名字重新保存：上次保存的那个文件删掉，免得一份简历两个文件
        const rm = sameTo && old.downloadId && opt.replaceOld && old.path !== path
          ? new Promise((r) => chrome.downloads.removeFile(old.downloadId, () => { void chrome.runtime.lastError; chrome.downloads.erase({ id: old.downloadId }, () => { void chrome.runtime.lastError; r(); }); }))
          : Promise.resolve();
        return rm.then(() => blobToDataUrl(blob)).then((url) => new Promise((resolve) => {
          chrome.downloads.download({ url, filename: path, saveAs: false, conflictAction: 'uniquify' }, (did) => {
            if (chrome.runtime.lastError || !did) return resolve({ ok: false, why: (chrome.runtime.lastError && chrome.runtime.lastError.message) || '浏览器没有开始下载' });
            resolve({ ok: true, downloadId: did, filename: path, to });
          });
        }));
      }).then((r) => {
        if (!r.ok) {
          return inboxEdit((l2) => {
            const x = l2.find((y) => y.id === id);
            if (!x) return;
            x.expErr = r.why;
            if (r.needPerm) x.expWait = 'perm'; else delete x.expWait;
            if (r.nofile && x.file) x.file.hasBlob = false;
          }).then(() => {
            if (r.needPerm) runlogAdd({ act: '存简历', mod: '简历收集', target: rec.name0 || '候选人', ok: false, cat: 'perm', why: r.why });
            return r;
          });
        }
        return inboxEdit((l2) => { const x = l2.find((y) => y.id === id); if (x) { x.exp = { at: Date.now(), path: r.filename, downloadId: r.downloadId || 0, to: r.to }; delete x.expErr; delete x.expWait; } }).then(() => r);
      });
    });
  }
  function inboxMaybeExport(id) {
    return HRSStore.getSettings(true).then((s) => {
      const opt = inboxOpt(s);
      if (!opt.autoExport) return null;
      return inboxGet().then((list) => {
        const rec = list.find((x) => x.id === id);
        if (!rec || !(rec.file && rec.file.hasBlob)) return null;
        // 缺项的先不存，等你在「简历收集」里补全后再存，免得存一个名字不全的文件
        if (opt.renameOn && RI.missing(rec, opt).length) return null;
        // PDF 里的名字和会话对不上：等你核对
        if (rec.warn) return null;
        return inboxExportOne(id, s, false);
      });
    });
  }
  /**
   * 收一份简历进「简历收集」。msg：会话信息 + file；blob：已确认的 PDF（没有时为 null）；
   * meta.via：怎么拿到的（page / bg / seen / tab / preview / download）；meta.checkName：要不要核对 PDF 里的名字
   */
  function inboxIngest(msg, blob, meta, sender) {
    meta = meta || {};
    return HRSStore.getSettings(true).then((s) => {
      if (s.resumeAutoSave === false) return { ok: false, off: true, why: '简历收集已关闭' };
      const f = msg.file || {};
      const site = msg.site || siteOfUrl(sender && sender.tab && sender.tab.url);
      const rec = {
        id: 'r' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
        at: Date.now(), site, name0: String(msg.name || '').trim(), chatId: String(msg.chatId || ''), jobText: String(msg.jobText || '').slice(0, 80),
        sourceUrl: msg.sourceUrl || '',
        file: {
          name: f.name || '简历.pdf', size: 0, url: /^https?:/i.test(f.url || '') ? f.url : '', pdfUrl: /^https?:/i.test(f.pdfUrl || '') ? f.pdfUrl : '',
          alts: (f.alts || []).filter((u) => /^https?:/i.test(u || '')).slice(0, 8), hasBlob: false, via: blob ? meta.via || '' : ''
        },
        origin: msg.origin === 'request' || msg.origin === 'self' ? msg.origin : '', originWhy: String(msg.originWhy || '').slice(0, 80),
        online: RI.fromOnline(msg.summary || '', msg.workLines || [], { fields: msg.fields || null }), pdf: {}, man: {}
      };
      if (!blob && f.tried) rec.file.tried = f.tried.slice(-8);
      // 岗位：沟通职位文字对插件里的岗位 → 人才库里这个人的岗位 → 智选当时在跑的岗位
      return Promise.all([HRSStore.getJds(), HRSStore.getAllCandidates().catch(() => [])]).then(([jds, cands]) => {
        let jd = RI.matchJd(rec.jobText, jds || [], self.HRSChatTarget);
        const cand = (cands || []).find((c) => (rec.chatId && c.chatId && String(c.chatId) === rec.chatId) || (nrm(c.name) === nrm(rec.name0) && (!rec.jobText || !c.appliedPosition || nrm(c.appliedPosition) === nrm(rec.jobText))));
        if (!jd && cand && cand.jdId) jd = (jds || []).find((j) => j.id === cand.jdId) || { id: cand.jdId, title: cand.jdTitle };
        if (!jd && msg.jdHint) jd = (jds || []).find((j) => j.id === msg.jdHint) || null;
        if (jd) { rec.jdId = jd.id; rec.jdTitle = jd.title; }
        // v2.6.0 插件自己给这个人发过「索要简历」（人才库里有记录）：一定算「请求」
        if (cand && ((cand.messages || []).some((m) => /索要简历/.test(m.type || '')) || cand.resumeStatus === 'requested')) {
          rec.origin = 'request'; rec.originWhy = '插件给 Ta 发过索要简历';
        }
        // v2.6.0 猎聘：只收候选人主动发来的（设置里可以改成都收）
        if (site === 'liepin' && inboxOpt(s).liepinOnlySelf && rec.origin === 'request') {
          runlogAdd({ act: '收简历', mod: '简历收集', site, target: rec.name0 || '候选人', ok: true, detail: '猎聘：这份是我们索要后发来的，按设置不收（' + (rec.originWhy || '') + '）' }, sender);
          return { ok: false, skipped: true, why: '猎聘：这份是我们索要后对方发来的简历，按设置只收候选人主动发的，没有收' };
        }
        if (cand) {
          rec.candId = cand.id;
          const cf = cand.fields || {};
          if (rec.online.age == null && cf.age) rec.online.age = cf.age;
          if (rec.online.years == null && cf.expYears != null) rec.online.years = cf.expYears;
          if (!rec.online.edu && cf.eduText) rec.online.edu = cf.eduText;
        }
        return (blob ? shaOf(blob) : Promise.resolve('')).then((sha) => {
          if (blob) { rec.file.size = blob.size; rec.file.hasBlob = true; rec.file.sha = sha; }
          rec.fp = RI.fingerprint(rec);
          const upgrade = (x) => {
            x.file = Object.assign({}, x.file, { hasBlob: true, size: blob.size, sha, pdfUrl: rec.file.pdfUrl || x.file.pdfUrl || '', via: rec.file.via });
            delete x.file.tried; delete x.expErr;
            if (!x.origin && rec.origin) { x.origin = rec.origin; x.originWhy = rec.originWhy; }
            if (!x.jdId && rec.jdId) { x.jdId = rec.jdId; x.jdTitle = rec.jdTitle; }
            return { upgrade: x };
          };
          return inboxEdit((list) => {
            // 同一份 PDF（内容一样）只收一次
            if (sha) { const same = list.find((x) => x.file && x.file.sha === sha); if (same) return { dup: same }; }
            // 同一个人之前收过但没拿到原件：这次拿到了，补到那条记录上
            if (blob) {
              const lack = list.filter((x) => x.site === rec.site && !(x.file && x.file.hasBlob) && Date.now() - x.at < 7 * 86400000 &&
                ((rec.chatId && x.chatId === rec.chatId) || (!rec.chatId && rec.name0 && x.name0 === rec.name0))).pop();
              if (lack) return upgrade(lack);
            }
            const dup = list.find((x) => x.fp === rec.fp || (!blob && rec.file.url && x.file && x.file.url === rec.file.url));
            if (dup) return blob && !(dup.file && dup.file.hasBlob) ? upgrade(dup) : { dup };
            list.push(rec);
            if (list.length > 3000) list.splice(0, list.length - 3000);
            return { added: rec };
          });
        }).then((r) => {
          if (r.dup) return { ok: true, duplicate: true, id: r.dup.id, hasPdf: !!(r.dup.file && r.dup.file.hasBlob) };
          const target = r.upgrade || r.added, id = target.id;
          if (blob && meta.usedUrl) usedPdf.set(meta.usedUrl, id);
          const saveBlob = blob ? RDB.put(id, blob).catch(() => inboxEdit((l) => { const x = l.find((y) => y.id === id); if (x) x.file.hasBlob = false; })) : Promise.resolve();
          return saveBlob.then(() => {
            const how = { page: '', bg: '', seen: '（会话里加载过的 PDF）', tab: '（临时打开预览页取到的）', preview: '（你打开预览时取到的）', download: '（你在平台上下载时接住的）' }[meta.via] || '';
            runlogAdd({
              act: '收简历', mod: '简历收集', site, target: target.name0 || '候选人', ok: !!blob, cat: blob ? '' : 'gone',
              why: blob ? '' : '会话里有简历，但只拿到预览网页，没拿到 PDF 原件',
              detail: (target.jdTitle || '未识别岗位') + ' · ' + (target.file && target.file.name || '') + (r.upgrade ? ' · 补上了 PDF 原件' : '') + how
            }, sender);
            if (r.added) {
              if (cand) HRSStore.updateCandidate(cand.id, { resumeStatus: 'received', resumeReceivedAt: rec.at }).catch(() => {});
              HRSStore.addEvent({ type: 'resume_received', name: rec.name0 || '候选人', detail: '收到 PDF 简历：' + rec.file.name, jdId: rec.jdId || null, site }).catch(() => {});
            }
            const parsed = blob ? inboxParse(id) : Promise.resolve(null);
            return parsed.then((pr) => {
              if (!blob || !(meta.checkName || r.upgrade)) return null;
              const w = pr ? nameWarn(pr) : '';
              return w ? inboxEdit((l) => { const x = l.find((y) => y.id === id); if (x) x.warn = w + '，请核对后再保存'; }) : null;
            }).then(() => inboxMaybeExport(id)).catch(() => null).then(() => ({ ok: true, id, upgraded: !!r.upgrade, hasPdf: !!blob }));
          });
        });
      });
    });
  }
  // 没拿到原件的：排队在后台临时标签页里再取一次（同时只开一个），取到就按设置保存
  const tabTried = new Set();
  function laterViaTab(id) {
    if (tabTried.has(id)) return;
    tabTried.add(id);
    inboxGet().then((list) => {
      const rec = list.find((x) => x.id === id);
      if (!rec || (rec.file && rec.file.hasBlob)) return null;
      const u = rec.file && rec.file.url;
      if (!isPlatformUrl(u) || self.HRSChatTarget.isCommunicationUrl(siteOfAny(u), u)) return null;
      return refetch(rec, true).then((ok) => (ok ? inboxMaybeExport(id) : null));
    }).catch(() => null);
  }
  function inboxAdd(msg, sender) {
    return HRSStore.getSettings(true).then((s) => {
      if (s.resumeAutoSave === false) return { ok: false, off: true, why: '简历收集已关闭' };
      const f = msg.file || {};
      const tabId = sender && sender.tab ? sender.tab.id : null;
      // 临时标签页那一步放到收进来之后再做，页面不用干等
      return acquire(f, { tabId, since: msg.since || 0, allowTab: false }).then((got) => {
        const file = Object.assign({}, f, { dataUrl: '' });
        if (got && got.blob) file.pdfUrl = got.url || f.pdfUrl || '';
        else file.tried = (got && got.tried) || f.tried || [];
        return inboxIngest(Object.assign({}, msg, { file }), got && got.blob ? got.blob : null, { via: got && got.via, checkName: !!(got && got.checkName), usedUrl: got && got.url }, sender).then((r) => {
          if (r && r.ok && !r.hasPdf && r.id && inboxOpt(s).fetchTab) laterViaTab(r.id);
          return r;
        });
      });
    });
  }

  // ---------- v2.6.1 你在 BOSS / 猎聘上点了「下载」：下载完成后接住这份 PDF，按规则命名保存一份 ----------
  // 原文件留在下载目录不动；能认出是哪个会话才收（看下载时开着的沟通页），认不出就只记一条运行记录
  const dlSeen = new Set();
  chrome.downloads.onChanged.addListener((d) => {
    if (!d || !d.state || d.state.current !== 'complete' || dlSeen.has(d.id)) return;
    dlSeen.add(d.id);
    chrome.downloads.search({ id: d.id }, (items) => { const it = items && items[0]; if (it) captureDownload(it).catch(() => null); });
  });
  function captureDownload(it) {
    if (it.byExtensionId && it.byExtensionId === chrome.runtime.id) return Promise.resolve(null);
    const src = it.finalUrl || it.url || '';
    const fromPlatform = isPlatformUrl(src) || isPlatformUrl(it.referrer) || (/^blob:https:\/\/([^/]+\.)?(zhipin|liepin)\.com\//i.test(src));
    if (!fromPlatform) return Promise.resolve(null);
    if (!(/pdf/i.test(it.mime || '') || /\.pdf$/i.test(it.filename || ''))) return Promise.resolve(null);
    if (it.fileSize > 25 * 1024 * 1024) return Promise.resolve(null);
    const site = siteOfAny(src + ' ' + (it.referrer || ''));
    const base = String(it.filename || '').split(/[\\/]/).pop();
    return HRSStore.getSettings(true).then((s) => {
      if (s.resumeAutoSave === false) return null;
      return commTab(site).then((tab) => {
        // blob: 地址只有页面自己能读：请沟通页帮忙取
        const viaPage = /^blob:/i.test(src) && tab ? new Promise((resolve) => chrome.tabs.sendMessage(tab.id, { type: 'HRS_FETCH_PDF', url: src }, { frameId: 0 }, (r) => {
          void chrome.runtime.lastError;
          resolve(r && r.dataUrl ? RDB.dataUrlToBlob(r.dataUrl) : null);
        })) : Promise.resolve(null);
        return viaPage.then((pb) => (pb ? isPdfBlob(pb).then((ok) => (ok ? { blob: pb, url: '' } : null)) : null))
          .then((hit) => hit || PF.resolve([src, it.url].filter((u) => /^https?:/i.test(u || '')), { fetch: bgFetch, max: 3, depth: 0 }))
          .then((got) => {
            if (!got || !got.blob) {
              runlogAdd({ act: '收简历', mod: '简历收集', site, target: base, ok: false, cat: 'gone', why: '你在平台上下载了这份 PDF，但插件再取一次没取到（链接可能已失效），没有收进「简历收集」' });
              return null;
            }
            const ctxP = tab ? tabCtx(tab.id) : Promise.resolve(null);
            return ctxP.then((ctx) => {
              if (ctx) return inboxIngest(Object.assign({}, ctx, { file: { name: base || (ctx.name + '的简历.pdf'), url: '', pdfUrl: got.url } }), got.blob, { via: 'download', checkName: true, usedUrl: got.url }, tab ? { tab } : null);
              // 沟通页没开：按文件名里的姓名对上之前没拿到原件的那条记录
              return inboxGet().then((list) => {
                const lack = list.filter((x) => x.site === site && !(x.file && x.file.hasBlob) && x.name0 && x.name0.length >= 2 && !RI.isHonorific(x.name0) && base.indexOf(x.name0) >= 0);
                if (lack.length !== 1) {
                  runlogAdd({ act: '收简历', mod: '简历收集', site, target: base, ok: false, cat: 'gone', why: '你在平台上下载了这份 PDF，但认不出是哪个会话的（沟通页没开着），没有收进「简历收集」' });
                  return null;
                }
                const x = lack[0];
                return inboxIngest({ site, name: x.name0, chatId: x.chatId, jobText: x.jobText, origin: x.origin, originWhy: x.originWhy, file: { name: x.file.name, url: x.file.url, pdfUrl: got.url } }, got.blob, { via: 'download', checkName: true, usedUrl: got.url }, null);
              });
            });
          });
      });
    });
  }

  // ---------- v2.6.1 升级：之前把预览网页存成了 .htm 的记录，改回「没拿到 PDF」，在「简历收集」里提示清理 ----------
  function migrateInbox261() {
    return new Promise((r) => chrome.storage.local.get('inboxFix261', (o) => r(o.inboxFix261))).then((done) => {
      if (done) return null;
      return inboxEdit((list) => {
        let n = 0;
        list.forEach((x) => {
          if (x.exp && !(x.file && x.file.hasBlob)) {
            x.badExp = { at: x.exp.at, path: x.exp.path, downloadId: x.exp.downloadId || 0 };
            delete x.exp;
            n++;
          }
        });
        return n;
      }).then((n) => new Promise((r) => chrome.storage.local.set({ inboxFix261: { at: Date.now(), n } }, () => r(n))));
    }).catch(() => null);
  }
  /** 删掉之前误存的网页文件（只删插件自己下载、确实是 .htm/.html 的那些） */
  function cleanBadExports() {
    return inboxGet().then((list) => {
      const bad = list.filter((x) => x.badExp);
      return bad.reduce((p, x) => p.then((acc) => new Promise((resolve) => {
        const did = x.badExp.downloadId;
        if (!did) return resolve(acc);
        chrome.downloads.search({ id: did }, (items) => {
          const it = items && items[0];
          if (!it) return resolve(acc);
          const fn = String(it.filename || '');
          if (!/\.html?$/i.test(fn) || (it.byExtensionId && it.byExtensionId !== chrome.runtime.id)) return resolve(acc);
          const er = () => chrome.downloads.erase({ id: did }, () => { void chrome.runtime.lastError; resolve(acc + 1); });
          if (it.exists) chrome.downloads.removeFile(did, () => { void chrome.runtime.lastError; er(); }); else er();
        });
      })), Promise.resolve(0)).then((removed) => inboxEdit((l) => { l.forEach((x) => { delete x.badExp; }); }).then(() => ({ ok: true, removed, total: bad.length })));
    });
  }
  // 定位到会话：已开着的沟通页直接用（不多开标签页），没有才新开；找人逻辑在页面里，认不准就不点
  function commTab(site) {
    return new Promise((resolve) => chrome.tabs.query({}, (tabs) => {
      const CT = self.HRSChatTarget;
      const list = (tabs || []).filter((t) => {
        const u = t.url || '';
        if (site === 'boss') return /^https:\/\/([^/]+\.)?zhipin\.com\//i.test(u) && CT.isCommunicationUrl('boss', u);
        return /^https:\/\/([^/]+\.)?liepin\.com\//i.test(u) && CT.isCommunicationUrl('liepin', u);
      }).sort((a, b) => (b.active ? 1 : 0) - (a.active ? 1 : 0) || (b.lastAccessed || 0) - (a.lastAccessed || 0));
      resolve(list[0] || null);
    }));
  }
  function inboxLocate(id) {
    return inboxGet().then((list) => {
      const rec = list.find((x) => x.id === id);
      if (!rec) return { ok: false, why: '记录不存在' };
      const name = rec.name0 || (rec.man && rec.man.name) || '';
      if (!name) return { ok: false, why: '没有候选人在平台上的名字，没法定位' };
      const req = { name, job: rec.jobText || '', jd: rec.jdTitle || '', cid: rec.chatId || '', rid: id, at: Date.now() };
      chrome.storage.local.set({ findResult: { rid: id, at: Date.now(), state: 'going', name } });
      const openNew = () => {
        const base = rec.site === 'liepin' ? 'https://lpt.liepin.com/chat/im' : 'https://www.zhipin.com/web/chat/index';
        const url = base + '#hrs_find=' + encodeURIComponent(name) + (req.job ? '&hrs_job=' + encodeURIComponent(req.job) : '') + (req.jd ? '&hrs_jd=' + encodeURIComponent(req.jd) : '') + (req.cid ? '&hrs_cid=' + encodeURIComponent(req.cid) : '') + '&hrs_rid=' + encodeURIComponent(id);
        return chrome.tabs.create({ url }).then((tab) => new Promise((resolve) => chrome.storage.local.get('pendingFind', (o) => {
          const pf = o.pendingFind || {};
          Object.keys(pf).forEach((k) => { if (!pf[k] || Date.now() - (pf[k].at || 0) > 600000) delete pf[k]; });
          pf[tab.id] = req;
          chrome.storage.local.set({ pendingFind: pf }, () => resolve({ ok: true, how: 'new' }));
        })));
      };
      return commTab(rec.site).then((tab) => {
        if (!tab) return openNew();
        return new Promise((resolve) => {
          chrome.tabs.update(tab.id, { active: true }, () => { void chrome.runtime.lastError; });
          chrome.windows.update(tab.windowId, { focused: true }, () => { void chrome.runtime.lastError; });
          let done = false;
          const timer = setTimeout(() => { if (!done) { done = true; resolve(openNew()); } }, 4000);
          chrome.tabs.sendMessage(tab.id, { type: 'HRS_FIND', req }, { frameId: 0 }, (r) => {
            void chrome.runtime.lastError;
            if (done) return;
            done = true; clearTimeout(timer);
            resolve(r && r.ok ? { ok: true, how: 'reuse' } : openNew());
          });
        });
      });
    });
  }

  // =====================================================================
  // v3.6.0 合规与数据：自动决定记录、一个人一条记录、保留期限、按要求删除、加密备份、远程选择器
  // =====================================================================
  const DL = self.HRSDecisionLog, PP = self.HRSPeople, BK = self.HRSBackup;
  const sget = (k) => new Promise((r) => chrome.storage.local.get(k, r));
  const sset = (o) => new Promise((r) => chrome.storage.local.set(o, r));

  // ---------- 自动决定记录：页面每判一个人发一条，攒一会儿一起写 ----------
  const dec = { buf: [], timer: null, chain: Promise.resolve() };
  function engineTag(s) { return 'v' + chrome.runtime.getManifest().version + (s && s.chatEngine === 'unified' ? ' 统一判法' : ''); }
  function decisionAdd(list) {
    (Array.isArray(list) ? list : [list]).forEach((d) => { if (d) dec.buf.push(DL.entry(d)); });
    if (!dec.timer) dec.timer = setTimeout(decisionFlush, 1500);
    return Promise.resolve({ ok: true });
  }
  function decisionFlush() {
    dec.timer = null;
    const add = dec.buf.splice(0);
    if (!add.length) return dec.chain;
    dec.chain = dec.chain.then(() => HRSStore.getSettings()).then((s) => {
      add.forEach((e) => { if (!e.engine) e.engine = engineTag(s); if (!e.kb) e.kb = 'kb' + ((s.kbFamilies || []).length) + '-' + ((s.kbRemoved || []).length) + '-' + Object.keys(s.kbExtra || {}).length; });
      return HRSStore.addDecisions(add);
    }).then(() => sget('procStats')).then((o) => sset({ procStats: DL.pruneAgg(DL.addToAgg(o.procStats, add)) })).catch(() => {});
    return dec.chain;
  }

  // ---------- 人才库：同一个人合成一条（别的页面拿着旧 id 来改时，按别名找到合并后的那条） ----------
  const talentQ = { chain: Promise.resolve() };
  function talentSerial(fn) { const p = talentQ.chain.then(fn); talentQ.chain = p.catch(() => {}); return p; }
  function aliasMap() { return sget('talentAlias').then((o) => o.talentAlias || {}); }
  function resolveId(id) {
    return HRSStore.getCandidate(id).then((c) => (c ? id : aliasMap().then((m) => m[id] || id)));
  }
  function talentAdd(c) {
    return talentSerial(() => Promise.all([HRSStore.getAllCandidates(), aliasMap()]).then(([all, am]) => {
      const mainId = am[c.id];
      const same = (mainId && all.find((x) => x.id === mainId)) || PP.findSame(all, c);
      const rec = PP.merge(same || null, c);
      if (!same) rec.id = c.id || ('c_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8));
      const writes = [HRSStore.putAll('candidates', [Object.assign(rec, { updatedAt: Date.now(), seenAt: rec.seenAt || Date.now() })])];
      if (same && c.id && c.id !== same.id && am[c.id] !== same.id) { am[c.id] = same.id; writes.push(sset({ talentAlias: am })); }
      return Promise.all(writes).then(() => ({ ok: true, id: rec.id, merged: !!(same && same.id !== c.id) }));
    }));
  }
  function talentUpdate(id, patch, appendMessage) {
    return talentSerial(() => resolveId(id).then((rid) => HRSStore.getCandidate(rid).then((old) => {
      if (!old) return { ok: false };
      const p = Object.assign({}, patch || {});
      if (appendMessage) p.messages = (old.messages || []).concat([appendMessage]);
      // 改联系状态：当前岗位那条投递记录一起改
      if (p.contactStatus && Array.isArray(old.applications)) {
        p.applications = old.applications.map((a) => (a.jdId === (p.jdId || old.jdId) ? Object.assign({}, a, { contactStatus: p.contactStatus }) : a));
      }
      if (p.verdict && Array.isArray(old.applications)) {
        p.applications = (p.applications || old.applications).map((a) => (a.jdId === (p.jdId || old.jdId) ? Object.assign({}, a, { verdict: p.verdict }) : a));
      }
      return HRSStore.updateCandidate(rid, p).then(() => ({ ok: true, id: rid }));
    })));
  }
  function deletionLog(kind, counts, note) {
    return sget('deletionLog').then((o) => {
      const arr = (o.deletionLog || []).concat([{ at: Date.now(), kind, counts, note: note || '' }]).slice(-2000);
      return sset({ deletionLog: arr });
    });
  }
  // v3.6.0 第一次启动：已有的人才库按「一个人一条」合并一次。合并前整库备份一份，可以在「设置 · 合规」撤销
  function migratePeople() {
    return sget(['peopleMerge360']).then((o) => {
      if (o.peopleMerge360) return null;
      return HRSStore.getAllCandidates().then((all) => {
        const r = PP.dedupe(all || []);
        const am = {};
        (all || []).forEach((c) => { if (r.removed.indexOf(c.id) >= 0) { const main = r.list.find((x) => (x.aliases || []).indexOf(c.id) >= 0); if (main) am[c.id] = main.id; } });
        const mark = { at: Date.now(), before: (all || []).length, after: r.list.length, groups: r.groups };
        if (!r.groups) return sset({ peopleMerge360: mark });
        return sset({ talentPreMerge: { at: Date.now(), list: all } })
          .then(() => HRSStore.putAll('candidates', r.list, true))
          .then(() => aliasMap()).then((old) => sset({ talentAlias: Object.assign(old, am), peopleMerge360: mark }))
          .then(() => HRSStore.addEvent({ type: 'settings', name: '人才库', detail: '同一个人合成一条：' + mark.before + ' 条记录合成 ' + mark.after + ' 人（合并前的数据已备份，可在「设置 · 合规」撤销）' }));
      });
    }).catch(() => null);
  }
  function undoPeopleMerge() {
    return sget('talentPreMerge').then((o) => {
      const b = o.talentPreMerge;
      if (!b || !Array.isArray(b.list)) return { ok: false, why: '没有合并前的备份' };
      return HRSStore.putAll('candidates', b.list, true).then(() => sset({ talentAlias: {} }))
        .then(() => new Promise((r) => chrome.storage.local.remove('talentPreMerge', r)))
        .then(() => HRSStore.addEvent({ type: 'settings', name: '人才库', detail: '已撤销「同一个人合成一条」，恢复成 ' + b.list.length + ' 条记录' }))
        .then(() => ({ ok: true, n: b.list.length }));
    });
  }

  // ---------- 按要求删除：这个人在插件里的所有记录（人才库、简历收集和 PDF、已保存的文件、决定记录、处理记录、待确认） ----------
  function removeSavedFile(exp) {
    if (!exp || !exp.path) return Promise.resolve(false);
    if (exp.to === 'folder') return offscreenCall({ type: 'DIR_REMOVE', path: exp.path }).then((r) => !!(r && r.ok));
    if (!exp.downloadId) return Promise.resolve(false);
    return new Promise((r) => chrome.downloads.removeFile(exp.downloadId, () => { const bad = chrome.runtime.lastError; chrome.downloads.erase({ id: exp.downloadId }, () => { void chrome.runtime.lastError; r(!bad); }); }));
  }
  function personPurge(id, kind) {
    return talentSerial(() => resolveId(id).then((rid) => HRSStore.getCandidate(rid)).then((c) => {
      if (!c) return { ok: false, why: '人才库里没有这个人' };
      const counts = { cand: 1, inbox: 0, pdf: 0, files: 0, decisions: 0, events: 0, pending: 0 };
      const lm = PP.logMatch(c);
      return inboxGet().then((list) => {
        const hit = PP.inboxMatches(list, c);
        counts.inbox = hit.length;
        return Promise.all(hit.map((r) => removeSavedFile(r.exp).then((ok) => { if (ok) counts.files++; })
          .then(() => RDB.del(r.id).then(() => { if (r.file && r.file.hasBlob) counts.pdf++; }).catch(() => null))))
          .then(() => inboxEdit((l) => { const ids = new Set(hit.map((r) => r.id)); for (let i = l.length - 1; i >= 0; i--) if (ids.has(l[i].id)) l.splice(i, 1); }));
      }).then(() => Promise.all((c.resumeFiles || []).map((f) => removeSavedFile({ to: 'downloads', path: f.filename, downloadId: f.downloadId }).then((ok) => { if (ok) counts.files++; }))))
        .then(() => HRSStore.purgeWhere('decisions', lm)).then((n) => { counts.decisions = n; })
        .then(() => HRSStore.purgeWhere('events', lm)).then((n) => { counts.events = n; })
        .then(() => sget(['rejectPending', 'talentAlias'])).then((o) => {
          const ids = [c.id].concat(c.aliases || []);
          const pend = (o.rejectPending || []).filter((p) => { const gone = ids.indexOf(p.cand) >= 0 || ids.indexOf(p.itemId) >= 0 || lm({ name: p.name, cid: p.cid, jdId: p.jdId }); if (gone) counts.pending++; return !gone; });
          const am = o.talentAlias || {};
          Object.keys(am).forEach((k) => { if (am[k] === c.id) delete am[k]; });
          return sset({ rejectPending: pend, talentAlias: am });
        })
        .then(() => HRSStore.deleteCandidate(c.id))
        .then(() => deletionLog(kind || 'request', counts, kind === 'request' ? '候选人要求删除' : ''))
        .then(() => ({ ok: true, counts }));
    }));
  }

  // ---------- 保留期限：每天检查一次，到期的删掉（面试 / 录用的不删） ----------
  function retentionRun(force) {
    return Promise.all([HRSStore.getSettings(true), HRSStore.getAllCandidates()]).then(([s, all]) => {
      const pl = PP.plan(all || [], s);
      if (!pl.on && !force) return { ok: true, off: true, plan: pl };
      if (!pl.due.length) return { ok: true, n: 0, plan: pl };
      const byCls = { reject: 0, resume: 0 };
      return pl.due.reduce((p, d) => p.then(() => personPurge(d.id, 'retention-item').then((r) => { if (r.ok) byCls[d.cls]++; })), Promise.resolve())
        .then(() => sget('deletionLog')).then((o) => {
          // 一个个删的明细合成一条「到期删除」
          const arr = (o.deletionLog || []).filter((x) => x.kind !== 'retention-item');
          const items = (o.deletionLog || []).filter((x) => x.kind === 'retention-item');
          const sum = items.reduce((a, x) => { Object.keys(x.counts || {}).forEach((k) => { a[k] = (a[k] || 0) + x.counts[k]; }); return a; }, {});
          arr.push({ at: Date.now(), kind: 'retention', counts: sum, note: '到期自动删除：不合适 / 没沟通 ' + byCls.reject + ' 人，收到简历未面试 ' + byCls.resume + ' 人' });
          return sset({ deletionLog: arr.slice(-2000) });
        }).then(() => ({ ok: true, n: pl.due.length, plan: pl }));
    });
  }
  function retentionExtend(id, days) {
    return Promise.all([resolveId(id), HRSStore.getSettings(true)]).then(([rid, s]) => HRSStore.getCandidate(rid).then((c) => {
      if (!c) return { ok: false };
      const base = Math.max(Date.now(), PP.dueAt(c, s) || 0);
      return HRSStore.updateCandidate(rid, { keepUntil: base + (parseInt(days, 10) || 90) * 86400000 }).then(() => ({ ok: true }));
    }));
  }

  // ---------- 加密备份：每天自动一份（不带 PDF），写到简历收集选的文件夹；没选文件夹就存到下载目录 ----------
  function backupApi() {
    return { get: (k) => sget(k), all: (st) => HRSStore.getAll(st), pdf: (id) => RDB.get(id), toDataUrl: blobToDataUrl };
  }
  function backupAuto(force) {
    return Promise.all([HRSStore.getSettings(true), sget(['backupKey', 'backupState'])]).then(([s, o]) => {
      const st = o.backupState || {};
      if (!force && (!s.backupAuto || (st.lastAuto && Date.now() - st.lastAuto < 20 * 3600000))) return { ok: true, skip: true };
      if (!o.backupKey) return { ok: false, why: '还没设置备份密码' };
      return BK.collect(backupApi(), { withPdf: false }).then((d) => BK.encrypt(d, o.backupKey, { version: chrome.runtime.getManifest().version, auto: true }))
        .then((file) => {
          const text = JSON.stringify(file), name = BK.fileName(new Date(), true);
          const toDl = () => blobToDataUrl(new Blob([text], { type: 'application/octet-stream' })).then((url) => new Promise((resolve) => {
            chrome.downloads.download({ url, filename: 'SmartFilter-backup/' + name, saveAs: false, conflictAction: 'overwrite' }, (did) => {
              resolve(chrome.runtime.lastError || !did ? { ok: false, why: (chrome.runtime.lastError && chrome.runtime.lastError.message) || '没开始下载' } : { ok: true, where: '下载目录 / SmartFilter-backup / ' + name });
            });
          }));
          return offscreenCall({ type: 'DIR_PUT', path: 'SmartFilter-backup/' + name, text, overwrite: true, keep: 7, prefix: 'SmartFilter-backup-', suffix: '-auto.sfbak' }, 60000)
            .then((r) => (r && r.ok ? { ok: true, where: '「' + r.dir + '」/ ' + r.path } : toDl()))
            .then((r) => sset({ backupState: Object.assign({}, st, r.ok ? { lastAt: Date.now(), lastAuto: Date.now(), where: r.where, size: text.length, err: '', counts: file.counts } : { err: r.why, errAt: Date.now() }) }).then(() => r));
        });
    }).catch((e) => sset({ backupState: { err: String(e && e.message || e), errAt: Date.now() } }).then(() => ({ ok: false, why: String(e && e.message || e) })));
  }

  // ---------- 远程选择器配置：每天取一次 ----------
  function selectorFetch(force) {
    return HRSStore.getSettings(true).then((s) => {
      const url = String(s.selectorConfigUrl || '').trim();
      if (!url) return { ok: false, why: '没填地址' };
      return sget('selectorRemote').then((o) => {
        const st = o.selectorRemote || {};
        if (!force && st.at && Date.now() - st.at < 20 * 3600000) return { ok: true, skip: true };
        const ctl = new AbortController(), timer = setTimeout(() => ctl.abort(), 20000);
        return fetch(url, { cache: 'no-store', signal: ctl.signal }).then((r) => { clearTimeout(timer); if (!r.ok) throw new Error('服务器返回 ' + r.status); return r.json(); })
          .then((j) => {
            const v = self.HRSRemoteConfig.validate(j, self.HRSSiteConfig.CONFIG);
            if (!v.ok) return sset({ selectorRemote: { at: Date.now(), ok: false, why: v.problems.join('；'), url } }).then(() => ({ ok: false, why: v.problems.join('；') }));
            const cfg = self.HRSRemoteConfig.apply(s.siteConfig, v, self.HRSSiteConfig.CONFIG);
            return HRSStore.saveSettings({ siteConfig: cfg })
              .then(() => sset({ selectorRemote: { at: Date.now(), ok: true, version: v.version, keys: v.keys, warn: v.problems.join('；'), url } }))
              .then(() => { runlogAdd({ mod: '其他', act: '更新选择器', target: v.version || url, ok: true, detail: '远程选择器配置已更新：' + v.keys + ' 项' }, null); return { ok: true, version: v.version, keys: v.keys, warn: v.problems }; });
          })
          .catch((e) => { clearTimeout(timer); const why = /abort/i.test(String(e && e.name)) ? '20 秒没取到' : String(e && e.message || e); return sset({ selectorRemote: Object.assign({}, st, { at: Date.now(), ok: false, why, url }) }).then(() => ({ ok: false, why })); });
      });
    });
  }

  // ---------- 每天一次的维护：保留期限、决定记录和处理记录到期、自动备份、远程选择器 ----------
  function dailyMaint(force) {
    return sget('maintAt').then((o) => {
      if (!force && o.maintAt && Date.now() - o.maintAt < 20 * 3600000) return { ok: true, skip: true };
      return sset({ maintAt: Date.now() }).then(() => HRSStore.getSettings(true)).then((s) => {
        const cut = DL.cutoff(Date.now(), s.decisionDays);
        const out = {};
        return retentionRun(false).then((r) => { out.retention = r && r.n; })
          .then(() => HRSStore.purgeBefore('decisions', cut)).then((n) => { out.decisions = n; })
          .then(() => HRSStore.purgeBefore('events', cut)).then((n) => { out.events = n; })
          .then(() => sget('procStats')).then((p) => sset({ procStats: DL.pruneAgg(p.procStats) }))
          .then(() => backupAuto(false)).then((r) => { out.backup = r; })
          .then(() => selectorFetch(false)).then((r) => { out.selector = r; })
          .then(() => { if (out.decisions || out.events) deletionLog('expire', { decisions: out.decisions, events: out.events }, '决定明细和处理记录超过 ' + DL.days(s.decisionDays) + ' 天'); return out; });
      });
    }).catch((e) => ({ ok: false, why: String(e && e.message || e) }));
  }
  chrome.alarms.onAlarm.addListener((alarm) => { if (alarm.name === 'hrsDailyHealth') dailyMaint(false); });
  setTimeout(() => { migratePeople().then(() => dailyMaint(false)); }, 4000);

  function complianceState() {
    return Promise.all([HRSStore.getSettings(true), HRSStore.getAllCandidates(), sget(['rejectPending', 'backupState', 'aiUsage', 'deletionLog', 'procStats', 'selectorRemote', 'talentPreMerge', 'peopleMerge360', 'backupKey', 'maintAt'])])
      .then(([s, all, o]) => ({
        pia: s.pia || {}, retention: PP.ret(s), plan: PP.plan(all || [], s), pending: (o.rejectPending || []).length,
        backup: Object.assign({}, o.backupState || {}, { hasKey: !!o.backupKey }), ai: o.aiUsage || null,
        deletions: (o.deletionLog || []).slice(-50).reverse(), months: DL.aggRows(o.procStats), selector: o.selectorRemote || null,
        merge: { mark: o.peopleMerge360 || null, canUndo: !!(o.talentPreMerge && o.talentPreMerge.list) }, maintAt: o.maintAt || 0,
        candidates: (all || []).length
      }));
  }

    // ---------- 消息路由 ----------
  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    const p = handle(msg, sender);
    if (p && p.then) p.then(sendResponse).catch((e) => sendResponse({ error: String(e && e.message || e) }));
    return !!(p && p.then);
  });

  function handle(msg, sender) {
    switch (msg.type) {
      case 'GET_STATE':
        return HRSStore.getSettings().then((s) => HRSStore.getActiveJd().then((jd) =>
          HRSStore.getJds().then((jds) => {
            const cfg = s.siteConfig || null;
            return { settings: s, activeJd: jd, jds: jds || [], siteConfig: cfg };
          })));

      case 'TALENT_FIND':
        // v1.9.19 按姓名 + 岗位找人才库里的旧记录（之前判过通过 / 已联系的人不再自动拒绝）
        // v3.6.0 一个人一条记录：看这个人在这个岗位上的投递记录
        return HRSStore.getAllCandidates().then((cands) => {
          const n = nrm(msg.name);
          const hit = (cands || []).map((c) => (nrm(c.name) === n ? (msg.jdId || msg.jdTitle ? PP.appOf(c, msg.jdId, msg.jdTitle) : PP.apps(c)[0] || c) : null)).filter(Boolean);
          const good = hit.find((a) => a.verdict === 'pass' || /contacted|interview|offer/.test(a.contactStatus || ''));
          return { found: hit.length, good: good ? { verdict: good.verdict, status: good.contactStatus || '', at: good.at || good.seenAt || 0 } : null };
        });
      case 'TALENT_ADD': {
        const c = msg.candidate || {};
        c.source = c.source || (sender.tab && sender.tab.url ? new URL(sender.tab.url).hostname : 'unknown');
        // v1.1.0：合格者先进入人才库并自动索要简历；只有候选人真正回传 PDF 时才落盘，
        // 不再在判定通过时生成占位 JSON 当作“简历文件”。
        // v3.6.0 同一个人（会话编号、手机、邮箱、姓名 + 公司）合成一条，每个岗位一条投递记录
        return talentAdd(c).then((r) => {
          bumpStats({ count: 1, passed: c.verdict === 'pass' ? 1 : 0, rejected: c.verdict === 'reject' ? 1 : 0 });
          return r;
        });
      }

      case 'SAVE_RESUME_FILE': {
        const id = msg.candidateId;
        const file = msg.file || {};
        if (!id) return Promise.resolve({ ok: false, error: '缺少候选人ID' });
        return Promise.all([HRSStore.getSettings(), resolveId(id).then((rid) => HRSStore.getCandidate(rid))]).then((r) => {
          const s = r[0], old = r[1] || {};
          const candidate = Object.assign({}, old, {
            id: old.id || id,
            name: old.name || msg.candidateName || '',
            chatId: old.chatId || msg.chatId || '',
            sourceUrl: old.sourceUrl || msg.sourceUrl || '',
            jdId: old.jdId || msg.jdId || null,
            jdTitle: old.jdTitle || msg.jdTitle || '',
            verdict: old.verdict || 'pass',
            source: old.source || 'resume-inbox'
          });
          const existing = candidate.resumeFiles || [];
          const duplicate = existing.some((x) => (file.url && x.url === file.url) || (file.name && x.name === file.name && x.jdTitle === candidate.jdTitle));
          if (duplicate) return { ok: true, duplicate: true, filename: file.name || '' };
          return HRSExporter.saveResumeFile(file, candidate, s).then((saved) => {
            const rec = {
              name: file.name || '',
              filename: saved.filename,
              downloadId: saved.downloadId,
              url: file.url || '',
              size: file.size || 0,
              receivedAt: Date.now(),
              jdId: candidate.jdId,
              jdTitle: candidate.jdTitle
            };
            const patch = {
              name: candidate.name,
              chatId: candidate.chatId,
              sourceUrl: candidate.sourceUrl,
              jdId: candidate.jdId,
              jdTitle: candidate.jdTitle,
              verdict: candidate.verdict,
              resumeStatus: 'received',
              resumeReceivedAt: rec.receivedAt,
              resumeFiles: existing.concat([rec])
            };
            return HRSStore.addCandidate(Object.assign({}, candidate, patch)).then(() => HRSStore.addEvent({
              type: 'resume_received',
              name: candidate.name || '候选人',
              detail: '候选人回传 PDF，已归档：' + saved.filename,
              jdId: candidate.jdId,
              site: candidate.source || ''
            })).then(() => ({ ok: true, downloadId: saved.downloadId, filename: saved.filename }));
          });
        }).catch((e) => ({ ok: false, error: String(e && e.message || e) }));
      }

      case 'TALENT_UPDATE':
        return talentUpdate(msg.id, msg.patch, msg.appendMessage);
      case 'TALENT_DELETE':
        return resolveId(msg.id).then((rid) => HRSStore.deleteCandidate(rid)).then(() => deletionLog('manual', { cand: 1 }, '工作台里删除')).then(() => ({ ok: true }));
      // ---------- v3.6.0 合规与数据 ----------
      case 'DECISION_ADD':
        return decisionAdd(msg.list || msg.d);
      case 'DECISION_LIST':
        return decisionFlush().then(() => HRSStore.getDecisions({ name: msg.name, cid: msg.cid, jdId: msg.jdId, since: msg.since, limit: msg.limit || 200 }));
      case 'TALENT_HR': {
        // HR 对一个人做的处理：overturn 改为合格 / manual_review 转人工复核 / explain 生成决定说明 / reject_confirmed 确认拒绝
        const act = msg.action;
        return resolveId(msg.id).then((rid) => HRSStore.getCandidate(rid)).then((c) => {
          if (!c) return { ok: false, why: '人才库里没有这个人' };
          const patch = act === 'overturn' ? { verdict: 'pass', contactStatus: 'new', overturnedAt: Date.now() }
            : act === 'manual_review' ? { verdict: 'review', contactStatus: 'review', manualReviewAt: Date.now() }
              : act === 'reject_confirmed' ? { contactStatus: 'rejected', rejectConfirmedAt: Date.now() } : {};
          const d = { site: c.source, module: 'hr', jdId: c.jdId, job: c.jdTitle, name: c.name, cid: c.chatId, cand: c.id, verdict: patch.verdict || c.verdict, by: 'hr', action: act, note: msg.note || '', reasons: c.reasons };
          return (Object.keys(patch).length ? talentUpdate(c.id, patch) : Promise.resolve()).then(() => decisionAdd(d)).then(() => ({ ok: true }));
        });
      }
      case 'PERSON_PURGE':
        return personPurge(msg.id, 'request');
      case 'RETENTION_RUN':
        return retentionRun(true);
      case 'RETENTION_EXTEND':
        return retentionExtend(msg.id, msg.days);
      case 'COMPLIANCE_STATE':
        return complianceState();
      case 'PEOPLE_UNDO_MERGE':
        return undoPeopleMerge();
      case 'BACKUP_AUTO_NOW':
        return backupAuto(true);
      case 'BACKUP_DONE':
        return sget('backupState').then((o) => sset({ backupState: Object.assign({}, o.backupState || {}, { lastAt: Date.now(), where: msg.where || '手动导出', err: '', counts: msg.counts || null }) })).then(() => ({ ok: true }));
      case 'SELCFG_FETCH':
        return selectorFetch(true);
      case 'MAINT_NOW':
        return dailyMaint(true);

      case 'EVENT':
        return HRSStore.addEvent({
          type: msg.eventType || 'log',
          detail: msg.detail || '',
          name: msg.name || '',
          jdId: msg.jdId || null,
          site: msg.site || null
        }).then(() => {
          bumpStats(msg.delta || {});
          return { ok: true };
        });

      case 'DIAG_LOG':
        return chrome.storage.local.set({ diagLog: msg.data }).then(() => ({ ok: true }));

      case 'GET_DIAG':
        return new Promise((res) => chrome.storage.local.get('diagLog', (o) => res(o.diagLog || null)));

      case 'GET_DASHBOARD_DATA':
        return Promise.all([
          HRSStore.getAllCandidates(),
          HRSStore.getEvents(500),
          HRSStore.getJds(),
          HRSStore.getSettings()
        ]).then((r) => ({ candidates: r[0], events: r[1], jds: r[2], settings: r[3] }));

      case 'SAVE_JD':
        return HRSStore.getJds().then((jds) => {
          const d = msg.jd;
          const idx = jds.findIndex((j) => j.id === d.id);
          if (idx >= 0) jds[idx] = d; else jds.push(d);
          return HRSStore.saveJds(jds).then(() => ({ ok: true }));
        });

      case 'MERGE_JDS':
        // v1.9.15 两边平台的同一个岗位合并成一条：条件用 Boss 那条，加上猎聘标签和猎聘名，猎聘的上限和打招呼语带过来
        return HRSStore.getJds().then((jds) => {
          let n = 0;
          (msg.pairs || []).forEach((p) => {
            const b = jds.find((j) => j.id === p.bossId), l = jds.find((j) => j.id === p.liepinId);
            if (!b || !l) return;
            b.sources = Array.from(new Set((b.sources || []).concat(['boss', 'liepin'])));
            if (nrm(l.platformJob || l.title) !== nrm(b.platformJob || b.title)) b.liepinJob = l.platformJob || l.title;
            b.quota = Object.assign({}, b.quota || {}, { liepinScreen: (l.quota || {}).liepinScreen || 0, liepinGreet: (l.quota || {}).liepinGreet || 0 });
            if (l.greet && l.greet.msg && !(b.greet || {}).msg) b.greet = Object.assign({}, b.greet || {}, { msg: l.greet.msg });
            jds.forEach((j) => { if (j.base && j.base.from === l.id) j.base.from = b.id; });
            const i = jds.indexOf(l); if (i >= 0) jds.splice(i, 1);
            n++;
          });
          return HRSStore.saveJds(jds).then(() => ({ ok: true, merged: n }));
        });

      case 'DELETE_JDS':
        // v1.9.14 抓取职位时批量删除平台上已经不在的岗位；在别的平台还在的只去掉这个平台的来源
        return HRSStore.getJds().then((jds) => {
          const del = new Set(msg.ids || []), strip = new Set(msg.stripIds || []);
          const next = jds.filter((j) => !del.has(j.id)).map((j) => {
            if (strip.has(j.id)) { j.sources = (j.sources || []).filter((x) => x !== msg.site); if (msg.site === 'boss') j.greetJob = ''; }
            if (j.base && j.base.from && del.has(j.base.from)) j.base = { from: '', cities: '', ageMin: null, ageMax: null, edu: 0, exp: null, chip: false };
            return j;
          });
          return HRSStore.saveJds(next).then(() => HRSStore.getSettings().then((s) => {
            if (s.activeJdId && del.has(s.activeJdId)) return HRSStore.saveSettings({ activeJdId: next.length ? next[0].id : null });
            return null;
          })).then(() => ({ ok: true, deleted: del.size, stripped: strip.size }));
        });

      case 'DELETE_JD':
        return HRSStore.getJds().then((jds) => {
          const next = jds.filter((j) => j.id !== msg.id);
          return HRSStore.saveJds(next).then(() => HRSStore.getSettings().then((s) => {
            if (s.activeJdId === msg.id) return HRSStore.saveSettings({ activeJdId: next.length ? next[0].id : null });
            return null;
          })).then(() => ({ ok: true }));
        });

      case 'SAVE_SETTINGS':
        return HRSStore.saveSettings(msg.patch || {}).then((s) => ({ ok: true, settings: s }));

      case 'EXPORT_CANDIDATE':
        return HRSStore.getSettings().then((s) => HRSExporter.exportCandidate(msg.candidate, s)).then((id) => ({ ok: true, id }));

      case 'EXPORT_LIBRARY':
        return HRSStore.getAllCandidates().then((cands) =>
          HRSExporter.exportLibrary(cands, msg.format || 'both')).then(() => ({ ok: true }));

      case 'EXPORT_REPORT':
        return healthCheck(true).then((r) => HRSExporter.exportReport(r)).then(() => ({ ok: true }));

      case 'HEALTH_CHECK':
        return healthCheck(true);

      case 'RESET_DIAG':
        return chrome.storage.local.remove('diagLog').then(() => ({ ok: true }));

      // ---------- v1.6.0 抓取职位 ----------
      case 'FETCH_SAVE': {
        const job = msg.job || {};
        return new Promise((resolve) => {
          chrome.storage.local.get('jobFetch', (o) => {
            const f = o.jobFetch || { boss: [], liepin: [], seq: 0 };
            const src = job.source === 'liepin' ? 'liepin' : 'boss';
            f[src] = (f[src] || []).filter((x) => !(x.title === job.title && (x.city || '') === (job.city || '')));
            f[src].push(Object.assign({ at: Date.now() }, job));   // 原样记录抓取结果（导航文字也记，方便排查）
            f.seq = (f.seq || 0) + 1;
            f.at = Date.now();
            chrome.storage.local.set({ jobFetch: f }, () => upsertFetchedJob(job).then(() => {
              if (msg.closeTab && sender && sender.tab && sender.tab.id) {
                captureTabs.delete(sender.tab.id);
                setTimeout(() => { try { chrome.tabs.remove(sender.tab.id); } catch (e) {} }, 400);
              }
              resolve({ ok: true, count: f[src].length });
            }));
          });
        });
      }
      case 'FETCH_EXPECT':
        // 猎聘列表页即将点「预览」：记下来，下一个由这个标签页打开的新标签页就是要读的预览页
        pendingCapture = { opener: sender && sender.tab ? sender.tab.id : null, info: msg.info || {}, at: Date.now() };
        return Promise.resolve({ ok: true });
      case 'FETCH_AM_I_CAPTURE': {
        const id = sender && sender.tab ? sender.tab.id : null;
        const info = id != null ? captureTabs.get(id) : null;
        return Promise.resolve(info ? { capture: true, info: info } : { capture: false });
      }
      case 'FETCH_MODAL_RELAY':
        // 列表在 iframe 里、预览窗口在最外层：转给最外层页面去读
        return new Promise((resolve) => {
          if (!sender || !sender.tab) return resolve({ found: false });
          chrome.tabs.sendMessage(sender.tab.id, { type: 'FETCH_READ_MODAL', timeout: msg.timeout || 4000 }, { frameId: 0 }, (r) => {
            if (chrome.runtime.lastError) return resolve({ found: false, error: chrome.runtime.lastError.message });
            resolve(r || { found: false });
          });
        });
      case 'DETAIL_READ_URL':
        return detailReadUrl(msg.url, sender && sender.tab ? sender.tab.id : null);
      case 'DETAIL_CATCH_TAB':
        return detailCatchTab(sender && sender.tab ? sender.tab.id : null, msg.timeout);
      case 'AI_JUDGE':
        return aiJudge(msg);
      case 'FETCH_OPEN':
        // 猎聘「预览」是带地址的链接时，直接由后台打开（不受弹窗拦截）
        return new Promise((resolve) => {
          const opts = { url: msg.url, active: false };
          if (sender && sender.tab) opts.openerTabId = sender.tab.id;
          chrome.tabs.create(opts, () => resolve({ ok: !chrome.runtime.lastError }));
        });
      case 'TRUSTED_MOVE':
      case 'TRUSTED_CLICK':
        // v1.9.48 Boss 页面在 RPA 模式下不再挂浏览器调试器（真实点击全部交给本机 RPA 助手）。猎聘不变
        return bossRpaBlocked(sender).then((blocked) => {
          if (blocked) return { ok: false, why: 'Boss 已改用 RPA 助手，不再用浏览器调试器点击' };
          return msg.type === 'TRUSTED_MOVE'
            ? trustedMove(sender && sender.tab ? sender.tab.id : null, msg.x, msg.y)
            : trustedClick(sender && sender.tab ? sender.tab.id : null, msg.x, msg.y);
        });
      case 'TRUSTED_RELEASE':
        return releaseDebugger().then(() => ({ ok: true }));

      // ---------- v1.9.49 人才库「打开沟通会话 / 面试安排」：新开的沟通页来领「要找谁」 ----------
      case 'FIND_TAKE':
        return new Promise((resolve) => {
          const tid = sender && sender.tab ? sender.tab.id : null;
          if (tid == null) return resolve(null);
          chrome.storage.local.get('pendingFind', (o) => {
            const pf = o.pendingFind || {};
            const req = pf[tid] || null;
            if (req) { delete pf[tid]; chrome.storage.local.set({ pendingFind: pf }); }
            resolve(req && Date.now() - (req.at || 0) < 600000 ? req : null);
          });
        });

      // ---------- v2.5.0 简历收集 ----------
      case 'INBOX_ADD':
        return inboxAdd(msg, sender);
      case 'INBOX_PATCH':
        // 页面上改了某份简历的字段 / 岗位
        return inboxEdit((list) => {
          const x = list.find((y) => y.id === msg.id);
          if (!x) return { ok: false, why: '记录不存在' };
          if (msg.man) x.man = Object.assign({}, x.man || {}, msg.man);
          Object.keys(x.man || {}).forEach((k) => { if (x.man[k] === '' || x.man[k] == null) delete x.man[k]; });
          if (msg.jd !== undefined) { x.jdId = msg.jd ? msg.jd.id : ''; x.jdTitle = msg.jd ? msg.jd.title : ''; }
          if (msg.seen) x.seen = Date.now();
          if (msg.pdf) x.pdf = msg.pdf;   // 页面补读的 PDF 结果
          if (msg.origin !== undefined) { x.origin = msg.origin === 'request' || msg.origin === 'self' ? msg.origin : ''; x.originWhy = '你改的'; }
          if (msg.clearWarn) delete x.warn;   // v2.6.1 你核对过 PDF 里的名字没问题
          return { ok: true };
        }).then((r) => (r.ok && msg.export ? inboxMaybeExport(msg.id).then((e) => Object.assign(r, { exp: e })) : r));
      case 'INBOX_EXPORT':
        return HRSStore.getSettings(true).then((s) => {
          const out = [];
          return (msg.ids || []).reduce((p, id) => p.then(() => inboxExportOne(id, s, !!msg.force).then((r) => out.push(Object.assign({ id }, r)))), Promise.resolve()).then(() => ({ ok: true, results: out }));
        });
      // ---------- v2.6.1 PDF 原件 ----------
      case 'PDF_SEEN': {
        const tid = sender && sender.tab ? sender.tab.id : null;
        const urls = (msg.urls || []).filter((u) => /^https?:/i.test(u || '')).slice(0, 10);
        if (tid == null || !urls.length) return Promise.resolve({ ok: false });
        seenAdd(tid, urls);
        const w = fetchTabs.get(tid);
        if (w) w(urls); else previewCapture(tid);
        return Promise.resolve({ ok: true });
      }
      case 'FETCH_TAB_Q':
        return Promise.resolve({ fetchTab: !!(sender && sender.tab && fetchTabs.has(sender.tab.id)) });
      case 'INBOX_REFETCH':
        // 「重新取 PDF」：再取一次原件（允许临时打开预览页），取到就按设置保存
        return inboxGet().then((list) => {
          const rec = list.find((x) => x.id === msg.id);
          if (!rec) return { ok: false, why: '记录不存在' };
          if (rec.file && rec.file.hasBlob) return { ok: true, had: true };
          return refetch(rec, true).then((ok) => (ok ? inboxMaybeExport(rec.id).then((e) => ({ ok: true, exp: e })) : { ok: false, why: '还是没取到 PDF 原件。请点「定位到对话」，在平台上打开一次这份简历的预览或点「下载」，插件会自动接住' }));
        });
      case 'INBOX_CLEAN_BAD':
        return cleanBadExports();
      case 'INBOX_REPARSE':
        return inboxParse(msg.id).then((rec) => ({ ok: !!rec, pdf: rec && rec.pdf }));
      case 'INBOX_DELETE':
        return inboxEdit((list) => {
          const del = new Set(msg.ids || []);
          for (let i = list.length - 1; i >= 0; i--) if (del.has(list[i].id)) list.splice(i, 1);
          return del;
        }).then((del) => Promise.all(Array.from(del).map((id) => RDB.del(id).catch(() => null)))).then(() => ({ ok: true }));
      case 'INBOX_LOCATE':
        return inboxLocate(msg.id);
      case 'INBOX_RECON':
        // 会话里看到了简历消息却没拿到文件：把页面结构记下来（最多 10 条），方便一次修好
        return new Promise((resolve) => chrome.storage.local.get('inboxRecon', (o) => {
          const arr = (o.inboxRecon || []).concat([Object.assign({ at: Date.now() }, msg.dump || {})]).slice(-10);
          chrome.storage.local.set({ inboxRecon: arr }, () => resolve({ ok: true }));
        }));
      case 'FIND_RESULT':
        return chrome.storage.local.set({ findResult: { rid: msg.rid || '', at: Date.now(), state: msg.ok ? 'ok' : 'fail', name: msg.name || '', why: msg.why || '' } }).then(() => ({ ok: true }));

      // ---------- v1.9.48 BOSS RPA ----------
      case 'RPA_OP':
        return rpaOp(msg, sender);
      // ---------- v2.3.0 运行记录 ----------
      case 'EVAL_ADD':
        return evalAdd(msg.sample);
      case 'EVAL_LABEL':
        return evalEdit((list) => { const x = list.find((y) => y.id === msg.id); if (x) { x.label = msg.label || ''; x.note = msg.note || ''; x.labeledAt = Date.now(); } });
      case 'EVAL_CLEAR':
        return evalEdit((list) => list.filter((x) => x.label));
      // v3.6.0 盲测复核的第二次标注、导入同事的评测集（页面合并好整份写回）
      case 'EVAL_LABEL2':
        return evalEdit((list) => { const x = list.find((y) => y.id === msg.id); if (x) { x.label2 = msg.label2 || ''; x.label2At = Date.now(); } });
      case 'EVAL_IMPORT':
        return Array.isArray(msg.list) ? evalEdit(() => msg.list.slice(-3000)) : Promise.resolve({ ok: false });
      case 'RUNLOG':
        runlogAdd(msg.ev, sender);
        return Promise.resolve({ ok: true });
      case 'RUNSTATE':
        return runstateSet(msg, sender);
      case 'RUNLOG_FLUSH':
        return runlogFlush().then(() => ({ ok: true }));
      case 'RUNLOG_CLEAR':
        runlog.buf = [];
        runlog.chain = runlog.chain.then(() => chrome.storage.local.set({ runLog: [] })).catch(() => {});
        return runlog.chain.then(() => ({ ok: true }));
      case 'RPA_PING':
        return HRSStore.getSettings().then((s) => rpaFetch(s, '/ping', null, 3000));
      case 'RPA_WHERE':
        // 鼠标落点不在发起动作的那个内嵌页面里时，问一圈这个标签页的所有页面「鼠标现在在你这儿吗」
        return new Promise((resolve) => {
          if (!sender || !sender.tab) return resolve(null);
          chrome.tabs.sendMessage(sender.tab.id, { type: 'HRS_MM_QUERY', since: msg.since || 0 }, (r) => { void chrome.runtime.lastError; resolve(r || null); });
        });

      case 'SCHED_START':
      case 'SCHED_STOP':
      case 'SCHED_GREET_FINISHED':
      case 'REC_STATUS':
      case 'REC_OPEN':
        return self.HRSScheduler.handle(msg);

      case 'GREET_FRAME_OP':
        // 推荐牛人页的职位下拉 / 筛选面板可能在另一个内嵌页面：发给这个标签页的所有页面，谁有谁回应
        return new Promise((resolve) => {
          if (!sender || !sender.tab) return resolve(null);
          chrome.tabs.sendMessage(sender.tab.id, { type: 'GREET_DO', op: msg.op, args: msg.args || {} }, (r) => {
            if (chrome.runtime.lastError) return resolve(null);
            resolve(r || null);
          });
        });
      case 'FETCH_CLEAR':
        return chrome.storage.local.set({ jobFetch: { boss: [], liepin: [], seq: 0 } }).then(() => ({ ok: true }));

      case 'OPEN_TAB':
        return chrome.tabs.create({ url: msg.url }).then((t) => ({ ok: true, tabId: t.id }));

      case 'NOTIFY': {
        try {
          chrome.notifications.create('hrs_' + Date.now(), {
            type: 'basic',
            iconUrl: 'icons/icon128.png',
            title: msg.title || 'Smart Filter',
            message: msg.message || ''
          });
        } catch (e) {}
        return Promise.resolve({ ok: true });
      }
    }
    return Promise.resolve({ ok: false, error: 'unknown type: ' + msg.type });
  }
})();
