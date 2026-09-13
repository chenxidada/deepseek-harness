/**
 * Verifier-owned independent scenarios for phase-4-refs-changes-diff.
 * Does NOT rubber-stamp implementer suites — new cases:
 * - Host E2E: change/open-native-diff → requestChangeOpenNativeDiff (AC-43)
 * - Host E2E: change/get-diff → change/diff-content → fillChangeDiffPane (AC-43)
 * - Parameter variation: extract/segment/composer cards change with inputs (stub-aware)
 * - Negative co-group: different data-turn must NOT merge (AC-42)
 * - Unavailable inline diff fail-closed (AC-43)
 * - Product HTML embeds extracts + open-native-diff symbols (DEBT-CUX-001 / R5)
 * - Browser mirror extractAtPathTokens agrees with Host on multi-token fixtures (AC-41)
 */
// @vitest-environment jsdom

import { describe, expect, it, beforeEach } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { ConversationController } from '../../../../../../apps/vscode-dsh/src/conversation-controller.ts'
import {
  ChatPanelHost,
  FakeWebviewPort,
} from '../../../../../../apps/vscode-dsh/src/chat-panel/index.ts'
import { buildThinChatHtml } from '../../../../../../apps/vscode-dsh/src/chat-panel/chat-panel-provider.ts'
import { extractAtPathTokens, atPathExtractBrowserSource } from '../../../../../../apps/vscode-dsh/src/code-context/at-path.ts'
import {
  fillChangeDiffPane,
  mountChangeDiffMessage,
  renderChangeListBubble,
} from '../../../../../../apps/vscode-dsh/src/chat-panel/render/change-diff-dom.ts'
import {
  fillUserBubbleWithRefCards,
  segmentTextWithRefs,
  syncComposerRefCards,
} from '../../../../../../apps/vscode-dsh/src/chat-panel/render/ref-cards.ts'
import { mountActivityMessage } from '../../../../../../apps/vscode-dsh/src/chat-panel/render/activity-dom.ts'
import {
  openChangeSnapshotDiff,
  resetDiffProviderForTests,
  type DiffVsCodeLike,
} from '../../../../../../apps/vscode-dsh/src/diff-entry.ts'
import type { IdeSessionHost } from '../../../../../../apps/vscode-dsh/src/session-host.ts'
import type { HarnessNotification } from '@deepseek-ai/dsh-sdk-client'

type NotificationListener = (notification: HarnessNotification) => void

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = join(HERE, '../../../../../../')

function createEmitHost() {
  const listeners = new Set<NotificationListener>()
  const host = {
    status: 'connected' as const,
    interactions: {
      failClosedSession() {},
      listPending() { return [] },
      onChange() { return () => {} },
    },
    setConversationRegistry() {},
    onNotification(listener: NotificationListener) {
      listeners.add(listener)
      return () => { listeners.delete(listener) }
    },
    onStatusChange() { return () => {} },
    async prompt() { return 'msg' },
    async disposeSession() {},
    async cancelSession() {},
    emit(notification: HarnessNotification) {
      for (const listener of listeners) listener(notification)
    },
  }
  return host as unknown as IdeSessionHost
}

describe('verifier independent - phase-4 refs / changes / diff', () => {
  let messages: HTMLElement
  let composerCards: HTMLElement

  beforeEach(() => {
    document.body.innerHTML = ''
    messages = document.createElement('div')
    messages.id = 'messages'
    document.body.appendChild(messages)
    composerCards = document.createElement('div')
    composerCards.id = 'composer-ref-cards'
    document.body.appendChild(composerCards)
  })

  it('AC-43 Host E2E: change/open-native-diff invokes requestChangeOpenNativeDiff', async () => {
    const called: string[] = []
    const controller = new ConversationController(createEmitHost())
    controller.newConversation('live')
    const panel = new ChatPanelHost({
      registry: controller.registry,
      messages: controller.messages,
      isHostReady: () => true,
      acceptSend: (text) => controller.promptActive(text),
      requestChangeOpenNativeDiff: async (changeId) => {
        called.push(changeId)
      },
    })
    const fake = new FakeWebviewPort()
    panel.attach(fake)

    await panel.handleWebviewMessage({ type: 'change/open-native-diff', changeId: 'chg-native-42' })
    expect(called).toEqual(['chg-native-42'])

    // Parameter variation — second distinct id must not collapse to first.
    await panel.handleWebviewMessage({ type: 'change/open-native-diff', changeId: 'chg-native-99' })
    expect(called).toEqual(['chg-native-42', 'chg-native-99'])
  })

  it('AC-43 Host E2E: change/get-diff → change/diff-content → fillChangeDiffPane', async () => {
    const controller = new ConversationController(createEmitHost())
    controller.newConversation('live')
    const panel = new ChatPanelHost({
      registry: controller.registry,
      messages: controller.messages,
      isHostReady: () => true,
      acceptSend: (text) => controller.promptActive(text),
      requestChangeDiff: async (changeId) => ({
        changeId,
        available: true,
        oldText: `OLD:${changeId}`,
        newText: `NEW:${changeId}`,
      }),
    })
    const fake = new FakeWebviewPort()
    panel.attach(fake)
    panel.clearOutboundLog()
    fake.receivedFromHost.length = 0

    await panel.handleWebviewMessage({ type: 'change/get-diff', changeId: 'chg-inline-7' })
    const content = fake.receivedFromHost.find(m => m.type === 'change/diff-content')
    expect(content).toMatchObject({
      type: 'change/diff-content',
      changeId: 'chg-inline-7',
      available: true,
      oldText: 'OLD:chg-inline-7',
      newText: 'NEW:chg-inline-7',
    })

    const pane = document.createElement('div')
    pane.setAttribute('data-testid', 'change-diff-pane')
    fillChangeDiffPane(pane, {
      available: true,
      oldText: (content as { oldText?: string }).oldText ?? null,
      newText: (content as { newText?: string }).newText ?? '',
    })
    expect(pane.textContent).toContain('OLD:chg-inline-7')
    expect(pane.textContent).toContain('NEW:chg-inline-7')
    expect(pane.textContent).toContain('--- before ---')
  })

  it('AC-43 unavailable get-diff fail-closed posts available:false; pane shows notice', async () => {
    const controller = new ConversationController(createEmitHost())
    controller.newConversation('live')
    const panel = new ChatPanelHost({
      registry: controller.registry,
      messages: controller.messages,
      isHostReady: () => true,
      acceptSend: (text) => controller.promptActive(text),
      // Intentionally omit requestChangeDiff → Host fail-closed path
    })
    const fake = new FakeWebviewPort()
    panel.attach(fake)
    fake.receivedFromHost.length = 0

    await panel.handleWebviewMessage({ type: 'change/get-diff', changeId: 'missing' })
    const content = fake.receivedFromHost.find(m => m.type === 'change/diff-content')
    expect(content).toMatchObject({
      type: 'change/diff-content',
      changeId: 'missing',
      available: false,
    })

    const pane = document.createElement('div')
    fillChangeDiffPane(pane, { available: false, reason: 'no-snapshot' })
    expect(pane.textContent || '').not.toContain('--- before ---')
    expect((pane.textContent || '').length).toBeGreaterThan(0)
  })

  it('AC-40/41 stub-aware: composer + segment outputs vary with distinct @ inputs', () => {
    const a = 'review @src/a.ts'
    const b = 'see @"my file.ts" and @pkg/b.ts'
    syncComposerRefCards(composerCards, a)
    const pathsA = [...composerCards.querySelectorAll('[data-testid="ref-card"]')]
      .map(el => el.getAttribute('data-ref-path'))
    syncComposerRefCards(composerCards, b)
    const pathsB = [...composerCards.querySelectorAll('[data-testid="ref-card"]')]
      .map(el => el.getAttribute('data-ref-path'))

    expect(pathsA).toEqual(['src/a.ts'])
    expect(pathsB).toEqual(['my file.ts', 'pkg/b.ts'])
    expect(pathsA).not.toEqual(pathsB)

    const segsA = segmentTextWithRefs(a).filter(s => s.kind === 'ref')
    const segsB = segmentTextWithRefs(b).filter(s => s.kind === 'ref')
    expect(segsA).toHaveLength(1)
    expect(segsB).toHaveLength(2)
    expect(extractAtPathTokens(a).map(t => t.path)).toEqual(pathsA)
    expect(extractAtPathTokens(b).map(t => t.path)).toEqual(pathsB)

    const bubble = document.createElement('div')
    fillUserBubbleWithRefCards(bubble, b)
    expect(bubble.querySelectorAll('[data-testid="ref-card"]').length).toBe(2)
  })

  it('AC-41 browser mirror extract agrees with Host TS on multi-token fixture', () => {
    const fixture = 'please fix @apps/x.ts and @"spaced name.ts" thanks'
    const host = extractAtPathTokens(fixture)
    // Evaluate embedded browser source in isolation.
    const src = atPathExtractBrowserSource()
    // eslint-disable-next-line no-new-func
    const fn = new Function(`${src}; return extractAtPathTokens;`) as () => (text: string) => Array<{
      path: string
      index: number
      quoted: boolean
      token: string
    }>
    const browserExtract = fn()
    const browser = browserExtract(fixture)
    expect(browser.map(t => t.path)).toEqual(host.map(t => t.path))
    expect(browser.map(t => t.index)).toEqual(host.map(t => t.index))
    expect(browser.map(t => t.quoted)).toEqual(host.map(t => t.quoted))
  })

  it('AC-42 negative: different data-turn must not co-group', () => {
    mountActivityMessage(messages, {
      id: 'act-3',
      role: 'notice',
      kind: 'activity',
      turn: 3,
      activity: {
        id: 'act-3',
        sessionId: 's',
        turn: 3,
        ordinal: 0,
        toolName: 'Edit',
        callId: 'c3',
        status: 'done',
        expanded: false,
        summary: 'Edit',
      },
    })
    mountChangeDiffMessage(messages, {
      id: 'cl-4',
      role: 'notice',
      kind: 'change-list',
      turn: 4,
      text: '本回合改了 1 个文件',
      changeList: {
        turn: 4,
        sourceMessageId: 'a4',
        emptyNotice: false,
        changes: [{
          changeId: 'chg-4',
          path: 'y.ts',
          kind: 'modified',
          status: 'unreviewed',
          additions: 1,
          deletions: 0,
        }],
      },
    })
    expect(messages.querySelectorAll('[data-turn="3"]').length).toBe(1)
    expect(messages.querySelectorAll('[data-turn="4"]').length).toBe(1)
    expect(messages.querySelector('[data-kind="activity"][data-turn="4"]')).toBeNull()
    expect(messages.querySelector('[data-kind="change-list"][data-turn="3"]')).toBeNull()
  })

  it('AC-43 DOM: expand default inline path + native button coexist; openChangeSnapshotDiff → vscode.diff', async () => {
    const posted: Record<string, unknown>[] = []
    const el = renderChangeListBubble(document, {
      id: 'cl-v',
      role: 'notice',
      kind: 'change-list',
      turn: 1,
      text: 'changes',
      changeList: {
        turn: 1,
        sourceMessageId: 'a1',
        emptyNotice: false,
        changes: [{
          changeId: 'chg-v',
          path: 'z.ts',
          kind: 'modified',
          status: 'unreviewed',
          additions: 3,
          deletions: 1,
        }],
      },
    }, (m) => { posted.push(m) })
    messages.appendChild(el)

    const expand = el.querySelector('[data-testid="change-list-expand"]') as HTMLButtonElement
    const native = el.querySelector('[data-testid="change-list-open-native-diff"]') as HTMLButtonElement
    expand.click()
    expect(posted.filter(m => m.type === 'change/get-diff')).toHaveLength(1)
    native.click()
    expect(posted.filter(m => m.type === 'change/open-native-diff')).toHaveLength(1)

    resetDiffProviderForTests()
    const commands: unknown[][] = []
    const vscode: DiffVsCodeLike = {
      Uri: {
        parse: (value: string) => ({ scheme: 'dsh-diff', path: value, toString: () => value }),
        file: (path: string) => ({ scheme: 'file', path, toString: () => `file://${path}` }),
      },
      workspace: { registerTextDocumentContentProvider: () => ({ dispose() {} }) },
      commands: {
        executeCommand: async (command: string, ...args: unknown[]) => {
          commands.push([command, ...args])
          return undefined
        },
      },
    }
    await openChangeSnapshotDiff(vscode, {
      path: 'z.ts',
      oldText: 'before-z',
      newText: 'after-z',
      changeId: 'chg-v',
    })
    expect(commands[0]?.[0]).toBe('vscode.diff')
  })

  it('product HTML embeds at-path + ref-cards + change-diff extracts (DEBT-CUX-001 / R5)', () => {
    const html = buildThinChatHtml()
    expect(html).toContain('function extractAtPathTokens')
    expect(html).toContain('function syncComposerRefCards')
    expect(html).toContain('function fillUserBubbleWithRefCards')
    expect(html).toContain('function renderChangeListBubble')
    expect(html).toContain('function fillChangeDiffPane')
    expect(html).toContain('change/open-native-diff')
    expect(html).toContain('composer-ref-cards')
    expect(html).toContain('change-list-open-native-diff')

    // Source-level: change-diff-dom and ref-cards modules exist on disk.
    const changeDiff = readFileSync(
      join(REPO_ROOT, 'apps/vscode-dsh/src/chat-panel/render/change-diff-dom.ts'),
      'utf8',
    )
    const refCards = readFileSync(
      join(REPO_ROOT, 'apps/vscode-dsh/src/chat-panel/render/ref-cards.ts'),
      'utf8',
    )
    const provider = readFileSync(
      join(REPO_ROOT, 'apps/vscode-dsh/src/chat-panel/chat-panel-provider.ts'),
      'utf8',
    )
    expect(changeDiff).toContain('export function changeDiffDomBrowserSource')
    expect(refCards).toContain('export function refCardsBrowserSource')
    expect(refCards).toContain('extractAtPathTokens')
    // Provider must not re-declare a local extractAtPathTokens (would be a third grammar).
    expect(provider).not.toMatch(/function extractAtPathTokens\s*\(/)
  })
})
