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
  resolveProfileDb,
  GALLERY_BUILD_ID,
} from './skills-meta.mjs';

const __filename = fileURLToPath(import.meta.url);
const pluginRoot = path.dirname(path.dirname(__filename));
const STATE_FILE = process.env.ORCA_STATE_FILE || path.join(os.tmpdir(), 'prototype-studio-state.json');
const BAOYU_SKILLS_DIR = path.join(pluginRoot, 'vendor', 'baoyu-design', 'skills');
const ORCA_BIN = resolveHostCli(pluginRoot);
const PORT = Number(process.env.PORT) || 3480;

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
function thumbsDir() {
  const dir = path.join(dshHome(), 'thumbs');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}
const folderHash = (root) => crypto.createHash('sha256').update(root).digest('hex').slice(0, 24);
function recordFile(root) { return path.join(artifactsDir(), `${folderHash(root)}.json`); }
function thumbPath(root) { return path.join(thumbsDir(), `${folderHash(root)}.png`); }

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

// 预览与登记共用同一根目录边界；真实路径检查阻止 .design 内的符号链接逃逸。
function allowedArtifactRoot(root) {
  if (typeof root !== 'string' || !path.isAbsolute(root)) return false;
  if (findArtifact(root)) return true;
  const ws = readState().workspaceRoot;
  if (!ws) return false;
  const designDir = path.resolve(ws, '.design');
  if (!path.resolve(root).startsWith(designDir + path.sep)) return false;
  try {
    const realDesignDir = path.join(fs.realpathSync(ws), '.design');
    return fs.realpathSync(designDir) === realDesignDir &&
      fs.realpathSync(root).startsWith(realDesignDir + path.sep);
  } catch { return false; }
}

function registerArtifact(input) {
  if (!input || typeof input !== 'object' || typeof input.skill !== 'string' || !Object.hasOwn(SKILL_BY_ID, input.skill)) {
    return { ok: false, error: '未知技能' };
  }
  if (!validWsRoot(input.root)) return { ok: false, error: 'root 必须是存在的绝对目录路径' };
  const root = path.resolve(input.root);
  if (!allowedArtifactRoot(root)) return { ok: false, error: 'root 不在工作区 .design/ 内且尚未登记' };
  for (const key of ['title', 'note']) {
    if (input[key] !== undefined && typeof input[key] !== 'string') {
      return { ok: false, error: `${key} 必须是字符串` };
    }
  }
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

function trashArtifact(record) {
  const id = `${folderHash(record.root)}-${Date.now()}`;
  const entry = path.join(trashDir(), id);
  try {
    for (const name of fs.readdirSync(trashDir())) {
      if (TRASH_ID.test(name) && !fs.existsSync(path.join(trashDir(), name, 'folder'))) {
        fs.rmSync(path.join(trashDir(), name), { recursive: true, force: true });
      }
    }
  } catch {}
  fs.mkdirSync(entry, { recursive: true });
  fs.writeFileSync(path.join(entry, 'record.json'), `${JSON.stringify(record, null, 2)}\n`);
  const moved = isDeletable(record.skill, record.root);
  const p = path.join(entry, 'folder', path.basename(record.root));
  if (moved) moveFolder(record.root, p);
  fs.rmSync(recordFile(record.root), { force: true });
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
  const at = TITLES[skill];
  if (!at) throw new Error(`no title to change for ${skill}`);
  if (skill === 'claude-dashboard' || skill === 'claude-motion') {
    const metaPath = path.join(root, at[0]);
    if (fs.existsSync(metaPath)) {
      try {
        const meta = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
        meta[at[1]] = title;
        writeWhole(metaPath, `${JSON.stringify(meta, null, 2)}\n`);
      } catch {}
    }
  } else {
    const file = path.join(root, at[0]);
    if (fs.existsSync(file)) {
      const idx = JSON.parse(fs.readFileSync(file, 'utf8'));
      writeWhole(file, `${JSON.stringify({ ...idx, [at[1]]: title }, null, 2)}\n`);
    }
  }
  const rec = findArtifact(root);
  if (rec) {
    rec.title = title;
    writeRecord(rec);
  }
}

function installRoot() {
  return path.join(resolveHostUserData(pluginRoot), 'plugins');
}
function isInstalledPluginPath(target) {
  const root = path.resolve(installRoot());
  const p = path.resolve(String(target || ''));
  return p === root || p.startsWith(root + path.sep);
}

const PROFILE_DB = resolveProfileDb(pluginRoot);

function validWsRoot(p) {
  if (typeof p !== 'string' || !path.isAbsolute(p)) return false;
  try { return fs.statSync(p).isDirectory(); } catch { return false; }
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
  let explicit = {};
  try { explicit = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')); } catch {}
  const explicitValid = validWsRoot(explicit.workspaceRoot);
  const explicitState = explicitValid
    ? {
        workspaceRoot: explicit.workspaceRoot,
        workspaceName: explicit.workspaceName || path.basename(explicit.workspaceRoot) || '',
      }
    : null;
  // 点击时写入的焦点快照在短时间内优先消费；超时后优先读宿主 profile DB，
  // 若宿主无 sqlite3 CLI（如 Windows）或 profile 尚未落盘，则回退保留已知合法快照。
  const fresh = Number.isFinite(Number(explicit.updatedAt)) &&
    Date.now() - Number(explicit.updatedAt) < STATE_TTL_MS;
  if (fresh && explicitState) return explicitState;
  try {
    const out = execFileSync('sqlite3', [PROFILE_DB,
      "SELECT payload FROM profile_state_documents WHERE domain='workspaceSession'"],
      { timeout: 3000, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
    const ws = JSON.parse(out);
    const id = ws.activeWorktreeId || '';
    const p = id.includes('::') ? id.split('::').pop() : '';
    if (validWsRoot(p)) {
      return { workspaceRoot: p, workspaceName: path.basename(p) || '' };
    }
  } catch {}
  if (explicitState) return explicitState;
  return { workspaceRoot: '', workspaceName: '' };
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
  };
}

async function openSkillEditor(skillId, rootInput) {
  const meta = SKILL_BY_ID[skillId];
  if (!meta) return { ok: false, error: `unknown skill: ${skillId}` };
  let root = rootInput;
  if (!root) {
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
    recordOpened(skillId, root);
    return { ok: true, url: parsed.url, reused: parsed.reused === true };
  } catch {
    return { ok: false, error: 'unparsable artifact output' };
  }
}

async function stopSkillEditor(skillId, root) {
  const r = await runNode([artifactCli(skillId), 'stop', root]);
  return r.err ? { ok: false, error: r.stderr || r.err.message } : { ok: true };
}

async function restartEditor(skillId, root) {
  await stopSkillEditor(skillId, root);
  return await openSkillEditor(skillId, root);
}

async function createExample(templateId, nameInput) {
  const tpl = EXAMPLE_TEMPLATES[templateId];
  if (!tpl) return { ok: false, error: `${templateId} 项目由 agent 创建（无静态示例模板）` };
  const skillId = tpl.skill || templateId;
  const base = readState().workspaceRoot || '';
  if (!base) return { ok: false, error: '当前工作区未识别，请稍后重试' };
  if (isInstalledPluginPath(base)) {
    return { ok: false, error: '当前工作区是 Orca 插件安装路径，请切换到其他工作区创建设计项目' };
  }
  const safe = String(nameInput || '').replace(/[^A-Za-z0-9_-]/g, '').slice(0, 40);
  const baseName = safe || tpl.dirName;
  const designDir = path.join(base, '.design');
  let name = baseName, i = 2;
  while (fs.existsSync(path.join(designDir, name))) name = `${baseName}-${i++}`;
  const root = path.join(designDir, name);
  const displayTitle = safe || tpl.title || name;
  const now = new Date().toISOString().replace(/\.\d+Z$/, 'Z');
  for (const [rel, content] of Object.entries(tpl.files)) {
    const p = path.join(root, rel);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    if (content === '__INDEX__') {
      const idx = {
        ...(EXAMPLE_INDEX[templateId] || tpl.index),
        createdOnFiles: { v: 1, at: now },
        title: displayTitle,
        lastChange: { by: 'prototype-studio', at: now, via: 'Orca plugin', note: 'Built-in Lakala template' },
      };
      fs.writeFileSync(p, `${JSON.stringify(idx, null, 2)}\n`);
    } else {
      fs.writeFileSync(p, content, 'utf8');
    }
  }
  recordOpened(skillId, root);
  const chk = await runNode([artifactCli(skillId), 'check', root]);
  let problems = null;
  try { problems = JSON.parse(chk.stdout).problems ?? null; } catch {}
  return { ok: true, root, skill: skillId, problems };
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
  const r = await new Promise((resolve) => {
    execFile(ORCA_BIN, [
      'agent', 'launch', '--agent', agent,
      '--worktree', `path:${readState().workspaceRoot || ''}`,
      '--surface', 'chat', '--focus',
      '--prompt', starter, '--json',
    ], { timeout: 20000 }, (err, stdout) => resolve({ err, stdout: String(stdout || '') }));
  });
  if (r.err) return { ok: false, error: `Agent 启动失败: ${r.err.message}`, starter };
  try {
    const j = JSON.parse(r.stdout);
    if (!j.ok) return { ok: false, error: j.error?.message || 'agent launch 返回失败', starter };
    return { ok: true, outcome: j.result?.outcome?.kind || 'chat', starter };
  } catch {
    return { ok: true, outcome: 'launched', starter };
  }
}

function cleanAgentId(v) {
  return String(v || 'claude').replace(/[^a-z0-9-]/gi, '').slice(0, 32) || 'claude';
}

async function startFromArtifact(input) {
  if (input.example) {
    const example = OFFICIAL_EXAMPLES.find((x) => x.id === String(input.example));
    if (!example) return { ok: false, error: '未知官方示例' };
    if (!readState().workspaceRoot) return { ok: false, error: '工作区未识别，无法启动 Agent' };
    const starter = `${SKILL_BY_ID[example.skill].prompt}${example.desc}\n参考拉卡拉内置设计系统（品牌青 #00B9F1 / 深海蓝 #0B3875 / 交互蓝 #007FA8）与示例要素：${example.points}。请在当前工作区 .design/ 内创建新项目。`;
    return launchAgent(starter, cleanAgentId(input.agent));
  }
  if (input.recipe) {
    const r = RECIPES.find((x) => x.id === String(input.recipe));
    if (!r) return { ok: false, error: '未知工作流' };
    if (!readState().workspaceRoot) return { ok: false, error: '工作区未识别，无法启动 Agent' };
    return launchAgent(r.template, cleanAgentId(input.agent));
  }
  const root = String(input.root || '');
  const rec = findArtifact(root);
  if (!rec) return { ok: false, error: '未找到该作品的记录' };
  const skill = SKILL_BY_ID[rec.skill];
  if (!skill) return { ok: false, error: `未知技能: ${rec.skill}` };
  if (!readState().workspaceRoot) return { ok: false, error: '工作区未识别，无法启动 Agent' };
  return launchAgent(buildStarter(rec, skill), cleanAgentId(input.agent));
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://127.0.0.1');
  res.setHeader('content-type', url.pathname === '/' ? 'text/html; charset=utf-8' : 'application/json; charset=utf-8');
  const allowedGet = ['/', '/api/list', '/api/preview', '/api/thumb'];
  // 所有状态变更都走 POST + guardPost；/api/open 会拉起编辑器，/api/open-url 会跳转，
  // 二者留在 GET 白名单会让跨站页面绕过收口（simple request 不触发 CORS 预检）。
  const allowedPost = ['/api/open', '/api/open-url', '/api/update', '/api/delete', '/api/restore', '/api/create', '/api/rename', '/api/stop', '/api/restart', '/api/restart-editor', '/api/shutdown', '/api/start', '/api/register', '/api/forget'];
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
    if (url.pathname === '/api/list') return finish(listArtifactsViews());
    const skill = url.searchParams.get('skill') || '';
    const root = url.searchParams.get('root') || '';
    if (url.pathname === '/api/preview' || url.pathname === '/api/thumb') {
      const allowed = allowedArtifactRoot(root);
      const isThumb = url.pathname === '/api/thumb';
      const file = allowed ? (isThumb ? thumbPath(root) : previewEntry(root, skill)) : null;
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
  let body = '';
  let tooLarge = false;
  req.on('data', (c) => {
    if (tooLarge) return;
    body += c;
    if (body.length > MAX_BODY_BYTES) tooLarge = true;
  });
  req.on('end', async () => {
    if (tooLarge) { res.statusCode = 413; return res.end('{}'); }
    let input = {};
    try {
      const parsed = JSON.parse(body || '{}');
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) input = parsed;
    } catch {}
    const skill = input.skill || '', root = input.root || '';

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
    if (url.pathname === '/api/forget') {
      if (input.allMissing === true) return finish(forgetMissingArtifacts());
      return finish(forgetArtifact(input.root));
    }
    if (url.pathname === '/api/update') {
      const rec = findArtifact(root);
      if (!rec) return finish({ ok: false, error: 'not recorded' });
      if (typeof input.pinned === 'boolean') rec.pinned = input.pinned;
      if (input.title) {
        const clean = cleanTitle(input.title);
        if (clean) await renameArtifact(rec.skill, root, clean);
      }
      writeRecord(rec);
      return finish({ ok: true, record: rec });
    }
    if (url.pathname === '/api/delete') {
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
    if (url.pathname === '/api/create') return finish(await createExample(skill, input.name));
    if (url.pathname === '/api/rename') {
      const clean = cleanTitle(input.name || input.title);
      if (!clean) return finish({ ok: false, error: 'invalid title' });
      try {
        await renameArtifact(skill, root, clean);
        return finish({ ok: true });
      } catch (e) {
        return finish({ ok: false, error: e.message });
      }
    }
    if (url.pathname === '/api/stop') return finish(await stopSkillEditor(skill, root));
    if (url.pathname === '/api/restart-editor') return finish(await restartEditor(skill, root));
    if (url.pathname === '/api/shutdown') {
      finish({ ok: true, shuttingDown: true });
      server.close(() => process.exit(0));
      setTimeout(() => process.exit(0), 250).unref?.();
      return;
    }
    if (url.pathname === '/api/restart') {
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
  server.on('error', (e) => console.error('gallery server error:', e.message));
  server.listen(PORT, '127.0.0.1', () => console.log(`gallery listening on ${PORT}`));
}
