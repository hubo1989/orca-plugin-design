#!/usr/bin/env node
// 将 src/gallery-ui.mjs 的 buildGalleryPageHtml() 同步到 src/gallery-page.html（供 LKL-PMStudio 左侧边栏常规页加载）。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildGalleryPageHtml } from '../src/gallery-ui.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TARGET = path.join(ROOT, 'src', 'gallery-page.html');
const checkOnly = process.argv.includes('--check');

const expected = buildGalleryPageHtml();

if (checkOnly) {
  const actual = fs.existsSync(TARGET) ? fs.readFileSync(TARGET, 'utf8') : '';
  if (actual !== expected) {
    console.error('src/gallery-page.html is out of sync with buildGalleryPageHtml(). Run: node tools/sync-gallery-page.mjs');
    process.exit(1);
  }
  console.log('src/gallery-page.html: OK');
  process.exit(0);
}

fs.writeFileSync(TARGET, expected, 'utf8');
console.log(`Synced ${TARGET} (${Buffer.byteLength(expected, 'utf8')} bytes)`);
