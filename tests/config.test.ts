/**
 * 配置默认值与覆盖行为测试.
 * @module dsh-git-commands/tests/config
 */

import { describe, expect, it } from 'vitest'
import { Config, DEFAULT_DIFF_LINE_LIMIT, DEFAULT_LOG_LIMIT, resolveConfig } from '../src/config.ts'
import { DEFAULT_COMMIT_PROMPT } from '../src/prompts/index.ts'

describe('resolveConfig', () => {
  it('缺省时补齐内置规范文本与采集上限', () => {
    const resolved = resolveConfig()
    expect(resolved.commitPrompt).toBe(DEFAULT_COMMIT_PROMPT)
    expect(resolved.logLimit).toBe(DEFAULT_LOG_LIMIT)
    expect(resolved.diffLineLimit).toBe(DEFAULT_DIFF_LINE_LIMIT)
  })

  it('保留用户提供的值', () => {
    const resolved = resolveConfig({ commitPrompt: '自定义', logLimit: 3, diffLineLimit: 500 })
    expect(resolved.commitPrompt).toBe('自定义')
    expect(resolved.logLimit).toBe(3)
    expect(resolved.diffLineLimit).toBe(500)
  })
})

describe('Config schema', () => {
  /** Loader 校验入口: 以未定型输入调用 schema. */
  const parseConfig = Config as unknown as (source: Record<string, unknown>) => Config

  it('为缺失字段填入默认值', () => {
    const value = parseConfig({})
    expect(value.logLimit).toBe(DEFAULT_LOG_LIMIT)
    expect(value.commitPrompt).toBe(DEFAULT_COMMIT_PROMPT)
  })

  it('拒绝超出范围的上限', () => {
    expect(() => parseConfig({ logLimit: 0 })).toThrow()
    expect(() => parseConfig({ diffLineLimit: 5 })).toThrow()
  })
})
