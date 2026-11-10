# 发布纪要（Field Notes）

每个发布版本按四段式记录真机会会话实测：**已修（带根因）/ 不是插件的问题 / 待验证 / 交给上游**。与 [CATALOG.md](CATALOG.md) 的机械发布步骤并列为发布 checklist 两件套。灵感来自 guizang 的发布纪律。

## 0.2.0 · 2026-11-08

### 已修（带根因）

- **评审收口轮 · 2026-11-10**：catalog 0.2.0 pin 到最终代码提交、dist 运行时断言、GET 状态变更关闭、413 请求体上限、无行为支撑的 `appearance:write` 撤除；根因与验证命令见本节上方 6 条。
- **点击插件「运行失败」**：`openGalleryTab` 调用未定义的 `orcaTab(...)`（只定义了 `orcaTabCreate`），ReferenceError 直接冒泡使命令 promise 拒绝。修复：补通用 helper，并把 tab list/switch 包进 try/catch 失败退化新建。
- **重装后 worker 崩溃循环**：`guardRegistration` 改写冻结的宿主对象（`orca.commands.register` 只读属性），严格模式 TypeError。修复：改为本地 `reg()/handle()` 包装器，不改宿主对象；mock host 改为 `Object.freeze` 防回归。
- **工作区名乱码 + 0 作品**：`readState()` 对 SQLite 原始字节做正则，二进制垃圾里匹配出含 `workspaceSession{` 的假路径。修复：只走 sqlite3 CLI + 绝对路径存在性校验。
- **库页点击无响应 5–10 秒**：`orca tab list/create` CLI 在 runtime 短暂无响应时挂起（实测 `orca status` 也 runtime_timeout）。缓解：3s 超时 + tab 缓存快路径 + 状态栏「⟳ 打开中…」+ 库页骨架屏自动重试。
- **远程工作区写错盘风险**：远程路径本机不可见时 `mkdirSync(recursive)` 可能在本机创建影子目录。修复：`openGalleryTab`/`createExample` 前置「本机可见」校验，明确拒绝。
- **POST 收口**：`/api/*` 此前不校验 content-type/origin，任意网页可用 `text/plain`（免预检）跨站直达 `/api/delete`。新增 `src/post-guard.mjs`（405/415/403/大小上限）+ 7 条单测。

### 不是插件的问题

- `orca status` runtime_timeout / CLI 间歇挂起：Orca 运行时无响应，重启 Orca 即恢复（多台机器复现过）。
- `git push` 403：gh 活动账号切到无权限账号，`gh auth switch` 修复。

### 待验证

- 远程主机安装插件后，远程工作区内状态栏入口的路由（本地窗口显示远程工作区时谁接住点击）。
- `orca agent launch --surface chat` 在不同 agent（codex 等）下的 outcome.kind 差异。

### 交给上游

- `tab create/list` 挂在「当前工作区」解析上的行为已通过显式 `--worktree path:` 规避；根因在宿主 runtime，建议上游关注远程工作区场景的 CLI 超时。
- 「主题跟随宿主」已改为不经 `appearance:write`：项目库服务读取 profile `settings.theme`，首帧写入 `data-host-scheme`；`system` 回退浏览器 `prefers-color-scheme`。上游 `appearance.read` 仅返回 `revision`（用于 conditional `appearance.apply`），不暴露当前 mode；若将来提供只读 mode API，可替换该读取点。
- **catalog 落后于代码**：0.1.0 条目 pin 在 `cdf1ee1`，此后 7 个提交（含 POST 收口）从未生成新 release。修复：代码提交 C1 → `release-entry` 取 C1 的 commit/hash → catalog 单独提交 C2；安装按 `release.commit` checkout C1，避免 catalog 自引用。
- **dist 漏打运行时文件**：lite 包缺 `vendor/`，所有 dist 都缺 `tools/thumb.mjs`；`plugin validate` 只校验 manifest 故仍报 valid。修复：`bin/package.sh` 始终打包 `tools/` 与 `vendor/`，并在打包后断言 17 个 runtime 目标存在。
- **GET 状态变更绕过收口**：`/api/open` 与 `/api/open-url` 留在 GET 白名单，跨站 simple request 可拉起编辑器/触发跳转。修复：移除 GET 状态变更，前端两处改 POST JSON，全部 POST 经 `guardPost`。
- **超长请求体只断开 socket**：`req.destroy()` 让客户端拿到网络错误而非可判定状态。修复：`content-length` 预检与累计计数都回 413，并 `req.resume()` 排空请求体。
- **无行为支撑的 capability**：`appearance:write` 仅用于一次 `appearance.read` 日志探测，读取结果只有 `revision`。修复：删除探测与 capability，`engines.orca` 回落到 `>=1.4.248`；主题跟随走 profile 读取，不触发额外授权。

## 0.3.0 · 2026-11-09（guizang 吸收收尾轮，4+4 Codex worker 编排）

### 已修（带根因）

- **worker 沙箱内 headless Chrome 必败**：macOS 沙箱拒绝 Chromium 的 Mach 端口（`MachPortRendezvousServer Permission denied 1100`，两个 worker 独立复现）。处置：worker 如实报 failed + 留四件套，协调者在沙箱外补验（本会话多次实跑 Chrome 成功）。任务书里从此默认「视觉验收留给协调者」。
- **协调者重复启动同一任务**：i18n brief 被连续 roll+launch 两次，产生两个并发写 `gallery-server.mjs` 的 worker。处置：`worker-stop --dispatch` 围栏其一（task 置 blocked），保留单 worker。教训：launch 输出解析失败时先 `task-list` 查重，不要盲目重发。
- `--deps` 只接受同 run 内的 task id（跨 run 依赖被 runtime_error 拒绝）；前置任务已合入工作树时直接普通启动即可，文件级串行已成立。

### 不是插件的问题

- Router Gate 拦截裸 `orchestration worker-start`：本机 AgentCompass 路由门要求先 `agentcompass roll`；分类器故障时按其指引显式 `--provider/--account/--model/--effort` + basis 自主选路，Codex `gpt-6.1-sol/medium` 全程可用。

### 待验证

- i18n 142 键在后续新增文案时的同步（新增 toast/菜单项需同时补 zh/en，建议后续加键覆盖测试）。

### 交给上游

- 无新增。
