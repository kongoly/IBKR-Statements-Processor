 // ============================================================
// app.js — Frontend Logic for IBKR Statement Processor
// ============================================================

// ============================================================
// STATE
// ============================================================
const state = {
  selectedYear:  null,
  selectedMonth: null,
  currentView:   'full', 
  selectedScope: 'month',
  finLayout:     'table' 
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
const btnFullView     = document.getElementById('btn-full-view');
const btnImpView      = document.getElementById('btn-imp-view');
const btnPortView     = document.getElementById('btn-port-view');
const btnFinView      = document.getElementById('btn-fin-view');
const btnDelete       = document.getElementById('btn-delete');
const layoutToggle    = document.getElementById('layout-toggle');
const btnLayoutTable  = document.getElementById('btn-layout-table');
const btnLayoutCards  = document.getElementById('btn-layout-cards');

// ============================================================
// STARTUP
// ============================================================
document.addEventListener('DOMContentLoaded', () => {
  loadMonthsList();
});

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
    if (result.results && result.results.length > 0) setStatus(`✅ Imported: ${result.results.map(r => `${r.monthNaame} ${r.year}`).join(', ')}`);
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

    let html = `<button class="total-summary-btn ${state.selectedScope === 'total' ? 'active' : ''}" onclick="selectScope('total')">🌍 ALL TIME DATA</button>`;
    html += Object.keys(byYear).sort((a, b) => Number(b) - Number(a)).map(year => `
        <div class="year-group">
          <div class="year-label ${state.selectedScope === 'year' && state.selectedYear == year ? 'active' : ''}"  
               onclick="selectScope('year', ${year})">${year}</div>
          ${byYear[year].slice().map(m => `
            <button
              class="month-btn ${state.selectedScope === 'month' && state.selectedYear == m.year && state.selectedMonth == m.month ? 'active' : ''}"
              onclick="selectScope('month', ${m.year}, ${m.month})">${m.month_name}</button>
          `).join('')}
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

async function refreshView() {
  btnDelete.style.display = (state.selectedScope === 'month') ? 'inline-block' : 'none';
  layoutToggle.classList.toggle('hidden', state.currentView !== 'financial');

  switch (state.currentView) {
    case 'full':      showFullData(); break;
    case 'important': showImportantInfo(); break;
    case 'portfolio': showPortfolio(); break;
    case 'financial': showFinancialSummary(); break;
  }
}

// ============================================================
// VIEWS
// ============================================================
function setActiveBtn(btn) {
  [btnFullView, btnImpView, btnPortView, btnFinView].forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
}

async function showFullData() {
  state.currentView = 'full';
  setActiveBtn(btnFullView);
  showLoading(true);
  try {
    let url = `/api/full-data/${state.selectedScope}?year=${state.selectedYear || ''}&month=${state.selectedMonth || ''}`;
    const data = await fetch(url).then(r => r.json());
    if (!data.months || !data.months.length) { tableContainer.innerHTML = '<p class="empty-msg">No data found.</p>'; return; }
    tableContainer.innerHTML = data.months.map(m => `
      <h2 style="margin: 40px 0 10px; color: #2d3748; border-bottom: 2px solid #e2e8f0; padding-bottom: 10px;">${m.monthName} ${m.year}</h2>
      ${renderSectionsHTML(m.sections)}`).join('');
    setStatus(`Full Data - Scope: ${state.selectedScope.toUpperCase()}`);
  } catch (err) { setStatus('❌ Error: ' + err.message); } finally { showLoading(false); }
}

async function showFinancialSummary() {
  state.currentView = 'financial';
  setActiveBtn(btnFinView);
  layoutToggle.classList.add('hidden'); // No longer needed as we combine them
  showLoading(true);
  try {
    let url = `/api/financial-summary/${state.selectedScope}?year=${state.selectedYear || ''}&month=${state.selectedMonth || ''}`;
    const res = await fetch(url).then(r => r.json());
    
    tableContainer.innerHTML = renderCombinedFinancialTable(res.summary, res.months || []);
    setStatus(`Financial Summary - Scope: ${state.selectedScope.toUpperCase()}`);
  } catch (err) { setStatus('❌ Error: ' + err.message); } finally { showLoading(false); }
}

function renderCombinedFinancialTable(s, months) {
    if (!s) return '';
    return `
    <div class="financial-view">
        <h2 style="margin-bottom: 24px; color: #2d3748;">📊 Global Financial Summary (${state.selectedScope.toUpperCase()})</h2>
        <div class="table-wrap">
        <table class="data-table" style="table-layout: auto; width: 100%; font-size: 0.85rem;">
            <thead>
                <tr style="background: #f8fafc;">
                    <th>Period</th>
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
                    <th style="border-left: 2px solid #cbd5e0;">Realized P/L</th>
                </tr>
                <tr style="background: #edf2f7; border-bottom: 3px solid #cbd5e0;">
                    <td><strong>TOTAL</strong></td>
                    <td>$${s.latestEndingCashUSD.toLocaleString()}<br><small>₪${s.latestEndingCashILS.toLocaleString()}</small></td>
                    <td style="font-weight:600">$${s.latestInvestedUSD.toLocaleString()}</td>
                    <td style="color:${s.latestUnrealizedPL >= 0 ? '#2f855a' : '#c53030'}">$${s.latestUnrealizedPL.toLocaleString()}</td>
                    <td style="color:#c53030">₪${s.totalIsraelTaxILS.toLocaleString()}<br><small>$${s.totalIsraelTaxUSD.toLocaleString(undefined, {minimumFractionDigits:0, maximumFractionDigits:0})}</small></td>
                    <td>$${s.totalCommissions.toLocaleString()}</td>
                    <td style="color:#2f855a">$${s.totalDividends.toLocaleString()}</td>
                    <td style="color:#c53030">$${s.totalWithholdingTaxUSD.toLocaleString()}</td>
                    <td style="color:${s.totalDepositsUSD > 0 ? '#2f855a' : 'inherit'}">$${s.totalDepositsUSD.toLocaleString()}<br><small style="color:${s.totalDepositsILS > 0 ? '#2f855a' : 'inherit'}">₪${s.totalDepositsILS.toLocaleString()}</small></td>
                    <td style="color:${s.totalWithdrawalsUSD > 0 ? '#c53030' : 'inherit'}">$${s.totalWithdrawalsUSD.toLocaleString()}<br><small style="color:${s.totalWithdrawalsILS > 0 ? '#c53030' : 'inherit'}">₪${s.totalWithdrawalsILS.toLocaleString()}</small></td>
                    <td>$${(s.totalConversionsUSD || 0).toLocaleString()} <small>USD Net</small></td>
                    <td style="font-weight:800; border-left: 2px solid #cbd5e0; color:${s.totalRealizedPL >= 0 ? '#2f855a' : '#c53030'}">$${s.totalRealizedPL.toLocaleString()}</td>
                </tr>
                <tr><td colspan="12" style="height: 20px; background: white; border: none;"></td></tr>
            </thead>
            <tbody>
                ${months.map(m => `
                <tr>
                    <td><strong>${m.monthName} ${m.year}</strong></td>
                    <td>$${m.endingCashUSD.toLocaleString()}<br><small>₪${m.endingCashILS.toLocaleString()}</small></td>
                    <td style="font-weight:600">$${m.investedUSD.toLocaleString()}</td>
                    <td style="color:${m.unrealizedPL >= 0 ? '#2f855a' : '#c53030'}">$${m.unrealizedPL.toLocaleString()}</td>
                    <td style="color:#c53030">${m.israelTaxILS.toLocaleString(undefined, {minimumFractionDigits:0, maximumFractionDigits:0})} ₪ / $${Math.abs(m.israelTaxUSD).toLocaleString(undefined, {minimumFractionDigits:0, maximumFractionDigits:0})}</td>
                    <td>$${m.commissions.toLocaleString()}</td>
                    <td style="color:#2f855a">$${m.dividends.toLocaleString()}</td>
                    <td style="color:#c53030">$${m.withholdingTaxUSD.toLocaleString()}</td>
                    <td style="color:${m.depositsUSD > 0 ? '#2f855a' : 'inherit'}">$${m.depositsUSD.toLocaleString()}<br><small style="color:${m.depositsILS > 0 ? '#2f855a' : 'inherit'}">₪${m.depositsILS.toLocaleString()}</small></td>
                    <td style="color:${m.withdrawalsUSD > 0 ? '#c53030' : 'inherit'}">$${m.withdrawalsUSD.toLocaleString()}<br><small style="color:${m.withdrawalsILS > 0 ? '#c53030' : 'inherit'}">₪${m.withdrawalsILS.toLocaleString()}</small></td>
                    <td style="white-space: nowrap; line-height: 1.1;">${m.conversionsText || '—'}</td>
                    <td style="font-weight:bold; border-left: 2px solid #cbd5e0; color:${m.realizedPL >= 0 ? '#2f855a' : '#c53030'}">$${m.realizedPL.toLocaleString()}</td>
                </tr>`).join('')}
            </tbody>
        </table>
        </div>
    </div>`;
}

async function showImportantInfo() {
  state.currentView = 'important';
  setActiveBtn(btnImpView);
  let url = state.selectedScope === 'total' ? '/api/important-info/total' : `/api/important-info/${state.selectedYear}?month=${state.selectedMonth || ''}`;     
  showLoading(true);
  try {
    let data = await fetch(url).then(r => r.json());
    if (!data.months || !data.months.length) { tableContainer.innerHTML = '<p class="empty-msg">No data found.</p>'; return; }

    const CAT_LABELS = {
      FOREX_BAL: { label: 'Forex Balances', subheaders: ['Currency Summary', 'Currency', 'Total', 'Securities', 'Futures'] },
      CURR_ACT: { label: 'Currency Activity', subheaders: ['Asset Category', 'Currency', 'Description', 'Date/Time', 'FX Currency', 'Quantity', 'Proceeds in USD', 'Basis in USD', 'Realized P/L in USD', 'Code'] },
      CONV: { label: 'Currency Conversions', subheaders: ['Asset Category', 'Currency', 'Symbol', 'Buys Quantity', 'Buys Avg. Price', 'Buys Proceeds', 'Sells Quantity', 'Sells Avg. Price', 'Sells Proceeds'] },
      DNW: { label: 'Deposits & Withdrawals', subheaders: ['Currency', 'Settle Date', 'Description', 'Amount'] },
      COMM: { label: 'Commissions', subheaders: ['Asset Category', 'Total Number of Trades', 'Total Shares Bought', 'Total Shares Sold', 'Total Commissions', 'Commission Rate'] },
      ISR: { label: 'Israel Tax', subheaders: ['Subtitle', 'Currency', 'Date', 'Description', 'Amount'] },
      USWHT: { label: 'US Withholding Tax', subheaders: ['Currency Summary', 'Currency', 'Total', 'Securities', 'Futures'] },
      RU: { label: 'Realized & Unrealized', subheaders: ['Asset Category', 'Symbol', 'Cost Adj.', 'Realized S/T Profit', 'Realized S/T Loss', 'Realized L/T Profit', 'Realized L/T Loss', 'Realized Total', 'Unrealized S/T Profit', 'Unrealized S/T Loss', 'Unrealized L/T Profit', 'Unrealized L/T Loss', 'Unrealized Total', 'Total', 'Code'] },
      DIV: { label: 'Dividends', subheaders: ['Currency Summary', 'Currency', 'Total', 'Securities', 'Futures'] }
    };
    tableContainer.innerHTML = data.months.map(m => `
      <div class="imp-month-block">
        <h3 class="imp-month-title">${m.monthName} ${m.year}</h3>
        ${Object.entries(CAT_LABELS).map(([key, meta]) => {
          const rows = m.cats[key] || []; if (!rows.length) return '';
          return `<div class="imp-category"><table class="data-table"><thead><tr><th colspan="${meta.subheaders.length}" class="imp-cat-title">${meta.label}</th></tr><tr>${meta.subheaders.map(h => `<th>${escapeHtml(h)}</th>`).join('')}</tr></thead><tbody>${rows.map(row => `<tr style="background-color: ${row.color || 'transparent'}">${row.values.map(cell => `<td>${escapeHtml(String(cell || ''))}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
        }).join('')}
      </div>`).join('<hr style="margin: 32px 0; border-color: #e2e8f0;">');
    setStatus(`Important Info - Scope: ${state.selectedScope.toUpperCase()}`);
  } catch (err) { setStatus('❌ Error: ' + err.message); } finally { showLoading(false); }
}

async function showPortfolio() {
  state.currentView = 'portfolio';
  setActiveBtn(btnPortView);
  let url = state.selectedScope === 'total' ? '/api/important-info/total?view=portfolio' : `/api/important-info/${state.selectedYear}?month=${state.selectedMonth || ''}&view=portfolio`;     
  showLoading(true);
  try {
    const [infoData, stats] = await Promise.all([fetch(url).then(r => r.json()), fetch('/api/stats').then(r => r.json())]);
    if (!infoData.months) infoData.months = [];
    tableContainer.innerHTML = `
      <div class="portfolio-view">
        <section class="portfolio-section">
          <div class="portfolio-title">📊 Global Financial Stats</div>
          <div class="table-wrap">
            <table class="data-table" style="background: white; margin-bottom: 20px;">
                <thead>
                    <tr>
                        <th>Total Commissions</th>
                        <th>Total Dividends</th>
                        <th>Latest Unrealized P/L</th>
                        <th>Latest Invested Cash</th>
                        <th>Latest Cash Report</th>
                    </tr>
                </thead>
                <tbody>
                    <tr>
                        <td>$${stats.totalCommissions.toLocaleString()}</td>
                        <td style="color:#2f855a">$${stats.totalDividends.toLocaleString()}</td>
                        <td style="color:${stats.latestUnrealizedPL >= 0 ? '#2f855a' : '#c53030'}">$${stats.latestUnrealizedPL.toLocaleString()}</td>
                        <td style="font-weight:600">$${(stats.latestInvestedUSD || 0).toLocaleString()}</td>
                        <td>$${stats.latestCashUSD.toLocaleString()} / ₪${stats.latestCashILS.toLocaleString()}</td>
                    </tr>
                </tbody>
            </table>
          </div>
        </section>
        <section class="portfolio-section">
          <div class="portfolio-title">📂 Manual Portfolio <small>(Cash row counts in Value and %, not in P/L)</small></div>
          <table class="data-table current-port-table">
            <thead><tr><th style="width: 140px;">Ticker</th><th>Shares</th><th>Avg Buy Price</th><th>Current Price</th><th>Current Value</th><th>Cost Basis</th><th>Profit/Loss</th><th>Portfolio %</th><th style="width: 40px;"></th></tr></thead>
            <tbody id="current-port-body"></tbody>
            <tfoot><tr class="total-row"><td colspan="4" style="text-align: right;">TOTAL (Invested + Cash)</td><td id="total-val">—</td><td id="total-cost">—</td><td id="total-pl">—</td><td id="total-pct">100%</td><td></td></tr></tfoot>
          </table>
          <button class="add-row-btn" onclick="addPortfolioRow()">+ Add Ticker</button>
        </section>
        <hr style="margin: 40px 0; border: none; border-top: 1px solid #cbd5e0;">
        <section class="portfolio-section" style="overflow-x: auto;">
          <div class="portfolio-title">📜 Historical Portfolio Mapping</div>
          <div class="port-wrap"><table class="data-table historical-port-table" style="white-space: nowrap;"><thead id="hist-port-head"></thead><tbody id="hist-port-body"></tbody></table></div>
        </section>
      </div>`;
    loadCurrentPortfolio();
    renderHistoricalMapping(infoData.months);
    setStatus(`Portfolio - Scope: ${state.selectedScope.toUpperCase()}`);
  } catch (err) { setStatus('❌ Error: ' + err.message); } finally { showLoading(false); }
}

function renderHistoricalMapping(months) {
    const head = document.getElementById('hist-port-head');
    const body = document.getElementById('hist-port-body');
    if (!months || !months.length) {
        head.innerHTML = ''; body.innerHTML = '<tr><td colspan="100%">No data for mapping.</td></tr>';
        return;
    }

    // TWO HEADER ROWS - Restore Year and Month headers
    head.innerHTML = `
    <tr>
      <th rowspan="2" class="port-hdr-cell sticky-col">Year</th>
      <th rowspan="2" class="port-hdr-cell sticky-col sticky-col-month">Month</th>
      <th colspan="2" class="port-hdr-cell">Cash</th>
      <th colspan="5" class="port-hdr-cell">Currency Activity</th>
      <th colspan="7" class="port-hdr-cell">Currency Conversions</th>
      <th colspan="3" class="port-hdr-cell">Deposits & Withdrawals</th>
      <th colspan="3" class="port-hdr-cell">Commissions</th>
      <th colspan="3" class="port-hdr-cell">Israel Tax</th>
      <th class="port-hdr-cell">US WHT</th>
      <th colspan="3" class="port-hdr-cell">Realized & Unrealized</th>
      <th class="port-hdr-cell">Dividends</th>
    </tr>
    <tr>
      <th class="port-subhdr-cell">Currency</th><th class="port-subhdr-cell">Amount</th>
      <th class="port-subhdr-cell">Description</th><th class="port-subhdr-cell">Date/Time</th><th class="port-subhdr-cell">FX Currency</th><th class="port-subhdr-cell">Quantity</th><th class="port-subhdr-cell">Realized P/L in USD</th>
      <th class="port-subhdr-cell">Symbol / Pair</th><th class="port-subhdr-cell">Buys Quantity</th><th class="port-subhdr-cell">Buys Avg. Price</th><th class="port-subhdr-cell">Buys Proceeds</th><th class="port-subhdr-cell">Sells Quantity</th><th class="port-subhdr-cell">Sells Avg. Price</th><th class="port-subhdr-cell">Sells Proceeds</th>
      <th class="port-subhdr-cell">Currency</th><th class="port-subhdr-cell">Settle Date</th><th class="port-subhdr-cell">Amount</th>
      <th class="port-subhdr-cell">Asset Category</th><th class="port-subhdr-cell">Total Trades</th><th class="port-subhdr-cell">Total Commissions</th>
      <th class="port-subhdr-cell">Currency</th><th class="port-subhdr-cell">Date</th><th class="port-subhdr-cell">Amount</th>
      <th class="port-subhdr-cell">Total</th>
      <th class="port-subhdr-cell">Realized Total</th><th class="port-subhdr-cell">Unrealized Total</th><th class="port-subhdr-cell">Total</th>
      <th class="port-subhdr-cell">Total</th>
    </tr>`;

    let html = '';
    months.forEach(m => {
        for (let i = 0; i < 5; i++) {
            const getVal = (cat, idx) => m.cats[cat]?.[i]?.values[idx] || '';
            const getBg = (cat) => m.cats[cat]?.[i]?.color || 'transparent';

            // Mapping standard category colors from original appscript
            const cashBg = i === 0 ? '#C6EFCE' : (i === 1 ? '#C6DBFF' : 'transparent');
            const currBg = '#F7E6D5';
            const convBg = '#F29D94';
            const dnwBg  = '#E1C8E6';
            const commBg = '#FFE699';
            const isrBg  = '#FFDCE1';
            const whtBg  = '#FFC7CE';
            const ruBg   = '#BEFAC8'; 
            const divBg  = '#F8BE78';

            const cashCurr = getVal('FOREX_BAL', 1); const cashAmt = getVal('FOREX_BAL', 2);
            const currDesc = getVal('CURR_ACT', 2); const currDate = getVal('CURR_ACT', 3); const currFX = getVal('CURR_ACT', 4); const currQty = getVal('CURR_ACT', 5); const currPL = getVal('CURR_ACT', 8);
            const convSym = getVal('CONV', 2); const convBuyQ = getVal('CONV', 3); const convBuyP = getVal('CONV', 4); const convBuyProc = getVal('CONV', 5); const convSellQ = getVal('CONV', 6); const convSellP = getVal('CONV', 7); const convSellProc = getVal('CONV', 8);
            const dnwCurr = getVal('DNW', 0); const dnwDate = getVal('DNW', 1); const dnwAmt = getVal('DNW', 3);
            const commCat = getVal('COMM', 0); const commTrades = getVal('COMM', 1); const commAmt = getVal('COMM', 4);
            const isrCurr = getVal('ISR', 1); const isrDate = getVal('ISR', 2); const isrAmt = getVal('ISR', 4);
            const whtAmt = getVal('USWHT', 2);
            
            const ruReal = i === 0 ? getVal('RU', 7) : '';
            const ruUnreal = i === 0 ? getVal('RU', 12) : '';
            const ruTot = i === 0 ? getVal('RU', 13) : '';
            
            const divAmt = getVal('DIV', 2);

            html += `<tr style="height: 36px;">
                ${i === 0 ? `<td rowspan="5" class="port-subhdr-cell sticky-col">${m.year}</td>
                             <td rowspan="5" class="port-subhdr-cell sticky-col sticky-col-month">${m.monthName}</td>` : ''}
                
                <td style="background-color: ${cashBg}">${cashCurr}</td><td style="background-color: ${cashBg}">${cashAmt}</td>
                <td style="background-color: ${currDesc ? currBg : 'transparent'}">${currDesc}</td>
                <td style="background-color: ${currDesc ? currBg : 'transparent'}">${currDate}</td>
                <td style="background-color: ${currDesc ? currBg : 'transparent'}">${currFX}</td>
                <td style="background-color: ${currDesc ? currBg : 'transparent'}">${currQty}</td>
                <td style="background-color: ${currDesc ? currBg : 'transparent'}">${currPL}</td>
                
                <td style="background-color: ${convSym ? convBg : 'transparent'}">${convSym}</td>
                <td style="background-color: ${convSym ? convBg : 'transparent'}">${convBuyQ}</td>
                <td style="background-color: ${convSym ? convBg : 'transparent'}">${convBuyP}</td>
                <td style="background-color: ${convSym ? convBg : 'transparent'}">${convBuyProc}</td>
                <td style="background-color: ${convSym ? convBg : 'transparent'}">${convSellQ}</td>
                <td style="background-color: ${convSym ? convBg : 'transparent'}">${convSellP}</td>
                <td style="background-color: ${convSym ? convBg : 'transparent'}">${convSellProc}</td>
                
                <td style="background-color: ${dnwCurr ? dnwBg : 'transparent'}">${dnwCurr}</td>
                <td style="background-color: ${dnwCurr ? dnwBg : 'transparent'}">${dnwDate}</td>
                <td style="background-color: ${dnwCurr ? dnwBg : 'transparent'}">${dnwAmt}</td>
                
                <td style="background-color: ${commCat ? commBg : 'transparent'}">${commCat}</td>
                <td style="background-color: ${commCat ? commBg : 'transparent'}">${commTrades}</td>
                <td style="background-color: ${commCat ? commBg : 'transparent'}">${commAmt}</td>
                
                <td style="background-color: ${isrCurr ? isrBg : 'transparent'}">${isrCurr}</td>
                <td style="background-color: ${isrCurr ? isrBg : 'transparent'}">${isrDate}</td>
                <td style="background-color: ${isrCurr ? isrBg : 'transparent'}">${isrAmt}</td>
                
                <td style="background-color: ${whtAmt ? whtBg : 'transparent'}">${whtAmt}</td>
                
                <td style="background-color: ${ruReal ? ruBg : 'transparent'}">${ruReal}</td>
                <td style="background-color: ${ruReal ? ruBg : 'transparent'}">${ruUnreal}</td>
                <td style="background-color: ${ruReal ? ruBg : 'transparent'}">${ruTot}</td>
                
                <td style="background-color: ${divAmt ? divBg : 'transparent'}">${divAmt}</td>
            </tr>`;
        }
    });
    body.innerHTML = html;
}

btnFullView.addEventListener('click', showFullData);
btnImpView.addEventListener('click', showImportantInfo);
btnPortView.addEventListener('click', showPortfolio);
btnFinView.addEventListener('click', showFinancialSummary);
btnLayoutTable.addEventListener('click', () => { state.finLayout = 'table'; btnLayoutTable.classList.add('active'); btnLayoutCards.classList.remove('active'); showFinancialSummary(); });
btnLayoutCards.addEventListener('click', () => { state.finLayout = 'cards'; btnLayoutCards.classList.add('active'); btnLayoutTable.classList.remove('active'); showFinancialSummary(); });
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

function renderSectionsHTML(sections) {
  if (!sections || !sections.length) return '<p style="color:#718096">No data found.</p>';
  return sections.map(section => {
    const subheaderRow = section.rows[0], dataRows = section.rows.slice(1), colCount = subheaderRow ? subheaderRow.data.length : 1;
    return `<div class="section-block"><table class="data-table"><thead><tr><th colspan="${colCount}" class="section-title">${escapeHtml(section.section_name)}</th></tr>${subheaderRow ? `<tr>${subheaderRow.data.map(h => `<th>${escapeHtml(String(h || ''))}</th>`).join('')}</tr>` : ''}</thead><tbody>${dataRows.map(row => `<tr style="background-color: ${row.color || 'transparent'}">${row.data.map(cell => `<td>${escapeHtml(String(cell || ''))}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
  }).join('');
}

function showLoading(show) { loadingOverlay.classList.toggle('hidden', !show); }
function setStatus(msg) { statusBar.textContent = msg; }
function getMonthName(m) { return ["January","February","March","April","May","June","July","August","September","October","November","December"][m - 1] || ''; }
function escapeHtml(str) { return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }

function loadCurrentPortfolio() {
  const saved = localStorage.getItem('ibkr_portfolio_data');
  const rows = saved ? JSON.parse(saved) : [{ ticker: 'CASH', shares: 1, avg: 0, cur: 0, isCash: true }, { ticker: '', shares: 0, avg: 0, cur: 0 }];
  const body = document.getElementById('current-port-body');
  body.innerHTML = '';
  rows.forEach((r, idx) => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td><input type="text" value="${r.ticker}" onchange="updatePortfolio(${idx}, 'ticker', this.value)" ${r.isCash ? 'disabled' : ''}></td>
      <td><input type="number" value="${r.shares}" onchange="updatePortfolio(${idx}, 'shares', this.value)" ${r.isCash ? 'disabled' : ''}></td>
      <td><input type="number" value="${r.avg}" onchange="updatePortfolio(${idx}, 'avg', this.value)" ${r.isCash ? 'disabled' : ''}></td>
      <td><input type="number" value="${r.cur}" onchange="updatePortfolio(${idx}, 'cur', this.value)"></td>
      <td id="val-${idx}">0</td>
      <td id="cost-${idx}">0</td>
      <td id="pl-${idx}">0</td>
      <td id="pct-${idx}">0%</td>
      <td>${r.isCash ? '' : `<button class="delete-btn" onclick="deletePortfolioRow(${idx})">×</button>`}</td>
    `;
    body.appendChild(tr);
  });
  calculatePortfolio();
}

function addPortfolioRow() {
  const saved = localStorage.getItem('ibkr_portfolio_data');
  const rows = saved ? JSON.parse(saved) : [];
  rows.push({ ticker: '', shares: 0, avg: 0, cur: 0 });
  localStorage.setItem('ibkr_portfolio_data', JSON.stringify(rows));
  loadCurrentPortfolio();
}

function deletePortfolioRow(idx) {
  const saved = localStorage.getItem('ibkr_portfolio_data');
  const rows = JSON.parse(saved);
  rows.splice(idx, 1);
  localStorage.setItem('ibkr_portfolio_data', JSON.stringify(rows));
  loadCurrentPortfolio();
}

function updatePortfolio(idx, key, val) {
  const saved = localStorage.getItem('ibkr_portfolio_data');
  const rows = JSON.parse(saved);
  rows[idx][key] = key === 'ticker' ? val : parseFloat(val) || 0;
  localStorage.setItem('ibkr_portfolio_data', JSON.stringify(rows));
  calculatePortfolio();
}

function calculatePortfolio() {
  const saved = localStorage.getItem('ibkr_portfolio_data');
  const rows = JSON.parse(saved);
  let totalVal = 0, totalCost = 0;
  rows.forEach((r, idx) => {
    const val = r.isCash ? r.cur : r.shares * r.cur;
    const cost = r.isCash ? 0 : r.shares * r.avg;
    const pl = r.isCash ? 0 : val - cost;
    totalVal += val;
    totalCost += cost;
    document.getElementById(`val-${idx}`).textContent = val.toLocaleString();
    document.getElementById(`cost-${idx}`).textContent = cost.toLocaleString();
    const plEl = document.getElementById(`pl-${idx}`);
    plEl.textContent = pl.toLocaleString();
    plEl.style.color = pl >= 0 ? '#2f855a' : '#c53030';
  });
  rows.forEach((r, idx) => {
    const val = r.isCash ? r.cur : r.shares * r.cur;
    const pct = totalVal > 0 ? (val / totalVal * 100).toFixed(1) : 0;
    document.getElementById(`pct-${idx}`).textContent = pct + '%';
  });
  document.getElementById('total-val').textContent = totalVal.toLocaleString();
  document.getElementById('total-cost').textContent = totalCost.toLocaleString();
  const totalPL = totalVal - totalCost - (rows.find(r=>r.isCash)?.cur || 0);
  const totalPLEl = document.getElementById('total-pl');
  totalPLEl.textContent = totalPL.toLocaleString();
  totalPLEl.style.color = totalPL >= 0 ? '#2f855a' : '#c53030';
}
