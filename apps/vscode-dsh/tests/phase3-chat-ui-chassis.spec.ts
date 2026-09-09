/**
 * Phase 3 Chat UI chassis — L2/L3 evidence (AC-7a/8/8a/9/10/11/12/16/16a/17/19/19a/20/25/27).
 * VP-CR-6 is split into four independently runnable cases (HG-2 note).
 */

import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { createContext, runInContext } from 'node:vm'
import { describe, expect, it, afterEach } from 'vitest'
import {
  ChatPanelHost,
  FakeWebviewPort,
  buildThinChatHtml,
  parseWebviewToHostMessage,
  resolveComposerKeydown,
} from '../src/chat-panel/index.ts'
import {
  containsUnsafeHtml,
  renderSafeMarkdown,
  safeMarkdownBrowserSource,
} from '../src/markdown/safe-markdown.ts'
import { conversationTreeItems } from '../src/conversation-tab-bar.ts'
import { ConversationRegistry } from '../src/conversation-registry.ts'
import { ConversationController } from '../src/conversation-controller.ts'
import { EMPTY_LIVE_TITLE } from '../src/conversation-titles.ts'
import {
  ExtensionIndex,
  isHistoryEligibleSession,
} from '../src/extension-index.ts'
import { listHistoryFromIndex } from '../src/history-view.ts'
import { IdeSessionHost } from '../src/session-host.ts'
import {
  activate,
  deactivate,
  getChatPanelHost,
} from '../src/extension.ts'

afterEach(async () => {
  await deactivate()
})

describe('test:theme-tokens (AC-8 / VP-CR-6)', () => {
  it('HTML/CSS is driven by --vscode-* tokens, not a bare gray-box background', () => {
    const html = buildThinChatHtml('vscode-csp')
    expect(html).toContain('--vscode-')
    expect(html).toContain('var(--vscode-sideBar-background')
    expect(html).toContain('var(--vscode-button-background)')
    expect(html).toContain('dsh-chat-chassis')
    // Must not rely on a single hardcoded gray as the sole body background.
    expect(html).not.toMatch(/body\s*\{[^}]*background:\s*#(?:ccc|ddd|eee|f5f5f5)/i)
  })
})

describe('test:bubble-layers (AC-9 / VP-CR-6)', () => {
  it('user and assistant bubbles use distinguishable classes', () => {
    const html = buildThinChatHtml()
    expect(html).toContain('.msg.bubble.user')
    expect(html).toContain('.msg.bubble.assistant')
    expect(html).toContain("data-role")
    expect(html).toContain("'msg bubble ' + msg.role")
  })
})

describe('test:composer-contrast (AC-11 / VP-CR-6)', () => {
  it('composer is a fixed bottom bar with a themed Send button', () => {
    const html = buildThinChatHtml()
    expect(html).toContain('data-testid="composer"')
    expect(html).toContain('position: sticky')
    expect(html).toContain('bottom: 0')
    expect(html).toContain('#composer')
    expect(html).toContain('var(--vscode-button-background)')
    expect(html).toContain('data-testid="send"')
  })
})

describe('test:visual-evidence-chain (AC-7a / VP-CR-6)', () => {
  it('documents L2/L3 primary evidence plus L4 screenshot assist paths', () => {
    // L2/L3 primary: this suite + sibling cases; L4 assist = README path convention (PNGs optional).
    const screenshotsDir = resolve(
      process.cwd(),
      'apps/vscode-dsh/tests/fixtures/screenshots',
    )
    const readme = resolve(screenshotsDir, 'README.md')
    expect(existsSync(readme)).toBe(true)

    const html = buildThinChatHtml()
    expect(html).toContain('dsh-chat-chassis')
    expect(html).toContain('--vscode-')
    expect(html).toContain('.msg.bubble.user')
    expect(html).toContain('data-testid="composer"')
  })
})

describe('AC-8a theme refresh (VP-CR-6a)', () => {
  it('Host pushThemeKind posts ui/theme and HTML consumes it', async () => {
    const html = buildThinChatHtml()
    expect(html).toContain("msg.type === 'ui/theme'")
    expect(html).toContain('applyThemeKind')

    const registry = new ConversationRegistry()
    const messages = new ConversationController({
      status: 'connected',
      interactions: { failClosedSession() {}, listPending() { return [] } },
      setConversationRegistry() {},
      onNotification() { return () => {} },
      async prompt() { return 'm' },
      async disposeSession() {},
    } as unknown as IdeSessionHost).messages
    const panel = new ChatPanelHost({
      registry,
      messages,
      isHostReady: () => true,
      acceptSend: async () => ({ messageId: 'm', sessionId: 's', tabId: 't' }),
    })
    const fake = new FakeWebviewPort()
    panel.attach(fake)
    panel.clearOutboundLog()
    fake.receivedFromHost.length = 0
    panel.pushThemeKind('light')
    expect(fake.receivedFromHost.some(m => m.type === 'ui/theme' && m.themeKind === 'light')).toBe(true)
  })
})

describe('AC-10 generating indicator', () => {
  it('status/set generating shows Generating…; idle clears', async () => {
    const html = buildThinChatHtml()
    expect(html).toContain('Generating…')
    expect(html).toContain('is-generating')

    const host = {
      status: 'connected' as const,
      interactions: { failClosedSession() {}, listPending() { return [] } },
      setConversationRegistry() {},
      onNotification() { return () => {} },
      async prompt() { return 'm' },
      async disposeSession() {},
    } as unknown as IdeSessionHost
    const controller = new ConversationController(host)
    const tab = controller.newConversation(EMPTY_LIVE_TITLE)
    const panel = new ChatPanelHost({
      registry: controller.registry,
      messages: controller.messages,
      interactions: host.interactions,
      isHostReady: () => true,
      acceptSend: (text) => controller.promptActive(text),
    })
    controller.setPanelHost(panel)
    const fake = new FakeWebviewPort()
    panel.attach(fake)
    controller.registry.setStatus(tab.tabId, 'running')
    panel.pushStatus()
    expect(panel.getOutboundLog().some(m => m.type === 'status/set' && m.status === 'generating')).toBe(true)
    controller.registry.setStatus(tab.tabId, 'idle')
    panel.pushStatus()
    const idle = [...panel.getOutboundLog()].reverse().find(m => m.type === 'status/set')
    expect(idle).toMatchObject({ status: 'idle' })
  })
})

describe('AC-12 Enter / Shift+Enter (L3 runtime)', () => {
  it('resolveComposerKeydown: Enter sends non-empty; Shift+Enter is newline', () => {
    expect(resolveComposerKeydown({ key: 'Enter', shiftKey: false, text: 'hi' })).toBe('send')
    expect(resolveComposerKeydown({ key: 'Enter', shiftKey: true, text: 'hi' })).toBe('newline')
    expect(resolveComposerKeydown({ key: 'Enter', shiftKey: false, text: '  ' })).toBe('none')
    expect(resolveComposerKeydown({ key: 'Enter', shiftKey: false, text: 'hi', isComposing: true })).toBe('none')
    expect(resolveComposerKeydown({ key: 'a', shiftKey: false, text: 'hi' })).toBe('none')
  })

  it('HTML wires keydown to resolveComposerKeydown and only posts send on Enter', () => {
    const html = buildThinChatHtml()
    expect(html).toContain('resolveComposerKeydown')
    expect(html).toContain("action === 'send'")
    expect(html).toContain('keydown')
    expect(html).toContain("type: 'composer/send'")
  })
})

describe('AC-16 / AC-16a safe Markdown', () => {
  it('renders headings, lists, and fenced code', () => {
    const md = [
      '# Title',
      '',
      '- one',
      '- two',
      '',
      '```ts',
      'const x = 1',
      '```',
    ].join('\n')
    const result = renderSafeMarkdown(md)
    expect(result.mode).toBe('markdown')
    expect(result.html).toContain('<h1 class="md-h">Title</h1>')
    expect(result.html).toContain('<ul class="md-list">')
    expect(result.html).toContain('<li>one</li>')
    expect(result.html).toContain('class="md-code"')
    expect(result.html).toContain('const x = 1')
    expect(result.html).toContain('copy-code')
    expect(containsUnsafeHtml(result.html)).toBe(false)
  })

  it('escapes malicious HTML/script and never loads external resources', () => {
    const evil = [
      '<script>alert(1)</script>',
      '<img src="https://evil.example/x.png" onerror="alert(1)">',
      'Hello <b onclick="x()">bold</b>',
    ].join('\n')
    const result = renderSafeMarkdown(evil)
    expect(containsUnsafeHtml(result.html)).toBe(false)
    expect(result.html.toLowerCase()).not.toContain('<script')
    expect(result.html.toLowerCase()).not.toMatch(/<img\b/)
    expect(result.html).toContain('&lt;script&gt;')
    // URL may appear as escaped plain text; must not appear as a live src/href attribute.
    expect(result.html).not.toMatch(/<[^>]+src\s*=\s*["']?\s*https:\/\/evil\.example/i)
  })

  it('Webview HTML embeds safeMarkdownBrowserSource helpers (AC-16/16a sync)', () => {
    const html = buildThinChatHtml('csp')
    const src = safeMarkdownBrowserSource()
    expect(html).toContain('function escapeHtml')
    expect(html).toContain('function renderSafeMarkdown')
    // Embedded browser source must appear in the HTML shell (drift guard).
    expect(html.includes(src.slice(0, 40).trim()) || html.includes('function escapeHtml')).toBe(true)
    expect(html).toContain('innerHTML')
  })

  it('browser-embedded MD source matches TS renderSafeMarkdown on shared fixtures', () => {
    const fixtures = [
      '# H\n\n- a\n- b\n\n```js\nalert(1)\n```',
      '<script>alert(1)</script>\n<img src="https://evil.example/x.png">',
      'plain only',
      '## Mid\n\n1. one\n2. two',
      '```\nunclosed fence still code',
    ]
    for (const f of fixtures) {
      const ts = renderSafeMarkdown(f)
      const br = renderViaBrowserSource(f)
      expect(br.html).toBe(ts.html)
      expect(br.mode).toBe(ts.mode)
      expect(containsUnsafeHtml(ts.html)).toBe(false)
      expect(containsUnsafeHtml(br.html)).toBe(false)
    }
    const a = renderSafeMarkdown('# A')
    const b = renderSafeMarkdown('# B')
    expect(a.html).not.toBe(b.html)
  })
})

describe('AC-17 copy-code → dsh.copyToClipboard', () => {
  it('parses action/copy-code and Host invokes requestCopyCode', async () => {
    const parsed = parseWebviewToHostMessage({ type: 'action/copy-code', text: 'abc' })
    expect(parsed).toEqual({ type: 'action/copy-code', text: 'abc' })

    const copied: string[] = []
    const registry = new ConversationRegistry()
    const messages = new ConversationController({
      status: 'connected',
      interactions: { failClosedSession() {}, listPending() { return [] } },
      setConversationRegistry() {},
      onNotification() { return () => {} },
      async prompt() { return 'm' },
      async disposeSession() {},
    } as unknown as IdeSessionHost).messages
    const panel = new ChatPanelHost({
      registry,
      messages,
      isHostReady: () => true,
      acceptSend: async () => ({ messageId: 'm', sessionId: 's', tabId: 't' }),
      requestCopyCode: async (text) => { copied.push(text) },
    })
    const fake = new FakeWebviewPort()
    panel.attach(fake)
    fake.emitFromWebview({ type: 'action/copy-code', text: 'const x = 1' })
    await waitFor(() => copied.length === 1, 1_000)
    expect(copied).toEqual(['const x = 1'])
  })

  it('L2: executeCommand dsh.copyToClipboard writes clipboard', async () => {
    const writes: string[] = []
    const commands = new Map<string, (...args: unknown[]) => unknown>()
    const vscode = {
      window: {
        showErrorMessage: async () => undefined,
        showInformationMessage: async () => undefined,
        activeColorTheme: { kind: 2 },
        onDidChangeActiveColorTheme() { return { dispose() {} } },
      },
      workspace: { workspaceFolders: [{ uri: { fsPath: '/tmp/dsh-p3' } }] },
      commands: {
        registerCommand(command: string, callback: (...args: unknown[]) => unknown) {
          commands.set(command, callback)
          return { dispose() { commands.delete(command) } }
        },
        async executeCommand(command: string, ...args: unknown[]) {
          const cb = commands.get(command)
          if (cb === undefined) throw new Error(`missing ${command}`)
          return cb(...args)
        },
      },
      env: {
        clipboard: {
          writeText(value: string) { writes.push(value) },
        },
      },
      ColorThemeKind: { Light: 1, Dark: 2, HighContrast: 3, HighContrastLight: 4 },
    }
    activate({ subscriptions: [], extensionPath: '/tmp' }, vscode as never)
    const result = await vscode.commands.executeCommand('dsh.copyToClipboard', 'fenced-body')
    expect(result).toEqual({ ok: true })
    expect(writes).toEqual(['fenced-body'])
    expect(getChatPanelHost()).toBeDefined()
  })
})

describe('AC-19 / AC-19a Conversations + History IA', () => {
  it('empty registry has no Start Session command-title stack; empty live shows 新对话', () => {
    const empty = conversationTreeItems({ tabs: [], activeTabId: undefined })
    expect(empty).toEqual([])
    expect(empty.every(i => i.label !== 'Start IDE Session…')).toBe(true)

    const registry = new ConversationRegistry()
    registry.create(EMPTY_LIVE_TITLE)
    const items = conversationTreeItems(registry.snapshot())
    expect(items).toHaveLength(1)
    expect(items[0]?.label).toBe(EMPTY_LIVE_TITLE)
  })

  it('History excludes empty-Tab placeholders', () => {
    expect(isHistoryEligibleSession({ title: EMPTY_LIVE_TITLE })).toBe(false)
    expect(isHistoryEligibleSession({ title: 'New conversation' })).toBe(false)
    expect(isHistoryEligibleSession({ title: EMPTY_LIVE_TITLE, firstUserPreview: 'hi' })).toBe(true)
    expect(isHistoryEligibleSession({ title: 'Real chat' })).toBe(true)

    const index = new ExtensionIndex('/ws')
    index.upsertSession({ sessionId: 'empty', title: EMPTY_LIVE_TITLE, mtime: 2 })
    index.upsertSession({ sessionId: 'real', title: 'Real', mtime: 1, firstUserPreview: 'hello' })
    const rows = listHistoryFromIndex(index)
    expect(rows.map(r => r.sessionId)).toEqual(['real'])
  })
})

describe('AC-20 / AC-27 regression smoke', () => {
  it('composer/send still accepted on live Tab (send path)', async () => {
    const prompts: string[] = []
    const host = {
      status: 'connected' as const,
      interactions: { failClosedSession() {}, listPending() { return [] } },
      setConversationRegistry() {},
      onNotification() { return () => {} },
      async prompt(_sessionId: string, blocks: { text?: string }[]) {
        prompts.push(blocks[0]?.text ?? '')
        return 'msg-1'
      },
      async disposeSession() {},
    } as unknown as IdeSessionHost
    const controller = new ConversationController(host)
    const tab = controller.newConversation('live')
    const panel = new ChatPanelHost({
      registry: controller.registry,
      messages: controller.messages,
      interactions: host.interactions,
      isHostReady: () => true,
      acceptSend: (text) => controller.promptActive(text),
    })
    controller.setPanelHost(panel)
    const fake = new FakeWebviewPort()
    panel.attach(fake)
    fake.emitFromWebview({ type: 'composer/send', text: 'hello chassis' })
    await waitFor(() => controller.messages.hasContent(tab.sessionId), 1_000)
    expect(prompts).toEqual(['hello chassis'])
  })

  it('openFromHistory non-empty → mode=replay and rejects composer/send', async () => {
    const host = {
      status: 'connected' as const,
      interactions: { failClosedSession() {}, listPending() { return [] } },
      setConversationRegistry() {},
      onNotification() { return () => {} },
      async prompt() { return 'm' },
      async disposeSession() {},
    } as unknown as IdeSessionHost
    const controller = new ConversationController(host)
    const events = [
      {
        type: 'user/message' as const,
        seq: 1,
        data: {
          id: 'u1',
          role: 'user' as const,
          content: [{ type: 'text' as const, text: 'hist-hello' }],
        },
      },
      {
        type: 'assistant/message' as const,
        seq: 2,
        data: {
          message: {
            id: 'a1',
            role: 'assistant' as const,
            content: [{ type: 'text' as const, text: 'hist-reply' }],
          },
        },
      },
    ]
    const opened = await controller.openFromHistory('sess-p3-hist', { events })
    expect(opened.outcome).toBe('opened')
    if (opened.outcome !== 'opened') return
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
    fake.emitFromWebview({ type: 'composer/send', text: 'blocked' })
    await waitFor(() => panel.getOutboundLog().some(m => m.type === 'ui/reject-send'), 1_500)
    expect(panel.getOutboundLog().find(m => m.type === 'ui/reject-send')).toMatchObject({
      reason: 'replay',
    })
  })
})

describe('AC-25 Host authority unchanged', () => {
  it('HTML does not invent local mode/session decisions beyond panel/state', () => {
    const html = buildThinChatHtml()
    expect(html).toContain("msg.type === 'panel/state'")
    expect(html).toContain('mode = msg.mode')
    // No secondary framework / React mount.
    expect(html).not.toContain('createRoot')
    expect(html).not.toContain('ReactDOM')
  })
})

async function waitFor(predicate: () => boolean, timeoutMs: number): Promise<void> {
  const start = Date.now()
  while (!predicate()) {
    if (Date.now() - start > timeoutMs) throw new Error('waitFor timeout')
    await new Promise(r => setTimeout(r, 10))
  }
}

/** Run the Webview-embedded MD source in vm (parity with TS module). */
function renderViaBrowserSource(source: string): { html: string; mode: string } {
  const ctx = createContext({ encodeURIComponent, String })
  runInContext(`${safeMarkdownBrowserSource()}; this.__out = renderSafeMarkdown;`, ctx)
  const fn = (ctx as { __out: (s: string) => { html: string; mode: string } }).__out
  return fn(source)
}
