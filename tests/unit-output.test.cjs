'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const source=fs.readFileSync(process.env.UNIT_BUNDLE || path.join(__dirname,'../src/app.bundle.js'),'utf8');
const esc=x=>String(x).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function part(a,b){let start=source.indexOf(a),end=source.indexOf(b,start);assert.ok(start>=0&&end>start);return source.slice(start,end)}
function fixture(unit){
 let html='', title='';const item={id:'id',name:'测试',type:'duration',target:20,unit,reminderAt:'08:00',schedule:{type:'daily'}};
 const engine={getLog:()=>({v:5}),isDone:()=>false,restQuota:()=>0,isPartial:()=>false};
 const ctx={t:()=>({items:[item]}),e:esc,n:()=>'',mt:(t,s)=>{title=t;html=s},U:{esc,today:()=>"2026-10-29",num:x=>String(x),numShort:x=>String(x)},Engine:engine,window:{Timer:{active:()=>({itemId:'id'}),start(){}},Remind:{pendingList:()=>[item]}},xt(){},kt(){},setInterval(){return 1},Timer:null};ctx.Timer=ctx.window.Timer;ctx.Remind=ctx.window.Remind;
 vm.createContext(ctx);let timerStart=source.indexOf('openTimer:function(t){'),timerEnd=source.indexOf(',open',timerStart+20);let timer=source.slice(timerStart,timerEnd);assert.ok(timerEnd>timerStart);
 vm.runInContext('UI=({'+part('openQuickAdd:function(n){',',yearHeatHTML:')+','+part('openMissedPanel:function(){',',notifyDiagCard:')+','+timer+'});',ctx);
 vm.runInContext(part('function h(t,e){const a=[],s=', 'function b(')+';meta=h;',ctx);
 return {quick(){ctx.UI.openQuickAdd('id');return html},timer(){ctx.UI.openTimer(item);return html},missed(){ctx.UI.openMissedPanel();return html},meta(){return ctx.meta(item,'2026-10-29')}};
}
for(const kind of ['quick','timer','missed','meta']) test(kind+' escapes a unit as text, including target and remaining amounts',()=>{
 const f=fixture('<b>X');const markup=f[kind]();assert.ok(!markup.includes('<b>X'),markup);assert.ok(markup.includes('&lt;b&gt;X'),markup);
});
test('ordinary Chinese units remain readable in each view',()=>{
 const f=fixture('分钟');for(const kind of ['quick','timer','missed','meta']) assert.ok(f[kind]().includes('分钟'),kind);
});

test('an empty missed-reminder panel gives a friendly message without throwing',()=>{
 const ctx={window:{Remind:{pendingList:()=>[]}},U:{toast(message){ctx.message=message}},mt(){},toast:undefined};ctx.Remind=ctx.window.Remind;
 vm.createContext(ctx);vm.runInContext('UI=({'+part('openMissedPanel:function(){',',notifyDiagCard:')+'});',ctx);
 assert.doesNotThrow(()=>ctx.UI.openMissedPanel());assert.equal(ctx.message,'今天没有漏掉的提醒');
});
