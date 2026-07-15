import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createStore } from '../lib/store.js';
import { getRate, sourceForNetwork } from '../lib/rates.js';

const tmpStore = () => createStore(fs.mkdtempSync(path.join(os.tmpdir(), 'tripfolio-rates-')));

test('sourceForNetwork maps amex and cash to mid-market', () => {
  assert.equal(sourceForNetwork('visa'), 'visa');
  assert.equal(sourceForNetwork('mastercard'), 'mastercard');
  assert.equal(sourceForNetwork('amex'), 'mid');
  assert.equal(sourceForNetwork(undefined), 'mid');
});

test('getRate caches successful fetches and never refetches', async () => {
  const store = tmpStore();
  let calls = 0;
  const fetchers = { visa: async () => { calls++; return { value: 0.0086, rateDate: '2026-07-10' }; } };
  const q = { source: 'visa', date: '2026-07-10', from: 'JPY', to: 'SGD' };

  const first = await getRate(store, q, fetchers);
  const second = await getRate(store, q, fetchers);
  assert.equal(calls, 1);
  assert.equal(first.value, 0.0086);
  assert.deepEqual(second, { value: 0.0086, date: '2026-07-10', source: 'visa', estimated: false });
});

test('getRate falls back to mid-market, flagged estimated, when the network is blocked', async () => {
  const store = tmpStore();
  const fetchers = {
    mastercard: async () => { throw new Error('403 Forbidden'); },
    mid: async () => ({ value: 0.00798, rateDate: '2026-07-10' })
  };
  const r = await getRate(store, { source: 'mastercard', date: '2026-07-10', from: 'JPY', to: 'SGD' }, fetchers);
  assert.equal(r.source, 'mid');
  assert.equal(r.estimated, true);
  assert.match(r.note, /mastercard unavailable/);
  // the failure was NOT cached — a later attempt tries mastercard again
  const cache = store.read('rates-cache', {});
  assert.equal(Object.keys(cache).length, 1);
  assert.ok(cache['mid|2026-07-10|JPY|SGD']);
});

test('getRate: same-currency is 1, future dates are pending (null)', async () => {
  const store = tmpStore();
  assert.equal((await getRate(store, { source: 'mid', date: '2026-07-10', from: 'SGD', to: 'SGD' }, {})).value, 1);
  const future = new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10);
  assert.equal(await getRate(store, { source: 'mid', date: future, from: 'JPY', to: 'SGD' }, {}), null);
});
