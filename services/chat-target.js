/**
 * HRSChatTarget —— 沟通页 / 会话定位 / 岗位范围 / PDF 附件识别（纯逻辑）
 * 目标：Boss 与猎聘只处理「我的沟通」中的对应岗位会话，绝不把推荐牛人页当作沟通页。
 */
(function (root, factory) {
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = factory();
  } else {
    root.HRSChatTarget = factory();
  }
})(this, function () {
  'use strict';

  var GENERIC = /^(招聘|沟通|聊天|消息|职位|岗位|求职|候选人|牛人|简历|在线|刚刚|今天|昨天|已读|未读|新招呼|沟通中|推荐牛人)$/;

  function normalize(s) {
    return String(s == null ? '' : s)
      .toLowerCase()
      .replace(/[\s\u00a0·•|｜/\\_\-—–:：,，.。;；()（）[\]【】<>《》"']+/g, '');
  }

  function cleanTitle(title) {
    return String(title || '')
      .replace(/[_|｜].*$/, '')
      .replace(/[（(]\s*(?:上海|北京|深圳|广州|杭州|南京|成都|武汉|西安|苏州|长沙|重庆|天津|郑州|青岛|厦门|福州|合肥|宁波|无锡|济南)\s*[^）)]*[）)]/g, '')
      .trim();
  }

  function unique(arr) {
    var seen = {};
    return (arr || []).filter(function (x) {
      var k = normalize(x);
      if (!k || k.length < 2 || seen[k] || GENERIC.test(String(x).trim())) return false;
      seen[k] = 1;
      return true;
    });
  }

  function jdTerms(jd) {
    if (!jd) return [];
    var title = cleanTitle(jd.title);
    var out = [title, jd.title];
    if (jd.platformJob) out.push(jd.platformJob);   // v1.3.0 平台职位名
    if (jd.liepinJob) out.push(jd.liepinJob);       // v1.9.15 猎聘职位名
    (jd.positions || []).forEach(function (p) { out.push(p); });

    // 标题中在分隔符两侧的完整片段可作为强特征；不把“软件/工程师”等泛词拆出来。
    String(title).split(/[/,，、+＋&＆]/).forEach(function (part) {
      part = part.trim();
      if (part.length >= 4 || /[A-Za-z]{2,}/.test(part)) out.push(part);
    });

    return unique(out).sort(function (a, b) { return normalize(b).length - normalize(a).length; });
  }

  function findHits(text, jd) {
    var t = normalize(text);
    if (!t) return [];
    return jdTerms(jd).filter(function (term) {
      var k = normalize(term);
      return k && t.indexOf(k) >= 0;
    });
  }

  /**
   * 岗位范围判定。
   * scope: active=命中当前岗位；other=明确命中其他岗位；unknown=没有岗位证据。
   * strict=true 时 unknown 不处理，避免从其他岗位或推荐列表误筛。
   */
  function classifyJobScope(text, activeJd, allJds, strict) {
    var activeHits = findHits(text, activeJd);
    if (activeHits.length) {
      return { scope: 'active', allowed: true, reason: '命中当前岗位：' + activeHits.join('、'), hits: activeHits };
    }
    var other = (allJds || []).filter(function (j) { return !activeJd || j.id !== activeJd.id; });
    for (var i = 0; i < other.length; i++) {
      var hits = findHits(text, other[i]);
      if (hits.length) {
        return { scope: 'other', allowed: false, reason: '属于其他岗位「' + other[i].title + '」：' + hits.join('、'), hits: hits };
      }
    }
    if (strict === false) return { scope: 'unknown', allowed: true, reason: '未识别岗位，宽松模式允许' };
    return { scope: 'unknown', allowed: false, reason: '无法确认投递岗位，已跳过（严格岗位隔离）', hits: [] };
  }

  function isCommunicationUrl(site, url) {
    try {
      var u = new URL(url || '', 'https://www.zhipin.com');
      var p = u.pathname.replace(/\/+$/, '');
      if (site === 'boss') {
        // /web/chat/recommend 是推荐牛人，绝不能当沟通页。
        return /^\/web\/chat\/index(?:\/|$)/i.test(p) || /^\/web\/chat\/im(?:\/|$)/i.test(p);
      }
      if (site === 'liepin') {
        return /\/(chat|im|message|msg)(?:\/|$)/i.test(p);
      }
      return false;
    } catch (e) { return false; }
  }

  function chatUrl(site, chatId) {
    var id = String(chatId || '').trim();
    if (!id) return '';
    if (site === 'boss') return 'https://www.zhipin.com/web/chat/index?chatId=' + encodeURIComponent(id);
    if (site === 'liepin') return 'https://www.liepin.com/chat/index?chatId=' + encodeURIComponent(id);
    return '';
  }

  function chatIdFromUrl(site, url) {
    try {
      var u = new URL(url || '', 'https://www.zhipin.com');
      var id = u.searchParams.get('chatId') || u.searchParams.get('chatid') || u.searchParams.get('lid') || '';
      if (id) return decodeURIComponent(id);
      if (site === 'boss') {
        var m = u.pathname.match(/\/web\/chat\/index\/([^/?#]+)/i);
        if (m) return decodeURIComponent(m[1]);
      }
      return '';
    } catch (e) { return ''; }
  }

  function isPdfAttachment(text, href, downloadAttr) {
    var s = String(text || '');
    var h = String(href || '').toLowerCase();
    var d = String(downloadAttr || '').toLowerCase();
    return /\.pdf(?:$|[?#\s])/i.test(h) || /\.pdf\b/i.test(d) ||
      (/pdf/i.test(s) && /(简历|附件|下载|resume|download)/i.test(s)) ||
      /(^|\/)(download|file|attachment|resume)/i.test(h) && /pdf|简历/.test(s + h);
  }

  /**
   * v2.6.0 这份附件简历是候选人主动发的（self），还是我们先索要、对方才发的（request）。
   * before：会话里这份附件之前的所有文字；requestScript：设置里的「索要简历」话术（我们发过它就算索要过）
   * 判断不了时返回 self：附件之前没有任何索要的话，就是候选人自己发的
   */
  var REQ_RES = [
    /(索要|索取|求|请求|申请)(一份|一下|下)?(您的|你的|对方的)?(附件|在线)?简历/,
    /简历(请求|申请)(已发送|已发出|发送成功)?/,
    /交换(一下)?(附件|在线)?简历/,
    /(方便|可以|能否|能不能|麻烦).{0,10}(发|发送|提供|发一份|发个|传).{0,6}简历/,
    /(已|您已)向(对方|牛人|候选人|Ta|他|她).{0,10}(请求|索要|发送).{0,6}简历/
  ];
  function resumeOrigin(before, requestScript) {
    var t = String(before || '').replace(/\s+/g, ' ');
    // 话术里有 {company} 这类占位符，发出去时被换掉了：取占位符之间最长的一段来比
    var segs = String(requestScript || '').replace(/\s+/g, ' ').split(/【[^】]*】|\{[^}]*\}/).map(function (x) { return x.trim(); })
      .sort(function (a, b) { return b.length - a.length; });
    var piece = (segs[0] || '').slice(0, 16);
    if (piece.length >= 8 && t.indexOf(piece) >= 0) return { origin: 'request', why: '会话里发过「索要简历」话术' };
    for (var i = 0; i < REQ_RES.length; i++) {
      var m = t.match(REQ_RES[i]);
      if (m) return { origin: 'request', why: '附件之前有「' + m[0] + '」' };
    }
    return { origin: 'self', why: '附件之前没有索要简历的消息' };
  }

  function sanitizeFileName(name) {
    var s = String(name || 'resume.pdf').replace(/[\\/:*?"<>|\r\n]/g, '_').trim();
    if (!/\.pdf$/i.test(s)) s += '.pdf';
    return s.slice(-120);
  }

  return {
    normalize: normalize,
    cleanTitle: cleanTitle,
    jdTerms: jdTerms,
    findHits: findHits,
    classifyJobScope: classifyJobScope,
    isCommunicationUrl: isCommunicationUrl,
    chatUrl: chatUrl,
    chatIdFromUrl: chatIdFromUrl,
    isPdfAttachment: isPdfAttachment,
    resumeOrigin: resumeOrigin,
    sanitizeFileName: sanitizeFileName
  };
});