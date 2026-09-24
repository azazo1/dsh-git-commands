/**
 * 注入文本组装的结构测试.
 * @module dsh-git-commands/tests/render
 */

import { describe, expect, it } from 'vitest'
import { renderInjection } from '../src/render.ts'

describe('renderInjection', () => {
  it('依次包含规范文本, 请求行, 仓库事实与上下文段落', () => {
    const text = renderInjection({
      prompt: '规范正文',
      request: '/commit',
      facts: ['仓库: /srv/repo', '分支: main'],
      sections: [{ title: '工作区状态', body: 'M a.txt' }],
    })
    expect(text.startsWith('规范正文')).toBe(true)
    expect(text).toContain('本次请求: /commit')
    expect(text).toContain('仓库: /srv/repo')
    expect(text).toContain('### 工作区状态')
    expect(text).toContain('M a.txt')
    expect(text).toContain('```text')
  })

  it('正文自带围栏时升级外层围栏', () => {
    const text = renderInjection({
      prompt: 'p',
      request: '/commit',
      facts: [],
      sections: [{ title: 't', body: '```js\nx\n```' }],
    })
    expect(text).toContain('````text')
    expect(text).toContain('````\n')
  })

  it('去掉规范文本首尾空白', () => {
    const text = renderInjection({ prompt: '\n规范\n\n', request: '/commit', facts: [], sections: [] })
    expect(text.startsWith('规范\n')).toBe(true)
  })
})
