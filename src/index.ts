/**
 * dsh-git-commands: 把 git 工作流规范从 AGENTS.md 搬进斜杠命令.
 *
 * `/commit`, `/commit-fast`, `/tag`, `/push`, `/repo-create` 触发时, 插件先跑一
 * 组只读 git 命令采集仓库状态, 再把规范文本与采集结果一起注入会话并唤醒模型, 因此
 * 规范不再需要常驻系统提示, 模型也不必自己重复读取仓库.
 *
 * @module dsh-git-commands
 */

import type { Context } from '@deepseek-ai/cordis'
import { registerGitCommands } from './commands/register.ts'
import { Config, resolveConfig, type Config as GitCommandsConfig } from './config.ts'
import './message-source.ts'

/** 插件模块名. */
export const name = 'dsh-git-commands'

/** 依赖的命令注册表. */
export const inject = ['commands']

export { Config }

/**
 * 注册全部 git 命令.
 *
 * @param ctx - Host 上下文.
 * @param config - Loader 按 Config schema 校验后的配置.
 */
export function apply(ctx: Context, config: GitCommandsConfig): void {
  const resolved = resolveConfig(config)
  ctx.effect(() => registerGitCommands(ctx, resolved), 'dsh-git-commands: slash commands')
}
