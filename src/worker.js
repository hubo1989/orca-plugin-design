import { execFile, execFileSync } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import os from 'node:os';

import {
  SKILLS,
  SKILL_BY_ID,
  ROOT_MARKERS,
  EXAMPLE_TEMPLATES,
  EXAMPLE_INDEX,
  resolveHostCli,
  resolveHostUserData,
  resolveProfileDb,
  computeGalleryBuildId,
} from './skills-meta.mjs';

const __filename = fileURLToPath(import.meta.url);
const pluginRoot = path.dirname(path.dirname(__filename));

const HOST_USER_DATA = resolveHostUserData(pluginRoot);
const ORCA_BIN = resolveHostCli(pluginRoot);
const EXPECTED_BUILD_ID = computeGalleryBuildId(pluginRoot);

// Design skills vendored from JimLiu/baoyu-design.
const BAOYU_SKILLS_DIR = path.join(pluginRoot, 'vendor', 'baoyu-design', 'skills');
const SKILL_META = SKILLS;

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

// Orca CLI 通用执行器（tab list/switch/current 用）。错误一律 resolve、绝不 reject，
// 让 tab 复用检查的任何失败都退化为“新建 tab”路径，而不是让命令失败。
function orcaTab(args, timeout = 3000) {
  return new Promise((resolve) => {
    execFile(ORCA_BIN, args, { timeout }, (err, stdout, stderr) => {
      resolve({ err, stdout: String(stdout || ''), stderr: String(stderr || '') });
    });
  });
}

// CLI 偶有前后缀日志；优先整体解析，失败时截取第一个 JSON 对象。
function parseOrcaJson(stdout) {
  const text = String(stdout || '').trim();
  if (!text) return null;
  try { return JSON.parse(text); } catch {
    const start = text.indexOf('{');
    const end = text.lastIndexOf('}');
    if (start < 0 || end <= start) return null;
    try { return JSON.parse(text.slice(start, end + 1)); } catch { return null; }
  }
}
function orcaResult(payload) {
  return payload && payload.ok === false ? null : (payload?.result ?? null);
}
function focusedFromHostContext(ctx, workspaces) {
  // readContext 不带 path；用它返回的 branch/displayName 在 workspace.list 中唯一命中。
  // 这不是猜测：两个字段都来自宿主当前焦点上下文，且只有唯一候选才接受。
  if (!ctx || !Array.isArray(workspaces)) return null;
  const branch = String(ctx.branch || '');
  const name = String(ctx.displayName || '');
  const normalizeBranch = (b) => String(b || '').replace(/^refs\/heads\//, '');
  const candidates = workspaces.filter((w) =>
    normalizeBranch(w.branch) === normalizeBranch(branch) && String(w.name || '') === name);
  return candidates.length === 1 ? candidates[0] : null;
}
function browserPageId(result) {
  return result?.browserPageId || result?.tab?.browserPageId || result?.tabId || null;
}

function orcaTabCreate(url, worktreePath, { split = false } = {}) {
  // 显式 --worktree：不指定时 CLI 走“当前工作区”解析，在远程/非本机工作区
  // 场景会挂起或落到错误宿主。--json 让调用方拿到 browserPageId 做可见性校验。
  const args = ['tab', 'create', '--url', url, '--json'];
  // --split right 只把页面开在终端旁的新 pane 且焦点留在终端；项目库点击不用它。
  if (split) args.push('--split', 'right');
  if (worktreePath) args.push('--worktree', `path:${worktreePath}`);
  return new Promise((resolve) => {
    execFile(ORCA_BIN, args, { timeout: 8000 }, (err, stdout, stderr) => {
      if (err) {
        resolve({ pageId: null, error: `${err.message}${stderr ? ` :: ${String(stderr).slice(0, 200)}` : ''}` });
        return;
      }
      const result = orcaResult(parseOrcaJson(stdout));
      const pageId = browserPageId(result);
      if (!pageId) {
        resolve({ pageId: null, error: `tab create returned no browserPageId: ${String(stdout).slice(0, 200)}` });
        return;
      }
      resolve({ pageId, error: null });
    });
  });
}

export default async function activate(orca) {
  orca.log('Lakala-Design-Plugin worker activating...');

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
  // Tab 缓存状态提前声明：workspace.changed 在 activate 早期注册，宿主可能在注册时
  // 立刻投递一次事件；此时必须能安全清空缓存，不能触及 TDZ。
  let cachedGalleryPageId = null;
  let cachedPageWsRoot = '';
  function invalidateGalleryTabCache() {
    cachedGalleryPageId = null;
    cachedPageWsRoot = '';
  }

// 真实安装路径：宿主把插件复制到 <userData>/plugins/<pluginKey>/<hash>/。
// 只有工作区等于/位于安装根目录内部时才拒绝写入；源码 worktree、dist 打包源都不是安装路径。
function installRoot() {
  return path.join(HOST_USER_DATA, 'plugins');
}
function isInstalledPluginPath(target) {
  const root = path.resolve(installRoot());
  const p = path.resolve(String(target || ''));
  return p === root || p.startsWith(root + path.sep);
}

  const STATE_FILE = process.env.ORCA_STATE_FILE || path.join(os.tmpdir(), 'prototype-studio-state.json');
  // 点击时把实时焦点写入短时效 state；库页服务优先消费它，避免读旧 profile DB。
  function writeState(root = workspaceRoot, name = workspaceName) {
    if (!root) return;
    const tmp = `${STATE_FILE}.tmp`;
    try {
      fs.mkdirSync(path.dirname(STATE_FILE), { recursive: true });
      fs.writeFileSync(tmp, JSON.stringify({
        workspaceRoot: root,
        workspaceName: name || path.basename(root) || '',
        updatedAt: Date.now(),
      }));
      fs.renameSync(tmp, STATE_FILE);
    } catch { /* 库页服务仍可回退 profile DB；不能让状态文件失败拖垮命令 */ }
  }

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

  // 焦点解析优先读宿主 profile 库的 activeWorktreeId（权威、即时，格式 <uuid>::<path>），
  // 消除 agent 事件桥接的冷启动等待；事件桥与唯一字段匹配仅作回退。
  const PROFILE_DB = resolveProfileDb(pluginRoot);

  function focusedFromProfile() {
    try {
      const out = execFileSync('sqlite3', [PROFILE_DB,
        "SELECT payload FROM profile_state_documents WHERE domain='workspaceSession'"],
        { timeout: 3000, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
      const ws = JSON.parse(out);
      const id = ws.activeWorktreeId || '';
      const p = id.includes('::') ? id.split('::').pop() : '';
      if (!p) return null;
      return { path: p, name: path.basename(p) || '' };
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
    if (ctx) {
      const ids = new Set();
      for (const t of ctx.terminals || []) {
        const known = terminalWorkspace.get(t.id);
        if (known) ids.add(known);
      }
      if (ids.size === 1) {
        const hit = matchWorkspaceId([...ids][0]);
        if (hit) return hit;
      }
      // ③ 回退：branch（去 refs/heads/ 前缀）+ displayName 唯一命中
      const byCtx = focusedFromHostContext(ctx, openedWorkspaces);
      if (byCtx) return byCtx;
    }
    // ④ 回退：仅打开了唯一一个工作区时直接采用，避免新工作区冷启动无焦点
    if (openedWorkspaces.length === 1 && openedWorkspaces[0]?.path) {
      return openedWorkspaces[0];
    }
    orca.log(`Workspace unresolved: opened=${openedWorkspaces.length}`);
    return null;
  }

  async function focusedFromWorktreePs() {
    const r = await orcaTab(['worktree', 'ps', '--json'], 3000);
    if (r.err) return null;
    const worktrees = orcaResult(parseOrcaJson(r.stdout))?.worktrees || [];
    const active = worktrees.find((w) => w?.isActive === true && w.path);
    if (active) return { path: active.path, name: active.displayName || path.basename(active.path) || '' };
    const ranked = worktrees
      .filter((w) => w?.path && Number.isFinite(Number(w.lastActivityAt)))
      .sort((a, b) => Number(b.lastActivityAt) - Number(a.lastActivityAt));
    return ranked[0] ? { path: ranked[0].path, name: ranked[0].displayName || path.basename(ranked[0].path) || '' } : null;
  }
  async function resolveLiveFocusedWorkspace() {
    await refreshWorkspaces();
    const ctx = await orca.host.call('workspace.readContext').catch(() => null);
    const fromHost = focusedFromHostContext(ctx, openedWorkspaces);
    if (fromHost?.path) return fromHost;
    const fromPs = await focusedFromWorktreePs();
    if (fromPs?.path) return fromPs;
    return resolveFocusedWorkspace();
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
        invalidateGalleryTabCache();
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
      invalidateGalleryTabCache();
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

    const r = await runNode([cli, 'open', root]);
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

    const created = await orcaTabCreate(url, workspaceRoot || undefined, { split: true });
    if (created.error) orca.log(`Browser tab create failed: ${created.error}`);
    return { ok: true, url, ...(created.error ? { tabError: created.error } : {}) };
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
    const targetSkill = tpl.skill || skillId;
    // 设计系统按项目全局唯一：一个工作区只允许一套统一规范
    if (targetSkill === 'claude-design-system') {
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
    // 远程/未挂载工作区护栏：路径在本机不可见时，服务扫不到、mkdirSync 还可能
    // 在本机创建影子目录（写错盘）。明确拒绝而不是静默落到本机根路径。
    if (!fs.existsSync(base) || !fs.statSync(base).isDirectory()) {
      return { ok: false, error: `工作区路径在本机不可见（远程工作区或未挂载）：${base}。项目库目前仅支持本机工作区` };
    }
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
        if (content === '__INDEX__') {
          const idx = { ...EXAMPLE_INDEX[skillId], createdOnFiles: { v: 1, at: now }, title: safe ? name : (tpl.title || name),
            lastChange: { by: 'prototype-studio', at: now, via: 'Orca plugin', note: 'Example scaffold' } };
          fs.writeFileSync(p, JSON.stringify(idx, null, 2));
        } else {
          fs.writeFileSync(p, typeof content === 'function' ? content(now) : content);
        }
      }
    } catch (err) {
      return { ok: false, error: `项目写入失败（${err.code || ''} ${err.message}）：${root}` };
    }
    const r = await runNode([artifactCli(targetSkill), 'check', root]);
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

  async function checkGalleryStatus() {
    try {
      const r = await fetch(`${GALLERY_URL}api/list`, { signal: AbortSignal.timeout(1200) });
      if (!r.ok) return { alive: false, match: false };
      const data = await r.json().catch(() => null);
      return { alive: true, match: Boolean(data && data.buildId === EXPECTED_BUILD_ID) };
    } catch {
      return { alive: false, match: false };
    }
  }

  async function stopLegacyGalleryServer() {
    try {
      await fetch(`${GALLERY_URL}api/shutdown`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', origin: `http://127.0.0.1:${GALLERY_PORT}` },
        body: '{}',
        signal: AbortSignal.timeout(800),
      });
    } catch {}
    if (process.platform !== 'win32') {
      try {
        const pids = execFileSync('lsof', [`-tiTCP:${GALLERY_PORT}`, '-sTCP:LISTEN'], {
          timeout: 1000, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'],
        }).trim().split(/\s+/).filter(Boolean);
        for (const rawPid of pids) {
          const pid = Number(rawPid);
          if (!Number.isInteger(pid) || pid <= 1) continue;
          const cmd = execFileSync('ps', ['-p', String(pid), '-o', 'command='], {
            timeout: 1000, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'],
          });
          if (cmd.includes('gallery-server.mjs')) {
            try { process.kill(pid, 'SIGTERM'); } catch {}
          }
        }
      } catch {}
    }
    for (let i = 0; i < 8; i++) {
      const st = await checkGalleryStatus();
      if (!st.alive) return true;
      await new Promise((r) => setTimeout(r, 100));
    }
    return false;
  }

  function spawnGalleryProcess() {
    const childEnv = {
      ...process.env,
      ORCA_CLI_COMMAND: ORCA_BIN,
      ORCA_USER_DATA: HOST_USER_DATA,
      ORCA_PROFILE_DB: PROFILE_DB,
      ORCA_STATE_FILE: STATE_FILE,
    };
    const child = execFile(process.execPath, [GALLERY_SCRIPT], {
      detached: true,
      stdio: 'ignore',
      env: childEnv,
    }, (err) => {
      if (err) orca.log(`gallery spawn error: ${err.message}`);
    });
    child.unref();
  }

  // 服务探测快速健康检查（1200ms）：未启动则后台拉起；若 3480 被旧版插件常驻服务占据则自动热替换。
  let gallerySpawnInFlight = null;
  async function ensureGallery() {
    const status = await checkGalleryStatus();
    if (status.alive && status.match) return true;
    if (GALLERY_SCRIPT === '/dev/null') {
      spawnGalleryProcess();
      return false;
    }
    if (!gallerySpawnInFlight) {
      gallerySpawnInFlight = (async () => {
        if (status.alive && !status.match) {
          orca.log(`Replacing stale gallery server on port ${GALLERY_PORT} with build ${EXPECTED_BUILD_ID}`);
          await stopLegacyGalleryServer();
        }
        spawnGalleryProcess();
      })().finally(() => { gallerySpawnInFlight = null; });
    }
    return false;
  }

  // 连点保护：同一次打开的 2 秒内重复点击直接返回，且命令串行执行
  let galleryOpenInFlight = null;
  let lastGalleryOpenAt = 0;
  // 即时反馈：点击后状态栏条目立刻变「打开中」，完成/失败后恢复。
  // statusBar.update 自 Orca 1.4.248 提供（plugin-private，无需 capability）；失败静默忽略。
  // tab 快路径：缓存只服务“同工作区、URL 匹配、已验证为当前 Tab”的 page id。
  // 切工作区、缓存刷新跨过工作区切换、switch/current 失败都不得产生 ok:true 假成功。
  let tabCacheTimer = null;
  function worktreeScopeArgs(openRoot) {
    return openRoot ? ['--worktree', `path:${openRoot}`] : [];
  }
  function tabListArgs(openRoot) {
    // 显式 --worktree：list/switch/current/create 都锚定本次点击的实时焦点工作区。
    return ['tab', 'list', '--json', ...worktreeScopeArgs(openRoot)];
  }
  function tabCurrentArgs(openRoot) {
    return ['tab', 'current', '--json', ...worktreeScopeArgs(openRoot)];
  }
  function worktreeActivateArgs(openRoot) {
    return ['worktree', 'activate', ...worktreeScopeArgs(openRoot), '--json'];
  }
  async function refreshTabCache(openRoot) {
    // 记录请求时的工作区：异步 list 返回时若焦点已切走，丢弃结果，避免写入旧 id。
    const requestedWsRoot = openRoot || '';
    if (cachedPageWsRoot !== requestedWsRoot) {
      cachedGalleryPageId = null;
      cachedPageWsRoot = requestedWsRoot;
    }
    const r = await orcaTab(tabListArgs(openRoot));
    if (r.err || cachedPageWsRoot !== requestedWsRoot) return;
    const tabs = orcaResult(parseOrcaJson(r.stdout))?.tabs || [];
    const hit = tabs.find((t) => String(t.url || '').startsWith(GALLERY_URL));
    cachedGalleryPageId = hit ? hit.browserPageId || null : null;
  }
  function startTabCacheLoop() {
    if (tabCacheTimer) return;
    tabCacheTimer = setInterval(() => {
      resolveLiveFocusedWorkspace()
        .then((hit) => {
          if (hit?.path) writeState(hit.path, hit.name || hit.displayName || '');
          return refreshTabCache(hit?.path || '');
        })
        .catch(() => {});
    }, 30000);
    tabCacheTimer.unref?.();
  }
  // switch 会改变 scoped worktree 的 active tab；--focus 负责把 browser pane 提到前台。
  // 这里只使用 openRoot 快照：用户切走工作区后，后续异步步骤不得把宿主拉回旧工作区。
  async function revealGalleryTab(pageId, label, lap, openRoot) {
    const activated = openRoot ? await orcaTab(worktreeActivateArgs(openRoot), 8000) : null;
    if (activated?.err) {
      orca.log(`gallery worktree-activate failed: ${activated.err.message || activated.err}`);
      return null;
    }
    const sw = await orcaTab(['tab', 'switch', '--page', pageId, ...worktreeScopeArgs(openRoot), '--focus', '--json']);
    lap(label);
    if (sw.err) {
      orca.log(`gallery ${label} failed: ${sw.err.message || sw.err}`);
      return null;
    }
    const switchedId = browserPageId(orcaResult(parseOrcaJson(sw.stdout))) || pageId;
    const cur = await orcaTab(tabCurrentArgs(openRoot));
    if (cur.err) {
      orca.log(`gallery tab-current failed: ${cur.err.message || cur.err}`);
      return null;
    }
    const currentId = browserPageId(orcaResult(parseOrcaJson(cur.stdout)));
    if (!currentId || currentId !== switchedId) {
      orca.log(`gallery tab not current after ${label}: expected ${switchedId}, got ${currentId || '(none)'}`);
      return null;
    }
    cachedGalleryPageId = currentId;
    cachedPageWsRoot = openRoot || '';
    return currentId;
  }
  async function createAndRevealGalleryTab(lap, openRoot) {
    const created = await orcaTabCreate(GALLERY_URL, openRoot || undefined);
    lap('tab-create');
    if (created.error) {
      orca.log(`gallery tab-create failed: ${created.error}`);
      return { ok: false, error: created.error };
    }
    const pageId = await revealGalleryTab(created.pageId, 'tab-switch(created)', lap, openRoot);
    if (!pageId) {
      // 新 Tab 已创建，但无法证明它是当前 Tab；报告失败，让调用方能重试而不是静默假成功。
      return { ok: false, error: 'gallery tab created but visibility verification failed' };
    }
    lastGalleryOpenAt = Date.now();
    return { ok: true, reused: false, pageId, workspaceRoot: openRoot };
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
      ? { id: 'gallery', text: '⟳ 打开中…', tone: 'accent', tooltip: 'Lakala-Design-Plugin · 正在打开项目库' }
      : { ...SB_IDLE, tooltip: 'Lakala-Design-Plugin · 打开设计项目库' });
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
        // 点击时解析实时焦点并快照：整次 list/switch/create/current 都用同一个 root，
        // 不再读取可能在 await 之间被 workspace.changed 改写的全局 workspaceRoot。
        const live = await resolveLiveFocusedWorkspace();
        const openRoot = live?.path || '';
        const openName = live?.name || live?.displayName || workspaceName;
        lap('focus');
        if (!openRoot) return { ok: false, error: '当前工作区未识别' };
        if (!fs.existsSync(openRoot) || !fs.statSync(openRoot).isDirectory()) {
          orca.log(`gallery blocked: workspace not visible locally: ${openRoot}`);
          return { ok: false, error: `远程/本机不可见的工作区暂不支持项目库（仅支持本机工作区）：${openRoot}` };
        }
        workspaceRoot = openRoot;
        workspaceName = openName || workspaceName;
        writeState(openRoot, workspaceName);
        if (cachedPageWsRoot !== openRoot) invalidateGalleryTabCache();
        cachedPageWsRoot = openRoot;

        // 服务探测/spawn 不阻塞“切换/新建 tab”；缓存刷新串行完成后才走快路径。
        ensureGallery().catch((e) => orca.log(`gallery ensure: ${e.message}`)); // 后台拉起服务
        await refreshTabCache(openRoot).catch(() => {});
        lap('tab-cache');

        // 快路径①：缓存里已知同工作区库页 tab → switch + current 校验。
        if (cachedGalleryPageId) {
          const pageId = await revealGalleryTab(cachedGalleryPageId, 'tab-switch(cached)', lap, openRoot);
          if (pageId) {
            lastGalleryOpenAt = Date.now();
            return { ok: true, reused: true, pageId, workspaceRoot: openRoot };
          }
          cachedGalleryPageId = null; // 缓存失效，继续现场 list / create
        }
        // 快路径②：现场 list（超时 3s），找到库页 tab 就验证可见性；失败原因落日志
        try {
          const listed = await orcaTab(tabListArgs(openRoot));
          lap('tab-list');
          if (listed.err) {
            orca.log(`gallery tab-list failed: ${listed.err.message || listed.err}${listed.stderr ? ` :: ${listed.stderr.slice(0, 160)}` : ''}`);
          } else {
            const tabs = orcaResult(parseOrcaJson(listed.stdout))?.tabs || [];
            const hit = tabs.find((t) => String(t.url || '').startsWith(GALLERY_URL));
            if (hit) {
              const pageId = await revealGalleryTab(hit.browserPageId, 'tab-switch', lap, openRoot);
              if (pageId) {
                lastGalleryOpenAt = Date.now();
                return { ok: true, reused: true, pageId, workspaceRoot: openRoot };
              }
            }
          }
        } catch { /* fall through to create */ }
        // 最后一步：新建 tab，解析 page id → switch → current 校验；失败原因落日志供定位
        return await createAndRevealGalleryTab(lap, openRoot);
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
  // 主题跟随由项目库服务读取宿主 profile 的 settings.theme 注入首帧；宿主
  // appearance.read 只返回 revision，读不到 mode，故不申请 appearance:write。
  // 状态栏条目运行期反馈：Orca 的 statusBarItems 是 manifest 声明式字段，
  // worker 无 UI API 可写它。可达的即时反馈通道是 tab 侧：先切/开 tab（URL 带
  // #opening 哈希，库页读到即显示加载动画），服务冷启动时库页自己每 500ms
  // 重试 /api/list——点击到看到动画的间隔 = tab switch/create 的 ~0.2-1s。
  reg('prototype.gallery', async () => openGalleryTab());

  // 项目库内打开编辑器不再另开标签：iframe 同页跳转由库页自身完成
  // （保留 openSkillEditor 供 /api/open 与 palette 命令返回编辑器 url）

  // 激活预热：worker 常驻（有 statusBarItems 的插件保持运行）——
  // ① 服务提前拉起或升级热替换（点击时无冷启动）② tab 缓存循环启动（点击走 switch 快路径）
  startTabCacheLoop();
  ensureGallery().catch(() => {});
  orca.log('Lakala-Design-Plugin worker activated successfully.');
}
