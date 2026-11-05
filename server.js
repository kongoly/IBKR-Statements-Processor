// ============================================================
// server.js — Main Server for the IBKR Statement Processor
// ============================================================
require('./paths');   // loads the private .env file (IBKR token, Google Sheet ID) from outside the project
const express = require('express');
const multer  = require('multer');
const path    = require('path');
const fs      = require('fs');

const db                = require('./db');
const { parseCSVFile }  = require('./parser');
const { fetchFlexStatement, parseFlexCSV, summarizeFlex, monthRange, MIN_REAL_DEPOSIT_ILS } = require('./flex');
const { pushToSheets }  = require('./sheets');
const { getUsdIls }     = require('./fx');

const app = express();
const PORT = 3000;

// MIGRATION: Ensure 'subheaders' column exists in 'sections' table
try {
  db.exec("ALTER TABLE sections ADD COLUMN subheaders TEXT");
  console.log("Database migrated: Added 'subheaders' column to 'sections'.");
} catch (e) {}

app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());

const upload = multer({ dest: path.join(__dirname, 'uploads') });

app.post('/api/upload', upload.array('csvfiles'), (req, res) => {
  const results = [];
  const errors  = [];
  for (const file of req.files) {
    try {
      const parsed = parseCSVFile(file.path);
      saveMonthToDB(parsed);
      fs.unlinkSync(file.path);
      results.push({ success: true, year: parsed.year, month: parsed.month, monthName: parsed.monthName, sectionCount: parsed.sections.length });
    } catch (err) {
      console.error('Upload error: ' + err.message);
      errors.push({ file: file.originalname, error: err.message });
      try { fs.unlinkSync(file.path); } catch(e) {}
    }
  }
  res.json({ results, errors });
});

// IBKR Flex download: one raw CSV per month in uploads/flex (gitignored)
const FLEX_DIR = path.join(__dirname, 'uploads', 'flex');
// One download at a time. flexProgress tells the page which month is being fetched; flexStop is set by the Stop button.
let flexBusy = false, flexStop = false, flexProgress = null;
app.get('/api/flex/status', (req, res) => res.json({ busy: flexBusy, ...flexProgress }));
app.post('/api/flex/stop', (req, res) => { if (flexBusy) flexStop = true; res.json({ stopping: flexBusy }); });

// Month in progress: if IBKR says the last day isn't ready yet (error 1003), try again ending one weekday earlier
async function fetchLatestAvailable(range) {
  for (let tries = 0; ; tries++) {
    try { return await fetchFlexStatement(range, () => flexStop); }
    catch (err) {
      if (!/error 1003/.test(err.message) || tries >= 3) throw err;
      const d = new Date(Date.UTC(+range.td.slice(0, 4), +range.td.slice(4, 6) - 1, +range.td.slice(6, 8)));
      do d.setUTCDate(d.getUTCDate() - 1); while ([0, 6].includes(d.getUTCDay()));
      const td = d.toISOString().slice(0, 10).replace(/-/g, '');
      if (td < range.fd) throw err;
      range = { ...range, td };
    }
  }
}

app.post('/api/flex/fetch', async (req, res) => {
  if (flexBusy) return res.status(409).json({ busy: true, error: 'A download is already running.' });
  flexBusy = true;
  // Every month from `from` up to `to` ('YYYY-MM'; defaults: last month → this month). The current month runs until yesterday.
  // from == to fetches a single month.
  // Finished months already downloaded are skipped unless `redownload` is set (they never change);
  // the month in progress (or a month downloaded while it was in progress) is always fetched again.
  // "Today" is New York's date: IBKR closes its day on US time, so after midnight in Israel the US day isn't over yet.
  const [nyY, nyM, nyD] = new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' }).split('-').map(Number);
  const thisMonth = nyY * 12 + nyM;
  const yesterday = new Date(Date.UTC(nyY, nyM - 1, nyD - 1));
  let [y, m] = /^\d{4}-\d{2}$/.test(req.body?.from) ? req.body.from.split('-').map(Number) : [Math.floor((thisMonth - 2) / 12), (thisMonth - 2) % 12 + 1];
  const [toY, toM] = /^\d{4}-\d{2}$/.test(req.body?.to) ? req.body.to.split('-').map(Number) : [nyY, nyM];
  const last = Math.min(toY * 12 + toM, thisMonth);
  const have = flexFilesByMonth();
  const wanted = [], skipped = [];
  while (y * 12 + m <= last) {
    const key = `${y}-${String(m).padStart(2, '0')}`;
    const range = monthRange(y, m, yesterday);
    const complete = have[key] && have[key].toDate >= monthRange(y, m).td;
    if (range) (complete && !req.body?.redownload ? skipped : wanted).push({ key, range });
    if (++m > 12) { m = 1; y++; }
  }
  const done = [];
  try {
    fs.mkdirSync(FLEX_DIR, { recursive: true });
    for (const [n, { key, range }] of wanted.entries()) {
      if (flexStop) break;
      flexProgress = { month: key, n: n + 1, total: wanted.length };
      const text = await fetchLatestAvailable(range);
      parseFlexCSV(text);   // make sure it's a valid report before replacing anything
      for (const old of have[key]?.files || []) fs.unlinkSync(path.join(FLEX_DIR, old));
      fs.writeFileSync(path.join(FLEX_DIR, `flex-${key}-${Date.now()}.csv`), text);
      done.push(key);
    }
    res.json({ months: done, skipped: skipped.map(s => s.key), stopped: flexStop });
  } catch (err) {
    if (flexStop) return res.json({ months: done, skipped: skipped.map(s => s.key), stopped: true });
    console.error('Flex download: ' + err.message);
    res.status(500).json({ error: err.message + (done.length ? ` (already downloaded: ${done.join(', ')})` : '') });
  } finally { flexBusy = false; flexStop = false; flexProgress = null; }
});

// 'YYYY-MM' → { files, toDate } for that month, read from each file's own period.
// toDate (yyyymmdd) is the latest day any of its files covers, to tell a finished month from one in progress.
function flexFilesByMonth() {
  const out = {};
  if (!fs.existsSync(FLEX_DIR)) return out;
  for (const f of fs.readdirSync(FLEX_DIR).filter(f => f.endsWith('.csv'))) {
    try {
      const p = readFlexFile(f);
      const entry = out[p.fromDate.slice(0, 7)] = out[p.fromDate.slice(0, 7)] || { files: [], toDate: '' };
      entry.files.push(f);
      const to = p.toDate.replace(/-/g, '');
      if (to > entry.toDate) entry.toDate = to;
    } catch (e) {}
  }
  return out;
}

// Parsed downloads, cached by file name + modified time (each page load would otherwise re-read every file)
const flexCache = new Map();
function readFlexFile(f) {
  const mtime = fs.statSync(path.join(FLEX_DIR, f)).mtime;
  const hit = flexCache.get(f);
  if (hit && hit.downloaded.getTime() === mtime.getTime()) return hit;
  const m = { ...summarizeFlex(parseFlexCSV(fs.readFileSync(path.join(FLEX_DIR, f), 'utf8'))), downloaded: mtime };
  flexCache.set(f, m);
  return m;
}

// One entry per month across all downloads (a newer download of the same month wins), newest first
function getFlexMonths() {
  const files = fs.existsSync(FLEX_DIR) ? fs.readdirSync(FLEX_DIR).filter(f => f.endsWith('.csv')) : [];
  for (const f of flexCache.keys()) if (!files.includes(f)) flexCache.delete(f);
  const byPeriod = {};
  for (const m of files.map(readFlexFile).sort((a, b) => a.downloaded - b.downloaded)) {
    byPeriod[m.fromDate] = { ...m, conversions: [...m.conversions] };   // copy: the bank conversions below change it
  }
  // Conversions done at the bank before wiring (same as Financial Summary): show the conversion,
  // and count the wired USD deposit as the original ILS deposit
  const manual = db.prepare(`SELECT * FROM manual_conversions WHERE year = ? AND month = ?`);
  for (const m of Object.values(byPeriod)) for (const c of manual.all(m.year, m.month)) {
    m.conversions.push({ fromCur: c.from_cur, fromAmt: c.from_amount, toCur: c.to_cur, toAmt: c.to_amount, rate: c.rate, note: c.note });
    m['deposits' + c.to_cur] -= c.to_amount;
    m['deposits' + c.from_cur] += c.from_amount;
  }
  return Object.values(byPeriod).sort((a, b) => b.fromDate.localeCompare(a.fromDate));
}

app.get('/api/flex/overview', (req, res) => {
  try { res.json(getFlexMonths()); } catch (err) { res.status(500).json({ error: err.message }); }
});

// Official daily USD/ILS rates (Bank of Israel, public) for the Insights page's conversion check
app.get('/api/fx/usdils', async (req, res) => {
  const day = /^\d{4}-\d{2}-\d{2}$/, { from, to } = req.query;
  if (!day.test(from) || !day.test(to) || from > to) return res.status(400).json({ error: 'from and to must be YYYY-MM-DD' });
  res.json(await getUsdIls(from, to));
});

app.get('/api/months', (req, res) => {
  const months = db.prepare(`SELECT id, year, month, month_name FROM months ORDER BY year DESC, month DESC`).all();
  res.json(months);
});

app.delete('/api/month/:year/:month', (req, res) => {
  const { year, month } = req.params;
  const monthRow = db.prepare(`SELECT id FROM months WHERE year = ? AND month = ?`).get(year, month);
  if (!monthRow) return res.status(404).json({ error: 'Month not found' });
  
  db.transaction(() => deleteMonth(monthRow.id))();
  res.json({ success: true });
});

// No FK cascade: remove a month's rows, then its sections, then the month
function deleteMonth(monthId) {
  db.prepare('DELETE FROM rows WHERE section_id IN (SELECT id FROM sections WHERE month_id = ?)').run(monthId);
  db.prepare('DELETE FROM sections WHERE month_id = ?').run(monthId);
  db.prepare('DELETE FROM months WHERE id = ?').run(monthId);
}

function saveMonthToDB(parsed) {
  const save = db.transaction(() => {
    const existing = db.prepare(`SELECT id FROM months WHERE year = ? AND month = ?`).get(parsed.year, parsed.month);
    if (existing) deleteMonth(existing.id);
    const monthId = db.prepare(`INSERT INTO months (year, month, month_name) VALUES (?, ?, ?)`).run(parsed.year, parsed.month, parsed.monthName).lastInsertRowid;
    const sectionInsert = db.prepare(`INSERT INTO sections (month_id, section_name, subheaders) VALUES (?, ?, ?)`);
    const rowInsert = db.prepare(`INSERT INTO rows (section_id, row_index, data, color) VALUES (?, ?, ?, ?)`);
    for (const section of parsed.sections) {
      const sectionId = sectionInsert.run(monthId, section.name, JSON.stringify(section.subheaders)).lastInsertRowid;
      section.rows.forEach((row, idx) => rowInsert.run(sectionId, idx, JSON.stringify(row.values), row.color || null));
    }
  });
  save();
}

// Latest snapshot: cash (USD + ILS), invested market value, unrealized P/L.
// Uses the newest IBKR download (even a month in progress) unless an uploaded CSV month is newer.
function getLatestSnapshot(flexMonths) {
  const csvLatest = db.prepare(`SELECT year, month FROM months ORDER BY year DESC, month DESC LIMIT 1`).get();
  const flex = flexMonths[0];
  if (flex && (!csvLatest || flex.year * 12 + flex.month >= csvLatest.year * 12 + csvLatest.month)) {
    const monthName = new Date(Date.UTC(flex.year, flex.month - 1)).toLocaleString('en-US', { month: 'long', timeZone: 'UTC' });
    return {
      // Without the Cash Report's currency field there's only the USD total (ILS cash already converted in it)
      usd: flex.hasCashCurrency ? flex.endingCashUSD : flex.endingCash,
      ils: flex.hasCashCurrency ? flex.endingCashILS : 0,
      unrealized: flex.unrealizedPL, invested: flex.invested,
      // IBKR's USD/ILS on the statement's last day: the Cash Report has ILS cash both in ₪ and inside the USD total
      fxRate: flex.hasCashCurrency && Math.abs(flex.endingCashILS) > 1 && flex.endingCash !== flex.endingCashUSD
        ? flex.endingCashILS / (flex.endingCash - flex.endingCashUSD) : null,
      fxDate: flex.toDate,
      year: flex.year, monthName,
      upTo: flex.partial ? new Date(flex.toDate + 'T00:00:00Z').toLocaleString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' }) : null,
    };
  }
  return getLatestCsvSnapshot();
}

function getLatestCsvSnapshot() {
  const latestMonth = db.prepare(`SELECT id, year, month, month_name FROM months ORDER BY year DESC, month DESC LIMIT 1`).get();
  let latest = { usd: 0, ils: 0, unrealized: 0, cashBase: 0, invested: 0, year: latestMonth?.year, monthName: latestMonth?.month_name };
  if (latestMonth) {
    const sections = db.prepare(`SELECT id, section_name, subheaders FROM sections WHERE month_id = ?`).all(latestMonth.id);
    for (const section of sections) {
      const name = section.section_name.toLowerCase();
      const rows = db.prepare(`SELECT data, color FROM rows WHERE section_id = ?`).all(section.id);
      const subheaders = JSON.parse(section.subheaders || '[]');
      
      if (name.includes('cash report')) {
        for (const row of rows) {
          const data = JSON.parse(row.data);
          const color = (row.color || '').toUpperCase();
          const amount = parseFloat(String(data[2]).replace(/[^0-9.-]/g, '')) || 0;
          if (color === '#C6EFCE') {
            if (String(data[1]).toUpperCase() === 'BASE CURRENCY SUMMARY') latest.cashBase = amount;
            else latest.usd = amount;
          }
          if (color === '#C6DBFF') latest.ils = amount;
        }
        if (latest.cashBase === 0) latest.cashBase = latest.usd;
        if (latest.usd === 0) latest.usd = latest.cashBase;
      }
      if (name.includes('open positions')) {
        const valIdx = subheaders.findIndex(h => h && (h.toLowerCase() === 'value' || h.toLowerCase().includes('market value')));
        if (valIdx >= 0) {
          const totalRow = rows.find(r => String(JSON.parse(r.data)[0]).toLowerCase() === 'total');
          if (totalRow) {
            latest.invested = parseFloat(String(JSON.parse(totalRow.data)[valIdx]).replace(/[^0-9.-]/g, '')) || 0;
          }
        }
      }
      if (name.includes('realized & unrealized')) {
        const totalRow = rows.find(r => (r.color || '').toUpperCase() === '#BEFAC8');
        if (totalRow) latest.unrealized = parseFloat(JSON.parse(totalRow.data)[12].replace(/[^0-9.-]/g, '')) || 0;
      }
    }
  }
  return latest;
}

// Portfolio page: latest IBKR snapshot + totals for the money journey + the user's saved values (bank balance; USD/ILS only if IBKR has no rate)
const NET_WORTH_SETTINGS = ['fx_usd_ils', 'bank_ils'];
app.get('/api/net-worth', (req, res) => {
  let months = [];
  try { months = getFlexMonths(); } catch (e) {}
  res.json(getNetWorth(months));
});

function getNetWorth(months) {
  const latest = getLatestSnapshot(months);
  // Money put into IBKR over time: shekels as deposited (bank conversions already re-counted as ILS),
  // plus any USD deposits/withdrawals, which the page converts at today's rate
  // putInValueUSD = the same money in dollars on the days it arrived (IBKR's own conversion), for the average deposit rate
  // usdBuyRate = average rate you bought dollars at (all ILS → USD conversions, incl. bank ones), weighted by amount
  // toUSD / toILS = all conversions in each direction (incl. bank ones), for the money-journey diagram
  let putInILS = null, putInUSD = 0, putInValueUSD = null, usdBuyRate = null, toUSD = null, toILS = null;
  if (months.length) {
      putInILS = months.reduce((a, m) => a + m.depositsILS + m.withdrawalsILS, 0);
      putInUSD = months.reduce((a, m) => a + m.depositsUSD + m.withdrawalsUSD, 0);
      putInValueUSD = months[months.length - 1].startValue + months.reduce((a, m) => a + m.deposits + m.withdrawals, 0);
      const total = (from, to) => months.flatMap(m => m.conversions).filter(c => c.fromCur === from && c.toCur === to)
        .reduce((a, c) => ({ from: a.from + c.fromAmt, to: a.to + c.toAmt }), { from: 0, to: 0 });
      toUSD = total('ILS', 'USD');   // { from: ₪ paid, to: $ received }
      toILS = total('USD', 'ILS');   // { from: $ paid, to: ₪ received }
      if (toUSD.to > 0) usdBuyRate = toUSD.from / toUSD.to;
  }
  const settings = {};
  for (const s of db.prepare(`SELECT key, value, updated_at FROM settings`).all()) settings[s.key] = s;
  return {
    statement: latest.monthName ? `${latest.monthName} ${latest.year}${latest.upTo ? `, up to ${latest.upTo}` : ''}` : null,
    cashUSD: latest.usd,
    cashILS: latest.ils,
    investedUSD: latest.invested,
    unrealizedPL: latest.unrealized,
    putInILS, putInUSD, putInValueUSD, usdBuyRate, toUSD, toILS,
    fxRate: latest.fxRate ?? (settings.fx_usd_ils ? Number(settings.fx_usd_ils.value) : null),
    fxDate: latest.fxRate ? latest.fxDate : null,
    bankILS: settings.bank_ils ? Number(settings.bank_ils.value) : null,
    bankUpdated: settings.bank_ils?.updated_at || null
  };
}

// Copies the Portfolio numbers and the IBKR downloads to the user's Google Sheet (sheets.js)
app.post('/api/sheets/push', async (req, res) => {
  try {
    const months = getFlexMonths();
    // Insights tab: Bank of Israel daily USD/ILS rates from 50 days before the first month up to today (like the Insights page)
    const first = months.length ? Date.parse(String(months[months.length - 1].fromDate).slice(0, 10)) : Date.now();
    const fx = months.length ? await getUsdIls(new Date(first - 50 * 864e5).toISOString().slice(0, 10), new Date().toISOString().slice(0, 10)) : null;
    res.json(await pushToSheets(getNetWorth(months), months, fx && Object.keys(fx.rates).length ? fx.rates : null));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.put('/api/settings/:key', (req, res) => {
  const { key } = req.params;
  if (!NET_WORTH_SETTINGS.includes(key)) return res.status(400).json({ error: 'Unknown setting' });
  db.prepare(`INSERT INTO settings (key, value, updated_at) VALUES (?, ?, datetime('now'))
              ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`).run(key, String(req.body.value));
  res.json(db.prepare(`SELECT key, value, updated_at FROM settings WHERE key = ?`).get(key));
});

// Live reload: the browser keeps this connection open. When the server restarts
// after a code change (node --watch), the browser reconnects and refreshes itself.
app.get('/api/live-reload', (req, res) => {
  res.set({ 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' });
  res.flushHeaders();
  res.write(': connected\n\n');
});

// Small ILS deposits (under ₪500) are promos like "bring a friend" bonuses, not real deposits, so they're ignored
function isRealDeposit(values) {
  const amt = parseFloat(String(values[3]).replace(/[^0-9.-]/g, '')) || 0;
  return !(String(values[0]).toUpperCase() === 'ILS' && amt > 0 && amt < MIN_REAL_DEPOSIT_ILS);
}

app.get('/api/financial-summary/:scope', (req, res) => {
  const { scope } = req.params;
  const { year, month } = req.query;
  const allMonths = db.prepare(`SELECT id, year, month, month_name FROM months ORDER BY year ASC, month ASC`).all();
  const manualConversions = db.prepare(`SELECT * FROM manual_conversions WHERE year = ? AND month = ?`);
  const sectionsOf = db.prepare(`SELECT id, section_name, subheaders FROM sections WHERE month_id = ?`);
  const rowsOf = db.prepare(`SELECT data, color FROM rows WHERE section_id = ? ORDER BY row_index ASC`);
  const results = allMonths.map(m => {
    const entry = { year: m.year, month: m.month, monthName: m.month_name, endingCashUSD:0, endingCashILS:0, endingCashBase:0, investedUSD:0, unrealizedPL:0, tradingPL:0, realizedPL:0, israelTaxILS:0, israelTaxUSD:0, commissions:0, dividends:0, withholdingTaxUSD:0, depositsUSD:0, withdrawalsUSD:0, depositsILS:0, withdrawalsILS:0, conversions:[] };
    const sections = sectionsOf.all(m.id);
    const forexPLRows = [];
    for (const section of sections) {
      const name = section.section_name.toLowerCase();
      const allRows = rowsOf.all(section.id).map(r => ({ values: JSON.parse(r.data), color: (r.color || '').toUpperCase() }));
      if (!allRows.length) continue;
      const subheaders = allRows[0] && allRows[0].values ? allRows[0].values : [];
      const dataRows = allRows.slice(1);
      if (name.includes('forex p/l details')) dataRows.forEach(r => { if (String(r.values[2]).toLowerCase() === 'net cash activity' && String(r.values[4]).toUpperCase() === 'ILS') forexPLRows.push(r); });
      if (name.includes('cash report')) {
        for (const row of dataRows) {
          const amount = parseFloat(String(row.values[2]).replace(/[^0-9.-]/g, '')) || 0;
          if (row.color === '#C6EFCE') {
            // Check if it's the Base Currency Summary row
            if (String(row.values[1]).toUpperCase() === 'BASE CURRENCY SUMMARY') entry.endingCashBase = amount;
            else if (String(row.values[1]).toUpperCase().includes('USD')) entry.endingCashUSD = amount;
            else entry.endingCashUSD = amount; // fallback
          }
          if (row.color === '#C6DBFF') entry.endingCashILS = amount;
          if (row.color === '#F8BE78') entry.dividends += amount;
          if (row.color === '#FFC7CE') entry.withholdingTaxUSD += amount;
        }
        // If endingCashBase wasn't specifically found, use endingCashUSD as fallback
        if (entry.endingCashBase === 0) entry.endingCashBase = entry.endingCashUSD;
        // Conversely, if endingCashUSD wasn't found (only base summary exists), use base
        if (entry.endingCashUSD === 0) entry.endingCashUSD = entry.endingCashBase;
      }
      if (name.includes('open positions')) {
        const discIdx = subheaders.findIndex(h => h && h.toLowerCase().includes('discriminator'));
        const valIdx  = subheaders.findIndex(h => h && (h.toLowerCase() === 'value' || h.toLowerCase().includes('market value')));
        
        if (valIdx >= 0) {
          const totalRow = dataRows.find(r => {
            const discVal = discIdx >= 0 ? String(r.values[discIdx]).toLowerCase() : String(r.values[0]).toLowerCase();
            return discVal === 'total';
          });
          if (totalRow) {
            entry.investedUSD = parseFloat(String(totalRow.values[valIdx]).replace(/[^0-9.-]/g, '')) || 0;
          }
        }
      }
      if (name.includes('realized & unrealized')) {
        for (const row of dataRows) if (row.color === '#BEFAC8') {
          entry.unrealizedPL = parseFloat(String(row.values[12]).replace(/[^0-9.-]/g, '')) || 0;
          entry.tradingPL += parseFloat(String(row.values[7]).replace(/[^0-9.-]/g, '')) || 0;
        }
      }
      if (name.includes('fees')) {
        const usdColIdx = subheaders.findIndex(h => h && String(h).toUpperCase().includes('USD'));
        dataRows.forEach(row => { if (row.color === '#FFDCE1' && String(row.values[1]).toUpperCase() === 'ILS') {
          const amt = parseFloat(String(row.values[4]).replace(/[^0-9.-]/g, '')) || 0; entry.israelTaxILS += amt;
          const match = forexPLRows.find(f => Math.abs(parseFloat(String(f.values[5]).replace(/[^0-9.-]/g, '')) - amt) < 0.01);
          if (match) entry.israelTaxUSD += (amt < 0 ? -Math.abs(parseFloat(String(match.values[6]).replace(/[^0-9.-]/g, '')) || 0) : Math.abs(parseFloat(String(match.values[6]).replace(/[^0-9.-]/g, '')) || 0));
          else if (usdColIdx >= 0) entry.israelTaxUSD += (amt < 0 ? -Math.abs(parseFloat(String(row.values[usdColIdx]).replace(/[^0-9.-]/g, '')) || 0) : Math.abs(parseFloat(String(row.values[usdColIdx]).replace(/[^0-9.-]/g, '')) || 0));
        }});
      }
      if (name.includes('trade summary by asset class')) { for (const row of dataRows) if (row.color === '#FFE699') entry.commissions += parseFloat(String(row.values[4]).replace(/[^0-9.-]/g, '')) || 0; }
      if (name.includes('trade summary by symbol')) {
        // Each colored row is one currency pair, e.g. USD.ILS = buying/selling USD priced in ILS.
        // A row can hold both buys and sells in the same month, so each side becomes its own conversion.
        // Tiny leftovers (proceeds of 5 or less) are IBKR rounding lots, not real conversions.
        for (const r of dataRows.filter(r => r.color)) {
          const [base, quote] = String(r.values[2]).split('.');
          const [bQty, bPrice, bProc, sQty, sPrice, sProc] = r.values.slice(3, 9).map(v => parseFloat(String(v).replace(/[^0-9.-]/g, '')) || 0);
          if (bQty !== 0 && Math.abs(bProc) > 5) entry.conversions.push({ fromCur: quote, fromAmt: Math.abs(bProc), toCur: base, toAmt: Math.abs(bQty), rate: bPrice });
          if (sQty !== 0 && Math.abs(sProc) > 5) entry.conversions.push({ fromCur: base, fromAmt: Math.abs(sQty), toCur: quote, toAmt: Math.abs(sProc), rate: sPrice });
        }
      }
      if (name === 'deposits & withdrawals') dataRows.filter(r => r.color && isRealDeposit(r.values)).forEach(r => {
        const amt = parseFloat(String(r.values[3]).replace(/[^0-9.-]/g, '')) || 0;
        const curr = String(r.values[0]).toUpperCase();
        if (curr === 'ILS') { if (amt > 0) entry.depositsILS += amt; else entry.withdrawalsILS += Math.abs(amt); }
        else { if (amt > 0) entry.depositsUSD += amt; else entry.withdrawalsUSD += Math.abs(amt); }
      });
    }
    // Conversions done outside IBKR (entered by hand, stored only in the local DB).
    // The money was converted at the bank and then wired in, so the deposit really was
    // in the original currency: move it from e.g. USD deposits back to ILS deposits.
    for (const c of manualConversions.all(m.year, m.month)) {
      entry.conversions.push({ fromCur: c.from_cur, fromAmt: c.from_amount, toCur: c.to_cur, toAmt: c.to_amount, rate: c.rate, note: c.note });
      entry['deposits' + c.to_cur] -= c.to_amount;
      entry['deposits' + c.from_cur] += c.from_amount;
    }
    // Net money result for the month: money in is +, money out is −.
    // IBKR already signs these that way (dividends +, WHT/Israel tax −).
    // Commissions are NOT added: IBKR's trading P/L already includes them (buy side in cost basis, sell side in proceeds).
    // Deposits, withdrawals and currency conversions are transfers, not profit, so they're excluded.
    entry.realizedPL = entry.tradingPL + entry.dividends + entry.withholdingTaxUSD + entry.israelTaxUSD;
    return entry;
  });
  let filtered = results;
  if (scope === 'year') filtered = results.filter(m => m.year == year);
  else if (scope === 'month') filtered = results.filter(m => m.year == year && m.month == month);
  const sorted = [...filtered].sort((a,b) => b.year !== a.year ? b.year - a.year : b.month - a.month);
  const summary = { 
    latestEndingCashUSD: sorted[0]?.endingCashUSD || 0, 
    latestEndingCashILS: sorted[0]?.endingCashILS || 0, 
    latestInvestedUSD: sorted[0]?.investedUSD || 0,
    latestUnrealizedPL: sorted[0]?.unrealizedPL || 0, 
    totalTradingPL: filtered.reduce((s, m) => s + m.tradingPL, 0),
    totalRealizedPL: filtered.reduce((s, m) => s + m.realizedPL, 0),
    totalIsraelTaxILS: filtered.reduce((s, m) => s + m.israelTaxILS, 0), 
    totalIsraelTaxUSD: filtered.reduce((s, m) => s + m.israelTaxUSD, 0), 
    totalCommissions: filtered.reduce((s, m) => s + m.commissions, 0), 
    totalDividends: filtered.reduce((s, m) => s + m.dividends, 0), 
    totalWithholdingTaxUSD: filtered.reduce((s, m) => s + m.withholdingTaxUSD, 0), 
    totalDepositsUSD: filtered.reduce((s, m) => s + m.depositsUSD, 0), 
    totalWithdrawalsUSD: filtered.reduce((s, m) => s + m.withdrawalsUSD, 0), 
    totalDepositsILS: filtered.reduce((s, m) => s + m.depositsILS, 0), 
    totalWithdrawalsILS: filtered.reduce((s, m) => s + m.withdrawalsILS, 0), 
    // One total per direction, e.g. all ILS→USD conversions summed together
    conversionTotals: Object.values(filtered.flatMap(m => m.conversions).reduce((acc, c) => {
      const key = c.fromCur + '>' + c.toCur;
      acc[key] = acc[key] || { fromCur: c.fromCur, toCur: c.toCur, fromAmt: 0, toAmt: 0 };
      acc[key].fromAmt += c.fromAmt;
      acc[key].toAmt += c.toAmt;
      return acc;
    }, {}))
  };
  res.json({ months: sorted, summary });
});

app.listen(PORT, '0.0.0.0', () => { console.log(`✅ IBKR App is running on port ${PORT}`); });
