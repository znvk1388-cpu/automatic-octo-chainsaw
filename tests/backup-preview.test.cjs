'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const source = fs.readFileSync(path.join(__dirname, '../src/app.bundle.js'), 'utf8');
const start = source.indexOf('async function q(t){try{const e=await t.text()');
const end = source.indexOf('function Y(){Feat.Voice.supported()', start);
assert.ok(start >= 0 && end > start);

test('canceling the backup preview never imports or snapshots data', async () => {
  const prompts = [], imports = [];
  const Store = {s:{items:[],logs:{},settings:{}}, importJSON(...args){imports.push(args);}};
  const context = {Store, window:{Store}, location:{origin:'https://example.test'},
    UX:{async confirm(options){prompts.push(options);return false;}},
    U:{esc: String}, o(){}, a(){}, UI:{render(){}}};
  vm.createContext(context);
  vm.runInContext(source.slice(start,end) + '\nthis.readBackup = q;', context);
  await context.readBackup({text:async()=>JSON.stringify({state:{items:[{name:'A'}],logs:{'2026-10-01':{}},notes:{},settings:{}}})});
  assert.equal(prompts.length,1);
  assert.match(prompts[0].html, /2026-10-01/);
  assert.equal(imports.length,0);
});


test('canceling WebDAV restore preview does not import or mark the backup seen', async () => {
  const start = source.indexOf('async webdavdown(){');
  const end = source.indexOf(',async webdavhist()', start);
  assert.ok(start >= 0 && end > start);
  let imported = 0, seen = 0;
  const WebDAV = {has:()=>true, pull:async()=>({ok:true,text:'{}',meta:{habits:2,days:3}}),markSeen(){seen++;}};
  const context = {WebDAV, UX:{confirm:async()=>false}, U:{}, E:String, o(){}, window:{}};
  vm.createContext(context);
  vm.runInContext('this.A = {' + source.slice(start,end) + ',webdavapply(){ imported++; }};', Object.assign(context, {imported:0}));
  await context.A.webdavdown();
  assert.equal(context.imported, 0);
  assert.equal(seen, 0);
});


test('after preview confirmation the selected merge imports the original backup', async () => {
  const prompts=[], imports=[];
  const Store={s:{items:[],logs:{},settings:{}}, async importJSON(...args){imports.push(args);}, commit(fn){fn(this.s);}};
  const context={Store,window:{Store},location:{origin:'https://example.test'},
    UX:{async confirm(options){prompts.push(options);return prompts.length===1;}}, U:{esc:String},o(){},a(){},UI:{render(){}}};
  vm.createContext(context);
  vm.runInContext(source.slice(start,end)+'\nthis.readBackup = q;',context);
  const data=JSON.stringify({state:{items:[{name:'A'}],logs:{'2026-10-01':{}},notes:{},settings:{}}});
  await context.readBackup({text:async()=>data});
  assert.equal(prompts.length,2);
  assert.equal(imports.length,1);
  assert.equal(imports[0][0],data);
  assert.equal(imports[0][1],'merge');
});


test('CSV export does not claim that a restorable full backup was made', async () => {
  const begin=source.indexOf('async exportcsv(){');
  const finish=source.indexOf(',async exporthmd()',begin);
  assert.ok(begin>=0 && finish>begin);
  const Store={s:{items:[{id:'a'}],logs:{'2026-10-01':{}},settings:{lastBackupAt:123}},commit(fn){fn(this.s);}};
  const context={Store,Plus:{exportCSV:()=>"header\\r\\nline\\r\\n"},
    UX:{confirm:async()=>true},U:{today:()=>"2026-10-28",saveTextFile:async()=>"download"},o(){}};
  vm.createContext(context);
  vm.runInContext('this.action={' + source.slice(begin,finish) + '};',context);
  await context.action.exportcsv();
  assert.equal(Store.s.settings.lastBackupAt,123);
});
