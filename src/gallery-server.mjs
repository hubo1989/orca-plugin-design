#!/usr/bin/env node
// Prototype Studio · 独立项目库服务（detached，固定 3480）
// 视觉与交互完全对齐 dsh-claude-artifacts (baoyu-design v2.12.0)
import { execFile, execFileSync } from 'node:child_process';
import http from 'node:http';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

import {
  SKILLS,
  SKILL_BY_ID,
  TITLES,
  TINTS,
  FOLDER,
  ROOT_MARKERS,
  DEFAULT_PORTS,
  PROMPTS,
  EDITOR_FILES,
  NOT_CONTENT,
  EXAMPLE_TEMPLATES,
  EXAMPLE_INDEX,
} from './skills-meta.mjs';

const __filename = fileURLToPath(import.meta.url);
const pluginRoot = path.dirname(path.dirname(__filename));
const STATE_FILE = path.join(os.tmpdir(), 'prototype-studio-state.json');
const BAOYU_SKILLS_DIR = path.join(pluginRoot, 'vendor', 'baoyu-design', 'skills');
const PORT = Number(process.env.PORT) || 3480;
const OPEN_TIMEOUT_MS = 30000;
const TITLE_MAX = 200;
const STAMP_MAX_ENTRIES = 20000;
const TRASH_ID = /^[0-9a-f]{24}-\d+$/;

function dshHome() {
  const set = process.env.ORCA_DESIGN_HOME?.trim() || process.env.DSH_HOME?.trim();
  if (set) return set;
  const home = process.env.HOME || os.homedir();
  if (process.platform === 'darwin') return path.join(home, 'Library', 'Application Support', 'orca', 'baoyu-design');
  if (process.platform === 'win32') return path.join(process.env.APPDATA || path.join(home, 'AppData', 'Roaming'), 'orca', 'baoyu-design');
  return path.join(process.env.XDG_CONFIG_HOME || path.join(home, '.config'), 'orca', 'baoyu-design');
}

function artifactsDir() { return path.join(dshHome(), 'artifacts'); }
function trashDir() { return path.join(dshHome(), 'trash'); }
const folderHash = (root) => crypto.createHash('sha256').update(root).digest('hex').slice(0, 24);
function recordFile(root) { return path.join(artifactsDir(), `${folderHash(root)}.json`); }

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

function artifactTitle(skill, root) {
  const at = TITLES[skill];
  if (!at) return path.basename(root);
  try {
    const val = JSON.parse(fs.readFileSync(path.join(root, at[0]), 'utf8'))[at[1]];
    const title = typeof val === 'string' ? val.trim() : '';
    if (title && title !== 'project') return title;
  } catch {}
  return path.basename(root);
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
  };
  writeRecord(record);
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

// 真实安装路径判定
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

// 读取焦点工作区
const PROFILE_DB = path.join(process.env.HOME || os.homedir(), 'Library', 'Application Support', 'orca', 'profiles', 'local-default', 'profile-state.db');
function readState() {
  let explicit = {};
  try { explicit = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')); } catch {}
  if (explicit.workspaceRoot) return explicit;
  try {
    const raw = fs.readFileSync(PROFILE_DB);
    const text = raw.toString('utf8');
    const m = text.match(/activeWorktreeId"\s*:\s*"[^"]*::([^"\\]+)"/);
    if (m) {
      const p = m[1].replace(/\\u002F/g, '/').replace(/\\\\/g, '/');
      return { workspaceRoot: p, workspaceName: p.split('/').filter(Boolean).pop() || '' };
    }
  } catch {}
  try {
    const out = execFileSync('sqlite3', [PROFILE_DB,
      "SELECT payload FROM profile_state_documents WHERE domain='workspaceSession'"], { timeout: 3000, encoding: 'utf8' });
    const ws = JSON.parse(out);
    const id = ws.activeWorktreeId || '';
    const p = id.includes('::') ? id.split('::').pop() : '';
    if (p) return { workspaceRoot: p, workspaceName: p.split('/').filter(Boolean).pop() || '' };
  } catch {}
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

function listArtifactsViews() {
  const state = readState();
  const workspaceRoot = state.workspaceRoot || '';
  const map = new Map();

  // 1. 读取持久化历史记录
  let names = [];
  try { names = fs.readdirSync(artifactsDir()); } catch {}
  for (const name of names) {
    if (!name.endsWith('.json')) continue;
    const rec = readRecord(path.join(artifactsDir(), name));
    if (rec === null || !fs.existsSync(rec.root)) continue;
    map.set(rec.root, rec);
  }

  // 2. 混合扫描当前工作区，发现新项目自动录入持久化
  if (workspaceRoot) {
    const scanned = scanDesignProjects(workspaceRoot);
    for (const item of scanned) {
      if (!map.has(item.root)) {
        const rec = recordOpened(item.skill, item.root, new Date());
        map.set(item.root, rec);
      }
    }
  }

  // 3. 构建视图
  const views = [];
  for (const [root, rec] of map.entries()) {
    const s = SKILL_BY_ID[rec.skill];
    if (!s) continue;
    const title = artifactTitle(rec.skill, root) || rec.title || path.basename(root);
    const mtime = contentStamp(root);
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
      shared: isShared(root),
      deletable: isDeletable(rec.skill, root),
      meta: projectMeta(rec.skill, root),
      tail: root.split('/').slice(-2).join('/'),
      openable: true,
    });
  }

  // 排序：先置顶，再按 openedAt 倒序
  views.sort((a, b) => {
    if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
    return b.openedAt.localeCompare(a.openedAt);
  });

  return {
    ok: true,
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
    const roots = listArtifactsViews().artifacts.filter((i) => i.skill === skillId);
    if (!roots.length) return { ok: false, error: `no ${skillId} project` };
    root = roots[0].root;
  }
  // 使用官方默认端口，不加 --port，支持 artifact.mjs 热复用已运行的实例
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

async function createExample(skillId, nameInput) {
  const tpl = EXAMPLE_TEMPLATES[skillId];
  if (!tpl) return { ok: false, error: `${skillId} 项目由 agent 创建（无静态示例模板）` };
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
  const now = new Date().toISOString().replace(/\.\d+Z$/, 'Z');
  for (const [rel, content] of Object.entries(tpl.files)) {
    const p = path.join(root, rel);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    if (content === '__INDEX__') {
      const idx = { ...EXAMPLE_INDEX[skillId], createdOnFiles: { v: 1, at: now }, title: name,
        lastChange: { by: 'prototype-studio', at: now, via: 'Orca plugin', note: 'Example scaffold' } };
      fs.writeFileSync(p, JSON.stringify(idx, null, 2));
    } else {
      fs.writeFileSync(p, content, 'utf8');
    }
  }
  recordOpened(skillId, root);
  const chk = await runNode([artifactCli(skillId), 'check', root]);
  let problems = null;
  try { problems = JSON.parse(chk.stdout).problems ?? null; } catch {}
  return { ok: true, root, problems };
}

function galleryHtml() {
  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>作品 · Prototype Studio</title>
<style>
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
  --dsw-focus-ring-color: light-dark(#1d64f2, #3b82f6);
  --dsw-focus-ring-width: 2px;
  --dsh-frame-top-clearance: 0px;
}
* { box-sizing: border-box; margin: 0; padding: 0; }
body {
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
  background: var(--dsw-alias-bg-base);
  color: var(--dsw-alias-label-primary);
  margin: 0;
  padding: 0;
  height: 100vh;
  overflow: hidden;
}
.bda-page {
  position: relative;
  width: 100%;
  min-width: 0;
  height: 100%;
  min-height: 0;
  color: var(--dsw-alias-label-primary);
  background: var(--dsw-alias-bg-base);
  font-size: 14px;
  line-height: 1.6;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}
.bda-scroll {
  flex: 1;
  min-height: 0;
  overflow: auto;
  scrollbar-gutter: stable;
}
.bda-content {
  max-width: 1120px;
  margin: 0 auto;
  padding: 0 clamp(24px, 4vw, 48px) 56px;
}
.bda-heading {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 12px 16px;
  padding-top: 28px;
  margin-bottom: 24px;
}
.bda-heading-title {
  display: flex;
  align-items: baseline;
  gap: 12px;
}
.bda-heading h1 {
  margin: 0;
  font-size: 20px;
  font-weight: 500;
  line-height: 28px;
}
.bda-heading .bda-ws {
  font-size: 13px;
  color: var(--dsw-alias-label-tertiary);
}
.bda-tools {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-left: auto;
}
.bda-tool {
  position: relative;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  padding: 0;
  border: 0;
  border-radius: 8px;
  background: none;
  color: var(--dsw-alias-label-secondary);
  cursor: pointer;
}
.bda-tool:hover, .bda-tool[aria-expanded=true] {
  background: var(--dsw-alias-interactive-bg-hover);
  color: var(--dsw-alias-label-primary);
}
.bda-tool[data-active=true]::after {
  content: "";
  position: absolute;
  top: 6px;
  right: 6px;
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--dsw-alias-state-business-primary);
}
.bda-search {
  display: flex;
  align-items: center;
  gap: 6px;
  width: min(240px, 50vw);
  height: 32px;
  padding: 0 8px 0 10px;
  border: .5px solid var(--dsw-alias-border-l2);
  border-radius: 8px;
  color: var(--dsw-alias-label-tertiary);
}
.bda-search:focus-within {
  border-color: var(--dsw-alias-state-business-primary);
}
.bda-search input {
  flex: 1;
  min-width: 0;
  height: 100%;
  border: 0;
  padding: 0;
  background: none;
  color: var(--dsw-alias-label-primary);
  font: inherit;
  font-size: 13px;
  outline: none;
}
.bda-search input::placeholder { color: var(--dsw-alias-label-caption); }
.bda-search input::-webkit-search-cancel-button { display: none; }
.bda-search button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  margin-right: -4px;
  padding: 0;
  border: 0;
  border-radius: 6px;
  background: none;
  color: inherit;
  cursor: pointer;
}
.bda-search button:hover { background: var(--dsw-alias-interactive-bg-hover); }
.bda-section-title {
  margin: 0 0 12px;
  font-size: 13px;
  font-weight: 400;
  line-height: 20px;
  color: var(--dsw-alias-label-tertiary);
}
.bda-tiles {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(118px, 1fr));
  gap: 14px;
  margin: 0 0 36px;
  padding: 0;
  list-style: none;
}
.bda-tile {
  display: flex;
  flex-direction: column;
  gap: 8px;
  width: 100%;
  padding: 0;
  border: 0;
  background: none;
  color: inherit;
  font: inherit;
  text-align: left;
  cursor: pointer;
}
.bda-tile-art {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
  aspect-ratio: 7/5;
  border-radius: 14px;
  overflow: hidden;
  background: color-mix(in srgb, var(--bda-tint) 24%, var(--dsw-alias-bg-base));
  color: color-mix(in srgb, var(--bda-tint) 78%, var(--dsw-alias-label-primary));
  transition: background-color .15s;
}
.bda-tile:hover .bda-tile-art {
  background: color-mix(in srgb, var(--bda-tint) 34%, var(--dsw-alias-bg-base));
}
.bda-tile:focus-visible { outline: none; }
.bda-tile:focus-visible .bda-tile-art {
  outline: var(--dsw-focus-ring-width, 2px) solid var(--dsw-focus-ring-color, var(--dsw-alias-state-business-primary));
  outline-offset: 2px;
}
.bda-tile-squiggle {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  opacity: .28;
}
.bda-tile-label {
  padding-left: 2px;
  font-size: 14px;
  line-height: 20px;
}
.bda-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
  gap: 20px;
  margin: 0;
  padding: 0;
  list-style: none;
}
.bda-item {
  position: relative;
  min-width: 0;
}
.bda-card {
  display: flex;
  flex-direction: column;
  width: 100%;
  padding: 0;
  border: .5px solid var(--dsw-alias-border-l2);
  border-radius: 14px;
  overflow: hidden;
  background: var(--dsw-alias-bg-base);
  color: inherit;
  font: inherit;
  text-align: left;
  cursor: pointer;
  transition: background-color .15s;
}
.bda-item:hover .bda-card {
  background: var(--dsw-alias-interactive-bg-hover);
}
.bda-card:disabled { cursor: progress; }
.bda-card:focus-visible, .bda-row:focus-visible {
  outline: var(--dsw-focus-ring-width, 2px) solid var(--dsw-focus-ring-color, var(--dsw-alias-state-business-primary));
  outline-offset: 2px;
}
.bda-preview {
  position: relative;
  display: block;
  width: 100%;
  aspect-ratio: 2/1;
  overflow: hidden;
  background: color-mix(in srgb, var(--bda-tint) 16%, var(--dsw-alias-bg-base));
}
.bda-sheet {
  position: absolute;
  left: 12%;
  right: 12%;
  top: 13%;
  bottom: -8px;
  border-radius: 8px 8px 0 0;
  overflow: hidden;
  background: var(--dsw-alias-bg-base);
  box-shadow: 0 0 0 .5px var(--dsw-alias-border-l2), 0 6px 18px -8px rgba(0,0,0,.28);
  transition: transform .2s;
}
.bda-item:hover .bda-sheet { transform: translateY(-3px); }
.bda-slide, .bda-film, .bda-paper {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  padding: 14px 16px;
  overflow: hidden;
}
.bda-paper-title, .bda-film-title {
  font-size: 12px;
  font-weight: 600;
  line-height: 1.3;
  color: var(--dsw-alias-label-primary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.bda-line {
  margin-top: auto;
  width: 48%;
  height: 4px;
  border-radius: 2px;
  background: color-mix(in srgb, var(--bda-tint) 60%, var(--dsw-alias-bg-base));
}
.bda-boards, .bda-swatches, .bda-kpis {
  display: flex;
  gap: 6px;
  margin-top: auto;
}
.bda-board {
  flex: 1;
  height: 28px;
  border-radius: 4px;
  border: 1px dashed var(--dsw-alias-border-l1);
  background: var(--dsw-alias-interactive-bg-hover);
}
.bda-swatch {
  width: 16px;
  height: 16px;
  border-radius: 50%;
  background: var(--bda-tint);
}
.bda-swatch:nth-child(2) { opacity: .6; }
.bda-swatch:nth-child(3) { opacity: .3; }
.bda-kpi {
  flex: 1;
  height: 24px;
  border-radius: 4px;
  background: var(--dsw-alias-interactive-bg-hover);
  border: .5px solid var(--dsw-alias-border-l2);
}
.bda-film {
  background: #111;
  color: #fff;
  align-items: center;
  justify-content: center;
}
.bda-film-title {
  color: #eee;
  width: 100%;
  text-align: center;
  margin-bottom: 4px;
}
.bda-film-bar {
  position: absolute;
  left: 0;
  right: 0;
  bottom: 0;
  height: 4px;
  background: var(--bda-tint);
}
.bda-busy {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  background: rgba(0,0,0,.6);
  color: #fff;
  font-size: 12px;
  font-weight: 500;
}
.bda-spinner {
  width: 12px;
  height: 12px;
  border: 1.5px solid currentColor;
  border-top-color: transparent;
  border-radius: 50%;
  animation: spin .7s linear infinite;
}
@keyframes spin { to { transform: rotate(360deg); } }
.bda-info {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 14px 12px;
  min-width: 0;
}
.bda-glyph {
  flex: none;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  color: var(--bda-tint);
}
.bda-text {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
}
.bda-name {
  font-size: 13px;
  font-weight: 500;
  line-height: 18px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.bda-meta {
  font-size: 12px;
  line-height: 16px;
  color: var(--dsw-alias-label-tertiary);
  margin-top: 1px;
}
.bda-actions {
  position: absolute;
  top: 8px;
  right: 8px;
  display: flex;
  align-items: center;
  gap: 4px;
  opacity: 0;
  transition: opacity .15s;
}
.bda-item:hover .bda-actions, .bda-item[data-menu="true"] .bda-actions, .bda-item:focus-within .bda-actions {
  opacity: 1;
}
.bda-act {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  padding: 0;
  border: 0;
  border-radius: 7px;
  background: var(--dsw-alias-bg-base);
  box-shadow: 0 1px 3px rgba(0,0,0,.15);
  color: var(--dsw-alias-label-secondary);
  cursor: pointer;
}
.bda-act:hover {
  background: var(--dsw-alias-bg-base);
  color: var(--dsw-alias-label-primary);
  filter: brightness(0.95);
}
.bda-act[data-on=true] {
  opacity: 1;
  color: var(--dsw-alias-state-business-primary);
}
.bda-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin: 0;
  padding: 0;
  list-style: none;
}
.bda-row {
  display: flex;
  align-items: center;
  gap: 12px;
  width: 100%;
  padding: 8px 12px;
  border: .5px solid var(--dsw-alias-border-l2);
  border-radius: 10px;
  background: var(--dsw-alias-bg-base);
  color: inherit;
  font: inherit;
  text-align: left;
  cursor: pointer;
  transition: background-color .15s;
}
.bda-row:hover { background: var(--dsw-alias-interactive-bg-hover); }
.bda-row .bda-name { flex: 1; min-width: 0; }
.bda-row .bda-meta { flex: none; margin-left: 16px; font-size: 12px; color: var(--dsw-alias-label-tertiary); }
.bda-row-tools {
  position: absolute;
  right: 12px;
  top: 50%;
  transform: translateY(-50%);
  display: flex;
  align-items: center;
  gap: 4px;
}
.bda-list .bda-act {
  background: transparent;
  box-shadow: none;
}
.bda-list .bda-act:hover {
  background: var(--dsw-alias-interactive-bg-hover);
}
.bda-list .bda-item:hover .bda-act, .bda-list .bda-act[data-on="true"] {
  opacity: 1;
}
.bda-menu {
  position: fixed;
  z-index: 1000;
  min-width: 200px;
  padding: 6px;
  border: .5px solid var(--dsw-alias-border-l2);
  border-radius: 12px;
  background: var(--dsw-alias-bg-base);
  box-shadow: 0 8px 28px -6px rgba(0,0,0,.28);
  font-size: 14px;
}
.bda-menu-item {
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
  min-height: 34px;
  padding: 5px 10px;
  border: 0;
  border-radius: 8px;
  background: none;
  color: var(--dsw-alias-label-primary);
  font: inherit;
  text-align: left;
  white-space: nowrap;
  cursor: pointer;
}
.bda-menu-item:hover, .bda-menu-item:focus-visible, .bda-menu-item[aria-expanded=true] {
  background: var(--dsw-alias-interactive-bg-hover);
  outline: none;
}
.bda-menu-item[data-danger=true] { color: var(--dsw-alias-state-error-primary); }
.bda-menu-label { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; }
.bda-menu-value { margin-left: 16px; color: var(--dsw-alias-label-tertiary); }
.bda-menu-count { margin-left: 16px; color: var(--dsw-alias-label-tertiary); font-variant-numeric: tabular-nums; }
.bda-menu-key { margin-left: 20px; color: var(--dsw-alias-label-tertiary); font: inherit; font-size: 12px; }
.bda-menu-rule { height: .5px; margin: 6px 4px; background: var(--dsw-alias-border-l2); }
.bda-menu-chev { margin-left: 6px; color: var(--dsw-alias-label-tertiary); }
.bda-menu-row { position: relative; }
.bda-submenu {
  position: absolute;
  left: calc(100% + 8px);
  top: -6px;
  z-index: 1001;
  min-width: 190px;
  padding: 6px;
  border: .5px solid var(--dsw-alias-border-l2);
  border-radius: 12px;
  background: var(--dsw-alias-bg-base);
  box-shadow: 0 8px 28px -6px rgba(0,0,0,.28);
  display: none;
}
.bda-menu-row:hover .bda-submenu { display: block; }
.bda-check {
  flex: none;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 18px;
  height: 18px;
  border: 1px solid var(--dsw-alias-border-l1);
  border-radius: 5px;
  color: transparent;
}
.bda-check[data-on=true] {
  border-color: var(--dsw-alias-state-business-primary);
  background: var(--dsw-alias-state-business-primary);
  color: #fff;
}
.bda-tick { flex: none; margin-left: 16px; color: var(--dsw-alias-state-business-primary); }
.bda-scrim {
  position: fixed;
  inset: 0;
  z-index: 1100;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
  background: rgba(0,0,0,.36);
}
.bda-dialog {
  width: min(420px, 100%);
  padding: 20px;
  border-radius: 16px;
  background: var(--dsw-alias-bg-base);
  box-shadow: 0 18px 48px -12px rgba(0,0,0,.4);
}
.bda-dialog h2 {
  margin: 0 0 12px;
  font-size: 16px;
  font-weight: 600;
  line-height: 24px;
  overflow-wrap: anywhere;
}
.bda-dialog p {
  margin: 0 0 16px;
  color: var(--dsw-alias-label-secondary);
  font-size: 13px;
  line-height: 1.55;
  overflow-wrap: anywhere;
}
.bda-dialog input {
  box-sizing: border-box;
  width: 100%;
  height: 38px;
  padding: 0 12px;
  border: 1px solid var(--dsw-alias-border-l2);
  border-radius: 10px;
  background: none;
  color: var(--dsw-alias-label-primary);
  font: inherit;
  outline: none;
  margin-bottom: 16px;
}
.bda-dialog input:focus { border-color: var(--dsw-alias-state-business-primary); }
.bda-dialog-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}
.bda-btn {
  height: 34px;
  padding: 0 14px;
  border: 0;
  border-radius: 9px;
  background: var(--dsw-alias-interactive-bg-hover);
  color: var(--dsw-alias-label-primary);
  font: inherit;
  font-weight: 500;
  cursor: pointer;
}
.bda-btn:hover { background: color-mix(in srgb, var(--dsw-alias-label-primary) 12%, var(--dsw-alias-bg-base)); }
.bda-btn:disabled { color: var(--dsw-alias-label-caption); cursor: default; }
.bda-btn[data-primary=true] { background: var(--dsw-alias-state-business-primary); color: #fff; }
.bda-btn[data-danger=true] {
  border: 1px solid var(--dsw-alias-state-error-primary);
  background: color-mix(in srgb, var(--dsw-alias-state-error-primary) 10%, var(--dsw-alias-bg-base));
  color: var(--dsw-alias-state-error-primary);
}
.bda-toast {
  position: fixed;
  left: 50%;
  bottom: 24px;
  z-index: 1200;
  display: flex;
  align-items: center;
  gap: 10px;
  max-width: min(560px, calc(100% - 32px));
  padding: 9px 12px 9px 14px;
  border: .5px solid var(--dsw-alias-border-l2);
  border-radius: 12px;
  background: var(--dsw-alias-bg-base);
  box-shadow: 0 8px 28px -6px rgba(0,0,0,.28);
  transform: translateX(-50%);
  font-size: 13px;
}
.bda-toast[data-kind=error] { color: var(--dsw-alias-state-error-primary); }
.bda-toast-undo {
  padding: 2px 8px;
  border: 0;
  border-radius: 6px;
  background: none;
  color: var(--dsw-alias-state-business-primary);
  font: inherit;
  font-weight: 500;
  cursor: pointer;
}
.bda-toast-undo:hover { background: var(--dsw-alias-interactive-bg-hover); }
.bda-toast-close {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 20px;
  height: 20px;
  padding: 0;
  border: 0;
  border-radius: 6px;
  background: none;
  color: var(--dsw-alias-label-tertiary);
  cursor: pointer;
}
.bda-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  padding: 56px 20px;
  text-align: center;
  color: var(--dsw-alias-label-tertiary);
}
.bda-empty h2 { margin: 0; font-size: 15px; font-weight: 500; color: var(--dsw-alias-label-secondary); }
.bda-empty p { margin: 0; max-width: 420px; font-size: 13px; line-height: 1.6; }
/* 全屏 iframe 编辑器视图 */
#editorView {
  display: flex;
  flex-direction: column;
  width: 100vw;
  height: 100vh;
  position: absolute;
  inset: 0;
  z-index: 500;
  background: var(--dsw-alias-bg-base);
}
.editor-bar {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 8px 16px;
  border-bottom: .5px solid var(--dsw-alias-border-l2);
  background: var(--dsw-alias-bg-base);
  flex: none;
}
.editor-bar .title {
  font-size: 13px;
  font-weight: 600;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  flex: 1;
}
#frame {
  flex: 1;
  border: 0;
  width: 100%;
  height: 100%;
  background: var(--dsw-alias-bg-base);
}
.hidden { display: none !important; }
</style>
</head>
<body>

<div class="bda-page" id="listView">
  <div class="bda-scroll">
    <div class="bda-content">
      <div class="bda-heading">
        <div class="bda-heading-title">
          <h1>作品</h1>
          <span class="bda-ws" id="wsLabel"></span>
        </div>
        <div class="bda-tools">
          <div class="bda-search">
            <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.3"><circle cx="7" cy="7" r="4.5"/><path d="m10.5 10.5 3 3"/></svg>
            <input id="q" placeholder="搜索作品 (/)" aria-label="搜索作品">
            <button id="clearSearch" class="hidden" title="清除搜索" aria-label="清除搜索">
              <svg viewBox="0 0 16 16" width="12" height="12" stroke="currentColor" stroke-width="1.3"><path d="m4.5 4.5 7 7m0-7-7 7"/></svg>
            </button>
          </div>
          <button class="bda-tool" id="filterBtn" title="排序和筛选" aria-label="排序和筛选">
            <svg viewBox="0 0 16 16" width="16" height="16" stroke="currentColor" stroke-width="1.3"><path d="M2.5 4.5h11M4.5 8h7M6.5 11.5h3"/></svg>
          </button>
          <button class="bda-tool" id="viewModeBtn" title="切换视图" aria-label="切换视图">
            <svg id="viewModeIcon" viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.3"></svg>
          </button>
          <button class="bda-tool" id="reloadBtn" title="刷新列表" aria-label="刷新列表">
            <svg viewBox="0 0 16 16" width="15" height="15" stroke="currentColor" stroke-width="1.3" fill="none"><path d="M13.5 8a5.5 5.5 0 1 1-1.6-3.9L14 6m0-4v4h-4"/></svg>
          </button>
        </div>
      </div>

      <div class="bda-section-title">新建</div>
      <ul class="bda-tiles" id="tiles"></ul>

      <div class="bda-section-title" id="listHeading">全部作品</div>
      <div id="container"></div>
    </div>
  </div>
</div>

<div id="editorView" class="hidden">
  <div class="editor-bar">
    <button class="bda-btn" id="backBtn">← 作品</button>
    <span class="title" id="editorTitle"></span>
    <button class="bda-btn" id="popBtn">单独打开 ↗</button>
  </div>
  <iframe id="frame" allow="clipboard-read; clipboard-write"></iframe>
</div>

<div id="dialogScrim" class="bda-scrim hidden"></div>
<div id="toast" class="hidden"></div>
<div id="menuLayer"></div>

<script>
// 图标库与色彩
const TINTS = ${JSON.stringify(TINTS)};
const SKILLS_CONFIG = ${JSON.stringify(SKILLS)};
const SKILL_MAP = Object.fromEntries(SKILLS_CONFIG.map(s => [s.id, s]));

const SVG_ICONS = {
  search: '<svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.3"><circle cx="7" cy="7" r="4.5"/><path d="m10.5 10.5 3 3"/></svg>',
  filter: '<svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.3"><path d="M2.5 4.5h11M4.5 8h7M6.5 11.5h3"/></svg>',
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
    case 'claude-slides':
      inner = '<path d="M2.75 3.5h14.5M4 3.5v8.25a1 1 0 0 0 1 1h10a1 1 0 0 0 1-1V3.5M7.25 16.75 10 12.75l2.75 4" ' + p + '/>';
      break;
    case 'claude-design':
      inner = '<path d="M10 2.75a7.25 7.25 0 1 0 0 14.5c1.1 0 1.75-.8 1.75-1.7 0-.5-.2-.9-.45-1.25-.25-.35-.45-.7-.45-1.15 0-.95.75-1.65 1.7-1.65h1.6a3.1 3.1 0 0 0 3.1-3.1c0-3.1-3.2-5.65-7.25-5.65Z" ' + p + '/><circle cx="6.4" cy="9.4" r=".9" fill="currentColor"/><circle cx="8.8" cy="6.3" r=".9" fill="currentColor"/><circle cx="12.5" cy="6.8" r=".9" fill="currentColor"/>';
      break;
    case 'claude-design-system':
      inner = '<circle cx="6.5" cy="6.5" r="3.25" ' + p + '/><circle cx="13.5" cy="6.5" r="3.25" ' + p + '/><circle cx="10" cy="13" r="3.25" ' + p + '/>';
      break;
    case 'claude-dashboard':
      inner = '<rect x="2.75" y="10" width="4.5" height="7.25" rx="1" ' + p + '/><rect x="7.75" y="2.75" width="4.5" height="14.5" rx="1" ' + p + '/><rect x="12.75" y="7" width="4.5" height="10.25" rx="1" ' + p + '/>';
      break;
    case 'claude-motion':
      inner = '<rect x="2.75" y="4" width="14.5" height="12" rx="2" ' + p + '/><path d="m8.5 7.75 4 2.25-4 2.25v-4.5Z" ' + p + '/>';
      break;
    default:
      inner = '<rect x="3" y="3" width="14" height="14" rx="2" ' + p + '/>';
  }
  return '<svg viewBox="0 0 20 20" width="' + size + '" height="' + size + '" fill="none" style="display:block;flex:none">' + inner + '</svg>';
}

function drawnHtml(skill, title) {
  const escTitle = esc(title);
  switch (skill) {
    case 'claude-slides':
      return '<div class="bda-slide"><div class="bda-paper-title">' + escTitle + '</div><div class="bda-line"></div></div>';
    case 'claude-design':
      return '<div class="bda-paper"><div class="bda-paper-title">' + escTitle + '</div><div class="bda-boards"><div class="bda-board"></div><div class="bda-board"></div></div></div>';
    case 'claude-design-system':
      return '<div class="bda-paper"><div class="bda-paper-title">' + escTitle + '</div><div class="bda-swatches"><span class="bda-swatch"></span><span class="bda-swatch"></span><span class="bda-swatch"></span></div></div>';
    case 'claude-dashboard':
      return '<div class="bda-paper"><div class="bda-paper-title">' + escTitle + '</div><div class="bda-kpis"><span class="bda-kpi"></span><span class="bda-kpi"></span></div></div>';
    case 'claude-motion':
      return '<div class="bda-film"><div class="bda-film-title">' + escTitle + '</div><svg viewBox="0 0 20 20" width="22" height="22" style="display:block;margin:auto"><path d="M7 5.5v9l7.5-4.5L7 5.5Z" fill="currentColor"/></svg><div class="bda-film-bar"></div></div>';
    default:
      return '<div class="bda-paper"><div class="bda-paper-title">' + escTitle + '</div></div>';
  }
}

function esc(v) {
  return String(v ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

function ago(iso) {
  const then = Date.parse(iso);
  if (!Number.isFinite(then)) return '';
  const seconds = Math.round((then - Date.now()) / 1000);
  if (seconds > -60) return '刚刚打开';
  const steps = [['minute', 60], ['hour', 3600], ['day', 86400], ['week', 604800], ['month', 2629800], ['year', 31557600]];
  let unit = 'minute', size = 60;
  for (const [u, s] of steps) if (-seconds >= s) [unit, size] = [u, s];
  try {
    const rtf = new Intl.RelativeTimeFormat('zh-CN', { numeric: 'auto' });
    return rtf.format(Math.round(seconds / size), unit) + '打开';
  } catch {
    return Math.abs(Math.round(seconds / size)) + unit + '前打开';
  }
}

// 客户端状态管理
let state = {
  artifacts: [],
  workspaceName: '',
  workspaceRoot: '',
  search: '',
  viewMode: localStorage.getItem('ps_view_mode') || 'grid',
  filters: {
    sort: 'opened',
    types: [],
    date: 'any',
    sharing: 'any',
    pinned: false,
  },
  openingRoot: null,
};

async function api(path, opts) {
  const r = await fetch(path, opts);
  return r.json();
}

function showToast(msg, undoTrashId) {
  const t = document.getElementById('toast');
  t.innerHTML = '<span style="display:inline-flex;align-items:center">' + SVG_ICONS.info + '</span><span class="bda-toast-text">' + esc(msg) + '</span>' +
    (undoTrashId ? '<button type="button" class="bda-toast-undo" id="toastUndoBtn">撤销</button>' : '') +
    '<button type="button" class="bda-toast-close" id="toastCloseBtn"><svg viewBox="0 0 16 16" width="12" height="12" stroke="currentColor" stroke-width="1.3"><path d="m4.5 4.5 7 7m0-7-7 7"/></svg></button>';
  t.className = 'bda-toast';
  document.getElementById('toastCloseBtn').onclick = () => t.className = 'hidden';
  if (undoTrashId) {
    document.getElementById('toastUndoBtn').onclick = async () => {
      t.className = 'hidden';
      const r = await api('/api/restore', { method: 'POST', headers: {'content-type':'application/json'}, body: JSON.stringify({ id: undoTrashId }) });
      if (r.ok) {
        showToast('已恢复作品');
        await reload();
      } else {
        showToast('恢复失败: ' + (r.error || ''));
      }
    };
  }
  clearTimeout(t._timer);
  t._timer = setTimeout(() => t.className = 'hidden', undoTrashId ? 10000 : 3500);
}

function closeDialog() {
  document.getElementById('dialogScrim').className = 'bda-scrim hidden';
  document.getElementById('dialogScrim').innerHTML = '';
}

function openDialog(html) {
  const scrim = document.getElementById('dialogScrim');
  scrim.innerHTML = '<div class="bda-dialog">' + html + '</div>';
  scrim.className = 'bda-scrim';
  scrim.onclick = (e) => { if (e.target === scrim) closeDialog(); };
}

function closeMenu() {
  document.getElementById('menuLayer').innerHTML = '';
  document.querySelectorAll('.bda-item[data-menu="true"]').forEach(el => el.removeAttribute('data-menu'));
}
window.addEventListener('click', (e) => {
  if (!e.target.closest('.bda-menu') && !e.target.closest('.bda-tool') && !e.target.closest('.bda-act')) {
    closeMenu();
  }
});

// 筛选与排序算法
function matchesFilter(item) {
  const q = state.search.trim().toLowerCase();
  if (q) {
    const hay = (item.title + ' ' + (item.tail || '') + ' ' + item.skill).toLowerCase();
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
    const now = Date.now();
    const day = new Date(now);
    const today = new Date(day.getFullYear(), day.getMonth(), day.getDate()).getTime();
    const DAY = 86400000;
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
    if (sort === 'name') return a.title.localeCompare(b.title, 'zh-CN');
    const key = sort === 'updated' ? 'updatedAt' : (sort === 'created' ? 'firstOpenedAt' : 'openedAt');
    return (b[key] || '').localeCompare(a[key] || '');
  });
  return list;
}

function isFilterActive() {
  return state.filters.sort !== 'opened' || state.filters.types.length > 0 ||
    state.filters.date !== 'any' || state.filters.sharing !== 'any' || state.filters.pinned;
}

// 渲染磁贴
function renderTiles() {
  const ul = document.getElementById('tiles');
  ul.innerHTML = SKILLS_CONFIG.map(s => {
    return '<li style="--bda-tint:' + s.tint + '">' +
      '<button type="button" class="bda-tile" data-skill="' + s.id + '">' +
      '<span class="bda-tile-art">' +
      '<svg class="bda-tile-squiggle" viewBox="0 0 140 100" preserveAspectRatio="xMidYMid slice" fill="none" stroke="currentColor" stroke-width="1.1" stroke-dasharray="0 3.2" stroke-linecap="round" aria-hidden="true">' +
      '<path d="M4 84C20 16 42 98 62 42s38 58 74-28"/>' +
      '<path d="M6 88C24 22 44 104 66 46s36 56 72-26"/>' +
      '<path d="M2 80C18 12 40 92 58 38s40 58 76-28"/>' +
      '</svg>' +
      typeIconSvg(s.id, 36) +
      '</span>' +
      '<span class="bda-tile-label">' + esc(s.name) + '</span>' +
      '</button>' +
      '</li>';
  }).join('');
}

// 渲染主列表/网格
function renderItems() {
  const container = document.getElementById('container');
  const items = getSortedList();
  const isGrid = state.viewMode === 'grid';
  document.getElementById('viewModeIcon').innerHTML = isGrid ? SVG_ICONS.list : SVG_ICONS.grid;
  document.getElementById('viewModeBtn').title = isGrid ? '切换到列表视图' : '切换到网格视图';
  document.getElementById('filterBtn').setAttribute('data-active', isFilterActive() ? 'true' : 'false');
  document.getElementById('listHeading').textContent = '全部作品 (' + items.length + ')';

  if (!items.length) {
    container.innerHTML = '<div class="bda-empty">' +
      SVG_ICONS.info +
      '<h2>' + (state.search || isFilterActive() ? '没有符合条件的作品' : '还没有作品') + '</h2>' +
      '<p>' + (state.search || isFilterActive() ? '尝试清除搜索词或筛选条件。' : 'Agent 用 baoyu-design 的技能做出来的东西都会出现在这里。点上面的入口开始做一个。') + '</p>' +
      (isFilterActive() ? '<button type="button" class="bda-btn" id="clearFilterBtn" style="margin-top:12px">清除筛选</button>' : '') +
      '</div>';
    if (document.getElementById('clearFilterBtn')) {
      document.getElementById('clearFilterBtn').onclick = () => {
        state.filters = { sort: 'opened', types: [], date: 'any', sharing: 'any', pinned: false };
        state.search = '';
        document.getElementById('q').value = '';
        document.getElementById('clearSearch').className = 'hidden';
        renderItems();
      };
    }
    return;
  }

  if (isGrid) {
    container.innerHTML = '<ul class="bda-grid">' + items.map(it => {
      const isOpening = state.openingRoot === it.root;
      return '<li class="bda-item" data-root="' + esc(it.root) + '" data-skill="' + esc(it.skill) + '" style="--bda-tint:' + (TINTS[it.skill] || '#888') + '">' +
        '<button type="button" class="bda-card" data-act="open" ' + (isOpening ? 'disabled' : '') + '>' +
        '<span class="bda-preview">' +
        '<span class="bda-sheet">' + drawnHtml(it.skill, it.title) + '</span>' +
        (isOpening ? '<span class="bda-busy"><span class="bda-spinner"></span>正在打开…</span>' : '') +
        '</span>' +
        '<span class="bda-info">' +
        '<span class="bda-glyph">' + typeIconSvg(it.skill, 18) + '</span>' +
        '<span class="bda-text">' +
        '<span class="bda-name" title="' + esc(it.title) + '">' + esc(it.title) + '</span>' +
        '<span class="bda-meta">' + esc(it.meta ? it.meta + ' · ' : '') + ago(it.openedAt) + '</span>' +
        '</span>' +
        '</span>' +
        '</button>' +
        '<div class="bda-actions">' +
        '<button type="button" class="bda-act" data-act="more" title="更多操作">' + SVG_ICONS.more + '</button>' +
        '<button type="button" class="bda-act" data-act="pin" data-on="' + it.pinned + '" title="' + (it.pinned ? '取消固定' : '固定') + '">' +
        (it.pinned ? SVG_ICONS.pinFilled : SVG_ICONS.pin) +
        '</button>' +
        '</div>' +
        '</li>';
    }).join('') + '</ul>';
  } else {
    container.innerHTML = '<ul class="bda-list">' + items.map(it => {
      const isOpening = state.openingRoot === it.root;
      return '<li class="bda-item" data-root="' + esc(it.root) + '" data-skill="' + esc(it.skill) + '" style="--bda-tint:' + (TINTS[it.skill] || '#888') + '">' +
        '<button type="button" class="bda-row" data-act="open" ' + (isOpening ? 'disabled' : '') + '>' +
        '<span class="bda-glyph">' + (isOpening ? '<span class="bda-spinner"></span>' : typeIconSvg(it.skill, 18)) + '</span>' +
        '<span class="bda-name">' + esc(it.title) + '</span>' +
        '<span class="bda-meta">' + esc(it.meta ? it.meta + ' · ' : '') + ago(it.openedAt) + '</span>' +
        '</button>' +
        '<div class="bda-row-tools">' +
        '<button type="button" class="bda-act" data-act="pin" data-on="' + it.pinned + '" title="' + (it.pinned ? '取消固定' : '固定') + '">' +
        (it.pinned ? SVG_ICONS.pinFilled : SVG_ICONS.pin) +
        '</button>' +
        '<button type="button" class="bda-act" data-act="more" title="更多操作">' + SVG_ICONS.more + '</button>' +
        '</div>' +
        '</li>';
    }).join('') + '</ul>';
  }
}

// 打开编辑器交互
async function openItem(item) {
  state.openingRoot = item.root;
  renderItems();
  try {
    const res = await api('/api/open?skill=' + encodeURIComponent(item.skill) + '&root=' + encodeURIComponent(item.root));
    if (!res.ok) {
      showToast('打不开：' + (res.error || '未知错误'));
      return;
    }
    const frame = document.getElementById('frame');
    document.getElementById('editorTitle').textContent = item.title + ' · ' + (SKILL_MAP[item.skill]?.name || item.skill);
    frame.src = res.url;
    document.getElementById('popBtn').onclick = () => window.open(res.url, '_blank');
    document.getElementById('listView').classList.add('hidden');
    document.getElementById('editorView').classList.remove('hidden');
    history.pushState({ editor: true }, '', '#editor');
  } catch (err) {
    showToast('打开失败：' + err.message);
  } finally {
    state.openingRoot = null;
    renderItems();
  }
}

function backToGallery() {
  document.getElementById('editorView').classList.add('hidden');
  document.getElementById('listView').classList.remove('hidden');
  document.getElementById('frame').src = 'about:blank';
  if (location.hash) history.replaceState({}, '', location.pathname);
  reload();
}
window.addEventListener('popstate', () => {
  if (!document.getElementById('editorView').classList.contains('hidden')) backToGallery();
});
document.getElementById('backBtn').onclick = backToGallery;

// 更多菜单 Action Menu
function showActionsMenu(item, anchorEl) {
  const rect = anchorEl.getBoundingClientRect();
  const layer = document.getElementById('menuLayer');
  anchorEl.closest('.bda-item')?.setAttribute('data-menu', 'true');
  layer.innerHTML = '<div class="bda-menu" style="left:' + Math.min(rect.left, window.innerWidth - 220) + 'px;top:' + (rect.bottom + 6) + 'px">' +
    '<button type="button" class="bda-menu-item" data-menu-action="pin">' +
    SVG_ICONS.pin + '<span class="bda-menu-label">' + (item.pinned ? '取消固定' : '固定') + '</span><kbd class="bda-menu-key">P</kbd>' +
    '</button>' +
    '<button type="button" class="bda-menu-item" data-menu-action="rename">' +
    SVG_ICONS.rename + '<span class="bda-menu-label">重命名</span><kbd class="bda-menu-key">R</kbd>' +
    '</button>' +
    '<button type="button" class="bda-menu-item" data-menu-action="copy">' +
    SVG_ICONS.copy + '<span class="bda-menu-label">复制链接</span><kbd class="bda-menu-key">C</kbd>' +
    '</button>' +
    '<div class="bda-menu-rule"></div>' +
    '<button type="button" class="bda-menu-item" data-menu-action="delete" data-danger="true">' +
    SVG_ICONS.trash + '<span class="bda-menu-label">删除</span><kbd class="bda-menu-key">Del</kbd>' +
    '</button>' +
    '</div>';

  const menu = layer.querySelector('.bda-menu');
  menu.onclick = async (e) => {
    const btn = e.target.closest('[data-menu-action]');
    if (!btn) return;
    const act = btn.getAttribute('data-menu-action');
    closeMenu();
    if (act === 'pin') {
      await api('/api/update', { method: 'POST', headers: {'content-type':'application/json'}, body: JSON.stringify({ root: item.root, pinned: !item.pinned }) });
      await reload();
    } else if (act === 'rename') {
      openRenameDialog(item);
    } else if (act === 'copy') {
      const res = await api('/api/open?skill=' + encodeURIComponent(item.skill) + '&root=' + encodeURIComponent(item.root));
      if (res.ok && res.url) {
        await navigator.clipboard.writeText(res.url);
        showToast('链接已复制到剪贴板');
      } else {
        showToast('获取链接失败');
      }
    } else if (act === 'delete') {
      openDeleteDialog(item);
    }
  };
}

// 重命名弹窗
function openRenameDialog(item) {
  openDialog(
    '<h2>重命名作品</h2>' +
    '<p>为「' + esc(item.title) + '」设置新的标题：</p>' +
    '<input id="renameInput" value="' + esc(item.title) + '" maxlength="200" autofocus>' +
    '<div class="bda-dialog-actions">' +
    '<button type="button" class="bda-btn" id="renameCancel">取消</button>' +
    '<button type="button" class="bda-btn" data-primary="true" id="renameSave">保存</button>' +
    '</div>'
  );
  const input = document.getElementById('renameInput');
  input.focus();
  input.select();
  document.getElementById('renameCancel').onclick = closeDialog;
  document.getElementById('renameSave').onclick = async () => {
    const val = input.value.trim();
    if (!val || val === item.title) return closeDialog();
    closeDialog();
    const res = await api('/api/update', { method: 'POST', headers: {'content-type':'application/json'}, body: JSON.stringify({ root: item.root, title: val, skill: item.skill }) });
    if (res.ok) {
      showToast('已重命名为「' + val + '」');
      await reload();
    } else {
      showToast('重命名失败: ' + (res.error || ''));
    }
  };
}

// 删除确认弹窗
function openDeleteDialog(item) {
  const desc = item.deletable ?
    '这会移除这个作品，它的文件夹移到应用数据目录下的 baoyu-design/trash。' :
    '这会把它从作品列表移除。它的文件夹里还有其他工程文件，所以留在原处：' + item.root;
  openDialog(
    '<h2>删除“' + esc(item.title) + '”？</h2>' +
    '<p>' + esc(desc) + '</p>' +
    '<div class="bda-dialog-actions">' +
    '<button type="button" class="bda-btn" id="deleteCancel">取消</button>' +
    '<button type="button" class="bda-btn" data-danger="true" id="deleteConfirm">删除</button>' +
    '</div>'
  );
  document.getElementById('deleteCancel').onclick = closeDialog;
  document.getElementById('deleteConfirm').onclick = async () => {
    closeDialog();
    const res = await api('/api/delete', { method: 'POST', headers: {'content-type':'application/json'}, body: JSON.stringify({ root: item.root }) });
    if (res.ok) {
      showToast(item.deletable ? '已删除“' + item.title + '”。' : '已从作品里移除“' + item.title + '”，文件夹还在原处。', res.trash);
      await reload();
    } else {
      showToast('删除失败: ' + (res.error || ''));
    }
  };
}

// 新建弹窗（含示例创建与提示词复制）
function openCreateDialog(skillId) {
  const s = SKILL_MAP[skillId];
  if (!s) return;
  const canScaffold = !!EXAMPLE_TEMPLATES[skillId];
  openDialog(
    '<div style="display:flex;align-items:center;gap:10px;margin-bottom:12px">' +
    typeIconSvg(s.id, 26) +
    '<h2 style="margin:0">新建「' + esc(s.name) + '」</h2>' +
    '</div>' +
    '<p>' + esc(s.about) + '</p>' +
    '<div class="bda-dialog-actions" style="margin-top:20px;display:flex;gap:8px">' +
    '<button type="button" class="bda-btn" id="copyPromptBtn">📋 复制 Agent 提示词</button>' +
    (canScaffold ? '<button type="button" class="bda-btn" data-primary="true" id="createScaffoldBtn">✨ 创建空白示例</button>' : '') +
    '<button type="button" class="bda-btn" id="createCancel">取消</button>' +
    '</div>'
  );
  document.getElementById('createCancel').onclick = closeDialog;
  document.getElementById('copyPromptBtn').onclick = async () => {
    try {
      await navigator.clipboard.writeText(s.prompt);
      closeDialog();
      showToast('✓ 提示词已复制到剪贴板，发给 Agent 即可');
    } catch {
      showToast('复制失败，请手动复制：' + s.prompt);
    }
  };
  if (canScaffold) {
    document.getElementById('createScaffoldBtn').onclick = async () => {
      closeDialog();
      const res = await api('/api/create', { method: 'POST', headers: {'content-type':'application/json'}, body: JSON.stringify({ skill: skillId }) });
      if (res.ok && res.root) {
        await reload();
        const found = state.artifacts.find(a => a.root === res.root);
        if (found) await openItem(found);
      } else {
        showToast('创建失败: ' + (res.error || ''));
      }
    };
  }
}

// 筛选菜单 FilterMenu
function showFilterMenu(anchorEl) {
  const rect = anchorEl.getBoundingClientRect();
  const layer = document.getElementById('menuLayer');
  const typeCounts = new Map();
  state.artifacts.forEach(a => typeCounts.set(a.skill, (typeCounts.get(a.skill) || 0) + 1));
  const sortLabels = { opened: '最近打开', updated: '最近修改', created: '创建时间', name: '名称' };
  const dateLabels = { any: '不限', today: '今天', yesterday: '昨天', week: '最近 7 天', month: '最近 30 天' };
  const shareLabels = { any: '不限', shared: '已共享', private: '未共享' };

  layer.innerHTML = '<div class="bda-menu" style="right:' + (window.innerWidth - rect.right) + 'px;top:' + (rect.bottom + 6) + 'px">' +
    '<div class="bda-menu-row">' +
    '<button type="button" class="bda-menu-item">' +
    '<span class="bda-menu-label">排序方式</span><span class="bda-menu-value">' + sortLabels[state.filters.sort] + '</span><span class="bda-menu-chev">' + SVG_ICONS.chevron + '</span>' +
    '</button>' +
    '<div class="bda-submenu">' +
    Object.entries(sortLabels).map(([k, v]) =>
      '<button type="button" class="bda-menu-item" data-set-sort="' + k + '"><span class="bda-menu-label">' + v + '</span>' +
      (state.filters.sort === k ? '<span class="bda-tick">' + SVG_ICONS.tick + '</span>' : '') + '</button>'
    ).join('') +
    '</div></div>' +
    '<div class="bda-menu-rule"></div>' +
    '<div class="bda-menu-row">' +
    '<button type="button" class="bda-menu-item">' +
    '<span class="bda-menu-label">类型</span><span class="bda-menu-value">' + (state.filters.types.length ? state.filters.types.length + ' 项' : '不限') + '</span><span class="bda-menu-chev">' + SVG_ICONS.chevron + '</span>' +
    '</button>' +
    '<div class="bda-submenu">' +
    SKILLS_CONFIG.map(s => {
      const on = state.filters.types.includes(s.id);
      return '<button type="button" class="bda-menu-item" data-toggle-type="' + s.id + '">' +
        '<span class="bda-check" data-on="' + on + '">' + (on ? SVG_ICONS.tick : '') + '</span>' +
        '<span class="bda-menu-label">' + s.name + '</span>' +
        '<span class="bda-menu-count">' + (typeCounts.get(s.id) || 0) + '</span></button>';
    }).join('') +
    '</div></div>' +
    '<div class="bda-menu-row">' +
    '<button type="button" class="bda-menu-item">' +
    '<span class="bda-menu-label">打开时间</span><span class="bda-menu-value">' + dateLabels[state.filters.date] + '</span><span class="bda-menu-chev">' + SVG_ICONS.chevron + '</span>' +
    '</button>' +
    '<div class="bda-submenu">' +
    Object.entries(dateLabels).map(([k, v]) =>
      '<button type="button" class="bda-menu-item" data-set-date="' + k + '"><span class="bda-menu-label">' + v + '</span>' +
      (state.filters.date === k ? '<span class="bda-tick">' + SVG_ICONS.tick + '</span>' : '') + '</button>'
    ).join('') +
    '</div></div>' +
    '<div class="bda-menu-row">' +
    '<button type="button" class="bda-menu-item">' +
    '<span class="bda-menu-label">共享</span><span class="bda-menu-value">' + shareLabels[state.filters.sharing] + '</span><span class="bda-menu-chev">' + SVG_ICONS.chevron + '</span>' +
    '</button>' +
    '<div class="bda-submenu">' +
    Object.entries(shareLabels).map(([k, v]) =>
      '<button type="button" class="bda-menu-item" data-set-share="' + k + '"><span class="bda-menu-label">' + v + '</span>' +
      (state.filters.sharing === k ? '<span class="bda-tick">' + SVG_ICONS.tick + '</span>' : '') + '</button>'
    ).join('') +
    '</div></div>' +
    '<div class="bda-menu-rule"></div>' +
    '<button type="button" class="bda-menu-item" data-toggle-pinned="true">' +
    '<span class="bda-menu-label">已固定</span>' + (state.filters.pinned ? '<span class="bda-tick">' + SVG_ICONS.tick + '</span>' : '') +
    '</button>' +
    (isFilterActive() ? '<button type="button" class="bda-menu-item" data-clear-filters="true"><span class="bda-menu-label">清除筛选</span></button>' : '') +
    '</div>';

  const menu = layer.querySelector('.bda-menu');
  menu.onclick = (e) => {
    const tSort = e.target.closest('[data-set-sort]');
    if (tSort) {
      state.filters.sort = tSort.getAttribute('data-set-sort');
      closeMenu(); renderItems(); return;
    }
    const tType = e.target.closest('[data-toggle-type]');
    if (tType) {
      const sk = tType.getAttribute('data-toggle-type');
      if (state.filters.types.includes(sk)) {
        state.filters.types = state.filters.types.filter(x => x !== sk);
      } else {
        state.filters.types.push(sk);
      }
      closeMenu(); renderItems(); return;
    }
    const tDate = e.target.closest('[data-set-date]');
    if (tDate) {
      state.filters.date = tDate.getAttribute('data-set-date');
      closeMenu(); renderItems(); return;
    }
    const tShare = e.target.closest('[data-set-share]');
    if (tShare) {
      state.filters.sharing = tShare.getAttribute('data-set-share');
      closeMenu(); renderItems(); return;
    }
    if (e.target.closest('[data-toggle-pinned]')) {
      state.filters.pinned = !state.filters.pinned;
      closeMenu(); renderItems(); return;
    }
    if (e.target.closest('[data-clear-filters]')) {
      state.filters = { sort: 'opened', types: [], date: 'any', sharing: 'any', pinned: false };
      closeMenu(); renderItems(); return;
    }
  };
}

// 绑定全局点击与卡片交互
document.getElementById('tiles').onclick = (e) => {
  const btn = e.target.closest('.bda-tile');
  if (btn) openCreateDialog(btn.getAttribute('data-skill'));
};

document.getElementById('container').onclick = async (e) => {
  const itemEl = e.target.closest('.bda-item');
  if (!itemEl) return;
  const root = itemEl.getAttribute('data-root');
  const item = state.artifacts.find(a => a.root === root);
  if (!item) return;

  const btn = e.target.closest('button[data-act]');
  if (!btn) return;
  const act = btn.getAttribute('data-act');
  if (act === 'open') {
    await openItem(item);
  } else if (act === 'pin') {
    await api('/api/update', { method: 'POST', headers: {'content-type':'application/json'}, body: JSON.stringify({ root: item.root, pinned: !item.pinned }) });
    await reload();
  } else if (act === 'more') {
    showActionsMenu(item, btn);
  }
};

// 搜索框交互
const qInput = document.getElementById('q');
const clearSearchBtn = document.getElementById('clearSearch');
qInput.oninput = () => {
  state.search = qInput.value;
  clearSearchBtn.className = state.search ? '' : 'hidden';
  renderItems();
};
clearSearchBtn.onclick = () => {
  qInput.value = '';
  state.search = '';
  clearSearchBtn.className = 'hidden';
  qInput.focus();
  renderItems();
};
window.addEventListener('keydown', (e) => {
  if (e.key === '/' && document.activeElement !== qInput && !document.querySelector('.bda-scrim:not(.hidden)')) {
    e.preventDefault();
    qInput.focus();
  } else if (e.key === 'Escape') {
    if (!document.getElementById('dialogScrim').classList.contains('hidden')) {
      closeDialog();
    } else if (document.getElementById('menuLayer').innerHTML) {
      closeMenu();
    } else if (qInput.value) {
      clearSearchBtn.click();
    }
  }
});

// 视图切换
document.getElementById('viewModeBtn').onclick = () => {
  state.viewMode = state.viewMode === 'grid' ? 'list' : 'grid';
  localStorage.setItem('ps_view_mode', state.viewMode);
  renderItems();
};

// 筛选按钮
document.getElementById('filterBtn').onclick = (e) => {
  showFilterMenu(e.currentTarget);
};

// 刷新按钮
document.getElementById('reloadBtn').onclick = async () => {
  await reload();
  showToast('✓ 列表已更新');
};

async function reload() {
  try {
    const res = await api('/api/list');
    if (res.ok) {
      state.artifacts = res.artifacts || [];
      state.workspaceName = res.workspaceName || '';
      state.workspaceRoot = res.workspaceRoot || '';
      document.getElementById('wsLabel').textContent = state.workspaceName ? '工作区 · ' + state.workspaceName : '';
      renderItems();
    }
  } catch (err) {
    showToast('加载失败：' + err.message);
  }
}

// 初始化
renderTiles();
reload();
</script>
</body>
</html>`;
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://127.0.0.1');
  res.setHeader('content-type', url.pathname === '/' ? 'text/html; charset=utf-8' : 'application/json; charset=utf-8');
  const allowedGet = ['/', '/api/list', '/api/open', '/api/open-url'];
  const allowedPost = ['/api/open', '/api/update', '/api/delete', '/api/restore', '/api/create', '/api/rename', '/api/stop', '/api/restart', '/api/restart-editor'];
  if (!((req.method === 'GET' && allowedGet.includes(url.pathname)) || (req.method === 'POST' && allowedPost.includes(url.pathname)))) {
    res.statusCode = 404; return res.end('{}');
  }
  const finish = (v) => res.end(JSON.stringify(v));

  if (req.method === 'GET') {
    if (url.pathname === '/') return res.end(galleryHtml());
    if (url.pathname === '/api/list') return finish(listArtifactsViews());
    const skill = url.searchParams.get('skill') || '';
    const root = url.searchParams.get('root') || '';
    if (url.pathname === '/api/open-url') {
      return openSkillEditor(skill, root).then((r) => {
        if (!r.ok) { res.statusCode = 400; return finish(r); }
        res.statusCode = 302; res.setHeader('location', r.url); return res.end();
      });
    }
    return openSkillEditor(skill, root).then(finish);
  }

  let body = '';
  req.on('data', (c) => { body += c; if (body.length > 65536) req.destroy(); });
  req.on('end', async () => {
    let input = {}; try { input = JSON.parse(body || '{}'); } catch {}
    const skill = input.skill || '', root = input.root || '';

    if (url.pathname === '/api/open') return finish(await openSkillEditor(skill, root));
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
  trashArtifact,
  restoreArtifact,
  renameArtifact,
  createExample,
  galleryHtml,
  findArtifact,
  writeRecord,
  server,
};

if (process.argv[1] === __filename) {
  server.on('error', (e) => console.error('gallery server error:', e.message));
  server.listen(PORT, '127.0.0.1', () => console.log(`gallery listening on ${PORT}`));
}
