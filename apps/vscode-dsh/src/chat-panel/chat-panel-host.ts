/**
 * Conversation panel Host: pushes protocol frames and gates composer/send (revised AD-CU-1 / AD-CUX-1).
 * Host owns decision state; Webview may hold probeable presentation state.
 * Works with a real WebviewView or an L3 fake Webview port.
 * @module @deepseek-ai/dsh-vscode-dsh/chat-panel/chat-panel-host
 */

import type { ChatMessage, MessageStore } from '../message-store.ts'
import type { ConversationRegistry } from '../conversation-registry.ts'
import type { ExtensionIndex } from '../extension-index.ts'
import type { InteractionCoordinator } from '../interaction-coordinator.ts'
import type { ConnectionUiState } from '../connection-ui.ts'
import { validateComposerAtPaths, type ResolveAtPathOptions } from '../code-context/at-path.ts'
import {
  parseWebviewToHostMessage,
  type ConnectionPhase,
  type HostToWebviewMessage,
  type PanelMode,
  type PanelStatus,
  type RejectSendReason,
  type WebviewToHostMessage,
} from './protocol.ts'

/** Duck-typed Webview message port (real Webview or L3 fake). */
export interface WebviewMessagePort {
  postMessage(message: unknown): void
  onDidReceiveMessage(listener: (message: unknown) => void): { dispose(): void }
}

/** Result of a Host-gated send attempt. */
export type SendGateResult =
  | { ok: true; messageId: string; sessionId: string; tabId: string }
  | { ok: false; reason: RejectSendReason }

/** Dependencies the panel Host needs from the Extension / controller. */
export interface ChatPanelHostDeps {
  /** Live Tab registry. */
  registry: ConversationRegistry
  /** Message projection store. */
  messages: MessageStore
  /** Optional index (for activeSessionId reads in tests). */
  index?: ExtensionIndex
  /** Pending interaction coordinator for waiting-interaction status. */
  interactions?: InteractionCoordinator | undefined
  /** Whether the IdeSessionHost is connected. */
  isHostReady: () => boolean
  /**
   * Accept a non-empty live send into the existing prompt path.
   * @param text - trimmed user text.
   */
  acceptSend: (text: string) => Promise<{ messageId: string; sessionId: string; tabId: string }>
  /** Optional delete action requested from the panel. */
  requestDelete?: () => Promise<void>
  /** Optional Continue action (AD-CU-8). */
  requestContinue?: () => Promise<void>
  /** Optional Stop / cancel active turn (AD-CUX-3 / I-真). */
  requestStop?: () => Promise<void>
  /** Optional「新建会话」action (AD-CR-8); Host owns Start→New/reuse→reveal. */
  requestNewConversation?: () => Promise<void>
  /** Optional 「查看更多」 restore. */
  requestRestoreMore?: (all?: boolean) => Promise<void>
  /** Optional Continue chrome resolver for panel/state. */
  resolveContinueChrome?: () => {
    visibility: 'hidden' | 'disabled' | 'enabled'
    capability?: 'same-id' | 'derive-only' | 'unknown'
    tooltip?: string
    reason?: 'capability-unavailable' | 'already-live' | 'host-not-ready' | 'continue-sealed'
    reasonText?: string
  } | undefined
  /** Optional deferred restore count for 「查看更多」. */
  resolveDeferredRestoreCount?: () => number
  /**
   * Optional scroll/reveal resolver (AC-56).
   * @param callId - optional tool call id.
   */
  resolveReveal?: (callId?: string) => {
    kind: 'user' | 'assistant' | 'none'
    messageId?: string
    label?: string
    sessionId: string
  }
  /** Optional manual retry after failed / disconnected connection (AC-2 / AC-14). */
  requestRetryConnect?: () => Promise<void>
  /** Optional settings deep-link (missing credentials). */
  requestOpenSettings?: () => Promise<void>
  /**
   * Optional code-copy path (AC-17) → `dsh.copyToClipboard`.
   * @param text - fenced code body to write.
   */
  requestCopyCode?: (text: string) => Promise<void>
  /**
   * Optional message-copy path (AC-30) → clipboard + `lastCopiedText` observability.
   * @param messageId - projected bubble id.
   * @param text - optional explicit text; Host falls back to MessageStore.
   */
  requestCopyMessage?: (messageId: string, text?: string) => Promise<void>
  /**
   * Retry a closed turn via P-接续 fork (AC-31).
   * @param messageId - message in the closed turn to retry.
   */
  requestRetry?: (messageId: string) => Promise<void>
  /**
   * Edit-resend via P-接续 fork (AC-32).
   * @param messageId - user message id.
   * @param text - edited prompt text.
   */
  requestEditResend?: (messageId: string, text: string) => Promise<void>
  /**
   * Explicit branch via P-标明 fork (AC-60).
   * @param turn - closed turn number.
   */
  requestBranch?: (turn: number) => Promise<void>
  /**
   * Tier 1/2 session search (AD-CUX-9). Returns metadata hits only.
   * @param query - optional text (tier 1) and/or path (tier 2).
   */
  requestSearchSessions?: (query: {
    text?: string
    path?: string
  }) => Promise<Array<{
    sessionId: string
    title: string
    mtime: number
    matchTiers: Array<1 | 2>
    matchField?: 'title' | 'firstUserPreview'
    firstUserPreview?: string
    matchedPath?: string
  }>>
  /**
   * Open a search hit via history/replay — must not auto-Start (AC-52).
   * @param sessionId - hit session id.
   */
  requestOpenSearchHit?: (sessionId: string) => Promise<void>
  /**
   * Host decision-mirror probes for panel/state (GAP-CUX-002 / AC-31b).
   */
  resolveHostProbes?: () => { parentReadonly?: boolean; continueSealed?: boolean } | undefined
  /**
   * Optional「派生自 …」parent title for fork chrome (AC-63).
   */
  resolveForkParentTitle?: () => string | undefined
  /**
   * Optional Timeline/Diff review path for 「本回合改了 N 个文件」(AC-30 secondary).
   * Typically `dsh.reviewWorkspaceDiffs`.
   */
  requestOpenWorkspaceDiffs?: () => Promise<void>
  /**
   * Reveal message-attached change-list (AC-30 primary / AD-CCD-4).
   * @param sourceMessageId - optional assistant id from the summary bubble's turn.
   */
  requestRevealChangeList?: (sourceMessageId?: string) => Promise<void>
  /**
   * Serve on-demand diff from SnapshotStore (AC-12).
   * @param changeId - ChangeRecord id.
   */
  requestChangeDiff?: (changeId: string) => Promise<{
    changeId: string
    available: boolean
    oldText?: string | null
    newText?: string
    reason?: string
  }>
  /**
   * Open a changed file and reveal first changed line when known (AC-12a).
   * @param changeId - ChangeRecord id.
   * @param path - workspace path.
   */
  requestChangeOpen?: (changeId: string, path: string) => Promise<void>
  /**
   * Explicit T8 native Diff open from ChangeRecord snapshot (AC-43).
   * @param changeId - ChangeRecord id.
   */
  requestChangeOpenNativeDiff?: (changeId: string) => Promise<void>
  /**
   * Scroll to the source assistant message (AC-19).
   * @param sourceMessageId - assistant message id.
   */
  requestRevealSource?: (sourceMessageId: string) => Promise<void>
  /**
   * Mark a change reviewed (AC-11) — no workspace write.
   * @param changeId - ChangeRecord id.
   */
  requestMarkReviewed?: (changeId: string) => Promise<void>
  /**
   * Revert one change with confirm gates (AC-13…17).
   * @param changeId - ChangeRecord id.
   */
  requestRevert?: (changeId: string) => Promise<{
    changeId: string
    ok: boolean
    reason?: string
  }>
  /**
   * Batch revert with per-file results (AC-18 / AD-CCD-10).
   * @param changeIds - ChangeRecord ids.
   */
  requestRevertMany?: (changeIds: readonly string[]) => Promise<ReadonlyArray<{
    changeId: string
    ok: boolean
    reason?: string
  }>>
  /**
   * Workspace roots for `@path` send-gate resolve (AD-CCD-11).
   * When omitted, `@` tokens are rejected as not-found.
   */
  getAtPathResolveOptions?: () => ResolveAtPathOptions
  /**
   * Open a reference card path using extension-local selection meta (AC-4).
   * @param path - workspace-relative path from the card.
   */
  requestOpenReference?: (path: string) => Promise<void>
}

/**
 * Owns Host↔Webview protocol push and inbound composer/send handling.
 */
export class ChatPanelHost {
  private port: WebviewMessagePort | undefined
  private stopPort: (() => void) | undefined
  private readonly outbound: HostToWebviewMessage[] = []
  private connectionPhase: ConnectionPhase = 'idle'
  private connectionMessage: string | undefined
  private settingsDeepLinkAvailable = false
  /** Latest composer/prefill text waiting for a Webview attach (cold-start). */
  private pendingPrefill: string | undefined

  /**
   * @param deps - registry / store / send gate callbacks.
   */
  constructor(private readonly deps: ChatPanelHostDeps) {}

  /**
   * Apply ConnectionUiState into panel/state + banner (AC-13 / AC-14).
   * @param state - routed connection UI state.
   */
  applyConnectionState(state: ConnectionUiState): void {
    this.connectionPhase = state.phase
    this.connectionMessage = state.message
    this.settingsDeepLinkAvailable = state.settingsDeepLinkAvailable
    if (state.phase === 'connecting') {
      this.pushBanner(state.message ?? '正在连接到 Host…', 'connecting')
    } else if (state.phase === 'failed' || state.phase === 'disconnected-manual'
      || state.phase === 'disconnected-retrying') {
      this.pushBanner(state.message ?? 'Host connection issue', state.phase)
    } else if (state.phase === 'connected' || state.phase === 'idle') {
      // Re-push full state so connecting banner does not stick.
      this.pushFullState()
      return
    }
    this.pushFullState()
  }

  /** Last connection phase for L2 assertions. */
  getConnectionPhase(): ConnectionPhase {
    return this.connectionPhase
  }

  /**
   * Attach a Webview (or fake) port. Replaces any previous port.
   * Replays the latest buffered `composer/prefill` after full state (AC-1 cold-start).
   * @param port - message port.
   */
  attach(port: WebviewMessagePort): void {
    this.stopPort?.()
    this.port = port
    const sub = port.onDidReceiveMessage(raw => {
      const message = parseWebviewToHostMessage(raw)
      if (message === undefined) return
      void this.onWebviewMessage(message)
    })
    this.stopPort = () => {
      sub.dispose()
    }
    this.pushFullState()
    if (this.pendingPrefill !== undefined) {
      const text = this.pendingPrefill
      this.pendingPrefill = undefined
      this.post({ type: 'composer/prefill', text })
    }
  }

  /** Detach the current port without disposing Host state. */
  detach(): void {
    this.stopPort?.()
    this.stopPort = undefined
    this.port = undefined
  }

  /**
   * Outbound frames captured for L2/L3 assertions (also posted when a port is attached).
   * @returns copy of the outbound log.
   */
  getOutboundLog(): readonly HostToWebviewMessage[] {
    return [...this.outbound]
  }

  /** Clear the outbound log (tests). */
  clearOutboundLog(): void {
    this.outbound.length = 0
  }

  /**
   * Push panel/state + messages/replace + status for the active Tab (or empty).
   * Empty / waiting-host always includes messages/replace([]) so attached Webviews
   * clear residual bubbles (AC-2 / AC-24).
   */
  pushFullState(): void {
    const active = this.deps.registry.getActive()
    const connectionFields = {
      connectionPhase: this.connectionPhase,
      ...this.connectionMessage === undefined ? {} : { connectionMessage: this.connectionMessage },
      settingsDeepLinkAvailable: this.settingsDeepLinkAvailable,
    }
    // Chrome「新建会话」is the product primary entry (AD-CR-8 / AC-15): always enabled.
    const newConversationChrome = {
      chrome: { newConversation: { visibility: 'enabled' as const } },
    }
    if (active === undefined) {
      const mode: PanelMode = this.connectionPhase === 'connecting' || !this.deps.isHostReady()
        ? 'waiting-host'
        : 'empty'
      this.post({
        type: 'panel/state',
        mode,
        continue: { visibility: 'hidden' },
        ...newConversationChrome,
        deferredRestoreCount: this.deps.resolveDeferredRestoreCount?.() ?? 0,
        ...connectionFields,
      })
      // Clear message list on empty chrome — Host projection may still hold closed-Tab content.
      this.post({ type: 'messages/replace', sessionId: '', messages: [] })
      this.post({
        type: 'status/set',
        status: this.connectionPhase === 'connecting' || !this.deps.isHostReady()
          ? 'disconnected'
          : 'idle',
      })
      return
    }
    // AC-22 / R1: while Start is in flight, never project sendable `live`.
    const mode: PanelMode = this.connectionPhase === 'connecting'
      ? 'waiting-host'
      : active.mode === 'replay'
        ? 'replay'
        : 'live'
    const continueChrome = this.deps.resolveContinueChrome?.()
    const hostProbes = this.deps.resolveHostProbes?.()
    const forkParentTitle = this.deps.resolveForkParentTitle?.()
    this.post({
      type: 'panel/state',
      mode,
      sessionId: active.sessionId,
      tabId: active.tabId,
      ...active.title === undefined ? {} : { title: active.title },
      ...continueChrome === undefined ? {} : { continue: continueChrome },
      ...newConversationChrome,
      deferredRestoreCount: this.deps.resolveDeferredRestoreCount?.() ?? 0,
      ...connectionFields,
      ...forkParentTitle === undefined ? {} : { forkParentTitle },
      ...hostProbes === undefined ? {} : { probes: hostProbes },
    })
    this.post({
      type: 'messages/replace',
      sessionId: active.sessionId,
      messages: this.deps.messages.get(active.sessionId),
    })
    this.post({
      type: 'status/set',
      sessionId: active.sessionId,
      status: this.connectionPhase === 'connecting'
        ? 'disconnected'
        : this.resolveStatus(active.sessionId, active.status),
    })
  }

  /**
   * Push a UI banner (derive Continue / restore hints).
   * @param text - banner copy.
   * @param kind - optional kind tag.
   */
  pushBanner(text: string, kind?: string): void {
    this.post({
      type: 'ui/banner',
      text,
      ...kind === undefined ? {} : { kind },
    })
  }

  /**
   * Push a single complete message append for the active session (live turn).
   * @param message - complete chat message.
   */
  pushAppend(message: ChatMessage): void {
    const active = this.deps.registry.getActive()
    if (active === undefined || active.sessionId !== message.sessionId) return
    this.post({ type: 'messages/append', sessionId: message.sessionId, message })
  }

  /**
   * Push an incremental messages/patch for a stable bubble id (AD-CUX-10).
   * Rejects frames that include both `text` and `appendText`.
   * @param sessionId - SDK session identity.
   * @param messageId - stable bubble id.
   * @param update - text XOR appendText plus optional flags.
   */
  pushPatch(
    sessionId: string,
    messageId: string,
    update: {
      text?: string
      appendText?: string
      incomplete?: boolean
      streaming?: boolean
      activityStatus?: 'running' | 'done' | 'failed' | 'aborted'
    },
  ): void {
    if (update.text !== undefined && update.appendText !== undefined) return
    const active = this.deps.registry.getActive()
    if (active === undefined || active.sessionId !== sessionId) return
    this.post({
      type: 'messages/patch',
      sessionId,
      messageId,
      ...update.text !== undefined ? { text: update.text } : {},
      ...update.appendText !== undefined ? { appendText: update.appendText } : {},
      ...update.incomplete !== undefined ? { incomplete: update.incomplete } : {},
      ...update.streaming !== undefined ? { streaming: update.streaming } : {},
      ...update.activityStatus !== undefined
        ? { activityStatus: update.activityStatus }
        : {},
    })
  }

  /**
   * Scroll/expand the message-attached change-list (AC-30 / AD-CCD-4).
   * @param sessionId - session id.
   * @param sourceMessageId - assistant anchor id.
   * @param messageId - optional change-list bubble id.
   */
  pushRevealChangeList(sessionId: string, sourceMessageId: string, messageId?: string): void {
    this.post({
      type: 'scroll/reveal-change-list',
      sessionId,
      sourceMessageId,
      ...messageId === undefined ? {} : { messageId },
    })
  }

  /**
   * Scroll to the source assistant message bubble (AC-19).
   * @param sessionId - session id.
   * @param sourceMessageId - assistant `data-message-id` to reveal.
   */
  pushRevealSource(sessionId: string, sourceMessageId: string): void {
    this.post({
      type: 'scroll/reveal-source',
      sessionId,
      sourceMessageId,
    })
  }

  /**
   * Broadcast theme kind class for Webview belt-and-suspenders refresh (AC-8a).
   * Does not push CSS variable tables — native `--vscode-*` remains primary (AD-CR-7).
   * @param themeKind - VS Code ColorTheme.kind label (e.g. light / dark / high-contrast).
   */
  pushThemeKind(themeKind: string): void {
    this.post({ type: 'ui/theme', themeKind })
  }

  /**
   * Refresh status/set for the active Tab (running / waiting / idle).
   */
  pushStatus(): void {
    const active = this.deps.registry.getActive()
    if (active === undefined) {
      this.post({
        type: 'status/set',
        status: this.deps.isHostReady() ? 'idle' : 'disconnected',
      })
      return
    }
    this.post({
      type: 'status/set',
      sessionId: active.sessionId,
      status: this.resolveStatus(active.sessionId, active.status),
    })
  }

  /**
   * Prefill the Conversation composer (selection ask / L2 hooks). AC-1.
   * When no Webview port is attached yet, buffers the latest text and replays
   * it on the next `attach()` so cold-start selection ask is not lost.
   * @param text - pointer text (no file body).
   */
  prefillComposer(text: string): void {
    if (this.port === undefined) {
      this.pendingPrefill = text
      return
    }
    this.pendingPrefill = undefined
    this.post({ type: 'composer/prefill', text })
  }

  /**
   * Host-gated send used by Webview composer/send and L2 `dsh.test.sendPrompt`.
   * Validates `@path` tokens without reading file contents into the prompt (AC-3).
   * @param text - raw composer text.
   * @returns accepted prompt ids or a reject reason (also posts ui/reject-send).
   */
  async sendPrompt(text: string): Promise<SendGateResult> {
    const trimmed = text.trim()
    if (trimmed === '') {
      return this.reject('empty')
    }
    if (!this.deps.isHostReady()) {
      return this.reject('no-host')
    }
    const active = this.deps.registry.getActive()
    if (active === undefined) {
      return this.reject('no-active')
    }
    if (active.mode === 'replay') {
      return this.reject('replay')
    }
    if (active.status === 'disconnected') {
      return this.reject('disconnected')
    }
    const atPathOptions = this.deps.getAtPathResolveOptions?.() ?? { workspaceFolders: [] }
    const atPath = validateComposerAtPaths(trimmed, atPathOptions)
    if (!atPath.ok) {
      this.pushBanner(atPathRejectBanner(atPath.reason, atPath.raw), 'at-path')
      return this.reject(atPath.reason)
    }
    try {
      // Pointer-only: acceptSend receives the original trimmed text (no body splice).
      const result = await this.deps.acceptSend(trimmed)
      return { ok: true, ...result }
    } catch {
      return this.reject('disconnected')
    }
  }

  /**
   * Handle an inbound Webview frame (also usable from L3 fakes without attach).
   * @param message - typed Webview→Host frame.
   */
  async handleWebviewMessage(message: WebviewToHostMessage): Promise<void> {
    await this.onWebviewMessage(message)
  }

  private async onWebviewMessage(message: WebviewToHostMessage): Promise<void> {
    if (message.type === 'ready') {
      this.pushFullState()
      return
    }
    if (message.type === 'composer/send') {
      await this.sendPrompt(message.text)
      return
    }
    if (message.type === 'action/delete') {
      await this.deps.requestDelete?.()
      return
    }
    if (message.type === 'action/continue') {
      await this.deps.requestContinue?.()
      return
    }
    if (message.type === 'action/stop') {
      await this.deps.requestStop?.()
      return
    }
    if (message.type === 'action/toggle-activity') {
      // Presentation-owned: Webview already toggled DOM + probes; Host acknowledges without reorder.
      return
    }
    if (message.type === 'action/new-conversation') {
      await this.deps.requestNewConversation?.()
      return
    }
    if (message.type === 'action/restore-more') {
      await this.deps.requestRestoreMore?.(message.all === true)
      return
    }
    if (message.type === 'action/retry-connect') {
      await this.deps.requestRetryConnect?.()
      return
    }
    if (message.type === 'action/open-settings') {
      await this.deps.requestOpenSettings?.()
      return
    }
    if (message.type === 'action/copy-code') {
      await this.deps.requestCopyCode?.(message.text)
      return
    }
    if (message.type === 'action/copy-message') {
      await this.deps.requestCopyMessage?.(message.messageId, message.text)
      return
    }
    if (message.type === 'action/retry') {
      await this.deps.requestRetry?.(message.messageId)
      return
    }
    if (message.type === 'action/edit-resend') {
      await this.deps.requestEditResend?.(message.messageId, message.text)
      return
    }
    if (message.type === 'action/branch') {
      await this.deps.requestBranch?.(message.turn)
      return
    }
    if (message.type === 'action/search-sessions') {
      const hits = await this.deps.requestSearchSessions?.({
        ...message.text === undefined ? {} : { text: message.text },
        ...message.path === undefined ? {} : { path: message.path },
      }) ?? []
      this.post({
        type: 'search/results',
        ...message.text === undefined ? {} : { text: message.text },
        ...message.path === undefined ? {} : { path: message.path },
        hits,
      })
      return
    }
    if (message.type === 'action/open-search-hit') {
      await this.deps.requestOpenSearchHit?.(message.sessionId)
      return
    }
    if (message.type === 'action/open-workspace-diffs') {
      await this.deps.requestOpenWorkspaceDiffs?.()
      return
    }
    if (message.type === 'action/reveal-change-list') {
      await this.deps.requestRevealChangeList?.(message.sourceMessageId)
      return
    }
    if (message.type === 'change/get-diff') {
      const result = await this.deps.requestChangeDiff?.(message.changeId)
      if (result === undefined) {
        this.post({
          type: 'change/diff-content',
          changeId: message.changeId,
          available: false,
          reason: 'no-handler',
        })
        return
      }
      this.post({ type: 'change/diff-content', ...result })
      return
    }
    if (message.type === 'change/open') {
      await this.deps.requestChangeOpen?.(message.changeId, message.path)
      return
    }
    if (message.type === 'change/open-native-diff') {
      await this.deps.requestChangeOpenNativeDiff?.(message.changeId)
      return
    }
    if (message.type === 'change/reveal-source') {
      await this.deps.requestRevealSource?.(message.sourceMessageId)
      return
    }
    if (message.type === 'change/mark-reviewed') {
      await this.deps.requestMarkReviewed?.(message.changeId)
      return
    }
    if (message.type === 'change/revert') {
      const result = await this.deps.requestRevert?.(message.changeId)
      this.post({
        type: 'change/revert-result',
        results: [result ?? { changeId: message.changeId, ok: false, reason: 'no-handler' }],
      })
      return
    }
    if (message.type === 'change/revert-many') {
      const results = await this.deps.requestRevertMany?.(message.changeIds)
      this.post({
        type: 'change/revert-result',
        results: results ?? message.changeIds.map(changeId => ({
          changeId,
          ok: false,
          reason: 'no-handler',
        })),
      })
      return
    }
    if (message.type === 'action/open-reference') {
      await this.deps.requestOpenReference?.(message.path)
      return
    }
    if (message.type === 'scroll/reveal') {
      const active = this.deps.registry.getActive()
      if (active === undefined || this.deps.resolveReveal === undefined) {
        this.post({
          type: 'scroll/reveal',
          sessionId: active?.sessionId ?? '',
          kind: 'none',
        })
        return
      }
      const target = this.deps.resolveReveal(message.callId)
      this.post({
        type: 'scroll/reveal',
        sessionId: target.sessionId,
        kind: target.kind,
        ...target.messageId === undefined ? {} : { messageId: target.messageId },
        ...target.label === undefined ? {} : { label: target.label },
      })
    }
  }

  private reject(reason: RejectSendReason): SendGateResult {
    this.post({ type: 'ui/reject-send', reason })
    return { ok: false, reason }
  }

  private resolveStatus(
    sessionId: string,
    tabStatus: 'idle' | 'running' | 'error' | 'disconnected',
  ): PanelStatus {
    if (!this.deps.isHostReady()) return 'disconnected'
    const pending = this.deps.interactions?.listPending() ?? []
    if (pending.some(item => item.sessionId === sessionId)) return 'waiting-interaction'
    if (tabStatus === 'running') return 'generating'
    if (tabStatus === 'disconnected') return 'disconnected'
    return 'idle'
  }

  private post(message: HostToWebviewMessage): void {
    this.outbound.push(message)
    this.port?.postMessage(message)
  }
}

function atPathRejectBanner(
  reason: 'not-found' | 'outside-workspace' | 'ambiguous-root',
  raw: string,
): string {
  if (reason === 'not-found') return `找不到引用路径：${raw}`
  if (reason === 'outside-workspace') return `引用路径不在工作区内：${raw}`
  return `引用路径在多个工作区根下歧义：${raw}`
}

/**
 * In-memory fake Webview for L3 protocol tests (no HTML/CSP).
 */
export class FakeWebviewPort implements WebviewMessagePort {
  readonly receivedFromHost: HostToWebviewMessage[] = []
  private readonly listeners = new Set<(message: unknown) => void>()

  /**
   * @param message - Host→Webview frame.
   */
  postMessage(message: unknown): void {
    this.receivedFromHost.push(message as HostToWebviewMessage)
  }

  /**
   * @param listener - Host inbound handler.
   * @returns disposer.
   */
  onDidReceiveMessage(listener: (message: unknown) => void): { dispose(): void } {
    this.listeners.add(listener)
    return {
      dispose: () => {
        this.listeners.delete(listener)
      },
    }
  }

  /**
   * Simulate Webview → Host postMessage.
   * @param message - Webview frame.
   */
  emitFromWebview(message: unknown): void {
    for (const listener of this.listeners) listener(message)
  }
}
