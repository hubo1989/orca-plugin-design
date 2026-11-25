---
name: long-page
description: >-
  Lay out articles, research notes, and newsletters into responsive Chinese-English long-form web pages stored in content.json, supporting faithful layout and distilled digest modes plus CJK T1-T10 typography.
---

# Long Page (长页排版)

An artifact of this type is a folder `<root>`. Its content lives in `<root>/content.json`, while the reader/editor lives in the type's own `index.html`.

## Make one

1. **Create the artifact**:
   `Artifact {"action": "publish", "type_url": "open-artifact://type/long-page", "title": "…"}`
   The response gives `<root>` and `<url>`.
2. **Choose the writing mode** according to the person's intent:
   - **`mode: "faithful"` (忠实精排模式)**: Keep every word of the source prose intact. Do NOT rewrite, summarize, or omit original sentences. Only map headings, paragraphs, callouts, quotes, lists, tables, and code blocks into `content.json`.
   - **`mode: "digest"` (提炼解读模式)**: Distill long source material into an executive `summaryCard` (`heading` + `bullets`), clear section anchors, callouts, and structured takeaways.
3. **Write `<root>/content.json`** with your file tools or `Artifact {"action": "publish", "url": "<url>", "files": {"content.json": "…"}}`.
4. **Read `<root>/content.json` again before editing an existing artifact**, because the person can edit headings, paragraphs, theme, and viewport width directly on the page.

## `content.json` Schema

```json
{
  "title": "主标题",
  "subtitle": "导读或副标题",
  "mode": "faithful",
  "theme": "light",
  "brandColor": "#2563EB",
  "author": "作者名",
  "date": "2026-11-26",
  "lang": "zh-Hans",
  "summaryCard": {
    "heading": "核心结论",
    "bullets": [
      "结论一：……",
      "结论二：……"
    ]
  },
  "sections": [
    {
      "id": "section-1",
      "heading": "一、背景与判断",
      "blocks": [
        { "type": "paragraph", "text": "正文段落支持“中文弯引号”、‘嵌套引号’、省略号……以及破折号——完整排版。" },
        { "type": "callout", "tone": "info", "title": "提示", "text": "关键背景或约束条件。" },
        { "type": "quote", "text": "原话引文内容。", "cite": "来源说明" },
        { "type": "list", "ordered": false, "items": ["要点 A", "要点 B"] },
        { "type": "table", "headers": ["项目", "说明"], "rows": [["行长", "36em"]] },
        { "type": "code", "lang": "bash", "code": "echo 'hello'" }
      ]
    }
  ]
}
```

### Supported `blocks[].type`

- `paragraph`: `{ "type": "paragraph", "text": "..." }`
- `subheading`: `{ "type": "subheading", "text": "..." }` (renders `<h3>`)
- `callout`: `{ "type": "callout", "tone": "info|tip|warn", "title": "...", "text": "..." }`
- `quote`: `{ "type": "quote", "text": "...", "cite": "..." }`
- `list`: `{ "type": "list", "ordered": true|false, "items": ["..."] }`
- `table`: `{ "type": "table", "headers": ["..."], "rows": [["..."]] }`
- `code`: `{ "type": "code", "lang": "js", "code": "..." }`

## CJK T1–T10 Typography Contract

- Use simplified Chinese curved quotes `“…”` and `‘…’`, two-character ellipsis `……`, and two-em-dash `——` (never `...` or `--` in Chinese prose).
- Do not insert manual ASCII spaces around English words or numbers unless required inside code/URLs; the renderer handles script-boundary spacing (`T3`) automatically while leaving URLs, emails, and code untouched.
- Use `lang="zh-Hans"` (or `"zh-Hant"`), never rely on italics (`font-style: italic`) for Chinese emphasis, and never embed external CDN assets.
