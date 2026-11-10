# Catalog 发布流程

本仓库以 git 源发布。Orca 从 `orca-catalog.json` 读取条目，按 `source.url + source.ref` 定位仓库，按 `releases[].commit` 拉取精确提交并按 `contentHash` 校验文件，因此每次发布必须：

## 1. 改代码 / 素材，先提交

```bash
orca plugin validate . --json                 # manifest + 图片规则校验
node --test 'test/*.mjs'                     # 测试
bash bin/package.sh --full                   # 可选：本地 dist 冒烟
git add -A && git commit -m "feat: ..." && git push
```

`assets/` 下的 icon / cover / screenshots 由 `orca-plugin.json` 声明并参与 contentHash；新增或替换图片后必须重新发布（提交 + 更新 catalog 条目）。

## 2. 生成 release 条目

```bash
orca plugin release-entry . --json | jq -r '.result.entry'
```

输出是 **HEAD 提交**的 `{version, commit, contentHash, execution, minimumOrca, name, contributes, capabilities, images}`。它明确排除未提交的改动——必须先提交再生成。`contentHash` 覆盖 HEAD tree 中的文件，包含 `orca-catalog.json` 自身；因此不要把 catalog 更新和代码改动放进同一个提交：先提交代码（C1），在 C1 上生成条目，再单独提交 catalog（C2）。Orca 安装时 checkout 的是 `releases[].commit`（即 C1），不会 checkout C2，也不会产生自引用 hash。

## 3. 更新 `orca-catalog.json`

把新条目插入 `plugins[0].releases` 的最前面（newest first），保留旧条目以便老版本 Orca 回退。`contentHash` 必须与 `git` 中该 commit 的字节一致，不要手工改动；`commit` 用完整 40 位 sha。

```bash
orca plugin validate orca-catalog.json --json   # 校验 catalog（若命令支持）
git add orca-catalog.json && git commit -m "chore(catalog): release <version>" && git push
```

## 4. 用户侧更新

以 catalog/git 源安装的插件由 Orca 按 `source.ref` 读取 catalog，并按 `releases[].commit` 精确 checkout 安装字节；新 release 置顶后用户侧即可检查到更新（策略 `auto` 默认开启，`manual` 时在插件设置里手动更新）；能力增长会重新征求同意。
从本地文件夹（`local-path`）安装的副本不会自动更新，需要重新 `git pull && bash bin/package.sh --full` 并重装。

## 字段约定

| 字段 | 值 |
| --- | --- |
| `catalogVersion` | 2 |
| `name` / `owner` | catalog 展示名 / 发布账号 |
| `plugins[].id` | `<publisher>.<id>`，本仓库固定 `hubo.prototype-studio`（与现有安装副本一致） |
| `source` | HTTPS git URL `https://github.com/hubo1989/orca-plugin-design.git`，`ref: main` |
| `releases[]` | 直接采用 `orca plugin release-entry . --json` 的输出 |

## 图片规则（Orca 校验）

| 类型 | 格式 | 尺寸 | 大小 |
| --- | --- | --- | --- |
| icon | PNG / WebP | ≥128×128 正方形 | ≤256 KB |
| cover | PNG / JPEG / WebP | ≥800×500（推荐 1600×1000） | ≤1 MB |
| screenshots | PNG / JPEG / WebP | ≥1280×800（最多 6 张） | 每张 ≤1.5 MB |
