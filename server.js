 // ============================================================
// server.js — Main Server for the IBKR Statement Processor
// ============================================================
const express = require('express');
const multer  = require('multer');
const path    = require('path');
const fs      = require('fs');

const db                = require('./db');
const { parseCSVFile }  = require('./parser');

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

app.get('/api/months', (req, res) => {
  const months = db.prepare(`SELECT id, year, month, month_name FROM months ORDER BY year DESC, month DESC`).all();
  res.json(months);
});

app.get('/api/month/:year/:month', (req, res) => {
  const { year, month } = req.params;
  const monthRow = db.prepare(`SELECT id FROM months WHERE year = ? AND month = ?`).get(year, month);
  if (!monthRow) return res.status(404).json({ error: 'Month not found' });
  const sections = db.prepare(`SELECT id, section_name FROM sections WHERE month_id = ?`).all(monthRow.id);
  for (const section of sections) {
    section.rows = db.prepare(`SELECT row_index, data, color FROM rows WHERE section_id = ? ORDER BY row_index ASC`).all(section.id).map(r => ({ ...r, data: JSON.parse(r.data) }));
  }
  res.json({ year, month, sections });
});

app.get('/api/year/:year', (req, res) => {
  const { year } = req.params;
  const months = db.prepare(`SELECT id, month, month_name FROM months WHERE year = ? ORDER BY month DESC`).all(year);
  for (const m of months) {
    const sections = db.prepare(`SELECT id, section_name FROM sections WHERE month_id = ?`).all(m.id);
    for (const section of sections) {
      section.rows = db.prepare(`SELECT row_index, data, color FROM rows WHERE section_id = ? ORDER BY row_index ASC`).all(section.id).map(r => ({ ...r, data: JSON.parse(r.data) }));
    }
    m.sections = sections;
  }
  res.json({ year, months });
});

app.delete('/api/month/:year/:month', (req, res) => {
  const { year, month } = req.params;
  const monthRow = db.prepare(`SELECT id FROM months WHERE year = ? AND month = ?`).get(year, month);
  if (!monthRow) return res.status(404).json({ error: 'Month not found' });
  
  const sectionIds = db.prepare(`SELECT id FROM sections WHERE month_id = ?`).all(monthRow.id).map(s => s.id);
  const deleteTx = db.transaction(() => {
    for (const sid of sectionIds) {
      db.prepare('DELETE FROM rows WHERE section_id = ?').run(sid);
    }
    db.prepare('DELETE FROM sections WHERE month_id = ?').run(monthRow.id);
    db.prepare('DELETE FROM months WHERE id = ?').run(monthRow.id);
  });
  deleteTx();
  res.json({ success: true });
});

function saveMonthToDB(parsed) {
  const save = db.transaction(() => {
    const existing = db.prepare(`SELECT id FROM months WHERE year = ? AND month = ?`).get(parsed.year, parsed.month);
    if (existing) {
      const sectionIds = db.prepare(`SELECT id FROM sections WHERE month_id = ?`).all(existing.id).map(s => s.id);
      for (const sid of sectionIds) db.prepare('DELETE FROM rows WHERE section_id = ?').run(sid);
      db.prepare('DELETE FROM sections WHERE month_id = ?').run(existing.id);
      db.prepare('DELETE FROM months WHERE id = ?').run(existing.id);
    }
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

app.get('/api/stats', (req, res) => {
  const totals = db.prepare(`
    SELECT 
      (SELECT SUM(CAST(REPLACE(REPLACE(json_extract(data, '$[4]'), '$', ''), ',', '') AS REAL)) FROM rows WHERE color = '#FFE699') as totalComm,
      (SELECT SUM(CAST(REPLACE(REPLACE(json_extract(data, '$[2]'), '$', ''), ',', '') AS REAL)) FROM rows WHERE color = '#F8BE78') as totalDiv
    FROM rows LIMIT 1
  `).get();
  const latestMonth = db.prepare(`SELECT id, year, month FROM months ORDER BY year DESC, month DESC LIMIT 1`).get();
  let latest = { usd: 0, ils: 0, unrealized: 0, nav: 0, cashBase: 0, invested: 0 };
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
        const mvIdx = subheaders.findIndex(h => h && h.toLowerCase().includes('market value'));
        if (mvIdx >= 0) {
          const totalRow = rows.find(r => String(JSON.parse(r.data)[0]).toLowerCase() === 'total');
          if (totalRow) {
            latest.invested = parseFloat(String(JSON.parse(totalRow.data)[mvIdx]).replace(/[^0-9.-]/g, '')) || 0;
          }
        }
      }
      if (name.includes('net asset value')) {
        let totalVal = 0;
        let cashVal = 0;
        let navInvested = 0;
        for (const row of rows) {
          const data = JSON.parse(row.data);
          const label = String(data[0] || '').toLowerCase();
          const amount = parseFloat(String(data[data.length-1]).replace(/[^0-9.-]/g, '')) || 0;
          if (label === 'total') totalVal = amount;
          else if (label === 'cash' || label.includes('money market')) cashVal += amount;
          else if (label && label !== 'total' && label !== 'net asset value') {
            navInvested += amount;
          }
        }
        latest.nav = totalVal;
        if (latest.invested === 0) latest.invested = navInvested > 0 ? navInvested : Math.max(0, totalVal - cashVal);
      }
      if (name.includes('realized & unrealized')) {
        const totalRow = rows.find(r => (r.color || '').toUpperCase() === '#BEFAC8');
        if (totalRow) latest.unrealized = parseFloat(JSON.parse(totalRow.data)[12].replace(/[^0-9.-]/g, '')) || 0;
      }
    }
  }
  res.json({ 
    totalCommissions: totals.totalComm || 0, 
    totalDividends: totals.totalDiv || 0, 
    latestCashUSD: latest.usd, 
    latestCashILS: latest.ils, 
    latestUnrealizedPL: latest.unrealized,
    latestInvestedUSD: latest.invested
  });
});

// Helper for Important Info
function getImportantInfoForMonth(monthId, year, month, monthName, view = 'important') {
  const cats = { FOREX_BAL:[], CURR_ACT:[], CONV:[], DNW:[], COMM:[], ISR:[], USWHT:[], RU:[], DIV:[] };
  const colorMap = { '#C6DBFF':'FOREX_BAL', '#C6EFCE':'FOREX_BAL', '#F7E6D5':'CURR_ACT', '#D1EFCF':'CURR_ACT', '#ACDCF2':'CURR_ACT', '#F29D94':'CONV', '#E1C8E6':'DNW', '#FFE699':'COMM', '#FFDCE1':'ISR', '#FFC7CE':'USWHT', '#BEFAC8':'RU', '#F8BE78':'DIV' };
  const sections = db.prepare(`SELECT id, section_name FROM sections WHERE month_id = ?`).all(monthId);
  for (const s of sections) {
    const rows = db.prepare(`SELECT data, color, row_index FROM rows WHERE section_id = ? ORDER BY row_index ASC`).all(s.id);
    const name = s.section_name.toLowerCase();
    for (const row of rows) {
      if (row.row_index === 0) continue; 
      const values = JSON.parse(row.data);
      const color = (row.color || '').toUpperCase();
      const cat = colorMap[color];
      if (name.includes('realized & unrealized')) {
        if (color === '#BEFAC8') cats.RU.push({ values, color: row.color });
        else if (view !== 'portfolio' && color) cats.RU.push({ values, color: row.color });
      } else if (cat && cats[cat].length < 5) cats[cat].push({ values, color: row.color });
    }
  }
  return { year, month, monthName, cats };
}

app.get('/api/important-info/total', (req, res) => {
  const { view } = req.query;
  const result = db.prepare(`SELECT id, year, month, month_name FROM months ORDER BY year DESC, month DESC`).all().map(m => getImportantInfoForMonth(m.id, m.year, m.month, m.month_name, view));
  res.json({ months: result });
});

app.get('/api/important-info/:year', (req, res) => {
  const { year } = req.params;
  const { month, view } = req.query;
  const months = month ? db.prepare(`SELECT id, year, month, month_name FROM months WHERE year = ? AND month = ?`).all(year, month) : db.prepare(`SELECT id, year, month, month_name FROM months WHERE year = ? ORDER BY month DESC`).all(year);
  const result = months.map(m => getImportantInfoForMonth(m.id, m.year, m.month, m.month_name, view));
  res.json({ year: parseInt(year), months: result });
});

app.get('/api/full-data/:scope', (req, res) => {
  const { scope } = req.params;
  const { year, month } = req.query;
  let monthList;
  if (scope === 'total') monthList = db.prepare(`SELECT id, year, month, month_name FROM months ORDER BY year DESC, month DESC`).all();
  else if (scope === 'year') monthList = db.prepare(`SELECT id, year, month, month_name FROM months WHERE year = ? ORDER BY month DESC`).all(year);
  else monthList = db.prepare(`SELECT id, year, month, month_name FROM months WHERE year = ? AND month = ?`).all(year, month);
  const result = monthList.map(m => {
    const sections = db.prepare(`SELECT id, section_name FROM sections WHERE month_id = ?`).all(m.id);
    for (const section of sections) section.rows = db.prepare(`SELECT row_index, data, color FROM rows WHERE section_id = ? ORDER BY row_index ASC`).all(section.id).map(r => ({ ...r, data: JSON.parse(r.data) }));
    return { year: m.year, month: m.month, monthName: m.month_name, sections };
  });
  res.json({ months: result });
});

app.get('/api/financial-summary/:scope', (req, res) => {
  const { scope } = req.params;
  const { year, month } = req.query;
  const allMonths = db.prepare(`SELECT id, year, month, month_name FROM months ORDER BY year ASC, month ASC`).all();
  const results = allMonths.map(m => {
    const entry = { year: m.year, month: m.month, monthName: m.month_name, endingCashUSD:0, endingCashILS:0, endingCashBase:0, netAssetValueUSD:0, investedUSD:0, unrealizedPL:0, realizedPL:0, israelTaxILS:0, israelTaxUSD:0, commissions:0, dividends:0, withholdingTaxUSD:0, depositsUSD:0, withdrawalsUSD:0, depositsILS:0, withdrawalsILS:0, conversionsUSD:0, forex:[], monthlyProfits:0, monthlyLosses:0, monthlyTotalPL:0 };
    const sections = db.prepare(`SELECT id, section_name, subheaders FROM sections WHERE month_id = ?`).all(m.id);
    const forexPLRows = [];
    for (const section of sections) {
      const name = section.section_name.toLowerCase();
      const allRows = db.prepare(`SELECT data, color FROM rows WHERE section_id = ? ORDER BY row_index ASC`).all(section.id).map(r => ({ values: JSON.parse(r.data), color: (r.color || '').toUpperCase() }));
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
      if (name.includes('net asset value')) {
        let totalVal = 0;
        let cashVal = 0;
        let navInvested = 0;
        for (const row of dataRows) {
          const label = String(row.values[0] || '').toLowerCase();
          const amount = parseFloat(String(row.values[row.values.length-1]).replace(/[^0-9.-]/g, '')) || 0;
          if (label === 'total') totalVal = amount;
          else if (label === 'cash' || label.includes('money market')) cashVal += amount;
          else if (label && label !== 'total' && label !== 'net asset value') {
            navInvested += amount;
          }
        }
        if (entry.investedUSD === 0) {
          entry.investedUSD = navInvested > 0 ? navInvested : Math.max(0, totalVal - cashVal);
        }
        entry.netAssetValueUSD = totalVal;
      }
      if (name.includes('realized & unrealized')) {
        for (const row of dataRows) if (row.color === '#BEFAC8') {
          entry.unrealizedPL = parseFloat(String(row.values[12]).replace(/[^0-9.-]/g, '')) || 0;
          const p = parseFloat(String(row.values[7]).replace(/[^0-9.-]/g, '')) || 0;
          if (p > 0) entry.monthlyProfits += p; else entry.monthlyLosses += Math.abs(p);
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
        const filteredForex = dataRows.filter(r => r.color && (String(r.values[0]).toLowerCase() === 'forex' || String(r.values[2]).includes('.')));
        const convs = [];
        filteredForex.forEach(r => {
          const bQty = parseFloat(String(r.values[3]).replace(/[^0-9.-]/g, '')) || 0;
          const bPrice = parseFloat(String(r.values[4]).replace(/[^0-9.-]/g, '')) || 0;
          const bProc = parseFloat(String(r.values[5]).replace(/[^0-9.-]/g, '')) || 0;
          const sQty = parseFloat(String(r.values[6]).replace(/[^0-9.-]/g, '')) || 0;
          const sPrice = parseFloat(String(r.values[7]).replace(/[^0-9.-]/g, '')) || 0;
          const sProc = parseFloat(String(r.values[8]).replace(/[^0-9.-]/g, '')) || 0;
          
          if (Math.abs(bProc) > 5 || Math.abs(sProc) > 5) {
            entry.conversionsUSD += (bProc + sProc);
            const symbol = String(r.values[2]); // e.g. "USD.ILS"
            const cur1 = symbol.split('.')[0];
            const cur2 = symbol.split('.')[1];
            
            if (bQty !== 0) {
              // I bought cur1 using cur2 (e.g. bought USD using ILS)
              // Logic: Amount CUR2 @ Price -> Amount CUR1
              // Example: 3650 ILS @ 3.65 -> 1000 USD (if Price is 3.65)
              // BUT IBKR price is usually Ratio of CUR1/CUR2.
              // Let's use simpler: [Qty] [CUR1] @ [Price]
              convs.push(`${Math.abs(bQty).toLocaleString()} ${cur1} @ ${bPrice.toFixed(4)}`);
            } else if (sQty !== 0) {
              // I sold cur1 for cur2
              convs.push(`${Math.abs(sQty).toLocaleString()} ${cur1} @ ${sPrice.toFixed(4)}`);
            }
            entry.forex.push({ symbol: r.values[2], currency: r.values[1], buyQty: bQty, buyPrice: bPrice, buyProceeds: bProc, sellQty: sQty, sellPrice: sPrice, sellProceeds: sProc });
          }
        });
        // Refined format based on user feedback: "ILS amount @ Ratio USD amount"
        // Let's detect the currencies and format specifically
        const refinedConvs = [];
        filteredForex.forEach(r => {
          const bQty = parseFloat(String(r.values[3]).replace(/[^0-9.-]/g, '')) || 0;
          const bPrice = parseFloat(String(r.values[4]).replace(/[^0-9.-]/g, '')) || 0;
          const bProc = parseFloat(String(r.values[5]).replace(/[^0-9.-]/g, '')) || 0;
          const sQty = parseFloat(String(r.values[6]).replace(/[^0-9.-]/g, '')) || 0;
          const sPrice = parseFloat(String(r.values[7]).replace(/[^0-9.-]/g, '')) || 0;
          const sProc = parseFloat(String(r.values[8]).replace(/[^0-9.-]/g, '')) || 0;
          
          if (Math.abs(bProc) > 5 || Math.abs(sProc) > 5) {
            const symbol = String(r.values[2]); // USD.ILS or ILS.USD
            const base = symbol.split('.')[0];
            const quote = symbol.split('.')[1];
            
            if (bQty !== 0) {
              // Buying 'base' (e.g. USD) using 'quote' (e.g. ILS)
              // Qty is in 'base'. Proceeds is in 'quote' (negative)
              const ratio = bPrice;
              refinedConvs.push(`${Math.abs(bProc).toLocaleString()} ${quote} @ ${ratio.toFixed(4)} -> ${Math.abs(bQty).toLocaleString()} ${base}`);
            } else if (sQty !== 0) {
              // Selling 'base' (e.g. USD) for 'quote' (e.g. ILS)
              // Qty is in 'base' (negative). Proceeds is in 'quote'
              const ratio = sPrice;
              refinedConvs.push(`${Math.abs(sQty).toLocaleString()} ${base} @ ${ratio.toFixed(4)} -> ${Math.abs(sProc).toLocaleString()} ${quote}`);
            }
          }
        });
        entry.conversionsText = refinedConvs.join('<br>');
      }
      if (name === 'deposits & withdrawals') dataRows.filter(r => r.color).forEach(r => {
        const amt = parseFloat(String(r.values[3]).replace(/[^0-9.-]/g, '')) || 0;
        const curr = String(r.values[0]).toUpperCase();
        if (curr === 'ILS') { if (amt > 0) entry.depositsILS += amt; else entry.withdrawalsILS += Math.abs(amt); }
        else { if (amt > 0) entry.depositsUSD += amt; else entry.withdrawalsUSD += Math.abs(amt); }
      });
    }
    entry.monthlyLosses += Math.abs(entry.israelTaxUSD);
    entry.realizedPL = entry.monthlyProfits - entry.monthlyLosses;
    entry.monthlyTotalPL = entry.realizedPL;
    // Removed the overwriting line here
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
    totalConversionsUSD: filtered.reduce((s, m) => s + m.conversionsUSD, 0),
    totalMonthlyPL: filtered.reduce((s, m) => s + m.monthlyTotalPL, 0) 
  };
  res.json({ months: sorted, summary });
});

app.listen(PORT, '0.0.0.0', () => { console.log(`✅ IBKR App is running on port ${PORT}`); });
