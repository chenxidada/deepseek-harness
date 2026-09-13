/**
 * Verifier-owned Layer A (RTL) — Phase 2 independent of implementer suite.
 * Intentional gaps vs editor-chat-phase2.spec.tsx:
 * - extra XSS vectors beyond <script>
 * - branch gated by turn absence; turn param variation
 * - edit-resend cancel + multi messageId payload variation
 * - delete modal cancel (no emit)
 * - chrome↔history search origin isolation / flip
 * - streaming → settle transition (no msg-md while streaming)
 * - stopping under waiting/error (no fifth composer state)
 * - history Continue emit path from ⋮ menu
 * - Q-6 re-verify: tab contextmenu cancel+confirm; overflow delete still works;
 *   inactive-tab contextmenu → ui/delete-request uses inactive sessionId (Should-Fix)
 */
// @vitest-environment jsdom

import { describe, expect, it, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, waitFor, act, within } from '@testing-library/react'
import { App } from '../../webview/src/App.tsx'
import { createMessageBridge } from '../../webview/src/bridge/message-bridge.ts'
import {
  applyHostFrame,
  resetChatUiState,
  setStopping,
} from '../../webview/src/store/chat-ui-store.ts'
import { mountDshProbes } from '../../webview/src/probes.ts'
import { containsUnsafeHtml } from '../../src/markdown/safe-markdown.ts'

describe('verifier Phase-2 Layer-A RTL (independent)', () => {
  const posts: unknown[] = []
  let bridge: ReturnType<typeof createMessageBridge>

  beforeEach(() => {
    cleanup()
    posts.length = 0
    resetChatUiState()
    mountDshProbes()
    bridge = createMessageBridge({
      postToHost: (msg) => {
        posts.push(msg)
      },
      onHostMessage: () => () => {},
    })
  })

  afterEach(() => {
    bridge.dispose()
    cleanup()
  })

  it('V-A1: settle MD sanitizes img-onerror + javascript: href (AC-21a; not only script)', async () => {
    render(<App bridge={bridge} />)
    await act(async () => {
      applyHostFrame({ type: 'panel/state', mode: 'live', sessionId: 's1', tabId: 't1' })
      applyHostFrame({
        type: 'messages/replace',
        sessionId: 's1',
        messages: [{
          id: 'a1',
          role: 'assistant',
          kind: 'text',
          sessionId: 's1',
          text: [
            '## Safe',
            '',
            '<img src=x onerror=alert(1)>',
            '',
            '[xss](javascript:alert(2))',
            '',
            '```ts',
            'const x = 1',
            '```',
          ].join('\n'),
        }],
      })
    })
    await waitFor(() => {
      expect(screen.getByTestId('msg-md')).toBeTruthy()
    })
    const html = screen.getByTestId('msg-md').innerHTML
    // Escaped as text is OK; must not be executable DOM (AC-21a).
    expect(containsUnsafeHtml(html)).toBe(false)
    expect(html).not.toMatch(/<img\b/i)
    expect(html).not.toMatch(/<[a-z][^>]*\sonerror\s*=/i)
    expect(html).not.toMatch(/<[a-z][^>]*\shref\s*=\s*["']?\s*javascript:/i)
    // Raw attack strings may appear only as escaped text content
    expect(html).toMatch(/&lt;img|onerror/)
    expect(screen.getByTestId('btn-copy')).toBeTruthy()
    await waitFor(() => {
      expect(document.querySelector('[data-testid="btn-copy-code"]')).toBeTruthy()
    })
  })

  it('V-A2: branch gated by turn; different turns emit different payloads (AC-35 param)', async () => {
    render(<App bridge={bridge} />)
    await act(async () => {
      applyHostFrame({ type: 'panel/state', mode: 'live', sessionId: 's1', tabId: 't1' })
      applyHostFrame({
        type: 'messages/replace',
        sessionId: 's1',
        messages: [
          {
            id: 'u-no-turn',
            role: 'user',
            kind: 'text',
            sessionId: 's1',
            text: 'no turn here',
          },
          {
            id: 'a-turn-3',
            role: 'assistant',
            kind: 'text',
            sessionId: 's1',
            text: 'turn three',
            turn: 3,
          },
          {
            id: 'a-turn-7',
            role: 'assistant',
            kind: 'text',
            sessionId: 's1',
            text: 'turn seven',
            turn: 7,
          },
        ],
      })
    })
    await waitFor(() => {
      expect(screen.getAllByTestId('msg').length).toBeGreaterThanOrEqual(3)
    })
    const noTurn = document.querySelector('[data-message-id="u-no-turn"]') as HTMLElement | null
    expect(noTurn).toBeTruthy()
    expect(within(noTurn!).queryByTestId('btn-branch')).toBeNull()

    const branches = screen.getAllByTestId('btn-branch')
    expect(branches.length).toBe(2)
    fireEvent.click(branches[0]!)
    fireEvent.click(branches[1]!)
    const turns = posts
      .filter(p => (p as { type?: string }).type === 'action/branch')
      .map(p => (p as { turn?: number }).turn)
    expect(turns).toEqual(expect.arrayContaining([3, 7]))
    expect(new Set(turns).size).toBe(2)
  })

  it('V-A3: edit-resend cancel emits nothing; two messageIds vary payload (AC-34a)', async () => {
    render(<App bridge={bridge} />)
    await act(async () => {
      applyHostFrame({ type: 'panel/state', mode: 'live', sessionId: 's1', tabId: 't1' })
      applyHostFrame({
        type: 'messages/replace',
        sessionId: 's1',
        messages: [
          {
            id: 'u-a',
            role: 'user',
            kind: 'text',
            sessionId: 's1',
            text: 'first',
            turn: 0,
          },
          {
            id: 'u-b',
            role: 'user',
            kind: 'text',
            sessionId: 's1',
            text: 'second',
            turn: 1,
          },
        ],
      })
    })
    await waitFor(() => {
      expect(screen.getAllByTestId('btn-edit-resend').length).toBe(2)
    })

    fireEvent.click(screen.getAllByTestId('btn-edit-resend')[0]!)
    await waitFor(() => expect(screen.getByTestId('edit-resend-form')).toBeTruthy())
    fireEvent.click(screen.getByTestId('btn-edit-resend-cancel'))
    await waitFor(() => expect(screen.queryByTestId('edit-resend-form')).toBeNull())
    expect(posts.some(p => (p as { type?: string }).type === 'action/edit-resend')).toBe(false)

    const payloads: Array<{ messageId?: string; text?: string }> = []
    for (const [idx, mid, text] of [
      [0, 'u-a', 'edited-a'],
      [1, 'u-b', 'edited-b'],
    ] as const) {
      fireEvent.click(screen.getAllByTestId('btn-edit-resend')[idx]!)
      await waitFor(() => expect(screen.getByTestId('edit-resend-form')).toBeTruthy())
      fireEvent.change(screen.getByTestId('edit-resend-input'), { target: { value: text } })
      fireEvent.click(screen.getByTestId('btn-edit-resend-confirm'))
      const hit = posts.find(p =>
        (p as { type?: string; messageId?: string }).type === 'action/edit-resend'
        && (p as { messageId?: string }).messageId === mid) as { messageId?: string; text?: string }
      expect(hit).toBeTruthy()
      expect(hit.text).toBe(text)
      payloads.push(hit)
    }
    expect(new Set(payloads.map(p => p.messageId)).size).toBe(2)
    expect(new Set(payloads.map(p => p.text)).size).toBe(2)
  })

  it('V-A4: delete modal cancel never emits ui/delete-request (AC-55/60)', async () => {
    render(<App bridge={bridge} />)
    await act(async () => {
      applyHostFrame({
        type: 'panel/history',
        open: true,
        loading: false,
        rows: [{
          sessionId: 'del-1',
          title: 'Doomed',
          updatedAt: '2026-09-13T00:00:00.000Z',
          previewOrPath: 'x',
        }],
      })
    })
    fireEvent.click(within(screen.getByTestId('history-row')).getByTestId('btn-history-more'))
    fireEvent.click(within(screen.getByTestId('history-row')).getByTestId('btn-history-delete'))
    await waitFor(() => expect(screen.getByTestId('delete-confirm-modal')).toBeTruthy())
    fireEvent.click(screen.getByTestId('btn-delete-cancel'))
    await waitFor(() => expect(screen.queryByTestId('delete-confirm-modal')).toBeNull())
    expect(posts.some(p => (p as { type?: string }).type === 'ui/delete-request')).toBe(false)
  })

  it('V-A5: chrome vs history search origin isolation / flip (AC-38/56)', async () => {
    render(<App bridge={bridge} />)
    fireEvent.click(screen.getByTestId('btn-search'))
    await waitFor(() => expect(screen.getByTestId('search-panel')).toBeTruthy())
    fireEvent.change(screen.getByTestId('search-input'), { target: { value: 'chrome-q' } })
    await act(async () => {
      applyHostFrame({
        type: 'search/results',
        text: 'chrome-q',
        hits: [{
          sessionId: 'chrome-hit',
          title: 'Chrome Hit',
          mtime: 1,
          matchTiers: [1],
          firstUserPreview: 'c',
        }],
      })
    })
    await waitFor(() => expect(screen.getByTestId('search-hit')).toBeTruthy())

    await act(async () => {
      applyHostFrame({
        type: 'panel/history',
        open: true,
        loading: false,
        rows: [{
          sessionId: 'local-hist',
          title: 'Local Hist',
          updatedAt: '2026-09-13T00:00:00.000Z',
          previewOrPath: 'p',
        }],
      })
    })
    fireEvent.change(screen.getByTestId('history-search'), { target: { value: 'hist-q' } })
    await act(async () => {
      applyHostFrame({
        type: 'search/results',
        text: 'hist-q',
        hits: [{
          sessionId: 'hist-hit',
          title: 'Hist Hit',
          mtime: 2,
          matchTiers: [2],
          firstUserPreview: 'h',
        }],
      })
    })
    await waitFor(() => {
      expect(screen.getByTestId('history-row').getAttribute('data-session-id')).toBe('hist-hit')
    })
    // History origin must not force / keep chrome panel as the consumer of hist hits
    // (chrome panel may still be open from earlier; hist hits must drive history-row)
    expect(screen.queryByText('Hist Hit')).toBeTruthy()
    const chromeHits = screen.queryAllByTestId('search-hit')
    // If chrome panel still open, its hits should remain chrome-hit — not overwritten by hist
    if (chromeHits.length > 0) {
      expect(chromeHits.some(el => el.textContent?.includes('Chrome Hit'))).toBe(true)
      expect(chromeHits.every(el => !el.textContent?.includes('Hist Hit'))).toBe(true)
    }
  })

  it('V-A6: streaming shows raw text without msg-md; settle promotes Markdown (AC-21/22)', async () => {
    render(<App bridge={bridge} />)
    await act(async () => {
      applyHostFrame({ type: 'panel/state', mode: 'live', sessionId: 's1', tabId: 't1' })
      applyHostFrame({
        type: 'messages/replace',
        sessionId: 's1',
        messages: [{
          id: 'a1',
          role: 'assistant',
          kind: 'text',
          sessionId: 's1',
          text: '## Streaming',
          streaming: true,
        }],
      })
      applyHostFrame({ type: 'status/set', status: 'generating', sessionId: 's1' })
    })
    await waitFor(() => {
      expect(screen.getByTestId('msg').getAttribute('data-streaming')).toBe('true')
    })
    expect(screen.queryByTestId('msg-md')).toBeNull()
    expect(screen.getByTestId('status').textContent).toMatch(/生成中/)

    await act(async () => {
      applyHostFrame({
        type: 'messages/replace',
        sessionId: 's1',
        messages: [{
          id: 'a1',
          role: 'assistant',
          kind: 'text',
          sessionId: 's1',
          text: '## Streaming\n\nDone.',
        }],
      })
      applyHostFrame({ type: 'status/set', status: 'idle', sessionId: 's1' })
    })
    await waitFor(() => {
      expect(screen.getByTestId('msg-md')).toBeTruthy()
      expect(screen.getByTestId('msg-md').innerHTML).toMatch(/<h2/i)
      expect(screen.getByTestId('msg').getAttribute('data-streaming')).toBe('false')
    })
  })

  it('V-A7: stopping under waiting/error never invents fifth composer state (AC-33b R7)', async () => {
    render(<App bridge={bridge} />)
    for (const mode of ['waiting-host', 'error'] as const) {
      await act(async () => {
        applyHostFrame({ type: 'panel/state', mode, sessionId: `s-${mode}`, tabId: `t-${mode}` })
        setStopping(true)
      })
      await waitFor(() => {
        expect(screen.getByTestId('status').textContent).toContain('正在停止')
      })
      const cs = screen.getByTestId('composer').getAttribute('data-composer-state')
      expect(['live', 'readonly', 'waiting', 'error']).toContain(cs)
      expect(cs).not.toBe('stopping')
      await act(async () => {
        setStopping(false)
      })
    }
  })

  it('V-A8: history Continue from ⋮ emits history-select (AC-54 path)', async () => {
    render(<App bridge={bridge} />)
    await act(async () => {
      applyHostFrame({
        type: 'panel/history',
        open: true,
        loading: false,
        rows: [{
          sessionId: 'cont-1',
          title: 'Continuable',
          updatedAt: '2026-09-13T00:00:00.000Z',
          previewOrPath: 'hi',
          continueHint: '可继续',
          parentTitle: 'Root',
        }],
      })
    })
    await waitFor(() => {
      expect(screen.getByTestId('history-parent').textContent).toContain('分支自 Root')
    })
    fireEvent.click(within(screen.getByTestId('history-row')).getByTestId('btn-history-more'))
    fireEvent.click(within(screen.getByTestId('history-row')).getByTestId('btn-continue'))
    expect(posts.some(p =>
      (p as { type?: string; sessionId?: string }).type === 'ui/history-select'
      && (p as { sessionId?: string }).sessionId === 'cont-1')).toBe(true)
  })

  it('V-A9: activity / ref / change emit real intents (AC-30–32 smoke)', async () => {
    render(<App bridge={bridge} />)
    await act(async () => {
      applyHostFrame({ type: 'panel/state', mode: 'live', sessionId: 's1', tabId: 't1' })
      applyHostFrame({
        type: 'messages/replace',
        sessionId: 's1',
        messages: [
          {
            id: 'u1',
            role: 'user',
            kind: 'text',
            sessionId: 's1',
            text: 'see @src/bar.ts',
          },
          {
            id: 'act1',
            role: 'notice',
            kind: 'activity',
            sessionId: 's1',
            text: 'Read',
            activity: {
              id: 'act1',
              status: 'done',
              expanded: false,
              toolName: 'Read',
              summary: 'Read',
            },
          },
          {
            id: 'ch1',
            role: 'assistant',
            kind: 'change-list',
            sessionId: 's1',
            text: 'changes',
            changeList: {
              turn: 0,
              sourceMessageId: 'a0',
              emptyNotice: false,
              changes: [{
                changeId: 'c9',
                path: 'b.ts',
                kind: 'modified',
                status: 'unreviewed',
                additions: 1,
                deletions: 0,
              }],
            },
          },
        ],
      })
    })
    await waitFor(() => {
      expect(screen.getByTestId('ref-card')).toBeTruthy()
      expect(screen.getByTestId('activity-row')).toBeTruthy()
      expect(screen.getByTestId('change-list')).toBeTruthy()
    })
    fireEvent.click(screen.getByTestId('activity-toggle'))
    fireEvent.click(screen.getByTestId('ref-card'))
    expect(posts.some(p => (p as { type?: string }).type === 'action/toggle-activity')).toBe(true)
    expect(posts.some(p => (p as { type?: string }).type === 'action/open-reference')).toBe(true)
  })

  it('V-A10 Q-6: tab contextmenu → modal cancel then confirm (AC-13c/60; independent)', async () => {
    render(<App bridge={bridge} />)
    await act(async () => {
      applyHostFrame({
        type: 'panel/state',
        mode: 'live',
        sessionId: 'vfy-active',
        tabId: 't-active',
        title: 'Active Vfy',
      })
      applyHostFrame({
        type: 'panel/tabs',
        activeTabId: 't-active',
        tabs: [{
          tabId: 't-active',
          title: 'Active Vfy',
          status: 'idle',
          unread: false,
          approvalBadge: false,
          mode: 'live',
          sessionId: 'vfy-active',
        }],
      })
    })
    await waitFor(() => expect(screen.getByTestId('tab-item')).toBeTruthy())

    fireEvent.contextMenu(screen.getByTestId('tab-item'))
    await waitFor(() => {
      expect(screen.getByTestId('tab-context-menu')).toBeTruthy()
      expect(screen.getByTestId('menu-tab-delete-session')).toBeTruthy()
    })
    fireEvent.click(screen.getByTestId('menu-tab-delete-session'))
    await waitFor(() => {
      expect(screen.getByTestId('delete-confirm-modal')).toBeTruthy()
      expect(screen.getByTestId('delete-confirm-copy').textContent).toMatch(/不可恢复/)
    })
    fireEvent.click(screen.getByTestId('btn-delete-cancel'))
    await waitFor(() => expect(screen.queryByTestId('delete-confirm-modal')).toBeNull())
    expect(posts.some(p => (p as { type?: string }).type === 'ui/delete-request')).toBe(false)

    fireEvent.contextMenu(screen.getByTestId('tab-item'))
    await waitFor(() => expect(screen.getByTestId('menu-tab-delete-session')).toBeTruthy())
    fireEvent.click(screen.getByTestId('menu-tab-delete-session'))
    await waitFor(() => expect(screen.getByTestId('delete-confirm-modal')).toBeTruthy())
    fireEvent.click(screen.getByTestId('btn-delete-confirm'))
    expect(posts.some(p =>
      (p as { type?: string; sessionId?: string }).type === 'ui/delete-request'
      && (p as { sessionId?: string }).sessionId === 'vfy-active')).toBe(true)
  })

  it('V-A11 Q-6 regression: overflow delete still shares DeleteConfirmModal (AC-14b)', async () => {
    render(<App bridge={bridge} />)
    await act(async () => {
      applyHostFrame({
        type: 'panel/state',
        mode: 'live',
        sessionId: 'vfy-overflow',
        tabId: 't-ov',
        title: 'Overflow Tab',
      })
    })
    fireEvent.click(screen.getByTestId('btn-overflow'))
    await waitFor(() => {
      expect(screen.getByTestId('overflow-menu')).toBeTruthy()
      expect(screen.getByTestId('menu-delete-session')).toBeTruthy()
      expect(screen.getByTestId('menu-open-timeline')).toBeTruthy()
    })
    fireEvent.click(screen.getByTestId('menu-delete-session'))
    await waitFor(() => {
      expect(screen.getByTestId('delete-confirm-modal')).toBeTruthy()
      expect(screen.getByTestId('delete-confirm-copy').textContent).toMatch(/不可恢复/)
    })
    fireEvent.click(screen.getByTestId('btn-delete-confirm'))
    expect(posts.some(p =>
      (p as { type?: string; sessionId?: string }).type === 'ui/delete-request'
      && (p as { sessionId?: string }).sessionId === 'vfy-overflow')).toBe(true)
  })

  it('V-A12 Q-6 Should-Fix: inactive tab contextmenu delete uses inactive sessionId', async () => {
    render(<App bridge={bridge} />)
    await act(async () => {
      applyHostFrame({
        type: 'panel/state',
        mode: 'live',
        sessionId: 'sess-active',
        tabId: 'tab-active',
        title: 'Active',
      })
      applyHostFrame({
        type: 'panel/tabs',
        activeTabId: 'tab-active',
        tabs: [
          {
            tabId: 'tab-active',
            title: 'Active',
            status: 'idle',
            unread: false,
            approvalBadge: false,
            mode: 'live',
            sessionId: 'sess-active',
          },
          {
            tabId: 'tab-idle',
            title: 'Idle Other',
            status: 'idle',
            unread: true,
            approvalBadge: false,
            mode: 'live',
            sessionId: 'sess-inactive',
          },
        ],
      })
    })
    await waitFor(() => {
      expect(screen.getAllByTestId('tab-item').length).toBe(2)
    })
    const inactive = screen.getAllByTestId('tab-item').find(
      el => el.getAttribute('data-tab-id') === 'tab-idle',
    )
    expect(inactive).toBeTruthy()
    expect(inactive!.getAttribute('data-active')).toBe('false')
    expect(inactive!.getAttribute('data-session-id')).toBe('sess-inactive')

    fireEvent.contextMenu(inactive!)
    await waitFor(() => {
      expect(screen.getByTestId('tab-context-menu')).toBeTruthy()
      expect(screen.getByTestId('menu-tab-delete-session')).toBeTruthy()
    })
    fireEvent.click(screen.getByTestId('menu-tab-delete-session'))
    await waitFor(() => {
      expect(screen.getByTestId('delete-confirm-modal')).toBeTruthy()
      expect(screen.getByTestId('delete-confirm-copy').textContent).toMatch(/不可恢复/)
    })
    // Cancel first — must not emit, and must not accidentally target active
    fireEvent.click(screen.getByTestId('btn-delete-cancel'))
    await waitFor(() => expect(screen.queryByTestId('delete-confirm-modal')).toBeNull())
    expect(posts.some(p => (p as { type?: string }).type === 'ui/delete-request')).toBe(false)

    fireEvent.contextMenu(inactive!)
    await waitFor(() => expect(screen.getByTestId('menu-tab-delete-session')).toBeTruthy())
    fireEvent.click(screen.getByTestId('menu-tab-delete-session'))
    await waitFor(() => expect(screen.getByTestId('delete-confirm-modal')).toBeTruthy())
    fireEvent.click(screen.getByTestId('btn-delete-confirm'))

    const deletes = posts.filter(p =>
      (p as { type?: string }).type === 'ui/delete-request') as Array<{ sessionId?: string }>
    expect(deletes.length).toBe(1)
    expect(deletes[0]!.sessionId).toBe('sess-inactive')
    expect(deletes[0]!.sessionId).not.toBe('sess-active')
  })
})
