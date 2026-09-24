/**
 * 五个命令的规格表: 命令名与用法提示, 使用的规范文本字段, 目标解析要求, 以及各自的
 * 上下文采集函数.
 * @module dsh-git-commands/commands/specs
 */

import type { Config } from '../config.ts'
import {
  collectCommitContext,
  collectCommitFastContext,
  collectPushContext,
  collectRepoCreateContext,
  collectTagContext,
  type CollectOptions,
  type CollectResult,
} from '../git/snapshot.ts'

/** 一个命令的静态规格. */
export interface CommandSpec {
  /** 命令名, 不带斜杠. */
  name: string
  /** 命令定义身份, 供客户端识别同一条命令. */
  definitionId: string
  /** 补全列表里展示的说明. */
  description: string
  /** 自由输入提示. */
  inputHint: string
  /** 该命令使用的规范文本字段. */
  promptField: keyof Pick<Config,
    'commitPrompt' | 'commitFastPrompt' | 'tagPrompt' | 'pushPrompt' | 'repoCreatePrompt'>
  /** 是否接受一个可选版本号位置参数. */
  allowVersion: boolean
  /** 目标目录是否必须是已存在的 git 仓库. */
  requiresRepo: boolean
  /** 采集目标目录的仓库上下文. */
  collect: (path: string, options: CollectOptions) => Promise<CollectResult>
}

/** 全部命令, 注册顺序即补全列表顺序. */
export const COMMAND_SPECS: readonly CommandSpec[] = [
  {
    name: 'commit',
    definitionId: 'dsh-git-commands#commit',
    description: '附带提交范围与对应 diff (暂存区为空时改用自上一次 commit 以来的全部改动) 与历史风格, 生成 commit message 与等价命令',
    inputHint: '[path]',
    promptField: 'commitPrompt',
    allowVersion: false,
    requiresRepo: true,
    collect: collectCommitContext,
  },
  {
    name: 'commit-fast',
    definitionId: 'dsh-git-commands#commit-fast',
    description: '只附带工作区状态与历史风格, 不读 diff 的快速提交',
    inputHint: '[path]',
    promptField: 'commitFastPrompt',
    allowVersion: false,
    requiresRepo: true,
    collect: collectCommitFastContext,
  },
  {
    name: 'tag',
    definitionId: 'dsh-git-commands#tag',
    description: '附带上一个 tag 以来的提交与版本文件, 走发布流程打 tag 并推送',
    inputHint: '[version] [path]',
    promptField: 'tagPrompt',
    allowVersion: true,
    requiresRepo: true,
    collect: collectTagContext,
  },
  {
    name: 'push',
    definitionId: 'dsh-git-commands#push',
    description: '附带分支, 上游, 领先与落后数量与未推送提交, 推送当前分支',
    inputHint: '[path]',
    promptField: 'pushPrompt',
    allowVersion: false,
    requiresRepo: true,
    collect: collectPushContext,
  },
  {
    name: 'repo-create',
    definitionId: 'dsh-git-commands#repo-create',
    description: '附带项目描述线索与仓库状态, 创建 GitHub 仓库 (必带 description 与 topics) 并推送',
    inputHint: '[path]',
    promptField: 'repoCreatePrompt',
    allowVersion: false,
    requiresRepo: false,
    collect: collectRepoCreateContext,
  },
]

/** 把 message 摘要限制在 DSH 允许的长度内. */
export function boundSummary(text: string): string {
  const MAX = 120
  return text.length <= MAX ? text : `${text.slice(0, MAX - 1)}...`
}
