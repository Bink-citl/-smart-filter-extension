/**
 * pane-reader.js v1.9.0：沟通页「右侧会话头部」通用读取（不依赖 class，按位置找）
 * 给猎聘用（Boss 在 boss.js 里有一套同样思路的实现）。
 *   headerHit(name)  右侧上部有没有以这个名字开头的文字（确认打开的是这个人）
 *   summaryText()    右侧上部的简历摘要（姓名行、工作经历、求职期望）
 *   workLines()      按行读工作经历：「公司 · 职位」
 */
(function () {
  'use strict';
  if (window.HRSPane) return;
  function textOf(el) { return el ? String(el.innerText || el.textContent || '').trim() : ''; }
  function norm(s) { return String(s || '').replace(/\s+/g, '').toLowerCase(); }
  function qsa(sel, root) { try { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); } catch (e) { return []; } }
  var ANCHOR = /^(沟通职位|求职期望|期望|\d{2}岁|工作\d{1,2}年|\d{1,2}年以上|\d{1,2}年|应届生|今天活跃|刚刚活跃|\d天内活跃)[:：]?$/;

  function create(o) {
    var edge = function () { try { return o.listRightEdge(); } catch (e) { return window.innerWidth * 0.35; } };
    var inList = function (el) { try { return o.inList(el); } catch (e) { return false; } };
    var maxTop = o.maxTop || 340;
    function rightTop(el, ed) {
      var r = el.getBoundingClientRect();
      return r.width > 0 && r.height > 0 && r.left >= ed - 2 && r.top <= maxTop && r.top >= 0;
    }
    function headerHit(name) {
      var n = norm(name);
      if (!n || n.length < 2) return null;
      var ed = edge();
      var els = qsa('span,div,h1,h2,h3,h4,p,a,b,strong,em');
      for (var i = 0; i < els.length; i++) {
        var t = textOf(els[i]);
        if (!t || t.length > 30 || norm(t).indexOf(n) !== 0) continue;
        if (inList(els[i]) || !rightTop(els[i], ed)) continue;
        return { text: t };
      }
      return null;
    }
    function blocks() {
      var ed = edge(), out = [];
      qsa('span,div,label,em,p,b,i,li,td').forEach(function (el) {
        if (el.children.length > 2) return;
        var t = textOf(el).replace(/\s+/g, '');
        if (!t || t.length > 24 || !ANCHOR.test(t)) return;
        if (inList(el) || !rightTop(el, ed)) return;
        if (out.some(function (b) { return b.contains(el); })) return;
        var best = el, cur = el.parentElement;
        while (cur && cur !== document.body) {
          if (inList(cur)) break;
          var r = cur.getBoundingClientRect();
          if (r.left < ed - 2 || r.height > 380) break;
          best = cur; cur = cur.parentElement;
        }
        out = out.filter(function (b) { return !best.contains(b); });
        if (!out.some(function (b) { return b.contains(best); })) out.push(best);
      });
      out.sort(function (x, y) { return x.compareDocumentPosition(y) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1; });
      return out;
    }
    function summaryText() {
      return blocks().map(function (b) { return textOf(b).replace(/[ \t]+/g, ' ').trim(); }).filter(Boolean).join('\n').slice(0, 3000);
    }
    // v1.9.6 工作经历按位置读：右侧头部的左半栏、姓名行下面的每一行（公司 · 职位），学校行、期望行、薪资不算。
    // 猎聘的「·」是图标，不在文字里，所以不能靠「·」找
    function workLines() {
      var ed = edge(), rows = [];
      var leaves = qsa('span,div,a,p,em,b,i').filter(function (el) {
        if (el.children.length || inList(el)) return false;
        var t = textOf(el);
        return t && t.length <= 60 && rightTop(el, ed);
      });
      if (!leaves.length) return [];
      var right = Math.max.apply(null, leaves.map(function (el) { return el.getBoundingClientRect().right; }));
      var mid = ed + (right - ed) * 0.5, bottom = Infinity;
      // 右半栏从「沟通职位 / 求职期望」开始；头部到这两行为止（下面是聊天内容）
      var anchors = qsa('span,div,label,em,p').filter(function (el) { return el.children.length <= 2 && !inList(el) && rightTop(el, ed) && /^(沟通职位|求职期望)/.test(textOf(el).replace(/\s+/g, '')) && textOf(el).length < 60; });
      if (anchors.length) {
        mid = Math.min.apply(null, anchors.map(function (el) { return el.getBoundingClientRect().left; })) - 4;
        bottom = Math.max.apply(null, anchors.map(function (el) { return el.getBoundingClientRect().bottom; })) + 8;
      }
      // v1.9.8 只读姓名那一行（有「49岁」「工作21年」的那一行）下面的行：上面一排「有简历 / 超级聊聊 / 不合适」是页面标签，不是公司
      var top = -Infinity;
      var ageEl = leaves.filter(function (el) { return /^(\d{2}岁|工作\d{1,2}年)$/.test(textOf(el).replace(/\s+/g, '')); })[0];
      if (ageEl) { var ar = ageEl.getBoundingClientRect(); top = ar.bottom - 2; }
      var TAB = /^(全部|新招呼(\(\d+\))?|我发起的|我回复的|有简历|超级聊聊|不合适|查看简历|在线简历|附件简历)$/;
      leaves.forEach(function (el) {
        var r = el.getBoundingClientRect();
        if (r.left > mid || r.top > bottom || r.top < top) return;
        if (TAB.test(textOf(el).replace(/\s+/g, ''))) return;
        var y = r.top + r.height / 2;
        var row = rows.filter(function (x) { return Math.abs(x.y - y) <= 7; })[0];
        if (!row) { row = { y: y, items: [] }; rows.push(row); }
        row.items.push({ x: r.left, t: textOf(el).replace(/^[·•・\s]+|[·•・\s]+$/g, '') });
      });
      rows.sort(function (a, b) { return a.y - b.y; });
      var out = [];
      rows.forEach(function (row) {
        var parts = row.items.sort(function (a, b) { return a.x - b.x; }).map(function (x) { return x.t; }).filter(function (t) { return t && !/^[·•・|｜]+$/.test(t); });
        var line = parts.join(' · ');
        if (!line || /\d{2}岁|活跃|在线|工作\d+年|期望|沟通职位/.test(line)) return;
        if (parts.length === 1 && /^[\u4e00-\u9fa5·]{2,4}$|先生$|女士$/.test(parts[0])) return;   // v1.9.18 只有姓名的一行不是工作经历
        if (/(大学|学院|学校|中学|University|College)/i.test(line)) return;
        if (/^\d+\s*-\s*\d+\s*[kK]|薪$|元\/(月|天)/.test(parts[0] || '')) return;
        out.push(line);
      });
      return out.slice(0, 6);
    }
    function dump() {
      var ed = edge(), out = [];
      qsa('span,div,h1,h2,h3,h4,p,a,b,strong,em').forEach(function (el) {
        if (out.length >= 30 || el.children.length > 3 || inList(el)) return;
        var t = textOf(el).replace(/\s+/g, ' ');
        if (!t || t.length > 40 || !rightTop(el, ed)) return;
        out.push({ text: t, tag: el.tagName.toLowerCase(), cls: String(el.className || '').slice(0, 80) });
      });
      return { url: location.href, listRightEdge: ed, summary: summaryText().slice(0, 600), texts: out };
    }
    return { headerHit: headerHit, summaryText: summaryText, workLines: workLines, dump: dump };
  }
  window.HRSPane = { create: create };
})();
