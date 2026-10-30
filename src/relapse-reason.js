/* v64 · 破戒之后：可选地记下触发点，回顾时能看出「什么时候最容易破」。
 * 不强制、不评判：一个薄条，点一下就好，点「先不记」也不会再问。
 * 原因存在当天习惯日志中；启用云同步或导出备份时，可能随记录一并包含。
 */
(function (factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory;
  else { window.RelapseReason = factory(window); window.RelapseReason.install(); }
})(function (root) {
  'use strict';
  var KEY = 'why';
  var REASONS = [
    { k: 'stress', label: '压力' },
    { k: 'bored', label: '无聊' },
    { k: 'mood', label: '情绪' },
    { k: 'social', label: '社交场合' },
    { k: 'late', label: '熬夜' },
    { k: 'body', label: '身体不适' },
    { k: 'other', label: '其他' }
  ];
  var BAR_ID = 'rgReasonBar';
  var installed = false, barId = '', barDate = '', sheetId = '', sheetDate = '';

  function U() { return root.U; }
  function today() { return U().today(); }
  function state() { return root.Store && root.Store.s; }
  function esc(value) { return U().esc(value == null ? '' : value); }
  function logOf(date, id) {
    var data = state();
    if (!data) return null;
    var day = (data.logs || {})[date];
    return (day && day[id]) || null;
  }
  function slipped(date, id) { return !!(logOf(date, id) || {}).slip; }
  function reasonOf(date, id) { return (logOf(date, id) || {})[KEY] || ''; }
  function labelOf(key) {
    for (var i = 0; i < REASONS.length; i++) if (REASONS[i].k === key) return REASONS[i].label;
    return '';
  }
  /* 只给「真的破了戒」的那天记；key 为空表示清除（撤销破戒时也要能清） */
  function setReason(date, id, key) {
    if (!state() || !logOf(date, id)) return false;
    if (key && (!slipped(date, id) || !labelOf(key))) return false;
    var changed = false;
    root.Store.commit(function (data) {
      var day = (data.logs || {})[date];
      var entry = day && day[id];
      if (!entry || (key && !entry.slip)) return;
      if (key) entry[KEY] = key; else delete entry[KEY];
      changed = true;
    });
    return changed;
  }
  /* 最近 N 天：破了几次、其中几次写了原因、最常触发什么 */
  function summary(days, habitId) {
    var span = days || 90, data = state(), counts = {}, slips = 0, tagged = 0;
    if (!data) return { slips: 0, tagged: 0, list: [], top: null };
    for (var i = 0; i < span; i++) {
      var date = U().shiftYmd(today(), -i);
      var day = (data.logs || {})[date] || {};
      Object.keys(day).forEach(function (id) {
        var entry = day[id];
        if ((habitId && id !== habitId) || !entry || !entry.slip) return;
        slips++;
        if (!entry[KEY]) return;
        counts[entry[KEY]] = (counts[entry[KEY]] || 0) + 1;
        tagged++;
      });
    }
    var list = Object.keys(counts).map(function (k) {
      return { k: k, label: labelOf(k), n: counts[k] };
    }).sort(function (a, b) { return b.n - a.n; });
    return { slips: slips, tagged: tagged, list: list, top: list[0] || null };
  }

  function chipsHtml(selected) {
    return REASONS.map(function (r) {
      return '<button type="button" class="rg-chip' + (r.k === selected ? ' on' : '') +
        '" data-rg-reason="pick" data-k="' + r.k + '" aria-pressed="' + (r.k === selected) + '">' +
        esc(r.label) + '</button>';
    }).join('');
  }
  function hideBar() {
    if (!root.document) return;
    var el = root.document.getElementById(BAR_ID);
    if (el) el.remove();
    barId = ''; barDate = '';
  }
  function sheetOpen() {
    var sheet = root.document && root.document.getElementById("sheet");
    return !!(sheet && sheet.classList.contains("on"));
  }
  function syncBarVisibility() {
    var bar = root.document && root.document.getElementById(BAR_ID);
    if (bar && !slipped(barDate, barId)) { hideBar(); return; }
    if (bar) bar.hidden = sheetOpen();
  }
  function showBar(id, date) {
    if (!root.document || !root.document.body) return;
    hideBar();
    barId = id; barDate = date || today();
    var el = root.document.createElement('div');
    el.id = BAR_ID;
    el.className = 'rg-reason-bar';
    el.hidden = sheetOpen();
    el.setAttribute('role', 'group');
    el.setAttribute('aria-label', '记下这次破戒的触发点');
    el.innerHTML = '<div class="rg-reason-q">这次是什么触发的？<span>' + esc(barDate) + ' · 不记也没关系</span></div>' +
      '<p class="rg-reason-privacy">原因随记录保存；启用云同步或导出备份时也会包含。</p>' +
      '<div class="rg-reason-chips">' + chipsHtml('') + '</div>' +
      '<button type="button" class="rg-reason-skip" data-rg-reason="skip">先不记</button>';
    root.document.body.appendChild(el);
  }
  function openSheet(id, date) {
    date = date || today();
    var cur = reasonOf(date, id);
    var sum = summary(90, id);
    var html = '<p class="muted">' + esc(date) + ' 的破戒记录。原因随记录保存；启用云同步或导出备份时也会包含。攒几次可帮助你了解触发点。</p>' +
      '<div class="rg-reason-chips rg-reason-chips-sheet">' + chipsHtml(cur) + '</div>' +
      (cur ? '<button type="button" class="rg-reason-skip" data-rg-reason="clear">清除这条原因</button>' : '') +
      (sum.top ? '<p class="rg-reason-stat">最近 90 天破戒 ' + sum.slips + ' 次，最常见的是「' +
        esc(sum.top.label) + '」' + sum.top.n + ' 次。</p>' : '');
    root.UI.sheet('这次是什么触发的？', html);
    sheetId = id; sheetDate = date;
  }

  function onClick(event) {
    var target = event.target && event.target.closest && event.target.closest('[data-rg-reason]');
    if (target) {
      event.preventDefault();
      var action = target.dataset.rgReason;
      var inBar = !!(target.closest && target.closest('#' + BAR_ID));
      var id = inBar ? barId : sheetId;
      var date = inBar ? barDate : sheetDate;
      if (inBar && sheetOpen()) return;
      if (action === 'skip') { hideBar(); return; }
      if (action === 'open') {
        var rowId = target.dataset.id || sheetId || barId;
        if (rowId) openSheet(rowId, target.dataset.date);
        return;
      }
      if (action === 'clear') {
        if (!id) return;
        if (setReason(date, id, '')) {
          if (barId === id && barDate === date) hideBar();
          sheetId = ''; sheetDate = '';
          root.UI.closeSheet(); root.UI.render(); U().toast('已清除');
        } else U().toast('这天的记录已变化，无法清除原因');
        return;
      }
      if (action === 'pick') {
        if (!id) return;
        if (setReason(date, id, target.dataset.k)) {
          if (inBar || (barId === id && barDate === date)) hideBar();
          var sheet = root.document.getElementById('sheet');
          if (sheet && sheet.classList.contains('on') && target.closest && target.closest('#sheetBody')) { sheetId = ''; sheetDate = ''; root.UI.closeSheet(); }
          root.UI.render();
          U().toast('记下了，下次更容易躲开');
        } else {
          U().toast('这天没有破戒记录');
        }
        return;
      }
    }
    /* 应用自己的「没忍住，记一笔」：等它处理完再看结果（它是个开关，撤销时不问） */
    var slipBtn = event.target && event.target.closest && event.target.closest('[data-act="slip"]');
    if (slipBtn) {
      var sid = slipBtn.dataset.id, slipDate = today();
      setTimeout(function () {
        if (!sid) return;
        if (slipped(slipDate, sid)) {
          if (!reasonOf(slipDate, sid)) showBar(sid, slipDate);
        } else {
          if (barId === sid && barDate === slipDate) hideBar();
          if (reasonOf(slipDate, sid)) setReason(slipDate, sid, '');
        }
      }, 60);
    }
  }

  function install() {
    if (installed || !root.Store || !root.UI || !root.U) return false;
    installed = true;
    root.document.addEventListener('click', onClick, true);
    var sheet = root.document.getElementById && root.document.getElementById('sheet');
    if (sheet && root.MutationObserver) new root.MutationObserver(syncBarVisibility).observe(sheet, {attributes:true, attributeFilter:['class']});
    root.document.addEventListener('rg:slip', function (event) {
      var detail = event && event.detail || {};
      if (detail.id) showBar(detail.id, detail.date);
    });
    /* 习惯菜单里补一条入口：今天破了但没记原因时出现 */
    var originalMenu = root.UI.openHabitMenu;
    if (typeof originalMenu === 'function') {
      root.UI.openHabitMenu = function (id) {
        var date = today();
        var result = originalMenu.apply(this, arguments);
        try {
          if (id && slipped(date, id)) {
            var body = root.document.getElementById('sheetBody');
            if (body) body.insertAdjacentHTML('beforeend',
              '<button type="button" class="btn block ghost rg-menu-reason" data-rg-reason="open" data-id="' + esc(id) + '" data-date="' + esc(date) + '">' +
              (reasonOf(date, id) ? '改一下触发原因' : '补记触发原因') + '</button>');
          }
        } catch (e) { }
        return result;
      };
    }
    return true;
  }

  return {
    REASONS: REASONS, install: install, slipped: slipped, reasonOf: reasonOf,
    labelOf: labelOf, setReason: setReason, summary: summary,
    showBar: showBar, hideBar: hideBar, openSheet: openSheet
  };
});
