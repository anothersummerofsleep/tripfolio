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

  // Resolve a policy record's stored pdfPath to the real file it names, or null.
  // pdfPath is editable through the generic collection API, so it is untrusted:
  // only a relative path that resolves (symlinks followed) to an existing file
  // inside DATA_DIR/policies/ is accepted. Absolute paths, ../ traversal and
  // symlinks pointing outside the folder all return null.
  function policyFilePath(rel) {
    if (typeof rel !== 'string' || !rel) return null;
    // Absolute in either path flavour, or drive-qualified (Windows `C:foo`).
    if (path.posix.isAbsolute(rel) || path.win32.isAbsolute(rel) || /^[A-Za-z]:/.test(rel)) return null;
    try {
      const base = fs.realpathSync(path.join(dataDir, 'policies'));
      const real = fs.realpathSync(path.resolve(dataDir, rel));
      const inside = path.relative(base, real);
      if (!inside || inside === '..' || inside.startsWith(`..${path.sep}`) || path.isAbsolute(inside)) return null;
      return fs.statSync(real).isFile() ? real : null;
    } catch {
      return null; // missing (or just removed) file or folder; never surface the path
    }
  }

  return { read, write, exists, savePolicyFile, policyFilePath, dataDir };
}
