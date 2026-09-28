/**
 * Workspace history list model for the sidebar view (AC-28/29/63/62).
 * Independent of Host connection for listing; open still requires hydrate.
 * @module @deepseek-ai/dsh-vscode-dsh/history-view
 */

import {
  continueCapabilityListHint,
  type ExtensionIndex,
  type HistoryListRow,
} from './extension-index.ts'

/** One history row as the sidebar renders it. */
export interface HistorySidebarRow {
  sessionId: string
  title: string
  /** Recorded modification time in local time, minute precision. */
  when: string
  /** First user text when the index recorded one, '' otherwise. */
  preview: string
  /** Continue affordance hint; '' when the row offers no Continue. */
  continueHint: string
  /** Parent session title, present only for forked sessions. */
  parentTitle?: string
}

/**
 * Project index rows into sidebar rows.
 * @param rows - history list from {@link ExtensionIndex.listHistorySessions}.
 * @returns one row per session, list order preserved.
 */
export function historySidebarRows(rows: readonly HistoryListRow[]): HistorySidebarRow[] {
  return rows.map(row => ({
    sessionId: row.sessionId,
    title: row.title,
    when: formatHistoryWhen(row.mtime),
    preview: row.firstUserPreview ?? '',
    continueHint: row.continueHint,
    ...row.parentTitle === undefined || row.parentTitle === ''
      ? {}
      : { parentTitle: row.parentTitle },
  }))
}

/**
 * List history rows from an index (Host-independent — AC-63).
 * @param index - workspace extension index.
 */
export function listHistoryFromIndex(index: ExtensionIndex): HistoryListRow[] {
  return index.listHistorySessions()
}

/**
 * Merge runtime-listed sessions into the workspace index's history rows (AC-28).
 * An index row wins on a shared id: it carries this Extension's tombstones, fork
 * lineage, and continue capability, which a runtime listing cannot know.
 * @param indexRows - rows from {@link ExtensionIndex.listHistorySessions}.
 * @param hostRows - rows the runtime listed for this workspace.
 * @returns one row per session, newest recorded time first.
 */
export function mergeHistoryRows(
  indexRows: readonly HistoryListRow[],
  hostRows: readonly HistoryListRow[],
): HistoryListRow[] {
  const known = new Set(indexRows.map(row => row.sessionId))
  return [...indexRows, ...hostRows.filter(row => !known.has(row.sessionId))]
    .sort((left, right) => right.mtime - left.mtime)
}

/**
 * Project one runtime-listed session into a History row.
 * A listing reports creation time and, at best, a cached title, so the row has no
 * continue capability and no first-user preview until the session is opened.
 * @param row - runtime session row belonging to this workspace.
 */
export function hostSessionHistoryRow(row: {
  sessionId: string
  createdAt: number
  title?: string
}): HistoryListRow {
  return {
    sessionId: row.sessionId,
    title: row.title ?? `Replay ${row.sessionId.slice(0, 8)}`,
    mtime: row.createdAt,
    continueCapability: 'unknown',
    continueHint: '',
  }
}

/**
 * Re-export AD-CU-8 list hint helper for tests.
 */
export { continueCapabilityListHint }

function formatHistoryWhen(mtime: number): string {
  const at = new Date(mtime)
  const pad = (value: number): string => String(value).padStart(2, '0')
  return `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())}`
    + ` ${pad(at.getHours())}:${pad(at.getMinutes())}`
}
