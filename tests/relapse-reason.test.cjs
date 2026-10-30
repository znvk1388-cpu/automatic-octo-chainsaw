const test = require('node:test');
const assert = require('node:assert/strict');
const create = require('../src/relapse-reason.js');

const TODAY = '2026-10-29';
function ymdShift(date, n) {
  const [y, m, d] = date.split('-').map(Number);
  const t = new Date(y, m - 1, d + n);
  const p = v => String(v).padStart(2, '0');
  return t.getFullYear() + '-' + p(t.getMonth() + 1) + '-' + p(t.getDate());
}
function fixture(logs) {
  const state = { logs: logs || { [TODAY]: { h1: { d: false, v: 0, slip: 1 } } }, items: [] };
  const root = {
    U: { today: () => TODAY, shiftYmd: ymdShift, esc: v => String(v == null ? '' : v) },
    Store: { s: state, commit: fn => fn(state) },
    document: { addEventListener() { } },
    UI: { openHabitMenu() { }, sheet() { }, closeSheet() { }, render() { } }
  };
  return { api: create(root), root, state };
}

test('只有真的破戒的那天才能记原因', () => {
  const { api, state } = fixture({ [TODAY]: { h1: { d: true, v: 1 } } });
  assert.equal(api.slipped(TODAY, 'h1'), false);
  assert.equal(api.setReason(TODAY, 'h1', 'stress'), false);
  assert.equal(api.reasonOf(TODAY, 'h1'), '');
  assert.equal(state.logs[TODAY].h1.why, undefined);
});

test('记下触发点并映射成人话，非法值不接受', () => {
  const { api, state } = fixture();
  assert.equal(api.setReason(TODAY, 'h1', 'stress'), true);
  assert.equal(state.logs[TODAY].h1.why, 'stress');
  assert.equal(api.reasonOf(TODAY, 'h1'), 'stress');
  assert.equal(api.labelOf('stress'), '压力');
  assert.equal(api.setReason(TODAY, 'h1', 'not-a-reason'), false);
  assert.equal(state.logs[TODAY].h1.why, 'stress');
});

test('原因可以清除，破戒事实不受影响', () => {
  const { api, state } = fixture();
  api.setReason(TODAY, 'h1', 'late');
  assert.equal(api.setReason(TODAY, 'h1', ''), true);
  assert.equal(api.reasonOf(TODAY, 'h1'), '');
  assert.equal(state.logs[TODAY].h1.slip, 1);
  assert.equal(state.logs[TODAY].h1.d, false);
});

test('90 天汇总：破戒次数、写了几次原因、最常触发', () => {
  const logs = {
    [TODAY]: { h1: { slip: 1, why: 'stress' } },
    [ymdShift(TODAY, -3)]: { h1: { slip: 1, why: 'stress' } },
    [ymdShift(TODAY, -9)]: { h2: { slip: 1, why: 'late' } },
    [ymdShift(TODAY, -12)]: { h1: { slip: 1 } },
    [ymdShift(TODAY, -120)]: { h1: { slip: 1, why: 'bored' } }
  };
  const { api } = fixture(logs);
  const sum = api.summary(90);
  assert.equal(sum.slips, 4, '范围外那次不算');
  assert.equal(sum.tagged, 3);
  assert.deepEqual(sum.top, { k: 'stress', label: '压力', n: 2 });
  assert.deepEqual(sum.list.map(x => x.k), ['stress', 'late']);
});

test('没有破戒记录时汇总为零，不报错', () => {
  const { api } = fixture({});
  const sum = api.summary(90);
  assert.equal(sum.slips, 0);
  assert.equal(sum.tagged, 0);
  assert.equal(sum.top, null);
});

test('触发原因选择前会说明备份和云同步的数据范围', () => {
 const {api,root}=fixture();let sheet='',bar='';root.UI.sheet=(title,html)=>{sheet=html};root.document={body:{appendChild(el){bar=el.innerHTML}},getElementById(){return null},createElement(){return {setAttribute(){},innerHTML:''}}};
 api.openSheet('h1');api.showBar('h1');for(const html of [sheet,bar]){assert.match(html,/云同步/);assert.match(html,/备份/);}
});

test('触发原因与应对次数确实会进入云同步载荷',()=>{
 const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');const s=fs.readFileSync(path.join(__dirname,'../src/app.bundle.js'),'utf8');const ctx={window:{},console};vm.createContext(ctx);vm.runInContext(s.slice(s.indexOf('window.SyncModel='),s.indexOf('window.Cloud=')).replace(/,\s*$/,';'),ctx);
 const data={version:7,deviceId:'test-device',items:[{id:'h1',type:'avoid'}],logs:{[TODAY]:{h1:{slip:1,why:'stress',urge:1}}},notes:{},media:{},settings:{}};
 ctx.window.SyncModel.prepare(data,false);const log=ctx.window.SyncModel.payload(data).logs[TODAY].h1;assert.equal(log.why,'stress');assert.equal(log.urge,1);
});

test('单个习惯面板只统计该习惯的触发原因',()=>{
 const logs={ [TODAY]:{h1:{slip:1,why:'stress'},h2:{slip:1,why:'late'}} };
 const {api,root}=fixture(logs);let html='';root.UI.sheet=(title,value)=>html=value;api.openSheet('h1');assert.match(html,/破戒 1 次/);assert.match(html,/压力/);assert.doesNotMatch(html,/最常见的是「熬夜」/);
});

test('其他弹窗打开时原因提示条隐藏，不能关闭其他编辑弹窗',()=>{
 const {api,root,state}=fixture();let bar,click,observer,open=false,closed=0;
 const sheet={classList:{contains:k=>k==='on'&&open}};
 root.document={body:{appendChild(el){bar=el}},getElementById(id){return id==='sheet'?sheet:id==='rgReasonBar'?bar:null},createElement(){return {setAttribute(){},innerHTML:'',remove(){bar=null}}},addEventListener(name,fn){if(name==='click')click=fn}};
 root.MutationObserver=class {constructor(fn){observer=fn}observe(){}};
 root.UI.closeSheet=()=>closed++;api.install();api.showBar('h1');open=true;observer();assert.equal(bar.hidden,true);
 const target={dataset:{rgReason:'pick',k:'stress'},closest(selector){if(selector==='[data-rg-reason]')return this;if(selector==='#rgReasonBar')return bar;return null}};
 click({target,preventDefault(){}});assert.equal(closed,0);assert.equal(state.logs[TODAY].h1.why,undefined);
 open=false;observer();assert.equal(bar.hidden,false);
});

test('不同习惯切换原因弹窗后，浮条仍只记录原习惯',()=>{
 const {api,root,state}=fixture({[TODAY]:{h1:{slip:1},h2:{slip:1}}});let bar,click,observer,open=false;
 const sheet={classList:{contains:k=>k==='on'&&open}};
 root.document={body:{appendChild(el){bar=el}},getElementById(id){return id==='sheet'?sheet:id==='rgReasonBar'?bar:null},createElement(){return {setAttribute(){},innerHTML:'',remove(){bar=null}}},addEventListener(name,fn){if(name==='click')click=fn}};
 root.MutationObserver=class {constructor(fn){observer=fn}observe(){}};
 root.UI.sheet=()=>{open=true;observer()};root.UI.closeSheet=()=>{open=false;observer()};root.U.toast=()=>{};
 api.install();api.showBar('h1');api.openSheet('h2');root.UI.closeSheet();
 const target={dataset:{rgReason:'pick',k:'stress'},closest(selector){if(selector==='[data-rg-reason]')return this;if(selector==='#rgReasonBar')return bar;return null}};
 click({target,preventDefault(){}});assert.equal(state.logs[TODAY].h1.why,'stress');assert.equal(state.logs[TODAY].h2.why,undefined);
});

function interactionFixture(logs) {
 const f=fixture(logs),listeners={},toasts=[];let date=TODAY,bar=null,open=false,observer,html='',closed=0;
 const sheet={classList:{contains:k=>k==='on'&&open}};
 f.root.document={
  body:{appendChild(el){bar=el}},
  getElementById(id){return id==='sheet'?sheet:id==='rgReasonBar'?bar:id==='sheetBody'?{insertAdjacentHTML(){}}:null},
  createElement(){return {setAttribute(){},innerHTML:'',remove(){bar=null}}},
  addEventListener(name,fn){listeners[name]=fn}
 };
 f.root.MutationObserver=class{constructor(fn){observer=fn}observe(){}};
 f.root.U.today=()=>date;f.root.U.toast=message=>toasts.push(message);
 f.root.UI.sheet=(title,content)=>{html=content;open=true;observer()};
 f.root.UI.closeSheet=()=>{closed++;open=false;observer()};
 f.api.install();
 return Object.assign(f,{
  toasts,setDate(value){date=value},bar:()=>bar,sheetHtml:()=>html,closed:()=>closed,
  reason(action,inBar=true,extra={}){
   const target={dataset:{rgReason:action,...extra},closest(selector){
    if(selector==='[data-rg-reason]')return this;
    if(selector==='#rgReasonBar'&&inBar)return bar;
    if(selector==='#sheetBody'&&!inBar)return {};
    return null;
   }};
   listeners.click({target,preventDefault(){}});
  },
  slip(id){const target={dataset:{id},closest:selector=>selector==='[data-act="slip"]'?target:null};listeners.click({target,preventDefault(){}})},
  emitSlip(detail){listeners['rg:slip']({detail})}
 });
}

test('午夜后浮条和原因弹窗仍给打开时那天记原因',()=>{
 for(const inBar of [true,false])for(const nextSlip of [true,false]){
  const f=interactionFixture({[TODAY]:{h1:{slip:1}},'2026-10-30':{h1:nextSlip?{slip:1}:{}}});
  if(inBar)f.api.showBar('h1');else f.api.openSheet('h1');
  f.setDate('2026-10-30');f.reason('pick',inBar,{k:'stress'});
  assert.equal(f.state.logs[TODAY].h1.why,'stress');assert.equal(f.state.logs['2026-10-30'].h1.why,undefined);
 }
});

test('午夜后清除只影响弹窗显示的原日期',()=>{
 const f=interactionFixture({[TODAY]:{h1:{slip:1,why:'stress'}},'2026-10-30':{h1:{slip:1,why:'late'}}});
 f.api.openSheet('h1');f.setDate('2026-10-30');f.reason('clear',false);
 assert.equal(f.state.logs[TODAY].h1.why,undefined);assert.equal(f.state.logs['2026-10-30'].h1.why,'late');
});

test('原日志消失后清除返回失败，不关闭弹窗或提示已清除',()=>{
 const f=interactionFixture({[TODAY]:{h1:{slip:1,why:'stress'}}});f.api.openSheet('h1');delete f.state.logs[TODAY].h1;
 assert.equal(f.api.setReason(TODAY,'h1',''),false);f.reason('clear',false);
 assert.equal(f.closed(),0);assert.doesNotMatch(f.toasts.join(' '),/已清除/);assert.ok(f.toasts.length);
});

test('浮条和原因弹窗显示实际绑定日期，显式日期可补记前一天',()=>{
 for(const inBar of [true,false]){
  const f=interactionFixture({[TODAY]:{h1:{slip:1}},'2026-10-30':{h1:{slip:1}}});f.setDate('2026-10-30');
  if(inBar)f.api.showBar('h1',TODAY);else f.api.openSheet('h1',TODAY);
  assert.match(inBar?f.bar().innerHTML:f.sheetHtml(),/2026-10-29/);f.reason('pick',inBar,{k:'bored'});
  assert.equal(f.state.logs[TODAY].h1.why,'bored');assert.equal(f.state.logs['2026-10-30'].h1.why,undefined);
 }
});

test('破戒事件携带日期时绑定事件日期，旧事件仍默认今天',()=>{
 const f=interactionFixture({[TODAY]:{h1:{slip:1}},'2026-10-30':{h1:{slip:1}}});f.setDate('2026-10-30');
 f.emitSlip({id:'h1',date:TODAY});f.reason('pick',true,{k:'stress'});assert.equal(f.state.logs[TODAY].h1.why,'stress');
 f.emitSlip({id:'h1'});f.reason('pick',true,{k:'late'});assert.equal(f.state.logs['2026-10-30'].h1.why,'late');
});

test('破戒捕获的延迟回调跨午夜仍使用点击当天',t=>{
 t.mock.timers.enable({apis:['setTimeout']});const f=interactionFixture({[TODAY]:{h1:{slip:1}}});
 f.slip('h1');f.setDate('2026-10-30');t.mock.timers.tick(60);assert.ok(f.bar());
 f.reason('pick',true,{k:'stress'});assert.equal(f.state.logs[TODAY].h1.why,'stress');assert.equal(f.state.logs['2026-10-30'],undefined);
});

test('撤销破戒会移除被弹窗隐藏的同一浮条并清理原因',t=>{
 t.mock.timers.enable({apis:['setTimeout']});
 for(const why of [undefined,'stress']){
  const f=interactionFixture({[TODAY]:{h1:{slip:1,...(why?{why}:{})}}});f.api.showBar('h1');f.root.UI.sheet('菜单','');assert.equal(f.bar().hidden,true);
  f.slip('h1');f.state.logs[TODAY].h1.slip=0;t.mock.timers.tick(60);f.root.UI.closeSheet();
  assert.equal(f.bar(),null);assert.equal(f.state.logs[TODAY].h1.why,undefined);
 }
});

test('原破戒被同步或其他入口撤销后，关闭弹窗不会恢复失效浮条',()=>{
 const f=interactionFixture();f.api.showBar('h1');f.root.UI.sheet('菜单','');delete f.state.logs[TODAY].h1;f.root.UI.closeSheet();assert.equal(f.bar(),null);
});

test('另一习惯或日期的原因弹窗保存和清除不会移除原浮条',()=>{
 for(const action of ['pick','clear'])for(const sheetId of ['h1','h2']){
  const f=interactionFixture({[TODAY]:{h1:{slip:1}},'2026-10-30':{[sheetId]:{slip:1,why:'late'}}});
  f.api.showBar('h1',TODAY);const bar=f.bar();f.api.openSheet(sheetId,'2026-10-30');f.reason(action,false,{k:'stress'});
  assert.equal(f.bar(),bar);assert.equal(bar.hidden,false);assert.equal(f.state.logs[TODAY].h1.why,undefined);
 }
});

test('撤销另一习惯或日期的破戒保留原浮条',t=>{
 t.mock.timers.enable({apis:['setTimeout']});
 for(const other of [{id:'h2',date:TODAY},{id:'h1',date:'2026-10-30'}]){
  const f=interactionFixture({[TODAY]:{h1:{slip:1},h2:{slip:1}},'2026-10-30':{h1:{slip:1}}});f.api.showBar('h1',TODAY);const bar=f.bar();
  f.setDate(other.date);f.slip(other.id);f.state.logs[other.date][other.id].slip=0;t.mock.timers.tick(60);
  assert.equal(f.bar(),bar);f.reason('pick',true,{k:'stress'});assert.equal(f.state.logs[TODAY].h1.why,'stress');
 }
});

test('午夜前打开的习惯菜单保留补记原因入口的日期',()=>{
 const f=interactionFixture({[TODAY]:{h1:{slip:1}}});let menu='';const get=f.root.document.getElementById;
 f.root.document.getElementById=id=>id==='sheetBody'?{insertAdjacentHTML(position,html){menu+=html}}:get(id);
 f.root.UI.openHabitMenu('h1');const date=/data-date="([^"]+)"/.exec(menu);assert.ok(date,'菜单入口应带上展示当天');
 f.setDate('2026-10-30');f.reason('open',false,{id:'h1',date:date[1]});f.reason('pick',false,{k:'stress'});assert.equal(f.state.logs[TODAY].h1.why,'stress');
});
