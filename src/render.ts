/**
 * 注入文本组装: 规范文本 + 本次请求 + 采集到的仓库上下文.
 * @module dsh-git-commands/render
 */

import type { ContextSection } from './git/snapshot.ts'

/** 组装注入文本的输入. */
export interface InjectionInput {
  /** 命令对应的规范文本 (来自配置). */
  prompt: string
  /** 本次请求的原始命令行, 例如 `/tag v0.2.0`. */
  request: string
  /** 仓库基本事实, 逐行列出. */
  facts: readonly string[]
  /** 采集到的上下文段落. */
  sections: readonly ContextSection[]
}

/** 用一个代码块包裹命令输出, 避免正文里的 markdown 影响阅读. */
function fenced(body: string, language: string): string {
  const fence = body.includes('```') ? '````' : '```'
  return `${fence}${language}\n${body}\n${fence}`
}

/**
 * 组装要注入给模型的文本: 先给规范与本次请求, 再给采集好的上下文.
 *
 * @param input - 规范文本, 请求行与上下文.
 * @returns 完整注入文本.
 */
export function renderInjection(input: InjectionInput): string {
  const header = [
    '## 命令上下文 (由 dsh-git-commands 采集, 不需要重新执行这些命令)',
    '',
    `本次请求: ${input.request}`,
    ...input.facts,
  ].join('\n')
  const sections = input.sections
    .map(section => `### ${section.title}\n${fenced(section.body, 'text')}`)
    .join('\n\n')
  return `${input.prompt.trim()}\n\n${header}\n\n${sections}\n`
}
