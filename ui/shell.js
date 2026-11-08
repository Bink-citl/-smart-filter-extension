/* v2.4.0 Smart Filter 工作台外壳（v1.10.0 起）：只管显示和交互方式，不改任何业务逻辑。
   - 左：侧边栏一二级导航。中：主画布（页标题 + 当前页面）。右：抽屉式配置面板（岗位编辑、AI 模型、RPA 连接、导入预览），代替弹窗
   - 提示：轻量提示用 Tooltip 气泡（data-tip），操作结果用顶部轻提示，报错用顶部 Notification
   - 确认：原来的浏览器确认框改成按钮旁边的气泡确认，不弹框
   - 草稿：填到一半关掉页面，下次进来自动恢复
   人才库与分析页面也加载本文件：视图切换、提示和确认方式与工作台一致。 */
(function () {
  'use strict';
  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };
  var store = {
    get: function (k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
    set: function (k, v) { try { localStorage.setItem(k, v); } catch (e) {} },
    del: function (k) { try { localStorage.removeItem(k); } catch (e) {} }
  };
  function el(tag, cls, html) { var e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }

  // =================== 顶部通知 ===================
  var ICON = {
    success: '<svg viewBox="0 0 24 24"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>',
    info: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7.5v.5"/></svg>',
    warn: '<svg viewBox="0 0 24 24"><path d="M12 3.5 21.5 20h-19z"/><path d="M12 10v4.5M12 17.2v.3"/></svg>',
    error: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M9 9l6 6M15 9l-6 6"/></svg>'
  };
  var stack = null;
  function notify(type, text, title) {
    if (!document.body) return;
    if (!stack) { stack = el('div', 'hrs-notify'); stack.setAttribute('role', 'status'); document.body.appendChild(stack); }
    text = String(text || '').replace(/^\[(完成|失败|提示)\]\s*/, '');
    var light = type === 'success' && !title;
    var n = el('div', 'hn hn-' + type + (light ? ' light' : ''));
    n.innerHTML = '<i class="hn-ic">' + ICON[type] + '</i><div class="hn-tx">' + (title ? '<b>' + esc(title) + '</b>' : '') + '<span>' + esc(text) + '</span></div>' + (light ? '' : '<button class="hn-x" type="button" aria-label="关闭">×</button>');
    stack.appendChild(n);
    var gone = function () { n.classList.add('out'); setTimeout(function () { n.remove(); }, 200); };
    var x = $('.hn-x', n); if (x) x.addEventListener('click', gone);
    setTimeout(gone, type === 'error' ? 8000 : type === 'warn' ? 5000 : light ? 2200 : 4000);
    while (stack.children.length > 4) stack.firstChild.remove();
  }
  window.HRSNotify = {
    success: function (t, h) { notify('success', t, h); }, info: function (t, h) { notify('info', t, h); },
    warn: function (t, h) { notify('warn', t, h); }, error: function (t, h) { notify('error', t, h || '出错了'); }
  };
  // 原来底部的提示条（options.js 的 toast）改成顶部通知
  function hookToast() {
    var t = $('#toast');
    if (!t) return;
    var last = '';
    new MutationObserver(function () {
      if (t.style.display === 'none' || !t.textContent) { last = ''; return; }
      var key = t.className + '|' + t.textContent;
      if (key === last) return;
      last = key;
      var err = /\berr\b/.test(t.className) || /^\[失败\]/.test(t.textContent);
      if (err) window.HRSNotify.error(t.textContent); else window.HRSNotify.success(t.textContent);
    }).observe(t, { attributes: true, childList: true, characterData: true, subtree: true });
  }
  // 浏览器的提示框改成顶部通知（不打断操作）
  window.alert = function (msg) {
    var s = String(msg || '');
    if (/失败|错误|不支持|没有可|加载失败|读取数据失败/.test(s)) window.HRSNotify.error(s); else window.HRSNotify.info(s);
  };

  // =================== 气泡确认（代替浏览器确认框） ===================
  var lastAct = null, bypass = false, pop = null;
  // 记下用户刚点的元素和位置：列表点击后常会重画，确认后要找回「同一个」按钮再点一次
  function locate(t) {
    var row = t.closest && t.closest('[data-id]');
    var act = t.closest && t.closest('[data-act],[data-a],[data-m]');
    return { id: t.id || '', row: row ? row.getAttribute('data-id') : '', sel: act ? (act.hasAttribute('data-act') ? '[data-act="' + act.getAttribute('data-act') + '"]' : act.hasAttribute('data-a') ? '[data-a="' + act.getAttribute('data-a') + '"]' : '[data-m="' + act.getAttribute('data-m') + '"]') : '' };
  }
  function record(type, e) {
    if (pop && pop.contains(e.target)) return;
    var r = e.target.getBoundingClientRect ? e.target.getBoundingClientRect() : null;
    lastAct = { type: type, target: e.target, checked: e.target.checked, value: e.target.value, rect: r && r.width ? { left: r.left, right: r.right, top: r.top, bottom: r.bottom } : null, loc: locate(e.target) };
  }
  function findAgain(a) {
    if (a.target && a.target.isConnected) return a.target;
    var l = a.loc || {};
    if (l.id && document.getElementById(l.id)) return document.getElementById(l.id);
    if (l.row && l.sel) { var x = document.querySelector('[data-id="' + l.row + '"] ' + l.sel); if (x) return x; }
    return null;
  }
  document.addEventListener('click', function (e) { record('click', e); }, true);
  document.addEventListener('change', function (e) { record('change', e); }, true);
  function closePop() { if (pop) { pop.remove(); pop = null; } }
  window.confirm = function (msg) {
    if (bypass) { bypass = false; return true; }
    var act = lastAct;
    closePop();
    var anchor = act ? findAgain(act) : null;
    pop = el('div', 'hrs-pop');
    pop.innerHTML = '<div class="hp-tx"><i>' + ICON.warn + '</i><span>' + esc(msg).replace(/\n/g, '<br>') + '</span></div><div class="hp-bt"><button type="button" class="btn ghost sm" data-no>取消</button><button type="button" class="btn sm" data-yes>确定</button></div>';
    document.body.appendChild(pop);
    var ar = anchor && anchor.getBoundingClientRect();
    var r = ar && ar.width ? ar : (act && act.rect) || { left: innerWidth / 2 - 160, right: innerWidth / 2 + 160, top: 120, bottom: 120 };
    var w = pop.offsetWidth, h = pop.offsetHeight;
    var left = Math.max(12, Math.min(innerWidth - w - 12, r.left + (r.right - r.left) / 2 - w / 2));
    var below = r.bottom + 8 + h < innerHeight;
    pop.style.left = left + 'px';
    pop.style.top = (below ? r.bottom + 8 : Math.max(12, r.top - h - 8)) + 'px';
    pop.classList.add(below ? 'down' : 'up');
    $('[data-yes]', pop).focus();
    $('[data-no]', pop).addEventListener('click', closePop);
    $('[data-yes]', pop).addEventListener('click', function () {
      closePop();
      var t = act ? findAgain(act) : null;
      if (!t) return;
      bypass = true;
      if (act.type === 'change') {
        if (t.type === 'checkbox' || t.type === 'radio') t.checked = act.checked; else t.value = act.value;
        t.dispatchEvent(new Event('change', { bubbles: true }));
      } else t.click();
      setTimeout(function () { bypass = false; }, 0);
    });
    return false;
  };
  document.addEventListener('mousedown', function (e) { if (pop && !pop.contains(e.target)) closePop(); }, true);
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape') closePop(); });

  // =================== Tooltip 气泡（data-tip） ===================
  var tip = null;
  document.addEventListener('mouseover', function (e) {
    var t = e.target.closest && e.target.closest('[data-tip]');
    if (!t) { if (tip) tip.hidden = true; return; }
    if (!tip) { tip = el('div', 'hrs-tip'); document.body.appendChild(tip); }
    tip.textContent = t.getAttribute('data-tip');
    tip.hidden = false;
    var r = t.getBoundingClientRect(), w = tip.offsetWidth, h = tip.offsetHeight;
    var below = r.top - h - 8 < 4;
    tip.style.left = Math.max(8, Math.min(innerWidth - w - 8, r.left + r.width / 2 - w / 2)) + 'px';
    tip.style.top = (below ? r.bottom + 8 : r.top - h - 8) + 'px';
    tip.className = 'hrs-tip ' + (below ? 'down' : 'up');
  });

  // =================== 长说明条：默认一行 ===================
  function clampNotes() {
    $$('.note').forEach(function (n) {
      if (n.dataset.clamp || n.id) return;
      n.dataset.clamp = '1';
      n.classList.add('clamp');
      n.addEventListener('click', function (e) {
        if (e.target.closest('a,button,input,select,textarea')) return;
        var open = n.classList.toggle('open');
        n.classList.toggle('clamp', !open);
      });
    });
  }

  // =================== 工作台（设置页） ===================
  var PAGE = {
    'jd:list': '在招岗位的筛选条件。点一个岗位，在右侧抽屉里编辑',
    'jd:ai': '从平台抓职位，生成 AI 提示词表，再把 AI 返回的条件导入',
    'pub:': '准备好职位内容，到平台的发布页一键填表',
    'run:plan': '今天 Boss / 猎聘「沟通」里要筛选的岗位和每日上限',
    'run:act': '判定合格或不合格之后做什么',
    'greet:plan': '推荐牛人页按岗位计划打招呼的开关、推荐页职位名和上限',
    'greet:set': '打招呼语和每日总上限',
    'inbox:': '候选人发来的 PDF 简历按岗位汇总，自动命名，一键保存到本地或回到对话',
    'sched:': '把打招呼和智选按顺序串起来，每天到点自动跑',
    'talent:pool': '智选和打招呼判过的候选人，点「详情」在右侧抽屉查看',
    'talent:parse': '上传简历文件，本地解析并和岗位匹配',
    'talent:today': '今天智选和打招呼的扫 / 过 / 拒',
    'talent:analysis': '得分、学历、来源、经验分布和匹配度看板',
    'scripts:': '自动发送和浮层固定按钮用到的话术',
    'rec:': '每天把邮箱里的未读简历分发到 团队消息群（由 示例工作台执行）',
    'debug:': '运行记录、RPA 连接、操作节奏、备份恢复、识别规则与诊断'
  };
  var HRSShell = window.HRSShell = {};
  function initOptions() {
    var nav = $('#hrsNav');
    var crumb = $('#hrsCrumb');
    if (!nav || !crumb) return;
    var items = $$('.hrs-side .tab');
    var cur = null, back = null, sub = '';
    var keyOf = function (it) { return it.dataset.t + ':' + (it.dataset.s || it.dataset.v || ''); };
    var groupOf = function (it) { return it.closest('.nav-g'); };
    var labelOf = function (e) { var sp = e && e.querySelector('span'); return (sp || e).textContent.trim(); };
    // 页标题
    var wrap = $('.wrap');
    var phead = el('div', 'phead', '<div><h1></h1><p></p></div>');
    wrap.insertBefore(phead, wrap.firstChild);

    function setView(t, v) {
      var panel = document.getElementById('p-' + t);
      if (!panel || !v) return;
      $$(':scope > [data-v]', panel).forEach(function (x) { x.classList.toggle('v-hide', x.dataset.v !== v); });
      panel.dataset.view = v;
      if (t === 'talent') {
        var f = $('#talentFrame');
        if (!f) return;
        var url = f.getAttribute('data-src') + '#view=' + v;
        if (f.getAttribute('src') !== url) f.setAttribute('src', url);   // 只差 # 后面时不会重新加载
      }
    }
    function openGroup(g) { $$('.nav-g', nav).forEach(function (x) { x.classList.toggle('open', x === g); }); }
    function render() {
      $$('.hrs-side .tab').forEach(function (x) { x.classList.toggle('cur', x === cur); });
      $$('.nav-g', nav).forEach(function (g) { g.classList.toggle('has-cur', !!(cur && g.contains(cur))); });
      var parts = ['Smart Filter'];
      var g = cur && groupOf(cur);
      if (g) parts.push(labelOf($('.nav-gh', g)));
      parts.push(cur ? labelOf(cur) : '设置');
      if (cur && cur.dataset.t === 'debug' && sub) parts.push(sub);   // v2.4.0 设置页：面包屑带上当前设置项
      crumb.innerHTML = '';
      parts.forEach(function (p, i) {
        if (i) { var s = document.createElement('i'); s.textContent = '/'; crumb.appendChild(s); }
        var e = document.createElement(i === parts.length - 1 ? 'b' : 'span');
        if (i && i < parts.length - 1) e.className = 'mid';
        e.textContent = p;
        crumb.appendChild(e);
      });
      document.title = parts[parts.length - 1] + ' · Smart Filter 工作台';
      $('h1', phead).textContent = parts[parts.length - 1];
      $('p', phead).textContent = cur ? (PAGE[keyOf(cur)] || '') : '';
      document.body.setAttribute('data-page', cur ? keyOf(cur).replace(':', '-').replace(/-$/, '') : '');
    }
    function activate(it) {
      if (!it) return;
      var settings = it.dataset.t === 'debug';
      if (settings && cur && cur.dataset.t !== 'debug') back = cur;
      cur = it;
      document.body.classList.toggle('mode-settings', settings);
      if (it.dataset.s) {
        var st = $('.stab[data-s="' + it.dataset.s + '"]');
        if (st && !st.classList.contains('on')) st.click();
      }
      if (it.dataset.v) setView(it.dataset.t, it.dataset.v);
      if (!settings) openGroup(groupOf(it));
      if (!settings) store.set('hrsNavLast', keyOf(it));
      render();
      window.scrollTo(0, 0);
    }
    items.forEach(function (it) { it.addEventListener('click', function () { activate(it); }); });
    $$('.nav-gh', nav).forEach(function (h) {
      h.addEventListener('click', function () {
        var g = h.parentElement;
        if (cur && g.contains(cur)) { g.classList.toggle('open'); return; }
        var first = $('.nav-l2 .tab', g);
        if (first) first.click();
      });
    });
    HRSShell.setSub = function (s) { sub = s || ''; if (cur && cur.dataset.t === 'debug') render(); };
    var backBtn = $('#hrsBack');
    if (backBtn) backBtn.addEventListener('click', function () { (back || items[0]).click(); });
    function sync() {
      var panel = $('.wrap > .panel.on');
      if (!panel) return;
      var t = panel.id.replace(/^p-/, '');
      if (cur && cur.dataset.t === t) {
        if (t !== 'jd') return;
        var on = $('.stab.on');
        if (!on || cur.dataset.s === on.dataset.s) return;
      }
      var pick = null;
      if (t === 'jd') { var s = $('.stab.on'); pick = s && $('.hrs-side .tab[data-t="jd"][data-s="' + s.dataset.s + '"]'); }
      else if (panel.dataset.view) pick = $('.hrs-side .tab[data-t="' + t + '"][data-v="' + panel.dataset.view + '"]');
      pick = pick || $('.hrs-side .tab[data-t="' + t + '"]');
      if (pick && pick !== cur) activate(pick);
    }
    var mo = new MutationObserver(function () { setTimeout(sync, 0); });
    $$('.wrap > .panel, .stab').forEach(function (x) { mo.observe(x, { attributes: true, attributeFilter: ['class'] }); });

    initDrawers();
    initRpaPill();
    initDrafts();
    initSideFold();
    initThemeBtn();
    var last = store.get('hrsNavLast');
    var start = items.filter(function (it) { return keyOf(it) === last; })[0] || items[0];
    start.click();
  }

  // =================== v2.9.0 侧边栏收起 / 展开 ===================
  // 右上角的圆按钮：收起后只留图标和简称（88px），内容区变宽。记住选择；没选过时窗口窄于 960 自动收起
  function initSideFold() {
    var side = $('.hrs-side'), brand = $('.hrs-brand');
    if (!side || !brand || $('#hrsSideFold')) return;
    // v2.9.1 按钮图标是一颗芯片：展开时芯片中间是空的，收起后芯片中间亮起
    var b = el('button', 'hrs-sidefold', '<svg viewBox="0 0 24 24"><rect x="6.5" y="6.5" width="11" height="11" rx="1.6"/><rect class="core" x="9.5" y="9.5" width="5" height="5" rx=".8"/><path d="M9.5 6.5V3.5M14.5 6.5V3.5M9.5 20.5v-3M14.5 20.5v-3M6.5 9.5h-3M6.5 14.5h-3M20.5 9.5h-3M20.5 14.5h-3"/></svg>');
    // 收起后图标下面显示的简称
    var SHORT = { jobs: '岗位', pub: '发布', run: '智选', greet: '招呼', inbox: '简历', sched: '计划', pool: '人才', stats: '统计', scripts: '话术', rec: '分发', debug: '设置' };
    $$('.hrs-side .nav-l1').forEach(function (n) {
      var g = n.closest('.nav-g');
      var k = n.classList.contains('nav-gh') && g ? g.getAttribute('data-g') : n.getAttribute('data-t');
      if (SHORT[k]) n.setAttribute('data-short', SHORT[k]);
    });
    b.id = 'hrsSideFold'; b.type = 'button';
    brand.appendChild(b);
    function want() {
      var v = store.get('hrsSideMini');
      return v === '1' || (v !== '0' && window.innerWidth < 960);
    }
    function paint() {
      var mini = want();
      document.body.classList.toggle('side-mini', mini);
      b.setAttribute('aria-label', mini ? '展开侧边栏' : '收起侧边栏');
      b.setAttribute('data-tip', mini ? '展开侧边栏' : '收起侧边栏，内容区变宽');
      b.setAttribute('aria-expanded', mini ? 'false' : 'true');
    }
    b.addEventListener('click', function (e) {
      e.stopPropagation();
      store.set('hrsSideMini', document.body.classList.contains('side-mini') ? '0' : '1');
      paint();
      setTimeout(function () { window.dispatchEvent(new Event('resize')); }, 260);   // 图表等按新宽度重排
    });
    window.addEventListener('resize', function () { if (store.get('hrsSideMini') == null) paint(); });
    paint();
    HRSShell.sideMini = function (on) { store.set('hrsSideMini', on ? '1' : '0'); paint(); };
  }

  // =================== v2.9.0 顶栏：浅色 / 深色 / 跟随系统 ===================
  var THEME_ICON = {
    system: '<svg viewBox="0 0 24 24"><rect x="3.5" y="4.5" width="17" height="12" rx="1.5"/><path d="M9 20h6M12 16.5V20"/></svg>',
    light: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="4"/><path d="M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6l1.4 1.4M17 17l1.4 1.4M5.6 18.4 7 17M17 7l1.4-1.4"/></svg>',
    dark: '<svg viewBox="0 0 24 24"><path d="M19.5 14.5A8 8 0 0 1 9.5 4.5a8 8 0 1 0 10 10z"/></svg>'
  };
  var THEME_NAME = { system: '跟随系统', light: '浅色', dark: '深色' };
  function initThemeBtn() {
    var right = $('.hrs-top .right');
    if (!right || !window.HRSTheme || $('#hrsThemeBtn')) return;
    var b = el('button', 'hrs-themebtn');
    b.id = 'hrsThemeBtn'; b.type = 'button';
    right.insertBefore(b, right.firstChild);
    var ORDER = ['system', 'light', 'dark'];
    function paint() {
      var m = HRSTheme.get();
      b.innerHTML = THEME_ICON[m];
      b.setAttribute('aria-label', '外观：' + THEME_NAME[m]);
      b.setAttribute('data-tip', '外观：' + THEME_NAME[m] + '（点一下切换，设置 → 外观里也能改）');
    }
    b.addEventListener('click', function () {
      var m = ORDER[(ORDER.indexOf(HRSTheme.get()) + 1) % 3];
      HRSTheme.set(m);
      notify('info', '外观已切到「' + THEME_NAME[m] + '」' + (m === 'system' ? '，现在是' + (HRSTheme.resolved() === 'dark' ? '深色' : '浅色') : ''));
    });
    document.addEventListener('hrs-theme-mode', paint);
    paint();
  }

  // =================== 右侧抽屉 ===================
  function initDrawers() {
    // 岗位编辑：从岗位列表里拿出来，放进全局抽屉，任何页面都能打开
    var col = $('.editcol');
    if (col) {
      var jd = el('aside', 'hrs-drawer job-drawer');
      jd.id = 'jobDrawer';
      document.body.appendChild(jd);
      jd.appendChild(col);
      var open = function () { if ($('#jobEditor') && $('#jobEditor').style.display === 'none') return; document.body.classList.add('drawer-open'); jd.classList.add('open'); };
      HRSShell.openJob = function (id) {
        if (id) { var row = $('#jobTable .jrow[data-id="' + (window.CSS && CSS.escape ? CSS.escape(id) : id) + '"]'); if (row) row.click(); }
        setTimeout(open, 30);
      };
      HRSShell.closeJob = function () { jd.classList.remove('open'); if (!$('.hrs-drawer.open')) document.body.classList.remove('drawer-open'); };
      document.addEventListener('click', function (e) {
        var row = e.target.closest && e.target.closest('#jobTable .jrow[data-id]');
        if (row && !e.target.closest('.jact a.del')) setTimeout(open, 30);
        if (e.target.closest && e.target.closest('#btnNewJd,#btnDupJd')) setTimeout(open, 60);
      }, true);   // 捕获阶段：列表点击后会重画，冒泡时元素已不在列表里
    }
    // 通用配置抽屉：把页面上的某张卡片暂时放进来，关掉时放回原处（元素和事件都不变）
    var cfg = $('#cfgDrawer'), body = $('#cfgBody'), home = null, moved = null;
    if (cfg) cfg.classList.add('hrs-drawer');
    HRSShell.openCfg = function (cardId, title) {
      var card = document.getElementById(cardId);
      if (!card || !cfg) return;
      HRSShell.closeCfg();
      home = document.createComment('hrs-home'); card.parentNode.insertBefore(home, card);
      body.appendChild(card); moved = card;
      $('#cfgTitle').textContent = title || '配置';
      cfg.classList.add('open'); cfg.setAttribute('aria-hidden', 'false');
      document.body.classList.add('drawer-open');
    };
    HRSShell.closeCfg = function () {
      if (moved && home) { home.parentNode.insertBefore(moved, home); home.remove(); }
      moved = null; home = null;
      if (cfg) { cfg.classList.remove('open'); cfg.setAttribute('aria-hidden', 'true'); }
      if (!$('.hrs-drawer.open')) document.body.classList.remove('drawer-open');
    };
    document.addEventListener('click', function (e) {
      var x = e.target.closest && e.target.closest('[data-drawer-close]');
      if (!x) return;
      if (x.dataset.drawerClose === 'job') HRSShell.closeJob(); else HRSShell.closeCfg();
    });
    document.addEventListener('keydown', function (e) {
      if (e.key !== 'Escape' || pop) return;
      if (cfg && cfg.classList.contains('open')) HRSShell.closeCfg();
      else if (HRSShell.closeJob) HRSShell.closeJob();
    });
    // 导入预览也按抽屉显示（options.js 照旧控制显示和隐藏）
    var ic = $('#importCard');
    if (ic) ic.classList.add('as-drawer');
  }

  // =================== 顶栏：RPA 状态 ===================
  function initRpaPill() {
    var pill = $('#hrsRpaPill');
    if (!pill || !window.chrome || !chrome.runtime) return;
    var txt = $('span', pill);
    function paint() {
      chrome.storage.local.get('settings', function (o) {
        var s = o.settings || {};
        if (s.bossExec === 'script') { pill.className = 'rpa-pill off'; txt.textContent = 'Boss 脚本点击'; return; }
        chrome.runtime.sendMessage({ type: 'RPA_PING' }, function (r) {
          void chrome.runtime.lastError;
          var ok = r && r.ok;
          pill.className = 'rpa-pill ' + (ok ? 'ok' : 'bad');
          txt.textContent = ok ? 'RPA 已连接' : 'RPA 未连接';
          pill.setAttribute('data-tip', ok ? '本机 RPA 助手 v' + r.version + ' 已连接，Boss 打招呼和智选用真实鼠标键盘执行' : '连不上本机 RPA 助手：' + ((r && r.why) || '插件后台没回应') + '。点击查看连接设置');
        });
      });
    }
    // v2.4.0 已经在设置页时直接切到「RPA 连接」，其他页面照旧用右侧抽屉，不离开当前页
    pill.addEventListener('click', function () {
      if (document.body.classList.contains('mode-settings') && window.HRSSettings) HRSSettings.go('rpa');
      else HRSShell.openCfg('cardRpa', 'RPA 连接');
    });
    paint(); setInterval(paint, 20000);
  }

  // =================== 草稿：填到一半关掉页面，下次进来还在 ===================
  // 发布职位整张表单在点「去平台发布」前一直保留草稿；其余字段原本在失焦 / 改动时保存，这里只兜住「还没失焦就关了页面」的情况
  var DK = 'hrsFormDraft';
  function initDrafts() {
    var sel = '#p-pub input,#p-pub select,#p-pub textarea,#sc_reject,#sc_request,#sc_contact,#sc_follow,#sc_interview,#sc_questions,#greetMsgDefault,#company';
    var data = {};
    try { data = JSON.parse(store.get(DK) || '{}') || {}; } catch (e) { data = {}; }
    var put = function () { if (Object.keys(data).length) store.set(DK, JSON.stringify(data)); else store.del(DK); };
    var valOf = function (x) { return x.type === 'checkbox' ? x.checked : x.value; };
    var restoring = false;
    document.addEventListener('input', function (e) {
      if (restoring || !e.target.id || !e.target.matches(sel)) return;
      data[e.target.id] = { v: valOf(e.target), at: Date.now() }; put();
    });
    document.addEventListener('change', function (e) {
      if (restoring || !e.target.id || !e.target.matches(sel)) return;
      if (e.target.closest('#p-pub')) { data[e.target.id] = { v: valOf(e.target), at: Date.now() }; }
      else delete data[e.target.id];   // 已经保存了
      put();
    });
    document.addEventListener('click', function (e) {
      if (e.target.closest && e.target.closest('#pb_go')) { $$('#p-pub [id]').forEach(function (x) { delete data[x.id]; }); put(); }
    });
    var keys = Object.keys(data).filter(function (k) { return document.getElementById(k); });
    if (!keys.length) return;
    // 等页面把已保存的设置填好，再把没保存的草稿盖上去
    setTimeout(function () {
      restoring = true;
      var n = 0;
      var setOne = function (k) {
        var x = document.getElementById(k), v = data[k].v;
        if (!x || valOf(x) === v) return;
        if (x.type === 'checkbox') x.checked = !!v; else x.value = v;
        n++;
        if (!x.closest('#p-pub')) x.dispatchEvent(new Event('change', { bubbles: true }));
      };
      if (data.pb_jd) { setOne('pb_jd'); var pj = document.getElementById('pb_jd'); if (pj) pj.dispatchEvent(new Event('change', { bubbles: true })); }
      setTimeout(function () {
        keys.filter(function (k) { return k !== 'pb_jd'; }).forEach(setOne);
        restoring = false;
        if (n) window.HRSNotify.info('上次没保存的 ' + n + ' 处内容已恢复', '草稿');
        // 不在发布页的字段恢复后已经触发保存，草稿里删掉
        keys.forEach(function (k) { var x = document.getElementById(k); if (x && !x.closest('#p-pub')) delete data[k]; });
        put();
      }, 400);
    }, 1500);
  }

  // =================== 人才库与分析 ===================
  function initDashboard() {
    if (!document.body.classList.contains('hrs-dash')) return;
    try { if (window.top !== window) document.documentElement.classList.add('hrs-embedded'); } catch (e) { document.documentElement.classList.add('hrs-embedded'); }
    var bar = $('#dtabs');
    if (!bar) return;
    var VIEWS = ['pool', 'parse', 'today', 'analysis'];
    function resizeCharts(root) {
      if (!window.echarts) return;
      $$('.chart', root).forEach(function (x) { var c = echarts.getInstanceByDom(x); if (c) c.resize(); });
    }
    function show(k) {
      if (VIEWS.indexOf(k) < 0) k = 'pool';
      document.body.setAttribute('data-view', k);
      $$('span', bar).forEach(function (s) { s.classList.toggle('on', s.dataset.dp === k); });
      $$('.dpanel').forEach(function (p) { p.classList.toggle('on', p.dataset.dp === k); });
      setTimeout(function () { $$('.dpanel.on').forEach(resizeCharts); }, 0);
    }
    function fromHash() {
      var m = location.hash.match(/view=([a-z]+)/);
      if (m) return m[1];
      return /today=/.test(location.hash) ? 'today' : 'pool';
    }
    $$('span', bar).forEach(function (s) { s.addEventListener('click', function () { show(s.dataset.dp); }); });
    $$('.stats .stat').forEach(function (s) { s.addEventListener('click', function () { show('pool'); }); });
    var cloud = $('#tagCloud');
    if (cloud) cloud.addEventListener('click', function (e) { if (e.target.closest('button')) show('pool'); });
    window.addEventListener('resize', function () { $$('.dpanel.on').forEach(resizeCharts); });
    window.addEventListener('hashchange', function () { show(fromHash()); });
    show(fromHash());
    // 候选人详情抽屉：加标题栏的关闭按钮样式、Esc 关闭
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && !pop) { var d = $('#drawer'); if (d) d.classList.remove('open'); } });
  }

  function init() { hookToast(); clampNotes(); initOptions(); initDashboard(); }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
