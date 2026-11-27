import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ps-works-gallery-'));
const wsDir = path.join(tmpDir, 'workspace');
const designHome = path.join(tmpDir, 'baoyu-design');
const stateFile = path.join(tmpDir, 'state.json');
const mockCli = path.join(tmpDir, 'mock-orca-cli.mjs');
const cliLog = path.join(tmpDir, 'cli.log');

fs.mkdirSync(wsDir, { recursive: true });
fs.mkdirSync(designHome, { recursive: true });
fs.writeFileSync(stateFile, JSON.stringify({ workspaceRoot: wsDir, workspaceName: 'workspace', updatedAt: Date.now() }));
fs.writeFileSync(mockCli, `#!/usr/bin/env node
import fs from 'node:fs';
const argv = process.argv.slice(2);
fs.appendFileSync(${JSON.stringify(cliLog)}, JSON.stringify(argv) + '\\n');
if (process.env.MOCK_AGENT_FAIL === '1') {
  console.log(JSON.stringify({ ok: false, error: { message: 'agent busy' } }));
} else {
  console.log(JSON.stringify({ ok: true, result: { outcome: { kind: 'chat' } } }));
}
`, { mode: 0o755 });

process.env.ORCA_DESIGN_HOME = designHome;
process.env.ORCA_STATE_FILE = stateFile;
process.env.ORCA_PROFILE_DB = path.join(tmpDir, 'missing.db');
process.env.ORCA_CLI_COMMAND = mockCli;

const { server, galleryHtml, listArtifactsViews } = await import('../src/gallery-server.mjs');
const port = 39300 + Math.floor(Math.random() * 1000);
await new Promise((resolve, reject) => {
  server.once('error', reject);
  server.listen(port, '127.0.0.1', resolve);
});
const base = `http://127.0.0.1:${port}`;
const post = async (route, body) => {
  const r = await fetch(base + route, {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: base, host: `127.0.0.1:${port}` },
    body: JSON.stringify(body),
  });
  return { status: r.status, json: await r.json() };
};

test('AC-6: design-system singleton (DESIGN_SYSTEM_EXISTS) and duplicate name -2/-3 suffix', async () => {
  const ds1 = await post('/api/create', { skill: 'claude-design-system', name: 'brand-ds' });
  assert.equal(ds1.json.ok, true);
  assert.ok(fs.existsSync(path.join(ds1.json.root, 'project', 'design-system.json')));

  const ds2 = await post('/api/create', { skill: 'claude-design-system', name: 'another-ds' });
  assert.equal(ds2.json.ok, false);
  assert.equal(ds2.json.code, 'DESIGN_SYSTEM_EXISTS');
  assert.equal(ds2.json.root, ds1.json.root);

  const s1 = await post('/api/create', { skill: 'claude-slides', name: 'demo' });
  const s2 = await post('/api/create', { skill: 'claude-slides', name: 'demo' });
  assert.equal(path.basename(s1.json.root), 'demo');
  assert.equal(path.basename(s2.json.root), 'demo-2');
  assert.equal(fs.existsSync(path.join(s1.json.root, 'project', 'deck.json')), true);
  assert.equal(fs.existsSync(path.join(s2.json.root, 'project', 'deck.json')), true);

  const c1 = await post('/api/create', { skill: 'claude-design', name: 'demo-canvas' });
  const c2 = await post('/api/create', { skill: 'claude-design', name: 'demo-canvas' });
  assert.equal(path.basename(c1.json.root), 'demo-canvas');
  assert.equal(path.basename(c2.json.root), 'demo-canvas-2');
});

test('AC-7: pure folder moves to ORCA_DESIGN_HOME/trash (not .design/trash) with restore; mixed folder dismissed without deleting files', async () => {
  const pure = await post('/api/create', { skill: 'claude-slides', name: 'pure-deck' });
  assert.equal(pure.json.ok, true);
  const delPure = await post('/api/delete', { root: pure.json.root });
  assert.equal(delPure.json.ok, true);
  assert.equal(delPure.json.moved, true);
  assert.equal(fs.existsSync(path.join(wsDir, '.design', 'trash')), false, 'must NOT create .design/trash');
  assert.equal(fs.existsSync(delPure.json.path), true, 'moved into ORCA_DESIGN_HOME/trash');
  assert.equal(fs.existsSync(pure.json.root), false);

  const restored = await post('/api/restore', { id: delPure.json.trash });
  assert.equal(restored.json.ok, true);
  assert.equal(fs.existsSync(pure.json.root), true);

  const mixed = await post('/api/create', { skill: 'claude-design', name: 'mixed-canvas' });
  const notesFile = path.join(mixed.json.root, 'notes.txt');
  fs.writeFileSync(notesFile, 'important engineering notes');
  const delMixed = await post('/api/delete', { root: mixed.json.root });
  assert.equal(delMixed.json.ok, true);
  assert.equal(delMixed.json.moved, false);
  assert.equal(fs.existsSync(notesFile), true, 'business files preserved');
  const listed = listArtifactsViews();
  assert.equal(listed.artifacts.some((a) => a.root === mixed.json.root), false, 'dismissed folder does not resurrect');
});

test('AC-8: rename syncs physical directory name (with -2 collision) and JSON title', async () => {
  const created = await post('/api/create', { skill: 'claude-design', name: 'old-name' });
  const r1 = await post('/api/rename', { skill: 'claude-design', root: created.json.root, title: 'New Title' });
  assert.equal(r1.json.ok, true);
  assert.equal(path.basename(r1.json.root), 'New-Title');
  assert.equal(fs.existsSync(created.json.root), false);
  const json1 = JSON.parse(fs.readFileSync(path.join(r1.json.root, 'project', 'canvas.json'), 'utf8'));
  assert.equal(json1.title, 'New Title');

  // Create collision and rename another project to 'New Title' -> 'New-Title-2'
  const second = await post('/api/create', { skill: 'claude-design', name: 'another-proj' });
  const r2 = await post('/api/update', { root: second.json.root, title: 'New Title' });
  assert.equal(r2.json.ok, true);
  assert.equal(path.basename(r2.json.root), 'New-Title-2');

  // Non-static dashboard rename
  const dashRoot = path.join(wsDir, '.design', 'old-dash');
  fs.mkdirSync(path.join(dashRoot, 'db', 'dash'), { recursive: true });
  fs.writeFileSync(path.join(dashRoot, 'db', 'dash', 'meta.json'), JSON.stringify({ title: 'Old Dash', sheets: { s1: {} } }));
  await post('/api/register', { skill: 'claude-dashboard', root: dashRoot, title: 'Old Dash' });
  const rDash = await post('/api/rename', { skill: 'claude-dashboard', root: dashRoot, title: 'Sales Board' });
  assert.equal(rDash.json.ok, true);
  assert.equal(path.basename(rDash.json.root), 'Sales-Board');
  const dashMeta = JSON.parse(fs.readFileSync(path.join(rDash.json.root, 'db', 'dash', 'meta.json'), 'utf8'));
  assert.equal(dashMeta.title, 'Sales Board');
});

test('AC-9: dashboard/motion reject empty scaffold, support /api/start {skill} + clipboard fallback, and UI activeWorkspaceDesignSystem ignores lakala naming', async () => {
  const dashCreate = await post('/api/create', { skill: 'claude-dashboard' });
  assert.equal(dashCreate.json.ok, false);
  const motionCreate = await post('/api/create', { skill: 'claude-motion' });
  assert.equal(motionCreate.json.ok, false);

  const startOk = await post('/api/start', { skill: 'claude-dashboard' });
  assert.equal(startOk.json.ok, true);
  assert.equal(startOk.json.outcome, 'chat');

  process.env.MOCK_AGENT_FAIL = '1';
  const startFail = await post('/api/start', { skill: 'claude-motion' });
  assert.equal(startFail.json.ok, false);
  assert.equal(startFail.json.fallback, 'clipboard');
  assert.ok(startFail.json.starter.length > 0);
  delete process.env.MOCK_AGENT_FAIL;

  // Check UI script activeWorkspaceDesignSystem works for non-lakala named design system & openCreateDialog renders sendAgentPromptBtn
  const html = galleryHtml('zh');
  const script = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)][1][1];
  const ids = new Map();
  const makeEl = (id) => {
    const el = {
      id,
      className: '',
      style: {},
      dataset: {},
      textContent: '',
      value: '',
      disabled: false,
      _innerHTML: '',
      setAttribute() {},
      getAttribute() { return ''; },
      removeAttribute() {},
      addEventListener() {},
      focus() {},
      select() {},
      querySelectorAll: () => [],
      querySelector: () => null,
      classList: { add() {}, remove() {}, contains: () => false },
    };
    Object.defineProperty(el, 'innerHTML', {
      get: () => el._innerHTML,
      set: (v) => {
        el._innerHTML = String(v);
        for (const m of el._innerHTML.matchAll(/\bid="([^"]+)"/g)) {
          if (!ids.has(m[1])) ids.set(m[1], makeEl(m[1]));
        }
      },
    });
    if (id) ids.set(id, el);
    return el;
  };
  for (const m of html.replace(/<script>[\s\S]*?<\/script>/g, '').matchAll(/\bid="([^"]+)"/g)) makeEl(m[1]);
  const document = {
    documentElement: makeEl('html'),
    body: makeEl('body'),
    getElementById: (id) => ids.get(id) || null,
    querySelector: () => makeEl('q'),
    querySelectorAll: () => [],
  };
  let copiedText = '';
  const ctx = vm.createContext({
    window: { document, addEventListener() {} },
    document,
    location: { search: '', hash: '', pathname: '/', port: String(port) },
    history: { replaceState() {}, pushState() {} },
    fetch: (route, opts) => fetch(base + route, opts),
    navigator: { clipboard: { writeText: async (txt) => { copiedText = txt; } } },
    localStorage: { getItem: () => null, setItem() {} },
    setTimeout,
    clearTimeout,
    URL,
    URLSearchParams,
    Intl,
    Map,
    Set,
    Promise,
    Date,
    Object,
    Array,
    JSON,
    Math,
    Number,
    String,
    Boolean,
    RegExp,
    encodeURIComponent,
  });
  vm.runInContext(script, ctx);
  await new Promise((r) => setTimeout(r, 80));

  const activeDs = vm.runInContext('activeWorkspaceDesignSystem()', ctx);
  assert.ok(activeDs, 'activeWorkspaceDesignSystem finds non-lakala brand-ds');
  assert.equal(activeDs.title, 'brand-ds');

  vm.runInContext("openCreateDialog('claude-dashboard')", ctx);
  assert.ok(ids.get('sendAgentPromptBtn'), 'dashboard modal renders #sendAgentPromptBtn');
  assert.equal(ids.get('createScaffoldBtn'), undefined, 'dashboard modal must NOT render scaffold button');
  process.env.MOCK_AGENT_FAIL = '1';
  await ids.get('sendAgentPromptBtn').onclick();
  assert.ok(copiedText.length > 0, 'failed agent send copies prompt draft to clipboard');
  delete process.env.MOCK_AGENT_FAIL;

  // Thumb 404 check
  const thumbRes = await fetch(`${base}/api/thumb?root=${encodeURIComponent(wsDir + '/.design/New-Title')}`);
  assert.equal(thumbRes.status, 404);
});

test('Review fixes: mixed-folder undo survives second deletion, stale unresolved focus stays locked, and read-only mutations return 403', async () => {
  // 1. Mixed-folder undo metadata survives deleting a second project
  const mixed1 = await post('/api/create', { skill: 'claude-design', name: 'mixed-undo-1' });
  fs.writeFileSync(path.join(mixed1.json.root, 'keep.txt'), 'keep me');
  const pure2 = await post('/api/create', { skill: 'claude-slides', name: 'pure-undo-2' });

  const delMixed1 = await post('/api/delete', { root: mixed1.json.root });
  assert.equal(delMixed1.json.ok, true);
  assert.equal(delMixed1.json.moved, false);
  const delPure2 = await post('/api/delete', { root: pure2.json.root });
  assert.equal(delPure2.json.ok, true);

  const restoreMixed1 = await post('/api/restore', { id: delMixed1.json.trash });
  assert.equal(restoreMixed1.json.ok, true, 'mixed-folder undo survives subsequent delete');

  // 2. Stale unresolved NO_WORKSPACE state does not revive stale PROFILE_DB and blocks HTTP mutations
  const staleErrTime = Date.now() - 60_000;
  fs.writeFileSync(stateFile, JSON.stringify({
    workspaceRoot: '',
    workspaceName: '',
    errorCode: 'NO_WORKSPACE',
    errorMessage: 'no workspace',
    updatedAt: staleErrTime,
  }));
  const listRes = await (await fetch(`${base}/api/list`)).json();
  assert.equal(listRes.workspaceRoot, '');
  assert.equal(listRes.workspaceError?.code, 'NO_WORKSPACE');

  const delBlocked = await post('/api/delete', { root: mixed1.json.root });
  assert.equal(delBlocked.status, 403);
  assert.equal(delBlocked.json.code, 'NO_WORKSPACE');
  const updBlocked = await post('/api/update', { root: mixed1.json.root, pinned: true });
  assert.equal(updBlocked.status, 403);
  assert.equal(updBlocked.json.code, 'NO_WORKSPACE');

  // Restore valid workspace state for cleanup
  fs.writeFileSync(stateFile, JSON.stringify({ workspaceRoot: wsDir, workspaceName: 'workspace', updatedAt: Date.now() }));
});

test.after(async () => {
  await new Promise((resolve) => server.close(resolve));
  fs.rmSync(tmpDir, { recursive: true, force: true });
});
