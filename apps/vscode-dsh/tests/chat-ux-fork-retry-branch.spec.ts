/**
 * Layer B — fork / P-接续 E2 / P-标明 / AC-64 / Continue contrast (phase-5).
 * Uses real ConversationController + MessageStore + ChangeStore + ChatPanelHost.
 */

import { describe, expect, it } from 'vitest'
import { randomUUID } from 'node:crypto'
import { ConversationController } from '../src/conversation-controller.ts'
import {
  ChatPanelHost,
  FakeWebviewPort,
} from '../src/chat-panel/index.ts'
import { IdeSessionHost } from '../src/session-host.ts'
import type { HarnessNotification } from '@deepseek-ai/dsh-sdk-client'
import type { HydratorSessionEvent } from '../src/replay-hydrator.ts'

type NotificationListener = (notification: HarnessNotification) => void

function createEmitHost(options?: {
  forkImpl?: (
    parentSessionId: string,
    opts?: { boundarySeq?: number; emptySeed?: boolean; childSessionId?: string },
  ) => Promise<string>
  resumeImpl?: (sessionId: string) => Promise<void>
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
      if (options?.resumeImpl) await options.resumeImpl(sessionId)
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

function closedTurnEvents(userText = 'hello', reason: 'completed' | 'aborted' = 'completed'): HydratorSessionEvent[] {
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

/** Two closed turns for prior-cut MessageStore trim regression. */
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

function seedClosedTurn(
  controller: ConversationController,
  sessionId: string,
  options?: { incomplete?: boolean; userText?: string },
): { userId: string; assistantId: string } {
  const userId = randomUUID()
  const assistantId = randomUUID()
  controller.messages.replace(sessionId, [
    {
      id: userId,
      sessionId,
      role: 'user',
      kind: 'text',
      text: options?.userText ?? 'hello',
      turn: 0,
    },
    {
      id: assistantId,
      sessionId,
      role: 'assistant',
      kind: 'text',
      text: 'world',
      turn: 0,
      ...options?.incomplete === true ? { incomplete: true } : {},
    },
  ])
  return { userId, assistantId }
}

describe('layer-B fork / P-接续 / P-标明 / Continue (AC-30–34 / AC-60–66)', () => {
  it('AC-30: copy-message writes lastCopiedText via Host path', async () => {
    const host = createEmitHost()
    const controller = new ConversationController(host)
    const tab = controller.newConversation('live')
    const { assistantId } = seedClosedTurn(controller, tab.sessionId)
    const panel = new ChatPanelHost({
      registry: controller.registry,
      messages: controller.messages,
      isHostReady: () => true,
      acceptSend: (text) => controller.promptActive(text),
      requestCopyMessage: async (_id, text) => {
        // Mirror extension copy path without vscode clipboard.
        ;(globalThis as { __dshLastCopied?: string }).__dshLastCopied = text ?? ''
      },
    })
    controller.setPanelHost(panel)
    await panel.handleWebviewMessage({
      type: 'action/copy-message',
      messageId: assistantId,
      text: 'world',
    })
    expect((globalThis as { __dshLastCopied?: string }).__dshLastCopied).toBe('world')
  })

  it('AC-31/31b/66: retry → new child id, parent mode=replay, E2 probes, active=child', async () => {
    const host = createEmitHost()
    const controller = new ConversationController(host)
    const parent = controller.newConversation('parent')
    const { assistantId } = seedClosedTurn(controller, parent.sessionId)
    const events = closedTurnEvents()
    controller.installTestHooks({
      eventsBySession: new Map([[parent.sessionId, events]]),
      forkSession: async () => 'child-retry-1',
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

    const result = await controller.forkFromClosedTurn({
      parentSessionId: parent.sessionId,
      boundary: { kind: 'closed-turn', turn: 0 },
      intent: 'retry',
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.childSessionId).toBe('child-retry-1')
    expect(result.presentation).toBe('continue-switch')
    expect(result.childSessionId).not.toBe(parent.sessionId)

    const parentAfter = controller.registry.get(parent.tabId)!
    expect(parentAfter.mode).toBe('replay')
    const active = controller.registry.getActive()!
    expect(active.sessionId).toBe('child-retry-1')
    expect(active.mode).toBe('live')

    // Switch back to parent — E2 probes must come from Host, not Webview invention.
    controller.switchConversation(parent.tabId)
    panel.pushFullState()
    const states = fake.receivedFromHost.filter(m => m.type === 'panel/state')
    const last = states.at(-1)
    expect(last?.type).toBe('panel/state')
    if (last?.type === 'panel/state') {
      expect(last.mode).toBe('replay')
      expect(last.probes?.parentReadonly).toBe(true)
      expect(last.probes?.continueSealed).toBe(true)
      expect(last.continue?.visibility).toBe('disabled')
      expect(last.continue?.reason).toBe('continue-sealed')
    }
    // AC-66: must not have resumed parent id.
    expect(host.resumeCalls).toEqual([])
    void assistantId
  })

  it('AC-31b rejects fake E2: parent still live is not readonly', async () => {
    const host = createEmitHost()
    const controller = new ConversationController(host)
    const tab = controller.newConversation('live')
    expect(tab.mode).toBe('live')
    expect(controller.hostProbesForActive()).toBeUndefined()
    // Frontend-only disable without mode→replay would leave probes unset — assert Host gate.
    const panel = new ChatPanelHost({
      registry: controller.registry,
      messages: controller.messages,
      isHostReady: () => true,
      acceptSend: (text) => controller.promptActive(text),
      resolveHostProbes: () => controller.hostProbesForActive(),
    })
    const fake = new FakeWebviewPort()
    panel.attach(fake)
    panel.pushFullState()
    const state = fake.receivedFromHost.find(m => m.type === 'panel/state')
    expect(state?.type === 'panel/state' && state.mode).toBe('live')
    expect(state?.type === 'panel/state' && state.probes?.parentReadonly).toBeUndefined()
  })

  it('AC-32: edit-resend forks with P-接续 + E2', async () => {
    const host = createEmitHost()
    const controller = new ConversationController(host)
    const parent = controller.newConversation('edit')
    const { userId } = seedClosedTurn(controller, parent.sessionId, { userText: 'old' })
    let capturedOpts: { boundarySeq?: number; emptySeed?: boolean } | undefined
    controller.installTestHooks({
      eventsBySession: new Map([[parent.sessionId, closedTurnEvents('old')]]),
      forkSession: async (_p, opts) => {
        capturedOpts = opts
        return 'child-edit-1'
      },
    })
    controller.setPanelHost(new ChatPanelHost({
      registry: controller.registry,
      messages: controller.messages,
      isHostReady: () => true,
      acceptSend: (text) => controller.promptActive(text),
      resolveHostProbes: () => controller.hostProbesForActive(),
    }))
    const result = await controller.forkFromClosedTurn({
      parentSessionId: parent.sessionId,
      boundary: { kind: 'closed-turn', turn: 0 },
      intent: 'edit-resend',
      seedUserMessageId: userId,
      editedText: 'new text',
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.presentation).toBe('continue-switch')
    expect(controller.registry.get(parent.tabId)?.mode).toBe('replay')
    expect(controller.registry.getActive()?.sessionId).toBe('child-edit-1')
    expect(result.emptySeed).toBe(true)
    expect(capturedOpts).toEqual({ emptySeed: true })
    const childMsgs = controller.messages.get('child-edit-1')
    const lastUser = [...childMsgs].reverse().find(m => m.role === 'user')
    expect(lastUser?.text).toBe('new text')
    expect(childMsgs.some(m => m.role === 'assistant')).toBe(false)
  })

  it('Must-Fix: turn-0 retry uses emptySeed (not tip-fork) and drops parent assistant', async () => {
    const host = createEmitHost()
    const controller = new ConversationController(host)
    const parent = controller.newConversation('turn0-retry')
    seedClosedTurn(controller, parent.sessionId)
    expect(controller.messages.get(parent.sessionId).some(m => m.role === 'assistant')).toBe(true)
    let capturedOpts: { boundarySeq?: number; emptySeed?: boolean } | undefined
    controller.installTestHooks({
      eventsBySession: new Map([[parent.sessionId, closedTurnEvents()]]),
      forkSession: async (_p, opts) => {
        capturedOpts = opts
        expect(opts?.emptySeed).toBe(true)
        expect(opts?.boundarySeq).toBeUndefined()
        return 'child-empty-seed'
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
      intent: 'retry',
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.emptySeed).toBe(true)
    expect(result.boundarySeq).toBeUndefined()
    expect(capturedOpts).toEqual({ emptySeed: true })
    const childMsgs = controller.messages.get('child-empty-seed')
    // Auto-prompt re-sends user text only — no discarded assistant from parent tip.
    expect(childMsgs.some(m => m.role === 'assistant')).toBe(false)
    expect(childMsgs.filter(m => m.role === 'user')).toHaveLength(1)
    expect(childMsgs.find(m => m.role === 'user')?.text).toBe('hello')
  })

  it('Must-Fix: retry turn=1 trims MessageStore to prior turn (drops discarded assistant)', async () => {
    const host = createEmitHost()
    const controller = new ConversationController(host)
    const parent = controller.newConversation('prior-cut')
    controller.messages.replace(parent.sessionId, [
      {
        id: randomUUID(),
        sessionId: parent.sessionId,
        role: 'user',
        kind: 'text',
        text: 'first',
        turn: 0,
      },
      {
        id: randomUUID(),
        sessionId: parent.sessionId,
        role: 'assistant',
        kind: 'text',
        text: 'world',
        turn: 0,
      },
      {
        id: randomUUID(),
        sessionId: parent.sessionId,
        role: 'user',
        kind: 'text',
        text: 'second',
        turn: 1,
      },
      {
        id: randomUUID(),
        sessionId: parent.sessionId,
        role: 'assistant',
        kind: 'text',
        text: 'reply-2',
        turn: 1,
      },
    ])
    controller.installTestHooks({
      eventsBySession: new Map([[parent.sessionId, twoClosedTurnEvents()]]),
      forkSession: async (_p, opts) => {
        expect(opts?.emptySeed).toBeUndefined()
        expect(opts?.boundarySeq).toBe(3) // turn 0 turn/end
        return 'child-prior-cut'
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
      boundary: { kind: 'closed-turn', turn: 1 },
      intent: 'retry',
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.seedMaxTurn).toBe(0)
    expect(result.boundarySeq).toBe(3)
    const childMsgs = controller.messages.get('child-prior-cut')
    // Seed hydrate ≤ turn 0, then auto-prompt re-sends turn-1 user text.
    expect(childMsgs.filter(m => m.turn === 0)).toHaveLength(2)
    expect(childMsgs.some(m => m.turn === 1 && m.role === 'assistant' && m.text === 'reply-2')).toBe(false)
    expect(childMsgs.filter(m => m.role === 'user').at(-1)?.text).toBe('second')
  })

  it('AC-34/61: aborted turn is rejected before fork', async () => {
    const host = createEmitHost()
    const controller = new ConversationController(host)
    const parent = controller.newConversation('aborted')
    seedClosedTurn(controller, parent.sessionId, { incomplete: true })
    controller.installTestHooks({
      eventsBySession: new Map([[parent.sessionId, closedTurnEvents('hello', 'aborted')]]),
      forkSession: async () => {
        throw new Error('should not fork')
      },
    })
    const result = await controller.forkFromClosedTurn({
      parentSessionId: parent.sessionId,
      boundary: { kind: 'closed-turn', turn: 0 },
      intent: 'retry',
    })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.reason).toBe('aborted-turn')
    expect(host.forkCalls).toHaveLength(0)
  })

  it('P2-1: parent running rejects fork', async () => {
    const host = createEmitHost()
    const controller = new ConversationController(host)
    const parent = controller.newConversation('running')
    seedClosedTurn(controller, parent.sessionId)
    controller.registry.setStatus(parent.tabId, 'running')
    controller.installTestHooks({
      eventsBySession: new Map([[parent.sessionId, closedTurnEvents()]]),
      forkSession: async () => 'should-not',
    })
    const result = await controller.forkFromClosedTurn({
      parentSessionId: parent.sessionId,
      boundary: { kind: 'closed-turn', turn: 0 },
      intent: 'branch',
    })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.reason).toBe('parent-running')
  })

  it('AC-60/62/63: branch → P-标明; parent mode unchanged; lineage', async () => {
    const host = createEmitHost()
    const controller = new ConversationController(host)
    const parent = controller.newConversation('branch-parent')
    expect(parent.mode).toBe('live')
    seedClosedTurn(controller, parent.sessionId)
    controller.installTestHooks({
      eventsBySession: new Map([[parent.sessionId, closedTurnEvents()]]),
      forkSession: async () => 'child-branch-1',
    })
    const result = await controller.forkFromClosedTurn({
      parentSessionId: parent.sessionId,
      boundary: { kind: 'closed-turn', turn: 0 },
      intent: 'branch',
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.presentation).toBe('branch-mark')
    expect(controller.registry.get(parent.tabId)?.mode).toBe('live')
    expect(controller.hostProbesForActive()?.parentReadonly).toBeUndefined()
    const childRow = controller.index.read().sessions.find(s => s.sessionId === 'child-branch-1')
    expect(childRow?.parentSessionId).toBe(parent.sessionId)
    expect(childRow?.forkLabel).toMatch(/派生自/)
    expect(controller.forkParentTitleForActive()).toBeTruthy()
  })

  it('AC-64: child ChangeStore empty; parent changes untouched; no checkout', async () => {
    const host = createEmitHost()
    const controller = new ConversationController(host)
    const parent = controller.newConversation('changes')
    seedClosedTurn(controller, parent.sessionId)
    controller.changes.upsert({
      changeId: 'c1',
      sessionId: parent.sessionId,
      turn: 0,
      sourceMessageId: 'm1',
      path: 'a.ts',
      kind: 'modified',
      status: 'unreviewed',
      additions: 1,
      deletions: 0,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      afterContentHash: 'hash',
    })
    expect(controller.changes.list(parent.sessionId)).toHaveLength(1)
    controller.installTestHooks({
      eventsBySession: new Map([[parent.sessionId, closedTurnEvents()]]),
      forkSession: async () => 'child-empty-changes',
    })
    const result = await controller.forkFromClosedTurn({
      parentSessionId: parent.sessionId,
      boundary: { kind: 'closed-turn', turn: 0 },
      intent: 'branch',
    })
    expect(result.ok).toBe(true)
    expect(controller.changes.list('child-empty-changes')).toEqual([])
    expect(controller.changes.list(parent.sessionId)).toHaveLength(1)
  })

  it('AC-65: Continue keeps same sessionId (contrast with fork)', async () => {
    const host = createEmitHost()
    const controller = new ConversationController(host)
    const tab = controller.newConversation('cont')
    controller.registry.setMode(tab.tabId, 'replay')
    controller.index.upsertSession({
      sessionId: tab.sessionId,
      title: 'cont',
      mtime: Date.now(),
      continueCapability: 'same-id',
    })
    const before = tab.sessionId
    const result = await controller.continueConversation(tab.tabId)
    expect(result.outcome).toBe('continued')
    if (result.outcome !== 'continued') return
    expect(result.sessionId).toBe(before)
    expect(controller.registry.get(tab.tabId)?.mode).toBe('live')
    expect(host.resumeCalls).toEqual([before])
  })

  it('AC-33: retry/edit/branch all invoke fork (no truncate API)', async () => {
    const forkIds: string[] = []
    const host = createEmitHost({
      forkImpl: async () => {
        const id = `child-${forkIds.length}`
        forkIds.push(id)
        return id
      },
    })
    const controller = new ConversationController(host)
    const parent = controller.newConversation('shared')
    seedClosedTurn(controller, parent.sessionId)
    controller.installTestHooks({
      eventsBySession: new Map([[parent.sessionId, closedTurnEvents()]]),
    })
    const retry = await controller.forkFromClosedTurn({
      parentSessionId: parent.sessionId,
      boundary: { kind: 'closed-turn', turn: 0 },
      intent: 'retry',
    })
    expect(retry.ok).toBe(true)

    const parent2 = controller.newConversation('shared2')
    seedClosedTurn(controller, parent2.sessionId)
    controller.installTestHooks({
      eventsBySession: new Map([[parent2.sessionId, closedTurnEvents()]]),
    })
    const edit = await controller.forkFromClosedTurn({
      parentSessionId: parent2.sessionId,
      boundary: { kind: 'closed-turn', turn: 0 },
      intent: 'edit-resend',
      editedText: 'x',
    })
    expect(edit.ok).toBe(true)

    const parent3 = controller.newConversation('shared3')
    seedClosedTurn(controller, parent3.sessionId)
    controller.installTestHooks({
      eventsBySession: new Map([[parent3.sessionId, closedTurnEvents()]]),
    })
    const branch = await controller.forkFromClosedTurn({
      parentSessionId: parent3.sessionId,
      boundary: { kind: 'closed-turn', turn: 0 },
      intent: 'branch',
    })
    expect(branch.ok).toBe(true)
    expect(host.forkCalls.length).toBeGreaterThanOrEqual(3)
    expect(forkIds.length).toBeGreaterThanOrEqual(3)
  })
})
