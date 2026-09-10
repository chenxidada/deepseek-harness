/**
 * ChangeList domain types (AD-CCD / design.md ChangeRecord model).
 * @module @deepseek-ai/dsh-vscode-dsh/change/types
 */

/** File-level change classification. */
export type ChangeKind = 'created' | 'modified' | 'deleted'

/** Review lifecycle status (phase-2 displays unreviewed; mark-reviewed is phase-3). */
export type ChangeStatus = 'unreviewed' | 'reviewed' | 'reverted'

/** One attributed file change for a top-level turn. */
export interface ChangeRecord {
  changeId: string
  sessionId: string
  turn: number
  sourceMessageId: string
  path: string
  kind: ChangeKind
  status: ChangeStatus
  additions: number
  deletions: number
  createdAt: number
  updatedAt: number
  snapshotRef?: string
  afterContentHash: string
}

/** Full-file snapshot blob (extension-local only; never authority logs). */
export interface ChangeSnapshot {
  snapshotRef: string
  path: string
  oldText: string | null
  newText: string
}

/** Lightweight message-attached list payload (no full old/new bodies). */
export interface ChangeListPayload {
  turn: number
  sourceMessageId: string
  changes: ReadonlyArray<Pick<ChangeRecord,
    'changeId' | 'path' | 'kind' | 'status' | 'additions' | 'deletions' | 'snapshotRef'>>
  emptyNotice: boolean
}

/** Recoverable attribution candidate from meta.diffs (signal only). */
export interface AttributionHunk {
  path: string
  oldText: string | null
  newText: string
}
