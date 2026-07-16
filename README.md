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

## What's in v1 (complete)

- **Trips** — lifecycle statuses (`dreaming → planning → booked → done`); flight /
  stay / transport / activity bookings; candidate options with prices you can compare
  and **promote** into bookings; a markdown day-by-day itinerary per trip.
- **Email import** — paste (or upload as `.eml`/`.txt`/`.html`) an airline or hotel
  confirmation email and tripfolio extracts the bookings: flight numbers with the
  airline named from a built-in carrier map, IATA routes, local departure/arrival
  times (overnight `+1` handled), PNRs, hotel names, check-in/out, confirmation
  numbers. Generic aviation/hotel patterns, not per-airline templates — an airline
  it has never seen degrades gracefully instead of breaking. Deliberately
  assistive: extraction **prefills the booking form for your review** and lists
  every field it couldn't find; nothing is saved until you confirm. Works fully
  offline; for gnarly emails, the `ingest-booking` agent skill reads them better.
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
- **Insurance** — policy records (annual multi-trip or single-trip) with the
  policy PDF filed alongside. Every trip gets a coverage badge — **covered /
  partial / uncovered** — computed strictly from dates, per-trip duration caps,
  and who's on the policy. Deliberately *not* computed: region matching and fine
  print (skiing? drone? pre-existing conditions?) — string-matching "Worldwide
  excl. USA" against destinations is a fiction, so those questions go to your
  agent, which reads the PDF on file and answers from the actual wording.
- **Policy import** — the insurance counterpart of email import: paste a policy
  schedule / certificate of insurance, or **upload the document** (a text-based
  PDF, or `.txt`/`.html`/`.eml`), and tripfolio extracts insurer, policy number,
  annual-vs-single, coverage window, per-trip day cap, area of cover, and the
  medical / cancellation / baggage limits. Same contract as booking import: it
  **prefills the Add-policy form for your review** and lists what it couldn't
  find; an uploaded PDF rides along and is filed on save. Reads text-based PDFs
  with no dependency (Node's built-in zlib), and *if* poppler's `pdftotext`
  happens to be on the PATH it's used as a fallback for PDFs the built-in reader
  can't crack (set `PDFTOTEXT` to point at the binary if it's elsewhere) — an
  optional enhancement, never required. A **scanned** policy has no text layer to
  read either way, so it says so and points you at pasting the text or the
  `ingest-policy` agent skill, which reads it better.
- **Markdown mirror** — every save regenerates a folder of markdown notes (one per
  trip — bookings, itinerary, expense totals and who-owes-whom, coverage status —
  plus Loyalty Wallet and Travel Insurance summaries) with YAML frontmatter. Point
  `MIRROR_DIR` (or Settings → mirror folder) into an Obsidian vault and your trips
  are browsable notes. The mirror is one-way and regenerable; never edit it.

## AI-agent integration

tripfolio is built to be *used by* AI agents (Claude Code, Cowork, or anything
that speaks HTTP), not just by a human at the browser. Point an agent at a running
instance and it can read your trips, loyalty status, budget and coverage, and write
bookings, expenses and policies back.

**Self-describing manifest.** `GET /api/agent-manifest` returns a machine-readable
capability document — every endpoint with a plain-English purpose, the data
conventions, and the skills that ship with the repo. Add `?format=md` for a
paste-into-chat brief. An agent that fetches this can use tripfolio with no prior
knowledge; nothing else to configure.

**Register your agents.** Settings → *AI agents* lets you add the agents you use and
shows each one's tailored connection recipe, plus one-click copy of the manifest URL
or the full Markdown guide.

The UI's own REST API is that agent surface:

```
GET  /api/health                      # discover a running tripfolio (name, version, collections)
GET  /api/agent-manifest[?format=md]  # self-describing capabilities for an agent to self-configure
GET  /api/<collection>                # trips, segments, candidates, travelers, cards,
PUT  /api/<collection>                #   programs, expenses, exchanges, policies,
POST /api/<collection>                #   agents, settings
PATCH  /api/<collection>/<id>
DELETE /api/<collection>/<id>
POST /api/extract-booking             # email text → candidate segments (read-only)
POST /api/extract-policy              # policy text or PDF → prefill fields (read-only)
POST /api/candidates/<id>/promote     # candidate → confirmed booking
POST /api/mirror                      # regenerate the markdown mirror
GET  /api/trips/<id>/settlement       # balances, settle-up transfers, totals
GET  /api/trips/<id>/coverage         # insurance badge + reasons
GET  /api/rates?source=visa&date=2026-07-10&from=JPY&to=SGD
POST /api/expenses/<id>/refresh-rate  # retry a pending/estimated rate
POST /api/policies/<id>/pdf           # attach the policy document
GET  /api/policies/<id>/pdf           # read it back (agents answer fine print from this)
```

The repo ships three Claude Code skills (also listed in the manifest):

- [`ingest-booking`](.claude/skills/ingest-booking/SKILL.md) — paste a confirmation
  email and say "ingest this booking"; the agent parses it (no brittle per-airline
  regex; the model is the parser) and POSTs the structured segment in.
- [`ingest-expenses`](.claude/skills/ingest-expenses/SKILL.md) — during a trip, log
  spending as one-liners on your phone ("1400 JPY dinner ramen, amex, split all");
  afterwards the agent parses the capture note (or receipt photos) and files each
  expense with the right day's rate fetched retroactively.
- [`ingest-policy`](.claude/skills/ingest-policy/SKILL.md) — hand over an insurance
  PDF; the agent extracts the structured coverage fields, files the record, and
  attaches the document — then answers "does it cover skiing?" from the wording.

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
