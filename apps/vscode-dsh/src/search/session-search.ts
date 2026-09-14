/**
 * Session search tiers 1 + 2 (AD-CUX-9 / AC-50–53).
 * Tier 1: ExtensionIndex title + firstUserPreview only.
 * Tier 2: PathSessionIndex path→session reverse lookup.
 * Explicitly no tier-3 / JSONL body scan API.
 * @module @deepseek-ai/dsh-vscode-dsh/search/session-search
 */

import type { ExtensionIndex, HistoryListRow } from '../extension-index.ts'
import type { PathSessionIndex } from './path-session-index.ts'

/** Which tier produced a hit. */
export type SearchMatchTier = 1 | 2

/** Which index field matched for tier-1 hits (proves no body scan). */
export type Tier1MatchField = 'title' | 'firstUserPreview'

/** Search query — tier 1 text and/or tier 2 path (never body). */
export interface SearchQuery {
  /** Substring against title / firstUserPreview (tier 1). */
  text?: string
  /** Path fragment against Change-derived reverse index (tier 2). */
  path?: string
}

/** One search hit (metadata only). */
export interface SearchHit {
  sessionId: string
  title: string
  mtime: number
  matchTiers: SearchMatchTier[]
  /** Present when tier 1 matched. */
  matchField?: Tier1MatchField
  firstUserPreview?: string
  /** Present when tier 2 matched. */
  matchedPath?: string
}

/**
 * Run tier-1 and/or tier-2 search over index metadata.
 * Never reads MessageStore, authority JSONL, or Change snapshot blobs.
 * @param extensionIndex - session metadata index.
 * @param pathIndex - path→session reverse index.
 * @param query - text and/or path fragments.
 */
export function searchSessions(
  extensionIndex: ExtensionIndex,
  pathIndex: PathSessionIndex,
  query: SearchQuery,
): SearchHit[] {
  const text = query.text?.trim() ?? ''
  const path = query.path?.trim() ?? ''
  if (text === '' && path === '') return []

  const bySession = new Map<string, SearchHit>()
  const history = extensionIndex.listHistorySessions()
  const historyById = new Map(history.map(row => [row.sessionId, row]))

  if (text !== '') {
    for (const row of history) {
      const matchField = matchTier1Field(row, text)
      if (matchField === undefined) continue
      bySession.set(row.sessionId, {
        sessionId: row.sessionId,
        title: row.title,
        mtime: row.mtime,
        matchTiers: [1],
        matchField,
        ...row.firstUserPreview === undefined ? {} : { firstUserPreview: row.firstUserPreview },
      })
    }
  }

  if (path !== '') {
    for (const entry of pathIndex.queryByPath(path)) {
      for (const sessionId of entry.sessionIds) {
        if (extensionIndex.isDeleted(sessionId)) continue
        const row = historyById.get(sessionId)
        // Tombstoned / ineligible sessions stay out of history; still allow path hits
        // when the session remains in the extension index as a non-deleted row.
        const indexRow = extensionIndex.read().sessions.find(
          s => s.sessionId === sessionId && s.deleted !== true,
        )
        if (indexRow === undefined) continue
        const title = row?.title ?? indexRow.title
        const mtime = Math.max(row?.mtime ?? 0, indexRow.mtime, entry.mtime)
        const existing = bySession.get(sessionId)
        if (existing !== undefined) {
          if (!existing.matchTiers.includes(2)) existing.matchTiers.push(2)
          existing.matchedPath = entry.path
          existing.mtime = Math.max(existing.mtime, mtime)
          continue
        }
        bySession.set(sessionId, {
          sessionId,
          title,
          mtime,
          matchTiers: [2],
          matchedPath: entry.path,
          ...((row?.firstUserPreview ?? indexRow.firstUserPreview) === undefined
            ? {}
            : { firstUserPreview: row?.firstUserPreview ?? indexRow.firstUserPreview }),
        })
      }
    }
  }

  return [...bySession.values()].sort((a, b) => b.mtime - a.mtime)
}

/**
 * Match title / firstUserPreview only (case-insensitive substring).
 * @param row - history list row.
 * @param text - query text.
 */
export function matchTier1Field(
  row: Pick<HistoryListRow, 'title' | 'firstUserPreview'>,
  text: string,
): Tier1MatchField | undefined {
  const needle = text.trim().toLowerCase()
  if (needle === '') return undefined
  if (row.title.toLowerCase().includes(needle)) return 'title'
  if (
    row.firstUserPreview !== undefined
    && row.firstUserPreview.toLowerCase().includes(needle)
  ) {
    return 'firstUserPreview'
  }
  return undefined
}

/**
 * Intentionally absent: there is no tier-3 / full-text body search surface.
 * Kept as a named export so Layer B can assert the product does not expose it.
 */
export const TIER3_FULL_TEXT_SEARCH_API = null
