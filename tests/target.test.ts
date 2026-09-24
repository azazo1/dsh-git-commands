/**
 * 参数与目标路径解析的行为测试.
 * @module dsh-git-commands/tests/target
 */

import { realpath } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { parseTarget, resolveDirectory, resolveRepo } from '../src/git/target.ts'
import { createPlainDirectory, createRepo, TMP_ROOT } from './helpers.ts'

const USAGE = '/commit [path]'

describe('parseTarget', () => {
  it('省略路径时使用会话工作目录', () => {
    const result = parseTarget('   ', { cwd: '/tmp/work', usage: USAGE })
    expect(result).toEqual({ ok: true, target: { path: resolve('/tmp/work') } })
  })

  it('把相对路径解析到会话工作目录下', () => {
    const result = parseTarget('sub/dir', { cwd: '/tmp/work', usage: USAGE })
    expect(result).toEqual({ ok: true, target: { path: resolve('/tmp/work', 'sub/dir') } })
  })

  it('保留绝对路径', () => {
    const result = parseTarget('/srv/project', { cwd: '/tmp/work', usage: USAGE })
    expect(result).toEqual({ ok: true, target: { path: '/srv/project' } })
  })

  it('展开家目录写法', () => {
    const result = parseTarget('~/project', { usage: USAGE })
    expect(result).toEqual({ ok: true, target: { path: join(homedir(), 'project') } })
  })

  it('允许 /tag 的版本号位置参数', () => {
    const result = parseTarget('v0.2.0 /srv/project', {
      cwd: '/tmp/work',
      allowVersion: true,
      usage: '/tag [version] [path]',
    })
    expect(result).toEqual({ ok: true, target: { path: '/srv/project', version: 'v0.2.0' } })
  })

  it('不接受版本号的命令把版本号当成路径', () => {
    const result = parseTarget('v0.2.0', { cwd: '/tmp/work', usage: USAGE })
    expect(result).toEqual({ ok: true, target: { path: resolve('/tmp/work', 'v0.2.0') } })
  })

  it('拒绝多个路径', () => {
    const result = parseTarget('a b', { cwd: '/tmp/work', usage: USAGE })
    expect(result.ok).toBe(false)
  })

  it('拒绝多个版本号', () => {
    const result = parseTarget('v1.0.0 v2.0.0', { allowVersion: true, cwd: '/tmp/work', usage: USAGE })
    expect(result.ok).toBe(false)
  })

  it('没有工作目录且没有路径时给出用法提示', () => {
    const result = parseTarget('', { usage: USAGE })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.message).toContain(USAGE)
  })

  it('没有工作目录时拒绝相对路径', () => {
    const result = parseTarget('sub', { usage: USAGE })
    expect(result.ok).toBe(false)
  })
})

describe('resolveDirectory', () => {
  it('接受存在的目录', async () => {
    const directory = await createPlainDirectory()
    await expect(resolveDirectory(directory)).resolves.toEqual({ ok: true, path: directory })
  })

  it('拒绝不存在的目录', async () => {
    const result = await resolveDirectory(join(TMP_ROOT, 'dsh-git-commands-not-here'))
    expect(result.ok).toBe(false)
  })

  it('拒绝文件', async () => {
    const result = await resolveDirectory(join(process.cwd(), 'package.json'))
    expect(result.ok).toBe(false)
  })
})

describe('resolveRepo', () => {
  it('把子目录解析成仓库根', async () => {
    const repo = await createRepo({ 'sub/dir/a.txt': 'a\n' })
    const result = await resolveRepo(join(repo, 'sub', 'dir'))
    expect(result.ok).toBe(true)
    if (result.ok) expect(await realpath(result.repo)).toBe(await realpath(repo))
  })

  it('拒绝不是仓库的目录', async () => {
    const directory = await createPlainDirectory()
    const result = await resolveRepo(directory)
    expect(result.ok).toBe(false)
  })
})
