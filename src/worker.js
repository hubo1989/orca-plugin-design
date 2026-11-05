import { execFile, execFileSync } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import os from 'node:os';

const __filename = fileURLToPath(import.meta.url);
const pluginRoot = path.dirname(path.dirname(__filename));

const ORCA_BIN = process.env.ORCA_CLI_COMMAND || '/Applications/Orca.app/Contents/Resources/bin/orca';

// Design skills vendored from JimLiu/baoyu-design. Each ships a prebuilt artifact.mjs:
//   list <dir>             find this type's artifact roots (prints a JSON array)
//   open <root> --port n   start the editor server in the background, prints {"url"}
//   stop <root>            stop the background editor server
//   check <root>           validate a root, prints JSON with a problems count
const BAOYU_SKILLS_DIR = path.join(pluginRoot, 'vendor', 'baoyu-design', 'skills');
const SKILL_META = [
  { id: 'claude-design', name: '画布', icon: '🎨', port: 3470 },
  { id: 'claude-slides', name: '幻灯片', icon: '🖼️', port: 3471 },
  { id: 'claude-design-system', name: '设计系统', icon: '🧩', port: 3473 },
  { id: 'claude-motion', name: '动效影片', icon: '🎬', port: 3474 },
];

// Minimal example scaffolds, each validated with `artifact.mjs check` (problems == 0).
// dashboard/motion have no static scaffold: their roots are created by agents
// (dashboard via its doc files, motion via the editor's first write-db).
const EXAMPLE_TEMPLATES = {
  'claude-design': {
    dirName: 'design-demo',
    files: {
      'project/canvas.json': (now) => JSON.stringify({
        v: 3, createdOnFiles: { v: 1, at: now }, title: '示例画布', launch: { view: 'canvas' },
        pages: [], boards: { 'Main.dc.html': { x: 0, y: 0, w: 880, h: 560, title: '欢迎' } },
        order: ['Main.dc.html'], notes: {}, designSystems: [],
      }),
      'project/Main.dc.html':
        '<!doctype html><html><head><meta charset="utf-8"><script src="./support.js"></script>'
        + '<style>body{margin:0;font-family:-apple-system,sans-serif}'
        + 'x-dc{display:block;width:880px;height:560px;background:#0ea5e9;color:#fff;'
        + 'display:flex;align-items:center;justify-content:center}h1{font-size:64px}</style></head>'
        + '<body><x-dc><h1>Hello Canvas</h1></x-dc>\n'
        + '<script type="text/x-dc" data-dc-script data-props=\'{"$preview":{"width":880,"height":560}}\'>'
        + 'class Component extends DCLogic {}</script>\n</body></html>',
    },
  },
  'claude-slides': {
    dirName: 'slides-demo',
    files: {
      'project/deck.json': (now) => JSON.stringify({
        v: 4, createdOnFiles: { v: 1, at: now }, lists: 'css', title: '示例演示',
        order: ['cover'], cover: 'cover', sections: {}, faces: {}, designSystems: [],
      }),
      'project/slides/cover.html':
        '<section style="background:#1e293b;color:#fff;display:flex;align-items:center;'
        + 'justify-content:center"><h1 style="font-size:96px;font-family:-apple-system,sans-serif">'
        + '示例演示</h1></section>',
    },
  },
  'claude-design-system': {
    dirName: 'design-system-demo',
    files: {
      'project/design-system.json': (now) => JSON.stringify({
        v: 3, layout: 'files', createdOnFiles: { v: 1, at: now }, title: '示例设计系统',
        namespace: 'ExampleDesignSystem', libraries: [], sections: {}, groups: [],
        assetGroups: {}, blobs: {}, docs: { readme: 'project/README.md', sections: [] },
        lastChange: { by: 'prototype-studio', at: now, via: 'Orca plugin', note: 'Example scaffold' },
      }),
      'project/README.md': '# 示例设计系统\n\n由 Prototype Studio 创建的示例骨架。让工作区 agent 参考本目录继续完善。\n',
      'project/tokens.json': '{}',
    },
  },
};

// Editors this worker started: root -> { skill, url }
const openEditors = new Map();

function artifactCli(skillId) {
  return path.join(BAOYU_SKILLS_DIR, skillId, 'scripts', 'artifact.mjs');
}

function runNode(args) {
  return new Promise((resolve) => {
    execFile(process.execPath, args, { timeout: 30000 }, (err, stdout, stderr) => {
      resolve({ err, stdout: String(stdout || ''), stderr: String(stderr || '') });
    });
  });
}

// Orca CLI 通用执行器（tab list/switch 用）。错误一律 resolve、绝不 reject，
// 让 tab 复用检查的任何失败都退化为“新建 tab”路径，而不是让命令失败。
function orcaTab(args) {
  return new Promise((resolve) => {
    execFile(ORCA_BIN, args, { timeout: 3000 }, (err, stdout, stderr) => {
      resolve({ err, stdout: String(stdout || ''), stderr: String(stderr || '') });
    });
  });
}

function orcaTabCreate(url) {
  return new Promise((resolve) => {
    execFile(ORCA_BIN, ['tab', 'create', '--url', url, '--split', 'right'], { timeout: 8000 }, (err) => {
      resolve(err ? err.message : null);
    });
  });
}

export default async function activate(orca) {
  orca.log('Prototype Studio worker activating...');

  // 系统性保险：处理器异常一律转 {ok:false,error}，绝不让 rejection 冒泡到宿主
  // （Orca 只会弹“运行失败”且不给出错信息）。宿主的 orca.commands/panels 是冻结对象，
  // 不能改写其方法——统一经本地 reg()/handle() 包装器注册。
  const safeHandler = (id, fn) => async (input) => {
    try {
      return await fn(input);
    } catch (err) {
      orca.log(`handler ${id} error: ${err && err.stack || err}`);
      return { ok: false, error: String((err && err.message) || err) };
    }
  };
  const reg = (id, fn) => orca.commands.register(id, safeHandler(id, fn));
  const handle = (id, fn) => orca.panels.handle(id, safeHandler(id, fn));

  // Focused workspace: readContext gives identity only (branch/name/terminals, no
  // path); the path comes from workspace.list cross-matching. No blind fallback:
  // a wrong guess writes files into the wrong workspace.
  let workspaceRoot = '';
  let workspaceName = '';
  let openedWorkspaces = [];

// 真实安装路径：Orca 把插件复制到 <userData>/plugins/<pluginKey>/<hash>/。
// 只有工作区等于/位于安装根目录内部时才拒绝写入；源码 worktree、dist 打包源都不是安装路径。
function installRoot() {
  const home = process.env.HOME || os.homedir();
  if (process.platform === 'darwin') return path.join(home, 'Library', 'Application Support', 'orca', 'plugins');
  if (process.platform === 'win32') return path.join(process.env.APPDATA || path.join(home, 'AppData', 'Roaming'), 'orca', 'plugins');
  return path.join(process.env.XDG_CONFIG_HOME || path.join(home, '.config'), 'orca', 'plugins');
}
function isInstalledPluginPath(target) {
  const root = path.resolve(installRoot());
  const p = path.resolve(String(target || ''));
  return p === root || p.startsWith(root + path.sep);
}

  const STATE_FILE = path.join(os.tmpdir(), 'prototype-studio-state.json');
  function writeState() { /* 状态由项目库服务自行从 Orca profile 库解析，worker 不再写入 */ }

  async function refreshWorkspaces() {
    try {
      const listed = await orca.host.call('workspace.list', { opened: true })
        .catch(() => orca.host.call('workspace.list').catch(() => null));
      openedWorkspaces = listed?.workspaces ?? [];
    } catch {
      openedWorkspaces = [];
    }
  }

  // agent.status.changed 事件自带 workspaceId + terminalId，而 readContext.terminals
  // 恰是焦点工作区的终端 id：以终端 id 为桥，可精确反查焦点工作区（官方 API，
  // 无名称猜测）。仅在焦点工作区从未跑过 agent 时退回唯一字段匹配。
  const terminalWorkspace = new Map();

  function rememberAgentEvent(e) {
    if (!e?.terminalId || !e?.workspaceId) return;
    terminalWorkspace.set(e.terminalId, String(e.workspaceId));
    if (terminalWorkspace.size > 300) {
      terminalWorkspace.delete(terminalWorkspace.keys().next().value);
    }
  }

  function matchWorkspaceId(rawId) {
    const s = String(rawId);
    const pathPart = s.includes('::') ? s.split('::').pop() : null;
    return openedWorkspaces.find((w) => w.id === s || (pathPart && w.path === pathPart)) || null;
  }

  // 焦点解析优先读 Orca profile 库的 activeWorktreeId（权威、即时，格式 <uuid>::<path>），
  // 消除 agent 事件桥接的冷启动等待；事件桥与唯一字段匹配仅作回退。
  const PROFILE_DB = path.join(os.homedir(), 'Library', 'Application Support', 'orca', 'profiles', 'local-default', 'profile-state.db');

  function focusedFromProfile() {
    try {
      const out = execFileSync('sqlite3', [PROFILE_DB,
        "SELECT payload FROM profile_state_documents WHERE domain='workspaceSession'"],
        { timeout: 3000, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
      const ws = JSON.parse(out);
      const id = ws.activeWorktreeId || '';
      const p = id.includes('::') ? id.split('::').pop() : '';
      if (!p) return null;
      return { path: p, name: p.split('/').filter(Boolean).pop() || '' };
    } catch {
      return null;
    }
  }

  async function resolveFocusedWorkspace() {
    // ① 权威：profile 库 activeWorktreeId（与 workspace.list 交叉确认存在）
    await refreshWorkspaces();
    const fromProfile = focusedFromProfile();
    if (fromProfile) {
      const known = openedWorkspaces.find((w) => w.path === fromProfile.path);
      if (known) return known;
      // 未在 opened 列表（未打开但被聚焦）也接受路径事实
      return { ...fromProfile, branch: null, id: '' };
    }
    // ② 回退：agent 事件桥（terminalId → workspaceId）
    const ctx = await orca.host.call('workspace.readContext').catch(() => null);
    if (!ctx) return null;
    const ids = new Set();
    for (const t of ctx.terminals || []) {
      const known = terminalWorkspace.get(t.id);
      if (known) ids.add(known);
    }
    if (ids.size === 1) {
      const hit = matchWorkspaceId([...ids][0]);
      if (hit) return hit;
    }
    // ③ 回退：branch+displayName 唯一命中
    const candidates = openedWorkspaces.filter((w) =>
      w.branch === ctx.branch && w.name === ctx.displayName);
    if (candidates.length === 1) return candidates[0];
    orca.log(`Workspace unresolved: ${ids.size} terminal ids, ${candidates.length} name matches`);
    return null;
  }

  const focusedAtStart = await resolveFocusedWorkspace();
  workspaceRoot = focusedAtStart?.path ?? '';
  workspaceName = focusedAtStart?.name ?? '';
  writeState();
  orca.log(`Focused workspace: ${workspaceName || '(unresolved)'} ${workspaceRoot}`);

  // Keep focus and the opened-workspace set in sync
  let workspaceGeneration = 0;
  let reresolveTimer = null;
  function scheduleReresolve() {
    if (reresolveTimer) return;
    reresolveTimer = setTimeout(async () => {
      reresolveTimer = null;
      const generation = ++workspaceGeneration;
      const hit = await resolveFocusedWorkspace();
      if (generation !== workspaceGeneration) return;
      const nextRoot = hit?.path ?? '';
      if (nextRoot !== workspaceRoot) {
        workspaceRoot = nextRoot;
        workspaceName = hit?.name ?? '';
        writeState();
        orca.log(`Focused workspace: ${workspaceName || '(unresolved)'} ${workspaceRoot}`);
      }
    }, 800);
  }

  if (orca.events?.on) {
    orca.events.on('agent.status.changed', (e) => {
      rememberAgentEvent(e);
      // 新到的 agent 事件可能让先前未识别的焦点变得可识别
      if (!workspaceRoot) scheduleReresolve();
    });
    orca.events.on('workspace.changed', async () => {
      const generation = ++workspaceGeneration;
      workspaceRoot = '';
      workspaceName = '';
      const hit = await resolveFocusedWorkspace();
      if (generation !== workspaceGeneration) return;
      workspaceRoot = hit?.path ?? '';
      workspaceName = hit?.name ?? '';
      writeState();
      orca.log(`Focused workspace: ${workspaceName || '(unresolved)'} ${workspaceRoot}`);
    });
  }

  // artifact.mjs's own `list` finds *design systems*, not per-type roots, so we scan
  // marker files ourselves. dashboard/motion roots are created via write-db; their
  // markers are best-effort guesses (index.json / scenes.json / voice.json).
  const ROOT_MARKERS = {
    'claude-design': ['project/canvas.json'],
    'claude-slides': ['project/deck.json'],
    'claude-design-system': ['project/design-system.json'],
    'claude-motion': ['project/scenes.json', 'project/voice.json'],
  };

  // 扫描指定工作区（深度 2，覆盖 designs/<proj> 与根级项目）。
  // root 为空时不扫描：绝不把别的目录当成“当前工作区”。
  function scanDesignProjects(rootDir) {
    const bySkill = {};
    for (const id of Object.keys(ROOT_MARKERS)) bySkill[id] = [];
    if (!rootDir) return bySkill;
    const SKIP = new Set(['.git', 'node_modules', '.orca', 'vendor', 'dist', '.venv', '__pycache__', 'build']);
    (function walk(dir, depth) {
      if (depth > 2) return;
      let entries;
      try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
      for (const e of entries) {
        if (!e.isDirectory() || SKIP.has(e.name)) continue;
        const p = path.join(dir, e.name);
        if (isInstalledPluginPath(p)) continue; // 不扫描插件安装目录
        let matched = false;
        for (const [skill, markers] of Object.entries(ROOT_MARKERS)) {
          for (const mk of markers) {
            if (fs.existsSync(path.join(p, mk))) {
              let title = null;
              try { title = JSON.parse(fs.readFileSync(path.join(p, mk), 'utf8')).title || null; } catch { /* folder name */ }
              bySkill[skill].push({ title: title || e.name, root: p });
              matched = true;
              break;
            }
          }
          if (matched) break;
        }
        if (!matched) walk(p, depth + 1);
      }
    })(rootDir, 0);
    for (const id of Object.keys(bySkill)) {
      bySkill[id].sort((a, b) => a.title.localeCompare(b.title));
    }
    return bySkill;
  }

  async function openSkillEditor(skillId, rootInput, wsPath) {
    const meta = SKILL_META.find((s) => s.id === skillId);
    if (!meta) return { ok: false, error: `unknown skill: ${skillId}` };
    const cli = artifactCli(skillId);
    if (!fs.existsSync(cli)) return { ok: false, error: `skill not vendored: ${skillId}` };

    let root = rootInput;
    if (!root) {
      const roots = (scanDesignProjects(wsPath || workspaceRoot)[skillId]) || [];
      if (roots.length === 0) {
        return { ok: false, error: `no ${skillId} project found under ${workspaceRoot || '(no workspace)'}` };
      }
      root = roots[0].root;
    }

    const r = await runNode([cli, 'open', root, '--port', String(meta.port)]);
    if (r.err) return { ok: false, error: `artifact open failed: ${r.stderr || r.err.message}` };
    const m = r.stdout.match(/\{[\s\S]*"url"[\s\S]*\}/);
    if (!m) return { ok: false, error: `no url in artifact output: ${r.stdout.slice(0, 200)}` };
    let url;
    try {
      url = JSON.parse(m[0]).url;
    } catch {
      return { ok: false, error: `unparsable artifact output: ${r.stdout.slice(0, 200)}` };
    }
    openEditors.set(root, { skill: skillId, url });
    orca.log(`Skill editor up: ${skillId} -> ${url}`);

    const tabError = await orcaTabCreate(url);
    if (tabError) orca.log(`Browser tab create failed: ${tabError}`);
    return { ok: true, url, ...(tabError ? { tabError } : {}) };
  }

  async function stopSkillEditor(skillId, root) {
    // artifactCli 对非字符串 skillId 会直接 TypeError（path.join），先挡掉
    if (typeof skillId !== 'string' || !SKILL_META.some((s) => s.id === skillId)) {
      return { ok: false, error: `未知技能 id: ${String(skillId)}` };
    }
    const cli = artifactCli(skillId);
    if (!fs.existsSync(cli)) return { ok: false, error: `skill not vendored: ${skillId}` };
    const r = await runNode([cli, 'stop', root]);
    openEditors.delete(root);
    if (r.err) return { ok: false, error: `artifact stop failed: ${r.stderr || r.err.message}` };
    orca.log(`Skill editor stopped: ${skillId} ${root}`);
    return { ok: true };
  }

  async function createExample(skillId, nameInput, wsPath) {
    const tpl = EXAMPLE_TEMPLATES[skillId];
    if (!tpl) {
      return { ok: false, error: `${skillId} 项目由 agent 创建（本类型无静态示例模板）` };
    }
    // 设计系统按项目全局唯一：一个工作区只允许一套统一规范
    if (skillId === 'claude-design-system') {
      const existing = scanDesignProjects(workspaceRoot || wsPath)['claude-design-system'] || [];
      if (existing.length > 0) {
        return { ok: false, error: '当前工作区已有设计系统（全项目统一参考）；如需更换请先删除' };
      }
    }
    let base = wsPath || workspaceRoot;
    if (!base) {
      // worker 刚启动 / agent 事件未到的过渡窗口：主动重解析一次，
      // 而不是直接把“未识别”抛给用户。
      const hit = await resolveFocusedWorkspace();
      base = hit?.path ?? '';
      if (base) {
        workspaceRoot = base;
        workspaceName = hit.name;
        writeState();
      }
    }
    if (!base) return { ok: false, error: '当前工作区未识别：请让本工作区的 agent 产生一次状态事件，或稍后重试' };
    if (isInstalledPluginPath(base)) {
      return { ok: false, error: '当前工作区是 Orca 插件安装路径，请切换到其他工作区创建设计项目' };
    }
    const safe = String(nameInput || '').replace(/[^A-Za-z0-9_-]/g, '').slice(0, 40);
    const baseName = safe || tpl.dirName;
    const designDir = path.join(base, '.design');
    // 允许多次创建：同名时自动追加 -2 / -3 …，不覆盖已有项目
    let name = baseName;
    let i = 2;
    while (fs.existsSync(path.join(designDir, name))) {
      name = `${baseName}-${i++}`;
    }
    const root = path.join(designDir, name);
    const now = new Date().toISOString().replace(/\.\d+Z$/, 'Z');
    try {
      for (const [rel, content] of Object.entries(tpl.files)) {
        const p = path.join(root, rel);
        fs.mkdirSync(path.dirname(p), { recursive: true });
        fs.writeFileSync(p, typeof content === 'function' ? content(now) : content);
      }
    } catch (err) {
      return { ok: false, error: `项目写入失败（${err.code || ''} ${err.message}）：${root}` };
    }
    const r = await runNode([artifactCli(skillId), 'check', root]);
    let problems = null;
    try { problems = JSON.parse(r.stdout).problems ?? null; } catch { /* keep null */ }
    orca.log(`Example created: ${root} (problems=${problems})`);
    return { ok: true, root, problems };
  }

  // 限定在 <工作区>/.design/<单层目录>：禁止 ../ 穿越与插件树内操作
  function safeDesignRoot(raw) {
    const root = path.resolve(String(raw || ''));
    const base = path.resolve(workspaceRoot || '');
    const designDir = path.join(base, '.design');
    if (!workspaceRoot || !root.startsWith(designDir + path.sep)) {
      return { ok: false, error: '项目路径不在当前工作区 .design/ 内' };
    }
    if (path.dirname(root) !== designDir || !fs.existsSync(path.join(root, 'project'))) {
      return { ok: false, error: '不是有效的设计项目' };
    }
    if (isInstalledPluginPath(root)) return { ok: false, error: '拒绝操作插件安装目录' };
    return { ok: true, root, designDir };
  }

  async function renameDesignRoot(skillId, rawRoot, newNameInput) {
    const guard = safeDesignRoot(rawRoot);
    if (!guard.ok) return guard;
    const name = String(newNameInput || '').replace(/[^A-Za-z0-9_-]/g, '').slice(0, 40);
    if (!name) return { ok: false, error: '名称只能包含字母、数字、下划线和连字符' };
    const dest = path.join(guard.designDir, name);
    if (dest === guard.root) return { ok: true, root: guard.root };
    if (fs.existsSync(dest)) return { ok: false, error: '同名目录已存在' };
    if (openEditors.has(guard.root)) await stopSkillEditor(skillId, guard.root).catch(() => {});
    try {
      fs.renameSync(guard.root, dest);
    } catch (err) {
      return { ok: false, error: `重命名失败: ${err.message}` };
    }
    // 同步更新索引里的标题（deck/canvas/design-system 均有 title 字段）
    const marker = (ROOT_MARKERS[skillId] || [])[0];
    if (marker) {
      const idxPath = path.join(dest, marker);
      try {
        const idx = JSON.parse(fs.readFileSync(idxPath, 'utf8'));
        idx.title = name;
        fs.writeFileSync(idxPath, JSON.stringify(idx, null, 2));
      } catch (err) {
        orca.log(`rename: 索引 title 更新失败: ${err.message}`);
      }
    }
    orca.log(`Renamed: ${guard.root} -> ${dest}`);
    return { ok: true, root: dest };
  }

  async function removeDesignRoot(skillId, rawRoot) {
    const guard = safeDesignRoot(rawRoot);
    if (!guard.ok) return guard;
    if (openEditors.has(guard.root)) await stopSkillEditor(skillId, guard.root).catch(() => {});
    // 二次确认在面板侧完成；这里只删除合法项目目录，绝不执行任意路径删除
    try {
      // force:true：二次确认后目录已被移走视为成功（幂等），其余错误转 {ok:false}
      fs.rmSync(guard.root, { recursive: true, force: true });
    } catch (err) {
      return { ok: false, error: `删除失败: ${err.message}` };
    }
    orca.log(`Removed: ${guard.root}`);
    return { ok: true };
  }

  // ---- 项目库：独立 detached 服务（固定 3480），worker 被回收也不影响库页 ----
  const GALLERY_PORT = 3480;
  const GALLERY_URL = `http://127.0.0.1:${GALLERY_PORT}/`;
  const GALLERY_SCRIPT = path.join(pluginRoot, 'src', 'gallery-server.mjs');

  async function galleryAlive() {
    try {
      const r = await fetch(`${GALLERY_URL}api/list`, { signal: AbortSignal.timeout(1200) });
      return r.ok;
    } catch { return false; }
  }

  // 服务探测只做一次快速健康检查（1200ms），失败则后台 spawn，不阻塞开 tab。
  // 冷启动路径必须 < 1s：状态栏点击直接切/开 tab，库页自己会重试 API。
  let gallerySpawnInFlight = null;
  async function ensureGallery() {
    if (await galleryAlive()) return true;
    if (!gallerySpawnInFlight) {
      gallerySpawnInFlight = new Promise((resolve) => {
        const child = execFile(process.execPath, [GALLERY_SCRIPT], { detached: true, stdio: 'ignore' }, (err) => {
          if (err) orca.log(`gallery spawn error: ${err.message}`);
          resolve();
        });
        child.unref();
      }).finally(() => { gallerySpawnInFlight = null; });
    }
    return false;
  }

  // 连点保护：同一次打开的 2 秒内重复点击直接返回，且命令串行执行
  let galleryOpenInFlight = null;
  let lastGalleryOpenAt = 0;
  // 即时反馈：点击后状态栏条目立刻变「打开中」，完成/失败后恢复。
  // statusBar.update 自 Orca 1.4.248 提供（plugin-private，无需 capability）；失败静默忽略。
  // tab 复用快路径：worker 常驻期间轮询缓存 tab 列表（30s 一次 + 打开后立即刷新），
  // 点击时若缓存里已有库页 tab 直接 switch——完全绕开 tab list 挂起（实测重装重启瞬间
  // CLI 子进程可挂 8s）。switch 失败再回退 create。
  let cachedGalleryPageId = null;
  let tabCacheTimer = null;
  async function refreshTabCache() {
    const r = await orcaTab(['tab', 'list', '--json']);
    if (r.err) return;
    try {
      const tabs = JSON.parse(r.stdout).result?.tabs || [];
      const hit = tabs.find((t) => String(t.url || '').startsWith(GALLERY_URL));
      cachedGalleryPageId = hit ? hit.browserPageId : null;
    } catch { cachedGalleryPageId = null; }
  }
  function startTabCacheLoop() {
    if (tabCacheTimer) return;
    refreshTabCache().catch(() => {});
    tabCacheTimer = setInterval(() => refreshTabCache().catch(() => {}), 30000);
    tabCacheTimer.unref?.();
  }
  const SB_IDLE = { id: 'gallery', text: 'Design', icon: 'layers', tone: 'accent' };
  function sbUpdate(patch) {
    try {
      const r = orca.host.call('statusBar.update', patch);
      if (r && typeof r.catch === 'function') r.catch(() => {});
    } catch { /* 老版本宿主无此方法，忽略 */ }
  }
  function galleryLoading(on) {
    sbUpdate(on
      ? { id: 'gallery', text: '⟳ 打开中…', tone: 'accent', tooltip: 'Prototype Studio · 正在打开项目库' }
      : { ...SB_IDLE, tooltip: 'Prototype Studio · 打开设计项目库' });
  }
  async function openGalleryTab() {
    if (galleryOpenInFlight) return galleryOpenInFlight;
    // 节流只在“上次成功打开”后 2 秒内生效：失败后的立即重试不被吞掉
    if (Date.now() - lastGalleryOpenAt < 2000) return { ok: true, reused: true, throttled: true };
    const T0 = Date.now();
    const lap = (name) => orca.log(`gallery-open ${name} +${Date.now() - T0}ms`);
    galleryLoading(true);
    galleryOpenInFlight = (async () => {
      try {
        lap('start');
        // 原则：无论什么状态，先把面板打开（加载屏在库页内自行显示并轮询就位）。
        // 服务探测/spawn、tab 缓存刷新全部不阻塞“切换/新建 tab”这一步。
        ensureGallery().catch((e) => orca.log(`gallery ensure: ${e.message}`)); // 后台拉起服务
        refreshTabCache().catch(() => {}); // 后台刷新缓存，供下次点击走快路径

        // 快路径①：缓存里已知库页 tab → 直接 switch（绕过 tab list）
        if (cachedGalleryPageId) {
          const sw = await orcaTab(['tab', 'switch', '--page', cachedGalleryPageId, '--focus']);
          lap('tab-switch(cached)');
          if (!sw.err) {
            lastGalleryOpenAt = Date.now();
            return { ok: true, reused: true };
          }
          cachedGalleryPageId = null; // 缓存失效
        }
        // 快路径②：现场 list（超时 3s），找到库页 tab 就 switch
        try {
          const listed = await orcaTab(['tab', 'list', '--json']);
          lap('tab-list');
          if (!listed.err) {
            const tabs = JSON.parse(listed.stdout).result?.tabs || [];
            const hit = tabs.find((t) => String(t.url || '').startsWith(GALLERY_URL));
            if (hit) {
              const sw = await orcaTab(['tab', 'switch', '--page', hit.browserPageId, '--focus']);
              lap('tab-switch');
              if (!sw.err) { lastGalleryOpenAt = Date.now(); return { ok: true, reused: true }; }
              orca.log(`gallery tab switch failed, creating new: ${sw.err.message || sw.err}`);
            }
          }
        } catch { /* fall through to create */ }
        // 最后一步：新建 tab（加载屏由库页自身展示）
        const tabError = await orcaTabCreate(GALLERY_URL);
        if (!tabError) refreshTabCache().catch(() => {});
        lap('tab-create');
        if (tabError) return { ok: false, error: tabError };
        lastGalleryOpenAt = Date.now();
        return { ok: true, reused: false };
      } finally {
        galleryOpenInFlight = null;
        galleryLoading(false);
        orca.log(`gallery-open done total ${Date.now() - T0}ms`);
      }
    })();
    return galleryOpenInFlight;
  }

  if (orca.panels?.handle) {
    handle('studio.status', async () => {
      return {
        ok: true,
        workspaceRoot,
        workspaceName,
        workspaces: openedWorkspaces.map((w) => ({ name: w.name, path: w.path, kind: w.kind, branch: w.branch })),
        editors: [...openEditors.entries()].map(([root, e]) => ({ root, ...e })),
      };
    });

    handle('studio.gallery.open', async () => openGalleryTab());

    handle('studio.restart', async () => {
      // 重启插件 worker（服务为独立进程，不受影响）
      try {
        const manifest = JSON.parse(fs.readFileSync(path.join(pluginRoot, 'orca-plugin.json'), 'utf8'));
        // 安装副本的 key 是 <publisher>.<id>（package.sh 注入 publisher）；dev 模式是 local.<id>
        const pluginKey = manifest.publisher ? `${manifest.publisher}.${manifest.id}` : `local.${manifest.id}`;
        execFile(ORCA_BIN, ['plugin', 'restart', pluginKey], () => {});
        return { ok: true, restarting: true };
      } catch (err) {
        return { ok: false, error: String(err && err.message || err) };
      }
    });

    handle('studio.debug', async () => {
      const ctx = await orca.host.call('workspace.readContext').catch((e) => ({ error: String(e) }));
      return { ok: true, ctx, workspaces: openedWorkspaces };
    });

    handle('studio.skills', async (input) => {
      const found = scanDesignProjects(input?.wsPath || workspaceRoot);
      const out = [];
      for (const s of SKILL_META) {
        out.push({
          id: s.id, name: s.name, icon: s.icon,
          canCreateExample: Boolean(EXAMPLE_TEMPLATES[s.id]),
          roots: found[s.id] || [],
        });
      }
      return { ok: true, skills: out };
    });

    handle('studio.skill.open', async (input) => {
      return openSkillEditor(input?.skill, input?.root, input?.wsPath);
    });

    handle('studio.skill.stop', async (input) => {
      return stopSkillEditor(input?.skill, input?.root);
    });

    handle('studio.skill.restart', async (input) => {
      await stopSkillEditor(input?.skill, input?.root);
      return openSkillEditor(input?.skill, input?.root, input?.wsPath);
    });

    handle('studio.skill.create', async (input) => {
      return createExample(input?.skill, input?.name, input?.wsPath);
    });

    handle('studio.skill.rename', async (input) => {
      return renameDesignRoot(input?.skill, input?.root, input?.name);
    });

    // 面板必须传 confirm: true（二次确认），否则拒绝删除
    handle('studio.skill.remove', async (input) => {
      if (input?.confirm !== true) return { ok: false, error: '需要二次确认' };
      return removeDesignRoot(input?.skill, input?.root);
    });
  }

  // Palette commands: open each skill's first discovered project
  for (const s of SKILL_META) {
    reg(`prototype.skill.${s.id}`, async () => {
      return openSkillEditor(s.id, '');
    });
  }

  // Status bar item / shortcut: open the standalone gallery (ensures service first)
  // 状态栏条目运行期反馈：Orca 的 statusBarItems 是 manifest 声明式字段，
  // worker 无 UI API 可写它。可达的即时反馈通道是 tab 侧：先切/开 tab（URL 带
  // #opening 哈希，库页读到即显示加载动画），服务冷启动时库页自己每 500ms
  // 重试 /api/list——点击到看到动画的间隔 = tab switch/create 的 ~0.2-1s。
  reg('prototype.gallery', async () => openGalleryTab());

  // 项目库内打开编辑器不再另开标签：iframe 同页跳转由库页自身完成
  // （保留 openSkillEditor 供 /api/open 与 palette 命令返回编辑器 url）

  // 激活预热：worker 常驻（有 statusBarItems 的插件保持运行）——
  // ① 服务提前拉起（点击时无冷启动）② tab 缓存循环启动（点击走 switch 快路径）
  startTabCacheLoop();
  galleryAlive().then((alive) => { if (!alive) ensureGallery().catch(() => {}); });
  orca.log('Prototype Studio worker activated successfully.');
}
