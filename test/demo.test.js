// Demo-mode isolation: `npm run demo` must serve a throwaway copy of
// sample-data/ and keep every write (JSON, .bak files, the markdown mirror)
// inside .demo-data/, even when DATA_DIR and MIRROR_DIR are exported in the
// parent shell. Real mode must keep honouring both variables. The "real"
// folders here are temp decoys created by the test, never a user's own.
// Note: the demo test rewrites the throwaway .demo-data/ folder, exactly as
// `npm run demo` does.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { MARKER } from '../lib/mirror.js';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const demoDir = path.join(root, '.demo-data');
const sampleDir = path.join(root, 'sample-data');
const tmp = (prefix) => fs.mkdtempSync(path.join(os.tmpdir(), prefix));

// Hash of every file (path + bytes) under a directory, for "nothing changed" checks.
function treeHash(dir) {
  const h = crypto.createHash('sha256');
  const walk = (d) => {
    for (const entry of fs.readdirSync(d, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const full = path.join(d, entry.name);
      h.update(path.relative(dir, full));
      if (entry.isDirectory()) walk(full);
      else h.update(fs.readFileSync(full));
    }
  };
  walk(dir);
  return h.digest('hex');
}

function freePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.once('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
  });
}

// Start a script with the given env, wait until it is listening, return a
// handle with the base URL and a stop() that resolves once the process exits.
// A failed start kills the child before rejecting, so nothing is left running.
async function start(script, extraEnv) {
  const port = await freePort();
  const child = spawn(process.execPath, [script], {
    cwd: root,
    env: { ...process.env, ...extraEnv, PORT: String(port) },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  const exited = new Promise((resolve) => child.once('exit', resolve));
  const stop = async () => {
    if (child.exitCode === null && child.signalCode === null) child.kill();
    const timeout = new Promise((resolve) => setTimeout(resolve, 5000, 'timeout'));
    if ((await Promise.race([exited, timeout])) === 'timeout') {
      child.kill('SIGKILL');
      await exited;
    }
  };
  let out = '';
  try {
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`server did not start:\n${out}`)), 15000);
      child.stdout.on('data', (d) => {
        out += d;
        if (out.includes('mirror directory:')) { clearTimeout(timer); resolve(); }
      });
      child.stderr.on('data', (d) => { out += d; });
      child.once('error', (err) => { clearTimeout(timer); reject(err); });
      exited.then((code) => { clearTimeout(timer); reject(new Error(`exited ${code}:\n${out}`)); });
    });
  } catch (err) {
    await stop();
    throw err;
  }
  return { base: `http://127.0.0.1:${port}`, stop };
}

test('demo mode isolates data and mirror writes from inherited DATA_DIR / MIRROR_DIR', async () => {
  const decoyData = tmp('tripfolio-decoy-data-');
  fs.writeFileSync(path.join(decoyData, 'trips.json'), JSON.stringify([{ id: 'trip_decoy', name: 'DECOY REAL TRIP' }]));
  const decoyMirror = tmp('tripfolio-decoy-mirror-');
  // A previously generated note: the mirror's stale-note cleanup would delete it if the demo wrote here.
  fs.writeFileSync(path.join(decoyMirror, 'Old Trip.md'), `${MARKER}\nreal mirror note\n`);
  const before = { sample: treeHash(sampleDir), data: treeHash(decoyData), mirror: treeHash(decoyMirror) };

  const post = (base, body) => fetch(`${base}/api/travelers`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  let server;
  try {
    try {
      server = await start(path.join('scripts', 'demo.js'), { DATA_DIR: decoyData, MIRROR_DIR: decoyMirror });
      const health = await (await fetch(`${server.base}/api/health`)).json();
      assert.equal(path.resolve(health.dataDir), demoDir);
      assert.equal(path.resolve(health.mirrorDir), path.join(demoDir, 'mirror'));

      const trips = await (await fetch(`${server.base}/api/trips`)).json();
      assert.ok(!trips.some((t) => t.id === 'trip_decoy'), 'demo must not read the inherited DATA_DIR');

      // A write: updates the JSON (leaving a .bak) and regenerates the mirror.
      const res = await post(server.base, { name: 'Demo Tester' });
      assert.ok(res.ok, `write failed: ${res.status}`);
      assert.ok(fs.readFileSync(path.join(demoDir, 'travelers.json'), 'utf8').includes('Demo Tester'));
      assert.ok(fs.existsSync(path.join(demoDir, 'travelers.json.bak')));
      assert.ok(fs.readdirSync(path.join(demoDir, 'mirror')).some((f) => f.endsWith('.md')));

      // Pointing the in-app mirror setting at the decoy must not redirect the
      // demo's mirror: the forced MIRROR_DIR wins over settings.mirrorDir.
      const settings = await (await fetch(`${server.base}/api/settings`)).json();
      const put = await fetch(`${server.base}/api/settings`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...settings, mirrorDir: decoyMirror })
      });
      assert.ok(put.ok, `settings write failed: ${put.status}`);
      assert.ok((await post(server.base, { name: 'Second Tester' })).ok);
      const after = await (await fetch(`${server.base}/api/health`)).json();
      assert.equal(path.resolve(after.mirrorDir), path.join(demoDir, 'mirror'));
    } finally {
      await server?.stop();
    }
    assert.equal(treeHash(sampleDir), before.sample, 'committed sample-data/ must be untouched');
    assert.equal(treeHash(decoyData), before.data, 'inherited DATA_DIR must be untouched');
    assert.equal(treeHash(decoyMirror), before.mirror, 'inherited MIRROR_DIR must be untouched');
  } finally {
    fs.rmSync(decoyData, { recursive: true, force: true });
    fs.rmSync(decoyMirror, { recursive: true, force: true });
  }
});

test('real mode still honours DATA_DIR and MIRROR_DIR', async () => {
  const dataDir = tmp('tripfolio-data-');
  const mirrorDir = tmp('tripfolio-mirror-');
  let server;
  try {
    server = await start('server.js', { DATA_DIR: dataDir, MIRROR_DIR: mirrorDir });
    const health = await (await fetch(`${server.base}/api/health`)).json();
    assert.equal(path.resolve(health.dataDir), path.resolve(dataDir));
    assert.equal(path.resolve(health.mirrorDir), path.resolve(mirrorDir));
  } finally {
    await server?.stop();
    fs.rmSync(dataDir, { recursive: true, force: true });
    fs.rmSync(mirrorDir, { recursive: true, force: true });
  }
});
