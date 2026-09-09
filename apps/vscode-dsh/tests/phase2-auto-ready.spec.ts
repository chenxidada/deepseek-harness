/**
 * Phase 2 L2: AutoReady surface — restore / New / empty Tab / unread / no-workspace / AC-7.
 */

import { afterEach, describe, expect, it, vi } from 'vitest'
import { IdeSessionHost } from '../src/session-host.ts'
import {
  activate,
  deactivate,
  getConversationSnapshot,
  getConversationController,
} from '../src/extension.ts'
import {
  EXTENSION_INDEX_STATE_KEY,
  type ExtensionIndexSnapshot,
} from '../src/extension-index.ts'
import { ConversationController } from '../src/conversation-controller.ts'
import { AutoReadyCoordinator } from '../src/auto-ready-coordinator.ts'

describe('phase-2 auto-ready L2', () => {
  const commands = new Map<string, (...args: unknown[]) => unknown>()
  let mem: Map<string, unknown>
  let continueSpy: ReturnType<typeof vi.spyOn> | undefined

  afterEach(async () => {
    continueSpy?.mockRestore()
    continueSpy = undefined
    await deactivate()
    commands.clear()
    vi.restoreAllMocks()
  })

  function makeVscode(opts?: {
    workspaceFolders?: readonly { uri: { fsPath: string } }[] | undefined
  }) {
    const folders = opts?.workspaceFolders === undefined
      ? [{ uri: { fsPath: '/tmp/dsh-phase2-ready' } }]
      : opts.workspaceFolders
    return {
      window: {
        async showErrorMessage() {},
        async showInformationMessage() {},
        registerWebviewViewProvider() {
          return { dispose() {} }
        },
      },
      workspace: {
        workspaceFolders: folders,
      },
      commands: {
        registerCommand(command: string, callback: (...args: unknown[]) => unknown) {
          commands.set(command, callback)
          return { dispose() {} }
        },
        async executeCommand() {},
      },
      StatusBarAlignment: { Left: 1, Right: 2 },
    }
  }

  function activateWith(
    vscode: ReturnType<typeof makeVscode>,
    seed?: ExtensionIndexSnapshot,
  ): void {
    mem = new Map()
    if (seed !== undefined) {
      mem.set(EXTENSION_INDEX_STATE_KEY, seed)
    }
    activate({
      subscriptions: [],
      extensionPath: '/tmp/dsh-phase2-ready',
      workspaceState: {
        get<T>(key: string) { return mem.get(key) as T | undefined },
        update(key: string, value: unknown) { mem.set(key, value) },
      },
    }, vscode as never)
  }

  function mockConnectedHost(opts?: {
    readSessionLog?: (sessionId: string) => Promise<unknown[]>
  }): void {
    vi.spyOn(IdeSessionHost.prototype, 'start').mockImplementation(async function (
      this: IdeSessionHost,
    ) {
      this.status = 'connected'
    })
    vi.spyOn(IdeSessionHost.prototype, 'prompt').mockResolvedValue('msg-test-1')
    vi.spyOn(IdeSessionHost.prototype, 'readSessionLog').mockImplementation(
      opts?.readSessionLog
        ?? (async () => [] as unknown[]),
    )
  }

  function userAssistantEvents(userText: string, assistantText: string) {
    return [
      {
        type: 'user/message',
        seq: 0,
        data: { role: 'user', id: `u-${userText}`, content: [{ type: 'text', text: userText }] },
      },
      {
        type: 'assistant/message',
        seq: 1,
        data: {
          message: {
            role: 'assistant',
            id: `a-${assistantText}`,
            content: [{ type: 'text', text: assistantText }],
          },
        },
      },
    ]
  }

  it('AC-7 + AC-1a reverse: visibility main path New; startup-only stays idle/0 tabs', async () => {
    mockConnectedHost()
    activateWith(makeVscode())
    await commands.get('dsh.test.setCredentialPresence')!(true)

    const sim = await commands.get('dsh.test.simulateStartupOnly')!() as {
      startState: string
      hostCreateCount: number
      tabs: number
      openTabSet: number
    }
    expect(sim.startState).toBe('idle')
    expect(sim.hostCreateCount).toBe(0)
    expect(sim.tabs).toBe(0)
    expect(sim.openTabSet).toBe(0)
    expect(getConversationSnapshot().tabs).toEqual([])

    // Hidden Start must not create Tabs (DEBT-001 closed).
    await commands.get('dsh.test.requestStart')!('command-start')
    expect(getConversationController()).toBeDefined()
    expect(getConversationSnapshot().tabs).toHaveLength(0)

    await commands.get('dsh.test.fireConversationVisibility')!(true)
    await vi.waitFor(() => {
      expect(getConversationSnapshot().tabs.length).toBeGreaterThanOrEqual(1)
    })
    const tabs = getConversationSnapshot().tabs
    expect(tabs[0]?.mode).toBe('live')
    expect(tabs.every(t => t.unread !== true)).toBe(true)

    const sent = await commands.get('dsh.test.sendPrompt')!('hello phase2')
    expect(sent).toMatchObject({ ok: true })
  })

  it('AC-3: restore non-empty openTabSet as replay; no auto Continue; unread false', async () => {
    const events = userAssistantEvents('prev-user', 'prev-asst')
    mockConnectedHost({
      readSessionLog: async (sessionId) => {
        if (sessionId === 'sess-restore-a') return events
        return []
      },
    })
    activateWith(makeVscode(), {
      workspaceKey: '/tmp/dsh-phase2-ready',
      sessions: [{ sessionId: 'sess-restore-a', title: 'A', mtime: 1 }],
      openTabSet: [
        { tabId: 'old-a', sessionId: 'sess-restore-a', mode: 'live', title: 'A', liveIntent: true },
      ],
      activeSessionId: 'sess-restore-a',
      ui: { restoreUiLimit: 8 },
    })
    await commands.get('dsh.test.setCredentialPresence')!(true)

    continueSpy = vi.spyOn(ConversationController.prototype, 'continueConversation')

    await commands.get('dsh.test.fireConversationVisibility')!(true)
    await vi.waitFor(() => {
      const tabs = getConversationSnapshot().tabs
      expect(tabs.some(t => t.sessionId === 'sess-restore-a' && t.mode === 'replay')).toBe(true)
    })

    const trigger = await commands.get('dsh.test.triggerAutoReady')!() as {
      applied: boolean
      path: string
    }
    expect(trigger.applied).toBe(true)

    expect(continueSpy).not.toHaveBeenCalled()
    expect(getConversationSnapshot().tabs.every(t => t.unread !== true)).toBe(true)
  })

  it('AC-4: empty openTabSet → New live; unread false; sendPrompt ok', async () => {
    mockConnectedHost()
    activateWith(makeVscode())
    await commands.get('dsh.test.setCredentialPresence')!(true)

    await commands.get('dsh.test.fireConversationVisibility')!(true)
    await vi.waitFor(() => {
      expect(getConversationSnapshot().tabs.some(t => t.mode === 'live')).toBe(true)
    })
    expect(getConversationSnapshot().tabs.every(t => t.unread !== true)).toBe(true)

    const sent = await commands.get('dsh.test.sendPrompt')!('ac4 prompt')
    expect(sent).toMatchObject({ ok: true })
  })

  it('AC-4a: empty Tab stays out of openTabSet until first successful enqueue', async () => {
    mockConnectedHost()
    activateWith(makeVscode())
    await commands.get('dsh.test.setCredentialPresence')!(true)

    await commands.get('dsh.test.fireConversationVisibility')!(true)
    await vi.waitFor(() => {
      expect(getConversationSnapshot().tabs).toHaveLength(1)
    })
    const emptySession = getConversationSnapshot().tabs[0]!.sessionId

    let index = await commands.get('dsh.test.getIndex')!() as ExtensionIndexSnapshot
    expect(index.openTabSet.some(t => t.sessionId === emptySession)).toBe(false)

    await commands.get('dsh.test.sendPrompt')!('first enqueue')
    index = await commands.get('dsh.test.getIndex')!() as ExtensionIndexSnapshot
    expect(index.openTabSet.some(t => t.sessionId === emptySession)).toBe(true)

    // Simulate restart hydrate: empty never-enqueued session absent from durable set
    // (already proven before enqueue); after enqueue it is present for restore.
    const host = new IdeSessionHost()
    host.status = 'connected'
    // Authoritative log must carry user/assistant content or restore strips the row.
    host.readSessionLog = async () => userAssistantEvents('first enqueue', 'ac4a-asst') as never
    const cold = new ConversationController(host, {
      get<T>(key: string) { return mem.get(key) as T | undefined },
      update(key: string, value: unknown) { mem.set(key, value) },
    }, '/tmp/dsh-phase2-ready')
    expect(cold.index.read().openTabSet.some(t => t.sessionId === emptySession)).toBe(true)
    const coldRestore = await cold.restoreOpenTabSet()
    expect(coldRestore.outcome).toBe('restored')
    expect(cold.registry.list().some(t => t.sessionId === emptySession)).toBe(true)
  })

  it('AC-4b: no workspace folders → skip restore, New live; Start still runs', async () => {
    mockConnectedHost()
    const restoreSpy = vi.spyOn(ConversationController.prototype, 'restoreOpenTabSet')
    activateWith(makeVscode({ workspaceFolders: [] }), {
      workspaceKey: '',
      sessions: [{ sessionId: 'sess-should-not-restore', title: 'X', mtime: 1 }],
      openTabSet: [
        {
          tabId: 'old-x',
          sessionId: 'sess-should-not-restore',
          mode: 'replay',
          title: 'X',
        },
      ],
      activeSessionId: 'sess-should-not-restore',
      ui: { restoreUiLimit: 8 },
    })
    await commands.get('dsh.test.setCredentialPresence')!(true)

    await commands.get('dsh.test.fireConversationVisibility')!(true)
    await vi.waitFor(() => {
      expect(getConversationSnapshot().tabs.some(t => t.mode === 'live')).toBe(true)
    })

    expect(restoreSpy).not.toHaveBeenCalled()
    expect(
      getConversationSnapshot().tabs.every(t => t.sessionId !== 'sess-should-not-restore'),
    ).toBe(true)
    const orch = await commands.get('dsh.test.getStartState')!() as { state: string }
    expect(orch.state).toBe('started')
  })

  it('AC-6: repeated triggerAutoReady reuses active empty Tab (no stack)', async () => {
    mockConnectedHost()
    activateWith(makeVscode())
    await commands.get('dsh.test.setCredentialPresence')!(true)

    await commands.get('dsh.test.fireConversationVisibility')!(true)
    await vi.waitFor(() => {
      expect(getConversationSnapshot().tabs).toHaveLength(1)
    })
    const firstId = getConversationSnapshot().tabs[0]!.tabId

    await commands.get('dsh.test.triggerAutoReady')!()
    await commands.get('dsh.test.fireConversationVisibility')!(false)
    await commands.get('dsh.test.fireConversationVisibility')!(true)
    await commands.get('dsh.test.triggerAutoReady')!()

    expect(getConversationSnapshot().tabs).toHaveLength(1)
    expect(getConversationSnapshot().tabs[0]?.tabId).toBe(firstId)

    const sent = await commands.get('dsh.test.sendPrompt')!('still live')
    expect(sent).toMatchObject({ ok: true })
  })
})

describe('phase-2 newConversationOrReuseEmpty (AD-CR-6)', () => {
  it('reuses active empty only; never steals inactive empty', () => {
    const host = new IdeSessionHost()
    host.status = 'connected'
    const controller = new ConversationController(host)
    const emptyA = controller.newConversation('A')
    const contentB = controller.newConversation('B')
    controller.messages.append(contentB.sessionId, {
      id: 'm1',
      sessionId: contentB.sessionId,
      role: 'user',
      kind: 'text',
      text: 'hi',
    })
    controller.switchConversation(contentB.tabId)

    // Active has content → must New even though emptyA exists.
    const created = controller.newConversationOrReuseEmpty('C')
    expect(created.tabId).not.toBe(emptyA.tabId)
    expect(created.tabId).not.toBe(contentB.tabId)

    // Active empty → reuse.
    const emptyC = created
    expect(controller.messages.hasContent(emptyC.sessionId)).toBe(false)
    const reused = controller.newConversationOrReuseEmpty('again')
    expect(reused.tabId).toBe(emptyC.tabId)
  })
})

describe('phase-2 AutoReadyCoordinator latch (L1)', () => {
  it('gates on visible && hostReady; hide bumps epoch', async () => {
    const news: string[] = []
    const controller = {
      registry: {
        list: () => [] as { tabId: string; sessionId: string; unread: boolean }[],
        getActive: () => undefined,
        setUnread() {},
      },
      messages: { hasContent: () => false },
      newConversationOrReuseEmpty() {
        news.push('new')
        return { tabId: 't1', sessionId: 's1' }
      },
      async restoreOpenTabSet() {
        return { outcome: 'empty' as const }
      },
    }
    const coord = new AutoReadyCoordinator({
      getController: () => controller as never,
      hasWorkspaceIndex: () => true,
    })

    coord.onHostReadyChanged(true)
    expect(news).toEqual([])
    coord.onVisibilityChanged(true)
    await vi.waitFor(() => expect(news).toEqual(['new']))

    coord.onVisibilityChanged(false)
    expect(coord.visibilityEpoch).toBe(1)
    expect(coord.readyAppliedForVisibilityEpoch).toBe(false)
  })

  it('hide→show during applyInFlight re-applies for the new visibility epoch', async () => {
    let releaseRestore!: () => void
    const restoreHeld = new Promise<void>((resolve) => {
      releaseRestore = resolve
    })
    const restoreCalls: number[] = []
    const news: string[] = []
    const controller = {
      registry: {
        list: () => [] as { tabId: string; sessionId: string; unread: boolean }[],
        getActive: () => undefined,
        setUnread() {},
      },
      messages: { hasContent: () => false },
      newConversationOrReuseEmpty() {
        news.push('new')
        return { tabId: 't1', sessionId: 's1' }
      },
      async restoreOpenTabSet() {
        restoreCalls.push(1)
        await restoreHeld
        return { outcome: 'empty' as const }
      },
    }
    const coord = new AutoReadyCoordinator({
      getController: () => controller as never,
      hasWorkspaceIndex: () => true,
    })

    coord.onHostReadyChanged(true)
    // First apply starts via visibility and blocks inside restoreOpenTabSet.
    coord.onVisibilityChanged(true)
    await vi.waitFor(() => expect(restoreCalls).toHaveLength(1))

    // Visibility flip while apply is in-flight: new epoch, readyApplied cleared.
    coord.onVisibilityChanged(false)
    expect(coord.visibilityEpoch).toBe(1)
    expect(coord.readyAppliedForVisibilityEpoch).toBe(false)
    coord.onVisibilityChanged(true)

    releaseRestore()

    // New epoch must get its own apply (second restore → empty → New), not stall on in-flight.
    await vi.waitFor(() => expect(restoreCalls.length).toBeGreaterThanOrEqual(2))
    expect(coord.readyAppliedForVisibilityEpoch).toBe(true)
    expect(news.length).toBeGreaterThanOrEqual(2)
  })
})
