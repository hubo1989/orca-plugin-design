import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync, execFileSync } from 'node:child_process';

const root = fileURLToPath(new URL('../', import.meta.url));
const rewrites = JSON.parse(fs.readFileSync(path.join(root, 'vendor-rewrites.json'), 'utf8'));

function fixture(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rewrites-test-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  fs.mkdirSync(path.join(dir, 'tools'));
  fs.copyFileSync(path.join(root, 'tools/vendor-baoyu.mjs'), path.join(dir, 'tools/vendor-baoyu.mjs'));
  fs.copyFileSync(path.join(root, 'vendor-rewrites.json'), path.join(dir, 'vendor-rewrites.json'));
  const vendor = path.join(dir, 'vendor/baoyu-design');
  for (const entry of rewrites) {
    const target = path.join(vendor, entry.file);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, '# Upstream skill\n');
  }
  const run = (...args) => {
    const result = spawnSync(process.execPath, [path.join(dir, 'tools/vendor-baoyu.mjs'), ...args], { encoding: 'utf8' });
    assert.ifError(result.error);
    return { status: result.status, report: JSON.parse(result.stdout || result.stderr) };
  };
  return { dir, vendor, run };
}

test('rewrite configuration names five existing skills with their exact managed footer', () => {
  assert.ok(Array.isArray(rewrites));
  assert.equal(rewrites.length, 5);
  assert.equal(new Set(rewrites.map((entry) => entry.file)).size, 5);
  for (const entry of rewrites) {
    assert.match(entry.file, /^skills\/claude-[^/]+\/SKILL\.md$/);
    assert.equal(entry.marker, '<!-- prototype-studio:append -->');
    const target = path.join(root, 'vendor/baoyu-design', entry.file);
    assert.ok(fs.statSync(target).isFile(), entry.file);
    const content = fs.readFileSync(target, 'utf8');
    assert.equal(content.split(entry.marker).length, 2, entry.file);
    assert.ok(content.endsWith(`${entry.marker}\n${entry.text.trim()}\n`), entry.file);
  }
});

test('apply-rewrites appends, replaces an existing footer and stays byte-identical', (t) => {
  const { vendor, run } = fixture(t);
  const target = path.join(vendor, rewrites[0].file);
  fs.appendFileSync(target, `\n${rewrites[0].marker}\nStale plugin note\n`);
  assert.equal(run('apply-rewrites').report.changed.length, 5);
  const content = fs.readFileSync(target, 'utf8');
  assert.ok(content.startsWith('# Upstream skill\n\n'));
  assert.ok(!content.includes('Stale plugin note'));
  const before = rewrites.map((entry) => fs.readFileSync(path.join(vendor, entry.file)));
  const second = run('apply-rewrites');
  assert.equal(second.status, 0);
  assert.deepEqual(second.report.changed, []);
  rewrites.forEach((entry, i) => assert.deepEqual(fs.readFileSync(path.join(vendor, entry.file)), before[i]));
});

test('--check fails for missing markers and stale note text, then passes after applying', (t) => {
  const { vendor, run } = fixture(t);
  const missing = run('--check');
  assert.equal(missing.status, 1);
  assert.deepEqual(missing.report.rewriteDrift, rewrites.map((entry) => entry.file));
  assert.equal(run('apply-rewrites').status, 0);
  assert.equal(run('--check').status, 0);
  fs.appendFileSync(path.join(vendor, rewrites[0].file), 'Unmanaged footer drift\n');
  assert.deepEqual(run('--check').report.rewriteDrift, [rewrites[0].file]);
});

test('snapshot replays rewrites over tracked files and preserves old snapshot on missing target', (t) => {
  const { dir, vendor, run } = fixture(t);
  const source = path.join(dir, 'upstream');
  fs.cpSync(vendor, source, { recursive: true });
  const git = (...args) => execFileSync('git', ['-C', source, ...args], { encoding: 'utf8', stdio: 'pipe' });
  git('init');
  git('add', '.');
  git('-c', 'user.name=Rewrite Test', '-c', 'user.email=rewrites@example.invalid', '-c', 'commit.gpgsign=false', 'commit', '-m', 'fixture');
  fs.writeFileSync(path.join(source, 'untracked.txt'), 'not part of snapshot');
  const result = run('snapshot', source);
  assert.equal(result.status, 0);
  assert.equal(result.report.files, 5);
  assert.ok(!fs.existsSync(path.join(vendor, 'untracked.txt')));
  assert.equal(run('--check').status, 0);
  for (const entry of rewrites) {
    assert.ok(fs.readFileSync(path.join(vendor, entry.file), 'utf8').includes(entry.marker));
  }
  const manifest = fs.readFileSync(path.join(dir, 'vendor/manifest.json'), 'utf8');
  const preserved = fs.readFileSync(path.join(vendor, rewrites[0].file));
  git('rm', rewrites[0].file);
  assert.equal(run('snapshot', source).status, 1);
  assert.deepEqual(fs.readFileSync(path.join(vendor, rewrites[0].file)), preserved);
  assert.equal(fs.readFileSync(path.join(dir, 'vendor/manifest.json'), 'utf8'), manifest);
});

test('invalid rewrite paths fail before any target is changed', (t) => {
  const { dir, vendor, run } = fixture(t);
  const entries = [...rewrites, { ...rewrites[0], file: '../outside/SKILL.md' }];
  fs.writeFileSync(path.join(dir, 'vendor-rewrites.json'), JSON.stringify(entries));
  assert.equal(run('apply-rewrites').status, 1);
  assert.equal(fs.readFileSync(path.join(vendor, rewrites[0].file), 'utf8'), '# Upstream skill\n');
});
