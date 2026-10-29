/* Local, device/account-scoped drafts. A draft never updates an actual habit. */
(function (factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory;
  else { window.HabitDrafts = factory(window); window.HabitDrafts.install(); }
})(function (root) {
  'use strict';
  var active = null, installed = false, timer = null;
  function scope() {
    var s = root.Store.s;
    return JSON.stringify([s.deviceId || 'local', (s.settings || {}).cloudAccountId || 'local']);
  }
  function key(id) { return scope() + ':' + (id || 'new'); }
  function allowed() { return !(root.Lock && root.Lock.enabled() && root.Lock.scope() === 'all' && !root.Lock.isUnlocked()); }
  function snapshot(id) {
    var raw = {}, body = root.document.getElementById('sheetBody');
    if (!body || !root.document.getElementById('fName')) return null;
    body.querySelectorAll('input[id],select[id],textarea[id]').forEach(function (el) {
      if (el.id[0] === 'f') raw[el.id] = {value:el.value, checked:!!el.checked};
    });
    return {value:root.UI.collectHabit(id), raw:raw};
  }
  function same(a, b) { return JSON.stringify(a) === JSON.stringify(b); }
  function flush() {
    clearTimeout(timer);
    if (!active || active.scope !== scope() || !allowed()) return false;
    var current = snapshot(active.id);
    if (!current) return false;
    var draftKey = active.key, dirty = !same(current, active.baseline);
    var existing = (root.Store.s._habitDrafts || {})[draftKey];
    if ((!dirty && !existing) || (dirty && existing && same(existing.snapshot, current))) return dirty;
    root.Store.commit(function (s) {
      s._habitDrafts = s._habitDrafts || {};
      if (dirty) s._habitDrafts[draftKey] = {snapshot:current, updatedAt:Date.now()};
      else delete s._habitDrafts[draftKey];
    });
    return dirty;
  }
  function beforeSheetChange() { flush(); active = null; }
  function clearSaved(id) {
    clearTimeout(timer);
    var draftKey = active && active.id === id ? active.key : key(id);
    if ((root.Store.s._habitDrafts || {})[draftKey]) root.Store.commit(function(s) { delete s._habitDrafts[draftKey]; });
    active = null;
  }
  function discard() {
    if (!active || active.scope !== scope()) return;
    var ctx = active; clearSaved(ctx.id);
    root.UI.openHabit(ctx.original);
  }
  function install() {
    if (installed || !root.UI || !root.Store) return;
    installed = true;
    var original = root.UI.openHabit;
    root.UI.openHabit = function (item) {
      if (root.Store.isHydrated && !root.Store.isHydrated()) {
        if (root.U && root.U.toast) root.U.toast("正在载入本机记录，请稍后再打开");
        return;
      }
      beforeSheetChange();
      original.call(root.UI, item);
      if (!allowed() || (item && item.deleted)) return;
      var id = item && item.id, baseline = snapshot(id), draftKey = key(id);
      var draft = (root.Store.s._habitDrafts || {})[draftKey];
      if (draft && draft.snapshot && draft.snapshot.value && draft.snapshot.raw) {
        original.call(root.UI, Object.assign({}, item || {}, draft.snapshot.value));
        Object.keys(draft.snapshot.raw).forEach(function (field) {
          var el = root.document.getElementById(field), raw = draft.snapshot.raw[field];
          if (el) { el.value = raw.value; if (el.type === 'checkbox' || el.type === 'radio') el.checked = raw.checked; }
        });
        var body = root.document.getElementById('sheetBody');
        var heading = body.querySelector && body.querySelector(".v63-sheet-head");
        (heading || body).insertAdjacentHTML(heading ? "afterend" : "afterbegin", '<div class="habit-draft-notice" role="status"><span>已恢复上次未保存的内容</span><button type="button" data-habit-draft-discard>丢弃草稿</button></div>');
        if (root.UX && root.UX.bindCounters) root.UX.bindCounters(body);
      }
      active = {id:id, original:item, baseline:baseline, key:draftKey, scope:scope()};
    };
    function schedule() { if (active) { clearTimeout(timer); timer = setTimeout(flush, 300); } }
    root.document.addEventListener('input', schedule);
    root.document.addEventListener('change', schedule);
    root.document.addEventListener('click', function (event) {
      if (event.target.closest('[data-habit-draft-discard]')) { event.preventDefault(); discard(); }
      else schedule();
    });
    function persist() { flush(); if (root.Store.saveNow) root.Store.saveNow(); }
    root.addEventListener('pagehide', persist);
    root.document.addEventListener('visibilitychange', function () { if (root.document.hidden) persist(); });
  }
  if (root.addEventListener) root.addEventListener('rgz:core', install);
  return {install:install, flush:flush, beforeSheetChange:beforeSheetChange, clearSaved:clearSaved, discard:discard};
});
