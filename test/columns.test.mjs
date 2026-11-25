import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { execFileSync } from 'node:child_process';

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ps-columns-'));
const wsDir = path.join(tmpDir, 'workspace');
const designHome = path.join(tmpDir, 'orca-design');
const oaHome = path.join(tmpDir, 'oa-home');
const stateFile = path.join(tmpDir, 'state.json');
const mockOrcaCli = path.join(tmpDir, 'mock-orca-cli');
const cliOutcomeFile = path.join(tmpDir, 'cli-mode.txt');

fs.mkdirSync(wsDir, { recursive: true });
fs.mkdirSync(designHome, { recursive: true });
fs.mkdirSync(oaHome, { recursive: true });

// Create 3 legacy/new artifacts in .design/ inside a git repo to verify zero intrusion
const makeSlide = (dirName, title) => {
  const dir = path.join(wsDir, '.design', dirName, 'project');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'deck.json'), JSON.stringify({ v: 4, title, order: ['s1'] }, null, 2));
  return path.join(wsDir, '.design', dirName);
};

const issue1Root = makeSlide('weekly-01', 'Weekly Issue 1');
const issue2Root = makeSlide('weekly-02', 'Weekly Issue 2');
const issue3Root = makeSlide('weekly-03', 'Weekly Issue 3');
const standaloneRoot = makeSlide('solo-deck', 'Standalone Deck');

const git = (...args) => execFileSync('git', ['-C', wsDir, ...args], { encoding: 'utf8', stdio: 'pipe' });
git('init');
git('add', '.');
git('-c', 'user.name=Test', '-c', 'user.email=t@example.invalid', '-c', 'commit.gpgsign=false', 'commit', '-m', 'init');

fs.writeFileSync(cliOutcomeFile, 'ok');
fs.writeFileSync(
  mockOrcaCli,
  `#!/bin/sh
MODE=$(cat "${cliOutcomeFile}")
if [ "$MODE" = "fail" ]; then
  echo '{"ok":false,"error":{"message":"mock launch failed"}}' >&2
  exit 1
fi
echo '{"ok":true,"result":{"outcome":{"kind":"chat"}}}'
`,
  { mode: 0o755 }
);

process.env.ORCA_DESIGN_HOME = designHome;
process.env.ORCA_DESIGN_LEGACY_HOME = path.join(tmpDir, 'baoyu-design');
process.env.OPEN_ARTIFACT_HOME = oaHome;
process.env.ORCA_DESIGN_NO_THUMB = '1';
process.env.ORCA_STATE_FILE = stateFile;
process.env.ORCA_CLI_COMMAND = mockOrcaCli;
fs.writeFileSync(stateFile, JSON.stringify({ workspaceRoot: wsDir, workspaceName: 'columns-ws' }));

const columnsStore = await import('../src/columns-store.mjs');
const {
  server,
  listArtifactsViews,
  listArtifactsViewsAsync,
  galleryHtml,
  GALLERY_STR,
} = await import('../src/gallery-server.mjs');

const port = 41000 + Math.floor(Math.random() * 2000);
await new Promise((resolve, reject) => {
  server.once('error', reject);
  server.listen(port, '127.0.0.1', resolve);
});
const base = `http://127.0.0.1:${port}`;
const postHeaders = (extra = {}) => ({
  'content-type': 'application/json',
  origin: base,
  host: `127.0.0.1:${port}`,
  ...extra,
});
const apiJson = async (route, body) => {
  const res = await fetch(base + route, {
    method: body === undefined ? 'GET' : 'POST',
    headers: body === undefined ? undefined : postHeaders(),
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, data: await res.json() };
};

test('columns-store: atomic file path, CRUD, auto-increment issue numbers, and zero intrusion into .design/', () => {
  const filePath = columnsStore.columnsFilePath(wsDir, designHome);
  assert.ok(filePath.startsWith(path.join(designHome, 'columns')));
  assert.match(path.basename(filePath), /^[0-9a-f]{24}\.json$/);

  const created = columnsStore.createColumn(wsDir, {
    name: '周刊',
    description: '每周产品与设计拆解',
    defaultType: 'slides',
    pinned: true,
  }, designHome);
  assert.equal(created.ok, true);
  const seriesId = created.column.seriesId;
  assert.ok(fs.existsSync(filePath));

  const a1 = columnsStore.assignToColumn(wsDir, { root: issue1Root, seriesId, artifactId: 'art_1' }, designHome);
  const a2 = columnsStore.assignToColumn(wsDir, { root: issue2Root, seriesId, artifactId: 'art_2' }, designHome);
  const a3 = columnsStore.assignToColumn(wsDir, { root: issue3Root, seriesId, artifactId: 'art_3' }, designHome);
  assert.equal(a1.membership.issueNumber, 1);
  assert.equal(a2.membership.issueNumber, 2);
  assert.equal(a3.membership.issueNumber, 3);

  const renamed = columnsStore.updateColumn(wsDir, seriesId, { name: 'AI 周刊', sortOrder: 'asc' }, designHome);
  assert.equal(renamed.ok, true);
  assert.equal(renamed.column.name, 'AI 周刊');
  assert.equal(renamed.column.sortOrder, 'asc');

  // Zero writes to .design/
  assert.equal(git('status', '--short').trim(), '');
});

test('columns-store: syncRename migrates membership atomically from oldRoot to newRoot', () => {
  const colRes = columnsStore.createColumn(wsDir, { name: 'Rename Test' }, designHome);
  const sid = colRes.column.seriesId;
  const fakeOld = path.join(wsDir, '.design', 'old-folder');
  const fakeNew = path.join(wsDir, '.design', 'new-folder');
  columnsStore.assignToColumn(wsDir, { root: fakeOld, seriesId: sid, issueNumber: 7 }, designHome);

  const synced = columnsStore.syncRename(wsDir, fakeOld, fakeNew, designHome);
  assert.equal(synced.ok, true);
  assert.equal(synced.moved, true);
  assert.equal(columnsStore.getMembership(wsDir, fakeOld, designHome), null);
  assert.equal(columnsStore.getMembership(wsDir, fakeNew, designHome)?.issueNumber, 7);

  columnsStore.dissolveColumn(wsDir, sid, designHome);
  assert.equal(columnsStore.getMembership(wsDir, fakeNew, designHome), null);
});

test('HTTP POST guard protects /api/columns/* and full lifecycle + 10s undo restore preserves seriesId & issueNumber', async () => {
  const cross = await fetch(base + '/api/columns/create', {
    method: 'POST',
    headers: { 'content-type': 'text/plain', origin: 'http://evil.example' },
    body: JSON.stringify({ name: 'Evil' }),
  });
  assert.equal(cross.status, 415);

  const crossOrigin = await fetch(base + '/api/columns/create', {
    method: 'POST',
    headers: { ...postHeaders(), origin: 'http://evil.example' },
    body: JSON.stringify({ name: 'Evil' }),
  });
  assert.equal(crossOrigin.status, 403);

  const listBefore = (await apiJson('/api/list')).data;
  const weeklyCol = listBefore.columns.find((c) => c.name === 'AI 周刊');
  assert.ok(weeklyCol);

  // Rename back to 周刊 for search consistency
  await apiJson('/api/columns/update', { seriesId: weeklyCol.seriesId, name: '周刊', sortOrder: 'desc' });

  // Delete issue #2 (with moveFolder: true), verify removed from list & membership, then restore and verify #2 returns!
  const delRes = await apiJson('/api/delete', { root: issue2Root, moveFolder: true });
  assert.equal(delRes.status, 200);
  assert.equal(delRes.data.ok, true);
  assert.equal(delRes.data.moved, true);
  assert.ok(delRes.data.trash);
  assert.equal(fs.existsSync(issue2Root), false);

  const afterDel = (await apiJson('/api/list')).data;
  const remainingWeekly = afterDel.artifacts.filter((a) => a.seriesId === weeklyCol.seriesId);
  assert.deepEqual(remainingWeekly.map((a) => a.issueNumber).sort(), [1, 3]);

  const restoreRes = await apiJson('/api/restore', { id: delRes.data.trash });
  assert.equal(restoreRes.status, 200);
  assert.equal(restoreRes.data.ok, true);
  assert.equal(fs.existsSync(issue2Root), true);

  const afterRestore = (await apiJson('/api/list')).data;
  const restoredItem = afterRestore.artifacts.find((a) => a.root === issue2Root);
  assert.equal(restoredItem?.seriesId, weeklyCol.seriesId);
  assert.equal(restoredItem?.issueNumber, 2);

  // Clean git status after restore
  assert.equal(git('status', '--short').trim(), '');
});

test('next-issue launches orca agent with rich context, registers pendingFolders, auto-groups on scan, and degrades cleanly on CLI failure', async () => {
  const listRes = (await apiJson('/api/list')).data;
  const weeklyCol = listRes.columns.find((c) => c.name === '周刊');
  assert.ok(weeklyCol);

  // 1. Success path
  fs.writeFileSync(cliOutcomeFile, 'ok');
  const okLaunch = await apiJson('/api/start', {
    action: 'next-issue',
    seriesId: weeklyCol.seriesId,
    referenceRoot: issue3Root,
    skill: 'slides',
    inheritStyle: true,
    topic: '2026 Q4 设计系统盘点',
  });
  assert.equal(okLaunch.status, 200);
  assert.equal(okLaunch.data.ok, true);
  assert.equal(okLaunch.data.issueNumber, 4);
  assert.match(okLaunch.data.starter, /周刊/);
  assert.match(okLaunch.data.starter, /#4/);
  assert.match(okLaunch.data.starter, new RegExp(issue3Root.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.match(okLaunch.data.starter, /风格继承要求/);
  assert.match(okLaunch.data.starter, /2026 Q4 设计系统盘点/);

  // Simulate Agent creating the pre-registered folder
  const targetFolder = okLaunch.data.folderPath;
  fs.mkdirSync(path.join(targetFolder, 'project'), { recursive: true });
  fs.writeFileSync(path.join(targetFolder, 'project', 'deck.json'), JSON.stringify({ v: 4, title: 'Weekly Issue 4', order: ['s1'] }));

  const afterScan = await listArtifactsViewsAsync();
  const autoGrouped = afterScan.artifacts.find((a) => a.root === targetFolder);
  assert.equal(autoGrouped?.seriesId, weeklyCol.seriesId);
  assert.equal(autoGrouped?.issueNumber, 4);

  // Clean up simulated folder so git workspace stays tidy
  await apiJson('/api/forget', { root: targetFolder });
  fs.rmSync(targetFolder, { recursive: true, force: true });

  // 2. Simulated failure path (mock CLI returns exit 1) -> returns starter for clipboard fallback
  fs.writeFileSync(cliOutcomeFile, 'fail');
  const failLaunch = await apiJson('/api/start', {
    action: 'next-issue',
    seriesId: weeklyCol.seriesId,
    referenceRoot: issue3Root,
    skill: 'slides',
    inheritStyle: true,
    topic: '失败降级测试',
  });
  assert.equal(failLaunch.status, 200);
  assert.equal(failLaunch.data.ok, false);
  assert.ok(failLaunch.data.starter.includes('周刊'));
  assert.ok(failLaunch.data.starter.includes('#4'));
  assert.ok(failLaunch.data.starter.includes(issue3Root));
  assert.ok(failLaunch.data.starter.includes('失败降级测试'));
});

test('missing issue retains slot & number; forget removes it without renumbering others; dissolve ungroups without deleting files', async () => {
  const colRes = await apiJson('/api/columns/create', { name: '临时专栏', defaultType: 'slides' });
  const sid = colRes.data.column.seriesId;
  await apiJson('/api/columns/assign', { root: standaloneRoot, seriesId: sid, issueNumber: 1, skill: 'slides' });

  // Move standaloneRoot out temporarily to simulate missing folder
  const backupRoot = path.join(tmpDir, 'solo-backup');
  fs.renameSync(standaloneRoot, backupRoot);

  const viewMissing = listArtifactsViews();
  const missingItem = viewMissing.artifacts.find((a) => a.root === standaloneRoot);
  assert.equal(missingItem?.missing, true);
  assert.equal(missingItem?.seriesId, sid);
  assert.equal(missingItem?.issueNumber, 1);

  // Forget missing item
  const forgetRes = await apiJson('/api/forget', { root: standaloneRoot });
  assert.equal(forgetRes.data.ok, true);
  assert.equal(columnsStore.getMembership(wsDir, standaloneRoot, designHome), null);

  // Restore standaloneRoot and re-assign, then dissolve column and verify disk files remain
  fs.renameSync(backupRoot, standaloneRoot);
  await apiJson('/api/columns/assign', { root: standaloneRoot, seriesId: sid, issueNumber: 2, skill: 'slides' });
  const disRes = await apiJson('/api/columns/dissolve', { seriesId: sid });
  assert.equal(disRes.data.ok, true);
  assert.equal(fs.existsSync(path.join(standaloneRoot, 'project', 'deck.json')), true);
  assert.equal(listArtifactsViews().artifacts.find((a) => a.root === standaloneRoot)?.seriesId, null);
});

test('gallery HTML includes column grouping, issue badges, next-issue modal, clipboard fallback, and 100% i18n parity', () => {
  const zhHtml = galleryHtml('zh');
  const enHtml = galleryHtml('en');
  assert.ok(zhHtml.includes('bda-col-group'));
  assert.ok(zhHtml.includes('bda-issue-badge'));
  assert.ok(zhHtml.includes('openNextIssueDialog'));
  assert.ok(zhHtml.includes('openAssignColumnDialog'));
  assert.ok(zhHtml.includes('nextIssueCopiedFallback'));
  assert.ok(enHtml.includes('Group by column'));
  assert.ok(zhHtml.includes('按专栏分组'));
  assert.deepEqual(Object.keys(GALLERY_STR.zh).sort(), Object.keys(GALLERY_STR.en).sort());

  // Compile and execute the client script logic in a lightweight DOM sandbox
  const scriptMatch = zhHtml.match(/<script type="module">([\s\S]*?)<\/script>/);
  assert.ok(scriptMatch);
  const bodyCode = scriptMatch[1]
    .replace(/import\s*\{[^}]+\}\s*from\s*'[^']+';/, 'const embedArtifact = () => ({ destroy() {} });')
    + '\n;globalThis.__testHooks = { state, renderItems, openNextIssueDialog, showFilterMenu };';

  const els = new Map();
  const makeEl = (id) => {
    const el = {
      id,
      innerHTML: '',
      textContent: '',
      value: '',
      title: '',
      className: '',
      checked: true,
      disabled: false,
      style: {},
      dataset: {},
      attrs: {},
      classList: {
        _set: new Set(),
        add(c) { this._set.add(c); },
        remove(c) { this._set.delete(c); },
        toggle(c, force) { if (force === undefined ? !this._set.has(c) : force) this._set.add(c); else this._set.delete(c); },
        contains(c) { return this._set.has(c); },
      },
      setAttribute(k, v) { this.attrs[k] = String(v); },
      getAttribute(k) { return this.attrs[k] ?? null; },
      removeAttribute(k) { delete this.attrs[k]; },
      querySelectorAll() { return []; },
      querySelector() { return makeEl('q'); },
      closest() { return null; },
      focus() {},
      select() {},
      getBoundingClientRect() { return { left: 100, right: 200, bottom: 50 }; },
    };
    return el;
  };
  const getEl = (id) => {
    if (!els.has(id)) els.set(id, makeEl(id));
    return els.get(id);
  };

  let copiedToClipboard = '';
  const sandbox = {
    location: { href: 'http://127.0.0.1:3480/', search: '', pathname: '/' },
    history: { state: {}, replaceState() {}, pushState() {} },
    localStorage: { _m: new Map(), getItem(k) { return this._m.get(k) ?? null; }, setItem(k, v) { this._m.set(k, String(v)); } },
    navigator: { clipboard: { async writeText(txt) { copiedToClipboard = txt; } } },
    matchMedia: () => ({ matches: false }),
    IntersectionObserver: class { observe() {} unobserve() {} },
    EventSource: class { close() {} },
    URL,
    URLSearchParams,
    Intl,
    setTimeout,
    clearTimeout,
    addEventListener() {},
    removeEventListener() {},
    window: null,
    document: {
      documentElement: makeEl('html'),
      getElementById: getEl,
      querySelectorAll: () => [],
      querySelector: () => null,
      createElement: () => makeEl('dyn'),
      body: { appendChild() {} },
    },
    fetch: async (route) => {
      if (route === '/api/list') {
        return {
          json: async () => ({
            ok: true,
            workspaceName: 'test-ws',
            workspaceRoot: wsDir,
            columns: [{ seriesId: 'col_1', name: '周刊', description: '', defaultType: 'slides', pinned: false, sortOrder: 'desc' }],
            artifacts: [
              { root: issue1Root, skill: 'slides', title: '第1期', openedAt: new Date().toISOString(), pinned: false, seriesId: 'col_1', issueNumber: 1, columnName: '周刊' },
              { root: issue2Root, skill: 'slides', title: '第2期', openedAt: new Date().toISOString(), pinned: false, seriesId: 'col_1', issueNumber: 2, columnName: '周刊' },
            ],
            types: [],
          }),
        };
      }
      return {
        json: async () => ({
          ok: false,
          error: 'mock cli down',
          starter: '请为专栏「周刊」创作第 #3 期',
        }),
      };
    },
  };
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;

  vm.runInNewContext(bodyCode, sandbox);
  const { state, renderItems, openNextIssueDialog } = sandbox.__testHooks;
  state.loadedOnce = true;
  state.columns = [{ seriesId: 'col_1', name: '周刊', description: '', defaultType: 'slides', pinned: false, sortOrder: 'desc' }];
  state.artifacts = [
    { root: issue1Root, skill: 'slides', title: 'Alpha', openedAt: new Date().toISOString(), pinned: false, seriesId: 'col_1', issueNumber: 1, columnName: '周刊' },
    { root: issue2Root, skill: 'slides', title: 'Beta', openedAt: new Date().toISOString(), pinned: false, seriesId: 'col_1', issueNumber: 2, columnName: '周刊' },
    { root: standaloneRoot, skill: 'design', title: 'Solo', openedAt: new Date().toISOString(), pinned: false, seriesId: null, issueNumber: null, columnName: '' },
  ];

  // Grid view + search '周刊' matches column
  state.viewMode = 'grid';
  state.search = '周刊';
  renderItems();
  const containerHtmlGrid = getEl('container').innerHTML;
  assert.ok(containerHtmlGrid.includes('bda-col-group'));
  assert.ok(containerHtmlGrid.includes('#1') && containerHtmlGrid.includes('#2'));
  assert.ok(!containerHtmlGrid.includes('Solo'));

  // List view + search single issue title shows matched 1/2 badge
  state.viewMode = 'list';
  state.search = 'Beta';
  renderItems();
  const containerHtmlList = getEl('container').innerHTML;
  assert.ok(containerHtmlList.includes('bda-list'));
  assert.ok(containerHtmlList.includes('匹配 1/2 期'));

  // Next-issue dialog failure triggers automatic clipboard write + fallback toast
  state.search = '';
  openNextIssueDialog(state.columns[0], issue2Root);
  return (async () => {
    await getEl('niLaunchBtn').onclick();
    assert.equal(copiedToClipboard, '请为专栏「周刊」创作第 #3 期');
    assert.ok(getEl('toast').innerHTML.includes('已复制到剪贴板'));
  })();
});

test.after(async () => {
  server.closeAllConnections?.();
  await new Promise((resolve) => server.close(resolve));
  fs.rmSync(tmpDir, { recursive: true, force: true });
});
