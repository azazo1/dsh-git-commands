/**
 * 行数截断的行为测试.
 * @module dsh-git-commands/tests/truncate
 */

import { describe, expect, it } from 'vitest'
import { truncateLines } from '../src/git/truncate.ts'

describe('truncateLines', () => {
  it('少于上限时原样返回', () => {
    expect(truncateLines('a\nb', 5)).toEqual({ text: 'a\nb', totalLines: 2, shownLines: 2, truncated: false })
  })

  it('等于上限时不截断', () => {
    expect(truncateLines('a\nb\nc', 3).truncated).toBe(false)
  })

  it('超过上限时保留前若干行并报告总行数', () => {
    const result = truncateLines('1\n2\n3\n4', 2)
    expect(result).toEqual({ text: '1\n2', totalLines: 4, shownLines: 2, truncated: true })
  })

  it('末尾换行不额外算一行', () => {
    expect(truncateLines('1\n2\n', 2)).toEqual({ text: '1\n2', totalLines: 2, shownLines: 2, truncated: false })
  })

  it('空文本返回空结果', () => {
    expect(truncateLines('', 3)).toEqual({ text: '', totalLines: 0, shownLines: 0, truncated: false })
  })

  it('拒绝非法上限', () => {
    expect(() => truncateLines('a', 0)).toThrow(TypeError)
    expect(() => truncateLines('a', 1.5)).toThrow(TypeError)
  })
})
