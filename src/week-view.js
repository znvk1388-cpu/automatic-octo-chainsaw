/* A calendar-week overview that shares the app's existing record rules. */
(function (factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory;
  else factory(window).install();
})(function (root) {
  'use strict';
  const labels = {
    done: '完成', mini: '轻量', partial: '部分', skip: '请假', slip: '破戒',
    protected: '保护', rest: '休息', flexible: '未记', today: '待做',
    miss: '漏记', future: '未到', unscheduled: '未排',
  };

  function stateFor(item, day, today, freezes) {
    if (day > today) return 'future';
    const engine = root.Engine;
    if (!engine.isAlive(item, day)) return 'unscheduled';
    if (engine.isSkipped(day, item.id)) return 'skip';
    const plan = engine.itemAtDate(item, day);
    if (plan.type === 'avoid' && engine.slipped(item, day)) return 'slip';
    if (engine.isDone(item, day)) return engine.getLog(day, item.id)?.mini ? 'mini' : 'done';
    if (engine.progress(item, day) > 0) return 'partial';
    if (!engine.isDue(item, day)) return 'unscheduled';
    if (freezes[day]) return 'protected';
    if (engine.isRestDay(item, day)) return 'rest';
    if (plan.schedule?.type === 'timesPerWeek') return 'flexible';
    return day === today ? 'today' : 'miss';
  }

  function build() {
    const {U, Engine, Store} = root;
    const today = U.today();
    const start = U.weekStartOf(today);
    const days = Array.from({length:7}, (_, index) => U.shiftYmd(start, index));
    const freezes = Store.s.freezes || {};
    const elapsedDays = days.filter(day => day <= today).reverse();
    const rows = Engine.sorted().map(item => {
      const weeklyDay = elapsedDays.find(day =>
        Engine.itemAtDate(item, day).schedule?.type === 'timesPerWeek');
      return {
        name: item.name,
        goal: weeklyDay ? Engine.weekProgress(item, weeklyDay) : null,
        historicalGoal: Boolean(weeklyDay && weeklyDay !== today),
        states: days.map(day => stateFor(item, day, today, freezes)),
      };
    });
    return {today, days, rows};
  }

  function render(week = build()) {
    const {U} = root;
    const shortDate = day => {
      const date = U.parseYmd(day);
      return (date.getMonth() + 1) + '/' + date.getDate();
    };
    const dates = week.days.map(day => {
      const content = '<span>' + (day === week.today ? '今天' : U.WEEK[U.weekdayOf(day)]) +
        '</span><b>' + shortDate(day) + '</b>';
      if (day > week.today) return '<span class="rg-week-day future">' + content + '</span>';
      return '<button type="button" class="rg-week-day' + (day === week.today ? ' current' : '') +
        '" data-product="history" data-date="' + day + '" aria-label="' +
        U.esc('查看' + U.prettyDate(day) + '的记录') + '">' + content + '</button>';
    }).join('');

    const rows = week.rows.map(row => {
      const goal = row.goal && row.goal.target
        ? '<span class="rg-week-goal">' + (row.historicalGoal ? '周频 ' : '本周 ') + row.goal.done + '/' + row.goal.target + ' 次</span>' : '';
      const states = row.states.map((state, index) =>
        '<span class="rg-week-state ' + state + '"><span aria-hidden="true">' + labels[state] +
        '</span><span class="rg-week-sr">' + U.esc(U.prettyDate(week.days[index]) + ' ' + labels[state]) +
        '</span></span>').join('');
      return '<section class="rg-week-habit"><div class="rg-week-habit-head"><h4>' + U.esc(row.name) +
        '</h4>' + goal + '</div><div class="rg-week-columns">' + states + '</div></section>';
    }).join('');

    return '<div class="rg-week-view"><p class="rg-week-hint">' + shortDate(week.days[0]) + ' 至 ' +
      shortDate(week.days[6]) + ' · 点击日期查看或补录</p><div class="rg-week-columns">' +
      dates + '</div>' + (rows || '<p class="rg-week-empty">还没有习惯。添加一个习惯后，这里会显示本周记录。</p>') +
      '</div>';
  }

  function install() {
    root.document.addEventListener('click', event => {
      if (!event.target.closest('[data-week-records]')) return;
      root.UI.sheet('本周记录', render());
    });
  }

  return {build, render, install};
});
