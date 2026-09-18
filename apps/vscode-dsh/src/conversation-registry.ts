/**
 * Extension-owned multi-conversation Tab registry (AD-5 / AD-CU-5).
 * Session persistence and agent-loop remain in the DSH subprocess (AC-15).
 * @module @deepseek-ai/dsh-vscode-dsh/conversation-registry
 */

import { randomUUID } from 'node:crypto'
import type { OpenTabMode } from './extension-index.ts'

/** Lifecycle status projected onto a conversation Tab. */
export type ConversationTabStatus = 'idle' | 'running' | 'error' | 'disconnected'

/**
 * One conversation Tab bound to an SDK `sessionId`.
 * Authority for Tab chrome lives in the Extension; session authority stays in DSH.
 */
export interface ConversationTab {
  /** Stable Tab identity in the Extension UI (destroyed on close). */
  tabId: string
  /** SDK `sessionId` (UUID minted on create). */
  sessionId: string
  /** Optional title: first user message summary or session title (AC-11). */
  title?: string
  /** Local projection of Tab readiness (not the SDK agent status authority). */
  status: ConversationTabStatus
  /** Projection mode: live (composer on) or replay (composer off). */
  mode: OpenTabMode
  /** Inactive Tab received new messages (AC-19); cleared on activate+show (AC-57). */
  unread: boolean
  /** Session has pending/presented Host interactions (AC-20). */
  approvalBadge: boolean
  /**
   * In-panel child-session context (phase-4 subagent enter).
   * When set, this Tab projects the child session, not its root `sessionId`.
   */
  contextSessionId?: string
  /**
   * Whether this Tab is a pinned subagent child promoted from an in-panel context.
   * Lineage (parent session id) is resolved via TimelineStore, not stored here (phase-4).
   */
  pinnedSubagent?: boolean
}

/** Immutable snapshot for Tab bar rendering and tests. */
export interface ConversationRegistrySnapshot {
  /** Active Tab id, or `undefined` when the registry is empty. */
  activeTabId: string | undefined
  /** Tabs in creation order. */
  tabs: readonly ConversationTab[]
}

/**
 * Window-scoped registry: mint Tabs, switch the active pointer, close Tabs.
 * Closing returns the removed Tab; dispose is a separate delete path (AD-CU-3).
 */
export class ConversationRegistry {
  private readonly tabs = new Map<string, ConversationTab>()
  private readonly order: string[] = []
  private activeTabId: string | undefined
  private readonly listeners = new Set<() => void>()

  /**
   * Create a new Tab with a fresh UUID `sessionId` and make it active (AC-6, AC-9).
   * Enforces one open view per sessionId (AC-59).
   * @param title - optional initial title.
   * @param sessionId - optional existing session id (history reopen); defaults to a new UUID.
   * @param mode - initial mode (default `live` for new Tabs).
   * @returns the created Tab.
   * @throws when `sessionId` already has an open Tab.
   */
  create(title?: string, sessionId?: string, mode: OpenTabMode = 'live'): ConversationTab {
    const resolvedSessionId = sessionId ?? randomUUID()
    if (this.getBySessionId(resolvedSessionId) !== undefined) {
      throw new Error(`session already has an open Tab: ${resolvedSessionId}`)
    }
    const tabId = randomUUID()
    const tab: ConversationTab = {
      tabId,
      sessionId: resolvedSessionId,
      status: 'idle',
      mode,
      unread: false,
      approvalBadge: false,
      ...title === undefined ? {} : { title },
    }
    this.tabs.set(tabId, tab)
    this.order.push(tabId)
    this.activeTabId = tabId
    this.emit()
    return { ...tab }
  }

  /**
   * Switch the active Tab used for prompts and timeline projection (AC-7).
   * @param tabId - Tab to activate.
   * @throws when the Tab is unknown.
   */
  switchTo(tabId: string): void {
    if (!this.tabs.has(tabId)) {
      throw new Error(`unknown conversation Tab: ${tabId}`)
    }
    this.activeTabId = tabId
    // AC-57: activating a Tab clears its unread when the panel will show it.
    const tab = this.tabs.get(tabId)
    if (tab !== undefined) tab.unread = false
    this.emit()
  }

  /**
   * Remove a Tab from the open set (UI unload). Does not dispose the session.
   * @param tabId - Tab to close.
   * @returns the removed Tab, or `undefined` when unknown.
   */
  close(tabId: string): ConversationTab | undefined {
    const tab = this.tabs.get(tabId)
    if (tab === undefined) return undefined
    this.tabs.delete(tabId)
    const index = this.order.indexOf(tabId)
    if (index >= 0) this.order.splice(index, 1)
    if (this.activeTabId === tabId) {
      const next = this.order[Math.min(index, this.order.length - 1)]
      this.activeTabId = next
    }
    this.emit()
    return { ...tab }
  }

  /** Remove every Tab without dispose side effects (window shutdown clears local state). */
  clear(): void {
    this.tabs.clear()
    this.order.length = 0
    this.activeTabId = undefined
    this.emit()
  }

  /**
   * Active Tab, if any.
   * @returns a copy of the active Tab, or `undefined`.
   */
  getActive(): ConversationTab | undefined {
    if (this.activeTabId === undefined) return undefined
    const tab = this.tabs.get(this.activeTabId)
    return tab === undefined ? undefined : { ...tab }
  }

  /**
   * Look up one Tab by id.
   * @param tabId - Tab identity.
   * @returns a copy of the Tab, or `undefined`.
   */
  get(tabId: string): ConversationTab | undefined {
    const tab = this.tabs.get(tabId)
    return tab === undefined ? undefined : { ...tab }
  }

  /**
   * Find the Tab bound to an SDK session id (AC-59 single-open index).
   * @param sessionId - SDK session identity.
   * @returns a copy of the Tab, or `undefined`.
   */
  getBySessionId(sessionId: string): ConversationTab | undefined {
    for (const tab of this.tabs.values()) {
      if (tab.sessionId === sessionId) return { ...tab }
    }
    return undefined
  }

  /**
   * All Tabs in creation order.
   * @returns Tab copies.
   */
  list(): ConversationTab[] {
    return this.order.flatMap((id) => {
      const tab = this.tabs.get(id)
      return tab === undefined ? [] : [{ ...tab }]
    })
  }

  /**
   * Update Tab title (AC-11).
   * @param tabId - Tab to update.
   * @param title - display title.
   */
  setTitle(tabId: string, title: string): void {
    const tab = this.tabs.get(tabId)
    if (tab === undefined) throw new Error(`unknown conversation Tab: ${tabId}`)
    tab.title = title
    this.emit()
  }

  /**
   * Update local Tab status projection.
   * @param tabId - Tab to update.
   * @param status - new status.
   */
  setStatus(tabId: string, status: ConversationTabStatus): void {
    const tab = this.tabs.get(tabId)
    if (tab === undefined) throw new Error(`unknown conversation Tab: ${tabId}`)
    tab.status = status
    this.emit()
  }

  /**
   * Update Tab projection mode (live ↔ replay).
   * @param tabId - Tab to update.
   * @param mode - new mode.
   */
  setMode(tabId: string, mode: OpenTabMode): void {
    const tab = this.tabs.get(tabId)
    if (tab === undefined) throw new Error(`unknown conversation Tab: ${tabId}`)
    tab.mode = mode
    this.emit()
  }

  /**
   * Mark or clear the unread dot for a Tab (AC-19 / AC-57).
   * @param tabId - Tab to update.
   * @param unread - whether the Tab has unread messages.
   */
  setUnread(tabId: string, unread: boolean): void {
    const tab = this.tabs.get(tabId)
    if (tab === undefined) throw new Error(`unknown conversation Tab: ${tabId}`)
    if (tab.unread === unread) return
    tab.unread = unread
    this.emit()
  }

  /**
   * Set the in-panel child-session context for a Tab (phase-4 subagent enter).
   * A `undefined` value clears the context back to the Tab root.
   * @param tabId - Tab to update.
   * @param sessionId - child session id, or undefined to clear.
   */
  setContextSessionId(tabId: string, sessionId: string | undefined): void {
    const tab = this.tabs.get(tabId)
    if (tab === undefined) throw new Error(`unknown conversation Tab: ${tabId}`)
    if (sessionId === undefined) delete tab.contextSessionId
    else tab.contextSessionId = sessionId
    this.emit()
  }

  /**
   * Set whether a Tab is a pinned subagent child (phase-4 pin).
   * @param tabId - Tab to update.
   * @param pinned - whether the Tab is a pinned subagent child.
   */
  setPinnedSubagent(tabId: string, pinned: boolean): void {
    const tab = this.tabs.get(tabId)
    if (tab === undefined) throw new Error(`unknown conversation Tab: ${tabId}`)
    tab.pinnedSubagent = pinned
    this.emit()
  }

  /**
   * Mark or clear the approval badge for a Tab (AC-20).
   * @param tabId - Tab to update.
   * @param approvalBadge - whether the Tab has pending interactions.
   */
  setApprovalBadge(tabId: string, approvalBadge: boolean): void {
    const tab = this.tabs.get(tabId)
    if (tab === undefined) throw new Error(`unknown conversation Tab: ${tabId}`)
    if (tab.approvalBadge === approvalBadge) return
    tab.approvalBadge = approvalBadge
    this.emit()
  }

  /**
   * Snapshot for Tab bar UI and tests.
   * @returns immutable view of registry state.
   */
  snapshot(): ConversationRegistrySnapshot {
    return {
      activeTabId: this.activeTabId,
      tabs: this.list(),
    }
  }

  /**
   * Subscribe to registry mutations (Tab bar refresh).
   * @param listener - called after each mutation.
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

/**
 * Derive a short default Tab title from the first user message (AC-11).
 * @param text - raw user text.
 * @param maxLength - maximum title length (default 40).
 * @returns trimmed summary, or `undefined` when empty.
 */
export function titleFromFirstMessage(text: string, maxLength = 40): string | undefined {
  const trimmed = text.replace(/\s+/g, ' ').trim()
  if (trimmed === '') return undefined
  if (trimmed.length <= maxLength) return trimmed
  return `${trimmed.slice(0, Math.max(1, maxLength - 1))}…`
}
