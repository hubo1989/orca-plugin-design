// Orca-Design · 轻量专栏元数据存储（MIT）
// 职责：按工作区哈希将专栏与期号索引原子落盘于 <ORCA_DESIGN_HOME>/columns/<wsHash24>.json，零侵入 .design/ 原作品目录
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const PENDING_TTL_MS = 24 * 60 * 60 * 1000;
const NAME_MAX = 80;
const DESC_MAX = 500;

function orcaConfigParent() {
  const home = process.env.HOME || os.homedir();
  if (process.platform === 'darwin') return path.join(home, 'Library', 'Application Support', 'orca');
  if (process.platform === 'win32') return path.join(process.env.APPDATA || path.join(home, 'AppData', 'Roaming'), 'orca');
  return path.join(process.env.XDG_CONFIG_HOME || path.join(home, '.config'), 'orca');
}

export function resolveDesignHome(designHome) {
  if (typeof designHome === 'string' && designHome.trim()) return designHome.trim();
  const envSet = process.env.ORCA_DESIGN_HOME?.trim() || process.env.DSH_HOME?.trim();
  if (envSet) return envSet;
  return path.join(orcaConfigParent(), 'orca-design');
}

export function columnsDir(designHome) {
  return path.join(resolveDesignHome(designHome), 'columns');
}

function canonicalWorkspaceRoot(workspaceRoot) {
  const raw = String(workspaceRoot || '').trim();
  if (!raw) return '';
  try {
    return fs.realpathSync(raw);
  } catch {
    return path.resolve(raw);
  }
}

export function workspaceHash(workspaceRoot) {
  const canonical = canonicalWorkspaceRoot(workspaceRoot);
  return crypto.createHash('sha256').update(canonical).digest('hex').slice(0, 24);
}

export function columnsFilePath(workspaceRoot, designHome) {
  return path.join(columnsDir(designHome), `${workspaceHash(workspaceRoot)}.json`);
}

function writeWholeAtomic(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.${Date.now()}.${Math.random().toString(36).slice(2, 8)}.tmp`;
  fs.writeFileSync(tmp, data, 'utf8');
  fs.renameSync(tmp, file);
}

function emptyStore(workspaceRoot) {
  return {
    v: 1,
    workspaceRoot: canonicalWorkspaceRoot(workspaceRoot),
    updatedAt: new Date().toISOString(),
    columns: [],
    memberships: {},
    pendingFolders: {},
  };
}

function normalizeColumnEntry(c) {
  if (!c || typeof c !== 'object' || typeof c.seriesId !== 'string' || !c.seriesId) return null;
  const name = String(c.name || '').replace(/\s+/g, ' ').trim().slice(0, NAME_MAX);
  if (!name) return null;
  const now = new Date().toISOString();
  return {
    seriesId: c.seriesId,
    name,
    description: String(c.description || '').trim().slice(0, DESC_MAX),
    defaultType: typeof c.defaultType === 'string' ? c.defaultType.trim().slice(0, 64) : '',
    pinned: c.pinned === true,
    sortOrder: c.sortOrder === 'asc' ? 'asc' : 'desc',
    createdAt: typeof c.createdAt === 'string' && c.createdAt ? c.createdAt : now,
    updatedAt: typeof c.updatedAt === 'string' && c.updatedAt ? c.updatedAt : now,
  };
}

function normalizeStore(raw, workspaceRoot) {
  const base = emptyStore(workspaceRoot);
  if (!raw || typeof raw !== 'object' || raw.v !== 1) return base;
  const cols = Array.isArray(raw.columns) ? raw.columns.map(normalizeColumnEntry).filter(Boolean) : [];
  const colIds = new Set(cols.map((c) => c.seriesId));

  const memberships = {};
  if (raw.memberships && typeof raw.memberships === 'object' && !Array.isArray(raw.memberships)) {
    for (const [k, v] of Object.entries(raw.memberships)) {
      if (!k || !v || typeof v !== 'object' || !colIds.has(v.seriesId)) continue;
      const issueNumber = Number.isInteger(v.issueNumber) && v.issueNumber >= 1 ? v.issueNumber : 1;
      memberships[path.resolve(k)] = {
        artifactId: typeof v.artifactId === 'string' ? v.artifactId : '',
        seriesId: v.seriesId,
        issueNumber,
        addedAt: typeof v.addedAt === 'string' && v.addedAt ? v.addedAt : new Date().toISOString(),
      };
    }
  }

  const pendingFolders = {};
  if (raw.pendingFolders && typeof raw.pendingFolders === 'object' && !Array.isArray(raw.pendingFolders)) {
    for (const [k, v] of Object.entries(raw.pendingFolders)) {
      if (!k || !v || typeof v !== 'object' || !colIds.has(v.seriesId)) continue;
      const issueNumber = Number.isInteger(v.issueNumber) && v.issueNumber >= 1 ? v.issueNumber : 1;
      pendingFolders[path.resolve(k)] = {
        seriesId: v.seriesId,
        issueNumber,
        createdAt: typeof v.createdAt === 'string' && v.createdAt ? v.createdAt : new Date().toISOString(),
      };
    }
  }

  return {
    v: 1,
    workspaceRoot: typeof raw.workspaceRoot === 'string' && raw.workspaceRoot ? raw.workspaceRoot : base.workspaceRoot,
    updatedAt: typeof raw.updatedAt === 'string' && raw.updatedAt ? raw.updatedAt : base.updatedAt,
    columns: cols,
    memberships,
    pendingFolders,
  };
}

export function readColumnsStore(workspaceRoot, designHome) {
  if (!workspaceRoot) return emptyStore('');
  const file = columnsFilePath(workspaceRoot, designHome);
  try {
    const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
    return normalizeStore(raw, workspaceRoot);
  } catch {
    return emptyStore(workspaceRoot);
  }
}

export function writeColumnsStore(workspaceRoot, store, designHome) {
  if (!workspaceRoot) throw new Error('workspaceRoot is required');
  const next = normalizeStore({ ...store, updatedAt: new Date().toISOString() }, workspaceRoot);
  writeWholeAtomic(columnsFilePath(workspaceRoot, designHome), `${JSON.stringify(next, null, 2)}\n`);
  return next;
}

function findRootKey(mapObj, root) {
  const resolved = path.resolve(String(root || ''));
  if (!resolved) return '';
  if (Object.hasOwn(mapObj, resolved)) return resolved;
  try {
    const real = fs.realpathSync(resolved);
    if (Object.hasOwn(mapObj, real)) return real;
    for (const key of Object.keys(mapObj)) {
      try {
        if (fs.realpathSync(key) === real) return key;
      } catch { /* ignore missing */ }
    }
  } catch { /* ignore missing */ }
  return '';
}

function isPendingExpired(entry, nowMs = Date.now()) {
  const ts = Date.parse(entry?.createdAt || '');
  return !Number.isFinite(ts) || (nowMs - ts) > PENDING_TTL_MS;
}

function computeNextIssueNumber(store, seriesId) {
  let maxIssue = 0;
  for (const m of Object.values(store.memberships)) {
    if (m.seriesId === seriesId && Number.isInteger(m.issueNumber) && m.issueNumber > maxIssue) {
      maxIssue = m.issueNumber;
    }
  }
  const nowMs = Date.now();
  for (const p of Object.values(store.pendingFolders)) {
    if (p.seriesId === seriesId && !isPendingExpired(p, nowMs) && Number.isInteger(p.issueNumber) && p.issueNumber > maxIssue) {
      maxIssue = p.issueNumber;
    }
  }
  return maxIssue + 1;
}

export function createColumn(workspaceRoot, input = {}, designHome) {
  if (!workspaceRoot) return { ok: false, error: '当前工作区未识别' };
  const name = String(input.name || '').replace(/\s+/g, ' ').trim().slice(0, NAME_MAX);
  if (!name) return { ok: false, error: '专栏名称不能为空' };

  const store = readColumnsStore(workspaceRoot, designHome);
  const now = new Date().toISOString();
  const seriesId = `col_${crypto.randomBytes(4).toString('hex')}`;
  const column = {
    seriesId,
    name,
    description: String(input.description || '').trim().slice(0, DESC_MAX),
    defaultType: typeof input.defaultType === 'string' ? input.defaultType.trim().slice(0, 64) : '',
    pinned: input.pinned === true,
    sortOrder: input.sortOrder === 'asc' ? 'asc' : 'desc',
    createdAt: now,
    updatedAt: now,
  };
  store.columns.push(column);
  const saved = writeColumnsStore(workspaceRoot, store, designHome);
  return { ok: true, column, store: saved };
}

export function updateColumn(workspaceRoot, seriesId, patch = {}, designHome) {
  if (!workspaceRoot) return { ok: false, error: '当前工作区未识别' };
  const store = readColumnsStore(workspaceRoot, designHome);
  const col = store.columns.find((c) => c.seriesId === seriesId);
  if (!col) return { ok: false, error: '未找到目标专栏' };

  if (patch.name !== undefined) {
    const cleanName = String(patch.name).replace(/\s+/g, ' ').trim().slice(0, NAME_MAX);
    if (!cleanName) return { ok: false, error: '专栏名称不能为空' };
    col.name = cleanName;
  }
  if (patch.description !== undefined) {
    col.description = String(patch.description || '').trim().slice(0, DESC_MAX);
  }
  if (patch.defaultType !== undefined) {
    col.defaultType = String(patch.defaultType || '').trim().slice(0, 64);
  }
  if (typeof patch.pinned === 'boolean') {
    col.pinned = patch.pinned;
  }
  if (patch.sortOrder === 'asc' || patch.sortOrder === 'desc') {
    col.sortOrder = patch.sortOrder;
  }
  col.updatedAt = new Date().toISOString();

  const saved = writeColumnsStore(workspaceRoot, store, designHome);
  return { ok: true, column: col, store: saved };
}

export function dissolveColumn(workspaceRoot, seriesId, designHome) {
  if (!workspaceRoot) return { ok: false, error: '当前工作区未识别' };
  const store = readColumnsStore(workspaceRoot, designHome);
  const idx = store.columns.findIndex((c) => c.seriesId === seriesId);
  if (idx === -1) return { ok: false, error: '未找到目标专栏' };

  store.columns.splice(idx, 1);
  let removedMemberships = 0;
  for (const [root, m] of Object.entries(store.memberships)) {
    if (m.seriesId === seriesId) {
      delete store.memberships[root];
      removedMemberships++;
    }
  }
  for (const [folder, p] of Object.entries(store.pendingFolders)) {
    if (p.seriesId === seriesId) delete store.pendingFolders[folder];
  }

  const saved = writeColumnsStore(workspaceRoot, store, designHome);
  return { ok: true, removedMemberships, store: saved };
}

export function assignToColumn(workspaceRoot, { root, seriesId, issueNumber, artifactId } = {}, designHome) {
  if (!workspaceRoot) return { ok: false, error: '当前工作区未识别' };
  const resolvedRoot = path.resolve(String(root || ''));
  if (!resolvedRoot) return { ok: false, error: '缺少作品路径' };

  const store = readColumnsStore(workspaceRoot, designHome);
  const col = store.columns.find((c) => c.seriesId === seriesId);
  if (!col) return { ok: false, error: '未找到目标专栏' };

  const existingKey = findRootKey(store.memberships, resolvedRoot);
  if (existingKey && existingKey !== resolvedRoot) delete store.memberships[existingKey];

  const parsedNum = Number(issueNumber);
  const finalNum = Number.isInteger(parsedNum) && parsedNum >= 1
    ? parsedNum
    : computeNextIssueNumber(store, seriesId);

  const now = new Date().toISOString();
  const prev = existingKey ? store.memberships[existingKey] : null;
  const membership = {
    artifactId: typeof artifactId === 'string' && artifactId ? artifactId : (prev?.artifactId || ''),
    seriesId,
    issueNumber: finalNum,
    addedAt: prev?.addedAt || now,
  };
  store.memberships[resolvedRoot] = membership;
  col.updatedAt = now;

  const saved = writeColumnsStore(workspaceRoot, store, designHome);
  return { ok: true, membership, store: saved };
}

export function removeFromColumn(workspaceRoot, root, designHome) {
  if (!workspaceRoot || !root) return { ok: false, removed: null };
  const store = readColumnsStore(workspaceRoot, designHome);
  const key = findRootKey(store.memberships, root);
  if (!key) return { ok: true, removed: null, store };
  const removed = store.memberships[key];
  delete store.memberships[key];
  const saved = writeColumnsStore(workspaceRoot, store, designHome);
  return { ok: true, removed, store: saved };
}

export function getMembership(workspaceRoot, root, designHome) {
  if (!workspaceRoot || !root) return null;
  const store = readColumnsStore(workspaceRoot, designHome);
  const key = findRootKey(store.memberships, root);
  return key ? store.memberships[key] : null;
}

export function syncRename(workspaceRoot, oldRoot, newRoot, designHome) {
  if (!workspaceRoot || !oldRoot || !newRoot) return { ok: false, moved: false };
  const resolvedOld = path.resolve(oldRoot);
  const resolvedNew = path.resolve(newRoot);
  if (resolvedOld === resolvedNew) return { ok: true, moved: false };

  const store = readColumnsStore(workspaceRoot, designHome);
  let moved = false;
  let membership = null;

  const mKey = findRootKey(store.memberships, resolvedOld);
  if (mKey) {
    membership = store.memberships[mKey];
    delete store.memberships[mKey];
    store.memberships[resolvedNew] = membership;
    moved = true;
  }

  const pKey = findRootKey(store.pendingFolders, resolvedOld);
  if (pKey) {
    const pending = store.pendingFolders[pKey];
    delete store.pendingFolders[pKey];
    store.pendingFolders[resolvedNew] = pending;
    moved = true;
  }

  if (moved) {
    writeColumnsStore(workspaceRoot, store, designHome);
  }
  return { ok: true, moved, membership };
}

export function slugifyColumnName(name, seriesId) {
  const ascii = String(name || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 32);
  return ascii || String(seriesId || 'series').replace(/[^a-z0-9_-]/gi, '-');
}

export function nextIssueInfo(workspaceRoot, seriesId, designHome) {
  const store = readColumnsStore(workspaceRoot, designHome);
  const col = store.columns.find((c) => c.seriesId === seriesId);
  if (!col) return { ok: false, error: '未找到目标专栏' };

  const nextNum = computeNextIssueNumber(store, seriesId);
  const slug = slugifyColumnName(col.name, col.seriesId);
  const pad2 = String(nextNum).padStart(2, '0');
  const designBase = path.join(path.resolve(workspaceRoot), '.design');
  let folderPath = path.join(designBase, `${slug}-${pad2}`);
  let suffix = 2;
  while (fs.existsSync(folderPath) || Object.hasOwn(store.pendingFolders, folderPath)) {
    folderPath = path.join(designBase, `${slug}-${pad2}-${suffix++}`);
  }
  return { ok: true, column: col, issueNumber: nextNum, folderPath, seriesSlug: slug };
}

export function registerPendingFolder(workspaceRoot, { folderPath, seriesId, issueNumber } = {}, designHome) {
  if (!workspaceRoot || !folderPath || !seriesId) return { ok: false, error: '参数不完整' };
  const store = readColumnsStore(workspaceRoot, designHome);
  const col = store.columns.find((c) => c.seriesId === seriesId);
  if (!col) return { ok: false, error: '未找到目标专栏' };

  const nowMs = Date.now();
  for (const [k, v] of Object.entries(store.pendingFolders)) {
    if (isPendingExpired(v, nowMs)) delete store.pendingFolders[k];
  }

  const resolvedFolder = path.resolve(folderPath);
  const finalNum = Number.isInteger(Number(issueNumber)) && Number(issueNumber) >= 1
    ? Number(issueNumber)
    : computeNextIssueNumber(store, seriesId);

  store.pendingFolders[resolvedFolder] = {
    seriesId,
    issueNumber: finalNum,
    createdAt: new Date(nowMs).toISOString(),
  };
  const saved = writeColumnsStore(workspaceRoot, store, designHome);
  return { ok: true, folderPath: resolvedFolder, issueNumber: finalNum, store: saved };
}

export function resolvePendingFolders(workspaceRoot, discoveredItems = [], designHome) {
  if (!workspaceRoot) return { changed: false, promoted: [], store: emptyStore('') };
  const store = readColumnsStore(workspaceRoot, designHome);
  const pendingEntries = Object.entries(store.pendingFolders);
  if (!pendingEntries.length) return { changed: false, promoted: [], store };

  const colMap = new Map(store.columns.map((c) => [c.seriesId, c]));
  const itemByRoot = new Map();
  for (const it of discoveredItems) {
    const r = typeof it === 'string' ? it : it?.root;
    if (!r) continue;
    const resolved = path.resolve(r);
    itemByRoot.set(resolved, typeof it === 'string' ? { root: resolved } : it);
    try {
      itemByRoot.set(fs.realpathSync(resolved), typeof it === 'string' ? { root: resolved } : it);
    } catch { /* ignore */ }
  }

  let changed = false;
  const promoted = [];
  const nowMs = Date.now();
  const nowIso = new Date(nowMs).toISOString();

  for (const [folderPath, pending] of pendingEntries) {
    const col = colMap.get(pending.seriesId);
    if (!col || isPendingExpired(pending, nowMs)) {
      delete store.pendingFolders[folderPath];
      changed = true;
      continue;
    }
    let matchedItem = itemByRoot.get(folderPath);
    if (!matchedItem) {
      try {
        matchedItem = itemByRoot.get(fs.realpathSync(folderPath));
      } catch { /* ignore */ }
    }
    if (matchedItem) {
      const targetRoot = path.resolve(matchedItem.root || folderPath);
      if (!Object.hasOwn(store.memberships, targetRoot)) {
        store.memberships[targetRoot] = {
          artifactId: matchedItem.id || '',
          seriesId: pending.seriesId,
          issueNumber: pending.issueNumber,
          addedAt: nowIso,
        };
        col.updatedAt = nowIso;
        promoted.push({ root: targetRoot, seriesId: pending.seriesId, issueNumber: pending.issueNumber });
      }
      delete store.pendingFolders[folderPath];
      changed = true;
    }
  }

  const finalStore = changed ? writeColumnsStore(workspaceRoot, store, designHome) : store;
  return { changed, promoted, store: finalStore };
}

export function removeMembershipOnTrash(workspaceRoot, root, designHome) {
  if (!workspaceRoot || !root) return null;
  const store = readColumnsStore(workspaceRoot, designHome);
  const key = findRootKey(store.memberships, root);
  if (!key) return null;
  const membership = store.memberships[key];
  delete store.memberships[key];
  writeColumnsStore(workspaceRoot, store, designHome);
  return { ...membership, workspaceRoot };
}

export function restoreMembershipFromTrash(workspaceRoot, root, columnMembership, artifactId = '', designHome) {
  if (!workspaceRoot || !root || !columnMembership?.seriesId) return { restored: false };
  const store = readColumnsStore(workspaceRoot, designHome);
  const col = store.columns.find((c) => c.seriesId === columnMembership.seriesId);
  if (!col) return { restored: false, reason: 'column_missing' };

  const resolvedRoot = path.resolve(root);
  const issueNumber = Number.isInteger(columnMembership.issueNumber) && columnMembership.issueNumber >= 1
    ? columnMembership.issueNumber
    : computeNextIssueNumber(store, col.seriesId);

  const now = new Date().toISOString();
  store.memberships[resolvedRoot] = {
    artifactId: artifactId || columnMembership.artifactId || '',
    seriesId: col.seriesId,
    issueNumber,
    addedAt: columnMembership.addedAt || now,
  };
  col.updatedAt = now;
  writeColumnsStore(workspaceRoot, store, designHome);
  return { restored: true, membership: store.memberships[resolvedRoot] };
}
