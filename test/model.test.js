import test from 'node:test';
import assert from 'node:assert/strict';
import { validateItem, promoteCandidate, tripDays, segmentSortKey } from '../lib/model.js';

test('validateItem catches missing required fields', () => {
  assert.equal(validateItem('trips', { name: 'X', status: 'booked' }), null);
  assert.match(validateItem('trips', { name: 'X' }), /missing field: status/);
  assert.match(validateItem('trips', { name: 'X', status: 'someday' }), /invalid status/);
  assert.match(validateItem('segments', { tripId: 't', type: 'spaceship' }), /invalid type/);
  assert.equal(validateItem('segments', { tripId: 't', type: 'flight' }), null);
});

test('promoteCandidate copies to segments and marks the candidate', () => {
  const candidates = [{ id: 'cand_1', tripId: 't', type: 'flight', airline: 'SQ', price: 420, currency: 'SGD', sourceUrl: 'x', verdict: 'shortlisted' }];
  const { segments, candidates: after, segment } = promoteCandidate(candidates, [], 'cand_1');
  assert.equal(segments.length, 1);
  assert.equal(segment.airline, 'SQ');
  assert.equal(segment.fromCandidateId, 'cand_1');
  assert.equal(segment.price, undefined, 'candidate-only fields are dropped');
  assert.equal(after[0].verdict, 'promoted');
  assert.throws(() => promoteCandidate(after, segments, 'cand_1'), /already promoted/);
  assert.throws(() => promoteCandidate(after, segments, 'nope'), /No candidate/);
});

test('tripDays spans inclusive dates and survives bad input', () => {
  assert.deepEqual(
    tripDays({ startDate: '2026-09-14', endDate: '2026-09-16' }),
    ['2026-09-14', '2026-09-15', '2026-09-16']
  );
  assert.deepEqual(tripDays({ startDate: null, endDate: null }), []);
  assert.deepEqual(tripDays({ startDate: 'garbage', endDate: '2026-09-16' }), []);
  assert.equal(tripDays({ startDate: '2026-01-01', endDate: '2062-01-01' }).length, 120, 'capped');
});

test('segmentSortKey orders flights, stays and activities together', () => {
  const flight = { depLocal: '2026-09-14T09:25' };
  const stay = { checkIn: '2026-09-14' };
  const activity = { date: '2026-09-15' };
  const sorted = [activity, flight, stay].sort((a, b) => segmentSortKey(a).localeCompare(segmentSortKey(b)));
  assert.deepEqual(sorted, [stay, flight, activity]);
});
