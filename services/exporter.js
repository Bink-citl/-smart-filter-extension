/**
 * HRSAutoExporter —— 将合格简历 / 人才库导出到本地文件（系统下载目录下的指定子文件夹）
 */
(function (root) {
  'use strict';

  function sanitize(name) {
    return String(name || 'unknown').replace(/[\\/:*?"<>|\r\n]/g, '_').slice(0, 40);
  }

  function folder(folderName, date) {
    var d = date || new Date();
    var ym = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
    return [sanitize(folderName || 'HR人才库'), ym].join('/');
  }

  function download(filename, content, mime) {
    var url = 'data:' + (mime || 'application/json') + ';charset=utf-8,' + encodeURIComponent(content);
    return chrome.downloads.download({ url: url, filename: filename, saveAs: false });
  }

  /** 导出单个合格候选人简历（JSON），返回 downloadId */
  function exportCandidate(c, settings) {
    var fn = folder((settings && settings.exportFolder) || 'HR人才库');
    var name = sanitize((c.fields && c.fields.name) || '候选人');
    var payload = candidatePayload(c, settings);
    return download(fn + '/' + name + '_合格简历.json', JSON.stringify(payload, null, 2));
  }

  /** 候选人数据载荷（导出/落盘共用） */
  function candidatePayload(c, settings) {
    return {
      exportedAt: new Date().toISOString(),
      name: c.name || (c.fields && c.fields.name) || '',
      source: c.source,
      sourceUrl: c.sourceUrl,
      jdTitle: c.jdTitle,
      jdId: c.jdId,
      score: c.score,
      verdict: c.verdict,
      reasons: c.reasons,
      fields: c.fields || {},
      rawText: (c.rawText || '').slice(0, 20000)
    };
  }

  /**
   * 导出到用户授权的自定义根目录（File System Access API）。
   * 目录结构：根目录/exportFolder/年份-月份/[岗位JD子文件夹/]姓名_简历.json
   * 岗位JD子文件夹仅在 settings.exportByJd 开启时创建，实现"不同招聘岗位自动分文件夹"。
   */
  function exportCandidateToDir(rootHandle, c, settings) {
    var rootName = sanitize((settings && settings.exportFolder) || 'HR人才库');
    var d = new Date();
    var ym = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
    var jdDir = (settings && settings.exportByJd && c.jdTitle) ? sanitize(c.jdTitle) : null;
    var name = sanitize((c.fields && c.fields.name) || c.name || '候选人');
    var rel = [rootName, ym, jdDir, name + '_简历.json'].filter(Boolean).join('/');
    var payload = candidatePayload(c, settings);
    return writeFileToHandle(rootHandle, rel, JSON.stringify(payload, null, 2));
  }

  /** 按目录句柄写文件（自动创建子文件夹） */
  function writeFileToHandle(rootHandle, relativePath, content) {
    var parts = String(relativePath).split('/').filter(Boolean);
    var dir = rootHandle;
    var chain = Promise.resolve();
    parts.slice(0, -1).forEach(function (p) {
      chain = chain.then(function () {
        return dir.getDirectoryHandle(p, { create: true }).then(function (d) { dir = d; });
      });
    });
    return chain.then(function () {
      return dir.getFileHandle(parts[parts.length - 1], { create: true }).then(function (fh) {
        return fh.createWritable().then(function (w) {
          return w.write(content).then(function () { return w.close(); });
        });
      });
    });
  }

  /**
   * 候选人回传的 PDF 归档路径：
   * 根目录/年月/[岗位JD]/候选人姓名/候选人姓名_原文件名.pdf
   */
  function resumeFilePath(c, file, settings) {
    var s = settings || {};
    var d = new Date();
    var root = folder(s.exportFolder || 'HR人才库', d);
    var jdDir = s.exportByJd !== false && c && c.jdTitle ? sanitize(c.jdTitle) : '';
    var person = sanitize((c && (c.name || c.candidateName)) || '候选人');
    var original = sanitize(file && file.name || '候选人简历.pdf');
    if (!/\.pdf$/i.test(original)) original += '.pdf';
    if (original.indexOf(person + '_') !== 0) original = person + '_' + original;
    return [root, jdDir, person, original].filter(Boolean).join('/');
  }

  /** 保存候选人从沟通消息发来的 PDF，返回 {downloadId, filename} */
  function saveResumeFile(file, candidate, settings) {
    var f = file || {};
    // v2.6.1 只保存页面已经确认过的 PDF 字节；平台给的地址可能是预览网页，直接下载会存成 .htm
    var url = /^data:application\/pdf/i.test(f.dataUrl || '') ? f.dataUrl : '';
    if (!url) return Promise.reject(new Error('没有拿到 PDF 原件'));
    if (!/\.pdf/i.test(f.name || '') && !/^data:application\/pdf/i.test(f.dataUrl || '') && !/\.pdf(?:$|[?#])/i.test(url)) {
      return Promise.reject(new Error('附件不是 PDF'));
    }
    var filename = resumeFilePath(candidate, f, settings);
    return new Promise(function (resolve, reject) {
      chrome.downloads.download({ url: url, filename: filename, saveAs: false, conflictAction: 'uniquify' }, function (id) {
        if (chrome.runtime.lastError) return reject(new Error(chrome.runtime.lastError.message));
        if (!id) return reject(new Error('浏览器未返回下载任务'));
        resolve({ downloadId: id, filename: filename });
      });
    });
  }

  /** 导出人才库为 CSV / JSON */
  function exportLibrary(candidates, format) {
    var fn = folder('HR人才库导出');
    var stamp = new Date().toISOString().slice(0, 10);
    var jobs = [];
    if (format === 'csv' || format === 'both') {
      var cols = ['姓名', '来源', 'JD', '得分', '判定', '电话', '学历', '经验(年)', '期望薪资(万/月)', '城市', '技能', '处理状态', '时间'];
      var esc = function (v) { v = String(v == null ? '' : v); return '"' + v.replace(/"/g, '""') + '"'; };
      var rows = candidates.map(function (c) {
        var f = c.fields || {};
        return [c.name || f.name || '', c.source || '', c.jdTitle || '', c.score, c.verdict, f.phone || '', f.eduText || '', f.expYears || '', (f.salaryMin != null ? f.salaryMin + '-' + f.salaryMax : ''), f.city || '', (f.skills || []).join('/'), c.contactStatus || 'new', new Date(c.seenAt).toLocaleString('zh-CN')].map(esc).join(',');
      });
      jobs.push(download(fn + '/' + stamp + '_人才库.csv', '\ufeff' + [cols.map(esc).join(','), rows.join('\n')].join('\n'), 'text/csv;charset=utf-8'));
    }
    if (format === 'json' || format === 'both') {
      jobs.push(download(fn + '/' + stamp + '_人才库.json', JSON.stringify(candidates, null, 2)));
    }
    return Promise.all(jobs);
  }

  /** 健康自检导出（诊断报告） */
  function exportReport(report) {
    return download(folder('HR自检报告') + '/自检报告_' + new Date().toISOString().slice(0, 10) + '.json', JSON.stringify(report, null, 2));
  }

  root.HRSExporter = {
    sanitize: sanitize,
    exportCandidate: exportCandidate,
    exportLibrary: exportLibrary,
    exportReport: exportReport,
    exportCandidateToDir: exportCandidateToDir,
    saveResumeFile: saveResumeFile,
    resumeFilePath: resumeFilePath,
    writeFileToHandle: writeFileToHandle,
    candidatePayload: candidatePayload
  };
})(this);
