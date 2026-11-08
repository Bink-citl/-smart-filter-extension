/**
 * job-publish.js v1.9.1：在 Boss / 猎聘「发布职位」表单页，按设置页「发布职位」里准备好的内容自动填表。
 * 只填，不发布：最后的「发布」按钮由人点。下拉框按文字找选项，填不上的列出来让人手动补。
 */
(function () {
  'use strict';
  // v1.9.48 发布职位（只填表不发布）不在这次 RPA 改造范围内：用 HRSDom.script，行为和 v1.9.47 一样
  var D = window.HRSDom && window.HRSDom.script ? window.HRSDom.script : window.HRSDom;
  if (!D || window.__hrsPublishLoaded) return;
  window.__hrsPublishLoaded = true;
  var SITE = /zhipin\.com/.test(location.hostname) ? 'boss' : (/liepin\.com/.test(location.hostname) ? 'liepin' : '');
  if (!SITE) return;

  function alive() { try { return !!(chrome.runtime && chrome.runtime.id); } catch (e) { return false; } }
  function inputsBy(re) {
    return D.qsa('input,textarea').filter(function (el) { return D.visible(el) && re.test(el.getAttribute('placeholder') || ''); });
  }
  // v1.9.8 职位名称输入框：先按占位文字找；猎聘的占位文字不一定带「职位名称」，再按左边/上面的标签「职位名称」找最近的输入框
  function nameInput() {
    var a = inputsBy(/职位名称|职位名|岗位名称/)[0];
    if (a) return a;
    var lab = D.qsa('label,span,div,p').filter(function (el) {
      return D.visible(el) && !el.closest('#__hrs_pub__') && el.children.length <= 2 && /^[*＊\s]*(职位名称|岗位名称)[:：]?$/.test(D.textOf(el).replace(/\s+/g, ''));
    })[0];
    if (!lab) return null;
    var lr = D.rectOf(lab);
    return D.qsa('input').filter(function (el) {
      if (!D.visible(el) || /^(checkbox|radio|hidden|file)$/i.test(el.type || '')) return false;
      var r = D.rectOf(el);
      return (Math.abs(r.top + r.height / 2 - (lr.top + lr.height / 2)) < 24 && r.left >= lr.left) || (r.top >= lr.bottom - 4 && r.top - lr.bottom < 70);
    }).sort(function (x, y) { var rx = D.rectOf(x), ry = D.rectOf(y); return (Math.abs(rx.top - lr.top) + Math.abs(rx.left - lr.right)) - (Math.abs(ry.top - lr.top) + Math.abs(ry.left - lr.right)); })[0] || null;
  }
  // Boss 的表单在内嵌页面里，页面标题「发布职位」在外层，所以不靠标题：有「职位名称」输入框 + 「职位描述」字样就算
  function isForm() {
    if (!nameInput()) return false;
    var t = document.body ? (document.body.innerText || '').slice(0, 8000) : '';
    return /职位描述|职位详情|职位基本信息|职位要求|岗位职责|任职要求/.test(t);
  }
  // v1.9.8 看起来是发布页但认不出表单：出一个小框，可复制页面控件信息提交到 GitHub Issue（先脱敏）
  function looksPublish() {
    var t = document.body ? (document.body.innerText || '').slice(0, 3000) : '';
    return /(publish|post|create|add|edit|fabu)/i.test(location.pathname + location.hash) || /发布职位|发布新职位|编辑职位/.test(t);
  }
  function diag() {
    var ins = D.qsa('input,textarea,[contenteditable="true"]').filter(D.visible).slice(0, 40).map(function (el) {
      var r = D.rectOf(el);
      var near = D.qsa('label,span,div').filter(function (x) { var rr = D.rectOf(x); return x.children.length <= 1 && D.visible(x) && D.textOf(x).length <= 12 && Math.abs(rr.top - r.top) < 24 && rr.right <= r.left + 4 && r.left - rr.right < 200; }).map(D.textOf).slice(-1)[0] || '';
      return { tag: el.tagName.toLowerCase(), type: el.type || '', ph: el.getAttribute('placeholder') || '', cls: String(el.className || '').slice(0, 80), label: near, rect: [Math.round(r.left), Math.round(r.top), Math.round(r.width), Math.round(r.height)] };
    });
    return JSON.stringify({ at: new Date().toISOString(), url: location.href, isTop: window === window.top, title: document.title, inputs: ins }, null, 1);
  }
  var hint = null;
  function showHint() {
    if (window !== window.top && !D.qsa('input,textarea').filter(D.visible).length) return;
    if (!hint) {
      hint = document.createElement('div');
      hint.id = '__hrs_pub_hint__';
      hint.style.cssText = 'position:fixed;right:16px;bottom:80px;z-index:2147483647;width:280px;background:#fff;border:1px solid #f59e0b;border-radius:10px;box-shadow:0 8px 24px rgba(0,0,0,.18);font:12px/1.6 "Microsoft YaHei",sans-serif;color:#1f2937;padding:8px 10px;';
      hint.innerHTML = '<b>Smart Filter · 发布职位</b><div style="color:#b45309;margin:4px 0;">这一页没认出发布表单（找不到「职位名称」输入框）。</div><button data-a="copy" style="width:100%;background:#f59e0b;color:#fff;border:none;border-radius:6px;padding:5px;cursor:pointer;">复制控件信息</button><a data-a="x" style="display:block;text-align:right;color:#94a3b8;cursor:pointer;margin-top:4px;">收起</a>';
      hint.addEventListener('click', function (e) {
        var a = e.target.getAttribute('data-a');
        if (a === 'copy') { var txt = diag(); (navigator.clipboard ? navigator.clipboard.writeText(txt) : Promise.reject()).then(function () { e.target.textContent = '已复制，粘贴提交到 GitHub Issue（先脱敏）'; }, function () { prompt('复制下面的内容', txt); }); }
        if (a === 'x') { hint.style.display = 'none'; hint.dataset.closed = '1'; }
      });
      document.documentElement.appendChild(hint);
    }
    if (!hint.dataset.closed) hint.style.display = '';
  }
  function setValue(el, v) {
    el.focus();
    var proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    try { Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, v); } catch (e) { el.value = v; }
    ['input', 'change', 'blur'].forEach(function (t) { el.dispatchEvent(new Event(t, { bubbles: true })); });
  }
  function descBox() {
    var ta = D.qsa('textarea').filter(D.visible).sort(function (a, b) { return D.rectOf(b).height - D.rectOf(a).height; })[0];
    if (ta) return ta;
    return D.qsa('[contenteditable="true"]').filter(D.visible).sort(function (a, b) { return D.rectOf(b).height - D.rectOf(a).height; })[0] || null;
  }
  // 自定义下拉：点占位文字 → 在弹出的列表里按文字点选项
  function pick(triggerRe, options) {
    var trig = D.qsa('input,div,span').filter(function (el) {
      if (!D.visible(el) || el.closest('#__hrs_pub__')) return false;
      var ph = el.getAttribute && el.getAttribute('placeholder');
      var t = ph || (el.children.length === 0 ? D.textOf(el) : '');
      return t && triggerRe.test(t) && t.length < 20;
    })[0];
    if (!trig) return Promise.resolve(false);
    return D.click(trig).then(function () { return D.sleep(D.rand(600, 900)); }).then(function () {
      var tr = D.rectOf(trig);
      var opt = null;
      for (var i = 0; i < options.length && !opt; i++) {
        var want = options[i];
        opt = D.qsa('li,div,span,a').filter(function (el) {
          if (el === trig || el.contains(trig) || !D.visible(el) || el.children.length > 1) return false;
          return D.textOf(el).replace(/\s+/g, '') === want && D.rectOf(el).top > tr.top - 300;
        })[0] || null;
      }
      if (!opt) { D.pressEscape(); return false; }
      return D.click(opt).then(function () { return D.sleep(D.rand(400, 700)); }).then(function () { return true; });
    });
  }
  function kList(n) { return [n + 'k', n + 'K', n + '千', String(n)]; }

  function fill(p, city) {
    var res = [];
    var name = nameInput();
    if (name) { setValue(name, p.title); res.push(['职位名称', true]); } else res.push(['职位名称', false]);
    var d = descBox();
    if (d && p.desc) {
      if (d.tagName === 'TEXTAREA') setValue(d, p.desc);
      else { d.focus(); d.innerText = p.desc; d.dispatchEvent(new Event('input', { bubbles: true })); }
      res.push(['职位描述', true]);
    } else res.push(['职位描述', false]);
    var chain = Promise.resolve();
    if (p.exp) chain = chain.then(function () { return pick(/经验要求|工作经验/, [p.exp]).then(function (ok) { res.push(['经验 ' + p.exp, ok]); }); });
    if (p.edu) chain = chain.then(function () { return pick(/最低学历|学历要求/, [p.edu, p.edu + '及以上']).then(function (ok) { res.push(['学历 ' + p.edu, ok]); }); });
    chain = chain.then(function () { return pick(/最低月薪/, kList(p.salary.min)).then(function (ok) { res.push(['最低月薪 ' + p.salary.min + 'k', ok]); }); })
      .then(function () { return pick(/最高月薪/, kList(p.salary.max)).then(function (ok) { res.push(['最高月薪 ' + p.salary.max + 'k', ok]); }); })
      .then(function () { return pick(/^\d{2}个月$|薪资月数|月薪数/, [p.salary.months + '个月', p.salary.months + '薪']).then(function (ok) { res.push([p.salary.months + ' 薪', ok]); }); });
    return chain.then(function () { return res; });
  }

  var box = null;
  function showBox(p) {
    if (!box) {
      box = document.createElement('div');
      box.id = '__hrs_pub__';
      box.style.cssText = 'position:fixed;right:16px;bottom:80px;z-index:2147483647;width:300px;background:#fff;border:1px solid #cbd5e1;border-radius:10px;box-shadow:0 8px 24px rgba(0,0,0,.18);font:12px/1.6 "Microsoft YaHei",sans-serif;color:#1f2937;';
      document.documentElement.appendChild(box);
      box.addEventListener('click', function (e) {
        var a = e.target.getAttribute('data-a');
        if (a === 'fill') {
          var city = (box.querySelector('select') || {}).value || '';
          e.target.disabled = true; e.target.textContent = '填写中…';
          fill(p, city).then(function (res) {
            var bad = res.filter(function (r) { return !r[1]; });
            box.querySelector('.rs').innerHTML = res.map(function (r) { return '<div style="color:' + (r[1] ? '#15803d' : '#dc2626') + '">' + (r[1] ? '✓ ' : '✗ ') + r[0] + (r[1] ? '' : '（请手动选）') + '</div>'; }).join('') +
              '<div style="margin-top:6px;color:#b45309;">还需手动：' + (SITE === 'boss' ? '职位类型、工作地址（' + city + '）、关键词' : '职位类别、工作地址（' + city + '）、行业要求') + (bad.length ? '，以及上面打 ✗ 的项' : '') + '。核对无误后自己点「发布」。</div>';
            e.target.disabled = false; e.target.textContent = '重新填一次';
          });
        }
        if (a === 'x') box.style.display = 'none';
      });
    }
    box.style.display = '';
    box.innerHTML = '<div style="padding:8px 10px;border-bottom:1px solid #e5e7eb;display:flex;align-items:center;"><b>Smart Filter · 发布职位</b><a data-a="x" style="margin-left:auto;cursor:pointer;color:#94a3b8;">收起</a></div>' +
      '<div style="padding:8px 10px;">' +
      '<div>职位：<b>' + esc(p.title) + '</b></div>' +
      '<div>薪资：' + p.salary.min + '-' + p.salary.max + 'k · ' + p.salary.months + '薪　经验：' + esc(p.exp || '不限') + '　学历：' + esc(p.edu || '不限') + '</div>' +
      '<div style="margin:4px 0;">城市：<select style="font-size:12px;">' + (p.cities || []).map(function (c) { return '<option>' + esc(c) + '</option>'; }).join('') + '</select></div>' +
      '<button data-a="fill" style="width:100%;background:#2563eb;color:#fff;border:none;border-radius:6px;padding:5px;cursor:pointer;margin-top:4px;">填入表单（不会点发布）</button>' +
      '<div class="rs" style="margin-top:6px;"></div></div>';
  }
  function esc(x) { return String(x == null ? '' : x).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }

  function check() {
    if (!alive()) return;
    var form = isForm();
    if (!form) { if (box) box.style.display = 'none'; }
    if (form && hint) hint.style.display = 'none';
    chrome.storage.local.get('pendingPublish', function (o) {
      var p = o.pendingPublish;
      if (!p || (p.sites || []).indexOf(SITE) < 0 || Date.now() - (p.at || 0) > 24 * 3600000) return;
      if (!form) { if (looksPublish()) showHint(); return; }
      if (!box || box.dataset.at !== String(p.at)) { showBox(p); box.dataset.at = String(p.at); }
    });
  }
  setInterval(check, 2500);
})();
