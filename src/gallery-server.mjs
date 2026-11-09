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
import { guardPost, MAX_BODY_BYTES } from './post-guard.mjs';

import {
  SKILLS,
  SKILL_BY_ID,
  TITLES,
  TINTS,
  FOLDER,
  ROOT_MARKERS,
  DEFAULT_PORTS,
  PROMPTS,
  RECIPES,
  EDITOR_FILES,
  NOT_CONTENT,
  EXAMPLE_TEMPLATES,
  EXAMPLE_INDEX,
} from './skills-meta.mjs';

const __filename = fileURLToPath(import.meta.url);
const pluginRoot = path.dirname(path.dirname(__filename));
const STATE_FILE = path.join(os.tmpdir(), 'prototype-studio-state.json');
const BAOYU_SKILLS_DIR = path.join(pluginRoot, 'vendor', 'baoyu-design', 'skills');
const ORCA_BIN = process.env.ORCA_CLI_COMMAND || '/Applications/Orca.app/Contents/Resources/bin/orca';
const PORT = Number(process.env.PORT) || 3480;
const EXAMPLES_INDEX = JSON.parse(fs.readFileSync(new URL('./examples.json', import.meta.url), 'utf8'));
const OFFICIAL_EXAMPLES = [...new Set([...Object.keys(EXAMPLES_INDEX), ...Object.keys(EXAMPLE_TEMPLATES)])]
  .filter((skill) => Object.hasOwn(SKILL_BY_ID, skill))
  .map((skill) => {
    const example = EXAMPLES_INDEX[skill] || {};
    const template = EXAMPLE_TEMPLATES[skill] || {};
    const files = { ...template.files, ...example.files };
    return {
      id: skill, skill,
      title: example.title || `${SKILL_BY_ID[skill].name}示例`,
      desc: example.desc || SKILL_BY_ID[skill].about,
      points: example.points || Object.keys(files).join('、'),
      html: Object.entries(files).find(([name]) => name.endsWith('.html'))?.[1] || '',
    };
  });
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
  try {
    if (pendingThumbs.has(rec.root) || fs.existsSync(thumbPath(rec.root)) || !previewEntry(rec.root, rec.skill)) return;
    const url = new URL(`http://127.0.0.1:${PORT}/api/preview`);
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

// 路径合法性：绝对路径且当前真实存在的目录。防止把 DB 二进制垃圾当工作区
// （曾因对 .db 原始字节做正则而扫出乱码路径，导致 0 项目 + 花屏工作区名）。
function validWsRoot(p) {
  if (typeof p !== 'string' || !path.isAbsolute(p)) return false;
  try { return fs.statSync(p).isDirectory(); } catch { return false; }
}
function readState() {
  let explicit = {};
  try { explicit = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')); } catch {}
  if (validWsRoot(explicit.workspaceRoot)) return explicit;
  // 唯一读取路径：sqlite3 CLI（正确处理 WAL）。绝不直接对 .db 字节做正则。
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

// 静态预览入口：返回作品的首个 HTML（幻灯片取 project/slides/，其余取 project/）。
// 设计系统/看板/动效是 db 结构无静态页，返回 null，卡片回退骨架图。
function previewEntry(root, skill) {
  if (!root || !fs.existsSync(root)) return null;
  const dirs = skill === 'claude-slides' ? ['project/slides', 'project'] : ['project'];
  for (const d of dirs) {
    try {
      const files = fs.readdirSync(path.join(root, d)).filter((f) => f.endsWith('.html')).sort();
      if (files.length) return path.join(root, d, files[0]);
    } catch {}
  }
  return null;
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
    if (rec === null) continue;
    // 文件已不在：保留记录并显性化（missing），不再静默隐藏
    if (!fs.existsSync(rec.root)) rec.missing = true;
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
      note: typeof rec.note === 'string' ? rec.note : '',
      tail: root.split('/').slice(-2).join('/'),
      openable: true,
      missing: rec.missing === true,
      preview: rec.missing === true ? false : !!previewEntry(root, rec.skill),
      thumb: rec.missing === true ? false : fs.existsSync(thumbPath(root)),
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

const GALLERY_STR = {
  "zh": {
    "works": "作品",
    "searchPlaceholder": "搜索作品 (/)",
    "search": "搜索作品",
    "clearSearch": "清除搜索",
    "sortFilter": "排序和筛选",
    "switchView": "切换视图",
    "refresh": "刷新列表",
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
    "emptyHint": "Agent 用 baoyu-design 的技能做出来的东西都会出现在这里。点上面的入口开始做一个。",
    "clearFilters": "清除筛选",
    "projectPreview": "作品预览",
    "missing": "文件已不在",
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
    "deleteMove": "这会移除这个作品，它的文件夹移到应用数据目录下的 baoyu-design/trash。",
    "deleteKeep": "这会把它从作品列表移除。它的文件夹里还有其他工程文件，所以留在原处：",
    "deleteFailed": "删除失败: ",
    "copyPrompt": "📋 复制 Agent 提示词",
    "createBlank": "✨ 创建空白示例",
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
    "dashboard": "看板",
    "samplePresentation": "示例演示",
    "renameDescription": "为「{title}」设置新的标题：",
    "renamed": "已重命名为「{title}」",
    "deleteTitle": "删除“{title}”？",
    "deleted": "已删除“{title}”。",
    "removed": "已从作品里移除“{title}”，文件夹还在原处。",
    "createTitle": "新建「{title}」",
    "allWorksCount": "全部作品 ({count})",
    "remixSent": "✓ 已开新对话并发送同款草稿（{outcome}）",
    "workflowSent": "✓ 已开新对话并发送工作流草稿（{outcome}）",
    "languageButton": "EN",
    "previewTitle": "{title}预览"
  },
  "en": {
    "works": "Projects",
    "searchPlaceholder": "Search projects (/)",
    "search": "Search projects",
    "clearSearch": "Clear search",
    "sortFilter": "Sort and filter",
    "switchView": "Switch view",
    "refresh": "Refresh list",
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
    "emptyHint": "Projects made by your agent with baoyu-design appear here. Choose a tool above to get started.",
    "clearFilters": "Clear filters",
    "projectPreview": "Project preview",
    "missing": "Files missing",
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
    "deleteMove": "This removes the project and moves its folder to baoyu-design/trash in the application data directory.",
    "deleteKeep": "This removes the project from the list. Its folder contains other project files and stays at: ",
    "deleteFailed": "Delete failed: ",
    "copyPrompt": "📋 Copy agent prompt",
    "createBlank": "✨ Create blank example",
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
    "sheets": "{count} sheets",
    "dashboard": "Dashboard",
    "samplePresentation": "Sample presentation",
    "renameDescription": "Set a new title for “{title}”:",
    "renamed": "Renamed to “{title}”",
    "deleteTitle": "Delete “{title}”?",
    "deleted": "Deleted “{title}”.",
    "removed": "Removed “{title}” from projects. Its folder stays in place.",
    "createTitle": "Create “{title}”",
    "allWorksCount": "All projects ({count})",
    "remixSent": "✓ Remix draft sent to a new chat ({outcome})",
    "workflowSent": "✓ Workflow draft sent to a new chat ({outcome})",
    "languageButton": "中",
    "previewTitle": "{title} preview"
  }
};
// Keep shared skill/example metadata in the same flat bilingual catalogue.
for (const [index, skill] of SKILLS.entries()) {
  for (const field of ['name', 'about', 'prompt']) GALLERY_STR.zh['skill.' + skill.id + '.' + field] = skill[field];
  GALLERY_STR.en['skill.' + skill.id + '.name'] = skill.nameEn;
  const [about, prompt] = [["Editable slides for presenting or exporting to PDF, HTML, or PowerPoint.", "Help me create a slide deck about: "], ["Explore editable designs side by side on a single canvas.", "Help me design: "], ["Build brand colors, typography, components, assets, and a brand guide.", "Help me create a design system for the brand: "], ["Create charts, metrics, and tables from your data, with live updates.", "Help me create a data dashboard from: "], ["Create short animations and export MP4 or GIF.", "Help me animate: "]][index];
  GALLERY_STR.en['skill.' + skill.id + '.about'] = about;
  GALLERY_STR.en['skill.' + skill.id + '.prompt'] = prompt;
}
for (const [index, recipe] of RECIPES.entries()) {
  const [title, desc] = [["Design system → Unified projects", "Build a design system, then create slides with its tokens."], ["Canvas concepts → Motion demo", "Explore canvas concepts, choose one, then animate it."], ["Data → Dashboard → Report", "Build a data dashboard, then create a presentation."], ["Canvas exploration → Design system", "Explore visual directions, then capture a reusable design system."]][index];
  for (const field of ['title', 'desc']) GALLERY_STR.zh['recipe.' + recipe.id + '.' + field] = recipe[field];
  GALLERY_STR.en['recipe.' + recipe.id + '.title'] = title;
  GALLERY_STR.en['recipe.' + recipe.id + '.desc'] = desc;
}
const EXAMPLE_EN = {
  "claude-design": [
    "Single-page canvas",
    "Start an editable canvas with a blue background and a centered heading.",
    "880 × 560 canvas, blue background, large centered heading, editable DC component"
  ],
  "claude-slides": [
    "Presentation cover",
    "Start a presentation with a dark background and a bold heading.",
    "Dark cover, large centered heading, expandable slide order"
  ],
  "claude-design-system": [
    "Brand design system",
    "Establish brand guidelines from tokens and a project scaffold.",
    "Brand colors, typography, spacing tokens, and component guidelines; this template contains an index, README, and empty token file"
  ]
};
for (const example of OFFICIAL_EXAMPLES) {
  for (const [index, field] of ['title', 'desc', 'points'].entries()) {
    GALLERY_STR.zh['example.' + example.id + '.' + field] = example[field];
    GALLERY_STR.en['example.' + example.id + '.' + field] = EXAMPLE_EN[example.id]?.[index] || example[field];
  }
}

function galleryHtml(requestedLang = 'zh') {
  const initialLang = requestedLang === 'en' ? 'en' : 'zh';
  const text = (key) => GALLERY_STR[initialLang][key];
  return `<!doctype html>
<html data-i18n-pending lang="${initialLang === 'en' ? 'en' : 'zh-CN'}" data-initial-lang="${initialLang}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${text('works')} · Prototype Studio</title>
<script>
// Select the remembered language before the first paint; the body renders synchronously.
try {
  const requested = new URLSearchParams(location.search).get('lang');
  const saved = localStorage.getItem('ps_lang');
  const selected = ['zh', 'en'].includes(requested) ? requested : ['zh', 'en'].includes(saved) ? saved : 'zh';
  document.documentElement.lang = selected === 'en' ? 'en' : 'zh-CN';
} catch { /* The server already supplied the URL/default language. */ }
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
/* 实时预览（懒加载缩放 iframe）与 missing 态 */
.bda-live { position:absolute; inset:0; width:1280px; height:800px; transform-origin:0 0; border:0; background:transparent; pointer-events:none; opacity:0; transition:opacity .35s; }
.bda-live.on { opacity:1; }
.bda-item.bda-missing .bda-card, .bda-item.bda-missing .bda-row { opacity:.55; }
.bda-missing-badge { position:absolute; left:8px; top:8px; z-index:3; font-size:11px; line-height:16px; padding:2px 8px; border-radius:999px; background:var(--dsw-alias-state-error-primary, #c0392b); color:#fff; }
#examples { grid-template-columns: repeat(auto-fit, minmax(min(230px, 100%), 1fr)); }
.bda-example { display:flex; flex-direction:column; gap:10px; padding:16px; border:1px solid var(--dsw-alias-border-l2); border-radius:14px; }
.bda-example h3 { margin:0; font-size:14px; font-weight:500; }
.bda-example p { margin:0; font-size:12px; line-height:1.6; color:var(--dsw-alias-label-secondary); }
.bda-example-skill { display:flex; align-items:center; gap:6px; font-size:12px; color:var(--dsw-alias-label-tertiary); }
.bda-example-actions { display:flex; flex-wrap:wrap; gap:8px; margin-top:auto; }
.bda-example-preview { overflow:hidden; width:100%; background:var(--dsw-alias-bg-skeleton); border-radius:8px; }
.bda-example-preview iframe { width:880px; height:560px; border:0; transform-origin:top left; }
.bda-example-skeleton { padding:24px; background:var(--dsw-alias-bg-skeleton); border-radius:8px; }
.bda-recipe-desc { font-size:12px; color:var(--dsw-alias-label-tertiary); line-height:1.5; }
/* CJK 排版（吸收 guizang T4）：弹窗正文行长 ≤36em、行距 1.75；T10 中西文间距待 Chromium text-spacing 可用后跟进 */
.bda-scrim p { max-width:36em; line-height:1.75; }

/* 主题覆盖链：URL ?scheme= > localStorage > 系统 prefers-color-scheme。
   color-scheme 属性驱动上方所有 light-dark() 取值翻转，两行生效。
   宿主当前无「读主题」API（appearance.read 仅 revision），待上游暴露后接入。 */
html[data-scheme=dark] { color-scheme: dark; }
html[data-scheme=light] { color-scheme: light; }

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
.bda-thumb { position:absolute; inset:0; width:100%; height:100%; object-fit:cover; }
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
          <h1 data-i18n="works">${text('works')}</h1>
          <span class="bda-ws" id="wsLabel"></span>
        </div>
        <div class="bda-tools">
          <button type="button" class="bda-btn" id="languageBtn" data-i18n-title="language" data-i18n-label="language" title="${text('language')}" aria-label="${text('language')}">${text('languageButton')}</button>
          <div class="bda-search">
            <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.3"><circle cx="7" cy="7" r="4.5"/><path d="m10.5 10.5 3 3"/></svg>
            <input id="q" data-i18n-placeholder="searchPlaceholder" placeholder="${text('searchPlaceholder')}" data-i18n-label="search" aria-label="${text('search')}">
            <button id="clearSearch" class="hidden" data-i18n-title="clearSearch" title="${text('clearSearch')}" data-i18n-label="clearSearch" aria-label="${text('clearSearch')}">
              <svg viewBox="0 0 16 16" width="12" height="12" stroke="currentColor" stroke-width="1.3"><path d="m4.5 4.5 7 7m0-7-7 7"/></svg>
            </button>
          </div>
          <button class="bda-tool" id="filterBtn" data-i18n-title="sortFilter" title="${text('sortFilter')}" data-i18n-label="sortFilter" aria-label="${text('sortFilter')}">
            <svg viewBox="0 0 16 16" width="16" height="16" stroke="currentColor" stroke-width="1.3"><path d="M2.5 4.5h11M4.5 8h7M6.5 11.5h3"/></svg>
          </button>
          <button class="bda-tool" id="viewModeBtn" data-i18n-title="switchView" title="${text('switchView')}" data-i18n-label="switchView" aria-label="${text('switchView')}">
            <svg id="viewModeIcon" viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.3"></svg>
          </button>
          <button class="bda-tool" id="reloadBtn" data-i18n-title="refresh" title="${text('refresh')}" data-i18n-label="refresh" aria-label="${text('refresh')}">
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
      <div id="container"></div>
    </div>
  </div>
</div>

<div id="editorView" class="hidden">
  <div class="editor-bar">
    <button class="bda-btn" id="backBtn" data-i18n="back">${text('back')}</button>
    <span class="title" id="editorTitle"></span>
    <button class="bda-btn" id="popBtn" data-i18n="popOut">${text('popOut')}</button>
  </div>
  <iframe id="frame" allow="clipboard-read; clipboard-write"></iframe>
</div>

<div id="dialogScrim" class="bda-scrim hidden"></div>
<div id="toast" class="hidden"></div>
<div id="menuLayer"></div>

<script>
const STR = ${JSON.stringify(GALLERY_STR).replace(/</g, '\\u003c')};
const INITIAL_LANG = ${JSON.stringify(initialLang)};
function readPreference(key) {
  try { return localStorage.getItem(key); } catch { return null; }
}
function writePreference(key, value) {
  try { localStorage.setItem(key, value); } catch { /* Storage may be disabled in embedded browsers. */ }
}
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
// 图标库与色彩
const TINTS = ${JSON.stringify(TINTS)};
const SKILLS_CONFIG = ${JSON.stringify(SKILLS)};
const SKILL_MAP = Object.fromEntries(SKILLS_CONFIG.map(s => [s.id, s]));
const RECIPES = ${JSON.stringify(RECIPES)};
// 主题覆盖链（尽早执行避免闪色）：URL ?scheme=dark|light 记忆到 localStorage
(() => {
  try {
    const q = new URLSearchParams(location.search).get('scheme');
    const s = q === 'dark' || q === 'light' ? q : '';
    if (s) localStorage.setItem('ps-scheme', s);
    const saved = s || localStorage.getItem('ps-scheme') || '';
    if (saved === 'dark' || saved === 'light') document.documentElement.dataset.scheme = saved;
  } catch {}
})();
const OFFICIAL_EXAMPLES = ${JSON.stringify(OFFICIAL_EXAMPLES).replace(/</g, '\\u003c')};
const EXAMPLE_TEMPLATES = ${JSON.stringify(Object.fromEntries(Object.keys(EXAMPLE_TEMPLATES).map((id) => [id, true])))};

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
  if (seconds > -60) return t('justOpened');
  const steps = [['minute', 60], ['hour', 3600], ['day', 86400], ['week', 604800], ['month', 2629800], ['year', 31557600]];
  let unit = 'minute', size = 60;
  for (const [u, s] of steps) if (-seconds >= s) [unit, size] = [u, s];
  let time;
  try {
    time = new Intl.RelativeTimeFormat(locale(), { numeric: 'auto' }).format(Math.round(seconds / size), unit);
  } catch {
    const key = unit === 'week' ? 'weekUnit' : unit === 'month' ? 'monthUnit' : unit;
    time = t('relativeFallback', { count: Math.abs(Math.round(seconds / size)), unit: t(key) });
  }
  return t('openedRelative', { time });
}

function localizedMeta(item) {
  const match = /^(\\d+) /.exec(item.meta || '');
  const keys = { 'claude-design': 'boards', 'claude-slides': 'pages', 'claude-motion': 'scenes', 'claude-design-system': 'components', 'claude-dashboard': 'sheets' };
  if (match && keys[item.skill]) return t(keys[item.skill], {count: match[1]});
  return item.skill === 'claude-dashboard' && item.meta ? t('dashboard') : item.meta || '';
}

// 客户端状态管理
let state = {
  artifacts: [],
  workspaceName: '',
  workspaceRoot: '',
  search: '',
  viewMode: readPreference('ps_view_mode') || 'grid',
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
  const toast = document.getElementById('toast');
  toast.innerHTML = '<span style="display:inline-flex;align-items:center">' + SVG_ICONS.info + '</span><span class="bda-toast-text">' + esc(msg) + '</span>' +
    (undoTrashId ? ('<button type="button" class="bda-toast-undo" id="toastUndoBtn">' + t('undo') + '</button>') : '') +
    '<button type="button" class="bda-toast-close" id="toastCloseBtn"><svg viewBox="0 0 16 16" width="12" height="12" stroke="currentColor" stroke-width="1.3"><path d="m4.5 4.5 7 7m0-7-7 7"/></svg></button>';
  toast.className = 'bda-toast';
  document.getElementById('toastCloseBtn').onclick = () => toast.className = 'hidden';
  if (undoTrashId) {
    document.getElementById('toastUndoBtn').onclick = async () => {
      toast.className = 'hidden';
      const r = await api('/api/restore', { method: 'POST', headers: {'content-type':'application/json'}, body: JSON.stringify({ id: undoTrashId }) });
      if (r.ok) {
        showToast(t('restored'));
        await reload();
      } else {
        showToast(t('restoreFailed') + (r.error || ''));
      }
    };
  }
  clearTimeout(toast._timer);
  toast._timer = setTimeout(() => toast.className = 'hidden', undoTrashId ? 10000 : 3500);
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
    if (sort === 'name') return a.title.localeCompare(b.title, locale());
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
      '<span class="bda-tile-label">' + esc(skillText(s.id, 'name')) + '</span>' +
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
  document.getElementById('viewModeBtn').title = isGrid ? t('listView') : t('gridView');
  document.getElementById('filterBtn').setAttribute('data-active', isFilterActive() ? 'true' : 'false');
  document.getElementById('listHeading').textContent = t('allWorksCount', {count: items.length});

  if (!items.length) {
    container.innerHTML = '<div class="bda-empty">' +
      SVG_ICONS.info +
      '<h2>' + (state.search || isFilterActive() ? t('noMatches') : t('noWorks')) + '</h2>' +
      '<p>' + (state.search || isFilterActive() ? t('clearHint') : t('emptyHint')) + '</p>' +
      (isFilterActive() ? ('<button type="button" class="bda-btn" id="clearFilterBtn" style="margin-top:12px">' + t('clearFilters') + '</button>') : '') +
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
      return '<li class="bda-item' + (it.missing ? ' bda-missing' : '') + '" data-root="' + esc(it.root) + '" data-skill="' + esc(it.skill) + '" style="--bda-tint:' + (TINTS[it.skill] || '#888') + '">' +
        '<button type="button" class="bda-card" data-act="open" ' + ((isOpening || it.missing) ? 'disabled' : '') + '>' +
        '<span class="bda-preview">' +
        '<span class="bda-sheet">' + drawnHtml(it.skill, it.title) + '</span>' +
        (it.preview ? '<iframe class="bda-live" data-src="/api/preview?skill=' + encodeURIComponent(it.skill) + '&root=' + encodeURIComponent(it.root) + ('" tabindex="-1" sandbox="allow-scripts" title="' + t('projectPreview') + '"></iframe>') : '') +
        (it.thumb ? '<img class="bda-thumb" src="/api/thumb?root=' + encodeURIComponent(it.root) + '" alt="" onerror="this.remove()">' : '') +
        (it.missing ? ('<span class="bda-missing-badge">' + t('missing') + '</span>') : '') +
        (isOpening ? ('<span class="bda-busy"><span class="bda-spinner"></span>' + t('opening') + '</span>') : '') +
        '</span>' +
        '<span class="bda-info">' +
        '<span class="bda-glyph">' + typeIconSvg(it.skill, 18) + '</span>' +
        '<span class="bda-text">' +
        '<span class="bda-name" title="' + esc(it.title) + '">' + esc(it.title) + '</span>' +
        '<span class="bda-meta">' + esc(localizedMeta(it) ? localizedMeta(it) + ' · ' : '') + ago(it.openedAt) + (it.note ? ' · ' + esc(it.note) : '') + '</span>' +
        '</span>' +
        '</span>' +
        '</button>' +
        '<div class="bda-actions">' +
        ('<button type="button" class="bda-act" data-act="more" title="' + t('more') + '">') + SVG_ICONS.more + '</button>' +
        '<button type="button" class="bda-act" data-act="pin" data-on="' + it.pinned + '" title="' + (it.pinned ? t('unpin') : t('pin')) + '">' +
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
        '<span class="bda-meta">' + esc(localizedMeta(it) ? localizedMeta(it) + ' · ' : '') + ago(it.openedAt) + (it.note ? ' · ' + esc(it.note) : '') + '</span>' +
        '</button>' +
        '<div class="bda-row-tools">' +
        '<button type="button" class="bda-act" data-act="pin" data-on="' + it.pinned + '" title="' + (it.pinned ? t('unpin') : t('pin')) + '">' +
        (it.pinned ? SVG_ICONS.pinFilled : SVG_ICONS.pin) +
        '</button>' +
        ('<button type="button" class="bda-act" data-act="more" title="' + t('more') + '">') + SVG_ICONS.more + '</button>' +
        '</div>' +
        '</li>';
    }).join('') + '</ul>';
  }
  activateLivePreviews(container);
}

// 实时预览：进入视口才挂载 iframe（1280×800 等比缩到卡片宽），加载完成后淡入。
// sandbox 不带 allow-same-origin：作品脚本以 opaque origin 运行，碰不到库服务的 API。
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

// 打开编辑器交互
async function openItem(item) {
  state.openingRoot = item.root;
  renderItems();
  try {
    const res = await api('/api/open?skill=' + encodeURIComponent(item.skill) + '&root=' + encodeURIComponent(item.root));
    if (!res.ok) {
      showToast(t('cannotOpen') + (res.error || t('unknownError')));
      return;
    }
    const frame = document.getElementById('frame');
    document.getElementById('editorTitle').textContent = item.title + ' · ' + skillText(item.skill, 'name');
    frame.src = res.url;
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

// 更多菜单 Action Menu
function showActionsMenu(item, anchorEl) {
  const rect = anchorEl.getBoundingClientRect();
  const layer = document.getElementById('menuLayer');
  anchorEl.closest('.bda-item')?.setAttribute('data-menu', 'true');
  layer.innerHTML = '<div class="bda-menu" style="left:' + Math.min(rect.left, window.innerWidth - 220) + 'px;top:' + (rect.bottom + 6) + 'px">' +
    '<button type="button" class="bda-menu-item" data-menu-action="pin">' +
    SVG_ICONS.pin + '<span class="bda-menu-label">' + (item.pinned ? t('unpin') : t('pin')) + '</span><kbd class="bda-menu-key">P</kbd>' +
    '</button>' +
    '<button type="button" class="bda-menu-item" data-menu-action="rename">' +
    SVG_ICONS.rename + ('<span class="bda-menu-label">' + t('rename') + '</span><kbd class="bda-menu-key">R</kbd>') +
    '</button>' +
    '<button type="button" class="bda-menu-item" data-menu-action="recreate">' +
    '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9L12 3z"/><path d="M19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8L19 15z"/></svg>' +
    ('<span class="bda-menu-label">' + t('recreate') + '</span><kbd class="bda-menu-key">S</kbd>') +
    '</button>' +
    '<button type="button" class="bda-menu-item" data-menu-action="copy">' +
    SVG_ICONS.copy + ('<span class="bda-menu-label">' + t('copyLink') + '</span><kbd class="bda-menu-key">C</kbd>') +
    '</button>' +
    (item.missing
      ? '<button type="button" class="bda-menu-item" data-menu-action="forget" data-danger="true">' +
        SVG_ICONS.trash + ('<span class="bda-menu-label">' + t('forget') + '</span><kbd class="bda-menu-key">X</kbd>') +
        '</button>'
      : '') +
    '<div class="bda-menu-rule"></div>' +
    '<button type="button" class="bda-menu-item" data-menu-action="delete" data-danger="true">' +
    SVG_ICONS.trash + ('<span class="bda-menu-label">' + t('delete') + '</span><kbd class="bda-menu-key">Del</kbd>') +
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
    } else if (act === 'recreate') {
      const res = await api('/api/start', { method: 'POST', headers: {'content-type':'application/json'}, body: JSON.stringify({ root: item.root }) });
      if (res.ok) {
        showToast(t('remixSent', {outcome: res.outcome || 'chat'}));
      } else {
        try { await navigator.clipboard.writeText(res.starter || ''); showToast(t('draftCopied') + (res.error || '')); }
        catch { showToast(t('remixFailed') + (res.error || '')); }
      }
    } else if (act === 'forget') {
      const res = await api('/api/forget', { method: 'POST', headers: {'content-type':'application/json'}, body: JSON.stringify({ root: item.root }) });
      showToast(res.ok ? t('forgotten') : t('forgetFailed') + (res.error || ''));
      if (res.ok) await reload();
    } else if (act === 'copy') {
      const res = await api('/api/open?skill=' + encodeURIComponent(item.skill) + '&root=' + encodeURIComponent(item.root));
      if (res.ok && res.url) {
        await navigator.clipboard.writeText(res.url);
        showToast(t('linkCopied'));
      } else {
        showToast(t('linkFailed'));
      }
    } else if (act === 'delete') {
      openDeleteDialog(item);
    }
  };
}

// 重命名弹窗
function openRenameDialog(item) {
  openDialog(
    ('<h2>' + t('renameTitle') + '</h2>') +
    '<p>' + esc(t('renameDescription', {title: item.title})) + '</p>' +
    '<input id="renameInput" value="' + esc(item.title) + '" maxlength="200" autofocus>' +
    '<div class="bda-dialog-actions">' +
    ('<button type="button" class="bda-btn" id="renameCancel">' + t('cancel') + '</button>') +
    ('<button type="button" class="bda-btn" data-primary="true" id="renameSave">' + t('save') + '</button>') +
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
      showToast(t('renamed', {title: val}));
      await reload();
    } else {
      showToast(t('renameFailed') + (res.error || ''));
    }
  };
}

// 删除确认弹窗
function openDeleteDialog(item) {
  const desc = item.deletable ?
    t('deleteMove') :
    t('deleteKeep') + item.root;
  openDialog(
    '<h2>' + esc(t('deleteTitle', {title: item.title})) + '</h2>' +
    '<p>' + esc(desc) + '</p>' +
    '<div class="bda-dialog-actions">' +
    ('<button type="button" class="bda-btn" id="deleteCancel">' + t('cancel') + '</button>') +
    ('<button type="button" class="bda-btn" data-danger="true" id="deleteConfirm">' + t('delete') + '</button>') +
    '</div>'
  );
  document.getElementById('deleteCancel').onclick = closeDialog;
  document.getElementById('deleteConfirm').onclick = async () => {
    closeDialog();
    const res = await api('/api/delete', { method: 'POST', headers: {'content-type':'application/json'}, body: JSON.stringify({ root: item.root }) });
    if (res.ok) {
      showToast(item.deletable ? t('deleted', {title: item.title}) : t('removed', {title: item.title}), res.trash);
      await reload();
    } else {
      showToast(t('deleteFailed') + (res.error || ''));
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
    '<h2 style="margin:0">' + esc(t('createTitle', {title: skillText(s.id, 'name')})) + '</h2>' +
    '</div>' +
    '<p>' + esc(skillText(s.id, 'about')) + '</p>' +
    '<div class="bda-dialog-actions" style="margin-top:20px;display:flex;gap:8px">' +
    ('<button type="button" class="bda-btn" id="copyPromptBtn">' + t('copyPrompt') + '</button>') +
    (canScaffold ? ('<button type="button" class="bda-btn" data-primary="true" id="createScaffoldBtn">' + t('createBlank') + '</button>') : '') +
    ('<button type="button" class="bda-btn" id="createCancel">' + t('cancel') + '</button>') +
    '</div>'
  );
  document.getElementById('createCancel').onclick = closeDialog;
  document.getElementById('copyPromptBtn').onclick = async () => {
    try {
      await navigator.clipboard.writeText(skillText(s.id, 'prompt'));
      closeDialog();
      showToast(t('promptCopied'));
    } catch {
      showToast(t('copyFailed') + skillText(s.id, 'prompt'));
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
        showToast(t('createFailed') + (res.error || ''));
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
  const sortLabels = { opened: t('sortOpened'), updated: t('sortUpdated'), created: t('sortCreated'), name: t('sortName') };
  const dateLabels = { any: t('any'), today: t('today'), yesterday: t('yesterday'), week: t('week'), month: t('month') };
  const shareLabels = { any: t('any'), shared: t('shared'), private: t('private') };

  layer.innerHTML = '<div class="bda-menu" style="right:' + (window.innerWidth - rect.right) + 'px;top:' + (rect.bottom + 6) + 'px">' +
    '<div class="bda-menu-row">' +
    '<button type="button" class="bda-menu-item">' +
    ('<span class="bda-menu-label">' + t('sortBy') + '</span><span class="bda-menu-value">') + sortLabels[state.filters.sort] + '</span><span class="bda-menu-chev">' + SVG_ICONS.chevron + '</span>' +
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
    ('<span class="bda-menu-label">' + t('type') + '</span><span class="bda-menu-value">') + (state.filters.types.length ? state.filters.types.length + t('selectedSuffix') : t('any')) + '</span><span class="bda-menu-chev">' + SVG_ICONS.chevron + '</span>' +
    '</button>' +
    '<div class="bda-submenu">' +
    SKILLS_CONFIG.map(s => {
      const on = state.filters.types.includes(s.id);
      return '<button type="button" class="bda-menu-item" data-toggle-type="' + s.id + '">' +
        '<span class="bda-check" data-on="' + on + '">' + (on ? SVG_ICONS.tick : '') + '</span>' +
        '<span class="bda-menu-label">' + esc(skillText(s.id, 'name')) + '</span>' +
        '<span class="bda-menu-count">' + (typeCounts.get(s.id) || 0) + '</span></button>';
    }).join('') +
    '</div></div>' +
    '<div class="bda-menu-row">' +
    '<button type="button" class="bda-menu-item">' +
    ('<span class="bda-menu-label">' + t('openedAt') + '</span><span class="bda-menu-value">') + dateLabels[state.filters.date] + '</span><span class="bda-menu-chev">' + SVG_ICONS.chevron + '</span>' +
    '</button>' +
    '<div class="bda-submenu">' +
    Object.entries(dateLabels).map(([k, v]) =>
      '<button type="button" class="bda-menu-item" data-set-date="' + k + '"><span class="bda-menu-label">' + v + '</span>' +
      (state.filters.date === k ? '<span class="bda-tick">' + SVG_ICONS.tick + '</span>' : '') + '</button>'
    ).join('') +
    '</div></div>' +
    '<div class="bda-menu-row">' +
    '<button type="button" class="bda-menu-item">' +
    ('<span class="bda-menu-label">' + t('sharing') + '</span><span class="bda-menu-value">') + shareLabels[state.filters.sharing] + '</span><span class="bda-menu-chev">' + SVG_ICONS.chevron + '</span>' +
    '</button>' +
    '<div class="bda-submenu">' +
    Object.entries(shareLabels).map(([k, v]) =>
      '<button type="button" class="bda-menu-item" data-set-share="' + k + '"><span class="bda-menu-label">' + v + '</span>' +
      (state.filters.sharing === k ? '<span class="bda-tick">' + SVG_ICONS.tick + '</span>' : '') + '</button>'
    ).join('') +
    '</div></div>' +
    '<div class="bda-menu-rule"></div>' +
    '<button type="button" class="bda-menu-item" data-toggle-pinned="true">' +
    ('<span class="bda-menu-label">' + t('pinned') + '</span>') + (state.filters.pinned ? '<span class="bda-tick">' + SVG_ICONS.tick + '</span>' : '') +
    '</button>' +
    (isFilterActive() ? ('<button type="button" class="bda-menu-item" data-clear-filters="true"><span class="bda-menu-label">' + t('clearFilters') + '</span></button>') : '') +
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
  if (btn && btn.getAttribute('data-skill')) openCreateDialog(btn.getAttribute('data-skill'));
};

document.getElementById('examples').onclick = async (e) => {
  const btn = e.target.closest('[data-example]');
  if (!btn) return;
  const example = OFFICIAL_EXAMPLES.find(x => x.id === btn.getAttribute('data-example'));
  if (!example) return;
  if (btn.getAttribute('data-act') === 'preview') {
    openDialog('<h2>' + esc(exampleText(example, 'title')) + '</h2><p>' + esc(exampleText(example, 'desc')) + '</p>' +
      (example.html ? '<div class="bda-example-preview" id="examplePreview"><iframe sandbox="" title="' + esc(t('previewTitle', {title: exampleText(example, 'title')})) + '"></iframe></div>' :
        '<div class="bda-example-skeleton">' + drawnHtml(example.skill, exampleText(example, 'title')) +
        ('<p>' + t('exampleSkeleton') + '</p></div>')) +
      '<p>' + esc(exampleText(example, 'points')) + ('</p><div class="bda-dialog-actions"><button type="button" class="bda-btn" id="exampleClose">' + t('close') + '</button></div>'));
    document.getElementById('exampleClose').onclick = closeDialog;
    if (example.html) {
      const preview = document.getElementById('examplePreview');
      const frame = preview.querySelector('iframe');
      const scale = preview.clientWidth / 880;
      preview.style.height = (560 * scale) + 'px';
      frame.style.transform = 'scale(' + scale + ')';
      frame.srcdoc = example.html.replaceAll(STR.zh.samplePresentation, t('samplePresentation'));
    }
    return;
  }
  btn.disabled = true;
  try {
    const res = await api('/api/start', { method: 'POST', headers: {'content-type':'application/json'}, body: JSON.stringify({ example: example.id }) });
    if (res.ok) showToast(t('exampleStarted'));
    else if (res.starter) {
      try { await navigator.clipboard.writeText(res.starter); showToast(t('draftCopied') + (res.error || '')); }
      catch { showToast(t('startFailed') + (res.error || '') + t('draftPrefix') + res.starter); }
    } else showToast(t('startFailed') + (res.error || t('unknownError')));
  } catch (err) { showToast(t('startFailed') + err.message); }
  finally { btn.disabled = false; }
};

document.getElementById('recipes').onclick = async (e) => {
  const btn = e.target.closest('[data-recipe]');
  if (!btn) return;
  const res = await api('/api/start', { method: 'POST', headers: {'content-type':'application/json'}, body: JSON.stringify({ recipe: btn.getAttribute('data-recipe') }) });
  if (res.ok) {
    showToast(t('workflowSent', {outcome: res.outcome || 'chat'}));
  } else {
    try { await navigator.clipboard.writeText(res.starter || ''); showToast(t('draftCopied') + (res.error || '')); }
    catch { showToast(t('workflowFailed') + (res.error || '')); }
  }
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
  writePreference('ps_view_mode', state.viewMode);
  renderItems();
};

// 筛选按钮
document.getElementById('filterBtn').onclick = (e) => {
  showFilterMenu(e.currentTarget);
};

// 刷新按钮
document.getElementById('reloadBtn').onclick = async () => {
  await reload();
  showToast(t('refreshed'));
};

async function reload() {
  try {
    const res = await api('/api/list');
    if (res.ok) {
      state.artifacts = res.artifacts || [];
      state.workspaceName = res.workspaceName || '';
      state.workspaceRoot = res.workspaceRoot || '';
      document.getElementById('wsLabel').textContent = state.workspaceName ? t('workspace') + state.workspaceName : '';
      renderItems();
    }
  } catch (err) {
    showToast(t('loadFailed') + err.message);
  }
}

// Localized sections share the same render entry point.
function renderExamples() {
  document.getElementById('examples').innerHTML = OFFICIAL_EXAMPLES.map(example =>
    '<li class="bda-example"><span class="bda-example-skill">' + typeIconSvg(example.skill, 16) + esc(skillText(example.skill, 'name')) + '</span>' +
    '<h3>' + esc(exampleText(example, 'title')) + '</h3><p>' + esc(exampleText(example, 'desc')) + '</p>' +
    '<div class="bda-example-actions"><button type="button" class="bda-btn" data-act="preview" data-example="' + esc(example.id) + ('">' + t('preview') + '</button>') +
    '<button type="button" class="bda-btn" data-primary="true" data-act="start" data-example="' + esc(example.id) + ('">' + t('recreate') + '</button></div></li>')).join('');
}
function renderRecipes() {
  const ul = document.getElementById('recipes');
  ul.innerHTML = RECIPES.map(r =>
    '<li><button type="button" class="bda-tile" data-recipe="' + esc(r.id) + '">' +
    '<span class="bda-tile-art" style="min-height:40px;justify-content:flex-start">' +
    '<span class="bda-tile-label" style="font-size:13px">' + esc(t('recipe.' + r.id + '.title')) + '</span>' +
    '</span>' +
    '<span class="bda-recipe-desc" style="padding:0 2px">' + esc(t('recipe.' + r.id + '.desc')) + '</span>' +
    '</button></li>').join('');
}
function renderAll() {
  document.documentElement.lang = locale();
  document.title = t('works') + ' · Prototype Studio';
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
  closeMenu();
  closeDialog();
  document.getElementById('toast').className = 'hidden';
  renderAll();
};
renderAll();
reload();
</script>
</body>
</html>`;
}

// 做同款：按已有作品的记录构造 starter 草稿，经 `orca agent launch` 在焦点工作区
// 开一个新对话并自动发送（guizang「做同款」的 Orca 化）。失败把 starter 返回给前端，
// 前端退化为剪贴板复制，主流程不断。
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
    const starter = `${SKILL_BY_ID[example.skill].prompt}${example.desc}\n参考示例 ${example.points}。请在当前工作区 .design/ 内创建新项目。`;
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
  const allowedGet = ['/', '/api/list', '/api/open', '/api/open-url', '/api/preview', '/api/thumb'];
  const allowedPost = ['/api/open', '/api/update', '/api/delete', '/api/restore', '/api/create', '/api/rename', '/api/stop', '/api/restart', '/api/restart-editor', '/api/start', '/api/register', '/api/forget'];
  if (!((req.method === 'GET' && allowedGet.includes(url.pathname)) || (req.method === 'POST' && allowedPost.includes(url.pathname)))) {
    res.statusCode = 404; return res.end('{}');
  }
  // POST 收口：跨站 text/plain 伪装 POST（免预检通道）在此拒绝
  if (req.method === 'POST') {
    const g = guardPost(req);
    if (g) { res.statusCode = g; return res.end('{}'); }
  }
  const finish = (v) => res.end(JSON.stringify(v));

  if (req.method === 'GET') {
    if (url.pathname === '/') return res.end(galleryHtml(url.searchParams.get('lang')));
    if (url.pathname === '/api/list') return finish(listArtifactsViews());
    const skill = url.searchParams.get('skill') || '';
    const root = url.searchParams.get('root') || '';
    if (url.pathname === '/api/open-url') {
      return openSkillEditor(skill, root).then((r) => {
        if (!r.ok) { res.statusCode = 400; return finish(r); }
        res.statusCode = 302; res.setHeader('location', r.url); return res.end();
      });
    }
    if (url.pathname === '/api/preview' || url.pathname === '/api/thumb') {
      // 只读已登记记录或工作区 .design/ 内的 root，防任意文件读取
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
    return openSkillEditor(skill, root).then(finish);
  }

  let body = '';
  req.on('data', (c) => { body += c; if (body.length > MAX_BODY_BYTES) req.destroy(); });
  req.on('end', async () => {
    let input = {}; try {
      const parsed = JSON.parse(body || '{}');
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) input = parsed;
    } catch {}
    const skill = input.skill || '', root = input.root || '';

    if (url.pathname === '/api/register') {
      const result = registerArtifact(input);
      if (!result.ok) res.statusCode = 400;
      return finish(result);
    }
    if (url.pathname === '/api/open') return finish(await openSkillEditor(skill, root));
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
