/**
 * Phase 2 L2/L3: unread/approval queue, history replay, DEBT-001/002.
 */

import { describe, expect, it, afterEach } from 'vitest'
import { ConversationController } from '../src/conversation-controller.ts'
import {
  ChatPanelHost,
  FakeWebviewPort,
} from '../src/chat-panel/index.ts'
import { IdeSessionHost } from '../src/session-host.ts'
import { InteractionCoordinator, type InteractionUi } from '../src/interaction-coordinator.ts'
import {
  hydrateFromAuthoritativeLog,
  foldTimeline,
  recoverableDiffsFromMeta,
} from '../src/replay-hydrator.ts'
import {
  continueCapabilityListHint,
  EXTENSION_INDEX_STATE_KEY,
  type ExtensionIndexSnapshot,
} from '../src/extension-index.ts'
import { listHistoryFromIndex } from '../src/history-view.ts'
import { activate, deactivate } from '../src/extension.ts'

describe('DEBT-002 dual-running status does not cross Tabs (AC-21)', () => {
  it('pushStatus after switch only carries active sessionId generating', async () => {
    const host = {
      status: 'connected' as const,
      interactions: {
        failClosedSession() {},
        listPending() { return [] },
        onActiveSessionChange() {},
        onChange() { return () => {} },
      },
      setConversationRegistry() {},
      onNotification() { return () => {} },
      async prompt() { return 'm' },
      async disposeSession() {},
    } as unknown as IdeSessionHost

    const controller = new ConversationController(host)
    const a = controller.newConversation('A')
    const b = controller.newConversation('B')
    controller.registry.setStatus(a.tabId, 'running')
    controller.registry.setStatus(b.tabId, 'running')

    const panel = new ChatPanelHost({
      registry: controller.registry,
      messages: controller.messages,
      interactions: host.interactions as never,
      isHostReady: () => true,
      acceptSend: (text) => controller.promptActive(text),
    })
    controller.setPanelHost(panel)
    const fake = new FakeWebviewPort()
    panel.attach(fake)
    fake.receivedFromHost.length = 0
    panel.clearOutboundLog()

    // B is active (created last). Status must be B generating, never A.
    panel.pushStatus()
    const statusB = fake.receivedFromHost.filter(m => m.type === 'status/set')
    expect(statusB.length).toBe(1)
    expect(statusB[0]).toMatchObject({
      type: 'status/set',
      sessionId: b.sessionId,
      status: 'generating',
    })
    expect(statusB.every(m => m.type === 'status/set' && m.sessionId !== a.sessionId)).toBe(true)

    fake.receivedFromHost.length = 0
    controller.switchConversation(a.tabId)
    panel.clearOutboundLog()
    fake.receivedFromHost.length = 0
    panel.pushStatus()
    const statusA = fake.receivedFromHost.filter(m => m.type === 'status/set')
    expect(statusA.length).toBeGreaterThanOrEqual(1)
    const lastA = statusA[statusA.length - 1]
    expect(lastA).toMatchObject({
      type: 'status/set',
      sessionId: a.sessionId,
      status: 'generating',
    })
    expect(statusA.every(m => m.type !== 'status/set' || m.sessionId === a.sessionId)).toBe(true)
  })
})

describe('AC-19/57 unread dots', () => {
  it('marks inactive Tab unread and clears on activate', () => {
    const host = stubHost()
    const controller = new ConversationController(host)
    const a = controller.newConversation('A')
    const b = controller.newConversation('B')
    expect(controller.registry.getActive()?.tabId).toBe(b.tabId)

    controller.injectAssistantMessage(a.sessionId, 'hello inactive')
    expect(controller.registry.get(a.tabId)?.unread).toBe(true)
    expect(controller.registry.get(b.tabId)?.unread).toBe(false)

    controller.switchConversation(a.tabId)
    expect(controller.registry.get(a.tabId)?.unread).toBe(false)
  })
})

describe('AD-CU-7 serial soft-priority queue (AC-20/58)', () => {
  it('serializes presentations; soft-priority inserts active pending; Tab switch demotes', async () => {
    const presented: string[] = []
    const ui: InteractionUi = {
      async presentApproval(request, signal) {
        presented.push(request.id)
        return await new Promise(resolve => {
          const onAbort = (): void => {
            resolve('unavailable')
          }
          signal?.addEventListener('abort', onAbort, { once: true })
          // Stay open until aborted or external settle — tests abort via coordinator.
          void request
        })
      },
      async presentQuestions() {
        return { answers: [] }
      },
    }

    const coordinator = new InteractionCoordinator()
    const host = stubHost()
    const controller = new ConversationController(host)
    const inactive = controller.newConversation('inactive')
    const active = controller.newConversation('active')
    coordinator.setUi(ui)
    coordinator.setRegistry(controller.registry)
    coordinator.onActiveSessionChange(active.sessionId)

    const p1 = coordinator.handleApproval({
      id: 'appr-inactive',
      sessionId: inactive.sessionId,
      toolName: 'Bash',
    })
    await waitFor(() => presented.includes('appr-inactive'), 1_000)
    expect(coordinator.listPending().find(p => p.id === 'appr-inactive')?.state).toBe('presented')

    // Soft priority: active pending inserts ahead of waiting (not interrupting presented).
    const p2 = coordinator.handleApproval({
      id: 'appr-active',
      sessionId: active.sessionId,
      toolName: 'Edit',
    })
    await delay(30)
    expect(presented).toEqual(['appr-inactive'])
    expect(coordinator.listPending().find(p => p.id === 'appr-active')?.state).toBe('pending')
    expect(coordinator.listPending().find(p => p.id === 'appr-inactive')?.state).toBe('presented')
    expect(controller.registry.get(active.tabId)?.approvalBadge).toBe(true)

    // Switch away from inactive while unanswered → demote presented to pending.
    coordinator.onActiveSessionChange(active.sessionId)
    await waitFor(
      () => coordinator.listPending().find(p => p.id === 'appr-inactive')?.state === 'pending',
      1_000,
    )
    await waitFor(() => presented.includes('appr-active'), 1_000)
    expect(coordinator.listPending().find(p => p.id === 'appr-active')?.state).toBe('presented')
    expect(controller.registry.get(inactive.tabId)?.approvalBadge).toBe(true)

    // Fail-closed head → dequeue and wake next.
    coordinator.failClosedSession(active.sessionId, 'abort head')
    await expect(p2).resolves.toBe('unavailable')
    await waitFor(() => presented.filter(id => id === 'appr-inactive').length >= 2, 1_000)
    coordinator.failClosedAll('done')
    await expect(p1).resolves.toBe('unavailable')
  })
})

describe('History list AD-CU-8 (AC-28/29/63/62)', () => {
  it('lists only non-deleted workspace index rows; unknown has no 可继续 hint', () => {
    const host = stubHost()
    const controller = new ConversationController(host, {
      get() { return undefined },
      update() {},
    }, '/workspace/a')
    controller.index.upsertSession({
      sessionId: 's-same',
      title: 'Same',
      mtime: 2,
      continueCapability: 'same-id',
    })
    controller.index.upsertSession({
      sessionId: 's-unknown',
      title: 'Unknown',
      mtime: 1,
      continueCapability: 'unknown',
    })
    controller.index.upsertSession({
      sessionId: 's-deleted',
      title: 'Gone',
      mtime: 3,
      deleted: true,
    })
    const rows = listHistoryFromIndex(controller.index)
    expect(rows.map(r => r.sessionId)).toEqual(['s-same', 's-unknown'])
    expect(continueCapabilityListHint('same-id')).toBe('可继续')
    expect(continueCapabilityListHint('derive-only')).toContain('新会话')
    expect(continueCapabilityListHint('unknown')).toBe('')
    expect(rows.find(r => r.sessionId === 's-unknown')?.continueHint).toBe('')
    expect(rows.find(r => r.sessionId === 's-same')?.continueHint).toBe('可继续')

    controller.index.markDeleted('s-same')
    expect(listHistoryFromIndex(controller.index).map(r => r.sessionId)).toEqual(['s-unknown'])
  })
})

describe('ReplayHydrator product oracle (DEBT-001 / AC-30/47)', () => {
  it('full timeline sequence + surfaceOp replace + oldText null', () => {
    const events = [
      { type: 'turn/start', seq: 0, data: { turn: 1 } },
      {
        type: 'user/message',
        seq: 1,
        data: {
          id: 'u1',
          role: 'user',
          content: [{ type: 'text', text: 'edit me' }],
        },
      },
      { type: 'step/start', seq: 2, data: { turn: 1, step: 1 } },
      {
        type: 'assistant/message',
        seq: 3,
        data: {
          message: {
            id: 'a1',
            role: 'assistant',
            content: [{ type: 'text', text: 'old draft' }],
          },
        },
      },
      {
        type: 'assistant/message',
        seq: 4,
        surfaceOp: 'replace',
        data: {
          message: {
            id: 'a1',
            role: 'assistant',
            content: [{ type: 'text', text: 'final draft' }],
          },
        },
      },
      {
        type: 'tool/call',
        seq: 5,
        data: { turn: 1, step: 1, callId: 'c1', name: 'Write' },
      },
      {
        type: 'tool/result',
        seq: 6,
        data: {
          turn: 1,
          step: 1,
          message: { source: { callId: 'c1' } },
          meta: {
            diffs: [{ path: 'new.txt', oldText: null, newText: 'created\n' }],
          },
        },
      },
      { type: 'step/end', seq: 7, data: { turn: 1, step: 1 } },
      {
        type: 'turn/end',
        seq: 8,
        data: { turn: 1, reason: { kind: 'completed' } },
      },
    ]

    const hydrated = hydrateFromAuthoritativeLog('sess-oracle', events)
    expect(hydrated.foldedMessages.map(m => m.text)).toEqual(['edit me', 'final draft'])
    expect(hydrated.foldedMessages.map(m => m.role)).toEqual(['user', 'assistant'])

    const timeline = foldTimeline(events)
    expect(timeline.map(r => `${r.kind}:${r.label}`)).toEqual([
      'turn:turn 1 start',
      'step:step 1 start',
      'tool:tool Write result',
      'step:step 1 end',
      'turn:turn 1 end:completed',
    ])
    expect(timeline.find(r => r.callId === 'c1')?.hasRecoverableDiffs).toBe(true)

    const createHunks = recoverableDiffsFromMeta({
      diffs: [{ path: 'new.txt', oldText: null, newText: 'created\n' }],
    })
    expect(createHunks).toEqual([{ path: 'new.txt', oldText: null, newText: 'created\n' }])
    expect(recoverableDiffsFromMeta({
      diffs: [{ path: 'patch-only.txt', newText: 'x' }],
    })).toEqual([])
  })
})

describe('VP-2-history / replay reject (AC-30/31/64/65)', () => {
  it('close → history reopen mints new tabId in replay; reject composer/send', async () => {
    const host = stubHost()
    const controller = new ConversationController(host)
    const live = controller.newConversation('Live')
    await controller.promptTab(live.tabId, 'remember me')
    const closedTabId = live.tabId
    const sessionId = live.sessionId

    const closed = await controller.closeConversation(closedTabId)
    expect(closed.outcome).toBe('closed')
    expect(controller.registry.getBySessionId(sessionId)).toBeUndefined()

    const events = [
      {
        type: 'user/message',
        seq: 1,
        data: {
          id: 'u1',
          role: 'user',
          content: [{ type: 'text', text: 'remember me' }],
        },
      },
      {
        type: 'assistant/message',
        seq: 2,
        data: {
          message: {
            id: 'a1',
            role: 'assistant',
            content: [{ type: 'text', text: 'ok' }],
          },
        },
      },
    ]
    const opened = await controller.openFromHistory(sessionId, { events })
    expect(opened.outcome).toBe('opened')
    if (opened.outcome !== 'opened') return
    expect(opened.tabId).not.toBe(closedTabId)
    expect(opened.mode).toBe('replay')
    expect(opened.messageCount).toBe(2)

    const panel = new ChatPanelHost({
      registry: controller.registry,
      messages: controller.messages,
      isHostReady: () => true,
      acceptSend: (text) => controller.promptActive(text),
    })
    controller.setPanelHost(panel)
    const fake = new FakeWebviewPort()
    panel.attach(fake)
    expect(fake.receivedFromHost.some(m => m.type === 'panel/state' && m.mode === 'replay')).toBe(true)

    panel.clearOutboundLog()
    fake.emitFromWebview({ type: 'composer/send', text: 'should reject' })
    await waitFor(() => panel.getOutboundLog().some(m => m.type === 'ui/reject-send'), 1_000)
    expect(panel.getOutboundLog().find(m => m.type === 'ui/reject-send')).toMatchObject({
      reason: 'replay',
    })

    // AC-64/65: reopen same session activates existing, no duplicate.
    const again = await controller.openFromHistory(sessionId, { events })
    expect(again.outcome).toBe('activated')
    if (again.outcome === 'activated') {
      expect(again.tabId).toBe(opened.tabId)
    }
    expect(controller.registry.list().filter(t => t.sessionId === sessionId)).toHaveLength(1)
  })
})

describe('L2 activate hooks include history commands', () => {
  const commands = new Map<string, (...args: unknown[]) => unknown>()

  afterEach(async () => {
    await deactivate()
    commands.clear()
  })

  it('registers history L2 hooks', async () => {
    activate({
      subscriptions: [],
      extensionPath: '/tmp/dsh-phase2',
      workspaceState: { get() { return undefined }, update() {} },
    }, {
      window: {
        async showErrorMessage() {},
        async showInformationMessage() {},
        registerWebviewViewProvider() { return { dispose() {} } },
      },
      workspace: { workspaceFolders: [{ uri: { fsPath: '/tmp/dsh-phase2' } }] },
      commands: {
        registerCommand(command: string, callback: (...args: unknown[]) => unknown) {
          commands.set(command, callback)
          return { dispose() {} }
        },
      },
    } as never)

    for (const name of [
      'dsh.openHistory',
      'dsh.deleteHistory',
      'dsh.test.openHistory',
      'dsh.test.listHistory',
      'dsh.test.injectAssistant',
      'dsh.test.switchConversation',
      'dsh.test.deleteHistory',
    ]) {
      expect(commands.has(name)).toBe(true)
    }
  })
})

describe('AC-63 history list without Host binding', () => {
  const commands = new Map<string, (...args: unknown[]) => unknown>()
  const messages: string[] = []
  let stored: ExtensionIndexSnapshot | undefined

  afterEach(async () => {
    await deactivate()
    commands.clear()
    messages.length = 0
    stored = undefined
  })

  it('listHistory / getIndex / TreeView rows read workspaceState when conversations unbound', async () => {
    stored = {
      workspaceKey: '/tmp/dsh-phase2-ac63',
      sessions: [{
        sessionId: 'hist-cold-1',
        title: 'Cold history',
        mtime: 1_700_000_000_000,
        continueCapability: 'unknown',
        firstUserPreview: 'hello from cold index',
      }],
      openTabSet: [],
      ui: { restoreUiLimit: 8 },
    }
    const historyRows: unknown[] = []

    activate({
      subscriptions: [],
      extensionPath: '/tmp/dsh-phase2-ac63',
      workspaceState: {
        get<T>(key: string): T | undefined {
          if (key === EXTENSION_INDEX_STATE_KEY) return stored as T | undefined
          return undefined
        },
        update(key: string, value: unknown) {
          if (key === EXTENSION_INDEX_STATE_KEY) stored = value as ExtensionIndexSnapshot
        },
      },
    }, {
      TreeItem: class {
        label: string
        description?: string
        contextValue?: string
        command?: unknown
        constructor(label: string) { this.label = label }
      },
      TreeItemCollapsibleState: { None: 0 },
      EventEmitter: class {
        event = {}
        fire() {}
        dispose() {}
      },
      window: {
        async showErrorMessage(msg: string) { messages.push(msg) },
        async showInformationMessage(msg: string) { messages.push(msg) },
        registerWebviewViewProvider() { return { dispose() {} } },
        createTreeView(viewId: string, options: {
          treeDataProvider: { getChildren(): unknown[] }
        }) {
          if (viewId === 'dsh.history') {
            historyRows.push(...options.treeDataProvider.getChildren())
          }
          return { dispose() {} }
        },
      },
      workspace: { workspaceFolders: [{ uri: { fsPath: '/tmp/dsh-phase2-ac63' } }] },
      commands: {
        registerCommand(command: string, callback: (...args: unknown[]) => unknown) {
          commands.set(command, callback)
          return { dispose() {} }
        },
      },
    } as never)

    // No dsh.startSession — conversations stays undefined (AC-63).
    const listed = await commands.get('dsh.test.listHistory')!() as Array<{ sessionId: string; title: string }>
    expect(listed.map(r => r.sessionId)).toEqual(['hist-cold-1'])
    expect(listed[0]?.title).toBe('Cold history')

    const index = await commands.get('dsh.test.getIndex')!() as ExtensionIndexSnapshot
    expect(index.sessions.map(s => s.sessionId)).toEqual(['hist-cold-1'])
    expect(index.openTabSet).toEqual([])

    expect(historyRows).toEqual(expect.arrayContaining([
      expect.objectContaining({ sessionId: 'hist-cold-1', label: 'Cold history' }),
    ]))

    await commands.get('dsh.openHistory')!('hist-cold-1')
    expect(messages.some(m => /History list is visible/i.test(m))).toBe(false)
    expect(messages.some(m => /not connected|connect Host|before.*replay/i.test(m))).toBe(true)
  })
})

function stubHost(): IdeSessionHost {
  return {
    status: 'connected' as const,
    interactions: new InteractionCoordinator(),
    setConversationRegistry(registry?: unknown) {
      if (registry !== undefined) {
        ;(this.interactions as InteractionCoordinator).setRegistry(registry as never)
      }
    },
    onNotification() { return () => {} },
    async prompt() { return 'msg' },
    async disposeSession() {},
    async readSessionLog() { return [] },
  } as unknown as IdeSessionHost
}

function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

function waitFor(predicate: () => boolean, timeoutMs: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const deadline = Date.now() + timeoutMs
    const poll = (): void => {
      if (predicate()) {
        resolve()
        return
      }
      if (Date.now() >= deadline) {
        reject(new Error('timed out'))
        return
      }
      setTimeout(poll, 20)
    }
    poll()
  })
}
