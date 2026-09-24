/**
 * git 子进程封装: 只读命令, 带超时, 取消信号与输出上限.
 * @module dsh-git-commands/git/exec
 */

import { execFile } from 'node:child_process'

/** 单条 git 命令的默认超时. */
export const DEFAULT_GIT_TIMEOUT_MS = 10_000

/** 单个 git 命令允许的最大输出, 防止超大 diff 撑爆内存. */
const MAX_BUFFER_BYTES = 8 * 1024 * 1024

/** 调用结果; 非零退出码属于正常返回值 (例如没有 upstream). */
export interface GitResult {
  /** 退出码; 进程被信号终止或超时时为 null. */
  code: number | null
  /** 标准输出, 已按 utf8 解码. */
  stdout: string
  /** 标准错误, 已按 utf8 解码. */
  stderr: string
  /** 命令是否正常退出. */
  ok: boolean
}

/** 本机没有可用的 git 可执行文件. */
export class GitUnavailableError extends Error {
  constructor() {
    super('找不到 git 可执行文件, 请确认已在 PATH 中安装 git')
    this.name = 'GitUnavailableError'
  }
}

/**
 * 在指定目录执行一条只读 git 命令.
 *
 * 子进程环境里关闭可选锁并禁用分页, 保证只读命令不会改动仓库状态, 也不会等待
 * 交互式 pager.
 *
 * @param repo - 命令的工作目录, 通常是仓库根.
 * @param args - 传给 git 的参数, 不含 `-C`.
 * @param options - 取消信号与超时.
 * @returns 退出码与输出.
 * @throws {GitUnavailableError} git 不在 PATH 中时抛出.
 */
export function runGit(
  repo: string,
  args: readonly string[],
  options: { signal?: AbortSignal; timeoutMs?: number } = {},
): Promise<GitResult> {
  return new Promise<GitResult>((resolve, reject) => {
    execFile('git', ['-C', repo, ...args], {
      encoding: 'utf8',
      maxBuffer: MAX_BUFFER_BYTES,
      timeout: options.timeoutMs ?? DEFAULT_GIT_TIMEOUT_MS,
      ...(options.signal === undefined ? {} : { signal: options.signal }),
      env: { ...process.env, GIT_OPTIONAL_LOCKS: '0', GIT_PAGER: 'cat', GIT_TERMINAL_PROMPT: '0' },
    }, (error, stdout, stderr) => {
      const failure = error as (NodeJS.ErrnoException & { code?: number | string }) | null
      if (failure !== null && failure.code === 'ENOENT') {
        reject(new GitUnavailableError())
        return
      }
      const code = typeof failure?.code === 'number' ? failure.code : failure === null ? 0 : null
      resolve({
        code,
        stdout: stdout ?? '',
        stderr: stderr ?? '',
        ok: failure === null,
      })
    })
  })
}

/**
 * 执行一条必需成功的 git 命令, 失败时给出可读原因.
 *
 * @param repo - 命令的工作目录.
 * @param args - 传给 git 的参数.
 * @param options - 取消信号与超时.
 * @returns 去掉首尾空白的标准输出.
 * @throws {Error} 命令非零退出或没有输出时抛出.
 */
export async function runGitOrThrow(
  repo: string,
  args: readonly string[],
  options: { signal?: AbortSignal; timeoutMs?: number } = {},
): Promise<string> {
  const result = await runGit(repo, args, options)
  if (!result.ok) {
    const detail = result.stderr.trim() || `退出码 ${String(result.code)}`
    throw new Error(`git ${args.join(' ')} 失败: ${detail}`)
  }
  return result.stdout.trim()
}
