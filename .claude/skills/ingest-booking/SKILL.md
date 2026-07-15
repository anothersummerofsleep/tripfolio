---
name: ingest-booking
description: Parse a flight, hotel, train/ferry, or activity confirmation (pasted email text, PDF, or screenshot) and file it into tripfolio as a structured booking. Use when the user says "ingest this booking", "add this confirmation to tripfolio", "file this flight/hotel", or pastes a booking confirmation and wants it stored.
---

# Ingest a booking into tripfolio

Turn a confirmation the user gives you (pasted email text, a PDF, an image) into a
structured segment POSTed to the local tripfolio API. You do the parsing — no
per-airline regex exists, your reading of the document is the parser.

## Steps

1. **Find the server.** `GET http://127.0.0.1:5179/api/health` (port 5179 unless the
   user says otherwise). If it doesn't respond, ask the user to start tripfolio
   (`npm start` in the app folder), or offer to start it yourself.

2. **Pick the trip.** `GET /api/trips` and match the confirmation's dates/destination
   against existing trips. Exactly one plausible match → use it and say which.
   None or several → ask the user (offer to create a trip: `POST /api/trips` with
   `{ name, status: "booked", startDate, endDate, destinations, travelerIds: [], days: [] }`).

3. **Extract the segment.** Read the confirmation carefully; never guess a value you
   can't see. All datetimes are LOCAL wall-clock times, format `YYYY-MM-DDTHH:mm`;
   dates are `YYYY-MM-DD`. Omit fields you can't find — do not invent them.

   - **flight**: `{ tripId, type: "flight", airline, flightNo, pnr, from, to, depLocal, arrLocal, cabin, seat, programId, notes }`
     (from/to as IATA codes when shown, otherwise city names; one segment per flight leg — a return trip is two segments)
   - **stay**: `{ tripId, type: "stay", property, confirmationNo, checkIn, checkOut, address, programId, notes }`
   - **transport** (train/ferry/bus/car rental/taxi): `{ tripId, type: "transport", mode, operator, ref, from, to, depLocal, arrLocal, notes }`
   - **activity** (tours, tickets, restaurants): `{ tripId, type: "activity", name, ref, date, location, notes }`

   For `programId`: `GET /api/programs` and link the loyalty program only when the
   confirmation shows a member number that matches one on file; otherwise leave it out.

4. **Show before you file.** Present the extracted fields to the user in a compact
   table and confirm, unless they've already said to file it without asking.

5. **File it.** `POST /api/segments` with the JSON body (Content-Type: application/json).
   One POST per segment. The server assigns the id and refreshes the markdown mirror.

6. **Report.** Confirm what was filed, into which trip, and mention anything you
   could not extract so the user can add it in the app.

## Booked, or just considering?

If the user is comparing options rather than holding a confirmed booking, file to
`POST /api/candidates` instead — same fields plus `{ price, currency, sourceUrl }`.
"Promote" in the app (or `POST /api/candidates/:id/promote`) turns the winner into
a booking later.
