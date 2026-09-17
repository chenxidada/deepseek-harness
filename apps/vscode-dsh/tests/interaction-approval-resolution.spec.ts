/**
 * `InteractionCoordinator.resolveApproval` + `dsh.test.answerApproval` (AD-12).
 *
 * The unattended smoke loop needs to answer a Host approval without QuickPick
 * focus, so `resolveApproval` settles the same wait the UI would have settled. The
 * cases below pin the parts a driver depends on: answering by id (including an id
 * still queued behind another popup), refusing ids that are not answerable, and
 * never answering the runtime twice.
 */

import { describe, expect, it } from 'vitest'
import { InteractionCoordinator } from '../src/interaction-coordinator.ts'
import type { ApprovalOutcome } from '@deepseek-ai/dsh-ide-bridge'

describe('InteractionCoordinator.resolveApproval (AD-12)', () => {
  /** A coordinator with a popup that stays open until the test answers it. */
  function coordinatorWithOpenPopup(): {
    coordinator: InteractionCoordinator
    presented: string[]
    signals: AbortSignal[]
  } {
    const coordinator = new InteractionCoordinator()
    const presented: string[] = []
    const signals: AbortSignal[] = []
    const open = new Map<string, (outcome: ApprovalOutcome) => void>()
    coordinator.setUi({
      presentApproval(request, signal) {
        presented.push(request.id)
        if (signal !== undefined) signals.push(signal)
        return new Promise<ApprovalOutcome>((resolve) => {
          open.set(request.id, resolve)
        })
      },
      async presentQuestions() {
        return { answers: [] }
      },
    })
    return { coordinator, presented, signals }
  }

  it('answers the approval the id names, and leaves the other wait pending', async () => {
    const { coordinator } = coordinatorWithOpenPopup()
    const first = coordinator.handleApproval({ id: 'a', sessionId: 's1', toolName: 'bash' })
    const second = coordinator.handleApproval({ id: 'b', sessionId: 's1', toolName: 'write' })
    // Let the pump present `a`, so `b` is the queued one — answering a queued
    // approval by id has to work, not only a popup that is already on screen.
    await Promise.resolve()

    const resolution = coordinator.resolveApproval('b', 'allowed-once')
    await expect(second).resolves.toBe('allowed-once')
    expect(resolution).toEqual({ ok: true, id: 'b', outcome: 'allowed-once' })
    expect(coordinator.listPending().map(entry => entry.id)).toEqual(['a'])
    expect(coordinator.hasPendingForSession('s1')).toBe(true)

    coordinator.resolveApproval('a', 'rejected')
    await expect(first).resolves.toBe('rejected')
    expect(coordinator.listPending()).toEqual([])
    expect(coordinator.hasPendingForSession('s1')).toBe(false)
  })

  it('refuses an id it does not hold, and settles nothing', async () => {
    const { coordinator } = coordinatorWithOpenPopup()
    const wait = coordinator.handleApproval({ id: 'a', sessionId: 's1', toolName: 'bash' })
    await Promise.resolve()

    expect(coordinator.resolveApproval('no-such-id', 'allowed-once')).toEqual({
      ok: false,
      reason: 'unknown-id',
    })
    expect(coordinator.listPending().map(entry => entry.id)).toEqual(['a'])
    coordinator.resolveApproval('a', 'cancelled')
    await expect(wait).resolves.toBe('cancelled')
  })

  it('refuses an outcome outside the vocabulary and leaves the wait answerable', async () => {
    const { coordinator } = coordinatorWithOpenPopup()
    const wait = coordinator.handleApproval({ id: 'a', sessionId: 's1', toolName: 'bash' })
    await Promise.resolve()

    // A driver that passes the wrong string must not consume the wait: the legal
    // vocabulary is the bridge's, and `unavailable` is not an answer the driver
    // gets to invent here.
    expect(coordinator.resolveApproval('a', 'allow-once')).toEqual({
      ok: false,
      reason: 'invalid-outcome',
    })
    expect(coordinator.resolveApproval('a', undefined)).toEqual({
      ok: false,
      reason: 'invalid-outcome',
    })
    expect(coordinator.listPending().map(entry => entry.id)).toEqual(['a'])

    coordinator.resolveApproval('a', 'allowed-once')
    await expect(wait).resolves.toBe('allowed-once')
  })

  it('dismisses an open popup without answering the runtime a second time', async () => {
    const { coordinator, presented, signals } = coordinatorWithOpenPopup()
    const wait = coordinator.handleApproval({ id: 'a', sessionId: 's1', toolName: 'bash' })
    await Promise.resolve()
    expect(presented).toEqual(['a'])
    expect(signals[0]?.aborted).toBe(false)

    coordinator.resolveApproval('a', 'allowed-once')
    // The UI path must see the popup hide (its abort signal) rather than race to
    // its own `unavailable` answer.
    expect(signals[0]?.aborted).toBe(true)
    await expect(wait).resolves.toBe('allowed-once')
    expect(coordinator.listPending()).toEqual([])
  })

  it('has nothing to answer once the wait failed closed', async () => {
    const { coordinator } = coordinatorWithOpenPopup()
    const wait = coordinator.handleApproval({ id: 'a', sessionId: 's1', toolName: 'bash' })
    await Promise.resolve()

    coordinator.failClosedAll('SDK transport closed')
    await expect(wait).resolves.toBe('unavailable')
    // An aborted wait is not "still answerable a little later" — saying so would
    // let a driver believe it answered an approval the runtime already abandoned.
    expect(coordinator.resolveApproval('a', 'allowed-once')).toEqual({
      ok: false,
      reason: 'unknown-id',
    })
    expect(coordinator.listPending()).toEqual([])
  })

  it('does not treat a questions wait as an approvable id', async () => {
    const { coordinator } = coordinatorWithOpenPopup()
    const questions = coordinator.handleQuestions({
      id: 'q1',
      sessionId: 's1',
      questions: [{ id: 'q1', question: 'pick one' }],
    })
    await Promise.resolve()
    expect(coordinator.listPending().map(entry => entry.id)).toEqual(['q1'])

    expect(coordinator.resolveApproval('q1', 'allowed-once')).toEqual({
      ok: false,
      reason: 'unknown-id',
    })
    expect(coordinator.listPending().map(entry => entry.id)).toEqual(['q1'])
    coordinator.failClosedSession('s1', 'tab closed')
    await expect(questions).rejects.toThrow('tab closed')
  })
})
