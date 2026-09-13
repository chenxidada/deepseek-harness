/**
 * Browser-safe @path token extract (mirrors Host at-path extract; no fs).
 */

export interface ExtractedAtToken {
  token: string
  path: string
  quoted: boolean
  index: number
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
