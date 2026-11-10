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

test.after(async () => {
  await new Promise((resolve) => server.close(resolve));
  fs.rmSync(tmpDir, { recursive: true, force: true });
});
