/**
 * Auto-ready coordinator: Conversation visible ∧ Host ready → restore / New (AD-CR-3/5/6).
 * Decoupled from Start — never New on activate-only (AC-1a).
 * @module @deepseek-ai/dsh-vscode-dsh/auto-ready-coordinator
 */

import type { ConversationController } from './conversation-controller.ts'
import type { HydratorSessionEvent } from './replay-hydrator.ts'
import { EMPTY_LIVE_TITLE } from './conversation-titles.ts'

/** Options forwarded into restore during AutoReady apply. */
export type AutoReadyRestoreOptions = {
  /** L2: preloaded authoritative events keyed by sessionId. */
  eventsBySession?: ReadonlyMap<string, readonly HydratorSessionEvent[]>
  /** Always false for AutoReady (AC-3); accepted for explicit API. */
  markUnread?: boolean
  /** Always false for AutoReady (AC-3); never invokes Continue. */
  autoContinue?: boolean
}

/** Result of one AutoReady apply / ensure attempt. */
export type AutoReadyApplyResult =
  | { applied: false; reason: 'gated' | 'no-controller' | 'in-flight' }
  | {
    applied: true
    path: 'restore' | 'new' | 'ensure'
    outcome?: string
  }

/** Injected seams for Extension wiring / L1 tests. */
export type AutoReadyDeps = {
  /** Bound ConversationController after Start (undefined until Host up). */
  getController: () => ConversationController | undefined
  /** False when no workspace folder — skip restore, New only (AC-4b / AD-CR-5). */
  hasWorkspaceIndex: () => boolean
  /** Optional push after surface mutation. */
  afterApply?: () => void
}

/**
 * Visibility + hostReady latch that owns restore / New → live.
 * Hide bumps `visibilityEpoch` and clears `readyAppliedForVisibilityEpoch`; the
 * disk restore itself runs once per Extension Host, so a later Hide→Show reuses
 * the Tabs already hydrated here.
 */
export class AutoReadyCoordinator {
  conversationViewVisible = false
  hostReady = false
  readyAppliedForVisibilityEpoch = false
  visibilityEpoch = 0

  private applyInFlight: Promise<AutoReadyApplyResult> | undefined
  /** True once this Extension Host ran its disk restore (or its New fallback). */
  private restoredFromDisk = false

  /**
   * @param deps - controller / workspace predicates from Extension.
   */
  constructor(private readonly deps: AutoReadyDeps) {}

  /**
   * Production visibility entry (also used by `dsh.test.fireConversationVisibility`).
   * @param visible - Conversation WebviewView visibility.
   */
  onVisibilityChanged(visible: boolean): void {
    if (this.conversationViewVisible && !visible) {
      this.visibilityEpoch += 1
      this.readyAppliedForVisibilityEpoch = false
    }
    this.conversationViewVisible = visible
    void this.maybeApplyReady()
  }

  /**
   * Host readiness change (`started` → true; stop / fail → false).
   * @param ready - IdeSessionHost connected via orchestrator snapshot.
   */
  onHostReadyChanged(ready: boolean): void {
    this.hostReady = ready
    void this.maybeApplyReady()
  }

  /**
   * L2: force ready apply when gates already satisfied (`dsh.test.triggerAutoReady`).
   * @param options - optional restore event map / unread flags.
   * @returns apply result.
   */
  async triggerAutoReady(options: AutoReadyRestoreOptions = {}): Promise<AutoReadyApplyResult> {
    return this.maybeApplyReady(options)
  }

  /**
   * Apply restore/New when `visible && hostReady`; else no-op.
   * If a caller awaits an in-flight apply and hide→show cleared
   * `readyAppliedForVisibilityEpoch` meanwhile, re-enter so the new
   * visibility epoch still gets its own apply (AD-CR-3).
   * @param options - optional restore overrides (tests).
   * @returns apply result.
   */
  async maybeApplyReady(options: AutoReadyRestoreOptions = {}): Promise<AutoReadyApplyResult> {
    if (!this.conversationViewVisible || !this.hostReady) {
      return { applied: false, reason: 'gated' }
    }
    if (this.applyInFlight !== undefined) {
      await this.applyInFlight
      // Prior apply settled: re-check gates. A hide→show during flight
      // bumps visibilityEpoch and clears readyApplied — must apply again.
      if (!this.conversationViewVisible || !this.hostReady) {
        return { applied: false, reason: 'gated' }
      }
      if (!this.readyAppliedForVisibilityEpoch) {
        return this.maybeApplyReady(options)
      }
      return { applied: false, reason: 'in-flight' }
    }
    this.applyInFlight = this.applyBody(options)
    try {
      return await this.applyInFlight
    } finally {
      this.applyInFlight = undefined
    }
  }

  private async applyBody(options: AutoReadyRestoreOptions): Promise<AutoReadyApplyResult> {
    const controller = this.deps.getController()
    if (controller === undefined) {
      return { applied: false, reason: 'no-controller' }
    }

    if (this.readyAppliedForVisibilityEpoch || this.restoredFromDisk) {
      // Hide→show keeps the Tabs this Extension Host already hydrated, so a visible flip (editor tab
      // switch) never re-runs the cold restore, which reopens every Tab as read-only replay.
      this.readyAppliedForVisibilityEpoch = true
      return this.ensureReadySurface(controller)
    }
    this.readyAppliedForVisibilityEpoch = true
    this.restoredFromDisk = true

    if (!this.deps.hasWorkspaceIndex()) {
      controller.newConversationOrReuseEmpty(EMPTY_LIVE_TITLE)
      this.suppressUnreadForAutoReady(controller)
      this.deps.afterApply?.()
      return { applied: true, path: 'new' }
    }

    const restored = await controller.restoreOpenTabSet({
      markUnread: false,
      autoContinue: false,
      ...options.eventsBySession === undefined
        ? {}
        : { eventsBySession: options.eventsBySession },
    })
    // AutoReady never Continue (AC-3); autoContinue option is accepted then ignored.
    void options.autoContinue
    void options.markUnread

    if (restored.outcome === 'empty') {
      controller.newConversationOrReuseEmpty(EMPTY_LIVE_TITLE)
      this.suppressUnreadForAutoReady(controller)
      this.deps.afterApply?.()
      return { applied: true, path: 'new', outcome: restored.outcome }
    }

    this.suppressUnreadForAutoReady(controller)
    this.deps.afterApply?.()
    return {
      applied: true,
      path: restored.outcome === 'restored' ? 'restore' : 'new',
      outcome: restored.outcome,
    }
  }

  /**
   * Idempotent surface for AC-6: only New/reuse when no Tabs or active Tab is empty.
   * Never stacks a New when the active Tab already has content.
   * @param controller - bound conversation controller.
   */
  private ensureReadySurface(controller: ConversationController): AutoReadyApplyResult {
    const tabs = controller.registry.list()
    const active = controller.registry.getActive()
    const emptyActive = active !== undefined && !controller.messages.hasContent(active.sessionId)
    if (tabs.length === 0 || emptyActive) {
      controller.newConversationOrReuseEmpty(EMPTY_LIVE_TITLE)
      this.suppressUnreadForAutoReady(controller)
      this.deps.afterApply?.()
    }
    return { applied: true, path: 'ensure' }
  }

  /**
   * Clear unread on every open Tab after AutoReady restore/New (AC-3/4).
   * @param controller - bound conversation controller.
   */
  suppressUnreadForAutoReady(controller: ConversationController): void {
    for (const tab of controller.registry.list()) {
      controller.registry.setUnread(tab.tabId, false)
    }
  }
}
