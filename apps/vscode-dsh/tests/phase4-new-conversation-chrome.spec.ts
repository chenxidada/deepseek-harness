/**
 * Phase 4 L2/L3: chrome「新建会话」、未连先 Start、AC-6 复用、DEBT-003 Continue auto-start.
 */

import { afterEach, describe, expect, it, vi } from 'vitest'
import { IdeSessionHost } from '../src/session-host.ts'
import {
  activate,
  deactivate,
  getChatPanelHost,
  getConversationController,
  getConversationSnapshot,
} from '../src/extension.ts'
import {
  buildThinChatHtml,
  ChatPanelHost,
  FakeWebviewPort,
  parseWebviewToHostMessage,
} from '../src/chat-panel/index.ts'
import { ConversationController } from '../src/conversation-controller.ts'

describe('phase-4 new-conversation chrome L2/L3', () => {
  const commands = new Map<string, (...args: unknown[]) => unknown>()
  const executed: string[] = []
  let conversationShow: ReturnType<typeof vi.fn> | undefined

  afterEach(async () => {
    await deactivate()
    commands.clear()
    executed.length = 0
    conversationShow = undefined
    vi.restoreAllMocks()
  })

  function makeVscode(opts?: { resolvePanel?: boolean }) {
    const resolvePanel = opts?.resolvePanel !== false
    return {
      window: {
        async showErrorMessage(message: string) {
          executed.push(`error:${message}`)
        },
        async showInformationMessage(message: string) {
          executed.push(`info:${message}`)
        },
        createStatusBarItem() {
          return {
            text: '',
            show: vi.fn(),
            hide: vi.fn(),
            dispose: vi.fn(),
          }
        },
        registerWebviewViewProvider(viewId: string, provider: {
          resolveWebviewView(view: unknown): void
        }) {
          expect(viewId).toBe('dsh.chat')
          if (resolvePanel) {
            conversationShow = vi.fn()
            provider.resolveWebviewView({
              webview: {
                html: '',
                postMessage() {},
                onDidReceiveMessage() { return { dispose() {} } },
              },
              visible: true,
              show: conversationShow,
              onDidChangeVisibility() { return { dispose() {} } },
            })
          }
          return { dispose() {} }
        },
      },
      workspace: {
        workspaceFolders: [{ uri: { fsPath: '/tmp/dsh-phase4' } }],
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
      extensionPath: '/tmp/dsh-phase4',
      workspaceState: {
        get() { return undefined },
        update() {},
      },
    }, vscode as never)
  }

  it('AC-15/21: chrome HTML always exposes labeled 新建会话 + action/new-conversation', () => {
    const html = buildThinChatHtml()
    expect(html).toContain('id="newConversationBtn"')
    expect(html).toContain('新建会话')
    expect(html).toContain("action/new-conversation")
    expect(html).toMatch(/newConversationBtn[\s\S]*action\/new-conversation/)
    // Not icon-only as sole substitute: label text present on the primary control.
    expect(html).toMatch(/id="newConversationBtn"[^>]*>[\s]*新建会话/)
    // Narrow overflow: either wrap chrome or overflow expand with New as first item.
    expect(
      html.includes('flex-wrap') || html.includes('chromeOverflow') || html.includes('chrome-overflow'),
    ).toBe(true)
  })

  it('AC-21/AC-34: keybindings bind dsh.newConversation; protocol parses action/new-conversation; chrome button remains', async () => {
    const pkg = await import('../package.json', { with: { type: 'json' } })
    const bindings = pkg.default.contributes.keybindings
    expect(Array.isArray(bindings)).toBe(true)
    expect(bindings!.some((b: { command?: string }) => b.command === 'dsh.newConversation')).toBe(true)
    expect(parseWebviewToHostMessage({ type: 'action/new-conversation' })).toEqual({
      type: 'action/new-conversation',
    })
    const html = buildThinChatHtml()
    expect(html).toContain('id="newConversationBtn"')
    expect(html).toMatch(/id="newConversationBtn"[^>]*>[\s]*新建会话/)
  })

  it('AC-22: disconnected action/new-conversation → connecting wait (not sendable live) → live', async () => {
    let releaseStart!: () => void
    const startGate = new Promise<void>(resolve => {
      releaseStart = resolve
    })
    const startSpy = vi.spyOn(IdeSessionHost.prototype, 'start').mockImplementation(async function (
      this: IdeSessionHost,
    ) {
      await startGate
      this.status = 'connected'
    })

    activateWith(makeVscode())
    await commands.get('dsh.test.setCredentialPresence')!(true)

    const panel = getChatPanelHost()
    expect(panel).toBeDefined()
    panel!.clearOutboundLog()

    const pending = panel!.handleWebviewMessage({ type: 'action/new-conversation' })

    await vi.waitFor(() => {
      expect(panel!.getConnectionPhase()).toBe('connecting')
    })

    // During wait: must not project sendable live (AC-22 / R1).
    const midStates = panel!.getOutboundLog().filter(m => m.type === 'panel/state')
    expect(midStates.length).toBeGreaterThan(0)
    expect(midStates.every(m => m.type === 'panel/state' && m.mode !== 'live')).toBe(true)
    expect(midStates.some(m =>
      m.type === 'panel/state'
      && (m.connectionPhase === 'connecting'
        || (m.connectionMessage?.includes('Connecting') === true)
        || (m.connectionMessage?.includes('正在连接') === true)),
    )).toBe(true)
    const banners = panel!.getOutboundLog().filter(m => m.type === 'ui/banner')
    expect(banners.some(m =>
      m.type === 'ui/banner'
      && (m.text.includes('Connecting') || m.text.includes('正在连接')),
    )).toBe(true)

    // Host gate still rejects sends while disconnected.
    const rejected = await panel!.sendPrompt('premature')
    expect(rejected).toMatchObject({ ok: false, reason: 'no-host' })

    releaseStart()
    await pending

    await vi.waitFor(() => {
      expect(panel!.getConnectionPhase()).toBe('connected')
    })
    expect(startSpy.mock.calls.length).toBeGreaterThanOrEqual(1)
    expect(getConversationSnapshot().tabs.length).toBeGreaterThanOrEqual(1)
    const liveStates = panel!.getOutboundLog().filter(m =>
      m.type === 'panel/state' && m.mode === 'live' && m.connectionPhase !== 'connecting',
    )
    expect(liveStates.length).toBeGreaterThan(0)
    expect(conversationShow).toHaveBeenCalled()
  })

  it('AC-22 failure: missing credentials → AC-2 failed path (no live tab from New)', async () => {
    const startSpy = vi.spyOn(IdeSessionHost.prototype, 'start').mockResolvedValue(undefined)
    // Do not resolve panel on activate — visibility would race credential latch (same as phase-1 AC-2).
    activateWith(makeVscode({ resolvePanel: false }))
    await commands.get('dsh.test.setCredentialPresence')!(false)

    const panel = getChatPanelHost()!
    await panel.handleWebviewMessage({ type: 'action/new-conversation' })

    const snap = await commands.get('dsh.test.getStartState')!() as {
      state: string
      errorKind?: string
    }
    expect(snap.state).toBe('failed')
    expect(snap.errorKind).toBe('missing-credentials')
    expect(startSpy).toHaveBeenCalledTimes(0)
    expect(panel.getConnectionPhase()).toBe('failed')
    expect(getConversationController()).toBeUndefined()
  })

  it('AC-23/24: connected action/new-conversation → Tab+1 live (or reuse) + reveal', async () => {
    vi.spyOn(IdeSessionHost.prototype, 'start').mockImplementation(async function (
      this: IdeSessionHost,
    ) {
      this.status = 'connected'
    })
    activateWith(makeVscode())
    await commands.get('dsh.test.setCredentialPresence')!(true)
    await commands.get('dsh.test.requestStart')!('command-start')
    await commands.get('dsh.test.fireConversationVisibility')!(true)
    await commands.get('dsh.test.triggerAutoReady')!()

    const before = getConversationSnapshot().tabs.length
    expect(before).toBeGreaterThanOrEqual(1)
    const snap = getConversationSnapshot()
    const active = snap.tabs.find(t => t.tabId === snap.activeTabId) ?? snap.tabs[0]!
    // Give active content so New must allocate Tab+1 (AC-24 new path).
    const controller = getConversationController()!
    controller.messages.append(active.sessionId, {
      id: 'm-content',
      sessionId: active.sessionId,
      role: 'user',
      kind: 'text',
      text: 'hello',
    })

    const panel = getChatPanelHost()!
    panel.clearOutboundLog()
    await panel.handleWebviewMessage({ type: 'action/new-conversation' })

    expect(getConversationSnapshot().tabs.length).toBe(before + 1)
    const states = panel.getOutboundLog().filter(m => m.type === 'panel/state')
    expect(states.some(m => m.type === 'panel/state' && m.mode === 'live')).toBe(true)
    expect(conversationShow).toHaveBeenCalled()
  })

  it('AC-6 via button: active empty reused; content + leftover empty → New not steal', async () => {
    vi.spyOn(IdeSessionHost.prototype, 'start').mockImplementation(async function (
      this: IdeSessionHost,
    ) {
      this.status = 'connected'
    })
    activateWith(makeVscode())
    await commands.get('dsh.test.setCredentialPresence')!(true)
    await commands.get('dsh.test.requestStart')!('command-start')
    await commands.get('dsh.test.fireConversationVisibility')!(true)
    await commands.get('dsh.test.triggerAutoReady')!()

    const panel = getChatPanelHost()!
    const controller = getConversationController()!
    expect(getConversationSnapshot().tabs).toHaveLength(1)

    // (a) active empty → reuse (Tab count stays 1)
    await panel.handleWebviewMessage({ type: 'action/new-conversation' })
    expect(getConversationSnapshot().tabs).toHaveLength(1)
    const emptyId = getConversationSnapshot().tabs[0]!.tabId

    // Create leftover empty, then switch to a content Tab.
    const leftover = controller.newConversation('leftover-empty')
    const content = controller.newConversation('with-content')
    controller.messages.append(content.sessionId, {
      id: 'm1',
      sessionId: content.sessionId,
      role: 'user',
      kind: 'text',
      text: 'hi',
    })
    controller.switchConversation(content.tabId)
    const tabsBefore = getConversationSnapshot().tabs.length

    // (b) active has content + leftover empty elsewhere → New (not steal leftover)
    await panel.handleWebviewMessage({ type: 'action/new-conversation' })
    const after = getConversationSnapshot()
    expect(after.tabs.length).toBe(tabsBefore + 1)
    expect(after.activeTabId).not.toBe(leftover.tabId)
    expect(after.activeTabId).not.toBe(emptyId)
    expect(after.activeTabId).not.toBe(content.tabId)
  })

  it('AC-22 connecting with existing live Tab: pushFullState not sendable live', () => {
    const host = new IdeSessionHost()
    host.status = 'disconnected'
    const controller = new ConversationController(host)
    const tab = controller.newConversation('existing')
    const panel = new ChatPanelHost({
      registry: controller.registry,
      messages: controller.messages,
      isHostReady: () => host.status === 'connected',
      acceptSend: async (text) => controller.promptActive(text),
    })
    panel.applyConnectionState({
      phase: 'connecting',
      message: '正在连接到 Host…',
      settingsDeepLinkAvailable: false,
      statusBarVisible: false,
    })
    const states = panel.getOutboundLog().filter(m => m.type === 'panel/state')
    expect(states.length).toBeGreaterThan(0)
    const last = states.at(-1)!
    expect(last.type).toBe('panel/state')
    if (last.type !== 'panel/state') return
    expect(last.mode).not.toBe('live')
    expect(last.connectionPhase).toBe('connecting')
    expect(last.sessionId === tab.sessionId || last.mode === 'waiting-host').toBe(true)
  })

  it('DEBT-003: Webview action/continue uses ensureHostForSend (auto-start when offline)', async () => {
    let releaseStart!: () => void
    const startGate = new Promise<void>(resolve => {
      releaseStart = resolve
    })
    const startSpy = vi.spyOn(IdeSessionHost.prototype, 'start').mockImplementation(async function (
      this: IdeSessionHost,
    ) {
      await startGate
      this.status = 'connected'
    })

    activateWith(makeVscode({ resolvePanel: false }))
    await commands.get('dsh.test.setCredentialPresence')!(true)

    const panel = getChatPanelHost()!
    const pending = panel.handleWebviewMessage({ type: 'action/continue' })

    await vi.waitFor(() => {
      expect(panel.getConnectionPhase()).toBe('connecting')
    })
    expect(startSpy.mock.calls.length).toBeGreaterThanOrEqual(1)

    releaseStart()
    await pending

    await vi.waitFor(() => {
      expect(panel.getConnectionPhase()).toBe('connected')
    })
  })
})

describe('phase-4 Host unit: requestNewConversation wiring', () => {
  it('ChatPanelHost routes action/new-conversation to deps.requestNewConversation', async () => {
    const calls: string[] = []
    const host = new IdeSessionHost()
    host.status = 'connected'
    const controller = new ConversationController(host)
    const panel = new ChatPanelHost({
      registry: controller.registry,
      messages: controller.messages,
      isHostReady: () => true,
      acceptSend: async (text) => controller.promptActive(text),
      requestNewConversation: async () => {
        calls.push('new')
        controller.newConversationOrReuseEmpty('新对话')
      },
    })
    const fake = new FakeWebviewPort()
    panel.attach(fake)
    await panel.handleWebviewMessage({ type: 'action/new-conversation' })
    expect(calls).toEqual(['new'])
    expect(controller.registry.list()).toHaveLength(1)
  })
})
