/**
 * people.js v3.6.0：人才库「一个人一条记录」、保留期限、按要求删除
 *   - 认人：平台会话编号、手机号、邮箱，三个都没有再用「姓名 + 最近一家公司」
 *   - 同一个人投了几个岗位：合成一条，每个岗位一条投递记录（applications），最新那次的结论显示在最外面
 *   - 保留期限：不合适 / 没沟通 180 天，收到简历没面试 1 年，面试 / 录用不自动删（设置 · 合规 里可改）
 *   - 纯函数，后台、工作台、node 测试共用
 */
(function (root, factory) {
  if (typeof module !== 'undefined' && module.exports) module.exports = factory();
  else root.HRSPeople = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var DAY = 86400000;
  var GENERIC = /^(候选人|未知候选人|未知|牛人|匿名)$/;
  function nz(x) { return String(x == null ? '' : x).replace(/\s+/g, '').toLowerCase(); }
  function phoneOf(c) { var p = String((c.fields && c.fields.phone) || c.phone || '').replace(/\D/g, ''); return /^1[3-9]\d{9}$/.test(p.slice(-11)) ? p.slice(-11) : ''; }
  function emailOf(c) { var e = String((c.fields && c.fields.email) || c.email || '').trim().toLowerCase(); return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e) ? e : ''; }
  function companyOf(c) { var f = c.fields || {}; return nz((f.companies || [])[0] || c.company || ''); }

  /** 一个人的识别键：强的在前（会话编号、手机、邮箱），弱的（姓名 + 公司）在后 */
  function keys(c) {
    c = c || {};
    var out = [];
    if (c.chatId) out.push('cid:' + (c.source || '') + ':' + c.chatId);
    var ph = phoneOf(c); if (ph) out.push('ph:' + ph);
    var em = emailOf(c); if (em) out.push('em:' + em);
    var n = nz(c.name || (c.fields && c.fields.name));
    var co = companyOf(c);
    if (n && n.length >= 2 && !GENERIC.test(n) && co) out.push('nc:' + n + '|' + co);
    return out;
  }
  // 键的种类：会话编号按平台分（同一个人在 Boss、猎聘各有一个会话不算冲突）
  function kind(k) { var p = k.split(':'); return p[0] === 'cid' ? p[0] + ':' + p[1] : p[0]; }
  /** 在 list 里找同一个人（id 一样的优先） */
  function findSame(list, c) {
    list = list || [];
    var byId = c.id && list.filter(function (x) { return x.id === c.id; })[0];
    if (byId) return byId;
    var k = keys(c);
    if (!k.length) return null;
    var strong = k.filter(function (x) { return x.indexOf('nc:') !== 0; });
    var hit = null;
    list.some(function (x) {
      var xk = keys(x);
      // 强键对上就是同一个人。只有弱键时，双方都没有强键才算（有手机号且不一样的，是两个人）
      if (strong.some(function (y) { return xk.indexOf(y) >= 0; })) { hit = x; return true; }
      var xs = xk.filter(function (y) { return y.indexOf('nc:') !== 0; });
      var conflict = strong.some(function (y) { var p = kind(y); return xs.some(function (z) { return kind(z) === p && z !== y; }); });
      if (!conflict && k.some(function (y) { return y.indexOf('nc:') === 0 && xk.indexOf(y) >= 0; })) { hit = x; return true; }
      return false;
    });
    return hit;
  }

  var STATUS_RANK = { rejected: 1, new: 2, review: 2, reject_pending: 2, contacted: 3, interview: 5, offer: 6 };
  function appOfRecord(c) {
    return { jdId: c.jdId || '', jdTitle: c.jdTitle || '', verdict: c.verdict || '', score: c.score == null ? null : c.score,
      reasons: (c.reasons || []).slice(0, 4), contactStatus: c.contactStatus || 'new', at: c.seenAt || c.updatedAt || Date.now(), source: c.source || '', cardId: c.id || '' };
  }
  function sameJob(a, b) { return a.jdId && b.jdId ? a.jdId === b.jdId : nz(a.jdTitle) === nz(b.jdTitle); }
  /** 这个人在某个岗位上的投递记录 */
  function appOf(c, jdId, jdTitle) {
    var apps = apps0(c);
    return apps.filter(function (a) { return (jdId && a.jdId === jdId) || (jdTitle && nz(a.jdTitle) === nz(jdTitle)); })[0] || null;
  }
  function apps0(c) { return Array.isArray(c.applications) && c.applications.length ? c.applications : (c.jdId || c.jdTitle ? [appOfRecord(c)] : []); }

  /**
   * 把新来的 c 合进 old（同一个人）。返回合并后的记录（id 用 old 的），c.id 不同时记进 aliases
   * 最外面的岗位、结论、原因、得分跟最新这次，联系状态不往回退（已约面的人投了别的岗位被判不合格，状态还是已约面）
   */
  function merge(old, c, now) {
    now = now || Date.now();
    if (!old) {
      var n0 = Object.assign({}, c);
      n0.applications = apps0(c).map(function (a) { return Object.assign({}, a); });
      return n0;
    }
    var out = Object.assign({}, old);
    var apps = apps0(old).map(function (a) { return Object.assign({}, a); });
    var na = appOfRecord(Object.assign({}, c, { seenAt: c.seenAt || now }));
    var hit = apps.filter(function (a) { return sameJob(a, na); })[0];
    if (hit) {
      var keepSt = (STATUS_RANK[hit.contactStatus] || 0) > (STATUS_RANK[na.contactStatus] || 0) && c.contactStatus !== 'rejected' ? hit.contactStatus : na.contactStatus;
      Object.assign(hit, na, { contactStatus: c.contactStatus ? keepSt : hit.contactStatus, at: na.at || hit.at });
    } else if (na.jdId || na.jdTitle) apps.push(na);
    // 普通字段：新值盖旧值（空的不盖）
    Object.keys(c).forEach(function (k) {
      if (k === 'id' || k === 'applications' || k === 'aliases' || k === 'seenAt') return;
      var v = c[k];
      if (v == null || v === '' || (Array.isArray(v) && !v.length && Array.isArray(out[k]) && out[k].length)) return;
      out[k] = v;
    });
    if (c.fields && old.fields) out.fields = Object.assign({}, old.fields, c.fields);
    if (old.messages && c.messages && c.messages !== old.messages) out.messages = old.messages.concat(c.messages.filter(function (m) { return !old.messages.some(function (o) { return o.text === m.text && o.time === m.time; }); }));
    if (old.resumeFiles && c.resumeFiles) out.resumeFiles = old.resumeFiles.concat(c.resumeFiles.filter(function (f) { return !old.resumeFiles.some(function (o) { return o.filename === f.filename; }); }));
    if (old.resumeStatus === 'received' && c.resumeStatus && c.resumeStatus !== 'received') out.resumeStatus = 'received';
    // 联系状态：取所有投递里最「往前」的
    out.contactStatus = topStatus(apps, old.contactStatus);
    out.applications = apps;
    out.id = old.id;
    out.seenAt = Math.min(old.seenAt || now, c.seenAt || now);
    out.updatedAt = now;
    var al = (old.aliases || []).slice();
    if (c.id && c.id !== old.id && al.indexOf(c.id) < 0) al.push(c.id);
    (c.aliases || []).forEach(function (x) { if (x !== old.id && al.indexOf(x) < 0) al.push(x); });
    if (al.length) out.aliases = al;
    return out;
  }
  function topStatus(apps, cur) {
    var best = cur || 'new', r = STATUS_RANK[best] || 0;
    apps.forEach(function (a) { var x = STATUS_RANK[a.contactStatus] || 0; if (x > r) { r = x; best = a.contactStatus; } });
    // 最外面状态是「淘汰」但别的岗位还在进行中：按进行中的算
    return best;
  }

  /** 已有的人才库去重：返回 { list: 合并后的全部记录, removed: 被并掉的 id, groups: 合并了几组 } */
  function dedupe(list, now) {
    var sorted = (list || []).slice().sort(function (a, b) { return (a.seenAt || 0) - (b.seenAt || 0); });
    var out = [], removed = [], groups = 0;
    sorted.forEach(function (c) {
      var same = findSame(out, Object.assign({}, c, { id: '' }));
      if (same) {
        var i = out.indexOf(same);
        out[i] = merge(same, c, now || Date.now());
        out[i].updatedAt = Math.max(same.updatedAt || 0, c.updatedAt || 0) || out[i].updatedAt;
        removed.push(c.id);
        groups++;
      } else out.push(merge(null, c));
    });
    return { list: out, removed: removed, groups: groups };
  }

  // ---------- 保留期限 ----------
  var DEFAULT_RET = { on: true, rejectDays: 180, resumeDays: 365 };
  function ret(s) { var r = Object.assign({}, DEFAULT_RET, (s && s.retention) || {}); r.rejectDays = Math.max(30, parseInt(r.rejectDays, 10) || 180); r.resumeDays = Math.max(30, parseInt(r.resumeDays, 10) || 365); return r; }
  /** keep：面试 / 录用，不自动删。resume：收到简历没面试。reject：不合适、没沟通、待复核 */
  function classOf(c) {
    var sts = [c.contactStatus].concat(apps0(c).map(function (a) { return a.contactStatus; }));
    if (sts.some(function (x) { return x === 'interview' || x === 'offer'; })) return 'keep';
    if (c.resumeStatus === 'received' || (c.resumeFiles && c.resumeFiles.length)) return 'resume';
    return 'reject';
  }
  function lastAt(c) {
    var t = Math.max(c.updatedAt || 0, c.seenAt || 0, c.resumeReceivedAt || 0);
    apps0(c).forEach(function (a) { if (a.at > t) t = a.at; });
    return t || Date.now();
  }
  function dueAt(c, s) {
    var k = classOf(c);
    if (k === 'keep') return null;
    var r = ret(s);
    var d = lastAt(c) + (k === 'resume' ? r.resumeDays : r.rejectDays) * DAY;
    return Math.max(d, c.keepUntil || 0);
  }
  /** 到期的、7 天内到期的、各类多少人 */
  function plan(list, s, now) {
    now = now || Date.now();
    var r = ret(s), out = { on: r.on, due: [], soon: [], counts: { keep: 0, resume: 0, reject: 0 } };
    (list || []).forEach(function (c) {
      var k = classOf(c);
      out.counts[k]++;
      var d = dueAt(c, s);
      if (d == null) return;
      if (d <= now) out.due.push({ id: c.id, cls: k, dueAt: d });
      else if (d - now <= 7 * DAY) out.soon.push({ id: c.id, name: c.name || '', job: c.jdTitle || '', cls: k, dueAt: d });
    });
    out.soon.sort(function (a, b) { return a.dueAt - b.dueAt; });
    return out;
  }

  // ---------- 按要求删除：这个人在插件里的所有记录 ----------
  /** 简历收集里同一个人的记录（按会话编号、姓名 + 平台） */
  function inboxMatches(inbox, c) {
    var n = nz(c.name), ids = [c.id].concat(c.aliases || []);
    var ph = phoneOf(c), em = emailOf(c);
    return (inbox || []).filter(function (r) {
      if (r.candId && ids.indexOf(r.candId) >= 0) return true;
      if (c.chatId && r.chatId && String(r.chatId) === String(c.chatId)) return true;
      var m = r.man || {}, pf = r.pdfFields || r.pdf || {};
      if (ph && (String(m.phone || pf.phone || '').replace(/\D/g, '').slice(-11) === ph)) return true;
      if (em && String(m.email || pf.email || '').toLowerCase() === em) return true;
      var rn = nz(r.name0 || m.name || r.name);
      return !!n && rn === n && (!c.source || !r.site || r.site === c.source) && (!c.jdTitle || !r.jdTitle || apps0(c).some(function (a) { return nz(a.jdTitle) === nz(r.jdTitle); }));
    });
  }
  /** 决定明细、处理记录里属于这个人的（姓名一样，岗位或会话编号对得上） */
  function logMatch(c) {
    var n = nz(c.name), jobs = apps0(c).map(function (a) { return a.jdId; }).concat([c.jdId]).filter(Boolean);
    return function (v) {
      if (!v || nz(v.name) !== n || !n) return false;
      if (c.chatId && v.cid) return String(v.cid) === String(c.chatId);
      return !v.jdId || jobs.indexOf(v.jdId) >= 0;
    };
  }

  // ---------- 去标识：发给 AI、导出评测集之前用 ----------
  /** 去掉姓名（names 里给的、2 个字以上）、手机、座机、邮箱、微信号、身份证号。返回 { text, n }：n = 替换了几处 */
  function redact(text, names) {
    var t = String(text == null ? '' : text), n = 0;
    var rep = function (re, to) { var m = t.match(re); if (m) { n += m.length; t = t.replace(re, to); } };
    (names || []).forEach(function (nm) {
      nm = String(nm || '').trim();
      if (nm.length < 2 || GENERIC.test(nm)) return;
      var parts = t.split(nm);
      if (parts.length > 1) { n += parts.length - 1; t = parts.join('候选人'); }
    });
    rep(/[\w.+-]+@[\w-]+(\.[\w-]+)+/g, '<邮箱>');
    rep(/(微信|wechat|weixin|vx|v信)(\s*[:：号]?\s*)[A-Za-z][\w-]{5,19}/gi, '$1$2<微信>');
    rep(/\d{17}[\dXx]/g, '<证件号>');
    rep(/(\+?86[\s-]?)?1[3-9]\d[\s-]?\d{4}[\s-]?\d{4}/g, '<电话>');
    rep(/0\d{2,3}-\d{7,8}/g, '<电话>');
    rep(/(姓\s*名|Name)(\s*[:：]\s*)[一-龥]{2,4}/gi, '$1$2候选人');
    return { text: t, n: n };
  }

  return {
    redact: redact,
    keys: keys, findSame: findSame, merge: merge, dedupe: dedupe, appOf: appOf, apps: apps0,
    DEFAULT_RET: DEFAULT_RET, ret: ret, classOf: classOf, lastAt: lastAt, dueAt: dueAt, plan: plan,
    inboxMatches: inboxMatches, logMatch: logMatch
  };
});
