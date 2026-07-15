# tripfolio

Local-first travel companion — trips, loyalty programs, FX-aware expense splitting,
and insurance coverage in plain JSON your AI agents can read. No database, no cloud,
no build step. Your data never leaves your machine.

## Why

Travel data is scattered: bookings in email, member numbers in a notes app, spending
in your head, the insurance PDF somewhere in Downloads. tripfolio puts all of it in
one folder of human-readable JSON — and because it's plain files behind a tiny local
API, an AI agent (Claude Code, etc.) can *read* your travel database when planning a
trip and *write* to it when you hand it a booking confirmation.

## Quick start

```bash
npm install
npm start          # http://127.0.0.1:5179
```

Try it with sample data first:

```bash
DATA_DIR=./sample-data npm start
```

All real data lives in `DATA_DIR` (default `./data`, gitignored). Writes are atomic,
and every file keeps a rolling `.bak` of its previous version.

## What's in v1 (phases A+B+C — shipped)

- **Trips** — lifecycle statuses (`dreaming → planning → booked → done`); flight /
  stay / transport / activity bookings; candidate options with prices you can compare
  and **promote** into bookings; a markdown day-by-day itinerary per trip.
- **Loyalty wallet** — airline and hotel programs: member number, tier, tier expiry
  (with warnings), and dated points snapshots you update when you feel like it.
- **Registries** — travelers you split costs with, payment cards (name + network +
  FX fee only — never card numbers).
- **Expenses & FX** — log spending in any currency, before or during the trip.
  Each expense is pinned to **that day's rate from the network that actually
  billed it** when possible: tripfolio tries Visa's and Mastercard's published
  daily-rate endpoints (both sit behind bot protection and often reject
  programmatic clients — tripfolio doesn't try to sneak past; it falls back to
  ECB mid-market via frankfurter.dev and **flags the row as an estimate, with
  the reason**). Amex publishes no rates at all, so Amex rows are always
  estimates. Every row has an **"SGD actual"** reconcile field — type the
  statement amount and it becomes the truth, fees included. Rates are historical
  and cached, so logging three days late costs nothing.
- **Cost splitting** — Splitwise-core: travelers, payer per expense, equal /
  weighted / exact splits, cash pots that carry the money-changer rate you
  actually got, a per-trip toggle for whether card FX fees are shared or the
  payer's problem, and a settle-up report netted to minimal transfers in SGD.
- **Markdown mirror** — every save regenerates a folder of markdown notes (one per
  trip — bookings, itinerary, expense totals and who-owes-whom — plus Loyalty
  Wallet and Travel Insurance summaries) with YAML frontmatter. Point `MIRROR_DIR`
  (or Settings → mirror folder) into an Obsidian vault and your trips are
  browsable notes. The mirror is one-way and regenerable; never edit it.

Coming in phase D: insurance coverage checks against your policies (the JSON
schema for those is stable today).

## AI-agent integration

The UI's own REST API doubles as the agent surface:

```
GET  /api/health                      # discover a running tripfolio
GET  /api/<collection>                # trips, segments, candidates, travelers,
PUT  /api/<collection>                #   cards, programs, expenses, exchanges,
POST /api/<collection>                #   policies, settings
PATCH  /api/<collection>/<id>
DELETE /api/<collection>/<id>
POST /api/candidates/<id>/promote     # candidate → confirmed booking
POST /api/mirror                      # regenerate the markdown mirror
GET  /api/trips/<id>/settlement       # balances, settle-up transfers, totals
GET  /api/rates?source=visa&date=2026-07-10&from=JPY&to=SGD
POST /api/expenses/<id>/refresh-rate  # retry a pending/estimated rate
```

The repo ships two Claude Code skills:

- [`ingest-booking`](.claude/skills/ingest-booking/SKILL.md) — paste a confirmation
  email and say "ingest this booking"; the agent parses it (no brittle per-airline
  regex; the model is the parser) and POSTs the structured segment in.
- [`ingest-expenses`](.claude/skills/ingest-expenses/SKILL.md) — during a trip, log
  spending as one-liners on your phone ("1400 JPY dinner ramen, amex, split all");
  afterwards the agent parses the capture note (or receipt photos) and files each
  expense with the right day's rate fetched retroactively.

## Configuration

| Env var | Default | Purpose |
|---|---|---|
| `DATA_DIR` | `./data` | Where the JSON lives |
| `MIRROR_DIR` | `<DATA_DIR>/mirror` | Where markdown notes are generated |
| `PORT` | `5179` | Listen port (localhost only) |

## Privacy posture

- Binds to `127.0.0.1` only.
- The repo never contains real data; `data/` is gitignored, `sample-data/` is fake.
- Card records hold name/network/fee — **no PANs, no expiry dates, no member PINs**.

## Tests

```bash
npm test
```

MIT licensed.
