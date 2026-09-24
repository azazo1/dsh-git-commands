/**
 * 命令参数解析与目标路径解析: 位置参数里的路径可以是绝对路径或者相对会话工作目录
 * 的路径, `/tag` 另外接受一个可选版本号.
 * @module dsh-git-commands/git/target
 */

import { stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import { isAbsolute, resolve as resolvePath } from 'node:path'
import { runGit } from './exec.ts'

/** 语义版本号形态, 允许 v 前缀与预发布后缀. */
export const VERSION_PATTERN = /^v?\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/u

/** 解析出的目标: 目录绝对路径与可选版本号. */
export interface ParsedTarget {
  /** 解析后的绝对路径, 可能指向仓库内的子目录. */
  path: string
  /** `/tag` 传入的版本号. */
  version?: string
}

/** 参数解析结果. */
export type TargetParseResult =
  | { ok: true; target: ParsedTarget }
  | { ok: false; message: string }

/** 目标目录解析结果. */
export type PathResolution =
  | { ok: true; path: string }
  | { ok: false; message: string }

/** 仓库解析结果. */
export type RepoResolution =
  | { ok: true; repo: string }
  | { ok: false; message: string }

/** 展开开头的 `~` 为当前用户家目录. */
function expandHome(token: string): string {
  if (token === '~') return homedir()
  if (token.startsWith('~/')) return resolvePath(homedir(), token.slice(2))
  return token
}

/**
 * 解析斜杠命令的原始输入.
 *
 * 语法: `/name [version] [path]`, 两个位置参数都是可选的, 顺序固定; 版本号只对
 * 声明了 `allowVersion` 的命令生效. 没有给出路径时使用会话工作目录.
 *
 * @param rawInput - 命令名之后的原始文本.
 * @param options - 会话工作目录, 是否接受版本号, 以及用法提示.
 * @returns 解析成功时的绝对路径与版本号, 否则给出可直接展示的错误文本.
 */
export function parseTarget(
  rawInput: string,
  options: { cwd?: string; allowVersion?: boolean; usage: string },
): TargetParseResult {
  const tokens = rawInput.trim().length === 0 ? [] : rawInput.trim().split(/\s+/u)
  const rest: string[] = []
  let version: string | undefined
  for (const token of tokens) {
    if (options.allowVersion === true && VERSION_PATTERN.test(token)) {
      if (version !== undefined) {
        return { ok: false, message: `只能给出一个版本号. 用法: ${options.usage}` }
      }
      version = token
      continue
    }
    rest.push(token)
  }
  if (rest.length > 1) {
    return { ok: false, message: `最多给出一个仓库路径. 用法: ${options.usage}` }
  }
  const token = rest[0]
  const cwd = options.cwd
  if (token === undefined) {
    if (cwd === undefined || cwd.trim().length === 0) {
      return { ok: false, message: `当前会话没有工作目录, 请显式给出仓库路径. 用法: ${options.usage}` }
    }
    return { ok: true, target: { path: resolvePath(cwd), ...version === undefined ? {} : { version } } }
  }
  const expanded = expandHome(token)
  if (!isAbsolute(expanded) && (cwd === undefined || cwd.trim().length === 0)) {
    return { ok: false, message: `当前会话没有工作目录, 无法解析相对路径 "${token}", 请给出绝对路径.` }
  }
  const path = isAbsolute(expanded) ? resolvePath(expanded) : resolvePath(cwd as string, expanded)
  return { ok: true, target: { path, ...version === undefined ? {} : { version } } }
}

/**
 * 校验目录存在且可读.
 *
 * @param path - 已解析的绝对路径.
 * @returns 目录路径, 或可直接展示的错误文本.
 */
export async function resolveDirectory(path: string): Promise<PathResolution> {
  try {
    const info = await stat(path)
    if (!info.isDirectory()) {
      return { ok: false, message: `目标不是目录: ${path}` }
    }
    return { ok: true, path }
  } catch {
    return { ok: false, message: `目录不存在或不可读: ${path}` }
  }
}

/**
 * 校验目标并解析出 git 仓库根.
 *
 * @param path - 已解析的绝对路径, 可以是仓库内的子目录.
 * @param signal - 命令调用方的取消信号.
 * @returns 仓库根路径, 或可直接展示的错误文本.
 */
export async function resolveRepo(path: string, signal?: AbortSignal): Promise<RepoResolution> {
  const directory = await resolveDirectory(path)
  if (!directory.ok) return directory
  const result = await runGit(path, ['rev-parse', '--show-toplevel'], { signal })
  if (!result.ok) {
    return { ok: false, message: `${path} 不是 git 仓库 (或仓库已损坏): ${result.stderr.trim() || 'git rev-parse 失败'}` }
  }
  const repo = result.stdout.trim()
  if (repo.length === 0) {
    return { ok: false, message: `${path} 不是 git 仓库` }
  }
  return { ok: true, repo }
}
