/**
 * Extension-owned workspace index: open Tab set + session metadata (AD-CU-4).
 * Immediately persists to workspaceState on every mutation — never message bodies.
 * @module @deepseek-ai/dsh-vscode-dsh/extension-index
 */

/** Tab mode projected into the open-tab index / panel. */
export type OpenTabMode = 'live' | 'replay'

/** One open Tab record eligible for persistence (non-empty only). */
export interface OpenTabRecord {
  /** Tab identity (destroyed on close; reopen mints a new id). */
  tabId: string
  /** SDK session identity. */
  sessionId: string
  /** Projection mode for this open Tab. */
  mode: OpenTabMode
  /** Optional display title. */
  title?: string
  /** Optional: was live before last close; restore still presents replay. */
  liveIntent?: boolean
}

/** Session list entry — metadata only, never chat bodies (AC-45/46). */
export interface SessionIndexEntry {
  sessionId: string
  title: string
  mtime: number
  continueCapability?: 'same-id' | 'derive-only' | 'unknown'
  firstUserPreview?: string
  parentSessionId?: string
  deleted?: boolean
}

/** Durable index snapshot written to workspaceState. */
export interface ExtensionIndexSnapshot {
  workspaceKey: string
  sessions: SessionIndexEntry[]
  openTabSet: OpenTabRecord[]
  activeSessionId?: string
  ui: { restoreUiLimit: number }
}

/** Duck-typed VS Code Memento used for immediate index writes. */
export interface WorkspaceStateLike {
  get<T>(key: string): T | undefined
  update(key: string, value: unknown): Promise<void> | void
}

/** Storage key for the conversation UI index in workspaceState. */
export const EXTENSION_INDEX_STATE_KEY = 'dsh.conversationIndex'

const DEFAULT_RESTORE_UI_LIMIT = 8

/**
 * In-memory + workspaceState index. Empty Tabs never enter persisted openTabSet.
 */
export class ExtensionIndex {
  private snapshot: ExtensionIndexSnapshot
  private writeCount = 0

  /**
   * @param workspaceKey - current workspace identity (folder path or synthetic).
   * @param state - optional workspaceState Memento; when omitted, writes stay in-memory only.
   */
  constructor(
    workspaceKey = '',
    private readonly state?: WorkspaceStateLike,
  ) {
    const loaded = this.state?.get<ExtensionIndexSnapshot>(EXTENSION_INDEX_STATE_KEY)
    this.snapshot = loaded === undefined
      ? emptySnapshot(workspaceKey)
      : sanitizeLoaded(loaded, workspaceKey)
  }

  /**
   * Current index snapshot (copy).
   * @returns durable fields excluding message bodies.
   */
  read(): ExtensionIndexSnapshot {
    return cloneSnapshot(this.snapshot)
  }

  /**
   * How many immediate persist calls have completed (tests / L2 probes).
   * @returns monotonic write counter.
   */
  getWriteCount(): number {
    return this.writeCount
  }

  /**
   * Replace openTabSet / activeSessionId from live registry state and persist immediately.
   * Empty Tabs (no messages / never successfully sent) are excluded from openTabSet.
   * @param tabs - open Tab records that have content.
   * @param activeSessionId - active session, if any.
   */
  setOpenTabs(tabs: readonly OpenTabRecord[], activeSessionId: string | undefined): void {
    const openTabSet = tabs
      .filter(tab => tab.tabId !== '' && tab.sessionId !== '')
      .map(tab => ({ ...tab }))
    const next: ExtensionIndexSnapshot = {
      workspaceKey: this.snapshot.workspaceKey,
      sessions: this.snapshot.sessions,
      openTabSet,
      ui: this.snapshot.ui,
    }
    if (activeSessionId !== undefined) next.activeSessionId = activeSessionId
    this.snapshot = next
    this.writeImmediate()
  }

  /**
   * Upsert session metadata (title / preview) without storing message bodies.
   * @param entry - session index row.
   */
  upsertSession(entry: SessionIndexEntry): void {
    const sessions = [...this.snapshot.sessions]
    const index = sessions.findIndex(row => row.sessionId === entry.sessionId)
    if (index >= 0) sessions[index] = { ...entry }
    else sessions.push({ ...entry })
    this.snapshot = { ...this.snapshot, sessions }
    this.writeImmediate()
  }

  /**
   * Mark a session deleted in the index (tombstone). Does not cascade to children (AC-61).
   * @param sessionId - session to tombstone.
   */
  markDeleted(sessionId: string): void {
    const sessions = this.snapshot.sessions.map(row =>
      row.sessionId === sessionId ? { ...row, deleted: true } : row,
    )
    const openTabSet = this.snapshot.openTabSet.filter(tab => tab.sessionId !== sessionId)
    const next: ExtensionIndexSnapshot = {
      workspaceKey: this.snapshot.workspaceKey,
      sessions,
      openTabSet,
      ui: this.snapshot.ui,
    }
    if (this.snapshot.activeSessionId !== undefined && this.snapshot.activeSessionId !== sessionId) {
      next.activeSessionId = this.snapshot.activeSessionId
    }
    this.snapshot = next
    this.writeImmediate()
  }

  /**
   * Whether a session is tombstoned as deleted.
   * @param sessionId - session identity.
   */
  isDeleted(sessionId: string): boolean {
    return this.snapshot.sessions.some(row => row.sessionId === sessionId && row.deleted === true)
  }

  /**
   * Persist the current snapshot to workspaceState immediately (AD-CU-4).
   */
  writeImmediate(): void {
    this.writeCount += 1
    const payload = cloneSnapshot(this.snapshot)
    void this.state?.update(EXTENSION_INDEX_STATE_KEY, payload)
  }
}

function emptySnapshot(workspaceKey: string): ExtensionIndexSnapshot {
  return {
    workspaceKey,
    sessions: [],
    openTabSet: [],
    ui: { restoreUiLimit: DEFAULT_RESTORE_UI_LIMIT },
  }
}

function sanitizeLoaded(loaded: ExtensionIndexSnapshot, workspaceKey: string): ExtensionIndexSnapshot {
  const openTabSet = Array.isArray(loaded.openTabSet)
    ? loaded.openTabSet.filter(tab =>
      typeof tab?.tabId === 'string'
      && typeof tab.sessionId === 'string'
      && (tab.mode === 'live' || tab.mode === 'replay'))
    : []
  // Recovery rule: drop empty-looking records that somehow landed in storage (AD-CU-3).
  return {
    workspaceKey: typeof loaded.workspaceKey === 'string' ? loaded.workspaceKey : workspaceKey,
    sessions: Array.isArray(loaded.sessions) ? loaded.sessions.map(row => ({ ...row })) : [],
    openTabSet: openTabSet.map(tab => ({ ...tab })),
    ...typeof loaded.activeSessionId === 'string' ? { activeSessionId: loaded.activeSessionId } : {},
    ui: {
      restoreUiLimit: loaded.ui?.restoreUiLimit ?? DEFAULT_RESTORE_UI_LIMIT,
    },
  }
}

function cloneSnapshot(snapshot: ExtensionIndexSnapshot): ExtensionIndexSnapshot {
  return {
    workspaceKey: snapshot.workspaceKey,
    sessions: snapshot.sessions.map(row => ({ ...row })),
    openTabSet: snapshot.openTabSet.map(tab => ({ ...tab })),
    ...snapshot.activeSessionId === undefined ? {} : { activeSessionId: snapshot.activeSessionId },
    ui: { ...snapshot.ui },
  }
}
