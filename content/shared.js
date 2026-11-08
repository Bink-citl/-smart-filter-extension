/**
 * Smart Filter 内容脚本共享引擎（content/shared.js）
 * 由 boss.js / liepin.js 以 siteHooks 实例化。
 * 能力：卡片扫描、文本提取、JD匹配、自动动作(已读/拒绝话术/索要简历)、限速、防重复、
 *       诊断模式、选择器自修复、会话确认弹窗、浮动状态条。
 */
(function () {
  'use strict';
  if (window.__HRS_ENGINE__) return;
  window.__HRS_ENGINE__ = true;
  // v1.9.49 页面一加载就记下地址里的 # 部分（人才库跳过来的「要找谁」）：平台页面初始化时可能把它去掉
  var INIT_HASH = (function () { try { return String(location.hash || ''); } catch (e) { return ''; } })();

  // ================= 工具 =================
  function send(msg) {
    return new Promise(function (resolve) {
      try {
        chrome.runtime.sendMessage(msg, function (resp) {
          if (chrome.runtime.lastError) resolve({ error: chrome.runtime.lastError.message });
          else resolve(resp || {});
        });
      } catch (e) { resolve({ error: String(e) }); }
    });
  }
  function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
  function hash(s) {
    var h = 5381;
    s = String(s || '');
    for (var i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
    return 'h' + (h >>> 0).toString(36);
  }
  function qs(sel, root) { try { return (root || document).querySelector(sel); } catch (e) { return null; } }
  function qsa(sel, root) { try { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); } catch (e) { return []; } }
  // v3.1.0 lint 查出来的：「采集控件」用到 textOf 却没定义，点了没反应
  function textOf(el) { return String((el && (el.innerText || el.textContent)) || ''); }
  function firstQuery(selectors, root) {
    for (var i = 0; i < selectors.length; i++) {
      var el = qs(selectors[i], root);
      if (el) return { el: el, sel: selectors[i] };
    }
    return null;
  }
  function setNativeValue(el, value) {
    if (el.isContentEditable) {
      el.textContent = value;
      try {
        el.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: value }));
      } catch (e) {
        el.dispatchEvent(new Event('input', { bubbles: true }));
      }
      return;
    }
    var proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    var setter = Object.getOwnPropertyDescriptor(proto, 'value');
    if (setter && setter.set) setter.set.call(el, value);
    else el.value = value;
    try {
      el.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: value }));
    } catch (e) {
      el.dispatchEvent(new Event('input', { bubbles: true }));
    }
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }
  function log(tag, msg) {
    var line = '[' + new Date().toLocaleTimeString('zh-CN', { hour12: false }) + '] ' + tag + ' ' + msg;
    console.log('[Smart Filter]', line);
    send({ type: 'EVENT', eventType: 'log', detail: msg, name: tag, site: window.__HRS_SITE__ }).catch(function () {});
  }

  // ================= v1.9.48 Boss RPA（真实鼠标键盘，由本机 RPA 助手执行，复用 v1.9.2 的 Python 助手） =================
  // 只在 Boss 且设置「Boss 执行方式」为 RPA 时生效；猎聘仍走原来的脚本点击。
  function rpaActive() { return window.__HRS_SITE__ === 'boss' && !!window.HRSDom && !!HRSDom.rpaOn && HRSDom.rpaOn(); }
  var rpaNoteState = { code: '', at: 0 };
  function rpaNote(r) {
    r = r || {};
    var msg = window.HRSDom && HRSDom.holdMessage ? HRSDom.holdMessage(r) : (r.why || r.code || '');
    state.rpaWait = { at: Date.now(), why: msg };   // v2.3.0 运行记录页显示「RPA 等待中」的原因
    if (r.code !== rpaNoteState.code || Date.now() - rpaNoteState.at > 30000) {
      uiLog('tip', 'RPA：' + msg);
      rpaNoteState = { code: r.code || '', at: Date.now() };
    }
  }
  /** 点一下：Boss + RPA 用真实鼠标，其余保持脚本 click()。返回 Promise<是否点成> */
  function actClick(el) {
    if (!el) return Promise.resolve(false);
    if (rpaActive()) return HRSDom.rpaClick(el).then(function (r) { if (!r.ok) rpaNote(r); return !!r.ok; });
    try { el.click(); return Promise.resolve(true); } catch (e) { return Promise.resolve(false); }
  }
  /** 按 Esc：Boss + RPA 用真实键盘 */
  function escKey() {
    if (rpaActive()) return HRSDom.rpaKey('escape');
    ['keydown', 'keyup'].forEach(function (t) { document.dispatchEvent(new KeyboardEvent(t, { key: 'Escape', code: 'Escape', keyCode: 27, which: 27, bubbles: true })); });
    return Promise.resolve();
  }

  // ================= 设置缓存 =================
  var state = {
    settings: null,
    activeJd: null,
    siteConfig: null,
    processed: {},   // {hash: ts}
    queue: [],
    seen: {},
    running: false,
    busy: false,
    sessionStats: { scanned: 0, passed: 0, rejected: 0, review: 0, errored: 0 },
    noConfirm: false,
    stopped: false,
    activeConversation: null,
    seenAttachments: {},
    manualPaused: false,
    nextAt: 0,          // v1.2.0 节拍：下一位候选人最早开始时间
    lastStartAt: 0,     // 上一位开始处理的时间（节拍从这里起算）
    lastTouched: false, // 上一位是否打开过会话（只在列表层跳过的不占节拍）
    paceTimer: null,
    lastError: '',      // 最近一次失败，常驻浮层直到点「知道了」
    judged: {},         // v1.8.4 判定记录 { id: { at, m: 'dry'|'live', v } }
    curJd: null,        // v1.3.0 正在处理的这位候选人所属的职位
    planProgress: {},   // v1.3.0 今日计划进度 { date, counts: { jdId: n } }
    planWarned: ''      // 时段外 / 计划完成 提示只打一次
  };
  function PL() { return window.HRSPlan; }
  function curJd() { return state.curJd || state.activeJd; }
  function plannedJds() { return (PL().sortBy ? PL().sortBy(state.jds || [], (state.settings || {}).planOrder) : (state.jds || [])).filter(function (j) { return PL().isPlanned(j, state.settings); }); }

  function loadState() {
    return Promise.all([
      send({ type: 'GET_STATE' }),
      new Promise(function (res) { chrome.storage.local.get('processedHashes', function (o) { res(o.processedHashes || {}); }); }),
      new Promise(function (res) { chrome.storage.local.get('capCounter', function (o) { res(o.capCounter || {}); }); }),
      new Promise(function (res) { chrome.storage.local.get('planProgress', function (o) { res(o.planProgress || {}); }); }),
      new Promise(function (res) { chrome.storage.local.get('judgedLog', function (o) { res(o.judgedLog || {}); }); })
    ]).then(function (r) {
      state.judged = r[4] || {};
      try { chrome.storage.local.get('screenToday', function (o) { var T = o.screenToday; if (T && T.date === PL().localDate()) state.todayStat = T[window.__HRS_SITE__ || 'boss'] || null; }); } catch (e) {}
      state.planProgress = r[3] || {};
      state.settings = siteViewOf(r[0].settings || {});
      state.noConfirm = state.settings.confirmHighRisk === false;
      state.activeJd = r[0].activeJd || null;
      state.jds = r[0].jds || [];
      var cfg = r[0].siteConfig || null;
      state.siteConfig = cfg && cfg[window.__HRS_SITE__] ? cfg[window.__HRS_SITE__] : null;
      state.processed = r[1] || {};
      state.cap = r[2] || {};
      return state;
    });
  }

  function persistProcessed() {
    // 只保留最近 2000 条，避免无限增长
    var keys = Object.keys(state.processed);
    if (keys.length > 2000) {
      keys.sort(function (a, b) { return state.processed[a] - state.processed[b]; });
      keys.slice(0, keys.length - 2000).forEach(function (k) { delete state.processed[k]; });
    }
    return new Promise(function (res) {
      chrome.storage.local.set({ processedHashes: state.processed }, res);
    });
  }
  // v1.8.4 判定记录（含试运行），保留 3 天，暂停 / 继续 / 刷新页面后不再重复判定
  function markJudged(id, verdict) {
    state.judged[id] = { at: Date.now(), m: state.settings.dryRun ? 'dry' : 'live', v: verdict };
    var cut = Date.now() - 3 * 86400000;
    Object.keys(state.judged).forEach(function (k) { if (state.judged[k].at < cut) delete state.judged[k]; });
    try { chrome.storage.local.set({ judgedLog: state.judged }); } catch (e) {}
  }
  function markProcessed(id) {
    state.processed[id] = Date.now();
    return persistProcessed();
  }
  function bumpCap() {
    var today = PL().localDate();
    if (state.cap.date !== today) state.cap = { date: today, n: 0 };
    state.cap.n++;
    chrome.storage.local.set({ capCounter: state.cap });
  }
  function bumpPlan(jdId) {
    // 先读最新值再加一，避免两个标签页同时跑时互相覆盖
    chrome.storage.local.get('planProgress', function (o) {
      state.planProgress = PL().bump(o.planProgress || {}, jdId, window.__HRS_SITE__);
      chrome.storage.local.set({ planProgress: state.planProgress });
      renderUi();
    });
  }
  function capReached() {
    var today = PL().localDate();
    if (state.cap.date !== today) return false;
    return state.cap.n >= (state.settings.dailyCap || 99999);
  }

  // ================= 浮动 UI（v1.2.0：版本横幅 + 节拍倒计时 + 每步日志 + 失败常驻提示） =================
  var HRS_VERSION = (function () { try { return chrome.runtime.getManifest().version; } catch (e) { return '?'; } })();
  var ui = null;
  var quickSig = '';
  var LOG_TAG = { pass: '[完成]', reject: '[完成]', err: '[失败]', warn: '[跳过]', tip: '[提示]', dry: '[试运行]', '': '[信息]' };

  // v1.9.34 浮层被拖到窗口外（换了显示器、窗口变小）就拉回来，找不到浮层就没法停
  function keepInView(box, key) {
    var fix = function () {
      if (!box || !box.isConnected) return;
      var r = box.getBoundingClientRect(), W = window.innerWidth, H = window.innerHeight;
      if (!r.width || !r.height) return;
      if (r.right < 60 || r.left > W - 60 || r.bottom < 30 || r.top > H - 30) {
        box.style.left = ''; box.style.top = ''; box.style.right = '12px'; box.style.bottom = '12px';
        try { localStorage.removeItem(key); } catch (e) {}
        return;
      }
      if (box.style.top && r.bottom > H) box.style.top = Math.max(0, H - r.height - 8) + 'px';
      if (box.style.left && r.right > W) box.style.left = Math.max(0, W - r.width - 8) + 'px';
    };
    setTimeout(fix, 300); setInterval(fix, 2000);
    window.addEventListener('resize', fix);
  }
  function ensureUi() {
    if (ui && ui.isConnected) return ui;
    // v1.6.0 推荐牛人页、职位管理页不显示沟通筛选浮层，避免和打招呼 / 抓取职位的浮层重叠
    
    quickSig = '';
    // v2.8.0 浮层放进隔离层（Shadow DOM）：页面样式进不来，颜色、圆角、字号统一用设计令牌
    ui = (window.HRSPanel && window.HRSPanel.mount) ? window.HRSPanel.mount('__hrs_ui__') : document.createElement('div');
    ui.id = '__hrs_ui__';
    ui.innerHTML =
      '<style>' +
      '#__hrs_ui__{position:fixed;right:12px;bottom:12px;z-index:2147483646;font:12px/1.6 "Microsoft YaHei",sans-serif;color:var(--text);}' +
      '#__hrs_ui__ .pill{display:flex;align-items:center;gap:6px;background:var(--surface);border:1.5px solid var(--info);border-radius:var(--r-lg);padding:7px 16px;box-shadow:0 4px 14px rgba(0,0,0,.14);cursor:pointer;user-select:none;transition:box-shadow .3s,border-color .3s;font-weight:600;}' +
      '#__hrs_ui__ .pill.flash{box-shadow:0 0 0 3px rgba(37,99,235,.3);}' +
      '#__hrs_ui__ .pill.bad{border-color:var(--bad-500);}' +
      '#__hrs_ui__ .dot{display:inline-block;width:9px;height:9px;border-radius:50%;}' +
      '#__hrs_ui__ .panel{display:none;margin-bottom:6px;background:var(--surface);border:1px solid var(--field);border-radius:var(--r-lg);width:380px;box-shadow:0 6px 18px rgba(0,0,0,.14);overflow:hidden;}' +
      '#__hrs_ui__ .ph{display:flex;align-items:center;gap:8px;padding:8px 12px;background:var(--surface-2);border-bottom:1px solid var(--line);}' +
      '#__hrs_ui__ .ph b{font-size:var(--fs-md);}#__hrs_ui__ .ph .ver{font-size:var(--fs-xs);color:var(--text-2);}' +
      '#__hrs_ui__ .ph .mode{margin-left:auto;display:inline-flex;border:1px solid var(--field);border-radius:var(--r-md);overflow:hidden;}' +
      '#__hrs_ui__ .ph .mode button{border:none;border-right:1px solid var(--field);background:var(--surface);color:var(--text-2);font-size:var(--fs-xs);padding:1px 8px;cursor:pointer;}' +
      '#__hrs_ui__ .ph .mode button:last-child{border-right:none;}' +
      '#__hrs_ui__ .ph .mode button.on[data-m=stop]{background:var(--bg);color:var(--text);font-weight:600;}#__hrs_ui__ .ph .mode button.on[data-m=dry]{background:var(--warn-50);color:var(--warn-700);font-weight:600;}#__hrs_ui__ .ph .mode button.on[data-m=live]{background:var(--ok-50);color:var(--ok-700);font-weight:600;}' +
      '#__hrs_ui__ table,#__hrs_ui__ td,#__hrs_ui__ th{font-size:var(--fs-xs) !important;line-height:1.5 !important;font-family:inherit !important;}' +
      '#__hrs_ui__ .errbar{display:none;background:var(--bad-50);color:var(--bad);border-bottom:1px solid var(--bad-200);padding:6px 12px;font-size:var(--fs-sm);word-break:break-all;}' +
      '#__hrs_ui__ .errbar a{float:right;color:var(--bad);cursor:pointer;text-decoration:underline;margin-left:8px;}' +
      '#__hrs_ui__ .ctl{display:flex;align-items:center;gap:6px;padding:8px 12px;border-bottom:1px solid var(--line);flex-wrap:wrap;}' +
      '#__hrs_ui__ .ctl .lb{color:var(--text-2);}' +
      '#__hrs_ui__ .ctl input{width:52px;padding:3px 6px;border:1px solid var(--field);border-radius:var(--r-sm);font-size:var(--fs-sm);text-align:center;}' +
      '#__hrs_ui__ .ctl button,#__hrs_ui__ .quick button{border:1px solid var(--info-200);background:var(--info-50);color:var(--info-700);border-radius:var(--r-md);padding:3px 9px;cursor:pointer;font-size:var(--fs-xs);}' +
      '#__hrs_ui__ .ctl button:hover,#__hrs_ui__ .quick button:hover{background:var(--brand-100);}' +
      '#__hrs_ui__ .ctl .run{margin-left:auto;}' +
      '#__hrs_ui__ .ctl .run.go{background:var(--ok-50);border-color:var(--ok-200);color:var(--ok-700);}' +
      '#__hrs_ui__ .ctl .run.stop{background:var(--warn-50);border-color:var(--warn-500);color:var(--warn-700);}' +
      '#__hrs_ui__ .sub{padding:0 12px 6px;font-size:var(--fs-xs);color:var(--muted);border-bottom:1px solid var(--line);}' +
      '#__hrs_ui__ .rc{display:none;padding:6px 12px;border-bottom:1px solid var(--line);}' +
      '#__hrs_ui__ .rc .rh{display:flex;align-items:center;gap:8px;margin-bottom:6px;}' +
      '#__hrs_ui__ .rc .rh b{font-size:var(--fs-sm);}#__hrs_ui__ .rc .rh .jd{font-size:var(--fs-xs);color:var(--text-2);flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}' +
      '#__hrs_ui__ .rc .vd{font-size:var(--fs-xs);padding:1px 8px;border-radius:var(--r-md);color:var(--on-color);font-weight:600;}' +
      '#__hrs_ui__ .rc table{width:100%;border-collapse:collapse;font-size:var(--fs-xs);line-height:1.5;table-layout:fixed;}' +
      '#__hrs_ui__ .rc td{padding:2px 4px;border-top:1px dashed var(--line-2);vertical-align:top;word-break:break-all;}' +
      '#__hrs_ui__ .rc td.k{width:46%;color:var(--text-2);}#__hrs_ui__ .rc td.s{width:14px;font-weight:700;text-align:center;padding:2px 0;}' +
      '#__hrs_ui__ .rc tr.ok td.s{color:var(--text-2);}#__hrs_ui__ .rc tr.bad td{color:var(--bad-500);}#__hrs_ui__ .rc tr.unk td{color:var(--warn);}' +
      '#__hrs_ui__ .rc .bn{margin-top:4px;font-size:var(--fs-xs);color:var(--text-2);}' +
      '#__hrs_ui__ .rc .chip{display:inline-block;margin:2px 3px 0 0;padding:0 6px;border-radius:var(--r-md);font-size:var(--fs-xs);background:var(--bg);color:var(--muted);}' +
      '#__hrs_ui__ .rc .chip.on{background:var(--ok-50);color:var(--ok);font-weight:600;}' +
      '#__hrs_ui__ .rc details{margin-top:6px;font-size:var(--fs-xs);color:var(--text-2);}#__hrs_ui__ .rc details pre{white-space:pre-wrap;word-break:break-all;max-height:120px;overflow:auto;background:var(--surface-2);padding:6px;border-radius:var(--r-sm);margin:4px 0 0;font:11px/1.5 Consolas,"Microsoft YaHei",monospace;}' +
      '#__hrs_ui__ .tb{display:flex;border-bottom:1px solid var(--line);background:var(--surface-2);}#__hrs_ui__ .tb span{flex:1;text-align:center;padding:4px 0;cursor:pointer;color:var(--text-2);}#__hrs_ui__ .tb span.on{color:var(--info-700);font-weight:600;border-bottom:2px solid var(--info);background:var(--surface);}' +
      '#__hrs_ui__ .tp{display:none;}#__hrs_ui__ .tp.on{display:block;}#__hrs_ui__ .rc{max-height:220px;overflow:auto;}' +
      // v2.7.0 里面的几块自动适应：判定区按内容高度，日志区填满剩下的空间
      '#__hrs_ui__ .pb{display:flex;flex-direction:column;}#__hrs_ui__ .pb>*{flex:none;}#__hrs_ui__ .rc{max-height:50vh;}' +
      '#__hrs_ui__ .panel.hrs-sized .pb{overflow:hidden !important;}#__hrs_ui__ .panel.hrs-sized .rc{flex:0 1 auto;min-height:0;max-height:62%;}' +
      '#__hrs_ui__ .panel.hrs-sized .tp.on{flex:1 1 0;min-height:70px;display:flex;flex-direction:column;}#__hrs_ui__ .panel.hrs-sized .tp.on>.logbody,#__hrs_ui__ .panel.hrs-sized .tp.on>.quick{flex:1;min-height:0;max-height:none;overflow:auto;}' +
      '#__hrs_ui__ .quick{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:6px;padding:8px 12px;border-bottom:1px solid var(--line);}' +
      '#__hrs_ui__ .quick .qt{grid-column:1 / -1;font-size:var(--fs-xs);color:var(--text-2);}' +
      '#__hrs_ui__ .logbody{max-height:240px;overflow:auto;padding:6px 12px;font:11px/1.6 Consolas,"Microsoft YaHei",monospace;}' +
      '#__hrs_ui__ .tb .pn{font-style:normal;margin-left:3px;}#__hrs_ui__ .tb .pn:not(:empty){display:inline-block;min-width:16px;padding:0 4px;border-radius:8px;background:var(--bad-500);color:var(--on-color);font-size:10px;line-height:16px;}' +
      '#__hrs_ui__ .pend{max-height:260px;overflow:auto;padding:6px 12px;}#__hrs_ui__ .pend .pt{font-size:var(--fs-xs);color:var(--text-2);margin-bottom:4px;display:flex;align-items:center;gap:6px;}#__hrs_ui__ .pend .pt span{flex:1;}' +
      '#__hrs_ui__ .pend .pi{border:1px solid var(--line);border-radius:var(--r-md);padding:5px 8px;margin-bottom:6px;}#__hrs_ui__ .pend .pi b{font-size:var(--fs-sm);}#__hrs_ui__ .pend .pi .pj{font-size:var(--fs-xs);color:var(--text-2);}' +
      '#__hrs_ui__ .pend .pi .pr{font-size:var(--fs-xs);color:var(--bad-500);margin:2px 0 4px;word-break:break-all;}#__hrs_ui__ .pend .pi .pa{display:flex;gap:6px;}' +
      '#__hrs_ui__ .pend button{border:1px solid var(--field);background:var(--surface);border-radius:var(--r-md);padding:2px 9px;font-size:var(--fs-xs);cursor:pointer;}#__hrs_ui__ .pend button.no{border-color:var(--bad-200);background:var(--bad-50);color:var(--bad);}#__hrs_ui__ .pend button.yes{border-color:var(--ok-200);background:var(--ok-50);color:var(--ok-700);}#__hrs_ui__ .pend button:disabled{opacity:.5;cursor:default;}' +
      '#__hrs_ui__ .pend .pe{font-size:var(--fs-xs);color:var(--muted);padding:8px 0;}' +
      '#__hrs_ui__ .l{color:var(--text-2);border-bottom:1px dashed var(--line-2);padding:2px 0;word-break:break-all;}' +
      '#__hrs_ui__ .l.pass{color:var(--ok);}#__hrs_ui__ .l.reject{color:var(--bad-500);}#__hrs_ui__ .l.err{color:var(--bad);font-weight:600;}#__hrs_ui__ .l.warn{color:var(--warn);}#__hrs_ui__ .l.tip{color:var(--warn);}#__hrs_ui__ .l.dry{color:var(--info);}' +
      '</style>' +
      '<div class="panel">' +
      '<div class="ph"><b>智选</b><span class="ver">v' + HRS_VERSION + '</span><span class="mode"><button data-m="stop">停止</button><button data-m="dry">试运行</button><button data-m="live">正式运行</button></span></div>' +
      '<div class="pb">' +   // v2.6.8 标题栏以下：框拉矮时这里出滚动条
      '<div class="errbar"><a data-a="clr">知道了</a><span class="et"></span></div>' +
      '<div class="rc"></div>' +
      '<div class="ctl"><span class="lb">筛选节拍</span><button data-a="dec">-</button><input class="pace" type="number" min="3" max="600"><button data-a="inc">+</button><span class="lb">秒/个</span>' +
      '<button data-a="dump" title="把当前页面的关键控件信息复制下来，提交到 GitHub Issue（先脱敏）">采集控件</button><button class="run" data-a="run"></button></div>' +
      '<div class="dp" style="display:none;padding:6px 12px;border-bottom:1px solid var(--line);"><div style="display:flex;gap:6px;margin-bottom:4px;"><button data-a="dcopy" style="border:1px solid var(--info-200);background:var(--info-50);color:var(--info-700);border-radius:var(--r-md);padding:2px 9px;font-size:var(--fs-xs);cursor:pointer;">复制</button><button data-a="dhide" style="border:1px solid var(--field);background:var(--surface);border-radius:var(--r-md);padding:2px 9px;font-size:var(--fs-xs);cursor:pointer;">收起</button></div><pre style="white-space:pre-wrap;max-height:160px;overflow:auto;background:var(--surface-2);padding:4px;margin:0;font:10px Consolas,monospace"></pre></div>' +
      '<div class="sub" style="display:none"></div>' +
      // v1.9.27 上面是当前这个人的匹配情况，下面「日志 / 固定话术」两个标签页切换
      '<div class="tb"><span data-t="log">日志</span><span data-t="pend">待确认<i class="pn"></i></span><span data-t="quick">固定话术</span></div>' +
      '<div class="tp" data-p="log"><div class="logbody"></div></div>' +
      '<div class="tp" data-p="pend"><div class="pend"></div></div>' +   // v3.6.0 判不合格的人先放这里，HR 确认后才发拒绝
      '<div class="tp" data-p="quick"><div class="quick"></div></div>' +
      '</div>' +
      '</div>' +
      '<div class="pill"><span class="dot"></span><span class="txt">Smart Filter 加载中</span></div>';
    if (!ui.isConnected) document.documentElement.appendChild(ui);
    (function () {
      var setTab = function (t) {
        ui.querySelectorAll('.tb span').forEach(function (x) { x.classList.toggle('on', x.getAttribute('data-t') === t); });
        ui.querySelectorAll('.tp').forEach(function (x) { x.classList.toggle('on', x.getAttribute('data-p') === t); });
        try { localStorage.setItem('hrsSmartTab', t); } catch (e) {}
      };
      ui.querySelector('.tb').addEventListener('click', function (e) { var t = e.target.getAttribute('data-t'); if (t) setTab(t); });
      var t0 = 'log'; try { t0 = localStorage.getItem('hrsSmartTab') || 'log'; } catch (e) {}
      setTab(t0);
      // v3.6.0 待确认拒绝：确认拒绝 / 改为合格
      ui.querySelector('.pend').addEventListener('click', function (e) {
        var b = e.target.closest && e.target.closest('button[data-pa]');
        if (!b || b.disabled) return;
        var a = b.getAttribute('data-pa'), id = b.getAttribute('data-id');
        if (a === 'yes') pendingOverturn(id);
        else if (a === 'no') pendingConfirm(id);
        else if (a === 'all') pendingConfirmAll();
      });
      renderPending();
    })();
    keepInView(ui, 'hrsSmartPos');
    // v1.9.6 按住「智选」标题栏可以拖动
    (function (box, handle) {
      try { var sv = JSON.parse(localStorage.getItem('hrsSmartPos') || 'null'); if (sv) { box.style.left = sv.x + 'px'; box.style.top = sv.y + 'px'; box.style.right = 'auto'; box.style.bottom = 'auto'; } } catch (e) {}
      if (!handle) return;
      var drag = null;
      handle.style.cursor = 'move';
      handle.addEventListener('mousedown', function (e) {
        if (e.target.closest('button,input,a')) return;
        var r = box.getBoundingClientRect(); drag = { dx: e.clientX - r.left, dy: e.clientY - r.top }; e.preventDefault();
      });
      document.addEventListener('mousemove', function (e) {
        if (!drag) return;
        box.style.left = Math.max(0, Math.min(window.innerWidth - 120, e.clientX - drag.dx)) + 'px';
        box.style.top = Math.max(0, Math.min(window.innerHeight - 40, e.clientY - drag.dy)) + 'px';
        box.style.right = 'auto'; box.style.bottom = 'auto';
      });
      document.addEventListener('mouseup', function () {
        if (drag) { try { var r = box.getBoundingClientRect(); localStorage.setItem('hrsSmartPos', JSON.stringify({ x: Math.round(r.left), y: Math.round(r.top) })); } catch (e) {} }
        drag = null;
      });
    })(ui, ui.querySelector('.ph'));
    // v2.6.8 外框四边四角都能拖改大小；「当前候选人」和「日志」下面各一条横线，上下拖改高度
    if (window.HRSPanel) {
      HRSPanel.resizable({ box: ui.querySelector('.panel'), pos: ui, head: ui.querySelector('.ph'), body: ui.querySelector('.pb'), key: 'hrsSmartSize', posKey: 'hrsSmartPos', minW: 320, minH: 180 });
      // v2.7.0 里面的分隔线去掉，改成自动适应；之前拖过的高度清掉
      try { localStorage.removeItem('hrsSmartRcH'); localStorage.removeItem('hrsSmartLogH'); } catch (e) {}
    }
    ui.querySelector('.pill').addEventListener('click', function () {
      var p = ui.querySelector('.panel');
      p.style.display = p.style.display === 'block' ? 'none' : 'block';
      state.panelClosedByUser = p.style.display !== 'block';
    });
    ui.querySelector('.panel').addEventListener('click', function (e) {
      var a = e.target && e.target.getAttribute && e.target.getAttribute('data-a');
      if (a === 'clr') { state.lastError = ''; renderUi(); }
      if (a === 'dump') {
        var d = collectPageDump();
        var dp = ui.querySelector('.dp'); dp.style.display = 'block';
        dp.querySelector('pre').textContent = JSON.stringify(d, null, 1);
        send({ type: 'DIAG_LOG', data: d });
      }
      if (a === 'dhide') ui.querySelector('.dp').style.display = 'none';
      if (a === 'dcopy') {
        var txt = ui.querySelector('.dp pre').textContent;
        (navigator.clipboard ? navigator.clipboard.writeText(txt) : Promise.reject()).then(function () { uiLog('', '控件信息已复制'); }, function () { uiLog('tip', '浏览器不让自动复制，请在框里全选后 Ctrl+C'); });
      }
      var mm = e.target && e.target.getAttribute && e.target.getAttribute('data-m');
      if (mm) {
        // v1.9.0 浮层上直接切运行模式，不用进设置页
        if (mm === 'live' && !confirm('切到「正式运行」后会自动发送话术、索要简历，确定？')) return;
        send({ type: 'SAVE_SETTINGS', patch: { masterEnabled: mm !== 'stop', dryRun: mm !== 'live', __site: window.__HRS_SITE__ } }).then(function (r) {
          if (r && r.error) uiLog('err', '切换失败：' + r.error); else uiLog('', '运行模式切到「' + { stop: '停止', dry: '试运行', live: '正式运行' }[mm] + '」');
        });
      }
      else if (a === 'dec') setPace(currentPace() - (currentPace() > 10 ? 5 : 1));
      else if (a === 'inc') setPace(currentPace() + (currentPace() >= 10 ? 5 : 1));
      else if (a === 'run') toggleRun();
    });
    ui.querySelector('.pace').addEventListener('change', function () { setPace(this.value); });
    return ui;
  }
  function clampPace(v) {
    var n = parseInt(v, 10);
    if (!isFinite(n)) n = 20;
    return Math.min(600, Math.max(3, n));
  }
  function currentPace() { return clampPace(state.settings && state.settings.paceSec); }
  function setPace(v) {
    var n = clampPace(v);
    if (state.settings) state.settings.paceSec = n;
    // 节拍从下一位开始生效；正在等待的倒计时按新节拍重新计算
    if (state.lastTouched && state.lastStartAt && state.nextAt > Date.now()) {
      state.nextAt = state.lastStartAt + paceMs(n);
      schedulePace();
    }
    send({ type: 'SAVE_SETTINGS', patch: { paceSec: n } }).then(function (r) {
      if (r && r.error) uiLog('err', '节拍保存失败：' + r.error);
      else uiLog('', '筛选节拍已改为 ' + n + ' 秒/个');
    });
    renderUi();
  }
  function paceMs(sec) {
    var base = clampPace(sec) * 1000;
    if (state.settings && state.settings.paceJitter === false) return base;
    // v2.3.0 拟人节奏开着：按「操作节奏」里的浮动幅度上下浮动（原来固定 +0~20%）
    var R = window.HRSRhythm, r = R ? R.norm(state.settings && state.settings.rhythm) : null;
    if (r && r.on) return Math.round(base * R.paceFactor(r));
    return Math.round(base * (1 + Math.random() * 0.2));
  }
  // ================= v2.3.0 拟人节奏的小憩 + 运行记录 =================
  var breaker = window.HRSRhythm ? new HRSRhythm.Breaker() : null;
  function engineKey() { return (window.__HRS_SITE__ || 'boss') + '-screen'; }
  function runAdd(act, target, ok, r, detail) {
    if (!window.HRSRunLog || mainUiHidden()) return;   // 推荐页、职位页上智选不工作，不记
    r = r || {};
    HRSRunLog.add({ mod: '智选', act: act, target: target, ok: ok, code: r.code, why: r.why, detail: detail, via: rpaActive() ? 'rpa' : 'script' });
  }
  // 动作没成功时找原因：这次动作期间 RPA 最近一次失败；没有就记「没确认成功」
  function failOf(t0, fallback) {
    var f = window.HRSDom && HRSDom.lastFailSince ? HRSDom.lastFailSince(t0) : null;
    return f ? { code: f.code, why: f.why } : { code: '', why: fallback || '没确认成功' };
  }
  function preview(t) { t = String(t || '').replace(/\s+/g, ' ').trim(); return t.length > 24 ? t.slice(0, 24) + '…' : t; }
  // 引擎状态：运行中 / 休息中 / 已停止（工作台「运行记录」页显示）
  function statusNow() {
    var s = state.settings || {};
    if (!s.masterEnabled || state.stopped) return { state: 'stopped', text: '运行模式为「停止」' };
    if (state.riskStop && state.manualPaused) return { state: 'stopped', text: state.riskStop };
    if (state.manualPaused) return { state: 'stopped', text: '已暂停（手动暂停或你手动点了会话，点浮层「继续自动」恢复）' };
    var dry = s.dryRun ? '试运行 · ' : '';
    if (breaker && breaker.resting()) return { state: 'resting', text: dry + '拟人小憩，约 ' + breaker.left() + ' 秒后继续', until: breaker.until };
    if (!plannedJds().length) return { state: 'stopped', text: '今日计划里没有岗位，到「智选 · 岗位计划」勾选' };
    var sum = PL().summary(state.jds, s, state.planProgress, window.__HRS_SITE__);
    if (!sum.window.ok) return { state: 'resting', text: dry + '不在执行时段（' + sum.window.text + '），到时段自动开始' };
    if (sum.allFull) return { state: 'resting', text: dry + '今日计划已完成，明天自动继续' };
    var ri = activeEngine && activeEngine.hooks.restInfo ? activeEngine.hooks.restInfo() : null;
    if (ri) return { state: 'resting', text: dry + ri.why, until: ri.until };
    if (rpaNoteState.code && state.rpaWait && Date.now() - state.rpaWait.at < 30000 && !state.busy && state.nextAt > Date.now()) return { state: 'running', text: dry + 'RPA 等待中：' + state.rpaWait.why };
    return { state: 'running', text: dry + waitText() };
  }
  function reportStatus() {
    if (!window.HRSRunLog || mainUiHidden()) return;
    if (!state.settings) return;
    try { HRSRunLog.status(engineKey(), statusNow()); } catch (e) {}
  }
  function toggleRun() {
    if (state.manualPaused) {
      state.manualPaused = false;
      state.riskStop = '';
      if (breaker) breaker.cancel();
      state.seen = {};
      // v1.8.4 继续时从「新招呼 + 未读」开始；判定过的人记在 judgedLog 里，不会再判一遍
      if (activeEngine && activeEngine.hooks.onResume) activeEngine.hooks.onResume();
      uiLog('', '已恢复自动筛选，从新招呼的未读开始，判定过的人跳过');
      if (activeEngine) activeEngine.tick();
    } else {
      state.manualPaused = true;
      state.queue = [];
      if (state.paceTimer) { clearTimeout(state.paceTimer); state.paceTimer = null; }
      uiLog('', '已暂停自动筛选（当前这位处理完即停）');
    }
    renderUi();
  }
  var activeEngine = null;
  // v1.9.0 通用控件采集：卡片、按钮、右侧头部，给猎聘等新页面做侦察用（不用按 F12）
  function collectPageDump() {
    function desc(el) {
      if (!el) return null;
      var r = el.getBoundingClientRect();
      return { tag: el.tagName.toLowerCase(), cls: String(el.className && el.className.baseVal != null ? el.className.baseVal : el.className || '').slice(0, 100), text: textOf(el).replace(/\s+/g, ' ').slice(0, 60), rect: [Math.round(r.left), Math.round(r.top), Math.round(r.width), Math.round(r.height)] };
    }
    var eng = activeEngine, cards = [];
    try { cards = eng && eng.hooks.findCards ? eng.hooks.findCards().slice(0, 3) : []; } catch (e) {}
    var btns = qsa('button,a,[role=button],span,div').filter(function (el) {
      if (el.closest('#__hrs_ui__')) return false;
      var t = textOf(el).replace(/\s+/g, '');
      if (!t || t.length > 8 || el.children.length > 2) return false;
      var r = el.getBoundingClientRect();
      return r.width > 20 && r.height > 14 && r.width < 220 && /打招呼|沟通|聊|索要|简历|发送|不合适|未读|全部|新招呼|筛选|职位|立即/.test(t);
    }).slice(0, 40).map(desc);
    return {
      at: new Date().toISOString(), version: HRS_VERSION, site: window.__HRS_SITE__ || '', url: location.href, isTop: window === window.top,
      cards: cards.map(function (c) { var chain = [], cur = c; for (var i = 0; i < 3 && cur; i++) { chain.push(desc(cur)); cur = cur.parentElement; } return { card: desc(c), parents: chain.slice(1), inner: qsa('*', c).filter(function (x) { return !x.children.length && textOf(x); }).slice(0, 12).map(desc) }; }),
      pane: eng && eng.hooks.summaryDump ? eng.hooks.summaryDump() : null,
      buttons: btns
    };
  }
  function renderQuickScripts() {
    if (!ui) return;
    var box = ui.querySelector('.quick');
    if (!box) return;
    var scripts = (state.settings && state.settings.scripts) || {};
    var defs = [['request', '索要简历'], ['contact', '联系候选人'], ['interviewQuestions', '岗位提问'], ['followup', '跟进'], ['interview', '面试安排'], ['rejection', '拒绝话术']];
    var sig = defs.map(function (d) { return scripts[d[0]] ? d[0] : ''; }).join(',');
    if (sig === quickSig) return;
    quickSig = sig;
    box.innerHTML = '<div class="qt">固定话术 <span title="发给当前打开的候选人，点击后自动流程暂停" style="display:inline-flex;align-items:center;justify-content:center;width:14px;height:14px;border-radius:50%;background:var(--line);color:var(--text-2);font-size:var(--fs-xs);font-weight:600;cursor:help;margin-left:4px;">?</span></div>';
    defs.forEach(function (d) {
      if (!scripts[d[0]]) return;
      var b = document.createElement('button');
      b.type = 'button';
      b.textContent = d[1];
      b.addEventListener('click', function () { sendQuickScript(d[0], d[1], (state.settings.scripts || {})[d[0]]); });
      box.appendChild(b);
    });
  }
  function sendQuickScript(key, label, template, idtOverride) {
    state.manualPaused = true;
    var engine = activeEngine;
    if (!engine || !engine.hooks || !engine.hooks.getActiveIdentity) {
      uiLog('tip', '请先进入 Boss/猎聘「我的沟通」页面');
      return;
    }
    var identity = engine.hooks.getActiveIdentity() || idtOverride || null;
    if (!identity || (engine.hooks.assertConversation && !engine.hooks.assertConversation(identity))) {
      uiLog('tip', '请先在沟通列表中打开并确认一个候选人会话');
      return;
    }
    var name = identity.name || '候选人';
    var text = fillTemplate(template, name);
    var id = candidateIdForIdentity(identity);
    confirmAction(label + '：' + name, text).then(function (ok) {
      if (!ok) return;
      // v1.9.48 你手动点的固定话术：RPA 只等你松手 1.5 秒就接手打字（不用等默认的空闲时间）
      if (rpaActive() && HRSDom.rpaQuick) HRSDom.rpaQuick(30000);
      if (engine.hooks.assertConversation && !engine.hooks.assertConversation(identity)) {
        uiLog('warn', '会话已变化，固定话术未发送');
        return;
      }
      // v1.9.21 会话刚打开时输入框还没出来：最多试 4 次，每次隔 1.5 秒
      var tries = 0;
      (function attempt() {
        return engine.hooks.sendMessage(null, text, identity).then(function (ok) {
          if (ok || ++tries >= 4) return ok;
          return sleep(1500).then(attempt);
        });
      })().then(function (sent) {
        if (sent) {
          recordMsg(id, name, label, text, window.__HRS_SITE__, { sourceUrl: chatUrlForIdentity(identity), chatId: identity.chatId || '', contactStatus: 'contacted' });
          uiLog('pass', '固定话术已发送 → ' + name + ' · ' + label);
        } else {
          uiLog('err', '固定话术发送失败 → ' + name + '（未找到输入框或发送按钮）');
        }
      });
    });
  }
  // ---------- v1.9.17 人才库跳转：在沟通列表里按姓名找到这个人并点开，需要时发固定话术 ----------
  // v1.9.49 「要找谁」：姓名、发什么话术、沟通职位（区分同名的人）、岗位、会话编号
  function parseFind(hash) {
    var h = {};
    String(hash || '').replace(/^#/, '').split('&').forEach(function (kv) { var p = kv.split('='); if (p[0]) { try { h[p[0]] = decodeURIComponent(p[1] || ''); } catch (e) { h[p[0]] = p[1] || ''; } } });
    var name = String(h.hrs_find || '').trim();
    return name ? { name: name, tpl: h.hrs_tpl || '', job: h.hrs_job || '', jd: h.hrs_jd || '', cid: h.hrs_cid || '', rid: h.hrs_rid || '' } : null;
  }
  function cleanFindUrl() {
    // 去掉 # 部分；Boss 地址里的 chatId 也去掉（Boss 不认它，留着会干扰「是不是这个人」的核对）
    try {
      var u = new URL(location.href);
      u.hash = '';
      if (window.__HRS_SITE__ === 'boss') { u.searchParams.delete('chatId'); u.searchParams.delete('chatid'); }
      history.replaceState(history.state, '', u.pathname + u.search);
    } catch (e) {}
  }
  // v1.9.49 认人：先找姓名完全一样的；同名的（「陈女士」「王先生」很常见）再用会话编号、沟通职位区分；
  // 还分不出来就返回多个（调用方不点），绝不打开一个「可能是」的人。v3.6.0 待确认拒绝也用它找人
  function pickCardsFor(engine, req) {
    var nn = String(req && req.name || '').trim().replace(/\s+/g, '');
    var nz = function (x) { return String(x || '').replace(/\s+|…|\.\.\./g, '').toLowerCase(); };
    var jobHit = function (a, b) { a = nz(a); b = nz(b); return !!a && !!b && (a.indexOf(b) >= 0 || b.indexOf(a) >= 0); };
    var cards = engine.hooks.findCards() || [];
    var nameOfC = function (c) { return String(engine.hooks.extractName(c) || '').replace(/\s+/g, ''); };
    var pool = cards.filter(function (c) { return nameOfC(c) === nn; });
    if (!pool.length) {
      pool = cards.filter(function (c) { var n = nameOfC(c); return n && n.length >= 2 && (n.indexOf(nn) === 0 || nn.indexOf(n) === 0); });
      if (pool.length > 1) pool = [];   // 只有前缀对得上、又不止一个：不猜
    }
    if (pool.length && req.cid) {
      // v2.5.0 有会话编号时以它为准：编号对得上的直接用；名字一样但编号不一样的是另一个人，不点
      var cidOf = function (c) { var idt = engine.hooks.getIdentity ? engine.hooks.getIdentity(c) : null; return idt && idt.chatId ? String(idt.chatId) : ''; };
      var byId = pool.filter(function (c) { return cidOf(c) === String(req.cid); });
      if (byId.length === 1) return byId;
      pool = pool.filter(function (c) { return !cidOf(c); });
    }
    if (pool.length > 1 && (req.job || req.jd)) {
      var byJob = pool.filter(function (c) { var idt = engine.hooks.getIdentity ? engine.hooks.getIdentity(c) : null; return idt && (jobHit(idt.jobText, req.job) || jobHit(idt.jobText, req.jd)); });
      if (byJob.length) pool = byJob;
    }
    return pool;
  }
  function findFromHash(engine, req) {
    req = req || parseFind(INIT_HASH) || parseFind(location.hash);
    cleanFindUrl();
    if (!req || !req.name) return;
    var name = String(req.name).trim(), tpl = req.tpl || '';
    // v2.5.0 结果报给「简历收集」页面：找到了 / 没找到、为什么
    var report = function (kind, text) {
      uiLog(kind, text);
      send({ type: 'FIND_RESULT', rid: req.rid || '', ok: kind === 'pass', name: name, why: text });
    };
    if (rpaActive() && HRSDom.rpaQuick) HRSDom.rpaQuick(60000);   // v1.9.48 你刚在人才库点的：RPA 只等你松手 1.5 秒
    var nn = name.replace(/\s+/g, '');
    // v1.9.49 认人：先找姓名完全一样的；同名的（「陈女士」「王先生」很常见）再用会话编号、沟通职位区分；
    // 还分不出来就不点，提示你手动点，绝不打开一个「可能是」的人
    var nz = function (x) { return String(x || '').replace(/\s+|…|\.\.\./g, '').toLowerCase(); };
    var jobHit = function (a, b) { a = nz(a); b = nz(b); return !!a && !!b && (a.indexOf(b) >= 0 || b.indexOf(a) >= 0); };
    var ambiguous = 0;
    var pickCards = function () { return pickCardsFor(engine, req); };
    var cardOf = function () {
      var p = pickCards();
      ambiguous = p.length > 1 ? p.length : 0;
      return p.length === 1 ? p[0] : null;
    };
    var searchBox = function () {
      return qsa('input').filter(function (i) {
        var r = i.getBoundingClientRect();
        return r.width > 40 && r.height > 10 && r.left < window.innerWidth * 0.5 && !i.closest('#__hrs_ui__') && /搜索|姓名|联系人|名字|search/i.test((i.getAttribute('placeholder') || '') + ' ' + (i.className || ''));
      })[0] || null;
    };
    var openSearch = function () {
      if (searchBox()) return Promise.resolve(searchBox());
      // 搜索框藏在放大镜按钮后面：点左侧列表上方带 search 的小按钮
      var ic = qsa('[class*="search"],[class*="Search"]').filter(function (el) {
        var r = el.getBoundingClientRect();
        return r.width > 8 && r.width < 60 && r.height < 60 && r.top < 340 && r.left < window.innerWidth * 0.5 && !el.closest('#__hrs_ui__');
      })[0];
      if (ic) {
        if (rpaActive()) return actClick(ic).then(function () { return sleep(800); }).then(function () { return searchBox(); });
        try { ic.click(); } catch (e) {}
      }
      return new Promise(function (r) { setTimeout(function () { r(searchBox()); }, 800); });
    };
    var typeIn = function (inp) {
      if (rpaActive()) {
        // v1.9.48 真实键盘在搜索框里输入姓名，再按回车
        return HRSDom.rpaType(inp, name, { clear: true }).then(function (r) {
          if (!r.ok) { rpaNote(r); return; }
          return HRSDom.rpaKey('enter');
        });
      }
      inp.focus();
      try { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(inp, name); } catch (e) { inp.value = name; }
      ['input', 'change'].forEach(function (t) { inp.dispatchEvent(new Event(t, { bubbles: true })); });
      ['keydown', 'keypress', 'keyup'].forEach(function (t) { inp.dispatchEvent(new KeyboardEvent(t, { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true })); });
    };
    var inputReady, waitInput;
    inputReady = function () {
      return qsa('textarea,[contenteditable="true"],.chat-input,#chat-input').some(function (el) {
        var r = el.getBoundingClientRect();
        return r.width > 60 && r.height > 10 && r.left > window.innerWidth * 0.3 && !el.closest('#__hrs_ui__');
      });
    };
    waitInput = function (n) {
      if (inputReady()) return Promise.resolve(true);
      if (n <= 0) return Promise.resolve(false);
      return sleep(500).then(function () { return waitInput(n - 1); });
    };
    var done = function (card) {
      var idt = engine.hooks.getIdentity ? engine.hooks.getIdentity(card) : { name: name };
      // v1.9.21 打开后等右侧输入框出来再发；没出来就再点一次
      return engine.hooks.openCard(card, idt).then(function (ok) {
        if (!ok) return false;
        return waitInput(12).then(function (r) {
          if (r) return true;
          var c3 = cardOf() || card;
          return engine.hooks.openCard(c3, idt).then(function (ok2) { return ok2 ? waitInput(12) : false; });
        });
      }).then(function (ok) {
        if (!ok) { report('warn', '找到了「' + name + '」，但右侧会话没打开（或没出现输入框），请手动点开后再点「面试安排」'); return; }
        var act = engine.hooks.getActiveIdentity && engine.hooks.getActiveIdentity();
        if (req.cid && act && act.chatId && String(act.chatId) !== String(req.cid)) { report('warn', '打开的会话编号和要找的「' + name + '」对不上，为防看错人请手动核对'); return; }
        report('pass', '已打开「' + name + '」的会话（自动流程已暂停，处理完点「继续自动」）');
        if (tpl) {
          var sc = (state.settings.scripts || {})[tpl];
          if (!sc) { uiLog('tip', '「话术」里还没有填这条话术'); return; }
          sendQuickScript(tpl, tpl === 'interview' ? '面试安排' : tpl, sc);
        }
      });
    };
    var c = cardOf();
    if (c) { done(c); return; }
    if (ambiguous) uiLog('', '列表里有 ' + ambiguous + ' 个「' + name + '」，分不出是哪一位，改用搜索再核对…');
    else uiLog('', '列表里没看到「' + name + '」，在左侧搜索框里搜索…');
    openSearch().then(function (inp) {
      if (!inp) { report('warn', '没找到左侧的搜索框，请手动搜索「' + name + '」'); return; }
      return Promise.resolve(typeIn(inp)).then(function () {
      var n = 0;
      // v1.9.27 Boss 搜索结果是输入框下面弹出的「联系人」下拉，回车不会选中：直接点下拉里这个人
      var resultEl = function () {
        var ib = inp.getBoundingClientRect();
        var hits = qsa('li,div,span,a,p').filter(function (el) {
          if (el.closest('#__hrs_ui__') || el.children.length > 4 || !vis(el) || el === inp || el.contains(inp)) return false;
          var r = el.getBoundingClientRect();
          if (r.top < ib.bottom - 2 || r.top > ib.bottom + 420 || r.right < ib.left || r.left > ib.right) return false;
          var t = txt(el).replace(/\s+/g, '');
          return t.indexOf(nn) === 0 && t.length <= nn.length + 80;
        }).sort(function (a, b) { return txt(a).length - txt(b).length; });
        // v1.9.49 每一行只留一个元素；同名的多行再按沟通职位区分，分不出就不点
        var rows = [];
        hits.forEach(function (el) { var rw = rowOf(el); if (rows.indexOf(rw) < 0) rows.push(rw); });
        if (rows.length > 1 && (req.job || req.jd)) {
          var bj = rows.filter(function (rw) { return jobHit(txt(rw), req.job) || jobHit(txt(rw), req.jd); });
          if (bj.length) rows = bj;
        }
        ambiguous = rows.length > 1 ? rows.length : 0;
        return rows.length === 1 ? rows[0] : null;
      };
      var rowOf = function (el) {
        for (var i = 0, cur = el; i < 5 && cur && cur !== document.body; i++, cur = cur.parentElement) {
          if (cur.tagName === 'LI' || getComputedStyle(cur).cursor === 'pointer') return cur;
        }
        return el;
      };
      var opened = function () {
        var a = engine.hooks.getActiveIdentity && engine.hooks.getActiveIdentity();
        if (a && a.name && String(a.name).replace(/\s+/g, '') === nn) return a;
        return headerNameEl(name, window.innerWidth * 0.3) ? { name: name } : null;
      };
      var doneActive = function (row) {
        domClick(row);
        var k = 0;
        (function waitOpen() {
          var idt = opened();
          if (idt) {
            if (req.cid && idt.chatId && String(idt.chatId) !== String(req.cid)) { report('warn', '搜到的「' + name + '」会话编号对不上，可能是同名的另一个人，为防看错人没有继续，请手动核对'); return; }
            return waitInput(12).then(function (ok) {
              if (!ok) { report('warn', '打开了「' + name + '」，但没看到输入框，请手动发'); return; }
              report('pass', '已打开「' + name + '」的会话（自动流程已暂停，处理完点「继续自动」）');
              if (!tpl) return;
              var sc = (state.settings.scripts || {})[tpl];
              if (!sc) { uiLog('tip', '「话术」里还没有填这条话术'); return; }
              sendQuickScript(tpl, tpl === 'interview' ? '面试安排' : tpl, sc, idt);
            });
          }
          if (++k === 4 && !rpaActive()) trustedAt(row);   // v1.9.48 RPA 本来就是真实点击，不再补点
          if (k < 14) return setTimeout(waitOpen, 500);
          report('warn', '点了搜索结果里的「' + name + '」，会话没打开，请手动点一下');
        })();
      };
      (function wait() {
        var c2 = cardOf();
        if (c2) return done(c2);
        var hit = resultEl();
        if (hit) return doneActive(rowOf(hit));
        if (n++ < 10) return setTimeout(wait, 600);
        if (ambiguous) { report('warn', '搜到 ' + ambiguous + ' 个「' + name + '」' + (req.job ? '（沟通职位都对得上「' + req.job + '」）' : '') + '，分不出是哪一位，为防打开错人没有点，请手动点开'); return; }
        report('warn', '搜索后列表里还是没有「' + name + '」，可能对方改了名字或会话已删除');
      })();
      });
    });
  }
  function capInfo() {
    var today = PL().localDate();
    var n = state.cap && state.cap.date === today ? state.cap.n : 0;
    return { n: n, cap: (state.settings && state.settings.dailyCap) || '不限' };
  }
  function modeInfo() {
    var s = state.settings || {};
    if (!s.masterEnabled || state.stopped) return { key: 'stop', label: '已停止', color: 'var(--muted)', bg: 'var(--surface-2)', fg: 'var(--text-2)' };
    if (s.dryRun) return { key: 'dry', label: '试运行', color: 'var(--warn-500)', bg: 'var(--warn-50)', fg: 'var(--warn-700)' };
    return { key: 'live', label: '正式运行', color: 'var(--ok-500)', bg: 'var(--ok-50)', fg: 'var(--ok-700)' };
  }
  function waitText() {
    if (state.busy) return '处理中';
    var left = Math.ceil((state.nextAt - Date.now()) / 1000);
    if (left > 0 && state.queue.length) return '下一位 ' + left + 's';
    return state.queue.length ? '排队 ' + state.queue.length : (state.idleSkipped ? '等待新消息（' + state.idleSkipped + ' 人不在计划，保留未读）' : '等待新消息');
  }
  function mainUiHidden() { return /\/web\/chat\/(recommend|job)|\/web\/frame\/recommend/i.test(location.pathname) || (/liepin\.com$/i.test(location.hostname) && /recommend/i.test(location.pathname)); }
  function renderUi() {
    var u = ensureUi();
    u.style.display = mainUiHidden() ? 'none' : '';
    var m = modeInfo();
    var paused = state.manualPaused && m.key !== 'stop';
    u.querySelector('.dot').style.background = state.lastError ? 'var(--bad-500)' : (paused ? 'var(--muted)' : m.color);
    u.querySelector('.pill').classList.toggle('bad', !!state.lastError);
    var sum = PL().summary(state.jds, state.settings, state.planProgress, window.__HRS_SITE__);
    var jdName = sum.planned.length ? '计划 ' + sum.planned.length + ' 岗 ' + sum.done + '/' + (sum.unlimited ? '不限' : sum.quota) : '计划里没有岗位';
    if (!sum.window.ok) jdName += ' · 时段外';
    var status = m.key === 'stop' ? '已停止' : (paused ? '已暂停' : (!sum.window.ok ? '等待时段 ' + sum.window.text : (sum.allFull ? '今日计划已完成' : m.label + ' · ' + waitText())));
    if (breaker && breaker.resting() && m.key !== 'stop' && !paused) status = m.label + ' · 小憩中 ' + breaker.left() + 's';
    var td = state.todayStat || { scan: 0, pass: 0, reject: 0, review: 0 };
    u.querySelector('.txt').textContent = 'Smart Filter v' + HRS_VERSION + ' · ' + status + ' · 今日 扫 ' + td.scan + ' · 过 ' + td.pass + ' · 拒 ' + td.reject + (td.review ? ' · 待 ' + td.review : '') + (state.lastError ? ' · 有失败' : '');
    u.querySelectorAll('.mode button').forEach(function (b) { b.classList.toggle('on', b.getAttribute('data-m') === m.key); });
    var eb = u.querySelector('.errbar');
    eb.style.display = state.lastError ? 'block' : 'none';
    u.querySelector('.et').textContent = state.lastError || '';
    var pace = u.querySelector('.pace');
    if (document.activeElement !== pace) pace.value = currentPace();
    var run = u.querySelector('.run');
    run.style.display = m.key === 'stop' ? 'none' : '';
    run.textContent = paused ? '继续自动' : '暂停';
    run.className = 'run ' + (paused ? 'go' : 'stop');
    var ci = capInfo();
    var perHour = Math.floor(3600 / currentPace());
    var rr = window.HRSRhythm ? HRSRhythm.norm(state.settings && state.settings.rhythm) : null;
    var jit = state.settings && state.settings.paceJitter !== false ? (rr && rr.on ? '（拟人节奏：浮动 ±' + rr.paceVar + '%，每 ' + rr.breakEveryMin + '~' + rr.breakEveryMax + ' 人小憩）' : '（含0~20%随机浮动）') : '';
    u.querySelector('.sub').textContent = jdName + ' · 时段 ' + sum.window.text + ' · 今日动作 ' + ci.n + (ci.cap === '不限' ? ' 次' : '/' + ci.cap) + ' · 最快约 ' + perHour + ' 个/小时' + jit;
    renderQuickScripts();
    reportStatus();
  }
  /** v1.5.2 当前候选人核对卡：每条条件一行，不满足标红，读不到标黄，加分命中标绿 */
  function escH(x) { return String(x == null ? '' : x).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function renderResultCard(name, jd, res, item) {
    var u = ensureUi();
    var box = u.querySelector('.rc');
    var h = res.hits || {};
    var vd = { pass: ['合格', 'var(--ok)'], reject: ['不合格', 'var(--bad)'], review: ['待复核', 'var(--warn-500)'] }[res.verdict] || ['?', 'var(--text-2)'];
    var html = '<div class="rh"><b>' + escH(name) + '</b><span class="jd">' + escH(jd && jd.title || '') + '</span><span class="vd" style="background:' + vd[1] + '">' + vd[0] + '</span></div>';
    var rows = h.rows || [];
    if (rows.length) {
      html += '<table>' + rows.map(function (r) {
        var cls = r.ok === true ? 'ok' : (r.ok === false ? 'bad' : 'unk');
        var mark = r.ok === true ? '✓' : (r.ok === false ? '✗' : '?');
        return '<tr class="' + cls + '"><td class="s">' + mark + '</td><td class="k">' + escH(r.rule) + '</td><td>' + escH(r.got) + '</td></tr>';
      }).join('') + '</table>';
    } else {
      html += '<div class="bn">' + escH((res.reasons || []).join('。')) + '</div>';
    }
    var all = h.bonusAll || [], on = h.optionalHit || [];
    if (all.length) {
      html += '<div class="bn">加分 ' + on.length + '/' + all.length + '：' + all.map(function (k) {
        return '<span class="chip' + (on.indexOf(k) >= 0 ? ' on' : '') + '">' + escH(k) + '</span>';
      }).join('') + '</div>';
    }
    var raw = 'workLines（按行读到的工作经历）：\n' + ((item && item.workLines) || []).join('\n') + '\n\n摘要原文：\n' + ((item && item.summary) || '（空）');
    html += '<details><summary>插件读到的原文（核对用）</summary><pre>' + escH(raw) + '</pre></details>';
    box.innerHTML = html;
    box.style.display = 'block';
    // 判完一位就把面板展开给你看，除非你手动收起过
    if (!state.panelClosedByUser) u.querySelector('.panel').style.display = 'block';
  }

  function uiLog(cls, text) {
    var u = ensureUi();
    var l = u.querySelector('.logbody');
    var d = document.createElement('div');
    cls = cls || '';
    var t = new Date().toLocaleTimeString('zh-CN', { hour12: false });
    d.className = 'l ' + cls;
    d.textContent = t + ' ' + (LOG_TAG[cls] || '[信息]') + ' ' + text;
    l.appendChild(d);
    while (l.children.length > 80) l.removeChild(l.firstChild);
    l.scrollTop = l.scrollHeight;
    if (cls === 'err') {
      state.lastError = t + ' ' + text;
      // v2.3.0 报错同时进运行记录（原因按文字归类：RPA 没连上 / 窗口被挡 / 验证…）
      if (window.HRSRunLog && !/^检测到「/.test(text)) runAdd('提示', '', false, { why: text }, text);
    }
    var pill = u.querySelector('.pill');
    pill.classList.add('flash');
    setTimeout(function () { pill.classList.remove('flash'); }, 800);
    renderUi();
  }

  // ================= 卡片判定角标（网页端工作痕迹） =================
  function addCardBadge(card, res) {
    if (!card || !res) return;
    if (state.settings && state.settings.showCardBadge === false) return;
    if (card.__hrsBadge) return;
    var b = document.createElement('div');
    b.className = '__hrs_cbadge__';
    b.style.cssText = 'position:absolute;top:4px;right:4px;z-index:2147483645;font:bold 11px/1.6 "Microsoft YaHei",sans-serif;padding:1px 8px;border-radius:10px;color:#fff;pointer-events:none;box-shadow:0 1px 4px rgba(0,0,0,.25);';
    b.style.background = res.verdict === 'pass' ? '#059669' : res.verdict === 'reject' ? '#dc2626' : '#f59e0b';
    var oh = res.hits && res.hits.optionalHit ? res.hits.optionalHit.length : 0;
    b.textContent = (res.verdict === 'pass' ? '合格' + (oh ? ' +' + oh : '') : res.verdict === 'reject' ? '不合格' : '待复核');
    b.title = (res.reasons || []).join('\n');
    try {
      if (getComputedStyle(card).position === 'static') card.style.position = 'relative';
      card.appendChild(b);
      card.__hrsBadge = true;
    } catch (e) {}
  }

  // ================= 岗位范围锁定 =================
  /**
   * v1.3.0 判断候选人属于今日计划里的哪个岗位。
   * 返回 null：看不出岗位。返回 ok=false：能看出岗位，但不在计划 / 已到量。
   */
  function resolvePlanJd(text) {
    var CT = window.HRSChatTarget;
    var r = PL().resolveJd(text, state.jds || [], CT ? CT.findHits : null);
    if (!r) return null;
    var jd = r.jd;
    var how = r.how === 'platform' ? '平台职位名' : '关键词「' + r.hits.slice(0, 2).join('、') + '」';
    if (!PL().isPlanned(jd, state.settings)) return { ok: false, jd: jd, reason: '岗位「' + jd.title + '」未加入今日计划' };
    var SITE = window.__HRS_SITE__;
    if (SITE && PL().onSite && !PL().onSite(jd, SITE)) {
      return { ok: false, jd: jd, reason: '岗位「' + jd.title + '」没有' + (SITE === 'boss' ? 'Boss' : '猎聘') + '标签，在这个平台的计划量是 0' };
    }
    if (PL().isFull(jd, state.planProgress, SITE)) {
      return { ok: false, jd: jd, reason: '岗位「' + jd.title + '」今日已满 ' + PL().doneOf(jd, state.planProgress, SITE) + '/' + PL().quotaOf(jd, SITE) };
    }
    return { ok: true, jd: jd, reason: '归入「' + jd.title + '」（' + how + '）' };
  }

  // ================= 话术发送记录（v1.0.6：发出的邀请/拒绝/提问话术随时可查） =================
  var msgCache = {};   // candidateId -> messages[]
  function recordMsg(id, name, type, text, site, extraPatch) {
    var m = {
      dir: 'out',
      time: new Date().toISOString().slice(0, 16).replace('T', ' '),
      type: type,
      text: String(text || '').slice(0, 2000),
      site: site,
      status: 'sent'
    };
    msgCache[id] = (msgCache[id] || []).concat(m);
    var patch = { contactStatus: type === '拒绝话术' ? 'rejected' : 'contacted' };
    if (extraPatch) Object.assign(patch, extraPatch);
    send({ type: 'TALENT_UPDATE', id: id, patch: patch, appendMessage: m });
    return m;
  }
  function chatUrlForIdentity(identity) {
    if (!identity || !window.HRSChatTarget) return '';
    return identity.chatId ? window.HRSChatTarget.chatUrl(window.__HRS_SITE__, identity.chatId) : '';
  }
  function candidateIdForIdentity(identity) {
    if (!identity) return '';
    var prefix = window.__HRS_SITE__ === 'boss' ? 'b_' : 'l_';
    return prefix + hash([identity.chatId || '', identity.name || '', identity.jobText || ''].join('|'));
  }

  // ================= 确认弹窗 =================
  function confirmAction(title, text) {
    return new Promise(function (resolve) {
      if (state.noConfirm) return resolve(true);
      // v2.8.0 确认弹窗也放进隔离层，用设计令牌
      var box = (window.HRSPanel && window.HRSPanel.mount) ? window.HRSPanel.mount('__hrs_confirm__') : document.createElement('div');
      var close = function () { (box.__hrsHost || box).remove(); };
      box.style.cssText = 'position:fixed;inset:0;background:rgba(17,24,39,.45);z-index:2147483647;display:flex;align-items:center;justify-content:center;font-family:"Microsoft YaHei",sans-serif;';
      box.innerHTML =
        '<div style="background:var(--surface);color:var(--text);border-radius:var(--r-lg);max-width:420px;width:90%;padding:20px;box-shadow:var(--sh-3);">' +
        '<div style="font-size:var(--fs-lg);font-weight:600;margin-bottom:10px;">' + title + '</div>' +
        '<div style="font-size:var(--fs-md);color:var(--text-2);white-space:pre-wrap;max-height:200px;overflow:auto;margin-bottom:14px;word-break:break-all;">' + text.replace(/</g, '&lt;') + '</div>' +
        '<div style="text-align:right;">' +
        '<button data-a="no" style="border:1px solid var(--field);background:var(--surface);color:var(--text);border-radius:var(--r-md);padding:6px 14px;margin-right:8px;cursor:pointer;font:inherit;">跳过</button>' +
        '<button data-a="once" style="border:none;background:var(--brand);color:var(--on-color);border-radius:var(--r-md);padding:6px 14px;margin-right:8px;cursor:pointer;font:inherit;">本次不再确认</button>' +
        '<button data-a="yes" style="border:none;background:var(--bad);color:var(--on-color);border-radius:var(--r-md);padding:6px 14px;cursor:pointer;font:inherit;">确认执行</button>' +
        '</div></div>';
      if (!box.isConnected) document.documentElement.appendChild(box);
      box.addEventListener('click', function (e) {
        var a = e.target && e.target.getAttribute && e.target.getAttribute('data-a');
        if (a === 'yes') { close(); resolve(true); }
        else if (a === 'once') { state.noConfirm = true; close(); resolve(true); }
        else if (a === 'no') { close(); resolve(false); }
      });
    });
  }

  // ================= 诊断模式 =================
  var diagState = { on: false, overlay: null, pick: false };
  function setDiagMode(on) {
    diagState.on = on;
    if (on) {
      if (!diagState.overlay) {
        diagState.overlay = document.createElement('div');
        diagState.overlay.style.cssText = 'position:fixed;top:8px;left:8px;z-index:2147483646;background:#0f172a;color:#e2e8f0;font:12px/1.7 "Microsoft YaHei",sans-serif;padding:10px 14px;border-radius:10px;max-width:460px;box-shadow:0 6px 20px rgba(0,0,0,.3);';
        document.documentElement.appendChild(diagState.overlay);
        diagState.overlay.addEventListener('click', function (e) {
          if (e.target && e.target.getAttribute && e.target.getAttribute('data-a') === 'pick') {
            diagState.pick = true;
            diagState.overlay.querySelector('.hint').textContent = '请在页面上点击一个元素…';
          }
        });
      }
      diagState.overlay.style.display = 'block';
      document.addEventListener('click', diagClick, true);
    } else {
      if (diagState.overlay) diagState.overlay.style.display = 'none';
      document.removeEventListener('click', diagClick, true);
      qsa('[data-hrs-diag]').forEach(function (el) { el.removeAttribute('data-hrs-diag'); });
    }
  }
  function diagClick(e) {
    if (!diagState.pick) return;
    e.preventDefault(); e.stopPropagation();
    diagState.pick = false;
    var el = e.target;
    var selectors = suggestSelectors(el);
    var overlay = diagState.overlay;
    overlay.querySelector('.hint').textContent = '已选中：' + el.tagName + ' (点击按钮保存为卡片选择器)';
    var btns = overlay.querySelector('.selbtns');
    btns.innerHTML = '';
    selectors.slice(0, 4).forEach(function (sel) {
      var b = document.createElement('button');
      b.textContent = sel;
      b.style.cssText = 'margin:2px;padding:2px 6px;border-radius:6px;border:1px solid #334155;background:#1e293b;color:#e2e8f0;cursor:pointer;font-size:11px;';
      b.addEventListener('click', function () {
        var cfg = state.siteConfig || { cardSelectors: [] };
        cfg.cardSelectors = [sel].concat((cfg.cardSelectors || []).filter(function (s) { return s !== sel; }));
        send({ type: 'SAVE_SETTINGS', patch: { siteConfig: Object.assign({}, state.settings.siteConfig || {}, (_ = {}, _[window.__HRS_SITE__] = cfg, _)) } }).then(function () {
          overlay.querySelector('.hint').textContent = '已保存选择器，刷新页面生效：' + sel;
        });
        var _;
      });
      btns.appendChild(b);
    });
  }
  function suggestSelectors(el) {
    var out = [];
    if (el.id) out.push('#' + el.id);
    if (el.className && typeof el.className === 'string') {
      var cls = el.className.trim().split(/\s+/).slice(0, 3).map(function (c) { return '.' + c; }).join('');
      if (cls.length < 80) out.push(el.tagName.toLowerCase() + cls);
    }
    var parent = el.parentElement;
    if (parent && parent.className && typeof parent.className === 'string') {
      var pcls = parent.className.trim().split(/\s+/).slice(0, 2).map(function (c) { return '.' + c; }).join('');
      if (pcls.length < 60) out.push(parent.tagName.toLowerCase() + pcls + ' ' + el.tagName.toLowerCase());
    }
    out.push(el.tagName.toLowerCase() + ':has-text("' + (el.textContent || '').trim().slice(0, 12) + '")');
    return out.filter(function (s, i) { return out.indexOf(s) === i; });
  }

  // ================= 主引擎 =================
  function Engine(site, hooks) {
    activeEngine = this;
    this.site = site;
    this.hooks = wrapHooks(hooks);
    this.timer = null;
    this.observer = null;
  }
  // v2.3.0 运行记录：打开会话、已读、发消息这几个动作做完记一条（成功 / 失败 + 原因）
  function nameOfIdentity(identity, card, hooks) {
    if (identity && identity.name) return identity.name;
    try { return (card && hooks.extractName && hooks.extractName(card)) || ''; } catch (e) { return ''; }
  }
  function wrapHooks(h) {
    if (!h || h.__runWrapped) return h;
    h.__runWrapped = true;
    if (h.sendMessage) {
      var send0 = h.sendMessage;
      h.sendMessage = function (card, text, identity) {
        var t0 = Date.now(), who = nameOfIdentity(identity, card, h);
        return Promise.resolve(send0.apply(this, arguments)).then(function (ok) {
          runAdd('发消息', who, !!ok, ok ? null : failOf(t0, '没确认发出去（会话变了、输入框没找到或发送后输入框没清空）'), preview(text));
          return ok;
        });
      };
    }
    if (h.openCard) {
      var open0 = h.openCard;
      h.openCard = function (card, identity) {
        var t0 = Date.now(), who = nameOfIdentity(identity, card, h);
        return Promise.resolve(open0.apply(this, arguments)).then(function (ok) {
          runAdd('打开会话', who, !!ok, ok ? null : failOf(t0, '没能确认打开的是这个人的会话'));
          return ok;
        });
      };
    }
    if (h.markRead) {
      var read0 = h.markRead;
      h.markRead = function (card, identity) {
        var t0 = Date.now(), who = nameOfIdentity(identity, card, h);
        return Promise.resolve(read0.apply(this, arguments)).then(function (ok) {
          runAdd('已读', who, !!ok, ok ? null : failOf(t0, '没找到「已读」按钮或会话不对'));
          return ok;
        });
      };
    }
    return h;
  }

  Engine.prototype.bindManualPause = function () {
    var self = this;
    if (self._manualBound) return;
    self._manualBound = true;
    document.addEventListener('click', function (e) {
      if (!e.isTrusted) return;
      // v1.9.40 插件自己用真实鼠标点的（打开会话、关弹窗），不算手动操作
      if (Date.now() - (window.__hrsSelfTrustedAt || 0) < 3000) return;
      // v1.9.48 RPA 的点击也是真实点击：自己点的不算「你手动打开了候选人」
      if (window.HRSDom && HRSDom.rpaRecent && HRSDom.rpaRecent()) return;
      // v1.9.35 手动切沟通列表的标签、勾掉「未读」：自动流程暂停，不再自己切回去
      if (self.hooks.isListControl && !(e.target.closest && e.target.closest('#__hrs_ui__')) && self.hooks.isListControl(e.target)) {
        if (state.manualPaused) return;
        state.manualPaused = true;
        state.queue = [];
        if (state.paceTimer) { clearTimeout(state.paceTimer); state.paceTimer = null; }
        uiLog('', '检测到你手动切换了沟通列表（标签 / 未读），自动流程已暂停。点浮层里的「继续自动」恢复，恢复后会切回「新招呼 + 未读」。');
        renderUi();
        return;
      }
      var selected = self.hooks.getConversationElement ? self.hooks.getConversationElement(e.target) : null;
      var selectedIdentity = selected && self.hooks.getIdentity ? self.hooks.getIdentity(selected) : null;
      if (!selectedIdentity && (!self.hooks.isConversationElement || !self.hooks.isConversationElement(e.target))) return;
      if (selectedIdentity) {
        selectedIdentity.manualTrusted = true;
        state.activeConversation = selectedIdentity;
      }
      state.manualPaused = true;
      state.queue = [];
      if (state.paceTimer) { clearTimeout(state.paceTimer); state.paceTimer = null; }
      uiLog('', '检测到手动打开候选人，自动流程已暂停。点浮层里的「继续自动」恢复。');
      renderUi();
    }, true);
  };

  var LIGHT_KEYS = { paceSec: 1, paceJitter: 1, lastHealthCheck: 1, dailyCap: 1, rhythm: 1, rpaSpeed: 1, rpaIdleSec: 1 };   // v2.3.0 改节奏、速度、让位时间不打断正在跑的队列
  // v1.9.46 只看本平台的运行模式
  function siteViewOf(s) {
    if (window.HRSJobKB && HRSJobKB.applySettings) HRSJobKB.applySettings(s);   // v3.4.0 设置里自定义的岗位知识库（新增、删除的方向，补充的叫法）
    var v = Object.assign({}, s || {}), m = v.siteMode && v.siteMode[window.__HRS_SITE__];
    if (m) ['masterEnabled', 'dryRun', 'greetMode'].forEach(function (k) { if (m[k] !== undefined) v[k] = m[k]; });
    return v;
  }
  function onlyLightKeysChanged(oldV, newV) {
    if (!oldV || !newV) return false;
    oldV = siteViewOf(oldV); newV = siteViewOf(newV);
    if (oldV.siteMode || newV.siteMode) {
      var site = window.__HRS_SITE__;
      var a = JSON.stringify((oldV.siteMode || {})[site] || {}), b = JSON.stringify((newV.siteMode || {})[site] || {});
      // 另一个平台的模式变了，本平台不受影响
      if (a === b) { oldV = Object.assign({}, oldV); newV = Object.assign({}, newV); delete oldV.siteMode; delete newV.siteMode; }
    }
    var keys = {};
    Object.keys(oldV).concat(Object.keys(newV)).forEach(function (k) { keys[k] = 1; });
    var changed = Object.keys(keys).filter(function (k) { return JSON.stringify(oldV[k]) !== JSON.stringify(newV[k]); });
    if (!changed.length) return true;   // v1.9.46 只是另一个平台的设置变了
    return changed.every(function (k) { return LIGHT_KEYS[k]; });
  }

  Engine.prototype.start = function () {
    var self = this;
    if (FETCH_TAB) return;   // v2.6.1 后台取 PDF 用的临时标签页：什么都不做
    // v2.6.1 地址里没带标记的临时标签页，问一下后台
    send({ type: 'FETCH_TAB_Q' }).then(function (r) { if (!(r && r.fetchTab)) self.startReal(); });
  };
  Engine.prototype.startReal = function () {
    var self = this;
    self.bindManualPause();
    var ensureRunning = function (fromChange) {
      if (state.settings.masterEnabled && !self.timer) {
        self.tick();
        self.timer = setInterval(function () { self.tick(); }, 4000);
        if (self.hooks.watch) {
          if (self.observer) { try { self.observer.disconnect(); } catch (e) {} }
          self.observer = self.hooks.watch(function () { self.tick(); });
        }
        uiLog('', (fromChange ? '运行模式已切换，引擎开始工作' : '引擎已启动 v' + HRS_VERSION) + '（' + (state.settings.dryRun ? '试运行：只判定不动手' : '正式运行：会自动发送话术') + '，节拍 ' + currentPace() + ' 秒/个）');
      }
      if (!state.settings.masterEnabled && self.timer) {
        clearInterval(self.timer);
        self.timer = null;
        if (state.paceTimer) { clearTimeout(state.paceTimer); state.paceTimer = null; }
        uiLog('', '已停止（运行模式为「停止」）');
      }
    };
    loadState().then(function () {
      // v1.9.49 「要找谁」优先向后台领（人才库打开页面时交给后台的），领不到再看地址里的 # 部分
      var hashReq = parseFind(INIT_HASH) || parseFind(location.hash);
      return send({ type: 'FIND_TAKE' }).then(function (pf) { return (pf && pf.name) ? pf : hashReq; }, function () { return hashReq; });
    }).then(function (findReq) {
      // v1.9.17 人才库「打开沟通会话 / 面试安排」跳过来的：先暂停自动流程，再按姓名找人
      var fh = !!findReq;
      self.startCollector();   // v2.5.0 简历收集
      if (fh) state.manualPaused = true;
      ensureRunning(false);
      renderUi();
      if (fh) setTimeout(function () { findFromHash(self, findReq); }, 2500);
      var pj = plannedJds();
      if (!pj.length) uiLog('err', '今日计划里没有岗位，请到「智选 · 岗位计划」勾选要跑的岗位');
      else uiLog('', '今日计划 ' + pj.length + ' 个岗位：' + pj.map(function (j) { var q = PL().quotaOf(j, window.__HRS_SITE__); return j.title + ' ' + PL().doneOf(j, state.planProgress, window.__HRS_SITE__) + '/' + (q || '不限'); }).join('，'));
      log('启动', '引擎启动 site=' + self.site + ' dryRun=' + state.settings.dryRun);
      // v1.0.6 浮层全页面保活：SPA 切换/页面改动导致浮层被移除时自动重建并刷新状态
      self._uiAlive = setInterval(function () {
        if (ui && !ui.isConnected) ui = null;
        renderUi();
      }, 8000);
      // 节拍倒计时：等待期间每秒刷新浮层文字
      self._countdown = setInterval(function () {
        if (state.nextAt > Date.now() && state.queue.length) renderUi();
      }, 1000);
    });
    chrome.storage.onChanged.addListener(function (ch, area) {
      if (area === 'local' && ch.planProgress) { state.planProgress = ch.planProgress.newValue || {}; renderUi(); }
      if (area === 'local' && ch.jds && !ch.settings) {
        // 设置页改了岗位、上限或计划开关：原地更新，下一位候选人开始按新计划
        state.jds = ch.jds.newValue || [];
        state.seen = {};
        state.planWarned = '';
        uiLog('', '岗位计划已更新，下一位开始生效');
        if (activeEngine) activeEngine.tick();
      }
      if (area === 'local' && ch.settings) {
        if (onlyLightKeysChanged(ch.settings.oldValue, ch.settings.newValue)) {
          // 只改了节拍等轻量项：原地更新，不打断手动暂停和当前队列
          state.settings = siteViewOf(Object.assign({}, state.settings, ch.settings.newValue));
          renderUi();
          return;
        }
        loadState().then(function () {
          state.seen = {};
          state.manualPaused = false;
          state.queue = [];
          ensureRunning(true);
          if (ch.settings.newValue.diagMode) setDiagMode(true);
          else setDiagMode(false);
          renderUi();
        });
      }
    });
  };

  // ================= v2.5.0 简历收集：候选人发来的 PDF =================
  // 智选停着也收：你自己点开某个会话、会话里有 PDF 时同样会收进「简历收集」
  var attachmentBusy = false, reconSeen = {}, identKey = '', identSince = Date.now();
  function blobToDataUrl(blob) {
    return new Promise(function (resolve, reject) {
      var fr = new FileReader();
      fr.onload = function () { resolve(String(fr.result || '')); };
      fr.onerror = function () { reject(fr.error || new Error('文件读取失败')); };
      fr.readAsDataURL(blob);
    });
  }
  // v2.6.1 后台在临时标签页里取 PDF 时打开的页面（地址带 #hrs_fetch=1）：不启动智选，只让 pdf-sniff 看文件地址
  var FETCH_TAB = /(?:^|[#&])hrs_fetch=1/.test(location.hash);
  // 预览窗口里的 PDF：iframe / embed 的地址，或「viewer.html?file=真实地址」
  // v2.6.1 这里给出的只是「候选地址」，一定要取回来确认开头是 %PDF 才算 PDF（以前把预览网页当 PDF 存，存出了 .htm）
  function pdfFromSrc(src) {
    var u = String(src || '');
    if (!u || /^about:|^javascript:/i.test(u)) return '';
    try {
      var x = new URL(u, location.href);
      var F = window.HRSPdfFind;
      if (F && F.score(x.href) >= 5) return x.href;
      if (F && F.innerUrls(x.href).some(function (v) { return F.score(v) >= 5; })) return x.href;
    } catch (e) {}
    return '';
  }
  function previewPdfItems(identity) {
    var out = [];
    qsa('iframe[src],embed[src],object[data]').forEach(function (el) {
      if (el.closest('#__hrs_ui__')) return;
      var u = pdfFromSrc(el.getAttribute('src') || el.getAttribute('data'));
      if (u) out.push({ url: u, name: ((identity && identity.name) || '候选人') + '的简历.pdf', text: 'preview' });
    });
    return out;
  }
  // v2.6.1 当前会话打开以后，页面自己加载过的「像 PDF」的地址（预览窗口取文件时会留下记录）
  function perfPdfUrls(since) {
    var F = window.HRSPdfFind, names = [];
    if (!F) return [];
    var t0 = performance.timeOrigin || (Date.now() - performance.now());
    var take = function (w) {
      try {
        w.performance.getEntriesByType('resource').forEach(function (e) {
          if (/^(img|script|link|css|beacon)$/.test(e.initiatorType)) return;
          if (since && (w.performance.timeOrigin || t0) + e.startTime < since - 2000) return;
          names.push(e.name);
        });
      } catch (e) {}
    };
    take(window);
    qsa('iframe').forEach(function (f) { try { if (f.contentWindow && f.contentWindow.performance) take(f.contentWindow); } catch (e) {} });
    return F.pickLikely(names).filter(function (u) { return F.score(u) >= 5; }).slice(0, 6);
  }
  function fetchPdf(urls) {
    // 页面里用你的登录状态取文件；拿到的是网页就在网页里找真正的 PDF 地址再取；开头是 %PDF 才算
    var F = window.HRSPdfFind;
    var list = (Array.isArray(urls) ? urls : [urls]).filter(function (u) { return /^(blob:|data:|https?:)/i.test(String(u || '')); });
    if (!F || !list.length) return Promise.resolve({ blob: null, url: '', tried: [] });
    return F.resolve(list, { fetch: function (u, o) { return fetch(u, o); }, max: 6 }).then(function (r) {
      if (r.blob && r.blob.size > 20 * 1024 * 1024) return { blob: null, url: '', tried: r.tried.concat([{ url: r.url, why: 'PDF 超过 20MB' }]) };
      return r;
    }).catch(function () { return { blob: null, url: '', tried: [] }; });
  }
  // v2.6.0 会话里这份附件之前的文字：用来判断是候选人主动发的，还是我们索要后发的
  function textBeforeNode(root, node) {
    try {
      if (root && node && root.contains(node)) {
        var rg = document.createRange();
        rg.setStart(root, 0); rg.setEndBefore(node);
        return rg.toString().slice(-5000);
      }
    } catch (e) {}
    return txt(root).slice(-5000);
  }
  function originOf(engine, item) {
    var CT = window.HRSChatTarget;
    if (!CT || !CT.resumeOrigin) return { origin: '', why: '' };
    var root = engine.hooks.getActiveRoot ? engine.hooks.getActiveRoot() : document;
    var reqScript = (state.settings && state.settings.scripts && state.settings.scripts.request) || '';
    return CT.resumeOrigin(textBeforeNode(root, item && item.node), reqScript);
  }
  function sendInbox(engine, identity, item) {
    var h = engine.hooks;
    var og = originOf(engine, item);
    var rawName = (item && item.name) || '候选人简历.pdf';
    var fileName = window.HRSChatTarget ? window.HRSChatTarget.sanitizeFileName(rawName) : rawName;
    var url = String(item && item.url || '');
    var alts = perfPdfUrls(identSince).filter(function (u) { return u !== url; });
    // 先取这份附件自己的地址；不行再试这个会话打开后页面加载过的 PDF（后台会核对 PDF 里的名字）
    var fromSeen = false;
    return fetchPdf(url ? [url] : []).then(function (g1) {
      if (g1.blob || !alts.length) return g1;
      return fetchPdf(alts).then(function (g2) { if (g2.blob) fromSeen = true; g2.tried = (g1.tried || []).concat(g2.tried || []); return g2; });
    }).then(function (got) {
      var blob = got.blob;
      return (blob ? blobToDataUrl(blob) : Promise.resolve('')).then(function (dataUrl) {
        return send({
          type: 'INBOX_ADD',
          site: window.__HRS_SITE__ || '',
          name: identity && identity.name || '',
          chatId: identity && identity.chatId || '',
          jobText: identity && identity.jobText || '',
          sourceUrl: chatUrlForIdentity(identity),
          summary: h.getSummaryText ? h.getSummaryText() : '',
          workLines: h.getWorkLines ? h.getWorkLines() : [],
          jdHint: state.busy && curJd() ? curJd().id : '',
          origin: og.origin, originWhy: og.why,
          since: identSince,
          file: {
            name: fileName, url: /^https?:/i.test(url) ? url : '', pdfUrl: blob && /^https?:/i.test(got.url || '') ? got.url : '',
            alts: alts.filter(function (u) { return /^https?:/i.test(u); }), dataUrl: dataUrl, size: blob ? blob.size : 0, fromSeen: fromSeen,
            tried: (got.tried || []).slice(0, 8)
          }
        });
      });
    });
  }
  // v2.6.1 后台要当前会话的信息（你在平台上点了下载 / 打开了预览，后台拿到 PDF 后要知道是谁的）
  function inboxCtx(engine) {
    var h = engine.hooks;
    var identity = h.getActiveIdentity ? h.getActiveIdentity() : null;
    if (!identity || !identity.name) return null;
    var og = originOf(engine, null);
    return {
      site: window.__HRS_SITE__ || '', name: identity.name || '', chatId: identity.chatId || '', jobText: identity.jobText || '',
      sourceUrl: chatUrlForIdentity(identity), summary: h.getSummaryText ? h.getSummaryText() : '', workLines: h.getWorkLines ? h.getWorkLines() : [],
      jdHint: state.busy && curJd() ? curJd().id : '', origin: og.origin, originWhy: og.why, since: identSince
    };
  }
  // 会话里看得到简历消息、却没拿到文件：把这部分页面结构记下来（只记一次），方便一轮修好
  function reconIfResumeVisible(engine, identity) {
    var key = (identity.chatId || identity.name || '') + '|' + location.pathname;
    if (reconSeen[key]) return;
    var root = engine.hooks.getActiveRoot ? engine.hooks.getActiveRoot() : document;
    var t = txt(root);
    if (!/附件简历|简历\.pdf|\.pdf\b|发送了.{0,6}简历|预览附件/i.test(t)) return;
    reconSeen[key] = Date.now();
    var desc = function (el) {
      var r = el.getBoundingClientRect(), attrs = {};
      Array.prototype.forEach.call(el.attributes || [], function (a) { if (/^(href|src|data-|download|title|role)/i.test(a.name)) attrs[a.name] = String(a.value).slice(0, 200); });
      return { tag: el.tagName.toLowerCase(), cls: String(el.className && el.className.baseVal != null ? el.className.baseVal : el.className || '').slice(0, 120), text: txt(el).replace(/\s+/g, ' ').slice(0, 80), attrs: attrs, rect: [Math.round(r.left), Math.round(r.top), Math.round(r.width), Math.round(r.height)] };
    };
    var hits = qsa('a,button,span,div,p,li,img', root).filter(function (el) {
      if (el.closest('#__hrs_ui__') || el.matches('input,textarea')) return false;
      var s2 = txt(el);
      return s2.length <= 60 && /简历|pdf|附件|预览|下载/i.test(s2 + ' ' + (el.getAttribute('href') || '') + ' ' + (el.className || ''));
    }).slice(0, 30);
    var frames = qsa('iframe,embed,object').map(function (el) { return { tag: el.tagName.toLowerCase(), src: String(el.getAttribute('src') || el.getAttribute('data') || '').slice(0, 300), cls: String(el.className || '').slice(0, 80) }; }).slice(0, 10);
    send({ type: 'INBOX_RECON', dump: { site: window.__HRS_SITE__ || '', url: location.href.replace(/#.*$/, ''), name: identity.name || '', job: identity.jobText || '', hits: hits.map(function (el) { var p = el.parentElement; return { el: desc(el), parent: p ? desc(p) : null }; }), frames: frames } });
    send({ type: 'RUNLOG', ev: { t: Date.now(), mod: '简历收集', act: '收简历', target: identity.name || '', ok: false, cat: 'gone', why: '会话里有简历消息，但没拿到 PDF 文件（页面结构已记下，在「简历收集 · 设置」里导出侦察记录）' } });
  }
  Engine.prototype.scanResumeAttachments = function () {
    var self = this;
    if (state.settings && state.settings.resumeAutoSave === false) return;
    if (attachmentBusy || !self.hooks.findResumeAttachments || !self.hooks.getActiveIdentity) return;
    var identity = self.hooks.getActiveIdentity();
    if (!identity || !identity.name) return;
    var ik = (identity.chatId || '') + '|' + identity.name;
    if (ik !== identKey) { identKey = ik; identSince = Date.now(); }
    var items = (self.hooks.findResumeAttachments(identity) || []).concat(previewPdfItems(identity));
    if (!items.length) { reconIfResumeVisible(self, identity); return; }
    for (var i = 0; i < items.length; i++) {
      var item = items[i];
      var fp = [window.__HRS_SITE__, identity.chatId || '', identity.name || '', item.url || '', item.name || ''].join('|');
      if (state.seenAttachments[fp]) continue;
      state.seenAttachments[fp] = Date.now();
      attachmentBusy = true;
      uiLog('', '发现「' + identity.name + '」发来的 PDF，正在收进简历收集：' + (item.name || '简历.pdf'));
      sendInbox(self, identity, item).then(function (r) {
        attachmentBusy = false;
        if (r && r.skipped) uiLog('', r.why || '按设置这份简历不收');
        else if (r && r.ok && r.duplicate) uiLog('', '这份简历之前已经收过');
        else if (r && r.ok) uiLog('pass', '简历已收进「简历收集」');
        else if (r && r.off) uiLog('', '简历收集已关闭，没有收');
        else uiLog('err', '简历没收成：' + (r && (r.why || r.error) || '未知原因'));
      }).catch(function (e) {
        attachmentBusy = false;
        uiLog('err', '简历没收成：' + (e && e.message || e));
      });
      break;
    }
  };
  // 智选没在跑时，单独每 3 秒看一眼当前打开的会话（只读，不点任何东西）
  Engine.prototype.startCollector = function () {
    var self = this;
    if (self._collector) return;
    self._collector = setInterval(function () {
      if (!state.settings || state.settings.resumeAutoSave === false) return;
      if (state.settings.masterEnabled && self.timer) return;   // 智选在跑时由它每一拍顺带检查
      try { self.scanResumeAttachments(); } catch (e) {}
    }, 3000);
  };

  Engine.prototype.tick = function () {
    var self = this;
    if (state.stopped || !state.settings || !state.settings.masterEnabled) return;   // v1.9.48 设置还没读到时（页面刚打开就收到岗位变更）不报错
    self.scanResumeAttachments();
    if (state.manualPaused) { renderUi(); return; }
    // v2.3.0 拟人小憩期间不切列表、不切职位，休息完再看
    if (breaker && breaker.resting()) { renderUi(); return; }
    // v1.8.1 列表筛选（Boss：先「未读」，处理完再「全部」）。切换了这一轮就先不扫，等列表刷新
    if (self.hooks.beforeScan && !state.busy && self.hooks.beforeScan({ queue: state.queue.length, processed: state.processed, settings: state.settings })) {
      state.seen = {}; state.queue = [];
      return;
    }
    var cards = self.hooks.findCards();
    // v1.9.40 列表里能认出未读角标，才按角标把关（认不出时不拦，免得全部跳过）
    state.badgeOk = cards.some(unreadBadge);
    if (cards.length === 0) {
      self.hooks.onEmpty && self.hooks.onEmpty();
      return;
    }
    cards.forEach(function (card) {
      var id = self.hooks.cardId(card);
      if (!id) return;
      if (state.seen[id]) return;
      state.seen[id] = 1;
      if (state.processed[id]) return;
      // v1.9.10 本页已经跳过的（不在计划、点不开），不再反复处理，刷新页面后才重新看
      if (state.listSkip && state.listSkip[id]) return;
      // v1.8.4 判定过的不再重复：试运行判过的，试运行里不再判；正式运行判过的，任何模式都不再判
      var jg = state.judged[id];
      // v1.9.45 合格后先问过一句的人：有新的未读（他回复了）才再处理，去索要简历
      if (jg && jg.v === 'asked' && jg.m === 'live') { if (!(state.badgeOk ? unreadBadge(card) : true)) return; }
      else if (jg && (jg.m === 'live' || state.settings.dryRun)) return;
      state.queue.push({ card: card, id: id });
    });
    // v1.9.41 没活可干时说清楚原因：列表里剩下的人都是之前跳过的（岗位不在今日计划等），保留未读
    var skipped = cards.filter(function (c) { var k = self.hooks.cardId(c); return k && state.listSkip && state.listSkip[k]; });
    state.idleSkipped = skipped.length;
    if (!state.queue.length && !state.busy && skipped.length) {
      var names = skipped.map(function (c) { var idn = self.hooks.getIdentity ? self.hooks.getIdentity(c) : null; return (idn && idn.name || '候选人') + (idn && idn.jobText ? '（' + idn.jobText + '）' : ''); });
      var sig = names.join('、');
      if (state.idleSig !== sig) {
        state.idleSig = sig;
        uiLog('tip', '当前列表剩下的 ' + names.length + ' 人都已跳过：' + sig + '。岗位不在今日计划的保留未读，等新消息。要处理他们，把对应岗位加进今日计划');
      }
    } else if (state.queue.length) state.idleSig = '';
    self.processLoop();
  };

  /**
   * v1.2.0 节拍控制：每位候选人从「开始处理」起算，至少占用 paceSec 秒（可加 0~20% 浮动）。
   * 只在列表层面就跳过的（其他岗位），没有打开会话、没有碰平台，1 秒后直接下一位。
   * 同一时刻只有一个节拍定时器，避免 4 秒轮询和 DOM 变化重复触发导致提速。
   */
  function schedulePace() {
    if (state.paceTimer) { clearTimeout(state.paceTimer); state.paceTimer = null; }
    var wait = state.nextAt - Date.now();
    if (wait <= 0 || !activeEngine) return;
    state.paceTimer = setTimeout(function () {
      state.paceTimer = null;
      activeEngine.processLoop();
    }, wait);
  }
  Engine.prototype.processLoop = function () {
    var self = this;
    if (state.manualPaused) return;
    if (state.busy) return;
    if (!state.settings.masterEnabled) return;
    if (state.queue.length === 0) { renderUi(); return; }
    if (Date.now() < state.nextAt) { schedulePace(); renderUi(); return; }
    var sum = PL().summary(state.jds, state.settings, state.planProgress, window.__HRS_SITE__);
    if (!sum.window.ok) {
      if (state.planWarned !== 'window') uiLog('tip', '不在执行时段（' + sum.window.text + '），到时段后自动开始');
      state.planWarned = 'window';
      renderUi();
      return;
    }
    if (sum.allFull) {
      if (state.planWarned !== 'full') uiLog('pass', '今日计划已全部完成（' + sum.done + '/' + sum.quota + '），明天自动继续');
      state.planWarned = 'full';
      renderUi();
      return;
    }
    if (state.planWarned) state.planWarned = '';
    if (capReached()) {
      if (!state.capWarned) uiLog('tip', '今日自动动作已达上限 ' + capInfo().cap + ' 次，停止处理。明天自动恢复，或到设置里调高上限');
      state.capWarned = true;
      return;
    }
    state.capWarned = false;
    // v1.9.43 排队里已经不在当前列表的人（处理过 / 已读后被列表移走）一次性清掉，只记一行
    if (self.hooks.findFreshCard) {
      var gone = [];
      while (state.queue.length) {
        var hd = state.queue[0], idh = self.hooks.getIdentity ? self.hooks.getIdentity(hd.card) : null;
        if (idh && idh.name && !self.hooks.findFreshCard(idh)) { gone.push(idh.name); state.queue.shift(); } else break;
      }
      if (gone.length) uiLog('', gone.length + ' 人已不在当前列表（处理过或已读），跳过：' + gone.slice(0, 6).join('、') + (gone.length > 6 ? '等' : ''));
      if (!state.queue.length) { renderUi(); return; }
    }
    // v2.3.0 平台弹出验证 / 频繁 / 上限提示：暂停，不在验证框底下继续点
    var risk = window.HRSDom && HRSDom.riskSignal ? HRSDom.riskSignal(true) : '';
    if (risk) {
      state.manualPaused = true; state.queue = [];
      state.riskStop = '遇到平台验证 / 风控提示，已暂停：' + risk;
      uiLog('err', '检测到「' + risk + '」，自动流程已暂停。手动处理完验证后点浮层「继续自动」');
      runAdd('验证', risk.slice(0, 40), false, { code: /上限|次数/.test(risk) ? 'limit' : 'verify', why: risk });
      renderUi();
      return;
    }
    // v1.9.48 Boss RPA：动手前先问助手「现在能动鼠标吗」（你在用鼠标键盘 / 锁屏 / 助手没开 → 等，不跳人）
    if (rpaActive() && Date.now() - (state.rpaGateAt || 0) > 1500) {
      state.busy = true;
      HRSDom.rpaProbe().then(function (g) {
        state.busy = false;
        if (!g || !g.ok) {
          rpaNote(g);
          state.nextAt = Date.now() + Math.max(3, Math.min(120, (g && g.wait) || 10)) * 1000;
          schedulePace(); renderUi();
          return;
        }
        if (rpaNoteState.code) { uiLog('pass', 'RPA 已就绪，继续'); rpaNoteState = { code: '', at: 0 }; }
        state.rpaGateAt = Date.now();
        self.processLoop();
      });
      return;
    }
    var item = state.queue.shift();
    state.busy = true;
    state.lastStartAt = Date.now();
    var done = function () {
      state.busy = false;
      // v1.9.48 处理途中 RPA 让位（你动了鼠标键盘、锁屏、助手断开）：这一位没做完，放回去稍后重做，不算失败、不记成「跳过」
      var held = rpaActive() && HRSDom.rpaHeldSince(state.lastStartAt);
      if (held && !state.processed[item.id]) {
        delete state.judged[item.id];
        if (item.nk && state.judged[item.nk] && state.judged[item.nk].at >= state.lastStartAt) delete state.judged[item.nk];
        try { chrome.storage.local.set({ judgedLog: state.judged }); } catch (e) {}
        if (state.listSkip) delete state.listSkip[item.id];
        delete state.seen[item.id];
        state.nextAt = Date.now() + Math.max(3, Math.min(120, held.wait || 8)) * 1000;
        uiLog('tip', 'RPA 让位，这一位没做完，稍后重新处理（' + (held.why || held.code || '') + '）');
        schedulePace(); renderUi();
        return;
      }
      state.lastTouched = !!item.touched;
      state.nextAt = item.touched ? state.lastStartAt + paceMs(currentPace()) : Date.now() + 1000;
      // v2.3.0 拟人小憩：每处理几位（随机）就休息一会儿，时长在「设置 · 操作节奏」里调
      var rest = item.touched && breaker ? breaker.tick(state.settings && state.settings.rhythm) : 0;
      if (rest) {
        state.nextAt = Math.max(state.nextAt, Date.now() + rest);
        uiLog('tip', '拟人节奏：小憩 ' + Math.round(rest / 1000) + ' 秒后继续');
        runAdd('休息', '小憩 ' + Math.round(rest / 1000) + ' 秒', true);
        schedulePace();
      }
      if (state.queue.length) {
        if (item.touched && !rest) uiLog('', '节拍等待：下一位约 ' + Math.max(0, Math.ceil((state.nextAt - Date.now()) / 1000)) + ' 秒后开始');
        schedulePace();
      }
      renderUi();
    };
    self.processOne(item).then(done).catch(function (err) {
      item.touched = true;
      state.sessionStats.errored++;
      uiLog('err', '处理失败：' + (err && err.message || err));
      log('错误', String(err && err.message || err));
      done();
    });
  };

  Engine.prototype.processOne = function (item) {
    var self = this;
    state.sessionStats.scanned++;
    renderUi();
    var card = item.card;
    // 1) 先读取会话身份和列表中的投递岗位。明确属于其他岗位的直接跳过；
    //    列表未展示岗位时，只在“我的沟通”内打开该会话读取“沟通职位”，再做最终岗位隔离。
    var text = self.hooks.extractText(card);
    var identity = self.hooks.getIdentity ? self.hooks.getIdentity(card) : null;
    var identityName = identity && identity.name || '';
    state.curJd = null;
    if (!plannedJds().length) {
      uiLog('warn', '今日计划里没有岗位，跳过 ' + (identityName || '候选人'));
      return Promise.resolve();
    }
    // v1.3.0 先按列表里的沟通职位归岗位。能归到但不在计划或已到量的，不点开直接跳过。
    var scopeText = identity && identity.jobText ? identity.jobText : text;
    var pre = resolvePlanJd(scopeText);
    var markSkip = function () { state.listSkip = state.listSkip || {}; state.listSkip[item.id] = 1; };
    if (pre && !pre.ok) {
      markSkip();
      uiLog('warn', (identityName || '候选人') + '：' + pre.reason);
      return Promise.resolve();
    }
    // v1.9.10 猎聘：列表上已经写了沟通职位，但它不在在招岗位 / 计划里，不点开，保留未读
    if (!pre && self.hooks.listJobReliable && identity && identity.jobText) {
      markSkip();
      uiLog('warn', (identityName || '候选人') + '：沟通职位「' + identity.jobText + '」不在今日计划里，不点开（保留未读）');
      return Promise.resolve();
    }

    // v1.9.19 只在「新招呼 + 未读」里处理：当前不是这个列表就不点开
    if (self.hooks.listOk && self.hooks.listOk() === false) {
      uiLog('tip', (identityName || '候选人') + '：当前列表不是「新招呼 + 未读」，不点开');
      return Promise.resolve();
    }
    // v1.9.40 排队时的卡片可能已经过期：点之前再看一眼，人还在当前列表、还有未读角标才处理
    if (self.hooks.findFreshCard && identity) {
      var freshC = self.hooks.findFreshCard(identity);
      if (!freshC) {
        uiLog('tip', (identityName || '候选人') + '：已不在当前列表里，跳过');
        return Promise.resolve();
      }
      if (state.badgeOk && !unreadBadge(freshC)) {
        uiLog('tip', (identityName || '候选人') + '：没有未读角标（已经看过），跳过');
        return Promise.resolve();
      }
    }
    // 沟通页必须先打开并校验同一会话，再读取聊天区/简历卡实际内容。
    item.touched = true;
    return closeStray().then(function () { return self.hooks.openCard(card, identity); }).then(function (opened) {
      if (!opened) return opened;
      resetScroll();
      if (!self.hooks.getSummaryText) return opened;
      // v1.9.40 顶部简历信息比姓名晚出来：最多等 5 秒，读到「NN岁」再往下走
      var n = 0;
      return (function wait() {
        var sm = '';
        try { sm = self.hooks.getSummaryText() || ''; } catch (e) {}
        if (/\d{2}\s*岁/.test(sm) || n++ >= 12) return opened;
        resetScroll();
        return sleep(400).then(wait);
      })();
    }).then(function (opened) {
      if (!opened || (self.hooks.assertConversation && !self.hooks.assertConversation(identity))) {
        var why = state.lastVerifyWhy ? '（' + state.lastVerifyWhy + '，诊断已记录）' : '';
        state.lastVerifyWhy = '';
        markSkip();
        uiLog('warn', (identityName || '候选人') + '：点开后没能确认右侧显示的就是这个人，为防发错人已跳过' + why);
        return null;
      }
      var extra = self.hooks.getActiveText ? self.hooks.getActiveText() : self.hooks.extractText(card);
      // v1.4.0 顶部简历摘要（工作经历、学历、经验、期望）。Boss 有这个钩子，猎聘暂无
      item.summaryExpected = !!self.hooks.getSummaryText;
      item.summary = self.hooks.getSummaryText ? self.hooks.getSummaryText() : '';
      item.workLines = self.hooks.getWorkLines ? self.hooks.getWorkLines() : [];
      if (item.summaryExpected && !item.summary && self.hooks.summaryDump) send({ type: 'DIAG_LOG', data: self.hooks.summaryDump() });
      if (state.settings.onlyUnrepliedCandidateMessages !== false && self.hooks.shouldReplyToCandidate) {
        var shouldReply = self.hooks.shouldReplyToCandidate(identity);
        if (shouldReply === false) {
          uiLog('warn', (identityName || '候选人') + '：最后一条是我方消息，已回复过');
          return null;
        }
      }
      var fullText = text + (extra && extra.indexOf(text) < 0 ? '\n' + extra : '');
      var hit = pre || resolvePlanJd(fullText);
      if (!hit) {
        markSkip();
        uiLog('warn', (identityName || '候选人') + '：看不出投的是哪个岗位，已跳过。可在「岗位管理」里填「平台职位名」');
        return null;
      }
      if (!hit.ok) {
        markSkip();
        uiLog('warn', (identityName || '候选人') + '：' + hit.reason);
        return null;
      }
      item.jd = hit.jd;
      // v1.9.19 先查人才库：同岗位之前判过通过 / 已联系过的人
      return send({ type: 'TALENT_FIND', name: identityName || '', jdId: hit.jd.id, jdTitle: hit.jd.title }).then(function (r) { item.prevGood = !!(r && r.good); }, function () {}).then(function () {
      state.curJd = hit.jd;
      var finalScope = { allowed: true, scope: 'active', reason: hit.reason };
      if (item.summary && fullText.indexOf(item.summary) < 0) fullText = item.summary + '\n' + fullText;
      var fields = window.HRSExtractor ? window.HRSExtractor.extract(fullText) : null;
      // v1.5.1 姓名优先用左侧卡片上的称呼。正文里提取的姓名会把「刚刚活跃」这类状态词当成名字
      var exName = fields && fields.name && !/(活跃|在线|刚刚|今日|本周|小时前|分钟前)/.test(fields.name) ? fields.name : '';
      var name = identityName || exName || self.hooks.extractName(card) || '未知候选人';
      return self.decideAndAct(item, card, fullText, fields, name, true, identity, finalScope);
      });
    });
  };

  Engine.prototype.decideAndAct = function (item, card, text, fields, name, opened, identity, scope) {
    var self = this;
    var jd = item.jd || curJd();
    if (!jd) {
      uiLog('warn', '未启用JD，跳过 ' + name);
      return Promise.resolve();
    }
    // v3.3.0 统一判定引擎（services/engine.js）：会话整理成和打招呼同一种格式再判
    //   设置 chatEngine = 'unified'：和打招呼一样按每段工作的职位判（做过本岗位 / 整体匹配度）
    //   没设（默认）：和以前一样在整份在线简历里找方向词。两种都算一遍存进评测集，有了数字再决定切不切
    var chat = { site: self.site, text: text, fields: fields, summary: item.summary || '', summaryExpected: !!item.summaryExpected, workLines: item.workLines || [] };
    var eopt = { mode: state.settings.chatEngine === 'unified' ? 'unified' : 'text', both: state.settings.evalCollect !== false, jobTitle: jd.title,
      industry: window.HRSIndustry, chipWords: state.settings.chipWords, chipExclude: state.settings.chipExclude };
    // v1.7.0 条件 = 在招岗位里的基础条件 + 智选硬性要求 + 加分项
    var rules = PL().rulesOf ? PL().rulesOf(jd, state.jds, 'screen') : jd;
    // v1.9.27 开了「简历详情」的岗位：会话顶部只判基础条件，关键词看完整简历（打分 + 一票否决 + 可选 AI）
    if (PL().detailOn && PL().detailOn(jd, 'screen') && self.hooks.openDetail && !item.detailDone) {
      var dr = PL().detailRules(jd, state.jds, 'screen');
      var base = HRSEngine.judgeChat(chat, dr.base, eopt).res;
      item.detailDone = true;
      if (base.verdict === 'reject') return self.decideAndAct2(item, card, text, fields, name, opened, identity, scope, base);
      return detailJudge(function () { return self.hooks.openDetail(identity); }, jd, dr, name, base).then(function (r) {
        return self.decideAndAct2(item, card, text, fields, name, opened, identity, scope, r);
      });
    }
    var J = HRSEngine.judgeChat(chat, rules, eopt);
    chatEvalSample(self.site, chat, rules, jd, name, J);
    return self.decideAndAct2(item, card, text, fields, name, opened, identity, scope, J.res);
  };

  Engine.prototype.decideAndAct2 = function (item, card, text, fields, name, opened, identity, scope, res) {
    var self = this;
    var jd = item.jd || curJd();
    // v1.9.18 安全：顶部摘要没读全（读不到年龄或学历）时不自动拒绝；已经和他沟通过（会话里有我方消息）的，不自动发拒绝 / 索要简历
    if (res.verdict !== 'review' && item.summaryExpected && (!/\d{2}\s*岁/.test(item.summary || '') || !/(本科|硕士|博士|大专|专科|高中|中专|MBA)/.test(item.summary || ''))) {
      res.verdict = 'review'; res.reasons = ['顶部简历摘要没读全（年龄或学历读不到），不自动判定，请人工看'].concat(res.reasons || []);
    }
    // v1.9.19 人才库里这个人（同岗位）之前判过通过或已联系过：不自动拒绝
    if (res.verdict === 'reject' && item.prevGood) {
      res.verdict = 'review'; res.reasons = ['之前已判过通过 / 已联系过（人才库有记录），这次不自动拒绝'].concat(res.reasons || []);
    }
    var sentWhy = res.verdict !== 'review' ? ((self.hooks.hasOutgoing && self.hooks.hasOutgoing()) ? '会话里有我方发的消息' : sentMarks()) : '';
    // v1.9.42 同一人同一岗位今天之前已经正式判过（按 姓名+岗位 记，不受列表卡片文字变化影响）
    var nk = 'n:' + String(name || '').replace(/\s+/g, '') + '|' + (jd && jd.id || '');
    item.nk = nk;   // v1.9.48 RPA 让位重做时要撤回这次记的判定
    // v1.9.45 之前合格时先问过一句，现在他回复了：直接索要简历，不再重新判
    if (!state.settings.dryRun && state.judged[nk] && state.judged[nk].v === 'asked') {
      uiLog('pass', name + '：之前合格并问过一句，候选人回复了，现在索要简历');
      if (!state.settings.autoRequest || capReached()) { markJudged(nk, 'pass'); markJudged(item.id, 'pass'); return markProcessed(item.id); }
      return self.requestResume(item.id, card, name, identity).then(function (ok) {
        if (!ok) { uiLog('err', '索要简历未完成 → ' + name + '，下次有新消息再试'); return null; }
        bumpCap();
        markJudged(nk, 'pass'); markJudged(item.id, 'pass');
        send({ type: 'EVENT', eventType: 'request', name: name, detail: '回复后索要简历', jdId: jd.id, site: self.site, delta: {} });
        return markProcessed(item.id);
      });
    }
    if (!sentWhy && res.verdict !== 'review' && !state.settings.dryRun && state.judged[nk] && state.judged[nk].m === 'live') sentWhy = '这个人这个岗位之前已经正式判过';
    if (!state.settings.dryRun && res.verdict !== 'review') markJudged(nk, res.verdict);
    if (sentWhy) {
      res.verdict = 'review'; res.reasons = ['已经和他沟通过（' + sentWhy + '），不自动发拒绝或索要简历'].concat(res.reasons || []);
    }
    try { renderResultCard(name, jd, res, item); } catch (e) { uiLog('err', '核对卡显示失败：' + (e && e.message || e)); }
    markJudged(item.id, res.verdict);
    // 公司名读不到时把读到的摘要写进诊断日志，方便核对页面结构
    if (res.hits && res.hits.hardUnknown && res.hits.hardUnknown.some(function (x) { return /过往公司/.test(x); }) && self.hooks.summaryDump) {
      var dd = self.hooks.summaryDump(); dd.candidate = name; dd.reason = '过往公司读不到';
      send({ type: 'DIAG_LOG', data: dd });
    }
    identity = identity || (self.hooks.getIdentity ? self.hooks.getIdentity(card) : null);
    var cardUrl = (self.hooks.cardUrl && self.hooks.cardUrl(card)) || '';
    var candidate = {
      id: item.id,
      name: name,
      chatId: identity && identity.chatId || '',
      appliedPosition: identity && identity.jobText || jd.title,
      scopeGuard: scope && scope.reason || '',
      jdId: jd.id,
      jdTitle: jd.title,
      score: res.score,
      verdict: res.verdict,
      reasons: res.reasons,
      fields: fields,
      rawText: text.slice(0, 30000),
      sourceUrl: cardUrl,
      source: self.site,
      messages: msgCache[item.id] || [],
      resumeStatus: res.verdict === 'pass' ? 'waiting' : 'not_requested',
      contactStatus: res.verdict === 'reject' ? 'rejected' : 'new'
    };
    // v3.6.0 不合格先给 HR 确认（只在本来要自动拒绝时）；每判一个人记一条自动决定记录
    var rjMode = state.settings.rejectMode || 'chat';
    var rejectWait = res.verdict === 'reject' && state.settings.rejectConfirm !== false && state.settings.autoReject && rjMode !== 'skip';
    var dAct = state.settings.dryRun ? 'none' : res.verdict === 'pass' ? (state.settings.autoRequest ? (askText(jd, name) ? 'ask' : 'request') : 'none')
      : res.verdict === 'reject' ? (rejectWait ? 'reject_pending' : (state.settings.autoReject && rjMode !== 'skip' ? 'reject_sent' : 'none')) : 'none';
    decisionLog({ site: self.site, module: item.detailDone ? 'detail' : 'screen', jdId: jd.id, job: jd.title, name: name, cid: candidate.chatId, cand: item.id, res: res, dry: !!state.settings.dryRun, action: dAct });

    renderDiagOverlay(card, res, name);

    // v1.9.17 今日智选 扫 / 过 / 拒（按平台，试运行也算），带明细，首页和人才库页用
    (function () {
      try {
        var site = self.site || window.__HRS_SITE__ || 'boss', d = PL().localDate();
        chrome.storage.local.get('screenToday', function (o) {
          var T = o.screenToday && o.screenToday.date === d ? o.screenToday : { date: d };
          var S = T[site] || (T[site] = { scan: 0, pass: 0, reject: 0, review: 0, items: [] });
          S.scan++; if (res.verdict === 'pass') S.pass++; else if (res.verdict === 'reject') S.reject++; else S.review++;
          S.items.push({ t: Date.now(), name: name, job: jd.title, v: res.verdict, why: (res.reasons || []).join('。').slice(0, 160), dry: !!state.settings.dryRun });
          if (S.items.length > 400) S.items = S.items.slice(-400);
          state.todayStat = S;
          chrome.storage.local.set({ screenToday: T });
        });
      } catch (e) {}
    })();

    // 网页端工作痕迹：卡片判定角标（默认开，可在设置关闭）
    addCardBadge(card, res);

    // v1.3.0 今日计划计数：正式运行中完成判定即 +1（合格、不合格、待复核都算），试运行不计入
    state.planBumped = state.planBumped || {};
    if (!state.settings.dryRun && !state.planBumped[item.id]) { state.planBumped[item.id] = 1; bumpPlan(jd.id); }   // v1.9.48 RPA 让位重做时不重复计数

    // —— 试运行模式：只展示判定，不执行任何动作、不标记已处理、不入库、不导出 ——
    if (state.settings.dryRun) {
      var why = res.reasons.join('。') + (item.summaryExpected ? '（读到简历摘要 ' + (item.summary || '').length + ' 字）' : '');
      if (res.verdict === 'pass') uiLog('dry', '【合格】' + name + '：' + why + '。正式运行时会索要简历');
      else if (res.verdict === 'reject') uiLog('dry', '【不合格】' + name + '：' + why + '。正式运行时按设置处理');
      else uiLog('dry', '【待复核】' + name + '：' + why + '。正式运行时只入人才库');
      return Promise.resolve();
    }

    if (res.verdict === 'pass') {
      uiLog('pass', '【合格】' + name + '：' + res.reasons.join('。'));
      state.sessionStats.passed++;
      return send({ type: 'TALENT_ADD', candidate: candidate }).then(function () {
        // v1.9.45 合格后先发这个岗位的打招呼语问一句，不直接要简历；候选人回复后再索要简历
        var ask = askText(jd, name);
        if (state.settings.autoRequest && ask && !capReached()) {
          return self.askFirst(card, name, identity, ask, item.id).then(function (ok) {
            if (!ok) { uiLog('err', '先问一句没发出去 → ' + name + '，未标记已处理'); return null; }
            bumpCap();
            markJudged(nk, 'asked'); markJudged(item.id, 'asked');
            uiLog('pass', '已先问一句 → ' + name + '，等他回复后再索要简历');
            return null;
          });
        }
        if (state.settings.autoRequest && !capReached()) {
          return self.requestResume(item.id, card, name, identity).then(function (ok) {
            if (ok) {
              bumpCap();
              send({ type: 'EVENT', eventType: 'request', name: name, detail: '已索要简历', jdId: jd.id, site: self.site, delta: {} });
              return markProcessed(item.id);
            }
            uiLog('err', '索要简历未完成 → ' + name + '，未标记已处理，刷新页面后会重试');
            return null;
          });
        }
        return markProcessed(item.id);
      });
    }

    if (res.verdict === 'reject') {
      uiLog('reject', '【不合格】' + name + '：' + res.reasons.join('。'));
      state.sessionStats.rejected++;
      if (rejectWait) {
        candidate.contactStatus = 'reject_pending';
        return send({ type: 'TALENT_ADD', candidate: candidate }).then(function () {
          return send({ type: 'EVENT', eventType: 'reject_pending', name: name, detail: (res.reasons || []).join('；'), jdId: jd.id, site: self.site, delta: { count: 1, rejected: 1 } });
        }).then(function () {
          return pendingAdd({ itemId: item.id, name: name, cid: candidate.chatId, job: candidate.appliedPosition, jdId: jd.id, jdTitle: jd.title, site: self.site, reasons: (res.reasons || []).slice(0, 3), at: Date.now() });
        }).then(function () {
          uiLog('tip', name + '：已放进「待确认」，HR 点「确认拒绝」后才发拒绝话术');
          return markProcessed(item.id);
        });
      }
      return send({ type: 'TALENT_ADD', candidate: candidate }).then(function () {
        return send({ type: 'EVENT', eventType: 'reject', name: name, detail: (res.reasons || []).join('；'), jdId: jd.id, site: self.site, delta: { count: 1, rejected: 1 } }).then(function () {
          var mode = state.settings.rejectMode || 'chat';
          if (!state.settings.autoReject || mode === 'skip' || capReached()) return markProcessed(item.id);
          return self.openAndMaybeReject(item.id, card, name, mode, identity).then(function (ok) {
            if (ok) {
              bumpCap();
              return markProcessed(item.id);
            }
            uiLog('err', '拒绝动作未完成 → ' + name + '，未标记已处理，刷新页面后会重试');
            return null;
          });
        });
      });
    }

    // review：加入人才库供人工复核，不动手
    uiLog('', '【待复核】' + name + '：' + res.reasons.join('。'));
    state.sessionStats.review++;
    candidate.contactStatus = 'review';
    return send({ type: 'TALENT_ADD', candidate: candidate }).then(function () {
      return markProcessed(item.id);
    });
  };

  // ---------- v3.6.0 待确认拒绝（设置 · 合规「不合格先给 HR 确认」，默认开） ----------
  // 智选判不合格的人不直接发拒绝话术、不点「不合适」，先放进浮层的「待确认」。HR 点「确认拒绝」才执行，点「改为合格」就不拒绝
  var PEND_KEY = 'rejectPending';
  function pendingAll() { return new Promise(function (r) { chrome.storage.local.get(PEND_KEY, function (o) { r(Array.isArray(o[PEND_KEY]) ? o[PEND_KEY] : []); }); }); }
  function pendingSave(list) { return new Promise(function (r) { var o = {}; o[PEND_KEY] = list.slice(-500); chrome.storage.local.set(o, r); }); }
  function pendingAdd(p) {
    return pendingAll().then(function (l) {
      l = l.filter(function (x) { return !(x.site === p.site && x.itemId === p.itemId && x.jdId === p.jdId); });
      p.id = 'p' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
      l.push(p);
      return pendingSave(l);
    }).then(renderPending);
  }
  function pendingDrop(id) { return pendingAll().then(function (l) { return pendingSave(l.filter(function (x) { return x.id !== id; })); }); }
  var pendBusy = '';
  function renderPending() {
    if (!ui) return;
    var box = ui.querySelector('.pend'), pn = ui.querySelector('.tb .pn');
    if (!box) return;
    var site = window.__HRS_SITE__ || '';
    pendingAll().then(function (all) {
      var l = all.filter(function (x) { return !site || x.site === site; }).sort(function (a, b) { return a.at - b.at; });
      if (pn) pn.textContent = l.length ? String(l.length) : '';
      var tm = function (t) { var d = new Date(t); return (d.getMonth() + 1) + '/' + d.getDate() + ' ' + String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0'); };
      box.innerHTML = (l.length ? '<div class="pt"><span>插件判不合格的 ' + l.length + ' 人，确认后才发拒绝话术、点「不合适」。左侧列表里能找到的人才能确认</span>' + (l.length > 1 ? '<button data-pa="all"' + (pendBusy ? ' disabled' : '') + '>全部确认</button>' : '') + '</div>' : '') +
        (l.map(function (p) {
          var dis = pendBusy ? ' disabled' : '';
          return '<div class="pi"><b>' + escH(p.name) + '</b> <span class="pj">' + escH(p.jdTitle || p.job || '') + ' · ' + tm(p.at) + '</span>' +
            '<div class="pr">' + escH((p.reasons || []).join('。')) + '</div>' +
            '<div class="pa"><button class="no" data-pa="no" data-id="' + escH(p.id) + '"' + dis + '>' + (pendBusy === p.id ? '处理中…' : '确认拒绝') + '</button><button class="yes" data-pa="yes" data-id="' + escH(p.id) + '"' + dis + '>改为合格</button></div></div>';
        }).join('') || '<div class="pe">没有待确认的人。智选判不合格的人会先放在这里</div>');
    });
  }
  try { chrome.storage.onChanged.addListener(function (ch, area) { if (area === 'local' && ch[PEND_KEY]) renderPending(); }); } catch (e) {}
  function waitIdle(ms) {
    var t0 = Date.now();
    return new Promise(function (resolve) {
      (function poll() { if (!state.busy) return resolve(true); if (Date.now() - t0 > (ms || 90000)) return resolve(false); setTimeout(poll, 500); })();
    });
  }
  function pendingConfirm(id) {
    var eng = activeEngine;
    if (!eng || pendBusy) return Promise.resolve(false);
    return pendingAll().then(function (l) {
      var p = l.filter(function (x) { return x.id === id; })[0];
      if (!p) return false;
      pendBusy = id; renderPending();
      uiLog('', '确认拒绝 ' + p.name + '：等当前这一位处理完');
      return waitIdle().then(function (idle) {
        if (!idle) { uiLog('warn', '当前处理太久，先不确认，稍后再点'); return false; }
        var pool = pickCardsFor(eng, { name: p.name, cid: p.cid, job: p.job, jd: p.jdTitle });
        if (pool.length !== 1) {
          uiLog('warn', p.name + '：' + (pool.length ? '左侧列表里有 ' + pool.length + ' 个同名的人，分不出是哪个' : '左侧列表里没找到') + '，先在列表里滚到他（或搜一下名字）再点确认');
          return false;
        }
        var card = pool[0], identity = eng.hooks.getIdentity ? eng.hooks.getIdentity(card) : null;
        var mode = state.settings.rejectMode || 'chat';
        state.busy = true;
        return eng.openAndMaybeReject(p.itemId, card, p.name, mode, identity).then(function (ok) {
          state.busy = false;
          // 只标已读、又没点「不合适」时 openAndMaybeReject 不返回 true，没失败就算完成
          if (ok === false) { uiLog('err', '确认拒绝没完成 → ' + p.name + '，还留在待确认里'); return false; }
          bumpCap();
          send({ type: 'TALENT_HR', id: p.itemId, action: 'reject_confirmed' });
          send({ type: 'EVENT', eventType: 'reject', name: p.name, detail: 'HR 确认拒绝：' + (p.reasons || []).join('；'), jdId: p.jdId, site: p.site, delta: {} });
          uiLog('reject', 'HR 确认拒绝 → ' + p.name);
          return pendingDrop(id).then(function () { return true; });
        }, function (e) { state.busy = false; uiLog('err', '确认拒绝出错：' + (e && e.message || e)); return false; });
      });
    }).then(function (r) { pendBusy = ''; renderPending(); renderUi(); return r; }, function (e) { pendBusy = ''; state.busy = false; uiLog('err', '确认拒绝出错：' + (e && e.message || e)); renderPending(); return false; });
  }
  function pendingConfirmAll() {
    var site = window.__HRS_SITE__ || '';
    return pendingAll().then(function (l) {
      var ids = l.filter(function (x) { return !site || x.site === site; }).map(function (x) { return x.id; });
      if (!ids.length) return;
      return confirmAction('确认拒绝 ' + ids.length + ' 人', '会逐个打开会话' + ((state.settings.rejectMode || 'chat') === 'chat' ? '发送拒绝话术' : '标记已读') + '。左侧列表里找不到的人会留在待确认里').then(function (ok) {
        if (!ok) return;
        var n = 0;
        return ids.reduce(function (pr, id) {
          return pr.then(function () { return pendingConfirm(id).then(function (r) { if (r) n++; return sleep(1500 + Math.random() * 1500); }); });
        }, Promise.resolve()).then(function () { uiLog('', '全部确认：完成 ' + n + ' / ' + ids.length + ' 人'); });
      });
    });
  }
  function pendingOverturn(id) {
    return pendingAll().then(function (l) {
      var p = l.filter(function (x) { return x.id === id; })[0];
      if (!p) return;
      send({ type: 'TALENT_HR', id: p.itemId, action: 'overturn', note: '待确认里改为合格' });
      send({ type: 'EVENT', eventType: 'pass', name: p.name, detail: 'HR 改为合格（插件原判不合格：' + (p.reasons || []).join('；') + '）', jdId: p.jdId, site: p.site, delta: {} });
      uiLog('pass', 'HR 改为合格 → ' + p.name + '。人才库里已改为合格，没有发拒绝。需要的话手动联系他');
      return pendingDrop(id);
    }).then(renderPending);
  }
  /** v3.6.0 自动决定记录：每判一个人记一条（后台攒一会儿一起写，明细保留 90 天） */
  function decisionLog(d) {
    try {
      var DLg = window.HRSDecisionLog;
      send({ type: 'DECISION_ADD', d: DLg ? DLg.entry(d) : d });
    } catch (e) {}
  }

  function renderDiagOverlay(card, res, name) {
    if (!diagState.on) return;
    card.setAttribute('data-hrs-diag', res.verdict);
    card.style.outline = res.verdict === 'pass' ? '2px solid #22c55e' : res.verdict === 'reject' ? '2px solid #ef4444' : '2px solid #f59e0b';
    var tip = document.createElement('div');
    tip.style.cssText = 'position:absolute;background:' + (res.verdict === 'pass' ? '#059669' : res.verdict === 'reject' ? '#dc2626' : '#d97706') + ';color:#fff;font:11px "Microsoft YaHei";padding:2px 6px;border-radius:6px;top:2px;right:2px;z-index:9999;';
    tip.textContent = name + ' ' + ({ pass: '合格', reject: '不合格', review: '待复核' }[res.verdict] || res.verdict);
    card.style.position = card.style.position || 'relative';
    var old = card.querySelector('[data-hrs-tip]');
    if (old) old.remove();
    tip.setAttribute('data-hrs-tip', '1');
    card.appendChild(tip);
    if (diagState.overlay) {
      diagState.overlay.innerHTML =
        '<div style="font-weight:600;margin-bottom:6px;">Smart Filter 诊断模式（' + (window.__HRS_SITE__ === 'boss' ? 'Boss' : '猎聘') + '）</div>' +
        '<div class="hint" style="margin-bottom:6px;">已高亮候选卡片：绿=通过 红=拒绝 黄=待复核</div>' +
        '<div style="margin-bottom:6px;">判定岗位：' + (curJd() ? curJd().title : '无') + '</div>' +
        '<div style="margin-bottom:6px;">卡片选择器命中：' + (state.lastCardSel || '—') + '</div>' +
        '<div style="margin-bottom:6px;">最近提取：' + (state.lastExtract || '—') + '</div>' +
        '<button data-a="pick" style="border:1px solid #334155;background:#1e293b;color:#e2e8f0;padding:4px 10px;border-radius:6px;cursor:pointer;margin-right:6px;">点选元素修复选择器</button>' +
        '<span class="selbtns" style="display:block;margin-top:4px;"></span>';
    }
  }

  // ---- 打开同一会话并可能发送拒绝话术 ----
  Engine.prototype.openAndMaybeReject = function (id, card, name, mode, identity) {
    var self = this;
    var script = state.settings.scripts && state.settings.scripts.rejection;
    if (!script) script = '您好，感谢关注，您的经历与该岗位匹配度有限，暂不推进。';
    script = fillTemplate(script, name);
    return self.hooks.openCard(card, identity).then(function (opened) {
      if (!opened || (self.hooks.assertConversation && !self.hooks.assertConversation(identity))) {
        uiLog('err', '会话校验失败，未发送拒绝话术 → ' + name);
        return false;
      }
      return self.hooks.markRead(card, identity).then(function () {
        var chain = Promise.resolve();
        if (state.settings.rejectTapInappropriate) {
          chain = chain.then(function () { return tapInappropriateButton(self, identity); }).then(function (hit) {
            if (hit) uiLog('reject', '已点击当前会话的「不合适」按钮');
            return true;
          });
        }
        if (mode === 'chat') {
          chain = chain.then(function () {
            return confirmAction('将向候选人发送拒绝话术', script).then(function (ok) {
              if (!ok) return false;
              if (self.hooks.assertConversation && !self.hooks.assertConversation(identity)) return false;
              var again = sentMarks();
              if (again) { uiLog('tip', name + '：' + again + '，不再发拒绝话术'); return false; }
              return self.hooks.sendMessage(card, script, identity).then(function (sent) {
                uiLog(sent ? 'reject' : 'err', sent ? '已发送拒绝话术 → ' + name : '发送失败 → ' + name);
                if (sent) recordMsg(id, name, '拒绝话术', script, window.__HRS_SITE__, { sourceUrl: chatUrlForIdentity(identity), chatId: identity && identity.chatId || '' });
                return sent;
              });
            });
          });
        }
        return chain;
      });
    });
  };

  /** 仅点击当前已校验会话内的「不合适」按钮。 */
  function tapInappropriateButton(engine, identity) {
    if (!engine || !identity) return Promise.resolve(false);
    if (engine.hooks.assertConversation && !engine.hooks.assertConversation(identity)) return Promise.resolve(false);
    var root = engine.hooks.getActiveRoot ? (engine.hooks.getActiveRoot() || document) : document;
    var btns = qsa('button,span,a,div,li,em', root);
    var target = null;
    for (var i = 0; i < btns.length; i++) {
      var t = (btns[i].textContent || '').trim();
      if (t === '不合适' || t === '标记为不合适' || t === '不匹配') {
        var el = btns[i];
        if (el.closest && el.closest('button')) el = el.closest('button');
        if (el.getAttribute && el.getAttribute('role') === 'button') { target = el; break; }
        if (el.tagName === 'BUTTON' || el.tagName === 'A' || el.tagName === 'DIV' || el.tagName === 'SPAN') { target = el; break; }
      }
    }
    if (!target) return Promise.resolve(false);
    if (!rpaActive()) { try { target.click(); } catch (e) { return Promise.resolve(false); } }
    var first = rpaActive() ? actClick(target) : Promise.resolve(true);   // v1.9.48 Boss + RPA 真实鼠标点
    return first.then(function (clicked) {
      if (!clicked) return false;
      return sleep(800).then(function () {
        if (engine.hooks.assertConversation && !engine.hooks.assertConversation(identity)) return false;
        var cons = qsa('button,span', document);
        for (var j = 0; j < cons.length; j++) {
          var ct = (cons[j].textContent || '').trim();
          if (ct === '确定' || ct === '确认' || ct === '知道了' || ct === '好的') {
            var btn = cons[j].closest && cons[j].closest('button') ? cons[j].closest('button') : cons[j];
            if (rpaActive()) {
              var rr = btn.getBoundingClientRect();
              if (!rr.width || !rr.height || btn.closest('#__hrs_ui__')) continue;   // RPA 只点看得见的
              return actClick(btn).then(function () { return true; });
            }
            try { btn.click(); return true; } catch (e) { return true; }
          }
        }
        return true;
      });
    });
  }

  // v1.9.45 打招呼语（Boss、猎聘通用）：岗位单独设的优先，没有就用默认
  function askText(jd, name) {
    var t = String(((jd && jd.greet) || {}).msg || (state.settings && state.settings.greetMsgDefault) || '').trim();
    return t ? fillTemplate(t, name) : '';
  }
  Engine.prototype.askFirst = function (card, name, identity, text, id) {
    var self = this;
    return self.hooks.openCard(card, identity).then(function (opened) {
      if (!opened || (self.hooks.assertConversation && !self.hooks.assertConversation(identity))) { uiLog('err', '会话校验失败，没发打招呼语 → ' + name); return false; }
      return confirmAction('将向候选人先问一句', text).then(function (ok) {
        if (!ok) return false;
        return self.hooks.sendMessage(card, text, identity).then(function (sent) {
          if (sent) recordMsg(id, name, '先问一句', text, window.__HRS_SITE__, { sourceUrl: chatUrlForIdentity(identity), chatId: identity && identity.chatId || '' });
          return sent;
        });
      });
    });
  };

  // v1.9.48 Boss：点「索要简历」后若出现带「简历」字样的确认框，点里面的确定（只认这种框，别的弹窗不碰）
  function confirmResumeDialog() {
    var findDlg = function () {
      return qsa('[class*="dialog"],[class*="modal"],[class*="confirm"],[class*="popup"],[role="dialog"]').filter(function (el) {
        if (el.closest('#__hrs_ui__')) return false;
        var r = el.getBoundingClientRect();
        return r.width > 80 && r.height > 40 && /简历/.test(el.innerText || '');
      })[0] || null;
    };
    var end = Date.now() + 2500;
    return (function poll() {
      var dlg = findDlg();
      if (dlg) {
        var ok = qsa('button,a,span,div', dlg).filter(function (el) {
          var r = el.getBoundingClientRect();
          return r.width > 0 && r.height > 0 && el.children.length <= 1 && /^(确定|确认|确定索要|发送|好的)$/.test((el.innerText || el.textContent || '').replace(/\s+/g, ''));
        }).pop();
        if (ok) return sleep(400 + Math.random() * 500).then(function () { return actClick(ok); });
        return Promise.resolve(false);
      }
      if (Date.now() > end) return Promise.resolve(false);
      return sleep(250).then(poll);
    })();
  }

  // ---- 合格后：先打开并校验会话，再索要简历 ----
  Engine.prototype.requestResume = function (id, card, name, identity) {
    var t0 = Date.now();
    return this.requestResume0(id, card, name, identity).then(function (ok) {
      runAdd('索要简历', name, !!ok, ok ? null : failOf(t0, '没点到「索要简历」或会话校验没过'));
      return ok;
    });
  };
  Engine.prototype.requestResume0 = function (id, card, name, identity) {
    var self = this;
    var script = state.settings.scripts && state.settings.scripts.request;
    if (!script) script = '您好，我是【' + (state.settings.company || '公司') + '】HR，想进一步了解您，方便交换简历吗？';
    script = fillTemplate(script, name);
    return self.hooks.openCard(card, identity).then(function (opened) {
      if (!opened || (self.hooks.assertConversation && !self.hooks.assertConversation(identity))) {
        uiLog('err', '会话校验失败，未索要简历 → ' + name);
        return false;
      }
      var btn = self.hooks.findRequestBtn(null, identity);
      if (btn) {
        return confirmAction('将点击「索要简历」', name).then(function (ok) {
          if (!ok) return false;
          if (self.hooks.assertConversation && !self.hooks.assertConversation(identity)) return false;
          if (rpaActive()) {
            // v1.9.48 Boss RPA：真实鼠标点「索要简历」；若弹出「确定向牛人索要简历？」这类确认框，真实鼠标点确定
            return actClick(btn).then(function (clicked) {
              if (!clicked) { uiLog('err', 'RPA 点击「索要简历」没完成 → ' + name); return false; }
              return confirmResumeDialog().then(function () {
                recordMsg(id, name, '索要简历', '已点击网页端「索要简历」按钮', window.__HRS_SITE__, { sourceUrl: chatUrlForIdentity(identity), chatId: identity && identity.chatId || '', resumeStatus: 'requested' });
                uiLog('pass', '已点击「索要简历」 → ' + name);
                return true;
              });
            });
          }
          try {
            btn.click();
            recordMsg(id, name, '索要简历', '已点击网页端「索要简历」按钮', window.__HRS_SITE__, { sourceUrl: chatUrlForIdentity(identity), chatId: identity && identity.chatId || '', resumeStatus: 'requested' });
            uiLog('pass', '已点击「索要简历」 → ' + name);
            return true;
          } catch (e) {
            uiLog('err', '点击「索要简历」出错 → ' + name + '：' + (e && e.message || e));
            return false;
          }
        });
      }
      return confirmAction('将向候选人发送索要简历话术', script).then(function (ok) {
        if (!ok) return false;
        if (self.hooks.assertConversation && !self.hooks.assertConversation(identity)) return false;
        return self.hooks.sendMessage(card, script, identity).then(function (sent) {
          if (sent) {
            recordMsg(id, name, '索要简历', script, window.__HRS_SITE__, { sourceUrl: chatUrlForIdentity(identity), chatId: identity && identity.chatId || '', resumeStatus: 'requested' });
            uiLog('pass', '已发送邀请/索要话术 → ' + name);
          }
          return sent;
        });
      });
    });
  };

  function fillTemplate(tpl, name) {
    var jd = curJd();
    var duties = (jd && jd.responsibilities && jd.responsibilities.length) ? jd.responsibilities.join('；') : '';
    return String(tpl || '')
      .replace(/\{company\}/g, state.settings.company || '本公司')
      .replace(/\{position\}/g, (jd && jd.title) || state.settings.position || '该岗位')
      .replace(/\{duties\}/g, duties)
      .replace(/\{name\}/g, name || '您')
      .replace(/\{jd\}/g, (jd && jd.title) || '岗位');
  }


  // ---------- v1.9.42 我方发过消息没有：看聊天区里有没有「已读 / 送达」标记，或我们话术的原文 ----------
  function sentMarks() {
    var hooks = activeEngine && activeEngine.hooks || {};
    var inList = function (el) { return el.closest('#__hrs_ui__') || (hooks.isConversationElement && hooks.isConversationElement(el)) || el.closest('textarea,input,[contenteditable="true"]'); };
    var snippets = [];
    var sc = state.settings && state.settings.scripts || {};
    Object.keys(sc).forEach(function (k) {
      var t = String(fillTemplate(sc[k], '') || '').replace(/\s+/g, '');
      if (t.length >= 12) snippets.push(t.slice(0, 16));
    });
    var w = window.innerWidth, hit = '';
    qsa('div,span,p,pre').some(function (el) {
      if (el.children.length > 3) return false;
      var t = txt(el); if (!t || t.length > 800) return false;
      var r = el.getBoundingClientRect();
      if (!r.width || r.left < w * 0.38 || r.top < 120) return false;
      if (inList(el)) return false;
      var n = t.replace(/\s+/g, '');
      if (el.children.length === 0 && /^(已读|送达|未读)$/.test(n) && r.top > 260) { hit = '会话里有「' + n + '」标记（我方消息）'; return true; }
      if (snippets.some(function (sn) { return n.indexOf(sn) >= 0; })) { hit = '会话里已有我们的话术'; return true; }
      return false;
    });
    return hit;
  }

  // ---------- v1.9.27 简历详情：点开详情读全文（Boss 是弹窗，猎聘是新页面），读完关掉 ----------
  function vis(el) { if (!el || !el.isConnected) return false; var r = el.getBoundingClientRect(); if (r.width < 2 || r.height < 2) return false; var cs = getComputedStyle(el); return cs.visibility !== 'hidden' && cs.display !== 'none' && +cs.opacity !== 0; }
  function txt(el) { return el ? String(el.innerText || el.textContent || '').trim() : ''; }
  function domClick(el) {
    if (rpaActive()) return actClick(el);   // v1.9.48 Boss + RPA：真实鼠标点（返回 Promise）
    var r = el.getBoundingClientRect(), x = r.left + Math.min(r.width / 2, 30), y = r.top + r.height / 2;
    ['pointerover', 'mouseover', 'pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click'].forEach(function (type) {
      try { var Ev = /^pointer/.test(type) && window.PointerEvent ? PointerEvent : MouseEvent; el.dispatchEvent(new Ev(type, { bubbles: true, cancelable: true, view: window, clientX: x, clientY: y, button: 0, buttons: /down/.test(type) ? 1 : 0 })); } catch (e) {}
    });
  }
  function trustedAt(el) {
    if (rpaActive()) return HRSDom.rpaClick(el);   // v1.9.48 Boss + RPA：不再挂浏览器调试器
    var r = el.getBoundingClientRect(), p = { x: r.left + Math.min(r.width / 2, 30), y: r.top + r.height / 2 };
    try { var w = window; while (w !== w.top && w.frameElement) { var fr = w.frameElement.getBoundingClientRect(); p.x += fr.left; p.y += fr.top; w = w.parent; } } catch (e) {}
    window.__hrsSelfTrustedAt = Date.now();
    return send({ type: 'TRUSTED_CLICK', x: Math.round(p.x), y: Math.round(p.y) });
  }
  // 详情区右上角那张卡上的名字（会话顶部「倪先生 刚刚活跃 50岁…」）
  function headerNameEl(name, minLeft) {
    var n = String(name || '').replace(/\s+/g, '');
    if (!n) return null;
    return qsa('span,div,a,h1,h2,h3,h4,p,b,strong').filter(function (el) {
      if (el.closest('#__hrs_ui__') || el.children.length > 2 || !vis(el)) return false;
      var r = el.getBoundingClientRect(), t = txt(el).replace(/\s+/g, '');
      return r.left >= (minLeft || 0) && r.top < 300 && (t === n || (t.indexOf(n) === 0 && t.length <= n.length + 2));
    }).sort(function (a, b) { return a.getBoundingClientRect().top - b.getBoundingClientRect().top || txt(a).length - txt(b).length; })[0] || null;
  }
  // 页面上盖着的大弹层（简历详情）
  function bigPopup() {
    var c = qsa('[class*="dialog"],[class*="modal"],[role="dialog"],[class*="resume"],[class*="geek-detail"],[class*="boss-popup"],[class*="drawer"],[class*="detail"]').filter(function (el) {
      if (el.closest('#__hrs_ui__') || !vis(el)) return false;
      var r = el.getBoundingClientRect();
      return r.width > 420 && r.height > 300;
    });
    c.sort(function (a, b) { var ra = a.getBoundingClientRect(), rb = b.getBoundingClientRect(); return rb.width * rb.height - ra.width * ra.height; });
    return c[0] || null;
  }
  function popupText(pp) {
    var t = txt(pp);
    qsa('iframe', pp).forEach(function (f) { try { var d = f.contentDocument; if (d && d.body) t += '\n' + d.body.innerText; } catch (e) {} });
    return t;
  }
  // v1.9.40 关闭按钮：弹层右上角附近、最靠右的那个 ×（不点「收藏 / 转发 / 举报」这些带字的图标）
  function clsOf(el) { return String(el.className && el.className.baseVal != null ? el.className.baseVal : el.className || ''); }
  function closeXOf(pp) {
    var r = pp.getBoundingClientRect();
    var c = qsa('*').filter(function (el) {
      if (el.closest('#__hrs_ui__') || !vis(el)) return false;
      var b = el.getBoundingClientRect();
      if (b.width > 48 || b.height > 48 || b.width < 6) return false;
      if (!(b.top < r.top + 80 && b.top > r.top - 70 && b.left > r.right - 140 && b.left < r.right + 90)) return false;
      var t = txt(el).replace(/\s+/g, '');
      if (/收藏|转发|举报|分享|下载|打印|沟通/.test(t)) return false;
      var lab = el.parentElement && el.parentElement.closest('a,button,li,div');
      if (lab && lab.getBoundingClientRect().width <= 100 && /收藏|转发|举报|分享|下载/.test(txt(lab))) return false;
      return t === '' || /^[×✕✖xX]$/.test(t) || /close/i.test(clsOf(el));
    });
    c.sort(function (p, q) {
      var cp = /close/i.test(clsOf(p)) ? 0 : 1, cq = /close/i.test(clsOf(q)) ? 0 : 1;
      if (cp !== cq) return cp - cq;
      var bp = p.getBoundingClientRect(), bq = q.getBoundingClientRect();
      return (bq.right - bp.right) || (bp.top - bq.top);
    });
    var x = c[0] || null;
    return x ? (x.closest('button,a,[class*="close"]') || x) : null;
  }
  function closePopup(pp) {
    var gone = function () { return !vis(pp); };
    var x = closeXOf(pp);
    return Promise.resolve(x ? domClick(x) : null).then(function () { return sleep(700); }).then(function () {
      if (gone()) return true;
      if (x && x.isConnected) return trustedAt(x).then(function () { return sleep(700); });
    }).then(function (r) {
      if (r === true || gone()) return true;
      return escKey().then(function () { return sleep(600); }).then(gone);
    });
  }
  // v1.9.40 Boss：处理下一位前，上一位的简历弹窗还开着就先关掉（开着会挡住顶部简历信息）
  function strayPopup() {
    if (window.__HRS_SITE__ !== 'boss') return null;
    var pp = bigPopup();
    if (!pp) return null;
    for (var p = pp; p && p !== document.body; p = p.parentElement) { if (getComputedStyle(p).position === 'fixed') return pp; }
    return null;
  }
  function closeStray() {
    var pp = strayPopup();
    if (!pp) return Promise.resolve();
    uiLog('', '简历详情弹窗还开着，先关掉');
    return closePopup(pp).then(function (ok) { if (!ok) uiLog('warn', '简历详情弹窗没关掉，请手动点右上角 ×'); });
  }
  function resetScroll() {
    try {
      var se = document.scrollingElement || document.documentElement;
      if (se.scrollLeft || se.scrollTop) { se.scrollLeft = 0; se.scrollTop = 0; }
      if (document.body && document.body.scrollLeft) document.body.scrollLeft = 0;
    } catch (e) {}
  }
  // v1.9.40 列表卡片上的红色未读数字角标
  function unreadBadge(card) {
    if (!card) return false;
    return qsa('*', card).some(function (el) {
      if (el.children.length) return false;
      var t = txt(el);
      if (!/^\d{1,3}\+?$/.test(t)) return false;
      var r = el.getBoundingClientRect();
      if (r.width < 4 || r.width > 32 || r.height < 4 || r.height > 26) return false;
      if (/badge|unread|count|num|dot|red/i.test(clsOf(el) + ' ' + clsOf(el.parentElement || el))) return true;
      var n = el;
      for (var i = 0; i < 3 && n; i++, n = n.parentElement) {
        var m = String(getComputedStyle(n).backgroundColor).match(/rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?/);
        if (m && (m[4] == null || +m[4] > 0.2)) return +m[1] > 180 && +m[2] < 130 && +m[3] < 130;
      }
      return false;
    });
  }
  // Boss：点名字 → 弹出简历详情 → 读全文 → 点右上角 × 关掉
  function readByPopup(el) {
    if (!el) return Promise.resolve({ ok: false, why: '找不到可点的名字' });
    var before = bigPopup();
    domClick(el);
    var n = 0;
    return (function wait() {
      var pp = bigPopup();
      if (pp && pp !== before && txt(pp).length > 60) {
        return sleep(1200).then(function () {
          var t = popupText(pp);
          return closePopup(pp).then(function (closed) {
            if (!closed) uiLog('warn', '简历详情弹窗没关掉，请手动点右上角 ×');
            return { ok: t.replace(/\s+/g, '').length >= 80, text: t, why: t.length < 80 ? '弹窗里读不到文字（可能是图片）' : '', closed: closed };
          });
        });
      }
      if (++n === 6 && !rpaActive()) trustedAt(el);   // v1.9.48 RPA 本来就是真实点击，不再补点
      if (n > 16) return { ok: false, why: '点了名字没有弹出简历详情' };
      return sleep(500).then(wait);
    })();
  }
  // 猎聘：点名字会新开页面。先让页面把新页面地址交给插件（不真的打开），后台打开、读完、关掉；
  // 交不出地址时，再真点一次，接住新开的标签页
  function readByNewPage(el) {
    if (!el) return Promise.resolve({ ok: false, why: '找不到可点的名字' });
    var url = '';
    var onMsg = function (e) { if (e.data && e.data.__hrs_open__ && e.data.url && !url) url = e.data.url; };
    window.addEventListener('message', onMsg);
    document.documentElement.setAttribute('data-hrs-catch-open', '1');
    domClick(el);
    var n = 0;
    return (function wait() {
      if (url || n++ > 8) {
        document.documentElement.removeAttribute('data-hrs-catch-open');
        window.removeEventListener('message', onMsg);
        if (url) return send({ type: 'DETAIL_READ_URL', url: url });
        var arm = send({ type: 'DETAIL_CATCH_TAB', timeout: 12000 });
        return sleep(300).then(function () { return trustedAt(el); }).then(function () { return arm; });
      }
      return sleep(400).then(wait);
    })();
  }
  function aiMaybe(jd, text, sc, name) {
    var ai = state.settings && state.settings.ai;
    if (!ai || !ai.on || !ai.url) return Promise.resolve(null);
    // v3.6.0 后台发给 AI 之前会去掉姓名、电话、邮箱、微信、证件号，name 用来认出姓名
    return send({ type: 'AI_JUDGE', jd: { title: jd.title, jdText: jd.jdText || '' }, text: text, sc: sc, name: name || '' }).then(function (r) {
      if (r && r.ok) return r;
      uiLog('tip', 'AI 判断没成功，改用关键词打分：' + (r && (r.why || r.error) || ''));
      return null;
    });
  }
  // 简历详情判定：base = 只判基础条件的结果
  /**
   * v3.3.0 智选的评测样本：会话判定用到的内容 + 两种判法的结论（以前的判法、和打招呼一样的统一判法）
   * 存之前去掉姓名、电话、邮箱、微信号、身份证号。完整简历只留前 6000 字
   */
  function chatEvalSample(site, chat, rules, jd, name, J) {
    try {
      if (state.settings.evalCollect === false || !J || !J.text) return;
      var nm = String(name || '');
      var anon = function (x) {
        var t = String(x == null ? '' : x);
        if (nm && nm.length >= 2 && !/候选人/.test(nm)) t = t.split(nm).join('候选人');
        return t.replace(/1[3-9]\d{9}/g, '<电话>').replace(/[\w.+-]+@[\w-]+\.[\w.]+/g, '<邮箱>')
          .replace(/(微信|wechat|vx)\s*[:：号]?\s*[A-Za-z][\w-]{5,19}/gi, '$1<微信>').replace(/\d{17}[\dXx]/g, '<证件号>');
      };
      var R = rules || {};
      var V = function (r) { return r ? { verdict: r.verdict, reason: anon((r.reasons || [])[0] || '').slice(0, 200), mode: r.engineMode } : null; };
      var sample = {
        kind: 'chat', site: site, at: Date.now(), jdId: jd.id, jobTitle: jd.title, detail: false,
        rules: { hardRequirements: (R.hardRequirements || []).slice(), optionalKeywords: (R.optionalKeywords || []).slice(), requireChip: !!R.requireChip },
        card: { summary: anon(chat.summary).slice(0, 4000), text: anon(chat.text).slice(0, 6000), fields: JSON.parse(anon(JSON.stringify(chat.fields || {}))),
          workLines: (chat.workLines || []).map(anon), summaryExpected: !!chat.summaryExpected },
        verdict: J.res.verdict, reason: anon((J.res.reasons || [])[0] || '').slice(0, 200), engine: J.mode,
        verdicts: { text: V(J.text), unified: V(J.unified) }
      };
      send({ type: 'EVAL_ADD', sample: sample });
    } catch (e) {}
  }

  function detailJudge(openFn, jd, dr, name, base) {
    uiLog('', name + '：基础条件符合，打开简历详情看关键词');
    return openFn().then(function (d) {
      if (!d || !d.ok) {
        var r = JSON.parse(JSON.stringify(base)); r.verdict = 'review';
        r.reasons = ['简历详情没读到' + (d && (d.why || d.error) ? '（' + (d.why || d.error) + '）' : '') + '，不自动判定'];
        return r;
      }
      var RS = window.HRSResumeScore;
      // v2.6.8 第一学历是大专：完整简历里再看一遍
      var M2 = window.HRSMatcher;
      var dz = M2 && M2.firstEduOf && ((dr.base && dr.base.hardRequirements) || []).some(function (x) { return /^第一学历/.test(String(x).replace(/\s+/g, '')); }) ? M2.firstEduOf({}, d.text, '') : null;
      if (dz && dz.dz) {
        var r1 = JSON.parse(JSON.stringify(base)); r1.verdict = 'reject';
        r1.reasons = ['第一学历是大专（简历详情：' + dz.why + '）'];
        (r1.hits.rows = r1.hits.rows || []).push({ rule: '第一学历不要大专', ok: false, got: '简历详情：' + dz.why });
        return r1;
      }
      var sc = RS.score(d.text, { hard: dr.hard, bonus: dr.bonus, veto: dr.veto, passLine: dr.passLine, names: dr.names });
      return (sc.vetoWhy ? Promise.resolve(null) : aiMaybe(jd, d.text, sc, name)).then(function (ai) { return RS.combine(base, sc, ai); });
    });
  }

  window.__HRS_ENGINE_API__ = {
    active: function () { return activeEngine; },
    pendingAll: pendingAll,
    pendingConfirm: pendingConfirm,
    pendingOverturn: pendingOverturn,
    pickCardsFor: pickCardsFor,
    Engine: Engine,
    state: state,
    loadState: loadState,
    log: log,
    uiLog: uiLog,
    renderUi: renderUi,
    send: send,
    sleep: sleep,
    qs: qs,
    qsa: qsa,
    firstQuery: firstQuery,
    setNativeValue: setNativeValue,
    hash: hash,
    fillTemplate: fillTemplate,
    setDiagMode: setDiagMode,
    confirmAction: confirmAction,
    capReached: capReached,
    bumpCap: bumpCap,
    headerNameEl: headerNameEl,
    planJdFor: resolvePlanJd,
    plannedJds: plannedJds,
    trustedAt: trustedAt,
    rpaActive: rpaActive,
    rpaNote: rpaNote,
    actClick: actClick,
    readByPopup: readByPopup,
    readByNewPage: readByNewPage,
    aiMaybe: aiMaybe
  };

  // v2.5.0 「简历收集」点「定位」：已经开着的沟通页直接在这里找人（不新开标签页）
  chrome.runtime.onMessage.addListener(function (msg, sender, sendResponse) {
    if (!msg || msg.type !== 'HRS_FIND' || !msg.req || !msg.req.name) return;
    if (!activeEngine || window.top !== window) return;
    state.manualPaused = true;
    renderUi();
    uiLog('', '「简历收集」要定位「' + msg.req.name + '」，自动流程已暂停');
    setTimeout(function () { findFromHash(activeEngine, msg.req); }, 300);
    sendResponse({ ok: true });
  });
  // v2.6.1 后台问：当前打开的是谁的会话（拿到平台下载 / 预览里的 PDF 后用来认人）
  chrome.runtime.onMessage.addListener(function (msg, sender, sendResponse) {
    if (!msg || msg.type !== 'HRS_INBOX_CTX' || window.top !== window || FETCH_TAB) return;
    var ctx = null;
    try { ctx = activeEngine ? inboxCtx(activeEngine) : null; } catch (e) { ctx = null; }
    sendResponse({ ok: !!ctx, ctx: ctx });
  });
  // v2.6.1 后台请页面帮忙取一个只有页面能读的地址（blob:），确认是 PDF 才返回
  chrome.runtime.onMessage.addListener(function (msg, sender, sendResponse) {
    if (!msg || msg.type !== 'HRS_FETCH_PDF' || window.top !== window) return;
    fetchPdf([msg.url]).then(function (got) {
      if (!got.blob) return { ok: false };
      return blobToDataUrl(got.blob).then(function (d) { return { ok: true, dataUrl: d }; });
    }).catch(function () { return { ok: false }; }).then(sendResponse);
    return true;
  });
  // 弹窗探活：HRS_PING
  chrome.runtime.onMessage.addListener(function (msg, sender, sendResponse) {
    if (msg && msg.type === 'HRS_PING') {
      sendResponse({
        ok: true,
        version: HRS_VERSION,
        paceSec: currentPace(),
        nextIn: Math.max(0, Math.ceil((state.nextAt - Date.now()) / 1000)),
        queue: state.queue.length,
        paused: !!state.manualPaused,
        lastError: state.lastError || '',
        site: window.__HRS_SITE__ || '',
        enabled: !!(state.settings && state.settings.masterEnabled),
        dryRun: !!(state.settings && state.settings.dryRun),
        stats: {
          scanned: state.sessionStats.scanned,
          passed: state.sessionStats.passed,
          rejected: state.sessionStats.rejected,
          review: state.sessionStats.review
        },
        cardsFound: !!state.lastCardSel && state.lastCardSel.indexOf('未命中') !== 0
      });
      return true;
    }
  });
})();
