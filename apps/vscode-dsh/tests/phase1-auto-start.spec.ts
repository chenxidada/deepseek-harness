/**
 * Phase 1 L2: AC-1a reverse, offline delete (unbound + bound), AC-13 connecting,
 * credentials fail, showPanel, activity-bar reveal.
 */

import { afterEach, describe, expect, it, vi } from 'vitest'
import { IdeSessionHost } from '../src/session-host.ts'
import {
  activate,
  deactivate,
  getConversationSnapshot,
  getChatPanelHost,
  getConversationController,
} from '../src/extension.ts'

describe('phase-1 auto-start L2', () => {
  const commands = new Map<string, (...args: unknown[]) => unknown>()
  const executed: string[] = []
  let statusBar: {
    text: string
    command?: string
    show: ReturnType<typeof vi.fn>
    hide: ReturnType<typeof vi.fn>
    dispose: ReturnType<typeof vi.fn>
  } | undefined

  afterEach(async () => {
    await deactivate()
    commands.clear()
    executed.length = 0
    statusBar = undefined
    vi.restoreAllMocks()
  })

  function makeVscode(opts?: {
    workspaceFolders?: readonly { uri: { fsPath: string } }[] | undefined
    withStatusBar?: boolean
  }) {
    const folders = opts?.workspaceFolders === undefined
      ? [{ uri: { fsPath: '/tmp/dsh-phase1' } }]
      : opts.workspaceFolders
    return {
      window: {
        async showErrorMessage(message: string) {
          executed.push(`error:${message}`)
        },
        async showInformationMessage() {},
        createStatusBarItem: opts?.withStatusBar === false
          ? undefined
          : () => {
            statusBar = {
              text: '',
              show: vi.fn(),
              hide: vi.fn(),
              dispose: vi.fn(),
            }
            return statusBar
          },
        registerWebviewViewProvider(viewId: string, provider: {
          resolveWebviewView(view: unknown): void
        }) {
          expect(viewId).toBe('dsh.chat')
          // Do not resolve by default — AC-1a must not depend on visibility.
          void provider
          return { dispose() {} }
        },
      },
      workspace: {
        workspaceFolders: folders,
        getConfiguration(section: string) {
          // `dsh.nodeBin` unset: the empty value does not participate in Node resolution.
          void section
          return { get: () => undefined }
        },
      },
      commands: {
        registerCommand(command: string, callback: (...args: unknown[]) => unknown) {
          commands.set(command, callback)
          return { dispose() {} }
        },
        async executeCommand(command: string) {
          executed.push(`exec:${command}`)
        },
      },
      StatusBarAlignment: { Left: 1, Right: 2 },
    }
  }

  function activateWith(vscode: ReturnType<typeof makeVscode>): void {
    activate({
      subscriptions: [],
      extensionPath: '/tmp/dsh-phase1',
      workspaceState: {
        get() { return undefined },
        update() {},
      },
    }, vscode as never)
  }

  it('AC-1a reverse: startup-only does not call IdeSessionHost.start (HG-2 asserts)', async () => {
    const startSpy = vi.spyOn(IdeSessionHost.prototype, 'start').mockResolvedValue(undefined)
    activateWith(makeVscode())

    const sim = await commands.get('dsh.test.simulateStartupOnly')!() as {
      startState: string
      hostCreateCount: number
      tabs: number
      openTabSet: number
    }
    expect(startSpy).toHaveBeenCalledTimes(0)
    expect(sim.startState).toBe('idle')
    expect(sim.hostCreateCount).toBe(0)
    expect(sim.tabs).toBe(0)
    expect(sim.openTabSet).toBe(0)
    expect(getConversationSnapshot().tabs).toEqual([])

    const snap = await commands.get('dsh.test.getStartState')!() as { state: string }
    expect(snap.state).toBe('idle')
    expect(hostCreateFromHook()).toBe(0)
  })

  it('AC-1e: offline deleteConversation prompts「Host 连接后可删除」and does not start', async () => {
    const startSpy = vi.spyOn(IdeSessionHost.prototype, 'start').mockResolvedValue(undefined)
    const vscode = makeVscode()
    activateWith(vscode)

    await commands.get('dsh.deleteConversation')!()
    expect(executed.some(e => e.includes('Host 连接后可删除'))).toBe(true)
    expect(startSpy).toHaveBeenCalledTimes(0)
    const orch = await commands.get('dsh.test.getStartState')!() as { state: string }
    expect(orch.state).toBe('idle')
  })

  it('AC-1e: deleteHistory unbound (no controller) prompts「Host 连接后可删除」and does not start', async () => {
    const startSpy = vi.spyOn(IdeSessionHost.prototype, 'start').mockResolvedValue(undefined)
    activateWith(makeVscode())

    expect(getConversationController()).toBeUndefined()
    const result = await commands.get('dsh.deleteHistory')!('sess-offline-hist-1') as {
      outcome: string
    }
    expect(result.outcome).toBe('host-not-ready')
    expect(executed.some(e => e.includes('Host 连接后可删除'))).toBe(true)
    expect(startSpy).toHaveBeenCalledTimes(0)
    const orch = await commands.get('dsh.test.getStartState')!() as { state: string }
    expect(orch.state).toBe('idle')
    // No conversations controller → nothing was index-only deleted.
    expect(getConversationSnapshot().tabs).toEqual([])
  })

  it('AC-1e: deleteHistory bound+host-offline prompts「Host 连接后可删除」and does not start', async () => {
    let hostRef: IdeSessionHost | undefined
    let startN = 0
    const startSpy = vi.spyOn(IdeSessionHost.prototype, 'start').mockImplementation(async function (
      this: IdeSessionHost,
    ) {
      startN += 1
      hostRef = this
      if (startN === 1) {
        this.status = 'connected'
        return
      }
      // Keep disconnect-retry in-flight so Conversations stay bound to the offline Host.
      await new Promise<never>(() => {})
    })
    activateWith(makeVscode())
    await commands.get('dsh.test.setCredentialPresence')!(true)
    await commands.get('dsh.test.requestStart')!('command-start')
    expect(getConversationController()).toBeDefined()
    expect(hostRef).toBeDefined()

    hostRef!.status = 'disconnected'
    await vi.waitFor(() => {
      expect(startN).toBeGreaterThanOrEqual(2)
    })
    expect(getConversationController()).toBeDefined()

    const startsBeforeDelete = startSpy.mock.calls.length
    executed.length = 0
    const result = await commands.get('dsh.deleteHistory')!('sess-bound-offline') as {
      outcome: string
    }
    expect(result.outcome).toBe('host-not-ready')
    expect(executed.some(e => e.includes('Host 连接后可删除'))).toBe(true)
    expect(startSpy.mock.calls.length).toBe(startsBeforeDelete)
    const orch = await commands.get('dsh.test.getStartState')!() as { state: string }
    expect(['starting', 'pending-start', 'disconnected', 'failed']).toContain(orch.state)
  })

  it('AC-13: Host starting projects panel connectionPhase connecting', async () => {
    let releaseStart!: () => void
    const startGate = new Promise<void>(resolve => {
      releaseStart = resolve
    })
    vi.spyOn(IdeSessionHost.prototype, 'start').mockImplementation(async function (
      this: IdeSessionHost,
    ) {
      await startGate
      this.status = 'connected'
    })
    activateWith(makeVscode({ withStatusBar: true }))
    await commands.get('dsh.test.setCredentialPresence')!(true)

    const pending = commands.get('dsh.test.requestStart')!('command-start')
    await vi.waitFor(() => {
      expect(getChatPanelHost()?.getConnectionPhase()).toBe('connecting')
    })
    const mid = await commands.get('dsh.test.getStartState')!() as { state: string }
    expect(['starting', 'pending-start']).toContain(mid.state)

    releaseStart()
    await pending
    await vi.waitFor(() => {
      expect(getChatPanelHost()?.getConnectionPhase()).toBe('connected')
    })
    const done = await commands.get('dsh.test.getStartState')!() as { state: string }
    expect(done.state).toBe('started')
  })

  it('AC-2: missing credentials → failed + showPanel + openExtensionSettings', async () => {
    const startSpy = vi.spyOn(IdeSessionHost.prototype, 'start').mockResolvedValue(undefined)
    activateWith(makeVscode({ withStatusBar: true }))

    await commands.get('dsh.test.setCredentialPresence')!(false)
    await commands.get('dsh.test.requestStart')!('command-start')
    const snap = await commands.get('dsh.test.getStartState')!() as {
      state: string
      errorKind?: string
    }
    expect(snap.state).toBe('failed')
    expect(snap.errorKind).toBe('missing-credentials')
    expect(startSpy).toHaveBeenCalledTimes(0)

    const panel = getChatPanelHost()
    expect(panel?.getConnectionPhase()).toBe('failed')

    // Conversation not visible → status bar should show.
    expect(statusBar?.show).toHaveBeenCalled()

    const shown = await commands.get('dsh.showPanel')!() as { ok: boolean }
    expect(shown.ok).toBe(true)
    expect(executed.some(e => e.startsWith('exec:'))).toBe(true)

    await commands.get('dsh.openExtensionSettings')!()
    expect(executed).toContain('exec:workbench.action.openSettings')
  })

  it('AC-1b: activity-bar open reveals Conversation and requests start', async () => {
    let resolvedShow: ReturnType<typeof vi.fn> | undefined
    const vscode = makeVscode()
    vscode.window.registerWebviewViewProvider = (viewId: string, provider: {
      resolveWebviewView(view: {
        title?: string
        webview: {
          html: string
          options?: unknown
          postMessage(): void
          onDidReceiveMessage(): { dispose(): void }
        }
        visible?: boolean
        show: ReturnType<typeof vi.fn>
        onDidChangeVisibility?: (listener: () => void) => { dispose(): void }
      }): void
    }) => {
      expect(viewId).toBe('dsh.chat')
      resolvedShow = vi.fn()
      provider.resolveWebviewView({
        webview: {
          html: '',
          postMessage() {},
          onDidReceiveMessage() { return { dispose() {} } },
        },
        visible: false,
        show: resolvedShow,
        onDidChangeVisibility() { return { dispose() {} } },
      })
      return { dispose() {} }
    }

    const startSpy = vi.spyOn(IdeSessionHost.prototype, 'start').mockImplementation(async function (
      this: IdeSessionHost,
    ) {
      this.status = 'connected'
    })

    activateWith(vscode)
    await commands.get('dsh.test.setCredentialPresence')!(true)
    const result = await commands.get('dsh.test.openActivityBar')!() as {
      ok: boolean
      revealed: boolean
    }
    expect(result.ok).toBe(true)
    expect(resolvedShow).toHaveBeenCalled()
    expect(startSpy.mock.calls.length).toBeGreaterThanOrEqual(1)
  })

  it('AC-1c: openHistory offline does not auto-start', async () => {
    const startSpy = vi.spyOn(IdeSessionHost.prototype, 'start').mockImplementation(async function (
      this: IdeSessionHost,
    ) {
      this.status = 'connected'
    })
    activateWith(makeVscode())
    expect(startSpy).toHaveBeenCalledTimes(0)
    await commands.get('dsh.openHistory')!('sess-1')
    expect(startSpy).toHaveBeenCalledTimes(0)
    const orch = await commands.get('dsh.test.getStartState')!() as { state: string }
    expect(orch.state).toBe('idle')
  })

  it('no workspace folder still allows orchestrator Start (AD-CR-5 cwd fallback)', async () => {
    let seenCwd: string | undefined
    vi.spyOn(IdeSessionHost.prototype, 'start').mockImplementation(async function (
      this: IdeSessionHost,
      opts: { cwd: string },
    ) {
      seenCwd = opts.cwd
      this.status = 'connected'
    })
    activateWith(makeVscode({ workspaceFolders: [] }))
    await commands.get('dsh.test.setCredentialPresence')!(true)
    await commands.get('dsh.test.requestStart')!('command-start')
    const snap = await commands.get('dsh.test.getStartState')!() as { state: string }
    expect(snap.state).toBe('started')
    expect(seenCwd).toBeTruthy()
  })

  function hostCreateFromHook(): number {
    const fn = commands.get('dsh.test.hostCreateCount')
    if (fn === undefined) return -1
    return (fn() as { count: number }).count
  }
})
