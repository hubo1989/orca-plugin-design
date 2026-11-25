import { execFile, execFileSync, spawn } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import os from 'node:os';

import {
  SKILLS,
  EXAMPLE_TEMPLATES,
  normalizeTypeId,
} from './skills-meta.mjs';
import { ensureRuntime, getRuntimeStatus } from './runtime-manager.mjs';
import { syncBundledExtraTypes } from './extra-types.mjs';

const __filename = fileURLToPath(import.meta.url);
const pluginRoot = path.dirname(path.dirname(__filename));

const ORCA_BIN = process.env.ORCA_CLI_COMMAND || '/Applications/Orca.app/Contents/Resources/bin/orca';
const GALLERY_PORT = Number(process.env.PORT) || 3480;
const GALLERY_URL = `http://127.0.0.1:${GALLERY_PORT}/`;
const GALLERY_SCRIPT = path.join(pluginRoot, 'src', 'gallery-server.mjs');

function orcaTab(args) {
  return new Promise((resolve) => {
    execFile(ORCA_BIN, args, { timeout: 3000 }, (err, stdout, stderr) => {
      resolve({ err, stdout: String(stdout || ''), stderr: String(stderr || '') });
    });
  });
}

function orcaTabCreate(url, worktreePath) {
  const args = ['tab', 'create', '--url', url, '--split', 'right'];
  if (worktreePath) args.push('--worktree', `path:${worktreePath}`);
  return new Promise((resolve) => {
    execFile(ORCA_BIN, args, { timeout: 8000 }, (err, stdout, stderr) => {
      resolve(err ? `${err.message}${stderr ? ` :: ${String(stderr).slice(0, 200)}` : ''}` : null);
    });
  });
}

export default async function activate(orca) {
  orca.log('Orca-Design worker activating...');

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

  let workspaceRoot = '';
  let workspaceName = '';
  let openedWorkspaces = [];

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

  async function refreshWorkspaces() {
    try {
      const listed = await orca.host.call('workspace.list', { opened: true })
        .catch(() => orca.host.call('workspace.list').catch(() => null));
      openedWorkspaces = listed?.workspaces ?? [];
    } catch {
      openedWorkspaces = [];
    }
  }

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

  const PROFILE_DB = process.env.ORCA_PROFILE_DB || path.join(os.homedir(), 'Library', 'Application Support', 'orca', 'profiles', 'local-default', 'profile-state.db');

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
    await refreshWorkspaces();
    const fromProfile = focusedFromProfile();
    if (fromProfile) {
      const known = openedWorkspaces.find((w) => w.path === fromProfile.path);
      if (known) return known;
      return { ...fromProfile, branch: null, id: '' };
    }
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
    const candidates = openedWorkspaces.filter((w) =>
      w.branch === ctx.branch && w.name === ctx.displayName);
    if (candidates.length === 1) return candidates[0];
    return null;
  }

  const focusedAtStart = await resolveFocusedWorkspace();
  workspaceRoot = focusedAtStart?.path ?? '';
  workspaceName = focusedAtStart?.name ?? '';
  orca.log(`Focused workspace: ${workspaceName || '(unresolved)'} ${workspaceRoot}`);

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
      workspaceRoot = '';
      workspaceName = '';
      const hit = await resolveFocusedWorkspace();
      if (generation !== workspaceGeneration) return;
      workspaceRoot = hit?.path ?? '';
      workspaceName = hit?.name ?? '';
      orca.log(`Focused workspace: ${workspaceName || '(unresolved)'} ${workspaceRoot}`);
    });
  }

  function scanDesignProjects(rootDir) {
    const bySkill = {};
    for (const s of SKILLS) bySkill[s.id] = [];
    if (!rootDir) return bySkill;
    const SKIP = new Set(['.git', 'node_modules', '.orca', 'vendor', 'dist', '.venv', '__pycache__', 'build']);
    (function walk(dir, depth) {
      if (depth > 3) return;
      let entries;
      try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
      for (const e of entries) {
        if (!e.isDirectory() || SKIP.has(e.name)) continue;
        const p = path.join(dir, e.name);
        if (isInstalledPluginPath(p)) continue;
        let matched = false;
        for (const s of SKILLS) {
          for (const mk of s.detect) {
            if (s.id === 'page' && !fs.existsSync(path.join(p, '.artifact.json'))) continue;
            if (fs.existsSync(path.join(p, mk))) {
              let title = null;
              try {
                const file = path.join(p, s.titlePath[0]);
                title = JSON.parse(fs.readFileSync(file, 'utf8'))[s.titlePath[1]] || null;
              } catch { /* fallback */ }
              bySkill[s.id].push({ title: title || e.name, root: p });
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

  async function galleryAlive() {
    try {
      const r = await fetch(`${GALLERY_URL}api/health`, { signal: AbortSignal.timeout(800) });
      if (r.ok) return true;
    } catch { /* ignore */ }
    try {
      const r = await fetch(`${GALLERY_URL}api/list`, { signal: AbortSignal.timeout(1200) });
      return r.ok;
    } catch {
      return false;
    }
  }

  // Use spawn + unref (never execFile, whose callback keeps the parent event loop alive)
  async function ensureGallery() {
    if (process.env.ORCA_DESIGN_NO_SPAWN === '1') return false;
    if (await galleryAlive()) return true;
    try {
      const child = spawn(process.execPath, [GALLERY_SCRIPT], {
        detached: true,
        stdio: 'ignore',
        env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
      });
      child.on('error', (err) => orca.log(`gallery spawn error: ${err.message}`));
      child.unref();
    } catch (err) {
      orca.log(`gallery spawn error: ${err.message}`);
    }
    return false;
  }

  async function callGalleryPost(route, payload) {
    await ensureGallery();
    for (let i = 0; i < 12; i++) {
      try {
        const r = await fetch(`${GALLERY_URL}${route.replace(/^\//, '')}`, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            origin: `http://127.0.0.1:${GALLERY_PORT}`,
            host: `127.0.0.1:${GALLERY_PORT}`,
          },
          body: JSON.stringify(payload),
          signal: AbortSignal.timeout(10000),
        });
        return await r.json();
      } catch {
        await new Promise((res) => setTimeout(res, 250));
      }
    }
    return { ok: false, error: '项目库服务启动超时，请稍后重试' };
  }

  let galleryOpenInFlight = null;
  let lastGalleryOpenAt = 0;
  let cachedGalleryPageId = null;
  let cachedPageWsRoot = '';
  let tabCacheTimer = null;

  function tabListArgs() {
    return workspaceRoot
      ? ['tab', 'list', '--json', '--worktree', `path:${workspaceRoot}`]
      : ['tab', 'list', '--json'];
  }
  async function refreshTabCache() {
    if (cachedPageWsRoot !== (workspaceRoot || '')) {
      cachedGalleryPageId = null;
      cachedPageWsRoot = workspaceRoot || '';
    }
    const r = await orcaTab(tabListArgs());
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
    } catch { /* ignore on older hosts */ }
  }
  function galleryLoading(on) {
    sbUpdate(on
      ? { id: 'gallery', text: '⟳ 打开中…', tone: 'accent', tooltip: 'Orca-Design · 正在打开项目库' }
      : { ...SB_IDLE, tooltip: 'Orca-Design · 打开设计项目库' });
  }

  async function openGalleryTab(targetUrl = GALLERY_URL) {
    if (galleryOpenInFlight) return galleryOpenInFlight;
    if (workspaceRoot && (!fs.existsSync(workspaceRoot) || !fs.statSync(workspaceRoot).isDirectory())) {
      orca.log(`gallery blocked: workspace not visible locally: ${workspaceRoot}`);
      return { ok: false, error: `远程/本机不可见的工作区暂不支持项目库（仅支持本机工作区）：${workspaceRoot}` };
    }
    if (Date.now() - lastGalleryOpenAt < 2000 && targetUrl === GALLERY_URL) {
      return { ok: true, reused: true, throttled: true };
    }
    const T0 = Date.now();
    const lap = (name) => orca.log(`gallery-open ${name} +${Date.now() - T0}ms`);
    galleryLoading(true);
    galleryOpenInFlight = (async () => {
      try {
        lap('start');
        ensureGallery().catch((e) => orca.log(`gallery ensure: ${e.message}`));
        refreshTabCache().catch(() => {});

        if (targetUrl === GALLERY_URL && cachedGalleryPageId) {
          const sw = await orcaTab(['tab', 'switch', '--page', cachedGalleryPageId, '--focus']);
          lap('tab-switch(cached)');
          if (!sw.err) {
            lastGalleryOpenAt = Date.now();
            return { ok: true, reused: true };
          }
          cachedGalleryPageId = null;
        }
        try {
          const listed = await orcaTab(tabListArgs());
          lap('tab-list');
          if (!listed.err) {
            const tabs = JSON.parse(listed.stdout).result?.tabs || [];
            const hit = tabs.find((t) => String(t.url || '').startsWith(GALLERY_URL));
            if (hit && targetUrl === GALLERY_URL) {
              const sw = await orcaTab(['tab', 'switch', '--page', hit.browserPageId, '--focus']);
              lap('tab-switch');
              if (!sw.err) { lastGalleryOpenAt = Date.now(); return { ok: true, reused: true }; }
            }
          }
        } catch { /* fall through to create */ }
        const tabError = await orcaTabCreate(targetUrl, workspaceRoot || undefined);
        if (!tabError) refreshTabCache().catch(() => {});
        lap('tab-create');
        if (tabError) {
          orca.log(`gallery tab-create failed: ${tabError}`);
          return { ok: false, error: tabError };
        }
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

  async function openSkillEditor(skillId, rootInput, wsPath) {
    const norm = normalizeTypeId(skillId);
    let root = rootInput;
    if (!root) {
      const roots = (scanDesignProjects(wsPath || workspaceRoot)[norm]) || [];
      if (roots.length === 0) {
        return { ok: false, error: `no ${norm} project found under ${workspaceRoot || '(no workspace)'}` };
      }
      root = roots[0].root;
    }
    const r = await callGalleryPost('/api/open', { skill: norm, root });
    if (!r.ok) return r;
    if (r.url) {
      const tabError = await orcaTabCreate(r.url, workspaceRoot || undefined);
      if (tabError) orca.log(`Browser tab create failed: ${tabError}`);
      return { ok: true, url: r.url, ...(tabError ? { tabError } : {}) };
    }
    return r;
  }

  async function createExample(skillId, nameInput, wsPath) {
    const norm = normalizeTypeId(skillId);
    const base = wsPath || workspaceRoot;
    if (!base) return { ok: false, error: '当前工作区未识别，请稍后重试' };
    if (!fs.existsSync(base) || !fs.statSync(base).isDirectory()) {
      return { ok: false, error: `工作区路径在本机不可见（远程工作区或未挂载）：${base}。项目库目前仅支持本机工作区` };
    }
    if (isInstalledPluginPath(base)) {
      return { ok: false, error: '当前工作区是 Orca 插件安装路径，请切换到其他工作区创建设计项目' };
    }
    return callGalleryPost('/api/create', { skill: norm, name: nameInput });
  }

  if (orca.panels?.handle) {
    handle('studio.status', async () => ({
      ok: true,
      workspaceRoot,
      workspaceName,
      runtime: getRuntimeStatus(),
      workspaces: openedWorkspaces.map((w) => ({ name: w.name, path: w.path, kind: w.kind, branch: w.branch })),
    }));
    handle('studio.gallery.open', async () => openGalleryTab());
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
      return { ok: true, ctx, workspaces: openedWorkspaces, runtime: getRuntimeStatus() };
    });
    handle('studio.skills', async (input) => {
      const found = scanDesignProjects(input?.wsPath || workspaceRoot);
      const out = SKILLS.map((s) => ({
        id: s.id,
        name: s.name,
        canCreateExample: Boolean(EXAMPLE_TEMPLATES[s.id] || s.blankCreatable),
        roots: found[s.id] || [],
      }));
      return { ok: true, skills: out };
    });
    handle('studio.skill.open', async (input) => openSkillEditor(input?.skill, input?.root, input?.wsPath));
    handle('studio.skill.create', async (input) => createExample(input?.skill, input?.name, input?.wsPath));
    handle('studio.skill.rename', async (input) => callGalleryPost('/api/rename', { skill: input?.skill, root: input?.root, name: input?.name }));
    handle('studio.skill.remove', async (input) => {
      if (input?.confirm !== true) return { ok: false, error: '需要二次确认' };
      return callGalleryPost('/api/delete', { root: input?.root, moveFolder: input?.moveFolder === true });
    });
  }

  for (const s of SKILLS) {
    if (s.legacyId) {
      reg(`prototype.skill.${s.legacyId}`, async () => openSkillEditor(s.id, ''));
    }
  }
  reg('prototype.gallery', async () => openGalleryTab());

  try {
    const syncRes = syncBundledExtraTypes({ pluginRoot });
    if (syncRes.synced?.length) {
      orca.log(`Synced bundled extra-types (${syncRes.synced.join(', ')}) -> ${syncRes.extraRoot}`);
    }
  } catch (e) {
    orca.log(`Bundled extra-types sync warning: ${e.message}`);
  }

  if (process.env.ORCA_DESIGN_NO_PREWARM !== '1') {
    startTabCacheLoop();
    ensureRuntime().then((r) => {
      if (r.ok) orca.log(`Open Artifact runtime ready (${r.version}, source=${r.source}, reused=${r.reused})`);
      else orca.log(`Open Artifact runtime prewarm deferred: ${r.error}`);
    }).catch((e) => orca.log(`Runtime prewarm error: ${e.message}`));
    ensureGallery().catch(() => {});
  }
  orca.log('Orca-Design worker activated successfully.');
}
