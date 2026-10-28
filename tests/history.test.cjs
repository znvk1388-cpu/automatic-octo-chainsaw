'use strict';
const assert = require('node:assert/strict');
const {test} = require('node:test');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const {patchSource} = require('../scripts/patch-core-history.cjs');

const root = path.join(__dirname, '..');
const source = patchSource(fs.readFileSync(path.join(root, 'src/app.bundle.js'), 'utf8'));
const standalone = text => text.replace(/,\s*$/, ';');

function setup(item, logs = {}) {
  let now = new Date('2026-10-28T04:00:00Z').getTime();
  class FixedDate extends Date {
    constructor(...args) { super(...(args.length ? args : [now])); }
    static now() { return now; }
  }
  const data = {items:[item],logs,freezes:{},redemptions:[],settings:{weekStart:1,seedPts:0,nickname:'测试'}};
  const sandbox = {window:{},Date:FixedDate,Store:{s:data,rev:1}};
  sandbox.window.Store = sandbox.Store;
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(path.join(root,'src/history-engine.js'),'utf8'),sandbox);
  sandbox.HistoryModel = sandbox.window.HistoryModel;
  vm.runInContext(standalone(source.slice(0,source.indexOf('window.ErrLog='))),sandbox);
  sandbox.U = sandbox.window.U;
  vm.runInContext(standalone(source.slice(source.indexOf('window.SyncModel='),source.indexOf('window.Cloud='))),sandbox);
  vm.runInContext(standalone(source.slice(source.indexOf('window.Engine='),source.indexOf('window.Parse='))),sandbox);
  const engine = sandbox.window.Engine;
  sandbox.Engine = engine;
  sandbox.Store.commit = callback => { callback && callback(data); sandbox.Store.rev++; engine.bustCache(); };
  const updateCode = source.slice(source.indexOf('updateItem:function('),source.indexOf(',removeItem:function(',source.indexOf('updateItem:function(')));
  vm.runInContext('window.Update={' + updateCode + '}',sandbox);
  return {engine,data,history:sandbox.HistoryModel,sync:sandbox.window.SyncModel,weekly(){vm.runInContext(fs.readFileSync(path.join(root,'src/weekly-metrics.js'),'utf8'),sandbox);},update:patch=>sandbox.window.Update.updateItem(item.id,patch),at(date){now=new Date(date+'T04:00:00Z').getTime();engine.bustCache();},changed(){sandbox.Store.rev++;engine.bustCache();}};
}

function habit(extra={}) {
  return Object.assign({id:'reading',name:'阅读',type:'number',target:10,unit:'页',steps:[],schedule:{type:'daily'},createdAt:new Date('2026-10-01T00:00:00Z').getTime(),updatedAt:new Date('2026-10-01T00:00:00Z').getTime(),archived:false},extra);
}
const records = (value=10, done=true) => ({'2026-10-27':{reading:{v:value,d:done}}});

test('raising and lowering a target preserve the recorded outcome of previous days',()=>{
  const item=habit(); const app=setup(item,records());
  app.update({target:20});
  assert.equal(app.engine.isDone(item,'2026-10-27'),true);
  assert.equal(app.engine.todayRate('2026-10-27').pct,100);
  assert.equal(app.data.logs['2026-10-27'].reading._plan.target,10);
  assert.equal(app.engine.itemAtDate(item,'2026-10-28').target,20);
  const incomplete=setup(habit(),records(5,false));
  incomplete.update({target:3});
  assert.equal(incomplete.engine.isDone(incomplete.data.items[0],'2026-10-27'),false);
});

test('schedule edits apply from today and preserve old expected dates',()=>{
  const item=habit({type:'check'}); const app=setup(item);
  app.update({schedule:{type:'weekdays',days:[1]}});
  assert.equal(app.engine.isDue(item,'2026-10-27'),true);
  assert.equal(app.engine.isDue(item,'2026-10-28'),false);
  assert.equal(app.engine.isDue(item,'2026-11-02'),true);
});

test('archiving removes the current habit without removing its past summary',()=>{
  const item=habit();const app=setup(item,records());
  app.update({archived:true});
  assert.equal(app.engine.items().length,0);
  assert.equal(app.engine.itemsForDate('2026-10-27').length,1);
  assert.equal(app.engine.todayRate('2026-10-27').pct,100);
  assert.equal(app.engine.todayRate('2026-10-28').total,0);
  assert.equal(app.engine.yearly(2026).totalDone,1);
});

test('a pause has a start and end, and resuming keeps the past pause interval',()=>{
  const item=habit();const app=setup(item,records());
  app.update({pausedUntil:'2026-11-04'});
  assert.equal(item.pausedFrom,'2026-10-28');
  assert.equal(app.engine.isDue(item,'2026-10-27'),true);
  assert.equal(app.engine.isDue(item,'2026-10-28'),false);
  assert.equal(app.engine.isDue(item,'2026-11-05'),true);
  assert.equal(app.engine.itemHeat(item.id,3).find(day=>day.date==='2026-10-27').done,true);
  app.at('2026-10-30');app.update({pausedUntil:null});
  assert.equal(app.engine.isDue(item,'2026-10-29'),false);
  assert.equal(app.engine.isDue(item,'2026-10-30'),true);
});

test('backfill corrections use the old target and update the stored outcome',()=>{
  const item=habit();const app=setup(item,records());
  app.update({target:20});
  app.engine.setValue(item,'2026-10-27',5);app.changed();
  assert.equal(app.engine.isDone(item,'2026-10-27'),false);
  assert.equal(app.data.logs['2026-10-27'].reading._plan.target,10);
  app.engine.setValue(item,'2026-10-27',10);app.changed();
  assert.equal(app.engine.isDone(item,'2026-10-27'),true);
  assert.equal(app.data.logs['2026-10-27'].reading._plan.completed,true);
});

test('new logs capture their measurement, and JSON backup/restore retains rules and outcomes',()=>{
  const item=habit();const app=setup(item);
  app.engine.setValue(item,'2026-10-28',10);app.changed();
  assert.equal(app.data.logs['2026-10-28'].reading._plan.target,10);
  app.at('2026-10-29');app.update({target:30});
  const backup=JSON.parse(JSON.stringify(app.data));
  const restored=setup(backup.items[0],backup.logs);restored.at('2026-10-29');
  assert.equal(restored.engine.isDone(backup.items[0],'2026-10-28'),true);
  assert.equal(restored.engine.itemAtDate(backup.items[0],'2026-10-29').target,30);
});

test('legacy archive and pause flags do not suppress dates before their last update',()=>{
  const edited=new Date('2026-10-28T04:00:00Z').getTime();
  const archived=habit({archived:true,updatedAt:edited});const a=setup(archived,records());
  assert.equal(a.engine.todayRate('2026-10-27').pct,100);
  const paused=habit({pausedUntil:'2026-11-04',updatedAt:edited});const b=setup(paused,records());
  assert.equal(b.engine.todayRate('2026-10-27').pct,100);
  assert.equal(b.engine.isDue(paused,'2026-10-28'),false);
});

test('legacy recorded completion is retained when its old target is unknown',()=>{
  const item=habit({target:20});const app=setup(item,records(10,true));
  assert.equal(app.engine.isDone(item,'2026-10-27'),true);
  app.update({target:30});
  assert.equal(app.engine.isDone(item,'2026-10-27'),true);
});

test('rest allowance changes do not excuse previously missed dates retroactively',()=>{
  const item=habit({type:'check',restPerWeek:0});const app=setup(item);
  app.update({restPerWeek:2});
  assert.equal(app.engine.isRestDay(item,'2026-10-27'),false);
  assert.equal(app.engine.isRestDay(item,'2026-10-29'),false);
});

test('a synced correction from an older client overrides stale snapshot completion only',()=>{
  const item=habit();const app=setup(item,records());
  app.update({target:20});
  const log=app.data.logs['2026-10-27'].reading;
  log.v=5;log.d=false;app.changed();
  assert.equal(log._plan.completed,true);
  assert.equal(app.engine.isDone(item,'2026-10-27'),false);
  assert.equal(log._plan.target,10);
});

test('editing a target retains notes, step selections, skip and minimum-dose metadata',()=>{
  const item=habit({type:'check',steps:['准备','完成']});
  const logs={'2026-10-27':{reading:{v:0,d:true,mini:1,s:1,note:'留着这句话',steps:{0:true}}}};
  const app=setup(item,logs);app.update({steps:['一','二','三']});
  const log=app.data.logs['2026-10-27'].reading;
  assert.equal(log.note,'留着这句话');
  assert.equal(log.mini,1);
  assert.equal(log.s,1);
  assert.equal(log.steps[0],true);
  assert.equal(log._plan.steps.length,2);
  assert.equal(app.engine.progress(item,'2026-10-27'),0.5);
});

test('real SyncModel payload and merge preserve per-item history and per-log measurements',()=>{
  const sourceItem=habit();const a=setup(sourceItem,records());
  const b=setup(habit(),records());
  a.sync.prepare(a.data,false);b.sync.prepare(b.data,false);
  a.update({target:20,archived:true});
  a.sync.observe(a.data);
  const payload=JSON.parse(JSON.stringify(a.sync.payload(a.data)));
  assert.equal(payload.items[0].planHistory.length,2);
  assert.equal(payload.logs['2026-10-27'].reading._plan.target,10);
  assert.ok(b.sync.merge(b.data,payload)>0);b.changed();
  const received=b.data.items[0];
  assert.equal(received.archived,true);
  assert.equal(received.target,20);
  assert.equal(b.engine.todayRate('2026-10-27').pct,100);
  assert.equal(b.engine.isDone(received,'2026-10-27'),true);
});

test('weekly summaries keep completions before a midweek archive',()=>{
  const item=habit({type:'check',schedule:{type:'timesPerWeek',n:3}});
  const logs={'2026-10-26':{reading:{d:true,v:1}},'2026-10-27':{reading:{d:true,v:1}}};
  const app=setup(item,logs);app.weekly();
  assert.equal(app.engine.weekProgress(item).target,3);
  app.update({archived:true});
  assert.equal(app.engine.weekProgress(item).done,2);
  assert.equal(app.engine.weekProgress(item).target,2);
  assert.equal(app.engine.periodRate('2026-10-26','2026-10-28').actualDone,2);
});

test('weekly summaries keep earlier dates when a pause starts midweek',()=>{
  const item=habit({type:'check',schedule:{type:'timesPerWeek',n:3}});
  const logs={'2026-10-26':{reading:{d:true,v:1}},'2026-10-27':{reading:{d:true,v:1}}};
  const app=setup(item,logs);app.weekly();app.update({pausedUntil:'2026-10-30'});
  assert.equal(app.engine.weekProgress(item).done,2);
  assert.equal(app.engine.weekProgress(item).target,3);
  assert.equal(app.engine.isDue(item,'2026-10-27'),true);
  assert.equal(app.engine.isDue(item,'2026-10-28'),false);
});

test('raising today\'s target remains incomplete after midnight and reconciles rewards',()=>{
  const item=habit();const app=setup(item,records());
  app.engine.setValue(item,'2026-10-28',10);app.changed();
  const log=app.data.logs['2026-10-28'].reading;
  log.note='今天读的';log.steps={0:true};log.s=1;
  assert.equal(app.engine.isDone(item,'2026-10-28'),true);
  assert.equal(app.data.settings.seedPts,40);
  app.update({target:20});
  assert.equal(app.engine.isDone(item,'2026-10-28'),false);
  assert.equal(log.d,false);
  assert.equal(log._plan.target,20);
  assert.equal(log._plan.completed,false);
  assert.equal(log.v,10);
  assert.equal(log.note,'今天读的');
  assert.equal(log.steps[0],true);
  assert.equal(log.s,1);
  assert.equal(app.data.settings.seedPts,0);
  assert.equal(app.engine.isDone(item,'2026-10-27'),true);
  app.at('2026-10-29');
  assert.equal(app.engine.isDone(item,'2026-10-28'),false);
  assert.equal(app.engine.progress(item,'2026-10-28'),0.5);
});

test('lowering today\'s target remains complete after midnight and awards once',()=>{
  const item=habit({target:20});const app=setup(item);
  app.engine.setValue(item,'2026-10-28',10);app.changed();
  assert.equal(app.data.settings.seedPts,0);
  app.update({target:5});
  const log=app.data.logs['2026-10-28'].reading;
  assert.equal(log.d,true);
  assert.equal(log._plan.target,5);
  assert.equal(app.engine.isDone(item,'2026-10-28'),true);
  assert.equal(app.data.settings.seedPts,40);
  app.update({name:'改个名字'});
  assert.equal(app.data.settings.seedPts,40);
  app.at('2026-10-29');
  assert.equal(app.engine.isDone(item,'2026-10-28'),true);
  assert.equal(app.data.settings.seedPts,40);
});
