/**
 * Layer A (React Testing Library) — Phase 1 Editor Chat DOM contract.
 * This suite is the UI PASS evidence for vscode-dsh-editor-chat-panel Phase 1.
 * Do NOT treat legacy buildThinChatHtml layer-a suites as this feature's UI PASS.
 */
// @vitest-environment jsdom

import { describe, expect, it, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, waitFor, act } from '@testing-library/react'
import { App } from '../../webview/src/App.tsx'
import { createMessageBridge } from '../../webview/src/bridge/message-bridge.ts'
import {
  applyHostFrame,
  resetChatUiState,
} from '../../webview/src/store/chat-ui-store.ts'
import { mountDshProbes } from '../../webview/src/probes.ts'

describe('layer-A RTL editor chat shell (phase-1 DOM contract)', () => {
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

  it('renders editor-chat-root, thin tab chrome, sticky composer, and empty messages', () => {
    render(<App bridge={bridge} />)
    expect(screen.getByTestId('editor-chat-root')).toBeTruthy()
    expect(screen.getByTestId('tab-chrome')).toBeTruthy()
    expect(screen.getByTestId('btn-new-tab')).toBeTruthy()
    expect(screen.getByTestId('btn-history')).toBeTruthy()
    expect(screen.getByTestId('btn-search')).toBeTruthy()
    expect(screen.getByTestId('btn-overflow')).toBeTruthy()
    expect(screen.getByTestId('composer').getAttribute('data-composer-state')).toBeTruthy()
    expect(screen.getByTestId('status')).toBeTruthy()
    expect(screen.getByTestId('messages-empty')).toBeTruthy()
    // ui-visual-spec §3: Messages → Status → Composer
    const root = screen.getByTestId('editor-chat-root')
    const order = [...root.querySelectorAll('[data-testid="messages-empty"], [data-testid="status"], [data-testid="composer"]')]
      .map(el => el.getAttribute('data-testid'))
    expect(order).toEqual(['messages-empty', 'status', 'composer'])
    expect(posts.some(p => (p as { type?: string }).type === 'ready')).toBe(true)
  })

  it('projects tabs from panel/tabs and marks the active tab', async () => {
    render(<App bridge={bridge} />)
    await act(async () => {
      applyHostFrame({
        type: 'panel/tabs',
        activeTabId: 't1',
        tabs: [
          {
            tabId: 't1',
            title: 'Alpha',
            status: 'running',
            unread: false,
            approvalBadge: false,
            mode: 'live',
          },
          {
            tabId: 't2',
            title: 'Beta',
            status: 'idle',
            unread: true,
            approvalBadge: false,
            mode: 'live',
          },
        ],
      })
    })
    await waitFor(() => {
      const active = document.querySelector('[data-testid="tab-item"][data-tab-id="t1"]')
      expect(active?.getAttribute('data-active')).toBe('true')
    })
    expect(document.querySelector('[data-testid="tab-running-badge"]')).toBeTruthy()
    fireEvent.click(screen.getByText('Beta'))
    expect(posts.some(p =>
      (p as { type?: string; tabId?: string }).type === 'ui/tab-select'
      && (p as { tabId?: string }).tabId === 't2')).toBe(true)
  })

  it('opens in-panel history list (not empty window) with rows/empty/loading contract', async () => {
    render(<App bridge={bridge} />)
    fireEvent.click(screen.getByTestId('btn-history'))
    expect(posts.some(p => (p as { type?: string }).type === 'ui/history-open')).toBe(true)

    await act(async () => {
      applyHostFrame({
        type: 'panel/history',
        open: true,
        loading: true,
        rows: [],
      })
    })
    await waitFor(() => {
      expect(screen.getByTestId('history-panel')).toBeTruthy()
      expect(screen.getByTestId('history-loading')).toBeTruthy()
    })

    await act(async () => {
      applyHostFrame({
        type: 'panel/history',
        open: true,
        loading: false,
        rows: [],
      })
    })
    await waitFor(() => {
      expect(screen.getByTestId('history-empty')).toBeTruthy()
    })

    await act(async () => {
      applyHostFrame({
        type: 'panel/history',
        open: true,
        loading: false,
        rows: [{
          sessionId: 's-hist',
          title: 'Yesterday',
          updatedAt: '2026-09-12T00:00:00.000Z',
          previewOrPath: 'hello world',
        }],
      })
    })
    await waitFor(() => {
      expect(screen.getByTestId('history-row').getAttribute('data-session-id')).toBe('s-hist')
    })
    fireEvent.click(screen.getByTestId('history-row'))
    expect(posts.some(p =>
      (p as { type?: string; sessionId?: string }).type === 'ui/history-select'
      && (p as { sessionId?: string }).sessionId === 's-hist')).toBe(true)
  })

  it('renders messages from Host frames with msg contract (minimal chat)', async () => {
    render(<App bridge={bridge} />)
    await act(async () => {
      applyHostFrame({
        type: 'panel/state',
        mode: 'live',
        sessionId: 's1',
        tabId: 't1',
      })
      applyHostFrame({
        type: 'messages/replace',
        sessionId: 's1',
        messages: [
          { id: 'm1', role: 'user', text: 'hi', kind: 'text', sessionId: 's1' },
          { id: 'm2', role: 'assistant', text: 'hello', kind: 'text', sessionId: 's1' },
        ],
      })
    })
    await waitFor(() => {
      expect(document.querySelector('[data-testid="msg"][data-message-id="m1"]')).toBeTruthy()
    })
    expect(document.querySelector('[data-testid="messages-empty"]')).toBeNull()
    const user = document.querySelector('[data-testid="msg"][data-message-id="m1"]')
    expect(user?.getAttribute('data-role')).toBe('user')
    expect(user?.textContent).toContain('hi')
  })

  it('fail-closes streaming status when status/set returns idle (AC-25)', async () => {
    render(<App bridge={bridge} />)
    await act(async () => {
      applyHostFrame({ type: 'panel/state', mode: 'live', sessionId: 's1', tabId: 't1' })
      applyHostFrame({ type: 'status/set', status: 'generating', sessionId: 's1' })
    })
    await waitFor(() => {
      expect(screen.getByTestId('status').textContent).toMatch(/生成中/)
    })
    await act(async () => {
      applyHostFrame({ type: 'status/set', status: 'idle', sessionId: 's1' })
    })
    await waitFor(() => {
      expect(window.__dshProbes?.getStreaming()).toBe(false)
    })
  })
})
