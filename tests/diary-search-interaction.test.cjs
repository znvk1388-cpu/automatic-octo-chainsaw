'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const source=fs.readFileSync(path.join(__dirname,'../src/app.bundle.js'),'utf8');
function create(){
 const start=source.indexOf('dysearch(t){'),end=source.indexOf(',dyfoldmonth()',start);assert.ok(start>0&&end>start);
 let queued=null,query='',renders=0,focused=0;const input={value:'',isConnected:true,selectionStart:0,selectionEnd:0,focus(){focused++},setSelectionRange(a,b){this.selection=[a,b]}};
 const UI={setDiaryQuery(v){query=v},render(){renders++}};const ctx={UI,document:{getElementById:()=>input},setTimeout(fn){queued=fn;return 1},clearTimeout(){queued=null},M:null};vm.createContext(ctx);vm.runInContext('actions=({'+source.slice(start,end)+'})',ctx);
 return {input,actions:ctx.actions,run(){const f=queued;queued=null;f?.()},get query(){return query},get renders(){return renders},get focused(){return focused}};
}
test('diary search action does not run for a removed input after navigation',()=>{const f=create();f.input.value='阅读';f.actions.dysearch(f.input);f.input.isConnected=false;f.run();assert.equal(f.renders,0);assert.equal(f.query,'');});
test('clear cancels pending input and keeps query cleared',()=>{const f=create();f.input.value='阅读';f.actions.dysearch(f.input);f.actions.dyclearsearch();f.run();assert.equal(f.query,'');assert.equal(f.renders,1);});
test('search keeps cursor position when refreshing results',()=>{const f=create();f.input.value='阅读计划';f.input.selectionStart=1;f.input.selectionEnd=2;f.actions.dysearch(f.input);f.run();assert.equal(f.query,'阅读计划');assert.deepEqual(f.input.selection,[1,2]);});
