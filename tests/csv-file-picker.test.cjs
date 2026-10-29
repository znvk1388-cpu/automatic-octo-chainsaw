'use strict';
const test=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const source=fs.readFileSync(process.env.CSV_PICK_BUNDLE||path.join(__dirname,'../src/app.bundle.js'),'utf8');
function fixture(){
 const a=source.indexOf('csvpick(){'),b=source.indexOf(',csvimport(){',a);assert.ok(a>=0&&b>a);
 let area={value:'',isConnected:true},preview={innerHTML:'旧预览'}, callbacks=[], previews=[],toasts=[];const active={current:true};const sheet={classList:{contains(name){return name==='on'&&active.current}}};
 const context={csvPickSeq:0,document:{getElementById(id){return id==='csvText'?area:id==='csvPreview'?preview:id==='sheet'?sheet:null;}},t:id=>id==='csvText'?area:id==='csvPreview'?preview:id==='sheet'?sheet:null,B(accept,cb){callbacks.push(cb)},UI:{csvPreview(value){previews.push(value)},},o(msg){toasts.push(msg)},Promise};
 vm.createContext(context);const action=vm.runInContext('({'+source.slice(a,b)+'}).csvpick',context);
 function select(file){action();return callbacks.at(-1)(file)}
 return {select,get area(){return area},get preview(){return preview},previews,toasts,replace(){area.isConnected=false;area={value:'new sheet',isConnected:true};preview={innerHTML:'new preview'}},setCurrent:flag=>active.current=flag};
}
function deferred(){let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b});return {promise,resolve,reject}}
test('file chooser reads file text and previews the actual CSV',async()=>{
 const f=fixture(),text='Date,读书\n2026-10-29,1';await f.select({text:()=>Promise.resolve(text)});assert.equal(f.area.value,text);assert.deepEqual(f.previews,[text]);
});
test('a slow first selection cannot overwrite a later selection',async()=>{
 const f=fixture(),a=deferred(),b=deferred(),one=f.select({text:()=>a.promise}),two=f.select({text:()=>b.promise});b.resolve('B');await two;a.resolve('A');await one;assert.equal(f.area.value,'B');assert.deepEqual(f.previews,['B']);
});
test('completed reads cannot write to a different sheet or overwrite user edits',async()=>{
 let f=fixture(),a=deferred(),pending=f.select({text:()=>a.promise});f.replace();a.resolve('OLD');await pending;assert.equal(f.area.value,'new sheet');assert.deepEqual(f.previews,[]);
 f=fixture();a=deferred();pending=f.select({text:()=>a.promise});f.setCurrent(false);a.resolve('CLOSED');await pending;assert.equal(f.area.value,'');assert.deepEqual(f.previews,[]);
 f=fixture();a=deferred();pending=f.select({text:()=>a.promise});f.area.value='用户正在输入';a.resolve('OLD');await pending;assert.equal(f.area.value,'用户正在输入');assert.deepEqual(f.previews,[]);
});
test('failed reads report a clear error and remove stale preview',async()=>{
 const f=fixture();await f.select({text:()=>Promise.reject(new Error('failure'))});assert.equal(f.preview.innerHTML,'');assert.match(f.toasts[0],/读取.*失败/);assert.deepEqual(f.previews,[]);
});
