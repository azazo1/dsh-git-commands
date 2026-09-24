/**
 * 未跟踪文件内容: 暂存区为空时提交范围回退到自上一次 commit 以来的全部改动, 而
 * git diff HEAD 不包含新文件, 因此这里把未被 .gitignore 忽略的未跟踪文件渲染成
 * 新增文件的 diff 片段, 让模型不必自己再去读这些文件.
 * @module dsh-git-commands/git/untracked
 */

import { readFile, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { runGit } from './exec.ts'

/** 单个未跟踪文件最多附上的字节数, 超出时只记录文件名. */
const MAX_FILE_BYTES = 64 * 1024

/** 最多附上多少个未跟踪文件的内容. */
const MAX_FILES = 50

/** 未跟踪文件内容的采集结果. */
export interface UntrackedPatch {
  /** 新增文件的 diff 片段与未附上的说明; 没有未跟踪文件时为空串. */
  text: string
  /** 实际附上内容的文件数. */
  included: number
  /** 探测到的未跟踪文件总数. */
  total: number
}

/** 用 NUL 字节判断内容是否为二进制. */
function looksBinary(buffer: Buffer): boolean {
  return buffer.includes(0)
}

/**
 * 把一个新文件渲染成 git 风格的新增文件 diff 片段.
 *
 * @param path - 相对仓库根的路径.
 * @param content - 文件文本内容.
 * @returns 片段文本, 文件为空时只有头部与空 hunk.
 */
function renderNewFile(path: string, content: string): string {
  const normalized = content.endsWith('\n') ? content.slice(0, -1) : content
  const lines = normalized.length === 0 ? [] : normalized.split('\n')
  return [
    '--- /dev/null',
    `+++ b/${path}`,
    lines.length === 0 ? '@@ -0,0 +0,0 @@' : `@@ -0,0 +1,${String(lines.length)} @@`,
    ...lines.map(line => `+${line}`),
  ].join('\n')
}

/**
 * 采集未跟踪 (且未被忽略) 文件的内容.
 *
 * 只读取普通文本文件, 二进制, 超大文件与读不到的文件只列出名字; 未跟踪文件过多
 * 时只附前若干个, 其余数量在末尾说明.
 *
 * @param repo - 仓库根.
 * @param options - 取消信号.
 * @returns 片段文本与文件计数.
 */
export async function readUntrackedPatch(
  repo: string,
  options: { signal?: AbortSignal } = {},
): Promise<UntrackedPatch> {
  const listed = await runGit(repo, ['ls-files', '--others', '--exclude-standard', '-z'], { signal: options.signal })
  if (!listed.ok) return { text: '', included: 0, total: 0 }

  const paths = listed.stdout.split('\0')
    .filter(path => path.length > 0)
    .sort((left, right) => left.localeCompare(right))
  const kept = paths.slice(0, MAX_FILES)
  const blocks: string[] = []
  const skipped: string[] = []

  for (const path of kept) {
    const absolute = join(repo, path)
    const info = await stat(absolute).catch(() => null)
    if (info === null || !info.isFile()) {
      skipped.push(`${path} (不是普通文件)`)
      continue
    }
    if (info.size > MAX_FILE_BYTES) {
      skipped.push(`${path} (超过 ${String(MAX_FILE_BYTES / 1024)} KiB)`)
      continue
    }
    const raw = await readFile(absolute).catch(() => null)
    if (raw === null) {
      skipped.push(`${path} (读取失败)`)
      continue
    }
    if (looksBinary(raw)) {
      skipped.push(`${path} (二进制)`)
      continue
    }
    blocks.push(renderNewFile(path, raw.toString('utf8')))
  }

  const notes: string[] = []
  if (skipped.length > 0) notes.push(`未附上内容的未跟踪文件: ${skipped.join(', ')}.`)
  const rest = paths.length - kept.length
  if (rest > 0) notes.push(`另有 ${String(rest)} 个未跟踪文件没有附上 (只附前 ${String(MAX_FILES)} 个).`)

  return {
    text: [...blocks, ...notes].join('\n\n'),
    included: blocks.length,
    total: paths.length,
  }
}
