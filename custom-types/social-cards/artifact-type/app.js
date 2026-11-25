/* SPDX-License-Identifier: MIT */
(function () {
  'use strict';

  var FORMAT_SPECS = {
    'xhs-3-4': { label: '小红书 3:4', width: 1080, height: 1440 },
    'wechat-21-9': { label: '公众号 21:9', width: 900, height: 383 },
    'square-1-1': { label: '分享方卡 1:1', width: 1080, height: 1080 }
  };

  var DEFAULT_CONTENT = {
    title: 'AI 产品设计周刊 · 示例',
    brandColor: '#E8703A',
    theme: 'editorial-light',
    format: 'xhs-3-4',
    author: '@设计师手记',
    seriesTag: '专栏 · 第 01 期',
    cards: [
      {
        id: 'card-1',
        layout: 'cover',
        badge: 'COVER / 01',
        title: '好卡片的三个结构判断',
        subtitle: '先定画幅再填密度，让社媒图文一目了然。',
        points: [],
        footnote: '滑动查看 →'
      },
      {
        id: 'card-2',
        layout: 'points',
        badge: '01 / 02',
        title: '控制单卡文字容量',
        subtitle: '3:4 竖版卡片建议每卡不超过 120 字',
        points: [
          '主标题 18 字以内，视觉重心突出',
          '要点拆成 3–4 条短句，避免大段墙文本',
          '开启安全区标尺防止内容压边或溢出'
        ],
        footnote: 'Social Cards'
      }
    ]
  };

  var $ = function (id) { return document.getElementById(id); };
  var shell = $('app');
  var selfCap = null;
  var downloadsCap = null;
  var content = null;
  var selectedIndex = 0;
  var showRulers = true;
  var saveTimer = null;

  var params = new URLSearchParams(window.location.search);
  var exportMode = params.get('export') === '1';
  var exportCardParam = params.has('card') ? parseInt(params.get('card'), 10) : null;
  var exportFormatParam = params.get('format') || null;

  function clone(obj) {
    return JSON.parse(JSON.stringify(obj));
  }

  function applyBrandColor(rawHex) {
    var colorApi = window.OrcaColorTheme;
    var candidate = /^#?(?:[\da-f]{3}|[\da-f]{6})$/i.test((rawHex || '').trim()) ? rawHex.trim() : '#E8703A';
    if (!candidate.startsWith('#')) candidate = '#' + candidate;
    if (!colorApi) {
      shell.style.setProperty('--sc-brand', candidate);
      return { hex: candidate, changed: false };
    }
    var constrained = colorApi.constrainBrandColor(candidate);
    var fg = colorApi.pickTextColor(constrained.hex);
    shell.style.setProperty('--sc-brand', constrained.hex);
    shell.style.setProperty('--sc-brand-fg', fg);
    $('brand-color-picker').value = constrained.hex;
    $('brand-color-hex').value = constrained.hex;
    $('brand-oklch-note').textContent = constrained.changed
      ? 'OKLCH 已约束 → ' + constrained.hex
      : 'OKLCH L=' + constrained.oklch.L.toFixed(2);
    return constrained;
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
      setStatus('只读模式（未授予 artifact 写入能力）');
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

  function buildCardElement(card, idx, ratioKey) {
    var slot = document.createElement('div');
    slot.className = 'sc-card-slot';

    var meta = document.createElement('div');
    meta.className = 'sc-slot-meta';
    var ratioLabel = FORMAT_SPECS[ratioKey] ? FORMAT_SPECS[ratioKey].label : ratioKey;
    var metaLeft = document.createElement('span');
    metaLeft.textContent = '卡片 #' + (idx + 1) + ' · ' + ratioLabel;
    var metaRight = document.createElement('span');
    metaRight.className = 'sc-overflow-badge';
    meta.append(metaLeft, metaRight);

    var el = document.createElement('article');
    el.className = 'sc-card' + (idx === selectedIndex ? ' is-selected' : '');
    el.dataset.ratio = ratioKey;
    el.dataset.layout = card.layout || 'points';
    el.dataset.cardIndex = String(idx);

    var safezone = document.createElement('div');
    safezone.className = 'sc-card-safezone';

    var head = document.createElement('div');
    head.className = 'sc-card-head';
    var seriesSpan = document.createElement('span');
    seriesSpan.textContent = content.seriesTag || content.title || '';
    var badgeSpan = document.createElement('span');
    badgeSpan.className = 'sc-card-badge';
    badgeSpan.textContent = card.badge || String(idx + 1).padStart(2, '0');
    head.append(seriesSpan, badgeSpan);

    var body = document.createElement('div');
    body.className = 'sc-card-body';
    var h3 = document.createElement('h3');
    h3.className = 'sc-card-title';
    h3.textContent = card.title || '未命名卡片';
    body.appendChild(h3);

    if (card.subtitle) {
      var sub = document.createElement('p');
      sub.className = 'sc-card-subtitle';
      sub.textContent = card.subtitle;
      body.appendChild(sub);
    }

    var pts = Array.isArray(card.points) ? card.points.filter(Boolean) : [];
    if (pts.length > 0 && ratioKey !== 'wechat-21-9') {
      var ul = document.createElement('ul');
      ul.className = 'sc-card-points';
      pts.forEach(function (text) {
        var li = document.createElement('li');
        li.textContent = text;
        ul.appendChild(li);
      });
      body.appendChild(ul);
    }

    var foot = document.createElement('div');
    foot.className = 'sc-card-foot';
    var footLeft = document.createElement('span');
    footLeft.textContent = card.footnote || '';
    var footRight = document.createElement('span');
    footRight.textContent = content.author || '';
    foot.append(footLeft, footRight);

    el.append(safezone, head, body, foot);
    el.onclick = function () {
      selectedIndex = idx;
      render();
    };

    slot.append(meta, el);
    return { slot: slot, cardEl: el, bodyEl: body, warnEl: metaRight };
  }

  function measureOverflows(rendered) {
    var warnings = [];
    rendered.forEach(function (item, i) {
      var overflow = item.bodyEl.scrollHeight > item.bodyEl.clientHeight + 2;
      item.cardEl.classList.toggle('is-overflowing', overflow);
      item.warnEl.textContent = overflow ? '⚠ 内容超出安全区' : '✓ 安全区内';
      if (!overflow) item.warnEl.style.color = 'var(--sc-ui-muted)';
      if (overflow) warnings.push('卡片 #' + (i + 1) + ' 正文高度超出安全区，请精简文字或拆分卡片。');
    });
    var report = $('overflow-report');
    if (warnings.length) {
      report.classList.add('is-warn');
      report.textContent = warnings.join(' ');
    } else {
      report.classList.remove('is-warn');
      report.textContent = '排版标尺：所有卡片均在安全区内（无文字截断或溢出）。';
    }
  }

  function syncInspector() {
    var hasCards = content && Array.isArray(content.cards) && content.cards.length > 0;
    $('inspector').hidden = !hasCards || exportMode;
    if (!hasCards) return;
    if (selectedIndex >= content.cards.length) selectedIndex = content.cards.length - 1;
    if (selectedIndex < 0) selectedIndex = 0;

    var card = content.cards[selectedIndex];
    $('deck-title-input').value = content.title || '';
    $('series-tag-input').value = content.seriesTag || '';
    $('author-input').value = content.author || '';
    $('card-layout-input').value = card.layout || 'points';
    $('card-badge-input').value = card.badge || '';
    $('card-title-input').value = card.title || '';
    $('card-subtitle-input').value = card.subtitle || '';
    $('card-points-input').value = Array.isArray(card.points) ? card.points.join('\n') : '';
    $('card-footnote-input').value = card.footnote || '';
  }

  function render() {
    if (!content) return;
    var format = exportFormatParam || content.format || 'xhs-3-4';
    var theme = content.theme || 'editorial-light';
    shell.dataset.theme = theme;
    shell.dataset.format = format;
    shell.dataset.rulers = showRulers ? 'true' : 'false';
    shell.classList.toggle('is-export-mode', exportMode);
    $('format-select').value = format;
    $('theme-select').value = theme;
    $('deck-title-badge').textContent = content.title || '社媒卡片';
    applyBrandColor(content.brandColor || '#E8703A');

    var cards = Array.isArray(content.cards) ? content.cards : [];
    $('empty-state').hidden = cards.length > 0;
    var grid = $('stage-grid');
    grid.replaceChildren();

    var rendered = [];
    if (cards.length > 0) {
      if (exportMode && exportCardParam !== null && !Number.isNaN(exportCardParam)) {
        var targetIdx = Math.max(0, Math.min(cards.length - 1, exportCardParam));
        var ratio = format === 'matrix' ? 'xhs-3-4' : format;
        var builtSingle = buildCardElement(cards[targetIdx], targetIdx, ratio);
        grid.appendChild(builtSingle.slot);
        rendered.push(builtSingle);
      } else if (format === 'matrix') {
        var cover = cards[selectedIndex] || cards[0];
        ['wechat-21-9', 'square-1-1', 'xhs-3-4'].forEach(function (ratioKey) {
          var built = buildCardElement(cover, selectedIndex, ratioKey);
          grid.appendChild(built.slot);
          rendered.push(built);
        });
      } else {
        cards.forEach(function (card, idx) {
          var built = buildCardElement(card, idx, format);
          grid.appendChild(built.slot);
          rendered.push(built);
        });
      }
    }

    syncInspector();
    requestAnimationFrame(function () { measureOverflows(rendered); });
  }

  function saveFile(filename, data) {
    if (downloadsCap && typeof downloadsCap.save === 'function') {
      downloadsCap.save({ filename: filename, data: data });
      return;
    }
    var blob = new Blob([data], { type: 'text/plain;charset=utf-8' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
  }

  function buildStandaloneHtml() {
    var cssText = '';
    for (var i = 0; i < document.styleSheets.length; i++) {
      try {
        var rules = document.styleSheets[i].cssRules;
        for (var j = 0; j < rules.length; j++) cssText += rules[j].cssText + '\n';
      } catch (e) {}
    }
    var cloneStage = $('stage-grid').cloneNode(true);
    var safeTitle = (content.title || '社媒卡片').replace(/[<>&"]/g, '');
    return '<!doctype html>\n<html lang="zh-Hans"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>'
      + safeTitle + '</title><style>' + cssText + '\nbody{padding:24px;}.sc-card-safezone,.sc-slot-meta{display:none!important;}</style></head><body>'
      + '<div class="sc-shell" data-theme="' + (content.theme || 'editorial-light') + '" style="--sc-brand:' + (content.brandColor || '#E8703A') + '"><div class="sc-stage-grid">'
      + cloneStage.innerHTML + '</div></div></body></html>';
  }

  function bindEvents() {
    $('format-select').onchange = function (e) {
      content.format = e.target.value;
      render();
      scheduleSave();
    };
    $('theme-select').onchange = function (e) {
      content.theme = e.target.value;
      render();
      scheduleSave();
    };
    $('brand-color-picker').oninput = function (e) {
      content.brandColor = applyBrandColor(e.target.value).hex;
      scheduleSave();
    };
    $('brand-color-hex').onchange = function (e) {
      content.brandColor = applyBrandColor(e.target.value).hex;
      scheduleSave();
    };
    $('ruler-toggle').onchange = function (e) {
      showRulers = !!e.target.checked;
      render();
    };
    $('add-card-btn').onclick = function () {
      content.cards = content.cards || [];
      var n = content.cards.length + 1;
      content.cards.push({
        id: 'card-' + Date.now(),
        layout: 'points',
        badge: String(n).padStart(2, '0'),
        title: '新卡片标题',
        subtitle: '一句话补充说明',
        points: ['第一条要点', '第二条要点'],
        footnote: content.title || ''
      });
      selectedIndex = content.cards.length - 1;
      render();
      scheduleSave();
    };
    $('dup-card-btn').onclick = function () {
      if (!content.cards.length) return;
      var copy = clone(content.cards[selectedIndex]);
      copy.id = 'card-' + Date.now();
      content.cards.splice(selectedIndex + 1, 0, copy);
      selectedIndex += 1;
      render();
      scheduleSave();
    };
    $('del-card-btn').onclick = function () {
      if (!content.cards.length) return;
      content.cards.splice(selectedIndex, 1);
      selectedIndex = Math.max(0, selectedIndex - 1);
      render();
      scheduleSave();
    };
    $('move-up-btn').onclick = function () {
      if (selectedIndex <= 0) return;
      var tmp = content.cards[selectedIndex - 1];
      content.cards[selectedIndex - 1] = content.cards[selectedIndex];
      content.cards[selectedIndex] = tmp;
      selectedIndex -= 1;
      render();
      scheduleSave();
    };
    $('move-down-btn').onclick = function () {
      if (selectedIndex >= content.cards.length - 1) return;
      var tmp = content.cards[selectedIndex + 1];
      content.cards[selectedIndex + 1] = content.cards[selectedIndex];
      content.cards[selectedIndex] = tmp;
      selectedIndex += 1;
      render();
      scheduleSave();
    };
    $('save-btn').onclick = function () { persistContent(); };
    $('seed-btn').onclick = function () {
      content = clone(DEFAULT_CONTENT);
      selectedIndex = 0;
      render();
      scheduleSave();
    };
    $('export-json-btn').onclick = function () {
      saveFile('content.json', JSON.stringify(content, null, 2) + '\n');
    };
    $('export-html-btn').onclick = function () {
      saveFile((content.title || 'social-cards') + '.html', buildStandaloneHtml());
    };
    $('print-btn').onclick = function () { window.print(); };

    var bindInput = function (id, handler) {
      $(id).addEventListener('input', function (e) {
        handler(e.target.value);
        render();
        scheduleSave();
      });
    };
    bindInput('deck-title-input', function (v) { content.title = v; });
    bindInput('series-tag-input', function (v) { content.seriesTag = v; });
    bindInput('author-input', function (v) { content.author = v; });
    bindInput('card-layout-input', function (v) { content.cards[selectedIndex].layout = v; });
    bindInput('card-badge-input', function (v) { content.cards[selectedIndex].badge = v; });
    bindInput('card-title-input', function (v) { content.cards[selectedIndex].title = v; });
    bindInput('card-subtitle-input', function (v) { content.cards[selectedIndex].subtitle = v; });
    bindInput('card-points-input', function (v) {
      content.cards[selectedIndex].points = v.split('\n').map(function (s) { return s.trim(); }).filter(Boolean);
    });
    bindInput('card-footnote-input', function (v) { content.cards[selectedIndex].footnote = v; });
  }

  window.__ORCA_EXPORT__ = {
    getRenderSpec: function () {
      var fmt = exportFormatParam || (content && content.format) || 'xhs-3-4';
      var spec = FORMAT_SPECS[fmt] || FORMAT_SPECS['xhs-3-4'];
      return {
        format: fmt,
        width: spec.width,
        height: spec.height,
        cardCount: content && Array.isArray(content.cards) ? content.cards.length : 0
      };
    },
    setCard: function (idx, fmt) {
      if (fmt) exportFormatParam = fmt;
      exportMode = true;
      exportCardParam = idx;
      render();
    }
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
      banner.textContent = '提示：当前以只读预览模式打开（未授予 artifact 写入能力），页面修改可导出 JSON，但不会写回磁盘。';
    }
    try {
      var res = await fetch('content.json', { cache: 'no-store' });
      if (res.ok) {
        content = await res.json();
      }
    } catch (e) {
      content = null;
    }
    if (!content || typeof content !== 'object') {
      content = { title: '未命名社媒卡片', brandColor: '#E8703A', theme: 'editorial-light', format: 'xhs-3-4', cards: [] };
    }
    if (!Array.isArray(content.cards)) content.cards = [];
    bindEvents();
    render();
  }

  init();
})();
