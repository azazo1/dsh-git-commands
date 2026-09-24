/**
 * 项目文件探测: 版本号所在文件, 以及建仓库时需要参考的项目自身线索.
 * @module dsh-git-commands/git/probe
 */

import { readFile, readdir, stat } from 'node:fs/promises'
import { join } from 'node:path'

/** 读取项目文件时允许的最大字节数. */
const MAX_FILE_BYTES = 64 * 1024

/** README 只取开头若干行, 够判断项目定位即可. */
const README_HEAD_LINES = 20

/** 顶层条目最多列出的数量. */
const MAX_TOP_ENTRIES = 30

/** 探测版本号时查看的文件, 按优先级排序. */
const VERSION_FILE_CANDIDATES = ['package.json', 'Cargo.toml', 'pyproject.toml', 'composer.json'] as const

/** README 候选文件名, 按优先级排序. */
const README_CANDIDATES = ['README.md', 'README.zh.md', 'README.rst', 'README.txt'] as const

/** 一个候选版本文件的内容摘要. */
export interface VersionFileInfo {
  /** 相对仓库根的路径. */
  file: string
  /** 提取到的版本号; 无法提取时为 null. */
  version: string | null
}

/** README 开头内容. */
export interface ReadmeHead {
  /** 相对仓库根的路径. */
  file: string
  /** 开头若干行. */
  text: string
}

/** 建仓库需要的项目线索. */
export interface ProjectHints {
  /** package.json 的 name. */
  packageName: string | null
  /** package.json 的 description. */
  packageDescription: string | null
  /** package.json 的 keywords. */
  packageKeywords: string[]
  /** README 开头内容. */
  readme: ReadmeHead | null
  /** 顶层条目 (不含 .git 与 node_modules). */
  topEntries: string[]
  /** .gitignore 是否存在与行数. */
  gitignore: { present: boolean; lines: number }
}

/** 读取文件内容; 文件过大或不可读时返回 null. */
async function readTextFile(path: string): Promise<string | null> {
  try {
    const info = await stat(path)
    if (!info.isFile() || info.size > MAX_FILE_BYTES) return null
    return await readFile(path, 'utf8')
  } catch {
    return null
  }
}

/** 从 JSON 文本里取字符串字段. */
function jsonString(text: string, key: string): string | null {
  try {
    const parsed: unknown = JSON.parse(text)
    if (typeof parsed !== 'object' || parsed === null) return null
    const value: unknown = Reflect.get(parsed, key)
    return typeof value === 'string' ? value : null
  } catch {
    return null
  }
}

/** 从 TOML 文本里取顶层 version 字段. */
function tomlVersion(text: string): string | null {
  const match = /^version\s*=\s*"([^"]+)"/mu.exec(text)
  return match?.[1] ?? null
}

/**
 * 探测项目里记录版本号的文件.
 *
 * @param repo - 仓库根路径.
 * @returns 存在的候选文件及其版本号, 最多三个.
 */
export async function readVersionFiles(repo: string): Promise<VersionFileInfo[]> {
  const found: VersionFileInfo[] = []
  for (const file of VERSION_FILE_CANDIDATES) {
    const text = await readTextFile(join(repo, file))
    if (text === null) continue
    const version = file.endsWith('.json') ? jsonString(text, 'version') : tomlVersion(text)
    found.push({ file, version })
    if (found.length >= 3) break
  }
  return found
}

/**
 * 读取建仓库需要的项目线索: package.json 元数据, README 开头, 顶层条目, .gitignore.
 *
 * @param repo - 仓库根路径.
 * @returns 项目线索; 缺失的文件以 null 或空值表示.
 */
export async function readProjectHints(repo: string): Promise<ProjectHints> {
  const packageText = await readTextFile(join(repo, 'package.json'))
  const keywords: string[] = []
  if (packageText !== null) {
    try {
      const parsed: unknown = JSON.parse(packageText)
      const raw: unknown = typeof parsed === 'object' && parsed !== null ? Reflect.get(parsed, 'keywords') : undefined
      if (Array.isArray(raw)) {
        for (const item of raw) {
          if (typeof item === 'string') keywords.push(item)
        }
      }
    } catch {
      // package.json 不可解析时忽略 keywords, 其余字段同样为 null.
    }
  }

  let readme: ReadmeHead | null = null
  for (const file of README_CANDIDATES) {
    const text = await readTextFile(join(repo, file))
    if (text === null) continue
    readme = { file, text: text.split('\n').slice(0, README_HEAD_LINES).join('\n').trim() }
    break
  }

  let topEntries: string[] = []
  try {
    const entries = await readdir(repo, { withFileTypes: true })
    topEntries = entries
      .filter(entry => entry.name !== '.git' && entry.name !== 'node_modules')
      .map(entry => (entry.isDirectory() ? `${entry.name}/` : entry.name))
      .sort((left, right) => left.localeCompare(right))
      .slice(0, MAX_TOP_ENTRIES)
  } catch {
    topEntries = []
  }

  const gitignoreText = await readTextFile(join(repo, '.gitignore'))
  const gitignore = gitignoreText === null
    ? { present: false, lines: 0 }
    : { present: true, lines: gitignoreText.split('\n').filter(line => line.trim().length > 0).length }

  return {
    packageName: packageText === null ? null : jsonString(packageText, 'name'),
    packageDescription: packageText === null ? null : jsonString(packageText, 'description'),
    packageKeywords: keywords,
    readme,
    topEntries,
    gitignore,
  }
}
