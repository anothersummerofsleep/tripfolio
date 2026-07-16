---
name: ingest-policy
description: Read a travel insurance policy document (PDF or pasted text), extract the structured coverage fields, and file it into tripfolio — policy record plus the PDF itself. Use when the user says "ingest this policy", "add my travel insurance", "file this policy document", or hands over an insurance PDF/schedule. Also for answering "does my policy cover X?" — read the PDF already on file.
---

# Ingest a travel insurance policy into tripfolio

Two jobs: (1) turn a policy document into a structured record the app can compute
coverage badges from, and (2) keep the PDF on file so fine-print questions can be
answered later by reading it.

## Filing a policy

1. **Find the server**: `GET http://127.0.0.1:5179/api/health` (port 5179 unless told otherwise).
2. **Read the document.** Extract only what the document states — never infer:
   - `insurer`, `policyNumber`
   - `type`: `"annual"` (annual multi-trip) or `"single"` (one trip)
   - `coverageStart`, `coverageEnd` (YYYY-MM-DD; single-trip = the trip dates)
   - `maxTripDays`: annual policies' per-trip duration cap (e.g. "each trip up to 90 days")
   - `regions`: the plan's area of coverage as written (e.g. `["Worldwide excl. USA"]`, `["Asia"]`)
   - `coveredTravelerIds`: `GET /api/travelers`, match insured names; leave `[]` if the
     policy covers whoever travels. If an insured person isn't in tripfolio yet, ask
     before creating them.
   - `limits`: `{ medical, cancellation, baggage }` — headline amounts in home currency
   - `benefits`: **the full "what's covered and how much" table** — an array of
     `{ name, limit }` (limit in home-currency dollars; omit `limit` for a covered item
     whose sum isn't stated). This is the high-value field only an agent can fill: the
     schedule almost never lists sums insured — they live in the **policy wording** table
     (often a subset-font PDF the offline importer reads as garbage). Read the wording,
     find the column for the insured's plan/tier (e.g. "Plus"), and record each section
     with its amount. Never invent a figure; leave `limit` off if you can't read it.
   - `notes`: anything load-bearing that doesn't fit (plan/tier name, optional riders,
     excess amounts, pre-existing conditions cover)
3. **Show before filing.** Present the extracted fields and confirm, unless already told to file.
4. **Create the record**: `POST /api/policies` with the JSON body.
5. **Attach the document**: `POST /api/policies/<id>/pdf` with
   `{ "filename": "policy.pdf", "content": "<base64 of the file>" }`.
6. **Report** what was filed and what the app now shows per trip
   (`GET /api/trips/<id>/coverage`). Say clearly which fields you could not find.

## Offline import (no agent)

The app also ships a heuristic, no-agent path for when you're not around: **Insurance →
⬆ Import from document** (or `POST /api/extract-policy` with `{ content }` or
`{ pdf, filename }`). It prefills the Add-policy form from a pasted schedule or a
text-based PDF and lets the user file it themselves. It can't read scanned/image PDFs
and won't match insured names to travelers — that's what this skill is for, and it stays
the higher-accuracy path. Prefer it whenever the user hands *you* the document.

## Answering "am I covered for X?"

The app's coverage badge only checks dates, trip length, and travelers. For anything
else — skiing, drone/camera gear, pregnancy, pre-existing conditions, rental-car
excess, region edge cases — fetch the document (`GET /api/policies/<id>/pdf`), read
the relevant sections, and answer from the wording, citing the clause. If no PDF is
on file, say so and ask for the document rather than guessing.
