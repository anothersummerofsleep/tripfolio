// Regenerate the markdown mirror without starting the server: npm run mirror
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createStore } from '../lib/store.js';
import { ensureSeed, SEEDS } from '../lib/seed.js';
import { collectMirrorData, generateMirror } from '../lib/mirror.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.resolve(process.env.DATA_DIR || path.join(__dirname, '..', 'data'));

const store = createStore(DATA_DIR);
ensureSeed(store);
const settings = store.read('settings', SEEDS.settings);
const mirrorDir = process.env.MIRROR_DIR
  ? path.resolve(process.env.MIRROR_DIR)
  : settings.mirrorDir ? path.resolve(settings.mirrorDir) : path.join(DATA_DIR, 'mirror');

const { notes, dir } = generateMirror(collectMirrorData(store, SEEDS), mirrorDir);
console.log(`mirror: wrote ${notes} notes to ${dir}`);
