# CJK 排版规则表：guizang T1–T10 本地化

供 vendor 技能提示词与 `references/layouts.json` 同级引用，面向生成 HTML 作品的 Agent。本文是排版约束，不改变版式登记表；幻灯片的字号、行距等若有专属要求，采用两者中更严格且适合该载体的要求。

“已实施”仅指任务指定的库页弹窗现状，不代表所有生成作品均已应用，也不表示本次重新验证了该 UI；“建议”是生成作品应采用的规则。数值若为项目默认或行业惯例，会明确标出，不将其冒充 WCAG 的强制值。

| 编号 | 规则名 | 具体可执行约束（数值化） | 依据与来源 | 状态 |
| --- | --- | --- | --- | --- |
| T1 | 正文行长 | 中文连续正文容器使用 `max-inline-size: 36em; inline-size: 100%; box-sizing: border-box`；两侧内边距各至少 `1em`，窄屏不得横向溢出。`em` 以正文容器字号计算；36em 约为 36 个全角字宽，不是固定字符计数，代码和表格可独立滚动。 | 项目默认 36em；[WCAG 2.2 SC 1.4.8（AAA）理解文档][visual]提出 CJK 每行不超过 40 字的视觉呈现机制，36em 为本项目留余量的选择，并非其原文指定值。 | **已实施**：库页弹窗行长 36em；其他作品建议采用。 |
| T2 | 正文行距与用户覆盖 | 连续正文使用无单位 `line-height: 1.7`；段间距默认 `1em`。不得以固定高度或 `overflow: hidden` 裁掉正文；用户改为行高 `1.5`、段后距 `2em`、字距 `0.12em`、词距 `0.16em` 时仍须完整可读、可操作；按实际语言适用的间距项目检查。 | 1.7 与默认段距是项目选择；[WCAG 2.2 SC 1.4.12（AA）理解文档][spacing]规定的是允许用户覆盖间距而不丢失内容或功能，不是要求作者默认使用上述覆盖值。 | **已实施**：库页弹窗行距 1.7；用户覆盖兼容性建议逐作品检查。 |
| T3 | 中西文混排间距 | 汉字与相邻拉丁单词或阿拉伯数字之间目标间距 `0.25em`；仅在文字脚本边界加距，不对整段设 `letter-spacing: 0.25em`。原生方案评估 `text-spacing: normal` / `text-autospace: normal`；暂用脚本边界的 inline 包装与逻辑 margin 实现，单一边界只加一次，不再叠加手工空格；URL、代码、邮箱保持原串。 | [CLREQ][clreq]的中西文混排间距与[CSS Text Level 4][css-text]的脚本间自动间距；0.25em 为项目目标。CSS 草案能力须按目标浏览器实测，不将属性解析成功视为排版效果成立。 | **建议**；`text-spacing` 原生统一方案**待 Chromium 支持**，此标记不表示其全部子属性均不受支持。 |
| T4 | 标点避头尾与悬挂 | 设置 `lang="zh-Hans"` 或实际使用的 `zh-Hant`，正文用 `line-break: strict; word-break: normal; overflow-wrap: break-word`。验收时每一行均不得以 `，。！？：；、）》】”’` 开头，也不得以 `（《【“‘` 结尾；发现浏览器未处理的组合时，对标点与相邻 1 字局部设 `white-space: nowrap`，禁止整段不换行。可渐进增强 `hanging-punctuation: first allow-end`，悬出预算不超过 `1em`，并预留外侧空间；不支持时保留正常标点宽度。 | [CLREQ][clreq]的行首行尾禁则、标点挤压与悬挂处理；[CSS Text Level 4][css-text]定义相关换行和悬挂属性。1em 是项目布局预算，悬挂不能替代禁则。 | **建议**；悬挂效果须按目标浏览器检查。 |
| T5 | 中文引号 | 简体横排正文一级引用用 `“…”`（U+201C/U+201D），嵌套一级用 `‘…’`（U+2018/U+2019）；每一对必须闭合，不以 ASCII 直引号替代正文引号。代码、JSON 和原样引文不替换；繁体或竖排可按地域约定使用 `「…」` / `『…』`，同一作品保持 1 套体系。 | [CLREQ][clreq]的引号字形与不同地区用法；弯引号是本项目简体横排默认，而非所有中文地区的统一要求。 | **建议**。 |
| T6 | 省略号与破折号 | 省略号采用 `…`（U+2026），中文省略写作连续 2 个 `…`，即 `……`；英文段落可用单个 `…`。中文破折号用连续 2 个 `—`（U+2014），即 `——`；不用 3 个句点或 2 个连字符代替。用局部 `white-space: nowrap` 保证 `……`、`——` 内部 0 次换行，不改变原样代码或数据。 | [CLREQ][clreq]的省略号、破折号及不可分离处理；字符数量遵循中文排版惯例，英文与中文分别处理。 | **建议**。 |
| T7 | 数字与单位 | 正文计量值使用半角数字；数字与拉丁单位符号之间放 1 个不换行空格 U+00A0，如 `12 px`、`20 kg`、`25 °C`。角度符号紧接数值，如 `90°`；中文量词如 `3个` 按 T3 处理，不额外插入单位空格。百分数在中文一般文案统一用 `50%`，科学计量文案可用 `50 %`，同一作品不得混用；CSS、JSON、URL 等机器语法 0 次改写。 | 数字、单位留空及角度例外为计量排版行业惯例；[CLREQ][clreq]提供中西文数字混排背景。百分号的两种风格是项目按内容领域选定的约定，并非 WCAG 要求。 | **建议**。 |
| T8 | 中文强调 | 中文正文的强调不得仅使用斜体（`font-style: italic` 次数为 0）；用语义 `<strong>` 配合 `font-weight: 600–700`，或 `text-emphasis: filled dot; text-emphasis-position: under right`。使用着重号时检查 T2 的 1.7 行高下无碰撞；全段强调最多 1 种主样式，不仅依赖颜色表达含义。拉丁书名、变量等按其语言习惯处理。 | [CLREQ][clreq]的着重号处理及[CSS Text Decoration Level 3][css-decor]的 `text-emphasis`；“中文不用斜体”与字重范围是项目可读性约定。 | **建议**。 |
| T9 | 标题层级与字号阶梯 | 普通文档基准正文 `1rem`（通常 16px）；h1/h2/h3/h4 依次用 `2rem / 1.5rem / 1.25rem / 1.125rem`（基准下 32/24/20/18px），标题行高 `1.3`、字重 `600–700`。每页 1 个主 h1，结构层级逐级下降，不以字号模拟标题；不以固定 px 锁死用户缩放。幻灯片遵循 `references/layouts.json` 的专属阶梯，如 S01 标题至少 72px，不套用普通文档的 32px。 | 字号、比例与单 h1 为项目设计约定；[WCAG 2.2 SC 1.4.8（AAA）理解文档][visual]支持可读、可调整的文本呈现，但不规定该字号阶梯。 | **建议**。 |
| T10 | 暗色模式对比度 | 暗色模式全部正文、标题、注释、占位提示和链接文字与实际背景的对比度均须 `≥4.5:1`；本项目对大字也使用此门槛。分别检查默认、hover、focus、visited、错误状态；半透明文字先与背景合成再计算，渐变或图片背景取文字覆盖范围最差值。不得仅以降低透明度表达次要文字而使其低于门槛。 | [WCAG 2.2 SC 1.4.3（AA）理解文档][contrast]要求普通文字至少 4.5:1，大字可放宽为 3:1；本项目统一使用更严格的 4.5:1。相对亮度对比公式为 `(L较亮 + 0.05) / (L较暗 + 0.05)`，L 应由线性化 sRGB 计算。 | **建议**；生成后须对实际配色测量。 |

## Agent 应用与验收

1. 生成前按载体选择普通文档或幻灯片字号，并标明语言；生成后逐项核对 T1–T10，不将“建议”写成“已验证”。
2. 以 320px、768px、1440px 视口检查正文断行与溢出；使用含中英文、数字单位、两层引号、`……` 和 `——` 的真实段落，检查 T3–T7。
3. 在目标 Chromium 版本验证自动间距和标点悬挂；不支持的 CSS 仍须有可读的基础布局。复制正文检查 URL、代码和计量值没有被插入额外字符。
4. 检查 200% 文本缩放及 T2 用户间距覆盖；逐状态测量暗色模式文字对比度，保留实际检测结果。

## 来源

CLREQ、CSS 草案与 WCAG 理解文档的性质不同：CLREQ 提供中文排版需求，CSS 定义实现能力，WCAG 理解文档解释成功标准；项目数值建议不等于规范强制条文。来源采用文档级链接，避免依赖易变化的章节锚点。

[clreq]: https://www.w3.org/TR/clreq/ "W3C 中文排版需求（CLREQ）"
[visual]: https://www.w3.org/WAI/WCAG22/Understanding/visual-presentation.html "WCAG 2.2 Understanding SC 1.4.8 Visual Presentation"
[spacing]: https://www.w3.org/WAI/WCAG22/Understanding/text-spacing.html "WCAG 2.2 Understanding SC 1.4.12 Text Spacing"
[contrast]: https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html "WCAG 2.2 Understanding SC 1.4.3 Contrast (Minimum)"
[css-text]: https://www.w3.org/TR/css-text-4/ "CSS Text Module Level 4"
[css-decor]: https://www.w3.org/TR/css-text-decor-3/ "CSS Text Decoration Module Level 3"
