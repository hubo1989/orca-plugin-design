import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';

const REPO_ROOT = path.resolve(import.meta.dirname, '..');
const WORKER_PATH = path.join(REPO_ROOT, 'src', 'worker.js');
const GALLERY_URL = 'http://127.0.0.1:3480/';
const GALLERY_SCRIPT = path.join(REPO_ROOT, 'src', 'gallery-server.mjs');

function makeSandbox() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'orca-design-tab-visibility-'));
}

function writeMockCli(dir, config) {
  const logPath = path.join(dir, 'cli.argv');
  const cliPath = path.join(dir, 'mock-orca-cli.mjs');
  const configPath = path.join(dir, 'mock-config.json');
  const state = {
    worktree: '/tmp/workspace-a',
    focusBranch: 'workspace-a',
    focusName: 'workspace-a',
    list: [],
    createPageId: 'created-page',
    currentPageId: 'created-page',
    failSwitch: false,
    failCurrent: false,
    failCreate: false,
    ...config,
  };
  fs.writeFileSync(configPath, JSON.stringify(state));
  fs.writeFileSync(cliPath, `#!/usr/bin/env node
import fs from 'node:fs';
const argv = process.argv.slice(2);
fs.appendFileSync(${JSON.stringify(logPath)}, JSON.stringify(argv) + '\\n');
const cfg = JSON.parse(fs.readFileSync(${JSON.stringify(configPath)}, 'utf8'));
// 模拟 CLI 严格作用域：带 --worktree 时，list/current 只返回该工作区的记录。
const scope = argv.includes('--worktree') ? argv[argv.indexOf('--worktree') + 1] : '';
const scoped = !scope || scope === 'path:' + cfg.worktree;
const sub = argv[1];
if (sub === 'ps') {
  console.log(JSON.stringify({ ok: true, result: { worktrees: [{ path: cfg.worktree, displayName: cfg.focusName, isActive: true, lastActivityAt: 1 }] } }));
} else if (sub === 'activate') {
  console.log(JSON.stringify({ ok: true, result: { activated: true } }));
} else if (sub === 'list') {
  console.log(JSON.stringify({ ok: true, result: { tabs: scoped ? cfg.list : [] } }));
} else if (sub === 'create') {
  if (cfg.failCreate) { console.error('create failed'); process.exit(1); }
  console.log(JSON.stringify({ ok: true, result: { browserPageId: cfg.createPageId } }));
} else if (sub === 'switch') {
  if (cfg.failSwitch) { console.error('switch failed'); process.exit(1); }
  const page = argv[argv.indexOf('--page') + 1];
  if (!scoped) { console.error('wrong worktree'); process.exit(1); }
  console.log(JSON.stringify({ ok: true, result: { switched: 0, browserPageId: page } }));
} else if (sub === 'current') {
  if (cfg.failCurrent) { console.error('current failed'); process.exit(1); }
  if (!scoped) { console.error('wrong worktree'); process.exit(1); }
  console.log(JSON.stringify({ ok: true, result: { tab: { browserPageId: cfg.currentPageId, active: true } } }));
} else {
  console.log(JSON.stringify({ ok: true, result: {} }));
}
`, { mode: 0o755 });
  return { cliPath, logPath, configPath };
}

function readCalls(logPath) {
  if (!fs.existsSync(logPath)) return [];
  return fs.readFileSync(logPath, 'utf8').trim().split('\n').filter(Boolean).map((line) => JSON.parse(line));
}

function makeProfileDb(dir, workspaceRoot) {
  const profileDb = path.join(dir, 'profile-state.db');
  const activeWorktreeId = `local-repo::${workspaceRoot}`;
  const payload = JSON.stringify({ activeWorktreeId });
  execFileSync('sqlite3', [profileDb,
    'CREATE TABLE profile_state_documents (domain TEXT PRIMARY KEY, payload TEXT NOT NULL);'
    + ` INSERT INTO profile_state_documents VALUES ('workspaceSession', '${payload.replace(/'/g, "''")}');`,
  ]);
  return profileDb;
}

function makeHost({ workspaceRoot, workspaceName, captureEvents = false }) {
  const handlers = new Map();
  const events = new Map();
  const focus = { workspaceRoot, workspaceName, branch: workspaceName };
  const orca = {
    log: () => {},
    commands: Object.freeze({ register: async (id, fn) => { handlers.set(id, fn); } }),
    panels: Object.freeze({ handle: () => {} }),
    events: Object.freeze({ on: (name, fn) => { if (captureEvents) events.set(name, fn); } }),
    host: Object.freeze({
      call: async (method) => {
        if (method === 'workspace.list') return { workspaces: [{ path: focus.workspaceRoot, name: focus.workspaceName, branch: focus.branch, id: 'local-ws' }] };
        if (method === 'workspace.readContext') return { branch: focus.branch, displayName: focus.workspaceName, terminals: [] };
        return {};
      },
      has: () => false,
      api: { major: 1, minor: 4 },
    }),
  };
  return { orca, handlers, events, focus };
}

let importCounter = 0;
async function activateWorker({ cliPath, stateFile, profileDb, workspaceRoot, workspaceName, captureEvents = false }) {
  fs.mkdirSync(path.dirname(stateFile), { recursive: true });
  fs.writeFileSync(stateFile, JSON.stringify({ workspaceRoot, workspaceName }));
  process.env.ORCA_CLI_COMMAND = cliPath;
  process.env.ORCA_STATE_FILE = stateFile;
  process.env.ORCA_PROFILE_DB = profileDb;
  process.env.ORCA_DESIGN_HOME = path.join(path.dirname(stateFile), 'design-home');
  process.env.ORCA_GALLERY_SCRIPT = '/dev/null';
  fs.mkdirSync(process.env.ORCA_DESIGN_HOME, { recursive: true });
  // worker 自己会 spawn gallery-server；测试里用不可达端口替代真实 spawn 的副作用由
  // ensureGallery 的 fire-and-forget + detached child 承担，/dev/null 让脚本立即退出。
  const source = fs.readFileSync(WORKER_PATH, 'utf8')
    .replace("const GALLERY_SCRIPT = path.join(pluginRoot, 'src', 'gallery-server.mjs');", "const GALLERY_SCRIPT = process.env.ORCA_GALLERY_SCRIPT || path.join(pluginRoot, 'src', 'gallery-server.mjs');");
  const stagedWorker = path.join(path.dirname(stateFile), `worker-${++importCounter}.mjs`);
  fs.writeFileSync(stagedWorker, source.replace("from './skills-meta.mjs'", `from ${JSON.stringify(path.join(REPO_ROOT, 'src', 'skills-meta.mjs'))}`));
  const { orca, handlers, events, focus } = makeHost({ workspaceRoot, workspaceName, captureEvents });
  await (await import(new URL(`file://${stagedWorker}`).href)).default(orca);
  const gallery = handlers.get('prototype.gallery');
  assert.ok(gallery, 'prototype.gallery 未注册');
  return { gallery, events, focus, stateFile };
}

function assertScoped(calls, workspaceRoot) {
  const scopedCalls = calls.filter((args) => args[0] === 'tab' || args[0] === 'worktree');
  assert.ok(scopedCalls.length > 0, '没有 tab/worktree CLI 调用');
  for (const args of scopedCalls) {
    assert.ok(args.includes('--json'), `缺少 --json: ${args.join(' ')}`);
    assert.ok(args.includes('--worktree'), `缺少 --worktree: ${args.join(' ')}`);
    assert.ok(args.includes(`path:${workspaceRoot}`), `worktree 作用域错误: ${args.join(' ')}`);
  }
}

test('gallery 首次创建：解析 page id、switch/focus、current 校验，且不用 --split right', async () => {
  const dir = makeSandbox();
  const root = dir;
  const { cliPath, logPath } = writeMockCli(dir, { worktree: root, list: [], createPageId: 'created-page', currentPageId: 'created-page' });
  const { gallery } = await activateWorker({
    cliPath,
    stateFile: path.join(dir, 'state.json'),
    profileDb: makeProfileDb(dir, root),
    workspaceRoot: root,
    workspaceName: 'workspace-a',
  });
  const result = await gallery();
  assert.deepEqual(result, { ok: true, reused: false, pageId: 'created-page', workspaceRoot: root });
  const calls = readCalls(logPath);
  assertScoped(calls, root);
  const create = calls.find((args) => args[1] === 'create');
  assert.ok(create, '未调用 tab create');
  assert.ok(!create.includes('--split'), `gallery create 不应带 --split: ${create.join(' ')}`);
  assert.ok(calls.some((args) => args[0] === 'worktree' && args[1] === 'activate'), '未先激活焦点工作区');
  assert.ok(calls.some((args) => args[1] === 'switch' && args.includes('created-page') && args.includes('--focus')));
  assert.ok(calls.some((args) => args[1] === 'current'));
});

test('gallery 缓存复用：switch 后 current 不匹配时不得返回 ok:true', async () => {
  const dir = makeSandbox();
  const root = dir;
  const { cliPath, logPath } = writeMockCli(dir, {
    worktree: root,
    list: [{ browserPageId: 'cached-page', url: GALLERY_URL, active: true, loaded: true }],
    createPageId: 'created-page',
    currentPageId: 'other-page',
  });
  const { gallery } = await activateWorker({
    cliPath,
    stateFile: path.join(dir, 'state.json'),
    profileDb: makeProfileDb(dir, root),
    workspaceRoot: root,
    workspaceName: 'workspace-a',
  });
  const result = await gallery();
  assert.equal(result.ok, false, 'current 不匹配时不能假成功');
  assert.match(result.error, /visibility verification failed/);
  const calls = readCalls(logPath);
  assertScoped(calls, root);
  assert.ok(calls.some((args) => args[1] === 'switch' && args.includes('cached-page')));
  assert.ok(calls.some((args) => args[1] === 'current'));
  assert.ok(calls.some((args) => args[1] === 'create'), '可见性失败应降级到 create 路径');
});

test('workspace.changed 后清空缓存：旧 page id 不再被 switch', async () => {
  const dir = makeSandbox();
  const root = dir;
  const { cliPath, logPath, configPath } = writeMockCli(dir, {
    worktree: root,
    list: [{ browserPageId: 'old-page', url: GALLERY_URL, active: true, loaded: true }],
    createPageId: 'new-page',
    currentPageId: 'new-page',
  });
  const { gallery, events } = await activateWorker({
    cliPath,
    stateFile: path.join(dir, 'state.json'),
    profileDb: makeProfileDb(dir, root),
    workspaceRoot: root,
    workspaceName: 'workspace-a',
    captureEvents: true,
  });
  const changed = events.get('workspace.changed');
  assert.equal(typeof changed, 'function');
  await changed({ context: { branch: 'main', displayName: 'workspace-a', terminals: [] } });
  const cfg = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  cfg.list = [];
  fs.writeFileSync(configPath, JSON.stringify(cfg));
  const before = readCalls(logPath).length;
  const result = await gallery();
  assert.equal(result.ok, true);
  assert.equal(result.pageId, 'new-page');
  const calls = readCalls(logPath).slice(before);
  assertScoped(calls, root);
  assert.ok(!calls.some((args) => args.includes('old-page')), 'workspace.changed 后仍复用了旧 page id');
  assert.ok(calls.some((args) => args[1] === 'create' && args.includes(`--url`)), '应新建 Tab');
});

test('切换当前工作树后：所有 Tab 命令改用新 root，不复用旧 page id', async () => {
  const dir = makeSandbox();
  const rootA = path.join(dir, 'workspace-a');
  const rootB = path.join(dir, 'workspace-b');
  fs.mkdirSync(rootA);
  fs.mkdirSync(rootB);
  const { cliPath, logPath, configPath } = writeMockCli(dir, {
    worktree: rootA,
    focusName: 'workspace-a',
    focusBranch: 'workspace-a',
    list: [],
    createPageId: 'page-a',
    currentPageId: 'page-a',
  });
  const { gallery, focus, stateFile } = await activateWorker({
    cliPath,
    stateFile: path.join(dir, 'state.json'),
    profileDb: makeProfileDb(dir, rootA),
    workspaceRoot: rootA,
    workspaceName: 'workspace-a',
  });
  const first = await gallery();
  assert.equal(first.ok, true);
  assert.equal(first.workspaceRoot, rootA);
  const stateA = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
  assert.equal(stateA.workspaceRoot, rootA);

  // 模拟宿主焦点切换：workspace.list/readContext 与 worktree ps 都返回 B。
  focus.workspaceRoot = rootB;
  focus.workspaceName = 'workspace-b';
  focus.branch = 'workspace-b';
  const cfg = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  cfg.worktree = rootB;
  cfg.focusName = 'workspace-b';
  cfg.focusBranch = 'workspace-b';
  cfg.list = [];
  cfg.createPageId = 'page-b';
  cfg.currentPageId = 'page-b';
  fs.writeFileSync(configPath, JSON.stringify(cfg));
  const before = readCalls(logPath).length;
  await new Promise((resolve) => setTimeout(resolve, 2100)); // 绕开上次成功后的 2 秒节流

  const second = await gallery();
  assert.equal(second.ok, true);
  assert.equal(second.workspaceRoot, rootB);
  assert.equal(second.pageId, 'page-b');
  const calls = readCalls(logPath).slice(before);
  assertScoped(calls, rootB);
  assert.ok(!calls.some((args) => args.includes(`path:${rootA}`) || args.includes('page-a')), '第二次点击仍复用了旧工作树/旧 page id');
  assert.ok(calls.some((args) => args[1] === 'create' && args.includes('page-a') === false), '应在新工作树新建 Tab');
  const stateB = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
  assert.equal(stateB.workspaceRoot, rootB);
});

test('gallery create 失败与 switch 失败都返回显式错误', async () => {
  const createFailDir = makeSandbox();
  const createFail = writeMockCli(createFailDir, { worktree: createFailDir, failCreate: true });
  const galleryCreate = await activateWorker({
    cliPath: createFail.cliPath,
    stateFile: path.join(createFailDir, 'state.json'),
    profileDb: makeProfileDb(createFailDir, createFailDir),
    workspaceRoot: createFailDir,
    workspaceName: 'workspace-a',
  });
  const createResult = await galleryCreate.gallery();
  assert.equal(createResult.ok, false);
  assert.match(createResult.error, /create failed|tab create/);

  const switchFailDir = makeSandbox();
  const switchFail = writeMockCli(switchFailDir, {
    worktree: switchFailDir,
    list: [{ browserPageId: 'cached-page', url: GALLERY_URL, active: true, loaded: true }],
    failSwitch: true,
    currentPageId: 'created-page',
  });
  const gallerySwitch = await activateWorker({
    cliPath: switchFail.cliPath,
    stateFile: path.join(switchFailDir, 'state.json'),
    profileDb: makeProfileDb(switchFailDir, switchFailDir),
    workspaceRoot: switchFailDir,
    workspaceName: 'workspace-a',
  });
  const switchResult = await gallerySwitch.gallery();
  assert.equal(switchResult.ok, false);
  assert.match(switchResult.error, /visibility verification failed/);
});
