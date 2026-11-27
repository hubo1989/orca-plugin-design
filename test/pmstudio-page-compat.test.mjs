import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { execFileSync } from 'node:child_process';

import { buildGalleryPageHtml } from '../src/gallery-ui.mjs';
import activateWorker from '../src/worker.js';

const REPO_ROOT = path.resolve(import.meta.dirname, '..');

function createMiniDom(html) {
  const ids = new Map();
  const listeners = new Map();
  const makeStyle = () => ({});
  const makeClassList = (el) => ({
    add: (...cls) => {
      const set = new Set((el.className || '').split(/\s+/).filter(Boolean));
      cls.forEach((c) => set.add(c));
      el.className = [...set].join(' ');
    },
    remove: (...cls) => {
      const set = new Set((el.className || '').split(/\s+/).filter(Boolean));
      cls.forEach((c) => set.delete(c));
      el.className = [...set].join(' ');
    },
    contains: (c) => (el.className || '').split(/\s+/).filter(Boolean).includes(c),
  });
  function createEl(tag, id = '', cls = '') {
    const attrs = new Map();
    const el = {
      tagName: tag.toUpperCase(),
      id,
      className: cls,
      style: makeStyle(),
      dataset: {},
      children: [],
      textContent: '',
      value: '',
      disabled: false,
      clientWidth: 800,
      isConnected: true,
      _innerHTML: '',
      shadowRoot: null,
      attributes: attrs,
      setAttribute(k, v) { attrs.set(k, String(v)); if (k === 'id') { el.id = String(v); ids.set(el.id, el); } },
      getAttribute(k) { return attrs.get(k) ?? null; },
      removeAttribute(k) { attrs.delete(k); },
      addEventListener() {},
      attachShadow() { el.shadowRoot = { innerHTML: '' }; return el.shadowRoot; },
      remove() { el.isConnected = false; ids.delete(el.id); },
      focus() {},
      select() {},
      scrollIntoView() {},
      closest() { return null; },
      querySelector(sel) { return el.querySelectorAll(sel)[0] || null; },
      querySelectorAll(sel) {
        if (sel === 'iframe') return [];
        const mAttr = /^\[data-plugin-thumb-root\]$|^img\[data-plugin-thumb-root\]$/.test(sel);
        if (mAttr) {
          const matches = [...el._innerHTML.matchAll(/data-plugin-thumb-root="([^"]+)"/g)];
          return matches.map((m) => createEl('img', '', 'bda-thumb hidden')._withAttr('data-plugin-thumb-root', m[1]));
        }
        return [];
      },
      _withAttr(k, v) { attrs.set(k, String(v)); return el; },
    };
    el.classList = makeClassList(el);
    Object.defineProperty(el, 'innerHTML', {
      get: () => el._innerHTML,
      set: (val) => {
        el._innerHTML = String(val);
        for (const m of el._innerHTML.matchAll(/\bid="([^"]+)"/g)) {
          if (!ids.has(m[1])) ids.set(m[1], createEl('div', m[1]));
        }
      },
    });
    if (id) ids.set(id, el);
    return el;
  }

  for (const m of html.matchAll(/\bid="([^"]+)"/g)) {
    createEl('div', m[1]);
  }
  const documentElement = createEl('html');
  documentElement.lang = 'zh-CN';
  const body = createEl('body');
  const document = {
    documentElement,
    body,
    getElementById: (id) => ids.get(id) || null,
    querySelector: (sel) => {
      if (sel === '.ds-lab-bar') return createEl('div', '', 'ds-lab-bar');
      if (sel === '.bda-rail') return createEl('aside', '', 'bda-rail');
      return null;
    },
    querySelectorAll: (sel) => {
      if (sel === 'iframe') {
        const hasEditorFrame = ids.has('frame') && ids.has('editorView');
        return hasEditorFrame ? [ids.get('frame')] : [];
      }
      return [];
    },
    createElement: (tag) => createEl(tag),
  };
  return { document, ids, listeners };
}

test('AC-13.1: manifest contributes.pages contract and sync-gallery-page --check', () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'orca-plugin.json'), 'utf8'));
  assert.equal(manifest.engines.orca, '>=1.4.274');
  assert.ok(Array.isArray(manifest.contributes.pages));
  assert.deepEqual(manifest.contributes.pages[0], {
    id: 'gallery',
    title: 'Design',
    icon: 'layers',
    entry: 'src/gallery-page.html',
    ui: 'html',
    sidebar: { placement: 'primary', order: 30 },
    layout: 'full-page',
  });

  execFileSync(process.execPath, [path.join(REPO_ROOT, 'tools', 'sync-gallery-page.mjs'), '--check'], {
    cwd: REPO_ROOT,
    stdio: 'pipe',
  });
  const diskPage = fs.readFileSync(path.join(REPO_ROOT, 'src', 'gallery-page.html'), 'utf8');
  assert.equal(diskPage, buildGalleryPageHtml());
});

test('AC-13.2: package.sh --target all produces valid pmstudio & orca targets', () => {
  const tmpDist = fs.mkdtempSync(path.join(os.tmpdir(), 'ps-dual-dist-'));
  const pmsDir = path.join(tmpDist, 'pmstudio-dist');
  const orcaDir = path.join(tmpDist, 'orca-dist');
  try {
    execFileSync('bash', [path.join(REPO_ROOT, 'bin', 'package.sh'), '--target', 'all'], {
      cwd: REPO_ROOT,
      env: { ...process.env, PLUGIN_DIST_DIR: pmsDir, PLUGIN_DIST_ORCA_DIR: orcaDir },
      stdio: 'pipe',
    });

    const pmsManifest = JSON.parse(fs.readFileSync(path.join(pmsDir, 'orca-plugin.json'), 'utf8'));
    assert.equal(pmsManifest.engines.orca, '>=1.4.274');
    assert.equal(pmsManifest.contributes.pages[0].id, 'gallery');
    assert.equal(fs.existsSync(path.join(pmsDir, 'src', 'gallery-page.html')), true);
    assert.equal(fs.existsSync(path.join(pmsDir, 'src', 'workspace-guard.mjs')), true);

    const orcaManifest = JSON.parse(fs.readFileSync(path.join(orcaDir, 'orca-plugin.json'), 'utf8'));
    assert.equal(orcaManifest.engines.orca, '>=1.4.248');
    assert.equal(orcaManifest.contributes.pages, undefined);
    assert.equal(fs.existsSync(path.join(orcaDir, 'src', 'workspace-guard.mjs')), true);

    const pmsBin = '/Applications/LKL-PMStudio.app/Contents/Resources/bin/pms';
    if (fs.existsSync(pmsBin)) {
      const out = execFileSync(pmsBin, ['plugin', 'validate', pmsDir, '--json'], { encoding: 'utf8' });
      const parsed = JSON.parse(out);
      assert.equal(parsed.result?.valid, true);
      assert.deepEqual(parsed.result?.warnings || [], []);
    }

    const orcaBin = '/Applications/Orca.app/Contents/Resources/bin/orca';
    if (fs.existsSync(orcaBin)) {
      const out = execFileSync(orcaBin, ['plugin', 'validate', orcaDir, '--json'], { encoding: 'utf8' });
      const parsed = JSON.parse(out);
      assert.equal(parsed.result?.valid, true);
    }
  } finally {
    fs.rmSync(tmpDist, { recursive: true, force: true });
  }
});

test('AC-13.3: gallery-page.html bridge mode uses zero fetch and zero iframes under CSP', async () => {
  const html = fs.readFileSync(path.join(REPO_ROOT, 'src', 'gallery-page.html'), 'utf8');
  const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
  assert.equal(scripts.length, 2);

  const { document, ids } = createMiniDom(html);
  const requests = [];
  const events = new Map();
  let artifacts = [
    {
      root: '/tmp/ws/.design/deck-1',
      skill: 'claude-slides',
      title: 'Deck One',
      openedAt: new Date().toISOString(),
      firstOpenedAt: new Date().toISOString(),
      pinned: false,
      shared: false,
      deletable: true,
      meta: '3 页',
      note: '',
      tail: '.design/deck-1',
      openable: true,
      missing: false,
      inCurrentWorkspace: true,
      preview: true,
      thumb: true,
    },
  ];

  const windowObj = {
    document,
    location: { search: '', hash: '', pathname: '/', pathnameWithSearch: '/' },
    history: { state: {}, replaceState() {}, pushState() {} },
    addEventListener() {},
    open() {},
    orca: {
      plugin: {
        request: async (method, input) => {
          requests.push({ method, input });
          if (method === 'studio.gallery.api') {
            const route = input.route;
            if (route === '/api/list') {
              return { ok: true, workspaceRoot: '/tmp/ws', workspaceName: 'ws', artifacts };
            }
            if (route === '/api/create') {
              const newItem = {
                ...artifacts[0],
                root: '/tmp/ws/.design/demo-2',
                title: 'Demo 2',
              };
              artifacts = [...artifacts, newItem];
              return { ok: true, root: newItem.root, title: newItem.title };
            }
            if (route === '/api/update') {
              artifacts[0].title = input.body.title || artifacts[0].title;
              return { ok: true, root: artifacts[0].root, title: artifacts[0].title };
            }
            if (route === '/api/delete') {
              artifacts = [];
              return { ok: true, moved: true, trash: 'abc123-1' };
            }
            if (route === '/api/restore') {
              artifacts = [{ ...artifacts[0] || {}, root: '/tmp/ws/.design/deck-1', skill: 'claude-slides', title: 'Deck One', openedAt: new Date().toISOString(), inCurrentWorkspace: true, missing: false, thumb: true }];
              return { ok: true, record: artifacts[0] };
            }
          }
          if (method === 'studio.gallery.thumb') {
            return { ok: true, dataUrl: 'data:image/png;base64,iVBORw0KGgo=' };
          }
          if (method === 'studio.editor.open') {
            return { ok: true, url: 'http://127.0.0.1:4710', pageId: 'tab-1', reused: false, mode: 'workspace-tab' };
          }
          return { ok: true };
        },
      },
      on: (evt, fn) => { events.set(evt, fn); },
    },
  };
  windowObj.window = windowObj;

  let fetchCalls = 0;
  const ctx = vm.createContext({
    ...windowObj,
    fetch: async () => { fetchCalls++; throw new Error('fetch forbidden in PluginPageHost'); },
    navigator: { clipboard: { writeText: async () => {} } },
    history: windowObj.history,
    location: windowObj.location,
    localStorage: { getItem: () => { throw new Error('sandbox'); }, setItem: () => { throw new Error('sandbox'); } },
    setTimeout,
    clearTimeout,
    URL,
    URLSearchParams,
    Intl,
    Map,
    Set,
    Promise,
    Date,
    Object,
    Array,
    JSON,
    Math,
    Number,
    String,
    Boolean,
    RegExp,
    encodeURIComponent,
  });

  vm.runInContext(scripts[1], ctx);
  await new Promise((r) => setTimeout(r, 30));

  assert.equal(fetchCalls, 0, 'PluginPageHost must never call window.fetch');
  assert.equal(document.querySelectorAll('iframe').length, 0, 'PluginPageHost must render 0 iframes');
  assert.ok(requests.some((r) => r.method === 'studio.gallery.api' && r.input.route === '/api/list'));
  assert.ok(requests.some((r) => r.method === 'studio.gallery.thumb'));
  assert.equal(ids.get('openInTabBtn').classList.contains('hidden'), false);

  await vm.runInContext('openItem(state.artifacts[0])', ctx);
  assert.ok(requests.some((r) => r.method === 'studio.editor.open'));

  const beforeWsChange = requests.filter((r) => r.method === 'studio.gallery.api' && r.input.route === '/api/list').length;
  events.get('workspace.changed')?.();
  await new Promise((r) => setTimeout(r, 20));
  const afterWsChange = requests.filter((r) => r.method === 'studio.gallery.api' && r.input.route === '/api/list').length;
  assert.ok(afterWsChange > beforeWsChange, 'workspace.changed triggers reload');

  // Verify delete + 10s toast undo button flow
  await vm.runInContext('showToast("moved", "abc123-1")', ctx);
  await ids.get('toastUndoBtn').onclick();
  assert.ok(requests.some((r) => r.method === 'studio.gallery.api' && r.input.route === '/api/restore'));
});

test('AC-13.4: worker routes prototype.gallery via navigation.openPage on PMStudio and falls back to openGalleryTab on Orca', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'orca-pms-worker-'));
  const wsDir = path.join(tmpDir, 'ws');
  fs.mkdirSync(wsDir, { recursive: true });
  const mockCli = path.join(tmpDir, 'mock-cli.mjs');
  fs.writeFileSync(mockCli, `#!/usr/bin/env node
const argv = process.argv.slice(2);
if (argv[1] === 'list') console.log(JSON.stringify({ ok: true, result: { tabs: [] } }));
else if (argv[1] === 'create') console.log(JSON.stringify({ ok: true, result: { browserPageId: 'p1' } }));
else if (argv[1] === 'switch') console.log(JSON.stringify({ ok: true, result: { browserPageId: 'p1' } }));
else if (argv[1] === 'current') console.log(JSON.stringify({ ok: true, result: { tab: { browserPageId: 'p1' } } }));
else console.log(JSON.stringify({ ok: true, result: {} }));
`, { mode: 0o755 });

  process.env.ORCA_CLI_COMMAND = mockCli;
  process.env.ORCA_STATE_FILE = path.join(tmpDir, 'state.json');
  process.env.ORCA_PROFILE_DB = path.join(tmpDir, 'missing.db');
  process.env.ORCA_DESIGN_HOME = path.join(tmpDir, 'design-home');
  process.env.ORCA_GALLERY_SCRIPT = '/dev/null';
  process.env.ORCA_GALLERY_PORT = String(39200 + Math.floor(Math.random() * 500));

  try {
    // 1. PMStudio host with navigation.openPage
    let openPageCalls = 0;
    let openPageReturn = { opened: true };
    const cmds1 = new Map();
    const h1 = await activateWorker({
      log: () => {},
      commands: Object.freeze({ register: (id, fn) => cmds1.set(id, fn) }),
      panels: Object.freeze({ handle: () => {} }),
      events: Object.freeze({ on: () => {} }),
      navigation: { openPage: async (id) => { openPageCalls++; assert.equal(id, 'gallery'); return openPageReturn; } },
      host: Object.freeze({
        has: (cap) => cap === 'navigation.openPage',
        call: async (m) => (m === 'workspace.list' ? { workspaces: [{ path: wsDir, name: 'ws', branch: 'main', kind: 'local' }] } : {}),
      }),
    });
    const t0 = performance.now();
    const resPms = await cmds1.get('prototype.gallery')();
    const elapsed = performance.now() - t0;
    assert.equal(openPageCalls, 1);
    assert.deepEqual(resPms, { ok: true, mode: 'plugin-page', pageId: 'gallery' });
    assert.ok(elapsed < 100, `openPage fast path (${elapsed}ms)`);

    // Fallback when host sidebar hides plugin pages ({ opened: false })
    openPageReturn = { opened: false };
    const resFallback = await cmds1.get('prototype.gallery')();
    assert.equal(resFallback.ok, true);
    assert.equal(resFallback.pageId, 'p1');
    h1.dispose();

    // 2. Upstream Orca host without navigation.openPage
    const cmds2 = new Map();
    const h2 = await activateWorker({
      log: () => {},
      commands: Object.freeze({ register: (id, fn) => cmds2.set(id, fn) }),
      panels: Object.freeze({ handle: () => {} }),
      events: Object.freeze({ on: () => {} }),
      host: Object.freeze({
        has: () => false,
        call: async (m) => (m === 'workspace.list' ? { workspaces: [{ path: wsDir, name: 'ws', branch: 'main', kind: 'local' }] } : {}),
      }),
    });
    const resOrca = await cmds2.get('prototype.gallery')();
    assert.equal(resOrca.ok, true);
    assert.equal(resOrca.pageId, 'p1');
    h2.dispose();
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});
