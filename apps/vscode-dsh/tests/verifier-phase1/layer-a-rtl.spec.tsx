/**
 * Verifier-owned Layer A (RTL) — independent of implementer suite.
 * Scenarios intentionally NOT covered 1:1 by editor-chat-shell.spec.tsx:
 * - composer-state matrix under varied panel/state (param variation / stub check)
 * - messages-loading vs empty contract
 * - AC-51 history row fields in DOM
 * - chrome height token ≤40px + sticky composer style
 * - waiting-interaction / disconnected status text
 */
// @vitest-environment jsdom

import { describe, expect, it, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, waitFor, act } from '@testing-library/react'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { App } from '../../webview/src/App.tsx'
import { createMessageBridge } from '../../webview/src/bridge/message-bridge.ts'
import {
  applyHostFrame,
  resetChatUiState,
  getChatUiState,
} from '../../webview/src/store/chat-ui-store.ts'

const webviewRoot = join(process.cwd(), 'apps/vscode-dsh/webview')

describe('verifier Layer-A RTL (independent DOM contract)', () => {
  const posts: unknown[] = []
  let bridge: ReturnType<typeof createMessageBridge>

  beforeEach(() => {
    cleanup()
    posts.length = 0
    resetChatUiState()
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

  it('V-A1: status + messages-empty + composer sticky present on cold start', () => {
    render(<App bridge={bridge} />)
    expect(screen.getByTestId('status')).toBeTruthy()
    expect(screen.getByTestId('messages-empty')).toBeTruthy()
    const composer = screen.getByTestId('composer')
    expect(composer.getAttribute('data-composer-state')).toBeTruthy()
    expect(composer.style.position).toBe('sticky')
    expect(screen.queryByTestId('messages-loading')).toBeNull()
  })

  it('V-A2: composer-state matrix changes with panel/state (param variation)', async () => {
    render(<App bridge={bridge} />)

    const cases: Array<{ mode: 'waiting-host' | 'live' | 'error' | 'replay'; expect: string }> = [
      { mode: 'waiting-host', expect: 'waiting' },
      { mode: 'live', expect: 'live' },
      { mode: 'error', expect: 'error' },
      { mode: 'replay', expect: 'readonly' },
    ]

    const observed: string[] = []
    for (const c of cases) {
      await act(async () => {
        applyHostFrame({
          type: 'panel/state',
          mode: c.mode,
          sessionId: `s-${c.mode}`,
          tabId: `t-${c.mode}`,
        })
      })
      await waitFor(() => {
        expect(screen.getByTestId('composer').getAttribute('data-composer-state')).toBe(c.expect)
      })
      observed.push(screen.getByTestId('composer').getAttribute('data-composer-state')!)
    }
    expect(new Set(observed).size).toBeGreaterThanOrEqual(3)
  })

  it('V-A3: messages-loading appears under waiting-host then clears on live empty', async () => {
    render(<App bridge={bridge} />)
    await act(async () => {
      applyHostFrame({ type: 'panel/state', mode: 'waiting-host' })
    })
    await waitFor(() => {
      expect(screen.getByTestId('messages-loading')).toBeTruthy()
    })
    expect(screen.queryByTestId('messages-empty')).toBeNull()

    await act(async () => {
      applyHostFrame({ type: 'panel/state', mode: 'live', sessionId: 's1', tabId: 't1' })
      applyHostFrame({ type: 'messages/replace', sessionId: 's1', messages: [] })
    })
    await waitFor(() => {
      expect(screen.getByTestId('messages-empty')).toBeTruthy()
    })
    expect(screen.queryByTestId('messages-loading')).toBeNull()
  })

  it('V-A4: tabs chrome contract + unread/running badges + select posts ui/tab-select', async () => {
    render(<App bridge={bridge} />)
    // UI-AC-10 / AC-50: chrome height must stay token-driven (≤40px), not a literal.
    // The token sits on the tab row inside the header — `phase-2` made the header itself a
    // column container, so asserting on the header's own inline height pinned a layout detail
    // that no longer exists (the value is still applied, one level down).
    const chrome = screen.getByTestId('tab-chrome')
    const tokenDrivenRow = chrome.querySelector<HTMLElement>('[style*="--dsh-chrome-height"]')
    expect(tokenDrivenRow?.style.height).toBe('var(--dsh-chrome-height)')
    expect(Number.parseInt(tokenDrivenRow?.style.maxHeight ?? '9999', 10)).toBeLessThanOrEqual(40)
    await act(async () => {
      applyHostFrame({
        type: 'panel/tabs',
        activeTabId: 't-run',
        tabs: [
          {
            tabId: 't-run',
            title: 'Running',
            status: 'running',
            unread: false,
            approvalBadge: true,
            mode: 'live',
          },
          {
            tabId: 't-idle',
            title: 'IdleUnread',
            status: 'idle',
            unread: true,
            approvalBadge: false,
            mode: 'live',
          },
        ],
      })
    })
    await waitFor(() => {
      expect(document.querySelector('[data-testid="tab-item"][data-tab-id="t-run"][data-active="true"]')).toBeTruthy()
    })
    expect(document.querySelector('[data-testid="tab-running-badge"]')).toBeTruthy()
    expect(document.querySelector('[data-testid="tab-unread-badge"]')).toBeTruthy()
    expect(document.querySelector('[data-testid="tab-approval-badge"]')).toBeTruthy()
    fireEvent.click(screen.getByText('IdleUnread'))
    expect(posts.some(p =>
      (p as { type?: string; tabId?: string }).type === 'ui/tab-select'
      && (p as { tabId?: string }).tabId === 't-idle')).toBe(true)
  })

  it('V-A5: history panel rows expose title/time/preview (AC-51); empty/loading contract', async () => {
    render(<App bridge={bridge} />)
    fireEvent.click(screen.getByTestId('btn-history'))
    expect(posts.some(p => (p as { type?: string }).type === 'ui/history-open')).toBe(true)

    await act(async () => {
      applyHostFrame({ type: 'panel/history', open: true, loading: true, rows: [] })
    })
    await waitFor(() => {
      expect(screen.getByTestId('history-panel')).toBeTruthy()
      expect(screen.getByTestId('history-loading')).toBeTruthy()
    })

    await act(async () => {
      applyHostFrame({ type: 'panel/history', open: true, loading: false, rows: [] })
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
          sessionId: 'hist-va5',
          title: 'Verifier Title',
          updatedAt: '2026-09-13T12:00:00.000Z',
          previewOrPath: 'preview-path/foo.ts',
        }],
      })
    })
    await waitFor(() => {
      const row = screen.getByTestId('history-row')
      expect(row.getAttribute('data-session-id')).toBe('hist-va5')
      expect(row.textContent).toContain('Verifier Title')
      expect(row.textContent).toContain('2026-09-13')
      expect(row.textContent).toContain('preview-path/foo.ts')
    })
  })

  it('V-A6: status text tracks waiting-interaction / disconnected / generating then idle (AC-25)', async () => {
    render(<App bridge={bridge} />)
    await act(async () => {
      applyHostFrame({ type: 'panel/state', mode: 'live', sessionId: 's1', tabId: 't1' })
      applyHostFrame({ type: 'status/set', status: 'waiting-interaction', sessionId: 's1' })
    })
    await waitFor(() => {
      expect(screen.getByTestId('status').textContent).toMatch(/等待交互/)
    })

    await act(async () => {
      applyHostFrame({ type: 'status/set', status: 'disconnected', sessionId: 's1' })
    })
    await waitFor(() => {
      expect(getChatUiState().composerState).toBe('waiting')
      expect(screen.getByTestId('status').textContent).toMatch(/等待 Host|断开|disconnected|等待/i)
    })

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
      expect(getChatUiState().streaming).toBe(false)
    })
  })

  it('V-A7: tokens.css chrome ≤40px + hover/focus rules (static UI-AC-10/50 proxy)', () => {
    const css = readFileSync(join(webviewRoot, 'src/styles/tokens.css'), 'utf8')
    const m = css.match(/--dsh-chrome-height:\s*(\d+)px/)
    expect(m).toBeTruthy()
    expect(Number(m![1])).toBeLessThanOrEqual(40)
    expect(css).toMatch(/button:focus-visible/)
    expect(css).toMatch(/\[data-testid='tab-item'\]:focus-visible/)
    expect(css).toMatch(/button:hover:not\(:disabled\)/)
    expect(css).toMatch(/--vscode-foreground/)
    expect(css).not.toMatch(/fonts\.googleapis|cdn\.|@import\s+url\(http/)
  })
})
