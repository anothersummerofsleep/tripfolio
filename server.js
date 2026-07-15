import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { createStore } from './lib/store.js';
import { ensureSeed, SEEDS } from './lib/seed.js';
import { newId, validateItem, promoteCandidate } from './lib/model.js';
import { collectMirrorData, generateMirror } from './lib/mirror.js';
import { getRate, sourceForNetwork, RATE_SOURCES } from './lib/rates.js';
import { settleTrip } from './lib/settle.js';
import { tripCoverage } from './lib/coverage.js';
import { extractBooking } from './lib/extract.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.resolve(process.env.DATA_DIR || path.join(__dirname, 'data'));
const PORT = Number(process.env.PORT || 5179);

const store = createStore(DATA_DIR);
ensureSeed(store);

const app = express();
app.use(express.json({ limit: '10mb' }));
app.use(express.static(path.join(__dirname, 'public')));

const COLLECTIONS = Object.keys(SEEDS);
const ID_PREFIX = {
  travelers: 'trav', cards: 'card', programs: 'prog', trips: 'trip',
  segments: 'seg', candidates: 'cand', expenses: 'exp', exchanges: 'ex', policies: 'pol'
};

// MIRROR_DIR env var wins; then the in-app setting; then a folder inside
// DATA_DIR. Point it at a private folder in an Obsidian vault to make trips
// browsable there.
function mirrorDir() {
  if (process.env.MIRROR_DIR) return path.resolve(process.env.MIRROR_DIR);
  const settings = store.read('settings', SEEDS.settings);
  return settings.mirrorDir ? path.resolve(settings.mirrorDir) : path.join(DATA_DIR, 'mirror');
}

function regenerateMirror() {
  return generateMirror(collectMirrorData(store, SEEDS), mirrorDir());
}

// Data changed: refresh the markdown mirror unless auto-mirroring is off.
// A mirror failure (e.g. MIRROR_DIR on an unmounted drive) must never fail
// the write itself.
function afterWrite() {
  const settings = store.read('settings', SEEDS.settings);
  if (settings.mirrorAuto === false) return;
  try { regenerateMirror(); } catch (err) { console.error('mirror:', err.message); }
}

// Best-effort: fetch and pin the day's rate onto an expense at write time.
// Skipped when the expense already carries the truth (statement amount or a
// cash-pot method). A fetch failure leaves the expense rate-pending — visible
// in the UI, retryable — and never fails the write.
async function attachRate(expense, { force = false } = {}) {
  if (expense.actualSGD != null || expense.method?.exchangeId) return expense;
  if (expense.rate && !force) return expense;
  const settings = store.read('settings', SEEDS.settings);
  const home = settings.homeCurrency || 'SGD';
  const card = expense.method?.cardId
    ? store.read('cards', []).find((c) => c.id === expense.method.cardId)
    : null;
  const source = sourceForNetwork(card?.network);
  try {
    const rate = await getRate(store, { source, date: expense.date, from: expense.currency, to: home });
    expense.rate = rate || undefined;
  } catch (err) {
    console.error(`rate ${expense.currency}→${home} ${expense.date}:`, err.message);
    expense.rate = undefined;
  }
  return expense;
}

// Agents probe this to find a running tripfolio and discover its shape.
app.get('/api/health', (req, res) => {
  res.json({ ok: true, app: 'tripfolio', collections: COLLECTIONS, dataDir: DATA_DIR, mirrorDir: mirrorDir() });
});

app.post('/api/mirror', (req, res) => {
  res.json({ ok: true, ...regenerateMirror() });
});

// Promote a candidate into a confirmed booking segment.
app.post('/api/candidates/:id/promote', (req, res) => {
  try {
    const result = promoteCandidate(
      store.read('candidates', []), store.read('segments', []), req.params.id
    );
    store.write('candidates', result.candidates);
    store.write('segments', result.segments);
    afterWrite();
    res.json({ ok: true, segment: result.segment });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// The whole splitting picture for one trip: resolved SGD per expense,
// per-person balances, minimal settle-up transfers, pending/estimated counts.
app.get('/api/trips/:id/settlement', (req, res) => {
  const trip = store.read('trips', []).find((t) => t.id === req.params.id);
  if (!trip) return res.status(404).json({ error: `no trip ${req.params.id}` });
  res.json(settleTrip(trip, store.read('expenses', []), {
    cards: store.read('cards', []),
    exchanges: store.read('exchanges', []),
    travelers: store.read('travelers', [])
  }));
});

// Heuristic booking extraction from a pasted/uploaded confirmation email —
// read-only: returns candidate segments + warnings for the client's review
// form; nothing is written until the user confirms. (lib/extract.js)
app.post('/api/extract-booking', (req, res) => {
  const { content } = req.body || {};
  if (typeof content !== 'string' || !content.trim()) {
    return res.status(400).json({ error: 'content (email text) is required' });
  }
  res.json(extractBooking(content));
});

// "Am I covered for this trip?" — the structured check. Fine print stays in
// the policy PDF (see /api/policies/:id/pdf), which is the agent's job to read.
app.get('/api/trips/:id/coverage', (req, res) => {
  const trip = store.read('trips', []).find((t) => t.id === req.params.id);
  if (!trip) return res.status(404).json({ error: `no trip ${req.params.id}` });
  res.json(tripCoverage(trip, store.read('policies', []), store.read('travelers', [])));
});

// Attach the policy document: body { filename, content } with content base64.
app.post('/api/policies/:id/pdf', (req, res) => {
  const list = store.read('policies', []);
  const policy = list.find((p) => p.id === req.params.id);
  if (!policy) return res.status(404).json({ error: `no policy ${req.params.id}` });
  const { filename, content } = req.body || {};
  if (!filename || !content) return res.status(400).json({ error: 'filename and content (base64) are required' });
  policy.pdfPath = store.savePolicyFile(filename, content);
  store.write('policies', list);
  afterWrite();
  res.json(policy);
});

// Serve the stored policy document for viewing (and for agents to read).
app.get('/api/policies/:id/pdf', (req, res) => {
  const policy = store.read('policies', []).find((p) => p.id === req.params.id);
  if (!policy?.pdfPath) return res.status(404).json({ error: 'no document on file for this policy' });
  res.sendFile(path.resolve(store.dataDir, policy.pdfPath));
});

// Direct rate lookup (cache-first) — used by agents and for debugging.
// e.g. /api/rates?source=visa&date=2026-07-10&from=JPY&to=SGD
app.get('/api/rates', async (req, res) => {
  const { source = 'mid', date, from, to = 'SGD' } = req.query;
  if (!date || !from) return res.status(400).json({ error: 'date and from are required' });
  if (!RATE_SOURCES.includes(source)) return res.status(400).json({ error: `source must be one of ${RATE_SOURCES.join(', ')}` });
  try {
    res.json({ rate: await getRate(store, { source, date, from, to }) });
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

// Re-attempt the rate fetch for one expense — for rows left pending (fetch
// failed, or the date was in the future) or stuck on a mid-market fallback.
app.post('/api/expenses/:id/refresh-rate', async (req, res) => {
  const list = store.read('expenses', []);
  const expense = list.find((x) => x.id === req.params.id);
  if (!expense) return res.status(404).json({ error: `no expense ${req.params.id}` });
  await attachRate(expense, { force: true });
  store.write('expenses', list.map((x) => (x.id === expense.id ? expense : x)));
  afterWrite();
  res.json(expense);
});

function validateCollection(name, value) {
  const seed = SEEDS[name];
  if (Array.isArray(seed) && !Array.isArray(value)) return 'expected an array';
  if (!Array.isArray(seed) && (typeof value !== 'object' || value === null || Array.isArray(value))) {
    return 'expected an object';
  }
  return null;
}

app.get('/api/:name', (req, res, next) => {
  const { name } = req.params;
  if (!COLLECTIONS.includes(name)) return next();
  res.json(store.read(name, SEEDS[name]));
});

// Whole-collection replace — what the UI uses after editing in place.
app.put('/api/:name', (req, res, next) => {
  const { name } = req.params;
  if (!COLLECTIONS.includes(name)) return next();
  const problem = validateCollection(name, req.body);
  if (problem) return res.status(400).json({ error: `${name}: ${problem}` });
  store.write(name, req.body);
  afterWrite();
  res.json({ ok: true });
});

// Append one item — the agent-ingest path (skills POST parsed bookings,
// expenses, policies here one at a time). Server assigns the id.
app.post('/api/:name', async (req, res, next) => {
  const { name } = req.params;
  if (!COLLECTIONS.includes(name) || !Array.isArray(SEEDS[name])) return next();
  const problem = validateItem(name, req.body);
  if (problem) return res.status(400).json({ error: `${name}: ${problem}` });
  const item = { id: req.body.id || newId(ID_PREFIX[name]), ...req.body };
  const list = store.read(name, []);
  if (list.some((x) => x.id === item.id)) {
    return res.status(409).json({ error: `${name}: id ${item.id} already exists` });
  }
  if (name === 'expenses') await attachRate(item);
  store.write(name, [...list, item]);
  afterWrite();
  res.status(201).json(item);
});

app.patch('/api/:name/:id', async (req, res, next) => {
  const { name, id } = req.params;
  if (!COLLECTIONS.includes(name) || !Array.isArray(SEEDS[name])) return next();
  const list = store.read(name, []);
  const existing = list.find((x) => x.id === id);
  if (!existing) return res.status(404).json({ error: `${name}: no item ${id}` });
  const merged = { ...existing, ...req.body, id };
  const problem = validateItem(name, merged);
  if (problem) return res.status(400).json({ error: `${name}: ${problem}` });
  // Amount/date/currency/method edits invalidate a pinned rate — refetch.
  if (name === 'expenses' && ['date', 'currency', 'method'].some((k) => k in req.body)) {
    await attachRate(merged, { force: true });
  }
  store.write(name, list.map((x) => (x.id === id ? merged : x)));
  afterWrite();
  res.json(merged);
});

app.delete('/api/:name/:id', (req, res, next) => {
  const { name, id } = req.params;
  if (!COLLECTIONS.includes(name) || !Array.isArray(SEEDS[name])) return next();
  const list = store.read(name, []);
  if (!list.some((x) => x.id === id)) return res.status(404).json({ error: `${name}: no item ${id}` });
  store.write(name, list.filter((x) => x.id !== id));
  afterWrite();
  res.json({ ok: true });
});

app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: err.message || 'Internal error' });
});

app.listen(PORT, '127.0.0.1', () => {
  console.log(`tripfolio running at http://127.0.0.1:${PORT}`);
  console.log(`data directory: ${DATA_DIR}`);
  console.log(`mirror directory: ${mirrorDir()}`);
});
