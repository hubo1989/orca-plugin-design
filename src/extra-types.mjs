// SPDX-License-Identifier: MIT
// Idempotent sync of bundled MIT custom-types (social-cards, long-page) into <ORCA_DESIGN_HOME>/extra-types/
// and registration in <OPEN_ARTIFACT_HOME>/settings.json typeRoots.extra (scope: 'extra', trusted: true).

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const MODULE_DIR = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_PLUGIN_ROOT = path.resolve(MODULE_DIR, '..');
export const BUNDLED_CUSTOM_TYPES = Object.freeze(['social-cards', 'long-page']);

function orcaConfigParent() {
  const home = process.env.HOME || os.homedir();
  if (process.platform === 'darwin') return path.join(home, 'Library', 'Application Support', 'orca');
  if (process.platform === 'win32') return path.join(process.env.APPDATA || path.join(home, 'AppData', 'Roaming'), 'orca');
  return path.join(process.env.XDG_CONFIG_HOME || path.join(home, '.config'), 'orca');
}

export function resolveDesignHome(overrideHome) {
  if (overrideHome && String(overrideHome).trim()) return path.resolve(String(overrideHome).trim());
  const set = process.env.ORCA_DESIGN_HOME?.trim() || process.env.DSH_HOME?.trim();
  if (set) return path.resolve(set);
  return path.join(orcaConfigParent(), 'orca-design');
}

export function resolveOpenArtifactHome(overrideOaHome) {
  if (overrideOaHome && String(overrideOaHome).trim()) return path.resolve(String(overrideOaHome).trim());
  const set = process.env.OPEN_ARTIFACT_HOME?.trim();
  if (set) return path.resolve(set);
  return path.join(os.homedir(), '.agents', 'open-artifact');
}

function copyTreeClean(srcDir, dstDir) {
  fs.mkdirSync(dstDir, { recursive: true });
  for (const entry of fs.readdirSync(srcDir, { withFileTypes: true })) {
    if (entry.name.startsWith('.') || entry.isSymbolicLink()) continue;
    const src = path.join(srcDir, entry.name);
    const dst = path.join(dstDir, entry.name);
    if (entry.isDirectory()) {
      copyTreeClean(src, dst);
    } else if (entry.isFile()) {
      fs.copyFileSync(src, dst);
    }
  }
}

function writeJsonAtomic(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tmp = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  try {
    fs.writeFileSync(tmp, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
    fs.renameSync(tmp, filePath);
  } finally {
    fs.rmSync(tmp, { force: true });
  }
}

function expandHome(p) {
  const s = String(p || '');
  return s.startsWith('~/') ? path.join(os.homedir(), s.slice(2)) : path.resolve(s);
}

/**
 * Sync bundled custom-types to <ORCA_DESIGN_HOME>/extra-types/ and idempotently register
 * that directory in <OPEN_ARTIFACT_HOME>/settings.json typeRoots.extra.
 */
export function syncBundledExtraTypes({
  pluginRoot = DEFAULT_PLUGIN_ROOT,
  designHome,
  oaHome,
} = {}) {
  const resolvedDesignHome = resolveDesignHome(designHome);
  const resolvedOaHome = resolveOpenArtifactHome(oaHome);
  const extraRoot = path.join(resolvedDesignHome, 'extra-types');
  fs.mkdirSync(extraRoot, { recursive: true });

  const synced = [];
  for (const id of BUNDLED_CUSTOM_TYPES) {
    const src = path.join(pluginRoot, 'custom-types', id);
    if (!fs.existsSync(src)) continue;
    const target = path.join(extraRoot, id);
    const staging = path.join(extraRoot, `.staging-${id}-${process.pid}-${Date.now()}`);
    const backup = path.join(extraRoot, `.backup-${id}-${process.pid}-${Date.now()}`);
    try {
      copyTreeClean(src, staging);
      if (fs.existsSync(target)) {
        fs.renameSync(target, backup);
      }
      fs.renameSync(staging, target);
      if (fs.existsSync(backup)) {
        fs.rmSync(backup, { recursive: true, force: true });
      }
      synced.push(id);
    } catch (err) {
      if (!fs.existsSync(target) && fs.existsSync(backup)) {
        try { fs.renameSync(backup, target); } catch { /* ignore */ }
      }
      fs.rmSync(staging, { recursive: true, force: true });
      throw err;
    }
  }

  const settingsFile = path.join(resolvedOaHome, 'settings.json');
  let settings = {};
  let settingsRawExists = false;
  if (fs.existsSync(settingsFile)) {
    settingsRawExists = true;
    try {
      const parsed = JSON.parse(fs.readFileSync(settingsFile, 'utf8'));
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        settings = parsed;
      }
    } catch {
      settings = {};
    }
  }

  const existingRoots = settings.typeRoots && typeof settings.typeRoots === 'object' && !Array.isArray(settings.typeRoots)
    ? settings.typeRoots
    : {};
  const existingExtra = Array.isArray(existingRoots.extra) ? [...existingRoots.extra] : [];
  const resolvedExtra = path.resolve(extraRoot);
  const alreadyRegistered = existingExtra.some((entry) => {
    if (typeof entry !== 'string' || !entry.trim()) return false;
    try {
      return expandHome(entry.trim()) === resolvedExtra;
    } catch {
      return false;
    }
  });

  if (!alreadyRegistered || !settingsRawExists) {
    const nextExtra = alreadyRegistered ? existingExtra : [...existingExtra, resolvedExtra];
    const nextSettings = {
      ...settings,
      typeRoots: {
        ...existingRoots,
        extra: nextExtra,
      },
    };
    writeJsonAtomic(settingsFile, nextSettings);
  }

  return {
    ok: true,
    extraRoot: resolvedExtra,
    settingsFile,
    synced,
    settingsUpdated: !alreadyRegistered || !settingsRawExists,
  };
}
