/**
 * job-fetch.js v1.6.0：从 Boss / 猎聘「职位管理」页抓取职位名称和 JD 原文
 * 只会点三类东西：每个职位右边的「…」更多图标、菜单里的「预览」、预览窗口右上角的关闭图标（×）。
 * 名字带「关闭」「删除」「编辑」「刷新」的按钮一律不碰。
 * 抓到的结果存进 chrome.storage.local.jobFetch，在「设置 · 岗位JD · 从平台抓取职位」里生成 AI 提示词表。
 */
(function () {
  'use strict';
  if (window.__HRS_JOBFETCH__) return;
  window.__HRS_JOBFETCH__ = true;
  // v1.9.48 抓取职位不在这次 RPA 改造范围内：用 HRSDom.script（原来的脚本点击 / 调试器真实点击），行为和 v1.9.47 一样
  var D = window.HRSDom && window.HRSDom.script ? window.HRSDom.script : window.HRSDom;
  if (!D) return;
  var SITE = /zhipin\.com$/i.test(location.hostname) ? 'boss' : (/liepin\.com$/i.test(location.hostname) ? 'liepin' : '');
  if (!SITE) return;
  var FORBID = /关闭|删除|编辑|刷新|置顶|下线|复制|分享|上传|共享|日志/;

  function send(msg) { return new Promise(function (r) { try { chrome.runtime.sendMessage(msg, function (x) { r(x || {}); }); } catch (e) { r({}); } }); }

  // ---------------- 列表页识别 ----------------
  function jobCards() {
    var need = SITE === 'boss' ? ['看过我', '沟通过'] : ['沟通中', '待看'];
    var marks = D.qsa('span,div,p').filter(function (el) { return el.children.length === 0 && D.textOf(el) === need[0] && D.visible(el); });
    var cards = [];
    marks.forEach(function (m) {
      var cur = m.parentElement;
      while (cur && cur !== document.body) {
        var r = D.rectOf(cur);
        if (r.height > 260) break;
        var t = D.textOf(cur);
        if (r.width > 700 && t.indexOf(need[1]) >= 0) { if (cards.indexOf(cur) < 0) cards.push(cur); break; }
        cur = cur.parentElement;
      }
    });
    return cards;
  }
  function cardInfo(card) {
    var ls = D.leaves(card);
    ls.sort(function (a, b) { var ra = D.rectOf(a), rb = D.rectOf(b); return Math.abs(ra.top - rb.top) > 6 ? ra.top - rb.top : ra.left - rb.left; });
    var texts = ls.map(function (el) { return D.textOf(el).replace(/\s+/g, ' ').trim(); }).filter(function (t) { return t && !/^[|｜]$/.test(t); });
    var title = (texts[0] || '').replace(/[竞普享]$/, '').trim();
    // v1.9.12 猎聘：标题是指向职位详情页的链接（ejobdetail?ejob_id=…），直接取链接文字。
    // 原来按位置取第一格，标题上方的「推荐发起」角标会被当成职位名
    var lk = SITE === 'liepin' ? detailLink(card) : null;
    if (lk && D.textOf(lk).trim()) { title = D.textOf(lk).replace(/\s+/g, ' ').trim(); var lr = D.rectOf(lk); ls = ls.filter(function (el) { return D.rectOf(el).top >= lr.top - 4; }); }
    var r0 = lk ? D.rectOf(lk) : (ls[0] ? D.rectOf(ls[0]) : null);
    // 标题下一行：苏州 | 5-10年 | 本科 | 15-25K·12薪 | 全职（Boss）或 上海-浦东新区 | 15-40k·15薪（猎聘）
    var meta = [];
    if (r0) {
      var rows = ls.filter(function (el) { var r = D.rectOf(el); return r.top > r0.bottom - 2 && r.top < r0.bottom + 40 && r.left < r0.left + 420; });
      meta = rows.map(function (el) { return D.textOf(el).trim(); }).filter(function (t) { return t && !/^[|｜]$/.test(t); });
    }
    var city = (meta[0] || '').split(/[-·]/)[0];
    var exp = meta.filter(function (t) { return /年|应届|经验不限/.test(t) && !/刷新/.test(t); })[0] || '';
    var edu = meta.filter(function (t) { return /^(不限|高中|中专|大专|本科|硕士|博士)/.test(t); })[0] || '';
    var salary = meta.filter(function (t) { return /[kK]|元|薪/.test(t); })[0] || '';
    return { title: title, city: city, exp: exp, edu: edu, salary: salary, greetJob: SITE === 'boss' && city ? title + ' _ ' + city : '' };
  }
  function detailLink(card) {
    return D.qsa('a[href*="ejobdetail"]', card).filter(function (a) { return /ejob_id=\d+/.test(a.getAttribute('href') || ''); })[0] || null;
  }
  function moreIcon(card) {
    var cr = D.rectOf(card);
    var c = D.qsa('*', card).filter(function (el) {
      if (!D.visible(el)) return false;
      var t = D.textOf(el).replace(/\s+/g, '');
      var r = D.rectOf(el);
      if (r.width > 48 || r.height > 48 || r.left < cr.left + cr.width * 0.6) return false;
      var cls = String(el.className && el.className.baseVal != null ? el.className.baseVal : el.className || '') + ' ' + (el.getAttribute('title') || '') + ' ' + (el.getAttribute('aria-label') || '');
      if (FORBID.test(t) || FORBID.test(cls)) return false;
      return /^[.。·•…]{2,}$/.test(t) || /more|ellipsis|dots?\b|gengduo/i.test(cls);
    });
    c.sort(function (a, b) { return D.rectOf(b).right - D.rectOf(a).right; });
    return c[0] || null;
  }
  // v1.9.4 上一个职位的菜单可能还挂在页面上：取离这次「…」图标最近的那个「预览」
  function previewItem(more) {
    var hits = D.byExactText('预览').filter(function (el) { return !FORBID.test(D.textOf(el)) && D.visible(el); });
    if (!more || hits.length < 2) return hits[0] || null;
    var mr = D.rectOf(more), mx = mr.left + mr.width / 2, my = mr.top + mr.height / 2;
    hits.sort(function (a, b) {
      var ra = D.rectOf(a), rb = D.rectOf(b);
      return Math.hypot(ra.left + ra.width / 2 - mx, ra.top - my) - Math.hypot(rb.left + rb.width / 2 - mx, rb.top - my);
    });
    return hits[0];
  }

  // ---------------- Boss：页面内预览窗口 ----------------
  // 预览窗口：从「职位详情」往外找，直到包含底部「职位发布时间」那一层（标题和右上角 × 都在这一层里）
  function bossModal() {
    var t = D.qsa('*').filter(function (el) { return el.children.length === 0 && D.textOf(el).replace(/\s+/g, '') === '职位详情' && D.visible(el); })[0];
    if (!t) return null;
    var best = null, cur = t.parentElement;
    while (cur && cur !== document.body) {
      var r = D.rectOf(cur);
      if (r.width >= window.innerWidth * 0.95 && r.height >= window.innerHeight * 0.9) break;   // 到全屏遮罩就停
      var tx = D.textOf(cur);
      if (r.width > 450 && /工作地址/.test(tx)) best = cur;
      if (best && /职位发布时间|编辑职位/.test(tx)) { best = cur; break; }
      cur = cur.parentElement;
    }
    return best;
  }
  function closeIconFor(modal) {
    var mr = D.rectOf(modal);
    // 在整页里找右上角的小图标（× 有时不在内容层里）
    var c = D.qsa('*').filter(function (el) {
      if (!D.visible(el) || el.closest('#__hrs_fetch_btn__')) return false;
      var r = D.rectOf(el);
      if (r.width > 44 || r.height > 44 || r.width < 6) return false;
      if (r.left < mr.right - 90 || r.right > mr.right + 12 || r.top < mr.top - 12 || r.top > mr.top + 90) return false;
      var t = D.textOf(el).replace(/\s+/g, '');
      var cls = String(el.className && el.className.baseVal != null ? el.className.baseVal : el.className || '');
      if (FORBID.test(t)) return false;
      return t === '' || t === '×' || t === '✕' || t === 'X' || /close/i.test(cls);
    });
    // 优先 class 带 close 的，其次最靠右上的
    c.sort(function (a, b) {
      var ca = /close/i.test(String(a.className || '')) ? 0 : 1, cb = /close/i.test(String(b.className || '')) ? 0 : 1;
      return ca - cb || (D.rectOf(b).right - D.rectOf(a).right) || (D.rectOf(a).top - D.rectOf(b).top);
    });
    return c[0] || null;
  }
  function modalGone(modal) { return !modal.isConnected || !D.visible(modal) || !bossModal(); }
  function closeModal(modal) {
    var x = closeIconFor(modal);
    var p = x ? D.click(x) : Promise.resolve();
    return p.then(function () { return D.waitFor(function () { return modalGone(modal); }, 2500); }).then(function (gone) {
      if (gone) return true;
      D.pressEscape();
      return D.waitFor(function () { return modalGone(modal); }, 2000);
    });
  }
  function expandAll(modal) {
    var b = D.byExactText('展开全部', modal)[0] || D.byExactText('展开', modal)[0];
    if (!b) return Promise.resolve();
    return D.click(b).then(function () { return D.sleep(D.rand(500, 900)); });
  }
  function readBossModal(modal) {
    var raw = modal.innerText || modal.textContent || '';
    var lines = raw.split('\n').map(function (l) { return l.trim(); }).filter(Boolean);
    var a = lines.indexOf('职位详情'), b = lines.indexOf('工作地址');
    if (a < 0) {
      // 换行读不出来时，按文字位置切
      var m = raw.match(/职位详情([\s\S]*?)工作地址/);
      lines = ['职位详情'].concat((m ? m[1] : '').split('\n').map(function (l) { return l.trim(); }).filter(Boolean)).concat(['工作地址']);
      a = 0; b = lines.length - 1;
    }
    var body = lines.slice(a + 1, b > a ? b : lines.length);
    var tags = [], i = 0;
    while (i < body.length && body[i].length <= 10 && !/[【\d、:：]/.test(body[i])) { tags.push(body[i]); i++; }
    return { tags: tags, jd: body.slice(i).join('\n') };
  }

  /**
   * v1.7.1 Boss 的职位管理列表在 iframe 里，但「预览」窗口弹在最外层页面。
   * 所以：先在本页找预览窗口，找不到就请后台转给最外层页面的同一个脚本去读、去关。
   */
  function readAndCloseHere(timeout) {
    return D.waitFor(bossModal, timeout || 5000).then(function (modal) {
      if (!modal) return { found: false };
      return expandAll(modal).then(function () {
        var m2 = bossModal() || modal;
        var body = readBossModal(m2);
        return closeModal(m2).then(function (closed) { return { found: true, body: body, closed: !!closed }; });
      });
    });
  }
  if (window === window.top) {
    chrome.runtime.onMessage.addListener(function (msg, sender, reply) {
      if (!msg || msg.type !== 'FETCH_READ_MODAL') return;
      readAndCloseHere(msg.timeout || 4000).then(reply);
      return true;
    });
  }
  function readModalAnywhere() {
    return readAndCloseHere(window === window.top ? 5000 : 1500).then(function (r) {
      if (r.found || window === window.top) return r;
      return send({ type: 'FETCH_MODAL_RELAY', timeout: 4000 }).then(function (x) { return x && x.found ? x : { found: false }; });
    });
  }

  // v1.9.7 配合 open-hook.js：做 action 期间页面要开的新标签地址交给插件；timeout 内没接到返回 ''
  function catchOpen(action, timeout) {
    return new Promise(function (resolve) {
      var done = false, root = document.documentElement;
      function finish(url) {
        if (done) return; done = true;
        window.removeEventListener('message', onMsg);
        root.removeAttribute('data-hrs-catch-open');
        resolve(url || '');
      }
      function onMsg(e) { if (e.source === window && e.data && e.data.__hrs_open__ && e.data.url) finish(e.data.url); }
      window.addEventListener('message', onMsg);
      root.setAttribute('data-hrs-catch-open', '1');
      Promise.resolve().then(action).catch(function () {});
      setTimeout(function () { finish(''); }, timeout || 2500);
    });
  }
  // ---------------- 主流程 ----------------
  var running = false;
  // v1.9.14 核对前先把列表滚到底，让后面的职位都加载出来（职位数连续两次不变就算加载完）
  function scrollables() {
    return [document.scrollingElement || document.documentElement].concat(D.qsa('div,ul,section').filter(function (el) {
      var cs = getComputedStyle(el);
      return /(auto|scroll)/.test(cs.overflowY) && el.scrollHeight > el.clientHeight + 40 && el.clientHeight > 200;
    }));
  }
  function loadAllCards() {
    var last = -1, same = 0, n = 0;
    return (function step() {
      var cnt = jobCards().length;
      if (cnt === last) same++; else same = 0;
      last = cnt;
      if (same >= 2 || n++ >= 15) {
        scrollables().forEach(function (el) { try { el.scrollTop = 0; } catch (e) {} });
        return D.sleep(400).then(function () { return jobCards(); });
      }
      scrollables().forEach(function (el) { try { el.scrollTop = el.scrollHeight; } catch (e) {} });
      return D.sleep(900).then(step);
    })();
  }
  // v1.9.14 和「在招岗位」核对：这个平台来源的岗位，平台列表里已经没有（或 Boss 上已关闭）的，列出来批量删除
  function goneJobs(jds, infos, cards) {
    var live = infos.map(function (x, i) {
      var closed = SITE === 'boss' && D.byExactText('打开', cards[i]).length && !D.byExactText('关闭', cards[i]).length;
      return { t: D.norm(x.title), g: D.norm(x.greetJob || ''), c: D.norm(x.city || ''), closed: closed };
    });
    var onSite = window.HRSPlan && HRSPlan.onSite ? HRSPlan.onSite : function (j, s) { return (j.sources || []).indexOf(s) >= 0; };
    return (jds || []).filter(function (j) { return onSite(j, SITE); }).map(function (j) {
      var t = D.norm(SITE === 'liepin' ? (j.liepinJob || j.platformJob || j.title) : (j.platformJob || j.title)), g = D.norm(j.greetJob || '');
      var hits = live.filter(function (x) {
        if (SITE === 'boss' && g && x.g) return x.g === g;
        return x.t === t;
      });
      if (hits.length && hits.some(function (x) { return !x.closed; })) return null;
      var others = (j.sources || []).filter(function (x) { return x !== SITE; });
      return { id: j.id, title: j.title, why: hits.length ? '已关闭' : '列表里没有', keep: others.length > 0, others: others };
    }).filter(Boolean);
  }
  // v1.9.0 先列出职位让你勾选，只抓勾选的
  function pickJobs(cards) {
    return new Promise(function (resolve) {
      chrome.storage.local.get(['jds', 'jobFetch'], function (o) {
        var have = {};
        // 抓过 = 抓取记录里有这个平台的同名职位并且读到了 JD，或者在招岗位里有 JD 原文
        ((o.jobFetch || {})[SITE] || []).forEach(function (j) { if (j.jd && !junkJd(j.jd)) have[D.norm(j.title)] = true; });   // v1.9.16 读到导航的不算抓过
        (o.jds || []).forEach(function (j) { if (j.jdText && !junkJd(j.jdText)) { have[D.norm(j.platformJob || j.title)] = true; have[D.norm(j.title)] = true; } });
        var infos = cards.map(cardInfo);
        var box = document.createElement('div');
        box.id = '__hrs_pick__';
        box.style.cssText = 'position:fixed;left:16px;bottom:64px;z-index:2147483647;width:420px;max-height:70vh;display:flex;flex-direction:column;background:#fff;border:1px solid #cbd5e1;border-radius:10px;box-shadow:0 8px 24px rgba(0,0,0,.2);font:12px/1.6 "Microsoft YaHei",sans-serif;color:#1f2937;';
        var rows = infos.map(function (x, i) {
          var got = have[D.norm(x.title)];
          var closed = SITE === 'boss' && D.byExactText('打开', cards[i]).length && !D.byExactText('关闭', cards[i]).length;
          return '<label style="display:flex;gap:6px;align-items:center;padding:3px 10px;border-top:1px dashed #eef2f7;' + (closed ? 'color:#94a3b8;' : '') + '">' +
            '<input type="checkbox" data-i="' + i + '"' + (closed || got ? '' : ' checked') + '>' +
            '<span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">' + escH(x.title) + '</span>' +
            '<span style="color:#94a3b8;">' + escH(x.city || '') + (closed ? ' · 已关闭' : (got ? ' · 已抓过' : '')) + '</span></label>';
        }).join('');
        box.innerHTML = '<div style="padding:8px 10px;font-weight:600;display:flex;align-items:center;gap:8px;">勾选要抓取 JD 的职位<span style="font-weight:400;color:#94a3b8;">共 ' + infos.length + ' 个</span>' +
          '<label style="margin-left:auto;font-weight:400;"><input type="checkbox" data-a="all"> 全选</label></div>' +
          '<div style="overflow:auto;flex:1;">' + rows + '</div>' +
          '<div style="display:flex;gap:8px;padding:8px 10px;border-top:1px solid #e5e7eb;"><button data-a="go" style="flex:1;background:#0d9488;color:#fff;border:none;border-radius:6px;padding:5px;cursor:pointer;">抓取所选</button><button data-a="no" style="border:1px solid #d1d5db;background:#fff;border-radius:6px;padding:5px 12px;cursor:pointer;">取消</button></div>';
        // v1.9.15 在招岗位里两边平台各有一条、其实是同一个岗位的（JD 原文 + 职位名 + 城市一致）
        var dups = window.HRSPlan && HRSPlan.dupPairs ? HRSPlan.dupPairs(o.jds || []) : [];
        if (dups.length) {
          var dbox = document.createElement('div');
          dbox.style.cssText = 'border-bottom:2px solid #bfdbfe;background:#eff6ff;max-height:30vh;overflow:auto;';
          var diff = function (b, l) {
            var x = [], bb = b.base || {}, lb = l.base || {};
            if ((bb.exp || 0) !== (lb.exp || 0)) x.push('经验 ' + (bb.exp || '不限') + '/' + (lb.exp || '不限'));
            if ((bb.edu || 0) !== (lb.edu || 0)) x.push('学历不同');
            if (JSON.stringify(b.hardRequirements || []) !== JSON.stringify(l.hardRequirements || [])) x.push('硬性要求不同');
            return x.length ? '（Boss/猎聘：' + x.join('，') + '，合并后用 Boss 的）' : '';
          };
          dbox.innerHTML = '<div style="padding:8px 10px;font-weight:600;color:#1d4ed8;">两边平台的同一个岗位 ' + dups.length + ' 组，可以合并成一条</div>' +
            '<div style="padding:0 10px 4px;color:#1e40af;">JD 原文、职位名、城市都对得上。合并后条件用 Boss 那条，带上猎聘标签和猎聘的上限、打招呼语。</div>' +
            dups.map(function (p, i) {
              return '<label style="display:flex;gap:6px;align-items:flex-start;padding:3px 10px;border-top:1px dashed #bfdbfe;">' +
                '<input type="checkbox" data-m="' + i + '" checked style="margin-top:3px;"><span style="flex:1;">' + escH(p.boss.title) + ' ＋ ' + escH(p.liepin.title) +
                '<span style="color:#64748b;"> · JD 相似 ' + Math.round(p.sim * 100) + '% ' + escH(diff(p.boss, p.liepin)) + '</span></span></label>';
            }).join('') +
            '<div style="padding:6px 10px;"><button data-a="merge" style="width:100%;background:#2563eb;color:#fff;border:none;border-radius:6px;padding:5px;cursor:pointer;">合并所选</button></div>';
          box.insertBefore(dbox, box.children[1]);
        }
        // v1.9.14 已经不在平台上的岗位
        var gone = goneJobs(o.jds, infos, cards);
        var PN = SITE === 'boss' ? 'Boss' : '猎聘';
        if (gone.length) {
          var gbox = document.createElement('div');
          gbox.style.cssText = 'border-bottom:2px solid #fde68a;background:#fffbeb;max-height:34vh;overflow:auto;';
          gbox.innerHTML = '<div style="padding:8px 10px;font-weight:600;color:#b45309;">在招岗位里有、' + PN + '上已经不在的 ' + gone.length + ' 个</div>' +
            '<div style="padding:0 10px 4px;color:#92400e;">按当前列表核对（读到 ' + infos.length + ' 个职位）。请确认你看的是「招聘中」列表，且职位都加载出来了。</div>' +
            gone.map(function (g, i) {
              return '<label style="display:flex;gap:6px;align-items:center;padding:3px 10px;border-top:1px dashed #fde68a;">' +
                '<input type="checkbox" data-g="' + i + '" checked><span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">' + escH(g.title) + '</span>' +
                '<span style="color:#b45309;">' + g.why + (g.keep ? ' · 只去掉' + PN + '来源' : '') + '</span></label>';
            }).join('') +
            '<div style="padding:6px 10px;"><button data-a="del" style="width:100%;background:#dc2626;color:#fff;border:none;border-radius:6px;padding:5px;cursor:pointer;">删除所选</button></div>';
          box.insertBefore(gbox, box.children[1]);
        }
        document.documentElement.appendChild(box);
        box.addEventListener('click', function (e) {
          var a = e.target.getAttribute('data-a');
          if (a === 'merge') {
            var ms = Array.prototype.slice.call(box.querySelectorAll('input[data-m]:checked')).map(function (c) { return dups[+c.getAttribute('data-m')]; });
            if (!ms.length || !confirm('合并 ' + ms.length + ' 组岗位？每组保留 Boss 那条的条件，猎聘那条删掉。')) return;
            e.target.disabled = true;
            send({ type: 'MERGE_JDS', pairs: ms.map(function (p) { return { bossId: p.boss.id, liepinId: p.liepin.id }; }) }).then(function (r) {
              e.target.textContent = r && r.ok ? '已合并 ' + r.merged + ' 组' : '合并失败：' + ((r && r.error) || '');
              box.querySelectorAll('input[data-m]').forEach(function (c) { c.disabled = true; });
            });
            return;
          }
          if (a === 'del') {
            var sel = Array.prototype.slice.call(box.querySelectorAll('input[data-g]:checked')).map(function (c) { return gone[+c.getAttribute('data-g')]; });
            if (!sel.length) return;
            var del = sel.filter(function (g) { return !g.keep; }), strip = sel.filter(function (g) { return g.keep; });
            if (!confirm('删除 ' + del.length + ' 个岗位' + (strip.length ? '，另有 ' + strip.length + ' 个岗位在别的平台还在，只去掉' + PN + '来源' : '') + '？\n已入库的候选人不受影响。')) return;
            e.target.disabled = true;
            send({ type: 'DELETE_JDS', ids: del.map(function (g) { return g.id; }), stripIds: strip.map(function (g) { return g.id; }), site: SITE }).then(function (r) {
              e.target.textContent = r && r.ok ? '已处理：删除 ' + del.length + ' 个' + (strip.length ? '，去掉来源 ' + strip.length + ' 个' : '') : '处理失败：' + ((r && r.error) || '');
              box.querySelectorAll('input[data-g]').forEach(function (c) { c.disabled = true; });
            });
            return;
          }
          if (a === 'all') box.querySelectorAll('input[data-i]').forEach(function (c) { c.checked = e.target.checked; });
          if (a === 'go' || a === 'no') {
            var picked = a === 'go' ? Array.prototype.slice.call(box.querySelectorAll('input[data-i]:checked')).map(function (c) { return cards[+c.getAttribute('data-i')]; }) : [];
            box.remove();
            resolve(picked);
          }
        });
      });
    });
  }
  function escH(x) { return String(x == null ? '' : x).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function alive() { try { return !!(chrome.runtime && chrome.runtime.id && chrome.storage && chrome.storage.local); } catch (e) { return false; } }
  function fetchAll(btn, auto) {
    if (running || document.getElementById('__hrs_pick__')) return;
    if (!alive()) { alert('Smart Filter 插件已更新，这个页面里还是旧版本。请按 F5 刷新页面后再点「抓取职位JD」。'); return; }
    if (!jobCards().length) { alert('没找到职位卡片。请在「职位管理」列表页使用'); return; }
    btn.textContent = '正在加载全部职位…';
    loadAllCards().then(function (all) { btn.textContent = 'Smart Filter：抓取职位JD'; return pickJobs(all); }).then(function (cards) {
      if (!cards.length) return;
      fetchSelected(btn, cards);
    });
  }
  function fetchSelected(btn, cards) {
    running = true;
    var ok = 0, fail = [], skipped = [];
    var i = 0;
    var finish = function (msg) {
      running = false;
      btn.textContent = 'Smart Filter：抓取职位JD';
      alert(msg || ('抓取完成：成功 ' + ok + ' 个' + (skipped.length ? '，跳过已关闭职位 ' + skipped.length + ' 个' : '') + (fail.length ? '，失败 ' + fail.length + ' 个：\n' + fail.join('\n') : '') + '\n\n抓到的职位已自动加入「设置 · 在招岗位」，可在那里生成 AI 提示词表。'));
    };
    (function next() {
      if (i >= cards.length) return finish();
      var card = cards[i++];
      var info = cardInfo(card);
      // 已关闭的职位（右边是「打开」而不是「关闭」）不抓
      if (SITE === 'boss' && D.byExactText('打开', card).length && !D.byExactText('关闭', card).length) { skipped.push(info.title); return next(); }
      btn.textContent = '抓取中 ' + i + '/' + cards.length + '：' + info.title;
      // v1.9.12 猎聘：职位标题本身就是详情页链接，直接由后台打开这个地址读 JD，不再点「…」「预览」
      var dl = SITE === 'liepin' ? detailLink(card) : null;
      if (dl) {
        var url = new URL(dl.getAttribute('href'), location.href).href;
        var before0 = 0;
        new Promise(function (r) { chrome.storage.local.get('jobFetch', function (o) { before0 = ((o.jobFetch || {}).seq || 0); r(); }); })
          .then(function () { return send({ type: 'FETCH_EXPECT', info: info }); })
          .then(function () { return send({ type: 'FETCH_OPEN', url: url }); })
          .then(function () {
            var end = Date.now() + 20000;
            return new Promise(function (resolve) {
              (function poll() {
                chrome.storage.local.get('jobFetch', function (o) {
                  if (((o.jobFetch || {}).seq || 0) > before0) return resolve(true);
                  if (Date.now() > end) return resolve(false);
                  setTimeout(poll, 600);
                });
              })();
            });
          })
          .then(function (got) { if (got) ok++; else fail.push(info.title + '（详情页 20 秒内没读到）'); return D.sleep(D.rand(1200, 2500)); })
          .then(next);
        return;
      }
      var more = moreIcon(card);
      if (!more) { fail.push(info.title + '（找不到「…」图标）'); return next(); }
      var pvOf = function () { var p = previewItem(more); if (!p) return null; var pr = D.rectOf(p), mr = D.rectOf(more); return Math.abs(pr.top - mr.top) < 320 ? p : null; };
      // 先把上一个菜单收起来：鼠标移开 + Esc
      (function () { try { D.pressEscape(); } catch (e) {} return Promise.resolve(); })();
      D.scrollIntoViewSoft(card).then(function () { return D.sleep(D.rand(400, 700)); }).then(function () { return D.hover(more); })
        .then(function () { return D.waitFor(pvOf, 1200); })
        .then(function (pv) { return pv ? pv : D.click(more).then(function () { return D.waitFor(pvOf, 2000); }); })
        .then(function (pv) {
          if (!pv) { fail.push(info.title + '（菜单里没有「预览」）'); D.pressEscape(); return 'skip'; }
          if (SITE === 'liepin') {
            return send({ type: 'FETCH_EXPECT', info: info }).then(function () {
              var before = null;
              return new Promise(function (r) { chrome.storage.local.get('jobFetch', function (o) { before = ((o.jobFetch || {}).seq || 0); r(); }); })
                // v1.9.5 猎聘「预览」是打开新标签页：脚本点击没有「用户操作」的授权，会被浏览器当弹窗拦掉
                // （只有刚手动点完按钮的头几秒有授权，所以前一两个成功、后面失败）。改用真实鼠标点击
                .then(function () {
                  // v1.9.6 ① 「预览」本身是链接：让后台直接打开这个地址
                  var link = pv.closest && pv.closest('a[href]');
                  var href = link && link.getAttribute('href');
                  if (href && !/^(#|javascript:)/i.test(href)) return send({ type: 'FETCH_OPEN', url: new URL(href, location.href).href });
                  // v1.9.7 ② 普通点「预览」，页面要开新标签时把地址接过来，由后台打开（不受弹窗拦截）
                  return catchOpen(function () { return D.click(pv); }, 3500).then(function (url) {
                    if (url) return send({ type: 'FETCH_OPEN', url: url });
                    return trustedPreview();
                  });
                })
                .then(function () { return waitSaved(); })
                .then(function (got) { D.leave(more); if (got) ok++; else fail.push(info.title + '（预览页 20 秒内没读到）'); });
              function trustedPreview() {
                  // ③ 真实鼠标：先真的移到「…」上让菜单打开，再真的点「预览」
                  return D.trustedHover(more).then(function () { return D.sleep(D.rand(500, 800)); })
                    .then(function () { var p2 = pvOf() || pv; return D.trustedHover(p2).then(function () { return D.sleep(200); }).then(function () { return D.trustedClick(p2); }); })
                    .then(function (r) { if (!r || !r.ok) return D.click(pv); });
              }
              function waitSaved() {
                  // 等新标签页读完并自动关闭（最多 20 秒）
                  var end = Date.now() + 20000;
                  return new Promise(function (resolve) {
                    (function poll() {
                      chrome.storage.local.get('jobFetch', function (o) {
                        if (((o.jobFetch || {}).seq || 0) > before) return resolve(true);
                        if (Date.now() > end) return resolve(false);
                        setTimeout(poll, 600);
                      });
                    })();
                  });
              }
            });
          }
          return D.click(pv).then(function () { D.leave(more); return readModalAnywhere(); }).then(function (r) {
            if (!r.found) {
              fail.push(info.title + '（预览窗口没出来）');
              // 最外层页面的插件没加载（插件更新后没刷新整页）时，转发会报 Receiving end does not exist
              if (r.error && /Receiving end|Could not establish/i.test(r.error)) throw new Error('插件已更新但这个页面没刷新，最外层页面读不到预览窗口。请按 F5 刷新整个页面后再抓');
              throw new Error('没找到预览窗口，为避免窗口越叠越多，已停止');
            }
            return send({ type: 'FETCH_SAVE', job: Object.assign({ source: 'boss' }, info, r.body) }).then(function () {
              ok++;
              if (!r.closed) throw new Error('预览窗口关不掉');
            });
          });
        })
        .then(function () { return D.sleep(D.rand(1200, 2500)); })
        .then(next)
        .catch(function (e) { finish('已停止：' + (e && e.message || e) + '。请手动关闭预览窗口。已抓取 ' + ok + ' 个。'); });
    })();
  }

  // ---------------- 猎聘：预览新标签页 ----------------
  // v1.9.16 猎聘详情页是先出页头、JD 后加载：原来一看到「职位详情」就读，读到的是页头导航（招聘工作台 / 邀请同事 / 我的权益…）。
  // 改为：每个小标题后面都试着截一段，取最长的那段，够长（≥60 字）且不是导航才算读到；最多等 20 秒
  var JD_HEAD = /(职位描述|职位介绍|职位详情|岗位职责|工作职责|职位职责|职责和要求|岗位描述)/g;
  var JD_END = /\n\s*(其他信息|公司简介|公司介绍|企业介绍|公司信息|工作地址|职位发布者|相似职位|推荐职位|看过该职位的人|猎聘温馨提示|猜你喜欢|举报)/;
  function junkJd(t) { t = String(t || '').trim(); return t.length < 60 || /招聘工作台|邀请同事|我的权益|集团管理员/.test(t.slice(0, 80)); }
  function readLiepinJd() {
    var txt = document.body ? (document.body.innerText || '') : '', best = '', m;
    JD_HEAD.lastIndex = 0;
    while ((m = JD_HEAD.exec(txt)) !== null) {
      var keepHead = !/^(职位描述|职位介绍|职位详情)$/.test(m[1]);   // 「岗位职责」这类本身是 JD 内容，保留
      var rest = txt.slice(keepHead ? m.index : m.index + m[0].length);
      var e = rest.search(JD_END);
      var jd = (e > 0 ? rest.slice(0, e) : rest.slice(0, 4000)).trim();
      if (!junkJd(jd) && jd.length > best.length) best = jd;
    }
    return best;
  }
  function liepinCapture() {
    send({ type: 'FETCH_AM_I_CAPTURE' }).then(function (r) {
      if (!r || !r.capture) return;
      D.waitFor(readLiepinJd, 20000, 600).then(function (jd) {
        // 没读到就不带 JD（后台不会用空内容覆盖原来的 JD）
        send({ type: 'FETCH_SAVE', job: Object.assign({ source: 'liepin' }, r.info || {}, { jd: jd || '' }), closeTab: true });
      });
    });
  }

  // ---------------- 入口按钮 ----------------
  function ensureButton() {
    var cards = jobCards();
    var btn = document.getElementById('__hrs_fetch_btn__');
    if (!cards.length) { if (btn) btn.style.display = 'none'; return; }
    if (!btn) {
      btn = document.createElement('button');
      btn.id = '__hrs_fetch_btn__';
      btn.textContent = 'Smart Filter：抓取职位JD';
      btn.style.cssText = 'position:fixed;left:16px;bottom:16px;z-index:2147483646;background:#0d9488;color:#fff;border:none;border-radius:20px;padding:9px 18px;font:600 13px "Microsoft YaHei";box-shadow:0 4px 14px rgba(0,0,0,.2);cursor:pointer;max-width:420px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;';
      btn.addEventListener('click', function () { fetchAll(btn); });
      document.documentElement.appendChild(btn);
    }
    btn.style.display = '';
    // v1.8.5 设置页点了「开始抓取」：10 分钟内打开职位管理列表就自动开始，不用再点按钮
    if (!running && !window.__hrsAutoChecked) {
      window.__hrsAutoChecked = true;
      chrome.storage.local.get('autoFetch', function (o) {
        var a = o.autoFetch;
        if (!a || a.site !== SITE || a.until < Date.now()) { window.__hrsAutoChecked = false; return; }
        chrome.storage.local.remove('autoFetch');
        setTimeout(function () { fetchAll(btn, true); }, 1500);
      });
    }
  }
  if (SITE === 'liepin') liepinCapture();
  // v1.9.0 记下猎聘沟通页 / 人才推荐页的地址，给计划任务跳转用
  if (SITE === 'liepin' && window === window.top) {
    var path = location.pathname;
    var key = /\/(chat|im|message|msg)(\/|$)/i.test(path) ? 'chat' : (/recommend/i.test(path) ? 'recommend' : '');
    if (key) chrome.storage.local.get('liepinUrls', function (o) { var u = o.liepinUrls || {}; u[key] = location.origin + location.pathname; chrome.storage.local.set({ liepinUrls: u }); });
  }
  setInterval(ensureButton, 2000);
})();
