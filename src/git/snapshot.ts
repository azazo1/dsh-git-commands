/**
 * 仓库上下文采集: 按命令各自的需要跑只读 git 命令, 产出结构化段落.
 * @module dsh-git-commands/git/snapshot
 */

import { stat } from 'node:fs/promises'
import { join } from 'node:path'
import { runGit, runGitOrThrow } from './exec.ts'
import { readProjectHints, readVersionFiles, type ProjectHints, type VersionFileInfo } from './probe.ts'
import { truncateLines } from './truncate.ts'

/** 一条 commit 的摘要. */
export interface CommitEntry {
  hash: string
  date: string
  subject: string
  body: string
}

/** 采集出的一段上下文. */
export interface ContextSection {
  /** 段落标题, 同时也是对应 git 命令的说明. */
  title: string
  /** 段落正文, 原样注入. */
  body: string
}

/** 一次采集的结果. */
export interface CollectResult {
  /** 仓库基本事实, 逐行注入. */
  facts: string[]
  /** 按顺序注入的段落. */
  sections: ContextSection[]
  /** 给命令回执用的简短统计. */
  summary: string
}

/** 采集参数. */
export interface CollectOptions {
  /** 采集最近多少条 commit message. */
  logLimit: number
  /** staged diff 最多保留多少行. */
  diffLineLimit: number
  /** 命令调用方的取消信号. */
  signal?: AbortSignal
}

/** tag 列表与自上一个 tag 以来的提交最多采集的数量. */
const MAX_TAG_RANGE_COMMITS = 200

/** log 输出使用的字段分隔符 (unit separator) 与记录分隔符 (record separator). */
const FIELD = '\u001f'
const RECORD = '\u001e'

/** log 输出格式: hash, 日期, 标题, 正文. */
const LOG_FORMAT = `%h${FIELD}%ad${FIELD}%s${FIELD}%b${RECORD}`

/** 把 git 输出切成非空行. */
function linesOf(text: string): string[] {
  return text.split('\n').map(line => line.trimEnd()).filter(line => line.length > 0)
}

/** 空输出时给出占位说明. */
function orEmpty(text: string, placeholder: string): string {
  const trimmed = text.trim()
  return trimmed.length === 0 ? placeholder : trimmed
}

/**
 * 读当前分支; detached HEAD 时给出 commit hash.
 *
 * @param repo - 仓库根.
 * @param signal - 取消信号.
 * @returns 分支名或 detached 描述.
 */
async function readBranch(repo: string, signal?: AbortSignal): Promise<string> {
  const branch = (await runGit(repo, ['rev-parse', '--abbrev-ref', 'HEAD'], { signal })).stdout.trim()
  if (branch.length > 0 && branch !== 'HEAD') return branch
  const head = (await runGit(repo, ['rev-parse', '--short', 'HEAD'], { signal })).stdout.trim()
  return head.length === 0 ? '(尚无提交)' : `detached HEAD ${head}`
}

/** 读 HEAD 的短 hash. */
async function readHead(repo: string, signal?: AbortSignal): Promise<string> {
  const head = (await runGit(repo, ['rev-parse', '--short', 'HEAD'], { signal })).stdout.trim()
  return head.length === 0 ? '(尚无提交)' : head
}

/**
 * 读最近若干条 commit message.
 *
 * @param repo - 仓库根.
 * @param limit - 最多读取条数.
 * @param signal - 取消信号.
 * @param range - 可选 revision 范围, 例如 `<tag>..HEAD`.
 * @returns 解析后的提交记录; 命令失败 (例如空仓库) 时返回空数组.
 */
async function readHistory(
  repo: string,
  limit: number,
  signal?: AbortSignal,
  range?: string,
): Promise<CommitEntry[]> {
  const args = ['log', `-n${limit}`, '--date=short', `--pretty=format:${LOG_FORMAT}`]
  if (range !== undefined) args.push(range)
  const result = await runGit(repo, args, { signal })
  if (!result.ok) return []
  const entries: CommitEntry[] = []
  for (const record of result.stdout.split(RECORD)) {
    const fields = record.replace(/^\n+/u, '').split(FIELD)
    if (fields.length < 3) continue
    const [hash, date, subject, body = ''] = fields
    if (hash === undefined || date === undefined || subject === undefined) continue
    entries.push({ hash, date, subject, body: body.trim() })
  }
  return entries
}

/** 渲染提交列表. */
function renderHistory(entries: readonly CommitEntry[]): string {
  if (entries.length === 0) return '(没有可用的提交记录)'
  return entries.map((entry) => {
    const header = `${entry.hash} (${entry.date}) ${entry.subject}`
    return entry.body.length === 0 ? header : `${header}\n${entry.body}`
  }).join('\n---\n')
}

/** 采集 `git status --porcelain` 文本. */
async function readStatus(repo: string, signal?: AbortSignal): Promise<string> {
  const result = await runGit(repo, ['status', '--porcelain=v1', '-uall'], { signal })
  return result.stdout
}

/**
 * 采集 `/commit` 需要的上下文: staged 范围, staged diff 与历史风格.
 *
 * @param repo - 仓库根.
 * @param options - 采集上限与取消信号.
 * @returns 采集结果.
 */
export async function collectCommitContext(repo: string, options: CollectOptions): Promise<CollectResult> {
  const { signal } = options
  const branch = await readBranch(repo, signal)
  const head = await readHead(repo, signal)
  const status = await readStatus(repo, signal)
  const stagedStat = await runGitOrThrow(repo, ['diff', '--cached', '--stat', '--no-color'], { signal })
  const stagedDiff = await runGitOrThrow(repo, ['diff', '--cached', '--no-color'], { signal })
  const history = await readHistory(repo, options.logLimit, signal)
  const stagedFiles = linesOf(status).filter(line => /^[MADRCU]/u.test(line)).length
  const diff = truncateLines(stagedDiff, options.diffLineLimit)
  const diffBody = diff.totalLines === 0
    ? '(没有任何已暂存的改动)'
    : [
        diff.text,
        ...diff.truncated
          ? [`...(已截断: 只给出前 ${String(diff.shownLines)} 行, 共 ${String(diff.totalLines)} 行; 需要看剩余部分时再自己执行 git diff --cached)`]
          : [],
      ].join('\n')

  return {
    facts: [`仓库: ${repo}`, `分支: ${branch}`, `HEAD: ${head}`],
    sections: [
      { title: '工作区状态 (git status --porcelain=v1 -uall)', body: orEmpty(status, '(工作区干净)') },
      { title: '已暂存改动统计 (git diff --cached --stat)', body: orEmpty(stagedStat, '(没有已暂存的改动)') },
      { title: '已暂存 diff (git diff --cached)', body: diffBody },
      { title: `最近 ${String(options.logLimit)} 条 commit message (风格参考)`, body: renderHistory(history) },
    ],
    summary: `已暂存 ${String(stagedFiles)} 个文件, staged diff ${String(diff.totalLines)} 行, 历史 ${String(history.length)} 条`,
  }
}

/**
 * 采集 `/commit-fast` 需要的上下文: 只有状态与历史, 不含 diff.
 *
 * @param repo - 仓库根.
 * @param options - 采集上限与取消信号.
 * @returns 采集结果.
 */
export async function collectCommitFastContext(repo: string, options: CollectOptions): Promise<CollectResult> {
  const { signal } = options
  const branch = await readBranch(repo, signal)
  const head = await readHead(repo, signal)
  const status = await readStatus(repo, signal)
  const history = await readHistory(repo, options.logLimit, signal)
  const changedFiles = linesOf(status).length

  return {
    facts: [`仓库: ${repo}`, `分支: ${branch}`, `HEAD: ${head}`],
    sections: [
      { title: '工作区状态 (git status --porcelain=v1 -uall)', body: orEmpty(status, '(工作区干净)') },
      { title: `最近 ${String(options.logLimit)} 条 commit message (风格参考)`, body: renderHistory(history) },
    ],
    summary: `改动 ${String(changedFiles)} 项, 历史 ${String(history.length)} 条 (未采集 diff)`,
  }
}

/**
 * 采集 `/tag` 需要的上下文: 最近 tag, 自上一个 tag 以来的提交, 版本文件.
 *
 * @param repo - 仓库根.
 * @param options - 采集上限与取消信号.
 * @returns 采集结果.
 */
export async function collectTagContext(repo: string, options: CollectOptions): Promise<CollectResult> {
  const { signal } = options
  const branch = await readBranch(repo, signal)
  const head = await readHead(repo, signal)
  const status = await readStatus(repo, signal)
  const tagsResult = await runGit(repo, [
    'for-each-ref', '--sort=-creatordate', '--count=5',
    `--format=%(refname:short)${FIELD}%(creatordate:short)${FIELD}%(subject)`, 'refs/tags',
  ], { signal })
  const tags = tagsResult.stdout.split('\n')
    .map(line => line.trim())
    .filter(line => line.length > 0)
    .map((line) => {
      const [name, date, subject = ''] = line.split(FIELD)
      return `${name ?? ''} (${date ?? '未知日期'}) ${subject}`.trim()
    })
  const lastTag = tagsResult.stdout.split('\n').find(line => line.trim().length > 0)?.split(FIELD)[0]?.trim()
  const since = lastTag === undefined || lastTag.length === 0
    ? await readHistory(repo, MAX_TAG_RANGE_COMMITS, signal)
    : await readHistory(repo, MAX_TAG_RANGE_COMMITS, signal, `${lastTag}..HEAD`)
  const versionFiles = await readVersionFiles(repo)
  const versionBody = versionFiles.length === 0
    ? '(没有探测到常见的版本文件)'
    : versionFiles.map(info => `${info.file}: ${info.version ?? '未找到 version 字段'}`).join('\n')

  return {
    facts: [
      `仓库: ${repo}`,
      `分支: ${branch}`,
      `HEAD: ${head}`,
      `上一个 tag: ${lastTag === undefined || lastTag.length === 0 ? '(没有 tag)' : lastTag}`,
    ],
    sections: [
      { title: '最近的 tag (最新在前)', body: tags.length === 0 ? '(没有任何 tag)' : tags.join('\n') },
      {
        title: lastTag === undefined || lastTag.length === 0
          ? `全部提交 (最多 ${String(MAX_TAG_RANGE_COMMITS)} 条, 完整 message)`
          : `${lastTag}..HEAD 之间的提交 (最多 ${String(MAX_TAG_RANGE_COMMITS)} 条, 完整 message)`,
        body: renderHistory(since),
      },
      { title: '项目里的版本号 (探测结果)', body: versionBody },
      { title: '工作区状态 (git status --porcelain=v1 -uall)', body: orEmpty(status, '(工作区干净)') },
    ],
    summary: `tag ${String(tags.length)} 个, 上一个 tag 以来提交 ${String(since.length)} 条, 版本文件 ${String(versionFiles.length)} 个`,
  }
}

/**
 * 采集 `/push` 需要的上下文: 分支, 上游, ahead 与 behind, 未推送提交.
 *
 * @param repo - 仓库根.
 * @param options - 采集上限与取消信号.
 * @returns 采集结果.
 */
export async function collectPushContext(repo: string, options: CollectOptions): Promise<CollectResult> {
  const { signal } = options
  const branch = await readBranch(repo, signal)
  const head = await readHead(repo, signal)
  const upstreamResult = await runGit(repo, ['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}'], { signal })
  const upstream = upstreamResult.ok ? upstreamResult.stdout.trim() : ''
  const remotes = await runGit(repo, ['remote', '-v'], { signal })
  let tracking = '没有设置上游分支 (需要 git push -u <remote> <branch>)'
  let unpushed: CommitEntry[] = []
  if (upstream.length > 0) {
    const counts = await runGit(repo, ['rev-list', '--left-right', '--count', '@{u}...HEAD'], { signal })
    const [behind, ahead] = counts.stdout.trim().split(/\s+/u)
    tracking = `上游: ${upstream}; 落后远端 ${behind ?? '?'} 个提交, 领先远端 ${ahead ?? '?'} 个提交`
    unpushed = await readHistory(repo, MAX_TAG_RANGE_COMMITS, signal, '@{u}..HEAD')
  }

  return {
    facts: [`仓库: ${repo}`, `分支: ${branch}`, `HEAD: ${head}`],
    sections: [
      { title: '上游与领先/落后 (git rev-parse @{u}, git rev-list --left-right --count)', body: tracking },
      { title: '远端列表 (git remote -v)', body: orEmpty(remotes.stdout, '(没有配置远端)') },
      {
        title: '尚未推送的提交 (完整 message)',
        body: upstream.length === 0 ? '(没有上游分支, 无法计算未推送的提交)' : renderHistory(unpushed),
      },
      { title: '工作区状态 (git status --porcelain=v1 -uall)', body: orEmpty(await readStatus(repo, signal), '(工作区干净)') },
    ],
    summary: upstream.length === 0
      ? '没有上游分支'
      : `未推送提交 ${String(unpushed.length)} 条, 上游 ${upstream}`,
  }
}

/**
 * 采集 `/repo-create` 需要的上下文: 目录是否已是仓库, 远端, 提交数, 项目线索.
 *
 * 目标目录可以还不是 git 仓库, 因此这里只做探测, 不把 "不是仓库" 当成错误.
 *
 * @param directory - 目标目录绝对路径.
 * @param options - 采集上限与取消信号.
 * @returns 采集结果.
 */
export async function collectRepoCreateContext(directory: string, options: CollectOptions): Promise<CollectResult> {
  const { signal } = options
  const gitDirPresent = await stat(join(directory, '.git')).then(() => true, () => false)
  const remotes = gitDirPresent ? await runGit(directory, ['remote', '-v'], { signal }) : null
  const commitCount = gitDirPresent
    ? (await runGit(directory, ['rev-list', '--count', 'HEAD'], { signal })).stdout.trim()
    : ''
  const status = gitDirPresent ? await readStatus(directory, signal) : ''
  const hints: ProjectHints = await readProjectHints(directory)
  const versionFiles: VersionFileInfo[] = await readVersionFiles(directory)

  const projectLines = [
    `package.json name: ${hints.packageName ?? '(没有 package.json 或没有该字段)'}`,
    `package.json description: ${hints.packageDescription ?? '(没有该字段)'}`,
    `package.json keywords: ${hints.packageKeywords.length === 0 ? '(没有)' : hints.packageKeywords.join(', ')}`,
    `README: ${hints.readme === null ? '(没有 README)' : hints.readme.file}`,
    `版本文件: ${versionFiles.length === 0 ? '(没有探测到)' : versionFiles.map(info => `${info.file}=${info.version ?? '未知'}`).join(', ')}`,
    `.gitignore: ${hints.gitignore.present ? `存在, ${String(hints.gitignore.lines)} 条非空规则` : '不存在, 需要按项目类型补齐'}`,
  ]

  return {
    facts: [
      `目标目录: ${directory}`,
      `git 仓库: ${gitDirPresent ? '已初始化' : '尚未初始化'}`,
      `提交数: ${commitCount.length === 0 ? '(未知, 可能尚无提交)' : commitCount}`,
    ],
    sections: [
      { title: '项目自身的描述线索', body: projectLines.join('\n') },
      ...hints.readme === null ? [] : [{ title: `README 开头 (${hints.readme.file})`, body: hints.readme.text }],
      { title: '顶层条目', body: hints.topEntries.length === 0 ? '(目录为空)' : hints.topEntries.join('\n') },
      { title: '远端列表 (git remote -v)', body: remotes === null ? '(尚未初始化仓库)' : orEmpty(remotes.stdout, '(没有配置远端)') },
      { title: '工作区状态 (git status --porcelain=v1 -uall)', body: gitDirPresent ? orEmpty(status, '(工作区干净)') : '(尚未初始化仓库)' },
    ],
    summary: gitDirPresent
      ? `已初始化仓库, ${String(hints.topEntries.length)} 个顶层条目, .gitignore ${hints.gitignore.present ? '存在' : '缺失'}`
      : `尚未初始化仓库, ${String(hints.topEntries.length)} 个顶层条目, .gitignore ${hints.gitignore.present ? '存在' : '缺失'}`,
  }
}
