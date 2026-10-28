'use strict';
const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const {patchSource: patchCore} = require('../scripts/patch-core-history.cjs');
const {patchSource: patchGrow} = require('../scripts/patch-grow-history.cjs');
const root = path.join(__dirname, '..');
const source = patchCore(fs.readFileSync(path.join(root, 'src/app.bundle.js'), 'utf8'));
const grow = patchGrow(fs.readFileSync(path.join(root, 'src/chunk-grow.js'), 'utf8'));
const standalone = text => text.replace(/,\s*$/, ';');

function app(item, logs) {
  const NativeDate = Date;
  let now = new NativeDate(2026,9,28,12).getTime();
  class FixedDate extends NativeDate {
    constructor(...args) { super(...(args.length ? args : [now])); }
    static now() { return now; }
  }
  const context = {Date:FixedDate,Store:{rev:1,s:{items:[item],logs,freezes:{},notes:{},moods:{},redemptions:[],settings:{weekStart:1,seedPts:0,nickname:'测试'}}},addEventListener(){},dispatchEvent(){},Event:class {}};
  context.window=context;
  vm.createContext(context);
  vm.runInContext(standalone(source.slice(0,source.indexOf('window.ErrLog='))),context);
  vm.runInContext(fs.readFileSync(path.join(root,'src/history-engine.js'),'utf8'),context);
  vm.runInContext(standalone(source.slice(source.indexOf('window.Engine='),source.indexOf('window.Parse='))),context);
  context.Store.commit=callback=>{callback && callback(context.Store.s);context.Store.rev++;context.Engine.bustCache();};
  const at=source.indexOf('updateItem:function(');
  vm.runInContext('Update={'+source.slice(at,source.indexOf(',removeItem:function(',at))+'}',context);
  vm.runInContext(grow,context);
  return {context,update:patch=>context.Update.updateItem(item.id,patch)};
}

function reading(extra={}) {
  return Object.assign({id:'reading',name:'阅读',type:'number',target:10,unit:'页',steps:[],schedule:{type:'daily'},createdAt:new Date(2026,9,1).getTime(),updatedAt:new Date(2026,9,1).getTime()},extra);
}

test('lazy Insights retains historical completion after a target increases',()=>{
  const item=reading();const a=app(item,{'2026-10-27':{reading:{v:10,d:true}}});
  a.update({target:20});
  assert.equal(a.context.Engine.isDone(item,'2026-10-27'),true);
  assert.equal(a.context.Insights.doneOn(item,'2026-10-27'),true);
  const series=a.context.Insights.series(item,['2026-10-27']);
  assert.equal(series.ok,1);
  assert.equal(series.due,1);
  assert.equal(series.rate,1);
});

test('lazy Insights does not turn an old incomplete day into success when a target decreases',()=>{
  const item=reading();const a=app(item,{'2026-10-27':{reading:{v:5,d:false}}});
  a.update({target:3});
  assert.equal(a.context.Insights.doneOn(item,'2026-10-27'),false);
  assert.equal(a.context.Insights.series(item,['2026-10-27']).ok,0);
});

test('hour distribution keeps real historical completion samples after editing a target',()=>{
  const item=reading();const logs={};
  for(let day=10;day<24;day++) {
    const date='2026-10-'+String(day).padStart(2,'0');
    logs[date]={reading:{v:10,d:true,t:new Date(2026,9,day,10).getTime()}};
  }
  const a=app(item,logs);
  const before=a.context.Insights.hourDist();
  a.update({target:20});
  const after=a.context.Insights.hourDist();
  assert.equal(before.total,14);
  assert.equal(after.total,14);
  assert.equal(after.bins[5],14);
  assert.equal(after.peak,5);
});

test('lazy Insights uses the same minimum-dose and step rules as Engine',()=>{
  const item=reading({type:'check',steps:['准备','完成']});
  const a=app(item,{'2026-10-27':{reading:{v:0,d:true,mini:1,steps:{}}}});
  assert.equal(a.context.Insights.doneOn(item,'2026-10-27'),true);
  a.update({steps:['一','二','三']});
  assert.equal(a.context.Insights.doneOn(item,'2026-10-27'),true);
  assert.equal(a.context.Insights.series(item,['2026-10-27']).ok,1);
});

test('Insights history patch is deterministic and idempotent',()=>{
  assert.equal(patchGrow(grow),grow);
});
