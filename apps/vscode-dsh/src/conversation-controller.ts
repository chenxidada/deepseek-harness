/**
 * Conversation controller: Tab registry + IdeSessionHost prompt routing,
 * recoverable close vs explicit delete (AD-CU-3), and MessageStore fan-out.
 * @module @deepseek-ai/dsh-vscode-dsh/conversation-controller
 */

import { randomUUID } from 'node:crypto'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
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
  activityMessageId,
  activityStatusFromToolResult,
  type ActivityItem,
} from './chat-panel/activity-types.ts'
import {
  ExtensionIndex,
  type OpenTabRecord,
  type WorkspaceStateLike,
} from './extension-index.ts'
import type { ChatPanelHost } from './chat-panel/chat-panel-host.ts'
import {
  hydrateFromAuthoritativeLog,
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

/** Optional ChangeList / SnapshotStore wiring (phase-2). */
export interface ConversationChangeOptions {
  /** Extension-local SnapshotStore (defaults to tmpdir-based store for L2). */
  snapshotStore?: SnapshotStore
  /** Workspace text reader for full-file after-images (DEBT-CCD-001). */
  readWorkspaceText?: (path: string) => Promise<string | undefined>
  /** Ignore / workspace-root options (AD-CCD-8). */
  getIgnoreOptions?: () => IgnoreRulesOptions
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
  /** sessionId → turn awaiting assistant before settle. */
  private pendingSettleTurn = new Map<string, number>()
  /** Serialize per-session settle to keep last-assistant anchoring stable. */
  private settleChain = new Map<string, Promise<void>>()
  /** Live streaming assistant bubble id per session (stable across chunks). */
  private streamingAssistant = new Map<string, { messageId: string; turn?: number }>()
  /** Duck-typed workspace write surface for revert (AD-CCD-10); set by extension / L2. */
  private revertWorkspace: RevertWorkspace | undefined

  /**
   * @param host - window-scoped ide process owner (one process, many sessionIds).
   * @param workspaceState - optional workspaceState for immediate index writes.
   * @param workspaceKey - workspace identity key for the index.
   * @param changeOptions - optional SnapshotStore / workspace readers.
   */
  constructor(
    private readonly host: IdeSessionHost,
    workspaceState?: WorkspaceStateLike,
    workspaceKey = '',
    changeOptions?: ConversationChangeOptions,
  ) {
    this.index = new ExtensionIndex(workspaceKey, workspaceState)
    this.snapshotStore = changeOptions?.snapshotStore
      ?? new SnapshotStore({ storageRoot: join(tmpdir(), 'dsh-vscode-dsh-changes') })
    this.readWorkspaceText = changeOptions?.readWorkspaceText
      ?? (async () => undefined)
    this.getIgnoreOptions = changeOptions?.getIgnoreOptions
      ?? (() => ({ workspaceFolders: [] }))
    this.attributor = new ChangeAttributor({
      changeStore: this.changes,
      snapshotStore: this.snapshotStore,
      getIgnoreOptions: () => this.getIgnoreOptions(),
      readWorkspaceText: (path) => this.readWorkspaceText(path),
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
    this.panelHost?.pushFullState()
  }

  /**
   * Open a workspace history session as a replay Tab (AC-30/64/65).
   * Reuses an existing open Tab by sessionId; otherwise mints a new tabId.
   * @param sessionId - session to open from the extension index / authority log.
   * @param options - optional preloaded events (tests) bypassing bridge read.
   */
  async openFromHistory(
    sessionId: string,
    options: { events?: readonly HydratorSessionEvent[] } = {},
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
    const title = indexRow?.title ?? indexRow?.firstUserPreview ?? `Replay ${sessionId.slice(0, 8)}`

    let events: readonly HydratorSessionEvent[]
    if (options.events !== undefined) {
      events = options.events
    } else if (this.host.status !== 'connected' || typeof this.host.readSessionLog !== 'function') {
      return { outcome: 'host-not-ready', sessionId }
    } else {
      try {
        events = await this.host.readSessionLog(sessionId) as HydratorSessionEvent[]
      } catch (error) {
        return {
          outcome: 'error',
          sessionId,
          error: error instanceof Error ? error.message : String(error),
        }
      }
    }

    const tab = this.registry.create(title, sessionId, 'replay')
    this.host.interactions.onActiveSessionChange?.(tab.sessionId)
    const hydrated = hydrateFromAuthoritativeLog(sessionId, events)
    this.messages.replace(sessionId, hydrated.messages)
    this.timeline.replace(sessionId, hydrated.timelineItems)
    await this.hydrateChangeListsFromIndex(sessionId)
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
    let hydrated: Array<{ tabId: string; sessionId: string; mode: 'replay'; messageCount: number }> = []
    let strippedSessionIds: string[] = []
    try {
      // Probe content for each persisted row (hydrate once into a cache).
      const contentCache = new Map<string, {
        events: readonly HydratorSessionEvent[]
        messages: ReturnType<typeof hydrateFromAuthoritativeLog>['messages']
        timeline: ReturnType<typeof hydrateFromAuthoritativeLog>['timelineItems']
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
        sessionId => {
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
        uiSet.push(deferred.splice(idx, 1)[0]!)
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

      // Unload any leftover live Tabs before reopening as replay (cold restore).
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
        this.messages.replace(record.sessionId, cached.messages)
        this.timeline.replace(record.sessionId, cached.timeline)
        // AC-22: cold restore must hydrate change-list path/stats like openFromHistory.
        await this.hydrateChangeListsFromIndex(record.sessionId)
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
      return {
        outcome: 'restored',
        hydrated: [],
        deferredSessionIds: [],
        strippedSessionIds: [],
        ...this.registry.getActive() === undefined
          ? {}
          : {
            activeSessionId: this.registry.getActive()!.sessionId,
            activeTabId: this.registry.getActive()!.tabId,
          },
      }
    }
    const take = all ? this.deferredRestore.splice(0) : [this.deferredRestore.shift()!]
    const hydrated: Array<{ tabId: string; sessionId: string; mode: 'replay'; messageCount: number }> = []
    for (const record of take) {
      if (this.registry.getBySessionId(record.sessionId) !== undefined) continue
      const overrideEvents = this.eventOverrides.get(record.sessionId)
      const opened = await this.openFromHistory(
        record.sessionId,
        overrideEvents === undefined ? {} : { events: overrideEvents },
      )
      if (opened.outcome === 'opened' || opened.outcome === 'activated') {
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

    try {
      if (this.resumeOverride !== undefined) {
        await this.resumeOverride(tab.sessionId)
      } else if (typeof this.host.resumeSession === 'function') {
        await this.host.resumeSession(tab.sessionId)
      } else {
        return { outcome: 'disabled', tooltip: '暂不可用' }
      }
    } catch (error) {
      return {
        outcome: 'error',
        error: error instanceof Error ? error.message : String(error),
      }
    }

    this.registry.setMode(tab.tabId, 'live')
    const capability = chrome.capability ?? 'same-id'
    this.index.upsertSession({
      sessionId: tab.sessionId,
      title: tab.title ?? `Conversation ${tab.sessionId.slice(0, 8)}`,
      mtime: Date.now(),
      continueCapability: capability,
    })
    this.persistOpenTabs()
    const banner = capability === 'derive-only'
      ? `新会话 · 接续自 ${tab.sessionId.slice(0, 8)}`
      : undefined
    if (banner !== undefined) {
      this.panelHost?.pushBanner(banner, 'continue-derive')
    }
    this.panelHost?.pushFullState()
    return {
      outcome: 'continued',
      tabId: tab.tabId,
      sessionId: tab.sessionId,
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
    if (tab.mode !== 'replay') {
      return continueChromeFor(T0B_GATE_VERDICT, 'unknown', { mode: 'live', hostReady })
    }
    const row = this.index.read().sessions.find(s => s.sessionId === tab.sessionId)
    const capability = row?.continueCapability
      ?? this.resolveContinueCapability(tab.sessionId, this.messages.hasContent(tab.sessionId))
    return continueChromeFor(T0B_GATE_VERDICT, capability, {
      mode: 'replay',
      hostReady,
      continueSealed: this.continueSealedSessions.has(tab.sessionId),
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
    const row = this.index.read().sessions.find(s => s.sessionId === active.sessionId)
    if (row?.parentSessionId === undefined) return undefined
    const parent = this.index.read().sessions.find(s => s.sessionId === row.parentSessionId)
    return parent?.title ?? row.forkLabel ?? `派生自 ${row.parentSessionId.slice(0, 8)}`
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
        if (typeof messages[i]?.turn === 'number') {
          inferredTurn = messages[i]!.turn
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
    this.projectAssistantMessage(sessionId, text)
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
    const result = await executeRevert(deps, changeId, { skipWrite: options.skipWrite })
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
      confirmGate: options.confirmGate,
      skipWrite: options.skipWrite,
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
    await writeChangeIndex(
      this.snapshotStore.storageRoot,
      sessionId,
      this.changes.list(sessionId),
    )
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
      const sourceMessageId = turnRecords[0]!.sourceMessageId
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
   * Locate a Timeline short-label target for scroll/reveal (AC-56 Should).
   * Priority: tool-triggered user → that turn's assistant → none.
   * @param sessionId - session to search.
   * @param callId - optional tool call id that triggered the reveal.
   */
  revealTarget(
    sessionId: string,
    callId?: string,
  ): { kind: 'user' | 'assistant' | 'none'; messageId?: string; label?: string } {
    const messages = this.messages.get(sessionId)
    if (callId !== undefined) {
      const tools = this.timeline.itemsForSession(sessionId).filter(item => item.callId === callId)
      if (tools.length > 0) {
        const user = [...messages].reverse().find(m => m.role === 'user')
        if (user !== undefined) return { kind: 'user', messageId: user.id, label: user.text.slice(0, 40) }
        const assistant = [...messages].reverse().find(m => m.role === 'assistant')
        if (assistant !== undefined) {
          return { kind: 'assistant', messageId: assistant.id, label: assistant.text.slice(0, 40) }
        }
      }
    }
    const user = [...messages].reverse().find(m => m.role === 'user')
    if (user !== undefined) return { kind: 'user', messageId: user.id, label: user.text.slice(0, 40) }
    const assistant = [...messages].reverse().find(m => m.role === 'assistant')
    if (assistant !== undefined) {
      return { kind: 'assistant', messageId: assistant.id, label: assistant.text.slice(0, 40) }
    }
    return { kind: 'none' }
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
    this.attributor.clearSession(tab.sessionId)
    await this.snapshotStore.clearSession(tab.sessionId)
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
    this.attributor.clearSession(sessionId)
    await this.snapshotStore.clearSession(sessionId)
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
   * Panel-facing snapshot for L2 hooks (mode / messages / status / Continue).
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
    return {
      mode: active.mode,
      sessionId: active.sessionId,
      tabId: active.tabId,
      ...active.title === undefined ? {} : { title: active.title },
      messages: this.messages.get(active.sessionId),
      tabStatus: active.status,
      index: this.index.read(),
      continue: this.continueChromeForTab(active.tabId),
      deferredRestoreCount: this.deferredRestore.length,
      pendingRestore: this.pendingRestoreLatch,
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
    this.timeline.clear()
    this.messages.clear()
    this.changes.clear()
    this.registry.clear()
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
    const streaming = this.streamingAssistant.get(sessionId)
    if (streaming !== undefined) {
      // Converge the same node with authoritative full text (AC-12 / AC-18).
      this.messages.patch(sessionId, streaming.messageId, {
        text,
        streaming: false,
        incomplete: false,
      })
      this.streamingAssistant.delete(sessionId)
      const active = this.registry.getActive()
      if (active !== undefined && active.sessionId === sessionId) {
        this.panelHost?.pushPatch(sessionId, streaming.messageId, {
          text,
          streaming: false,
          incomplete: false,
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
      ...turn === undefined ? {} : { turn },
    }
    this.messages.append(sessionId, message)
    const active = this.registry.getActive()
    if (active !== undefined && active.sessionId === sessionId) {
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
   * Project a live `assistant/chunk` text-delta onto a stable assistant bubble (AC-10).
   * Ignores reasoning-delta (AD-CUX-7 / T6 lock B).
   */
  private projectAssistantChunk(
    sessionId: string,
    chunk: Record<string, unknown>,
    turn: number | undefined,
  ): void {
    if (chunk.type === 'reasoning-delta') return
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
      this.streamingAssistant.set(sessionId, { messageId, turn })
      streaming = { messageId, turn }
      const active = this.registry.getActive()
      if (active !== undefined && active.sessionId === sessionId) {
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
    if (active !== undefined && active.sessionId === sessionId) {
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
      if (active !== undefined && active.sessionId === sessionId) {
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
        if (active !== undefined && active.sessionId === sessionId) {
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
      if (active !== undefined && active.sessionId === sessionId) {
        this.panelHost?.pushAppend(notice)
      }
    }

    const tab = this.registry.getBySessionId(sessionId)
    if (tab !== undefined) this.registry.setStatus(tab.tabId, 'idle')
    this.panelHost?.pushStatus()
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
      if (active !== undefined && active.sessionId === sessionId) {
        this.panelHost?.pushPatch(sessionId, message.id, { activityStatus: 'aborted' })
      }
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
    const activity: ActivityItem = {
      id,
      sessionId,
      turn: turnNumber,
      ordinal,
      toolName,
      ...callId === undefined ? {} : { callId },
      status: 'running',
      expanded: false,
      summary: toolName,
    }
    const message: ChatMessage = {
      id,
      sessionId,
      role: 'notice',
      kind: 'activity',
      text: `${toolName} · running`,
      turn: turnNumber,
      activity,
    }
    this.messages.append(sessionId, message)
    const active = this.registry.getActive()
    if (active !== undefined && active.sessionId === sessionId) {
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
      if (active !== undefined && active.sessionId === sessionId) {
        this.panelHost?.pushAppend(message)
      }
      return
    }
    const patched = this.messages.patch(sessionId, target.id, { activityStatus: status })
    if (patched === undefined) return
    const active = this.registry.getActive()
    if (active !== undefined && active.sessionId === sessionId) {
      this.panelHost?.pushPatch(sessionId, target.id, { activityStatus: status })
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
      if (active !== undefined && active.sessionId === sessionId) {
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
    await this.persistChangeIndex(sessionId)
    // AD-CCD-6: best-effort soft-budget prune after snapshot write; never block settle.
    void this.pruneChangeSnapshots().catch(() => {})
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
    if (active !== undefined && active.sessionId === sessionId) {
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
    if (notification.method !== 'session.event') return
    const sessionId = notification.params.sessionId
    const event = notification.params.event
    if (typeof sessionId !== 'string' || typeof event !== 'object' || event === null) return
    const record = event as Record<string, unknown>
    const data = (record.data as Record<string, unknown> | undefined) ?? {}
    const turn = typeof data.turn === 'number' ? data.turn : undefined

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
    if (record.type === 'turn/end') {
      const reason = data.reason as Record<string, unknown> | undefined
      const reasonKind = typeof reason?.kind === 'string' ? reason.kind : undefined
      if (reasonKind === 'aborted' || reasonKind === 'interrupted') {
        this.markTurnIncomplete(sessionId, turn)
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
    const message = data.message as Record<string, unknown> | undefined
    const text = firstAssistantText(message)
    // AC-6: never invent assistant body when the event has no text.
    if (text === undefined) return
    this.projectAssistantMessage(sessionId, text, turn)
    const pending = this.pendingSettleTurn.get(sessionId)
    if (pending !== undefined && turn === pending) {
      this.pendingSettleTurn.delete(sessionId)
    }
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
