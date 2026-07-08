/******************************************************
 * IBKR → Google Sheets: Unified Toolkit
 * Date: 2025-10-27
 *
 * Contains:
 * 1) CSV → Year sheets (pretty renderer) + Highlights
 * 2) Important_Info builder (40px rows from row 3, 162px cols)
 * 3) Portfolio builder (VBA mapping, values+colors, wraps data)
 * 4) Latest Cash (from Portfolio M:N) → Portfolio!A17:B20 (values+colors)
 * 5) Top section formatter (Portfolio A1:H16)
 *
 * Sizing policy:
 * - Important_Info: rows from row 3 = 40px; all columns = 162px.
 * - Portfolio: all rows = 36px; uniform col width 120px (data region wraps).
 ******************************************************/

/***********************
 * GLOBAL MENU
 ***********************/
function onOpen() {
  const ui = SpreadsheetApp.getUi();
  ui.createMenu("IBKR Tools")
    // CSV → Year
    .addItem("Insert Active Month → Year", "insertMonthIntoYearSheet")
    .addItem("Insert ALL Monthly Sheets → Years", "insertAllStatementsIntoYearSheets")
    .addSeparator()
    .addItem("Highlight (All Year Sheets)", "hl_all_year_sheets")
    .addItem("Highlight (Current Sheet)", "hl_current_sheet_all_rules")
    .addSubMenu(
      ui.createMenu("Specific highlights (current sheet)")
        .addItem("Commissions", "hl_current_commissions")
        .addItem("Deposits & Withdrawals", "hl_current_dnw")
        .addItem("Forex Conversions", "hl_current_fx_conversions")
        .addItem("Forex P/L Details", "hl_current_fx_pl_details")
        .addItem("Israel Tax", "hl_current_israel_tax")
        .addItem("Cash Report", "hl_current_cash_report")
        .addItem("Stocks Total", "hl_current_stocks_total")
    )
    .addSeparator()
    // Important_Info
    .addItem("Build Important_Info", "buildImportantInfo")
    .addSeparator()
    // Portfolio
    .addItem("Build Portfolio (VBA mapping)", "buildPortfolio_VBAMap")
    .addItem("Latest Cash (M:N) → A19", "writeLatestCashTwoRows_MN")
    .addItem("Format A1:H16 (center + outline)", "formatTopSection_A1_H16")
    .addToUi();
}

/***********************
 * SHARED UTILS
 ***********************/
function _colToIndex(a1col) {
  const s = String(a1col).replace(/[0-9]/g, '').toUpperCase();
  let n = 0; for (let i = 0; i < s.length; i++) n = n * 26 + (s.charCodeAt(i) - 64);
  return n;
}
function _getOrCreateSheet(name){
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sh = ss.getSheetByName(name);
  if (!sh) sh = ss.insertSheet(name);
  return sh;
}
function _ensureSheetSize(ws, minRows, minCols) {
  if (ws.getMaxColumns() < minCols) ws.insertColumnsAfter(ws.getMaxColumns(), minCols - ws.getMaxColumns());
  if (ws.getMaxRows() < minRows) ws.insertRowsAfter(ws.getMaxRows(), minRows - ws.getMaxRows());
}

/******************************************************
 * SECTION 1 — CSV → YEAR SHEETS + HIGHLIGHTS
 ******************************************************/
const YEAR_CFG = {
  MONTHS: ["January","February","March","April","May","June","July","August","September","October","November","December"],
  COLUMNS_PER_MONTH: 16,
  MONTH_HEADER_ROW: 1,
  PASTE_START_ROW: 3,
  DEFAULT_ROWS: 800,
  DEFAULT_COLS: 192,
  TITLE_FILL: "#DCE6F1",
  SUBHEADER_FILL: "#E6E6E6",
  MONTH_HEADER_FONT_SIZE: 16,
  TITLE_FONT_SIZE: 13,
  SUBHEADER_FONT_SIZE: 12,
  FIXED_ROW_HEIGHT_PX: 58,
  FIXED_WIDE_COL_PX: 227,
  FIXED_NARROW_COL_PX: 138
};

const CFG = {
  MONTHS: 12,
  COLS_PER_MONTH: 16,
  PASTE_START_ROW: 3,
  DEFAULT_ROWS: 800,
  COLORS: {
    COMMISSIONS:  "#FFE699",
    DNW:          "#E1C8E6",
    CONVERSIONS:  "#F29D94",
    FX_PL_NETCASH:"#F7E6D5",
    FX_POS:       "#D1EFCF",
    FX_NEG:       "#ACDCF2",
    ISRAEL_TAX:   "#FFDCE1",
    CASH_DIV:     "#F8BE78",
    CASH_WH:      "#FFC7CE",
    CASH_END_USD: "#C6EFCE",
    CASH_END_ILS: "#C6DBFF",
    STOCKS_TOTAL: "#BEFAC8"
  }
};

// Entry points
function insertMonthIntoYearSheet() {
  insertMonthIntoYearSheet_FromSheet(SpreadsheetApp.getActiveSheet(), true);
}
function insertAllStatementsIntoYearSheets() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let ok=0, skip=0, fail=0;
  const t0 = Date.now();
  ss.getSheets().forEach(sh => {
    const parsed = parseMonthYearFromD3Text(safeDisp(sh.getRange("D3")));
    if (!parsed) { skip++; return; }
    if (insertMonthIntoYearSheet_FromSheet(sh, false)) ok++; else fail++;
  });
  SpreadsheetApp.getUi().alert(
`Batch finished.
Inserted: ${ok}
Skipped: ${skip}
Failed: ${fail}
Elapsed: ${((Date.now()-t0)/1000).toFixed(1)}s`
  );
}
function insertMonthIntoYearSheet_FromSheet(srcSh, showMsg) {
  try {
    const parsed = parseMonthYearFromD3Text(safeDisp(srcSh.getRange("D3")));
    if (!parsed) { if (showMsg) SpreadsheetApp.getUi().alert("Active sheet is not a monthly statement (D3)."); return false; }
    const { monthIndex, monthName, yearStr } = parsed;

    const yearSh = getOrCreateYearSheet(yearStr);

    const lastRow = srcSh.getLastRow(), lastCol = srcSh.getLastColumn();
    if (lastRow < 1) { if (showMsg) SpreadsheetApp.getUi().alert("No data rows."); return false; }
    const raw = srcSh.getRange(1, 1, lastRow, lastCol).getValues();

    const startCol = 1 + (monthIndex - 1) * YEAR_CFG.COLUMNS_PER_MONTH;
    const startRow = YEAR_CFG.PASTE_START_ROW;

    const usedHeight = Math.max(1, Math.min(800, raw.length + 50));
    _ensureSheetSize(yearSh, startRow + usedHeight + 20, Math.max(yearSh.getMaxColumns(), startCol + YEAR_CFG.COLUMNS_PER_MONTH - 1));
    yearSh.getRange(startRow, startCol, usedHeight, YEAR_CFG.COLUMNS_PER_MONTH).clearContent();

    _renderPrettySectionsFixedSizes_(yearSh, startRow, startCol, raw, YEAR_CFG.COLUMNS_PER_MONTH);

    if (showMsg) SpreadsheetApp.getUi().alert(`Inserted ${monthName} ${yearStr} into '${yearSh.getName()}'.`);
    return true;
  } catch (e) {
    if (showMsg) SpreadsheetApp.getUi().alert("Error: " + e);
    Logger.log(e);
    return false;
  }
}

// Renderer
function _renderPrettySectionsFixedSizes_(dstSh, dstRow0, dstCol0, rows, maxBlockWidth) {
  const skipSections = new Set(["Statement"]);
  const DATE_FMT = "m/d/yyyy";
  let rOut = dstRow0;
  const trimRight = arr => {
    let k = arr.length - 1;
    while (k >= 0 && (arr[k] === "" || arr[k] == null)) k--;
    return arr.slice(0, k + 1);
  };

  for (let i = 0; i < rows.length; i++) {
    const line = rows[i] ? rows[i].map(v => (v == null ? "" : String(v))) : [];
    const section = (line[0] || "").trim();
    const kind = (line[1] || "").trim().toLowerCase();
    if (!section || skipSections.has(section) || kind !== "header") continue;

    const subheadersRaw = trimRight(line.slice(2));
    const w = Math.min(maxBlockWidth, Math.max(1, subheadersRaw.length));

    const titleRng = dstSh.getRange(rOut, dstCol0, 1, w);
    if (w > 1) titleRng.merge();
    titleRng
      .setValue(section)
      .setFontWeight("bold")
      .setFontSize(YEAR_CFG.TITLE_FONT_SIZE)
      .setBackground(YEAR_CFG.TITLE_FILL)
      .setBorder(true, true, true, true, false, false, null, SpreadsheetApp.BorderStyle.SOLID);
    rOut++;

    const hdr = subheadersRaw.slice(0, w);
    if (hdr.length < w) hdr.push(...new Array(w - hdr.length).fill(""));
    const hdrRng = dstSh.getRange(rOut, dstCol0, 1, w);
    hdrRng
      .setValues([hdr])
      .setFontWeight("bold")
      .setFontSize(YEAR_CFG.SUBHEADER_FONT_SIZE)
      .setBackground(YEAR_CFG.SUBHEADER_FILL)
      .setBorder(true, true, true, true, true, true, null, SpreadsheetApp.BorderStyle.SOLID);
    rOut++;

    let j = i + 1;
    const dataRows = [];
    while (j < rows.length) {
      const rr = rows[j] ? rows[j].map(v => (v == null ? "" : String(v))) : [];
      const sec2 = (rr[0] || "").trim();
      const kind2 = (rr[1] || "").trim().toLowerCase();
      if (sec2 !== section) break;
      if (kind2 === "header") break;
      if (kind2 === "data") {
        const rawVals = rr.slice(2);
        let k = rawVals.length - 1; while (k >= 0 && (rawVals[k] === "" || rawVals[k] == null)) k--;
        const slice = rawVals.slice(0, Math.max(0, Math.min(w, k + 1)));
        if (slice.length < w) slice.push(...new Array(w - slice.length).fill(""));
        dataRows.push(slice);
      }
      j++;
    }

    if (dataRows.length) {
      const dataRng = dstSh.getRange(rOut, dstCol0, dataRows.length, w);
      dataRng.setValues(dataRows);
      const dateColIdx = hdr.findIndex(h => h.toLowerCase().includes("settle date"));
      if (dateColIdx >= 0) dstSh.getRange(rOut, dstCol0 + dateColIdx, dataRows.length, 1).setNumberFormat(DATE_FMT);
      dataRng.setBorder(true, true, true, true, true, true, null, SpreadsheetApp.BorderStyle.SOLID);
      rOut += dataRows.length;
    }

    rOut++;
    i = j - 1;
  }
}

// Helpers for CSV→Year
function getOrCreateYearSheet(yearName) {
  const sh = _getOrCreateSheet(yearName);
  _ensureSheetSize(sh, YEAR_CFG.DEFAULT_ROWS, YEAR_CFG.DEFAULT_COLS);
  sh.getRange(1, 1, YEAR_CFG.DEFAULT_ROWS, YEAR_CFG.DEFAULT_COLS)
    .setHorizontalAlignment("center")
    .setVerticalAlignment("middle")
    .setWrap(true);
  sh.setRowHeights(1, YEAR_CFG.DEFAULT_ROWS, YEAR_CFG.FIXED_ROW_HEIGHT_PX);
  for (let m = 0; m < 12; m++) {
    const base = 1 + m * YEAR_CFG.COLUMNS_PER_MONTH;
    sh.setColumnWidths(base, 4, YEAR_CFG.FIXED_WIDE_COL_PX);
    sh.setColumnWidths(base + 4, YEAR_CFG.COLUMNS_PER_MONTH - 4, YEAR_CFG.FIXED_NARROW_COL_PX);
  }
  for (let m = 1; m <= 12; m++) {
    const startCol = 1 + (m - 1) * YEAR_CFG.COLUMNS_PER_MONTH;
    const header = sh.getRange(YEAR_CFG.MONTH_HEADER_ROW, startCol, 1, YEAR_CFG.COLUMNS_PER_MONTH);
    header.breakApart().clear({ contentsOnly: false });
    header.merge()
      .setValue(YEAR_CFG.MONTHS[m - 1])
      .setFontWeight("bold")
      .setFontSize(YEAR_CFG.MONTH_HEADER_FONT_SIZE)
      .setBackground(YEAR_CFG.TITLE_FILL)
      .setBorder(false, false, true, false, false, false, null, SpreadsheetApp.BorderStyle.SOLID);
  }
  return sh;
}
function safeDisp(rng) { try { return (rng.getDisplayValue() || "").trim(); } catch (e) { return ""; } }
function parseMonthYearFromD3Text(s) {
  if (!s) return null;
  const first = s.split("-")[0].trim();
  const parts = first.split(",");
  if (parts.length < 2) return null;
  const monthTok = parts[0].trim().split(/\s+/)[0];
  const yearStr = parts[1].trim();
  const mi = YEAR_CFG.MONTHS.findIndex(m => m.toLowerCase() === monthTok.toLowerCase());
  if (mi < 0) return null;
  return { monthIndex: mi + 1, monthName: YEAR_CFG.MTHS ? YEAR_CFG.MTHS[mi] : YEAR_CFG.MONTHS[mi], yearStr };
}

/***********************
 * HIGHLIGHTS
 ***********************/
function hl_all_year_sheets() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheets = ss.getSheets().filter(sh => /^\d{4}$/.test(sh.getName()));
  sheets.forEach(sh => _run_all_rules_on_sheet(sh));
  SpreadsheetApp.getUi().alert("Highlights complete (all year sheets).");
}
function hl_current_sheet_all_rules() {
  const sh = SpreadsheetApp.getActiveSheet();
  _assert_year_sheet(sh);
  _run_all_rules_on_sheet(sh);
  SpreadsheetApp.getUi().alert("Highlights complete (current sheet).");
}
function hl_current_commissions(){ _run_rules_on_sheet(SpreadsheetApp.getActiveSheet(), ["commissions"]); }
function hl_current_dnw(){ _run_rules_on_sheet(SpreadsheetApp.getActiveSheet(), ["dnw"]); }
function hl_current_fx_conversions(){ _run_rules_on_sheet(SpreadsheetApp.getActiveSheet(), ["fx_conversions"]); }
function hl_current_fx_pl_details(){ _run_rules_on_sheet(SpreadsheetApp.getActiveSheet(), ["fx_pl_details"]); }
function hl_current_israel_tax(){ _run_rules_on_sheet(SpreadsheetApp.getActiveSheet(), ["israel_tax"]); }
function hl_current_cash_report(){ _run_rules_on_sheet(SpreadsheetApp.getActiveSheet(), ["cash_report"]); }
function hl_current_stocks_total(){ _run_rules_on_sheet(SpreadsheetApp.getActiveSheet(), ["stocks_total"]); }

function _run_all_rules_on_sheet(sh){
  _assert_year_sheet(sh);
  _run_rules_on_sheet(sh, ["commissions","dnw","fx_conversions","fx_pl_details","israel_tax","cash_report","stocks_total"]);
}
function _run_rules_on_sheet(sh, which) {
  _assert_year_sheet(sh);
  for (let m = 0; m < CFG.MONTHS; m++) {
    const win = _month_data_window(sh, m);
    if (!win.hasData) continue;
    _run_rules_on_month(sh, m, which, win);
  }
}
function _run_rules_on_month(sh, monthIndex, which, win) {
  const baseCol = 1 + monthIndex * CFG.COLS_PER_MONTH;
  const r0 = CFG.PASTE_START_ROW;
  const height = win ? win.height : (CFG.DEFAULT_ROWS - CFG.PASTE_START_ROW + 1);
  if (!height || height < 1) return;

  const rng = sh.getRange(r0, baseCol, height, CFG.COLS_PER_MONTH);
  const values = rng.getDisplayValues();
  const bgs = rng.getBackgrounds();

  let r = 0;
  while (r < values.length) {
    if (_emptyFirst(values, r) && _emptyFirst(values, r + 1)) break;
    if (_emptyFirst(values, r)) { r++; continue; }

    const headerRow = r;
    const subHeaderRow = r + 1;
    if (subHeaderRow >= values.length) break;

    let w = _lastNonEmptyIndex(values[subHeaderRow]) + 1;
    if (w <= 0) { w = _lastNonEmptyIndex(values[headerRow]) + 1; if (w <= 0) w = CFG.COLS_PER_MONTH; }

    const dataStart = subHeaderRow + 1;
    let dataEnd = dataStart - 1;
    for (let rr = dataStart; rr < values.length; rr++) {
      if (_emptyFirst(values, rr)) break;
      dataEnd = rr;
    }

    if (w > 0 && dataEnd >= dataStart) {
      const table = { baseCol, r0, headerRow, subHeaderRow, dataStart, dataEnd, w, values, bgs };

      if (which.includes("commissions"))    _rule_commissions(table);
      if (which.includes("dnw"))            _rule_dnw(table);
      if (which.includes("fx_conversions")) _rule_fx_conversions(table);
      if (which.includes("fx_pl_details"))  _rule_fx_pl_details(table);
      if (which.includes("israel_tax"))     _rule_israel_tax(table);
      if (which.includes("cash_report"))    _rule_cash_report(table);
      if (which.includes("stocks_total"))   _rule_stocks_total(table);
    }

    r = dataEnd + 1;
    if (r < values.length && _emptyFirst(values, r)) r++;
  }

  rng.setBackgrounds(bgs);
}

// Highlight helpers/rules
function _month_data_window(sh, monthIndex) {
  const baseCol = 1 + monthIndex * CFG.COLS_PER_MONTH;
  const r0 = CFG.PASTE_START_ROW;
  const maxH = CFG.DEFAULT_ROWS - CFG.PASTE_START_ROW + 1;

  const firstColVals = sh.getRange(r0, baseCol, maxH, 1).getDisplayValues();

  let endRow = -1;
  let emptyCount = 0;
  for (let i = 0; i < firstColVals.length; i++) {
    const v = (firstColVals[i][0] || "").trim();
    if (v === "") emptyCount++;
    else emptyCount = 0;
    if (emptyCount >= 2) { endRow = i - 2; break; }
  }

  if (endRow < 0) {
    for (let i = firstColVals.length - 1; i >= 0; i--) {
      const v = (firstColVals[i][0] || "").trim();
      if (v !== "") { endRow = i; break; }
    }
  }

  if (endRow < 0) return { hasData: false, height: 0 };
  return { hasData: true, height: endRow + 1 };
}
function _assert_year_sheet(sh){
  if (!/^\d{4}$/.test(sh.getName())) throw new Error("Active sheet is not a Year sheet (name should be YYYY).");
}
function _emptyFirst(values, r){
  if (r >= values.length) return true;
  const v = values[r] && values[r][0];
  return !v || String(v).trim() === "";
}
function _lastNonEmptyIndex(row){
  for (let i = row.length-1; i >= 0; i--) if (String(row[i]||"").trim() !== "") return i;
  return -1;
}
function _rowIs(row, text, w){
  const tgt = text.toLowerCase();
  for (let c = 0; c < w; c++) if (String(row[c]||"").trim().toLowerCase() === tgt) return true;
  return false;
}
function _rowHas(row, text, w){
  const tgt = text.toLowerCase();
  for (let c = 0; c < w; c++) if (String(row[c]||"").toLowerCase().indexOf(tgt) !== -1) return true;
  return false;
}
function _fillRowSpan(bgs, r, c0, c1, hex){
  if (c1 < c0) return;
  for (let c = c0; c <= c1; c++) bgs[r][c] = hex;
}
const _low = v => String(v||"").trim().toLowerCase();
const _up  = v => String(v||"").trim().toUpperCase();
const _has = (v, s) => String(v||"").toLowerCase().indexOf(String(s).toLowerCase()) !== -1;
const _eq  = (v, s) => String(v||"").trim().toLowerCase() === String(s).trim().toLowerCase();
const _nz  = v => String(v||"").trim() !== "";

function _rule_commissions(t){
  if (!_rowHas(t.values[t.headerRow], "trade summary by asset class", t.w)) return;
  for (let r = t.dataStart; r <= t.dataEnd; r++) _fillRowSpan(t.bgs, r, 0, t.w-1, CFG.COLORS.COMMISSIONS);
}
function _rule_dnw(t){
  if (!_rowIs(t.values[t.headerRow], "deposits & withdrawals", t.w)) return;
  const c = Math.min(2, t.w-1);
  for (let r = t.dataStart; r <= t.dataEnd; r++) {
    if (_nz(t.values[r][c])) _fillRowSpan(t.bgs, r, 0, t.w-1, CFG.COLORS.DNW);
  }
}
function _rule_fx_conversions(t){
  if (!_rowHas(t.values[t.headerRow], "trade summary by symbol", t.w)) return;
  const r = t.dataStart;
  if (r > t.dataEnd) return;
  for (let c = 0; c < t.w; c++) {
    if (_has(t.values[r][c], "forex")) { _fillRowSpan(t.bgs, r, 0, t.w-1, CFG.COLORS.CONVERSIONS); break; }
  }
}
function _rule_fx_pl_details(t){
  if (!_rowHas(t.values[t.headerRow], "forex p/l details", t.w)) return;
  const descCol = Math.min(2, t.w - 1);
  for (let r = t.dataStart; r <= t.dataEnd; r++) {
    const descRaw = _up(t.values[r][descCol]);
    if (!descRaw) continue;
    if (descRaw.indexOf("CLOSED LOT") !== -1) continue;
    if (descRaw === "NET CASH ACTIVITY") {
      _fillRowSpan(t.bgs, r, 0, t.w - 1, CFG.COLORS.FX_PL_NETCASH);
      continue;
    }
    if (descRaw.indexOf("FOREX") !== -1 && /USD\.ILS$/.test(descRaw)) {
      const color = (descRaw.indexOf("-") !== -1) ? CFG.COLORS.FX_NEG : CFG.COLORS.FX_POS;
      _fillRowSpan(t.bgs, r, 0, t.w - 1, color);
      continue;
    }
  }
}
function _rule_israel_tax(t){
  if (!_rowHas(t.values[t.headerRow], "fees", t.w)) return;
  for (let r = t.dataStart; r <= t.dataEnd; r++) {
    if (_eq(t.values[r][0], "other fees")) _fillRowSpan(t.bgs, r, 0, t.w-1, CFG.COLORS.ISRAEL_TAX);
  }
}
function _rule_cash_report(t){
  if (!_rowHas(t.values[t.headerRow], "cash report", t.w)) return;
  let usdFound = false;
  for (let r = t.dataStart; r <= t.dataEnd; r++) {
    const left = _low(t.values[r][0]);
    const rightU = _up(t.values[r][1]);
    if (left === "dividends" && rightU === "BASE CURRENCY SUMMARY") {
      _fillRowSpan(t.bgs, r, 0, t.w-1, CFG.COLORS.CASH_DIV);
    } else if (left === "withholding tax" && rightU === "BASE CURRENCY SUMMARY") {
      _fillRowSpan(t.bgs, r, 0, t.w-1, CFG.COLORS.CASH_WH);
    } else if (left === "ending cash") {
      if (rightU.indexOf("USD") !== -1) { _fillRowSpan(t.bgs, r, 0, t.w-1, CFG.COLORS.CASH_END_USD); usdFound = true; }
      else if (rightU.indexOf("ILS") !== -1) { _fillRowSpan(t.bgs, r, 0, t.w-1, CFG.COLORS.CASH_END_ILS); }
    }
  }
  if (!usdFound) {
    for (let r = t.dataStart; r <= t.dataEnd; r++) {
      if (_eq(t.values[r][0], "ending cash") && _eq(t.values[r][1], "base currency summary")) {
        _fillRowSpan(t.bgs, r, 0, t.w-1, CFG.COLORS.CASH_END_USD);
        break;
      }
    }
  }
}
function _rule_stocks_total(t){
  if (!_rowHas(t.values[t.headerRow], "realized & unrealized performance summary", t.w)) return;
  for (let r = t.dataStart; r <= t.dataEnd; r++) {
    if (_eq(t.values[r][0], "total") && r-1 >= t.subHeaderRow+1 && _eq(t.values[r-1][0], "stocks")) {
      _fillRowSpan(t.bgs, r, 0, t.w-1, CFG.COLORS.STOCKS_TOTAL);
    }
  }
}

/******************************************************
 * SECTION 2 — IMPORTANT_INFO BUILDER (40px rows, 162px cols)
 ******************************************************/
const IMP_CFG = {
  DEST_SHEET: "Important_Info",
  YEARS: null,
  ROWS_PER_MONTH: 5,
  SPACER_ROWS: 1,
  MONTH_COLS: 16,
  SCAN_LIMIT_ROWS: 100,
  START_ROW: 3,
  HEADER_ROW1_HEIGHT: 25,
  HEADER_ROW2_HEIGHT: 35,
  DATA_ROW_HEIGHT: 40,        // Excel-equivalent for Important_Info
  HEADER_MAIN_FILL: "#DCE6F1",
  HEADER_SUB_FILL:  "#C8C8C8",
  DATA_COL_WIDTH_PX: 162      // Excel-equivalent for Important_Info
};

const IMP_LAYOUT = {
  YEAR_COL: "A",
  MONTH_COL: "B",
  RANGES: {
    FOREX_BAL:  "D:H",
    CURR_ACT:   "J:S",
    CONVERSIONS:"U:AC",
    DNW:        "AE:AH",
    COMM:       "AJ:AO",
    ISR_TAX:    "AQ:AU",
    US_WHT:     "AW:BA",
    RU:         "BC:BQ",
    DIV:        "BS:BW"
  },
  SPACERS: ["C","I","T","AD","AI","AP","AV","BB","BR","BY"]
};

const IMP_COLORS = {
  FOREX_BAL_A:   "#C6DBFF",
  FOREX_BAL_B:   "#C6EFCE",
  CURR_ACT_A:    "#F7E6D5",
  CURR_ACT_B:    "#D1EFCF",
  CURR_ACT_C:    "#ACDCF2",
  CONVERSIONS:   "#F29D94",
  DNW:           "#E1C8E6",
  COMMISSIONS:   "#FFE699",
  ISRAEL_TAX:    "#FFDCE1",
  US_WHT:        "#FFC7CE",
  RU_SUMMARY:    "#BEFAC8",
  DIVIDENDS:     "#F8BE78"
};

function buildImportantInfo() {
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const dest = _getOrCreateSheet(IMP_CFG.DEST_SHEET);

    _setupImportantInfoHeaders(dest);

    // Pick year sheets
    let yearSheets = _pickYearSheets(ss, IMP_CFG.YEARS);
    if (!yearSheets.length) throw new Error("No year sheets found (YYYY).");
    yearSheets = yearSheets.sort((a,b) => Number(a.getName()) - Number(b.getName()));

    // Clear data region only (keep header borders)
    const maxCols = _colToIndex("BX");
    const maxRows = Math.max(dest.getMaxRows(), 800);
    if (maxRows >= IMP_CFG.START_ROW) {
      const clearRng = dest.getRange(IMP_CFG.START_ROW, 1, maxRows - IMP_CFG.START_ROW + 1, maxCols);
      clearRng.clearContent().setBackground(null);
    }

    let rowPtr = IMP_CFG.START_ROW;
    for (const ysh of yearSheets) {
      const yearVal = parseInt(ysh.getName(), 10);
      for (let m = 1; m <= 12; m++) {
        rowPtr = _processMonthToImportantInfo(ysh, yearVal, m, dest, rowPtr);
        rowPtr += IMP_CFG.ROWS_PER_MONTH + IMP_CFG.SPACER_ROWS;
      }
    }

    _formatImportantInfoSheet(dest);
    SpreadsheetApp.getUi().alert("Important_Info build complete (fixed 40px rows, 162px columns).");
  } catch (e) {
    Logger.log("buildImportantInfo error: " + (e && e.stack ? e.stack : e));
    throw e;
  }
}

// Important_Info header writer
function _setupImportantInfoHeaders(ws) {
  _ensureImportantInfoMinimum(ws);

  ws.getRange("A1:BW2").clear({ contentsOnly: true });
  ws.getRange("A1:BW2").setBackground(null).setBorder(false,false,false,false,false,false);

  ws.setRowHeight(1, IMP_CFG.HEADER_ROW1_HEIGHT);
  ws.setRowHeight(2, IMP_CFG.HEADER_ROW2_HEIGHT);

  ws.getRange("A1:A2").merge().setValue("Year");
  ws.getRange("B1:B2").merge().setValue("Month");
  ws.getRange("A1:A2").setHorizontalAlignment("center").setVerticalAlignment("middle").setWrap(true);
  ws.getRange("B1:B2").setHorizontalAlignment("center").setVerticalAlignment("middle").setWrap(true);
  ws.getRange("A1:A2").setBorder(true,true,true,true,true,true,null,SpreadsheetApp.BorderStyle.SOLID);
  ws.getRange("B1:B2").setBorder(true,true,true,true,true,true,null,SpreadsheetApp.BorderStyle.SOLID);
  ws.getRange("A1").setBackground(IMP_CFG.HEADER_MAIN_FILL).setFontWeight("bold");
  ws.getRange("B1").setBackground(IMP_CFG.HEADER_MAIN_FILL).setFontWeight("bold");
  ws.getRange("A2").setBackground(IMP_CFG.HEADER_SUB_FILL).setFontWeight("bold");

  const writeGroup = (title, rangeA1, subs) => {
    const rng = ws.getRange(rangeA1);
    const c1 = rng.getColumn();
    const cols = rng.getNumColumns();

    const top = ws.getRange(1, c1, 1, cols);
    top.merge().setValue(title)
       .setFontWeight("bold")
       .setBackground(IMP_CFG.HEADER_MAIN_FILL)
       .setBorder(true,true,true,true,false,false,null,SpreadsheetApp.BorderStyle.SOLID)
       .setHorizontalAlignment("center").setVerticalAlignment("middle").setWrap(true);

    const sub = ws.getRange(2, c1, 1, cols);
    sub.setValues([subs.slice(0, cols)])
       .setFontWeight("bold")
       .setBackground(IMP_CFG.HEADER_SUB_FILL)
       .setBorder(true,true,true,true,true,true,null,SpreadsheetApp.BorderStyle.SOLID)
       .setHorizontalAlignment("center").setVerticalAlignment("middle").setWrap(true);
  };

  writeGroup("Forex Balances", "D1:H2", [
    "Currency Summary","Currency","Total","Securities","Futures"
  ]);
  writeGroup("Currency Activity", "J1:S2", [
    "Asset Category","Currency","Description","Date/Time","FX Currency",
    "Quantity","Proceeds in USD","Basis in USD","Realized P/L in USD","Code"
  ]);
  writeGroup("Currency Conversions", "U1:AC2", [
    "Asset Category","Currency","Symbol",
    "Buys Quantity","Buys Avg. Price","Buys Proceeds",
    "Sells Quantity","Sells Avg. Price","Sells Proceeds"
  ]);
  writeGroup("Deposits & Withdrawals", "AE1:AH2", [
    "Currency","Settle Date","Description","Amount"
  ]);
  writeGroup("Commission", "AJ1:AO2", [
    "Asset Category","Total Number of Trades",
    "Total Shares (or Contracts) Bought",
    "Total Shares (or Contracts) Sold",
    "Total Commissions","Commission Rate"
  ]);
  writeGroup("Israel Tax", "AQ1:AU2", [
    "Subtitle","Currency","Date","Description","Amount"
  ]);
  writeGroup("US Withholding Tax", "AW1:BA2", [
    "Currency Summary","Currency","Total","Securities","Futures"
  ]);
  writeGroup("Realized & Unrealized Performance Summary", "BC1:BQ2", [
    "Asset Category","Symbol","Cost Adj.",
    "Realized S/T Profit","Realized S/T Loss","Realized L/T Profit","Realized L/T Loss","Realized Total",
    "Unrealized S/T Profit","Unrealized S/T Loss","Unrealized L/T Profit","Unrealized L/T Loss","Unrealized Total",
    "Total","Code"
  ]);
  writeGroup("Dividends", "BS1:BW2", [
    "Currency Summary","Currency","Total","Securities","Futures"
  ]);

  _clearHeaderSpacersAndBorder(ws);
  ws.getRange("A1:BW2").setFontSize(10);
}

function _processMonthToImportantInfo(yearSh, yearVal, monthNum, dest, startRow) {
  const monthBaseCol = 1 + (monthNum - 1) * IMP_CFG.MONTH_COLS;
  const monthRange = yearSh.getRange(1, monthBaseCol, Math.max(IMP_CFG.SCAN_LIMIT_ROWS, 1), IMP_CFG.MONTH_COLS);
  const vals = monthRange.getDisplayValues();
  const bgs  = monthRange.getBackgrounds();

  const cats = _initCategoryBuffers();

  for (let r = 0; r < vals.length; r++) {
    let firstColor = null;
    for (let c = 0; c < IMP_CFG.MONTH_COLS; c++) {
      const bg = _normHex(bgs[r][c]);
      if (bg && bg !== "#FFFFFF") { firstColor = bg; break; }
    }
    if (!firstColor) continue;
    const catKey = _mapColorToCategory(firstColor);
    if (!catKey) continue;
    const slot = cats[catKey];
    if (slot.count >= IMP_CFG.ROWS_PER_MONTH) continue;

    const rowIdx = slot.count;
    for (let c = 0; c < IMP_CFG.MONTH_COLS; c++) {
      slot.data[rowIdx][c] = vals[r][c] || "";
      slot.formats[rowIdx][c] = { bg: _normHex(bgs[r][c]) || "#FFFFFF" };
    }
    slot.count++;
  }

  const monthName = _monthName(monthNum);
  _writeYearMonthMerged(dest, startRow, yearVal, monthName);

  _writeCategory(dest, cats.FOREX_BAL, IMP_LAYOUT.RANGES.FOREX_BAL, startRow);
  _writeCategory(dest, cats.CURR_ACT,  IMP_LAYOUT.RANGES.CURR_ACT,  startRow);
  _writeCategory(dest, cats.CONV,      IMP_LAYOUT.RANGES.CONVERSIONS,startRow);
  _writeCategory(dest, cats.DNW,       IMP_LAYOUT.RANGES.DNW,       startRow);
  _writeCategory(dest, cats.COMM,      IMP_LAYOUT.RANGES.COMM,      startRow);
  _writeCategory(dest, cats.ISR,       IMP_LAYOUT.RANGES.ISR_TAX,   startRow);
  _writeCategory(dest, cats.USWHT,     IMP_LAYOUT.RANGES.US_WHT,    startRow);
  _writeCategory(dest, cats.RU,        IMP_LAYOUT.RANGES.RU,        startRow);
  _writeCategory(dest, cats.DIV,       IMP_LAYOUT.RANGES.DIV,       startRow);

  dest.setRowHeights(startRow, IMP_CFG.ROWS_PER_MONTH, IMP_CFG.DATA_ROW_HEIGHT);

  return startRow;
}

function _initCategoryBuffers() {
  const mk = () => ({
    data: Array.from({length: IMP_CFG.ROWS_PER_MONTH}, () => Array(IMP_CFG.MONTH_COLS).fill("")),
    formats: Array.from({length: IMP_CFG.ROWS_PER_MONTH}, () => Array(IMP_CFG.MONTH_COLS).fill(null)),
    count: 0
  });
  return {
    FOREX_BAL: mk(),
    CURR_ACT:  mk(),
    CONV:      mk(),
    DNW:       mk(),
    COMM:      mk(),
    ISR:       mk(),
    USWHT:     mk(),
    RU:        mk(),
    DIV:       mk()
  };
}
function _mapColorToCategory(hex) {
  const C = IMP_COLORS;
  switch (hex) {
    case C.FOREX_BAL_A:
    case C.FOREX_BAL_B: return "FOREX_BAL";
    case C.CURR_ACT_A:
    case C.CURR_ACT_B:
    case C.CURR_ACT_C: return "CURR_ACT";
    case C.CONVERSIONS: return "CONV";
    case C.DNW:         return "DNW";
    case C.COMMISSIONS: return "COMM";
    case C.ISRAEL_TAX:  return "ISR";
    case C.US_WHT:      return "USWHT";
    case C.RU_SUMMARY:  return "RU";
    case C.DIVIDENDS:   return "DIV";
    default: return "";
  }
}

function _writeYearMonthMerged(ws, startRow, yearVal, monthName) {
  const yrCol = _colToIndex(IMP_LAYOUT.YEAR_COL);
  const moCol = _colToIndex(IMP_LAYOUT.MONTH_COL);

  const yrBand = ws.getRange(startRow, yrCol, IMP_CFG.ROWS_PER_MONTH, 1);
  const moBand = ws.getRange(startRow, moCol, IMP_CFG.ROWS_PER_MONTH, 1);

  yrBand.clearContent().merge();
  moBand.clearContent().merge();

  ws.getRange(startRow, yrCol).setValue(yearVal);
  ws.getRange(startRow, moCol).setValue(monthName);

  const bandBoth = ws.getRange(startRow, yrCol, IMP_CFG.ROWS_PER_MONTH, 2);
  bandBoth
    .setHorizontalAlignment("center")
    .setVerticalAlignment("middle")
    .setWrap(true)
    .setFontWeight("bold");

  yrBand.setBorder(true,true,true,true,true,true,null,SpreadsheetApp.BorderStyle.SOLID);
  moBand.setBorder(true,true,true,true,true,true,null,SpreadsheetApp.BorderStyle.SOLID);
}

function _writeCategory(ws, slot, a1Range, startRow) {
  const [c1, c2] = _a1RangeToCols(a1Range);
  const width = c2 - c1 + 1;

  const band = ws.getRange(startRow, c1, IMP_CFG.ROWS_PER_MONTH, width);
  band.clearContent().setBackground(null);

  const rows = Math.min(slot.count, IMP_CFG.ROWS_PER_MONTH);
  if (rows > 0) {
    const out = ws.getRange(startRow, c1, rows, width);
    const data = slot.data.slice(0, rows).map(r => r.slice(0, width));
    out.setValues(data);

    const bgMatrix = Array.from({length: rows}, (_, r) =>
      Array.from({length: width}, (_, c) => (slot.formats[r][c]?.bg || "#FFFFFF"))
    );
    out.setBackgrounds(bgMatrix);
  }

  band.setBorder(true,true,true,true,true,true,null,SpreadsheetApp.BorderStyle.SOLID);
  band.setHorizontalAlignment("center").setVerticalAlignment("middle").setWrap(true);
}

function _formatImportantInfoSheet(ws) {
  _ensureImportantInfoMinimum(ws);

  const lastRow = Math.max(ws.getLastRow(), IMP_CFG.START_ROW);

  ws.setColumnWidths(1, _colToIndex("BX"), IMP_CFG.DATA_COL_WIDTH_PX);

  const totalRows = ws.getMaxRows();
  if (totalRows >= IMP_CFG.START_ROW) {
    ws.setRowHeights(IMP_CFG.START_ROW, totalRows - IMP_CFG.START_ROW + 1, IMP_CFG.DATA_ROW_HEIGHT);
  }

  if (lastRow >= IMP_CFG.START_ROW) {
    ws.getRange(IMP_CFG.START_ROW, 1, lastRow - IMP_CFG.START_ROW + 1, _colToIndex("BX"))
      .setHorizontalAlignment("center")
      .setVerticalAlignment("middle")
      .setWrap(true)
      .setFontSize(10);
  }
  ws.setFrozenRows(2);
}

function _clearHeaderSpacersAndBorder(ws) {
  for (const col of IMP_LAYOUT.SPACERS) {
    const idx = _colToIndex(col);
    const rng = ws.getRange(1, idx, 2, 1);
    rng.setBackground(null);
    rng.setBorder(false, true, false, true, false, false, null, SpreadsheetApp.BorderStyle.SOLID);
  }
}
function _ensureImportantInfoMinimum(ws) {
  const minCols = _colToIndex("BX");
  const minRows = 800;
  _ensureSheetSize(ws, minRows, minCols);
}
function _pickYearSheets(ss, years) {
  if (Array.isArray(years) && years.length) {
    return years.map(y => ss.getSheetByName(String(y))).filter(Boolean);
  }
  return ss.getSheets().filter(sh => /^\d{4}$/.test(sh.getName()));
}
function _normHex(s) {
  if (!s) return "";
  const m = String(s).trim();
  if (!m) return "";
  if (/^#([0-9a-fA-F]{6})$/.test(m)) return m.toUpperCase();
  return "";
}
function _a1RangeToCols(a1) {
  const [a, b] = a1.split(":");
  return [_colToIndex(a), _colToIndex(b)];
}
function _monthName(m) {
  return ["January","February","March","April","May","June","July","August","September","October","November","December"][m-1] || "";
}

/******************************************************
 * SECTION 3 — PORTFOLIO BUILDER + CASH + FORMATTER
 ******************************************************/
const IMP = { SHEET: "Important_Info", START_ROW: 3, ROWS_PER_MONTH: 5, SPACER_ROWS: 1 };
const PORT = {
  SHEET: "Portfolio",
  START_COL: "J",             // headers begin at column J
  HEADER1_FILL: "#DCE6F1",
  HEADER2_FILL: "#C8C8C8",
  DATA_ROW_HEIGHT_PX: 36,     // EXACT 36 px everywhere on Portfolio
  DATA_COL_WIDTH_PX: 120
};

const GROUPS = [
  { header: "Year", subs: [ { title: "Year", col: "A" } ] },
  { header: "Month", subs: [ { title: "Month", col: "B" } ] },
  { header: "Cash", subs: [ { title: "Currency", col: "E" }, { title: "Amount", col: "F" } ] },
  { header: "Currency Activity", subs: [
    { title: "Description", col: "L" }, { title: "Date/Time", col: "M" },
    { title: "FX Currency", col: "N" }, { title: "Quantity", col: "O" },
    { title: "Realized P/L in USD", col: "R" }
  ]},
  { header: "Currency Conversions", subs: [
    { title: "Symbol / Pair", col: "W" }, { title: "Buys Quantity", col: "X" },
    { title: "Buys Avg. Price", col: "Y" }, { title: "Buys Proceeds", col: "Z" },
    { title: "Sells Quantity", col: "AA" }, { title: "Sells Avg. Price", col: "AB" },
    { title: "Sells Proceeds", col: "AC" }
  ]},
  { header: "Deposits & Withdrawals", subs: [
    { title: "Currency", col: "AE" }, { title: "Settle Date", col: "AF" }, { title: "Amount", col: "AH" }
  ]},
  { header: "Commissions", subs: [
    { title: "Asset Category", col: "AJ" }, { title: "Total Trades", col: "AK" },
    { title: "Total Commissions", col: "AN" }
  ]},
  { header: "Israel Tax", subs: [
    { title: "Currency", col: "AQ" }, { title: "Date", col: "AR" }, { title: "Amount", col: "AU" }
  ]},
  { header: "US Withholding Tax", subs: [
    { title: "Total", col: "AY" }
  ]},
  { header: "Realized & Unrealized Performance Summary", subs: [
    { title: "Realized Total", col: "BJ" }, { title: "Unrealized Total", col: "BO" }, { title: "Total", col: "BP" }
  ]},
  { header: "Dividends", subs: [
    { title: "Total", col: "BU" }
  ]}
];

// Entrypoint
function buildPortfolio_VBAMap(){ _buildPortfolio(true); }

function _buildPortfolio(copyColors){
  const ss  = SpreadsheetApp.getActiveSpreadsheet();
  const src = ss.getSheetByName(IMP.SHEET);
  if (!src) { SpreadsheetApp.getUi().alert("Important_Info sheet not found."); return; }

  const dst = _getOrCreateSheet(PORT.SHEET);
  try { dst.getFilter() && dst.getFilter().remove(); } catch(e) {}

  const startColIdx = _colToIndex(PORT.START_COL);

  // 1) Headers + mapping
  const map = _writePortfolioHeaders(dst, startColIdx); // { flatSubs, groupSpans, lastColWritten }

  // 2) Determine how many month bands exist in Important_Info
  const lr = src.getLastRow();
  if (lr < IMP.START_ROW) {
    _finalPortfolioSizing_NoFit(dst, startColIdx);
    SpreadsheetApp.getUi().alert("Important_Info has no data.");
    return;
  }
  
  const ym = src.getRange(IMP.START_ROW, 1, lr - IMP.START_ROW + 1, 2).getDisplayValues();
  let lastUsedIdx = -1;
  for (let i = ym.length - 1; i >= 0; i--) {
    const y = String(ym[i][0] || "").trim();
    const m = String(ym[i][1] || "").trim();
    if (y !== "" || m !== "") { lastUsedIdx = i; break; }
  }
  
  const bandsCount = (lastUsedIdx >= 0) ? (lastUsedIdx + 1) : 0;
  if (bandsCount <= 0) {
    _finalPortfolioSizing_NoFit(dst, startColIdx);
    SpreadsheetApp.getUi().alert("No populated bands in Important_Info.");
    return;
  }

  // CRITICAL FIX: Calculate total rows needed (bands × rows per band)
  const step = IMP.ROWS_PER_MONTH + IMP.SPACER_ROWS;
  const totalRowsNeeded = bandsCount * step;

  // 3) Tight source read - read ALL rows for all bands
  const srcCols = map.flatSubs.map(m => m.srcColIndex);
  const minSrcCol = Math.min.apply(null, srcCols);
  const maxSrcCol = Math.max.apply(null, srcCols);
  const widthSrc  = maxSrcCol - minSrcCol + 1;

  const srcVals = src.getRange(IMP.START_ROW, minSrcCol, totalRowsNeeded, widthSrc).getValues();
  let srcBgs  = null;
  if (copyColors) srcBgs = src.getRange(IMP.START_ROW, minSrcCol, totalRowsNeeded, widthSrc).getBackgrounds();

  // 4) Output matrices - create arrays for ALL rows
  const outCols = map.lastColWritten - startColIdx + 1;
  const outVals = Array.from({length: totalRowsNeeded}, () => Array(outCols).fill(""));
  const outBgs  = copyColors ? Array.from({length: totalRowsNeeded}, () => Array(outCols).fill("")) : null;

  // Copy all data from source to output
  for (const m of map.flatSubs) {
    const sIdx0 = m.srcColIndex - minSrcCol;
    const dIdx0 = m.dstColIndex - startColIdx;
    for (let r = 0; r < totalRowsNeeded; r++) {
      outVals[r][dIdx0] = (sIdx0 >= 0 && sIdx0 < widthSrc) ? srcVals[r][sIdx0] : "";
      if (copyColors) outBgs[r][dIdx0]  = (sIdx0 >= 0 && sIdx0 < widthSrc) ? srcBgs[r][sIdx0]  : "";
    }
  }

  // 5) Write values (+ colors) at once
  _ensureSheetSize(dst, Math.max(dst.getMaxRows(), IMP.START_ROW + totalRowsNeeded + 20),
                        Math.max(dst.getMaxColumns(), startColIdx + outCols + 5));
  const dataRange = dst.getRange(IMP.START_ROW, startColIdx, totalRowsNeeded, outCols);
  dataRange.clearContent().setBackground(null);
  dataRange.setValues(outVals);
  if (copyColors) dataRange.setBackgrounds(outBgs);

  // 6) Merge Year/Month and draw 5-row band outlines
  const yearSpan  = map.groupSpans[0];  // single column
  const monthSpan = map.groupSpans[1];  // single column
  
  for (let base = IMP.START_ROW; base < IMP.START_ROW + totalRowsNeeded; base += step) {
    const height = Math.min(IMP.ROWS_PER_MONTH, IMP.START_ROW + totalRowsNeeded - base);
    if (height <= 0) break;

    // Merge the vertical bands
    dst.getRange(base, yearSpan.startCol,  height, 1).merge().setBorder(true,true,true,true,true,true);
    dst.getRange(base, monthSpan.startCol, height, 1).merge().setBorder(true,true,true,true,true,true);

    // Group rectangles
    for (const span of map.groupSpans) {
      dst.getRange(base, span.startCol, height, span.endCol - span.startCol + 1)
         .setBorder(true,true,true,true,true,true);
    }
  }

  // 7) Sizing/alignment for headers and grid (keeps headers unwrapped only)
  _finalPortfolioSizing_NoFit(dst, startColIdx);

  // 8) Run helpers (these shouldn't affect the data block)
  writeLatestCashTwoRows_MN();
  formatTopSection_A1_H16();

  // 9) WRAP policy:
  //    a) Clip everything by default (prevents global auto-grow)
  //    b) Enable wrap ONLY for the data block EXCLUDING the merged Year/Month columns
  const totalRows = dst.getMaxRows();
  const totalCols = dst.getMaxColumns();
  dst.getRange(1, 1, totalRows, totalCols).setWrapStrategy(SpreadsheetApp.WrapStrategy.CLIP);

  const lastRow  = IMP.START_ROW + totalRowsNeeded - 1;
  const lastCol  = startColIdx + outCols - 1;

  // Wrap the data body first
  const dataBody = dst.getRange(IMP.START_ROW, startColIdx, lastRow - IMP.START_ROW + 1, lastCol - startColIdx + 1);
  dataBody.setWrapStrategy(SpreadsheetApp.WrapStrategy.WRAP)
          .setHorizontalAlignment("center")
          .setVerticalAlignment("middle");

  // Then explicitly DISABLE wrap on the two merged columns (this stops auto height growth)
  const yrCol = yearSpan.startCol;
  const moCol = monthSpan.startCol;
  dst.getRange(IMP.START_ROW, yrCol, lastRow - IMP.START_ROW + 1, 1).setWrapStrategy(SpreadsheetApp.WrapStrategy.CLIP);
  dst.getRange(IMP.START_ROW, moCol, lastRow - IMP.START_ROW + 1, 1).setWrapStrategy(SpreadsheetApp.WrapStrategy.CLIP);

  // 10) HARD-LOCK heights (final step, after all wrap/merge/border writes)
  lockRowHeights36_(dst); SpreadsheetApp.flush(); Utilities.sleep(150);
  lockRowHeights36_(dst); SpreadsheetApp.flush(); Utilities.sleep(150);
  lockRowHeights36_(dst);

  SpreadsheetApp.getUi().alert("Portfolio build complete — wrap ON (except Year/Month merges) and rows locked to 36px.");
  lockRowHeights36_(dst); SpreadsheetApp.flush(); Utilities.sleep(150);
  lockRowHeights36_(dst); SpreadsheetApp.flush(); Utilities.sleep(150);
  lockRowHeights36_(dst);
}

/**
 * Hard-lock ALL row heights on a sheet to 36px.
 * Re-applies in bulk so Google Sheets won’t “fit to data” later.
 */
function lockRowHeights36_(ws) {
  try {
    const px = PORT && PORT.DATA_ROW_HEIGHT_PX ? PORT.DATA_ROW_HEIGHT_PX : 36;
    const total = Math.max(ws.getMaxRows(), 1000); // big bulk set (fast)
    ws.setRowHeights(1, total, px);

    // Belt-and-suspenders: immediately flush and re-apply once more.
    SpreadsheetApp.flush();
    ws.setRowHeights(1, total, px);

    // Optional: also pin header rows explicitly (some themes try to resize them)
    ws.setRowHeight(1, px);
    ws.setRowHeight(2, px);
  } catch (e) {
    // Fallback: at least lock the first N rows if something odd happens
    const px = 36;
    const n = Math.min(ws.getMaxRows(), 2000);
    ws.setRowHeights(1, n, px);
  }
}




// Portfolio headers
function _writePortfolioHeaders(dst, startColIdx){
  const maxCols = 180;
  _ensureSheetSize(dst, Math.max(dst.getMaxRows(), 1000), Math.max(dst.getMaxColumns(), startColIdx + maxCols));
  dst.getRange(1, startColIdx, 2, maxCols).clearContent().setBackground(null).setBorder(false,false,false,false,false,false);

  const writeMerged = (r, cFrom, cTo, value, fill) => {
    const rng = dst.getRange(r, cFrom, 1, cTo - cFrom + 1);
    if (cTo > cFrom) rng.merge();
    rng.setValue(value).setFontWeight("bold").setHorizontalAlignment("center").setVerticalAlignment("middle").setWrap(false)
       .setBackground(fill).setBorder(true,true,true,true,false,false);
  };
  const writeRow = (r, cFrom, values, fill) => {
    const rng = dst.getRange(r, cFrom, 1, values.length);
    rng.setValues([values]).setFontWeight("bold").setHorizontalAlignment("center").setVerticalAlignment("middle").setWrap(false)
       .setBackground(fill).setBorder(true,true,true,true,true,true);
  };

  let curCol = startColIdx;
  const flatSubs = [];
  const groupSpans = [];

  for (let gi = 0; gi < GROUPS.length; gi++) {
    const g = GROUPS[gi];
    if (g.subs.length === 1) {
      writeMerged(1, curCol, curCol, g.header, PORT.HEADER1_FILL);
      dst.getRange(1, curCol, 2, 1).merge().setBackground(PORT.HEADER1_FILL).setBorder(true,true,true,true,true,true);
      flatSubs.push({ srcColIndex: _colToIndex(g.subs[0].col), dstColIndex: curCol, groupIndex: gi });
      groupSpans.push({ startCol: curCol, endCol: curCol });
      curCol++;
    } else {
      const gStart = curCol;
      writeMerged(1, gStart, gStart + g.subs.length - 1, g.header, PORT.HEADER1_FILL);
      writeRow(2, gStart, g.subs.map(s => s.title), PORT.HEADER2_FILL);
      g.subs.forEach((s, i) => flatSubs.push({ srcColIndex: _colToIndex(s.col), dstColIndex: gStart + i, groupIndex: gi }));
      groupSpans.push({ startCol: gStart, endCol: gStart + g.subs.length - 1 });
      curCol = gStart + g.subs.length;
    }
    const nextHeader = GROUPS[gi + 1] && GROUPS[gi + 1].header;
    if (gi < GROUPS.length - 1 && !(g.header === "Year" && nextHeader === "Month")) {
      curCol++; // spacer col
    }
  }
  return { flatSubs, groupSpans, lastColWritten: curCol - 1 };
}

// Portfolio final sizing
function _finalPortfolioSizing_NoFit(dst, startColIdx){
  const maxRows = Math.max(dst.getMaxRows(), 1000);
  _ensureSheetSize(dst, maxRows, dst.getMaxColumns());
  dst.setRowHeights(1, maxRows, PORT.DATA_ROW_HEIGHT_PX);

  dst.setColumnWidths(1, dst.getMaxColumns(), PORT.DATA_COL_WIDTH_PX);

  const lastCol = dst.getLastColumn();
  if (lastCol >= startColIdx) {
    dst.getRange(1, startColIdx, 2, lastCol - startColIdx + 1).setWrap(false); // headers unwrapped
  }

  const lastRow = Math.max(dst.getLastRow(), 3);
  if (lastRow >= 3 && lastCol >= startColIdx) {
    dst.getRange(3, startColIdx, lastRow - 2, lastCol - startColIdx + 1)
       .setHorizontalAlignment("center")
       .setVerticalAlignment("middle")
       .setFontSize(10);
  }
  dst.setFrozenRows(2);
}

/**
 * Latest Cash (Portfolio M:N) → Portfolio!A17:B20 (headers + first 2 rows), with colors.
 * Keeps A1:I16 intact.
 */
function writeLatestCashTwoRows_MN() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const port = ss.getSheetByName("Portfolio");
  if (!port) { SpreadsheetApp.getUi().alert("Portfolio sheet not found."); return; }

  const START_ROW = 3;
  const BAND_ROWS = 5;
  const SPACER = 1;
  const STRIDE = BAND_ROWS + SPACER;
  const COL_M = 13;
  const COL_N = 14;

  // Copy headers M1:N2 → A17:B18 (values+backgrounds)
  const hdrVals = port.getRange(1, COL_M, 2, 2).getValues();
  const hdrBgs  = port.getRange(1, COL_M, 2, 2).getBackgrounds();

  const topDst = port.getRange(17, 1, 1, 2); // A17:B17
  topDst.clearContent().setBackground(null).merge();
  topDst
    .setValue(hdrVals[0][0] || "Cash")
    .setFontWeight("bold")
    .setHorizontalAlignment("center").setVerticalAlignment("middle")
    .setWrap(true)
    .setBackground(hdrBgs[0][0] || "#DCE6F1")
    .setBorder(true,true,true,true,false,false);

  const subDst = port.getRange(18, 1, 1, 2); // A18:B18
  subDst.clearContent().setBackground(null);
  subDst
    .setValues([[ hdrVals[1][0] || "Currency", hdrVals[1][1] || "Amount" ]])
    .setBackgrounds([[ hdrBgs[1][0] || "#C8C8C8", hdrBgs[1][1] || "#C8C8C8" ]])
    .setFontWeight("bold")
    .setHorizontalAlignment("center").setVerticalAlignment("middle")
    .setWrap(true)
    .setBorder(true,true,true,true,true,true);

  port.setRowHeights(17, 4, 36);

  // Find last band with any cash in M:N
  const lastRow = port.getLastRow();
  if (lastRow < START_ROW) { _writeCashRowsToA19([["",""],["",""]], [["",""],["",""]]); return; }

  const height = lastRow - START_ROW + 1;
  const cashVals = port.getRange(START_ROW, COL_M, height, 2).getDisplayValues();
  const cashBgs  = port.getRange(START_ROW, COL_M, height, 2).getBackgrounds();

  let bandTop = -1;
  for (let i = cashVals.length - 1; i >= 0; i--) {
    const hasCash = (String(cashVals[i][0] || "").trim() !== "") || (String(cashVals[i][1] || "").trim() !== "");
    if (hasCash) { bandTop = START_ROW + Math.floor(i / STRIDE) * STRIDE; break; }
  }
  if (bandTop < 0) { _writeCashRowsToA19([["",""],["",""]], [["",""],["",""]]); return; }

  // Take first 2 non-empty rows from that 5-row band
  const outVals = [];
  const outBgs  = [];
  for (let r = 0; r < BAND_ROWS; r++) {
    const i = (bandTop - START_ROW) + r;
    if (i < 0 || i >= cashVals.length) continue;
    const cur = String(cashVals[i][0] || "").trim();
    const amt = String(cashVals[i][1] || "").trim();
    if (cur !== "" || amt !== "") {
      outVals.push([cur, amt]);
      outBgs.push([cashBgs[i][0] || "", cashBgs[i][1] || ""]);
      if (outVals.length === 2) break;
    }
  }
  while (outVals.length < 2) { outVals.push(["",""]); outBgs.push(["",""]); }

  _writeCashRowsToA19(outVals, outBgs);

  function _writeCashRowsToA19(twoRowsVals, twoRowsBgs) {
    const dst = port.getRange(19, 1, 2, 2); // A19:B20
    dst.clearContent();
    dst.setValues(twoRowsVals);
    dst.setBackgrounds(twoRowsBgs);
    dst.setWrap(true).setHorizontalAlignment("center").setVerticalAlignment("middle")
       .setBorder(true,true,true,true,true,true);
    port.setRowHeights(19, 2, 36);
  }
}

// Back-compat alias
function writeLastMonthCashTwoRowsToHome() { return writeLatestCashTwoRows_MN(); }

/**
 * Portfolio top section helper: if a row within A1:H16 has A filled,
 * outline & center that entire row A–H. Does not touch other rows.
 */
function formatTopSection_A1_H16() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const port = ss.getSheetByName("Portfolio");
  if (!port) { SpreadsheetApp.getUi().alert("Portfolio sheet not found."); return; }

  const vals = port.getRange("A1:H16").getDisplayValues();
  for (let r = 0; r < vals.length; r++) {
    const firstCell = String(vals[r][0] || "").trim();
    if (firstCell !== "") {
      const targetRange = port.getRange(r + 1, 1, 1, 8); // A–H
      targetRange
        .setBorder(true, true, true, true, true, true)
        .setHorizontalAlignment("center")
        .setVerticalAlignment("middle");
    }
  }
}
