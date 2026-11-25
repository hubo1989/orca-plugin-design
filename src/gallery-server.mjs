#!/usr/bin/env node
// Orca-Design · 独立项目库服务（detached，固定 3480）
// 职责：工作区作品懒扫描、旧 .design/ 兼容、Open Artifact Daemon Token 代理、同 Tab Shell 内嵌与运行时按需分发
import { execFile, execFileSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { guardPost, MAX_BODY_BYTES } from './post-guard.mjs';
import {
  SKILLS,
  SKILL_BY_ID,
  TITLES,
  TINTS,
  FOLDER,
  RECIPES,
  EDITOR_FILES,
  NOT_CONTENT,
  EXAMPLE_TEMPLATES,
  EXAMPLE_INDEX,
  normalizeTypeId,
  resolveTypeMeta,
} from './skills-meta.mjs';
import {
  ensureRuntime,
  getRuntimeStatus,
  importOfflineTarball,
  onRuntimeProgress,
  parseTarGzBuffer,
} from './runtime-manager.mjs';
import {
  api as daemonApi,
  createHarness,
  ensureDaemon,
  openArtifactHome,
  readDaemon,
} from './vendor/harness-kit.mjs';

const __filename = fileURLToPath(import.meta.url);
const pluginRoot = path.dirname(path.dirname(__filename));
const STATE_FILE = process.env.ORCA_STATE_FILE || path.join(os.tmpdir(), 'prototype-studio-state.json');
const ORCA_BIN = process.env.ORCA_CLI_COMMAND || '/Applications/Orca.app/Contents/Resources/bin/orca';
const PORT = Number(process.env.PORT) || 3480;
const EXAMPLES_INDEX = JSON.parse(fs.readFileSync(new URL('./examples.json', import.meta.url), 'utf8'));
const OFFICIAL_EXAMPLES = [...new Set([...Object.keys(EXAMPLES_INDEX), ...Object.keys(EXAMPLE_TEMPLATES)])]
  .map((id) => normalizeTypeId(id))
  .filter((v, idx, arr) => v && arr.indexOf(v) === idx && Object.hasOwn(SKILL_BY_ID, v) && v !== 'page')
  .map((skill) => {
    const example = EXAMPLES_INDEX[skill] || EXAMPLES_INDEX[SKILL_BY_ID[skill]?.legacyId] || {};
    const template = EXAMPLE_TEMPLATES[skill] || {};
    const files = { ...template.files, ...example.files };
    return {
      id: skill,
      skill,
      title: example.title || `${SKILL_BY_ID[skill].name}示例`,
      desc: example.desc || SKILL_BY_ID[skill].about,
      points: example.points || Object.keys(files).join('、'),
      html: Object.entries(files).find(([name]) => name.endsWith('.html'))?.[1] || '',
    };
  });

const TITLE_MAX = 200;
const STAMP_MAX_ENTRIES = 20000;
const TRASH_ID = /^[0-9a-f]{24}-\d+$/;

function orcaConfigParent() {
  const home = process.env.HOME || os.homedir();
  if (process.platform === 'darwin') return path.join(home, 'Library', 'Application Support', 'orca');
  if (process.platform === 'win32') return path.join(process.env.APPDATA || path.join(home, 'AppData', 'Roaming'), 'orca');
  return path.join(process.env.XDG_CONFIG_HOME || path.join(home, '.config'), 'orca');
}

function dshHome() {
  const set = process.env.ORCA_DESIGN_HOME?.trim() || process.env.DSH_HOME?.trim();
  if (set) return set;
  return path.join(orcaConfigParent(), 'orca-design');
}

function legacyDshHome() {
  const set = process.env.ORCA_DESIGN_LEGACY_HOME?.trim();
  if (set) return set;
  return path.join(orcaConfigParent(), 'baoyu-design');
}

export function migrateLegacyDesignHome(targetHome = dshHome(), sourceHome = legacyDshHome()) {
  try {
    if (path.resolve(targetHome) === path.resolve(sourceHome)) return { migrated: false, reason: 'same_dir' };
    const marker = path.join(targetHome, '.migrated-v1');
    if (fs.existsSync(marker)) return { migrated: false, reason: 'already_migrated' };
    if (!fs.existsSync(sourceHome) || !fs.statSync(sourceHome).isDirectory()) {
      return { migrated: false, reason: 'no_legacy_dir' };
    }
    fs.mkdirSync(targetHome, { recursive: true });
    const copied = [];
    for (const sub of ['artifacts', 'thumbs', 'trash']) {
      const srcSub = path.join(sourceHome, sub);
      const dstSub = path.join(targetHome, sub);
      if (!fs.existsSync(srcSub)) continue;
      fs.cpSync(srcSub, dstSub, { recursive: true, force: false, errorOnExist: false, preserveTimestamps: true });
      copied.push(sub);
    }
    fs.writeFileSync(marker, JSON.stringify({
      migratedAt: new Date().toISOString(),
      source: sourceHome,
      copied,
    }, null, 2) + '\n', 'utf8');
    return { migrated: true, copied };
  } catch (err) {
    return { migrated: false, error: err.message };
  }
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

const pendingThumbs = new Set();
function ensureThumb(rec) {
  if (process.env.ORCA_DESIGN_NO_THUMB === '1') return;
  try {
    if (pendingThumbs.has(rec.root) || fs.existsSync(thumbPath(rec.root)) || !previewEntry(rec.root, rec.skill)) return;
    const url = new URL(`http://127.0.0.1:${PORT}/api/preview`);
    url.searchParams.set('skill', rec.skill);
    url.searchParams.set('root', rec.root);
    pendingThumbs.add(rec.root);
    const child = execFile(process.execPath, [path.join(pluginRoot, 'tools/thumb.mjs'), url.href, thumbPath(rec.root)],
      { timeout: 30000 }, (err, stdout, stderr) => {
        pendingThumbs.delete(rec.root);
        if (err) console.error(`thumbnail: ${String(stderr?.trim() || err.message).split(/\r?\n/)[0]}`);
      });
    child.unref?.();
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

function allowedArtifactRoot(root) {
  if (typeof root !== 'string' || !path.isAbsolute(root)) return false;
  if (findArtifact(root)) return true;
  const ws = readState().workspaceRoot;
  if (!ws) return false;
  const wsReal = (() => { try { return fs.realpathSync(ws); } catch { return ''; } })();
  if (!wsReal) return false;
  const resolved = path.resolve(root);
  for (const sub of ['.design', 'artifacts']) {
    const base = path.resolve(ws, sub);
    if (resolved.startsWith(base + path.sep)) {
      try {
        const realBase = path.join(wsReal, sub);
        if (fs.realpathSync(base) === realBase && fs.realpathSync(root).startsWith(realBase + path.sep)) return true;
      } catch { /* ignore */ }
    }
  }
  return false;
}

function registerArtifact(input) {
  const skill = normalizeTypeId(input?.skill);
  if (!input || typeof input !== 'object' || !skill || !Object.hasOwn(SKILL_BY_ID, skill)) {
    return { ok: false, error: '未知作品类型' };
  }
  if (!validWsRoot(input.root)) return { ok: false, error: 'root 必须是存在的绝对目录路径' };
  const root = path.resolve(input.root);
  if (!allowedArtifactRoot(root)) return { ok: false, error: 'root 不在工作区 .design/ 或 artifacts/ 内且尚未登记' };
  for (const key of ['title', 'note']) {
    if (input[key] !== undefined && typeof input[key] !== 'string') {
      return { ok: false, error: `${key} 必须是字符串` };
    }
  }
  const before = findArtifact(root);
  const record = before ? { ...before, skill } : {
    v: 1,
    root,
    skill,
    title: input.title?.trim() || path.basename(root),
    openedAt: new Date().toISOString(),
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
  const norm = normalizeTypeId(skill);
  const at = TITLES[norm];
  if (!at) return '';
  try {
    const val = JSON.parse(fs.readFileSync(path.join(root, at[0]), 'utf8'))[at[1]];
    const title = typeof val === 'string' ? val.trim() : '';
    if (title && title !== 'project') return title;
  } catch {}
  return '';
}

function recordOpened(skill, root, now = new Date(), extra = {}) {
  const norm = normalizeTypeId(skill) || skill;
  const file = recordFile(root);
  const before = readRecord(file);
  const mine = before?.root === root ? before : null;
  const s = SKILL_BY_ID[norm];
  const record = {
    v: 1,
    root,
    skill: norm,
    plugin: s?.plugin || `open-artifact-${norm}`,
    sessionId: mine?.sessionId || '',
    title: artifactTitle(norm, root) || before?.title || path.basename(root),
    openedAt: now.toISOString(),
    firstOpenedAt: mine ? (mine.firstOpenedAt || mine.openedAt) : now.toISOString(),
    ...(mine?.pinned ? { pinned: true } : {}),
    ...(mine?.note !== undefined ? { note: mine.note } : {}),
    ...(mine?.id !== undefined ? { id: mine.id } : {}),
    ...extra,
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
  const norm = normalizeTypeId(skill);
  const own = FOLDER[norm];
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

function trashArtifact(record, options = {}) {
  const movePhysical = options.moveFolder !== undefined ? options.moveFolder === true : true;
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
  const moved = movePhysical && isDeletable(record.skill, record.root);
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
  const norm = normalizeTypeId(skill);
  const at = TITLES[norm];
  if (at) {
    const file = path.join(root, at[0]);
    if (fs.existsSync(file)) {
      try {
        const idx = JSON.parse(fs.readFileSync(file, 'utf8'));
        idx[at[1]] = title;
        writeWhole(file, `${JSON.stringify(idx, null, 2)}\n`);
      } catch { /* non-fatal */ }
    }
  }
  const rec = findArtifact(root);
  if (rec) {
    rec.title = title;
    writeRecord(rec);
    if (rec.id) {
      await callDaemonApi('artifacts.update', { id: rec.id, title }).catch(() => {});
    }
  }
}

function installRoot() {
  return path.join(orcaConfigParent(), 'plugins');
}
function isInstalledPluginPath(target) {
  const root = path.resolve(installRoot());
  const p = path.resolve(String(target || ''));
  return p === root || p.startsWith(root + path.sep);
}

const PROFILE_DB = process.env.ORCA_PROFILE_DB || path.join(orcaConfigParent(), 'profiles', 'local-default', 'profile-state.db');

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
  } catch { /* fallback */ }
  hostSchemeCache = { value, at: now };
  return value;
}

function readState() {
  let explicit = {};
  try { explicit = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')); } catch {}
  if (validWsRoot(explicit.workspaceRoot)) return explicit;
  try {
    const out = execFileSync('sqlite3', [PROFILE_DB,
      "SELECT payload FROM profile_state_documents WHERE domain='workspaceSession'"],
      { timeout: 3000, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
    const ws = JSON.parse(out);
    const id = ws.activeWorktreeId || '';
    const p = id.includes('::') ? id.split('::').pop() : '';
    if (validWsRoot(p)) {
      return { workspaceRoot: p, workspaceName: p.split('/').filter(Boolean).pop() || '' };
    }
  } catch {}
  return { workspaceRoot: '', workspaceName: '' };
}

function projectMeta(skillId, root) {
  const norm = normalizeTypeId(skillId);
  const read = (rel) => { try { return JSON.parse(fs.readFileSync(path.join(root, rel), 'utf8')); } catch { return null; } };
  if (norm === 'design') {
    const c = read('project/canvas.json');
    return c ? `${Object.keys(c.boards || {}).length} 画板` : '';
  }
  if (norm === 'slides') {
    const d = read('project/deck.json');
    return d ? `${(d.order || []).length} 页` : '';
  }
  if (norm === 'motion') {
    const sc = read('db/film/meta.json') || read('project/scenes.json');
    if (!sc) return '';
    const count = Array.isArray(sc) ? sc.length : (sc.scenes ? (Array.isArray(sc.scenes) ? sc.scenes.length : Object.keys(sc.scenes).length) : Object.keys(sc).length);
    return count ? `${count} 场景` : '';
  }
  if (norm === 'design-system') {
    try {
      return `${fs.readdirSync(path.join(root, 'project', 'components'), { withFileTypes: true }).filter((e) => e.isDirectory()).length} 组件`;
    } catch { return ''; }
  }
  if (norm === 'data') {
    const meta = read('db/dash/meta.json');
    return meta?.sheets ? `${Object.keys(meta.sheets).length} 报表` : '看板';
  }
  if (norm === 'whiteboard') {
    const meta = read('db/board/meta.json');
    const count = meta?.elements ? Object.keys(meta.elements).length : 0;
    return count ? `${count} 要素` : '白板';
  }
  if (norm === 'sheets') {
    const sheet = read('sheet/sheet.json');
    const count = Array.isArray(sheet?.sheets) ? sheet.sheets.length : (sheet?.sheets ? Object.keys(sheet.sheets).length : 0);
    return count ? `${count} 工作表` : '工作表';
  }
  if (norm === 'docs') {
    const doc = read('doc/doc.json');
    const count = Array.isArray(doc?.tabs) ? doc.tabs.length : 0;
    return count ? `${count} 标签页` : '文档';
  }
  if (norm === 'page') return '自由页面';
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
      let dotArtifact = null;
      const dotFile = path.join(p, '.artifact.json');
      if (fs.existsSync(dotFile)) {
        try { dotArtifact = JSON.parse(fs.readFileSync(dotFile, 'utf8')); } catch {}
      }
      for (const s of SKILLS) {
        if (s.id === 'page') {
          if (dotArtifact && (dotArtifact.type === 'page' || !dotArtifact.type) && fs.existsSync(path.join(p, 'index.html'))) {
            found.push({
              skill: 'page',
              root: p,
              title: dotArtifact.title || e.name,
              adopted: true,
              id: dotArtifact.id || '',
            });
            matched = true;
            break;
          }
          continue;
        }
        if (s.detect.some((mk) => fs.existsSync(path.join(p, mk)))) {
          found.push({
            skill: s.id,
            root: p,
            title: artifactTitle(s.id, p) || dotArtifact?.title || e.name,
            adopted: Boolean(dotArtifact?.id),
            id: dotArtifact?.id || '',
          });
          matched = true;
          break;
        }
      }
      if (!matched && dotArtifact && typeof dotArtifact.type === 'string' && dotArtifact.type) {
        found.push({
          skill: normalizeTypeId(dotArtifact.type),
          root: p,
          title: dotArtifact.title || e.name,
          adopted: Boolean(dotArtifact.id),
          id: dotArtifact.id || '',
          typeUid: dotArtifact.typeUid || '',
          typeSource: dotArtifact.typeSource || '',
          typeRelease: dotArtifact.typeRelease || '',
        });
        matched = true;
      }
      if (!matched) walk(p, depth + 1);
    }
  })(rootDir, 0);
  return found;
}

function previewEntry(root, skill) {
  if (!root || !fs.existsSync(root)) return null;
  const norm = normalizeTypeId(skill);
  if (norm === 'page') {
    const idx = path.join(root, 'index.html');
    return fs.existsSync(idx) ? idx : null;
  }
  const dirs = norm === 'slides' ? ['project/slides', 'project'] : ['project', '.'];
  for (const d of dirs) {
    try {
      const files = fs.readdirSync(path.join(root, d)).filter((f) => f.endsWith('.html')).sort();
      if (files.length) return path.join(root, d, files[0]);
    } catch {}
  }
  return null;
}

// ---- Open Artifact Daemon & Harness-Kit 代理层 ----

let harnessInstance = null;
let harnessPromise = null;

async function ensureHarnessConnected() {
  if (harnessInstance && harnessInstance.connected) return harnessInstance;
  if (harnessPromise) return harnessPromise;
  harnessPromise = (async () => {
    const rt = await ensureRuntime({ autoDownload: false });
    if (!rt.ok) return null;
    if (!harnessInstance) {
      harnessInstance = await createHarness({
        harness: 'orca-design',
        agentName: 'Agent',
        profile: { title: 'Orca-Design', agentName: 'Agent', level: 'L1' },
        embed: { origins: [`http://127.0.0.1:${PORT}`], mode: 'frame', remote: 'ask' },
        caps: { library: 'own' },
        runtime: { dir: rt.dir, version: rt.version, update: 'bundled' },
        home: openArtifactHome(),
        autoStart: true,
        log: (line) => console.log(`[oa-harness] ${line}`),
      });
    } else {
      await harnessInstance.ready();
    }
    return harnessInstance;
  })().finally(() => { harnessPromise = null; });
  return harnessPromise;
}

async function getDaemonState({ start = false } = {}) {
  const home = openArtifactHome();
  let state = await readDaemon(home);
  if (state || !start) return state;
  const rt = await ensureRuntime();
  if (!rt.ok) return null;
  state = await ensureDaemon({
    home,
    own: { dir: rt.dir, version: rt.version },
    timeoutMs: 12000,
  });
  ensureHarnessConnected().catch(() => {});
  return state;
}

async function callDaemonApi(name, body, opts = {}) {
  const home = openArtifactHome();
  let state = await getDaemonState({ start: opts.start === true });
  if (!state) {
    return { ok: false, code: 'no_daemon', error: 'Open Artifact Daemon 未运行' };
  }
  try {
    return await daemonApi(state, name, body, opts);
  } catch (err) {
    if (String(err?.status || err?.message).includes('401') || String(err?.status || err?.message).includes('403') || err?.code === 'ECONNREFUSED') {
      state = await readDaemon(home);
      if (state) return await daemonApi(state, name, body, opts);
    }
    throw err;
  }
}

function readOaSettings() {
  const file = path.join(openArtifactHome(), 'settings.json');
  try {
    const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
    return raw && typeof raw === 'object' ? raw : {};
  } catch { return {}; }
}

function writeOaSettings(next) {
  const file = path.join(openArtifactHome(), 'settings.json');
  writeWhole(file, `${JSON.stringify(next, null, 2)}\n`);
}

function scanCustomTypesLocal(wsRoot) {
  const settings = readOaSettings();
  const disabled = new Set(Array.isArray(settings.disabledTypes) ? settings.disabledTypes : []);
  const trustedProjects = new Set((Array.isArray(settings.trustedProjects) ? settings.trustedProjects : []).map((p) => path.resolve(p)));
  const roots = [];
  if (wsRoot) {
    roots.push({
      scope: 'project',
      dir: path.resolve(wsRoot, settings.typeRoots?.project || '.agents/artifact-types'),
      trusted: process.env.OPEN_ARTIFACT_TRUST_PROJECTS === '1' || trustedProjects.has(path.resolve(wsRoot)),
    });
  }
  const expand = (p) => (p.startsWith('~/') ? path.join(os.homedir(), p.slice(2)) : path.resolve(p));
  roots.push({ scope: 'user', dir: expand(settings.typeRoots?.user || '~/.agents/artifact-types'), trusted: true });
  for (const ex of settings.typeRoots?.extra || []) {
    roots.push({ scope: 'extra', dir: expand(ex), trusted: true });
  }
  roots.push({ scope: 'installed', dir: path.join(openArtifactHome(), 'types'), trusted: false });

  const found = [];
  const seen = new Set();
  for (const r of roots) {
    let entries;
    try { entries = fs.readdirSync(r.dir, { withFileTypes: true }); } catch { continue; }
    for (const e of entries) {
      if (!e.isDirectory() || e.name.startsWith('.')) continue;
      if (seen.has(e.name)) continue;
      const dir = path.join(r.dir, e.name);
      const manifestFile = path.join(dir, 'artifact-type.json');
      if (!fs.existsSync(manifestFile) && !fs.existsSync(path.join(dir, 'index.html'))) continue;
      let m = {};
      try { m = JSON.parse(fs.readFileSync(manifestFile, 'utf8')); } catch {}
      seen.add(e.name);
      found.push({
        id: e.name,
        title: m.title || m.name || e.name,
        name: m.name || m.title || e.name,
        description: m.description || m.summary || '',
        category: m.category || 'Custom',
        version: m.version || '0.1.0',
        scope: r.scope,
        trusted: r.trusted,
        enabled: !disabled.has(e.name),
        uses: m.openArtifact?.uses || [],
        network: Array.isArray(m.openArtifact?.network) ? m.openArtifact.network : [],
        detect: Array.isArray(m.detect) ? m.detect : [],
        exports: m.openArtifact?.exports || [],
        dir,
      });
    }
  }
  return { roots, types: found, disabledTypes: [...disabled], trustedProjects: [...trustedProjects] };
}

async function listTypesInfo(wsRoot) {
  const localCustom = scanCustomTypesLocal(wsRoot);
  const builtinViews = SKILLS.map((s) => ({
    id: s.id,
    title: s.nameEn,
    name: s.name,
    nameEn: s.nameEn,
    category: s.category,
    categoryEn: s.categoryEn,
    description: s.about,
    version: '0.14.7',
    scope: 'builtin',
    trusted: true,
    enabled: !localCustom.disabledTypes.includes(s.id),
    uses: s.uses,
    network: [],
    exports: s.exports,
    tint: s.tint,
    builtin: true,
  }));

  let daemonTypes = [];
  const state = await getDaemonState({ start: false }).catch(() => null);
  if (state) {
    try {
      const res = await daemonApi(state, 'types', undefined, {
        query: wsRoot ? { workspace: wsRoot } : undefined,
        signal: AbortSignal.timeout(1200),
      });
      if (Array.isArray(res?.types)) daemonTypes = res.types;
    } catch { /* fallback to local */ }
  }

  const byId = new Map();
  for (const b of builtinViews) byId.set(b.id, b);
  for (const dt of daemonTypes) {
    if (!dt?.id) continue;
    const prev = byId.get(dt.id);
    byId.set(dt.id, {
      ...(prev || {}),
      ...dt,
      builtin: prev?.builtin || dt.scope === 'builtin',
      tint: prev?.tint || '#6366f1',
    });
  }
  for (const ct of localCustom.types) {
    if (!byId.has(ct.id)) {
      byId.set(ct.id, { ...ct, builtin: false, tint: '#6366f1' });
    }
  }
  return {
    ok: true,
    types: [...byId.values()],
    roots: localCustom.roots,
    disabledTypes: localCustom.disabledTypes,
    trustedProjects: localCustom.trustedProjects,
  };
}

async function listArtifactsViewsAsync() {
  const state = readState();
  const workspaceRoot = state.workspaceRoot || '';
  const typesInfo = await listTypesInfo(workspaceRoot);
  const knownTypeMap = new Map(typesInfo.types.map((t) => [t.id, t]));
  const map = new Map();

  let names = [];
  try { names = fs.readdirSync(artifactsDir()); } catch {}
  for (const name of names) {
    if (!name.endsWith('.json')) continue;
    const rec = readRecord(path.join(artifactsDir(), name));
    if (rec === null) continue;
    const normSkill = normalizeTypeId(rec.skill);
    const normalized = { ...rec, skill: normSkill };
    if (!fs.existsSync(normalized.root)) normalized.missing = true;
    map.set(normalized.root, normalized);
  }

  const dState = await getDaemonState({ start: false }).catch(() => null);
  if (dState) {
    try {
      const res = await daemonApi(dState, 'artifacts', undefined, { signal: AbortSignal.timeout(1200) });
      for (const da of res?.artifacts || []) {
        if (!da?.root) continue;
        const inWs = workspaceRoot && (da.root === workspaceRoot || da.root.startsWith(path.resolve(workspaceRoot) + path.sep));
        if (!inWs && !map.has(da.root)) continue;
        const prev = map.get(da.root);
        const normType = normalizeTypeId(da.type);
        map.set(da.root, {
          v: 1,
          root: da.root,
          skill: normType,
          id: da.id,
          url: da.url,
          view_url: da.view_url,
          title: da.title || prev?.title || path.basename(da.root),
          openedAt: da.openedAt || prev?.openedAt || da.updatedAt || da.createdAt || new Date().toISOString(),
          firstOpenedAt: prev?.firstOpenedAt || da.createdAt || da.openedAt || new Date().toISOString(),
          updatedAt: da.contentAt || da.updatedAt || prev?.openedAt,
          pinned: da.pinned === true || prev?.pinned === true,
          note: prev?.note,
          shared: da.shared === true,
          missing: !fs.existsSync(da.root),
          typeMissing: da.typeMissing === true,
          typeUid: da.typeUid || prev?.typeUid || '',
          typeSource: da.typeSource || prev?.typeSource || '',
          typeRelease: da.typeRelease || prev?.typeRelease || '',
          owner: da.owner || null,
          adopted: true,
        });
      }
    } catch { /* ignore daemon read timeout */ }
  }

  if (workspaceRoot) {
    const scanned = scanDesignProjects(workspaceRoot);
    const nowIso = new Date().toISOString();
    for (const item of scanned) {
      const existing = map.get(item.root);
      if (existing) {
        existing.missing = false;
        if (!existing.title && item.title) existing.title = item.title;
        if (item.id && !existing.id) existing.id = item.id;
        if (item.adopted) existing.adopted = true;
      } else {
        map.set(item.root, {
          v: 1,
          root: item.root,
          skill: item.skill,
          id: item.id || '',
          title: item.title || path.basename(item.root),
          openedAt: contentStamp(item.root) || nowIso,
          firstOpenedAt: contentStamp(item.root) || nowIso,
          pinned: false,
          adopted: item.adopted === true,
          typeUid: item.typeUid || '',
          typeSource: item.typeSource || '',
          typeRelease: item.typeRelease || '',
        });
      }
    }
  }

  const views = [];
  for (const [root, rec] of map.entries()) {
    const normSkill = normalizeTypeId(rec.skill);
    const s = resolveTypeMeta(normSkill);
    const typeInfo = knownTypeMap.get(normSkill);
    const typeMissing = rec.typeMissing === true || (!s && !typeInfo);
    const typeDisabled = Boolean(typeInfo && typeInfo.enabled === false);
    const title = artifactTitle(normSkill, root) || rec.title || path.basename(root);
    const mtime = rec.missing ? '' : contentStamp(root);
    views.push({
      root,
      id: rec.id || '',
      skill: normSkill,
      plugin: rec.plugin || s?.plugin || `open-artifact-${normSkill}`,
      sessionId: rec.sessionId || '',
      title,
      openedAt: rec.openedAt,
      firstOpenedAt: rec.firstOpenedAt || rec.openedAt,
      updatedAt: mtime || rec.updatedAt || rec.openedAt,
      pinned: rec.pinned === true,
      shared: rec.shared === true || isShared(root),
      deletable: isDeletable(normSkill, root),
      meta: projectMeta(normSkill, root),
      note: typeof rec.note === 'string' ? rec.note : '',
      tail: root.split('/').slice(-2).join('/'),
      openable: !typeMissing && !typeDisabled && rec.missing !== true,
      typeMissing,
      typeDisabled,
      typeUid: rec.typeUid || '',
      typeSource: rec.typeSource || typeInfo?.scope || '',
      typeTitle: typeInfo?.name || s?.name || normSkill,
      adopted: Boolean(rec.id || rec.adopted),
      missing: rec.missing === true,
      preview: rec.missing === true ? false : !!previewEntry(root, normSkill),
      thumb: rec.missing === true ? false : fs.existsSync(thumbPath(root)),
      owner: rec.owner || null,
    });
  }

  views.sort((a, b) => {
    if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
    return (b.openedAt || '').localeCompare(a.openedAt || '');
  });

  return {
    ok: true,
    artifacts: views,
    workspaceName: state.workspaceName || '',
    workspaceRoot,
    types: typesInfo.types,
    runtime: getRuntimeStatus(),
  };
}

function listArtifactsViews() {
  const state = readState();
  const workspaceRoot = state.workspaceRoot || '';
  const localCustom = scanCustomTypesLocal(workspaceRoot);
  const customMap = new Map(localCustom.types.map((t) => [t.id, t]));
  const map = new Map();

  let names = [];
  try { names = fs.readdirSync(artifactsDir()); } catch {}
  for (const name of names) {
    if (!name.endsWith('.json')) continue;
    const rec = readRecord(path.join(artifactsDir(), name));
    if (rec === null) continue;
    const normSkill = normalizeTypeId(rec.skill);
    const normalized = { ...rec, skill: normSkill };
    if (!fs.existsSync(normalized.root)) normalized.missing = true;
    map.set(normalized.root, normalized);
  }

  if (workspaceRoot) {
    const scanned = scanDesignProjects(workspaceRoot);
    const nowIso = new Date().toISOString();
    for (const item of scanned) {
      if (!map.has(item.root)) {
        map.set(item.root, {
          v: 1,
          root: item.root,
          skill: item.skill,
          id: item.id || '',
          title: item.title || path.basename(item.root),
          openedAt: contentStamp(item.root) || nowIso,
          firstOpenedAt: contentStamp(item.root) || nowIso,
          pinned: false,
          adopted: item.adopted === true,
        });
      }
    }
  }

  const views = [];
  for (const [root, rec] of map.entries()) {
    const normSkill = normalizeTypeId(rec.skill);
    const s = resolveTypeMeta(normSkill);
    const c = customMap.get(normSkill);
    const typeMissing = !s && !c;
    const typeDisabled = localCustom.disabledTypes.includes(normSkill);
    const title = artifactTitle(normSkill, root) || rec.title || path.basename(root);
    const mtime = rec.missing ? '' : contentStamp(root);
    views.push({
      root,
      id: rec.id || '',
      skill: normSkill,
      plugin: rec.plugin || s?.plugin || `open-artifact-${normSkill}`,
      sessionId: rec.sessionId || '',
      title,
      openedAt: rec.openedAt,
      firstOpenedAt: rec.firstOpenedAt || rec.openedAt,
      updatedAt: mtime || rec.openedAt,
      pinned: rec.pinned === true,
      shared: isShared(root),
      deletable: isDeletable(normSkill, root),
      meta: projectMeta(normSkill, root),
      note: typeof rec.note === 'string' ? rec.note : '',
      tail: root.split('/').slice(-2).join('/'),
      openable: !typeMissing && !typeDisabled && rec.missing !== true,
      typeMissing,
      typeDisabled,
      adopted: Boolean(rec.id || rec.adopted),
      missing: rec.missing === true,
      preview: rec.missing === true ? false : !!previewEntry(root, normSkill),
      thumb: rec.missing === true ? false : fs.existsSync(thumbPath(root)),
    });
  }

  views.sort((a, b) => {
    if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
    return (b.openedAt || '').localeCompare(a.openedAt || '');
  });

  return {
    ok: true,
    artifacts: views,
    workspaceName: state.workspaceName || '',
    workspaceRoot,
  };
}

function isLegacyFolder(root) {
  return ['project/deck.json', 'project/canvas.json', 'project/design-system.json', 'db/dash/meta.json', 'db/film/meta.json']
    .some((mk) => fs.existsSync(path.join(root, mk)));
}

function validateLegacyJsonFiles(root, skill) {
  const norm = normalizeTypeId(skill);
  const at = TITLES[norm];
  if (!at) return null;
  const f = path.join(root, at[0]);
  if (!fs.existsSync(f)) return null;
  try {
    const parsed = JSON.parse(fs.readFileSync(f, 'utf8'));
    if (!parsed || typeof parsed !== 'object') return `${at[0]} 不是有效的 JSON 对象`;
    return null;
  } catch (err) {
    return `${at[0]} JSON 解析失败: ${err.message}`;
  }
}

async function openSkillEditor(skillInput, rootInput) {
  const norm = normalizeTypeId(skillInput);
  const ws = readState().workspaceRoot || '';
  const typesInfo = await listTypesInfo(ws);
  const typeExists = typesInfo.types.some((t) => t.id === norm);
  if (!typeExists && !SKILL_BY_ID[norm]) {
    return { ok: false, error: `unknown skill: ${String(skillInput)}` };
  }

  let root = rootInput;
  if (!root) {
    const roots = listArtifactsViews().artifacts.filter((i) => i.skill === norm && !i.missing);
    if (!roots.length) return { ok: false, error: `no ${norm} project` };
    root = roots[0].root;
  }

  const typeInfo = typesInfo.types.find((t) => t.id === norm);
  if (typeInfo && typeInfo.enabled === false) {
    return { ok: false, code: 'type_disabled', error: `类型「${norm}」已停用，请先在类型管理中重新启用` };
  }

  if (norm === 'page' && (!typeInfo || typeInfo.builtin)) {
    const hasIndex = fs.existsSync(path.join(root, 'index.html'));
    if (hasIndex) {
      recordOpened('page', root);
      const url = `/api/preview?skill=page&root=${encodeURIComponent(root)}`;
      return { ok: true, url, embedMode: 'static', l1Mode: true };
    }
  }

  const jsonErr = validateLegacyJsonFiles(root, norm);
  if (jsonErr) {
    return {
      ok: false,
      code: 'legacy_incompatible',
      error: jsonErr,
      root,
      skill: norm,
      hasStaticHtml: Boolean(previewEntry(root, norm)),
    };
  }

  const rtStatus = getRuntimeStatus();
  if (rtStatus.state !== 'ready') {
    ensureRuntime().catch(() => {});
    return {
      ok: false,
      code: 'runtime_not_ready',
      runtime: getRuntimeStatus(),
      error: 'Open Artifact 运行时尚未就绪，正在后台下载',
    };
  }

  try {
    const state = await getDaemonState({ start: true });
    if (!state) {
      return {
        ok: false,
        code: 'runtime_not_ready',
        runtime: getRuntimeStatus(),
        error: '无法启动 Open Artifact Daemon',
      };
    }

    let rec = findArtifact(root);
    let artifactId = rec?.id || '';
    if (!artifactId) {
      const adopted = await daemonApi(state, 'artifacts.adopt', {
        folder: root,
        title: artifactTitle(norm, root) || path.basename(root),
      });
      if (adopted?.error) {
        if (isLegacyFolder(root)) {
          return {
            ok: false,
            code: 'legacy_incompatible',
            error: adopted.error.message || '老作品格式不兼容',
            root,
            skill: norm,
            hasStaticHtml: Boolean(previewEntry(root, norm)),
          };
        }
        return { ok: false, error: adopted.error.message || 'adopt failed' };
      }
      const matchId = String(adopted?.url || '').match(/art_[0-9a-z]+/);
      artifactId = matchId ? matchId[0] : '';
    }

    if (!artifactId) {
      return { ok: false, error: 'Daemon 未返回有效的 artifact id' };
    }

    const opened = await daemonApi(state, 'artifacts.open', { id: artifactId, host: false });
    if (opened?.error) {
      if (isLegacyFolder(root)) {
        return {
          ok: false,
          code: 'legacy_incompatible',
          error: opened.error.message || '老作品打开失败',
          root,
          skill: norm,
          hasStaticHtml: Boolean(previewEntry(root, norm)),
        };
      }
      return { ok: false, error: opened.error.message || 'artifacts.open failed' };
    }

    const boot = await daemonApi(state, 'artifacts.boot', undefined, { query: { id: artifactId } }).catch(() => null);
    if (boot?.problem) {
      if (isLegacyFolder(root)) {
        return {
          ok: false,
          code: 'legacy_incompatible',
          error: boot.problem,
          root,
          skill: norm,
          hasStaticHtml: Boolean(previewEntry(root, norm)),
        };
      }
      return { ok: false, error: boot.problem };
    }

    recordOpened(norm, root, new Date(), { id: artifactId });
    return {
      ok: true,
      id: artifactId,
      url: opened.view_url,
      pageUrl: opened.page_url || opened.page,
      embedMode: 'shell',
      l1Mode: true,
      newerRelease: Boolean(boot?.newerRelease),
    };
  } catch (err) {
    if (isLegacyFolder(root)) {
      return {
        ok: false,
        code: 'legacy_incompatible',
        error: err.message,
        root,
        skill: norm,
        hasStaticHtml: Boolean(previewEntry(root, norm)),
      };
    }
    return { ok: false, error: `Open Artifact 打开失败: ${err.message}` };
  }
}

async function createExample(skillInput, nameInput) {
  const norm = normalizeTypeId(skillInput);
  const base = readState().workspaceRoot || '';
  if (!base) return { ok: false, error: '当前工作区未识别，请稍后重试' };
  if (!fs.existsSync(base) || !fs.statSync(base).isDirectory()) {
    return { ok: false, error: `工作区路径在本机不可见（远程工作区或未挂载）：${base}` };
  }
  if (isInstalledPluginPath(base)) {
    return { ok: false, error: '当前工作区是 Orca 插件安装路径，请切换到其他工作区创建设计项目' };
  }

  const tpl = EXAMPLE_TEMPLATES[norm] || EXAMPLE_TEMPLATES[skillInput];
  const rtReady = getRuntimeStatus().state === 'ready';
  if (rtReady && !tpl && norm !== 'page') {
    try {
      const safe = String(nameInput || '').replace(/[^A-Za-z0-9_\u4e00-\u9fa5 -]/g, '').trim().slice(0, 60);
      const designDir = path.join(base, '.design');
      fs.mkdirSync(designDir, { recursive: true });
      const slugBase = (safe || norm).replace(/[^A-Za-z0-9_-]/g, '-') || norm;
      let folderName = slugBase;
      let idx = 2;
      while (fs.existsSync(path.join(designDir, folderName))) folderName = `${slugBase}-${idx++}`;
      const folder = path.join(designDir, folderName);
      const created = await callDaemonApi('artifacts.create', {
        type: norm,
        title: safe || SKILL_BY_ID[norm]?.nameEn || norm,
        folder,
      }, { start: true });
      if (created?.id) {
        recordOpened(norm, created.root || folder, new Date(), { id: created.id });
        return { ok: true, root: created.root || folder, id: created.id, view_url: created.view_url };
      }
      if (created?.error) return { ok: false, error: created.error.message || 'Daemon 创建失败' };
    } catch (err) {
      return { ok: false, error: `创建失败: ${err.message}` };
    }
  }

  if (!tpl) {
    return { ok: false, error: `${norm} 项目由 Agent 或 Open Artifact 运行时创建（请等待运行时就绪或点击让 Agent 帮我做）` };
  }

  const safe = String(nameInput || '').replace(/[^A-Za-z0-9_-]/g, '').slice(0, 40);
  const baseName = safe || tpl.dirName;
  const designDir = path.join(base, '.design');
  let name = baseName, i = 2;
  while (fs.existsSync(path.join(designDir, name))) name = `${baseName}-${i++}`;
  const root = path.join(designDir, name);
  const now = new Date().toISOString().replace(/\.\d+Z$/, 'Z');
  for (const [rel, content] of Object.entries(tpl.files)) {
    const p = path.join(root, rel);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    if (content === '__INDEX__') {
      const idx = {
        ...EXAMPLE_INDEX[norm],
        createdOnFiles: { v: 1, at: now },
        title: name,
        lastChange: { by: 'prototype-studio', at: now, via: 'Orca plugin', note: 'Example scaffold' },
      };
      fs.writeFileSync(p, JSON.stringify(idx, null, 2));
    } else {
      fs.writeFileSync(p, content, 'utf8');
    }
  }
  recordOpened(norm, root);
  return { ok: true, root };
}

const GALLERY_STR = {
  "zh": {
    "works": "作品",
    "searchPlaceholder": "搜索作品 (/)",
    "search": "搜索作品",
    "clearSearch": "清除搜索",
    "sortFilter": "排序和筛选",
    "switchView": "切换视图",
    "refresh": "刷新列表",
    "typesBtn": "类型管理",
    "new": "新建",
    "examples": "官方示例",
    "workflows": "工作流",
    "allWorks": "全部作品",
    "back": "← 作品",
    "popOut": "单独打开 ↗",
    "language": "切换语言",
    "undo": "撤销",
    "restored": "已恢复作品",
    "restoreFailed": "恢复失败: ",
    "listView": "切换到列表视图",
    "gridView": "切换到网格视图",
    "noMatches": "没有符合条件的作品",
    "noWorks": "还没有作品",
    "clearHint": "尝试清除搜索词或筛选条件。",
    "emptyHint": "基于 Open Artifact 创建的 9 类及自定义作品都会出现在这里。点上面的入口开始做一个。",
    "clearFilters": "清除筛选",
    "projectPreview": "作品预览",
    "missing": "文件已不在",
    "typeMissingBadge": "类型未安装",
    "typeDisabledBadge": "类型已停用",
    "opening": "正在打开…",
    "more": "更多操作",
    "unpin": "取消固定",
    "pin": "固定",
    "cannotOpen": "打不开：",
    "unknownError": "未知错误",
    "openFailed": "打开失败：",
    "rename": "重命名",
    "recreate": "做同款",
    "copyLink": "复制链接",
    "forget": "清除记录",
    "delete": "删除",
    "draftCopied": "草稿已复制，请粘贴给 Agent：",
    "remixFailed": "做同款失败: ",
    "forgotten": "已清除该作品的记录",
    "forgetFailed": "清除失败: ",
    "linkCopied": "链接已复制到剪贴板",
    "linkFailed": "获取链接失败",
    "renameTitle": "重命名作品",
    "cancel": "取消",
    "save": "保存",
    "renameFailed": "重命名失败: ",
    "deleteKeepDefault": "默认仅从项目库移除“{title}”的记录，原磁盘文件夹保持不动：",
    "deleteAlsoMove": "同时将纯作品文件夹移入本地回收站（支持 10 秒撤销）",
    "deleteFailed": "删除失败: ",
    "copyPrompt": "📋 复制 Agent 提示词",
    "createBlank": "✨ 创建空白作品并打开",
    "askAgentCreate": "🤖 让 Agent 帮我做",
    "promptCopied": "✓ 提示词已复制到剪贴板，发给 Agent 即可",
    "copyFailed": "复制失败，请手动复制：",
    "createFailed": "创建失败: ",
    "sortOpened": "最近打开",
    "sortUpdated": "最近修改",
    "sortCreated": "创建时间",
    "sortName": "名称",
    "any": "不限",
    "today": "今天",
    "yesterday": "昨天",
    "week": "最近 7 天",
    "month": "最近 30 天",
    "shared": "已共享",
    "private": "未共享",
    "sortBy": "排序方式",
    "type": "类型",
    "selectedSuffix": " 项",
    "openedAt": "打开时间",
    "sharing": "共享",
    "pinned": "已固定",
    "preview": "预览",
    "exampleSkeleton": "此示例仅提供项目骨架，暂无静态页面。做同款后由 Agent 补充内容。",
    "close": "关闭",
    "exampleStarted": "已开新对话并发送示例草稿",
    "agentStarted": "✓ 已拉起 Agent 新会话",
    "startFailed": "启动失败：",
    "draftPrefix": "；草稿：",
    "workflowFailed": "工作流启动失败: ",
    "refreshed": "✓ 列表已更新",
    "workspace": "工作区 · ",
    "loadFailed": "加载失败：",
    "justOpened": "刚刚打开",
    "openedRelative": "{time}打开",
    "relativeFallback": "{count}{unit}前",
    "minute": "分钟",
    "hour": "小时",
    "day": "天",
    "weekUnit": "周",
    "monthUnit": "个月",
    "year": "年",
    "boards": "{count} 画板",
    "pages": "{count} 页",
    "scenes": "{count} 场景",
    "components": "{count} 组件",
    "sheets": "{count} 报表",
    "elements": "{count} 要素",
    "worksheets": "{count} 工作表",
    "tabs": "{count} 标签页",
    "dashboard": "看板",
    "whiteboard": "白板",
    "freePage": "自由页面",
    "samplePresentation": "示例演示",
    "renameDescription": "为「{title}」设置新的标题：",
    "renamed": "已重命名为「{title}」",
    "deleteTitle": "移除“{title}”？",
    "deleted": "已移入回收站“{title}”。",
    "removed": "已从作品里移除“{title}”，文件夹还在原处。",
    "createTitle": "新建「{title}」",
    "allWorksCount": "全部作品 ({count})",
    "remixSent": "✓ 已开新对话并发送同款草稿（{outcome}）",
    "workflowSent": "✓ 已开新对话并发送工作流草稿（{outcome}）",
    "languageButton": "EN",
    "previewTitle": "{title}预览",
    "dsUniqueTitle": "当前工作区已有设计系统",
    "dsUniqueDesc": "建议全项目统一复用同一套设计系统（{title}）。你可以直接打开已有设计系统，或确认再新建一套。",
    "dsOpenExisting": "打开已有设计系统",
    "dsCreateAnyway": "仍然新建",
    "runtimePreparing": "正在准备 Open Artifact 运行时",
    "runtimeProgress": "已下载 {received} / {total}，仅首次需要",
    "runtimeRetry": "重试下载",
    "runtimeImportOffline": "导入本地 .tgz 安装包",
    "runtimeImportByPath": "或输入本地 .tgz 路径导入",
    "runtimeImportPathPlaceholder": "/path/to/@open-artifact-cli-0.14.7.tgz",
    "runtimeImportBtn": "导入并校验",
    "runtimeReady": "✓ Open Artifact 运行时已就绪",
    "runtimeImportFailed": "离线导入失败：",
    "l1Banner": "评论已暂存，将在下次 Agent 对话或运行指令时读取",
    "l1CopyComments": "复制评论指令发给 Agent",
    "l1CommentCopied": "✓ 评论读取指令已复制，可直接发送给 Agent",
    "legacyTitle": "旧版作品兼容提示",
    "legacyDesc": "打开老作品「{title}」时检测到格式差异（原磁盘文件字节未修改）：{error}",
    "legacyAgentConvert": "让 Agent 协助转换升级",
    "legacyReadonlyPreview": "只读预览",
    "legacyShowPath": "查看目录路径",
    "legacyPathCopied": "路径已复制：{root}",
    "unknownTypeTitle": "类型未安装（{type}）",
    "unknownTypeDesc": "该作品依赖的自定义类型未安装或不可用。路径：{root}",
    "unknownTypeMeta": "类型：{type} · UID：{uid} · 来源：{source}",
    "openTypesManager": "前往类型管理",
    "copyPath": "复制路径",
    "typeDisabledTitle": "类型「{type}」已停用",
    "typeDisabledDesc": "请先在类型管理中重新启用该类型后再打开。",
    "typesManagerTitle": "类型与运行时管理",
    "typesInstallTitle": "安装 .oatype 自定义类型包",
    "typesInstallPathPlaceholder": "输入本地 .oatype 路径",
    "typesPreviewBtn": "预览权限与信息",
    "typesConfirmInstall": "确认安装",
    "typesTrustProject": "信任当前项目类型",
    "typesTrusted": "项目已信任",
    "typesEnabled": "已启用",
    "typesDisabled": "已停用",
    "runtimeStatusLabel": "运行时状态",
    "runtimeReadyShort": "已就绪（{source} · v{version}）",
    "runtimeMissingShort": "未安装或下载中"
  },
  "en": {
    "works": "Projects",
    "searchPlaceholder": "Search projects (/)",
    "search": "Search projects",
    "clearSearch": "Clear search",
    "sortFilter": "Sort and filter",
    "switchView": "Switch view",
    "refresh": "Refresh list",
    "typesBtn": "Types",
    "new": "Create",
    "examples": "Official examples",
    "workflows": "Workflows",
    "allWorks": "All projects",
    "back": "← Projects",
    "popOut": "Open separately ↗",
    "language": "Switch language",
    "undo": "Undo",
    "restored": "Project restored",
    "restoreFailed": "Restore failed: ",
    "listView": "Switch to list view",
    "gridView": "Switch to grid view",
    "noMatches": "No matching projects",
    "noWorks": "No projects yet",
    "clearHint": "Try clearing your search or filters.",
    "emptyHint": "Artifacts created with Open Artifact appear here. Choose a type above to get started.",
    "clearFilters": "Clear filters",
    "projectPreview": "Project preview",
    "missing": "Files missing",
    "typeMissingBadge": "Type not installed",
    "typeDisabledBadge": "Type disabled",
    "opening": "Opening…",
    "more": "More actions",
    "unpin": "Unpin",
    "pin": "Pin",
    "cannotOpen": "Cannot open: ",
    "unknownError": "Unknown error",
    "openFailed": "Open failed: ",
    "rename": "Rename",
    "recreate": "Remix",
    "copyLink": "Copy link",
    "forget": "Forget project",
    "delete": "Delete",
    "draftCopied": "Draft copied. Paste it to your agent: ",
    "remixFailed": "Remix failed: ",
    "forgotten": "Project record removed",
    "forgetFailed": "Could not remove record: ",
    "linkCopied": "Link copied to clipboard",
    "linkFailed": "Could not get link",
    "renameTitle": "Rename project",
    "cancel": "Cancel",
    "save": "Save",
    "renameFailed": "Rename failed: ",
    "deleteKeepDefault": "By default this only removes “{title}” from the library list. Its folder stays on disk:",
    "deleteAlsoMove": "Also move the artifact folder to local trash (10s undo)",
    "deleteFailed": "Delete failed: ",
    "copyPrompt": "📋 Copy agent prompt",
    "createBlank": "✨ Create blank & open",
    "askAgentCreate": "🤖 Ask Agent to create",
    "promptCopied": "✓ Prompt copied. Send it to your agent.",
    "copyFailed": "Copy failed. Copy this manually: ",
    "createFailed": "Create failed: ",
    "sortOpened": "Recently opened",
    "sortUpdated": "Recently modified",
    "sortCreated": "Creation time",
    "sortName": "Name",
    "any": "Any",
    "today": "Today",
    "yesterday": "Yesterday",
    "week": "Last 7 days",
    "month": "Last 30 days",
    "shared": "Shared",
    "private": "Private",
    "sortBy": "Sort by",
    "type": "Type",
    "selectedSuffix": " selected",
    "openedAt": "Opened",
    "sharing": "Sharing",
    "pinned": "Pinned",
    "preview": "Preview",
    "exampleSkeleton": "This example provides a project scaffold without a static page. Remix it to have your agent add content.",
    "close": "Close",
    "exampleStarted": "Example draft sent to a new chat",
    "agentStarted": "✓ Launched new agent chat",
    "startFailed": "Start failed: ",
    "draftPrefix": "; draft: ",
    "workflowFailed": "Workflow failed: ",
    "refreshed": "✓ List updated",
    "workspace": "Workspace · ",
    "loadFailed": "Load failed: ",
    "justOpened": "Opened just now",
    "openedRelative": "Opened {time}",
    "relativeFallback": "{count} {unit} ago",
    "minute": "minutes",
    "hour": "hours",
    "day": "days",
    "weekUnit": "weeks",
    "monthUnit": "months",
    "year": "years",
    "boards": "{count} artboards",
    "pages": "{count} pages",
    "scenes": "{count} scenes",
    "components": "{count} components",
    "sheets": "{count} reports",
    "elements": "{count} items",
    "worksheets": "{count} sheets",
    "tabs": "{count} tabs",
    "dashboard": "Dashboard",
    "whiteboard": "Whiteboard",
    "freePage": "Page",
    "samplePresentation": "Sample presentation",
    "renameDescription": "Set a new title for “{title}”:",
    "renamed": "Renamed to “{title}”",
    "deleteTitle": "Remove “{title}”?",
    "deleted": "Moved “{title}” to trash.",
    "removed": "Removed “{title}” from projects. Its folder stays on disk.",
    "createTitle": "Create “{title}”",
    "allWorksCount": "All projects ({count})",
    "remixSent": "✓ Remix draft sent to a new chat ({outcome})",
    "workflowSent": "✓ Workflow draft sent to a new chat ({outcome})",
    "languageButton": "中",
    "previewTitle": "{title} preview",
    "dsUniqueTitle": "Design system already exists",
    "dsUniqueDesc": "We recommend reusing the single workspace design system ({title}). Open it directly or confirm to create another.",
    "dsOpenExisting": "Open existing",
    "dsCreateAnyway": "Create anyway",
    "runtimePreparing": "Preparing Open Artifact Runtime",
    "runtimeProgress": "Downloaded {received} / {total} (first time only)",
    "runtimeRetry": "Retry download",
    "runtimeImportOffline": "Import local .tgz package",
    "runtimeImportByPath": "Or enter local .tgz file path",
    "runtimeImportPathPlaceholder": "/path/to/@open-artifact-cli-0.14.7.tgz",
    "runtimeImportBtn": "Import & verify",
    "runtimeReady": "✓ Open Artifact runtime ready",
    "runtimeImportFailed": "Offline import failed: ",
    "l1Banner": "Comments are saved locally and will be read on the next Agent turn or command.",
    "l1CopyComments": "Copy comment instruction for Agent",
    "l1CommentCopied": "✓ Comment prompt copied for Agent",
    "legacyTitle": "Legacy Artifact Compatibility",
    "legacyDesc": "Schema mismatch opening legacy artifact “{title}” (original files left untouched): {error}",
    "legacyAgentConvert": "Ask Agent to convert",
    "legacyReadonlyPreview": "Read-only preview",
    "legacyShowPath": "Copy folder path",
    "legacyPathCopied": "Path copied: {root}",
    "unknownTypeTitle": "Type not installed ({type})",
    "unknownTypeDesc": "This artifact requires an uninstalled custom type. Path: {root}",
    "unknownTypeMeta": "Type: {type} · UID: {uid} · Source: {source}",
    "openTypesManager": "Open Types Manager",
    "copyPath": "Copy path",
    "typeDisabledTitle": "Type “{type}” is disabled",
    "typeDisabledDesc": "Enable this type in Types Manager before opening.",
    "typesManagerTitle": "Types & Runtime Manager",
    "typesInstallTitle": "Install .oatype custom type",
    "typesInstallPathPlaceholder": "Local .oatype path",
    "typesPreviewBtn": "Preview manifest & permissions",
    "typesConfirmInstall": "Confirm install",
    "typesTrustProject": "Trust project types",
    "typesTrusted": "Project trusted",
    "typesEnabled": "Enabled",
    "typesDisabled": "Disabled",
    "runtimeStatusLabel": "Runtime status",
    "runtimeReadyShort": "Ready ({source} · v{version})",
    "runtimeMissingShort": "Not installed or downloading"
  }
};

for (const skill of SKILLS) {
  GALLERY_STR.zh['skill.' + skill.id + '.name'] = skill.name;
  GALLERY_STR.zh['skill.' + skill.id + '.about'] = skill.about;
  GALLERY_STR.zh['skill.' + skill.id + '.prompt'] = skill.prompt;
  GALLERY_STR.en['skill.' + skill.id + '.name'] = skill.nameEn;
  GALLERY_STR.en['skill.' + skill.id + '.about'] = skill.aboutEn;
  GALLERY_STR.en['skill.' + skill.id + '.prompt'] = skill.promptEn;
}
for (const [index, recipe] of RECIPES.entries()) {
  const [title, desc] = [
    ["Design system → Unified projects", "Build a design system, then create slides with its tokens."],
    ["Canvas concepts → Motion demo", "Explore canvas concepts, choose one, then animate it."],
    ["Data → Dashboard → Report", "Build a data dashboard, then create a presentation."],
    ["Canvas exploration → Design system", "Explore visual directions, then capture a reusable design system."],
  ][index];
  GALLERY_STR.zh['recipe.' + recipe.id + '.title'] = recipe.title;
  GALLERY_STR.zh['recipe.' + recipe.id + '.desc'] = recipe.desc;
  GALLERY_STR.en['recipe.' + recipe.id + '.title'] = title;
  GALLERY_STR.en['recipe.' + recipe.id + '.desc'] = desc;
}
const EXAMPLE_EN = {
  "design": [
    "Single-page canvas",
    "Start an editable canvas with a blue background and a centered heading.",
    "880 × 560 canvas, blue background, large centered heading, editable DC component",
  ],
  "slides": [
    "Presentation cover",
    "Start a presentation with a dark background and a bold heading.",
    "Dark cover, large centered heading, expandable slide order",
  ],
  "design-system": [
    "Brand design system",
    "Establish brand guidelines from tokens and a project scaffold.",
    "Brand colors, typography, spacing tokens, and component guidelines",
  ],
};
for (const example of OFFICIAL_EXAMPLES) {
  for (const [index, field] of ['title', 'desc', 'points'].entries()) {
    GALLERY_STR.zh['example.' + example.id + '.' + field] = example[field];
    GALLERY_STR.en['example.' + example.id + '.' + field] = EXAMPLE_EN[example.id]?.[index] || example[field];
  }
}

function galleryHtml(requestedLang = 'zh', requestedScheme = '') {
  const initialLang = requestedLang === 'en' ? 'en' : 'zh';
  const hostSchemeValue = requestedScheme === 'dark' || requestedScheme === 'light' ? requestedScheme : hostScheme();
  const text = (key) => GALLERY_STR[initialLang][key];
  return `<!doctype html>
<html data-i18n-pending lang="${initialLang === 'en' ? 'en' : 'zh-CN'}" data-initial-lang="${initialLang}"${hostSchemeValue ? ` data-host-scheme="${hostSchemeValue}"` : ''}>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${text('works')} · Orca-Design</title>
<script>
try {
  const requested = new URLSearchParams(location.search).get('lang');
  const saved = localStorage.getItem('ps_lang');
  const selected = ['zh', 'en'].includes(requested) ? requested : ['zh', 'en'].includes(saved) ? saved : 'zh';
  document.documentElement.lang = selected === 'en' ? 'en' : 'zh-CN';
} catch {}
</script>
<style>
html[data-i18n-pending] body { visibility: hidden; }
:root {
  color-scheme: light dark;
  --dsw-alias-bg-base: light-dark(#ffffff, #18181b);
  --dsw-alias-bg-skeleton: light-dark(#f4f4f5, #27272a);
  --dsw-alias-border-l1: light-dark(#e4e4e7, #3f3f46);
  --dsw-alias-border-l2: light-dark(rgba(0,0,0,0.09), rgba(255,255,255,0.1));
  --dsw-alias-interactive-bg-hover: light-dark(rgba(0,0,0,0.05), rgba(255,255,255,0.06));
  --dsw-alias-label-primary: light-dark(#18181b, #f4f4f5);
  --dsw-alias-label-secondary: light-dark(#52525b, #a1a1aa);
  --dsw-alias-label-tertiary: light-dark(#71717a, #82828c);
  --dsw-alias-label-caption: light-dark(#a1a1aa, #52525b);
  --dsw-alias-state-business-primary: light-dark(#1d64f2, #3b82f6);
  --dsw-alias-state-error-primary: light-dark(#dc2626, #ef4444);
  --dsw-alias-state-warn-primary: light-dark(#d97706, #f59e0b);
  --dsw-focus-ring-color: light-dark(#1d64f2, #3b82f6);
  --dsw-focus-ring-width: 2px;
}
* { box-sizing: border-box; margin: 0; padding: 0; }
body {
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
  background: var(--dsw-alias-bg-base);
  color: var(--dsw-alias-label-primary);
  height: 100vh;
  overflow: hidden;
}
html[data-scheme=dark] { color-scheme: dark; }
html[data-scheme=light] { color-scheme: light; }
.bda-page { position: relative; width: 100%; height: 100%; display: flex; flex-direction: column; overflow: hidden; background: var(--dsw-alias-bg-base); color: var(--dsw-alias-label-primary); font-size: 14px; line-height: 1.6; }
.bda-scroll { flex: 1; min-height: 0; overflow: auto; scrollbar-gutter: stable; }
.bda-content { max-width: 1120px; margin: 0 auto; padding: 0 clamp(24px, 4vw, 48px) 56px; }
.bda-heading { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 12px 16px; padding-top: 28px; margin-bottom: 24px; }
.bda-heading-title { display: flex; align-items: baseline; gap: 12px; }
.bda-heading h1 { margin: 0; font-size: 20px; font-weight: 500; line-height: 28px; }
.bda-heading .bda-ws { font-size: 13px; color: var(--dsw-alias-label-tertiary); }
.bda-tools { display: flex; align-items: center; gap: 6px; margin-left: auto; }
.bda-tool { position: relative; display: inline-flex; align-items: center; justify-content: center; width: 32px; height: 32px; padding: 0; border: 0; border-radius: 8px; background: none; color: var(--dsw-alias-label-secondary); cursor: pointer; }
.bda-tool:hover, .bda-tool[aria-expanded=true] { background: var(--dsw-alias-interactive-bg-hover); color: var(--dsw-alias-label-primary); }
.bda-tool[data-active=true]::after { content: ""; position: absolute; top: 6px; right: 6px; width: 6px; height: 6px; border-radius: 50%; background: var(--dsw-alias-state-business-primary); }
.bda-search { display: flex; align-items: center; gap: 6px; width: min(240px, 50vw); height: 32px; padding: 0 8px 0 10px; border: .5px solid var(--dsw-alias-border-l2); border-radius: 8px; color: var(--dsw-alias-label-tertiary); }
.bda-search:focus-within { border-color: var(--dsw-alias-state-business-primary); }
.bda-search input { flex: 1; min-width: 0; height: 100%; border: 0; padding: 0; background: none; color: var(--dsw-alias-label-primary); font: inherit; font-size: 13px; outline: none; }
.bda-search input::placeholder { color: var(--dsw-alias-label-caption); }
.bda-search button { display: inline-flex; align-items: center; justify-content: center; width: 22px; height: 22px; margin-right: -4px; padding: 0; border: 0; border-radius: 6px; background: none; color: inherit; cursor: pointer; }
.bda-section-title { margin: 0 0 12px; font-size: 13px; font-weight: 400; line-height: 20px; color: var(--dsw-alias-label-tertiary); display: flex; align-items: center; justify-content: space-between; }
.bda-tiles { display: grid; grid-template-columns: repeat(auto-fill, minmax(106px, 1fr)); gap: 12px; margin: 0 0 32px; padding: 0; list-style: none; }
.bda-tile { display: flex; flex-direction: column; gap: 8px; width: 100%; padding: 0; border: 0; background: none; color: inherit; font: inherit; text-align: left; cursor: pointer; }
.bda-tile-art { position: relative; display: flex; align-items: center; justify-content: center; aspect-ratio: 7/5; border-radius: 14px; overflow: hidden; background: color-mix(in srgb, var(--bda-tint) 22%, var(--dsw-alias-bg-base)); color: color-mix(in srgb, var(--bda-tint) 78%, var(--dsw-alias-label-primary)); transition: background-color .15s; }
.bda-tile:hover .bda-tile-art { background: color-mix(in srgb, var(--bda-tint) 34%, var(--dsw-alias-bg-base)); }
.bda-tile-squiggle { position: absolute; inset: 0; width: 100%; height: 100%; opacity: .28; }
.bda-tile-label { padding-left: 2px; font-size: 13px; line-height: 18px; }
.bda-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(260px, 1fr)); gap: 20px; margin: 0; padding: 0; list-style: none; }
.bda-skeleton-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(260px, 1fr)); gap: 20px; }
.bda-skel-card { height: 196px; border-radius: 14px; background: var(--dsw-alias-bg-skeleton); animation: pulse 1.2s ease-in-out infinite; }
@keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: .55; } }
.bda-item { position: relative; min-width: 0; }
.bda-card { display: flex; flex-direction: column; width: 100%; padding: 0; border: .5px solid var(--dsw-alias-border-l2); border-radius: 14px; overflow: hidden; background: var(--dsw-alias-bg-base); color: inherit; font: inherit; text-align: left; cursor: pointer; transition: background-color .15s; }
.bda-item:hover .bda-card { background: var(--dsw-alias-interactive-bg-hover); }
.bda-card:disabled { cursor: default; }
.bda-preview { position: relative; display: block; width: 100%; aspect-ratio: 2/1; overflow: hidden; background: color-mix(in srgb, var(--bda-tint) 16%, var(--dsw-alias-bg-base)); }
.bda-thumb { position:absolute; inset:0; width:100%; height:100%; object-fit:cover; }
.bda-live { position:absolute; inset:0; width:1280px; height:800px; transform-origin:0 0; border:0; background:transparent; pointer-events:none; opacity:0; transition:opacity .35s; }
.bda-live.on { opacity:1; }
.bda-item.bda-missing .bda-card, .bda-item.bda-missing .bda-row { opacity:.55; }
.bda-missing-badge { position:absolute; left:8px; top:8px; z-index:3; font-size:11px; line-height:16px; padding:2px 8px; border-radius:999px; background:var(--dsw-alias-state-error-primary); color:#fff; }
.bda-warn-badge { position:absolute; left:8px; top:8px; z-index:3; font-size:11px; line-height:16px; padding:2px 8px; border-radius:999px; background:var(--dsw-alias-state-warn-primary); color:#fff; }
.bda-sheet { position: absolute; left: 12%; right: 12%; top: 13%; bottom: -8px; border-radius: 8px 8px 0 0; overflow: hidden; background: var(--dsw-alias-bg-base); box-shadow: 0 0 0 .5px var(--dsw-alias-border-l2), 0 6px 18px -8px rgba(0,0,0,.28); transition: transform .2s; }
.bda-item:hover .bda-sheet { transform: translateY(-3px); }
.bda-slide, .bda-film, .bda-paper { position: absolute; inset: 0; display: flex; flex-direction: column; padding: 14px 16px; overflow: hidden; }
.bda-paper-title, .bda-film-title { font-size: 12px; font-weight: 600; line-height: 1.3; color: var(--dsw-alias-label-primary); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.bda-line { margin-top: auto; width: 48%; height: 4px; border-radius: 2px; background: color-mix(in srgb, var(--bda-tint) 60%, var(--dsw-alias-bg-base)); }
.bda-boards, .bda-swatches, .bda-kpis { display: flex; gap: 6px; margin-top: auto; }
.bda-board { flex: 1; height: 28px; border-radius: 4px; border: 1px dashed var(--dsw-alias-border-l1); background: var(--dsw-alias-interactive-bg-hover); }
.bda-swatch { width: 16px; height: 16px; border-radius: 50%; background: var(--bda-tint); }
.bda-swatch:nth-child(2) { opacity: .6; }
.bda-swatch:nth-child(3) { opacity: .3; }
.bda-kpi { flex: 1; height: 24px; border-radius: 4px; background: var(--dsw-alias-interactive-bg-hover); border: .5px solid var(--dsw-alias-border-l2); }
.bda-film { background: #111; color: #fff; align-items: center; justify-content: center; }
.bda-film-title { color: #eee; width: 100%; text-align: center; margin-bottom: 4px; }
.bda-film-bar { position: absolute; left: 0; right: 0; bottom: 0; height: 4px; background: var(--bda-tint); }
.bda-busy { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; gap: 8px; background: rgba(0,0,0,.6); color: #fff; font-size: 12px; font-weight: 500; }
.bda-spinner { width: 12px; height: 12px; border: 1.5px solid currentColor; border-top-color: transparent; border-radius: 50%; animation: spin .7s linear infinite; display:inline-block; }
@keyframes spin { to { transform: rotate(360deg); } }
.bda-info { display: flex; align-items: center; gap: 10px; padding: 10px 14px 12px; min-width: 0; }
.bda-glyph { flex: none; display: inline-flex; align-items: center; justify-content: center; width: 24px; height: 24px; color: var(--bda-tint); }
.bda-text { flex: 1; min-width: 0; display: flex; flex-direction: column; }
.bda-name { font-size: 13px; font-weight: 500; line-height: 18px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.bda-meta { font-size: 12px; line-height: 16px; color: var(--dsw-alias-label-tertiary); margin-top: 1px; }
.bda-actions { position: absolute; top: 8px; right: 8px; display: flex; align-items: center; gap: 4px; opacity: 0; transition: opacity .15s; }
.bda-item:hover .bda-actions, .bda-item[data-menu="true"] .bda-actions, .bda-item:focus-within .bda-actions { opacity: 1; }
.bda-act { display: inline-flex; align-items: center; justify-content: center; width: 28px; height: 28px; padding: 0; border: 0; border-radius: 7px; background: var(--dsw-alias-bg-base); box-shadow: 0 1px 3px rgba(0,0,0,.15); color: var(--dsw-alias-label-secondary); cursor: pointer; }
.bda-act[data-on=true] { opacity: 1; color: var(--dsw-alias-state-business-primary); }
.bda-list { display: flex; flex-direction: column; gap: 6px; margin: 0; padding: 0; list-style: none; }
.bda-row { display: flex; align-items: center; gap: 12px; width: 100%; padding: 8px 12px; border: .5px solid var(--dsw-alias-border-l2); border-radius: 10px; background: var(--dsw-alias-bg-base); color: inherit; font: inherit; text-align: left; cursor: pointer; }
.bda-row:hover { background: var(--dsw-alias-interactive-bg-hover); }
.bda-row .bda-name { flex: 1; min-width: 0; }
.bda-row .bda-meta { flex: none; margin-left: 16px; font-size: 12px; color: var(--dsw-alias-label-tertiary); }
.bda-row-tools { position: absolute; right: 12px; top: 50%; transform: translateY(-50%); display: flex; align-items: center; gap: 4px; }
.bda-menu { position: fixed; z-index: 1000; min-width: 210px; padding: 6px; border: .5px solid var(--dsw-alias-border-l2); border-radius: 12px; background: var(--dsw-alias-bg-base); box-shadow: 0 8px 28px -6px rgba(0,0,0,.28); font-size: 14px; }
.bda-menu-item { display: flex; align-items: center; gap: 10px; width: 100%; min-height: 34px; padding: 5px 10px; border: 0; border-radius: 8px; background: none; color: var(--dsw-alias-label-primary); font: inherit; text-align: left; white-space: nowrap; cursor: pointer; }
.bda-menu-item:hover { background: var(--dsw-alias-interactive-bg-hover); }
.bda-menu-item[data-danger=true] { color: var(--dsw-alias-state-error-primary); }
.bda-menu-label { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; }
.bda-menu-value, .bda-menu-count { margin-left: 16px; color: var(--dsw-alias-label-tertiary); }
.bda-menu-key { margin-left: 20px; color: var(--dsw-alias-label-tertiary); font: inherit; font-size: 12px; }
.bda-menu-rule { height: .5px; margin: 6px 4px; background: var(--dsw-alias-border-l2); }
.bda-menu-row { position: relative; }
.bda-submenu { position: absolute; left: calc(100% + 8px); top: -6px; z-index: 1001; min-width: 190px; max-height: 360px; overflow: auto; padding: 6px; border: .5px solid var(--dsw-alias-border-l2); border-radius: 12px; background: var(--dsw-alias-bg-base); box-shadow: 0 8px 28px -6px rgba(0,0,0,.28); display: none; }
.bda-menu-row:hover .bda-submenu { display: block; }
.bda-check { flex: none; display: inline-flex; align-items: center; justify-content: center; width: 18px; height: 18px; border: 1px solid var(--dsw-alias-border-l1); border-radius: 5px; color: transparent; }
.bda-check[data-on=true] { border-color: var(--dsw-alias-state-business-primary); background: var(--dsw-alias-state-business-primary); color: #fff; }
.bda-tick { flex: none; margin-left: 16px; color: var(--dsw-alias-state-business-primary); }
.bda-scrim { position: fixed; inset: 0; z-index: 1100; display: flex; align-items: center; justify-content: center; padding: 24px; background: rgba(0,0,0,.36); }
.bda-dialog { width: min(520px, 100%); max-height: 88vh; overflow: auto; padding: 20px; border-radius: 16px; background: var(--dsw-alias-bg-base); box-shadow: 0 18px 48px -12px rgba(0,0,0,.4); }
.bda-dialog h2 { margin: 0 0 12px; font-size: 16px; font-weight: 600; line-height: 24px; }
.bda-dialog p { margin: 0 0 14px; color: var(--dsw-alias-label-secondary); font-size: 13px; line-height: 1.65; max-width: 36em; }
.bda-dialog input[type=text], .bda-dialog input:not([type]) { width: 100%; height: 38px; padding: 0 12px; border: 1px solid var(--dsw-alias-border-l2); border-radius: 10px; background: none; color: var(--dsw-alias-label-primary); font: inherit; outline: none; margin-bottom: 14px; }
.bda-dialog-actions { display: flex; flex-wrap: wrap; justify-content: flex-end; gap: 8px; margin-top: 12px; }
.bda-btn { height: 34px; padding: 0 14px; border: 0; border-radius: 9px; background: var(--dsw-alias-interactive-bg-hover); color: var(--dsw-alias-label-primary); font: inherit; font-size: 13px; font-weight: 500; cursor: pointer; display: inline-flex; align-items: center; gap: 6px; }
.bda-btn:hover { background: color-mix(in srgb, var(--dsw-alias-label-primary) 12%, var(--dsw-alias-bg-base)); }
.bda-btn[data-primary=true] { background: var(--dsw-alias-state-business-primary); color: #fff; }
.bda-btn[data-danger=true] { border: 1px solid var(--dsw-alias-state-error-primary); background: color-mix(in srgb, var(--dsw-alias-state-error-primary) 10%, var(--dsw-alias-bg-base)); color: var(--dsw-alias-state-error-primary); }
.bda-toast { position: fixed; left: 50%; bottom: 24px; z-index: 1200; display: flex; align-items: center; gap: 10px; max-width: min(560px, calc(100% - 32px)); padding: 9px 12px 9px 14px; border: .5px solid var(--dsw-alias-border-l2); border-radius: 12px; background: var(--dsw-alias-bg-base); box-shadow: 0 8px 28px -6px rgba(0,0,0,.28); transform: translateX(-50%); font-size: 13px; }
.bda-toast-undo { padding: 2px 8px; border: 0; border-radius: 6px; background: none; color: var(--dsw-alias-state-business-primary); font: inherit; font-weight: 500; cursor: pointer; }
.bda-toast-close { display: inline-flex; align-items: center; justify-content: center; width: 20px; height: 20px; padding: 0; border: 0; background: none; color: var(--dsw-alias-label-tertiary); cursor: pointer; }
.bda-empty { display: flex; flex-direction: column; align-items: center; gap: 8px; padding: 48px 20px; text-align: center; color: var(--dsw-alias-label-tertiary); }
#examples { grid-template-columns: repeat(auto-fit, minmax(min(230px, 100%), 1fr)); }
.bda-example { display:flex; flex-direction:column; gap:10px; padding:16px; border:1px solid var(--dsw-alias-border-l2); border-radius:14px; }
.bda-example h3 { margin:0; font-size:14px; font-weight:500; }
.bda-example p { margin:0; font-size:12px; line-height:1.6; color:var(--dsw-alias-label-secondary); }
.bda-example-skill { display:flex; align-items:center; gap:6px; font-size:12px; color:var(--dsw-alias-label-tertiary); }
.bda-example-actions { display:flex; flex-wrap:wrap; gap:8px; margin-top:auto; }
.bda-example-preview { overflow:hidden; width:100%; background:var(--dsw-alias-bg-skeleton); border-radius:8px; margin-bottom:12px; }
.bda-example-preview iframe { width:880px; height:560px; border:0; transform-origin:top left; }
.bda-recipe-desc { font-size:12px; color:var(--dsw-alias-label-tertiary); line-height:1.5; }
#editorView { display: flex; flex-direction: column; width: 100vw; height: 100vh; position: absolute; inset: 0; z-index: 500; background: var(--dsw-alias-bg-base); }
.editor-bar { display: flex; align-items: center; gap: 10px; padding: 8px 16px; border-bottom: .5px solid var(--dsw-alias-border-l2); background: var(--dsw-alias-bg-base); flex: none; }
.editor-bar .title { font-size: 13px; font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; flex: 1; }
.l1-banner { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 6px 16px; font-size: 12px; background: color-mix(in srgb, var(--dsw-alias-state-business-primary) 10%, var(--dsw-alias-bg-base)); border-bottom: .5px solid var(--dsw-alias-border-l2); color: var(--dsw-alias-label-primary); }
#frame { flex: 1; border: 0; width: 100%; height: 100%; background: var(--dsw-alias-bg-base); }
.runtime-wait { flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 14px; padding: 32px; text-align: center; }
.runtime-bar-wrap { width: min(420px, 90%); height: 8px; border-radius: 999px; background: var(--dsw-alias-bg-skeleton); overflow: hidden; }
.runtime-bar-fill { height: 100%; background: var(--dsw-alias-state-business-primary); transition: width .2s ease; }
.type-row { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 10px 12px; border: .5px solid var(--dsw-alias-border-l2); border-radius: 10px; margin-bottom: 8px; }
.type-row-meta { font-size: 12px; color: var(--dsw-alias-label-tertiary); }
.hidden { display: none !important; }
</style>
</head>
<body>

<div class="bda-page" id="listView">
  <div class="bda-scroll">
    <div class="bda-content">
      <div class="bda-heading">
        <div class="bda-heading-title">
          <h1 data-i18n="works">${text('works')}</h1>
          <span class="bda-ws" id="wsLabel"></span>
        </div>
        <div class="bda-tools">
          <button type="button" class="bda-btn" id="typesBtn" data-i18n="typesBtn">${text('typesBtn')}</button>
          <button type="button" class="bda-btn" id="languageBtn" data-i18n-title="language" title="${text('language')}">${text('languageButton')}</button>
          <div class="bda-search">
            <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.3"><circle cx="7" cy="7" r="4.5"/><path d="m10.5 10.5 3 3"/></svg>
            <input id="q" data-i18n-placeholder="searchPlaceholder" placeholder="${text('searchPlaceholder')}" data-i18n-label="search" aria-label="${text('search')}">
            <button id="clearSearch" class="hidden" data-i18n-title="clearSearch" title="${text('clearSearch')}">
              <svg viewBox="0 0 16 16" width="12" height="12" stroke="currentColor" stroke-width="1.3"><path d="m4.5 4.5 7 7m0-7-7 7"/></svg>
            </button>
          </div>
          <button class="bda-tool" id="filterBtn" data-i18n-title="sortFilter" title="${text('sortFilter')}">
            <svg viewBox="0 0 16 16" width="16" height="16" stroke="currentColor" stroke-width="1.3"><path d="M2.5 4.5h11M4.5 8h7M6.5 11.5h3"/></svg>
          </button>
          <button class="bda-tool" id="viewModeBtn" data-i18n-title="switchView" title="${text('switchView')}">
            <svg id="viewModeIcon" viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.3"></svg>
          </button>
          <button class="bda-tool" id="reloadBtn" data-i18n-title="refresh" title="${text('refresh')}">
            <svg viewBox="0 0 16 16" width="15" height="15" stroke="currentColor" stroke-width="1.3" fill="none"><path d="M13.5 8a5.5 5.5 0 1 1-1.6-3.9L14 6m0-4v4h-4"/></svg>
          </button>
        </div>
      </div>

      <div class="bda-section-title" data-i18n="new">${text('new')}</div>
      <ul class="bda-tiles" id="tiles"></ul>

      <div class="bda-section-title" data-i18n="examples">${text('examples')}</div>
      <ul class="bda-tiles" id="examples"></ul>

      <div class="bda-section-title" data-i18n="workflows">${text('workflows')}</div>
      <ul class="bda-tiles" id="recipes" style="grid-template-columns:repeat(auto-fill,minmax(230px,1fr))"></ul>

      <div class="bda-section-title" id="listHeading" data-i18n="allWorks">${text('allWorks')}</div>
      <div id="container">
        <div class="bda-skeleton-grid"><div class="bda-skel-card"></div><div class="bda-skel-card"></div><div class="bda-skel-card"></div></div>
      </div>
    </div>
  </div>
</div>

<div id="editorView" class="hidden">
  <div class="editor-bar">
    <button class="bda-btn" id="backBtn" data-i18n="back">${text('back')}</button>
    <span class="title" id="editorTitle"></span>
    <button class="bda-btn" id="popBtn" data-i18n="popOut">${text('popOut')}</button>
  </div>
  <div id="l1Banner" class="l1-banner hidden">
    <span data-i18n="l1Banner">${text('l1Banner')}</span>
    <button type="button" class="bda-btn" id="copyCommentsBtn" data-i18n="l1CopyComments">${text('l1CopyComments')}</button>
  </div>
  <div id="runtimeWait" class="runtime-wait hidden">
    <div style="display:flex;align-items:center;gap:10px;font-size:15px;font-weight:600">
      <span class="bda-spinner"></span>
      <span id="runtimeWaitTitle">${text('runtimePreparing')}</span>
    </div>
    <div class="runtime-bar-wrap"><div class="runtime-bar-fill" id="runtimeWaitBar" style="width:0%"></div></div>
    <p id="runtimeWaitText" style="font-size:13px;color:var(--dsw-alias-label-secondary)"></p>
    <div style="display:flex;flex-wrap:wrap;gap:8px;justify-content:center">
      <button type="button" class="bda-btn" data-primary="true" id="runtimeRetryBtn">${text('runtimeRetry')}</button>
      <label class="bda-btn" style="cursor:pointer">${text('runtimeImportOffline')}<input type="file" id="runtimeFileInput" accept=".tgz,.tar.gz" class="hidden"></label>
    </div>
    <div style="display:flex;gap:8px;width:min(460px,95%);margin-top:4px">
      <input type="text" id="runtimePathInput" placeholder="${text('runtimeImportPathPlaceholder')}" style="flex:1;height:34px;padding:0 10px;border:1px solid var(--dsw-alias-border-l2);border-radius:8px;background:none;color:inherit">
      <button type="button" class="bda-btn" id="runtimePathBtn">${text('runtimeImportBtn')}</button>
    </div>
  </div>
  <iframe id="frame" allow="clipboard-read; clipboard-write"></iframe>
</div>

<div id="dialogScrim" class="bda-scrim hidden"></div>
<div id="toast" class="hidden"></div>
<div id="menuLayer"></div>

<script type="module">
import { embedArtifact } from '/vendor/harness-embed.mjs';

const STR = ${JSON.stringify(GALLERY_STR).replace(/</g, '\\u003c')};
const INITIAL_LANG = ${JSON.stringify(initialLang)};
function readPreference(key) { try { return localStorage.getItem(key); } catch { return null; } }
function writePreference(key, value) { try { localStorage.setItem(key, value); } catch {} }
const requestedLang = new URLSearchParams(location.search).get('lang');
const rememberedLang = readPreference('ps_lang');
let lang = Object.hasOwn(STR, requestedLang) ? requestedLang : Object.hasOwn(STR, rememberedLang) ? rememberedLang : INITIAL_LANG;
writePreference('ps_lang', lang);
function locale() { return lang === 'en' ? 'en' : 'zh-CN'; }
function t(key, values = {}) {
  const text = STR[lang][key] ?? STR.zh[key] ?? key;
  return text.replace(/\\{(\\w+)\\}/g, (match, name) => String(values[name] ?? match));
}
function skillText(id, field) { return STR[lang]['skill.' + id + '.' + field] ?? id; }
function exampleText(example, field) { return STR[lang]['example.' + example.id + '.' + field] ?? example[field]; }
function recipeText(recipe, field) { return STR[lang]['recipe.' + recipe.id + '.' + field] ?? recipe[field]; }
const TINTS = ${JSON.stringify(TINTS)};
const SKILLS_CONFIG = ${JSON.stringify(SKILLS)};
const SKILL_MAP = Object.fromEntries(SKILLS_CONFIG.map(s => [s.id, s]));
const RECIPES = ${JSON.stringify(RECIPES)};
const OFFICIAL_EXAMPLES = ${JSON.stringify(OFFICIAL_EXAMPLES).replace(/</g, '\\u003c')};
const EXAMPLE_TEMPLATES = ${JSON.stringify(Object.fromEntries(Object.keys(EXAMPLE_TEMPLATES).map((id) => [id, true])))};

function resolvedScheme() {
  return document.documentElement.dataset.scheme || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
}
(() => {
  try {
    const q = new URLSearchParams(location.search).get('scheme');
    const s = q === 'dark' || q === 'light' ? q : '';
    if (s) { localStorage.setItem('ps-scheme', s); localStorage.setItem('ps-scheme-manual', '1'); }
    const saved = s || (localStorage.getItem('ps-scheme-manual') ? localStorage.getItem('ps-scheme') : '');
    const host = document.documentElement.dataset.hostScheme || '';
    const resolved = saved || (host === 'dark' || host === 'light' ? host : '');
    if (resolved) document.documentElement.dataset.scheme = resolved;
  } catch {}
})();

const SVG_ICONS = {
  grid: '<svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.3"><rect x="2.5" y="2.5" width="4.5" height="4.5" rx="1"/><rect x="9" y="2.5" width="4.5" height="4.5" rx="1"/><rect x="2.5" y="9" width="4.5" height="4.5" rx="1"/><rect x="9" y="9" width="4.5" height="4.5" rx="1"/></svg>',
  list: '<svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.3"><path d="M5.75 4h7.75M5.75 8h7.75M5.75 12h7.75"/><path d="M2.5 4h.01M2.5 8h.01M2.5 12h.01" stroke-width="1.8"/></svg>',
  pin: '<svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"><path d="M9.75 2.25 13.75 6.25M10.75 3.25 7 6.25 4.5 6.5 9.5 11.5 9.75 9 12.75 5.25M7 9l-4 4"/></svg>',
  pinFilled: '<svg viewBox="0 0 16 16" width="16" height="16" fill="currentColor" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"><path d="M9.75 2.25 13.75 6.25M10.75 3.25 7 6.25 4.5 6.5 9.5 11.5 9.75 9 12.75 5.25M7 9l-4 4"/></svg>',
  more: '<svg viewBox="0 0 16 16" width="16" height="16" fill="currentColor"><circle cx="3.5" cy="8" r=".8"/><circle cx="8" cy="8" r=".8"/><circle cx="12.5" cy="8" r=".8"/></svg>',
  rename: '<svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.3"><path d="M10.5 3 13 5.5 5.5 13 2.5 13.5 3 10.5 10.5 3Z"/></svg>',
  copy: '<svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.3"><path d="M6.75 9.25a2.5 2.5 0 0 0 3.54 0l2.25-2.25a2.5 2.5 0 0 0-3.54-3.54L8.25 4.2M9.25 6.75a2.5 2.5 0 0 0-3.54 0L3.46 9a2.5 2.5 0 0 0 3.54 3.54l.75-.75"/></svg>',
  trash: '<svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.3"><path d="M2.75 4.25h10.5M6.25 4.25V3a.75.75 0 0 1 .75-.75h2a.75.75 0 0 1 .75.75v1.25M4 4.25l.6 8.6a1 1 0 0 0 1 .9h4.8a1 1 0 0 0 1-.9l.6-8.6M6.75 7v4M9.25 7v4"/></svg>',
  tick: '<svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.5"><path d="m3 8.5 3.25 3.25L13 4.75"/></svg>',
  chevron: '<svg viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor" stroke-width="1.3"><path d="m6 3.5 4.5 4.5L6 12.5"/></svg>',
  info: '<svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.3"><circle cx="8" cy="8" r="6"/><path d="M8 7.5v3.25M8 5.25h.01"/></svg>',
};

function typeIconSvg(skill, size = 18) {
  const p = 'stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"';
  let inner = '';
  switch (skill) {
    case 'slides': case 'claude-slides':
      inner = '<path d="M2.75 3.5h14.5M4 3.5v8.25a1 1 0 0 0 1 1h10a1 1 0 0 0 1-1V3.5M7.25 16.75 10 12.75l2.75 4" ' + p + '/>'; break;
    case 'design': case 'claude-design':
      inner = '<path d="M10 2.75a7.25 7.25 0 1 0 0 14.5c1.1 0 1.75-.8 1.75-1.7 0-.5-.2-.9-.45-1.25-.25-.35-.45-.7-.45-1.15 0-.95.75-1.65 1.7-1.65h1.6a3.1 3.1 0 0 0 3.1-3.1c0-3.1-3.2-5.65-7.25-5.65Z" ' + p + '/><circle cx="6.4" cy="9.4" r=".9" fill="currentColor"/><circle cx="8.8" cy="6.3" r=".9" fill="currentColor"/><circle cx="12.5" cy="6.8" r=".9" fill="currentColor"/>'; break;
    case 'design-system': case 'claude-design-system':
      inner = '<circle cx="6.5" cy="6.5" r="3.25" ' + p + '/><circle cx="13.5" cy="6.5" r="3.25" ' + p + '/><circle cx="10" cy="13" r="3.25" ' + p + '/>'; break;
    case 'whiteboard':
      inner = '<rect x="2.75" y="3.25" width="14.5" height="11.5" rx="2" ' + p + '/><path d="M6 17h8M6.5 8.5l2.5 2 4.5-4" ' + p + '/>'; break;
    case 'sheets':
      inner = '<rect x="3" y="3" width="14" height="14" rx="2" ' + p + '/><path d="M3 7.5h14M3 12h14M8 7.5V17M13 7.5V17" ' + p + '/>'; break;
    case 'data': case 'claude-dashboard':
      inner = '<rect x="2.75" y="10" width="4.5" height="7.25" rx="1" ' + p + '/><rect x="7.75" y="2.75" width="4.5" height="14.5" rx="1" ' + p + '/><rect x="12.75" y="7" width="4.5" height="10.25" rx="1" ' + p + '/>'; break;
    case 'docs':
      inner = '<path d="M5 2.75h7.5L16 6.25v11a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1v-13.5a1 1 0 0 1 1-1Z" ' + p + '/><path d="M7 9.5h6M7 13h4" ' + p + '/>'; break;
    case 'motion': case 'claude-motion':
      inner = '<rect x="2.75" y="4" width="14.5" height="12" rx="2" ' + p + '/><path d="m8.5 7.75 4 2.25-4 2.25v-4.5Z" ' + p + '/>'; break;
    case 'page':
      inner = '<rect x="2.75" y="3.5" width="14.5" height="13" rx="2" ' + p + '/><path d="M2.75 7.25h14.5M8.5 11l-2 2 2 2M11.5 11l2 2-2 2" ' + p + '/>'; break;
    default:
      inner = '<polygon points="10,2.5 16.5,6.5 16.5,13.5 10,17.5 3.5,13.5 3.5,6.5" ' + p + '/>';
  }
  return '<svg viewBox="0 0 20 20" width="' + size + '" height="' + size + '" fill="none" style="display:block;flex:none">' + inner + '</svg>';
}

function drawnHtml(skill, title) {
  const escTitle = esc(title);
  switch (skill) {
    case 'slides': return '<div class="bda-slide"><div class="bda-paper-title">' + escTitle + '</div><div class="bda-line"></div></div>';
    case 'design': return '<div class="bda-paper"><div class="bda-paper-title">' + escTitle + '</div><div class="bda-boards"><div class="bda-board"></div><div class="bda-board"></div></div></div>';
    case 'design-system': return '<div class="bda-paper"><div class="bda-paper-title">' + escTitle + '</div><div class="bda-swatches"><span class="bda-swatch"></span><span class="bda-swatch"></span><span class="bda-swatch"></span></div></div>';
    case 'data': return '<div class="bda-paper"><div class="bda-paper-title">' + escTitle + '</div><div class="bda-kpis"><span class="bda-kpi"></span><span class="bda-kpi"></span></div></div>';
    case 'motion': return '<div class="bda-film"><div class="bda-film-title">' + escTitle + '</div><svg viewBox="0 0 20 20" width="22" height="22" style="display:block;margin:auto"><path d="M7 5.5v9l7.5-4.5L7 5.5Z" fill="currentColor"/></svg><div class="bda-film-bar"></div></div>';
    case 'sheets': return '<div class="bda-paper"><div class="bda-paper-title">' + escTitle + '</div><div class="bda-kpis"><span class="bda-kpi"></span><span class="bda-kpi"></span><span class="bda-kpi"></span></div></div>';
    case 'whiteboard': return '<div class="bda-paper"><div class="bda-paper-title">' + escTitle + '</div><div class="bda-boards"><div class="bda-board"></div><div class="bda-board"></div></div></div>';
    case 'docs': return '<div class="bda-paper"><div class="bda-paper-title">' + escTitle + '</div><div class="bda-line" style="width:72%"></div></div>';
    default: return '<div class="bda-paper"><div class="bda-paper-title">' + escTitle + '</div><div class="bda-line"></div></div>';
  }
}

function esc(v) { return String(v ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
function ago(iso) {
  const then = Date.parse(iso);
  if (!Number.isFinite(then)) return '';
  const seconds = Math.round((then - Date.now()) / 1000);
  if (seconds > -60) return t('justOpened');
  const steps = [['minute', 60], ['hour', 3600], ['day', 86400], ['week', 604800], ['month', 2629800], ['year', 31557600]];
  let unit = 'minute', size = 60;
  for (const [u, s] of steps) if (-seconds >= s) [unit, size] = [u, s];
  let time;
  try { time = new Intl.RelativeTimeFormat(locale(), { numeric: 'auto' }).format(Math.round(seconds / size), unit); }
  catch {
    const unitKey = unit === 'week' ? 'weekUnit' : unit === 'month' ? 'monthUnit' : unit;
    time = t('relativeFallback', { count: Math.abs(Math.round(seconds / size)), unit: t(unitKey) });
  }
  return t('openedRelative', { time });
}

function localizedMeta(item) {
  const match = /^(\\d+) /.exec(item.meta || '');
  const keys = { design: 'boards', slides: 'pages', motion: 'scenes', 'design-system': 'components', data: 'sheets', whiteboard: 'elements', sheets: 'worksheets', docs: 'tabs' };
  if (match && keys[item.skill]) return t(keys[item.skill], {count: match[1]});
  if (item.skill === 'data' && item.meta) return t('dashboard');
  if (item.skill === 'whiteboard' && item.meta) return t('whiteboard');
  if (item.skill === 'page' && item.meta) return t('freePage');
  return item.meta || '';
}

let state = {
  artifacts: [],
  types: [],
  runtime: null,
  loadedOnce: false,
  workspaceName: '',
  workspaceRoot: '',
  search: '',
  viewMode: readPreference('ps_view_mode') || 'grid',
  filters: { sort: 'opened', types: [], date: 'any', sharing: 'any', pinned: false },
  openingRoot: null,
};

let embeddedView = null;
let pendingWaitItem = null;

async function api(path, opts) {
  const r = await fetch(path, opts);
  return r.json();
}

function showToast(msg, undoTrashId) {
  const toast = document.getElementById('toast');
  toast.innerHTML = '<span style="display:inline-flex;align-items:center">' + SVG_ICONS.info + '</span><span>' + esc(msg) + '</span>' +
    (undoTrashId ? ('<button type="button" class="bda-toast-undo" id="toastUndoBtn">' + t('undo') + '</button>') : '') +
    '<button type="button" class="bda-toast-close" id="toastCloseBtn">✕</button>';
  toast.className = 'bda-toast';
  document.getElementById('toastCloseBtn').onclick = () => toast.className = 'hidden';
  if (undoTrashId) {
    document.getElementById('toastUndoBtn').onclick = async () => {
      toast.className = 'hidden';
      const r = await api('/api/restore', { method: 'POST', headers: {'content-type':'application/json'}, body: JSON.stringify({ id: undoTrashId }) });
      showToast(r.ok ? t('restored') : t('restoreFailed') + (r.error || ''));
      if (r.ok) await reload();
    };
  }
  clearTimeout(toast._timer);
  toast._timer = setTimeout(() => toast.className = 'hidden', undoTrashId ? 10000 : 3500);
}

function closeDialog() { const s = document.getElementById('dialogScrim'); s.className = 'bda-scrim hidden'; s.innerHTML = ''; }
function openDialog(html) {
  const s = document.getElementById('dialogScrim');
  s.innerHTML = '<div class="bda-dialog">' + html + '</div>';
  s.className = 'bda-scrim';
  s.onclick = (e) => { if (e.target === s) closeDialog(); };
}
function closeMenu() {
  document.getElementById('menuLayer').innerHTML = '';
  document.querySelectorAll('.bda-item[data-menu="true"]').forEach(el => el.removeAttribute('data-menu'));
}
window.addEventListener('click', (e) => {
  if (!e.target.closest('.bda-menu') && !e.target.closest('.bda-tool') && !e.target.closest('.bda-act')) closeMenu();
});

function matchesFilter(item) {
  const q = state.search.trim().toLowerCase();
  if (q) {
    const label = (SKILL_MAP[item.skill] ? (skillText(item.skill, 'name') + ' ' + SKILL_MAP[item.skill].nameEn) : (item.typeTitle || item.skill));
    const hay = (item.title + ' ' + (item.tail || '') + ' ' + item.skill + ' ' + label + ' ' + (item.note || '')).toLowerCase();
    if (!hay.includes(q)) return false;
  }
  if (state.filters.pinned && !item.pinned) return false;
  if (state.filters.types.length && !state.filters.types.includes(item.skill)) return false;
  if (state.filters.sharing !== 'any') {
    if (state.filters.sharing === 'shared' && !item.shared) return false;
    if (state.filters.sharing === 'private' && item.shared) return false;
  }
  if (state.filters.date !== 'any') {
    const then = Date.parse(item.openedAt);
    if (!Number.isFinite(then)) return false;
    const now = Date.now(), day = new Date(now), today = new Date(day.getFullYear(), day.getMonth(), day.getDate()).getTime(), DAY = 86400000;
    if (state.filters.date === 'today' && then < today) return false;
    if (state.filters.date === 'yesterday' && (then < today - DAY || then >= today)) return false;
    if (state.filters.date === 'week' && then < now - 7 * DAY) return false;
    if (state.filters.date === 'month' && then < now - 30 * DAY) return false;
  }
  return true;
}

function getSortedList() {
  const list = state.artifacts.filter(matchesFilter);
  const sort = state.filters.sort;
  list.sort((a, b) => {
    if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
    if (sort === 'name') return a.title.localeCompare(b.title, locale());
    const key = sort === 'updated' ? 'updatedAt' : (sort === 'created' ? 'firstOpenedAt' : 'openedAt');
    return (b[key] || '').localeCompare(a[key] || '');
  });
  return list;
}

function isFilterActive() {
  return state.filters.sort !== 'opened' || state.filters.types.length > 0 || state.filters.date !== 'any' || state.filters.sharing !== 'any' || state.filters.pinned;
}

function renderTiles() {
  const customEnabled = (state.types || []).filter(tp => !tp.builtin && tp.enabled !== false);
  const allTiles = [
    ...SKILLS_CONFIG.map(s => ({ id: s.id, name: skillText(s.id, 'name'), tint: s.tint })),
    ...customEnabled.map(c => ({ id: c.id, name: c.name || c.title || c.id, tint: c.tint || '#6366f1' })),
  ];
  document.getElementById('tiles').innerHTML = allTiles.map(s =>
    '<li style="--bda-tint:' + esc(s.tint) + '">' +
    '<button type="button" class="bda-tile" data-skill="' + esc(s.id) + '">' +
    '<span class="bda-tile-art"><svg class="bda-tile-squiggle" viewBox="0 0 140 100" preserveAspectRatio="xMidYMid slice" fill="none" stroke="currentColor" stroke-width="1.1" stroke-dasharray="0 3.2" stroke-linecap="round"><path d="M4 84C20 16 42 98 62 42s38 58 74-28"/><path d="M6 88C24 22 44 104 66 46s36 56 72-26"/></svg>' +
    typeIconSvg(s.id, 34) + '</span>' +
    '<span class="bda-tile-label">' + esc(s.name) + '</span>' +
    '</button></li>'
  ).join('');
}

function renderItems() {
  if (!state.loadedOnce) return;
  const container = document.getElementById('container');
  const items = getSortedList();
  const isGrid = state.viewMode === 'grid';
  document.getElementById('viewModeIcon').innerHTML = isGrid ? SVG_ICONS.list : SVG_ICONS.grid;
  document.getElementById('viewModeBtn').title = isGrid ? t('listView') : t('gridView');
  document.getElementById('filterBtn').setAttribute('data-active', isFilterActive() ? 'true' : 'false');
  document.getElementById('listHeading').textContent = t('allWorksCount', {count: items.length});

  if (!items.length) {
    container.innerHTML = '<div class="bda-empty">' + SVG_ICONS.info +
      '<h2>' + (state.search || isFilterActive() ? t('noMatches') : t('noWorks')) + '</h2>' +
      '<p>' + (state.search || isFilterActive() ? t('clearHint') : t('emptyHint')) + '</p>' +
      (isFilterActive() ? ('<button type="button" class="bda-btn" id="clearFilterBtn">' + t('clearFilters') + '</button>') : '') + '</div>';
    if (document.getElementById('clearFilterBtn')) {
      document.getElementById('clearFilterBtn').onclick = () => {
        state.filters = { sort: 'opened', types: [], date: 'any', sharing: 'any', pinned: false };
        state.search = ''; document.getElementById('q').value = '';
        document.getElementById('clearSearch').className = 'hidden';
        renderItems();
      };
    }
    return;
  }

  if (isGrid) {
    container.innerHTML = '<ul class="bda-grid">' + items.map(it => {
      const isOpening = state.openingRoot === it.root;
      const tint = it.typeMissing ? '#71717a' : (TINTS[it.skill] || '#6366f1');
      const badge = it.missing ? ('<span class="bda-missing-badge">' + t('missing') + '</span>')
        : it.typeMissing ? ('<span class="bda-warn-badge">' + t('typeMissingBadge') + ' (' + esc(it.skill) + ')</span>')
        : it.typeDisabled ? ('<span class="bda-warn-badge">' + t('typeDisabledBadge') + '</span>') : '';
      return '<li class="bda-item' + (it.missing ? ' bda-missing' : '') + '" data-root="' + esc(it.root) + '" data-skill="' + esc(it.skill) + '" style="--bda-tint:' + tint + '">' +
        '<button type="button" class="bda-card" data-act="open" ' + ((isOpening || it.missing) ? 'disabled' : '') + '>' +
        '<span class="bda-preview"><span class="bda-sheet">' + drawnHtml(it.skill, it.title) + '</span>' +
        (it.preview ? '<iframe class="bda-live" data-src="/api/preview?skill=' + encodeURIComponent(it.skill) + '&root=' + encodeURIComponent(it.root) + '" tabindex="-1" sandbox="allow-scripts" title="' + t('projectPreview') + '"></iframe>' : '') +
        (it.thumb ? '<img class="bda-thumb" src="/api/thumb?root=' + encodeURIComponent(it.root) + '" alt="" onerror="this.remove()">' : '') +
        badge +
        (isOpening ? ('<span class="bda-busy"><span class="bda-spinner"></span>' + t('opening') + '</span>') : '') +
        '</span><span class="bda-info"><span class="bda-glyph">' + typeIconSvg(it.typeMissing ? '__unknown__' : it.skill, 18) + '</span>' +
        '<span class="bda-text"><span class="bda-name" title="' + esc(it.title) + '">' + esc(it.title) + '</span>' +
        '<span class="bda-meta">' + esc(localizedMeta(it) ? localizedMeta(it) + ' · ' : '') + ago(it.openedAt) + (it.note ? ' · ' + esc(it.note) : '') + '</span>' +
        '</span></span></button>' +
        '<div class="bda-actions"><button type="button" class="bda-act" data-act="more" title="' + t('more') + '">' + SVG_ICONS.more + '</button>' +
        '<button type="button" class="bda-act" data-act="pin" data-on="' + it.pinned + '" title="' + (it.pinned ? t('unpin') : t('pin')) + '">' +
        (it.pinned ? SVG_ICONS.pinFilled : SVG_ICONS.pin) + '</button></div></li>';
    }).join('') + '</ul>';
  } else {
    container.innerHTML = '<ul class="bda-list">' + items.map(it => {
      const isOpening = state.openingRoot === it.root;
      const tint = it.typeMissing ? '#71717a' : (TINTS[it.skill] || '#6366f1');
      return '<li class="bda-item" data-root="' + esc(it.root) + '" data-skill="' + esc(it.skill) + '" style="--bda-tint:' + tint + '">' +
        '<button type="button" class="bda-row" data-act="open" ' + ((isOpening || it.missing) ? 'disabled' : '') + '>' +
        '<span class="bda-glyph">' + (isOpening ? '<span class="bda-spinner"></span>' : typeIconSvg(it.typeMissing ? '__unknown__' : it.skill, 18)) + '</span>' +
        '<span class="bda-name">' + esc(it.title) + (it.typeMissing ? ' [' + esc(t('typeMissingBadge')) + ']' : '') + '</span>' +
        '<span class="bda-meta">' + esc(localizedMeta(it) ? localizedMeta(it) + ' · ' : '') + ago(it.openedAt) + '</span>' +
        '</button><div class="bda-row-tools">' +
        '<button type="button" class="bda-act" data-act="pin" data-on="' + it.pinned + '">' + (it.pinned ? SVG_ICONS.pinFilled : SVG_ICONS.pin) + '</button>' +
        '<button type="button" class="bda-act" data-act="more">' + SVG_ICONS.more + '</button></div></li>';
    }).join('') + '</ul>';
  }
  activateLivePreviews(container);
}

function activateLivePreviews(container) {
  const io = new IntersectionObserver((entries) => {
    for (const e of entries) {
      if (!e.isIntersecting) continue;
      io.unobserve(e.target);
      const f = e.target;
      const w = (f.parentElement && f.parentElement.clientWidth) || 320;
      f.style.transform = 'scale(' + (w / 1280) + ')';
      f.src = f.getAttribute('data-src');
      f.addEventListener('load', () => f.classList.add('on'), { once: true });
    }
  }, { rootMargin: '160px' });
  container.querySelectorAll('.bda-live[data-src]').forEach((f) => io.observe(f));
}

function formatMb(bytes) {
  return (Number(bytes || 0) / (1024 * 1024)).toFixed(1) + ' MB';
}

function updateRuntimeWaitUi(rt) {
  if (!rt) return;
  const total = rt.totalBytes || 21605122;
  const received = rt.bytesReceived || 0;
  const pct = total > 0 ? Math.min(100, Math.round((received / total) * 100)) : 0;
  document.getElementById('runtimeWaitBar').style.width = pct + '%';
  document.getElementById('runtimeWaitText').textContent = rt.state === 'error'
    ? String(rt.error || t('unknownError'))
    : t('runtimeProgress', { received: formatMb(received), total: formatMb(total) }) + ' (' + pct + '%)';
}

function showRuntimeWaitView(item, rt) {
  pendingWaitItem = item;
  document.getElementById('editorTitle').textContent = item.title;
  document.getElementById('frame').classList.add('hidden');
  document.getElementById('l1Banner').classList.add('hidden');
  document.getElementById('runtimeWait').classList.remove('hidden');
  document.getElementById('listView').classList.add('hidden');
  document.getElementById('editorView').classList.remove('hidden');
  updateRuntimeWaitUi(rt);
}

function showUnknownTypeDialog(item) {
  openDialog(
    '<h2>' + esc(t('unknownTypeTitle', { type: item.skill })) + '</h2>' +
    '<p>' + esc(t('unknownTypeDesc', { root: item.root })) + '</p>' +
    '<p style="font-size:12px">' + esc(t('unknownTypeMeta', { type: item.skill, uid: item.typeUid || '—', source: item.typeSource || '—' })) + '</p>' +
    '<div class="bda-dialog-actions">' +
    '<button type="button" class="bda-btn" id="unkCopy">' + t('copyPath') + '</button>' +
    '<button type="button" class="bda-btn" id="unkForget">' + t('forget') + '</button>' +
    '<button type="button" class="bda-btn" data-primary="true" id="unkTypes">' + t('openTypesManager') + '</button>' +
    '<button type="button" class="bda-btn" id="unkClose">' + t('cancel') + '</button></div>'
  );
  document.getElementById('unkClose').onclick = closeDialog;
  document.getElementById('unkCopy').onclick = async () => { await navigator.clipboard.writeText(item.root); showToast(t('legacyPathCopied', { root: item.root })); };
  document.getElementById('unkTypes').onclick = () => { closeDialog(); openTypesManager(); };
  document.getElementById('unkForget').onclick = async () => {
    closeDialog();
    const res = await api('/api/forget', { method: 'POST', headers: {'content-type':'application/json'}, body: JSON.stringify({ root: item.root }) });
    showToast(res.ok ? t('forgotten') : t('forgetFailed') + (res.error || ''));
    if (res.ok) await reload();
  };
}

function showLegacyIncompatibleDialog(item, res) {
  openDialog(
    '<h2>' + esc(t('legacyTitle')) + '</h2>' +
    '<p>' + esc(t('legacyDesc', { title: item.title, error: res.error || '' })) + '</p>' +
    '<div class="bda-dialog-actions">' +
    '<button type="button" class="bda-btn" data-primary="true" id="legAgent">' + t('legacyAgentConvert') + '</button>' +
    (res.hasStaticHtml ? ('<button type="button" class="bda-btn" id="legPreview">' + t('legacyReadonlyPreview') + '</button>') : ('<button type="button" class="bda-btn" id="legPath">' + t('legacyShowPath') + '</button>')) +
    '<button type="button" class="bda-btn" id="legCancel">' + t('cancel') + '</button></div>'
  );
  document.getElementById('legCancel').onclick = closeDialog;
  document.getElementById('legAgent').onclick = async () => {
    closeDialog();
    const r = await api('/api/start', { method: 'POST', headers: {'content-type':'application/json'}, body: JSON.stringify({ legacyMigrate: item.root, skill: item.skill, error: res.error }) });
    if (r.ok) showToast(t('agentStarted'));
    else { try { await navigator.clipboard.writeText(r.starter || ''); showToast(t('draftCopied') + (r.error || '')); } catch { showToast(t('startFailed') + (r.error || '')); } }
  };
  if (res.hasStaticHtml) {
    document.getElementById('legPreview').onclick = () => {
      closeDialog();
      const frame = document.getElementById('frame');
      document.getElementById('editorTitle').textContent = item.title + ' · ' + t('legacyReadonlyPreview');
      document.getElementById('runtimeWait').classList.add('hidden');
      document.getElementById('l1Banner').classList.add('hidden');
      frame.classList.remove('hidden');
      frame.src = '/api/preview?skill=' + encodeURIComponent(item.skill) + '&root=' + encodeURIComponent(item.root);
      document.getElementById('listView').classList.add('hidden');
      document.getElementById('editorView').classList.remove('hidden');
    };
  } else if (document.getElementById('legPath')) {
    document.getElementById('legPath').onclick = async () => {
      await navigator.clipboard.writeText(item.root);
      closeDialog();
      showToast(t('legacyPathCopied', { root: item.root }));
    };
  }
}

async function openItem(item) {
  if (item.typeMissing) return showUnknownTypeDialog(item);
  if (item.typeDisabled) {
    openDialog('<h2>' + esc(t('typeDisabledTitle', { type: item.skill })) + '</h2><p>' + esc(t('typeDisabledDesc')) + '</p><div class="bda-dialog-actions"><button type="button" class="bda-btn" data-primary="true" id="tdOpen">' + t('openTypesManager') + '</button><button type="button" class="bda-btn" id="tdClose">' + t('close') + '</button></div>');
    document.getElementById('tdClose').onclick = closeDialog;
    document.getElementById('tdOpen').onclick = () => { closeDialog(); openTypesManager(); };
    return;
  }

  state.openingRoot = item.root;
  renderItems();
  try {
    const res = await api('/api/open', { method: 'POST', headers: {'content-type':'application/json'}, body: JSON.stringify({ skill: item.skill, root: item.root }) });
    if (!res.ok) {
      if (res.code === 'runtime_not_ready') return showRuntimeWaitView(item, res.runtime);
      if (res.code === 'legacy_incompatible') return showLegacyIncompatibleDialog(item, res);
      showToast(t('cannotOpen') + (res.error || t('unknownError')));
      return;
    }
    pendingWaitItem = null;
    const frame = document.getElementById('frame');
    document.getElementById('runtimeWait').classList.add('hidden');
    frame.classList.remove('hidden');
    document.getElementById('editorTitle').textContent = item.title + ' · ' + (SKILL_MAP[item.skill] ? skillText(item.skill, 'name') : item.skill);
    if (embeddedView) { embeddedView.destroy(); embeddedView = null; }
    if (res.embedMode === 'shell') {
      document.getElementById('l1Banner').classList.remove('hidden');
      document.getElementById('copyCommentsBtn').onclick = async () => {
        const cmd = '请读取 Open Artifact 作品 ' + (res.id || item.root) + ' 的待处理评论（open-artifact comments \\'{"action":"read","url":"open-artifact://artifact/' + res.id + '"}\\'）并处理回复。';
        await navigator.clipboard.writeText(cmd);
        showToast(t('l1CommentCopied'));
      };
      embeddedView = embedArtifact(frame, {
        url: res.url,
        agentName: 'Agent',
        harness: 'orca-design',
        toolbar: true,
        theme: { scheme: resolvedScheme() },
        onNewSession: async ({ prompt }) => {
          const r = await api('/api/start', { method: 'POST', headers: {'content-type':'application/json'}, body: JSON.stringify({ customPrompt: prompt }) });
          if (r.ok) showToast(t('agentStarted'));
          else { try { await navigator.clipboard.writeText(prompt || ''); showToast(t('draftCopied') + (r.error || '')); } catch {} }
        },
        onCommentSent: () => showToast(t('l1Banner')),
        onOpenExternal: (u) => window.open(u, '_blank', 'noopener'),
        onClose: backToGallery,
      });
    } else {
      document.getElementById('l1Banner').classList.add('hidden');
      frame.src = res.url;
    }
    document.getElementById('popBtn').onclick = () => window.open(res.url, '_blank');
    document.getElementById('listView').classList.add('hidden');
    document.getElementById('editorView').classList.remove('hidden');
    history.pushState({ editor: true }, '', '#editor');
  } catch (err) {
    showToast(t('openFailed') + err.message);
  } finally {
    state.openingRoot = null;
    renderItems();
  }
}

function backToGallery() {
  pendingWaitItem = null;
  if (embeddedView) { embeddedView.destroy(); embeddedView = null; }
  document.getElementById('editorView').classList.add('hidden');
  document.getElementById('listView').classList.remove('hidden');
  document.getElementById('frame').src = 'about:blank';
  if (location.hash) history.replaceState({}, '', location.pathname + location.search);
  reload();
}
window.addEventListener('popstate', () => {
  if (!document.getElementById('editorView').classList.contains('hidden')) backToGallery();
});
document.getElementById('backBtn').onclick = backToGallery;

try {
  const es = new EventSource('/api/runtime/events');
  es.onmessage = (ev) => {
    const rt = JSON.parse(ev.data);
    state.runtime = rt;
    if (pendingWaitItem && !document.getElementById('runtimeWait').classList.contains('hidden')) {
      updateRuntimeWaitUi(rt);
      if (rt.state === 'ready') {
        const nextItem = pendingWaitItem;
        pendingWaitItem = null;
        showToast(t('runtimeReady'));
        openItem(nextItem);
      }
    }
  };
} catch {}

document.getElementById('runtimeRetryBtn').onclick = async () => {
  const r = await api('/api/runtime/retry', { method: 'POST', headers: {'content-type':'application/json'}, body: '{}' });
  if (r.runtime) updateRuntimeWaitUi(r.runtime);
};

async function uploadOfflineTgzFile(file) {
  const CHUNK_BYTES = 32 * 1024;
  const buf = new Uint8Array(await file.arrayBuffer());
  const totalChunks = Math.max(1, Math.ceil(buf.length / CHUNK_BYTES));
  const uploadId = 'up_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8);
  let lastRes = null;
  for (let i = 0; i < totalChunks; i++) {
    const slice = buf.subarray(i * CHUNK_BYTES, (i + 1) * CHUNK_BYTES);
    let bin = '';
    for (let j = 0; j < slice.length; j++) bin += String.fromCharCode(slice[j]);
    lastRes = await api('/api/runtime/import', {
      method: 'POST',
      headers: {'content-type':'application/json'},
      body: JSON.stringify({ uploadId, chunkIndex: i, totalChunks, fileName: file.name, dataBase64: btoa(bin) }),
    });
    if (!lastRes.ok) break;
  }
  return lastRes;
}

document.getElementById('runtimeFileInput').onchange = async (e) => {
  const file = e.target.files?.[0];
  if (!file) return;
  const r = await uploadOfflineTgzFile(file);
  if (r?.ok) {
    showToast(t('runtimeReady'));
    if (pendingWaitItem) { const it = pendingWaitItem; pendingWaitItem = null; await openItem(it); }
  } else {
    showToast(t('runtimeImportFailed') + (r?.error || t('unknownError')));
  }
};

document.getElementById('runtimePathBtn').onclick = async () => {
  const p = document.getElementById('runtimePathInput').value.trim();
  if (!p) return;
  const r = await api('/api/runtime/import', { method: 'POST', headers: {'content-type':'application/json'}, body: JSON.stringify({ filePath: p }) });
  if (r.ok) {
    showToast(t('runtimeReady'));
    if (pendingWaitItem) { const it = pendingWaitItem; pendingWaitItem = null; await openItem(it); }
  } else {
    showToast(t('runtimeImportFailed') + (r.error || t('unknownError')));
  }
};

function showActionsMenu(item, anchorEl) {
  const rect = anchorEl.getBoundingClientRect();
  const layer = document.getElementById('menuLayer');
  anchorEl.closest('.bda-item')?.setAttribute('data-menu', 'true');
  layer.innerHTML = '<div class="bda-menu" style="left:' + Math.min(rect.left, window.innerWidth - 220) + 'px;top:' + (rect.bottom + 6) + 'px">' +
    '<button type="button" class="bda-menu-item" data-menu-action="pin">' + SVG_ICONS.pin + '<span class="bda-menu-label">' + (item.pinned ? t('unpin') : t('pin')) + '</span><kbd class="bda-menu-key">P</kbd></button>' +
    '<button type="button" class="bda-menu-item" data-menu-action="rename">' + SVG_ICONS.rename + '<span class="bda-menu-label">' + t('rename') + '</span><kbd class="bda-menu-key">R</kbd></button>' +
    '<button type="button" class="bda-menu-item" data-menu-action="recreate">' + SVG_ICONS.info + '<span class="bda-menu-label">' + t('recreate') + '</span><kbd class="bda-menu-key">S</kbd></button>' +
    '<button type="button" class="bda-menu-item" data-menu-action="copy">' + SVG_ICONS.copy + '<span class="bda-menu-label">' + t('copyLink') + '</span><kbd class="bda-menu-key">C</kbd></button>' +
    (item.missing ? '<button type="button" class="bda-menu-item" data-menu-action="forget" data-danger="true">' + SVG_ICONS.trash + '<span class="bda-menu-label">' + t('forget') + '</span></button>' : '') +
    '<div class="bda-menu-rule"></div>' +
    '<button type="button" class="bda-menu-item" data-menu-action="delete" data-danger="true">' + SVG_ICONS.trash + '<span class="bda-menu-label">' + t('delete') + '</span></button></div>';

  layer.querySelector('.bda-menu').onclick = async (e) => {
    const btn = e.target.closest('[data-menu-action]');
    if (!btn) return;
    const act = btn.getAttribute('data-menu-action');
    closeMenu();
    if (act === 'pin') {
      await api('/api/update', { method: 'POST', headers: {'content-type':'application/json'}, body: JSON.stringify({ root: item.root, pinned: !item.pinned }) });
      await reload();
    } else if (act === 'rename') {
      openRenameDialog(item);
    } else if (act === 'recreate') {
      const res = await api('/api/start', { method: 'POST', headers: {'content-type':'application/json'}, body: JSON.stringify({ root: item.root, skill: item.skill, title: item.title }) });
      if (res.ok) showToast(t('remixSent', {outcome: res.outcome || 'chat'}));
      else { try { await navigator.clipboard.writeText(res.starter || ''); showToast(t('draftCopied') + (res.error || '')); } catch { showToast(t('remixFailed') + (res.error || '')); } }
    } else if (act === 'forget') {
      const res = await api('/api/forget', { method: 'POST', headers: {'content-type':'application/json'}, body: JSON.stringify({ root: item.root }) });
      showToast(res.ok ? t('forgotten') : t('forgetFailed') + (res.error || ''));
      if (res.ok) await reload();
    } else if (act === 'copy') {
      const res = await api('/api/open', { method: 'POST', headers: {'content-type':'application/json'}, body: JSON.stringify({ skill: item.skill, root: item.root }) });
      if (res.ok && res.url) { await navigator.clipboard.writeText(res.url); showToast(t('linkCopied')); }
      else showToast(t('linkFailed'));
    } else if (act === 'delete') {
      openDeleteDialog(item);
    }
  };
}

function openRenameDialog(item) {
  openDialog(
    '<h2>' + t('renameTitle') + '</h2><p>' + esc(t('renameDescription', {title: item.title})) + '</p>' +
    '<input id="renameInput" value="' + esc(item.title) + '" maxlength="200" autofocus>' +
    '<div class="bda-dialog-actions"><button type="button" class="bda-btn" id="renameCancel">' + t('cancel') + '</button>' +
    '<button type="button" class="bda-btn" data-primary="true" id="renameSave">' + t('save') + '</button></div>'
  );
  const input = document.getElementById('renameInput'); input.focus(); input.select();
  document.getElementById('renameCancel').onclick = closeDialog;
  document.getElementById('renameSave').onclick = async () => {
    const val = input.value.trim();
    if (!val || val === item.title) return closeDialog();
    closeDialog();
    const res = await api('/api/update', { method: 'POST', headers: {'content-type':'application/json'}, body: JSON.stringify({ root: item.root, title: val, skill: item.skill }) });
    if (res.ok) { showToast(t('renamed', {title: val})); await reload(); }
    else showToast(t('renameFailed') + (res.error || ''));
  };
}

function openDeleteDialog(item) {
  openDialog(
    '<h2>' + esc(t('deleteTitle', {title: item.title})) + '</h2>' +
    '<p>' + esc(t('deleteKeepDefault', {title: item.title}) + ' ' + item.root) + '</p>' +
    (item.deletable ? ('<label style="display:flex;align-items:center;gap:8px;font-size:13px;margin-bottom:12px;cursor:pointer"><input type="checkbox" id="moveFolderChk"><span>' + esc(t('deleteAlsoMove')) + '</span></label>') : '') +
    '<div class="bda-dialog-actions"><button type="button" class="bda-btn" id="deleteCancel">' + t('cancel') + '</button>' +
    '<button type="button" class="bda-btn" data-danger="true" id="deleteConfirm">' + t('delete') + '</button></div>'
  );
  document.getElementById('deleteCancel').onclick = closeDialog;
  document.getElementById('deleteConfirm').onclick = async () => {
    const moveFolder = Boolean(document.getElementById('moveFolderChk')?.checked);
    closeDialog();
    const res = await api('/api/delete', { method: 'POST', headers: {'content-type':'application/json'}, body: JSON.stringify({ root: item.root, moveFolder }) });
    if (res.ok) { showToast(moveFolder && res.moved ? t('deleted', {title: item.title}) : t('removed', {title: item.title}), res.trash); await reload(); }
    else showToast(t('deleteFailed') + (res.error || ''));
  };
}

async function createAndOpenBlank(skillId) {
  const res = await api('/api/create', { method: 'POST', headers: {'content-type':'application/json'}, body: JSON.stringify({ skill: skillId }) });
  if (res.ok && res.root) {
    await reload();
    const found = state.artifacts.find(a => a.root === res.root);
    if (found) await openItem(found);
  } else {
    showToast(t('createFailed') + (res.error || ''));
  }
}

function openCreateDialog(skillId) {
  if (skillId === 'design-system') {
    const existing = state.artifacts.find(a => a.skill === 'design-system' && !a.missing);
    if (existing) {
      openDialog(
        '<h2>' + esc(t('dsUniqueTitle')) + '</h2><p>' + esc(t('dsUniqueDesc', { title: existing.title })) + '</p>' +
        '<div class="bda-dialog-actions"><button type="button" class="bda-btn" id="dsCancel">' + t('cancel') + '</button>' +
        '<button type="button" class="bda-btn" id="dsAnyway">' + t('dsCreateAnyway') + '</button>' +
        '<button type="button" class="bda-btn" data-primary="true" id="dsOpen">' + t('dsOpenExisting') + '</button></div>'
      );
      document.getElementById('dsCancel').onclick = closeDialog;
      document.getElementById('dsOpen').onclick = () => { closeDialog(); openItem(existing); };
      document.getElementById('dsAnyway').onclick = () => { closeDialog(); showCreateModalInner(skillId); };
      return;
    }
  }
  showCreateModalInner(skillId);
}

function showCreateModalInner(skillId) {
  const s = SKILL_MAP[skillId] || (state.types || []).find(tp => tp.id === skillId);
  if (!s) return;
  const titleName = SKILL_MAP[skillId] ? skillText(skillId, 'name') : (s.name || s.title || skillId);
  const aboutText = SKILL_MAP[skillId] ? skillText(skillId, 'about') : (s.description || '');
  const promptText = SKILL_MAP[skillId] ? skillText(skillId, 'prompt') : ('/open-artifact ' + skillId + ' ');
  const canBlank = Boolean(s.blankCreatable || EXAMPLE_TEMPLATES[skillId]);

  openDialog(
    '<div style="display:flex;align-items:center;gap:10px;margin-bottom:12px">' + typeIconSvg(skillId, 26) + '<h2 style="margin:0">' + esc(t('createTitle', {title: titleName})) + '</h2></div>' +
    '<p>' + esc(aboutText) + '</p>' +
    '<div class="bda-dialog-actions">' +
    '<button type="button" class="bda-btn" id="copyPromptBtn">' + t('copyPrompt') + '</button>' +
    '<button type="button" class="bda-btn" ' + (!canBlank ? 'data-primary="true" ' : '') + 'id="askAgentBtn">' + t('askAgentCreate') + '</button>' +
    (canBlank ? ('<button type="button" class="bda-btn" data-primary="true" id="createBlankBtn">' + t('createBlank') + '</button>') : '') +
    '<button type="button" class="bda-btn" id="createCancel">' + t('cancel') + '</button></div>'
  );
  document.getElementById('createCancel').onclick = closeDialog;
  document.getElementById('copyPromptBtn').onclick = async () => {
    try { await navigator.clipboard.writeText(promptText); closeDialog(); showToast(t('promptCopied')); }
    catch { showToast(t('copyFailed') + promptText); }
  };
  document.getElementById('askAgentBtn').onclick = async () => {
    closeDialog();
    const res = await api('/api/start', { method: 'POST', headers: {'content-type':'application/json'}, body: JSON.stringify({ customPrompt: promptText }) });
    if (res.ok) showToast(t('agentStarted'));
    else { try { await navigator.clipboard.writeText(res.starter || promptText); showToast(t('draftCopied') + (res.error || '')); } catch {} }
  };
  if (canBlank) {
    document.getElementById('createBlankBtn').onclick = async () => { closeDialog(); await createAndOpenBlank(skillId); };
  }
}

async function openTypesManager() {
  const res = await api('/api/types');
  const types = res.types || [];
  const rt = state.runtime || (await api('/api/runtime/status'));
  const rtLabel = rt?.state === 'ready'
    ? t('runtimeReadyShort', { source: rt.source || 'local', version: rt.version || '0.14.7' })
    : t('runtimeMissingShort');

  openDialog(
    '<h2>' + esc(t('typesManagerTitle')) + '</h2>' +
    '<p><strong>' + esc(t('runtimeStatusLabel')) + ':</strong> ' + esc(rtLabel) + '</p>' +
    '<div style="max-height:280px;overflow:auto;margin-bottom:14px">' +
    types.map(tp => {
      const name = SKILL_MAP[tp.id] ? skillText(tp.id, 'name') : (tp.name || tp.title || tp.id);
      return '<div class="type-row"><div><div><strong>' + esc(name) + '</strong> <code style="font-size:11px">' + esc(tp.id) + '</code></div>' +
        '<div class="type-row-meta">' + esc(tp.scope || 'builtin') + ' · v' + esc(tp.version || '0.1.0') + '</div></div>' +
        '<button type="button" class="bda-btn" data-toggle-enable="' + esc(tp.id) + '" data-enabled="' + (tp.enabled !== false) + '">' +
        (tp.enabled !== false ? t('typesEnabled') : t('typesDisabled')) + '</button></div>';
    }).join('') + '</div>' +
    '<div style="border-top:.5px solid var(--dsw-alias-border-l2);padding-top:12px">' +
    '<p style="margin-bottom:8px"><strong>' + esc(t('typesInstallTitle')) + '</strong></p>' +
    '<div style="display:flex;gap:8px"><input type="text" id="oatypePathInput" placeholder="' + esc(t('typesInstallPathPlaceholder')) + '" style="flex:1;margin:0">' +
    '<button type="button" class="bda-btn" id="oatypePreviewBtn">' + t('typesPreviewBtn') + '</button></div>' +
    '<div id="oatypePreviewBox" style="margin-top:8px;font-size:12px"></div></div>' +
    '<div class="bda-dialog-actions">' +
    (state.workspaceRoot ? ('<button type="button" class="bda-btn" id="trustProjBtn">' + t('typesTrustProject') + '</button>') : '') +
    '<button type="button" class="bda-btn" data-primary="true" id="tmClose">' + t('close') + '</button></div>'
  );
  document.getElementById('tmClose').onclick = closeDialog;
  document.querySelectorAll('[data-toggle-enable]').forEach(btn => {
    btn.onclick = async () => {
      const id = btn.getAttribute('data-toggle-enable');
      const nextEnabled = btn.getAttribute('data-enabled') !== 'true';
      await api('/api/types/toggle', { method: 'POST', headers: {'content-type':'application/json'}, body: JSON.stringify({ id, enabled: nextEnabled }) });
      await reload();
      openTypesManager();
    };
  });
  if (document.getElementById('trustProjBtn')) {
    document.getElementById('trustProjBtn').onclick = async () => {
      await api('/api/types/trust-project', { method: 'POST', headers: {'content-type':'application/json'}, body: JSON.stringify({ workspace: state.workspaceRoot }) });
      showToast(t('typesTrusted'));
    };
  }
  document.getElementById('oatypePreviewBtn').onclick = async () => {
    const filePath = document.getElementById('oatypePathInput').value.trim();
    if (!filePath) return;
    const prev = await api('/api/types/install', { method: 'POST', headers: {'content-type':'application/json'}, body: JSON.stringify({ filePath, preview: true }) });
    const box = document.getElementById('oatypePreviewBox');
    if (!prev.ok) { box.textContent = prev.error || t('unknownError'); return; }
    box.innerHTML = '<div>id: <code>' + esc(prev.id) + '</code> · version: ' + esc(prev.version) + ' · sha256: <code>' + esc(String(prev.sha256).slice(0, 16)) + '…</code></div>' +
      '<button type="button" class="bda-btn" data-primary="true" id="confirmOatypeBtn" style="margin-top:6px">' + t('typesConfirmInstall') + '</button>';
    document.getElementById('confirmOatypeBtn').onclick = async () => {
      const inst = await api('/api/types/install', { method: 'POST', headers: {'content-type':'application/json'}, body: JSON.stringify({ filePath, confirm: true }) });
      if (inst.ok) { await reload(); openTypesManager(); } else { box.textContent = inst.error || t('unknownError'); }
    };
  };
}

function showFilterMenu(anchorEl) {
  const rect = anchorEl.getBoundingClientRect();
  const layer = document.getElementById('menuLayer');
  const typeCounts = new Map();
  state.artifacts.forEach(a => typeCounts.set(a.skill, (typeCounts.get(a.skill) || 0) + 1));
  const dynamicTypes = [...new Set([...SKILLS_CONFIG.map(s => s.id), ...(state.types || []).map(tp => tp.id), ...state.artifacts.map(a => a.skill)])];
  const sortLabels = { opened: t('sortOpened'), updated: t('sortUpdated'), created: t('sortCreated'), name: t('sortName') };
  const dateLabels = { any: t('any'), today: t('today'), yesterday: t('yesterday'), week: t('week'), month: t('month') };
  const shareLabels = { any: t('any'), shared: t('shared'), private: t('private') };

  layer.innerHTML = '<div class="bda-menu" style="right:' + (window.innerWidth - rect.right) + 'px;top:' + (rect.bottom + 6) + 'px">' +
    '<div class="bda-menu-row"><button type="button" class="bda-menu-item"><span class="bda-menu-label">' + t('sortBy') + '</span><span class="bda-menu-value">' + sortLabels[state.filters.sort] + '</span><span class="bda-menu-chev">' + SVG_ICONS.chevron + '</span></button>' +
    '<div class="bda-submenu">' + Object.entries(sortLabels).map(([k, v]) => '<button type="button" class="bda-menu-item" data-set-sort="' + k + '"><span class="bda-menu-label">' + v + '</span>' + (state.filters.sort === k ? '<span class="bda-tick">' + SVG_ICONS.tick + '</span>' : '') + '</button>').join('') + '</div></div>' +
    '<div class="bda-menu-rule"></div>' +
    '<div class="bda-menu-row"><button type="button" class="bda-menu-item"><span class="bda-menu-label">' + t('type') + '</span><span class="bda-menu-value">' + (state.filters.types.length ? state.filters.types.length + t('selectedSuffix') : t('any')) + '</span><span class="bda-menu-chev">' + SVG_ICONS.chevron + '</span></button>' +
    '<div class="bda-submenu">' + dynamicTypes.map(id => {
      const on = state.filters.types.includes(id);
      const label = SKILL_MAP[id] ? skillText(id, 'name') : id;
      return '<button type="button" class="bda-menu-item" data-toggle-type="' + esc(id) + '"><span class="bda-check" data-on="' + on + '">' + (on ? SVG_ICONS.tick : '') + '</span><span class="bda-menu-label">' + esc(label) + '</span><span class="bda-menu-count">' + (typeCounts.get(id) || 0) + '</span></button>';
    }).join('') + '</div></div>' +
    '<div class="bda-menu-row"><button type="button" class="bda-menu-item"><span class="bda-menu-label">' + t('openedAt') + '</span><span class="bda-menu-value">' + dateLabels[state.filters.date] + '</span><span class="bda-menu-chev">' + SVG_ICONS.chevron + '</span></button>' +
    '<div class="bda-submenu">' + Object.entries(dateLabels).map(([k, v]) => '<button type="button" class="bda-menu-item" data-set-date="' + k + '"><span class="bda-menu-label">' + v + '</span>' + (state.filters.date === k ? '<span class="bda-tick">' + SVG_ICONS.tick + '</span>' : '') + '</button>').join('') + '</div></div>' +
    '<div class="bda-menu-row"><button type="button" class="bda-menu-item"><span class="bda-menu-label">' + t('sharing') + '</span><span class="bda-menu-value">' + shareLabels[state.filters.sharing] + '</span><span class="bda-menu-chev">' + SVG_ICONS.chevron + '</span></button>' +
    '<div class="bda-submenu">' + Object.entries(shareLabels).map(([k, v]) => '<button type="button" class="bda-menu-item" data-set-share="' + k + '"><span class="bda-menu-label">' + v + '</span>' + (state.filters.sharing === k ? '<span class="bda-tick">' + SVG_ICONS.tick + '</span>' : '') + '</button>').join('') + '</div></div>' +
    '<div class="bda-menu-rule"></div>' +
    '<button type="button" class="bda-menu-item" data-toggle-pinned="true"><span class="bda-menu-label">' + t('pinned') + '</span>' + (state.filters.pinned ? '<span class="bda-tick">' + SVG_ICONS.tick + '</span>' : '') + '</button>' +
    (isFilterActive() ? ('<button type="button" class="bda-menu-item" data-clear-filters="true"><span class="bda-menu-label">' + t('clearFilters') + '</span></button>') : '') + '</div>';

  layer.querySelector('.bda-menu').onclick = (e) => {
    const tSort = e.target.closest('[data-set-sort]'); if (tSort) { state.filters.sort = tSort.getAttribute('data-set-sort'); closeMenu(); renderItems(); return; }
    const tType = e.target.closest('[data-toggle-type]'); if (tType) { const sk = tType.getAttribute('data-toggle-type'); state.filters.types = state.filters.types.includes(sk) ? state.filters.types.filter(x => x !== sk) : [...state.filters.types, sk]; closeMenu(); renderItems(); return; }
    const tDate = e.target.closest('[data-set-date]'); if (tDate) { state.filters.date = tDate.getAttribute('data-set-date'); closeMenu(); renderItems(); return; }
    const tShare = e.target.closest('[data-set-share]'); if (tShare) { state.filters.sharing = tShare.getAttribute('data-set-share'); closeMenu(); renderItems(); return; }
    if (e.target.closest('[data-toggle-pinned]')) { state.filters.pinned = !state.filters.pinned; closeMenu(); renderItems(); return; }
    if (e.target.closest('[data-clear-filters]')) { state.filters = { sort: 'opened', types: [], date: 'any', sharing: 'any', pinned: false }; closeMenu(); renderItems(); }
  };
}

document.getElementById('tiles').onclick = (e) => { const btn = e.target.closest('.bda-tile'); if (btn?.getAttribute('data-skill')) openCreateDialog(btn.getAttribute('data-skill')); };
document.getElementById('typesBtn').onclick = openTypesManager;
document.getElementById('examples').onclick = async (e) => {
  const btn = e.target.closest('[data-example]'); if (!btn) return;
  const example = OFFICIAL_EXAMPLES.find(x => x.id === btn.getAttribute('data-example')); if (!example) return;
  if (btn.getAttribute('data-act') === 'preview') {
    openDialog('<h2>' + esc(exampleText(example, 'title')) + '</h2><p>' + esc(exampleText(example, 'desc')) + '</p>' +
      (example.html ? '<div class="bda-example-preview" id="examplePreview"><iframe sandbox="" title="' + esc(t('previewTitle', {title: exampleText(example, 'title')})) + '"></iframe></div>' : '<p>' + t('exampleSkeleton') + '</p>') +
      '<p>' + esc(exampleText(example, 'points')) + '</p><div class="bda-dialog-actions"><button type="button" class="bda-btn" id="exampleClose">' + t('close') + '</button></div>');
    document.getElementById('exampleClose').onclick = closeDialog;
    if (example.html) {
      const preview = document.getElementById('examplePreview'), frame = preview.querySelector('iframe'), scale = preview.clientWidth / 880;
      preview.style.height = (560 * scale) + 'px'; frame.style.transform = 'scale(' + scale + ')';
      frame.srcdoc = example.html.replaceAll(STR.zh.samplePresentation, t('samplePresentation'));
    }
    return;
  }
  btn.disabled = true;
  try {
    const res = await api('/api/start', { method: 'POST', headers: {'content-type':'application/json'}, body: JSON.stringify({ example: example.id }) });
    if (res.ok) showToast(t('exampleStarted'));
    else if (res.starter) { try { await navigator.clipboard.writeText(res.starter); showToast(t('draftCopied') + (res.error || '')); } catch { showToast(t('startFailed') + (res.error || '') + t('draftPrefix') + res.starter); } }
  } finally { btn.disabled = false; }
};
document.getElementById('recipes').onclick = async (e) => {
  const btn = e.target.closest('[data-recipe]'); if (!btn) return;
  const res = await api('/api/start', { method: 'POST', headers: {'content-type':'application/json'}, body: JSON.stringify({ recipe: btn.getAttribute('data-recipe') }) });
  if (res.ok) showToast(t('workflowSent', {outcome: res.outcome || 'chat'}));
  else { try { await navigator.clipboard.writeText(res.starter || ''); showToast(t('draftCopied') + (res.error || '')); } catch { showToast(t('workflowFailed') + (res.error || '')); } }
};
document.getElementById('container').onclick = async (e) => {
  const itemEl = e.target.closest('.bda-item'); if (!itemEl) return;
  const item = state.artifacts.find(a => a.root === itemEl.getAttribute('data-root')); if (!item) return;
  const btn = e.target.closest('button[data-act]'); if (!btn) return;
  const act = btn.getAttribute('data-act');
  if (act === 'open') await openItem(item);
  else if (act === 'pin') { await api('/api/update', { method: 'POST', headers: {'content-type':'application/json'}, body: JSON.stringify({ root: item.root, pinned: !item.pinned }) }); await reload(); }
  else if (act === 'more') showActionsMenu(item, btn);
};

const qInput = document.getElementById('q'), clearSearchBtn = document.getElementById('clearSearch');
qInput.oninput = () => { state.search = qInput.value; clearSearchBtn.className = state.search ? '' : 'hidden'; renderItems(); };
clearSearchBtn.onclick = () => { qInput.value = ''; state.search = ''; clearSearchBtn.className = 'hidden'; qInput.focus(); renderItems(); };
window.addEventListener('keydown', (e) => {
  if (e.key === '/' && document.activeElement !== qInput && !document.querySelector('.bda-scrim:not(.hidden)')) { e.preventDefault(); qInput.focus(); }
  else if (e.key === 'Escape') {
    if (!document.getElementById('dialogScrim').classList.contains('hidden')) closeDialog();
    else if (document.getElementById('menuLayer').innerHTML) closeMenu();
    else if (qInput.value) clearSearchBtn.click();
  }
});
document.getElementById('viewModeBtn').onclick = () => { state.viewMode = state.viewMode === 'grid' ? 'list' : 'grid'; writePreference('ps_view_mode', state.viewMode); renderItems(); };
document.getElementById('filterBtn').onclick = (e) => showFilterMenu(e.currentTarget);
document.getElementById('reloadBtn').onclick = async () => { await reload(); showToast(t('refreshed')); };

async function reload() {
  try {
    const res = await api('/api/list');
    if (res.ok) {
      state.loadedOnce = true;
      state.artifacts = res.artifacts || [];
      state.types = res.types || [];
      state.runtime = res.runtime || state.runtime;
      state.workspaceName = res.workspaceName || '';
      state.workspaceRoot = res.workspaceRoot || '';
      document.getElementById('wsLabel').textContent = state.workspaceName ? t('workspace') + state.workspaceName : '';
      renderTiles();
      renderItems();
    }
  } catch (err) {
    setTimeout(reload, 500);
  }
}

function renderExamples() {
  document.getElementById('examples').innerHTML = OFFICIAL_EXAMPLES.map(example =>
    '<li class="bda-example"><span class="bda-example-skill">' + typeIconSvg(example.skill, 16) + esc(skillText(example.skill, 'name')) + '</span>' +
    '<h3>' + esc(exampleText(example, 'title')) + '</h3><p>' + esc(exampleText(example, 'desc')) + '</p>' +
    '<div class="bda-example-actions"><button type="button" class="bda-btn" data-act="preview" data-example="' + esc(example.id) + '">' + t('preview') + '</button>' +
    '<button type="button" class="bda-btn" data-primary="true" data-act="start" data-example="' + esc(example.id) + '">' + t('recreate') + '</button></div></li>').join('');
}
function renderRecipes() {
  document.getElementById('recipes').innerHTML = RECIPES.map(r =>
    '<li><button type="button" class="bda-tile" data-recipe="' + esc(r.id) + '">' +
    '<span class="bda-tile-art" style="min-height:40px;justify-content:flex-start"><span class="bda-tile-label" style="font-size:13px">' + esc(recipeText(r, 'title')) + '</span></span>' +
    '<span class="bda-recipe-desc" style="padding:0 2px">' + esc(recipeText(r, 'desc')) + '</span></button></li>').join('');
}
function renderAll() {
  document.documentElement.lang = locale();
  document.title = t('works') + ' · Orca-Design';
  document.querySelectorAll('[data-i18n]').forEach(el => { el.textContent = t(el.dataset.i18n); });
  document.querySelectorAll('[data-i18n-placeholder]').forEach(el => { el.placeholder = t(el.dataset.i18nPlaceholder); });
  document.querySelectorAll('[data-i18n-title]').forEach(el => { el.title = t(el.dataset.i18nTitle); });
  document.querySelectorAll('[data-i18n-label]').forEach(el => { el.setAttribute('aria-label', t(el.dataset.i18nLabel)); });
  document.getElementById('wsLabel').textContent = state.workspaceName ? t('workspace') + state.workspaceName : '';
  document.getElementById('languageBtn').textContent = t('languageButton');
  renderTiles();
  renderExamples();
  renderRecipes();
  renderItems();
  document.documentElement.removeAttribute('data-i18n-pending');
}
document.getElementById('languageBtn').onclick = () => {
  lang = lang === 'zh' ? 'en' : 'zh';
  writePreference('ps_lang', lang);
  const url = new URL(location.href);
  url.searchParams.set('lang', lang);
  history.replaceState(history.state, '', url);
  closeMenu(); closeDialog();
  document.getElementById('toast').className = 'hidden';
  renderAll();
};
renderAll();
reload();
</script>
</body>
</html>`;
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
  const agent = cleanAgentId(input.agent);
  if (!readState().workspaceRoot) return { ok: false, error: '工作区未识别，无法启动 Agent' };
  if (input.legacyMigrate) {
    const starter = `请协助检查并无损转换升级旧版设计作品目录：${input.legacyMigrate}（类型：${input.skill || ''}）。\n先备份原文件后再修复格式差异。报错信息：${input.error || ''}`;
    return launchAgent(starter, agent);
  }
  if (input.customPrompt) {
    return launchAgent(String(input.customPrompt), agent);
  }
  if (input.example) {
    const normEx = normalizeTypeId(input.example);
    const example = OFFICIAL_EXAMPLES.find((x) => x.id === normEx);
    if (!example) return { ok: false, error: '未知官方示例' };
    const starter = `${SKILL_BY_ID[example.skill].prompt}${example.desc}\n参考示例 ${example.points}。请在当前工作区 .design/ 内创建新项目。`;
    return launchAgent(starter, agent);
  }
  if (input.recipe) {
    const r = RECIPES.find((x) => x.id === String(input.recipe));
    if (!r) return { ok: false, error: '未知工作流' };
    return launchAgent(r.template, agent);
  }
  const root = String(input.root || '');
  const rec = findArtifact(root);
  const skillId = normalizeTypeId(rec?.skill || input.skill);
  const skill = SKILL_BY_ID[skillId];
  if (!skill) return { ok: false, error: `未知作品类型: ${skillId || rec?.skill || ''}` };
  return launchAgent(buildStarter(rec || { root, title: input.title || path.basename(root) }, skill), agent);
}

const chunkUploads = new Map();

function inspectOatypePackage(filePath) {
  const resolved = path.resolve(String(filePath || ''));
  if (!fs.existsSync(resolved) || !fs.statSync(resolved).isFile()) {
    return { ok: false, error: `.oatype 文件不存在: ${resolved}` };
  }
  const buf = fs.readFileSync(resolved);
  const sha256 = crypto.createHash('sha256').update(buf).digest('hex');
  const entries = parseTarGzBuffer(buf);
  const manifestEntry = entries.find((e) => e.path === 'artifact-type.json');
  if (!manifestEntry) return { ok: false, error: '.oatype 缺少 artifact-type.json' };
  const manifest = JSON.parse(manifestEntry.data.toString('utf8'));
  const id = manifest.slug || manifest.name || path.basename(resolved).replace(/-\d+\.\d+\.\d+.*$/, '');
  const skillEntry = entries.find((e) => e.path === (manifest.skill || 'SKILL.md'));
  return {
    ok: true,
    id,
    version: manifest.version || '0.1.0',
    sha256,
    capabilities: manifest.openArtifact?.uses || [],
    network: manifest.openArtifact?.network || [],
    skillMd: skillEntry ? skillEntry.data.toString('utf8').slice(0, 4000) : '',
    entries,
  };
}

function installOatypePackage(filePath) {
  const info = inspectOatypePackage(filePath);
  if (!info.ok) return info;
  const destDir = path.join(openArtifactHome(), 'types', info.id);
  fs.mkdirSync(destDir, { recursive: true });
  for (const e of info.entries) {
    const target = path.resolve(destDir, e.path);
    if (!target.startsWith(path.resolve(destDir) + path.sep)) continue;
    if (e.type === 'dir') { fs.mkdirSync(target, { recursive: true }); continue; }
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, e.data);
  }
  return { ok: true, id: info.id, version: info.version, dir: destDir };
}

const sseClients = new Set();
onRuntimeProgress((ev) => {
  const line = `data: ${JSON.stringify(ev)}\n\n`;
  for (const res of sseClients) {
    try { res.write(line); } catch { sseClients.delete(res); }
  }
});

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://127.0.0.1');
  res.setHeader('content-type', url.pathname === '/' ? 'text/html; charset=utf-8' : 'application/json; charset=utf-8');

  const allowedGet = [
    '/', '/api/health', '/api/list', '/api/preview', '/api/thumb',
    '/api/types', '/api/runtime/status', '/api/runtime/events',
    '/vendor/harness-embed.mjs',
  ];
  const allowedPost = [
    '/api/open', '/api/open-url', '/api/update', '/api/delete', '/api/restore',
    '/api/create', '/api/rename', '/api/stop', '/api/restart', '/api/restart-editor',
    '/api/start', '/api/register', '/api/forget',
    '/api/runtime/retry', '/api/runtime/import',
    '/api/types/toggle', '/api/types/trust-project', '/api/types/install',
  ];
  const isOaProxy = url.pathname.startsWith('/api/open-artifact.');

  if (req.method === 'GET') {
    if (!allowedGet.includes(url.pathname) && !isOaProxy) {
      res.statusCode = 404; return res.end('{}');
    }
    if (url.pathname === '/') return res.end(galleryHtml(url.searchParams.get('lang'), url.searchParams.get('scheme')));
    if (url.pathname === '/api/health') return res.end(JSON.stringify({ ok: true }));
    if (url.pathname === '/vendor/harness-embed.mjs') {
      res.setHeader('content-type', 'application/javascript; charset=utf-8');
      return res.end(fs.readFileSync(path.join(pluginRoot, 'src', 'vendor', 'harness-embed.mjs')));
    }
    if (url.pathname === '/api/list') return res.end(JSON.stringify(await listArtifactsViewsAsync()));
    if (url.pathname === '/api/types') return res.end(JSON.stringify(await listTypesInfo(readState().workspaceRoot)));
    if (url.pathname === '/api/runtime/status') return res.end(JSON.stringify({ ok: true, ...getRuntimeStatus() }));
    if (url.pathname === '/api/runtime/events') {
      res.writeHead(200, { 'content-type': 'text/event-stream; charset=utf-8', 'cache-control': 'no-store', connection: 'keep-alive' });
      res.write(`data: ${JSON.stringify(getRuntimeStatus())}\n\n`);
      sseClients.add(res);
      req.on('close', () => sseClients.delete(res));
      return;
    }
    if (isOaProxy) {
      const name = url.pathname.slice('/api/open-artifact.'.length);
      const query = Object.fromEntries(url.searchParams.entries());
      try {
        const out = await callDaemonApi(name, undefined, { method: 'GET', query });
        return res.end(JSON.stringify(out));
      } catch (err) {
        res.statusCode = 502;
        return res.end(JSON.stringify({ ok: false, error: err.message }));
      }
    }
    const skill = url.searchParams.get('skill') || '';
    const root = url.searchParams.get('root') || '';
    if (url.pathname === '/api/preview' || url.pathname === '/api/thumb') {
      const allowed = allowedArtifactRoot(root);
      const isThumb = url.pathname === '/api/thumb';
      const file = allowed ? (isThumb ? thumbPath(root) : previewEntry(root, skill)) : null;
      if (!file) { res.statusCode = 404; return res.end(); }
      try {
        const content = fs.readFileSync(file);
        res.setHeader('content-type', isThumb ? 'image/png' : 'text/html; charset=utf-8');
        return res.end(content);
      } catch { res.statusCode = 404; return res.end(); }
    }
    return res.end(JSON.stringify({ ok: false, error: 'unknown GET route' }));
  }

  if (req.method !== 'POST' || (!allowedPost.includes(url.pathname) && !isOaProxy)) {
    res.statusCode = 404; return res.end('{}');
  }
  const g = guardPost(req);
  if (g) { res.statusCode = g; return res.end('{}'); }

  const finish = (v) => res.end(JSON.stringify(v));
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

    if (isOaProxy) {
      const name = url.pathname.slice('/api/open-artifact.'.length);
      try {
        const out = await callDaemonApi(name, input, { method: 'POST', start: true });
        return finish(out);
      } catch (err) {
        res.statusCode = 502;
        return finish({ ok: false, error: err.message });
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
      if (!r.ok && !r.code) res.statusCode = 400;
      return finish(r);
    }
    if (url.pathname === '/api/start') return finish(await startFromArtifact(input));
    if (url.pathname === '/api/forget') {
      const rec = findArtifact(String(input.root || ''));
      if (!rec) return finish({ ok: false, error: '未找到记录' });
      try {
        fs.rmSync(recordFile(rec.root), { force: true });
        return finish({ ok: true });
      } catch (err) {
        return finish({ ok: false, error: err.message });
      }
    }
    if (url.pathname === '/api/update') {
      let rec = findArtifact(root);
      if (!rec && allowedArtifactRoot(root)) {
        const regRes = registerArtifact({ skill: skill || 'design', root, title: input.title });
        if (regRes.ok) rec = regRes.record;
      }
      if (!rec) return finish({ ok: false, error: 'not recorded' });
      if (typeof input.pinned === 'boolean') rec.pinned = input.pinned;
      if (input.title) {
        const clean = cleanTitle(input.title);
        if (clean) await renameArtifact(rec.skill, root, clean);
        rec.title = clean || rec.title;
      }
      writeRecord(rec);
      if (rec.id && typeof input.pinned === 'boolean') {
        await callDaemonApi('artifacts.update', { id: rec.id, pinned: input.pinned }).catch(() => {});
      }
      return finish({ ok: true, record: rec });
    }
    if (url.pathname === '/api/delete') {
      let rec = findArtifact(root);
      if (!rec && allowedArtifactRoot(root)) {
        const scanned = scanDesignProjects(readState().workspaceRoot || '').find((x) => x.root === root);
        if (scanned) rec = { v: 1, root, skill: scanned.skill, title: scanned.title, openedAt: new Date().toISOString() };
      }
      if (!rec) return finish({ ok: false, error: 'not recorded' });
      try {
        if (rec.id) await callDaemonApi('artifacts.delete', { id: rec.id }).catch(() => {});
        const out = trashArtifact(rec, { moveFolder: input.moveFolder === true });
        return finish({ ok: true, ...out });
      } catch (e) {
        return finish({ ok: false, error: e.message });
      }
    }
    if (url.pathname === '/api/restore') {
      try {
        const rec = restoreArtifact(input.id || '');
        if (rec.id) await callDaemonApi('artifacts.restore', { id: rec.id }).catch(() => {});
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
    if (url.pathname === '/api/runtime/retry') {
      ensureRuntime().catch(() => {});
      return finish({ ok: true, runtime: getRuntimeStatus() });
    }
    if (url.pathname === '/api/runtime/import') {
      if (typeof input.uploadId === 'string' && Number.isInteger(input.chunkIndex) && Number.isInteger(input.totalChunks)) {
        let entry = chunkUploads.get(input.uploadId);
        if (!entry) {
          entry = { chunks: new Array(input.totalChunks), received: 0, fileName: input.fileName || 'upload.tgz' };
          chunkUploads.set(input.uploadId, entry);
        }
        entry.chunks[input.chunkIndex] = Buffer.from(String(input.dataBase64 || ''), 'base64');
        entry.received++;
        if (entry.received < input.totalChunks) {
          return finish({ ok: true, pending: true, received: entry.received, totalChunks: entry.totalChunks });
        }
        chunkUploads.delete(input.uploadId);
        const full = Buffer.concat(entry.chunks);
        return finish(await importOfflineTarball({ buffer: full, fileName: entry.fileName }));
      }
      return finish(await importOfflineTarball({ filePath: input.filePath, base64: input.base64, fileName: input.fileName }));
    }
    if (url.pathname === '/api/types/toggle') {
      const id = String(input.id || '').trim();
      if (!id) return finish({ ok: false, error: 'missing type id' });
      const s = readOaSettings();
      const set = new Set(Array.isArray(s.disabledTypes) ? s.disabledTypes : []);
      if (input.enabled === false) set.add(id); else set.delete(id);
      writeOaSettings({ ...s, disabledTypes: [...set] });
      return finish({ ok: true, disabledTypes: [...set] });
    }
    if (url.pathname === '/api/types/trust-project') {
      const ws = path.resolve(String(input.workspace || readState().workspaceRoot || ''));
      if (!ws) return finish({ ok: false, error: 'missing workspace' });
      const s = readOaSettings();
      const list = new Set((Array.isArray(s.trustedProjects) ? s.trustedProjects : []).map((p) => path.resolve(p)));
      list.add(ws);
      writeOaSettings({ ...s, trustedProjects: [...list] });
      return finish({ ok: true, trustedProjects: [...list] });
    }
    if (url.pathname === '/api/types/install') {
      try {
        if (input.preview) {
          const prev = inspectOatypePackage(input.filePath);
          if (!prev.ok) return finish(prev);
          const { entries: _entries, ...rest } = prev;
          return finish(rest);
        }
        if (input.confirm !== true) return finish({ ok: false, error: '需要 confirm: true 二次确认' });
        return finish(installOatypePackage(input.filePath));
      } catch (e) {
        return finish({ ok: false, error: e.message });
      }
    }
    if (url.pathname === '/api/stop' || url.pathname === '/api/restart-editor') {
      return finish({ ok: true });
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
  listArtifactsViewsAsync,
  openSkillEditor,
  trashArtifact,
  restoreArtifact,
  renameArtifact,
  createExample,
  galleryHtml,
  findArtifact,
  writeRecord,
  GALLERY_STR,
  dshHome,
  server,
};

if (process.argv[1] === __filename) {
  migrateLegacyDesignHome();
  server.on('error', (e) => console.error('gallery server error:', e.message));
  server.listen(PORT, '127.0.0.1', () => console.log(`gallery listening on ${PORT}`));
}
