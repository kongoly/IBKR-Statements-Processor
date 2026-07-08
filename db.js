// ============================================================
// db.js — Database setup for the IBKR Statement Processor
// ============================================================
// This file creates and manages the local SQLite database.
// The database is stored as a single file: data/ibkr.db
// Think of it as a smart Excel workbook that lives on your PC.
//
// It holds 3 tables:
//   1. months   — one row per imported monthly statement (e.g. January 2024)
//   2. sections — one row per section inside that month (e.g. "Cash Report", "Forex P/L Details")
//   3. rows     — the actual data rows inside each section, with color info
//
// This structure mirrors exactly how your Apps Script processed the CSV:
//   CSV → sections (Title → Subheader → Data rows) → color rules applied
// ============================================================

const Database = require('better-sqlite3');
const path = require('path');

// Open (or create) the database file at: ibkr-app/data/ibkr.db
const db = new Database(path.join(__dirname, 'data', 'ibkr.db'));

// ============================================================
// TABLE: months
// One row per monthly IBKR statement you've imported.
// Example row: { year: 2024, month: 1, month_name: "January" }
// The UNIQUE constraint prevents importing the same month twice.
// ============================================================
db.exec(`
  CREATE TABLE IF NOT EXISTS months (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    year         INTEGER NOT NULL,
    month        INTEGER NOT NULL,
    month_name   TEXT    NOT NULL,
    imported_at  TEXT    DEFAULT (datetime('now')),
    UNIQUE(year, month)
  );

  -- ============================================================
  -- TABLE: sections
  -- One row per section found inside a monthly statement.
  -- Sections come from the CSV "Section" column, e.g.:
  --   "Cash Report", "Forex P/L Details", "Deposits & Withdrawals"
  -- Each section belongs to one month (via month_id).
  -- ============================================================
  CREATE TABLE IF NOT EXISTS sections (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    month_id     INTEGER NOT NULL,
    section_name TEXT    NOT NULL,
    subheaders   TEXT,
    FOREIGN KEY(month_id) REFERENCES months(id)
  );

  -- ============================================================
  -- TABLE: rows
  -- The actual data rows inside each section.
  -- "data" is stored as JSON — it holds the full row as an array,
  --   e.g. ["USD", "2024-01-15", "Ending Cash", "12500.00"]
  -- "color" is the highlight color applied by your color rules,
  --   e.g. "#C6EFCE" for Ending Cash USD (green)
  -- This matches exactly the color palette from your Apps Script.
  -- ============================================================
  CREATE TABLE IF NOT EXISTS rows (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    section_id   INTEGER NOT NULL,
    row_index    INTEGER NOT NULL,
    data         TEXT    NOT NULL,
    color        TEXT,
    FOREIGN KEY(section_id) REFERENCES sections(id)
  );
`);

// Export the database so other files (server.js, parser.js, etc.) can use it
module.exports = db;