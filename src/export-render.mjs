// SPDX-License-Identifier: MIT
// Offline headless Chromium CDP raster/PDF/ZIP exporter & standalone HTML renderer for Orca-Design custom types.

import { spawn } from 'node:child_process';
import { closeSync, existsSync as fsExistsSync, mkdtempSync, openSync, readdirSync as fsReaddirSync, readFileSync, rmSync } from 'node:fs';
import { createServer } from 'node:http';
import { homedir, tmpdir } from 'node:os';
import { dirname, extname, join, resolve, sep, win32 } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateRawSync } from 'node:zlib';

const MODULE_DIR = dirname(fileURLToPath(import.meta.url));

export const CARD_PRESETS = Object.freeze({
  'xhs-3-4': { width: 1080, height: 1440 },
  'wechat-21-9': { width: 900, height: 383 },
  'square-1-1': { width: 1080, height: 1080 },
});

export const MAX_LONG_PNG_HEIGHT = 16384;
export const SUPPORTED_EXPORT_FORMATS = Object.freeze([
  'png',
  'cards-png',
  'cards-zip',
  'zip',
  'long-png',
  'pdf',
  'html',
]);

const DEFAULT_READY =
  "document.readyState === 'complete' && !!document.body && (document.body.innerText.trim().length > 0 || document.querySelector('img,canvas,svg,iframe,video') !== null)";

const sleep = (ms) => new Promise((done) => setTimeout(done, ms));

export function windowsChromeCandidates(env = process.env) {
  const roots = [
    env.ProgramW6432,
    env.ProgramFiles,
    env['ProgramFiles(x86)'],
    'C:\\Program Files',
    'C:\\Program Files (x86)',
    env.LOCALAPPDATA,
  ].filter(Boolean);
  const browsers = [
    ['Google\\Chrome\\Application', 'chrome.exe'],
    ['Microsoft\\Edge\\Application', 'msedge.exe'],
    ['BraveSoftware\\Brave-Browser\\Application', 'brave.exe'],
  ];
  const seen = new Set();
  const out = [];
  for (const [folder, bin] of browsers) {
    for (const root of roots) {
      const p = win32.join(root, folder, bin);
      const key = p.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(p);
    }
  }
  return out;
}

export function systemChromeCandidates(env = process.env, platform = process.platform) {
  if (platform === 'win32') return windowsChromeCandidates(env);
  if (platform === 'darwin') {
    return [
      '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
      '/Applications/Chromium.app/Contents/MacOS/Chromium',
      '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
      '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser',
    ];
  }
  return [
    '/usr/bin/google-chrome',
    '/usr/bin/google-chrome-stable',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
    '/usr/bin/microsoft-edge',
    '/usr/bin/brave-browser',
  ];
}

export function playwrightCacheRoots(env = process.env, platform = process.platform, home = homedir()) {
  const roots = [];
  if (env.PLAYWRIGHT_BROWSERS_PATH && env.PLAYWRIGHT_BROWSERS_PATH !== '0') {
    roots.push(env.PLAYWRIGHT_BROWSERS_PATH);
  }
  if (platform === 'darwin') {
    roots.push(join(home, 'Library', 'Caches', 'ms-playwright'));
  } else if (platform === 'win32') {
    if (env.LOCALAPPDATA) roots.push(win32.join(env.LOCALAPPDATA, 'ms-playwright'));
  } else {
    roots.push(join(env.XDG_CACHE_HOME || join(home, '.cache'), 'ms-playwright'));
  }
  return roots;
}

export function findPlaywrightChromium({
  env = process.env,
  platform = process.platform,
  homeDir = homedir(),
  existsSync = fsExistsSync,
  readdirSync = fsReaddirSync,
} = {}) {
  const pathJoin = platform === 'win32' ? win32.join : join;
  for (const root of playwrightCacheRoots(env, platform, homeDir)) {
    if (!existsSync(root)) continue;
    let entries = [];
    try {
      entries = readdirSync(root).filter((name) => /^chromium(?:_headless_shell)?-/.test(name));
    } catch {
      continue;
    }
    // Prefer higher revision numbers and full chromium over headless shell
    entries.sort((a, b) => {
      const aShell = a.startsWith('chromium_headless_shell-') ? 1 : 0;
      const bShell = b.startsWith('chromium_headless_shell-') ? 1 : 0;
      if (aShell !== bShell) return aShell - bShell;
      const aRev = parseInt(a.split('-').pop() || '0', 10) || 0;
      const bRev = parseInt(b.split('-').pop() || '0', 10) || 0;
      return bRev - aRev;
    });
    for (const dirName of entries) {
      const base = pathJoin(root, dirName);
      const candidates = platform === 'darwin'
        ? [
            pathJoin(base, 'chrome-mac', 'Chromium.app', 'Contents', 'MacOS', 'Chromium'),
            pathJoin(base, 'chrome-mac-arm64', 'Google Chrome for Testing.app', 'Contents', 'MacOS', 'Google Chrome for Testing'),
            pathJoin(base, 'chrome-mac-x64', 'Google Chrome for Testing.app', 'Contents', 'MacOS', 'Google Chrome for Testing'),
            pathJoin(base, 'chrome-headless-shell-mac-arm64', 'chrome-headless-shell'),
            pathJoin(base, 'chrome-headless-shell-mac-x64', 'chrome-headless-shell'),
          ]
        : platform === 'win32'
          ? [
              pathJoin(base, 'chrome-win', 'chrome.exe'),
              pathJoin(base, 'chrome-win64', 'chrome.exe'),
              pathJoin(base, 'chrome-headless-shell-win64', 'chrome-headless-shell.exe'),
            ]
          : [
              pathJoin(base, 'chrome-linux', 'chrome'),
              pathJoin(base, 'chrome-linux64', 'chrome'),
              pathJoin(base, 'chrome-headless-shell-linux64', 'chrome-headless-shell'),
            ];
      const hit = candidates.find((c) => existsSync(c));
      if (hit) return hit;
    }
  }
  return null;
}

/**
 * Locate Chromium-based browser binary in priority order:
 * 1. $OPEN_ARTIFACT_CHROME (if set, must exist; returns null if missing)
 * 2. System Chrome / Chromium / Edge / Brave
 * 3. Playwright Chromium cache
 */
export function findChrome({
  env = process.env,
  platform = process.platform,
  homeDir = homedir(),
  existsSync = fsExistsSync,
  readdirSync = fsReaddirSync,
} = {}) {
  const given = typeof env.OPEN_ARTIFACT_CHROME === 'string' ? env.OPEN_ARTIFACT_CHROME.trim() : '';
  if (given) return existsSync(given) ? given : null;

  for (const candidate of systemChromeCandidates(env, platform)) {
    if (existsSync(candidate)) return candidate;
  }

  return findPlaywrightChromium({ env, platform, homeDir, existsSync, readdirSync });
}

export function browserMissingResult() {
  return {
    ok: false,
    code: 'browser_missing',
    error: '未在本机检测到可用的 Chromium 内核浏览器（Chrome / Edge / Brave / Playwright Chromium）。',
    hint: '请安装 Google Chrome / Microsoft Edge / Brave，或运行 `npx playwright install chromium`，或设置环境变量 OPEN_ARTIFACT_CHROME 指向浏览器可执行路径。',
    fallback: '对于长页排版（long-page）作品，可使用编辑器内置的「导出单文件 HTML」或浏览器原生「打印 → 存为 PDF」兜底。',
  };
}

function isAllowedTargetUrl(rawUrl) {
  try {
    const parsed = new URL(rawUrl);
    if (parsed.protocol === 'file:') return true;
    if (parsed.protocol !== 'http:') return false;
    const host = parsed.hostname.toLowerCase();
    return host === '127.0.0.1' || host === 'localhost' || host === '::1' || host === '[::1]';
  } catch {
    return false;
  }
}

export function validateExportRequest(req) {
  if (!req || typeof req !== 'object' || Array.isArray(req)) {
    return { ok: false, code: 'invalid_argument', error: 'Export request must be a JSON object.' };
  }
  const format = String(req.format || '').trim();
  if (!SUPPORTED_EXPORT_FORMATS.includes(format)) {
    return {
      ok: false,
      code: 'invalid_argument',
      error: `Unsupported export format ${JSON.stringify(req.format ?? '')}. Expected one of: ${SUPPORTED_EXPORT_FORMATS.join(', ')}.`,
    };
  }
  if (format === 'html') {
    if (!req.content && !req.html && !req.url) {
      return { ok: false, code: 'invalid_argument', error: 'HTML export requires content, html, or url.' };
    }
    return { ok: true, format };
  }
  if (!req.url && !req.html && !req.typeDir) {
    return { ok: false, code: 'invalid_argument', error: 'Export request requires url, html, or typeDir.' };
  }
  if (req.url && !isAllowedTargetUrl(req.url)) {
    return {
      ok: false,
      code: 'invalid_argument',
      error: 'Only loopback http://127.0.0.1 / http://localhost or file:// URLs are permitted for offline export.',
    };
  }
  if (req.scheme !== undefined && req.scheme !== 'light' && req.scheme !== 'dark') {
    return { ok: false, code: 'invalid_argument', error: 'scheme must be "light" or "dark".' };
  }
  const preset = req.preset && CARD_PRESETS[req.preset] ? CARD_PRESETS[req.preset] : null;
  const width = req.width ?? preset?.width ?? (format === 'long-png' ? 375 : 1080);
  const height = req.height ?? preset?.height ?? (format === 'long-png' ? 900 : 1440);
  if (!Number.isInteger(width) || width < 320 || width > 3840) {
    return { ok: false, code: 'invalid_argument', error: 'width must be an integer between 320 and 3840.' };
  }
  if (!Number.isInteger(height) || height < 200 || height > MAX_LONG_PNG_HEIGHT) {
    return { ok: false, code: 'invalid_argument', error: `height must be an integer between 200 and ${MAX_LONG_PNG_HEIGHT}.` };
  }
  const deviceScaleFactor = req.deviceScaleFactor ?? 2;
  if (typeof deviceScaleFactor !== 'number' || !Number.isFinite(deviceScaleFactor) || deviceScaleFactor < 1 || deviceScaleFactor > 3) {
    return { ok: false, code: 'invalid_argument', error: 'deviceScaleFactor must be between 1 and 3.' };
  }
  return {
    ok: true,
    format,
    width,
    height,
    deviceScaleFactor,
    scheme: req.scheme || 'light',
  };
}

// ---- Pure-Node PKZIP Builder (CRC-32 + Deflate) ----

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let j = 0; j < 8; j++) {
      c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
    }
    table[i] = c >>> 0;
  }
  return table;
})();

export function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

export function buildZip(entries) {
  const localParts = [];
  const centralParts = [];
  let offset = 0;

  for (const entry of entries) {
    const nameBuf = Buffer.from(String(entry.name), 'utf8');
    const raw = Buffer.isBuffer(entry.data) ? entry.data : Buffer.from(entry.data);
    const compressed = deflateRawSync(raw);
    const crc = crc32(raw);

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4); // version needed
    local.writeUInt16LE(0x0800, 6); // UTF-8 filename flag
    local.writeUInt16LE(8, 8); // deflate
    local.writeUInt16LE(0, 10);
    local.writeUInt16LE(0, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(compressed.length, 18);
    local.writeUInt32LE(raw.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    local.writeUInt16LE(0, 28);
    localParts.push(local, nameBuf, compressed);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(8, 10);
    central.writeUInt16LE(0, 12);
    central.writeUInt16LE(0, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(compressed.length, 20);
    central.writeUInt32LE(raw.length, 24);
    central.writeUInt16LE(nameBuf.length, 28);
    central.writeUInt16LE(0, 30);
    central.writeUInt16LE(0, 32);
    central.writeUInt16LE(0, 34);
    central.writeUInt16LE(0, 36);
    central.writeUInt32LE(0, 38);
    central.writeUInt32LE(offset, 42);
    centralParts.push(central, nameBuf);

    offset += local.length + nameBuf.length + compressed.length;
  }

  const centralBuf = Buffer.concat(centralParts);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(centralBuf.length, 12);
  eocd.writeUInt32LE(offset, 16);
  eocd.writeUInt16LE(0, 20);

  return Buffer.concat([...localParts, centralBuf, eocd]);
}

// ---- Standalone Single-File HTML Renderer (zero-browser offline fallback) ----

function escHtml(text) {
  return String(text ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function renderLongPageBlockHtml(block) {
  if (!block || typeof block !== 'object') return '';
  switch (block.type) {
    case 'subheading':
      return `<h3>${escHtml(block.text)}</h3>`;
    case 'callout':
      return `<div class="lp-callout" data-tone="${escHtml(block.tone || 'info')}">${
        block.title ? `<div class="lp-callout-title">${escHtml(block.title)}</div>` : ''
      }<p>${escHtml(block.text)}</p></div>`;
    case 'quote':
      return `<blockquote><p>${escHtml(block.text)}</p>${
        block.cite ? `<footer>—— ${escHtml(block.cite)}</footer>` : ''
      }</blockquote>`;
    case 'list': {
      const tag = block.ordered ? 'ol' : 'ul';
      const items = (block.items || []).map((it) => `<li>${escHtml(it)}</li>`).join('');
      return `<${tag}>${items}</${tag}>`;
    }
    case 'table': {
      const thead = Array.isArray(block.headers) && block.headers.length
        ? `<thead><tr>${block.headers.map((h) => `<th>${escHtml(h)}</th>`).join('')}</tr></thead>`
        : '';
      const tbody = `<tbody>${(block.rows || []).map((r) => `<tr>${(r || []).map((c) => `<td>${escHtml(c)}</td>`).join('')}</tr>`).join('')}</tbody>`;
      return `<div class="lp-table-wrap"><table>${thead}${tbody}</table></div>`;
    }
    case 'code':
      return `<div class="lp-code-wrap"><pre><code>${escHtml(block.code)}</code></pre></div>`;
    default:
      return `<p>${escHtml(block.text)}</p>`;
  }
}

export function renderLongPageStandaloneHtml(content, opts = {}) {
  const data = content && typeof content === 'object' ? content : {};
  const lang = data.lang || 'zh-Hans';
  const theme = opts.scheme || data.theme || 'light';
  const resolvedTheme = theme === 'dark' ? 'dark' : 'light';
  const brandColor = /^#(?:[\da-f]{3}|[\da-f]{6})$/i.test(String(data.brandColor || '')) ? data.brandColor : '#2563EB';
  const cssPath = resolve(MODULE_DIR, '../custom-types/long-page/artifact-type/style.css');
  const css = fsExistsSync(cssPath)
    ? readFileSync(cssPath, 'utf8')
    : 'body{font-family:"PingFang SC","Noto Sans CJK SC",sans-serif;line-height:1.7;margin:0;padding:24px;}';

  const summaryHtml = data.summaryCard && Array.isArray(data.summaryCard.bullets) && data.summaryCard.bullets.length
    ? `<section class="lp-summary-card"><div class="lp-callout-title">${escHtml(data.summaryCard.heading || '核心结论')}</div><ul>${data.summaryCard.bullets.map((b) => `<li>${escHtml(b)}</li>`).join('')}</ul></section>`
    : '';

  const sectionsHtml = (data.sections || []).map((sec, idx) => {
    const id = sec.id || `sec-${idx + 1}`;
    const heading = sec.heading ? `<h2>${escHtml(sec.heading)}</h2>` : '';
    const blocks = (sec.blocks || []).map(renderLongPageBlockHtml).join('\n');
    return `<section id="${escHtml(id)}">${heading}\n${blocks}</section>`;
  }).join('\n');

  const metaParts = [];
  if (data.author) metaParts.push(`<span>作者：${escHtml(data.author)}</span>`);
  if (data.date) metaParts.push(`<span>${escHtml(data.date)}</span>`);
  metaParts.push(`<span>${data.mode === 'digest' ? '模式：提炼解读' : '模式：忠实精排'}</span>`);

  return `<!doctype html>
<html lang="${escHtml(lang)}">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${escHtml(data.title || '长页排版')}</title>
<style>${css}
body{padding:24px 12px;}
.lp-viewport-frame{max-width:780px;margin:0 auto;}
</style>
</head>
<body>
<div class="lp-shell" data-resolved-theme="${resolvedTheme}" style="--lp-brand:${escHtml(brandColor)}">
  <div class="lp-viewport-frame">
    <article class="lp-article" lang="${escHtml(lang)}">
      <h1>${escHtml(data.title || '未命名长页文章')}</h1>
      ${data.subtitle ? `<p class="lp-subtitle">${escHtml(data.subtitle)}</p>` : ''}
      <div class="lp-meta">${metaParts.join('')}</div>
      ${summaryHtml}
      ${sectionsHtml}
    </article>
  </div>
</div>
</body>
</html>
`;
}

// ---- Ephemeral Static Server for Local Type + Artifact Rendering ----

const MIME_MAP = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
};

async function startTempServer({ html, typeDir, artifactDir }) {
  const server = createServer((req, res) => {
    const reqUrl = new URL(req.url || '/', 'http://127.0.0.1');
    const relPath = decodeURIComponent(reqUrl.pathname).replace(/^\/+/, '') || 'index.html';
    if (relPath.split('/').some((seg) => seg === '..')) {
      res.writeHead(403).end('Forbidden');
      return;
    }
    if (html && relPath === 'index.html') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(html);
      return;
    }
    const candidates = [];
    if (artifactDir && (relPath === 'content.json' || relPath.startsWith('_blobs/'))) {
      candidates.push(resolve(artifactDir, relPath));
    }
    if (typeDir) {
      candidates.push(resolve(typeDir, relPath));
    }
    if (artifactDir) {
      candidates.push(resolve(artifactDir, relPath));
    }
    for (const file of candidates) {
      const base = file.startsWith(resolve(typeDir || '\0') + sep) || file.startsWith(resolve(artifactDir || '\0') + sep);
      if (base && fsExistsSync(file)) {
        const mime = MIME_MAP[extname(file).toLowerCase()] || 'application/octet-stream';
        res.writeHead(200, { 'Content-Type': mime });
        res.end(readFileSync(file));
        return;
      }
    }
    res.writeHead(404).end('Not found');
  });

  await new Promise((resolveListen) => server.listen(0, '127.0.0.1', resolveListen));
  const addr = server.address();
  return {
    url: `http://127.0.0.1:${addr.port}/index.html`,
    close: () => new Promise((done) => server.close(() => done())),
  };
}

// ---- CDP WebSocket Client ----

async function connectCdpSocket(wsUrl) {
  const socket = new WebSocket(wsUrl);
  await new Promise((resolveOpen, rejectOpen) => {
    socket.addEventListener('open', () => resolveOpen(), { once: true });
    socket.addEventListener('error', () => rejectOpen(new Error('Could not connect to Chromium CDP WebSocket')), { once: true });
  });

  let nextId = 1;
  const pending = new Map();
  const listeners = new Set();

  socket.addEventListener('message', (event) => {
    const msg = JSON.parse(String(event.data));
    if (msg.id !== undefined) {
      const waiter = pending.get(msg.id);
      pending.delete(msg.id);
      if (!waiter) return;
      if (msg.error) waiter.reject(new Error(`${waiter.method}: ${msg.error.message}`));
      else waiter.resolve(msg.result ?? {});
    } else {
      for (const fn of listeners) fn(msg);
    }
  });

  return {
    send(method, params = {}, sessionId) {
      return new Promise((resolveSend, rejectSend) => {
        const id = nextId++;
        pending.set(id, { resolve: resolveSend, reject: rejectSend, method });
        socket.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
      });
    },
    onEvent(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    close() {
      try {
        socket.close();
      } catch {
        // ignore close error
      }
    },
  };
}

async function launchChromeCdp(chromePath, width, height) {
  const profile = mkdtempSync(join(tmpdir(), 'orca-export-render-'));
  const stderrLog = join(profile, 'chrome-stderr.log');
  const fd = openSync(stderrLog, 'a');
  const child = spawn(
    chromePath,
    [
      '--headless=new',
      '--remote-debugging-port=0',
      `--user-data-dir=${profile}`,
      ...(process.platform === 'darwin' ? ['--use-mock-keychain'] : []),
      `--window-size=${width},${height}`,
      '--hide-scrollbars',
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-extensions',
      '--disable-background-networking',
      '--disable-sync',
      '--disable-component-update',
      '--mute-audio',
      'about:blank',
    ],
    { stdio: ['ignore', 'ignore', fd] },
  );
  closeSync(fd);

  try {
    const wsUrl = await new Promise((resolveUrl, rejectUrl) => {
      const started = Date.now();
      const timer = setInterval(() => {
        let log = '';
        try {
          log = readFileSync(stderrLog, 'utf8');
        } catch {
          // wait for stderr flush
        }
        const match = /DevTools listening on (ws:\/\/\S+)/.exec(log);
        if (match) {
          clearInterval(timer);
          resolveUrl(match[1]);
        } else if (child.exitCode !== null || Date.now() - started > 20_000) {
          clearInterval(timer);
          rejectUrl(new Error(`Chromium failed to start: ${log.slice(-300)}`));
        }
      }, 50);
    });
    const client = await connectCdpSocket(wsUrl);
    return {
      client,
      dispose() {
        client.close();
        try { child.kill('SIGKILL'); } catch {}
        rmSync(profile, { recursive: true, force: true, maxRetries: 3 });
      },
    };
  } catch (err) {
    try { child.kill('SIGKILL'); } catch {}
    rmSync(profile, { recursive: true, force: true, maxRetries: 3 });
    throw err;
  }
}

async function navigateAndWait(client, sessionId, url, readyExpr, settleMs) {
  const loaded = new Promise((done) => {
    const off = client.onEvent((msg) => {
      if (msg.sessionId === sessionId && msg.method === 'Page.loadEventFired') {
        off();
        done();
      }
    });
  });
  const nav = await client.send('Page.navigate', { url }, sessionId);
  if (nav && nav.errorText) {
    throw new Error(`Navigation failed: ${nav.errorText}`);
  }
  let navTimer;
  await Promise.race([
    loaded,
    new Promise((done) => {
      navTimer = setTimeout(done, 15_000);
    }),
  ]);
  clearTimeout(navTimer);

  const until = Date.now() + 10_000;
  while (Date.now() < until) {
    const evalRes = await client
      .send('Runtime.evaluate', { expression: `!!(${readyExpr})`, returnByValue: true }, sessionId)
      .catch(() => null);
    if (evalRes?.result?.value === true) break;
    await sleep(100);
  }
  if (settleMs > 0) await sleep(settleMs);
}

/**
 * Execute offline export via headless Chromium CDP (or standalone HTML without browser).
 * `deps` allows injecting `{ findChrome, connectCdp }` for pure-Node mock CDP unit testing.
 */
export async function exportRender(request, deps = {}) {
  const validated = validateExportRequest(request);
  if (!validated.ok) return validated;

  const { format, width, height, deviceScaleFactor, scheme } = validated;

  if (format === 'html') {
    const html = request.html || renderLongPageStandaloneHtml(request.content, { scheme });
    return {
      ok: true,
      format: 'html',
      mimeType: 'text/html; charset=utf-8',
      buffer: Buffer.from(html, 'utf8'),
    };
  }

  const locateChrome = deps.findChrome || findChrome;
  let cdpHandle = null;
  let tempServer = null;

  try {
    if (typeof deps.connectCdp === 'function') {
      const client = await deps.connectCdp();
      cdpHandle = { client, dispose: () => client.close?.() };
    } else {
      const chromePath = locateChrome();
      if (!chromePath) return browserMissingResult();
      cdpHandle = await launchChromeCdp(chromePath, width, height);
    }

    const { client } = cdpHandle;
    let targetUrl = request.url;
    if (!targetUrl) {
      tempServer = await startTempServer({
        html: request.html,
        typeDir: request.typeDir,
        artifactDir: request.artifactDir,
      });
      const urlObj = new URL(tempServer.url);
      urlObj.searchParams.set('export', '1');
      if (request.preset) urlObj.searchParams.set('format', request.preset);
      if (scheme) urlObj.searchParams.set('theme', scheme);
      targetUrl = urlObj.toString();
    }

    const { targetId } = await client.send('Target.createTarget', { url: 'about:blank' });
    const { sessionId } = await client.send('Target.attachToTarget', { targetId, flatten: true });

    await client.send('Page.enable', {}, sessionId);
    await client.send('Browser.setDownloadBehavior', { behavior: 'deny' }).catch(() => undefined);
    await client.send(
      'Emulation.setEmulatedMedia',
      {
        media: format === 'pdf' ? 'print' : 'screen',
        features: [{ name: 'prefers-color-scheme', value: scheme }],
      },
      sessionId,
    );

    const readyExpr = request.ready || DEFAULT_READY;
    const settleMs = request.settleMs ?? 300;

    if (format === 'pdf') {
      await client.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false }, sessionId);
      await navigateAndWait(client, sessionId, targetUrl, readyExpr, settleMs);
      const pdfRes = await client.send(
        'Page.printToPDF',
        {
          printBackground: true,
          preferCSSPageSize: true,
          marginTop: 0.4,
          marginBottom: 0.4,
          marginLeft: 0.4,
          marginRight: 0.4,
        },
        sessionId,
      );
      return {
        ok: true,
        format: 'pdf',
        mimeType: 'application/pdf',
        buffer: Buffer.from(pdfRes.data, 'base64'),
      };
    }

    if (format === 'long-png') {
      await client.send(
        'Emulation.setDeviceMetricsOverride',
        { width, height, deviceScaleFactor, mobile: width <= 480 },
        sessionId,
      );
      await navigateAndWait(client, sessionId, targetUrl, readyExpr, settleMs);
      const heightEval = await client.send(
        'Runtime.evaluate',
        {
          expression: 'Math.max(document.documentElement.scrollHeight || 0, document.body ? document.body.scrollHeight : 0)',
          returnByValue: true,
        },
        sessionId,
      );
      const fullHeight = Math.max(height, Number(heightEval?.result?.value) || height);
      if (fullHeight <= MAX_LONG_PNG_HEIGHT) {
        await client.send(
          'Emulation.setDeviceMetricsOverride',
          { width, height: fullHeight, deviceScaleFactor, mobile: width <= 480 },
          sessionId,
        );
        const shot = await client.send(
          'Page.captureScreenshot',
          {
            format: 'png',
            captureBeyondViewport: true,
            clip: { x: 0, y: 0, width, height: fullHeight, scale: 1 },
          },
          sessionId,
        );
        return {
          ok: true,
          format: 'png',
          mimeType: 'image/png',
          width,
          height: fullHeight,
          deviceScaleFactor,
          buffer: Buffer.from(shot.data, 'base64'),
        };
      }
      // Slice pages above 16384px into ZIP
      const slices = [];
      for (let y = 0, idx = 1; y < fullHeight; y += MAX_LONG_PNG_HEIGHT, idx++) {
        const sliceHeight = Math.min(MAX_LONG_PNG_HEIGHT, fullHeight - y);
        const shot = await client.send(
          'Page.captureScreenshot',
          {
            format: 'png',
            captureBeyondViewport: true,
            clip: { x: 0, y, width, height: sliceHeight, scale: 1 },
          },
          sessionId,
        );
        slices.push({ name: `page-${String(idx).padStart(2, '0')}.png`, data: Buffer.from(shot.data, 'base64') });
      }
      return {
        ok: true,
        format: 'zip',
        sliced: true,
        sliceCount: slices.length,
        mimeType: 'application/zip',
        width,
        height: fullHeight,
        deviceScaleFactor,
        files: slices.map((s) => ({ name: s.name, bytes: s.data.length })),
        buffer: buildZip(slices),
      };
    }

    // png / cards-png / cards-zip / zip
    const cards = Array.isArray(request.cards) && request.cards.length
      ? request.cards
      : [{ index: request.cardIndex ?? 0, width, height, filename: 'card-01.png' }];

    await client.send(
      'Emulation.setDeviceMetricsOverride',
      { width: cards[0].width || width, height: cards[0].height || height, deviceScaleFactor, mobile: false },
      sessionId,
    );
    await navigateAndWait(client, sessionId, targetUrl, readyExpr, settleMs);

    const images = [];
    for (let i = 0; i < cards.length; i++) {
      const card = cards[i];
      const cw = card.width || width;
      const ch = card.height || height;
      await client.send(
        'Emulation.setDeviceMetricsOverride',
        { width: cw, height: ch, deviceScaleFactor, mobile: false },
        sessionId,
      );
      if (typeof card.index === 'number') {
        const presetArg = request.preset ? JSON.stringify(request.preset) : 'null';
        await client.send(
          'Runtime.evaluate',
          {
            expression: `window.__ORCA_EXPORT__ && window.__ORCA_EXPORT__.setCard && window.__ORCA_EXPORT__.setCard(${card.index}, ${presetArg})`,
            returnByValue: true,
          },
          sessionId,
        ).catch(() => undefined);
      }
      const shot = await client.send(
        'Page.captureScreenshot',
        { format: 'png' },
        sessionId,
      );
      images.push({
        name: card.filename || `card-${String(i + 1).padStart(2, '0')}.png`,
        data: Buffer.from(shot.data, 'base64'),
      });
    }

    if (images.length === 1 && (format === 'png' || format === 'cards-png')) {
      return {
        ok: true,
        format: 'png',
        mimeType: 'image/png',
        width: cards[0].width || width,
        height: cards[0].height || height,
        deviceScaleFactor,
        files: [{ name: images[0].name, bytes: images[0].data.length }],
        buffer: images[0].data,
      };
    }

    return {
      ok: true,
      format: 'zip',
      mimeType: 'application/zip',
      deviceScaleFactor,
      files: images.map((img) => ({ name: img.name, bytes: img.data.length })),
      buffer: buildZip(images),
    };
  } catch (err) {
    return {
      ok: false,
      code: 'export_failed',
      error: err instanceof Error ? err.message : String(err),
    };
  } finally {
    try { cdpHandle?.dispose(); } catch {}
    if (tempServer) await tempServer.close().catch(() => {});
  }
}
