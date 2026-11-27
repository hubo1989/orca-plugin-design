import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

import {
  isRemoteWorkspaceUri,
  isForbiddenWorkspacePath,
  parseActiveWorktreeId,
  validateWorkspacePath,
  resolveOrcaWorkspace,
} from '../src/workspace-guard.mjs';

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'orca-ws-guard-'));
const wsA = path.join(tmpRoot, 'ws-a');
const wsB = path.join(tmpRoot, 'ws-b');
const pluginRoot = path.join(tmpRoot, 'plugin-src');
const hostUserData = path.join(tmpRoot, 'host-userdata');
const installedPluginDir = path.join(hostUserData, 'plugins', 'hubo.prototype-studio', 'v1');
const designHome = path.join(hostUserData, 'baoyu-design');
for (const d of [wsA, wsB, pluginRoot, installedPluginDir, designHome]) {
  fs.mkdirSync(d, { recursive: true });
}

function makeProfileDb(filePath, activeWorktreeId) {
  const payload = JSON.stringify({ activeWorktreeId });
  execFileSync('sqlite3', [
    filePath,
    'CREATE TABLE IF NOT EXISTS profile_state_documents (domain TEXT PRIMARY KEY, payload TEXT NOT NULL);'
    + ` DELETE FROM profile_state_documents WHERE domain='workspaceSession';`
    + ` INSERT INTO profile_state_documents VALUES ('workspaceSession', '${payload.replace(/'/g, "''")}');`,
  ]);
}

const validateOptions = { pluginRoot, hostUserData, designHome };

test('resolveOrcaWorkspace: L1 / L2 / L3 / L4 hierarchy and NO_WORKSPACE ambiguity', async () => {
  const dbPath = path.join(tmpRoot, 'profile-l1.db');
  makeProfileDb(dbPath, `local::${wsA}`);

  // L1: Profile DB hit
  const l1 = await resolveOrcaWorkspace({
    profileDbPath: dbPath,
    listWorkspaces: async () => [{ id: 'w1', path: wsA, name: 'ws-a', branch: 'main', kind: 'local' }],
    readContext: async () => ({ branch: 'other', displayName: 'other', terminals: [] }),
    validateOptions,
  });
  assert.equal(l1.ok, true);
  assert.equal(l1.workspaceRoot, wsA);
  assert.equal(l1.source, 'L1-profile-db');

  // L1 live mode: host readContext overrides stale sqlite snapshot
  const l1Live = await resolveOrcaWorkspace({
    live: true,
    profileDbPath: dbPath,
    listWorkspaces: async () => [
      { id: 'w1', path: wsA, name: 'ws-a', branch: 'main', kind: 'local' },
      { id: 'w2', path: wsB, name: 'ws-b', branch: 'feat', kind: 'local' },
    ],
    readContext: async () => ({ branch: 'refs/heads/feat', displayName: 'ws-b', terminals: [] }),
    validateOptions,
  });
  assert.equal(l1Live.ok, true);
  assert.equal(l1Live.workspaceRoot, wsB);
  assert.equal(l1Live.source, 'L1-host-context');

  // L2: Agent event bridge
  const staleDb = path.join(tmpRoot, 'profile-stale.db');
  makeProfileDb(staleDb, `local::${path.join(tmpRoot, 'closed-ws')}`);
  const termMap = new Map([['term-1', 'w2']]);
  const l2 = await resolveOrcaWorkspace({
    profileDbPath: staleDb,
    terminalWorkspaceMap: termMap,
    listWorkspaces: async () => [
      { id: 'w1', path: wsA, name: 'ws-a', branch: 'main', kind: 'local' },
      { id: 'w2', path: wsB, name: 'ws-b', branch: 'feat', kind: 'local' },
    ],
    readContext: async () => ({ branch: '', displayName: '', terminals: [{ id: 'term-1' }] }),
    validateOptions,
  });
  assert.equal(l2.ok, true);
  assert.equal(l2.workspaceRoot, wsB);
  assert.equal(l2.source, 'L2-agent-bridge');

  // L3: readContext branch + displayName
  const l3 = await resolveOrcaWorkspace({
    profileDbPath: staleDb,
    listWorkspaces: async () => [
      { id: 'w1', path: wsA, name: 'ws-a', branch: 'main', kind: 'local' },
      { id: 'w2', path: wsB, name: 'ws-b', branch: 'feat', kind: 'local' },
    ],
    readContext: async () => ({ branch: 'refs/heads/main', displayName: 'ws-a', terminals: [] }),
    validateOptions,
  });
  assert.equal(l3.ok, true);
  assert.equal(l3.workspaceRoot, wsA);
  assert.equal(l3.source, 'L3-host-context');

  // L4: Single workspace fallback
  const l4 = await resolveOrcaWorkspace({
    profileDbPath: path.join(tmpRoot, 'missing.db'),
    listWorkspaces: async () => [{ id: 'w1', path: wsA, name: 'ws-a', branch: 'main', kind: 'local' }],
    readContext: async () => null,
    validateOptions,
  });
  assert.equal(l4.ok, true);
  assert.equal(l4.workspaceRoot, wsA);
  assert.equal(l4.source, 'L4-single-workspace');

  // Ambiguous multi-workspace without focus -> NO_WORKSPACE (never falls back to process.cwd())
  const ambiguous = await resolveOrcaWorkspace({
    profileDbPath: path.join(tmpRoot, 'missing.db'),
    listWorkspaces: async () => [
      { id: 'w1', path: wsA, name: 'ws-a', branch: 'main', kind: 'local' },
      { id: 'w2', path: wsB, name: 'ws-b', branch: 'feat', kind: 'local' },
    ],
    readContext: async () => null,
    validateOptions,
  });
  assert.equal(ambiguous.ok, false);
  assert.equal(ambiguous.code, 'NO_WORKSPACE');
  assert.equal(ambiguous.workspaceRoot, '');
  assert.equal(fs.existsSync(path.join(process.cwd(), '.design')), false);
});

test('validateWorkspacePath & parseActiveWorktreeId: blocks remote URIs and unmounted paths -> REMOTE_OR_UNMOUNTED', () => {
  const remoteThreePart = parseActiveWorktreeId('ssh-env::prod-host::/Users/me/project');
  assert.equal(remoteThreePart.isRemote, true);

  const remoteUris = [
    'ssh-remote://my-host/home/dev/app',
    'vscode-remote://ssh-remote+box/workspace',
    'dev-container://attached/app',
    'wsl+Ubuntu/home/user/proj',
    '\\\\wsl$\\Ubuntu\\home\\user\\proj',
    path.join(tmpRoot, 'does-not-exist-dir'),
  ];
  for (const uri of remoteUris) {
    const res = validateWorkspacePath(uri, validateOptions);
    assert.equal(res.ok, false, `should block ${uri}`);
    assert.equal(res.code, 'REMOTE_OR_UNMOUNTED', `expected REMOTE_OR_UNMOUNTED for ${uri}`);
  }
  assert.equal(isRemoteWorkspaceUri('ssh-remote://host/a'), true);
  assert.equal(isRemoteWorkspaceUri('file://' + wsA), false);
  const fileUriRes = validateWorkspacePath(`file://${wsA}`, validateOptions);
  assert.equal(fileUriRes.ok, true);
  assert.equal(fileUriRes.workspaceRoot, wsA);
});

test('validateWorkspacePath & isForbiddenWorkspacePath: blocks plugin dirs, symlinks to plugin dirs, and protected system paths -> FORBIDDEN_WORKSPACE_PATH', () => {
  const symlinkToPlugin = path.join(tmpRoot, 'link-to-plugin');
  fs.symlinkSync(installedPluginDir, symlinkToPlugin);

  const forbidden = [
    installedPluginDir,
    pluginRoot,
    hostUserData,
    designHome,
    symlinkToPlugin,
    '/',
    os.homedir(),
    '/System',
    '/Applications',
    '/etc',
    '/var',
    '/private/var',
    '/tmp',
    '/private/tmp',
    path.join(os.homedir(), '.ssh'),
    path.join(os.homedir(), '.aws'),
    path.join(os.homedir(), '.gnupg'),
  ];

  for (const target of forbidden) {
    assert.equal(isForbiddenWorkspacePath(target, validateOptions), true, `isForbiddenWorkspacePath should block ${target}`);
    if (fs.existsSync(target)) {
      const res = validateWorkspacePath(target, validateOptions);
      assert.equal(res.ok, false, `validateWorkspacePath should block ${target}`);
      assert.equal(res.code, 'FORBIDDEN_WORKSPACE_PATH', `expected FORBIDDEN_WORKSPACE_PATH for ${target}`);
      assert.equal(fs.existsSync(path.join(target, '.design')), false, `no .design created in ${target}`);
    }
  }

  // macOS /private/var/folders/... temp workspace must NOT be blocked
  const validTmpRes = validateWorkspacePath(wsA, validateOptions);
  assert.equal(validTmpRes.ok, true);
  assert.equal(validTmpRes.workspaceRoot, wsA);
  assert.equal(validTmpRes.realWorkspaceRoot, fs.realpathSync.native(wsA));
});

test('resolveOrcaWorkspace: live local host focus overrides stale remote Profile DB row', async () => {
  const remoteDb = path.join(tmpRoot, 'profile-remote.db');
  makeProfileDb(remoteDb, 'ssh-env::my-host::/remote/project');
  const res = await resolveOrcaWorkspace({
    live: true,
    listWorkspaces: async () => [{ id: 'w-a', path: wsA, name: 'ws-a', branch: 'feat-a', kind: 'local' }],
    readContext: async () => ({ branch: 'feat-a', displayName: 'ws-a', terminals: [] }),
    profileDbPath: remoteDb,
    validateOptions,
  });
  assert.equal(res.ok, true);
  assert.equal(res.workspaceRoot, wsA);
  assert.equal(res.source, 'L1-host-context');
});

test.after(() => {
  fs.rmSync(tmpRoot, { recursive: true, force: true });
});
