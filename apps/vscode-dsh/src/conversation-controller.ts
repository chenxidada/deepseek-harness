/**
 * Conversation controller: Tab registry + IdeSessionHost prompt/dispose routing
 * and interaction Tab binding (AC-10).
 * @module @deepseek-ai/dsh-vscode-dsh/conversation-controller
 */

import type { SdkPromptContentBlock } from '@deepseek-ai/dsh-sdk-client'
import {
  ConversationRegistry,
  titleFromFirstMessage,
  type ConversationRegistrySnapshot,
  type ConversationTab,
} from './conversation-registry.ts'
import type { IdeSessionHost } from './session-host.ts'

/**
 * Binds {@link ConversationRegistry} to a connected {@link IdeSessionHost}.
 * Ensures prompts target the active Tab `sessionId` and close disposes via bridge.
 */
export class ConversationController {
  readonly registry = new ConversationRegistry()

  /**
   * @param host - window-scoped ide process owner (one process, many sessionIds).
   */
  constructor(private readonly host: IdeSessionHost) {
    this.host.setConversationRegistry?.(this.registry)
  }

  /**
   * Create a new conversation Tab (AC-6 / AC-9).
   * @param title - optional initial title.
   * @returns the created Tab.
   */
  newConversation(title?: string): ConversationTab {
    return this.registry.create(title)
  }

  /**
   * Switch the active Tab without changing the DSH process (AC-7).
   * @param tabId - Tab to activate.
   */
  switchConversation(tabId: string): void {
    this.registry.switchTo(tabId)
  }

  /**
   * Close a Tab and dispose its session via ide-bridge (AC-8 / Q-3).
   * Default policy: end the session (not recoverable in this version).
   * Disposes the remote session first; only then removes the Tab so a failed
   * dispose leaves the Tab available for retry (GAP-003).
   * @param tabId - Tab to close.
   */
  async closeConversation(tabId: string): Promise<void> {
    const tab = this.registry.get(tabId)
    if (tab === undefined) return
    // AD-5 / GAP-009: fail-closed this session's Host UI waits before dispose.
    this.host.interactions.failClosedSession(
      tab.sessionId,
      `conversation Tab closed (${tabId})`,
    )
    await this.host.disposeSession(tab.sessionId)
    this.registry.close(tabId)
  }

  /**
   * Prompt the active Tab's session (AC-7 — must not cross sessions).
   * @param text - user text content.
   * @returns message id and the targeted session id.
   */
  async promptActive(text: string): Promise<{ messageId: string; sessionId: string; tabId: string }> {
    const active = this.registry.getActive()
    if (active === undefined) {
      throw new Error('no active conversation Tab')
    }
    const blocks: SdkPromptContentBlock[] = [{ type: 'text', text }]
    const messageId = await this.host.prompt(active.sessionId, blocks)
    if (active.title === undefined) {
      const title = titleFromFirstMessage(text)
      if (title !== undefined) this.registry.setTitle(active.tabId, title)
    }
    return { messageId, sessionId: active.sessionId, tabId: active.tabId }
  }

  /**
   * Prompt a specific Tab by id (tests / explicit routing).
   * @param tabId - Tab whose session receives the prompt.
   * @param text - user text.
   * @returns message id and session id.
   */
  async promptTab(tabId: string, text: string): Promise<{ messageId: string; sessionId: string }> {
    const tab = this.registry.get(tabId)
    if (tab === undefined) throw new Error(`unknown conversation Tab: ${tabId}`)
    const messageId = await this.host.prompt(tab.sessionId, [{ type: 'text', text }])
    if (tab.title === undefined) {
      const title = titleFromFirstMessage(text)
      if (title !== undefined) this.registry.setTitle(tabId, title)
    }
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

  /** Clear local Tabs on window shutdown (process teardown owns remote sessions). */
  clearLocal(): void {
    this.host.setConversationRegistry?.(undefined)
    this.registry.clear()
  }
}
