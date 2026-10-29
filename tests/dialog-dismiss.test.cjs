'use strict';
const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const project = path.join(__dirname, '..');
const source = fs.readFileSync(process.env.BUNDLE_REVIEW_PATH || path.join(project, 'src/app.bundle.js'), 'utf8');
const createNavigation = require('../src/sheet-navigation.js');
const segments = {
  export: ['async export(t){', ',import(){'],
  exportenc: ['async exportenc(){', ',quickexport(){'],
  wipe: ['async wipe(){', ',invite(){'],
  webdavconflict: ['async webdavconflict(t){', ',async webdavapply('],
  webdavdown: ['async webdavdown(){', ',async webdavhist(){']
};
const tick = async () => { for (let i = 0; i < 10; i++) await Promise.resolve(); };
function fixture() {
  let modal, index = 0;
  const states = [{}], listeners = {}, calls = [];
  const c = {console, queueMicrotask, location: {href:'http://example.invalid/', origin:'http://example.invalid'},
    requestAnimationFrame(fn){fn();}, setTimeout(){return 1;}, clearTimeout(){},
    addEventListener(name, fn){listeners[name] = fn;},
    history: {
      get state(){return states[index];},
      pushState(value){states.splice(++index); states.push(value);},
      back(){if(index > 0){index--;queueMicrotask(() => listeners.popstate());}}
    },
    document: {
      getElementById(id){return id === 'cfMask' ? modal : null;},
      body: {appendChild(el){modal = el;}},
      createElement(){const events = {}, classes = new Set(); return {
        dataset:{}, classList:{add:x=>classes.add(x),remove:x=>classes.delete(x),contains:x=>classes.has(x)},
        remove(){if(modal === this) modal = null;},
        addEventListener(name, fn){events[name] = fn;},
        querySelector(){return {click(){events.click({target:{closest:()=>({dataset:{cf:'0'}})}});}};},
        press(value){events.click({target:{closest:()=>({dataset:{cf:String(value)}})}});}
      };}
    },
    U:{esc:x=>String(x),today:()=> '2026-10-28',ymd:()=> '2026-10-28',hhmm:()=> '10:00',async saveTextFile(){calls.push(['saveFile']);return 'download';}},
    o:message=>calls.push(['message',message]), a(){}, E:x=>String(x), _:x=>x, s:()=>'',
    Store:{s:{items:[],logs:{},notes:{},settings:{}}, async exportJSON(media){calls.push(['export',media]);return {state:{items:[]}};},
      async importJSON(data,mode){calls.push(['import',mode]);}, async wipe(cloud){calls.push(['wipe',cloud]);},commit(fn){if(fn)fn(this.s);}},
    UI:{render(){},closeSheet(){}},Cloud:{signedIn:()=>true},
    Enc:{available:()=>true,isEnvelope:()=>false,async encrypt(text){return {data:text};},async decrypt(value){return value.data;}},
    BackupReceipt:{async confirmSaved(){return true;}},Safety:{snapshot(){calls.push(['snapshot']);}},
    WebDAV:{has:()=>true,async pull(){calls.push(['pull']);return {ok:true,text:'{}',meta:{savedAt:1,habits:1}};},
      async upload(options){calls.push(['upload',options]);return {ok:true};},markSeen(){calls.push(['markSeen']);}},
    A:{async webdavapply(text,mode){calls.push(['apply',mode]);}}
  };
  c.window = c;
  c.SheetNavigation = createNavigation(c); c.SheetNavigation.install();
  vm.createContext(c);
  const start = source.indexOf('function i(t){return t=t||{},new Promise');
  const end = source.indexOf('const o={mood:', start);
  assert.ok(start >= 0 && end > start, 'extract actual UX.confirm implementation');
  vm.runInContext(source.slice(start,end) + ';this.UX={confirm:i,prompt:async()=>"test-password"};',c);
  for(const [name,[first,last]] of Object.entries(segments)) {
    const a=source.indexOf(first),b=source.indexOf(last,a);assert.ok(a>=0&&b>a,name);
    vm.runInContext('this.actions=Object.assign(this.actions||{},{'+source.slice(a,b)+'});',c);
  }
  const a=source.indexOf('async function q(t){try{const e=await t.text();'),b=source.indexOf('function Y(){Feat.Voice',a);
  assert.ok(a>=0&&b>a,'extract actual file importer');
  vm.runInContext(source.slice(a,b)+';this.importFile=q;',c);
  const methods = {
    export:()=>c.actions.export(), exportenc:()=>c.actions.exportenc(), wipe:()=>c.actions.wipe(),
    webdavconflict:()=>c.actions.webdavconflict({meta:{savedAt:1}}), webdavdown:()=>c.actions.webdavdown(),
    import:()=>c.importFile({async text(){return JSON.stringify({state:{items:[{id:'test',name:'测试习惯'}],logs:{},notes:{},settings:{}}});}})
  };
  return {c,calls,run:name=>methods[name](),modal:()=>modal,
    back(){assert.ok(index>0,'modal owns a history entry');index--;listeners.popstate();},
    click(value){assert.ok(modal,'confirmation is open');modal.press(value);}};
}

test('Back settles a marked choice as null while explicit buttons keep Boolean results',async()=>{
  for(const [operation,expected] of [['back',null],['false',false],['true',true]]){
    const f=fixture(),answer=f.c.UX.confirm({triState:true,msg:'测试二选一'});
    if(operation==='back')f.back();else f.click(operation==='true'?1:0);
    assert.equal(await answer,expected);
  }
  const f=fixture(),answer=f.c.UX.confirm({msg:'普通取消'});f.back();assert.equal(await answer,false);
});

for(const name of ['export','exportenc','wipe','webdavconflict','webdavdown','import']) {
  test('Back stops the actual '+name+' binary-choice flow without performing either operation',async()=>{
    const f=fixture(),pending=f.run(name);await tick();
    if(['wipe','webdavdown','import'].includes(name)){f.click(1);await tick();}
    assert.ok(f.modal());assert.equal(typeof f.modal().__dismiss,'function');
    f.back();await pending;
    const effects=f.calls.filter(call=>['saveFile','export','import','wipe','upload','apply','markSeen'].includes(call[0]));
    assert.deepEqual(effects,[]);
    assert.equal(f.modal().dataset.state,'closing');
  });
}

for(const name of ['export','exportenc','wipe','webdavconflict','webdavdown','import']) {
  test('Explicit secondary button retains the actual '+name+' operation',async()=>{
    const f=fixture(),pending=f.run(name);await tick();
    if(['wipe','webdavdown','import'].includes(name)){f.click(1);await tick();}
    f.click(0);await tick();
    if(name==='wipe'){assert.match(f.modal().innerHTML,/最后确认一次/);f.click(1);}
    await pending;
    const expected={export:['export',false],exportenc:['export',false],wipe:['wipe',false],
      webdavconflict:['upload',{force:true}],webdavdown:['apply','merge'],import:['import','merge']}[name];
    assert.ok(f.calls.some(call=>JSON.stringify(call)===JSON.stringify(expected)),JSON.stringify(f.calls));
  });
}
