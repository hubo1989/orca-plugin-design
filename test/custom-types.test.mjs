// SPDX-License-Identifier: MIT
// Pure Node / Mock CDP tests for custom-types/social-cards, custom-types/long-page, and src/export-render.mjs.
// Note: Real headless Chromium screenshot/raster smoke tests are deferred to non-sandbox Stage 5 QA (RFC R5).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { inflateRawSync } from 'node:zlib';

import {
  CARD_PRESETS,
  MAX_LONG_PNG_HEIGHT,
  buildZip,
  exportRender,
  findChrome,
  renderLongPageStandaloneHtml,
  validateExportRequest,
} from '../src/export-render.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..');
const CUSTOM_TYPES_DIR = path.join(REPO_ROOT, 'custom-types');

const UUID_V4_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const BACKED_CAPS = new Set(['db', 'artifact', 'assets', 'downloads', 'comments', 'user', 'room', 'permissions', 'network']);
const FORBIDDEN_PATTERNS = [
  /AGPL/i,
  /Anthropic's intellectual property/i,
  /LicenseRef-Mixed/i,
  /fonts\.googleapis\.com/i,
  /fonts\.gstatic\.com/i,
  /cdn\.jsdelivr\.net/i,
  /unpkg\.com/i,
  /cdnjs\.cloudflare\.com/i,
  /dsh-guizang-design/i,
];

function walkFiles(dir, rootDir = dir, out = []) {
  for (const name of fs.readdirSync(dir)) {
    const full = path.join(dir, name);
    const st = fs.lstatSync(full);
    assert.equal(st.isSymbolicLink(), false, `Symlink forbidden in custom-types: ${full}`);
    assert.equal(name.startsWith('.'), false, `Dotfile forbidden in custom-types: ${full}`);
    if (st.isDirectory()) walkFiles(full, rootDir, out);
    else out.push({ full, rel: path.relative(rootDir, full), size: st.size });
  }
  return out;
}

function parseDeclarationBlock(html) {
  const start = html.indexOf('// artifact.json');
  assert.ok(start >= 0, 'index.html must contain // artifact.json declaration marker');
  const after = html.slice(start + '// artifact.json'.length);
  const endMatch = /\n[ \t]*\/\/[^\n]*/.exec(after);
  assert.ok(endMatch, 'Declaration block must terminate with a // comment line');
  const block = after.slice(0, endMatch.index);
  assert.equal(/\b(?:let|const)\b/.test(block), false, 'Declaration block must use var only, never let/const');
  assert.ok(/\bvar\s+key\s*=/.test(block), 'Declaration block must define var key');
  assert.ok(/\bvar\s+capabilities\s*=/.test(block), 'Declaration block must define var capabilities');
  const fn = new Function(`${block}\nreturn { key, capabilities, monitoring };`);
  return fn();
}

function parseFrontmatter(md) {
  const match = /^---\r?\n([\s\S]*?)\r?\n---/.exec(md);
  assert.ok(match, 'SKILL.md must begin with YAML frontmatter');
  const body = match[1];
  assert.ok(/^name:\s*\S+/m.test(body), 'SKILL.md frontmatter must have name');
  assert.ok(/^description:\s*\S+/m.test(body), 'SKILL.md frontmatter must have description');
  return body;
}

function createMockCdp({ scrollHeight = 4200 } = {}) {
  const calls = [];
  let cardIndex = 0;
  return {
    calls,
    async connectCdp() {
      return {
        async send(method, params = {}) {
          calls.push({ method, params });
          if (method === 'Target.createTarget') return { targetId: 'mock-target-1' };
          if (method === 'Target.attachToTarget') return { sessionId: 'mock-session-1' };
          if (method === 'Page.navigate') return {};
          if (method === 'Runtime.evaluate') {
            if (params.expression?.includes('scrollHeight')) {
              return { result: { value: scrollHeight } };
            }
            const cardMatch = /setCard\((\d+)/.exec(params.expression || '');
            if (cardMatch) cardIndex = Number(cardMatch[1]);
            return { result: { value: true } };
          }
          if (method === 'Page.captureScreenshot') {
            const payload = Buffer.from(`MOCK_PNG_CARD_${cardIndex}_${params.clip ? `${params.clip.y}_${params.clip.height}` : 'full'}`);
            return { data: payload.toString('base64') };
          }
          if (method === 'Page.printToPDF') {
            return { data: Buffer.from('%PDF-1.4\n%MockPDF\n%%EOF').toString('base64') };
          }
          return {};
        },
        onEvent(fn) {
          setTimeout(() => fn({ sessionId: 'mock-session-1', method: 'Page.loadEventFired' }), 5);
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
    const compressed = zipBuf.slice(dataStart, dataStart + compressedSize);
    entries.push({ name, data: inflateRawSync(compressed) });
    offset = dataStart + compressedSize;
  }
  return entries;
}

test('custom-types/social-cards & long-page comply with Open Artifact share schema, MIT license, and lightweight limits', () => {
  let totalBytes = 0;
  for (const typeId of ['social-cards', 'long-page']) {
    const dir = path.join(CUSTOM_TYPES_DIR, typeId);
    assert.ok(fs.existsSync(dir), `${typeId} directory must exist`);
    const files = walkFiles(dir);
    assert.ok(files.length <= 2000, `${typeId} must stay within 2000 file limit`);

    const relNames = new Set(files.map((f) => f.rel.replace(/\\/g, '/')));
    for (const required of ['LICENSE', 'artifact-type.json', 'icon.svg', 'SKILL.md', 'index.html', 'artifact-type/style.css', 'artifact-type/app.js']) {
      assert.ok(relNames.has(required), `${typeId} missing ${required}`);
    }

    const licenseText = fs.readFileSync(path.join(dir, 'LICENSE'), 'utf8');
    assert.ok(licenseText.includes('MIT License'), `${typeId}/LICENSE must declare MIT License`);

    const manifest = JSON.parse(fs.readFileSync(path.join(dir, 'artifact-type.json'), 'utf8'));
    assert.equal(manifest.slug, typeId);
    assert.match(manifest.uid, UUID_V4_RE);
    assert.ok(typeof manifest.name === 'string' && manifest.name.trim().length > 0);
    assert.ok(typeof manifest.version === 'string' && manifest.version.trim().length > 0);
    assert.ok(typeof manifest.description === 'string' && manifest.description.trim().length > 0);
    assert.equal(manifest.entry, undefined, `${typeId} must not declare entry.start or entry.url`);
    assert.equal(manifest.openArtifact?.network, undefined, `${typeId} must not declare external network origins`);
    assert.ok(manifest.i18n?.en?.name, `${typeId} should include English i18n metadata`);

    const skillMd = fs.readFileSync(path.join(dir, 'SKILL.md'), 'utf8');
    const fm = parseFrontmatter(skillMd);
    assert.ok(fm.includes(`name: ${typeId}`), `${typeId}/SKILL.md frontmatter name must match ${typeId}`);

    const html = fs.readFileSync(path.join(dir, 'index.html'), 'utf8');
    const decl = parseDeclarationBlock(html);
    assert.equal(decl.key, typeId);
    for (const capName of Object.keys(decl.capabilities)) {
      assert.ok(BACKED_CAPS.has(capName), `${typeId} declared non-backed capability: ${capName}`);
    }
    assert.equal(/(?:^|\n)\s*(?:const|let|class|function)\s+openArtifact\b/.test(html), false);

    for (const f of files) {
      totalBytes += f.size;
      assert.ok(!/\.(?:ttf|otf|woff2?)$/i.test(f.full), `Bundled font file forbidden: ${f.full}`);
      const content = fs.readFileSync(f.full, 'utf8');
      for (const bad of FORBIDDEN_PATTERNS) {
        assert.equal(bad.test(content), false, `Forbidden pattern ${bad} found in ${f.full}`);
      }
    }
  }
  assert.ok(totalBytes < 512 * 1024, `custom-types total size (${totalBytes} bytes) must remain lightweight (< 512 KiB)`);
});

test('social-cards & long-page domain features are present in source', () => {
  const scApp = fs.readFileSync(path.join(CUSTOM_TYPES_DIR, 'social-cards/artifact-type/app.js'), 'utf8');
  const scCss = fs.readFileSync(path.join(CUSTOM_TYPES_DIR, 'social-cards/artifact-type/style.css'), 'utf8');
  assert.ok(scApp.includes('xhs-3-4') && scApp.includes('wechat-21-9') && scApp.includes('square-1-1') && scApp.includes('matrix'));
  assert.ok(scApp.includes('constrainBrandColor') && scApp.includes('measureOverflows') && scApp.includes('persistContent'));
  assert.ok(scCss.includes('editorial-light') && scCss.includes('warm-paper') && scCss.includes('editorial-dark') && scCss.includes('swiss-grid'));

  const lpSkill = fs.readFileSync(path.join(CUSTOM_TYPES_DIR, 'long-page/SKILL.md'), 'utf8');
  const lpCss = fs.readFileSync(path.join(CUSTOM_TYPES_DIR, 'long-page/artifact-type/style.css'), 'utf8');
  const lpApp = fs.readFileSync(path.join(CUSTOM_TYPES_DIR, 'long-page/artifact-type/app.js'), 'utf8');
  assert.ok(lpSkill.includes('faithful') && lpSkill.includes('digest'));
  assert.ok(lpCss.includes('max-inline-size: 36em') && lpCss.includes('line-height: 1.7') && lpCss.includes('@media print'));
  assert.ok(lpApp.includes('buildStandaloneHtml') && lpApp.includes('window.print()'));
});

test('findChrome prioritizes OPEN_ARTIFACT_CHROME, system browsers, and Playwright Chromium cache', () => {
  const existing = new Set(['/opt/custom/chrome']);
  assert.equal(
    findChrome({
      env: { OPEN_ARTIFACT_CHROME: '/opt/custom/chrome' },
      existsSync: (p) => existing.has(p),
    }),
    '/opt/custom/chrome',
  );
  assert.equal(
    findChrome({
      env: { OPEN_ARTIFACT_CHROME: '/opt/custom/missing-chrome' },
      existsSync: (p) => existing.has(p),
    }),
    null,
  );

  // System browser on Linux
  assert.equal(
    findChrome({
      env: {},
      platform: 'linux',
      existsSync: (p) => p === '/usr/bin/chromium',
    }),
    '/usr/bin/chromium',
  );

  // Playwright Chromium cache fallback (picks newest revision)
  const pwRoot = '/mock-home/.cache/ms-playwright';
  const pwOlder = `${pwRoot}/chromium-1140/chrome-linux/chrome`;
  const pwNewer = `${pwRoot}/chromium-1161/chrome-linux/chrome`;
  assert.equal(
    findChrome({
      env: {},
      platform: 'linux',
      homeDir: '/mock-home',
      existsSync: (p) => p === pwRoot || p === pwOlder || p === pwNewer,
      readdirSync: () => ['chromium-1140', 'chromium-1161'],
    }),
    pwNewer,
  );

  // Returns null cleanly when no browser exists
  assert.equal(
    findChrome({
      env: {},
      platform: 'linux',
      homeDir: '/empty-home',
      existsSync: () => false,
      readdirSync: () => [],
    }),
    null,
  );
});

test('validateExportRequest enforces formats, loopback URLs, dimensions, and DPR', () => {
  assert.equal(validateExportRequest(null).ok, false);
  assert.equal(validateExportRequest({ format: 'exe', url: 'http://127.0.0.1:3480' }).code, 'invalid_argument');
  assert.equal(validateExportRequest({ format: 'pdf', url: 'https://evil.example.com/x' }).code, 'invalid_argument');
  assert.equal(validateExportRequest({ format: 'png', url: 'http://127.0.0.1:3480', width: 100 }).code, 'invalid_argument');
  assert.equal(validateExportRequest({ format: 'png', url: 'http://127.0.0.1:3480', deviceScaleFactor: 5 }).code, 'invalid_argument');
  assert.equal(validateExportRequest({ format: 'pdf', url: 'http://127.0.0.1:3480', scheme: 'sepia' }).code, 'invalid_argument');

  const okPreset = validateExportRequest({ format: 'cards-png', url: 'http://127.0.0.1:3480/card', preset: 'wechat-21-9' });
  assert.equal(okPreset.ok, true);
  assert.equal(okPreset.width, CARD_PRESETS['wechat-21-9'].width);
  assert.equal(okPreset.height, CARD_PRESETS['wechat-21-9'].height);
});

test('exportRender degrades cleanly with browser_missing when no Chromium is available', async () => {
  const res = await exportRender(
    { format: 'pdf', url: 'http://127.0.0.1:3480/demo' },
    { findChrome: () => null },
  );
  assert.equal(res.ok, false);
  assert.equal(res.code, 'browser_missing');
  assert.ok(res.hint.includes('OPEN_ARTIFACT_CHROME'));
  assert.ok(res.fallback.includes('HTML'));
});

test('exportRender builds 2x cards PNG/ZIP, >2160px long PNG, sliced ZIP, and PDF over Mock CDP', async () => {
  // 1. Multi-card 2x PNG -> ZIP
  const cdpCards = createMockCdp();
  const zipRes = await exportRender(
    {
      format: 'cards-zip',
      url: 'http://127.0.0.1:3480/social',
      preset: 'xhs-3-4',
      cards: [
        { index: 0, width: 1080, height: 1440, filename: 'card-01.png' },
        { index: 1, width: 1080, height: 1440, filename: 'card-02.png' },
      ],
    },
    cdpCards,
  );
  assert.equal(zipRes.ok, true);
  assert.equal(zipRes.format, 'zip');
  assert.equal(zipRes.deviceScaleFactor, 2);
  const zipFiles = parseZipEntries(zipRes.buffer);
  assert.deepEqual(zipFiles.map((f) => f.name), ['card-01.png', 'card-02.png']);
  assert.equal(zipFiles[0].data.toString('utf8'), 'MOCK_PNG_CARD_0_full');
  assert.equal(zipFiles[1].data.toString('utf8'), 'MOCK_PNG_CARD_1_full');
  const dprCall = cdpCards.calls.find((c) => c.method === 'Emulation.setDeviceMetricsOverride');
  assert.equal(dprCall.params.deviceScaleFactor, 2);

  // 2. Long PNG breaking 2160px ceiling (4200px single captureBeyondViewport)
  const cdpLong = createMockCdp({ scrollHeight: 4200 });
  const longRes = await exportRender(
    { format: 'long-png', url: 'http://127.0.0.1:3480/article', width: 375, scheme: 'dark' },
    cdpLong,
  );
  assert.equal(longRes.ok, true);
  assert.equal(longRes.format, 'png');
  assert.equal(longRes.width, 375);
  assert.equal(longRes.height, 4200);
  const capCall = cdpLong.calls.find((c) => c.method === 'Page.captureScreenshot');
  assert.equal(capCall.params.captureBeyondViewport, true);
  assert.deepEqual(capCall.params.clip, { x: 0, y: 0, width: 375, height: 4200, scale: 1 });

  // 3. Extra-long PNG (>16384px) auto-slices into ZIP
  const cdpUltraLong = createMockCdp({ scrollHeight: MAX_LONG_PNG_HEIGHT + 1200 });
  const slicedRes = await exportRender(
    { format: 'long-png', url: 'http://127.0.0.1:3480/article', width: 375 },
    cdpUltraLong,
  );
  assert.equal(slicedRes.ok, true);
  assert.equal(slicedRes.format, 'zip');
  assert.equal(slicedRes.sliced, true);
  assert.equal(slicedRes.sliceCount, 2);
  const slicedEntries = parseZipEntries(slicedRes.buffer);
  assert.deepEqual(slicedEntries.map((f) => f.name), ['page-01.png', 'page-02.png']);

  // 4. Paginated PDF
  const cdpPdf = createMockCdp();
  const pdfRes = await exportRender(
    { format: 'pdf', url: 'http://127.0.0.1:3480/article', scheme: 'light' },
    cdpPdf,
  );
  assert.equal(pdfRes.ok, true);
  assert.equal(pdfRes.format, 'pdf');
  assert.ok(pdfRes.buffer.toString('utf8').startsWith('%PDF-1.4'));
});

test('buildZip and renderLongPageStandaloneHtml work offline with XSS escaping and no external CDNs', async () => {
  const zip = buildZip([
    { name: 'hello.txt', data: Buffer.from('你好世界', 'utf8') },
  ]);
  const parsed = parseZipEntries(zip);
  assert.equal(parsed.length, 1);
  assert.equal(parsed[0].name, 'hello.txt');
  assert.equal(parsed[0].data.toString('utf8'), '你好世界');

  const htmlRes = await exportRender({
    format: 'html',
    scheme: 'dark',
    content: {
      title: '测试长文 <script>alert(1)</script>',
      subtitle: '副标题',
      mode: 'digest',
      author: 'Hubert',
      summaryCard: { heading: '核心结论', bullets: ['条目一'] },
      sections: [
        {
          id: 's1',
          heading: '章节一',
          blocks: [
            { type: 'paragraph', text: '正文包含“弯引号”……——以及英文混排。' },
            { type: 'code', lang: 'js', code: 'const x = "<img onerror=1>";' },
          ],
        },
      ],
    },
  });
  assert.equal(htmlRes.ok, true);
  const outHtml = htmlRes.buffer.toString('utf8');
  assert.ok(outHtml.includes('<!doctype html>'));
  assert.ok(outHtml.includes('data-resolved-theme="dark"'));
  assert.ok(outHtml.includes('max-inline-size: 36em'));
  assert.equal(outHtml.includes('<script>alert(1)</script>'), false, 'HTML export must escape title');
  assert.equal(/https?:\/\/(?:fonts\.googleapis|cdn\.jsdelivr|unpkg\.com)/.test(outHtml), false);

  const direct = renderLongPageStandaloneHtml({ title: 'Direct', sections: [] });
  assert.ok(direct.includes('<title>Direct</title>'));
});
