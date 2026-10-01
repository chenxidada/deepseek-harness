/**
 * Driver-less inbox for registry-only fallback agents and fixtures.
 *
 * The agent loop's own inbox is bound to a session projection registry and a
 * durable log; this one holds pending input in memory for agents registered
 * without a driver, such as the SpecDev lineage fallback and unit-test stubs.
 */

import type { Inbox, InboxTarget } from '@deepseek-ai/dsh-agent'
import type { MessageId, UserMessage } from '@deepseek-ai/dsh-llm'

/** In-memory pending input, one list per inbox boundary. */
export class MemoryInbox implements Inbox {
  private readonly pending: Record<InboxTarget, UserMessage[]> = { 'next-turn': [], 'next-step': [] }

  /** Prompts awaiting individual turns. */
  get nextTurn(): readonly UserMessage[] { return this.pending['next-turn'] }

  /** Input awaiting the next step boundary. */
  get nextStep(): readonly UserMessage[] { return this.pending['next-step'] }

  /** Drop every pending message, clearing next-step before next-turn. */
  clear(): void {
    this.pending['next-step'] = []
    this.pending['next-turn'] = []
  }

  /**
   * Append one message to a pending list.
   * @param target - pending list to extend.
   * @param message - message to append.
   */
  append(target: InboxTarget, message: UserMessage): void {
    this.pending[target].push(message)
  }

  /**
   * Prepend one message to a pending list.
   * @param target - pending list to extend.
   * @param message - message to prepend.
   */
  prepend(target: InboxTarget, message: UserMessage): void {
    this.pending[target].unshift(message)
  }

  /**
   * Replace one pending message in place.
   * @param messageId - identity of the pending message to replace.
   * @param newMessage - replacement message.
   * @returns whether the message was still pending.
   */
  replace(messageId: MessageId, newMessage: UserMessage): boolean {
    for (const target of ['next-step', 'next-turn'] as const) {
      const index = this.pending[target].findIndex(message => message.id === messageId)
      if (index < 0) continue
      this.pending[target][index] = newMessage
      return true
    }
    return false
  }

  /**
   * Remove one pending message.
   * @param messageId - identity of the pending message to remove.
   * @returns whether the message was still pending.
   */
  remove(messageId: MessageId): boolean {
    for (const target of ['next-step', 'next-turn'] as const) {
      const index = this.pending[target].findIndex(message => message.id === messageId)
      if (index < 0) continue
      this.pending[target].splice(index, 1)
      return true
    }
    return false
  }

  /**
   * Apply splice semantics to one pending list.
   * @param target - pending list to mutate.
   * @param start - splice position.
   * @param deleteCount - maximum number of messages to remove.
   * @param inserted - messages to insert at the resolved position.
   * @returns messages removed by the splice.
   */
  splice(target: InboxTarget, start: number, deleteCount: number, inserted: UserMessage[]): UserMessage[] {
    return this.pending[target].splice(start, deleteCount, ...inserted)
  }
}
