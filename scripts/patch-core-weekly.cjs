/* Run after patch-core-history.cjs. Reapply safely on the v63 bundle.
 * Private missed-day and reminder helpers must use the same weekly policy as
 * the public API; wrapping exported methods alone cannot change their callers.
 */
const fs = require('node:fs');
const path = require('node:path');
const file = path.join(__dirname,'../src/app.bundle.js');
let source = fs.readFileSync(file,'utf8');
const startMarker = `l+='<span class="tr-rate" title="近 30 天里，`;
const endMarker = `,l+='<span class="dots"`;
const start = source.indexOf(startMarker);
if (start < 0) {
  if (!source.includes('Engine.rateTooltip(t,30)')) throw new Error('Cannot find the v62 habit-rate tooltip');
} else {
  const end = source.indexOf(endMarker,start);
  if (end < 0) throw new Error('Cannot find the end of the habit-rate tooltip');
  const replacement = `l+='<span class="tr-rate" title="'+e(Engine.rateTooltip?Engine.rateTooltip(t,30):"近 30 天完成记录")+'">'+Engine.rateLabel(t.id,30).text+"</span>"`;
  source = source.slice(0,start)+replacement+source.slice(end);
}
function editSection(fromMarker, toMarker, update) {
  const from = source.indexOf(fromMarker), to = source.indexOf(toMarker,from);
  if (from < 0 || to < 0) throw new Error('Cannot find module '+fromMarker);
  source=source.slice(0,from)+update(source.slice(from,to))+source.slice(to);
}
function replaceOnce(text, before, after) {
  if (text.includes(after)) return text;
  const at=text.indexOf(before);
  if (at<0 || text.indexOf(before,at+1)>=0) throw new Error('Unexpected core source: '+before.slice(0,90));
  return text.slice(0,at)+after+text.slice(at+before.length);
}
editSection('window.Extra=','window.Lock=',text=>{
  const dailyStart=text.indexOf('function a(){'), dailyEnd=text.indexOf('function s(',dailyStart);
  const daily=`function a(){return w(U.shiftYmd(e(),-1)).length>0}`;
  if (!text.includes(daily)) {
    if(dailyStart<0||dailyEnd<0)throw new Error('Missing private yesterday-missed helper');
    text=text.slice(0,dailyStart)+daily+text.slice(dailyEnd);
  }
  const missedStart=text.indexOf('function w(t){'), missedEnd=text.indexOf('return{skip:',missedStart);
  const missed=`function w(t){return(Engine.itemsForDate?Engine.itemsForDate(t):Engine.items()).filter(e=>Engine.isDailyMiss?Engine.isDailyMiss(e,t):!Engine.isWeekly(e)&&Engine.isDue(e,t)&&!Engine.isDone(e,t)&&!n(t,e.id)&&!Engine.isRestDay(e,t)&&!Engine.isPartial(e,t))}`;
  if (!text.includes(missed)) {
    if(missedStart<0||missedEnd<0)throw new Error('Missing private missed-date helper');
    text=text.slice(0,missedStart)+missed+text.slice(missedEnd);
  }
  return text;
});
editSection('window.Remind=','window.ICS=',text=>{
  text=replaceOnce(text,`return Engine.isDue(t,n)&&!Engine.isDone(t,n)&&!Engine.isSkipped(n,t.id)`,
    `return Engine.needsDailyNudge?Engine.needsDailyNudge(t,n):!Engine.isWeekly(t)&&Engine.isDue(t,n)&&!Engine.isDone(t,n)&&!Engine.isSkipped(n,t.id)`);
  text=replaceOnce(text,`function x(t){try{return w(t).level>=1?0:s.length}`,
    `function x(t){if(Engine.isWeekly(t))return 0;try{return w(t).level>=1?0:s.length}`);
  text=replaceOnce(text,`if(e.reminderAt&&!k(e)&&!Engine.isDone(e,h)){`,
    `if(e.reminderAt&&!k(e)&&(Engine.needsHabitReminder?Engine.needsHabitReminder(e,h):Engine.isDue(e,h)&&!Engine.isDone(e,h))){`);
  text=replaceOnce(text,`return!!t.reminderAt&&!k(t)&&!!Engine.isDue(t,e)&&!Engine.isDone(t,e)&&!Engine.isSkipped(e,t.id)&&n>=g(t.reminderAt)`,
    `return!!t.reminderAt&&!k(t)&&(Engine.needsHabitReminder?Engine.needsHabitReminder(t,e):Engine.isDue(t,e)&&!Engine.isDone(t,e)&&!Engine.isSkipped(e,t.id))&&n>=g(t.reminderAt)`);
  text=replaceOnce(text,`if(Engine.isDone(t,U.today()))return;`,
    `if(Engine.needsHabitReminder?!Engine.needsHabitReminder(t,U.today()):Engine.isDone(t,U.today()))return;`);
  text=replaceOnce(text,`var j=Engine.todayRate(h);if(j.total>0&&j.done<j.total){`,
    `var j=Engine.todayRate(h),weeklyDailyPending=Engine.items().filter(t=>Engine.needsDailyNudge?Engine.needsDailyNudge(t,h):!Engine.isWeekly(t)&&Engine.isDue(t,h)&&!Engine.isDone(t,h));if(weeklyDailyPending.length){`);
  text=replaceOnce(text,`var O=Engine.items().filter(function(t){return Engine.isDue(t,h)&&!Engine.isDone(t,h)}).map(function(t){return t.name})`,
    `var O=weeklyDailyPending.map(function(t){return t.name})`);
  text=text.split('(j.total-j.done)').join('weeklyDailyPending.length');
  return text;
});
fs.writeFileSync(file,source);
