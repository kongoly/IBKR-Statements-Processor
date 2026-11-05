// ============================================================
// fx.js — Official daily USD/ILS rates from the Bank of Israel
// ============================================================
// Used by the Insights page to judge each shekel → dollar conversion against the days around it.
// These are public rates: the only thing sent is the date range asked for, nothing about the user or the account.
// Rates are saved in data/fx-usdils.json (gitignored with data/), so only days not saved yet are downloaded.

const fs   = require('fs');
const path = require('path');

const CACHE = path.join(__dirname, 'data', 'fx-usdils.json');
const BOI_URL = 'https://edge.boi.gov.il/FusionEdgeServer/sdmx/v2/data/dataflow/BOI.STATISTICS/EXR/1.0/RER_USD_ILS';

const isoDay = d => d.toISOString().slice(0, 10);
const addDays = (iso, n) => { const d = new Date(iso + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return isoDay(d); };

// Saved rates: { first, last, rates: { 'YYYY-MM-DD': rate } }. first/last = the range already downloaded.
function readCache() {
  try { return JSON.parse(fs.readFileSync(CACHE, 'utf8')); } catch (e) { return { first: null, last: null, rates: {} }; }
}

// One request to the Bank of Israel for a date range; returns { day: rate } (working days only)
async function download(from, to) {
  const url = `${BOI_URL}?startPeriod=${from}&endPeriod=${to}&format=csv`;
  if (new URL(url).hostname !== 'edge.boi.gov.il') throw new Error('Unexpected rates address');
  const res = await fetch(url, { signal: AbortSignal.timeout(15000) });
  if (!res.ok) throw new Error(`Bank of Israel answered ${res.status}`);
  const [head, ...lines] = (await res.text()).trim().split(/\r?\n/);
  const cols = head.split(','), di = cols.indexOf('TIME_PERIOD'), vi = cols.indexOf('OBS_VALUE');
  if (di < 0 || vi < 0) throw new Error('Unexpected answer from the Bank of Israel');
  const out = {};
  for (const line of lines) {
    const c = line.split(','), rate = Number(c[vi]);
    if (/^\d{4}-\d{2}-\d{2}$/.test(c[di]) && rate > 0) out[c[di]] = rate;
  }
  return out;
}

// Rates for from..to (YYYY-MM-DD). Downloads only the part not saved yet; today's rate is published in the
// afternoon, so the last few days are asked again until they're in the past. On failure, returns what's saved
// with offline: true (the page then falls back to IBKR's own rates).
async function getUsdIls(from, to) {
  const today = isoDay(new Date());
  if (to > today) to = today;
  const cache = readCache();
  let offline = false;
  try {
    const parts = [];
    if (!cache.first || from < cache.first) parts.push([from, cache.first ? addDays(cache.first, -1) : to]);
    if (cache.last && to > cache.last) parts.push([addDays(cache.last, -3), to]);
    for (const [a, b] of parts) {
      if (a > b) continue;
      Object.assign(cache.rates, await download(a, b));
      cache.first = !cache.first || a < cache.first ? a : cache.first;
      const doneUpTo = b < today ? b : addDays(today, -1);
      cache.last = !cache.last || doneUpTo > cache.last ? doneUpTo : cache.last;
    }
    if (parts.length) fs.writeFileSync(CACHE, JSON.stringify(cache));
  } catch (e) { offline = true; }
  const rates = Object.fromEntries(Object.entries(cache.rates).filter(([d]) => d >= from && d <= to).sort());
  return { rates, offline };
}

module.exports = { getUsdIls };
