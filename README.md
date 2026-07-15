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

## What's in v1 (phase A+B — shipped)

- **Trips** — lifecycle statuses (`dreaming → planning → booked → done`); flight /
  stay / transport / activity bookings; candidate options with prices you can compare
  and **promote** into bookings; a markdown day-by-day itinerary per trip.
- **Loyalty wallet** — airline and hotel programs: member number, tier, tier expiry
  (with warnings), and dated points snapshots you update when you feel like it.
- **Registries** — travelers you split costs with, payment cards (name + network +
  FX fee only — never card numbers).
- **Markdown mirror** — every save regenerates a folder of markdown notes (one per
  trip, plus Loyalty Wallet and Travel Insurance summaries) with YAML frontmatter.
  Point `MIRROR_DIR` (or Settings → mirror folder) into an Obsidian vault and your
  trips are browsable notes. The mirror is one-way and regenerable; never edit it.

Coming in later phases: FX expense tracking against real Mastercard/Visa daily
settlement rates with post-trip cost splitting (phase C), and insurance coverage
checks against your policies (phase D). The JSON schema for those is stable today.

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
```

The repo ships a Claude Code skill, [`ingest-booking`](.claude/skills/ingest-booking/SKILL.md):
paste a confirmation email into your agent and say "ingest this booking" — the agent
parses it (no brittle per-airline regex; the model is the parser) and POSTs the
structured segment in.

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
