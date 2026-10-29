'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const source = fs.readFileSync(process.env.HABIT_FORM_BUNDLE || path.join(__dirname, '../src/app.bundle.js'), 'utf8');
function section(start, end) {
  const a = source.indexOf(start), b = source.indexOf(end, a);
  assert.ok(a >= 0 && b > a, 'bundle form functions must exist');
  return source.slice(a, b);
}
function fixture(type = 'check', schedule = {type:'daily'}) {
  const fields = {}, events = {focused:[],scrolled:[],saved:[],closed:0,placed:[]};
  function node(id, value = '') {
    const attributes = {}, listeners = {};
    return fields[id] = {id,value,dataset:{},hidden:id === 'fErr',style:{},attributes,listeners,
      setAttribute(name,value){attributes[name]=String(value);},getAttribute(name){return attributes[name] ?? null;},removeAttribute(name){delete attributes[name];},
      addEventListener(name,fn){listeners[name]=fn;},closest(selector){return selector.includes("#fSchedExtra")&&["fSchedN","fSchedDays","fDays"].includes(id)?fields.fSchedExtra:selector.includes("#fGoalFields")&&id==="fTarget"?fields.fGoalFields:selector===".field"?this:null;},insertAdjacentElement(position,el){events.placed.push({anchor:id,position,id:el.id});},focus(){events.focused.push(id);},scrollIntoView(){events.scrolled.push(id);},querySelector(){return null;}};
  }
  for (const id of ['sheetBody','fName','fSave','fErr','fTarget','fUnit','fRemind','fDep','fWhy','fCue','fSteps','fSchedExtra','fSchedN','fSchedDays','fGoalFields']) node(id);
  fields.fName.value = '测试习惯';
  fields.fName.setAttribute('aria-describedby','fNameHint');
  const firstDay = node('firstDay');firstDay.dataset.fd='1';
  const days=node('fDays');days.querySelector=()=>firstDay;days.querySelectorAll=()=>[];
  const state={items:[],settings:{}}, ui={closeSheet(){events.closed++;},render(){}};
  const context={UI:ui,Store:{s:state,palette:()=>['#123456']},window:{},t:()=>state,p:id=>fields[id],bt:null,s:{any:'全天'},
    e:value=>String(value),n:()=>'',ft:()=>'',ht:()=>'',gt(){},mt(){},U:{toast(){}},o(){},tt(){},
    Feat:{addItem(item){events.saved.push(item);},updateItem(id,item){events.saved.push(item);}}};
  vm.createContext(context);
  vm.runInContext('Object.assign(UI,({'+section('formError:',',openTools:')+','+section('openHabit:',',openBundle:')+'}));action=({'+section('savehabit(t){',',moveup(t){')+'}).savehabit;',context);
  ui.openHabit({type,schedule});
  return {ui,fields,events,state,save(){context.action({dataset:{id:''}});},collect(){return ui.collectHabit('');},input(id){const event={target:fields[id]};fields[id].listeners.input?.(event);fields.sheetBody.oninput?.(event);},change(id){fields.sheetBody.onchange?.({target:fields[id]});},pick(field,value){const button={dataset:{f:field,v:value},parentNode:{}};fields.sheetBody.onclick({target:{closest(selector){return selector==='[data-f]'?button:null;}}});}};
}

test('an emptied weekly count or interval is rejected instead of silently restoring a default',()=>{
  for (const type of ['timesPerWeek','interval']) {
    const f=fixture('check',{type,n:5});f.fields.fSchedN.value='';f.save();
    assert.equal(f.events.saved.length,0,type);
    assert.equal(f.fields.fErr.hidden,false,type);
    assert.equal(f.events.focused.at(-1),'fSchedN',type);
  }
});

test('yearly schedules reject impossible month days, partial garbage, and extra date parts',()=>{
  for (const value of ['2-30','4-31','13-1','0-1','3-0','3-15,垃圾','3-15-9','-3-15','3-15,12/1/9']) {
    const f=fixture('check',{type:'yearly'});f.fields.fSchedDays.value=value;f.save();
    assert.equal(f.events.saved.length,0,value);
    assert.equal(f.fields.fErr.hidden,false,value);
    assert.equal(f.events.focused.at(-1),'fSchedDays',value);
  }
});

test('yearly input accepts real dates including leap day and keeps all intended dates',()=>{
  const f=fixture('check',{type:'yearly'});f.fields.fSchedDays.value='3-15，12/1 2月29日';
  const habit=f.collect();
  assert.deepEqual(Array.from(habit.schedule.dates),['03-15','12-01','02-29']);
  assert.equal(f.ui.validateHabit(habit,''),'');f.save();assert.equal(f.events.saved.length,1);
});

test('target validation focuses and associates the actual field without saving a habit',()=>{
  const f=fixture('number');f.fields.fTarget.value='0';f.save();
  assert.equal(f.events.saved.length,0);
  assert.equal(f.events.focused.at(-1),'fTarget');
  assert.ok(f.events.scrolled.includes('fTarget'));
  assert.equal(f.fields.fTarget.getAttribute('aria-invalid'),'true');
  assert.ok(f.fields.fTarget.getAttribute('aria-describedby').split(/\s+/).includes('fErr'));
});

test('invalid weekly counts, intervals, and monthly lists focus their corresponding inputs',()=>{
  for (const [type,value,id] of [['timesPerWeek','8','fSchedN'],['interval','1','fSchedN'],['monthly','1,99','fSchedDays']]) {
    const f=fixture('check',{type});f.fields[id].value=value;f.save();
    assert.equal(f.events.saved.length,0,type);
    assert.equal(f.events.focused.at(-1),id,type);
    assert.equal(f.fields[id].getAttribute('aria-invalid'),'true',type);
  }
});

test('an empty weekday selection focuses an available day button and clears on selection',()=>{
  const f=fixture('check',{type:'weekdays',days:[]});f.save();
  assert.equal(f.events.saved.length,0);
  assert.equal(f.events.focused.at(-1),'firstDay');
  assert.equal(f.fields.firstDay.getAttribute('aria-invalid'),'true');
  const button={classList:{toggle(){}},dataset:{fd:'1'}};
  f.fields.sheetBody.onclick({target:{closest(selector){return selector==='[data-fd]'?button:null;}}});
  assert.equal(f.fields.fErr.hidden,true);
  assert.equal(f.fields.firstDay.getAttribute('aria-invalid'),null);
});

test('name error retains its original hint association after correcting the name',()=>{
  const f=fixture();f.fields.fName.value='';f.save();
  assert.equal(f.events.focused.at(-1),'fName');
  assert.equal(f.fields.fName.getAttribute('aria-describedby'),'fNameHint fErr');
  f.fields.fName.value='读书';f.input('fName');
  assert.equal(f.fields.fName.getAttribute('aria-describedby'),'fNameHint');
  assert.equal(f.fields.fName.getAttribute('aria-invalid'),null);
  assert.equal(f.fields.fErr.hidden,true);
  assert.equal(f.fields.fSave.disabled,false);
});

test('only editing the erroneous field clears a stale error and its accessibility state',()=>{
  const f=fixture('number');f.fields.fTarget.value='0';f.save();
  f.fields.fName.value='阅读';f.input('fName');assert.equal(f.fields.fErr.hidden,false);
  f.fields.fTarget.value='30';f.input('fTarget');
  assert.equal(f.fields.fErr.hidden,true);
  assert.equal(f.fields.fErr.textContent,'');
  assert.equal(f.fields.fTarget.getAttribute('aria-invalid'),null);
  assert.equal(f.fields.fTarget.getAttribute('aria-describedby'),null);
  f.save();assert.equal(f.events.saved.length,1);
});

test('schedule changes clear errors belonging to the replaced schedule inputs',()=>{
  const f=fixture('check',{type:'monthly'});f.fields.fSchedDays.value='99';f.save();
  assert.equal(f.fields.fErr.hidden,false);
  f.pick('sched','daily');
  assert.equal(f.fields.fErr.hidden,true);
  assert.equal(f.fields.fSchedDays.getAttribute('aria-invalid'),null);
});

test('validation stays a string API and duplicate checks still allow editing the same habit',()=>{
  const f=fixture();f.state.items.push({id:'h1',name:'测试习惯'});
  const habit=f.collect();
  assert.equal(typeof f.ui.validateHabit(habit,''),'string');
  assert.ok(f.ui.validateHabit(habit,''));
  assert.equal(f.ui.validateHabit(habit,'h1'),'');
});

test('opening any other sheet releases old habit input and change handlers',()=>{
  const body={onclick(){},oninput(){},onchange(){},querySelector(){return {addEventListener(){}};}};
  const element={classList:{contains:()=>true,add(){}},setAttribute(){},removeAttribute(){},focus(){}};
  const context={window:{},p:id=>id==='sheetBody'?body:id==='app'?{}:element,document:{getElementById(){return null;},body:{style:{}},addEventListener(){},removeEventListener(){}},e:value=>value,vt(){},pt(){}};
  vm.createContext(context);
  vm.runInContext(section('function mt(t,n){','function vt(){')+';mt("其他弹窗","内容")',context);
  assert.equal(body.onclick,null);
  assert.equal(body.oninput,null);
  assert.equal(body.onchange,null);
});

test('the single error appears beside its field outside replaceable schedule markup',()=>{
 const target=fixture('number');target.fields.fTarget.value='0';target.save();assert.deepEqual(target.events.placed.at(-1),{anchor:'fGoalFields',position:'afterend',id:'fErr'});
 const dates=fixture('check',{type:'yearly'});dates.fields.fSchedDays.value='2-30';dates.save();assert.deepEqual(dates.events.placed.at(-1),{anchor:'fSchedExtra',position:'afterend',id:'fErr'});
});
