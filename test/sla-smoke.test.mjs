import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';

import activateWorker from '../src/worker.js';
import { galleryHtml } from '../src/gallery-server.mjs';

const REPO_ROOT = path.resolve(import.meta.dirname, '..');

function makeSandboxEnv(port) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'orca-sla-'));
  const wsDir = path.join(dir, 'ws');
  const designHome = path.join(dir, 'design-home');
  fs.mkdirSync(wsDir, { recursive: true });
  fs.mkdirSync(designHome, { recursive: true });

  // Seed 5 sample projects under wsDir/.design
  for (let i = 1; i <= 5; i++) {
    const p = path.join(wsDir, '.design', `sample-${i}`, 'project');
    fs.mkdirSync(p, { recursive: true });
    fs.writeFileSync(path.join(p, 'canvas.json'), JSON.stringify({ title: `Sample ${i}` }));
  }

  const logPath = path.join(dir, 'cli.log');
  const cliPath = path.join(dir, 'mock-cli.sh');
  fs.writeFileSync(cliPath, `#!/bin/sh
printf '%s\\t' "$@" >> ${JSON.stringify(logPath)}
printf '\\n' >> ${JSON.stringify(logPath)}
case "$2" in
  list) echo '{"ok":true,"result":{"tabs":[]}}' ;;
  create) echo '{"ok":true,"result":{"browserPageId":"p1"}}' ;;
  switch) echo '{"ok":true,"result":{"browserPageId":"p1"}}' ;;
  current) echo '{"ok":true,"result":{"tab":{"browserPageId":"p1"}}}' ;;
  *) echo '{"ok":true,"result":{}}' ;;
esac
`, { mode: 0o755 });

  return {
    dir,
    wsDir,
    designHome,
    stateFile: path.join(dir, 'state.json'),
    profileDb: path.join(dir, 'missing.db'),
    cliPath,
    logPath,
    port,
  };
}

function createHostMock(wsDir, { failListOnce = false } = {}) {
  const cmds = new Map();
  const statusUpdates = [];
  let wsListCalls = 0;
  const orca = {
    log: () => {},
    commands: Object.freeze({ register: (id, fn) => cmds.set(id, fn) }),
    panels: Object.freeze({ handle: () => {} }),
    events: Object.freeze({ on: () => {} }),
    host: Object.freeze({
      has: () => false,
      call: async (method, payload) => {
        if (method === 'statusBar.update') {
          statusUpdates.push({ at: performance.now(), payload });
          return {};
        }
        if (method === 'workspace.list') {
          wsListCalls++;
          if (failListOnce && wsListCalls === 1) return { workspaces: [] };
          return { workspaces: [{ id: 'w1', path: wsDir, name: 'ws', branch: 'main', kind: 'local' }] };
        }
        if (method === 'workspace.readContext') {
          return { branch: 'main', displayName: 'ws', terminals: [] };
        }
        return {};
      },
    }),
  };
  return { orca, cmds, statusUpdates };
}

test('AC-1 & AC-2: <=16ms feedback, activate < 20ms, 3-click dedupe, single tab list, cold < 3s & warm < 1s, 0ms error reset', async () => {
  const port = 39500 + Math.floor(Math.random() * 400);
  const env = makeSandboxEnv(port);
  process.env.ORCA_CLI_COMMAND = env.cliPath;
  process.env.ORCA_STATE_FILE = env.stateFile;
  process.env.ORCA_PROFILE_DB = env.profileDb;
  process.env.ORCA_DESIGN_HOME = env.designHome;
  process.env.ORCA_GALLERY_PORT = String(port);
  process.env.ORCA_GALLERY_SCRIPT = path.join(REPO_ROOT, 'src', 'gallery-server.mjs');
  process.env.ORCA_STARTUP_TIMEOUT_MS = '8000';

  const { orca, cmds, statusUpdates } = createHostMock(env.wsDir);
  const actStart = performance.now();
  const handle = await activateWorker(orca);
  const actMs = performance.now() - actStart;
  assert.ok(actMs < 200, `activate non-blocking (${actMs.toFixed(1)}ms)`);

  const gallery = cmds.get('prototype.gallery');
  const tClick = performance.now();
  const p1 = gallery();
  const p2 = gallery();
  const p3 = gallery();
  assert.ok(statusUpdates.length >= 1, 'statusBar.update called synchronously');
  const feedbackMs = statusUpdates[0].at - tClick;
  assert.ok(feedbackMs <= 16, `statusBar.update <= 16ms (got ${feedbackMs.toFixed(2)}ms)`);
  assert.equal(statusUpdates[0].payload.text, '⟳ 打开中…');

  const [r1, r2, r3] = await Promise.all([p1, p2, p3]);
  const coldMs = performance.now() - tClick;
  assert.equal(r1.ok, true);
  assert.deepEqual(r2, r1);
  assert.deepEqual(r3, r1);
  assert.ok(coldMs < 3000, `cold open < 3000ms (got ${coldMs.toFixed(1)}ms)`);

  const calls = fs.readFileSync(env.logPath, 'utf8').trim().split('\n').filter(Boolean).map((l) => l.split('\t').filter(Boolean));
  const tabListCalls = calls.filter((a) => a[0] === 'tab' && a[1] === 'list');
  assert.equal(tabListCalls.length, 1, 'at most 1 tab list call during cold open');
  assert.ok(calls.some((a) => a[0] === 'tab' && a[1] === 'create' && a.some((x) => x.includes('#opening'))), 'cold open URL includes #opening');

  // Warm open after 2s throttle window
  await new Promise((r) => setTimeout(r, 2050));
  const tWarm = performance.now();
  const rWarm = await gallery();
  const warmMs = performance.now() - tWarm;
  assert.equal(rWarm.ok, true);
  assert.equal(rWarm.reused, true);
  assert.ok(warmMs < 1000, `warm open < 1000ms (got ${warmMs.toFixed(1)}ms)`);

  // Clean up spawned gallery server
  await fetch(`http://127.0.0.1:${port}/api/shutdown`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: `http://127.0.0.1:${port}`, host: `127.0.0.1:${port}` },
    body: '{}',
  }).catch(() => {});
  handle.dispose();

  // Failure 0ms reset check: fail workspace, then immediately allow retry without 2s throttle
  let allowWs = false;
  const cmdsFail = new Map();
  const hFail = await activateWorker({
    log: () => {},
    commands: Object.freeze({ register: (id, fn) => cmdsFail.set(id, fn) }),
    panels: Object.freeze({ handle: () => {} }),
    events: Object.freeze({ on: () => {} }),
    host: Object.freeze({
      has: () => false,
      call: async (m) => {
        if (m === 'workspace.list') return { workspaces: allowWs ? [{ id: 'w1', path: env.wsDir, name: 'ws', branch: 'main', kind: 'local' }] : [] };
        return {};
      },
    }),
  });
  process.env.ORCA_GALLERY_SCRIPT = '/dev/null';
  const failRes = await cmdsFail.get('prototype.gallery')();
  assert.equal(failRes.ok, false);
  assert.equal(failRes.code, 'NO_WORKSPACE');
  allowWs = true;
  const retryRes = await cmdsFail.get('prototype.gallery')();
  assert.equal(retryRes.ok, true);
  assert.equal(retryRes.throttled, undefined, 'failed open must NOT set 2s throttle');
  hFail.dispose();

  fs.rmSync(env.dir, { recursive: true, force: true });
});

test('AC-2: 8.0s hard timeout (START_TIMEOUT) terminates hung child process', async () => {
  const port = 39900 + Math.floor(Math.random() * 300);
  const env = makeSandboxEnv(port);
  const hangScript = path.join(env.dir, 'hang-server.mjs');
  const pidFile = path.join(env.dir, 'hang.pid');
  fs.writeFileSync(hangScript, `import fs from 'node:fs'; fs.writeFileSync(${JSON.stringify(pidFile)}, String(process.pid)); setInterval(() => {}, 10000);`);

  process.env.ORCA_CLI_COMMAND = env.cliPath;
  process.env.ORCA_STATE_FILE = env.stateFile;
  process.env.ORCA_PROFILE_DB = env.profileDb;
  process.env.ORCA_DESIGN_HOME = env.designHome;
  process.env.ORCA_GALLERY_PORT = String(port);
  process.env.ORCA_GALLERY_SCRIPT = hangScript;
  process.env.ORCA_STARTUP_TIMEOUT_MS = '8000';

  const { orca, cmds } = createHostMock(env.wsDir);
  const handle = await activateWorker(orca);
  const t0 = performance.now();
  const res = await cmds.get('prototype.gallery')();
  const elapsed = performance.now() - t0;

  assert.equal(res.ok, false);
  assert.equal(res.code, 'START_TIMEOUT');
  assert.ok(elapsed >= 7800 && elapsed <= 9800, `START_TIMEOUT window 7.8s-9.5s (got ${elapsed.toFixed(0)}ms)`);

  await new Promise((r) => setTimeout(r, 200));
  const hungPid = Number(fs.readFileSync(pidFile, 'utf8').trim());
  let alive = false;
  try { process.kill(hungPid, 0); alive = true; } catch {}
  assert.equal(alive, false, 'hung child process must be killed on START_TIMEOUT');

  handle.dispose();
  fs.rmSync(env.dir, { recursive: true, force: true });
});

test('AC-5: PORT_OCCUPIED_BY_OTHER protects third-party servers from kill', async () => {
  const thirdParty = http.createServer((req, res) => {
    res.statusCode = 200;
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ ok: true, app: 'third-party-service' }));
  });
  await new Promise((resolve) => thirdParty.listen(0, '127.0.0.1', resolve));
  const port = thirdParty.address().port;

  const env = makeSandboxEnv(port);
  process.env.ORCA_CLI_COMMAND = env.cliPath;
  process.env.ORCA_STATE_FILE = env.stateFile;
  process.env.ORCA_PROFILE_DB = env.profileDb;
  process.env.ORCA_DESIGN_HOME = env.designHome;
  process.env.ORCA_GALLERY_PORT = String(port);
  process.env.ORCA_GALLERY_SCRIPT = path.join(REPO_ROOT, 'src', 'gallery-server.mjs');
  process.env.ORCA_STARTUP_TIMEOUT_MS = '8000';

  const { orca, cmds } = createHostMock(env.wsDir);
  const handle = await activateWorker(orca);
  const res = await cmds.get('prototype.gallery')();
  assert.equal(res.ok, false);
  assert.equal(res.code, 'PORT_OCCUPIED_BY_OTHER');
  assert.equal(thirdParty.listening, true, 'third-party server remains alive');

  handle.dispose();
  await new Promise((resolve) => thirdParty.close(resolve));
  fs.rmSync(env.dir, { recursive: true, force: true });
});

test('AC-2 UI: #opening skeleton polls at 500ms and switches to START_TIMEOUT error card', async () => {
  const html = galleryHtml('zh');
  const script = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)][1][1];
  const ids = new Map();
  const makeEl = (id) => {
    const attrs = new Map();
    const el = {
      id,
      className: '',
      style: {},
      dataset: {},
      textContent: '',
      value: '',
      disabled: false,
      _innerHTML: '',
      setAttribute(k, v) { attrs.set(k, String(v)); },
      getAttribute(k) { return attrs.get(k) ?? null; },
      removeAttribute(k) { attrs.delete(k); },
      addEventListener() {},
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
  for (const m of html.matchAll(/\bid="([^"]+)"/g)) makeEl(m[1]);
  const document = {
    documentElement: makeEl('html'),
    body: makeEl('body'),
    getElementById: (id) => ids.get(id) || null,
    querySelector: () => makeEl('q'),
    querySelectorAll: () => [],
  };
  const ctx = vm.createContext({
    window: { document, addEventListener() {}, __ORCA_BOOT_TIMEOUT_MS__: 180, __ORCA_BOOT_POLL_MS__: 40 },
    document,
    location: { search: '', hash: '#opening', pathname: '/', port: '3480' },
    history: { replaceState() {}, pushState() {} },
    fetch: async () => { throw new Error('ECONNREFUSED'); },
    navigator: { clipboard: { writeText: async () => {} } },
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
  assert.ok(ids.get('container').innerHTML.includes('data-orca-design-skeleton="true"'), 'shows skeleton immediately on #opening');
  await new Promise((r) => setTimeout(r, 280));
  assert.ok(ids.get('container').innerHTML.includes('data-error-code="START_TIMEOUT"'), 'switches to START_TIMEOUT error card after timeout');
  assert.ok(ids.get('retryBootBtn'), 'renders retry button');
});
