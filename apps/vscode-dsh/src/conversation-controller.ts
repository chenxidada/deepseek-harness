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
import { EMPTY_LIVE_TITLE } from './conversation-titles.ts'

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
  private stopStatusWatch: (() => void) | undefined
  /** Dedup concurrent auto-restore from Host status transitions. */
  private restoreInFlight: Promise<RestoreOpenTabsResult> | undefined

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
    return continueChromeFor(T0B_GATE_VERDICT, capability, { mode: 'replay', hostReady })
  }

  /**
   * Install L2 test overrides for resume / event loads (does not change product semantics).
   * @param options - optional resume stub and event map.
   */
  installTestHooks(options: {
    resumeSession?: (sessionId: string) => Promise<void>
    eventsBySession?: ReadonlyMap<string, readonly HydratorSessionEvent[]>
  }): void {
    if (options.resumeSession !== undefined) this.resumeOverride = options.resumeSession
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
    const message: ChatMessage = {
      id: randomUUID(),
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
    this.maybeAppendDiffSummary(sessionId, turn)
  }

  /**
   * Append 「本回合改了 N 个文件」 when the latest turn has countable diffs (AC-30).
   * Never forges an entry when N=0.
   * @param sessionId - session that just received an assistant turn.
   * @param turn - optional turn index from the assistant event.
   */
  private maybeAppendDiffSummary(sessionId: string, turn?: number): void {
    const n = this.timeline.changedFileCountForLatestTurn(sessionId)
    if (n <= 0) return
    const message: ChatMessage = {
      id: randomUUID(),
      sessionId,
      role: 'notice',
      kind: 'diff-summary',
      text: `本回合改了 ${n} 个文件`,
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
