// Policy documents are served only from DATA_DIR/policies/. A policy record's
// pdfPath is editable through the generic collection API, so it must not be
// able to name any other file. Every "outside" file here is a temp decoy.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createStore } from '../lib/store.js';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const tmp = (prefix) => fs.mkdtempSync(path.join(os.tmpdir(), prefix));
const PDF = Buffer.from('%PDF-1.4\n% tripfolio test document\n%%EOF\n');
const SECRET = 'DECOY-SECRET-DO-NOT-SERVE';

// A data dir with one uploaded policy file, plus decoys outside policies/.
function setup() {
  const dataDir = tmp('tripfolio-policy-data-');
  const outside = tmp('tripfolio-policy-outside-');
  const store = createStore(dataDir);
  const uploaded = store.savePolicyFile('my policy.pdf', PDF.toString('base64'));
  fs.writeFileSync(path.join(outside, 'secret.txt'), SECRET);
  fs.writeFileSync(path.join(dataDir, 'secret-in-data.txt'), SECRET);
  const cleanup = () => {
    fs.rmSync(dataDir, { recursive: true, force: true });
    fs.rmSync(outside, { recursive: true, force: true });
  };
  return { dataDir, outside, store, uploaded, cleanup };
}

test('policyFilePath resolves an uploaded policy document', () => {
  const { store, uploaded, cleanup } = setup();
  try {
    const file = store.policyFilePath(uploaded);
    assert.ok(file);
    assert.deepEqual(fs.readFileSync(file), PDF);
  } finally {
    cleanup();
  }
});

test('policyFilePath accepts a real file whose name merely starts with ".."', () => {
  const { dataDir, store, cleanup } = setup();
  try {
    fs.writeFileSync(path.join(dataDir, 'policies', '..odd-name.pdf'), PDF);
    assert.ok(store.policyFilePath(path.join('policies', '..odd-name.pdf')));
  } finally {
    cleanup();
  }
});

test('policyFilePath rejects paths outside DATA_DIR/policies/', () => {
  const { dataDir, outside, store, cleanup } = setup();
  try {
    const absolute = path.join(outside, 'secret.txt');
    const rejected = [
      absolute,                                                      // absolute path
      path.relative(dataDir, absolute),                              // ../ out of DATA_DIR
      path.join('policies', '..', 'secret-in-data.txt'),             // inside DATA_DIR, outside policies/
      'secret-in-data.txt',                                          // DATA_DIR root
      'policies',                                                    // the folder itself
      path.join('policies', 'missing.pdf'),                          // does not exist
      'policies/../secret-in-data.txt',                              // forward-slash traversal
      'C:secret.txt', 'c:/secret.txt',                               // Windows drive-qualified
      '\\\\server\\share\\secret.txt',                               // UNC
      '/etc/passwd',                                                 // POSIX absolute
      '', null, undefined, 42
    ];
    for (const rel of rejected) assert.equal(store.policyFilePath(rel), null, `should reject ${String(rel)}`);
  } finally {
    cleanup();
  }
});

test('policyFilePath rejects a symlink in policies/ that points outside', (t) => {
  const { dataDir, outside, store, cleanup } = setup();
  try {
    const link = path.join(dataDir, 'policies', 'link.pdf');
    try {
      fs.symlinkSync(path.join(outside, 'secret.txt'), link, 'file');
    } catch (err) {
      if (err.code === 'EPERM') return t.skip('creating symlinks needs extra privileges on this system');
      throw err;
    }
    assert.equal(store.policyFilePath(path.join('policies', 'link.pdf')), null);
  } finally {
    cleanup();
  }
});

// Directory links: a junction on Windows (no special privilege needed), a
// directory symlink elsewhere. Same escape, through a linked folder.
test('policyFilePath rejects a file reached through a linked folder pointing outside', () => {
  const { dataDir, outside, store, cleanup } = setup();
  try {
    fs.symlinkSync(outside, path.join(dataDir, 'policies', 'linked'), process.platform === 'win32' ? 'junction' : 'dir');
    assert.equal(store.policyFilePath(path.join('policies', 'linked', 'secret.txt')), null);
  } finally {
    cleanup();
  }
});

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

// Start server.js on a temp DATA_DIR; resolves with the base URL and a stop().
async function startServer(dataDir) {
  const port = await freePort();
  const child = spawn(process.execPath, ['server.js'], {
    cwd: root,
    env: { ...process.env, DATA_DIR: dataDir, MIRROR_DIR: path.join(dataDir, 'mirror'), PORT: String(port) },
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

test('the API serves uploaded policy documents and refuses edited out-of-folder paths', async () => {
  const dataDir = tmp('tripfolio-policy-api-');
  const outside = tmp('tripfolio-policy-outside-');
  const secretFile = path.join(outside, 'secret.txt');
  fs.writeFileSync(secretFile, SECRET);
  const json = (method, body) => ({ method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  let server;
  try {
    server = await startServer(dataDir);
    const created = await (await fetch(`${server.base}/api/policies`, json('POST', {
      insurer: 'Test Insurer', policyNumber: 'TEST-0001', type: 'annual', startDate: '2026-01-01', endDate: '2026-12-31', travelerIds: []
    }))).json();
    assert.ok(created.id, `policy not created: ${JSON.stringify(created)}`);

    // Legitimate upload, then download returns the same bytes.
    const up = await fetch(`${server.base}/api/policies/${created.id}/pdf`,
      json('POST', { filename: 'policy.pdf', content: PDF.toString('base64') }));
    assert.ok(up.ok, `upload failed: ${up.status}`);
    const down = await fetch(`${server.base}/api/policies/${created.id}/pdf`);
    assert.equal(down.status, 200);
    assert.deepEqual(Buffer.from(await down.arrayBuffer()), PDF);

    // Edit pdfPath through the generic API to escape the folder, both ways.
    for (const pdfPath of [secretFile, path.relative(dataDir, secretFile)]) {
      const patched = await fetch(`${server.base}/api/policies/${created.id}`, json('PATCH', { pdfPath }));
      assert.ok(patched.ok, `patch failed: ${patched.status}`);
      const res = await fetch(`${server.base}/api/policies/${created.id}/pdf`);
      const body = await res.text();
      assert.equal(res.status, 404, `should refuse ${pdfPath}`);
      assert.ok(!body.includes(SECRET), 'decoy content must not be served');
    }
  } finally {
    await server?.stop();
    fs.rmSync(dataDir, { recursive: true, force: true });
    fs.rmSync(outside, { recursive: true, force: true });
  }
});
