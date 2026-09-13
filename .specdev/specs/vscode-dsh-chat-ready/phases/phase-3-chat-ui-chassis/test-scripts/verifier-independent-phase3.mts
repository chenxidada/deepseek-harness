/**
 * Verifier-independent Phase 3 Chat UI chassis scenarios.
 * Do NOT trust implementer suites; design own L2/L3 / e2e paths.
 *
 * V-IND-1: Browser-embedded MD source vs TS renderSafeMarkdown parity (AC-16/16a + SF#1)
 * V-IND-2: openFromHistory → mode=replay + reject-send (AC-20; SF#2)
 * V-IND-3: L4 README existsSync (AC-7a; SF#3)
 * V-IND-4: Theme light+dark+hc parameter variation (AC-8a)
 * V-IND-5: E2E messages/replace carries MD text through Host→FakeWebview (AC-9/16 path)
 * V-IND-6: copy-code param variation → distinct clipboard writes (AC-17)
 * V-IND-7: History eligibility + Conversations「新对话」IA (AC-19/19a)
 * V-IND-8: Static chassis — tokens / CSP / sticky composer / Host authority (AC-8/11/25)
 * V-IND-9: resolveComposerKeydown param matrix + HTML wiring (AC-12)
 * V-IND-10: generating → idle status projection (AC-10)
 * V-IND-11: live send path smoke (AC-27)
 * V-IND-12: Static — agent-loop untouched; copy not menu-primary; tables not Must (AC-18/17/25)
 * V-IND-13: SF#1–3 evidence now in implementer phase3 suite (not V-IND-only)
 */
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { createContext, runInContext } from 'node:vm'
import {
  ChatPanelHost,
  FakeWebviewPort,
  buildThinChatHtml,
  parseWebviewToHostMessage,
  resolveComposerKeydown,
} from '../../../../../../apps/vscode-dsh/src/chat-panel/index.ts'
import {
  containsUnsafeHtml,
  renderSafeMarkdown,
  safeMarkdownBrowserSource,
} from '../../../../../../apps/vscode-dsh/src/markdown/safe-markdown.ts'
import { conversationTreeItems } from '../../../../../../apps/vscode-dsh/src/conversation-tab-bar.ts'
import { ConversationRegistry } from '../../../../../../apps/vscode-dsh/src/conversation-registry.ts'
import { ConversationController } from '../../../../../../apps/vscode-dsh/src/conversation-controller.ts'
import { EMPTY_LIVE_TITLE } from '../../../../../../apps/vscode-dsh/src/conversation-titles.ts'
import {
  ExtensionIndex,
  isHistoryEligibleSession,
} from '../../../../../../apps/vscode-dsh/src/extension-index.ts'
import { listHistoryFromIndex } from '../../../../../../apps/vscode-dsh/src/history-view.ts'
import { IdeSessionHost } from '../../../../../../apps/vscode-dsh/src/session-host.ts'
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

async function waitFor(pred: () => boolean, ms = 2_000): Promise<void> {
  const start = Date.now()
  while (!pred()) {
    if (Date.now() - start > ms) throw new Error(`waitFor timeout: ${pred}`)
    await new Promise(r => setTimeout(r, 5))
  }
}

function stubHost(promptImpl?: (text: string) => Promise<string>): IdeSessionHost {
  return {
    status: 'connected',
    interactions: { failClosedSession() {}, listPending() { return [] } },
    setConversationRegistry() {},
    onNotification() { return () => {} },
    async prompt(_sessionId: string, blocks: { text?: string }[]) {
      const text = blocks[0]?.text ?? ''
      if (promptImpl) return promptImpl(text)
      return 'm'
    },
    async disposeSession() {},
  } as unknown as IdeSessionHost
}

function browserRender(source: string): { html: string; mode: string } {
  const ctx = createContext({ encodeURIComponent, String })
  runInContext(`${safeMarkdownBrowserSource()}; this.__out = renderSafeMarkdown;`, ctx)
  const fn = (ctx as { __out: (s: string) => { html: string; mode: string } }).__out
  return fn(source)
}

// --- V-IND-1 -----------------------------------------------------------------
function vInd1MdParity(): void {
  console.log('\n== V-IND-1 browser MD source ↔ TS parity (AC-16/16a) ==')
  const html = buildThinChatHtml('csp')
  const src = safeMarkdownBrowserSource()
  assert(html.includes('function renderSafeMarkdown'), 'V-IND-1 HTML embeds renderSafeMarkdown')
  assert(html.includes(src.slice(0, 40).trim()) || html.includes('function escapeHtml'), 'V-IND-1 HTML embeds MD helpers')

  const fixtures = [
    '# H\n\n- a\n- b\n\n```js\nalert(1)\n```',
    '<script>alert(1)</script>\n<img src="https://evil.example/x.png">',
    'plain only',
    '## Mid\n\n1. one\n2. two',
    '```\nunclosed fence still code',
  ]
  for (const f of fixtures) {
    const ts = renderSafeMarkdown(f)
    const br = browserRender(f)
    assert(ts.html === br.html, `V-IND-1 parity html for fixture len=${f.length}`)
    assert(ts.mode === br.mode, `V-IND-1 parity mode for fixture len=${f.length}`)
    assert(containsUnsafeHtml(ts.html) === false, `V-IND-1 TS unsafe=false len=${f.length}`)
    assert(containsUnsafeHtml(br.html) === false, `V-IND-1 browser unsafe=false len=${f.length}`)
  }
  const evil = renderSafeMarkdown('<script>x</script>\n<img src="https://evil.example/z">')
  assert(!evil.html.toLowerCase().includes('<script'), 'V-IND-1 no live script tag')
  assert(!/<img\b/i.test(evil.html), 'V-IND-1 no live img tag')
  assert(!/<[^>]+\ssrc\s*=\s*["']?\s*https:\/\/evil/i.test(evil.html), 'V-IND-1 no external src attr')

  // Parameter variation: different inputs → different outputs (not a stub)
  const a = renderSafeMarkdown('# A')
  const b = renderSafeMarkdown('# B')
  assert(a.html !== b.html, 'V-IND-1 MD output varies with input (not stub)')
}

// --- V-IND-2 -----------------------------------------------------------------
async function vInd2OpenHistoryReplay(): Promise<void> {
  console.log('\n== V-IND-2 openFromHistory → replay (AC-20) ==')
  const host = stubHost()
  const controller = new ConversationController(host)
  // user/message: data IS the message; assistant/message: data.message wraps it (see foldMessages).
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
  const opened = await controller.openFromHistory('sess-vind-hist', { events })
  assert(opened.outcome === 'opened', `V-IND-2 opened (got ${opened.outcome})`)
  if (opened.outcome !== 'opened') return
  assert(opened.mode === 'replay', `V-IND-2 mode=replay (got ${opened.mode})`)
  assert(opened.messageCount === 2, `V-IND-2 messageCount=2 (got ${opened.messageCount})`)

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
    'V-IND-2 panel/state mode=replay on attach',
  )
  const replace = fake.receivedFromHost.find(m => m.type === 'messages/replace')
  assert(
    replace !== undefined
      && Array.isArray((replace as { messages?: unknown[] }).messages)
      && ((replace as { messages: unknown[] }).messages.length === 2),
    'V-IND-2 messages/replace carries hydrated bubbles',
  )

  panel.clearOutboundLog()
  fake.emitFromWebview({ type: 'composer/send', text: 'blocked' })
  await waitFor(() => panel.getOutboundLog().some(m => m.type === 'ui/reject-send'), 1_500)
  const reject = panel.getOutboundLog().find(m => m.type === 'ui/reject-send')
  assert(
    reject !== undefined && (reject as { reason?: string }).reason === 'replay',
    'V-IND-2 composer/send rejected with reason=replay',
  )
}

// --- V-IND-3 -----------------------------------------------------------------
function vInd3ScreenshotReadme(): void {
  console.log('\n== V-IND-3 visual evidence README exists (AC-7a) ==')
  const root = resolve(process.cwd(), 'apps/vscode-dsh/tests/fixtures/screenshots')
  const readme = resolve(root, 'README.md')
  assert(existsSync(readme), `V-IND-3 existsSync ${readme}`)
  const body = readFileSync(readme, 'utf8')
  assert(body.includes('B1-theme-light.png'), 'V-IND-3 README lists B1 light')
  assert(body.includes('B1-theme-dark.png'), 'V-IND-3 README lists B1 dark')
  assert(body.includes('B2-bubbles-composer.png'), 'V-IND-3 README lists B2')
  assert(body.includes('B3-markdown-code.png'), 'V-IND-3 README lists B3')
  assert(body.includes('L2/L3'), 'V-IND-3 README states L2/L3 primary')
  // PNGs optional — absence must not fail AC-7a
  assert(true, 'V-IND-3 PNG optional (assist-only) acknowledged')
}

// --- V-IND-4 -----------------------------------------------------------------
function vInd4ThemeKinds(): void {
  console.log('\n== V-IND-4 theme kind parameter variation (AC-8a) ==')
  const html = buildThinChatHtml()
  assert(html.includes("msg.type === 'ui/theme'"), 'V-IND-4 HTML consumes ui/theme')
  assert(html.includes('applyThemeKind'), 'V-IND-4 applyThemeKind present')
  assert(html.includes('theme-light') && html.includes('theme-dark'), 'V-IND-4 theme classes in HTML')

  const registry = new ConversationRegistry()
  const messages = new ConversationController(stubHost()).messages
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

  for (const kind of ['light', 'dark', 'high-contrast'] as const) {
    panel.pushThemeKind(kind)
  }
  const themes = fake.receivedFromHost.filter(m => m.type === 'ui/theme')
  assert(themes.length === 3, `V-IND-4 three ui/theme posts (got ${themes.length})`)
  assert(
    themes.map(m => (m as { themeKind: string }).themeKind).join(',') === 'light,dark,high-contrast',
    'V-IND-4 themeKind varies with input',
  )
}

// --- V-IND-5 -----------------------------------------------------------------
function vInd5MessagesReplaceMdPath(): void {
  console.log('\n== V-IND-5 Host→Webview messages/replace MD path (AC-9/16 e2e) ==')
  const host = stubHost()
  const controller = new ConversationController(host)
  const tab = controller.newConversation('md-live')
  const mdText = [
    '# Title',
    '',
    '- one',
    '',
    '```ts',
    'const x = 1',
    '```',
  ].join('\n')
  controller.messages.replace(tab.sessionId, [
    {
      id: 'u1',
      sessionId: tab.sessionId,
      role: 'user',
      kind: 'text',
      text: 'please render',
    },
    {
      id: 'a1',
      sessionId: tab.sessionId,
      role: 'assistant',
      kind: 'text',
      text: mdText,
    },
  ])
  const panel = new ChatPanelHost({
    registry: controller.registry,
    messages: controller.messages,
    isHostReady: () => true,
    acceptSend: (text) => controller.promptActive(text),
  })
  controller.setPanelHost(panel)
  const fake = new FakeWebviewPort()
  panel.attach(fake)
  const replace = fake.receivedFromHost.find(m => m.type === 'messages/replace') as {
    type: string
    messages: Array<{ role: string; text: string }>
  } | undefined
  assert(replace !== undefined, 'V-IND-5 messages/replace posted')
  assert(replace!.messages.length === 2, 'V-IND-5 two bubbles projected')
  assert(replace!.messages[0]?.role === 'user', 'V-IND-5 user role preserved')
  assert(replace!.messages[1]?.role === 'assistant', 'V-IND-5 assistant role preserved')
  assert(replace!.messages[1]?.text.includes('```ts'), 'V-IND-5 MD text intact through Host')

  // Client-side render of the same payload (simulates Webview renderBubble)
  const rendered = renderSafeMarkdown(replace!.messages[1]!.text)
  assert(rendered.html.includes('<h1 class="md-h">Title</h1>'), 'V-IND-5 heading rendered')
  assert(rendered.html.includes('copy-code'), 'V-IND-5 fenced code has copy affordance')
  assert(containsUnsafeHtml(rendered.html) === false, 'V-IND-5 rendered HTML safe')

  const html = buildThinChatHtml()
  assert(html.includes("'msg bubble ' + msg.role"), 'V-IND-5 bubble class uses role')
  assert(html.includes('data-role'), 'V-IND-5 data-role attribute')
}

// --- V-IND-6 -----------------------------------------------------------------
async function vInd6CopyParamVariation(): Promise<void> {
  console.log('\n== V-IND-6 copy-code parameter variation (AC-17) ==')
  const parsed = parseWebviewToHostMessage({ type: 'action/copy-code', text: 'abc' })
  assert(
    parsed !== undefined && parsed.type === 'action/copy-code' && parsed.text === 'abc',
    'V-IND-6 parse action/copy-code',
  )

  const copied: string[] = []
  const registry = new ConversationRegistry()
  const messages = new ConversationController(stubHost()).messages
  const panel = new ChatPanelHost({
    registry,
    messages,
    isHostReady: () => true,
    acceptSend: async () => ({ messageId: 'm', sessionId: 's', tabId: 't' }),
    requestCopyCode: async (text) => { copied.push(text) },
  })
  const fake = new FakeWebviewPort()
  panel.attach(fake)
  fake.emitFromWebview({ type: 'action/copy-code', text: 'alpha-code' })
  fake.emitFromWebview({ type: 'action/copy-code', text: 'beta-code' })
  await waitFor(() => copied.length === 2, 1_500)
  assert(copied[0] === 'alpha-code' && copied[1] === 'beta-code', 'V-IND-6 copy text varies with input')

  // L2 command registration path
  const writes: string[] = []
  const commands = new Map<string, (...args: unknown[]) => unknown>()
  const vscode = {
    window: {
      showErrorMessage: async () => undefined,
      showInformationMessage: async () => undefined,
      activeColorTheme: { kind: 2 },
      onDidChangeActiveColorTheme() { return { dispose() {} } },
    },
    workspace: { workspaceFolders: [{ uri: { fsPath: '/tmp/dsh-vind-p3' } }] },
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
  try {
    assert(commands.has('dsh.copyToClipboard'), 'V-IND-6 command registered')
    const r1 = await vscode.commands.executeCommand('dsh.copyToClipboard', 'one')
    const r2 = await vscode.commands.executeCommand('dsh.copyToClipboard', 'two')
    assert(r1 && (r1 as { ok: boolean }).ok === true, 'V-IND-6 copy one ok')
    assert(r2 && (r2 as { ok: boolean }).ok === true, 'V-IND-6 copy two ok')
    assert(writes.join(',') === 'one,two', 'V-IND-6 clipboard writes vary')
  } finally {
    await deactivate()
  }
}

// --- V-IND-7 -----------------------------------------------------------------
function vInd7SidebarIa(): void {
  console.log('\n== V-IND-7 Conversations/History IA (AC-19/19a) ==')
  assert(EMPTY_LIVE_TITLE === '新对话', 'V-IND-7 EMPTY_LIVE_TITLE is 新对话')
  const empty = conversationTreeItems({ tabs: [], activeTabId: undefined })
  assert(empty.length === 0, 'V-IND-7 empty registry → no items')
  assert(empty.every(i => !/Start/i.test(String(i.label))), 'V-IND-7 no Start Session stack')

  const registry = new ConversationRegistry()
  registry.create(EMPTY_LIVE_TITLE)
  const items = conversationTreeItems(registry.snapshot())
  assert(items.length === 1 && items[0]?.label === EMPTY_LIVE_TITLE, 'V-IND-7 empty live label 新对话')

  assert(isHistoryEligibleSession({ title: EMPTY_LIVE_TITLE }) === false, 'V-IND-7 empty title ineligible')
  assert(isHistoryEligibleSession({ title: 'New conversation' }) === false, 'V-IND-7 EN placeholder ineligible')
  assert(isHistoryEligibleSession({ title: '', firstUserPreview: 'x' }) === true, 'V-IND-7 preview qualifies')
  assert(isHistoryEligibleSession({ title: 'Real' }) === true, 'V-IND-7 real title qualifies')

  const index = new ExtensionIndex('/ws-vind-p3')
  index.upsertSession({ sessionId: 'e1', title: EMPTY_LIVE_TITLE, mtime: 3 })
  index.upsertSession({ sessionId: 'e2', title: 'New conversation', mtime: 2 })
  index.upsertSession({ sessionId: 'r1', title: 'Real', mtime: 1, firstUserPreview: 'hi' })
  const rows = listHistoryFromIndex(index)
  assert(rows.map(r => r.sessionId).join(',') === 'r1', `V-IND-7 history filters empties (got ${rows.map(r => r.sessionId)})`)
}

// --- V-IND-8 -----------------------------------------------------------------
function vInd8StaticChassis(): void {
  console.log('\n== V-IND-8 static chassis tokens/CSP/composer/authority (AC-8/11/25) ==')
  const html = buildThinChatHtml('vscode-resource:')
  assert(html.includes('--vscode-'), 'V-IND-8 --vscode-* present')
  assert(html.includes('var(--vscode-sideBar-background'), 'V-IND-8 sidebar bg token')
  assert(html.includes('var(--vscode-button-background)'), 'V-IND-8 button token')
  assert(html.includes('dsh-chat-chassis'), 'V-IND-8 chassis marker')
  assert(!/body\s*\{[^}]*background:\s*#(?:ccc|ddd|eee|f5f5f5)/i.test(html), 'V-IND-8 no bare gray body')
  assert(html.includes("default-src 'none'"), 'V-IND-8 CSP default-src none')
  assert(html.includes('data-testid="composer"'), 'V-IND-8 composer testid')
  assert(html.includes('position: sticky') && html.includes('bottom: 0'), 'V-IND-8 sticky bottom bar')
  assert(html.includes('data-testid="send"'), 'V-IND-8 send button')
  assert(html.includes("msg.type === 'panel/state'"), 'V-IND-8 follows panel/state')
  assert(!html.includes('createRoot') && !html.includes('ReactDOM'), 'V-IND-8 no second UI framework')
}

// --- V-IND-9 -----------------------------------------------------------------
function vInd9Keydown(): void {
  console.log('\n== V-IND-9 composer keydown matrix (AC-12) ==')
  const cases: Array<{
    input: Parameters<typeof resolveComposerKeydown>[0]
    expect: ReturnType<typeof resolveComposerKeydown>
  }> = [
    { input: { key: 'Enter', shiftKey: false, text: 'hi' }, expect: 'send' },
    { input: { key: 'Enter', shiftKey: true, text: 'hi' }, expect: 'newline' },
    { input: { key: 'Enter', shiftKey: false, text: '   ' }, expect: 'none' },
    { input: { key: 'Enter', shiftKey: false, text: 'hi', isComposing: true }, expect: 'none' },
    { input: { key: 'Enter', shiftKey: true, text: '', isComposing: false }, expect: 'newline' },
    { input: { key: 'a', shiftKey: false, text: 'hi' }, expect: 'none' },
  ]
  for (const c of cases) {
    const got = resolveComposerKeydown(c.input)
    assert(got === c.expect, `V-IND-9 ${JSON.stringify(c.input)} → ${c.expect} (got ${got})`)
  }
  const html = buildThinChatHtml()
  assert(html.includes('resolveComposerKeydown'), 'V-IND-9 HTML wires helper')
  assert(html.includes("type: 'composer/send'"), 'V-IND-9 send posts composer/send')
  assert(html.includes('keydown'), 'V-IND-9 keydown listener')
}

// --- V-IND-10 ----------------------------------------------------------------
function vInd10Generating(): void {
  console.log('\n== V-IND-10 generating indicator (AC-10) ==')
  const html = buildThinChatHtml()
  assert(html.includes('Generating…') || html.includes('Generating'), 'V-IND-10 generating copy in HTML')
  assert(html.includes('is-generating'), 'V-IND-10 is-generating class')

  const host = stubHost()
  const controller = new ConversationController(host)
  const tab = controller.newConversation(EMPTY_LIVE_TITLE)
  const panel = new ChatPanelHost({
    registry: controller.registry,
    messages: controller.messages,
    isHostReady: () => true,
    acceptSend: (text) => controller.promptActive(text),
  })
  controller.setPanelHost(panel)
  const fake = new FakeWebviewPort()
  panel.attach(fake)
  controller.registry.setStatus(tab.tabId, 'running')
  panel.pushStatus()
  assert(
    panel.getOutboundLog().some(m => m.type === 'status/set' && (m as { status: string }).status === 'generating'),
    'V-IND-10 running → generating',
  )
  controller.registry.setStatus(tab.tabId, 'idle')
  panel.pushStatus()
  const last = [...panel.getOutboundLog()].reverse().find(m => m.type === 'status/set') as { status: string }
  assert(last?.status === 'idle', 'V-IND-10 idle clears generating')
}

// --- V-IND-11 ----------------------------------------------------------------
async function vInd11SendSmoke(): Promise<void> {
  console.log('\n== V-IND-11 live send smoke (AC-27) ==')
  const prompts: string[] = []
  const host = stubHost(async (text) => {
    prompts.push(text)
    return 'msg-vind'
  })
  const controller = new ConversationController(host)
  const tab = controller.newConversation('live')
  const panel = new ChatPanelHost({
    registry: controller.registry,
    messages: controller.messages,
    isHostReady: () => true,
    acceptSend: (text) => controller.promptActive(text),
  })
  controller.setPanelHost(panel)
  const fake = new FakeWebviewPort()
  panel.attach(fake)
  fake.emitFromWebview({ type: 'composer/send', text: 'vind-send-1' })
  await waitFor(() => controller.messages.hasContent(tab.sessionId), 1_500)
  assert(prompts.join('|') === 'vind-send-1', 'V-IND-11 prompt received')
}

// --- V-IND-12 ----------------------------------------------------------------
function vInd12StaticPolicy(): void {
  console.log('\n== V-IND-12 static policy (AC-17/18/25 agent-loop) ==')
  const pkg = JSON.parse(readFileSync(resolve(process.cwd(), 'apps/vscode-dsh/package.json'), 'utf8')) as {
    contributes: { commands?: Array<{ command: string }>; menus?: Record<string, Array<{ command?: string }>> }
  }
  assert(
    (pkg.contributes.commands ?? []).some(c => c.command === 'dsh.copyToClipboard'),
    'V-IND-12 copy command contributed',
  )
  const menuCmds = Object.values(pkg.contributes.menus ?? {}).flat().map(m => m.command)
  assert(!menuCmds.includes('dsh.copyToClipboard'), 'V-IND-12 copy not menu primary')

  // Tables/links not Must — renderer must not require table tags for success
  const tableMd = renderSafeMarkdown('| a | b |\n|---|---|\n| 1 | 2 |')
  assert(containsUnsafeHtml(tableMd.html) === false, 'V-IND-12 table input still safe')
  assert(!tableMd.html.includes('<table'), 'V-IND-12 tables not implemented (AC-18 OK)')

  // agent-loop untouched: no imports from agent-loop in phase3 touch files
  const touch = [
    'apps/vscode-dsh/src/chat-panel/chat-panel-provider.ts',
    'apps/vscode-dsh/src/markdown/safe-markdown.ts',
    'apps/vscode-dsh/src/chat-panel/composer-keydown.ts',
    'apps/vscode-dsh/src/extension.ts',
  ]
  for (const f of touch) {
    const body = readFileSync(resolve(process.cwd(), f), 'utf8')
    assert(!body.includes('agent-loop'), `V-IND-12 ${f} does not reference agent-loop`)
  }
}

// --- V-IND-13 ----------------------------------------------------------------
/** Confirm prior SHOULD-FIX evidence is now owned by implementer suite (re-verify gate). */
function vInd13SfEvidenceInImplementerSuite(): void {
  console.log('\n== V-IND-13 SF#1–3 now in implementer phase3 suite ==')
  const suitePath = resolve(process.cwd(), 'apps/vscode-dsh/tests/phase3-chat-ui-chassis.spec.ts')
  assert(existsSync(suitePath), 'V-IND-13 phase3 suite file exists')
  const suite = readFileSync(suitePath, 'utf8')

  // SF#1 AC-16/16a: HTML embed + vm browser↔TS parity
  assert(suite.includes('safeMarkdownBrowserSource'), 'V-IND-13 SF#1 suite imports/uses safeMarkdownBrowserSource')
  assert(suite.includes('renderViaBrowserSource') || suite.includes('runInContext'), 'V-IND-13 SF#1 suite has vm browser render path')
  assert(
    suite.includes('browser-embedded MD source matches TS') || suite.includes('matches TS renderSafeMarkdown'),
    'V-IND-13 SF#1 suite has browser↔TS parity case',
  )

  // SF#2 AC-20: openFromHistory → replay + reject-send
  assert(suite.includes('openFromHistory'), 'V-IND-13 SF#2 suite calls openFromHistory')
  assert(suite.includes("mode).toBe('replay'") || suite.includes("toBe('replay')"), 'V-IND-13 SF#2 asserts mode=replay')
  assert(suite.includes("reason: 'replay'") || suite.includes("reason: \"replay\""), 'V-IND-13 SF#2 asserts reject-send replay')

  // SF#3 AC-7a: existsSync screenshots README (not path.length > 0 alone)
  assert(suite.includes('existsSync'), 'V-IND-13 SF#3 suite uses existsSync')
  assert(suite.includes('fixtures/screenshots'), 'V-IND-13 SF#3 suite points at screenshots fixtures')
  assert(suite.includes('README.md'), 'V-IND-13 SF#3 suite asserts README.md')
}

async function main(): Promise<void> {
  console.log('=== Verifier independent Phase 3 (re-verify after SF hardenings) ===')
  vInd1MdParity()
  await vInd2OpenHistoryReplay()
  vInd3ScreenshotReadme()
  vInd4ThemeKinds()
  vInd5MessagesReplaceMdPath()
  await vInd6CopyParamVariation()
  vInd7SidebarIa()
  vInd8StaticChassis()
  vInd9Keydown()
  vInd10Generating()
  await vInd11SendSmoke()
  vInd12StaticPolicy()
  vInd13SfEvidenceInImplementerSuite()

  console.log(`\n=== V-IND SUMMARY failed=${failed} ===`)
  if (failed > 0) process.exit(1)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
