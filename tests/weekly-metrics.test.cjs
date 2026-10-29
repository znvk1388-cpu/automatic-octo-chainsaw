const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, '../src/app.bundle.js'), 'utf8');
const patch = fs.readFileSync(path.join(__dirname, '../src/weekly-metrics.js'), 'utf8');
const standalone = source => source.replace(/,\s*$/, ';');
const {patchSource:patchGrowWeekly}=require('../scripts/patch-grow-weekly.cjs');
const grow=patchGrowWeekly(fs.readFileSync(path.join(__dirname,'../src/chunk-grow.js'),'utf8'));

function app(when = [2026, 9, 28, 12]) {
  const NativeDate = Date;
  const now = new NativeDate(...when).getTime();
  class FixedDate extends NativeDate {
    constructor(...args) { super(...(args.length ? args : [now])); }
    static now() { return now; }
  }
  const storage=new Map(), notifications=[];
  function Notification(title,options){notifications.push({title,...options});}
  Notification.permission='granted';
  const context = {Date: FixedDate, Store: {rev: 1, s: {},save(){},commit(fn){if(fn)fn(context.Store.s);context.Store.rev++;}}, addEventListener(){},dispatchEvent(){},Event:class{},
    document:{addEventListener(){}},navigator:{},Notification,
    localStorage:{getItem(key){return storage.get(key)||null;},setItem(key,value){storage.set(key,value);}},
    setTimeout(){return 0;},clearTimeout(){},setInterval(){return 0;},clearInterval(){}};
  context.window = context;
  vm.createContext(context);
  vm.runInContext(standalone(source.slice(0, source.indexOf('window.ErrLog='))), context);
  const historyPath = path.join(__dirname, '../src/history-engine.js');
  if (fs.existsSync(historyPath)) vm.runInContext(fs.readFileSync(historyPath, 'utf8'), context);
  vm.runInContext(standalone(source.slice(source.indexOf('window.Engine='), source.indexOf('window.Parse='))), context);
  vm.runInContext(standalone(source.slice(source.indexOf('window.Extra='), source.indexOf('window.Lock='))), context);
  vm.runInContext(standalone(source.slice(source.indexOf('window.Product='), source.indexOf('window.UI='))), context);
  vm.runInContext(standalone(source.slice(source.indexOf('window.Remind='), source.indexOf('window.ICS='))), context);
  vm.runInContext(patch, context);
  context.notifications=notifications;
  context.loadGrow=()=>vm.runInContext(grow,context);
  context.setState = (items, logs, weekStart = 1) => {
    context.Store.s = {items, logs, notes:{}, moods:{}, media:{}, freezes:{}, redemptions:[], settings:{weekStart,seedPts:0,nickname:'test'}};
    context.Store.rev++;
    context.Engine.bustCache();
  };
  return context;
}
function habit(id = 'habit', schedule = {type:'daily'}, born = '2026-10-01') {
  const [year, month, day] = born.split('-').map(Number);
  return {id, name:'阅读', type:'check', schedule, createdAt:new Date(year,month-1,day).getTime()};
}
function logsFor(item, dates) { return Object.fromEntries(dates.map(date => [date,{[item.id]:{d:true,v:1}}])); }
function plain(value) { return JSON.parse(JSON.stringify(value)); }

test('current week daily progress excludes future dates', () => {
  const a = app(), h = habit('daily',{type:'daily'},'2026-10-26');
  a.setState([h],logsFor(h,['2026-10-26','2026-10-27','2026-10-28']));
  assert.equal(a.Engine.weeklyTrend(1)[0].pct,100);
  assert.equal(a.Engine.weeklyTrend(1)[0].total,3);
  assert.equal(a.Engine.weeklyTrend(1)[0].to,'2026-10-28');
});

test('three completions satisfy a three-times calendar-week goal everywhere', () => {
  const a = app(), h = habit('weekly',{type:'timesPerWeek',n:3});
  a.setState([h],logsFor(h,['2026-10-26','2026-10-27','2026-10-28']));
  assert.equal(a.Engine.weekProgress(h).done,3);
  assert.equal(a.Engine.weekProgress(h).target,3);
  assert.equal(a.Engine.weekProgress(h).ok,true);
  assert.equal(a.Engine.itemRate(h.id,7),100);
  assert.equal(a.Engine.dueDaysOf(h.id,7),3);
  assert.equal(a.Engine.rateLabel(h.id,7).text,'本周目标达成率 100%');
  assert.equal(a.Engine.weeklyTrend(1)[0].pct,100);
  assert.equal(a.Extra.review('week').pct,100);
  assert.equal(a.Extra.weekCard().pct,100);
});

test('calendar weeks do not borrow completions from last week', () => {
  const a = app(), h = habit('weekly',{type:'timesPerWeek',n:3});
  a.setState([h],logsFor(h,['2026-10-23','2026-10-25','2026-10-27']));
  assert.equal(a.Engine.weekProgress(h).done,1);
  assert.equal(a.Engine.itemRate(h.id,7),33);
});

test('Sunday week-start setting changes the same calendar period consistently', () => {
  const a = app(), h = habit('weekly',{type:'timesPerWeek',n:3});
  a.setState([h],logsFor(h,['2026-10-25','2026-10-26','2026-10-27']),0);
  assert.equal(a.Engine.weekProgress(h).from,'2026-10-25');
  assert.equal(a.Engine.weekProgress(h).done,3);
  assert.equal(a.Engine.weeklyTrend(1)[0].pct,100);
  assert.equal(a.Extra.review('week').from,'2026-10-25');
});

test('an unfinished open week preserves the previous weekly streak', () => {
  const a = app(), h = habit('weekly',{type:'timesPerWeek',n:3});
  a.setState([h],logsFor(h,['2026-10-19','2026-10-21','2026-10-23','2026-10-26']));
  assert.equal(a.Engine.streakOf(h.id),1);
  assert.equal(a.Engine.bestStreak(h.id),1);
});

test('meeting the current goal extends the streak once per calendar week', () => {
  const a = app(), h = habit('weekly',{type:'timesPerWeek',n:3});
  a.setState([h],logsFor(h,['2026-10-19','2026-10-21','2026-10-23','2026-10-26','2026-10-27','2026-10-28']));
  assert.equal(a.Engine.streakOf(h.id),2);
  assert.equal(a.Engine.bestStreak(h.id),2);
});

test('missing a closed week breaks the weekly streak', () => {
  const h = habit('weekly',{type:'timesPerWeek',n:3});
  // Sunday is still open until midnight. Move the anchor to a closed Sunday by
  // using Monday's context, which should not borrow the previous week's one log.
  const monday = app([2026,9,26,12]);
  monday.setState([h],logsFor(h,['2026-10-12','2026-10-14','2026-10-16','2026-10-20']));
  assert.equal(monday.Engine.streakOf(h.id),0);
  assert.equal(monday.Engine.bestStreak(h.id),1);
});

test('a new Sunday habit has one eligible date rather than an impossible quota', () => {
  const a = app([2026,9,25,12]), h = habit('weekly',{type:'timesPerWeek',n:3},'2026-10-25');
  a.setState([h],logsFor(h,['2026-10-25']));
  assert.equal(a.Engine.weekProgress(h).target,1);
  assert.equal(a.Engine.weekProgress(h).ok,true);
});

test('mixed daily and weekly plans count daily elapsed opportunities and weekly quota', () => {
  const a = app(), d = habit('daily',{type:'daily'},'2026-10-26'), w = habit('weekly',{type:'timesPerWeek',n:3},'2026-10-26');
  const logs = logsFor(d,['2026-10-26','2026-10-27','2026-10-28']);
  for (const day of Object.keys(logs)) logs[day][w.id]={d:true,v:1};
  a.setState([d,w],logs);
  const metric = a.Engine.periodRate('2026-10-26','2026-10-28');
  assert.equal(metric.done,6);
  assert.equal(metric.total,6);
  assert.equal(metric.pct,100);
});

test('extra completions do not push percentage over 100 but check-ins retain their count', () => {
  const a = app(), h = habit('weekly',{type:'timesPerWeek',n:2});
  a.setState([h],logsFor(h,['2026-10-26','2026-10-27','2026-10-28']));
  assert.equal(a.Engine.itemRate(h.id,7),100);
  assert.equal(a.Extra.weekCard().done,2);
  assert.equal(a.Extra.weekCard().checkins,3);
});

test('daily habit rate and streak still use the original daily behavior', () => {
  const a = app(), h = habit('daily',{type:'daily'},'2026-10-26');
  a.setState([h],logsFor(h,['2026-10-26','2026-10-27','2026-10-28']));
  assert.equal(a.Engine.itemRate(h.id,7),100);
  assert.equal(a.Engine.streakOf(h.id),3);
  assert.equal(a.Engine.weekProgress(h),null);
});

test('reports compare the same elapsed weekdays and preserve the report shape', () => {
  const a = app(), h = habit('daily',{type:'daily'},'2026-10-19');
  a.setState([h],logsFor(h,['2026-10-19','2026-10-20','2026-10-21','2026-10-26','2026-10-27','2026-10-28']));
  const report = a.Extra.review('week');
  assert.equal(report.pct,100);
  assert.equal(report.prevPct,100);
  assert.match(report.bullets[1],/上周同期/);
  assert.equal(report.mini.days,3);
  assert.equal(a.Extra.weekCard().range,'10月26日 周一 – 10月28日 周三');
  assert.equal(plain(report.items)[0].done,3);
});

test('weekly reports retain the previous target after a date-effective edit', {skip:!source.includes('HistoryModel.resolve')}, () => {
  const a = app(), h = habit('weekly',{type:'timesPerWeek',n:3});
  a.setState([h],logsFor(h,['2026-10-19','2026-10-21','2026-10-23']));
  const patch = {schedule:{type:'timesPerWeek',n:5}};
  a.HistoryModel.beforeEdit(a.Store.s,h,patch);
  Object.assign(h,patch);
  a.Store.rev++; a.Engine.bustCache();
  assert.equal(a.Engine.itemPeriodRate(h,'2026-10-19','2026-10-25').pct,100);
  assert.equal(a.Engine.itemPeriodRate(h,'2026-10-19','2026-10-25').total,3);
  assert.equal(a.Engine.weekProgress(h).target,5);
});

test('archiving now preserves closed-week completion totals', {skip:!source.includes('HistoryModel.resolve')}, () => {
  const a = app(), h = habit('weekly',{type:'timesPerWeek',n:3});
  a.setState([h],logsFor(h,['2026-10-19','2026-10-21','2026-10-23']));
  const patch = {archived:true};
  a.HistoryModel.beforeEdit(a.Store.s,h,patch);
  Object.assign(h,patch);
  a.Store.rev++; a.Engine.bustCache();
  const rate = a.Engine.periodRate('2026-10-19','2026-10-25');
  assert.equal(rate.pct,100);
  assert.equal(rate.total,3);
});

test('actual Product markup shows calendar weekly quotas rather than daily seven-day counts', () => {
  const a=app(),h=habit('weekly',{type:'timesPerWeek',n:3});
  a.setState([h],logsFor(h,['2026-10-26','2026-10-27','2026-10-28']));
  const html=a.Product.insights();
  assert.match(html,/本周目标达成率<\/span><b>100/);
  assert.match(html,/本周目标进度 3 \/ 3 次/);
  assert.match(html,/每日打卡率/);
  assert.doesNotMatch(html,/个习惯 × 每天|近 7 天完成率/);
});

test('actual Product comparison uses matching elapsed weekdays', () => {
  const a=app(),h=habit('daily',{type:'daily'},'2026-10-19');
  a.setState([h],logsFor(h,['2026-10-19','2026-10-20','2026-10-21','2026-10-26','2026-10-27','2026-10-28']));
  assert.match(a.Product.insights(),/比上周同期持平，变化 0 个百分点/);
});

test('weekly blank days are neutral rather than daily red failures', () => {
  const a=app([2026,9,30,12]),h=habit('weekly',{type:'timesPerWeek',n:3});
  a.setState([h],logsFor(h,['2026-10-26','2026-10-27','2026-10-28']));
  assert.equal(a.Extra.weekDots(h.id).find(day=>day.date==='2026-10-29').state,'rest');
});

test('fulfilled weekly goal does not produce a Friday break warning or spend a repair coupon', {skip:!source.includes('Engine.isDailyMiss?')}, () => {
  const a=app([2026,9,30,12]),h=habit('weekly',{type:'timesPerWeek',n:3});
  a.setState([h],logsFor(h,['2026-10-26','2026-10-27','2026-10-28']));
  a.Store.s.settings.freezeLeft=1;
  a.Store.s.settings.freezeMonth='2026-10';
  assert.equal(a.Extra.missedOn('2026-10-29').length,0);
  assert.equal(a.Extra.breakInfo(),null);
  assert.equal(a.Extra.reconcile().used,false);
  assert.equal(a.Store.s.settings.freezeLeft,1);
});

test('unfinished weekly goal before the weekend is not a daily broken promise', {skip:!source.includes('Engine.isDailyMiss?')}, () => {
  const a=app([2026,9,30,12]),h=habit('weekly',{type:'timesPerWeek',n:3});
  a.setState([h],logsFor(h,['2026-10-26']));
  assert.equal(a.Extra.missedOn('2026-10-29').length,0);
  assert.equal(a.Extra.breakInfo(),null);
  assert.equal(a.Remind.nudgePayload(23*60),null);
});

test('actual reminder list and dispatch stop after this week target is met', {skip:!source.includes('Engine.needsHabitReminder?')}, () => {
  const a=app([2026,9,30,12]),h={...habit('weekly',{type:'timesPerWeek',n:3}),reminderAt:'12:00'};
  a.setState([h],logsFor(h,['2026-10-26','2026-10-27','2026-10-28']));
  Object.assign(a.Store.s.settings,{remindEnabled:true,nudge:{on:true,at:'12:00'},remindNight:{on:true,at:'12:00'},remindDiary:{on:false},remindWeek:{on:false}});
  assert.equal(a.Remind.pendingList().length,0);
  a.Remind.tick();
  assert.equal(a.notifications.length,0);
});

test('unfinished weekly goals retain one positive scheduled reminder without daily failure repeats', {skip:!source.includes('Engine.needsHabitReminder?')}, () => {
  const a=app([2026,9,30,12]),h={...habit('weekly',{type:'timesPerWeek',n:3}),reminderAt:'12:00'};
  a.setState([h],logsFor(h,['2026-10-26']));
  Object.assign(a.Store.s.settings,{remindEnabled:true,nudge:{on:true,at:'12:00'},remindNight:{on:true,at:'12:00'},remindDiary:{on:false},remindWeek:{on:false}});
  assert.equal(a.Remind.pendingList().length,1);
  assert.equal(a.Remind.maxReps(h),0);
  a.Remind.tick();
  assert.equal(a.notifications.length,1);
  assert.equal(a.notifications[0].title,'该打卡了：阅读');
});

function completedWeeklyHistory(a,count=2){
  const habits=Array.from({length:count},(_,index)=>habit('weekly-'+index,{type:'timesPerWeek',n:3},'2026-09-01'));
  const logs={};
  const today=a.U.today(),current=a.U.weekStartOf(today);
  for(let week=0;week<8;week++)for(const offset of [0,1,2]){
    const date=a.U.shiftYmd(current,-7*week+offset);
    if(date>today)continue;
    logs[date]=Object.fromEntries(habits.map(item=>[item.id,{d:true,v:1}]));
  }
  a.setState(habits,logs);
  return habits;
}

test('actual lazy goal insight does not diagnose fulfilled weekly plans as oversized daily goals',()=>{
  const a=app([2026,9,30,12]);
  completedWeeklyHistory(a);
  a.loadGrow();
  assert.equal(a.Insights.sample().ok,true);
  assert.equal(a.Insights.all().some(insight=>insight.kind==='goal'),false);
});

test('actual lazy verdict and risk series use weekly plan quotas',()=>{
  const a=app([2026,9,30,12]),habits=completedWeeklyHistory(a,3);
  a.loadGrow();
  const verdict=a.Insights.verdict();
  assert.equal(verdict.cur,100);
  assert.equal(verdict.prev,100);
  assert.equal(verdict.delta,0);
  assert.match(a.Insights.oneLine(),/近期目标达成率 100%/);
  assert.equal(a.Insights.series(habits[0],a.Insights.lastDays(7)).rate,1);
});

test('weekly insight patch is deterministic and idempotent',()=>{
  assert.equal(patchGrowWeekly(grow),grow);
});


test('review shows per-habit weekly quota, skips, and escaped detail actions',()=>{
  const a=app(), w=habit('weekly',{type:'timesPerWeek',n:3}), d=habit('daily',{type:'daily'},'2026-10-26');
  w.name='<img src=x onerror=bad>';
  a.setState([w,d],{'2026-10-26':{weekly:{d:true,v:1},daily:{s:1}},'2026-10-27':{weekly:{d:true,v:1},daily:{d:true,v:1}}});
  const html=a.Product.insights();
  assert.match(html,/本周逐项进度/);
  assert.match(html,/周目标：2 \/ 3 次/);
  assert.match(html,/请假 1 天/);
  assert.match(html,/data-act="habitdetail"/);
  assert.ok(!html.includes('<img'));
  assert.match(html,/&lt;img/);
});

test('weekly breakdown does not list future-only or deleted habits',()=>{
  const a=app(), future=habit('future',{type:'daily'},'2026-11-01'), removed=habit('removed');
  future.name='未来习惯'; removed.deleted=true; removed.name='删除习惯';
  a.setState([future,removed],{});
  const html=a.Product.insights();
  assert.ok(!html.includes('未来习惯'));
  assert.ok(!html.includes('删除习惯'));
});


test('weekly breakdown preserves extra completions and caps goal progress',()=>{
  const a=app(), h=habit('weekly',{type:'timesPerWeek',n:2});
  a.setState([h],logsFor(h,['2026-10-26','2026-10-27','2026-10-28']));
  const html=a.Product.insights();
  assert.match(html,/周目标：2 \/ 2 次 · 实际完成 3 次/);
  assert.match(html,/本周目标已达成/);
  assert.ok(!html.includes('value="150"'));
});

test('fully skipped daily plans do not claim completion',()=>{
  const a=app(), h=habit('daily',{type:'daily'},'2026-10-26');
  a.setState([h],{'2026-10-26':{daily:{s:1}},'2026-10-27':{daily:{s:1}},'2026-10-28':{daily:{s:1}}});
  const html=a.Product.insights();
  assert.match(html,/本周暂无计入的计划/);
  assert.match(html,/请假 3 天/);
  assert.ok(!html.includes('已过去的计划均已完成'));
});


test('review marks days without a plan as neutral and keeps their history action',()=>{
  const a=app(),h=habit('daily',{type:'daily'},'2026-10-28');
  a.setState([h],logsFor(h,['2026-10-28']));
  const html=a.Product.insights();
  assert.match(html,/data-date="2026-10-27" aria-label="[^"]*无计划/);
  assert.match(html,/<span>—<\/span>/);
  assert.match(html,/当天打卡 1\/1/);
});

test('weekly detail keeps the user fold choice through a rerender',()=>{
  const a=app(),h=habit();a.setState([h],logsFor(h,['2026-10-28']));
  a.Product.setFold('weekbreakdown',false);
  let html=a.Product.insights();
  assert.match(html,/<details class="p-chart-card v63-week-breakdown" data-fold="weekbreakdown">/);
  a.Product.setFold('weekbreakdown',true);
  html=a.Product.insights();
  assert.match(html,/data-fold="weekbreakdown" open>/);
});
