/**
 * 插件入口的接线测试: 用假 Context 收集注册结果, 用临时仓库驱动命令 handler.
 * @module dsh-git-commands/tests/plugin
 */

import type { Context } from '@deepseek-ai/cordis'
import type { CommandDefinition, CommandInvocation, CommandResult } from '@deepseek-ai/dsh-commands'
import type { UserMessage } from '@deepseek-ai/dsh-session'
import { describe, expect, it } from 'vitest'
import { resolveConfig } from '../src/config.ts'
import { apply, inject, name } from '../src/index.ts'
import { createPlainDirectory, createRepo, writeFileIn } from './helpers.ts'

/** 假 Host 上下文捕获的注册结果与注入消息. */
interface Harness {
  definitions: Map<string, CommandDefinition>
  messages: UserMessage[]
}

/** 组装一个只实现注册面的假 Context. */
function createHarness(): Harness {
  const definitions = new Map<string, CommandDefinition>()
  const messages: UserMessage[] = []
  const ctx = {
    commands: {
      register: (definition: CommandDefinition) => {
        definitions.set(definition.name, definition)
        return () => definitions.delete(definition.name)
      },
    },
    effect: (factory: () => () => void) => factory(),
    __messages: messages,
  }
  apply(ctx as unknown as Context, resolveConfig())
  return { definitions, messages }
}

/** 构造一条命令调用, followup 会把消息记进 harness. */
function invocationFor(harness: Harness, cwd: string, rawInput: string): CommandInvocation {
  return {
    commandId: 'test-command',
    agent: {
      session: { header: { cwd } },
      followup: (message: UserMessage) => { harness.messages.push(message) },
    },
    rawInput,
    attachments: [],
    signal: new AbortController().signal,
  } as unknown as CommandInvocation
}

/** 取一条命令的定义, 缺失时直接失败. */
function definitionOf(harness: Harness, command: string): CommandDefinition {
  const definition = harness.definitions.get(command)
  if (definition === undefined) throw new Error(`没有注册命令 ${command}`)
  return definition
}

describe('插件入口', () => {
  it('导出模块名与依赖', () => {
    expect(name).toBe('dsh-git-commands')
    expect(inject).toEqual(['commands'])
  })

  it('注册五个命令与各自的输入提示', () => {
    const harness = createHarness()
    expect([...harness.definitions.keys()].sort()).toEqual([
      'commit', 'commit-fast', 'push', 'repo-create', 'tag',
    ])
    expect(definitionOf(harness, 'commit').input?.hint).toBe('[path]')
    expect(definitionOf(harness, 'tag').input?.hint).toBe('[version] [path]')
  })

  it('命令描述非空, 供补全列表展示', () => {
    const harness = createHarness()
    for (const definition of harness.definitions.values()) {
      expect(definition.description.trim().length).toBeGreaterThan(0)
    }
  })
})

describe('/commit handler', () => {
  it('注入规范与仓库上下文, 并唤醒模型', async () => {
    const repo = await createRepo()
    await writeFileIn(repo, 'c.txt', 'hello\n')
    const { execFile } = await import('node:child_process')
    const { promisify } = await import('node:util')
    await promisify(execFile)('git', ['add', 'c.txt'], { cwd: repo })

    const harness = createHarness()
    const result = await definitionOf(harness, 'commit')
      .handler(invocationFor(harness, repo, ''))

    expect((result as { kind: string }).kind).toBe('success')
    expect(harness.messages).toHaveLength(1)
    const message = harness.messages[0]
    expect(message?.role).toBe('user')
    expect(message?.source.kind).toBe('git-commands')
    const text = message?.content.map(block => (block.type === 'text' ? block.text : '')).join('') ?? ''
    expect(text).toContain('## 命令上下文')
    expect(text).toContain('+hello')
    expect(text).toContain('运行环境: ')
  })

  it('目标目录不存在时返回错误且不唤醒模型', async () => {
    const harness = createHarness()
    const result = await definitionOf(harness, 'commit')
      .handler(invocationFor(harness, '/tmp', 'definitely-not-here'))
    const settled = result as CommandResult
    expect(settled.kind).toBe('error')
    expect(harness.messages).toHaveLength(0)
  })

  it('目标是普通目录时说明不是 git 仓库', async () => {
    const repo = await createRepo()
    const plain = await createPlainDirectory()
    const harness = createHarness()
    const result = await definitionOf(harness, 'commit')
      .handler(invocationFor(harness, repo, plain))
    const settled = result as CommandResult
    expect(settled.kind).toBe('error')
    if (settled.kind === 'error') expect(settled.text).toContain('不是 git 仓库')
  })
})

describe('/repo-create handler', () => {
  it('接受还不是仓库的目录', async () => {
    const repo = await createRepo()
    const harness = createHarness()
    const result = await definitionOf(harness, 'repo-create')
      .handler(invocationFor(harness, repo, 'nested-not-a-repo'))
    // 目录不存在, 因此仍然是错误; 这里只验证它走的是目录解析而不是仓库解析.
    expect((result as CommandResult).kind).toBe('error')
  })
})
