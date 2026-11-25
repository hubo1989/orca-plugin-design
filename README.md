# Orca-Design

![Orca-Design 项目库](assets/cover.png)

把 [Open Artifact](https://github.com/JimLiu/open-artifact) 设计工作流带进 Orca 工作区：支持 **9 类内置作品（幻灯片、设计画布、设计系统、白板、电子表格、数据看板、协作文档、短动画、自由页面）+ 自定义 `.oatype` 类型 + 老 `.design/` 兼容**，状态栏一个图标（或 `Mod+Alt+P`）打开项目库，同 Tab 内嵌 Open Artifact Shell 编辑器。

| 项目库 | 画布编辑器 |
| :---: | :---: |
| ![项目库页面](assets/gallery.png) | ![画布编辑器](assets/editor.png) |

## 快速开始

1. 在 Orca 中打开任意本机工作区。
2. 点状态栏 **Design**（图标 `layers`），或按 `Mod+Alt+P`。
3. 项目库首屏 `< 1s` 秒开；若本机尚未安装 Open Artifact 运行时，后台自动静默按需下载（优先复用 `~/.agents/open-artifact/runtime/` 已有运行时，0 重复下载）。

作品默认写到 `<工作区>/.design/<名称>/` 或 Open Artifact 标准目录，随仓库一起版本管理。

## 九类内置作品与兼容映射

| 类型 | 说明 | 识别文件 | 兼容旧类型 |
| --- | --- | --- | --- |
| `slides` 幻灯片 | 16:9 / 4:3 可演示幻灯片，导出 PDF/PPTX/HTML/PNG | `project/deck.json` | `claude-slides` |
| `design` 设计画布 | 无限画布与多画板，导出 PNG/JPEG/PDF/HTML | `project/canvas.json` | `claude-design` |
| `design-system` 设计系统 | 颜色/字体/间距 token、组件预览与品牌手册 | `project/design-system.json` | `claude-design-system` |
| `whiteboard` 白板 | 无限白板、便签、流程图与手绘要素 | `db/board/meta.json` | — |
| `sheets` 电子表格 | 内置公式引擎，支持 XLSX/CSV 导入导出 | `sheet/sheet.json` | — |
| `data` 数据看板 | 实时指标、图表与报表 | `db/dash/meta.json` | `claude-dashboard` |
| `docs` 协作文档 | 多标签富文本文档，支持 Word/PDF/MD 导入导出 | `doc/doc.json` | — |
| `motion` 短动画 | 逐场景时间轴动画，导出 MP4/GIF/HTML | `db/film/meta.json` | `claude-motion` |
| `page` 自由页面 | 单页交互 HTML 作品 | `index.html` + `.artifact.json` | — |

## 方案 B 分体分发运行时

本插件采用轻量薄壳分发（打包体积 `< 8 MiB`），不随 Git 或插件包分发大体积运行时压缩包：

1. **优先复用本机共享运行时**：自动识别 `$ORCA_DESIGN_OA_RUNTIME` / `$OPEN_ARTIFACT_RUNTIME_DIR` 及 `~/.agents/open-artifact/runtime/` 已安装的同版或兼容新版运行时（0 下载）。
2. **按需后台下载**：缺失时严格校验 `vendor/runtime-manifest.json` 的 `sha512` 完整性（主源 `registry.npmjs.org`，失败自动删包切换 `registry.npmmirror.com`），原子解压至 `~/.agents/open-artifact/runtime/<version>/`。
3. **离线 `.tgz` 导入**：无外网环境可在面板「类型与运行时」或下载等待页直接导入本地 `@open-artifact/cli-<version>.tgz`。

## 数据落在哪

| 内容 | 位置 |
| --- | --- |
| 作品本体 | `<工作区>/.design/<名称>/` 或工作区 `artifacts/` |
| 应用数据目录 | `~/Library/Application Support/orca/orca-design`（支持 `ORCA_DESIGN_HOME` 覆盖，自动只读复制迁移旧 `baoyu-design/` 数据） |
| 共享运行时 | `~/.agents/open-artifact/runtime/<version>/`（支持 `OPEN_ARTIFACT_HOME` 覆盖） |
| 项目库服务 | `127.0.0.1:3480`，独立进程，worker 被回收后库页仍可用 |

## 开发与验证

```bash
npm test                                    # node --test 'test/**/*.mjs'
node test/smoke-gallery.mjs                 # 冒烟：mock host 激活 worker + 开库页
node tools/vendor-open-artifact.mjs --check # 校验 runtime-manifest 与 harness-kit 产物
bash bin/package.sh                         # 组装 dist（< 8 MiB）并 validate/inspect
```

## 许可证

- **插件本体**：MIT License（见 `LICENSE`）。
- **Open Artifact Harness SDK 与按需运行时**：Apache License 2.0（见 `NOTICE.md` 与 `vendor/LICENSE.open-artifact`）。
