/**
 * Verifier-owned Layer B — FakeWebview / controller lifecycle.
 * Independent of implementer editor-chat-panel.lifecycle.spec.ts:
 * - Q-5: idle dispose must NOT hint; running dispose must NOT cancel + must hint
 * - Q-7: controller construction alone never creates panel
 * - AC-1c: missing openHistory must NOT create/reveal panel
 * - retainContextWhenHidden:true on create options
 * - FakeWebview tabs + history frame content (param variation)
 * - SPA HTML path ≠ buildThinChatHtml
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ConversationRegistry } from '../../src/conversation-registry.ts'
import { MessageStore } from '../../src/message-store.ts'
import {
  ChatPanelHost,
  FakeWebviewPort,
  buildEditorChatSpaHtml,
  createEditorChatPanelController,
  type EditorChatWebviewPanel,
} from '../../src/chat-panel/index.ts'
import { IdeSessionHost } from '../../src/session-host.ts'
import {
  activate,
  deactivate,
  getConversationController,
} from '../../src/extension.ts'
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

function makeSpaRoot(): string {
  const root = join(tmpdir(), `dsh-vfy-${Date.now()}-${Math.random().toString(16).slice(2)}`)
  mkdirSync(join(root, 'webview', 'dist', 'assets'), { recursive: true })
  writeFileSync(join(root, 'webview', 'dist', 'assets', 'index.js'), 'console.log("vfy")')
  writeFileSync(join(root, 'webview', 'dist', 'assets', 'index.css'), 'body{}')
  return root
}

function makeFakePanel(opts?: {
  onReveal?: () => void
}): { panel: EditorChatWebviewPanel; disposeListener: { current?: () => void } } {
  const disposeListener: { current?: () => void } = {}
  const panel: EditorChatWebviewPanel = {
    webview: {
      html: '',
      cspSource: 'vscode-webview:',
      postMessage() {},
      onDidReceiveMessage() {
        return { dispose() {} }
      },
      asWebviewUri(uri) {
        return { toString: () => `webview:${String((uri as { fsPath?: string }).fsPath ?? '')}` }
      },
    },
    reveal() {
      opts?.onReveal?.()
    },
    dispose() {
      disposeListener.current?.()
    },
    onDidDispose(listener) {
      disposeListener.current = listener
      return { dispose() {} }
    },
  }
  return { panel, disposeListener }
}

describe('verifier Layer-B FakeWebview (independent)', () => {
  it('V-B1 Q-7: constructing controller never auto-opens Panel', () => {
    const createWebviewPanel = vi.fn()
    const registry = new ConversationRegistry()
    const host = new ChatPanelHost({
      registry,
      messages: new MessageStore(),
      isHostReady: () => true,
      acceptSend: async () => ({ messageId: 'm', sessionId: 's', tabId: 't' }),
    })
    createEditorChatPanelController({
      vscode: {
        Uri: { file: (path: string) => ({ fsPath: path, toString: () => `file://${path}` }) },
        window: { createWebviewPanel },
      },
      panelHost: host,
      registry,
      extensionRoot: tmpdir(),
      onRunningPanelClosed: () => {},
    })
    expect(createWebviewPanel).not.toHaveBeenCalled()
  })

  it('V-B2 Q-5: dispose×running hints and never cancels; dispose×idle does not hint', async () => {
    const cancel = vi.fn()
    const hints: string[] = []
    const registry = new ConversationRegistry()
    const tab = registry.create('run')
    registry.setStatus(tab.tabId, 'running')

    const host = new ChatPanelHost({
      registry,
      messages: new MessageStore(),
      isHostReady: () => true,
      acceptSend: async () => ({ messageId: 'm', sessionId: tab.sessionId, tabId: tab.tabId }),
      requestStop: async () => {
        cancel()
      },
    })
    const { panel } = makeFakePanel()
    const root = makeSpaRoot()
    const controller = createEditorChatPanelController({
      vscode: {
        Uri: { file: (path: string) => ({ fsPath: path, toString: () => `file://${path}` }) },
        window: {
          createWebviewPanel: () => panel,
          showInformationMessage: (msg: string) => {
            hints.push(msg)
            return Promise.resolve(undefined)
          },
        },
      },
      panelHost: host,
      registry,
      extensionRoot: root,
      onRunningPanelClosed: () => {
        hints.push('HINT_RUNNING_CLOSED')
      },
    })

    await controller.openOrFocus()
    panel.dispose()
    expect(hints).toContain('HINT_RUNNING_CLOSED')
    expect(cancel).not.toHaveBeenCalled()

    // Idle path: recreate, no running tab → no hint
    hints.length = 0
    cancel.mockClear()
    registry.setStatus(tab.tabId, 'idle')
    const { panel: panel2 } = makeFakePanel()
    const controller2 = createEditorChatPanelController({
      vscode: {
        Uri: { file: (path: string) => ({ fsPath: path, toString: () => `file://${path}` }) },
        window: { createWebviewPanel: () => panel2 },
      },
      panelHost: host,
      registry,
      extensionRoot: root,
      onRunningPanelClosed: () => {
        hints.push('HINT_SHOULD_NOT')
      },
    })
    await controller2.openOrFocus()
    panel2.dispose()
    expect(hints).not.toContain('HINT_SHOULD_NOT')
    expect(cancel).not.toHaveBeenCalled()
  })

  it('V-B3: createWebviewPanel receives retainContextWhenHidden:true + SPA html (not thin)', async () => {
    const registry = new ConversationRegistry()
    const host = new ChatPanelHost({
      registry,
      messages: new MessageStore(),
      isHostReady: () => true,
      acceptSend: async () => ({ messageId: 'm', sessionId: 's', tabId: 't' }),
    })
    const { panel } = makeFakePanel()
    let capturedOpts: Record<string, unknown> | undefined
    const createWebviewPanel = vi.fn((_id, _title, _col, opts) => {
      capturedOpts = opts as Record<string, unknown>
      return panel
    })
    const root = makeSpaRoot()
    const controller = createEditorChatPanelController({
      vscode: {
        Uri: { file: (path: string) => ({ fsPath: path, toString: () => `file://${path}` }) },
        window: { createWebviewPanel },
        ViewColumn: { Active: 1, One: 1 },
      },
      panelHost: host,
      registry,
      extensionRoot: root,
      onRunningPanelClosed: () => {},
    })
    await controller.openOrFocus()
    expect(capturedOpts?.retainContextWhenHidden).toBe(true)
    expect(capturedOpts?.enableScripts).toBe(true)
    expect(panel.webview.html).toContain('Content-Security-Policy')
    expect(panel.webview.html).toContain('script')
    expect(panel.webview.html).toMatch(/webview:/)
    expect(panel.webview.html).not.toMatch(/buildThinChatHtml|thin-chat/)
  })

  it('V-B4: FakeWebview receives panel/tabs + panel/history with row content (param variation)', () => {
    const registry = new ConversationRegistry()
    const t1 = registry.create('Alpha')
    registry.create('Beta')
    const host = new ChatPanelHost({
      registry,
      messages: new MessageStore(),
      isHostReady: () => true,
      acceptSend: async () => ({ messageId: 'm', sessionId: t1.sessionId, tabId: t1.tabId }),
      listHistoryRows: () => [
        {
          sessionId: 'h1',
          title: 'One',
          updatedAt: '2026-09-01T00:00:00.000Z',
          previewOrPath: 'p1',
        },
        {
          sessionId: 'h2',
          title: 'Two',
          updatedAt: '2026-09-02T00:00:00.000Z',
          previewOrPath: 'p2',
        },
      ],
    })
    const fake = new FakeWebviewPort()
    host.attach(fake)
    const tabs = fake.receivedFromHost.find(m => m.type === 'panel/tabs') as {
      type: string
      tabs?: Array<{ title: string }>
      activeTabId?: string
    }
    expect(tabs).toBeTruthy()
    expect(tabs.tabs?.length).toBeGreaterThanOrEqual(2)
    expect(new Set(tabs.tabs!.map(t => t.title)).size).toBe(2)

    fake.emitFromWebview({ type: 'ui/history-open' })
    const histFrames = fake.receivedFromHost.filter(m => m.type === 'panel/history' && m.open === true) as Array<{
      rows?: Array<{ sessionId: string; title: string }>
      loading?: boolean
    }>
    expect(histFrames.length).toBeGreaterThanOrEqual(2)
    expect(histFrames.some(h => h.loading === true)).toBe(true)
    const hist = [...histFrames].reverse().find(h => h.loading === false)
    expect(hist).toBeTruthy()
    expect(hist!.rows?.map(r => r.sessionId)).toEqual(['h1', 'h2'])
    expect(hist!.rows?.map(r => r.title)).toEqual(['One', 'Two'])
  })

  it('V-B5: buildEditorChatSpaHtml CSP smoke + no external fonts', () => {
    const root = join(tmpdir(), `dsh-spa-vfy-${Date.now()}`)
    mkdirSync(join(root, 'assets'), { recursive: true })
    writeFileSync(join(root, 'assets', 'index.js'), 'export {}')
    writeFileSync(join(root, 'assets', 'index.css'), 'body{}')
    const html = buildEditorChatSpaHtml(
      {
        html: '',
        cspSource: 'https://csp.example',
        postMessage() {},
        onDidReceiveMessage() {
          return { dispose() {} }
        },
        asWebviewUri(uri) {
          return { toString: () => `webview-uri:${(uri as { fsPath?: string }).fsPath}` }
        },
      },
      {
        Uri: { file: (path: string) => ({ fsPath: path, toString: () => `file://${path}` }) },
        window: {},
      },
      root,
    )
    expect(html).toContain("default-src 'none'")
    expect(html).toContain('webview-uri:')
    expect(html).not.toContain('fonts.googleapis')
    expect(html).not.toContain('cdn.')
  })

  it('V-B6 AC-1c: openOrFocus({sessionId}) focuses; missing openHistory does not create Panel', async () => {
    const opened: string[] = []
    const registry = new ConversationRegistry()
    const tab = registry.create('FocusMe')
    const host = new ChatPanelHost({
      registry,
      messages: new MessageStore(),
      isHostReady: () => true,
      acceptSend: async () => ({ messageId: 'm', sessionId: tab.sessionId, tabId: tab.tabId }),
    })
    const reveals: number[] = []
    const { panel } = makeFakePanel({ onReveal: () => { reveals.push(1) } })
    const createWebviewPanel = vi.fn(() => panel)
    const root = makeSpaRoot()
    const controller = createEditorChatPanelController({
      vscode: {
        Uri: { file: (path: string) => ({ fsPath: path, toString: () => `file://${path}` }) },
        window: { createWebviewPanel },
        ViewColumn: { Active: 1, One: 1 },
      },
      panelHost: host,
      registry,
      extensionRoot: root,
      onRunningPanelClosed: () => {},
      onOpenSession: (sessionId) => {
        opened.push(sessionId)
        const existing = registry.getBySessionId(sessionId)
        if (existing) registry.switchTo(existing.tabId)
      },
    })
    await controller.openOrFocus({ sessionId: tab.sessionId })
    expect(createWebviewPanel).toHaveBeenCalledTimes(1)
    expect(opened).toEqual([tab.sessionId])
    await controller.openOrFocus({ sessionId: tab.sessionId })
    expect(createWebviewPanel).toHaveBeenCalledTimes(1)
    expect(reveals.length).toBeGreaterThanOrEqual(1)
  })
})

describe('verifier Layer-B AC-1c extension commands (independent)', () => {
  const commands = new Map<string, (...args: unknown[]) => unknown>()

  afterEach(async () => {
    await deactivate()
    commands.clear()
    vi.restoreAllMocks()
  })

  function activateWithPanel(): {
    createWebviewPanel: ReturnType<typeof vi.fn>
    infoMessages: string[]
  } {
    const infoMessages: string[] = []
    const { panel } = makeFakePanel()
    const createWebviewPanel = vi.fn(() => panel)
    const extensionRoot = makeSpaRoot()
    activate({
      subscriptions: [],
      extensionPath: extensionRoot,
      workspaceState: { get() { return undefined }, update() {} },
    }, {
      Uri: { file: (path: string) => ({ fsPath: path, toString: () => `file://${path}` }) },
      ViewColumn: { Active: 1, One: 1 },
      window: {
        async showErrorMessage() {},
        async showInformationMessage(msg: string) {
          infoMessages.push(msg)
        },
        createWebviewPanel,
        createStatusBarItem() {
          return { text: '', show: vi.fn(), hide: vi.fn(), dispose: vi.fn() }
        },
        registerWebviewViewProvider() {
          return { dispose() {} }
        },
      },
      workspace: { workspaceFolders: [{ uri: { fsPath: '/tmp/dsh-vfy-ac1c' } }] },
      commands: {
        registerCommand(command: string, callback: (...args: unknown[]) => unknown) {
          commands.set(command, callback)
          return { dispose() {} }
        },
        async executeCommand(command: string) {
          const cb = commands.get(command)
          if (cb !== undefined) return cb()
        },
      },
      StatusBarAlignment: { Left: 1, Right: 2 },
    } as never)
    return { createWebviewPanel, infoMessages }
  }

  async function startHostConnected(opts?: {
    readSessionLog?: (sessionId: string) => Promise<unknown>
  }): Promise<void> {
    vi.spyOn(IdeSessionHost.prototype, 'start').mockImplementation(async function (
      this: IdeSessionHost,
    ) {
      this.status = 'connected'
    })
    vi.spyOn(IdeSessionHost.prototype, 'readSessionLog').mockImplementation(async (sessionId: string) => {
      if (opts?.readSessionLog) return opts.readSessionLog(sessionId) as never
      return [
        { type: 'turn/start', seq: 0, data: { turn: 0 } },
        {
          type: 'user/message',
          seq: 1,
          data: { content: [{ type: 'text', text: 'hello' }] },
        },
        {
          type: 'assistant/message',
          seq: 2,
          data: { message: { content: [{ type: 'text', text: 'ok' }] } },
        },
        { type: 'turn/end', seq: 3, data: { turn: 0, reason: { kind: 'completed' } } },
      ] as never
    })
    await commands.get('dsh.test.setCredentialPresence')!(true)
    await commands.get('dsh.test.requestStart')!('command-start')
  }

  it('V-B7: switchConversation success creates Panel; failed openHistory does not', async () => {
    const { createWebviewPanel } = activateWithPanel()
    await startHostConnected({
      readSessionLog: async (sessionId) => {
        if (sessionId === 'no-such-session-vfy') {
          throw new Error('session not found')
        }
        return [
          { type: 'turn/start', seq: 0, data: { turn: 0 } },
          {
            type: 'user/message',
            seq: 1,
            data: { content: [{ type: 'text', text: 'hello' }] },
          },
          {
            type: 'assistant/message',
            seq: 2,
            data: { message: { content: [{ type: 'text', text: 'ok' }] } },
          },
          { type: 'turn/end', seq: 3, data: { turn: 0, reason: { kind: 'completed' } } },
        ]
      },
    })
    const controller = getConversationController()
    expect(controller).toBeDefined()
    const a = controller!.newConversationOrReuseEmpty('A')
    expect(createWebviewPanel).not.toHaveBeenCalled()

    await commands.get('dsh.switchConversation')!(a.tabId)
    expect(createWebviewPanel).toHaveBeenCalledTimes(1)

    const before = createWebviewPanel.mock.calls.length
    const missing = await commands.get('dsh.openHistory')!('no-such-session-vfy') as {
      outcome?: string
    } | undefined
    // Failure path must not create/reveal a new Panel (Q-7 / AC-1c negative).
    expect(missing?.outcome).toBeTruthy()
    expect(['missing', 'error', 'host-not-ready']).toContain(missing!.outcome)
    expect(createWebviewPanel.mock.calls.length).toBe(before)
  })

  it('V-B8: onRunningPanelClosed wires real InformationMessage copy (extension path)', async () => {
    // Static contract: extension registers Chinese Q-5 copy (AD-ECP-4)
    const extPath = join(process.cwd(), 'apps/vscode-dsh/src/extension.ts')
    const src = readFileSync(extPath, 'utf8')
    expect(src).toMatch(/对话仍在后台继续生成/)
    expect(src).toMatch(/不会取消进行中的任务/)
    expect(src).toMatch(/onRunningPanelClosed/)
  })
})
