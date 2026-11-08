/**
 * Boss直聘 站点适配（content/boss.js）
 * v1.1.0：仅扫描 /web/chat/index「沟通」会话，明确排除 /web/chat/recommend 推荐牛人。
 * v1.9.48：智选在 Boss 上的页面动作（切列表标签、选职位下拉、点开会话、点已读、打字、点发送 / 按回车）
 *          改由本机 RPA 助手用真实鼠标键盘完成（复用 v1.9.2 的 Python 助手）；判定、校验、话术、计数逻辑不变。
 *          设置里可切回旧版（脚本点击）。
 */
(function () {
  'use strict';
  if (window.__HRS_BOSS__) return;
  window.__HRS_BOSS__ = true;
  window.__HRS_SITE__ = 'boss';

  var A = window.__HRS_ENGINE_API__;
  var CT = window.HRSChatTarget;
  var cfg = function () { return A.state.siteConfig || (window.HRSSiteConfig && HRSSiteConfig.get('boss')) || {}; };

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
  // ---------- v1.9.48 RPA ----------
  function D() { return window.HRSDom; }
  function rpaOn() { return !!(A.rpaActive && A.rpaActive()); }
  // 会话卡片上「姓名」那一格：点姓名打开会话，避免点到卡片里的其他小按钮
  function nameEl(card) {
    var n = norm(nameOf(card));
    if (!n) return null;
    var hits = A.qsa('*', card).filter(function (el) {
      if (el.children.length > 1) return false;
      var r = el.getBoundingClientRect();
      return r.width > 6 && r.height > 6 && norm(textOf(el)) === n;
    });
    return hits.length ? hits[hits.length - 1] : null;
  }
  function rpaOpen(card) {
    var el = nameEl(card);
    return D().rpaClick(el || card, el ? null : { rel: [0.3 + Math.random() * 0.15, 0.35 + Math.random() * 0.25] }).then(function (r) {
      if (!r.ok) A.rpaNote(r);
      return r;
    });
  }
  // 点一下：RPA 模式用真实鼠标（返回 Promise<是否点成>），否则原来的 el.click()
  function act(el) {
    if (!el) return Promise.resolve(false);
    if (rpaOn()) return D().rpaClick(el).then(function (r) { if (!r.ok) A.rpaNote(r); return !!r.ok; });
    try { el.click(); return Promise.resolve(true); } catch (e) { return Promise.resolve(false); }
  }

  function isCommunicationPage() { return !!(CT && CT.isCommunicationUrl('boss', location.href)); }
  function isRecommendPage() { return /^\/web\/chat\/recommend(?:\/|$)/i.test(location.pathname); }
  function autoSwitchToCommunication() {
    if (!isRecommendPage()) return false;
    var now = Date.now();
    if (A.state.communicationRedirectAt && now - A.state.communicationRedirectAt < 10000) return true;
    A.state.communicationRedirectAt = now;
    // v1.6.0 推荐牛人页留给「打招呼」功能使用，这里不再自动跳转，只是不扫描
    return true;
  }

  function chatIdOf(card) {
    if (!card) return '';
    var own = attrByNames(card, ['data-chatid', 'data-chat-id', 'data-conversation-id', 'data-uid', 'data-id', 'data-geek-id']);
    if (own && !/^chat[-_]/i.test(own)) return own;
    var inner = A.qs('[data-chatid],[data-chat-id],[data-conversation-id],[data-uid],[data-geek-id]', card);
    var v = attrByNames(inner, ['data-chatid', 'data-chat-id', 'data-conversation-id', 'data-uid', 'data-geek-id']);
    if (v) return v;
    var links = card.querySelectorAll('a[href]');
    for (var i = 0; i < links.length; i++) {
      var id = CT.chatIdFromUrl('boss', links[i].href);
      if (id) return id;
      var m = String(links[i].href || '').match(/[?&]lid=([^&#]+)/i);
      if (m) return decodeURIComponent(m[1]);
    }
    return '';
  }
  function nameOf(card) {
    var n = firstText(card, cfg().nameSelectors || [], 20);
    if (n && !/^(在线|刚刚|今天|昨天|沟通中)$/.test(n)) return n;
    var t = textOf(card);
    var guessed = window.HRSExtractor ? (window.HRSExtractor.guessName(t) || '') : '';
    if (guessed) return guessed;
    var lines = t.split(/\n+/).map(function (x) { return x.trim(); }).filter(Boolean);
    for (var i = 0; i < Math.min(lines.length, 4); i++) {
      var m = lines[i].match(/^([\u4e00-\u9fa5·]{2,12})$/);
      if (m && !/^(刚刚活跃|在线|离线|沟通中|已读|未读|新招呼)$/.test(m[1])) return m[1];
    }
    return '';
  }
  function jobTextOf(card) {
    var selectors = cfg().jobSelectors || [];
    var parts = [];
    for (var i = 0; i < selectors.length; i++) {
      A.qsa(selectors[i], card).slice(0, 2).forEach(function (el) {
        var t = textOf(el).replace(/\s+/g, ' ').trim();
        if (t && t.length <= 60 && parts.indexOf(t) < 0) parts.push(t);
      });
    }
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
  function isReadCard(card) {
    var t = textOf(card);
    return /[[【(]\s*已读\s*[\]】)]|\b已读\b/.test(t);
  }
  function identityOf(card) {
    var name = nameOf(card);
    var chatId = chatIdOf(card) || '';
    var jobText = jobTextOf(card);
    return {
      site: 'boss',
      name: name,
      chatId: chatId,
      jobText: jobText,
      isRead: isReadCard(card),
      key: [chatId || '', name || '', jobText || ''].join('|')
    };
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
    if (t.length < 5 || t.length > 500) return false;
    if (!nameOf(el)) return false;
    return /(\d{1,2}:\d{2}|\d{1,2}月\d{1,2}日|\d{1,2}分钟前|昨天|今天|刚刚|你好|您好|简历|沟通)/.test(t) || !!el.querySelector('img');
  }

  var conversationCache = { at: 0, items: [] };
  function conversationCards() {
    if (!isCommunicationPage()) return [];
    var now = Date.now();
    if (conversationCache.at && now - conversationCache.at < 1800) return conversationCache.items.slice();
    var sels = (cfg().conversationSelectors || []).concat([
      'li.geek-item', '.geek-item', 'li[class*="chat-item"]', '[class*="conversation-item"]'
    ]);
    var out = [];
    for (var i = 0; i < sels.length; i++) {
      var nodes = A.qsa(sels[i]).filter(function (el) { return looksLikeConversation(el); });
      if (nodes.length) { out = nodes; break; }
    }
    if (!out.length) {
      out = A.qsa('li,[role="listitem"],[data-id],[data-chat-id],[data-conversation-id],[class*="chat-list-item"],[class*="message-item"]').filter(looksLikeConversation).slice(0, 80);
    }
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
  function inListOrOverlay(el) {
    if (!el || !el.closest) return false;
    if (el.closest('#__hrs_ui__')) return true;
    var sels = (cfg().conversationSelectors || []).concat(['li.geek-item', '.geek-item', '[class*="chat-item"]', '[class*="conversation-item"]']);
    for (var i = 0; i < sels.length; i++) { try { if (el.closest(sels[i])) return true; } catch (e) {} }
    return false;
  }
  // v1.2.1：右侧会话头部姓名。只认会话列表以外的元素，避免把左侧第一张卡片的名字当成当前会话。
  function currentHeaderName() {
    var sels = (cfg().chatTitleSelectors || []).concat(['[class*="chat-header"] [class*="name"]', '[class*="conversation-header"] [class*="name"]', '[class*="chat-title"]']);
    for (var i = 0; i < sels.length; i++) {
      var els = A.qsa(sels[i]);
      for (var j = 0; j < els.length; j++) {
        if (inListOrOverlay(els[j])) continue;
        var t = textOf(els[j]).replace(/\s+/g, ' ').trim();
        if (t && t.length <= 40) return t;
      }
    }
    return '';
  }
  function listRightEdge() {
    var cards = conversationCards();
    var r = cards.length ? cards[0].getBoundingClientRect() : null;
    return r && r.right ? r.right : window.innerWidth * 0.4;
  }
  /**
   * 兜底证据：在会话列表右侧、页面上部区域，找一个文本以候选人姓名开头的短元素。
   * Boss 改版后头部 class 经常变，这一步不依赖任何 class。
   */
  function rightPaneHeaderHit(name) {
    var n = norm(name);
    if (!n || n.length < 2) return null;
    var edge = listRightEdge();
    var els = A.qsa('span,div,h1,h2,h3,h4,p,a,b,strong');
    for (var i = 0; i < els.length; i++) {
      var el = els[i];
      var t = textOf(el);
      if (!t || t.length > 30) continue;
      var nt = norm(t);
      if (nt.indexOf(n) !== 0) continue;
      if (inListOrOverlay(el)) continue;
      var r = el.getBoundingClientRect();
      if (!r.width || !r.height || r.left < edge - 2 || r.top > 320) continue;
      return { text: t, cls: String(el.className || ''), top: Math.round(r.top), left: Math.round(r.left) };
    }
    return null;
  }
  function headerDump() {
    var edge = listRightEdge();
    var out = [];
    A.qsa('span,div,h1,h2,h3,h4,p,a,b,strong').forEach(function (el) {
      if (out.length >= 25 || inListOrOverlay(el) || el.children.length > 3) return;
      var t = textOf(el).replace(/\s+/g, ' ');
      if (!t || t.length > 30) return;
      var r = el.getBoundingClientRect();
      if (!r.width || r.left < edge - 2 || r.top > 320) return;
      out.push({ text: t, tag: el.tagName.toLowerCase(), cls: String(el.className || '').slice(0, 80), top: Math.round(r.top) });
    });
    return out;
  }
  /**
   * v1.4.0 读取右侧顶部简历摘要（姓名、年龄、经验、学历、工作经历、教育、沟通职位、期望）。
   * 不依赖 class：先在列表右侧、页面上部找一个锚点（「沟通职位」「期望」「NN岁」「N年以上」），
   * 再往外层找，直到再往外就会把会话列表或大段聊天记录包进来为止。
   */
  /**
   * v1.5.1 顶部简历摘要可能分成几块（姓名那一行、工作经历和教育、沟通职位和期望），
   * 而且彼此不一定在同一个小容器里。做法：找出列表右侧、页面上部的所有锚点，
   * 每个锚点各自往外扩到「再往外就会包进会话列表或大段聊天」为止，最后把这些块去重拼起来。
   * 锚点：沟通职位 / 期望 / NN岁 / N年以上 / 工作时间段（如 2023.06-至今、2024-2025）
   */
  var ANCHOR_RE = /^(沟通职位|期望|\d{2}岁|\d{1,2}年以上|\d{1,2}年|应届生|(?:19|20)\d{2}(?:\.\d{1,2})?[-–~至](?:至今|(?:19|20)\d{2}(?:\.\d{1,2})?))[:：]?$/;
  function growBlock(el, edge, cards) {
    var best = el, cur = el.parentElement;
    while (cur && cur !== document.body) {
      if (inListOrOverlay(cur)) break;
      var cr = cur.getBoundingClientRect();
      if (cr.left < edge - 2 || cr.height > 380) break;
      if (cards.some(function (c) { return cur.contains(c); })) break;
      best = cur;
      cur = cur.parentElement;
    }
    return best;
  }
  function summaryBlocks() {
    var edge = listRightEdge();
    var cards = conversationCards();
    var blocks = [];
    A.qsa('span,div,label,em,p,b,i,li,td').forEach(function (el) {
      if (el.children.length > 2) return;
      var t = textOf(el).replace(/\s+/g, '');
      if (!t || t.length > 24 || !ANCHOR_RE.test(t)) return;
      if (inListOrOverlay(el)) return;
      var r = el.getBoundingClientRect();
      if (!r.width || r.left < edge - 2 || r.top > 400) return;
      if (blocks.some(function (b) { return b.contains(el); })) return;
      var blk = growBlock(el, edge, cards);
      // 新块包含了旧块就替换掉旧块
      blocks = blocks.filter(function (b) { return !blk.contains(b); });
      if (!blocks.some(function (b) { return b.contains(blk); })) blocks.push(blk);
    });
    // 按页面上的先后顺序拼接
    blocks.sort(function (x, y) { return x.compareDocumentPosition(y) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1; });
    return blocks;
  }

  /**
   * v1.5.2 工作经历按「行」读：以每个时间段文字为准，把同一水平线上、它右边紧挨着的文字拼起来。
   * 不依赖 DOM 嵌套，也不依赖「·」是不是真实文字（Boss 有时用样式画出来）。
   * 遇到间隔超过 80px 或「沟通职位 / 期望」就停，避免把右栏拼进来。
   */
  var DATE_RE = /^(?:19|20)\d{2}(?:\s*\.\s*\d{1,2})?\s*[-–—－~至]\s*(?:至今|今|(?:19|20)\d{2}(?:\s*\.\s*\d{1,2})?)$/;
  function workLines() {
    var edge = listRightEdge();
    var all = A.qsa('span,div,label,em,p,b,i,a,li,td');
    var leaves = all.filter(function (el) {
      if (el.children.length) return false;
      if (inListOrOverlay(el)) return false;
      var t = textOf(el);
      if (!t) return false;
      var r = el.getBoundingClientRect();
      return r.width > 0 && r.left >= edge - 2 && r.top <= 420;
    });
    var dates = A.qsa('span,div,label,em,p,b,i,a,li,td').filter(function (el) {
      if (inListOrOverlay(el) || el.children.length > 3) return false;
      var r = el.getBoundingClientRect();
      return r.width > 0 && r.width < 300 && r.left >= edge - 2 && r.top <= 420 && DATE_RE.test(textOf(el).replace(/\s+/g, ''));
    });
    dates = dates.filter(function (el) { return !dates.some(function (o) { return o !== el && el.contains(o); }); });
    var out = [];
    dates.forEach(function (d) {
      var dr = d.getBoundingClientRect(), mid = dr.top + dr.height / 2;
      var row = leaves.filter(function (el) {
        if (el === d || d.contains(el)) return false;
        var r = el.getBoundingClientRect();
        return r.left >= dr.right - 2 && Math.abs(r.top + r.height / 2 - mid) <= 8;
      }).sort(function (x, y) { return x.getBoundingClientRect().left - y.getBoundingClientRect().left; });
      var parts = [], lastRight = dr.right;
      for (var i = 0; i < row.length; i++) {
        var r = row[i].getBoundingClientRect(), t = textOf(row[i]).trim();
        if (/^(沟通职位|期望)/.test(t) || r.left - lastRight > 80) break;
        if (!/^[·•・|｜\s]*$/.test(t)) parts.push(t.replace(/^[·•・\s]+|[·•・\s]+$/g, ''));
        lastRight = r.right;
      }
      // 用「 · 」连接，第一段就是公司名（Boss 的「·」有时是样式画的，文字里没有）
      var line = parts.filter(Boolean).join(' · ').replace(/\s+/g, ' ').trim();
      if (line) out.push(textOf(d).replace(/\s+/g, '') + ' ' + line);
    });
    return out;
  }
  function summaryText() {
    return summaryBlocks().map(function (b) { return textOf(b).replace(/[ \t]+/g, ' ').trim(); })
      .filter(Boolean).join('\n').slice(0, 3000);
  }

  /**
   * v1.8.1 智选先处理「未读」：沟通列表上方「全部 / 未读」两个标签。
   * 先切到「未读」逐个处理；未读里没有要处理的了，切回「全部」处理已读但还没回复的；
   * 在「全部」待满 2 分钟、手上没活时，再切回「未读」看有没有新消息。
   */
  // v1.8.4 每次开始 / 继续：先「新招呼 + 未读」，处理完 →「全部 + 未读」→「全部 + 全部」，2 分钟后再回到「新招呼 + 未读」
  // v1.9.17 只处理「新招呼 + 未读」：「全部」里的未读多是别人回过简历等，再去处理会重复要简历
  var PHASES = [{ top: '新招呼', sub: '未读' }];
  var listMode = { phase: -1, step: 0, at: 0, idle: 0 };
  function tabsNamed(re) {
    return A.qsa('span,div,a,li,label').filter(function (el) {
      if (el.children.length > 2 || inListOrOverlay(el)) return false;
      var t = textOf(el).replace(/\s+/g, '');
      if (!re.test(t)) return false;
      var r = el.getBoundingClientRect();
      return r.width > 0 && r.top < 300;
    }).sort(function (a, b) { return a.getBoundingClientRect().top - b.getBoundingClientRect().top; });
  }
  // 顶部大标签（全部 / 新招呼(23) / 沟通中…）在上面一行；列表上方「全部 / 未读」小标签在下面一行
  function topTab(name) {
    var re = name === '新招呼' ? /^新招呼(\(\d+\))?$/ : new RegExp('^' + name + '$');
    var c = tabsNamed(re);
    return c.length ? c[0] : null;
  }
  function subTab(name) {
    var c = tabsNamed(new RegExp('^' + name + '$'));
    if (!c.length) return null;
    var edge = listRightEdge();
    var inList = c.filter(function (el) { return el.getBoundingClientRect().left < edge + 4; });
    return (inList.length ? inList : c)[(inList.length ? inList : c).length - 1];
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
  // 当前是不是「新招呼 + 未读」：读不出来返回 null（不拦）
  function listOk() {
    var t = topTab('新招呼'), u = subTab('未读'), all = subTab('全部');
    if (!t || !u) return null;
    var tOn = colored(t), uOn = colored(u), aOn = all ? colored(all) : false;
    if (uOn && aOn) return null;   // 两个都像选中，判断不了
    return tOn && uOn;
  }
  // v1.9.48 RPA 模式：真点成了才写日志；RPA 暂时用不了（助手没开、你在用鼠标）时按它给的等待时间停下来再试，不每 4 秒重复点
  var tabBusy = false;
  function clickTab(el, msg) {
    window.__hrsSelfListClick = Date.now();
    if (rpaOn()) {
      tabBusy = true;
      var stepAt = listMode.step;
      D().rpaClick(el).then(function (r) {
        tabBusy = false;
        if (r.ok) { if (msg) A.uiLog('', msg); return; }
        A.rpaNote(r);
        if (listMode.step === stepAt) listMode.step = Math.max(0, stepAt - 1);
        listMode.holdUntil = Date.now() + Math.max(5, Math.min(120, (r.wait || 10))) * 1000;
      });
      return true;
    }
    try { el.click(); } catch (e) { return false; }
    if (msg) A.uiLog('', msg);
    return true;
  }
  function applyStep(why) {
    var ph = PHASES[listMode.phase];
    if (listMode.step === 0) {
      listMode.step = 1;
      var t = topTab(ph.top);
      if (t && clickTab(t, '沟通列表切到「' + ph.top + '」' + (why ? '：' + why : ''))) return true;
    }
    if (listMode.step === 1) {
      listMode.step = 2;
      var s2 = subTab(ph.sub);
      if (s2 && clickTab(s2, '　　并切到「' + ph.sub + '」')) return true;
    }
    return false;
  }
  function goPhase(i, why) { listMode = { phase: i, step: 0, at: Date.now(), idle: 0 }; return applyStep(why); }
  function beforeScan(ctx) {
    if (!isCommunicationPage()) return false;
    if (tabBusy) return true;   // v1.9.48 RPA 还在点列表标签
    if (listMode.holdUntil && Date.now() < listMode.holdUntil) return true;   // v1.9.48 RPA 暂时用不了，等一会儿
    if (ctx.settings && ctx.settings.smartUnreadFirst === false) return false;
    if (listMode.phase < 0) return goPhase(0, '从新招呼的未读开始');
    if (listMode.step < 2) return applyStep('');
    // v1.9.19 不在「新招呼 + 未读」（被手动切走、或上次没切成功）：先切回去，最多 10 秒试一次
    if (listOk() === false && Date.now() - (listMode.fixAt || 0) > 10000) { var fa = Date.now(); goPhase(0, '当前不在新招呼 + 未读，切回去'); listMode.fixAt = fa; return true; }
    // v1.9.43 按职位逐个处理
    if (ctx.settings.smartByJob !== false) {
      var js = jobStep(ctx);
      if (js || jobTrigger()) return js;
    }
    // 连续 3 轮（约 12 秒）没有新的要处理的人，就算这一页处理完了
    if (ctx.queue) listMode.idle = 0; else listMode.idle++;
    if (listMode.idle >= 3 && listMode.phase < PHASES.length - 1) {
      return goPhase(listMode.phase + 1, listMode.phase === 0 ? '新招呼的未读处理完了' : '未读处理完了，再看已读未回复的');
    }
    if (!ctx.queue && Date.now() - listMode.at > 120000) return goPhase(0, '刷新新招呼的未读');
    return false;
  }
  // ---------- v1.9.43 按职位逐个处理：列表上方「全部职位」下拉，按今日计划顺序一个职位一个职位切 ----------
  var JOB_RE = /^全部职位$|^.{2,40}?_[\u4e00-\u9fa5]{2,8}\d+(?:\.\d+)?-\d+(?:\.\d+)?[Kk万]/;
  var jobMode = { busy: false, at: 0, idleSince: 0, restUntil: 0, failAt: 0, cur: '' };
  function nt(s) { return String(s || '').replace(/\s+/g, ''); }
  // v2.3.0 运行记录：切职位成功 / 失败
  function runJob(target, ok, r) {
    if (!window.HRSRunLog) return;
    r = r || {};
    HRSRunLog.add({ mod: '智选', act: '切职位', target: target, ok: ok, code: r.code, why: r.why, via: rpaOn() ? 'rpa' : 'script' });
  }
  function lastFail(t0, why) {
    var f = D() && D().lastFailSince ? D().lastFailSince(t0) : null;
    return f ? { code: f.code, why: f.why } : { code: '', why: why };
  }
  function jobTrigger() {
    var edge = listRightEdge();
    var c = A.qsa('div,span,input,p').filter(function (el) {
      if (inListOrOverlay(el) || el.children.length > 3) return false;
      var r = el.getBoundingClientRect();
      if (!r.width || r.left > edge || r.top > 240 || r.top < 60) return false;
      var t = el.tagName === 'INPUT' ? (el.value || '') : textOf(el);
      return JOB_RE.test(nt(t));
    });
    c.sort(function (a, b) { var ra = a.getBoundingClientRect(), rb = b.getBoundingClientRect(); return ra.width * ra.height - rb.width * rb.height; });
    return c[0] || null;
  }
  // v2.2.3 修：下拉里的单个职位行高度只有 30 多像素，被 visible()（要求高 36 以上）全部过滤掉，
  // 只剩整个下拉框容器。容器的文字是「全部职位 + 所有职位」连在一起，旧的正则只比开头也能对上，
  // 于是插件去点了整个下拉框，切不过去，日志里打出一长串职位名。
  // 现在：选项用宽松的可见判断；一个选项里只能有一个「_城市 薪资」，容器自动排除；验证时按计划岗位比对。
  function optVisible(el) {
    if (!el || !el.isConnected) return false;
    var r = el.getBoundingClientRect(), st = getComputedStyle(el);
    return r.width > 20 && r.height > 10 && st.display !== 'none' && st.visibility !== 'hidden' && parseFloat(st.opacity || '1') > 0.05;
  }
  function oneJob(t) {
    if (t === '全部职位') return true;
    if (!JOB_RE.test(t) || /^全部职位./.test(t)) return false;
    return (t.match(/_[\u4e00-\u9fa5]{2,8}(?:\d|面议)/g) || []).length === 1;
  }
  function jobOptions(tr) {
    var tb = tr.getBoundingClientRect(), seen = {};
    return A.qsa('li,div,span,a,p').filter(function (el) {
      if (el === tr || el.contains(tr) || tr.contains(el) || el.closest('#__hrs_ui__') || el.children.length > 3) return false;
      if (!optVisible(el)) return false;
      var r = el.getBoundingClientRect();
      if (r.top < tb.bottom - 4 || r.left > tb.right + 40 || r.right < tb.left - 40) return false;
      var t = nt(textOf(el));
      if (!oneJob(t) || seen[t]) return false;
      seen[t] = 1;
      return true;
    });
  }
  function planIndexOf(text) {
    var hit = A.planJdFor(text);
    if (!hit || !hit.ok) return -1;
    var list = A.plannedJds();
    for (var i = 0; i < list.length; i++) if (list[i].id === hit.jd.id) return i;
    return -1;
  }
  function closeDropdown() {
    if (rpaOn()) return D().rpaKey('escape');   // v1.9.48 真实键盘按 Esc 收起下拉
    try { document.body.dispatchEvent(new MouseEvent('click', { bubbles: true })); } catch (e) {} ['keydown', 'keyup'].forEach(function (t) { document.dispatchEvent(new KeyboardEvent(t, { key: 'Escape', code: 'Escape', keyCode: 27, bubbles: true })); });
    return Promise.resolve();
  }
  // 打开下拉，选「当前职位之后」计划里的下一个职位；都处理过了就停在最后一个，2 分钟后从第一个再来
  function selectNextJob(why, fromStart) {
    var tr = jobTrigger();
    if (!tr) return;
    jobMode.busy = true;
    var curT = nt(textOf(tr) || tr.value);
    window.__hrsSelfListClick = Date.now();
    var t0 = Date.now();
    return act(tr).then(function () { return A.sleep(900); }).then(function () {
      var opts = jobOptions(tr);
      if (!opts.length) { var p = tr.closest('[class*="select"],[class*="dropdown"]') || tr.parentElement; window.__hrsSelfListClick = Date.now(); return act(p).then(function () { return A.sleep(900); }).then(function () { return jobOptions(tr); }); }
      return opts;
    }).then(function (opts) {
      // v1.9.48 RPA 让位（你在用鼠标 / 助手没开）：这次不切，30 秒后再试，不算「下拉里没有计划职位」
      var held = rpaOn() && D().rpaHeldSince(t0);
      if (held && !opts.length) { jobMode.failAt = Date.now(); runJob('打开职位下拉', false, { code: held.code, why: held.why }); return 'held'; }
      return opts;
    }).then(function (opts) {
      if (opts === 'held') return;
      var ranked = opts.map(function (el) { return { el: el, t: nt(textOf(el)), i: planIndexOf(textOf(el)) }; })
        .filter(function (o) { return o.i >= 0; }).sort(function (a, b) { return a.i - b.i; });
      if (!ranked.length) {
        closeDropdown();
        if (!jobMode.warned) { A.uiLog('warn', '职位下拉里没有今日计划的职位（或读不到下拉选项），按「全部职位」处理'); runJob('今日计划的职位', false, lastFail(t0, '职位下拉里没有今日计划的职位，或读不到下拉选项')); }
        jobMode.warned = true; jobMode.failAt = Date.now();
        return;
      }
      var curI = fromStart ? -1 : planIndexOf(curT);
      var next = ranked.filter(function (o) { return o.i > curI; })[0];
      if (!next) {
        closeDropdown();
        jobMode.restUntil = Date.now() + 120000;
        A.uiLog('pass', '今日计划的职位都处理完了，2 分钟后从第一个职位再看一遍新消息');
        return;
      }
      window.__hrsSelfListClick = Date.now();
      return act(next.el).then(function () { return A.sleep(1500); }).then(function () {
        var now = jobTrigger();
        var nowT = now ? nt(textOf(now) || now.value) : '';
        var ok = !!now && (nowT === next.t || (oneJob(nowT) && planIndexOf(nowT) === next.i));
        if (ok) { jobMode.cur = next.t; A.uiLog('', '职位筛选切到「' + textOf(next.el).trim() + '」' + (why ? '：' + why : '')); runJob(textOf(next.el).trim(), true); }
        else { A.uiLog('warn', '职位筛选没切过去（' + textOf(next.el).trim() + '），稍后再试'); jobMode.failAt = Date.now(); runJob(textOf(next.el).trim(), false, lastFail(t0, '点了职位选项，下拉显示的还不是这个职位')); }
      });
    }).then(function () { jobMode.busy = false; jobMode.at = Date.now(); jobMode.idleSince = 0; }, function () { jobMode.busy = false; jobMode.failAt = Date.now(); });
  }
  function jobStep(ctx) {
    if (jobMode.busy) return true;
    var tr = jobTrigger();
    if (!tr) return false;
    if (Date.now() - jobMode.failAt < 30000) return false;
    var now = Date.now(), curT = nt(textOf(tr) || tr.value);
    if (jobMode.restUntil) {
      if (now < jobMode.restUntil) return false;
      jobMode.restUntil = 0;
      selectNextJob('重新从第一个职位看新消息', true);
      return true;
    }
    if (planIndexOf(curT) < 0) { selectNextJob(curT === '全部职位' ? '按今日计划的职位逐个处理' : '当前职位不在今日计划'); return true; }
    if (ctx.queue) { jobMode.idleSince = 0; return false; }
    if (!jobMode.idleSince) jobMode.idleSince = now;
    if (now - jobMode.idleSince >= 8000 && now - jobMode.at >= 8000) { selectNextJob('上一个职位的未读处理完了'); return true; }
    return false;
  }
  function onResume() { listMode.phase = -1; jobMode.restUntil = 0; jobMode.idleSince = 0; }
  // v2.3.0 运行记录页的「休息中」：计划职位都看完了，等 2 分钟再从第一个看
  function restInfo() {
    if (jobMode.restUntil && jobMode.restUntil > Date.now()) return { until: jobMode.restUntil, why: '计划职位都处理完了，约 ' + Math.ceil((jobMode.restUntil - Date.now()) / 1000) + ' 秒后从第一个职位再看新消息' };
    return null;
  }

  /** 会话校验失败时的自诊断：记录插件此刻看到了什么，写入「设置 · 排错 · 查看诊断日志」。 */
  function diagnoseConversation(identity) {
    var ac = activeCard();
    var info = {
      at: new Date().toISOString(),
      version: (chrome.runtime.getManifest && chrome.runtime.getManifest().version) || '',
      url: location.href,
      target: { name: identity && identity.name || '', chatId: identity && identity.chatId || '', jobText: identity && identity.jobText || '' },
      urlChatId: CT.chatIdFromUrl('boss', location.href) || '',
      activeCardName: ac ? nameOf(ac) : '',
      activeCardClass: ac ? String(ac.className || '').slice(0, 120) : '',
      headerName: currentHeaderName(),
      rightPaneHit: identity && identity.name ? rightPaneHeaderHit(identity.name) : null,
      rightPaneTexts: headerDump()
    };
    A.send({ type: 'DIAG_LOG', data: info });
    var why = !info.activeCardName && !info.headerName ? '读不到左侧选中卡片和右侧头部姓名'
      : '左侧选中「' + (info.activeCardName || '无') + '」，右侧头部「' + (info.headerName || '无') + '」';
    return why;
  }
  // v1.9.49 地址栏里的 chatId 只有在右侧真的打开着会话时才算数。
  // Boss 网页端不支持用 ?chatId= 直接打开某个人：从人才库带 chatId 打开时，右侧是「未选中联系人」，
  // 但地址栏一直留着这个 chatId。原来据此认定「这个人已经打开了」（不点就算成功），
  // 而且之后点开别人时又因为 chatId 对不上，把每个人都判成「没能确认是这个人」。
  function liveUrlChatId() {
    var id = CT.chatIdFromUrl('boss', location.href);
    if (!id) return '';
    var header = currentHeaderName();
    if (!header) return '';
    var cards = conversationCards();
    for (var j = 0; j < cards.length; j++) {
      var cid = chatIdOf(cards[j]);
      if (cid && String(cid) === String(id)) return sameName(nameOf(cards[j]), header) ? id : '';
    }
    return '';
  }
  function activeCard() {
    var sels = cfg().activeConversationSelectors || [];
    for (var i = 0; i < sels.length; i++) {
      var hit = A.qsa(sels[i]).filter(visible)[0];
      if (hit) return hit;
    }
    var currentId = liveUrlChatId();
    var cards = conversationCards();
    if (currentId) {
      for (var j = 0; j < cards.length; j++) {
        var cid = chatIdOf(cards[j]);
        if (cid && String(cid) === String(currentId)) return cards[j];
      }
    }
    var header = currentHeaderName();
    if (header) {
      for (var k = 0; k < cards.length; k++) {
        if (sameName(nameOf(cards[k]), header)) return cards[k];
      }
    }
    return null;
  }
  function verifyConversation(identity) {
    if (!identity || !isCommunicationPage()) return false;
    var currentId = liveUrlChatId();   // v1.9.49 只认右侧真打开着的会话
    if (identity.chatId && currentId && String(identity.chatId) !== String(currentId)) return false;
    if (identity.manualTrusted && A.state.activeConversation && identityMatches(identity, A.state.activeConversation)) return true;
    var ac = activeCard();
    var activeName = ac ? nameOf(ac) : '';
    var headerName = currentHeaderName();
    var hasNameEvidence = false;
    if (activeName && identity.name && sameName(activeName, identity.name)) hasNameEvidence = true;
    if (headerName && identity.name && sameName(headerName, identity.name)) hasNameEvidence = true;
    if (!hasNameEvidence && identity.name && rightPaneHeaderHit(identity.name)) hasNameEvidence = true;
    if (activeName && identity.name && !sameName(activeName, identity.name) && headerName && !sameName(headerName, identity.name)) return false;
    if (identity.name && !hasNameEvidence) return false;
    if (!identity.name && !identity.chatId) return false;
    return true;
  }
  function shouldReplyToCandidate() {
    var root = panelRoot();
    if (!root) return null;
    var rootRect = root.getBoundingClientRect();
    var nodes = A.qsa('[class*="message-item"],[class*="message-body"],[class*="msg-item"],[class*="chat-message"],[class*="message"]', root).filter(function (el) {
      if (!visible(el)) return false;
      var t = textOf(el);
      if (!t || t.length > 500) return false;
      var r = el.getBoundingClientRect();
      return !rootRect.width || r.width < rootRect.width * 0.9;
    });
    if (!nodes.length) return null;
    var el = nodes[nodes.length - 1];
    var t = textOf(el);
    if (/向您发起了沟通|牛人.*向您|候选人.*发起|对方正在输入/.test(t)) return true;
    var cls = String(el.className || '') + ' ' + String((el.parentElement && el.parentElement.className) || '');
    if (/mine|self|right|send|outgoing|from-me|is-me|我的/.test(cls)) return false;
    if (/friend|geek|receive|incoming|left|from-user/.test(cls)) return true;
    var r = el.getBoundingClientRect();
    if (rootRect.width) {
      var center = r.left + r.width / 2;
      if (center > rootRect.left + rootRect.width * 0.58) return false;
      if (center < rootRect.left + rootRect.width * 0.42) return true;
    }
    return null;
  }
  function waitConversation(identity, tries) {
    var n = 0;
    return (function next() {
      if (verifyConversation(identity)) return Promise.resolve(true);
      if (n++ >= (tries || 8)) return Promise.resolve(false);
      return A.sleep(350).then(next);
    })();
  }
  function openCard(card, identity) {
    if (!isCommunicationPage()) {
      A.log('拦截', '当前不是 Boss「沟通」页，已阻止从推荐牛人页打开候选人');
      return Promise.resolve(false);
    }
    identity = identity || identityOf(card);
    if (verifyConversation(identity)) return Promise.resolve(true);
    var fresh = findCard(identity);
    if (!fresh) {
      A.log('拦截', '沟通列表中找不到 ' + (identity.name || identity.chatId || '目标候选人') + '，未执行任何跳转或发送');
      return Promise.resolve(false);
    }
    if (rpaOn()) {
      // v1.9.48 真实鼠标点姓名打开会话；没打开再点一次
      var t0 = Date.now();
      return rpaOpen(fresh).then(function (r) {
        if (!r.ok) return false;
        return waitConversation(identity, 10);
      }).then(function (ok) {
        if (ok || D().rpaHeldSince(t0)) return ok;
        var again = findCard(identity);
        if (!again) return false;
        return rpaOpen(again).then(function (r) { return r.ok ? waitConversation(identity, 8) : false; });
      }).then(function (ok) {
        if (!ok && !D().rpaHeldSince(t0)) A.state.lastVerifyWhy = diagnoseConversation(identity);
        return ok;
      });
    }
    try { fresh.click(); } catch (e) {}
    return waitConversation(identity, 8).then(function (ok) {
      if (!ok) {
        try { fresh.scrollIntoView({ block: 'center' }); fresh.click(); } catch (e2) {}
        return waitConversation(identity, 6);
      }
      return true;
    }).then(function (ok) {
      if (!ok) A.state.lastVerifyWhy = diagnoseConversation(identity);
      return ok;
    });
  }

  function conversationElement(el) {
    if (!el || !el.closest) return null;
    var sels = (cfg().conversationSelectors || []).concat(['li.geek-item', '.geek-item', '[class*="chat-item"]', '[class*="conversation-item"]', '[class*="message-item"]']);
    for (var i = 0; i < sels.length; i++) {
      try { var hit = el.closest(sels[i]); if (hit && visible(hit)) return hit; } catch (e) {}
    }
    var node = el;
    while (node && node !== document.body) {
      if (looksLikeConversation(node)) return node;
      node = node.parentElement;
    }
    return null;
  }
  // v1.9.19 会话里有没有我方发过的消息
  function hasOutgoing() {
    var root = panelRoot();
    if (!root) return false;
    var rr = root.getBoundingClientRect();
    return A.qsa('[class*="message-item"],[class*="message-body"],[class*="msg-item"],[class*="chat-message"],[class*="message"]', root).some(function (el) {
      if (!visible(el)) return false;
      var t = textOf(el); if (!t || t.length > 500) return false;
      if (/撤回|向您发起了沟通/.test(t)) return false;
      var cls = String(el.className || '') + ' ' + String((el.parentElement && el.parentElement.className) || '');
      if (/mine|self|is-me|from-me|outgoing|我的/.test(cls)) return true;
      var r = el.getBoundingClientRect();
      return rr.width && r.width < rr.width * 0.85 && r.left > rr.left + rr.width * 0.3 && r.right > rr.right - 140;
    });
  }
  /**
   * v1.9.48 RPA 发消息：真实鼠标点进输入框 → 清空旧内容 → 逐字打字 → 核对输入框里确实是这段话 →
   * 真实鼠标点「发送」（没有发送按钮就按回车）→ 输入框清空才算发出去。任何一步对不上都不发送。
   */
  function rpaSend(inputEl, root, text, identity) {
    var c = cfg();
    var flat = function (x) { return String(x || '').replace(/\s+/g, ''); };
    var want = flat(text).slice(0, 40);
    return D().rpaType(inputEl, text, { clear: true }).then(function (r) {
      if (!r.ok) { A.rpaNote(r); return false; }
      return A.sleep(300).then(function () {
        if (!verifyConversation(identity)) { A.uiLog('err', '打字后会话变了，没有发送'); return false; }
        if (flat(D().rpaValueOf(inputEl)).indexOf(want) < 0) {
          A.uiLog('err', 'RPA 打完字后输入框内容对不上（可能被输入法拦了），没有发送');
          return false;
        }
        var sendBtn = A.firstQuery(c.sendSelectors || [], root) || findByText(root, ['发送'], 'button') || A.firstQuery(c.sendSelectors || [], document) || findByText(document, ['发送'], 'button');
        var act = (sendBtn && sendBtn.el && visible(sendBtn.el)) ? D().rpaClick(sendBtn.el) : D().rpaKey('enter');
        return act.then(function (k) {
          if (!k.ok) { A.rpaNote(k); return false; }
          return A.sleep(700).then(function () {
            var still = verifyConversation(identity);
            var v2 = flat(D().rpaValueOf(inputEl));
            if (still && v2 && v2.indexOf(want) >= 0) {
              // 还在输入框里：点回输入框再按一次回车
              return D().rpaClick(inputEl).then(function (r2) {
                if (!r2.ok) { A.rpaNote(r2); return false; }
                return D().rpaKey('enter').then(function () { return A.sleep(700); }).then(function () {
                  var v3 = flat(D().rpaValueOf(inputEl));
                  return verifyConversation(identity) && (!v3 || v3.indexOf(want) < 0);
                });
              });
            }
            return still && (!v2 || v2.indexOf(want) < 0);
          });
        });
      });
    });
  }

  var hooks = {
    findFreshCard: function (identity) { conversationCache.at = 0; return findCard(identity); },
    hasOutgoing: hasOutgoing,
    listOk: listOk,
    isCommunicationPage: isCommunicationPage,
    getConversationElement: conversationElement,
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
        if (autoSwitchToCommunication()) A.state.lastCardSel = '推荐页已拦截，正在切换到「我的沟通」';
        else A.state.lastCardSel = '已拦截：当前不是沟通页（推荐牛人页只读，不扫描）';
        return [];
      }
      var cards = conversationCards();
      A.state.lastCardSel = cards.length ? ((cfg().conversationSelectors || [])[0] || '沟通会话选择器') + '（' + cards.length + '项）' : '未命中 Boss 沟通会话卡片';
      if (cards.length && !A.state.lastExtract) A.state.lastExtract = textOf(cards[0]).slice(0, 80);
      return cards;
    },
    cardId: function (card) {
      var id = identityOf(card);
      return 'b_' + A.hash([id.chatId, id.name, id.jobText].join('|'));
    },
    getIdentity: identityOf,
    isReadCard: isReadCard,
    shouldReplyToCandidate: shouldReplyToCandidate,
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
      if (btn && btn.el) {
        if (rpaOn()) return act(btn.el);
        try { btn.el.click(); return Promise.resolve(true); } catch (e) {}
      }
      return Promise.resolve(false);
    },
    sendMessage: function (card, text, identity) {
      identity = identity || identityOf(card);
      if (!verifyConversation(identity)) return Promise.resolve(false);
      var c = cfg();
      var root = panelRoot() || document;
      var input = A.firstQuery(c.inputSelectors || ['textarea'], root) || A.firstQuery(c.inputSelectors || ['textarea'], document);
      if (!input) return Promise.resolve(false);
      if (rpaOn()) return rpaSend(input.el, root, text, identity);
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
      var c = cfg();
      var root = card || panelRoot() || document;
      if (!card && identity && !verifyConversation(identity)) return null;
      var hit = A.firstQuery(c.requestResumeSelectors || [], root);
      if (hit && hit.el && visible(hit.el)) return hit.el;
      return findByText(root, ['索要简历', '索取简历', '交换简历', '求简历', '申请简历'], 'button') ||
        findByText(root, ['索要简历', '索取简历', '交换简历', '求简历'], 'span');
    },
    getActiveIdentity: function () {
      var ac = activeCard();
      if (!ac && A.state.activeConversation) return A.state.activeConversation;
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
    // v1.9.27 简历详情：点会话顶部卡片上的名字，Boss 弹出简历详情，读完点右上角 × 关掉
    openDetail: function (identity) {
      var el = A.headerNameEl(identity && identity.name, listRightEdge() + 10);
      return A.readByPopup(el);
    },
    getActiveText: function () { return textOf(panelRoot()); },
    getSummaryText: summaryText,
    beforeScan: beforeScan,
    onResume: onResume,
    restInfo: restInfo,
    getWorkLines: workLines,
    summaryDump: function () { return { at: new Date().toISOString(), url: location.href, summary: summaryText().slice(0, 600), workLines: workLines(), rightPaneTexts: headerDump() }; },
    findResumeAttachments: function (identity) {
      if (!verifyConversation(identity || hooks.getActiveIdentity())) return [];
      var root = panelRoot() || document;
      var nodes = [];
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
      return id.chatId ? CT.chatUrl('boss', id.chatId) : null;
    },
    watch: function (cb) {
      var obs = new MutationObserver(function () { cb(); });
      obs.observe(document.body, { childList: true, subtree: true });
      return obs;
    },
    onEmpty: function () {
      var msg;
      if (!isCommunicationPage()) msg = isRecommendPage() ? '推荐牛人页：沟通筛选不在这里运行（打招呼功能在本页单独运行）。' : '当前不是沟通页：只读不扫描。请切换到 Boss「沟通」中的消息列表。';
      else msg = '当前沟通列表未找到可识别会话卡片，请展开「我的沟通」并保持消息列表可见。';
      if (A.state.lastPageNotice === msg) return;
      A.state.lastPageNotice = msg;
      A.log('诊断', msg);
    }
  };

  new A.Engine('boss', hooks).start();
})();
