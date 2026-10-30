'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function gestureFixture(onEntry) {
  const source = fs.readFileSync(path.join(__dirname, '../src/app.bundle.js'), 'utf8');
  const start = source.indexOf('function(){const e=t("view");if(!e)return;const n=104;');
  const end = source.indexOf('}(),t("btnVoice")', start);
  assert.ok(start >= 0 && end > start, 'actual card gesture controller exists');
  const handlers = {}, calls = { tick: 0, menu: 0 }, timers = new Map();
  let nextTimer = 0;
  const body = { style: {} };
  const card = { dataset: { id: 'avoid-1', sw: '1' }, querySelector: () => body,
    classList: { add() {}, remove() {} } };
  const target = { closest(selector) {
    if (selector === '.hitem') return card;
    if (selector === '[data-rg-urge]' && onEntry) return this;
    return null;
  } };
  const view = { addEventListener(type, handler) { handlers[type] = handler; } };
  const context = { t: () => view, X: 0, U: { vibrate() {} },
    UI: { openHabitMenu() { calls.menu++; } }, A: { tick() { calls.tick++; } },
    setTimeout(fn) { const id = ++nextTimer; timers.set(id, fn); return id; },
    clearTimeout(id) { timers.delete(id); }, Date };
  vm.runInNewContext('(' + source.slice(start, end + 1) + ')()', context);
  function touch(type, x = 0) {
    handlers[type]({ target, touches: [{ clientX: x, clientY: 0 }], cancelable: true, preventDefault() {} });
  }
  return { calls, touch, hold() { for (const fn of [...timers.values()]) fn(); } };
}

for (const onEntry of [true, false]) {
  const label = onEntry ? 'breathing entry' : 'ordinary card area';
  test(label + ': right swipe does ' + (onEntry ? 'not mark complete' : 'mark complete'), () => {
    const f = gestureFixture(onEntry); f.touch('touchstart'); f.touch('touchmove', 80); f.touch('touchend', 80);
    assert.equal(f.calls.tick, onEntry ? 0 : 1); assert.equal(f.calls.menu, 0);
  });
  test(label + ': long press does ' + (onEntry ? 'not open the habit menu' : 'open the habit menu'), () => {
    const f = gestureFixture(onEntry); f.touch('touchstart'); f.hold();
    assert.equal(f.calls.menu, onEntry ? 0 : 1); assert.equal(f.calls.tick, 0);
  });
}
