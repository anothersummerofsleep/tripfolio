// Demo mode: copy the fictional sample-data/ into a throwaway .demo-data/
// folder and serve that copy, so exploring the demo never writes to the
// committed sample files (atomic writes leave .bak files, and every save
// regenerates the markdown mirror) or to any real data or mirror folder.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const src = path.join(root, 'sample-data');
const dst = path.join(root, '.demo-data');

if (!fs.existsSync(src)) {
  console.error('sample-data/ missing.');
  process.exit(1);
}
// The only thing ever deleted is this fixed, gitignored folder inside the repo.
fs.rmSync(dst, { recursive: true, force: true });
fs.cpSync(src, dst, { recursive: true });

// Point every place the server writes at the throwaway copy. Inherited values
// (a real DATA_DIR, or a MIRROR_DIR aimed at an Obsidian vault) are overridden,
// never honoured: the mirror step overwrites and prunes its own notes there.
process.env.DATA_DIR = dst;
process.env.MIRROR_DIR = path.join(dst, 'mirror');
console.log('demo mode: using a throwaway copy of sample-data/ in .demo-data/');
await import('../server.js');
