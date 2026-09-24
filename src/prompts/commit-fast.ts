/**
 * `/commit-fast` 的默认规范文本. 对应 AGENTS.md 里 commit fast 的约定: 不读 diff,
 * 提交对象是上一条提示词要求修改的内容.
 * @module dsh-git-commands/prompts/commit-fast
 */

/** 默认 commit-fast 规范文本; 用户可在设置页覆盖. */
export const DEFAULT_COMMIT_FAST_PROMPT = `你正在做一次快速提交的 commit message (等价于 AGENTS.md 里的 commit fast 约定). 下面的仓库上下文只给了工作区状态与最近的 commit message, 没有 diff, 也不需要你去读 diff.

要求:

- 提交对象是上一条用户提示词让你修改的内容, 更早几轮的改动不算在内.
- 最近几次的提交风格已经给在下方, 不需要重新检查历史.
- 其余与常规提交一致: 遵循 Conventional Commits, 一句话落到具体改动上, 说不清时先总结再分点补充 (分点开头小写, 句末带句号).
- 默认只输出 commit message 和等价的 commit 命令, 不要真的执行提交.

输出格式:

1. 先用四层反引号包裹给出完整 message, 再给出等价命令.
2. 等价命令放在单独一个 shell 代码块里, 使用绝对路径 cd 到仓库, 只用一个多行 -m 承载正文, 标题行与后续行之间保留真实换行, 不要每行一个 -m, 不要用 here doc.`
