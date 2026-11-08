/* v1.9.25 界面简洁规范：页面上的说明文字（.desc / .n / .hint）收进「?」角标，鼠标悬停才显示。
   带 id 的元素是程序写入的状态（计数、路径预览、运行状态），保持原样显示。
   以后新加说明直接写成 <span class="qtip">?<span class="qbox">说明</span></span>，或照旧写 class="n"，这里会自动收起来。 */
(function () {
  'use strict';
  var CSS = '.qtip{position:relative;display:inline-flex;align-items:center;justify-content:center;width:16px;height:16px;border-radius:50%;background:var(--line);color:var(--text-2);font-size:var(--fs-xs);font-weight:600;font-style:normal;cursor:help;margin-left:6px;vertical-align:middle;flex:none;line-height:1;}' +
    '.qtip .qbox{display:none;position:absolute;left:22px;top:-6px;z-index:9999;width:300px;padding:8px 10px;background:var(--overlay);color:var(--on-color);font-size:var(--fs-sm);font-weight:400;line-height:1.6;border-radius:var(--r-sm);box-shadow:0 4px 14px rgba(0,0,0,.2);text-align:left;white-space:normal;}' +
    '.qtip.r .qbox{left:auto;right:22px;}' +
    '.qtip:hover .qbox{display:block;}';
  function addCss() {
    if (document.getElementById('__qtip_css__')) return;
    var st = document.createElement('style'); st.id = '__qtip_css__'; st.textContent = CSS;
    (document.head || document.documentElement).appendChild(st);
  }
  function badge(text) {
    var b = document.createElement('span'); b.className = 'qtip'; b.textContent = '?';
    var box = document.createElement('span'); box.className = 'qbox'; box.textContent = text;
    b.appendChild(box);
    return b;
  }
  // 说明里的纯文字（不含带 id 的子元素，那些是程序写入的状态）
  function staticText(el) {
    var t = '';
    el.childNodes.forEach(function (n) {
      if (n.nodeType === 3) t += n.textContent;
      else if (n.nodeType === 1 && !n.id && !n.querySelector('[id]')) t += n.textContent;
    });
    return t.replace(/\s+/g, ' ').trim();
  }
  function stripStatic(el) {
    Array.prototype.slice.call(el.childNodes).forEach(function (n) {
      if (n.nodeType === 3 || (n.nodeType === 1 && !n.id && !n.querySelector('[id]'))) el.removeChild(n);
    });
  }
  function anchorFor(el) {
    var p = el.parentElement;
    if (!p) return null;
    if (el.classList.contains('desc')) {
      var h = p.querySelector('h1,h2,h3');
      if (h && h.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_FOLLOWING) return h;
    }
    var field = el.closest('.field');
    if (field) { var l = field.querySelector('label'); if (l && !l.contains(el)) return l; }
    var step = el.closest('.step');
    if (step) { var s = step.querySelector('.st'); if (s) return s; }
    var row = el.closest('.row');
    if (row) { var k = row.querySelector(':scope > .k'); if (k) return k; }
    return null;
  }
  function run(root) {
    addCss();
    (root || document).querySelectorAll('.desc,.n,.hint').forEach(function (el) {
      if (el.dataset.qtip || el.closest('.qtip') || el.closest('[data-keep-hint]')) return;
      if (el.style.display === 'none') return;
      if (el.id) return;                       // 整个是状态位，留着
      var text = staticText(el);
      if (!text) return;
      el.dataset.qtip = '1';
      var a = anchorFor(el);
      var b = badge(text);
      if (a) {
        a.appendChild(b);
        stripStatic(el);
        if (!el.children.length) el.style.display = el.tagName === 'SPAN' ? '' : 'none';
      } else {
        // 找不到可挂的标题：就地换成角标（网格里的说明格保持占位）
        stripStatic(el);
        el.insertBefore(b, el.firstChild);
      }
    });
  }
  // 靠右的角标往左弹，免得被裁掉（悬停时再算，隐藏的标签页加载时量不到位置）
  document.addEventListener('mouseover', function (e) {
    var q = e.target.closest && e.target.closest('.qtip');
    if (!q) return;
    var r = q.getBoundingClientRect();
    q.classList.toggle('r', r.left > window.innerWidth - 330);
  });
  window.HRSQtip = { run: run, badge: badge };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', function () { run(); });
  else run();
})();
