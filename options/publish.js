/* publish.js v1.9.1：设置页「发布职位」 */
(function () {
  'use strict';
  function $(id) { return document.getElementById(id); }
  var O = window.HRSOpt, P = window.HRSPlan;
  var jds = [];
  var EXP = function (n) { n = parseInt(n, 10); if (!isFinite(n) || n <= 0) return ''; if (n < 3) return '1-3年'; if (n < 5) return '3-5年'; if (n < 10) return '5-10年'; return '10年以上'; };
  var EDU = ['', '', '大专', '本科', '硕士', '博士'];
  function cur() { return jds.find(function (j) { return j.id === $('pb_jd').value; }) || null; }
  function fillFrom(j) {
    if (!j) return;
    var b = P.baseOf(j, jds);
    $('pb_title').value = j.platformJob || j.title || '';
    $('pb_exp').value = EXP(b.exp);
    $('pb_edu').value = EDU[b.edu] || '';
    $('pb_desc').value = j.jdText || '';
    var c = String(b.cities || '');
    $('pb_sh').checked = !c || /上海/.test(c);
    $('pb_sz').checked = /苏州/.test(c);
  }
  function load() {
    chrome.storage.local.get(['jds', 'pendingPublish'], function (o) {
      jds = o.jds || [];
      var keep = $('pb_jd').value;
      $('pb_jd').innerHTML = jds.map(function (j) { return '<option value="' + O.esc(j.id) + '">' + O.esc(j.title) + '</option>'; }).join('');
      if (keep && jds.some(function (j) { return j.id === keep; })) $('pb_jd').value = keep; else fillFrom(cur());
      var p = o.pendingPublish;
      $('pb_state').textContent = p ? '已准备：' + p.title + '（' + (p.sites || []).map(function (s) { return s === 'boss' ? 'Boss' : '猎聘'; }).join('、') + '），到平台点「发布职位」即可' : '';
    });
  }
  $('pb_jd').addEventListener('change', function () { fillFrom(cur()); });
  $('pb_go').addEventListener('click', function () {
    var j = cur(); if (!j) { O.toast('先选一个岗位', true); return; }
    var sal = $('pb_salary').value.split('-').map(Number);
    var cities = [$('pb_sh').checked && '上海', $('pb_sz').checked && '苏州'].filter(Boolean);
    var sites = [$('pb_boss').checked && 'boss', $('pb_lp').checked && 'liepin'].filter(Boolean);
    if (!cities.length || !sites.length) { O.toast('至少选一个城市和一个平台', true); return; }
    if (!$('pb_title').value.trim() || !$('pb_desc').value.trim()) { O.toast('职位名称和职位描述不能空', true); return; }
    var p = { at: Date.now(), jdId: j.id, title: $('pb_title').value.trim(), desc: $('pb_desc').value, exp: $('pb_exp').value, edu: $('pb_edu').value,
      salary: { min: sal[0], max: sal[1], months: sal[2] }, cities: cities, sites: sites };
    chrome.storage.local.set({ pendingPublish: p }, function () {
      var pats = { boss: ['https://www.zhipin.com/*'], liepin: ['https://*.liepin.com/*'] };
      sites.forEach(function (site) {
        chrome.tabs.query({ url: pats[site] }, function (tabs) {
          if (tabs && tabs.length) chrome.tabs.update(tabs[0].id, { active: true });
          else chrome.tabs.create({ url: site === 'boss' ? 'https://www.zhipin.com/web/chat/index' : 'https://lpt.liepin.com/' });
        });
      });
      O.toast('已准备好。到平台「职位管理」点「发布职位」，表单右下角点「填入表单」');
      load();
    });
  });
  load();
  chrome.storage.onChanged.addListener(function (ch, area) { if (area === 'local' && ch.jds) load(); });
})();
