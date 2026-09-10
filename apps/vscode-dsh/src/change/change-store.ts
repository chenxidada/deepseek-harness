/**
 * In-memory ChangeRecord index (metadata only; blobs live in SnapshotStore).
 * @module @deepseek-ai/dsh-vscode-dsh/change/change-store
 */

import type { ChangeListPayload, ChangeRecord } from './types.ts'

/**
 * Session-scoped change index for live projection and L2 hooks.
 */
export class ChangeStore {
  private readonly bySession = new Map<string, ChangeRecord[]>()
  private readonly listeners = new Set<() => void>()

  /**
   * Upsert a record keyed by sessionId + turn + path (AD-CCD-5 merge result).
   * @param record - change record.
   */
  upsert(record: ChangeRecord): void {
    const list = this.bySession.get(record.sessionId) ?? []
    const idx = list.findIndex(
      r => r.turn === record.turn && r.path === record.path,
    )
    if (idx === -1) list.push({ ...record })
    else list[idx] = { ...record }
    this.bySession.set(record.sessionId, list)
    this.emit()
  }

  /**
   * All records for a session.
   * @param sessionId - SDK session id.
   */
  list(sessionId: string): readonly ChangeRecord[] {
    return (this.bySession.get(sessionId) ?? []).map(r => ({ ...r }))
  }

  /**
   * Records for one top-level turn.
   * @param sessionId - session id.
   * @param turn - turn number.
   */
  listForTurn(sessionId: string, turn: number): readonly ChangeRecord[] {
    return this.list(sessionId).filter(r => r.turn === turn)
  }

  /**
   * Lookup by changeId across sessions.
   * @param changeId - record id.
   */
  getById(changeId: string): ChangeRecord | undefined {
    for (const list of this.bySession.values()) {
      const hit = list.find(r => r.changeId === changeId)
      if (hit !== undefined) return { ...hit }
    }
    return undefined
  }

  /**
   * Build a message-attached ChangeListPayload for one turn.
   * @param sessionId - session id.
   * @param turn - turn number.
   * @param sourceMessageId - last assistant id for the turn (N-2).
   */
  toListPayload(sessionId: string, turn: number, sourceMessageId: string): ChangeListPayload {
    const changes = this.listForTurn(sessionId, turn).map(r => ({
      changeId: r.changeId,
      path: r.path,
      kind: r.kind,
      status: r.status,
      additions: r.additions,
      deletions: r.deletions,
      ...r.snapshotRef === undefined ? {} : { snapshotRef: r.snapshotRef },
    }))
    return {
      turn,
      sourceMessageId,
      changes,
      emptyNotice: changes.length === 0,
    }
  }

  /**
   * Drop all records for a session.
   * @param sessionId - session to clear.
   */
  clearSession(sessionId: string): void {
    this.bySession.delete(sessionId)
    this.emit()
  }

  /** Clear every session. */
  clear(): void {
    this.bySession.clear()
    this.emit()
  }

  /**
   * Subscribe to mutations.
   * @param listener - callback.
   */
  onChange(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  private emit(): void {
    for (const listener of this.listeners) listener()
  }
}
