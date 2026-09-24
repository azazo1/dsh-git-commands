/**
 * 插件向会话注入上下文时使用的 message source 标识. 0.1.7 起 DSH 不再提供通用的
 * `plugin` source kind, 每个产出方在自己的模块里声明自己的 kind.
 * @module dsh-git-commands/message-source
 */

import type { ContextFormed } from '@deepseek-ai/dsh-llm'

declare module '@deepseek-ai/dsh-llm' {
  interface MessageSourceMap {
    'git-commands': { kind: 'git-commands' } & ContextFormed
  }
}

/** 本插件注入消息的 source kind. */
export const GIT_COMMANDS_SOURCE_KIND = 'git-commands' as const
