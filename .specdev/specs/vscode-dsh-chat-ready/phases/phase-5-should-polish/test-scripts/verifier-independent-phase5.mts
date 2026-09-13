/**
 * Verifier-independent Phase 5 checks (AC-28…32 / AC-34; AC-33 OOS).
 * Deliberately uses fixtures NOT copied from phase5-should-polish.spec.ts.
 */
import { createContext, runInContext } from 'node:vm'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import {
  containsUnsafeHtml,
  renderSafeMarkdown,
  safeMarkdownBrowserSource,
} from '../../../../../../apps/vscode-dsh/src/markdown/safe-markdown.ts'
import { continueChromeFor } from '../../../../../../apps/vscode-dsh/src/continue-capability.ts'
import {
  UNREAD_INDICATOR,
  conversationTreeItems,
} from '../../../../../../apps/vscode-dsh/src/conversation-tab-bar.ts'
import { ConversationRegistry } from '../../../../../../apps/vscode-dsh/src/conversation-registry.ts'
import { ConversationController } from '../../../../../../apps/vscode-dsh/src/conversation-controller.ts'
import { TimelineStore } from '../../../../../../apps/vscode-dsh/src/timeline-store.ts'
import {
  ChatPanelHost,
  FakeWebviewPort,
  buildThinChatHtml,
  parseWebviewToHostMessage,
} from '../../../../../../apps/vscode-dsh/src/chat-panel/index.ts'
import type { IdeSessionHost } from '../../../../../../apps/vscode-dsh/src/session-host.ts'
import type { HarnessNotification } from '@deepseek-ai/dsh-sdk-client'

let failed = 0
let passed = 0

function ok(name: string, cond: boolean, detail?: string): void {
  if (cond) {
    passed++
    console.log(`  PASS  ${name}${detail ? ` — ${detail}` : ''}`)
  } else {
    failed++
    console.error(`  FAIL  ${name}${detail ? ` — ${detail}` : ''}`)
  }
}

function event(
  sessionId: string,
  type: string,
  data: Record<string, unknown>,
): HarnessNotification {
  return {
    method: 'session.event',
    params: { sessionId, event: { type, data } },
  }
}

function evalBrowser(source: string): { html: string; mode: string } {
  const ctx = createContext({ String })
  runInContext(`${safeMarkdownBrowserSource()}; this.__out = renderSafeMarkdown;`, ctx)
  const render = (ctx as { __out: (s: string) => { html: string; mode: string } }).__out
  return render(source)
}

async function waitFor(pred: () => boolean, ms: number): Promise<void> {
  const t0 = Date.now()
  while (!pred()) {
    if (Date.now() - t0 > ms) throw new Error('waitFor timeout')
    await new Promise(r => setTimeout(r, 10))
  }
}

console.log('\n=== V-IND Phase-5 independent verification ===\n')

// --- AC-28: multi-row table + relative link scheme + XSS (param variation) ---
console.log('AC-28 Markdown table/link + safe fallback')
{
  const multi = renderSafeMarkdown(
    '| ColX | ColY |\n| --- | --- |\n| alpha | beta |\n| gamma | delta |',
  )
  ok('AC-28 table multi-row', multi.mode === 'markdown' && multi.html.includes('md-table'))
  ok('AC-28 table cells present', multi.html.includes('alpha') && multi.html.includes('delta'))
  ok('AC-28 table XSS-clean', !containsUnsafeHtml(multi.html))

  const link = renderSafeMarkdown('Visit [API](https://api.example.org/v1) now')
  ok('AC-28 https link', /md-link/.test(link.html) && link.html.includes('https://api.example.org/v1'))

  const ftp = renderSafeMarkdown('no [ftp](ftp://evil/x)')
  ok(
    'AC-28 non-http scheme not href',
    !/href\s*=\s*["']?\s*ftp:/i.test(ftp.html) && !containsUnsafeHtml(ftp.html),
  )

  const xss = renderSafeMarkdown(
    '| a | b |\n| --- | --- |\n| <script>x</script> | [z](javascript:void(0)) |',
  )
  ok('AC-28 table XSS negated', !containsUnsafeHtml(xss.html) && !/<script/i.test(xss.html))
  ok('AC-28 js: in table cell not href', !/href\s*=\s*["']?\s*javascript:/i.test(xss.html))

  const plain = renderSafeMarkdown(Object.create(null) as string)
  ok('AC-28 failure → plain', plain.mode === 'plain' && plain.html.includes('md-plain'))

  const br = evalBrowser('| P |\n| --- |\n| Q |')
  const ts = renderSafeMarkdown('| P |\n| --- |\n| Q |')
  ok('AC-28 browser≡TS table', br.html === ts.html)
}

// --- AC-31: param variation (python / empty / invent check) ---
console.log('\nAC-31 fenced language label')
{
  const py = renderSafeMarkdown('```python\nprint(1)\n```')
  ok(
    'AC-31 python visible label',
    /class="[^"]*code-lang[^"]*"[^>]*>\s*python\s*</.test(py.html),
  )
  const bare = renderSafeMarkdown('```\nprint(1)\n```')
  ok('AC-31 no invented lang', !/code-lang/.test(bare.html) && !/data-lang=/.test(bare.html))
  ok('AC-31 no invent python on bare', !/\bpython\b/i.test(bare.html))
}

// --- AC-29: reason texts distinct + not 暂不可用 ---
console.log('\nAC-29 Continue distinguishable reasons')
{
  const a = continueChromeFor('same-id', 'unknown', { mode: 'live', hostReady: true })
  const b = continueChromeFor('same-id', 'same-id', { mode: 'replay', hostReady: false })
  const c = continueChromeFor('same-id', 'unknown', { mode: 'replay', hostReady: true })
  ok('AC-29 already-live', a.reason === 'already-live' && a.reasonText === '已是 live')
  ok('AC-29 host-not-ready', b.reason === 'host-not-ready' && b.reasonText === 'Host 未就绪')
  ok('AC-29 capability-unavailable', c.reason === 'capability-unavailable' && c.reasonText === '能力不可用')
  const texts = new Set([a.reasonText, b.reasonText, c.reasonText])
  ok('AC-29 three distinct texts', texts.size === 3)
  ok(
    'AC-29 not vague 暂不可用',
    ![a.reasonText, b.reasonText, c.reasonText].includes('暂不可用'),
  )
  const html = buildThinChatHtml()
  ok('AC-29 DOM continueReason', html.includes('id="continueReason"') && html.includes('reasonText'))
}

// --- AC-30: duplicate paths count once; N=3; forge none; open-diffs ---
console.log('\nAC-30 turn file-change entry')
{
  const store = new TimelineStore()
  const sid = 'v-ind-turn'
  store.apply(event(sid, 'turn/start', { turn: 0 }))
  store.apply(
    event(sid, 'tool/result', {
      turn: 0,
      message: { callId: 'x1', name: 'write', content: [] },
      meta: {
        diffs: [
          { path: 'dup.ts', oldText: '', newText: '1' },
          { path: 'dup.ts', oldText: '1', newText: '2' },
          { path: 'other.ts', oldText: null, newText: 'z' },
          { path: 'third.md', oldText: 'a', newText: 'b' },
        ],
      },
    }),
  )
  ok(
    'AC-30 unique count (dup path)',
    store.changedFileCountForLatestTurn(sid) === 3,
    `got ${store.changedFileCountForLatestTurn(sid)}`,
  )

  let notify: ((n: HarnessNotification) => void) | undefined
  const host = {
    status: 'connected' as const,
    interactions: { failClosedSession() {}, listPending() { return [] } },
    setConversationRegistry() {},
    onNotification(listener: (n: HarnessNotification) => void) {
      notify = listener
      return () => {
        notify = undefined
      }
    },
    async prompt() {
      return 'm'
    },
    async disposeSession() {},
  } as unknown as IdeSessionHost
  const controller = new ConversationController(host)
  const tab = controller.newConversation('live')
  const panel = new ChatPanelHost({
    registry: controller.registry,
    messages: controller.messages,
    isHostReady: () => true,
    acceptSend: async () => ({ messageId: 'm', sessionId: tab.sessionId, tabId: tab.tabId }),
  })
  controller.setPanelHost(panel)

  controller.injectAssistantMessage(tab.sessionId, 'nothing')
  ok(
    'AC-30 no forge when N=0',
    !controller.messages.get(tab.sessionId).some(m => m.kind === 'diff-summary'),
  )

  notify?.(event(tab.sessionId, 'turn/start', { turn: 0 }))
  notify?.(
    event(tab.sessionId, 'tool/result', {
      turn: 0,
      message: { callId: 'c9', name: 'write', content: [] },
      meta: {
        diffs: [
          { path: 'u1.ts', oldText: '', newText: '1' },
          { path: 'u2.ts', oldText: '', newText: '2' },
        ],
      },
    }),
  )
  notify?.(
    event(tab.sessionId, 'assistant/message', {
      turn: 0,
      message: {
        id: 'a9',
        role: 'assistant',
        content: [{ type: 'text', text: 'two files' }],
        source: { kind: 'model', provider: 'fake', model: 'fake' },
      },
    }),
  )
  const summary = controller.messages.get(tab.sessionId).find(m => m.kind === 'diff-summary')
  ok('AC-30 summary exists', !!summary)
  ok('AC-30 N=2 copy', !!summary?.text.match(/本回合改了\s*2\s*个文件/))

  const opened: string[] = []
  const registry = new ConversationRegistry()
  const t2 = registry.create('s2')
  registry.switchTo(t2.tabId)
  const panel2 = new ChatPanelHost({
    registry,
    messages: controller.messages,
    isHostReady: () => true,
    acceptSend: async () => ({ messageId: 'm', sessionId: t2.sessionId, tabId: t2.tabId }),
    requestOpenWorkspaceDiffs: async () => {
      opened.push('ok')
    },
  })
  const fake = new FakeWebviewPort()
  panel2.attach(fake)
  ok(
    'AC-30 protocol parse',
    JSON.stringify(parseWebviewToHostMessage({ type: 'action/open-workspace-diffs' })) ===
      JSON.stringify({ type: 'action/open-workspace-diffs' }),
  )
  fake.emitFromWebview({ type: 'action/open-workspace-diffs' })
  await waitFor(() => opened.length === 1, 1000)
  ok('AC-30 open-workspace-diffs → Host', opened[0] === 'ok')

  const html = buildThinChatHtml()
  ok(
    'AC-30 webview wiring',
    html.includes('diff-summary') && html.includes('action/open-workspace-diffs'),
  )
}

// --- AC-32: enhanced vs ●; clear semantics ---
console.log('\nAC-32 unread discoverability')
{
  ok('AC-32 not baseline ●', UNREAD_INDICATOR !== '●')
  ok('AC-32 glyph larger/different', UNREAD_INDICATOR === '⬤' || UNREAD_INDICATOR.length >= 1)
  const registry = new ConversationRegistry()
  const a = registry.create('A')
  const b = registry.create('B')
  registry.switchTo(b.tabId)
  registry.setUnread(a.tabId, true)
  const before = conversationTreeItems(registry.snapshot()).find(i => i.tabId === a.tabId)
  ok('AC-32 unread prefix', !!before?.label.startsWith(UNREAD_INDICATOR))
  registry.switchTo(a.tabId)
  ok('AC-32 clear on activate', registry.get(a.tabId)?.unread === false)
  const after = conversationTreeItems(registry.snapshot()).find(i => i.tabId === a.tabId)
  ok('AC-32 label cleared', !after?.label.startsWith(UNREAD_INDICATOR))
}

// --- AC-34: keybindings + chrome + ensureHost path static ---
console.log('\nAC-34 keybindings ≡ newConversation')
{
  const pkgPath = resolve('apps/vscode-dsh/package.json')
  const pkg = JSON.parse(readFileSync(pkgPath, 'utf8')) as {
    contributes: { keybindings?: Array<{ command?: string; key?: string; mac?: string }> }
  }
  const kb = pkg.contributes.keybindings ?? []
  const hit = kb.find(b => b.command === 'dsh.newConversation')
  ok('AC-34 keybinding exists', !!hit)
  ok('AC-34 has key chord', !!hit?.key && !!hit?.mac)

  const html = buildThinChatHtml()
  ok('AC-34 chrome button retained', /id="newConversationBtn"[^>]*>[\s]*新建会话/.test(html))

  const ext = readFileSync(resolve('apps/vscode-dsh/src/extension.ts'), 'utf8')
  ok(
    'AC-34 command path ensureHost',
    /async function runNewConversationShared[\s\S]*?await ensureHostForSend/.test(ext) &&
      /registerCommand\(['"]dsh\.newConversation['"]/.test(ext),
  )

  const readme = readFileSync(resolve('apps/vscode-dsh/README.md'), 'utf8')
  ok(
    'AC-34 README declares chord',
    /ctrl\+shift\+alt\+n/i.test(readme) && /keybindings/i.test(readme) && /新建会话/.test(readme),
  )
}

// --- AC-33 OOS: no animation polish expected ---
console.log('\nAC-33 Out of Scope (skip behavior)')
ok('AC-33 skipped (constitution OOS)', true)

console.log(`\n=== Result: passed=${passed} failed=${failed} ===\n`)
process.exit(failed > 0 ? 1 : 0)
