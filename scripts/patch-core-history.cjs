'use strict';

// The upstream repository contains a shipped bundle, rather than a source build.
// Keep the history model readable and apply only narrow, checked hooks here.
const fs = require('node:fs');
const path = require('node:path');
function patchSource(source) {
if (source.includes('/* history-engine-hooks-v2 */')) {
  return source;
}

function replaceOnce(before, after, label) {
  const count = source.split(before).length - 1;
  if (count !== 1) throw new Error('History patch mismatch for ' + label + ': found ' + count);
  source = source.replace(before, after);
}

if (source.includes('/* history-engine-hooks-v1 */')) {
  replaceOnce(
    'const a=n.items.find(e=>e.id===t);a&&(window.HistoryModel&&HistoryModel.beforeEdit(n,a,e),Object.assign(a,e),a.updatedAt=Date.now())',
    'const a=n.items.find(e=>e.id===t);a&&(window.HistoryModel&&HistoryModel.beforeEdit(n,a,e),Object.assign(a,e),a.updatedAt=Date.now(),window.HistoryModel&&HistoryModel.afterEdit(n,a,e))',
    'same-day measurement reconciliation'
  );
  source = source.replace('/* history-engine-hooks-v1 */', '/* history-engine-hooks-v2 */');
  new (require('node:vm').Script)(source);
  return source;
}

replaceOnce(
  'function s(e){return n("items",()=>(t().items||[]).filter(t=>!t.deleted&&!t.archived))}',
  'function s(e){return n("items"+(e?":"+e:""),()=>e&&window.HistoryModel?HistoryModel.itemsForDate(e):(t().items||[]).filter(t=>!t.deleted&&!t.archived))}',
  'history-aware item enumeration'
);
replaceOnce('function d(t,e){if(t.pausedUntil', 'function d(t,e){if(window.HistoryModel){t=HistoryModel.resolve(t,e);if(!t||t.deleted||t.archived)return!1}if(t.pausedUntil', 'date-effective availability');
replaceOnce(
  'function b(t,e){const n=v(e,t.id);return!!n&&(!!n.mini||((t.steps||[]).length?t.steps.every((t,e)=>!!(n.steps||{})[e]):h(t)?!!n.d:(n.v||0)>=(t.target||1)))}',
  'function b(t,e){window.HistoryModel&&(t=HistoryModel.resolve(t,e));const n=v(e,t.id);return!!n&&(!!n.mini||("boolean"===typeof t._historyDone?t._historyDone:(t.steps||[]).length?t.steps.every((t,e)=>!!(n.steps||{})[e]):h(t)?!!n.d:(n.v||0)>=(t.target||1)))}',
  'historical completion'
);
replaceOnce('function y(t,e){const n=v(e,t.id);if(n&&n.mini)return.5;', 'function y(t,e){window.HistoryModel&&(t=HistoryModel.resolve(t,e));const n=v(e,t.id);if(n&&n.mini)return.5;if(!0===t._historyDone)return 1;', 'historical progress');
replaceOnce('function w(t,e){if(!t||h(t)', 'function w(t,e){window.HistoryModel&&(t=HistoryModel.resolve(t,e));if(!t||h(t)', 'historical partial progress');
replaceOnce('function u(e,a){const s=l(e);', 'function u(e,a){window.HistoryModel&&(e=HistoryModel.resolve(e,a));const s=l(e);', 'historical rest quota usage');
replaceOnce('function p(e,n){const a=l(e);', 'function p(e,n){window.HistoryModel&&(e=HistoryModel.resolve(e,n));const a=l(e);', 'historical rest quota');
replaceOnce('&&s().some(t=>p(t,e))}', '&&s(e).some(t=>p(t,e))}', 'historical global rest eligibility');
replaceOnce('const e=s().filter(e=>d(e,t)&&!L(t,e.id)&&!p(e,t));', 'const e=s(t).filter(e=>d(e,t)&&!L(t,e.id)&&!p(e,t));', 'historical daily summary');
replaceOnce(
  'return i.logs[e][n]=Object.assign(o,s,{t:Date.now()}),a(),i.logs[e][n]}',
  'return i.logs[e][n]=Object.assign(o,s,{t:Date.now()}),window.HistoryModel&&HistoryModel.captureLog((i.items||[]).find(t=>t.id===n),e,i.logs[e][n]),a(),i.logs[e][n]}',
  'per-log measurement snapshot'
);
replaceOnce(
  'const a=n.items.find(e=>e.id===t);a&&(Object.assign(a,e),a.updatedAt=Date.now())',
  'const a=n.items.find(e=>e.id===t);a&&(window.HistoryModel&&HistoryModel.beforeEdit(n,a,e),Object.assign(a,e),a.updatedAt=Date.now(),window.HistoryModel&&HistoryModel.afterEdit(n,a,e))',
  'capture rule version before editing'
);
replaceOnce('isDue:d,isAlive:o,bornOn:i,', 'itemsForDate:function(t){return s(t)},itemAtDate:function(t,e){return window.HistoryModel?HistoryModel.resolve(t,e):t},isDue:d,isAlive:o,bornOn:i,', 'history query API');
replaceOnce('const t=o(a,i),n=a.pausedUntil&&i<=a.pausedUntil,s=t&&!n&&d(a,i),', 'const t=o(a,i),s=t&&d(a,i),', 'heatmap pause interval');

// Backfill edits use the measurement valid for that date. Their stored
// completion is updated by captureLog, so undo/corrected values remain editable.
for (const [name, prefix] of [['toggle','function(e,n){'],['addValue','function(e,n,a){'],['setValue','function(e,n,a){'],['toggleStep','function(e,n,a){'],['slip','function(e,n){']]) {
  replaceOnce(name + ':' + prefix, name + ':' + prefix + 'window.HistoryModel&&(e=HistoryModel.resolve(e,n));', 'historical mutation ' + name);
}

const start = source.indexOf('yearly:function(');
const end = source.indexOf('leaderboard:function(', start);
if (start < 0 || end < 0) throw new Error('History patch mismatch for yearly metrics');
let yearly = source.slice(start, end);
if ((yearly.match(/s\(\)\.forEach/g) || []).length !== 2) throw new Error('History patch mismatch for yearly iteration');
yearly = yearly.replace('s().forEach', '(n.items||[]).filter(t=>!t.deleted).forEach').replace('s().forEach', 's(g).forEach');
source = source.slice(0, start) + yearly + source.slice(end);
source += '\n/* history-engine-hooks-v2 */\n';
// Parse the generated bundle before writing a byte to disk.
new (require('node:vm').Script)(source);
return source;
}

module.exports = {patchSource};
if (require.main === module) {
  const filename = process.argv[2] || path.join(__dirname, '../src/app.bundle.js');
  fs.writeFileSync(filename, patchSource(fs.readFileSync(filename, 'utf8')));
  console.log('Installed history hooks');
}
