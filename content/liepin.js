/**
 * 猎聘 站点适配（content/liepin.js）
 * v1.1.0：仅扫描沟通/消息会话页，推荐与人才列表不参与。
 */
(function () {
  'use strict';
  if (window.__HRS_LIEPIN__) return;
  window.__HRS_LIEPIN__ = true;
  window.__HRS_SITE__ = 'liepin';

  var A = window.__HRS_ENGINE_API__;
  var CT = window.HRSChatTarget;
  var cfg = function () { return A.state.siteConfig || (window.HRSSiteConfig && HRSSiteConfig.get('liepin')) || {}; };

  function visible(el) {
    if (!el || !el.isConnected) return false;
    var r = el.getBoundingClientRect();
    var st = getComputedStyle(el);
    var interactive = /^(BUTTON|A|INPUT|TEXTAREA|SELECT)$/.test(el.tagName) || (el.getAttribute && el.getAttribute('role') === 'button');
    return r.width > (interactive ? 10 : 100) && r.height > (interactive ? 10 : 36) && st.display !== 'none' && st.visibility !== 'hidden';
  }
  function norm(s) { return CT ? CT.normalize(s) : String(s || '').replace(/\s+/g, '').toLowerCase(); }
  function sameName(a, b) {
    var x = norm(a), y = norm(b);
    return !!x && !!y && (x === y || (x.length >= 2 && y.indexOf(x) >= 0) || (y.length >= 2 && x.indexOf(y) >= 0));
  }
  function textOf(el) { return el ? String(el.innerText || el.textContent || '').trim() : ''; }
  function firstText(root, selectors, max) {
    for (var i = 0; i < (selectors || []).length; i++) {
      var el = A.qs(selectors[i], root);
      var t = textOf(el).replace(/\s+/g, ' ').trim();
      if (t && t.length <= (max || 80)) return t;
    }
    return '';
  }
  function attrByNames(el, names) {
    if (!el || !el.getAttribute) return '';
    for (var i = 0; i < names.length; i++) {
      var v = el.getAttribute(names[i]);
      if (v) return String(v).trim();
    }
    return '';
  }
  function findByText(root, texts, tag) {
    var els = A.qsa((tag || 'button,a,span,div[role="button"],div[class*="btn"]'), root || document);
    for (var i = 0; i < els.length; i++) {
      if (!visible(els[i])) continue;
      var t = textOf(els[i]);
      for (var j = 0; j < texts.length; j++) {
        if (t === texts[j] || (t.indexOf(texts[j]) === 0 && t.length <= texts[j].length + 8)) return els[i];
      }
    }
    return null;
  }
  function isCommunicationPage() { return !!(CT && CT.isCommunicationUrl('liepin', location.href)); }

  function chatIdOf(card) {
    if (!card) return '';
    var own = attrByNames(card, ['data-chatid', 'data-chat-id', 'data-conversation-id', 'data-session-id', 'data-id']);
    if (own) return own;
    var inner = A.qs('[data-chatid],[data-chat-id],[data-conversation-id],[data-session-id]', card);
    var v = attrByNames(inner, ['data-chatid', 'data-chat-id', 'data-conversation-id', 'data-session-id']);
    if (v) return v;
    var links = card.querySelectorAll('a[href]');
    for (var i = 0; i < links.length; i++) {
      var id = CT.chatIdFromUrl('liepin', links[i].href);
      if (id) return id;
    }
    return '';
  }
  // v1.9.0 卡片第一行是「姓名 职位」：原来的选择器会把「招聘主管」这类职位名当成姓名
  var JOB_WORD = /(工程师|主管|经理|总监|专员|助理|开发|设计|实习|架构|测试|验证|顾问|专家|总裁|主任|负责人|运营|销售)/;
  function looksName(t) {
    if (/^(合格|不合格|待复核)/.test(t || '')) return false;   // v1.9.10 插件自己贴的角标
    if (!t || t.length > 20 || JOB_WORD.test(t) || /^(收到简历|系统通知|消息通知|今天活跃|刚刚活跃|在线|在线简历|附件简历|查看简历|批量处理|全部职位|超级聊聊|有简历|不合适|新招呼|我发起的|我回复的|索要手机|索要微信|索要简历|约面试)$/.test(t)) return false;
    if ((A.state.jds || []).some(function (j) { return norm(j.platformJob || j.title) === norm(t) || norm(j.liepinJob) === norm(t) || norm(j.title) === norm(t); })) return false;
    return /^[\u4e00-\u9fa5]{1,3}(先生|女士|同学)$/.test(t) || /^[\u4e00-\u9fa5·]{2,4}$/.test(t) || /^[A-Za-z][A-Za-z .'-]{1,24}$/.test(t);
  }
  function nameOf(card) {
    var n = firstText(card, cfg().nameSelectors || [], 20);
    if (n && looksName(n)) return n;
    var leaves = A.qsa('*', card).filter(function (el) { return !el.children.length && textOf(el); });
    leaves.sort(function (a, b) { var ra = a.getBoundingClientRect(), rb = b.getBoundingClientRect(); return Math.abs(ra.top - rb.top) > 6 ? ra.top - rb.top : ra.left - rb.left; });
    for (var i = 0; i < leaves.length && i < 8; i++) { var t = textOf(leaves[i]); if (looksName(t)) return t; }
    var g = window.HRSExtractor ? (window.HRSExtractor.guessName(textOf(card)) || '') : '';
    return looksName(g) ? g : '';
  }
  // v1.9.15 岗位在猎聘上的名字（有猎聘名用猎聘名）
  function lpName(j) { return j.liepinJob || j.platformJob || j.title; }
  function jobTextOf(card) {
    // v1.9.3 卡片上职位名被截断成「BSP嵌入式软...」：按前缀对回在招岗位的平台职位名
    var leaves = A.qsa('*', card).filter(function (el) { return !el.children.length; }).map(textOf);
    for (var k = 0; k < leaves.length; k++) {
      var lt = leaves[k];
      if (!/(\.\.\.|…)$/.test(lt)) continue;
      var head = norm(lt.replace(/(\.\.\.|…)$/, ''));
      if (head.length < 3) continue;
      var hit = (A.state.jds || []).filter(function (j) { return norm(lpName(j)).indexOf(head) === 0; })[0];
      if (hit) return lpName(hit);
    }
    // v1.9.10 卡片第一行「姓名 职位 时间」：姓名右边紧挨着的那一格就是沟通职位，不管在不在在招岗位里都取出来
    var nmEl = A.qsa('*', card).filter(function (el) { return !el.children.length && looksName(textOf(el)); })[0];
    if (nmEl) {
      var nr = nmEl.getBoundingClientRect(), mid = nr.top + nr.height / 2;
      var right = A.qsa('*', card).filter(function (el) {
        if (el.children.length || el === nmEl) return false;
        var r = el.getBoundingClientRect(), t = textOf(el);
        return t && r.left >= nr.right - 2 && Math.abs(r.top + r.height / 2 - mid) <= 8 && !TIME_RE.test(t) && !/^\d+$/.test(t) && t !== '不合格';
      }).sort(function (a, b) { return a.getBoundingClientRect().left - b.getBoundingClientRect().left; })[0];
      if (right) {
        var rt = textOf(right).replace(/\s+/g, ' ').trim();
        var head2 = norm(rt.replace(/(\.\.\.|…)$/, ''));
        var hit2 = head2.length >= 2 ? (A.state.jds || []).filter(function (j) { return norm(lpName(j)).indexOf(head2) === 0 || norm(j.title).indexOf(head2) === 0; })[0] : null;
        if (hit2) return lpName(hit2);
        if (rt && rt.length <= 40) return rt;
      }
    }
    var parts = [];
    (cfg().jobSelectors || []).forEach(function (sel) {
      A.qsa(sel, card).slice(0, 2).forEach(function (el) {
        var t = textOf(el).replace(/\s+/g, ' ').trim();
        if (t && t.length <= 60 && parts.indexOf(t) < 0) parts.push(t);
      });
    });
    if (parts.length) return parts.join(' | ');
    var lines = textOf(card).split(/\n+/).map(function (x) { return x.trim(); }).filter(Boolean);
    for (var j = 0; j < lines.length; j++) {
      if (lines[j].length > 60) continue;
      var activeHits = A.state.activeJd && CT.findHits(lines[j], A.state.activeJd);
      var otherHit = (A.state.jds || []).some(function (jd) {
        return (!A.state.activeJd || jd.id !== A.state.activeJd.id) && CT.findHits(lines[j], jd).length;
      });
      if ((activeHits && activeHits.length) || otherHit) return lines[j];
    }
    return '';
  }
  function identityOf(card) {
    var name = nameOf(card), chatId = chatIdOf(card) || '', jobText = jobTextOf(card);
    return { site: 'liepin', name: name, chatId: chatId, jobText: jobText, isRead: /(已读|已查看)/.test(textOf(card)), key: [chatId, name, jobText].join('|') };
  }
  function identityMatches(a, b) {
    if (!a || !b) return false;
    if (a.chatId && b.chatId) return String(a.chatId) === String(b.chatId);
    return sameName(a.name, b.name) && (!a.jobText || !b.jobText || norm(a.jobText).indexOf(norm(b.jobText)) >= 0 || norm(b.jobText).indexOf(norm(a.jobText)) >= 0);
  }
  function cardCacheKey(card) {
    var id = identityOf(card);
    return id.chatId ? 'id:' + id.chatId : 'n:' + norm(id.name) + '|j:' + norm(id.jobText);
  }
  function looksLikeConversation(el) {
    if (!visible(el)) return false;
    if (el.closest && el.closest('nav,header,aside,[class*="toolbar"],[class*="menu"],[class*="navbar"]')) return false;
    var t = textOf(el);
    if (t.length < 5 || t.length > 500 || !nameOf(el)) return false;
    return /(\d{1,2}:\d{2}|\d{1,2}月\d{1,2}日|\d{1,2}分钟前|昨天|今天|刚刚|你好|您好|简历|沟通)/.test(t) || !!el.querySelector('img');
  }

  // v1.9.3 按位置找会话卡片：左侧列表里带时间（15:05 / 10月7日 / 昨天）的行，往上找到一张卡片大小的容器
  var TIME_RE = /^(\d{1,2}:\d{2}|\d{1,2}月\d{1,2}日|昨天|前天|星期[一二三四五六日天]|\d{4}[-/.]\d{1,2}[-/.]\d{1,2})$/;
  // v1.9.8 左侧会话列表的右边界：「批量处理」或「未读」所在那一栏。原来按屏幕 45% 算，把右边聊天区里的「在线简历」卡片、沟通职位也当成了会话
  function listMaxX() {
    var mark = A.qsa('span,div,a,button,label').filter(function (el) {
      var t = textOf(el).replace(/\s+/g, '');
      var r = el.getBoundingClientRect();
      return el.children.length <= 2 && r.width > 0 && r.top < 260 && r.left < window.innerWidth * 0.5 && (t === '批量处理' || t === '全部职位');
    }).map(function (el) { return el.getBoundingClientRect().right; });
    return mark.length ? Math.max.apply(null, mark) + 40 : window.innerWidth * 0.32;
  }
  function geoCards() {
    var maxX = listMaxX(), out = [];
    A.qsa('span,div,p,i,em,time').forEach(function (el) {
      if (el.children.length) return;
      var t = textOf(el);
      if (!TIME_RE.test(t)) return;
      var r = el.getBoundingClientRect();
      if (!r.width || r.left > maxX) return;
      var cur = el.parentElement;
      while (cur && cur !== document.body) {
        var rr = cur.getBoundingClientRect();
        if (rr.height >= 50 && rr.height <= 140 && rr.width >= 200 && rr.width <= 520 && rr.right <= maxX + 20) {
          if (out.indexOf(cur) < 0 && !/^(收到简历|系统通知|消息通知)/.test(textOf(cur))) out.push(cur);
          return;
        }
        if (rr.height > 140) return;
        cur = cur.parentElement;
      }
    });
    return out.filter(function (c) { return !!nameOf(c); }).slice(0, 80);
  }
  var conversationCache = { at: 0, items: [] };
  function conversationCards() {
    if (!isCommunicationPage()) return [];
    var now = Date.now();
    if (conversationCache.at && now - conversationCache.at < 1800) return conversationCache.items.slice();
    var sels = (cfg().conversationSelectors || []).concat(['[class*="chat-item"]', '[class*="conversation-item"]', 'li[data-id]']);
    var out = [];
    for (var i = 0; i < sels.length; i++) {
      var mx = listMaxX();
      var nodes = A.qsa(sels[i]).filter(function (el) { return looksLikeConversation(el) && el.getBoundingClientRect().right <= mx + 20; });
      if (nodes.length) { out = nodes; break; }
    }
    if (!out.length) out = geoCards();
    if (!out.length) { var mx2 = listMaxX(); out = A.qsa('li,[role="listitem"]').filter(function (el) { return looksLikeConversation(el) && el.getBoundingClientRect().right <= mx2 + 20; }).slice(0, 80); }
    var seen = {};
    out = out.filter(function (el) {
      var k = cardCacheKey(el);
      if (!k || k === 'n:|j:' || seen[k]) return false;
      seen[k] = 1;
      return true;
    });
    conversationCache = { at: now, items: out };
    return out.slice();
  }
  function findCard(identity) {
    var cards = conversationCards();
    for (var i = 0; i < cards.length; i++) if (identityMatches(identity, identityOf(cards[i]))) return cards[i];
    return null;
  }
  function panelRoot() {
    var sels = cfg().chatPanelSelectors || [];
    for (var i = 0; i < sels.length; i++) {
      var hits = A.qsa(sels[i]).filter(visible);
      for (var j = 0; j < hits.length; j++) {
        if (textOf(hits[j]).length >= 8) return hits[j];
      }
    }
    return null;
  }
  function activeCard() {
    var sels = cfg().activeConversationSelectors || [];
    for (var i = 0; i < sels.length; i++) {
      var hit = A.qsa(sels[i]).filter(visible)[0];
      if (hit) return hit;
    }
    return null;
  }
  function listRightEdge() {
    var cards = conversationCards();
    var r = cards.length ? cards[0].getBoundingClientRect() : null;
    return r && r.right ? r.right : window.innerWidth * 0.35;
  }
  function inList(el) {
    if (!el || !el.closest) return false;
    if (el.closest('#__hrs_ui__')) return true;
    var sels = cfg().conversationSelectors || [];
    for (var i = 0; i < sels.length; i++) { try { if (el.closest(sels[i])) return true; } catch (e) {} }
    return conversationCards().some(function (c) { return c.contains(el); });
  }
  // v1.9.8 处理顺序：新招呼 + 未读 → 全部 + 未读，「未读」始终保持勾选，绝不取消；2 分钟后回到新招呼 + 未读
  // v1.9.17 只处理「新招呼 + 未读」，不去「全部」
  var LPH = [{ top: '新招呼', unread: true }];
  var lmode = { phase: -1, step: 0, at: 0, work: 0 };
  function lpTab(name) {
    var re = name === '新招呼' ? /^新招呼[(（]?\d*\+?[)）]?$/ : /^全部[(（]?\d*\+?[)）]?$/;
    return A.qsa('span,div,a,li').filter(function (el) {
      if (el.children.length > 2 || (el.closest && el.closest('#__hrs_ui__'))) return false;
      var r = el.getBoundingClientRect();
      return r.width > 0 && r.top < 130 && re.test(textOf(el).replace(/\s+/g, ''));
    }).sort(function (a, b) { return a.getBoundingClientRect().top - b.getBoundingClientRect().top; })[0] || null;
  }
  function unreadBox() {
    var lab = A.qsa('span,label,div').filter(function (el) {
      var r = el.getBoundingClientRect();
      return el.children.length <= 2 && r.width > 0 && r.top < 260 && r.left < window.innerWidth * 0.45 && textOf(el).replace(/\s+/g, '') === '未读';
    })[0];
    if (!lab) return null;
    var wrap = lab.closest('label') || lab.parentElement;
    var inp = wrap && wrap.querySelector('input[type=checkbox]');
    var on = inp ? inp.checked : /checked|active/.test(String((wrap && wrap.className) || '') + String(lab.className || ''));
    return { el: inp || lab, on: on };
  }
  // v1.9.19 标签是不是选中状态：选中的标签字是彩色（或底色是彩色），没选中的是黑 / 灰
  function colored(el) {
    for (var i = 0, cur = el; i < 3 && cur && cur !== document.body; i++, cur = cur.parentElement) {
      var cs = getComputedStyle(cur);
      var spread = function (c) { var m = String(c || '').match(/\d+(\.\d+)?/g); if (!m || m.length < 3) return 0; if (m.length > 3 && parseFloat(m[3]) < 0.1) return 0; var a = m.slice(0, 3).map(Number); return Math.max.apply(null, a) - Math.min.apply(null, a); };
      if (spread(cs.color) > 40 || spread(cs.backgroundColor) > 12) return true;
    }
    return false;
  }
  function listOk() {
    var t = lpTab('新招呼'), u = unreadBox();
    var a = lpTab('全部');
    // v1.9.20 「全部」是彩色（选中）就一定不对，不管能不能读到「新招呼」
    if (a && colored(a) && !(t && colored(t))) return false;
    if (u && !u.on) return false;
    if (!t || !u) return null;
    return colored(t) && !!u.on;
  }
  // v1.9.20 切标签：点到真正可点的外层，再补一次真实鼠标点击
  function tabClick(el, check) {
    window.__hrsSelfListClick = Date.now();
    var target = el;
    for (var i = 0, cur = el; i < 4 && cur && cur !== document.body; i++, cur = cur.parentElement) {
      if (/^(A|LI|BUTTON|LABEL)$/.test(cur.tagName) || cur.getAttribute('role') === 'tab' || getComputedStyle(cur).cursor === 'pointer') { target = cur; break; }
    }
    try { realClick(target); } catch (e) {}
    setTimeout(function () {
      if (check && check()) { try { window.__hrsSelfListClick = Date.now(); trustedClick(target); } catch (e) {} }
    }, 900);
  }
  function lpStep(why) {
    var ph = LPH[lmode.phase];
    if (lmode.step === 0) {
      lmode.step = 1;
      var t = lpTab(ph.top);
      if (t) { tabClick(t, function () { var x = lpTab(ph.top); return !!x && !colored(x); }); A.uiLog('', '沟通列表切到「' + ph.top + '」' + (why ? '：' + why : '')); if (window.HRSRunLog) HRSRunLog.add({ mod: '智选', act: '切列表', target: ph.top, ok: true, via: 'script' }); return true; }
    }
    if (lmode.step === 1) {
      lmode.step = 2;
      var u = unreadBox();
      if (u && u.on !== ph.unread) { try { window.__hrsSelfListClick = Date.now(); if (u.el.tagName === 'INPUT') u.el.click(); else tabClick(u.el, function () { var v = unreadBox(); return !!v && v.on !== ph.unread; }); } catch (e) {} A.uiLog('', '　　' + (ph.unread ? '勾选' : '取消') + '「未读」'); return true; }
    }
    return false;
  }
  function lpGo(i, why) { lmode = { phase: i, step: 0, at: Date.now(), work: Date.now() }; return lpStep(why); }
  function beforeScan(ctx) {
    if (!isCommunicationPage()) return false;
    if (ctx.settings && ctx.settings.smartUnreadFirst === false) return false;
    if (lmode.phase < 0) return lpGo(0, '从新招呼的未读开始');
    if (lmode.step < 2) return lpStep('');
    // v1.9.8 原来按「连续 3 次扫描队列为空」判处理完，切换后队列先清空、页面一变就扫，1 秒内就跳走了。
    // 改为按时间：队列里还有人或正在处理就不动；这一页 20 秒没有新的人可处理，才算处理完
    // v1.9.20 不在「新招呼 + 未读」就切回去（10 秒内最多切一次），切回去之前不处理任何人
    if (!A.state.busy && listOk() === false && Date.now() - (lmode.fixAt || 0) > 10000) {
      var fa = Date.now(); lpGo(0, '当前不在新招呼 + 未读，切回去'); lmode.fixAt = fa; return true;
    }
    if (ctx.queue || A.state.busy) { lmode.work = Date.now(); return false; }
    var u = unreadBox();
    if (u && !u.on && u.el.tagName === 'INPUT') { lmode.step = 1; return lpStep('「未读」被取消了，重新勾上'); }
    var quiet = Date.now() - Math.max(lmode.at, lmode.work);
    if (quiet > 120000) return lpGo(0, '刷新新招呼的未读');
    return false;
  }
  var pane = window.HRSPane ? window.HRSPane.create({ listRightEdge: listRightEdge, inList: inList }) : null;
  function verifyConversation(identity) {
    if (!identity || !isCommunicationPage()) return false;
    var currentId = CT.chatIdFromUrl('liepin', location.href);
    if (identity.chatId && currentId && String(identity.chatId) !== String(currentId)) return false;
    var ac = activeCard();
    var activeName = ac ? nameOf(ac) : '';
    var headerName = firstText(panelRoot() || document, cfg().chatTitleSelectors || [], 40);
    var hasNameEvidence = false;
    if (activeName && identity.name && sameName(activeName, identity.name)) hasNameEvidence = true;
    if (headerName && identity.name && sameName(headerName, identity.name)) hasNameEvidence = true;
    // v1.9.0 兜底：列表右侧、页面上部有以这个名字开头的文字（猎聘头部「杨先生 今天活跃 …」）
    if (!hasNameEvidence && identity.name && pane && pane.headerHit(identity.name)) hasNameEvidence = true;
    if (activeName && identity.name && !sameName(activeName, identity.name) && headerName && !sameName(headerName, identity.name)) return false;
    if (identity.name && !hasNameEvidence) return false;
    if (!identity.name && !identity.chatId) return false;
    return true;
  }
  function waitConversation(identity, tries) {
    var n = 0;
    return (function next() {
      if (verifyConversation(identity)) return Promise.resolve(true);
      if (n++ >= (tries || 8)) return Promise.resolve(false);
      return A.sleep(350).then(next);
    })();
  }
  // v1.9.4 点卡片：点在姓名位置最里层的元素上，按真人点击的顺序派发事件（外层容器上可能没有点击处理）
  function clickPoint(card) {
    var nm = A.qsa('*', card).filter(function (el) { return !el.children.length && looksName(textOf(el)); })[0];
    var r = (nm || card).getBoundingClientRect();
    return { x: r.left + Math.min(r.width / 2, 40), y: r.top + r.height / 2 };
  }
  function realClick(card) {
    var p = clickPoint(card);
    var t = document.elementFromPoint ? document.elementFromPoint(p.x, p.y) : null;
    if (!t || !(card === t || card.contains(t))) t = card;
    ['pointerover', 'mouseover', 'pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click'].forEach(function (type) {
      try {
        var Ev = /^pointer/.test(type) && window.PointerEvent ? PointerEvent : MouseEvent;
        t.dispatchEvent(new Ev(type, { bubbles: true, cancelable: true, view: window, clientX: p.x, clientY: p.y, button: 0, buttons: /down/.test(type) ? 1 : 0 }));
      } catch (e) {}
    });
  }
  function trustedClick(card) {
    var p = clickPoint(card);
    // v1.9.8 沟通列表可能在内嵌页面里：真实鼠标点击要用最外层页面的坐标
    try {
      var w = window;
      while (w !== w.top && w.frameElement) { var fr = w.frameElement.getBoundingClientRect(); p.x += fr.left; p.y += fr.top; w = w.parent; }
    } catch (e) {}
    window.__hrsSelfTrustedAt = Date.now();
    return new Promise(function (resolve) {
      try { chrome.runtime.sendMessage({ type: 'TRUSTED_CLICK', x: Math.round(p.x), y: Math.round(p.y) }, function () { resolve(); }); } catch (e) { resolve(); }
    });
  }
  function openCard(card, identity) {
    if (!isCommunicationPage()) {
      A.log('拦截', '当前不是猎聘沟通页，已阻止从其他列表打开候选人');
      return Promise.resolve(false);
    }
    identity = identity || identityOf(card);
    if (verifyConversation(identity)) return Promise.resolve(true);
    var fresh = findCard(identity);
    if (!fresh) {
      A.log('拦截', '沟通列表中找不到 ' + (identity.name || identity.chatId || '目标候选人') + '，未执行任何跳转或发送');
      return Promise.resolve(false);
    }
    realClick(fresh);
    return waitConversation(identity, 8).then(function (ok) {
      if (ok) return true;
      try { fresh.scrollIntoView({ block: 'center' }); } catch (e2) {}
      realClick(fresh);
      return waitConversation(identity, 6).then(function (ok2) {
        if (ok2) return true;
        // 还不行：用真实鼠标点击（页面只认真人点击时）
        return trustedClick(fresh).then(function () { return waitConversation(identity, 8); }).then(function (ok3) {
          if (ok3) return true;
          // v1.9.8 记下右侧当时显示什么，写进跳过原因
          var body = textOf(document.body);
          var hn = firstText(panelRoot() || document, cfg().chatTitleSelectors || [], 40);
          A.state.lastVerifyWhy = /未选中会话/.test(body) ? '点了 3 种方式，右侧仍是「未选中会话」' : ('右侧显示的是「' + (hn || '读不到名字') + '」');
          return false;
        });
      });
    });
  }

  var hooks = {
    findFreshCard: function (identity) { conversationCache.at = 0; return findCard(identity); },
    // v1.9.10 列表上的沟通职位读得准：读到了但不在计划里的，不点开（点开会把未读变成已读）
    listJobReliable: true,
    listOk: listOk,
    // v1.9.18 会话里有没有我方发的消息：聊天区里靠右的气泡（右边贴着聊天区右侧、左边在聊天区三成以右）
    hasOutgoing: function () {
      var root = panelRoot();
      if (!root) return false;
      var rr = root.getBoundingClientRect(), head = rr.top + 120;
      return A.qsa('div,p,span,pre', root).some(function (el) {
        if (el.children.length > 3 || el.closest('#__hrs_ui__')) return false;
        var t = textOf(el); if (t.length < 6 || t.length > 600) return false;
        var r = el.getBoundingClientRect();
        if (!r.width || r.top < head || r.width > rr.width * 0.85) return false;
        if (/撤回|沟通职位|已读|未读|^\d{1,2}:\d{2}$/.test(t)) return false;
        return r.right > rr.right - 140 && r.left > rr.left + rr.width * 0.3;
      });
    },
    isCommunicationPage: isCommunicationPage,
    isConversationElement: function (el) {
      if (!el || !el.closest) return false;
      var sels = (cfg().conversationSelectors || []).concat(['li.geek-item', '.geek-item', '[class*="chat-item"]', '[class*="conversation-item"]', '[class*="message-item"]']);
      for (var i = 0; i < sels.length; i++) {
        try { if (el.closest(sels[i])) return true; } catch (e) {}
      }
      return false;
    },
    findCards: function () {
      if (!isCommunicationPage()) {
        A.state.lastCardSel = '已拦截：当前不是猎聘沟通页';
        return [];
      }
      var cards = conversationCards();
      A.state.lastCardSel = cards.length ? ('猎聘沟通会话（' + cards.length + '项）') : '未命中猎聘沟通会话卡片';
      if (cards.length && !A.state.lastExtract) A.state.lastExtract = textOf(cards[0]).slice(0, 80);
      return cards;
    },
    cardId: function (card) {
      var id = identityOf(card);
      return 'l_' + A.hash([id.chatId, id.name, id.jobText].join('|'));
    },
    getIdentity: identityOf,
    isReadCard: function (card) { return /(已读|已查看)/.test(textOf(card)); },
    identityMatches: identityMatches,
    extractText: function (card) { return textOf(card); },
    extractName: function (card) { return nameOf(card) || null; },
    openCard: openCard,
    verifyConversation: verifyConversation,
    assertConversation: verifyConversation,
    markRead: function (card, identity) {
      if (!verifyConversation(identity || identityOf(card))) return Promise.resolve(false);
      var c = cfg();
      if (c.autoMarkReadOnOpen) return Promise.resolve(true);
      var btn = A.firstQuery(c.markReadSelectors || [], panelRoot() || document);
      if (btn && btn.el) { try { btn.el.click(); return Promise.resolve(true); } catch (e) {} }
      return Promise.resolve(false);
    },
    sendMessage: function (card, text, identity) {
      identity = identity || identityOf(card);
      if (!verifyConversation(identity)) return Promise.resolve(false);
      var c = cfg(), root = panelRoot() || document;
      var input = A.firstQuery(c.inputSelectors || ['textarea'], root) || A.firstQuery(c.inputSelectors || ['textarea'], document);
      if (!input) return Promise.resolve(false);
      A.setNativeValue(input.el, text);
      return A.sleep(350).then(function () {
        if (!verifyConversation(identity)) return false;
        var sendBtn = A.firstQuery(c.sendSelectors || [], root) || findByText(root, ['发送'], 'button') || A.firstQuery(c.sendSelectors || [], document) || findByText(document, ['发送'], 'button');
        if (sendBtn && sendBtn.el) {
          try { sendBtn.el.click(); } catch (e) { return false; }
        } else {
          input.el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true }));
        }
        return A.sleep(350).then(function () {
          var still = verifyConversation(identity);
          var val = input.el.isContentEditable ? textOf(input.el) : String(input.el.value || '' );
          if (still && val && val.indexOf(text) >= 0) {
            input.el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true }));
            return A.sleep(500).then(function () {
              var still2 = verifyConversation(identity);
              var val2 = input.el.isContentEditable ? textOf(input.el) : String(input.el.value || '' );
              return still2 && (!val2 || val2.indexOf(text) < 0);
            });
          }
          return still && (!val || val.indexOf(text) < 0);
        });
      });
    },
    findRequestBtn: function (card, identity) {
      var c = cfg(), root = card || panelRoot() || document;
      if (!card && identity && !verifyConversation(identity)) return null;
      var hit = A.firstQuery(c.requestResumeSelectors || [], root);
      if (hit && hit.el && visible(hit.el)) return hit.el;
      return findByText(root, ['索取简历', '索要简历', '交换简历', '求简历', '申请简历'], 'button') ||
        findByText(root, ['索取简历', '索要简历', '交换简历', '求简历'], 'span');
    },
    getActiveIdentity: function () {
      var ac = activeCard();
      return ac ? identityOf(ac) : null;
    },
    getActiveRoot: function () { return panelRoot() || document; },
    // v1.9.35 用户手动点了沟通列表的标签 / 「未读」（插件自己点的 3 秒内不算）
    isListControl: function (el) {
      if (Date.now() - (window.__hrsSelfListClick || 0) < 3000) return false;
      for (var i = 0, cur = el; i < 4 && cur && cur !== document.body; i++, cur = cur.parentElement) {
        var r = cur.getBoundingClientRect();
        if (r.top > 280 || r.height > 60) continue;
        if (cur.tagName === 'INPUT' && cur.type === 'checkbox' && r.left < window.innerWidth * 0.45) return true;
        var t = String(cur.innerText || cur.textContent || '').replace(/\s+/g, '');
        if (/^(全部|新招呼(\(\d+\))?|未读|已读|沟通中|我发起的|我回复的|有简历|超级聊聊|不合适|约面试|已约面|已获取简历|已交换电话|已交换微信|更多|仅看未读)$/.test(t)) return true;
      }
      return false;
    },
    // v1.9.27 简历详情：点会话顶部卡片上的名字，猎聘新开简历页，后台读完关掉
    openDetail: function (identity) {
      var el = A.headerNameEl(identity && identity.name, listRightEdge() + 10);
      return A.readByNewPage(el);
    },
    getActiveText: function () { return textOf(panelRoot()); },
    beforeScan: beforeScan,
    onResume: function () { lmode.phase = -1; },
    getSummaryText: pane ? pane.summaryText : undefined,
    getWorkLines: pane ? pane.workLines : undefined,
    summaryDump: pane ? pane.dump : undefined,
    findResumeAttachments: function (identity) {
      if (!verifyConversation(identity || hooks.getActiveIdentity())) return [];
      var root = panelRoot() || document, nodes = [];
      (cfg().attachmentSelectors || []).forEach(function (sel) { nodes = nodes.concat(A.qsa(sel, root)); });
      var out = [], seen = {};
      nodes.forEach(function (el) {
        var href = el.href || el.getAttribute('data-url') || el.getAttribute('data-file-url') || '';
        var download = el.getAttribute && (el.getAttribute('download') || '');
        var text = textOf(el);
        if (!CT.isPdfAttachment(text, href, download)) return;
        var key = href || (norm(text) + '|' + norm(download));
        if (seen[key]) return;
        seen[key] = 1;
        out.push({ url: href, name: download || text || '候选人简历.pdf', text: text, node: el });
      });
      return out;
    },
    cardUrl: function (card) {
      var id = identityOf(card);
      return id.chatId ? CT.chatUrl('liepin', id.chatId) : null;
    },
    watch: function (cb) {
      var obs = new MutationObserver(function () { cb(); });
      obs.observe(document.body, { childList: true, subtree: true });
      return obs;
    },
    onEmpty: function () {
      var msg = isCommunicationPage() ? '当前沟通列表未找到可识别会话卡片' : '当前不是猎聘沟通页：只读不扫描';
      if (A.state.lastPageNotice === msg) return;
      A.state.lastPageNotice = msg;
      A.log('诊断', msg);
    }
  };

  new A.Engine('liepin', hooks).start();
})();
