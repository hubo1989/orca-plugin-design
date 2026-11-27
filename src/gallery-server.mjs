#!/usr/bin/env node
// Lakala-Design-Plugin · 独立项目库服务（detached，固定 3480）
import { execFile, execFileSync } from 'node:child_process';
import http from 'node:http';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { guardPost, MAX_BODY_BYTES } from './post-guard.mjs';
import { buildGalleryHtml } from './gallery-ui.mjs';

import {
  SKILLS,
  SKILL_BY_ID,
  TITLES,
  TINTS,
  FOLDER,
  RECIPES,
  EDITOR_FILES,
  NOT_CONTENT,
  LAKALA_TOKENS,
  BUILTIN_EXAMPLES,
  BUILTIN_BY_ID,
  EXAMPLE_TEMPLATES,
  EXAMPLE_INDEX,
  resolveHostCli,
  resolveHostUserData,
  resolveHostRuntimeDefaults,
  resolveProfileDb,
  GALLERY_BUILD_ID,
} from './skills-meta.mjs';

import {
  resolveRealPath,
  safeRealPath,
  isInsideDir,
  isSameOrInside,
  validateWorkspacePath,
  readProfileActiveWorkspace,
  isForbiddenWorkspacePath,
  formatWorkspaceError,
} from './workspace-guard.mjs';

const __filename = fileURLToPath(import.meta.url);
const pluginRoot = path.dirname(path.dirname(__filename));
const HOST_USER_DATA = resolveHostUserData(pluginRoot);
const HOST_RUNTIME = resolveHostRuntimeDefaults(pluginRoot);
const APP_ID = process.env.ORCA_GALLERY_APP_ID?.trim() || HOST_RUNTIME.appId;
const STATE_FILE = process.env.ORCA_STATE_FILE || path.join(os.tmpdir(), HOST_RUNTIME.defaultStateFileName);
const BAOYU_SKILLS_DIR = path.join(pluginRoot, 'vendor', 'baoyu-design', 'skills');
const ORCA_BIN = resolveHostCli(pluginRoot);
const PORT = Number(process.env.ORCA_GALLERY_PORT || process.env.PORT) || HOST_RUNTIME.defaultPort;

const OFFICIAL_EXAMPLES = BUILTIN_EXAMPLES
  .filter((item) => Object.hasOwn(SKILL_BY_ID, item.skill))
  .map((item) => ({
    id: item.id,
    skill: item.skill,
    title: item.title,
    titleEn: item.titleEn,
    desc: item.desc,
    descEn: item.descEn,
    points: item.points,
    pointsEn: item.pointsEn,
    label: item.label || '',
    featured: Boolean(item.featured),
    html: item.html || '',
  }));

const DS_COMPONENT_NAMES = ['Cover', 'Button', 'Form', 'Card', 'Navigation'];
const DS_COMPONENTS = Object.fromEntries(
  DS_COMPONENT_NAMES
    .map((name) => {
      const raw = BUILTIN_BY_ID['claude-design-system']?.files?.[`project/components/${name}/preview.html`];
      if (!raw) return null;
      return [name, raw.replace(/^<!--\s*@dsCard[^>]*-->\s*\r?\n?/, '')];
    })
    .filter(Boolean),
);

const TEMPLATES_MAP = Object.fromEntries(Object.keys(EXAMPLE_TEMPLATES).map((id) => [id, true]));

const OPEN_TIMEOUT_MS = 30000;
const TITLE_MAX = 200;
const STAMP_MAX_ENTRIES = 20000;
const TRASH_ID = /^[0-9a-f]{24}-\d+$/;
const EPHEMERAL_TEST_RE = /(?:^|[\\/])(?:ps-gallery-(?:unit|http|smoke)-|orca-design-test-)/;

function hasCustomDesignHome() {
  return Boolean(process.env.ORCA_DESIGN_HOME?.trim() || process.env.DSH_HOME?.trim());
}

function dshHome() {
  const set = process.env.ORCA_DESIGN_HOME?.trim() || process.env.DSH_HOME?.trim();
  if (set) return set;
  return path.join(resolveHostUserData(pluginRoot), 'baoyu-design');
}

function artifactsDir() { return path.join(dshHome(), 'artifacts'); }
function trashDir() { return path.join(dshHome(), 'trash'); }
function dismissedDir() { return path.join(dshHome(), 'dismissed'); }
function thumbsDir() {
  const dir = path.join(dshHome(), 'thumbs');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}
const folderHash = (root) => crypto.createHash('sha256').update(root).digest('hex').slice(0, 24);
function recordFile(root) { return path.join(artifactsDir(), `${folderHash(root)}.json`); }
function thumbPath(root) { return path.join(thumbsDir(), `${folderHash(root)}.png`); }
function dismissedKeys(root) {
  const keys = new Set();
  if (typeof root === 'string' && root) {
    keys.add(folderHash(path.resolve(root)));
    const real = safeRealPath(root);
    if (real) keys.add(folderHash(real));
  }
  return [...keys];
}
function isDismissed(root) {
  return dismissedKeys(root).some((k) => fs.existsSync(path.join(dismissedDir(), `${k}.json`)));
}
function markDismissed(root, skill = '') {
  const canonical = safeRealPath(root) || path.resolve(String(root || ''));
  const file = path.join(dismissedDir(), `${folderHash(canonical)}.json`);
  writeWhole(file, `${JSON.stringify({ v: 1, root: canonical, rawRoot: root, skill, dismissedAt: new Date().toISOString() }, null, 2)}\n`);
}
function clearDismissed(root) {
  for (const k of dismissedKeys(root)) {
    try { fs.rmSync(path.join(dismissedDir(), `${k}.json`), { force: true }); } catch {}
  }
}

const ownedEditorRoots = new Map();

function artifactStatus(skill, root) {
  if (typeof root !== 'string' || !path.isAbsolute(root)) return { valid: false, reason: 'dir_missing' };
  try {
    if (!fs.statSync(root).isDirectory()) return { valid: false, reason: 'dir_missing' };
  } catch {
    return { valid: false, reason: 'dir_missing' };
  }
  const marker = SKILL_BY_ID[skill]?.marker;
  if (marker && !fs.existsSync(path.join(root, marker))) {
    return { valid: false, reason: 'marker_missing' };
  }
  return { valid: true, reason: '' };
}

function hasValidArtifact(skill, root) {
  return artifactStatus(skill, root).valid;
}

function isEphemeralTestRoot(root) {
  if (typeof root !== 'string' || !EPHEMERAL_TEST_RE.test(root)) return false;
  const tmpRoots = [os.tmpdir(), '/tmp', '/private/tmp', '/var/folders', '/private/var/folders']
    .filter(Boolean)
    .map((p) => path.resolve(p));
  const resolved = path.resolve(root);
  return tmpRoots.some((base) => resolved.startsWith(base + path.sep));
}

const pendingThumbs = new Set();
function ensureThumb(rec) {
  try {
    if (!server?.listening) return;
    if (pendingThumbs.has(rec.root) || fs.existsSync(thumbPath(rec.root)) || !previewEntry(rec.root, rec.skill)) return;
    const addr = server.address();
    const activePort = (addr && typeof addr === 'object' && addr.port) ? addr.port : PORT;
    const url = new URL(`http://127.0.0.1:${activePort}/api/preview`);
    url.searchParams.set('skill', rec.skill);
    url.searchParams.set('root', rec.root);
    pendingThumbs.add(rec.root);
    execFile(process.execPath, [path.join(pluginRoot, 'tools/thumb.mjs'), url.href, thumbPath(rec.root)],
      { timeout: 30000 }, (err, stdout, stderr) => {
        pendingThumbs.delete(rec.root);
        if (err) console.error(`thumbnail: ${String(stderr?.trim() || err.message).split(/\r?\n/)[0]}`);
      });
  } catch (err) {
    pendingThumbs.delete(rec.root);
    console.error(`thumbnail: ${String(err.message).split(/\r?\n/)[0]}`);
  }
}

function isRecord(v) {
  return typeof v === 'object' && v !== null && v.v === 1 &&
    typeof v.root === 'string' && typeof v.skill === 'string' &&
    typeof v.title === 'string' && typeof v.openedAt === 'string';
}

function readRecord(file) {
  try {
    const val = JSON.parse(fs.readFileSync(file, 'utf8'));
    return isRecord(val) ? val : null;
  } catch { return null; }
}

function writeWhole(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tmp, data);
  fs.renameSync(tmp, file);
}

function writeRecord(record) {
  writeWhole(recordFile(record.root), `${JSON.stringify(record, null, 2)}\n`);
}

function findArtifact(root) {
  const r = readRecord(recordFile(root));
  return r?.root === root ? r : null;
}

function removeArtifactIndex(root) {
  fs.rmSync(recordFile(root), { force: true });
  try {
    const tp = path.join(dshHome(), 'thumbs', `${folderHash(root)}.png`);
    fs.rmSync(tp, { force: true });
  } catch {}
}

function forgetArtifact(root) {
  const rec = findArtifact(String(root || ''));
  if (!rec) return { ok: false, error: '未找到记录' };
  try {
    removeArtifactIndex(rec.root);
    return { ok: true, root: rec.root };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

function forgetMissingArtifacts() {
  let names = [];
  try { names = fs.readdirSync(artifactsDir()); } catch {}
  let removed = 0;
  for (const name of names) {
    if (!name.endsWith('.json')) continue;
    const file = path.join(artifactsDir(), name);
    const rec = readRecord(file);
    if (!rec) continue;
    if (!hasValidArtifact(rec.skill, rec.root)) {
      try {
        fs.rmSync(file, { force: true });
        const tp = path.join(dshHome(), 'thumbs', `${folderHash(rec.root)}.png`);
        fs.rmSync(tp, { force: true });
        removed++;
      } catch {}
    }
  }
  return { ok: true, removed };
}

function hasDotTraversal(rawPath) {
  return String(rawPath || '').split(/[\\/]+/).some((seg) => seg === '.' || seg === '..');
}

// 预览与登记及全部读写路由共用同一根目录边界；realpathSync.native 阻止 ../ 与内外指软链逃逸。
function allowedArtifactRoot(root) {
  if (typeof root !== 'string' || !root.trim() || root.includes('\0') || !path.isAbsolute(root)) return false;
  if (hasDotTraversal(root)) return false;

  let lstat;
  let realTarget;
  try {
    lstat = fs.lstatSync(root);
    realTarget = resolveRealPath(root);
    if (!fs.statSync(realTarget).isDirectory()) return false;
  } catch {
    return false;
  }

  if (isForbiddenWorkspacePath(realTarget, { pluginRoot, hostUserData: HOST_USER_DATA, designHome: dshHome() })) {
    return false;
  }

  const state = readState();
  const ws = state.workspaceRoot;
  const existingRec = findArtifact(root);

  if (existingRec) {
    try {
      if (lstat.isSymbolicLink()) return false;
      const realParent = resolveRealPath(path.dirname(root));
      if (!isSameOrInside(realTarget, path.join(realParent, path.basename(root)))) return false;
      if (ws && isInsideDir(path.resolve(root), path.resolve(ws))) {
        const realWs = resolveRealPath(ws);
        if (!isInsideDir(realTarget, realWs)) return false;
      }
      if (!ws || !isInsideDir(realTarget, resolveRealPath(ws))) {
        if (!hasValidArtifact(existingRec.skill, realTarget)) return false;
      }
      return true;
    } catch {
      return false;
    }
  }

  if (!ws) return false;
  try {
    const realWs = resolveRealPath(ws);
    const designDir = path.join(ws, '.design');
    const realDesignDir = resolveRealPath(designDir);
    if (!isInsideDir(realDesignDir, realWs)) return false;
    if (!isInsideDir(path.resolve(root), path.resolve(designDir))) return false;
    return isInsideDir(realTarget, realDesignDir);
  } catch {
    return false;
  }
}

function registerArtifact(input) {
  if (!input || typeof input !== 'object' || typeof input.skill !== 'string' || !Object.hasOwn(SKILL_BY_ID, input.skill)) {
    return { ok: false, error: '未知技能' };
  }
  if (!validWsRoot(input.root)) return { ok: false, code: 'PATH_OUTSIDE_WORKSPACE', error: 'root 必须是存在的绝对目录路径' };
  const rawRoot = String(input.root);
  if (hasDotTraversal(rawRoot)) return { ok: false, code: 'PATH_OUTSIDE_WORKSPACE', error: '项目目录不在当前工作区安全边界内' };
  const root = path.resolve(rawRoot);
  if (!allowedArtifactRoot(root)) return { ok: false, code: 'PATH_OUTSIDE_WORKSPACE', error: '项目目录不在当前工作区安全边界内' };
  for (const key of ['title', 'note']) {
    if (input[key] !== undefined && typeof input[key] !== 'string') {
      return { ok: false, error: `${key} 必须是字符串` };
    }
  }
  clearDismissed(root);
  const before = findArtifact(root);
  const record = before ? { ...before } : {
    v: 1, root, skill: input.skill,
    title: input.title?.trim() || path.basename(root), openedAt: new Date().toISOString(),
  };
  if (input.title !== undefined) record.title = input.title.trim().slice(0, TITLE_MAX) || path.basename(root);
  if (input.note !== undefined) record.note = input.note.trim().slice(0, 2000);
  delete record.missing;
  try {
    writeRecord(record);
    return { ok: true, record };
  } catch (err) { return { ok: false, error: err.message }; }
}

function artifactTitle(skill, root) {
  const at = TITLES[skill];
  if (!at) return '';
  try {
    const val = JSON.parse(fs.readFileSync(path.join(root, at[0]), 'utf8'))[at[1]];
    const title = typeof val === 'string' ? val.trim() : '';
    if (title && title !== 'project') return title;
  } catch {}
  return '';
}

function recordOpened(skill, root, now = new Date()) {
  const file = recordFile(root);
  const before = readRecord(file);
  const mine = before?.root === root ? before : null;
  const s = SKILL_BY_ID[skill];
  const record = {
    v: 1,
    root,
    skill,
    plugin: s?.plugin || `dsh-${skill}`,
    sessionId: mine?.sessionId || '',
    title: artifactTitle(skill, root) || before?.title || path.basename(root),
    openedAt: now.toISOString(),
    firstOpenedAt: mine ? (mine.firstOpenedAt || mine.openedAt) : now.toISOString(),
    ...(mine?.pinned ? { pinned: true } : {}),
    ...(mine?.note !== undefined ? { note: mine.note } : {}),
    ...(mine?.id !== undefined ? { id: mine.id } : {}),
  };
  writeRecord(record);
  ensureThumb(record);
  return record;
}

function contentStamp(root) {
  let newest = 0;
  let entries = 0;
  const walk = (dir, top) => {
    let names;
    try { names = fs.readdirSync(dir); } catch { return; }
    for (const name of names) {
      if (++entries > STAMP_MAX_ENTRIES) return;
      if (name.endsWith('.tmp') || (top && NOT_CONTENT.has(name))) continue;
      const p = path.join(dir, name);
      try {
        const stat = fs.statSync(p);
        if (stat.isDirectory()) walk(p, false);
        else if (stat.mtimeMs > newest) newest = stat.mtimeMs;
      } catch {}
    }
  };
  walk(root, true);
  return newest > 0 ? new Date(newest).toISOString() : '';
}

function isShared(root) {
  try {
    return JSON.parse(fs.readFileSync(path.join(root, '.sharing.json'), 'utf8')).lan === true;
  } catch { return false; }
}

function isDeletable(skill, root) {
  const own = FOLDER[skill];
  if (!own) return false;
  const home = process.env.HOME || os.homedir();
  if (root === home || root === path.parse(root).root) return false;
  try {
    return fs.readdirSync(root).every((name) =>
      own.includes(name) || EDITOR_FILES.includes(name) || name.endsWith('.tmp')
    );
  } catch { return false; }
}

function moveFolder(from, to) {
  fs.mkdirSync(path.dirname(to), { recursive: true });
  try {
    fs.renameSync(from, to);
  } catch (err) {
    if (err.code !== 'EXDEV') throw err;
    fs.cpSync(from, to, { recursive: true, preserveTimestamps: true });
    fs.rmSync(from, { recursive: true, force: true });
  }
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

function trashArtifact(record) {
  const id = `${folderHash(record.root)}-${Date.now()}`;
  const entry = path.join(trashDir(), id);
  try {
    const now = Date.now();
    for (const name of fs.readdirSync(trashDir())) {
      if (!TRASH_ID.test(name)) continue;
      const entryDir = path.join(trashDir(), name);
      const hasFolder = fs.existsSync(path.join(entryDir, 'folder'));
      const hasDismissed = fs.existsSync(path.join(entryDir, '.dismissed'));
      if (!hasFolder && !hasDismissed) {
        fs.rmSync(entryDir, { recursive: true, force: true });
      } else if (hasDismissed) {
        const ts = Number(name.split('-').pop());
        if (Number.isFinite(ts) && now - ts > 3600_000) {
          fs.rmSync(entryDir, { recursive: true, force: true });
        }
      }
    }
  } catch {}
  fs.mkdirSync(entry, { recursive: true });
  fs.writeFileSync(path.join(entry, 'record.json'), `${JSON.stringify(record, null, 2)}\n`);
  const moved = isDeletable(record.skill, record.root);
  const p = path.join(entry, 'folder', path.basename(record.root));
  if (moved) {
    moveFolder(record.root, p);
  } else {
    // 混合目录绝不删改任何文件，改为写入 dismissed/ 标记防止扫盘复活，并保留撤销元数据窗口
    fs.writeFileSync(path.join(entry, '.dismissed'), '');
    markDismissed(record.root, record.skill);
  }
  removeArtifactIndex(record.root);
  ownedEditorRoots.delete(safeRealPath(record.root));
  return { trash: id, moved, path: moved ? p : record.root };
}

function restoreArtifact(id) {
  if (!TRASH_ID.test(id)) throw new Error('not a trash entry');
  const entry = path.join(trashDir(), id);
  const record = readRecord(path.join(entry, 'record.json'));
  if (record === null) throw new Error('nothing to put back');
  const folder = path.join(entry, 'folder', path.basename(record.root));
  if (fs.existsSync(folder)) {
    if (fs.existsSync(record.root)) throw new Error(`${record.root} is taken`);
    moveFolder(folder, record.root);
  }
  clearDismissed(record.root);
  delete record.missing;
  writeRecord(record);
  fs.rmSync(entry, { recursive: true, force: true });
  return record;
}

function cleanTitle(raw) {
  if (typeof raw !== 'string') return null;
  const title = raw.replace(/\s+/g, ' ').trim().slice(0, TITLE_MAX);
  return title || null;
}

async function renameArtifact(skill, root, title) {
  if (!allowedArtifactRoot(root)) {
    throw new Error('PATH_OUTSIDE_WORKSPACE');
  }
  const at = TITLES[skill];
  if (!at) throw new Error(`no title to change for ${skill}`);

  // 先执行磁盘目录重命名（失败则未改写任何文件内容），成功后再更新 JSON title
  let finalRoot = root;
  const parentDir = path.dirname(root);
  const oldBase = path.basename(root);
  const slug = sanitizeDirSlug(title);
  if (path.basename(parentDir) === '.design' && slug && slug !== oldBase) {
    let candidate = slug;
    let i = 2;
    while (fs.existsSync(path.join(parentDir, candidate)) && path.join(parentDir, candidate) !== root) {
      candidate = `${slug}-${i++}`;
    }
    const nextRoot = path.join(parentDir, candidate);
    if (nextRoot !== root) {
      await stopSkillEditor(skill, root).catch(() => {});
      moveFolder(root, nextRoot);
      ownedEditorRoots.delete(safeRealPath(root));
      finalRoot = nextRoot;
    }
  }

  try {
    if (skill === 'claude-dashboard' || skill === 'claude-motion') {
      const metaPath = path.join(finalRoot, at[0]);
      if (fs.existsSync(metaPath)) {
        const meta = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
        meta[at[1]] = title;
        writeWhole(metaPath, `${JSON.stringify(meta, null, 2)}\n`);
      }
    } else {
      const file = path.join(finalRoot, at[0]);
      if (fs.existsSync(file)) {
        const idx = JSON.parse(fs.readFileSync(file, 'utf8'));
        writeWhole(file, `${JSON.stringify({ ...idx, [at[1]]: title }, null, 2)}\n`);
      }
    }
  } catch (err) {
    if (finalRoot !== root) {
      try { moveFolder(finalRoot, root); } catch {}
    }
    throw err;
  }

  const oldRec = findArtifact(root);
  let nextRec = oldRec ? { ...oldRec, root: finalRoot, title } : null;
  if (finalRoot !== root) {
    removeArtifactIndex(root);
    if (nextRec) writeRecord(nextRec);
  } else if (nextRec) {
    writeRecord(nextRec);
  }
  return { root: finalRoot, title, record: nextRec };
}

function installRoot() {
  return path.join(HOST_USER_DATA, 'plugins');
}
function isInstalledPluginPath(target) {
  return isForbiddenWorkspacePath(target, { pluginRoot, hostUserData: HOST_USER_DATA, designHome: dshHome() });
}

const PROFILE_DB = resolveProfileDb(pluginRoot);

function validWsRoot(p) {
  return validateWorkspacePath(p, { pluginRoot, hostUserData: HOST_USER_DATA, designHome: dshHome() }).ok;
}

let hostSchemeCache = { value: '', at: 0 };
function hostScheme() {
  const now = Date.now();
  if (now - hostSchemeCache.at < 30000) return hostSchemeCache.value;
  let value = '';
  try {
    const out = execFileSync('sqlite3', [PROFILE_DB,
      "SELECT payload FROM profile_state_documents WHERE domain='settings'"],
      { timeout: 1500, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
    const theme = JSON.parse(out).theme;
    if (theme === 'dark' || theme === 'light') value = theme;
  } catch {}
  hostSchemeCache = { value, at: now };
  return value;
}

function readState() {
  const STATE_TTL_MS = 15000;
  const validateOpts = { pluginRoot, hostUserData: HOST_USER_DATA, designHome: dshHome() };
  let explicit = {};
  try { explicit = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')); } catch {}

  const updatedAt = Number(explicit.updatedAt);
  const fresh = Number.isFinite(updatedAt) && Date.now() - updatedAt < STATE_TTL_MS;
  let profileMtimeMs = 0;
  try { profileMtimeMs = fs.statSync(PROFILE_DB).mtimeMs; } catch {}
  const profileNewer = Number.isFinite(updatedAt) ? profileMtimeMs > updatedAt : true;

  if (explicit.errorCode && !explicit.workspaceRoot && (fresh || !profileNewer)) {
    return {
      workspaceRoot: '',
      realWorkspaceRoot: '',
      workspaceName: '',
      errorCode: explicit.errorCode,
      errorMessage: explicit.errorMessage || formatWorkspaceError(explicit.errorCode),
    };
  }

  const explicitCheck = explicit.workspaceRoot
    ? validateWorkspacePath(explicit.workspaceRoot, validateOpts)
    : null;
  const explicitState = explicitCheck?.ok
    ? {
        workspaceRoot: explicitCheck.workspaceRoot,
        realWorkspaceRoot: explicitCheck.realWorkspaceRoot,
        workspaceName: explicit.workspaceName || explicitCheck.workspaceName || '',
        errorCode: '',
        errorMessage: '',
      }
    : null;

  if (fresh && explicitState) return explicitState;

  const fromProfile = readProfileActiveWorkspace(PROFILE_DB);
  if (fromProfile) {
    if (fromProfile.isRemote) {
      return {
        workspaceRoot: '',
        realWorkspaceRoot: '',
        workspaceName: '',
        errorCode: 'REMOTE_OR_UNMOUNTED',
        errorMessage: formatWorkspaceError('REMOTE_OR_UNMOUNTED', { path: fromProfile.rawPath }),
      };
    }
    const profileCheck = validateWorkspacePath(fromProfile.rawPath, validateOpts);
    if (profileCheck.ok) {
      return {
        workspaceRoot: profileCheck.workspaceRoot,
        realWorkspaceRoot: profileCheck.realWorkspaceRoot,
        workspaceName: profileCheck.workspaceName,
        errorCode: '',
        errorMessage: '',
      };
    }
    if (profileCheck.code === 'REMOTE_OR_UNMOUNTED' || profileCheck.code === 'FORBIDDEN_WORKSPACE_PATH') {
      return {
        workspaceRoot: '',
        realWorkspaceRoot: '',
        workspaceName: '',
        errorCode: profileCheck.code,
        errorMessage: profileCheck.message,
      };
    }
  }

  if (explicitState) return explicitState;
  if (explicitCheck && !explicitCheck.ok && (explicitCheck.code === 'REMOTE_OR_UNMOUNTED' || explicitCheck.code === 'FORBIDDEN_WORKSPACE_PATH')) {
    return {
      workspaceRoot: '',
      realWorkspaceRoot: '',
      workspaceName: '',
      errorCode: explicitCheck.code,
      errorMessage: explicitCheck.message,
    };
  }
  return {
    workspaceRoot: '',
    realWorkspaceRoot: '',
    workspaceName: '',
    errorCode: 'NO_WORKSPACE',
    errorMessage: formatWorkspaceError('NO_WORKSPACE'),
  };
}

function artifactCli(skillId) { return path.join(BAOYU_SKILLS_DIR, skillId, 'scripts', 'artifact.mjs'); }
function runNode(args) {
  return new Promise((resolve) => {
    execFile(process.execPath, args, { timeout: OPEN_TIMEOUT_MS }, (err, stdout, stderr) =>
      resolve({ err, stdout: String(stdout || ''), stderr: String(stderr || '') }));
  });
}

function projectMeta(skillId, root) {
  const read = (rel) => { try { return JSON.parse(fs.readFileSync(path.join(root, rel), 'utf8')); } catch { return null; } };
  if (skillId === 'claude-design') {
    const c = read('project/canvas.json');
    return c ? `${Object.keys(c.boards || {}).length} 画板` : '';
  }
  if (skillId === 'claude-slides') {
    const d = read('project/deck.json');
    return d ? `${(d.order || []).length} 页` : '';
  }
  if (skillId === 'claude-motion') {
    const sc = read('db/film/meta.json') || read('project/scenes.json');
    if (!sc) return '';
    const count = Array.isArray(sc) ? sc.length : (sc.scenes ? (Array.isArray(sc.scenes) ? sc.scenes.length : Object.keys(sc.scenes).length) : Object.keys(sc).length);
    return count ? `${count} 场景` : '';
  }
  if (skillId === 'claude-design-system') {
    try {
      return `${fs.readdirSync(path.join(root, 'project', 'components'), { withFileTypes: true }).filter((e) => e.isDirectory()).length} 组件`;
    } catch { return ''; }
  }
  if (skillId === 'claude-dashboard') {
    try {
      const meta = read('db/dash/meta.json');
      return meta?.sheets ? `${Object.keys(meta.sheets).length} 报表` : '看板';
    } catch { return ''; }
  }
  return '';
}

function scanDesignProjects(rootDir) {
  const found = [];
  if (!rootDir || !fs.existsSync(rootDir)) return found;
  const SKIP = new Set(['.git', 'node_modules', '.orca', '.agy-daddy', '.agents', 'trash', 'vendor', 'dist', '.venv', '__pycache__', 'build']);
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
        if (fs.existsSync(path.join(p, s.marker))) {
          found.push({ skill: s.id, root: p, title: artifactTitle(s.id, p) || e.name });
          matched = true;
          break;
        }
      }
      if (!matched) walk(p, depth + 1);
    }
  })(rootDir, 0);
  return found;
}

function previewEntry(root, skill) {
  if (!hasValidArtifact(skill, root)) return null;
  if (skill === 'claude-design-system') {
    const cover = path.join(root, 'project', 'components', 'Cover', 'preview.html');
    if (fs.existsSync(cover)) return cover;
    try {
      const compsDir = path.join(root, 'project', 'components');
      for (const entry of fs.readdirSync(compsDir, { withFileTypes: true })) {
        if (!entry.isDirectory()) continue;
        const candidate = path.join(compsDir, entry.name, 'preview.html');
        if (fs.existsSync(candidate)) return candidate;
      }
    } catch {}
    return null;
  }
  if (skill === 'claude-slides') {
    try {
      const deck = JSON.parse(fs.readFileSync(path.join(root, 'project', 'deck.json'), 'utf8'));
      const preferred = [deck.cover, ...(Array.isArray(deck.order) ? deck.order : [])].filter(Boolean);
      for (const id of preferred) {
        const candidate = path.join(root, 'project', 'slides', `${String(id).replace(/\.html$/, '')}.html`);
        if (fs.existsSync(candidate)) return candidate;
      }
    } catch {}
    try {
      const files = fs.readdirSync(path.join(root, 'project', 'slides')).filter((f) => f.endsWith('.html')).sort();
      if (files.length) return path.join(root, 'project', 'slides', files[0]);
    } catch {}
  }
  if (skill === 'claude-design') {
    try {
      const canvas = JSON.parse(fs.readFileSync(path.join(root, 'project', 'canvas.json'), 'utf8'));
      for (const board of canvas.order || Object.keys(canvas.boards || {})) {
        const candidate = path.join(root, 'project', board);
        if (fs.existsSync(candidate) && candidate.endsWith('.html')) return candidate;
      }
    } catch {}
  }
  try {
    const files = fs.readdirSync(path.join(root, 'project')).filter((f) => f.endsWith('.html')).sort();
    if (files.length) return path.join(root, 'project', files[0]);
  } catch {}
  return null;
}

function renderPreviewDocument(file, skill) {
  const raw = fs.readFileSync(file, 'utf8').replace(/^<!--\s*@dsCard[^>]*-->\s*\r?\n?/, '');
  if (skill === 'claude-slides' && !/<!doctype|<html\b/i.test(raw)) {
    return Buffer.from(`<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><style>
*{box-sizing:border-box}
html,body{margin:0;width:1280px;height:800px;overflow:hidden;background:#0b3875;font-family:Inter,-apple-system,BlinkMacSystemFont,"PingFang SC","Microsoft YaHei",sans-serif;-webkit-font-smoothing:antialiased}
.slide-stage{width:1920px;height:1080px;transform:scale(0.666667);transform-origin:0 0;position:relative;overflow:hidden}
.slide-stage > section{width:1920px;height:1080px;position:relative;overflow:hidden}
x-shape{display:block;pointer-events:none}
x-shape[kind="ellipse"]{border-radius:50%}
</style></head><body><div class="slide-stage">${raw}</div></body></html>`, 'utf8');
  }
  if (skill === 'claude-design' && raw.includes('<x-dc')) {
    const cleaned = raw
      .replace(/<script\b[^>]*src=["']\.\/support\.js["'][^>]*><\/script>/gi, '')
      .replace('</head>', '<style>html,body{margin:0;padding:0;overflow:hidden}x-dc,helmet{display:contents}</style></head>');
    return Buffer.from(cleaned, 'utf8');
  }
  return Buffer.from(raw, 'utf8');
}

function listArtifactsViews() {
  const state = readState();
  const workspaceRoot = state.workspaceRoot ? path.resolve(state.workspaceRoot) : '';
  const map = new Map();
  const pruneEphemeral = !hasCustomDesignHome();

  let names = [];
  try { names = fs.readdirSync(artifactsDir()); } catch {}
  for (const name of names) {
    if (!name.endsWith('.json')) continue;
    const file = path.join(artifactsDir(), name);
    const rec = readRecord(file);
    if (rec === null) continue;
    const status = artifactStatus(rec.skill, rec.root);
    if (!status.valid) {
      if (pruneEphemeral && isEphemeralTestRoot(rec.root)) {
        removeArtifactIndex(rec.root);
        continue;
      }
      rec.missing = true;
      rec._missingReason = status.reason;
    } else if (rec.missing) {
      delete rec.missing;
      writeRecord(rec);
    }
    map.set(rec.root, rec);
  }

  if (workspaceRoot) {
    const scanned = scanDesignProjects(workspaceRoot);
    for (const item of scanned) {
      if (isDismissed(item.root)) continue;
      const existing = map.get(item.root);
      if (!existing) {
        const rec = recordOpened(item.skill, item.root, new Date());
        map.set(item.root, rec);
      } else if (existing.missing) {
        delete existing.missing;
        delete existing._missingReason;
        writeRecord(existing);
      }
    }
  }

  const views = [];
  for (const [root, rec] of map.entries()) {
    const s = SKILL_BY_ID[rec.skill];
    if (!s) continue;
    const isMissing = rec.missing === true;
    const resolvedRoot = path.resolve(root);
    const inCurrentWorkspace = Boolean(
      workspaceRoot && (resolvedRoot === workspaceRoot || resolvedRoot.startsWith(workspaceRoot + path.sep)),
    );
    const title = (isMissing ? '' : artifactTitle(rec.skill, root)) || rec.title || path.basename(root);
    const mtime = isMissing ? '' : contentStamp(root);
    views.push({
      root,
      skill: rec.skill,
      plugin: rec.plugin,
      sessionId: rec.sessionId || '',
      title,
      openedAt: rec.openedAt,
      firstOpenedAt: rec.firstOpenedAt || rec.openedAt,
      updatedAt: mtime || rec.openedAt,
      pinned: rec.pinned === true,
      shared: isMissing ? false : isShared(root),
      deletable: isMissing ? false : isDeletable(rec.skill, root),
      meta: isMissing ? '' : projectMeta(rec.skill, root),
      note: typeof rec.note === 'string' ? rec.note : '',
      tail: root.split(/[\\/]/).filter(Boolean).slice(-2).join('/'),
      openable: !isMissing,
      missing: isMissing,
      missingReason: isMissing ? (rec._missingReason || 'dir_missing') : '',
      inCurrentWorkspace,
      preview: isMissing ? false : Boolean(previewEntry(root, rec.skill)),
      thumb: isMissing ? false : fs.existsSync(thumbPath(root)),
    });
  }

  views.sort((a, b) => {
    if (a.missing !== b.missing) return a.missing ? 1 : -1;
    if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
    return b.openedAt.localeCompare(a.openedAt);
  });

  return {
    ok: true,
    buildId: GALLERY_BUILD_ID,
    pluginRoot,
    artifacts: views,
    workspaceName: state.workspaceName || '',
    workspaceRoot,
    workspaceError: state.errorCode ? { code: state.errorCode, message: state.errorMessage || '' } : null,
  };
}

async function openSkillEditor(skillId, rootInput) {
  const meta = SKILL_BY_ID[skillId];
  if (!meta) return { ok: false, error: `unknown skill: ${skillId}` };
  let root = rootInput;
  if (root) {
    if (!allowedArtifactRoot(root)) {
      return { ok: false, code: 'PATH_OUTSIDE_WORKSPACE', error: '项目目录不在当前工作区安全边界内' };
    }
  } else {
    const roots = listArtifactsViews().artifacts.filter((i) => i.skill === skillId && !i.missing);
    if (!roots.length) return { ok: false, error: `no ${skillId} project` };
    root = roots[0].root;
  }
  if (!hasValidArtifact(skillId, root)) {
    return { ok: false, error: '项目目录或索引文件已不在原路径' };
  }
  const r = await runNode([artifactCli(skillId), 'open', root]);
  if (r.err) return { ok: false, error: `artifact open failed: ${r.stderr || r.err.message}` };
  const m = r.stdout.match(/\{[\s\S]*"url"[\s\S]*\}/);
  if (!m) return { ok: false, error: `no url in artifact output: ${r.stdout.slice(0, 200)}` };
  try {
    const parsed = JSON.parse(m[0]);
    const reused = parsed.reused === true;
    if (!reused) {
      ownedEditorRoots.set(safeRealPath(root), { root, skill: skillId });
    }
    recordOpened(skillId, root);
    return { ok: true, url: parsed.url, reused };
  } catch {
    return { ok: false, error: 'unparsable artifact output' };
  }
}

async function stopSkillEditor(skillId, root) {
  if (typeof skillId !== 'string' || !Object.hasOwn(SKILL_BY_ID, skillId)) {
    return { ok: false, error: `未知技能: ${String(skillId)}` };
  }
  ownedEditorRoots.delete(safeRealPath(root));
  const r = await runNode([artifactCli(skillId), 'stop', root]);
  return r.err ? { ok: false, error: r.stderr || r.err.message } : { ok: true };
}

async function stopOwnedEditors() {
  const entries = [...ownedEditorRoots.values()];
  ownedEditorRoots.clear();
  await Promise.all(entries.map((entry) => stopSkillEditor(entry.skill, entry.root).catch(() => {})));
}

async function restartEditor(skillId, root) {
  await stopSkillEditor(skillId, root);
  return await openSkillEditor(skillId, root);
}

async function createExample(templateId, nameInput) {
  const tpl = EXAMPLE_TEMPLATES[templateId];
  if (!tpl) return { ok: false, error: `${templateId} 项目由 agent 创建（无静态示例模板）` };
  const skillId = tpl.skill || templateId;
  const st = readState();
  const base = st.workspaceRoot || '';
  if (!base) {
    const code = st.errorCode || 'NO_WORKSPACE';
    return { ok: false, code, error: st.errorMessage || formatWorkspaceError(code) };
  }
  const wsCheck = validateWorkspacePath(base, { pluginRoot, hostUserData: HOST_USER_DATA, designHome: dshHome() });
  if (!wsCheck.ok) {
    return { ok: false, code: wsCheck.code, error: wsCheck.message };
  }
  if (skillId === 'claude-design-system') {
    const existingDs = scanDesignProjects(base)
      .filter((item) => item.skill === 'claude-design-system' && !isDismissed(item.root));
    if (existingDs.length > 0) {
      return {
        ok: false,
        code: 'DESIGN_SYSTEM_EXISTS',
        root: existingDs[0].root,
        error: formatWorkspaceError('DESIGN_SYSTEM_EXISTS', { title: existingDs[0].title }),
      };
    }
  }
  const displayTitle = cleanTitle(nameInput) || tpl.title || '';
  const baseName = sanitizeDirSlug(nameInput) || tpl.dirName;
  const designDir = path.join(base, '.design');
  let name = baseName, i = 2;
  while (fs.existsSync(path.join(designDir, name))) name = `${baseName}-${i++}`;
  const root = path.join(designDir, name);
  const finalTitle = displayTitle || name;
  const now = new Date().toISOString().replace(/\.\d+Z$/, 'Z');
  for (const [rel, content] of Object.entries(tpl.files)) {
    const p = path.join(root, rel);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    if (content === '__INDEX__') {
      const idx = {
        ...(EXAMPLE_INDEX[templateId] || tpl.index),
        createdOnFiles: { v: 1, at: now },
        title: finalTitle,
        lastChange: { by: 'prototype-studio', at: now, via: 'Orca plugin', note: 'Built-in Lakala template' },
      };
      fs.writeFileSync(p, `${JSON.stringify(idx, null, 2)}\n`);
    } else {
      fs.writeFileSync(p, content, 'utf8');
    }
  }
  clearDismissed(root);
  recordOpened(skillId, root);
  const chk = await runNode([artifactCli(skillId), 'check', root]);
  let problems = null;
  try { problems = JSON.parse(chk.stdout).problems ?? null; } catch {}
  return { ok: true, root, skill: skillId, title: finalTitle, problems };
}

function galleryHtml(requestedLang = 'zh', requestedScheme = '') {
  return buildGalleryHtml({
    requestedLang,
    requestedScheme,
    resolvedHostScheme: hostScheme(),
    skills: SKILLS,
    tints: TINTS,
    recipes: RECIPES,
    examples: OFFICIAL_EXAMPLES,
    templatesMap: TEMPLATES_MAP,
    lakalaTokens: LAKALA_TOKENS,
    dsComponents: DS_COMPONENTS,
  });
}

function buildStarter(rec, skill) {
  return `${skill.prompt}与「${rec.title}」同款的新作。`
    + `请先查看参考项目 ${rec.root} 的主题、版式与风格，沿用同一套设计语言，仅替换为新内容。`
    + `新内容：`;
}

async function launchAgent(starter, agent) {
  const st = readState();
  const ws = st.workspaceRoot || '';
  if (!ws) {
    const code = st.errorCode || 'NO_WORKSPACE';
    return {
      ok: false,
      code,
      fallback: 'clipboard',
      starter,
      error: st.errorMessage || formatWorkspaceError(code),
    };
  }
  const r = await new Promise((resolve) => {
    execFile(ORCA_BIN, [
      'agent', 'launch', '--agent', agent,
      '--worktree', `path:${ws}`,
      '--surface', 'chat', '--focus',
      '--prompt', starter, '--json',
    ], { timeout: 20000 }, (err, stdout) => resolve({ err, stdout: String(stdout || '') }));
  });
  if (r.err) return { ok: false, fallback: 'clipboard', error: `Agent 启动失败: ${r.err.message}`, starter };
  try {
    const j = JSON.parse(r.stdout);
    if (!j || j.ok !== true) {
      return { ok: false, fallback: 'clipboard', error: j?.error?.message || 'agent launch 返回失败', starter };
    }
    return { ok: true, outcome: j.result?.outcome?.kind || 'chat', starter };
  } catch {
    return { ok: false, fallback: 'clipboard', error: 'agent launch 返回不可解析输出', starter };
  }
}

function cleanAgentId(v) {
  return String(v || 'claude').replace(/[^a-z0-9-]/gi, '').slice(0, 32) || 'claude';
}

async function startFromArtifact(input) {
  const st = readState();
  const checkWs = (starter) => {
    if (!st.workspaceRoot) {
      const code = st.errorCode || 'NO_WORKSPACE';
      return {
        ok: false,
        code,
        fallback: 'clipboard',
        starter,
        error: st.errorMessage || formatWorkspaceError(code),
      };
    }
    return null;
  };

  if (input.skill) {
    const s = SKILL_BY_ID[String(input.skill)];
    if (!s) return { ok: false, error: `未知技能: ${input.skill}` };
    const blocked = checkWs(s.prompt);
    if (blocked) return blocked;
    return launchAgent(s.prompt, cleanAgentId(input.agent));
  }
  if (input.example) {
    const example = OFFICIAL_EXAMPLES.find((x) => x.id === String(input.example));
    if (!example) return { ok: false, error: '未知官方示例' };
    const starter = `${SKILL_BY_ID[example.skill].prompt}${example.desc}\n参考拉卡拉内置设计系统（品牌青 #00B9F1 / 深海蓝 #0B3875 / 交互蓝 #007FA8）与示例要素：${example.points}。请在当前工作区 .design/ 内创建新项目。`;
    const blocked = checkWs(starter);
    if (blocked) return blocked;
    return launchAgent(starter, cleanAgentId(input.agent));
  }
  if (input.recipe) {
    const r = RECIPES.find((x) => x.id === String(input.recipe));
    if (!r) return { ok: false, error: '未知工作流' };
    const blocked = checkWs(r.template);
    if (blocked) return blocked;
    return launchAgent(r.template, cleanAgentId(input.agent));
  }
  const root = String(input.root || '');
  const rec = findArtifact(root);
  if (!rec) return { ok: false, error: '未找到该作品的记录' };
  const skill = SKILL_BY_ID[rec.skill];
  if (!skill) return { ok: false, error: `未知技能: ${rec.skill}` };
  const starter = buildStarter(rec, skill);
  const blocked = checkWs(starter);
  if (blocked) return blocked;
  return launchAgent(starter, cleanAgentId(input.agent));
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://127.0.0.1');
  res.setHeader('content-type', url.pathname === '/' ? 'text/html; charset=utf-8' : 'application/json; charset=utf-8');
  const allowedGet = ['/', '/api/health', '/api/list', '/api/preview', '/api/thumb'];
  // 所有状态变更都走 POST + guardPost；/api/open 会拉起编辑器，/api/open-url 会跳转，
  // 二者留在 GET 白名单会让跨站页面绕过收口（simple request 不触发 CORS 预检）。
  const allowedPost = [
    '/api/open', '/api/open-url', '/api/update', '/api/delete', '/api/restore',
    '/api/create', '/api/create-example', '/api/rename', '/api/stop',
    '/api/restart', '/api/restart-editor', '/api/shutdown', '/api/start',
    '/api/register', '/api/forget', '/api/forget-missing',
  ];
  if (!((req.method === 'GET' && allowedGet.includes(url.pathname)) || (req.method === 'POST' && allowedPost.includes(url.pathname)))) {
    res.statusCode = 404; return res.end('{}');
  }
  if (req.method === 'POST') {
    const g = guardPost(req);
    if (g) { res.statusCode = g; return res.end('{}'); }
  }
  const finish = (v) => res.end(JSON.stringify(v));

  if (req.method === 'GET') {
    if (url.pathname === '/') return res.end(galleryHtml(url.searchParams.get('lang'), url.searchParams.get('scheme')));
    if (url.pathname === '/api/health') {
      const st = readState();
      const addr = server.address();
      const activePort = (addr && typeof addr === 'object' && addr.port) ? addr.port : PORT;
      return finish({
        ok: true,
        app: APP_ID,
        buildId: GALLERY_BUILD_ID,
        pid: process.pid,
        port: activePort,
        workspaceRoot: st.workspaceRoot || '',
        workspaceName: st.workspaceName || '',
      });
    }
    if (url.pathname === '/api/list') return finish(listArtifactsViews());
    const skill = url.searchParams.get('skill') || '';
    const root = url.searchParams.get('root') || '';
    if (url.pathname === '/api/preview' || url.pathname === '/api/thumb') {
      if (!allowedArtifactRoot(root)) {
        res.statusCode = 403;
        return finish({ ok: false, code: 'PATH_OUTSIDE_WORKSPACE' });
      }
      const isThumb = url.pathname === '/api/thumb';
      const file = isThumb ? thumbPath(root) : previewEntry(root, skill);
      if (!file) { res.statusCode = 404; return res.end(); }
      try {
        const content = isThumb ? fs.readFileSync(file) : renderPreviewDocument(file, skill);
        res.setHeader('content-type', isThumb ? 'image/png' : 'text/html; charset=utf-8');
        return res.end(content);
      } catch { res.statusCode = 404; return res.end(); }
    }
    return finish({ ok: false, error: 'unknown GET route' });
  }

  const declared = Number(req.headers['content-length']);
  if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) {
    req.resume();
    res.statusCode = 413; return res.end('{}');
  }
  const chunks = [];
  let byteLen = 0;
  let tooLarge = false;
  req.on('data', (chunk) => {
    if (tooLarge) return; // 继续消费排空流，不主动 destroy socket
    const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    byteLen += buf.length;
    if (byteLen > MAX_BODY_BYTES) {
      tooLarge = true;
      chunks.length = 0;
      return;
    }
    chunks.push(buf);
  });
  req.on('end', async () => {
    if (tooLarge) { res.statusCode = 413; return res.end('{}'); }
    const body = Buffer.concat(chunks).toString('utf8');
    let input = {};
    try {
      const parsed = JSON.parse(body || '{}');
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) input = parsed;
    } catch {}
    const skill = input.skill || '', root = input.root || '';

    const WORKSPACE_MUTATION_ROUTES = new Set([
      '/api/register', '/api/open', '/api/open-url',
      '/api/forget', '/api/forget-missing', '/api/update',
      '/api/delete', '/api/restore', '/api/rename',
      '/api/stop', '/api/restart-editor',
    ]);
    if (WORKSPACE_MUTATION_ROUTES.has(url.pathname)) {
      const st = readState();
      if (!st.workspaceRoot) {
        res.statusCode = 403;
        return finish({
          ok: false,
          code: st.errorCode || 'NO_WORKSPACE',
          error: st.errorMessage || formatWorkspaceError('NO_WORKSPACE'),
        });
      }
    }

    if (url.pathname === '/api/register') {
      const result = registerArtifact(input);
      if (!result.ok) res.statusCode = 400;
      return finish(result);
    }
    if (url.pathname === '/api/open-url') {
      const r = await openSkillEditor(skill, root);
      if (!r.ok) { res.statusCode = 400; return finish(r); }
      res.statusCode = 302; res.setHeader('location', r.url); return res.end();
    }
    if (url.pathname === '/api/open') {
      const r = await openSkillEditor(skill, root);
      if (!r.ok) res.statusCode = 400;
      return finish(r);
    }
    if (url.pathname === '/api/start') return finish(await startFromArtifact(input));
    if (url.pathname === '/api/forget-missing') return finish(forgetMissingArtifacts());
    if (url.pathname === '/api/forget') {
      if (input.allMissing === true) return finish(forgetMissingArtifacts());
      return finish(forgetArtifact(input.root));
    }
    if (url.pathname === '/api/update') {
      if (!allowedArtifactRoot(root)) {
        res.statusCode = 403;
        return finish({ ok: false, code: 'PATH_OUTSIDE_WORKSPACE', error: 'PATH_OUTSIDE_WORKSPACE' });
      }
      const rec = findArtifact(root);
      if (!rec) return finish({ ok: false, error: 'not recorded' });
      let latestRec = rec;
      if (input.title) {
        const clean = cleanTitle(input.title);
        if (clean) {
          const renamed = await renameArtifact(rec.skill, root, clean);
          if (renamed?.record) latestRec = renamed.record;
          else latestRec.title = clean;
        }
      }
      if (typeof input.pinned === 'boolean') {
        latestRec.pinned = input.pinned;
        writeRecord(latestRec);
      } else if (!input.title) {
        writeRecord(latestRec);
      }
      return finish({ ok: true, root: latestRec.root, title: latestRec.title, record: latestRec });
    }
    if (url.pathname === '/api/delete') {
      if (!allowedArtifactRoot(root)) {
        res.statusCode = 403;
        return finish({ ok: false, code: 'PATH_OUTSIDE_WORKSPACE', error: 'PATH_OUTSIDE_WORKSPACE' });
      }
      const rec = findArtifact(root);
      if (!rec) return finish({ ok: false, error: 'not recorded' });
      try {
        await stopSkillEditor(rec.skill, root);
        const out = trashArtifact(rec);
        return finish({ ok: true, ...out });
      } catch (e) {
        return finish({ ok: false, error: e.message });
      }
    }
    if (url.pathname === '/api/restore') {
      try {
        const rec = restoreArtifact(input.id || '');
        return finish({ ok: true, record: rec });
      } catch (e) {
        return finish({ ok: false, error: e.message });
      }
    }
    if (url.pathname === '/api/create' || url.pathname === '/api/create-example') {
      return finish(await createExample(skill || input.templateId || '', input.name));
    }
    if (url.pathname === '/api/rename') {
      const clean = cleanTitle(input.name || input.title);
      if (!clean) return finish({ ok: false, error: 'invalid title' });
      if (!allowedArtifactRoot(root)) {
        res.statusCode = 400;
        return finish({ ok: false, code: 'PATH_OUTSIDE_WORKSPACE', error: '项目目录不在当前工作区安全边界内' });
      }
      try {
        const targetSkill = skill || findArtifact(root)?.skill || '';
        const renamed = await renameArtifact(targetSkill, root, clean);
        return finish({ ok: true, root: renamed.root, title: renamed.title, record: renamed.record });
      } catch (e) {
        return finish({ ok: false, error: e.message });
      }
    }
    if (url.pathname === '/api/stop') {
      if (!allowedArtifactRoot(root)) {
        res.statusCode = 403;
        return finish({ ok: false, code: 'PATH_OUTSIDE_WORKSPACE', error: 'PATH_OUTSIDE_WORKSPACE' });
      }
      return finish(await stopSkillEditor(skill, root));
    }
    if (url.pathname === '/api/restart-editor') {
      if (!allowedArtifactRoot(root)) {
        res.statusCode = 403;
        return finish({ ok: false, code: 'PATH_OUTSIDE_WORKSPACE', error: 'PATH_OUTSIDE_WORKSPACE' });
      }
      return finish(await restartEditor(skill, root));
    }
    if (url.pathname === '/api/shutdown') {
      await stopOwnedEditors();
      finish({ ok: true, shuttingDown: true });
      server.close(() => process.exit(0));
      setTimeout(() => process.exit(0), 250).unref?.();
      return;
    }
    if (url.pathname === '/api/restart') {
      await stopOwnedEditors();
      finish({ ok: true, restarting: true });
      server.close(() => {
        try {
          const child = execFile(process.execPath, [__filename], { detached: true, stdio: 'ignore' });
          child.unref();
        } catch {}
        setTimeout(() => process.exit(0), 250);
      });
      return;
    }
  });
});

export {
  listArtifactsViews,
  openSkillEditor,
  stopSkillEditor,
  stopOwnedEditors,
  trashArtifact,
  restoreArtifact,
  renameArtifact,
  createExample,
  galleryHtml,
  findArtifact,
  writeRecord,
  forgetArtifact,
  forgetMissingArtifacts,
  hasValidArtifact,
  previewEntry,
  allowedArtifactRoot,
  isDismissed,
  server,
};

function isDirectEntry() {
  if (!process.argv[1]) return false;
  try {
    return fs.realpathSync(process.argv[1]) === fs.realpathSync(__filename);
  } catch {
    return path.resolve(process.argv[1]) === path.resolve(__filename);
  }
}

if (isDirectEntry()) {
  const shutdownOnSignal = async () => {
    await stopOwnedEditors().catch(() => {});
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 250).unref?.();
  };
  process.on('SIGTERM', shutdownOnSignal);
  process.on('SIGINT', shutdownOnSignal);
  server.on('error', (e) => console.error('gallery server error:', e.message));
  server.listen(PORT, '127.0.0.1', () => console.log(`gallery listening on ${PORT}`));
}
