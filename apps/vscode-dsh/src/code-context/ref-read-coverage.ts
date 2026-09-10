/**
 * AC-3a / AD-CCD-14 covering-path predicate for read-tool calls.
 *
 * **Stub ≠ true-model runtime guarantee:** `assertEveryRefReadBeforeFinalAnswer`
 * and related helpers are L2 product-contract stubs for fixture-driven coverage.
 * Passing those assertions does **not** guarantee a live model will always call
 * `read` before its final answer — only that the covering-path rule behaves as
 * specified when fed a session-log sample.
 *
 * P2-A (tool-fs): the ide `read` tool schema primary field is `file_path`
 * (snake_case). Also accepts design-listed aliases `path` / `file` / `target`.
 *
 * AD-CCD-15: this Feature accepts whole-file `read` (offset/limit optional);
 * do not regress to inlining selection bodies into the user message.
 *
 * @module @deepseek-ai/dsh-vscode-dsh/code-context/ref-read-coverage
 */

import { extractAtPaths, normalizePathKey } from './at-path.ts'

/** Minimal session-log event shape used by L2 coverage stubs. */
export interface CoverageLogEvent {
  /** Session event type (e.g. `tool/call`, `assistant/message`). */
  type: string
  /** Tool name when type is a tool call. */
  name?: string
  /** Structured tool arguments (or recoverable meta). */
  args?: unknown
}

/** Result of the every-path coverage assertion. */
export type RefReadCoverageResult =
  | { ok: true; paths: string[]; finalAssistantIndex: number }
  | { ok: false; missing: string[]; paths: string[]; finalAssistantIndex: number }

/**
 * Extract workspace path strings from a read-tool argument sample (AD-CCD-14).
 * Primary field: `file_path` (tool-fs). Aliases: `path`, `file`, `target`.
 * Directory / glob values are returned as-is; callers decide containment.
 * @param args - tool call arguments object / JSON-like sample.
 */
export function pathsFromReadToolArgs(args: unknown): string[] {
  if (typeof args !== 'object' || args === null || Array.isArray(args)) return []
  const record = args as Record<string, unknown>
  const keys = ['file_path', 'path', 'file', 'target'] as const
  const out: string[] = []
  for (const key of keys) {
    const value = record[key]
    if (typeof value === 'string' && value.trim() !== '') {
      out.push(value.trim())
    }
  }
  return out
}

/**
 * Whether a read-tool path set covers a user reference path (normalized equality).
 * Directory / glob: only prefix-directory when `allowDirectoryPrefix` is true and
 * the arg ends with `/` or equals a parent segment; default false (stub prefers
 * exact single-file paths — AD-CCD-14 §4).
 * @param readPaths - paths extracted from one tool call.
 * @param referencePath - normalized user reference path.
 * @param options - optional directory-prefix rule.
 */
export function readArgsCoverPath(
  readPaths: readonly string[],
  referencePath: string,
  options: { allowDirectoryPrefix?: boolean } = {},
): boolean {
  const target = normalizePathKey(referencePath)
  for (const raw of readPaths) {
    const candidate = normalizePathKey(raw)
    if (candidate === target) return true
    if (options.allowDirectoryPrefix === true) {
      const dir = candidate.endsWith('/') ? candidate.slice(0, -1) : candidate
      if (target === dir || target.startsWith(`${dir}/`)) return true
    }
  }
  return false
}

/**
 * Index of the turn's final `assistant/message` (N-2 anchor). Last match wins.
 * @param events - ordered session log events for one turn window.
 */
export function indexOfFinalAssistantMessage(events: readonly CoverageLogEvent[]): number {
  let index = -1
  for (let i = 0; i < events.length; i++) {
    if (events[i]?.type === 'assistant/message') index = i
  }
  return index
}

/**
 * Assert every deduped `@` path in `userText` is covered by ≥1 read-tool call
 * whose args map to that path, all before the final assistant/message (AC-3a).
 * @param events - turn session events (tool/call + assistant/message).
 * @param userText - authoritative user message text (pointer-only).
 * @param options - tool name + path extract overrides.
 */
export function assertEveryRefReadBeforeFinalAnswer(
  events: readonly CoverageLogEvent[],
  userText: string,
  options: {
    /** Tool names treated as reads (default `read`). */
    readToolNames?: readonly string[]
    /**
     * Optional path list override (already gate-validated). When omitted,
     * paths are extracted from `userText` via official `@` grammar.
     */
    referencePaths?: readonly string[]
  } = {},
): RefReadCoverageResult {
  const readNames = new Set(
    (options.readToolNames ?? ['read']).map(name => name.toLowerCase()),
  )
  const paths = (options.referencePaths ?? extractAtPaths(userText)).map(normalizePathKey)
  const deduped: string[] = []
  const seen = new Set<string>()
  for (const path of paths) {
    if (seen.has(path)) continue
    seen.add(path)
    deduped.push(path)
  }
  const finalAssistantIndex = indexOfFinalAssistantMessage(events)
  if (deduped.length === 0) {
    return { ok: true, paths: deduped, finalAssistantIndex }
  }
  if (finalAssistantIndex < 0) {
    return { ok: false, missing: [...deduped], paths: deduped, finalAssistantIndex }
  }

  const covered = new Set<string>()
  for (let i = 0; i < finalAssistantIndex; i++) {
    const event = events[i]
    if (event === undefined) continue
    if (event.type !== 'tool/call' && event.type !== 'tool_call') continue
    const name = (event.name ?? '').toLowerCase()
    if (!readNames.has(name)) continue
    const readPaths = pathsFromReadToolArgs(event.args)
    for (const path of deduped) {
      if (covered.has(path)) continue
      if (readArgsCoverPath(readPaths, path)) covered.add(path)
    }
  }

  const missing = deduped.filter(path => !covered.has(path))
  if (missing.length > 0) {
    return { ok: false, missing, paths: deduped, finalAssistantIndex }
  }
  return { ok: true, paths: deduped, finalAssistantIndex }
}
