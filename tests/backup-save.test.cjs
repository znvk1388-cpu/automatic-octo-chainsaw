const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const src = fs.readFileSync(path.join(__dirname, '../src/app.bundle.js'), 'utf8');
const start = src.indexOf('async export(t){');
const end = src.indexOf(',import(){', start);
assert.ok(start >= 0 && end > start);

async function run(mode, confirmed) {
  const messages=[], prompts=[];
  const Store={s:{settings:{lastBackupAt:123}}, async exportJSON(){return {state:{items:[],logs:{}}};},commit(fn){fn(this.s);}};
  const c={Store, U:{today:()=> '2026-10-28', esc:String, saveTextFile:async()=>mode},
    UX:{async confirm(q){prompts.push(q);return confirmed;}},
    o: s=>messages.push(s), _: x=>x};
  c.window=c;
  vm.createContext(c);
  vm.runInContext(fs.readFileSync(path.join(__dirname,'../src/backup-confirm.js'),'utf8'),c);
  vm.runInContext('this.actions={' + src.slice(start,end) + '}',c);
  await c.actions.export(false);
  return {Store,messages,prompts};
}

test('share and clipboard do not suppress backup reminders without confirmation', async () => {
  for (const mode of ['share','clipboard']) {
    const r=await run(mode,false);
    assert.equal(r.Store.s.settings.lastBackupAt,123);
    assert.equal(r.prompts.length,1);
  }
});

test('the user can confirm the backup has been saved', async () => {
  const r=await run('share',true);
  assert.ok(r.Store.s.settings.lastBackupAt>123);
});

test('failed export does not change backup time or claim success', async () => {
  const r=await run('fail',true);
  assert.equal(r.Store.s.settings.lastBackupAt,123);
  assert.equal(r.prompts.length,0);
  assert.ok(r.messages.some(m=>m.includes('失败')));
});


test('a download also requires confirmation before updating the backup date', async () => {
  const r=await run('download',false);
  assert.equal(r.Store.s.settings.lastBackupAt,123);
  assert.equal(r.prompts.length,1);
});

test('encrypted export does not mark a shared backup saved without confirmation', async () => {
  const begin=src.indexOf('async exportenc(){');
  const finish=src.indexOf(',quickexport()',begin);
  assert.ok(begin>=0 && finish>begin);
  const Store={s:{settings:{lastBackupAt:123}}, async exportJSON(){return {state:{items:[],logs:{}}};},commit(fn){fn(this.s);}};
  let n=0; const messages=[];
  const Enc={available:()=>true,async encrypt(s){return {content:s};},async decrypt(v){return v.content;}};
  const c={Store,Enc,U:{today:()=> '2026-10-28',esc:String,saveTextFile:async()=> 'share'},
    UX:{async confirm(){return ++n === 1;},async prompt(){return 'password123';}},
    o:m=>messages.push(m),_:x=>x}; c.window=c;
  vm.createContext(c);
  vm.runInContext(fs.readFileSync(path.join(__dirname,'../src/backup-confirm.js'),'utf8'),c);
  vm.runInContext('this.actions={' + src.slice(begin,finish) + '}',c);
  await c.actions.exportenc();
  assert.equal(n,2);
  assert.equal(Store.s.settings.lastBackupAt,123);
  assert.ok(messages.some(m=>m.includes('请保存')));
});
