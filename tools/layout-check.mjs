#!/usr/bin/env node
// 版式登记校验：扫描项目 HTML 里的 data-layout 标注，与 references/layouts.json 比对。
// 用法：node tools/layout-check.mjs <项目目录> [--json]
// 判据（版式登记制）：每个 <section> 必须带 data-layout="Sxx"；
//   - 出现未登记的 Sxx → problem（版式漂移）
//   - section 缺 data-layout → warning（按 guizang 约定视为未登记）
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const asJson = args.includes('--json');
const target = args.find((a) => !a.startsWith('--')) || '';
if (!target) {
  console.error('用法: node tools/layout-check.mjs <项目目录> [--json]');
  process.exit(2);
}

const registry = JSON.parse(
  fs.readFileSync(path.join(__dirname, '..', 'references', 'layouts.json'), 'utf8'),
);
const known = new Set(Object.keys(registry.layouts));

function walk(dir, out) {
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
  for (const e of entries) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (['node_modules', '.git', 'history'].includes(e.name)) continue;
      walk(p, out);
    } else if (e.isFile() && e.name.endsWith('.html')) {
      out.push(p);
    }
  }
}

const files = [];
walk(path.resolve(target), files);
const problems = [];
const warnings = [];
for (const f of files) {
  const html = fs.readFileSync(f, 'utf8');
  const sections = html.match(/<section\b[^>]*>/g) || [];
  const tagged = html.match(/<section\b[^>]*data-layout="(S[^"]*)"[^>]*>/g) || [];
  const used = new Set();
  for (const t of tagged) used.add((t.match(/data-layout="(S[^"]*)"/) || [])[1]);
  for (const v of used) {
    if (!known.has(v)) problems.push({ file: f, layout: v, reason: '未登记的版式' });
  }
  const missing = sections.length - tagged.length;
  if (missing > 0) warnings.push({ file: f, count: missing, reason: 'section 缺 data-layout 标注' });
}

const result = {
  ok: problems.length === 0,
  files: files.length,
  sections: files.reduce((n, f) => n + (fs.readFileSync(f, 'utf8').match(/<section\b/g) || []).length, 0),
  problems,
  warnings,
};
if (asJson) console.log(JSON.stringify(result, null, 2));
else {
  for (const p of problems) console.log(`✗ ${path.relative(process.cwd(), p.file)}: ${p.layout} ${p.reason}`);
  for (const w of warnings) console.log(`⚠ ${path.relative(process.cwd(), w.file)}: ${w.count} 个 ${w.reason}`);
  console.log(problems.length === 0 ? `✓ 版式登记检查通过（${result.sections} section）` : `✗ ${problems.length} 个版式问题`);
}
process.exit(problems.length === 0 ? 0 : 1);
