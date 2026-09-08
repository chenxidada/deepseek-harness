/**
 * Conversation controller: Tab registry + IdeSessionHost prompt routing,
 * recoverable close vs explicit delete (AD-CU-3), and MessageStore fan-out.
 * @module @deepseek-ai/dsh-vscode-dsh/conversation-controller
 */

import { randomUUID } from 'node:crypto'
import type { HarnessNotification, SdkPromptContentBlock } from '@deepseek-ai/dsh-sdk-client'
import {
  ConversationRegistry,
  titleFromFirstMessage,
  type ConversationRegistrySnapshot,
  type ConversationTab,
} from './conversation-registry.ts'
import type { IdeSessionHost } from './session-host.ts'
import { TimelineStore } from './timeline-store.ts'
import { MessageStore, type ChatMessage } from './message-store.ts'
import {
  ExtensionIndex,
  type OpenTabRecord,
  type WorkspaceStateLike,
} from './extension-index.ts'
import type { ChatPanelHost } from './chat-panel/chat-panel-host.ts'

/** Outcome of a close attempt that may need running confirmation. */
export type CloseConversationResult =
  | { outcome: 'closed'; tabId: string; sessionId: string; empty: boolean }
  | { outcome: 'needs-confirm-running'; tabId: string; sessionId: string }
  | { outcome: 'cancelled' }
  | { outcome: 'missing' }

/** Outcome of a delete attempt (AC-26/60/72/73). */
export type DeleteConversationResult =
  | { outcome: 'deleted'; tabId: string; sessionId: string }
  | { outcome: 'needs-confirm'; tabId: string; sessionId: string; running: boolean }
  | { outcome: 'cancelled' }
  | { outcome: 'host-not-ready' }
  | { outcome: 'missing' }

/** Options for {@link ConversationController.closeConversation}. */
export interface CloseConversationOptions {
  /**
   * When the Tab is running, pass `true` after the user chose Stop & Close.
   * When omitted/`false` and running → returns `needs-confirm-running` without unloading.
   */
  confirmStopClose?: boolean
}

/** Options for {@link ConversationController.deleteConversation}. */
export interface DeleteConversationOptions {
  /**
   * Pass `true` after the user confirmed delete (and Stop & Delete when running).
   * Confirmation must precede any dispose (AC-72).
   */
  confirmed?: boolean
}

/**
 * Binds {@link ConversationRegistry} to a connected {@link IdeSessionHost}.
 * Close unloads UI without dispose; delete disposes via bridge (AD-CU-3).
 */
export class ConversationController {
  readonly registry = new ConversationRegistry()
  /** Session-scoped timeline projection (turn / step / tool / assistant / Diff). */
  readonly timeline = new TimelineStore()
  /** Session-scoped chat message projection for the Conversation panel. */
  readonly messages = new MessageStore()
  /** Workspace index — immediate persist of openTabSet / activeSessionId. */
  readonly index: ExtensionIndex
  private stopNotifications: (() => void) | undefined
  private panelHost: ChatPanelHost | undefined
  private stopRegistryWatch: (() => void) | undefined
  private stopMessageWatch: (() => void) | undefined
  private stopInteractionWatch: (() => void) | undefined

  /**
   * @param host - window-scoped ide process owner (one process, many sessionIds).
   * @param workspaceState - optional workspaceState for immediate index writes.
   * @param workspaceKey - workspace identity key for the index.
   */
  constructor(
    private readonly host: IdeSessionHost,
    workspaceState?: WorkspaceStateLike,
    workspaceKey = '',
  ) {
    this.index = new ExtensionIndex(workspaceKey, workspaceState)
    this.host.setConversationRegistry?.(this.registry)
    this.stopNotifications = this.host.onNotification((notification) => {
      this.onSdkNotification(notification)
    })
    this.stopRegistryWatch = this.registry.onChange(() => {
      this.persistOpenTabs()
      this.panelHost?.pushFullState()
    })
    this.stopMessageWatch = this.messages.onChange(() => {
      this.persistOpenTabs()
    })
    if (typeof this.host.interactions.onChange === 'function') {
      this.stopInteractionWatch = this.host.interactions.onChange(() => {
        this.panelHost?.pushStatus()
      })
    }
  }

  /**
   * Attach the Conversation panel Host for protocol push.
   * @param panelHost - chat panel Host.
   */
  setPanelHost(panelHost: ChatPanelHost | undefined): void {
    this.panelHost = panelHost
    panelHost?.pushFullState()
  }

  /**
   * Create a new conversation Tab (AC-6 / AC-9).
   * @param title - optional initial title.
   * @returns the created Tab.
   */
  newConversation(title?: string): ConversationTab {
    const tab = this.registry.create(title)
    // Empty Tab: do not write openTabSet yet (AD-CU-3); persistOpenTabs filters.
    this.persistOpenTabs()
    return tab
  }

  /**
   * Switch the active Tab without changing the DSH process (AC-7 / AC-18).
   * @param tabId - Tab to activate.
   */
  switchConversation(tabId: string): void {
    this.registry.switchTo(tabId)
  }

  /**
   * Unload a Tab UI without disposing the session (AD-CU-3 / AC-23).
   * Empty Tabs never enter persisted openTabSet. Running Tabs need confirmStopClose.
   * @param tabId - Tab to close.
   * @param options - running confirmation.
   * @returns close outcome for Extension / L2 hooks.
   */
  async closeConversation(
    tabId: string,
    options: CloseConversationOptions = {},
  ): Promise<CloseConversationResult> {
    const tab = this.registry.get(tabId)
    if (tab === undefined) return { outcome: 'missing' }

    if (tab.status === 'running' && options.confirmStopClose !== true) {
      return { outcome: 'needs-confirm-running', tabId: tab.tabId, sessionId: tab.sessionId }
    }

    const empty = !this.messages.hasContent(tab.sessionId)
    // Abort this Tab's pending Host UI waits when unloading (GAP-009 intent, no dispose).
    this.host.interactions.failClosedSession(
      tab.sessionId,
      `conversation Tab closed (${tabId})`,
    )
    // Keep timeline/message projection in memory for phase-2 reopen; do NOT dispose.
    this.registry.close(tabId)
    this.persistOpenTabs()
    this.panelHost?.pushFullState()
    return { outcome: 'closed', tabId: tab.tabId, sessionId: tab.sessionId, empty }
  }

  /**
   * Explicitly delete a conversation: dispose + clear authority index (AC-26/60/72/73).
   * Does not cascade to child session authority (AC-61).
   * @param tabId - Tab whose session to delete.
   * @param options - confirmation flag (required before dispose).
   * @returns delete outcome.
   */
  async deleteConversation(
    tabId: string,
    options: DeleteConversationOptions = {},
  ): Promise<DeleteConversationResult> {
    if (this.host.status !== 'connected') {
      return { outcome: 'host-not-ready' }
    }
    const tab = this.registry.get(tabId)
    if (tab === undefined) return { outcome: 'missing' }

    if (options.confirmed !== true) {
      return {
        outcome: 'needs-confirm',
        tabId: tab.tabId,
        sessionId: tab.sessionId,
        running: tab.status === 'running',
      }
    }

    this.host.interactions.failClosedSession(
      tab.sessionId,
      `conversation deleted (${tabId})`,
    )
    // Dispose before registry close so a failed dispose leaves the Tab for retry (GAP-003).
    await this.host.disposeSession(tab.sessionId)
    this.messages.clearSession(tab.sessionId)
    this.timeline.clearSession(tab.sessionId)
    this.index.markDeleted(tab.sessionId)
    this.registry.close(tabId)
    this.persistOpenTabs()
    this.panelHost?.pushFullState()
    return { outcome: 'deleted', tabId: tab.tabId, sessionId: tab.sessionId }
  }

  /**
   * Delete by sessionId when a Tab is open (closes live views — AC-60).
   * @param sessionId - session to delete.
   * @param options - confirmation flag.
   */
  async deleteSession(
    sessionId: string,
    options: DeleteConversationOptions = {},
  ): Promise<DeleteConversationResult> {
    const tab = this.registry.getBySessionId(sessionId)
    if (tab !== undefined) {
      return this.deleteConversation(tab.tabId, options)
    }
    if (this.host.status !== 'connected') {
      return { outcome: 'host-not-ready' }
    }
    if (options.confirmed !== true) {
      return {
        outcome: 'needs-confirm',
        tabId: '',
        sessionId,
        running: false,
      }
    }
    this.host.interactions.failClosedSession(sessionId, `conversation deleted (${sessionId})`)
    await this.host.disposeSession(sessionId)
    this.messages.clearSession(sessionId)
    this.timeline.clearSession(sessionId)
    this.index.markDeleted(sessionId)
    this.persistOpenTabs()
    return { outcome: 'deleted', tabId: '', sessionId }
  }

  /**
   * Prompt the active Tab's session and project the user bubble (AC-7 / AC-10).
   * @param text - user text content.
   * @returns message id and the targeted session id.
   */
  async promptActive(text: string): Promise<{ messageId: string; sessionId: string; tabId: string }> {
    const active = this.registry.getActive()
    if (active === undefined) {
      throw new Error('no active conversation Tab')
    }
    return this.promptTab(active.tabId, text).then(result => ({ ...result, tabId: active.tabId }))
  }

  /**
   * Prompt a specific Tab by id (tests / explicit routing).
   * Projects an optimistic user message when the runtime omits user/message (A-1).
   * @param tabId - Tab whose session receives the prompt.
   * @param text - user text.
   * @returns message id and session id.
   */
  async promptTab(tabId: string, text: string): Promise<{ messageId: string; sessionId: string }> {
    const tab = this.registry.get(tabId)
    if (tab === undefined) throw new Error(`unknown conversation Tab: ${tabId}`)
    const blocks: SdkPromptContentBlock[] = [{ type: 'text', text }]
    const messageId = await this.host.prompt(tab.sessionId, blocks)
    this.projectUserMessage(tab.sessionId, text, messageId)
    if (tab.title === undefined) {
      const title = titleFromFirstMessage(text)
      if (title !== undefined) this.registry.setTitle(tabId, title)
    }
    const preview = titleFromFirstMessage(text, 80)
    this.index.upsertSession({
      sessionId: tab.sessionId,
      title: this.registry.get(tabId)?.title ?? preview ?? 'Conversation',
      mtime: Date.now(),
      ...preview === undefined ? {} : { firstUserPreview: preview },
    })
    this.persistOpenTabs()
    return { messageId, sessionId: tab.sessionId }
  }

  /**
   * Apply a permission-presets name on the active Tab session (AC-21 / AC-22).
   * @param preset - preset table key from dsh-permission-presets.
   * @returns the applied preset name.
   */
  async selectPermissionPreset(preset: string): Promise<{ sessionId: string; preset: string }> {
    const active = this.registry.getActive()
    if (active === undefined) throw new Error('no active conversation Tab')
    const applied = await this.host.selectPermissionPreset(active.sessionId, preset)
    return { sessionId: active.sessionId, preset: applied }
  }

  /**
   * List permission-presets for the active Tab via Host bridge (AC-21).
   * @returns advertised presets and current selection from the runtime.
   */
  async listPermissionPresets(): Promise<{ sessionId: string; presets: string[]; current: string }> {
    const active = this.registry.getActive()
    if (active === undefined) throw new Error('no active conversation Tab')
    const listed = await this.host.listPermissionPresets(active.sessionId)
    return { sessionId: active.sessionId, ...listed }
  }

  /**
   * Registry snapshot for Tab bar UI.
   * @returns current Tabs and active pointer.
   */
  snapshot(): ConversationRegistrySnapshot {
    return this.registry.snapshot()
  }

  /**
   * Panel-facing snapshot for L2 hooks (mode / messages / status).
   * @returns active panel projection fields.
   */
  panelSnapshot(): {
    mode: 'empty' | 'waiting-host' | 'live' | 'replay'
    sessionId?: string
    tabId?: string
    title?: string
    messages: readonly ChatMessage[]
    tabStatus?: ConversationTab['status']
    index: ReturnType<ExtensionIndex['read']>
  } {
    const active = this.registry.getActive()
    if (active === undefined) {
      return {
        mode: this.host.status === 'connected' ? 'empty' : 'waiting-host',
        messages: [],
        index: this.index.read(),
      }
    }
    return {
      mode: active.mode,
      sessionId: active.sessionId,
      tabId: active.tabId,
      ...active.title === undefined ? {} : { title: active.title },
      messages: this.messages.get(active.sessionId),
      tabStatus: active.status,
      index: this.index.read(),
    }
  }

  /** Clear local Tabs on window shutdown (process teardown owns remote sessions). */
  clearLocal(): void {
    this.stopNotifications?.()
    this.stopNotifications = undefined
    this.stopRegistryWatch?.()
    this.stopRegistryWatch = undefined
    this.stopMessageWatch?.()
    this.stopMessageWatch = undefined
    this.stopInteractionWatch?.()
    this.stopInteractionWatch = undefined
    this.host.setConversationRegistry?.(undefined)
    this.panelHost = undefined
    this.timeline.clear()
    this.messages.clear()
    this.registry.clear()
  }

  /**
   * Persist openTabSet / activeSessionId immediately (AD-CU-4).
   * Empty Tabs (no messages) are excluded from openTabSet (AD-CU-3).
   */
  persistOpenTabs(): void {
    const openTabSet: OpenTabRecord[] = []
    for (const tab of this.registry.list()) {
      if (!this.messages.hasContent(tab.sessionId)) continue
      openTabSet.push({
        tabId: tab.tabId,
        sessionId: tab.sessionId,
        mode: tab.mode,
        ...tab.title === undefined ? {} : { title: tab.title },
      })
    }
    const active = this.registry.getActive()
    this.index.setOpenTabs(openTabSet, active?.sessionId)
  }

  private projectUserMessage(sessionId: string, text: string, messageId: string): void {
    const message: ChatMessage = {
      id: messageId,
      sessionId,
      role: 'user',
      kind: 'text',
      text,
    }
    this.messages.append(sessionId, message)
    this.panelHost?.pushAppend(message)
  }

  private projectAssistantMessage(sessionId: string, text: string, turn?: number): void {
    if (text === '') return
    const message: ChatMessage = {
      id: randomUUID(),
      sessionId,
      role: 'assistant',
      kind: 'text',
      text,
      ...turn === undefined ? {} : { turn },
    }
    this.messages.append(sessionId, message)
    this.panelHost?.pushAppend(message)
  }

  private onSdkNotification(notification: HarnessNotification): void {
    this.timeline.apply(notification)
    if (notification.method === 'session.status') {
      const sessionId = notification.params.sessionId
      const status = notification.params.status
      if (typeof sessionId !== 'string' || (status !== 'idle' && status !== 'running')) return
      const tab = this.registry.getBySessionId(sessionId)
      if (tab === undefined) return
      this.registry.setStatus(tab.tabId, status === 'running' ? 'running' : 'idle')
      this.panelHost?.pushStatus()
      return
    }
    if (notification.method !== 'session.event') return
    const sessionId = notification.params.sessionId
    const event = notification.params.event
    if (typeof sessionId !== 'string' || typeof event !== 'object' || event === null) return
    const record = event as Record<string, unknown>
    if (record.type !== 'assistant/message') return
    const data = record.data as Record<string, unknown> | undefined
    const message = data?.message as Record<string, unknown> | undefined
    const text = firstAssistantText(message)
    // AC-6: never invent assistant body when the event has no text.
    if (text === undefined) return
    const turn = typeof data?.turn === 'number' ? data.turn : undefined
    this.projectAssistantMessage(sessionId, text, turn)
  }
}

function firstAssistantText(message: Record<string, unknown> | undefined): string | undefined {
  if (message === undefined) return undefined
  const content = message.content
  if (!Array.isArray(content)) return undefined
  for (const block of content) {
    if (typeof block !== 'object' || block === null) continue
    const record = block as Record<string, unknown>
    if (record.type === 'text' && typeof record.text === 'string') return record.text
  }
  return undefined
}
