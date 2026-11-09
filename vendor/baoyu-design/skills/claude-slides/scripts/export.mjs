#!/usr/bin/env node
/**
 * Node >= 18; no packages required.
 * node export.mjs <deck-directory> [--embed] [--out <directory>]
 * PDF equivalent (PDF generation is intentionally left to Chrome):
 * google-chrome --headless --no-pdf-header-footer --print-to-pdf=/tmp/deck.pdf \
 *   --timeout=30000 --virtual-time-budget=10000 file:///tmp/export-deck/index.html
 * For deterministic printing, use a browser driver to await
 * document.fonts.ready (or html[data-fonts-ready="true"]) before printToPDF.
 * A CLI time budget alone cannot guarantee that asynchronous fonts have loaded;
 * printing too early can capture fallback glyphs and incorrect line wrapping.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const MAX_FONT = 2 * 1024 * 1024;
const READY = '<script data-export-fonts-ready>document.fonts.ready.then(function(){document.documentElement.dataset.fontsReady="true";});</script>';
const warnings = [];
const downloads = new Map();
function warn(message) {
  warnings.push(message);
  console.error(`WARN ${message}`);
}
function decodeEntities(value) {
  const names = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: '\u00a0', ndash: '–', mdash: '—', hellip: '…', copy: '©', reg: '®', trade: '™', bull: '•' };
  return value.replace(/&(#x[\da-f]+|#\d+|[a-z]+);/gi, (all, entity) => {
    if (entity[0] !== '#') return names[entity] ?? all;
    const n = entity[1].toLowerCase() === 'x' ? parseInt(entity.slice(2), 16) : Number(entity.slice(1));
    return n > 0 && n <= 0x10ffff && !(n >= 0xd800 && n <= 0xdfff) ? String.fromCodePoint(n) : all;
  });
}
function pageCharacters(html) {
  const text = html.replace(/<!--[\s\S]*?-->/g, '').replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, '').replace(/<[^>]*>/g, '');
  return [...new Set(decodeEntities(text))].sort().join('');
}
function attribute(tag, name) {
  const match = tag.match(new RegExp(`\\b${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i'));
  return match ? decodeEntities(match[1] ?? match[2] ?? match[3]) : null;
}
async function replaceAsync(text, regex, fn) {
  let result = '', cursor = 0;
  for (const match of text.matchAll(regex)) {
    result += text.slice(cursor, match.index) + await fn(...match);
    cursor = match.index + match[0].length;
  }
  return result + text.slice(cursor);
}
function googleCss(url) {
  return url.hostname === 'fonts.googleapis.com' && url.pathname === '/css2';
}
function fontUrl(url) { return /\.woff2?$/i.test(url.pathname); }
function isWithin(root, file) {
  const relative = path.relative(root, file);
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
}
async function fetchBytes(url) {
  if (!downloads.has(url.href)) {
    downloads.set(url.href, (async () => {
      const response = await fetch(url, {
        signal: AbortSignal.timeout(10000),
        headers: { 'User-Agent': 'Mozilla/5.0 Chrome/131.0.0.0 Safari/537.36' },
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return Buffer.from(await response.arrayBuffer());
    })());
  }
  return downloads.get(url.href);
}

async function main() {
  const args = process.argv.slice(2);
  let directory, output, embed = false;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--embed') embed = true;
    else if (args[i] === '--out' && args[i + 1] && !args[i + 1].startsWith('--')) output = args[++i];
    else if (!args[i].startsWith('-') && !directory) directory = args[i];
    else throw new Error(`Invalid argument: ${args[i]}`);
  }
  if (!directory) throw new Error('Usage: node export.mjs <deck-directory> [--embed] [--out <directory>]');
  const source = await fs.realpath(directory);
  if (!(await fs.stat(source)).isDirectory()) throw new Error('Deck must be a directory');
  const requestedOutput = path.resolve(output ?? path.join('/tmp', `export-${path.basename(source)}`));
  await fs.mkdir(path.dirname(requestedOutput), { recursive: true });
  const destination = path.join(await fs.realpath(path.dirname(requestedOutput)), path.basename(requestedOutput));
  if (isWithin(source, destination) || isWithin(destination, source)) throw new Error('Output and source directories must not overlap');
  try {
    await fs.lstat(destination);
    throw new Error(`Output already exists; choose a fresh --out directory: ${destination}`);
  } catch (error) { if (error.code !== 'ENOENT') throw error; }

  const files = [];
  async function inventory(dir) {
    for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
      const file = path.join(dir, entry.name);
      if (entry.isDirectory()) await inventory(file);
      else if (entry.isFile()) files.push(file);
      else warn(`Skipping non-regular entry: ${file}`);
    }
  }
  await inventory(source);
  let before = 0;
  for (const file of files) {
    const target = path.join(destination, path.relative(source, file));
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.copyFile(file, target);
    before += (await fs.stat(file)).size;
  }
  await fs.mkdir(destination, { recursive: true });

  async function localBytes(url) {
    const file = await fs.realpath(fileURLToPath(url));
    if (!isWithin(source, file)) throw new Error('Local reference escapes deck directory');
    return fs.readFile(file);
  }
  async function bytes(url) {
    if (url.protocol === 'file:') return localBytes(url);
    if (url.protocol === 'https:' || url.protocol === 'http:') return fetchBytes(url);
    throw new Error(`Unsupported protocol ${url.protocol}`);
  }
  function resolve(ref, base) {
    return new URL(decodeEntities(ref), base);
  }
  function rebased(url, htmlFile) {
    if (url.protocol !== 'file:') return url.href;
    const file = fileURLToPath(url);
    if (!isWithin(source, file)) return url.href;
    return path.relative(path.dirname(htmlFile), file).split(path.sep).map(encodeURIComponent).join('/') + url.search + url.hash;
  }
  async function inlineFont(ref, base) {
    const url = resolve(ref, base);
    if (url.protocol === 'data:') return { value: ref, size: 0 };
    const data = await bytes(url);
    if (data.length > MAX_FONT) throw new Error(`Font exceeds 2 MiB (${data.length} bytes)`);
    const mime = /\.woff$/i.test(url.pathname) || data.subarray(0, 4).toString() === 'wOFF' ? 'font/woff' : 'font/woff2';
    return { value: `data:${mime};base64,${data.toString('base64')}`, size: data.length };
  }
  async function cssText(css, base, chars, htmlFile, chain = new Set()) {
    if (chain.has(base.href)) throw new Error(`Circular CSS import: ${base.href}`);
    const nextChain = new Set(chain).add(base.href);
    const imports = [];
    css = await replaceAsync(css, /@import\s+(?:url\(\s*(?:"([^"]*)"|'([^']*)'|([^\s)]+))\s*\)|"([^"]*)"|'([^']*)')\s*([^;]*);/gi, async (all, a, b, c, d, e, media) => {
      try {
        const url = resolve(a ?? b ?? c ?? d ?? e, base);
        const value = await loadCss(url, chars, htmlFile, nextChain);
        const token = `/* export-import-${imports.length} */`;
        imports.push(media.trim() ? `@media ${media.trim()}{${value}}` : value);
        return token;
      } catch (error) {
        warn(`${base.href}: ${error.message}`);
        // The parent stylesheet may itself be inlined: preserve the import's base.
        try {
          const ref = rebased(resolve(a ?? b ?? c ?? d ?? e, base), htmlFile);
          const token = `/* export-import-${imports.length} */`;
          imports.push(`@import url("${ref}") ${media};`);
          return token;
        } catch { return all; }
      }
    });
    css = await replaceAsync(css, /@font-face\s*\{[^}]*\}/gi, async face => {
      let total = 0;
      try {
        const result = await replaceAsync(face, /url\(\s*(?:"([^"]*)"|'([^']*)'|([^\s)]+))\s*\)/gi, async (all, a, b, c) => {
          const font = await inlineFont(a ?? b ?? c, base);
          total += font.size;
          return `url("${font.value}")`;
        });
        if (total > MAX_FONT) throw new Error(`Font face exceeds 2 MiB (${total} bytes)`);
        return result;
      } catch (error) { warn(`${base.href}: ${error.message}; keeping original font-face URLs`); return face; }
    });
    // Inlined styles retain their original image and fallback-font locations.
    css = css.replace(/url\(\s*(?:"([^"]*)"|'([^']*)'|([^\s)]+))\s*\)/gi, (all, a, b, c) => {
      const ref = a ?? b ?? c;
      if (/^(data:|#)/i.test(ref)) return all;
      try { return `url("${rebased(resolve(ref, base), htmlFile)}")`; }
      catch (error) { warn(`${base.href}: ${error.message}`); return all; }
    });
    return css.replace(/\/\* export-import-(\d+) \*\//g, (all, index) => imports[Number(index)] ?? all);
  }
  async function loadCss(original, chars, htmlFile, chain) {
    const url = new URL(original);
    if (googleCss(url)) url.searchParams.set('text', chars);
    return cssText((await bytes(url)).toString('utf8'), url, chars, htmlFile, chain);
  }

  let pages = 0;
  for (const file of files.filter(file => /\.html$/i.test(file))) {
    let html = await fs.readFile(file, 'utf8');
    const base = pathToFileURL(file);
    const chars = pageCharacters(html);
    // Only edit attributes inside tags, not JS strings or visible text.
    html = html.replace(/<[^>]+>/g, tag => tag.replace(/(\sloading\s*=\s*)(["'])lazy\2/gi, '$1$2eager$2'));
    if (embed) {
      html = await replaceAsync(html, /<style\b[^>]*>[\s\S]*?<\/style\s*>|<link\b[^>]*>/gi, async tag => {
        if (/^<style\b/i.test(tag)) {
          return replaceAsync(tag, /(<style\b[^>]*>)([\s\S]*?)(<\/style\s*>)/gi, async (_all, open, css, close) => open + await cssText(css, base, chars, file) + close);
        }
        const href = attribute(tag, 'href');
        if (!href) return tag;
        try {
          const url = resolve(href, base);
          const rel = attribute(tag, 'rel') ?? '';
          if (/\bstylesheet\b/i.test(rel) && !attribute(tag, 'disabled') && !/\bdisabled(?:\s|=|>)/i.test(tag) && (googleCss(url) || url.protocol === 'file:')) {
            const css = await loadCss(url, chars, file, new Set());
            const media = attribute(tag, 'media');
            return `<style${media ? ` media="${media.replace(/&/g, '&amp;').replace(/"/g, '&quot;')}"` : ''}>${css.replace(/<\/style/gi, '<\\/style')}</style>`;
          }
          if (fontUrl(url) && url.protocol === 'file:') {
            const font = await inlineFont(href, base);
            return tag.replace(/\bhref\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/i, `href="${font.value}"`);
          }
        } catch (error) { warn(`${file}: ${error.message}; keeping original link ${href}`); }
        return tag;
      });
    }
    if (!html.includes('data-export-fonts-ready')) {
      html = /<\/body\s*>/i.test(html) ? html.replace(/<\/body\s*>/i, `${READY}\n$&`) : `${html}\n${READY}\n`;
    }
    await fs.writeFile(path.join(destination, path.relative(source, file)), html);
    pages++;
  }
  let after = 0;
  for (const file of files) after += (await fs.stat(path.join(destination, path.relative(source, file)))).size;
  console.log(JSON.stringify({ output: destination, pages, embed, beforeBytes: before, afterBytes: after, warnings }, null, 2));
}

main().catch(error => {
  console.error(`ERROR ${error.message}`);
  process.exitCode = 1;
});
