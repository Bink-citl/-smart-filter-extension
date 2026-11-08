/* v2.5.0 PDF 解析页：后台发来简历编号，从本机简历库读出 PDF，返回按行的文字
 * v2.6.1 也负责「保存到你选的文件夹」：后台发来简历编号和路径，这里写文件（Service Worker 里不能用文件夹授权）
 */
(function () {
  'use strict';
  chrome.runtime.onMessage.addListener(function (msg, sender, sendResponse) {
    if (!msg || msg.target !== 'offscreen') return;
    if (msg.type === 'PDF_TEXT') {
      HRSResumeDB.get(msg.id).then(function (blob) {
        if (!blob) return { ok: false, why: '本机简历库里没有这份 PDF' };
        return HRSPdfText.fromBlob(blob).then(function (text) { return { ok: true, text: text }; });
      }).catch(function (e) { return { ok: false, why: 'PDF 读不出文字：' + (e && e.message || e) }; })
        .then(sendResponse);
      return true;
    }
    // v3.6.0 按要求删除 / 到期删除：删掉保存到文件夹里的简历文件
    if (msg.type === 'DIR_REMOVE') {
      HRSSaveDir.get().then(function (h) {
        if (!h) return { ok: false, why: '还没有选保存文件夹' };
        return HRSSaveDir.perm(h, false).then(function (p) {
          if (p !== 'granted') return { ok: false, needPerm: true, why: '保存文件夹需要重新授权' };
          return HRSSaveDir.remove(h, msg.path).then(function (ok) { return { ok: ok }; });
        });
      }).catch(function (e) { return { ok: false, why: String(e && e.message || e) }; }).then(sendResponse);
      return true;
    }
    // v3.6.0 自动备份：把文字写进文件夹，只留最新 keep 份
    if (msg.type === 'DIR_PUT') {
      HRSSaveDir.get().then(function (h) {
        if (!h) return { ok: false, nodir: true, why: '还没有选保存文件夹' };
        return HRSSaveDir.perm(h, false).then(function (p) {
          if (p !== 'granted') return { ok: false, needPerm: true, why: '保存文件夹「' + h.name + '」需要你点一下授权' };
          return HRSSaveDir.write(h, msg.path, new Blob([msg.text || ''], { type: 'application/octet-stream' }), { overwrite: !!msg.overwrite }).then(function (path) {
            var dir = path.split('/').slice(0, -1).join('/');
            return (msg.keep ? HRSSaveDir.prune(h, dir, msg.prefix || '', msg.suffix || '', msg.keep) : Promise.resolve(0)).then(function () { return { ok: true, path: path, dir: h.name }; });
          });
        });
      }).catch(function (e) { return { ok: false, why: '写入文件夹失败：' + String(e && (e.message || e.name) || e) }; }).then(sendResponse);
      return true;
    }
    if (msg.type === 'DIR_WRITE') {
      Promise.all([HRSSaveDir.get(), HRSResumeDB.get(msg.id)]).then(function (r) {
        var h = r[0], blob = r[1];
        if (!h) return { ok: false, nodir: true, why: '还没有选保存文件夹' };
        if (!blob) return { ok: false, why: '本机简历库里没有这份 PDF' };
        return HRSSaveDir.perm(h, false).then(function (p) {
          if (p !== 'granted') return { ok: false, needPerm: true, dir: h.name, why: '保存文件夹「' + h.name + '」需要你点一下授权（浏览器重启后会这样）' };
          var rm = msg.removeOld ? HRSSaveDir.remove(h, msg.removeOld) : Promise.resolve(false);
          return rm.then(function () { return HRSSaveDir.write(h, msg.path, blob, { overwrite: !!msg.overwrite }); })
            .then(function (path) { return { ok: true, path: path, dir: h.name }; });
        });
      }).catch(function (e) {
        var m = String(e && (e.message || e.name) || e);
        if (/NotFound/i.test(String(e && e.name)) || /could not be found|not found/i.test(m)) return { ok: false, gone: true, why: '保存文件夹找不到了（被移动、改名或删除），请到「简历收集 · 设置」重新选择' };
        return { ok: false, why: '写入文件夹失败：' + m };
      }).then(sendResponse);
      return true;
    }
  });
})();
