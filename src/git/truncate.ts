/**
 * 注入文本的行数截断: staged diff 这类输出可能很大, 采集时保留前若干行并标注总量.
 * @module dsh-git-commands/git/truncate
 */

/** 一次截断的结果. */
export interface TruncatedText {
  /** 保留的正文 (未附加标注). */
  text: string
  /** 原文总行数. */
  totalLines: number
  /** 保留的行数. */
  shownLines: number
  /** 是否发生了截断. */
  truncated: boolean
}

/**
 * 按行保留文本的前 `limit` 行.
 *
 * @param text - 原始文本; 末尾换行不会额外产生一行.
 * @param limit - 最多保留的行数, 必须为正整数.
 * @returns 截断结果; `text` 只含保留的行, 标注由调用方决定.
 */
export function truncateLines(text: string, limit: number): TruncatedText {
  if (!Number.isInteger(limit) || limit < 1) {
    throw new TypeError(`truncateLines: limit 必须是正整数, 收到 ${String(limit)}`)
  }
  const normalized = text.endsWith('\n') ? text.slice(0, -1) : text
  if (normalized.length === 0) {
    return { text: '', totalLines: 0, shownLines: 0, truncated: false }
  }
  const lines = normalized.split('\n')
  if (lines.length <= limit) {
    return { text: normalized, totalLines: lines.length, shownLines: lines.length, truncated: false }
  }
  return {
    text: lines.slice(0, limit).join('\n'),
    totalLines: lines.length,
    shownLines: limit,
    truncated: true,
  }
}
