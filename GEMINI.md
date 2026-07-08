# IBKR Statement Processor — Project Master Context

# install gemini-cli:
run in cmd - npm install -g @google/gemini-cli
type(to start the chat) - gemini
do the authantication or /auth (if not offered)

This document is the **single source of truth** for the IBKR Statement Processor project. It is designed to provide full context for the user (Oz), human developers, and agentic AIs (Gemini, Claude, etc.). 

**AI INSTRUCTION:** Read this entire document before proposing or executing any changes. Adhere strictly to the "Development Mandates" section.

---

## 1. Project Identity & Purpose
A local Node.js web application that imports Interactive Brokers (IBKR) monthly CSV statements ("readable CSV"), parses them, applies color-coded highlights based on specific financial rules, and stores the data in a local SQLite database.

**The Goal:** Provide a robust, local alternative to a legacy Google Sheets system, enabling faster processing, cross-month queries, and an aesthetic financial dashboard for portfolio and cash flow tracking.

---

## 2. User Context & Working Style
- **User:** Oz (Israel-based).
- **Technical Level:** Comfortable with JS/Python basics; prefers clear, step-by-step guidance.
- **Vibe Coding Preferences:**
    - Use clear, non-technical explanations in comments.
    - Reference original Apps Script logic where helpful.
    - No "just-in-case" or redundant code; keep implementation surgical.
    - When things break, analyze the exact error message first.
    - Provide terminal commands as single, copy-pasteable blocks.

---

## 3. Historical Context: Legacy Apps Script
The project replicates and enhances the logic of a functional Apps Script system:
- **Input:** Monthly "readable CSV" exports from IBKR.
- **Structure:** Title row → Subheader row → Data rows.
- **Summarization:** The app creates "Important Info" (category-grouped summaries) and "Portfolio" (multi-column monthly mapping) views.
- **New Feature:** Added a manual "Current Portfolio" section and a unified "Financial Summary" with a consolidated Table layout for high-level tracking.

---

## 4. Technical Architecture
- **Runtime:** Node.js v22
- **Server:** Express (Port 3000)
- **Database:** SQLite via `better-sqlite3`.
- **Parsing:** Custom logic in `parser.js` (extracts Year/Month from the "Period" field; includes `Total` rows for summaries).
- **Business Logic:** `colorizer.js` applies rules based on section names and cell content.
- **Frontend:** Single Page Application (SPA) in `public/` (Vanilla JS, HTML5, CSS3).
- **Persistence:** Manual portfolio data is saved in the browser's `localStorage`.

### Key Files
- `server.js`: API routes, database transactions, and financial metric calculations (Invested Cash, USD Tax matching).
- `db.js`: Database schema and table initialization.
- `public/app.js`: Frontend UI logic, unified summary table rendering, and Historical Portfolio Mapping.
- `public/style.css`: Spreadsheet-like styling with sticky headers/columns.

---

## 5. Development Mandates (CRITICAL)
1. **Synchronous Database:** `better-sqlite3` is used **synchronously**. Do NOT use `async`/`await` for DB calls.
2. **Subheader Protection:** Every row has an `isSubheader` flag. Row index 0 in any section is ALWAYS a subheader and must **never** be colorized.
3. **Condition-Based Summary:** Views like Portfolio and Important Info must match data by **logical condition**, NOT by searching for hex colors.
4. **Cash Neutrality Rule:** In the manual portfolio, the "CASH" row counts towards **Current Value** and **Portfolio %**, but MUST be excluded from **Cost Basis** and **Profit/Loss** totals.
5. **Timeline Scoping:** Views must support three scopes: **Month**, **Year**, and **All Time Data**.
6. **Financial Summary Sorting:** The Financial Summary view MUST always display years and months in **descending order** (newest first).
7. **Invested Cash Calculation:** Prioritize the "Open Positions" section. Match the row where `DataDiscriminator` is "Total" and extract from the "Value" (or "Market Value") column. Fallback to `Net Asset Value - Total Cash`.
8. **Currency Conversions:** Display in detailed format: `Amount CUR1 @ Ratio -> Amount CUR2` (e.g., `1,000 ILS @ 0.27 -> 270 USD`).
9. **Israel Tax USD Matching:** Match ILS tax amounts in `Forex P/L Details` to find the correct USD equivalent.
10. **CSS & UI Standards:** 
    - **Unified Table**: The Financial Summary is a single table with a **TOTAL** header row and a **Monthly Breakdown** body.
    - **Color Coding**: Deposits are **Green** (#2f855a), Withdrawals are **Red** (#c53030) for non-zero amounts.
    - **Sticky Headers**: Vertical and horizontal stickiness must be robust.
    - **Layout**: Main content area is centered with balanced margins.

---

## 6. Operational Guide
```bash
# Install dependencies (once)
npm install

# Start the server
node server.js
```
- **Access:** `http://localhost:3000` (Local) or `http://[PC-IP]:3000` (Mobile/Network).
- **Re-importing:** Dragging a CSV for an existing month overwrites that month's data.

---

## 7. API Reference
| Route | Method | Description |
|---|---|---|
| `/api/upload` | POST | Upload + parse + save CSV(s) |
| `/api/months` | GET | List all imported months for sidebar |
| `/api/month/:y/:m` | GET | Detailed data for one month |
| `/api/full-data/:scope`| GET | Complete section data for a timeframe |
| `/api/stats` | GET | Global totals (Comm, Div) + Latest Cash + Latest Invested |
| `/api/financial-summary/:scope` | GET | Metrics (Cash, Invested, P/L, Tax, Conversions) |
| `/api/important-info/:y` | GET | Categorized summary rows for a year |
| `/api/month/:y/:m` | DELETE | Remove month and all its dependencies (sections/rows) |

---

## 8. Current Status & Roadmap
- **Phase 1-2 (Done):** CSV upload, parsing, color rules, SQLite storage, and all primary views.
- **Phase 3 (Done):** Manual Portfolio tracking, Global Stats Dashboard, and Multi-Timeline navigation.
- **Phase 4 (Done):** Unified Financial Summary (Consolidated Table), Refined Invested Cash logic, and UI refinements.
- **Phase 5 (Next):** Google Sheets Push (Service Account integration).
- **Phase 6:** IBKR API Integration.
- **Phase 7:** Israeli Tax Helper (Form 867 aggregation).

---

*Last Updated: April 2026*
