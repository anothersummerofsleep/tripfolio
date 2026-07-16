import test from 'node:test';
import assert from 'node:assert/strict';
import { extractPolicy, findBenefits } from '../lib/extract-policy.js';

// Synthetic fixture, shaped like a common annual-multi-trip schedule layout:
// bare FROM:/TO: period labels (which must NOT be mistaken for email headers),
// hyphenated dates, a plan name, optional riders across lines, and no benefit
// amounts on the schedule (schedules typically list plan/dates/region only —
// sums insured live in the policy wording, a separate document).
const GENERIC_SCHEDULE = `POLICY NO.:
SL-00000000

PERIOD OF INSURANCE : (both dates inclusive)
FROM:
01-Mar-2026 00:00hours

TO:
28-Feb-2027 23:59hours

SUMMARY OF COVER
PLAN TYPE:
Travel Plus
TRIP TYPE:
Annual Multi-trip
REGION OF COVER:
Asia, Australia, New Zealand

OPTIONAL COVER(S):
Cancel For Any Reason

Winter Sports
PREMIUM CALCULATION
PREMIUM:
SGD 332.61

IMPORTANT NOTE
This policy does not cover any loss arising from any pre-existing medical condition.`;

const ANNUAL_SCHEDULE = `
CERTIFICATE OF INSURANCE

Insurer: NTUC Income Insurance Co-operative Limited
Plan: Enhanced PreX Annual Multi-Trip
Policy Number: TII/2026/0099887
Period of Insurance: 01 Jan 2026 to 31 Dec 2026
Area of Cover: Worldwide excluding USA
Each trip up to 90 days.

Benefits (per insured person):
Overseas Medical Expenses ......... SGD 1,000,000
Trip Cancellation ................. SGD 15,000
Loss of Baggage ................... SGD 5,000
Policy excess: SGD 50 each claim.
`;

const SINGLE_SCHEDULE = `
AXA Travel Insurance — Single Trip Plan
Policy No: AX-SG-556677
Period of Insurance: 10 Mar 2026 to 20 Mar 2026
Emergency Medical Cover: $200,000
Trip Cancellation: $8,000
`;

test('extracts an annual multi-trip schedule', () => {
  const { policy, warnings } = extractPolicy(ANNUAL_SCHEDULE);
  assert.match(policy.insurer, /Income/);
  assert.equal(policy.policyNumber, 'TII/2026/0099887');
  assert.equal(policy.type, 'annual');
  assert.equal(policy.coverageStart, '2026-01-01');
  assert.equal(policy.coverageEnd, '2026-12-31');
  assert.equal(policy.maxTripDays, 90);
  assert.match([].concat(policy.regions).join(''), /Worldwide/);
  assert.equal(policy.limits.medical, 1000000);
  assert.equal(policy.limits.cancellation, 15000);
  assert.equal(policy.limits.baggage, 5000);
  assert.deepEqual(warnings, []);
});

test('extracts a single-trip schedule and skips maxTripDays', () => {
  const { policy } = extractPolicy(SINGLE_SCHEDULE);
  assert.equal(policy.insurer, 'AXA');
  assert.equal(policy.policyNumber, 'AX-SG-556677');
  assert.equal(policy.type, 'single');
  assert.equal(policy.coverageStart, '2026-03-10');
  assert.equal(policy.coverageEnd, '2026-03-20');
  assert.equal(policy.maxTripDays, undefined);
  assert.equal(policy.limits.medical, 200000);
  assert.equal(policy.limits.cancellation, 8000);
  assert.equal(policy.limits.baggage, undefined);
});

test('warns on the fields it cannot find', () => {
  const { policy, warnings } = extractPolicy('Thanks for choosing us — your plan is active. Safe travels!');
  assert.equal(policy.insurer, undefined);
  assert.equal(policy.policyNumber, undefined);
  assert.ok(warnings.some((w) => /could not find/.test(w)));
  assert.ok(warnings.some((w) => /no benefit amounts/.test(w)));
});

test('a schedule with bare FROM:/TO: is not mistaken for an email', () => {
  const { policy } = extractPolicy(GENERIC_SCHEDULE);
  // The policy number sits above FROM:/TO: — it survives only if the schedule
  // isn't treated as an email whose "headers" get stripped.
  assert.equal(policy.policyNumber, 'SL-00000000');
  assert.equal(policy.insurer, undefined); // no insurer name in this excerpt
  assert.equal(policy.type, 'annual');
  assert.equal(policy.coverageStart, '2026-03-01');
  assert.equal(policy.coverageEnd, '2027-02-28');
  assert.deepEqual(policy.regions, ['Asia, Australia, New Zealand']);
  assert.match(policy.notes, /Plan: Travel Plus/);
  assert.match(policy.notes, /Cancel For Any Reason, Winter Sports/);
  assert.match(policy.notes, /pre-existing/i);
});

test('findBenefits reads a benefit table and skips premium/excess lines', () => {
  const benefits = findBenefits([
    'Overseas Medical Expenses ......... SGD 1,000,000',
    'Trip Cancellation ................. SGD 15,000',
    'Personal Liability ................ SGD 1,000,000',
    'Policy excess ..................... SGD 50',
    'Total premium ..................... SGD 332.61'
  ].join('\n'));
  assert.deepEqual(benefits, [
    { name: 'Overseas Medical Expenses', limit: 1000000 },
    { name: 'Trip Cancellation', limit: 15000 },
    { name: 'Personal Liability', limit: 1000000 }
  ]);
});

test('a benefit table populates benefits and derives headline limits', () => {
  const { policy } = extractPolicy([
    'AIG Travel Guard — Single Trip', 'Policy No: TG-1234',
    'Period of Insurance: 01 Aug 2026 to 10 Aug 2026',
    'Medical Expenses Overseas: SGD 500,000',
    'Trip Cancellation: SGD 5,000',
    'Loss of Baggage: SGD 3,000'
  ].join('\n'));
  assert.equal(policy.benefits.length, 3);
  assert.equal(policy.limits.medical, 500000);
  assert.equal(policy.limits.baggage, 3000);
});

test('empty input is reported, never thrown', () => {
  const { policy, warnings } = extractPolicy('   ');
  assert.deepEqual(policy, {});
  assert.deepEqual(warnings, ['nothing readable in the document']);
});

test('does not mistake a bare policy year for a policy number', () => {
  const { policy } = extractPolicy('Great Eastern travel cover. Policy year: 2026. No number printed.');
  assert.equal(policy.insurer, 'Great Eastern');
  assert.equal(policy.policyNumber, undefined);
});
