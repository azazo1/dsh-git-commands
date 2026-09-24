/**
 * 仓库上下文采集的结构测试, 用临时 git 仓库跑真实只读命令.
 * @module dsh-git-commands/tests/snapshot
 */

import { describe, expect, it } from 'vitest'
import {
  collectCommitContext,
  collectCommitFastContext,
  collectPushContext,
  collectRepoCreateContext,
  collectTagContext,
} from '../src/git/snapshot.ts'
import { createPlainDirectory, createRepo, git, writeFileIn } from './helpers.ts'

const OPTIONS = { logLimit: 5, diffLineLimit: 100 }

/** 取全部段落标题拼接, 便于结构化断言. */
function titles(sections: readonly { title: string }[]): string {
  return sections.map(section => section.title).join('\n')
}

describe('collectCommitContext', () => {
  it('给出 staged 统计与 staged diff 内容', async () => {
    const repo = await createRepo({ 'a.txt': 'a\n' })
    await writeFileIn(repo, 'c.txt', 'hello\n')
    await git(repo, ['add', 'c.txt'])

    const result = await collectCommitContext(repo, OPTIONS)

    expect(titles(result.sections)).toContain('git status')
    expect(titles(result.sections)).toContain('git diff --cached')
    expect(result.summary).toContain('1')
    expect(result.sections.some(section => section.body.includes('+hello'))).toBe(true)
    expect(result.facts.join('\n')).toContain('分支: main')
  })

  it('diff 超过上限时标注截断', async () => {
    const repo = await createRepo()
    const body = Array.from({ length: 120 }, (_, index) => `line ${String(index)}`).join('\n')
    await writeFileIn(repo, 'big.txt', `${body}\n`)
    await git(repo, ['add', 'big.txt'])

    const result = await collectCommitContext(repo, { logLimit: 5, diffLineLimit: 10 })
    const diff = result.sections.find(section => section.title.includes('已暂存 diff'))

    expect(diff?.body).toContain('已截断')
    expect(diff?.body).not.toContain('line 119')
  })

  it('采集历史 commit message 作为风格参考', async () => {
    const repo = await createRepo()
    const result = await collectCommitContext(repo, OPTIONS)
    const history = result.sections.find(section => section.title.includes('commit message'))
    expect(history?.body).toContain('feat: 加入初始文件')
    expect(history?.body).toContain('chore: 初始化仓库')
  })
})

describe('collectCommitFastContext', () => {
  it('只给状态与历史, 不给 diff', async () => {
    const repo = await createRepo()
    await writeFileIn(repo, 'c.txt', 'c\n')
    await git(repo, ['add', 'c.txt'])

    const result = await collectCommitFastContext(repo, OPTIONS)

    expect(titles(result.sections)).toContain('git status')
    expect(titles(result.sections)).not.toContain('diff')
  })
})

describe('collectTagContext', () => {
  it('没有 tag 时说明并以全部提交作为发布依据', async () => {
    const repo = await createRepo()
    const result = await collectTagContext(repo, OPTIONS)
    expect(result.facts.join('\n')).toContain('(没有 tag)')
    expect(titles(result.sections)).toContain('版本号')
  })

  it('有 tag 时只取上一个 tag 以来的提交', async () => {
    const repo = await createRepo()
    await git(repo, ['tag', 'v0.1.0'])
    await writeFileIn(repo, 'later.txt', 'later\n')
    await git(repo, ['add', '.'])
    await git(repo, ['-c', 'user.name=test', '-c', 'user.email=test@example.com', 'commit', '-m', 'feat: tag 之后的改动'])

    const result = await collectTagContext(repo, OPTIONS)
    const since = result.sections.find(section => section.title.includes('v0.1.0..HEAD'))

    expect(since?.body).toContain('feat: tag 之后的改动')
    expect(since?.body).not.toContain('chore: 初始化仓库')
  })
})

describe('collectPushContext', () => {
  it('没有上游时说明需要建立跟踪', async () => {
    const repo = await createRepo()
    const result = await collectPushContext(repo, OPTIONS)
    expect(result.summary).toContain('没有上游分支')
    expect(titles(result.sections)).toContain('远端列表')
  })
})

describe('collectRepoCreateContext', () => {
  it('目标还不是仓库时也能采集项目线索', async () => {
    const directory = await createPlainDirectory()
    await writeFileIn(directory, 'package.json', JSON.stringify({ name: 'demo', description: '一个示例项目', keywords: ['dsh-plugin'] }))
    await writeFileIn(directory, 'README.md', '# demo\n\n示例定位说明.\n')

    const result = await collectRepoCreateContext(directory, OPTIONS)
    const facts = result.facts.join('\n')
    const project = result.sections.find(section => section.title.includes('描述线索'))

    expect(facts).toContain('尚未初始化')
    expect(project?.body).toContain('demo')
    expect(project?.body).toContain('一个示例项目')
    expect(project?.body).toContain('dsh-plugin')
  })

  it('已初始化的仓库给出远端与提交数', async () => {
    const repo = await createRepo()
    const result = await collectRepoCreateContext(repo, OPTIONS)
    expect(result.facts.join('\n')).toContain('已初始化')
  })
})
