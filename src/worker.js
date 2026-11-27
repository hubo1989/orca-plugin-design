import { execFile, spawn } from 'node:child_process';
import http from 'node:http';
import crypto from 'node:crypto';
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
  resolveHostRuntimeDefaults,
  resolveProfileDb,
  computeGalleryBuildId,
} from './skills-meta.mjs';
import {
  resolveOrcaWorkspace,
  validateWorkspacePath,
  isForbiddenWorkspacePath,
  formatWorkspaceError,
} from './workspace-guard.mjs';

const __filename = fileURLToPath(import.meta.url);
const pluginRoot = path.dirname(path.dirname(__filename));
const HOST_RUNTIME = resolveHostRuntimeDefaults(pluginRoot);
const APP_ID = process.env.ORCA_GALLERY_APP_ID?.trim() || HOST_RUNTIME.appId;

function cleanTitle(raw) {
  if (typeof raw !== 'string') return '';
  return raw.replace(/\s+/g, ' ').trim().slice(0, 200);
}

function sanitizeDirSlug(raw) {
  const s = String(raw ?? '')
    .trim()
    .replace(/[\\/:*?"<>|\s]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^[.-]+|[.-]+$/g, '')
    .slice(0, 60)
    .replace(/-+$/g, '');
  if (!s || s === '.' || s === '..') return '';
  return s;
}

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

function browserPageId(result) {
  return result?.browserPageId || result?.tab?.browserPageId || result?.tabId || null;
}

export default async function activate(orca) {
  orca.log('Lakala-Design-Plugin worker activating...');

  const HOST_USER_DATA = resolveHostUserData(pluginRoot);
  const ORCA_BIN = resolveHostCli(pluginRoot);
  const EXPECTED_BUILD_ID = computeGalleryBuildId(pluginRoot);
  const DESIGN_HOME = process.env.ORCA_DESIGN_HOME?.trim() || process.env.DSH_HOME?.trim() || path.join(HOST_USER_DATA, 'baoyu-design');
  const validateOpts = { pluginRoot, hostUserData: HOST_USER_DATA, designHome: DESIGN_HOME };

  const GALLERY_PORT = Number(process.env.ORCA_GALLERY_PORT || process.env.PORT) || HOST_RUNTIME.defaultPort;
  const GALLERY_URL = `http://127.0.0.1:${GALLERY_PORT}/`;
  const GALLERY_SCRIPT = process.env.ORCA_GALLERY_SCRIPT || path.join(pluginRoot, 'src', 'gallery-server.mjs');
  const STARTUP_TIMEOUT_MS = Number(process.env.ORCA_STARTUP_TIMEOUT_MS) || 8000;
  const HEALTH_POLL_INTERVAL_MS = 60;
  const SUCCESS_THROTTLE_MS = 2000;

  function orcaTab(args, timeout = 3000) {
    return new Promise((resolve) => {
      execFile(ORCA_BIN, args, { timeout }, (err, stdout, stderr) => {
        resolve({ err, stdout: String(stdout || ''), stderr: String(stderr || '') });
      });
    });
  }

  function orcaTabCreate(url, worktreePath, { split = false } = {}) {
    const args = ['tab', 'create', '--url', url, '--json'];
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

  function isInstalledPluginPath(target) {
    return isForbiddenWorkspacePath(target, validateOpts);
  }

  const STATE_FILE = process.env.ORCA_STATE_FILE || path.join(os.tmpdir(), HOST_RUNTIME.defaultStateFileName);
  // 点击时把实时焦点写入短时效 state；被拦截或未识别时同步清空快照，防止写串旧工作区。
  function writeState(root = workspaceRoot, name = workspaceName, errInfo = null) {
    const tmp = `${STATE_FILE}.${process.pid}.tmp`;
    const payload = root
      ? {
          workspaceRoot: root,
          workspaceName: name || path.basename(root) || '',
          errorCode: '',
          errorMessage: '',
          updatedAt: Date.now(),
        }
      : {
          workspaceRoot: '',
          workspaceName: '',
          errorCode: errInfo?.code || errInfo?.reason || 'NO_WORKSPACE',
          errorMessage: errInfo?.message || formatWorkspaceError('NO_WORKSPACE'),
          updatedAt: Date.now(),
        };
    try {
      fs.mkdirSync(path.dirname(STATE_FILE), { recursive: true });
      fs.writeFileSync(tmp, JSON.stringify(payload));
      fs.renameSync(tmp, STATE_FILE);
    } catch { /* 不能让状态文件失败拖垮命令 */ }
  }

  async function refreshWorkspaces() {
    try {
      const listed = await orca.host.call('workspace.list', { opened: true })
        .catch(() => orca.host.call('workspace.list').catch(() => null));
      openedWorkspaces = listed?.workspaces ?? [];
    } catch {
      openedWorkspaces = [];
    }
    return openedWorkspaces;
  }

  const terminalWorkspace = new Map();

  function rememberAgentEvent(e) {
    if (!e?.terminalId || !e?.workspaceId) return;
    terminalWorkspace.set(e.terminalId, String(e.workspaceId));
    if (terminalWorkspace.size > 300) {
      terminalWorkspace.delete(terminalWorkspace.keys().next().value);
    }
  }

  const PROFILE_DB = resolveProfileDb(pluginRoot);

  async function resolveWorkspace({ live = false } = {}) {
    return resolveOrcaWorkspace({
      live,
      listWorkspaces: refreshWorkspaces,
      readContext: () => orca.host.call('workspace.readContext').catch(() => null),
      queryWorktreePs: async () => {
        const r = await orcaTab(['worktree', 'ps', '--json'], 3000);
        if (r.err) return [];
        return orcaResult(parseOrcaJson(r.stdout))?.worktrees || [];
      },
      profileDbPath: PROFILE_DB,
      terminalWorkspaceMap: terminalWorkspace,
      validateOptions: validateOpts,
    });
  }

  const startFocus = await resolveWorkspace({ live: false });
  workspaceRoot = startFocus.ok ? startFocus.workspaceRoot : '';
  workspaceName = startFocus.ok ? startFocus.workspaceName : '';
  writeState(workspaceRoot, workspaceName, startFocus.ok ? null : startFocus);
  orca.log(`Focused workspace: ${workspaceName || '(unresolved)'} ${workspaceRoot}`);

  let workspaceGeneration = 0;
  let reresolveTimer = null;
  function scheduleReresolve() {
    if (reresolveTimer) return;
    reresolveTimer = setTimeout(async () => {
      reresolveTimer = null;
      const generation = ++workspaceGeneration;
      const hit = await resolveWorkspace({ live: false });
      if (generation !== workspaceGeneration) return;
      const nextRoot = hit.ok ? hit.workspaceRoot : '';
      if (nextRoot !== workspaceRoot || !hit.ok) {
        if (nextRoot !== workspaceRoot) invalidateGalleryTabCache();
        workspaceRoot = nextRoot;
        workspaceName = hit.ok ? hit.workspaceName : '';
        writeState(workspaceRoot, workspaceName, hit.ok ? null : hit);
        orca.log(`Focused workspace: ${workspaceName || '(unresolved)'} ${workspaceRoot}`);
      }
    }, 800);
    reresolveTimer.unref?.();
  }

  if (orca.events?.on) {
    orca.events.on('agent.status.changed', (e) => {
      rememberAgentEvent(e);
      if (!workspaceRoot) scheduleReresolve();
    });
    orca.events.on('workspace.changed', async () => {
      const generation = ++workspaceGeneration;
      invalidateGalleryTabCache();
      workspaceRoot = '';
      workspaceName = '';
      const hit = await resolveWorkspace({ live: false });
      if (generation !== workspaceGeneration) return;
      workspaceRoot = hit.ok ? hit.workspaceRoot : '';
      workspaceName = hit.ok ? hit.workspaceName : '';
      writeState(workspaceRoot, workspaceName, hit.ok ? null : hit);
      orca.log(`Focused workspace: ${workspaceName || '(unresolved)'} ${workspaceRoot}`);
    });
  }

  // 扫描指定工作区（深度 2，覆盖 designs/<proj> 与根级项目）。
  // root 为空时不扫描：绝不把别的目录当成“当前工作区”。
  function scanDesignProjects(rootDir) {
    const bySkill = {};
    for (const id of Object.keys(ROOT_MARKERS)) bySkill[id] = [];
    if (!rootDir) return bySkill;
    const SKIP = new Set(['.git', 'node_modules', '.orca', '.agy-daddy', '.agents', 'trash', 'vendor', 'dist', '.venv', '__pycache__', 'build']);
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

  async function openSkillEditor(skillId, rootInput, wsPath, { skipTabCreate = false } = {}) {
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
    let parsed;
    try {
      parsed = JSON.parse(m[0]);
    } catch {
      return { ok: false, error: `unparsable artifact output: ${r.stdout.slice(0, 200)}` };
    }
    const url = parsed.url;
    openEditors.set(root, { skill: skillId, url });
    orca.log(`Skill editor up: ${skillId} -> ${url}`);

    if (skipTabCreate) {
      return { ok: true, url, root, reused: parsed.reused === true };
    }
    const created = await orcaTabCreate(url, wsPath || workspaceRoot || undefined, { split: true });
    if (created.error) orca.log(`Browser tab create failed: ${created.error}`);
    return { ok: true, url, root, ...(created.error ? { tabError: created.error } : {}) };
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
    let base = wsPath || workspaceRoot;
    let wsCheck = base ? validateWorkspacePath(base, validateOpts) : null;
    if (!wsCheck || !wsCheck.ok) {
      const hit = await resolveWorkspace({ live: false });
      if (!hit.ok) {
        return { ok: false, code: hit.code, error: hit.message };
      }
      workspaceRoot = hit.workspaceRoot;
      workspaceName = hit.workspaceName;
      writeState(workspaceRoot, workspaceName);
      base = hit.workspaceRoot;
    } else {
      base = wsCheck.workspaceRoot;
    }
    if (targetSkill === 'claude-design-system') {
      const existing = scanDesignProjects(base)['claude-design-system'] || [];
      if (existing.length > 0) {
        return {
          ok: false,
          code: 'DESIGN_SYSTEM_EXISTS',
          root: existing[0].root,
          error: formatWorkspaceError('DESIGN_SYSTEM_EXISTS', { title: existing[0].title }),
        };
      }
    }
    const displayTitle = cleanTitle(nameInput) || tpl.title || '';
    const baseName = sanitizeDirSlug(nameInput) || tpl.dirName;
    const designDir = path.join(base, '.design');
    let name = baseName;
    let i = 2;
    while (fs.existsSync(path.join(designDir, name))) {
      name = `${baseName}-${i++}`;
    }
    const root = path.join(designDir, name);
    const finalTitle = displayTitle || name;
    const now = new Date().toISOString().replace(/\.\d+Z$/, 'Z');
    try {
      for (const [rel, content] of Object.entries(tpl.files)) {
        const p = path.join(root, rel);
        fs.mkdirSync(path.dirname(p), { recursive: true });
        if (content === '__INDEX__') {
          const idx = {
            ...EXAMPLE_INDEX[skillId],
            createdOnFiles: { v: 1, at: now },
            title: finalTitle,
            lastChange: { by: 'prototype-studio', at: now, via: 'Orca plugin', note: 'Example scaffold' },
          };
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
    return { ok: true, root, title: finalTitle, problems };
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

  // ---- 项目库：独立 detached 服务（默认 3480），worker 被回收也不影响库页 ----
  async function probeGalleryHealth(port = GALLERY_PORT, timeoutMs = 500) {
    const baseUrl = `http://127.0.0.1:${port}/`;
    try {
      const r = await fetch(`${baseUrl}api/health`, { signal: AbortSignal.timeout(timeoutMs) });
      const text = await r.text();
      let data = null;
      try { data = JSON.parse(text); } catch {}
      if (r.status === 200 && data?.app === APP_ID) {
        return {
          alive: true,
          mine: true,
          match: data.buildId === EXPECTED_BUILD_ID,
          buildId: data.buildId || '',
          pid: Number(data.pid) || null,
        };
      }
      // 兼容旧版 v0.2.1 升级热替换：/api/health 404 '{}' 时补探一次 /api/list
      if (r.status === 404 && text.trim() === '{}') {
        try {
          const lr = await fetch(`${baseUrl}api/list`, { signal: AbortSignal.timeout(200) });
          const ld = await lr.json().catch(() => null);
          if (
            lr.status === 200
            && ld?.ok === true
            && !ld.app
            && Array.isArray(ld.artifacts)
            && (typeof ld.buildId === 'string' || ('workspaceRoot' in ld && 'workspaceName' in ld))
          ) {
            return { alive: true, mine: true, match: false, legacy: true, pid: null };
          }
        } catch {}
      }
      return { alive: true, mine: false };
    } catch {
      return { alive: false, mine: false };
    }
  }

  function isPidAlive(pid) {
    if (!Number.isInteger(pid) || pid <= 1) return false;
    try {
      process.kill(pid, 0);
      return true;
    } catch {
      return false;
    }
  }

  async function killSpawnedChild(child) {
    const pid = child?.pid;
    if (!Number.isInteger(pid) || pid <= 1) return;
    try { process.kill(-pid, 'SIGTERM'); } catch {}
    try { process.kill(pid, 'SIGTERM'); } catch {}
    await new Promise((r) => setTimeout(r, 100));
    if (isPidAlive(pid)) {
      try { process.kill(-pid, 'SIGKILL'); } catch {}
      try { process.kill(pid, 'SIGKILL'); } catch {}
    }
  }

  async function stopLegacyGalleryServer(health) {
    if (!health?.mine || health.match) return false;
    try {
      await fetch(`${GALLERY_URL}api/shutdown`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', origin: `http://127.0.0.1:${GALLERY_PORT}` },
        body: '{}',
        signal: AbortSignal.timeout(800),
      });
    } catch {}
    const deadline = Date.now() + 1200;
    while (Date.now() < deadline) {
      const st = await probeGalleryHealth(GALLERY_PORT, 200);
      if (!st.alive) return true;
      await new Promise((r) => setTimeout(r, 80));
    }
    if (Number.isInteger(health.pid) && health.pid > 1) {
      try { process.kill(health.pid, 'SIGTERM'); } catch {}
      await new Promise((r) => setTimeout(r, 150));
      const st = await probeGalleryHealth(GALLERY_PORT, 200);
      return !st.alive;
    }
    return false;
  }

  let gallerySpawnInFlight = null;
  async function ensureGalleryRunning({ timeoutMs = STARTUP_TIMEOUT_MS } = {}) {
    const health = await probeGalleryHealth(GALLERY_PORT, Math.min(500, timeoutMs));
    if (health.alive && health.mine && health.match) {
      return { ok: true, warm: true, port: GALLERY_PORT, buildId: health.buildId };
    }
    if (health.alive && !health.mine) {
      return {
        ok: false,
        code: 'PORT_OCCUPIED_BY_OTHER',
        port: GALLERY_PORT,
        error: formatWorkspaceError('PORT_OCCUPIED_BY_OTHER', { port: GALLERY_PORT }),
      };
    }
    if (GALLERY_SCRIPT === '/dev/null') {
      return { ok: true, warm: false, stub: true, port: GALLERY_PORT };
    }
    if (!gallerySpawnInFlight) {
      gallerySpawnInFlight = (async () => {
        const deadline = Date.now() + timeoutMs;
        if (health.alive && health.mine && !health.match) {
          orca.log(`Replacing stale gallery server on port ${GALLERY_PORT} with build ${EXPECTED_BUILD_ID}`);
          await stopLegacyGalleryServer(health);
        }
        const childEnv = {
          ...process.env,
          PORT: String(GALLERY_PORT),
          ORCA_GALLERY_PORT: String(GALLERY_PORT),
          ORCA_GALLERY_APP_ID: APP_ID,
          ORCA_CLI_COMMAND: ORCA_BIN,
          ORCA_USER_DATA: HOST_USER_DATA,
          ORCA_DESIGN_HOME: DESIGN_HOME,
          ORCA_PROFILE_DB: PROFILE_DB,
          ORCA_STATE_FILE: STATE_FILE,
        };
        let stderrBuf = '';
        let exited = false;
        const child = spawn(process.execPath, [GALLERY_SCRIPT], {
          detached: true,
          stdio: ['ignore', 'ignore', 'pipe'],
          env: childEnv,
        });
        const onData = (chunk) => {
          if (stderrBuf.length < 2048) stderrBuf += String(chunk);
        };
        const onExit = () => { exited = true; };
        child.stderr?.on('data', onData);
        child.once('exit', onExit);
        child.once('error', onExit);

        const cleanupChildListeners = () => {
          child.stderr?.off('data', onData);
          child.off('exit', onExit);
          child.off('error', onExit);
          try { child.stderr?.destroy(); } catch {}
        };

        while (Date.now() < deadline) {
          if (exited && /EADDRINUSE/i.test(stderrBuf)) {
            cleanupChildListeners();
            return {
              ok: false,
              code: 'PORT_OCCUPIED_BY_OTHER',
              port: GALLERY_PORT,
              error: formatWorkspaceError('PORT_OCCUPIED_BY_OTHER', { port: GALLERY_PORT }),
            };
          }
          const h = await probeGalleryHealth(GALLERY_PORT, 300);
          if (h.alive && h.mine && h.match) {
            cleanupChildListeners();
            child.unref();
            return { ok: true, warm: false, port: GALLERY_PORT, buildId: h.buildId };
          }
          if (h.alive && !h.mine) {
            cleanupChildListeners();
            await killSpawnedChild(child);
            return {
              ok: false,
              code: 'PORT_OCCUPIED_BY_OTHER',
              port: GALLERY_PORT,
              error: formatWorkspaceError('PORT_OCCUPIED_BY_OTHER', { port: GALLERY_PORT }),
            };
          }
          if (exited) break;
          await new Promise((r) => setTimeout(r, HEALTH_POLL_INTERVAL_MS));
        }

        cleanupChildListeners();
        await killSpawnedChild(child);
        if (/EADDRINUSE/i.test(stderrBuf)) {
          return {
            ok: false,
            code: 'PORT_OCCUPIED_BY_OTHER',
            port: GALLERY_PORT,
            error: formatWorkspaceError('PORT_OCCUPIED_BY_OTHER', { port: GALLERY_PORT }),
          };
        }
        return {
          ok: false,
          code: 'START_TIMEOUT',
          port: GALLERY_PORT,
          error: formatWorkspaceError('START_TIMEOUT', { port: GALLERY_PORT }),
        };
      })().finally(() => { gallerySpawnInFlight = null; });
    }
    return gallerySpawnInFlight;
  }

  let galleryOpenInFlight = null;
  let lastGalleryOpenAt = 0;
  let tabCacheTimer = null;

  function isGalleryTabUrl(rawUrl) {
    return String(rawUrl || '').startsWith(GALLERY_URL);
  }
  function worktreeScopeArgs(openRoot) {
    return openRoot ? ['--worktree', `path:${openRoot}`] : [];
  }
  function tabListArgs(openRoot) {
    return ['tab', 'list', '--json', ...worktreeScopeArgs(openRoot)];
  }
  function tabCurrentArgs(openRoot) {
    return ['tab', 'current', '--json', ...worktreeScopeArgs(openRoot)];
  }
  function worktreeActivateArgs(openRoot) {
    return ['worktree', 'activate', ...worktreeScopeArgs(openRoot), '--json'];
  }
  async function findExistingGalleryTab(openRoot) {
    const requestedWsRoot = openRoot || '';
    if (cachedPageWsRoot !== requestedWsRoot) {
      cachedGalleryPageId = null;
      cachedPageWsRoot = requestedWsRoot;
    }
    const r = await orcaTab(tabListArgs(openRoot));
    if (r.err || cachedPageWsRoot !== requestedWsRoot) return null;
    const tabs = orcaResult(parseOrcaJson(r.stdout))?.tabs || [];
    const hit = tabs.find((t) => isGalleryTabUrl(t.url));
    cachedGalleryPageId = hit ? (hit.browserPageId || null) : null;
    return hit || null;
  }
  function startTabCacheLoop() {
    if (tabCacheTimer) return;
    tabCacheTimer = setInterval(() => {
      resolveWorkspace({ live: true })
        .then((hit) => {
          if (hit.ok) {
            writeState(hit.workspaceRoot, hit.workspaceName);
            return findExistingGalleryTab(hit.workspaceRoot);
          }
          return null;
        })
        .catch(() => {});
    }, 30000);
    tabCacheTimer.unref?.();
  }
  async function revealGalleryTab(pageId, label, lap, openRoot, { cacheGallery = true } = {}) {
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
    if (cacheGallery) {
      cachedGalleryPageId = currentId;
      cachedPageWsRoot = openRoot || '';
    }
    return currentId;
  }
  async function createAndRevealGalleryTab(lap, openRoot, targetUrl = GALLERY_URL) {
    const created = await orcaTabCreate(targetUrl, openRoot || undefined);
    lap('tab-create');
    if (created.error) {
      orca.log(`gallery tab-create failed: ${created.error}`);
      return { ok: false, error: created.error };
    }
    const pageId = await revealGalleryTab(created.pageId, 'tab-switch(created)', lap, openRoot);
    if (!pageId) {
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
    if (Date.now() - lastGalleryOpenAt < SUCCESS_THROTTLE_MS) {
      return { ok: true, reused: true, throttled: true };
    }
    const T0 = Date.now();
    const lap = (name) => orca.log(`gallery-open ${name} +${Date.now() - T0}ms`);
    // <=16ms 同步触发状态栏反馈
    galleryLoading(true);
    galleryOpenInFlight = (async () => {
      try {
        lap('start');
        const [initialHealth, wsRes] = await Promise.all([
          GALLERY_SCRIPT === '/dev/null'
            ? Promise.resolve({ alive: false, mine: true })
            : probeGalleryHealth(GALLERY_PORT, 350),
          resolveWorkspace({ live: true }),
        ]);
        lap('focus');
        if (!wsRes.ok) {
          workspaceRoot = '';
          workspaceName = '';
          writeState('', '', wsRes);
          invalidateGalleryTabCache();
          return { ok: false, code: wsRes.code || wsRes.reason, error: wsRes.message };
        }
        const openRoot = wsRes.workspaceRoot;
        const openName = wsRes.workspaceName;
        workspaceRoot = openRoot;
        workspaceName = openName;
        writeState(openRoot, openName);
        if (cachedPageWsRoot !== openRoot) invalidateGalleryTabCache();
        cachedPageWsRoot = openRoot;

        if (initialHealth.alive && !initialHealth.mine) {
          return {
            ok: false,
            code: 'PORT_OCCUPIED_BY_OTHER',
            port: GALLERY_PORT,
            error: formatWorkspaceError('PORT_OCCUPIED_BY_OTHER', { port: GALLERY_PORT }),
          };
        }

        const isWarm = initialHealth.alive && initialHealth.mine && initialHealth.match;
        if (isWarm) {
          // 热开快路径①：命中缓存直接 switch + current 校验（0 次 tab list）
          if (cachedGalleryPageId) {
            const pageId = await revealGalleryTab(cachedGalleryPageId, 'tab-switch(cached)', lap, openRoot);
            if (pageId) {
              lastGalleryOpenAt = Date.now();
              return { ok: true, reused: true, pageId, workspaceRoot: openRoot };
            }
            cachedGalleryPageId = null;
          }
          // 热开快路径②：唯一 1 次 tab list
          const hit = await findExistingGalleryTab(openRoot);
          lap('tab-list');
          if (hit) {
            const pageId = await revealGalleryTab(hit.browserPageId, 'tab-switch', lap, openRoot);
            if (pageId) {
              lastGalleryOpenAt = Date.now();
              return { ok: true, reused: true, pageId, workspaceRoot: openRoot };
            }
          }
          return await createAndRevealGalleryTab(lap, openRoot, GALLERY_URL);
        }

        // 冷开/热替换并发路径：ensureGalleryRunning 与至多 1 次 tab list 并发推进，共享 8.0s 硬超时预算
        const remainingMs = Math.max(100, STARTUP_TIMEOUT_MS - (Date.now() - T0));
        const usedCachedId = cachedGalleryPageId;
        const [srvRes, listedTab] = await Promise.all([
          ensureGalleryRunning({ timeoutMs: remainingMs }),
          usedCachedId ? Promise.resolve(null) : findExistingGalleryTab(openRoot),
        ]);
        lap('cold-ready');
        if (!srvRes.ok) return srvRes;

        if (usedCachedId) {
          const pageId = await revealGalleryTab(usedCachedId, 'tab-switch(cached)', lap, openRoot);
          if (pageId) {
            lastGalleryOpenAt = Date.now();
            return { ok: true, reused: true, pageId, workspaceRoot: openRoot };
          }
          cachedGalleryPageId = null;
        } else if (listedTab) {
          const pageId = await revealGalleryTab(listedTab.browserPageId, 'tab-switch', lap, openRoot);
          if (pageId) {
            lastGalleryOpenAt = Date.now();
            return { ok: true, reused: true, pageId, workspaceRoot: openRoot };
          }
        }
        const targetUrl = srvRes.stub ? GALLERY_URL : `${GALLERY_URL}#opening`;
        return await createAndRevealGalleryTab(lap, openRoot, targetUrl);
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
    handle('studio.gallery.openTab', async () => openGalleryTab());

    // LKL-PMStudio 左侧边栏 PluginPageHost 桥接：绕过 guest 死端代理与 CSP 限制
    const BRIDGE_API_RE = /^\/api\/(?:health|list|open|create|create-example|update|delete|restore|forget|forget-missing|rename|stop|restart-editor|start)(?:\?.*)?$/;
    handle('studio.gallery.api', async (input) => {
      const route = String(input?.route || '');
      if (!BRIDGE_API_RE.test(route)) {
        return { ok: false, code: 'INVALID_ROUTE', error: `Unsupported gallery API route: ${route}` };
      }
      const method = input?.method === 'POST' ? 'POST' : 'GET';
      const wsRes = await resolveWorkspace({ live: true });
      if (wsRes.ok) {
        workspaceRoot = wsRes.workspaceRoot;
        workspaceName = wsRes.workspaceName;
        writeState(workspaceRoot, workspaceName);
      } else {
        workspaceRoot = '';
        workspaceName = '';
        writeState('', '', wsRes);
      }
      const srv = await ensureGalleryRunning({ timeoutMs: STARTUP_TIMEOUT_MS });
      if (!srv.ok) return srv;
      const payload = method === 'POST' ? JSON.stringify(input?.body && typeof input.body === 'object' ? input.body : {}) : '';
      return new Promise((resolve) => {
        const req = http.request({
          hostname: '127.0.0.1',
          port: srv.port || GALLERY_PORT,
          path: route,
          method,
          headers: {
            host: `127.0.0.1:${srv.port || GALLERY_PORT}`,
            origin: `http://127.0.0.1:${srv.port || GALLERY_PORT}`,
            'x-orca-design-client': '1',
            ...(method === 'POST'
              ? { 'content-type': 'application/json', 'content-length': Buffer.byteLength(payload) }
              : {}),
          },
          timeout: 15000,
        }, (res) => {
          const chunks = [];
          res.on('data', (c) => chunks.push(c));
          res.on('end', () => {
            const text = Buffer.concat(chunks).toString('utf8');
            try { resolve(JSON.parse(text)); }
            catch { resolve({ ok: false, error: text.slice(0, 200) || `HTTP ${res.statusCode}` }); }
          });
        });
        req.on('error', (err) => resolve({ ok: false, error: err.message }));
        req.on('timeout', () => {
          req.destroy();
          resolve({ ok: false, code: 'START_TIMEOUT', error: formatWorkspaceError('START_TIMEOUT', { port: GALLERY_PORT }) });
        });
        if (method === 'POST') req.write(payload);
        req.end();
      });
    });

    handle('studio.gallery.thumb', async (input) => {
      const root = typeof input?.root === 'string' ? input.root : '';
      if (!root || root.includes('\0') || !path.isAbsolute(root)) {
        return { ok: false, code: 'THUMB_NOT_FOUND' };
      }
      const hash = crypto.createHash('sha256').update(root).digest('hex').slice(0, 24);
      const tp = path.join(DESIGN_HOME, 'thumbs', `${hash}.png`);
      try {
        const stat = fs.statSync(tp);
        if (!stat.isFile() || stat.size > 5 * 1024 * 1024) {
          return { ok: false, code: 'THUMB_NOT_FOUND' };
        }
        return { ok: true, dataUrl: `data:image/png;base64,${fs.readFileSync(tp).toString('base64')}` };
      } catch {
        return { ok: false, code: 'THUMB_NOT_FOUND' };
      }
    });

    handle('studio.editor.open', async (input) => {
      const wsRes = await resolveWorkspace({ live: true });
      const openRoot = wsRes.ok ? wsRes.workspaceRoot : workspaceRoot;
      const res = await openSkillEditor(input?.skill, input?.root, openRoot, { skipTabCreate: true });
      if (!res.ok) return res;
      const listed = await orcaTab(tabListArgs(openRoot));
      const tabs = !listed.err ? (orcaResult(parseOrcaJson(listed.stdout))?.tabs || []) : [];
      const existing = tabs.find((t) => String(t.url || '') === res.url);
      if (existing?.browserPageId) {
        const pageId = await revealGalleryTab(existing.browserPageId, 'editor-switch', () => {}, openRoot, { cacheGallery: false });
        return { ok: true, url: res.url, pageId: pageId || existing.browserPageId, reused: true, mode: 'workspace-tab' };
      }
      const created = await orcaTabCreate(res.url, openRoot || undefined);
      if (created.error || !created.pageId) {
        return { ok: false, error: created.error || 'failed to create editor tab' };
      }
      const pageId = await revealGalleryTab(created.pageId, 'editor-switch(created)', () => {}, openRoot, { cacheGallery: false });
      return { ok: true, url: res.url, pageId: pageId || created.pageId, reused: false, mode: 'workspace-tab' };
    });

    handle('studio.restart', async () => {
      try {
        const manifest = JSON.parse(fs.readFileSync(path.join(pluginRoot, 'orca-plugin.json'), 'utf8'));
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

    handle('studio.skill.remove', async (input) => {
      if (input?.confirm !== true) return { ok: false, error: '需要二次确认' };
      return removeDesignRoot(input?.skill, input?.root);
    });
  }

  for (const s of SKILL_META) {
    reg(`prototype.skill.${s.id}`, async () => {
      return openSkillEditor(s.id, '');
    });
  }

  const manifestHasGalleryPage = (() => {
    try {
      const m = JSON.parse(fs.readFileSync(path.join(pluginRoot, 'orca-plugin.json'), 'utf8'));
      return Array.isArray(m?.contributes?.pages) && m.contributes.pages.some((p) => p.id === 'gallery');
    } catch {
      return false;
    }
  })();

  function canOpenHostGalleryPage() {
    return manifestHasGalleryPage && Boolean(orca.host?.has?.('navigation.openPage'));
  }

  async function openGalleryEntry() {
    if (canOpenHostGalleryPage()) {
      galleryLoading(true);
      ensureGalleryRunning({ timeoutMs: STARTUP_TIMEOUT_MS }).catch(() => {});
      try {
        const nav = orca.navigation
          ? await orca.navigation.openPage('gallery')
          : await orca.host.call('navigation.openPage', { pageId: 'gallery' });
        if (nav?.opened !== false) {
          return { ok: true, mode: 'plugin-page', pageId: 'gallery' };
        }
      } catch (err) {
        orca.log(`navigation.openPage fallback: ${err?.message || err}`);
      } finally {
        galleryLoading(false);
      }
    }
    return openGalleryTab();
  }

  reg('prototype.gallery', async () => openGalleryEntry());

  startTabCacheLoop();
  ensureGalleryRunning({ timeoutMs: STARTUP_TIMEOUT_MS }).catch(() => {});
  orca.log('Lakala-Design-Plugin worker activated successfully.');

  return {
    dispose() {
      if (tabCacheTimer) {
        clearInterval(tabCacheTimer);
        tabCacheTimer = null;
      }
      if (reresolveTimer) {
        clearTimeout(reresolveTimer);
        reresolveTimer = null;
      }
    },
  };
}
