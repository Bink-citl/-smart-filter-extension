/**
 * backup.js v3.6.0：全量加密备份（人才库、简历收集、岗位、设置、评测集、决定记录）
 *   - 文件扩展名 .sfbak，内容是 JSON：外层只有版本、时间、条数，里面的数据用密码加密（PBKDF2 + AES-GCM，浏览器自带的 WebCrypto）
 *   - 忘了密码打不开，插件也没有办法找回
 *   - 恢复默认「合并」：已有的不动，备份里多出来的补进来，同一个人合成一条。也可以选「覆盖」
 *   - 工作台（手动备份，可带 PDF）和后台（每天自动备份，不带 PDF）共用
 */
(function (root, factory) {
  if (typeof module !== 'undefined' && module.exports) module.exports = factory(require('./people.js'));
  else root.HRSBackup = factory(root.HRSPeople);
})(typeof self !== 'undefined' ? self : this, function (P) {
  'use strict';

  var ITER = 210000, FORMAT = 1, TYPE = 'sf-backup';
  var KEYS = ['settings', 'jds', 'resumeInbox', 'evalSamples', 'procStats', 'deletionLog', 'talentAlias', 'rejectPending'];
  function subtle() { var c = (typeof crypto !== 'undefined' && crypto) || (typeof self !== 'undefined' && self.crypto); if (!c || !c.subtle) throw new Error('这个环境不支持加密'); return c; }
  function b64(u8) { var s = '', i, CH = 0x8000; for (i = 0; i < u8.length; i += CH) s += String.fromCharCode.apply(null, u8.subarray(i, i + CH)); return btoa(s); }
  function unb64(t) { var s = atob(t), u = new Uint8Array(s.length); for (var i = 0; i < s.length; i++) u[i] = s.charCodeAt(i); return u; }
  function key(pw, salt, iter) {
    var C = subtle();
    return C.subtle.importKey('raw', new TextEncoder().encode(String(pw)), 'PBKDF2', false, ['deriveKey']).then(function (k) {
      return C.subtle.deriveKey({ name: 'PBKDF2', hash: 'SHA-256', salt: salt, iterations: iter }, k, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
    });
  }
  function checkPw(pw) {
    pw = String(pw || '');
    if (pw.length < 8) return '密码至少 8 位';
    if (!/\d/.test(pw) || !/[A-Za-z]/.test(pw)) return '密码要同时有字母和数字';
    return '';
  }
  function counts(d) {
    return { candidates: (d.candidates || []).length, jds: (d.jds || []).length, inbox: (d.resumeInbox || []).length, pdfs: Object.keys(d.pdfs || {}).length,
      events: (d.events || []).length, decisions: (d.decisions || []).length, evalSamples: (d.evalSamples || []).length };
  }
  /** 加密。meta.version：插件版本 */
  function encrypt(data, pw, meta) {
    var bad = checkPw(pw);
    if (bad) return Promise.reject(new Error(bad));
    var C = subtle();
    var salt = C.getRandomValues(new Uint8Array(16)), iv = C.getRandomValues(new Uint8Array(12));
    var iter = (meta && meta.iter) || ITER;
    return key(pw, salt, iter).then(function (k) {
      return C.subtle.encrypt({ name: 'AES-GCM', iv: iv }, k, new TextEncoder().encode(JSON.stringify(data)));
    }).then(function (ct) {
      return { app: 'Smart Filter', type: TYPE, format: FORMAT, version: (meta && meta.version) || '', createdAt: new Date().toISOString(), auto: !!(meta && meta.auto),
        counts: counts(data), kdf: { name: 'PBKDF2', hash: 'SHA-256', iter: iter, salt: b64(salt) }, cipher: { name: 'AES-GCM', iv: b64(iv) }, data: b64(new Uint8Array(ct)) };
    });
  }
  function isBackup(f) { return !!(f && f.type === TYPE && f.kdf && f.cipher && typeof f.data === 'string'); }
  function decrypt(f, pw) {
    if (!isBackup(f)) return Promise.reject(new Error('这不是 Smart Filter 的加密备份文件（.sfbak）'));
    var C = subtle();
    return key(pw, unb64(f.kdf.salt), f.kdf.iter || ITER).then(function (k) {
      return C.subtle.decrypt({ name: 'AES-GCM', iv: unb64(f.cipher.iv) }, k, unb64(f.data));
    }).then(function (pt) { return JSON.parse(new TextDecoder().decode(pt)); }, function () { throw new Error('密码不对，或者文件损坏了'); });
  }

  /**
   * 收集数据。api：{ get(keys) → Promise<obj>（chrome.storage.local）, all(store) → Promise<[]>（hrscreener 数据库）, pdf(id) → Promise<Blob|null>, toDataUrl(blob) → Promise<string> }
   * opts.withPdf：带上简历收集里的 PDF 原件
   */
  function collect(api, opts) {
    opts = opts || {};
    return Promise.all([api.get(KEYS), api.all('candidates'), api.all('events'), api.all('decisions')]).then(function (r) {
      var o = r[0] || {};
      var st = Object.assign({}, o.settings || {});
      if (st.ai) st.ai = Object.assign({}, st.ai, { key: '' });   // AI Key 不进备份
      delete st.backupPw;
      var d = { settings: st, jds: o.jds || [], candidates: r[1] || [], events: r[2] || [], decisions: r[3] || [], resumeInbox: o.resumeInbox || [],
        evalSamples: o.evalSamples || [], procStats: o.procStats || null, deletionLog: o.deletionLog || [], talentAlias: o.talentAlias || {}, rejectPending: o.rejectPending || [], pdfs: {} };
      if (!opts.withPdf || !api.pdf) return d;
      var ids = d.resumeInbox.filter(function (x) { return x.file && x.file.hasBlob; }).map(function (x) { return x.id; });
      return ids.reduce(function (p, id) {
        return p.then(function () { return api.pdf(id); }).then(function (b) { return b ? api.toDataUrl(b).then(function (u) { d.pdfs[id] = u; }) : null; }).catch(function () {});
      }, Promise.resolve()).then(function () { return d; });
    });
  }

  function sig(e) { return [e.ts, e.type || e.module || '', e.name || '', e.detail || e.verdict || ''].join('|'); }
  /**
   * 恢复：cur 是本机现在的数据，inc 是备份里的。mode = 'merge'（默认）或 'replace'
   * 返回要写回去的完整数据和统计
   */
  function restorePlan(cur, inc, mode) {
    cur = cur || {}; inc = inc || {};
    if (mode === 'replace') {
      var keepKey = cur.settings && cur.settings.ai && cur.settings.ai.key;
      var st = Object.assign({}, inc.settings || {});
      if (keepKey) st.ai = Object.assign({}, st.ai || {}, { key: keepKey });
      return { data: Object.assign({}, inc, { settings: st }), stat: { mode: 'replace', candidates: (inc.candidates || []).length, jds: (inc.jds || []).length, inbox: (inc.resumeInbox || []).length } };
    }
    var stat = { mode: 'merge', addCand: 0, mergeCand: 0, addJd: 0, addInbox: 0, addPdf: 0, addEvents: 0, addDecisions: 0, addEval: 0 };
    var cands = (cur.candidates || []).slice();
    (inc.candidates || []).forEach(function (c) {
      var same = P ? P.findSame(cands, c) : cands.filter(function (x) { return x.id === c.id; })[0];
      if (!same) { cands.push(c); stat.addCand++; return; }
      if (same.id === c.id && (same.updatedAt || 0) >= (c.updatedAt || 0)) return;
      var i = cands.indexOf(same);
      cands[i] = P ? P.merge(same, c) : Object.assign({}, c, same);
      stat.mergeCand++;
    });
    var jds = (cur.jds || []).slice(), jdIds = jds.map(function (j) { return j.id; });
    (inc.jds || []).forEach(function (j) { if (jdIds.indexOf(j.id) < 0) { jds.push(j); stat.addJd++; } });
    var inbox = (cur.resumeInbox || []).slice(), ibIds = inbox.map(function (x) { return x.id; });
    var pdfs = {};
    (inc.resumeInbox || []).forEach(function (x) {
      if (ibIds.indexOf(x.id) >= 0) return;
      inbox.push(x); stat.addInbox++;
      if (inc.pdfs && inc.pdfs[x.id]) { pdfs[x.id] = inc.pdfs[x.id]; stat.addPdf++; }
    });
    var addLog = function (curL, incL, k) {
      var have = {}; (curL || []).forEach(function (e) { have[sig(e)] = 1; });
      var add = (incL || []).filter(function (e) { return !have[sig(e)]; }).map(function (e) { var x = Object.assign({}, e); delete x.id; return x; });
      stat[k] += add.length;
      return add;
    };
    var ev = (cur.evalSamples || []).slice(), evIds = ev.map(function (x) { return x.id; });
    (inc.evalSamples || []).forEach(function (x) { if (evIds.indexOf(x.id) < 0) { ev.push(x); stat.addEval++; } });
    var alias = Object.assign({}, inc.talentAlias || {}, cur.talentAlias || {});
    return {
      data: { candidates: cands, jds: jds, resumeInbox: inbox, pdfs: pdfs, evalSamples: ev, talentAlias: alias,
        eventsAdd: addLog(cur.events, inc.events, 'addEvents'), decisionsAdd: addLog(cur.decisions, inc.decisions, 'addDecisions') },
      stat: stat
    };
  }
  function statText(s) {
    if (s.mode === 'replace') return '已覆盖：人才库 ' + s.candidates + ' 人，岗位 ' + s.jds + ' 个，简历收集 ' + s.inbox + ' 份';
    return '已合并：新增候选人 ' + s.addCand + ' 人，合并 ' + s.mergeCand + ' 人，新增岗位 ' + s.addJd + ' 个，简历收集 ' + s.addInbox + ' 份（PDF ' + s.addPdf + ' 份），处理记录 ' + s.addEvents + ' 条，决定记录 ' + s.addDecisions + ' 条，评测样本 ' + s.addEval + ' 张';
  }
  function fileName(d, auto) {
    var p = function (n) { return String(n).padStart(2, '0'); };
    d = d || new Date();
    return 'SmartFilter-backup-' + d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate()) + (auto ? '-auto' : '-' + p(d.getHours()) + p(d.getMinutes())) + '.sfbak';
  }
  /** 上次备份多少天前：days、level（ok / warn / bad：超过 7 天） */
  function age(lastAt, now) {
    if (!lastAt) return { days: null, level: 'bad', text: '还没有做过全量备份' };
    var d = Math.floor(((now || Date.now()) - lastAt) / 86400000);
    return { days: d, level: d > 7 ? 'bad' : (d > 3 ? 'warn' : 'ok'), text: d <= 0 ? '今天做过备份' : '上次备份 ' + d + ' 天前' };
  }

  return { ITER: ITER, TYPE: TYPE, KEYS: KEYS, checkPw: checkPw, encrypt: encrypt, decrypt: decrypt, isBackup: isBackup, collect: collect,
    restorePlan: restorePlan, statText: statText, fileName: fileName, age: age, counts: counts };
});
