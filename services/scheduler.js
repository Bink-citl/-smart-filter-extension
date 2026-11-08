/**
 * scheduler.js v1.8.0：计划任务（在后台运行）
 * 每天到开始时间，按顺序跑：例如 先「打招呼」到今日计划完成 → 再自动切到「智选」筛简历。
 * 第二天到点自动重新开始（各岗位计数每天 0 点归零）。
 * 依赖：HRSStore、HRSPlan（background.js 里 importScripts）
 */
(function () {
  'use strict';
  // v1.9.0 任务可以跨平台自由排序：boss-greet / boss-screen / liepin-screen / liepin-greet
  var URLS = {
    'boss-greet': 'https://www.zhipin.com/web/chat/recommend',
    'boss-screen': 'https://www.zhipin.com/web/chat/index',
    'liepin-screen': 'https://lpt.liepin.com/chat',
    'liepin-greet': 'https://lpt.liepin.com/recommend'
  };
  var LABEL = { 'boss-greet': 'Boss 打招呼', 'boss-screen': 'Boss 智选', 'liepin-screen': '猎聘智选', 'liepin-greet': '猎聘打招呼', greet: 'Boss 打招呼', screen: 'Boss 智选' };
  var SUPPORTED = { 'boss-greet': 1, 'boss-screen': 1, 'liepin-screen': 1, 'liepin-greet': 1 };

  function get(keys) { return new Promise(function (r) { chrome.storage.local.get(keys, r); }); }
  function set(o) { return new Promise(function (r) { chrome.storage.local.set(o, r); }); }
  function today() { return HRSPlan.localDate(); }
  function nowMin() { var d = new Date(); return d.getHours() * 60 + d.getMinutes(); }
  function toMin(hhmm) { var m = String(hhmm || '00:00').match(/^(\d{1,2}):(\d{2})$/); return m ? parseInt(m[1], 10) * 60 + parseInt(m[2], 10) : 0; }

  /** 步骤列表：[{ task, mode }]。兼容旧版 order='greet-screen' 写法 */
  function steps(cfg) {
    if (Array.isArray(cfg.steps) && cfg.steps.length) return cfg.steps.filter(function (x) { return x && URLS[x.task]; });
    var order = cfg.order || 'greet-screen';
    return order.split('-').filter(function (x) { return x === 'greet' || x === 'screen'; })
      .map(function (x) { return { task: 'boss-' + x, mode: cfg[x + 'Mode'] || 'live' }; });
  }

  // 这一步今天完成了没有
  function stepDone(task, s, jds, o) {
    if (!SUPPORTED[task]) return true;   // 还不支持的任务直接算完成，往下走
    if (/greet/.test(task)) {
      var gsite = task.split('-')[0], lg = gsite === 'liepin' ? o.greetLogLiepin : o.greetLog;
      var g = lg && lg.date === today() ? lg : { total: 0, counts: {} };
      var cap = parseInt(s.greetDailyCap, 10) || 180;
      if (g.total >= cap) return true;
      var on = jds.filter(function (j) { return j.greet && j.greet.enabled; });
      if (on.length && on.every(function (j) { var q = HRSPlan.quotaOf(j, gsite, 'Greet'); return q > 0 && (g.counts[j.id] || 0) >= q; })) return true;
      return o.schedState && o.schedState.greetFinished === today() + '@' + gsite;
    }
    var site = task.split('-')[0];
    return HRSPlan.summary(jds, s, o.planProgress || {}, site).allFull;
  }

  function siteTab(site, url, cfg) {
    var pat = site === 'liepin' ? ['https://*.liepin.com/*'] : ['https://www.zhipin.com/*', 'https://*.zhipin.com/*'];
    return new Promise(function (resolve) {
      chrome.tabs.query({ url: pat }, function (tabs) {
        var t = (tabs || []).filter(function (x) { return !/\/web\/chat\/job|\/web\/frame\/job|\/job\/(manage|list)/.test(x.url || ''); })[0] || (tabs || [])[0];
        if (t) return resolve(t);
        if (cfg.autoOpen === false) return resolve(null);
        chrome.tabs.create({ url: url, active: false }, function (nt) { resolve(nt || null); });
      });
    });
  }

  /** 进入第 i 步：设好运行模式，把对应平台的标签页导航到对应页面 */
  function enterStep(i, why) {
    return get(['settings', 'jds', 'schedState', 'liepinUrls']).then(function (o) {
      var s = o.settings || {}, cfg = s.schedule || {};
      var list = steps(cfg);
      var st = Object.assign({}, o.schedState || {}, { date: today(), step: i, status: i < list.length ? 'running' : 'done', at: Date.now(), note: why || '' });
      if (i >= list.length) {
        var last = list[list.length - 1];
        var patchDone = { greetMode: 'stop' };
        if (!last || !/screen/.test(last.task)) patchDone.masterEnabled = false;   // 智选在最后一步时保持运行
        return HRSStore.saveSettings(patchDone).then(function () { return set({ schedState: st }); });
      }
      var step = list[i], task = step.task, mode = step.mode || 'live';
      if (!SUPPORTED[task]) {
        st.note = LABEL[task] + ' 还不支持，跳过';
        return set({ schedState: st }).then(function () { return enterStep(i + 1, LABEL[task] + ' 还不支持，跳过'); });
      }
      var patch = /greet/.test(task)
        ? { greetMode: mode, masterEnabled: false }
        : { greetMode: 'stop', masterEnabled: true, dryRun: mode !== 'live' };
      var site = task.split('-')[0];
      var lu = o.liepinUrls || {};
      var url = site === 'liepin' ? (/screen/.test(task) ? (lu.chat || URLS[task]) : (lu.recommend || URLS[task])) : URLS[task];
      return HRSStore.saveSettings(patch).then(function () { return set({ schedState: st }); }).then(function () {
        return siteTab(site, url, cfg);
      }).then(function (tab) {
        if (!tab) return set({ schedState: Object.assign(st, { status: 'waiting', note: '没有打开' + (site === 'liepin' ? '猎聘' : ' Boss') + '页面，打开后自动继续' }) });
        return new Promise(function (r) { chrome.tabs.update(tab.id, { url: url }, function () { r(); }); });
      });
    });
  }

  /** 每分钟检查一次：到点开工、这一步完成就进下一步 */
  function tick() {
    return get(['settings', 'jds', 'schedState', 'greetLog', 'greetLogLiepin', 'planProgress']).then(function (o) {
      var s = o.settings || {}, cfg = s.schedule || {};
      if (!cfg.enabled) return;
      var st = o.schedState || {};
      var list = steps(cfg);
      if (!list.length) return;
      if (st.date !== today()) {
        if (nowMin() >= toMin(cfg.startAt || '00:00')) return enterStep(0, '每天 ' + (cfg.startAt || '00:00') + ' 自动开始');
        return;
      }
      if (st.status === 'stopped' || st.status === 'done') return;
      if (st.status === 'waiting') return enterStep(st.step || 0, '重新尝试');
      var cur = list[st.step || 0];
      if (cur && stepDone(cur.task, s, o.jds || [], o)) return enterStep((st.step || 0) + 1, LABEL[cur.task] + ' 已完成');
    });
  }

  // ---------------- v1.8.3 每日简历分发：由「示例工作台」+ Windows 定时任务执行，这里只读状态 ----------------
  var WB_NAME = /示例\s*工作台/i;
  function findWorkbench() {
    return new Promise(function (resolve) {
      if (!chrome.management || !chrome.management.getAll) return resolve(null);
      chrome.management.getAll(function (list) {
        var hit = (list || []).filter(function (x) { return x.enabled && x.type === 'extension' && WB_NAME.test(x.name); })
          .sort(function (a, b) { return String(b.version).localeCompare(String(a.version), undefined, { numeric: true }); })[0];
        resolve(hit ? { id: hit.id, name: hit.name, version: hit.version } : null);
      });
    });
  }
  function askWorkbench(type) {
    return findWorkbench().then(function (wb) {
      if (!wb) return { workbench: null };
      return new Promise(function (resolve) {
        chrome.runtime.sendMessage(wb.id, { type: type }, function (r) {
          resolve({ workbench: wb, reply: chrome.runtime.lastError ? null : (r || null), error: chrome.runtime.lastError ? chrome.runtime.lastError.message : '' });
        });
      });
    });
  }

  function handle(msg) {
    if (msg.type === 'REC_STATUS') return askWorkbench('EXAMPLE_REC_STATUS');
    if (msg.type === 'REC_OPEN') return askWorkbench('EXAMPLE_OPEN_PANEL');
    if (msg.type === 'SCHED_START') return set({ schedState: { date: today(), step: 0, status: 'running' } }).then(function () { return enterStep(0, '手动开始'); }).then(function () { return { ok: true }; });
    if (msg.type === 'SCHED_STOP') return get('schedState').then(function (o) {
      return set({ schedState: Object.assign({}, o.schedState || {}, { date: today(), status: 'stopped', note: '手动停止' }) });
    }).then(function () { return HRSStore.saveSettings({ greetMode: 'stop', masterEnabled: false }); }).then(function () { return { ok: true }; });
    if (msg.type === 'SCHED_GREET_FINISHED') return get('schedState').then(function (o) {
      // 打招呼页面报告：所有岗位都到量或推荐看完了
      return set({ schedState: Object.assign({}, o.schedState || {}, { greetFinished: today() + '@' + (msg.site || 'boss') }) }).then(tick);
    }).then(function () { return { ok: true }; });
    return null;
  }

  chrome.alarms.create('hrsSched', { periodInMinutes: 1 });
  chrome.alarms.onAlarm.addListener(function (a) { if (a.name === 'hrsSched') tick(); });
  chrome.runtime.onStartup.addListener(tick);
  self.HRSScheduler = { tick: tick, handle: handle, steps: steps, LABEL: LABEL, SUPPORTED: SUPPORTED };
})();
