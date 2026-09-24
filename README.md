# dsh-git-commands

把 git 提交, tag, push 与建仓库的工作流规范从 `AGENTS.md` 搬进 DSH 的斜杠命令, 命令触发时自动附带仓库状态, 于是规范不再需要常驻上下文, 模型也不必自己重复执行 `git status` / `git diff` / `git log`.

## 为什么

写在 `AGENTS.md` 里的 git 约定每次请求都要随系统提示一起发送, 而只有真正提交或发布时才用得上; 模型每次还要自己跑几条 git 命令去了解仓库现状. 这个插件把两者都改成按需发生: 规范文本留在插件里, 仓库状态由插件在命令触发时采集好一起注入.

## 安装

```shell
dsh plugin --profile web add azazo1/dsh-git-commands
```

安装后重启 `dsh web`.

## 命令

| 命令 | 参数 | 触发时采集 (全部只读) |
|---|---|---|
| `/commit` | `[path]` | `git status --porcelain`, `git diff --cached --stat`, `git diff --cached` (暂存区为空时改为 `git diff HEAD` 与未跟踪新文件内容), 最近 N 条完整 commit message |
| `/commit-fast` | `[path]` | `git status --porcelain`, 最近 N 条完整 commit message (不采集 diff) |
| `/tag` | `[version] [path]` | 最近 5 个 tag, 上一个 tag 以来的提交 (完整 message), 项目版本文件, 工作区状态 |
| `/push` | `[path]` | 分支, 上游, 领先/落后数量, 远端列表, 尚未推送的提交 |
| `/repo-create` | `[path]` | 是否已初始化仓库, 远端, 提交数, `package.json` 元数据, README 开头, 顶层条目, `.gitignore` 情况 |

参数规则:

- 路径可以是绝对路径, 也可以是相对当前会话工作目录的路径; 省略时使用会话工作目录; `~` 与 `~\` 都会展开成家目录.
- `/tag` 额外接受一个可选版本号 (`0.2.0` 或 `v0.2.0`), 顺序为 `/tag <版本号> <路径>`.
- `/repo-create` 的目标目录可以还没有初始化 git; 其余命令要求目标已经是 git 仓库.

`/commit` 在暂存区为空时按约定把提交范围回退到自上一次 commit 以来的全部改动: 采集命令换成 `git diff HEAD --stat` 与 `git diff HEAD` (仓库尚无提交时用 `git diff`), 并把未跟踪的新文件渲染成新增文件的 diff 片段附在末尾, 两者共用同一个 `diffLineLimit` 上限, 因此规范文本不再需要模型自己去跑 `git diff`.

命令不会真的执行写操作: 采集只跑只读命令, 生成的 commit message, tag, push 与建仓库动作由模型在会话里按规范执行 (远端写操作会走提权).

## 跨平台

插件执行 git 时不经过任何 shell, 参数以数组直接交给 git, 因此 macOS, Linux, Windows 上行为一致 (Windows 需要 git 在 PATH 中). 给模型的等价命令示例则由注入的 `运行环境 / 默认 shell` 事实决定写法: 上下文里会带上一行形如 `运行环境: win32, 默认 shell: cmd.exe` 的说明, 规范文本据此要求模型避开 cmd.exe 不支持的跨行引号, 改用 `git commit -F <文件>`.

## 配置

五个命令的规范文本, 以及两个采集上限 (历史条数, diff 行数上限), 都是插件的 Config 字段, 因此在 Settings 的 Plugins 区里会自动生成表单, 可以直接以多行文本编辑, 保存即写入当前 profile 的配置. 默认值就是内置文本, 点字段旁的 reset 可以退回默认值.

也可以在 profile 的 `cordis.patch.yml` 里直接配置:

```yml
- id: dsh-git-commands
  name: dsh-git-commands
  config:
    logLimit: 10
    diffLineLimit: 1500
```

## 与 AGENTS.md 的关系

插件内置的规范文本覆盖了原先 `AGENTS.md` 中这几部分内容, 可以安全删除:

- `commit` 与 `commit fast` 段 (`/commit`, `/commit-fast`).
- `tags` 段与 `代码版本` 段中与发布相关的部分 (`/tag`).
- 远端写操作的提权要求中与 push, gh 相关的部分 (`/push`, `/repo-create`).

与命令无关的部分 (例如 `restore` / `checkout` / `rebase`, `stage`) 没有对应命令, 建议继续留在 `AGENTS.md`.

## 隐私说明

注入的内容会写进会话日志并随下一次模型请求发送, 因此 staged diff, 暂存区为空时附上的全部改动 (含未跟踪文本文件内容) 与 README 开头等内容会和正常对话一样离开本机; 这些内容本来就在仓库里, 插件不额外读取仓库之外的文件. 未跟踪文件只读取 `.gitignore` 未忽略的普通文本文件, 二进制与超过 64 KiB 的只列名字; diff 过大时会按 `diffLineLimit` 截断并在文本中标注.

## 开发

```shell
just install
just typecheck
just test
just build
```

`verify` 会串起类型检查, 测试, 构建与 `pnpm pack --dry-run`.
