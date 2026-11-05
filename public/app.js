// ============================================================
// app.js — Frontend Logic for IBKR Statement Processor
// ============================================================

// ============================================================
// STATE
// ============================================================
const state = {
  selectedYear:  null,
  selectedMonth: null,
  currentView:   'flex',
  selectedScope: 'month',
};

// ============================================================
// DOM REFERENCES
// ============================================================
const dropZone        = document.getElementById('drop-zone');
const fileInput       = document.getElementById('file-input');
const monthsList      = document.getElementById('months-list');
const welcome         = document.getElementById('welcome');
const dataView        = document.getElementById('data-view');
const tableContainer  = document.getElementById('table-container');
const statusBar       = document.getElementById('status-bar');
const loadingOverlay  = document.getElementById('loading-overlay');
const btnPortView     = document.getElementById('btn-port-view');
const btnFinView      = document.getElementById('btn-fin-view');
const btnFlexView     = document.getElementById('btn-flex-view');
const btnActivityView = document.getElementById('btn-activity-view');
const btnDlView       = document.getElementById('btn-dl-view');
const btnDelete       = document.getElementById('btn-delete');

// ============================================================
// STARTUP
// ============================================================
document.addEventListener('DOMContentLoaded', () => {
  loadMonthsList();
  // After a reload, reopen the same page/scope you were looking at
  try {
    const saved = JSON.parse(sessionStorage.getItem('ibkr_view_state'));
    if (saved) { state.currentView = saved.currentView; selectScope(saved.selectedScope, saved.selectedYear, saved.selectedMonth); return; }
  } catch (e) {}
  selectScope('total');
});

// Light / dark mode toggle (choice remembered in this browser)
const themeToggle = document.getElementById('theme-toggle');
function updateThemeIcon() { themeToggle.textContent = document.documentElement.classList.contains('dark') ? '☀️' : '🌙'; }
themeToggle.addEventListener('click', () => {
  // Colors fade over 0.3s instead of flashing (class removed once the fade is done)
  document.documentElement.classList.add('theme-fade');
  clearTimeout(themeToggle.timer);
  themeToggle.timer = setTimeout(() => document.documentElement.classList.remove('theme-fade'), 400);
  const dark = document.documentElement.classList.toggle('dark');
  try { localStorage.setItem('ibkr_theme', dark ? 'dark' : 'light'); } catch (e) {}
  updateThemeIcon();
});
updateThemeIcon();

// Side panel open / closed (remembered in this browser)
document.getElementById('sidebar-toggle').addEventListener('click', () => {
  const closed = document.documentElement.classList.toggle('sidebar-closed');
  try { localStorage.setItem('ibkr_sidebar', closed ? 'closed' : 'open'); } catch (e) {}
});

// Live reload: when the server restarts after a code change, the connection drops
// and reconnects. On reconnect, refresh the page so the new code shows up.
let liveReloadConnected = false;
new EventSource('/api/live-reload').onopen = () => {
  if (liveReloadConnected) location.reload();
  liveReloadConnected = true;
};

// ============================================================
// DRAG AND DROP
// ============================================================
dropZone.addEventListener('click', () => fileInput.click());
dropZone.addEventListener('dragover', e => { e.preventDefault(); e.stopPropagation(); dropZone.classList.add('dragover'); });
dropZone.addEventListener('dragenter', e => { e.preventDefault(); e.stopPropagation(); dropZone.classList.add('dragover'); });
dropZone.addEventListener('dragleave', () => dropZone.classList.remove('dragover'));
dropZone.addEventListener('drop', e => {
  e.preventDefault(); e.stopPropagation(); dropZone.classList.remove('dragover');
  const files = e.dataTransfer.files;
  if (files && files.length > 0) handleFiles(files);
});
fileInput.addEventListener('change', () => { handleFiles(fileInput.files); fileInput.value = ''; });

async function handleFiles(fileList) {
  if (!fileList || fileList.length === 0) return;
  const formData = new FormData();
  for (const file of fileList) formData.append('csvfiles', file);
  showLoading(true);
  setStatus('Uploading and processing files...');
  try {
    const response = await fetch('/api/upload', { method: 'POST', body: formData });
    const result = await response.json();
    if (result.results && result.results.length > 0) setStatus(`✅ Imported: ${result.results.map(r => `${r.monthName} ${r.year}`).join(', ')}`);
    await loadMonthsList();
    if (result.results && result.results.length === 1) {
      const r = result.results[0];
      await selectScope('month', r.year, r.month);
    }
  } catch (err) { setStatus('❌ Upload failed: ' + err.message); } finally { showLoading(false); }
}

// ============================================================
// SIDEBAR & SCOPE
// ============================================================
async function loadMonthsList() {
  try {
    const months = await fetch('/api/months').then(r => r.json());
    if (!months.length) { monthsList.innerHTML = '<p class="empty-msg">No months imported yet.</p>'; return; }
    const byYear = {};
    for (const m of months) { if (!byYear[m.year]) byYear[m.year] = []; byYear[m.year].push(m); }

    let html = `<button class="total-summary-btn ${state.selectedScope === 'total' ? 'active' : ''}" onclick="selectScope('total')">All time</button>`;
    html += Object.keys(byYear).sort((a, b) => Number(b) - Number(a)).map(year => `
        <div class="year-group">
          <div class="year-label ${state.selectedScope === 'year' && state.selectedYear == year ? 'active' : ''}" title="Show the whole year"
               onclick="selectScope('year', ${year})">${year}</div>
          <div class="month-grid">${byYear[year].slice().reverse().map(m => `
            <button class="month-btn ${state.selectedScope === 'month' && state.selectedYear == m.year && state.selectedMonth == m.month ? 'active' : ''}"
              title="${m.month_name} ${m.year}" onclick="selectScope('month', ${m.year}, ${m.month})">${m.month_name.slice(0, 3)}</button>`).join('')}
          </div>
        </div>`).join('');
    monthsList.innerHTML = html;
  } catch (err) { monthsList.innerHTML = '<p class="empty-msg">Error loading months.</p>'; }
}

async function selectScope(scope, year = null, month = null) {
  state.selectedScope = scope;
  state.selectedYear = year;
  state.selectedMonth = month;

  loadMonthsList();
  welcome.classList.add('hidden');
  dataView.classList.remove('hidden');
  refreshView();
}

function refreshView() {
  switch (state.currentView) {
    case 'portfolio': return showPortfolio();
    case 'activity':  return showActivity();
    case 'insights':  return showInsights();     // insights.js
    case 'download':  return showDownloadPage();
    case 'financial': return showFinancialSummary();   // Old Statements
    default:          return showFlexDownload();       // Financial Summary (API)
  }
}

// ============================================================
// VIEWS
// ============================================================
function setActiveBtn(btn) {
  if (!btn.classList.contains('active')) { pendingAnim = true; tableContainer.scrollTop = 0; }   // a new page starts at the top
  [btnPortView, btnFinView, btnFlexView, btnActivityView, btnInsightsView, btnDlView].forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  btnDelete.style.display = btn === btnFinView && state.selectedScope === 'month' ? 'inline-block' : 'none';
  // Side panel: uploaded CSV months on Old Statements, IBKR months everywhere else
  document.getElementById('sb-old').classList.toggle('hidden', btn !== btnFinView);
  document.getElementById('sb-api').classList.toggle('hidden', btn === btnFinView);
  try { sessionStorage.setItem('ibkr_view_state', JSON.stringify(state)); } catch (e) {}
}

async function showFinancialSummary() {
  state.currentView = 'financial';
  setActiveBtn(btnFinView);
  showLoading(true);
  try {
    let url = `/api/financial-summary/${state.selectedScope}?year=${state.selectedYear || ''}&month=${state.selectedMonth || ''}`;
    const res = await fetch(url).then(r => r.json());
    tableContainer.innerHTML = renderCombinedFinancialTable(res.summary, res.months || []);
    setStatus(`Old Statements - ${state.selectedScope.toUpperCase()}`);
  } catch (err) { setStatus('❌ Error: ' + err.message); } finally { showLoading(false); }
}

// Money format: 2 decimals (0 in the Financial Summary (API) table), minus sign before the symbol (e.g. -$43.27, ₪1,851.02)
const CUR_SYMBOL = { USD: '$', ILS: '₪' };
function money(n, cur = 'USD', dec = 2) {
  const r = Number(n.toFixed(dec)) || 0;   // rounds first, so -0.4 shows as $0, not -$0
  return (r < 0 ? '-' : '') + (CUR_SYMBOL[cur] || cur + ' ') + Math.abs(r).toLocaleString(undefined, { minimumFractionDigits: dec, maximumFractionDigits: dec });
}
// Faint centered dash for "nothing here"
const EMPTY_DASH = '<div class="empty-dash">—</div>';

// Deposits/withdrawals cell: only the currencies that actually moved; a dash if nothing did
function movedMoney(usd, ils, color, dec) {
  return `<td style="color:${color}">${[usd ? money(usd, 'USD', dec) : '', ils ? money(ils, 'ILS', dec) : ''].filter(Boolean).join('<br>') || EMPTY_DASH}</td>`;
}
// Green for money in, red for money out, neutral for zero
function signColor(n) { return n > 0 ? 'var(--pos)' : n < 0 ? 'var(--neg)' : 'inherit'; }

// One conversion line: ILS amounts in blue, USD in green, rate in grey
function renderConversion(c, rateLabel = '@', dec) {
  const amt = (n, cur) => `<span class="conv-${cur.toLowerCase()}">${money(n, cur, dec)}</span>`;
  return `<div class="conv-item">${amt(c.fromAmt, c.fromCur)} → ${amt(c.toAmt, c.toCur)} <span class="conv-rate">${rateLabel} ${c.rate.toFixed(4)}</span>${c.note ? `<div class="conv-note">${escapeHtml(c.note)}</div>` : ''}</div>`;
}

function renderCombinedFinancialTable(s, months) {
    if (!s) return '';
    // Average rate per direction, expressed as ILS per USD like IBKR's USD.ILS price
    const convTotals = s.conversionTotals.map(t => ({ ...t, rate: t.fromCur === 'ILS' ? t.fromAmt / t.toAmt : t.toAmt / t.fromAmt }));
    return `
    <div class="financial-view list-page">
        <div class="fin-header">
          <h2 style="color: var(--heading);">📜 Old Statements <small class="flex-view-label">(uploaded CSVs · ${state.selectedScope.toUpperCase()})</small></h2>
        </div>
        <div class="table-wrap">
        <table class="data-table fin-table old-table">
            <thead>
                <tr>
                    <th>Year</th>
                    <th>Month</th>
                    <th>Ending Cash</th>
                    <th>Invested Cash</th>
                    <th>Unrealized P/L</th>
                    <th>Israel Tax</th>
                    <th>Comm.</th>
                    <th>Divs.</th>
                    <th>WHT (USD)</th>
                    <th>Deposits</th>
                    <th>Withdrawals</th>
                    <th>Conversions</th>
                    <th style="border-left: 2px solid var(--border-strong);" title="IBKR realized trading P/L (commissions already included)">Realized P/L</th>
                    <th title="Realized P/L + dividends + US withholding tax (refunds add, charges subtract) + Israel tax">Calculated Realized P/L</th>
                </tr>
                <tr class="old-total">
                    <td colspan="2"><strong>TOTAL</strong></td>
                    <td><span class="conv-usd">${money(s.latestEndingCashUSD)}</span><br><span class="conv-ils">${money(s.latestEndingCashILS, 'ILS')}</span></td>
                    <td>${money(s.latestInvestedUSD)}</td>
                    <td style="color:${signColor(s.latestUnrealizedPL)}">${money(s.latestUnrealizedPL)}</td>
                    <td style="color:${signColor(s.totalIsraelTaxILS)}">${money(s.totalIsraelTaxILS, 'ILS')}<br><small>${money(s.totalIsraelTaxUSD)}</small></td>
                    <td>${money(s.totalCommissions)}</td>
                    <td style="color:${signColor(s.totalDividends)}">${money(s.totalDividends)}</td>
                    <td style="color:${signColor(s.totalWithholdingTaxUSD)}">${money(s.totalWithholdingTaxUSD)}</td>
                    ${movedMoney(s.totalDepositsUSD, s.totalDepositsILS, 'var(--pos)')}
                    ${movedMoney(s.totalWithdrawalsUSD, s.totalWithdrawalsILS, 'var(--neg)')}
                    <td class="fin-conv-cell">${convTotals.map(t => renderConversion(t, 'avg')).join('') || EMPTY_DASH}</td>
                    <td style="font-weight:800; border-left: 2px solid var(--border-strong); color:${signColor(s.totalTradingPL)}">${money(s.totalTradingPL)}</td>
                    <td style="font-weight:800; color:${signColor(s.totalRealizedPL)}">${money(s.totalRealizedPL)}</td>
                </tr>
                <tr><td colspan="14" class="old-spacer"></td></tr>
            </thead>
            <tbody>
                ${months.map((m, i) => `
                <tr style="--i:${i}">
                    ${i === 0 || months[i - 1].year !== m.year ? `<td rowspan="${months.filter(x => x.year === m.year).length}" class="fin-year-cell yc${m.year % 5}">${m.year}</td>` : ''}
                    <td><strong>${m.monthName}</strong></td>
                    <td><span class="conv-usd">${money(m.endingCashUSD)}</span><br><span class="conv-ils">${money(m.endingCashILS, 'ILS')}</span></td>
                    <td>${money(m.investedUSD)}</td>
                    <td style="color:${signColor(m.unrealizedPL)}">${money(m.unrealizedPL)}</td>
                    <td style="color:${signColor(m.israelTaxILS)}">${money(m.israelTaxILS, 'ILS')}<br><small>${money(m.israelTaxUSD)}</small></td>
                    <td>${money(m.commissions)}</td>
                    <td style="color:${signColor(m.dividends)}">${money(m.dividends)}</td>
                    <td style="color:${signColor(m.withholdingTaxUSD)}">${money(m.withholdingTaxUSD)}</td>
                    ${movedMoney(m.depositsUSD, m.depositsILS, 'var(--pos)')}
                    ${movedMoney(m.withdrawalsUSD, m.withdrawalsILS, 'var(--neg)')}
                    <td class="fin-conv-cell">${m.conversions.map(c => renderConversion(c)).join('') || EMPTY_DASH}</td>
                    <td style="font-weight:bold; border-left: 2px solid var(--border-strong); color:${signColor(m.tradingPL)}">${money(m.tradingPL)}</td>
                    <td style="font-weight:bold; color:${signColor(m.realizedPL)}">${money(m.realizedPL)}</td>
                </tr>`).join('')}
            </tbody>
        </table>
        </div>
    </div>`;
}

// ============================================================
// PORTFOLIO PAGE: net worth, headline numbers, money journey, totals
// Always uses the newest IBKR download (not the selected month/year), IBKR's USD/ILS rate
// and the bank balance the user types in.
// ============================================================
// Top of the Portfolio page: inputs, 4 headline numbers, the money journey, then "Account now" + "Totals".
// Everything that depends on the USD/ILS rate or the bank balance is filled in by wirePortfolio().
function renderPortfolioTop(nw, t) {
  const slot = id => `<span id="${id}"></span>`;
  const breakdown = t ? [['Realized P/L', t.realizedPL], ['Dividends', t.dividends], ['US WHT', t.withholdingTax], ['Israel tax & fees', t.feesUSD, t.feesILS]] : [];
  const max = Math.max(...breakdown.map(p => Math.abs(p[1])), 1);
  const byCur = (u, i) => [u ? `<span class="conv-usd">${money(u)}</span>` : '', i ? `<span class="conv-ils">${money(i, 'ILS')}</span>` : ''].filter(Boolean).join(' · ') || EMPTY_DASH;
  const node = (label, id, cls = '') => `<div class="jr-node ${cls}"><div class="jr-label">${label}</div><div class="jr-value" id="${id}"></div><div class="jr-sub" id="${id}-sub"></div></div>`;
  return `
    <div class="pf-head">
      <h2 style="color: var(--heading);">💼 Portfolio</h2>
      <div class="pf-inputs">
        <label class="pf-input"><span class="pf-input-label">USD/ILS${nw.fxDate ? ` · IBKR ${shortDate(nw.fxDate)}` : ''}</span>
          <span class="nw-field"><span class="nw-affix">$1 =</span><input type="number" step="0.0001" min="0" id="nw-rate" value="${nw.fxRate ? nw.fxRate.toFixed(4) : ''}" placeholder="3.15"><span class="nw-affix">₪</span></span></label>
        <label class="pf-input"><span class="pf-input-label">Bank</span>
          <span class="nw-field"><span class="nw-affix">₪</span><input type="number" step="0.01" id="nw-bank" value="${nw.bankILS ?? ''}" placeholder="0.00"></span></label>
      </div>
    </div>

    <div class="pf-kpis">
      <div class="pf-kpi"><div class="pf-kpi-label">Net worth</div><div class="pf-kpi-value">${slot('kpi-networth')}</div><div class="pf-kpi-small">${slot('kpi-networth-usd')}</div></div>
      <div class="pf-kpi"><div class="pf-kpi-label">Profit in ₪</div><div class="pf-kpi-value">${slot('kpi-profit')}</div><div class="pf-kpi-small">${slot('kpi-profit-pct')}</div></div>
      <div class="pf-kpi pf-kpi-return">
        <div class="pf-kpi-label">Time-weighted return</div>
        <div class="pf-kpi-value" style="color:${t ? signColor(t.twrPct) : 'inherit'}">${t ? pct(t.twrPct) : EMPTY_DASH}</div>
        <div class="pf-kpi-small">How well your investments did, whenever you deposited. Same as the IBKR app.</div>
        <div class="pf-return-actual">
          <span>Actual return<small>profit ÷ money you put in</small></span>
          <strong style="color:${t ? signColor(t.returnPct) : 'inherit'}">${t ? pct(t.returnPct) : EMPTY_DASH}</strong>
        </div>
      </div>
      <div class="pf-kpi"><div class="pf-kpi-label">Money put in</div><div class="pf-kpi-value">${slot('kpi-putin')}</div></div>
    </div>

    ${nw.putInILS != null ? `
    <div class="pf-card nw-journey">
      <div class="pf-card-title">If you sold everything today</div>
      <div class="jr-flow">
        ${node('₪ put in', 'jr-in', 'jr-start')}
        <div class="jr-arrow">→</div>
        <div class="jr-lanes">
          <div class="jr-lane jr-usd"><div class="jr-lane-label">Dollars</div>
            ${node('Converted to $', 'jr-conv')}<div class="jr-arrow">→</div>${node('Grew to', 'jr-invest')}<div class="jr-arrow">→</div>${node('25% tax', 'jr-tax')}<div class="jr-arrow">→</div>${node('Back to ₪', 'jr-back')}
          </div>
          <div class="jr-lane jr-ils"><div class="jr-lane-label">Shekels</div>
            ${node('Kept as ₪', 'jr-kept')}<div class="jr-arrow">→</div>${node('Israel tax &amp; fees', 'jr-fees')}<div class="jr-arrow">→</div>${node('₪ cash now', 'jr-cash')}
          </div>
        </div>
        <div class="jr-arrow">→</div>
        <div class="jr-node jr-end"><div class="jr-label">₪ you'd have</div><div class="jr-value" id="jr-have"></div><div class="jr-sub" id="jr-have-sub"></div></div>
      </div>
    </div>` : ''}

    <div class="pf-pair">
      <div class="pf-card">
        <div class="pf-card-title">Account now</div>
        <div class="pf-line"><span>Cash</span><strong>${byCur(nw.cashUSD, nw.cashILS)}</strong></div>
        <div class="pf-line"><span>Invested</span><strong><span class="nw-lock">🔒</span>${money(nw.investedUSD)}</strong></div>
        <div class="pf-line"><span>Unrealized P/L</span><strong style="color:${signColor(nw.unrealizedPL)}">${money(nw.unrealizedPL)}</strong></div>
        <div class="pf-line"><span>Tax if sold (25%)</span><strong style="color:var(--neg)">${slot('nw-tax')}</strong></div>
      </div>
      ${t ? `<div class="pf-card">
        <div class="pf-card-title">Totals since ${getMonthName(t.oldest.month).slice(0, 3)} ${t.oldest.year}</div>
        <div class="pf-line"><span>Deposits</span><strong>${byCur(t.depositsUSD, t.depositsILS)}</strong></div>
        ${t.withdrawalsUSD || t.withdrawalsILS ? `<div class="pf-line"><span>Withdrawals</span><strong>${byCur(t.withdrawalsUSD, t.withdrawalsILS)}</strong></div>` : ''}
        <div class="pf-line"><span>Conversions</span><strong>${t.conversions.map(x => renderConversion(x, 'avg')).join('') || EMPTY_DASH}</strong></div>
        <div class="pf-line pf-line-big"><span>Realized gain</span><strong style="color:${signColor(t.realizedGain)}">${money(t.realizedGain)}</strong></div>
        ${breakdown.map(([label, n, ilsAmt]) => `
          <div class="gs-row"><span class="gs-row-label">${label}</span>
            <span class="gs-row-track"><span class="gs-row-fill" style="width:${Math.abs(n) / max * 100}%;background:${n >= 0 ? 'var(--pos)' : 'var(--neg)'}"></span></span>
            <span class="gs-row-value" style="color:${signColor(n)}">${ilsAmt ? money(ilsAmt, 'ILS') : money(n)}</span></div>`).join('')}
      </div>` : ''}
    </div>
    <p class="nw-note">IBKR data: ${nw.statement || "none yet"}. <span id="nw-bank-updated">${nw.bankUpdated ? `Bank updated ${nw.bankUpdated.slice(0, 10)}.` : ''}</span></p>`;
}

// Live math: rate and bank can be changed; IBKR's latest rate is filled in automatically (only saved when IBKR has none)
function wirePortfolio(nw) {
  const rateInput = document.getElementById('nw-rate');
  const bankInput = document.getElementById('nw-bank');
  const sh = id => document.getElementById(id);
  const set = (id, html) => { if (sh(id)) sh(id).innerHTML = html; };
  const ils = n => `<span class="conv-ils">${money(n, 'ILS')}</span>`, usd = n => `<span class="conv-usd">${money(n)}</span>`;
  const colored = (n, cur) => `<span style="color:${signColor(n)}">${money(n, cur)}</span>`;
  const recalc = () => {
    const rate = parseFloat(rateInput.value);
    const bank = parseFloat(bankInput.value) || 0;
    if (!(rate > 0)) {
      const taxUSD = Math.max(0, nw.unrealizedPL) * CAPITAL_GAINS_TAX;
      document.querySelectorAll('.jr-value, .jr-sub, .pf-kpi span[id]').forEach(el => el.innerHTML = EMPTY_DASH);
      set('nw-tax', `-${money(taxUSD)}`);
      return;
    }
    const { taxUSD, dollars, afterTax, haveILS, inILS, profitILS, usdStart, ilsKept, buyRate } = portfolioMath(nw, rate, bank);
    set('kpi-networth', ils(haveILS + bank));
    set('kpi-networth-usd', `${money((haveILS + bank) / rate)} · after tax${bank ? ', incl. bank' : ''}`);
    set('kpi-profit', colored(profitILS, 'ILS'));
    set('kpi-profit-pct', inILS ? `<span style="color:${signColor(profitILS)}">${pct(profitILS / inILS * 100)}</span> · after tax` : '');
    set('kpi-putin', ils(inILS));
    // Israeli tax is paid in shekels: ₪ first, $ in brackets below
    set('nw-tax', `-${money(taxUSD * rate, 'ILS')}<small class="pf-sub-usd">(-${money(taxUSD)})</small>`);
    if (!sh('jr-in')) return;
    const pctTag = (n, base) => base ? `<strong style="color:${signColor(n)}">${pct(n / base * 100)}</strong>` : '';
    set('jr-in', ils(inILS));
    set('jr-conv', usd(usdStart)); set('jr-conv-sub', `at ${buyRate.toFixed(2)}`);
    set('jr-invest', usd(dollars)); set('jr-invest-sub', pctTag(dollars - usdStart, usdStart));
    set('jr-tax', `<span style="color:var(--neg)">-${money(taxUSD * rate, 'ILS')}</span>`); set('jr-tax-sub', `(-${money(taxUSD)})`);
    set('jr-back', ils(afterTax * rate)); set('jr-back-sub', `at ${rate.toFixed(2)} ${buyRate ? pctTag(rate - buyRate, buyRate) : ''}`);
    set('jr-kept', ils(ilsKept));
    set('jr-fees', colored(nw.cashILS - ilsKept, 'ILS'));
    set('jr-cash', ils(nw.cashILS));
    set('jr-have', ils(haveILS));
    set('jr-have-sub', `<span style="color:${signColor(profitILS)};font-weight:700">${money(profitILS, 'ILS')} · ${inILS ? pct(profitILS / inILS * 100) : ''}</span>`);
  };
  const save = async (key, input) => {
    const saved = await fetch(`/api/settings/${key}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ value: input.value }) }).then(r => r.json());
    if (key === 'bank_ils') sh('nw-bank-updated').textContent = `Bank updated ${saved.updated_at.slice(0, 10)}.`;
  };
  rateInput.addEventListener('input', recalc);
  bankInput.addEventListener('input', recalc);
  if (!nw.fxDate) rateInput.addEventListener('change', () => save('fx_usd_ils', rateInput));
  bankInput.addEventListener('change', () => save('bank_ils', bankInput));
  recalc();
}

async function showPortfolio() {
  state.currentView = 'portfolio';
  setActiveBtn(btnPortView);
  showLoading(true);
  try {
    const [nw, flexMonths] = await Promise.all([fetch('/api/net-worth').then(r => r.json()), fetch('/api/flex/overview').then(r => r.json())]);
    // Open positions and stats from the IBKR downloads (newest = the month in progress, if fetched). Always all months.
    const months = Array.isArray(flexMonths) ? flexMonths : [];
    renderFlexSidebar(months);
    const latest = months[0];
    tableContainer.innerHTML = `
      <div class="portfolio-view list-page">
        ${renderPortfolioTop(nw, months.length ? flexTotals(months) : null)}
        <section class="portfolio-section">
          <div class="portfolio-title">📂 Current Portfolio <small>${latest ? `(from IBKR, as of ${shortDate(latest.toDate)} ${latest.year})` : ''}</small></div>
          ${latest ? flexPositionsTable(latest, true) : '<p class="flex-note">No IBKR download yet. Click "⬇ Fetch from IBKR" at the top.</p>'}
        </section>
      </div>`;
    wirePortfolio(nw);
    setStatus('Portfolio');
  } catch (err) { setStatus('❌ Error: ' + err.message); } finally { showLoading(false); }
}

btnPortView.addEventListener('click', showPortfolio);
btnFinView.addEventListener('click', showFinancialSummary);
btnFlexView.addEventListener('click', showFlexDownload);
btnActivityView.addEventListener('click', showActivity);
btnDlView.addEventListener('click', showDownloadPage);
document.getElementById('btn-sheets-push').addEventListener('click', pushToSheets);

// Copies everything (Portfolio, monthly summary, positions, trades, cash activity) to your Google Sheet
async function pushToSheets() {
  const link = document.getElementById('sheets-link');
  showLoading(true);
  document.getElementById('loading-text').textContent = 'Sending to Google Sheets...';
  try {
    const r = await fetch('/api/sheets/push', { method: 'POST' }).then(r => r.json());
    if (r.error) return setStatus('❌ Google Sheets: ' + r.error);
    link.href = r.url; link.classList.remove('hidden');
    setStatus(`✅ Sent to Google Sheets (${r.tabs.join(', ')})`);
  } catch (err) { setStatus('❌ Google Sheets: ' + err.message); }
  finally { document.getElementById('loading-text').textContent = 'Processing...'; showLoading(false); }
}

// Runs a download with live progress and a Stop button. If one is already running, offers to stop it.
async function runFlexFetch(body) {
  const text = document.getElementById('loading-text'), stopBtn = document.getElementById('loading-stop');
  showLoading(true);
  text.textContent = 'Downloading from IBKR...';
  stopBtn.classList.remove('hidden');
  stopBtn.disabled = false;
  stopBtn.onclick = () => { stopBtn.disabled = true; text.textContent = 'Stopping...'; fetch('/api/flex/stop', { method: 'POST' }); };
  const poll = setInterval(async () => {
    const s = await fetch('/api/flex/status').then(r => r.json()).catch(() => ({}));
    if (s.busy && s.month && !stopBtn.disabled) text.textContent = `Downloading ${s.month} from IBKR (${s.n} of ${s.total})...`;
  }, 1500);
  try {
    const r = await fetch('/api/flex/fetch', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).then(r => r.json());
    if (r.busy) {
      if (confirm('Another IBKR download is still running. Stop it?')) {
        await fetch('/api/flex/stop', { method: 'POST' });
        setStatus('Stopping the running download... click Fetch again in a few seconds.');
      } else setStatus('A download is still running.');
      return;
    }
    welcome.classList.add('hidden'); dataView.classList.remove('hidden');
    await refreshView();
    setStatus(flexResultMessage(r));
  } catch (err) { setStatus('❌ Download failed: ' + err.message); }
  finally { clearInterval(poll); stopBtn.classList.add('hidden'); text.textContent = 'Processing...'; showLoading(false); }
}

function flexResultMessage(r) {
  if (r.error) return '❌ ' + r.error;
  const parts = [];
  if (r.months.length) parts.push(`✅ Downloaded from IBKR: ${r.months.join(', ')}`);
  if (r.skipped.length) parts.push(`Already had: ${r.skipped.join(', ')}`);
  if (r.stopped) parts.push('⏹ Stopped');
  return parts.join('. ') || 'Nothing to download.';
}

// Financial Summary (API): clicking a month row = clicking it in the side panel (only that month, with its
// details below); clicking the same month again goes back to all months
function toggleFlexMonth(key) {
  if (flexView && flexView.from === key && flexView.to === key) setFlexView(null); else setFlexView(key);
}

// Which months the API, Activity and Insights pages show: null = all time, otherwise { from, to } as 'YYYY-MM'.
// Remembered in this browser. The tables and their totals only count these months.
let flexView = null;
try { flexView = JSON.parse(localStorage.getItem('ibkr_flex_view')); } catch (e) {}
function setFlexView(from, to = from) {
  if (from && to < from) [from, to] = [to, from];
  flexView = from ? { from, to } : null;
  try { localStorage.setItem('ibkr_flex_view', JSON.stringify(flexView)); } catch (e) {}
  pendingAnim = true;
  const scrolled = tableContainer.scrollTop;
  const show = state.currentView === 'activity' ? showActivity() : state.currentView === 'insights' ? showInsights() : showFlexDownload();
  return show.then(() => glideToTop(scrolled));
}
// Picked from further down the page: the new page builds at the top while the view glides up to it, arriving
// as the build-up animation ends. A spacer keeps the old scroll position reachable while the (shorter) page builds.
function glideToTop(from) {
  const el = tableContainer;
  if (!from || reducedMotion()) { el.scrollTop = 0; return; }
  const spacer = document.createElement('div');
  spacer.style.height = Math.max(0, from + el.clientHeight - el.scrollHeight) + 'px';
  el.appendChild(spacer);
  el.scrollTop = from;
  const ends = el.getAnimations({ subtree: true }).map(a => a.effect.getComputedTiming().endTime);
  const ms = Math.max(250, ...ends.filter(Number.isFinite)), start = performance.now();
  const frame = now => {
    const p = Math.min(1, (now - start) / ms);
    el.scrollTop = from * (1 - easeInOut(p));
    if (p < 1) requestAnimationFrame(frame); else spacer.remove();
  };
  requestAnimationFrame(frame);
}
// The "Show all" button on Financial Summary, Activity and Insights: all months, every column and category.
// Highlighted only while something on the page is filtered; otherwise a quiet outline, and clicking it does nothing.
const pageFiltered = (hidden = flexHidden) => !!flexView || (state.currentView === 'flex' && hidden.length > 0) || (state.currentView === 'activity' && activityHidden.length > 0);
function showEverything() {
  if (!pageFiltered()) return;
  settle();
  flexHidden = [];
  activityHidden = [];
  try { localStorage.setItem('ibkr_flex_hidden', '[]'); localStorage.setItem('ibkr_cash_hidden', '[]'); } catch (e) {}
  setFlexView(null);
}
const showAllButton = () => `<button class="show-all-btn${pageFiltered() ? '' : ' idle'}" onclick="showEverything()" title="${pageFiltered() ? 'Show all months, every column and category' : 'Everything is already shown'}">↺ Show all</button>`;
// One month shown: a light touch of its year's color on the page (month-theme + yc0–yc4, same as its year outline)
const monthTheme = months => months.length === 1 ? ` month-theme yc${months[0].year % 5}` : '';
const flexViewLabel = () => flexView ? (flexView.from === flexView.to ? monthLabel(flexView.from) : `${monthLabel(flexView.from)} → ${monthLabel(flexView.to)}`) : 'All time';
// Click a month = that month; Shift+click = a range from the current start to that month
function pickFlexMonth(key, ev) {
  if (ev && ev.shiftKey && flexView) setFlexView(flexView.from, key); else setFlexView(key);
}
const inFlexView = key => !flexView || (key >= flexView.from && key <= flexView.to);
const monthLabel = key => `${getMonthName(+key.slice(5)).slice(0, 3)} ${key.slice(0, 4)}`;

// Side panel for the API page: All time, a From/To range, then years and months (newest first)
function renderFlexSidebar(allMonths) {
  const el = document.getElementById('flex-months-list');
  if (!allMonths.length) { el.innerHTML = '<p class="empty-msg">Nothing downloaded yet.</p>'; return; }
  const keys = allMonths.map(m => m.fromDate.slice(0, 7));
  const first = keys[keys.length - 1], last = keys[0];
  const byYear = {};
  for (const k of keys) (byYear[k.slice(0, 4)] ??= []).push(k);
  el.innerHTML = `
    <button class="total-summary-btn ${flexView ? '' : 'active'}" onclick="setFlexView(null)">All time</button>
    <div class="sb-range">
      <label>From <input type="month" id="sb-from" min="${first}" max="${last}" value="${flexView?.from || first}"></label>
      <label>To <input type="month" id="sb-to" min="${first}" max="${last}" value="${flexView?.to || last}"></label>
      <button class="sb-range-go" onclick="setFlexView(document.getElementById('sb-from').value, document.getElementById('sb-to').value)">Show range</button>
    </div>
    ${Object.keys(byYear).sort((a, b) => b - a).map(y => {
      const ks = byYear[y], yFrom = ks[ks.length - 1], yTo = ks[0];
      const yearActive = flexView && flexView.from === yFrom && flexView.to === yTo;
      const cls = k => !flexView || !inFlexView(k) ? '' : (k === flexView.from || k === flexView.to ? 'active' : 'in-range');
      return `<div class="year-group">
        <div class="year-label ${yearActive ? 'active' : ''}" title="Show the whole year" onclick="setFlexView('${yFrom}', '${yTo}')">${y}</div>
        <div class="month-grid">${ks.slice().reverse().map(k => `<button class="month-btn ${cls(k)}"
          title="${getMonthName(+k.slice(5))} ${y} · Shift+click to select a range" onclick="pickFlexMonth('${k}', event)">${getMonthName(+k.slice(5)).slice(0, 3)}</button>`).join('')}</div>
      </div>`;
    }).join('')}`;
}

const monthISO = (offset = 0) => { const d = new Date(); d.setDate(1); d.setMonth(d.getMonth() + offset); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`; };
const thisMonthISO = () => monthISO(0);

// The chosen from/to months are remembered in this browser, so they don't reset after a fetch or reload
function savedFlexRange() {
  let r = {};
  try { r = JSON.parse(localStorage.getItem('ibkr_flex_range')) || {}; } catch (e) {}
  const max = thisMonthISO(), clamp = v => (/^\d{4}-\d{2}$/.test(v) && v <= max ? v : max);
  return { from: clamp(r.from), to: clamp(r.to) };
}
function rememberFlexRange() {
  const from = document.getElementById('flex-from').value, to = document.getElementById('flex-to').value;
  try { localStorage.setItem('ibkr_flex_range', JSON.stringify({ from, to })); } catch (e) {}
  document.querySelectorAll('.flex-preset').forEach(b => b.classList.toggle('active', b.dataset.from === from && b.dataset.to === to));
}
// Quick picks fill both boxes
function setFlexRange(from, to) {
  document.getElementById('flex-from').value = from;
  document.getElementById('flex-to').value = to;
  rememberFlexRange();
}

// Download every month from "from" to "to" (one month if they're equal; IBKR limits the pace, so ~15s per month)
async function fetchFlexRange() {
  const from = document.getElementById('flex-from').value;
  const to = document.getElementById('flex-to').value;
  const redownload = document.getElementById('flex-redownload').checked;
  if (!from || !to || from > to) { setStatus('❌ Pick a "from" month that is not after the "to" month.'); return; }
  await runFlexFetch({ from, to, redownload });
}

// Download page: what to fetch from IBKR (quick picks, From/To, re-download) and the months already downloaded
async function showDownloadPage() {
  state.currentView = 'download';
  setActiveBtn(btnDlView);
  showLoading(true);
  try {
    const all = await fetch('/api/flex/overview').then(r => r.json());
    if (all.error) throw new Error(all.error);
    renderFlexSidebar(all);
    tableContainer.innerHTML = renderDownloadPage(all);
    setStatus('Fetch from IBKR');
  } catch (err) { setStatus('❌ Error: ' + err.message); } finally { showLoading(false); }
}

function renderDownloadPage(all) {
  const range = savedFlexRange();
  const when = ms => new Date(ms).toLocaleString('en-GB', { dateStyle: 'short', timeStyle: 'short' });
  return `<div class="list-page">
    <div class="fin-header"><h2 style="color: var(--heading);">⬇ Fetch from IBKR</h2></div>
    <section class="dl-card">
      <div class="dl-label">Quick pick</div>
      <div class="dl-row">${[
        ['This month', monthISO(0), monthISO(0)],
        ['Last month', monthISO(-1), monthISO(-1)],
        ['Last 3 months', monthISO(-2), monthISO(0)],
        ['This year', `${new Date().getFullYear()}-01`, monthISO(0)],
        ['Everything', all.length ? all[all.length - 1].fromDate.slice(0, 7) : monthISO(0), monthISO(0)],
      ].map(([label, from, to]) => `<button class="flex-preset${range.from === from && range.to === to ? ' active' : ''}" data-from="${from}" data-to="${to}" onclick="setFlexRange('${from}', '${to}')">${label}</button>`).join('')}</div>
      <div class="dl-label">Months</div>
      <div class="dl-row" title="Same month in both = just that month. 'To' = this month = up to yesterday.">
        From <input type="month" id="flex-from" value="${range.from}" max="${thisMonthISO()}" onchange="rememberFlexRange()">
        to <input type="month" id="flex-to" value="${range.to}" max="${thisMonthISO()}" onchange="rememberFlexRange()">
        <button class="dl-go" onclick="fetchFlexRange()">⬇ Fetch</button>
      </div>
      <label class="dl-check" title="Only needed after changing the Flex Query in IBKR"><input type="checkbox" class="switch" id="flex-redownload"><span>Re-download months I already have</span></label>
      <p class="flex-note dl-note">Months you already have are skipped; this month is always downloaded again (it's still in progress). IBKR allows about one month every 15 seconds.</p>
    </section>
    ${flexTable(`Downloaded months (${all.length})`,['Month', 'Covers', 'Downloaded'],
      all.map(m => [`<strong>${getMonthName(m.month)} ${m.year}</strong>`, `${dmy(m.fromDate)} → ${dmy(m.toDate)}${m.partial ? ' <small>in progress</small>' : ''}`, when(m.downloaded)]),
      { align: 'lll' }) || '<p class="flex-note">Nothing downloaded yet.</p>'}
  </div>`;
}

// Loads every IBKR month and redraws the side panel. Returns { all, months } (months = the ones picked
// in the side panel, newest first), or null after showing a message when there's nothing to show.
async function pickedFlexMonths() {
  const all = await fetch('/api/flex/overview').then(r => r.json());
  if (all.error) throw new Error(all.error);
  renderFlexSidebar(all);
  if (!all.length) { tableContainer.innerHTML = '<p class="empty-msg">Nothing downloaded yet. Click "⬇ Fetch from IBKR" at the top.</p>'; return null; }
  const months = all.filter(m => inFlexView(m.fromDate.slice(0, 7)));
  if (!months.length) { tableContainer.innerHTML = '<p class="empty-msg">No downloaded months in this range. Pick other months in the side panel.</p>'; return null; }
  return { all, months };
}

async function showFlexDownload() {
  state.currentView = 'flex';
  setActiveBtn(btnFlexView);
  showLoading(true);
  try {
    const picked = await pickedFlexMonths();
    if (!picked) return;
    flexShown = picked.months;
    tableContainer.innerHTML = renderFlexPage(flexShown);
    setStatus('Financial Summary (API)');
  } catch (err) { setStatus('❌ Error: ' + err.message); } finally { showLoading(false); }
}

const shortDate = iso => new Date(iso + 'T00:00:00').toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
const pct = n => (n > 0 ? '+' : '') + n.toFixed(2) + '%';


// Financial Summary page: the table, plus the clicked month's details when exactly one month is shown
function renderFlexPage(months) {
  return `<div class="list-page${monthTheme(months)}">${renderFlexOverview(months) + (months.length === 1 ? renderFlexDetails(months[0]) : '')}</div>`;
}

// Column chooser: groups and single columns that are hidden (keys), remembered in this browser.
// Checking a group shows its columns; unchecking it hides them all. Month is always shown.
let flexShown = [];   // the months on screen, so the chooser can redraw without reloading
let flexHidden = [];
try { flexHidden = JSON.parse(localStorage.getItem('ibkr_flex_hidden')) || []; } catch (e) {}
const FLEX_GROUPS = ['value', 'money', 'realized', 'holdings'];
// Visible column keys for a hidden list (the column list doesn't depend on the numbers)
const flexKeys = hidden => flexColumns({}, true).flatMap(g => hidden.includes(g.key) ? [] : g.cols.filter(c => !hidden.includes(c.key)).map(c => c.key));
const reducedMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

// Column add/remove motion: the columns' widths glide from the old layout to the new one, so a removed column is
// squeezed shut by its neighbours and an added one opens up between them.
const MORPH_MS = 280;
const easeInOut = p => -(Math.cos(Math.PI * p) - 1) / 2;
// Width of each column (Month + data-col keys), read from the TOTAL row
const colWidths = table => Object.fromEntries([...table.querySelector('tr.flex-total').cells].map(td => [td.dataset.col || 'month', td.getBoundingClientRect().width]));
const rowHeights = table => [...table.rows].map(r => r.getBoundingClientRect().height);
// Text doesn't re-wrap while columns move, so rows don't jump; a row whose height differs in the new layout
// (e.g. its tallest cell left) glides from the old height (hFrom) to the new one (hTo) with the columns.
function morphColumns(table, from, to, hFrom, hTo, done) {
  const cols = [...table.querySelectorAll('col')], rows = [...table.rows], start = performance.now();
  const lockRows = hFrom.length === rows.length && hTo.length === rows.length;
  // Cells coming / going don't set the row height while they move (their text sits in a zero-height box, clipped by the cell)
  table.querySelectorAll('.col-in, .col-out').forEach(cell => {
    const box = document.createElement('div'), inner = document.createElement('div');
    box.className = 'mclip';
    inner.append(...cell.childNodes);
    box.append(inner);
    cell.append(box);
  });
  table.classList.add('flex-morph');
  let raf;
  // Also called straight away when another box is clicked mid-motion, so quick clicks never lose a change
  const finish = morphColumns.finish = () => {
    cancelAnimationFrame(raf);
    morphColumns.finish = null;
    table.classList.remove('flex-morph');
    cols.forEach(c => c.style.width = '');
    rows.forEach(r => r.style.height = '');
    if (done) done();
  };
  const frame = now => {
    const e = easeInOut(Math.min(1, (now - start) / MORPH_MS));
    cols.forEach(c => { const a = from[c.dataset.col] || 0; c.style.width = a + ((to[c.dataset.col] || 0) - a) * e + 'px'; });
    if (lockRows) rows.forEach((r, i) => r.style.height = hFrom[i] + (hTo[i] - hFrom[i]) * e + 'px');
    if (now - start < MORPH_MS) raf = requestAnimationFrame(frame); else finish();
  };
  frame(start);
}
function setFlexHidden(keys) {
  const before = flexKeys(flexHidden), after = flexKeys(keys);
  const added = after.filter(k => !before.includes(k)), removed = before.filter(k => !after.includes(k));
  const groupsOn = FLEX_GROUPS.filter(g => flexHidden.includes(g) && !keys.includes(g));
  const groupsOff = FLEX_GROUPS.filter(g => !flexHidden.includes(g) && keys.includes(g));
  const old = tableContainer.querySelector('.flex-table'), animate = old && !reducedMotion();
  if (!old) return;
  tableContainer.classList.remove('page-enter');   // a page build-up still running mustn't replay on the new table
  const widthsBefore = animate ? colWidths(old) : null, heightsBefore = animate ? rowHeights(old) : [];
  // The chooser is updated in place, so its ticks and dimming change smoothly
  const chooser = tableContainer.querySelector('.col-chooser');
  chooser.querySelectorAll('[data-key]').forEach(el => {
    const on = !keys.includes(el.dataset.key);
    el.classList.toggle('on', on);
    if (el.tagName === 'LABEL') el.querySelector('input').checked = on;
    if (el.classList.contains('cc-group')) el.querySelectorAll('.cc-sub input').forEach(i => i.disabled = !on);
  });
  const allBtn = tableContainer.querySelector('.show-all-btn');
  allBtn?.classList.toggle('idle', !pageFiltered(keys));
  chooser.querySelector('.cc-count').textContent = ccCount(chooser.querySelectorAll('.cc-group.on .cc-sub.on').length, chooser.querySelectorAll('.cc-sub').length);
  // The new table, laid out by the browser but not yet on screen
  const newTable = () => { const box = document.createElement('div'); box.innerHTML = renderFlexOverview(flexShown); return box.querySelector('.flex-table'); };
  const redraw = () => {
    flexHidden = keys;
    try { localStorage.setItem('ibkr_flex_hidden', JSON.stringify(flexHidden)); } catch (e) {}
    const table = newTable();
    tableContainer.querySelector('.flex-table').replaceWith(table);
    highlightCols(hlKey);
    if (!animate || (!added.length && !groupsOn.length)) return;
    // New columns start at zero width and open up; their content fades in with a faint wash of the group's color
    added.forEach(k => table.querySelectorAll(`[data-col="${k}"]`).forEach(el => el.classList.add('col-in')));
    groupsOn.forEach(g => table.querySelectorAll(`th[data-group="${g}"]`).forEach(el => el.classList.add('col-in')));
    morphColumns(table, widthsBefore, colWidths(table), heightsBefore, rowHeights(table));
  };
  if (!animate || !removed.length) return redraw();
  // Removing: lay out the new table out of sight to know where every column ends up, then close the gap
  const probe = document.createElement('div');
  probe.style.cssText = `position:absolute;left:0;top:0;visibility:hidden;width:${old.parentElement.clientWidth}px`;
  const was = flexHidden;
  flexHidden = keys;
  probe.appendChild(newTable());
  flexHidden = was;
  tableContainer.appendChild(probe);
  const widthsAfter = colWidths(probe.firstChild), heightsAfter = rowHeights(probe.firstChild);
  probe.remove();
  removed.forEach(k => old.querySelectorAll(`[data-col="${k}"]`).forEach(el => el.classList.add('col-out')));
  groupsOff.forEach(g => old.querySelectorAll(`th[data-group="${g}"]`).forEach(el => el.classList.add('col-out')));
  morphColumns(old, widthsBefore, widthsAfter, heightsBefore, heightsAfter, redraw);
}
const ccCount = (shown, total) => `${shown} of ${total} columns shown`;
// Hovering a checkbox above the table lights up the column(s) it controls (a group: its header box and all its columns)
let hlKey = null;
function highlightCols(key) {
  tableContainer.querySelectorAll('.flex-table .hl').forEach(el => el.classList.remove('hl'));
  if (!key) return;
  const group = flexColumns({}, true).find(g => g.key === key);
  const sel = group ? [...group.cols.map(c => `[data-col="${c.key}"]`), `th[data-group="${key}"]`] : [`[data-col="${key}"]`];
  tableContainer.querySelectorAll(sel.map(x => '.flex-table ' + x).join(',')).forEach(el => el.classList.add('hl'));
}
tableContainer.addEventListener('mouseover', e => {
  const key = e.target.closest('.col-chooser [data-key]')?.dataset.key || null;
  if (key !== hlKey) highlightCols(hlKey = key);
});
tableContainer.addEventListener('mouseleave', () => highlightCols(hlKey = null));
// A click mid-motion first finishes the running one, so the new choice starts from what's really shown
const settle = () => morphColumns.finish && morphColumns.finish();
const toggleFlexCol = key => { settle(); setFlexHidden(flexHidden.includes(key) ? flexHidden.filter(k => k !== key) : [...flexHidden, key]); };
const setAllFlexCols = on => { settle(); setFlexHidden(on ? [] : [...new Set([...flexHidden, ...FLEX_GROUPS])]); };

// The table's columns in their groups: key, chooser label, header (+ tooltip) and the cell for a month or the TOTAL row.
// Each group has a soft color, all close together in the blue family (hue), used only for outlines and the chooser's ticks.
function flexColumns(t, hasWithdrawals) {
  // Whole amounts in this table (no cents) so it fits a laptop screen with bigger text
  const $ = (n, cur) => money(n, cur, 0);
  const pl = (n, bold) => `<td style="color:${signColor(n)}${bold ? ';font-weight:bold' : ''}">${$(n)}</td>`;
  const v = (m, T, k) => T ? t[k] : m[k];
  return [
    { key: 'value', label: 'Account value', hue: 200, cols: [
      { key: 'start', label: 'Start', th: 'Start',
        td: (m, T) => `<td>${T ? `${$(t.putIn)}<br><small title="Starting value + all deposits − withdrawals">put in</small>` : $(m.startValue)}</td>` },
      { key: 'end', label: 'End', th: 'End', td: m => `<td><strong>${$(m.endValue)}</strong></td>` },
      { key: 'return', label: 'Return', th: 'Return<small class="ret-sub">time-weighted</small>',
        tip: "IBKR's time-weighted return (deposits and withdrawals left out). TOTAL: the months chained together, like 'since inception' in the IBKR app; below it, the actual return = profit ÷ money put in",
        td: (m, T) => { const r = T ? t.twrPct : m.twr; return `<td style="color:${signColor(r)};font-weight:bold">${pct(r)}${T ? `<small class="ret-sub">time-weighted</small><small class="ret-actual" title="Profit ÷ money put in">actual <span style="color:${signColor(t.returnPct)}">${pct(t.returnPct)}</span></small>` : ''}</td>`; } },
      { key: 'gain', label: 'Gain', th: 'Gain', tip: 'End − start − deposits − withdrawals: how much your money grew',
        td: (m, T) => pl(T ? t.profit : monthGain(m), true) },
    ] },
    { key: 'money', label: 'Money in / out', hue: 218, cols: [
      { key: 'deposits', label: 'Deposits', th: 'Deposits', td: (m, T) => movedMoney(v(m, T, 'depositsUSD'), v(m, T, 'depositsILS'), 'var(--pos)', 0) },
      ...(hasWithdrawals ? [{ key: 'withdrawals', label: 'Withdrawals', th: 'Withdr.', td: (m, T) => movedMoney(v(m, T, 'withdrawalsUSD'), v(m, T, 'withdrawalsILS'), 'var(--neg)', 0) }] : []),
      { key: 'conversions', label: 'Conversions', th: 'Conversions',
        td: (m, T) => `<td class="fin-conv-cell">${(T ? t.conversions.map(x => renderConversion(x, 'avg', 0)) : m.conversions.map(x => renderConversion(x, '@', 0))).join('') || EMPTY_DASH}</td>` },
    ] },
    { key: 'realized', label: 'Realized profit, income & costs', hue: 236, cols: [
      { key: 'realizedGain', label: 'Realized gain', th: 'Realized Gain', tip: 'Realized P/L + dividends + WHT + fees (Israel tax): the money you actually made, like Calculated Realized P/L in Financial Summary',
        td: (m, T) => pl(T ? t.realizedGain : realizedGainOf(m), true) },
      { key: 'realizedPL', label: 'Realized P/L', th: 'Realized P/L', tip: 'Profit/loss from sales (commissions included; shown small below)',
        td: (m, T) => `<td style="color:${signColor(v(m, T, 'realizedPL'))}">${$(v(m, T, 'realizedPL'))}<small class="fin-comm" title="Commissions (already included in Realized P/L)">comm. ${$(v(m, T, 'commissions'))}</small></td>` },
      { key: 'dividends', label: 'Dividends', th: 'Divs.', td: (m, T) => pl(v(m, T, 'dividends')) },
      { key: 'wht', label: 'WHT', th: 'WHT', tip: 'US tax withheld on dividends', td: (m, T) => pl(v(m, T, 'withholdingTax')) },
      { key: 'fees', label: 'Fees', th: 'Fees', tip: 'Mostly the Israel tax, charged in ILS (USD value below)',
        td: (m, T) => `<td style="color:${signColor(v(m, T, 'feesUSD'))}">${v(m, T, 'feesILS') ? $(v(m, T, 'feesILS'), 'ILS') + '<br><small>' + $(v(m, T, 'feesUSD')) + '</small>' : $(v(m, T, 'feesUSD'))}</td>` },
    ] },
    { key: 'holdings', label: 'Holdings at month end', hue: 254, cols: [
      { key: 'cash', label: 'Cash', th: 'Cash', td: m => `<td>${m.hasCashCurrency
        ? `<span class="conv-usd">${$(m.endingCashUSD)}</span><br><span class="conv-ils">${$(m.endingCashILS, 'ILS')}</span>`
        : `<span class="conv-usd" title="Total in USD. Tick 'Currency' in the Flex Cash Report to split USD / ILS">${$(m.endingCash)}</span>`}</td>` },
      { key: 'invested', label: 'Invested', th: 'Invested', td: m => `<td>${$(m.invested)}</td>` },
      { key: 'unrealized', label: 'Unrealized P/L', th: 'Unreal. P/L', td: m => pl(m.unrealizedPL) },
    ] },
  ].map(g => ({ ...g, cols: g.cols.map(c => ({ ...c, hue: g.hue })) }));
}

// Checkboxes above the table: one card per group with its columns as smaller checkboxes. A group that's off keeps
// its card and pills (dimmed, not clickable), so nothing moves when groups are switched.
function flexChooser(groups) {
  const box = (key, label, cls, disabled) => {
    const on = !flexHidden.includes(key);
    return `<label class="${cls}${on ? ' on' : ''}" data-key="${key}"><input type="checkbox"${on ? ' checked' : ''}${disabled ? ' disabled' : ''} onchange="toggleFlexCol('${key}')"><span>${escapeHtml(label)}</span></label>`;
  };
  return `<div class="col-chooser">
    ${groups.map(g => `<div class="cc-group${flexHidden.includes(g.key) ? '' : ' on'}" data-key="${g.key}" style="--hue:${g.hue}">${box(g.key, g.label, 'cc-main')}
      <div class="cc-subs">${g.cols.map(c => box(c.key, c.label, 'cc-sub', flexHidden.includes(g.key))).join('')}</div></div>`).join('')}
    <div class="cc-actions"><span class="cc-count">${ccCount(groups.filter(g => !flexHidden.includes(g.key)).flatMap(g => g.cols).filter(c => !flexHidden.includes(c.key)).length, groups.flatMap(g => g.cols).length)}</span>
      <button class="flex-preset" onclick="setAllFlexCols(true)">Check all</button><button class="flex-preset" onclick="setAllFlexCols(false)">Uncheck all</button></div>
  </div>`;
}

// months = the months shown (newest first)
function renderFlexOverview(months) {
  const t = flexTotals(months), latest = t.latest;
  const groups = flexColumns(t, !!(t.withdrawalsUSD || t.withdrawalsILS));
  const shown = groups.map(g => ({ ...g, cols: flexHidden.includes(g.key) ? [] : g.cols.filter(c => !flexHidden.includes(c.key)) })).filter(g => g.cols.length);
  const visCols = shown.flatMap(g => g.cols);
  const cols = 1 + visCols.length;
  const years = [...new Set(months.map(m => m.year))];
  // Tag each cell with its column key and hue; the first column of each group gets the thicker line (data-g)
  const firsts = new Set(shown.map(g => g.cols[0].key)), edge = c => firsts.has(c.key) ? ' data-g' : '';
  const lasts = new Set(shown.map(g => g.cols.at(-1).key));
  const tag = (html, c) => html.replace(/^<td( style=")?/, (_, st) => `<td data-col="${c.key}"${edge(c)} style="--hue:${c.hue}${st ? ';' : '"'}`);
  const cells = (m, isTotal) => visCols.map(c => tag(c.td(m, isTotal), c)).join('');
  return `
  <div class="financial-view flex-view">
    <div class="fin-header">
      <h2 style="color: var(--heading);">📊 Financial Summary (API) <small class="flex-view-label">${flexViewLabel()}</small></h2>
      ${showAllButton()}
    </div>
    ${flexChooser(groups)}
    <div class="table-wrap">
    <table class="fin-table flex-table" style="--step:${Math.min(40, Math.round(800 / (months.length + years.length)))}ms">
      <colgroup><col data-col="month">${visCols.map(c => `<col data-col="${c.key}">`).join('')}</colgroup>
      <thead>
        <tr>
          <th${visCols.length ? ' rowspan="2"' : ''}>Month</th>
          ${shown.map(g => `<th colspan="${g.cols.length}" class="flex-group" data-g data-group="${g.key}" style="--hue:${g.hue}">${escapeHtml(g.label)}</th>`).join('')}
        </tr>
        ${visCols.length ? `<tr>${visCols.map(c => `<th data-col="${c.key}"${edge(c)}${lasts.has(c.key) ? ' data-ge' : ''} style="--hue:${c.hue}"${c.tip ? ` title="${escapeHtml(c.tip)}"` : ''}>${c.th}</th>`).join('')}</tr>` : ''}
        <tr class="flex-total">
          <td><strong>TOTAL</strong></td>${cells(latest, true)}
        </tr>
        <tr><td colspan="${cols}" class="flex-spacer"></td></tr>
      </thead>
      ${years.map((y, yi) => `
      <tbody class="flex-year-block yc${y % 5}">
        <tr class="flex-year" style="--i:${yi + months.findIndex(m => m.year === y)};--b:${yi}"><td colspan="${cols}">${y}</td></tr>
        ${months.map((m, i) => m.year !== y ? '' : `
        <tr class="flex-row${i % 2 ? ' alt' : ''}${months.length === 1 ? ' flex-selected' : ''}" style="--i:${yi + i + 1};--b:${yi}" onclick="toggleFlexMonth('${m.fromDate.slice(0, 7)}')"
          title="${months.length === 1 ? 'Click to show all months again' : `Click to show only ${getMonthName(m.month)} ${m.year}`}">
          <td class="flex-month"><strong>${getMonthName(m.month).slice(0, 3)}</strong>${m.partial ? `<div class="flex-partial" title="Month in progress">to ${shortDate(m.toDate)}</div>` : ''}</td>${cells(m)}
        </tr>`).join('')}
      </tbody>`).join(`<tbody class="flex-gap"><tr><td colspan="${cols}"></td></tr></tbody>`)}
    </table>
    </div>
  </div>`;
}

// A details card: title + a table as wide as the page. Cells are ready-made HTML.
// opts.align = one letter per column: l (text, left) or r (numbers, right). opts.total = the total row, first when
// opts.totalOnTop (long lists).
function flexTable(title, headers, rows, opts = {}) {
  if (!rows.length) return '';
  const al = i => ({ l: 'l', r: 'r' })[(opts.align || '')[i]] || '';
  let n = 0;   // row number, for the build-up animation
  const tr = (r, cls = '') => `<tr class="${cls}" style="--i:${n++}">${r.map((c, i) => `<td class="${al(i)}">${c}</td>`).join('')}</tr>`;
  const total = opts.total ? tr(opts.total, 'total-row') : '';
  return `
    <section class="nice-section">
      ${title ? `<h3 class="nice-title">${escapeHtml(title)}</h3>` : ''}
      <div class="nice-scroll"><table class="nice-table">
        <thead><tr>${headers.map((h, i) => `<th class="${al(i)}">${h}</th>`).join('')}</tr></thead>
        <tbody>${opts.totalOnTop ? total : ''}${rows.map(r => tr(r)).join('')}${opts.totalOnTop ? '' : total}</tbody>
      </table></div>
    </section>`;
}

const flexNum = v => Number(v) || 0;
const flexColored = (v, cur = 'USD') => `<span style="color:${signColor(flexNum(v))}">${money(flexNum(v), cur)}</span>`;

// Open positions of one downloaded month. withCash adds the cash line, so the total is the whole account.
// Percentages are recalculated so the total is exactly 100% (of the account with cash, of invested money without).
function flexPositionsTable(m, withCash) {
  const n = flexNum, plain = formatCell, toUSD = (p, k) => n(p[k]) * (n(p.FXRateToBase) || 1);
  const total = m.invested + (withCash ? m.endingCash : 0);
  const share = usd => (total ? usd / total * 100 : 0).toFixed(2) + '%';
  const pos = m.positions.slice().sort((a, b) => toUSD(b, 'PositionValue') - toUSD(a, 'PositionValue'));
  const rows = pos.map(p => [`<strong>${escapeHtml(p.Symbol)}</strong>`, escapeHtml(p.Description || ''), plain(p.Quantity),
    money(n(p.CostBasisPrice), p.CurrencyPrimary), money(n(p.MarkPrice), p.CurrencyPrimary), money(n(p.PositionValue), p.CurrencyPrimary),
    money(n(p.CostBasisMoney), p.CurrencyPrimary), flexColored(p.FifoPnlUnrealized, p.CurrencyPrimary), share(toUSD(p, 'PositionValue'))]);
  if (withCash) {
    const cash = m.hasCashCurrency
      ? `<span class="conv-usd">${money(m.endingCashUSD)}</span><br><span class="conv-ils">${money(m.endingCashILS, 'ILS')}</span>`
      : money(m.endingCash);
    rows.push(['<strong>Cash</strong>', m.hasCashCurrency ? 'in USD: ' + money(m.endingCash) : '', '', '', '', cash, '', EMPTY_DASH, share(m.endingCash)]);
  }
  return flexTable('Open Positions', ['Symbol', 'Name', 'Quantity', 'Avg cost', 'Price', 'Value', 'Cost', 'Unrealized P/L', withCash ? '% of account' : '% of invested'], rows, {
    align: 'llrrrrrrr', totalOnTop: true,
    total: [withCash ? 'Total (invested + cash)' : 'Total', '', '', '', '', money(total), money(pos.reduce((a, p) => a + toUSD(p, 'CostBasisMoney'), 0)),
      flexColored(pos.reduce((a, p) => a + toUSD(p, 'FifoPnlUnrealized'), 0)), total ? '100%' : ''] });
}

// Sum per currency in plain color, e.g. "₪1,000.00 + $50.00" (the Activity check boxes)
const perCurrency = list => Object.entries(list.reduce((a, x) => ({ ...a, [x.cur]: (a[x.cur] || 0) + x.amount }), {}))
  .map(([cur, v]) => money(v, cur)).join(' + ');

// Activity (page and month details): stock trades and cash activity in one table, newest first. Rows, types and
// words come from calc.js (activityRows, activityType, activityWords, activityCash), shared with the Sheet.
// Few columns, said in plain words (the many trade / cash columns were hard to follow): what happened, the
// stock, a sentence with the details, the cash it moved and, for sales, the profit. A column only appears when a
// shown category uses it (for = those categories).
const CASH_CATS = ['dividends', 'israelTax', 'deposits', 'withdrawals', 'conversions', 'other'];
const plusMoney = (v, cur) => `<span style="color:${signColor(v)}">${v > 0 ? '+' : ''}${money(v, cur)}</span>`;
const activityDetails = r => activityWords(r, money).map(p => p.muted ? `<span class="cash-muted">${escapeHtml(p.t)}</span>` : escapeHtml(p.t)).join('')
  + (r.note ? `<div class="conv-note">${escapeHtml(r.note)}</div>` : '');
const ACTIVITY_COLUMNS = [
  { head: 'Date', al: 'l', cell: r => dmy(r.date) },
  { head: 'Type', al: 'l', cell: r => `<span class="cat-pill cat-${r.cat}">${escapeHtml(activityType(r))}</span>` },
  { head: 'Stock', al: 'l', for: ['trades', 'dividends', 'other'], cell: r => (r.t ? r.t.Symbol : r.symbol) ? `<strong>${escapeHtml(r.t ? r.t.Symbol : r.symbol)}</strong>` : '' },
  { head: 'What happened', al: 'l', cell: activityDetails },
  { head: 'Cash in / out', al: 'r', for: CASH_CATS, cell: r => activityCash(r).map(x => plusMoney(x.amount, x.cur)).join('<br>') },
  { head: 'Profit / loss', al: 'r', for: ['trades'], cell: r => !r.t || !flexNum(r.t.FifoPnlRealized) ? '' : plusMoney(flexNum(r.t.FifoPnlRealized), r.t.CurrencyPrimary) },
];
// No total row (summing trades, dividends, deposits, conversions and tax makes no sense); each category's total
// is on its check box. With more than one month, the month sits in its own column on the left, one cell per month in
// its year's color. hidden = categories left out.
function activityTable(months, title, hidden = []) {
  const blocks = months.map(m => ({ m, rows: activityRows(m).filter(r => !hidden.includes(r.cat)) })).filter(b => b.rows.length);
  if (!blocks.length) return '';
  const all = blocks.flatMap(b => b.rows), cols = ACTIVITY_COLUMNS.filter(c => !c.for || all.some(r => c.for.includes(r.cat)));
  const side = months.length > 1;
  let n = 0;   // row number, for the build-up animation
  const body = blocks.map(({ m, rows }) => rows.map((r, i) => `<tr class="${i ? '' : 'act-first'}" style="--i:${n++}">${side && !i
    ? `<td class="act-month yc${m.year % 5}" rowspan="${rows.length}"><div><b>${getMonthName(m.month).slice(0, 3)}</b> ${m.year}</div></td>` : ''}${cols.map(c => `<td class="${c.al}">${c.cell(r)}</td>`).join('')}</tr>`).join('')).join('');
  return `
    <section class="nice-section">
      ${title ? `<h3 class="nice-title">${escapeHtml(title)}</h3>` : ''}
      <div class="nice-scroll"><table class="nice-table act-table${side ? ' with-month' : ''}">
        <thead><tr>${side ? '<th class="l">Month</th>' : ''}${cols.map(c => `<th class="${c.al}">${c.head}</th>`).join('')}</tr></thead>
        <tbody>${body}</tbody>
      </table></div>
    </section>`;
}

function renderFlexDetails(m) {
  const n = flexNum;
  const plain = formatCell;

  const positions = flexPositionsTable(m, false);
  const activity = activityTable([m], 'Activity');

  const corp = flexTable('Corporate Actions (splits, mergers…)',
    ['Date', 'Symbol', 'Type', 'Description', 'Quantity', 'Value'],
    m.corpActions.map(c => [dmy(c['Date/Time']), escapeHtml(c.Symbol || ''), escapeHtml(c.Type || ''),
      escapeHtml(c.ActionDescription || c.Description || ''), plain(c.Quantity), money(n(c.Value))]),
    { align: 'llllrr' });

  return `
    <h2 class="month-heading" style="margin-top:28px">${getMonthName(m.month)} ${m.year}: details${m.partial ? ` <span class="flex-partial">in progress, up to ${shortDate(m.toDate)}</span>` : ''}</h2>
    ${positions + activity + corp || '<p class="flex-note">No activity this month.</p>'}`;
}

// Title + the months picked in the side panel, for the Activity page
const listPageHeading = title => `<div class="fin-header"><h2 style="color: var(--heading);">${title} <small class="flex-view-label">${flexViewLabel()}</small></h2>${showAllButton()}</div>`;

// Activity page: trades and cash activity of the picked months in one table. A check box per category on top shows
// its total and hides/shows it (remembered in this browser); the table's columns follow what's shown.
let activityMonths = [];
let activityHidden = [];
try { activityHidden = JSON.parse(localStorage.getItem('ibkr_cash_hidden')) || []; } catch (e) {}
function toggleActivityCategory(cat) {
  activityHidden = cat === 'all' ? [] : activityHidden.includes(cat) ? activityHidden.filter(c => c !== cat) : [...activityHidden, cat];
  try { localStorage.setItem('ibkr_cash_hidden', JSON.stringify(activityHidden)); } catch (e) {}
  tableContainer.classList.remove('page-enter');   // no page build-up; only the table fades into its new shape
  tableContainer.innerHTML = renderActivityPage(activityMonths);
  tableContainer.querySelector('.act-table')?.closest('.nice-section').classList.add('swap-in');
}

async function showActivity() {
  state.currentView = 'activity';
  setActiveBtn(btnActivityView);
  showLoading(true);
  try {
    const picked = await pickedFlexMonths();
    if (picked) { activityMonths = picked.months; tableContainer.innerHTML = renderActivityPage(activityMonths); }
    setStatus('Activity');
  } catch (err) { setStatus('❌ Error: ' + err.message); } finally { showLoading(false); }
}

function renderActivityPage(months) {
  const all = months.flatMap(activityRows);
  if (!all.length) return `<div class="list-page${monthTheme(months)}">${listPageHeading('📒 Activity')}<p class="flex-note">No activity in these months.</p></div>`;
  const usd = (t, k) => flexNum(t[k]) * (flexNum(t.FXRateToBase) || 1);
  const chips = Object.entries(ACTIVITY_CATEGORIES).filter(([cat]) => all.some(r => r.cat === cat)).map(([cat, label]) => {
    const rows = all.filter(r => r.cat === cat);
    const value = cat === 'trades' ? `${rows.length} · profit ${money(rows.reduce((a, r) => a + usd(r.t, 'FifoPnlRealized'), 0))}`
      : cat === 'dividends' ? `net ${money(rows.reduce((a, r) => a + r.net, 0))}`
      : cat === 'conversions' ? `${rows.length}` : perCurrency(rows.flatMap(r => [r.in, r.out].filter(Boolean)));
    const tip = cat === 'trades' ? "Show / hide trades. Profit = stock sales only; Financial Summary's Realized P/L also includes IBKR's small currency gain/loss when shekel cash is used." : `Show / hide ${label.toLowerCase()}`;
    return `<button class="cash-chip cat-${cat}${activityHidden.includes(cat) ? '' : ' on'}" onclick="toggleActivityCategory('${cat}')" title="${escapeHtml(tip)}">
      <span class="cash-chip-box"></span><span class="cash-chip-label">${label}</span><span class="cash-chip-value">${value}</span></button>`;
  }).join('') + (activityHidden.length ? `<button class="cash-chip-all" onclick="toggleActivityCategory('all')">Show all</button>` : '');
  return `<div class="list-page${monthTheme(months)}">${listPageHeading('📒 Activity')}
    <div class="cash-chips">${chips}</div>
    ${activityTable(months, '', activityHidden) || '<p class="flex-note">All categories are hidden. Click one above to show it.</p>'}</div>`;
}
btnDelete.addEventListener('click', async () => {
  if (state.selectedScope !== 'month') return;
  if (!confirm(`Delete ${getMonthName(state.selectedMonth)} ${state.selectedYear}?`)) return;
  showLoading(true);
  try {
    await fetch(`/api/month/${state.selectedYear}/${state.selectedMonth}`, { method: 'DELETE' });
    welcome.classList.remove('hidden'); dataView.classList.add('hidden');
    state.selectedYear = null; state.selectedMonth = null;
    await loadMonthsList();
  } catch (err) { setStatus('❌ Error: ' + err.message); } finally { showLoading(false); }
});

// ============================================================
// NUMBER FORMATTING (Financial Summary (API) detail tables)
// ============================================================
// Raw IBKR numbers like "12345.678901234" → "12,345.68". Big numbers get 2 decimals, smaller ones up to 4
// (so prices and FX rates keep their precision). Anything that isn't a plain number is shown as-is.
function formatCell(v) {
  const s = String(v ?? '');
  if (!/^-?\d+(\.\d+)?$/.test(s)) return escapeHtml(s);
  const n = Number(s);
  return n.toLocaleString(undefined, { maximumFractionDigits: Math.abs(n) >= 1000 ? 2 : 4 });
}

// Page change animation: set when the page or the months shown change, played once the new content is in
let pendingAnim = true;   // true at start, so the page also animates when it's opened or refreshed
function showLoading(show) {
  loadingOverlay.classList.toggle('hidden', !show);
  if (!show && pendingAnim) { pendingAnim = false; animatePage(); }
}
// Every part of the page (title, buttons, cards, tiles, chips, tables) builds in reading order: left to right along a
// row, the next row a beat later, each sliding in from the side. Parts inside another part move with it. Tables then
// build row by row (CSS), starting once the parts above them are in (--build-start).
const PAGE_PARTS = '.fin-header > *, .cc-group, .cc-actions, .ins-menu-card, .ins-detail-bar, .ins-head, .ins-tile, .ins-card, .pf-head, .pf-kpi, .pf-card, .nw-note, .portfolio-title, .nice-section, .month-heading, .cash-chip, .dl-card';
// root = only that part of the page builds (e.g. an insight just opened); the rest stays as it is.
function animatePage(root = tableContainer) {
  tableContainer.classList.remove('page-enter');
  tableContainer.querySelectorAll('.part-in').forEach(el => { if (!root.contains(el)) el.classList.remove('part-in'); });
  const found = [...root.querySelectorAll(PAGE_PARTS)];
  const parts = found.filter(el => !found.some(p => p !== el && p.contains(el)))
    .map(el => ({ el, r: el.getBoundingClientRect() })).sort((a, b) => a.r.top - b.r.top);
  const rows = [];
  parts.forEach(p => { const row = rows.at(-1); if (row && p.r.top < row[0].r.top + 12) row.push(p); else rows.push([p]); });
  rows.forEach((row, ri) => row.sort((a, b) => a.r.left - b.r.left).forEach((p, ci) => {
    p.d = Math.min(ri * 80 + ci * 45, 600);
    p.el.style.setProperty('--d', p.d + 'ms');
    p.el.classList.add('part-in');
  }));
  root.querySelectorAll('table').forEach(t => {
    const top = t.getBoundingClientRect().top;
    t.style.setProperty('--build-start', Math.max(0, ...parts.filter(p => p.r.top <= top).map(p => p.d)) + 120 + 'ms');
  });
  void tableContainer.offsetWidth;   // restarts the CSS animation
  tableContainer.classList.add('page-enter');
  clearTimeout(animatePage.timer);   // then removed, so later redraws (e.g. ticking a category) don't replay it
  animatePage.timer = setTimeout(() => tableContainer.classList.remove('page-enter'), 2500);
}
function setStatus(msg) { statusBar.textContent = msg; }
function getMonthName(m) { return ["January","February","March","April","May","June","July","August","September","October","November","December"][m - 1] || ''; }
function escapeHtml(str) { return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
