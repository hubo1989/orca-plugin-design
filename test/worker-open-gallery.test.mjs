import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import activate from '../src/worker.js';
import { computeGalleryBuildId, parseProfileWorkspace } from '../src/workspace-resolver.mjs';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const BUILD_ID = computeGalleryBuildId(ROOT);
const ORCA_BIN = process.env.ORCA_CLI_COMMAND || '/Applications/Orca.app/Contents/Resources/bin/orca';

function createMockOrca(extra = {}) {
  const commands = new Map();
  const panelHandlers = new Map();
  const eventHandlers = new Map();
  const posted = [];
  const orca = {
    log: () => {},
    commands: { register: (id, fn) => { commands.set(id, fn); return { dispose: () => {} }; } },
    panels: {
      handle: (id, fn) => { panelHandlers.set(id, fn); return { dispose: () => {} }; },
      post: (event, payload) => { posted.push({ event, payload }); },
    },
    events: { on: (ev, fn) => { eventHandlers.set(ev, fn); return { dispose: () => {} }; } },
    host: {
      call: async (method) => {
        if (method === 'workspace.list') return extra.workspaces || { workspaces: [] };
        if (method === 'workspace.readContext') return extra.context ?? null;
        return {};
      },
    },
  };
  return { orca, commands, panelHandlers, eventHandlers, posted };
}

test('1. 主对话区新建 Tab：不带 --split，必调 tab switch --focus 与 tab current 校验', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ps-wog-1-'));
  const wsDir = path.join(tmpDir, 'ws-main');
  fs.mkdirSync(wsDir, { recursive: true });

  const prevNoPrewarm = process.env.ORCA_DESIGN_NO_PREWARM;
  const prevNoSpawn = process.env.ORCA_DESIGN_NO_SPAWN;
  process.env.ORCA_DESIGN_NO_PREWARM = '1';
  process.env.ORCA_DESIGN_NO_SPAWN = '1';

  const cliCalls = [];
  const { orca, commands } = createMockOrca();
  try {
    await activate(orca, {
      port: 39481,
      stateFile: path.join(tmpDir, 'state.json'),
      profileDbPath: path.join(tmpDir, 'missing.db'),
      runCli: async (args) => {
        cliCalls.push(args);
        if (args[0] === 'worktree' && args[1] === 'ps') {
          return {
            err: null,
            stdout: JSON.stringify({
              ok: true,
              result: {
                worktrees: [{
                  isActive: true,
                  hostId: 'local',
                  path: wsDir,
                  displayName: 'ws-main',
                  address: { worktree: `id:repo1::${wsDir}` },
                }],
              },
            }),
            stderr: '',
          };
        }
        if (args[0] === 'tab' && args[1] === 'list') {
          return { err: null, stdout: JSON.stringify({ ok: true, result: { tabs: [] } }), stderr: '' };
        }
        if (args[0] === 'tab' && args[1] === 'create') {
          return { err: null, stdout: JSON.stringify({ ok: true, result: { browserPageId: 'page-main-1' } }), stderr: '' };
        }
        if (args[0] === 'tab' && args[1] === 'switch') {
          return { err: null, stdout: JSON.stringify({ ok: true, result: {} }), stderr: '' };
        }
        if (args[0] === 'tab' && args[1] === 'current') {
          return { err: null, stdout: JSON.stringify({ ok: true, result: { tab: { browserPageId: 'page-main-1' } } }), stderr: '' };
        }
        return { err: null, stdout: '{}', stderr: '' };
      },
    });

    const openFn = commands.get('prototype.gallery');
    assert.ok(openFn);
    const res = await openFn();
    assert.equal(res.ok, true);
    assert.equal(res.pageId, 'page-main-1');

    const createCall = cliCalls.find((c) => c[0] === 'tab' && c[1] === 'create');
    assert.ok(createCall, 'must call tab create');
    assert.equal(createCall.includes('--split'), false, 'tab create must never pass --split');
    assert.ok(createCall.includes('--worktree'));

    const switchIdx = cliCalls.findIndex((c) => c[0] === 'tab' && c[1] === 'switch');
    const createIdx = cliCalls.indexOf(createCall);
    const currentIdx = cliCalls.findIndex((c) => c[0] === 'tab' && c[1] === 'current');
    assert.ok(switchIdx > createIdx, 'tab switch must happen after tab create');
    assert.ok(cliCalls[switchIdx].includes('--focus'), 'tab switch must pass --focus');
    assert.ok(cliCalls[switchIdx].includes('page-main-1'));
    assert.ok(currentIdx > switchIdx, 'tab current must verify after tab switch');
  } finally {
    if (prevNoPrewarm === undefined) delete process.env.ORCA_DESIGN_NO_PREWARM;
    else process.env.ORCA_DESIGN_NO_PREWARM = prevNoPrewarm;
    if (prevNoSpawn === undefined) delete process.env.ORCA_DESIGN_NO_SPAWN;
    else process.env.ORCA_DESIGN_NO_SPAWN = prevNoSpawn;
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('2. 冷启动等待健康检查：/api/health 前 3 次拒绝，第 4 次就绪后才执行 tab create', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ps-wog-2-'));
  const wsDir = path.join(tmpDir, 'ws-cold');
  fs.mkdirSync(wsDir, { recursive: true });

  const prevNoPrewarm = process.env.ORCA_DESIGN_NO_PREWARM;
  const prevNoSpawn = process.env.ORCA_DESIGN_NO_SPAWN;
  process.env.ORCA_DESIGN_NO_PREWARM = '1';
  delete process.env.ORCA_DESIGN_NO_SPAWN;

  const events = [];
  let healthAttempts = 0;
  let spawned = false;

  const { orca, commands } = createMockOrca();
  try {
    await activate(orca, {
      port: 39482,
      stateFile: path.join(tmpDir, 'state.json'),
      profileDbPath: path.join(tmpDir, 'missing.db'),
      spawnFn: () => {
        spawned = true;
        events.push('spawn');
        return { pid: 999991, unref: () => {}, on: () => {} };
      },
      fetchFn: async (url) => {
        if (String(url).endsWith('/api/health')) {
          healthAttempts += 1;
          events.push(`health-${healthAttempts}`);
          if (!spawned || healthAttempts <= 3) {
            throw new Error('ECONNREFUSED');
          }
          return new Response(JSON.stringify({
            ok: true,
            app: 'orca-plugin-design',
            version: '0.3.0',
            buildId: BUILD_ID,
            pid: 999991,
          }), { status: 200 });
        }
        throw new Error(`unexpected fetch ${url}`);
      },
      runCli: async (args) => {
        if (args[0] === 'worktree' && args[1] === 'ps') {
          return {
            err: null,
            stdout: JSON.stringify({
              ok: true,
              result: {
                worktrees: [{
                  isActive: true,
                  hostId: 'local',
                  path: wsDir,
                  address: { worktree: `path:${wsDir}` },
                }],
              },
            }),
            stderr: '',
          };
        }
        if (args[0] === 'tab' && args[1] === 'list') {
          return { err: null, stdout: JSON.stringify({ ok: true, result: { tabs: [] } }), stderr: '' };
        }
        if (args[0] === 'tab' && args[1] === 'create') {
          events.push('tab-create');
          return { err: null, stdout: JSON.stringify({ ok: true, result: { browserPageId: 'cold-p1' } }), stderr: '' };
        }
        if (args[0] === 'tab' && args[1] === 'switch') {
          return { err: null, stdout: JSON.stringify({ ok: true, result: {} }), stderr: '' };
        }
        if (args[0] === 'tab' && args[1] === 'current') {
          return { err: null, stdout: JSON.stringify({ ok: true, result: { tab: { browserPageId: 'cold-p1' } } }), stderr: '' };
        }
        return { err: null, stdout: '{}', stderr: '' };
      },
    });

    const res = await commands.get('prototype.gallery')();
    assert.equal(res.ok, true);
    assert.equal(res.pageId, 'cold-p1');
    const spawnIdx = events.indexOf('spawn');
    const createIdx = events.indexOf('tab-create');
    assert.ok(spawnIdx >= 0);
    assert.ok(createIdx > spawnIdx);
    assert.ok(healthAttempts >= 4, 'must poll /api/health until 200 before tab create');
    assert.ok(events.indexOf('health-4') < createIdx, 'tab create must run strictly after health check succeeds');
  } finally {
    if (prevNoPrewarm === undefined) delete process.env.ORCA_DESIGN_NO_PREWARM;
    else process.env.ORCA_DESIGN_NO_PREWARM = prevNoPrewarm;
    if (prevNoSpawn === undefined) delete process.env.ORCA_DESIGN_NO_SPAWN;
    else process.env.ORCA_DESIGN_NO_SPAWN = prevNoSpawn;
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('3. 旧版 :3480 服务热替换：旧 buildId 在线时发送 POST /api/shutdown 并拉起新实例', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ps-wog-3-'));
  const wsDir = path.join(tmpDir, 'ws-hot');
  fs.mkdirSync(wsDir, { recursive: true });

  const prevNoPrewarm = process.env.ORCA_DESIGN_NO_PREWARM;
  const prevNoSpawn = process.env.ORCA_DESIGN_NO_SPAWN;
  process.env.ORCA_DESIGN_NO_PREWARM = '1';
  delete process.env.ORCA_DESIGN_NO_SPAWN;

  let activeServer = 'old';
  let shutdownCalled = false;

  const mockPort = 39483;
  const fakeServer = http.createServer((req, res) => {
    if (req.url === '/api/health') {
      res.setHeader('content-type', 'application/json');
      return res.end(JSON.stringify({
        ok: true,
        app: 'orca-plugin-design',
        version: '0.2.9',
        buildId: activeServer === 'old' ? '0.2.9-stale0000' : BUILD_ID,
        pid: 888881,
      }));
    }
    if (req.url === '/api/shutdown' && req.method === 'POST') {
      shutdownCalled = true;
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ ok: true, shuttingDown: true }));
      fakeServer.close();
      activeServer = 'none';
      return;
    }
    res.statusCode = 404;
    res.end('{}');
  });

  await new Promise((resolve) => fakeServer.listen(mockPort, '127.0.0.1', resolve));

  const { orca, commands } = createMockOrca();
  try {
    await activate(orca, {
      port: mockPort,
      stateFile: path.join(tmpDir, 'state.json'),
      profileDbPath: path.join(tmpDir, 'missing.db'),
      spawnFn: () => {
        activeServer = 'new';
        return { pid: 888882, unref: () => {}, on: () => {} };
      },
      fetchFn: async (url, init) => {
        if (activeServer === 'new' && String(url).endsWith('/api/health')) {
          return new Response(JSON.stringify({
            ok: true,
            app: 'orca-plugin-design',
            version: '0.3.0',
            buildId: BUILD_ID,
            pid: 888882,
          }), { status: 200 });
        }
        return globalThis.fetch(url, init);
      },
      runCli: async (args) => {
        if (args[0] === 'worktree' && args[1] === 'ps') {
          return {
            err: null,
            stdout: JSON.stringify({
              ok: true,
              result: {
                worktrees: [{
                  isActive: true,
                  hostId: 'local',
                  path: wsDir,
                  address: { worktree: `path:${wsDir}` },
                }],
              },
            }),
            stderr: '',
          };
        }
        if (args[0] === 'tab' && args[1] === 'list') {
          return { err: null, stdout: JSON.stringify({ ok: true, result: { tabs: [] } }), stderr: '' };
        }
        if (args[0] === 'tab' && args[1] === 'create') {
          return { err: null, stdout: JSON.stringify({ ok: true, result: { browserPageId: 'hot-p1' } }), stderr: '' };
        }
        if (args[0] === 'tab' && args[1] === 'switch') {
          return { err: null, stdout: JSON.stringify({ ok: true, result: {} }), stderr: '' };
        }
        if (args[0] === 'tab' && args[1] === 'current') {
          return { err: null, stdout: JSON.stringify({ ok: true, result: { tab: { browserPageId: 'hot-p1' } } }), stderr: '' };
        }
        return { err: null, stdout: '{}', stderr: '' };
      },
    });

    const res = await commands.get('prototype.gallery')();
    assert.equal(shutdownCalled, true, 'must call POST /api/shutdown on stale buildId instance');
    assert.equal(res.ok, true);
    assert.equal(res.pageId, 'hot-p1');
  } finally {
    try { fakeServer.close(); } catch {}
    if (prevNoPrewarm === undefined) delete process.env.ORCA_DESIGN_NO_PREWARM;
    else process.env.ORCA_DESIGN_NO_PREWARM = prevNoPrewarm;
    if (prevNoSpawn === undefined) delete process.env.ORCA_DESIGN_NO_SPAWN;
    else process.env.ORCA_DESIGN_NO_SPAWN = prevNoSpawn;
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('4. 跨工作区隔离：切换工作区后绝不复用上一工作区的 browserPageId', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ps-wog-4-'));
  const wsA = path.join(tmpDir, 'ws-a');
  const wsB = path.join(tmpDir, 'ws-b');
  fs.mkdirSync(wsA, { recursive: true });
  fs.mkdirSync(wsB, { recursive: true });

  const prevNoPrewarm = process.env.ORCA_DESIGN_NO_PREWARM;
  const prevNoSpawn = process.env.ORCA_DESIGN_NO_SPAWN;
  process.env.ORCA_DESIGN_NO_PREWARM = '1';
  process.env.ORCA_DESIGN_NO_SPAWN = '1';

  let currentWs = wsA;
  const switchedIds = [];

  const { orca, commands, eventHandlers } = createMockOrca();
  try {
    await activate(orca, {
      port: 39484,
      stateFile: path.join(tmpDir, 'state.json'),
      profileDbPath: path.join(tmpDir, 'missing.db'),
      runCli: async (args) => {
        if (args[0] === 'worktree' && args[1] === 'ps') {
          return {
            err: null,
            stdout: JSON.stringify({
              ok: true,
              result: {
                worktrees: [{
                  isActive: true,
                  hostId: 'local',
                  path: currentWs,
                  address: { worktree: `path:${currentWs}` },
                }],
              },
            }),
            stderr: '',
          };
        }
        if (args[0] === 'tab' && args[1] === 'list') {
          return { err: null, stdout: JSON.stringify({ ok: true, result: { tabs: [] } }), stderr: '' };
        }
        if (args[0] === 'tab' && args[1] === 'create') {
          const id = currentWs === wsA ? 'page-A' : 'page-B';
          return { err: null, stdout: JSON.stringify({ ok: true, result: { browserPageId: id } }), stderr: '' };
        }
        if (args[0] === 'tab' && args[1] === 'switch') {
          const pIdx = args.indexOf('--page');
          switchedIds.push(args[pIdx + 1]);
          return { err: null, stdout: JSON.stringify({ ok: true, result: {} }), stderr: '' };
        }
        if (args[0] === 'tab' && args[1] === 'current') {
          const id = currentWs === wsA ? 'page-A' : 'page-B';
          return { err: null, stdout: JSON.stringify({ ok: true, result: { tab: { browserPageId: id } } }), stderr: '' };
        }
        return { err: null, stdout: '{}', stderr: '' };
      },
    });

    const openFn = commands.get('prototype.gallery');
    const rA = await openFn();
    assert.equal(rA.ok, true);
    assert.equal(rA.pageId, 'page-A');

    currentWs = wsB;
    await eventHandlers.get('workspace.changed')?.();

    const rB = await openFn();
    assert.equal(rB.ok, true);
    assert.equal(rB.reused, false);
    assert.equal(rB.pageId, 'page-B');
    assert.deepEqual(switchedIds, ['page-A', 'page-B']);
  } finally {
    if (prevNoPrewarm === undefined) delete process.env.ORCA_DESIGN_NO_PREWARM;
    else process.env.ORCA_DESIGN_NO_PREWARM = prevNoPrewarm;
    if (prevNoSpawn === undefined) delete process.env.ORCA_DESIGN_NO_SPAWN;
    else process.env.ORCA_DESIGN_NO_SPAWN = prevNoSpawn;
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('5. Folder Workspace 正常解析 + 三段式远程工作区拦截且失败不触发 2s 节流 + openSkillEditor 相对 URL 补全', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ps-wog-5-'));
  const folderDir = path.join(tmpDir, 'my-folder-ws');
  const pageDir = path.join(folderDir, 'landing-page');
  fs.mkdirSync(pageDir, { recursive: true });
  fs.writeFileSync(path.join(pageDir, '.artifact.json'), JSON.stringify({ title: 'Landing' }));
  fs.writeFileSync(path.join(pageDir, 'index.html'), '<h1>Hi</h1>');

  const profileDb = path.join(tmpDir, 'profile-state.db');
  execFileSync('sqlite3', [profileDb,
    'CREATE TABLE profile_state_documents (domain TEXT PRIMARY KEY, payload TEXT NOT NULL);'
    + ` INSERT INTO profile_state_documents VALUES ('workspaceSession', '{"activeWorkspaceKey":"folder:f-123"}');`
    + ` INSERT INTO profile_state_documents VALUES ('folderWorkspaces', '[{"id":"f-123","name":"MyFolder","folderPath":"${folderDir}","connectionId":null}]');`,
  ]);

  const parsedFolder = parseProfileWorkspace(profileDb);
  assert.equal(parsedFolder.isRemote, false);
  assert.equal(parsedFolder.path, folderDir);
  assert.equal(parsedFolder.selector, 'folder:f-123');

  const remoteDb = path.join(tmpDir, 'remote-profile.db');
  execFileSync('sqlite3', [remoteDb,
    'CREATE TABLE profile_state_documents (domain TEXT PRIMARY KEY, payload TEXT NOT NULL);'
    + ` INSERT INTO profile_state_documents VALUES ('workspaceSession', '{"activeWorktreeId":"ssh::remote-host::/srv/app"}');`,
  ]);
  const parsedRemote = parseProfileWorkspace(remoteDb);
  assert.equal(parsedRemote.isRemote, true);

  const prevNoPrewarm = process.env.ORCA_DESIGN_NO_PREWARM;
  const prevNoSpawn = process.env.ORCA_DESIGN_NO_SPAWN;
  process.env.ORCA_DESIGN_NO_PREWARM = '1';
  process.env.ORCA_DESIGN_NO_SPAWN = '1';

  let mode = 'remote';
  const createdUrls = [];

  const { orca, commands, panelHandlers } = createMockOrca();
  try {
    await activate(orca, {
      port: 39485,
      stateFile: path.join(tmpDir, 'state.json'),
      profileDbPath: profileDb,
      fetchFn: async (url) => {
        if (String(url).endsWith('/api/open')) {
          return new Response(JSON.stringify({ ok: true, url: `/api/preview?skill=page&root=${encodeURIComponent(pageDir)}` }), { status: 200 });
        }
        throw new Error(`unexpected fetch ${url}`);
      },
      runCli: async (args) => {
        if (args[0] === 'worktree' && args[1] === 'ps') {
          if (mode === 'remote') {
            return {
              err: null,
              stdout: JSON.stringify({
                ok: true,
                result: {
                  worktrees: [{
                    isActive: true,
                    hostId: 'ssh:box',
                    worktreeId: 'ssh::box::/srv/app',
                    path: '/srv/app',
                  }],
                },
              }),
              stderr: '',
            };
          }
          return {
            err: null,
            stdout: JSON.stringify({
              ok: true,
              result: {
                worktrees: [{
                  isActive: true,
                  hostId: 'local',
                  workspaceKind: 'folder-workspace',
                  worktreeId: 'folder:f-123',
                  path: folderDir,
                  displayName: 'MyFolder',
                  address: { worktree: 'folder:f-123' },
                }],
              },
            }),
            stderr: '',
          };
        }
        if (args[0] === 'tab' && args[1] === 'list') {
          return { err: null, stdout: JSON.stringify({ ok: true, result: { tabs: [] } }), stderr: '' };
        }
        if (args[0] === 'tab' && args[1] === 'create') {
          const uIdx = args.indexOf('--url');
          createdUrls.push(args[uIdx + 1]);
          return { err: null, stdout: JSON.stringify({ ok: true, result: { browserPageId: 'folder-p1' } }), stderr: '' };
        }
        if (args[0] === 'tab' && args[1] === 'switch') {
          return { err: null, stdout: JSON.stringify({ ok: true, result: {} }), stderr: '' };
        }
        if (args[0] === 'tab' && args[1] === 'current') {
          return { err: null, stdout: JSON.stringify({ ok: true, result: { tab: { browserPageId: 'folder-p1' } } }), stderr: '' };
        }
        return { err: null, stdout: '{}', stderr: '' };
      },
    });

    const openFn = commands.get('prototype.gallery');
    const rRemote = await openFn();
    assert.equal(rRemote.ok, false);
    assert.match(rRemote.error, /远程工作区/);

    // 失败后立即切回本机 Folder Workspace，不应被 2s 节流拦截
    mode = 'folder';
    const rFolder = await openFn();
    assert.equal(rFolder.ok, true);
    assert.equal(rFolder.throttled, undefined);
    assert.equal(rFolder.pageId, 'folder-p1');

    // 验证 openSkillEditor 相对路径补全 Origin
    const openSkill = panelHandlers.get('studio.skill.open');
    const rPage = await openSkill({ skill: 'page', root: pageDir });
    assert.equal(rPage.ok, true);
    assert.ok(rPage.url.startsWith('http://127.0.0.1:39485/api/preview?'));
    assert.ok(createdUrls.some((u) => u.startsWith('http://127.0.0.1:39485/api/preview?')));
  } finally {
    if (prevNoPrewarm === undefined) delete process.env.ORCA_DESIGN_NO_PREWARM;
    else process.env.ORCA_DESIGN_NO_PREWARM = prevNoPrewarm;
    if (prevNoSpawn === undefined) delete process.env.ORCA_DESIGN_NO_SPAWN;
    else process.env.ORCA_DESIGN_NO_SPAWN = prevNoSpawn;
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('6. Manifest 与侧边栏面板校验：含 panels[0]、无 statusBarItems，且 orca validate/check 通过', () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'orca-plugin.json'), 'utf8'));
  assert.equal(manifest.contributes.statusBarItems, undefined, 'statusBarItems must be removed');
  assert.ok(Array.isArray(manifest.contributes.panels) && manifest.contributes.panels.length >= 1);
  assert.equal(manifest.contributes.panels[0].id, 'studio');
  assert.equal(manifest.contributes.panels[0].ui, 'components');
  assert.equal(manifest.contributes.panels[0].entry, 'src/panel.tsx');

  const galleryCmd = manifest.contributes.commands.find((c) => c.id === 'prototype.gallery');
  const galleryKb = manifest.contributes.keybindings.find((k) => k.command === 'prototype.gallery');
  assert.equal(galleryCmd?.when, 'global');
  assert.equal(galleryKb?.when, 'global');

  if (fs.existsSync(ORCA_BIN)) {
    const valOut = execFileSync(ORCA_BIN, ['plugin', 'validate', ROOT, '--json'], { encoding: 'utf8' });
    const valJson = JSON.parse(valOut);
    assert.equal(valJson.ok, true, `orca plugin validate failed: ${valOut}`);

    const chkOut = execFileSync(ORCA_BIN, ['plugin', 'check', ROOT, '--json'], { encoding: 'utf8' });
    const chkJson = JSON.parse(chkOut);
    assert.equal(chkJson.ok, true, `orca plugin check failed: ${chkOut}`);
  }
});
