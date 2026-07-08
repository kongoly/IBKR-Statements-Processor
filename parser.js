// ============================================================
// parser.js — IBKR CSV Parser
// ============================================================
// Parses a raw IBKR "readable CSV" into structured sections.
// Each row is tagged as isSubheader or isData so the colorizer
// never accidentally colors header rows.
//
// Output structure:
// {
//   year, month, monthName,
//   sections: [
//     {
//       name: "Cash Report",
//       subheaders: ["Currency", "Total", ...],
//       rows: [
//         { values: [...], color: null, isSubheader: false }
//       ]
//     }
//   ]
// }
// ============================================================

const fs   = require('fs');
const path = require('path');
const { applyColorRules } = require('./colorizer');

const MONTH_NAMES = [
  "January","February","March","April","May","June",
  "July","August","September","October","November","December"
];

const SKIP_SECTIONS = new Set(["Statement"]);

// ============================================================
// parseCSVFile(filePath)
// Main entry point — reads file, parses, colorizes, returns.
// ============================================================
function parseCSVFile(filePath) {
  const raw   = fs.readFileSync(filePath, 'utf8');
  const lines = raw.split('\n').map(parseCSVLine);

  const { year, month, monthName } = extractYearMonth(lines);
  const sections = extractSections(lines);

  // Apply color rules ONLY to data rows (never subheaders)
  for (const section of sections) {
    const dataRows = section.rows.filter(r => !r.isSubheader);
    for (const row of dataRows) {
      row.color = applyColorRules(
        section.name,
        section.subheaders,
        row.values,
        dataRows
      );
    }
  }

  return { year, month, monthName, sections };
}

// ============================================================
// extractYearMonth(lines)
// Finds the Statement period line and extracts year + month.
// e.g. "January 1, 2024 - January 31, 2024" → { year:2024, month:1 }
// ============================================================
function extractYearMonth(lines) {
  for (const line of lines) {
    if (line[0] === 'Statement' && line[1] === 'Data' && line[2] === 'Period') {
      const text  = (line[3] || '').trim();
      const first = text.split('-')[0].trim();
      const parts = first.split(',');
      if (parts.length >= 2) {
        const monthTok = parts[0].trim().split(/\s+/)[0];
        const yearStr  = parts[1].trim();
        const mi = MONTH_NAMES.findIndex(
          m => m.toLowerCase() === monthTok.toLowerCase()
        );
        if (mi >= 0) {
          return { year: parseInt(yearStr, 10), month: mi + 1, monthName: MONTH_NAMES[mi] };
        }
      }
    }
  }
  throw new Error('Could not find year/month in CSV. Make sure this is an IBKR readable CSV.');
}

// ============================================================
// extractSections(lines)
// Groups CSV lines into sections with subheader + data rows.
// Tags every row as isSubheader=true or isSubheader=false.
// ============================================================
function extractSections(lines) {
  const sections = [];

  for (let i = 0; i < lines.length; i++) {
    const line    = lines[i];
    const section = (line[0] || '').trim();
    const kind    = (line[1] || '').trim().toLowerCase();

    if (!section || SKIP_SECTIONS.has(section) || kind !== 'header') continue;

    // The header line itself contains the subheader column names
    const subheaders = trimRight(line.slice(2));

    // Tag the subheader row as isSubheader = true
    const rows = [{
      values:      subheaders,
      color:       null,
      isSubheader: true   // ← this prevents it from being colorized
    }];

    // Collect data rows
    let j = i + 1;
    while (j < lines.length) {
      const rr    = lines[j];
      const sec2  = (rr[0] || '').trim();
      const kind2 = (rr[1] || '').trim().toLowerCase();

      if (sec2 !== section) break;
      if (kind2 === 'header') break;

      if (kind2 === 'data' || kind2 === 'total') {
        const rowValues = trimRight(rr.slice(2));
        // If it's a 'total' row and the first column is empty, 
        // fill it with 'Total' (the discriminator value)
        if (kind2 === 'total' && (!rowValues[0] || rowValues[0].trim() === '')) {
          rowValues[0] = 'Total';
        }
        rows.push({
          values:      rowValues,
          color:       null,
          isSubheader: false  // ← real data row, can be colorized
        });
      }
      j++;
    }

    sections.push({ name: section, subheaders, rows });
    i = j - 1;
  }

  return sections;
}

// ============================================================
// parseCSVLine(line)
// Splits one CSV line into an array, handles quoted fields.
// e.g. 'Cash Report,Data,"1,234.56"' → ["Cash Report","Data","1,234.56"]
// ============================================================
function parseCSVLine(line) {
  const result = [];
  let current  = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') { current += '"'; i++; }
      else inQuotes = !inQuotes;
    } else if (ch === ',' && !inQuotes) {
      result.push(current.trim());
      current = '';
    } else {
      current += ch;
    }
  }
  result.push(current.trim());
  return result;
}

// ============================================================
// trimRight(arr)
// Removes trailing empty values from an array.
// ============================================================
function trimRight(arr) {
  let k = arr.length - 1;
  while (k >= 0 && (arr[k] === '' || arr[k] == null)) k--;
  return arr.slice(0, k + 1);
}

module.exports = { parseCSVFile };