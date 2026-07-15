import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createStore } from '../lib/store.js';

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'tripfolio-'));

test('read returns fallback when file is missing', () => {
  const store = createStore(tmp());
  assert.deepEqual(store.read('trips', []), []);
});

test('write then read round-trips', () => {
  const store = createStore(tmp());
  store.write('trips', [{ id: 'trip_1', name: 'Tokyo' }]);
  assert.equal(store.read('trips', [])[0].name, 'Tokyo');
});

test('write keeps a .bak of the previous version', () => {
  const dir = tmp();
  const store = createStore(dir);
  store.write('trips', [{ id: 'a' }]);
  store.write('trips', [{ id: 'b' }]);
  const bak = JSON.parse(fs.readFileSync(path.join(dir, 'trips.json.bak'), 'utf8'));
  assert.equal(bak[0].id, 'a');
});
