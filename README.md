# Prototype Studio for Orca

一个 Orca 插件：把 Anthropic 风格的设计工具链（画布 / 幻灯片 / 设计系统 / 动效影片）带进 Orca 工作区。状态栏一个图标（或 `Mod+Alt+P`）打开项目库，库内直接创建、打开、重命名、删除设计项目，编辑器在库页内同 tab 跳转。

## 功能

- **项目库（Gallery）**：独立本地服务（`127.0.0.1:3480`）聚合当前工作区所有设计项目，按最近修改排序，支持搜索与按类别过滤；worker 被回收后库页依然存活。
- **四类设计项目**：🎨 画布（claude-design）、🖼️ 幻灯片（claude-slides）、🧩 设计系统（claude-design-system）、🎬 动效影片（claude-motion），编辑器由 vendored 的 baoyu-design 提供。
- **示例脚手架**：库内一键创建带校验的示例项目（`artifact.mjs check` problems=0）。
- **项目管理**：重命名（同步更新索引标题）、删除（二次确认）、启动/停止/重启编辑器进程。
- **工作区感知**：通过 profile 库 `activeWorktreeId` + agent 事件桥精确解析焦点工作区，不做名称猜测；插件安装目录内的写入会被拒绝。
- **点击体验**：点击后状态栏即时显示「⟳ 打开中…」，已有 tab 直接切换不重复开；库页内置加载骨架屏与服务冷启动自动重试。

## 安装

```bash
git clone https://github.com/<you>/orca-prototype-studio
cd orca-prototype-studio
bash bin/package.sh --full        # 组装 dist/（含 vendored 技能）
# 在 Orca 中：Settings → Plugins → Install from folder → 选择 ../orca-prototype-studio-dist
```

要求：Orca ≥ 1.4.248（statusBar.update / 浏览器 tab CLI）。

## 使用

1. 点击状态栏 **Design** 图标或按 `Mod+Alt+P` → 打开项目库 tab。
2. 库内「＋ 画布 / ＋ 幻灯片 / ＋ 设计系统」创建示例项目，或在面板里让工作区 agent 参考项目目录继续完善。
3. 「打开编辑」在库页内同 tab 进入编辑器；顶部返回条回到项目库。
4. 命令面板也有 `Open Claude Design/Slides/Design System/Motion Editor` 直开对应类型第一个项目。

## 开发

```bash
npm test                        # node --test test/
node test/smoke-gallery.mjs     # 冒烟：mock host 激活 worker + 真实 CLI 开库页
bash bin/package.sh --full      # 组装并 validate/inspect dist
orca plugin dev watch .         # 开发模式加载 + 热重载
```

- `src/worker.js`：trusted worker——命令/面板处理器、工作区解析、项目库服务生命周期、tab 切换。
- `src/gallery-server.mjs`：项目库 HTTP 服务（单文件，含前端页面与 API）。
- `vendor/baoyu-design/`：[JimLiu/baoyu-design](https://github.com/JimLiu/baoyu-design) 的原样 vendor，提供各技能编辑器。
- 所有命令/面板处理器统一经 `reg()/handle()` 包装：异常一律转 `{ok:false,error}`，不会把 rejection 冒泡成宿主「运行失败」弹窗。

## 许可证

Mixed. 插件自身代码采用 MIT；`vendor/baoyu-design/` 内含 Anthropic 派生的技能指令与编辑器资产，归 Anthropic 所有，不随 MIT 发布。详见 `LICENSE` 与 `NOTICE.md`。
