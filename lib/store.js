import fs from 'node:fs';
import path from 'node:path';

// One JSON file per collection. Writes are atomic (temp file + rename) and the
// previous version is kept as <name>.json.bak — data files are the only state
// this app has, so they get treated with care.
export function createStore(dataDir) {
  fs.mkdirSync(dataDir, { recursive: true });
  fs.mkdirSync(path.join(dataDir, 'policies'), { recursive: true });

  const fileFor = (name) => path.join(dataDir, `${name}.json`);

  function read(name, fallback) {
    const file = fileFor(name);
    if (!fs.existsSync(file)) return structuredClone(fallback);
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  }

  function write(name, value) {
    const file = fileFor(name);
    const tmp = `${file}.tmp`;
    const json = JSON.stringify(value, null, 2);
    if (fs.existsSync(file)) fs.copyFileSync(file, `${file}.bak`);
    fs.writeFileSync(tmp, json, 'utf8');
    fs.renameSync(tmp, file);
    return value;
  }

  function exists(name) {
    return fs.existsSync(fileFor(name));
  }

  // Store an uploaded policy PDF (base64 body) under DATA_DIR/policies/ and
  // return the relative path recorded on the policy record.
  function savePolicyFile(filename, base64) {
    const safe = String(filename).replace(/[^\w.\- ]+/g, '_');
    const rel = path.join('policies', `${Date.now()}_${safe}`);
    fs.writeFileSync(path.join(dataDir, rel), Buffer.from(base64, 'base64'));
    return rel;
  }

  return { read, write, exists, savePolicyFile, dataDir };
}
