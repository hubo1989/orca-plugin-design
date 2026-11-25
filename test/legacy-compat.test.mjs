import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ps-legacy-compat-'));
const wsDir = path.join(tmpDir, 'git-ws');
const legacyHome = path.join(tmpDir, 'baoyu-design');
const newHome = path.join(tmpDir, 'orca-design');
const oaHome = path.join(tmpDir, 'oa-home');

fs.mkdirSync(wsDir, { recursive: true });
fs.mkdirSync(oaHome, { recursive: true });

const legacySpecs = [
  ['deck-1', 'project/deck.json', { v: 4, title: 'Legacy Slides', order: ['s1'] }],
  ['canvas-1', 'project/canvas.json', { v: 3, title: 'Legacy Canvas', boards: { 'a.html': {} }, order: ['a.html'] }],
  ['ds-1', 'project/design-system.json', { v: 3, title: 'Legacy DS' }],
  ['dash-1', 'db/dash/meta.json', { title: 'Legacy Dash', sheets: { s1: {} } }],
  ['film-1', 'db/film/meta.json', { title: 'Legacy Motion', scenes: ['s1'] }],
];

for (const [dir, rel, data] of legacySpecs) {
  const file = path.join(wsDir, '.design', dir, rel);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(data, null, 2));
}

const brokenDir = path.join(wsDir, '.design', 'broken-dash');
fs.mkdirSync(path.join(brokenDir, 'db', 'dash'), { recursive: true });
fs.mkdirSync(path.join(brokenDir, 'project'), { recursive: true });
fs.writeFileSync(path.join(brokenDir, 'db', 'dash', 'meta.json'), '{broken json');
fs.writeFileSync(path.join(brokenDir, 'project', 'preview.html'), '<html><body>ro</body></html>');

const git = (...args) => execFileSync('git', ['-C', wsDir, ...args], { encoding: 'utf8', stdio: 'pipe' });
git('init');
git('add', '.');
git('-c', 'user.name=Test', '-c', 'user.email=t@example.invalid', '-c', 'commit.gpgsign=false', 'commit', '-m', 'init legacy');

const canvasRoot = path.join(wsDir, '.design', 'canvas-1');
const hash = crypto.createHash('sha256').update(canvasRoot).digest('hex').slice(0, 24);
fs.mkdirSync(path.join(legacyHome, 'artifacts'), { recursive: true });
fs.mkdirSync(path.join(legacyHome, 'thumbs'), { recursive: true });
fs.mkdirSync(path.join(legacyHome, 'trash'), { recursive: true });
fs.writeFileSync(path.join(legacyHome, 'artifacts', `${hash}.json`), JSON.stringify({
  v: 1,
  root: canvasRoot,
  skill: 'claude-design',
  title: 'Pinned Legacy Canvas',
  pinned: true,
  note: 'Preserved note',
  openedAt: '2026-11-01T00:00:00Z',
}));
fs.writeFileSync(path.join(legacyHome, 'thumbs', `${hash}.png`), Buffer.from('89504e470d0a1a0a', 'hex'));

process.env.ORCA_DESIGN_HOME = newHome;
process.env.OPEN_ARTIFACT_HOME = oaHome;
process.env.ORCA_DESIGN_NO_THUMB = '1';
process.env.ORCA_STATE_FILE = path.join(tmpDir, 'state.json');
fs.writeFileSync(process.env.ORCA_STATE_FILE, JSON.stringify({ workspaceRoot: wsDir, workspaceName: 'git-ws' }));

const {
  migrateLegacyDesignHome,
  listArtifactsViews,
  listArtifactsViewsAsync,
  openSkillEditor,
} = await import('../src/gallery-server.mjs');

test('migrateLegacyDesignHome copies baoyu-design/{artifacts,thumbs,trash} read-only without deleting legacy dir', () => {
  const res = migrateLegacyDesignHome(newHome, legacyHome);
  assert.equal(res.migrated, true, JSON.stringify(res));
  assert.deepEqual(res.copied.sort(), ['artifacts', 'thumbs', 'trash']);
  assert.ok(fs.existsSync(path.join(newHome, 'artifacts', `${hash}.json`)));
  assert.ok(fs.existsSync(path.join(newHome, 'thumbs', `${hash}.png`)));
  assert.ok(fs.existsSync(path.join(legacyHome, 'artifacts', `${hash}.json`)));
});

test('lazy scan discovers all 5 legacy .design/ types, preserves pinned/note, and leaves git status clean', async () => {
  const syncView = listArtifactsViews();
  assert.equal(syncView.ok, true);
  const asyncView = await listArtifactsViewsAsync();
  assert.equal(asyncView.ok, true);

  const byRoot = new Map(asyncView.artifacts.map((a) => [path.basename(a.root), a]));
  assert.equal(byRoot.get('deck-1')?.skill, 'slides');
  assert.equal(byRoot.get('canvas-1')?.skill, 'design');
  assert.equal(byRoot.get('canvas-1')?.pinned, true);
  assert.equal(byRoot.get('canvas-1')?.note, 'Preserved note');
  assert.equal(byRoot.get('canvas-1')?.thumb, true);
  assert.equal(byRoot.get('ds-1')?.skill, 'design-system');
  assert.equal(byRoot.get('dash-1')?.skill, 'data');
  assert.equal(byRoot.get('film-1')?.skill, 'motion');

  const status = git('status', '--short').trim();
  assert.equal(status, '', `Expected clean git status, got:\n${status}`);
});

test('corrupted legacy project returns legacy_incompatible and leaves disk bytes untouched', async () => {
  const brokenMeta = path.join(brokenDir, 'db', 'dash', 'meta.json');
  const before = fs.readFileSync(brokenMeta);
  const res = await openSkillEditor('data', brokenDir);
  assert.equal(res.ok, false);
  assert.equal(res.code, 'legacy_incompatible');
  assert.equal(res.hasStaticHtml, true);
  assert.deepEqual(fs.readFileSync(brokenMeta), before);
});

test.after(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});
