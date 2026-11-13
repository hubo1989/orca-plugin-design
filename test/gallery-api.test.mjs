import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ps-gallery-unit-'));
const wsDir = path.join(tmpDir, 'workspace');
const designHome = path.join(tmpDir, 'baoyu-design');
fs.mkdirSync(wsDir, { recursive: true });
fs.mkdirSync(designHome, { recursive: true });

process.env.ORCA_DESIGN_HOME = designHome;
process.env.ORCA_STATE_FILE = path.join(tmpDir, 'prototype-studio-state.json');
process.env.ORCA_PROFILE_DB = path.join(tmpDir, 'nonexistent-profile.db');
const stateFile = process.env.ORCA_STATE_FILE;
// worker 的 writeState 现在带 updatedAt；readState 只认 15s 内的快照，否则回退 profile DB。
fs.writeFileSync(stateFile, JSON.stringify({ workspaceRoot: wsDir, workspaceName: 'test-workspace', updatedAt: Date.now() }));

const {
  listArtifactsViews,
  createExample,
  renameArtifact,
  trashArtifact,
  restoreArtifact,
  findArtifact,
  writeRecord,
  forgetMissingArtifacts,
  previewEntry,
  galleryHtml,
} = await import('../src/gallery-server.mjs');

function refreshWorkspaceState() {
  fs.writeFileSync(stateFile, JSON.stringify({
    workspaceRoot: wsDir,
    workspaceName: 'test-workspace',
    updatedAt: Date.now(),
  }));
}

test('gallery HTML renders studio layout, Lakala design system stage, and valid client script', () => {
  const html = galleryHtml();
  assert.ok(html.includes('.bda-page'), 'Contains .bda-page class');
  assert.ok(html.includes('.bda-tiles'), 'Contains .bda-tiles class');
  assert.ok(html.includes('.bda-grid'), 'Contains .bda-grid class');
  assert.ok(html.includes('--dsw-alias-bg-base'), 'Contains --dsw-alias-bg-base CSS variable');
  assert.ok(html.includes('id="sec-ds"'), 'Contains dedicated design system stage');
  assert.ok(html.includes('#00b9f1'), 'Includes Lakala brand cyan token');
  assert.ok(html.indexOf('id="sec-examples"') < html.indexOf('id="sec-works"'), 'Examples appear ahead of empty works section by default');
  assert.ok(!/\.bda-example-stage iframe\s*\{[^}]*opacity:\s*0/.test(html), 'Example stage iframes are never hidden behind opacity:0');
  assert.ok(!/content\.appendChild\(sec\)/.test(html), 'Section reordering never moves DOM nodes with appendChild');
  assert.ok(html.includes('claude-slides'), 'Supports claude-slides');
  assert.ok(html.includes('claude-design'), 'Supports claude-design');
  assert.ok(html.includes('claude-design-system'), 'Supports claude-design-system');
  assert.ok(html.includes('claude-dashboard'), 'Supports claude-dashboard');
  assert.ok(html.includes('claude-motion'), 'Supports claude-motion');

  const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
  assert.equal(scripts.length, 2, 'Contains head bootstrap script and main studio script');
  for (const code of scripts) {
    assert.doesNotThrow(() => new Function(code), 'Inline client script compiles without syntax error');
  }
});

test('gallery lifecycle: create -> scan -> update -> trash -> restore', async () => {
  // 1. 初始状态下列表为空
  const initial = listArtifactsViews();
  assert.equal(initial.ok, true);
  assert.equal(initial.artifacts.length, 0);

  // 2. 创建一个 claude-design 示例
  const created = await createExample('claude-design', 'demo-canvas');
  assert.equal(created.ok, true);
  assert.ok(created.root);
  assert.ok(fs.existsSync(path.join(created.root, 'project', 'canvas.json')));

  // 3. 扫描并列出作品
  const afterCreate = listArtifactsViews();
  assert.equal(afterCreate.artifacts.length, 1);
  const item = afterCreate.artifacts[0];
  assert.equal(item.skill, 'claude-design');
  assert.equal(item.title, 'demo-canvas');
  assert.equal(item.pinned, false);

  // 4. 更新置顶和重命名
  const record = findArtifact(item.root);
  assert.ok(record);
  record.pinned = true;
  writeRecord(record);
  await renameArtifact('claude-design', item.root, 'Renamed Canvas');

  const afterUpdate = listArtifactsViews();
  assert.equal(afterUpdate.artifacts.length, 1);
  assert.equal(afterUpdate.artifacts[0].pinned, true);
  assert.equal(afterUpdate.artifacts[0].title, 'Renamed Canvas');

  // 5. 软删除作品到 trash/
  const trashed = trashArtifact(record);
  assert.ok(trashed.trash);
  assert.equal(trashed.moved, true);

  const afterTrash = listArtifactsViews();
  assert.equal(afterTrash.artifacts.length, 0);

  // 6. 从 trash/ 恢复作品
  const restored = restoreArtifact(trashed.trash);
  assert.equal(restored.root, item.root);

  const afterRestore = listArtifactsViews();
  assert.equal(afterRestore.artifacts.length, 1);
  assert.equal(afterRestore.artifacts[0].title, 'Renamed Canvas');
});

test('built-in Lakala design system and curated templates pass artifact checks and resolve cover previews', async () => {
  refreshWorkspaceState();
  const ds = await createExample('claude-design-system');
  assert.equal(ds.ok, true);
  assert.equal(ds.problems, 0);
  const tokens = JSON.parse(fs.readFileSync(path.join(ds.root, 'project', 'tokens.json'), 'utf8'));
  const primary = tokens.color.tokens.find((t) => t.name === 'brand-primary');
  assert.equal(primary?.value, '#00b9f1');
  assert.match(previewEntry(ds.root, 'claude-design-system') || '', /Cover[\\/]preview\.html$/);

  const deck = await createExample('claude-slides');
  assert.equal(deck.ok, true);
  assert.equal(deck.problems, 0);
  assert.match(previewEntry(deck.root, 'claude-slides') || '', /cover\.html$/);

  const mobile = await createExample('lakala-mobile');
  assert.equal(mobile.ok, true);
  assert.equal(mobile.skill, 'claude-design');
  assert.equal(mobile.problems, 0);
});

test('missing artifact governance: detect missing, auto-heal when restored, and batch forget stale records', async () => {
  refreshWorkspaceState();
  const created = await createExample('lakala-poster', 'temp-poster');
  assert.equal(created.ok, true);

  // Pin it and remove its folder from disk: valid items must still rank ahead of missing records.
  const rec = findArtifact(created.root);
  rec.pinned = true;
  writeRecord(rec);
  const backupPath = path.join(tmpDir, 'moved-outside-workspace');
  fs.renameSync(created.root, backupPath);

  const whileMissing = listArtifactsViews();
  const missingView = whileMissing.artifacts.find((a) => a.root === created.root);
  assert.ok(missingView);
  assert.equal(missingView.missing, true);
  assert.equal(missingView.openable, false);
  assert.equal(whileMissing.artifacts[0].missing, false, 'Pinned missing item never outranks valid projects');

  // Restore folder: missing flag heals automatically.
  fs.renameSync(backupPath, created.root);
  const healed = listArtifactsViews();
  const healedView = healed.artifacts.find((a) => a.root === created.root);
  assert.equal(healedView?.missing, false);

  // Delete folder permanently and batch-forget stale records.
  fs.rmSync(created.root, { recursive: true, force: true });
  assert.equal(listArtifactsViews().artifacts.some((a) => a.missing), true);
  const cleaned = forgetMissingArtifacts();
  assert.equal(cleaned.ok, true);
  assert.equal(cleaned.removed, 1);

  const afterForget = listArtifactsViews();
  assert.equal(afterForget.artifacts.some((a) => a.missing), false);
  assert.ok(afterForget.artifacts.length >= 4, 'Valid projects remain intact');
  assert.ok(typeof afterForget.buildId === 'string' && afterForget.buildId.length >= 8, 'Includes gallery buildId');

  // Stale state file (>15s old) still preserves existing workspace directory when profile DB has no newer focus
  fs.writeFileSync(stateFile, JSON.stringify({
    workspaceRoot: wsDir,
    workspaceName: 'stale-but-valid-ws',
    updatedAt: Date.now() - 120_000,
  }));
  const fallbackList = listArtifactsViews();
  assert.equal(fallbackList.workspaceRoot, wsDir);
});

test.after(() => {
  try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
});
