/* Date-effective habit rules and immutable measurement snapshots.
 * Loaded before app.bundle.js; this module performs no storage or DOM work.
 * Both histories live inside existing item/log records so normal backup and
 * record-level cloud sync preserve them without a separate storage migration.
 */
(function (root) {
  'use strict';

  const DATE = /^\d{4}-\d{2}-\d{2}$/;
  const MEASUREMENT = ['type', 'target', 'unit', 'steps', 'schedule', 'restPerWeek', 'restPerMonth'];
  const RULES = MEASUREMENT.concat(['archived', 'pausedFrom', 'pausedUntil']);
  const clone = value => value == null ? value : JSON.parse(JSON.stringify(value));
  const today = () => root.U ? root.U.today() : new Date().toISOString().slice(0, 10);
  const own = (object, key) => Object.prototype.hasOwnProperty.call(object, key);
  const state = () => root.Store && root.Store.s;
  const editing = new WeakMap();

  function dateOf(timestamp, fallback) {
    const date = new Date(timestamp);
    if (!Number.isFinite(date.getTime())) return fallback;
    if (root.U) return root.U.ymd(date);
    return date.getFullYear() + '-' + String(date.getMonth() + 1).padStart(2, '0') + '-' + String(date.getDate()).padStart(2, '0');
  }

  function snapshot(item) {
    return {
      type: item.type || 'check',
      target: item.target == null ? null : item.target,
      unit: item.unit || '',
      steps: clone(item.steps || []),
      schedule: clone(item.schedule || {type: 'daily'}),
      restPerWeek: Number(item.restPerWeek) || 0,
      restPerMonth: Number(item.restPerMonth) || 0,
      archived: !!item.archived,
      pausedFrom: item.pausedFrom || null,
      pausedUntil: item.pausedUntil || null
    };
  }

  function versions(item) {
    const saved = Array.isArray(item.planHistory) ? item.planHistory.filter(entry => entry && DATE.test(entry.from) && entry.rule && typeof entry.rule === 'object') : [];
    if (saved.length) return saved.slice().sort((a, b) => a.from.localeCompare(b.from));

    // Existing backups have no archive/pause start. Their last edit is the best
    // available boundary; do not pretend that they were inactive since birth.
    const rule = snapshot(item);
    if (!rule.archived && !rule.pausedUntil) return [{from: '0000-01-01', rule}];
    const effective = item.updatedAt ? dateOf(item.updatedAt, today()) : today();
    const base = Object.assign({}, rule, {archived: false, pausedFrom: null, pausedUntil: null});
    if (rule.pausedUntil && !rule.pausedFrom) rule.pausedFrom = effective;
    return [{from: '0000-01-01', rule: base}, {from: effective, rule}];
  }

  function ruleAt(item, date) {
    const history = versions(item);
    let rule = history[0].rule;
    for (const entry of history) {
      if (entry.from > date) break;
      rule = entry.rule;
    }
    const resolved = Object.assign({}, item, clone(rule));
    if (resolved.pausedUntil && resolved.pausedFrom && date < resolved.pausedFrom) resolved.pausedUntil = null;
    return resolved;
  }

  function logAt(item, date) {
    const data = state();
    return data && data.logs && data.logs[date] && data.logs[date][item.id];
  }

  function resolve(item, date) {
    if (!item || !date) return item;
    const resolved = ruleAt(item, date);
    const log = logAt(item, date);
    if (date < today() && log) {
      // A log's measurement belongs to the day it was recorded. Availability
      // (archive/pause) still comes from the date-effective rule, not the log.
      if (log._plan && typeof log._plan === 'object') {
        for (const key of MEASUREMENT) if (own(log._plan, key)) resolved[key] = clone(log._plan[key]);
      }
      // Legacy d is the recorded outcome. Historical target/type changes before
      // this release cannot be reconstructed, so retain that outcome honestly.
      // The existing d field stays authoritative: an older installed client
      // can correct a synced historical log without knowing the new _plan key.
      if (typeof log.d === 'boolean') resolved._historyDone = log.d;
      else if (log._plan && typeof log._plan.completed === 'boolean') resolved._historyDone = log._plan.completed;
    }
    return resolved;
  }

  function captureLog(item, date, log) {
    if (!item || !log) return log;
    let plan = date < today() && log._plan ? clone(log._plan) : snapshot(ruleAt(item, date));
    // A corrected historical log may change its value/outcome, while its old
    // measurement rule must remain intact.
    if (typeof log.d === 'boolean') plan.completed = log.d;
    log._plan = plan;
    return log;
  }

  function beforeEdit(data, item, patch) {
    if (item) editing.delete(item);
    if (!item || !patch || !RULES.some(key => own(patch, key) && JSON.stringify(item[key]) !== JSON.stringify(patch[key]))) return;
    const day = today();
    const previousLog = data.logs && data.logs[day] && data.logs[day][item.id];
    const wasDone = root.Engine ? root.Engine.isDone(item, day) : !!(previousLog && previousLog.d);
    editing.set(item, {day, wasDone});
    if (own(patch, 'pausedUntil') && patch.pausedUntil !== item.pausedUntil) {
      patch.pausedFrom = patch.pausedUntil ? day : null;
    }
    // Freeze existing measurements before applying the changed current rule.
    for (const [date, logs] of Object.entries(data.logs || {})) {
      const log = logs && logs[item.id];
      if (log && date <= day && !log._plan) captureLog(item, date, log);
    }
    const history = versions(item).map(entry => ({from: entry.from, rule: clone(entry.rule)}));
    const next = {from: day, rule: snapshot(Object.assign({}, item, patch))};
    const index = history.findIndex(entry => entry.from === day);
    if (index >= 0) history[index] = next;
    else history.push(next);
    item.planHistory = history.sort((a, b) => a.from.localeCompare(b.from));
  }

  function afterEdit(data, item) {
    const edit = item && editing.get(item);
    if (!edit) return;
    editing.delete(item);
    const log = data.logs && data.logs[edit.day] && data.logs[edit.day][item.id];
    if (log) {
      // Edits take effect today: keep the recorded action intact, but assess it
      // against today's NEW goal immediately. Otherwise the old d/_plan would
      // silently reinstate the old completion when today becomes yesterday.
      const rule = ruleAt(item, edit.day);
      if (log.mini) log.d = true;
      else if ((rule.steps || []).length) log.d = rule.steps.every((step, index) => !!(log.steps || {})[index]);
      else if (rule.type !== 'check' && rule.type !== 'avoid') log.d = (Number(log.v) || 0) >= (Number(rule.target) || 1);
      log.t = Date.now();
      captureLog(item, edit.day, log);
    }
    if (root.Engine) {
      root.Engine.bustCache();
      if (log && root.Engine.afterCheck) root.Engine.afterCheck(item, edit.day, edit.wasDone);
      root.Engine.bustCache();
    }
  }

  function itemsForDate(date) {
    const data = state();
    return ((data && data.items) || []).filter(item => !item.deleted && !resolve(item, date).archived);
  }

  root.HistoryModel = {resolve, snapshot, captureLog, beforeEdit, afterEdit, itemsForDate};
})(window);
