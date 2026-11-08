/* empty.js v3.0.0：空状态和加载骨架屏（方案 B 第三阶段，工作台 / 报表共用）
 * - 空状态：一张线条插画 + 一句标题 + 一句说明 + 下一步按钮。插画用令牌颜色，浅色、深色都对
 *   HRSEmpty.html('inbox', { title, text, actions: [{ label, go | click | reset, primary }] , compact })
 *   go：新标签页打开网址；click：点页面上的某个元素（CSS 选择器）；reset：把这几个筛选框清空（id 用逗号隔开）
 * - 骨架屏：带 data-sk 的容器在数据读出来之前先显示灰色占位（rows:6 / cards:3 / tr:12x8 / kpi:7 / block），
 *   页面自己画内容时会整个替换掉。图表容器在页面加上 body.hrs-ready 之前显示占位
 * - 系统设置了「减少动画」时，骨架屏不闪动（theme.css 里）
 */
(function () {
  'use strict';
  if (window.HRSEmpty) return;
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }

  // ---------------- 插画（120 × 88，线条风格，带一点芯片元素） ----------------
  // .l 线条（品牌浅色）  .a 强调（硅青）  .f 面（浅底）  .d 虚线
  var CHIP = function (x, y, s) {   // 一颗小芯片：方块 + 四边引脚
    var p = [], k = s / 4;
    for (var i = 1; i <= 3; i++) {
      p.push('M' + (x + k * i) + ' ' + y + 'v-3', 'M' + (x + k * i) + ' ' + (y + s) + 'v3', 'M' + x + ' ' + (y + k * i) + 'h-3', 'M' + (x + s) + ' ' + (y + k * i) + 'h3');
    }
    return '<rect class="f a" x="' + x + '" y="' + y + '" width="' + s + '" height="' + s + '" rx="2"/><path class="a" d="' + p.join('') + '"/>';
  };
  var ILL = {
    // 简历收集：托盘里一份 PDF，上面落下一份，旁边一颗芯片
    inbox: '<path class="d" d="M60 6v14"/><path class="l" d="M54 16l6 6 6-6"/>' +
      '<rect class="f l" x="40" y="26" width="34" height="40" rx="3"/><path class="l" d="M47 38h20M47 45h20M47 52h12"/><text class="t" x="57" y="34" text-anchor="middle">PDF</text>' +
      '<path class="f l" d="M22 58h20l4 8h28l4-8h20v20a3 3 0 0 1-3 3H25a3 3 0 0 1-3-3z"/>' + CHIP(88, 24, 16),
    // 人才库：两个人像，背后是晶圆网格
    pool: '<circle class="d" cx="60" cy="46" r="36"/><path class="d" d="M30 46h60M60 10v72M38 22l44 48M82 22 38 70"/>' +
      '<circle class="f l" cx="50" cy="38" r="9"/><path class="f l" d="M34 70c1-10 8-16 16-16s15 6 16 16z"/>' +
      '<circle class="f a" cx="74" cy="42" r="7"/><path class="f a" d="M62 70c1-8 6-12 12-12s11 4 12 12z"/>',
    // 岗位列表：公文包，引出几条电路线
    jobs: '<rect class="f l" x="34" y="30" width="44" height="34" rx="4"/><path class="l" d="M48 30v-6a3 3 0 0 1 3-3h10a3 3 0 0 1 3 3v6M34 44h44"/>' +
      '<path class="a" d="M78 38h12l6-6h10M78 54h16l4 4h8M34 48H22l-6 6H8"/><circle class="f a" cx="106" cy="32" r="2.5"/><circle class="f a" cx="106" cy="58" r="2.5"/><circle class="f a" cx="8" cy="54" r="2.5"/>',
    // 运行记录：示波器样的波形 + 时间轴
    runlog: '<rect class="f l" x="16" y="16" width="88" height="54" rx="4"/><path class="d" d="M16 43h88M38 16v54M60 16v54M82 16v54"/>' +
      '<path class="a" d="M20 52h10l4-20 6 30 6-22 5 12h8l4-8 5 8h12l5-14 5 14h10"/><path class="l" d="M30 80h60"/><circle class="f a" cx="44" cy="80" r="2.5"/><circle class="f l" cx="76" cy="80" r="2.5"/>',
    // 数据统计：柱状图立在晶圆上
    stats: '<ellipse class="f d" cx="60" cy="72" rx="44" ry="10"/><path class="l" d="M24 66h72"/>' +
      '<rect class="f l" x="32" y="44" width="10" height="22" rx="2"/><rect class="f a" x="48" y="30" width="10" height="36" rx="2"/><rect class="f l" x="64" y="38" width="10" height="28" rx="2"/><rect class="f a" x="80" y="22" width="10" height="44" rx="2"/>' +
      '<path class="a" d="M37 38l16-14 16 8 16-16"/>',
    // 筛选没结果：放大镜压在芯片网格上
    filter: '<path class="d" d="M18 24h52M18 40h52M18 56h52M30 12v56M46 12v56"/>' + CHIP(64, 20, 20).replace(/ a"/g, ' l"').replace(/class="a"/, 'class="l"') +
      '<circle class="f a" cx="50" cy="48" r="16"/><path class="a" d="m62 60 14 14"/><path class="a" d="M44 48h12"/>'
  };
  function svg(kind) {
    return '<svg class="hrs-ill" viewBox="0 0 120 88" aria-hidden="true">' + (ILL[kind] || ILL.filter) + '</svg>';
  }

  /**
   * 空状态。o.title 标题，o.text 说明（可以带 <a data-reset> 这类链接，调用方负责转义），o.actions 下一步按钮，o.compact 小一号
   */
  function html(kind, o) {
    o = o || {};
    var acts = (o.actions || []).map(function (a, i) {
      var attr = a.go ? ' data-empty-go="' + esc(a.go) + '"' : a.click ? ' data-empty-click="' + esc(a.click) + '"' : a.reset ? ' data-empty-reset="' + esc(a.reset) + '"' : '';
      return '<button type="button" class="btn' + (a.primary || (i === 0 && a.primary !== false) ? '' : ' ghost') + (o.compact ? ' sm' : '') + '"' + attr + '>' + esc(a.label) + '</button>';
    }).join('');
    return '<div class="hrs-empty' + (o.compact ? ' compact' : '') + '" data-empty="' + esc(kind) + '">' + svg(kind) + '<div class="he-b">' +
      (o.title ? '<b class="he-t">' + esc(o.title) + '</b>' : '') + (o.text ? '<p class="he-p">' + o.text + '</p>' : '') +
      (acts ? '<div class="he-a">' + acts + '</div>' : '') + '</div></div>';
  }
  /** 表格里用：整行一个格子 */
  function row(cols, kind, o) { return '<tr class="hrs-empty-tr"><td colspan="' + cols + '">' + html(kind, o) + '</td></tr>'; }

  // ---------------- 骨架屏 ----------------
  function bar(w, h) { return '<i style="width:' + w + ';height:' + (h || 10) + 'px"></i>'; }
  function sk(spec) {
    var m = String(spec || 'block').match(/^([a-z]+)(?::(\d+)(?:x(\d+))?)?$/) || [];
    var kind = m[1] || 'block', n = +(m[2] || 4), cols = +(m[3] || 6);
    var W = ['82%', '64%', '74%', '56%', '68%', '78%'];
    var out = '';
    if (kind === 'rows') {
      for (var i = 0; i < n; i++) out += '<div class="hrs-sk sk-row">' + bar('18px', 18) + '<span>' + bar(W[i % 6].replace(/\d+/, function (x) { return Math.round(x * 0.5); })) + bar(W[(i + 2) % 6], 8) + '</span>' + bar('64px', 18) + '</div>';
    } else if (kind === 'cards') {
      for (var j = 0; j < n; j++) out += '<div class="hrs-sk sk-card"><div class="sk-hd">' + bar('34px', 34) + '<span>' + bar('40%', 12) + bar('62%', 8) + '</span></div>' + bar('92%') + bar('70%') + '<div class="sk-ft">' + bar('84px', 26) + bar('84px', 26) + '</div></div>';
    } else if (kind === 'tr') {
      for (var r = 0; r < n; r++) {
        out += '<tr class="hrs-sk sk-tr">';
        for (var c = 0; c < cols; c++) out += '<td>' + bar(W[(r + c) % 6]) + '</td>';
        out += '</tr>';
      }
    } else if (kind === 'kpi') {
      for (var k = 0; k < n; k++) out += '<div class="hrs-sk sk-kpi">' + bar('40%', 8) + bar('56%', 22) + bar('48%', 8) + '</div>';
    } else {
      out = '<div class="hrs-sk sk-block">' + bar('36%', 12) + bar('88%') + bar('76%') + bar('64%') + '</div>';
    }
    return out;
  }
  function fill(root) {
    Array.prototype.forEach.call((root || document).querySelectorAll('[data-sk]'), function (el) {
      if (el.children.length || el.textContent.trim()) return;   // 页面已经画好了内容，不动
      el.innerHTML = sk(el.getAttribute('data-sk'));
      el.setAttribute('aria-busy', 'true');
    });
  }
  // 内容画出来以后去掉 aria-busy
  if (window.MutationObserver) {
    new MutationObserver(function (ms) {
      ms.forEach(function (m) {
        var el = m.target;
        if (el.nodeType === 1 && el.hasAttribute && el.hasAttribute('aria-busy') && !el.querySelector('.hrs-sk')) el.removeAttribute('aria-busy');
      });
    }).observe(document.documentElement, { childList: true, subtree: true });
  }
  /** 页面数据读完了：图表占位去掉 */
  function ready() { document.body && document.body.classList.add('hrs-ready'); }

  // ---------------- 下一步按钮 ----------------
  document.addEventListener('click', function (e) {
    var b = e.target.closest && e.target.closest('[data-empty-go],[data-empty-click],[data-empty-reset]');
    if (!b) return;
    e.preventDefault();
    var go = b.getAttribute('data-empty-go'), click = b.getAttribute('data-empty-click'), reset = b.getAttribute('data-empty-reset');
    if (go) { try { chrome.tabs.create({ url: go }); } catch (x) { window.open(go, '_blank', 'noopener'); } return; }
    if (click) { var t = document.querySelector(click); if (t) t.click(); return; }
    if (reset) {
      reset.split(',').forEach(function (id) {
        var el = document.getElementById(id.trim());
        if (!el) return;
        el.value = '';
        el.dispatchEvent(new Event(el.tagName === 'SELECT' ? 'change' : 'input', { bubbles: true }));
      });
    }
  });

  window.HRSEmpty = { html: html, row: row, sk: sk, fill: fill, ready: ready, svg: svg };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', function () { fill(); }); else fill();
  // 读数据出错时不让占位一直转：12 秒后一律当作读完
  setTimeout(ready, 12000);
})();
