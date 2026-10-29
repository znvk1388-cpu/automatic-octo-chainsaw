/* Preserve diary text branches on top of the existing record-level sync model. */
(function (root) {
  'use strict';
  var installed = false, KEY = 'textConflicts';
  function copy(value) { return JSON.parse(JSON.stringify(value)); }
  function stable(value) { return root.SyncModel.canonical(value); }
  function path(day) { return JSON.stringify(['notes', day, 'body']); }
  function compare(a, b) { return a[0] - b[0] || (a[1] === b[1] ? 0 : a[1] > b[1] ? 1 : -1); }
  function validClock(value) { return Array.isArray(value) && Number.isFinite(value[0]) && typeof value[1] === 'string'; }
  function scope(data) {
    var bound = data.settings && data.settings.cloudAccountId || '', signed = root.Cloud && root.Cloud.uid() || '';
    if (bound && signed && bound !== signed) throw new Error('本机记录属于另一个账号，本次日记同步已停止');
    return {owner: bound || signed, deviceId: data.deviceId || 'local'};
  }
  function version(data, day) {
    var note = data.notes && data.notes[day], rec = data._sync && data._sync.records && data._sync.records[path(day)];
    return {text: String(note && note.text || ''), clock: copy(rec && validClock(rec.clock) ? rec.clock : [Number(note && note.updatedAt) || 0, 'legacy']), present: !!note};
  }
  function baseOf(data, current) {
    var base = data._sync && data._sync.diaryBase;
    return base && base.version === 1 && base.owner === current.owner && base.deviceId === current.deviceId ? base : null;
  }
  function invalidate(data) { if (data && data._sync) delete data._sync.diaryBase; }
  function ack(data, payload, request) {
    var current;
    try { current = scope(data); } catch (_) { return false; }
    if (!payload || !request || request.owner !== current.owner || request.deviceId !== current.deviceId) return false;
    var notes = {};
    Object.keys(payload.notes || {}).forEach(function (day) { notes[day] = version(payload, day); });
    data._sync = data._sync || {version: 1, records: {}};
    data._sync.diaryBase = {version: 1, owner: current.owner, deviceId: current.deviceId, notes: notes};
    return true;
  }
  function signature(entry) { return stable([entry.day, entry.owner, [entry.local.text, entry.remote.text].sort()]); }
  function hash(text) {
    var a = 2166136261, b = 2246822519;
    for (var i = 0; i < text.length; i++) { a = Math.imul(a ^ text.charCodeAt(i), 16777619); b = Math.imul(b ^ text.charCodeAt(i), 3266489917); }
    return (a >>> 0).toString(36) + '-' + (b >>> 0).toString(36) + '-' + text.length.toString(36);
  }
  function validEntry(entry, day, owner) {
    return entry && typeof entry.id === 'string' && entry.day === day && entry.owner === owner &&
      entry.local && typeof entry.local.text === 'string' && validClock(entry.local.clock) &&
      entry.remote && typeof entry.remote.text === 'string' && validClock(entry.remote.clock) &&
      (!entry.resolution || typeof entry.resolution.text === 'string' && validClock(entry.resolution.clock));
  }
  function entries(note, day, owner, adoptGuest) {
    var result = {}, values = note && note[KEY];
    if (!values) return result;
    if (typeof values !== 'object' || Array.isArray(values)) throw new Error('日记冲突副本格式不正确');
    Object.keys(values).forEach(function (id) {
      var entry = values[id];
      if (entry && entry.owner === '' && owner && adoptGuest) { entry = copy(entry); entry.owner = owner; }
      // A backup from another account must not become this account's conflict data.
      if (entry && entry.owner !== owner) return;
      if (!validEntry(entry, day, owner) || entry.id !== id) throw new Error('日记冲突副本格式不正确');
      result[id] = copy(entry);
    });
    return result;
  }
  function unite(a, b) {
    var result = copy(a);
    Object.keys(b).forEach(function (id) {
      if (!result[id]) { result[id] = copy(b[id]); return; }
      var left = result[id], right = b[id];
      if (signature(left) !== signature(right)) throw new Error('日记冲突副本标识重复');
      var first = copy(left), second = copy(right), resolution;
      delete first.resolution; delete second.resolution;
      result[id] = stable(first) < stable(second) ? first : second;
      if (left.resolution && right.resolution) {
        var order = compare(left.resolution.clock, right.resolution.clock);
        resolution = order > 0 || order === 0 && stable(left.resolution) > stable(right.resolution) ? left.resolution : right.resolution;
      } else resolution = left.resolution || right.resolution;
      if (resolution) result[id].resolution = copy(resolution);
    });
    return result;
  }
  function plan(data, remote) {
    var current = scope(data), base = baseOf(data, current), result = {}, texts = {};
    new Set(Object.keys(data.notes || {}).concat(Object.keys(remote.notes || {}))).forEach(function (day) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return;
      var local = version(data, day), other = version(remote, day), remoteRecord = remote._sync && remote._sync.records && remote._sync.records[path(day)];
      var all = unite(entries(data.notes && data.notes[day], day, current.owner, true), entries(remote.notes && remote.notes[day], day, current.owner));
      var previous = base && base.notes[day] || {text: '', clock: [0, 'legacy']};
      // Text shares a legacy body record with weather; preserve the sole changed text branch.
      if (base && local.text !== previous.text && other.text === previous.text) texts[day] = local.text;
      if (base && local.text === previous.text && other.text !== previous.text && compare(other.clock, previous.clock) > 0) texts[day] = other.text;
      var changed = local.text !== other.text && (base ? local.text !== previous.text && other.text !== previous.text && compare(other.clock, previous.clock) > 0 : local.present && (other.present || remoteRecord && remoteRecord.deleted));
      // Repeated pulls of an already preserved losing branch must not reopen a resolved conflict.
      if (changed && compare(local.clock, other.clock) > 0 && Object.values(all).some(function (entry) {
        return [entry.local, entry.remote].some(function (branch) { return branch.text === other.text && compare(branch.clock, other.clock) === 0; });
      })) changed = false;
      if (changed) {
        var entry = {id: '', day: day, owner: current.owner, local: {text: local.text, clock: local.clock}, remote: {text: other.text, clock: other.clock}, reason: base ? 'concurrent' : 'unknown-base'};
        var sig = signature(entry), duplicate = Object.keys(all).find(function (id) { return signature(all[id]) === sig; });
        if (!duplicate) {
          var id = 'dc-' + hash(sig), index = 0;
          while (all[id] && signature(all[id]) !== sig) id = 'dc-' + hash(sig) + '-' + (++index);
          entry.id = id; all[id] = entry;
        }
      }
      if (Object.keys(all).length) result[day] = all;
    });
    return {copies: result, texts: texts};
  }
  function attach(data, planned) {
    var changed = 0;
    Object.keys(planned.copies).forEach(function (day) {
      data.notes = data.notes || {};
      var note = data.notes[day] || (data.notes[day] = {text: '', photos: [], audios: [], videos: []});
      if (stable(note[KEY] || {}) !== stable(planned.copies[day])) { note[KEY] = planned.copies[day]; changed++; }
    });
    Object.keys(planned.texts).forEach(function (day) {
      data.notes = data.notes || {};
      var note = data.notes[day] || (data.notes[day] = {text: '', photos: [], audios: [], videos: []});
      if (note.text !== planned.texts[day]) { note.text = planned.texts[day]; changed++; }
    });
    return changed;
  }
  function list(day) {
    var data = root.Store && root.Store.s;
    if (!data) return [];
    var current = scope(data);
    return Object.values(entries(data.notes && data.notes[day], day, current.owner, true)).sort(function (a, b) { return a.id.localeCompare(b.id); });
  }
  function flush() {
    if (root.document && root.CustomEvent) root.document.dispatchEvent(new root.CustomEvent('rigong:before-sync'));
  }
  function nextClock(data) {
    var at = Date.now();
    Object.values(data._sync && data._sync.records || {}).forEach(function (rec) { if (validClock(rec.clock)) at = Math.max(at, rec.clock[0] + 1); });
    return [at, data.deviceId || 'local'];
  }
  function resolve(day, id, choice, text) {
    if (!['local', 'remote', 'merged'].includes(choice)) return false;
    flush();
    var entry = list(day).find(function (value) { return value.id === id; });
    if (!entry || choice === 'merged' && typeof text !== 'string') return false;
    var value = choice === 'merged' ? text : entry[choice].text;
    root.Store.commit(function (data) {
      var note = data.notes[day];
      note.text = value; note.updatedAt = Date.now();
      note[KEY][id].resolution = {choice: choice, text: value, clock: nextClock(data)};
    });
    return true;
  }
  function esc(value) { return String(value == null ? '' : value).replace(/[&<>"']/g, function (c) { return {'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]; }); }
  function comparison(day, id) {
    var entry = list(day).find(function (value) { return value.id === id; });
    if (!entry) return '';
    var attrs = ' data-day="' + esc(day) + '" data-id="' + esc(id) + '"';
    var current = version(root.Store.s, day).text;
    return '<p class="muted">' + esc(day) + ' 的两段文字都已保存。选择或合并后，原始副本仍可查看。</p>' +
      '<div class="dc-versions"><div><label>保留版本一</label><pre>' + esc(entry.local.text || '（空白正文）') + '</pre><button class="btn ghost" data-diary-conflict="local"' + attrs + '>使用版本一</button></div>' +
      '<div><label>保留版本二</label><pre>' + esc(entry.remote.text || '（空白正文）') + '</pre><button class="btn ghost" data-diary-conflict="remote"' + attrs + '>使用版本二</button></div></div>' +
      '<div class="field"><label for="diaryConflictMerged">手动合并（从当前正文继续）</label><textarea class="input" id="diaryConflictMerged" rows="8">' + esc(current) + '</textarea></div>' +
      '<button class="btn" data-diary-conflict="merged"' + attrs + '>保存合并正文</button>';
  }
  function notice(day) {
    var all = list(day);
    if (!all.length) return '';
    var pending = all.filter(function (entry) { return !entry.resolution; }).length;
    return '<div class="card dc-notice" id="diaryConflictNotice"><strong>' + (pending ? '发现日记文字冲突，双方已保留' : '已保留日记冲突副本') + '</strong><p class="muted">' +
      (pending ? '有 ' + pending + ' 组文字需要比较；可以稍后处理。' : '原始文字仍可查看和重新使用。') + '</p>' + all.map(function (entry, index) {
        return '<button class="btn ghost sm" data-diary-conflict="compare" data-day="' + esc(day) + '" data-id="' + esc(entry.id) + '">比较副本 ' + (index + 1) + (entry.resolution ? '（已处理）' : '') + '</button>';
      }).join(' ') + '</div>';
  }
  function refresh() {
    if (!root.document || !root.UI || !root.Store.s) return;
    var old = root.document.getElementById('diaryConflictNotice');
    if (old && old.remove) old.remove();
    var editor = root.document.getElementById('dyText');
    if (!editor || !root.UI.diaryState) return;
    var html;
    try { html = notice(root.UI.diaryState().date); } catch (_) { return; }
    if (html && editor.parentElement) editor.parentElement.insertAdjacentHTML('beforebegin', html);
  }
  function install() {
    if (installed || !root.SyncModel || !root.Store) return;
    installed = true;
    var originalPayload = root.SyncModel.payload, originalMerge = root.SyncModel.merge;
    root.SyncModel.payload = function (data) {
      var current = scope(data), result = originalPayload(data);
      if (result._sync) delete result._sync.diaryBase;
      Object.keys(result.notes || {}).forEach(function (day) {
        var all = entries(result.notes[day], day, current.owner, true);
        if (Object.keys(all).length) result.notes[day][KEY] = all;
        else delete result.notes[day][KEY];
      });
      return result;
    };
    root.SyncModel.merge = function (data, remote) {
      root.SyncModel.validate(remote);
      if (!remote || !Array.isArray(remote.items) || typeof remote.logs !== 'object') return originalMerge(data, remote);
      // Observe pending local edits before comparing their clocks; original merge remains authoritative.
      scope(data); root.SyncModel.observe(data);
      var planned = plan(data, remote), changed = originalMerge(data, remote), added = attach(data, planned);
      if (added) root.SyncModel.observe(data);
      return changed + added;
    };
    if (root.Store.importJSON) {
      var originalImport = root.Store.importJSON;
      root.Store.importJSON = async function () {
        var previous = root.Store.s, previousScope = previous && scope(previous), saved = {};
        if (previous && arguments[1] !== 'replace') Object.keys(previous.notes || {}).forEach(function (day) {
          var all = entries(previous.notes[day], day, previousScope.owner, true);
          if (Object.keys(all).length) saved[day] = all;
        });
        var result = await originalImport.apply(this, arguments);
        var data = root.Store.s, currentScope;
        invalidate(data);
        try { currentScope = scope(data); } catch (_) { currentScope = null; }
        if (previousScope && currentScope && previousScope.owner === currentScope.owner && previousScope.deviceId === currentScope.deviceId) {
          Object.keys(saved).forEach(function (day) { saved[day] = unite(saved[day], entries(data.notes && data.notes[day], day, currentScope.owner, true)); });
          attach(data, {copies: saved, texts: {}});
        }
        await root.Store.saveNow(); return result;
      };
    }
    if (root.UI && root.UI.render) {
      var originalRender = root.UI.render;
      root.UI.render = function () { var result = originalRender.apply(this, arguments); refresh(); return result; };
    }
    if (root.Store.onChange) root.Store.onChange(refresh);
    // UI.go() calls its internal renderer directly, so also refresh after that renderer's event.
    if (root.document) root.document.addEventListener('rigong:before-render', function () { if (root.setTimeout) root.setTimeout(refresh, 0); });
    if (root.document) root.document.addEventListener('click', function (event) {
      var button = event.target && event.target.closest && event.target.closest('[data-diary-conflict]');
      if (!button) return;
      event.preventDefault();
      var action = button.dataset.diaryConflict, day = button.dataset.day, id = button.dataset.id;
      if (action === 'compare') { flush(); root.UI.sheet('比较日记文字', comparison(day, id)); return; }
      var field = root.document.getElementById('diaryConflictMerged');
      if (resolve(day, id, action, field && field.value)) { root.UI.closeSheet(); root.UI.render(); if (root.U) root.U.toast('正文已保存，原始副本仍保留'); }
    });
    refresh();
  }
  root.DiaryConflicts = {ack: ack, invalidate: invalidate, list: list, resolve: resolve, comparison: comparison, notice: notice, refresh: refresh, install: install};
  if (root.addEventListener) root.addEventListener('rgz:core', install, {once: true});
  install();
})(window);
