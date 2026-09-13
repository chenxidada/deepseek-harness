/**
 * Layer A (React Testing Library) — Phase 2 Editor Chat DOM contract.
 * Feature UI PASS evidence for vscode-dsh-editor-chat-panel Phase 2 (AD-ECP-10).
 * Do NOT treat legacy buildThinChatHtml layer-a suites as this feature's UI PASS.
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

describe('layer-A RTL editor chat phase-2 (stream / capabilities / history)', () => {
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

  it('settles assistant Markdown with sanitize + visible copy (AC-21/21a / UI-AC-23)', async () => {
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
          text: '# Hello\n\n```js\nconsole.log(1)\n```\n\n<script>alert(1)</script>',
        }],
      })
    })
    await waitFor(() => {
      expect(screen.getByTestId('msg-md')).toBeTruthy()
    })
    const md = screen.getByTestId('msg-md')
    expect(md.innerHTML).toMatch(/<h1/i)
    expect(md.innerHTML).not.toMatch(/<script/i)
    expect(screen.getByTestId('btn-copy')).toBeTruthy()
    await waitFor(() => {
      expect(document.querySelector('[data-testid="btn-copy-code"]')).toBeTruthy()
    })
    fireEvent.click(screen.getByTestId('btn-copy'))
    expect(posts.some(p => (p as { type?: string }).type === 'action/copy-message')).toBe(true)
  })

  it('renders activity-row / ref-card / change-list DOM contracts', async () => {
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
            text: 'see @src/foo.ts please',
          },
          {
            id: 'act1',
            role: 'notice',
            kind: 'activity',
            sessionId: 's1',
            text: 'Bash',
            activity: {
              id: 'act1',
              status: 'running',
              expanded: false,
              toolName: 'Bash',
              summary: 'Bash',
            },
          },
          {
            id: 'ch1',
            role: 'assistant',
            kind: 'change-list',
            sessionId: 's1',
            text: '本回合变更',
            changeList: {
              turn: 1,
              sourceMessageId: 'a0',
              emptyNotice: false,
              changes: [{
                changeId: 'c1',
                path: 'a.ts',
                kind: 'modified',
                status: 'unreviewed',
                additions: 2,
                deletions: 1,
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
      expect(screen.getByTestId('change-list-item')).toBeTruthy()
    })
    fireEvent.click(screen.getByTestId('activity-toggle'))
    expect(posts.some(p => (p as { type?: string }).type === 'action/toggle-activity')).toBe(true)
  })

  it('composer four states + Stop / stopping DOM (AC-33 / 33b / R7)', async () => {
    render(<App bridge={bridge} />)
    await act(async () => {
      applyHostFrame({ type: 'panel/state', mode: 'live', sessionId: 's1', tabId: 't1' })
    })
    expect(screen.getByTestId('composer').getAttribute('data-composer-state')).toBe('live')

    await act(async () => {
      applyHostFrame({ type: 'status/set', status: 'generating', sessionId: 's1' })
    })
    await waitFor(() => {
      expect(screen.getByTestId('btn-stop')).toBeTruthy()
      expect(screen.getByTestId('status').textContent).toMatch(/生成中/)
    })
    fireEvent.click(screen.getByTestId('btn-stop'))
    expect(posts.some(p => (p as { type?: string }).type === 'action/stop')).toBe(true)
    await waitFor(() => {
      expect(screen.getByTestId('btn-stop').hasAttribute('disabled')).toBe(true)
      expect(screen.getByTestId('status').textContent).toContain('正在停止')
      // R7: composer state stays one of four — not a fifth "stopping"
      expect(screen.getByTestId('composer').getAttribute('data-composer-state')).toBe('live')
    })

    await act(async () => {
      applyHostFrame({ type: 'panel/state', mode: 'replay', sessionId: 's1', tabId: 't1' })
    })
    await waitFor(() => {
      expect(screen.getByTestId('composer').getAttribute('data-composer-state')).toBe('readonly')
      expect(screen.getByTestId('composer-disabled-reason').textContent).toMatch(/只读/)
    })

    await act(async () => {
      applyHostFrame({ type: 'panel/state', mode: 'error', sessionId: 's1', tabId: 't1' })
    })
    await waitFor(() => {
      expect(screen.getByTestId('composer').getAttribute('data-composer-state')).toBe('error')
    })
  })

  it('in-panel search tier 1+2 (not QuickPick-only) (AC-38 / GAP-003)', async () => {
    render(<App bridge={bridge} />)
    fireEvent.click(screen.getByTestId('btn-search'))
    await waitFor(() => {
      expect(screen.getByTestId('search-panel')).toBeTruthy()
      expect(screen.getByTestId('search-input')).toBeTruthy()
    })
    fireEvent.change(screen.getByTestId('search-input'), { target: { value: 'alpha' } })
    expect(posts.some(p =>
      (p as { type?: string; text?: string }).type === 'action/search-sessions'
      && (p as { text?: string }).text === 'alpha')).toBe(true)

    await act(async () => {
      applyHostFrame({
        type: 'search/results',
        text: 'alpha',
        hits: [{
          sessionId: 's-hit',
          title: 'Alpha chat',
          mtime: 1,
          matchTiers: [1],
          matchField: 'title',
          firstUserPreview: 'hello',
        }],
      })
    })
    await waitFor(() => {
      expect(screen.getByTestId('search-hit')).toBeTruthy()
    })
    fireEvent.click(screen.getByTestId('search-hit'))
    expect(posts.some(p =>
      (p as { type?: string; sessionId?: string }).type === 'action/open-search-hit'
      && (p as { sessionId?: string }).sessionId === 's-hit')).toBe(true)
    // Must not open QuickPick path for in-panel search typing
    expect(posts.some(p => (p as { type?: string }).type === 'ui/search-open')).toBe(false)
  })

  it('history Continue / delete modal / parent lineage (AC-53–57/60)', async () => {
    render(<App bridge={bridge} />)
    await act(async () => {
      applyHostFrame({
        type: 'panel/history',
        open: true,
        loading: false,
        rows: [{
          sessionId: 'child-1',
          title: 'Forked',
          updatedAt: '2026-09-13T00:00:00.000Z',
          previewOrPath: 'hi',
          parentTitle: 'Parent Chat',
          continueHint: '可继续',
        }],
      })
    })
    await waitFor(() => {
      expect(screen.getByTestId('history-parent').textContent).toContain('分支自 Parent Chat')
      expect(within(screen.getByTestId('history-row')).getByTestId('btn-history-more')).toBeTruthy()
    })

    fireEvent.click(within(screen.getByTestId('history-row')).getByTestId('btn-history-more'))
    await waitFor(() => {
      expect(within(screen.getByTestId('history-row')).getByTestId('btn-continue')).toBeTruthy()
      expect(within(screen.getByTestId('history-row')).getByTestId('btn-history-delete')).toBeTruthy()
    })
    fireEvent.click(within(screen.getByTestId('history-row')).getByTestId('btn-history-delete'))
    await waitFor(() => {
      expect(screen.getByTestId('delete-confirm-modal')).toBeTruthy()
      expect(screen.getByTestId('delete-confirm-copy').textContent).toMatch(/不可恢复/)
    })
    fireEvent.click(screen.getByTestId('btn-delete-confirm'))
    expect(posts.some(p =>
      (p as { type?: string; sessionId?: string }).type === 'ui/delete-request'
      && (p as { sessionId?: string }).sessionId === 'child-1')).toBe(true)
  })

  it('overflow menu: delete session + open Timeline (AC-14b / AC-44)', async () => {
    render(<App bridge={bridge} />)
    await act(async () => {
      applyHostFrame({
        type: 'panel/state',
        mode: 'live',
        sessionId: 's-active',
        tabId: 't1',
        title: 'Active',
      })
    })
    fireEvent.click(screen.getByTestId('btn-overflow'))
    await waitFor(() => {
      expect(screen.getByTestId('overflow-menu')).toBeTruthy()
      expect(screen.getByTestId('menu-delete-session')).toBeTruthy()
      expect(screen.getByTestId('menu-open-timeline')).toBeTruthy()
    })
    fireEvent.click(screen.getByTestId('menu-open-timeline'))
    expect(posts.some(p => (p as { type?: string }).type === 'ui/open-timeline')).toBe(true)

    fireEvent.click(screen.getByTestId('btn-overflow'))
    fireEvent.click(screen.getByTestId('menu-delete-session'))
    await waitFor(() => {
      expect(screen.getByTestId('delete-confirm-modal')).toBeTruthy()
    })
    fireEvent.click(screen.getByTestId('btn-delete-confirm'))
    expect(posts.some(p =>
      (p as { type?: string; sessionId?: string }).type === 'ui/delete-request'
      && (p as { sessionId?: string }).sessionId === 's-active')).toBe(true)
  })

  it('tab contextmenu delete → same DeleteConfirmModal (Q-6 / AC-13c / AC-60)', async () => {
    render(<App bridge={bridge} />)
    await act(async () => {
      applyHostFrame({
        type: 'panel/state',
        mode: 'live',
        sessionId: 's-ctx',
        tabId: 't-ctx',
        title: 'Ctx Tab',
      })
      applyHostFrame({
        type: 'panel/tabs',
        activeTabId: 't-ctx',
        tabs: [{
          tabId: 't-ctx',
          title: 'Ctx Tab',
          status: 'idle',
          unread: false,
          approvalBadge: false,
          mode: 'live',
          sessionId: 's-ctx',
        }],
      })
    })
    await waitFor(() => {
      expect(screen.getByTestId('tab-item')).toBeTruthy()
    })
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
    expect(posts.some(p => (p as { type?: string }).type === 'ui/delete-request')).toBe(false)

    fireEvent.contextMenu(screen.getByTestId('tab-item'))
    await waitFor(() => {
      expect(screen.getByTestId('menu-tab-delete-session')).toBeTruthy()
    })
    fireEvent.click(screen.getByTestId('menu-tab-delete-session'))
    await waitFor(() => {
      expect(screen.getByTestId('delete-confirm-modal')).toBeTruthy()
    })
    fireEvent.click(screen.getByTestId('btn-delete-confirm'))
    expect(posts.some(p =>
      (p as { type?: string; sessionId?: string }).type === 'ui/delete-request'
      && (p as { sessionId?: string }).sessionId === 's-ctx')).toBe(true)
  })

  it('replay Continue chrome visible + distinguishable (AC-54 / AC-38b)', async () => {
    render(<App bridge={bridge} />)
    await act(async () => {
      applyHostFrame({
        type: 'panel/state',
        mode: 'replay',
        sessionId: 's1',
        tabId: 't1',
        continue: {
          visibility: 'enabled',
          capability: 'same-id',
          reasonText: '可继续（同会话）',
        },
      })
    })
    await waitFor(() => {
      expect(screen.getByTestId('btn-continue')).toBeTruthy()
      expect(screen.getByTestId('continue-reason').textContent).toMatch(/可继续/)
      expect(screen.getByTestId('composer').getAttribute('data-composer-state')).toBe('readonly')
    })
    fireEvent.click(screen.getByTestId('btn-continue'))
    expect(posts.some(p => (p as { type?: string }).type === 'action/continue')).toBe(true)
  })

  it('root exposes data-follow-state; stopping clears without fifth composer state', async () => {
    render(<App bridge={bridge} />)
    expect(screen.getByTestId('editor-chat-root').getAttribute('data-follow-state')).toBeTruthy()
    await act(async () => {
      applyHostFrame({ type: 'panel/state', mode: 'live', sessionId: 's1', tabId: 't1' })
      setStopping(true)
    })
    await waitFor(() => {
      expect(screen.getByTestId('status').textContent).toContain('正在停止')
      const cs = screen.getByTestId('composer').getAttribute('data-composer-state')
      expect(['live', 'readonly', 'waiting', 'error']).toContain(cs)
      expect(cs).not.toBe('stopping')
    })
  })

  it('follow-state turns on with stream and resumes via btn-follow-resume (AC-24)', async () => {
    const { getFollowState } = mountDshProbes()
    render(<App bridge={bridge} />)
    await act(async () => {
      applyHostFrame({ type: 'panel/state', mode: 'live', sessionId: 's1', tabId: 't1' })
      applyHostFrame({
        type: 'messages/replace',
        sessionId: 's1',
        messages: [
          { id: 'a1', role: 'assistant', kind: 'text', sessionId: 's1', text: 'hello', streaming: true },
        ],
      })
      applyHostFrame({ type: 'status/set', status: 'generating', sessionId: 's1' })
    })
    await waitFor(() => {
      expect(screen.getByTestId('editor-chat-root').getAttribute('data-follow-state')).toBe('on')
      expect(getFollowState()).toBe('on')
    })

    const messagesEl = screen.getByTestId('messages')
    Object.defineProperty(messagesEl, 'scrollHeight', { configurable: true, get: () => 1000 })
    Object.defineProperty(messagesEl, 'clientHeight', { configurable: true, get: () => 200 })
    Object.defineProperty(messagesEl, 'scrollTop', {
      configurable: true,
      get: () => 0,
      set: () => {},
    })
    fireEvent.scroll(messagesEl)
    await waitFor(() => {
      expect(screen.getByTestId('editor-chat-root').getAttribute('data-follow-state')).toBe('off')
      expect(getFollowState()).toBe('off')
      expect(screen.getByTestId('btn-follow-resume')).toBeTruthy()
    })

    fireEvent.click(screen.getByTestId('btn-follow-resume'))
    await waitFor(() => {
      expect(screen.getByTestId('editor-chat-root').getAttribute('data-follow-state')).toBe('on')
      expect(getFollowState()).toBe('on')
    })
  })

  it('emits action/edit-resend and action/branch from message context (AC-34a / AC-35)', async () => {
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
            text: 'original prompt',
            turn: 1,
          },
          {
            id: 'a1',
            role: 'assistant',
            kind: 'text',
            sessionId: 's1',
            text: 'assistant reply',
            turn: 1,
          },
        ],
      })
    })
    await waitFor(() => {
      expect(screen.getByTestId('btn-edit-resend')).toBeTruthy()
      expect(screen.getAllByTestId('btn-branch').length).toBeGreaterThanOrEqual(1)
      expect(screen.getByTestId('btn-retry')).toBeTruthy()
    })

    fireEvent.click(screen.getByTestId('btn-edit-resend'))
    await waitFor(() => {
      expect(screen.getByTestId('edit-resend-form')).toBeTruthy()
    })
    fireEvent.change(screen.getByTestId('edit-resend-input'), {
      target: { value: 'edited prompt' },
    })
    fireEvent.click(screen.getByTestId('btn-edit-resend-confirm'))
    expect(posts.some(p =>
      (p as { type?: string; messageId?: string; text?: string }).type === 'action/edit-resend'
      && (p as { messageId?: string }).messageId === 'u1'
      && (p as { text?: string }).text === 'edited prompt')).toBe(true)

    fireEvent.click(screen.getAllByTestId('btn-branch')[0]!)
    expect(posts.some(p =>
      (p as { type?: string; turn?: number }).type === 'action/branch'
      && (p as { turn?: number }).turn === 1)).toBe(true)

    fireEvent.click(screen.getByTestId('btn-retry'))
    expect(posts.some(p =>
      (p as { type?: string; messageId?: string }).type === 'action/retry'
      && (p as { messageId?: string }).messageId === 'a1')).toBe(true)
  })

  it('history search hits update history list without forcing top search-panel', async () => {
    render(<App bridge={bridge} />)
    await act(async () => {
      applyHostFrame({
        type: 'panel/history',
        open: true,
        loading: false,
        rows: [{
          sessionId: 'local-1',
          title: 'Local Only',
          updatedAt: '2026-09-13T00:00:00.000Z',
          previewOrPath: 'x',
        }],
      })
    })
    fireEvent.change(screen.getByTestId('history-search'), { target: { value: 'remote' } })
    expect(posts.some(p => (p as { type?: string }).type === 'action/search-sessions')).toBe(true)

    await act(async () => {
      applyHostFrame({
        type: 'search/results',
        text: 'remote',
        hits: [{
          sessionId: 'hit-remote',
          title: 'Remote Hit',
          mtime: 1,
          matchTiers: [2],
          firstUserPreview: 'from host',
        }],
      })
    })
    await waitFor(() => {
      expect(screen.queryByTestId('search-panel')).toBeNull()
      expect(screen.getByTestId('history-row').getAttribute('data-session-id')).toBe('hit-remote')
    })
  })
})
