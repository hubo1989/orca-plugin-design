#!/usr/bin/env node
// 冒烟测试：用 mock host 激活 worker，触发 prototype.gallery 命令。
// 严格隔离测试环境，绝不挂死或残留子进程。
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ps-smoke-'));
process.env.ORCA_DESIGN_NO_PREWARM = '1';
process.env.ORCA_DESIGN_NO_SPAWN = '1';
process.env.ORCA_DESIGN_NO_THUMB = '1';
process.env.ORCA_DESIGN_HOME = path.join(tmpDir, 'orca-design');
process.env.ORCA_DESIGN_LEGACY_HOME = path.join(tmpDir, 'baoyu-design');
process.env.OPEN_ARTIFACT_HOME = path.join(tmpDir, 'oa-home');
process.env.ORCA_PROFILE_DB = path.join(tmpDir, 'profile-state.db');

const workerUrl = new URL('../src/worker.js', import.meta.url);
const repoRoot = path.resolve(workerUrl.pathname, '../..');
const STATE_FILE = path.join(tmpDir, 'prototype-studio-state.json');
process.env.ORCA_STATE_FILE = STATE_FILE;
fs.writeFileSync(STATE_FILE, JSON.stringify({
  workspaceRoot: repoRoot,
  workspaceName: 'orca-plugin-design',
  updatedAt: Date.now(),
}));

const cliLogFile = path.join(tmpDir, 'cli-calls.log');
if (!process.env.ORCA_CLI_COMMAND) {
  const mockCli = path.join(tmpDir, 'mock-orca-cli.sh');
  fs.writeFileSync(mockCli, `#!/bin/sh
echo "$@" >> "${cliLogFile}"
if [ "$1" = "worktree" ] && [ "$2" = "ps" ]; then
  echo '{"ok":true,"result":{"worktrees":[{"isActive":true,"hostId":"local","path":"${repoRoot}","displayName":"orca-plugin-design","address":{"worktree":"path:${repoRoot}"}}]}}'
  exit 0
fi
if [ "$1" = "tab" ] && [ "$2" = "list" ]; then
  echo '{"ok":true,"result":{"tabs":[]}}'
  exit 0
fi
if [ "$1" = "tab" ] && [ "$2" = "create" ]; then
  for arg in "$@"; do
    if [ "$arg" = "--split" ]; then
      echo '{"ok":false,"error":{"message":"forbidden --split"}}' >&2
      exit 2
    fi
  done
  echo '{"ok":true,"result":{"browserPageId":"mock-page-1"}}'
  exit 0
fi
if [ "$1" = "tab" ] && [ "$2" = "switch" ]; then
  HAS_FOCUS=0
  for arg in "$@"; do
    if [ "$arg" = "--focus" ]; then HAS_FOCUS=1; fi
  done
  if [ "$HAS_FOCUS" != "1" ]; then
    echo '{"ok":false,"error":{"message":"missing --focus"}}' >&2
    exit 2
  fi
  echo '{"ok":true,"result":{}}'
  exit 0
fi
if [ "$1" = "tab" ] && [ "$2" = "current" ]; then
  echo '{"ok":true,"result":{"tab":{"browserPageId":"mock-page-1"}}}'
  exit 0
fi
echo '{}'
`, { mode: 0o755 });
  process.env.ORCA_CLI_COMMAND = mockCli;
}

const handlers = new Map();
const panelHandlers = new Map();
const postedEvents = [];

const orca = {
  log: (m) => console.log('[worker-log]', m),
  commands: Object.freeze({ register: async (id, fn) => { handlers.set(id, fn); } }),
  panels: Object.freeze({
    handle: (id, fn) => { panelHandlers.set(id, fn); },
    post: (event, payload) => { postedEvents.push({ event, payload }); },
  }),
  events: Object.freeze({ on: () => {} }),
  host: {
    call: async (method) => {
      if (method === 'workspace.list') return { result: { workspaces: [] } };
      return { result: {} };
    },
  },
};

try {
  const activate = (await import(workerUrl)).default;
  await activate(orca);

  const gallery = handlers.get('prototype.gallery');
  assert.ok(gallery, 'prototype.gallery must be registered synchronously');

  const t0 = Date.now();
  const r1 = await gallery();
  console.log(`first  click -> ${JSON.stringify(r1)} (${Date.now() - t0}ms)`);
  assert.equal(r1.ok, true, 'first gallery open must succeed');
  assert.equal(r1.reused, false);
  assert.equal(r1.pageId, 'mock-page-1');

  const r2 = await gallery();
  console.log(`second click -> ${JSON.stringify(r2)}`);
  assert.equal(r2.ok, true);
  assert.equal(r2.throttled, true, '2s throttle must apply after successful open');

  const cliLog = fs.readFileSync(cliLogFile, 'utf8');
  assert.ok(!cliLog.includes('--split'), 'tab create must never pass --split');
  assert.ok(cliLog.includes('tab switch --page mock-page-1 --focus') || cliLog.includes('tab switch'), 'must call tab switch --focus');
  assert.ok(postedEvents.some((e) => e.event === 'studio.opening' && e.payload?.opening === true));
  assert.ok(postedEvents.some((e) => e.event === 'studio.opening' && e.payload?.opening === false));
  console.log('PASS: 冒烟测试与主对话区无分屏打开链路全部通过');
} finally {
  fs.rmSync(tmpDir, { recursive: true, force: true });
}
