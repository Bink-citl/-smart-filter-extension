/**
 * remote-config.js v3.6.0：远程选择器配置
 *   平台改版、插件抓不到候选人时，管理员改好选择器，放到自建配置服务器上的一个 JSON 文件里。
 *   每台电脑上的插件每天取一次（设置 · 选择器与诊断 里也可以点「立即更新」），不用每个人重新装插件。
 *   只认识的字段才收：平台（boss / liepin）下面的选择器列表，每项是字符串。其他内容一律不收（不会执行任何代码）
 *
 *   文件格式：{ "format": 1, "version": "2026-11-06", "boss": { "conversationSelectors": ["li.geek-item", ...] }, "liepin": { ... } }
 */
(function (root, factory) {
  if (typeof module !== 'undefined' && module.exports) module.exports = factory();
  else root.HRSRemoteConfig = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var SITES = ['boss', 'liepin'], MAX_ITEMS = 40, MAX_LEN = 300;
  /** defaults：HRSSiteConfig.CONFIG。只收 defaults 里本来就是列表的字段 */
  function allowed(defaults, site) {
    var d = (defaults && defaults[site]) || {};
    return Object.keys(d).filter(function (k) { return Array.isArray(d[k]); });
  }
  function validate(obj, defaults) {
    var out = { ok: false, cfg: {}, problems: [], keys: 0, version: '' };
    if (!obj || typeof obj !== 'object' || Array.isArray(obj)) { out.problems.push('不是 JSON 对象'); return out; }
    if (obj.format != null && obj.format !== 1) out.problems.push('format 应该是 1');
    out.version = String(obj.version || obj.updatedAt || '').slice(0, 40);
    Object.keys(obj).forEach(function (k) {
      if (['format', 'version', 'updatedAt', 'note'].indexOf(k) >= 0) return;
      if (SITES.indexOf(k) < 0) out.problems.push('不认识的字段「' + k + '」，已忽略');
    });
    SITES.forEach(function (site) {
      var src = obj[site];
      if (src == null) return;
      if (typeof src !== 'object' || Array.isArray(src)) { out.problems.push(site + ' 应该是对象'); return; }
      var ok = allowed(defaults, site), cfg = {};
      Object.keys(src).forEach(function (k) {
        if (ok.indexOf(k) < 0) { out.problems.push(site + '.' + k + ' 不是选择器字段，已忽略'); return; }
        var v = src[k];
        if (!Array.isArray(v) || !v.length) { out.problems.push(site + '.' + k + ' 应该是非空的字符串列表'); return; }
        var arr = v.filter(function (x) { return typeof x === 'string' && x.trim() && x.length <= MAX_LEN && !/[<>]|javascript:/i.test(x); }).map(function (x) { return x.trim(); });
        if (arr.length !== v.length) out.problems.push(site + '.' + k + ' 有 ' + (v.length - arr.length) + ' 项不合格，已去掉');
        if (!arr.length) return;
        cfg[k] = arr.slice(0, MAX_ITEMS);
        out.keys++;
      });
      if (Object.keys(cfg).length) out.cfg[site] = cfg;
    });
    out.ok = out.keys > 0;
    if (!out.ok && !out.problems.length) out.problems.push('文件里没有选择器');
    return out;
  }
  /** 把校验过的远程配置盖到本机 siteConfig 上（没写到的字段保留本机的 / 内置的） */
  function apply(siteConfig, v, defaults) {
    var cur = JSON.parse(JSON.stringify(siteConfig || {}));
    Object.keys(v.cfg || {}).forEach(function (site) {
      var base = cur[site] || JSON.parse(JSON.stringify((defaults && defaults[site]) || {}));
      Object.keys(v.cfg[site]).forEach(function (k) { base[k] = v.cfg[site][k].slice(); });
      cur[site] = base;
    });
    return cur;
  }
  function okUrl(u) { return /^https?:\/\/[^\s/]+\/\S*$/i.test(String(u || '').trim()); }

  return { validate: validate, apply: apply, okUrl: okUrl, allowed: allowed };
});
