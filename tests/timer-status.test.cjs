'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, '../src/app.bundle.js'), 'utf8');
const focusSource = fs.readFileSync(path.join(__dirname, '../src/daily-focus.js'), 'utf8');
function between(begin, end, offset = 0) {
  const start = source.indexOf(begin, offset), finish = source.indexOf(end, start);
  assert.ok(start >= 0 && finish > start, 'real timer/UI source section exists');
  return source.slice(start, finish);
}
function fixture() {
  let now = 1000000, intervalId = 0;
  const intervals = new Map(), subscribers = [], elements = new Map();
  const item = {id:'duration', name:'阅读', type:'duration', target:30, unit:'分钟', color:'#888'};
  const data = {items:[item], logs:{}, settings:{dailyFocus:{date:'2026-10-28',itemId:item.id}}};
  function element(id) {
    if (!elements.has(id)) {
      const classes = new Set();
      elements.set(id, {style:{},textContent:'',innerHTML:'',inert:false,
        classList:{add(name){classes.add(name);},remove(name){classes.delete(name);},contains(name){return classes.has(name);},toggle(name,on){if(on)classes.add(name);else classes.delete(name);}},
        setAttribute(){},removeAttribute(){},focus(){},addEventListener(){},
        querySelector(){return element('close');}});
    }
    return elements.get(id);
  }
  const context = {
    Date: class extends Date {static now(){return now;}},
    setInterval(callback){const id=++intervalId;intervals.set(id,callback);return id;},
    clearInterval(id){intervals.delete(id);},
    Store:{s:data,commit(callback){if(callback)callback(data);subscribers.forEach(fn=>fn());},onChange(fn){subscribers.push(fn);}},
    U:{today(){return '2026-10-28';},esc(value){return String(value).replace(/[&<>"']/g,letter=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[letter]));},num:String,numShort:String,pad(value){return String(value).padStart(2,'0');}},
    Engine:{sorted(){return data.items;},isDue(){return true;},isSkipped(){return false;},isDone(){return false;},isMiniDone(){return false;},isPartial(){return false;},getLog(day,id){return data.logs[day]&&data.logs[day][id];},noteOf(){return '';},restQuota(){return null;},isAvoid(){return false;},streakOf(){return 0;},streakUnit(){return '天';},rateLabel(){return {text:'近30天 0%'};},backfillDays(){return 7;},miniOf(){return ''; }},
    document:{activeElement:null,body:{style:{}},getElementById(id){return id==='badgePop'?null:element(id);},querySelector(){return null;},addEventListener(){},removeEventListener(){}},
    UI:{tab:'today',render(){}}
  };
  context.p = id => context.document.getElementById(id);
  context.window = context;
  vm.createContext(context);
  vm.runInContext(between('window.Timer=', 'window.Extra=').replace(/,\s*$/, ';'), context);
  vm.runInContext('const t=()=>Store.s,e=U.esc,n=id=>\'<svg><use href="assets/icons.svg#\'+id+\'"></use></svg>\',s={any:"随时"};',context);
  const homeStart = source.indexOf('function y(a){');
  vm.runInContext('this.homeControl='+between('c=function(t,a){','}(a,s),l=h(a,s);',homeStart).slice(2)+'};',context);
  vm.runInContext(between('function K(t,a,i){','const Q=',homeStart),context);
  vm.runInContext(between('function Ht(', 'function Ft('),context);
  vm.runInContext(between('let ct=null,', 'function gt('),context);
  vm.runInContext(between('let wt=null;', 'function Ut('),context);
  vm.runInContext('this.menu={'+between('openHabitMenu:function(', ',openQuickAdd:function(')+'};',context);
  vm.runInContext('this.panel={'+between('openTimer:function(', ',openTodoEdit:function(')+'};',context);
  vm.runInContext(focusSource,context);
  return {context,data,item,intervals,element,advance(ms){now+=ms;},
    home(){return context.homeControl(item,'2026-10-28');},
    habits(){return context.K(item,0,1);},
    menu(){context.menu.openHabitMenu(item.id,'habits');return element('sheetBody').innerHTML;}};
}
for (const entry of ['home','habits','menu']) {
  test(entry+' timer entry distinguishes running, paused and resumed sessions',()=>{
    const f=fixture();
    assert.match(f[entry](),/开始计时/);
    f.context.Timer.start(f.item.id);
    assert.match(f[entry](),/正在计时|计时中/);
    f.advance(65000);
    f.context.Timer.pause();
    const before=JSON.stringify(f.data), paused=f[entry]();
    assert.match(paused,/已暂停/);
    assert.doesNotMatch(paused,/正在计时|计时中/);
    assert.match(paused,/data-act="timeropen"/);
    assert.equal(JSON.stringify(f.data),before);
    f.context.Timer.resume();
    assert.match(f[entry](),/正在计时|计时中/);
  });
}
test('daily focus reflects running and paused timer state without restarting it',()=>{
  const f=fixture();
  assert.match(f.context.DailyFocus.html(),/开始计时/);
  f.context.Timer.start(f.item.id);
  assert.equal(f.context.DailyFocus.status(f.item),'计时中');
  f.advance(65000);
  f.context.Timer.pause();
  assert.equal(f.context.DailyFocus.status(f.item),'已暂停');
  const before=JSON.stringify(f.data);
  const html=f.context.DailyFocus.html();
  assert.match(html,/继续计时/);
  assert.match(html,/data-act="timeropen"/);
  assert.equal(JSON.stringify(f.data),before);
});
test('closing and reopening a timer panel preserves running or paused time',()=>{
  for (const paused of [false,true]) {
    const f=fixture();
    f.context.Timer.start(f.item.id);
    f.advance(65000);
    if(paused)f.context.Timer.pause();
    const session=f.context.Timer.active();
    f.context.panel.openTimer(f.item);
    assert.equal(f.element('timerBtn').textContent,paused?'继续':'暂停');
    f.context.vt();
    assert.equal(f.context.Timer.active(),session);
    assert.equal(f.context.Timer.active().running,!paused);
    f.advance(5000);
    assert.equal(f.context.Timer.elapsed(),paused?65000:70000);
    f.context.panel.openTimer(f.item);
    assert.equal(f.context.Timer.active(),session);
    assert.equal(f.context.Timer.active().running,!paused);
    assert.equal(f.element('timerBtn').textContent,paused?'继续':'暂停');
    assert.deepEqual(f.data.logs,{});
  }
});
