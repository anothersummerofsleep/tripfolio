import test from 'node:test';
import assert from 'node:assert/strict';
import { extractBooking, emailToText, findDates, findTimes } from '../lib/extract.js';

// --- fixtures ---------------------------------------------------------------

const SQ_PLAIN = `
Dear MR KEN,

Thank you for flying Singapore Airlines. Your booking is confirmed.
Booking reference: WXYZ12

Flight SQ 638
Singapore (SIN) → Tokyo Narita (NRT)
Departure: 14 Sep 2026, 09:25
Arrival: 14 Sep 2026, 17:30
Cabin: Economy

Flight SQ 637
Tokyo Narita (NRT) → Singapore (SIN)
Departure: 20 Sep 2026, 11:10
Arrival: 20 Sep 2026, 17:40
Cabin: Economy

Total fare: SGD 1,240.00
`;

const HOTEL_HTML = `
<html><head><style>.x{color:red}</style></head><body>
<table><tr><td><h1>Your reservation is confirmed!</h1></td></tr>
<tr><td>Your booking at Hotel Century Southern Tower</td></tr>
<tr><td>Confirmation number: 88901234</td></tr>
<tr><td>Check-in</td><td>Monday, September 14, 2026 (from 14:00)</td></tr>
<tr><td>Check-out</td><td>Sunday, September 20, 2026 (until 11:00)</td></tr>
<tr><td>Address: 2-2-1 Yoyogi, Shibuya-ku, Tokyo 151-8583</td></tr>
</table></body></html>
`;

const SCOOT_EML = `From: noreply@flyscoot.com
To: ken@example.com
Subject: Your Scoot Booking Confirmation
MIME-Version: 1.0
Content-Type: multipart/alternative; boundary="BOUND42"

--BOUND42
Content-Type: text/plain; charset=utf-8
Content-Transfer-Encoding: quoted-printable

Booking reference: ABC123

Your flight details
TR 280 =E2=80=94 SIN to DPS
Departs 6 Nov 2026, 06:55 =E2=80=94 Arrives 6 Nov 2026, 09:35

See you on board!
--BOUND42--
`;

const REDEYE = `
Flight EK 353 — Booking reference: ZZTOP9
Singapore (SIN) → Dubai (DXB)
Departure: 1 Oct 2026 at 02:10
Arrival: 1 Oct 2026 at 05:45

Flight EK 355
Dubai (DXB) → Singapore (SIN)
Departure: 9 Oct 2026 at 21:15
Arrival (+1): 9 Oct 2026 at 08:45
`;

// --- emailToText ------------------------------------------------------------

test('emailToText: strips HTML, decodes entities, keeps line structure', () => {
  const text = emailToText(HOTEL_HTML);
  assert.ok(text.includes('Hotel Century Southern Tower'));
  assert.ok(!text.includes('<td>'));
  assert.ok(!text.includes('color:red'));
});

test('emailToText: picks the quoted-printable text/plain MIME part from an .eml', () => {
  const text = emailToText(SCOOT_EML);
  assert.ok(text.includes('TR 280 — SIN to DPS'), 'QP-decoded em dash present');
  assert.ok(!text.includes('Content-Transfer-Encoding'));
});

// --- primitives -------------------------------------------------------------

test('findDates: mixed formats, unambiguous only', () => {
  const dates = findDates('Fly on 14 Sep 2026, return September 20, 2026, e-ticket 14SEP26, iso 2026-09-14. Numeric 04/09/2026 ignored.');
  const values = dates.map((d) => d.value);
  assert.ok(values.includes('2026-09-14'));
  assert.ok(values.includes('2026-09-20'));
  assert.equal(values.filter((v) => v === '2026-09-04' || v === '2026-04-09').length, 0);
});

test('findTimes: 24h, am/pm, and price-vs-time guard', () => {
  const times = findTimes('Departs 09:25, boards 8:55 am, lands 5.40pm. Total 9.25 dollars.');
  assert.deepEqual(times.map((t) => t.value), ['09:25', '08:55', '17:40']);
});

// --- extraction -------------------------------------------------------------

test('extractBooking: two-leg airline confirmation → two complete flight segments', () => {
  const { segments, warnings } = extractBooking(SQ_PLAIN);
  const flights = segments.filter((s) => s.type === 'flight');
  assert.equal(flights.length, 2);

  const [out, back] = flights;
  assert.equal(out.flightNo, 'SQ638');
  assert.equal(out.airline, 'Singapore Airlines');
  assert.equal(out.pnr, 'WXYZ12');
  assert.deepEqual([out.from, out.to], ['SIN', 'NRT']);
  assert.equal(out.depLocal, '2026-09-14T09:25');
  assert.equal(out.arrLocal, '2026-09-14T17:30');
  assert.equal(out.cabin, 'Economy');

  assert.equal(back.flightNo, 'SQ637');
  assert.deepEqual([back.from, back.to], ['NRT', 'SIN']);
  assert.equal(back.depLocal, '2026-09-20T11:10');
  assert.equal(warnings.length, 0, `unexpected warnings: ${warnings.join('; ')}`);
});

test('extractBooking: HTML hotel confirmation → stay with property, dates, confirmation no', () => {
  const { segments } = extractBooking(HOTEL_HTML);
  const stay = segments.find((s) => s.type === 'stay');
  assert.ok(stay);
  assert.match(stay.property, /Hotel Century Southern Tower/);
  assert.equal(stay.checkIn, '2026-09-14');
  assert.equal(stay.checkOut, '2026-09-20');
  assert.equal(stay.confirmationNo, '88901234');
  assert.match(stay.address, /Yoyogi/);
});

test('extractBooking: raw .eml with quoted-printable → LCC flight', () => {
  const { segments } = extractBooking(SCOOT_EML);
  const flight = segments.find((s) => s.type === 'flight');
  assert.equal(flight.flightNo, 'TR280');
  assert.equal(flight.airline, 'Scoot');
  assert.equal(flight.pnr, 'ABC123');
  assert.deepEqual([flight.from, flight.to], ['SIN', 'DPS']);
  assert.equal(flight.depLocal, '2026-11-06T06:55');
});

test('extractBooking: overnight (+1) arrival rolls the date forward', () => {
  const { segments } = extractBooking(REDEYE);
  const back = segments.find((s) => s.flightNo === 'EK355');
  assert.equal(back.depLocal, '2026-10-09T21:15');
  assert.equal(back.arrLocal, '2026-10-10T08:45');
});

test('extractBooking: unrecognizable input degrades to a warning, never throws', () => {
  const { segments, warnings } = extractBooking('Hi Ken, lunch tomorrow? Cheers');
  assert.equal(segments.length, 0);
  assert.match(warnings[0], /no flight or hotel details recognized/);
});
