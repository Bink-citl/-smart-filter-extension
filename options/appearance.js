/* appearance.js v2.9.0：设置 → 外观（浅色 / 深色 / 跟随系统、侧边栏收起） */
(function () {
  'use strict';
  var box = document.getElementById('apOpts');
  if (!box || !window.HRSTheme) return;
  var opts = Array.prototype.slice.call(box.querySelectorAll('.ap-opt'));
  function paint() {
    var m = HRSTheme.get();
    opts.forEach(function (o) {
      var on = o.getAttribute('data-m') === m;
      o.classList.toggle('on', on);
      o.querySelector('input').checked = on;
      o.setAttribute('aria-checked', on ? 'true' : 'false');
    });
  }
  box.addEventListener('change', function (e) {
    if (e.target && e.target.name === 'apTheme') HRSTheme.set(e.target.value);
  });
  document.addEventListener('hrs-theme-mode', paint);
  paint();

  var side = document.getElementById('apSideMini');
  if (side) {
    var sync = function () { side.checked = document.body.classList.contains('side-mini'); };
    side.addEventListener('change', function () { if (window.HRSShell && HRSShell.sideMini) HRSShell.sideMini(side.checked); });
    new MutationObserver(sync).observe(document.body, { attributes: true, attributeFilter: ['class'] });
    sync();
  }
})();
