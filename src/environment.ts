/**
 * 运行环境事实: 平台与默认 shell. 等价命令里的引号与续行写法随 shell 不同, 这些事实
 * 随上下文一起注入, 由模型据此选择写法, 而不是在规范文本里写死某一种 shell.
 * @module dsh-git-commands/environment
 */

/** 一次运行的环境特征. */
export interface RuntimeFacts {
  /** `process.platform` 的值, 例如 darwin, linux, win32. */
  platform: string
  /** 默认 shell 的可执行文件名; 无法判断时为 null. */
  shell: string | null
}

/** 可提供平台与 shell 探测输入的选项, 便于测试. */
export interface RuntimeFactsOptions {
  /** 覆盖平台值, 缺省取 `process.platform`. */
  platform?: string
  /** 覆盖环境变量表, 缺省取 `process.env`. */
  env?: NodeJS.ProcessEnv
}

/**
 * 取路径最后一段作为可执行文件名.
 *
 * 刻意不依赖平台的路径语义: 环境变量里的 shell 路径可能来自另一个平台的写法
 * (例如在 macOS 上读到 `C:\Windows\system32\cmd.exe`), 因此两种分隔符都认.
 *
 * @param candidate - 环境变量里的原始值.
 * @returns 可执行文件名; 全为空白时返回 null.
 */
function executableName(candidate: string): string | null {
  const trimmed = candidate.trim()
  if (trimmed.length === 0) return null
  const index = Math.max(trimmed.lastIndexOf('/'), trimmed.lastIndexOf('\\'))
  return index === -1 ? trimmed : trimmed.slice(index + 1)
}

/**
 * 探测默认 shell: POSIX 用 `SHELL`, Windows 回退到 `ComSpec`.
 *
 * @param env - 环境变量表.
 * @returns shell 可执行文件名; 判断不出时为 null.
 */
function detectShell(env: NodeJS.ProcessEnv): string | null {
  for (const candidate of [env.SHELL, env.ComSpec]) {
    if (typeof candidate !== 'string') continue
    const name = executableName(candidate)
    if (name !== null && name.length > 0) return name
  }
  return null
}

/**
 * 读取当前运行环境事实.
 *
 * @param options - 平台与环境变量覆盖, 仅测试使用.
 * @returns 平台与默认 shell.
 */
export function readRuntimeFacts(options: RuntimeFactsOptions = {}): RuntimeFacts {
  return {
    platform: options.platform ?? process.platform,
    shell: detectShell(options.env ?? process.env),
  }
}

/**
 * 把环境事实渲染成一行注入内容.
 *
 * @param facts - 读取到的环境事实.
 * @returns 一行形如 `运行环境: darwin, 默认 shell: zsh` 的说明.
 */
export function renderRuntimeFact(facts: RuntimeFacts): string {
  return `运行环境: ${facts.platform}, 默认 shell: ${facts.shell ?? '未知'}`
}
