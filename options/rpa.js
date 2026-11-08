/* rpa.js v1.9.48：设置页「智选 · Boss 执行方式（RPA）」，复用 v1.9.2 */
(function () {
  'use strict';
  function $(id) { return document.getElementById(id); }
  var O = window.HRSOpt;
  function paint(m) {
    document.querySelectorAll('#bossExecSeg button').forEach(function (b) { b.classList.toggle('on', b.dataset.m === m); });
  }
  function ping() {
    var el = $('rpaStatus');
    el.style.color = '';
    el.textContent = '检测中…';
    chrome.runtime.sendMessage({ type: 'RPA_PING' }, function (r) {
      void chrome.runtime.lastError;
      if (r && r.ok) {
        el.style.color = 'var(--ok)';
        el.textContent = '[完成] 已连接 RPA 助手 v' + r.version + '（DPI 模式 ' + r.dpi + '，' +
          (r.hook ? '能分辨你手动的鼠标键盘' : '输入钩子没装上，改用鼠标位置判断你是否在操作') + (r.locked ? '，当前屏幕已锁定' : '') + '）';
      } else {
        el.style.color = 'var(--bad)';
        el.textContent = '[失败] ' + ((r && r.why) || '插件后台没回应');
      }
    });
  }
  document.querySelectorAll('#bossExecSeg button').forEach(function (b) {
    b.addEventListener('click', function () {
      paint(b.dataset.m);
      O.save({ bossExec: b.dataset.m }, 'Boss 执行方式：' + b.textContent);
      if (b.dataset.m === 'rpa') ping();
    });
  });
  $('btnRpaPing').addEventListener('click', ping);
  $('rpaSpeed').addEventListener('change', function () {
    O.save({ rpaSpeed: Number(this.value) || 1 }, 'RPA 速度：' + this.options[this.selectedIndex].text);
  });
  $('rpaIdleSec').addEventListener('change', function () {
    var n = parseInt(this.value, 10);
    if (!isFinite(n)) n = 8;
    n = Math.min(120, Math.max(0, n));
    this.value = n;
    O.save({ rpaIdleSec: n }, 'RPA 让位时间 ' + n + ' 秒');
  });
  HRSStore.loadSettings().then(function (s) {
    var m = s.bossExec || 'rpa';
    paint(m);
    $('rpaSpeed').value = String(s.rpaSpeed || 1);
    $('rpaIdleSec').value = s.rpaIdleSec != null ? s.rpaIdleSec : 8;
    if (m === 'rpa') ping();
  });
})();
