#!/usr/bin/env node
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const run = promisify(execFile);

function isExecutable(file) {
  if (!file) return false;
  try {
    fs.accessSync(file, fs.constants.X_OK);
    return fs.statSync(file).isFile();
  } catch { return false; }
}

function browserPath() {
  if (isExecutable(process.env.BROWSER_PATH)) return process.env.BROWSER_PATH;
  const candidates = [];
  const cache = path.join(os.homedir(), 'Library/Caches/ms-playwright');
  if (fs.existsSync(cache)) {
    const builds = fs.readdirSync(cache, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && /^chromium-\d+$/.test(entry.name)).map((entry) => entry.name)
      .sort((a, b) => b.localeCompare(a, undefined, { numeric: true }));
    for (const build of builds) {
      const dir = path.join(cache, build);
      for (const arch of fs.readdirSync(dir, { withFileTypes: true })
        .filter((entry) => entry.isDirectory() && entry.name.startsWith('chrome-mac')).map((entry) => entry.name)) {
        candidates.push(path.join(dir, arch, 'Chromium.app/Contents/MacOS/Chromium'));
      }
    }
  }
  candidates.push('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome');
  for (const candidate of candidates) if (isExecutable(candidate)) return candidate;
  throw new Error('No Chromium browser found (set BROWSER_PATH)');
}

async function main() {
  const [url, output, ...args] = process.argv.slice(2);
  if (!url || !output || args.length % 2) throw new Error('Usage: node tools/thumb.mjs <url> <out.png> [--w 1280] [--h 800] [--wait-ms 1200]');
  if (!['http:', 'https:', 'file:'].includes(new URL(url).protocol)) throw new Error('Unsupported URL protocol');
  const options = { '--w': 1280, '--h': 800, '--wait-ms': 1200 };
  for (let i = 0; i < args.length; i += 2) {
    const value = Number(args[i + 1]);
    if (!Object.hasOwn(options, args[i]) || !Number.isSafeInteger(value) || value < (args[i] === '--wait-ms' ? 0 : 1)) {
      throw new Error(`Invalid option: ${args[i]}`);
    }
    options[args[i]] = value;
  }
  const browser = browserPath();
  const destination = path.resolve(output);
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'orca-thumb-'));
  try {
    const screenshot = path.join(temp, 'screen.png');
    await run(browser, [
      '--headless', '--disable-gpu', '--hide-scrollbars', '--no-first-run', '--no-default-browser-check',
      `--user-data-dir=${path.join(temp, 'profile')}`,
      `--window-size=${options['--w']},${options['--h']}`,
      `--virtual-time-budget=${options['--wait-ms']}`, `--screenshot=${screenshot}`, url,
    ], { timeout: 25000, maxBuffer: 1024 * 1024 }).catch((err) => {
      const detail = err.stderr?.trim().split(/\r?\n/).find((line) => /FATAL|ERROR/.test(line)) || '';
      throw new Error(`Browser failed (${err.signal || err.code || 'unknown'})${detail ? `: ${detail}` : ''}`);
    });
    const png = fs.readFileSync(screenshot);
    if (!png.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex'))) throw new Error('Browser did not produce a PNG');
    fs.writeFileSync(destination, png);
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
}

main().catch((err) => {
  console.error(`thumb: ${String(err.message).split(/\r?\n/)[0]}`);
  process.exitCode = 1;
});
