const test = require('node:test');
const assert = require('node:assert/strict');
const create = require('../src/sheet-navigation.js');
function fixture() {
 let visible=false, confirm=false, popped;
 const entries=[{page:'today'}];let index=0;
 const history={get state(){return entries[index]},pushState(s){entries.splice(++index);entries.push(s)},back(){if(index>0){index--;queueMicrotask(()=>popped())}}};
 let closes=0,cancels=0;
 const root={history,location:{href:'http://localhost/'},addEventListener(n,fn){if(n==='popstate')popped=fn},document:{getElementById(id){if(id==='sheet')return {classList:{contains:()=>visible}};if(id==='cfMask'&&confirm)return {querySelector:()=>({click(){confirm=false;cancels++}})};return null}},UI:{closeSheet(){visible=false;closes++;api.closed()}}};
 const api=create(root);api.install();return {api,root,history,setVisible:v=>visible=v,setConfirm:v=>confirm=v,closes:()=>closes,cancels:()=>cancels,entries,pop:()=>{index--;popped()}};
}
test('back dismisses a sheet and preserves original route state',()=>{
 const f=fixture();f.setVisible(true);f.api.opened();assert.equal(f.entries.length,2);f.pop();assert.equal(f.closes(),1);assert.deepEqual(f.history.state,{page:'today'});
});
test('sheet-to-sheet navigation keeps one back entry',()=>{
 const f=fixture();f.setVisible(true);f.api.opened();f.api.opened();assert.equal(f.entries.length,2);f.pop();assert.equal(f.closes(),1);
});
test('back cancels the top confirmation before closing the underlying sheet',()=>{
 const f=fixture();f.setVisible(true);f.api.opened();f.setConfirm(true);f.pop();assert.equal(f.cancels(),1);assert.equal(f.closes(),0);f.pop();assert.equal(f.closes(),1);
});
test('closing then immediately opening a sheet does not close the new sheet on pending pop',async()=>{
 const f=fixture();f.setVisible(true);f.api.opened();f.setVisible(false);f.api.closed();f.setVisible(true);f.api.opened();await Promise.resolve();assert.equal(f.closes(),0);f.pop();assert.equal(f.closes(),1);
});

test('a confirmation is canceled while its first animation frame is still pending',async()=>{
 const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
 const source=fs.readFileSync(path.join(__dirname,'../src/app.bundle.js'),'utf8');
 const start=source.indexOf('function i(t){return t=t||{},new Promise');
 const end=source.indexOf('const o={mood:',start);
 assert.ok(start>=0&&end>start);
 const f=fixture(),frames=[];let modal;
 const originalGet=f.root.document.getElementById;
 f.root.document.getElementById=id=>id==='cfMask'?modal:originalGet(id);
 f.root.document.body={appendChild(el){modal=el}};
 f.root.document.createElement=()=>{
  const classes=new Set(),listeners={};
  return {
   dataset:{},
   classList:{add:c=>classes.add(c),remove:c=>classes.delete(c),contains:c=>classes.has(c)},
   remove(){modal=null},
   addEventListener(n,fn){listeners[n]=fn},
   querySelector(){
    return {click(){listeners.click({target:{closest:()=>({dataset:{cf:'0'}})}})}};
   }
  };
 };
 const sandbox={window:{SheetNavigation:f.api},SheetNavigation:f.api,document:f.root.document,U:{esc:x=>x},s:()=>'',a:()=>{},requestAnimationFrame:fn=>frames.push(fn),setTimeout(){}};
 vm.createContext(sandbox);vm.runInContext(source.slice(start,end)+';this.confirmDialog=i;',sandbox);
 f.setVisible(true);f.api.opened();const answer=sandbox.confirmDialog({msg:'确认'});
 f.pop();assert.equal(await answer,false);assert.equal(f.closes(),0);
 frames.forEach(fn=>fn());assert.equal(modal.classList.contains('on'),false);
 assert.equal(modal.dataset.state,'closing');
 f.pop();assert.equal(f.closes(),1);
});
