import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';

const REPO_ROOT = path.resolve(import.meta.dirname, '..');

test('AC-10: dual-host (Orca + Agy) shares <workspace>/.design/ with isolated private homes and ownedEditorRoots cleanup', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'orca-dual-host-'));
  const wsDir = path.join(tmpDir, 'shared-workspace');
  const orcaHome = path.join(tmpDir, 'orca-home');
  const agyHome = path.join(tmpDir, 'agy-home');
  const orcaState = path.join(tmpDir, 'orca-state.json');
  fs.mkdirSync(wsDir, { recursive: true });
  fs.mkdirSync(orcaHome, { recursive: true });
  fs.mkdirSync(agyHome, { recursive: true });
  fs.writeFileSync(orcaState, JSON.stringify({ workspaceRoot: wsDir, workspaceName: 'shared-workspace', updatedAt: Date.now() }));

  // Simulated Agy peer service sharing the same workspace/.design/
  const agyPeer = http.createServer((req, res) => {
    res.setHeader('content-type', 'application/json');
    if (req.url === '/api/health') {
      return res.end(JSON.stringify({ ok: true, app: 'agy-plugin-design', pid: process.pid, workspaceRoot: wsDir }));
    }
    res.end(JSON.stringify({ ok: true }));
  });
  await new Promise((resolve) => agyPeer.listen(0, '127.0.0.1', resolve));
  const agyPort = agyPeer.address().port;

  // Create an Agy-authored work in <workspace>/.design/agy-deck
  const agyWorkRoot = path.join(wsDir, '.design', 'agy-deck');
  fs.mkdirSync(path.join(agyWorkRoot, 'project', 'slides'), { recursive: true });
  fs.writeFileSync(path.join(agyWorkRoot, 'project', 'deck.json'), JSON.stringify({
    v: 4,
    title: 'Agy Deck',
    lists: 'css',
    order: ['s1'],
    cover: 's1',
    sections: {},
    faces: {},
    designSystems: [],
  }));
  fs.writeFileSync(path.join(agyWorkRoot, 'project', 'slides', 's1.html'), '<section><h1>Agy</h1></section>');

  // Launch Orca gallery-server.mjs as a child process on an ephemeral port
  const orcaPort = 39800 + Math.floor(Math.random() * 150);
  const child = execFile(process.execPath, [path.join(REPO_ROOT, 'src', 'gallery-server.mjs')], {
    env: {
      ...process.env,
      PORT: String(orcaPort),
      ORCA_GALLERY_PORT: String(orcaPort),
      ORCA_DESIGN_HOME: orcaHome,
      ORCA_STATE_FILE: orcaState,
      ORCA_PROFILE_DB: path.join(tmpDir, 'missing.db'),
    },
  });

  const orcaBase = `http://127.0.0.1:${orcaPort}`;
  try {
    // Wait for Orca server health
    let healthy = false;
    for (let i = 0; i < 40; i++) {
      try {
        const r = await fetch(`${orcaBase}/api/health`);
        if (r.ok) {
          const h = await r.json();
          assert.equal(h.app, 'orca-plugin-design');
          healthy = true;
          break;
        }
      } catch {}
      await new Promise((r) => setTimeout(r, 50));
    }
    assert.equal(healthy, true, 'Orca gallery server started');

    // Verify Agy peer health remains distinct
    const agyH = await (await fetch(`http://127.0.0.1:${agyPort}/api/health`)).json();
    assert.equal(agyH.app, 'agy-plugin-design');

    // Orca scans Agy's work from shared <workspace>/.design/
    const listRes = await (await fetch(`${orcaBase}/api/list`)).json();
    assert.equal(listRes.ok, true);
    assert.ok(listRes.artifacts.some((a) => a.root === agyWorkRoot && a.title === 'Agy Deck'));

    // Orca creates its own work in shared <workspace>/.design/
    const orcaCreate = await (await fetch(`${orcaBase}/api/create`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: orcaBase, host: `127.0.0.1:${orcaPort}` },
      body: JSON.stringify({ skill: 'claude-design', name: 'orca-canvas' }),
    })).json();
    assert.equal(orcaCreate.ok, true);
    assert.equal(fs.existsSync(path.join(orcaCreate.root, 'project', 'canvas.json')), true);

    // Private homes remain strictly isolated
    assert.equal(fs.readdirSync(agyHome).length, 0, 'Agy private home untouched by Orca');
    assert.ok(fs.existsSync(path.join(orcaHome, 'artifacts')));

    // Start a real "Agy-owned" editor process on agyWorkRoot via artifact.mjs open
    const slidesCli = path.join(REPO_ROOT, 'vendor', 'baoyu-design', 'skills', 'claude-slides', 'scripts', 'artifact.mjs');
    const agyOpenOut = await new Promise((resolve, reject) => {
      execFile(process.execPath, [slidesCli, 'open', agyWorkRoot, '--port', '0'], { timeout: 15000 }, (err, stdout, stderr) => {
        if (err) reject(new Error(stderr || err.message));
        else resolve(stdout);
      });
    });
    const agyOpenJson = JSON.parse(agyOpenOut.match(/\{[\s\S]*"url"[\s\S]*\}/)[0]);

    try {
      // Orca opens shared agyWorkRoot -> reuses Agy's running editor (reused: true, NOT owned by Orca)
      const openShared = await (await fetch(`${orcaBase}/api/open`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', origin: orcaBase, host: `127.0.0.1:${orcaPort}` },
        body: JSON.stringify({ skill: 'claude-slides', root: agyWorkRoot }),
      })).json();
      assert.equal(openShared.ok, true);
      assert.equal(openShared.reused, true, 'Orca reuses Agy-started shared editor');
      assert.equal(openShared.url, agyOpenJson.url);

      // Orca opens its own editor on orcaCreate.root (reused: false, owned by Orca)
      const openOrca = await (await fetch(`${orcaBase}/api/open`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', origin: orcaBase, host: `127.0.0.1:${orcaPort}` },
        body: JSON.stringify({ skill: 'claude-design', root: orcaCreate.root }),
      })).json();
      assert.equal(openOrca.ok, true, `Orca opened its own editor: ${openOrca.url}`);
      assert.equal(openOrca.reused, false);

      // Shutdown Orca gallery server -> must stop Orca-owned editor, NOT Agy's reused editor or Agy peer
      const shut = await (await fetch(`${orcaBase}/api/shutdown`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', origin: orcaBase, host: `127.0.0.1:${orcaPort}` },
        body: '{}',
      })).json();
      assert.equal(shut.ok, true);

      await new Promise((r) => setTimeout(r, 300));
      const agyEditorProbe = await fetch(agyOpenJson.url, { signal: AbortSignal.timeout(1000) });
      assert.equal(agyEditorProbe.ok, true, 'Agy-owned reused editor must remain alive after Orca shutdown');
      assert.equal(agyPeer.listening, true, 'Agy peer gallery server must remain alive');

      // Verify Orca-owned editor was stopped (port no longer listening)
      let orcaEditorAlive = false;
      try {
        await fetch(openOrca.url, { signal: AbortSignal.timeout(300) });
        orcaEditorAlive = true;
      } catch {}
      assert.equal(orcaEditorAlive, false, 'Orca-owned editor stopped on /api/shutdown');
    } finally {
      await new Promise((resolve) => {
        execFile(process.execPath, [slidesCli, 'stop', agyWorkRoot], { timeout: 5000 }, () => resolve());
      });
    }
  } finally {
    try { child.kill('SIGKILL'); } catch {}
    await new Promise((resolve) => agyPeer.close(resolve));
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});
