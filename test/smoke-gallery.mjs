#!/usr/bin/env node
// 冒烟测试：用 mock host 激活 worker，触发 prototype.gallery 命令。
// 严格隔离测试环境，绝不挂死或残留子进程。
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

if (!process.env.ORCA_CLI_COMMAND) {
  const mockCli = path.join(tmpDir, 'mock-orca-cli.sh');
  fs.writeFileSync(mockCli, '#!/bin/sh\nif [ "$1" = "tab" ] && [ "$2" = "list" ]; then echo \'{"result":{"tabs":[]}}\'; exit 0; fi\nif [ "$1" = "tab" ] && [ "$2" = "create" ]; then echo \'{"result":{"tabId":"mock"}}\'; exit 0; fi\necho \'{}\'\n', { mode: 0o755 });
  process.env.ORCA_CLI_COMMAND = mockCli;
}

const workerUrl = new URL('../src/worker.js', import.meta.url);
const STATE_FILE = path.join(tmpDir, 'prototype-studio-state.json');
process.env.ORCA_STATE_FILE = STATE_FILE;
fs.writeFileSync(STATE_FILE, JSON.stringify({
  workspaceRoot: path.resolve(workerUrl.pathname, '../..'),
  workspaceName: 'orca-plugin-design',
}));

const handlers = new Map();
const panelHandlers = new Map();

const orca = {
  log: (m) => console.log('[worker-log]', m),
  commands: Object.freeze({ register: async (id, fn) => { handlers.set(id, fn); } }),
  panels: Object.freeze({ handle: (id, fn) => { panelHandlers.set(id, fn); } }),
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
  if (!gallery) {
    console.error('FAIL: prototype.gallery 未注册');
    process.exitCode = 1;
  } else {
    const t0 = Date.now();
    const r1 = await gallery();
    console.log(`first  click -> ${JSON.stringify(r1)} (${Date.now() - t0}ms)`);
    if (r1 && r1.error && r1.error.includes('远程')) {
      console.log('SKIP: 宿主焦点当前在远程工作区，库页打开护栏按设计拒绝');
    } else {
      const r2 = await gallery();
      console.log(`second click -> ${JSON.stringify(r2)}`);
      if (r1 && r1.ok && !r1.error) {
        console.log('PASS: 命令正常 resolve，无 ReferenceError');
      } else {
        console.error('FAIL: 命令返回失败');
        process.exitCode = 1;
      }
      if (r2 && r2.throttled) {
        console.log('PASS: 2 秒连点节流生效');
      } else {
        console.error('FAIL: 连点节流未生效');
        process.exitCode = 1;
      }
    }
  }
} finally {
  fs.rmSync(tmpDir, { recursive: true, force: true });
}
