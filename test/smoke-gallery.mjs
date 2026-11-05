#!/usr/bin/env node
// 冒烟测试：用 mock host 激活 worker，触发 prototype.gallery 命令。
// 验证 openGalleryTab 不再因 orcaTab 未定义抛 ReferenceError（即点击不再显示“运行失败”），
// 且 2 秒节流（连点保护）生效。会真实调用 orca tab list/create —— tab create 是预期副作用。
const workerUrl = new URL('../src/worker.js', import.meta.url);

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
