/**
 * boss-greet.js v1.6.0：Boss「推荐牛人」页按岗位计划自动打招呼
 * 独立于沟通筛选：自己的总开关（设置 · 打招呼 · 运行模式）、节拍、每日上限、浮层。
 * 流程：认出当前职位 → 逐张卡片滚动到视野里、停顿 → 读卡片（年龄、经验、学历、期望、工作经历）
 *      → 按这个岗位的「打招呼条件」判定 → 合格且正式运行才点「打招呼」→ 按节拍等下一张
 * 安全：出现验证、频繁、上限类提示立即停止；点完按钮没变成「继续沟通」也停止；不处理任何不认识的弹窗。
 * v1.9.48 Boss 改为 RPA：Boss 上的点击、悬停、滚动、输入、按键全部交给本机 RPA 助手用真实鼠标键盘完成
 *   （hrs-dom.js 的 rpa* 系列，复用 v1.9.2 的 Python 助手），不再派发脚本事件、不再挂浏览器调试器。判定逻辑、流程、计数不变。
 *   RPA 暂时不能用（你在用鼠标键盘 / 锁屏 / 助手没开 / 窗口被挡）时只是「等」，不算失败、不换岗、不跳人。猎聘保持原样。
 */
(function () {
  'use strict';
  if (window.__HRS_GREET__) return;
  window.__HRS_GREET__ = true;
  var D = window.HRSDom, M = window.HRSMatcher, P = window.HRSPlan;
  if (!D || !M || !P) return;
  // v1.9.3 同一套打招呼逻辑支持猎聘「人才推荐」页
  var SITE = /zhipin\.com$/i.test(location.hostname) ? 'boss' : (/liepin\.com$/i.test(location.hostname) ? 'liepin' : '');
  var GREET_TXT = SITE === 'liepin' ? '立即沟通' : '打招呼';
  var LOG_KEY = SITE === 'liepin' ? 'greetLogLiepin' : 'greetLog';
  var VERSION = (function () { try { return chrome.runtime.getManifest().version; } catch (e) { return '?'; } })();

  var st = {
    settings: {}, jds: [], log: {}, paused: false, busy: false, nextAt: 0, stopReason: '',
    seen: {}, noNewScrolls: 0, exhausted: {}, lastJob: '', lastJd: null, lastErr: ''
  };

  function isRecommendPage() {
    if (!SITE) return false;
    return /recommend/i.test(location.pathname + location.hash) && greetButtons().length > 0;
  }
  function today() { return P.localDate(); }
  function logToday() {
    if (!st.log || st.log.date !== today()) st.log = { date: today(), total: 0, counts: {}, keys: {}, scan: 0, pass: 0, reject: 0, items: [] };
    if (st.log.scan == null) { st.log.scan = 0; st.log.pass = 0; st.log.reject = 0; st.log.items = []; }
    return st.log;
  }
  function saveLog() { try { var o = {}; o[LOG_KEY] = st.log; chrome.storage.local.set(o); } catch (e) {} }
  // v1.7.8 打过招呼的人长期记住（180 天），换天、换岗位、刷新页面都不会再打
  // v1.9.39 打招呼记录按平台分开存：Boss 打过的「王女士 32岁 上海」不再让猎聘上同样称呼的人被跳过
  function HIST_KEY() { return SITE === 'liepin' ? 'greetHistoryLiepin' : 'greetHistory'; }
  function remember(key) {
    st.hist = st.hist || {};
    st.hist[key] = Date.now();
    var cut = Date.now() - 180 * 86400000;
    Object.keys(st.hist).forEach(function (k) { if (st.hist[k] < cut) delete st.hist[k]; });
    try { var o = {}; o[HIST_KEY()] = st.hist; chrome.storage.local.set(o); } catch (e) {}
  }
  // v1.9.46 Boss / 猎聘 打招呼的运行模式各自独立
  function gView(s) { if (window.HRSJobKB && HRSJobKB.applySettings) HRSJobKB.applySettings(s);   // v3.4.0 设置里自定义的岗位知识库
    var v = Object.assign({}, s), m = v.siteMode && v.siteMode[SITE]; if (m && m.greetMode !== undefined) v.greetMode = m.greetMode; return v; }
  function load() {
    return new Promise(function (res) {
      chrome.storage.local.get(['settings', 'jds', LOG_KEY, HIST_KEY()], function (o) {
        st.settings = gView(o.settings || {});
        st.jds = o.jds || [];
        st.log = o[LOG_KEY] || {};
        st.hist = o[HIST_KEY()] || {};
        res();
      });
    });
  }
  chrome.storage.onChanged.addListener(function (ch, area) {
    if (area !== 'local') return;
    if (ch.settings) {
      var before = st.settings.greetMode;
      st.settings = gView(ch.settings.newValue || {});
      if (before !== st.settings.greetMode) {
        st.stopReason = ''; st.greetMiss = 0;
        say('', '运行模式切换为「' + modeLabel() + '」');
        // v2.6.0 节拍太快时提醒：平台对连续打招呼有频率限制，太快容易「点了没反应」
        if (mode() === 'live' && SITE === 'boss' && pace() < 20) say('tip', '打招呼节拍现在是 ' + pace() + ' 秒/个，偏快，BOSS 容易限制。建议 30 秒以上（浮层上的「打招呼节拍」可以改）');
      }
    }
    if (ch.jds) { st.jds = ch.jds.newValue || []; st.exhausted = {}; }
    render();
  });

  function mode() { return st.settings.greetMode || 'stop'; }
  function modeLabel() { return { stop: '停止', dry: '试运行', live: '正式运行' }[mode()] || '停止'; }
  function pace() { var n = parseInt(st.settings.greetPaceSec, 10); return Math.min(600, Math.max(10, isFinite(n) ? n : 45)); }
  // ---------------- v2.3.0 拟人节奏 + 运行记录 ----------------
  var R = window.HRSRhythm || null, RL = window.HRSRunLog || null;
  var breaker = R ? new R.Breaker() : null;
  function rh() { return st.settings && st.settings.rhythm; }
  // 节拍系数：开了拟人节奏按设置浮动，否则沿用原来的 1~1.3
  function paceF() { var r = R ? R.norm(rh()) : null; return r && r.on ? R.paceFactor(r) : D.rand(1, 1.3); }
  function skim() { return R ? R.skimMs(rh()) : D.rand(1500, 3500); }
  function runAdd(act, target, ok, r, detail) {
    if (!RL) return;
    r = r || {};
    RL.add({ mod: '打招呼', site: SITE, act: act, target: target, ok: ok, code: r.code, why: r.why, detail: detail, via: useRpa() ? 'rpa' : 'script' });
  }
  function failOf(t0, why) {
    var f = D.lastFailSince ? D.lastFailSince(t0) : null;
    return f ? { code: f.code, why: f.why } : { code: '', why: why };
  }
  // 每打完一个招呼计一次，到点就小憩
  function maybeRest() {
    var ms = breaker ? breaker.tick(rh()) : 0;
    if (!ms) return;
    st.nextAt = Math.max(st.nextAt, Date.now() + ms);
    say('tip', '拟人节奏：小憩 ' + Math.round(ms / 1000) + ' 秒后继续');
    runAdd('休息', '小憩 ' + Math.round(ms / 1000) + ' 秒', true);
  }
  function statusNow() {
    var m = mode();
    if (m === 'stop') return { state: 'stopped', text: '运行模式为「停止」' };
    if (st.stopReason) return { state: 'stopped', text: st.stopReason };
    if (st.paused) return { state: 'stopped', text: '已暂停（点浮层「继续」恢复）' };
    var dry = m === 'dry' ? '试运行 · ' : '';
    if (breaker && breaker.resting()) return { state: 'resting', text: dry + '拟人小憩，约 ' + breaker.left() + ' 秒后继续', until: breaker.until };
    if (st.rpaHold && Date.now() < st.rpaHold.until) return { state: 'running', text: dry + 'RPA 等待中：' + (st.rpaHold.why || '') };
    var left = Math.max(0, Math.ceil((st.nextAt - Date.now()) / 1000));
    return { state: 'running', text: dry + String(st.lastJob || '读取中').replace(/（对应岗位：[^）]*）/, '').slice(0, 40) + (st.busy ? ' · 处理中' : (left ? ' · 下一位 ' + left + ' 秒' : '')) };
  }
  function reportStatus() {
    if (!RL || !SITE || !isRecommendPage()) return;
    try { RL.status(SITE + '-greet', statusNow()); } catch (e) {}
  }
  function cap() { var n = parseInt(st.settings.greetDailyCap, 10); return isFinite(n) && n > 0 ? n : 180; }
  function greetCfg(jd) {
    var g = jd.greet || {};
    // v1.7.0 条件统一来自「岗位管理」：基础条件 + 打招呼硬性 / 加分（勾了「同一套」就用智选那套）
    var r = P.rulesOf(jd, st.jds, 'greet');
    return {
      // v1.9.14 没有这个平台标签的岗位，这个平台的打招呼量是 0
      enabled: !!g.enabled, quota: (P.onSite && !P.onSite(jd, SITE || 'boss')) ? 0 : (P.quotaOf(jd, SITE || 'boss', 'Greet') || Infinity),   // v1.9.0 默认不限
      hard: r.hardRequirements, bonus: r.optionalKeywords, requireChip: r.requireChip
    };
  }
  // ---------------- v1.9.48 Boss RPA ----------------
  function useRpa() { return SITE === 'boss' && !!D.rpaOn && D.rpaOn(); }
  function heldSince(t) { return useRpa() && D.rpaHeldSince ? D.rpaHeldSince(t) : null; }
  // RPA 现在不能动鼠标：记下来，tick 会等到时间再继续（不算失败）
  function setHold(r) {
    var wait = Math.max(3, Math.min(120, (r && r.wait) || 5));
    st.rpaHold = { until: Date.now() + wait * 1000, why: D.holdMessage ? D.holdMessage(r) : ((r && r.why) || ''), code: r && r.code };
    if (st.lastHoldCode !== st.rpaHold.code || Date.now() - (st.lastHoldSay || 0) > 30000) {
      say('tip', 'RPA 等待：' + st.rpaHold.why);
      st.lastHoldCode = st.rpaHold.code; st.lastHoldSay = Date.now();
    }
    render();
  }
  function rpaFail(r) {
    if (D.isHold && D.isHold(r)) { setHold(r); return; }
    st.lastRpaWhy = (r && (r.why || r.code)) || '未知原因';
    say('tip', 'RPA 动作没完成：' + st.lastRpaWhy);
  }
  // ---------------- v2.6.0 点「打招呼」后页面上冒出来的提示 ----------------
  // 平台的限额 / 付费 / 频繁提示常在最外层页面弹出（插件在内嵌的推荐页里），或是一闪而过的轻提示。点之前开始盯，点完把看到的文字都收下来
  var POP_SEL = '[class*="dialog"],[class*="modal"],[class*="popup"],[class*="toast"],[class*="layer"],[class*="notice"],[class*="tooltip"],[class*="tip-"],[class*="-tip"],[role="dialog"],[role="alert"],[role="tooltip"]';
  var LIMIT_RE = /(上限|次数|已用完|用完了|不足|道具|购买|开通|VIP|会员|权益|直聊卡|畅聊|付费|充值|额度)/i;
  var FREQ_RE = /(频繁|稍后再试|太快|过快|操作异常|访问异常|休息一下)/;
  function popDocs() {
    var docs = [document];
    try { if (window.top !== window && window.top.document) docs.push(window.top.document); } catch (e) {}
    return docs;
  }
  function seenOnScreen(el) {
    try {
      var r = el.getBoundingClientRect();
      if (r.width < 4 || r.height < 4) return false;
      var cs = el.ownerDocument.defaultView.getComputedStyle(el);
      return cs.display !== 'none' && cs.visibility !== 'hidden' && +cs.opacity > 0.05;
    } catch (e) { return false; }
  }
  function popText(el) { return String(el.innerText || el.textContent || '').replace(/\s+/g, ' ').trim(); }
  // card：被点的那张卡片。卡片里的小提示（比如按钮下面的提示图标）只看这一张，别的卡片里的不算
  function popupTexts(card) {
    var out = [];
    popDocs().forEach(function (doc) {
      Array.prototype.slice.call(doc.querySelectorAll(POP_SEL)).forEach(function (b) {
        if (b.closest('#__hrs_greet__,#__hrs_ui__')) return;
        var inCard = b.closest('[class*="candidate-card"],[class*="card-item"],li');
        if (inCard && card && !card.contains(b) && doc === document) return;
        if (!seenOnScreen(b)) return;
        var t = popText(b);
        if (t.length >= 2 && t.length <= 160 && t !== GREET_TXT) out.push(t);
      });
    });
    return tidyPops(out);
  }
  function tidyPops(arr) {
    var u = [];
    arr.forEach(function (t) { if (u.indexOf(t) < 0) u.push(t); });
    // 外层框和里面的字重复时只留短的那条
    return u.filter(function (t) { return !u.some(function (o) { return o !== t && o.length < t.length && t.indexOf(o) >= 0 && o.length > 4; }); }).slice(0, 6);
  }
  // 点之前开始盯：新加到页面上的提示框文字（一闪就没的轻提示也能记下）
  function watchPopups() {
    var got = [], obs = [];
    popDocs().forEach(function (doc) {
      if (!doc.body) return;
      try {
        var mo = new doc.defaultView.MutationObserver(function (list) {
          list.forEach(function (m) {
            Array.prototype.forEach.call(m.addedNodes || [], function (n) {
              var el = n.nodeType === 1 ? n : n.parentElement;
              if (!el || el.closest('#__hrs_greet__,#__hrs_ui__')) return;
              var box = el.matches && el.matches(POP_SEL) ? el : (el.closest ? el.closest(POP_SEL) : null);
              if (!box) return;
              var t = popText(box);
              if (t.length >= 2 && t.length <= 160 && t !== GREET_TXT) got.push(t);
            });
          });
        });
        mo.observe(doc.body, { childList: true, subtree: true });
        obs.push(mo);
      } catch (e) {}
    });
    return {
      peek: function () { return tidyPops(got); },
      stop: function () { obs.forEach(function (o) { try { o.disconnect(); } catch (e) {} }); obs = []; return tidyPops(got); }
    };
  }
  // 往输入框里打字 / 按回车：Boss + RPA 用真实键盘，其他情况保持原来的写法
  function typeInto(el, text) {
    if (!useRpa()) { typeText(el, text); return Promise.resolve(true); }
    return D.rpaType(el, text, { clear: true }).then(function (r) { if (!r.ok) rpaFail(r); return !!r.ok; });
  }
  function pressEnter(el) {
    if (!useRpa()) { try { el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true })); } catch (e) {} return Promise.resolve(); }
    return D.rpaKey('enter').then(function (r) { if (!r.ok) rpaFail(r); });
  }

  /**
   * v1.7.6 点一下并确认生效：先用脚本点击，没反应再用真实鼠标点击（页面只认真人点击时）。
   * 真实点击成功过一次，后面就直接用真实点击。
   */
  function clickVerified(el, check, wait, useTrusted) {
    // 浮层可能正好盖在按钮上（真实鼠标点击会点到浮层），点击期间先藏起来
    // v2.6.8 不管点击那边有没有结束，最多藏 12 秒就显示回来（以前点击卡住时浮层一直看不见，也拖不动）
    var t = null;
    var hide = function () { if (ui) ui.style.visibility = 'hidden'; t = setTimeout(function () { if (ui) ui.style.visibility = ''; }, 12000); };
    var unhide = function (v) { clearTimeout(t); if (ui) ui.style.visibility = ''; return v; };
    hide();
    return clickVerified0(el, check, wait, useTrusted).then(unhide, function (e) { unhide(); throw e; });
  }
  function clickVerified0(el, check, wait, useTrusted) {
    // v1.9.48 Boss：只用 RPA 真实鼠标点一次，然后等页面变化。不混用脚本点击，也不自动连点（避免把「打招呼」点成「继续沟通」）
    if (useRpa()) {
      return D.rpaClick(el).then(function (r) {
        if (!r || !r.ok) { rpaFail(r); return false; }
        return D.waitFor(check, Math.max(wait || 2500, 3500)).then(function (ok) { return !!ok; });
      });
    }
    var tryTrusted = function () {
      if (st.settings.greetTrustedClick === false) return Promise.resolve(false);
      return D.scrollIntoViewSoft(el).then(function () { return D.trustedClick(el); }).then(function (r) {
        if (!r || !r.ok) { say('tip', '真实鼠标点击没发出去：' + (r && r.why || '')); return false; }
        return D.waitFor(check, wait || 2500).then(function (ok) { if (ok) st.trusted = true; return !!ok; });
      });
    };
    if (useTrusted || st.trusted) return tryTrusted();
    return D.click(el).then(function () { return D.waitFor(check, wait || 2500); }).then(function (ok) { return ok ? true : tryTrusted(); });
  }
  // v1.9.17 只列这个平台有标签的岗位（没有标签的计划量是 0，不显示）
  function plannedJds() { return (P.sortBy ? P.sortBy(st.jds, (st.settings || {}).greetOrder) : st.jds).filter(function (j) { return greetCfg(j).enabled && (!P.onSite || P.onSite(j, SITE || 'boss')); }); }
  function doneOf(jd) { return logToday().counts[jd.id] || 0; }
  function jdFull(jd) { return doneOf(jd) >= greetCfg(jd).quota; }

  // ---------------- 页面读取 ----------------
  // v1.7.8 取最里层真正的按钮（Boss：div.operate-side > … > button.btn-greet），外层 div 上没有点击处理
  function greetButtons() {
    var all = D.qsa('button,a,div,span').filter(function (el) {
      var t = D.textOf(el).replace(/\s+/g, '');
      if (t !== GREET_TXT && t !== '继续沟通') return false;
      if (el.closest('#__hrs_greet__')) return false;
      var r = D.rectOf(el);
      return r.width >= 30 && r.width <= 240 && r.height >= 16 && r.height <= 70 && D.visible(el);
    });
    return all.filter(function (el) {
      return !all.some(function (o) { return o !== el && el.contains(o); });
    }).map(function (el) {
      var b = el.tagName === 'BUTTON' ? el : (el.closest('button') || el);
      return b;
    });
  }
  function cardOf(btn, all) {
    var cur = btn.parentElement;
    while (cur && cur !== document.body) {
      var r = D.rectOf(cur);
      if (r.height > 650) return null;
      if (r.height >= 90 && /\d{2}岁/.test(D.textOf(cur))) {
        var n = (all || greetButtons()).filter(function (b) { return cur.contains(b); }).length;
        return n === 1 ? cur : null;
      }
      cur = cur.parentElement;
    }
    return null;
  }
  var STATUS_RE = /^(刚刚活跃|今日活跃|本周活跃|本月活跃|\d+日内活跃|在线|活跃)$/;
  // v2.9.1 时间段中间的「-」可能是样式画出来的（文字里没有），「2022.092024.01」也认
  var DATE_RE = /^(?:19|20)\d{2}(?:\s*[./年]\s*\d{1,2}月?)?\s*[-–—－~至到]?\s*(?:至今|今|现在|(?:19|20)\d{2}(?:\s*[./年]\s*\d{1,2}月?)?)(?:[（(][^)）]*[)）])?$/;
  /** 时间段统一写成「2022.09-2024.01」 */
  function dtNorm(t) {
    var x = String(t || '').replace(/\s+/g, '');
    var m = x.match(/^((?:19|20)\d{2}(?:[./年]\d{1,2}月?)?)[-–—－~至到]?(至今|今|现在|(?:19|20)\d{2}(?:[./年]\d{1,2}月?)?)(.*)$/);
    return m ? m[1] + '-' + m[2] + m[3] : x;
  }
  /**
   * v2.9.1 卡片右栏按「行」重建工作经历：不靠「·」文字、不靠时间格子是不是一个元素
   * （BOSS 有的卡片工作经历多时用时间轴样式，圆点和横线是画出来的，以前三种读法都读不到，只能「请人工确认」）
   * 右栏从最左边那个「年份开头」的格子算起；同一高度的格子算一行，开头几格拼起来是时间段的就是一段经历
   * 返回 { lines: ['2022.09-2024.01 公司 · 职位', ...], text: [右栏去掉时间以后的文字] }
   */
  function rightColumnRows(card) {
    var cr = D.rectOf(card);
    var all = ownTextEls(card).map(function (o) { return { r: D.rectOf(o.el), t: o.text.replace(/^[·•・|｜\s]+|[·•・|｜\s]+$/g, '') }; })
      .filter(function (x) { return x.r.width > 0 && !/^(打招呼|继续沟通|立即沟通|查看|收藏|举报|不合适)$/.test(x.t.replace(/\s+/g, '')); });
    var yrs = all.filter(function (x) { return /^(?:19|20)\d{2}(?:\s*[./年]\s*\d{1,2})?/.test(x.t); }).map(function (x) { return x.r.left; });
    var x0 = yrs.length ? Math.min.apply(null, yrs) - 4 : cr.left + cr.width * 0.38;
    var items = all.filter(function (x) { return x.r.left >= x0; })
      .sort(function (a, b) { return Math.abs(a.r.top - b.r.top) > 6 ? a.r.top - b.r.top : a.r.left - b.r.left; });
    var rows = [];
    items.forEach(function (x) {
      var mid = x.r.top + x.r.height / 2, L = rows[rows.length - 1];
      if (L && Math.abs(L.mid - mid) <= 10) L.items.push(x); else rows.push({ mid: mid, items: [x] });
    });
    var lines = [], text = [];
    rows.forEach(function (L) {
      var tk = L.items.sort(function (a, b) { return a.r.left - b.r.left; }).map(function (x) { return x.t; }).filter(Boolean);
      if (!tk.length) return;
      var k = 0;
      for (var n = Math.min(4, tk.length); n >= 1; n--) { if (DATE_RE.test(tk.slice(0, n).join('').replace(/\s+/g, ''))) { k = n; break; } }
      var rest = tk.slice(k).filter(function (x) { return !/^[-–—－~至到]$/.test(x); });
      if (rest.length) text.push(rest.join(' · '));
      if (k && rest.length) lines.push(dtNorm(tk.slice(0, k).join('')) + ' ' + rest.join(' · '));
    });
    return { lines: lines, text: text };
  }
  // v1.9.7 直接带文字的元素（文字前面可能还有图标子元素），text 只取它自己的文字
  function ownTextEls(card) {
    var out = [];
    D.qsa('*', card).forEach(function (el) {
      if (el.closest('#__hrs_greet__') || el.closest('.__hrs_gbadge__') || /^(SCRIPT|STYLE)$/i.test(el.tagName)) return;
      var own = '';
      for (var i = 0; i < el.childNodes.length; i++) if (el.childNodes[i].nodeType === 3) own += el.childNodes[i].nodeValue;
      own = own.replace(/\s+/g, ' ').trim();
      if (own && D.visible(el)) out.push({ el: el, text: own });
    });
    return out;
  }
  // v2.6.4 卡片按「行 + 段」读文字：同一高度的格子算一行，横向隔得远（左栏 / 右栏）就分成两段
  function cardSegments(card) {
    var items = ownTextEls(card)
      .map(function (o) { return { r: D.rectOf(o.el), t: o.text }; })
      .filter(function (x) { return x.t && x.r.width > 0; })
      .sort(function (a, b) { return Math.abs(a.r.top - b.r.top) > 6 ? a.r.top - b.r.top : a.r.left - b.r.left; });
    var lines = [];
    items.forEach(function (x) {
      var mid = x.r.top + x.r.height / 2, L = lines[lines.length - 1];
      if (L && Math.abs(L.mid - mid) <= 8) L.items.push(x); else lines.push({ mid: mid, items: [x] });
    });
    var out = [];
    lines.forEach(function (L) {
      L.items.sort(function (a, b) { return a.r.left - b.r.left; });
      var seg = [], lastR = null;
      L.items.forEach(function (x) {
        if (lastR != null && x.r.left - lastR > 40) { out.push(seg.join(' ')); seg = []; }
        seg.push(x.t); lastR = x.r.right;
      });
      if (seg.length) out.push(seg.join(' '));
    });
    return out;
  }
  function parseCard(card) {
    var ls = D.leaves(card).filter(function (el) { return !el.closest('#__hrs_greet__') && !el.closest('.__hrs_gbadge__'); });
    ls.sort(function (a, b) { var ra = D.rectOf(a), rb = D.rectOf(b); return Math.abs(ra.top - rb.top) > 6 ? ra.top - rb.top : ra.left - rb.left; });
    var texts = ls.map(function (el) { return D.textOf(el).replace(/\s+/g, ' ').trim(); });
    var name = '';
    for (var i = 0; i < texts.length && !name; i++) {
      var t = texts[i];
      if (/^[\u4e00-\u9fa5A-Za-z·.]{1,12}$/.test(t) && !STATUS_RE.test(t) && !/^(期望|最近关注|优势|打招呼|继续沟通|面议)$/.test(t)) name = t;
    }
    // 期望：期望 | 苏州 · 数字IC验证工程师
    var city = '', expectJob = '';
    var ei = texts.indexOf('期望');
    // v1.9.28 Boss 有的卡片不写「期望」，写「最近关注 上海 · C/C++」，一样当期望城市 / 职位读
    if (ei < 0) ei = texts.indexOf('最近关注');
    // 猎聘：「期望: 长沙 硬件工程师 12-14K·14薪」是一整格
    var lpE = ei < 0 ? texts.filter(function (t) { return /^期望[:：]\s*\S/.test(t); })[0] : '';
    if (lpE) { var tk = lpE.replace(/^期望[:：]\s*/, '').split(/\s+/); city = tk[0] || ''; expectJob = tk[1] || ''; }
    if (ei >= 0) {
      var er = D.rectOf(ls[ei]), mid = er.top + er.height / 2;
      var cand = ls.filter(function (el, k) { var r = D.rectOf(el); return k !== ei && r.left > er.right - 2 && Math.abs(r.top + r.height / 2 - mid) <= 8; })
        .sort(function (x, y) { return D.rectOf(x).left - D.rectOf(y).left; });
      var row = [], lastR = er.right;
      for (var q = 0; q < cand.length; q++) {
        var rr = D.rectOf(cand[q]);
        if (rr.left - lastR > 80) break;   // 右边那一栏（工作经历）不算
        var tx = D.textOf(cand[q]).replace(/^[·•・\s]+|[·•・\s]+$/g, '');
        if (tx) row.push(tx);
        lastR = rr.right;
      }
      city = row[0] || ''; expectJob = row.slice(1).join(' ');
    }
    // 工作经历按行：时间段 + 右边同一行的文字
    // v1.7.2 时间段那一格常带一个小图标（公文包 / 学士帽），所以不能只找「没有子元素」的格子：
    // 找文字整体就是时间段、宽度不大的元素，取最里层那个
    var dateEls = D.qsa('*', card).filter(function (el) {
      if (el.closest('#__hrs_greet__') || !D.visible(el)) return false;
      var t = D.textOf(el).replace(/\s+/g, '');
      if (!DATE_RE.test(t)) return false;
      return D.rectOf(el).width < 300;
    });
    dateEls = dateEls.filter(function (el) { return !dateEls.some(function (o) { return o !== el && el.contains(o); }); });
    var workLines = [];
    // v2.6.9 右边的公司、职位按「元素自己的文字」取：BOSS 的「公司 · 职位」那一格里夹着一个小圆点元素，
    // 以前只取没有子元素的格子，整格被跳过，工作经历读不到，只能按卡片文字（含技能标签）去猜
    var own = ownTextEls(card);
    dateEls.forEach(function (d) {
      var dt = dtNorm(D.textOf(d));
      var dr = D.rectOf(d), m = dr.top + dr.height / 2;
      var cand = own.filter(function (o) { var r = D.rectOf(o.el); return !d.contains(o.el) && !o.el.contains(d) && r.left >= dr.right - 2 && Math.abs(r.top + r.height / 2 - m) <= 12; })
        .sort(function (a, b) { return D.rectOf(a.el).left - D.rectOf(b.el).left; });
      var parts = [], lastR = dr.right;
      for (var k = 0; k < cand.length; k++) {
        var rr = D.rectOf(cand[k].el);
        // v2.6.6 宽屏时时间列和公司列中间空得很开（以前超过 120 像素就当成不是同一行，整段工作经历读不到）：
        // 时间后面的第一格放宽到 480 像素，公司和职位之间仍按 120 像素
        if (rr.left - lastR > (parts.length ? 120 : Math.max(480, D.rectOf(card).width * 0.4))) break;
        if (/^(打招呼|继续沟通|立即沟通|查看|收藏)$/.test(cand[k].text.replace(/\s+/g, ''))) break;
        var x = cand[k].text.replace(/^[·•・\s]+|[·•・\s]+$/g, '');
        if (x && !/^[·•・|｜]+$/.test(x)) parts.push(x);
        lastR = rr.right;
      }
      if (!parts.length) {
        // 猎聘：「公司 职位 2025.08-至今(1年2个月)」时间在右边，往左取同一行
        // v1.9.7 公司名那一格前面有公司小图标，不是「没有子元素」的格子：改为找直接带文字的元素，只取它自己的文字
        // v1.9.8 从时间那一格往左一格一格取，挨着的才算同一行（左栏的期望、年龄不会挨着）。
        // 原来按「卡片宽度 35% 以右」截，卡片很宽，把最左边的公司名截掉了
        var same = ownTextEls(card).filter(function (o) { var r = D.rectOf(o.el); return !d.contains(o.el) && !o.el.contains(d) && r.right <= dr.left + 2 && Math.abs(r.top + r.height / 2 - m) <= 9; })
          .sort(function (a, b) { return D.rectOf(b.el).right - D.rectOf(a.el).right; });
        var left = [], edge = dr.left;
        for (var z = 0; z < same.length; z++) {
          var rz = D.rectOf(same[z].el);
          if (edge - rz.right > 60) break;
          var tz = same[z].text.replace(/^[·•・\s]+|[·•・\s]+$/g, '');
          if (tz && !/^[·•・|｜]+$/.test(tz)) left.unshift(tz);
          edge = rz.left;
        }
        parts = left;
      }
      if (parts.length) workLines.push(dt + ' ' + parts.join(' · '));
    });
    var summary = texts.filter(function (t) { return !/^(打招呼|立即沟通|继续沟通)$/.test(t); }).join(' | ');
    // 兜底：整张卡片按行的文字（时间段格子带图标时，上面按格子拼的文字里会缺时间段）
    var plain = String(card.innerText || '').replace(/打招呼|立即沟通|继续沟通/g, '').trim();
    if (plain) summary += '\n' + plain;
    var truncated = workLines.some(function (l) { return /…|\.\.\.$/.test(l); });
    return { name: name || '候选人', city: city, expectJob: expectJob, workLines: workLines, summary: summary, truncated: truncated };
  }
  // 用左边一定会显示的信息做身份：姓名 + 年龄 + 期望城市 + 期望职位（右边工作经历可能还没渲染）
  function keyOf(info) { return [info.name, (info.summary.match(/\d{2}岁/) || [''])[0], info.city, info.expectJob].join('|'); }

  // ---------------- v1.7.5 职位下拉 / 筛选面板（可能和卡片不在同一个内嵌页面里，所以走「所有页面一起找」） ----------------
  var SAL_RE = /\d+\s*-\s*\d+\s*[kK千万]|元\/天|元\/月|面议/;
  // 右上角当前职位：「ic验证工程师 _ 苏州 25-35K」。下划线可能是全角，也可能没有，所以再用岗位名单去认
  function jobLabelEl(wants) {
    var ws = (wants || []).map(D.norm).filter(Boolean);
    var c = D.qsa('div,span,p,a,button,em').filter(function (el) {
      if (el.closest('#__hrs_greet__')) return false;
      var t = D.textOf(el);
      if (!t || t.length > 60 || t.indexOf('\n') >= 0) return false;
      var r = D.rectOf(el);
      if (!D.visible(el) || r.top > 200 || r.height > 60 || r.width < 60) return false;
      var n = D.norm(t);
      return /[_＿]/.test(t) && SAL_RE.test(t) || ws.some(function (w) { return n.indexOf(w) === 0; });
    });
    // 打开的下拉列表里也有同样文字的选项，排除掉：只要最靠上的那一个
    c.sort(function (a, b) { return D.rectOf(a).top - D.rectOf(b).top || D.textOf(a).length - D.textOf(b).length; });
    var top = c[0];
    if (!top) return null;
    return c.filter(function (el) { return Math.abs(D.rectOf(el).top - D.rectOf(top).top) < 6; })
      .sort(function (a, b) { return D.textOf(a).length - D.textOf(b).length; })[0];
  }
  function chipIn(row, text) {
    return D.qsa('*', row).filter(function (el) { return D.visible(el) && D.textOf(el).replace(/\s+/g, '') === text && el.children.length <= 1; })
      .sort(function (a, b) { return D.rectOf(a).width - D.rectOf(b).width; })[0] || null;
  }
  function rowOf(labelText) {
    var lab = D.qsa('*').filter(function (el) { return el.children.length === 0 && D.visible(el) && D.textOf(el).replace(/\s+/g, '').indexOf(labelText) === 0; })[0];
    if (!lab) return null;
    var cur = lab.parentElement;
    while (cur && cur !== document.body) {
      if (D.textOf(cur).replace(/\s+/g, '').length > labelText.length + 6 && D.rectOf(cur).width > 400) return cur;
      cur = cur.parentElement;
    }
    return null;
  }
  var EXP_BINS = [['1年以内', 0, 1], ['1-3年', 1, 3], ['3-5年', 3, 5], ['5-10年', 5, 10], ['10年以上', 10, 99]];
  var EDU_CHIPS = ['初中及以下', '中专/中技', '高中', '大专', '本科', '硕士', '博士'];
  var EDU_FROM = { 2: 3, 3: 4, 4: 5, 5: 6 };   // 基础条件里的学历 → 从哪个选项开始选
  function filterSpec(jd) {
    var b = P.baseOf(jd, st.jds);
    var exp = parseInt(b.exp, 10), spec = { exp: [], edu: [] };
    var bins = SITE === 'liepin' ? LP_EXP : EXP_BINS;
    if (isFinite(exp) && exp > 0) spec.exp = bins.filter(function (x) { return x[2] > exp; }).map(function (x) { return x[0]; });
    if (EDU_FROM[b.edu] != null) spec.edu = SITE === 'liepin' ? ['大专', '本科', '硕士', 'MBA/EMBA', '博士'].slice(b.edu - 2) : EDU_CHIPS.slice(EDU_FROM[b.edu]);
    return spec;
  }
  // ---------------- v1.9.3 猎聘：职位是上方一排标签 + 「更多」下拉；筛选是右侧抽屉 ----------------
  // v1.9.32 猎聘标签上叠着「高交付」这类角标，读名字时去掉，不然和职位名对不上
  function stripDots(t) { return String(t || '').replace(/\s+/g, '').replace(/高交付|急聘|热招|紧急|置顶|NEW|HOT/gi, '').replace(/(\.\.\.|…)$/, ''); }
  // v1.9.31 猎聘同名职位（编译器开发工程师(LLVM) 苏州 / 上海-浦东）标签被截断后一模一样，要靠城市区分
  var CITY_RE = /(北京|上海|北京|深圳|杭州|南京|无锡|合肥|成都|西安|武汉|广州|天津|重庆|厦门|宁波|长沙|珠海|东莞|青岛|大连|新加坡)/g;
  function jdCity(j) {
    var m = (String(j.title || '') + ' ' + String(j.greetJob || '')).match(CITY_RE);
    return m ? m[m.length - 1] : '';
  }
  // 标签的完整名字：先看 title 属性，没有就把鼠标移上去读弹出的提示（「编译器开发工程师(LLVM) · 上海-浦东」）
  // v1.9.44 只认「贴着这个标签」的提示框：上一个标签的提示框可能还没消失，不能读成这个标签的
  var tabCityCache = {};
  function tabFull(el) {
    var t = el.getAttribute('title') || (el.parentElement && el.parentElement.getAttribute('title')) || '';
    if (t) return Promise.resolve(t);
    var base = D.norm(stripDots(D.textOf(el)));
    var er = D.rectOf(el), ec = (er.left + er.right) / 2;
    var key = base + '@' + Math.round(er.left / 20);
    if (tabCityCache[key]) return Promise.resolve(tabCityCache[key]);
    var pick = function () {
      return D.qsa('div,span,p').filter(function (x) {
        if (el.contains(x) || x.closest('#__hrs_greet__') || x.children.length > 2 || !D.visible(x)) return false;
        var n = D.norm(D.textOf(x));
        if (!(base.length >= 3 && n.indexOf(base) === 0 && n.length > base.length + 1 && n.length < base.length + 60)) return false;
        var r = D.rectOf(x);
        return Math.abs((r.left + r.right) / 2 - ec) < 150 && r.top < er.bottom + 120 && r.bottom > er.top - 120;
      }).sort(function (a, b) { var ra = D.rectOf(a), rb = D.rectOf(b); return Math.abs((ra.left + ra.right) / 2 - ec) - Math.abs((rb.left + rb.right) / 2 - ec) || D.textOf(a).length - D.textOf(b).length; })[0];
    };
    D.leave(el);
    return D.sleep(250).then(function () { return D.hover(el); }).then(function () { return D.sleep(600); }).then(function () {
      var tip = pick();
      if (tip) return tip;
      return D.sleep(600).then(pick);
    }).then(function (tip) {
      D.leave(el);
      if (!tip) return D.textOf(el);
      var full = D.textOf(tip);
      tabCityCache[key] = full;
      return full;
    });
  }
  function lpTabs() {
    var ws = st.jds.map(function (j) { return D.norm(P.nameOn ? P.nameOn(j, 'liepin') : (j.platformJob || j.title)); });
    return D.qsa('div,span,a,li').filter(function (el) {
      if (el.closest('#__hrs_greet__') || el.children.length > 2 || !D.visible(el)) return false;
      var r = D.rectOf(el); if (r.top > 140 || r.height > 50) return false;
      var h = D.norm(stripDots(D.textOf(el)));
      return h.length >= 2 && ws.some(function (w) { return w.indexOf(h) === 0; });
    }).filter(function (el, i, arr) { return !arr.some(function (o) { return o !== el && el.contains(o); }); });
  }
  // v1.9.4 当前标签：class 带 active，或者样式（底色 / 字色）和其他标签都不一样的那个
  var lpLast = '', lpLastEl = null;
  function sig(el) {
    var x = el, out = '';
    for (var i = 0; i < 2 && x; i++) { var cs = getComputedStyle(x); out += cs.backgroundColor + '|' + cs.color + '|' + cs.fontWeight + ';'; x = x.parentElement; }
    return out;
  }
  function lpActive(tabs) {
    var byCls = tabs.filter(function (el) {
      var c = String(el.className || '') + ' ' + String((el.parentElement && el.parentElement.className) || '');
      return /active|selected|cur(rent)?\b|checked/i.test(c);
    });
    if (byCls.length === 1) return byCls[0];
    if (tabs.length >= 3) {
      var cnt = {};
      tabs.forEach(function (el) { var k = sig(el); cnt[k] = (cnt[k] || 0) + 1; });
      var uniq = tabs.filter(function (el) { return cnt[sig(el)] === 1; });
      if (uniq.length === 1) return uniq[0];
    }
    if (lpLastEl && lpLastEl.isConnected && tabs.indexOf(lpLastEl) >= 0) return lpLastEl;
    if (lpLast) return tabs.filter(function (el) { return D.norm(stripDots(D.textOf(el))) === lpLast; })[0] || null;
    return null;
  }
  function lpDialog() {
    return D.qsa('[class*="modal"],[class*="dialog"],[role="dialog"]').filter(function (el) { return D.visible(el) && D.rectOf(el).width > 200 && !el.closest('#__hrs_greet__'); })[0] || null;
  }
  // ---------------- v1.9.6 猎聘「立即沟通」之后 ----------------
  function vis(el) { return el && D.visible(el) && !el.closest('#__hrs_greet__'); }
  // v1.9.30 关弹窗：Boss 简历详情的 × 在弹窗外框右上角（可能在内容框外面），找的范围放大；
  // 脚本点了没关掉再用真实鼠标点，最后按 Esc
  function closeXFor(box) {
    var br = D.rectOf(box);
    var c = D.qsa('*', box).concat(D.qsa('[class*="close"],[class*="Close"],[aria-label*="关闭"],[title*="关闭"],svg,i')).filter(function (el) {
      if (!vis(el)) return false;
      var r = D.rectOf(el), t = D.textOf(el).replace(/\s+/g, '');
      var cls = String(el.className && el.className.baseVal != null ? el.className.baseVal : el.className || '');
      return r.width <= 48 && r.height <= 48 && r.left >= br.right - 140 && r.left <= br.right + 80 && r.top <= br.top + 80 && r.top >= br.top - 70 &&
        (t === '' || t === '×' || t === '✕' || t === '✖' || /close/i.test(cls)) && !/免费|开聊|确定|发送|收藏|转发|举报|不合适/.test(t);
    });
    c.sort(function (p, q) {
      var cp = /close/i.test(String(p.className && p.className.baseVal != null ? p.className.baseVal : p.className || '')) ? 0 : 1;
      var cq = /close/i.test(String(q.className && q.className.baseVal != null ? q.className.baseVal : q.className || '')) ? 0 : 1;
      return cp - cq || D.rectOf(p).top - D.rectOf(q).top || D.rectOf(q).right - D.rectOf(p).right;
    });
    var x = c[0] || null;
    return x ? (x.closest('button,a,[class*="close"]') || x) : null;
  }
  function closeBox(box) {
    var gone = function () { return !box.isConnected || !D.visible(box); };
    var x = closeXFor(box);
    var p = x ? D.click(x).then(function () { return D.sleep(D.rand(500, 800)); }) : Promise.resolve();
    return p.then(function () {
      if (gone() || !x) return;
      return D.trustedClick(x).then(function () { return D.sleep(700); });
    }).then(function () {
      if (gone()) return;
      D.pressEscape();
      return D.sleep(500);
    });
  }
  // 「已向 X 发送打招呼语」这类成功弹窗（里面还有「免费开聊相似候选人」，绝不点）
  function lpSentHit() {
    return D.qsa('div,span,h3,h4,p').filter(function (el) { return el.children.length <= 2 && vis(el) && /已向.{1,12}发送打招呼语|打招呼语已发送/.test(D.textOf(el)); })[0] || null;
  }
  function lpSentPopup() {
    var hit = lpSentHit();
    if (!hit) return null;
    // v1.9.7 优先取弹窗本体（antd 的 modal 层），取不到再往外找到够宽的一层
    var modal = hit.closest('[class*="modal-content"],[role="dialog"],[class*="ant-lpt-modal"]:not([class*="wrap"]):not([class*="root"]),[class*="modal"]:not([class*="wrap"]):not([class*="root"]):not([class*="mask"])');
    if (modal && D.rectOf(modal).width >= 300 && D.rectOf(modal).width < window.innerWidth * 0.9) return modal;
    var cur = hit;
    while (cur.parentElement && cur.parentElement !== document.body && D.rectOf(cur).width < 400) cur = cur.parentElement;
    return cur;
  }
  // v1.9.7 叉掉「已向 X 发送打招呼语」：先点弹窗自带的关闭按钮，没关掉换真实鼠标点，再按 Esc；关不掉就返回 false
  function closeSentPopup() {
    var box = lpSentPopup();
    if (!box) return Promise.resolve(true);
    var gone = function () { return !lpSentHit(); };
    var xOf = function () {
      var b = lpSentPopup();
      if (!b) return null;
      var scope = b.closest('[class*="modal"]:not([class*="wrap"]):not([class*="root"]):not([class*="mask"])') || b;
      var own = D.qsa('[class*="modal-close"],[aria-label="Close"],[aria-label="close"],[aria-label="关闭"]', scope).filter(vis)[0];
      return own || closeXIn(b);
    };
    var x = xOf();
    var p = x ? D.click(x) : Promise.resolve();
    return p.then(function () { return D.waitFor(gone, 1500); }).then(function (ok) {
      if (ok) return true;
      var x2 = xOf();
      if (!x2) return false;
      return D.trustedClick(x2).then(function () { return D.waitFor(gone, 1500); });
    }).then(function (ok) {
      if (ok) return true;
      D.pressEscape();
      return D.waitFor(gone, 1200).then(function (v) { return !!v; });
    });
  }
  function closeXIn(box) { return closeXFor(box); }
  // 打开了聊天小窗：有「请输入文字」的输入框
  function lpChat() {
    var inp = D.qsa('textarea,[contenteditable="true"],input').filter(function (el) {
      return vis(el) && /请输入文字|按Enter/.test((el.getAttribute('placeholder') || '') + (el.getAttribute('data-placeholder') || '') + D.textOf(el.parentElement || el));
    })[0];
    if (!inp) return null;
    var box = inp, n = 0;
    while (box.parentElement && n++ < 12 && !/沟通职位/.test(D.textOf(box))) box = box.parentElement;
    return { input: inp, box: /沟通职位/.test(D.textOf(box)) ? box : inp.parentElement };
  }
  function typeText(el, text) {
    el.focus();
    if (el.tagName === 'TEXTAREA' || el.tagName === 'INPUT') {
      var proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      try { Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, text); } catch (e) { el.value = text; }
    } else { el.innerText = text; }
    ['input', 'change'].forEach(function (t) { el.dispatchEvent(new Event(t, { bubbles: true })); });
  }
  function greetMsgFor(jd) { return String(((jd.greet || {}).msg) || st.settings.greetMsgDefault || '').trim(); }
  // v1.9.44 Boss 打完招呼也发这个职位的打招呼语：点「继续沟通」打开聊天窗口 → 发送 → 关掉
  function bossChat() {
    var inp = D.qsa('textarea,[contenteditable="true"]').filter(function (el) { return vis(el) && !el.closest('#__hrs_ui__'); })[0];
    if (!inp) return null;
    var box = inp, n = 0;
    while (box.parentElement && n++ < 12) { var r = D.rectOf(box); if (r.width > 320 && r.height > 260) break; box = box.parentElement; }
    return { input: inp, box: box };
  }
  function bossAfterGreet(jd, btn) {
    var msg = greetMsgFor(jd);
    if (!msg) return Promise.resolve(null);
    var href = location.href;
    return D.sleep(D.rand(800, 1200)).then(function () {
      if (!btn.isConnected || !/^继续沟通$/.test(D.textOf(btn).replace(/\s+/g, ''))) return { ok: false, note: '没看到「继续沟通」，只发了 Boss 账号的默认招呼语' };
      return D.click(btn).then(function () { return D.waitFor(bossChat, 4000); }).then(function () {
        if (location.href !== href) { history.back(); return { ok: false, note: '点「继续沟通」跳走了页面，已返回，打招呼语没发' }; }
        var chat = bossChat();
        if (!chat) { var dlg = lpDialog(); return (dlg ? closeBox(dlg) : Promise.resolve()).then(function () { return { ok: false, note: '点「继续沟通」没打开聊天窗口，只发了 Boss 账号的默认招呼语' }; }); }
        // v1.9.48 Boss + RPA：真实键盘逐字输入，打不进去就不发，关掉窗口
        return typeInto(chat.input, msg).then(function (typed) {
          if (!typed) return closeBox(chat.box).then(function () { return { ok: false, note: 'RPA 没能输入打招呼语（' + (st.lastRpaWhy || (st.rpaHold && st.rpaHold.why) || '') + '），只发了 Boss 账号的默认招呼语' }; });
          return D.sleep(D.rand(400, 700)).then(function () {
            var send = D.qsa('button,span,div,a', chat.box).filter(function (el) { return vis(el) && el.children.length <= 1 && D.textOf(el).replace(/\s+/g, '') === '发送'; })[0];
            if (send) return D.click(send);
            return pressEnter(chat.input);
          }).then(function () { return D.sleep(D.rand(900, 1300)); }).then(function () {
            var c2 = bossChat();
            return (c2 ? closeBox(c2.box) : Promise.resolve()).then(function () { return { ok: true, note: '已发送打招呼语' }; });
          });
        });
      });
    });
  }
  function lpAfterGreet(jd) {
    return D.sleep(D.rand(1000, 1600)).then(function () {
      var note = '', ok = true;
      var chain = Promise.resolve();
      var chat = lpChat();
      var msg = greetMsgFor(jd);
      if (chat && msg) {
        chain = chain.then(function () {
          typeText(chat.input, msg);
          return D.sleep(D.rand(400, 700));
        }).then(function () {
          var send = D.qsa('button,span,div,a', chat.box).filter(function (el) { return vis(el) && el.children.length <= 1 && D.textOf(el).replace(/\s+/g, '') === '发送'; })[0];
          if (send) return D.click(send).then(function () { note = '已发送打招呼语'; return D.sleep(D.rand(800, 1200)); });
          chat.input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true }));
          note = '已发送打招呼语（回车）';
          return D.sleep(D.rand(800, 1200));
        });
      } else if (chat) { note = '打开了聊天窗口，这个职位没设打招呼语，只关掉窗口'; ok = false; }
      return chain.then(function () {
        // v1.9.7 弹窗可能晚一点才出来：最多等 3 秒；出来了一定要确认关掉
        return D.waitFor(function () { return lpSentHit() || lpChat(); }, 3000);
      }).then(function () {
        if (!lpSentHit()) return;
        return closeSentPopup().then(function (closed) {
          if (!closed) { ok = false; note = (note ? note + '；' : '') + '「已发送打招呼语」弹窗没关掉'; st.popupStuck = true; }
        });
      }).then(function () {
        var c2 = lpChat();
        if (c2) return closeBox(c2.box);
      }).then(function () {
        var other = lpDialog();
        if (other && !lpSentHit()) return closeBox(other);   // 其他弹窗：一般叉掉
      }).then(function () { return { ok: ok, note: note }; });
    });
  }
  var LP_EXP = [['1年以下', 0, 1], ['1-3年', 1, 3], ['3-5年', 3, 5], ['5-10年', 5, 10], ['10年以上', 10, 99]];
  var lpOps = {
    label: function () {
      var tabs = lpTabs(), a = lpActive(tabs);
      if (!a) return null;
      var short = D.norm(stripDots(D.textOf(a)));
      // 有同名标签时才去读完整名字（带城市）
      var same = tabs.filter(function (x) { return D.norm(stripDots(D.textOf(x))) === short; }).length > 1;
      return (same ? tabFull(a) : Promise.resolve(D.textOf(a))).then(function (t) { return { text: stripDots(t) }; });
    },
    select: function (a) {
      var want = D.norm(a.want);
      var hits = lpTabs().filter(function (el) { return want.indexOf(D.norm(stripDots(D.textOf(el)))) === 0; });
      var hit = hits[0];
      var p = Promise.resolve(hit);
      // v1.9.31 同名的有好几个：挨个读完整名字，挑带这个岗位城市的
      if (hits.length > 1 && a.city) {
        // v1.9.44 挨个读完整名字：带这个城市的直接选；都读不出城市时，排除明确是别的城市的那个
        var fulls = [];
        p = hits.reduce(function (pp, el) {
          return pp.then(function (found) {
            if (found) return found;
            return tabFull(el).then(function (t) { fulls.push({ el: el, t: t }); return t.indexOf(a.city) >= 0 ? el : null; });
          });
        }, Promise.resolve(null)).then(function (el) {
          if (el) return el;
          var other = function (t) { var m = String(t).match(CITY_RE) || []; return m.some(function (c) { return c !== a.city; }); };
          var rest = fulls.filter(function (f) { return !other(f.t); });
          return rest.length ? rest[0].el : null;
        });
      }
      if (!hit) {
        var more = D.qsa('div,span,a').filter(function (el) { return el.children.length <= 2 && D.visible(el) && D.rectOf(el).top < 140 && /^更多/.test(D.textOf(el).replace(/\s+/g, '')); })[0];
        if (!more) return Promise.resolve({ ok: false, why: '职位标签里没有「' + a.want + '」' });
        p = D.click(more).then(function () { return D.sleep(D.rand(600, 900)); }).then(function () {
          return D.qsa('li,div,span,a').filter(function (el) { return el.children.length <= 1 && D.visible(el) && want.indexOf(D.norm(stripDots(D.textOf(el)))) === 0 && D.norm(stripDots(D.textOf(el))).length >= 3 && D.rectOf(el).top > 100; })[0] || null;
        });
      }
      return p.then(function (el) {
        if (!el && hits.length > 1) return { ok: false, why: '同名职位有 ' + hits.length + ' 个，读不出哪个是「' + a.city + '」的' };
        if (!el) { D.pressEscape(); return { ok: false, why: '职位标签和「更多」里都没有「' + a.want + '」' }; }
        lpLast = D.norm(stripDots(D.textOf(el)));
        lpLastEl = el;
        return D.click(el).then(function () { return D.sleep(D.rand(1500, 2500)); }).then(function () { return { ok: true }; });
      });
    },
    filter: function (a) {
      var btn = D.qsa('div,span,a,button').filter(function (el) { return el.children.length <= 2 && D.visible(el) && D.textOf(el).replace(/\s+/g, '') === '筛选' && !el.closest('#__hrs_greet__'); })[0];
      if (!btn) return Promise.resolve({ ok: false, why: '没找到「筛选」' });
      var panel = function () { return rowOf('工作经验') || rowOf('学历要求'); };
      if (ui) ui.style.visibility = 'hidden';   // 浮层别挡住抽屉底部的按钮
      var unhide = function (r) { if (ui) ui.style.visibility = ''; return r; };
      return clickVerified(btn, panel, 3000, a.trusted).then(function (ok) {
        if (!ok) { D.pressEscape(); return { ok: false, why: '筛选抽屉没打开' }; }
        var clear = D.qsa('button,div,span,a').filter(function (el) { return el.children.length <= 1 && D.visible(el) && /^(重置|清空|清除)$/.test(D.textOf(el).replace(/\s+/g, '')); })[0];
        var applied = [];
        var p = clear ? D.click(clear).then(function () { return D.sleep(500); }) : Promise.resolve();
        var pick = function (rowName, list) {
          return list.reduce(function (pp, text) {
            return pp.then(function () { var row = rowOf(rowName), chip = row && chipIn(row, text); if (!chip) return; applied.push(text); return D.click(chip).then(function () { return D.sleep(D.rand(250, 500)); }); });
          }, Promise.resolve());
        };
        return p.then(function () { return pick('工作经验', a.spec.exp || []); }).then(function () { return pick('学历要求', a.spec.edu || []); }).then(function () {
          // 「确定」在抽屉最下面，可能要滚动才看得见：按位置找，滚进视野再点
          var okBtn = D.qsa('button,div,span,a').filter(function (el) { var r = D.rectOf(el); return el.children.length <= 1 && r.width > 0 && r.height > 0 && r.left > window.innerWidth * 0.5 && /^(确定|确认)$/.test(D.textOf(el).replace(/\s+/g, '')) && !el.closest('#__hrs_greet__'); })
            .sort(function (x, y) { return D.rectOf(y).top - D.rectOf(x).top; })[0];
          if (okBtn) {
            var b2 = okBtn.closest('button') || okBtn;
            try { b2.scrollIntoView({ block: 'center' }); } catch (e) {}
            return D.sleep(400).then(function () { return D.click(b2); }).then(function () { return { ok: true, applied: applied }; });
          }
          // 猎聘抽屉可能是点了就生效、没有确定：关掉抽屉
          var x = D.qsa('*').filter(function (el) { var r = D.rectOf(el); return D.visible(el) && r.width < 40 && r.height < 40 && r.top < 60 && r.left > window.innerWidth - 80 && /^(×|✕|)$/.test(D.textOf(el).trim()); })[0];
          return (x ? D.click(x) : Promise.resolve(D.pressEscape())).then(function () { return { ok: true, applied: applied, why: '没找到「确定」，已关掉抽屉' }; });
        });
      }).then(unhide, function (e) { unhide(); throw e; });
    }
  };
  // ---------------- v1.9.13 页面收尾：下拉框 / 筛选面板 / 简历详情 ----------------
  // Boss 职位下拉开着时，页面上的下一次点击会被当成「点空白处收起下拉」，打招呼按钮就点不动；
  // 切换失败时的点击还可能落到候选人卡片上打开简历。所以切换后、点卡片前都要确认页面是干净的。
  function dropOpen() {
    var sb = D.qsa('input').filter(function (i) { return D.visible(i) && !i.closest('#__hrs_greet__') && /职位名称|搜索职位|输入职位/.test(i.getAttribute('placeholder') || ''); })[0];
    if (sb) return sb;
    return D.qsa('[class*="dropmenu-visible"],[class*="dropmenu"][class*="expanding"],[class*="dropdown"][class*="open"],[class*="select-dropdown"]:not([class*="hidden"])').filter(function (el) {
      return D.visible(el) && !el.closest('#__hrs_greet__') && D.rectOf(el).height > 40;
    })[0] || null;
  }
  function blankPoint() {
    // 页面左上角的空白处（不点任何控件）
    var x = 8, y = Math.min(140, window.innerHeight - 10);
    var t = document.elementFromPoint ? document.elementFromPoint(x, y) : null;
    return t || document.body;
  }
  function closeDrop(lab) {
    if (!dropOpen()) return Promise.resolve(true);
    D.pressEscape();
    return D.waitFor(function () { return !dropOpen(); }, 800).then(function (ok) {
      if (ok) return true;
      var p = lab && D.visible(lab) ? D.click(lab) : Promise.resolve();
      return p.then(function () { return D.waitFor(function () { return !dropOpen(); }, 1000); });
    }).then(function (ok) {
      if (ok) return true;
      var b = blankPoint();
      if (useRpa()) {
        // v1.9.48 真实鼠标点页面左上角空白处
        return D.rpaClickAt(8, Math.min(140, window.innerHeight - 10)).then(function () { return D.waitFor(function () { return !dropOpen(); }, 1000); }).then(function (v) { return !!v; });
      }
      try { ['mousedown', 'mouseup', 'click'].forEach(function (t) { b.dispatchEvent(new MouseEvent(t, { bubbles: true, cancelable: true, view: window, clientX: 8, clientY: 140 })); }); } catch (e) {}
      return D.waitFor(function () { return !dropOpen(); }, 1000).then(function (v) { return !!v; });
    });
  }
  function popupOpen() {
    // 简历详情 / 其他弹窗：页面上盖着的大块弹层
    return D.qsa('[class*="dialog"],[class*="modal"],[role="dialog"],[class*="resume-detail"],[class*="geek-detail"],[class*="boss-popup"],[class*="drawer"]').filter(function (el) {
      if (!D.visible(el) || el.closest('#__hrs_greet__')) return false;
      var r = D.rectOf(el);
      return r.width > 360 && r.height > 260 && !/mask|wrap|root/i.test(String(el.className && el.className.baseVal != null ? el.className.baseVal : el.className || ''));
    }).sort(function (a, b) { var ra = D.rectOf(a), rb = D.rectOf(b); return rb.width * rb.height - ra.width * ra.height; })[0] || null;   // v1.9.30 取最外面那个大弹层
  }
  // v1.9.46 平台广告弹窗（猎聘「AI-Pro 账号特权」这类）：× 常在广告图上方较远处，范围放大找；还关不掉就把广告层隐藏
  function isAdBox(pp) {
    var t = D.textOf(pp);
    if (/简历|沟通职位|工作经历|工作经验|学历要求|筛选|发送|打招呼语/.test(t)) return false;
    return t.replace(/\s+/g, '').length < 80 || /广告|特权|限时|领取|开通|优惠|活动|查看.{0,6}权益/.test(t);
  }
  function wideClose(pp) {
    var r = D.rectOf(pp);
    var c = D.qsa('*').filter(function (el) {
      if (!D.visible(el) || el.closest('#__hrs_greet__,#__hrs_ui__')) return false;
      var b = D.rectOf(el);
      if (b.width < 12 || b.width > 56 || b.height < 12 || b.height > 56) return false;
      if (b.left < r.left - 160 || b.right > r.right + 160 || b.top < r.top - 260 || b.bottom > r.bottom + 160) return false;
      var t = D.textOf(el).replace(/\s+/g, ''), cls = String(el.className && el.className.baseVal != null ? el.className.baseVal : el.className || '');
      return /close|guanbi|shut/i.test(cls) || /^[×✕✖⊗]$/.test(t);
    });
    return c[0] ? (c[0].closest('button,a,[class*="close"]') || c[0]) : null;
  }
  function hideAd(pp) {
    var top = pp;
    for (var p = pp; p && p !== document.body; p = p.parentElement) { if (getComputedStyle(p).position === 'fixed') top = p; }
    try { top.style.setProperty('display', 'none', 'important'); } catch (e) { return false; }
    // 广告下面常有一层半透明遮罩，一起藏掉
    D.qsa('[class*="mask"],[class*="overlay"]').forEach(function (m) { if (D.visible(m) && !m.closest('#__hrs_greet__') && D.rectOf(m).width > window.innerWidth * 0.8) { try { m.style.setProperty('display', 'none', 'important'); } catch (e) {} } });
    return true;
  }
  function cleanHere() {
    var d = dropOpen(), pp = popupOpen();
    if (!d && !pp) return null;
    var what = d ? '展开的下拉框 / 筛选面板' : (isAdBox(pp) ? '平台广告弹窗' : '弹窗或简历详情');
    var gone = function () { return D.waitFor(function () { return !popupOpen(); }, 1500).then(function (v) { return !!v; }); };
    var p = d ? closeDrop(jobLabelEl(wantsList())) : closeBox(pp).then(gone).then(function (ok) {
      if (ok || !pp.isConnected) return true;
      var x = wideClose(pp);
      return (x ? D.click(x).then(function () { return D.sleep(600); }).then(gone) : Promise.resolve(false)).then(function (ok2) {
        if (ok2) return true;
        if (isAdBox(pp) && hideAd(pp)) { what = '平台广告弹窗（关不掉，已隐藏）'; return gone(); }
        return false;
      });
    });
    return p.then(function (ok) { return { ok: !!ok, what: what }; });
  }
  // 在「本页面」里执行。找不到目标就返回 null，交给别的页面
  if (window !== window.top) { lpOps = { label: function () { return null; }, select: function () { return null; }, filter: function () { return null; } }; }
  var ops = SITE === 'liepin' ? lpOps : {
    label: function (a) { var el = jobLabelEl(a.wants); return el ? Promise.resolve({ text: D.textOf(el) }) : null; },
    select: function (a) {
      var lab0 = jobLabelEl(a.wants);
      if (!lab0) return null;
      // v1.7.10 下拉选项列表就在职位框里面（job-selecter-wrap 包着 ui-dropmenu-list）。
      // 只拿最里层显示职位名的那一格当「职位框」，否则所有选项都会被当成职位框自己而排除掉
      var firstLine = D.textOf(lab0).split('\n')[0].trim();
      var lab = [lab0].concat(D.qsa('*', lab0)).filter(function (el) {
        return D.visible(el) && D.textOf(el).trim() === firstLine && D.rectOf(el).top < D.rectOf(lab0).top + 20;
      }).pop() || lab0;
      // v1.7.9 下拉列表只显示前几个，后面的要滚动才看得到：先在下拉自带的搜索框里输入职位名，再找选项
      var parts = String(a.want || '').split(/[_＿]/);
      var tWant = D.norm(parts[0]), cWant = D.norm(parts[1] || '');
      var match = function (txt) { var n = D.norm(txt); return n.indexOf(tWant) === 0 && (!cWant || n.indexOf(cWant) > 0) && n.length <= tWant.length + cWant.length + 24; };
      var findOpt = function () {
        var hit = D.qsa('li,div,span,a,p').filter(function (el) {
          if (el === lab || lab.contains(el) || el.contains(lab) || el.children.length > 3) return false;
          // v1.9.24 排除插件自己的浮层：浮层岗位列表里「编译器开发工程师(LLVM)（上海）」也带职位名和城市，之前点到了它
          if (el.closest && (el.closest('#__hrs_greet__') || el.closest('#__hrs_ui__'))) return false;
          var r = D.rectOf(el);
          // v1.9.13 不再要求选项在职位框下方的可视区里：列表滚动过，前面的选项坐标是负数，也要能找到
          return r.width > 0 && r.height > 0 && match(D.textOf(el));
        }).sort(function (x, y) { return D.textOf(x).length - D.textOf(y).length; })[0] || null;
        // 选项里搜索词被高亮拆成几段文字，点整行（li）更稳
        return hit ? (hit.closest('li') && !hit.closest('li').contains(lab) ? hit.closest('li') : hit) : null;
      };
      var searchBox = function () {
        return D.qsa('input').filter(function (i) { return D.visible(i) && /职位/.test(i.getAttribute('placeholder') || ''); })[0] || null;
      };
      var typeSearch = function (text) {
        var inp = searchBox();
        if (!inp) return Promise.resolve(false);
        if (useRpa()) return typeInto(inp, text).then(function (ok) { return ok ? D.sleep(D.rand(700, 1100)).then(function () { return true; }) : false; });
        try {
          var setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
          setter.call(inp, text);
        } catch (e) { inp.value = text; }
        ['input', 'change', 'keyup'].forEach(function (t) { try { inp.dispatchEvent(new Event(t, { bubbles: true })); } catch (e) {} });
        return D.sleep(D.rand(700, 1100)).then(function () { return true; });
      };
      var opened = function () { return searchBox() || findOpt(); };
      return clickVerified(lab, opened, 2000, a.trusted).then(function () {
        var opt = findOpt();
        // v1.9.22 搜索词去掉括号及后面的部分：「编译器开发工程师(LLVM)」搜不到全角括号的职位，只搜「编译器开发工程师」
        var kw = String(parts[0] || '').trim(), kw2 = kw.split(/[(（【[]/)[0].trim();
        var p = (opt && D.visible(opt)) ? Promise.resolve() : typeSearch(kw2.length >= 2 ? kw2 : kw);
        return p.then(function () {
          opt = findOpt();
          if (!opt) { return closeDrop(lab).then(function () { return { ok: false, missing: true, why: '下拉里没有「' + a.want + '」（可能这个职位已关闭或不在推荐范围）' }; }); }
          if (!useRpa()) { try { opt.scrollIntoView({ block: 'nearest' }); } catch (e) {} }   // RPA 点之前会自己用滚轮把选项滚出来
          var picked = function () { var l = jobLabelEl(a.wants); return l && match(D.textOf(l)); };
          return D.sleep(300).then(function () { return clickVerified(opt, picked, 3000, a.trusted); })
            .then(function (ok) {
              if (ok) return true;
              // 兜底：在搜索框里按回车选第一个结果
              var inp = searchBox();
              if (!inp) return false;
              if (useRpa()) return D.click(inp).then(function () { return pressEnter(inp); }).then(function () { return D.waitFor(picked, 2500); });
              ['keydown', 'keypress', 'keyup'].forEach(function (t) { try { inp.dispatchEvent(new KeyboardEvent(t, { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true })); } catch (e) {} });
              return D.waitFor(picked, 2500);
            })
            .then(function (ok) { return closeDrop(lab).then(function (closed) { return { ok: !!ok && closed, trusted: !!st.trusted, why: !ok ? '点了选项但职位没变' : (closed ? '' : '职位切换了，但下拉框收不起来') }; }); });
        });
      });
    },
    filter: function (a) {
      var btn = D.byExactText('筛选').filter(function (el) { return D.rectOf(el).top < 200; })[0];
      if (!btn) return null;
      var panel = function () { return rowOf('学历要求') || rowOf('经验要求'); };
      var clk = function (el) { return st.trusted || a.trusted ? D.trustedClick(el) : D.click(el); };
      return clickVerified(btn, panel, 3000, a.trusted).then(function (ok) {
        if (!ok) { D.pressEscape(); return { ok: false, why: '筛选面板没打开（可能需要 VIP）' }; }
        var clear = D.byExactText('清除')[0];
        var p = clear ? clk(clear).then(function () { return D.sleep(D.rand(500, 900)); }) : Promise.resolve();
        var applied = [];
        var pick = function (rowName, list) {
          return list.reduce(function (pp, text) {
            return pp.then(function () {
              var row = rowOf(rowName), chip = row && chipIn(row, text);
              if (!chip) return;
              applied.push(text);
              return clk(chip).then(function () { return D.sleep(D.rand(250, 600)); });
            });
          }, Promise.resolve());
        };
        return p.then(function () { return pick('经验要求', a.spec.exp || []); })
          .then(function () { return pick('学历要求', a.spec.edu || []); })
          .then(function () {
            var okBtn = D.byExactText('确定').sort(function (x, y) { return D.rectOf(y).top - D.rectOf(x).top; })[0];
            if (!okBtn) { D.pressEscape(); return { ok: false, why: '找不到「确定」按钮' }; }
            return clk(okBtn).then(function () { return { ok: true, applied: applied }; });
          });
      });
    }
  };
  ops.clean = cleanHere;
  // v1.9.27 Boss 推荐页点卡片弹出的简历详情：哪个页面里有弹窗，哪个页面回应全文
  ops.detail = function () {
    var pp = popupOpen();
    if (!pp) {
      // 简历内容可能在弹窗里的内嵌页面：内嵌页面自己读
      if (window !== window.top && /resume|geek|detail|preview/i.test(location.href) && document.body && document.body.innerText.length > 300) return Promise.resolve({ ok: true, text: document.body.innerText });
      return null;
    }
    var t = D.textOf(pp);
    D.qsa('iframe', pp).forEach(function (f) { try { var d = f.contentDocument; if (d && d.body) t += '\n' + d.body.innerText; } catch (e) {} });
    return Promise.resolve({ ok: true, text: t });
  };
  chrome.runtime.onMessage.addListener(function (msg, sender, reply) {
    if (!msg || msg.type !== 'GREET_DO' || !ops[msg.op]) return;
    var t0 = Date.now();
    var p = ops[msg.op](msg.args || {});
    if (!p) return;   // 本页面没有，不回应，让别的页面回应
    // v1.9.48 这一步没做成是因为 RPA 让位（你在用鼠标、助手没开…）：告诉主流程「等一会儿」，不算切换失败
    p.then(function (r) {
      var h = heldSince(t0);
      if (h && r && !r.ok) r = Object.assign({}, r, { hold: true, holdInfo: h });
      reply(r);
    }, function (e) { reply({ ok: false, why: String(e && e.message || e) }); });
    return true;
  });
  function frameOp(op, args) {
    return new Promise(function (resolve) {
      args = Object.assign({ trusted: !!st.trusted }, args || {});
      try { chrome.runtime.sendMessage({ type: 'GREET_FRAME_OP', op: op, args: args }, function (r) { if (r && r.trusted) st.trusted = true; resolve(r || null); }); }
      catch (e) { resolve(null); }
    });
  }
  function lpN(j) { return j.liepinJob || j.platformJob || j.title; }
  function wantsList() { return st.jds.map(function (j) { return SITE === 'liepin' ? lpN(j) : j.greetJob; }).filter(Boolean); }
  function readLabel() { return frameOp('label', { wants: wantsList() }).then(function (r) { return r && r.text ? r.text : ''; }); }

  function jdForLabel(label) {
    if (SITE === 'liepin') {
      var h = D.norm(stripDots(label));
      var m = st.jds.filter(function (j) { var n = D.norm(lpN(j)); return (n.indexOf(h) === 0 || (h.indexOf(n) === 0 && n.length >= 2)) && (!P.onSite || P.onSite(j, 'liepin')); });
      // v1.9.31 同名的好几个：看完整名字里的城市
      if (m.length > 1) { var byCity = m.filter(function (j) { var c = jdCity(j); return c && label.indexOf(c) >= 0; }); if (byCity.length) m = byCity; }
      return m.length ? m.sort(function (a, b) { return D.norm(lpN(a)).length - D.norm(lpN(b)).length; })[0] : null;
    }
    // v2.6.6 和下拉里选职位用同一套规则认：Boss 上的职位名可以比「推荐页职位名」长（例如 Boss 上改名成「模拟ic设计工程师」，
    // 插件里填的是「模拟ic设计 _ 上海」）。以前要求从头到尾一字不差，切过去了却认不出，3 次后就当成切换失败
    var nl = D.norm(label), lp = String(label).split(/[_＿]/);
    var lHead = D.norm(lp[0]), lRest = D.norm(lp.slice(1).join(' '));
    var cands = st.jds.map(function (j) {
      var g = j.greetJob || j.platformJob || j.title || '';
      var gp = String(g).split(/[_＿]/), gHead = D.norm(gp[0]), gCity = D.norm(gp[1] || '');
      if (!gHead) return null;
      var score = 0;
      if (j.greetJob && nl.indexOf(D.norm(j.greetJob)) === 0) score = 3;        // 和以前一样：完全对上
      else if (lHead === gHead) score = 2;                                         // 职位名一样
      else if (gHead.length >= 3 && lHead.indexOf(gHead) === 0) score = 1;        // Boss 上的职位名更长
      if (!score) return null;
      if (gCity && lRest && lRest.indexOf(gCity) < 0) return null;                // 城市对不上的不算
      return { j: j, score: score, len: gHead.length + gCity.length, on: greetCfg(j).enabled ? 1 : 0 };
    }).filter(Boolean).sort(function (a, b) { return b.score - a.score || b.len - a.len || b.on - a.on; });
    if (!cands.length) return null;
    var top = cands.filter(function (c) { return c.score === cands[0].score && c.len === cands[0].len; });
    if (top.length > 1 && cands[0].score < 3) {
      // 好几个岗位都像：只留开着打招呼的；还是好几个就认不出（别乱认）
      var onTop = top.filter(function (c) { return c.on; });
      return onTop.length === 1 ? onTop[0].j : null;
    }
    return cands[0].j;
  }
  function optionTextFor(jd) { return SITE === 'liepin' ? lpN(jd) : (jd.greetJob || ((jd.platformJob || jd.title) + ' _')); }
  function applyFilter(jd) {
    if (st.settings.greetPlatformFilter === false || st.filteredFor === jd.id) return Promise.resolve();
    var spec = filterSpec(jd);
    st.filteredFor = jd.id;
    if (!spec.exp.length && !spec.edu.length) return Promise.resolve();
    say('', '按「' + jd.title + '」设置 Boss 筛选：' + spec.exp.concat(spec.edu).join('、'));
    return frameOp('filter', { spec: spec }).then(function (r) {
      if (r && r.hold) { st.filteredFor = null; setHold(r.holdInfo || r); return; }   // v1.9.48 下一轮再设筛选
      if (!r) say('tip', '没找到 Boss 的「筛选」按钮，跳过平台筛选，只用插件自己判定');
      else if (!r.ok) say('tip', '平台筛选没设上：' + (r.why || '') + '。只用插件自己判定');
      else { say('pass', 'Boss 筛选已设置：' + (r.applied || []).join('、')); st.seen = {}; st.noNewScrolls = 0; }
      return D.sleep(D.rand(2500, 4000));
    });
  }
  // v1.9.13 点卡片之前确认页面干净：最多收拾 3 轮，还不干净就返回 false
  function pageClean() {
    var n = 0;
    return (function round() {
      return frameOp('clean', {}).then(function (r) {
        if (!r) return true;
        if (r.hold) { setHold(r.holdInfo || r); return 'hold'; }
        if (r.ok) say('', '已收起' + r.what);
        if (++n >= 3) return false;
        return D.sleep(400).then(round);
      });
    })();
  }
  function switchTo(jd) {
    say('', '切换职位到「' + optionTextFor(jd) + '」');
    var t0 = Date.now(), want = optionTextFor(jd);
    return frameOp('select', { want: optionTextFor(jd), wants: wantsList(), city: SITE === 'liepin' ? jdCity(jd) : '' }).then(function (r) {
      // v2.3.0 运行记录：切职位成功 / 失败 / 让位
      if (r && r.hold) { var hi = r.holdInfo || r; runAdd('切职位', want, false, { code: hi.code, why: hi.why }); }
      else if (r && r.missing) runAdd('切职位', want, false, { code: 'gone', why: '职位下拉里没有这个职位' });
      else if (!r || !r.ok) runAdd('切职位', want, false, failOf(t0, (r && r.why) || '没找到职位下拉，或点了没切过去'));
      else runAdd('切职位', want, true);
      if (r && r.missing) {
        // v1.9.13 下拉里确实没有这个职位：今天记下来不再试，提示去关掉它的打招呼
        st.exhausted[jd.id] = true; st.swFail = st.swFail || {}; st.swFail[jd.id] = 1;
        say('err', '下拉里确实没有「' + optionTextFor(jd) + '」，今天不再尝试。这个职位如果已关闭，请到「打招呼 · 岗位计划」关掉它的打招呼');
        return pageClean().then(function () { return 'missing'; });
      }
      if (r && r.hold) { setHold(r.holdInfo || r); return 'hold'; }   // v1.9.48 RPA 暂时不能动：不算切换失败
      if (!r || !r.ok) { if (r && r.why) say('tip', r.why); return pageClean().then(function () { return false; }); }
      return D.sleep(D.rand(2500, 4000)).then(function () {
        st.seen = {}; st.noNewScrolls = 0; st.filteredFor = null;
        if (useRpa()) return D.rpaScrollTop(greetButtons()[0]).then(function (x) { if (x && !x.ok) rpaFail(x); return true; });
        try { window.scrollTo({ top: 0, behavior: 'smooth' }); } catch (e) {}
        return true;
      });
    });
  }

  // ---------------- 主流程 ----------------
  function stop(reason, kind) {
    st.stopKind = kind || '';
    try { chrome.runtime.sendMessage({ type: 'TRUSTED_RELEASE' }, function () {}); } catch (e) {}
    st.stopReason = reason;
    say('err', reason);
    render();
  }
  function pickJob() {
    return readLabel().then(function (label) {
      // 页面刚打开时职位下拉可能还没渲染好：先等几轮再动手切换
      if (!label && (st.labelMiss = (st.labelMiss || 0) + 1) <= 5) {
        st.lastJob = '读取中（第 ' + st.labelMiss + ' 次）';
        st.nextAt = Date.now() + 2000;
        return null;
      }
      if (label) st.labelMiss = 0;
      var jd = label ? jdForLabel(label) : null;
      st.lastJob = label || '读不到，改为自己选';
      // v1.9.24 之前切不过去的职位，你手动切过来了：解除跳过，接着打
      if (jd && st.swFail && st.swFail[jd.id] && greetCfg(jd).enabled && !jdFull(jd)) {
        delete st.swFail[jd.id]; delete st.exhausted[jd.id]; st.selectFail = 0; st.keepJd = jd.id;
        say('pass', '已在「' + jd.title + '」，继续打招呼');
      }
      var usable = function (j) { return j && greetCfg(j).enabled && !jdFull(j) && !st.exhausted[j.id]; };
      // v1.9.36 按「打招呼」岗位顺序来：当前页面的职位不是排在最前、还没打满的那个，就切过去（你手动切过来的除外）
      var first = plannedJds().filter(usable)[0];
      if (usable(jd) && (!first || first.id === jd.id || st.keepJd === jd.id)) { if (st.swTry) st.swTry[jd.id] = 0; return applyFilter(jd).then(function () { return jd; }); }
      if (st.keepJd && (!jd || st.keepJd !== jd.id || !usable(jd))) st.keepJd = null;
      var next = plannedJds().filter(usable)[0];
      if (!next) {
        // v1.9.17 分清楚：真的打满了 / 推荐看完了 / 职位切换不过去
        var pj = plannedJds(), full = pj.filter(jdFull), ex = pj.filter(function (j) { return !jdFull(j) && st.exhausted[j.id]; });
        var failSw = ex.filter(function (j) { return st.swFail && st.swFail[j.id]; }), seenAll = ex.filter(function (j) { return !(st.swFail && st.swFail[j.id]) && !(st.dupSkip && st.dupSkip[j.id]); }), dupL = ex.filter(function (j) { return st.dupSkip && st.dupSkip[j.id]; });
        st.stopReason = !pj.length ? '没有岗位开启「打招呼」（或没有这个平台的标签），请到「打招呼 · 岗位计划」勾选' :
          (full.length === pj.length ? '今日打招呼计划已完成：' + pj.length + ' 个岗位都打满了' :
          '今天先停在这里：' + (full.length ? '打满 ' + full.length + ' 个；' : '') + (seenAll.length ? '推荐已看完 ' + seenAll.length + ' 个（' + seenAll.map(function (j) { return j.title; }).join('、') + '）；' : '') +
          (dupL.length ? '和别的岗位重复 ' + dupL.length + ' 个（' + dupL.map(function (j) { return j.title; }).join('、') + '）；' : '') + (failSw.length ? '切换不过去 ' + failSw.length + ' 个（' + failSw.map(function (j) { return j.title; }).join('、') + '），请检查职位名或职位是否在招' : ''));
        if (plannedJds().length) { try { chrome.runtime.sendMessage({ type: 'SCHED_GREET_FINISHED', site: SITE }, function () {}); } catch (e) {} }
        render();
        return null;
      }
      if (jd && jd.id === next.id) { if (st.swTry) st.swTry[next.id] = 0; return next; }
      // v1.9.22 两条记录其实是 Boss 上同一个职位（比如猎聘建的「ATE测试工程师」也挂了 Boss 标签，但没有推荐页职位名）：
      // 当前页面已经是这个职位，再切也切不过去。不算切换失败，跳过这条并提示去合并
      if (SITE !== 'liepin' && jd && !next.greetJob && D.norm(label).indexOf(D.norm(next.platformJob || next.title)) === 0) {
        st.exhausted[next.id] = true; st.dupSkip = st.dupSkip || {}; st.dupSkip[next.id] = 1;
        say('tip', '「' + next.title + '」没有填「推荐页职位名」，在 Boss 上就是「' + label.split('\n')[0] + '」，和「' + jd.title + '」是同一个职位，已跳过。建议到职位管理把两条合并，或去掉多余那条的 Boss 标签');
        st.nextAt = Date.now() + 500;
        return null;
      }
      // 读不到当前职位，或当前职位不在计划里：自己去下拉里选
      // v1.9.31 「切过去了」却一直认不出是这个岗位（同名标签），切 3 次还不行就算切不过去，别无限循环
      st.swTry = st.swTry || {};
      if ((st.swTry[next.id] = (st.swTry[next.id] || 0) + 1) > 3) {
        st.exhausted[next.id] = true; st.swFail = st.swFail || {}; st.swFail[next.id] = 1; st.swTry[next.id] = 0;
        dumpNow('切过去后认不出岗位');
        say('err', '切到「' + optionTextFor(next) + '」3 次，页面上还是认不出是这个岗位（可能有同名职位），本次先跳过');
        st.nextAt = Date.now() + 2000;
        return Promise.resolve(null);
      }
      return switchTo(next).then(function (ok) {
        if (ok === 'hold') { if (st.swTry) st.swTry[next.id] = Math.max(0, (st.swTry[next.id] || 1) - 1); return null; }
        if (ok === 'missing') { st.selectFail = 0; st.nextAt = Date.now() + 1500; return null; }
        if (!ok) {
          st.selectFail = (st.selectFail || 0) + 1;
          if (st.selectFail < 3) { say('tip', '切换职位没成功，' + st.selectFail + '/3，稍后再试'); st.nextAt = Date.now() + 4000; return null; }
          st.selectFail = 0;
          dumpNow('切换职位失败');
          st.exhausted[next.id] = true; st.swFail = st.swFail || {}; st.swFail[next.id] = 1;
          say('err', '切换不到「' + optionTextFor(next) + '」，这个岗位本次先跳过，继续下一个。请检查它的「推荐页职位名」，或确认职位还在招');
          st.nextAt = Date.now() + 2000;
          return null;
        }
        st.selectFail = 0;
        return null;   // 切换后下一轮重新识别，再设筛选
      });
    });
  }
  function nextCard() {
    var all = greetButtons();
    var list = all.map(function (b) { var c = cardOf(b, all); return c ? { btn: b, card: c } : null; }).filter(Boolean);
    for (var i = 0; i < list.length; i++) {
      var info = parseCard(list[i].card);
      var key = keyOf(info);
      if (st.seen[key]) continue;
      // v1.9.39 跳过已打过招呼的人时写一行日志，不再悄悄跳过
      if (logToday().keys[key] || (st.hist && st.hist[key])) {
        st.seen[key] = 1;
        var when = st.hist && st.hist[key] ? new Date(st.hist[key]).toLocaleDateString('zh-CN') : '今天';
        say('tip', (info.name || '候选人') + '：' + when + ' 已在本平台打过招呼（按 姓名+年龄+城市+期望职位 认人），跳过');
        badge(list[i].card, '打过招呼', '#64748b');
        continue;
      }
      return { btn: list[i].btn, card: list[i].card, info: info, key: key };
    }
    return null;
  }
  // v1.9.25 推荐列表到底了：页面上出现「没有更多」之类的字
  function listEnded() {
    return D.qsa('div,span,p').some(function (el) {
      if (el.children.length > 1 || el.closest('#__hrs_greet__') || !D.visible(el)) return false;
      return /^(没有更多了?|已经到底了?|暂无更多.*|没有更多推荐.*|已显示全部.*)$/.test(D.textOf(el).replace(/\s+/g, ''));
    });
  }
  function scrollMore() {
    var before = greetButtons().length;
    var deep = st.noNewScrolls >= 2;
    if (useRpa()) {
      // v1.9.48 真实滚轮：平时往下翻 0.6~0.9 屏；连着两次没新的人就一直滚到底，再真实点「加载更多」
      var anchor = greetButtons()[0];
      var go = deep ? D.rpaWheelBy(Math.max(document.documentElement.scrollHeight - (window.scrollY || 0), window.innerHeight * 3), anchor) : D.rpaWheelBy(window.innerHeight * D.rand(0.6, 0.9), anchor);
      return go.then(function (r) {
        if (r && !r.ok) { rpaFail(r); if (D.isHold(r)) return 'hold'; }
        if (!deep) return;
        var more = D.qsa('a,button,div,span').filter(function (el) { return el.children.length <= 1 && D.visible(el) && !el.closest('#__hrs_greet__') && /^(加载更多|查看更多|点击加载更多|展开更多)$/.test(D.textOf(el).replace(/\s+/g, '')); })[0];
        if (more) return D.click(more);
      }).then(function (h) {
        if (h === 'hold') return;
        return D.sleep(deep ? D.rand(3500, 5000) : D.rand(1800, 3000)).then(function () {
          var after = greetButtons().length;
          st.noNewScrolls = after > before || nextCard() ? 0 : st.noNewScrolls + 1;
        });
      });
    }
    try {
      // v1.9.25 连着两次没新的人：直接拉到最底，点「加载更多」，多等一会儿，免得 Boss 加载慢被误判成看完了
      if (deep) {
        window.scrollTo({ top: document.documentElement.scrollHeight, behavior: 'smooth' });
        var more = D.qsa('a,button,div,span').filter(function (el) { return el.children.length <= 1 && D.visible(el) && !el.closest('#__hrs_greet__') && /^(加载更多|查看更多|点击加载更多|展开更多)$/.test(D.textOf(el).replace(/\s+/g, '')); })[0];
        if (more) { try { more.click(); } catch (e2) {} }
      } else window.scrollBy({ top: window.innerHeight * D.rand(0.6, 0.9), behavior: 'smooth' });
    } catch (e) { window.scrollBy(0, 600); }
    return D.sleep(deep ? D.rand(3500, 5000) : D.rand(1800, 3000)).then(function () {
      var after = greetButtons().length;
      st.noNewScrolls = after > before || nextCard() ? 0 : st.noNewScrolls + 1;
    });
  }

  function badge(card, text, color) {
    try {
      var b = card.querySelector('.__hrs_gbadge__');
      if (!b) {
        b = document.createElement('div');
        b.className = '__hrs_gbadge__';
        if (getComputedStyle(card).position === 'static') card.style.position = 'relative';
        b.style.cssText = 'position:absolute;left:6px;top:6px;z-index:5;font:bold 11px/1.6 "Microsoft YaHei";padding:0 8px;border-radius:9px;color:#fff;pointer-events:none;';
        card.appendChild(b);
      }
      b.textContent = text; b.style.background = color;
    } catch (e) {}
  }

  // ---------- v1.9.27 简历详情（打招呼）----------
  function nameElOf(card, name) {
    var n = String(name || '').replace(/\s+/g, '');
    return ownTextEls(card).filter(function (x) { return x.text.replace(/\s+/g, '') === n; }).map(function (x) { return x.el; })[0] || null;
  }
  // Boss：点卡片 → 弹出简历详情 → 读全文 → 关掉（右上角 ×）
  function readDetailBoss(card, info) {
    var el = nameElOf(card, info.name) || card;
    return D.click(el).then(function () {
      var n = 0;
      return (function wait() {
        return frameOp('detail', {}).then(function (r) {
          if (r && r.ok && String(r.text || '').replace(/\s+/g, '').length > 60) {
            return D.sleep(1200).then(function () { return frameOp('detail', {}); }).then(function (r2) {
              var t = (r2 && r2.text && r2.text.length >= r.text.length) ? r2.text : r.text;
              return pageClean().then(function (closed) {
                if (!closed) say('warn', '简历详情弹窗没关掉，请手动点右上角 ×');
                return { ok: t.replace(/\s+/g, '').length >= 80, text: t, why: t.length < 80 ? '弹窗里读不到文字（可能是图片）' : '' };
              });
            });
          }
          if (++n === 5 && !useRpa()) D.trustedClick(el);   // v1.9.48 RPA 本来就是真实点击，不再补点（免得点两下）
          if (n > 14) return { ok: false, why: '点了卡片没有弹出简历详情' };
          return D.sleep(500).then(wait);
        });
      })();
    });
  }
  // 猎聘：点卡片会新开简历页。先让页面把地址交给插件，后台打开读完关掉；交不出地址再真点，接住新标签
  function readDetailLiepin(card, info) {
    var el = nameElOf(card, info.name) || card;
    var url = '';
    var onMsg = function (e) { if (e.data && e.data.__hrs_open__ && e.data.url && !url) url = e.data.url; };
    window.addEventListener('message', onMsg);
    document.documentElement.setAttribute('data-hrs-catch-open', '1');
    D.click(el);
    var n = 0;
    var bg = function (m) { return new Promise(function (r) { try { chrome.runtime.sendMessage(m, function (x) { var le = chrome.runtime.lastError; r(x ? (x.error ? { ok: false, why: x.error } : x) : { ok: false, why: '后台没有回应' + (le ? '：' + le.message : '') }); }); } catch (e) { r({ ok: false, why: '发不出消息：' + e.message }); } }); };
    return (function wait() {
      if (url || n++ > 8) {
        document.documentElement.removeAttribute('data-hrs-catch-open');
        window.removeEventListener('message', onMsg);
        if (url) return bg({ type: 'DETAIL_READ_URL', url: url });
        var arm = bg({ type: 'DETAIL_CATCH_TAB', timeout: 12000 });
        return D.sleep(300).then(function () { return D.trustedClick(el); }).then(function () { return arm; });
      }
      return D.sleep(400).then(wait);
    })();
  }
  function aiMaybe(jd, text, sc, name) {
    var ai = st.settings.ai;
    if (!ai || !ai.on || !ai.url) return Promise.resolve(null);
    return new Promise(function (r) {
      try { chrome.runtime.sendMessage({ type: 'AI_JUDGE', jd: { title: jd.title, jdText: jd.jdText || '' }, text: text, sc: sc, name: name || '' }, function (x) { void chrome.runtime.lastError; r(x || null); }); } catch (e) { r(null); }
    }).then(function (x) {
      if (x && x.ok) return x;
      say('tip', 'AI 判断没成功，改用关键词打分：' + (x && x.why || ''));
      return null;
    });
  }
  function handle(jd, c) {
    var g = greetCfg(jd);
    var info = c.info;   // 滚动到位后会重新读
    var started = Date.now();
    st.busy = true;
    render();
    if (/^继续沟通$/.test(D.textOf(c.btn).replace(/\s+/g, '')) && GREET_TXT !== '继续沟通') {
      st.seen[c.key] = 1; st.busy = false; remember(c.key);
      return Promise.resolve();
    }
    var dirty = false;
    // v1.9.13 处理卡片前先确认没有展开的下拉框、筛选面板或打开的简历，关不掉就停下，不在上面乱点
    return pageClean().then(function (clean) {
      if (clean === 'hold') throw { hold: true };   // v1.9.48 RPA 让位：这个人等会儿重新看
      if (!clean) { dirty = true; dumpNow('页面收不干净'); stop('页面上有下拉框或弹窗关不掉（可能是平台广告），为避免误点已停止。请手动关掉（右上角 × 或圆圈 ×），再点「清除停止状态」继续'); }
    }).then(function () {
      if (dirty) return;
      return D.scrollIntoViewSoft(c.card);
    }).then(function () {
      if (dirty) return;
      return D.hover(c.card);
    }).then(function () { return dirty ? null : D.sleep(D.rand(900, 2200)); }).then(function () {
      if (dirty) return;
      var hh = heldSince(started);
      if (hh) { setHold(hh); throw { hold: true }; }   // v1.9.48 滚动 / 悬停途中 RPA 让位：这个人等会儿重新看
      // 卡片滚进视野后右边的工作经历才渲染完整，重新读一遍
      info = parseCard(c.card);
      var risk = D.riskSignal();
      if (risk) { stop('[已停止] 检测到「' + risk + '」'); return; }
      // v1.9.7 猎聘：硬性关键词和芯片行业只看右边的工作经历（公司 + 职位），不看期望行和「电子/半导体/集成电路」这类标签
      // v2.6.2 卡片上的硬性关键词（例如「验证|DV|Verification」）只看右栏的工作经历（公司 + 职位），
      // 不看「期望 苏州 · 数字IC验证工程师」「来自相似职位…」标签和「优势」。以前 BOSS 看整张卡片，
      // 推荐列表里人人的期望职位都带「验证」，工作经历完全不相关的人也判成合格
      var W = M.workRows(info.workLines, { titleOnly: SITE === 'liepin' });
      // v2.9.1 按时间格子没认出来：右栏按行重建（时间轴样式的卡片、「-」「·」是画出来的卡片）
      var RC = null;
      if (!W.length) {
        RC = rightColumnRows(c.card);
        if (RC.lines.length) {
          W = M.workRows(RC.lines, { titleOnly: SITE === 'liepin' });
          if (W.length || RC.lines.length) info.workLines = RC.lines.slice();
        }
      }
      // v2.6.4 按时间段没认出工作经历时（卡片的时间格式特殊、或没写时间），退一步：卡片里「公司 · 职位」这种带 · 的行，去掉期望、优势、教育
      if (!W.length) {
        var fb = cardSegments(c.card).filter(function (l) {
          if (!/[·•・]/.test(l) || l.length > 80) return false;
          if (/期望|优势|最近关注|来自相似职位|活跃|在线|岁|打招呼|继续沟通/.test(l)) return false;
          // 期望那一行是「上海 · 数字IC验证工程师」：以期望城市开头、又带期望职位的才去掉（工作经历里职位和期望一样的要留着）
          if (info.expectJob && info.city && l.indexOf(info.city) === 0 && l.indexOf(info.expectJob) >= 0) return false;
          return true;
        });
        W = M.workRows(fb.map(function (l) { return '- ' + l; }), { titleOnly: SITE === 'liepin' });
        if (W.length) info.workLines = info.workLines.concat(fb);
      }
      // v2.6.8 左栏「29岁 | 4年 | 硕士 | 在职」：年限以这里为准（以前在整张卡片里找，「优势」里写了「应届」之类就当成 0 年）
      var baseSeg = cardSegments(c.card).filter(function (l) { return /\d{2}\s*岁/.test(l) && /年|应届|在校/.test(l); })[0] || '';
      var yCard = null;
      if (/应届|在校/.test(baseSeg) || /1\s*年以内/.test(baseSeg)) yCard = 0;
      else { var ym0 = baseSeg.match(/(?:^|[\s|｜·])(\d{1,2})\s*年(?:以上)?(?=[\s|｜·]|$)/); if (ym0) yCard = parseInt(ym0[1], 10); }
      info.baseLine = baseSeg; info.rowsW = W;   // v2.7.0 浮层上显示候选人基本信息用
      var cardLines = info.workLines;   // 右栏原样（含教育经历），算「从第一份工作算起」的年限用
      var looseText = '';
      // v2.6.6 两种办法都没认出工作经历：最后用卡片上去掉期望、优势、「来自相似职位」标签和教育经历以后剩下的文字来判，不再停在「工作经历读不到」
      if (!W.length) {
        // v2.6.9 只认「公司 · 职位」这种带圆点的行，技能标签（Verilog、RTL设计…）不算工作经历
        var rest = cardSegments(c.card).filter(function (l) {
          if (!/[·•・]/.test(l)) return false;
          if (/期望|优势|最近关注|来自相似职位|活跃|在线|\d+岁|打招呼|继续沟通|^\d+-\d+K/.test(l)) return false;
          if (info.city && info.expectJob && l.indexOf(info.city) === 0 && l.indexOf(info.expectJob) >= 0) return false;
          if (/(本科|硕士|博士|大专|专科|学士)\s*$/.test(l) || /(大学|学院|学校)/.test(l) && !/工程师|经理|设计|验证|开发/.test(l)) return false;
          return l.length <= 80;
        });
        // v2.9.1 带圆点的行也没有：用右栏（工作经历那一栏）的全部文字，期望、优势、标签都在左栏，不会混进来
        if (!rest.length) {
          RC = RC || rightColumnRows(c.card);
          rest = RC.text.filter(function (l) { return !(/(本科|硕士|博士|大专|专科|学士)\s*$/.test(l) || /(大学|学院|学校)/.test(l) && !/工程师|经理|设计|验证|开发/.test(l)); });
        }
        if (rest.length) { looseText = rest.join('\n'); info.workLines = info.workLines.concat(['（按卡片文字判断）'].concat(rest)); }
      }
      // v3.3.0 整理成统一判定引擎的格式（engine.js），评测集重跑用的是同一个函数，和这里判的一致
      // 猎聘：每行「时间 公司 · 职位」，公司判行业，职位判岗位关键词（v1.9.8）
      var prof = HRSEngine.cardProfile({ site: SITE, summary: info.summary, fields: { city: info.city, expectJob: info.expectJob, expYearsCard: yCard, baseLine: baseSeg },
        workRows: W, cardLines: cardLines, keywordText: looseText, keywordLoose: !!looseText });
      var mopt = { industry: window.HRSIndustry, chipWords: st.settings.chipWords, chipExclude: st.settings.chipExclude };
      // v1.9.27 开了「简历详情」的岗位：卡片上只判基础条件，关键词点开完整简历再看
      var dOn = P.detailOn && P.detailOn(jd, 'greet'), DR = dOn ? P.detailRules(jd, st.jds, 'greet') : null;
      mopt.jobTitle = jd.title;   // v2.6.6 做过的职位就是正在招的这个岗位：Job relevance 直接算相关
      var res = M.match(prof, dOn ? DR.base : { hardRequirements: g.hard, optionalKeywords: g.bonus, requireChip: g.requireChip }, mopt);
      // v2.6.6 工作经历还是读不到：自动记一份卡片结构（10 分钟最多一次），「采集控件」里可以导出
      if (!W.length && (res.hits.rows || []).some(function (x) { return /工作经历读不到|按卡片文字判断/.test(x.got || ''); }) && Date.now() - (st.wrDumpAt || 0) > 600000) {
        st.wrDumpAt = Date.now();
        try { dumpNow('工作经历读不到', c.card, { workLines: info.workLines, segments: cardSegments(c.card) }); } catch (e) {}
      }
      if (g.requireChip && res.verdict === 'pass' && info.truncated && !(res.hits.rows || []).some(function (r) { return r.rule === '芯片行业' && r.ok; })) {
        res.verdict = 'review'; res.reasons = ['工作经历被截断，看不全公司'];
      }
      evalSample(info, prof, W, g, jd, res, dOn);
      if (!dOn || res.verdict === 'reject') return cont(res);
      say('', info.name + '：基础条件符合，打开简历详情看关键词');
      return (SITE === 'liepin' ? readDetailLiepin(c.card, info) : readDetailBoss(c.card, info)).then(function (d) {
        var hd = heldSince(started);
        if (hd && (!d || !d.ok)) { setHold(hd); throw { hold: true }; }   // v1.9.48 读简历详情途中 RPA 让位
        if (!d || !d.ok) {
          var r0 = JSON.parse(JSON.stringify(res)); r0.verdict = 'review';
          r0.reasons = ['简历详情没读到' + (d && d.why ? '（' + d.why + '）' : '') + '，跳过'];
          dumpNow('简历详情读不到', c.card);
          return cont(r0);
        }
        var RS = window.HRSResumeScore;
        var sc = RS.score(d.text, { hard: DR.hard, bonus: DR.bonus, veto: DR.veto, passLine: DR.passLine, names: DR.names });
        info.detailText = d.text;
        // v2.6.8 第一学历是大专：完整简历里再看一遍（卡片上只显示最近的学历）
        var dz = (DR.base.hardRequirements || []).some(function (x) { return /^第一学历/.test(String(x).replace(/\s+/g, '')); }) ? M.firstEduOf({}, d.text, '') : null;
        if (dz && dz.dz) {
          var r1 = JSON.parse(JSON.stringify(res)); r1.verdict = 'reject';
          r1.reasons = ['第一学历是大专（简历详情：' + dz.why + '）'];
          (r1.hits.rows = r1.hits.rows || []).push({ rule: '第一学历不要大专', ok: false, got: '简历详情：' + dz.why });
          return cont(r1);
        }
        return (sc.vetoWhy ? Promise.resolve(null) : aiMaybe(jd, d.text, sc, info.name)).then(function (ai) { return cont(RS.combine(res, sc, ai)); });
      });
      function cont(res) {
      st.lastJd = jd;
      renderResult(info, jd, res);
      // v1.9.17 今日扫 / 过 / 拒（试运行也算），明细给人才库页看
      (function () {
        var L0 = logToday();
        L0.scan++; if (res.verdict === 'pass') L0.pass++; else if (res.verdict === 'reject') L0.reject++;
        L0.items.push({ t: Date.now(), name: info.name, job: jd.title, v: res.verdict, why: (res.reasons || []).join('。').slice(0, 160), dry: mode() === 'dry' });
        if (L0.items.length > 400) L0.items = L0.items.slice(-400);
        saveLog();
      })();
      // v3.6.0 自动决定记录（设置 · 合规）：每判一张卡片记一条，明细保留 90 天
      try {
        var DLg = window.HRSDecisionLog;
        var dd = { site: SITE, module: 'greet', jdId: jd.id, job: jd.title, name: info.name, res: res, dry: mode() === 'dry', action: mode() === 'live' && res.verdict === 'pass' ? 'greet' : 'none' };
        chrome.runtime.sendMessage({ type: 'DECISION_ADD', d: DLg ? DLg.entry(dd) : dd }, function () { void chrome.runtime.lastError; });
      } catch (e) {}
      st.seen[c.key] = 1;
      var why = res.reasons.join('。');
      if (res.verdict !== 'pass') {
        badge(c.card, res.verdict === 'reject' ? '不打招呼' : '跳过', res.verdict === 'reject' ? '#dc2626' : '#f59e0b');
        say(res.verdict === 'reject' ? 'warn' : 'tip', info.name + '：' + why);
        st.nextAt = Date.now() + skim();   // 不点按钮的，只停留一会儿就看下一张（v2.3.0 停留时长更随机）
        return;
      }
      if (mode() === 'dry') {
        badge(c.card, '会打招呼', '#2563eb');
        say('dry', '【会打招呼】' + info.name + '：' + why);
        st.nextAt = started + pace() * 1000 * 0.7 * paceF();
        maybeRest();
        return;
      }
      var L = logToday();
      if (L.total >= cap()) { stop('今日打招呼已达总上限 ' + cap() + ' 个'); return; }
      var changed = function () { return !c.btn.isConnected || D.textOf(c.btn).replace(/\s+/g, '') !== GREET_TXT || !!D.riskSignal() || (SITE === 'liepin' && !!lpDialog()); };
      // v2.6.0 点完多等一会儿（平台慢的时候按钮要过几秒才变）；BOSS 上没反应、也没弹出任何提示时再点一次
      var pw = watchPopups();
      var pop0 = popupTexts(c.card);   // 点之前就在的提示不算
      var freshPops = function (arr) { return tidyPops(arr).filter(function (t) { return pop0.indexOf(t) < 0; }); };
      var attempt = function (n) {
        return clickVerified(c.btn, changed, 6000).then(function () {
          if (changed() || n >= 2 || SITE !== 'boss' || heldSince(started)) return;
          if (freshPops(pw.peek().concat(popupTexts(c.card))).length) return;
          if (!c.btn.isConnected || D.textOf(c.btn).replace(/\s+/g, '') !== GREET_TXT) return;
          say('tip', info.name + '：点了「' + GREET_TXT + '」没反应，再点一次');
          return D.sleep(D.rand(1200, 2200)).then(function () { return attempt(n + 1); });
        });
      };
      return attempt(1).then(null, function (e) { pw.stop(); throw e; }).then(function () { return D.sleep(D.rand(600, 1200)); }).then(function () {
        var risk2 = D.riskSignal();
        if (risk2) { stop('[已停止] 点打招呼后出现「' + risk2 + '」'); return; }
        // v1.9.6 猎聘点「立即沟通」后：弹出「已向 X 发送打招呼语」→ 叉掉；打开了聊天窗口 → 发这个职位的打招呼语再关掉
        var t1 = Date.now();
        var noteMsg = function (r) {
          if (!r || !r.note) return;
          say(r.ok ? '' : 'tip', info.name + '：' + r.note);
          if (/打招呼语|聊天窗口|继续沟通/.test(r.note)) runAdd('发消息', info.name, !!r.ok, r.ok ? null : failOf(t1, r.note), r.ok ? preview(greetMsgFor(jd)) : r.note);
        };
        if (SITE === 'liepin') return lpAfterGreet(jd).then(function (r) { noteMsg(r); return afterClick(); });
        if (changed() && !D.riskSignal()) return bossAfterGreet(jd, c.btn).then(function (r) { noteMsg(r); return afterClick(); });
        return afterClick();
      }).then(function () {});
      function afterClick() {
        var pops = freshPops(pw.stop().concat(changed() ? [] : popupTexts(c.card)));
        if (!changed() && heldSince(started)) {
          // v1.9.48 RPA 让位（你在用鼠标 / 锁屏 / 助手没开）：这个人没点，等会儿重新看
          var hs = heldSince(started);
          runAdd('打招呼', info.name + ' · ' + jd.title, false, { code: hs.code, why: hs.why });
          setHold(hs); delete st.seen[c.key];
          return;
        }
        if (!changed()) {
          var popTxt = pops.join(' / ').slice(0, 120);
          dumpNow('打招呼按钮点击无效', c.btn, { popups: pops, misses: (st.greetMiss || 0) + 1, paceSec: pace() });
          // v2.6.0 先看平台有没有说为什么：次数用完 / 要付费 → 停；太频繁 → 停并提示调慢节拍；别的弹窗 → 停，不在不认识的弹窗上乱点
          if (pops.some(function (t) { return LIMIT_RE.test(t); })) {
            runAdd('打招呼', info.name + ' · ' + jd.title, false, { code: 'limit', why: popTxt });
            stop('BOSS 提示「' + popTxt + '」，今天的打招呼次数可能用完了或需要道具，已停止');
            return;
          }
          if (pops.some(function (t) { return FREQ_RE.test(t); })) {
            runAdd('打招呼', info.name + ' · ' + jd.title, false, { code: 'verify', why: popTxt });
            stop('BOSS 提示「' + popTxt + '」，操作太快了，已停止。建议把打招呼节拍调到 30 秒以上（现在 ' + pace() + ' 秒），过十几分钟再继续');
            return;
          }
          if (pops.length) {
            runAdd('打招呼', info.name + ' · ' + jd.title, false, { code: 'unverified', why: '点了以后弹出：' + popTxt });
            stop('点「' + GREET_TXT + '」后页面弹出了「' + popTxt + '」，插件不认识这个提示，为避免误点已停止。看一下页面，关掉提示后点「清除停止状态」继续');
            return;
          }
          // 没有任何提示、点了两次都没反应：跳过这位看下一位，连续 3 位都这样才停
          st.greetMiss = (st.greetMiss || 0) + 1;
          runAdd('打招呼', info.name + ' · ' + jd.title, false, failOf(started, '点了两次「' + GREET_TXT + '」按钮都没变化'));
          badge(c.card, '没点上', '#f59e0b');
          if (st.greetMiss >= 3) {
            stop((useRpa() ? '用 RPA 真实鼠标' : '') + '连续 ' + st.greetMiss + ' 位候选人点「' + GREET_TXT + '」都没反应，已停止' + (st.lastRpaWhy ? '（' + st.lastRpaWhy + '）' : '') +
              '。可能是平台限制了打招呼（节拍现在 ' + pace() + ' 秒，建议 30 秒以上），控件信息已记录，点「采集控件」可复制');
            return;
          }
          say('warn', info.name + '：点了两次「' + GREET_TXT + '」都没反应，跳过这位，看下一位（连续第 ' + st.greetMiss + ' 次）');
          st.nextAt = Date.now() + skim() + D.rand(3000, 6000);
          return;
        }
        st.greetMiss = 0;
        var L = logToday();
        L.total++; L.counts[jd.id] = (L.counts[jd.id] || 0) + 1; L.keys[c.key] = 1;
        saveLog(); remember(c.key);
        badge(c.card, '已打招呼', '#059669');
        say('pass', '已打招呼 → ' + info.name + '（' + jd.title + ' ' + L.counts[jd.id] + '/' + (g.quota === Infinity ? '不限' : g.quota) + '，今日共 ' + L.total + '/' + cap() + '）');
        runAdd('打招呼', info.name + ' · ' + jd.title, true);
        st.nextAt = started + pace() * 1000 * paceF();
        maybeRest();
      }
      }
    }).catch(function (e) {
      if (e && e.hold) { delete st.seen[c.key]; return; }   // v1.9.48 RPA 让位：这个人等会儿重新看
      say('err', '处理出错：' + (e && e.message || e));
      st.nextAt = Date.now() + pace() * 1000;
    }).then(function () { st.busy = false; render(); });
  }

  function tick() {
    if (!isRecommendPage()) { if (ui) ui.style.display = 'none'; return; }
    ensureUi(); ui.style.display = '';
    if (st.busy || st.paused || mode() === 'stop' || st.stopReason) {
      // v1.7.7 停止 / 暂停时也读一下当前职位，浮层上显示的是真实状态，而不是「读不到」
      if (!st.peeking && Date.now() - (st.peekAt || 0) > 3000) {
        st.peeking = true; st.peekAt = Date.now();
        readLabel().then(function (l) {
          st.peeking = false;
          var jd = l ? jdForLabel(l) : null;
          st.lastJob = l ? l + (jd ? '（对应岗位：' + jd.title + (greetCfg(jd).enabled ? '' : '，未开启打招呼') + '）' : '（在招岗位里没有对应的推荐页职位名）') : '读不到';
          // v1.7.9 因为切职位失败而停下的，你手动切到一个还能打的岗位后自动继续
          if (st.stopReason && st.stopKind === 'job' && jd && greetCfg(jd).enabled && !jdFull(jd) && mode() !== 'stop') {
            st.stopReason = ''; st.stopKind = ''; st.exhausted[jd.id] = false; st.labelMiss = 0; st.selectFail = 0;
            say('pass', '已识别到你切到的「' + jd.title + '」，自动继续');
          }
          render();
        });
      }
      render(); return;
    }
    if (Date.now() < st.nextAt) { render(); return; }
    if (breaker && breaker.resting()) { render(); return; }   // v2.3.0 拟人小憩中
    if (st.rpaHold && Date.now() < st.rpaHold.until) { render(); return; }   // v1.9.48 RPA 让位中
    var risk = D.riskSignal();
    if (risk) { stop('[已停止] 检测到「' + risk + '」'); return; }
    // v1.9.48 Boss：动手前先问 RPA 助手「现在能动鼠标吗」，不能就等（你在用鼠标键盘、锁屏、助手没开）
    if (useRpa() && !st.rpaGateOk) {
      st.busy = true;
      D.rpaProbe().then(function (g) {
        st.busy = false;
        if (g && g.ok) { if (st.rpaHold) { say('pass', 'RPA 已就绪，继续'); st.rpaHold = null; } st.rpaGateOk = true; tick(); return; }
        setHold(g);
      });
      return;
    }
    st.rpaGateOk = false;
    // v1.9.7 上一个人的「已向 X 发送打招呼语」弹窗还在：先关掉，关不掉就停下，不在弹窗底下继续点
    if (SITE === 'liepin' && lpSentHit()) {
      st.busy = true;
      closeSentPopup().then(function (closed) {
        st.busy = false;
        if (!closed) { dumpNow('打招呼弹窗关不掉'); stop('「已向 X 发送打招呼语」弹窗关不掉，已停止。请手动点右上角 ×（不要点「免费开聊」），再点「正式运行」继续'); return; }
        st.popupStuck = false;
        say('', '已关掉「已发送打招呼语」弹窗');
        st.nextAt = Date.now() + D.rand(600, 1200);
        render();
      });
      return;
    }
    st.busy = true;
    pickJob().then(function (jd) {
      if (!jd) return;
      var c = nextCard();
      if (c) return handle(jd, c);
      if (st.noNewScrolls >= 6 || (st.noNewScrolls >= 3 && listEnded())) {
        st.exhausted[jd.id] = true;
        say('tip', '「' + jd.title + '」的推荐已经看完，换下一个岗位');
        return;
      }
      return scrollMore();
    }).catch(function (e) { say('err', '出错：' + (e && e.message || e)); })
      .then(function () { st.busy = false; render(); });
  }

  // ---------------- 控件采集（不用 F12） ----------------
  function collectDump(reason, el) {
    var btn = el || greetButtons()[0] || null;
    var lab = jobLabelEl(wantsList());
    var tops = D.qsa('div,span,p,a,button').filter(function (x) {
      var t = D.textOf(x); var r = D.rectOf(x);
      return t && t.length <= 60 && t.indexOf('\n') < 0 && D.visible(x) && r.top < 200 && !x.closest('#__hrs_greet__');
    }).slice(0, 25).map(D.describe);
    return { at: new Date().toISOString(), version: VERSION, reason: reason || '手动采集', frame: { url: location.href, isTop: window === window.top },
      greetButton: btn ? D.dumpControl(btn) : '本页面没有打招呼按钮', jobLabel: lab ? D.dumpControl(lab) : '本页面没找到职位下拉', topTexts: tops, trustedUsed: !!st.trusted };
  }
  function dumpNow(reason, el, extra) {
    var d = collectDump(reason, el);
    if (extra) Object.keys(extra).forEach(function (k) { d[k] = extra[k]; });
    st.lastDump = d;
    try { chrome.runtime.sendMessage({ type: 'DIAG_LOG', data: d }, function () {}); } catch (e) {}
    return d;
  }

  // ---------------- v3.2.0 评测样本：卡片判定的输入和结果存一份在本机，给「设置 → 评测集」打标、离线比对用 ----------------
  // 去掉姓名，只留判定要用的内容。设置里关掉「采集评测样本」就不存
  function evalSample(info, prof, W, g, jd, res, dOn) {
    try {
      if (st.settings.evalCollect === false) return;
      var nm = String(info.name || '');
      var anon = function (x) {
        var t = String(x == null ? '' : x);
        if (nm && nm !== '候选人') t = t.split(nm).join('候选人');
        return t.replace(/1[3-9]\d{9}/g, '<电话>').replace(/[\w.+-]+@[\w-]+\.[\w.]+/g, '<邮箱>');
      };
      var sample = {
        site: SITE, at: Date.now(), jdId: jd.id, jobTitle: jd.title, detail: !!dOn,
        rules: { hardRequirements: (g.hard || []).slice(), optionalKeywords: (g.bonus || []).slice(), requireChip: !!g.requireChip },
        card: {
          summary: anon(prof.summary).slice(0, 4000), fields: JSON.parse(anon(JSON.stringify(prof.fields || {}))),
          rowLines: W.map(function (w) { return anon(w.line); }), cardLines: (prof.cardLines || []).map(anon),
          keywordText: anon(prof.keywordText || ''), keywordLoose: !!prof.keywordLoose
        },
        verdict: res.verdict, reason: anon((res.reasons || [])[0] || '').slice(0, 200),
        score: res.hits && res.hits.relevance && res.hits.relevance[0] ? res.hits.relevance[0].score : null
      };
      chrome.runtime.sendMessage({ type: 'EVAL_ADD', sample: sample }, function () { void chrome.runtime.lastError; });
    } catch (e) {}
  }

  // ---------------- 浮层 ----------------
  var ui = null;
  function esc(x) { return String(x == null ? '' : x).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function ensureUi() {
    if (ui && ui.isConnected) return ui;
    // v2.8.0 浮层放进隔离层（Shadow DOM）：页面样式进不来，颜色、圆角、字号统一用设计令牌
    ui = (window.HRSPanel && window.HRSPanel.mount) ? window.HRSPanel.mount('__hrs_greet__') : document.createElement('div');
    ui.id = '__hrs_greet__';
    ui.innerHTML = '<style>' +
      '#__hrs_greet__{position:fixed;right:12px;bottom:12px;z-index:2147483646;width:390px;font:12px/1.6 "Microsoft YaHei",sans-serif;color:var(--text);background:var(--surface);border:1.5px solid var(--accent);border-radius:var(--r-lg);box-shadow:0 6px 18px rgba(0,0,0,.16);overflow:hidden;}' +
      '#__hrs_greet__.bad{border-color:var(--bad-500);}' +
      '#__hrs_greet__ .h{display:flex;align-items:center;gap:8px;padding:7px 12px;background:var(--accent-50);cursor:pointer;}' +
      '#__hrs_greet__ .h b{font-size:var(--fs-md);}#__hrs_greet__ .h .v{font-size:var(--fs-xs);color:var(--text-2);}' +
      '#__hrs_greet__ .h .m{margin-left:auto;display:inline-flex;border:1px solid var(--field);border-radius:var(--r-md);overflow:hidden;}' +
      '#__hrs_greet__ .h .m button{border:none;border-right:1px solid var(--field);background:var(--surface);color:var(--text-2);font-size:var(--fs-xs);padding:1px 8px;border-radius:0;}#__hrs_greet__ .h .m button:last-child{border-right:none;}' +
      '#__hrs_greet__ .h .m button.on[data-g=stop]{background:var(--bg);color:var(--text);font-weight:600;}#__hrs_greet__ .h .m button.on[data-g=dry]{background:var(--warn-50);color:var(--warn-700);font-weight:600;}#__hrs_greet__ .h .m button.on[data-g=live]{background:var(--ok-50);color:var(--ok-700);font-weight:600;}' +
      '#__hrs_greet__ .pl{max-height:105px;overflow:auto;margin:3px 0;border:1px solid var(--line-2);border-radius:var(--r-sm);}#__hrs_greet__ .pl div{display:flex;justify-content:space-between;padding:1px 8px;border-top:1px dashed var(--line-2);}#__hrs_greet__ .pl div:first-child{border-top:none;}#__hrs_greet__ .pl span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}#__hrs_greet__ .pl b{font-weight:400;color:var(--text-2);margin-left:8px;}' +
      '#__hrs_greet__ .pc button{border:1px solid var(--info-200);background:var(--info-50);color:var(--info-700);border-radius:var(--r-sm);padding:0 7px;font-size:var(--fs-sm);}' +
      '#__hrs_greet__ table,#__hrs_greet__ td{font-size:var(--fs-xs) !important;line-height:1.5 !important;font-family:inherit !important;}' +
      '#__hrs_greet__ .bd{display:block;}#__hrs_greet__.min .bd{display:none;}#__hrs_greet__.min{height:auto !important;}' +
      '#__hrs_greet__ .rc:not([style*="block"]) + .hrs-split{display:none;}' +
      '#__hrs_greet__ .st{padding:6px 12px;}' +
      '#__hrs_greet__ .er{display:none;background:var(--bad-50);color:var(--bad);padding:6px 12px;border-bottom:1px solid var(--bad-200);}' +
      '#__hrs_greet__ .ctl{display:flex;gap:6px;align-items:center;padding:6px 12px;border-bottom:1px solid var(--line);}' +
      '#__hrs_greet__ button{border:1px solid var(--accent-300);background:var(--accent-50);color:var(--accent-700);border-radius:var(--r-md);padding:2px 10px;cursor:pointer;font-size:var(--fs-xs);}' +
      '#__hrs_greet__ button.off{border-color:var(--bad-200);background:var(--bad-50);color:var(--bad);}' +
      '#__hrs_greet__ .rc{padding:6px 12px;border-bottom:1px solid var(--line);display:none;}' +
      '#__hrs_greet__ table{width:100%;border-collapse:collapse;font-size:var(--fs-xs);line-height:1.5;table-layout:fixed;}#__hrs_greet__ td{padding:2px 4px;border-top:1px dashed var(--line-2);vertical-align:top;word-break:break-all;}' +
      '#__hrs_greet__ tr.bad td{color:var(--bad-500);}#__hrs_greet__ tr.unk td{color:var(--warn);}#__hrs_greet__ td.s{width:14px;font-weight:700;padding:2px 0;}' +
      '#__hrs_greet__ .chip{display:inline-block;margin:2px 4px 0 0;padding:0 7px;border-radius:var(--r-md);font-size:var(--fs-xs);background:var(--bg);color:var(--muted);}#__hrs_greet__ .chip.on{background:var(--ok-50);color:var(--ok);font-weight:600;}' +
      '#__hrs_greet__ .tb{display:flex;border-bottom:1px solid var(--line);background:var(--surface-2);}#__hrs_greet__ .tb span{flex:1;text-align:center;padding:4px 0;cursor:pointer;color:var(--text-2);}#__hrs_greet__ .tb span.on{color:var(--accent-700);font-weight:600;border-bottom:2px solid var(--accent);background:var(--surface);}' +
      '#__hrs_greet__ .tp{display:none;}#__hrs_greet__ .tp.on{display:block;}' +
      '#__hrs_greet__ .sm{padding:5px 12px;border-bottom:1px solid var(--line);font-weight:600;color:var(--accent-700);}' +
      // v2.7.0 里面的几块自动适应：判定区按内容高度（最多占屏幕一半），日志区填满剩下的空间，不再有手动分隔线
      '#__hrs_greet__:not(.min) .bd{display:flex;flex-direction:column;}#__hrs_greet__ .bd>*{flex:none;}' +
      '#__hrs_greet__ .rc{max-height:50vh;overflow:auto;}#__hrs_greet__ .rc td{padding:4px 4px !important;line-height:1.7 !important;}' +
      '#__hrs_greet__ .lg{max-height:200px;overflow:auto;padding:4px 12px;font:11px/1.6 Consolas,"Microsoft YaHei",monospace;}' +
      '#__hrs_greet__.hrs-sized .bd{overflow:hidden !important;}#__hrs_greet__.hrs-sized .rc{flex:0 1 auto;min-height:0;max-height:62%;}' +
      '#__hrs_greet__.hrs-sized .tp.on{flex:1 1 0;min-height:70px;display:flex;flex-direction:column;}#__hrs_greet__.hrs-sized .tp.on>.lg,#__hrs_greet__.hrs-sized .tp.on>.st{flex:1;min-height:0;max-height:none;overflow:auto;}' +
      '#__hrs_greet__ .who{margin:5px 0 4px;padding:5px 8px;background:var(--surface-2);border-radius:var(--r-sm);}#__hrs_greet__ .who .kv{display:flex;gap:8px;line-height:1.6;}#__hrs_greet__ .who .kv span{flex:none;width:28px;color:var(--muted);}#__hrs_greet__ .who .kv b{font-weight:500;color:var(--text);word-break:break-all;}' +
      '#__hrs_greet__ .why{margin:4px 0 6px;padding:5px 8px;border-radius:var(--r-sm);line-height:1.55;word-break:break-all;}#__hrs_greet__ .why b{margin-right:6px;}' +
      '#__hrs_greet__ .why.reject{background:var(--bad-50);color:var(--bad);}#__hrs_greet__ .why.review{background:var(--warn-50);color:var(--warn);}#__hrs_greet__ .why.pass{background:var(--ok-50);color:var(--ok-700);}' +
      '#__hrs_greet__ details.okc{margin:4px 0;}#__hrs_greet__ details.okc summary{cursor:pointer;color:var(--text-2);font-size:var(--fs-xs);}' +
      '#__hrs_greet__ .l{border-bottom:1px dashed var(--line-2);}#__hrs_greet__ .l.pass{color:var(--ok);}#__hrs_greet__ .l.err{color:var(--bad);font-weight:600;}#__hrs_greet__ .l.warn,#__hrs_greet__ .l.tip{color:var(--warn);}#__hrs_greet__ .l.dry{color:var(--info);}' +
      '</style>' +
      '<div class="h"><b>打招呼</b><span class="v">v' + VERSION + '</span><span class="m"><button data-g="stop">停止</button><button data-g="dry">试运行</button><button data-g="live">正式运行</button></span></div>' +
      // v1.9.27 布局：上面是当前这个人的匹配情况，下面「职位 / 日志」两个标签页切换，浮层不再拉得很长
      '<div class="bd"><div class="er"></div>' +
      '<div class="pc" style="display:flex;align-items:center;gap:6px;padding:6px 12px;border-bottom:1px solid var(--line);">打招呼节拍<button data-a="pm">-</button><input class="pv" type="number" min="10" max="600" style="width:56px;text-align:center;border:1px solid var(--field);border-radius:var(--r-sm);padding:1px 4px;font-size:var(--fs-sm);"><button data-a="pp">+</button>秒/个</div>' +
      '<div class="sm"></div>' +
      '<div class="rc"></div>' +
      '<div class="ctl"><button data-a="pause"></button><button data-a="clr">清除停止状态</button><button data-a="dump">采集控件</button><button class="off" data-a="off">全关打招呼</button></div>' +
      '<div class="dp" style="display:none;padding:6px 12px;border-bottom:1px solid var(--line);"><div style="display:flex;gap:6px;margin-bottom:4px;"><button data-a="copy">复制控件信息</button><button data-a="hide">收起</button></div><pre style="white-space:pre-wrap;max-height:160px;overflow:auto;background:var(--surface-2);padding:4px;margin:0;font:10px Consolas,monospace"></pre></div>' +
      '<div class="tb"><span data-t="log">日志</span><span data-t="job">职位</span></div>' +
      '<div class="tp" data-p="log"><div class="lg"></div></div>' +
      '<div class="tp" data-p="job"><div class="st"></div></div>' +
      '</div>';
    if (!ui.isConnected) document.documentElement.appendChild(ui);
    ui.querySelector('.h').addEventListener('click', function (e) {
      var g = e.target && e.target.getAttribute && e.target.getAttribute('data-g');
      if (!g) { if (ui.__dragged && Date.now() - ui.__dragged < 300) return; ui.classList.toggle('min'); return; }
      // v1.9.0 浮层上直接切打招呼的运行模式
      if (g === 'live' && !confirm('切到「正式运行」后会自动点打招呼，确定？')) return;
      chrome.runtime.sendMessage({ type: 'SAVE_SETTINGS', patch: { greetMode: g, __site: SITE } }, function () {});
      st.stopReason = '';
    });
    ui.querySelector('.pv').addEventListener('change', function () { setPace(this.value); });
    makeDraggable(ui, ui.querySelector('.h'), 'hrsGreetPos');
    // v2.6.8 外框四边四角都能拖改大小；「当前候选人」和「日志」下面各一条横线，上下拖改高度
    if (window.HRSPanel) {
      HRSPanel.resizable({ box: ui, head: ui.querySelector('.h'), body: ui.querySelector('.bd'), key: 'hrsGreetSize', posKey: 'hrsGreetPos', minW: 320, minH: 180 });
      // v2.7.0 里面的分隔线去掉，改成自动适应；之前拖过的高度清掉
      try { localStorage.removeItem('hrsGreetRcH'); localStorage.removeItem('hrsGreetLgH'); } catch (e) {}
    }
    var setTab = function (t) {
      ui.querySelectorAll('.tb span').forEach(function (x) { x.classList.toggle('on', x.getAttribute('data-t') === t); });
      ui.querySelectorAll('.tp').forEach(function (x) { x.classList.toggle('on', x.getAttribute('data-p') === t); });
      try { localStorage.setItem('hrsGreetTab', t); } catch (e) {}
      if (t === 'log') { var lg = ui.querySelector('.lg'); lg.scrollTop = lg.scrollHeight; }
    };
    ui.querySelector('.tb').addEventListener('click', function (e) { var t = e.target.getAttribute('data-t'); if (t) setTab(t); });
    var t0 = 'log'; try { t0 = localStorage.getItem('hrsGreetTab') || 'log'; } catch (e) {}
    setTab(t0);
    ui.querySelector('.bd').addEventListener('click', function (e) {
      var a = e.target.getAttribute('data-a');
      if (a === 'pause') {
        st.paused = !st.paused;
        if (!st.paused && breaker) breaker.cancel();   // v2.3.0 手动继续时不再等小憩
        if (!st.paused && st.stopReason) { st.stopReason = ''; st.stopKind = ''; st.labelMiss = 0; st.selectFail = 0; }
        say('', st.paused ? '已暂停' : '继续');
      }
      if (a === 'clr') { st.stopReason = ''; st.exhausted = {}; st.swTry = {}; st.labelMiss = 0; st.selectFail = 0; st.greetMiss = 0; say('', '已清除停止状态，继续按计划'); }
      if (a === 'dump') {
        var d = st.lastDump || collectDump('手动采集');
        if (!st.lastDump) dumpNow('手动采集');
        var dp = ui.querySelector('.dp'); dp.style.display = 'block';
        dp.querySelector('pre').textContent = JSON.stringify(d, null, 1);
        st.lastDump = null;
      }
      if (a === 'hide') ui.querySelector('.dp').style.display = 'none';
      if (a === 'pm' || a === 'pp') setPace(pace() + (a === 'pp' ? 5 : -5));
      if (a === 'copy') {
        var txt = ui.querySelector('.dp pre').textContent;
        (navigator.clipboard ? navigator.clipboard.writeText(txt) : Promise.reject()).then(function () { say('', '控件信息已复制，可直接粘贴提交到 GitHub Issue（先脱敏）'); },
          function () { var r = document.createRange(); r.selectNodeContents(ui.querySelector('.dp pre')); var sel = getSelection(); sel.removeAllRanges(); sel.addRange(r); say('tip', '已选中控件信息，请按 Ctrl+C 复制'); });
      }
      if (a === 'off') {
        chrome.runtime.sendMessage({ type: 'SAVE_SETTINGS', patch: { greetMode: 'stop', __site: SITE } }, function () {});
        say('', '已全关打招呼（运行模式改为停止）');
      }
      render();
    });
    return ui;
  }
  var TAG = { pass: '[完成]', err: '[失败]', warn: '[跳过]', tip: '[提示]', dry: '[试运行]', '': '[信息]' };
  // v1.9.6 浮层可以按住标题栏拖动，位置记在本页面

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
  function makeDraggable(box, handle, key) {
    try { var sv = JSON.parse(localStorage.getItem(key) || 'null'); if (sv) { box.style.left = sv.x + 'px'; box.style.top = sv.y + 'px'; box.style.right = 'auto'; box.style.bottom = 'auto'; } } catch (e) {}
    keepInView(box, key);
    var drag = null;
    handle.style.cursor = 'move';
    handle.addEventListener('mousedown', function (e) {
      if (e.target.closest('button,input,a')) return;
      var r = box.getBoundingClientRect();
      drag = { dx: e.clientX - r.left, dy: e.clientY - r.top, moved: false };
      e.preventDefault();
    });
    document.addEventListener('mousemove', function (e) {
      if (!drag) return;
      drag.moved = true;
      var x = Math.max(0, Math.min(window.innerWidth - 120, e.clientX - drag.dx)), y = Math.max(0, Math.min(window.innerHeight - 40, e.clientY - drag.dy));
      box.style.left = x + 'px'; box.style.top = y + 'px'; box.style.right = 'auto'; box.style.bottom = 'auto';
    });
    document.addEventListener('mouseup', function () {
      if (drag && drag.moved) { try { var r = box.getBoundingClientRect(); localStorage.setItem(key, JSON.stringify({ x: Math.round(r.left), y: Math.round(r.top) })); } catch (e) {} box.__dragged = Date.now(); }
      drag = null;
    });
  }
  function setPace(v) {
    v = Math.min(600, Math.max(10, parseInt(v, 10) || 45));
    st.settings.greetPaceSec = v;
    chrome.runtime.sendMessage({ type: 'SAVE_SETTINGS', patch: { greetPaceSec: v } }, function () {});
    say('', '打招呼节拍改为 ' + v + ' 秒/个');
  }
  function say(cls, text) {
    if (!ui && !isRecommendPage()) return;   // 只帮别的页面点下拉 / 筛选时，不在本页面弹浮层
    ensureUi();
    var lg = ui.querySelector('.lg'), d = document.createElement('div');
    var t = new Date().toLocaleTimeString('zh-CN', { hour12: false });
    d.className = 'l ' + (cls || '');
    d.textContent = t + ' ' + (TAG[cls || ''] || '[信息]') + ' ' + text;
    lg.appendChild(d);
    while (lg.children.length > 80) lg.removeChild(lg.firstChild);
    lg.scrollTop = lg.scrollHeight;
    if (cls === 'err') {
      st.lastErr = t + ' ' + text;
      // v2.3.0 报错 / 停止同时进运行记录（原因按文字归类）
      if (RL) { var cat = RL.classify('', text); runAdd(cat === 'verify' || cat === 'limit' ? '验证' : (/已停止|停止/.test(text) ? '停止' : '提示'), '', false, { why: text }, text); }
    }
  }
  function preview(t) { t = String(t || '').replace(/\s+/g, ' ').trim(); return t.length > 24 ? t.slice(0, 24) + '…' : t; }
  function render() {
    if (!ui) return;
    var m = mode(), L = logToday();
    ui.querySelectorAll('.m button').forEach(function (b) { b.classList.toggle('on', b.getAttribute('data-g') === m); });
    ui.classList.toggle('bad', !!st.stopReason && /停止|失败|拦截/.test(st.stopReason));
    var er = ui.querySelector('.er');
    er.style.display = st.stopReason ? 'block' : 'none';
    er.textContent = st.stopReason;
    var left = Math.max(0, Math.ceil((st.nextAt - Date.now()) / 1000));
    var pv = ui.querySelector('.pv');
    if (pv && document.activeElement !== pv) pv.value = pace();
    // v1.9.28 第 1 行节拍，第 2 行今日汇总，第 3 行当前职位和状态，下面才是匹配条件
    ui.querySelector('.sm').innerHTML = (m === 'stop' ? '<div style="color:var(--warn)">处于「停止」，点右上角「试运行」或「正式运行」开始</div>' : '') +
      '<div>今日 扫 ' + (L.scan || 0) + ' · 过 ' + (L.pass || 0) + ' · 拒 ' + (L.reject || 0) + ' · 已打招呼 ' + L.total + ' / ' + cap() + '</div>' +
      (SITE === 'boss' ? '<div style="font-weight:400;color:var(--text-2);">执行方式：' + (useRpa() ? 'RPA 真实鼠标键盘' + (st.rpaHold && Date.now() < st.rpaHold.until ? ' · <b style="color:var(--warn)">等待中：' + esc(st.rpaHold.why) + '</b>' : '') : '脚本点击（旧版，可在设置里改回 RPA）') + '</div>' : '') +
      '<div style="font-weight:400;color:var(--text-2);">' + esc(String(st.lastJob || '读取中').replace(/（对应岗位：[^）]*）/, '')) +
      (m === 'stop' ? ' · 已停止' : (st.paused ? ' · 已暂停' : (st.busy ? ' · 处理中' : (breaker && breaker.resting() ? ' · 小憩中 ' + breaker.left() + 's' : (left ? ' · 下一位 ' + left + 's' : ''))))) + '</div>';
    ui.querySelector('.st').innerHTML = '当前职位：' + esc(String(st.lastJob || '读取中').replace(/（对应岗位：[^）]*）/, '')) +
      '<div class="pl" style="max-height:150px;">' + (plannedJds().map(function (j) { var q = greetCfg(j).quota; return '<div><span>' + esc(j.title) + ((j.detail || {}).greet ? ' <i style="color:var(--accent);font-style:normal">详情</i>' : '') + '</span><b>' + doneOf(j) + '/' + (q === Infinity ? '不限' : q) + '</b></div>'; }).join('') || '<div>没有岗位开启打招呼</div>') + '</div>' +
      '';
    ui.querySelector('[data-a="pause"]').textContent = st.paused ? '继续' : '暂停';
    reportStatus();
  }
  function renderResult(info, jd, res) {
    var box = ui.querySelector('.rc');
    var vd = { pass: ['合格', 'var(--ok)'], reject: ['不合格', 'var(--bad)'], review: ['跳过', 'var(--warn-500)'] }[res.verdict];
    var h = res.hits || {};
    var html = '<div><b>' + esc(info.name) + '</b> <span style="color:var(--text-2)">' + esc(jd.title) + '</span> <span style="float:right;color:var(--on-color);background:' + vd[1] + ';border-radius:var(--r-md);padding:0 8px;font-weight:600">' + vd[0] + '</span></div>';
    // v2.7.0 最上面：候选人基本信息 + 结论原因（不合格 / 跳过时红色、黄色写清楚为什么）
    var base = String(info.baseLine || '').replace(/\s*[|｜]\s*/g, ' ').replace(/\s+/g, ' ').trim().split(' ').filter(Boolean).join(' · ');
    var W0 = (info.rowsW || [])[0];
    var eduL = (info.workLines || []).filter(function (l) { return /(本科|硕士|博士|大专|专科|学士)\s*$/.test(l); })[0] || '';
    var kv = function (k, v) { return v ? '<div class="kv"><span>' + k + '</span><b>' + esc(v) + '</b></div>' : ''; };
    html += '<div class="who">' + kv('基本', base) + kv('期望', [info.city, info.expectJob].filter(Boolean).join(' · ')) +
      kv('最近', W0 ? (W0.parts.join(' · ') + (W0.dt && W0.dt !== '-' ? '（' + W0.dt + '）' : '')) : '') + kv('学历', eduL.replace(/^\S+\s+/, '')) + '</div>';
    var why = (res.reasons || [])[0] || '';
    if (res.verdict !== 'pass') html += '<div class="why ' + res.verdict + '"><b>' + (res.verdict === 'reject' ? '不打招呼' : '跳过') + '</b>' + esc(why.replace(/^不满足要求：/, '')) + '</div>';
    else html += '<div class="why pass"><b>会打招呼</b>' + esc(why.replace(/^要求全部满足：/, '')) + '</div>';
    // v2.6.5 Job relevance：每段工作和招聘岗位对不对得上（放在最上面，一眼看到）
    // v3.5.0 一一对应：每段工作标「本岗位 / 同方向 / 不是这个岗位」，有一段对上就通过，期望岗位只作参考
    (h.relevance || []).forEach(function (R) {
      var col = R.score == null ? 'var(--warn)' : R.score >= 100 ? 'var(--ok)' : 'var(--bad)';
      var LV = { same: ['本岗位', 'var(--ok)', 'var(--ok-50)'], direct: ['同方向', 'var(--ok)', 'var(--ok-50)'], other: ['不是这个岗位', 'var(--bad)', 'var(--bad-50)'],
        ambiguous: ['看不出', 'var(--warn)', 'var(--warn-50)'], unknown: ['看不到职位', 'var(--text-2)', 'var(--surface-2)'], school: ['在校期间', 'var(--muted)', 'var(--surface-2)'],
        near: ['相近', 'var(--warn)', 'var(--warn-50)'], none: ['不相关', 'var(--bad)', 'var(--bad-50)'] };
      var step2 = R.did ? '<div style="font-size:var(--fs-xs);color:var(--ok);margin:0 0 3px">② 做过本岗位：' + esc(R.did) + '，通过</div>'
        : R.match ? '<div style="font-size:var(--fs-xs);color:var(--ok);margin:0 0 3px">② 做过同方向岗位：' + esc(R.match) + '，通过</div>'
          : '<div style="font-size:var(--fs-xs);color:' + col + ';margin:0 0 3px">② ' + (R.score == null ? '有的工作职位看不全或看不出方向，跳过' : '工作经历里没有和「' + esc(R.position || R.target) + '」一一对应的岗位，不打招呼') + '</div>';
      html += '<div class="jr" style="margin:6px 0 4px;padding:7px 8px;border:1px solid var(--line);border-radius:var(--r-md);background:var(--surface)">' +
        '<div style="display:flex;align-items:center;gap:6px"><b style="font-size:var(--fs-sm);color:var(--text)">Job relevance</b><span style="color:var(--text-2);font-size:var(--fs-xs);flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="' + esc(R.target) + '">招：' + esc(R.position || R.target) + '</span>' +
        (R.grade ? '<span style="color:var(--on-color);background:' + col + ';border-radius:var(--r-md);padding:0 8px;font-size:var(--fs-xs);font-weight:600">' + esc(R.grade) + '</span>' : '') + '</div>' +
        '<div style="height:4px;margin:5px 0 6px;background:var(--bg);border-radius:var(--r-xs);overflow:hidden"><i style="display:block;height:100%;width:' + (R.score == null ? 50 : R.score) + '%;background:' + col + '"></i></div>' +
        (R.expect ? '<div style="font-size:var(--fs-xs);color:var(--text-2);margin:-2px 0 3px">① ' + esc(R.expect) + '</div>' : '') + step2 +
        R.rows.map(function (x) {
          var lv = LV[x.level] || LV.other;
          return '<div style="display:flex;gap:6px;align-items:baseline;font-size:var(--fs-sm);line-height:1.5;padding:2px 0;border-top:1px dashed var(--bg)">' +
            '<span style="flex:none;width:96px;color:var(--muted)">' + esc(x.dt || '时间未写') + '</span>' +
            '<span style="flex:1;min-width:0;color:var(--text)">' + esc(x.text) + (x.why ? '<span style="color:var(--muted)">（' + esc(x.why) + '）</span>' : '') + '</span>' +
            '<span style="flex:none;color:' + lv[1] + ';background:' + lv[2] + ';border-radius:var(--r-sm);padding:0 5px;white-space:nowrap">' + lv[0] + '</span></div>';
        }).join('') + '</div>';
    });
    var rows = h.rows || [];
    var tr = function (r) { return '<tr class="' + (r.ok === true ? 'ok' : r.ok === false ? 'bad' : 'unk') + '"><td class="s">' + (r.ok === true ? '✓' : r.ok === false ? '✗' : '?') + '</td><td style="width:46%;color:var(--text-2)">' + esc(r.rule) + '</td><td>' + esc(r.got) + '</td></tr>'; };
    // v2.7.0 没过的条件直接显示，通过的收起来（点开看），面板不再被一长串 ✓ 占满
    var badRows = rows.filter(function (r) { return r.ok !== true; }), okRows = rows.filter(function (r) { return r.ok === true; });
    if (badRows.length) html += '<table>' + badRows.map(tr).join('') + '</table>';
    if (okRows.length) html += '<details class="okc"' + (st.okOpen ? ' open' : '') + '><summary>其余 ' + okRows.length + ' 条通过</summary><table>' + okRows.map(tr).join('') + '</table></details>';
    if (!rows.length) html += '<div>' + esc(res.reasons.join('。')) + '</div>';
    var all = h.bonusAll || [], on = h.optionalHit || [];
    if (all.length) html += '<div>加分 ' + on.length + '/' + all.length + '：' + all.map(function (k) { return '<span class="chip' + (on.indexOf(k) >= 0 ? ' on' : '') + '">' + esc(k) + '</span>'; }).join('') + '</div>';
    html += '<details><summary style="cursor:pointer;color:var(--text-2)">读到的原文</summary><pre style="white-space:pre-wrap;max-height:110px;overflow:auto;background:var(--surface-2);padding:4px;margin:2px 0;font:11px Consolas,monospace">' +
      esc('期望：' + info.city + ' · ' + info.expectJob + '\n工作经历：\n' + info.workLines.join('\n') + '\n\n全文：' + info.summary + (info.detailText ? '\n\n简历详情：\n' + info.detailText.slice(0, 4000) : '')) + '</pre></details>';
    box.innerHTML = html;
    box.style.display = 'block';
    var oc = box.querySelector('details.okc');
    if (oc) oc.addEventListener('toggle', function () { st.okOpen = oc.open; });
  }

  load().then(function () {
    setInterval(tick, 1000);
    setInterval(function () { render(); }, 1000);
    if (isRecommendPage()) { ensureUi(); say('', '打招呼模块已加载（' + modeLabel() + '）。在「打招呼 · 岗位计划」里开启'); render(); }
  });
})();
