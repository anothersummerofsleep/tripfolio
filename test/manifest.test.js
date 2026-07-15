import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildManifest, manifestMarkdown } from '../lib/manifest.js';

const appDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const COLLECTIONS = ['trips', 'segments', 'expenses', 'policies', 'agents', 'settings'];

const make = () => buildManifest({ baseUrl: 'http://127.0.0.1:5179', appDir, collections: COLLECTIONS, version: '0.1.0' });

test('buildManifest carries base info, endpoints, collections, conventions', () => {
  const m = make();
  assert.equal(m.app, 'tripfolio');
  assert.equal(m.baseUrl, 'http://127.0.0.1:5179');
  assert.equal(m.version, '0.1.0');
  assert.deepEqual(m.collections, COLLECTIONS);
  assert.ok(m.endpoints.some((e) => e.path === '/api/health'));
  assert.ok(m.endpoints.some((e) => e.method === 'POST' && e.path === '/api/{collection}'));
  assert.ok(m.conventions.dates.includes('YYYY-MM-DD'));
});

test('buildManifest reads the actually-shipped skills from disk', () => {
  const names = make().skills.map((s) => s.name);
  // The three ingest skills ship in this repo — the manifest must reflect them.
  for (const expected of ['ingest-booking', 'ingest-expenses', 'ingest-policy']) {
    assert.ok(names.includes(expected), `missing skill ${expected} (got ${names.join(', ')})`);
  }
  for (const s of make().skills) {
    assert.ok(s.description, `skill ${s.name} has no description`);
    assert.match(s.path, /^\.claude\/skills\//);
  }
});

test('manifestMarkdown is a self-contained paste-in brief', () => {
  const md = manifestMarkdown(make());
  assert.match(md, /# tripfolio — AI agent guide/);
  assert.match(md, /Base URL:.*127\.0\.0\.1:5179/);
  assert.match(md, /## Endpoints/);
  assert.match(md, /## Conventions/);
  assert.match(md, /ingest-booking/);
});
