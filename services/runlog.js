/**
 * runlog.js v2.3.0：运行记录（工作台「设置 · 运行记录」的数据来源，v2.4.0 起页面在设置里）
 * 页面里的智选 / 打招呼每做一个动作（点击、发消息、切职位…）就记一条：成功还是失败、失败原因归类。
 * 引擎状态（运行中 / 休息中 / 已停止）也从这里上报。数据交给插件后台统一写入本机，不上传任何地方。
 */
(function (root, factory) {
  if (typeof module !== 'undefined' && module.exports) module.exports = factory(null);
  else root.HRSRunLog = factory(typeof chrome !== 'undefined' ? chrome : null);
})(typeof self !== 'undefined' ? self : this, function (chromeRef) {
  'use strict';

  // 失败原因分类：code 来自 RPA 助手 / 插件，why 是原始说明
  var CATS = {
    rpa_off: { label: 'RPA 没连上', level: 'fail' },
    covered: { label: '窗口被挡住 / 不在前台', level: 'fail' },
    miss: { label: '鼠标没点准', level: 'fail' },
    verify: { label: '遇到验证 / 风控', level: 'fail' },
    limit: { label: '平台次数上限', level: 'fail' },
    gone: { label: '找不到按钮或元素', level: 'fail' },
    nofocus: { label: '输入框没获得光标', level: 'fail' },
    unverified: { label: '没确认成功', level: 'fail' },
    user: { label: '你在用电脑（让位）', level: 'wait' },
    locked: { label: '屏幕已锁定', level: 'wait' },
    busy: { label: '鼠标被另一页面占用', level: 'wait' },
    other: { label: '其他', level: 'fail' }
  };
  var CODE_CAT = {
    offline: 'rpa_off', lna: 'rpa_off', noreply: 'rpa_off', timeout: 'rpa_off',
    covered: 'covered', covered_win: 'covered', not_foreground: 'covered', no_window: 'covered', frame: 'covered',
    miss: 'miss', no_feedback: 'miss',
    verify: 'verify', risk: 'verify', limit: 'limit',
    gone: 'gone', notfound: 'gone',
    nofocus: 'nofocus', unverified: 'unverified', mismatch: 'unverified',
    user_active: 'user', locked: 'locked', busy: 'busy'
  };
  /** 从 code 或说明文字归类 */
  function classify(code, why) {
    var c = CODE_CAT[code];
    if (c) return c;
    var w = String(why || '');
    if (/验证|滑块|人机|访问异常|账号.{0,2}异常|频繁/.test(w)) return 'verify';
    if (/上限|次数已用完|次数不足|权益/.test(w)) return 'limit';
    if (/RPA 助手|连不上|127\.0\.0\.1|本地网络访问|后台没回应|没回应/.test(w)) return 'rpa_off';
    if (/挡住|前台|最前面|窗口/.test(w)) return 'covered';
    if (/没落在|偏差|没点准|没收到鼠标位置/.test(w)) return 'miss';
    if (/锁定|锁屏/.test(w)) return 'locked';
    if (/你正在用|你动了|让位/.test(w)) return 'user';
    if (/没找到|找不到|不在页面|读不到/.test(w)) return 'gone';
    if (/光标/.test(w)) return 'nofocus';
    if (/没确认|没变化|没切过去|没清空|没发|会话校验|会话变了|不对/.test(w)) return 'unverified';
    return 'other';
  }
  function catLabel(cat) { return (CATS[cat] || CATS.other).label; }

  var STATE_LABEL = { running: '运行中', resting: '休息中', stopped: '已停止' };
  var ENGINES = [
    { key: 'boss-screen', site: 'boss', mod: '智选', name: 'Boss 智选' },
    { key: 'boss-greet', site: 'boss', mod: '打招呼', name: 'Boss 打招呼' },
    { key: 'liepin-screen', site: 'liepin', mod: '智选', name: '猎聘智选' },
    { key: 'liepin-greet', site: 'liepin', mod: '打招呼', name: '猎聘打招呼' }
  ];

  // ---------- 页面侧：记一条 ----------
  function send(msg) {
    if (!chromeRef || !chromeRef.runtime) return;
    try { chromeRef.runtime.sendMessage(msg, function () { void chromeRef.runtime.lastError; }); } catch (e) {}
  }
  /**
   * ev: { mod: '智选'|'打招呼', act: '点击'|'输入'|'按键'|'发消息'|'切职位'|'打招呼'|'索要简历'|'已读'|'验证'|'休息'|'提示',
   *       target, ok: true|false, code, why, via: 'rpa'|'script' }
   * ok=false 时按 code / why 归类；属于「让位等待」的记为等待，不算失败
   */
  function add(ev) {
    ev = ev || {};
    var e = {
      t: Date.now(), mod: ev.mod || '', act: ev.act || '动作', target: String(ev.target || '').slice(0, 60),
      ok: ev.ok !== false, via: ev.via || '', detail: String(ev.detail || '').slice(0, 200)
    };
    if (!e.ok) {
      e.cat = ev.cat || classify(ev.code, ev.why);
      e.code = ev.code || '';
      e.why = String(ev.why || '').slice(0, 200);
      if ((CATS[e.cat] || {}).level === 'wait') e.ok = 'wait';
    }
    if (ev.site) e.site = ev.site;
    send({ type: 'RUNLOG', ev: e });
  }
  // 状态上报：变了立即报，没变每 20 秒报一次（后台据此判断页面还在不在）
  var last = {};
  function status(key, st) {
    if (!key || !st) return;
    var sig = st.state + '|' + (st.text || '');
    var l = last[key] || {};
    var now = Date.now();
    if (l.sig === sig && now - l.at < 20000) return;
    last[key] = { sig: sig, at: now };
    send({ type: 'RUNSTATE', key: key, state: st.state, text: String(st.text || '').slice(0, 120), until: st.until || 0 });
  }
  /** 元素的简短名字：按钮文字 / 提示文字，太长截断 */
  function labelOf(el) {
    if (!el) return '';
    var t = '';
    try {
      t = el.getAttribute && (el.getAttribute('aria-label') || el.getAttribute('placeholder') || el.getAttribute('title')) || '';
      if (!t) t = String(el.innerText != null && el.innerText !== '' ? el.innerText : el.textContent || '');
    } catch (e) {}
    t = t.replace(/\s+/g, ' ').trim();
    if (!t) {
      var tag = (el.tagName || '').toLowerCase();
      t = tag === 'textarea' || tag === 'input' || el.isContentEditable ? '输入框' : '页面元素';
    }
    return t.length > 24 ? t.slice(0, 24) + '…' : t;
  }

  return {
    CATS: CATS, STATE_LABEL: STATE_LABEL, ENGINES: ENGINES,
    classify: classify, catLabel: catLabel, add: add, status: status, labelOf: labelOf
  };
});
