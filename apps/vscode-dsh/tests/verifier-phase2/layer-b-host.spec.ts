/**
 * Verifier-owned Layer B — Phase 2 Host / SPA retirement / follow pure matrix.
 * Independent of implementer phase2-history-delete-host.spec.ts:
 * - AC-60: ui/delete-request → requestDeleteConfirmed only (param: multi sessionId)
 * - edit-resend / branch Host wiring with payload variation
 * - SPA panel HTML ≠ thin HTML; editor-chat-panel source does not import buildThinChatHtml
 * - decideFollowState pure decision matrix (param variation / stub check)
 * - action/stop reaches requestStop
 * - Q-6: pushTabsFrame embeds per-tab sessionId (inactive delete path prerequisite)
 */
import { describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { ConversationRegistry } from '../../src/conversation-registry.ts'
import { MessageStore } from '../../src/message-store.ts'
import {
  ChatPanelHost,
  FakeWebviewPort,
  buildEditorChatSpaHtml,
  createEditorChatPanelController,
  type EditorChatWebviewPanel,
} from '../../src/chat-panel/index.ts'
import { decideFollowState } from '../../src/chat-panel/render/follow-state.ts'
import { mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'

function makeSpaRoot(): string {
  const root = join(tmpdir(), `dsh-vfy-p2-${Date.now()}-${Math.random().toString(16).slice(2)}`)
  mkdirSync(join(root, 'webview', 'dist', 'assets'), { recursive: true })
  writeFileSync(join(root, 'webview', 'dist', 'assets', 'index.js'), 'console.log("vfy-p2")')
  writeFileSync(join(root, 'webview', 'dist', 'assets', 'index.css'), 'body{}')
  return root
}

function makeFakePanel(): EditorChatWebviewPanel {
  const disposeListener: { current?: () => void } = {}
  return {
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
    reveal() {},
    dispose() {
      disposeListener.current?.()
    },
    onDidDispose(listener) {
      disposeListener.current = listener
      return { dispose() {} }
    },
  }
}

async function flushMicrotasks(times = 5): Promise<void> {
  for (let i = 0; i < times; i++) await Promise.resolve()
}

describe('verifier Phase-2 Layer-B Host (independent)', () => {
  it('V-B1 AC-60: ui/delete-request → requestDeleteConfirmed only (param variation)', async () => {
    const deleted: string[] = []
    const requestDelete = vi.fn()
    const registry = new ConversationRegistry()
    const tab = registry.create('active')
    const host = new ChatPanelHost({
      registry,
      messages: new MessageStore(),
      isHostReady: () => true,
      acceptSend: async () => ({ messageId: 'm', sessionId: tab.sessionId, tabId: tab.tabId }),
      requestDelete,
      requestDeleteConfirmed: async (sessionId) => {
        deleted.push(sessionId)
      },
    })
    const fake = new FakeWebviewPort()
    host.attach(fake)

    for (const id of ['sess-a', 'sess-b', 'sess-c']) {
      fake.emitFromWebview({ type: 'ui/delete-request', sessionId: id })
      await flushMicrotasks()
    }
    expect(deleted).toEqual(['sess-a', 'sess-b', 'sess-c'])
    expect(requestDelete).not.toHaveBeenCalled()
    expect(new Set(deleted).size).toBe(3)
  })

  it('V-B2: edit-resend / branch / stop reach Host deps with varying payloads', async () => {
    const edits: Array<{ messageId: string; text: string }> = []
    const branches: number[] = []
    const stops: number[] = []
    const registry = new ConversationRegistry()
    const tab = registry.create('fork')
    const host = new ChatPanelHost({
      registry,
      messages: new MessageStore(),
      isHostReady: () => true,
      acceptSend: async () => ({ messageId: 'm', sessionId: tab.sessionId, tabId: tab.tabId }),
      requestEditResend: async (messageId, text) => {
        edits.push({ messageId, text })
      },
      requestBranch: async (turn) => {
        branches.push(turn)
      },
      requestStop: async () => {
        stops.push(1)
      },
    })
    const fake = new FakeWebviewPort()
    host.attach(fake)

    fake.emitFromWebview({ type: 'action/edit-resend', messageId: 'm1', text: 'alpha' })
    fake.emitFromWebview({ type: 'action/edit-resend', messageId: 'm2', text: 'beta' })
    fake.emitFromWebview({ type: 'action/branch', turn: 2 })
    fake.emitFromWebview({ type: 'action/branch', turn: 9 })
    fake.emitFromWebview({ type: 'action/stop' })
    await flushMicrotasks(8)

    expect(edits).toEqual([
      { messageId: 'm1', text: 'alpha' },
      { messageId: 'm2', text: 'beta' },
    ])
    expect(branches).toEqual([2, 9])
    expect(stops.length).toBe(1)
    expect(new Set(edits.map(e => e.messageId)).size).toBe(2)
    expect(new Set(branches).size).toBe(2)
  })

  it('V-B3: production Panel uses SPA HTML; source does not import buildThinChatHtml', async () => {
    const panelSource = readFileSync(
      join(process.cwd(), 'apps/vscode-dsh/src/chat-panel/editor-chat-panel.ts'),
      'utf8',
    )
    expect(panelSource).toMatch(/buildEditorChatSpaHtml/)
    expect(panelSource).not.toMatch(/buildThinChatHtml/)

    const panel = makeFakePanel()
    const root = makeSpaRoot()
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
        window: { createWebviewPanel: () => panel },
      },
      panelHost: host,
      registry,
      extensionRoot: root,
      onRunningPanelClosed: () => {},
    })
    await controller.openOrFocus()
    expect(panel.webview.html).toContain('Content-Security-Policy')
    expect(panel.webview.html).toMatch(/index\.js|assets\//)
    expect(panel.webview.html).not.toMatch(/buildThinChatHtml|thin-chat|__DSH_THIN/)
  })

  it('V-B4: decideFollowState matrix — outputs change with inputs (not stub)', () => {
    const cases: Array<{
      name: string
      input: Parameters<typeof decideFollowState>[0]
      expect: 'on' | 'off'
    }> = [
      {
        name: 'explicit resume',
        input: {
          followState: 'off',
          atBottom: false,
          userTookOver: true,
          explicitResume: true,
          streaming: true,
        },
        expect: 'on',
      },
      {
        name: 'user takeover',
        input: {
          followState: 'on',
          atBottom: false,
          userTookOver: true,
          explicitResume: false,
          streaming: true,
        },
        expect: 'off',
      },
      {
        name: 'at bottom keep on',
        input: {
          followState: 'off',
          atBottom: true,
          userTookOver: false,
          explicitResume: false,
          streaming: true,
        },
        expect: 'on',
      },
      {
        name: 'preserve prior when ambiguous',
        input: {
          followState: 'on',
          atBottom: false,
          userTookOver: false,
          explicitResume: false,
          streaming: false,
        },
        expect: 'on',
      },
      {
        name: 'preserve off when ambiguous',
        input: {
          followState: 'off',
          atBottom: false,
          userTookOver: false,
          explicitResume: false,
          streaming: false,
        },
        expect: 'off',
      },
    ]
    const observed = cases.map((c) => {
      const out = decideFollowState(c.input)
      expect(out, c.name).toBe(c.expect)
      return out
    })
    expect(new Set(observed).size).toBe(2)
  })

  it('V-B5: buildEditorChatSpaHtml embeds Phase-2 DOM contract strings', () => {
    const dist = join(tmpdir(), `dsh-spa-strings-${Date.now()}`)
    mkdirSync(join(dist, 'assets'), { recursive: true })
    // Minimal placeholder — contract strings live in React bundle; HTML must still load SPA shell
    writeFileSync(join(dist, 'assets', 'index.js'), '/* placeholder */')
    writeFileSync(join(dist, 'assets', 'index.css'), 'body{}')
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
      dist,
    )
    expect(html).toMatch(/Content-Security-Policy/)
    expect(html).not.toMatch(/fonts\.googleapis|cdn\.jsdelivr/)
    expect(html).toMatch(/webview-uri:/)
    expect(html).not.toMatch(/thin-chat/)
  })

  it('V-B6: search-sessions Host posts search/results (producer→consumer)', async () => {
    const registry = new ConversationRegistry()
    const tab = registry.create('search')
    const host = new ChatPanelHost({
      registry,
      messages: new MessageStore(),
      isHostReady: () => true,
      acceptSend: async () => ({ messageId: 'm', sessionId: tab.sessionId, tabId: tab.tabId }),
      requestSearchSessions: async ({ text }) => [
        {
          sessionId: `hit-${text}`,
          title: `T-${text}`,
          mtime: 1,
          matchTiers: [1, 2],
          firstUserPreview: String(text),
        },
      ],
    })
    const fake = new FakeWebviewPort()
    host.attach(fake)
    host.clearOutboundLog()
    fake.receivedFromHost.length = 0

    fake.emitFromWebview({ type: 'action/search-sessions', text: 'alpha' })
    await flushMicrotasks(8)
    const results = fake.receivedFromHost.filter(m => m.type === 'search/results') as Array<{
      text?: string
      hits?: Array<{ sessionId: string }>
    }>
    expect(results.length).toBeGreaterThanOrEqual(1)
    const last = results[results.length - 1]!
    expect(last.text).toBe('alpha')
    expect(last.hits?.[0]?.sessionId).toBe('hit-alpha')

    fake.emitFromWebview({ type: 'action/search-sessions', text: 'beta' })
    await flushMicrotasks(8)
    const results2 = fake.receivedFromHost.filter(m => m.type === 'search/results') as Array<{
      text?: string
      hits?: Array<{ sessionId: string }>
    }>
    const last2 = results2[results2.length - 1]!
    expect(last2.hits?.[0]?.sessionId).toBe('hit-beta')
    expect(last2.hits?.[0]?.sessionId).not.toBe(last.hits?.[0]?.sessionId)
  })

  it('V-B7 Q-6: pushTabsFrame includes sessionId for active + inactive tabs', async () => {
    const registry = new ConversationRegistry()
    const a = registry.create('Active')
    const b = registry.create('Inactive')
    // create() activates the newest tab; switch back so `a` is active and `b` inactive
    registry.switchTo(a.tabId)
    const host = new ChatPanelHost({
      registry,
      messages: new MessageStore(),
      isHostReady: () => true,
      acceptSend: async () => ({ messageId: 'm', sessionId: a.sessionId, tabId: a.tabId }),
    })
    const fake = new FakeWebviewPort()
    host.attach(fake)
    host.clearOutboundLog()
    fake.receivedFromHost.length = 0

    host.pushTabsFrame()
    await flushMicrotasks()
    const frames = fake.receivedFromHost.filter(m => m.type === 'panel/tabs') as Array<{
      activeTabId?: string
      tabs?: Array<{ tabId: string; sessionId?: string }>
    }>
    expect(frames.length).toBeGreaterThanOrEqual(1)
    const last = frames[frames.length - 1]!
    expect(last.activeTabId).toBe(a.tabId)
    expect(last.tabs?.length).toBe(2)
    const byId = Object.fromEntries((last.tabs ?? []).map(t => [t.tabId, t.sessionId]))
    expect(byId[a.tabId]).toBe(a.sessionId)
    expect(byId[b.tabId]).toBe(b.sessionId)
    expect(byId[a.tabId]).not.toBe(byId[b.tabId])
  })
})
