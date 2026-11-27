// Lakala-Design-Plugin · 共享工作区解析与路径写护栏（零外部依赖）
// 供 src/worker.js 与 src/gallery-server.mjs 共用，统一拦截远程 URI、插件安装目录与系统保护路径。
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const REMOTE_URI_RE = /^(?:vscode-remote|ssh-remote|dev-container|attached-container|vsonline|codespaces|tunnel|remote):/i;
const WSL_SCHEME_RE = /^wsl\+/i;
const WSL_UNC_RE = /^\\\\wsl(?:\$|\.localhost)\\/i;
const SCHEME_RE = /^([a-z][a-z0-9+.-]*):\/\//i;
const WIN_DRIVE_ROOT_RE = /^[A-Za-z]:[\\/]?$/;
const WIN_WINDOWS_DIR_RE = /^C:[\\/]Windows(?:[\\/]|$)/i;

export const WORKSPACE_ERROR_COPY = {
  NO_WORKSPACE: {
    zh: '当前未检测到已打开的本机工作区，请在 Orca 中打开本地项目文件夹后重试。',
    en: 'No local workspace detected. Open a local project folder in Orca and try again.',
  },
  REMOTE_OR_UNMOUNTED: {
    zh: '工作区路径在本机不可见（远程工作区或未挂载）：{path}。项目库目前仅支持本机工作区。',
    en: 'Workspace path is not accessible locally (remote or unmounted): {path}. Design Studio currently supports local workspaces only.',
  },
  FORBIDDEN_WORKSPACE_PATH: {
    zh: '当前工作区为插件安装目录或受保护系统路径（{path}），请切换到业务项目工作区后再创建设计作品。',
    en: 'Current workspace is a plugin installation directory or protected system path ({path}). Switch to a project workspace before creating design works.',
  },
  PORT_OCCUPIED_BY_OTHER: {
    zh: '项目库端口 {port} 已被其他程序占用，请释放该端口或通过环境变量 PORT 指定空闲端口后重试。',
    en: 'Gallery server port {port} is occupied by another program. Free the port or set PORT to an available port and try again.',
  },
  START_TIMEOUT: {
    zh: '项目库本地服务启动超时或未响应（端口 {port}），请点击重试或检查 Orca 插件日志。',
    en: 'Gallery server startup timed out or did not respond on port {port}. Retry or check Orca plugin logs.',
  },
  DESIGN_SYSTEM_EXISTS: {
    zh: '当前工作区已存在统一设计系统「{title}」；如需更换请打开编辑或先删除现有设计系统。',
    en: 'This workspace already has a unified design system ("{title}"). Open it to edit or delete the existing one first.',
  },
};

export function formatWorkspaceError(code, params = {}, lang = 'zh') {
  const entry = WORKSPACE_ERROR_COPY[code] || WORKSPACE_ERROR_COPY.NO_WORKSPACE;
  const template = entry[lang === 'en' ? 'en' : 'zh'] || entry.zh;
  return template.replace(/\{(\w+)\}/g, (_, k) => String(params[k] ?? ''));
}

export function resolveRealPath(targetPath, realpathFn = fs.realpathSync.native || fs.realpathSync) {
  const fn = typeof realpathFn === 'function' ? realpathFn : (fs.realpathSync.native || fs.realpathSync);
  return fn(String(targetPath || ''));
}

export function safeRealPath(targetPath, realpathFn) {
  const raw = String(targetPath || '');
  if (!raw) return '';
  try {
    return resolveRealPath(raw, realpathFn);
  } catch {
    return path.resolve(raw);
  }
}

function normalizeForCompare(p, platform = process.platform) {
  const resolved = path.resolve(String(p || ''));
  return platform === 'win32' ? resolved.toLowerCase() : resolved;
}

export function isSameOrInside(targetPath, baseDir, platform = process.platform) {
  if (!targetPath || !baseDir) return false;
  const target = normalizeForCompare(targetPath, platform);
  const base = normalizeForCompare(baseDir, platform);
  if (target === base) return true;
  const sep = platform === 'win32' ? '\\' : path.sep;
  const prefix = base.endsWith(sep) || base.endsWith('/') ? base : `${base}${sep}`;
  return target.startsWith(prefix);
}

export function isInsideDir(targetPath, baseDir, platform = process.platform) {
  if (!targetPath || !baseDir) return false;
  const target = normalizeForCompare(targetPath, platform);
  const base = normalizeForCompare(baseDir, platform);
  if (target === base) return false;
  const sep = platform === 'win32' ? '\\' : path.sep;
  const prefix = base.endsWith(sep) || base.endsWith('/') ? base : `${base}${sep}`;
  return target.startsWith(prefix);
}

export function isRemoteWorkspaceUri(raw) {
  if (typeof raw !== 'string') return false;
  const s = raw.trim();
  if (!s) return false;
  if (REMOTE_URI_RE.test(s) || WSL_SCHEME_RE.test(s) || WSL_UNC_RE.test(s)) return true;
  const m = SCHEME_RE.exec(s);
  if (m && m[1].toLowerCase() !== 'file') return true;
  return false;
}

export function parseActiveWorktreeId(activeWorktreeId) {
  const raw = String(activeWorktreeId || '').trim();
  if (!raw) return { isRemote: false, rawPath: '' };
  const parts = raw.split('::');
  // Orca 远程工作树采用三段式 <env>::<host>::<path>，严禁 .pop() 误当本机同名目录
  if (parts.length >= 3) {
    return { isRemote: true, rawPath: raw };
  }
  if (parts.length === 2) {
    return { isRemote: false, rawPath: parts[1] };
  }
  return { isRemote: false, rawPath: '' };
}

export function isInstalledPluginPath(
  targetPath,
  { pluginRoot = '', hostUserData = '', designHome = '', realpathSync, platform = process.platform } = {},
) {
  if (!targetPath || typeof targetPath !== 'string') return false;
  const candidates = [path.resolve(targetPath), safeRealPath(targetPath, realpathSync)].filter(Boolean);
  const protectedBases = [
    hostUserData ? path.join(hostUserData, 'plugins') : '',
    pluginRoot || '',
    hostUserData || '',
    designHome || '',
  ].filter(Boolean);

  for (const base of protectedBases) {
    const resolvedBase = path.resolve(base);
    const realBase = safeRealPath(resolvedBase, realpathSync);
    for (const cand of candidates) {
      if (isSameOrInside(cand, resolvedBase, platform) || (realBase && isSameOrInside(cand, realBase, platform))) {
        return true;
      }
    }
  }
  return false;
}

export function isForbiddenWorkspacePath(
  targetPath,
  {
    pluginRoot = '',
    hostUserData = '',
    designHome = '',
    homeDir = process.env.HOME || os.homedir(),
    platform = process.platform,
    realpathSync,
  } = {},
) {
  if (!targetPath || typeof targetPath !== 'string') return false;
  if (isInstalledPluginPath(targetPath, { pluginRoot, hostUserData, designHome, realpathSync, platform })) {
    return true;
  }

  const normalized = path.resolve(targetPath);
  const realTarget = safeRealPath(normalized, realpathSync);
  const candidates = [normalized, realTarget].filter(Boolean);
  const resolvedHome = homeDir ? path.resolve(homeDir) : '';
  const realHome = resolvedHome ? safeRealPath(resolvedHome, realpathSync) : '';

  // 精确匹配集：只拦截根目录自身（不拦截 /var/folders 或 /tmp/workspace 等子沙盒）
  const exactForbidden = new Set(
    [
      '/',
      '/Applications',
      '/var',
      '/private/var',
      '/tmp',
      '/private/tmp',
      resolvedHome,
      realHome,
    ]
      .filter(Boolean)
      .map((p) => normalizeForCompare(p, platform)),
  );

  for (const cand of candidates) {
    const cmp = normalizeForCompare(cand, platform);
    if (exactForbidden.has(cmp)) return true;
    if (WIN_DRIVE_ROOT_RE.test(cand)) return true;
    if (WIN_WINDOWS_DIR_RE.test(cand)) return true;
  }

  // 前缀子树匹配集：拦截系统关键目录与敏感凭证目录及其全部子目录
  const prefixForbidden = [
    '/System',
    '/etc',
    '/private/etc',
    '/usr',
    '/bin',
    '/sbin',
    '/var/root',
    '/private/var/root',
    resolvedHome ? path.join(resolvedHome, '.ssh') : '',
    resolvedHome ? path.join(resolvedHome, '.aws') : '',
    resolvedHome ? path.join(resolvedHome, '.gnupg') : '',
    realHome ? path.join(realHome, '.ssh') : '',
    realHome ? path.join(realHome, '.aws') : '',
    realHome ? path.join(realHome, '.gnupg') : '',
  ].filter(Boolean);

  for (const base of prefixForbidden) {
    for (const cand of candidates) {
      if (isSameOrInside(cand, base, platform)) return true;
    }
  }

  return false;
}

export function validateWorkspacePath(rawInput, options = {}) {
  const lang = options.lang === 'en' ? 'en' : 'zh';
  const raw = typeof rawInput === 'string' ? rawInput.trim() : '';
  if (!raw || raw.includes('\0')) {
    return {
      ok: false,
      code: 'NO_WORKSPACE',
      reason: 'NO_WORKSPACE',
      workspaceRoot: '',
      realWorkspaceRoot: '',
      workspaceName: '',
      message: formatWorkspaceError('NO_WORKSPACE', {}, lang),
    };
  }

  if (options.isRemote === true || (options.kind && options.kind !== 'local') || isRemoteWorkspaceUri(raw)) {
    return {
      ok: false,
      code: 'REMOTE_OR_UNMOUNTED',
      reason: 'REMOTE_OR_UNMOUNTED',
      path: raw,
      workspaceRoot: '',
      realWorkspaceRoot: '',
      workspaceName: '',
      message: formatWorkspaceError('REMOTE_OR_UNMOUNTED', { path: raw }, lang),
    };
  }

  let localPath = raw;
  if (/^file:\/\//i.test(raw)) {
    try {
      localPath = fileURLToPath(raw);
    } catch {
      return {
        ok: false,
        code: 'REMOTE_OR_UNMOUNTED',
        reason: 'REMOTE_OR_UNMOUNTED',
        path: raw,
        workspaceRoot: '',
        realWorkspaceRoot: '',
        workspaceName: '',
        message: formatWorkspaceError('REMOTE_OR_UNMOUNTED', { path: raw }, lang),
      };
    }
  }

  if (!path.isAbsolute(localPath)) {
    return {
      ok: false,
      code: 'REMOTE_OR_UNMOUNTED',
      reason: 'REMOTE_OR_UNMOUNTED',
      path: localPath,
      workspaceRoot: '',
      realWorkspaceRoot: '',
      workspaceName: '',
      message: formatWorkspaceError('REMOTE_OR_UNMOUNTED', { path: localPath }, lang),
    };
  }

  const normalized = path.resolve(localPath);
  const fsImpl = options.fsImpl || fs;
  let realRoot = normalized;
  try {
    if (!fsImpl.existsSync(normalized) || !fsImpl.statSync(normalized).isDirectory()) {
      return {
        ok: false,
        code: 'REMOTE_OR_UNMOUNTED',
        reason: 'REMOTE_OR_UNMOUNTED',
        path: normalized,
        workspaceRoot: '',
        realWorkspaceRoot: '',
        workspaceName: '',
        message: formatWorkspaceError('REMOTE_OR_UNMOUNTED', { path: normalized }, lang),
      };
    }
    realRoot = resolveRealPath(normalized, options.realpathSync || fsImpl.realpathSync?.native || fsImpl.realpathSync);
    if (!fsImpl.statSync(realRoot).isDirectory()) {
      return {
        ok: false,
        code: 'REMOTE_OR_UNMOUNTED',
        reason: 'REMOTE_OR_UNMOUNTED',
        path: normalized,
        workspaceRoot: '',
        realWorkspaceRoot: '',
        workspaceName: '',
        message: formatWorkspaceError('REMOTE_OR_UNMOUNTED', { path: normalized }, lang),
      };
    }
  } catch {
    return {
      ok: false,
      code: 'REMOTE_OR_UNMOUNTED',
      reason: 'REMOTE_OR_UNMOUNTED',
      path: normalized,
      workspaceRoot: '',
      realWorkspaceRoot: '',
      workspaceName: '',
      message: formatWorkspaceError('REMOTE_OR_UNMOUNTED', { path: normalized }, lang),
    };
  }

  if (isForbiddenWorkspacePath(normalized, options) || isForbiddenWorkspacePath(realRoot, options)) {
    return {
      ok: false,
      code: 'FORBIDDEN_WORKSPACE_PATH',
      reason: 'FORBIDDEN_WORKSPACE_PATH',
      path: realRoot,
      workspaceRoot: '',
      realWorkspaceRoot: '',
      workspaceName: '',
      message: formatWorkspaceError('FORBIDDEN_WORKSPACE_PATH', { path: realRoot }, lang),
    };
  }

  return {
    ok: true,
    code: '',
    reason: '',
    workspaceRoot: normalized,
    realWorkspaceRoot: realRoot,
    workspaceName: path.basename(normalized) || normalized,
  };
}

export function readProfileActiveWorkspace(profileDbPath, execFileSyncFn = execFileSync) {
  if (!profileDbPath) return null;
  try {
    const out = execFileSyncFn('sqlite3', [
      profileDbPath,
      "SELECT payload FROM profile_state_documents WHERE domain='workspaceSession'",
    ], { timeout: 3000, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
    const parsed = JSON.parse(String(out || '').trim());
    const active = parseActiveWorktreeId(parsed?.activeWorktreeId || '');
    if (!active.rawPath) return null;
    return active;
  } catch {
    return null;
  }
}

export function focusedFromHostContext(ctx, workspaces) {
  if (!ctx || !Array.isArray(workspaces)) return null;
  const branch = String(ctx.branch || '');
  const name = String(ctx.displayName || '');
  if (!branch && !name) return null;
  const normalizeBranch = (b) => String(b || '').replace(/^refs\/heads\//, '');
  const candidates = workspaces.filter((w) =>
    normalizeBranch(w.branch) === normalizeBranch(branch) && String(w.name || '') === name);
  return candidates.length === 1 ? candidates[0] : null;
}

export async function resolveOrcaWorkspace({
  listWorkspaces,
  readContext,
  queryWorktreePs,
  profileDbPath = '',
  terminalWorkspaceMap = null,
  live = false,
  validateOptions = {},
  execFileSyncFn = execFileSync,
} = {}) {
  const [listedRaw, ctx] = await Promise.all([
    Promise.resolve().then(() => (typeof listWorkspaces === 'function' ? listWorkspaces() : [])).catch(() => []),
    Promise.resolve().then(() => (typeof readContext === 'function' ? readContext() : null)).catch(() => null),
  ]);
  const openedWorkspaces = Array.isArray(listedRaw) ? listedRaw : (listedRaw?.workspaces || []);

  const accept = (rawPath, meta = {}, source = '') => {
    const res = validateWorkspacePath(rawPath, {
      ...validateOptions,
      kind: meta.kind,
      isRemote: meta.isRemote,
    });
    if (res.ok) {
      return {
        ...res,
        workspaceName: meta.name || meta.displayName || res.workspaceName,
        source,
        branch: meta.branch || null,
        id: meta.id || '',
      };
    }
    return { ...res, source };
  };

  // L1: live 模式下先用 readContext 实时焦点校核已打开本机工作区，避免旧的远程 Profile DB 误拦截刚切回的本地工作区
  const fromProfile = readProfileActiveWorkspace(profileDbPath, execFileSyncFn);
  if (openedWorkspaces.length > 0) {
    if (live && ctx) {
      const wHost = focusedFromHostContext(ctx, openedWorkspaces);
      if (wHost?.path) {
        return accept(wHost.path, wHost, 'L1-host-context');
      }
    }
    if (fromProfile?.isRemote) {
      return accept(fromProfile.rawPath, { isRemote: true }, 'L1-profile-db');
    }
    if (fromProfile?.rawPath) {
      const known = openedWorkspaces.find((w) => w.path === fromProfile.rawPath);
      if (known) {
        return accept(known.path, known, 'L1-profile-db');
      }
    }
  } else if (fromProfile?.isRemote) {
    return accept(fromProfile.rawPath, { isRemote: true }, 'L1-profile-db');
  } else if (fromProfile?.rawPath) {
    return accept(fromProfile.rawPath, {}, 'L1-profile-db');
  }

  // L2: Agent 状态事件桥（terminals 唯一映射 workspaceId）
  if (ctx && terminalWorkspaceMap && Array.isArray(ctx.terminals)) {
    const ids = new Set();
    for (const t of ctx.terminals) {
      const mapped = terminalWorkspaceMap.get(t?.id);
      if (mapped) ids.add(String(mapped));
    }
    if (ids.size === 1) {
      const targetId = [...ids][0];
      const parsedId = parseActiveWorktreeId(targetId);
      const hit = openedWorkspaces.find((w) =>
        w.id === targetId || (parsedId.rawPath && w.path === parsedId.rawPath));
      if (hit) {
        return accept(hit.path, hit, 'L2-agent-bridge');
      }
    }
  }

  // L3: readContext branch + displayName 唯一匹配（live 模式补充单次 worktree ps）
  if (ctx) {
    const byCtx = focusedFromHostContext(ctx, openedWorkspaces);
    if (byCtx?.path) {
      return accept(byCtx.path, byCtx, 'L3-host-context');
    }
  }
  if (live && typeof queryWorktreePs === 'function') {
    const worktrees = await Promise.resolve().then(() => queryWorktreePs()).catch(() => []);
    const list = Array.isArray(worktrees) ? worktrees : [];
    const active = list.find((w) => w?.isActive === true && w.path);
    const ranked = active || list
      .filter((w) => w?.path && Number.isFinite(Number(w.lastActivityAt)))
      .sort((a, b) => Number(b.lastActivityAt) - Number(a.lastActivityAt))[0];
    if (ranked?.path) {
      const known = openedWorkspaces.find((w) => w.path === ranked.path);
      if (known || openedWorkspaces.length === 0) {
        return accept(ranked.path, known || ranked, 'L3-worktree-ps');
      }
    }
  }

  // L4: 单打开工作区保底
  if (openedWorkspaces.length === 1 && openedWorkspaces[0]?.path) {
    return accept(openedWorkspaces[0].path, openedWorkspaces[0], 'L4-single-workspace');
  }

  return {
    ok: false,
    code: 'NO_WORKSPACE',
    reason: 'NO_WORKSPACE',
    workspaceRoot: '',
    realWorkspaceRoot: '',
    workspaceName: '',
    message: formatWorkspaceError('NO_WORKSPACE', {}, validateOptions.lang),
    source: 'none',
  };
}
