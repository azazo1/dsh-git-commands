/**
 * 运行环境探测的行为测试.
 * @module dsh-git-commands/tests/environment
 */

import { describe, expect, it } from 'vitest'
import { readRuntimeFacts, renderRuntimeFact } from '../src/environment.ts'

describe('readRuntimeFacts', () => {
  it('优先用 SHELL 判断默认 shell', () => {
    const facts = readRuntimeFacts({ platform: 'linux', env: { SHELL: '/bin/zsh', ComSpec: 'C:\\Windows\\system32\\cmd.exe' } })
    expect(facts).toEqual({ platform: 'linux', shell: 'zsh' })
  })

  it('没有 SHELL 时回退到 ComSpec', () => {
    const facts = readRuntimeFacts({ platform: 'win32', env: { ComSpec: 'C:\\Windows\\system32\\cmd.exe' } })
    expect(facts).toEqual({ platform: 'win32', shell: 'cmd.exe' })
  })

  it('都拿不到时报告未知', () => {
    expect(readRuntimeFacts({ platform: 'win32', env: {} }).shell).toBeNull()
    expect(readRuntimeFacts({ platform: 'linux', env: { SHELL: '   ' } }).shell).toBeNull()
  })

  it('缺省读取当前进程环境', () => {
    const facts = readRuntimeFacts()
    expect(facts.platform).toBe(process.platform)
  })
})

describe('renderRuntimeFact', () => {
  it('渲染成一行可注入的事实', () => {
    expect(renderRuntimeFact({ platform: 'darwin', shell: 'zsh' })).toBe('运行环境: darwin, 默认 shell: zsh')
  })

  it('shell 未知时如实说明', () => {
    expect(renderRuntimeFact({ platform: 'win32', shell: null })).toBe('运行环境: win32, 默认 shell: 未知')
  })
})
