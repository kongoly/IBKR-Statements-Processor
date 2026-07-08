 // ============================================================
// colorizer.js — Color Rules for IBKR Data Rows
// ============================================================
// This file contains all 7 highlight rules from your original
// Apps Script, ported 1:1 to Node.js.
//
// Each rule looks at a row's values and the section it belongs
// to, and returns a hex color string if the row matches.
//
// The color palette is identical to your Apps Script CFG.COLORS
// and your finalized palette in the project notes.
//
// Rules (in order):
//   1. Commissions          → #FFE699
//   2. Deposits & Withdrawals → #E1C8E6
//   3. Forex Conversions    → #F29D94
//   4. Forex P/L Details    → #F7E6D5 / #D1EFCF / #ACDCF2
//   5. Israel Tax           → #FFDCE1
//   6. Cash Report          → #F8BE78 / #FFC7CE / #C6EFCE / #C6DBFF
//   7. Stocks Total         → #BEFAC8
// ============================================================

// ============================================================
// COLOR PALETTE
// Identical to CFG.COLORS in your Apps Script
// ============================================================
const COLORS = {
  COMMISSIONS:   "#FFE699",
  DNW:           "#E1C8E6",
  CONVERSIONS:   "#F29D94",
  FX_PL_NETCASH: "#F7E6D5",
  FX_POS:        "#D1EFCF",
  FX_NEG:        "#ACDCF2",
  ISRAEL_TAX:    "#FFDCE1",
  CASH_DIV:      "#F8BE78",
  CASH_WH:       "#FFC7CE",
  CASH_END_USD:  "#C6EFCE",
  CASH_END_ILS:  "#C6DBFF",
  CASH_END_TOTAL:"#C6EFCE", // Specifically for Base Currency Summary row
  STOCKS_TOTAL:  "#BEFAC8"
};

// ============================================================
// HELPER FUNCTIONS
// These are the same helpers from your Apps Script (_low, _up,
// _has, _eq, _nz) just written as clean JS functions
// ============================================================

// Lowercase + trim a value
const low = v => String(v || '').trim().toLowerCase();

// Uppercase + trim a value
const up  = v => String(v || '').trim().toUpperCase();

// Check if a value contains a substring (case insensitive)
const has = (v, s) => String(v || '').toLowerCase().includes(String(s).toLowerCase());

// Check if a value exactly equals a string (case insensitive)
const eq  = (v, s) => String(v || '').trim().toLowerCase() === String(s).trim().toLowerCase();

// Check if a value is non-empty
const nz  = v => String(v || '').trim() !== '';

// ============================================================
// applyColorRules(sectionName, subheaders, values, allRows)
// ============================================================
// Main entry point called by parser.js for every data row.
//
// Parameters:
//   sectionName — e.g. "Cash Report"
//   subheaders  — the column headers for this section
//   values      — the data values for this specific row
//   allRows     — all rows in the section (needed for Stocks Total
//                 which looks at the row above)
//
// Returns a hex color string, or null if no rule matches.
// ============================================================
function applyColorRules(sectionName, subheaders, values, allRows) {
  const name = sectionName.toLowerCase();

  // Run each rule in order — first match wins
  // (same priority order as your Apps Script _run_rules_on_month)

  if (name.includes('trade summary by asset class'))
    return ruleCommissions(values);

  if (name === 'deposits & withdrawals')
    return ruleDNW(values);

  if (name.includes('trade summary by symbol'))
    return ruleFxConversions(values);

  if (name.includes('forex p/l details'))
    return ruleFxPLDetails(values);

  if (name.includes('fees'))
    return ruleIsraelTax(values);

  if (name.includes('cash report'))
    return ruleCashReport(values, allRows);

  if (name.includes('realized & unrealized performance summary'))
    return ruleStocksTotal(values, allRows);

  return null;
}

// ============================================================
// RULE 1 — Commissions
// Anchor: "Trade Summary by Asset Class"
// Action: Color ALL data rows yellow
// Same as _rule_commissions() in your Apps Script
// ============================================================
function ruleCommissions(values) {
  // Every row in this section gets colored — no condition needed
  return COLORS.COMMISSIONS;
}

// ============================================================
// RULE 2 — Deposits & Withdrawals
// Anchor: "Deposits & Withdrawals"
// Action: Color row if the 3rd column (index 2) is non-empty
// Same as _rule_dnw() in your Apps Script
// ============================================================
function ruleDNW(values) {
  // 3rd column = table-relative index 2 (0-based)
  // In your Apps Script: const c = Math.min(2, t.w-1)
  const c = Math.min(2, values.length - 1);
  if (nz(values[c])) return COLORS.DNW;
  return null;
}

// ============================================================
// RULE 3 — Forex Conversions
// Anchor: "Trade Summary by Symbol"
// Action: Color ONLY the first data row if it contains "forex"
// Same as _rule_fx_conversions() in your Apps Script
// ============================================================
function ruleFxConversions(values) {
  // Check if any cell in this row contains "forex"
  const hasForex = values.some(v => has(v, 'forex'));
  if (hasForex) return COLORS.CONVERSIONS;
  return null;
}

// ============================================================
// RULE 4 — Forex P/L Details
// Anchor: "Forex P/L Details"
// Description column = 3rd column (index 2)
// Rules:
//   - Skip rows with "Closed Lot" in description
//   - "NET CASH ACTIVITY" → orange (#F7E6D5)
//   - Contains "FOREX" and ends with "USD.ILS":
//       has "-" → negative → blue (#ACDCF2)
//       else    → positive → green (#D1EFCF)
// Same as _rule_fx_pl_details() in your Apps Script
// ============================================================
function ruleFxPLDetails(values) {
  // Description is in the 3rd column (table-relative index 2)
  const descCol  = Math.min(2, values.length - 1);
  const descRaw  = up(values[descCol]);

  if (!descRaw) return null;

  // Skip "Closed Lot" rows (e.g. "Closed Lot: Forex -449 USD.ILS")
  if (descRaw.includes('CLOSED LOT')) return null;

  // NET CASH ACTIVITY row
  if (descRaw === 'NET CASH ACTIVITY') return COLORS.FX_PL_NETCASH;

  // Forex USD.ILS rows — positive or negative
  if (descRaw.includes('FOREX') && /USD\.ILS$/.test(descRaw)) {
    // If description contains "-" it's a negative (loss)
    return descRaw.includes('-') ? COLORS.FX_NEG : COLORS.FX_POS;
  }

  return null;
}

// ============================================================
// RULE 5 — Israel Tax
// Anchor: "Fees"
// Action: Color row if first column exactly equals "Other Fees"
// Same as _rule_israel_tax() in your Apps Script
// ============================================================
function ruleIsraelTax(values) {
  if (eq(values[0], 'other fees')) return COLORS.ISRAEL_TAX;
  return null;
}

// ============================================================
// RULE 6 — Cash Report
// Anchor: "Cash Report"
// Compares first two columns (Left, Right):
//   Dividends + BASE CURRENCY SUMMARY          → #F8BE78
//   Withholding Tax + BASE CURRENCY SUMMARY    → #FFC7CE
//   Ending Cash + contains USD                 → #C6EFCE
//   Ending Cash + contains ILS                 → #C6DBFF
//   Fallback: Ending Cash + BASE CURRENCY SUMMARY → #C6EFCE
// Same as _rule_cash_report() in your Apps Script
// ============================================================
function ruleCashReport(values, allRows) {
  const left   = low(values[0]);
  const rightU = up(values[1]);

  if (left === 'dividends' && rightU === 'BASE CURRENCY SUMMARY')
    return COLORS.CASH_DIV;

  if (left === 'withholding tax' && rightU === 'BASE CURRENCY SUMMARY')
    return COLORS.CASH_WH;

  if (left === 'ending cash') {
    if (rightU === 'BASE CURRENCY SUMMARY') return COLORS.CASH_END_TOTAL;
    if (rightU.includes('USD')) return COLORS.CASH_END_USD;
    if (rightU.includes('ILS')) return COLORS.CASH_END_ILS;
  }

  // Fallback: if no USD ending cash found anywhere in the section,
  // color Ending Cash + Base Currency Summary as USD green
  // (second pass logic from your Apps Script)
  const usdFound = allRows.some(r =>
    low(r.values[0]) === 'ending cash' && (up(r.values[1]).includes('USD') || up(r.values[1]) === 'BASE CURRENCY SUMMARY')
  );
  if (!usdFound && left === 'ending cash' && eq(values[1], 'base currency summary'))
    return COLORS.CASH_END_TOTAL;

  return null;
}

// ============================================================
// RULE 7 — Stocks Total
// Anchor: "Realized & Unrealized Performance Summary"
// Rule: find a row where first column = "Total" AND the row
//       directly above it has first column = "Stocks"
// Same as _rule_stocks_total() in your Apps Script
// ============================================================
function ruleStocksTotal(values, allRows) {
  if (!eq(values[0], 'total')) return null;

  // Find this row's index in allRows, then check the row above
  const idx = allRows.findIndex(r => r.values === values);
  if (idx > 0 && eq(allRows[idx - 1].values[0], 'stocks')) {
    return COLORS.STOCKS_TOTAL;
  }

  return null;
}

module.exports = { applyColorRules, COLORS };
