const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

const script = fs.readFileSync(path.join(__dirname, '../src/daily-focus.js'), 'utf8');
const escape = value => String(value).replace(/[&<>"']/g, letter => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[letter]));
function fixture(initial) {
  let date = '2026-10-28';
  const actions = {saved:0, rendered:0, closed:0, menu:0, notes:[], inserted:[]};
  const listeners = {};
  const subscribers = [];
  const data = initial || {settings:{},items:[{id:'a',name:'阅读',type:'check'}, {id:'b',name:'运动',type:'duration'}],logs:{}};
  const body = {insertAdjacentHTML(position, html) { actions.inserted.push({position,html}); }};
  const root = {
    document: {activeElement:null,getElementById(id) {return id === 'sheetBody' ? body : null;},querySelector() {return null;},addEventListener(name, callback) {listeners[name]=callback;}},
    U:{today(){return date;},esc:escape,toast(){}},
    Store:{s:data,commit(callback) {callback(data);actions.saved++;subscribers.forEach(callback=>callback());},onChange(callback) {subscribers.push(callback);}},
    Engine:{sorted(){return data.items;},isDue(item) {return !item.notDue;},isSkipped(day,id) {return !!(data.logs[day] && data.logs[day][id] && data.logs[day][id].s);},isDone(item,day){const log=this.getLog(day,item.id);return !!(log && (log.d||log.mini));},isMiniDone(item,day){const log=this.getLog(day,item.id);return !!(log&&log.mini);},isPartial(item,day){const log=this.getLog(day,item.id);return !!(log&&log.partial);},getLog(day,id){return data.logs[day]&&data.logs[day][id];},noteOf(id,day){const log=this.getLog(day,id);return log&&log.note||'';}},
    Product:{todayHeader(){return '<section class="p-today-head">Original header</section>';}},
    UI:{tab:'today',openHabitMenu(){actions.menu++;return 'original-result';},sheet(title,html){actions.sheet={title,html};},closeSheet(){actions.closed++;},render(){actions.rendered++;},openNoteSheet(...args){actions.notes.push(args);}}
  };
  vm.runInNewContext(script,{window:root});
  return {root,data,actions,listeners,nextDay(){date='2026-10-29';},emit(){subscribers.forEach(callback=>callback());},click(action,id){let prevented=false;listeners.click({target:{closest(){return {dataset:{v63Focus:action,id}};}},preventDefault(){prevented=true;}});assert.equal(prevented,true);}};
}

test('daily priority is optional and does not auto-select or duplicate a first habit',()=>{
  const f=fixture();
  assert.equal(f.root.DailyFocus.current(),null);
  assert.match(f.root.DailyFocus.html(),/选一件/);
  assert.equal(f.actions.saved,0);
  f.data.items.pop();
  assert.equal(f.root.DailyFocus.html(),'');
  f.data.items=[];
  assert.equal(f.root.DailyFocus.html(),'');
});

test('selection persists by date and survives a fresh script instance',()=>{
  const f=fixture();
  assert.equal(f.root.DailyFocus.select('a'),true);
  assert.deepEqual(JSON.parse(JSON.stringify(f.data.settings.dailyFocus)),{date:'2026-10-28',itemId:'a'});
  const next=fixture(JSON.parse(JSON.stringify(f.data)));
  assert.equal(next.root.DailyFocus.current().id,'a');
  next.nextDay();
  assert.equal(next.root.DailyFocus.current(),null);
});

test('archived, deleted, non-due, and skipped habits cannot be selected',()=>{
  const f=fixture();
  for (const change of [{archived:true},{deleted:true},{notDue:true}]) {
    Object.assign(f.data.items[0],change);
    assert.equal(f.root.DailyFocus.select('a'),false);
    for (const key of Object.keys(change)) delete f.data.items[0][key];
  }
  f.data.logs['2026-10-28']={a:{s:1}};
  assert.equal(f.root.DailyFocus.select('a'),false);
  assert.equal(f.root.DailyFocus.select('missing'),false);
  assert.equal(f.actions.saved,0);
  delete f.data.logs['2026-10-28'];
  f.root.DailyFocus.select('a');
  f.data.items[0].archived=true;
  assert.equal(f.root.DailyFocus.current(),null);
});

test('focus markup escapes habit names, identifiers, and note text',()=>{
  const f=fixture();
  const id='a" onclick="bad';
  f.data.items[0]={id,name:'<img src=x onerror=bad>',type:'check'};
  f.root.DailyFocus.select(id);
  f.data.logs['2026-10-28']={[id]:{d:true,note:'<script>bad()</script>'}};
  const html=f.root.DailyFocus.html();
  assert.ok(!html.includes('<img'));
  assert.ok(!html.includes('<script>'));
  assert.match(html,/&lt;img/);
  assert.match(html,/&quot; onclick=&quot;bad/);
  assert.match(html,/&lt;script&gt;/);
});

test('status distinguishes started, partial, light and full without changing log facts',()=>{
  const f=fixture(), item=f.data.items[0];
  f.root.DailyFocus.select('a');
  const labels=[{log:{v:1},label:'已开始'},{log:{v:1,partial:true},label:'部分完成'},{log:{v:0,mini:true,d:true},label:'轻量完成'},{log:{v:1,d:true,note:'读到了第三章'},label:'已完成'}];
  for (const entry of labels) {
    f.data.logs['2026-10-28']={a:entry.log};
    const before=JSON.stringify(f.data.logs);
    assert.equal(f.root.DailyFocus.status(item),entry.label);
    const html=f.root.DailyFocus.html();
    assert.match(html,new RegExp(entry.label));
    assert.equal(JSON.stringify(f.data.logs),before);
  }
  assert.match(f.root.DailyFocus.html(),/读到了第三章/);
  assert.match(f.root.DailyFocus.html(),/修改这一句/);
});

test('priority actions reuse the original check-in, timer, and note flows',()=>{
  const f=fixture();
  f.root.DailyFocus.select('a');
  assert.match(f.root.DailyFocus.html(),/data-act="tick"/);
  f.root.DailyFocus.select('b');
  assert.match(f.root.DailyFocus.html(),/data-act="timerstart"/);
  f.root.Timer={isFor(){return true;}};
  assert.match(f.root.DailyFocus.html(),/data-act="timeropen"/);
  f.data.items[1].type='number';
  assert.match(f.root.DailyFocus.html(),/data-act="quickadd"/);
  f.data.logs['2026-10-28']={b:{d:true,v:10,note:'原始备注'}};
  f.click('note','b');
  assert.deepEqual(f.actions.notes,[['b','2026-10-28']]);
  assert.equal(f.data.logs['2026-10-28'].b.note,'原始备注');
});

test('menu and picker select one priority, clear it, and keep original navigation',()=>{
  const f=fixture();
  assert.equal(f.root.UI.openHabitMenu('a'),'original-result');
  assert.equal(f.actions.menu,1);
  assert.match(f.actions.inserted[0].html,/设为今日重点/);
  f.click('choose');
  assert.equal(f.actions.sheet.title,'选一件今日重点');
  assert.match(f.actions.sheet.html,/data-v63-focus="select"/);
  f.click('select','b');
  assert.equal(f.root.DailyFocus.current().id,'b');
  assert.equal(f.actions.closed,1);
  assert.equal(f.actions.rendered,1);
  f.click('menu','a');
  assert.equal(f.root.DailyFocus.current().id,'a');
  assert.equal(f.actions.closed,2);
  f.click('clear');
  assert.equal(f.root.DailyFocus.current(),null);
  assert.equal(f.data.settings.dailyFocus,undefined);
});

test('installation is idempotent and preserves an already-rendered page without rerendering',()=>{
  const f=fixture();
  const header=f.root.Product.todayHeader;
  assert.equal(f.root.DailyFocus.install(),false);
  assert.equal(f.root.Product.todayHeader,header);
  assert.match(header(),/Original header/);
  assert.equal((header().match(/id="v63DailyFocus"/g)||[]).length,1);
  assert.equal(f.actions.rendered,0);
});

test('a selected priority retains dependency locks for check-ins and timers',()=>{
  const f=fixture();
  f.data.items[0].dependsOn='b';
  assert.equal(f.root.DailyFocus.select('a'),true);
  assert.equal(f.root.DailyFocus.current().id,'a');
  let html=f.root.DailyFocus.html();
  assert.match(html,/请先完成「运动」/);
  assert.match(html,/disabled aria-disabled="true"/);
  assert.ok(!html.includes('data-act="tick"'));
  assert.equal(f.root.DailyFocus.status(f.data.items[0]),'等待前置习惯');
  f.data.logs['2026-10-28']={b:{d:true,v:10}};
  html=f.root.DailyFocus.html();
  assert.match(html,/data-act="tick"/);
  assert.ok(!html.includes('v63FocusDependency'));
  // A missing prerequisite must not silently unlock a task.
  f.data.items[0].dependsOn='missing';
  html=f.root.DailyFocus.html();
  assert.match(html,/前置习惯不可用/);
  assert.ok(!html.includes('data-act="tick"'));
  // The same guard covers duration/timer actions.
  f.data.items[0].dependsOn=null;
  f.data.items[1].dependsOn='a';
  delete f.data.logs['2026-10-28'];
  f.root.DailyFocus.select('b');
  html=f.root.DailyFocus.html();
  assert.match(html,/请先完成「阅读」/);
  assert.ok(!html.includes('data-act="timerstart"'));
  assert.ok(!html.includes('data-act="timeropen"'));
  // Existing completed records can still use the optional note sheet.
  f.data.logs['2026-10-28']={b:{d:true,v:30}};
  html=f.root.DailyFocus.html();
  assert.match(html,/data-v63-focus="note"/);
  assert.ok(!html.includes('v63FocusDependency'));
});
