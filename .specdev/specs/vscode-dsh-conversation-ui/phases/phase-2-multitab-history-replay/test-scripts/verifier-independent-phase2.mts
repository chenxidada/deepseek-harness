/**
 * Verifier-independent Phase 2 scenarios (do not trust implementer suites).
 *
 * V-IND-1: Live index persist → clearLocal (unbind) → activate without Host →
 *          listHistory/getIndex still cold-read workspaceState (AC-63 after-unbind;
 *          implementer only covered never-bound seed).
 * V-IND-2: Close Tab → openFromHistory → new tabId + mode=replay + FakeWebview
 *          ui/reject-send(replay) (VP-2-history / AC-30/31).
 * V-IND-3: Same-Tab FIFO after soft-priority demote path (AC-58 slice implementer
 *          did not isolate as FIFO-only).
 * V-IND-4: Param variation — two cold index payloads → different listHistory
 *          (stub detection on resolveWorkspaceIndex path).
 */
import { ConversationController } from '../../../../../../apps/vscode-dsh/src/conversation-controller.ts'
import {
  ChatPanelHost,
  FakeWebviewPort,
} from '../../../../../../apps/vscode-dsh/src/chat-panel/index.ts'
import type { IdeSessionHost } from '../../../../../../apps/vscode-dsh/src/session-host.ts'
import {
  InteractionCoordinator,
  type InteractionUi,
} from '../../../../../../apps/vscode-dsh/src/interaction-coordinator.ts'
import {
  EXTENSION_INDEX_STATE_KEY,
  type ExtensionIndexSnapshot,
  type WorkspaceStateLike,
} from '../../../../../../apps/vscode-dsh/src/extension-index.ts'
import {
  activate,
  deactivate,
} from '../../../../../../apps/vscode-dsh/src/extension.ts'

let failed = 0

function assert(cond: unknown, msg: string): void {
  if (!cond) {
    failed += 1
    console.error(`FAIL: ${msg}`)
  } else {
    console.log(`PASS: ${msg}`)
  }
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
      if (Date.now() > deadline) {
        reject(new Error(`waitFor timeout after ${timeoutMs}ms`))
        return
      }
      setTimeout(poll, 10)
    }
    poll()
  })
}

function stubHost(overrides: Partial<IdeSessionHost> = {}): IdeSessionHost {
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
    ...overrides,
  } as unknown as IdeSessionHost
}

function memoryState(initial?: ExtensionIndexSnapshot): WorkspaceStateLike & {
  raw: ExtensionIndexSnapshot | undefined
} {
  let stored = initial
  return {
    get raw() { return stored },
    get<T>(key: string): T | undefined {
      if (key === EXTENSION_INDEX_STATE_KEY) return stored as T | undefined
      return undefined
    },
    update(key: string, value: unknown) {
      if (key === EXTENSION_INDEX_STATE_KEY) stored = value as ExtensionIndexSnapshot
    },
  }
}

/** V-IND-1: AC-63 after live bind then unbind — not the implementer never-bound path. */
async function vInd1ColdListAfterUnbind(): Promise<void> {
  console.log('\n== V-IND-1 AC-63 list after live persist + clearLocal ==')
  const workspaceKey = '/tmp/dsh-vind-phase2-ac63-unbind'
  const state = memoryState()
  const host = stubHost()
  const controller = new ConversationController(host, state, workspaceKey)
  const live = controller.newConversation('Live then unbind')
  await controller.promptTab(live.tabId, 'persist me for cold list')
  const sessionId = live.sessionId
  assert(
    state.raw?.sessions.some(s => s.sessionId === sessionId) === true,
    'V-IND-1 live prompt persisted session into workspaceState',
  )

  // Simulate dsh.stopSession / unbindConversations: clear local Tabs, keep index.
  controller.clearLocal()
  assert(
    state.raw?.sessions.some(s => s.sessionId === sessionId) === true,
    'V-IND-1 clearLocal must NOT wipe ExtensionIndex workspaceState',
  )

  const commands = new Map<string, (...args: unknown[]) => unknown>()
  const messages: string[] = []
  activate({
    subscriptions: [],
    extensionPath: workspaceKey,
    workspaceState: state,
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
      createTreeView() { return { dispose() {} } },
    },
    workspace: { workspaceFolders: [{ uri: { fsPath: workspaceKey } }] },
    commands: {
      registerCommand(command: string, callback: (...args: unknown[]) => unknown) {
        commands.set(command, callback)
        return { dispose() {} }
      },
    },
  } as never)

  // No dsh.startSession — conversations unbound; cold path must still list.
  const listed = await commands.get('dsh.test.listHistory')!() as Array<{
    sessionId: string
    title: string
  }>
  assert(
    listed.some(r => r.sessionId === sessionId),
    `V-IND-1 listHistory after unbind includes ${sessionId}`,
  )
  const index = await commands.get('dsh.test.getIndex')!() as ExtensionIndexSnapshot
  assert(
    index.sessions.some(s => s.sessionId === sessionId && s.deleted !== true),
    'V-IND-1 getIndex after unbind still has session',
  )

  await commands.get('dsh.openHistory')!(sessionId)
  assert(
    messages.some(m => /not connected|connect Host|before.*replay/i.test(m)),
    'V-IND-1 openHistory without Host asks to connect (does not claim list visible)',
  )
  assert(
    !messages.some(m => /History list is visible/i.test(m)),
    'V-IND-1 openHistory must not claim History list is visible',
  )

  await deactivate()
}

/** V-IND-2: Close → replay reopen + reject-send (independent event texts / oracle). */
async function vInd2CloseThenReplayReject(): Promise<void> {
  console.log('\n== V-IND-2 close Tab → history replay → reject-send ==')
  const host = stubHost()
  const controller = new ConversationController(host)
  const live = controller.newConversation('Verifier live')
  await controller.promptTab(live.tabId, 'verifier-close-replay')
  const closedTabId = live.tabId
  const sessionId = live.sessionId

  const closed = await controller.closeConversation(closedTabId)
  assert(closed.outcome === 'closed', 'V-IND-2 close outcome=closed')
  assert(
    controller.registry.getBySessionId(sessionId) === undefined,
    'V-IND-2 Tab gone after close',
  )

  const events = [
    {
      type: 'user/message',
      seq: 10,
      data: {
        id: 'vu1',
        role: 'user',
        content: [{ type: 'text', text: 'verifier-close-replay' }],
      },
    },
    {
      type: 'assistant/message',
      seq: 11,
      data: {
        message: {
          id: 'va1',
          role: 'assistant',
          content: [{ type: 'text', text: 'verifier-ok' }],
        },
      },
    },
  ]
  const opened = await controller.openFromHistory(sessionId, { events })
  assert(opened.outcome === 'opened', 'V-IND-2 openFromHistory outcome=opened')
  if (opened.outcome !== 'opened') return
  assert(opened.tabId !== closedTabId, 'V-IND-2 mints new tabId')
  assert(opened.mode === 'replay', 'V-IND-2 mode=replay')
  assert(opened.messageCount === 2, 'V-IND-2 hydrated 2 messages')
  assert(
    controller.messages.get(sessionId).map(m => m.text).join('|') === 'verifier-close-replay|verifier-ok',
    'V-IND-2 message texts match injected log',
  )

  const panel = new ChatPanelHost({
    registry: controller.registry,
    messages: controller.messages,
    isHostReady: () => true,
    acceptSend: (text) => controller.promptActive(text),
  })
  controller.setPanelHost(panel)
  const fake = new FakeWebviewPort()
  panel.attach(fake)
  assert(
    fake.receivedFromHost.some(m => m.type === 'panel/state' && m.mode === 'replay'),
    'V-IND-2 FakeWebview panel/state mode=replay',
  )

  panel.clearOutboundLog()
  fake.emitFromWebview({ type: 'composer/send', text: 'verifier must reject' })
  await waitFor(() => panel.getOutboundLog().some(m => m.type === 'ui/reject-send'), 1_000)
  const reject = panel.getOutboundLog().find(m => m.type === 'ui/reject-send')
  assert(
    reject !== undefined && (reject as { reason?: string }).reason === 'replay',
    'V-IND-2 ui/reject-send reason=replay',
  )
  assert(
    !controller.messages.get(sessionId).some(m => m.text === 'verifier must reject'),
    'V-IND-2 rejected send must not append user message',
  )

  const again = await controller.openFromHistory(sessionId, { events })
  assert(again.outcome === 'activated', 'V-IND-2 second open activates existing')
  if (again.outcome === 'activated') {
    assert(again.tabId === opened.tabId, 'V-IND-2 reuses tabId (AC-64/65)')
  }
  assert(
    controller.registry.list().filter(t => t.sessionId === sessionId).length === 1,
    'V-IND-2 no duplicate Tab for same session',
  )
}

/** V-IND-3: Same-Tab FIFO — two pendings for inactive session present in order. */
async function vInd3SameTabFifo(): Promise<void> {
  console.log('\n== V-IND-3 same-Tab FIFO (AC-58) ==')
  const presented: string[] = []
  const settle = new Map<string, (v: 'allowed-once' | 'unavailable') => void>()
  const ui: InteractionUi = {
    async presentApproval(request, signal) {
      presented.push(request.id)
      return await new Promise(resolve => {
        settle.set(request.id, resolve)
        signal?.addEventListener('abort', () => resolve('unavailable'), { once: true })
      })
    },
    async presentQuestions() {
      return { answers: [] }
    },
  }

  const coordinator = new InteractionCoordinator()
  const host = stubHost()
  const controller = new ConversationController(host)
  const inactive = controller.newConversation('fifo-inactive')
  const active = controller.newConversation('fifo-active')
  coordinator.setUi(ui)
  coordinator.setRegistry(controller.registry)
  coordinator.onActiveSessionChange(active.sessionId)

  const pA = coordinator.handleApproval({
    id: 'fifo-a',
    sessionId: inactive.sessionId,
    toolName: 'Bash',
  })
  const pB = coordinator.handleApproval({
    id: 'fifo-b',
    sessionId: inactive.sessionId,
    toolName: 'Edit',
  })
  await waitFor(() => presented.includes('fifo-a'), 1_000)
  await delay(40)
  assert(presented[0] === 'fifo-a', 'V-IND-3 first presented is fifo-a')
  assert(!presented.includes('fifo-b'), 'V-IND-3 fifo-b waits while a presented')
  assert(
    coordinator.listPending().find(p => p.id === 'fifo-b')?.state === 'pending',
    'V-IND-3 fifo-b state=pending',
  )

  settle.get('fifo-a')!('allowed-once')
  await expectResolve(pA, 'allowed-once')
  await waitFor(() => presented.includes('fifo-b'), 1_000)
  assert(
    presented.filter(id => id === 'fifo-a' || id === 'fifo-b').join(',') === 'fifo-a,fifo-b',
    'V-IND-3 same-Tab order fifo-a then fifo-b',
  )

  settle.get('fifo-b')!('allowed-once')
  await expectResolve(pB, 'allowed-once')
}

async function expectResolve(
  p: Promise<unknown>,
  expected: unknown,
): Promise<void> {
  const value = await p
  assert(value === expected, `promise resolved to ${String(expected)} (got ${String(value)})`)
}

/** V-IND-4: Param variation — different cold seeds → different lists (not a constant stub). */
async function vInd4ParamVariationColdList(): Promise<void> {
  console.log('\n== V-IND-4 param variation cold listHistory ==')

  async function listFor(seed: ExtensionIndexSnapshot, folder: string): Promise<string[]> {
    const commands = new Map<string, (...args: unknown[]) => unknown>()
    let stored: ExtensionIndexSnapshot | undefined = seed
    activate({
      subscriptions: [],
      extensionPath: folder,
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
        constructor(label: string) { this.label = label }
      },
      TreeItemCollapsibleState: { None: 0 },
      EventEmitter: class {
        event = {}
        fire() {}
        dispose() {}
      },
      window: {
        async showErrorMessage() {},
        async showInformationMessage() {},
        registerWebviewViewProvider() { return { dispose() {} } },
        createTreeView() { return { dispose() {} } },
      },
      workspace: { workspaceFolders: [{ uri: { fsPath: folder } }] },
      commands: {
        registerCommand(command: string, callback: (...args: unknown[]) => unknown) {
          commands.set(command, callback)
          return { dispose() {} }
        },
      },
    } as never)
    const listed = await commands.get('dsh.test.listHistory')!() as Array<{ sessionId: string }>
    await deactivate()
    return listed.map(r => r.sessionId)
  }

  const a = await listFor({
    workspaceKey: '/tmp/dsh-vind-p2-a',
    sessions: [{
      sessionId: 'seed-alpha',
      title: 'Alpha',
      mtime: 1,
      continueCapability: 'unknown',
    }],
    openTabSet: [],
    ui: { restoreUiLimit: 8 },
  }, '/tmp/dsh-vind-p2-a')

  const b = await listFor({
    workspaceKey: '/tmp/dsh-vind-p2-b',
    sessions: [
      {
        sessionId: 'seed-beta',
        title: 'Beta',
        mtime: 2,
        continueCapability: 'same-id',
      },
      {
        sessionId: 'seed-gamma',
        title: 'Gamma',
        mtime: 3,
        continueCapability: 'derive-only',
      },
    ],
    openTabSet: [],
    ui: { restoreUiLimit: 8 },
  }, '/tmp/dsh-vind-p2-b')

  assert(a.join(',') === 'seed-alpha', 'V-IND-4 seed A lists seed-alpha')
  assert(b.join(',') === 'seed-gamma,seed-beta' || b.join(',') === 'seed-beta,seed-gamma',
    `V-IND-4 seed B lists beta+gamma (got ${b.join(',')})`)
  assert(a.join(',') !== b.join(','), 'V-IND-4 different inputs → different list outputs')
}

async function main(): Promise<void> {
  console.log('verifier-independent-phase2 starting')
  try {
    await vInd1ColdListAfterUnbind()
    await vInd2CloseThenReplayReject()
    await vInd3SameTabFifo()
    await vInd4ParamVariationColdList()
  } catch (error) {
    failed += 1
    console.error('FAIL: uncaught', error)
  }

  console.log(`\nverifier-independent-phase2 done; failed=${failed}`)
  if (failed > 0) process.exit(1)
}

void main()
