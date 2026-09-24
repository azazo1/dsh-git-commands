/**
 * 插件配置: 五个命令各自的规范文本, 以及采集仓库上下文时的两个上限. 字段默认值
 * 就是内置的规范文本, 用户在设置页写入的值覆盖默认值.
 * @module dsh-git-commands/config
 */

import z from '@deepseek-ai/schemastery'
import {
  DEFAULT_COMMIT_FAST_PROMPT,
  DEFAULT_COMMIT_PROMPT,
  DEFAULT_PUSH_PROMPT,
  DEFAULT_REPO_CREATE_PROMPT,
  DEFAULT_TAG_PROMPT,
} from './prompts/index.ts'

/** 最近 commit message 的默认采集条数. */
export const DEFAULT_LOG_LIMIT = 10
/** staged diff 默认保留的最大行数, 超出部分截断. */
export const DEFAULT_DIFF_LINE_LIMIT = 1500
/** commit message 采集条数的允许范围. */
export const LOG_LIMIT_RANGE = { min: 1, max: 50 } as const
/** diff 行数上限的允许范围. */
export const DIFF_LINE_LIMIT_RANGE = { min: 100, max: 20000 } as const

/** 用户可通过 profile 配置提供的值; 缺省时由 schema 默认值补齐. */
export interface Config {
  /** `/commit` 注入的规范文本. */
  commitPrompt: string
  /** `/commit-fast` 注入的规范文本. */
  commitFastPrompt: string
  /** `/tag` 注入的规范文本. */
  tagPrompt: string
  /** `/push` 注入的规范文本. */
  pushPrompt: string
  /** `/repo-create` 注入的规范文本. */
  repoCreatePrompt: string
  /** 采集最近多少条 commit message. */
  logLimit: number
  /** staged diff 最多保留多少行. */
  diffLineLimit: number
}

/** Cordis Loader 读取并校验的插件 Config schema. */
export const Config: z<Config> = z.object({
  commitPrompt: z.string().default(DEFAULT_COMMIT_PROMPT)
    .description('/commit 注入给模型的规范文本'),
  commitFastPrompt: z.string().default(DEFAULT_COMMIT_FAST_PROMPT)
    .description('/commit-fast 注入给模型的规范文本'),
  tagPrompt: z.string().default(DEFAULT_TAG_PROMPT)
    .description('/tag 注入给模型的规范文本'),
  pushPrompt: z.string().default(DEFAULT_PUSH_PROMPT)
    .description('/push 注入给模型的规范文本'),
  repoCreatePrompt: z.string().default(DEFAULT_REPO_CREATE_PROMPT)
    .description('/repo-create 注入给模型的规范文本'),
  logLimit: z.number().step(1).min(LOG_LIMIT_RANGE.min).max(LOG_LIMIT_RANGE.max)
    .default(DEFAULT_LOG_LIMIT)
    .description('采集最近多少条 commit message 作为风格参考'),
  diffLineLimit: z.number().step(1).min(DIFF_LINE_LIMIT_RANGE.min).max(DIFF_LINE_LIMIT_RANGE.max)
    .default(DEFAULT_DIFF_LINE_LIMIT)
    .description('staged diff 最多保留多少行, 超出部分截断'),
})

/**
 * 显式解析部署传入的配置, 把缺省值补齐成完整配置.
 *
 * schema 在任何正常加载路径上都已填好默认值, 这里再做一次显式回退, 使得
 * schema 之外直接构造配置的调用方 (例如测试) 也拿到完整值.
 *
 * @param config - Loader 校验后的配置, 允许缺省字段.
 * @returns 字段齐全的配置.
 */
export function resolveConfig(config: Partial<Config> = {}): Config {
  return {
    commitPrompt: config.commitPrompt ?? DEFAULT_COMMIT_PROMPT,
    commitFastPrompt: config.commitFastPrompt ?? DEFAULT_COMMIT_FAST_PROMPT,
    tagPrompt: config.tagPrompt ?? DEFAULT_TAG_PROMPT,
    pushPrompt: config.pushPrompt ?? DEFAULT_PUSH_PROMPT,
    repoCreatePrompt: config.repoCreatePrompt ?? DEFAULT_REPO_CREATE_PROMPT,
    logLimit: config.logLimit ?? DEFAULT_LOG_LIMIT,
    diffLineLimit: config.diffLineLimit ?? DEFAULT_DIFF_LINE_LIMIT,
  }
}
