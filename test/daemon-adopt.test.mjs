import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';

test('openSkillEditor lazily adopts .design/ project via Daemon API and returns Shell view_url', async (t) => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ps-daemon-adopt-'));
  const wsDir = path.join(tmpDir, 'ws');
  const designHome = path.join(tmpDir, 'orca-design');
  const oaHome = path.join(tmpDir, 'oa-home');
  const rtDir = path.join(tmpDir, 'oa-runtime');
  fs.mkdirSync(path.join(wsDir, '.design', 'my-slides', 'project'), { recursive: true });
  fs.mkdirSync(oaHome, { recursive: true });
  fs.mkdirSync(path.join(rtDir, 'scripts'), { recursive: true });
  fs.writeFileSync(path.join(wsDir, '.design', 'my-slides', 'project', 'deck.json'), JSON.stringify({ title: 'My Slides', order: ['s1'] }));
  fs.writeFileSync(path.join(rtDir, 'package.json'), JSON.stringify({ name: '@open-artifact/cli', version: '0.14.7', openArtifact: { protocols: { min: 1, max: 1 } } }));
  fs.writeFileSync(path.join(rtDir, 'scripts', 'open-artifact.mjs'), 'export {};\n');

  const token = 'test-daemon-token';
  const calls = [];
  let daemonUrl = '';
  const srv = http.createServer((req, res) => {
    const url = new URL(req.url || '/', 'http://127.0.0.1');
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8');
      let body = null;
      try { body = raw ? JSON.parse(raw) : null; } catch {}
      calls.push({ method: req.method, pathname: url.pathname, query: Object.fromEntries(url.searchParams), body });
      res.setHeader('Content-Type', 'application/json');
      if (url.pathname === '/__open-artifact/health') {
        return res.end(JSON.stringify({ openArtifact: 1, version: '0.14.7', pid: process.pid }));
      }
      if (req.headers.authorization !== `Bearer ${token}`) {
        res.statusCode = 401;
        return res.end(JSON.stringify({ code: 'not_granted', message: 'Token required' }));
      }
      if (url.pathname === '/api/open-artifact.types') {
        return res.end(JSON.stringify({ types: [{ id: 'slides', title: 'Slides', scope: 'builtin', trusted: true, enabled: true }] }));
      }
      if (url.pathname === '/api/open-artifact.artifacts.adopt') {
        return res.end(JSON.stringify({ url: 'open-artifact://artifact/art_slides1', folder: body?.folder }));
      }
      if (url.pathname === '/api/open-artifact.artifacts.open') {
        return res.end(JSON.stringify({
          ok: true,
          id: 'art_slides1',
          view_url: `${daemonUrl}/a/art_slides1`,
          page_url: `${daemonUrl}/a/art_slides1/page`,
        }));
      }
      if (url.pathname === '/api/open-artifact.artifacts.boot') {
        return res.end(JSON.stringify({ ok: true }));
      }
      res.statusCode = 404;
      return res.end(JSON.stringify({ code: 'not_found' }));
    });
  });

  await new Promise((resolve) => srv.listen(0, '127.0.0.1', resolve));
  const { port } = srv.address();
  daemonUrl = `http://127.0.0.1:${port}`;
  fs.writeFileSync(path.join(oaHome, 'daemon.json'), JSON.stringify({ url: daemonUrl, port, pid: process.pid, token, version: '0.14.7' }));

  t.after(async () => {
    srv.closeAllConnections?.();
    await new Promise((resolve) => srv.close(resolve));
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  process.env.ORCA_DESIGN_HOME = designHome;
  process.env.OPEN_ARTIFACT_HOME = oaHome;
  process.env.ORCA_DESIGN_OA_RUNTIME = rtDir;
  process.env.ORCA_DESIGN_NO_THUMB = '1';
  process.env.ORCA_STATE_FILE = path.join(tmpDir, 'state.json');
  fs.writeFileSync(process.env.ORCA_STATE_FILE, JSON.stringify({ workspaceRoot: wsDir, workspaceName: 'ws' }));

  const { openSkillEditor } = await import('../src/gallery-server.mjs');
  const res = await openSkillEditor('slides', path.join(wsDir, '.design', 'my-slides'));
  assert.equal(res.ok, true, JSON.stringify(res));
  assert.equal(res.id, 'art_slides1');
  assert.match(res.url, /\/a\/art_slides1/);
  assert.equal(res.embedMode, 'shell');
  assert.equal(res.l1Mode, true);
  assert.ok(calls.some((c) => c.pathname === '/api/open-artifact.artifacts.adopt'));
  assert.ok(calls.some((c) => c.pathname === '/api/open-artifact.artifacts.open'));
});
