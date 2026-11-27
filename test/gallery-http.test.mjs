import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ps-gallery-http-'));
const wsDir = path.join(tmpDir, 'workspace');
const designHome = path.join(tmpDir, 'baoyu-design');
const profileDb = path.join(tmpDir, 'profile-state.db');
fs.mkdirSync(wsDir, { recursive: true });
fs.mkdirSync(designHome, { recursive: true });

execFileSync('sqlite3', [profileDb,
  'CREATE TABLE profile_state_documents (domain TEXT PRIMARY KEY, payload TEXT NOT NULL);'
  + " INSERT INTO profile_state_documents VALUES ('settings', '{\"theme\":\"dark\"}');"
  + " INSERT INTO profile_state_documents VALUES ('workspaceSession', '{\"activeWorktreeId\":\"x::" + wsDir + "\"}');"
]);

const stateFile = path.join(tmpDir, 'prototype-studio-state.json');
process.env.ORCA_STATE_FILE = stateFile;
process.env.ORCA_DESIGN_HOME = designHome;
process.env.ORCA_PROFILE_DB = profileDb;
process.env.ORCA_CLI_COMMAND = path.join(tmpDir, 'mock-orca-cli');
fs.writeFileSync(process.env.ORCA_CLI_COMMAND, '#!/bin/sh\necho \'{}\'\n', { mode: 0o755 });
fs.writeFileSync(stateFile, JSON.stringify({
  workspaceRoot: wsDir, workspaceName: 'test-workspace',
}));

const { server, galleryHtml } = await import('../src/gallery-server.mjs');
const port = 39000 + Math.floor(Math.random() * 2000);
await new Promise((resolve, reject) => {
  server.once('error', reject);
  server.listen(port, '127.0.0.1', resolve);
});

const base = `http://127.0.0.1:${port}`;
const hit = async (route, { method = 'GET', headers = {}, body = '' } = {}) => {
  const r = await fetch(base + route, { method, headers, body: method === 'GET' ? undefined : body });
  return { status: r.status, text: await r.text() };
};
const postHeaders = (extra = {}) => ({
  'content-type': 'application/json',
  origin: base,
  host: `127.0.0.1:${port}`,
  ...extra,
});

test('GET state-changing routes are closed', async () => {
  assert.equal((await hit('/api/open?skill=claude-design')).status, 404);
  assert.equal((await hit('/api/open-url?skill=claude-design')).status, 404);
  assert.equal((await hit('/api/delete?root=/tmp')).status, 404);
  assert.equal((await hit('/api/rename?root=/tmp&title=x')).status, 404);
  assert.equal((await hit('/api/create?skill=claude-slides')).status, 404);
  assert.equal((await hit('/api/update?root=/tmp&title=x')).status, 404);
});

test('POST guard rejects cross-site simple and JSON requests', async () => {
  const body = JSON.stringify({ skill: 'claude-design' });
  assert.equal((await hit('/api/delete', {
    method: 'POST', headers: { 'content-type': 'text/plain', origin: 'http://evil.example' }, body,
  })).status, 415);
  assert.equal((await hit('/api/delete', {
    method: 'POST', headers: { ...postHeaders(), origin: 'http://evil.example' }, body,
  })).status, 403);
});

test('oversized POST returns 413 instead of dropping the socket', async () => {
  const big = JSON.stringify({ skill: 'claude-design', root: 'x'.repeat(70000) });
  const r = await hit('/api/register', { method: 'POST', headers: postHeaders(), body: big });
  assert.equal(r.status, 413);
  assert.equal(r.text, '{}');
});

test('valid POST reaches the handler without launching a missing editor', async () => {
  // Unknown skill fails before execFile(artifact.mjs), so the test stays hermetic.
  const r = await hit('/api/open', {
    method: 'POST', headers: postHeaders(), body: JSON.stringify({ skill: 'not-a-skill' }),
  });
  assert.equal(r.status, 400);
  assert.match(r.text, /unknown skill/);
});

test('host theme is injected into the first paint', () => {
  assert.match(galleryHtml('zh'), /data-host-scheme="dark"/);
  assert.match(galleryHtml('en', 'light'), /data-host-scheme="light"/);
});

test('POST /api/create, GET /api/preview wrapper, and POST /api/forget allMissing work over HTTP', async () => {
  fs.writeFileSync(stateFile, JSON.stringify({
    workspaceRoot: wsDir,
    workspaceName: 'test-workspace',
    updatedAt: Date.now(),
  }));
  const created = await hit('/api/create', {
    method: 'POST',
    headers: postHeaders(),
    body: JSON.stringify({ skill: 'claude-slides' }),
  });
  assert.equal(created.status, 200);
  const createdJson = JSON.parse(created.text);
  assert.equal(createdJson.ok, true);
  assert.equal(createdJson.problems, 0);

  const preview = await hit(`/api/preview?skill=claude-slides&root=${encodeURIComponent(createdJson.root)}`);
  assert.equal(preview.status, 200);
  assert.match(preview.text, /<!doctype html>/i);
  assert.match(preview.text, /slide-stage/);

  fs.rmSync(createdJson.root, { recursive: true, force: true });
  const cleared = await hit('/api/forget', {
    method: 'POST',
    headers: postHeaders(),
    body: JSON.stringify({ allMissing: true }),
  });
  assert.equal(cleared.status, 200);
  assert.deepEqual(JSON.parse(cleared.text), { ok: true, removed: 1 });
});

test('GET /api/health identifies orca-plugin-design on 127.0.0.1', async () => {
  assert.equal(server.address().address, '127.0.0.1');
  const r = await hit('/api/health');
  assert.equal(r.status, 200);
  const data = JSON.parse(r.text);
  assert.equal(data.ok, true);
  assert.equal(data.app, 'orca-plugin-design');
  assert.equal(typeof data.buildId, 'string');
  assert.equal(data.pid, process.pid);
  assert.equal(data.port, port);
});

test('chunked POST exceeding 64KiB UTF-8 bytes returns 413 {}', async () => {
  const http = await import('node:http');
  const multiByte = '中'.repeat(25000); // 75000 bytes in UTF-8, 25000 UTF-16 chars
  const payload = JSON.stringify({ skill: 'claude-design', root: multiByte });
  const r = await new Promise((resolve, reject) => {
    const req = http.request({
      hostname: '127.0.0.1',
      port,
      path: '/api/register',
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        origin: base,
        host: `127.0.0.1:${port}`,
        'transfer-encoding': 'chunked',
      },
    }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, text: Buffer.concat(chunks).toString('utf8') }));
    });
    req.on('error', reject);
    req.write(payload.slice(0, 10000));
    req.write(payload.slice(10000));
    req.end();
  });
  assert.equal(r.status, 413);
  assert.equal(r.text, '{}');
});

test('path traversal, symlink escapes, and forged artifact records are blocked on all endpoints', async () => {
  fs.writeFileSync(stateFile, JSON.stringify({
    workspaceRoot: wsDir,
    workspaceName: 'test-workspace',
    updatedAt: Date.now(),
  }));
  const outsideDir = path.join(tmpDir, 'outside-secret');
  fs.mkdirSync(path.join(outsideDir, 'project'), { recursive: true });
  fs.writeFileSync(path.join(outsideDir, 'project', 'canvas.json'), JSON.stringify({ title: 'Secret' }));
  fs.writeFileSync(path.join(outsideDir, 'project', 'secret.html'), '<h1>secret</h1>');

  const designDir = path.join(wsDir, '.design');
  fs.mkdirSync(designDir, { recursive: true });
  const symlinkLeaf = path.join(designDir, 'escape-leaf');
  fs.symlinkSync(outsideDir, symlinkLeaf);

  const intermediateDir = path.join(tmpDir, 'outside-parent');
  const intermediateTarget = path.join(intermediateDir, 'child-work');
  fs.mkdirSync(path.join(intermediateTarget, 'project'), { recursive: true });
  fs.writeFileSync(path.join(intermediateTarget, 'project', 'canvas.json'), JSON.stringify({ title: 'Mid' }));
  const symlinkParent = path.join(designDir, 'escape-parent');
  fs.symlinkSync(intermediateDir, symlinkParent);
  const intermediateChild = path.join(symlinkParent, 'child-work');

  // Pre-seed forged artifact records pointing to outside/symlink paths
  const crypto = await import('node:crypto');
  const seedForged = (forgedRoot) => {
    const hash = crypto.createHash('sha256').update(forgedRoot).digest('hex').slice(0, 24);
    const artifactsDir = path.join(designHome, 'artifacts');
    fs.mkdirSync(artifactsDir, { recursive: true });
    fs.writeFileSync(path.join(artifactsDir, `${hash}.json`), JSON.stringify({
      v: 1,
      root: forgedRoot,
      skill: 'claude-design',
      title: 'Forged',
      openedAt: new Date().toISOString(),
    }));
  };
  seedForged(symlinkLeaf);
  seedForged(intermediateChild);

  const traversal = path.join(designDir, '..', '..', 'outside-secret');
  for (const badRoot of [traversal, symlinkLeaf, intermediateChild]) {
    const pRes = await hit(`/api/preview?skill=claude-design&root=${encodeURIComponent(badRoot)}`);
    assert.equal(pRes.status, 403, `preview blocked for ${badRoot}`);

    const tRes = await hit(`/api/thumb?root=${encodeURIComponent(badRoot)}`);
    assert.equal(tRes.status, 403, `thumb blocked for ${badRoot}`);

    const oRes = await hit('/api/open', {
      method: 'POST', headers: postHeaders(), body: JSON.stringify({ skill: 'claude-design', root: badRoot }),
    });
    assert.equal(oRes.status, 400, `open blocked for ${badRoot}`);

    const dRes = await hit('/api/delete', {
      method: 'POST', headers: postHeaders(), body: JSON.stringify({ root: badRoot }),
    });
    assert.equal(dRes.status, 403, `delete blocked for ${badRoot}`);

    const rRes = await hit('/api/rename', {
      method: 'POST', headers: postHeaders(), body: JSON.stringify({ skill: 'claude-design', root: badRoot, title: 'Hacked' }),
    });
    assert.equal(rRes.status, 400, `rename blocked for ${badRoot}`);

    const uRes = await hit('/api/update', {
      method: 'POST', headers: postHeaders(), body: JSON.stringify({ root: badRoot, title: 'Hacked' }),
    });
    assert.equal(uRes.status, 403, `update blocked for ${badRoot}`);

    const regRes = await hit('/api/register', {
      method: 'POST', headers: postHeaders(), body: JSON.stringify({ skill: 'claude-design', root: badRoot }),
    });
    assert.equal(regRes.status, 400, `register blocked for ${badRoot}`);

    const ouRes = await hit('/api/open-url', {
      method: 'POST', headers: postHeaders(), body: JSON.stringify({ skill: 'claude-design', root: badRoot }),
    });
    assert.equal(ouRes.status, 400, `open-url blocked for ${badRoot}`);
  }
  assert.equal(fs.existsSync(path.join(outsideDir, 'project', 'canvas.json')), true, 'outside files untouched');
  assert.equal(fs.existsSync(path.join(intermediateTarget, 'project', 'canvas.json')), true, 'intermediate files untouched');
});

test.after(async () => {
  await new Promise((resolve) => server.close(resolve));
  fs.rmSync(tmpDir, { recursive: true, force: true });
});
