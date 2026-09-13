/**
 * Verifier-owned independent scenarios for phase-5-fork-retry-branch.
 * Does NOT rubber-stamp implementer suites — new cases:
 * - projectMessagesForForkSeed parameter variation (stub-aware)
 * - Bridge validate emptySeed ↔ boundarySeq mutual exclusion
 * - Bridge E2E: session/fork emptySeed → sdkSessionFork({ emptySeed:true })
 * - Open-turn reject (AC-34) — implementer covered aborted/running, not open
 * - Branch MessageStore keeps target turn (seedMaxTurn=turn) — not in implementer suite
 * - Retry turn=1 vs branch turn=1 seed cut contrast
 * - AC-31 vs AC-60 parent mode contrast in one fixture
 * - Copy-message parameter variation (distinct texts)
 * - Invalid seq boundary reject
 * - Product never tip-forks turn-0 (emptySeed required; omit ≠ empty)
 */
import { describe, expect, it } from 'vitest'
import { randomUUID } from 'node:crypto'
import { ConversationController } from '../../../../../../apps/vscode-dsh/src/conversation-controller.ts'
import {
  ChatPanelHost,
  FakeWebviewPort,
} from '../../../../../../apps/vscode-dsh/src/chat-panel/index.ts'
import {
  projectMessagesForForkSeed,
  resolveClosedTurnBoundary,
  presentationForIntent,
  requiresParentE2,
  asForkLogEvents,
} from '../../../../../../apps/vscode-dsh/src/fork/fork-orchestrator.ts'
import type { IdeSessionHost } from '../../../../../../apps/vscode-dsh/src/session-host.ts'
import type { HydratorSessionEvent } from '../../../../../../apps/vscode-dsh/src/replay-hydrator.ts'
import type { HarnessNotification } from '@deepseek-ai/dsh-sdk-client'
import { validateBridgeFrame } from '../../../../../../packages/ide/ide-bridge/src/validate.ts'

type NotificationListener = (notification: HarnessNotification) => void

function createEmitHost(options?: {
  forkImpl?: (
    parentSessionId: string,
    opts?: { boundarySeq?: number; emptySeed?: boolean; childSessionId?: string },
  ) => Promise<string>
}) {
  const listeners = new Set<NotificationListener>()
  const forkCalls: Array<{
    parentSessionId: string
    options?: { boundarySeq?: number; emptySeed?: boolean; childSessionId?: string }
  }> = []
  const resumeCalls: string[] = []
  const host = {
    status: 'connected' as const,
    interactions: {
      failClosedSession() {},
      listPending() { return [] },
      onChange() { return () => {} },
    },
    setConversationRegistry() {},
    onNotification(listener: NotificationListener) {
      listeners.add(listener)
      return () => { listeners.delete(listener) }
    },
    onStatusChange() { return () => {} },
    async prompt() { return 'msg' },
    async disposeSession() {},
    async cancelSession() {},
    async resumeSession(sessionId: string) {
      resumeCalls.push(sessionId)
    },
    async forkSession(
      parentSessionId: string,
      opts?: { boundarySeq?: number; emptySeed?: boolean; childSessionId?: string },
    ) {
      forkCalls.push({ parentSessionId, options: opts })
      if (options?.forkImpl) return options.forkImpl(parentSessionId, opts)
      return opts?.childSessionId ?? randomUUID()
    },
    emit(notification: HarnessNotification) {
      for (const listener of listeners) listener(notification)
    },
    forkCalls,
    resumeCalls,
  }
  return host as unknown as IdeSessionHost & {
    emit: (n: HarnessNotification) => void
    forkCalls: typeof forkCalls
    resumeCalls: string[]
  }
}

function closedTurnEvents(
  userText = 'hello',
  reason: 'completed' | 'aborted' = 'completed',
): HydratorSessionEvent[] {
  return [
    { type: 'turn/start', seq: 0, data: { turn: 0 } },
    { type: 'user/message', seq: 1, data: { content: [{ type: 'text', text: userText }] } },
    {
      type: 'assistant/message',
      seq: 2,
      data: { message: { content: [{ type: 'text', text: 'world' }] } },
    },
    {
      type: 'turn/end',
      seq: 3,
      data: {
        turn: 0,
        reason: reason === 'aborted'
          ? { kind: 'aborted', reason: { kind: 'user' } }
          : { kind: 'completed' },
      },
    },
  ]
}

function twoClosedTurnEvents(): HydratorSessionEvent[] {
  return [
    ...closedTurnEvents('first'),
    { type: 'turn/start', seq: 4, data: { turn: 1 } },
    { type: 'user/message', seq: 5, data: { content: [{ type: 'text', text: 'second' }] } },
    {
      type: 'assistant/message',
      seq: 6,
      data: { message: { content: [{ type: 'text', text: 'reply-2' }] } },
    },
    {
      type: 'turn/end',
      seq: 7,
      data: { turn: 1, reason: { kind: 'completed' } },
    },
  ]
}

/** Open turn: turn/start without turn/end. */
function openTurnEvents(): HydratorSessionEvent[] {
  return [
    ...closedTurnEvents('prior'),
    { type: 'turn/start', seq: 4, data: { turn: 1 } },
    { type: 'user/message', seq: 5, data: { content: [{ type: 'text', text: 'open-user' }] } },
  ]
}

function seedParentMessages(
  controller: ConversationController,
  sessionId: string,
  rows: Array<{ role: 'user' | 'assistant'; text: string; turn: number }>,
) {
  controller.messages.replace(
    sessionId,
    rows.map(r => ({
      id: randomUUID(),
      sessionId,
      role: r.role,
      kind: 'text' as const,
      text: r.text,
      turn: r.turn,
    })),
  )
}

describe('verifier independent — projectMessagesForForkSeed param variation', () => {
  const parent = [
    { id: 'u0', sessionId: 'p', role: 'user' as const, turn: 0 },
    { id: 'a0', sessionId: 'p', role: 'assistant' as const, turn: 0 },
    { id: 'u1', sessionId: 'p', role: 'user' as const, turn: 1 },
    { id: 'a1', sessionId: 'p', role: 'assistant' as const, turn: 1 },
  ]

  it('undefined seedMaxTurn → empty (emptySeed hydrate)', () => {
    expect(projectMessagesForForkSeed(parent, 'child', undefined)).toEqual([])
  })

  it('seedMaxTurn=0 keeps only turn 0; seedMaxTurn=1 keeps both', () => {
    const t0 = projectMessagesForForkSeed(parent, 'c0', 0)
    const t1 = projectMessagesForForkSeed(parent, 'c1', 1)
    expect(t0.map(m => m.id)).toEqual(['u0', 'a0'])
    expect(t1.map(m => m.id)).toEqual(['u0', 'a0', 'u1', 'a1'])
    // Parameter variation: different cuts must NOT collapse to the same projection.
    expect(t0).not.toEqual(t1)
    expect(t0.every(m => m.sessionId === 'c0')).toBe(true)
    expect(t1.every(m => m.sessionId === 'c1')).toBe(true)
  })
})

describe('verifier independent — boundary gates (AC-34/61)', () => {
  it('open turn is rejected with open-turn', () => {
    const events = asForkLogEvents(openTurnEvents())
    const result = resolveClosedTurnBoundary(events, { kind: 'closed-turn', turn: 1 })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.reason).toBe('open-turn')
  })

  it('invalid seq not mappable to closed turn/end → invalid-boundary', () => {
    const events = asForkLogEvents(closedTurnEvents())
    const result = resolveClosedTurnBoundary(events, { kind: 'seq', seq: 99 })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.reason).toBe('invalid-boundary')
  })

  it('aborted turn rejected (cross-check AC-34)', () => {
    const events = asForkLogEvents(closedTurnEvents('x', 'aborted'))
    const result = resolveClosedTurnBoundary(events, { kind: 'closed-turn', turn: 0 })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.reason).toBe('aborted-turn')
  })

  it('presentation + E2 mapping: retry requires E2; branch does not', () => {
    expect(presentationForIntent('retry')).toBe('continue-switch')
    expect(presentationForIntent('edit-resend')).toBe('continue-switch')
    expect(presentationForIntent('branch')).toBe('branch-mark')
    expect(requiresParentE2('continue-switch')).toBe(true)
    expect(requiresParentE2('branch-mark')).toBe(false)
  })
})

describe('verifier independent — bridge validate emptySeed contract', () => {
  it('accepts emptySeed alone; rejects emptySeed+boundarySeq; tip omit ok', () => {
    const emptyOnly = validateBridgeFrame({
      kind: 'session/fork',
      id: 'f-empty',
      parentSessionId: 'p',
      emptySeed: true,
    })
    expect(emptyOnly).toMatchObject({ kind: 'session/fork', emptySeed: true })
    expect((emptyOnly as { boundarySeq?: number }).boundarySeq).toBeUndefined()

    const both = validateBridgeFrame({
      kind: 'session/fork',
      id: 'f-both',
      parentSessionId: 'p',
      emptySeed: true,
      boundarySeq: 3,
    })
    expect(both).toBeUndefined()

    const tip = validateBridgeFrame({
      kind: 'session/fork',
      id: 'f-tip',
      parentSessionId: 'p',
    })
    expect(tip).toMatchObject({ kind: 'session/fork', id: 'f-tip' })
    expect((tip as { emptySeed?: boolean }).emptySeed).toBeUndefined()
    expect((tip as { boundarySeq?: number }).boundarySeq).toBeUndefined()

    const boundary = validateBridgeFrame({
      kind: 'session/fork',
      id: 'f-b',
      parentSessionId: 'p',
      boundarySeq: 7,
    })
    expect(boundary).toMatchObject({ kind: 'session/fork', boundarySeq: 7 })
  })
})

describe('verifier independent — Host E2E paths implementer under-covered', () => {
  it('AC-34 open turn: controller rejects before fork (forkCalls=0)', async () => {
    const host = createEmitHost()
    const controller = new ConversationController(host)
    const parent = controller.newConversation('open')
    controller.installTestHooks({
      eventsBySession: new Map([[parent.sessionId, openTurnEvents()]]),
      forkSession: async () => {
        throw new Error('should not fork open turn')
      },
    })
    const result = await controller.forkFromClosedTurn({
      parentSessionId: parent.sessionId,
      boundary: { kind: 'closed-turn', turn: 1 },
      intent: 'retry',
    })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.reason).toBe('open-turn')
    expect(host.forkCalls).toHaveLength(0)
  })

  it('branch at turn=1 keeps seedMaxTurn=1 (includes target turn, not prior-cut)', async () => {
    const host = createEmitHost()
    const controller = new ConversationController(host)
    const parent = controller.newConversation('branch-trim')
    seedParentMessages(controller, parent.sessionId, [
      { role: 'user', text: 'first', turn: 0 },
      { role: 'assistant', text: 'world', turn: 0 },
      { role: 'user', text: 'second', turn: 1 },
      { role: 'assistant', text: 'reply-2', turn: 1 },
    ])
    let captured: { boundarySeq?: number; emptySeed?: boolean } | undefined
    controller.installTestHooks({
      eventsBySession: new Map([[parent.sessionId, twoClosedTurnEvents()]]),
      forkSession: async (_p, opts) => {
        captured = opts
        return 'child-branch-trim'
      },
    })
    const result = await controller.forkFromClosedTurn({
      parentSessionId: parent.sessionId,
      boundary: { kind: 'closed-turn', turn: 1 },
      intent: 'branch',
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    // Branch cuts AT the closed turn (inclusive) — not prior-cut like retry.
    expect(result.emptySeed).toBeUndefined()
    expect(result.seedMaxTurn).toBe(1)
    expect(result.boundarySeq).toBe(7)
    expect(captured).toEqual({ boundarySeq: 7 })
    const childMsgs = controller.messages.get('child-branch-trim')
    expect(childMsgs.filter(m => m.turn === 0 || m.turn === 1)).toHaveLength(4)
    expect(childMsgs.some(m => m.role === 'assistant' && m.text === 'reply-2')).toBe(true)
  })

  it('retry turn=1 prior-cut drops turn-1 assistant (Must-Fix MessageStore) — independent fixture', async () => {
    const host = createEmitHost()
    const controller = new ConversationController(host)
    const parent = controller.newConversation('retry-prior')
    seedParentMessages(controller, parent.sessionId, [
      { role: 'user', text: 'A', turn: 0 },
      { role: 'assistant', text: 'ra', turn: 0 },
      { role: 'user', text: 'B', turn: 1 },
      { role: 'assistant', text: 'rb', turn: 1 },
    ])
    controller.installTestHooks({
      eventsBySession: new Map([[parent.sessionId, twoClosedTurnEvents()]]),
      forkSession: async () => 'child-retry-prior',
    })
    controller.setPanelHost(new ChatPanelHost({
      registry: controller.registry,
      messages: controller.messages,
      isHostReady: () => true,
      acceptSend: (text) => controller.promptActive(text),
    }))
    const result = await controller.forkFromClosedTurn({
      parentSessionId: parent.sessionId,
      boundary: { kind: 'closed-turn', turn: 1 },
      intent: 'retry',
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.seedMaxTurn).toBe(0)
    expect(result.boundarySeq).toBe(3)
    expect(result.emptySeed).toBeUndefined()
    const child = controller.messages.get('child-retry-prior')
    expect(child.some(m => m.text === 'rb')).toBe(false)
    expect(child.filter(m => m.turn === 0)).toHaveLength(2)
  })

  it('AC-31 vs AC-60: retry forces parent replay+E2; branch keeps parent live', async () => {
    const host = createEmitHost()
    const controller = new ConversationController(host)

    const parentRetry = controller.newConversation('p-retry')
    seedParentMessages(controller, parentRetry.sessionId, [
      { role: 'user', text: 'u', turn: 0 },
      { role: 'assistant', text: 'a', turn: 0 },
    ])
    controller.installTestHooks({
      eventsBySession: new Map([[parentRetry.sessionId, closedTurnEvents()]]),
      forkSession: async () => 'child-r',
    })
    const panel = new ChatPanelHost({
      registry: controller.registry,
      messages: controller.messages,
      isHostReady: () => true,
      acceptSend: (text) => controller.promptActive(text),
      resolveContinueChrome: () => controller.continueChromeForTab(),
      resolveHostProbes: () => controller.hostProbesForActive(),
    })
    controller.setPanelHost(panel)
    const fake = new FakeWebviewPort()
    panel.attach(fake)

    const retry = await controller.forkFromClosedTurn({
      parentSessionId: parentRetry.sessionId,
      boundary: { kind: 'closed-turn', turn: 0 },
      intent: 'retry',
    })
    expect(retry.ok).toBe(true)
    expect(controller.registry.get(parentRetry.tabId)?.mode).toBe('replay')
    controller.switchConversation(parentRetry.tabId)
    panel.pushFullState()
    const retryState = fake.receivedFromHost.filter(m => m.type === 'panel/state').at(-1)
    expect(retryState?.type === 'panel/state' && retryState.probes?.parentReadonly).toBe(true)
    expect(retryState?.type === 'panel/state' && retryState.probes?.continueSealed).toBe(true)

    const parentBranch = controller.newConversation('p-branch')
    seedParentMessages(controller, parentBranch.sessionId, [
      { role: 'user', text: 'u', turn: 0 },
      { role: 'assistant', text: 'a', turn: 0 },
    ])
    controller.installTestHooks({
      eventsBySession: new Map([[parentBranch.sessionId, closedTurnEvents()]]),
      forkSession: async () => 'child-b',
    })
    const branch = await controller.forkFromClosedTurn({
      parentSessionId: parentBranch.sessionId,
      boundary: { kind: 'closed-turn', turn: 0 },
      intent: 'branch',
    })
    expect(branch.ok).toBe(true)
    expect(controller.registry.get(parentBranch.tabId)?.mode).toBe('live')
    expect(controller.registry.getActive()?.sessionId).toBe('child-b')
    // Active child must not inherit parentReadonly probes.
    expect(controller.hostProbesForActive()?.parentReadonly).toBeUndefined()
    expect(host.resumeCalls).toEqual([])
  })

  it('turn-0 edit-resend must use emptySeed (not tip omit) + editedText only', async () => {
    const host = createEmitHost()
    const controller = new ConversationController(host)
    const parent = controller.newConversation('edit0')
    seedParentMessages(controller, parent.sessionId, [
      { role: 'user', text: 'old', turn: 0 },
      { role: 'assistant', text: 'keep-me-out', turn: 0 },
    ])
    let opts: { boundarySeq?: number; emptySeed?: boolean } | undefined
    controller.installTestHooks({
      eventsBySession: new Map([[parent.sessionId, closedTurnEvents('old')]]),
      forkSession: async (_p, o) => {
        opts = o
        return 'child-edit0'
      },
    })
    controller.setPanelHost(new ChatPanelHost({
      registry: controller.registry,
      messages: controller.messages,
      isHostReady: () => true,
      acceptSend: (text) => controller.promptActive(text),
    }))
    const result = await controller.forkFromClosedTurn({
      parentSessionId: parent.sessionId,
      boundary: { kind: 'closed-turn', turn: 0 },
      intent: 'edit-resend',
      editedText: 'brand-new',
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(opts).toEqual({ emptySeed: true })
    expect(opts?.boundarySeq).toBeUndefined()
    const child = controller.messages.get('child-edit0')
    expect(child.some(m => m.text === 'keep-me-out')).toBe(false)
    expect(child.filter(m => m.role === 'user').at(-1)?.text).toBe('brand-new')
  })

  it('AC-30 copy-message parameter variation: distinct texts do not collapse', async () => {
    const copied: string[] = []
    const host = createEmitHost()
    const controller = new ConversationController(host)
    controller.newConversation('copy')
    const panel = new ChatPanelHost({
      registry: controller.registry,
      messages: controller.messages,
      isHostReady: () => true,
      acceptSend: (text) => controller.promptActive(text),
      requestCopyMessage: async (_id, text) => {
        copied.push(text ?? '')
      },
    })
    await panel.handleWebviewMessage({
      type: 'action/copy-message',
      messageId: 'm1',
      text: 'alpha-copy',
    })
    await panel.handleWebviewMessage({
      type: 'action/copy-message',
      messageId: 'm2',
      text: 'beta-copy',
    })
    expect(copied).toEqual(['alpha-copy', 'beta-copy'])
  })

  it('AC-64+AC-65 contrast: fork empty changes; Continue same-id resume', async () => {
    const host = createEmitHost()
    const controller = new ConversationController(host)
    const parent = controller.newConversation('chg')
    seedParentMessages(controller, parent.sessionId, [
      { role: 'user', text: 'u', turn: 0 },
      { role: 'assistant', text: 'a', turn: 0 },
    ])
    controller.changes.upsert({
      changeId: 'cx',
      sessionId: parent.sessionId,
      turn: 0,
      sourceMessageId: 'm',
      path: 'x.ts',
      kind: 'modified',
      status: 'unreviewed',
      additions: 2,
      deletions: 1,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      afterContentHash: 'h',
    })
    controller.installTestHooks({
      eventsBySession: new Map([[parent.sessionId, closedTurnEvents()]]),
      forkSession: async () => 'child-chg',
    })
    const fork = await controller.forkFromClosedTurn({
      parentSessionId: parent.sessionId,
      boundary: { kind: 'closed-turn', turn: 0 },
      intent: 'branch',
    })
    expect(fork.ok).toBe(true)
    expect(controller.changes.list('child-chg')).toEqual([])
    expect(controller.changes.list(parent.sessionId)).toHaveLength(1)

    const cont = controller.newConversation('cont')
    controller.registry.setMode(cont.tabId, 'replay')
    controller.index.upsertSession({
      sessionId: cont.sessionId,
      title: 'cont',
      mtime: Date.now(),
      continueCapability: 'same-id',
    })
    const before = cont.sessionId
    const result = await controller.continueConversation(cont.tabId)
    expect(result.outcome).toBe('continued')
    if (result.outcome !== 'continued') return
    expect(result.sessionId).toBe(before)
    expect(host.resumeCalls).toEqual([before])
  })
})
