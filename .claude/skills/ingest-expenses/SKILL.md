---
name: ingest-expenses
description: Parse trip expenses from a quick-capture note, message, or receipt photos and file them into tripfolio with the right day's FX rate. Use when the user says "ingest these expenses", "file my trip spending", "log these costs", pastes lines like "1400 JPY dinner ramen, amex, split all", or hands over receipt photos from a trip.
---

# Ingest trip expenses into tripfolio

During a trip the user logs spending in whatever is fastest — one-line notes on
their phone, receipt photos. Your job: turn that capture into structured expenses
POSTed to the local tripfolio API. Rates are historical, so entries days late lose
nothing — the server pins each expense to its date's rate automatically.

## Capture format (flexible — parse intent, not syntax)

```
2026-09-15
1400 JPY dinner ramen, miles card, split all
5200 JPY Shibuya Sky extra ticket, cash, alex only
changed 500 SGD to 55200 JPY at Ninja Money Exchange
```

A date line sets the date for the lines under it (no date → ask, or use file
metadata). Each expense line has: amount + currency, description, optionally how
it was paid and how it splits. `changed X SGD to Y <CUR>` lines are cash-pot
exchanges, not expenses.

## Steps

1. **Find the server**: `GET http://127.0.0.1:5179/api/health` (port 5179 unless told otherwise).
2. **Pick the trip**: `GET /api/trips`, match by the dates/destination; ask if ambiguous.
3. **Load context**: `GET /api/travelers`, `GET /api/cards`, `GET /api/exchanges`.
   Map "amex/platinum/miles card/visa" etc. against card names and networks; map
   people by first name. Never guess a card the user didn't indicate — omit
   `method` instead (the server estimates at mid-market, flagged).
4. **File exchanges first**: `POST /api/exchanges` with
   `{ tripId, date, fromAmount, fromCurrency: "SGD", toAmount, toCurrency }`.
   Cash expenses in that currency then use `method: { exchangeId }` — prefer the
   trip's most recent pot on/before the expense date.
5. **File each expense**: `POST /api/expenses` with
   `{ tripId, date, description, category?, amount, currency, payerId, method?, participants? }`
   - `method`: `{ cardId }` or `{ exchangeId }`; omit for unknown/other.
   - `participants`: omit (or `[]`) for "split all"; `[{ travelerId }]` subsets;
     `[{ travelerId, share }]` weights; `[{ travelerId, exact }]` exact local-currency
     amounts summing to the total. "alex only" → `[{ travelerId: "<alex's id>" }]`.
   - `payerId`: who paid. Default to the vault owner if unstated, and say so.
   - Categories: short lowercase nouns (food, transport, lodging, activities, shopping).
6. **Report**: list what was filed with each row's resolved rate source from the
   response (`rate.source`, `rate.estimated`). Flag rows left rate-pending (future
   date or fetch failure) and rows on estimated rates (Amex, blocked Mastercard) —
   those get trued up later via the ledger's "SGD actual" column from the statement.

## Receipt photos

Read amount, currency, date, and merchant from the image. If the printed total
conflicts with what the user wrote, use the receipt and mention the discrepancy.
