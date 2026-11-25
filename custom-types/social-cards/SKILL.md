---
name: social-cards
description: >-
  Make structured Chinese/bilingual social media image cards (Xiaohongshu 3:4 carousels, WeChat 21:9 headers, 1:1 share cards, and cover matrices) stored in content.json.
---

# Social Cards (社媒卡片)

An artifact of this type is a folder `<root>`. Its content lives in `<root>/content.json`, while the viewer and inline editor live in the type's own `index.html`.

## Make one

1. **Create the artifact**:
   `Artifact {"action": "publish", "type_url": "open-artifact://type/social-cards", "title": "…"}`
   The response gives `<root>` and `<url>`.
2. **Write `<root>/content.json`** with your file tools or `Artifact {"action": "publish", "url": "<url>", "files": {"content.json": "…"}}`.
3. **Read `<root>/content.json` again before editing an existing artifact**, because the person edits card copy, theme, format, and brand color directly on the page and saves back to the same file.

## `content.json` Schema

```json
{
  "title": "AI 产品周刊 · 第一期",
  "brandColor": "#E8703A",
  "theme": "editorial-light",
  "format": "xhs-3-4",
  "author": "@设计师手记",
  "seriesTag": "专栏 · 第 01 期",
  "cards": [
    {
      "id": "card-1",
      "layout": "cover",
      "badge": "COVER / 01",
      "title": "先把画幅定准，再填信息密度",
      "subtitle": "社媒卡片最常见的失误不是配色，而是每张图都想说十件事。",
      "points": [],
      "footnote": "向右滑动看拆解 →"
    },
    {
      "id": "card-2",
      "layout": "points",
      "badge": "01 / 03",
      "title": "三条信息上限原则",
      "subtitle": "单张 3:4 竖版卡片正文控制在 80–120 字内。",
      "points": [
        "主标题不超过 18 个汉字，避免三行折行",
        "要点列表保持 3–4 条短句，每条 1–2 行",
        "底部保留安全区与页码，不压平台 UI"
      ],
      "footnote": "Social Cards · Editorial"
    }
  ]
}
```

### Supported Values

- **`format`**:
  - `"xhs-3-4"` — 小红书竖版组图 `3:4` (`1080×1440`)
  - `"wechat-21-9"` — 公众号头图 `21:9` (`900×383`)
  - `"square-1-1"` — 分享方卡 `1:1` (`1080×1080`)
  - `"matrix"` — 封面矩阵（同屏预览 `21:9` + `1:1` + `3:4`）
- **`theme`**:
  - `"editorial-light"` — 杂志编辑亮色
  - `"warm-paper"` — 暖纸手账色
  - `"editorial-dark"` — 深邃暗色
  - `"swiss-grid"` — 瑞士网格高对比
- **`cards[].layout`**:
  - `"cover"` — 封面大标题卡（适合第 1 张或 `21:9` 头图）
  - `"points"` — 要点编号卡（支持 `points` 数组）
  - `"quote"` — 金句引文卡
  - `"comparison"` — 对比清单卡（`points` 偶/奇数项双栏对照，或前两项作为对照要点）
  - `"ending"` — 结尾关注/行动引导卡
- **`brandColor`**: Hex color (`#RRGGBB`). The renderer constrains lightness/chroma in OKLCH (`L ∈ [0.35, 0.85]`, `C ∈ [0.04, 0.20]`) and picks WCAG-safe foreground colors.

## Copywriting & Density Guidelines

- Keep `21:9` WeChat cover titles concise (`<= 16` CJK chars) with at most 1 short subtitle line.
- For Xiaohongshu `3:4` carousels, keep each card under ~120 CJK characters so the safe-zone ruler stays green without overflow.
- Never embed external CDN URLs or remote scripts; use system CJK typography and local `_blobs/` assets if needed.
