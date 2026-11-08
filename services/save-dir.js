/**
 * save-dir.js v2.6.1：「简历收集」保存到你自己选的文件夹（任意位置，不限于浏览器下载目录）
 * 用浏览器的「选择文件夹」授权（File System Access）。选好的文件夹记在本机 IndexedDB 里，下次直接用；
 * 浏览器重启后可能要再点一次授权（浏览器的安全规定），授权时选「每次访问时都允许」就不用再点。
 * 工作台页面（选文件夹、授权）和后台的隐藏页（写文件）共用。
 */
(function (root) {
  'use strict';
  var DB = 'hrs-save-dir', VER = 1, STORE = 'h', KEY = 'resume';
  var dbp = null;
  function open() {
    if (dbp) return dbp;
    dbp = new Promise(function (resolve, reject) {
      var req = indexedDB.open(DB, VER);
      req.onupgradeneeded = function () { if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE); };
      req.onsuccess = function () { resolve(req.result); };
      req.onerror = function () { dbp = null; reject(req.error || new Error('打不开本机设置库')); };
    });
    return dbp;
  }
  function tx(mode, fn) {
    return open().then(function (db) {
      return new Promise(function (resolve, reject) {
        var t = db.transaction(STORE, mode), r = fn(t.objectStore(STORE)), out;
        if (r) r.onsuccess = function () { out = r.result; };
        t.oncomplete = function () { resolve(out); };
        t.onerror = function () { reject(t.error); };
        t.onabort = function () { reject(t.error); };
      });
    });
  }
  function get() { return tx('readonly', function (st) { return st.get(KEY); }).then(function (h) { return h || null; }); }
  function set(h) { return tx('readwrite', function (st) { return st.put(h, KEY); }); }
  function clear() { return tx('readwrite', function (st) { return st.delete(KEY); }); }
  /** 'granted' | 'prompt' | 'denied'。ask = true 时弹出浏览器的授权确认（必须在点击里调用） */
  function perm(h, ask) {
    if (!h) return Promise.resolve('denied');
    var o = { mode: 'readwrite' };
    if (!h.queryPermission) return Promise.resolve('granted');
    return h.queryPermission(o).then(function (p) {
      if (p === 'granted' || !ask || !h.requestPermission) return p;
      return h.requestPermission(o);
    }).catch(function () { return 'denied'; });
  }
  function clean(seg) {
    return String(seg || '').replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_').replace(/^\.+$/, '_').replace(/[. ]+$/, '').trim().slice(0, 120) || '_';
  }
  function partsOf(rel) { return String(rel || '').split('/').filter(function (x) { return x && x !== '.' && x !== '..'; }).map(clean); }
  function walk(h, parts, create) {
    return parts.reduce(function (p, name) {
      return p.then(function (d) { return d.getDirectoryHandle(name, { create: !!create }); });
    }, Promise.resolve(h));
  }
  function exists(dir, name) {
    return dir.getFileHandle(name).then(function () { return true; }, function () { return false; });
  }
  /** 同名文件已存在时加 (2)、(3)… */
  function freeName(dir, name) {
    var m = name.match(/^(.*?)(\.[^.]{1,8})?$/), base = m[1], ext = m[2] || '';
    function tryN(n) {
      var nm = n < 2 ? name : base + ' (' + n + ')' + ext;
      return exists(dir, nm).then(function (yes) { return yes && n < 200 ? tryN(n + 1) : nm; });
    }
    return tryN(1);
  }
  /**
   * 把文件写到 rel（例如 2026-10-30/数字IC验证工程师/张三—DV….pdf），文件夹不存在就建。
   * opt.overwrite：同名就覆盖（同一份简历重新保存）；否则自动加 (2)。返回实际写入的相对路径
   */
  function write(h, rel, data, opt) {
    var parts = partsOf(rel), file = parts.pop();
    if (!file) return Promise.reject(new Error('文件名是空的'));
    return walk(h, parts, true).then(function (dir) {
      return (opt && opt.overwrite ? Promise.resolve(file) : freeName(dir, file)).then(function (nm) {
        return dir.getFileHandle(nm, { create: true }).then(function (fh) {
          return fh.createWritable().then(function (w) {
            return w.write(data).then(function () { return w.close(); }, function (e) { try { w.abort(); } catch (x) {} throw e; });
          });
        }).then(function () { return parts.concat([nm]).join('/'); });
      });
    });
  }
  /** 删掉 rel 这个文件（改名重新保存时删旧文件）；不存在不算错 */
  function remove(h, rel) {
    var parts = partsOf(rel), file = parts.pop();
    if (!file) return Promise.resolve(false);
    return walk(h, parts, false).then(function (dir) { return dir.removeEntry(file).then(function () { return true; }); }).catch(function () { return false; });
  }
  /** v3.6.0 自动备份：relDir 里名字以 prefix 开头、suffix 结尾的文件只留最新的 keep 个（按文件名排序，文件名里有日期） */
  function prune(h, relDir, prefix, suffix, keep) {
    return walk(h, partsOf(relDir), false).then(function (dir) {
      var names = [], it = dir.keys();
      function next() {
        return it.next().then(function (r) {
          if (r.done) return names;
          var n = String(r.value);
          if (n.indexOf(prefix) === 0 && n.slice(-suffix.length) === suffix) names.push(n);
          return next();
        });
      }
      return next().then(function (all) {
        all.sort();
        var old = all.slice(0, Math.max(0, all.length - keep));
        return Promise.all(old.map(function (n) { return dir.removeEntry(n).catch(function () {}); })).then(function () { return old.length; });
      });
    }).catch(function () { return 0; });
  }
  root.HRSSaveDir = { get: get, set: set, clear: clear, perm: perm, write: write, remove: remove, prune: prune, partsOf: partsOf };
})(typeof self !== 'undefined' ? self : this);
