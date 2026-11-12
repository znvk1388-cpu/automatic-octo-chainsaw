'use strict';
// history-engine 版本/规则缓存（versionsCache / ruleCloneCache）的失效正确性：
// 编辑规则、跨天、暂停边界变化后，resolve/ruleAt 必须立即反映新状态。
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
  return {engine,data,history:sandbox.HistoryModel,update:patch=>sandbox.window.Update.updateItem(item.id,patch),at(date){now=new Date(date+'T04:00:00Z').getTime();engine.bustCache();}};
}

function habit(extra={}) {
  return Object.assign({id:'reading',name:'阅读',type:'number',target:10,unit:'页',steps:[],schedule:{type:'daily'},createdAt:new Date('2026-10-01T00:00:00Z').getTime(),updatedAt:new Date('2026-10-01T00:00:00Z').getTime(),archived:false},extra);
}

test('重复 resolve 后编辑规则，缓存必须立刻失效',()=>{
  const item=habit(); const app=setup(item);
  // 先填满缓存
  for(let i=0;i<50;i++) app.history.resolve(item,'2026-10-20');
  assert.equal(app.history.resolve(item,'2026-10-28').target,10);
  // 编辑目标
  app.update({target:30});
  assert.equal(app.history.resolve(item,'2026-10-28').target,30,'编辑后 ruleAt 不能返回缓存的旧规则');
  assert.equal(app.engine.itemAtDate(item,'2026-10-28').target,30);
});

test('跨天后缓存按日失效（暂停场景的生效边界随今天变化）',()=>{
  const item=habit({pausedUntil:'2026-11-05'});
  const app=setup(item);
  // 10-28 视角：暂停从 updatedAt（10-01）起生效
  const a=app.history.resolve(item,'2026-10-28');
  assert.equal(a.pausedUntil,'2026-11-05');
  // 大量调用填缓存
  for(let i=0;i<50;i++) app.history.resolve(item,'2026-10-28');
  // 跨到 11-10：effective 边界由 dateOf(updatedAt) 决定，但缓存键含“今天”
  app.at('2026-11-10');
  const b=app.history.resolve(item,'2026-11-10');
  assert.equal(b.pausedUntil,'2026-11-05');
  assert.equal(app.history.resolve(item,'2026-09-30').pausedUntil,null,'暂停开始前的日期不应视为暂停');
});

test('resolve 对同一规则返回的快照不被调用方污染',()=>{
  const item=habit({type:'check',steps:['a','b']});
  const app=setup(item);
  const r1=app.history.resolve(item,'2026-10-15');
  // 冻结的共享克隆：严格模式下 push 抛 TypeError，非严格模式下静默无效
  let threw=false;
  try{r1.steps.push('污染');}catch(e){threw=true;}
  r1.target=999;
  const r2=app.history.resolve(item,'2026-10-16');
  assert.deepEqual(Array.from(r2.steps),['a','b'],'共享的规则克隆不能被上一个调用方的修改污染');
  assert.equal(r2.target,10);
  assert.ok(threw||r1.steps.length===2,'污染操作必须被拒绝（抛错或无效）');
});

test('性能：无历史版本的 item 连续 resolve 一万次应在毫秒级（缓存生效）',()=>{
  const item=habit(); const app=setup(item);
  const t0=process.hrtime.bigint();
  for(let i=0;i<10000;i++) app.history.resolve(item,'2026-10-15');
  const ms=Number(process.hrtime.bigint()-t0)/1e6;
  assert.ok(ms < 1500, '一万次 resolve 耗时 '+ms.toFixed(0)+'ms，缓存可能未生效（优化前约为数倍）');
});
