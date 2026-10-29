const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const source=fs.readFileSync(path.join(__dirname,'../src/app.bundle.js'),'utf8');
function fixture(kind='today'){
 const handlers={},timers=new Map();let next=0,renders=0,current;
 const root={};
 function input(value='') {return {id:kind==='today'?'todaySearch':'habitSearch',dataset:{productInput:kind},value,isConnected:true,selectionStart:value.length,selectionEnd:value.length,focus(){},setSelectionRange(){}};}
 current=input();
 const document={addEventListener(name,fn){(handlers[name]||=[]).push(fn)},getElementById(id){return current.id===id?current:null}};
 const context={window:root,document,U:{esc:x=>x},Engine:{},Store:{s:{settings:{}}},setTimeout(fn){const id=++next;timers.set(id,fn);return id},clearTimeout(id){timers.delete(id)},UI:{render(){renders++;current.isConnected=false;current=input(kind==='today'?root.Product.state().todayQuery:root.Product.state().habitQuery)},closeSheet(){}}};
 root.UI=context.UI;vm.runInNewContext(source.slice(source.indexOf('window.Product='),source.indexOf('window.UI=')).replace(/,\s*$/,';'),context);
 function emit(name,extra={}){const event={target:current,preventDefault(){},...extra};(handlers[name]||[]).forEach(fn=>fn(event));}
 return {root,emit,get current(){return current},get renders(){return renders},run(){const work=[...timers.values()];timers.clear();work.forEach(fn=>fn())},click(action,filter){emit('click',{target:{closest(){return {dataset:{product:action,filter,scope:kind}}}}})}};
}
for(const kind of ['today','habits']){
 test(kind+': beginning Chinese composition cancels a pending pre-composition search',()=>{
  const f=fixture(kind);f.current.value='y';f.emit('input',{isComposing:false});f.emit('compositionstart');f.current.value='阅读';f.emit('input',{isComposing:true});f.run();assert.equal(f.renders,0);
  f.emit('compositionend');f.run();assert.equal(f.renders,1);assert.equal(f.root.Product.state()[kind==='today'?'todayQuery':'habitQuery'],'阅读');
 });
 test(kind+': composition remains protected when an intermediate event reports false',()=>{
  const f=fixture(kind);f.emit('compositionstart');f.current.value='yue';f.emit('input',{isComposing:false});f.run();assert.equal(f.renders,0);
 });
}
test('a quick completion filter applies the current input before replacing the search box',()=>{
 const f=fixture();f.current.value='阅读';f.emit('input',{isComposing:false});f.click('filter','pending');assert.equal(f.root.Product.state().todayQuery,'阅读');assert.equal(f.root.Product.state().todayFilter,'pending');f.run();assert.equal(f.renders,1);
});
test('reset cancels the queued search so an old keyword cannot reappear',()=>{
 const f=fixture();f.current.value='阅读';f.emit('input',{isComposing:false});f.click('reset');f.run();assert.equal(f.root.Product.state().todayQuery,'');assert.equal(f.renders,1);
});
test('clearing habit search cancels pending input and restores only that page query',()=>{
 const f=fixture('habits');f.current.value='无结果';f.emit('input',{isComposing:false});f.run();assert.equal(f.root.Product.state().habitQuery,'无结果');f.current.value='另一个词';f.emit('input',{isComposing:false});f.click('clearsearch');f.run();assert.equal(f.root.Product.state().habitQuery,'');assert.equal(f.root.Product.state().todayFilter,'all');
});
