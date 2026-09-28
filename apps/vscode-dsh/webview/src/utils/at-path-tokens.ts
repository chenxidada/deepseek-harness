/**
 * Browser-safe @path token grammar (mirrors Host at-path extract and the Host-side
 * `ctx.fileReferences` mention grammar; no fs). Must stay algorithmically identical to
 * `packages/context/file-reference/src/grammar.ts`.
 */

export interface ExtractedAtToken {
  token: string
  path: string
  quoted: boolean
  index: number
}

/** Active `@` token ending at the composer caret. */
export interface ActiveAtToken {
  /** Complete token replaced when the user accepts a completion. */
  prefix: string
  /** Path query after `@` or `@"`. */
  query: string
  /** Whether the user opened a quoted path. */
  quoted: boolean
}

/**
 * Extract an `@path` or `@"path with spaces` token at the caret. An `@` inside another
 * token, such as an email address, is not a completion trigger.
 * @param line - current composer line.
 * @param cursorCol - caret column within that line.
 * @returns the active token, or undefined outside an `@` token.
 */
export function activeAtToken(line: string, cursorCol: number): ActiveAtToken | undefined {
  const beforeCursor = line.slice(0, cursorCol)
  const quoted = /(?:^|\s)(@"([^"]*))$/u.exec(beforeCursor)
  if (quoted?.[1] !== undefined && quoted[2] !== undefined) {
    return { prefix: quoted[1], query: quoted[2], quoted: true }
  }
  const plain = /(?:^|\s)(@([^\s]*))$/u.exec(beforeCursor)
  if (plain?.[1] === undefined || plain[2] === undefined) return undefined
  return { prefix: plain[1], query: plain[2], quoted: false }
}

/**
 * Format a selected path as prompt text. Whitespace uses the quoted `@"path"` grammar; a
 * quoted directory keeps that quote open after its trailing slash so completion can
 * descend another level.
 * @param candidate - selected file or directory.
 * @param preserveQuote - retain an explicitly opened quote even when unnecessary.
 * @returns the insertion value, or undefined for a path the grammar cannot represent safely.
 */
export function formatFileMention(
  candidate: { path: string; kind: 'file' | 'directory' },
  preserveQuote: boolean,
): string | undefined {
  const path = candidate.kind === 'directory' ? `${candidate.path}/` : candidate.path
  if (/[\u0000-\u001f\u007f-\u009f"]/u.test(path)) return undefined
  const quoted = preserveQuote || /\s/u.test(path)
  if (!quoted) return `@${path}`
  if (candidate.kind === 'directory') return `@"${path}`
  return `@"${path}"`
}

export function extractAtPathTokens(text: string): ExtractedAtToken[] {
  const out: ExtractedAtToken[] = []
  const re = /(?:^|[\s])(@(?:"([^"]+)"|([^\s"]+)))/gu
  let match: RegExpExecArray | null
  while ((match = re.exec(text)) !== null) {
    const token = match[1]
    const quotedPath = match[2]
    const plainPath = match[3]
    if (token === undefined) continue
    const path = quotedPath ?? plainPath
    if (path === undefined || path.length === 0) continue
    const atIndex = match.index + (match[0].startsWith(token) ? 0 : match[0].length - token.length)
    out.push({
      token,
      path,
      quoted: quotedPath !== undefined,
      index: atIndex,
    })
  }
  return out
}
