import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { generateMirror, MARKER } from '../lib/mirror.js';

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'tripfolio-mirror-'));

const DATA = {
  trips: [{
    id: 'trip_1', name: 'Tokyo: cherry blossom week?', status: 'booked',
    startDate: '2026-09-14', endDate: '2026-09-15',
    destinations: ['Tokyo'], travelerIds: ['trav_1'],
    days: [{ date: '2026-09-14', md: 'Land NRT, ramen.' }]
  }],
  segments: [{
    id: 'seg_1', tripId: 'trip_1', type: 'flight',
    airline: 'SQ', flightNo: 'SQ638', from: 'SIN', to: 'NRT', depLocal: '2026-09-14T09:25', pnr: 'ABC123'
  }],
  candidates: [{ id: 'cand_1', tripId: 'trip_1', type: 'stay', property: 'Hotel X', price: 200, currency: 'SGD' }],
  travelers: [{ id: 'trav_1', name: 'Alex' }],
  programs: [{
    id: 'prog_1', kind: 'airline', program: 'KrisFlyer', alliance: 'Star Alliance',
    memberNumber: '8812345678', tier: 'Gold', tierExpiry: '2027-02-28',
    snapshots: [{ date: '2026-05-01', points: 48200 }, { date: '2026-07-01', points: 61550 }]
  }],
  policies: [{ id: 'pol_1', insurer: 'Acme', policyNumber: 'TA-1', type: 'annual', coverageStart: '2026-03-01', coverageEnd: '2027-02-28', regions: ['Worldwide'] }]
};

test('generateMirror writes trip, loyalty, insurance and index notes', () => {
  const dir = tmp();
  const { notes } = generateMirror(DATA, dir);
  assert.equal(notes, 4);

  const trip = fs.readFileSync(path.join(dir, 'trips', 'Tokyo cherry blossom week.md'), 'utf8');
  assert.ok(trip.startsWith('---\n'), 'has frontmatter');
  assert.ok(trip.includes(MARKER));
  assert.ok(trip.includes('SQ638'));
  assert.ok(trip.includes('PNR `ABC123`'));
  assert.ok(trip.includes('### 2026-09-14'));
  assert.ok(trip.includes('Land NRT, ramen.'));
  assert.ok(trip.includes('### 2026-09-15'), 'unplanned days still listed');
  assert.ok(trip.includes('Hotel X'), 'candidates listed');

  const loyalty = fs.readFileSync(path.join(dir, 'Loyalty Wallet.md'), 'utf8');
  assert.ok(loyalty.includes('`8812345678`'));
  assert.ok(loyalty.includes('61,550 (as of 2026-07-01)'), 'latest snapshot wins');

  const index = fs.readFileSync(path.join(dir, 'Tripfolio.md'), 'utf8');
  assert.ok(index.includes('[[Tokyo cherry blossom week]]'));
});

test('renamed trips clean up their old note; foreign files are untouched', () => {
  const dir = tmp();
  generateMirror(DATA, dir);
  const foreign = path.join(dir, 'trips', 'my own note.md');
  fs.writeFileSync(foreign, '# mine\n');

  const renamed = structuredClone(DATA);
  renamed.trips[0].name = 'Tokyo 2026';
  generateMirror(renamed, dir);

  assert.ok(!fs.existsSync(path.join(dir, 'trips', 'Tokyo cherry blossom week.md')), 'stale note removed');
  assert.ok(fs.existsSync(path.join(dir, 'trips', 'Tokyo 2026.md')));
  assert.ok(fs.existsSync(foreign), 'unmarked file untouched');
});
