'use strict';
/* 兼容性闸门：只检查「真的会发到浏览器」的文件。
 * 线上有相当一部分用户是国产 ROM 上不常更新的 WebView，
 * 一个 Object.hasOwn 就能让打卡记分那条链路整段抛错，
 * 所以把这些「比可选链更新」的 API 列为禁止项，交给 CI 拦。 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');

const SHIPPED = [
  'src/app.bundle.js', 'src/chunk-diary.js', 'src/chunk-grow.js', 'src/chunk-social.js', 'src/chunk-plus.js',
  'src/history-engine.js', 'src/weekly-metrics.js', 'src/daily-focus.js', 'src/week-view.js', 'src/habit-trash.js',
  'src/habit-drafts.js', 'src/relapse-reason.js', 'src/urge-relief.js', 'src/backup-confirm.js',
  'src/diary-conflicts.js', 'src/notification-routing.js', 'src/feature-loading.js', 'src/interaction-feedback.js',
  'src/sheet-navigation.js', 'sw.js'
];

/* Chrome 93 / Safari 15.4 之后才有的写法（本项目的可选链基线是 Chrome 80）。 */
const BLOCKED = [
  { name: 'Object.hasOwn', pattern: /Object\.hasOwn\s*\(/ },
  { name: 'structuredClone', pattern: /\bstructuredClone\s*\(/ },
  { name: 'Array.prototype.at', pattern: /\.at\(\s*-?\d+\s*\)/ },
  { name: 'Array.prototype.findLast', pattern: /\.findLast(Index)?\s*\(/ },
  { name: 'Array.prototype.toSorted/toReversed', pattern: /\.to(Sorted|Reversed)\s*\(/ },
  { name: 'Object.groupBy', pattern: /Object\.groupBy\s*\(/ },
  { name: 'String.replaceAll', pattern: /\.replaceAll\s*\(/ }
];

test('发往浏览器的脚本不使用高版本 WebView 缺失的 API', () => {
  const offenders = [];
  for (const file of SHIPPED) {
    const code = fs.readFileSync(path.join(root, file), 'utf8');
    for (const rule of BLOCKED) if (rule.pattern.test(code)) offenders.push(file + ' → ' + rule.name);
  }
  assert.deepEqual(offenders, [], '改用等价的老写法：' + offenders.join('；'));
});

test('记分链路不再依赖 Object.hasOwn', () => {
  const bundle = fs.readFileSync(path.join(root, 'src/app.bundle.js'), 'utf8');
  assert.equal(bundle.includes('Object.hasOwn'), false);
  assert.ok(bundle.includes('Object.prototype.hasOwnProperty.call(o.items,e.id)'));
});
