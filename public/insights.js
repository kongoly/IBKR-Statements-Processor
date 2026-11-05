// ============================================================
// insights.js — the Insights page: a menu of questions about the account and the way you invest. Click one to
// open it below the menu; "Back to all insights" closes it. Numbers come from insights() in calc.js; this file
// turns them into tiles, small charts and tables. Loaded after app.js and uses its helpers (money, flexTable,
// listPageHeading, monthTheme, pickedFlexMonths, animatePage, reducedMotion).
// ============================================================
const btnInsightsView = document.getElementById('btn-insights-view');
btnInsightsView.addEventListener('click', showInsights);

// What's on screen, so opening an insight doesn't reload anything
let insightsData = null;   // { months, all, rates, offline }
const remembered = (k, fallback) => { try { return sessionStorage.getItem(k) || fallback; } catch (e) { return fallback; } };
const remember = (k, v) => { try { v ? sessionStorage.setItem(k, v) : sessionStorage.removeItem(k); } catch (e) {} };
let insightOpen = remembered('ibkr_insight', null);

async function showInsights() {
  state.currentView = 'insights';
  setActiveBtn(btnInsightsView);
  showLoading(true);
  try {
    const picked = await pickedFlexMonths();
    if (picked) {
      // Official daily USD/ILS rates (Bank of Israel) from shortly before the oldest month shown up to today
      const from = shiftDay(dayOf(picked.months[picked.months.length - 1].fromDate), -50), to = new Date().toISOString().slice(0, 10);
      const fx = await fetch(`/api/fx/usdils?from=${from}&to=${to}`).then(r => r.json()).catch(() => null);
      const rates = fx && fx.rates && Object.keys(fx.rates).length ? fx.rates : null;
      insightsData = { months: picked.months, all: picked.all, rates, offline: !fx || !!fx.offline };
      tableContainer.innerHTML = renderInsightsPage();
    }
    setStatus('Insights');
  } catch (err) { setStatus('❌ Error: ' + err.message); } finally { showLoading(false); }
}

const $0 = (v, cur) => money(v, cur, 0);
const signed$ = (v, cur) => `<span style="color:${signColor(v)}">${(v > 0 ? '+' : '') + $0(v, cur)}</span>`;
const pct0 = v => (v > 0 ? '+' : '') + v.toFixed(1) + '%';
const colored = (v, text) => `<span style="color:${signColor(v)}">${text}</span>`;
const plural = (k, word) => `${k} ${word}${k === 1 ? '' : 's'}`;
const howLong = d => d < 45 ? plural(Math.round(d), 'day') : d < 545 ? `${(d / 30.4).toFixed(1)} months` : `${(d / 365).toFixed(1)} years`;
const monthShort = key => `${getMonthName(+key.slice(5)).slice(0, 3)} ${key.slice(2, 4)}`;
const dash = v => v === null || v === undefined ? EMPTY_DASH : v;

// A small 💡 next to anything that needs explaining: hovering or focusing it shows the text in a floating card
// (one card for the page, placed by the bulb and kept inside the window, so tables and cards can't cut it off)
const hint = text => `<span class="ins-hint" tabindex="0" role="note" aria-label="${escapeHtml(text)}" data-hint="${escapeHtml(text)}">💡</span>`;
const hintPop = document.body.appendChild(Object.assign(document.createElement('div'), { className: 'hint-pop' }));
function showHint(el) {
  hintPop.textContent = el.dataset.hint;
  const r = el.getBoundingClientRect(), p = hintPop.getBoundingClientRect();
  const top = r.bottom + 8 + p.height > innerHeight - 8 ? r.top - p.height - 8 : r.bottom + 8;
  hintPop.style.left = Math.max(8, Math.min(r.left + r.width / 2 - p.width / 2, innerWidth - p.width - 8)) + 'px';
  hintPop.style.top = top + 'px';
  hintPop.classList.add('show');
}
const hideHint = () => hintPop.classList.remove('show');
document.addEventListener('mouseover', e => { const h = e.target.closest?.('.ins-hint'); h ? showHint(h) : hideHint(); });
document.addEventListener('focusin', e => e.target.classList?.contains('ins-hint') ? showHint(e.target) : hideHint());
tableContainer.addEventListener('scroll', hideHint);

const tile = (label, value, sub = '', tip = '') => `<div class="ins-tile"><div class="ins-tile-label">${label}${tip ? hint(tip) : ''}</div><div class="ins-tile-value">${value}</div>${sub ? `<div class="ins-tile-sub">${sub}</div>` : ''}</div>`;
const card = (title, body, wide, tip = '') => `<div class="ins-card${wide ? ' wide' : ''}">${title ? `<h4 class="ins-card-title">${title}${tip ? hint(tip) : ''}</h4>` : ''}${body}</div>`;
// An insight: title (+ what it measures, behind the 💡), the answer in one short line, tiles, then charts / tables
const section = (icon, title, tip, takeaway, tiles, cards) => `
  <div class="ins-head"><h3>${icon} ${title}${hint(tip)}</h3><p class="ins-take">${takeaway}</p></div>
  <div class="ins-tiles">${tiles.join('')}</div>
  <div class="ins-grid">${cards.join('')}</div>`;
// Where a price sits between the low (0%) and the high (100%): a small bar with a marker
const rangeBar = p => p === null ? EMPTY_DASH : `<span class="ins-range"><i style="left:${p.toFixed(0)}%"></i></span> ${p.toFixed(0)}%`;
const arrow = '<span class="ins-slash">→</span>';

// ── The insights. teaser(r) = what the menu card shows; render(r) = the opened insight. On screen: short answers;
// explanations sit behind the 💡 hints (not tons of text). ──
const INSIGHTS = [
  { key: 'growth', icon: '📈', title: 'Growth', question: 'Is my money growing?',
    teaser: r => ({ value: signed$(r.money.profit), line: `${r.money.up} of ${r.money.growth.length} months went up` }),
    render: ({ money: m }) => section('📈', 'Growth', 'Profit = what the account is worth now minus all the money you put in. Deposits are not profit.',
      `<strong>${signed$(m.profit)}</strong> on your money · ${m.up} of ${m.growth.length} months up`,
      [tile('Profit', signed$(m.profit), '', 'Account value now − all the money you put in.'),
       tile('Time-weighted return', colored(m.twrPct, pct0(m.twrPct)), '', "Each month's return chained together. Deposits don't change it, so it shows how well the investments did. Same as \"since inception\" in the IBKR app."),
       tile('Best month', colored(m.best.twr, pct0(m.best.twr)), monthShort(m.best.key)),
       tile('Worst month', colored(m.worst.twr, pct0(m.worst.twr)), monthShort(m.worst.key))],
      [card('Value vs money put in', lineChart(m.growth.map(g => g.key), [
          { label: 'Account value', cls: 'value', values: m.growth.map(g => g.value) },
          { label: 'Money put in', cls: 'putin', values: m.growth.map(g => g.putIn) }],
          i => `${monthShort(m.growth[i].key)}: value ${$0(m.growth[i].value)} · put in ${$0(m.growth[i].putIn)} · profit ${$0(m.growth[i].value - m.growth[i].putIn)}`, v => $0(v)),
          false, 'The gap between the two lines is your profit. Hover a month to see its numbers.'),
       card('Return per month', barChart(m.growth.map(g => g.key), [{ values: m.growth.map(g => g.twr), cls: v => v >= 0 ? 'pos' : 'neg' }],
          i => `${monthShort(m.growth[i].key)}: ${pct0(m.growth[i].twr)}`, v => v.toFixed(0) + '%'), false, "Each month's time-weighted return: deposits don't count as gains.")]) },

  { key: 'drawdowns', icon: '🛡', title: 'Drawdowns', question: 'How far did I fall, and how fast did I recover?',
    teaser: ({ drawdowns: d }) => ({ value: colored(d.max, d.max.toFixed(1) + '%'), line: d.now < -0.05 ? `${d.now.toFixed(1)}% below the high right now` : 'At a high right now' }),
    render: ({ drawdowns: d }) => section('🛡', 'Drawdowns', "A drawdown is how far the account fell from its highest point before. It's measured with the time-weighted return, so a deposit can't hide a drop.",
      d.max < -0.05 ? `Deepest drop <strong style="color:var(--neg)">${d.max.toFixed(1)}%</strong> · ${d.now < -0.05 ? `now ${Math.abs(d.now).toFixed(1)}% below the high` : 'at a high now'}`
        : 'Never below a previous high in these months',
      [tile('Deepest drop', colored(d.max, d.max.toFixed(1) + '%'), d.maxKey ? `bottom ${monthShort(d.maxKey)}` : '', 'The biggest fall from a previous high.'),
       tile('Right now', d.now < -0.05 ? colored(d.now, d.now.toFixed(1) + '%') : 'At a high', '', 'How far below its best month-end the account is now.'),
       tile('Longest climb back', d.longest ? plural(d.longest, 'month') : '—', d.longestOngoing ? 'still climbing' : '', 'The most months it took to go from a high, down, and back up to that high.'),
       tile('Earlier → last 12 months', d.hasThen && d.hasNow ? `${colored(d.then, d.then.toFixed(1) + '%')} ${arrow} ${colored(d.nowEra, d.nowEra.toFixed(1) + '%')}` : '—',
         d.hasThen && d.hasNow ? (d.nowEra > d.then ? 'smaller drops now' : 'deeper drops now') : '', 'Your deepest drop before the last 12 months, and within them. Needs months on both sides.')],
      [card('Below the high, each month', barChart(d.series.map(x => x.key), [{ values: d.series.map(x => Math.min(0, x.drop)), cls: () => 'neg' }],
          i => `${monthShort(d.series[i].key)}: ${d.series[i].drop < -0.05 ? d.series[i].drop.toFixed(1) + '% below the high' : 'at a high'}`, v => v.toFixed(0) + '%'),
          true, "Each bar: how far below its highest point so far the account was at that month's end. No bar = at a high.")]) },

  { key: 'buying', icon: '🎯', title: 'Buying low', question: 'Did I really buy when things were down?',
    teaser: ({ buyingLow: b }) => ({ value: b.belowHighPct === null ? '—' : `${b.belowHighPct.toFixed(0)}%`, line: 'of your buying happened below your high' }),
    render: ({ buyingLow: b }) => section('🎯', 'Buying low', 'Buying when the market drops is a common plan. This checks how often you did.',
      b.count ? `<strong>${b.belowHighPct.toFixed(0)}%</strong> of your buying was while the account was down` : 'No buys in these months',
      [tile('Bought while down', b.belowHighPct === null ? '—' : `${b.belowHighPct.toFixed(0)}%`, 'of the money', 'Share of the money you invested while the account was below its highest point (at the end of the month before the buy).'),
       tile('Price range', b.position === null ? '—' : rangeBar(b.position), 'lower = better', "Where each buy price sat between that stock's lowest (0%) and highest (100%) month-end price in the 2 months before and after it."),
       tile('Since you bought', b.change === null ? '—' : colored(b.change, pct0(b.change)), b.held ? plural(b.held, 'buy') : '', "Today's price vs your buy price, for the stocks you still hold."),
       tile('Buys', `${b.count}`, b.count ? `${$0(b.amount)} invested` : '')],
      [card('Per stock', flexTable('', ['Stock', 'Buys', 'Invested', `Bought while down${hint('Share of the money put into this stock while the account was below its high.')}`,
          `Price range${hint('0% = bought at the lowest price around it, 100% = at the highest.')}`, `Since you bought${hint("Today's price vs your buy price (stocks you still hold).")}`],
          b.perSymbol.map(x => [`<strong>${escapeHtml(x.symbol)}</strong>`, x.buys, $0(x.amount), `${x.belowHighPct.toFixed(0)}%`, rangeBar(x.position), x.change === null ? EMPTY_DASH : colored(x.change, pct0(x.change))]),
          { align: 'lrrrrr' }) || '<p class="flex-note">No buys in these months.</p>', true)]) },

  { key: 'stocks', icon: '🏆', title: 'Results per stock', question: 'Which stocks made me money?',
    teaser: ({ perStock: s }) => s.length ? { value: `${escapeHtml(s[0].symbol)} ${signed$(s[0].total)}`, line: `best of ${plural(s.length, 'stock')}; ${s.filter(x => x.total > 0).length} made money` } : { value: '—', line: 'no stocks in these months' },
    render: ({ perStock: s }) => section('🏆', 'Results per stock', 'Per stock: profit from shares you sold + profit on shares you still hold + dividends.',
      s.length ? `${s.filter(x => x.total > 0).length} of ${plural(s.length, 'stock')} made money` : 'No stocks traded in these months',
      [tile('Stocks', `${s.length}`, `${s.filter(x => x.held).length} still held`),
       tile('Made money', `${s.filter(x => x.total > 0).length}`, `${s.filter(x => x.total < 0).length} lost`),
       tile('Best', s.length ? `${escapeHtml(s[0].symbol)} ${signed$(s[0].total)}` : '—'),
       tile('Worst', s.length ? `${escapeHtml(s[s.length - 1].symbol)} ${signed$(s[s.length - 1].total)}` : '—')],
      [card('', flexTable('', ['Stock', 'Total', 'From sales', `Still held${hint('Profit or loss on the shares you still own, at the latest price.')}`, 'Dividends',
          `Sold at a profit${hint('Share of the sold shares that were sold for more than they cost.')}`, `Typical hold${hint('The middle value of how long you held shares before selling them.')}`],
          s.map(x => [`<strong>${escapeHtml(x.symbol)}</strong>`, `<strong>${signed$(x.total)}</strong>`, x.lots ? signed$(x.realized) : EMPTY_DASH, x.held ? signed$(x.unrealized) : EMPTY_DASH,
            x.dividends ? signed$(x.dividends) : EMPTY_DASH, x.winRate === null ? EMPTY_DASH : `${x.winRate.toFixed(0)}% <small>of ${x.lots}</small>`, x.medianDays === null ? EMPTY_DASH : howLong(x.medianDays)]),
          { align: 'lrrrrrr' }) || '<p class="flex-note">No stocks in these months.</p>', true)]) },

  { key: 'currency', icon: '💱', title: 'Currency conversions', question: 'Did I convert shekels at good times?',
    teaser: ({ currency: c }) => c.conversions.length ? { value: c.cheaperThan === null ? '—' : `${c.cheaperThan.toFixed(0)}%`, line: 'of the days around them were more expensive' } : { value: '—', line: 'no conversions in these months' },
    render: ({ currency: c }) => section('💱', 'Currency conversions', "Each ₪ → $ conversion is compared with the Bank of Israel's official rate on every working day in the 1.5 months before and after it. Higher % = better timing (fewer shekels per dollar).",
      c.conversions.length ? `Cheaper than <strong>${c.cheaperThan.toFixed(0)}%</strong> of the days around them${c.rough ? ` · <span class="ins-note">rough</span>${hint(`Bank of Israel rates couldn't be downloaded${c.daily ? ' for some dates' : ''}, so ${c.daily ? 'those use' : 'this uses'} IBKR's month-end rates.`)}` : ''}`
        : 'No shekel → dollar conversions in these months',
      [tile('Timing', c.cheaperThan === null ? '—' : `${c.cheaperThan.toFixed(0)}%`, 'of nearby days cost more', 'On average, your rate was cheaper than this share of the days around each conversion. Bigger conversions count more.'),
       tile('Your average rate', c.avgRate ? `₪${c.avgRate.toFixed(3)}` : '—', c.conversions.length ? `${$0(c.ilsPaid, 'ILS')} → ${$0(c.usdBought)}` : ''),
       tile('Rate today', c.rateNow ? `₪${c.rateNow.toFixed(3)}` : '—', c.daily ? 'Bank of Israel' : 'IBKR'),
       tile("Dollar's move since", c.avgRate ? signed$(c.fxEffectILS, 'ILS') : '—', 'in ₪', "Dollars you converted × (today's rate − your average rate). Below zero = your dollars are worth fewer shekels now than you paid.")],
      [...c.conversions.slice().reverse().map(x => card(`${dmy(x.date)} · ${$0(x.ils, 'ILS')} → ${$0(x.usd)} at ₪${x.rate.toFixed(3)}`,
          `<div class="ins-conv-sub">${x.cheaperThan === null ? 'No rates around this date' : `Cheaper than <strong>${x.cheaperThan.toFixed(0)}%</strong> of the days around it`}${x.rough ? ' · <span class="ins-note">rough</span>' : ''}${x.note ? ` · ${escapeHtml(x.note)}` : ''}</div>${windowChart(x)}`,
          false, x.cheaperThan === null ? '' : `Official rate in those days: ₪${x.low.toFixed(3)} to ₪${x.high.toFixed(3)}. The dashed line is your rate; the dot is the day you converted.${x.rough ? " Rough: IBKR's month-end rates, not daily ones." : ''}`)),
       card('Every conversion', flexTable('', ['Date', 'Shekels', 'Dollars', 'Rate', `Cheaper than${hint('Share of the days around it with a more expensive rate.')}`,
          `vs your average${hint('Shekels saved (+) or extra (−) compared with converting these dollars at your average rate.')}`, `vs today${hint("What the dollar's move since then is worth on these dollars, in shekels.")}`],
          c.conversions.slice().reverse().map(x => [dmy(x.date), $0(x.ils, 'ILS'), $0(x.usd), `₪${x.rate.toFixed(4)}`, x.cheaperThan === null ? EMPTY_DASH : `${x.cheaperThan.toFixed(0)}%`,
            signed$(x.vsAvgILS, 'ILS'), signed$(x.vsNowILS, 'ILS')]),
          { align: 'lrrrrrr' }) || '<p class="flex-note">No conversions in these months.</p>', true)]) },

  { key: 'cash', icon: '₪', title: 'Costs & cash', question: 'What do taxes and fees cost me?',
    teaser: ({ cash: c }) => ({ value: $0(-c.costs.total), line: c.commThen.pct !== null && c.commNow.pct !== null ? `commission: ${c.commThen.pct.toFixed(2)}% → ${c.commNow.pct.toFixed(2)}% of each trade` : 'taxes and fees in these months' }),
    render: ({ cash: c }) => section('₪', 'Costs & cash', 'What taxes, fees and commissions took, and how much of the account sat in cash instead of being invested.',
      `Taxes & fees <strong>${$0(c.costs.total)}</strong>${c.costShare !== null ? ` · ${c.costShare.toFixed(c.costShare < 10 ? 1 : 0)}% of what you earned` : ''}`,
      [tile('Taxes & fees', $0(-c.costs.total), '', `Israel tax ${$0(-c.costs.israelTax)} · US tax ${$0(-c.costs.usTax)} · commissions ${$0(-c.costs.commissions)}`),
       tile('Costs vs profit', c.costShare === null ? '—' : `${c.costShare.toFixed(c.costShare < 10 ? 1 : 0)}%`, 'of what you earned', 'Taxes and fees ÷ what you earned before them (profit + taxes + fees).'),
       tile('Commission per trade', c.commThen.pct !== null && c.commNow.pct !== null ? `${c.commThen.pct.toFixed(2)}% ${arrow} ${c.commNow.pct.toFixed(2)}%` : c.commNow.pct !== null ? `${c.commNow.pct.toFixed(2)}%` : '—', 'earlier → last 12 months', "Commission as a % of each trade's amount. Small trades pay a bigger %."),
       tile('Cash not invested', `${c.idleAvg.toFixed(1)}%`, 'average month', 'Share of the account sitting in cash at month end.')],
      [card('Cash not invested, per month', barChart(c.idle.map(x => x.key), [{ values: c.idle.map(x => x.pct), cls: () => 'cash' }],
          i => `${monthShort(c.idle[i].key)}: ${c.idle[i].pct.toFixed(1)}% in cash`, v => v.toFixed(0) + '%'), false, "Share of the account in cash at each month's end."),
       card('Dividends per stock', flexTable('', ['Stock', 'Dividends', 'US tax', `Tax rate${hint('US tax on dividends is normally 25% for Israeli residents. ⚠ = a different rate, usually a refund or correction by IBKR.')}`, 'Net'],
          c.dividendsPerStock.map(x => [`<strong>${escapeHtml(x.symbol)}</strong>`, money(x.gross), money(x.tax), Math.abs(x.taxRate - 25) > 2
            ? `<span class="ins-flag">${x.taxRate.toFixed(0)}% ⚠</span>` : `${x.taxRate.toFixed(0)}%`, `<strong>${signed$(x.net)}</strong>`]),
          { align: 'lrrrr' }) || '<p class="flex-note">No dividends in these months.</p>')]) },

  { key: 'eras', icon: '🔄', title: 'Then vs now', question: 'Am I doing better lately?',
    teaser: ({ thenVsNow: { then, now } }) => then.months && now.months ? { value: `${colored(then.avgReturn, pct0(then.avgReturn))} ${arrow} ${colored(now.avgReturn, pct0(now.avgReturn))}`, line: 'average month, earlier → last 12 months' } : { value: '—', line: 'needs months before and within the last 12 months' },
    render: ({ thenVsNow: { then, now } }) => {
      const both = then.months && now.months;
      // A row per measure; the better side gets a ✓ (higherBetter: true / false, or null = neither is better)
      const row = (label, a, b, fmt, higherBetter, tip) => {
        const better = higherBetter === null || a === null || b === null || a === b ? null : (higherBetter ? b > a : b < a) ? 'now' : 'then';
        const cell = (v, side) => v === null ? EMPTY_DASH : `${fmt(v)}${better === side ? ' <span class="ins-better">✓</span>' : ''}`;
        return [`<strong>${label}</strong>${tip ? hint(tip) : ''}`, cell(a, 'then'), cell(b, 'now')];
      };
      const pctF = v => colored(v, pct0(v)), daysF = v => howLong(v);
      return section('🔄', 'Then vs now', 'The last 12 months compared with the months before them. ✓ marks the better side.',
        both ? `Average month ${pctF(then.avgReturn)} ${arrow} ${pctF(now.avgReturn)}` : 'Pick months from before and within the last 12 months (or All time) to compare',
        [tile('Average month', both ? `${pctF(then.avgReturn)} ${arrow} ${pctF(now.avgReturn)}` : '—', 'earlier → recent', 'Average time-weighted return per month.'),
         tile('Deepest drop', both ? `${colored(then.maxDrop, then.maxDrop.toFixed(1) + '%')} ${arrow} ${colored(now.maxDrop, now.maxDrop.toFixed(1) + '%')}` : '—', 'earlier → recent'),
         tile('Typical hold', then.medianDays !== null && now.medianDays !== null ? `${howLong(then.medianDays)} ${arrow} ${howLong(now.medianDays)}` : '—', 'earlier → recent', 'The middle value of how long you held shares before selling.'),
         tile('Sold at a profit', then.winRate !== null && now.winRate !== null ? `${then.winRate.toFixed(0)}% ${arrow} ${now.winRate.toFixed(0)}%` : '—', 'earlier → recent', 'Share of the sold shares that were sold for more than they cost.')],
        [card('', flexTable('', ['', ERAS.then, ERAS.now], [
          row('Months in view', then.months, now.months, v => v, null),
          row('Average month', then.avgReturn, now.avgReturn, pctF, true),
          row('Deepest drop', then.maxDrop, now.maxDrop, v => colored(v, v.toFixed(1) + '%'), true),
          row('Trades per month', then.tradesPerMonth, now.tradesPerMonth, v => v.toFixed(1), null),
          row('Typical hold', then.medianDays, now.medianDays, daysF, null, 'Before selling; the middle value.'),
          row('Sold at a profit', then.winRate, now.winRate, v => v.toFixed(0) + '%', true, 'Share of the sold shares.'),
          row('Average win', then.avgWin, now.avgWin, v => signed$(v), true, 'Average profit on a sale that made money.'),
          row('Average loss', then.avgLoss, now.avgLoss, v => signed$(v), true, 'Average loss on a sale that lost money.'),
          row('Made from sales', then.realized, now.realized, v => signed$(v), null),
          row('Commission', then.commPct, now.commPct, v => v.toFixed(2) + '%', false, "As a % of each trade's amount."),
        ], { align: 'lrr' }), true)]);
    } },
];

function renderInsightsPage() {
  const { months, all, rates } = insightsData, r = insights(months, all, rates);
  const open = INSIGHTS.find(x => x.key === insightOpen);
  const menu = INSIGHTS.map(x => { const t = x.teaser(r); return `
    <button class="ins-menu-card${open === x ? ' open' : ''}" onclick="openInsight('${x.key}')" title="${open === x ? 'Close' : 'Open'}: ${escapeHtml(x.question)}">
      <span class="ins-menu-top"><span class="ins-menu-icon">${x.icon}</span><span class="ins-menu-title">${x.title}</span></span>
      <span class="ins-menu-q">${x.question}</span><span class="ins-menu-value">${t.value}</span><span class="ins-menu-line">${t.line}</span></button>`; }).join('');
  return `<div class="list-page insights-page${monthTheme(months)}">
    <div class="fin-header"><h2 style="color: var(--heading);">💡 Insights <small class="flex-view-label">${flexViewLabel()}</small></h2>${showAllButton()}</div>
    <div class="ins-menu${open ? ' has-open' : ''}">${menu}</div>
    <div id="ins-detail">${open ? insightDetail(open, r) : ''}</div></div>`;
}
const insightDetail = (x, r) => `<div class="ins-detail-bar"><button class="ins-back" onclick="closeInsight()">↑ Back to all insights</button></div>${x.render(r)}`;

// Smooth scroll of the page area to a position (about 0.3s)
function glideTo(top, ms = 300) {
  const el = tableContainer, from = el.scrollTop, start = performance.now();
  if (reducedMotion() || Math.abs(top - from) < 2) { el.scrollTop = top; return Promise.resolve(); }
  return new Promise(done => {
    const frame = now => { const p = Math.min(1, (now - start) / ms); el.scrollTop = from + (top - from) * easeInOut(p); if (p < 1) requestAnimationFrame(frame); else done(); };
    requestAnimationFrame(frame);
  });
}
// Opens an insight below the menu (clicking the open one again closes it); the page glides down to it and it builds in
function openInsight(key) {
  if (key === insightOpen) return closeInsight();
  insightOpen = key;
  remember('ibkr_insight', key);
  tableContainer.innerHTML = renderInsightsPage();
  const detail = document.getElementById('ins-detail');
  animatePage(detail);
  glideTo(detail.getBoundingClientRect().top - tableContainer.getBoundingClientRect().top + tableContainer.scrollTop - 12);
}
// Back to the menu: glide to the top, then close
function closeInsight() {
  insightOpen = null;
  remember('ibkr_insight', null);
  glideTo(0).then(() => {
    document.querySelector('.ins-menu')?.classList.remove('has-open');
    document.querySelectorAll('.ins-menu-card.open').forEach(c => c.classList.remove('open'));
    const detail = document.getElementById('ins-detail');
    if (detail) detail.innerHTML = '';
  });
}

// ── Small inline SVG charts (no library). Colors come from CSS classes, so light and dark follow the theme.
// Hovering a month shows its numbers (a tooltip per month column). ──
const CH = { w: 540, h: 200, l: 52, r: 12, t: 14, b: 26 };
function ticks(min, max) {
  const raw = (max - min || 1) / 4, mag = 10 ** Math.floor(Math.log10(raw)), step = [1, 2, 2.5, 5, 10].map(x => x * mag).find(x => x >= raw);
  const out = [];
  for (let v = Math.floor(min / step) * step; v <= Math.ceil(max / step) * step + step / 2; v += step) out.push(+v.toFixed(10));
  return out;
}
// Frame: horizontal grid lines with values, month labels (about 8 of them), and a hover column per month with a tooltip
function chartFrame(keys, min, max, fmt, tip, label = monthShort) {
  const tk = ticks(min, max), lo = tk[0], hi = tk[tk.length - 1];
  const y = v => CH.t + (hi - v) / (hi - lo || 1) * (CH.h - CH.t - CH.b), colW = (CH.w - CH.l - CH.r) / keys.length, x = i => CH.l + colW * (i + 0.5);
  const every = Math.ceil(keys.length / 8);
  const svg = tk.map(v => `<line class="ch-grid${v === 0 ? ' zero' : ''}" x1="${CH.l}" x2="${CH.w - CH.r}" y1="${y(v)}" y2="${y(v)}"/><text class="ch-ax" x="${CH.l - 6}" y="${y(v) + 4}" text-anchor="end">${escapeHtml(fmt(v))}</text>`).join('')
    + keys.map((k, i) => (keys.length - 1 - i) % every ? '' : `<text class="ch-ax" x="${x(i)}" y="${CH.h - 8}" text-anchor="middle">${label(k)}</text>`).join('');
  const hover = keys.map((k, i) => `<rect class="ch-hit" x="${CH.l + colW * i}" y="${CH.t}" width="${colW}" height="${CH.h - CH.t - CH.b}"><title>${escapeHtml(tip(i))}</title></rect>`).join('');
  return { y, x, colW, svg, hover };
}
const svgWrap = inner => `<svg class="ins-chart" viewBox="0 0 ${CH.w} ${CH.h}" preserveAspectRatio="xMidYMid meet">${inner}</svg>`;
const legend = items => `<div class="ch-legend">${items.map(([cls, label]) => `<span><i class="sw ${cls}"></i>${label}</span>`).join('')}</div>`;

function lineChart(keys, lines, tip, fmt) {
  const vals = lines.flatMap(l => l.values), fr = chartFrame(keys, Math.min(0, ...vals), Math.max(...vals), fmt, tip);
  const path = l => l.values.map((v, i) => `${i ? 'L' : 'M'}${fr.x(i).toFixed(1)},${fr.y(v).toFixed(1)}`).join('');
  const last = keys.length - 1;
  return legend(lines.map(l => [l.cls, l.label])) + svgWrap(fr.svg
    + lines.map(l => `<path class="ch-line ${l.cls}" d="${path(l)}"/><circle class="ch-dot ${l.cls}" cx="${fr.x(last)}" cy="${fr.y(l.values[last])}" r="4"/>`).join('') + fr.hover);
}
// series = [{ label, values, cls(value) }]; stacked = series on top of each other (all positive)
function barChart(keys, series, tip, fmt, opts = {}) {
  const totals = keys.map((_, i) => series.reduce((a, s) => a + s.values[i], 0));
  const vals = opts.stacked ? totals : series.flatMap(s => s.values);
  const fr = chartFrame(keys, Math.min(0, ...vals), Math.max(0, ...vals, opts.integers ? 4 : 0), fmt, tip);
  const bw = Math.max(2, Math.min(26, fr.colW - 2)), r = Math.min(3, bw / 3);
  const bars = keys.map((_, i) => {
    let base = 0;
    return series.map(s => {
      const v = s.values[i]; if (!v) return '';
      const from = opts.stacked ? base : 0, to = from + v; base = to;
      const top = fr.y(Math.max(from, to)), h = Math.max(1, Math.abs(fr.y(from) - fr.y(to)) - (opts.stacked ? 1 : 0));
      return `<rect class="ch-bar ${s.cls(v)}" x="${fr.x(i) - bw / 2}" y="${top}" width="${bw}" height="${h}" rx="${r}"/>`;
    }).join('');
  }).join('');
  const lg = series.filter(s => s.label).length > 1 ? legend(series.map(s => [s.cls(1), s.label])) : '';
  return lg + svgWrap(fr.svg + bars + fr.hover);
}
// One conversion: the daily rate in the 1.5 months around it, your rate as a dashed line and a dot on the day
function windowChart(c) {
  if (!c.window.length) return '';
  const pts = c.window, lo = Math.min(c.rate, ...pts.map(p => p.rate)), hi = Math.max(c.rate, ...pts.map(p => p.rate));
  const fr = chartFrame(pts.map(p => p.day), lo, hi, v => '₪' + v.toFixed(2), i => `${dmy(pts[i].day)}: ₪${pts[i].rate.toFixed(3)}${pts[i].rate > c.rate ? ' (more expensive than yours)' : ''}`,
    d => `${d.slice(8)}/${d.slice(5, 7)}`);
  const path = pts.map((p, i) => `${i ? 'L' : 'M'}${fr.x(i).toFixed(1)},${fr.y(p.rate).toFixed(1)}`).join('');
  const at = pts.reduce((best, p, i) => Math.abs(Date.parse(p.day) - Date.parse(c.day)) < Math.abs(Date.parse(pts[best].day) - Date.parse(c.day)) ? i : best, 0);
  return legend([['value', c.rough ? 'Month-end rate (IBKR)' : 'Official rate (Bank of Israel)'], ['mine', 'Your rate']]) + svgWrap(fr.svg
    + `<path class="ch-line value" d="${path}"/><line class="ch-mine" x1="${CH.l}" x2="${CH.w - CH.r}" y1="${fr.y(c.rate)}" y2="${fr.y(c.rate)}"/>`
    + `<circle class="ch-dot mine" cx="${fr.x(at)}" cy="${fr.y(c.rate)}" r="5"/>` + fr.hover);
}
