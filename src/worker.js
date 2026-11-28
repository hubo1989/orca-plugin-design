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
import {
  resolveOrcaBin,
  computeGalleryBuildId,
  resolveActiveWorkspace,
} from './workspace-resolver.mjs';

const __filename = fileURLToPath(import.meta.url);
const pluginRoot = path.dirname(path.dirname(__filename));
const GALLERY_SCRIPT = path.join(pluginRoot, 'src', 'gallery-server.mjs');
const EXPECTED_BUILD_ID = computeGalleryBuildId(pluginRoot);

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

function defaultProfileDbPath() {
  const home = process.env.HOME || os.homedir();
  const cfgParent = process.platform === 'darwin'
    ? path.join(home, 'Library', 'Application Support', 'orca')
    : (process.platform === 'win32'
      ? path.join(process.env.APPDATA || path.join(home, 'AppData', 'Roaming'), 'orca')
      : path.join(process.env.XDG_CONFIG_HOME || path.join(home, '.config'), 'orca'));
  return process.env.ORCA_PROFILE_DB || path.join(cfgParent, 'profiles', 'local-default', 'profile-state.db');
}

function defaultRunCli(orcaBin, args, timeout = 3000) {
  return new Promise((resolve) => {
    execFile(orcaBin, args, { timeout }, (err, stdout, stderr) => {
      resolve({ err, stdout: String(stdout || ''), stderr: String(stderr || '') });
    });
  });
}

function writeJsonAtomic(filePath, data) {
  const dir = path.dirname(filePath);
  fs.mkdirSync(dir, { recursive: true });
  const tmp = path.join(dir, `${path.basename(filePath)}.tmp.${process.pid}.${Date.now()}`);
  fs.writeFileSync(tmp, JSON.stringify(data));
  fs.renameSync(tmp, filePath);
}

export default async function activate(orca, deps = {}) {
  orca.log('Orca-Design worker activating...');

  const orcaBin = deps.orcaBin || resolveOrcaBin();
  const galleryPort = Number(deps.port || process.env.PORT) || 3480;
  const galleryUrl = `http://127.0.0.1:${galleryPort}/`;
  const stateFile = deps.stateFile || process.env.ORCA_STATE_FILE || path.join(os.tmpdir(), 'prototype-studio-state.json');
  const profileDbPath = deps.profileDbPath || defaultProfileDbPath();

  const fetchFn = deps.fetchFn || globalThis.fetch;
  const spawnFn = deps.spawnFn || spawn;
  const execFileSyncFn = deps.execFileSyncFn || execFileSync;
  const killFn = deps.killFn || ((pid, sig) => process.kill(pid, sig));
  const runCli = deps.runCli || ((args, timeout) => defaultRunCli(orcaBin, args, timeout));

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
  let workspaceSelector = '';
  let openedWorkspaces = [];

  let cachedGalleryPageId = null;
  let cachedWorkspaceKey = '';
  let galleryOpenInFlight = null;
  let galleryReadyPromise = null;
  let lastGalleryOpenAt = 0;
  let lastGalleryWsKey = '';

  function syncStateFile(wsRes) {
    try {
      if (wsRes?.ok) {
        writeJsonAtomic(stateFile, {
          workspaceRoot: wsRes.workspaceRoot,
          workspaceName: wsRes.workspaceName,
          selector: wsRes.selector,
          updatedAt: Date.now(),
        });
      } else if (wsRes?.code === 'REMOTE_WORKSPACE') {
        writeJsonAtomic(stateFile, {
          workspaceRoot: '',
          workspaceName: '',
          isRemote: true,
          updatedAt: Date.now(),
        });
      }
    } catch (err) {
      orca.log(`state sync warning: ${err.message}`);
    }
  }

  async function resolveAndSyncWorkspace(overridePath) {
    if (overridePath) {
      if (!fs.existsSync(overridePath) || !fs.statSync(overridePath).isDirectory()) {
        return {
          ok: false,
          code: 'REMOTE_WORKSPACE',
          error: `远程/本机不可见的工作区暂不支持项目库（仅支持本机工作区）：${overridePath}`,
        };
      }
      if (isInstalledPluginPath(overridePath)) {
        return {
          ok: false,
          code: 'PLUGIN_INSTALL_DIR',
          error: '当前工作区是 Orca 插件安装路径，请切换到其他工作区使用项目库',
        };
      }
      const nextKey = `path:${overridePath}`;
      if (cachedWorkspaceKey !== nextKey) {
        cachedGalleryPageId = null;
        cachedWorkspaceKey = nextKey;
      }
      workspaceRoot = overridePath;
      workspaceName = path.basename(overridePath);
      workspaceSelector = nextKey;
      return {
        ok: true,
        workspaceRoot,
        workspaceName,
        selector: workspaceSelector,
      };
    }

    const res = await resolveActiveWorkspace({
      runOrcaCli: (args) => runCli(args, 3000),
      listWorkspaces: async () => {
        const listed = await orca.host.call('workspace.list').catch(() => null);
        openedWorkspaces = listed?.workspaces || listed?.result?.workspaces || [];
        return listed;
      },
      readContext: () => orca.host.call('workspace.readContext').catch(() => null),
      profileDbPath,
      execFileSyncFn,
      isInstalledPluginPathFn: isInstalledPluginPath,
    });

    if (res.ok) {
      const nextKey = res.selector || res.workspaceRoot;
      if (cachedWorkspaceKey !== nextKey) {
        cachedGalleryPageId = null;
        cachedWorkspaceKey = nextKey;
      }
      workspaceRoot = res.workspaceRoot;
      workspaceName = res.workspaceName;
      workspaceSelector = res.selector;
      syncStateFile(res);
    } else {
      cachedGalleryPageId = null;
      cachedWorkspaceKey = '';
      workspaceRoot = '';
      workspaceName = '';
      workspaceSelector = '';
      if (res.code === 'REMOTE_WORKSPACE') syncStateFile(res);
    }
    return res;
  }

  function galleryLoading(on) {
    try {
      orca.panels?.post?.('studio.opening', { opening: Boolean(on) });
    } catch { /* ignore */ }
  }

  async function probeGalleryHealth() {
    try {
      const r = await fetchFn(`${galleryUrl}api/health`, { signal: AbortSignal.timeout(800) });
      const text = await r.text();
      if (r.status === 200) {
        let data = null;
        try { data = JSON.parse(text); } catch { /* ignore */ }
        if (data && data.ok === true && data.app === 'orca-plugin-design') {
          return {
            alive: true,
            mine: true,
            match: data.buildId === EXPECTED_BUILD_ID,
            pid: Number.isInteger(data.pid) ? data.pid : null,
          };
        }
        return { alive: true, mine: false };
      }
      if (r.status === 404 && text.trim() === '{}') {
        try {
          const r2 = await fetchFn(`${galleryUrl}api/list`, { signal: AbortSignal.timeout(1200) });
          if (r2.ok) {
            const listData = await r2.json();
            if (listData && Array.isArray(listData.artifacts)) {
              return { alive: true, mine: true, match: false, legacy: true };
            }
          }
        } catch { /* ignore */ }
      }
      return { alive: true, mine: false };
    } catch {
      return { alive: false };
    }
  }

  function findListeningGalleryPids() {
    if (process.platform === 'win32') return [];
    try {
      const raw = execFileSyncFn('lsof', ['-nP', `-iTCP:${galleryPort}`, '-sTCP:LISTEN', '-t'], {
        timeout: 1500,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
      });
      const pids = String(raw || '')
        .split(/\s+/)
        .map((s) => Number.parseInt(s, 10))
        .filter((n) => Number.isInteger(n) && n > 0 && n !== process.pid);
      const verified = [];
      for (const pid of pids) {
        try {
          const cmd = execFileSyncFn('ps', ['-p', String(pid), '-o', 'args='], {
            timeout: 1000,
            encoding: 'utf8',
            stdio: ['ignore', 'pipe', 'ignore'],
          });
          if (String(cmd || '').includes('gallery-server.mjs')) verified.push(pid);
        } catch { /* ignore */ }
      }
      return verified;
    } catch {
      return [];
    }
  }

  function isOwnGalleryPid(pid) {
    if (!Number.isInteger(pid) || pid <= 0 || pid === process.pid) return false;
    if (process.platform === 'win32') return true;
    try {
      const cmd = execFileSyncFn('ps', ['-p', String(pid), '-o', 'args='], {
        timeout: 1000,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
      });
      return String(cmd || '').includes('gallery-server.mjs');
    } catch {
      return false;
    }
  }

  async function waitUntilPortFree(maxWaitMs = 1500) {
    const deadline = Date.now() + maxWaitMs;
    while (Date.now() < deadline) {
      const p = await probeGalleryHealth();
      if (!p.alive) return true;
      await new Promise((res) => setTimeout(res, 60));
    }
    return false;
  }

  async function ensureGalleryReady({ timeoutMs = 8000 } = {}) {
    if (process.env.ORCA_DESIGN_NO_SPAWN === '1') {
      return { ok: true, stub: true };
    }
    if (galleryReadyPromise) return galleryReadyPromise;

    galleryReadyPromise = (async () => {
      let probe = await probeGalleryHealth();
      if (probe.alive && probe.mine && probe.match) {
        return { ok: true, reused: true };
      }
      if (probe.alive && !probe.mine) {
        return {
          ok: false,
          code: 'PORT_IN_USE',
          error: `项目库端口 ${galleryPort} 已被其他程序占用`,
        };
      }

      if (probe.alive && probe.mine && !probe.match) {
        if (!probe.legacy) {
          try {
            await fetchFn(`${galleryUrl}api/shutdown`, {
              method: 'POST',
              headers: {
                'content-type': 'application/json',
                origin: `http://127.0.0.1:${galleryPort}`,
                host: `127.0.0.1:${galleryPort}`,
              },
              body: '{}',
              signal: AbortSignal.timeout(1000),
            });
          } catch { /* ignore */ }
        }

        let freed = await waitUntilPortFree(1200);
        if (!freed) {
          const candidates = new Set();
          if (isOwnGalleryPid(probe.pid)) candidates.add(probe.pid);
          for (const pid of findListeningGalleryPids()) candidates.add(pid);
          for (const pid of candidates) {
            try { killFn(pid, 'SIGTERM'); } catch { /* ignore */ }
          }
          freed = await waitUntilPortFree(1500);
        }
        if (!freed) {
          return {
            ok: false,
            code: 'PORT_IN_USE',
            error: `项目库端口 ${galleryPort} 仍被旧进程占用，无法自动重启`,
          };
        }
      }

      let child = null;
      try {
        child = spawnFn(process.execPath, [GALLERY_SCRIPT], {
          detached: true,
          stdio: 'ignore',
          env: {
            ...process.env,
            ELECTRON_RUN_AS_NODE: '1',
            PORT: String(galleryPort),
            ORCA_CLI_COMMAND: orcaBin,
            ORCA_PROFILE_DB: profileDbPath,
            ORCA_STATE_FILE: stateFile,
          },
        });
        child.on?.('error', (err) => orca.log(`gallery spawn error: ${err.message}`));
        child.unref?.();
      } catch (err) {
        orca.log(`gallery spawn error: ${err.message}`);
        return { ok: false, code: 'SPAWN_FAILED', error: `项目库服务启动失败：${err.message}` };
      }

      const deadline = Date.now() + timeoutMs;
      while (Date.now() < deadline) {
        probe = await probeGalleryHealth();
        if (probe.alive && probe.mine && probe.match) {
          return { ok: true, spawned: true };
        }
        if (probe.alive && !probe.mine) {
          return {
            ok: false,
            code: 'PORT_IN_USE',
            error: `项目库端口 ${galleryPort} 已被其他程序占用`,
          };
        }
        await new Promise((res) => setTimeout(res, 60));
      }

      if (child?.pid) {
        try { killFn(child.pid, 'SIGTERM'); } catch { /* ignore */ }
      }
      return { ok: false, code: 'GALLERY_TIMEOUT', error: '项目库服务启动超时，请稍后重试' };
    })();

    try {
      return await galleryReadyPromise;
    } finally {
      galleryReadyPromise = null;
    }
  }

  async function callGalleryPost(route, payload) {
    const ready = await ensureGalleryReady();
    if (!ready.ok) return ready;
    for (let i = 0; i < 8; i++) {
      try {
        const r = await fetchFn(`${galleryUrl}${route.replace(/^\//, '')}`, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            origin: `http://127.0.0.1:${galleryPort}`,
            host: `127.0.0.1:${galleryPort}`,
          },
          body: JSON.stringify(payload),
          signal: AbortSignal.timeout(10000),
        });
        return await r.json();
      } catch {
        await new Promise((res) => setTimeout(res, 200));
      }
    }
    return { ok: false, error: '项目库服务请求超时，请稍后重试' };
  }

  function parseJsonSafe(raw) {
    try { return JSON.parse(String(raw || '')); } catch { return null; }
  }

  function extractCliError(res) {
    const parsed = parseJsonSafe(res.stdout) || parseJsonSafe(res.stderr);
    const code = parsed?.error?.code || '';
    const message = parsed?.error?.message || res.stderr || res.err?.message || '';
    return { code, message: String(message || '').trim() };
  }

  async function runTabCli(baseArgs, selector, timeout = 5000) {
    const withSel = selector ? [...baseArgs, '--worktree', selector, '--json'] : [...baseArgs, '--json'];
    let res = await runCli(withSel, timeout);
    if (res.err && selector) {
      const info = extractCliError(res);
      if (info.code === 'selector_not_found' || info.message.includes('selector_not_found')) {
        res = await runCli([...baseArgs, '--json'], timeout);
      }
    }
    const data = parseJsonSafe(res.stdout);
    const ok = !res.err && (!data || data.ok !== false);
    const info = ok ? null : extractCliError(res);
    return { ok, data, errorMsg: info?.message || '' };
  }

  async function verifyTabCurrent(pageId, selector) {
    const cur = await runTabCli(['tab', 'current'], selector, 3000);
    if (!cur.ok) return false;
    const activeId = cur.data?.result?.tab?.browserPageId || cur.data?.result?.browserPageId || '';
    return activeId === pageId;
  }

  async function openOrRevealMainTab(targetUrl, wsInfo) {
    const selector = wsInfo?.selector || '';
    const wsKey = selector || wsInfo?.workspaceRoot || '';

    const listRes = await runTabCli(['tab', 'list'], selector, 3000);
    const tabs = Array.isArray(listRes.data?.result?.tabs) ? listRes.data.result.tabs : [];

    const hit = targetUrl === galleryUrl
      ? (tabs.find((t) => t && String(t.url || '').startsWith(galleryUrl))
        || (cachedWorkspaceKey === wsKey && cachedGalleryPageId
          ? { browserPageId: cachedGalleryPageId, url: galleryUrl }
          : null))
      : tabs.find((t) => t && String(t.url || '') === targetUrl);

    if (hit?.browserPageId) {
      if (hit.loadError || (targetUrl !== galleryUrl && hit.url !== targetUrl)) {
        await runTabCli(['goto', '--page', hit.browserPageId, '--url', targetUrl], selector, 5000);
      }
      const sw = await runTabCli(['tab', 'switch', '--page', hit.browserPageId, '--focus'], selector, 5000);
      if (sw.ok && (await verifyTabCurrent(hit.browserPageId, selector))) {
        if (targetUrl === galleryUrl) {
          cachedGalleryPageId = hit.browserPageId;
          cachedWorkspaceKey = wsKey;
        }
        return { ok: true, reused: true, pageId: hit.browserPageId };
      }
      if (cachedGalleryPageId === hit.browserPageId) cachedGalleryPageId = null;
    }

    const cr = await runTabCli(['tab', 'create', '--url', targetUrl], selector, 8000);
    if (!cr.ok) {
      return { ok: false, error: cr.errorMsg || '创建主对话区标签页失败' };
    }
    const pageId = cr.data?.result?.browserPageId || cr.data?.result?.tabId || '';
    if (!pageId) {
      return { ok: false, error: 'orca tab create 未返回 browserPageId' };
    }

    const sw = await runTabCli(['tab', 'switch', '--page', pageId, '--focus'], selector, 5000);
    if (!sw.ok) {
      return { ok: false, error: sw.errorMsg || '切换标签页聚焦失败' };
    }
    const verified = await verifyTabCurrent(pageId, selector);
    if (!verified) {
      return { ok: false, error: '标签页未能切换至当前工作区前台' };
    }

    if (targetUrl === galleryUrl) {
      cachedGalleryPageId = pageId;
      cachedWorkspaceKey = wsKey;
    }
    return { ok: true, reused: false, pageId };
  }

  async function openGalleryTab(targetUrl = galleryUrl) {
    if (galleryOpenInFlight) return galleryOpenInFlight;

    const currentKey = workspaceSelector || workspaceRoot || '';
    if (
      targetUrl === galleryUrl
      && Date.now() - lastGalleryOpenAt < 2000
      && (!currentKey || currentKey === lastGalleryWsKey)
    ) {
      return { ok: true, reused: true, throttled: true };
    }

    const T0 = Date.now();
    const lap = (name) => orca.log(`gallery-open ${name} +${Date.now() - T0}ms`);
    galleryLoading(true);
    galleryOpenInFlight = (async () => {
      try {
        lap('start');
        const [wsRes] = await Promise.all([
          resolveAndSyncWorkspace(),
          probeGalleryHealth(),
        ]);
        lap('workspace');
        if (!wsRes.ok) {
          orca.log(`gallery blocked (${wsRes.code}): ${wsRes.error}`);
          return { ok: false, code: wsRes.code, error: wsRes.error };
        }

        const ready = await ensureGalleryReady();
        lap('server-ready');
        if (!ready.ok) {
          orca.log(`gallery server failed: ${ready.error}`);
          return { ok: false, code: ready.code, error: ready.error };
        }

        const tabRes = await openOrRevealMainTab(targetUrl, wsRes);
        lap('tab-open');
        if (!tabRes.ok) {
          orca.log(`gallery tab failed: ${tabRes.error}`);
          return { ok: false, error: tabRes.error };
        }

        lastGalleryOpenAt = Date.now();
        lastGalleryWsKey = wsRes.selector || wsRes.workspaceRoot;
        return { ok: true, reused: Boolean(tabRes.reused), pageId: tabRes.pageId };
      } finally {
        galleryOpenInFlight = null;
        galleryLoading(false);
        orca.log(`gallery-open done total ${Date.now() - T0}ms`);
      }
    })();
    return galleryOpenInFlight;
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

  async function openSkillEditor(skillId, rootInput, wsPath) {
    const wsRes = await resolveAndSyncWorkspace(wsPath);
    if (!wsRes.ok) return { ok: false, code: wsRes.code, error: wsRes.error };

    const norm = normalizeTypeId(skillId);
    let root = rootInput;
    if (!root) {
      const roots = (scanDesignProjects(wsRes.workspaceRoot)[norm]) || [];
      if (roots.length === 0) {
        return { ok: false, error: `no ${norm} project found under ${wsRes.workspaceRoot || '(no workspace)'}` };
      }
      root = roots[0].root;
    }

    const r = await callGalleryPost('/api/open', { skill: norm, root });
    if (!r.ok) return r;

    const rawLink = r.pageUrl || r.url;
    if (rawLink) {
      const fullUrl = new URL(rawLink, galleryUrl).toString();
      const tabRes = await openOrRevealMainTab(fullUrl, wsRes);
      if (!tabRes.ok) {
        orca.log(`Browser tab create failed: ${tabRes.error}`);
        return { ok: false, url: fullUrl, error: tabRes.error, tabError: tabRes.error };
      }
      return { ok: true, url: fullUrl, pageId: tabRes.pageId, reused: Boolean(tabRes.reused) };
    }
    return r;
  }

  async function createExample(skillId, nameInput, wsPath) {
    const wsRes = await resolveAndSyncWorkspace(wsPath);
    if (!wsRes.ok) return { ok: false, code: wsRes.code, error: wsRes.error };
    const norm = normalizeTypeId(skillId);
    return callGalleryPost('/api/create', { skill: norm, name: nameInput });
  }

  // 1. 激活顶部同步注册全部命令、面板 Handler 与事件监听（严禁阻塞于 await 之后）
  if (orca.panels?.handle) {
    handle('studio.status', async () => {
      const wsRes = await resolveAndSyncWorkspace();
      return {
        ok: true,
        workspaceRoot: wsRes.ok ? wsRes.workspaceRoot : '',
        workspaceName: wsRes.ok ? wsRes.workspaceName : '',
        workspaceError: wsRes.ok ? null : wsRes.error,
        runtime: getRuntimeStatus(),
        workspaces: openedWorkspaces.map((w) => ({ name: w.name, path: w.path, kind: w.kind, branch: w.branch })),
      };
    });
    handle('studio.gallery.open', async () => openGalleryTab());
    handle('studio.restart', async () => {
      try {
        const manifest = JSON.parse(fs.readFileSync(path.join(pluginRoot, 'orca-plugin.json'), 'utf8'));
        const pluginKey = manifest.publisher ? `${manifest.publisher}.${manifest.id}` : `local.${manifest.id}`;
        execFile(orcaBin, ['plugin', 'restart', pluginKey], () => {});
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
      const wsRes = await resolveAndSyncWorkspace(input?.wsPath);
      const rootDir = wsRes.ok ? wsRes.workspaceRoot : '';
      const found = scanDesignProjects(rootDir);
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

  if (orca.events?.on) {
    orca.events.on('agent.status.changed', () => {
      if (!workspaceRoot) resolveAndSyncWorkspace().catch(() => {});
    });
    orca.events.on('workspace.changed', async () => {
      cachedGalleryPageId = null;
      cachedWorkspaceKey = '';
      await resolveAndSyncWorkspace().catch(() => {});
    });
  }

  // 2. 非阻塞同步 extra-types 与后台预热
  try {
    const syncRes = syncBundledExtraTypes({ pluginRoot });
    if (syncRes.synced?.length) {
      orca.log(`Synced bundled extra-types (${syncRes.synced.join(', ')}) -> ${syncRes.extraRoot}`);
    }
  } catch (e) {
    orca.log(`Bundled extra-types sync warning: ${e.message}`);
  }

  resolveAndSyncWorkspace()
    .then((res) => {
      orca.log(`Focused workspace: ${res.ok ? res.workspaceName : '(unresolved)'} ${res.ok ? res.workspaceRoot : ''}`);
    })
    .catch(() => {});

  if (process.env.ORCA_DESIGN_NO_PREWARM !== '1') {
    ensureRuntime().then((r) => {
      if (r.ok) orca.log(`Open Artifact runtime ready (${r.version}, source=${r.source}, reused=${r.reused})`);
      else orca.log(`Open Artifact runtime prewarm deferred: ${r.error}`);
    }).catch((e) => orca.log(`Runtime prewarm error: ${e.message}`));
    ensureGalleryReady().catch(() => {});
  }

  orca.log('Orca-Design worker activated successfully.');
}
