/**
 * Conversation controller: Tab registry + IdeSessionHost prompt routing,
 * recoverable close vs explicit delete (AD-CU-3), and MessageStore fan-out.
 * @module @deepseek-ai/dsh-vscode-dsh/conversation-controller
 */

import { randomUUID } from 'node:crypto'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { HarnessNotification, SdkPromptContentBlock } from '@deepseek-ai/dsh-sdk-client'
import type { BridgeApprovalPolicy, BridgeSessionSearchHit, BridgeSpecdevSnapshot } from '@deepseek-ai/dsh-ide-bridge'
import {
  ConversationRegistry,
  titleFromFirstMessage,
  type ConversationRegistrySnapshot,
  type ConversationTab,
} from './conversation-registry.ts'
import type { IdeSessionHost, PermissionPresetList, SubagentListResult } from './session-host.ts'
import { TimelineStore } from './timeline-store.ts'
import { MessageStore, type ChatMessage, type MessageImage, type MessagePatch } from './message-store.ts'
import {
  activityMessageId,
  activityStatusFromToolResult,
  toolResultText,
  type ActivityItem,
} from './chat-panel/activity-types.ts'
import { digestToolCall, previewToolResult } from './chat-panel/activity-digest.ts'
import {
  ExtensionIndex,
  type OpenTabMode,
  type OpenTabRecord,
  type WorkspaceStateLike,
} from './extension-index.ts'
import type {
  ChatPanelHost,
  PanelProjection,
  TodoStateItem,
  TokenStatusPayload,
} from './chat-panel/chat-panel-host.ts'
import type { PanelBreadcrumb, PanelMode, PanelSubagent, PromptImage } from './chat-panel/protocol.ts'
import {
  compactionMarkerMessage,
  compactionSummaryText,
  hydrateFromAuthoritativeLog,
  reasoningFromContent,
  textFromContent,
  toolRegistryChangeLabel,
  withWorkflowMember,
  workflowMarkerMessage,
  workflowMemberFrom,
  workflowOutcomeFrom,
  workflowStopReasonFrom,
  type HydratedMessageImages,
  type HydratorSessionEvent,
} from './replay-hydrator.ts'
import { planRestoreOpenTabs } from './restore-planner.ts'
import {
  T0B_GATE_VERDICT,
  continueChromeFor,
  probeContinueCapability,
  type ContinueCapability,
  type ContinueChrome,
} from './continue-capability.ts'
import {
  asForkLogEvents,
  buildForkResult,
  projectMessagesForForkSeed,
  resolveClosedTurnBoundary,
  type ForkOutcome,
  type ForkRequest,
  type ForkResult,
} from './fork/fork-orchestrator.ts'
import { EMPTY_LIVE_TITLE } from './conversation-titles.ts'
import {
  CHANGE_LIST_EMPTY_NOTICE,
  ChangeAttributor,
  ChangeStore,
  SnapshotStore,
  analyzeRevertGates,
  executeRevert,
  executeRevertMany,
  gateKey,
  readChangeIndex,
  writeChangeIndex,
  type IgnoreRulesOptions,
  type RevertGate,
  type RevertResult,
  type RevertWorkspace,
} from './change/index.ts'
import type { ChangeRecord } from './change/types.ts'
import {
  PathSessionIndex,
  searchSessions as runSessionSearch,
  type SearchHit,
  type SearchQuery,
} from './search/index.ts'

/** Outcome of opening a history session as replay (AC-30/64/65). */
export type OpenHistoryResult =
  | {
    outcome: 'opened' | 'activated'
    tabId: string
    sessionId: string
    mode: 'replay' | 'live'
    messageCount: number
  }
  | { outcome: 'host-not-ready'; sessionId: string }
  | { outcome: 'missing'; sessionId: string }
  | { outcome: 'error'; sessionId: string; error: string }

/** Result of I-真 cancel (AD-CUX-3 / AC-13 / AC-13d). */
export type CancelActiveTurnResult =
  | { ok: true }
  | { ok: false; error: string }

/** Result of product fork orchestration (AD-CUX-5). */
export type ForkFromClosedTurnResult = ForkOutcome

/** Outcome of restart restore orchestration (AC-33/34/69/70). */
export type RestoreOpenTabsResult =
  | {
    outcome: 'restored'
    hydrated: Array<{ tabId: string; sessionId: string; mode: 'replay'; messageCount: number }>
    deferredSessionIds: string[]
    strippedSessionIds: string[]
    activeSessionId?: string
    activeTabId?: string
  }
  | { outcome: 'waiting-host'; pendingSessionIds: string[] }
  | { outcome: 'empty' }

/** Outcome of Continue this session (AC-32/66/67/68 / AD-CU-8). */
export type ContinueConversationResult =
  | {
    outcome: 'continued'
    tabId: string
    sessionId: string
    mode: 'live'
    capability: ContinueCapability
    banner?: string
  }
  | { outcome: 'hidden' }
  | { outcome: 'disabled'; tooltip: string }
  | { outcome: 'host-not-ready' }
  | { outcome: 'missing' }
  | { outcome: 'error'; error: string }

/** Outcome of a close attempt that may need running confirmation. */
export type CloseConversationResult =
  | { outcome: 'closed'; tabId: string; sessionId: string; empty: boolean }
  | { outcome: 'needs-confirm-running'; tabId: string; sessionId: string }
  | { outcome: 'cancelled' }
  | { outcome: 'missing' }

/** Outcome of a delete attempt (AC-26/60/72/73). */
export type DeleteConversationResult =
  | {
    outcome: 'deleted'
    tabId: string
    sessionId: string
    /**
     * Runtime `session/delete` failure text. Present when the persisted log
     * survived an otherwise completed delete; the caller can surface it again.
     */
    deleteError?: string
  }
  | { outcome: 'needs-confirm'; tabId: string; sessionId: string; running: boolean }
  | { outcome: 'cancelled' }
  | { outcome: 'host-not-ready' }
  | { outcome: 'missing' }

/** Outcome of entering a subagent child context (AD-CU-11 / AC-35/37/78). */
export type OpenSubagentResult =
  | {
    outcome: 'opened-context' | 'activated-tab'
    childSessionId: string
    mode: PanelMode
    tabId: string
  }
  | { outcome: 'deleted'; childSessionId: string }
  | { outcome: 'missing' }
  | { outcome: 'host-not-ready' }

/** Outcome of pinning a subagent child into a Conversations Tab (AC-38/79). */
export type PinSubagentResult =
  | {
    outcome: 'pinned' | 'activated'
    childSessionId: string
    tabId: string
    parentTabId: string
  }
  | { outcome: 'deleted'; childSessionId: string }
  | { outcome: 'missing' }

/** Outcome of navigating back from an in-panel child context (AC-36/75). */
export type NavBackResult =
  | { outcome: 'restored' }
  | { outcome: 'disabled' }
  | { outcome: 'noop' }

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

/** Optional ChangeList / SnapshotStore wiring (phase-2). */
export interface ConversationChangeOptions {
  /** Extension-local SnapshotStore (defaults to tmpdir-based store for L2). */
  snapshotStore?: SnapshotStore
  /** Workspace text reader for full-file after-images (DEBT-CCD-001). */
  readWorkspaceText?: (path: string) => Promise<string | undefined>
  /** Ignore / workspace-root options (AD-CCD-8). */
  getIgnoreOptions?: () => IgnoreRulesOptions
}

/** Optional observability wiring for the panel's token ring (feature: token-status). */
export interface ConversationObservabilityOptions {
  /**
   * Compaction trigger ratio the runtime's `compaction-basic` settings declare, read
   * by the Extension. Omitted falls back to the panel's built-in default.
   */
  compactionThresholdRatio?: () => number | undefined
}

/** Route one session's last request used, as recorded by its `request/context` event. */
export interface SessionRequestRoute {
  /** Provider route the request used. */
  provider: string
  /** Provider-owned model the request used. */
  model: string
  /** Prompt capacity the runtime declared for the request, when it declared one. */
  contextWindow?: number
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
  /** Session-scoped attributed ChangeRecord index (phase-2). */
  readonly changes = new ChangeStore()
  /** Workspace index — immediate persist of openTabSet / activeSessionId. */
  readonly index: ExtensionIndex
  /** Tier-2 path→session reverse index (AD-CUX-9 / AC-51). */
  readonly pathSessionIndex: PathSessionIndex
  /** SnapshotStore + attribution pipeline (phase-2). */
  readonly attributor: ChangeAttributor
  private readonly snapshotStore: SnapshotStore
  private readWorkspaceText: (path: string) => Promise<string | undefined>
  private getIgnoreOptions: () => IgnoreRulesOptions
  private stopNotifications: (() => void) | undefined
  private panelHost: ChatPanelHost | undefined
  private stopRegistryWatch: (() => void) | undefined
  private stopMessageWatch: (() => void) | undefined
  private stopInteractionWatch: (() => void) | undefined
  /** Index rows pending 「查看更多」 hydrate after a capped restore. */
  private deferredRestore: OpenTabRecord[] = []
  /** True while restore was requested before Host was ready (AC-69). */
  private pendingRestoreLatch = false
  /** Suppress openTabSet writes while a restore mutation batch is in flight. */
  private openTabPersistSuspended = false
  /** Optional preloaded events for L2 restore / Continue tests. */
  private eventOverrides = new Map<string, readonly HydratorSessionEvent[]>()
  /** Optional resume stub for L2 Continue tests (bypasses bridge). */
  private resumeOverride: ((sessionId: string) => Promise<void>) | undefined
  /** Optional fork stub for L2 fork tests (bypasses bridge). */
  private forkOverride: ((
    parentSessionId: string,
    options?: { boundarySeq?: number; emptySeed?: boolean; childSessionId?: string },
  ) => Promise<string>) | undefined
  /** P-接续 E2: Continue sealed per parent session (GAP-CUX-002). */
  private continueSealedSessions = new Set<string>()
  /** P-接续 E2: parentReadonly probe per session. */
  private parentReadonlySessions = new Set<string>()
  private stopStatusWatch: (() => void) | undefined
  /** Dedup concurrent auto-restore from Host status transitions. */
  private restoreInFlight: Promise<RestoreOpenTabsResult> | undefined
  /** Child session run state for banner / readonly-live (no child Tab required). */
  private readonly childRunState = new Map<string, 'running' | 'ended'>()
  /**
   * Durable mode of each parent's subagent children, keyed by parent session
   * then child session. Only the runtime can classify a child as continuable,
   * so this cache is filled by `subagent/list` and decides whether the composer
   * may deliver a message into that child.
   */
  private readonly subagentCatalog = new Map<string, Map<string, { mode: 'one-shot' | 'continuable'; label?: string }>>()
  /** Parents with a `subagent/list` read in flight. */
  private readonly subagentCatalogRefreshes = new Set<string>()
  /**
   * Children the user dismissed from the panel's roster bar, keyed by the root
   * session that owns them. Dismissal only hides the bar row: the durable card
   * stays in the transcript, and a restarted child re-enters the roster.
   */
  private readonly dismissedSubagents = new Map<string, Set<string>>()
  /**
   * SpecDev status per session. The active workflow lives in the workspace's
   * `.specdev` layout, so this is read from the runtime rather than folded from
   * the log, and refreshed whenever the log reports a SpecDev event.
   */
  private readonly specdevBySession = new Map<string, BridgeSpecdevSnapshot | null>()
  /**
   * Latest out-of-workspace grant per session, folded from `specdev/scope-decided`.
   * The grant itself lives in the runtime's session scope, so the card shows the
   * event's own record instead of re-reading it.
   */
  private readonly specdevLastScope = new Map<string, { decision: 'once' | 'directory' | 'session'; paths: string[] }>()
  /** Sessions with a `specdev/snapshot` read in flight. */
  private readonly specdevRefreshes = new Set<string>()
  /** sessionId → turn awaiting assistant before settle. */
  private pendingSettleTurn = new Map<string, number>()
  /** Serialize per-session settle to keep last-assistant anchoring stable. */
  private settleChain = new Map<string, Promise<void>>()
  /** Live streaming assistant bubble id per session (stable across chunks). */
  private streamingAssistant = new Map<string, { messageId: string; turn?: number }>()
  /** Turn of each in-flight live stream attempt, so chunk frames tag their bubble. */
  private readonly streamAttemptTurns = new Map<string, number>()
  /** Duck-typed workspace write surface for revert (AD-CCD-10); set by extension / L2. */
  private revertWorkspace: RevertWorkspace | undefined
  /** Session-scoped latest `todo/write` snapshot (feature: todo-panel). */
  private readonly todoBySession = new Map<string, TodoStateItem[]>()
  /** Latest `token/status` payload pushed to the panel (feature: token-status). */
  private lastTokenPayload: TokenStatusPayload | undefined
  /** Sessions with a `contextPressure` read in flight (feature: token-status). */
  private readonly pressureRefresh = new Set<string>()
  /** Route each session's last request used, from its `request/context` event. */
  private readonly requestRouteBySession = new Map<string, SessionRequestRoute>()
  private readonly compactionThresholdRatio: () => number | undefined
  /** Sidebar refresh listeners notified after a todo snapshot lands (feature: todo-panel). */
  private readonly todoListeners = new Set<() => void>()

  /**
   * @param host - window-scoped ide process owner (one process, many sessionIds).
   * @param workspaceState - optional workspaceState for immediate index writes.
   * @param workspaceKey - workspace identity key for the index.
   * @param changeOptions - optional SnapshotStore / workspace readers.
   * @param observability - optional token-ring inputs read outside the session log.
   */
  constructor(
    private readonly host: IdeSessionHost,
    workspaceState?: WorkspaceStateLike,
    workspaceKey = '',
    changeOptions?: ConversationChangeOptions,
    observability?: ConversationObservabilityOptions,
  ) {
    this.index = new ExtensionIndex(workspaceKey, workspaceState)
    this.pathSessionIndex = new PathSessionIndex(workspaceKey, workspaceState)
    this.snapshotStore = changeOptions?.snapshotStore
      ?? new SnapshotStore({ storageRoot: join(tmpdir(), 'dsh-vscode-dsh-changes') })
    this.readWorkspaceText = changeOptions?.readWorkspaceText
      ?? (async () => undefined)
    this.getIgnoreOptions = changeOptions?.getIgnoreOptions
      ?? (() => ({ workspaceFolders: [] }))
    this.compactionThresholdRatio = observability?.compactionThresholdRatio ?? (() => undefined)
    this.attributor = new ChangeAttributor({
      changeStore: this.changes,
      snapshotStore: this.snapshotStore,
      getIgnoreOptions: () => this.getIgnoreOptions(),
      readWorkspaceText: path => this.readWorkspaceText(path),
    })
    this.host.setConversationRegistry?.(this.registry)
    this.stopNotifications = this.host.onNotification((notification) => {
      this.onSdkNotification(notification)
    })
    this.stopRegistryWatch = this.registry.onChange(() => {
      if (!this.openTabPersistSuspended) {
        this.persistOpenTabs()
        this.panelHost?.pushFullState()
      }
    })
    this.stopMessageWatch = this.messages.onChange(() => {
      if (!this.openTabPersistSuspended) {
        this.persistOpenTabs()
      }
    })
    if (typeof this.host.interactions.onChange === 'function') {
      this.stopInteractionWatch = this.host.interactions.onChange(() => {
        this.panelHost?.pushStatus()
      })
    }
    if (typeof this.host.onStatusChange === 'function') {
      this.stopStatusWatch = this.host.onStatusChange((status) => {
        if (status === 'connected' && this.pendingRestoreLatch) {
          void this.restoreOpenTabSet()
        }
        // AC-19: disconnect / Host error while streaming → fail-closed streaming false.
        if (status === 'error' || status === 'disconnected') {
          this.failClosedAllStreaming('Host 连接中断，流式已停止')
        }
      })
    }
  }

  /**
   * Reconfigure ChangeList workspace readers / storage (extension activate).
   * @param options - SnapshotStore root + ignore + file reader.
   */
  configureChanges(options: ConversationChangeOptions): void {
    if (options.readWorkspaceText !== undefined) this.readWorkspaceText = options.readWorkspaceText
    if (options.getIgnoreOptions !== undefined) this.getIgnoreOptions = options.getIgnoreOptions
  }

  /** SnapshotStore used by attribution (L2 / Host get-diff). */
  getChangeSnapshotStore(): SnapshotStore {
    return this.snapshotStore
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
    this.host.interactions.onActiveSessionChange?.(tab.sessionId)
    // Empty Tab: do not write openTabSet yet (AD-CU-3); persistOpenTabs filters.
    this.persistOpenTabs()
    return tab
  }

  /**
   * New or reuse **active empty** Tab only (AD-CR-6 / AC-6).
   * Never globally steals an inactive empty Tab via findEmptyLive.
   * @param title - title used when creating a new Tab.
   * @returns the focused empty Tab (existing active empty, or newly created).
   */
  newConversationOrReuseEmpty(title?: string): ConversationTab {
    const active = this.registry.getActive()
    if (active !== undefined && !this.messages.hasContent(active.sessionId)) {
      this.host.interactions.onActiveSessionChange?.(active.sessionId)
      this.panelHost?.pushFullState()
      return active
    }
    return this.newConversation(title ?? EMPTY_LIVE_TITLE)
  }

  /**
   * Switch the active Tab without changing the DSH process (AC-7 / AC-18 / AC-58).
   * Clears unread for the target (AC-57) and wakes approval queue soft-priority.
   * @param tabId - Tab to activate.
   */
  switchConversation(tabId: string): void {
    this.registry.switchTo(tabId)
    const active = this.registry.getActive()
    this.host.interactions.onActiveSessionChange?.(active?.sessionId)
    // The workspace's SpecDev workflow is session-independent, so a freshly
    // activated Tab shows it before its own log reports any SpecDev event.
    if (active !== undefined) void this.refreshSpecdev(active.sessionId)
    this.panelHost?.pushFullState()
  }

  /**
   * Open a workspace history session as a replay Tab (AC-30/64/65).
   * Reuses an existing open Tab by sessionId; otherwise mints a new tabId.
   * @param sessionId - session to open from the extension index / authority log.
   * @param options - optional preloaded events (tests) bypassing bridge read, and the
   *   display title the caller already knows — a runtime-listed session has no index row,
   *   so the index would otherwise record a generated `Replay …` title.
   */
  async openFromHistory(
    sessionId: string,
    options: { events?: readonly HydratorSessionEvent[]; title?: string } = {},
  ): Promise<OpenHistoryResult> {
    if (this.index.isDeleted(sessionId)) {
      return { outcome: 'missing', sessionId }
    }
    const existing = this.registry.getBySessionId(sessionId)
    if (existing !== undefined) {
      this.switchConversation(existing.tabId)
      return {
        outcome: 'activated',
        tabId: existing.tabId,
        sessionId,
        mode: existing.mode,
        messageCount: this.messages.get(sessionId).length,
      }
    }

    const indexRow = this.index.read().sessions.find(row => row.sessionId === sessionId && row.deleted !== true)
    const title = options.title
      ?? indexRow?.title
      ?? indexRow?.firstUserPreview
      ?? `Replay ${sessionId.slice(0, 8)}`

    let events: readonly HydratorSessionEvent[]
    if (options.events !== undefined) {
      events = options.events
    } else if (this.host.status !== 'connected' || typeof this.host.readSessionLog !== 'function') {
      return { outcome: 'host-not-ready', sessionId }
    } else {
      try {
        events = await this.host.readSessionLog(sessionId) as HydratorSessionEvent[]
      } catch (error) {
        // A log that refuses to read may simply be gone: another window (or the CLI)
        // can delete a session while this workspace keeps its index row. `stat`
        // separates that from a transient read failure so the stale row is tombstoned
        // instead of offering an open that can never succeed.
        if (await this.sessionDataGone(sessionId)) {
          this.index.markDeleted(sessionId)
          return { outcome: 'missing', sessionId }
        }
        return {
          outcome: 'error',
          sessionId,
          error: error instanceof Error ? error.message : String(error),
        }
      }
    }

    const tab = this.registry.create(title, sessionId, 'replay')
    this.host.interactions.onActiveSessionChange?.(tab.sessionId)
    void this.refreshSpecdev(sessionId)
    const hydrated = hydrateFromAuthoritativeLog(sessionId, events)
    this.messages.replace(sessionId, hydrated.messages)
    this.timeline.replace(sessionId, hydrated.timelineItems)
    await this.hydrateChangeListsFromIndex(sessionId)
    await this.hydrateMessageImages(sessionId, hydrated.pendingImages)
    const capability = this.resolveContinueCapability(sessionId, events.length > 0)
    this.index.upsertSession({
      sessionId,
      title,
      mtime: indexRow?.mtime ?? Date.now(),
      continueCapability: capability,
      ...indexRow?.firstUserPreview === undefined
        ? {}
        : { firstUserPreview: indexRow.firstUserPreview },
    })
    this.persistOpenTabs()
    this.panelHost?.pushFullState()
    return {
      outcome: 'opened',
      tabId: tab.tabId,
      sessionId,
      mode: 'replay',
      messageCount: hydrated.messages.length,
    }
  }

  /**
   * Restore persisted non-empty openTabSet after Host reconnect / restart (AC-33/34/69/70).
   * Always hydrates as `mode=replay`. Empty Tabs are stripped and written back immediately.
   * Transient `readSessionLog` failures keep the row in the index (deferred), never empty-strip.
   * AutoReady passes `markUnread: false` / `autoContinue: false` (AC-3); Continue is never invoked here.
   * @param options - optional event map for L2 tests; unread/Continue flags for AutoReady API.
   */
  async restoreOpenTabSet(options: {
    eventsBySession?: ReadonlyMap<string, readonly HydratorSessionEvent[]>
    /** When false (AutoReady), leave unread cleared; restore never marks unread today. */
    markUnread?: boolean
    /** When false (AutoReady), skip Continue; restore never auto-Continues. */
    autoContinue?: boolean
  } = {}): Promise<RestoreOpenTabsResult> {
    if (this.restoreInFlight !== undefined) {
      return this.restoreInFlight
    }
    this.restoreInFlight = this.restoreOpenTabSetBody(options)
    try {
      return await this.restoreInFlight
    } finally {
      this.restoreInFlight = undefined
    }
  }

  private async restoreOpenTabSetBody(options: {
    eventsBySession?: ReadonlyMap<string, readonly HydratorSessionEvent[]>
    markUnread?: boolean
    autoContinue?: boolean
  }): Promise<RestoreOpenTabsResult> {
    // AutoReady contract: never mark unread / never Continue from restore.
    void options.markUnread
    void options.autoContinue
    if (options.eventsBySession !== undefined) {
      for (const [sessionId, events] of options.eventsBySession) {
        this.eventOverrides.set(sessionId, events)
      }
    }

    const snap = this.index.read()
    const openTabSet = snap.openTabSet
    if (openTabSet.length === 0) {
      this.pendingRestoreLatch = false
      this.deferredRestore = []
      return { outcome: 'empty' }
    }

    if (this.host.status !== 'connected') {
      this.pendingRestoreLatch = true
      this.panelHost?.pushFullState()
      return {
        outcome: 'waiting-host',
        pendingSessionIds: openTabSet.map(tab => tab.sessionId),
      }
    }

    this.pendingRestoreLatch = false
    this.openTabPersistSuspended = true
    const hydrated: Array<{ tabId: string; sessionId: string; mode: 'replay'; messageCount: number }> = []
    let strippedSessionIds: string[] = []
    try {
      // Probe content for each persisted row (hydrate once into a cache).
      const contentCache = new Map<string, {
        events: readonly HydratorSessionEvent[]
        messages: ReturnType<typeof hydrateFromAuthoritativeLog>['messages']
        timeline: ReturnType<typeof hydrateFromAuthoritativeLog>['timelineItems']
        pendingImages: HydratedMessageImages[]
      }>()
      /** Sessions whose authoritative log could not be read this attempt (DEBT-006). */
      const loadFailed = new Set<string>()
      for (const tab of openTabSet) {
        if (contentCache.has(tab.sessionId) || loadFailed.has(tab.sessionId)) continue
        try {
          const events = await this.loadEvents(tab.sessionId)
          const hydratedLog = hydrateFromAuthoritativeLog(tab.sessionId, events)
          contentCache.set(tab.sessionId, {
            events,
            messages: hydratedLog.messages,
            timeline: hydratedLog.timelineItems,
            pendingImages: hydratedLog.pendingImages,
          })
        } catch {
          // Transient read failure: keep the index row; do not treat as empty strip.
          loadFailed.add(tab.sessionId)
        }
      }

      const plan = planRestoreOpenTabs(
        openTabSet,
        snap.activeSessionId,
        snap.ui.restoreUiLimit,
        (sessionId) => {
          if (loadFailed.has(sessionId)) return true
          const cached = contentCache.get(sessionId)
          // Notice-only incomplete markers still count as content; require user/assistant.
          return (cached?.messages.some(m => m.role === 'user' || m.role === 'assistant') ?? false)
        },
      )
      strippedSessionIds = plan.stripped.map(t => t.sessionId)

      // Failed reads stay in indexSet but cannot hydrate UI yet → move into deferred.
      const uiSet = plan.uiSet.filter(tab => !loadFailed.has(tab.sessionId))
      const deferred: OpenTabRecord[] = [
        ...plan.deferred,
        ...plan.uiSet.filter(tab => loadFailed.has(tab.sessionId)),
      ]
      // Refill UI slots from successful deferred rows (preserve active-first order already applied).
      const limit = Math.max(1, Math.floor(snap.ui.restoreUiLimit) || 8)
      while (uiSet.length < limit) {
        const idx = deferred.findIndex(tab => !loadFailed.has(tab.sessionId))
        if (idx < 0) break
        const row = deferred.splice(idx, 1)[0]
        if (row !== undefined) uiSet.push(row)
      }

      // Write-back sanitized index immediately (AD-CU-3/4): drop empties; force replay mode.
      // Includes deferred + load-failed rows (AC-70 / DEBT-003/006).
      this.index.setOpenTabs(plan.indexSet, snap.activeSessionId !== undefined
        && plan.indexSet.some(t => t.sessionId === snap.activeSessionId)
        ? snap.activeSessionId
        : plan.indexSet[0]?.sessionId)

      if (plan.indexSet.length === 0) {
        this.deferredRestore = []
        return { outcome: 'empty' }
      }

      // Unload any leftover Tabs before reopening as replay (cold restore).
      for (const tab of [...this.registry.list()]) {
        this.registry.close(tab.tabId)
      }

      // Seed deferred before UI creates so mid-batch persist (if any) keeps full index.
      this.deferredRestore = deferred.map(tab => ({ ...tab }))

      let activeTabId: string | undefined
      for (const record of uiSet) {
        const cached = contentCache.get(record.sessionId)
        if (cached === undefined) continue
        const title = record.title
          ?? this.index.read().sessions.find(s => s.sessionId === record.sessionId)?.title
          ?? `Replay ${record.sessionId.slice(0, 8)}`
        // AD-CU-5: cold restore mints a new tabId.
        const tab = this.registry.create(title, record.sessionId, 'replay')
        if (record.pinnedSubagent === true) {
          this.registry.setPinnedSubagent(tab.tabId, true)
        }
        this.messages.replace(record.sessionId, cached.messages)
        this.timeline.replace(record.sessionId, cached.timeline)
        // AC-22: cold restore must hydrate change-list path/stats like openFromHistory.
        await this.hydrateChangeListsFromIndex(record.sessionId)
        await this.hydrateMessageImages(record.sessionId, cached.pendingImages)
        const capability = this.resolveContinueCapability(record.sessionId, cached.events.length > 0)
        this.index.upsertSession({
          sessionId: record.sessionId,
          title,
          mtime: Date.now(),
          continueCapability: capability,
        })
        hydrated.push({
          tabId: tab.tabId,
          sessionId: record.sessionId,
          mode: 'replay',
          messageCount: cached.messages.length,
        })
        if (snap.activeSessionId === record.sessionId || activeTabId === undefined) {
          activeTabId = tab.tabId
        }
      }

      if (activeTabId !== undefined) {
        this.registry.switchTo(activeTabId)
        this.host.interactions.onActiveSessionChange?.(this.registry.getActive()?.sessionId)
      }
    } finally {
      this.openTabPersistSuspended = false
    }
    this.persistOpenTabs()
    this.panelHost?.pushFullState()
    const active = this.registry.getActive()
    if (hydrated.length === 0 && this.deferredRestore.length === 0) {
      return { outcome: 'empty' }
    }
    return {
      outcome: 'restored',
      hydrated,
      deferredSessionIds: this.deferredRestore.map(t => t.sessionId),
      strippedSessionIds,
      ...active === undefined
        ? {}
        : { activeSessionId: active.sessionId, activeTabId: active.tabId },
    }
  }

  /**
   * Hydrate additional deferred restore Tabs (「查看更多 / 全部恢复」, AC-70).
   * Non-success `openFromHistory` outcomes requeue the row so persistOpenTabs
   * cannot drop it from the durable openTabSet (DEBT-006 / restore-more path).
   * @param all - when true, hydrate every remaining deferred row; else one more.
   */
  async restoreMoreTabs(all = false): Promise<RestoreOpenTabsResult> {
    if (this.deferredRestore.length === 0) {
      const active = this.registry.getActive()
      return {
        outcome: 'restored',
        hydrated: [],
        deferredSessionIds: [],
        strippedSessionIds: [],
        ...active === undefined
          ? {}
          : { activeSessionId: active.sessionId, activeTabId: active.tabId },
      }
    }
    let take: OpenTabRecord[]
    if (all) {
      take = this.deferredRestore.splice(0)
    } else {
      const head = this.deferredRestore.shift()
      take = head === undefined ? [] : [head]
    }
    const hydrated: Array<{ tabId: string; sessionId: string; mode: 'replay'; messageCount: number }> = []
    for (const record of take) {
      if (this.registry.getBySessionId(record.sessionId) !== undefined) continue
      const overrideEvents = this.eventOverrides.get(record.sessionId)
      const opened = await this.openFromHistory(
        record.sessionId,
        overrideEvents === undefined ? {} : { events: overrideEvents },
      )
      if (opened.outcome === 'opened' || opened.outcome === 'activated') {
        if (record.pinnedSubagent === true) {
          const tab = this.registry.getBySessionId(record.sessionId)
          if (tab !== undefined) this.registry.setPinnedSubagent(tab.tabId, true)
        }
        hydrated.push({
          tabId: opened.tabId,
          sessionId: opened.sessionId,
          mode: 'replay',
          messageCount: opened.messageCount,
        })
      } else {
        // error / host-not-ready / missing: keep index via deferred merge in persistOpenTabs.
        this.deferredRestore.push({ ...record })
      }
    }
    this.persistOpenTabs()
    this.panelHost?.pushFullState()
    const active = this.registry.getActive()
    return {
      outcome: 'restored',
      hydrated,
      deferredSessionIds: this.deferredRestore.map(t => t.sessionId),
      strippedSessionIds: [],
      ...active === undefined
        ? {}
        : { activeSessionId: active.sessionId, activeTabId: active.tabId },
    }
  }

  /**
   * Continue the active (or given) replay Tab in-place to live (AC-32/66/68 / AD-CU-8).
   * same-id path: bridge `session/resume` → `setMode(live)` on the same tabId.
   * @param tabIdArg - optional Tab id; defaults to active.
   */
  async continueConversation(tabIdArg?: string): Promise<ContinueConversationResult> {
    if (T0B_GATE_VERDICT === 'FAIL') return { outcome: 'hidden' }
    const tab = tabIdArg === undefined
      ? this.registry.getActive()
      : this.registry.get(tabIdArg)
    if (tab === undefined) return { outcome: 'missing' }

    const chrome = this.continueChromeForTab(tab.tabId)
    if (chrome.visibility === 'hidden') return { outcome: 'hidden' }
    if (chrome.visibility === 'disabled') {
      return { outcome: 'disabled', tooltip: chrome.tooltip ?? '暂不可用' }
    }
    if (this.continueSealedSessions.has(tab.sessionId)) {
      return { outcome: 'disabled', tooltip: '父会话已接续分叉，Continue 已封印' }
    }
    if (this.host.status !== 'connected') return { outcome: 'host-not-ready' }

    const resumeSessionId = this.effectiveContinueSessionId(tab)
    try {
      if (this.resumeOverride !== undefined) {
        await this.resumeOverride(resumeSessionId)
      } else if (typeof this.host.resumeSession === 'function') {
        await this.host.resumeSession(resumeSessionId)
      } else {
        return { outcome: 'disabled', tooltip: '暂不可用' }
      }
    } catch (error) {
      return {
        outcome: 'error',
        error: error instanceof Error ? error.message : String(error),
      }
    }

    const capability = chrome.capability ?? 'same-id'
    let liveTab = tab
    if (tab.contextSessionId !== undefined) {
      // Promote context child into an editable live Tab (Continue implies live composer).
      const childId = tab.contextSessionId
      this.registry.setContextSessionId(tab.tabId, undefined)
      const existing = this.registry.getBySessionId(childId)
      if (existing === undefined) {
        liveTab = this.registry.create(
          this.index.read().sessions.find(s => s.sessionId === childId)?.title ?? 'Subagent',
          childId,
          'live',
        )
        this.registry.setPinnedSubagent(liveTab.tabId, true)
      } else {
        this.registry.setMode(existing.tabId, 'live')
        liveTab = existing
      }
      this.registry.switchTo(liveTab.tabId)
      this.host.interactions.onActiveSessionChange?.(liveTab.sessionId)
    } else {
      this.registry.setMode(tab.tabId, 'live')
    }

    this.index.upsertSession({
      sessionId: liveTab.sessionId,
      title: liveTab.title ?? `Conversation ${liveTab.sessionId.slice(0, 8)}`,
      mtime: Date.now(),
      continueCapability: capability,
    })
    this.persistOpenTabs()
    const banner = capability === 'derive-only'
      ? `新会话 · 接续自 ${resumeSessionId.slice(0, 8)}`
      : undefined
    if (banner !== undefined) {
      this.panelHost?.pushBanner(banner, 'continue-derive')
    }
    this.panelHost?.pushFullState()
    return {
      outcome: 'continued',
      tabId: liveTab.tabId,
      sessionId: liveTab.sessionId,
      mode: 'live',
      capability,
      ...banner === undefined ? {} : { banner },
    }
  }

  /**
   * Top-bar Continue chrome for the active Tab (AD-CU-8).
   * @param tabId - optional Tab; defaults to active.
   */
  continueChromeForTab(tabId?: string): ContinueChrome {
    if (T0B_GATE_VERDICT === 'FAIL') return { visibility: 'hidden' }
    const hostReady = this.host.status === 'connected'
    const tab = tabId === undefined ? this.registry.getActive() : this.registry.get(tabId)
    if (tab === undefined) {
      return continueChromeFor(T0B_GATE_VERDICT, 'unknown', { hostReady })
    }
    const effectiveSessionId = this.effectiveContinueSessionId(tab)
    const effectiveMode = this.effectiveContinueMode(tab)
    if (effectiveMode !== 'replay') {
      return continueChromeFor(T0B_GATE_VERDICT, 'unknown', {
        mode: 'live',
        hostReady,
        continueSealed: this.continueSealedSessions.has(effectiveSessionId),
      })
    }
    const row = this.index.read().sessions.find(s => s.sessionId === effectiveSessionId)
    const capability = row?.continueCapability
      ?? this.resolveContinueCapability(
        effectiveSessionId,
        this.messages.hasContent(effectiveSessionId),
      )
    return continueChromeFor(T0B_GATE_VERDICT, capability, {
      mode: 'replay',
      hostReady,
      continueSealed: this.continueSealedSessions.has(effectiveSessionId),
    })
  }

  /**
   * I-真 cancel for the active (or specified) live session (AD-CUX-3 / AC-13).
   * Failures/timeouts surface via banner and do not claim frontend-only stop (AC-13d).
   * @param sessionId - optional session; defaults to active Tab.
   */
  async cancelActiveTurn(sessionId?: string): Promise<CancelActiveTurnResult> {
    const tab = sessionId === undefined
      ? this.registry.getActive()
      : this.registry.getBySessionId(sessionId)
    if (tab === undefined) {
      const error = '没有活动会话可中断'
      this.panelHost?.pushBanner(error, 'cancel-failed')
      return { ok: false, error }
    }
    if (typeof this.host.cancelSession !== 'function') {
      const error = 'Host 不支持 session/cancel'
      this.panelHost?.pushBanner(`中断失败：${error}`, 'cancel-failed')
      return { ok: false, error }
    }
    try {
      await this.host.cancelSession(tab.sessionId)
      // Streaming settles when live turn/end aborted arrives; do not force follow reset.
      return { ok: true }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      this.panelHost?.pushBanner(`中断失败：${message}`, 'cancel-failed')
      // Do not mark incomplete or claim success — agent may still be running.
      return { ok: false, error: message }
    }
  }

  /**
   * Fork at a validated closed turn: retry/edit → P-接续 + E2; branch → P-标明 (AD-CUX-5).
   * Product rejects aborted/open/running before calling core/SDK fork (AC-34/61 / P2-1).
   * Does not reuse `continueConversation` on the parent id (AC-66).
   * @param req - fork request.
   */
  async forkFromClosedTurn(req: ForkRequest): Promise<ForkFromClosedTurnResult> {
    const parentTab = this.registry.getBySessionId(req.parentSessionId)
    if (parentTab === undefined) {
      const reject = {
        ok: false as const,
        error: '父会话 Tab 不存在',
        reason: 'invalid-boundary' as const,
      }
      this.panelHost?.pushBanner(reject.error, 'fork-rejected')
      return reject
    }
    if (parentTab.status === 'running') {
      const reject = {
        ok: false as const,
        error: '父会话仍在生成中，请先停止后再重试/分叉',
        reason: 'parent-running' as const,
      }
      this.panelHost?.pushBanner(reject.error, 'fork-rejected')
      return reject
    }

    const events = await this.loadForkEvents(req.parentSessionId)
    const resolved = resolveClosedTurnBoundary(asForkLogEvents(events), req.boundary)
    if (!resolved.ok) {
      this.panelHost?.pushBanner(resolved.error, 'fork-rejected')
      return resolved
    }

    let promptText = resolved.userText
    if (req.intent === 'edit-resend') {
      promptText = req.editedText ?? resolved.userText
    }
    if (req.intent === 'retry' || req.intent === 'edit-resend') {
      const prior = findPriorClosedBoundary(asForkLogEvents(events), resolved.turn)
      const forkOpts = prior === undefined
        ? { emptySeed: true as const }
        : { boundarySeq: prior.boundarySeq }
      const childSessionId = await this.invokeFork(req.parentSessionId, forkOpts)
      if (typeof childSessionId !== 'string') {
        this.panelHost?.pushBanner(childSessionId.error, 'fork-failed')
        return { ok: false, error: childSessionId.error, reason: 'host-unavailable' }
      }
      const seedCut = prior === undefined
        ? { emptySeed: true as const }
        : { boundarySeq: prior.boundarySeq, seedMaxTurn: prior.turn }
      const result = buildForkResult(req, childSessionId, seedCut, promptText)
      this.applyContinueSwitch(parentTab.tabId, result)
      if (result.promptText !== undefined && result.promptText !== '') {
        const childTab = this.registry.getBySessionId(childSessionId)
        if (childTab !== undefined) {
          try {
            await this.promptTab(childTab.tabId, result.promptText)
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error)
            this.panelHost?.pushBanner(`分叉成功但自动重发失败：${message}`, 'fork-prompt-failed')
          }
        }
      }
      return result
    }

    const childSessionId = await this.invokeFork(req.parentSessionId, {
      boundarySeq: resolved.boundarySeq,
    })
    if (typeof childSessionId !== 'string') {
      this.panelHost?.pushBanner(childSessionId.error, 'fork-failed')
      return { ok: false, error: childSessionId.error, reason: 'host-unavailable' }
    }
    const result = buildForkResult(
      req,
      childSessionId,
      { boundarySeq: resolved.boundarySeq, seedMaxTurn: resolved.turn },
      undefined,
    )
    this.applyBranchMark(parentTab.tabId, result)
    return result
  }

  /**
   * P-接续: open child Tab as active live; force parent mode→replay + E2 seal (AC-31/31b/66).
   * @param parentTabId - parent Tab id.
   * @param child - successful fork result.
   */
  applyContinueSwitch(parentTabId: string, child: ForkResult): void {
    const parent = this.registry.get(parentTabId)
    if (parent === undefined) return
    const parentTitle = parent.title ?? `Conversation ${parent.sessionId.slice(0, 8)}`
    const forkLabel = `派生自 ${parentTitle}`
    this.registry.setMode(parentTabId, 'replay')
    this.continueSealedSessions.add(parent.sessionId)
    this.parentReadonlySessions.add(parent.sessionId)
    this.index.upsertSession({
      sessionId: parent.sessionId,
      title: parentTitle,
      mtime: Date.now(),
      continueCapability: 'same-id',
    })
    const parentMessages = this.messages.get(parent.sessionId)
    this.messages.replace(
      child.childSessionId,
      projectMessagesForForkSeed(parentMessages, child.childSessionId, child.seedMaxTurn),
    )
    const childTab = this.registry.create(forkLabel, child.childSessionId, 'live')
    this.index.upsertSession({
      sessionId: child.childSessionId,
      title: forkLabel,
      mtime: Date.now(),
      parentSessionId: parent.sessionId,
      forkLabel,
      continueCapability: 'same-id',
    })
    this.registry.switchTo(childTab.tabId)
    this.persistOpenTabs()
    this.panelHost?.pushBanner(`已接续到新会话 · ${forkLabel}`, 'fork-continue-switch')
    this.panelHost?.pushFullState()
  }

  /**
   * P-标明: open child Tab; parent mode / Continue unchanged (AC-60/62/63).
   * @param parentTabId - parent Tab id.
   * @param child - successful fork result.
   */
  applyBranchMark(parentTabId: string, child: ForkResult): void {
    const parent = this.registry.get(parentTabId)
    if (parent === undefined) return
    const parentMode = parent.mode
    const parentTitle = parent.title ?? `Conversation ${parent.sessionId.slice(0, 8)}`
    const forkLabel = `派生自 ${parentTitle}`
    const parentMessages = this.messages.get(parent.sessionId)
    this.messages.replace(
      child.childSessionId,
      projectMessagesForForkSeed(parentMessages, child.childSessionId, child.seedMaxTurn),
    )
    const childTab = this.registry.create(forkLabel, child.childSessionId, 'live')
    this.index.upsertSession({
      sessionId: child.childSessionId,
      title: forkLabel,
      mtime: Date.now(),
      parentSessionId: parent.sessionId,
      forkLabel,
      continueCapability: 'same-id',
    })
    if (parent.mode !== parentMode) {
      this.registry.setMode(parentTabId, parentMode)
    }
    this.registry.switchTo(childTab.tabId)
    this.persistOpenTabs()
    this.panelHost?.pushBanner(`已分叉新会话 · ${forkLabel}`, 'fork-branch-mark')
    this.panelHost?.pushFullState()
  }

  /**
   * Host decision probes for the active Tab (GAP-CUX-002 / AC-31b).
   */
  hostProbesForActive(): { parentReadonly?: boolean; continueSealed?: boolean } | undefined {
    const active = this.registry.getActive()
    if (active === undefined) return undefined
    const parentReadonly = this.parentReadonlySessions.has(active.sessionId)
    const continueSealed = this.continueSealedSessions.has(active.sessionId)
    if (!parentReadonly && !continueSealed) return undefined
    return {
      ...parentReadonly ? { parentReadonly: true } : {},
      ...continueSealed ? { continueSealed: true } : {},
    }
  }

  /**
   * Fork parent title for active child Tab chrome (AC-63).
   */
  forkParentTitleForActive(): string | undefined {
    const active = this.registry.getActive()
    if (active === undefined) return undefined
    return this.parentLineageLabel(active.sessionId)
  }

  /**
   * Lineage label of the session one Tab is derived from — a fork parent or a
   * subagent parent, both of which the session index records as `parentSessionId`.
   * @param sessionId - session the Tab is bound to.
   * @returns parent title (or its short id), or undefined for a root session.
   */
  parentLineageLabel(sessionId: string): string | undefined {
    const index = this.index.read()
    const row = index.sessions.find(s => s.sessionId === sessionId)
    if (row?.parentSessionId === undefined) return undefined
    const parent = index.sessions.find(s => s.sessionId === row.parentSessionId)
    return parent?.title ?? row.forkLabel ?? row.parentSessionId.slice(0, 8)
  }

  /**
   * Resolve fork boundary from a projected message id (retry / edit-resend).
   * @param sessionId - parent session.
   * @param messageId - bubble id.
   */
  resolveBoundaryFromMessage(
    sessionId: string,
    messageId: string,
  ): { ok: true; boundary: ForkRequest['boundary']; userText?: string } | { ok: false; error: string } {
    const messages = this.messages.get(sessionId)
    const target = messages.find(m => m.id === messageId)
    if (target === undefined) {
      return { ok: false, error: '找不到要重试/编辑的消息' }
    }
    if (target.incomplete === true) {
      return { ok: false, error: '未完成/已中断的回合不能重试或分叉' }
    }
    const turn = target.turn
    if (typeof turn === 'number') {
      return {
        ok: true,
        boundary: { kind: 'closed-turn', turn },
        ...target.role === 'user' ? { userText: target.text } : {},
      }
    }
    let inferredTurn: number | undefined
    let userText: string | undefined
    for (const m of messages) {
      if (m.id === messageId) break
      if (typeof m.turn === 'number') inferredTurn = m.turn
      if (m.role === 'user') userText = m.text
    }
    if (target.role === 'user') userText = target.text
    if (inferredTurn === undefined) {
      for (let i = messages.length - 1; i >= 0; i -= 1) {
        const message = messages[i]
        if (message !== undefined && typeof message.turn === 'number') {
          inferredTurn = message.turn
          break
        }
      }
    }
    if (inferredTurn === undefined) {
      return { ok: false, error: '无法将消息映射到已关闭回合' }
    }
    return {
      ok: true,
      boundary: { kind: 'closed-turn', turn: inferredTurn },
      ...userText === undefined ? {} : { userText },
    }
  }

  private async invokeFork(
    parentSessionId: string,
    options?: { boundarySeq?: number; emptySeed?: boolean; childSessionId?: string },
  ): Promise<string | { error: string }> {
    try {
      if (this.forkOverride !== undefined) {
        return await this.forkOverride(parentSessionId, options)
      }
      if (typeof this.host.forkSession !== 'function') {
        return { error: 'Host 不支持 session/fork' }
      }
      return await this.host.forkSession(parentSessionId, options)
    } catch (error) {
      return { error: error instanceof Error ? error.message : String(error) }
    }
  }

  private async loadForkEvents(sessionId: string): Promise<HydratorSessionEvent[]> {
    const override = this.eventOverrides.get(sessionId)
    if (override !== undefined) return [...override]
    if (typeof this.host.readSessionLog === 'function') {
      try {
        const events = await this.host.readSessionLog(sessionId)
        return events as HydratorSessionEvent[]
      } catch {
        // Fall through to message-derived synthetic log.
      }
    }
    return synthesizeEventsFromMessages(this.messages.get(sessionId))
  }

  /**
   * Install L2 test overrides for resume / event loads (does not change product semantics).
   * @param options - optional resume stub and event map.
   */
  installTestHooks(options: {
    resumeSession?: (sessionId: string) => Promise<void>
    forkSession?: (
      parentSessionId: string,
      options?: { boundarySeq?: number; emptySeed?: boolean; childSessionId?: string },
    ) => Promise<string>
    eventsBySession?: ReadonlyMap<string, readonly HydratorSessionEvent[]>
  }): void {
    if (options.resumeSession !== undefined) this.resumeOverride = options.resumeSession
    if (options.forkSession !== undefined) this.forkOverride = options.forkSession
    if (options.eventsBySession !== undefined) {
      for (const [id, events] of options.eventsBySession) this.eventOverrides.set(id, events)
    }
  }

  /**
   * Inject a complete assistant message into an open session (L2 unread tests).
   * Marks unread when the target Tab is not active (AC-19).
   * @param sessionId - target session.
   * @param text - assistant text.
   */
  injectAssistantMessage(sessionId: string, text: string): void {
    const tab = this.registry.getBySessionId(sessionId)
    if (tab === undefined) throw new Error(`unknown session: ${sessionId}`)
    this.projectAssistantMessage(sessionId, text, undefined)
    const active = this.registry.getActive()
    if (active === undefined || active.sessionId !== sessionId) {
      this.registry.setUnread(tab.tabId, true)
    }
  }

  /**
   * Await pending ChangeList settles (L2 tests after SDK notify / inject).
   * @param sessionId - optional session; omit to flush all.
   */
  async flushChangeSettles(sessionId?: string): Promise<void> {
    if (sessionId !== undefined) {
      await this.settleChain.get(sessionId)
      return
    }
    await Promise.all([...this.settleChain.values()])
  }

  /**
   * L2: seed full-file before-image for DEBT-CCD-001 without a tool/call event.
   * @param sessionId - session id.
   * @param path - workspace path.
   * @param before - full-file before (null = missing).
   */
  seedChangeBefore(sessionId: string, path: string, before: string | null): void {
    this.attributor.seedBeforeCache(sessionId, path, before)
  }

  /**
   * Mark a change as reviewed without any workspace write (AC-11).
   * @param changeId - ChangeRecord id.
   */
  async markChangeReviewed(
    changeId: string,
  ): Promise<{ ok: true; changeId: string } | { ok: false; changeId: string; reason: string }> {
    const record = this.changes.getById(changeId)
    if (record === undefined) return { ok: false, changeId, reason: 'change-not-found' }
    if (record.status === 'reverted') {
      return { ok: false, changeId, reason: 'already-reverted' }
    }
    const updated = this.changes.updateStatus(changeId, 'reviewed')
    if (updated === undefined) return { ok: false, changeId, reason: 'change-not-found' }
    this.messages.patchChangeStatus(updated.sessionId, changeId, 'reviewed')
    await this.persistChangeIndex(updated.sessionId)
    this.panelHost?.pushFullState()
    return { ok: true, changeId }
  }

  /**
   * Analyze revert gates for Host confirm UX (AC-14/15/17, AD-CCD-10).
   * @param changeId - ChangeRecord id.
   */
  async analyzeChangeRevertGates(changeId: string): Promise<
    { record: ChangeRecord; gates: RevertGate[] } | { error: string; changeId: string }
  > {
    return analyzeRevertGates({
      changeStore: this.changes,
      snapshotStore: this.snapshotStore,
      workspace: this.requireRevertWorkspace(),
    }, changeId)
  }

  /**
   * Revert one change after Host confirmations (AC-13).
   * @param changeId - ChangeRecord id.
   * @param options - confirmed gates + optional skipWrite for L2.
   */
  async revertChange(
    changeId: string,
    options: {
      confirmedGates?: ReadonlySet<string>
      confirmGate?: (gate: RevertGate) => Promise<boolean>
      skipWrite?: boolean
    } = {},
  ): Promise<RevertResult> {
    const deps = {
      changeStore: this.changes,
      snapshotStore: this.snapshotStore,
      workspace: this.requireRevertWorkspace(),
    }
    const analyzed = await analyzeRevertGates(deps, changeId)
    if ('error' in analyzed) {
      return { ok: false, changeId, reason: analyzed.error }
    }
    const confirmed = options.confirmedGates ?? new Set<string>()
    for (const gate of analyzed.gates) {
      const key = gateKey(gate)
      if (confirmed.has(key)) continue
      if (options.confirmGate !== undefined) {
        const ok = await options.confirmGate(gate)
        if (!ok) return { ok: false, changeId, reason: 'cancelled', cancelled: true }
        continue
      }
      return { ok: false, changeId, reason: 'gates-unconfirmed' }
    }
    const result = await executeRevert(deps, changeId, {
      ...(options.skipWrite === undefined ? {} : { skipWrite: options.skipWrite }),
    })
    if (result.ok) {
      const rec = this.changes.getById(changeId)
      if (rec !== undefined) {
        this.messages.patchChangeStatus(rec.sessionId, changeId, 'reverted')
        await this.persistChangeIndex(rec.sessionId)
        this.panelHost?.pushFullState()
      }
    }
    return result
  }

  /**
   * Batch revert with per-file results (AC-18) and turn-DESC same-path order (AD-CCD-10).
   * @param changeIds - ChangeRecord ids.
   * @param options - confirms + write control.
   */
  async revertChanges(
    changeIds: readonly string[],
    options: {
      confirmedGates?: ReadonlySet<string>
      confirmGate?: (gate: RevertGate) => Promise<boolean>
      skipWrite?: boolean
    } = {},
  ): Promise<RevertResult[]> {
    const deps = {
      changeStore: this.changes,
      snapshotStore: this.snapshotStore,
      workspace: this.requireRevertWorkspace(),
    }
    const results = await executeRevertMany(deps, changeIds, {
      confirmedGates: options.confirmedGates ?? new Set(),
      ...options.confirmGate === undefined ? {} : { confirmGate: options.confirmGate },
      ...options.skipWrite === undefined ? {} : { skipWrite: options.skipWrite },
    })
    const sessions = new Set<string>()
    for (const result of results) {
      if (!result.ok) continue
      const rec = this.changes.getById(result.changeId)
      if (rec === undefined) continue
      this.messages.patchChangeStatus(rec.sessionId, result.changeId, 'reverted')
      sessions.add(rec.sessionId)
    }
    for (const sessionId of sessions) {
      await this.persistChangeIndex(sessionId)
    }
    if (sessions.size > 0) this.panelHost?.pushFullState()
    return results
  }

  /**
   * Inject a RevertWorkspace for L2 tests / extension wiring (AD-CCD-10).
   * @param workspace - duck-typed write surface.
   */
  setRevertWorkspace(workspace: RevertWorkspace | undefined): void {
    this.revertWorkspace = workspace
  }

  /**
   * Soft-budget prune preferring fully-reverted sessions (AD-CCD-6).
   * Protects openTabSet / in-memory Tabs that still have unreverted changes.
   */
  async pruneChangeSnapshots(options?: {
    /** Override soft budget (tests). */
    byteBudgetSoft?: number
  }): Promise<{ prunedSessions: string[] }> {
    const openIds = new Set<string>([
      ...this.registry.list().map(tab => tab.sessionId),
      ...this.index.read().openTabSet.map(tab => tab.sessionId),
    ])
    return this.snapshotStore.pruneToBudget({
      isSessionFullyReverted: id => this.changes.isSessionFullyReverted(id),
      isSessionProtected: id => openIds.has(id) && !this.changes.isSessionFullyReverted(id),
      ...options?.byteBudgetSoft === undefined ? {} : { byteBudgetSoft: options.byteBudgetSoft },
    })
  }

  private requireRevertWorkspace(): RevertWorkspace {
    if (this.revertWorkspace === undefined) {
      throw new Error('revert-workspace-not-configured')
    }
    return this.revertWorkspace
  }

  private async persistChangeIndex(sessionId: string): Promise<void> {
    const records = this.changes.list(sessionId)
    await writeChangeIndex(
      this.snapshotStore.storageRoot,
      sessionId,
      records,
    )
    // AC-51: keep path→session reverse index in sync with Change metadata writes.
    this.pathSessionIndex.replaceSessionPaths(
      sessionId,
      records.map(r => r.path),
    )
  }

  /**
   * Search sessions via tier 1 (title/preview) and/or tier 2 (path→session).
   * Never scans message bodies or authority JSONL (AC-50/51/53).
   * @param query - text and/or path fragments.
   */
  searchSessions(query: SearchQuery): SearchHit[] {
    return runSessionSearch(this.index, this.pathSessionIndex, query)
  }

  /**
   * Search indexed event content through the runtime's own full-text index.
   * The Extension sends the query and renders the returned excerpts; it never
   * reads a log body to find a match (AC-50/51/53).
   * @param query - full-text query text.
   * @param limit - maximum sessions in one page.
   * @returns hits ranked by their strongest matching event.
   * @throws when the runtime has no search backend enabled or the bridge is not connected.
   */
  async searchSessionContent(query: string, limit?: number): Promise<BridgeSessionSearchHit[]> {
    return this.host.searchSessions(query, limit)
  }

  /**
   * Open a search hit via the existing history/replay path (AC-52).
   * Does not Start a new live session.
   * @param sessionId - hit session id.
   * @param options - optional preloaded events for L2.
   */
  async openSearchHit(
    sessionId: string,
    options: { events?: readonly HydratorSessionEvent[] } = {},
  ): Promise<OpenHistoryResult> {
    return this.openFromHistory(sessionId, options)
  }

  /**
   * Cold/replay hydrate: load ChangeRecord index + inject path/stats change-list (AC-22).
   * Does not invent pruned blob bodies.
   * @param sessionId - session id.
   */
  async hydrateChangeListsFromIndex(sessionId: string): Promise<void> {
    const records = await readChangeIndex(this.snapshotStore.storageRoot, sessionId)
    for (const record of records) this.changes.upsert(record)
    if (records.length === 0) return

    const byTurn = new Map<number, ChangeRecord[]>()
    for (const record of records) {
      const list = byTurn.get(record.turn) ?? []
      list.push(record)
      byTurn.set(record.turn, list)
    }

    const messages = [...this.messages.get(sessionId)]
    let mutated = false
    for (const [turn, turnRecords] of byTurn) {
      if (messages.some(m => m.kind === 'change-list' && m.turn === turn)) continue
      const [firstRecord] = turnRecords
      if (firstRecord === undefined) continue
      const sourceMessageId = firstRecord.sourceMessageId
      const payload = this.changes.toListPayload(sessionId, turn, sourceMessageId)
      const listMessage: ChatMessage = {
        id: randomUUID(),
        sessionId,
        role: 'notice',
        kind: 'change-list',
        text: payload.emptyNotice
          ? CHANGE_LIST_EMPTY_NOTICE
          : `改动了 ${payload.changes.length} 个文件`,
        turn,
        changeList: payload,
      }
      const anchorIdx = messages.findIndex(m => m.id === sourceMessageId)
      if (anchorIdx === -1) messages.push(listMessage)
      else messages.splice(anchorIdx + 1, 0, listMessage)

      if (!payload.emptyNotice) {
        const summary: ChatMessage = {
          id: randomUUID(),
          sessionId,
          role: 'notice',
          kind: 'diff-summary',
          text: `本回合改了 ${payload.changes.length} 个文件`,
          turn,
          sourceMessageId,
        }
        const listIdx = messages.findIndex(m => m.id === listMessage.id)
        messages.splice(listIdx + 1, 0, summary)
      }
      mutated = true
    }
    if (mutated) {
      this.messages.replace(sessionId, messages)
      this.panelHost?.pushFullState()
    }
  }

  /**
   * Read back the images a hydrated session's log referenced and attach them to
   * the bubbles that carried them. A replay fold has only the durable reference,
   * so each image is read from the deployment attachment store through the Host.
   * An image that refuses to read is left out: the log's text still projects the
   * conversation, and a collected object must not fail the whole replay.
   * @param sessionId - SDK session identity of the hydrated (replay) session.
   * @param pending - bubbles with image references, keyed by projected message id.
   */
  async hydrateMessageImages(
    sessionId: string,
    pending: readonly HydratedMessageImages[],
  ): Promise<void> {
    if (pending.length === 0) return
    const filled = await Promise.all(pending.map(async (row) => {
      const images = await Promise.all(row.images.map(async (ref): Promise<MessageImage | undefined> => {
        try {
          const stored = await this.host.readAttachment(ref)
          return { mimeType: stored.mediaType, data: stored.data }
        } catch {
          // Either the runtime is unreachable or the store refused this object;
          // both mean this one image stays unread while the rest still load.
          return undefined
        }
      }))
      return { messageId: row.messageId, images: images.filter(image => image !== undefined) }
    }))
    for (const row of filled) {
      if (row.images.length === 0) continue
      if (this.messages.patch(sessionId, row.messageId, { images: row.images }) === undefined) continue
      if (this.isProjectedSession(this.registry.getActive(), sessionId)) {
        this.panelHost?.pushPatch(sessionId, row.messageId, { images: row.images })
      }
    }
  }

  /**
   * Count write-tool Diff hunks for the session (session-wide helper).
   * @param sessionId - session to summarize.
   */
  changedFileCount(sessionId: string): number {
    return this.timeline.writeDiffsForSession(sessionId).length
  }

  /**
   * Unique files changed in the latest turn (AC-30).
   * @param sessionId - session to summarize.
   */
  changedFileCountForLatestTurn(sessionId: string): number {
    return this.timeline.changedFileCountForLatestTurn(sessionId)
  }

  /**
   * Latest `todo/write` snapshot for a session (feature: todo-panel).
   * @param sessionId - session to read.
   * @returns the whole-list snapshot, or an empty array before the first write.
   */
  todoItemsForSession(sessionId: string): TodoStateItem[] {
    return this.todoBySession.get(sessionId) ?? []
  }

  /**
   * Route a session's last request used (feature: model-route).
   * @param sessionId - session to read.
   * @returns the recorded provider/model, or undefined before its first request.
   */
  requestRouteForSession(sessionId: string): SessionRequestRoute | undefined {
    const route = this.requestRouteBySession.get(sessionId)
    return route === undefined ? undefined : { ...route }
  }

  /**
   * Latest `token/status` sample this controller pushed (feature: token-status).
   * Retained so an unattended driver can assert the sample a Webview received
   * without scraping the panel outbound log.
   * @returns the last payload, or `undefined` before the first usage event.
   */
  lastTokenStatus(): TokenStatusPayload | undefined {
    return this.lastTokenPayload
  }

  /**
   * Identity of the Host this controller is bound to (test hooks / diagnostics). A reader
   * compares it with the extension's current Host: two different ids mean the Tab controller
   * and the Host that serves the panel's commands drifted apart.
   * @returns the bound Host's instance id.
   */
  get hostInstanceId(): string {
    return this.host.instanceId
  }

  /**
   * Subscribe to todo snapshot updates (feature: todo-panel sidebar).
   * @param listener - called after each stored snapshot.
   * @returns disposer removing the listener.
   */
  onTodoChange(listener: () => void): () => void {
    this.todoListeners.add(listener)
    return () => {
      this.todoListeners.delete(listener)
    }
  }

  /**
   * Context window fallback from the cached `model/list` payload (feature:
   * token-status). The session log's own `request/context` record wins; this
   * covers sessions that prompted before any list was read.
   * @returns declared prompt capacity in tokens, or `undefined`.
   */
  private resolveContextWindow(): number | undefined {
    const list = this.host.cachedModelList()
    if (list === undefined) return undefined
    const provider = list.providers.find(entry => entry.id === list.current.provider)
    const model = provider?.models.find(entry => entry.id === list.current.model)
    return model?.contextWindow
  }

  /**
   * Refine the pushed token sample with the runtime's `contextPressure`
   * projection (feature: token-status). Log usage sees neither compaction
   * shadowing nor the route capacity the last request was sized against, so
   * the ring prefers these values once the runtime reports them.
   * @param sessionId - session whose projection is read.
   */
  private refreshContextPressure(sessionId: string): void {
    // Nothing to refine until this session pushed a sample the panel shows.
    if (this.lastTokenPayload?.sessionId !== sessionId) return
    if (this.pressureRefresh.has(sessionId)) return
    this.pressureRefresh.add(sessionId)
    void this.host.readProjection(sessionId, ['contextPressure']).then((snapshot) => {
      const pressure = contextPressureOf(snapshot.values.contextPressure)
      const sample = this.lastTokenPayload
      if (pressure === undefined || sample?.sessionId !== sessionId) return
      const refined: TokenStatusPayload = { ...sample, ...pressure }
      this.lastTokenPayload = refined
      this.panelHost?.pushTokenStatus(refined)
    }, () => {
      // The pushed usage sample stays the shown value; the projection only refines it.
    }).finally(() => {
      this.pressureRefresh.delete(sessionId)
    })
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
    this.host.interactions.onActiveSessionChange?.(this.registry.getActive()?.sessionId)
    this.panelHost?.pushFullState()
    return { outcome: 'closed', tabId: tab.tabId, sessionId: tab.sessionId, empty }
  }

  /**
   * Explicitly delete a conversation: dispose, erase the persisted log, clear the
   * authority index (AC-26/60/72/73).
   * Does not cascade to child session authority (AC-61).
   * @param tabId - Tab whose session to delete.
   * @param options - confirmation flag (required before dispose).
   * @returns delete outcome, carrying `deleteError` when only the erase failed.
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
    const deleteError = await this.teardownDeletedSession(tab.sessionId)
    this.registry.close(tabId)
    this.persistOpenTabs()
    this.panelHost?.pushFullState()
    return {
      outcome: 'deleted',
      tabId: tab.tabId,
      sessionId: tab.sessionId,
      ...deleteError === undefined ? {} : { deleteError },
    }
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
    const deleteError = await this.teardownDeletedSession(sessionId)
    this.persistOpenTabs()
    this.panelHost?.pushFullState()
    return {
      outcome: 'deleted',
      tabId: '',
      sessionId,
      ...deleteError === undefined ? {} : { deleteError },
    }
  }

  /**
   * Dispose a session, erase its persisted log, and drop every projection it owns
   * (AC-26 / AC-36b).
   *
   * Every await runs before the clear block, and `markDeleted` sits in that same synchronous
   * block: a turn that settles while the session is being torn down appends to these stores from
   * a detached `turn/end` handler, so clearing first let that append resurrect content for a
   * session the user had just deleted. `settleChangeListProjection` additionally refuses to run
   * against a tombstoned session.
   * @param sessionId - session being deleted.
   * @returns the runtime `session/delete` failure text, or `undefined` when the
   *   persisted data was erased; a failed erase never aborts the local teardown.
   */
  private async teardownDeletedSession(sessionId: string): Promise<string | undefined> {
    // Capture parent before clearing timeline links (AC-74/75 card → deleted marker).
    const parentSessionId = this.timeline.getParent(sessionId)
      ?? this.index.read().sessions.find(s => s.sessionId === sessionId)?.parentSessionId
    await this.host.disposeSession(sessionId)
    // Erase the persisted log after the runtime dropped the live session, so nothing it
    // still holds can re-append. A failure here must not abort the clears below — the Tab
    // and its index entries still have to go — so the text travels back to the caller and
    // to the panel, which is where the user can read it.
    let deleteError: string | undefined
    try {
      await this.host.deleteSession(sessionId)
    } catch (error) {
      deleteError = error instanceof Error ? error.message : String(error)
      this.panelHost?.pushBanner(`删除会话数据失败：${deleteError}`, 'delete-failed')
    }
    await this.snapshotStore.clearSession(sessionId)
    // No await below this line — nothing can interleave with this clear + tombstone.
    this.messages.clearSession(sessionId)
    this.timeline.clearSession(sessionId)
    this.attributor.clearSession(sessionId)
    this.changes.clearSession(sessionId)
    this.pathSessionIndex.removeSession(sessionId)
    this.index.markDeleted(sessionId)
    // Clear in-panel contexts pointing at this session; do not cascade-close child Tabs (AC-61/75).
    this.clearContextsReferencing(sessionId)
    if (parentSessionId !== undefined && !this.index.isDeleted(parentSessionId)) {
      this.markSubagentCardDeleted(parentSessionId, sessionId)
    }
    return deleteError
  }

  /**
   * Prompt the active Tab's session and project the user bubble (AC-7 / AC-10).
   * @param text - user text content.
   * @param images - images the composer attached, in send order.
   * @returns message id and the targeted session id.
   */
  async promptActive(text: string, images?: PromptImage[]): Promise<{ messageId: string; sessionId: string; tabId: string }> {
    const active = this.registry.getActive()
    if (active === undefined) {
      throw new Error('no active conversation Tab')
    }
    return this.promptTab(active.tabId, text, images).then(result => ({ ...result, tabId: active.tabId }))
  }

  /**
   * Prompt a specific Tab by id (tests / explicit routing).
   * Projects an optimistic user message when the runtime omits user/message (A-1).
   * @param tabId - Tab whose session receives the prompt.
   * @param text - user text.
   * @param images - images the composer attached, in send order.
   * @returns message id and session id.
   */
  async promptTab(tabId: string, text: string, images?: PromptImage[]): Promise<{ messageId: string; sessionId: string }> {
    const tab = this.registry.get(tabId)
    if (tab === undefined) throw new Error(`unknown conversation Tab: ${tabId}`)
    const blocks: SdkPromptContentBlock[] = [{ type: 'text', text }]
    if (images !== undefined) {
      for (const img of images) {
        blocks.push({ type: 'image', data: img.data, mimeType: img.mimeType } as SdkPromptContentBlock)
      }
    }
    const messageId = await this.host.prompt(tab.sessionId, blocks)
    this.projectUserMessage(tab.sessionId, text, messageId, images)
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
   * Accept an explicit user title for one session via Host bridge `session/rename`.
   * The runtime commits a `session/title` event, so index and Tab chrome follow
   * that event rather than this call's return value.
   * @param sessionId - session to rename.
   * @param title - title text the user typed.
   * @returns the normalized title the runtime accepted.
   */
  async renameSession(sessionId: string, title: string): Promise<string> {
    return await this.host.renameSession(sessionId, title)
  }

  /**
   * Mirror a runtime `session/title` into local chrome: the index row, the bound
   * Tab's label, and the panel chrome while that Tab is the one on screen.
   * @param sessionId - session whose title changed.
   * @param title - normalized title from the session log.
   */
  private applySessionTitle(sessionId: string, title: string): void {
    const row = this.index.read().sessions.find(entry => entry.sessionId === sessionId)
    if (row !== undefined && row.title !== title) {
      this.index.upsertSession({ ...row, title })
    }
    const tab = this.registry.getBySessionId(sessionId)
    if (tab !== undefined && tab.title !== title) {
      this.registry.setTitle(tab.tabId, title)
    }
    this.panelHost?.pushTabsFrame()
    if (this.registry.getActive()?.sessionId === sessionId) this.panelHost?.pushFullState()
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
   * @returns preset options (label + description) and the current selection.
   */
  async listPermissionPresets(): Promise<{ sessionId: string } & PermissionPresetList> {
    const active = this.registry.getActive()
    if (active === undefined) throw new Error('no active conversation Tab')
    const listed = await this.host.listPermissionPresets(active.sessionId)
    return { sessionId: active.sessionId, ...listed }
  }

  /**
   * Read the active Tab session's effective approval policy via the Host bridge.
   * @returns the session the policy belongs to and the policy itself.
   */
  async readApprovalPolicy(): Promise<{ sessionId: string; policy: BridgeApprovalPolicy }> {
    const active = this.registry.getActive()
    if (active === undefined) throw new Error('no active conversation Tab')
    const policy = await this.host.readApprovalPolicy(active.sessionId)
    return { sessionId: active.sessionId, policy }
  }

  /**
   * Registry snapshot for Tab bar UI.
   * @returns current Tabs and active pointer.
   */
  snapshot(): ConversationRegistrySnapshot {
    return this.registry.snapshot()
  }

  /**
   * Panel-facing snapshot for L2 hooks (mode / messages / status / Continue).
   * @returns active panel projection fields.
   */
  panelSnapshot(): {
    mode: PanelMode
    sessionId?: string
    tabId?: string
    title?: string
    contextSessionId?: string
    breadcrumb?: PanelBreadcrumb
    messages: readonly ChatMessage[]
    tabStatus?: ConversationTab['status']
    index: ReturnType<ExtensionIndex['read']>
    continue?: ContinueChrome
    deferredRestoreCount: number
    pendingRestore: boolean
  } {
    if (this.pendingRestoreLatch && this.host.status !== 'connected') {
      return {
        mode: 'waiting-host',
        messages: [],
        index: this.index.read(),
        continue: { visibility: 'hidden' },
        deferredRestoreCount: this.deferredRestore.length,
        pendingRestore: true,
      }
    }
    const active = this.registry.getActive()
    if (active === undefined) {
      return {
        mode: this.host.status === 'connected' ? 'empty' : 'waiting-host',
        messages: [],
        index: this.index.read(),
        continue: { visibility: 'hidden' },
        deferredRestoreCount: this.deferredRestore.length,
        pendingRestore: this.pendingRestoreLatch,
      }
    }
    const projection = this.resolvePanelProjection()
    if (projection === undefined) {
      return {
        mode: 'empty',
        messages: [],
        index: this.index.read(),
        continue: { visibility: 'hidden' },
        deferredRestoreCount: this.deferredRestore.length,
        pendingRestore: this.pendingRestoreLatch,
      }
    }
    return {
      mode: projection.mode,
      sessionId: projection.sessionId,
      tabId: projection.tabId,
      ...projection.title === undefined ? {} : { title: projection.title },
      ...projection.contextSessionId === undefined
        ? {}
        : { contextSessionId: projection.contextSessionId },
      ...projection.breadcrumb === undefined ? {} : { breadcrumb: projection.breadcrumb },
      messages: projection.messages,
      tabStatus: projection.tabStatus,
      index: this.index.read(),
      continue: this.continueChromeForTab(active.tabId),
      deferredRestoreCount: this.deferredRestore.length,
      pendingRestore: this.pendingRestoreLatch,
    }
  }

  /**
   * Enter a child session from a parent subagent card (AD-CU-11 / AC-35/37/78).
   * Default path sets `contextSessionId` without minting a Tab; pinned children activate.
   * @param childSessionId - child session from the card.
   * @returns open outcome.
   */
  async openSubagentContext(childSessionId: string): Promise<OpenSubagentResult> {
    if (this.host.status !== 'connected') return { outcome: 'host-not-ready' }
    const active = this.registry.getActive()
    if (active === undefined) return { outcome: 'missing' }

    if (this.index.isDeleted(childSessionId)) {
      this.markSubagentCardDeleted(active.sessionId, childSessionId)
      this.panelHost?.pushFullState()
      return { outcome: 'deleted', childSessionId }
    }

    const pinned = this.registry.getBySessionId(childSessionId)
    if (pinned !== undefined) {
      this.registry.setContextSessionId(active.tabId, undefined)
      this.registry.switchTo(pinned.tabId)
      this.host.interactions.onActiveSessionChange?.(pinned.sessionId)
      this.panelHost?.pushFullState()
      return {
        outcome: 'activated-tab',
        childSessionId,
        mode: pinned.mode === 'replay' ? 'replay' : 'live',
        tabId: pinned.tabId,
      }
    }

    const run = this.childRunState.get(childSessionId)
    if (run !== 'running') {
      await this.ensureChildHydrated(childSessionId)
    }
    // Entering a child is when its durable mode decides composer delivery, so
    // read the parent's catalog now rather than on every projection push.
    void this.refreshSubagentCatalog(active.sessionId)
    this.registry.setContextSessionId(active.tabId, childSessionId)
    const mode: PanelMode = run === 'running' ? 'readonly-live' : 'replay'
    this.panelHost?.pushFullState()
    return {
      outcome: 'opened-context',
      childSessionId,
      mode,
      tabId: active.tabId,
    }
  }

  /**
   * List one session's durable subagent children or subtree through the Host
   * bridge. The runtime's projection fold classifies each row, so a child no
   * longer in memory is still listed with the mode its descriptor recorded.
   * @param sessionId - parent (`children`) or root (`descendants`) session.
   * @param scope - direct children or the whole subtree.
   * @returns the runtime's rows, or throws with the runtime's refusal text.
   */
  async listSubagents(sessionId: string, scope: 'children' | 'descendants' = 'children'): Promise<SubagentListResult> {
    return await this.host.listSubagents(sessionId, scope)
  }

  /**
   * Deliver one message to a continuable subagent child through its live
   * direct parent (AD-CU-11 continuation path).
   * @param parentSessionId - durable parent whose live Agent delivers the message.
   * @param childSessionId - durable continuable child receiving it.
   * @param text - message text.
   * @returns identity of the message the child's inbox accepted.
   */
  async promptSubagent(parentSessionId: string, childSessionId: string, text: string): Promise<string> {
    return await this.host.promptSubagent(parentSessionId, childSessionId, text)
  }

  /**
   * Abort one subagent child's active turn under its durable parent's authority.
   * @param parentSessionId - durable parent whose authority the request claims.
   * @param childSessionId - durable child whose active turn is aborted.
   */
  async interruptSubagent(parentSessionId: string, childSessionId: string): Promise<void> {
    await this.host.interruptSubagent(parentSessionId, childSessionId)
  }

  /**
   * Read one session's SpecDev status into the cache and push it to the panel.
   * The status is workspace state rather than log state, so it is read from the
   * runtime; concurrent reads for one session coalesce, and a refusal keeps the
   * last known status — the next SpecDev event or Tab activation reads again.
   * @param sessionId - session whose workspace active workflow is read.
   */
  async refreshSpecdev(sessionId: string): Promise<void> {
    if (this.specdevRefreshes.has(sessionId)) return
    if (this.host.status !== 'connected') return
    this.specdevRefreshes.add(sessionId)
    try {
      const snapshot = await this.host.readSpecdevSnapshot(sessionId)
      this.specdevBySession.set(sessionId, snapshot)
      this.panelHost?.pushSpecdevStatus(sessionId, snapshot, this.specdevLastScope.get(sessionId))
    } catch {
      // A refusal leaves the card as it was; nothing else can act on it here.
    } finally {
      this.specdevRefreshes.delete(sessionId)
    }
  }

  /**
   * Apply one Human Gate decision and publish the status the runtime answered.
   * @param sessionId - session owning the workflow log.
   * @param gate - gate being decided.
   * @param decision - decision to apply.
   * @param note - optional human note recorded with the decision.
   * @returns the post-change status, or null when the runtime returned none.
   */
  async confirmSpecdevGate(
    sessionId: string,
    gate: string,
    decision: string,
    note?: string,
  ): Promise<BridgeSpecdevSnapshot | null> {
    const snapshot = await this.host.confirmSpecdevGate(sessionId, {
      gate,
      decision,
      ...note === undefined ? {} : { note },
    })
    const latest = snapshot ?? this.specdevBySession.get(sessionId) ?? null
    this.specdevBySession.set(sessionId, latest)
    this.panelHost?.pushSpecdevStatus(sessionId, latest)
    return snapshot
  }

  /**
   * Read the cached SpecDev status of one session.
   * @param sessionId - session whose status was last read.
   * @returns the status, or `undefined` when this session was never read.
   */
  cachedSpecdev(sessionId: string): BridgeSpecdevSnapshot | null | undefined {
    return this.specdevBySession.get(sessionId)
  }

  /**
   * Resolve the subagent address the Conversation composer may write to for the
   * active Tab. A message needs a continuable child (the runtime's verdict, from
   * the cached `subagent/list`), a child that is not running, and a parent whose
   * Tab this window holds live — the runtime delivers through the parent's live
   * Agent, so a replay Tab has no delivery route.
   * @returns the address and label, or undefined when the composer stays read-only.
   */
  resolveSubagentPromptTarget(): { parentSessionId: string; childSessionId: string; label?: string } | undefined {
    const active = this.registry.getActive()
    if (active === undefined) return undefined
    const childSessionId = active.contextSessionId
      ?? (active.pinnedSubagent === true ? active.sessionId : undefined)
    if (childSessionId === undefined) return undefined
    if (this.childRunState.get(childSessionId) === 'running') return undefined
    const parentSessionId = active.contextSessionId !== undefined
      ? active.sessionId
      : this.parentSessionIdOf(active.sessionId)
    if (parentSessionId === undefined) return undefined
    const parentTab = this.registry.getBySessionId(parentSessionId)
    if (parentTab === undefined || parentTab.mode === 'replay' || parentTab.status === 'disconnected') {
      return undefined
    }
    const entry = this.subagentCatalog.get(parentSessionId)?.get(childSessionId)
    if (entry?.mode !== 'continuable') {
      // The classification is not known here yet; a read for this parent may
      // already be in flight, and a later push re-resolves once it lands.
      void this.refreshSubagentCatalog(parentSessionId)
      return undefined
    }
    return {
      parentSessionId,
      childSessionId,
      ...entry.label === undefined ? {} : { label: entry.label },
    }
  }

  /**
   * Read one parent's durable subagent children into the cache that decides
   * composer delivery. Concurrent reads for one parent coalesce, and a refusal
   * leaves the previous cache in place — the composer simply stays read-only.
   * @param parentSessionId - parent whose children are read.
   */
  private async refreshSubagentCatalog(parentSessionId: string): Promise<void> {
    if (this.subagentCatalogRefreshes.has(parentSessionId)) return
    if (this.host.status !== 'connected') return
    this.subagentCatalogRefreshes.add(parentSessionId)
    try {
      const result = await this.host.listSubagents(parentSessionId, 'children')
      const children = new Map<string, { mode: 'one-shot' | 'continuable'; label?: string }>()
      for (const entry of result.entries) {
        if (entry.kind !== 'child') continue
        children.set(entry.sessionId, {
          mode: entry.mode,
          ...entry.label === undefined ? {} : { label: entry.label },
        })
      }
      this.subagentCatalog.set(parentSessionId, children)
      this.panelHost?.pushFullState()
    } catch {
      // The runtime could not answer; a later entry or finish retries the read.
    } finally {
      this.subagentCatalogRefreshes.delete(parentSessionId)
    }
  }

  /** Durable parent of a session, from the timeline link or the workspace index. */
  private parentSessionIdOf(sessionId: string): string | undefined {
    return this.timeline.getParent(sessionId)
      ?? this.index.read().sessions.find(row => row.sessionId === sessionId)?.parentSessionId
  }

  /**
   * List a parent session's child (subagent) sessions with their hydrated
   * projected messages (DEBT-10). Hydrates each child from the authoritative
   * log so a driver can assert the child produced an assistant reply, without
   * ever entering the child context in the UI. Registered only behind
   * `dsh.test.listChildren` (`VSCODE_DSH_TEST=1`).
   * @param parentSessionId - optional; defaults to the active Tab's session.
   * @returns the parent id and its children, each with projected messages.
   */
  async listChildren(parentSessionId?: string): Promise<{
    parentSessionId: string
    children: Array<{
      sessionId: string
      parentSessionId: string
      title: string
      status: 'running' | 'ended'
      messages: readonly ChatMessage[]
    }>
  }> {
    const parent = parentSessionId ?? this.registry.getActive()?.sessionId
    if (parent === undefined) return { parentSessionId: '', children: [] }
    const rows = this.index.read().sessions.filter(row => row.parentSessionId === parent)
    const children: Array<{
      sessionId: string
      parentSessionId: string
      title: string
      status: 'running' | 'ended'
      messages: readonly ChatMessage[]
    }> = []
    for (const row of rows) {
      await this.ensureChildHydrated(row.sessionId)
      children.push({
        sessionId: row.sessionId,
        parentSessionId: parent,
        title: row.title,
        status: this.childRunState.get(row.sessionId) ?? 'ended',
        messages: this.messages.get(row.sessionId),
      })
    }
    return { parentSessionId: parent, children }
  }

  /**
   * Unwind per-capability conversation state for the Layer-V driver (DEBT-12).
   * Clears every Tab's in-panel child context and closes pinned subagent Tabs,
   * leaving root conversations open so the next capability starts from a clean
   * projection (no `readonly-live` leak). The orchestrator's own reset
   * (`onUserStop`) is the caller's responsibility — this only unwinds the
   * registry side. Test-only: registered behind `dsh.test.resetToIdle`.
   * @returns how many contexts were cleared and child Tabs closed.
   */
  resetForTest(): { clearedContexts: number; closedChildTabs: number } {
    let clearedContexts = 0
    let closedChildTabs = 0
    for (const tab of this.registry.list()) {
      if (tab.contextSessionId !== undefined) {
        this.registry.setContextSessionId(tab.tabId, undefined)
        clearedContexts += 1
      }
    }
    for (const tab of this.registry.list()) {
      if (tab.pinnedSubagent === true) {
        this.registry.close(tab.tabId)
        closedChildTabs += 1
      }
    }
    this.persistOpenTabs()
    this.panelHost?.pushFullState()
    return { clearedContexts, closedChildTabs }
  }

  /**
   * Leave in-panel child context and restore the parent Tab stream (AC-36).
   * No-op when parent is deleted on a pinned child Tab (AC-75).
   * @returns navigation outcome.
   */
  navBack(): NavBackResult {
    const active = this.registry.getActive()
    if (active === undefined) return { outcome: 'noop' }

    if (active.contextSessionId !== undefined) {
      this.registry.setContextSessionId(active.tabId, undefined)
      this.panelHost?.pushFullState()
      return { outcome: 'restored' }
    }

    // Pinned child Tab: breadcrumb back to parent when parent still exists.
    const parentSessionId = this.timeline.getParent(active.sessionId)
      ?? this.index.read().sessions.find(s => s.sessionId === active.sessionId)?.parentSessionId
    if (parentSessionId === undefined) return { outcome: 'noop' }
    if (this.index.isDeleted(parentSessionId)) return { outcome: 'disabled' }
    const parentTab = this.registry.getBySessionId(parentSessionId)
    if (parentTab === undefined) return { outcome: 'disabled' }
    this.registry.switchTo(parentTab.tabId)
    this.host.interactions.onActiveSessionChange?.(parentTab.sessionId)
    this.panelHost?.pushFullState()
    return { outcome: 'restored' }
  }

  /**
   * Promote the current child context (or given child) into a Conversations Tab (AC-38/79).
   * @param childSessionId - optional; defaults to active contextSessionId.
   * @returns pin outcome.
   */
  async pinSubagent(childSessionId?: string): Promise<PinSubagentResult> {
    const active = this.registry.getActive()
    if (active === undefined) return { outcome: 'missing' }
    const childId = childSessionId ?? active.contextSessionId
    if (childId === undefined) return { outcome: 'missing' }
    if (this.index.isDeleted(childId)) {
      this.markSubagentCardDeleted(active.sessionId, childId)
      return { outcome: 'deleted', childSessionId: childId }
    }

    const existing = this.registry.getBySessionId(childId)
    if (existing !== undefined) {
      this.registry.setContextSessionId(active.tabId, undefined)
      this.registry.switchTo(existing.tabId)
      this.host.interactions.onActiveSessionChange?.(existing.sessionId)
      this.panelHost?.pushFullState()
      return {
        outcome: 'activated',
        childSessionId: childId,
        tabId: existing.tabId,
        parentTabId: active.tabId,
      }
    }

    const parentTabId = active.tabId
    const run = this.childRunState.get(childId)
    const mode: OpenTabMode = run === 'running' ? 'live' : 'replay'
    if (run !== 'running') await this.ensureChildHydrated(childId)
    // The pinned Tab's durable parent is the address a composer send needs, so
    // read that parent's catalog before the Tab becomes reachable.
    const durableParent = this.parentSessionIdOf(childId)
    if (durableParent !== undefined) void this.refreshSubagentCatalog(durableParent)

    // Clear context first so parent view is restored after pin (AC-79).
    this.registry.setContextSessionId(parentTabId, undefined)
    const childTab = this.registry.create(
      this.index.read().sessions.find(s => s.sessionId === childId)?.title ?? 'Subagent',
      childId,
      mode,
    )
    this.registry.setPinnedSubagent(childTab.tabId, true)
    // Restore parent as active after minting the child Tab.
    this.registry.switchTo(parentTabId)
    this.host.interactions.onActiveSessionChange?.(active.sessionId)
    this.persistOpenTabs()
    this.panelHost?.pushFullState()
    return {
      outcome: 'pinned',
      childSessionId: childId,
      tabId: childTab.tabId,
      parentTabId,
    }
  }

  /**
   * Resolve the effective panel projection for Host push (Tab root vs child context).
   * @returns projection for the active Tab, or undefined when empty.
   */
  resolvePanelProjection(): PanelProjection | undefined {
    const active = this.registry.getActive()
    if (active === undefined) return undefined
    const subagentPrompt = this.resolveSubagentPromptTarget()
    // The bar is a property of the Tab's root session, so it stays the same
    // roster while the panel projects a child context.
    const subagents = this.subagentRoster(active.sessionId)

    const contextId = active.contextSessionId
    if (contextId !== undefined) {
      const run = this.childRunState.get(contextId)
      const mode: PanelMode = run === 'running' ? 'readonly-live' : 'replay'
      return {
        mode,
        sessionId: contextId,
        tabId: active.tabId,
        contextSessionId: contextId,
        breadcrumb: this.buildBreadcrumb(active.sessionId),
        ...subagents === undefined ? {} : { subagents },
        ...subagentPrompt === undefined ? {} : { subagentPrompt },
        messages: this.messages.get(contextId),
        tabStatus: run === 'running' ? 'running' : 'idle',
        ...active.title === undefined ? {} : { title: active.title },
      }
    }

    const parentSessionId = this.parentSessionIdOf(active.sessionId)
    const breadcrumb = parentSessionId === undefined
      ? undefined
      : this.buildBreadcrumb(parentSessionId)

    // A pinned running child Tab stays read-only live until it ends (AD-CU-11),
    // mirroring the in-panel context path — no writable live seam for a running child.
    const pinnedRunning = active.pinnedSubagent === true
      && this.childRunState.get(active.sessionId) === 'running'
    return {
      mode: pinnedRunning
        ? 'readonly-live'
        : active.mode === 'replay' ? 'replay' : 'live',
      sessionId: active.sessionId,
      tabId: active.tabId,
      ...subagents === undefined ? {} : { subagents },
      messages: this.messages.get(active.sessionId),
      tabStatus: active.status,
      ...active.title === undefined ? {} : { title: active.title },
      ...breadcrumb === undefined ? {} : { breadcrumb },
      ...subagentPrompt === undefined ? {} : { subagentPrompt },
    }
  }

  /**
   * Subagent roster of one root session for the panel's fixed bar: every durable
   * `kind:'subagent'` card in that session's projection, in projection order,
   * carrying the live run state. A deleted child, and one the user dismissed from
   * the bar, is dropped.
   * @param sessionId - root session whose children the bar lists.
   * @returns roster rows, or undefined when the session has no enterable child.
   */
  private subagentRoster(sessionId: string): PanelSubagent[] | undefined {
    const dismissed = this.dismissedSubagents.get(sessionId)
    const childIds: string[] = []
    for (const message of this.messages.get(sessionId)) {
      if (message.kind !== 'subagent' || message.subagentStatus === 'deleted') continue
      const childSessionId = message.childSessionId
      if (childSessionId === undefined || childSessionId === '') continue
      if (this.index.isDeleted(childSessionId)) continue
      if (dismissed?.has(childSessionId) === true) continue
      childIds.push(childSessionId)
    }
    if (childIds.length === 0) return undefined
    const titles = new Map(this.index.read().sessions.map(row => [row.sessionId, row.title]))
    return childIds.map(childSessionId => ({
      childSessionId,
      label: this.subagentCatalog.get(sessionId)?.get(childSessionId)?.label
        ?? titles.get(childSessionId)
        ?? `子代理 ${childSessionId.slice(0, 8)}`,
      status: this.childRunState.get(childSessionId) === 'running' ? 'running' : 'ended',
    }))
  }

  /**
   * Hide subagent rows from the panel's roster bar. The transcript card stays —
   * dismissal is a bar affordance, not a deletion — and a running child is never
   * dismissed, because its row is the one place its progress is visible.
   * @param childSessionId - one child to dismiss, or omitted to dismiss every
   *   finished child of the active Tab's root session.
   * @returns how many rows the dismissal removed from the roster.
   */
  dismissSubagent(childSessionId?: string): number {
    const active = this.registry.getActive()
    if (active === undefined) return 0
    const parentSessionId = active.sessionId
    const roster = this.subagentRoster(parentSessionId) ?? []
    const targets = childSessionId === undefined
      ? roster.filter(row => row.status === 'ended').map(row => row.childSessionId)
      : roster.filter(row => row.childSessionId === childSessionId && row.status === 'ended')
        .map(row => row.childSessionId)
    if (targets.length === 0) return 0
    const dismissed = this.dismissedSubagents.get(parentSessionId) ?? new Set<string>()
    for (const id of targets) dismissed.add(id)
    this.dismissedSubagents.set(parentSessionId, dismissed)
    this.panelHost?.pushFullState()
    return targets.length
  }

  /**
   * L2 helper: synthesize `subagent.started` / `subagent.finished` into the controller.
   * @param phase - started or finished.
   * @param parentSessionId - parent session.
   * @param childSessionId - child session.
   */
  async applyTestSubagentNotification(
    phase: 'started' | 'finished',
    parentSessionId: string,
    childSessionId: string,
  ): Promise<void> {
    if (phase === 'started') {
      this.timeline.apply({
        method: 'subagent.started',
        params: { parentSessionId, childSessionId },
      })
      this.onSubagentStarted(parentSessionId, childSessionId)
      return
    }
    this.timeline.apply({
      method: 'subagent.finished',
      params: {
        provider: 'test',
        agentId: childSessionId,
        parentSessionId,
        childSessionId,
        status: 'completed',
        stopReason: 'end_turn',
      },
    })
    await this.onSubagentFinished(parentSessionId, childSessionId)
  }

  /**
   * Apply one synthetic session event through the same projection path as a real
   * `session.event` notification (test hooks only).
   * @param sessionId - owning session.
   * @param type - session event type, e.g. 'todo/write'.
   * @param data - event payload.
   */
  applyTestSessionEvent(sessionId: string, type: string, data: Record<string, unknown>): void {
    this.onSdkNotification({
      method: 'session.event',
      params: { sessionId, event: { type, data } },
    })
  }

  /**
   * Apply one synthetic `session.assistant-stream` frame through the same
   * projection path as a live notification (test hooks only).
   * @param sessionId - owning session.
   * @param frame - start, chunk, or end frame.
   */
  applyTestStreamFrame(sessionId: string, frame: Record<string, unknown>): void {
    this.onSdkNotification({
      method: 'session.assistant-stream',
      params: { sessionId, frame },
    })
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
    this.stopStatusWatch?.()
    this.stopStatusWatch = undefined
    this.host.setConversationRegistry?.(undefined)
    this.panelHost = undefined
    this.deferredRestore = []
    this.pendingRestoreLatch = false
    this.openTabPersistSuspended = false
    this.restoreInFlight = undefined
    this.eventOverrides.clear()
    this.resumeOverride = undefined
    this.childRunState.clear()
    this.subagentCatalog.clear()
    this.subagentCatalogRefreshes.clear()
    this.dismissedSubagents.clear()
    this.specdevBySession.clear()
    this.specdevLastScope.clear()
    this.specdevRefreshes.clear()
    this.timeline.clear()
    this.messages.clear()
    this.changes.clear()
    this.registry.clear()
  }

  private onSubagentStarted(parentSessionId: string, childSessionId: string): void {
    this.childRunState.set(childSessionId, 'running')
    // A child that ran before may have been dismissed from the bar; a new run is
    // exactly when its progress has to be visible again.
    this.dismissedSubagents.get(parentSessionId)?.delete(childSessionId)
    this.index.upsertSession({
      sessionId: childSessionId,
      title: `Subagent ${childSessionId.slice(0, 8)}`,
      mtime: Date.now(),
      parentSessionId,
    })
    const existing = this.messages.get(parentSessionId)
      .find(m => m.kind === 'subagent' && m.childSessionId === childSessionId)
    if (existing === undefined) {
      const card: ChatMessage = {
        id: randomUUID(),
        sessionId: parentSessionId,
        role: 'notice',
        kind: 'subagent',
        text: '子代理运行中 — 点击进入',
        childSessionId,
        subagentStatus: 'running',
      }
      this.messages.append(parentSessionId, card)
      const active = this.registry.getActive()
      if (active !== undefined && active.sessionId === parentSessionId && active.contextSessionId === undefined) {
        this.panelHost?.pushAppend(card)
      }
    } else {
      this.messages.patchWhere(
        parentSessionId,
        m => m.kind === 'subagent' && m.childSessionId === childSessionId,
        { text: '子代理运行中 — 点击进入', subagentStatus: 'running' },
      )
    }

    if (this.isParentCurrentContext(parentSessionId)) {
      this.panelHost?.pushBanner('子代理运行中', 'subagent-running')
    }
    this.panelHost?.pushFullState()
  }

  private async onSubagentFinished(parentSessionId: string, childSessionId: string): Promise<void> {
    this.childRunState.set(childSessionId, 'ended')
    // A finished child is the moment its durable mode becomes actionable, so
    // re-read the parent's catalog and let the push below show the outcome.
    void this.refreshSubagentCatalog(parentSessionId)
    this.messages.patchWhere(
      parentSessionId,
      m => m.kind === 'subagent' && m.childSessionId === childSessionId,
      { text: '已结束，可进入回放', subagentStatus: 'ended' },
    )

    if (this.isParentCurrentContext(parentSessionId)) {
      this.panelHost?.pushBanner('', 'subagent-clear')
    }

    // Viewing this child in context → hydrate and flip to replay (AC-71).
    const active = this.registry.getActive()
    if (active?.contextSessionId === childSessionId) {
      await this.ensureChildHydrated(childSessionId)
      this.panelHost?.pushFullState()
      return
    }

    // Pinned child Tab still open → force replay mode after finish.
    const childTab = this.registry.getBySessionId(childSessionId)
    if (childTab !== undefined && childTab.mode === 'live') {
      this.registry.setMode(childTab.tabId, 'replay')
      await this.ensureChildHydrated(childSessionId)
    }
    this.panelHost?.pushFullState()
  }

  private isParentCurrentContext(parentSessionId: string): boolean {
    const active = this.registry.getActive()
    if (active === undefined) return false
    return active.sessionId === parentSessionId && active.contextSessionId === undefined
  }

  /**
   * Whether the panel currently projects `sessionId` — either the active Tab's
   * root session or its in-panel child context (Phase 4 subagent view).
   */
  private isProjectedSession(active: ConversationTab | undefined, sessionId: string): boolean {
    if (active === undefined) return false
    return active.sessionId === sessionId || active.contextSessionId === sessionId
  }

  private buildBreadcrumb(parentSessionId: string): PanelBreadcrumb {
    const parentDeleted = this.index.isDeleted(parentSessionId)
    const parentOpen = this.registry.getBySessionId(parentSessionId) !== undefined
    // Align Webview clickability with Host navBack: no open parent Tab → disabled.
    const navDisabled = parentDeleted || !parentOpen
    return {
      parentSessionId,
      parentDeleted: navDisabled,
      label: parentDeleted
        ? '父会话已删除'
        : !parentOpen
          ? '父会话未打开'
          : '返回父会话',
    }
  }

  private effectiveContinueSessionId(tab: ConversationTab): string {
    return tab.contextSessionId ?? tab.sessionId
  }

  private effectiveContinueMode(tab: ConversationTab): PanelMode | ConversationTab['mode'] {
    if (tab.contextSessionId !== undefined) {
      return this.childRunState.get(tab.contextSessionId) === 'running'
        ? 'readonly-live'
        : 'replay'
    }
    return tab.mode
  }

  private markSubagentCardDeleted(parentSessionId: string, childSessionId: string): void {
    const patched = this.messages.patchWhere(
      parentSessionId,
      m => m.kind === 'subagent' && m.childSessionId === childSessionId,
      { text: '子会话已删除', subagentStatus: 'deleted' },
    )
    if (patched === 0) {
      this.messages.append(parentSessionId, {
        id: randomUUID(),
        sessionId: parentSessionId,
        role: 'notice',
        kind: 'subagent',
        text: '子会话已删除',
        childSessionId,
        subagentStatus: 'deleted',
      })
    }
  }

  private async ensureChildHydrated(childSessionId: string): Promise<void> {
    if (this.messages.hasContent(childSessionId)) return
    try {
      const events = await this.loadEvents(childSessionId)
      if (events.length === 0) return
      const hydrated = hydrateFromAuthoritativeLog(childSessionId, events)
      this.messages.replace(childSessionId, hydrated.messages)
      await this.hydrateMessageImages(childSessionId, hydrated.pendingImages)
    } catch {
      // Missing child log leaves empty projection; enter still allowed for empty replay.
    }
  }

  private clearContextsReferencing(sessionId: string): void {
    for (const tab of this.registry.list()) {
      if (tab.contextSessionId === sessionId) {
        this.registry.setContextSessionId(tab.tabId, undefined)
      }
    }
  }

  /**
   * Persist openTabSet / activeSessionId immediately (AD-CU-4).
   * Empty Tabs (no messages) are excluded from openTabSet (AD-CU-3).
   * Deferred (not-yet-UI) rows are merged so a UI cap never drops the durable index (AC-70).
   */
  persistOpenTabs(): void {
    if (this.openTabPersistSuspended) return
    const openTabSet: OpenTabRecord[] = []
    const seen = new Set<string>()
    for (const tab of this.registry.list()) {
      if (!this.messages.hasContent(tab.sessionId)) continue
      seen.add(tab.sessionId)
      openTabSet.push({
        tabId: tab.tabId,
        sessionId: tab.sessionId,
        mode: tab.mode,
        ...tab.title === undefined ? {} : { title: tab.title },
        ...tab.mode === 'live' ? { liveIntent: true } : {},
        ...tab.pinnedSubagent === true ? { pinnedSubagent: true } : {},
      })
    }
    for (const deferred of this.deferredRestore) {
      if (seen.has(deferred.sessionId)) continue
      seen.add(deferred.sessionId)
      openTabSet.push({ ...deferred })
    }
    const active = this.registry.getActive()
    this.index.setOpenTabs(openTabSet, active?.sessionId)
  }

  private async loadEvents(sessionId: string): Promise<readonly HydratorSessionEvent[]> {
    const override = this.eventOverrides.get(sessionId)
    if (override !== undefined) return override
    if (typeof this.host.readSessionLog !== 'function') return []
    return await this.host.readSessionLog(sessionId) as HydratorSessionEvent[]
  }

  private resolveContinueCapability(_sessionId: string, sessionExists: boolean): ContinueCapability {
    return probeContinueCapability({
      gateVerdict: T0B_GATE_VERDICT,
      sessionExists,
      resumeApiAvailable: this.resumeOverride !== undefined
        || typeof this.host.resumeSession === 'function',
    })
  }

  /**
   * Whether the runtime no longer stores this session's durable data.
   * @param sessionId - session whose read failed.
   * @returns true only when the runtime answered that nothing is stored; an absent
   *   capability or an unanswered stat leaves the read failure as the reported cause.
   */
  private async sessionDataGone(sessionId: string): Promise<boolean> {
    if (typeof this.host.statSession !== 'function') return false
    try {
      return (await this.host.statSession(sessionId)).found === false
    } catch {
      // The read failure this check follows already names the user-visible cause.
      return false
    }
  }

  private projectUserMessage(sessionId: string, text: string, messageId: string, images?: readonly PromptImage[]): void {
    const message: ChatMessage = {
      id: messageId,
      sessionId,
      role: 'user',
      kind: 'text',
      text,
      // The composer's own bytes ride along, so the bubble shows the attachment
      // the user sent without a second read.
      ...images === undefined || images.length === 0
        ? {}
        : { images: images.map(image => ({ mimeType: image.mimeType, data: image.data })) },
    }
    this.messages.append(sessionId, message)
    this.panelHost?.pushAppend(message)
  }

  private projectAssistantMessage(sessionId: string, text: string, reasoning: string | undefined, turn?: number): void {
    if (text === '') return
    const streaming = this.streamingAssistant.get(sessionId)
    if (streaming !== undefined) {
      // Converge the same node with authoritative full text (AC-12 / AC-18).
      this.messages.patch(sessionId, streaming.messageId, {
        text,
        streaming: false,
        incomplete: false,
        ...reasoning === undefined ? {} : { reasoning },
      })
      this.streamingAssistant.delete(sessionId)
      const active = this.registry.getActive()
      if (this.isProjectedSession(active, sessionId)) {
        this.panelHost?.pushPatch(sessionId, streaming.messageId, {
          text,
          streaming: false,
          incomplete: false,
          ...reasoning === undefined ? {} : { reasoning },
        })
      } else {
        const tab = this.registry.getBySessionId(sessionId)
        if (tab !== undefined) this.registry.setUnread(tab.tabId, true)
      }
      this.attributor.noteAssistant(sessionId, streaming.messageId, turn)
      const settleTurn = turn ?? this.attributor.getLatestTurn(sessionId) ?? 0
      this.attributor.clearSettled(sessionId, settleTurn)
      void this.enqueueSettle(sessionId, streaming.messageId, settleTurn)
      return
    }
    const messageId = randomUUID()
    const message: ChatMessage = {
      id: messageId,
      sessionId,
      role: 'assistant',
      kind: 'text',
      text,
      ...reasoning === undefined ? {} : { reasoning },
      ...turn === undefined ? {} : { turn },
    }
    this.messages.append(sessionId, message)
    const active = this.registry.getActive()
    if (this.isProjectedSession(active, sessionId)) {
      this.panelHost?.pushAppend(message)
    } else {
      const tab = this.registry.getBySessionId(sessionId)
      if (tab !== undefined) this.registry.setUnread(tab.tabId, true)
    }
    this.attributor.noteAssistant(sessionId, messageId, turn)
    const settleTurn = turn ?? this.attributor.getLatestTurn(sessionId) ?? 0
    // N-2: re-anchor on each assistant; last wins when settle runs.
    this.attributor.clearSettled(sessionId, settleTurn)
    void this.enqueueSettle(sessionId, messageId, settleTurn)
  }

  /**
   * Close the open assistant bubble of `sessionId` without new text.
   * A step whose `assistant/message` carries no text block (reasoning and tool calls
   * only) still ends its bubble, so the next step starts its own.
   * @param sessionId - session owning the streaming assistant bubble.
   */
  private closeStreamingAssistant(sessionId: string): void {
    const streaming = this.streamingAssistant.get(sessionId)
    if (streaming === undefined) return
    this.streamingAssistant.delete(sessionId)
    const patch = { streaming: false, incomplete: false }
    this.messages.patch(sessionId, streaming.messageId, patch)
    if (this.isProjectedSession(this.registry.getActive(), sessionId)) {
      this.panelHost?.pushPatch(sessionId, streaming.messageId, patch)
    }
  }

  /**
   * Project one live `session.assistant-stream` frame. The runtime publishes raw
   * stream chunks between the durable events of an attempt, so text and
   * reasoning render incrementally instead of waiting for `assistant/message`;
   * the durable message then converges the same bubble.
   * @param sessionId - session whose agent published the frame.
   * @param frame - start, chunk, or end frame off the wire.
   */
  private applyAssistantStreamFrame(sessionId: string, frame: Record<string, unknown>): void {
    const attemptId = typeof frame.attemptId === 'string' ? frame.attemptId : undefined
    if (frame.type === 'start') {
      if (attemptId !== undefined && typeof frame.turn === 'number') {
        this.streamAttemptTurns.set(attemptId, frame.turn)
      }
      return
    }
    if (frame.type === 'chunk') {
      const chunk = asActivityRecord(frame.chunk)
      if (chunk === undefined) return
      const turn = attemptId === undefined ? undefined : this.streamAttemptTurns.get(attemptId)
      this.projectAssistantChunk(sessionId, chunk, turn)
      return
    }
    if (frame.type !== 'end') return
    if (attemptId !== undefined) this.streamAttemptTurns.delete(attemptId)
    // A committed settlement already arrived as `assistant/message` and closed
    // its bubble; abandonment has no durable event, so close it here.
    if (asActivityRecord(frame.outcome)?.kind === 'abandoned') this.closeStreamingAssistant(sessionId)
  }

  /**
   * Project a live `assistant/chunk` text-delta onto a stable assistant bubble (AC-10).
   * Projects reasoning-delta onto the same bubble's reasoning field.
   */
  private projectAssistantChunk(
    sessionId: string,
    chunk: Record<string, unknown>,
    turn: number | undefined,
  ): void {
    if (chunk.type === 'reasoning-delta') {
      const delta = typeof chunk.text === 'string' ? chunk.text : ''
      if (delta === '') return
      let streaming = this.streamingAssistant.get(sessionId)
      if (streaming === undefined) {
        const messageId = randomUUID()
        const message: ChatMessage = {
          id: messageId,
          sessionId,
          role: 'assistant',
          kind: 'text',
          text: '',
          reasoning: delta,
          streaming: true,
          ...turn === undefined ? {} : { turn },
        }
        this.messages.append(sessionId, message)
        this.streamingAssistant.set(sessionId, { messageId, ...turn === undefined ? {} : { turn } })
        streaming = { messageId, ...turn === undefined ? {} : { turn } }
        const active = this.registry.getActive()
        if (this.isProjectedSession(active, sessionId)) {
          this.panelHost?.pushAppend(message)
        } else {
          const tab = this.registry.getBySessionId(sessionId)
          if (tab !== undefined) this.registry.setUnread(tab.tabId, true)
        }
        this.attributor.noteAssistant(sessionId, messageId, turn)
        const tab = this.registry.getBySessionId(sessionId)
        if (tab !== undefined && tab.status !== 'running') {
          this.registry.setStatus(tab.tabId, 'running')
        }
        this.panelHost?.pushStatus()
        return
      }
      this.messages.patch(sessionId, streaming.messageId, { appendReasoning: delta })
      const active = this.registry.getActive()
      if (this.isProjectedSession(active, sessionId)) {
        this.panelHost?.pushPatch(sessionId, streaming.messageId, { appendReasoning: delta })
      }
      return
    }
    if (chunk.type !== 'text-delta') return
    const delta = typeof chunk.text === 'string' ? chunk.text : ''
    if (delta === '') return

    let streaming = this.streamingAssistant.get(sessionId)
    if (streaming === undefined) {
      const messageId = randomUUID()
      const message: ChatMessage = {
        id: messageId,
        sessionId,
        role: 'assistant',
        kind: 'text',
        text: delta,
        streaming: true,
        ...turn === undefined ? {} : { turn },
      }
      this.messages.append(sessionId, message)
      this.streamingAssistant.set(sessionId, { messageId, ...turn === undefined ? {} : { turn } })
      streaming = { messageId, ...turn === undefined ? {} : { turn } }
      const active = this.registry.getActive()
      if (this.isProjectedSession(active, sessionId)) {
        this.panelHost?.pushAppend(message)
      } else {
        const tab = this.registry.getBySessionId(sessionId)
        if (tab !== undefined) this.registry.setUnread(tab.tabId, true)
      }
      this.attributor.noteAssistant(sessionId, messageId, turn)
      // Ensure generating chrome for streaming probe (AC-11).
      const tab = this.registry.getBySessionId(sessionId)
      if (tab !== undefined && tab.status !== 'running') {
        this.registry.setStatus(tab.tabId, 'running')
      }
      this.panelHost?.pushStatus()
      return
    }

    this.messages.patch(sessionId, streaming.messageId, {
      appendText: delta,
      streaming: true,
    })
    const active = this.registry.getActive()
    if (this.isProjectedSession(active, sessionId)) {
      this.panelHost?.pushPatch(sessionId, streaming.messageId, {
        appendText: delta,
        streaming: true,
      })
    } else {
      const tab = this.registry.getBySessionId(sessionId)
      if (tab !== undefined) this.registry.setUnread(tab.tabId, true)
    }
  }

  /**
   * Mark live turn incomplete from `turn/end` aborted/interrupted (AC-13b).
   * Keeps partial assistant text; does not force-reset follow-state.
   * Also converges any still-running activity items to aborted (AC-13c).
   */
  private markTurnIncomplete(sessionId: string, turn: number | undefined): void {
    this.abortRunningActivities(sessionId, turn)

    const streaming = this.streamingAssistant.get(sessionId)
    if (streaming !== undefined) {
      this.messages.patch(sessionId, streaming.messageId, {
        incomplete: true,
        streaming: false,
      })
      const active = this.registry.getActive()
      if (this.isProjectedSession(active, sessionId)) {
        this.panelHost?.pushPatch(sessionId, streaming.messageId, {
          incomplete: true,
          streaming: false,
        })
      }
      this.streamingAssistant.delete(sessionId)
    } else {
      // Fall back: mark last assistant for this turn when present.
      const list = this.messages.get(sessionId)
      const last = [...list].reverse().find(m =>
        m.role === 'assistant'
        && (turn === undefined || m.turn === turn),
      )
      if (last !== undefined && last.incomplete !== true) {
        this.messages.patch(sessionId, last.id, { incomplete: true, streaming: false })
        const active = this.registry.getActive()
        if (this.isProjectedSession(active, sessionId)) {
          this.panelHost?.pushPatch(sessionId, last.id, { incomplete: true, streaming: false })
        }
      }
    }

    const already = this.messages.get(sessionId).some(m =>
      m.kind === 'notice' && m.text === '已停止/未完成',
    )
    if (!already) {
      const notice: ChatMessage = {
        id: randomUUID(),
        sessionId,
        role: 'notice',
        kind: 'notice',
        text: '已停止/未完成',
        ...turn === undefined ? {} : { turn },
      }
      this.messages.append(sessionId, notice)
      const active = this.registry.getActive()
      if (this.isProjectedSession(active, sessionId)) {
        this.panelHost?.pushAppend(notice)
      }
    }

    const tab = this.registry.getBySessionId(sessionId)
    if (tab !== undefined) this.registry.setStatus(tab.tabId, 'idle')
    this.panelHost?.pushStatus()
  }

  /**
   * Append one turn-scoped notice bubble (stop reason, retry, tool-registry change).
   * Notices are deduplicated by exact text so a repeated wire frame cannot stack
   * duplicates.
   * @param sessionId - session whose panel shows the notice.
   * @param text - complete notice text.
   * @param turn - owning turn when the fact is turn-scoped.
   */
  private appendTurnNotice(sessionId: string, text: string, turn?: number): void {
    const already = this.messages.get(sessionId).some(m =>
      m.role === 'notice' && m.text === text && (turn === undefined || m.turn === turn),
    )
    if (already) return
    const notice: ChatMessage = {
      id: randomUUID(),
      sessionId,
      role: 'notice',
      kind: 'notice',
      text,
      ...turn === undefined ? {} : { turn },
    }
    this.messages.append(sessionId, notice)
    if (this.isProjectedSession(this.registry.getActive(), sessionId)) {
      this.panelHost?.pushAppend(notice)
    } else {
      const tab = this.registry.getBySessionId(sessionId)
      if (tab !== undefined) this.registry.setUnread(tab.tabId, true)
    }
  }

  /**
   * Show one user-role message the model saw as context injection. A
   * `source.kind === 'user'` message already has a local optimistic bubble and is
   * skipped; every other producer (agent instructions, goal rounds, schedules,
   * question replies) appears as its own expandable row instead of a user bubble.
   * The row carries the payload in full — the panel bounds what it shows collapsed,
   * so a reader can always open the exact text the model received.
   * @param sessionId - session that received the message.
   * @param data - `user/message` payload.
   * @param turn - owning turn when known.
   */
  private projectInjectedUserMessage(sessionId: string, data: Record<string, unknown>, turn?: number): void {
    const source = asActivityRecord(data.source)
    const kind = typeof source?.kind === 'string' ? source.kind : undefined
    if (kind === undefined || kind === 'user') return
    const text = textFromContent(data.content)
    if (text === '') return
    const already = this.messages.get(sessionId).some(m =>
      m.kind === 'context-injection'
      && m.producer === kind
      && m.text === text
      && (turn === undefined || m.turn === turn),
    )
    if (already) return
    const injection: ChatMessage = {
      id: randomUUID(),
      sessionId,
      role: 'notice',
      kind: 'context-injection',
      producer: kind,
      text,
      ...turn === undefined ? {} : { turn },
    }
    this.messages.append(sessionId, injection)
    if (this.isProjectedSession(this.registry.getActive(), sessionId)) {
      this.panelHost?.pushAppend(injection)
    } else {
      const tab = this.registry.getBySessionId(sessionId)
      if (tab !== undefined) this.registry.setUnread(tab.tabId, true)
    }
  }

  /**
   * Append one command result as a local notice.
   *
   * A command's result is not model-visible input: the runtime logs
   * `command/run` / `command/done`, and this bubble is what the user reads. It is
   * projected through the same append path as every other local notice, so a
   * session that is not on screen keeps the row for when it is.
   * @param sessionId - session whose panel shows the notice.
   * @param text - result or failure text from the command path.
   */
  appendCommandNotice(sessionId: string, text: string): void {
    const notice: ChatMessage = {
      id: randomUUID(),
      sessionId,
      role: 'notice',
      kind: 'notice',
      text,
    }
    this.messages.append(sessionId, notice)
    const active = this.registry.getActive()
    if (this.isProjectedSession(active, sessionId)) {
      this.panelHost?.pushAppend(notice)
    }
  }

  /**
   * Fail-closed: any still-running activity items → aborted (AC-13c).
   * Does **not** revert files.
   */
  private abortRunningActivities(sessionId: string, turn: number | undefined): void {
    const list = this.messages.get(sessionId)
    for (const message of list) {
      if (message.kind !== 'activity') continue
      if (message.activity?.status !== 'running') continue
      if (turn !== undefined && message.turn !== turn && message.activity.turn !== turn) continue
      const patched = this.messages.patch(sessionId, message.id, { activityStatus: 'aborted' })
      if (patched === undefined) continue
      const active = this.registry.getActive()
      if (this.isProjectedSession(active, sessionId)) {
        this.panelHost?.pushPatch(sessionId, message.id, { activityStatus: 'aborted' })
      }
    }
  }

  /**
   * Project `compaction/start` into a running `kind:'compaction'` marker.
   * A repeated start for one compactionId keeps the first marker, matching the replay fold.
   * @param sessionId - owning session.
   * @param data - event payload.
   * @param turn - owning turn when the compaction is enclosed by one.
   */
  private projectCompactionStart(
    sessionId: string,
    data: Record<string, unknown>,
    turn: number | undefined,
  ): void {
    const compactionId = typeof data.compactionId === 'string' ? data.compactionId : undefined
    if (compactionId === undefined) return
    if (this.messages.get(sessionId).some(m => m.id === compactionId)) return
    const message = compactionMarkerMessage(sessionId, compactionId, {
      trigger: turn === undefined ? 'manual' : 'auto',
      status: 'running',
      shadowedTokenCount: 0,
      summary: '',
    }, turn)
    this.messages.append(sessionId, message)
    const active = this.registry.getActive()
    if (this.isProjectedSession(active, sessionId)) {
      this.panelHost?.pushAppend(message)
    } else {
      const tab = this.registry.getBySessionId(sessionId)
      if (tab !== undefined) this.registry.setUnread(tab.tabId, true)
    }
  }

  /**
   * Fill the shadowed token count and display summary on an existing marker.
   * @param sessionId - owning session.
   * @param data - `compaction/summary` payload.
   */
  private projectCompactionSummary(sessionId: string, data: Record<string, unknown>): void {
    const compactionId = typeof data.compactionId === 'string' ? data.compactionId : undefined
    if (compactionId === undefined) return
    const update: MessagePatch = {
      compaction: {
        shadowedTokenCount: typeof data.shadowedTokenCount === 'number'
          ? data.shadowedTokenCount
          : 0,
        summary: compactionSummaryText(data.summary),
      },
    }
    if (this.messages.patch(sessionId, compactionId, update) === undefined) return
    const active = this.registry.getActive()
    if (this.isProjectedSession(active, sessionId)) {
      this.panelHost?.pushPatch(sessionId, compactionId, update)
    }
  }

  /**
   * Close the marker from `compaction/end`. A reported error flips it to failed and
   * raises a banner carrying that error text.
   * @param sessionId - owning session.
   * @param data - `compaction/end` payload.
   */
  private projectCompactionEnd(sessionId: string, data: Record<string, unknown>): void {
    const compactionId = typeof data.compactionId === 'string' ? data.compactionId : undefined
    if (compactionId === undefined) return
    const error = typeof data.error === 'string' ? data.error : undefined
    const update: MessagePatch = {
      compaction: {
        status: error === undefined ? 'done' : 'failed',
        ...error === undefined ? {} : { error },
      },
    }
    if (this.messages.patch(sessionId, compactionId, update) === undefined) return
    const active = this.registry.getActive()
    if (!this.isProjectedSession(active, sessionId)) return
    this.panelHost?.pushPatch(sessionId, compactionId, update)
    if (error === undefined) this.refreshContextPressure(sessionId)
    if (error !== undefined) {
      this.panelHost?.pushBanner(`压缩失败：${error}`, 'compaction-failed')
    }
  }

  /**
   * The `kind:'workflow'` card of one run, when the projection holds it.
   * @param sessionId - owning session.
   * @param runId - durable run identity.
   * @returns the projected card, or undefined when no card was opened for the run.
   */
  private workflowCard(sessionId: string, runId: string): ChatMessage | undefined {
    return this.messages.get(sessionId)
      .find(m => m.kind === 'workflow' && m.workflow?.runId === runId)
  }

  /**
   * Project `tool-workflow/run-start` into a running `kind:'workflow'` card.
   * A repeated start for one runId keeps the first card, matching the replay fold.
   * @param sessionId - owning session.
   * @param data - `tool-workflow/run-start` payload.
   */
  private projectWorkflowRunStart(sessionId: string, data: Record<string, unknown>): void {
    const runId = typeof data.runId === 'string' ? data.runId : undefined
    if (runId === undefined) return
    if (this.workflowCard(sessionId, runId) !== undefined) return
    const message = workflowMarkerMessage(sessionId, {
      runId,
      name: typeof data.name === 'string' ? data.name : '',
      status: 'running',
      members: [],
    })
    this.messages.append(sessionId, message)
    const active = this.registry.getActive()
    if (this.isProjectedSession(active, sessionId)) {
      this.panelHost?.pushAppend(message)
    } else {
      const tab = this.registry.getBySessionId(sessionId)
      if (tab !== undefined) this.registry.setUnread(tab.tabId, true)
    }
  }

  /**
   * Upsert one member on an existing card from `tool-workflow/agent-start`.
   * A repeated seq overwrites that member; the table stays in seq order.
   * @param sessionId - owning session.
   * @param data - `tool-workflow/agent-start` payload.
   */
  private projectWorkflowAgentStart(sessionId: string, data: Record<string, unknown>): void {
    const runId = typeof data.runId === 'string' ? data.runId : undefined
    if (runId === undefined) return
    const card = this.workflowCard(sessionId, runId)
    if (card === undefined) return
    const member = workflowMemberFrom(data)
    if (member === undefined) return
    const update: MessagePatch = {
      workflow: { members: withWorkflowMember(card.workflow?.members ?? [], member) },
    }
    if (this.messages.patch(sessionId, card.id, update) === undefined) return
    const active = this.registry.getActive()
    if (this.isProjectedSession(active, sessionId)) {
      this.panelHost?.pushPatch(sessionId, card.id, update)
    }
  }

  /**
   * Settle one member on an existing card from `tool-workflow/agent-end`.
   * A seq without a projected member is ignored, keeping out-of-order arrivals harmless.
   * @param sessionId - owning session.
   * @param data - `tool-workflow/agent-end` payload.
   */
  private projectWorkflowAgentEnd(sessionId: string, data: Record<string, unknown>): void {
    const runId = typeof data.runId === 'string' ? data.runId : undefined
    if (runId === undefined) return
    const card = this.workflowCard(sessionId, runId)
    if (card === undefined) return
    const members = card.workflow?.members
    if (members === undefined) return
    const seq = typeof data.seq === 'number' ? data.seq : undefined
    const outcome = workflowOutcomeFrom(data.outcome)
    if (seq === undefined || outcome === undefined) return
    if (!members.some(m => m.seq === seq)) return
    const update: MessagePatch = {
      workflow: { members: members.map(m => m.seq === seq ? { ...m, outcome } : { ...m }) },
    }
    if (this.messages.patch(sessionId, card.id, update) === undefined) return
    const active = this.registry.getActive()
    if (this.isProjectedSession(active, sessionId)) {
      this.panelHost?.pushPatch(sessionId, card.id, update)
    }
  }

  /**
   * Close the card from `tool-workflow/run-end`.
   * @param sessionId - owning session.
   * @param data - `tool-workflow/run-end` payload.
   */
  private projectWorkflowRunEnd(sessionId: string, data: Record<string, unknown>): void {
    const runId = typeof data.runId === 'string' ? data.runId : undefined
    if (runId === undefined) return
    const card = this.workflowCard(sessionId, runId)
    if (card === undefined) return
    const stopReason = workflowStopReasonFrom(data.stopReason)
    const update: MessagePatch = {
      workflow: {
        status: 'done',
        ...stopReason === undefined ? {} : { stopReason },
      },
    }
    if (this.messages.patch(sessionId, card.id, update) === undefined) return
    const active = this.registry.getActive()
    if (this.isProjectedSession(active, sessionId)) {
      this.panelHost?.pushPatch(sessionId, card.id, update)
    }
  }

  /**
   * Project tool/call into a conversation-inline activity bubble (AC-20/24).
   */
  private projectToolCallActivity(
    sessionId: string,
    data: Record<string, unknown>,
    turn: number | undefined,
  ): void {
    const turnNumber = turn ?? 0
    const callId = typeof data.callId === 'string' ? data.callId : undefined
    const toolName = typeof data.name === 'string' ? data.name : 'tool'
    const existing = callId === undefined
      ? undefined
      : this.messages.get(sessionId).find(m =>
        m.kind === 'activity' && m.activity?.callId === callId,
      )
    if (existing !== undefined) return

    const ordinal = this.messages.get(sessionId)
      .filter(m => m.kind === 'activity' && (m.turn === turnNumber || m.activity?.turn === turnNumber))
      .length
    const id = activityMessageId(sessionId, turnNumber, callId, ordinal)
    const digest = digestToolCall(toolName, data.arguments)
    const activity: ActivityItem = {
      id,
      sessionId,
      turn: turnNumber,
      ordinal,
      toolName,
      ...callId === undefined ? {} : { callId },
      status: 'running',
      expanded: false,
      summary: digest.summary,
      ...digest.invocation === undefined ? {} : { invocation: digest.invocation },
    }
    const message: ChatMessage = {
      id,
      sessionId,
      role: 'notice',
      kind: 'activity',
      text: `${digest.summary} · running`,
      turn: turnNumber,
      activity,
    }
    this.messages.append(sessionId, message)
    const active = this.registry.getActive()
    if (this.isProjectedSession(active, sessionId)) {
      this.panelHost?.pushAppend(message)
    } else {
      const tab = this.registry.getBySessionId(sessionId)
      if (tab !== undefined) this.registry.setUnread(tab.tabId, true)
    }
  }

  /**
   * Apply tool/result → activity status (done | failed | aborted).
   */
  private projectToolResultActivity(
    sessionId: string,
    data: Record<string, unknown>,
    turn: number | undefined,
  ): void {
    const messageRec = asActivityRecord(data.message)
    const source = asActivityRecord(messageRec?.source)
    const callId = typeof source?.callId === 'string'
      ? source.callId
      : typeof data.callId === 'string'
        ? data.callId
        : typeof messageRec?.callId === 'string'
          ? messageRec.callId
          : undefined
    const status = activityStatusFromToolResult(data)
    const resultText = toolResultText(data)
    const resultPreview = resultText === undefined ? undefined : previewToolResult(resultText)
    const list = this.messages.get(sessionId)
    const target = callId === undefined
      ? [...list].reverse().find(m =>
        m.kind === 'activity'
        && m.activity?.status === 'running'
        && (turn === undefined || m.turn === turn || m.activity?.turn === turn),
      )
      : list.find(m => m.kind === 'activity' && m.activity?.callId === callId)
    if (target === undefined) {
      // Result without prior call (rare) — synthesize a terminal activity.
      if (turn === undefined && callId === undefined) return
      const turnNumber = turn ?? 0
      const ordinal = list.filter(m =>
        m.kind === 'activity' && (m.turn === turnNumber || m.activity?.turn === turnNumber),
      ).length
      const toolName = typeof messageRec?.name === 'string'
        ? messageRec.name
        : typeof data.name === 'string'
          ? data.name
          : 'tool'
      const id = activityMessageId(sessionId, turnNumber, callId, ordinal)
      const activity: ActivityItem = {
        id,
        sessionId,
        turn: turnNumber,
        ordinal,
        toolName,
        ...callId === undefined ? {} : { callId },
        status,
        expanded: false,
        summary: toolName,
        ...resultPreview === undefined ? {} : { resultPreview },
      }
      const message: ChatMessage = {
        id,
        sessionId,
        role: 'notice',
        kind: 'activity',
        text: `${toolName} · ${status}`,
        turn: turnNumber,
        activity,
      }
      this.messages.append(sessionId, message)
      const active = this.registry.getActive()
      if (this.isProjectedSession(active, sessionId)) {
        this.panelHost?.pushAppend(message)
      }
      return
    }
    const patch: MessagePatch = {
      activityStatus: status,
      ...resultPreview === undefined ? {} : { activityResultPreview: resultPreview },
    }
    const patched = this.messages.patch(sessionId, target.id, patch)
    if (patched === undefined) return
    const active = this.registry.getActive()
    if (this.isProjectedSession(active, sessionId)) {
      this.panelHost?.pushPatch(sessionId, target.id, patch)
    }
  }

  /** Fail-closed: clear all in-flight streaming projections (AC-19). */
  private failClosedAllStreaming(banner: string): void {
    const sessionIds = [...this.streamingAssistant.keys()]
    if (sessionIds.length === 0) return
    this.panelHost?.pushBanner(banner, 'stream-fail')
    for (const sessionId of sessionIds) {
      const streaming = this.streamingAssistant.get(sessionId)
      if (streaming === undefined) continue
      this.messages.patch(sessionId, streaming.messageId, { streaming: false })
      const active = this.registry.getActive()
      if (this.isProjectedSession(active, sessionId)) {
        this.panelHost?.pushPatch(sessionId, streaming.messageId, { streaming: false })
      }
      this.streamingAssistant.delete(sessionId)
      const tab = this.registry.getBySessionId(sessionId)
      if (tab !== undefined) this.registry.setStatus(tab.tabId, 'idle')
    }
    this.panelHost?.pushStatus()
  }

  /**
   * Append change-list (+ AC-30 diff-summary when N>0) under the turn's last assistant.
   * @param sessionId - session id.
   * @param sourceMessageId - assistant message id (N-2 anchor).
   * @param turn - turn number.
   */
  private async settleChangeListProjection(
    sessionId: string,
    sourceMessageId: string,
    turn: number,
  ): Promise<void> {
    await this.attributor.settleTurn(sessionId, sourceMessageId, turn)
    // AC-36b: this settle is detached (`void enqueueSettle` from turn/end), so a delete can land
    // at any await below. Each write re-checks the tombstone: a deleted session must not regain
    // change-index files on disk or change-list bubbles in the projection.
    if (this.index.isDeleted(sessionId)) return
    await this.persistChangeIndex(sessionId)
    // AD-CCD-6: best-effort soft-budget prune after snapshot write; never block settle.
    void this.pruneChangeSnapshots().catch(() => {})
    if (this.index.isDeleted(sessionId)) return
    const payload = this.changes.toListPayload(sessionId, turn, sourceMessageId)
    // Replace prior change-list / diff-summary for this turn (multi-assistant re-anchor).
    this.messages.removeWhere(
      sessionId,
      m => (m.kind === 'change-list' || m.kind === 'diff-summary')
        && m.turn === turn,
    )
    const listMessage: ChatMessage = {
      id: randomUUID(),
      sessionId,
      role: 'notice',
      kind: 'change-list',
      text: payload.emptyNotice
        ? CHANGE_LIST_EMPTY_NOTICE
        : `改动了 ${payload.changes.length} 个文件`,
      turn,
      changeList: payload,
    }
    this.messages.append(sessionId, listMessage)

    // N-1 / AC-30: inject diff-summary only when N>0; click reveals *corresponding* list.
    if (!payload.emptyNotice) {
      const summary: ChatMessage = {
        id: randomUUID(),
        sessionId,
        role: 'notice',
        kind: 'diff-summary',
        text: `本回合改了 ${payload.changes.length} 个文件`,
        turn,
        sourceMessageId,
      }
      this.messages.append(sessionId, summary)
    }

    // Full replace so removeWhere is reflected in the Webview (not append-only).
    const active = this.registry.getActive()
    if (this.isProjectedSession(active, sessionId)) {
      this.panelHost?.pushFullState()
    } else {
      const tab = this.registry.getBySessionId(sessionId)
      if (tab !== undefined) this.registry.setUnread(tab.tabId, true)
    }
  }

  private enqueueSettle(sessionId: string, sourceMessageId: string, turn: number): Promise<void> {
    const prev = this.settleChain.get(sessionId) ?? Promise.resolve()
    const next = prev
      .catch(() => {})
      .then(() => this.settleChangeListProjection(sessionId, sourceMessageId, turn))
    this.settleChain.set(sessionId, next)
    return next
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
    if (notification.method === 'subagent.started') {
      const parentSessionId = notification.params.parentSessionId
      const childSessionId = notification.params.childSessionId
      if (typeof parentSessionId !== 'string' || typeof childSessionId !== 'string') return
      this.onSubagentStarted(parentSessionId, childSessionId)
      return
    }
    if (notification.method === 'subagent.finished') {
      const parentSessionId = notification.params.parentSessionId
      const childSessionId = notification.params.childSessionId
      if (typeof parentSessionId !== 'string' || typeof childSessionId !== 'string') return
      void this.onSubagentFinished(parentSessionId, childSessionId)
      return
    }
    if (notification.method === 'session.assistant-stream') {
      const streamSessionId = notification.params.sessionId
      const frame = notification.params.frame
      if (typeof streamSessionId !== 'string') return
      if (typeof frame !== 'object' || frame === null) return
      this.applyAssistantStreamFrame(streamSessionId, frame as Record<string, unknown>)
      return
    }
    if (notification.method !== 'session.event') return
    const sessionId = notification.params.sessionId
    const event = notification.params.event
    if (typeof sessionId !== 'string' || typeof event !== 'object' || event === null) return
    const record = event as Record<string, unknown>
    const data = (record.data as Record<string, unknown> | undefined) ?? {}
    const turn = typeof data.turn === 'number' ? data.turn : undefined

    if (record.type === 'compaction/start') {
      this.projectCompactionStart(sessionId, data, turn)
      return
    }
    if (record.type === 'compaction/summary') {
      this.projectCompactionSummary(sessionId, data)
      return
    }
    if (record.type === 'compaction/end') {
      this.projectCompactionEnd(sessionId, data)
      return
    }
    // compaction/prune: model-free replacement — no model-visible compaction to mark.
    if (record.type === 'compaction/prune') return
    if (record.type === 'tool-workflow/run-start') {
      this.projectWorkflowRunStart(sessionId, data)
      return
    }
    if (record.type === 'tool-workflow/agent-start') {
      this.projectWorkflowAgentStart(sessionId, data)
      return
    }
    if (record.type === 'tool-workflow/agent-end') {
      this.projectWorkflowAgentEnd(sessionId, data)
      return
    }
    if (record.type === 'tool-workflow/run-end') {
      this.projectWorkflowRunEnd(sessionId, data)
      return
    }
    if (record.type === 'tool/call') {
      const args = typeof data.arguments === 'string' ? data.arguments : undefined
      void this.attributor.noteToolCall(sessionId, args)
      this.projectToolCallActivity(sessionId, data, turn)
      return
    }
    if (record.type === 'tool/result') {
      if (turn !== undefined) this.attributor.ingestToolResult(sessionId, turn, data.meta)
      this.projectToolResultActivity(sessionId, data, turn)
      return
    }
    if (record.type === 'assistant/chunk') {
      const chunk = data.chunk as Record<string, unknown> | undefined
      if (chunk === undefined || typeof chunk !== 'object' || chunk === null) return
      this.projectAssistantChunk(sessionId, chunk, turn)
      return
    }
    if (record.type === 'todo/write') {
      const todos = data.todos
      if (Array.isArray(todos)) {
        const items = todos.flatMap((item): TodoStateItem[] => {
          if (typeof item !== 'object' || item === null) return []
          const entry = item as Record<string, unknown>
          return [{
            content: String(entry.content),
            status: entry.status === 'pending' || entry.status === 'in_progress'
              || entry.status === 'completed'
              ? entry.status
              : 'pending',
          }]
        })
        this.todoBySession.set(sessionId, items)
        this.panelHost?.pushTodoState(sessionId, items)
        for (const listener of this.todoListeners) listener()
      }
      return
    }
    if (record.type === 'user/message') {
      this.projectInjectedUserMessage(sessionId, data, turn)
      return
    }
    if (record.type === 'developer/message') {
      const label = toolRegistryChangeLabel(data.message)
      if (label !== undefined) this.appendTurnNotice(sessionId, label, turn)
      return
    }
    if (record.type === 'llm/retry') {
      const failure = asActivityRecord(data.failure)
      const code = typeof failure?.code === 'string' && failure.code !== '' ? `（${failure.code}）` : ''
      const delay = typeof data.delayMs === 'number' && data.delayMs > 0
        ? `，${(data.delayMs / 1000).toFixed(1)}s 后重试`
        : '，即将重试'
      const attempt = typeof data.retry === 'number' && data.retry >= 1 ? `（第 ${data.retry} 次）` : ''
      this.appendTurnNotice(sessionId, `模型调用失败${code}${delay}${attempt}`, turn)
      return
    }
    // Presented-by-design as non-messages, matching the Web chat client: the
    // system prompt stays hidden, `assistant/attempt` settles attempts that
    // produced no visible message, `workspace/changes` carries only a turn marker
    // (the file list lives on the Host), and `image/offload` only affects later
    // model requests.
    if (record.type === 'system/message'
      || record.type === 'assistant/attempt'
      || record.type === 'workspace/changes'
      || record.type === 'image/offload') return
    if (record.type === 'session/title') {
      // The log is the title's source of truth: an explicit rename and an
      // automatic title both reach the panel as this one event.
      const title = data.title
      if (typeof title === 'string' && title !== '') this.applySessionTitle(sessionId, title)
      return
    }
    if (typeof record.type === 'string' && record.type.startsWith('specdev/')) {
      // Every SpecDev event carries a whole post-change view, so the card follows
      // the durable status; re-reading it keeps the card on the file's scalars.
      if (record.type === 'specdev/scope-decided') {
        const decision = data.decision
        const paths = data.paths
        if ((decision === 'once' || decision === 'directory' || decision === 'session') && Array.isArray(paths)) {
          this.specdevLastScope.set(sessionId, {
            decision,
            paths: paths.filter((path): path is string => typeof path === 'string'),
          })
        }
      }
      void this.refreshSpecdev(sessionId)
      return
    }
    if (record.type === 'request/context') {
      const provider = data.provider
      const model = data.model
      if (typeof provider === 'string' && provider !== '' && typeof model === 'string' && model !== '') {
        const contextWindow = data.contextWindow
        this.requestRouteBySession.set(sessionId, {
          provider,
          model,
          ...typeof contextWindow === 'number' && contextWindow > 0 ? { contextWindow } : {},
        })
        this.panelHost?.pushSessionRoute({ sessionId, provider, model })
      }
      return
    }
    if (record.type === 'turn/end') {
      const reason = data.reason as Record<string, unknown> | undefined
      const reasonKind = typeof reason?.kind === 'string' ? reason.kind : undefined
      if (reasonKind === 'aborted' || reasonKind === 'interrupted') {
        this.markTurnIncomplete(sessionId, turn)
      } else if (reasonKind === 'error') {
        this.appendTurnNotice(sessionId, `模型调用失败：${failureLabel(reason?.error)}`, turn)
      } else if (reasonKind === 'max-tokens') {
        this.appendTurnNotice(sessionId, '达到输出上限', turn)
      }
      if (turn === undefined) return
      const assistantId = this.attributor.getLastAssistantId(sessionId)
        ?? this.streamingAssistant.get(sessionId)?.messageId
      if (assistantId !== undefined) {
        this.attributor.clearSettled(sessionId, turn)
        void this.enqueueSettle(sessionId, assistantId, turn)
      } else {
        this.pendingSettleTurn.set(sessionId, turn)
      }
      return
    }
    if (record.type !== 'assistant/message') return
    const usage = data.usage as Record<string, unknown> | undefined
    if (usage !== undefined && typeof usage.inputTokens === 'number'
      && typeof usage.outputTokens === 'number') {
      const inputTokens = usage.inputTokens
      const outputTokens = usage.outputTokens
      const totalTokens = typeof usage.totalTokens === 'number'
        ? usage.totalTokens
        : inputTokens + outputTokens
      const payload: TokenStatusPayload = {
        sessionId,
        inputTokens,
        outputTokens,
        totalTokens,
        ...typeof usage.cacheReadTokens === 'number' ? { cacheReadTokens: usage.cacheReadTokens } : {},
        ...typeof usage.reasoningTokens === 'number' ? { reasoningTokens: usage.reasoningTokens } : {},
        contextWindow: this.requestRouteBySession.get(sessionId)?.contextWindow
          ?? this.resolveContextWindow()
          ?? 128_000,
        thresholdRatio: this.compactionThresholdRatio() ?? 0.8,
      }
      this.lastTokenPayload = payload
      this.panelHost?.pushTokenStatus(payload)
      this.refreshContextPressure(sessionId)
    }
    const message = data.message as Record<string, unknown> | undefined
    const parts = assistantMessageParts(message)
    // AC-6: never invent assistant body when the event has no text. The step still ends
    // here, so close its bubble: a surviving handle would anchor every later step's
    // reasoning and text to this step's position, above that step's tool rows.
    if (parts.text === undefined) {
      this.closeStreamingAssistant(sessionId)
      return
    }
    this.projectAssistantMessage(sessionId, parts.text, parts.reasoning, turn)
    const pending = this.pendingSettleTurn.get(sessionId)
    if (pending !== undefined && turn === pending) {
      this.pendingSettleTurn.delete(sessionId)
    }
  }
}

/**
 * Narrow a raw `contextPressure` projection value to the token-status
 * refinements.
 * @param value - projection value as it crossed the bridge.
 * @returns the fields worth republishing, or `undefined` when none survived.
 */
function contextPressureOf(value: unknown): Partial<TokenStatusPayload> | undefined {
  if (typeof value !== 'object' || value === null) return undefined
  const pressure = value as Record<string, unknown>
  const projectedTokens = typeof pressure.projectedTokens === 'number' && pressure.projectedTokens > 0
    ? pressure.projectedTokens
    : undefined
  const contextWindow = typeof pressure.contextWindow === 'number' && pressure.contextWindow > 0
    ? pressure.contextWindow
    : undefined
  if (projectedTokens === undefined && contextWindow === undefined) return undefined
  return {
    ...projectedTokens === undefined ? {} : { projectedTokens },
    ...contextWindow === undefined ? {} : { contextWindow },
  }
}

/**
 * Visible text and reasoning of one durable assistant message. The log keeps
 * reasoning blocks next to text blocks, so both a settled live bubble and a
 * replayed one recover reasoning from the durable message alone.
 */
function assistantMessageParts(
  message: Record<string, unknown> | undefined,
): { text?: string; reasoning?: string } {
  if (message === undefined) return {}
  const content = message.content
  if (!Array.isArray(content)) return {}
  const text = textFromContent(content)
  const reasoning = reasoningFromContent(content)
  return {
    ...text === '' ? {} : { text },
    ...reasoning === '' ? {} : { reasoning },
  }
}

/** `code: message` label of one `turn/end` failure reason, bounded for the panel. */
function failureLabel(error: unknown): string {
  const record = asActivityRecord(error)
  const code = typeof record?.code === 'string' && record.code !== '' ? record.code : 'UNKNOWN'
  const message = typeof record?.message === 'string' ? record.message.replace(/\s+/g, ' ').trim() : ''
  if (message === '') return code
  return `${code}: ${message.length <= 200 ? message : `${message.slice(0, 199)}…`}`
}

function asActivityRecord(value: unknown): Record<string, unknown> | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined
  return value as Record<string, unknown>
}

/**
 * Find the inclusive seq of the closed turn immediately before `turn`.
 * @param events - fork log events.
 * @param turn - target turn number.
 */
function findPriorClosedBoundary(
  events: ReturnType<typeof asForkLogEvents>,
  turn: number,
): { boundarySeq: number; turn: number } | undefined {
  for (let t = turn - 1; t >= 0; t -= 1) {
    const prior = resolveClosedTurnBoundary(events, { kind: 'closed-turn', turn: t })
    if (prior.ok) {
      return { boundarySeq: prior.boundarySeq, turn: prior.turn }
    }
  }
  return undefined
}

/**
 * Build a minimal synthetic log from MessageStore when cold log is unavailable (L2).
 * @param messages - projected chat messages.
 */
function synthesizeEventsFromMessages(
  messages: readonly ChatMessage[],
): HydratorSessionEvent[] {
  const events: HydratorSessionEvent[] = []
  let seq = 0
  const byTurn = new Map<number, { user?: string; assistant?: string; incomplete?: boolean }>()
  for (const m of messages) {
    if (m.kind !== 'text') continue
    const turn = typeof m.turn === 'number' ? m.turn : 0
    const row = byTurn.get(turn) ?? {}
    if (m.role === 'user') row.user = m.text
    if (m.role === 'assistant') {
      row.assistant = m.text
      if (m.incomplete === true) row.incomplete = true
    }
    byTurn.set(turn, row)
  }
  for (const [turn, row] of [...byTurn.entries()].sort((a, b) => a[0] - b[0])) {
    events.push({ type: 'turn/start', seq: seq++, data: { turn } })
    if (row.user !== undefined) {
      events.push({
        type: 'user/message',
        seq: seq++,
        data: { content: [{ type: 'text', text: row.user }] },
      })
    }
    if (row.assistant !== undefined) {
      events.push({
        type: 'assistant/message',
        seq: seq++,
        data: { message: { content: [{ type: 'text', text: row.assistant }] } },
      })
    }
    events.push({
      type: 'turn/end',
      seq: seq++,
      data: {
        turn,
        reason: row.incomplete === true
          ? { kind: 'aborted', reason: { kind: 'user' } }
          : { kind: 'completed' },
      },
    })
  }
  return events
}
