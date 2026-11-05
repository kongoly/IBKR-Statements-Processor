// ============================================================
// sheets.js — Google Sheets push
// Copies the Portfolio page, the Financial Summary (API) table,
// the Activity page and the Insights page to your Google Sheet, one tab each,
// rewriting those tabs on every push (other tabs are left alone).
// The tabs are laid out to look like the app: a dark title bar,
// soft off-white cards on a grey page, big numbers, no gridlines, and as
// wide as a laptop screen so they fill across before going down.
// Signs in with a Google service account whose key file lives
// outside the repo; the key is only sent to Google's sign-in and
// is never logged or put in error messages.
// ============================================================
const fs     = require('fs');
const path   = require('path');
const crypto = require('crypto');
const { flexTotals, portfolioMath, monthGain, realizedGainOf, dmy, ACTIVITY_CATEGORIES, activityRows, activityType, activityWords, activityCash, insights, ERAS } = require('./public/calc');

const { googleKeyFile: KEY_FILE } = require('./paths');
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

// ============================================================
// Signing in: a JWT signed with the service account key is
// exchanged for an access token (valid one hour, reused until then).
// ============================================================
let token = null, accountEmail = '';
async function accessToken() {
  if (token && token.expires > Date.now() + 60000) return token.value;
  if (!fs.existsSync(KEY_FILE)) throw new Error('the Google key file was not found at the path set as googleKeyFile in paths.json.');
  const key = JSON.parse(fs.readFileSync(KEY_FILE, 'utf8'));
  accountEmail = key.client_email;
  const b64 = o => Buffer.from(JSON.stringify(o)).toString('base64url');
  const now = Math.floor(Date.now() / 1000);
  const unsigned = b64({ alg: 'RS256', typ: 'JWT' }) + '.' +
    b64({ iss: key.client_email, scope: 'https://www.googleapis.com/auth/spreadsheets', aud: TOKEN_URL, iat: now, exp: now + 3600 });
  const jwt = unsigned + '.' + crypto.sign('RSA-SHA256', Buffer.from(unsigned), key.private_key).toString('base64url');
  const r = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: jwt }),
  });
  const j = await r.json();
  if (!j.access_token) throw new Error('Google sign-in failed: ' + (j.error_description || j.error || r.status));
  token = { value: j.access_token, expires: Date.now() + j.expires_in * 1000 };
  return token.value;
}

// One call to the Sheets API for the user's spreadsheet, with plain-English errors for the usual setup mistakes
async function api(method, suffix, body) {
  const r = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${process.env.GOOGLE_SHEET_ID}${suffix}`, {
    method,
    headers: { Authorization: 'Bearer ' + await accessToken(), 'Content-Type': 'application/json' },
    body: body && JSON.stringify(body),
  });
  const j = await r.json();
  if (r.status === 403) throw new Error(`the Sheet isn't shared with ${accountEmail}. In the Sheet, click Share and add that address as Editor.`);
  if (r.status === 404) throw new Error('no Sheet found with that ID. Check GOOGLE_SHEET_ID in your .env file.');
  if (!r.ok) throw new Error(j.error?.message || `Google answered ${r.status}`);
  return j;
}

// ============================================================
// Look: the app's soft light theme colors (style.css, no pure white).
// Same meanings: green = in/profit/USD, red = out/loss, blue = ILS.
// A color is a name from COLOR or a hex value.
// ============================================================
const FONT = 'Roboto';
const COLOR = {
  text: '#1f2533', heading: '#2a3342', muted: '#6b7789', faint: '#a0aec0',
  pos: '#2f855a', neg: '#c53030', usd: '#2f855a', ils: '#2b6cb0',
  page: '#e6e9ee', card: '#f6f7f9', line: '#dfe4ea', strong: '#c2cbd7', soft: '#eff2f5', head: '#e3e8ef',
  banner: '#1a1a2e', bannerText: '#ffffff', bannerMuted: '#a0aec0',
  usdLane: '#e9f1ec', ilsLane: '#e8eef5', alt: '#edf0f4',
};
// Year colors (same as the app's year blocks), category hues (Activity) and column-group hues (Financial Summary)
const YEAR_COLOR = ['#2b6cb0', '#805ad5', '#2c7a7b', '#c05621', '#b83280'];
const CAT_HUE = { dividends: 172, deposits: 196, trades: 214, conversions: 236, israelTax: 258, withdrawals: 286 };
const GROUP_HUE = { 'Account value': 200, 'Money in / out': 218, 'Realized profit, income & costs': 236, 'Holdings at month end': 254 };
const hsl = (h, s, l) => {
  s /= 100; l /= 100;
  const a = s * Math.min(l, 1 - l), k = n => (n + h / 30) % 12;
  const f = n => Math.round(255 * (l - a * Math.max(-1, Math.min(k(n) - 3, 9 - k(n), 1)))).toString(16).padStart(2, '0');
  return '#' + f(0) + f(8) + f(4);
};
// A light tint: p of the color mixed into the card color
const mix = (hex, p, base = COLOR.card) => '#' + [1, 3, 5].map(i => Math.round(parseInt(hex.slice(i, i + 2), 16) * p + parseInt(base.slice(i, i + 2), 16) * (1 - p)).toString(16).padStart(2, '0')).join('');
const catColor = cat => CAT_HUE[cat] ? hsl(CAT_HUE[cat], 35, 36) : COLOR.muted;
const FMT = {
  USD: '"$"#,##0.00;-"$"#,##0.00',
  ILS: '"₪"#,##0.00;-"₪"#,##0.00',
  pct: '+0.00%;-0.00%;0.00%',
  share: '0.00%',
  num: '#,##0.####',
};
const paint = c => rgb(COLOR[c] || c);
const rgb = hex => ({ red: parseInt(hex.slice(1, 3), 16) / 255, green: parseInt(hex.slice(3, 5), 16) / 255, blue: parseInt(hex.slice(5, 7), 16) / 255 });
const num = v => Number(v) || 0;
const day = v => String(v || '').split(';')[0];
const sentAt = () => new Date().toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' });

// Text versions of amounts (for cells with more than one line), formatted like money() in app.js
const sym = cur => cur === 'ILS' ? '₪' : cur === 'USD' ? '$' : cur + ' ';
const amt = (n, cur = 'USD') => (n < 0 ? '-' : '') + sym(cur) + Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const pctText = n => (n > 0 ? '+' : '') + n.toFixed(2) + '%';
const sign = n => n > 0 ? 'pos' : n < 0 ? 'neg' : 'text';
const curColor = cur => cur === 'ILS' ? 'ils' : 'usd';

// ============================================================
// Cells. A cell is a plain value or an object:
//   { v | runs | formula, fmt, color, bold, size, align, valign, wrap }
// runs = lines of differently styled text: [{ t, color, bold, size, inline }]
// (each run starts a new line unless inline).
// ============================================================
const money = (n, cur = 'USD', o) => ({ v: n, fmt: cur === 'ILS' ? 'ILS' : 'USD', color: curColor(cur), ...o });
const plain = (n, cur = 'USD', o) => ({ v: n, fmt: cur === 'ILS' ? 'ILS' : 'USD', ...o });
const pl = (n, cur = 'USD', o) => ({ v: n, fmt: cur === 'ILS' ? 'ILS' : 'USD', color: sign(n), ...o });
const pct = (n, o) => ({ v: n / 100, fmt: 'pct', color: sign(n), ...o });
const text = (v, o) => ({ v, ...o });
const rich = (o, ...runs) => ({ runs: runs.filter(r => r && r.t), wrap: true, ...o });
const DASH = { v: '—', color: 'faint' };

function cellData(c, bg, pad) {
  c = c == null || c === '' ? {} : typeof c === 'object' ? c : { v: c };
  const format = {
    textFormat: { fontFamily: FONT, fontSize: c.size || 10, bold: !!c.bold, foregroundColor: paint(c.color || 'text') },
    backgroundColor: paint(bg),
    horizontalAlignment: c.align || 'CENTER',
    verticalAlignment: c.valign || 'MIDDLE',
    padding: { top: 2, bottom: 2, left: pad, right: pad },
  };
  if (c.fmt) format.numberFormat = { type: 'NUMBER', pattern: FMT[c.fmt] };
  if (c.wrap) format.wrapStrategy = 'WRAP';
  const d = { userEnteredFormat: format };
  if (c.runs) {
    let s = '';
    d.textFormatRuns = c.runs.map((r, i) => {
      if (i && !r.inline) s += '\n';
      const run = { startIndex: s.length, format: { foregroundColor: paint(r.color || c.color || 'text'), bold: !!(r.bold ?? c.bold), fontSize: r.size || c.size || 10 } };
      s += r.t;
      return run;
    });
    d.userEnteredValue = { stringValue: s };
  } else if (c.formula) d.userEnteredValue = { formulaValue: c.formula };
  else if (c.v != null) d.userEnteredValue = typeof c.v === 'number' ? { numberValue: c.v } : { stringValue: String(c.v) };
  return d;
}

// ============================================================
// A tab as a little canvas: column widths, cells (with merges),
// painted backgrounds, boxes (borders) and row heights.
// ============================================================
function canvas(title, widths) {
  const s = { title, widths, cells: [], bg: [], merges: [], borders: [], heights: [], freezeRows: 0, pad: 8 };
  s.put = (r, c, cell, rs = 1, cs = 1) => {
    (s.cells[r] = s.cells[r] || [])[c] = cell;
    if (rs > 1 || cs > 1) s.merges.push([r, c, rs, cs]);
  };
  s.paint = (r, c, rs, cs, color) => {
    for (let i = r; i < r + rs; i++) for (let j = c; j < c + cs; j++) (s.bg[i] = s.bg[i] || [])[j] = color;
  };
  // A card: filled box with a border. sides = which edges get a line (default all four).
// Borders apply in order, so a later one draws over an earlier one.
  s.box = (r, c, rs, cs, { fill = 'card', line = 'strong', sides = ['top', 'bottom', 'left', 'right'], style = 'SOLID', inner } = {}) => {
    if (fill) s.paint(r, c, rs, cs, fill);
    s.borders.push({ r, c, rs, cs, line, sides, style, inner });
  };
  s.height = (r, px) => { s.heights[r] = px; };
  return s;
}

// Dark title bar across the top (like the app header), then a little space
function banner(s, title, note) {
  const n = s.widths.length, left = Math.ceil((n - 2) / 2);
  s.paint(0, 0, 1, n, 'banner');
  s.put(0, 1, text(title, { size: 16, bold: true, color: 'bannerText', align: 'LEFT' }), 1, left);
  s.put(0, 1 + left, text(note, { size: 10, color: 'bannerMuted', align: 'RIGHT' }), 1, n - 2 - left);
  s.height(0, 56);
  s.height(1, 16);
  return 2;
}

const LABEL = { size: 9, bold: true, color: 'muted', align: 'LEFT' };

// ============================================================
// Portfolio tab: the Portfolio page. Grid of four 2-column blocks
// with thin gaps: 4 headline tiles, the money journey, "Account
// now" + "Totals" side by side, then Current Portfolio.
// ============================================================
const P_COLS = [16, 146, 146, 14, 146, 146, 14, 146, 146, 14, 146, 146, 16];
function portfolioTab(nw, months) {
  const rate = Number(nw.fxRate.toFixed(4)), bank = nw.bankILS || 0;   // 4 decimals, like the rate box on the Portfolio page
  const t = flexTotals(months), p = portfolioMath(nw, rate, bank), latest = months[0];
  const s = canvas('Portfolio', P_COLS);
  let r = banner(s, '💼 Portfolio', `IBKR data: ${nw.statement} · sent ${sentAt()}`);

  // Headline tiles
  const SMALL = { size: 10, color: 'muted', align: 'LEFT', valign: 'TOP' };
  const BIG = { size: 22, bold: true, align: 'LEFT' };
  const tile = (c, label, value, small) => {
    s.box(r, c, 3, 2);
    s.put(r, c, text(label, { ...LABEL, valign: 'BOTTOM' }), 1, 2);
    s.put(r + 1, c, value, 1, 2);
    s.put(r + 2, c, small, 1, 2);
  };
  tile(1, 'NET WORTH', money(p.netWorthILS, 'ILS', BIG),
    rich(SMALL, { t: amt(p.netWorthILS / rate), color: 'usd' }, { t: ' · after tax' + (bank ? ', incl. bank' : ''), inline: true }));
  tile(4, 'PROFIT IN ₪', pl(p.profitILS, 'ILS', BIG),
    rich(SMALL, p.profitPct != null && { t: pctText(p.profitPct), color: sign(p.profitPct) }, { t: ' · after tax', inline: true }));
  tile(7, 'TIME-WEIGHTED RETURN', pct(t.twrPct, BIG),
    rich(SMALL, { t: 'Actual return ' }, { t: pctText(t.returnPct), color: sign(t.returnPct), bold: true, inline: true }));
  tile(10, 'MONEY PUT IN', money(p.inILS, 'ILS', BIG),
    rich(SMALL, { t: `USD/ILS ${rate.toFixed(4)}` + (nw.fxDate ? ` · IBKR ${nw.fxDate}` : '') }));
  s.height(r, 30); s.height(r + 1, 48); s.height(r + 2, 30);
  r += 3; s.height(r++, 16);

  // If you sold everything today: ₪ put in → dollars lane / shekels lane → ₪ you'd have
  if (nw.putInILS != null) {
    const j = r;
    s.box(j, 1, 10, 11);
    s.put(j, 1, text('IF YOU SOLD EVERYTHING TODAY', LABEL), 1, 11);
    s.height(j, 36);
    const node = (row, c, label, value, sub) => {
      s.box(row, c, 3, 1);
      s.put(row, c, text(label, { size: 9, bold: true, color: 'muted', valign: 'BOTTOM' }));
      s.put(row + 1, c, value);
      s.put(row + 2, c, sub || '');
      s.height(row, 24); s.height(row + 1, 30); s.height(row + 2, 22);
    };
    const V = { size: 13, bold: true };
    const SUB = { size: 9, color: 'muted', valign: 'TOP' };
    // Lanes span columns 4–8
    s.paint(j + 1, 4, 4, 5, 'usdLane'); s.paint(j + 5, 4, 4, 5, 'ilsLane');
    s.put(j + 1, 4, text('DOLLARS', { size: 9, bold: true, color: 'usd', align: 'LEFT' }), 1, 5);
    s.put(j + 5, 4, text('SHEKELS', { size: 9, bold: true, color: 'ils', align: 'LEFT' }), 1, 5);
    s.height(j + 1, 22); s.height(j + 5, 22);
    node(j + 2, 4, 'CONVERTED TO $', money(p.usdStart, 'USD', V), text(`at ${p.buyRate.toFixed(2)}`, SUB));
    node(j + 2, 5, 'GREW TO', money(p.dollars, 'USD', V),
      p.usdStart ? rich(SUB, { t: pctText((p.dollars - p.usdStart) / p.usdStart * 100), color: sign(p.dollars - p.usdStart), bold: true }) : '');
    node(j + 2, 7, '25% TAX', pl(-p.taxUSD * rate, 'ILS', V), text(`(${amt(-p.taxUSD)})`, SUB));
    node(j + 2, 8, 'BACK TO ₪', money(p.afterTax * rate, 'ILS', V),
      rich(SUB, { t: `at ${rate.toFixed(2)} ` }, p.buyRate && { t: pctText((rate - p.buyRate) / p.buyRate * 100), color: sign(rate - p.buyRate), bold: true, inline: true }));
    node(j + 6, 4, 'KEPT AS ₪', money(p.ilsKept, 'ILS', V));
    node(j + 6, 5, 'ISRAEL TAX & FEES', pl(p.feesILS, 'ILS', V));
    node(j + 6, 7, '₪ CASH NOW', money(nw.cashILS, 'ILS', V));
    // Start and end blocks span both lanes
    s.box(j + 1, 1, 8, 2, { line: 'strong', style: 'SOLID_MEDIUM' });
    s.put(j + 1, 1, text('₪ PUT IN', { ...LABEL, align: 'CENTER', valign: 'BOTTOM' }), 4, 2);
    s.put(j + 5, 1, money(p.inILS, 'ILS', { size: 18, bold: true, valign: 'TOP' }), 4, 2);
    s.box(j + 1, 10, 8, 2, { line: 'pos', style: 'SOLID_MEDIUM' });
    s.put(j + 1, 10, text("₪ YOU'D HAVE", { ...LABEL, align: 'CENTER', valign: 'BOTTOM' }), 4, 2);
    s.put(j + 5, 10, rich({ valign: 'TOP' }, { t: amt(p.haveILS, 'ILS'), color: 'ils', bold: true, size: 18 },
      { t: amt(p.profitILS, 'ILS'), color: sign(p.profitILS), bold: true, size: 11 },
      p.profitPct != null && { t: ' · ' + pctText(p.profitPct), color: sign(p.profitILS), bold: true, size: 11, inline: true }), 4, 2);
    s.put(j + 1, 3, text('→', { size: 16, color: 'muted' }), 8, 1);
    s.put(j + 1, 9, text('→', { size: 16, color: 'muted' }), 8, 1);
    s.height(j + 9, 12);
    r = j + 10; s.height(r++, 16);
  }

  // Account now (left) and Totals (right), one line per row
  const R = { align: 'RIGHT', size: 11 };
  const stack = (u, i) => rich({ size: 11 }, { t: amt(u), color: 'usd' }, { t: amt(i, 'ILS'), color: 'ils' });
  const pair = (u, i, neg) => rich(R, u && { t: amt(u), color: neg ? 'neg' : 'usd' }, u && i && { t: ' · ', color: 'muted', inline: true }, i && { t: amt(i, 'ILS'), color: neg ? 'neg' : 'ils', inline: true });
  const account = [
    ['Cash', pair(nw.cashUSD, nw.cashILS)],
    ['Invested', plain(nw.investedUSD, 'USD', { ...R, bold: true })],
    ['Unrealized P/L', pl(nw.unrealizedPL, 'USD', R)],
    // Israeli tax is paid in shekels: ₪ first, $ in brackets
    ['Tax if sold (25%)', rich(R, { t: amt(-p.taxUSD * rate, 'ILS'), color: 'neg', bold: true }, { t: `(${amt(-p.taxUSD)})`, color: 'muted', size: 9 })],
  ];
  const breakdown = [['Realized P/L', t.realizedPL], ['Dividends', t.dividends], ['US WHT', t.withholdingTax], ['Israel tax & fees', t.feesUSD, t.feesILS]];
  const max = Math.max(...breakdown.map(b => Math.abs(b[1])), 1);
  const totals = [
    ['Deposits', pair(t.depositsUSD, t.depositsILS)],
    ...(t.withdrawalsUSD || t.withdrawalsILS ? [['Withdrawals', pair(t.withdrawalsUSD, t.withdrawalsILS, true)]] : []),
    ...t.conversions.map(c => ['Conversions', rich(R, { t: amt(c.fromAmt, c.fromCur), color: curColor(c.fromCur) }, { t: ' → ', color: 'muted', inline: true },
      { t: amt(c.toAmt, c.toCur), color: curColor(c.toCur), inline: true }, { t: `  avg ${c.rate.toFixed(4)}`, color: 'muted', size: 9, inline: true })]),
    ['Realized gain', pl(t.realizedGain, 'USD', { ...R, size: 14, bold: true }), null, true],
    ...breakdown.map(([label, n, ils]) => [label, ils ? pl(ils, 'ILS', R) : pl(n, 'USD', R),
      { formula: `=SPARKLINE(${Math.abs(n)},{"charttype","bar";"max",${max};"color1","${n >= 0 ? COLOR.pos : COLOR.neg}"})` }]),
  ];
  const lines = Math.max(account.length, totals.length);
  const card = (c, title, list) => {
    s.box(r, c, lines + 1, 5);
    s.put(r, c, text(title, LABEL), 1, 5);
    list.forEach(([label, value, bar, big], i) => {
      const row = r + 1 + i;
      s.put(row, c, text(label, { size: big ? 13 : 11, bold: !!big, align: 'LEFT' }), 1, bar ? 1 : 2);
      if (bar) s.put(row, c + 1, bar, 1, 2);
      s.put(row, c + 3, value, 1, 2);
      s.borders.push({ r: row, c, rs: 1, cs: 5, line: 'line', sides: ['top'], style: 'SOLID' });
    });
  };
  card(1, 'ACCOUNT NOW', account);
  card(7, `TOTALS SINCE ${MONTHS[t.oldest.month - 1].toUpperCase()} ${t.oldest.year}`, totals);
  s.height(r, 36);
  for (let i = 1; i <= lines; i++) s.height(r + i, 34);
  r += lines + 1; s.height(r++, 16);

  // Current Portfolio: positions + cash, % of the whole account
  const toUSD = (q, k) => num(q[k]) * (num(q.FXRateToBase) || 1);
  const total = latest.invested + latest.endingCash;
  const share = usd => ({ v: total ? usd / total : 0, fmt: 'share', size: 11 });
  const pos = latest.positions.slice().sort((a, b) => toUSD(b, 'PositionValue') - toUSD(a, 'PositionValue'));
  const COLS = [[1, 'Symbol'], [2, 'Name'], [4, 'Quantity'], [5, 'Avg cost'], [7, 'Price'], [8, 'Value'], [10, 'Unrealized P/L'], [11, '% of account']];
  const rows = [
    ...pos.map(q => [text(q.Symbol, { bold: true, size: 11 }), text(q.Description || '', { size: 9, color: 'muted', wrap: true }),
      { v: num(q.Quantity), fmt: 'num', size: 11 }, plain(num(q.CostBasisPrice), q.CurrencyPrimary, { size: 11 }), plain(num(q.MarkPrice), q.CurrencyPrimary, { size: 11 }),
      plain(num(q.PositionValue), q.CurrencyPrimary, { size: 11, bold: true }), pl(num(q.FifoPnlUnrealized), q.CurrencyPrimary, { size: 11 }), share(toUSD(q, 'PositionValue'))]),
    [text('Cash', { bold: true, size: 11 }), latest.hasCashCurrency ? text(`in USD: ${amt(latest.endingCash)}`, { size: 9, color: 'muted' }) : '', '', '', '',
      latest.hasCashCurrency ? stack(latest.endingCashUSD, latest.endingCashILS) : plain(latest.endingCash, 'USD', { size: 11 }), DASH, share(latest.endingCash)],
  ];
  s.box(r, 1, rows.length + 3, 11);
  s.put(r, 1, rich({ ...LABEL, valign: 'MIDDLE' }, { t: '📂 CURRENT PORTFOLIO' }, { t: `  from IBKR, as of ${latest.toDate}`, bold: false, inline: true }), 1, 11);
  s.height(r, 36);
  s.paint(r + 1, 1, 1, 11, 'soft');
  COLS.forEach(([c, h]) => s.put(r + 1, c, text(h, { size: 9, bold: true, color: 'muted' }), 1, c === 2 ? 2 : 1));
  s.height(r + 1, 30);
  rows.forEach((row, i) => {
    row.forEach((cell, k) => s.put(r + 2 + i, COLS[k][0], cell, 1, COLS[k][0] === 2 ? 2 : 1));
    s.height(r + 2 + i, 38);
    s.borders.push({ r: r + 2 + i, c: 1, rs: 1, cs: 11, line: 'line', sides: ['top'], style: 'SOLID' });
  });
  const tr = r + 2 + rows.length;
  s.paint(tr, 1, 1, 11, 'head');
  [text('Total', { bold: true, size: 11 }), text('invested + cash', { size: 9, color: 'muted' }), '', '', '',
    plain(total, 'USD', { size: 11, bold: true }), pl(pos.reduce((a, q) => a + toUSD(q, 'FifoPnlUnrealized'), 0), 'USD', { size: 11, bold: true }),
    { v: total ? 1 : 0, fmt: 'share', size: 11, bold: true }].forEach((cell, k) => s.put(tr, COLS[k][0], cell, 1, COLS[k][0] === 2 ? 2 : 1));
  s.height(tr, 38);
  s.borders.push({ r: tr, c: 1, rs: 1, cs: 11, line: 'strong', sides: ['top'], style: 'SOLID_MEDIUM' });
  r = tr + 1; s.height(r++, 16);

  s.put(r, 1, text(`Bank: ${amt(bank, 'ILS')}` + (nw.bankUpdated ? `, updated ${nw.bankUpdated.slice(0, 10)}` : '') + '. Tax = 25% of unrealized profit, a simple estimate.',
    { size: 9, color: 'muted', align: 'LEFT' }), 1, 11);
  s.height(r++, 26);
  s.freezeRows = 1;
  return s;
}

// ============================================================
// Financial Summary tab: the Financial Summary (API) table.
// Like the app, cells with two currencies show two lines, so the
// whole table fits a laptop screen without scrolling sideways.
// Columns that are empty in every month (e.g. withdrawals) are left out.
// ============================================================
function summaryTab(months) {
  const t = flexTotals(months);
  const S = 8;   // size of the small second lines
  const moved = (u, i, color) => u || i ? rich({ color }, u && { t: amt(u) }, i && { t: amt(i, 'ILS') }) : DASH;
  const conv = (list, rateLabel) => list.length ? rich({}, ...list.flatMap(c => [
    { t: amt(c.fromAmt, c.fromCur), color: curColor(c.fromCur), size: 9 }, { t: '→ ', color: 'muted', size: 9 },
    { t: amt(c.toAmt, c.toCur), color: curColor(c.toCur), size: 9, inline: true }, { t: `${rateLabel} ${c.rate.toFixed(4)}`, color: 'muted', size: S }])) : DASH;
  const cash = m => m.hasCashCurrency ? rich({}, { t: amt(m.endingCashUSD), color: 'usd', bold: true }, { t: amt(m.endingCashILS, 'ILS'), color: 'ils', bold: true }) : money(m.endingCash);
  const fees = (ils, usd) => ils ? rich({}, { t: amt(ils, 'ILS'), color: sign(usd) }, { t: amt(usd), color: sign(usd), size: S }) : pl(usd);
  const realized = (n, comm) => comm ? rich({}, { t: amt(n), color: sign(n) }, { t: 'comm. ' + amt(comm), color: 'muted', size: S }) : pl(n);
  // [group, header, width, month cell, TOTAL cell, used (omit = always shown)]
  const cols = [
    ['Account value', 'Start', 82, m => plain(m.startValue), () => rich({}, { t: amt(t.putIn) }, { t: 'put in', color: 'muted', size: S })],
    ['Account value', 'End', 86, m => plain(m.endValue, 'USD', { bold: true }), () => plain(t.endValue, 'USD', { bold: true })],
    ['Account value', 'Return', 80, m => pct(m.twr, { bold: true }),
      () => rich({}, { t: pctText(t.twrPct), color: sign(t.twrPct), bold: true, size: 11 }, { t: 'time-weighted', color: 'muted', size: S },
        { t: 'actual ', color: 'muted', size: S }, { t: pctText(t.returnPct), color: sign(t.returnPct), size: S, bold: true, inline: true })],
    ['Account value', 'Gain', 80, m => pl(monthGain(m), 'USD', { bold: true }), () => pl(t.profit, 'USD', { bold: true })],
    ['Money in / out', 'Deposits', 82, m => moved(m.depositsUSD, m.depositsILS, 'pos'), () => moved(t.depositsUSD, t.depositsILS, 'pos')],
    ['Money in / out', 'Withdr.', 82, m => moved(m.withdrawalsUSD, m.withdrawalsILS, 'neg'), () => moved(t.withdrawalsUSD, t.withdrawalsILS, 'neg'),
      m => m.withdrawalsUSD || m.withdrawalsILS],
    ['Money in / out', 'Conversions', 124, m => conv(m.conversions, '@'), () => conv(t.conversions, 'avg')],
    ['Realized profit, income & costs', 'Realized gain', 82, m => pl(realizedGainOf(m), 'USD', { bold: true }), () => pl(t.realizedGain, 'USD', { bold: true })],
    ['Realized profit, income & costs', 'Realized P/L', 82, m => realized(m.realizedPL, m.commissions), () => realized(t.realizedPL, t.commissions)],
    ['Realized profit, income & costs', 'Divs.', 70, m => pl(m.dividends), () => pl(t.dividends)],
    ['Realized profit, income & costs', 'WHT', 70, m => pl(m.withholdingTax), () => pl(t.withholdingTax)],
    ['Realized profit, income & costs', 'Fees', 76, m => fees(m.feesILS, m.feesUSD), () => fees(t.feesILS, t.feesUSD)],
    ['Holdings at month end', 'Cash', 86, cash, () => cash(t.latest)],
    ['Holdings at month end', 'Invested', 86, m => plain(m.invested), () => plain(t.latest.invested)],
    ['Holdings at month end', 'Unreal. P/L', 80, m => pl(m.unrealizedPL), () => pl(t.latest.unrealizedPL)],
  ].filter(c => !c[5] || months.some(c[5]));

  const s = canvas('Financial Summary', [8, 64, ...cols.map(c => c[2]), 8]);
  const n = cols.length + 1;   // table columns (Month + data)
  s.pad = 4;
  banner(s, '📊 Financial Summary (API)', `All time · IBKR data up to ${t.latest.toDate} · sent ${sentAt()}`);
  const lineCount = cells => Math.max(1, ...cells.map(c => c && c.runs ? c.runs.filter((r, i) => i === 0 || !r.inline).length : 1));
  const rowHeight = cells => 18 + 15 * lineCount(cells);
  const starts = cols.map((c, i) => i === 0 || cols[i - 1][0] !== c[0]);
  // Lines between columns: thin inside a group, thicker where a group starts (like the app)
  const columnLines = (r, rs) => {
    s.borders.push({ r, c: 1, rs, cs: n, line: 'line', sides: [], innerV: true });
    cols.forEach((c, i) => { if (starts[i]) s.borders.push({ r, c: 2 + i, rs, cs: 1, line: 'strong', sides: ['left'], style: 'SOLID_MEDIUM' }); });
  };

  // Header: each column group (its title + its column names) in a box outlined in the group's color; Month alone
  s.paint(2, 1, 2, n, 'head');
  s.put(2, 1, text('Month', { bold: true, size: 11, color: 'heading' }), 2, 1);
  cols.forEach((c, i) => {
    if (starts[i]) s.put(2, 2 + i, text(c[0], { bold: true, size: 11, color: hsl(GROUP_HUE[c[0]], 35, 30) }), 1, cols.filter(x => x[0] === c[0]).length);
    s.put(3, 2 + i, text(c[1], { bold: true, size: 10, color: 'heading', wrap: true }));
  });
  s.height(2, 32); s.height(3, 34);
  columnLines(3, 1);
  s.box(2, 1, 2, 1, { fill: null, line: 'strong', style: 'SOLID_MEDIUM' });
  cols.forEach((c, i) => { if (starts[i]) s.box(2, 2 + i, 2, cols.filter(x => x[0] === c[0]).length, { fill: null, line: hsl(GROUP_HUE[c[0]], 40, 58), style: 'SOLID_MEDIUM' }); });

  // TOTAL row, in its own box
  const totalCells = cols.map(c => c[4]());
  s.paint(4, 1, 1, n, 'head');
  s.put(4, 1, text('TOTAL', { bold: true, size: 11 }));
  totalCells.forEach((cell, i) => s.put(4, 2 + i, cell));
  s.height(4, rowHeight(totalCells));
  columnLines(4, 1);
  s.box(4, 1, 1, n, { fill: null, line: 'strong', style: 'SOLID_MEDIUM' });
  s.height(5, 14);
  s.freezeRows = 5;

  // Each year is its own block outlined in the year's color, with a tinted year band on top and every other
  // month shaded; a small gap between blocks
  let r = 6;
  for (const year of [...new Set(months.map(m => m.year))]) {
    const yc = YEAR_COLOR[year % 5], top = r;
    s.paint(r, 1, 1, n, mix(yc, 0.1));
    s.put(r, 1, text(String(year), { bold: true, size: 12, color: yc, align: 'LEFT' }), 1, n);
    s.height(r++, 30);
    months.filter(x => x.year === year).forEach((m, k) => {
      const cells = cols.map(c => c[3](m));
      s.paint(r, 1, 1, n, k % 2 ? 'alt' : 'card');
      s.put(r, 1, rich({}, { t: MONTHS[m.month - 1], bold: true, size: 11 }, m.partial && { t: `to ${m.toDate.slice(5)}`, color: 'muted', size: S }));
      cells.forEach((cell, i) => s.put(r, 2 + i, cell));
      s.height(r++, rowHeight(cells));
    });
    s.borders.push({ r: top, c: 1, rs: r - top, cs: n, line: 'line', sides: [], innerH: true });
    columnLines(top + 1, r - top - 1);
    s.box(top, 1, r - top, n, { fill: null, line: yc, style: 'SOLID_MEDIUM' });
    s.height(r++, 12);
  }
  s.height(r, 20);
  return s;
}

// ============================================================
// Activity tab: the Activity page (trades + cash activity in one
// list, all months, newest first). The month sits on the left, one
// merged cell per month in its year's color; each category's total
// is on a line above (the app's check boxes). Rows, types and words
// come from calc.js, so they read exactly like the app.
// ============================================================
function activityTab(months) {
  const cols = [['Month', 110, 'LEFT'], ['Date', 110, 'LEFT'], ['Type', 120, 'LEFT'], ['Stock', 90, 'LEFT'], ['What happened', 430, 'LEFT'], ['Cash in / out', 170, 'RIGHT'], ['Profit / loss', 150, 'RIGHT']];
  const s = canvas('Activity', [12, ...cols.map(c => c[1]), 12]);
  const n = cols.length, B = { size: 11 };
  banner(s, '📒 Activity', `All months, newest first · sent ${sentAt()}`);

  const all = months.flatMap(activityRows), usd = (t, k) => num(t[k]) * (num(t.FXRateToBase) || 1);
  const totals = Object.entries(ACTIVITY_CATEGORIES).filter(([cat]) => all.some(x => x.cat === cat)).flatMap(([cat, label], i) => {
    const rows = all.filter(x => x.cat === cat), by = {};
    for (const x of rows.flatMap(activityCash)) by[x.cur] = (by[x.cur] || 0) + x.amount;
    const sums = Object.entries(by).map(([cur, v]) => amt(v, cur)).join(' + ');
    const value = cat === 'trades' ? `${rows.length} · profit ${amt(rows.reduce((a, x) => a + usd(x.t, 'FifoPnlRealized'), 0))}`
      : cat === 'dividends' ? `net ${sums}` : cat === 'conversions' ? `${rows.length}` : sums;
    return [{ t: (i ? '   ·   ' : '') + label + '  ', bold: true, color: catColor(cat), inline: true }, { t: value, color: 'muted', inline: true }];
  });
  s.put(2, 1, rich({ align: 'LEFT', size: 11 }, ...totals), 1, n);
  s.height(2, 36);

  s.paint(3, 1, 1, n, 'head');
  cols.forEach(([h, , align], i) => s.put(3, 1 + i, text(h, { bold: true, size: 10, color: 'heading', align })));
  s.height(3, 34);
  s.freezeRows = 4;
  const columnLines = { r: 3, c: 1, rs: 1, cs: n, line: 'line', sides: [], innerV: true };
  s.borders.push(columnLines);

  let r = 4;
  for (const m of months) {
    const items = activityRows(m);
    if (!items.length) continue;
    const yc = YEAR_COLOR[m.year % 5];
    s.paint(r, 1, items.length, 1, mix(yc, 0.09));
    s.put(r, 1, rich({ align: 'LEFT', valign: 'TOP', color: yc }, { t: MONTHS[m.month - 1], bold: true, size: 12 }, { t: ' ' + m.year, size: 11, inline: true }), items.length, 1);
    s.borders.push({ r, c: 1, rs: 1, cs: n, line: 'strong', sides: ['top'], style: 'SOLID_MEDIUM' });
    items.forEach((x, k) => {
      s.paint(r, 2, 1, n - 1, k % 2 ? 'alt' : 'card');
      const words = activityWords(x, amt).map(p => ({ t: p.t, color: p.muted ? 'muted' : 'text', inline: true }));
      if (x.note) words.push({ t: x.note, color: 'muted', size: 9 });
      const cash = activityCash(x).map(c => ({ t: (c.amount > 0 ? '+' : '') + amt(c.amount, c.cur), color: sign(c.amount) }));
      const pnl = x.t ? num(x.t.FifoPnlRealized) : 0;
      [text(dmy(x.date), B), text(activityType(x), { ...B, bold: true, color: catColor(x.cat) }), text(x.t ? x.t.Symbol : x.symbol || '', { ...B, bold: true }),
        words.length ? rich({ ...B, align: 'LEFT' }, ...words) : '', cash.length ? rich({ ...B, align: 'RIGHT' }, ...cash) : '',
        pnl ? pl(pnl, x.t.CurrencyPrimary, { ...B, align: 'RIGHT' }) : ''].forEach((c, i) => s.put(r, 2 + i, c && typeof c === 'object' ? { align: cols[i + 1][2], ...c } : c));
      s.height(r++, 14 + 20 * Math.max(1, cash.length, x.note ? 2 : 1));
    });
  }
  columnLines.rs = r - 3;
  s.box(3, 1, r - 3, n, { fill: null, line: 'strong' });
  s.height(r, 20);
  return s;
}

// ============================================================
// Insights tab: the 7 insights of the Insights page, one under the
// other: the question, the answer in one line, a short note on what
// it measures (the app's 💡 hints), 4 headline numbers, a small
// SPARKLINE chart where it helps, and its table.
// ============================================================
const amt0 = (n, cur = 'USD') => (Math.round(n) < 0 ? '-' : '') + sym(cur) + Math.abs(Math.round(n)).toLocaleString('en-US');
const plus0 = (n, cur) => (Math.round(n) > 0 ? '+' : '') + amt0(n, cur);
const pct1 = n => (n > 0 ? '+' : '') + n.toFixed(1) + '%';
const howLong = d => d < 45 ? `${Math.round(d)} day${Math.round(d) === 1 ? '' : 's'}` : d < 545 ? `${(d / 30.4).toFixed(1)} months` : `${(d / 365).toFixed(1)} years`;
const monKey = key => `${MONTHS[+key.slice(5) - 1]} ${key.slice(2, 4)}`;
// Pieces of a value: V(text, color); a signed number gets green / red
const V = (t, color = 'text', o) => ({ t, color, inline: true, ...o });
const VS = (n, t) => V(t, sign(n));
const NONE = [V('—', 'faint')];
const SLOTS = [1, 2, 4, 5, 7, 8, 10, 11];   // the 146px columns of P_COLS (3, 6, 9 are the thin gaps)
const spark = (vals, opts) => `=SPARKLINE({${vals.map(v => Math.round(v * 100) / 100).join(',')}},{${opts}})`;

function insightsTab(months, rates) {
  const r = insights(months, months, rates);
  const s = canvas('Insights', P_COLS);
  let row = banner(s, '💡 Insights', `All time · sent ${sentAt()}`);
  const section = ({ title, question, answer, note, tiles, chart, table }) => {
    s.put(row, 1, rich({ align: 'LEFT', valign: 'BOTTOM' }, { t: title, bold: true, size: 15, color: 'heading' }, { t: '   ' + question, size: 10, color: 'muted', inline: true }), 1, 11);
    s.height(row++, 40);
    s.put(row, 1, rich({ align: 'LEFT', size: 12 }, ...answer), 1, 11);
    s.height(row++, 28);
    s.put(row, 1, text('💡 ' + note, { align: 'LEFT', size: 9, color: 'muted', wrap: true }), 1, 11);
    s.height(row++, 34);
    tiles.forEach(([label, value, sub], i) => {
      const c = 1 + i * 3;
      s.box(row, c, 3, 2);
      s.put(row, c, text(label.toUpperCase(), { ...LABEL, valign: 'BOTTOM' }), 1, 2);
      s.put(row + 1, c, rich({ align: 'LEFT', size: 17, bold: true }, ...value), 1, 2);
      s.put(row + 2, c, text(sub || '', { size: 9, color: 'muted', align: 'LEFT', valign: 'TOP', wrap: true }), 1, 2);
    });
    s.height(row, 26); s.height(row + 1, 40); s.height(row + 2, 30);
    row += 3; s.height(row++, 10);
    if (chart) {
      s.box(row, 1, 2, 11);
      s.put(row, 1, text(chart.title, LABEL), 1, 11);
      s.put(row + 1, 1, { formula: chart.formula }, 1, 11);
      s.height(row, 26); s.height(row + 1, 90);
      row += 2; s.height(row++, 10);
    }
    if (table && table.rows.length) {
      const k = table.head.length, spans = table.spans || SLOTS.slice(0, k).map((c, i) => [c, (i === k - 1 ? 12 : SLOTS[i + 1]) - c]);
      s.box(row, 1, table.rows.length + 1, 11);
      s.paint(row, 1, 1, 11, 'head');
      table.head.forEach((h, i) => s.put(row, spans[i][0], text(h, { size: 9, bold: true, color: 'heading', align: i ? 'RIGHT' : 'LEFT', wrap: true }), 1, spans[i][1]));
      s.height(row++, 30);
      table.rows.forEach((cells, j) => {
        s.paint(row, 1, 1, 11, j % 2 ? 'alt' : 'card');
        cells.forEach((c, i) => s.put(row, spans[i][0], rich({ size: 10, align: i ? 'RIGHT' : 'LEFT' }, ...(Array.isArray(c) ? c : [V(String(c))])), 1, spans[i][1]));
        s.borders.push({ r: row, c: 1, rs: 1, cs: 11, line: 'line', sides: ['top'], style: 'SOLID' });
        s.height(row++, 28);
      });
      s.height(row++, 10);
    }
    s.height(row++, 28);   // space before the next insight
  };

  const m = r.money, d = r.drawdowns, b = r.buyingLow, st = r.perStock, c = r.currency, k = r.cash, { then, now } = r.thenVsNow;
  const pctV = n => n === null ? NONE : [VS(n, pct1(n))];
  const arrow = V(' → ', 'muted', { bold: false });
  section({ title: '📈 Growth', question: 'Is my money growing?',
    answer: [VS(m.profit, plus0(m.profit)), V(` on your money · ${m.up} of ${m.growth.length} months up`, 'text', { bold: false })].map((x, i) => i ? x : { ...x, bold: true }),
    note: 'Profit = what the account is worth now minus all the money you put in (deposits are not profit). Time-weighted return = the months\' returns chained together, like "since inception" in IBKR.',
    tiles: [['Profit', [VS(m.profit, plus0(m.profit))]], ['Time-weighted return', pctV(m.twrPct)],
      ['Best month', pctV(m.best.twr), monKey(m.best.key)], ['Worst month', pctV(m.worst.twr), monKey(m.worst.key)]],
    chart: { title: 'ACCOUNT VALUE, MONTH BY MONTH', formula: spark(m.growth.map(g => g.value), `"charttype","line";"color","${COLOR.ils}";"linewidth",2`) } });

  section({ title: '🛡 Drawdowns', question: 'How far did I fall, and how fast did I recover?',
    answer: d.max < -0.05 ? [V('Deepest drop '), V(d.max.toFixed(1) + '%', 'neg', { bold: true }), V(' · ' + (d.now < -0.05 ? `now ${Math.abs(d.now).toFixed(1)}% below the high` : 'at a high now'))]
      : [V('Never below a previous high')],
    note: "How far the account fell from its highest point before. It uses the time-weighted return, so a deposit can't hide a drop. Longest climb back = the most months from a high, down, and back to it.",
    tiles: [['Deepest drop', [VS(d.max, d.max.toFixed(1) + '%')], d.maxKey ? `bottom ${monKey(d.maxKey)}` : ''],
      ['Right now', d.now < -0.05 ? [VS(d.now, d.now.toFixed(1) + '%')] : [V('At a high')]],
      ['Longest climb back', d.longest ? [V(`${d.longest} month${d.longest === 1 ? '' : 's'}`)] : NONE, d.longestOngoing ? 'still climbing' : ''],
      ['Earlier → last 12 months', d.hasThen && d.hasNow ? [VS(d.then, d.then.toFixed(1) + '%'), arrow, VS(d.nowEra, d.nowEra.toFixed(1) + '%')] : NONE]],
    chart: { title: 'HOW FAR BELOW ITS HIGH, EACH MONTH', formula: spark(d.series.map(x => Math.min(0, x.drop)), `"charttype","column";"color","${COLOR.neg}";"negcolor","${COLOR.neg}";"axis",true`) } });

  section({ title: '🎯 Buying low', question: 'Did I really buy when things were down?',
    answer: b.count ? [V(`${b.belowHighPct.toFixed(0)}%`, 'text', { bold: true }), V(' of your buying was while the account was down')] : [V('No buys')],
    note: "Buying when the market drops is a common plan; this checks how often you did. Price range = where each buy price sat between the stock's lowest (0%) and highest (100%) month-end price in the 2 months before and after it: lower is better.",
    tiles: [['Bought while down', b.belowHighPct === null ? NONE : [V(`${b.belowHighPct.toFixed(0)}%`)], 'of the money'],
      ['Price range', b.position === null ? NONE : [V(`${b.position.toFixed(0)}%`)], 'lower = better'],
      ['Since you bought', b.change === null ? NONE : pctV(b.change), b.held ? `${b.held} buys of stocks you still hold` : ''],
      ['Buys', [V(String(b.count))], b.count ? `${amt0(b.amount)} invested` : '']],
    table: { head: ['Stock', 'Buys', 'Invested', 'Bought while down', 'Price range', 'Since you bought'],
      rows: b.perSymbol.map(x => [[V(x.symbol, 'text', { bold: true })], x.buys, amt0(x.amount), `${x.belowHighPct.toFixed(0)}%`, x.position === null ? NONE : `${x.position.toFixed(0)}%`, x.change === null ? NONE : pctV(x.change)]) } });

  section({ title: '🏆 Results per stock', question: 'Which stocks made me money?',
    answer: st.length ? [V(`${st.filter(x => x.total > 0).length} of ${st.length} stocks made money`)] : [V('No stocks traded')],
    note: 'Per stock: profit from shares you sold + profit on shares you still hold + dividends. Sold at a profit = share of the sold shares sold for more than they cost. Typical hold = the middle value before selling.',
    tiles: [['Stocks', [V(String(st.length))], `${st.filter(x => x.held).length} still held`],
      ['Made money', [V(String(st.filter(x => x.total > 0).length))], `${st.filter(x => x.total < 0).length} lost`],
      ['Best', st.length ? [V(st[0].symbol + ' '), VS(st[0].total, plus0(st[0].total))] : NONE],
      ['Worst', st.length ? [V(st[st.length - 1].symbol + ' '), VS(st[st.length - 1].total, plus0(st[st.length - 1].total))] : NONE]],
    table: { head: ['Stock', 'Total', 'From sales', 'Still held', 'Dividends', 'Sold at a profit', 'Typical hold'],
      rows: st.map(x => [[V(x.symbol, 'text', { bold: true })], [VS(x.total, plus0(x.total))], x.lots ? [VS(x.realized, plus0(x.realized))] : NONE, x.held ? [VS(x.unrealized, plus0(x.unrealized))] : NONE,
        x.dividends ? [VS(x.dividends, plus0(x.dividends))] : NONE, x.winRate === null ? NONE : `${x.winRate.toFixed(0)}% of ${x.lots}`, x.medianDays === null ? NONE : howLong(x.medianDays)]) } });

  section({ title: '💱 Currency conversions', question: 'Did I convert shekels at good times?',
    answer: c.conversions.length && c.cheaperThan !== null ? [V('Cheaper than '), V(`${c.cheaperThan.toFixed(0)}%`, 'text', { bold: true }), V(' of the days around them' + (c.rough ? ' (rough: some use IBKR month-end rates)' : ''))]
      : [V('No shekel → dollar conversions in these months')],
    note: "Each ₪ → $ conversion vs the Bank of Israel's official rate on every working day in the 1.5 months before and after it. Higher % = better timing (fewer shekels per dollar). Dollar's move since = dollars converted × (today's rate − your average rate).",
    tiles: [['Timing', c.cheaperThan === null ? NONE : [V(`${c.cheaperThan.toFixed(0)}%`)], 'of nearby days cost more'],
      ['Your average rate', c.avgRate ? [V(`₪${c.avgRate.toFixed(3)}`)] : NONE, c.conversions.length ? `${amt0(c.ilsPaid, 'ILS')} → ${amt0(c.usdBought)}` : ''],
      ['Rate today', c.rateNow ? [V(`₪${c.rateNow.toFixed(3)}`)] : NONE, c.daily ? 'Bank of Israel' : 'IBKR'],
      ["Dollar's move since", c.avgRate ? [VS(c.fxEffectILS, plus0(c.fxEffectILS, 'ILS'))] : NONE, 'in ₪']],
    table: { head: ['Date', 'Shekels', 'Dollars', 'Rate', 'Cheaper than', 'vs your average', 'vs today'],
      rows: c.conversions.slice().reverse().map(x => [dmy(x.date), amt0(x.ils, 'ILS'), amt0(x.usd), `₪${x.rate.toFixed(4)}`, x.cheaperThan === null ? NONE : `${x.cheaperThan.toFixed(0)}% of days`,
        [VS(x.vsAvgILS, plus0(x.vsAvgILS, 'ILS'))], [VS(x.vsNowILS, plus0(x.vsNowILS, 'ILS'))]]) } });

  section({ title: '₪ Costs & cash', question: 'What do taxes and fees cost me?',
    answer: [V('Taxes & fees '), V(amt0(k.costs.total), 'text', { bold: true }), V(k.costShare !== null ? ` · ${k.costShare.toFixed(k.costShare < 10 ? 1 : 0)}% of what you earned` : '')],
    note: "Israel tax + US tax on dividends + commissions, vs what you earned before them. Commission per trade = % of each trade's amount (small trades pay a bigger %). US tax on dividends is normally 25%; ⚠ = a different rate, usually an IBKR refund or correction.",
    tiles: [['Taxes & fees', [V(amt0(-k.costs.total))], `Israel ${amt0(-k.costs.israelTax)} · US ${amt0(-k.costs.usTax)} · commissions ${amt0(-k.costs.commissions)}`],
      ['Costs vs profit', k.costShare === null ? NONE : [V(`${k.costShare.toFixed(k.costShare < 10 ? 1 : 0)}%`)], 'of what you earned'],
      ['Commission per trade', k.commThen.pct !== null && k.commNow.pct !== null ? [V(`${k.commThen.pct.toFixed(2)}%`), arrow, V(`${k.commNow.pct.toFixed(2)}%`)] : k.commNow.pct !== null ? [V(`${k.commNow.pct.toFixed(2)}%`)] : NONE, 'earlier → last 12 months'],
      ['Cash not invested', [V(`${k.idleAvg.toFixed(1)}%`)], 'average month end']],
    chart: { title: 'CASH NOT INVESTED, EACH MONTH (% OF THE ACCOUNT)', formula: spark(k.idle.map(x => x.pct), `"charttype","column";"color","${COLOR.muted}"`) },
    table: { head: ['Dividends per stock', 'Dividends', 'US tax', 'Tax rate', 'Net'],
      rows: k.dividendsPerStock.map(x => [[V(x.symbol, 'text', { bold: true })], amt(x.gross), amt(x.tax),
        Math.abs(x.taxRate - 25) > 2 ? [V(`${x.taxRate.toFixed(0)}% ⚠`, 'neg', { bold: true })] : `${x.taxRate.toFixed(0)}%`, [VS(x.net, plus0(x.net))]]) } });

  const both = then.months && now.months;
  const eraRow = (label, a, z, fmt, higherBetter) => {
    const better = higherBetter == null || a === null || z === null || a === z ? null : (higherBetter ? z > a : z < a) ? 'now' : 'then';
    const cell = (v, side) => v === null ? NONE : [...fmt(v), ...(better === side ? [V('  ✓', 'pos', { bold: true })] : [])];
    return [[V(label, 'text', { bold: true })], cell(a, 'then'), cell(z, 'now')];
  };
  const plain1 = f => v => [V(f(v))];
  section({ title: '🔄 Then vs now', question: 'Am I doing better lately?',
    answer: both ? [V('Average month '), VS(then.avgReturn, pct1(then.avgReturn)), arrow, VS(now.avgReturn, pct1(now.avgReturn))] : [V('Needs months before and within the last 12 months')],
    note: 'The last 12 months compared with the months before them. ✓ marks the better side.',
    tiles: [['Average month', both ? [VS(then.avgReturn, pct1(then.avgReturn)), arrow, VS(now.avgReturn, pct1(now.avgReturn))] : NONE, 'earlier → recent'],
      ['Deepest drop', both ? [VS(then.maxDrop, then.maxDrop.toFixed(1) + '%'), arrow, VS(now.maxDrop, now.maxDrop.toFixed(1) + '%')] : NONE, 'earlier → recent'],
      ['Typical hold', then.medianDays !== null && now.medianDays !== null ? [V(howLong(then.medianDays)), arrow, V(howLong(now.medianDays))] : NONE, 'before selling'],
      ['Sold at a profit', then.winRate !== null && now.winRate !== null ? [V(`${then.winRate.toFixed(0)}%`), arrow, V(`${now.winRate.toFixed(0)}%`)] : NONE, 'of sold shares']],
    table: { head: ['', ERAS.then, ERAS.now], spans: [[1, 5], [6, 3], [9, 3]], rows: [
      eraRow('Months in view', then.months, now.months, plain1(String)),
      eraRow('Average month', then.avgReturn, now.avgReturn, v => [VS(v, pct1(v))], true),
      eraRow('Deepest drop', then.maxDrop, now.maxDrop, v => [VS(v, v.toFixed(1) + '%')], true),
      eraRow('Trades per month', then.tradesPerMonth, now.tradesPerMonth, plain1(v => v.toFixed(1))),
      eraRow('Typical hold before selling', then.medianDays, now.medianDays, plain1(howLong)),
      eraRow('Sold at a profit', then.winRate, now.winRate, plain1(v => v.toFixed(0) + '%'), true),
      eraRow('Average win', then.avgWin, now.avgWin, v => [VS(v, plus0(v))], true),
      eraRow('Average loss', then.avgLoss, now.avgLoss, v => [VS(v, plus0(v))], true),
      eraRow('Made from sales', then.realized, now.realized, v => [VS(v, plus0(v))]),
      eraRow('Commission (% of trade)', then.commPct, now.commPct, plain1(v => v.toFixed(2) + '%'), false),
    ] } });
  s.freezeRows = 1;
  return s;
}

// ============================================================
// Canvas → Sheets API requests: unmerge + clear the tab, size it,
// write every cell, then merges, borders, column widths, row heights.
// ============================================================
function tabRequests(s, sheetId, index) {
  const cols = s.widths.length;
  const rows = Math.max(s.cells.length, s.bg.length, s.heights.length);
  const range = (r, c, rs, cs) => ({ sheetId, startRowIndex: r, endRowIndex: r + rs, startColumnIndex: c, endColumnIndex: c + cs });
  const dims = (dimension, sizes) => {
    const out = [];
    for (let i = 0; i < sizes.length;) {
      let k = i;
      while (k + 1 < sizes.length && sizes[k + 1] === sizes[i]) k++;
      out.push({ updateDimensionProperties: { range: { sheetId, dimension, startIndex: i, endIndex: k + 1 }, properties: { pixelSize: sizes[i] }, fields: 'pixelSize' } });
      i = k + 1;
    }
    return out;
  };
  const cellRows = [];
  for (let r = 0; r < rows; r++) {
    const values = [];
    for (let c = 0; c < cols; c++) values.push(cellData(s.cells[r]?.[c], s.bg[r]?.[c] || 'page', s.pad));
    cellRows.push({ values });
  }
  return [
    { unmergeCells: { range: { sheetId } } },
    { updateCells: { range: { sheetId }, fields: '*' } },
    { updateSheetProperties: {
      properties: { sheetId, index, gridProperties: { rowCount: rows, columnCount: cols, frozenRowCount: s.freezeRows, frozenColumnCount: 0, hideGridlines: true } },
      fields: 'index,gridProperties(rowCount,columnCount,frozenRowCount,frozenColumnCount,hideGridlines)' } },
    { updateCells: { start: { sheetId, rowIndex: 0, columnIndex: 0 }, rows: cellRows, fields: 'userEnteredValue,userEnteredFormat,textFormatRuns' } },
    ...s.merges.map(([r, c, rs, cs]) => ({ mergeCells: { range: range(r, c, rs, cs), mergeType: 'MERGE_ALL' } })),
    ...s.borders.map(b => {
      const line = { style: b.style || 'SOLID', color: paint(b.line) };
      const req = { range: range(b.r, b.c, b.rs, b.cs) };
      for (const side of b.sides) req[side] = line;
      if (b.inner || b.innerH) req.innerHorizontal = line;
      if (b.inner || b.innerV) req.innerVertical = line;
      return { updateBorders: req };
    }),
    ...dims('COLUMNS', s.widths),
    ...dims('ROWS', Array.from({ length: rows }, (_, r) => s.heights[r] || 28)),
  ];
}

// ============================================================
// pushToSheets(nw, months, rates)
// nw = /api/net-worth, months = every IBKR month (newest first),
// rates = Bank of Israel daily USD/ILS rates (or null) for Insights.
// Creates the tabs that are missing, then rewrites them in one batch.
// ============================================================
async function pushToSheets(nw, months, rates) {
  if (!process.env.GOOGLE_SHEET_ID) throw new Error('GOOGLE_SHEET_ID is missing from your .env file.');
  if (!months.length) throw new Error('no IBKR download yet. Click "Fetch from IBKR" first.');
  if (!nw.fxRate) throw new Error('no USD/ILS rate yet. Type one on the Portfolio page first.');
  const tabs = [portfolioTab(nw, months), summaryTab(months), activityTab(months), insightsTab(months, rates)];

  const ids = {};
  for (const s of (await api('GET', '?fields=sheets.properties(sheetId,title)')).sheets) ids[s.properties.title] = s.properties.sheetId;
  const missing = tabs.filter(t => ids[t.title] == null);
  if (missing.length) {
    const r = await api('POST', ':batchUpdate', { requests: missing.map(t => ({ addSheet: { properties: { title: t.title } } })) });
    r.replies.forEach((reply, i) => { ids[missing[i].title] = reply.addSheet.properties.sheetId; });
  }
  await api('POST', ':batchUpdate', { requests: tabs.flatMap((t, i) => tabRequests(t, ids[t.title], i)) });
  return { url: `https://docs.google.com/spreadsheets/d/${process.env.GOOGLE_SHEET_ID}`, tabs: tabs.map(t => t.title) };
}

module.exports = { pushToSheets };
