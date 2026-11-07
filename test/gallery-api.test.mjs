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
const stateFile = path.join(os.tmpdir(), 'prototype-studio-state.json');
fs.writeFileSync(stateFile, JSON.stringify({ workspaceRoot: wsDir, workspaceName: 'test-workspace' }));

const {
  listArtifactsViews,
  createExample,
  renameArtifact,
  trashArtifact,
  restoreArtifact,
  findArtifact,
  writeRecord,
  galleryHtml,
} = await import('../src/gallery-server.mjs');

test('gallery HTML renders dsh-claude-artifacts compatible elements and styles', () => {
  const html = galleryHtml();
  assert.ok(html.includes('.bda-page'), 'Contains .bda-page class');
  assert.ok(html.includes('.bda-tiles'), 'Contains .bda-tiles class');
  assert.ok(html.includes('.bda-grid'), 'Contains .bda-grid class');
  assert.ok(html.includes('--dsw-alias-bg-base'), 'Contains --dsw-alias-bg-base CSS variable');
  assert.ok(html.includes('claude-slides'), 'Supports claude-slides');
  assert.ok(html.includes('claude-design'), 'Supports claude-design');
  assert.ok(html.includes('claude-design-system'), 'Supports claude-design-system');
  assert.ok(html.includes('claude-dashboard'), 'Supports claude-dashboard');
  assert.ok(html.includes('claude-motion'), 'Supports claude-motion');
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

  // 清理
  try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
});
