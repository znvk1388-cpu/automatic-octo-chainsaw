/* Apply after patch-grow-history.cjs. Keeps the lazy insight module's private
 * goal/risk/verdict calculations consistent with calendar-week quotas.
 */
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const file=path.join(__dirname,'../src/chunk-grow.js');
function patchSource(source){
function replaceBlock(startMarker,endMarker,replacement,installedMarker){
  if(source.includes(installedMarker))return;
  const start=source.indexOf(startMarker),end=source.indexOf(endMarker,start);
  if(start<0||end<0)throw new Error('Missing insight helper: '+startMarker);
  source=source.slice(0,start)+replacement+source.slice(end);
}
replaceBlock('function a(t,n){','function i(',
  `function a(t,n){if(Engine.isWeekly(t)&&Engine.insightPeriodRate&&n.length){var weeklyDates=n.slice().sort();if(U.daysBetween(weeklyDates[0],weeklyDates[weeklyDates.length-1])+1!==weeklyDates.length)return{due:0,ok:0,rate:0};var weeklyRate=Engine.insightPeriodRate(weeklyDates[0],weeklyDates[weeklyDates.length-1],[t]);return{due:weeklyRate.total,ok:weeklyRate.done,rate:weeklyRate.total?weeklyRate.done/weeklyRate.total:0}}var e=0,a=0;return n.forEach(function(n){Engine.isDue(t,n)&&(a++,r(t,n)&&e++)}),{due:a,ok:e,rate:a?e/a:0}}`,
  'var weeklyDates=n.slice().sort()');
replaceBlock('function v(t){','function g(){',
  `function v(t){if(Engine.insightPeriodRate&&t.length){var weeklyVerdictDates=t.slice().sort(),weeklyVerdict=Engine.insightPeriodRate(weeklyVerdictDates[0],weeklyVerdictDates[weeklyVerdictDates.length-1],e());return{due:weeklyVerdict.total,ok:weeklyVerdict.done,pctv:weeklyVerdict.pct}}var n=e(),a=0,i=0;return t.forEach(function(t){n.forEach(function(n){Engine.isDue(n,t)&&(Engine.isSkipped(t,n.id)||(a++,r(n,t)&&i++))})}),{due:a,ok:i,pctv:a?Math.round(i/a*100):0}}`,
  'var weeklyVerdictDates=t.slice().sort()');
replaceBlock('var M=function(){','M&&t.push(M);',
  `var M=function(){var t=e();if(!t.length)return null;var weeklyGoalRates=[],weeklyGoalDue=0,weeklyGoalDone=0;for(var weeklyGoalIndex=1;weeklyGoalIndex<=2;weeklyGoalIndex++){var weeklyGoalFrom=U.shiftYmd(U.weekStartOf(U.today()),-7*weeklyGoalIndex),weeklyGoalTo=U.shiftYmd(weeklyGoalFrom,6),weeklyGoal=Engine.periodRate?Engine.periodRate(weeklyGoalFrom,weeklyGoalTo,t):null;if(!weeklyGoal||weeklyGoal.total<3)return null;weeklyGoalRates.push(weeklyGoal.pct),weeklyGoalDue+=weeklyGoal.total,weeklyGoalDone+=weeklyGoal.done}if(weeklyGoalRates[0]>=60||weeklyGoalRates[1]>=60)return null;var h=null;t.forEach(function(t){var n=Engine.itemPeriodRate?Engine.itemPeriodRate(t,U.shiftYmd(U.weekStartOf(U.today()),-14),U.shiftYmd(U.weekStartOf(U.today()),-1)).pct:Engine.itemRate(t.id,14);null!=n&&(!h||n<h.rate)&&(h={it:t,rate:n})});return{kind:"goal",icon:"target",tone:"info",title:"前两周的目标有些吃力，可以调轻一点",body:"前两个完整周的目标达成率是 "+Math.round(100*weeklyGoalDone/weeklyGoalDue)+"%。可以给「"+(h?h.it.name:"最难的那项")+"」设一个更容易开始的版本，再按自己的节奏调整。"}}();`,
  'var weeklyGoalRates=[]');
source=source.replace('if(!(n<3))for(var e=0;e<c.length;e++)','if(!Engine.isWeekly(t)&&!(n<3))for(var e=0;e<c.length;e++)');
source=source.replace('return"近 14 天完成率 "+t.cur','return"近期目标达成率 "+t.cur');
new vm.Script(source);
return source;
}
module.exports={patchSource};
if(require.main===module)fs.writeFileSync(file,patchSource(fs.readFileSync(file,'utf8')));
