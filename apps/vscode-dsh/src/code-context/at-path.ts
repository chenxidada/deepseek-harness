/**
 * Official `@path` / `@"path with spaces"` extract + workspace resolve (AD-CCD-11).
 * Send-gate only — never reads file contents into the prompt (AD-CCD-11 VOID).
 * @module @deepseek-ai/dsh-vscode-dsh/code-context/at-path
 */

import { existsSync } from 'node:fs'
import { isAbsolute, join, normalize, relative, resolve, sep } from 'node:path'
import { formatFileMention } from '@deepseek-ai/dsh-file-reference/grammar'

/** Reject reasons allowed by AtPathResolve (P1-2: no `unreadable`). */
export type AtPathRejectReason = 'not-found' | 'outside-workspace' | 'ambiguous-root'

/** Workspace resolve result for one extracted `@` token path. */
export type AtPathResolve =
  | { ok: true; path: string; abs: string }
  | { ok: false; raw: string; reason: AtPathRejectReason }

/** One extracted `@` token (path only; natural-language suffix excluded). */
export interface ExtractedAtToken {
  /** Full token text including `@` / quotes (e.g. `@"my file.ts"`). */
  token: string
  /** Path payload inside the token. */
  path: string
  /** Whether the token used quoted grammar. */
  quoted: boolean
  /** Start index in the source text. */
  index: number
}

/** Options for workspace path resolution. */
export interface ResolveAtPathOptions {
  /** Absolute workspace folder paths (multi-root). */
  workspaceFolders: readonly string[]
  /**
   * Preferred root (active editor's workspace folder). Tried first for relative paths.
   */
  preferredFolder?: string | undefined
  /**
   * Existence probe (defaults to `fs.existsSync`). Must not read file bytes.
   * @param absPath - absolute filesystem path.
   */
  exists?: (absPath: string) => boolean
}

/**
 * Scan full composer / user text for complete official `@` tokens.
 * Mirrors `activeAtToken` / `formatFileMention` boundaries: `(?:^|\s)` then
 * `@"…"` (closed) or `@` + non-whitespace. Natural-language suffixes after the
 * token are not part of the path (AD-CCD-11 / P1-3).
 * @param text - full message text.
 * @returns extracted tokens in encounter order (duplicates retained).
 */
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

/**
 * Unique raw path payloads from `@` tokens (encounter order preserved).
 * @param text - full message text.
 */
export function extractAtPaths(text: string): string[] {
  const seen = new Set<string>()
  const paths: string[] = []
  for (const token of extractAtPathTokens(text)) {
    const key = normalizePathKey(token.path)
    if (seen.has(key)) continue
    seen.add(key)
    paths.push(token.path)
  }
  return paths
}

/**
 * Format a workspace-relative path as an official `@` mention.
 * Whitespace paths use `@"…"` (formatFileMention); never emit unquoted spaces.
 * @param workspaceRelativePath - path relative to a workspace root.
 * @returns official token, or `undefined` when the grammar cannot represent it.
 */
export function formatOfficialAtPath(workspaceRelativePath: string): string | undefined {
  const trimmed = workspaceRelativePath.replace(/\\/g, '/').replace(/^\.\//u, '')
  return formatFileMention({ path: trimmed, kind: 'file' }, false)
}

/**
 * Resolve one extracted path against workspace folders (no content read).
 * Relative: preferred folder first, then folders in order; 0 → not-found, >1 → ambiguous-root.
 * Absolute: must lie under exactly one workspace folder; else outside-workspace / ambiguous-root.
 * @param rawPath - path payload from an `@` token.
 * @param options - workspace roots + existence probe.
 */
export function resolveAtPathInWorkspace(rawPath: string, options: ResolveAtPathOptions): AtPathResolve {
  const exists = options.exists ?? existsSync
  const folders = options.workspaceFolders.map(folder => resolve(folder))
  if (folders.length === 0) {
    return { ok: false, raw: rawPath, reason: 'not-found' }
  }

  const preferred = options.preferredFolder === undefined
    ? undefined
    : resolve(options.preferredFolder)

  if (isAbsolute(rawPath)) {
    const abs = resolve(rawPath)
    const owners = folders.filter(folder => isPathInside(abs, folder))
    if (owners.length === 0) {
      return { ok: false, raw: rawPath, reason: 'outside-workspace' }
    }
    if (owners.length > 1) {
      return { ok: false, raw: rawPath, reason: 'ambiguous-root' }
    }
    const owner = owners[0]!
    if (!exists(abs)) {
      return { ok: false, raw: rawPath, reason: 'not-found' }
    }
    return { ok: true, path: toPosixRelative(owner, abs), abs }
  }

  const candidates: Array<{ folder: string; abs: string }> = []
  const tryFolder = (folder: string): void => {
    const abs = resolve(join(folder, rawPath))
    if (!isPathInside(abs, folder)) return
    if (!exists(abs)) return
    if (candidates.some(row => row.abs === abs)) return
    candidates.push({ folder, abs })
  }

  if (preferred !== undefined && folders.some(folder => folder === preferred)) {
    tryFolder(preferred)
  }
  if (candidates.length === 0) {
    for (const folder of folders) tryFolder(folder)
  } else if (candidates.length === 1) {
    // Preferred unique hit wins even if other roots also contain the same relative path.
    const hit = candidates[0]!
    return { ok: true, path: toPosixRelative(hit.folder, hit.abs), abs: hit.abs }
  }

  if (candidates.length === 0) {
    return { ok: false, raw: rawPath, reason: 'not-found' }
  }
  if (candidates.length > 1) {
    return { ok: false, raw: rawPath, reason: 'ambiguous-root' }
  }
  const only = candidates[0]!
  return { ok: true, path: toPosixRelative(only.folder, only.abs), abs: only.abs }
}

/**
 * Validate every `@` token in composer text. First failure wins.
 * Does not read file contents (AD-CCD-11).
 * @param text - composer text.
 * @param options - workspace resolve options.
 */
export function validateComposerAtPaths(
  text: string,
  options: ResolveAtPathOptions,
): { ok: true; paths: string[] } | { ok: false; raw: string; reason: AtPathRejectReason } {
  const tokens = extractAtPathTokens(text)
  if (tokens.length === 0) return { ok: true, paths: [] }
  const resolved: string[] = []
  const seen = new Set<string>()
  for (const token of tokens) {
    const result = resolveAtPathInWorkspace(token.path, options)
    if (!result.ok) return result
    const key = normalizePathKey(result.path)
    if (!seen.has(key)) {
      seen.add(key)
      resolved.push(result.path)
    }
  }
  return { ok: true, paths: resolved }
}

/**
 * Normalize a path key for dedupe / coverage compare (POSIX-ish, no leading `./`).
 * @param pathValue - relative or absolute path string.
 */
export function normalizePathKey(pathValue: string): string {
  return normalize(pathValue).replace(/\\/g, '/').replace(/^\.\//u, '')
}

function isPathInside(absPath: string, folder: string): boolean {
  const rel = relative(folder, absPath)
  if (rel === '') return true
  return !rel.startsWith(`..${sep}`) && !rel.startsWith('../') && rel !== '..' && !isAbsolute(rel)
}

function toPosixRelative(folder: string, absPath: string): string {
  return normalizePathKey(relative(folder, absPath))
}
