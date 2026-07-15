import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluatePolicy, tripCoverage, policyStatus } from '../lib/coverage.js';

const POLICY = {
  id: 'pol_1', insurer: 'Acme', policyNumber: 'TA-1', type: 'annual',
  coverageStart: '2026-03-01', coverageEnd: '2027-02-28', maxTripDays: 90,
  regions: ['Worldwide excl. USA'], coveredTravelerIds: ['a', 'b'], pdfPath: 'policies/x.pdf'
};
const TRAVELERS = [{ id: 'a', name: 'Alex' }, { id: 'b', name: 'Sam' }, { id: 'c', name: 'Jo' }];
const trip = (over = {}) => ({
  id: 't', startDate: '2026-09-14', endDate: '2026-09-20', travelerIds: ['a', 'b'], ...over
});

test('evaluatePolicy: clean pass, regions surfaced as a note', () => {
  const r = evaluatePolicy(POLICY, trip());
  assert.equal(r.ok, true);
  assert.deepEqual(r.problems, []);
  assert.match(r.warnings.find((w) => typeof w === 'string'), /Worldwide excl\. USA/);
});

test('evaluatePolicy: trip outside the coverage window fails', () => {
  assert.match(evaluatePolicy(POLICY, trip({ startDate: '2027-03-05', endDate: '2027-03-10' })).problems[0], /coverage ends/);
  assert.match(evaluatePolicy(POLICY, trip({ startDate: '2026-02-20', endDate: '2026-02-25' })).problems[0], /before coverage begins/);
});

test('evaluatePolicy: trip running past coverage end is a warning, not a pass or fail', () => {
  const r = evaluatePolicy(POLICY, trip({ startDate: '2027-02-25', endDate: '2027-03-04' }));
  assert.equal(r.ok, true);
  assert.match(r.warnings.find((w) => typeof w === 'string' && w.includes('during the trip')), /check the policy/);
});

test('evaluatePolicy: max trip days enforced for annual policies', () => {
  const r = evaluatePolicy(POLICY, trip({ startDate: '2026-04-01', endDate: '2026-08-01' }));
  assert.match(r.problems[0], /up to 90 days/);
});

test('evaluatePolicy: traveler gaps — partial is a warning, nobody covered is a problem', () => {
  const partial = evaluatePolicy(POLICY, trip({ travelerIds: ['a', 'b', 'c'] }));
  assert.equal(partial.ok, true);
  assert.deepEqual(partial.warnings.find((w) => w.uncoveredTravelerIds), { uncoveredTravelerIds: ['c'] });
  const nobody = evaluatePolicy(POLICY, trip({ travelerIds: ['c'] }));
  assert.equal(nobody.ok, false);
  assert.match(nobody.problems[0], /none of the trip travelers/);
});

test('tripCoverage: covered / partial / uncovered / none / unknown', () => {
  assert.equal(tripCoverage(trip(), [POLICY], TRAVELERS).status, 'covered');

  const partial = tripCoverage(trip({ travelerIds: ['a', 'b', 'c'] }), [POLICY], TRAVELERS);
  assert.equal(partial.status, 'partial');
  assert.deepEqual(partial.policies[0].uncoveredTravelers, ['Jo']);

  assert.equal(tripCoverage(trip({ startDate: '2027-06-01', endDate: '2027-06-05' }), [POLICY], TRAVELERS).status, 'uncovered');
  assert.equal(tripCoverage(trip(), [], TRAVELERS).status, 'none');
  assert.equal(tripCoverage(trip({ startDate: null, endDate: null }), [POLICY], TRAVELERS).status, 'unknown');
});

test('tripCoverage: single-trip policy with no traveler list covers everyone listed', () => {
  const single = { id: 'pol_2', insurer: 'B', policyNumber: 'ST-9', type: 'single',
    coverageStart: '2026-09-14', coverageEnd: '2026-09-20', coveredTravelerIds: [] };
  assert.equal(tripCoverage(trip({ travelerIds: ['a', 'b', 'c'] }), [single], TRAVELERS).status, 'covered');
});

test('policyStatus: active, expiring, expired, not yet active', () => {
  assert.equal(policyStatus(POLICY, '2026-07-15'), 'active');
  assert.equal(policyStatus(POLICY, '2027-01-15'), 'expiring in 44d');
  assert.equal(policyStatus(POLICY, '2027-03-01'), 'expired');
  assert.equal(policyStatus(POLICY, '2026-02-01'), 'not yet active');
});
