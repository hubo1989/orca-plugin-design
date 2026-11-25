/* SPDX-License-Identifier: MIT */
(function () {
  'use strict';

  var DEFAULT_CONTENT = {
    title: '中英混排长页排版示例',
    subtitle: '严格遵循 CJK T1–T10 排版规范：36em 行长、1.7 行距、明暗双主题与单文件离线 HTML 导出。',
    mode: 'faithful',
    theme: 'light',
    brandColor: '#2563EB',
    author: 'Orca-Design',
    date: '2026-11-26',
    lang: 'zh-Hans',
    summaryCard: {
      heading: '核心结论',
      bullets: [
        '桌面端与 375px 移动端双视口无横向溢出，表格与代码块独立滚动。',
        '不依赖任何外网 CDN 与字体文件，离线双击单文件 HTML 即可完整阅读。'
      ]
    },
    sections: [
      {
        id: 'sec-typography',
        heading: '一、CJK T1–T10 混排实测段落',
        blocks: [
          {
            type: 'paragraph',
            text: '正文采用“中文弯引号”、嵌套‘单引号’、两字省略号……以及双字破折号——并在中文与 Open Artifact 或 375px 等拉丁数字之间自动保留脚本边界距，同时保持 https://example.com 与代码串原样不受改写。'
          },
          {
            type: 'callout',
            tone: 'info',
            title: '双模式说明',
            text: '忠实精排模式（faithful）严格保留原文措辞；提炼解读模式（digest）会生成导读结论卡与结构化要点。'
          },
          {
            type: 'table',
            headers: ['规范编号', '约束指标', '落地参数'],
            rows: [
              ['T1 / T2', '行长与行距', '36em / 1.7'],
              ['T9', '标题阶梯', '32px / 24px / 20px / 18px'],
              ['T10', '暗色对比度', '>= 4.5:1']
            ]
          },
          {
            type: 'code',
            lang: 'js',
            code: 'const layout = { maxInlineSize: "36em", lineHeight: 1.7 };'
          }
        ]
      }
    ]
  };

  var $ = function (id) { return document.getElementById(id); };
  var shell = $('app');
  var selfCap = null;
  var downloadsCap = null;
  var content = null;
  var saveTimer = null;
  var currentViewport = 'desktop';
  var currentFontSize = 16;

  var params = new URLSearchParams(window.location.search);
  var exportMode = params.get('export') === '1';
  var exportTheme = params.get('theme') || null;

  function resolveTheme(mode) {
    if (mode === 'dark' || mode === 'light') return mode;
    return window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }

  function setStatus(text) {
    $('save-status').textContent = text;
  }

  function scheduleSave() {
    setStatus('编辑中…');
    clearTimeout(saveTimer);
    saveTimer = setTimeout(function () { persistContent(); }, 600);
  }

  async function persistContent() {
    if (!content) return;
    if (!selfCap) {
      setStatus('只读模式');
      return;
    }
    setStatus('保存中…');
    try {
      await selfCap.publish({ 'content.json': JSON.stringify(content, null, 2) + '\n' });
      setStatus('已保存');
    } catch (err) {
      setStatus('保存失败: ' + (err && err.message ? err.message : String(err)));
    }
  }

  /**
   * Format Chinese prose for T3 (script boundary spacing) and T6 (unbreakable ellipsis/em-dash),
   * strictly preserving URLs and email addresses untouched.
   */
  function appendFormattedText(parent, rawText) {
    var text = String(rawText || '');
    var urlOrMail = /(https?:\/\/[^\s，。！？、》】”’]+|[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,})/g;
    var parts = text.split(urlOrMail);

    parts.forEach(function (part) {
      if (!part) return;
      if (/^(?:https?:\/\/|[A-Za-z0-9._%+-]+@)/.test(part)) {
        var a = document.createElement('a');
        a.href = part.indexOf('http') === 0 ? part : 'mailto:' + part;
        a.textContent = part;
        a.rel = 'noopener noreferrer';
        parent.appendChild(a);
        return;
      }
      // Split around Han/Latin+Digit boundaries and …… / ——
      var tokenRe = /(……|——|(?<=[\u4e00-\u9fff])[A-Za-z0-9]+(?=[ \t]*[\u4e00-\u9fff])|(?<=[\u4e00-\u9fff])[A-Za-z0-9]+|[A-Za-z0-9]+(?=[\u4e00-\u9fff]))/g;
      var cursor = 0;
      var match;
      while ((match = tokenRe.exec(part)) !== null) {
        if (match.index > cursor) {
          parent.appendChild(document.createTextNode(part.slice(cursor, match.index)));
        }
        var tok = match[0];
        if (tok === '……' || tok === '——') {
          var nw = document.createElement('span');
          nw.className = 'lp-nowrap';
          nw.textContent = tok;
          parent.appendChild(nw);
        } else {
          var prevChar = match.index > 0 ? part[match.index - 1] : '';
          var nextChar = part[match.index + tok.length] || '';
          var hasHanBefore = /[\u4e00-\u9fff]/.test(prevChar);
          var hasHanAfter = /[\u4e00-\u9fff]/.test(nextChar);
          var span = document.createElement('span');
          if (hasHanBefore && hasHanAfter) span.className = 'lp-latin';
          else if (hasHanBefore) span.className = 'lp-latin-end';
          else if (hasHanAfter) span.className = 'lp-latin-start';
          span.textContent = tok;
          parent.appendChild(span);
        }
        cursor = match.index + tok.length;
      }
      if (cursor < part.length) {
        parent.appendChild(document.createTextNode(part.slice(cursor)));
      }
    });
  }

  function renderBlock(block, editable) {
    if (!block || typeof block !== 'object') return document.createDocumentFragment();
    var type = block.type || 'paragraph';

    if (type === 'subheading') {
      var h3 = document.createElement('h3');
      h3.textContent = block.text || '';
      if (editable) {
        h3.contentEditable = 'true';
        h3.oninput = function () { block.text = h3.textContent; scheduleSave(); };
      }
      return h3;
    }

    if (type === 'callout') {
      var box = document.createElement('div');
      box.className = 'lp-callout';
      box.dataset.tone = block.tone || 'info';
      if (block.title) {
        var ct = document.createElement('div');
        ct.className = 'lp-callout-title';
        ct.textContent = block.title;
        box.appendChild(ct);
      }
      var cp = document.createElement('p');
      appendFormattedText(cp, block.text || '');
      box.appendChild(cp);
      return box;
    }

    if (type === 'quote') {
      var bq = document.createElement('blockquote');
      var qp = document.createElement('p');
      appendFormattedText(qp, block.text || '');
      bq.appendChild(qp);
      if (block.cite) {
        var cite = document.createElement('footer');
        cite.textContent = '—— ' + block.cite;
        bq.appendChild(cite);
      }
      return bq;
    }

    if (type === 'list') {
      var list = document.createElement(block.ordered ? 'ol' : 'ul');
      (block.items || []).forEach(function (item) {
        var li = document.createElement('li');
        appendFormattedText(li, item);
        list.appendChild(li);
      });
      return list;
    }

    if (type === 'table') {
      var wrap = document.createElement('div');
      wrap.className = 'lp-table-wrap';
      var table = document.createElement('table');
      if (Array.isArray(block.headers) && block.headers.length) {
        var thead = document.createElement('thead');
        var tr = document.createElement('tr');
        block.headers.forEach(function (h) {
          var th = document.createElement('th');
          th.textContent = h;
          tr.appendChild(th);
        });
        thead.appendChild(tr);
        table.appendChild(thead);
      }
      var tbody = document.createElement('tbody');
      (block.rows || []).forEach(function (row) {
        var tr = document.createElement('tr');
        (row || []).forEach(function (cell) {
          var td = document.createElement('td');
          td.textContent = cell;
          tr.appendChild(td);
        });
        tbody.appendChild(tr);
      });
      table.appendChild(tbody);
      wrap.appendChild(table);
      return wrap;
    }

    if (type === 'code') {
      var cwrap = document.createElement('div');
      cwrap.className = 'lp-code-wrap';
      var pre = document.createElement('pre');
      var code = document.createElement('code');
      code.textContent = block.code || '';
      pre.appendChild(code);
      cwrap.appendChild(pre);
      return cwrap;
    }

    var p = document.createElement('p');
    if (editable) {
      p.textContent = block.text || '';
      p.contentEditable = 'true';
      p.oninput = function () { block.text = p.textContent; scheduleSave(); };
    } else {
      appendFormattedText(p, block.text || '');
    }
    return p;
  }

  function render() {
    if (!content) return;
    var themePref = exportTheme || content.theme || 'light';
    var resolved = resolveTheme(themePref);
    shell.dataset.theme = themePref;
    shell.dataset.resolvedTheme = resolved;
    shell.dataset.viewport = currentViewport;
    shell.classList.toggle('is-export-mode', exportMode);
    shell.style.setProperty('--lp-base-size', currentFontSize + 'px');
    if (content.brandColor) shell.style.setProperty('--lp-brand', content.brandColor);

    $('theme-select').value = themePref;
    $('font-size-range').value = String(currentFontSize);
    $('font-size-label').textContent = currentFontSize + 'px';
    $('brand-color-picker').value = content.brandColor || '#2563EB';
    $('vp-desktop-btn').classList.toggle('is-active', currentViewport === 'desktop');
    $('vp-mobile-btn').classList.toggle('is-active', currentViewport === 'mobile');
    $('page-title-badge').textContent = content.title || '长页排版';
    $('mode-badge').textContent = content.mode === 'digest' ? '提炼解读' : '忠实精排';

    var sections = Array.isArray(content.sections) ? content.sections : [];
    var hasBody = Boolean(content.title || content.subtitle || sections.length);
    $('empty-state').hidden = hasBody;
    $('viewport-frame').hidden = !hasBody;

    var toc = $('toc-nav');
    toc.replaceChildren();
    var tocTitle = document.createElement('p');
    tocTitle.className = 'lp-toc-title';
    tocTitle.textContent = '目录导航';
    var tocList = document.createElement('ul');
    sections.forEach(function (sec, idx) {
      var id = sec.id || ('sec-' + (idx + 1));
      sec.id = id;
      var li = document.createElement('li');
      var a = document.createElement('a');
      a.href = '#' + id;
      a.textContent = sec.heading || ('章节 ' + (idx + 1));
      li.appendChild(a);
      tocList.appendChild(li);
    });
    toc.append(tocTitle, tocList);
    toc.hidden = !sections.length || exportMode;

    var article = $('article-root');
    article.lang = content.lang || 'zh-Hans';
    article.replaceChildren();

    var h1 = document.createElement('h1');
    h1.textContent = content.title || '未命名长页文章';
    if (!exportMode) {
      h1.contentEditable = 'true';
      h1.oninput = function () { content.title = h1.textContent; $('page-title-badge').textContent = content.title; scheduleSave(); };
    }
    article.appendChild(h1);

    if (content.subtitle) {
      var sub = document.createElement('p');
      sub.className = 'lp-subtitle';
      sub.textContent = content.subtitle;
      if (!exportMode) {
        sub.contentEditable = 'true';
        sub.oninput = function () { content.subtitle = sub.textContent; scheduleSave(); };
      }
      article.appendChild(sub);
    }

    var meta = document.createElement('div');
    meta.className = 'lp-meta';
    if (content.author) {
      var ma = document.createElement('span');
      ma.textContent = '作者：' + content.author;
      meta.appendChild(ma);
    }
    if (content.date) {
      var md = document.createElement('span');
      md.textContent = content.date;
      meta.appendChild(md);
    }
    var mm = document.createElement('span');
    mm.textContent = content.mode === 'digest' ? '模式：提炼解读' : '模式：忠实精排';
    meta.appendChild(mm);
    article.appendChild(meta);

    if (content.summaryCard && Array.isArray(content.summaryCard.bullets) && content.summaryCard.bullets.length) {
      var card = document.createElement('section');
      card.className = 'lp-summary-card';
      var ch = document.createElement('div');
      ch.className = 'lp-callout-title';
      ch.textContent = content.summaryCard.heading || '核心结论';
      var cul = document.createElement('ul');
      content.summaryCard.bullets.forEach(function (b) {
        var li = document.createElement('li');
        appendFormattedText(li, b);
        cul.appendChild(li);
      });
      card.append(ch, cul);
      article.appendChild(card);
    }

    sections.forEach(function (sec, idx) {
      var secEl = document.createElement('section');
      secEl.id = sec.id || ('sec-' + (idx + 1));
      if (sec.heading) {
        var h2 = document.createElement('h2');
        h2.textContent = sec.heading;
        if (!exportMode) {
          h2.contentEditable = 'true';
          h2.oninput = function () { sec.heading = h2.textContent; scheduleSave(); };
        }
        secEl.appendChild(h2);
      }
      (sec.blocks || []).forEach(function (block) {
        secEl.appendChild(renderBlock(block, !exportMode));
      });
      article.appendChild(secEl);
    });
  }

  function buildStandaloneHtml() {
    var cssText = '';
    for (var i = 0; i < document.styleSheets.length; i++) {
      try {
        var rules = document.styleSheets[i].cssRules;
        for (var j = 0; j < rules.length; j++) cssText += rules[j].cssText + '\n';
      } catch (e) {}
    }
    var resolved = resolveTheme(content.theme || 'light');
    var cloneArticle = $('article-root').cloneNode(true);
    cloneArticle.querySelectorAll('[contenteditable]').forEach(function (el) {
      el.removeAttribute('contenteditable');
    });
    var titleText = (content.title || '长页文章').replace(/[<>&"]/g, '');
    return '<!doctype html>\n<html lang="' + (content.lang || 'zh-Hans') + '"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>'
      + titleText + '</title><style>' + cssText + '\nbody{padding:24px 12px;}.lp-viewport-frame{max-width:780px;margin:0 auto;}</style></head>'
      + '<body><div class="lp-shell" data-resolved-theme="' + resolved + '" style="--lp-base-size:' + currentFontSize + 'px;--lp-brand:' + (content.brandColor || '#2563EB') + '">'
      + '<div class="lp-viewport-frame"><article class="lp-article" lang="' + (content.lang || 'zh-Hans') + '">' + cloneArticle.innerHTML + '</article></div></div></body></html>';
  }

  function saveFile(filename, data) {
    if (downloadsCap && typeof downloadsCap.save === 'function') {
      downloadsCap.save({ filename: filename, data: data });
      return;
    }
    var blob = new Blob([data], { type: 'text/html;charset=utf-8' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
  }

  function bindEvents() {
    $('vp-desktop-btn').onclick = function () { currentViewport = 'desktop'; render(); };
    $('vp-mobile-btn').onclick = function () { currentViewport = 'mobile'; render(); };
    $('theme-select').onchange = function (e) {
      content.theme = e.target.value;
      render();
      scheduleSave();
    };
    $('font-size-range').oninput = function (e) {
      currentFontSize = parseInt(e.target.value, 10) || 16;
      render();
    };
    $('brand-color-picker').oninput = function (e) {
      content.brandColor = e.target.value;
      render();
      scheduleSave();
    };
    $('add-sec-btn').onclick = function () {
      content.sections = content.sections || [];
      content.sections.push({
        id: 'sec-' + Date.now(),
        heading: '新章节标题',
        blocks: [{ type: 'paragraph', text: '点击这里可直接编辑正文内容……' }]
      });
      render();
      scheduleSave();
    };
    $('save-btn').onclick = function () { persistContent(); };
    $('seed-btn').onclick = function () {
      content = JSON.parse(JSON.stringify(DEFAULT_CONTENT));
      render();
      scheduleSave();
    };
    $('export-html-btn').onclick = function () {
      saveFile((content.title || 'long-page') + '.html', buildStandaloneHtml());
    };
    $('print-pdf-btn').onclick = function () { window.print(); };
  }

  window.__ORCA_EXPORT__ = {
    getRenderSpec: function () {
      return {
        title: content && content.title,
        theme: resolveTheme(exportTheme || (content && content.theme) || 'light'),
        viewport: currentViewport,
        scrollHeight: document.documentElement.scrollHeight
      };
    },
    buildStandaloneHtml: buildStandaloneHtml
  };

  async function init() {
    var oa = window.openArtifact;
    if (oa && typeof oa.use === 'function') {
      try { selfCap = await oa.use('artifact'); } catch (e) { selfCap = null; }
      try { downloadsCap = await oa.use('downloads'); } catch (e) { downloadsCap = null; }
    }
    if (!selfCap) {
      var banner = $('cap-banner');
      banner.hidden = false;
      banner.textContent = '提示：当前以只读预览模式打开，可导出单文件离线 HTML 或打印为 PDF，但不会回写磁盘。';
    }
    try {
      var res = await fetch('content.json', { cache: 'no-store' });
      if (res.ok) content = await res.json();
    } catch (e) {
      content = null;
    }
    if (!content || typeof content !== 'object') {
      content = { title: '', mode: 'faithful', theme: 'light', brandColor: '#2563EB', sections: [] };
    }
    if (!Array.isArray(content.sections)) content.sections = [];
    bindEvents();
    render();
  }

  init();
})();
