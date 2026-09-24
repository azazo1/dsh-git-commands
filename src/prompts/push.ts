/**
 * `/push` 的默认规范文本. 覆盖 AGENTS.md 中对远端写操作的提权与执行要求.
 * @module dsh-git-commands/prompts/push
 */

/** 默认 push 规范文本; 用户可在设置页覆盖. */
export const DEFAULT_PUSH_PROMPT = `你正在处理一次推送 (push). 下面的仓库上下文给出了当前分支, 上游分支, ahead 与 behind 的数量, 远端地址, 以及尚未推送的 commit.

要求:

- 先根据上下文确认要推送的分支和远端; 没有上游分支时使用 git push -u <remote> <branch> 建立跟踪.
- behind 大于 0 时先说明情况 (远端有本地没有的提交), 不要直接覆盖; 不要使用 --force 或者 --force-with-lease, 除非用户明确要求.
- push 是对远端的写操作: 必须在沙箱外提权执行, 单独逐条执行, 不要和 git add, git commit 之类的命令串联在 && 后面, 也不要过滤输出 (head, tail, grep 等), 避免漏掉远端返回的重要信息.
- 推送失败的输出要完整读出并说明原因, 不要只报告退出码.`
