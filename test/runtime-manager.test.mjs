import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

import {
  discoverLocalRuntime,
  ensureRuntime,
  importOfflineTarball,
  onRuntimeProgress,
} from '../src/runtime-manager.mjs';
import { checkVendorState, validateManifestObject } from '../tools/vendor-open-artifact.mjs';

const ROOT = fileURLToPath(new URL('../', import.meta.url));

function makeUstarTarGz(files) {
  const blocks = [];
  for (const [relPath, content] of Object.entries(files)) {
    const data = Buffer.from(content, 'utf8');
    const header = Buffer.alloc(512, 0);
    header.write(relPath, 0, 100, 'utf8');
    header.write('0000755\0', 100, 8, 'latin1');
    header.write('0000000\0', 108, 8, 'latin1');
    header.write('0000000\0', 116, 8, 'latin1');
    header.write(data.length.toString(8).padStart(11, '0') + '\0', 124, 12, 'latin1');
    header.write('00000000000\0', 136, 12, 'latin1');
    header.fill(32, 148, 156);
    header.write('0', 156, 1, 'latin1');
    header.write('ustar\0', 257, 6, 'latin1');
    header.write('00', 263, 2, 'latin1');
    let sum = 0;
    for (let i = 0; i < 512; i++) sum += header[i];
    header.write(sum.toString(8).padStart(6, '0') + '\0 ', 148, 8, 'latin1');
    blocks.push(header);
    if (data.length > 0) {
      blocks.push(data);
      const rem = data.length % 512;
      if (rem) blocks.push(Buffer.alloc(512 - rem, 0));
    }
  }
  blocks.push(Buffer.alloc(1024, 0));
  return zlib.gzipSync(Buffer.concat(blocks));
}

function buildValidRuntimeTgz(version = '0.14.7') {
  const tgz = makeUstarTarGz({
    'package/package.json': JSON.stringify({
      name: '@open-artifact/cli',
      version,
      openArtifact: { protocols: { min: 1, max: 1 } },
    }),
    'package/scripts/open-artifact.mjs': '#!/usr/bin/env node\nconsole.log("ok");\n',
  });
  const integrity = 'sha512-' + crypto.createHash('sha512').update(tgz).digest('base64');
  return { tgz, integrity };
}

function writeTestManifest(dir, version, integrity, sizeBytes, urls) {
  const file = path.join(dir, 'runtime-manifest.json');
  fs.writeFileSync(file, JSON.stringify({
    package: '@open-artifact/cli',
    version,
    integrity,
    sizeBytes,
    protocols: { min: 1, max: 1 },
    urls,
  }, null, 2));
  return file;
}

test('vendor-open-artifact --check passes on repo', () => {
  const res = checkVendorState(ROOT);
  assert.equal(res.ok, true, JSON.stringify(res));
  const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'vendor', 'runtime-manifest.json'), 'utf8'));
  assert.equal(validateManifestObject(manifest), null);
});

test('Layer 1: env override and shared local runtime reuse with 0 downloads', async (t) => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'oa-rm-reuse-'));
  t.after(() => fs.rmSync(tmp, { recursive: true, force: true }));

  const envRtDir = path.join(tmp, 'env-rt');
  fs.mkdirSync(path.join(envRtDir, 'scripts'), { recursive: true });
  fs.writeFileSync(path.join(envRtDir, 'package.json'), JSON.stringify({ name: '@open-artifact/cli', version: '0.14.7', openArtifact: { protocols: { min: 1, max: 1 } } }));
  fs.writeFileSync(path.join(envRtDir, 'scripts', 'open-artifact.mjs'), 'export {};\n');

  const hitEnv = discoverLocalRuntime({ home: path.join(tmp, 'home1'), env: { ORCA_DESIGN_OA_RUNTIME: envRtDir } });
  assert.equal(hitEnv?.source, 'env');
  assert.equal(hitEnv?.dir, fs.realpathSync(envRtDir));

  const home2 = path.join(tmp, 'home2');
  const sharedDir = path.join(home2, 'runtime', '0.14.8');
  fs.mkdirSync(path.join(sharedDir, 'scripts'), { recursive: true });
  fs.writeFileSync(path.join(sharedDir, 'package.json'), JSON.stringify({ name: '@open-artifact/cli', version: '0.14.8', openArtifact: { protocols: { min: 1, max: 1 } } }));
  fs.writeFileSync(path.join(sharedDir, 'scripts', 'open-artifact.mjs'), 'export {};\n');

  let fetchCount = 0;
  const res = await ensureRuntime({
    home: home2,
    env: {},
    fetchImpl: async () => { fetchCount++; throw new Error('must not fetch'); },
  });
  assert.equal(res.ok, true);
  assert.equal(res.reused, true);
  assert.equal(res.version, '0.14.8');
  assert.equal(fetchCount, 0);
});

test('Layer 2: offline .tgz import verifies sha512 and extracts atomically', async (t) => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'oa-rm-offline-'));
  t.after(() => fs.rmSync(tmp, { recursive: true, force: true }));

  const { tgz, integrity } = buildValidRuntimeTgz('0.14.7');
  const manifestPath = writeTestManifest(tmp, '0.14.7', integrity, tgz.length, ['https://primary.example/cli.tgz', 'https://mirror.example/cli.tgz']);
  const home = path.join(tmp, 'home');

  const badTgzPath = path.join(tmp, 'bad.tgz');
  fs.writeFileSync(badTgzPath, Buffer.from('corrupted data'));
  const badRes = await importOfflineTarball({ filePath: badTgzPath }, { home, manifestPath });
  assert.equal(badRes.ok, false);
  assert.equal(badRes.code, 'SHA512_MISMATCH');

  const goodTgzPath = path.join(tmp, 'good.tgz');
  fs.writeFileSync(goodTgzPath, tgz);
  const goodRes = await importOfflineTarball({ filePath: goodTgzPath }, { home, manifestPath });
  assert.equal(goodRes.ok, true);
  assert.equal(goodRes.source, 'offline');
  assert.ok(fs.existsSync(path.join(home, 'runtime', '0.14.7', '.install.json')));
  assert.ok(fs.existsSync(path.join(home, 'runtimes.json')));
});

test('Layer 3: single-flight concurrency lock + sha512 mismatch deletes temp tarball and falls back to mirror', async (t) => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'oa-rm-dl-'));
  t.after(() => fs.rmSync(tmp, { recursive: true, force: true }));

  const { tgz, integrity } = buildValidRuntimeTgz('0.14.7');
  const manifestPath = writeTestManifest(
    tmp,
    '0.14.7',
    integrity,
    tgz.length,
    ['https://primary.invalid/cli.tgz', 'https://mirror.invalid/cli.tgz']
  );
  const home = path.join(tmp, 'home');
  const seenUrls = [];
  const events = [];
  const unsub = onRuntimeProgress((ev) => events.push(ev.state));

  const fetchImpl = async (url) => {
    seenUrls.push(url);
    await new Promise((r) => setTimeout(r, 30));
    if (url.includes('primary.invalid')) {
      const corrupt = Buffer.from('corrupt-tarball-bytes');
      return new Response(corrupt, { status: 200, headers: { 'content-length': String(corrupt.length) } });
    }
    return new Response(tgz, { status: 200, headers: { 'content-length': String(tgz.length) } });
  };

  const [r1, r2, r3] = await Promise.all([
    ensureRuntime({ home, manifestPath, env: {}, fetchImpl }),
    ensureRuntime({ home, manifestPath, env: {}, fetchImpl }),
    ensureRuntime({ home, manifestPath, env: {}, fetchImpl }),
  ]);
  unsub();

  assert.equal(r1.ok, true);
  assert.equal(r2.ok, true);
  assert.equal(r3.ok, true);
  assert.deepEqual(seenUrls, ['https://primary.invalid/cli.tgz', 'https://mirror.invalid/cli.tgz']);
  assert.ok(events.includes('downloading'));
  assert.ok(events.includes('verifying'));
  assert.ok(events.includes('extracting'));
  assert.ok(events.includes('ready'));

  const runtimeEntries = fs.readdirSync(path.join(home, 'runtime'));
  assert.deepEqual(runtimeEntries.filter((n) => n.startsWith('.download-') || n.startsWith('.staging-')), []);
});

test('Layer 3: cleans temp tarballs when all sources fail', async (t) => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'oa-rm-fail-'));
  t.after(() => fs.rmSync(tmp, { recursive: true, force: true }));

  const { tgz, integrity } = buildValidRuntimeTgz('0.14.7');
  const manifestPath = writeTestManifest(tmp, '0.14.7', integrity, tgz.length, ['https://u1.invalid/a.tgz', 'https://u2.invalid/b.tgz']);
  const home = path.join(tmp, 'home');

  const res = await ensureRuntime({
    home,
    manifestPath,
    env: {},
    fetchImpl: async () => new Response('not-valid', { status: 200 }),
  });
  assert.equal(res.ok, false);
  assert.equal(res.code, 'DOWNLOAD_FAILED');
  const leftovers = fs.readdirSync(path.join(home, 'runtime')).filter((n) => n.startsWith('.download-') || n.startsWith('.staging-'));
  assert.deepEqual(leftovers, []);
});
