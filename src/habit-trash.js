/* Single-habit recovery. Metadata stays on the existing synced and backed-up item. */
(function (root) {
  'use strict';

  var installed = false;
  function state() { return root.Store && root.Store.s; }
  function find(id) {
    return state() && (state().items || []).find(function (item) { return item.id === id; });
  }
  function esc(value) { return root.U.esc(value == null ? '' : value); }

  function remove(id) {
    var item = find(id);
    if (!item) return {ok: false, msg: '找不到这个习惯'};
    if (item.deleted) return {ok: false, msg: '这个习惯已在回收站中'};
    if (!root.Feat || !root.Feat.removeItem) return {ok: false, msg: '习惯功能还未就绪，请稍后再试'};
    var links = [];
    (state().bundles || []).forEach(function (bundle) {
      var ids = bundle.itemIds || [], index = ids.indexOf(id);
      if (bundle.deleted || index < 0) return;
      links.push({id: bundle.id, index: index, beforeId: ids[index - 1] || null, afterId: ids[index + 1] || null});
    });
    // The existing removeItem commit saves metadata and deletion as one record.
    item.deletedAt = Date.now();
    item.trashBundles = links;
    root.Feat.removeItem(id);
    return {ok: true, id: item.id, name: item.name, msg: '习惯已移入回收站'};
  }

  function restore(id) {
    var item = find(id);
    if (!item) return {ok: false, msg: '找不到这个习惯，记录可能尚未同步'};
    if (!item.deleted) return {ok: false, msg: '这个习惯已经恢复'};
    var hasLinks = Array.isArray(item.trashBundles), links = hasLinks ? item.trashBundles : [];
    var skipped = 0;
    root.Store.commit(function (data) {
      links.forEach(function (link) {
        if (!link || typeof link.id !== 'string') return;
        var bundle = (data.bundles || []).find(function (entry) { return entry.id === link.id && !entry.deleted; });
        if (!bundle) { skipped++; return; }
        var ids = bundle.itemIds || (bundle.itemIds = []);
        if (ids.indexOf(id) >= 0) return;
        var after = link.afterId == null ? -1 : ids.indexOf(link.afterId);
        var before = link.beforeId == null ? -1 : ids.indexOf(link.beforeId);
        var index = after >= 0 ? after : before >= 0 ? before + 1 :
          Number.isInteger(link.index) && link.index >= 0 ? Math.min(link.index, ids.length) : ids.length;
        // Insert just this habit; retain renamed bundles and all current members.
        ids.splice(index, 0, id);
        bundle.updatedAt = Date.now();
      });
      item.deleted = false;
      item.updatedAt = Date.now();
      delete item.deletedAt;
      delete item.trashBundles;
    });
    return {
      ok: true, id: item.id, name: item.name,
      msg: !hasLinks ? '习惯已恢复；旧版未保存套餐关联，请按需手动加入套餐' :
        skipped ? '习惯已恢复；原来已删除的套餐没有重建' : '习惯已恢复'
    };
  }

  function list() {
    return ((state() && state().items) || []).filter(function (item) { return item.deleted; })
      .slice().sort(function (a, b) { return (Number(b.deletedAt) || 0) - (Number(a.deletedAt) || 0); })
      .map(function (item) {
        return {
          id: item.id, name: item.name,
          deletedAt: Number(item.deletedAt) || null,
          hasBundleHistory: Array.isArray(item.trashBundles),
          bundleCount: Array.isArray(item.trashBundles) ? item.trashBundles.length : null
        };
      });
  }

  function open() {
    if (!root.UI || !root.UI.sheet) return false;
    var items = list();
    var content = '<p class="muted">恢复习惯会保留原有打卡和目标历史。原套餐仍在时会重新加入，已删除的套餐不会重建。这里的记录不会自动清除。</p>';
    if (!items.length) content += '<p class="muted" role="status">暂无已删除的习惯。</p>';
    else content += '<div class="v19-share-list">' + items.map(function (item) {
      var date = item.deletedAt ? new Date(item.deletedAt) : null;
      var label = date && Number.isFinite(date.getTime()) ? root.U.ymd(date) + ' 删除' : '删除时间未记录';
      return '<div class="v19-share-row"><div><b>' + esc(item.name) + '</b><p class="muted">' + esc(label) +
        (!item.hasBundleHistory ? ' · 旧版未保存套餐关联，恢复后可手动加入套餐' : '') +
        '</p></div><button type="button" class="btn sm ghost" data-habit-trash-action="restore" data-id="' + esc(item.id) +
        '" aria-label="恢复 ' + esc(item.name) + '">恢复</button></div>';
    }).join('') + '</div>';
    root.UI.sheet('习惯回收站', content);
    return true;
  }

  function handleClick(event) {
    var button = event.target && event.target.closest && event.target.closest('[data-habit-trash-action]');
    if (!button || button.disabled) return;
    event.preventDefault();
    if (button.dataset.habitTrashAction === 'open') { open(); return; }
    if (button.dataset.habitTrashAction !== 'restore') return;
    var result = restore(button.dataset.id);
    root.U.toast(result.msg);
    if (result.ok && root.UI && root.UI.render) root.UI.render();
    open();
  }

  function install() {
    if (installed) return true;
    if (!root.Store || !root.Feat || !root.document || !root.UI || !root.U) return false;
    root.document.addEventListener('click', handleClick);
    installed = true;
    return true;
  }

  root.HabitTrash = {install: install, remove: remove, restore: restore, list: list, open: open};
  if (!install()) root.addEventListener('rgz:core', install, {once: true});
})(window);
