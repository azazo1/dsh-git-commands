/**
 * `/repo-create` 的默认规范文本. 覆盖建 GitHub 仓库时的描述, topics, gitignore
 * 检查, 首次提交, 以及提权执行要求.
 * @module dsh-git-commands/prompts/repo-create
 */

/** 默认 repo-create 规范文本; 用户可在设置页覆盖. */
export const DEFAULT_REPO_CREATE_PROMPT = `你正在为一个项目创建 GitHub 仓库并完成首次推送. 下面的仓库上下文给出了本地仓库状态, 远端情况以及项目自身的描述线索.

要求:

- 仓库描述是必须的: 通过 --description 传入一句简短说明, 讲清这个项目解决什么问题, 面向什么场景, 并与 package.json 的 description 和 README 开头的定位说明保持一致.
- topics 是必须的: 通过 --topic 传入 3 到 6 个 topic, 只允许小写字母, 数字和连字符, 覆盖技术栈, 用途和生态定位.
- 创建之前检查 .gitignore: 按项目类型补齐条目 (依赖目录, 构建产物, 临时目录, 编辑器与系统文件, 数据库和本地配置等), 确认要提交的内容里没有密钥, 凭据或者机器特定的绝对路径.
- 首次提交使用 Conventional Commits, 提交信息要落到项目实际内容上, 不要写成 init 这类没有信息量的说明.
- 默认创建公开仓库 (--public), 除非用户要求私有.
- 命令形态参考 (按本机 gh 版本选择可用参数):

  gh repo create OWNER/REPOSITORY --public --description "一句定位说明" --source . --push --topic topic-a --topic topic-b

- gh 创建, 首次提交与 push 都是对远端有影响的操作: 必须在沙箱外提权执行, 单独逐条执行, 不要串联, 也不要过滤输出.
- 完成后核对远端的 description 和 topics 是否与项目描述一致, 并把仓库地址告诉用户.`
