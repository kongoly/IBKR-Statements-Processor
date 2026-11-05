# IBKR Flex Query setup

How the Flex Query is configured in IBKR (Client Portal → Performance & Reports → Flex Queries), and what the app reads from it. If the app shows zeros or missing columns after a change in IBKR, compare against this list.

No secrets here: the token and query ID live only in your private `.env` file outside the project (`IBKR_FLEX_TOKEN`, `IBKR_FLEX_QUERY_ID`). Its location is set in `paths.json` (copy `paths.example.json` to create it).

## Step by step
1. Log in to IBKR **Client Portal** → **Performance & Reports** → **Flex Queries**.
2. Next to **Activity Flex Query**, click **+** to create a new query. Give it any name; the app finds it by its ID, not its name.
3. Turn on **only** the 7 sections in the table below. In each section, set the options and tick the fields exactly as listed. Leave everything else off.
4. Set **Delivery Configuration** and **General Configuration** as described under the table, then **Save**.
5. Back in the Flex Queries list, note the query's **ID** (a number shown next to its name, or under the info icon). That's `IBKR_FLEX_QUERY_ID` in your `.env`.
6. Open **Flex Web Service Configuration** (on the same page), turn the service on and **generate a token**. That's `IBKR_FLEX_TOKEN` in your `.env` (see "Flex Web Service token" below).
7. In the app, click **⬇ Fetch from IBKR** and download one month to test it. If a page shows zeros or empty columns, compare your query against the table below: usually a field wasn't ticked.

The field names the app actually reads are listed at the end of this page ("Field names the code relies on"). A missing field there shows up as 0 or an empty column; it doesn't cause a crash. The most common one to miss is **Currency** in the Cash Report: without it, cash can't be split into USD and ILS.

## Query: "Last Month Activity Report" (Activity Flex Query)

Leave every field that isn't listed **off** (no Account ID, Account Alias, ISIN/CUSIP/Conid etc.). Account Information is deliberately not included.

| Section (Flex code) | Options on | Fields on |
|---|---|---|
| Change in NAV (`CNAV`) | Realized & Unrealized | Currency, From Date, To Date, Starting Value, Realized, Change in Unrealized, Deposits/Withdrawals, Internal Cash Transfers, Dividends, Withholding Tax, Interest, Other Fees, Commissions, Forex Translation, Ending Value, TWR |
| Realized and Unrealized Performance Summary in Base (`FIFO`) | Totals Only | Total Realized and Unrealized P/L, Total Unrealized PNL, Total Realized P/L, Asset Class, Symbol |
| Cash Report (`CRTT`) | Base Currency Summary, Currency Breakout, Exclude segments and MTD/YTD breakout | **Currency**, Level of Detail, From Date, To Date, Starting Cash, Ending Cash, Deposits, Withdrawals, Dividends, Withholding Tax, Other Fees, Commissions |
| Open Positions (`POST`) | Summary | Symbol, Asset Class, Currency, Quantity, Mark Price, Position Value, Cost Basis Money, Unrealized P/L, FX Rate To Base, Level of Detail, Cost Basis Price, Percent of NAV, Description |
| Trades (`TRNT`) | Execution, Closed Lots (Symbol Summary **off**) | Symbol, Asset Class, Currency, Trade Date, Buy/Sell, Quantity, TradePrice, Proceeds, IB Commission, IB Commission Currency, Realized P/L, FX Rate To Base, Level Of Detail, Cost Basis, Transaction ID, Open Date Time |
| Cash Transactions (`CTRN`) | Dividends, Withholding Tax, Other Fees, Deposits & Withdrawals, Broker Interest Received, Payment in Lieu of Dividends, Detail | Date/Time, Amount, Currency, Type, Description, FX Rate To Base, Level of Detail, Symbol, Ex Date |
| Corporate Actions (`CORP`) | Detail | Currency, FX Rate To Base, Asset Class, Symbol, Description, Date/Time, Action Description, Proceeds, Value, Quantity, Cost Basis, Realized P/L, Type, Level of Detail |

Delivery: Format **CSV**, header and trailer records **Yes**, column headers **Yes**, single column header row **No**, section code and line descriptor **Yes**, Period **Last Month**.
General: Profit and Loss **Default**, Date format **yyyy-MM-dd**, Time **HH:mm:ss**, separator `;`, everything else **No** (offsetting trades, currency rates, audit trail, account alias, breakout by day).

Some fields are only there for future features: Closed Lots, Open Date Time and Cost Basis (Israeli tax helper), Ex Date and Symbol in Cash Transactions (dividends per stock), Corporate Actions (splits), Broker Interest Received.

## Flex Web Service token
Client Portal → Flex Queries → Flex Web Service Configuration. Token with an expiry of a few months; IP restriction optional (home IPs can change; the error is 1013 if it doesn't match). The token is read-only: it can download reports, not trade. Generating a new token cancels the old one.

## Field names the code relies on (CSV header names)
- CNAV: `StartingValue`, `EndingValue`, `TWR` (percent). With "Realized & Unrealized", IBKR leaves the breakdown fields at 0, so the app doesn't use them.
- CRTT: `LevelOfDetail` (`BaseCurrency` / `Currency`), `CurrencyPrimary`, `FromDate`, `ToDate`, `EndingCash`, `Deposits`, `Withdrawals`, `Dividends`, `WithholdingTax`, `OtherFees`, `Commissions`. The USD/ILS rate is derived from it: ILS EndingCash ÷ (base EndingCash − USD EndingCash).
- FIFO: `TotalRealizedPnl`, `TotalUnrealizedPnl` (one totals row).
- POST: `PositionValue`, `CostBasisMoney`, `FifoPnlUnrealized`, `FXRateToBase`, `CostBasisPrice`, `MarkPrice`, `Description`, `CurrencyPrimary`.
- TRNT: `AssetClass` (`CASH` = currency conversion, symbol `USD.ILS`), `Buy/Sell`, `Quantity`, `TradePrice`, `Proceeds`, `IBCommission`, `FifoPnlRealized`, `TradeDate`.
- CTRN: `Type` (`Deposits/Withdrawals`, `Dividends`, `Withholding Tax`, `Other Fees`), `Amount`, `CurrencyPrimary`, `FXRateToBase`, `Date/Time` (`yyyy-MM-dd;HH:mm:ss`).

## Web service behavior (learned while building)
- Two steps: SendRequest (`t`, `q`, `v=3`, optional `fd`/`td` as yyyymmdd for a custom period up to 365 days) → GetStatement polled with the reference code.
- Error 1019 = still generating (retry). 1003 = statement not available (usually the latest day isn't closed yet on US time). 1015 = invalid token. 1012 = expired. 1013 = IP restriction. 1018 = too many requests (limit: 1/second, 10/minute per token).
- No weekend data, and the day closes on New York time. The app asks for weekdays only and uses New York's date for "yesterday".
- Flex data goes back to the account's first month.
