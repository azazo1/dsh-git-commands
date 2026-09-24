/**
 * 命令注册与执行: 解析参数, 采集只读上下文, 组装注入文本, 唤醒模型并回执.
 * @module dsh-git-commands/commands/register
 */

import type { Context } from '@deepseek-ai/cordis'
import type { CommandDefinitionId, CommandInvocation, CommandResult } from '@deepseek-ai/dsh-commands'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import type { Config } from '../config.ts'
import { GitUnavailableError } from '../git/exec.ts'
import { parseTarget, resolveDirectory, resolveRepo } from '../git/target.ts'
import { GIT_COMMANDS_SOURCE_KIND } from '../message-source.ts'
import { renderInjection } from '../render.ts'
import { boundSummary, COMMAND_SPECS, type CommandSpec } from './specs.ts'

/** 把任意抛出值渲染成一行说明. */
function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/**
 * 执行一条命令: 采集上下文并把它作为模型可见的上下文注入, 同时排队一个 turn.
 *
 * @param spec - 命令规格.
 * @param config - 已解析的插件配置.
 * @param invocation - DSH 传入的调用信息 (agent, 原始输入, 取消信号).
 * @returns 命令结果; 采集失败时返回错误文本, 不注入也不唤醒.
 */
async function executeCommand(
  spec: CommandSpec,
  config: Config,
  invocation: CommandInvocation,
): Promise<CommandResult> {
  const usage = `/${spec.name} ${spec.inputHint}`.trim()
  const cwd = invocation.agent.session.header.cwd
  const parsed = parseTarget(invocation.rawInput, {
    ...cwd === undefined ? {} : { cwd },
    allowVersion: spec.allowVersion,
    usage,
  })
  if (!parsed.ok) return { kind: 'error', text: parsed.message }

  let target: string
  if (spec.requiresRepo) {
    const resolved = await resolveRepo(parsed.target.path, invocation.signal)
    if (!resolved.ok) return { kind: 'error', text: resolved.message }
    target = resolved.repo
  } else {
    const resolved = await resolveDirectory(parsed.target.path)
    if (!resolved.ok) return { kind: 'error', text: resolved.message }
    target = resolved.path
  }

  let collected
  try {
    collected = await spec.collect(target, {
      logLimit: config.logLimit,
      diffLineLimit: config.diffLineLimit,
      signal: invocation.signal,
    })
  } catch (error: unknown) {
    if (error instanceof GitUnavailableError) return { kind: 'error', text: error.message }
    return { kind: 'error', text: `采集仓库上下文失败: ${describeError(error)}` }
  }

  const rawInput = invocation.rawInput.trim()
  const text = renderInjection({
    prompt: config[spec.promptField],
    request: rawInput.length === 0 ? `/${spec.name}` : `/${spec.name} ${rawInput}`,
    facts: collected.facts,
    sections: collected.sections,
  })

  try {
    invocation.agent.followup(createUserMessage({
      content: [{ type: 'text', text }],
      source: {
        kind: GIT_COMMANDS_SOURCE_KIND,
        form: 'notice',
        summary: boundSummary(`/${spec.name}: ${collected.summary}`),
      },
    }))
  } catch (error: unknown) {
    return { kind: 'error', text: `上下文已采集, 但唤醒模型失败: ${describeError(error)}` }
  }

  return {
    kind: 'success',
    text: `已注入 /${spec.name} 规范与仓库上下文 (${collected.summary}), 并唤醒模型继续.`,
  }
}

/**
 * 注册全部 git 命令.
 *
 * @param ctx - Host 上下文; 必须已提供 commands 服务.
 * @param config - 已解析的插件配置.
 * @returns 注销全部命令的 disposer.
 */
export function registerGitCommands(ctx: Context, config: Config): () => void {
  const disposers = COMMAND_SPECS.map(spec => ctx.commands.register({
    // definitionId 只是插件自有的稳定身份, 这里直接用字面量, 免去额外的 brand 依赖.
    definitionId: spec.definitionId as CommandDefinitionId,
    name: spec.name,
    description: spec.description,
    input: { hint: spec.inputHint },
    handler: (invocation: CommandInvocation) => executeCommand(spec, config, invocation),
  }))
  return () => {
    for (const dispose of disposers) dispose()
  }
}
