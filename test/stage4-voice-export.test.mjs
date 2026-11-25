// SPDX-License-Identifier: MIT
// Stage 4 unit & HTTP contract tests:
// - MIT Humanizer-zh + 4 new content recipes
// - MIT Voice Profile (0600 permissions, physical purge, user-triggered session scan & graceful degradation)
// - Extra-types idempotent sync & settings.json typeRoots.extra registration
// - /api/export-render HTTP contract (guardPost, browser_missing, Mock CDP 2x PNG/ZIP, long-png, pdf, standalone html)
// - Next-issue x Voice Profile x Custom Type theme inheritance linkage

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { inflateRawSync } from 'node:zlib';

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ps-stage4-'));
const wsDir = path.join(tmpDir, 'workspace');
const outsideDir = path.join(tmpDir, 'outside');
const designHome = path.join(tmpDir, 'orca-design');
const oaHome = path.join(tmpDir, 'oa-home');
const profileDb = path.join(tmpDir, 'profile-state.db');
const cliLog = path.join(tmpDir, 'orca-cli.log');

fs.mkdirSync(wsDir, { recursive: true });
fs.mkdirSync(outsideDir, { recursive: true });
fs.mkdirSync(designHome, { recursive: true });
fs.mkdirSync(oaHome, { recursive: true });
fs.writeFileSync(path.join(wsDir, 'draft-note.md'), '# 笔记\n\n今天记录一个工程实践。\n', 'utf8');
fs.writeFileSync(path.join(outsideDir, 'secret.md'), '# 越界文件\n', 'utf8');

execFileSync('sqlite3', [profileDb,
  'CREATE TABLE profile_state_documents (domain TEXT PRIMARY KEY, payload TEXT NOT NULL);'
  + " INSERT INTO profile_state_documents VALUES ('settings', '{\"theme\":\"light\"}');"
  + " INSERT INTO profile_state_documents VALUES ('workspaceSession', '{\"activeWorktreeId\":\"x::" + wsDir + "\"}');"
]);

const mockCli = path.join(tmpDir, 'mock-orca-cli.sh');
fs.writeFileSync(mockCli, `#!/bin/sh
echo "$@" >> "${cliLog}"
if [ "$1" = "agent" ] && [ "$2" = "launch" ]; then
  echo '{"ok":true,"result":{"outcome":{"kind":"chat"}}}'
  exit 0
fi
echo '{}'
`, { mode: 0o755 });

const stateFile = path.join(tmpDir, 'prototype-studio-state.json');
process.env.ORCA_STATE_FILE = stateFile;
process.env.ORCA_DESIGN_HOME = designHome;
process.env.OPEN_ARTIFACT_HOME = oaHome;
process.env.ORCA_DESIGN_NO_THUMB = '1';
process.env.ORCA_PROFILE_DB = profileDb;
process.env.ORCA_CLI_COMMAND = mockCli;
fs.writeFileSync(stateFile, JSON.stringify({ workspaceRoot: wsDir, workspaceName: 'stage4-ws' }));

const {
  readVoiceStatus,
  saveVoiceProfile,
  saveVoiceSamples,
  purgeVoiceData,
  validateSampleFilePath,
  cleanUserTextToParagraphs,
  extractUserParagraphsFromEntries,
  scanOrcaSessionsForVoice,
  voiceProfilePath,
  voiceDir,
} = await import('../src/voice-store.mjs');
const { syncBundledExtraTypes } = await import('../src/extra-types.mjs');
const { createColumn, assignToColumn } = await import('../src/columns-store.mjs');
const { RECIPES } = await import('../src/skills-meta.mjs');
const {
  server,
  galleryHtml,
  createExample,
  setExportRenderDeps,
  setVoiceScanDeps,
} = await import('../src/gallery-server.mjs');

const port = 41000 + Math.floor(Math.random() * 2000);
await new Promise((resolve, reject) => {
  server.once('error', reject);
  server.listen(port, '127.0.0.1', resolve);
});

const base = `http://127.0.0.1:${port}`;
const postHeaders = (extra = {}) => ({
  'content-type': 'application/json',
  origin: base,
  host: `127.0.0.1:${port}`,
  ...extra,
});

function createMockCdp({ scrollHeight = 3600 } = {}) {
  let cardIndex = 0;
  return {
    async connectCdp() {
      return {
        async send(method, params = {}) {
          if (method === 'Target.createTarget') return { targetId: 't-1' };
          if (method === 'Target.attachToTarget') return { sessionId: 's-1' };
          if (method === 'Runtime.evaluate') {
            if (params.expression?.includes('scrollHeight')) return { result: { value: scrollHeight } };
            const m = /setCard\((\d+)/.exec(params.expression || '');
            if (m) cardIndex = Number(m[1]);
            return { result: { value: true } };
          }
          if (method === 'Page.captureScreenshot') {
            return { data: Buffer.from(`MOCK_PNG_${cardIndex}`).toString('base64') };
          }
          if (method === 'Page.printToPDF') {
            return { data: Buffer.from('%PDF-1.4\n%Stage4Mock\n%%EOF').toString('base64') };
          }
          return {};
        },
        onEvent(fn) {
          setTimeout(() => fn({ sessionId: 's-1', method: 'Page.loadEventFired' }), 5);
          return () => {};
        },
        close() {},
      };
    },
  };
}

function parseZipEntries(zipBuf) {
  const entries = [];
  let offset = 0;
  while (offset + 4 <= zipBuf.length && zipBuf.readUInt32LE(offset) === 0x04034b50) {
    const compressedSize = zipBuf.readUInt32LE(offset + 18);
    const nameLen = zipBuf.readUInt16LE(offset + 26);
    const extraLen = zipBuf.readUInt16LE(offset + 28);
    const nameStart = offset + 30;
    const name = zipBuf.slice(nameStart, nameStart + nameLen).toString('utf8');
    const dataStart = nameStart + nameLen + extraLen;
    entries.push({ name, data: inflateRawSync(zipBuf.slice(dataStart, dataStart + compressedSize)) });
    offset = dataStart + compressedSize;
  }
  return entries;
}

test('voice-store enforces 0600 permissions, validates workspace sample paths, and physically purges data', () => {
  const saved = saveVoiceProfile('# 我的语气档案\n\n## 句长与段落节奏\n- 喜欢先讲结论，再用短句拆开。\n');
  assert.equal(saved.ok, true);
  assert.equal(saved.exists, true);

  const pPath = voiceProfilePath();
  const mode = fs.statSync(pPath).mode & 0o777;
  assert.equal(mode, 0o600, `voice-profile.md mode must be 0600, got ${mode.toString(8)}`);

  const samp = saveVoiceSamples(['这是一段测试样本，用来确认样本文件也以 0600 权限落地。']);
  assert.equal(samp.ok, true);
  assert.equal(samp.count, 1);
  assert.equal(fs.statSync(samp.savedFiles[0]).mode & 0o777, 0o600);

  assert.equal(validateSampleFilePath(wsDir, 'draft-note.md').ok, true);
  assert.equal(validateSampleFilePath(wsDir, '../outside/secret.md').ok, false);
  assert.equal(validateSampleFilePath(wsDir, 'package.json').ok, false);

  const purged = purgeVoiceData();
  assert.equal(purged.ok, true);
  assert.equal(fs.existsSync(pPath), false);
  assert.equal(fs.existsSync(voiceDir()), false);
  assert.equal(readVoiceStatus().exists, false);
});

test('session snippet extractor strips code/URLs/assistant text and degrades cleanly on CLI failure', async () => {
  const rawParagraphs = cleanUserTextToParagraphs([
    '短句忽略',
    '```js\nconsole.log("ignore code block that is very long and should never appear in voice profile");\n```',
    '访问 https://example.com/very/long/url/that/should/be/stripped 查看详情，但这段自然语言足够长并且完整表达了我自己的真实写作习惯、句式偏好与判断节奏，用来提取个人语气特征与日常行文风格非常合适。',
    '$ ls -la /tmp/ignore-shell-line',
  ].join('\n\n'));
  assert.equal(rawParagraphs.length, 1);
  assert.equal(rawParagraphs[0].includes('https://'), false);
  assert.equal(rawParagraphs[0].includes('console.log'), false);

  const extracted = extractUserParagraphsFromEntries([
    { kind: 'message', role: 'assistant', text: '这是一段很长的助手回复，长度远远超过六十个字，但是因为角色是助手所以绝对不能被提取进用户的语气档案候选项中。' },
    { kind: 'tool', name: 'shell', state: 'completed' },
    { kind: 'message', role: 'user', text: '我写技术总结时习惯先用一两句话给出明确判断，再补齐可核验的数据、命令输出与文件位置，不喜欢堆砌形容词、空洞的包装词汇或没有证据的猜测。' },
  ]);
  assert.equal(extracted.length, 1);
  assert.ok(extracted[0].includes('先用一两句话给出明确判断'));

  const okScan = await scanOrcaSessionsForVoice(wsDir, {
    execOrca: async (_bin, args) => {
      if (args[1] === 'list') {
        return {
          err: null,
          stdout: JSON.stringify({
            ok: true,
            result: { agents: [{ orcaSessionId: 'sess-1', agent: 'codex', title: '测试会话', updatedAt: 100 }] },
          }),
        };
      }
      return {
        err: null,
        stdout: JSON.stringify({
          ok: true,
          result: {
            orcaSessionId: 'sess-1',
            agent: 'codex',
            entries: [
              { kind: 'message', role: 'user', text: '平时写文章和复盘笔记时我喜欢直接切入问题本身，把前因后果、关键取舍和实测结论拆成清晰短段落，每个核心判断都要有明确事实依据撑住，绝不写空泛套话。' },
            ],
          },
        }),
      };
    },
  });
  assert.equal(okScan.ok, true);
  assert.equal(okScan.degraded, false);
  assert.equal(okScan.candidates.length, 1);

  const failScan = await scanOrcaSessionsForVoice(wsDir, {
    execOrca: async () => ({ err: new Error('CLI timeout'), stdout: '' }),
  });
  assert.equal(failScan.ok, true);
  assert.equal(failScan.degraded, true);
  assert.equal(failScan.candidates.length, 0);
});

test('syncBundledExtraTypes idempotently installs social-cards & long-page into settings.json typeRoots.extra', () => {
  const customSettings = { otherSetting: 42, typeRoots: { extra: ['/some/existing/extra'] } };
  fs.writeFileSync(path.join(oaHome, 'settings.json'), JSON.stringify(customSettings, null, 2));

  const first = syncBundledExtraTypes();
  assert.equal(first.ok, true);
  assert.deepEqual(first.synced.sort(), ['long-page', 'social-cards']);
  assert.equal(first.settingsUpdated, true);
  assert.ok(fs.existsSync(path.join(designHome, 'extra-types', 'social-cards', 'artifact-type.json')));
  assert.ok(fs.existsSync(path.join(designHome, 'extra-types', 'long-page', 'artifact-type.json')));

  const settingsAfter = JSON.parse(fs.readFileSync(path.join(oaHome, 'settings.json'), 'utf8'));
  assert.equal(settingsAfter.otherSetting, 42);
  assert.equal(settingsAfter.typeRoots.extra.length, 2);
  assert.ok(settingsAfter.typeRoots.extra.includes(path.resolve(designHome, 'extra-types')));

  const second = syncBundledExtraTypes();
  assert.equal(second.settingsUpdated, false);
  const settingsRepeat = JSON.parse(fs.readFileSync(path.join(oaHome, 'settings.json'), 'utf8'));
  assert.equal(settingsRepeat.typeRoots.extra.length, 2);
});

test('HTTP voice workbench, humanizer, recipes, and next-issue linkage work under POST guard', async () => {
  // Cross-site POST guard on new endpoints
  const badCt = await fetch(`${base}/api/voice/save`, {
    method: 'POST',
    headers: { 'content-type': 'text/plain', origin: 'http://evil.example' },
    body: '{}',
  });
  assert.equal(badCt.status, 415);

  const badExpOrigin = await fetch(`${base}/api/export-render`, {
    method: 'POST',
    headers: postHeaders({ origin: 'http://evil.example' }),
    body: JSON.stringify({ format: 'html', content: { title: 'x', sections: [] } }),
  });
  assert.equal(badExpOrigin.status, 403);

  // Types API exposes social-cards & long-page as extra trusted
  const typesRes = await fetch(`${base}/api/types`).then((r) => r.json());
  const scType = typesRes.types.find((t) => t.id === 'social-cards');
  const lpType = typesRes.types.find((t) => t.id === 'long-page');
  assert.equal(scType?.scope, 'extra');
  assert.equal(scType?.trusted, true);
  assert.equal(lpType?.scope, 'extra');
  assert.equal(lpType?.trusted, true);

  // Save voice profile via HTTP
  const saveRes = await fetch(`${base}/api/voice/save`, {
    method: 'POST',
    headers: postHeaders(),
    body: JSON.stringify({ content: '# 我的语气档案\n\n## 句长与段落节奏\n- 结论先行，短句为主。\n' }),
  }).then((r) => r.json());
  assert.equal(saveRes.ok, true);
  assert.equal(saveRes.exists, true);

  // Scan sessions via mocked dependency (degraded vs ok)
  setVoiceScanDeps({
    execOrca: async (_bin, args) => {
      if (args[1] === 'list') {
        return { err: null, stdout: JSON.stringify({ ok: true, result: { agents: [{ orcaSessionId: 's-http', agent: 'claude', title: 'HTTP对话' }] } }) };
      }
      return { err: null, stdout: JSON.stringify({ ok: false, error: { code: 'agent_no_transcript' } }) };
    },
  });
  const scanRes = await fetch(`${base}/api/voice/scan-sessions`, {
    method: 'POST',
    headers: postHeaders(),
    body: '{}',
  }).then((r) => r.json());
  assert.equal(scanRes.ok, true);
  assert.equal(scanRes.degraded, true);

  // Humanize launch includes Humanizer-zh SKILL.md + voice profile
  const humRes = await fetch(`${base}/api/start`, {
    method: 'POST',
    headers: postHeaders(),
    body: JSON.stringify({ action: 'humanize', mode: 'review', text: '这不仅是一次升级，更是赋能未来的闭环。', useVoice: true }),
  }).then((r) => r.json());
  assert.equal(humRes.ok, true);
  assert.ok(humRes.starter.includes('vendor/humanizer-zh/SKILL.md'));
  assert.ok(humRes.starter.includes('仅审阅'));
  assert.ok(humRes.starter.includes('结论先行，短句为主'));

  // Next-issue x Voice Profile x Custom Type theme inheritance
  const createdCard = await createExample('social-cards', 'weekly-cards-01');
  assert.equal(createdCard.ok, true);
  const contentFile = path.join(createdCard.root, 'content.json');
  const contentObj = JSON.parse(fs.readFileSync(contentFile, 'utf8'));
  contentObj.theme = 'swiss-grid';
  contentObj.brandColor = '#1144AA';
  contentObj.format = 'wechat-21-9';
  fs.writeFileSync(contentFile, JSON.stringify(contentObj, null, 2));

  const col = createColumn(wsDir, { name: '每周卡片专栏', defaultType: 'social-cards' });
  assert.equal(col.ok, true);
  assignToColumn(wsDir, { root: createdCard.root, seriesId: col.column.seriesId, issueNumber: 1 });

  const niRes = await fetch(`${base}/api/start`, {
    method: 'POST',
    headers: postHeaders(),
    body: JSON.stringify({
      action: 'next-issue',
      seriesId: col.column.seriesId,
      referenceRoot: createdCard.root,
      skill: 'social-cards',
      inheritStyle: true,
      useVoice: true,
      humanizeFirst: true,
      topic: '第二期：对比卡片设计',
    }),
  }).then((r) => r.json());
  assert.equal(niRes.ok, true);
  assert.equal(niRes.issueNumber, 2);
  assert.ok(niRes.starter.includes('swiss-grid'));
  assert.ok(niRes.starter.includes('#1144AA'));
  assert.ok(niRes.starter.includes('wechat-21-9'));
  assert.ok(niRes.starter.includes('结论先行，短句为主'));
  assert.ok(niRes.starter.includes('humanizer-zh/SKILL.md'));

  // Purge requires confirm: true and physically removes profile
  const noConfirm = await fetch(`${base}/api/voice/purge`, {
    method: 'POST',
    headers: postHeaders(),
    body: '{}',
  });
  assert.equal(noConfirm.status, 400);

  const purged = await fetch(`${base}/api/voice/purge`, {
    method: 'POST',
    headers: postHeaders(),
    body: JSON.stringify({ confirm: true }),
  }).then((r) => r.json());
  assert.equal(purged.ok, true);
  const afterVoice = await fetch(`${base}/api/voice`).then((r) => r.json());
  assert.equal(afterVoice.exists, false);
});

test('POST /api/export-render supports standalone HTML, browser_missing fallback, and Mock CDP exports', async () => {
  // Reject file:// URL over HTTP
  const fileUrlRes = await fetch(`${base}/api/export-render`, {
    method: 'POST',
    headers: postHeaders(),
    body: JSON.stringify({ format: 'pdf', url: 'file:///etc/passwd' }),
  });
  assert.equal(fileUrlRes.status, 400);

  // Create a long-page artifact and export standalone HTML without Chrome
  const lpCreated = await createExample('long-page', 'long-demo-01');
  assert.equal(lpCreated.ok, true);
  const htmlExp = await fetch(`${base}/api/export-render`, {
    method: 'POST',
    headers: postHeaders(),
    body: JSON.stringify({ root: lpCreated.root, skill: 'long-page', format: 'html', scheme: 'dark' }),
  }).then((r) => r.json());
  assert.equal(htmlExp.ok, true);
  assert.equal(htmlExp.format, 'html');
  const htmlDecoded = Buffer.from(htmlExp.dataBase64, 'base64').toString('utf8');
  assert.ok(htmlDecoded.includes('data-resolved-theme="dark"'));

  // browser_missing graceful error
  setExportRenderDeps({ findChrome: () => null });
  const missingRes = await fetch(`${base}/api/export-render`, {
    method: 'POST',
    headers: postHeaders(),
    body: JSON.stringify({ root: lpCreated.root, skill: 'long-page', format: 'pdf' }),
  }).then((r) => r.json());
  assert.equal(missingRes.ok, false);
  assert.equal(missingRes.code, 'browser_missing');

  // Mock CDP long-png & pdf & social-cards cards-zip
  setExportRenderDeps(createMockCdp({ scrollHeight: 3600 }));
  const longPngRes = await fetch(`${base}/api/export-render`, {
    method: 'POST',
    headers: postHeaders(),
    body: JSON.stringify({ root: lpCreated.root, skill: 'long-page', format: 'long-png', width: 375, scheme: 'light' }),
  }).then((r) => r.json());
  assert.equal(longPngRes.ok, true);
  assert.equal(longPngRes.format, 'png');
  assert.equal(longPngRes.height, 3600);

  const scCreated = await createExample('social-cards', 'cards-export-01');
  const scContentPath = path.join(scCreated.root, 'content.json');
  const scData = JSON.parse(fs.readFileSync(scContentPath, 'utf8'));
  scData.cards.push({ id: 'card-2', layout: 'points', badge: '02 / 02', title: '第二卡', points: ['要点一'] });
  fs.writeFileSync(scContentPath, JSON.stringify(scData, null, 2));

  const zipRes = await fetch(`${base}/api/export-render`, {
    method: 'POST',
    headers: postHeaders(),
    body: JSON.stringify({ root: scCreated.root, skill: 'social-cards', format: 'cards-zip', preset: 'xhs-3-4' }),
  }).then((r) => r.json());
  assert.equal(zipRes.ok, true);
  assert.equal(zipRes.format, 'zip');
  assert.equal(zipRes.deviceScaleFactor, 2);
  const zipEntries = parseZipEntries(Buffer.from(zipRes.dataBase64, 'base64'));
  assert.deepEqual(zipEntries.map((e) => e.name), ['card-01.png', 'card-02.png']);
});

test('gallery HTML includes Stage 4 recipes, Humanizer, Voice workbench, and Export modal', () => {
  assert.equal(RECIPES.length, 8);
  for (const id of ['humanize-to-long-page', 'humanize-to-social-cards', 'long-page-and-cards', 'slides-to-long-page']) {
    assert.ok(RECIPES.some((r) => r.id === id), `Missing recipe ${id}`);
  }
  const html = galleryHtml('zh');
  assert.ok(html.includes('id="humanizeBtn"'));
  assert.ok(html.includes('id="voiceBtn"'));
  assert.ok(html.includes('id="editorExportBtn"'));
  assert.ok(html.includes('/api/export-render'));
  assert.ok(html.includes('/api/voice/purge'));
});

test.after(async () => {
  setExportRenderDeps({});
  setVoiceScanDeps({});
  server.closeAllConnections?.();
  await new Promise((resolve) => server.close(resolve));
  fs.rmSync(tmpDir, { recursive: true, force: true });
});
