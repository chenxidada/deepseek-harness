/**
 * Restart restore planner: strip empty Tabs, active-first UI set of size N (AD-CU-3/10).
 * @module @deepseek-ai/dsh-vscode-dsh/restore-planner
 */

import type { OpenTabRecord } from './extension-index.ts'

/** One restore selection outcome. */
export interface RestorePlan {
  /** Non-empty Tabs remaining in the durable index (order preserved). */
  indexSet: OpenTabRecord[]
  /** Tabs to hydrate into the UI now (≤ N; active forced first). */
  uiSet: OpenTabRecord[]
  /** Index Tabs not yet hydrated (「查看更多」). */
  deferred: OpenTabRecord[]
  /** Empty / corrupt rows stripped from the index write-back. */
  stripped: OpenTabRecord[]
}

/**
 * Whether a restored Tab is considered empty (no messages / never sent).
 * Callers supply content proof from hydrate or a preloaded event count.
 * @param hasMessages - true when the session projects at least one message.
 */
export function isEmptyRestoredTab(hasMessages: boolean): boolean {
  return !hasMessages
}

/**
 * Plan which openTabSet rows enter the UI (AC-33/34/70).
 * Always forces `mode=replay` on every returned record (even if stored live / liveIntent).
 * @param openTabSet - persisted open Tabs (may include empties / live modes).
 * @param activeSessionId - last active session to force into the UI set.
 * @param limit - UI hydrate cap N (default 8).
 * @param hasContent - content probe per sessionId (false → strip).
 * @returns index/UI/deferred/stripped partitions.
 */
export function planRestoreOpenTabs(
  openTabSet: readonly OpenTabRecord[],
  activeSessionId: string | undefined,
  limit: number,
  hasContent: (sessionId: string) => boolean,
): RestorePlan {
  const stripped: OpenTabRecord[] = []
  const indexSet: OpenTabRecord[] = []
  for (const tab of openTabSet) {
    if (
      typeof tab.tabId !== 'string'
      || tab.tabId === ''
      || typeof tab.sessionId !== 'string'
      || tab.sessionId === ''
      || (tab.mode !== 'live' && tab.mode !== 'replay')
    ) {
      stripped.push(tab)
      continue
    }
    if (!hasContent(tab.sessionId)) {
      stripped.push(tab)
      continue
    }
    // Recovery always presents replay (AC-33); preserve liveIntent for Continue UX.
    indexSet.push({
      ...tab,
      mode: 'replay',
      ...tab.mode === 'live' || tab.liveIntent === true ? { liveIntent: true } : {},
    })
  }

  const n = Number.isFinite(limit) && limit > 0 ? Math.floor(limit) : 8
  const uiSet: OpenTabRecord[] = []
  const used = new Set<string>()

  const active = activeSessionId === undefined
    ? undefined
    : indexSet.find(tab => tab.sessionId === activeSessionId)
  if (active !== undefined) {
    uiSet.push(active)
    used.add(active.sessionId)
  }

  for (const tab of indexSet) {
    if (uiSet.length >= n) break
    if (used.has(tab.sessionId)) continue
    uiSet.push(tab)
    used.add(tab.sessionId)
  }

  const deferred = indexSet.filter(tab => !used.has(tab.sessionId))
  return { indexSet, uiSet, deferred, stripped }
}
