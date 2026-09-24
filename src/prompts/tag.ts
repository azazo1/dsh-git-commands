/**
 * `/tag` 的默认规范文本. 覆盖 AGENTS.md 的 tags 约定与代码版本约定中与发布相关的
 * 部分, 并把 release notes 的具体写法指向 create-github-release-flow skill.
 * @module dsh-git-commands/prompts/tag
 */

/** 默认 tag 规范文本; 用户可在设置页覆盖. */
export const DEFAULT_TAG_PROMPT = `你正在准备一次版本发布 (打 tag 并推送). 下面的仓库上下文给出了最近的 tag, 自上一个 tag 以来的 commit message, 工作区状态, 以及项目里常见版本文件的内容.

要求:

- 打 tag 之前必须先加载并遵循 create-github-release-flow skill 的内容 (本地 dsh skill, 或 https://github.com/azazo1/create-github-release-flow), 上面的说明仅供参考, 具体写法以该 skill 为准.
- 检查项目文件里记录的版本号是否已经与要发布的版本一致; 不一致时先新建一个 commit 完成版本号更新, 再打 tag.
- tag 描述不要过短, 要写成 release notes 级别的说明, 参考成熟仓库的写法; 不要只根据 commit 标题总结, 不清楚的地方要回到 commit 的具体改动确认.
- 用户没有指定版本号时, 结合项目整体和自上一个 tag 以来的改动自行判断语义版本号是 major, minor 还是 patch.
- 只有在用户明确要求时才可以修改版本号并打 tag, 本次即明确要求; 平时不要自主修改版本号或者发布.
- 打 tag 与 push 都是对远端的写操作: 必须在沙箱外提权执行, 并且与其它命令分开, 单独逐条执行, 不要串联在 && 后面, 也不要过滤输出 (head, tail, grep 等), 避免漏掉重要信息.
- 先给出本地 tag 命令并单独执行, 再给出 push 命令并单独执行.`
