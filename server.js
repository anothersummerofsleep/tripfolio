import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { createStore } from './lib/store.js';
import { ensureSeed, SEEDS } from './lib/seed.js';
import { newId, validateItem, promoteCandidate } from './lib/model.js';
import { collectMirrorData, generateMirror } from './lib/mirror.js';

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
app.post('/api/:name', (req, res, next) => {
  const { name } = req.params;
  if (!COLLECTIONS.includes(name) || !Array.isArray(SEEDS[name])) return next();
  const problem = validateItem(name, req.body);
  if (problem) return res.status(400).json({ error: `${name}: ${problem}` });
  const item = { id: req.body.id || newId(ID_PREFIX[name]), ...req.body };
  const list = store.read(name, []);
  if (list.some((x) => x.id === item.id)) {
    return res.status(409).json({ error: `${name}: id ${item.id} already exists` });
  }
  store.write(name, [...list, item]);
  afterWrite();
  res.status(201).json(item);
});

app.patch('/api/:name/:id', (req, res, next) => {
  const { name, id } = req.params;
  if (!COLLECTIONS.includes(name) || !Array.isArray(SEEDS[name])) return next();
  const list = store.read(name, []);
  const existing = list.find((x) => x.id === id);
  if (!existing) return res.status(404).json({ error: `${name}: no item ${id}` });
  const merged = { ...existing, ...req.body, id };
  const problem = validateItem(name, merged);
  if (problem) return res.status(400).json({ error: `${name}: ${problem}` });
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
