/* Calendar-week goal metrics. Load after history-engine.js and app.bundle.js.
 * Daily completion counts elapsed dates. A weekly goal is a plan for the whole
 * calendar week (settings.weekStart), capped by the eligible dates in its plan.
 * An unfinished current week does not break the previous weekly streak.
 */
(function (root) {
  'use strict';

  function install() {
    var E = root.Engine, U = root.U, S = root.Store;
    if (!E || !U || !S || E.__weeklyMetricsV63) return;
    E.__weeklyMetricsV63 = true;
    var original = {};
    ['weekProgress', 'streakOf', 'bestStreak', 'itemRate', 'dueDaysOf', 'rateLabel', 'yearly'].forEach(function (name) {
      original[name] = E[name];
    });

    function resolve(item, date) {
      return root.HistoryModel && root.HistoryModel.resolve ? root.HistoryModel.resolve(item, date) : item;
    }
    function weekly(item, date) {
      var at = resolve(item, date || U.today());
      return !!at && (at.schedule || {}).type === 'timesPerWeek';
    }
    function items() { return ((S.s || {}).items || []).filter(function (item) { return item && !item.deleted; }); }
    function find(id) { return items().find(function (item) { return item.id === id; }); }
    function min(a, b) { return a < b ? a : b; }
    function max(a, b) { return a > b ? a : b; }
    function dates(from, to, visit) {
      for (var day = from, guard = 0; day <= to && guard < 5000; guard++, day = U.shiftYmd(day, 1)) visit(day);
    }
    function percent(done, total) { return total ? Math.round(100 * done / total) : 0; }
    function eligible(item, date) {
      if (!E.isDue(item, date) || E.isSkipped(date, item.id)) return false;
      if ((S.s.freezes || {})[date]) return false;
      return !(E.isRestDay && E.isRestDay(item, date));
    }

    /* Counts a single weekly quota. planEnd includes remaining days in an open
     * week, so a Monday goal of 3 remains 3 rather than becoming a daily goal.
     * The actual done count is always limited to the requested elapsed dates.
     */
    function weeklyPeriod(item, weekStart, from, through, planEnd) {
      var count = 0, available = 0, elapsed = 0, quota = 0;
      dates(max(weekStart, from), planEnd, function (day) {
        var at = resolve(item, day);
        if (!weekly(item, day) || !eligible(item, day)) return;
        available++;
        quota = Math.max(quota, Math.max(1, Math.min(7, Number((at.schedule || {}).n) || 1)));
        if (day <= through) {
          elapsed++;
          if (E.isDone(item, day)) count++;
        }
      });
      var target = Math.min(quota, available);
      return {from: weekStart, to: U.shiftYmd(weekStart, 6), done: count, target: target,
        alive: elapsed, eligible: available, ok: target > 0 && count >= target,
        left: Math.max(0, target - count), pct: percent(Math.min(count, target), target), unit: '次'};
    }

    function itemRange(item, from, through) {
      through = min(through, U.today());
      var done = 0, total = 0, actual = 0, periods = 0, elapsedDays = 0, buckets = {};
      if (!item || through < from) return {done: 0, total: 0, actualDone: 0, pct: 0, periods: 0, days: 0};
      dates(from, through, function (day) {
        if (weekly(item, day)) { buckets[U.weekStartOf(day)] = true; return; }
        if (!eligible(item, day)) return;
        total++; elapsedDays++;
        if (E.isDone(item, day)) { done++; actual++; }
      });
      Object.keys(buckets).sort().forEach(function (start) {
        var end = U.shiftYmd(start, 6);
        var planEnd = end > through && U.weekStartOf(through) === start ? end : min(end, through);
        var part = weeklyPeriod(item, start, from, min(end, through), planEnd);
        if (part.target) periods++;
        done += Math.min(part.done, part.target); total += part.target;
        actual += part.done; elapsedDays += part.alive;
      });
      return {done: done, total: total, actualDone: actual, pct: percent(done, total), periods: periods, days: elapsedDays};
    }

    function periodRate(from, through, selected) {
      var summary = {from: from, to: min(through, U.today()), done: 0, total: 0, actualDone: 0, pct: 0};
      (selected || items()).forEach(function (item) {
        var rate = itemRange(item, from, through);
        summary.done += rate.done; summary.total += rate.total; summary.actualDone += rate.actualDone;
      });
      summary.pct = percent(summary.done, summary.total);
      return summary;
    }
    E.periodRate = periodRate;
    E.itemPeriodRate = itemRange;
    // Insight windows compare complete calendar-week plans for weekly habits;
    // cutting a flexible week into arbitrary weekdays would invent failures.
    E.insightPeriodRate = function (from, through, selected) {
      var summary = {done: 0, total: 0, actualDone: 0, pct: 0};
      var span = Math.max(1, U.daysBetween(from, through) + 1);
      (selected || items()).forEach(function (item) {
        var start = weekly(item, through) ? U.shiftYmd(U.weekStartOf(through), -7 * (Math.ceil(span / 7) - 1)) : from;
        var rate = itemRange(item, start, through);
        summary.done += rate.done; summary.total += rate.total; summary.actualDone += rate.actualDone;
      });
      summary.pct = percent(summary.done, summary.total);
      return summary;
    };

    E.weekProgress = function (item, date) {
      date = min(date || U.today(), U.today());
      if (!weekly(item, date)) return null;
      var from = U.weekStartOf(date);
      return weeklyPeriod(item, from, from, date, U.shiftYmd(from, 6));
    };

    function periodStarts(item, through) {
      var born = E.bornOn(item) || through;
      var first = U.weekStartOf(born), last = U.weekStartOf(through), result = [];
      for (var start = last, guard = 0; start >= first && guard < 520; guard++, start = U.shiftYmd(start, -7)) result.push(start);
      return result;
    }
    function weeklyStreak(item, through, best) {
      var run = 0, highest = 0;
      var starts = periodStarts(item, through);
      if (best) starts.reverse();
      for (var index = 0; index < starts.length; index++) {
        var start = starts[index], end = U.shiftYmd(start, 6);
        var period = weeklyPeriod(item, start, start, min(end, through), end);
        if (!period.target) continue;
        if (period.ok) { run++; highest = Math.max(highest, run); }
        else if (end > through) { /* This calendar week has not ended yet. */ }
        else if (best) run = 0;
        else break;
      }
      return best ? highest : run;
    }
    E.streakOf = function (id, date) {
      var item = find(id), through = min(date || U.today(), U.today());
      if (!item || !weekly(item, through)) return original.streakOf.apply(E, arguments);
      return E.memo('weekly63:streak:' + id + ':' + through + ':' + U.weekStart(), function () { return weeklyStreak(item, through, false); });
    };
    E.bestStreak = function (id) {
      var item = find(id), today = U.today();
      if (!item || !weekly(item, today)) return original.bestStreak.apply(E, arguments);
      return E.memo('weekly63:best:' + id + ':' + today + ':' + U.weekStart(), function () { return weeklyStreak(item, today, true); });
    };

    function weeklyLookback(item, days) {
      var weeks = Math.max(1, Math.ceil((Number(days) || 7) / 7));
      var start = U.shiftYmd(U.weekStartOf(U.today()), -(weeks - 1) * 7);
      var rate = itemRange(item, start, U.today());
      rate.weeks = weeks; rate.from = start; rate.to = U.today();
      return rate;
    }
    E.itemRate = function (id, days) {
      var item = find(id);
      return item && weekly(item) ? weeklyLookback(item, days).pct : original.itemRate.apply(E, arguments);
    };
    E.dueDaysOf = function (id, days) {
      var item = find(id);
      return item && weekly(item) ? weeklyLookback(item, days).total : original.dueDaysOf.apply(E, arguments);
    };
    E.rateLabel = function (id, days) {
      var item = find(id);
      if (!item || !weekly(item)) return original.rateLabel.apply(E, arguments);
      var rate = weeklyLookback(item, days);
      return {enough: rate.total > 0, days: rate.total, periods: rate.periods, pct: rate.pct, unit: '次',
        text: (rate.weeks === 1 ? '本周' : '近 ' + rate.weeks + ' 周') + '目标达成率 ' + rate.pct + '%'};
    };
    E.rateTooltip = function (item, days) {
      if (weekly(item)) {
        var metric = weeklyLookback(item, days);
        return E.rateLabel(item.id, days).text + '；已完成 ' + metric.done + '/' + metric.total + ' 次，按设置的周起始日统计';
      }
      return '近 ' + days + ' 天里，该做且没请假的日子里完成了 ' + original.itemRate.call(E, item.id, days) + '%';
    };
    E.isDailyMiss = function (item, date) {
      return date < U.today() && !weekly(item, date) && eligible(item, date) && !E.isDone(item, date) && !(E.isPartial && E.isPartial(item, date));
    };
    E.needsDailyNudge = function (item, date) {
      return !weekly(item, date) && eligible(item, date) && !E.isDone(item, date);
    };
    E.needsHabitReminder = function (item, date) {
      if (!eligible(item, date) || E.isDone(item, date)) return false;
      return !weekly(item, date) || !E.weekProgress(item, date).ok;
    };
    E.weeklyTrend = function (count) {
      var today = U.today(), current = U.weekStartOf(today), result = [];
      for (var index = Math.max(1, Number(count) || 1) - 1; index >= 0; index--) {
        var start = U.shiftYmd(current, -7 * index), end = min(U.shiftYmd(start, 6), today);
        var rate = periodRate(start, end);
        result.push({label: (U.parseYmd(start).getMonth() + 1) + '/' + U.parseYmd(start).getDate(),
          pct: rate.pct, done: rate.done, total: rate.total, from: start, to: end});
      }
      return result;
    };

    E.yearly = function (year) {
      var value = original.yearly.apply(E, arguments), from = (year || new Date().getFullYear()) + '-01-01';
      var to = min(from.slice(0, 4) + '-12-31', U.today()), rate = periodRate(from, to);
      value = Object.assign({}, value, {rate: rate.pct, totalDone: rate.done, totalDue: rate.total});
      value.top = items().map(function (item) {
        var result = itemRange(item, from, to);
        return {name: item.name, color: item.color, rate: result.pct, total: result.total};
      }).filter(function (item) { return item.total; }).sort(function (a, b) { return b.rate - a.rate; }).slice(0, 5);
      return value;
    };

    var X = root.Extra;
    if (X) {
      var oldRateOf = X.rateOf, oldMonth = X.monthReport, oldDots = X.weekDots, oldDetail = X.habitDetail;
      X.rateOf = function (item, days) {
        return weekly(item) ? weeklyLookback(item, days) : oldRateOf.apply(X, arguments);
      };
      X.weekDots = function (id) {
        var result = oldDots.apply(X, arguments), item = find(id);
        if (!item || !weekly(item)) return result;
        return result.map(function (day) {
          if (day.state !== 'miss') return day;
          // A flexible weekly plan has no obligation on a particular weekday.
          return Object.assign({}, day, {state: 'rest'});
        });
      };
      X.habitDetail = function (id) {
        var detail = oldDetail.apply(X, arguments), item = find(id);
        if (!detail || !item || !weekly(item)) return detail;
        var all = itemRange(item, E.bornOn(item) || U.today(), U.today());
        return Object.assign({}, detail, {rate30: weeklyLookback(item, 30), rateAll: all, dueCount: all.total});
      };
      function review(kind, end, label, previousLabel) {
        end = min(end || U.today(), U.today());
        var from = kind === 'week' ? U.weekStartOf(end) : U.shiftYmd(end, -29);
        var span = U.daysBetween(from, end) + 1;
        var previousFrom = kind === 'week' ? U.shiftYmd(from, -7) : U.shiftYmd(from, -30);
        var previousTo = U.shiftYmd(previousFrom, span - 1);
        var rate = periodRate(from, end), previous = periodRate(previousFrom, previousTo);
        label = label || (kind === 'week' ? '本周' : '近 30 天');
        previousLabel = previousLabel || (kind === 'week' ? '上周同期' : '前 30 天');
        var list = items().map(function (item) {
          var metric = itemRange(item, from, end);
          return {name: item.name, pct: metric.pct, done: metric.done, total: metric.total, score: X.scoreOf ? X.scoreOf(item.id) : 0};
        }).filter(function (item) { return item.total; }).sort(function (a, b) { return b.pct - a.pct; });
        var bullets = [label + '完成目标 ' + rate.done + ' / ' + rate.total + ' 次，达成率 ' + rate.pct + '%'];
        if (previous.total) bullets.push('比' + previousLabel + (rate.pct >= previous.pct ? '提升 ' : '下降 ') + Math.abs(rate.pct - previous.pct) + ' 个百分点');
        if (list.length) bullets.push('最稳的是「' + list[0].name + '」' + list[0].pct + '%');
        bullets.push('全站连续 ' + E.globalStreak() + ' 天');
        var mini = {mini: 0, full: 0, miniDays: 0, days: span};
        dates(from, end, function (day) {
          var hasMini = false;
          items().forEach(function (item) {
            if (!eligible(item, day) || !E.isDone(item, day)) return;
            if (E.isMiniDone(item, day)) { mini.mini++; hasMini = true; } else mini.full++;
          });
          if (hasMini) mini.miniDays++;
        });
        if (mini.mini) bullets.push('其中 ' + mini.mini + ' 次是轻量完成');
        return {kind: kind, label: label, from: from, to: end, pct: rate.pct, prevPct: previous.pct,
          done: rate.done, total: rate.total, actualDone: rate.actualDone, items: list, bullets: bullets, mini: mini, text: bullets.join('\n')};
      }
      X.review = function (kind) { return review(kind); };
      X.lastWeekReport = function () { return review('week', U.shiftYmd(U.weekStartOf(U.today()), -1), '上周', '上上周'); };
      X.weekCard = function () {
        var report = review('week'), list = report.items;
        return {range: U.prettyDate(report.from) + ' – ' + U.prettyDate(report.to), pct: report.pct,
          prevPct: report.prevPct, done: report.done, total: report.total, best: list[0] || null,
          worst: list.length ? list[list.length - 1] : null, top3: list.slice(0, 3),
          streak: X.streakDelta ? X.streakDelta() : {now: E.globalStreak(), delta: 0},
          checkins: report.actualDone, bullets: report.bullets};
      };
      if (oldMonth) X.monthReport = function (ym) {
        var value = oldMonth.apply(X, arguments), from = (ym || U.today().slice(0, 7)) + '-01';
        var date = U.parseYmd(from), end = U.ymd(new Date(date.getFullYear(), date.getMonth() + 1, 0));
        var rate = periodRate(from, min(end, U.today()));
        var list = items().map(function (item) {
          var metric = itemRange(item, from, min(end, U.today()));
          return {name: item.name, color: item.color, done: metric.done, total: metric.total, pct: metric.pct};
        }).filter(function (item) { return item.total; }).sort(function (a, b) { return b.pct - a.pct || b.done - a.done; });
        var previousDate = new Date(date.getFullYear(), date.getMonth() - 1, 1), previousFrom = U.ymd(previousDate);
        var elapsed = Math.max(0, U.daysBetween(from, min(end, U.today())));
        var previousEnd = min(U.shiftYmd(previousFrom, elapsed), U.ymd(new Date(date.getFullYear(), date.getMonth(), 0)));
        var previous = periodRate(previousFrom, previousEnd);
        return Object.assign({}, value, {pct: rate.pct, done: rate.done, total: rate.total,
          prevPct: previous.pct, hasPrev: previous.total > 0, best: list[0] || null,
          worst: list.length > 1 ? list[list.length - 1] : null, list: list, items: list.slice(0, 3)});
      };
    }

    var P = root.Product;
    if (P && P.todayHeader) {
      var oldTodayHeader = P.todayHeader;
      P.todayHeader = function () {
        return oldTodayHeader.apply(P, arguments)
          .replace('aria-label="今日完成率"', 'aria-label="今日打卡率，周目标进度请看回顾"')
          .replace('<div class="p-progress-line">', '<div class="p-progress-line" title="今日打卡率只统计今天的记录；周目标达成率请看回顾">');
      };
    }
    if (P) P.insights = function () {
      var today = U.today(), from = U.weekStartOf(today), span = U.daysBetween(from, today) + 1;
      var current = periodRate(from, today), previousFrom = U.shiftYmd(from, -7);
      var previous = periodRate(previousFrom, U.shiftYmd(previousFrom, span - 1));
      var delta = current.pct - previous.pct, active = 0, rows = [];
      dates(from, today, function (day) {
        if (items().some(function (item) { return eligible(item, day) && E.isDone(item, day); })) active++;
      });
      dates(U.shiftYmd(today, -6), today, function (day) {
        var value = E.todayRate(day);
        rows.push({date: day, pct: value.pct, done: value.done, total: value.total});
      });
      var comparison = previous.total ? '比上周同期' + (delta > 0 ? '提高 ' + delta : delta < 0 ? '下降 ' + Math.abs(delta) : '持平，变化 0') + ' 个百分点' : '积累记录后，可以查看与上周同期的变化';
      var esc = U.esc, icon = function (name) { return '<svg class="p-icon" aria-hidden="true"><use href="assets/icons.svg#' + name + '"></use></svg>'; };
      return '<div class="p-page-heading"><div><p class="p-eyebrow">看见坚持的力量</p><h1>进度回顾</h1>' +
        '<p class="p-intro">日习惯按已过去的应执行日，周习惯按本周目标计算。下方每日打卡率只表示当天记录，周习惯空着一天不代表失约。</p></div>' +
        '<div class="p-heading-actions"><button class="btn ghost" data-act="printsheet">' + icon('clipboard') + '打印这个月</button>' +
        '<button class="btn ghost" data-act="fixdates">' + icon('calendar-dots') + '查看日历</button></div></div>' +
        '<div class="p-review-summary"><div><span>本周目标达成率</span><b>' + current.pct + '<small>%</small></b><p>' + comparison + '</p></div>' +
        '<div><span>本周实际打卡</span><b>' + current.actualDone + '</b><p>本周目标进度 ' + current.done + ' / ' + current.total + ' 次</p></div>' +
        '<div><span>本周有行动的日子</span><b>' + active + '<small> / ' + span + ' 天</small></b><p>做过，就留下了痕迹</p></div></div>' +
        '<section class="p-chart-card"><div class="p-card-title"><h3>最近 7 天</h3><span>每日打卡率 · 点击查看当天记录</span></div><div class="p-bars">' +
        rows.map(function (row) {
          return '<button class="p-bar-column" data-product="history" data-date="' + row.date + '" aria-label="' + esc(U.prettyDate(row.date)) + '，当天打卡 ' + row.done + '/' + row.total + '，打卡率 ' + row.pct + '%">' +
            '<span>' + row.pct + '%</span><div class="p-bar-track"><i style="height:' + row.pct + '%"></i></div><small>' + U.parseYmd(row.date).getDate() + '日</small></button>';
        }).join('') + '</div></section>';
    };
    E.bustCache();
    if (S.isHydrated && S.isHydrated() && root.UI && root.UI.render) {
      Promise.resolve().then(function () {
        var active = root.document && root.document.activeElement;
        if (!active || !active.matches || !active.matches('input,textarea,[contenteditable="true"]')) root.UI.render();
      });
    }
  }

  if (root.Engine) install();
  else root.addEventListener('rgz:core', install, {once: true});
})(window);
