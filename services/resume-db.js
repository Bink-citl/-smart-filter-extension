/**
 * resume-db.js v2.5.0：简历收集的 PDF 原件存在本机 IndexedDB（插件自己的数据库，不上传）
 * 后台、工作台页面、PDF 解析页共用。记录（姓名、公司等）存在 chrome.storage.local 的 resumeInbox 里，这里只放文件本身。
 */
(function (root) {
  'use strict';
  var DB = 'hrs-resume-inbox', VER = 1, STORE = 'files';
  var dbp = null;
  function open() {
    if (dbp) return dbp;
    dbp = new Promise(function (resolve, reject) {
      var req = indexedDB.open(DB, VER);
      req.onupgradeneeded = function () {
        var db = req.result;
        if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
      };
      req.onsuccess = function () { resolve(req.result); };
      req.onerror = function () { dbp = null; reject(req.error || new Error('打不开本机简历库')); };
    });
    return dbp;
  }
  function tx(mode, fn) {
    return open().then(function (db) {
      return new Promise(function (resolve, reject) {
        var t = db.transaction(STORE, mode), st = t.objectStore(STORE), out;
        var r = fn(st);
        if (r) r.onsuccess = function () { out = r.result; };
        t.oncomplete = function () { resolve(out); };
        t.onerror = function () { reject(t.error || new Error('本机简历库读写失败')); };
        t.onabort = function () { reject(t.error || new Error('本机简历库读写被中止')); };
      });
    });
  }
  function dataUrlToBlob(u) {
    var m = String(u || '').match(/^data:([^;,]*)(;base64)?,(.*)$/);
    if (!m) return null;
    var raw = m[2] ? atob(m[3]) : decodeURIComponent(m[3]);
    var arr = new Uint8Array(raw.length);
    for (var i = 0; i < raw.length; i++) arr[i] = raw.charCodeAt(i);
    return new Blob([arr], { type: m[1] || 'application/pdf' });
  }
  root.HRSResumeDB = {
    put: function (id, blob) { return tx('readwrite', function (st) { return st.put(blob, id); }); },
    get: function (id) { return tx('readonly', function (st) { return st.get(id); }); },
    del: function (id) { return tx('readwrite', function (st) { return st.delete(id); }); },
    clear: function () { return tx('readwrite', function (st) { return st.clear(); }); },
    dataUrlToBlob: dataUrlToBlob
  };
})(typeof self !== 'undefined' ? self : this);
