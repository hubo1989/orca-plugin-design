import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../', import.meta.url));

test('manifests declare MIT license and strictly lock capabilities', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  const plugin = JSON.parse(fs.readFileSync(path.join(ROOT, 'orca-plugin.json'), 'utf8'));
  assert.equal(pkg.license, 'MIT');
  assert.equal(plugin.license, 'MIT');
  assert.deepEqual(plugin.capabilities, [
    { kind: 'workspace:read' },
    { kind: 'agent:read' },
  ]);
});

test('removed legacy closed-source assets and runtime tarball do not exist', () => {
  for (const rel of [
    'vendor/baoyu-design',
    'vendor/manifest.json',
    'vendor/open-artifact-runtime.tgz',
    'vendor-rewrites.json',
    'tools/vendor-baoyu.mjs',
  ]) {
    assert.equal(fs.existsSync(path.join(ROOT, rel)), false, `${rel} must be removed`);
  }
});

test('shipped directories contain zero LicenseRef-Mixed, Anthropic, or AGPL residuals', () => {
  const dirs = ['src', 'tools', 'vendor', 'references', 'templates', 'bin'];
  const files = ['LICENSE', 'NOTICE.md', 'README.md', 'package.json', 'orca-plugin.json'];
  const targets = files.map((f) => path.join(ROOT, f));

  const walk = (d) => {
    if (!fs.existsSync(d)) return;
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.isFile()) targets.push(p);
    }
  };
  for (const d of dirs) walk(path.join(ROOT, d));

  const forbidden = ['LicenseRef-Mixed', "Anthropic's intellectual property", 'Anthropic', 'AGPL'];
  for (const file of targets) {
    const ext = path.extname(file).toLowerCase();
    if (['.png', '.jpg', '.jpeg', '.webp'].includes(ext)) continue;
    const text = fs.readFileSync(file, 'utf8');
    for (const term of forbidden) {
      assert.equal(text.includes(term), false, `Found forbidden term ${term} in ${path.relative(ROOT, file)}`);
    }
  }
});

test('GALLERY_STR zh and en have 100% key parity and cover all t() calls', async () => {
  const { GALLERY_STR, galleryHtml } = await import('../src/gallery-server.mjs');
  const zhKeys = new Set(Object.keys(GALLERY_STR.zh));
  const enKeys = new Set(Object.keys(GALLERY_STR.en));
  assert.deepEqual([...zhKeys].sort(), [...enKeys].sort());

  const html = galleryHtml('zh');
  const scriptMatch = html.match(/<script type="module">([\s\S]*)<\/script>/);
  assert.ok(scriptMatch);
  const calls = [...scriptMatch[1].matchAll(/\bt\('([A-Za-z0-9_.]+)'/g)].map((m) => m[1]);
  for (const key of calls) {
    assert.ok(zhKeys.has(key), `Missing zh i18n key: ${key}`);
    assert.ok(enKeys.has(key), `Missing en i18n key: ${key}`);
  }
});
