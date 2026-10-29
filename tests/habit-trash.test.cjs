'use strict';
const assert = require('node:assert/strict');
const {test} = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const project = path.join(__dirname, '..');
const bundle = fs.readFileSync(path.join(project, 'src/app.bundle.js'), 'utf8');
const modulePath = path.join(project, 'src/habit-trash.js');
const moduleSource = fs.existsSync(modulePath) ? fs.readFileSync(modulePath, 'utf8') : '';
const standalone = text => text.replace(/,\s*$/, ';');
const plain = value => JSON.parse(JSON.stringify(value));
const NOW = new Date('2026-10-28T04:00:00Z').getTime();

function fixture() {
  return {
    version: 7, deviceId: 'fictional-device',
    items: [
      {id: 'reading', name: '测试阅读', deleted: false, target: 10, type: 'number', archived: true,
        planHistory: [{from: '2026-10-01', rule: {target: 10, type: 'number'}}]},
      {id: 'walk', name: '测试散步', deleted: false},
      {id: 'water', name: '测试喝水', deleted: false}
    ],
    bundles: [{id: 'morning', name: '测试套餐', itemIds: ['walk', 'reading', 'water']}],
    logs: {'2026-10-27': {reading: {v: 10, d: true, note: '虚构记录'}}},
    settings: {}
  };
}

function setup(input = fixture(), deferred = false) {
  let now = NOW;
  const documentListeners = {}, windowListeners = {}, sheets = [], messages = [];
  class FixedDate extends Date {
    constructor(...args) { super(...(args.length ? args : [now])); }
    static now() { return now; }
  }
  const c = {
    Date: FixedDate, console, location: {origin: 'http://example.invalid'},
    setTimeout() { return 1; }, clearTimeout() {},
    localStorage: {getItem: key => key === 'rigongyizhu.state' ? JSON.stringify(input) : null},
    addEventListener(name, callback) { (windowListeners[name] ||= []).push(callback); },
    document: {
      addEventListener(name, callback) { (documentListeners[name] ||= []).push(callback); },
      getElementById() { return null; }
    },
    UI: {sheet(title, html) { sheets.push({title, html}); }, render() {}, closeSheet() {} }
  };
  c.window = c;
  vm.createContext(c);
  vm.runInContext(standalone(bundle.slice(0, bundle.indexOf('window.ErrLog='))), c);
  c.U.toast = message => messages.push(message);
  vm.runInContext(standalone(bundle.slice(bundle.indexOf('window.SyncModel='), bundle.indexOf('window.Cloud='))), c);
  vm.runInContext(standalone(bundle.slice(bundle.indexOf('window.Store='), bundle.indexOf('window.Engine='))), c);
  c.Store._doSave = null;
  c.Store.initSync();
  vm.runInContext(fs.readFileSync(path.join(project, 'src/history-engine.js'), 'utf8'), c);
  const start = bundle.indexOf('updateItem:function('), end = bundle.indexOf(',addBundle:', start);
  vm.runInContext('window.Feat={' + bundle.slice(start, end) + '};', c);
  const feat = c.Feat;
  if (deferred) c.Feat = null;
  vm.runInContext(moduleSource, c);
  assert.ok(c.HabitTrash, 'HabitTrash 模块应暴露单条习惯删除与恢复接口');
  return {
    c, trash: c.HabitTrash, data: c.Store.s, sheets, messages, documentListeners,
    at(timestamp) { now = timestamp; },
    coreReady() { c.Feat = feat; (windowListeners['rgz:core'] || []).forEach(callback => callback()); },
    click(action, id, disabled = false) {
      const button = {dataset: {habitTrashAction: action, id}, disabled, isConnected: true};
      const event = {target: {closest: selector => selector === '[data-habit-trash-action]' ? button : null}, preventDefault() {}};
      (documentListeners.click || []).forEach(callback => callback(event));
    }
  };
}

test('delete keeps the original habit and logs while hiding it and detaching its bundle membership', () => {
  const app = setup();
  const item = app.data.items[0], logs = plain(app.data.logs), history = plain(item.planHistory);
  let calls = 0;
  const original = app.c.Feat.removeItem;
  app.c.Feat.removeItem = function(id) { calls++; return original.call(this, id); };
  const result = app.trash.remove('reading');
  assert.equal(result.ok, true);
  assert.equal(calls, 1);
  assert.equal(app.data.items.length, 3);
  assert.equal(app.data.items[0], item);
  assert.equal(item.deleted, true);
  assert.equal(item.deletedAt, NOW);
  assert.deepEqual(plain(app.data.bundles[0].itemIds), ['walk', 'water']);
  assert.deepEqual(plain(app.data.logs), logs);
  assert.deepEqual(plain(item.planHistory), history);
});

test('restore keeps the same ID, archive state, log and historical plans', () => {
  const app = setup(), item = app.data.items[0];
  const logs = plain(app.data.logs), history = plain(item.planHistory);
  app.trash.remove('reading');
  assert.equal(app.trash.restore('reading').ok, true);
  assert.equal(app.data.items[0], item);
  assert.equal(item.deleted, false);
  assert.equal(item.archived, true);
  assert.equal(item.deletedAt, undefined);
  assert.deepEqual(plain(app.data.logs), logs);
  assert.deepEqual(plain(item.planHistory), history);
  assert.deepEqual(plain(app.data.bundles[0].itemIds), ['walk', 'reading', 'water']);
});

test('restoring inserts one member into the current bundle without overwriting later edits', () => {
  const app = setup();
  app.trash.remove('reading');
  app.c.Store.commit(data => {
    data.bundles[0].name = '删除期间改名';
    data.bundles[0].itemIds = ['new-member', 'water', 'walk'];
  });
  app.trash.restore('reading');
  assert.equal(app.data.bundles[0].name, '删除期间改名');
  assert.deepEqual(plain(app.data.bundles[0].itemIds).filter(id => id !== 'reading'), ['new-member', 'water', 'walk']);
  assert.equal(app.data.bundles[0].itemIds.filter(id => id === 'reading').length, 1);
});

test('restore ignores deleted or removed bundles and does not duplicate an existing association', () => {
  const input = fixture();
  input.bundles.push({id: 'removed', itemIds: ['reading']}, {id: 'deleted', itemIds: ['reading']});
  const app = setup(input);
  app.trash.remove('reading');
  app.c.Store.commit(data => {
    data.bundles = data.bundles.filter(bundle => bundle.id !== 'removed');
    data.bundles.find(bundle => bundle.id === 'deleted').deleted = true;
    data.bundles.find(bundle => bundle.id === 'morning').itemIds.push('reading');
  });
  assert.equal(app.trash.restore('reading').ok, true);
  assert.equal(app.data.bundles.length, 2);
  assert.deepEqual(plain(app.data.bundles.find(bundle => bundle.id === 'deleted').itemIds), []);
  assert.equal(app.data.bundles.find(bundle => bundle.id === 'morning').itemIds.filter(id => id === 'reading').length, 1);
});

test('missing IDs and repeated delete or restore are harmless and do not create commits', () => {
  const app = setup();
  let rev = app.c.Store.rev;
  assert.equal(app.trash.remove('missing').ok, false);
  assert.equal(app.trash.restore('missing').ok, false);
  assert.equal(app.trash.restore('reading').ok, false);
  assert.equal(app.c.Store.rev, rev);
  app.trash.remove('reading');
  rev = app.c.Store.rev;
  assert.equal(app.trash.remove('reading').ok, false);
  assert.equal(app.c.Store.rev, rev);
  app.trash.restore('reading');
  rev = app.c.Store.rev;
  assert.equal(app.trash.restore('reading').ok, false);
  assert.equal(app.c.Store.rev, rev);
});

test('deleted associations survive ordinary JSON and sync payload round trips', () => {
  const app = setup();
  app.trash.remove('reading');
  const payload = plain(app.c.SyncModel.payload(app.data));
  for (const snapshot of [plain(app.data), payload]) {
    const restored = setup(snapshot);
    assert.equal(restored.trash.list().length, 1);
    assert.equal(restored.trash.restore('reading').ok, true);
    assert.deepEqual(plain(restored.data.bundles[0].itemIds), ['walk', 'reading', 'water']);
    assert.equal(restored.data.logs['2026-10-27'].reading.note, '虚构记录');
    assert.equal(restored.data.items[0].planHistory[0].rule.target, 10);
  }
});

test('listing includes legacy deletions, orders dated deletions first, and never expires records', () => {
  const input = fixture();
  input.items.push({id: 'old', name: '旧版测试删除', deleted: true});
  const app = setup(input);
  app.trash.remove('reading');
  app.at(NOW + 1000);
  app.trash.remove('walk');
  app.at(NOW + 365 * 86400000);
  assert.deepEqual(plain(app.trash.list()).map(item => item.id), ['walk', 'reading', 'old']);
  const deletedCount = app.data.items.filter(item => item.deleted).length;
  app.trash.open();
  assert.match(app.sheets.at(-1).html, /旧版|未保存/);
  assert.equal(app.data.items.filter(item => item.deleted).length, deletedCount);
  const result = app.trash.restore('old');
  assert.equal(result.ok, true);
  assert.match(result.msg, /套餐|关联/);
  assert.equal(app.data.items.find(item => item.id === 'old').deleted, false);
});

test('a second deletion captures current associations instead of stale relationships', () => {
  const app = setup();
  app.trash.remove('reading');
  app.trash.restore('reading');
  app.c.Store.commit(data => {
    data.bundles[0].itemIds = ['walk', 'water'];
    data.bundles.push({id: 'evening', itemIds: ['reading', 'water']});
  });
  app.at(NOW + 1000);
  app.trash.remove('reading');
  app.trash.restore('reading');
  assert.deepEqual(plain(app.data.bundles[0].itemIds), ['walk', 'water']);
  assert.deepEqual(plain(app.data.bundles[1].itemIds), ['reading', 'water']);
});

test('the recovery sheet escapes habit names and identifiers and its delegated button restores only that habit', () => {
  const input = fixture();
  input.items[0].id = 'test"<id>';
  input.items[0].name = '<img src=x onerror=alert(1)>';
  input.bundles = [];
  const app = setup(input);
  app.trash.remove('test"<id>');
  app.trash.open();
  const sheet = app.sheets.at(-1);
  assert.match(sheet.title, /恢复|回收/);
  assert.equal(sheet.html.includes('<img'), false);
  assert.match(sheet.html, /&lt;img/);
  assert.match(sheet.html, /test&quot;&lt;id&gt;/);
  assert.match(sheet.html, /data-habit-trash-action="restore"/);
  app.click('restore', 'test"<id>');
  assert.equal(app.data.items[0].deleted, false);
  assert.equal(app.messages.length, 1);
  assert.match(app.sheets.at(-1).html, /没有|暂无/);
});

test('installation waits for the window core event and attaches the click listener only once', () => {
  const app = setup(fixture(), true);
  assert.equal((app.documentListeners.click || []).length, 0);
  app.coreReady();
  app.trash.install();
  app.trash.install();
  assert.equal(app.documentListeners.click.length, 1);
  app.trash.remove('reading');
  app.click('restore', 'reading', true);
  assert.equal(app.data.items[0].deleted, true);
  app.click('restore', 'reading');
  assert.equal(app.data.items[0].deleted, false);
});

test('restoring an active habit refuses a duplicate name without changing logs or bundles', () => {
  const input = fixture(); input.items[0].archived = false;
  const app = setup(input); app.trash.remove('reading');
  app.c.Store.commit(data => data.items.push({id:'replacement',name:' 测试阅读 ',deleted:false,archived:false}));
  const before = plain(app.data), rev = app.c.Store.rev;
  const result = app.trash.restore('reading');
  assert.equal(result.ok, false);
  assert.match(result.msg, /同名|名字/);
  assert.equal(app.c.Store.rev, rev);
  assert.deepEqual(plain(app.data), before);
  app.click('restore', 'reading');
  assert.match(app.messages.at(-1), /同名|名字/);
  assert.equal(app.data.items[0].deleted, true);
  app.c.Store.commit(data => { data.items.find(item => item.id==='replacement').name='另一个习惯'; });
  assert.equal(app.trash.restore('reading').ok, true);
  assert.equal(app.data.items[0].id, 'reading');
  assert.deepEqual(plain(app.data.bundles[0].itemIds), ['walk', 'reading', 'water']);
  assert.equal(app.data.logs['2026-10-27'].reading.note, '虚构记录');
});

test('an archived or deleted namesake does not block restoration', () => {
  const input = fixture(); input.items[0].archived = false;
  const app = setup(input); app.trash.remove('reading');
  app.c.Store.commit(data => data.items.push({id:'archived-same',name:'测试阅读',archived:true},{id:'deleted-same',name:'测试阅读',deleted:true}));
  assert.equal(app.trash.restore('reading').ok, true);
});

test('restoring an archived habit keeps it archived even with an active namesake', () => {
  const app = setup(); app.trash.remove('reading');
  app.c.Store.commit(data => data.items.push({id:'active-same',name:'测试阅读'}));
  assert.equal(app.trash.restore('reading').ok, true);
  assert.equal(app.data.items.find(item => item.id==='reading').archived, true);
});
