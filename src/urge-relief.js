/* v64 · 想破戒的那一刻：先撑过 90 秒。
 * 冲动像浪，峰值过去就退了。这里只做三件事：带着呼吸走完 90 秒、
 * 记下「挺过去了」、或者照实记一笔破戒（不评判，接上原因记录）。
 * 不自动打卡、不改任何既有记录口径。
 */
(function (factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory;
  else { window.UrgeRelief = factory(window); window.UrgeRelief.install(); }
})(function (root) {
  'use strict';
  var TOTAL = 90;          /* 秒 */
  var CYCLE = 12;          /* 4 秒吸气 / 4 秒屏住 / 4 秒呼气 */
  var PHASES = [
    { from: 0, to: 4, text: '吸气' },
    { from: 4, to: 8, text: '屏住' },
    { from: 8, to: 12, text: '呼气' }
  ];
  var SHEET_ID = 'rgUrge';
  var installed = false, timer = null, startedAt = 0, activeId = '', undoToken = 0;

  function U() { return root.U; }
  function today() { return U().today(); }
  function state() { return root.Store && root.Store.s; }
  function esc(v) { return U().esc(v == null ? '' : v); }

  /* 纯函数：第 elapsed 秒该做什么 */
  function phaseAt(elapsed) {
    var t = ((elapsed % CYCLE) + CYCLE) % CYCLE;
    for (var i = 0; i < PHASES.length; i++) {
      if (t >= PHASES[i].from && t < PHASES[i].to) return PHASES[i];
    }
    return PHASES[0];
  }
  function remaining(elapsed) { return Math.max(0, TOTAL - Math.floor(elapsed)); }

  function logOf(date, id) {
    var data = state();
    if (!data) return null;
    var day = (data.logs || {})[date];
    return (day && day[id]) || null;
  }
  function urgeOf(date, id) {
    var entry = logOf(date, id);
    return entry ? Number(entry.urge) || 0 : 0;
  }
  function totalUrges(days, habitId) {
    var span = days || 30, data = state(), sum = 0;
    if (!data) return 0;
    for (var i = 0; i < span; i++) {
      var date = U().shiftYmd(today(), -i);
      var day = (data.logs || {})[date] || {};
      Object.keys(day).forEach(function (id) {
        if (habitId && habitId !== id) return;
        var entry = day[id];
        if (entry) sum += Number(entry.urge) || 0;
      });
    }
    return sum;
  }
  /* 挺过去一次：记在当天该习惯的日志上，不动完成状态 */
  function addUrge(date, id) {
    if (!state()) return 0;
    var next = urgeOf(date, id) + 1;
    root.Store.commit(function (data) {
      var day = data.logs[date] || (data.logs[date] = {});
      var entry = day[id] || (day[id] = {});
      entry.urge = next;
    });
    return next;
  }

  function ringHtml() {
    return '<div class="rg-urge-ring" role="timer" aria-label="剩余时间">' +
      '<svg viewBox="0 0 120 120" aria-hidden="true"><circle class="rg-urge-bg" cx="60" cy="60" r="52"></circle>' +
      '<circle class="rg-urge-fg" id="rgUrgeArc" cx="60" cy="60" r="52"></circle></svg>' +
      '<div class="rg-urge-num"><b id="rgUrgeLeft">' + TOTAL + '</b><small>秒</small></div></div>';
  }
  function open(id) {
    var item = (state().items || []).find(function (it) { return it.id === id; });
    if (!item) return false;
    activeId = id;
    var kept = totalUrges(30, id);
    var html = '<div class="rg-urge" id="' + SHEET_ID + '">' +
      '<p class="rg-urge-habit">' + esc(item.name) + '</p>' + ringHtml() +
      '<p class="rg-urge-phase" id="rgUrgePhase">吸气</p>' +
      '<p class="rg-urge-tip">给自己一点时间，跟着呼吸慢慢来。</p>' +
      (kept ? '<p class="rg-urge-stat">最近 30 天，这个习惯你已经挺过 ' + kept + ' 次。</p>' : '') +
      '<div class="rg-urge-acts">' +
      '<button type="button" class="btn block" data-rg-urge="kept">我挺过去了</button>' +
      '<button type="button" class="btn ghost block" data-rg-urge="slip">还是破戒了</button>' +
      '</div>' +
      '<button type="button" class="rg-urge-skip" data-rg-urge="close">先放一放</button>' +
      '</div>';
    root.UI.sheet('先撑过这 90 秒', html);
    startTimer();
    return true;
  }
  function paint() {
    if (!root.document) return;
    var el = root.document.getElementById(SHEET_ID);
    var sheet = root.document.getElementById('sheet');
    if (!el || (sheet && sheet.classList && !sheet.classList.contains('on'))) {
      stopTimer(); activeId = ''; return;
    }
    var elapsed = (Date.now() - startedAt) / 1000;
    var left = root.document.getElementById('rgUrgeLeft');
    var phase = root.document.getElementById('rgUrgePhase');
    var arc = root.document.getElementById('rgUrgeArc');
    if (left) left.textContent = String(remaining(elapsed));
    if (phase) phase.textContent = phaseAt(elapsed).text;
    if (arc) {
      var len = 2 * Math.PI * 52;
      var ratio = Math.min(1, elapsed / TOTAL);
      arc.style.strokeDasharray = len.toFixed(1);
      arc.style.strokeDashoffset = (len * (1 - ratio)).toFixed(1);
    }
    if (elapsed >= TOTAL) {
      stopTimer();
      if (phase) phase.textContent = '时间到了，感觉怎么样？';
      var tip = el.querySelector('.rg-urge-tip');
      if (tip) tip.textContent = '可以按自己的感受选择，也可以先放一放。';
    }
  }
  function startTimer() {
    stopTimer();
    startedAt = Date.now();
    paint();
    timer = setInterval(paint, 250);
  }
  function stopTimer() {
    if (timer) { clearInterval(timer); timer = null; }
  }
  function close() {
    stopTimer();
    activeId = '';
    var el = root.document.getElementById(SHEET_ID);
    if (el) root.UI.closeSheet();
  }
  function identity(data) {
    var signed = '';
    try { signed = root.Cloud && root.Cloud.uid ? root.Cloud.uid() || '' : ''; } catch (e) { }
    return JSON.stringify([data.deviceId || '', (data.settings || {}).cloudAccountId || '', signed]);
  }
  function keep() {
    var id = activeId;
    if (!id) return 0;
    var date = today(), data = state(), scope = identity(data), token = ++undoToken;
    var own = Object.prototype.hasOwnProperty;
    var hadDay = own.call(data.logs || {}, date), priorDay = (data.logs || {})[date];
    var hadEntry = !!priorDay && own.call(priorDay, id), priorEntry = hadEntry && priorDay[id];
    var hadUrge = !!priorEntry && own.call(priorEntry, 'urge'), priorUrge = hadUrge ? priorEntry.urge : undefined;
    var count = addUrge(date, id), recordedEntry = logOf(date, id), used = false;
    close();
    root.UI.render();
    if (typeof U().showUndo === 'function') {
      U().showUndo('已记录 · 挺过一次', '撤销', function () {
        if (used || token !== undoToken) return;
        used = true;
        var current = state(), entry = current && current.logs && current.logs[date] && current.logs[date][id];
        if (current !== data || !current || identity(current) !== scope || !entry || entry !== recordedEntry || Number(entry.urge) !== count || count < 1) {
          U().toast('记录或账号已变化，无法撤销这次记录');
          return;
        }
        root.Store.commit(function (next) {
          var day = next.logs[date], log = day[id];
          if (hadUrge) log.urge = priorUrge; else delete log.urge;
          if (!hadEntry && Object.keys(log).length === 0) delete day[id];
          if (!hadDay && Object.keys(day).length === 0) delete next.logs[date];
        });
        root.UI.render();
        U().toast('已撤销刚才的记录');
      }, 8000);
    } else U().toast('记下了 · 这一关过了');
    return count;
  }
  function giveUp() {
    var id = activeId;
    if (!id) return false;
    var item = (state().items || []).find(function (it) { return it.id === id; });
    close();
    if (!item) return false;
    var date = today();
    if ((logOf(date, id) || {}).slip) {
      U().toast('今天已经记录过破戒，可以补记触发原因');
      return false;
    }
    if (!root.Engine.slip(item, date)) return false;
    root.Store.commit();
    root.UI.render();
    U().toast('记下了 · 明天继续，别自责');
    try {
      root.document.dispatchEvent(new CustomEvent('rg:slip', { detail: { id: id, date: date } }));
    } catch (e) { }
    return true;
  }

  function onClick(event) {
    var target = event.target && event.target.closest && event.target.closest('[data-rg-urge]');
    if (!target) return;
    event.preventDefault();
    var action = target.dataset.rgUrge;
    if (action === 'kept') keep();
    else if (action === 'slip') giveUp();
    else if (action === 'close') close();
    else if (action === 'open') {
      /* sheet 自身会替换旧内容，并保留原入口的焦点和返回层级。 */
      open(target.dataset.id);
    }
  }

  function install() {
    if (installed || !root.Store || !root.UI || !root.Engine) return false;
    installed = true;
    root.document.addEventListener('click', onClick, true);
    /* 关闭弹层的其它路径（点遮罩、Esc）也要停表 */
    var originalClose = root.UI.closeSheet;
    if (typeof originalClose === 'function') {
      root.UI.closeSheet = function () {
        stopTimer();
        activeId = '';
        return originalClose.apply(this, arguments);
      };
    }
    var originalMenu = root.UI.openHabitMenu;
    if (typeof originalMenu === 'function') {
      root.UI.openHabitMenu = function (id) {
        var result = originalMenu.apply(this, arguments);
        try {
          var item = (state().items || []).find(function (it) { return it.id === id; });
          if (item && root.Engine.isAvoid(item)) {
            var body = root.document.getElementById('sheetBody');
            if (body) body.insertAdjacentHTML('beforeend',
              '<button type="button" class="btn block ghost rg-menu-urge" data-rg-urge="open" data-id="' + esc(id) + '">' +
              '现在很想破戒 · 先撑 90 秒</button>');
          }
        } catch (e) { }
        return result;
      };
    }
    return true;
  }

  return {
    TOTAL: TOTAL, phaseAt: phaseAt, remaining: remaining,
    urgeOf: urgeOf, totalUrges: totalUrges, addUrge: addUrge,
    open: open, keep: keep, giveUp: giveUp, install: install
  };
});
