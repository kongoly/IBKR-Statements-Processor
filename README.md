# IBKR Statement Processor

A local web app that turns your Interactive Brokers (IBKR) account data into clear monthly summaries, a portfolio overview and plain-language insights. It runs on your own computer, and your financial data never leaves it.

It's built for investors who deposit in **Israeli shekels (₪)** and hold **US stocks/ETFs in dollars ($)**. It shows both currencies side by side, estimates Israeli capital-gains tax (25%), and uses the Bank of Israel's official exchange rates.

## What it does
- **Fetch from IBKR**: downloads your monthly reports straight from IBKR's Flex Web Service. You don't need to export anything by hand.
- **Portfolio**: net worth after tax, profit in ₪, time-weighted and actual return, and a "what if you sold everything today" breakdown.
- **Financial Summary**: one row per month (account value, deposits, realized profit, dividends, taxes, fees, holdings), with a month/range picker and a column chooser.
- **Activity**: every trade, dividend, deposit, conversion and tax, in one readable table.
- **Insights**: answers to questions like *Is my money growing?*, *How far did I fall?*, *Did I buy when things were down?*, *Did I convert shekels at good times?* and *Am I doing better lately?*
- **Send to Google Sheets** (optional): copies everything to a Google Sheet so you can see it on your phone.
- **Old Statements**: upload IBKR's monthly CSV statements by hand instead.
- Light and dark mode.

## Privacy
- All data is stored locally: a SQLite database in `data/` and downloaded reports in `uploads/`. Both are gitignored.
- Your IBKR token and Google key live in a folder **outside the project**, so they can't be committed by mistake.
- The app only contacts three services:
  - **IBKR**, to download your reports;
  - **Google**, only when you click "Send to Sheets";
  - **the Bank of Israel**, for public exchange rates (only a date range is sent).

## Requirements
- [Node.js](https://nodejs.org) **22 or newer**
- Windows (for the `start-app.bat` launcher; on other systems run `npm start`)
- An IBKR account with an Activity Flex Query and a Flex Web Service token (setup below)

## Setup
1. **Download the project and install it:**
   ```
   git clone https://github.com/kongoly/IBKR-Statements-Processor.git
   cd IBKR-Statements-Processor
   npm install
   ```
2. **Create a private folder outside the project** for your secrets, for example `C:\Users\<you>\.secrets\`.
3. **Set up IBKR.** This is the longest step, done once in IBKR's Client Portal. Follow [docs/ibkr-flex-query.md](docs/ibkr-flex-query.md):
   - Create an **Activity Flex Query** with exactly the 7 sections and the fields listed there. The app reads its numbers from these fields, so a field left out shows as 0.
   - Note the query's **ID**.
   - Turn on the **Flex Web Service** and generate a **token**.
4. **Create a `.env` file** in your private folder:
   ```
   IBKR_FLEX_TOKEN=<your Flex Web Service token>
   IBKR_FLEX_QUERY_ID=<your Flex Query's ID number>
   GOOGLE_SHEET_ID=<optional: only for Send to Sheets>
   ```
5. **Tell the app where your private folder is.** Copy `paths.example.json` to `paths.json` and replace `YOUR_WINDOWS_USERNAME`. You can skip this step if you used `C:\Users\<you>\.secrets\`, since that's the default.
6. **Start the app**: double-click `start-app.bat` (or run `npm start`). It opens at http://localhost:3000.
7. Click **⬇ Fetch from IBKR** and pick the months to download.

The `data/` and `uploads/` folders and the database are created automatically on first start.

### Optional: Send to Google Sheets
1. In Google Cloud, create a project and enable the **Google Sheets API**.
2. Create a **service account**, then download a JSON key into your private folder as `credentials.json`.
3. Create a Google Sheet and **share** it with the service account's email (as Editor).
4. Add `GOOGLE_SHEET_ID=<the id from the Sheet's URL>` to your `.env`, then restart the app.

## Good to know
- The server is reachable from other devices on your home network, with **no password**. Only run it on a network you trust.
- The tax figure is a simple estimate (25% of unrealized profit), not tax advice.
- For how the code works, the calculation rules and the full list of private files, see [CLAUDE.md](CLAUDE.md).

## Tech
Node.js, Express, SQLite (`better-sqlite3`), and plain HTML/CSS/JavaScript, with no framework and no build step.
