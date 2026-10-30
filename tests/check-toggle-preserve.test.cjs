'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const base=path.join(__dirname,'..'),bundle=fs.readFileSync(path.join(base,'src/app.bundle.js'),'utf8');
const standalone=s=>s.replace(/,\s*$/,';');
const today='2026-10-29', past='2026-10-27';
function fixture(type,logs={},day=today){
 const item={id:'habit',name:'习惯',type,unit:'',steps:[],schedule:{type:'daily'},createdAt:new Date('2026-10-01T00:00:00Z').getTime(),updatedAt:new Date('2026-10-01T00:00:00Z').getTime()};
 const data={version:7,deviceId:'test-device',items:[item],logs,notes:{},media:{},freezes:{},redemptions:[],settings:{weekStart:1,seedPts:0,nickname:'测试'}};
 class FixedDate extends Date{constructor(...args){super(...(args.length?args:['2026-10-29T04:00:00Z']))}static now(){return new Date('2026-10-29T04:00:00Z').getTime()}}
 const sb={window:{},Date:FixedDate,Store:{s:data,rev:1}};sb.window.Store=sb.Store;vm.createContext(sb);
 vm.runInContext(fs.readFileSync(path.join(base,'src/history-engine.js'),'utf8'),sb);sb.HistoryModel=sb.window.HistoryModel;
 vm.runInContext(standalone(bundle.slice(0,bundle.indexOf('window.ErrLog='))),sb);sb.U=sb.window.U;
 vm.runInContext(standalone(bundle.slice(bundle.indexOf('window.SyncModel='),bundle.indexOf('window.Cloud='))),sb);
 vm.runInContext(standalone(bundle.slice(bundle.indexOf('window.Engine='),bundle.indexOf('window.Parse='))),sb);
 const engine=sb.window.Engine;sb.Engine=engine;sb.Store.commit=fn=>{if(fn)fn(data);sb.Store.rev++;engine.bustCache()};
 return {data,item,engine,sync:sb.window.SyncModel,day};
}
for(const type of ['check','avoid'])test(type+': 取消完成只清除完成状态，保留应对次数、备注和其他数据',()=>{
 const original={urge:2,note:'当时的备注',slip:1,why:'stress',extension:{answer:'保留'}};
 const f=fixture(type,{[today]:{habit:structuredClone(original)}});assert.equal(f.engine.toggle(f.item,today),true);assert.equal(f.engine.toggle(f.item,today),false);
 const log=f.data.logs[today].habit;assert.ok(log,'记录及其附加数据必须保留');for(const key of Object.keys(original))assert.deepEqual(log[key],original[key],key);
 assert.equal(log.d,false);assert.equal(log.v,0);assert.equal(log._plan.completed,false);assert.equal(f.engine.isDone(f.item,today),false);
 f.engine.toggle(f.item,today);assert.equal(f.engine.isDone(f.item,today),true);assert.equal(f.data.logs[today].habit.urge,2);
});
test('仅有普通完成字段时取消仍移除空日志，避免产生空白记录',()=>{
 const f=fixture('check');f.engine.toggle(f.item,today);assert.equal(f.engine.isDone(f.item,today),true);f.engine.toggle(f.item,today);assert.equal(f.data.logs[today].habit,undefined);
});
test('历史补记取消完成保留原排程与修正后完成状态',()=>{
 const oldPlan={type:'check',target:null,unit:'',steps:[],schedule:{type:'weekdays',days:[2]},restPerWeek:0,restPerMonth:0,archived:false,pausedFrom:null,pausedUntil:null,completed:false};
 const f=fixture('check',{[past]:{habit:{d:false,v:0,note:'历史备注',_plan:structuredClone(oldPlan)}}},past);
 f.engine.toggle(f.item,past);f.engine.toggle(f.item,past);const log=f.data.logs[past].habit;assert.ok(log);assert.equal(log.note,'历史备注');assert.deepEqual(JSON.parse(JSON.stringify(log._plan.schedule)),oldPlan.schedule);assert.equal(log._plan.completed,false);assert.equal(f.engine.isDone(f.item,past),false);
});
test('附加记录和取消状态可随真实同步载荷往返，重新打卡不会丢记录',()=>{
 const f=fixture('avoid',{[today]:{habit:{urge:3,note:'记录',slip:1,why:'late'}}});f.engine.toggle(f.item,today);f.engine.toggle(f.item,today);
 f.sync.prepare(f.data,false);const payload=f.sync.payload(f.data);const reloaded=JSON.parse(JSON.stringify(payload));const log=reloaded.logs[today].habit;
 assert.equal(log.urge,3);assert.equal(log.note,'记录');assert.equal(log.slip,1);assert.equal(log.why,'late');assert.equal(log.d,false);assert.equal(log._plan.completed,false);
 const g=fixture('avoid',reloaded.logs);assert.equal(g.engine.isDone(g.item,today),false);g.engine.toggle(g.item,today);assert.equal(g.engine.isDone(g.item,today),true);assert.equal(g.data.logs[today].habit.urge,3);
});

test('公共撤销入口复用已有撤销条并执行指定回调',()=>{
 const start=bundle.indexOf('let x=null;function I(e,n,a,s,i)'),end=bundle.indexOf('let C="all",csvPickSeq=0;const A=',start);assert.ok(start>0&&end>start);
 let action,visible=false;const button={};const bar={innerHTML:'',classList:{add(){visible=true},remove(){visible=false}}};
 const ctx={window:{U:{}},U:{esc:s=>s},t:id=>id==='undoBar'?bar:id==='undoBtn'?button:null,setTimeout(){return 1},clearTimeout(){}};vm.createContext(ctx);vm.runInContext(bundle.slice(start,end),ctx);
 assert.equal(typeof ctx.window.U.showUndo,'function');ctx.window.U.showUndo('已记录','撤销',()=>{action='done'},8000);assert.equal(visible,true);assert.match(bar.innerHTML,/已记录/);button.onclick();assert.equal(action,'done');assert.equal(visible,false);
});
