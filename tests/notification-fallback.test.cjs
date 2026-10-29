'use strict';
const test=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');const vm=require('node:vm');const path=require('node:path');
const source=fs.readFileSync(process.env.REMINDER_BUNDLE || path.join(__dirname,'../src/app.bundle.js'),'utf8');
function fixture(){
 const start=source.indexOf('window.Remind=function()'),end=source.indexOf('window.ICS=',start);assert.ok(start>=0&&end>start);
 let notification,toggles=0,saves=0,focused=0;const navigation=[];
 function Notification(title,options){notification={title,options,close(){this.closed=true}};return notification}Notification.permission='granted';
 const root={Notification,focus(){focused++},UI:{go(v){navigation.push(v)}},Store:null};
 const ctx={window:root,Notification,navigator:{},document:{},localStorage:{getItem(){return null},setItem(){}},Store:{s:{settings:{},items:[{id:'habit',type:'number',target:10}]},commit(){saves++}},Engine:{needsHabitReminder(){return true},toggle(){toggles++}},U:{today(){return '2026-10-29'}},setTimeout(fn){fn();return 1},clearInterval(){},setInterval(){},Date,Promise};
 ctx.UI=root.UI;root.Store=ctx.Store;vm.createContext(ctx);vm.runInContext(source.slice(start,end).replace(/,\s*$/,';'),ctx);
 return {root,ctx,getNotification(){return notification},state(){return {toggles,saves,focused,navigation}}};
}
test('tapping a notification body opens today without changing habit history',()=>{
 const f=fixture();f.root.Remind.fire('该打卡了','打开应用后记录',{url:'./?check=habit',tag:'one'});const n=f.getNotification();assert.ok(n);n.onclick();assert.deepEqual(f.state(),{toggles:0,saves:0,focused:1,navigation:['today']});assert.equal(n.closed,true);
});
test('other notification body taps retain normal focus and do not mark a habit',()=>{
 const f=fixture();f.root.Remind.fire('日记','写一笔',{url:'./#diary'});f.getNotification().onclick();assert.deepEqual(f.state(),{toggles:0,saves:0,focused:1,navigation:[]});
});
test('existing explicit check URL keeps its current behavior for calendar links',()=>{
 const f=fixture();f.root.Remind.handleClick('?check=habit');assert.equal(f.state().toggles,1);assert.equal(f.state().saves,1);
});
