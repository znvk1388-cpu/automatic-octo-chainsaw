'use strict';
/* 打卡准确性依赖的日期算术：全部按「本地日历日」推，不能受夏令时或闰年影响。
 * 这些函数是 U（工具层）的公开方法，直接在新上下文里跑真实的 bundle 片段。 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const base = path.join(__dirname, '..');
const bundle = fs.readFileSync(path.join(base, 'src/app.bundle.js'), 'utf8');
const standalone = s => s.replace(/,\s*$/, ';');

function loadU(weekStart = 1) {
  const sb = { window: {}, Date, console };
  vm.createContext(sb);
  vm.runInContext(standalone(bundle.slice(0, bundle.indexOf('window.ErrLog='))), sb);
  const U = sb.window.U;
  sb.window.Store = { s: { settings: { weekStart } } };
  sb.Store = sb.window.Store;
  return { U, sb };
}

test('跨月、跨年、闰日的日期加减都落在一个日历日上', () => {
  const { U } = loadU();
  const cases = [
    ['2024-02-28', 1, '2024-02-29'],
    ['2024-02-29', 1, '2024-03-01'],
    ['2023-02-28', 1, '2023-03-01'],
    ['2023-12-31', 1, '2024-01-01'],
    ['2024-01-01', -1, '2023-12-31'],
    ['2024-03-01', -1, '2024-02-29'],
    ['2024-04-30', 1, '2024-05-01'],
    ['2026-11-11', 0, '2026-11-11']
  ];
  for (const [from, delta, want] of cases) assert.equal(U.shiftYmd(from, delta), want, from + (delta >= 0 ? '+' : '') + delta);
});

test('天数差在闰年与跨年处仍然按真实天数计算', () => {
  const { U } = loadU();
  assert.equal(U.daysBetween('2024-02-28', '2024-03-01'), 2, '闰年二月有 29 号');
  assert.equal(U.daysBetween('2023-02-28', '2023-03-01'), 1, '平年二月只有 28 天');
  assert.equal(U.daysBetween('2024-01-01', '2024-12-31'), 365);
  assert.equal(U.daysBetween('2023-01-01', '2023-12-31'), 364);
  assert.equal(U.daysBetween('2026-11-11', '2026-11-11'), 0);
  assert.equal(U.daysBetween('2026-11-11', '2026-11-10'), -1, '倒序为负，不吞符号');
});

test('rangeYmd 覆盖首尾且首尾相同只给一天', () => {
  const { U } = loadU();
  assert.deepEqual(Array.from(U.rangeYmd('2024-02-28', '2024-03-01')), ['2024-02-28', '2024-02-29', '2024-03-01']);
  assert.deepEqual(Array.from(U.rangeYmd('2026-11-11', '2026-11-11')), ['2026-11-11']);
  assert.equal(U.rangeYmd('2026-01-01', '2026-12-31').length, 365);
});

test('周一与周日开周各自算对，跨月也不跑偏', () => {
  const monday = loadU(1);
  assert.equal(monday.U.weekdayOf('2026-11-11'), 3, '2026-11-11 是周三');
  assert.equal(monday.U.weekStartOf('2026-11-11'), '2026-11-09');
  assert.equal(monday.U.weekStartOf('2026-11-09'), '2026-11-09', '周一自己就是周首');
  assert.equal(monday.U.weekStartOf('2026-11-01'), '2026-10-26', '跨月要回到上个月');
  assert.deepEqual(Array.from(monday.U.weekLabels()), ['周一', '周二', '周三', '周四', '周五', '周六', '周日']);

  const sunday = loadU(0);
  assert.equal(sunday.U.weekStartOf('2026-11-11'), '2026-11-08');
  assert.equal(sunday.U.weekStartOf('2026-11-08'), '2026-11-08');
  assert.deepEqual(Array.from(sunday.U.weekLabels()), ['周日', '周一', '周二', '周三', '周四', '周五', '周六']);
});

test('今天用本地日历日，不经过 UTC 换算', () => {
  const { U } = loadU();
  assert.equal(U.today(), U.ymd(new Date()));
  assert.match(U.today(), /^\d{4}-\d{2}-\d{2}$/);
  const local = new Date(2026, 0, 1, 0, 30, 0);   // 本地 00:30，UTC 可能还是前一天
  assert.equal(U.ymd(local), '2026-01-01');
});

test('人类可读格式不出现 0 填充错误', () => {
  const { U } = loadU();
  assert.equal(U.hhmm(new Date(2026, 10, 11, 9, 5).getTime()), '09:05');
  assert.equal(U.dur(0), '0:00');
  assert.equal(U.dur(65), '1:05');
  assert.equal(U.dur(-5), '0:00');
  assert.match(U.prettyDate('2026-11-11'), /^11月11日 周三$/);
});
