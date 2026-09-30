/**
 * `path:line` references in message bodies (spec 4.6). The panel renders them as
 * clickable file links whose button carries the workspace-relative path and the
 * 1-based line, so the Host opens them through the same reference route the `@`
 * cards use.
 * @module @deepseek-ai/dsh-vscode-dsh/markdown/file-links
 */

/** One `path:line[:column]` reference found in message text. */
export interface FileLineToken {
  /** Offset of the token in the source text. */
  index: number
  /** Length of the whole token, including the line suffix. */
  length: number
  /** Path as written, with its own separators. */
  path: string
  /** 1-based line the reference names. */
  line: number
  /** 1-based column, when the reference names one. */
  column?: number
}

/** Largest line or column suffix treated as a reference rather than prose. */
const MAX_ORDINAL = 1_000_000

/**
 * Path plus line suffix: at least one `/`, a file extension, then `:line` and an
 * optional `:column`. A leading `./` or `../` belongs to the token; a scheme, a
 * preceding word character, or an `@` prefix keeps it plain text.
 */
const TOKEN_SOURCE = '(?<![\\w@:/.\\-])((?:\\.{1,2}/)?(?:[\\w@-]+/)+[\\w@-]+\\.[A-Za-z][\\w]*):(\\d{1,7})(?::(\\d{1,5}))?(?![\\w:])'

/**
 * Extract file references from one plain text run.
 * @param text - message text, without markup handling.
 * @returns the references in source order; an empty array when the run has none.
 */
export function extractFileLineTokens(text: string): FileLineToken[] {
  const tokens: FileLineToken[] = []
  const re = new RegExp(TOKEN_SOURCE, 'g')
  let match = re.exec(text)
  while (match !== null) {
    const path = match[1]
    const line = Number(match[2])
    const columnRaw = match[3]
    const column = columnRaw === undefined ? undefined : Number(columnRaw)
    if (path !== undefined && isOrdinal(line)) {
      tokens.push({
        index: match.index,
        length: match[0].length,
        path,
        line,
        ...column === undefined || !isOrdinal(column) ? {} : { column },
      })
    }
    match = re.exec(text)
  }
  return tokens
}

function isOrdinal(value: number): boolean {
  return Number.isSafeInteger(value) && value >= 1 && value <= MAX_ORDINAL
}
