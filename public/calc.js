// ============================================================
// calc.js — Portfolio math shared by the page (app.js) and the server (Google Sheets push)
// ============================================================
const CAPITAL_GAINS_TAX = 0.25;

// End − start − deposits − withdrawals: how much the money grew in one month
const monthGain = m => m.endValue - m.startValue - m.deposits - m.withdrawals;

// Like Financial Summary's Calculated Realized P/L: sales P/L + dividends + WHT + fees (Israel tax). Commissions are already inside realized P/L.
const realizedGainOf = m => m.realizedPL + m.dividends + m.withholdingTax + m.feesUSD;

// Totals over the given months (newest first). Used by the Financial Summary (API) TOTAL row and the Portfolio page.
// Profit is measured on the money you put in: deposits/withdrawals are not profit.
// putIn = value at the start of the oldest month + all deposits − withdrawals; profit = value now − putIn.
function flexTotals(months) {
  const sum = k => months.reduce((a, m) => a + m[k], 0);
  const latest = months[0], oldest = months[months.length - 1];
  const putIn = oldest.startValue + sum('deposits') + sum('withdrawals');
  const by = {};
  for (const x of months.flatMap(m => m.conversions)) {
    const k = x.fromCur + x.toCur;
    by[k] = by[k] || { fromCur: x.fromCur, toCur: x.toCur, fromAmt: 0, toAmt: 0 };
    by[k].fromAmt += x.fromAmt; by[k].toAmt += x.toAmt;
  }
  const t = { latest, oldest, putIn, endValue: latest.endValue, profit: latest.endValue - putIn,
    // Average rate, weighted by amount, as ILS per USD like IBKR's USD.ILS price
    conversions: Object.values(by).map(x => ({ ...x, rate: x.fromCur === 'ILS' ? x.fromAmt / x.toAmt : x.toAmt / x.fromAmt })) };
  for (const k of ['depositsUSD', 'depositsILS', 'withdrawalsUSD', 'withdrawalsILS', 'realizedPL', 'dividends', 'withholdingTax', 'feesILS', 'feesUSD', 'commissions']) t[k] = sum(k);
  t.returnPct = putIn ? t.profit / putIn * 100 : 0;
  // IBKR's "since inception" return: the monthly time-weighted returns chained together (deposit timing doesn't matter)
  t.twrPct = (months.reduce((a, m) => a * (1 + m.twr / 100), 1) - 1) * 100;
  t.realizedGain = realizedGainOf(t);
  return t;
}

// Portfolio headline numbers and the "if you sold everything today" journey, for a USD/ILS rate and bank balance.
// nw = /api/net-worth. IBKR account in ₪: dollars after tax at the rate + ILS cash; net worth adds the bank.
function portfolioMath(nw, rate, bank) {
  const taxUSD = Math.max(0, nw.unrealizedPL) * CAPITAL_GAINS_TAX;
  const dollars = nw.cashUSD + nw.investedUSD, afterTax = dollars - taxUSD;
  const haveILS = afterTax * rate + nw.cashILS;
  const inILS = (nw.putInILS || 0) + (nw.putInUSD || 0) * rate;
  const profitILS = haveILS - inILS;
  // Journey: ₪ put in → dollars (converted, grew, taxed, back to ₪) + shekels (kept, Israel tax & fees, cash now)
  const conv = nw.toUSD || { from: 0, to: 0 }, back = nw.toILS || { from: 0, to: 0 };
  const usdStart = conv.to - back.from + (nw.putInUSD || 0), ilsKept = (nw.putInILS || 0) - conv.from + back.to;
  return { taxUSD, dollars, afterTax, haveILS, inILS, profitILS, profitPct: inILS ? profitILS / inILS * 100 : null,
    netWorthILS: haveILS + bank, usdStart, ilsKept, feesILS: nw.cashILS - ilsKept, buyRate: nw.usdBuyRate || 0 };
}

// Activity page: real stock trades only. IBKR's "closed lot" rows (which buy each sale closed) and
// currency conversions (a category of their own) are left out.
const stockTrades = m => m.trades.filter(t => t.LevelOfDetail !== 'CLOSED_LOT' && t.AssetClass !== 'CASH');

// Dates in tables: DD/MM/YYYY ('YYYY-MM' → MM/YYYY)
const dmy = iso => String(iso || '').split(';')[0].split('-').reverse().join('/');

// Activity page: the categories, in the order of the check boxes
const ACTIVITY_CATEGORIES = { dividends: 'Dividends', israelTax: 'Israel tax & fees', deposits: 'Deposits', withdrawals: 'Withdrawals', conversions: 'Conversions', trades: 'Trades', other: 'Other' };

// Activity page: one month's cash rows, newest first. Each row: { date, cat, label, symbol, in, out, net, usd, rate, note }
// with in/out = { amount, cur } (out is negative).
//   Dividend = the dividend + its US tax withheld (same stock and day); a tax-only row is an IBKR tax correction.
//   ILS deposits under ₪500 are promos (like isRealDeposit). A USD deposit wired after a bank conversion
//   counts as the original ILS deposit (like the summary); bank conversions have no day, so their date is the month.
//   Any type not known here (none seen so far) lands in "other", so nothing goes missing.
function cashRows(m) {
  const n = v => Number(v) || 0, day = v => String(v || '').split(';')[0];
  const rows = [], divs = {};
  for (const t of m.cashTx) {
    const a = n(t.Amount), cur = t.CurrencyPrimary || 'USD', date = day(t['Date/Time']);
    const move = a > 0 ? { in: { amount: a, cur } } : { out: { amount: a, cur } };
    if (t.Type === 'Dividends' || t.Type === 'Withholding Tax') {
      const key = t.Symbol + '|' + date;
      if (!divs[key]) rows.push(divs[key] = { date, cat: 'dividends', symbol: t.Symbol, cur, ins: 0, outs: 0, label: 'US tax correction' });
      const d = divs[key];
      if (a > 0) d.ins += a; else d.outs += a;
      if (t.Type === 'Dividends') d.label = 'Dividend';
    } else if (t.Type === 'Other Fees') rows.push({ date, cat: 'israelTax', label: 'Israel tax', ...move, usd: a * (n(t.FXRateToBase) || 1) });
    else if (t.Type === 'Deposits/Withdrawals') {
      if (cur === 'ILS' && a > 0 && a < 500) continue;
      const bank = m.conversions.find(c => c.note && c.toCur === cur && Math.abs(c.toAmt - a) < 0.01);
      if (bank) rows.push({ date, cat: 'deposits', label: 'Deposit', in: { amount: bank.fromAmt, cur: bank.fromCur }, note: bank.note });
      else rows.push({ date, cat: a > 0 ? 'deposits' : 'withdrawals', label: a > 0 ? 'Deposit' : 'Withdrawal', ...move });
    } else rows.push({ date, cat: 'other', label: t.Type, symbol: t.Symbol || '', ...move });
  }
  for (const d of Object.values(divs)) {
    if (d.ins) d.in = { amount: d.ins, cur: d.cur };
    if (d.outs) d.out = { amount: d.outs, cur: d.cur };
    d.net = d.ins + d.outs;
  }
  const month = `${m.year}-${String(m.month).padStart(2, '0')}`;
  for (const c of m.conversions) rows.push({ date: c.date || month, cat: 'conversions', label: `${c.fromCur} → ${c.toCur}`,
    out: { amount: -c.fromAmt, cur: c.fromCur }, in: { amount: c.toAmt, cur: c.toCur }, rate: c.rate, note: c.note });
  return rows.filter(r => r.in || r.out).sort((a, b) => b.date.localeCompare(a.date));
}

// Activity page and the Sheet's Activity tab: one month's trades and cash rows together, newest first.
// A trade is { date, cat: 'trades', t }. The words are shared, so the app and the Sheet say the same thing.
const activityRows = m => [...cashRows(m), ...stockTrades(m).map(t => ({ date: dayOf(t.TradeDate), cat: 'trades', t }))]
  .sort((a, b) => b.date.localeCompare(a.date));
const activityType = r => r.t ? (r.t['Buy/Sell'] === 'BUY' ? 'Buy' : 'Sell') : r.cat === 'conversions' ? 'Conversion'
  : r.cat === 'dividends' && r.label !== 'Dividend' ? 'US tax fix' : r.label;
// "What happened" as pieces of text ({ t, muted }); fmt(amount, cur) formats money (the app and the Sheet pass their own)
function activityWords(r, fmt) {
  const n = v => Number(v) || 0, t = r.t;
  if (t) {
    const q = Math.abs(n(t.Quantity));
    return [{ t: `${t['Buy/Sell'] === 'BUY' ? 'Bought' : 'Sold'} ${q.toLocaleString('en-US', { maximumFractionDigits: 4 })} share${q === 1 ? '' : 's'} at ${fmt(n(t.TradePrice), t.CurrencyPrimary)}` },
      { t: ` · fee ${fmt(Math.abs(n(t.IBCommission)), t.IBCommissionCurrency || 'USD')}`, muted: true }];
  }
  if (r.cat === 'dividends') return r.label === 'Dividend' ? [{ t: `${fmt(r.ins, r.cur)} dividend` }, r.outs && { t: ` − ${fmt(-r.outs, r.cur)} US tax`, muted: true }].filter(Boolean)
    : [{ t: 'IBKR corrected the US tax on a dividend' }];
  if (r.cat === 'israelTax') return r.out?.cur !== 'USD' ? [{ t: `about ${fmt(-r.usd, 'USD')}`, muted: true }] : [];
  if (r.cat === 'conversions') return [{ t: `${fmt(-r.out.amount, r.out.cur)} → ${fmt(r.in.amount, r.in.cur)}` }, { t: ` at ${r.rate.toFixed(4)}`, muted: true }];
  return [];
}
// "Cash in / out": the signed amounts a cash row moved (a dividend after its US tax; a conversion both sides). Trades: none.
const activityCash = r => r.t ? [] : r.cat === 'dividends' ? [{ amount: r.net, cur: r.cur }] : [r.in, r.out].filter(Boolean);

// ============================================================
// Insights page: answers computed from the months shown (newest first). Plain numbers only; insights.js turns them
// into cards and charts. all = every downloaded month (prices around a buy, the month before the first one shown);
// rates = official daily USD/ILS rates { 'YYYY-MM-DD': rate } from the Bank of Israel, or null when offline.
// "Then vs now" compares the last 12 months of downloaded data ('now') with the months before them ('then').
// ============================================================
const ERAS = { now: 'Last 12 months', then: 'Earlier' };
const dayOf = v => String(v || '').split(';')[0];
const daysBetween = (a, b) => Math.round((Date.parse(dayOf(b)) - Date.parse(dayOf(a))) / 86400000);
const inUSD = (t, k) => (Number(t[k]) || 0) * (Number(t.FXRateToBase) || 1);
const monthKey = m => `${m.year}-${String(m.month).padStart(2, '0')}`;
const inEra = (date, era, start) => (dayOf(date).slice(0, 7) >= start) === (era === 'now');
// First month of the last 12 months, counted back from the newest month (newest included)
const recentStartOf = newest => { const d = new Date(Date.UTC(newest.year, newest.month - 12, 1)); return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`; };
// IBKR's USD/ILS rate at a month's end: its ILS cash ÷ that cash's value in dollars (same as the Portfolio page's rate)
const monthRate = m => m.hasCashCurrency && m.endingCash - m.endingCashUSD > 0.5 ? m.endingCashILS / (m.endingCash - m.endingCashUSD) : 0;
const median = list => { const s = list.slice().sort((a, b) => a - b); return s.length ? (s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2) : 0; };
const avg = list => list.length ? list.reduce((a, x) => a + x, 0) / list.length : 0;
const sum = (list, f = x => x) => list.reduce((a, x) => a + f(x), 0);
const shiftDay = (iso, n) => { const d = new Date(iso + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };

// Biggest fall of the chained monthly returns from their previous high (%), for a list of months (oldest first)
function maxDrawdown(asc) {
  let index = 1, peak = 1, worst = 0;
  for (const m of asc) { index *= 1 + m.twr / 100; peak = Math.max(peak, index); worst = Math.min(worst, (index / peak - 1) * 100); }
  return worst;
}
// IBKR's closed lots: every share sold, with its buy date, cost and its own profit
const soldLots = months => months.flatMap(m => m.trades.filter(t => t.LevelOfDetail === 'CLOSED_LOT')).map(l => ({
  symbol: l.Symbol, sold: dayOf(l.TradeDate), bought: dayOf(l.OpenDateTime), days: Math.max(0, daysBetween(l.OpenDateTime, l.TradeDate)),
  pnl: inUSD(l, 'FifoPnlRealized'), cost: Math.abs(inUSD(l, 'CostBasis')) }));
const commissionOf = t => Math.abs(Number(t.IBCommission) || 0) * (!t.IBCommissionCurrency || t.IBCommissionCurrency === t.CurrencyPrimary ? Number(t.FXRateToBase) || 1 : 1);

function insights(months, all = months, rates = null) {
  const n = v => Number(v) || 0;
  const asc = months.slice().reverse(), newest = months[0];
  const recentStart = recentStartOf(all[0]);

  // 1. Growth: value vs money put in per month; the monthly returns chained like IBKR's time-weighted return
  let putIn = asc[0].startValue, index = 1, peak = 1;
  const growth = asc.map(m => {
    putIn += m.deposits + m.withdrawals;
    index *= 1 + m.twr / 100;
    peak = Math.max(peak, index);
    return { key: monthKey(m), value: m.endValue, putIn, twr: m.twr, drop: (index / peak - 1) * 100 };
  });
  const ranked = growth.slice().sort((a, b) => b.twr - a.twr);
  const money = { growth, best: ranked[0], worst: ranked[ranked.length - 1], up: growth.filter(g => g.twr > 0).length,
    down: growth.filter(g => g.twr < 0).length, profit: newest.endValue - growth[growth.length - 1].putIn, twrPct: (index - 1) * 100 };

  // 2. Drawdowns: how far below its previous high the account was each month, and how long the climbs back took
  const spells = [];
  let spell = null;
  growth.forEach((g, i) => {
    if (g.drop < -0.05) { if (!spell) spell = { start: i, low: g.drop, lowKey: g.key }; else if (g.drop < spell.low) { spell.low = g.drop; spell.lowKey = g.key; } }
    else if (spell) { spells.push({ ...spell, months: i - spell.start, recovered: true }); spell = null; }
  });
  if (spell) spells.push({ ...spell, months: growth.length - spell.start, recovered: false });
  const deepest = spells.slice().sort((a, b) => a.low - b.low)[0];
  const drawdowns = { series: growth.map(g => ({ key: g.key, drop: g.drop })), max: deepest ? deepest.low : 0, maxKey: deepest?.lowKey,
    now: growth[growth.length - 1].drop, spells: spells.length, longest: Math.max(0, ...spells.map(s => s.months)),
    longestOngoing: spells.some(s => !s.recovered && s.months === Math.max(...spells.map(x => x.months))),
    then: maxDrawdown(asc.filter(m => monthKey(m) < recentStart)), nowEra: maxDrawdown(asc.filter(m => monthKey(m) >= recentStart)),
    hasThen: asc.some(m => monthKey(m) < recentStart), hasNow: asc.some(m => monthKey(m) >= recentStart) };

  // 3. Buying low: was the account below its high when you bought, where did each buy price sit between the
  // stock's lowest and highest month-end price in the two months before and after, and how is it doing now
  const keys = all.map(monthKey);   // newest first
  const priceAt = (key, sym) => { const m = all[keys.indexOf(key)]; const p = m && m.positions.find(x => x.Symbol === sym); return p ? n(p.MarkPrice) : 0; };
  const dropBefore = {};   // account's drop from its high at the end of the month before each month
  growth.forEach((g, i) => { dropBefore[g.key] = i ? growth[i - 1].drop : 0; });
  const nowPrice = sym => { const p = newest.positions.find(x => x.Symbol === sym); return p ? n(p.MarkPrice) : 0; };
  const buys = asc.flatMap(m => stockTrades(m).filter(t => t['Buy/Sell'] === 'BUY').map(t => {
    const key = monthKey(m), i = keys.indexOf(key), price = n(t.TradePrice);
    const around = keys.slice(Math.max(0, i - 2), i + 3).map(k => priceAt(k, t.Symbol)).filter(p => p > 0);
    const lo = Math.min(price, ...around), hi = Math.max(price, ...around), now = nowPrice(t.Symbol);
    return { date: dayOf(t.TradeDate), symbol: t.Symbol, price, amount: Math.abs(inUSD(t, 'Proceeds')), belowHigh: dropBefore[key] < -0.05,
      position: around.length && hi > lo ? (price - lo) / (hi - lo) * 100 : null, change: now && price ? (now / price - 1) * 100 : null };
  }));
  const weighted = (list, f) => { const w = sum(list, b => b.amount); return w ? sum(list, b => f(b) * b.amount) / w : null; };
  const placed = buys.filter(b => b.position !== null), held = buys.filter(b => b.change !== null);
  const bySym = {};
  for (const b of buys) (bySym[b.symbol] = bySym[b.symbol] || []).push(b);
  const buyingLow = { count: buys.length, amount: sum(buys, b => b.amount),
    belowHighPct: buys.length ? sum(buys.filter(b => b.belowHigh), b => b.amount) / Math.max(1, sum(buys, b => b.amount)) * 100 : null,
    position: weighted(placed, b => b.position), placed: placed.length, change: weighted(held, b => b.change), held: held.length,
    perSymbol: Object.entries(bySym).map(([symbol, bs]) => { const p = bs.filter(b => b.position !== null), h = bs.filter(b => b.change !== null);
      return { symbol, buys: bs.length, amount: sum(bs, b => b.amount), belowHighPct: sum(bs.filter(b => b.belowHigh), b => b.amount) / Math.max(1, sum(bs, b => b.amount)) * 100,
        position: weighted(p, b => b.position), change: weighted(h, b => b.change) }; }).sort((a, b) => b.amount - a.amount) };

  // 4. Results per stock: realized from its sold lots, unrealized now, dividends
  const lots = soldLots(asc);
  const divRows = asc.flatMap(cashRows).filter(r => r.cat === 'dividends');
  const stocks = {};
  const stock = sym => stocks[sym] = stocks[sym] || { symbol: sym, realized: 0, lots: 0, wins: 0, days: [], unrealized: 0, dividends: 0, held: false };
  for (const l of lots) { const s = stock(l.symbol); s.realized += l.pnl; s.lots++; if (l.pnl > 0) s.wins++; s.days.push(l.days); }
  for (const r of divRows) stock(r.symbol).dividends += r.net;
  for (const p of newest.positions) { const s = stock(p.Symbol); s.unrealized = inUSD(p, 'FifoPnlUnrealized'); s.held = true; }
  const perStock = Object.values(stocks).map(s => ({ ...s, total: s.realized + s.unrealized + s.dividends, winRate: s.lots ? s.wins / s.lots * 100 : null, medianDays: s.days.length ? median(s.days) : null }))
    .sort((a, b) => b.total - a.total);

  // 5. Currency conversions: each ₪ → $ conversion vs the official daily rates in the 45 days before and after it
  // (Bank of Israel). Without them, the month-end rates from IBKR are used (a rough comparison).
  const toUSD = asc.flatMap(m => m.conversions.filter(c => c.fromCur === 'ILS' && c.toCur === 'USD').map(c => ({ ...c, date: c.date || monthKey(m) })));
  const toILS = asc.flatMap(m => m.conversions.filter(c => c.fromCur === 'USD' && c.toCur === 'ILS'));
  const usdBought = sum(toUSD, c => c.toAmt), ilsPaid = sum(toUSD, c => c.fromAmt), avgRate = usdBought ? ilsPaid / usdBought : 0;
  const rateDays = rates ? Object.keys(rates).sort() : [];
  const rateNow = rateDays.length ? rates[rateDays[rateDays.length - 1]] : monthRate(months.find(m => monthRate(m)) || newest) || 0;
  const monthEndRates = all.map(m => ({ day: dayOf(m.toDate), rate: monthRate(m) })).filter(x => x.rate);
  const conversions = toUSD.map(c => {
    const day = c.date.length === 7 ? c.date + '-15' : dayOf(c.date), rate = c.rate || c.fromAmt / c.toAmt;
    const from = shiftDay(day, -45), to = shiftDay(day, 45);
    const daily = rateDays.filter(d => d >= from && d <= to).map(d => ({ day: d, rate: rates[d] }));
    const window = daily.length >= 10 ? daily : monthEndRates.filter(x => x.day >= from && x.day <= to);
    return { date: c.date, day, ils: c.fromAmt, usd: c.toAmt, rate, note: c.note, window, rough: daily.length < 10,
      cheaperThan: window.length ? window.filter(x => x.rate > rate).length / window.length * 100 : null,
      low: window.length ? Math.min(...window.map(x => x.rate)) : null, high: window.length ? Math.max(...window.map(x => x.rate)) : null,
      vsAvgILS: (avgRate - rate) * c.toAmt, vsNowILS: (rateNow - rate) * c.toAmt };
  });
  const graded = conversions.filter(c => c.cheaperThan !== null);
  const currency = { conversions, rateNow, avgRate, usdBought, ilsPaid, netUSD: usdBought - sum(toILS, c => c.fromAmt),
    cheaperThan: graded.length ? sum(graded, c => c.cheaperThan * c.usd) / sum(graded, c => c.usd) : null, rough: conversions.some(c => c.rough), daily: !!rateDays.length };
  currency.fxEffectILS = currency.netUSD * (rateNow - avgRate);

  // 6. Costs & cash: taxes and fees vs what you earned, commission per trade earlier vs the last 12 months, idle cash, dividends
  const execs = asc.flatMap(stockTrades);
  const commEra = e => { const ts = execs.filter(t => inEra(t.TradeDate, e, recentStart)), vol = sum(ts, t => Math.abs(inUSD(t, 'Proceeds'))), c = sum(ts, commissionOf);
    return { trades: ts.length, pct: vol ? c / vol * 100 : null, perTrade: ts.length ? c / ts.length : null }; };
  const costs = { israelTax: -sum(asc, m => m.feesUSD), usTax: -sum(asc, m => m.withholdingTax), commissions: -sum(asc, m => m.commissions) };
  costs.total = costs.israelTax + costs.usTax + costs.commissions;
  const perStockDiv = {};
  for (const r of divRows) { const s = perStockDiv[r.symbol] = perStockDiv[r.symbol] || { symbol: r.symbol, gross: 0, tax: 0 }; s.gross += r.in ? r.in.amount : 0; s.tax += r.out ? r.out.amount : 0; }
  const cash = { costs, costShare: money.profit + costs.total > 0 ? costs.total / (money.profit + costs.total) * 100 : null,
    commThen: commEra('then'), commNow: commEra('now'),
    idle: asc.map(m => ({ key: monthKey(m), pct: m.endValue ? m.endingCash / m.endValue * 100 : 0 })),
    dividendsPerStock: Object.values(perStockDiv).map(s => ({ ...s, net: s.gross + s.tax, taxRate: s.gross ? -s.tax / s.gross * 100 : 0 })).sort((a, b) => b.net - a.net) };
  cash.idleAvg = avg(cash.idle.map(x => x.pct));

  // 7. Then vs now: the same measures before and within the last 12 months
  const side = e => {
    const ms = asc.filter(m => inEra(monthKey(m), e, recentStart)), ls = lots.filter(l => inEra(l.sold, e, recentStart)), ts = execs.filter(t => inEra(t.TradeDate, e, recentStart));
    const wins = ls.filter(l => l.pnl > 0), losses = ls.filter(l => l.pnl < 0);
    return { months: ms.length, avgReturn: ms.length ? avg(ms.map(m => m.twr)) : null, maxDrop: ms.length ? maxDrawdown(ms) : null,
      tradesPerMonth: ms.length ? ts.length / ms.length : null, medianDays: ls.length ? median(ls.map(l => l.days)) : null,
      winRate: wins.length + losses.length ? wins.length / (wins.length + losses.length) * 100 : null,
      avgWin: wins.length ? avg(wins.map(l => l.pnl)) : null, avgLoss: losses.length ? avg(losses.map(l => l.pnl)) : null,
      realized: sum(ls, l => l.pnl), commPct: commEra(e).pct, commPerTrade: commEra(e).perTrade };
  };
  const thenVsNow = { then: side('then'), now: side('now') };

  return { recentStart, money, drawdowns, buyingLow, perStock, currency, cash, thenVsNow };
}

if (typeof module !== 'undefined') module.exports = { CAPITAL_GAINS_TAX, monthGain, realizedGainOf, flexTotals, portfolioMath, stockTrades, dmy, ACTIVITY_CATEGORIES, cashRows, activityRows, activityType, activityWords, activityCash, insights, ERAS };
