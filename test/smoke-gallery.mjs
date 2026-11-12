#!/usr/bin/env node
// 冒烟测试：用 mock host 激活 worker，触发 prototype.gallery 命令。
// 验证 openGalleryTab 不再因 orcaTab 未定义抛 ReferenceError（即点击不再显示“运行失败”），
// 且 2 秒节流（连点保护）生效。
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

if (!process.env.ORCA_CLI_COMMAND) {
  const mockCli = path.join(os.tmpdir(), 'mock-orca-cli.sh');
  fs.writeFileSync(mockCli, '#!/bin/sh\ncase "$1 $2" in\n  "tab list") echo \'{"ok":true,"result":{"tabs":[]}}\' ;;\n  "tab create") echo \'{"ok":true,"result":{"browserPageId":"mock"}}\' ;;\n  "tab switch") echo \'{"ok":true,"result":{"switched":0,"browserPageId":"mock"}}\' ;;\n  "tab current") echo \'{"ok":true,"result":{"tab":{"browserPageId":"mock","active":true}}}\' ;;\n  *) echo \'{"ok":true,"result":{}}\' ;;\nesac\n', { mode: 0o755 });
  process.env.ORCA_CLI_COMMAND = mockCli;
}

const workerUrl = new URL('../src/worker.js', import.meta.url);

// 封闭性：readState 优先读 STATE_FILE——写死本仓库路径，避免宿主焦点恰在
// 远程工作区时（activeWorktreeId 为远程三段式）smoke 误判失败
const STATE_FILE = path.join(os.tmpdir(), 'prototype-studio-state.json');
fs.writeFileSync(STATE_FILE, JSON.stringify({
  workspaceRoot: path.resolve(workerUrl.pathname, '../..'),
  workspaceName: 'orca-plugin-design',
}));

const handlers = new Map();
const panelHandlers = new Map();

const orca = {
  log: (m) => console.log('[worker-log]', m),
  // 真实宿主传入冻结对象（曾因此漏测 guardRegistration 的 TypeError），mock 保持一致
  commands: Object.freeze({ register: async (id, fn) => { handlers.set(id, fn); } }),
  panels: Object.freeze({ handle: (id, fn) => { panelHandlers.set(id, fn); } }),
  events: Object.freeze({ on: () => {} }),
  host: {
    call: async (method) => {
      if (method === 'workspace.list') {
        return { result: { workspaces: [] } };
      }
      return { result: {} };
    },
  },
};

const activate = (await import(workerUrl)).default;
await activate(orca);

const gallery = handlers.get('prototype.gallery');
if (!gallery) {
  console.error('FAIL: prototype.gallery 未注册');
  process.exit(1);
}

const t0 = Date.now();
const r1 = await gallery();
console.log(`first  click -> ${JSON.stringify(r1)} (${Date.now() - t0}ms)`);
// 宿主焦点恰在远程工作区时（profile 库 activeWorktreeId 为远程三段式），
// worker 的远程护栏会拒绝打开——这是设计行为，smoke 判 SKIP 不判 FAIL
if (r1 && r1.error && r1.error.includes('远程')) {
  console.log('SKIP: 宿主焦点当前在远程工作区，库页打开护栏按设计拒绝；切回本机工作区后重跑即全测');
  process.exit(0);
}
const r2 = await gallery();
console.log(`second click -> ${JSON.stringify(r2)}`);

if (r1 && r1.ok && !r1.error) {
  console.log('PASS: 命令正常 resolve，无 ReferenceError');
} else {
  console.error('FAIL: 命令返回失败');
  process.exit(1);
}
if (r2 && r2.throttled) {
  console.log('PASS: 2 秒连点节流生效');
} else {
  console.error('FAIL: 连点节流未生效');
  process.exit(1);
}
