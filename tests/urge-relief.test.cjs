const test = require('node:test');
const assert = require('node:assert/strict');
const create = require('../src/urge-relief.js');

const TODAY = '2026-10-29';
function ymdShift(date, n) {
  const [y, m, d] = date.split('-').map(Number);
  const t = new Date(y, m - 1, d + n);
  const p = v => String(v).padStart(2, '0');
  return t.getFullYear() + '-' + p(t.getMonth() + 1) + '-' + p(t.getDate());
}
function fixture(logs) {
  const state = {
    logs: logs || { [TODAY]: { h1: { d: false, v: 0, slip: 0 } } },
    items: [{ id: 'h1', name: '不刷短视频', type: 'avoid', schedule: { type: 'daily' } }]
  };
  const calls = { slip: 0 };
  const root = {
    U: { today: () => TODAY, shiftYmd: ymdShift, esc: v => String(v == null ? '' : v), toast() { } },
    Store: { s: state, commit: fn => fn(state) },
    Engine: { isAvoid: it => it.type === 'avoid', slip() { calls.slip++; } },
    document: { addEventListener() { }, getElementById: () => null, dispatchEvent() { } },
    UI: { sheet() { }, closeSheet() { }, render() { }, openHabitMenu() { } }
  };
  return { api: create(root), root, state, calls };
}

test('呼吸节律：4 秒吸气 / 4 秒屏住 / 4 秒呼气，循环', () => {
  const { api } = fixture();
  assert.equal(api.phaseAt(0).text, '吸气');
  assert.equal(api.phaseAt(3.9).text, '吸气');
  assert.equal(api.phaseAt(4).text, '屏住');
  assert.equal(api.phaseAt(7.9).text, '屏住');
  assert.equal(api.phaseAt(8).text, '呼气');
  assert.equal(api.phaseAt(11.9).text, '呼气');
  assert.equal(api.phaseAt(12).text, '吸气');
  assert.equal(api.phaseAt(-1).text, '呼气', '负数取模不越界');
});

test('90 秒倒数到 0 就停，不出现负数', () => {
  const { api } = fixture();
  assert.equal(api.remaining(0), 90);
  assert.equal(api.remaining(0.4), 90);
  assert.equal(api.remaining(89.5), 1);
  assert.equal(api.remaining(90), 0);
  assert.equal(api.remaining(120), 0);
});

test('「挺过去了」只加计数，不动完成状态和破戒标记', () => {
  const { api, state } = fixture();
  assert.equal(api.addUrge(TODAY, 'h1'), 1);
  assert.equal(api.addUrge(TODAY, 'h1'), 2);
  assert.equal(state.logs[TODAY].h1.urge, 2);
  assert.equal(state.logs[TODAY].h1.d, false);
  assert.equal(state.logs[TODAY].h1.slip, 0);
  assert.equal(api.urgeOf(TODAY, 'h1'), 2);
});

test('30 天汇总挡住冲动的次数', () => {
  const logs = {
    [TODAY]: { h1: { urge: 2 } },
    [ymdShift(TODAY, -2)]: { h1: { urge: 1 }, h2: { urge: 3 } },
    [ymdShift(TODAY, -40)]: { h1: { urge: 9 } }
  };
  const { api } = fixture(logs);
  assert.equal(api.totalUrges(30), 6);
  assert.equal(api.totalUrges(90), 15);
});

test('没有日志时计数从 0 开始，不会写坏结构', () => {
  const { api, state } = fixture({});
  assert.equal(api.urgeOf(TODAY, 'h1'), 0);
  assert.equal(api.addUrge(TODAY, 'h1'), 1);
  assert.equal(state.logs[TODAY].h1.urge, 1);
});

function panelFixture(f) {
 let opened=false,html='',updates=0;const phase={textContent:''},tip={textContent:''};
 const left={set textContent(value){updates++},get textContent(){return ''}};
 const panel={querySelector(){return tip}};
 const sheet={classList:{contains(){return opened}}};
 f.root.document.getElementById=id=>({sheet,rgUrge:panel,rgUrgePhase:phase,rgUrgeLeft:left,rgUrgeArc:{style:{}}})[id]||null;
 f.root.UI.sheet=(title,content)=>{opened=true;html=content};
 f.root.UI.closeSheet=()=>{opened=false};
 f.root.Store.commit=fn=>{if(fn)fn(f.state)};
 let events=0,toasts=[];f.root.document.dispatchEvent=()=>events++;f.root.U.toast=s=>toasts.push(s);
 f.api.install();
 return {hide(){opened=false},get html(){return html},get updates(){return updates},get events(){return events},toasts,phase,tip};
}

test('已有破戒记录时再次选择破戒不会撤销历史或派发新事件', t=>{
 t.mock.timers.enable({apis:['setInterval','Date'],now:Date.now()});
 const f=fixture({[TODAY]:{h1:{slip:1,why:'stress'}}});const panel=panelFixture(f);
 f.api.open('h1');assert.equal(f.api.giveUp(),false);assert.equal(f.calls.slip,0);
 assert.deepEqual(f.state.logs[TODAY].h1,{slip:1,why:'stress'});assert.equal(panel.events,0);
 assert.match(panel.toasts.at(-1),/已.*记录/);
});

test('提示仅统计当前习惯最近30天，保留原汇总接口',t=>{
 t.mock.timers.enable({apis:['setInterval','Date'],now:Date.now()});
 const f=fixture({[TODAY]:{h1:{urge:2},h2:{urge:30}},[ymdShift(TODAY,-29)]:{h1:{urge:1}},[ymdShift(TODAY,-30)]:{h1:{urge:8}}});
 const panel=panelFixture(f);assert.equal(f.api.totalUrges(30),33);assert.equal(f.api.totalUrges(30,'h1'),3);f.api.open('h1');assert.match(panel.html,/最近\s*30\s*天/);assert.match(panel.html,/3\s*次/);assert.doesNotMatch(panel.html,/33\s*次/);
});

test('倒计时结束用中性询问，不保证冲动已经消失',t=>{
 t.mock.timers.enable({apis:['setInterval','Date'],now:Date.now()});
 const f=fixture(),panel=panelFixture(f);f.api.open('h1');t.mock.timers.tick(90000);
 assert.equal(panel.phase.textContent,'时间到了，感觉怎么样？');assert.doesNotMatch(panel.tip.textContent,/这一阵过去了/);
});

test('点关闭按钮或遮罩后隐藏面板不再运行计时和写记录',t=>{
 t.mock.timers.enable({apis:['setInterval','Date'],now:Date.now()});
 const f=fixture(),panel=panelFixture(f);f.api.open('h1');let before=panel.updates;panel.hide();t.mock.timers.tick(1000);
 assert.equal(panel.updates,before);assert.equal(f.api.keep(),0);assert.equal(f.state.logs[TODAY].h1.urge,undefined);
});

test('首次选择破戒只新增一次记录，并显示触发原因入口事件', t=>{
 t.mock.timers.enable({apis:['setInterval','Date'],now:Date.now()});
 const f=fixture(),panel=panelFixture(f);
 f.root.Engine.slip=()=>{f.calls.slip++;f.state.logs[TODAY].h1.slip=1;return true};
 f.api.open('h1');assert.equal(f.api.giveUp(),true);assert.equal(f.calls.slip,1);assert.equal(f.state.logs[TODAY].h1.slip,1);assert.equal(panel.events,1);
});

test('倒计时可由读屏软件识别并读取，装饰图形不被重复朗读',t=>{
 t.mock.timers.enable({apis:['setInterval','Date'],now:Date.now()});
 const f=fixture(),panel=panelFixture(f);f.api.open('h1');
 assert.match(panel.html,/<div class="rg-urge-ring" role="timer" aria-label="剩余时间">/);
 assert.match(panel.html,/<svg[^>]*aria-hidden="true"/);
 assert.doesNotMatch(panel.html,/<div class="rg-urge-ring" aria-hidden="true"/);
});

test('挺过去误触后可撤销一次，保留同日其他日志字段',t=>{
 t.mock.timers.enable({apis:['setInterval','Date'],now:Date.now()});const f=fixture({[TODAY]:{h1:{urge:2,slip:1,why:'stress',note:'后来补充'}}});panelFixture(f);let undo;
 f.root.U.showUndo=(message,label,callback,ms)=>{assert.match(message,/已记录/);assert.equal(label,'撤销');assert.equal(ms,8000);undo=callback};
 f.api.open('h1');assert.equal(f.api.keep(),3);f.state.logs[TODAY].h1.note='更新后的备注';assert.equal(typeof undo,'function');undo();
 assert.deepEqual(f.state.logs[TODAY].h1,{urge:2,slip:1,why:'stress',note:'更新后的备注'});undo();assert.equal(f.state.logs[TODAY].h1.urge,2);
});

test('连续两次记录仅最后一次能撤销，不误改另一习惯',t=>{
 t.mock.timers.enable({apis:['setInterval','Date'],now:Date.now()});const f=fixture({[TODAY]:{h1:{urge:2},h2:{urge:4}}});panelFixture(f);f.state.items.push({id:'h2',name:'少熬夜',type:'avoid'});let callbacks=[];
 f.root.U.showUndo=(message,label,callback)=>callbacks.push(callback);f.api.open('h1');f.api.keep();f.api.open('h2');f.api.keep();callbacks[0]();assert.equal(f.state.logs[TODAY].h1.urge,3);callbacks[1]();assert.equal(f.state.logs[TODAY].h2.urge,4);
});

test('撤销只影响当时日期，记录被后来改动后不误撤',t=>{
 t.mock.timers.enable({apis:['setInterval','Date'],now:Date.now()});const f=fixture({[TODAY]:{h1:{urge:3}}});const panel=panelFixture(f);let undo,current=TODAY;f.root.U.today=()=>current;f.root.U.showUndo=(message,label,fn)=>undo=fn;
 f.api.open('h1');f.api.keep();current=ymdShift(TODAY,1);undo();assert.equal(f.state.logs[TODAY].h1.urge,3);assert.equal(f.state.logs[current],undefined);
 current=TODAY;f.api.open('h1');f.api.keep();f.state.logs[TODAY].h1.urge=7;undo();assert.equal(f.state.logs[TODAY].h1.urge,7);assert.match(panel.toasts.at(-1),/变化|无法撤销/);
});

test('切换本机状态、设备或账号后不会撤销错误数据',t=>{
 t.mock.timers.enable({apis:['setInterval','Date'],now:Date.now()});
 for(const change of ['state','device','owner']){const f=fixture();const panel=panelFixture(f);f.state.deviceId='dev-a';f.state.settings={cloudAccountId:'owner-a'};let undo;f.root.U.showUndo=(message,label,fn)=>undo=fn;
  f.api.open('h1');f.api.keep();if(change==='state')f.root.Store.s=JSON.parse(JSON.stringify(f.state));if(change==='device')f.state.deviceId='dev-b';if(change==='owner')f.state.settings.cloudAccountId='owner-b';undo();assert.equal(f.root.Store.s.logs[TODAY].h1.urge,1,change);assert.match(panel.toasts.at(-1),/变化|无法撤销/);
 }
});

test('旧环境没有撤销接口时仍能记录并显示提示',t=>{
 t.mock.timers.enable({apis:['setInterval','Date'],now:Date.now()});const f=fixture(),panel=panelFixture(f);f.api.open('h1');assert.equal(f.api.keep(),1);assert.equal(f.state.logs[TODAY].h1.urge,1);assert.match(panel.toasts.at(-1),/记下/);
});

test('首次记录后撤销还原没有日志的状态，也保留原本存在的空日志',t=>{
 t.mock.timers.enable({apis:['setInterval','Date'],now:Date.now()});
 for(const initial of [{}, {[TODAY]:{}}, {[TODAY]:{h1:{}}}, {[TODAY]:{h1:{slip:1}}}, {[TODAY]:{h1:{urge:0}}}]){
  const before=JSON.parse(JSON.stringify(initial));const f=fixture(initial);panelFixture(f);let undo;f.root.U.showUndo=(msg,label,fn)=>undo=fn;f.api.open('h1');f.api.keep();undo();assert.deepEqual(f.state.logs,before,JSON.stringify(before));
 }
});

test('首次记录后新增的日志内容在撤销时不会丢失',t=>{
 t.mock.timers.enable({apis:['setInterval','Date'],now:Date.now()});const f=fixture({}),panel=panelFixture(f);let undo;f.root.U.showUndo=(msg,label,fn)=>undo=fn;
 f.api.open('h1');f.api.keep();f.state.logs[TODAY].h1.note='之后写的备注';undo();assert.deepEqual(f.state.logs[TODAY].h1,{note:'之后写的备注'});
});

test('同步替换了同次数日志对象时不撤销远端更新',t=>{
 t.mock.timers.enable({apis:['setInterval','Date'],now:Date.now()});const f=fixture(),panel=panelFixture(f);let undo;f.root.U.showUndo=(msg,label,fn)=>undo=fn;
 f.api.open('h1');f.api.keep();const remote={urge:1,note:'来自另一设备'};f.state.logs[TODAY].h1=remote;undo();assert.equal(f.state.logs[TODAY].h1,remote);assert.equal(remote.urge,1);assert.equal(remote.note,'来自另一设备');assert.match(panel.toasts.at(-1),/变化|无法撤销/);
});

test('缓冲面板标明当前习惯且安全显示名称，打开本身不写记录',t=>{
 t.mock.timers.enable({apis:['setInterval','Date'],now:Date.now()});const f=fixture();const panel=panelFixture(f);
 f.root.U.esc=v=>String(v).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 f.state.items[0].name='<手机>"';const before=JSON.stringify(f.state);f.api.open('h1');
 assert.match(panel.html,/<p class="rg-urge-habit">&lt;手机&gt;&quot;<\/p>/);assert.equal(JSON.stringify(f.state),before);
});

test('首页和菜单缓冲入口立即替换弹层，避免关闭后延迟重新打开',t=>{
 t.mock.timers.enable({apis:['setInterval','Date'],now:Date.now()});const f=fixture();let click,closed=0,html='';
 f.root.document.addEventListener=(name,fn)=>{if(name==='click')click=fn};
 f.root.UI.closeSheet=()=>closed++;f.root.UI.sheet=(title,content)=>html=content;f.api.install();
 click({target:{closest:()=>({dataset:{rgUrge:'open',id:'h1'}})},preventDefault(){}});
 assert.match(html,/id="rgUrge"/);assert.equal(closed,0);
});
