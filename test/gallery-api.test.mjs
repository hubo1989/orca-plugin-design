import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ps-gallery-unit-'));
const wsDir = path.join(tmpDir, 'workspace');
const designHome = path.join(tmpDir, 'orca-design');
const oaHome = path.join(tmpDir, 'oa-home');
fs.mkdirSync(wsDir, { recursive: true });
fs.mkdirSync(designHome, { recursive: true });
fs.mkdirSync(oaHome, { recursive: true });

process.env.ORCA_DESIGN_HOME = designHome;
process.env.ORCA_DESIGN_LEGACY_HOME = path.join(tmpDir, 'baoyu-design');
process.env.OPEN_ARTIFACT_HOME = oaHome;
process.env.ORCA_DESIGN_NO_THUMB = '1';
process.env.ORCA_STATE_FILE = path.join(tmpDir, 'prototype-studio-state.json');
fs.writeFileSync(process.env.ORCA_STATE_FILE, JSON.stringify({ workspaceRoot: wsDir, workspaceName: 'test-workspace' }));

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

test('gallery HTML renders 9 built-in Open Artifact types and skeleton UI', () => {
  const html = galleryHtml();
  assert.ok(html.includes('.bda-page'), 'Contains .bda-page class');
  assert.ok(html.includes('.bda-skeleton-grid'), 'Contains instant skeleton grid');
  assert.ok(html.includes('/vendor/harness-embed.mjs'), 'Imports embedArtifact bundle');
  for (const typeId of ['slides', 'design', 'design-system', 'whiteboard', 'sheets', 'data', 'docs', 'motion', 'page']) {
    assert.ok(html.includes(`'${typeId}'`) || html.includes(`"${typeId}"`), `Supports ${typeId}`);
  }
});

test('gallery lifecycle: create -> scan -> update -> trash -> restore', async () => {
  const initial = listArtifactsViews();
  assert.equal(initial.ok, true);
  assert.equal(initial.artifacts.length, 0);

  const created = await createExample('claude-design', 'demo-canvas');
  assert.equal(created.ok, true);
  assert.ok(created.root);
  assert.ok(fs.existsSync(path.join(created.root, 'project', 'canvas.json')));

  const afterCreate = listArtifactsViews();
  assert.equal(afterCreate.artifacts.length, 1);
  const item = afterCreate.artifacts[0];
  assert.equal(item.skill, 'design');
  assert.equal(item.title, 'demo-canvas');
  assert.equal(item.pinned, false);

  const record = findArtifact(item.root);
  assert.ok(record);
  record.pinned = true;
  writeRecord(record);
  await renameArtifact('design', item.root, 'Renamed Canvas');

  const afterUpdate = listArtifactsViews();
  assert.equal(afterUpdate.artifacts.length, 1);
  assert.equal(afterUpdate.artifacts[0].pinned, true);
  assert.equal(afterUpdate.artifacts[0].title, 'Renamed Canvas');

  const freshRecord = findArtifact(item.root);
  const trashed = trashArtifact(freshRecord);
  assert.ok(trashed.trash);
  assert.equal(trashed.moved, true);

  const afterTrash = listArtifactsViews();
  assert.equal(afterTrash.artifacts.length, 0);

  const restored = restoreArtifact(trashed.trash);
  assert.equal(restored.root, item.root);

  const afterRestore = listArtifactsViews();
  assert.equal(afterRestore.artifacts.length, 1);
  assert.equal(afterRestore.artifacts[0].title, 'Renamed Canvas');
});

test.after(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});
