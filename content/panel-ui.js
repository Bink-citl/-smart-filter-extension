/* panel-ui.js v2.9.0：智选 / 打招呼浮层的公共部分
 * - mount()：浮层放进隔离层（Shadow DOM）。BOSS、猎聘页面自己的样式进不来，浮层的样式也不会影响页面
 *   隔离层外面只有一个空的占位元素，id 和以前一样（__hrs_ui__ / __hrs_greet__），页面上判断「是不是点在浮层上」的逻辑不用改
 *   隔离层里先放设计令牌（content/tokens.js，来自 ui/tokens.css），浮层样式里的颜色、圆角、字号都用令牌
 * - 浅色 / 深色：跟插件「设置 → 外观」走，不跟平台页面变
 * - resizable()：外框四条边和四个角都能拖，改宽度和高度；双击边框恢复默认大小。大小记在本页面（localStorage）
 */
(function () {
  'use strict';
  if (window.HRSPanel) return;
  var CSS_ID = '__hrs_panel_css__';
  // 隔离层里的基础样式：令牌 + 字体继承（隔离层里的按钮、输入框默认不继承字体）
  var BASE = 'button,input,select,textarea{font-family:inherit;}';
  /**
   * 令牌改写成隔离层里用的样式：去掉 :root，:host 规则同时挂到浮层根元素上
   * （页面就算给占位元素设了同名变量，也盖不住浮层里的值）。深色用 data-hrs-theme，避免和页面自己的 data-theme 样式撞上
   */
  function tokenCss(id) {
    var t = (window.HRSTokens && window.HRSTokens.css) || '';
    return t.replace(/([^{}]+)\{/g, function (m, sel) {
      var out = [];
      sel.split(',').forEach(function (x) {
        x = x.trim().replace(/data-theme/g, 'data-hrs-theme');
        if (!x || /^:root/.test(x)) return;
        out.push(x);
        if (/^:host/.test(x)) out.push(x === ':host' ? '#' + id : x + ' #' + id);
      });
      return out.join(',') + '{';
    }) + BASE;
  }

  // ---- 浅色 / 深色：跟「设置 → 外观」走（uiTheme：system / light / dark），不跟 BOSS、猎聘页面变 ----
  var themeMode = 'system';
  var mq = null;
  try { mq = window.matchMedia('(prefers-color-scheme: dark)'); } catch (e) {}
  function resolvedTheme() { return themeMode === 'light' || themeMode === 'dark' ? themeMode : (mq && mq.matches ? 'dark' : 'light'); }
  function paintTheme() {
    var r = resolvedTheme();
    Array.prototype.forEach.call(document.querySelectorAll('[data-hrs-host]'), function (h) { h.setAttribute('data-hrs-theme', r); });
  }
  try {
    chrome.storage.local.get('uiTheme', function (o) { themeMode = (o && o.uiTheme) || 'system'; paintTheme(); });
    chrome.storage.onChanged.addListener(function (ch, area) { if (area === 'local' && ch.uiTheme) { themeMode = ch.uiTheme.newValue || 'system'; paintTheme(); } });
  } catch (e) {}
  if (mq) { try { mq.addEventListener('change', paintTheme); } catch (e) {} }

  /** 建一个隔离层浮层：返回里面的根元素（id 和占位元素相同）。浏览器不支持隔离层时退回直接挂在页面上 */
  function mount(id) {
    var host = document.createElement('div');
    host.id = id;
    host.setAttribute('data-hrs-host', '1');
    host.setAttribute('data-hrs-theme', resolvedTheme());
    // 占位元素本身不占位置、不吃页面样式
    host.style.cssText = 'all:initial !important;display:block !important;position:static !important;width:0 !important;height:0 !important;';
    var root = host.attachShadow ? host.attachShadow({ mode: 'open' }) : host;
    var st = document.createElement('style');
    st.className = 'hrs-tokens';
    st.textContent = tokenCss(id);
    root.appendChild(st);
    var ui = document.createElement('div');
    ui.id = id;
    ui.__hrsHost = host;
    root.appendChild(ui);
    (document.documentElement || document.body).appendChild(host);
    return ui;
  }
  /** 浮层所在的样式根：隔离层或者页面 */
  function styleRoot(el) {
    var r = el && el.getRootNode ? el.getRootNode() : document;
    return r && r.nodeType === 11 ? r : (document.head || document.documentElement);
  }
  function css(el) {
    var root = styleRoot(el);
    if (root.querySelector ? root.querySelector('#' + CSS_ID) : document.getElementById(CSS_ID)) return;
    var s = document.createElement('style');
    s.id = CSS_ID;
    s.textContent =
      '.hrs-rz{position:absolute;z-index:5;background:transparent;}' +
      '.hrs-rz.n{top:0;left:10px;right:10px;height:6px;cursor:ns-resize;}.hrs-rz.s{bottom:0;left:10px;right:10px;height:6px;cursor:ns-resize;}' +
      '.hrs-rz.e{right:0;top:10px;bottom:10px;width:6px;cursor:ew-resize;}.hrs-rz.w{left:0;top:10px;bottom:10px;width:6px;cursor:ew-resize;}' +
      '.hrs-rz.nw{left:0;top:0;width:12px;height:12px;cursor:nwse-resize;}.hrs-rz.se{right:0;bottom:0;width:14px;height:14px;cursor:nwse-resize;}' +
      '.hrs-rz.ne{right:0;top:0;width:12px;height:12px;cursor:nesw-resize;}.hrs-rz.sw{left:0;bottom:0;width:12px;height:12px;cursor:nesw-resize;}' +
      '.hrs-rz.se::after{content:"";position:absolute;right:3px;bottom:3px;width:7px;height:7px;border-right:2px solid var(--field);border-bottom:2px solid var(--field);}' +
      '.hrs-split{height:8px;cursor:ns-resize;position:relative;background:var(--surface);}' +
      '.hrs-split::after{content:"";position:absolute;left:50%;top:3px;width:36px;height:2px;margin-left:-18px;border-radius:var(--r-xs);background:var(--field);}' +
      '.hrs-split:hover{background:var(--bg);}.hrs-split:hover::after{background:var(--muted);}' +
      '.hrs-dragging,.hrs-dragging *{user-select:none !important;}';
    root.appendChild(s);
  }
  function load(key) { try { return JSON.parse(localStorage.getItem(key) || 'null'); } catch (e) { return null; } }
  function save(key, v) { try { if (v == null) localStorage.removeItem(key); else localStorage.setItem(key, JSON.stringify(v)); } catch (e) {} }
  function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }

  /**
   * o.box：要拉伸的框；o.pos：fixed 定位的那一层（拖左边 / 上边时要跟着挪，默认就是 box）
   * o.head：标题栏；o.body：标题栏下面的内容区（框变矮时它出滚动条）
   * o.key：记大小用；o.posKey：记位置用（和拖动标题栏用的是同一个）
   */
  function resizable(o) {
    css(o.box);
    var box = o.box, pos = o.pos || box, minW = o.minW || 300, minH = o.minH || 160;
    if (getComputedStyle(box).position === 'static') box.style.position = 'relative';
    function apply(w, h) {
      var maxW = window.innerWidth - 8, maxH = window.innerHeight - 8;
      if (w) box.style.width = clamp(w, minW, maxW) + 'px';
      if (h) {
        h = clamp(h, minH, maxH);
        box.style.height = h + 'px';
        box.classList.add('hrs-sized');   // v2.7.0 定了高度：里面的日志区自动填满剩下的空间
        if (o.body) {
          var hh = o.head ? (o.head.offsetHeight || 38) : 0;
          o.body.style.height = Math.max(60, h - hh - 3) + 'px';
          o.body.style.overflow = 'hidden';
        }
      }
    }
    function reset() {
      box.style.width = ''; box.style.height = ''; box.classList.remove('hrs-sized');
      if (o.body) { o.body.style.height = ''; o.body.style.overflow = ''; }
      save(o.key, null);
    }
    var sv = load(o.key);
    if (sv) apply(sv.w, sv.h);
    ['n', 's', 'e', 'w', 'nw', 'ne', 'sw', 'se'].forEach(function (d) {
      var g = document.createElement('div');
      g.className = 'hrs-rz ' + d;
      g.title = '拖动改大小，双击恢复默认';
      box.appendChild(g);
      g.addEventListener('dblclick', function (e) { e.stopPropagation(); reset(); });
      g.addEventListener('mousedown', function (e) {
        if (e.button !== 0) return;
        e.preventDefault(); e.stopPropagation();
        var r = box.getBoundingClientRect(), pr = pos.getBoundingClientRect();
        // 换成 left/top 定位，拖左边、上边时整块跟着挪
        pos.style.left = pr.left + 'px'; pos.style.top = pr.top + 'px'; pos.style.right = 'auto'; pos.style.bottom = 'auto';
        var st = { x: e.clientX, y: e.clientY, w: r.width, h: r.height, l: pr.left, t: pr.top };
        document.documentElement.classList.add('hrs-dragging');
        function mv(ev) {
          var dx = ev.clientX - st.x, dy = ev.clientY - st.y, w = st.w, h = st.h, l = st.l, t = st.t;
          if (d.indexOf('e') >= 0) w = st.w + dx;
          if (d.indexOf('s') >= 0) h = st.h + dy;
          if (d.indexOf('w') >= 0) { w = st.w - dx; if (w < minW) w = minW; l = st.l + (st.w - w); }
          if (d.indexOf('n') >= 0) { h = st.h - dy; if (h < minH) h = minH; t = st.t + (st.h - h); }
          apply(d === 'n' || d === 's' ? 0 : w, d === 'e' || d === 'w' ? 0 : h);
          pos.style.left = Math.max(0, l) + 'px'; pos.style.top = Math.max(0, t) + 'px';
        }
        function up() {
          document.removeEventListener('mousemove', mv, true);
          document.removeEventListener('mouseup', up, true);
          document.documentElement.classList.remove('hrs-dragging');
          var b = box.getBoundingClientRect(), p2 = pos.getBoundingClientRect();
          save(o.key, { w: Math.round(b.width), h: box.style.height ? Math.round(b.height) : 0 });
          if (o.posKey) save(o.posKey, { x: Math.round(p2.left), y: Math.round(p2.top) });
        }
        document.addEventListener('mousemove', mv, true);
        document.addEventListener('mouseup', up, true);
      });
    });
    return { reset: reset };
  }

  /** 在 el（会滚动的一块）下面加一条横线，上下拖改它的高度。o.key 记高度，o.min 最矮 */
  function splitter(el, o) {
    css(el);
    o = o || {};
    var bar = document.createElement('div');
    bar.className = 'hrs-split';
    bar.title = '上下拖动改这一块的高度，双击恢复';
    el.parentNode.insertBefore(bar, el.nextSibling);
    var min = o.min || 50;
    function apply(h) { el.style.maxHeight = h + 'px'; if (o.fixed) el.style.height = h + 'px'; }
    var sv = load(o.key);
    if (sv && sv.h) apply(sv.h);
    bar.addEventListener('dblclick', function () { el.style.maxHeight = ''; el.style.height = ''; save(o.key, null); });
    bar.addEventListener('mousedown', function (e) {
      if (e.button !== 0) return;
      e.preventDefault(); e.stopPropagation();
      var y0 = e.clientY, h0 = el.getBoundingClientRect().height;
      document.documentElement.classList.add('hrs-dragging');
      function mv(ev) { apply(clamp(h0 + ev.clientY - y0, min, window.innerHeight - 80)); }
      function up() {
        document.removeEventListener('mousemove', mv, true);
        document.removeEventListener('mouseup', up, true);
        document.documentElement.classList.remove('hrs-dragging');
        save(o.key, { h: Math.round(el.getBoundingClientRect().height) });
      }
      document.addEventListener('mousemove', mv, true);
      document.addEventListener('mouseup', up, true);
    });
    return bar;
  }
  window.HRSPanel = { mount: mount, resizable: resizable, splitter: splitter, tokenCss: tokenCss, theme: resolvedTheme };
})();
