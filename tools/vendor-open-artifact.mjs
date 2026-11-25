#!/usr/bin/env node
// Manage Open Artifact runtime manifest, harness-kit bundling, and custom type checks.
// Usage:
//   node tools/vendor-open-artifact.mjs --check
//   node tools/vendor-open-artifact.mjs manifest [--version 0.14.7]
//   node tools/vendor-open-artifact.mjs bundle-kit [--version 0.14.7]
//   node tools/vendor-open-artifact.mjs check-types
//   node tools/vendor-open-artifact.mjs pack-types [--out /tmp]
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MANIFEST_PATH = path.join(ROOT, 'vendor', 'runtime-manifest.json');
const LICENSE_PATH = path.join(ROOT, 'vendor', 'LICENSE.open-artifact');
const KIT_BUNDLE = path.join(ROOT, 'src', 'vendor', 'harness-kit.mjs');
const EMBED_BUNDLE = path.join(ROOT, 'src', 'vendor', 'harness-embed.mjs');
const TESTING_BUNDLE = path.join(ROOT, 'test', 'vendor', 'harness-testing.mjs');

function writeAtomic(file, content) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  try {
    fs.writeFileSync(tmp, content, 'utf8');
    fs.renameSync(tmp, file);
  } finally {
    fs.rmSync(tmp, { force: true });
  }
}

export function validateManifestObject(m) {
  if (!m || typeof m !== 'object') return 'manifest must be a JSON object';
  if (m.package !== '@open-artifact/cli') return 'manifest.package must be @open-artifact/cli';
  if (typeof m.version !== 'string' || !/^\d+\.\d+\.\d+/.test(m.version)) return 'manifest.version must be semver';
  if (typeof m.integrity !== 'string' || !/^sha512-[A-Za-z0-9+/=]{80,}$/.test(m.integrity)) {
    return 'manifest.integrity must be a valid sha512 SRI string';
  }
  if (!Number.isSafeInteger(m.sizeBytes) || m.sizeBytes <= 0) return 'manifest.sizeBytes must be a positive integer';
  if (!Array.isArray(m.urls) || m.urls.length < 2) return 'manifest.urls must contain primary and mirror URLs';
  for (const u of m.urls) {
    if (typeof u !== 'string' || !/^https:\/\/.+\.tgz$/.test(u)) return `invalid manifest tarball URL: ${String(u)}`;
  }
  return null;
}

export function checkVendorState(rootDir = ROOT) {
  const manifestFile = path.join(rootDir, 'vendor', 'runtime-manifest.json');
  const licenseFile = path.join(rootDir, 'vendor', 'LICENSE.open-artifact');
  const kitFile = path.join(rootDir, 'src', 'vendor', 'harness-kit.mjs');
  const embedFile = path.join(rootDir, 'src', 'vendor', 'harness-embed.mjs');
  const forbidden = [
    path.join(rootDir, 'vendor', 'open-artifact-runtime.tgz'),
    path.join(rootDir, 'vendor', 'baoyu-design'),
    path.join(rootDir, 'vendor', 'manifest.json'),
    path.join(rootDir, 'vendor-rewrites.json'),
    path.join(rootDir, 'tools', 'vendor-baoyu.mjs'),
  ];
  const problems = [];
  for (const f of forbidden) {
    if (fs.existsSync(f)) problems.push(`forbidden legacy asset exists: ${path.relative(rootDir, f)}`);
  }
  if (!fs.existsSync(manifestFile)) {
    problems.push('missing vendor/runtime-manifest.json');
  } else {
    try {
      const m = JSON.parse(fs.readFileSync(manifestFile, 'utf8'));
      const err = validateManifestObject(m);
      if (err) problems.push(err);
    } catch (e) {
      problems.push(`invalid vendor/runtime-manifest.json: ${e.message}`);
    }
  }
  for (const req of [licenseFile, kitFile, embedFile]) {
    if (!fs.existsSync(req) || fs.statSync(req).size === 0) {
      problems.push(`missing or empty required file: ${path.relative(rootDir, req)}`);
    }
  }
  return { ok: problems.length === 0, action: 'check', problems };
}

async function generateManifest(versionInput) {
  let version = versionInput;
  if (!version && fs.existsSync(MANIFEST_PATH)) {
    version = JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8')).version;
  }
  version = version || '0.14.7';
  const res = await fetch(`https://registry.npmjs.org/@open-artifact/cli/${encodeURIComponent(version)}`);
  if (!res.ok) throw new Error(`npm registry returned ${res.status} for @open-artifact/cli@${version}`);
  const meta = await res.json();
  const integrity = meta?.dist?.integrity;
  const tarball = meta?.dist?.tarball;
  if (!integrity || !tarball) throw new Error('npm metadata missing dist.integrity or dist.tarball');

  // Determine exact byte length via HEAD request
  let sizeBytes = 0;
  try {
    const head = await fetch(tarball, { method: 'HEAD' });
    sizeBytes = Number(head.headers.get('content-length')) || 0;
  } catch { /* fallback below */ }
  if (!sizeBytes && fs.existsSync(MANIFEST_PATH)) {
    const prev = JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8'));
    if (prev.version === version && prev.sizeBytes) sizeBytes = prev.sizeBytes;
  }
  if (!sizeBytes) {
    const dl = await fetch(tarball);
    const buf = Buffer.from(await dl.arrayBuffer());
    sizeBytes = buf.length;
  }
  const manifest = {
    package: '@open-artifact/cli',
    version: meta.version || version,
    integrity,
    sizeBytes,
    protocols: meta.openArtifact?.protocols || { min: 1, max: 1 },
    urls: [
      `https://registry.npmjs.org/@open-artifact/cli/-/cli-${meta.version || version}.tgz`,
      `https://registry.npmmirror.com/@open-artifact/cli/-/cli-${meta.version || version}.tgz`,
    ],
  };
  const err = validateManifestObject(manifest);
  if (err) throw new Error(err);
  writeAtomic(MANIFEST_PATH, `${JSON.stringify(manifest, null, 2)}\n`);
  return { ok: true, action: 'manifest', manifest };
}

function bundleKit(versionInput) {
  let version = versionInput;
  if (!version && fs.existsSync(MANIFEST_PATH)) {
    version = JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8')).version;
  }
  version = version || '0.14.7';
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'oa-bundle-kit-'));
  try {
    execFileSync('npm', ['install', '--no-save', `@open-artifact/harness-kit@${version}`, 'esbuild'], {
      cwd: tmp,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const esbuildBin = path.join(tmp, 'node_modules', '.bin', 'esbuild');
    const hkRoot = path.join(tmp, 'node_modules', '@open-artifact', 'harness-kit');
    fs.mkdirSync(path.dirname(KIT_BUNDLE), { recursive: true });
    fs.mkdirSync(path.dirname(TESTING_BUNDLE), { recursive: true });
    execFileSync(esbuildBin, [
      path.join(hkRoot, 'src', 'index.js'),
      '--bundle', '--platform=node', '--format=esm', '--target=node22',
      `--outfile=${KIT_BUNDLE}`,
    ], { cwd: tmp, stdio: 'pipe' });
    execFileSync(esbuildBin, [
      path.join(hkRoot, 'src', 'embed', 'index.js'),
      '--bundle', '--platform=browser', '--format=esm', '--target=es2022',
      `--outfile=${EMBED_BUNDLE}`,
    ], { cwd: tmp, stdio: 'pipe' });
    execFileSync(esbuildBin, [
      path.join(hkRoot, 'src', 'testing.js'),
      '--bundle', '--platform=node', '--format=esm', '--target=node22',
      `--outfile=${TESTING_BUNDLE}`,
    ], { cwd: tmp, stdio: 'pipe' });
    const licenseSrc = path.join(hkRoot, 'LICENSE');
    if (fs.existsSync(licenseSrc) && !fs.existsSync(LICENSE_PATH)) {
      fs.copyFileSync(licenseSrc, LICENSE_PATH);
    }
    return {
      ok: true,
      action: 'bundle-kit',
      version,
      bundles: {
        kitBytes: fs.statSync(KIT_BUNDLE).size,
        embedBytes: fs.statSync(EMBED_BUNDLE).size,
        testingBytes: fs.statSync(TESTING_BUNDLE).size,
      },
    };
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

async function runTypesAction(kind, outDir) {
  const customDir = path.join(ROOT, 'custom-types');
  if (!fs.existsSync(customDir)) {
    return { ok: true, action: kind, skipped: true, reason: 'custom-types directory not present' };
  }
  const { ensureRuntime } = await import('../src/runtime-manager.mjs');
  const rt = await ensureRuntime({ autoDownload: false });
  if (!rt.ok || !rt.entry) {
    return { ok: false, action: kind, error: 'Open Artifact runtime not found on this machine' };
  }
  const dirs = fs.readdirSync(customDir, { withFileTypes: true })
    .filter((e) => e.isDirectory() && !e.name.startsWith('.'))
    .map((e) => path.join(customDir, e.name));
  const results = [];
  for (const dir of dirs) {
    const cmdArgs = kind === 'check-types'
      ? [rt.entry, 'types', 'check', dir, '--for-share']
      : [rt.entry, 'types', 'pack', dir, '--out', outDir || os.tmpdir()];
    execFileSync(process.execPath, cmdArgs, { stdio: 'inherit' });
    results.push(path.basename(dir));
  }
  return { ok: true, action: kind, types: results };
}

function parseFlag(args, name) {
  const idx = args.indexOf(name);
  return idx >= 0 && args[idx + 1] ? args[idx + 1] : null;
}

async function main() {
  const args = process.argv.slice(2);
  const cmd = args[0];
  if (!cmd || cmd === '--check') return checkVendorState();
  if (cmd === 'manifest') return await generateManifest(parseFlag(args, '--version'));
  if (cmd === 'bundle-kit') return bundleKit(parseFlag(args, '--version'));
  if (cmd === 'check-types') return await runTypesAction('check-types');
  if (cmd === 'pack-types') return await runTypesAction('pack-types', parseFlag(args, '--out'));
  throw new Error('Usage: vendor-open-artifact.mjs [--check | manifest [--version X] | bundle-kit [--version X] | check-types | pack-types [--out dir]]');
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().then((report) => {
    console.log(JSON.stringify(report, null, 2));
    process.exitCode = report.ok ? 0 : 1;
  }).catch((err) => {
    console.error(JSON.stringify({ ok: false, action: 'error', error: err.message }, null, 2));
    process.exitCode = 1;
  });
}
