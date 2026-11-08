/**
 * rhythm.js v2.3.0：拟人操作节奏（Boss / 猎聘的智选和打招呼共用）
 * 解决 v2.2.3「处理节奏太过规律」：
 *   ① 动作间停顿：每次点击 / 打字 / 按键前随机停一下，偶尔「犹豫」久一点；
 *   ② 节拍浮动：每位候选人占用的时间按节拍上下浮动，不再是固定间隔；
 *   ③ 小憩：每处理几个人随机休息一会儿（时长有上限，最多 5 分钟）；
 *   ④ 鼠标和打字速度每次略有快慢，长话术分几段打，段间偶尔停一下。
 * 所有数值都可在「设置 · 操作节奏」里改，关掉总开关就回到 v2.2.3 的节奏。
 */
(function (root, factory) {
  if (typeof module !== 'undefined' && module.exports) module.exports = factory();
  else root.HRSRhythm = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var DEFAULTS = {
    on: true,
    gapMin: 0.4, gapMax: 1.8,             // 动作间停顿（秒）
    hesitatePct: 12,                      // 偶尔犹豫的概率（%）
    hesitateMin: 2, hesitateMax: 5,       // 犹豫时长（秒）
    paceVar: 30,                          // 每位候选人节拍浮动（±%）
    breakEveryMin: 6, breakEveryMax: 12,  // 每处理多少人小憩一次（随机）
    breakMin: 30, breakMax: 90,           // 小憩时长（秒）
    speedVar: 25,                         // 鼠标 / 打字速度浮动（±%）
    typePause: true                       // 长话术分段打，段间偶尔停顿
  };
  // 上下限：停顿不要太久
  var LIMITS = {
    gapMin: [0, 10], gapMax: [0, 10],
    hesitatePct: [0, 50], hesitateMin: [0.5, 20], hesitateMax: [0.5, 20],
    paceVar: [0, 60],
    breakEveryMin: [2, 50], breakEveryMax: [2, 50],
    breakMin: [5, 300], breakMax: [5, 300],
    speedVar: [0, 50]
  };

  function num(v, d) { var n = Number(v); return isFinite(n) ? n : d; }
  function clamp(v, a, b) { return Math.min(b, Math.max(a, v)); }
  function rand(a, b) { return a + Math.random() * (b - a); }

  /** 把设置里的 rhythm 补齐并夹到合法范围；最小值大于最大值时自动对调 */
  function norm(r) {
    r = r || {};
    var o = {};
    Object.keys(DEFAULTS).forEach(function (k) {
      if (typeof DEFAULTS[k] === 'boolean') o[k] = r[k] === undefined ? DEFAULTS[k] : !!r[k];
      else o[k] = clamp(num(r[k], DEFAULTS[k]), LIMITS[k][0], LIMITS[k][1]);
    });
    [['gapMin', 'gapMax'], ['hesitateMin', 'hesitateMax'], ['breakEveryMin', 'breakEveryMax'], ['breakMin', 'breakMax']].forEach(function (p) {
      if (o[p[0]] > o[p[1]]) { var t = o[p[0]]; o[p[0]] = o[p[1]]; o[p[1]] = t; }
    });
    o.breakEveryMin = Math.round(o.breakEveryMin); o.breakEveryMax = Math.round(o.breakEveryMax);
    return o;
  }
  function of(settings) { return norm(settings && settings.rhythm); }

  /**
   * 动作前停顿（毫秒）。kind：click / type / key 用完整停顿并可能犹豫；wheel / hover 只用一小段
   * 停顿偏向短的一端（多数时候很快，偶尔慢一点），不是均匀分布
   */
  function gapMs(r, kind) {
    r = norm(r);
    if (!r.on) return 0;
    var g = r.gapMin + (r.gapMax - r.gapMin) * Math.pow(Math.random(), 1.6);
    if (kind === 'wheel' || kind === 'hover') return Math.round(g * 0.4 * 1000);
    if (Math.random() * 100 < r.hesitatePct) g += rand(r.hesitateMin, r.hesitateMax);
    return Math.round(g * 1000);
  }
  /** 节拍系数：在 [1 - 浮动/2, 1 + 浮动] 之间，三角分布，平均略慢于节拍 */
  function paceFactor(r) {
    r = norm(r);
    if (!r.on || !r.paceVar) return 1;
    var v = r.paceVar / 100, lo = 1 - v / 2, hi = 1 + v;
    var t = (Math.random() + Math.random()) / 2;
    return lo + (hi - lo) * t;
  }
  /** 看一眼就跳过的卡片停留时长（毫秒），原来固定 1.5~3.5 秒 */
  function skimMs(r) {
    r = norm(r);
    if (!r.on) return Math.round(rand(1500, 3500));
    var base = rand(1200, 3200);
    if (Math.random() < 0.15) base += rand(1500, 3500);   // 偶尔多看几眼
    return Math.round(base);
  }
  /** 速度倍数浮动（1 ± speedVar%） */
  function speedFactor(r) {
    r = norm(r);
    if (!r.on || !r.speedVar) return 1;
    var v = r.speedVar / 100;
    return clamp(1 + (Math.random() * 2 - 1) * v, 0.5, 1.6);
  }
  /** 打字分段：按标点切成几段（每段至少 6 个字），短话术不切 */
  function typeChunks(text, r) {
    r = norm(r);
    text = String(text || '');
    if (!r.on || !r.typePause || text.length < 16) return [text];
    var parts = text.split(/([，。！？；,.!?;：:\n]+)/);
    var out = [], cur = '';
    for (var i = 0; i < parts.length; i++) {
      cur += parts[i];
      var isDelim = i % 2 === 1;
      if (isDelim && cur.length >= 6) { out.push(cur); cur = ''; }
    }
    if (cur) { if (out.length && cur.length < 6) out[out.length - 1] += cur; else out.push(cur); }
    return out.length ? out : [text];
  }
  /** 两段之间停多久（毫秒），大约三分之一的段间会停 */
  function typePauseMs(r) {
    r = norm(r);
    if (!r.on || !r.typePause) return 0;
    return Math.random() < 0.35 ? Math.round(rand(400, 1400)) : Math.round(rand(60, 220));
  }

  /** 小憩计数器：每个引擎一个。tick() 处理完一个人调用一次，到点返回要休息的毫秒数，否则 0 */
  function Breaker() { this.count = 0; this.target = 0; this.until = 0; this.ms = 0; }
  Breaker.prototype.tick = function (r) {
    r = norm(r);
    if (!r.on) { this.count = 0; this.target = 0; return 0; }
    if (!this.target) this.target = Math.round(rand(r.breakEveryMin, r.breakEveryMax));
    this.count++;
    if (this.count < this.target) return 0;
    this.count = 0;
    this.target = Math.round(rand(r.breakEveryMin, r.breakEveryMax));
    this.ms = Math.round(rand(r.breakMin, r.breakMax) * 1000);
    this.until = Date.now() + this.ms;
    return this.ms;
  };
  Breaker.prototype.resting = function () { return this.until > Date.now(); };
  Breaker.prototype.left = function () { return Math.max(0, Math.ceil((this.until - Date.now()) / 1000)); };
  Breaker.prototype.cancel = function () { this.until = 0; };
  Breaker.prototype.toGo = function () { return this.target ? Math.max(0, this.target - this.count) : null; };

  /** 一句话说明当前节奏（设置页、浮层用） */
  function describe(r) {
    r = norm(r);
    if (!r.on) return '拟人节奏已关闭（按固定节拍）';
    return '动作间停 ' + r.gapMin + '~' + r.gapMax + ' 秒' +
      (r.hesitatePct ? '，' + r.hesitatePct + '% 概率多停 ' + r.hesitateMin + '~' + r.hesitateMax + ' 秒' : '') +
      '；节拍浮动 ±' + r.paceVar + '%' +
      '；每 ' + r.breakEveryMin + '~' + r.breakEveryMax + ' 人休息 ' + r.breakMin + '~' + r.breakMax + ' 秒';
  }
  /** 估算每小时处理人数区间（给设置页预览用） */
  function perHour(paceSec, r) {
    r = norm(r);
    paceSec = Math.max(3, num(paceSec, 20));
    if (!r.on) return { lo: Math.floor(3600 / paceSec), hi: Math.floor(3600 / paceSec) };
    var v = r.paceVar / 100;
    var avgBreak = (r.breakMin + r.breakMax) / 2, avgEvery = (r.breakEveryMin + r.breakEveryMax) / 2;
    var slow = paceSec * (1 + v) + r.breakMax / r.breakEveryMin;
    var fast = paceSec * (1 - v / 2) + r.breakMin / r.breakEveryMax;
    var mid = paceSec * (1 + v / 4) + avgBreak / avgEvery;
    return { lo: Math.floor(3600 / slow), hi: Math.floor(3600 / fast), mid: Math.floor(3600 / mid) };
  }

  return {
    DEFAULTS: DEFAULTS, LIMITS: LIMITS, norm: norm, of: of,
    gapMs: gapMs, paceFactor: paceFactor, skimMs: skimMs, speedFactor: speedFactor,
    typeChunks: typeChunks, typePauseMs: typePauseMs,
    Breaker: Breaker, describe: describe, perHour: perHour
  };
});
