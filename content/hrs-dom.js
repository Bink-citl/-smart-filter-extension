/**
 * hrs-dom.js v1.6.0：打招呼 / 抓取职位共用的页面操作工具
 * 鼠标模拟说明：浏览器扩展只能派发「脚本事件」，平台技术上能分辨出这不是真人点击。
 * 这里做的是放慢节奏、先滚动再停顿、沿路径移动后再点，降低操作的机械感，不绕过任何验证。
 */
(function () {
  'use strict';
  if (window.HRSDom) return;

  function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
  function rand(a, b) { return a + Math.random() * (b - a); }
  function textOf(el) { return el ? String(el.innerText != null && el.innerText !== '' ? el.innerText : el.textContent || '').trim() : ''; }
  // v1.9.22 全角半角统一：Boss 不同页面里职位名的括号有的是（），有的是 ()
  function norm(s) { s = String(s == null ? '' : s); try { s = s.normalize('NFKC'); } catch (e) {} return s.replace(/\s+/g, '').toLowerCase(); }
  function rectOf(el) { try { return el.getBoundingClientRect(); } catch (e) { return { left: 0, top: 0, right: 0, bottom: 0, width: 0, height: 0 }; } }
  function visible(el) {
    if (!el || !el.isConnected) return false;
    var r = rectOf(el);
    if (!r.width || !r.height) return false;
    var cs = window.getComputedStyle ? getComputedStyle(el) : null;
    return !cs || (cs.visibility !== 'hidden' && cs.display !== 'none' && cs.opacity !== '0');
  }
  function qsa(sel, root) { try { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); } catch (e) { return []; } }
  /** 页面上文字完全等于 text 的可见元素（取最外层那个，比如 button 而不是里面的 span） */
  function byExactText(text, root) {
    var hits = qsa('button,a,span,div,li,p,em,b,label', root).filter(function (el) {
      return visible(el) && textOf(el).replace(/\s+/g, '') === text;
    });
    return hits.filter(function (el) { return !hits.some(function (o) { return o !== el && o.contains(el) && textOf(o).replace(/\s+/g, '') === text && o.tagName !== 'DIV'; }); });
  }
  function leaves(root) {
    return qsa('*', root).filter(function (el) {
      if (el.children.length) return false;
      if (/^(SCRIPT|STYLE|SVG|PATH|IMG|INPUT|TEXTAREA)$/i.test(el.tagName)) return false;
      return textOf(el) && visible(el);
    });
  }

  var last = { x: rand(200, 600), y: rand(200, 500) };
  function fire(el, type, x, y, extra) {
    if (!el) return;
    var opts = Object.assign({ bubbles: true, cancelable: true, view: window, clientX: x, clientY: y, screenX: x, screenY: y, button: 0, buttons: /down|move/.test(type) && extra && extra.pressed ? 1 : 0 }, extra || {});
    var Ctor = /^pointer/.test(type) && window.PointerEvent ? PointerEvent : MouseEvent;
    try { el.dispatchEvent(new Ctor(type, opts)); } catch (e) { try { el.dispatchEvent(new MouseEvent(type, opts)); } catch (e2) {} }
  }
  /** 沿一条略带弧度的路径把鼠标移到元素上（随机落点在元素中间区域） */
  function moveTo(el) {
    var r = rectOf(el);
    var tx = r.left + r.width * rand(0.3, 0.7), ty = r.top + r.height * rand(0.35, 0.65);
    var sx = last.x, sy = last.y, steps = Math.round(rand(10, 22));
    var bend = rand(-40, 40);
    var i = 0;
    return new Promise(function (resolve) {
      (function step() {
        i++;
        var t = i / steps, e = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
        var x = sx + (tx - sx) * e + Math.sin(t * Math.PI) * bend, y = sy + (ty - sy) * e + Math.sin(t * Math.PI) * bend * 0.4;
        var under = (document.elementFromPoint && document.elementFromPoint(x, y)) || el;
        fire(under, 'pointermove', x, y); fire(under, 'mousemove', x, y);
        if (i < steps) setTimeout(step, rand(12, 35));
        else {
          last = { x: tx, y: ty };
          fire(el, 'pointerover', tx, ty); fire(el, 'mouseover', tx, ty); fire(el, 'mouseenter', tx, ty);
          resolve({ x: tx, y: ty });
        }
      })();
    });
  }
  function leave(el) {
    if (!el) return;
    var r = rectOf(el);
    ['pointerout', 'pointerleave', 'mouseout', 'mouseleave'].forEach(function (t) { fire(el, t, r.right + 30, r.top - 30); });
  }
    function hover(el) { return moveTo(el).then(function () { return sleep(rand(150, 400)); }); }
  // v1.7.6 点击落在「这个坐标下最里层的元素」上：页面的点击处理可能挂在按钮里面的文字上，
  // 事件只会往外冒泡，不会往里传，所以对外层按钮派发事件，里层的处理函数收不到
  function targetAt(el, x, y) {
    var t = document.elementFromPoint ? document.elementFromPoint(x, y) : null;
    if (t && (t === el || el.contains(t))) return t;
    return el;
  }
  function click(el) {
    return moveTo(el).then(function (p) {
      var t = targetAt(el, p.x, p.y);
      return sleep(rand(90, 260)).then(function () {
        fire(t, 'pointerdown', p.x, p.y, { pressed: true }); fire(t, 'mousedown', p.x, p.y, { pressed: true });
        return sleep(rand(60, 150));
      }).then(function () {
        fire(t, 'pointerup', p.x, p.y); fire(t, 'mouseup', p.x, p.y); fire(t, 'click', p.x, p.y);
        return p;
      });
    });
  }
  /** 元素中心点换算成最外层页面的坐标（内嵌页面要加上外框的偏移），给「真实鼠标点击」用 */
  function topPoint(el) {
    var r = rectOf(el);
    var x = r.left + r.width * rand(0.35, 0.65), y = r.top + r.height * rand(0.4, 0.6);
    var w = window;
    try {
      while (w !== w.top && w.frameElement) {
        var fr = w.frameElement.getBoundingClientRect();
        x += fr.left; y += fr.top;
        w = w.parent;
      }
    } catch (e) { return null; }
    return { x: Math.round(x), y: Math.round(y) };
  }
  /**
   * 真实鼠标点击：页面只认真人点击（isTrusted）时用。由后台通过浏览器调试接口发出系统级鼠标事件。
   * 浏览器顶部会出现「Smart Filter 已开始调试此浏览器」提示条，这是 Chrome 的强制提示。
   */
  function trustedClick(el) {
    try { window.__hrsSelfTrustedAt = Date.now(); } catch (e0) {}
    var p = topPoint(el);
    if (!p) return Promise.resolve({ ok: false, why: '算不出按钮在页面上的位置' });
    return new Promise(function (resolve) {
      try { chrome.runtime.sendMessage({ type: 'TRUSTED_CLICK', x: p.x, y: p.y }, function (r) { resolve(r || { ok: false, why: '后台没有回应' }); }); }
      catch (e) { resolve({ ok: false, why: String(e && e.message || e) }); }
    });
  }
    function trustedHover(el) {
    var p = topPoint(el);
    if (!p) return Promise.resolve({ ok: false });
    return new Promise(function (resolve) {
      try { chrome.runtime.sendMessage({ type: 'TRUSTED_MOVE', x: p.x, y: p.y }, function (r) { resolve(r || { ok: false }); }); }
      catch (e) { resolve({ ok: false }); }
    });
  }
    /** 控件采集：不用按 F12，直接把元素和它的上下级、坐标下真正接收点击的元素记下来 */
  function describe(el) {
    if (!el || !el.tagName) return null;
    var attrs = {};
    Array.prototype.forEach.call(el.attributes || [], function (a) { if (a.name !== 'style' && String(a.value).length < 120) attrs[a.name] = a.value; });
    var r = rectOf(el);
    return { tag: el.tagName.toLowerCase(), attrs: attrs, text: textOf(el).slice(0, 40), rect: [Math.round(r.left), Math.round(r.top), Math.round(r.width), Math.round(r.height)], children: el.children.length };
  }
  function dumpControl(el) {
    if (!el) return null;
    var chain = [], cur = el;
    for (var i = 0; i < 6 && cur && cur !== document.body; i++) { chain.push(describe(cur)); cur = cur.parentElement; }
    var r = rectOf(el), cx = r.left + r.width / 2, cy = r.top + r.height / 2;
    var hit = document.elementFromPoint ? document.elementFromPoint(cx, cy) : null;
    return {
      frame: { url: location.href, isTop: window === window.top },
      target: describe(el),
      ancestors: chain.slice(1),
      inner: qsa('*', el).slice(0, 8).map(describe),
      atCenter: describe(hit),
      atCenterInside: !!(hit && (hit === el || el.contains(hit))),
      topPoint: topPoint(el)
    };
  }
  function scrollIntoViewSoft(el) {
    try { el.scrollIntoView({ behavior: 'smooth', block: 'center' }); } catch (e) { try { el.scrollIntoView(); } catch (e2) {} }
    return sleep(rand(600, 1300));
  }
  function pressEscape() {
    ['keydown', 'keyup'].forEach(function (t) {
      try { document.dispatchEvent(new KeyboardEvent(t, { key: 'Escape', code: 'Escape', keyCode: 27, which: 27, bubbles: true })); } catch (e) {}
    });
  }
  function waitFor(fn, timeout, interval) {
    var end = Date.now() + (timeout || 4000);
    return new Promise(function (resolve) {
      (function poll() {
        var v = null;
        try { v = fn(); } catch (e) {}
        if (v) return resolve(v);
        if (Date.now() > end) return resolve(null);
        setTimeout(poll, interval || 250);
      })();
    });
  }

  // 出现这些字样就立即停止：验证、频繁、额度用完
  var RISK_RE = /(安全验证|人机验证|验证码|滑块|拖动滑块|请完成验证|操作(过于)?频繁|访问异常|账号(存在)?异常|今日.{0,8}(已达|达到|用完).{0,6}(上限|次数)|(沟通|打招呼|开聊).{0,6}(上限|次数已用完|已用完)|权益(不足|已用完)|次数不足)/;
  // v2.3.0 strict：沟通页用。聊天记录的 class 里也带 message，候选人消息里写「验证码」不能算风控，所以不看 message 类元素
  function riskSignal(strict) {
    var sel = strict
      ? '[class*="dialog"],[class*="modal"],[class*="toast"],[class*="verify"],[class*="captcha"],[class*="geetest"],[role="dialog"],[role="alert"]'
      : '[class*="dialog"],[class*="modal"],[class*="toast"],[class*="popup"],[class*="message"],[class*="verify"],[class*="captcha"],[class*="geetest"],[role="dialog"],[role="alert"]';
    var boxes = qsa(sel).filter(function (b) { return visible(b) && !(b.closest && b.closest('#__hrs_ui__,#__hrs_greet__')) && !(strict && b.closest && b.closest('[class*="chat-message"],[class*="message-list"],[class*="msg-list"],[class*="conversation"]')); });
    for (var i = 0; i < boxes.length; i++) {
      var t = textOf(boxes[i]).slice(0, 300);
      var m = t.match(RISK_RE);
      if (m) return m[0] + '：' + t.replace(/\s+/g, ' ').slice(0, 60);
    }
    if (qsa('iframe[src*="captcha"],iframe[src*="verify"],iframe[src*="geetest"]').some(visible)) return '页面弹出了验证窗口';
    return '';
  }

  // =====================================================================
  // v1.9.48 BOSS RPA（复用 v1.9.2 本机 Python RPA 助手）：点击、滚动、打字、按键都交给本机 RPA 助手，用真实鼠标键盘完成
  // 插件这边负责三件事：
  //   ① 算出要点的位置（随机落在按钮中间区域），并确认那个位置没被别的东西挡住；
  //   ② 鼠标移过去后，用页面收到的「真实鼠标移动事件」核对鼠标实际落在哪，偏了就校准再移（闭环）；
  //   ③ 确认落点就在按钮上，才让助手按下鼠标。
  // 只在 Boss（zhipin.com）上、且设置「Boss 执行方式」为 RPA 时启用；猎聘完全不走这里。
  // =====================================================================
  var RP = { obs: null, lastPressAt: 0, inAct: false, pxPerNotch: 100, mode: 'rpa', heldAt: 0, held: null, quickUntil: 0 };
  // 内嵌页面没有自己的域名（about:blank / srcdoc）时，看最外层页面是不是 Boss
  var IS_BOSS = /(^|\.)zhipin\.com$/i.test(location.hostname) || (function () { try { return !location.hostname && /(^|\.)zhipin\.com$/i.test(window.top.location.hostname); } catch (e) { return false; } })();
  RP.rhythm = null;   // v2.3.0 拟人节奏设置（services/rhythm.js）
  try {
    chrome.storage.local.get('settings', function (o) { RP.mode = (o && o.settings && o.settings.bossExec) || 'rpa'; RP.rhythm = (o && o.settings && o.settings.rhythm) || null; });
    chrome.storage.onChanged.addListener(function (ch, area) {
      if (area === 'local' && ch.settings && ch.settings.newValue) { RP.mode = ch.settings.newValue.bossExec || 'rpa'; RP.rhythm = ch.settings.newValue.rhythm || null; }
    });
  } catch (e) {}
  function RH() { return window.HRSRhythm || null; }
  function RL() { return window.HRSRunLog || null; }
  // v2.3.0 这一页属于哪个模块：推荐页 = 打招呼，沟通页 = 智选（运行记录里用）
  function runMod() {
    var p = '';
    try { p = window.top.location.pathname + window.top.location.hash; } catch (e) { p = location.pathname + location.hash; }
    if (/recommend/i.test(p)) return '打招呼';
    if (/^\/web\/chat\/(index|im)(\/|$|#|\?)/i.test(p) || (!IS_BOSS && /\/(chat|im|message|msg)(\/|$|#)/i.test(p))) return '智选';
    return '';
  }
  // v2.3.0 记一条运行记录（只记智选 / 打招呼页面上的动作）
  function runLog(act, target, r, via) {
    var L = RL(), mod = runMod();
    if (!L || !mod) return;
    r = r || {};
    L.add({ mod: mod, act: act, target: target, ok: !!r.ok, code: r.code, why: r.why, via: via || 'rpa' });
  }
  // v2.3.0 最近一次失败（上层「发消息没成功」时拿来说明原因）
  RP.lastFail = null;
  function noteFail(r) { if (r && !r.ok) RP.lastFail = { at: Date.now(), code: r.code || '', why: r.why || '' }; return r; }
  function lastFailSince(t) { return RP.lastFail && RP.lastFail.at >= t ? RP.lastFail : null; }
  // v2.3.0 动作前的拟人停顿：每次长短不一，偶尔犹豫久一点
  function rhythmGap(kind) {
    var R = RH();
    var ms = R ? R.gapMs(RP.rhythm, kind) : 0;
    return ms > 0 ? sleep(ms) : Promise.resolve();
  }
  function rpaOn() { return IS_BOSS && RP.mode !== 'script'; }

  // 页面收到的真实鼠标位置（isTrusted 的鼠标事件才算，脚本派发的不算）
  function onTrustedMove(e) { if (e.isTrusted) RP.obs = { x: e.clientX, y: e.clientY, t: Date.now() }; }
  try {
    window.addEventListener('mousemove', onTrustedMove, { capture: true, passive: true });
    window.addEventListener('pointermove', onTrustedMove, { capture: true, passive: true });
    window.addEventListener('mouseover', onTrustedMove, { capture: true, passive: true });
    // 鼠标离开本页面（进了外层页面或别的内嵌页面）：本页面记的位置作废，改问别的页面
    window.addEventListener('mouseout', function (e) {
      if (e.isTrusted && !e.relatedTarget) RP.obs = { x: e.clientX, y: e.clientY, t: Date.now(), out: true };
    }, { capture: true, passive: true });
  } catch (e) {}
  // 本页面在最外层页面里的偏移（内嵌页面要加上外框位置和边框）
  function frameOffset() {
    var x = 0, y = 0, w = window;
    try {
      while (w !== w.top) {
        var fe = w.frameElement;
        if (!fe) return null;
        var r = fe.getBoundingClientRect();
        x += r.left + (fe.clientLeft || 0); y += r.top + (fe.clientTop || 0);
        w = w.parent;
      }
    } catch (e) { return null; }
    return { x: x, y: y };
  }
  try {
    chrome.runtime.onMessage.addListener(function (msg, sender, reply) {
      if (!msg || msg.type !== 'HRS_MM_QUERY') return;
      if (!RP.obs || RP.obs.out || RP.obs.t < (msg.since || 0)) return;   // 鼠标不在本页面，不回应
      var off = frameOffset();
      if (!off) return;
      reply({ x: RP.obs.x + off.x, y: RP.obs.y + off.y, t: RP.obs.t, top: window === window.top });
    });
  } catch (e) {}

  function topSize() {
    try { return { w: window.top.innerWidth, h: window.top.innerHeight }; } catch (e) { return { w: window.innerWidth, h: window.innerHeight }; }
  }
  function env(extra) {
    var s = topSize();
    var base = { dpr: window.devicePixelRatio || 1, innerW: s.w, innerH: s.h };
    if (Date.now() < RP.quickUntil) base.idle = 1.5;   // 你刚手动点了按钮让它发：只等你松手 1.5 秒
    return Object.assign(base, extra || {});
  }
  function rpaQuick(ms) { RP.quickUntil = Date.now() + (ms || 15000); }
  function rpaCall(op, args) {
    return new Promise(function (resolve) {
      try {
        chrome.runtime.sendMessage({ type: 'RPA_OP', op: op, args: args || {} }, function (r) {
          var le = chrome.runtime.lastError;
          resolve(r || { ok: false, code: 'noreply', why: le ? '插件后台没回应：' + le.message : '插件后台没回应（插件刚重载过就刷新一下 Boss 页面）' });
        });
      } catch (e) { resolve({ ok: false, code: 'noreply', why: '插件已重载，请刷新 Boss 页面（' + (e && e.message || e) + '）' }); }
    });
  }
  // 这些情况不是「点了没用」，而是「现在不能动鼠标」：调用方应该等一会儿再来，而不是判失败
  var HOLD_CODES = { user_active: 1, locked: 1, offline: 1, lna: 1, not_foreground: 1, no_window: 1, busy: 1, timeout: 1, covered_win: 1, noreply: 1 };
  function isHold(r) { return !!(r && !r.ok && HOLD_CODES[r.code]); }
  function noteHold(r) { if (isHold(r)) { RP.held = r; RP.heldAt = Date.now(); } return r; }
  function hiddenOverlays(on) {
    ['__hrs_greet__', '__hrs_ui__'].forEach(function (id) {
      var el = document.getElementById(id);
      if (el) el.style.visibility = on ? 'hidden' : '';
    });
  }
  // 一次完整动作占用鼠标：申请 → 切前台并核对窗口 → 做 → 释放
  // v1.9.48 同一个页面里的动作排队一个个来（前一个点完才开始下一个），避免两段动作交错抢鼠标
  RP.chain = Promise.resolve();
  // v2.3.0 kind：click / type / key / wheel / hover，决定动作前停顿多久；log：{ act, target } 做完记一条运行记录
  function session(fn, kind, log) {
    var run = function () {
      return rhythmGap(kind).then(function () { return session0(fn); }).then(function (r) {
        noteFail(r);
        if (log) runLog(log.act, log.target, r, 'rpa');
        else if (r && !r.ok && !isHold(r)) runLog(kind === 'wheel' ? '滚动' : (kind === 'hover' ? '悬停' : '动作'), '', r, 'rpa');
        return r;
      });
    };
    var p = RP.chain.then(run, run);
    RP.chain = p.then(function () {}, function () {});
    return p;
  }
  function session0(fn) {
    return rpaCall('acquire', {}).then(function (a) {
      if (!a.ok) return noteHold(a);
      return rpaCall('prepare', env()).then(function (p) {
        if (!p.ok) return noteHold(p);
        RP.inAct = true;
        hiddenOverlays(true);
        return Promise.resolve().then(fn);
      }).then(function (r) {
        RP.inAct = false; hiddenOverlays(false);
        rpaCall('release', {});
        if (r && !r.ok) noteHold(r);
        return r;
      }, function (e) {
        RP.inAct = false; hiddenOverlays(false);
        rpaCall('release', {});
        return { ok: false, code: 'error', why: String(e && e.message || e) };
      });
    });
  }
  function hitOk(el, x, y) {
    var h = document.elementFromPoint ? document.elementFromPoint(x, y) : null;
    return !!h && (h === el || el.contains(h));
  }
  function pickPoint(el, rel) {
    var r = rectOf(el);
    var cand = rel ? [rel] : [[rand(0.35, 0.65), rand(0.4, 0.6)], [0.5, 0.5], [0.3, 0.5], [0.7, 0.5], [0.5, 0.35], [0.5, 0.65], [0.2, 0.5], [0.8, 0.5]];
    for (var i = 0; i < cand.length; i++) {
      var x = r.left + r.width * cand[i][0], y = r.top + r.height * cand[i][1];
      if (x >= 1 && y >= 1 && x <= window.innerWidth - 1 && y <= window.innerHeight - 1 && hitOk(el, x, y)) return { x: x, y: y };
    }
    return null;
  }
  // 鼠标现在在哪（最外层页面坐标）：先看本页面收到的真实鼠标事件，没有再问别的内嵌页面
  function observe(since, moved) {
    var local = function () {
      if (RP.obs && !RP.obs.out && (RP.obs.t >= since || !moved)) { var off = frameOffset(); if (off) return { x: RP.obs.x + off.x, y: RP.obs.y + off.y, local: true }; }
      return null;
    };
    var o = local();
    if (o) return Promise.resolve(o);
    return sleep(160).then(function () {
      var o2 = local();
      if (o2) return o2;
      return new Promise(function (resolve) {
        try { chrome.runtime.sendMessage({ type: 'RPA_WHERE', since: since }, function (r) { void chrome.runtime.lastError; resolve(r && typeof r.x === 'number' ? r : null); }); }
        catch (e) { resolve(null); }
      });
    });
  }
  // 把鼠标移到某个点上并核对落点（不按下）。pick() 给出要去的点（本页面坐标），check(x,y) 判断实际落点算不算对
  function aimAt(pick, check, coveredWhy) {
    var p = pick();
    if (!p) return Promise.resolve({ ok: false, code: 'covered', why: coveredWhy ? coveredWhy() : '目标不在可视区域' });
    var off = frameOffset();
    if (!off) return Promise.resolve({ ok: false, code: 'frame', why: '算不出内嵌页面的位置' });
    var tries = 0;
    function go(moveArgs, op) {
      var since = Date.now();
      return rpaCall(op || 'move', env(moveArgs)).then(function (m) {
        if (!m.ok) return m;
        return sleep(m.moved ? rand(70, 120) : 30).then(function () { return observe(since, m.moved); }).then(function (o) {
          if (!o) return { ok: false, code: 'no_feedback', why: '鼠标移过去了，但页面没收到鼠标位置（浏览器窗口可能被挡住，或缩放 / 多屏换算对不上）。可在 rpa-helper 文件夹地址栏输入 cmd /k py diag_rpa.py 回车，看换算依据' };
          var tx = p.x + off.x, ty = p.y + off.y;
          var ex = tx - o.x, ey = ty - o.y;
          var lx = o.x - off.x, ly = o.y - off.y;
          var onTarget = check(lx, ly);
          if (Math.abs(ex) <= 3 && Math.abs(ey) <= 3 && onTarget) return { ok: true, x: lx, y: ly };
          if (++tries > 3) {
            if (onTarget) return { ok: true, x: lx, y: ly, off: [ex, ey] };
            return { ok: false, code: 'miss', why: '校准 3 次后鼠标仍没落在目标上（偏差 ' + Math.round(ex) + ',' + Math.round(ey) + ' 像素）' };
          }
          // 偏一点点但在目标上：只把误差告诉助手（它记住，下次直接准），不再挪
          if (onTarget && Math.abs(ex) <= 8 && Math.abs(ey) <= 8) {
            return rpaCall('calib', env({ ex: ex, ey: ey, move: false })).then(function () { return { ok: true, x: lx, y: ly }; });
          }
          // 偏得多：告诉助手误差，并挪到修正后的位置再核对一次
          p = pick() || p;   // 元素可能因为悬停变了位置，重新取点
          return go({ ex: ex, ey: ey, move: true, x: p.x + off.x, y: p.y + off.y }, 'calib');
        });
      });
    }
    return go({ x: p.x + off.x, y: p.y + off.y });
  }
  function aim(el, opts) {
    opts = opts || {};
    return aimAt(function () { return pickPoint(el, opts.rel); }, function (x, y) { return hitOk(el, x, y); }, function () {
      var c = rectOf(el), hit = document.elementFromPoint ? document.elementFromPoint(c.left + c.width / 2, c.top + c.height / 2) : null;
      return '目标被别的东西挡住或不在可视区域（挡住它的是：' + (hit ? (hit.tagName.toLowerCase() + ' ' + textOf(hit).slice(0, 16)) : '无') + '）';
    });
  }
  function scrollParentOf(el) {
    var cur = el.parentElement;
    while (cur && cur !== document.body && cur !== document.documentElement) {
      try {
        var cs = getComputedStyle(cur);
        if (/(auto|scroll|overlay)/.test(cs.overflowY) && cur.scrollHeight > cur.clientHeight + 4) return cur;
      } catch (e) {}
      cur = cur.parentElement;
    }
    return null;
  }
  function visibleBox(sc) {
    var vb = { top: 0, left: 0, bottom: window.innerHeight, right: window.innerWidth };
    if (!sc) return vb;
    var r = rectOf(sc);
    return { top: Math.max(vb.top, r.top), left: Math.max(vb.left, r.left), bottom: Math.min(vb.bottom, r.bottom), right: Math.min(vb.right, r.right) };
  }
  // 滚轮落点：在能滚动这个元素的区域里，避开插件浮层
  function wheelPoint(el, sc) {
    var vb = visibleBox(sc), r = el ? rectOf(el) : null;
    for (var i = 0; i < 8; i++) {
      var x = r && r.width ? Math.min(Math.max(r.left + r.width * rand(0.25, 0.6), vb.left + 20), vb.right - 20) : vb.left + (vb.right - vb.left) * rand(0.3, 0.6);
      var y = vb.top + (vb.bottom - vb.top) * rand(0.3, 0.7);
      var h = document.elementFromPoint ? document.elementFromPoint(x, y) : null;
      if (!h || h.closest('#__hrs_greet__,#__hrs_ui__')) continue;
      if (sc && !(sc === h || sc.contains(h))) continue;
      return { x: x, y: y };
    }
    return { x: (vb.left + vb.right) / 2, y: (vb.top + vb.bottom) / 2 };
  }
  // 先把鼠标移到滚动区里并核对（防止换算偏了滚到别处），再原地滚轮
  function wheelAt(pt, notches, sc) {
    var first = true;
    var inArea = function (x, y) {
      var h = document.elementFromPoint ? document.elementFromPoint(x, y) : null;
      return !!h && !h.closest('#__hrs_greet__,#__hrs_ui__') && (!sc || sc === h || sc.contains(h));
    };
    return aimAt(function () { if (first) { first = false; return pt; } return wheelPoint(null, sc); }, inArea).then(function (a) {
      if (!a.ok) return a;
      return rpaCall('wheel', env({ notches: notches }));
    });
  }
  // 已经完整露出来、而且中间区域没被吸顶栏之类挡住，就不用滚
  function inView(el) {
    var r = rectOf(el), sc = scrollParentOf(el), vb = visibleBox(sc);
    var h = vb.bottom - vb.top;
    if (r.height > h - 4) return r.top >= vb.top && r.top < vb.top + h * 0.45 && !!pickPoint(el);
    return r.top >= vb.top + 2 && r.bottom <= vb.bottom - 2 && !!pickPoint(el);
  }
  // 用滚轮把元素滚到可视区域中间（替代脚本里的 scrollIntoView）
  function reveal(el) {
    var i = 0, stuck = 0;
    function step() {
      if (!el || !el.isConnected) return Promise.resolve({ ok: false, code: 'gone', why: '元素已不在页面上' });
      if (inView(el)) return Promise.resolve({ ok: true });
      if (i++ >= 8) return Promise.resolve({ ok: true, partial: true });
      var sc = scrollParentOf(el), vb = visibleBox(sc), r = rectOf(el);
      var want = vb.top + (vb.bottom - vb.top) * rand(0.38, 0.55);
      var delta = (r.top + Math.min(r.height, vb.bottom - vb.top) / 2) - want;
      var n = Math.round(delta / RP.pxPerNotch);
      if (!n) n = delta > 0 ? 1 : -1;
      n = Math.max(-6, Math.min(6, n));
      var before = r.top;
      return wheelAt(wheelPoint(null, sc), n, sc).then(function (w) {
        if (!w.ok) return w;
        return sleep(rand(420, 750)).then(function () {
          var moved = before - rectOf(el).top;
          if (Math.abs(moved) < 3) { if (++stuck >= 2) return { ok: true, partial: true }; }
          else { stuck = 0; var per = Math.abs(moved / n); if (per > 20 && per < 500) RP.pxPerNotch = per; }
          return step();
        });
      });
    }
    return step();
  }
  // 插件自己点的真实点击：告诉智选引擎「这不是你手动点的」（v1.9.35 / v1.9.40 的手动暂停判断看这两个时间）
  function selfMark() { try { window.__hrsSelfTrustedAt = Date.now(); window.__hrsSelfListClick = Date.now(); } catch (e) {} }
  function _click(el, opts) {
    opts = opts || {};
    return reveal(el).then(function (rv) {
      if (!rv.ok) return rv;
      return sleep(rand(120, 300)).then(function () { return aim(el, opts); });
    }).then(function (a) {
      if (!a.ok) return a;
      RP.lastPressAt = Date.now(); selfMark();
      return rpaCall('click', { count: opts.count || 1 }).then(function (c) {
        RP.lastPressAt = Date.now(); selfMark();
        return c.ok ? { ok: true, x: a.x, y: a.y } : c;
      });
    });
  }
  /** RPA 点击：滚到可视区 → 拟人轨迹移过去 → 核对落点 → 真实按下松开 */
  function rpaClick(el, opts) {
    if (!el) { runLog('点击', (opts && opts.label) || '', { ok: false, code: 'gone', why: '没有要点的元素' }); return Promise.resolve(noteFail({ ok: false, code: 'gone', why: '没有要点的元素' })); }
    var lb = (opts && opts.label) || (RL() ? RL().labelOf(el) : '');
    return session(function () { return _click(el, opts); }, 'click', { act: '点击', target: lb });
  }
  /** RPA 点页面上某个空白位置（本页面坐标），用来「点空白处收起下拉」 */
  function rpaClickAt(x, y) {
    return session(function () {
      return aimAt(function () { return { x: x, y: y }; }, function () { return true; }).then(function (a) {
        if (!a.ok) return a;
        RP.lastPressAt = Date.now(); selfMark();
        return rpaCall('click', {}).then(function (c) { RP.lastPressAt = Date.now(); selfMark(); return c; });
      });
    }, 'click', { act: '点击', target: '空白处（收起下拉）' });
  }
  /** RPA 悬停：只把鼠标移到元素上，不点 */
  function rpaHover(el) {
    if (!el) return Promise.resolve({ ok: false });
    return session(function () {
      return reveal(el).then(function (rv) { return rv.ok ? aim(el, { rel: [rand(0.2, 0.75), rand(0.25, 0.75)] }) : rv; })
        .then(function (r) { return r.ok ? sleep(rand(200, 500)).then(function () { return r; }) : r; });
    }, 'hover');
  }
  function rpaScrollIntoView(el) { return session(function () { return reveal(el); }, 'wheel'); }
  /** 往下（正数）或往上（负数）滚大约 px 像素；el 用来决定在哪个滚动区里滚 */
  function rpaWheelBy(px, el) {
    return session(function () {
      var sc = el ? scrollParentOf(el) : null;
      var n = Math.round(px / RP.pxPerNotch);
      if (!n) n = px > 0 ? 1 : -1;
      n = Math.max(-12, Math.min(12, n));
      return wheelAt(wheelPoint(null, sc), n, sc).then(function (w) { return w.ok ? sleep(rand(500, 900)).then(function () { return w; }) : w; });
    }, 'wheel');
  }
  /** 滚回顶部（换岗位后用） */
  function rpaScrollTop(el) {
    return session(function () {
      var sc = el ? scrollParentOf(el) : null, k = 0;
      var pos = function () { return sc ? sc.scrollTop : (window.scrollY || document.documentElement.scrollTop || 0); };
      function step() {
        if (pos() <= 2 || k++ >= 8) return Promise.resolve({ ok: true });
        var n = -Math.max(1, Math.min(10, Math.ceil(pos() / RP.pxPerNotch)));
        return wheelAt(wheelPoint(null, sc), n, sc).then(function (w) { return w.ok ? sleep(rand(400, 700)).then(step) : w; });
      }
      return step();
    }, 'wheel');
  }
  function focusedIn(el) { var a = document.activeElement; return !!a && (a === el || el.contains(a) || (a.isContentEditable && el.contains(a))); }
  function valueOf(el) { return el ? (el.isContentEditable ? textOf(el) : String(el.value || '')) : ''; }
  /** RPA 打字：点进输入框（可先全选删除旧内容）→ 逐字输入 */
  function rpaType(el, text, opts) {
    opts = opts || {};
    return session(function () {
      return _click(el, { rel: [rand(0.3, 0.7), rand(0.4, 0.6)] }).then(function (c) {
        if (!c.ok) return c;
        return waitFor(function () { return focusedIn(el); }, 1200, 100).then(function (f) {
          if (!f) return { ok: false, code: 'nofocus', why: '点了输入框但光标没进去' };
          var clear = opts.clear && valueOf(el).trim()
            ? rpaCall('key', { key: 'a', ctrl: true }).then(function (k) { return k.ok ? sleep(rand(120, 260)).then(function () { return rpaCall('key', { key: 'backspace' }); }) : k; })
            : Promise.resolve({ ok: true });
          return clear.then(function (k) {
            if (!k.ok) return k;
            return sleep(rand(200, 500)).then(function () { return typeChunked(String(text || '')); });
          });
        });
      });
    }, 'type', { act: '输入', target: (opts.label || '') + '「' + preview(text) + '」' });
  }
  function preview(t) { t = String(t || '').replace(/\s+/g, ' ').trim(); return t.length > 18 ? t.slice(0, 18) + '…（' + t.length + ' 字）' : t; }
  // v2.3.0 长话术按标点分几段打，段间偶尔停一下（像人边想边打）；总时长和原来接近
  function typeChunked(text) {
    var R = RH();
    var parts = R ? R.typeChunks(text, RP.rhythm) : [text];
    var mul = text.length > 120 ? text.length / 120 : 1;   // 长话术整体提速，和助手原来的处理一致
    var i = 0, chars = 0;
    function next() {
      if (i >= parts.length) return Promise.resolve({ ok: true, chars: chars });
      var part = parts[i++];
      return rpaCall('type', { text: part, speedMul: mul }).then(function (r) {
        if (!r || !r.ok) return r;
        chars += part.length;
        if (i >= parts.length) return next();
        var ms = R ? R.typePauseMs(RP.rhythm) : 0;
        return (ms ? sleep(ms) : Promise.resolve()).then(next);
      });
    }
    return next();
  }
  /** RPA 按键：Enter / Escape / Backspace…，可带 ctrl / shift / alt */
  var KEY_NAME = { enter: '回车', escape: 'Esc', backspace: '退格', tab: 'Tab' };
  function rpaKey(key, mods) {
    var name = (mods && mods.ctrl ? 'Ctrl+' : '') + (KEY_NAME[String(key).toLowerCase()] || key);
    return session(function () { return rpaCall('key', Object.assign({ key: key }, mods || {})); }, 'key', { act: '按键', target: name });
  }
  /** 只看助手和窗口能不能用（不动鼠标）：动作前先探一下，不能用就等 */
  function rpaProbe() { return rpaCall('probe', env()).then(noteHold); }
  function rpaPing() {
    return new Promise(function (resolve) {
      try { chrome.runtime.sendMessage({ type: 'RPA_PING' }, function (r) { void chrome.runtime.lastError; resolve(r || { ok: false, why: '后台没回应' }); }); }
      catch (e) { resolve({ ok: false, why: String(e && e.message || e) }); }
    });
  }
  /** 这次真实点击是 RPA 自己点的吗（给「检测到你手动点了会话就暂停」那段逻辑用，避免把 RPA 当成你） */
  function rpaRecent(ms) { return RP.inAct || Date.now() - RP.lastPressAt < (ms || 1500); }
  /** 某个时间点之后，RPA 有没有因为「你在用鼠标 / 锁屏 / 助手没开」而让位 */
  function rpaHeldSince(t) { return RP.held && RP.heldAt >= t ? RP.held : null; }
  function holdMessage(r) {
    if (!r) return '';
    var w = Math.max(1, Math.ceil(r.wait || 0));
    return (r.why || r.code || 'RPA 暂不可用') + (r.code === 'user_active' ? '' : '（约 ' + w + ' 秒后重试）');
  }

  // ---------- v1.9.48 Boss 上把通用动作换成 RPA ----------
  // 打招呼、智选、简历详情、关弹窗等所有用 HRSDom 点击 / 悬停 / 滚动 / 按 Esc 的地方，在 Boss + RPA 模式下自动改走真实鼠标键盘，
  // 不再派发脚本事件、不再挂浏览器调试器。原来的脚本版本放在 HRSDom.script（抓取职位、发布职位填表仍用它，行为不变）。
  var SCRIPT = { click: click, hover: hover, moveTo: moveTo, trustedClick: trustedClick, trustedHover: trustedHover, scrollIntoViewSoft: scrollIntoViewSoft, pressEscape: pressEscape };
  // v2.3.0 脚本点击（猎聘、Boss 旧版脚本模式）：在智选 / 打招呼页面上同样加拟人停顿并记运行记录
  function scriptClick(fn, el, act) {
    var mod = runMod();
    if (!mod) return fn(el);
    var lb = RL() ? RL().labelOf(el) : '';
    return rhythmGap('click').then(function () {
      if (!el || !el.isConnected) { var g = { ok: false, code: 'gone', why: '要点的元素已不在页面上' }; runLog(act || '点击', lb, g, 'script'); noteFail(g); return fn(el); }
      return Promise.resolve(fn(el)).then(function (r) {
        var res = r && typeof r === 'object' && r.ok === false ? r : { ok: true };
        runLog(act || '点击', lb, res, 'script'); noteFail(res);
        return r;
      });
    });
  }
  function rClick(el) {
    if (!rpaOn()) return scriptClick(SCRIPT.click, el);
    return rpaClick(el).then(function (r) { return r && r.ok ? { ok: true, x: r.x, y: r.y } : r; });
  }
  function rTrustedClick(el) { return rpaOn() ? rpaClick(el) : scriptClick(SCRIPT.trustedClick, el); }
  function rTrustedHover(el) { return rpaOn() ? rpaHover(el) : SCRIPT.trustedHover(el); }
  function rHover(el) { return rpaOn() ? rpaHover(el).then(function () { return sleep(rand(150, 400)); }) : SCRIPT.hover(el); }
  function rMoveTo(el) { return rpaOn() ? rpaHover(el).then(function (r) { return r && r.ok ? { x: r.x, y: r.y } : rectCenter(el); }) : SCRIPT.moveTo(el); }
  function rectCenter(el) { var r = rectOf(el); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; }
  function rScroll(el) { return rpaOn() ? rpaScrollIntoView(el).then(function () { return sleep(rand(300, 700)); }) : SCRIPT.scrollIntoViewSoft(el); }
  function rEscape() { if (!rpaOn()) return SCRIPT.pressEscape(); return rpaKey('escape'); }

  var BASE = {
    sleep: sleep, rand: rand, textOf: textOf, norm: norm, rectOf: rectOf, visible: visible, qsa: qsa,
    byExactText: byExactText, leaves: leaves, leave: leave, topPoint: topPoint, dumpControl: dumpControl, describe: describe,
    waitFor: waitFor, riskSignal: riskSignal, RISK_RE: RISK_RE
  };
  window.HRSDom = Object.assign({}, BASE, {
    click: rClick, hover: rHover, moveTo: rMoveTo, trustedClick: rTrustedClick, trustedHover: rTrustedHover,
    scrollIntoViewSoft: rScroll, pressEscape: rEscape,
    // v1.9.48 BOSS RPA
    rpaOn: rpaOn, rpaClick: rpaClick, rpaClickAt: rpaClickAt, rpaHover: rpaHover, rpaScrollIntoView: rpaScrollIntoView, rpaWheelBy: rpaWheelBy, rpaScrollTop: rpaScrollTop,
    rpaType: rpaType, rpaKey: rpaKey, rpaProbe: rpaProbe, rpaPing: rpaPing, rpaRecent: rpaRecent, rpaHeldSince: rpaHeldSince, isHold: isHold, holdMessage: holdMessage,
    rpaValueOf: valueOf, rpaQuick: rpaQuick,
    // v2.3.0 拟人节奏 + 运行记录
    rhythmGap: rhythmGap, lastFailSince: lastFailSince, runMod: runMod,
    script: Object.assign({}, BASE, SCRIPT)
  });
})();
