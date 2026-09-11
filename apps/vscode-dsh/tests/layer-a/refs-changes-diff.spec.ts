/**
 * Layer A — ref-cards / shared @ parse / change-diff / T8 (phase-4).
 * @vitest-environment jsdom
 */

import { describe, expect, it, beforeEach } from 'vitest'
import { extractAtPathTokens } from '../../src/code-context/at-path.ts'
import { buildThinChatHtml } from '../../src/chat-panel/chat-panel-provider.ts'
import { parseWebviewToHostMessage } from '../../src/chat-panel/protocol.ts'
import { mountActivityMessage } from '../../src/chat-panel/render/activity-dom.ts'
import {
  fillChangeDiffPane,
  mountChangeDiffMessage,
  renderChangeListBubble,
} from '../../src/chat-panel/render/change-diff-dom.ts'
import {
  fillUserBubbleWithRefCards,
  segmentTextWithRefs,
  syncComposerRefCards,
} from '../../src/chat-panel/render/ref-cards.ts'

describe('layer-A refs / changes / diff (AC-40/41/42/43)', () => {
  let messages: HTMLElement
  let composerCards: HTMLElement

  beforeEach(() => {
    document.body.innerHTML = ''
    messages = document.createElement('div')
    messages.id = 'messages'
    document.body.appendChild(messages)
    composerCards = document.createElement('div')
    composerCards.id = 'composer-ref-cards'
    composerCards.setAttribute('data-testid', 'composer-ref-cards')
    document.body.appendChild(composerCards)
  })

  it('AC-40: composer @path fixture yields ref-card nodes', () => {
    syncComposerRefCards(composerCards, 'Please review @src/a.ts and @"my file.ts"')
    const cards = composerCards.querySelectorAll('[data-testid="ref-card"]')
    expect(cards.length).toBe(2)
    expect(cards[0]?.getAttribute('data-ref-path')).toBe('src/a.ts')
    expect(cards[1]?.getAttribute('data-ref-path')).toBe('my file.ts')
    expect(composerCards.getAttribute('data-ref-count')).toBe('2')
    expect(composerCards.hidden).toBe(false)
  })

  it('AC-41: composer / sent / replay share extractAtPathTokens path', () => {
    const text = 'see @pkg/foo.ts please'
    const hostTokens = extractAtPathTokens(text)
    const segs = segmentTextWithRefs(text)
    const refs = segs.filter(s => s.kind === 'ref')
    expect(hostTokens).toHaveLength(1)
    expect(refs).toHaveLength(1)
    expect(refs[0]?.kind === 'ref' && refs[0].token.path).toBe(hostTokens[0]?.path)
    expect(refs[0]?.kind === 'ref' && refs[0].token.index).toBe(hostTokens[0]?.index)

    const bubble = document.createElement('div')
    fillUserBubbleWithRefCards(bubble, text)
    expect(bubble.querySelector('[data-testid="ref-card"]')?.getAttribute('data-ref-path'))
      .toBe('pkg/foo.ts')

    // Replay = same fill helper (no second grammar).
    const replay = document.createElement('div')
    fillUserBubbleWithRefCards(replay, text)
    expect(replay.querySelectorAll('[data-testid="ref-card"]').length).toBe(1)

    const html = buildThinChatHtml()
    expect(html).toContain('function extractAtPathTokens')
    expect(html).toContain('function renderChangeListBubble')
    expect(html).toContain('composer-ref-cards')
    // Provider must not keep a third local @ regex for cards.
    expect(html).not.toMatch(/function renderUserTextWithRefCards[\s\S]*?\/\(\?:/)
  })

  it('AC-42: change-list data-turn matches activity co-group', () => {
    mountActivityMessage(messages, {
      id: 'act-1',
      role: 'notice',
      kind: 'activity',
      turn: 4,
      activity: {
        id: 'act-1',
        sessionId: 's',
        turn: 4,
        ordinal: 0,
        toolName: 'Edit',
        callId: 'c1',
        status: 'done',
        expanded: false,
        summary: 'Edit',
      },
    })
    mountChangeDiffMessage(messages, {
      id: 'cl-1',
      role: 'notice',
      kind: 'change-list',
      turn: 4,
      text: '本回合改了 1 个文件',
      changeList: {
        turn: 4,
        sourceMessageId: 'a1',
        emptyNotice: false,
        changes: [{
          changeId: 'chg-1',
          path: 'src/a.ts',
          kind: 'modified',
          status: 'unreviewed',
          additions: 1,
          deletions: 0,
        }],
      },
    })
    const group = messages.querySelectorAll('[data-turn="4"]')
    expect(group.length).toBe(2)
    expect(messages.querySelector('[data-kind="change-list"][data-turn="4"]')).toBeTruthy()
    expect(messages.querySelector('[data-kind="activity"][data-turn="4"]')).toBeTruthy()
  })

  it('AC-43: expand posts change/get-diff; native button posts change/open-native-diff', () => {
    const posted: Record<string, unknown>[] = []
    const el = renderChangeListBubble(document, {
      id: 'cl-1',
      role: 'notice',
      kind: 'change-list',
      turn: 1,
      text: 'changes',
      changeList: {
        turn: 1,
        sourceMessageId: 'a1',
        emptyNotice: false,
        changes: [{
          changeId: 'chg-9',
          path: 'x.ts',
          kind: 'modified',
          status: 'unreviewed',
          additions: 2,
          deletions: 1,
        }],
      },
    }, (m) => { posted.push(m) })
    messages.appendChild(el)

    const expand = el.querySelector('[data-testid="change-list-expand"]') as HTMLButtonElement
    const native = el.querySelector('[data-testid="change-list-open-native-diff"]') as HTMLButtonElement
    const pane = el.querySelector('[data-testid="change-diff-pane"]') as HTMLElement
    expect(expand).toBeTruthy()
    expect(native).toBeTruthy()
    expect(pane.hidden).toBe(true)

    expand.click()
    expect(pane.hidden).toBe(false)
    expect(posted.some(m => m.type === 'change/get-diff' && m.changeId === 'chg-9')).toBe(true)

    fillChangeDiffPane(pane, {
      available: true,
      oldText: 'a',
      newText: 'b',
    })
    expect(pane.textContent).toContain('--- before ---')
    expect(pane.textContent).toContain('a')
    expect(pane.textContent).toContain('--- after ---')
    expect(pane.textContent).toContain('b')

    native.click()
    expect(posted.some(m => m.type === 'change/open-native-diff' && m.changeId === 'chg-9')).toBe(true)

    const parsed = parseWebviewToHostMessage({ type: 'change/open-native-diff', changeId: 'chg-9' })
    expect(parsed).toEqual({ type: 'change/open-native-diff', changeId: 'chg-9' })
  })
})
