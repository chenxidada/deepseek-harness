/**
 * Host-side pending interaction coordinator: Tab association, AD-CU-7 serial
 * soft-priority queue, and fail-closed settle.
 * @module @deepseek-ai/dsh-vscode-dsh/interaction-coordinator
 */

import {
  isApprovalOutcome,
  type ApprovalOutcome,
  type AskUserQuestionAnswer,
  type AskUserQuestionItem,
} from '@deepseek-ai/dsh-ide-bridge'
import { randomUUID } from 'node:crypto'
import type { ConversationRegistry } from './conversation-registry.ts'

/**
 * Why a programmatic approval answer was refused (AD-12).
 *
 * One vocabulary for the whole `dsh.test.answerApproval` surface, so a driver reads
 * a single shape whether the refusal came from the argument boundary
 * (`invalid-id` / `no-host`) or from the coordinator (`unknown-id` /
 * `invalid-outcome`).
 */
export type ApprovalRefusalReason = 'invalid-id' | 'no-host' | 'unknown-id' | 'invalid-outcome'

/** Result of answering an approval by id, without a UI round trip (AD-12). */
export type ApprovalResolution =
  | { ok: true; id: string; outcome: ApprovalOutcome }
  | { ok: false; reason: ApprovalRefusalReason }

/** Inbound approval request from the runtime bridge. */
export interface HostApprovalRequest {
  /** Correlation id for the response frame. */
  id: string
  /** SDK session identity (Tab binding). */
  sessionId: string
  /** Tool name requiring a decision. */
  toolName: string
  /** Optional asker reason. */
  reason?: string
  /** Tab id resolved via {@link ConversationRegistry.getBySessionId}, when known. */
  tabId?: string
}

/** Inbound user-questions request from the runtime bridge. */
export interface HostQuestionsRequest {
  /** Correlation id for the response frame. */
  id: string
  /** SDK session identity (Tab binding). */
  sessionId: string
  /** Questions to present. */
  questions: AskUserQuestionItem[]
  /** Tab id resolved via registry, when known. */
  tabId?: string
}

/** Pluggable UI surface for approvals and questions (VS Code QuickPick / tests). */
export interface InteractionUi {
  /**
   * Present an approval and return a legal outcome.
   * @param request - Host approval request bound to a Tab when possible.
   * @param signal - abort when Host fail-closes or demotes on Tab switch; UI must hide.
   */
  presentApproval(request: HostApprovalRequest, signal?: AbortSignal): Promise<ApprovalOutcome>
  /**
   * Present questions and return a legal answer, or throw to fail-closed.
   * @param request - Host questions request bound to a Tab when possible.
   * @param signal - abort when Host fail-closes or demotes on Tab switch; UI must hide.
   */
  presentQuestions(request: HostQuestionsRequest, signal?: AbortSignal): Promise<AskUserQuestionAnswer>
}

/** Queue / presentation state for one Host interaction (AD-CU-7). */
export type InteractionPresentationState = 'pending' | 'presented' | 'resolved' | 'abort'

/**
 * Expiry reason the coordinator attaches to a retired wait's abort signal.
 *
 * The presenter that closes the card is the one that knows whether the wait ended
 * with an answer or because the runtime gave up, so the reason rides the signal it
 * already listens on instead of a side table the QuickPick path would never drain.
 */
export interface InteractionExpiry {
  /** Stable lower-kebab-case code the runtime reported (`timeout`). */
  readonly interactionExpired: string
}

/**
 * Read the expiry code a retired wait's abort signal carries.
 * @param signal - abort signal the coordinator passed to a presenter.
 * @returns the code, or undefined when the wait ended any other way.
 */
export function readInteractionExpiry(signal: AbortSignal | undefined): string | undefined {
  const reason: unknown = signal?.reason
  if (typeof reason !== 'object' || reason === null) return undefined
  const code = (reason as { interactionExpired?: unknown }).interactionExpired
  return typeof code === 'string' && code !== '' ? code : undefined
}

/**
 * One Host interaction wait (queued or presented). An approval carries the tool
 * it asks about and, when the runtime supplied one, its reason — so a reader of
 * this projection can identify the wait without reaching into the queue (AD-13).
 */
export type PendingHostInteraction =
  | {
    kind: 'approval'
    id: string
    sessionId: string
    tabId?: string
    state: InteractionPresentationState
    abort: AbortController
    /** Tool the runtime asked approval for, verbatim. */
    toolName: string
    /** Runtime-supplied reason for the request, when it sent one. */
    reason?: string
  }
  | {
    kind: 'questions'
    id: string
    sessionId: string
    tabId?: string
    state: InteractionPresentationState
    abort: AbortController
  }

type ApprovalEntry = {
  kind: 'approval'
  id: string
  sessionId: string
  tabId?: string
  state: InteractionPresentationState
  abort: AbortController
  demoted: boolean
  settled: boolean
  toolName: string
  reason?: string
  resolve: (outcome: ApprovalOutcome) => void
}

type QuestionsEntry = {
  kind: 'questions'
  id: string
  sessionId: string
  tabId?: string
  state: InteractionPresentationState
  abort: AbortController
  demoted: boolean
  settled: boolean
  questions: AskUserQuestionItem[]
  resolve: (answer: AskUserQuestionAnswer) => void
  reject: (error: Error) => void
}

type QueueEntry = ApprovalEntry | QuestionsEntry

/** Queue and fail-closed state of one {@link InteractionCoordinator} (test hooks / diagnostics). */
export interface InteractionCoordinatorDebug {
  /** Identity of the coordinator that produced this snapshot. */
  instanceId: string
  /** Projected queue entries, including the settle flag the reader shape omits. */
  queue: Array<{ id: string; sessionId: string; tabId?: string; state: string; settled: boolean }>
  /** Last {@link InteractionCoordinator.failClosedSession} call, so a drain that matched nothing is visible. */
  lastFailClosed?: { instanceId: string; sessionId: string; matched: number; queueLength: number }
}

/**
 * Routes bridge interaction frames to the correct Tab and UI with a global
 * serial soft-priority presentation queue (AD-CU-7).
 */
export class InteractionCoordinator {
  /** Identity of this coordinator instance. */
  readonly instanceId: string = randomUUID()
  private readonly queue: QueueEntry[] = []
  private presentedId: string | undefined
  private pumping = false
  private ui: InteractionUi | undefined
  private registry: ConversationRegistry | undefined
  private activeSessionId: string | undefined
  private lastError: string | undefined
  private lastFailClosed: InteractionCoordinatorDebug['lastFailClosed']
  private readonly listeners = new Set<() => void>()

  /**
   * Install the UI presenter (Extension QuickPick panels or test doubles).
   * @param ui - approval / questions presenter.
   */
  setUi(ui: InteractionUi): void {
    this.ui = ui
  }

  /**
   * Bind the conversation registry used for sessionId → Tab routing (AC-10).
   * @param registry - window Tab registry, or `undefined` to clear.
   */
  setRegistry(registry: ConversationRegistry | undefined): void {
    this.registry = registry
    this.activeSessionId = registry?.getActive()?.sessionId
  }

  /**
   * Notify the coordinator that the active Tab changed (AC-58 / AD-CU-7).
   * Unanswered presented UI demotes to pending (badge kept); target pending wakes.
   * @param sessionId - newly active session, or `undefined` when no Tab.
   */
  onActiveSessionChange(sessionId: string | undefined): void {
    const previousActive = this.activeSessionId
    this.activeSessionId = sessionId
    const presented = this.presentedEntry()
    if (
      presented !== undefined
      && presented.state === 'presented'
      && !presented.settled
      && presented.sessionId !== sessionId
    ) {
      // Unanswered → close popup, back to pending (do not settle bridge response).
      presented.demoted = true
      presented.state = 'pending'
      presented.abort.abort()
      presented.abort = new AbortController()
      this.presentedId = undefined
      this.syncApprovalBadges()
      this.emit()
    } else if (previousActive !== sessionId) {
      this.syncApprovalBadges()
    }
    void this.pump()
  }

  /**
   * Subscribe to pending interaction mutations (panel waiting-interaction status).
   * @param listener - called after pending set/clear.
   * @returns disposer.
   */
  onChange(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  /**
   * Last fail-closed / transport error for status UI (AC-30).
   * @returns redacted-ready diagnostic, or `undefined`.
   */
  getLastError(): string | undefined {
    return this.lastError
  }

  /**
   * Snapshot of in-flight interaction ids (tests / status / badges).
   * @returns pending + presented entries (not resolved/abort); an approval entry
   * carries its `toolName` and, when supplied, its `reason` (AD-13).
   */
  listPending(): readonly PendingHostInteraction[] {
    return this.queue
      .filter(entry => entry.state === 'pending' || entry.state === 'presented')
      .map(entry => this.projectEntry(entry))
  }

  /**
   * Read the queue plus the last fail-closed call of this coordinator (test hooks / status).
   * `listPending` alone cannot show which coordinator answered a drain, so a queue that
   * outlives its Tab needs the instance id, the settle flags and the drain's own record.
   * @returns the instance id, the projected queue, and the last fail-closed record.
   */
  debugSnapshot(): InteractionCoordinatorDebug {
    return {
      instanceId: this.instanceId,
      queue: this.queue.map(entry => ({
        id: entry.id,
        sessionId: entry.sessionId,
        ...entry.tabId === undefined ? {} : { tabId: entry.tabId },
        state: entry.state,
        settled: entry.settled,
      })),
      ...this.lastFailClosed === undefined ? {} : { lastFailClosed: this.lastFailClosed },
    }
  }

  /**
   * Project one queue entry into the read-only shape readers receive.
   * @param entry - queue entry to project.
   * @returns the projection of `entry`, keeping the queue's plumbing private.
   */
  private projectEntry(entry: QueueEntry): PendingHostInteraction {
    if (entry.kind === 'questions') {
      return {
        kind: entry.kind,
        id: entry.id,
        sessionId: entry.sessionId,
        state: entry.state,
        abort: entry.abort,
        ...entry.tabId === undefined ? {} : { tabId: entry.tabId },
      }
    }
    return {
      kind: entry.kind,
      id: entry.id,
      sessionId: entry.sessionId,
      state: entry.state,
      abort: entry.abort,
      toolName: entry.toolName,
      ...entry.tabId === undefined ? {} : { tabId: entry.tabId },
      ...entry.reason === undefined ? {} : { reason: entry.reason },
    }
  }

  /**
   * Whether a session has pending or presented interactions (approval badge).
   * @param sessionId - SDK session identity.
   */
  hasPendingForSession(sessionId: string): boolean {
    return this.queue.some(
      entry =>
        entry.sessionId === sessionId
        && (entry.state === 'pending' || entry.state === 'presented'),
    )
  }

  /**
   * Resolve Tab binding for a session id without recording an answer on the wrong Tab.
   * @param sessionId - SDK session identity from the bridge frame.
   * @returns tabId when known.
   */
  resolveTabId(sessionId: string): string | undefined {
    return this.registry?.getBySessionId(sessionId)?.tabId
  }

  /**
   * Answer one approval by id without a UI round trip (AD-12).
   *
   * The unattended smoke driver cannot depend on QuickPick focus in a headless
   * Extension Development Host, so this settles the same wait the UI would have
   * settled, with the same {@link ApprovalOutcome} vocabulary — the bridge cannot
   * tell the two paths apart. A popup already on screen is dismissed through the
   * entry's own abort signal.
   *
   * @param id - interaction id the runtime asked approval for.
   * @param outcome - a legal `ApprovalOutcome`; validated here so no caller can put
   *   a value outside the vocabulary on the wire.
   * @returns the answer that was sent, or why none was sent. `unknown-id` covers
   *   both ids that never existed and ids already failed closed (Host shutdown /
   *   Tab close) — an aborted wait is not answerable, and saying so is the point.
   */
  resolveApproval(id: string, outcome: unknown): ApprovalResolution {
    const entry = this.queue.find(
      (candidate): candidate is ApprovalEntry =>
        candidate.id === id && candidate.kind === 'approval',
    )
    if (entry === undefined) return { ok: false, reason: 'unknown-id' }
    if (!isApprovalOutcome(outcome)) return { ok: false, reason: 'invalid-outcome' }
    // Settle first, then dismiss: `abort` also resolves the presentation loop's
    // race with `unavailable`, and that path must find this entry already settled
    // or it would answer the runtime a second time.
    this.finishApproval(entry, outcome)
    entry.abort.abort()
    return { ok: true, id, outcome }
  }

  /**
   * Answer one question interaction by id without a UI round trip (phase-5 panel interaction).
   * @param id - interaction id.
   * @param answer - user answers.
   * @returns true when settled, false when unknown.
   */
  resolveQuestions(id: string, answer: AskUserQuestionAnswer): boolean {
    const entry = this.queue.find(
      (candidate): candidate is QuestionsEntry =>
        candidate.id === id && candidate.kind === 'questions',
    )
    if (entry === undefined) return false
    this.finishQuestions(entry, answer)
    entry.abort.abort()
    return true
  }

  /**
   * Retire one interaction the runtime is no longer waiting for.
   *
   * The wait settles without a Host answer, so a later click on its card cannot
   * reach the wire; the abort signal carries the runtime's reason so the present
   * card can say why it stopped accepting an answer instead of vanishing.
   * @param id - interaction id the runtime gave up on.
   * @param reason - stable lower-kebab-case code the runtime reported.
   * @returns true when an in-flight entry was retired, false when the id was unknown.
   */
  expire(id: string, reason: string): boolean {
    const entry = this.queue.find(candidate => candidate.id === id)
    if (entry === undefined || entry.settled) return false
    entry.settled = true
    entry.state = 'abort'
    this.removeEntry(id)
    entry.abort.abort({ interactionExpired: reason } satisfies InteractionExpiry)
    if (entry.kind === 'approval') entry.resolve('unavailable')
    else entry.reject(new Error(`interaction expired: ${reason}`))
    this.syncApprovalBadges()
    this.emit()
    return true
  }

  /**
   * Dismiss one question interaction by id with an error (phase-5 panel interaction).
   * @param id - interaction id.
   * @param error - dismissal reason.
   * @returns true when settled, false when unknown.
   */
  dismissQuestions(id: string, error: string): boolean {
    const entry = this.queue.find(
      (candidate): candidate is QuestionsEntry =>
        candidate.id === id && candidate.kind === 'questions',
    )
    if (entry === undefined) return false
    this.finishQuestionsError(entry, new Error(error))
    entry.abort.abort()
    return true
  }

  /**
   * Handle one approval request: enqueue, present serially, return outcome (AC-16 / AC-58).
   * @param frame - validated approval/request fields.
   * @returns legal ApprovalOutcome (never silent allow on UI failure).
   */
  handleApproval(frame: {
    id: string
    sessionId: string
    toolName: string
    reason?: string
  }): Promise<ApprovalOutcome> {
    return new Promise((resolve) => {
      const tabId = this.resolveTabId(frame.sessionId)
      const entry: ApprovalEntry = {
        kind: 'approval',
        id: frame.id,
        sessionId: frame.sessionId,
        state: 'pending',
        abort: new AbortController(),
        demoted: false,
        settled: false,
        toolName: frame.toolName,
        resolve,
        ...tabId === undefined ? {} : { tabId },
        ...frame.reason === undefined ? {} : { reason: frame.reason },
      }
      this.enqueue(entry)
      this.syncApprovalBadges()
      this.emit()
      void this.pump()
    })
  }

  /**
   * Handle one user-questions request (AC-17 / AC-58).
   * @param frame - validated user-questions/request fields.
   * @returns answer, or throws for fail-closed error framing.
   */
  handleQuestions(frame: {
    id: string
    sessionId: string
    questions: AskUserQuestionItem[]
  }): Promise<AskUserQuestionAnswer> {
    return new Promise((resolve, reject) => {
      const tabId = this.resolveTabId(frame.sessionId)
      const entry: QuestionsEntry = {
        kind: 'questions',
        id: frame.id,
        sessionId: frame.sessionId,
        state: 'pending',
        abort: new AbortController(),
        demoted: false,
        settled: false,
        questions: frame.questions,
        resolve,
        reject,
        ...tabId === undefined ? {} : { tabId },
      }
      this.enqueue(entry)
      this.syncApprovalBadges()
      this.emit()
      void this.pump()
    })
  }

  /**
   * Abort every pending UI wait (SDK transport death / Host shutdown) (AC-30).
   * @param reason - diagnostic recorded for status UI.
   */
  failClosedAll(reason: string): void {
    this.lastError = reason
    const entries = [...this.queue]
    this.queue.length = 0
    this.presentedId = undefined
    for (const entry of entries) {
      this.settleAbort(entry, reason)
    }
    this.syncApprovalBadges()
    this.emit()
  }

  /**
   * Abort pending Host UI waits for one session (Tab close / AD-5 / GAP-009).
   * Does not touch other sessions' in-flight interactions.
   * @param sessionId - SDK session identity whose waits must fail-closed.
   * @param reason - diagnostic recorded for status UI.
   */
  failClosedSession(sessionId: string, reason: string): void {
    this.lastError = reason
    const doomed = this.queue.filter(entry => entry.sessionId === sessionId)
    this.lastFailClosed = {
      instanceId: this.instanceId,
      sessionId,
      matched: doomed.length,
      queueLength: this.queue.length,
    }
    for (const entry of doomed) {
      const index = this.queue.indexOf(entry)
      if (index >= 0) this.queue.splice(index, 1)
      if (this.presentedId === entry.id) this.presentedId = undefined
      this.settleAbort(entry, reason)
    }
    this.syncApprovalBadges()
    this.emit()
    void this.pump()
  }

  private enqueue(entry: QueueEntry): void {
    if (this.activeSessionId !== undefined && entry.sessionId === this.activeSessionId) {
      // Soft priority: insert at front of waiting queue, same-Tab FIFO.
      let insertAt = 0
      for (const current of this.queue) {
        if (current.state === 'presented') {
          insertAt += 1
          continue
        }
        if (current.sessionId === entry.sessionId && current.state === 'pending') {
          insertAt += 1
          continue
        }
        break
      }
      this.queue.splice(insertAt, 0, entry)
      return
    }
    this.queue.push(entry)
  }

  private presentedEntry(): QueueEntry | undefined {
    if (this.presentedId === undefined) return undefined
    return this.queue.find(entry => entry.id === this.presentedId)
  }

  private pickNext(): QueueEntry | undefined {
    const pending = this.queue.filter(entry => entry.state === 'pending')
    if (pending.length === 0) return undefined
    if (this.activeSessionId !== undefined) {
      const activeHead = pending.find(entry => entry.sessionId === this.activeSessionId)
      if (activeHead !== undefined) return activeHead
    }
    return pending[0]
  }

  private async pump(): Promise<void> {
    if (this.pumping) return
    this.pumping = true
    try {
      while (this.presentedId === undefined) {
        const next = this.pickNext()
        if (next === undefined) return
        await this.presentEntry(next)
      }
    } finally {
      this.pumping = false
      if (this.presentedId === undefined && this.queue.some(e => e.state === 'pending')) {
        void this.pump()
      }
    }
  }

  private async presentEntry(entry: QueueEntry): Promise<void> {
    entry.demoted = false
    entry.state = 'presented'
    this.presentedId = entry.id
    this.syncApprovalBadges()
    this.emit()

    try {
      if (this.ui === undefined) {
        if (entry.kind === 'approval') {
          this.finishApproval(entry, 'unavailable')
        } else {
          this.finishQuestionsError(entry, new Error('interaction UI is not available'))
        }
        return
      }
      if (entry.abort.signal.aborted) {
        if (entry.demoted) return
        if (entry.kind === 'approval') {
          this.finishApproval(entry, 'unavailable')
        } else {
          this.finishQuestionsError(entry, new Error('interaction cancelled by Host shutdown'))
        }
        return
      }

      if (entry.kind === 'approval') {
        const request: HostApprovalRequest = {
          id: entry.id,
          sessionId: entry.sessionId,
          toolName: entry.toolName,
          ...entry.reason === undefined ? {} : { reason: entry.reason },
          ...entry.tabId === undefined ? {} : { tabId: entry.tabId },
        }
        const aborted = new Promise<ApprovalOutcome>((resolve) => {
          entry.abort.signal.addEventListener('abort', () => resolve('unavailable'), { once: true })
        })
        let outcome: ApprovalOutcome
        try {
          outcome = await Promise.race([
            this.ui.presentApproval(request, entry.abort.signal),
            aborted,
          ])
        } catch (error) {
          if (entry.demoted) return
          this.lastError = error instanceof Error ? error.message : String(error)
          outcome = 'unavailable'
        }
        if (entry.demoted) return
        this.finishApproval(entry, outcome)
        return
      }

      const request: HostQuestionsRequest = {
        id: entry.id,
        sessionId: entry.sessionId,
        questions: entry.questions,
        ...entry.tabId === undefined ? {} : { tabId: entry.tabId },
      }
      const aborted = new Promise<AskUserQuestionAnswer>((_resolve, reject) => {
        entry.abort.signal.addEventListener('abort', () => {
          reject(new Error('interaction cancelled by Host shutdown'))
        }, { once: true })
      })
      try {
        const answer = await Promise.race([
          this.ui.presentQuestions(request, entry.abort.signal),
          aborted,
        ])
        if (entry.demoted) return
        this.finishQuestions(entry, answer)
      } catch (error) {
        if (entry.demoted) return
        const err = error instanceof Error ? error : new Error(String(error))
        this.lastError = err.message
        this.finishQuestionsError(entry, err)
      }
    } finally {
      if (this.presentedId === entry.id) this.presentedId = undefined
    }
  }

  private finishApproval(entry: ApprovalEntry, outcome: ApprovalOutcome): void {
    if (entry.settled) return
    entry.settled = true
    entry.state = 'resolved'
    this.removeEntry(entry.id)
    entry.resolve(outcome)
    this.syncApprovalBadges()
    this.emit()
  }

  private finishQuestions(entry: QuestionsEntry, answer: AskUserQuestionAnswer): void {
    if (entry.settled) return
    entry.settled = true
    entry.state = 'resolved'
    this.removeEntry(entry.id)
    entry.resolve(answer)
    this.syncApprovalBadges()
    this.emit()
  }

  private finishQuestionsError(entry: QuestionsEntry, error: Error): void {
    if (entry.settled) return
    entry.settled = true
    entry.state = 'abort'
    this.removeEntry(entry.id)
    entry.reject(error)
    this.syncApprovalBadges()
    this.emit()
  }

  private settleAbort(entry: QueueEntry, reason: string): void {
    if (entry.settled) return
    entry.settled = true
    entry.state = 'abort'
    entry.abort.abort()
    if (entry.kind === 'approval') {
      entry.resolve('unavailable')
    } else {
      entry.reject(new Error(reason))
    }
  }

  private removeEntry(id: string): void {
    const index = this.queue.findIndex(entry => entry.id === id)
    if (index >= 0) this.queue.splice(index, 1)
    if (this.presentedId === id) this.presentedId = undefined
  }

  private syncApprovalBadges(): void {
    const registry = this.registry
    if (registry === undefined) return
    for (const tab of registry.list()) {
      registry.setApprovalBadge(tab.tabId, this.hasPendingForSession(tab.sessionId))
    }
  }

  private emit(): void {
    for (const listener of this.listeners) listener()
  }
}
