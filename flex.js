// ============================================================
// flex.js — Download statements from IBKR (Flex Web Service)
// ============================================================
// Instead of exporting a CSV by hand, the app asks IBKR for your
// saved Flex Query ("Last Month Activity Report") and gets it back
// as a CSV file.
//
// The token and query ID come from your private .env file outside the
// project (its location is set in paths.json, loaded by paths.js). They are only ever sent to IBKR and are
// NEVER printed, logged or included in error messages (the request
// address contains the token, so it's never shown either).
//
// How the download works (two steps):
//   1. SendRequest  → IBKR starts building the report, gives a reference code
//   2. GetStatement → we ask for the report with that code, retrying
//                     while IBKR says "still generating"
// ============================================================

const { parseCSVLine } = require('./parser');

// ILS deposits under ₪500 are promos (e.g. "bring a friend"), not real deposits. Also used by server.js for the CSV import.
const MIN_REAL_DEPOSIT_ILS = 500;

const FLEX_BASE = 'https://ndcdyn.interactivebrokers.com/AccountManagement/FlexWebService';
const RETRIES   = 8;
const GAP_MS    = 6500;   // IBKR allows max 10 requests per minute per token: keep every call 6.5s apart
let lastCall    = 0;

function xmlTag(xml, tag) {
  const m = xml.match(new RegExp(`<${tag}>([^<]*)</${tag}>`));
  return m ? m[1].trim() : '';
}

function ibkrError(xml) {
  const code = xmlTag(xml, 'ErrorCode');
  const msg  = xmlTag(xml, 'ErrorMessage') || 'Unknown error';
  return new Error(`IBKR error ${code}: ${msg}`);
}

async function get(url) {
  const wait = lastCall + GAP_MS - Date.now();
  if (wait > 0) await new Promise(r => setTimeout(r, wait));
  lastCall = Date.now();
  let res;
  try {
    res = await fetch(url, { headers: { 'User-Agent': 'ibkr-statement-processor/1.0' }, redirect: 'error' });
  } catch (e) {
    // Never pass the original error on: it could contain the address (= the token)
    throw new Error('Could not reach IBKR. Check your internet connection.');
  }
  if (!res.ok) throw new Error(`IBKR answered with HTTP ${res.status}.`);
  return res.text();
}

// ============================================================
// fetchFlexStatement(range, shouldStop)
// Returns the statement as CSV text. Without a range IBKR uses the
// query's own period (Last Month). range = { fd, td } as yyyymmdd
// downloads that period instead (max 365 days).
// shouldStop() is checked while waiting for IBKR, so a Stop click
// doesn't have to wait for the whole report.
// ============================================================
async function fetchFlexStatement(range, shouldStop = () => false) {
  const token   = process.env.IBKR_FLEX_TOKEN;
  const queryId = process.env.IBKR_FLEX_QUERY_ID;
  if (!token || !queryId) {
    throw new Error('IBKR token or query ID not loaded. Close the app window and start it again with start-app.bat.');
  }

  const period = range ? `&fd=${range.fd}&td=${range.td}` : '';
  const sent = await get(`${FLEX_BASE}/SendRequest?t=${encodeURIComponent(token)}&q=${encodeURIComponent(queryId)}${period}&v=3`);
  if (xmlTag(sent, 'Status') !== 'Success') throw ibkrError(sent);
  const refCode = xmlTag(sent, 'ReferenceCode');
  const pollUrl = xmlTag(sent, 'Url');

  // Only ever send the token back to IBKR itself
  if (!/^https:\/\/[a-z0-9.-]+\.interactivebrokers\.com\//i.test(pollUrl)) {
    throw new Error('IBKR returned an unexpected download address. Download stopped for safety.');
  }

  for (let i = 0; i < RETRIES; i++) {
    if (shouldStop()) throw new Error('Stopped.');
    const body = await get(`${pollUrl}?t=${encodeURIComponent(token)}&q=${encodeURIComponent(refCode)}&v=3`);
    if (!body.trimStart().startsWith('<FlexStatementResponse')) return body;   // the report itself
    if (xmlTag(body, 'ErrorCode') !== '1019') throw ibkrError(body);          // 1019 = still generating
  }
  throw new Error('IBKR is still generating the report. Try again in a minute.');
}

// ============================================================
// monthRange(year, month, upTo)
// First and last weekday of a month as yyyymmdd (IBKR has no data
// for weekends, so a range starting/ending on one is moved inward).
// upTo cuts the month short, e.g. yesterday for the month in progress
// (IBKR has no data for today yet). Returns null if no weekday is left.
// ============================================================
function monthRange(year, month, upTo) {
  const ymd = d => d.toISOString().slice(0, 10).replace(/-/g, '');
  const first = new Date(Date.UTC(year, month - 1, 1));
  let last = new Date(Date.UTC(year, month, 0));
  if (upTo && upTo < last) last = new Date(upTo);
  while ([0, 6].includes(first.getUTCDay())) first.setUTCDate(first.getUTCDate() + 1);
  while ([0, 6].includes(last.getUTCDay()))  last.setUTCDate(last.getUTCDate() - 1);
  return first <= last ? { fd: ymd(first), td: ymd(last) } : null;
}

// ============================================================
// parseFlexCSV(text)
// Flex CSV lines start with a record type and a section code:
//   BOS,<code>,<section name>,...  → a section begins
//   HEADER,<code>,<column names>   → that section's columns
//   DATA,<code>,<values>           → one row
// Returns { fromDate, toDate, sections: [{ code, name, headers, rows }] }
// ============================================================
function parseFlexCSV(text) {
  const sections = new Map();
  const section = code => {
    if (!sections.has(code)) sections.set(code, { code, name: code, headers: [], rows: [] });
    return sections.get(code);
  };

  for (const raw of text.split(/\r?\n/)) {
    if (!raw.trim()) continue;
    const line = parseCSVLine(raw);
    const [type, code] = line;
    if (type === 'BOS' && line[2]) section(code).name = line[2];
    else if (type === 'HEADER') section(code).headers = line.slice(2);
    else if (type === 'DATA')   section(code).rows.push(line.slice(2));
  }

  const list = [...sections.values()];
  if (!list.length) throw new Error('The IBKR file has an unexpected format (no sections found).');

  // The period comes from any section that has From/To date columns (e.g. Cash Report)
  let fromDate = '', toDate = '';
  for (const s of list) {
    const fi = s.headers.indexOf('FromDate'), ti = s.headers.indexOf('ToDate');
    if (fi >= 0 && s.rows.length) { fromDate = s.rows[0][fi]; toDate = s.rows[0][ti] || ''; break; }
  }
  return { fromDate, toDate, sections: list };
}

// ============================================================
// summarizeFlex(parsed)
// Turns one downloaded report into one month of numbers, reading
// every value by its IBKR field name (not by column position).
// Note: with "Realized & Unrealized", IBKR leaves the Change in NAV
// breakdown at 0, so only its start/end value and TWR are used here;
// the rest comes from the Cash Report, Performance Summary etc.
// ============================================================
function summarizeFlex(parsed) {
  const rowsOf = code => {
    const s = parsed.sections.find(x => x.code === code);
    return s ? s.rows.map(r => Object.fromEntries(s.headers.map((h, i) => [h, r[i]]))) : [];
  };
  const num = v => Number(v) || 0;

  const nav  = rowsOf('CNAV')[0] || {};
  const cash = rowsOf('CRTT').find(r => r.LevelOfDetail === 'BaseCurrency') || {};
  const perf = rowsOf('FIFO');
  const positions = rowsOf('POST');
  const [year, month] = (parsed.fromDate || '').split('-').map(Number);
  const cashTx = rowsOf('CTRN'), trades = rowsOf('TRNT');
  const cashByCur = rowsOf('CRTT').filter(r => r.LevelOfDetail !== 'BaseCurrency');
  const curOf = r => r.CurrencyPrimary || r.Currency || '';

  // Deposits/withdrawals per currency. ILS deposits under 500 are promos (same rule as the CSV import).
  const moves = { depositsUSD: 0, depositsILS: 0, withdrawalsUSD: 0, withdrawalsILS: 0 };
  for (const t of cashTx.filter(t => t.Type === 'Deposits/Withdrawals')) {
    const amt = num(t.Amount), cur = curOf(t);
    if (cur === 'ILS' && amt > 0 && amt < MIN_REAL_DEPOSIT_ILS) continue;
    const key = (amt > 0 ? 'deposits' : 'withdrawals') + (cur === 'ILS' ? 'ILS' : 'USD');
    moves[key] += cur === 'ILS' || cur === 'USD' ? amt : amt * num(t.FXRateToBase);
  }

  // Fees (the Israel tax is charged in ILS): ILS amount, and everything in USD
  const fees = cashTx.filter(t => t.Type === 'Other Fees');
  const feesILS = fees.filter(t => curOf(t) === 'ILS').reduce((a, t) => a + num(t.Amount), 0);
  const feesUSD = fees.reduce((a, t) => a + num(t.Amount) * (num(t.FXRateToBase) || 1), 0);

  // Currency conversions = forex trades, e.g. USD.ILS: BUY = ILS → USD, SELL = USD → ILS.
  // Proceeds of 5 or less are IBKR rounding leftovers (same rule as the CSV import).
  const conversions = trades.filter(t => t.AssetClass === 'CASH' && Math.abs(num(t.Proceeds)) > 5).map(t => {
    const [base, quote] = t.Symbol.split('.');
    const qty = Math.abs(num(t.Quantity)), proc = Math.abs(num(t.Proceeds));
    return t['Buy/Sell'] === 'BUY'
      ? { fromCur: quote, fromAmt: proc, toCur: base, toAmt: qty, rate: num(t.TradePrice), date: t.TradeDate }
      : { fromCur: base, fromAmt: qty, toCur: quote, toAmt: proc, rate: num(t.TradePrice), date: t.TradeDate };
  });
  const endingCashOf = cur => num((cashByCur.find(r => curOf(r) === cur) || {}).EndingCash);

  return {
    year, month, fromDate: parsed.fromDate, toDate: parsed.toDate,
    partial: parsed.toDate.replace(/-/g, '') < monthRange(year, month).td,   // month still in progress
    startValue:  num(nav.StartingValue),
    endValue:    num(nav.EndingValue),
    twr:         num(nav.TWR),                       // percent
    deposits:    num(cash.Deposits),
    withdrawals: num(cash.Withdrawals),
    dividends:   num(cash.Dividends),
    withholdingTax: num(cash.WithholdingTax),
    commissions: num(cash.Commissions),
    endingCash:  num(cash.EndingCash),
    hasCashCurrency: cashByCur.some(curOf),
    endingCashUSD: endingCashOf('USD'),
    endingCashILS: endingCashOf('ILS'),
    ...moves, feesILS, feesUSD, conversions,
    realizedPL:   perf.reduce((a, r) => a + num(r.TotalRealizedPnl), 0),
    unrealizedPL: perf.reduce((a, r) => a + num(r.TotalUnrealizedPnl), 0),
    invested:     positions.reduce((a, r) => a + num(r.PositionValue) * (num(r.FXRateToBase) || 1), 0),
    positions, trades, cashTx,
    corpActions: rowsOf('CORP'),
  };
}

module.exports = { fetchFlexStatement, parseFlexCSV, summarizeFlex, monthRange, MIN_REAL_DEPOSIT_ILS };
