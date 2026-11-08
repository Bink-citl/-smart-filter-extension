/* rhythm-card.js v2.3.0：设置页「操作节奏（拟人停顿）」卡片。保存到 settings.rhythm，页面上的智选和打招呼立即按新节奏走 */
(function () {
  'use strict';
  function $(id) { return document.getElementById(id); }
  var O = window.HRSOpt, R = window.HRSRhythm;
  if (!R || !$('cardRhythm')) return;
  var NUMS = ['gapMin', 'gapMax', 'hesitatePct', 'hesitateMin', 'hesitateMax', 'paceVar', 'breakEveryMin', 'breakEveryMax', 'breakMin', 'breakMax', 'speedVar'];
  var PRESETS = {
    calm: { on: true, gapMin: 0.6, gapMax: 2.5, hesitatePct: 18, hesitateMin: 2, hesitateMax: 6, paceVar: 40, breakEveryMin: 5, breakEveryMax: 10, breakMin: 45, breakMax: 150, speedVar: 30, typePause: true },
    def: R.DEFAULTS,
    fast: { on: true, gapMin: 0.2, gapMax: 1.0, hesitatePct: 8, hesitateMin: 1.5, hesitateMax: 3, paceVar: 20, breakEveryMin: 10, breakEveryMax: 18, breakMin: 20, breakMax: 60, speedVar: 15, typePause: true }
  };
  var settings = {};
  function read() {
    var r = { on: $('rh_on').checked, typePause: $('rh_typePause').checked };
    NUMS.forEach(function (k) { r[k] = Number($('rh_' + k).value); });
    return R.norm(r);
  }
  function paint(r) {
    r = R.norm(r);
    $('rh_on').checked = r.on;
    $('rh_typePause').checked = r.typePause;
    NUMS.forEach(function (k) { var el = $('rh_' + k); if (document.activeElement !== el) el.value = r[k]; });
    $('cardRhythm').classList.toggle('rh-off', !r.on);
    preview(r);
  }
  function preview(r) {
    var ps = settings.paceSec || 20, gs = settings.greetPaceSec || 45;
    var a = R.perHour(ps, r), b = R.perHour(gs, r);
    $('rh_preview').textContent = R.describe(r) + '。\n智选（节拍 ' + ps + ' 秒）约 ' + a.lo + '~' + a.hi + ' 个/小时' +
      '；打招呼（节拍 ' + gs + ' 秒）约 ' + b.lo + '~' + b.hi + ' 个/小时（只算真正动手的，不含等新消息的时间）';
  }
  function save(r, msg) {
    paint(r);
    O.save({ rhythm: r }, msg || '操作节奏已保存');
  }
  NUMS.forEach(function (k) {
    $('rh_' + k).addEventListener('change', function () { save(read()); });
  });
  ['rh_on', 'rh_typePause'].forEach(function (id) { $(id).addEventListener('change', function () { save(read(), $('rh_on').checked ? '拟人节奏已开启' : '拟人节奏已关闭，按固定节拍运行'); }); });
  document.querySelectorAll('#cardRhythm .rh-preset .pchip').forEach(function (c) {
    c.addEventListener('click', function () { save(Object.assign({}, PRESETS[c.dataset.p]), '已套用：' + c.textContent); });
  });
  $('rh_reset').addEventListener('click', function () { save(Object.assign({}, R.DEFAULTS), '操作节奏已恢复默认'); });
  HRSStore.loadSettings().then(function (s) { settings = s || {}; paint(settings.rhythm); });
  chrome.storage.onChanged.addListener(function (ch, area) {
    if (area !== 'local' || !ch.settings || !ch.settings.newValue) return;
    settings = ch.settings.newValue;
    paint(settings.rhythm);
  });
})();
