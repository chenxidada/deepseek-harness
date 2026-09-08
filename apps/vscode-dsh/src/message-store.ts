/**
 * Per-session chat message projection for the Conversation panel (AD-CU-1).
 * Projection only — not a second authority message database (AC-45/46).
 * @module @deepseek-ai/dsh-vscode-dsh/message-store
 */

/** One projected chat bubble for the Conversation Webview. */
export interface ChatMessage {
  /** Stable message id within the session projection. */
  id: string
  /** SDK session identity. */
  sessionId: string
  /** Speaker role. */
  role: 'user' | 'assistant' | 'notice'
  /** MVP content kind (text primary). */
  kind: 'text' | 'subagent' | 'diff-summary' | 'notice'
  /** Full readable text (user prompt or complete assistant turn). */
  text: string
  /** Optional turn index when known. */
  turn?: number
  /** True when the turn ended incomplete / interrupted. */
  incomplete?: boolean
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
  return { ...message }
}
