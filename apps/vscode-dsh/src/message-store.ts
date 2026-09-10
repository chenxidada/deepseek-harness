/**
 * Per-session chat message projection for the Conversation panel (AD-CU-1).
 * Projection only — not a second authority message database (AC-45/46).
 * @module @deepseek-ai/dsh-vscode-dsh/message-store
 */

import type { ChangeListPayload } from './change/types.ts'

/** One projected chat bubble for the Conversation Webview. */
export interface ChatMessage {
  /** Stable message id within the session projection. */
  id: string
  /** SDK session identity. */
  sessionId: string
  /** Speaker role. */
  role: 'user' | 'assistant' | 'notice'
  /** MVP content kind (text primary). */
  kind: 'text' | 'subagent' | 'diff-summary' | 'notice' | 'change-list'
  /** Full readable text (user prompt or complete assistant turn). */
  text: string
  /** Optional turn index when known. */
  turn?: number
  /** True when the turn ended incomplete / interrupted. */
  incomplete?: boolean
  /**
   * Lightweight change-list payload (AC-6 / AC-12).
   * Must not embed full old/new snapshot plaintext.
   */
  changeList?: ChangeListPayload
  /**
   * Assistant anchor id for AC-30 diff-summary → reveal corresponding change-list.
   * Also mirrored on `changeList.sourceMessageId` for list bubbles.
   */
  sourceMessageId?: string
}

/**
 * Session-scoped message buffers for live / replay panel projection.
 * Pure store — no VS Code dependency.
 */
export class MessageStore {
  private readonly messages = new Map<string, ChatMessage[]>()
  private readonly listeners = new Set<() => void>()

  /**
   * Replace the full message list for a session (Tab switch / hydrate).
   * @param sessionId - SDK session identity.
   * @param next - complete message list (copied).
   */
  replace(sessionId: string, next: readonly ChatMessage[]): void {
    this.messages.set(sessionId, next.map(copyMessage))
    this.emit()
  }

  /**
   * Append one complete message (not a token/patch fragment).
   * @param sessionId - SDK session identity.
   * @param message - complete chat message.
   */
  append(sessionId: string, message: ChatMessage): void {
    const list = this.messages.get(sessionId)
    const copy = copyMessage(message)
    if (list === undefined) this.messages.set(sessionId, [copy])
    else list.push(copy)
    this.emit()
  }

  /**
   * Remove messages matching a predicate (e.g. replace change-list for same turn).
   * @param sessionId - SDK session identity.
   * @param predicate - return true to drop.
   */
  removeWhere(sessionId: string, predicate: (message: ChatMessage) => boolean): void {
    const list = this.messages.get(sessionId)
    if (list === undefined) return
    const next = list.filter(m => !predicate(m))
    if (next.length === list.length) return
    this.messages.set(sessionId, next)
    this.emit()
  }

  /**
   * Patch a ChangeRecord status inside every change-list payload (AC-11 / AC-13).
   * @param sessionId - SDK session identity.
   * @param changeId - ChangeRecord id.
   * @param status - new status.
   * @returns true when at least one row was patched.
   */
  patchChangeStatus(
    sessionId: string,
    changeId: string,
    status: NonNullable<ChatMessage['changeList']>['changes'][number]['status'],
  ): boolean {
    const list = this.messages.get(sessionId)
    if (list === undefined) return false
    let patched = false
    for (const message of list) {
      if (message.kind !== 'change-list' || message.changeList === undefined) continue
      const changes = message.changeList.changes
      const idx = changes.findIndex(c => c.changeId === changeId)
      if (idx === -1) continue
      const nextChanges = changes.map((c, i) => i === idx ? { ...c, status } : { ...c })
      message.changeList = { ...message.changeList, changes: nextChanges }
      patched = true
    }
    if (patched) this.emit()
    return patched
  }

  /**
   * Messages recorded for one session.
   * @param sessionId - SDK session identity.
   * @returns copies in append order.
   */
  get(sessionId: string): readonly ChatMessage[] {
    return (this.messages.get(sessionId) ?? []).map(copyMessage)
  }

  /**
   * Whether the session has any projected messages (empty-Tab rule).
   * @param sessionId - SDK session identity.
   */
  hasContent(sessionId: string): boolean {
    return (this.messages.get(sessionId)?.length ?? 0) > 0
  }

  /**
   * Drop buffers for one session (delete / unload projection).
   * @param sessionId - session to clear.
   */
  clearSession(sessionId: string): void {
    this.messages.delete(sessionId)
    this.emit()
  }

  /** Clear every buffer (window shutdown). */
  clear(): void {
    this.messages.clear()
    this.emit()
  }

  /**
   * Subscribe to store mutations.
   * @param listener - called after each replace/append/clear.
   * @returns disposer.
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

function copyMessage(message: ChatMessage): ChatMessage {
  return {
    ...message,
    ...message.changeList === undefined
      ? {}
      : {
        changeList: {
          ...message.changeList,
          changes: message.changeList.changes.map(c => ({ ...c })),
        },
      },
  }
}
