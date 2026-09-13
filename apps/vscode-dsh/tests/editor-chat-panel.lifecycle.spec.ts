/**
 * Layer B — Editor Chat Panel lifecycle (FakeWebview + controller).
 * AC-1f / Q-7: activate path must not auto-open Panel.
 * AC-1e / Q-5: dispose × running → hint, no cancel.
 * AC-1c: external open/switch must create+reveal Panel via openOrFocus({ sessionId }).
 */

import { afterEach, describe, expect, it, vi } from 'vitest'
import { ConversationRegistry } from '../src/conversation-registry.ts'
import { MessageStore } from '../src/message-store.ts'
import {
  ChatPanelHost,
  FakeWebviewPort,
  buildEditorChatSpaHtml,
  createEditorChatPanelController,
  type EditorChatWebviewPanel,
} from '../src/chat-panel/index.ts'
import { IdeSessionHost } from '../src/session-host.ts'
import {
  activate,
  deactivate,
  getConversationController,
} from '../src/extension.ts'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

function makeSpaRoot(): string {
  const root = join(tmpdir(), `dsh-webview-${Date.now()}-${Math.random().toString(16).slice(2)}`)
  mkdirSync(join(root, 'webview', 'dist', 'assets'), { recursive: true })
  writeFileSync(join(root, 'webview', 'dist', 'assets', 'index.js'), 'console.log(1)')
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

describe('layer-B editor chat panel lifecycle', () => {
  it('does not create a Panel until openOrFocus (Q-7 / AC-1f)', () => {
    const createWebviewPanel = vi.fn()
    const registry = new ConversationRegistry()
    const host = new ChatPanelHost({
      registry,
      messages: new MessageStore(),
      isHostReady: () => true,
      acceptSend: async () => ({ messageId: 'm', sessionId: 's', tabId: 't' }),
    })
    const controller = createEditorChatPanelController({
      vscode: {
        Uri: { file: (path: string) => ({ fsPath: path, toString: () => `file://${path}` }) },
        window: { createWebviewPanel },
      },
      panelHost: host,
      registry,
      extensionRoot: tmpdir(),
      onRunningPanelClosed: () => {},
    })
    expect(controller.isOpen()).toBe(false)
    expect(createWebviewPanel).not.toHaveBeenCalled()
  })

  it('dispose × running shows hint and does not call cancel (Q-5 / AC-1e)', async () => {
    const cancel = vi.fn()
    const hints: string[] = []
    const registry = new ConversationRegistry()
    const tab = registry.create('running-tab')
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
        hints.push('running-closed-hint')
      },
    })

    await controller.openOrFocus()
    expect(controller.isOpen()).toBe(true)
    expect(panel.webview.html).toContain('Content-Security-Policy')
    expect(panel.webview.html).toContain('script')

    panel.dispose()
    expect(hints).toContain('running-closed-hint')
    expect(cancel).not.toHaveBeenCalled()
    expect(controller.isOpen()).toBe(false)
  })

  it('AC-1c: openOrFocus({ sessionId }) creates Panel and switches session', async () => {
    const openedSessions: string[] = []
    const reveals: number[] = []
    const registry = new ConversationRegistry()
    const tab = registry.create('Alpha')
    const other = registry.create('Beta')
    registry.switchTo(other.tabId)

    const host = new ChatPanelHost({
      registry,
      messages: new MessageStore(),
      isHostReady: () => true,
      acceptSend: async () => ({ messageId: 'm', sessionId: tab.sessionId, tabId: tab.tabId }),
    })
    const { panel } = makeFakePanel({
      onReveal: () => {
        reveals.push(1)
      },
    })
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
        openedSessions.push(sessionId)
        const existing = registry.getBySessionId(sessionId)
        if (existing !== undefined) registry.switchTo(existing.tabId)
      },
    })

    expect(createWebviewPanel).not.toHaveBeenCalled()
    await controller.openOrFocus({ sessionId: tab.sessionId })
    expect(createWebviewPanel).toHaveBeenCalledTimes(1)
    expect(openedSessions).toEqual([tab.sessionId])
    expect(registry.getActive()?.tabId).toBe(tab.tabId)
    expect(controller.isOpen()).toBe(true)

    // Second external open should reveal existing Panel (not recreate).
    await controller.openOrFocus({ sessionId: other.sessionId })
    expect(createWebviewPanel).toHaveBeenCalledTimes(1)
    expect(reveals.length).toBeGreaterThanOrEqual(1)
    expect(openedSessions).toEqual([tab.sessionId, other.sessionId])
    expect(registry.getActive()?.tabId).toBe(other.tabId)
  })

  it('pushFullState emits panel/tabs and FakeWebview receives them', () => {
    const registry = new ConversationRegistry()
    const tab = registry.create('Alpha')
    const host = new ChatPanelHost({
      registry,
      messages: new MessageStore(),
      isHostReady: () => true,
      acceptSend: async () => ({ messageId: 'm', sessionId: tab.sessionId, tabId: tab.tabId }),
      listHistoryRows: () => [{
        sessionId: 'hist-1',
        title: 'Past',
        updatedAt: '2026-09-01T00:00:00.000Z',
        previewOrPath: 'preview',
      }],
    })
    const fake = new FakeWebviewPort()
    host.attach(fake)
    expect(fake.receivedFromHost.some(m => m.type === 'panel/tabs')).toBe(true)
    fake.emitFromWebview({ type: 'ui/history-open' })
    expect(fake.receivedFromHost.some(m => m.type === 'panel/history' && m.open === true)).toBe(true)
  })

  it('buildEditorChatSpaHtml uses asWebviewUri for local assets (CSP smoke)', () => {
    const root = join(tmpdir(), `dsh-spa-${Date.now()}`)
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
    expect(html).not.toContain('http://fonts')
    expect(html).not.toContain('cdn.')
  })
})

describe('layer-B AC-1c extension commands focus Editor Panel', () => {
  const commands = new Map<string, (...args: unknown[]) => unknown>()

  afterEach(async () => {
    await deactivate()
    commands.clear()
    vi.restoreAllMocks()
  })

  function activateWithPanel(opts?: {
    showQuickPick?: (items: Array<{ tabId: string }>) => Promise<{ tabId: string } | undefined>
  }): {
    createWebviewPanel: ReturnType<typeof vi.fn>
    revealCount: { n: number }
    extensionRoot: string
  } {
    const revealCount = { n: 0 }
    const { panel } = makeFakePanel({
      onReveal: () => {
        revealCount.n += 1
      },
    })
    const createWebviewPanel = vi.fn(() => panel)
    const extensionRoot = makeSpaRoot()

    activate({
      subscriptions: [],
      extensionPath: extensionRoot,
      workspaceState: {
        get() { return undefined },
        update() {},
      },
    }, {
      Uri: {
        file: (path: string) => ({ fsPath: path, toString: () => `file://${path}` }),
      },
      ViewColumn: { Active: 1, One: 1 },
      window: {
        async showErrorMessage() {},
        async showInformationMessage() {},
        createWebviewPanel,
        showQuickPick: opts?.showQuickPick,
        createStatusBarItem() {
          return { text: '', show: vi.fn(), hide: vi.fn(), dispose: vi.fn() }
        },
        registerWebviewViewProvider() {
          return { dispose() {} }
        },
      },
      workspace: {
        workspaceFolders: [{ uri: { fsPath: '/tmp/dsh-ac1c' } }],
      },
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

    return { createWebviewPanel, revealCount, extensionRoot }
  }

  async function startHostConnected(): Promise<void> {
    vi.spyOn(IdeSessionHost.prototype, 'start').mockImplementation(async function (
      this: IdeSessionHost,
    ) {
      this.status = 'connected'
    })
    vi.spyOn(IdeSessionHost.prototype, 'readSessionLog').mockResolvedValue([
      { type: 'turn/start', seq: 0, data: { turn: 0 } },
      {
        type: 'user/message',
        seq: 1,
        data: { content: [{ type: 'text', text: 'hello history' }] },
      },
      {
        type: 'assistant/message',
        seq: 2,
        data: { message: { content: [{ type: 'text', text: 'ok' }] } },
      },
      { type: 'turn/end', seq: 3, data: { turn: 0, reason: { kind: 'completed' } } },
    ] as never)
    await commands.get('dsh.test.setCredentialPresence')!(true)
    await commands.get('dsh.test.requestStart')!('command-start')
  }

  it('dsh.switchConversation creates/reveals Editor Panel (AC-1c)', async () => {
    const { createWebviewPanel, revealCount } = activateWithPanel()
    await startHostConnected()
    const controller = getConversationController()
    expect(controller).toBeDefined()
    const a = controller!.newConversationOrReuseEmpty('A')
    const b = controller!.newConversationOrReuseEmpty('B')
    expect(createWebviewPanel).not.toHaveBeenCalled()

    await commands.get('dsh.switchConversation')!(a.tabId)
    expect(createWebviewPanel).toHaveBeenCalledTimes(1)
    expect(controller!.registry.getActive()?.tabId).toBe(a.tabId)

    await commands.get('dsh.switchConversation')!(b.tabId)
    expect(createWebviewPanel).toHaveBeenCalledTimes(1)
    expect(revealCount.n).toBeGreaterThanOrEqual(1)
    expect(controller!.registry.getActive()?.tabId).toBe(b.tabId)
  })

  it('dsh.openHistory success creates/reveals Editor Panel (AC-1c)', async () => {
    const { createWebviewPanel } = activateWithPanel()
    await startHostConnected()
    const controller = getConversationController()
    expect(controller).toBeDefined()
    const sessionId = 'hist-ac1c-1'
    controller!.index.upsertSession({
      sessionId,
      title: 'History AC-1c',
      mtime: Date.now(),
      firstUserPreview: 'hello history',
    })
    expect(createWebviewPanel).not.toHaveBeenCalled()

    const result = await commands.get('dsh.openHistory')!(sessionId) as { outcome: string }
    expect(result.outcome === 'opened' || result.outcome === 'activated').toBe(true)
    expect(createWebviewPanel).toHaveBeenCalledTimes(1)
    expect(controller!.registry.getBySessionId(sessionId)).toBeDefined()
  })

  it('dsh.searchSessions selected hit creates/reveals Editor Panel (AC-1c)', async () => {
    const sessionId = 'search-ac1c-1'
    const { createWebviewPanel } = activateWithPanel({
      showQuickPick: async items => items.find(i => i.tabId === sessionId) ?? items[0],
    })
    await startHostConnected()
    const controller = getConversationController()
    expect(controller).toBeDefined()
    controller!.index.upsertSession({
      sessionId,
      title: 'Searchable session',
      mtime: Date.now(),
      firstUserPreview: 'find me please',
    })
    expect(createWebviewPanel).not.toHaveBeenCalled()

    const result = await commands.get('dsh.searchSessions')!({ text: 'Searchable' }) as {
      outcome: string
    }
    expect(result.outcome).toBe('opened')
    expect(createWebviewPanel).toHaveBeenCalledTimes(1)
    expect(controller!.registry.getBySessionId(sessionId)).toBeDefined()
  })
})
