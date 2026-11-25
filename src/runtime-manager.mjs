// Open Artifact Runtime Manager (Plan B split distribution)
// 3-layer discovery:
//   1. Env override ($ORCA_DESIGN_OA_RUNTIME / $OPEN_ARTIFACT_RUNTIME_DIR) + local shared runtime reuse (0 download)
//   2. Offline .tgz import (file path or uploaded buffer, strict SHA-512 + atomic extract)
//   3. On-demand background download (single-flight + cross-process lock, proxy env, SHA-512, mirror fallback, pure-JS tar)
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import https from 'node:https';
import path from 'node:path';
import tls from 'node:tls';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';
import {
  RUNTIME_ENTRY,
  compareVersions,
  openArtifactHome,
  rangesMeet,
  readRuntimePin,
  readRuntimesFile,
  runtimeCandidates,
  runtimeInfo,
  runtimesFileOf,
  selectRuntime,
  sharedRuntimesOf,
} from './vendor/harness-kit.mjs';

const PLUGIN_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DEFAULT_MANIFEST_PATH = path.join(PLUGIN_ROOT, 'vendor', 'runtime-manifest.json');
const MAX_TARBALL_BYTES = 128 * 1024 * 1024;
const MAX_UNPACKED_BYTES = 256 * 1024 * 1024;
const LOCK_STALE_MS = 5 * 60 * 1000;

const inFlight = new Map();
const statusByHome = new Map();
const listeners = new Set();

export function readRuntimeManifest(manifestPath = DEFAULT_MANIFEST_PATH) {
  const raw = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  return {
    package: raw.package || '@open-artifact/cli',
    version: String(raw.version || '0.14.7'),
    integrity: String(raw.integrity || ''),
    sizeBytes: Number(raw.sizeBytes || 0),
    protocols: raw.protocols || { min: 1, max: 1 },
    urls: Array.isArray(raw.urls) ? raw.urls.filter((u) => typeof u === 'string' && u) : [],
  };
}

function defaultStatus(manifest) {
  return {
    state: 'idle',
    version: manifest.version,
    bytesReceived: 0,
    totalBytes: manifest.sizeBytes || 0,
    source: '',
    error: null,
    runtimeDir: '',
    entry: '',
    reused: false,
    updatedAt: new Date().toISOString(),
  };
}

function setStatus(home, manifest, patch) {
  const prev = statusByHome.get(home) || defaultStatus(manifest);
  const next = {
    ...prev,
    ...patch,
    updatedAt: new Date().toISOString(),
  };
  statusByHome.set(home, next);
  for (const fn of listeners) {
    try {
      fn({ home, ...next });
    } catch { /* ignore subscriber errors */ }
  }
  return next;
}

export function getRuntimeStatus(options = {}) {
  const home = openArtifactHome(options.home);
  const manifest = readRuntimeManifest(options.manifestPath);
  const existing = statusByHome.get(home);
  const local = discoverLocalRuntime({ home, manifest, env: options.env });
  if (local) {
    return {
      ...(existing || defaultStatus(manifest)),
      state: 'ready',
      version: local.version || manifest.version,
      runtimeDir: local.dir,
      entry: local.entry,
      source: local.source,
      reused: local.source !== 'downloaded',
      error: null,
    };
  }
  return existing || defaultStatus(manifest);
}

export function onRuntimeProgress(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function discoverLocalRuntime(options = {}) {
  const env = options.env || process.env;
  const manifest = options.manifest || readRuntimeManifest(options.manifestPath);
  const home = openArtifactHome(options.home);

  // Layer 1A: explicit environment variable overrides
  for (const key of ['ORCA_DESIGN_OA_RUNTIME', 'OPEN_ARTIFACT_RUNTIME_DIR']) {
    const val = env[key]?.trim();
    if (!val) continue;
    let resolved;
    try { resolved = fs.realpathSync(val); } catch { resolved = path.resolve(val); }
    const info = runtimeInfo(resolved);
    if (info && fs.existsSync(info.bin)) {
      return {
        source: 'env',
        dir: resolved,
        entry: info.bin,
        version: info.version || manifest.version,
        protocols: info.protocols || manifest.protocols,
      };
    }
  }

  // Layer 1B: scan ~/.agents/open-artifact/runtime/ and runtimes.json via harness-kit
  const candidates = runtimeCandidates(home);
  const compatible = candidates.filter((c) => {
    if (!c.version || compareVersions(c.version, manifest.version) < 0) return false;
    return rangesMeet(c.protocols || { min: 1, max: 1 }, manifest.protocols || { min: 1, max: 1 });
  });
  const chosen = selectRuntime(compatible, {
    protocols: manifest.protocols || { min: 1, max: 1 },
    pin: readRuntimePin(home),
  });
  if (chosen && fs.existsSync(chosen.bin)) {
    return {
      source: chosen.source,
      dir: chosen.dir || path.dirname(path.dirname(chosen.bin)),
      entry: chosen.bin,
      version: chosen.version,
      protocols: chosen.protocols,
    };
  }
  return null;
}

// ---- Integrity & Pure-JS Tar Extraction ----

export function verifySha512Integrity(buffer, expectedIntegrity) {
  if (typeof expectedIntegrity !== 'string' || !expectedIntegrity.startsWith('sha512-')) {
    throw new Error('Missing or unsupported integrity format (expected sha512-...)');
  }
  const actual = 'sha512-' + crypto.createHash('sha512').update(buffer).digest('base64');
  const aBuf = Buffer.from(actual, 'utf8');
  const bBuf = Buffer.from(expectedIntegrity.trim(), 'utf8');
  if (aBuf.length !== bBuf.length || !crypto.timingSafeEqual(aBuf, bBuf)) {
    const err = new Error(`SHA-512 integrity mismatch (expected ${expectedIntegrity.slice(0, 20)}..., got ${actual.slice(0, 20)}...)`);
    err.code = 'SHA512_MISMATCH';
    throw err;
  }
  return actual;
}

function tarNumeric(block, start, length) {
  const raw = block.subarray(start, start + length);
  if (raw[0] & 128) {
    let val = raw[0] & 127;
    for (let i = 1; i < raw.length; i++) {
      val = val * 256 + raw[i];
      if (val > Number.MAX_SAFE_INTEGER) throw new Error('Tar numeric field overflow');
    }
    return val;
  }
  const digits = raw.toString('latin1').replace(/[\0 ]+$/g, '').trim();
  if (!digits) return 0;
  if (!/^[0-7]+$/.test(digits)) throw new Error(`Invalid tar octal field: ${JSON.stringify(digits)}`);
  return parseInt(digits, 8);
}

function tarText(block, start, length) {
  const slice = block.subarray(start, start + length);
  const zero = slice.indexOf(0);
  return (zero >= 0 ? slice.subarray(0, zero) : slice).toString('utf8');
}

function parsePaxRecords(data) {
  const out = {};
  let at = 0;
  while (at < data.length) {
    const space = data.indexOf(32, at);
    if (space < 0) break;
    const len = Number(data.subarray(at, space).toString('latin1'));
    if (!Number.isInteger(len) || len <= 0 || at + len > data.length) {
      throw new Error('Malformed PAX header');
    }
    const line = data.subarray(space + 1, at + len - 1).toString('utf8');
    const eq = line.indexOf('=');
    if (eq > 0) out[line.slice(0, eq)] = line.slice(eq + 1);
    at += len;
  }
  return out;
}

function safeTarParts(raw) {
  if (raw.includes('\0') || raw.includes('\\')) throw new Error(`Unsafe tar path: ${JSON.stringify(raw)}`);
  if (raw.startsWith('/') || /^[A-Za-z]:/.test(raw)) throw new Error(`Absolute tar path forbidden: ${JSON.stringify(raw)}`);
  const parts = raw.split('/').filter((p) => p !== '' && p !== '.');
  if (parts.includes('..')) throw new Error(`Path traversal forbidden in tar: ${JSON.stringify(raw)}`);
  return parts;
}

export function parseTarGzBuffer(gzBuffer) {
  let tar;
  try {
    tar = zlib.gunzipSync(gzBuffer, { maxOutputLength: MAX_UNPACKED_BYTES });
  } catch (err) {
    throw new Error(`Invalid gzip tarball: ${err.message}`);
  }
  const entries = [];
  let topDir = null;
  let offset = 0;
  let paxPath = null;
  let paxSize = null;
  let gnuLongName = null;
  let ended = false;

  while (offset + 512 <= tar.length) {
    const header = tar.subarray(offset, offset + 512);
    if (header.every((b) => b === 0)) {
      ended = true;
      break;
    }
    let checksum = 0;
    for (let i = 0; i < 512; i++) checksum += (i >= 148 && i < 156) ? 32 : header[i];
    if (tarNumeric(header, 148, 8) !== checksum) {
      throw new Error('Tar header checksum mismatch');
    }
    const typeFlag = header[156] === 0 ? '0' : String.fromCharCode(header[156]);
    const size = paxSize ?? tarNumeric(header, 124, 12);
    const dataStart = offset + 512;
    const dataEnd = dataStart + size;
    if (dataEnd > tar.length) throw new Error('Truncated tar entry');
    const data = tar.subarray(dataStart, dataEnd);
    offset = dataStart + Math.ceil(size / 512) * 512;

    if (typeFlag === 'x') {
      const pax = parsePaxRecords(data);
      paxPath = pax.path ?? null;
      paxSize = pax.size !== undefined ? Number(pax.size) : null;
      if (paxSize !== null && (!Number.isSafeInteger(paxSize) || paxSize < 0)) {
        throw new Error('Invalid PAX size');
      }
      continue;
    }
    if (typeFlag === 'g') continue;
    if (typeFlag === 'L') {
      gnuLongName = tarText(data, 0, data.length);
      continue;
    }

    const name = tarText(header, 0, 100);
    const magic = tarText(header, 257, 6);
    const prefix = magic.startsWith('ustar') ? tarText(header, 345, 155) : '';
    const rawPath = paxPath ?? gnuLongName ?? (prefix ? `${prefix}/${name}` : name);
    paxPath = null;
    paxSize = null;
    gnuLongName = null;

    if (typeFlag !== '0' && typeFlag !== '7' && typeFlag !== '5') {
      throw new Error(`Unsupported tar entry type ${JSON.stringify(typeFlag)} for ${rawPath}`);
    }
    const parts = safeTarParts(rawPath);
    if (!parts.length) continue;
    topDir ??= parts[0];
    if (parts[0] !== topDir) {
      throw new Error(`Tarball entry outside root folder ${topDir}/: ${rawPath}`);
    }
    const rel = parts.slice(1).join('/');
    if (!rel) continue;
    entries.push({
      path: rel,
      type: typeFlag === '5' ? 'dir' : 'file',
      mode: tarNumeric(header, 100, 8) & 0o777,
      data: typeFlag === '5' ? Buffer.alloc(0) : Buffer.from(data),
    });
  }
  if (!ended) throw new Error('Tarball ended without end-of-archive blocks');
  return entries;
}

function writeAtomicJson(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.${crypto.randomBytes(4).toString('hex')}.tmp`;
  try {
    fs.writeFileSync(tmp, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
    fs.renameSync(tmp, file);
  } finally {
    fs.rmSync(tmp, { force: true });
  }
}

export function registerSharedRuntime(home, dir, version) {
  const file = runtimesFileOf(home);
  let data;
  try {
    data = readRuntimesFile(home);
  } catch {
    data = { runtimes: [], adapters: {} };
  }
  const now = new Date().toISOString();
  const next = (data.runtimes || []).filter((r) => path.resolve(r.dir) !== path.resolve(dir));
  next.push({
    dir,
    version,
    update: 'bundled',
    harness: 'orca-design',
    seenAt: now,
  });
  writeAtomicJson(file, { ...data, runtimes: next });
}

function extractTarBufferAtomic({ buffer, home, manifest, sourceLabel, expectedIntegrity }) {
  verifySha512Integrity(buffer, expectedIntegrity ?? manifest.integrity);
  const entries = parseTarGzBuffer(buffer);
  const runtimeRoot = sharedRuntimesOf(home);
  fs.mkdirSync(runtimeRoot, { recursive: true });

  const staging = path.join(
    runtimeRoot,
    `.staging-orca-${manifest.version}-${process.pid}-${crypto.randomBytes(4).toString('hex')}`
  );
  try {
    const resolvedStaging = path.resolve(staging);
    fs.mkdirSync(resolvedStaging, { recursive: true });
    for (const entry of entries) {
      const target = path.resolve(resolvedStaging, ...safeTarParts(entry.path));
      const rel = path.relative(resolvedStaging, target);
      if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) {
        throw new Error(`Tar entry escapes staging: ${entry.path}`);
      }
      if (entry.type === 'dir') {
        fs.mkdirSync(target, { recursive: true, mode: 0o755 });
        continue;
      }
      fs.mkdirSync(path.dirname(target), { recursive: true, mode: 0o755 });
      const mode = (entry.mode & 0o111) ? 0o755 : 0o644;
      fs.writeFileSync(target, entry.data, { mode });
      fs.chmodSync(target, mode);
    }

    const pkgPath = path.join(resolvedStaging, 'package.json');
    let pkg = null;
    try { pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8')); } catch { /* handled below */ }
    if (!pkg || pkg.name !== manifest.package || pkg.version !== manifest.version) {
      throw new Error(`Invalid package.json inside tarball: expected ${manifest.package}@${manifest.version}, got ${pkg?.name}@${pkg?.version}`);
    }
    const entryCheck = runtimeInfo(resolvedStaging);
    if (!entryCheck || !fs.existsSync(entryCheck.bin)) {
      throw new Error(`Missing ${RUNTIME_ENTRY} in extracted tarball`);
    }

    const installRecord = {
      version: manifest.version,
      integrity: expectedIntegrity ?? manifest.integrity,
      tarball: sourceLabel,
      installedAt: new Date().toISOString(),
      installer: 'orca-plugin-design',
    };
    fs.writeFileSync(path.join(resolvedStaging, '.install.json'), `${JSON.stringify(installRecord, null, 2)}\n`, 'utf8');

    const finalDir = path.join(runtimeRoot, manifest.version);
    try {
      fs.renameSync(resolvedStaging, finalDir);
    } catch (err) {
      fs.rmSync(resolvedStaging, { recursive: true, force: true });
      const already = runtimeInfo(finalDir);
      if (!already || already.version !== manifest.version) throw err;
    }

    registerSharedRuntime(home, finalDir, manifest.version);
    const entry = path.join(finalDir, RUNTIME_ENTRY);
    return { dir: finalDir, entry, version: manifest.version };
  } catch (err) {
    fs.rmSync(staging, { recursive: true, force: true });
    throw err;
  }
}

// ---- Cross-process Disk Lock ----

function pidAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return err.code === 'EPERM';
  }
}

async function acquireDiskLock(lockPath, timeoutMs = 60000) {
  fs.mkdirSync(path.dirname(lockPath), { recursive: true });
  const deadline = Date.now() + timeoutMs;
  while (true) {
    try {
      const fd = fs.openSync(lockPath, 'wx');
      fs.writeFileSync(fd, JSON.stringify({ pid: process.pid, startedAt: Date.now() }));
      fs.closeSync(fd);
      return () => {
        try { fs.rmSync(lockPath, { force: true }); } catch { /* ignore */ }
      };
    } catch (err) {
      if (err.code !== 'EEXIST') throw err;
      let stale = false;
      try {
        const info = JSON.parse(fs.readFileSync(lockPath, 'utf8'));
        const age = Date.now() - Number(info.startedAt || 0);
        if (!pidAlive(info.pid) || age > LOCK_STALE_MS) stale = true;
      } catch {
        try {
          const stat = fs.statSync(lockPath);
          if (Date.now() - stat.mtimeMs > LOCK_STALE_MS) stale = true;
        } catch { stale = true; }
      }
      if (stale) {
        fs.rmSync(lockPath, { force: true });
        continue;
      }
      if (Date.now() >= deadline) {
        const lockErr = new Error('Timed out waiting for concurrent Open Artifact runtime download lock');
        lockErr.code = 'LOCK_TIMEOUT';
        throw lockErr;
      }
      await new Promise((r) => setTimeout(r, 200));
    }
  }
}

// ---- Proxy-Aware Streaming Download ----

function matchNoProxy(hostname, env) {
  const raw = env.NO_PROXY || env.no_proxy || '';
  if (!raw.trim()) return false;
  const host = hostname.toLowerCase();
  for (const part of raw.split(',').map((s) => s.trim().toLowerCase()).filter(Boolean)) {
    if (part === '*') return true;
    const clean = part.startsWith('.') ? part.slice(1) : part;
    if (host === clean || host.endsWith('.' + clean)) return true;
  }
  return false;
}

function resolveProxyUrl(targetUrl, env) {
  const u = new URL(targetUrl);
  if (matchNoProxy(u.hostname, env)) return null;
  const candidate = u.protocol === 'https:'
    ? (env.HTTPS_PROXY || env.https_proxy || env.ALL_PROXY || env.all_proxy || env.HTTP_PROXY || env.http_proxy)
    : (env.HTTP_PROXY || env.http_proxy || env.ALL_PROXY || env.all_proxy);
  if (!candidate) return null;
  try {
    return new URL(candidate);
  } catch {
    return null;
  }
}

async function openTunnelSocket(proxyUrl, targetUrl) {
  const proxyPort = Number(proxyUrl.port) || (proxyUrl.protocol === 'https:' ? 443 : 80);
  const targetPort = Number(targetUrl.port) || (targetUrl.protocol === 'https:' ? 443 : 80);
  const authority = `${targetUrl.hostname}:${targetPort}`;
  return new Promise((resolve, reject) => {
    const auth = (proxyUrl.username || proxyUrl.password)
      ? 'Basic ' + Buffer.from(`${decodeURIComponent(proxyUrl.username)}:${decodeURIComponent(proxyUrl.password)}`).toString('base64')
      : null;
    const reqOpts = {
      host: proxyUrl.hostname,
      port: proxyPort,
      method: 'CONNECT',
      path: authority,
      headers: {
        Host: authority,
        ...(auth ? { 'Proxy-Authorization': auth } : {}),
      },
    };
    const transport = proxyUrl.protocol === 'https:' ? https : http;
    const req = transport.request(reqOpts);
    req.setTimeout(30000, () => req.destroy(new Error('Proxy CONNECT timeout')));
    req.on('connect', (res, socket) => {
      if (res.statusCode !== 200) {
        socket.destroy();
        reject(new Error(`Proxy CONNECT failed with HTTP ${res.statusCode}`));
        return;
      }
      resolve(socket);
    });
    req.on('error', reject);
    req.end();
  });
}

async function nodeDownloadWithProxy(urlStr, proxyUrl, tmpPath, expectedBytes, onChunk, redirectCount = 0) {
  if (redirectCount > 5) throw new Error('Too many redirects');
  const target = new URL(urlStr);
  const isHttps = target.protocol === 'https:';
  let socket = null;
  if (proxyUrl && isHttps) {
    socket = await openTunnelSocket(proxyUrl, target);
  }

  return new Promise((resolve, reject) => {
    const reqOpts = socket
      ? {
        hostname: target.hostname,
        port: Number(target.port) || 443,
        path: target.pathname + target.search,
        method: 'GET',
        createConnection: () => tls.connect({ socket, servername: target.hostname }),
      }
      : proxyUrl && !isHttps
        ? {
          hostname: proxyUrl.hostname,
          port: Number(proxyUrl.port) || 80,
          path: target.href,
          method: 'GET',
          headers: { Host: target.host },
        }
        : target;

    const transport = isHttps ? https : http;
    const req = transport.get(reqOpts, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume();
        const nextUrl = new URL(res.headers.location, target).href;
        nodeDownloadWithProxy(nextUrl, resolveProxyUrl(nextUrl, process.env), tmpPath, expectedBytes, onChunk, redirectCount + 1)
          .then(resolve, reject);
        return;
      }
      if (res.statusCode !== 200) {
        res.resume();
        reject(new Error(`HTTP ${res.statusCode} downloading ${urlStr}`));
        return;
      }
      const totalBytes = Number(res.headers['content-length']) || expectedBytes || 0;
      const chunks = [];
      let bytesReceived = 0;
      const out = fs.createWriteStream(tmpPath);
      res.on('data', (chunk) => {
        bytesReceived += chunk.length;
        if (bytesReceived > MAX_TARBALL_BYTES) {
          req.destroy(new Error('Tarball exceeds maximum allowed size'));
          return;
        }
        chunks.push(chunk);
        out.write(chunk);
        onChunk(bytesReceived, totalBytes);
      });
      res.on('end', () => {
        out.end(() => resolve({ buffer: Buffer.concat(chunks), totalBytes }));
      });
      res.on('error', (err) => {
        out.destroy();
        reject(err);
      });
      out.on('error', reject);
    });
    req.setTimeout(120000, () => req.destroy(new Error(`Download timeout for ${urlStr}`)));
    req.on('error', reject);
  });
}

async function fetchDownloadToTemp(urlStr, tmpPath, expectedBytes, onChunk, fetchImpl, env) {
  const proxyUrl = resolveProxyUrl(urlStr, env);
  if (proxyUrl && !fetchImpl) {
    return nodeDownloadWithProxy(urlStr, proxyUrl, tmpPath, expectedBytes, onChunk);
  }
  const doFetch = fetchImpl || globalThis.fetch;
  const response = await doFetch(urlStr, { signal: AbortSignal.timeout(120000) });
  if (!response.ok) {
    throw new Error(`HTTP ${response.status} downloading ${urlStr}`);
  }
  const totalBytes = Number(response.headers?.get?.('content-length')) || expectedBytes || 0;
  if (!response.body || typeof response.body.getReader !== 'function') {
    const buf = Buffer.from(await response.arrayBuffer());
    if (buf.length > MAX_TARBALL_BYTES) throw new Error('Tarball exceeds maximum allowed size');
    fs.writeFileSync(tmpPath, buf);
    onChunk(buf.length, totalBytes || buf.length);
    return { buffer: buf, totalBytes: totalBytes || buf.length };
  }

  const reader = response.body.getReader();
  const chunks = [];
  let bytesReceived = 0;
  const out = fs.createWriteStream(tmpPath);
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      const buf = Buffer.from(value);
      bytesReceived += buf.length;
      if (bytesReceived > MAX_TARBALL_BYTES) {
        throw new Error('Tarball exceeds maximum allowed size');
      }
      chunks.push(buf);
      out.write(buf);
      onChunk(bytesReceived, totalBytes);
    }
    await new Promise((resolve, reject) => {
      out.on('error', reject);
      out.end(resolve);
    });
    return { buffer: Buffer.concat(chunks), totalBytes };
  } catch (err) {
    out.destroy();
    throw err;
  }
}

// ---- Public Orchestration API ----

export async function importOfflineTarball(input = {}, options = {}) {
  const home = openArtifactHome(options.home);
  const manifest = readRuntimeManifest(options.manifestPath);
  const expectedIntegrity = options.expectedIntegrity || manifest.integrity;

  let buffer;
  let sourceLabel = 'offline';
  if (Buffer.isBuffer(input.buffer)) {
    buffer = input.buffer;
    sourceLabel = input.fileName ? `offline:${path.basename(input.fileName)}` : 'offline:upload';
  } else if (typeof input.base64 === 'string' && input.base64.trim()) {
    buffer = Buffer.from(input.base64.trim(), 'base64');
    sourceLabel = input.fileName ? `offline:${path.basename(input.fileName)}` : 'offline:upload';
  } else if (typeof input.filePath === 'string' && input.filePath.trim()) {
    const resolved = path.resolve(input.filePath.trim());
    if (!fs.existsSync(resolved) || !fs.statSync(resolved).isFile()) {
      return { ok: false, error: `离线安装包不存在: ${resolved}` };
    }
    buffer = fs.readFileSync(resolved);
    sourceLabel = `offline:${resolved}`;
  } else {
    return { ok: false, error: '请提供本地 .tgz 文件路径或安装包数据' };
  }

  const releaseLock = await acquireDiskLock(path.join(sharedRuntimesOf(home), `.download-${manifest.version}.lock`));
  try {
    setStatus(home, manifest, {
      state: 'verifying',
      bytesReceived: buffer.length,
      totalBytes: buffer.length,
      source: sourceLabel,
      error: null,
    });
    verifySha512Integrity(buffer, expectedIntegrity);
    setStatus(home, manifest, { state: 'extracting' });
    const installed = extractTarBufferAtomic({ buffer, home, manifest, sourceLabel, expectedIntegrity });
    const status = setStatus(home, manifest, {
      state: 'ready',
      version: installed.version,
      bytesReceived: buffer.length,
      totalBytes: buffer.length,
      source: sourceLabel,
      error: null,
      runtimeDir: installed.dir,
      entry: installed.entry,
      reused: false,
    });
    return { ok: true, source: 'offline', ...installed, status };
  } catch (err) {
    const status = setStatus(home, manifest, {
      state: 'error',
      error: err.message,
      source: sourceLabel,
    });
    return { ok: false, code: err.code || 'OFFLINE_IMPORT_FAILED', error: err.message, status };
  } finally {
    releaseLock();
  }
}

export async function ensureRuntime(options = {}) {
  const env = options.env || process.env;
  const home = openArtifactHome(options.home);
  const manifest = readRuntimeManifest(options.manifestPath);

  // Layer 1: env override & shared local reuse (0 download)
  const local = discoverLocalRuntime({ home, manifest, env });
  if (local) {
    const status = setStatus(home, manifest, {
      state: 'ready',
      version: local.version,
      bytesReceived: manifest.sizeBytes || 0,
      totalBytes: manifest.sizeBytes || 0,
      source: local.source,
      error: null,
      runtimeDir: local.dir,
      entry: local.entry,
      reused: true,
    });
    return { ok: true, reused: true, ...local, status };
  }

  // Layer 2: optional offline tarball path from env or options
  const offlinePath = options.offlineTgz || env.ORCA_DESIGN_OA_TGZ;
  if (offlinePath) {
    return importOfflineTarball({ filePath: offlinePath }, options);
  }

  if (options.autoDownload === false) {
    return { ok: false, code: 'NOT_INSTALLED', error: 'Open Artifact runtime not installed', status: getRuntimeStatus(options) };
  }

  // Layer 3: in-process single-flight lock + cross-process disk lock
  const flightKey = `${home}:${manifest.version}`;
  if (inFlight.has(flightKey)) {
    return inFlight.get(flightKey);
  }

  const work = (async () => {
    const runtimeRoot = sharedRuntimesOf(home);
    const lockPath = path.join(runtimeRoot, `.download-${manifest.version}.lock`);
    const releaseLock = await acquireDiskLock(lockPath);
    try {
      const afterLock = discoverLocalRuntime({ home, manifest, env });
      if (afterLock) {
        const status = setStatus(home, manifest, {
          state: 'ready',
          version: afterLock.version,
          source: afterLock.source,
          error: null,
          runtimeDir: afterLock.dir,
          entry: afterLock.entry,
          reused: true,
        });
        return { ok: true, reused: true, ...afterLock, status };
      }

      const urls = options.urls || manifest.urls;
      const errors = [];
      fs.mkdirSync(runtimeRoot, { recursive: true });

      for (const url of urls) {
        const tmpFile = path.join(
          runtimeRoot,
          `.download-${manifest.version}-${process.pid}-${crypto.randomBytes(4).toString('hex')}.tgz`
        );
        try {
          setStatus(home, manifest, {
            state: 'downloading',
            bytesReceived: 0,
            totalBytes: manifest.sizeBytes || 0,
            source: url,
            error: null,
          });

          const { buffer, totalBytes } = await fetchDownloadToTemp(
            url,
            tmpFile,
            manifest.sizeBytes,
            (bytesReceived, total) => {
              setStatus(home, manifest, {
                state: 'downloading',
                bytesReceived,
                totalBytes: total || manifest.sizeBytes || 0,
                source: url,
              });
            },
            options.fetchImpl,
            env
          );

          setStatus(home, manifest, {
            state: 'verifying',
            bytesReceived: buffer.length,
            totalBytes: totalBytes || buffer.length,
            source: url,
          });
          verifySha512Integrity(buffer, manifest.integrity);

          setStatus(home, manifest, { state: 'extracting', source: url });
          const installed = extractTarBufferAtomic({
            buffer,
            home,
            manifest,
            sourceLabel: url,
            expectedIntegrity: manifest.integrity,
          });

          const status = setStatus(home, manifest, {
            state: 'ready',
            version: installed.version,
            bytesReceived: buffer.length,
            totalBytes: buffer.length,
            source: url,
            error: null,
            runtimeDir: installed.dir,
            entry: installed.entry,
            reused: false,
          });
          return { ok: true, reused: false, source: 'downloaded', ...installed, status };
        } catch (err) {
          errors.push(`${url}: ${err.message}`);
        } finally {
          fs.rmSync(tmpFile, { force: true });
        }
      }

      const message = `Open Artifact 运行时下载失败（已尝试 ${urls.length} 个源）：${errors.join(' | ')}`;
      const status = setStatus(home, manifest, {
        state: 'error',
        error: message,
      });
      return { ok: false, code: 'DOWNLOAD_FAILED', error: message, errors, status };
    } finally {
      releaseLock();
    }
  })().finally(() => {
    inFlight.delete(flightKey);
  });

  inFlight.set(flightKey, work);
  return work;
}
