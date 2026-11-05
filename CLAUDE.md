# IBKR Statement Processor

A local Node.js web app for an Interactive Brokers (IBKR) account. It runs on your own computer and keeps all data there. It's built for an investor who deposits in Israeli shekels (ILS) and holds US stocks/ETFs in dollars (USD), so it shows both currencies, estimates Israeli capital-gains tax and uses Bank of Israel exchange rates.

Two data sources:
1. **Uploaded monthly "readable CSV" statements** (the original app): rows are color-tagged (a port of a legacy Google Apps Script), stored in SQLite and shown on the **Old Statements** page.
2. **IBKR Flex Web Service downloads**: the app fetches monthly reports straight from IBKR. They power the main **Financial Summary (API)** page, Portfolio, Activity and Insights.

## Tech stack (and why)
| Tool | Used for | Why |
|---|---|---|
| Node.js 22 | server | `process.loadEnvFile` and `--watch-path` are built in, so no dotenv or nodemon is needed |
| Express 5 | HTTP server + JSON API | small and well known |
| `better-sqlite3` | local database (`data/ibkr.db`) | a single file, no database server, synchronous API |
| `multer` | CSV uploads | handles multipart file uploads |
| Plain HTML/CSS/JS | frontend (`public/`) | no framework, no bundler, no build step |
| Node `crypto` + `fetch` | Google sign-in and API calls | the service-account JWT is signed by hand, so there's no Google SDK dependency |

No tests, no linter, no build. Verify a change by running the app and checking the affected page.

## Running
- **First time:** `npm install`, then create your private files (see "Files that aren't in the repo" below).
- Double-click `start-app.bat` (starts the server and opens the browser), or run `npm start` / `node server.js`.
- `start-app.bat` runs `node --watch-path=...` on every server-side `.js` file, `paths.json` and `public/` (NOT `data/` or `uploads/`). Code edits restart the server by themselves, and the page holds an EventSource on `/api/live-reload`, so it reloads itself after a restart. `sessionStorage` (`ibkr_view_state`) restores the open page. **If you add a new top-level `.js` file that the server requires, add it to the `--watch-path` list.**
- http://localhost:3000. The server binds `0.0.0.0`, so it's reachable from other devices on the same network (no password, see Known issues).

## Files that aren't in the repo
These files are gitignored or live outside the project, so a fresh clone doesn't have them. Some you create; the app creates the rest.

```
C:\Users\<you>\.secrets\          ← outside the project (any folder works; set it in paths.json)
├── .env                          ← you create: IBKR token, query ID, Google Sheet ID
└── credentials.json              ← you download: Google service-account key (only for Send to Sheets)

<project>\
├── paths.json                    ← you create: copy paths.example.json
├── data\                         ← created by the app
│   ├── ibkr.db                   ← SQLite database (created on first start)
│   └── fx-usdils.json            ← Bank of Israel rate cache (created the first time rates are needed)
└── uploads\                      ← created by the app
    ├── <temp files>              ← CSV uploads, deleted right after parsing
    └── flex\flex-YYYY-MM-<timestamp>.csv   ← one IBKR Flex download per month
```

**Files you create:**
- **`paths.json`** (project folder): copy `paths.example.json` and put in your own paths. Both keys are optional. Without the file, both point to `.secrets` in your home folder.
  ```json
  {
    "envFile": "C:\\Users\\YOUR_WINDOWS_USERNAME\\.secrets\\.env",
    "googleKeyFile": "C:\\Users\\YOUR_WINDOWS_USERNAME\\.secrets\\credentials.json"
  }
  ```
- **`.env`**: plain `KEY=value` lines, no quotes needed.
  ```
  IBKR_FLEX_TOKEN=<from Client Portal → Flex Queries → Flex Web Service Configuration>
  IBKR_FLEX_QUERY_ID=<the number shown next to your Activity Flex Query>
  GOOGLE_SHEET_ID=<the long id in the Sheet's URL: docs.google.com/spreadsheets/d/<id>/edit>
  ```
  - The first two are needed for "Fetch from IBKR"; set up the query as in [docs/ibkr-flex-query.md](docs/ibkr-flex-query.md).
  - `GOOGLE_SHEET_ID` is only needed for "Send to Sheets".
  - Without a `.env`, the app still runs: CSV upload and Old Statements work, and Fetch / Send to Sheets show an error.
- **`credentials.json`**: the JSON key Google gives you when you create a service-account key (Google Cloud → IAM → Service accounts → Keys → Add key → JSON). Use it unchanged. The app reads `client_email` and `private_key` from it. See "Google Sheets push" for the full setup.

**Files the app creates:**
- **`data/ibkr.db`**: created on first start by `db.js` (`CREATE TABLE IF NOT EXISTS`), with all tables empty. The tables:
  - `months`, `sections`, `rows`: the CSV import.
  - `manual_conversions`: `year`, `month`, `from_cur`, `from_amount`, `to_cur`, `to_amount`, `rate`, `note`. It's optional and has no UI; add rows with a small node script only if you converted money at a bank before wiring it to IBKR.
  - `settings`: `key`/`value`, filled from the Portfolio page: `bank_ils`, `fx_usd_ils`.
- **`data/fx-usdils.json`**: `{ "first": "YYYY-MM-DD", "last": "YYYY-MM-DD", "rates": { "YYYY-MM-DD": 3.65, … } }`. It's a cache; delete it to download the rates again.
- **`uploads/flex/`**: filled by "Fetch from IBKR". These can always be downloaded again.

## Secrets & paths
Secrets are kept **outside the project folder** so they can't be committed by mistake.
- `paths.js` reads `paths.json`, loads the `.env` with `process.loadEnvFile` and exports `googleKeyFile`. `server.js` requires it first, before anything reads `process.env`.
- Refer to secrets by variable name only (`process.env.IBKR_FLEX_TOKEN`). Never read, print or log the `.env` or key file. The IBKR request URL contains the token, so it's never logged or put in error messages either.
- `.claude/settings.json` (committed) denies Claude Code access to `.env`, `.env.*` and `credentials.json` inside the repo.
- Gitignored: `data/`, `uploads/`, `node_modules/`, `.env*`, `credentials.json`, `paths.json`. **Never commit real statements, DB files or real amounts**, not in code, comments, docs or commit messages. Use made-up example numbers.

## Where data is saved
| What | Where | Notes |
|---|---|---|
| IBKR Flex downloads (one CSV per month) | `uploads/flex/` | gitignored; can be downloaded again from IBKR |
| Uploaded CSV statements, manual conversions (`manual_conversions`), settings (bank balance, fallback USD/ILS) | `data/ibkr.db` (SQLite) | gitignored; **can't be re-created**, so back it up privately |
| Daily USD/ILS rates (Bank of Israel, public) | `data/fx-usdils.json` | gitignored cache; can be downloaded again |
| Display preferences | browser localStorage (`ibkr_theme`, `ibkr_sidebar`, `ibkr_flex_view`, `ibkr_flex_range`, `ibkr_flex_hidden`, `ibkr_cash_hidden`) and sessionStorage (`ibkr_view_state`, `ibkr_insight`) | per browser, no financial data |
| Copy of Portfolio / Financial Summary / Activity / Insights | the user's Google Sheet | written only when "Send to Sheets" is clicked |

**What leaves the computer** (nothing else does):
- the Flex request to IBKR (token + query ID);
- on "Send to Sheets", the computed numbers to the user's Google Sheet;
- a request for public USD/ILS daily rates to the Bank of Israel (`fx.js`), which sends only a date range.

## Architecture & data flow
```
CSV upload → server.js /api/upload → parser.js (sections + rows) → colorizer.js (tag rows with a color)
          → saveMonthToDB (replaces existing month) → SQLite data/ibkr.db
Fetch      → server.js /api/flex/fetch → flex.js (IBKR Flex Web Service) → uploads/flex/*.csv
Pages (public/app.js) → /api/* in server.js → read DB rows by color / parse Flex files → compute metrics
```
- `paths.js`: finds the private files and loads the `.env` (see above).
- `db.js`: opens `data/ibkr.db` and creates the tables `months` (year, month, UNIQUE), `sections` (month_id, section_name, subheaders JSON), `rows` (section_id, row_index, data JSON array, color), `manual_conversions` (conversions done outside IBKR) and `settings` (key/value). There's no FK cascade: deletes remove rows → sections → month by hand in one transaction.
- `parser.js`: reads year/month from the `Statement,Data,Period` line. Each CSV `Header` line starts a section, and `Data` and `Total` lines become rows (the empty first cell of a Total row is filled with `"Total"`). The `Statement` section is skipped. `row_index 0` is the subheader row and is never colorized.
- `colorizer.js`: 7 rules, picked by section name; each returns a hex color or null.
- `server.js`: all routes plus the metric calculations, in one file. Routes: upload, months list, delete month (`deleteMonth()`), financial summary, net worth, settings, live reload, `/api/flex/*` (fetch, status, stop, overview), `/api/fx/usdils`, `/api/sheets/push`. `getNetWorth(months)` builds `/api/net-worth`, which the Sheets push also uses. `better-sqlite3` is **synchronous**: never use async/await for DB calls.
- `flex.js`: the IBKR Flex Web Service client and Flex CSV parsing/summary (see below).
- `fx.js`: official daily USD/ILS rates from the Bank of Israel (see below).
- `sheets.js`: the Google Sheets push (see below).
- `public/calc.js`: math shared by the page and the server. It contains:
  - `flexTotals`, `monthGain`, `realizedGainOf`, `portfolioMath(nw, rate, bank)`, `CAPITAL_GAINS_TAX`
  - `stockTrades(m)`, `cashRows(m)`, `ACTIVITY_CATEGORIES`, `activityRows` / `activityType` / `activityWords` / `activityCash`
  - `insights()`, `dmy()` (dates as DD/MM/YYYY)

  It's loaded before app.js in index.html and `require`d by sheets.js, so the Sheet always shows the same numbers as the app. **Change the math here, not in app.js.**
- `public/app.js`: the pages. Tabs: **Portfolio**, **Financial Summary (API)** (the default; view `flex`), **Activity**, **💡 Insights** (in `public/insights.js`), the **⬇ Fetch from IBKR** page (opened from the top bar) and **Old Statements** (view `financial`).
  - The side panel changes with the page: the CSV drop zone + uploaded months on Old Statements, the IBKR month picker everywhere else.
  - The ☰ button hides the side panel.
  - It uses inline `onclick` handlers that call global functions.
- `public/style.css`: color tokens at the top, dark mode at the bottom.

## IBKR Flex Web Service (how the app connects to IBKR)
- **Setup in IBKR:**
  - Create an Activity Flex Query in Client Portal → Performance & Reports → Flex Queries.
  - Turn on a Flex Web Service token.
  - Put the token and the query ID in your `.env`.
  - The exact sections, fields and settings are in [docs/ibkr-flex-query.md](docs/ibkr-flex-query.md). The token is read-only: it can download reports but can't trade.
- **Protocol:** `SendRequest` (token `t`, query `q`, `v=3`, optional `fd`/`td` yyyymmdd override) returns a reference code. `GetStatement` is then polled while IBKR answers error 1019 ("still generating"). The poll URL must be on `*.interactivebrokers.com`. `get()` swallows fetch errors so the URL (which contains the token) never appears in a message.
- **Rate limit:** 10 requests/minute per token. `get()` keeps every call ≥6.5s apart, so each month takes about 15s.
- **Fetching:**
  - `POST /api/flex/fetch` with `{ from, to, redownload }` (`YYYY-MM`) downloads one file per month using the `fd`/`td` override.
  - The current month runs to yesterday and is flagged `partial` ("in progress").
  - Finished months already on disk are skipped unless `redownload` is set, which deletes the older file. A saved month whose file ends before its last weekday is fetched again.
  - Weekend ends are moved inward, since IBKR has no weekend data.
  - "Today"/"yesterday" use **New York's date**, because IBKR's day closes on US time.
  - On error 1003 ("not available yet"), `fetchLatestAvailable()` retries ending one weekday earlier (up to 3 times).
  - One download runs at a time (`flexBusy`). `GET /api/flex/status` gives progress, and `POST /api/flex/stop` stops within seconds while keeping the months already saved.
- **Files:** saved as `uploads/flex/flex-<YYYY-MM>-<timestamp>.csv`. Flex data is **not stored in the DB**. Each file is parsed once and cached by name + modified time (`readFlexFile()` / `flexCache`). `getFlexMonths()` copies each month before merging manual conversions, so the cache never changes.
- **Flex CSV format:** lines `BOS,<code>,<name>` / `HEADER,<code>,<fields>` / `DATA,<code>,<values>`. The sections used are Change in NAV, Realized & Unrealized Perf. Summary (totals), Cash Report, Open Positions, Trades (executions + closed lots), Cash Transactions and Corporate Actions.
- **Quirks:**
  - With Change in NAV set to "Realized & Unrealized", its breakdown fields all come back 0. Only StartingValue/EndingValue/TWR are used; the rest comes from the Cash Report (`LevelOfDetail == BaseCurrency`), the FIFO summary and positions.
  - Ending cash is split USD/ILS only if the Cash Report has the `Currency` field ticked.
  - IBKR's monthly TWR already excludes deposits.
- **Per-currency numbers** come from Cash Transactions (`CurrencyPrimary`):
  - deposits/withdrawals;
  - fees (`Other Fees` = Israel tax);
  - conversions from Trades with `AssetClass == CASH` (`USD.ILS` BUY = ILS→USD, SELL = USD→ILS; |proceeds| ≤ 5 is a rounding leftover and is ignored).

## Bank of Israel rates (`fx.js`)
- Public SDMX service: `edge.boi.gov.il/FusionEdgeServer/sdmx/v2/data/dataflow/BOI.STATISTICS/EXR/1.0/RER_USD_ILS?startPeriod&endPeriod&format=csv` (columns `TIME_PERIOD`, `OBS_VALUE`, working days only).
- `GET /api/fx/usdils?from&to` → `{ rates, offline }`.
- Rates are cached in `data/fx-usdils.json`. Only missing days are requested, and the last 3 days are always asked again (today's rate is published in the afternoon). When offline it returns the saved rates with `offline: true`.

## Google Sheets push (`sheets.js`)
- **Purpose:** see the numbers on a phone while the PC is off, without putting the IBKR token in the cloud. The Sheet is a snapshot from the last push.
- **Setup (once):**
  1. Create a Google Cloud project and enable the Google Sheets API.
  2. Create a service account and download its JSON key to the `googleKeyFile` path.
  3. Create a Sheet and share it with the service account's email as Editor.
  4. Put `GOOGLE_SHEET_ID=<id from the Sheet URL>` in your `.env`, then restart.

  Error messages say which step is missing.
- **Flow:**
  - "📤 Send to Sheets" → `POST /api/sheets/push` → `pushToSheets(getNetWorth(months), getFlexMonths(), rates)`.
  - Sign-in: a service-account JWT (RS256 via Node `crypto`) is exchanged for an access token, cached for 1h. The key is only sent to Google's sign-in and is never logged.
  - Then one GET of the tab list, `addSheet` for missing tabs, and one `batchUpdate` per push that clears and redraws each tab. Other tabs are left alone.
- **Tabs:** Portfolio, Financial Summary, Activity, Insights, each drawn on a small canvas (`canvas()`: widths, merged cells, backgrounds, boxes, row heights) in the app's soft light colors. Every tab is about 1240px wide so it fits a 1366px laptop.
- UI changes go into the app first. Bring sheets.js up to date as a separate step.

## Colors are tags (Old Statements / CSV import)
Colors are assigned once at import, and the server **looks rows up by color**. This is the intended design. Changing a rule or color in `colorizer.js` means updating the matching lookups in `server.js` **and** re-importing old months.

| Color | Rule / section | Meaning | Used for |
|---|---|---|---|
| `#FFE699` | Trade Summary by Asset Class (all rows) | Commissions | commissions = col 4 |
| `#E1C8E6` | Deposits & Withdrawals (col 2 non-empty) | Deposit/withdrawal | col 0 currency, col 3 amount (sign = direction) |
| `#F29D94` | Trade Summary by Symbol (row contains "forex") | Currency conversion | cols 2 symbol, 3–5 buy qty/price/proceeds, 6–8 sell |
| `#F7E6D5` / `#D1EFCF` / `#ACDCF2` | Forex P/L Details | Net cash activity / USD.ILS gain / loss | Israel tax USD matching |
| `#FFDCE1` | Fees (`Other Fees`) | Israel tax | ILS rows, col 4 amount |
| `#F8BE78` | Cash Report (Dividends + Base Currency Summary) | Dividends | col 2 |
| `#FFC7CE` | Cash Report (Withholding Tax + Base Currency Summary) | US WHT | col 2 |
| `#C6EFCE` | Cash Report (Ending Cash USD or Base Currency Summary) | Ending cash USD | col 2 |
| `#C6DBFF` | Cash Report (Ending Cash ILS) | Ending cash ILS | col 2 |
| `#BEFAC8` | Realized & Unrealized Perf. Summary (Total row right after Stocks) | Stocks total | col 7 realized, col 12 unrealized, col 13 total |

Column indices are hardcoded (`values[N]`) and match the current IBKR headers. If IBKR changes a layout, they break silently (show 0).

## Calculation rules
- **Realized P/L** = IBKR's Stocks `Realized Total`. **Calculated Realized P/L** = Realized P/L + dividends + WHT + Israel tax (IBKR already signs these). Deposits, withdrawals and conversions are transfers, not profit.
- **Commissions are NOT subtracted again:** IBKR's realized total already includes them (buy commissions are folded into the lot cost, sell commissions are subtracted from realized).
- **Promo deposits:** ILS deposits under ₪500 (`MIN_REAL_DEPOSIT_ILS`, e.g. referral bonuses) aren't counted as real deposits (`isRealDeposit()`).
- **Manual conversions:** a conversion done at a bank before wiring money in lives in the `manual_conversions` table (amounts never in code). It's shown as a conversion, and the matching USD deposit is re-counted in its original currency. There's no UI for it; insert one with a one-off node script.
- **Israel tax USD** (CSV): for each ILS `Other Fees` row, find a Forex P/L `Net Cash Activity` ILS row whose col 5 matches (±0.01) and take its col 6.
- **Invested cash** (CSV): Open Positions → the `DataDiscriminator == Total` row, `Value`/`Market Value`. No section means 0.
- **Returns:** two numbers, always labeled.
  - **Time-weighted** (big): the monthly TWRs chained (`twrPct`). It matches IBKR's "since inception".
  - **Actual** (small): profit ÷ money put in (`returnPct`).
  - TOTAL "put in" = the first month's start value + deposits − withdrawals.
- **Tax estimate:** `CAPITAL_GAINS_TAX` (25%) × max(0, unrealized P/L), computed in $ and shown in ₪ first (Israeli tax is paid in shekels).
- **Exchange-rate effect** applies only to dollars, never to ILS cash.
- **USD/ILS rate:** taken from the newest Flex download (Cash Report ILS ending cash ÷ (base − USD ending cash)). Editing it is a temporary what-if; it's only saved (`fx_usd_ils`) when IBKR gives no rate.
- **Percent of portfolio** is recalculated (value ÷ (invested + cash)) so it totals exactly 100%.

## Pages
- **Portfolio:**
  - 2 inputs: USD/ILS (auto) and bank balance in ₪.
  - 4 headline tiles: net worth after tax, profit in ₪, time-weighted + actual return, money put in.
  - The "If you sold everything today" money journey: a dollar lane and a shekel lane.
  - An "Account now" card, a "Totals since…" card, and Current Portfolio (open positions + a cash row).
- **Financial Summary (API):**
  - One row per month in column groups: Account value / Money in-out / Realized profit / Holdings.
  - A TOTAL row on top. Whole amounts without cents.
  - Each year is an outlined block in its year color.
  - A column chooser (hidden keys in `ibkr_flex_hidden`, columns defined once in `flexColumns()`).
  - Clicking a month shows only that month, with its details below.
- **Activity:** trades and cash activity in one table (`activityRows`), newest first.
  - Category check boxes, each showing its total.
  - Plain-word columns: Date, Type, Stock, What happened, Cash in / out, Profit / loss.
  - A Month column on the side when several months are shown. No TOTAL row.
  - IBKR `CLOSED_LOT` rows are hidden.
- **Insights:** a menu of 7 cards. Clicking one opens only that insight:
  - Growth, Drawdowns, Buying low, Results per stock, Currency conversions, Costs & cash, Then vs now.
  - Explanations sit behind 💡 hover hints (`hint(text)`), not as visible text.
  - "Then vs now", plus one tile each in Drawdowns and Costs & cash, compare the **last 12 months** of downloaded data with **earlier months**. `recentStartOf()` in calc.js counts back from the newest download. Labels come from `ERAS`. The other insights use the months picked in the side panel.
  - Currency conversions are compared with Bank of Israel daily rates 45 days before and after each conversion.
- **Fetch from IBKR:** quick picks, From/To (`ibkr_flex_range`), a Re-download switch, a Stop button and a table of downloaded months.
- **Old Statements:** the CSV-based summary, kept for statements uploaded by hand.
- **Month picker** (side panel, on Financial Summary / Activity / Insights): All time, a From/To range, then years and months. Shift+click selects a range. It's saved in `ibkr_flex_view`, and TOTAL counts only the months shown. Portfolio always uses all months.

## UI rules
- **Macro first, little text:** headline totals and a simple overview. Put explanations in tooltips / 💡 hints. Prefer merging cards over adding new ones.
- **Readable:** fairly large fonts. Every table must fit **without horizontal scrolling at 1366px with the side panel open**.
- **Color meanings are fixed:** green = money in / profit / USD, red = money out / loss, blue = ILS. Year colors (blue/purple/teal/orange/pink, `yc{year % 5}`) are never green/red.
- **One table design everywhere:** `.list-page` + `.nice-*`: rounded 12px boxes, bold sticky headers, thin column lines, shaded alternate rows, text left / numbers right, total row on top. Dates are DD/MM/YYYY.
- **Animations** are short (about 0.3–0.6s), build in reading order (`animatePage()`, `PAGE_PARTS`), and are turned off under `prefers-reduced-motion`.
- **Light / dark mode:** 🌙/☀️ toggles class `dark` on `<html>`, saved in `ibkr_theme`. Light mode is soft (no pure white). **Never hard-code colors in app.js.** Use the tokens (`var(--pos)`, `var(--neg)`, `signColor()`, `.conv-usd`, `.conv-ils`) and check both themes.

## Testing (no tests in the repo)
- Run a second copy of the server on **port 3999** from a scratch script that patches `express.application.listen`, and drive headless Edge over CDP (`--remote-debugging-port`) for screenshots. Leave the real app on port 3000 alone.
- **Never screenshot real amounts:**
  - For IBKR pages, fake `fs.readdirSync/readFileSync/statSync` for `uploads/flex` with made-up Flex CSVs, and/or override `window.fetch` for `/api/net-worth`.
  - The harness doesn't fake the DB, so don't screenshot Old Statements unless `db.prepare` is faked too.
- To check real data, print only booleans, counts, percentages, rates or pixel widths.
- To test fetching without IBKR: replace `flex.fetchFlexStatement` with a fake and make `fs.writeFileSync/unlinkSync` for `uploads/flex` do nothing. With a fake token, IBKR answers `1015 Token is invalid`.
- Check light and dark mode at 1366px. Disable animations/transitions before screenshots (`*{animation:none!important;transition:none!important}`).
- **Editing gotchas:**
  - In JS `String.replace`, a replacement containing `` $` `` or `$'` inserts text. Use `split(a).join(b)` instead.
  - `public/index.html` has CRLF line endings.

## Code conventions
- Keep changes surgical: no speculative code. When a page or feature is removed, remove its routes, CSS and comments in the same change.
- Comments match the file: `db.js`, `parser.js`, `colorizer.js`, `flex.js`, `paths.js` use plain-English banner comments; `server.js` and `app.js` are terse.
- Before committing, scan the diff for real figures and check `git status` for data files.

## Known issues / open items
- The server binds `0.0.0.0` with no password: anyone on the same network can open the app and trigger fetches. Possible fix: bind to localhost only, or add a password.
- The colorizer anchor `name.includes('fees')` would also match any future section with "fees" in its name.
- "Payment in Lieu of Dividends" is in the Flex query, but dividend totals come from the Cash Report `Dividends` field. Whether PIL is included there hasn't been checked.
## Roadmap
1. Done: CSV import (Old Statements), color rules, SQLite, dark mode, IBKR Flex download, Portfolio / Activity / Insights, Google Sheets push.
2. Possible next steps: feed Flex data into the Old Statements summary (check against a month that exists in both first); lock the app to localhost or add a password.
3. Possible later: live data via the IBKR Client Portal API. If so: paper-trading account first, a view-only IBKR user, 2FA on, and never expose the gateway.
