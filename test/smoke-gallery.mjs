#!/usr/bin/env node
// 冒烟测试：用 mock host 激活 worker，触发 prototype.gallery 命令。
// 隔离在临时目录运行，不直接污染工作区或受 pluginRoot 护栏拦截。
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ps-gallery-smoke-'));
const wsDir = path.join(tmpDir, 'workspace');
fs.mkdirSync(wsDir, { recursive: true });

if (!process.env.ORCA_CLI_COMMAND) {
  const mockCli = path.join(tmpDir, 'mock-orca-cli.sh');
  fs.writeFileSync(mockCli, '#!/bin/sh\ncase "$1 $2" in\n  "tab list") echo \'{"ok":true,"result":{"tabs":[]}}\' ;;\n  "tab create") echo \'{"ok":true,"result":{"browserPageId":"mock"}}\' ;;\n  "tab switch") echo \'{"ok":true,"result":{"switched":0,"browserPageId":"mock"}}\' ;;\n  "tab current") echo \'{"ok":true,"result":{"tab":{"browserPageId":"mock","active":true}}}\' ;;\n  *) echo \'{"ok":true,"result":{}}\' ;;\nesac\n', { mode: 0o755 });
  process.env.ORCA_CLI_COMMAND = mockCli;
}

process.env.ORCA_STATE_FILE = path.join(tmpDir, 'prototype-studio-state.json');
process.env.ORCA_PROFILE_DB = path.join(tmpDir, 'nonexistent-profile.db');
process.env.ORCA_DESIGN_HOME = path.join(tmpDir, 'baoyu-design');
process.env.ORCA_GALLERY_PORT = String(39100 + Math.floor(Math.random() * 1000));
process.env.ORCA_GALLERY_SCRIPT = '/dev/null';

const workerUrl = new URL('../src/worker.js', import.meta.url);
const handlers = new Map();
const panelHandlers = new Map();

const orca = {
  log: (m) => console.log('[worker-log]', m),
  commands: Object.freeze({ register: async (id, fn) => { handlers.set(id, fn); } }),
  panels: Object.freeze({ handle: (id, fn) => { panelHandlers.set(id, fn); } }),
  events: Object.freeze({ on: () => {} }),
  host: Object.freeze({
    call: async (method) => {
      if (method === 'workspace.list') {
        return { workspaces: [{ path: wsDir, name: 'smoke-ws', branch: 'main', kind: 'local', id: 'local::' + wsDir }] };
      }
      if (method === 'workspace.readContext') {
        return { branch: 'main', displayName: 'smoke-ws', terminals: [] };
      }
      return {};
    },
    has: () => false,
  }),
};

try {
  const activate = (await import(workerUrl)).default;
  const workerHandle = await activate(orca);

  const gallery = handlers.get('prototype.gallery');
  if (!gallery) {
    console.error('FAIL: prototype.gallery 未注册');
    process.exitCode = 1;
  } else {
    const t0 = Date.now();
    const r1 = await gallery();
    console.log(`first  click -> ${JSON.stringify(r1)} (${Date.now() - t0}ms)`);
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
  workerHandle?.dispose?.();
} finally {
  fs.rmSync(tmpDir, { recursive: true, force: true });
}
