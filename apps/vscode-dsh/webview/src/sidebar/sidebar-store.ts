/**
 * History sidebar view state (feature: sidebar-history).
 * The Host owns the rows; this store only projects the frames it pushes.
 * @module @deepseek-ai/dsh-vscode-dsh-webview/sidebar/sidebar-store
 */

/** One history row as the Host reports it. */
export interface SidebarRow {
  sessionId: string
  title: string
  /** Recorded modification time, already formatted by the Host. */
  when: string
  /** First user text when the index recorded one, '' otherwise. */
  preview: string
  /** Continue affordance hint; '' when the row offers no Continue. */
  continueHint: string
  /** Parent session title, present only for forked sessions. */
  parentTitle?: string
}

/** Sidebar surface state. */
export interface SidebarState {
  /** True until the first `sidebar/rows` frame arrives. */
  loading: boolean
  rows: SidebarRow[]
}

type SidebarListener = () => void

let state: SidebarState = { loading: true, rows: [] }
const listeners = new Set<SidebarListener>()

/**
 * Read the current sidebar state.
 * @returns the live state object.
 */
export function getSidebarState(): SidebarState {
  return state
}

/**
 * Subscribe to sidebar state changes.
 * @param listener - called after every applied frame.
 * @returns unsubscribe handle.
 */
export function subscribeSidebar(listener: SidebarListener): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

/** Drop rows the view cannot render: a missing id or title leaves nothing to show. */
function mapRows(raw: unknown): SidebarRow[] {
  if (!Array.isArray(raw)) return []
  const rows: SidebarRow[] = []
  for (const entry of raw) {
    if (typeof entry !== 'object' || entry === null) continue
    const record = entry as Record<string, unknown>
    if (typeof record.sessionId !== 'string' || record.sessionId === '') continue
    rows.push({
      sessionId: record.sessionId,
      title: typeof record.title === 'string' && record.title !== ''
        ? record.title
        : record.sessionId.slice(0, 8),
      when: typeof record.when === 'string' ? record.when : '',
      preview: typeof record.preview === 'string' ? record.preview : '',
      continueHint: typeof record.continueHint === 'string' ? record.continueHint : '',
      ...typeof record.parentTitle === 'string' && record.parentTitle !== ''
        ? { parentTitle: record.parentTitle }
        : {},
    })
  }
  return rows
}

/**
 * Apply one Host frame.
 * @param raw - frame posted by the sidebar Host.
 */
export function applySidebarFrame(raw: unknown): void {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return
  const frame = raw as Record<string, unknown>
  if (frame.type !== 'sidebar/rows') return
  state = { loading: false, rows: mapRows(frame.rows) }
  for (const listener of listeners) listener()
}

/** Reset the store to its pre-frame state (tests). */
export function resetSidebarState(): void {
  state = { loading: true, rows: [] }
}
