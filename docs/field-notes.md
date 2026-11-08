# 发布纪要（Field Notes）

每个发布版本按四段式记录真机会会话实测：**已修（带根因）/ 不是插件的问题 / 待验证 / 交给上游**。与 [CATALOG.md](CATALOG.md) 的机械发布步骤并列为发布 checklist 两件套。灵感来自 guizang 的发布纪律。

## 0.2.0 · 2026-11-08

### 已修（带根因）

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
