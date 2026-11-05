#!/usr/bin/env node
// Prototype Studio · 独立项目库服务（detached，固定 3480）
// worker 被 Orca 按 idle 回收时本进程不受影响；共享状态文件由 worker 写入。
import { execFile, execFileSync } from 'node:child_process';
import http from 'node:http';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const pluginRoot = path.dirname(path.dirname(__filename));
const STATE_FILE = path.join(os.tmpdir(), 'prototype-studio-state.json');
const ORCA_BIN = process.env.ORCA_CLI_COMMAND || '/Applications/Orca.app/Contents/Resources/bin/orca';
const BAOYU_SKILLS_DIR = path.join(pluginRoot, 'vendor', 'baoyu-design', 'skills');
const PORT = 3480;

const SKILL_META = [
  { id: 'claude-design', name: '画布', icon: '🎨', port: 3470 },
  { id: 'claude-slides', name: '幻灯片', icon: '🖼️', port: 3471 },
  { id: 'claude-design-system', name: '设计系统', icon: '🧩', port: 3473 },
  { id: 'claude-motion', name: '动效影片', icon: '🎬', port: 3474 },
];
const ROOT_MARKERS = {
  'claude-design': ['project/canvas.json'],
  'claude-slides': ['project/deck.json'],
  'claude-design-system': ['project/design-system.json'],
  'claude-motion': ['project/scenes.json', 'project/voice.json'],
};
const EXAMPLE_TEMPLATES = JSON.parse(fs.readFileSync(path.join(pluginRoot, 'src', 'examples.json'), 'utf8'));


// 真实安装路径：Orca 把插件复制到 <userData>/plugins/<pluginKey>/<hash>/。
// 只有工作区等于/位于安装根目录内部时才拒绝写入；源码 worktree、dist 打包源都不是安装路径。
function installRoot() {
  const home = process.env.HOME || os.homedir();
  if (process.platform === 'darwin') return path.join(home, 'Library', 'Application Support', 'orca', 'plugins');
  if (process.platform === 'win32') return path.join(process.env.APPDATA || path.join(home, 'AppData', 'Roaming'), 'orca', 'plugins');
  return path.join(process.env.XDG_CONFIG_HOME || path.join(home, '.config'), 'orca', 'plugins');
}
function isInstalledPluginPath(target) {
  const root = path.resolve(installRoot());
  const p = path.resolve(String(target || ''));
  return p === root || p.startsWith(root + path.sep);
}

// 直接读 Orca profile 库的 activeWorktreeId（权威焦点标识），
// 不再依赖插件 worker 写状态文件——worker 会被回收、旧版插件也不会写。
const PROFILE_DB = path.join(process.env.HOME || os.homedir(), 'Library', 'Application Support', 'orca', 'profiles', 'local-default', 'profile-state.db');

function readState() {
  // 优先用 worker 写的显式状态（正常安装版）；但为空时回退到 profile 库。
  let explicit = {};
  try { explicit = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')); } catch {}
  if (explicit.workspaceRoot) return explicit;
  try {
    const raw = fs.readFileSync(PROFILE_DB);
    const text = raw.toString('utf8'); // WAL 未合并时可能读不到最新值，下面用 sqlite3 CLI 兜底
    const m = text.match(/activeWorktreeId"\s*:\s*"[^"]*::([^"\\]+)"/);
    if (m) {
      const p = m[1].replace(/\\u002F/g, '/').replace(/\\\\/g, '/');
      return { workspaceRoot: p, workspaceName: p.split('/').filter(Boolean).pop() || '' };
    }
  } catch {}
  // 兜底：sqlite3 CLI 读 workspaceSession（含 WAL）
  try {
    const out = execFileSync('sqlite3', [PROFILE_DB,
      "SELECT payload FROM profile_state_documents WHERE domain='workspaceSession'"], { timeout: 3000, encoding: 'utf8' });
    const ws = JSON.parse(out);
    const id = ws.activeWorktreeId || '';
    const p = id.includes('::') ? id.split('::').pop() : '';
    if (p) return { workspaceRoot: p, workspaceName: p.split('/').filter(Boolean).pop() || '' };
  } catch {}
  return { workspaceRoot: '', workspaceName: '' };
}

function artifactCli(skillId) { return path.join(BAOYU_SKILLS_DIR, skillId, 'scripts', 'artifact.mjs'); }
function runNode(args) {
  return new Promise((resolve) => {
    execFile(process.execPath, args, { timeout: 30000 }, (err, stdout, stderr) =>
      resolve({ err, stdout: String(stdout || ''), stderr: String(stderr || '') }));
  });
}

function esc(v) {
  return String(v ?? '').replace(/[&<>"']/g, (c) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

function projectMeta(skillId, root) {
  // 画板数 / 幻灯片数 / 场景数等徽标数据
  const read = (rel) => { try { return JSON.parse(fs.readFileSync(path.join(root, rel), 'utf8')); } catch { return null; } };
  if (skillId === 'claude-design') {
    const c = read('project/canvas.json');
    return c ? `${Object.keys(c.boards || {}).length} 画板` : '';
  }
  if (skillId === 'claude-slides') {
    const d = read('project/deck.json');
    return d ? `${(d.order || []).length} 页` : '';
  }
  if (skillId === 'claude-motion') {
    const sc = read('project/scenes.json');
    return sc ? `${Array.isArray(sc) ? sc.length : Object.keys(sc).length} 场景` : '';
  }
  if (skillId === 'claude-design-system') {
    try {
      return `${fs.readdirSync(path.join(root, 'project', 'components'), { withFileTypes: true }).filter((e) => e.isDirectory()).length} 组件`;
    } catch { return ''; }
  }
  return '';
}


function galleryHtml(items) {
  const cards = items.map((it) => {
    const acc = { 'claude-design':'var(--a1)','claude-slides':'var(--a2)','claude-design-system':'var(--a3)','claude-motion':'var(--a4)' }[it.skill] || 'var(--p)';
    const date = it.mtimeMs ? new Date(it.mtimeMs).toLocaleDateString('zh-CN') : '';
    return `<div class="card" data-q="${esc((it.title + ' ' + it.tail + ' ' + it.name).toLowerCase())}" data-skill="${esc(it.skill)}">
<div class="bar" style="background:${acc}"></div>
<div class="icon">${it.icon}</div>
<div class="name">${esc(it.title)}</div>
<div class="sub">${esc(it.tail)}</div>
<div class="row"><span class="meta">${esc(it.meta)}</span><span class="date">${date}</span></div>
<div class="acts">
  <button class="open" data-skill="${esc(it.skill)}" data-root="${esc(it.root)}">打开编辑</button>
  <button class="mini rename" data-skill="${esc(it.skill)}" data-root="${esc(it.root)}" title="重命名项目目录（同步更新索引标题）">✎</button>
  <button class="mini remove" data-skill="${esc(it.skill)}" data-root="${esc(it.root)}" title="删除项目（需二次确认）">🗑</button>
  <button class="mini stop" data-skill="${esc(it.skill)}" data-root="${esc(it.root)}" title="停止该项目的后台编辑器进程">⏹</button>
  <button class="mini restart" data-skill="${esc(it.skill)}" data-root="${esc(it.root)}" title="重启该项目的后台编辑器进程">↻</button>
</div>
</div>`;
  }).join('\n');
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8">
<title>Prototype Studio · 项目库</title>
<style>
:root { color-scheme: light dark;
--bg: light-dark(#f7f7f8,#101013); --fg: light-dark(#18181b,#f4f4f5);
--card: light-dark(#fff,#1b1b20); --bd: light-dark(#d4d4d8,#2a2a31); --mut: light-dark(#71717a,#a1a1aa);
--p: light-dark(#2563eb,#3b82f6); --pf:#fff; --err: light-dark(#b91c1c,#f87171);
--a1: light-dark(#7c3aed,#a78bfa); --a2: light-dark(#059669,#6ee7b7);
--a3: light-dark(#d97706,#fcd34d); --a4: light-dark(#e11d48,#fda4af);
--sh: light-dark(0 1px 3px rgba(0,0,0,.08), 0 1px 2px rgba(0,0,0,.25)); }
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;background:var(--bg);color:var(--fg)}
h1{font-size:18px;margin-bottom:4px}.sub2{color:var(--mut);font-size:12px;margin-bottom:16px}
.bar2{display:flex;gap:8px;margin-bottom:18px;flex-wrap:wrap;align-items:center}
input,select,.btn{font:inherit;font-size:13px;padding:6px 10px;border:1px solid var(--bd);border-radius:8px;background:var(--card);color:var(--fg)}
input{flex:1;min-width:200px}.btn{cursor:pointer}.btn.pri{background:var(--p);color:var(--pf);border:none;font-weight:500}
.btn:disabled{opacity:.5;cursor:default}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(230px,1fr));gap:12px}
.card{position:relative;background:var(--card);border:1px solid var(--bd);border-radius:10px;box-shadow:var(--sh);padding:14px}
.card .bar{position:absolute;left:0;top:10px;bottom:10px;width:3px;border-radius:0 2px 2px 0}
.icon{font-size:18px;margin-bottom:8px}.name{font-size:14px;font-weight:600;word-break:break-all}
.sub{font-size:11px;color:var(--mut);margin-top:2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.row{display:flex;justify-content:space-between;margin-top:8px;font-size:11px;color:var(--mut)}
.acts{display:flex;gap:4px;margin-top:10px}
.open{flex:1;border:none;border-radius:6px;background:var(--p);color:var(--pf);font:inherit;font-size:12px;font-weight:500;padding:6px;cursor:pointer}
.open:disabled{opacity:.5}
.mini{border:1px solid var(--bd);border-radius:6px;background:transparent;color:var(--mut);font:inherit;font-size:12px;padding:3px 7px;cursor:pointer}
.mini:hover{color:var(--fg);background:var(--bg)}
.hidden{display:none}
.err{color:var(--err);font-size:12px;min-height:18px;margin-bottom:8px}
.spin{position:relative;overflow:hidden}
.spin.busy{pointer-events:none;color:transparent}
.spin.busy::after{content:'';position:absolute;left:50%;top:50%;width:14px;height:14px;margin:-8px 0 0 -8px;border:2px solid var(--p);border-top-color:transparent;border-radius:50%;animation:spin .7s linear infinite}
@keyframes spin{to{transform:rotate(360deg)}}
#toast{position:fixed;left:50%;bottom:28px;transform:translate(-50%,12px);opacity:0;pointer-events:none;background:var(--fg);color:var(--bg);font-size:12px;font-weight:500;padding:6px 14px;border-radius:999px;transition:opacity .2s,transform .3s;z-index:99}
#toast.on{opacity:1;transform:translate(-50%,-8px)}
.empty{color:var(--mut);font-size:13px;padding:24px 0}
/* 编辑器视图：同一 tab 内全屏 iframe + 顶部返回条 */
#editorView{display:flex;flex-direction:column;height:100vh}
.topbar{display:flex;align-items:center;gap:10px;padding:8px 14px;border-bottom:1px solid var(--bd);background:var(--card);flex:none}
.topbar .title{font-size:13px;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:1}
#frame{flex:1;border:0;width:100%;background:var(--bg)}
#listView{padding:24px}
</style></head><body>
<div id="listView">
<h1>🎨 Prototype Studio · 项目库</h1>
<div class="sub2" id="wsLine"></div>
<div class="err" id="err"></div>
<div class="bar2">
  <input id="q" placeholder="搜索标题 / 路径 / 类别…">
  <select id="f"><option value="">全部类别</option><option value="claude-design">画布</option><option value="claude-slides">幻灯片</option><option value="claude-design-system">设计系统</option><option value="claude-motion">动效影片</option></select>
  <button class="btn" id="reload">刷新</button>
  <button class="btn" id="restart">重启服务</button>
  <button class="btn pri" id="newCanvas">＋ 画布</button>
  <button class="btn pri" id="newSlides">＋ 幻灯片</button>
  <button class="btn" id="newDS">＋ 设计系统</button>
  <button class="btn" id="copyMotion">📋 影片提示词</button>
</div>
<div class="sub2" id="count"></div>
<div class="grid" id="grid">
${cards || '<div class="empty">当前工作区暂无设计项目：点上方按钮创建示例，或复制提示词让 agent 创建。</div>'}
</div>
</div>
<div id="toast"></div>
<div id="editorView" class="hidden">
<div class="topbar">
  <button class="btn" id="back">← 项目库</button>
  <span class="title" id="editorTitle"></span>
  <button class="btn" id="pop">单独打开 ↗</button>
</div>
<iframe id="frame" allow="clipboard-read; clipboard-write"></iframe>
</div>
<script>
const $=(id)=>document.getElementById(id);
const q=$('q'),f=$('f'),grid=$('grid');
let scrollY=0;

function setErr(msg){$('err').textContent=msg||'';if(msg)setTimeout(()=>setErr(''),5000);}
let toastTimer=null;
function toast(msg){const t=$('toast');t.textContent=msg;t.classList.add('on');clearTimeout(toastTimer);toastTimer=setTimeout(()=>t.classList.remove('on'),1800);}
async function withSpin(btn,fn){btn.classList.add('spin','busy');try{return await fn();}finally{btn.classList.remove('spin','busy');}}
async function api(path,opts){const r=await fetch(path,opts);return r.json();}
function apply(){let n=0;const s=q.value.trim().toLowerCase(),k=f.value;grid.querySelectorAll('.card').forEach(c=>{const ok=(!s||c.dataset.q.includes(s))&&(!k||c.dataset.skill===k);c.classList.toggle('hidden',!ok);if(ok)n++;});$('count').textContent=n+' 个项目 · 按最近修改排序';}

// 首屏加载态：点状态栏图标 → tab 切到库页 → 服务可能还在冷启动。
// 立刻显示骨架屏 + 动画，/api/list 失败则自动重试（服务起来后无缝就位），
// 消除“点开白屏/没反应”的观感。点击图标即见动画，不再静默等待。
let retryTimer=null,loadedOnce=false;
function showSkeleton(){grid.innerHTML='<div class="empty" style="display:flex;align-items:center;justify-content:center;gap:8px"><span style="display:inline-block;width:14px;height:14px;border:2px solid var(--p);border-top-color:transparent;border-radius:50%;animation:spin .7s linear infinite"></span>正在加载项目库…</div>';}
function scheduleRetry(){clearTimeout(retryTimer);retryTimer=setTimeout(()=>reload(true),500);}

async function reload(quiet){
if(!loadedOnce)showSkeleton();
let d;
try{d=await api('/api/list');}
catch(e){if(!loadedOnce){setErr('项目库服务启动中…');scheduleRetry();}return;}
if(!d.ok){if(!loadedOnce){setErr(d.error||'扫描失败');scheduleRetry();}return;}
loadedOnce=true;clearTimeout(retryTimer);
$('wsLine').textContent='工作区：'+(d.workspaceName||'当前工作区')+(d.workspaceRoot?'':' · 未识别');
const acc={'claude-design':'var(--a1)','claude-slides':'var(--a2)','claude-design-system':'var(--a3)','claude-motion':'var(--a4)'};
grid.innerHTML=d.items.length?d.items.map(it=>{
  const date=it.mtimeMs?new Date(it.mtimeMs).toLocaleDateString('zh-CN'):'';
  const esc2=(v)=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  return '<div class="card" data-q="'+esc2((it.title+' '+it.tail+' '+it.name).toLowerCase())+'" data-skill="'+esc2(it.skill)+'"><div class="bar" style="background:'+(acc[it.skill]||'var(--p)')+'"></div><div class="icon">'+it.icon+'</div><div class="name">'+esc2(it.title)+'</div><div class="sub">'+esc2(it.tail)+'</div><div class="row"><span class="meta">'+esc2(it.meta)+'</span><span class="date">'+date+'</span></div><div class="acts"><button class="open" data-skill="'+esc2(it.skill)+'" data-root="'+esc2(it.root)+'">打开编辑</button><button class="mini rename" data-skill="'+esc2(it.skill)+'" data-root="'+esc2(it.root)+'" title="重命名项目目录（同步更新索引标题）">✎</button><button class="mini remove" data-skill="'+esc2(it.skill)+'" data-root="'+esc2(it.root)+'" title="删除项目（需二次确认）">🗑</button><button class="mini stop" data-skill="'+esc2(it.skill)+'" data-root="'+esc2(it.root)+'" title="停止该项目的后台编辑器进程">⏹</button><button class="mini restart" data-skill="'+esc2(it.skill)+'" data-root="'+esc2(it.root)+'" title="重启该项目的后台编辑器进程">↻</button></div></div>';
}).join(''):'<div class="empty">当前工作区暂无设计项目</div>';
apply();
}

async function enterEditor(skill,root,title){
const btn=grid.querySelector('.open[data-root="'+CSS.escape(root)+'"]');
if(btn){btn.disabled=true;btn.textContent='打开中…';}
const d=await api('/api/open?skill='+encodeURIComponent(skill)+'&root='+encodeURIComponent(root));
if(!d.ok){setErr(d.error||'打开失败');if(btn){btn.disabled=false;btn.textContent='打开编辑';}return;}
scrollY=window.scrollY;
$('editorTitle').textContent=title+' · '+skill.replace('claude-','');
$('frame').src=d.url;
$('pop').onclick=()=>window.open(d.url,'_blank');
$('listView').classList.add('hidden');
$('editorView').classList.remove('hidden');
history.pushState({editor:true},'','#editor');
if(btn){btn.disabled=false;btn.textContent='打开编辑';}
}
function back(){
  $('editorView').classList.add('hidden'); $('listView').classList.remove('hidden');
  $('frame').src='about:blank'; window.scrollTo(0,scrollY); reload();
  if(location.hash)history.replaceState({},'',location.pathname);
}
window.addEventListener('popstate',()=>{if(!$('editorView').classList.contains('hidden'))back();});
$('back').onclick=()=>back();
q.oninput=apply;f.onchange=apply;
$('reload').onclick=()=>withSpin($('reload'),async()=>{await reload();toast('✓ 已刷新');});
$('restart').onclick=()=>withSpin($('restart'),async()=>{
  try{
    const r=await api('/api/restart',{method:'POST',headers:{'content-type':'application/json'},body:'{}'});
    if(!r.ok){setErr(r.error||'重启失败');return;}
    toast('服务重启中…');
    for(let i=0;i<20;i++){
      await new Promise(ok=>setTimeout(ok,300));
      try{const h=await fetch('/api/list',{cache:'no-store'});if(h.ok){await reload();toast('✓ 服务已重启');return;}}catch{}
    }
    setErr('服务重启超时，请稍后手动刷新');
  }catch(e){setErr('重启请求失败：'+e.message);}
});
$('newCanvas').onclick=()=>create('claude-design');
$('newSlides').onclick=()=>create('claude-slides');
$('newDS').onclick=()=>create('claude-design-system');
$('copyMotion').onclick=async()=>{try{await navigator.clipboard.writeText('用 claude-motion 技能在当前工作区创建动效影片项目，内容：');setErr('✓ 提示词已复制，发给 agent');}catch{setErr('复制失败');}};

async function create(skill){
const r=await api('/api/create',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({skill})});
if(!r.ok){setErr(r.error||'创建失败');return;}
await reload();
await enterEditor(skill,r.root,'新项目');
}

grid.addEventListener('click',async(e)=>{
const card=e.target.closest('.card');if(!card)return;
const skill=card.dataset.skill;
const cardRoot=card.querySelector('[data-root]')?.dataset.root||'';
const title=card.querySelector('.name')?.textContent||'';
if(e.target.closest('.open'))return enterEditor(skill,cardRoot,title);
if(e.target.closest('.rename')){
  const name=prompt('重命名为（字母/数字/_-）：',cardRoot.split('/').pop());
  if(!name)return;
  const r=await api('/api/rename',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({skill,root:cardRoot,name})});
  if(r.ok)reload();else setErr(r.error||'重命名失败');return;
}
if(e.target.closest('.remove')){
  if(!confirm('确认删除「'+title+'」？不可恢复'))return;
  const r=await api('/api/remove',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({skill,root:cardRoot,confirm:true})});
  if(r.ok)reload();else setErr(r.error||'删除失败');return;
}
if(e.target.closest('.stop')||e.target.closest('.restart')){
  const op=e.target.closest('.restart')?'restart-editor':'stop';
  const r=await api('/api/'+(op==='restart'?'restart-editor':op),{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({skill,root:cardRoot})});
  toast(r.ok?(op==='stop'?'✓ 已停止编辑器进程':'✓ 编辑器已重启'):(r.error||'操作失败'));return;
}
});
reload();
</script></body></html>`;
}

function scanDesignProjects(rootDir) {
  const bySkill = {};
  for (const id of Object.keys(ROOT_MARKERS)) bySkill[id] = [];
  if (!rootDir) return bySkill;
  const SKIP = new Set(['.git', 'node_modules', '.orca', 'vendor', 'dist', '.venv', '__pycache__', 'build']);
  (function walk(dir, depth) {
    if (depth > 2) return;
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (!e.isDirectory() || SKIP.has(e.name)) continue;
      const p = path.join(dir, e.name);
      if (isInstalledPluginPath(p)) continue; // 不扫描插件安装目录
      let matched = false;
      for (const [skill, markers] of Object.entries(ROOT_MARKERS)) {
        for (const mk of markers) {
          if (fs.existsSync(path.join(p, mk))) {
            let title = null;
            try { title = JSON.parse(fs.readFileSync(path.join(p, mk), 'utf8')).title || null; } catch {}
            bySkill[skill].push({ title: title || e.name, root: p });
            matched = true; break;
          }
        }
        if (matched) break;
      }
      if (!matched) walk(p, depth + 1);
    }
  })(rootDir, 0);
  for (const id of Object.keys(bySkill)) bySkill[id].sort((a,b) => a.title.localeCompare(b.title));
  return bySkill;
}

function galleryData() {
  const state = readState();
  const workspaceRoot = state.workspaceRoot || '';
  const found = scanDesignProjects(workspaceRoot);
  const out = [];
  for (const [skillId, roots] of Object.entries(found)) {
    const meta = SKILL_META.find((m) => m.id === skillId);
    if (!meta) continue;
    for (const r of roots) {
      let mtimeMs = 0;
      try { mtimeMs = fs.statSync(r.root).mtimeMs; } catch {}
      out.push({ skill: skillId, name: meta.name, icon: meta.icon, title: r.title, root: r.root,
        tail: r.root.split('/').slice(-2).join('/'), meta: projectMeta(skillId, r.root), mtimeMs });
    }
  }
  out.sort((a,b) => b.mtimeMs - a.mtimeMs);
  return { ok: true, items: out, workspaceName: state.workspaceName || '', workspaceRoot };
}

async function openSkillEditor(skillId, rootInput) {
  const meta = SKILL_META.find((s) => s.id === skillId);
  if (!meta) return { ok: false, error: `unknown skill: ${skillId}` };
  let root = rootInput;
  if (!root) {
    const roots = galleryData().items.filter((i) => i.skill === skillId);
    if (!roots.length) return { ok: false, error: `no ${skillId} project` };
    root = roots[0].root;
  }
  const r = await runNode([artifactCli(skillId), 'open', root, '--port', String(meta.port)]);
  if (r.err) return { ok: false, error: `artifact open failed: ${r.stderr || r.err.message}` };
  const m = r.stdout.match(/\{[\s\S]*"url"[\s\S]*\}/);
  if (!m) return { ok: false, error: `no url in artifact output: ${r.stdout.slice(0, 200)}` };
  try { return { ok: true, url: JSON.parse(m[0]).url }; }
  catch { return { ok: false, error: 'unparsable artifact output' }; }
}
async function restartEditor(skillId, root) {
  let out = await openSkillEditor(skillId, root);
  if (!out.ok) { await stopSkillEditor(skillId, root); out = await openSkillEditor(skillId, root); }
  return out;
}
async function stopSkillEditor(skillId, root) {
  const r = await runNode([artifactCli(skillId), 'stop', root]);
  return r.err ? { ok: false, error: r.stderr || r.err.message } : { ok: true };
}

function safeDesignRoot(raw) {
  const root = path.resolve(String(raw || ''));
  const base = path.resolve(readState().workspaceRoot || '');
  const designDir = path.join(base, '.design');
  if (!base || !root.startsWith(designDir + path.sep)) return { ok: false, error: '项目路径不在当前工作区 .design/ 内' };
  if (path.dirname(root) !== designDir || !fs.existsSync(path.join(root, 'project'))) return { ok: false, error: '不是有效的设计项目' };
  if (isInstalledPluginPath(root)) return { ok: false, error: '拒绝操作插件安装目录' };
  return { ok: true, root, designDir };
}
async function createExample(skillId, nameInput) {
  const tpl = EXAMPLE_TEMPLATES[skillId];
  if (!tpl) return { ok: false, error: `${skillId} 项目由 agent 创建（无静态示例模板）` };
  const base = readState().workspaceRoot || '';
  if (!base) return { ok: false, error: '当前工作区未识别，请稍后重试' };
  if (isInstalledPluginPath(base)) {
    return { ok: false, error: '当前工作区是 Orca 插件安装路径，请切换到其他工作区创建设计项目' };
  }
  if (skillId === 'claude-design-system' && (scanDesignProjects(base)['claude-design-system'] || []).length > 0) {
    return { ok: false, error: '当前工作区已有设计系统（全项目统一参考）；如需更换请先删除' };
  }
  const safe = String(nameInput || '').replace(/[^A-Za-z0-9_-]/g, '').slice(0, 40);
  const baseName = safe || tpl.dirName;
  const designDir = path.join(base, '.design');
  let name = baseName, i = 2;
  while (fs.existsSync(path.join(designDir, name))) name = `${baseName}-${i++}`;
  const root = path.join(designDir, name);
  const now = new Date().toISOString().replace(/\.\d+Z$/, 'Z');
  for (const [rel, content] of Object.entries(tpl.files)) {
    const p = path.join(root, rel);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    if (content === '__INDEX__') {
      const idx = { ...EXAMPLE_INDEX[skillId], createdOnFiles: { v: 1, at: now }, title: name,
        lastChange: { by: 'prototype-studio', at: now, via: 'Orca plugin', note: 'Example scaffold' } };
      fs.writeFileSync(p, JSON.stringify(idx, null, 2));
    } else {
      fs.writeFileSync(p, content, 'utf8');
    }
  }
  const chk = await runNode([artifactCli(skillId), 'check', root]);
  let problems = null;
  try { problems = JSON.parse(chk.stdout).problems ?? null; } catch {}
  return { ok: true, root, problems };
}
const EXAMPLE_INDEX = {
  'claude-design': { v: 3, launch: { view: 'canvas' }, pages: [], boards: { 'Main.dc.html': { x: 0, y: 0, w: 880, h: 560, title: '欢迎' } }, order: ['Main.dc.html'], notes: {}, designSystems: [] },
  'claude-slides': { v: 4, lists: 'css', order: ['cover'], cover: 'cover', sections: {}, faces: {}, designSystems: [] },
  'claude-design-system': { v: 3, layout: 'files', namespace: 'ExampleDesignSystem', libraries: [], sections: {}, groups: [], assetGroups: {}, blobs: {}, docs: { readme: 'project/README.md', sections: [] }, lastChange: {} },
};
async function renameDesignRoot(skillId, rawRoot, newName) {
  const g = safeDesignRoot(rawRoot); if (!g.ok) return g;
  const name = String(newName || '').replace(/[^A-Za-z0-9_-]/g, '').slice(0, 40);
  if (!name) return { ok: false, error: '名称只能包含字母、数字、下划线和连字符' };
  const dest = path.join(g.designDir, name);
  if (dest === g.root) return { ok: true, root: g.root };
  if (fs.existsSync(dest)) return { ok: false, error: '同名目录已存在' };
  await stopSkillEditor(skillId, g.root);
  fs.renameSync(g.root, dest);
  const marker = (ROOT_MARKERS[skillId] || [])[0];
  if (marker) {
    const idxPath = path.join(dest, marker);
    try { const idx = JSON.parse(fs.readFileSync(idxPath, 'utf8')); idx.title = name; fs.writeFileSync(idxPath, JSON.stringify(idx, null, 2)); } catch {}
  }
  return { ok: true, root: dest };
}
async function removeDesignRoot(skillId, rawRoot) {
  const g = safeDesignRoot(rawRoot); if (!g.ok) return g;
  await stopSkillEditor(skillId, g.root);
  fs.rmSync(g.root, { recursive: true, force: false });
  return { ok: true };
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://127.0.0.1');
  res.setHeader('content-type', url.pathname === '/' ? 'text/html; charset=utf-8' : 'application/json; charset=utf-8');
  const allowedGet = ['/', '/api/list', '/api/open', '/api/open-url'];
  const allowedPost = ['/api/create', '/api/rename', '/api/remove', '/api/stop', '/api/restart', '/api/restart-editor'];
  if (!((req.method === 'GET' && allowedGet.includes(url.pathname)) || (req.method === 'POST' && allowedPost.includes(url.pathname)))) {
    res.statusCode = 404; return res.end('{}');
  }
  const finish = (v) => res.end(JSON.stringify(v));
  if (req.method === 'GET') {
    if (url.pathname === '/') return res.end(galleryHtml(galleryData().items));
    if (url.pathname === '/api/list') return finish(galleryData());
    const skill = url.searchParams.get('skill') || '';
    const root = url.searchParams.get('root') || '';
    if (url.pathname === '/api/open-url') {
      return openSkillEditor(skill, root).then((r) => {
        if (!r.ok) { res.statusCode = 400; return finish(r); }
        res.statusCode = 302; res.setHeader('location', r.url); return res.end();
      });
    }
    return openSkillEditor(skill, root).then(finish);
  }
  let body = '';
  req.on('data', (c) => { body += c; if (body.length > 8192) req.destroy(); });
  req.on('end', async () => {
    let input = {}; try { input = JSON.parse(body || '{}'); } catch {}
    const skill = input.skill || '', root = input.root || '';
    if (url.pathname === '/api/create') return finish(await createExample(skill, input.name));
    if (url.pathname === '/api/rename') return finish(await renameDesignRoot(skill, root, input.name));
    if (url.pathname === '/api/remove') return finish(input.confirm === true ? await removeDesignRoot(skill, root) : { ok: false, error: '需要二次确认' });
    if (url.pathname === '/api/stop') return finish(await stopSkillEditor(skill, root));
    if (url.pathname === '/api/restart') {
      // 重启项目库服务自身：spawn 新进程接管端口后本进程退出
      finish({ ok: true, restarting: true });
      // 先关闭监听端口，再拉起新实例，最后退出
      server.close(() => {
        try {
          const child = execFile(process.execPath, [__filename], { detached: true, stdio: 'ignore' });
          child.unref();
        } catch {}
        setTimeout(() => process.exit(0), 250);
      });
      return;
    }
    if (url.pathname === '/api/restart-editor') return finish(await restartEditor(skill, root));
  });
});
server.on('error', (e) => console.error('gallery server error:', e.message));
server.listen(PORT, '127.0.0.1', () => console.log(`gallery listening on ${PORT}`));
