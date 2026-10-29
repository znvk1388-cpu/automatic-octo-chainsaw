'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');
const project=fs.existsSync(path.join(__dirname,'../src/app.bundle.js'))?path.join(__dirname,'..'):'D:/codex/workspace/projects/02-开发项目/日拱一卒-v63完善';
const source=fs.readFileSync(path.join(project,'src/app.bundle.js'),'utf8');
const modulePath=fs.existsSync(path.join(__dirname,'../src/diary-conflicts.js'))?path.join(__dirname,'../src/diary-conflicts.js'):path.join(__dirname,'diary-conflicts.js');
const script=fs.existsSync(modulePath)?fs.readFileSync(modulePath,'utf8'):'';
const day='2026-10-28', record=JSON.stringify(['notes',day,'body']);
const clone=value=>JSON.parse(JSON.stringify(value));
function fixture(text='原文',device='device-a',owner='owner-a'){
  let now=100, signed=owner;
  class Clock extends Date{static now(){return now++;}}
  const data={version:7,deviceId:device,items:[],logs:{},notes:{[day]:{text,updatedAt:1,photos:[],audios:[],videos:[]}},media:{},settings:{cloudAccountId:owner}};
  const listeners={};
  const sandbox={Date:Clock,window:{},console};
  vm.createContext(sandbox);
  vm.runInContext(source.slice(source.indexOf('window.SyncModel='),source.indexOf('window.Cloud=')).replace(/,\s*$/,';'),sandbox);
  const root=sandbox.window;
  Object.assign(root,{Cloud:{uid(){return signed;}},Store:{s:data,commit(fn){fn(data);root.SyncModel.observe(data);},async saveNow(){root.SyncModel.observe(data);},async importJSON(value){Object.assign(data,clone(value.state||value));root.SyncModel.prepare(data,false);return true;}},UI:{render(){},diaryState(){return {date:day};},sheet(title,html){this.lastSheet={title,html};},closeSheet(){}},
    document:{addEventListener(name,fn){listeners[name]=fn;},dispatchEvent(event){if(listeners[event.type])listeners[event.type](event);},getElementById(){return null;}},CustomEvent:class{constructor(type){this.type=type;}}});
  root.SyncModel.prepare(data,false);
  vm.runInContext(script,sandbox);
  assert.ok(root.DiaryConflicts,'日记冲突保护模块必须提供真实行为');
  return {root,data,listeners,sync:root.SyncModel,model:root.DiaryConflicts,edit(value){data.notes[day].text=value;data.notes[day].updatedAt=now++;root.SyncModel.observe(data);},ack(payload){return root.DiaryConflicts.ack(data,payload||root.SyncModel.payload(data),{owner,deviceId:device});},remote(text,clock=200){const payload=root.SyncModel.payload(data);payload.notes[day].text=text;payload.notes[day].updatedAt=clock;payload._sync.records[record]={clock:[clock,'device-b'],deleted:false};return payload;},signIn(value){signed=value;}};
}
const copies=f=>Object.values(f.data.notes[day].textConflicts||{});
test('unchanged local text accepts a newer remote version without making a conflict',()=>{
  const f=fixture();f.ack();f.sync.merge(f.data,f.remote('远端更新'));
  assert.equal(f.data.notes[day].text,'远端更新');assert.equal(copies(f).length,0);
});
test('both edited branches preserve both exact texts and converge through payloads',()=>{
  const a=fixture(),b=fixture('原文','device-b');a.ack();b.ack();a.edit('本机改文');b.edit('另一设备改文');
  const beforeA=a.sync.payload(a.data),beforeB=b.sync.payload(b.data);
  a.sync.merge(a.data,beforeB);b.sync.merge(b.data,beforeA);
  assert.equal(copies(a).length,1);assert.deepEqual(new Set([copies(a)[0].local.text,copies(a)[0].remote.text]),new Set(['本机改文','另一设备改文']));
  a.sync.merge(a.data,b.sync.payload(b.data));b.sync.merge(b.data,a.sync.payload(a.data));
  assert.deepEqual(clone(a.data.notes[day].textConflicts),clone(b.data.notes[day].textConflicts));
});
test('only local edits or remote weather changes do not create text conflicts',()=>{
  const f=fixture();f.ack();const remote=f.remote('原文');remote.notes[day].weather={k:'rain'};f.edit('本机新文');f.sync.merge(f.data,remote);
  assert.equal(copies(f).length,0);assert.equal(f.data.notes[day].text,'本机新文');assert.equal(f.data.notes[day].weather.k,'rain');
});
test('remote text-only changes survive a newer local weather-only record',()=>{
  const f=fixture();f.ack();const remote=f.remote('远端新正文',150);f.data.notes[day].weather={k:'sunny'};f.data.notes[day].updatedAt=900;f.data._sync.records[record].clock=[900,'device-a'];f.sync.observe(f.data);
  f.sync.merge(f.data,remote);assert.equal(copies(f).length,0);assert.equal(f.data.notes[day].text,'远端新正文');assert.equal(f.data.notes[day].weather.k,'sunny');
});
test('remote versions at or below the acknowledged baseline are ancestors',()=>{
  const f=fixture('已同步新文');f.data._sync.records[record].clock=[300,'device-a'];f.ack();f.edit('继续编辑');f.sync.merge(f.data,f.remote('旧文',200));
  assert.equal(copies(f).length,0);assert.equal(f.data.notes[day].text,'继续编辑');
});
test('missing baseline conservatively preserves one copy without repeated sync duplicates',()=>{
  const f=fixture('旧本机文字'),remote=f.remote('另一段文字');
  for(let i=0;i<4;i++)f.sync.merge(f.data,remote);
  assert.equal(copies(f).length,1);assert.equal(copies(f)[0].reason,'unknown-base');
  f.ack();f.sync.merge(f.data,f.remote('普通后续更新',900));assert.equal(copies(f).length,1);
});
test('acknowledgment uses the transmitted snapshot, leaving in-flight edits dirty',()=>{
  const f=fixture();f.ack();f.edit('已发送版本');const sent=f.sync.payload(f.data);f.edit('网络期间新编辑');f.ack(sent);
  f.sync.merge(f.data,f.remote('其他设备改了已发送版本',500));
  assert.equal(copies(f).length,1);assert.ok([copies(f)[0].local.text,copies(f)[0].remote.text].includes('网络期间新编辑'));
});
test('local baseline never appears in cloud payload while conflict copies do',()=>{
  const f=fixture();f.ack();f.edit('本机');f.sync.merge(f.data,f.remote('远端'));
  const payload=f.sync.payload(f.data);assert.ok(f.data._sync.diaryBase);assert.equal(payload._sync.diaryBase,undefined);assert.equal(Object.keys(payload.notes[day].textConflicts).length,1);
});
test('owner and device scopes reject cross-account acknowledgment and stale device baselines',()=>{
  const f=fixture();f.ack();const before=JSON.stringify(f.data);f.signIn('owner-b');
  assert.throws(()=>f.sync.merge(f.data,f.remote('其他账号文字')),/账号/);assert.equal(JSON.stringify(f.data),before);
  assert.equal(f.model.ack(f.data,{notes:{}},{owner:'owner-b',deviceId:'device-a'}),false);
  f.signIn('owner-a');f.data.deviceId='new-device';f.edit('导入后文字');f.sync.merge(f.data,f.remote('原文'));
  assert.equal(copies(f).length,1);assert.equal(copies(f)[0].reason,'unknown-base');
});
test('blank edits are preserved and conflict copies survive user resolution and resync',()=>{
  const f=fixture();f.ack();f.edit('');const remote=f.remote('远端新文');f.sync.merge(f.data,remote);
  const entry=copies(f)[0];assert.ok(entry);f.model.resolve(day,entry.id,'merged','人工合并\n两段都保留');
  assert.equal(f.data.notes[day].text,'人工合并\n两段都保留');assert.equal(copies(f).length,1);assert.equal(copies(f)[0].resolution.text,'人工合并\n两段都保留');
  f.sync.merge(f.data,remote);assert.equal(copies(f).length,1);assert.ok(copies(f)[0].resolution);
});
test('choosing either preserved text keeps attachments and both historical copies',()=>{
  for(const choice of ['local','remote']){const f=fixture();f.ack();f.edit('本机');f.data.notes[day].photos=[{id:'photo'}];f.sync.merge(f.data,f.remote('远端'));
    const entry=copies(f)[0],want=entry[choice].text;assert.equal(f.model.resolve(day,entry.id,choice),true);assert.equal(f.data.notes[day].text,want);assert.equal(copies(f).length,1);assert.equal(f.data.notes[day].photos[0].id,'photo');}
});
test('comparison markup escapes diary text and exposes both versions plus editable merge',()=>{
  const f=fixture('<img src=x onerror=bad>');f.sync.merge(f.data,f.remote('</textarea><script>bad()</script>'));
  const html=f.model.comparison(day,copies(f)[0].id);assert.ok(!html.includes('<script>'));assert.ok(!html.includes('<img'));assert.match(html,/&lt;script&gt;/);assert.match(html,/data-diary-conflict="local"/);assert.match(html,/data-diary-conflict="remote"/);assert.match(html,/diaryConflictMerged/);
});
test('new remote note on a day absent locally is a normal creation',()=>{
  const f=fixture();const remote=f.remote('云端刚创建');delete f.data.notes[day];f.sync.prepare(f.data,false);f.sync.merge(f.data,remote);assert.equal(copies(f).length,0);
});
test('imported conflict copies stay available but imported device baselines are never trusted',async()=>{
  const f=fixture();f.ack();f.edit('本机');f.sync.merge(f.data,f.remote('远端'));const backup={state:clone(f.data)};
  await f.root.Store.importJSON(backup,'replace');assert.equal(f.data._sync.diaryBase,undefined);assert.equal(copies(f).length,1);assert.match(f.model.notice(day),/双方已保留/);
});
test('comparison and choice events flush buffered editor text before opening and resolving',()=>{
  const f=fixture();f.ack();f.edit('本机');f.sync.merge(f.data,f.remote('远端'));const entry=copies(f)[0];let flushed=0;
  f.listeners['rigong:before-sync']=()=>{flushed++;f.edit('尚在输入缓冲区的正文');};
  const click=action=>f.listeners.click({target:{closest(){return {dataset:{diaryConflict:action,day,id:entry.id}};}},preventDefault(){}});
  click('compare');assert.match(f.root.UI.lastSheet.html,/尚在输入缓冲区的正文/);assert.equal(flushed,1);
  click('local');assert.equal(f.data.notes[day].text,entry.local.text);assert.equal(flushed,2);
});
test('conflict archives from another owner do not enter the current cloud payload',()=>{
  const a=fixture();a.edit('本机');a.sync.merge(a.data,a.remote('远端'));const foreign=clone(copies(a)[0]);foreign.owner='owner-b';a.data.notes[day].textConflicts[foreign.id]=foreign;
  assert.equal(a.model.list(day).length,0);assert.equal(a.sync.payload(a.data).notes[day].textConflicts,undefined);
});
test('direct internal diary navigation refreshes conflict notice after the DOM render',()=>{
  const f=fixture();f.sync.merge(f.data,f.remote('不同正文'));const scheduled=[],inserted=[];
  f.root.setTimeout=callback=>scheduled.push(callback);
  f.listeners['rigong:before-render']();
  assert.equal(inserted.length,0);
  f.root.document.getElementById=id=>id==='dyText'?{parentElement:{insertAdjacentHTML(position,html){inserted.push(html);}}}:null;
  scheduled.forEach(callback=>callback());assert.equal(inserted.length,1);assert.match(inserted[0],/双方已保留/);
});
test('invalid remote payloads retain the original model validation and do not mutate notes',()=>{
  const f=fixture(),before=JSON.stringify(f.data.notes);assert.throws(()=>f.sync.merge(f.data,null),/云端数据格式不正确/);assert.equal(JSON.stringify(f.data.notes),before);
});
test('preloaded module installs on the actual window core event while the store is still hydrating',()=>{
  const events={},root={addEventListener(name,callback){events[name]=callback;},document:{addEventListener(){},getElementById(){throw new Error('hydration has no DOM data yet');}}};
  const sandbox={window:root};vm.createContext(sandbox);vm.runInContext(script,sandbox);
  vm.runInContext(source.slice(source.indexOf('window.SyncModel='),source.indexOf('window.Cloud=')).replace(/,\s*$/,';'),sandbox);
  root.Store={s:null};root.UI={render(){return 'rendered';}};const original=root.SyncModel.merge;
  assert.equal(typeof events['rgz:core'],'function');events['rgz:core']();assert.notEqual(root.SyncModel.merge,original);assert.equal(root.UI.render(),'rendered');assert.deepEqual(Array.from(root.DiaryConflicts.list(day)),[]);
});
test('first account binding retains previously unowned local conflict copies',()=>{
  const f=fixture('访客文字','guest-device','');f.sync.merge(f.data,f.remote('另一份访客文字'));assert.equal(copies(f).length,1);
  f.signIn('owner-a');f.data.settings.cloudAccountId='owner-a';assert.equal(f.model.list(day).length,1);assert.equal(f.model.list(day)[0].owner,'owner-a');
  assert.equal(Object.values(f.sync.payload(f.data).notes[day].textConflicts)[0].owner,'owner-a');
});
test('merge import unions local and imported conflict archives without trusting imported baselines',async()=>{
  const a=fixture('本机原文'),b=fixture('另一份原文');a.sync.merge(a.data,a.remote('本机另一文'));b.sync.merge(b.data,b.remote('导入另一文'));
  await a.root.Store.importJSON({state:clone(b.data)},'merge');assert.equal(copies(a).length,2);assert.equal(a.data._sync.diaryBase,undefined);
});
