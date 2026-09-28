/**
 * Conversation panel Host: pushes protocol frames and gates composer/send (revised AD-CU-1 / AD-CUX-1).
 * Host owns decision state; Webview may hold probeable presentation state.
 * Works with a real WebviewView or an L3 fake Webview port.
 * @module @deepseek-ai/dsh-vscode-dsh/chat-panel/chat-panel-host
 */

import type { ChatMessage, CompactionMarker, MessageStore, WorkflowMarker } from '../message-store.ts'
import type { ConversationRegistry } from '../conversation-registry.ts'
import type { ExtensionIndex } from '../extension-index.ts'
import type { InteractionCoordinator } from '../interaction-coordinator.ts'
import type { ConnectionUiState } from '../connection-ui.ts'
import type { SettingsNamespaceView } from '../session-host.ts'
import {
  formatOfficialAtPath,
  resolveAtPathInWorkspace,
  validateComposerAtPaths,
  type ResolveAtPathOptions,
} from '../code-context/at-path.ts'
import {
  parseWebviewToHostMessage,
  type AtPathCandidate,
  type ConnectionPhase,
  type HostToWebviewMessage,
  type PanelBreadcrumb,
  type PanelMode,
  type PanelStatus,
  type PromptImage,
  type RejectSendReason,
  type SlashCandidate,
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
  /**
   * The line was consumed as a command: it never became a prompt, and its result
   * is projected as a local notice instead of a message.
   */
  | { ok: true; command: true; sessionId: string; tabId: string }
  | { ok: false; reason: RejectSendReason }

/** Most `/` menu rows one answer carries; a query narrows this set, never widens it. */
export const SLASH_MENU_LIMIT = 30

/**
 * The runtime's own slash grammar: a lowercase command name followed by the end of
 * the line or whitespace. Mirrors `ParseCommand` in `@deepseek-ai/dsh-commands`, so
 * a line this Host treats as a command is exactly one the registry can resolve.
 */
const COMMAND_LINE = /^\/([a-z][a-z0-9_-]*)(?=$|[\t\n\r ])/u

/**
 * Whether one composer line is a command candidate. A candidate still has to be
 * resolved by the runtime: an unresolved line stays on the prompt path.
 * @param text - trimmed composer text.
 */
export function isCommandLine(text: string): boolean {
  return COMMAND_LINE.test(text)
}

/**
 * Rank and cap the `/` menu rows for one query.
 * @param candidates - the session's settled catalog, already group-ordered.
 * @param query - text the user typed after the slash.
 * @returns rows whose name matches first, then rows matched by description.
 */
export function filterSlashCandidates(
  candidates: readonly SlashCandidate[],
  query: string,
): SlashCandidate[] {
  const needle = query.trim().toLowerCase()
  if (needle === '') return candidates.slice(0, SLASH_MENU_LIMIT)
  const ranked: Array<{ candidate: SlashCandidate; score: number }> = []
  for (const candidate of candidates) {
    const name = candidate.name.toLowerCase()
    const score = name.startsWith(needle)
      ? 3
      : name.includes(needle)
        ? 2
        : candidate.description.toLowerCase().includes(needle) ? 1 : 0
    if (score > 0) ranked.push({ candidate, score })
  }
  // Array.prototype.sort is stable, so equal scores keep the catalog's own order.
  ranked.sort((left, right) => right.score - left.score)
  return ranked.slice(0, SLASH_MENU_LIMIT).map(entry => entry.candidate)
}

/** One todo entry pushed via todo/state (feature: todo-panel). */
export type TodoStateItem = Extract<HostToWebviewMessage, { type: 'todo/state' }>['items'][number]

/** Model catalog + current selection pushed via model/state (feature: model-selector). */
export type ModelStatePayload = Omit<Extract<HostToWebviewMessage, { type: 'model/state' }>, 'type'>

/** Token usage pushed via token/status (feature: token-status). */
export type TokenStatusPayload = Omit<Extract<HostToWebviewMessage, { type: 'token/status' }>, 'type'>

/**
 * Host-decision projection for the active panel (phase-4 subagent context).
 * The panel projects either the Tab root session, or an in-panel child context.
 * Webview must mirror this projection — never derive it locally.
 */
export interface PanelProjection {
  /** Panel chrome mode for this projection. */
  mode: PanelMode
  /** Session id whose messages/status the panel displays. */
  sessionId: string
  /** Tab id owning the projection. */
  tabId: string
  /** Optional title for the projected session. */
  title?: string
  /** Effective child context id (differs from sessionId when projecting a child). */
  contextSessionId?: string
  /** Parent→child lineage chrome, when a child context is open. */
  breadcrumb?: PanelBreadcrumb
  /** Messages already scoped to the projected session. */
  messages: readonly ChatMessage[]
  /** Run status for the projected session (drives status/set resolution). */
  tabStatus: 'idle' | 'running' | 'error' | 'disconnected'
}

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
  acceptSend: (text: string, images?: PromptImage[]) => Promise<{ messageId: string; sessionId: string; tabId: string }>
  /**
   * Run one slash line as a command when the runtime's registry resolves it.
   *
   * The Extension owns the registry lookup, the execution, and the projected
   * result, because they need the runtime Host rather than the panel. `false`
   * leaves the line on the prompt path, which is where the runtime's own
   * `agent/pre-step` boundary reads a leading `/name` as a skill invocation.
   * @param sessionId - session that would receive the command.
   * @param line - complete composer line, e.g. `/feature add a tag filter`.
   * @returns whether the line was consumed as a command.
   */
  acceptCommand?: (sessionId: string, line: string) => Promise<boolean>
  /**
   * Read the `/` menu catalogs for one session: commands, agent presets, skills.
   * The Extension assembles them from the runtime and orders them by group.
   * @param sessionId - session whose composition scopes the catalogs.
   */
  readSlashCatalog?: (sessionId: string) => Promise<SlashCandidate[]>
  /** Optional delete action requested from the panel (may still native-confirm). */
  requestDelete?: () => Promise<void>
  /**
   * Webview-modal-confirmed delete (AD-ECP-6 / AC-60).
   * Must call deleteSession/deleteConversation with `{ confirmed: true }` — no second confirm.
   */
  requestDeleteConfirmed?: (sessionId: string) => Promise<void>
  /** Open Timeline view from overflow (AD-ECP-7). */
  requestOpenTimeline?: () => Promise<void>
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
   * Host-decision panel projection (phase-4 subagent context).
   * When omitted, the Host falls back to the active Tab root projection.
   */
  resolvePanelProjection?: () => PanelProjection | undefined
  /**
   * Resolve an in-panel approval (phase-5 panel interaction).
   * @param id - interaction correlation id.
   * @param outcome - user decision.
   */
  resolveApproval?: (id: string, outcome: 'allowed-once' | 'rejected' | 'cancelled') => void
  /**
   * Resolve an in-panel question (phase-5 panel interaction).
   * @param id - interaction correlation id.
   * @param answer - user answers.
   */
  resolveQuestion?: (id: string, answer: { answers: Array<{ id: string; selected: string[]; custom?: string }> }) => void
  /**
   * Dismiss an in-panel question with an error (phase-5 panel interaction).
   * @param id - interaction correlation id.
   * @param error - dismissal reason.
   */
  dismissQuestion?: (id: string, error: string) => void
  /**
   * Enter a subagent child session in-panel (phase-4).
   * @param childSessionId - child session id.
   */
  requestOpenSubagent?: (childSessionId: string) => Promise<unknown>
  /**
   * Leave the in-panel child context back to the Tab root (phase-4).
   */
  requestNavBack?: () => Promise<unknown>
  /**
   * Promote the in-panel child context into its own pinned Tab (phase-4).
   * @param childSessionId - child session id to pin.
   */
  requestPinSubagent?: (childSessionId: string) => Promise<unknown>
  /**
   * Optional Timeline/Diff review path for 「本回合改了 N 个文件」(AC-30 secondary).
   * Typically `dsh.reviewWorkspaceDiffs`.
   */
  requestOpenWorkspaceDiffs?: () => Promise<void>
  /**
   * Select a model via bridge RPC (model-selector feature).
   * @param provider - provider id.
   * @param model - model id.
   * @param reasoningEffort - optional reasoning effort level.
   */
  requestSelectModel?: (provider: string, model: string, reasoningEffort?: string) => Promise<void>
  /**
   * Model catalog + current selection for the model selector (feature: model-selector).
   * Resolves `undefined` when the bridge cannot list models (disconnected / runtime not ready).
   */
  requestModelList?: () => Promise<ModelStatePayload | undefined>
  /**
   * Redacted settings namespaces for the in-panel settings page (feature: settings-page).
   * Resolves `undefined` when no live Host can describe them; an absent or
   * not-yet-connected Host is reported that way rather than by a rejection.
   */
  requestSettingsDescribe?: () => Promise<SettingsNamespaceView[] | undefined>
  /**
   * Merge a patch into one settings namespace (feature: settings-page).
   * Resolves the whole namespace list after the write, or `undefined` when no
   * live Host could answer; a refusal the runtime reported rejects with its
   * message, which the panel surfaces as a banner.
   * @param ns - registered namespace key.
   * @param patch - fields to merge into the user section.
   * @param expectedRevision - revision the page read; omitted writes unconditionally.
   */
  requestSettingsUpdate?: (
    ns: string,
    patch: Record<string, unknown>,
    expectedRevision?: number,
  ) => Promise<SettingsNamespaceView[] | undefined>
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
  /**
   * Switch active Tab from in-panel chrome (AC-11).
   * @param tabId - Tab to activate.
   */
  requestSelectTab?: (tabId: string) => Promise<void>
  /**
   * Close a Tab from in-panel chrome (AC-13); Host owns confirm-running.
   * @param tabId - Tab to close.
   */
  requestCloseTab?: (tabId: string) => Promise<void>
  /**
   * Load history rows for the in-panel history window (AC-50a).
   */
  listHistoryRows?: () => Array<{
    sessionId: string
    title: string
    updatedAt: string
    previewOrPath: string
    parentTitle?: string
    continueHint?: string
  }>
  /**
   * Ranked workspace paths for one composer `@` query (feature: at-completion).
   * @param query - path text following `@` or `@"`.
   * @param signal - aborted when a newer query supersedes this one.
   */
  listAtPathCandidates?: (query: string, signal: AbortSignal) => Promise<readonly AtPathCandidate[]>
  /**
   * Open a history session (dedupe + replay; no auto-Start) — AC-52.
   * @param sessionId - history session id.
   */
  requestOpenHistorySession?: (sessionId: string) => Promise<void>
  /**
   * Optional search entry from chrome (P1: open command / banner; full search UI → P2).
   */
  requestOpenSearch?: () => Promise<void>
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
  /** Whether the in-panel history window is open (presentation request; Host owns rows). */
  private historyOpen = false
  private historyLoading = false
  /** Last render-state answer from the webview (DEBT-7). */
  private lastRenderState: { testIds: string[]; renderState: Record<string, boolean> } | undefined
  private renderStateResolvers: Array<(state: { testIds: string[]; renderState: Record<string, boolean> }) => void> = []
  /** Cancels the in-flight `@` candidate lookup when a newer query arrives. */
  private atQueryAbort: AbortController | undefined
  /**
   * Settled `/` menu catalog for one session. The composition that decides the
   * catalog is the session's, so a different active session refetches.
   */
  private slashCatalog: { sessionId: string; candidates: SlashCandidate[] } | undefined

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
      // Retract the connecting/progress banner: this channel never clears itself,
      // and the full state below omits `connectionMessage`, so a stale banner
      // would keep owning the panel status line after the connection is live.
      this.pushBanner('', 'connection-clear')
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
    const sub = port.onDidReceiveMessage((raw) => {
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
   * Push panel/state + messages/replace + status + tabs (+ history when open)
   * for the active Tab (or empty).
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
    this.pushTabsFrame()
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
      this.pushHistoryFrame()
      return
    }
    // AC-22 / R1: while Start is in flight, never project sendable `live`.
    // Phase-4: the projection may point at an in-panel child context (readonly-live / replay).
    const projection = this.deps.resolvePanelProjection?.()
    if (projection !== undefined) {
      const continueChrome = this.deps.resolveContinueChrome?.()
      const hostProbes = this.deps.resolveHostProbes?.()
      const forkParentTitle = this.deps.resolveForkParentTitle?.()
      this.post({
        type: 'panel/state',
        mode: projection.mode,
        sessionId: projection.sessionId,
        tabId: projection.tabId,
        ...projection.title === undefined ? {} : { title: projection.title },
        ...projection.contextSessionId === undefined
          ? {}
          : { contextSessionId: projection.contextSessionId },
        ...projection.breadcrumb === undefined ? {} : { breadcrumb: projection.breadcrumb },
        ...continueChrome === undefined ? {} : { continue: continueChrome },
        ...newConversationChrome,
        deferredRestoreCount: this.deps.resolveDeferredRestoreCount?.() ?? 0,
        ...connectionFields,
        ...forkParentTitle === undefined ? {} : { forkParentTitle },
        ...hostProbes === undefined ? {} : { probes: hostProbes },
      })
      this.post({
        type: 'messages/replace',
        sessionId: projection.sessionId,
        messages: projection.messages,
      })
      this.post({
        type: 'status/set',
        sessionId: projection.sessionId,
        status: this.resolveStatus(projection.sessionId, projection.tabStatus),
      })
      this.pushHistoryFrame()
      return
    }
    const mode: PanelMode = this.connectionPhase === 'connecting'
      ? 'waiting-host'
      : (active.mode === 'replay' ? 'replay' : 'live')
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
    this.pushHistoryFrame()
  }

  /** Push Registry projection for in-panel Tab chrome (AC-10 / AC-10c). */
  pushTabsFrame(): void {
    const snap = this.deps.registry.snapshot()
    this.post({
      type: 'panel/tabs',
      activeTabId: snap.activeTabId,
      tabs: snap.tabs.map(tab => ({
        tabId: tab.tabId,
        sessionId: tab.sessionId,
        title: tab.title?.trim() || tab.sessionId.slice(0, 8),
        status: tab.status,
        unread: tab.unread,
        approvalBadge: tab.approvalBadge,
        mode: tab.mode,
      })),

    })
  }

  /** Push history window frame (closed → empty rows; open → list or loading). */
  pushHistoryFrame(): void {
    if (!this.historyOpen) {
      this.post({
        type: 'panel/history',
        open: false,
        loading: false,
        rows: [],
      })
      return
    }
    if (this.historyLoading) {
      this.post({
        type: 'panel/history',
        open: true,
        loading: true,
        rows: [],
      })
      return
    }
    const rows = this.deps.listHistoryRows?.() ?? []
    this.post({
      type: 'panel/history',
      open: true,
      loading: false,
      rows,
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
   * Answer one composer `@` query with ranked workspace candidates.
   * A newer query aborts the one before it: the Webview keys answers by `requestId`, so an
   * abandoned list must not keep walking directories behind the caret.
   * @param requestId - correlation id echoed back to the Webview.
   * @param query - path text following `@` or `@"`.
   */
  private async answerAtQuery(requestId: string, query: string): Promise<void> {
    const list = this.deps.listAtPathCandidates
    if (list === undefined) return
    this.atQueryAbort?.abort()
    const controller = new AbortController()
    this.atQueryAbort = controller
    // A failed or superseded lookup is advisory: the composer keeps the typed text and the
    // next keystroke asks again, so an empty list is the whole answer owed here.
    const candidates = await list(query, controller.signal).catch(() => [])
    if (controller.signal.aborted) return
    this.post({ type: 'composer/at-candidates', requestId, candidates: [...candidates] })
  }

  /**
   * Answer one composer `/` query from the session's catalog.
   *
   * The catalog is read once per session and filtered per keystroke here, so typing
   * costs no runtime round trip. A read that fails answers empty: the slash line is
   * still text, and its prompt path stays available either way.
   * @param requestId - correlation id echoed back to the Webview.
   * @param query - text following the slash.
   */
  private async answerSlashQuery(requestId: string, query: string): Promise<void> {
    const read = this.deps.readSlashCatalog
    const sessionId = this.deps.registry.getActive()?.sessionId
    if (read === undefined || sessionId === undefined) {
      this.post({ type: 'composer/slash-candidates', requestId, candidates: [] })
      return
    }
    try {
      if (this.slashCatalog?.sessionId !== sessionId) {
        this.slashCatalog = { sessionId, candidates: await read(sessionId) }
      }
      const candidates = filterSlashCandidates(this.slashCatalog.candidates, query)
      this.post({ type: 'composer/slash-candidates', requestId, candidates })
    } catch {
      this.post({ type: 'composer/slash-candidates', requestId, candidates: [] })
    }
  }

  /**
   * Append `@` mentions for dropped filesystem paths and push the result back to the composer.
   * Paths resolve through the same workspace check as a typed `@` token, so a drop from
   * outside the workspace is ignored instead of becoming a mention the send gate rejects.
   * @param text - composer text the drop landed on.
   * @param paths - absolute filesystem paths from the drop payload.
   */
  private appendDroppedMentions(text: string, paths: readonly string[]): void {
    const options = this.deps.getAtPathResolveOptions?.()
    if (options === undefined) return
    const mentions: string[] = []
    for (const path of paths) {
      const resolved = resolveAtPathInWorkspace(path, options)
      if (!resolved.ok) continue
      const mention = formatOfficialAtPath(resolved.path)
      if (mention !== undefined) mentions.push(mention)
    }
    if (mentions.length === 0) return
    const base = text.trimEnd()
    this.prefillComposer(base === '' ? mentions.join(' ') : `${base} ${mentions.join(' ')}`)
  }

  /**
   * Push token usage status to the Webview.
   * @param status - token/status payload fields.
   */
  pushTokenStatus(status: TokenStatusPayload): void {
    this.post({ type: 'token/status', ...status })
  }

  /**
   * Push todo list state to the Webview.
   * @param sessionId - owning session.
   * @param items - current todo items (whole-list snapshot).
   */
  pushTodoState(sessionId: string, items: TodoStateItem[]): void {
    this.post({ type: 'todo/state', sessionId, items })
  }

  /**
   * Push the model catalog and current selection to the Webview.
   * @param state - providers + current selection from `model/list`.
   */
  pushModelState(state: ModelStatePayload): void {
    this.post({ type: 'model/state', ...state })
  }

  /**
   * Push the redacted settings namespaces to the Webview settings page.
   * @param namespaces - whole-list snapshot the runtime described.
   */
  pushSettingsState(namespaces: SettingsNamespaceView[]): void {
    this.post({ type: 'settings/state', namespaces })
  }

  /**
   * Push a single complete message append for the active session (live turn).
   * @param message - complete chat message.
   */
  pushAppend(message: ChatMessage): void {
    if (this.projectedSessionId() !== message.sessionId) return
    this.post({ type: 'messages/append', sessionId: message.sessionId, message })
  }

  /**
   * Push an incremental messages/patch for a stable bubble id (AD-CUX-10).
   * Rejects frames that include both `text` and `appendText`.
   * @param sessionId - SDK session identity.
   * @param messageId - stable bubble id.
   * @param update - text XOR appendText plus optional flags / marker merges.
   */
  pushPatch(
    sessionId: string,
    messageId: string,
    update: {
      text?: string
      appendText?: string
      appendReasoning?: string
      incomplete?: boolean
      streaming?: boolean
      activityStatus?: 'running' | 'done' | 'failed' | 'aborted'
      activityResultPreview?: string
      compaction?: Partial<CompactionMarker>
      workflow?: Partial<WorkflowMarker>
    },
  ): void {
    if (update.text !== undefined && update.appendText !== undefined) return
    if (this.projectedSessionId() !== sessionId) return
    this.post({
      type: 'messages/patch',
      sessionId,
      messageId,
      ...update.text !== undefined ? { text: update.text } : {},
      ...update.appendText !== undefined ? { appendText: update.appendText } : {},
      ...update.appendReasoning !== undefined ? { appendReasoning: update.appendReasoning } : {},
      ...update.incomplete !== undefined ? { incomplete: update.incomplete } : {},
      ...update.streaming !== undefined ? { streaming: update.streaming } : {},
      ...update.activityStatus !== undefined
        ? { activityStatus: update.activityStatus }
        : {},
      ...update.activityResultPreview !== undefined
        ? { activityResultPreview: update.activityResultPreview }
        : {},
      ...update.compaction !== undefined ? { compaction: update.compaction } : {},
      ...update.workflow !== undefined ? { workflow: update.workflow } : {},
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
   * Push an interaction (approval or question) to the Webview for in-panel presentation (phase-5).
   * @param interaction - typed interaction/present frame.
   */
  pushInteraction(interaction: Extract<HostToWebviewMessage, { type: 'interaction/present' }>): void {
    this.post(interaction)
  }

  /**
   * Resolve (remove) a previously presented interaction in the Webview (phase-5).
   * @param id - interaction correlation id.
   */
  resolveInteraction(id: string): void {
    this.post({ type: 'interaction/resolved', id })
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
    const projection = this.deps.resolvePanelProjection?.()
    if (projection !== undefined) {
      this.post({
        type: 'status/set',
        sessionId: projection.sessionId,
        status: this.resolveStatus(projection.sessionId, projection.tabStatus),
      })
      return
    }
    const active = this.deps.registry.getActive()
    if (active === undefined) {
      this.post({
        type: 'status/set',
        status: this.deps.isHostReady() ? 'idle' : 'disconnected',
      })
      return
    }
    const sessionId = active.contextSessionId ?? active.sessionId
    this.post({
      type: 'status/set',
      sessionId,
      status: this.resolveStatus(sessionId, active.status),
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
    const projection = this.deps.resolvePanelProjection?.()
    if (projection !== undefined) {
      if (projection.mode === 'replay') return this.reject('replay')
      // A running child session is read-only live: streaming is mirror-only (AC-71).
      if (projection.mode === 'readonly-live') return this.reject('readonly-live')
      if (projection.mode !== 'live') return this.reject('no-active')
    }
    const active = this.deps.registry.getActive()
    if (active === undefined) {
      return this.reject('no-active')
    }
    if (active.contextSessionId !== undefined) {
      // Fallback gate when no projection resolver is wired (L2 fixtures).
      return this.reject('readonly-live')
    }
    if (active.mode === 'replay') {
      return this.reject('replay')
    }
    if (active.status === 'disconnected') {
      return this.reject('disconnected')
    }
    // A command runs against the registry instead of the model, so it is decided
    // before the `@path` gate: a command's own arguments are free-form text.
    if (this.deps.acceptCommand !== undefined && isCommandLine(trimmed)) {
      let consumed = false
      try {
        consumed = await this.deps.acceptCommand(active.sessionId, trimmed)
      } catch {
        return this.reject('disconnected')
      }
      if (consumed) return { ok: true, command: true, sessionId: active.sessionId, tabId: active.tabId }
      // Not a command: the line keeps its prompt path, where the runtime's pre-step
      // boundary reads a leading `/name` as a skill invocation.
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
    if (message.type === 'probe/render-state') {
      this.lastRenderState = { testIds: message.testIds, renderState: message.renderState }
      const resolvers = this.renderStateResolvers.splice(0)
      for (const resolve of resolvers) resolve(this.lastRenderState)
      return
    }
    if (message.type === 'composer/at-query') {
      void this.answerAtQuery(message.requestId, message.query)
      return
    }
    if (message.type === 'composer/slash-query') {
      void this.answerSlashQuery(message.requestId, message.query)
      return
    }
    if (message.type === 'composer/drop-paths') {
      this.appendDroppedMentions(message.text, message.paths)
      return
    }
    if (message.type === 'ready') {
      this.pushFullState()
      // The catalog needs a bridge round-trip, so the mount path answers it after full state.
      void (async () => {
        const list = await this.deps.requestModelList?.()
        if (list !== undefined) this.pushModelState(list)
      })()
      // Same for the settings page, so it opens onto data instead of an empty form.
      void (async () => {
        const namespaces = await this.deps.requestSettingsDescribe?.()
        if (namespaces !== undefined) this.pushSettingsState(namespaces)
      })()
      return
    }
    if (message.type === 'composer/send') {
      await this.sendPrompt(message.text)
      return
    }
    if (message.type === 'ui/tab-select') {
      await this.deps.requestSelectTab?.(message.tabId)
      this.pushFullState()
      return
    }
    if (message.type === 'ui/tab-close') {
      await this.deps.requestCloseTab?.(message.tabId)
      this.pushFullState()
      return
    }
    if (message.type === 'ui/tab-new') {
      await this.deps.requestNewConversation?.()
      this.pushFullState()
      return
    }
    if (message.type === 'ui/history-open') {
      this.historyOpen = true
      this.historyLoading = true
      this.pushHistoryFrame()
      // Yield one tick so loading state is observable, then fill rows.
      this.historyLoading = false
      this.pushHistoryFrame()
      return
    }
    if (message.type === 'ui/history-close') {
      this.historyOpen = false
      this.historyLoading = false
      this.pushHistoryFrame()
      return
    }
    if (message.type === 'ui/history-select') {
      await this.deps.requestOpenHistorySession?.(message.sessionId)
      this.historyOpen = false
      this.pushFullState()
      return
    }
    if (message.type === 'ui/search-open') {
      await this.deps.requestOpenSearch?.()
      return
    }
    if (message.type === 'ui/delete-request') {
      await this.deps.requestDeleteConfirmed?.(message.sessionId)
      this.historyOpen = true
      this.pushHistoryFrame()
      this.pushFullState()
      return
    }
    if (message.type === 'ui/open-timeline') {
      await this.deps.requestOpenTimeline?.()
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
    if (message.type === 'nav/open-subagent') {
      await this.deps.requestOpenSubagent?.(message.childSessionId)
      return
    }
    if (message.type === 'nav/back') {
      await this.deps.requestNavBack?.()
      return
    }
    if (message.type === 'action/pin-subagent') {
      await this.deps.requestPinSubagent?.(message.childSessionId)
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
    if (message.type === 'action/select-model') {
      await this.deps.requestSelectModel?.(message.provider, message.model, message.reasoningEffort)
      return
    }
    if (message.type === 'settings/open') {
      const namespaces = await this.deps.requestSettingsDescribe?.()
      if (namespaces === undefined) {
        // An unanswered read must not clear the page with an empty list.
        this.pushBanner('设置暂不可用：Host 未就绪', 'settings')
        return
      }
      this.pushSettingsState(namespaces)
      return
    }
    if (message.type === 'settings/update') {
      let namespaces: SettingsNamespaceView[] | undefined
      try {
        namespaces = await this.deps.requestSettingsUpdate?.(
          message.ns,
          message.patch,
          message.expectedRevision,
        )
      } catch (error) {
        // The refusal text is what the page has to show — a stale-revision
        // conflict among them — and dropping the rejection would leave the
        // write looking pending.
        this.pushBanner(
          `设置保存失败：${error instanceof Error ? error.message : String(error)}`,
          'settings',
        )
        return
      }
      if (namespaces === undefined) {
        this.pushBanner('设置保存失败：Host 未就绪', 'settings')
        return
      }
      this.pushSettingsState(namespaces)
      return
    }
    if (message.type === 'action/compact') {
      void this.sendPrompt('/compact')
      return
    }
    if (message.type === 'composer/send-rich') {
      const images = message.images?.map(img => ({ data: img.data, mimeType: img.mimeType }))
      // A command is text-only on this bridge, so a slash line carrying attachments
      // cannot run as one. Saying so keeps the send honest: dropping the images
      // silently would look like the command had consumed them.
      if ((images?.length ?? 0) > 0 && isCommandLine(message.text.trim())) {
        this.pushBanner('命令不支持图片附件，已按普通消息发送', 'slash-command')
      }
      try {
        await this.deps.acceptSend(message.text, images)
      } catch {
        // fail-closed: send gate already validated; surface-level errors stay in the prompt path.
      }
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
    if (message.type === 'interaction/approve') {
      this.deps.resolveApproval?.(message.id, message.outcome)
      return
    }
    if (message.type === 'interaction/answer') {
      this.deps.resolveQuestion?.(message.id, message.answer)
      return
    }
    if (message.type === 'interaction/dismiss') {
      this.deps.dismissQuestion?.(message.id, message.error)
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

  /**
   * Session id the panel is currently projecting, accounting for in-panel child contexts.
   * @returns projected session id, or undefined when no active Tab.
   */
  private projectedSessionId(): string | undefined {
    const projection = this.deps.resolvePanelProjection?.()
    if (projection !== undefined) return projection.sessionId
    const active = this.deps.registry.getActive()
    if (active === undefined) return undefined
    return active.contextSessionId ?? active.sessionId
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

  /**
   * Ask the webview for its render state (DEBT-7). Resolves with the last
   * `probe/render-state` answer; rejects when no webview is attached or on timeout.
   * @param timeoutMs - how long to wait before failing closed.
   */
  queryWebviewRenderState(timeoutMs = 5000): Promise<{ testIds: string[]; renderState: Record<string, boolean> }> {
    return new Promise((resolve, reject) => {
      if (this.port === undefined) {
        reject(new Error('no-webview-attached'))
        return
      }
      const timerRef: { current: ReturnType<typeof setTimeout> | undefined } = { current: undefined }
      const onResponse = (state: { testIds: string[]; renderState: Record<string, boolean> }): void => {
        if (timerRef.current !== undefined) clearTimeout(timerRef.current)
        resolve(state)
      }
      this.renderStateResolvers.push(onResponse)
      timerRef.current = setTimeout(() => {
        const idx = this.renderStateResolvers.indexOf(onResponse)
        if (idx >= 0) this.renderStateResolvers.splice(idx, 1)
        reject(new Error('render-state-timeout'))
      }, timeoutMs)
      this.post({ type: 'probe/query-render-state' })
    })
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
