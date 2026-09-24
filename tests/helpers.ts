/**
 * 测试用的临时 git 仓库工具.
 * @module dsh-git-commands/tests/helpers
 */

import { execFile } from 'node:child_process'
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { promisify } from 'node:util'

const run = promisify(execFile)

/**
 * 测试临时仓库的根目录: 用系统临时目录而不是工作区的 .tmp.
 *
 * 工作区本身在开发机上通常是一个 git 仓库, 放在它下面的临时目录会被上层仓库
 * 认领, 于是 "不是 git 仓库" 这类用例失去意义.
 */
export const TMP_ROOT = tmpdir()

/** git 提交所需的身份参数, 避免依赖本机配置. */
export const GIT_IDENTITY = ['-c', 'user.name=dsh-git-commands-test', '-c', 'user.email=test@example.com']

/**
 * 执行一条 git 命令.
 *
 * @param cwd - 工作目录.
 * @param args - git 参数.
 * @returns 标准输出.
 */
export async function git(cwd: string, args: readonly string[]): Promise<string> {
  const result = await run('git', [...args], { cwd })
  return result.stdout
}

/**
 * 创建一个带一次提交的临时 git 仓库.
 *
 * @param files - 首次提交包含的文件, 键为相对路径.
 * @returns 仓库根绝对路径.
 */
export async function createRepo(files: Record<string, string> = { 'a.txt': 'a\n' }): Promise<string> {
  await mkdir(TMP_ROOT, { recursive: true })
  const repo = await mkdtemp(join(TMP_ROOT, 'repo-'))
  await git(repo, ['init', '-b', 'main'])
  await git(repo, [...GIT_IDENTITY, 'commit', '--allow-empty', '-m', 'chore: 初始化仓库'])
  for (const [name, content] of Object.entries(files)) {
    await writeFileIn(repo, name, content)
  }
  await git(repo, ['add', '.'])
  await git(repo, [...GIT_IDENTITY, 'commit', '-m', 'feat: 加入初始文件'])
  return repo
}

/**
 * 在一个仓库里写入文件 (自动创建父目录).
 *
 * @param repo - 仓库根.
 * @param name - 相对路径.
 * @param content - 文件内容.
 */
export async function writeFileIn(repo: string, name: string, content: string): Promise<void> {
  const target = join(repo, name)
  await mkdir(dirname(target), { recursive: true })
  await writeFile(target, content, 'utf8')
}

/**
 * 创建一个不是 git 仓库的临时目录.
 *
 * @returns 目录绝对路径.
 */
export async function createPlainDirectory(): Promise<string> {
  await mkdir(TMP_ROOT, { recursive: true })
  return mkdtemp(join(TMP_ROOT, 'dir-'))
}
