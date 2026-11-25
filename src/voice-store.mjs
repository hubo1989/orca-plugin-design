// SPDX-License-Identifier: MIT
// MIT self-developed local voice profile store & user-triggered session snippet extractor.
// Stores profile at <ORCA_DESIGN_HOME>/voice/voice-profile.md with strict 0600 permissions.

import { execFile } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const VOICE_MAX_BYTES = 65536;
export const VOICE_SAMPLE_MIN_CHARS = 60;
const ALLOWED_SAMPLE_EXTS = new Set(['.md', '.txt']);
const SKIP_SCAN_DIRS = new Set(['.git', 'node_modules', '.orca', 'vendor', 'dist', '.venv', '__pycache__', 'build']);

export const VOICE_PROFILE_TEMPLATE = `# 我的语气档案（Voice Profile）

> 本档案仅保存在本机受控目录（0600 权限），用于写作润色与「做新一期」时对齐个人表达风格；所有条目须附真实样本出处，严禁凭空编造经历或数据。

## 句长与段落节奏
- （待学习：例如偏好短句直述、段首给结论等）

## 常用表达与连接习惯
- （待学习：例如常用过渡词、口头语或提问方式）

## 明确回避的套话
- （待学习：例如禁用“值得一提的是”“赋能”“闭环”等模板化词句）

## 标点与人称偏好
- （待学习：例如第一人称视角、中文弯引号与破折号习惯）

## 样本证据摘录
- （待补充：每条风格判断需附上对应样本短句佐证）
`;

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

export function voiceDir(overrideHome) {
  return path.join(resolveDesignHome(overrideHome), 'voice');
}

export function voiceProfilePath(overrideHome) {
  return path.join(voiceDir(overrideHome), 'voice-profile.md');
}

export function voiceSamplesDir(overrideHome) {
  return path.join(voiceDir(overrideHome), 'samples');
}

function ensurePrivateDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true, mode: 0o700 });
  try {
    fs.chmodSync(dirPath, 0o700);
  } catch { /* ignore on platforms without POSIX chmod */ }
}

function writePrivateAtomic(filePath, content) {
  ensurePrivateDir(path.dirname(filePath));
  const tmp = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  try {
    fs.writeFileSync(tmp, content, { encoding: 'utf8', mode: 0o600 });
    try { fs.chmodSync(tmp, 0o600); } catch { /* ignore */ }
    fs.renameSync(tmp, filePath);
    try { fs.chmodSync(filePath, 0o600); } catch { /* ignore */ }
  } finally {
    fs.rmSync(tmp, { force: true });
  }
}

export function readVoiceStatus(overrideHome) {
  const vDir = voiceDir(overrideHome);
  const pPath = voiceProfilePath(overrideHome);
  const sDir = voiceSamplesDir(overrideHome);
  let sampleCount = 0;
  try {
    sampleCount = fs.readdirSync(sDir).filter((n) => !n.startsWith('.')).length;
  } catch { /* no samples dir */ }

  if (!fs.existsSync(pPath)) {
    return {
      ok: true,
      exists: false,
      updatedAt: '',
      sizeBytes: 0,
      content: '',
      sampleCount,
      profilePath: pPath,
      voiceDir: vDir,
    };
  }
  try {
    const stat = fs.statSync(pPath);
    const content = fs.readFileSync(pPath, 'utf8');
    return {
      ok: true,
      exists: content.trim().length > 0,
      updatedAt: stat.mtime.toISOString(),
      sizeBytes: Buffer.byteLength(content, 'utf8'),
      content,
      sampleCount,
      profilePath: pPath,
      voiceDir: vDir,
    };
  } catch (err) {
    return {
      ok: false,
      exists: false,
      updatedAt: '',
      sizeBytes: 0,
      content: '',
      sampleCount,
      profilePath: pPath,
      voiceDir: vDir,
      error: err.message,
    };
  }
}

export function saveVoiceProfile(rawContent, overrideHome) {
  if (typeof rawContent !== 'string') {
    return { ok: false, error: '档案内容必须是字符串' };
  }
  const normalized = rawContent.replace(/\r\n/g, '\n');
  const bytes = Buffer.byteLength(normalized, 'utf8');
  if (bytes > VOICE_MAX_BYTES) {
    return { ok: false, error: `档案大小超过上限 (${VOICE_MAX_BYTES} 字节)` };
  }
  if (!normalized.trim()) {
    return { ok: false, error: '档案内容不能为空（如需清空请使用清空功能）' };
  }
  const pPath = voiceProfilePath(overrideHome);
  writePrivateAtomic(pPath, normalized.endsWith('\n') ? normalized : `${normalized}\n`);
  const status = readVoiceStatus(overrideHome);
  return { ...status, ok: true };
}

export function saveVoiceSamples(items, overrideHome) {
  const sDir = voiceSamplesDir(overrideHome);
  ensurePrivateDir(voiceDir(overrideHome));
  ensurePrivateDir(sDir);
  const savedFiles = [];
  const list = Array.isArray(items) ? items : [];
  let idx = 1;
  for (const item of list) {
    const text = String(item || '').trim();
    if (!text) continue;
    const fname = `sample-${Date.now()}-${idx++}.md`;
    const full = path.join(sDir, fname);
    writePrivateAtomic(full, `${text}\n`);
    savedFiles.push(full);
  }
  return { ok: true, savedFiles, count: savedFiles.length };
}

export function purgeVoiceData(overrideHome) {
  const vDir = voiceDir(overrideHome);
  fs.rmSync(vDir, { recursive: true, force: true });
  return {
    ok: true,
    purged: true,
    exists: false,
    profilePath: voiceProfilePath(overrideHome),
  };
}

export function listWorkspaceTextDocs(wsRoot, maxFiles = 60) {
  if (!wsRoot || !fs.existsSync(wsRoot)) return [];
  let wsReal = '';
  try { wsReal = fs.realpathSync(wsRoot); } catch { return []; }
  const out = [];
  (function walk(dir, depth) {
    if (depth > 4 || out.length >= maxFiles) return;
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (out.length >= maxFiles) break;
      if (e.name.startsWith('.') || SKIP_SCAN_DIRS.has(e.name)) continue;
      const full = path.join(dir, e.name);
      if (e.isSymbolicLink()) continue;
      if (e.isDirectory()) {
        walk(full, depth + 1);
      } else if (e.isFile()) {
        const ext = path.extname(e.name).toLowerCase();
        if (!ALLOWED_SAMPLE_EXTS.has(ext)) continue;
        try {
          const real = fs.realpathSync(full);
          if (real.startsWith(wsReal + path.sep)) {
            out.push({
              relPath: path.relative(wsRoot, full),
              fullPath: real,
            });
          }
        } catch { /* ignore */ }
      }
    }
  })(wsRoot, 0);
  out.sort((a, b) => a.relPath.localeCompare(b.relPath));
  return out;
}

export function validateSampleFilePath(wsRoot, rawPath) {
  if (!wsRoot) return { ok: false, error: '当前工作区未识别' };
  const input = String(rawPath || '').trim();
  if (!input) return { ok: false, error: '文件路径不能为空' };
  const resolved = path.isAbsolute(input) ? path.resolve(input) : path.resolve(wsRoot, input);
  const ext = path.extname(resolved).toLowerCase();
  if (!ALLOWED_SAMPLE_EXTS.has(ext)) {
    return { ok: false, error: `仅支持 .md / .txt 文件样本（收到 ${ext || '无扩展名'}）` };
  }
  if (!fs.existsSync(resolved)) {
    return { ok: false, error: `文件不存在：${resolved}` };
  }
  try {
    const stat = fs.statSync(resolved);
    if (!stat.isFile()) return { ok: false, error: '目标路径不是普通文件' };
    const wsReal = fs.realpathSync(wsRoot);
    const fileReal = fs.realpathSync(resolved);
    if (fileReal !== wsReal && !fileReal.startsWith(wsReal + path.sep)) {
      return { ok: false, error: '样本文件必须位于当前工作区内' };
    }
    return { ok: true, path: fileReal };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

/**
 * Strip fenced code blocks, injected XML tags, URLs, and shell command lines,
 * returning clean natural-language paragraphs of >= minChars characters.
 */
export function cleanUserTextToParagraphs(rawText, minChars = VOICE_SAMPLE_MIN_CHARS) {
  let text = String(rawText || '').replace(/\r\n/g, '\n');
  // Remove fenced code blocks
  text = text.replace(/```[\s\S]*?```/g, '\n');
  // Remove injected XML/system blocks if any
  text = text.replace(/<(?:SYSTEM_MESSAGE|USER_REQUEST|ADDITIONAL_METADATA|USER_SETTINGS_CHANGE)>[\s\S]*?<\/(?:SYSTEM_MESSAGE|USER_REQUEST|ADDITIONAL_METADATA|USER_SETTINGS_CHANGE)>/g, '\n');
  // Remove URLs
  text = text.replace(/https?:\/\/[^\s)>"'\]`]+/gi, '');
  // Remove inline code blocks longer than 24 chars (likely commands/paths)
  text = text.replace(/`[^`\n]{24,}`/g, '');

  const rawBlocks = text.split(/\n{2,}/);
  const paragraphs = [];
  for (const block of rawBlocks) {
    const cleanLines = block
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => {
        if (!line) return false;
        // Skip shell prompts / stack trace / CLI command output lines
        if (/^(?:\$|#|>\s*\[|at\s+\S+\s+\(|Traceback\b|Error:\s)/.test(line)) return false;
        if (/^(?:\/[\w./-]+){2,}$/.test(line)) return false;
        return true;
      });
    const joined = cleanLines.join(' ').replace(/\s+/g, ' ').trim();
    if (joined.length >= minChars) {
      paragraphs.push(joined);
    }
  }
  return paragraphs;
}

export function extractUserParagraphsFromEntries(entries, minChars = VOICE_SAMPLE_MIN_CHARS) {
  const seen = new Set();
  const out = [];
  for (const entry of Array.isArray(entries) ? entries : []) {
    if (!entry || entry.kind !== 'message' || entry.role !== 'user') continue;
    const raw = typeof entry.text === 'string'
      ? entry.text
      : (typeof entry.content === 'string' ? entry.content : '');
    if (!raw.trim()) continue;
    for (const para of cleanUserTextToParagraphs(raw, minChars)) {
      if (seen.has(para)) continue;
      seen.add(para);
      out.push(para);
    }
  }
  return out;
}

function defaultExecOrca(orcaBin, args, timeout = 5000) {
  return new Promise((resolve) => {
    execFile(orcaBin, args, { timeout, maxBuffer: 4 * 1024 * 1024 }, (err, stdout, stderr) => {
      resolve({ err, stdout: String(stdout || ''), stderr: String(stderr || '') });
    });
  });
}

/**
 * User-triggered session scanner. Never runs automatically in background.
 * Degrades gracefully when Orca CLI is missing, times out, or transcripts are unreadable.
 */
export async function scanOrcaSessionsForVoice(wsRoot, opts = {}) {
  const orcaBin = opts.orcaBin || process.env.ORCA_CLI_COMMAND || '/Applications/Orca.app/Contents/Resources/bin/orca';
  const execOrca = opts.execOrca || defaultExecOrca;
  const maxSessions = opts.maxSessions ?? 8;
  const minChars = opts.minChars ?? VOICE_SAMPLE_MIN_CHARS;

  const listArgs = ['agent', 'list'];
  if (wsRoot) listArgs.push('--worktree', `path:${wsRoot}`);
  listArgs.push('--json');

  const listRes = await execOrca(orcaBin, listArgs, 5000);
  if (listRes.err) {
    return {
      ok: true,
      degraded: true,
      reason: 'cli_unavailable',
      message: '未能读取本机 Orca 会话列表（CLI 不可用或超时），请改用粘贴文本或选择本地 .md/.txt 文件。',
      candidates: [],
    };
  }

  let agents = [];
  try {
    const parsed = JSON.parse(listRes.stdout || '{}');
    agents = Array.isArray(parsed?.result?.agents) ? parsed.result.agents : [];
  } catch {
    return {
      ok: true,
      degraded: true,
      reason: 'parse_failed',
      message: '会话列表返回格式无法解析，请改用粘贴文本或选择本地 .md/.txt 文件。',
      candidates: [],
    };
  }

  if (!agents.length) {
    return {
      ok: true,
      degraded: true,
      reason: 'no_sessions',
      message: '当前工作区暂无可读取的历史会话，请直接粘贴你的文章段落或选择本地 .md/.txt 文件。',
      candidates: [],
    };
  }

  const recent = [...agents]
    .filter((a) => a && a.orcaSessionId)
    .sort((a, b) => Number(b.updatedAt || 0) - Number(a.updatedAt || 0))
    .slice(0, maxSessions);

  const candidates = [];
  const seenText = new Set();
  let unreadableCount = 0;

  for (const sess of recent) {
    const readRes = await execOrca(orcaBin, ['agent', 'read', String(sess.orcaSessionId), '--limit', '50', '--json'], 5000);
    if (readRes.err) {
      unreadableCount++;
      continue;
    }
    let data;
    try {
      data = JSON.parse(readRes.stdout || '{}');
    } catch {
      unreadableCount++;
      continue;
    }
    if (!data?.ok || !Array.isArray(data?.result?.entries)) {
      unreadableCount++;
      continue;
    }
    const paragraphs = extractUserParagraphsFromEntries(data.result.entries, minChars);
    for (const para of paragraphs) {
      if (seenText.has(para)) continue;
      seenText.add(para);
      candidates.push({
        id: `snip_${candidates.length + 1}`,
        sessionId: String(sess.orcaSessionId),
        agent: String(sess.agent || data.result.agent || ''),
        title: String(sess.title || sess.orcaSessionId).slice(0, 80),
        text: para,
        charCount: para.length,
      });
      if (candidates.length >= 40) break;
    }
    if (candidates.length >= 40) break;
  }

  if (!candidates.length) {
    return {
      ok: true,
      degraded: true,
      reason: unreadableCount > 0 ? 'transcripts_unavailable' : 'no_qualifying_paragraphs',
      message: '未从近期会话中筛选到 >= 60 字的自然语言用户发言，请改用粘贴文本或选择本地 .md/.txt 文件。',
      candidates: [],
    };
  }

  return {
    ok: true,
    degraded: false,
    reason: 'ok',
    candidates,
  };
}
