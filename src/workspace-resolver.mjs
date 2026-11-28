// 共享 Orca CLI 路径解析、Gallery Build ID 计算与实时工作区解析器
import { execFileSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const REMOTE_URI_RE = /^(?:ssh|vscode-remote|orca-remote|remote):\/\//i;

export function isRemoteIdentifier(raw) {
  const s = String(raw || '').trim();
  if (!s) return false;
  if (REMOTE_URI_RE.test(s)) return true;
  const parts = s.split('::');
  return parts.length >= 3;
}

export function resolveOrcaBin(env = process.env, proc = process, existsSyncFn = fs.existsSync) {
  const fromEnv = typeof env?.ORCA_CLI_COMMAND === 'string' ? env.ORCA_CLI_COMMAND.trim() : '';
  if (fromEnv) return fromEnv;

  const execPath = String(proc?.execPath || '');
  const appIdx = execPath.indexOf('.app/Contents/');
  if (appIdx !== -1) {
    const appBase = execPath.slice(0, appIdx + '.app/Contents'.length);
    const macCandidate = path.join(appBase, 'Resources', 'bin', 'orca');
    if (existsSyncFn(macCandidate)) return macCandidate;
  }

  if (proc?.resourcesPath) {
    const binName = proc.platform === 'win32'
      ? 'orca.cmd'
      : (proc.platform === 'linux' ? 'orca-ide' : 'orca');
    const resCandidate = path.join(proc.resourcesPath, 'bin', binName);
    if (existsSyncFn(resCandidate)) return resCandidate;
  }

  if (proc?.platform === 'darwin') {
    const defaultMac = '/Applications/Orca.app/Contents/Resources/bin/orca';
    if (existsSyncFn(defaultMac)) return defaultMac;
  }

  return 'orca';
}

export function computeGalleryBuildId(pluginRoot) {
  let version = '0.0.0';
  try {
    const manifest = JSON.parse(fs.readFileSync(path.join(pluginRoot, 'orca-plugin.json'), 'utf8'));
    if (manifest?.version) version = String(manifest.version);
  } catch { /* fallback */ }

  let serverBytes = Buffer.alloc(0);
  try {
    serverBytes = fs.readFileSync(path.join(pluginRoot, 'src', 'gallery-server.mjs'));
  } catch { /* fallback */ }

  const hash12 = crypto.createHash('sha256').update(serverBytes).digest('hex').slice(0, 12);
  return `${version}-${hash12}`;
}

export function parseProfileWorkspace(profileDbPath, execFileSyncFn = execFileSync, existsSyncFn = fs.existsSync) {
  if (!profileDbPath || !existsSyncFn(profileDbPath)) return null;

  const queryDoc = (domain) => {
    const sql = `SELECT payload FROM profile_state_documents WHERE domain='${domain}'`;
    const out = execFileSyncFn('sqlite3', [profileDbPath, sql], {
      timeout: 3000,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    const text = String(out || '').trim();
    return text ? JSON.parse(text) : null;
  };

  let ws = null;
  try {
    ws = queryDoc('workspaceSession');
  } catch {
    return null;
  }
  if (!ws || typeof ws !== 'object') return null;

  const execHost = String(ws.activeWorkspaceExecutionHostId || '').trim();
  const rawKey = String(ws.activeWorkspaceKey || '').trim();
  const rawId = String(ws.activeWorktreeId || '').trim();

  if (execHost && execHost !== 'local') {
    return { isRemote: true, rawPath: rawId || rawKey };
  }

  const folderKey = rawKey.startsWith('folder:') ? rawKey : (rawId.startsWith('folder:') ? rawId : '');
  if (folderKey) {
    const folderId = folderKey.slice('folder:'.length);
    let folders = [];
    try {
      const parsed = queryDoc('folderWorkspaces');
      if (Array.isArray(parsed)) folders = parsed;
    } catch { /* ignore */ }
    const hit = folders.find((f) => f && String(f.id || '') === folderId);
    if (hit) {
      if (hit.connectionId) {
        return { isRemote: true, rawPath: String(hit.folderPath || folderKey), selector: folderKey };
      }
      if (hit.folderPath) {
        return {
          isRemote: false,
          path: String(hit.folderPath),
          name: String(hit.name || path.basename(String(hit.folderPath))),
          selector: folderKey,
        };
      }
    }
    return null;
  }

  const candidateId = rawId || (rawKey.startsWith('worktree:') ? rawKey.slice('worktree:'.length) : '');
  if (!candidateId) return null;
  if (REMOTE_URI_RE.test(candidateId)) {
    return { isRemote: true, rawPath: candidateId };
  }

  const parts = candidateId.split('::');
  if (parts.length >= 3) {
    return { isRemote: true, rawPath: candidateId };
  }
  if (parts.length === 2 && parts[1]) {
    const localPath = parts[1];
    return {
      isRemote: false,
      path: localPath,
      name: path.basename(localPath),
      selector: `id:${candidateId}`,
    };
  }
  return null;
}

function isLocalDir(p, statSyncFn = fs.statSync) {
  if (typeof p !== 'string' || !path.isAbsolute(p)) return false;
  try {
    return statSyncFn(p).isDirectory();
  } catch {
    return false;
  }
}

export async function resolveActiveWorkspace({
  runOrcaCli,
  listWorkspaces,
  readContext,
  profileDbPath,
  execFileSyncFn = execFileSync,
  existsSyncFn = fs.existsSync,
  statSyncFn = fs.statSync,
  isInstalledPluginPathFn = () => false,
} = {}) {
  const validatePath = (p, name, selector, worktreeId = '') => {
    if (!p || isRemoteIdentifier(p)) {
      return {
        ok: false,
        code: 'REMOTE_WORKSPACE',
        error: '远程工作区暂不支持本地项目库，请切换到本机工作区',
      };
    }
    if (!isLocalDir(p, statSyncFn)) {
      return {
        ok: false,
        code: 'REMOTE_WORKSPACE',
        error: `远程/本机不可见的工作区暂不支持项目库（仅支持本机工作区）：${p}`,
      };
    }
    if (isInstalledPluginPathFn(p)) {
      return {
        ok: false,
        code: 'PLUGIN_INSTALL_DIR',
        error: '当前工作区是 Orca 插件安装路径，请切换到其他工作区使用项目库',
      };
    }
    return {
      ok: true,
      workspaceRoot: p,
      workspaceName: name || path.basename(p),
      selector: selector || `path:${p}`,
      worktreeId,
    };
  };

  // 优先级 1：orca worktree ps --json
  if (typeof runOrcaCli === 'function') {
    try {
      const cliRes = await runOrcaCli(['worktree', 'ps', '--json']);
      if (cliRes && !cliRes.err && cliRes.stdout) {
        const parsed = JSON.parse(cliRes.stdout);
        const worktrees = parsed?.result?.worktrees;
        if (Array.isArray(worktrees)) {
          const active = worktrees.find((w) => w && w.isActive === true);
          if (active) {
            if ((active.hostId && active.hostId !== 'local') || isRemoteIdentifier(active.worktreeId || active.path)) {
              return {
                ok: false,
                code: 'REMOTE_WORKSPACE',
                error: '远程工作区暂不支持本地项目库，请切换到本机工作区',
              };
            }
            const selector = active.address?.worktree
              || (active.worktreeId?.startsWith('folder:') ? active.worktreeId : '')
              || (active.worktreeId ? `id:${active.worktreeId}` : '')
              || (active.path ? `path:${active.path}` : '');
            const displayName = active.workspaceKind === 'folder-workspace'
              ? (active.displayName || active.repo || path.basename(String(active.path || '')))
              : (active.displayName && active.displayName !== 'main'
                ? active.displayName
                : (active.repo || active.displayName || path.basename(String(active.path || ''))));
            return validatePath(active.path, displayName, selector, String(active.worktreeId || ''));
          }
        }
      }
    } catch { /* fall through to secondary sources */ }
  }

  // 优先级 2：workspace.list + readContext + profile-state.db
  let openedWorkspaces = [];
  if (typeof listWorkspaces === 'function') {
    try {
      const listed = await listWorkspaces();
      openedWorkspaces = listed?.workspaces || listed?.result?.workspaces || [];
    } catch {
      openedWorkspaces = [];
    }
  }

  const profileHit = parseProfileWorkspace(profileDbPath, execFileSyncFn, existsSyncFn);
  if (profileHit?.isRemote) {
    return {
      ok: false,
      code: 'REMOTE_WORKSPACE',
      error: '远程工作区暂不支持本地项目库，请切换到本机工作区',
    };
  }
  if (profileHit?.path) {
    const known = openedWorkspaces.find((w) => w && w.path === profileHit.path);
    return validatePath(
      profileHit.path,
      known?.name || profileHit.name || path.basename(profileHit.path),
      profileHit.selector || (known?.id ? `id:${known.id}` : `path:${profileHit.path}`),
    );
  }

  if (typeof readContext === 'function') {
    try {
      const ctx = await readContext();
      if (ctx) {
        if (ctx.workspaceId && isRemoteIdentifier(ctx.workspaceId)) {
          return {
            ok: false,
            code: 'REMOTE_WORKSPACE',
            error: '远程工作区暂不支持本地项目库，请切换到本机工作区',
          };
        }
        let hit = null;
        if (ctx.workspaceId) {
          const rawId = String(ctx.workspaceId);
          const parts = rawId.split('::');
          const pathPart = parts.length === 2 ? parts[1] : null;
          hit = openedWorkspaces.find((w) => w.id === rawId || (pathPart && w.path === pathPart)) || null;
        }
        if (!hit && (ctx.branch || ctx.displayName)) {
          const candidates = openedWorkspaces.filter(
            (w) => w.branch === ctx.branch && w.name === ctx.displayName,
          );
          if (candidates.length === 1) hit = candidates[0];
        }
        if (hit) {
          return validatePath(
            hit.path,
            hit.name || path.basename(String(hit.path || '')),
            hit.id ? `id:${hit.id}` : `path:${hit.path}`,
          );
        }
      }
    } catch { /* ignore */ }
  }

  return {
    ok: false,
    code: 'NO_WORKSPACE',
    error: '当前未检测到已打开的本机工作区，请先在 Orca 中打开一个本地项目',
  };
}
