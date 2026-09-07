/**
 * Host-side pending interaction coordinator: Tab association + fail-closed settle.
 * @module @deepseek-ai/dsh-vscode-dsh/interaction-coordinator
 */

import type { ApprovalOutcome, AskUserQuestionAnswer, AskUserQuestionItem } from '@deepseek-ai/dsh-ide-bridge'
import type { ConversationRegistry } from './conversation-registry.ts'

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
   * @param signal - abort when Host fail-closes; UI must hide open QuickPick (GAP-006).
   */
  presentApproval(request: HostApprovalRequest, signal?: AbortSignal): Promise<ApprovalOutcome>
  /**
   * Present questions and return a legal answer, or throw to fail-closed.
   * @param request - Host questions request bound to a Tab when possible.
   * @param signal - abort when Host fail-closes; UI must hide open QuickPick (GAP-006).
   */
  presentQuestions(request: HostQuestionsRequest, signal?: AbortSignal): Promise<AskUserQuestionAnswer>
}

/** One in-flight Host interaction wait (for AC-30 cancellation). */
export type PendingHostInteraction =
  | {
    kind: 'approval'
    id: string
    sessionId: string
    tabId?: string
    abort: AbortController
  }
  | {
    kind: 'questions'
    id: string
    sessionId: string
    tabId?: string
    abort: AbortController
  }

/**
 * Routes bridge interaction frames to the correct Tab and UI, and settles
 * every waiter on Host shutdown / child death (AC-10 / AC-30).
 */
export class InteractionCoordinator {
  private readonly pending = new Map<string, PendingHostInteraction>()
  private ui: InteractionUi | undefined
  private registry: ConversationRegistry | undefined
  private lastError: string | undefined

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
  }

  /**
   * Last fail-closed / transport error for status UI (AC-30).
   * @returns redacted-ready diagnostic, or `undefined`.
   */
  getLastError(): string | undefined {
    return this.lastError
  }

  /**
   * Snapshot of in-flight interaction ids (tests / status).
   * @returns pending entries.
   */
  listPending(): readonly PendingHostInteraction[] {
    return [...this.pending.values()]
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
   * Handle one approval request: bind Tab, present UI, return outcome (AC-16).
   * @param frame - validated approval/request fields.
   * @returns legal ApprovalOutcome (never silent allow on UI failure).
   */
  async handleApproval(frame: {
    id: string
    sessionId: string
    toolName: string
    reason?: string
  }): Promise<ApprovalOutcome> {
    const tabId = this.resolveTabId(frame.sessionId)
    const abort = new AbortController()
    this.pending.set(frame.id, {
      kind: 'approval',
      id: frame.id,
      sessionId: frame.sessionId,
      ...tabId === undefined ? {} : { tabId },
      abort,
    })
    try {
      if (this.ui === undefined) return 'unavailable'
      if (abort.signal.aborted) return 'unavailable'
      const request = {
        id: frame.id,
        sessionId: frame.sessionId,
        toolName: frame.toolName,
        ...frame.reason === undefined ? {} : { reason: frame.reason },
        ...tabId === undefined ? {} : { tabId },
      }
      const aborted = new Promise<ApprovalOutcome>((resolve) => {
        abort.signal.addEventListener('abort', () => resolve('unavailable'), { once: true })
      })
      return await Promise.race([this.ui.presentApproval(request, abort.signal), aborted])
    } catch (error) {
      this.lastError = error instanceof Error ? error.message : String(error)
      return 'unavailable'
    } finally {
      this.pending.delete(frame.id)
    }
  }

  /**
   * Handle one user-questions request (AC-17).
   * @param frame - validated user-questions/request fields.
   * @returns answer, or throws for fail-closed error framing.
   */
  async handleQuestions(frame: {
    id: string
    sessionId: string
    questions: AskUserQuestionItem[]
  }): Promise<AskUserQuestionAnswer> {
    const tabId = this.resolveTabId(frame.sessionId)
    const abort = new AbortController()
    this.pending.set(frame.id, {
      kind: 'questions',
      id: frame.id,
      sessionId: frame.sessionId,
      ...tabId === undefined ? {} : { tabId },
      abort,
    })
    try {
      if (this.ui === undefined) {
        throw new Error('interaction UI is not available')
      }
      if (abort.signal.aborted) {
        throw new Error('interaction cancelled by Host shutdown')
      }
      const request = {
        id: frame.id,
        sessionId: frame.sessionId,
        questions: frame.questions,
        ...tabId === undefined ? {} : { tabId },
      }
      const aborted = new Promise<AskUserQuestionAnswer>((_resolve, reject) => {
        abort.signal.addEventListener('abort', () => {
          reject(new Error('interaction cancelled by Host shutdown'))
        }, { once: true })
      })
      return await Promise.race([this.ui.presentQuestions(request, abort.signal), aborted])
    } catch (error) {
      this.lastError = error instanceof Error ? error.message : String(error)
      throw error instanceof Error ? error : new Error(String(error))
    } finally {
      this.pending.delete(frame.id)
    }
  }

  /**
   * Abort every pending UI wait (SDK transport death / Host shutdown) (AC-30).
   * @param reason - diagnostic recorded for status UI.
   */
  failClosedAll(reason: string): void {
    this.lastError = reason
    for (const [id, entry] of this.pending) {
      this.pending.delete(id)
      entry.abort.abort()
    }
  }

  /**
   * Abort pending Host UI waits for one session (Tab close / AD-5 / GAP-009).
   * Does not touch other sessions' in-flight interactions.
   * @param sessionId - SDK session identity whose waits must fail-closed.
   * @param reason - diagnostic recorded for status UI.
   */
  failClosedSession(sessionId: string, reason: string): void {
    this.lastError = reason
    for (const [id, entry] of this.pending) {
      if (entry.sessionId !== sessionId) continue
      this.pending.delete(id)
      entry.abort.abort()
    }
  }
}
