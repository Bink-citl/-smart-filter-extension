/**
 * HRSParsers —— 简历文件解析（PDF / Word / 纯文本 / 图片OCR）
 * 浏览器端专用。pdf.js / mammoth / tesseract.js 均在本扩展 lib 目录，离线可用。
 */
(function (root) {
  'use strict';

  var pdfWorkerSet = false;

  /** 将 ArrayBuffer 按类型解析为纯文本 */
  function parseFile(file) {
    var name = (file.name || '').toLowerCase();
    var mime = file.type || '';
    return file.arrayBuffer().then(function (buf) {
      if (mime === 'application/pdf' || name.endsWith('.pdf')) return parsePdf(buf);
      if (mime.indexOf('word') >= 0 || name.endsWith('.docx')) return parseDocx(buf);
      if (name.endsWith('.doc')) return Promise.resolve('（暂不支持旧版 .doc 二进制格式，请转为 .docx 或 PDF 后上传）');
      if (mime.indexOf('text') >= 0 || name.endsWith('.txt') || name.endsWith('.md')) {
        return new TextDecoder('utf-8').decode(buf);
      }
      if (mime.indexOf('image') >= 0 || /\.(png|jpe?g|webp|bmp)$/.test(name)) return parseImage(buf, mime || 'image/png');
      return Promise.resolve('（不支持的文件类型：' + (name || mime) + '）');
    });
  }

  function setupPdfWorker() {
    if (pdfWorkerSet) return;
    try {
      var base = root.chrome.runtime.getURL('lib/');
      root.pdfjsLib.GlobalWorkerOptions.workerSrc = base + 'pdf.worker.min.js';
      root.pdfjsLib.GlobalWorkerOptions.standardFontDataUrl = base + 'standard_fonts/';
    } catch (e) {
      try {
        root.pdfjsLib.GlobalWorkerOptions.workerSrc = 'lib/pdf.worker.min.js';
        root.pdfjsLib.GlobalWorkerOptions.standardFontDataUrl = 'lib/standard_fonts/';
      } catch (e2) {}
    }
    pdfWorkerSet = true;
  }

  function parsePdf(buf) {
    if (!root.pdfjsLib) return Promise.reject(new Error('pdf.js 未加载'));
    setupPdfWorker();
    return root.pdfjsLib.getDocument({ data: buf }).promise.then(function (doc) {
      var tasks = [];
      for (var i = 1; i <= doc.numPages; i++) {
        tasks.push(doc.getPage(i).then(function (page) {
          return page.getTextContent().then(function (tc) {
            return tc.items.map(function (it) { return it.str || ''; }).join(' ');
          });
        }));
      }
      return Promise.all(tasks).then(function (pages) {
        return pages.join('\n').replace(/\n{3,}/g, '\n\n');
      });
    });
  }

  function parseDocx(buf) {
    if (!root.mammoth) return Promise.reject(new Error('mammoth 未加载'));
    return root.mammoth.extractRawText({ arrayBuffer: buf }).then(function (r) {
      return (r && r.value) || '';
    });
  }

  var ocrWorker = null;
  function getOcrWorker() {
    if (ocrWorker) return ocrWorker;
    if (!root.Tesseract) return Promise.reject(new Error('tesseract.js 未加载'));
    var base = root.chrome.runtime.getURL('lib/tesseract/');
    return root.Tesseract.createWorker(['chi_sim', 'eng'], 1, {
      workerPath: base + 'worker.min.js',
      corePath: base,
      langPath: base + 'langs/',
      logger: function () {}
    }).then(function (w) { ocrWorker = w; return w; });
  }

  function parseImage(buf, mime) {
    var blob = new Blob([buf], { type: mime });
    return getOcrWorker().then(function (worker) {
      return worker.recognize(blob).then(function (r) {
        return (r && r.data && r.data.text) || '';
      });
    });
  }

  function resetOcr() {
    if (ocrWorker) { try { ocrWorker.terminate(); } catch (e) {} ocrWorker = null; }
  }

  root.HRSParsers = { parseFile: parseFile, parsePdf: parsePdf, parseDocx: parseDocx, parseImage: parseImage, resetOcr: resetOcr };
})(this);
