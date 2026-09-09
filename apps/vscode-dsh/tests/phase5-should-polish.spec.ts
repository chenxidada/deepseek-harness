/**
 * Phase 5 Should→Must polish — L2/L3 (AC-28…32 / AC-34; AC-33 out of scope).
 * VP-CR-14a…e / VP-CR-13.
 */

import { createContext, runInContext } from 'node:vm'
import { afterEach, describe, expect, it } from 'vitest'
import {
  ChatPanelHost,
  FakeWebviewPort,
  buildThinChatHtml,
  parseWebviewToHostMessage,
} from '../src/chat-panel/index.ts'
import {
  containsUnsafeHtml,
  renderSafeMarkdown,
  safeMarkdownBrowserSource,
} from '../src/markdown/safe-markdown.ts'
import {
  continueChromeFor,
  type ContinueCapability,
} from '../src/continue-capability.ts'
import {
  UNREAD_INDICATOR,
  conversationTreeItems,
} from '../src/conversation-tab-bar.ts'
import { ConversationRegistry } from '../src/conversation-registry.ts'
import { ConversationController } from '../src/conversation-controller.ts'
import { TimelineStore } from '../src/timeline-store.ts'
import { IdeSessionHost } from '../src/session-host.ts'
import { deactivate } from '../src/extension.ts'
import type { HarnessNotification } from '@deepseek-ai/dsh-sdk-client'

afterEach(async () => {
  await deactivate()
})

describe('VP-CR-14a / AC-28 safe Markdown table or link', () => {
  it('renders Markdown links readably; XSS probes stay blocked', () => {
    const withLink = renderSafeMarkdown('See [docs](https://example.com/path) please')
    expect(withLink.mode).toBe('markdown')
    expect(withLink.html).toMatch(/md-link|href=/)
    expect(withLink.html).toContain('docs')
    expect(withLink.html).toContain('https://example.com/path')
    expect(containsUnsafeHtml(withLink.html)).toBe(false)

    const table = renderSafeMarkdown('| A | B |\n| --- | --- |\n| 1 | 2 |')
    expect(table.mode).toBe('markdown')
    // At least one of table or link is required; both may ship.
    const hasTable = table.html.includes('<table') || table.html.includes('md-table')
    const hasLink = withLink.html.includes('md-link') || withLink.html.includes('href=')
    expect(hasTable || hasLink).toBe(true)
    if (hasTable) {
      expect(table.html).toContain('A')
      expect(table.html).toContain('1')
      expect(containsUnsafeHtml(table.html)).toBe(false)
    }

    const evil = renderSafeMarkdown(
      'Click [x](javascript:alert(1)) <script>alert(1)</script> <img src=https://x onerror=alert(1)>',
    )
    expect(containsUnsafeHtml(evil.html)).toBe(false)
    // Rejected scheme must not become an href; escaped plain text may still mention the word.
    expect(evil.html).not.toMatch(/href\s*=\s*["']?\s*javascript:/i)
    expect(evil.html).not.toMatch(/<script/i)
    expect(evil.html).not.toMatch(/<a[^>]+href=["']javascript:/i)
  })

  it('render failure falls back to safe plain text', () => {
    const broken = Object.create(null) as string
    const result = renderSafeMarkdown(broken)
    expect(result.mode).toBe('plain')
    expect(result.html).toContain('md-plain')
    expect(containsUnsafeHtml(result.html)).toBe(false)
  })

  it('browser-embedded MD source matches TS for link fixtures', () => {
    const fixtures = [
      'Go [home](https://example.com/)',
      'bad [x](javascript:alert(1))',
      '| H |\n| --- |\n| v |',
    ]
    for (const f of fixtures) {
      const ts = renderSafeMarkdown(f)
      const br = evalBrowserMarkdown(f)
      expect(br.html).toBe(ts.html)
      expect(containsUnsafeHtml(ts.html)).toBe(false)
    }
  })
})

describe('VP-CR-14d / AC-31 fenced language label', () => {
  it('shows visible language label when fence specifies lang; never invents', () => {
    const withLang = renderSafeMarkdown('```ts\nconst x = 1\n```')
    expect(withLang.html).toMatch(/code-lang|data-lang="ts"/)
    expect(withLang.html).toContain('ts')
    // Visible chip/label element (not attribute-only).
    expect(withLang.html).toMatch(/class="[^"]*code-lang[^"]*"[^>]*>\s*ts\s*</)

    const noLang = renderSafeMarkdown('```\nplain\n```')
    expect(noLang.html).not.toMatch(/class="[^"]*code-lang/)
    expect(noLang.html).not.toMatch(/data-lang="/)
    expect(noLang.html.toLowerCase()).not.toContain('javascript')
    expect(noLang.html.toLowerCase()).not.toContain('typescript')
  })
})

describe('VP-CR-14b / AC-29 Continue grey-state reason', () => {
  it('disabled chrome carries distinguishable reason tokens + adjacent copy', () => {
    const live = continueChromeFor('same-id', 'unknown', { mode: 'live', hostReady: true })
    expect(live.visibility).toBe('disabled')
    expect(live.reason).toBe('already-live')
    expect(live.reasonText).toBeTruthy()
    expect(live.reasonText).not.toBe('暂不可用')

    const cap = continueChromeFor('same-id', 'unknown' as ContinueCapability, {
      mode: 'replay',
      hostReady: true,
    })
    expect(cap.visibility).toBe('disabled')
    expect(cap.reason).toBe('capability-unavailable')
    expect(cap.reasonText).toBeTruthy()
    expect(cap.reasonText).not.toBe(live.reasonText)

    const host = continueChromeFor('same-id', 'same-id', { mode: 'replay', hostReady: false })
    expect(host.visibility).toBe('disabled')
    expect(host.reason).toBe('host-not-ready')
    expect(host.reasonText).toBeTruthy()
    expect(host.reasonText).not.toBe(cap.reasonText)
    expect(host.reasonText).not.toBe(live.reasonText)
  })

  it('L3 HTML shows continueReason beside Continue control', () => {
    const html = buildThinChatHtml()
    expect(html).toContain('id="continueReason"')
    expect(html).toContain('continueReason')
    expect(html).toMatch(/cont\.reasonText|reasonText/)
  })

  it('L2: controller maps live / unknown / host-not-ready to distinct reasons', () => {
    const host = {
      status: 'connected' as const,
      interactions: { failClosedSession() {}, listPending() { return [] } },
      setConversationRegistry() {},
      onNotification() { return () => {} },
      async prompt() { return 'm' },
      async disposeSession() {},
      async resumeSession() {},
    } as unknown as IdeSessionHost
    const controller = new ConversationController(host)
    const liveTab = controller.newConversation('live')
    const liveChrome = controller.continueChromeForTab(liveTab.tabId)
    expect(liveChrome.visibility).toBe('disabled')
    expect(liveChrome.reason).toBe('already-live')
    expect(liveChrome.reasonText).toBeTruthy()

    host.status = 'disconnected' as 'connected'
    const hostChrome = controller.continueChromeForTab(liveTab.tabId)
    // Live still wins when mode is live.
    expect(hostChrome.reason).toBe('already-live')

    const opened = controller.registry.create('replay-sess')
    controller.registry.setMode(opened.tabId, 'replay')
    controller.registry.switchTo(opened.tabId)
    host.status = 'disconnected' as 'connected'
    const offlineReplay = controller.continueChromeForTab(opened.tabId)
    expect(offlineReplay.visibility).toBe('disabled')
    expect(offlineReplay.reason).toBe('host-not-ready')

    host.status = 'connected'
    const unknownReplay = controller.continueChromeForTab(opened.tabId)
    expect(unknownReplay.visibility).toBe('disabled')
    expect(unknownReplay.reason).toBe('capability-unavailable')
  })
})

describe('VP-CR-14c / AC-30 turn file-change entry', () => {
  it('counts unique files for latest turn; projects diff-summary only when N>0', () => {
    const store = new TimelineStore()
    const sessionId = 'sess-turn'
    store.apply(event(sessionId, 'turn/start', { turn: 0 }))
    store.apply(event(sessionId, 'tool/result', {
      turn: 0,
      message: { callId: 'c1', name: 'write', content: [] },
      meta: {
        diffs: [
          { path: 'a.ts', oldText: '', newText: '1' },
          { path: 'b.ts', oldText: null, newText: '2' },
        ],
      },
    }))
    expect(store.changedFilesForLatestTurn(sessionId)).toEqual(['a.ts', 'b.ts'])
    expect(store.changedFileCountForLatestTurn(sessionId)).toBe(2)

    store.apply(event(sessionId, 'turn/end', { turn: 0 }))
    store.apply(event(sessionId, 'turn/start', { turn: 1 }))
    expect(store.changedFileCountForLatestTurn(sessionId)).toBe(0)
  })

  it('L2: assistant turn with diffs appends 「本回合改了 N 个文件」; zero diffs forges none', () => {
    let notify: ((n: HarnessNotification) => void) | undefined
    const host = {
      status: 'connected' as const,
      interactions: { failClosedSession() {}, listPending() { return [] } },
      setConversationRegistry() {},
      onNotification(listener: (n: HarnessNotification) => void) {
        notify = listener
        return () => { notify = undefined }
      },
      async prompt() { return 'm' },
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

    // No diffs → inject assistant only → no diff-summary.
    controller.injectAssistantMessage(tab.sessionId, 'no files changed')
    expect(controller.messages.get(tab.sessionId).some(m => m.kind === 'diff-summary')).toBe(false)

    // Simulate turn with countable diffs then assistant message via SDK path.
    notify?.(event(tab.sessionId, 'turn/start', { turn: 0 }))
    notify?.(event(tab.sessionId, 'tool/result', {
      turn: 0,
      message: { callId: 'c2', name: 'write', content: [] },
      meta: { diffs: [{ path: 'only.ts', oldText: '', newText: 'x' }] },
    }))
    notify?.(event(tab.sessionId, 'assistant/message', {
      turn: 0,
      message: {
        id: 'a1',
        role: 'assistant',
        content: [{ type: 'text', text: 'wrote one file' }],
        source: { kind: 'model', provider: 'fake', model: 'fake' },
      },
    }))

    const msgs = controller.messages.get(tab.sessionId)
    const summary = msgs.find(m => m.kind === 'diff-summary')
    expect(summary).toBeDefined()
    expect(summary?.text).toMatch(/本回合改了\s*1\s*个文件/)
    expect(summary?.role).toBe('notice')
  })

  it('L3: diff-summary renders entry; open-workspace-diffs parses and reaches Host', async () => {
    const html = buildThinChatHtml()
    expect(html).toContain('diff-summary')
    expect(html).toContain('action/open-workspace-diffs')

    expect(parseWebviewToHostMessage({ type: 'action/open-workspace-diffs' })).toEqual({
      type: 'action/open-workspace-diffs',
    })

    const opened: string[] = []
    const registry = new ConversationRegistry()
    const tab = registry.create('s')
    registry.switchTo(tab.tabId)
    const controller = new ConversationController({
      status: 'connected',
      interactions: { failClosedSession() {}, listPending() { return [] } },
      setConversationRegistry() {},
      onNotification() { return () => {} },
      async prompt() { return 'm' },
      async disposeSession() {},
    } as unknown as IdeSessionHost)
    // Use standalone messages store from a fresh controller with same registry injection via panel.
    const panel = new ChatPanelHost({
      registry,
      messages: controller.messages,
      isHostReady: () => true,
      acceptSend: async () => ({ messageId: 'm', sessionId: tab.sessionId, tabId: tab.tabId }),
      requestOpenWorkspaceDiffs: async () => { opened.push('review') },
    })
    const fake = new FakeWebviewPort()
    panel.attach(fake)
    fake.emitFromWebview({ type: 'action/open-workspace-diffs' })
    await waitFor(() => opened.length === 1, 1_000)
    expect(opened).toEqual(['review'])
  })
})

describe('VP-CR-14e / AC-32 unread discoverability', () => {
  it('unread mark is enhanced vs phase-3 baseline ●; clear-on-activate unchanged', () => {
    expect(UNREAD_INDICATOR).not.toBe('●')
    expect(UNREAD_INDICATOR.length).toBeGreaterThanOrEqual(1)

    const registry = new ConversationRegistry()
    const a = registry.create('A')
    const b = registry.create('B')
    registry.switchTo(b.tabId)
    registry.setUnread(a.tabId, true)

    const items = conversationTreeItems(registry.snapshot())
    const unreadItem = items.find(i => i.tabId === a.tabId)
    expect(unreadItem?.label.startsWith(UNREAD_INDICATOR)).toBe(true)
    expect(unreadItem?.unread).toBe(true)

    registry.switchTo(a.tabId)
    expect(registry.get(a.tabId)?.unread).toBe(false)
    const after = conversationTreeItems(registry.snapshot())
    expect(after.find(i => i.tabId === a.tabId)?.label.startsWith(UNREAD_INDICATOR)).toBe(false)
  })
})

describe('VP-CR-13 / AC-34 keybindings ≡ newConversation', () => {
  it('package.json contributes keybindings for dsh.newConversation; chrome button remains', async () => {
    const pkg = await import('../package.json', { with: { type: 'json' } })
    const bindings = pkg.default.contributes.keybindings
    expect(Array.isArray(bindings)).toBe(true)
    expect(bindings!.some((b: { command?: string }) => b.command === 'dsh.newConversation')).toBe(true)

    const html = buildThinChatHtml()
    expect(html).toContain('id="newConversationBtn"')
    expect(html).toMatch(/id="newConversationBtn"[^>]*>[\s]*新建会话/)
  })
})

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

function evalBrowserMarkdown(source: string): { html: string; mode: string } {
  const ctx = createContext({ String })
  runInContext(`${safeMarkdownBrowserSource()}; this.__out = renderSafeMarkdown;`, ctx)
  const render = (ctx as { __out: (s: string) => { html: string; mode: string } }).__out
  return render(source)
}

async function waitFor(predicate: () => boolean, timeoutMs: number): Promise<void> {
  const start = Date.now()
  while (!predicate()) {
    if (Date.now() - start > timeoutMs) throw new Error('waitFor timeout')
    await new Promise(r => setTimeout(r, 10))
  }
}

