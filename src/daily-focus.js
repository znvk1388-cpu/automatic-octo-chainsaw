/* v63 · One optional daily priority, using the existing check-in and note flows. */
(function (root) {
  'use strict';

  var installed = false;
  var KEY = 'dailyFocus';
  function today() { return root.U.today(); }
  function esc(value) { return root.U.esc(value == null ? '' : value); }
  function state() { return root.Store && root.Store.s; }
  function eligible() {
    if (!state() || !root.Engine) return [];
    return root.Engine.sorted().filter(function (item) {
      return !item.deleted && !item.archived && root.Engine.isDue(item, today()) &&
        !root.Engine.isSkipped(today(), item.id);
    });
  }
  function current() {
    var data = state(), saved = data && data.settings && data.settings[KEY];
    if (!saved || saved.date !== today()) return null;
    return eligible().find(function (item) { return item.id === saved.itemId; }) || null;
  }
  function select(id) {
    var item = eligible().find(function (entry) { return entry.id === id; });
    if (!item) return false;
    root.Store.commit(function (data) {
      data.settings[KEY] = { date: today(), itemId: item.id };
    });
    return true;
  }
  function clear() {
    if (!state()) return;
    root.Store.commit(function (data) { delete data.settings[KEY]; });
  }
  function prerequisite(item) {
    if (!item || !item.dependsOn) return null;
    var before = (state().items || []).find(function (entry) { return entry.id === item.dependsOn; });
    if (root.Engine.isDone(before || {}, today())) return null;
    return { id: item.dependsOn, name: before && before.name || '' };
  }
  function status(item) {
    if (root.Engine.isMiniDone && root.Engine.isMiniDone(item, today())) return '轻量完成';
    if (root.Engine.isDone(item, today())) return '已完成';
    if (prerequisite(item)) return '等待前置习惯';
    if (root.Engine.isPartial && root.Engine.isPartial(item, today())) return '部分完成';
    var log = root.Engine.getLog(today(), item.id);
    return log && Number(log.v) > 0 ? '已开始' : '待完成';
  }
  function html() {
    var list = eligible(), item = current();
    // A first, single habit already has a clear next action. Avoid another card until chosen.
    if (!item && list.length < 2) return '';
    var result = '<section class="v63-focus" id="v63DailyFocus" aria-labelledby="v63FocusTitle">' +
      '<div class="v63-focus-head"><span id="v63FocusTitle"><svg class="p-icon" aria-hidden="true"><use href="assets/icons.svg#star"></use></svg>今日重点</span>' +
      '<button class="v63-focus-link" data-v63-focus="choose">' + (item ? '更换' : '选一件') + '</button></div>';
    if (!item) return result + '<p class="v63-focus-empty">从今天的习惯里选一件，先把这一小步做好。</p></section>';
    var done = root.Engine.isDone(item, today()), label = status(item), before = done ? null : prerequisite(item);
    var note = root.Engine.noteOf ? root.Engine.noteOf(item.id, today()) : '';
    result += '<div class="v63-focus-main"><strong>' + esc(item.name) + '</strong><span class="v63-focus-state' +
      (done ? ' done' : '') + '">' + label + '</span></div>';
    if (item.type === 'duration' && Number.isFinite(Number(item.target)) && Number(item.target) > 0)
      result += '<p class="v63-focus-note">目标：' + esc(item.target) + ' ' + esc(item.unit || '分钟') + '</p>';
    if (note) result += '<p class="v63-focus-note">' + esc(note) + '</p>';
    else if (label === '轻量完成') result += '<p class="v63-focus-note">做了最小版本，也向前走了一步。</p>';
    if (before) result += '<p class="v63-focus-dependency" id="v63FocusDependency">' +
      (before.name ? '请先完成「' + esc(before.name) + '」，再做这件事。' : '前置习惯不可用，请检查这个习惯的依赖设置。') + '</p>';
    var action = item.type === 'check' || item.type === 'avoid' ? 'tick' : 'quickadd';
    var text = item.type === 'check' || item.type === 'avoid' ? '完成打卡' : '记一笔';
    if (item.type === 'duration') {
      action = root.Timer && root.Timer.isFor(item.id) ? 'timeropen' : 'timerstart';
      text = action === 'timeropen' ? '查看计时' : '开始计时';
    }
    result += '<div class="v63-focus-actions">' + (done ?
      '<button class="btn sm ghost" data-v63-focus="note" data-id="' + esc(item.id) + '">' + (note ? '修改这一句' : '记一句收获') + '</button>' :
      before ? '<button class="btn sm" disabled aria-disabled="true" aria-describedby="v63FocusDependency">先完成前置习惯</button>' :
        '<button class="btn sm" data-act="' + action + '" data-id="' + esc(item.id) + '" aria-label="今日重点：' + esc(text + ' ' + item.name) + '">' + text + '</button>') +
      '<button class="v63-focus-link" data-v63-focus="clear" aria-label="取消今日重点">取消重点</button></div></section>';
    return result;
  }
  function refresh() {
    if (!root.UI || root.UI.tab !== 'today' || !root.document) return;
    var existing = root.document.getElementById('v63DailyFocus'), content = html();
    if (existing) {
      if (existing.outerHTML === content) return;
      var active = root.document.activeElement;
      var restoreFocus = existing.contains && existing.contains(active);
      var previousAction = active && active.dataset && active.dataset.v63Focus;
      if (content) existing.outerHTML = content;
      else existing.remove();
      if (content && restoreFocus) {
        var replacement = root.document.getElementById('v63DailyFocus');
        if (replacement) {
          var buttons = Array.from(replacement.querySelectorAll('button'));
          var next = buttons.find(function (button) { return previousAction && button.dataset.v63Focus === previousAction; }) ||
            buttons.find(function (button) { return button.dataset.v63Focus === 'note' || button.dataset.act; }) || buttons[0];
          if (next) next.focus({ preventScroll: true });
        }
      }
      return;
    }
    var header = root.document.querySelector('#view .p-today-head');
    if (header && content) header.insertAdjacentHTML('afterend', content);
  }
  function picker() {
    var list = eligible(), selected = current();
    var content = '<p class="muted">今天先把哪一件做好？随时可以更换，不改变原来的习惯安排。</p>';
    if (!list.length) content += '<p>今天没有可选的习惯，休息一下也可以。</p>';
    else content += '<div class="v63-focus-list">' + list.map(function (item) {
      return '<button class="v63-focus-option" data-v63-focus="select" data-id="' + esc(item.id) +
        '" aria-pressed="' + !!(selected && selected.id === item.id) + '"><span>' + esc(item.name) +
        '</span><small>' + status(item) + '</small></button>';
    }).join('') + '</div>';
    root.UI.sheet('选一件今日重点', content);
  }
  function handleClick(event) {
    var target = event.target && event.target.closest && event.target.closest('[data-v63-focus]');
    if (!target) return;
    event.preventDefault();
    var action = target.dataset.v63Focus;
    if (action === 'choose') picker();
    else if (action === 'select') {
      if (!select(target.dataset.id)) return;
      root.UI.closeSheet();
      root.UI.render();
    } else if (action === 'clear') {
      clear();
      root.UI.render();
    } else if (action === 'note') {
      var item = current();
      if (item && item.id === target.dataset.id) root.UI.openNoteSheet(item.id, today());
    } else if (action === 'menu') {
      if (!select(target.dataset.id)) return;
      root.UI.closeSheet();
      root.UI.render();
      root.U.toast('已设为今日重点');
    }
  }
  function install() {
    if (installed || !root.Engine || !root.Product || !root.UI || !root.Store) return false;
    installed = true;
    var originalHeader = root.Product.todayHeader;
    root.Product.todayHeader = function () { return originalHeader.apply(this, arguments) + html(); };
    var originalMenu = root.UI.openHabitMenu;
    root.UI.openHabitMenu = function (id) {
      var result = originalMenu.apply(this, arguments);
      if (eligible().some(function (item) { return item.id === id; })) {
        var body = root.document.getElementById('sheetBody'), item = current();
        if (body && !(item && item.id === id)) body.insertAdjacentHTML('beforeend',
          '<button class="btn block ghost v63-menu-focus" data-v63-focus="menu" data-id="' + esc(id) + '">设为今日重点</button>');
      }
      return result;
    };
    root.document.addEventListener('click', handleClick);
    root.Store.onChange(refresh);
    // If hydration already rendered the header, insert only this section. Unsaved inputs stay intact.
    refresh();
    return true;
  }
  root.DailyFocus = { eligible: eligible, current: current, select: select, clear: clear, prerequisite: prerequisite, status: status, html: html, install: install };
  if (!install()) root.document.addEventListener('rgz:core', install, { once: true });
})(window);
