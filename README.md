# Prototype Studio for Orca

![Prototype Studio 项目库](assets/cover.png)

把 Anthropic 风格的设计工具链带进 Orca 工作区：**幻灯片、设计、设计系统、看板、动效**五类作品，状态栏一个图标（或 `Mod+Alt+P`）打开项目库，库内创建、打开、重命名、删除，编辑器在同一 Tab 内跳转。

| 项目库 | 画布编辑器 |
| :---: | :---: |
| ![项目库页面](assets/gallery.png) | ![画布编辑器](assets/editor.png) |

## 功能

- **项目库（Gallery）**：独立本地服务（`127.0.0.1:3480`）聚合当前工作区的设计作品，支持置顶、搜索、筛选、时间线历史；worker 被回收后库页依然存活。
- **五类设计项目**：🎬 幻灯片、🎨 设计（无限画布）、🧩 设计系统、📊 看板、▶️ 动效影片；编辑器由 vendored 的 [baoyu-design](https://github.com/JimLiu/baoyu-design) 提供。
- **项目管理**：一键创建示例、重命名、删除（二次确认，记录可恢复）、编辑器进程启停/重启。
- **工作区感知**：精确解析焦点工作区；远程/本机不可见的工作区明确拒绝，不在本机创建影子目录。
- **点击体验**：状态栏即时显示「⟳ 打开中…」，已有 Tab 直接切换，库页内置加载骨架屏与服务冷启动自动重试。
- **主题跟随宿主**：读取 Orca `settings.theme` 首帧注入；`system` 时跟随浏览器 `prefers-color-scheme`，也支持 `?scheme=dark|light` 覆盖。
- **本地接口收口**：状态变更只接受同源 `application/json` POST，GET 无法拉起编辑器或删除作品。

## 安装

要求 Orca ≥ 1.4.248。

### 通过 catalog（推荐，可自动更新）

本仓库根目录提供 [`orca-catalog.json`](orca-catalog.json)，条目以 git 源安装，按 `releases[].commit` 拉取精确版本（最新为 0.2.0）：

```bash
cat orca-catalog.json   # 交给 Orca 的 catalog URL / 社区目录收录
```

或直接把插件仓库作为 Git 源安装。任选其一，均会解析到 0.2.0：

```text
https://github.com/hubo1989/orca-plugin-design.git
https://github.com/hubo1989/orca-plugin-design.git#main
https://github.com/hubo1989/orca-plugin-design.git#v0.2.0
```

CLI 等价写法：

```bash
orca plugin install 'https://github.com/hubo1989/orca-plugin-design.git' --json
orca plugin install 'https://github.com/hubo1989/orca-plugin-design.git#v0.2.0' --json
```

> `#ref` 只接受真实存在的 branch / tag / 完整 40 位 commit SHA。本项目 tag 带 `v` 前缀（例如 `v0.2.0`）；填写 `#0.2.0`、未创建的 tag 或拼错分支会触发 `plugin_not_found`，UI 显示为「无法获取此 Git 版本。请检查 URL、#ref 和访问权限」。不带 `#ref` 时 Orca 优先选择最新 `vX.Y.Z` tag，否则回退默认分支。首次安装会停在 `approval_required`，这是权限确认，不是 Git fetch 失败。

### 从本地文件夹安装

```bash
git clone https://github.com/hubo1989/orca-plugin-design
cd orca-plugin-design
bash bin/package.sh --full        # 组装 ../prototype-studio-dist（lite/full 均含 assets、vendored 技能与缩略图工具）
# Orca → Settings → Plugins → Install from folder → 选择 ../prototype-studio-dist
```

> 从文件夹安装的是 `local-path` 源，不会自动检查更新；新版本需要重新执行 `git pull && bin/package.sh --full` 并重装一次。

## 使用

1. 点状态栏 **Design** 图标或按 `Mod+Alt+P` 打开项目库 Tab。
2. 点顶部彩色入口新建对应类型的作品。
3. 作品卡片「打开编辑」在库页同 Tab 进入编辑器，顶部返回条回到库。
4. 命令面板也可直开各类型编辑器（`Open Claude Design/Slides/Design System/Motion/Dashboard Editor`）。

## 开发

```bash
npm test                        # node --test test/
node test/smoke-gallery.mjs     # 冒烟：mock host 激活 worker + 真实 CLI 开库页
bash bin/package.sh --full      # 组装并 validate/inspect dist
orca plugin dev watch .         # 开发模式加载 + 热重载
orca plugin release-entry . --json   # 生成 catalog 的 releases 条目（HEAD 的 commit + contentHash）
```

- `src/worker.js`：trusted worker——命令/面板处理器、工作区解析、服务生命周期、Tab 切换。
- `src/gallery-server.mjs`：项目库 HTTP 服务（单文件，含前端页面与 API）。
- `src/skills-meta.mjs`：技能元数据（marker、端口、示例模板）。
- `assets/`：manifest 声明的 icon / cover / screenshots，参与 contentHash。
- `vendor/baoyu-design/`：原样 vendor，见 `NOTICE.md`。
- 所有命令/面板处理器统一经 `reg()/handle()` 包装：异常一律转 `{ok:false,error}`，不会把 rejection 冒泡成宿主「运行失败」弹窗。

发布流程见 [CATALOG.md](CATALOG.md)。

## 许可证

Mixed. 插件自身代码 MIT；`vendor/baoyu-design/` 内含 Anthropic 派生的技能指令与编辑器资产，归 Anthropic 所有，不随 MIT 发布。详见 `LICENSE` 与 `NOTICE.md`。
