// @vitest-environment jsdom
import { containsUnsafeHtml } from '../src/markdown/safe-markdown.ts'
import { App } from '../webview/src/App.tsx'
import { createMessageBridge } from '../webview/src/bridge/message-bridge.ts'
import { mountDshProbes } from '../webview/src/probes.ts'
import { applyHostFrame, getChatUiState, resetChatUiState, setStopping } from '../webview/src/store/chat-ui-store.ts'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

describe('cap:webview — editor chat shell React rendering', () => {
  describe('layer-a-rtl/editor-chat-shell.spec.tsx', () => {
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

      it('CAP-WEBVIEW-001 renders editor-chat-root, thin tab chrome, sticky composer, and empty messages', () => {
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

      it('CAP-WEBVIEW-002 projects tabs from panel/tabs and marks the active tab', async () => {
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

      it('CAP-WEBVIEW-003 opens in-panel history list (not empty window) with rows/empty/loading contract', async () => {
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

      it('CAP-WEBVIEW-004 renders messages from Host frames with msg contract (minimal chat)', async () => {
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

      it('CAP-WEBVIEW-005 fail-closes streaming status when status/set returns idle', async () => {
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
  })

  describe('layer-a-rtl/editor-chat-phase2.spec.tsx', () => {
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

      it('CAP-WEBVIEW-006 settles assistant Markdown with sanitize + visible copy ( / UI-)', async () => {
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

      it('CAP-WEBVIEW-007 renders activity-row / ref-card / change-list DOM contracts', async () => {
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

      it('CAP-WEBVIEW-008 composer four states + Stop / stopping DOM ( / R7)', async () => {
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

      it('CAP-WEBVIEW-009 in-panel search tier 1+2 (not QuickPick-only)', async () => {
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

      it('CAP-WEBVIEW-010 history Continue / delete modal / parent lineage (–57/60)', async () => {
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

      it('CAP-WEBVIEW-011 overflow menu: delete session + open Timeline', async () => {
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

      it('CAP-WEBVIEW-012 tab contextmenu delete → same DeleteConfirmModal (Q-6 / )', async () => {
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

      it('CAP-WEBVIEW-013 replay Continue chrome visible + distinguishable', async () => {
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

      it('CAP-WEBVIEW-014 root exposes data-follow-state; stopping clears without fifth composer state', async () => {
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

      it('CAP-WEBVIEW-015 follow-state turns on with stream and resumes via btn-follow-resume', async () => {
        const probes = mountDshProbes()
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
          expect(probes.getFollowState()).toBe('on')
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
          expect(probes.getFollowState()).toBe('off')
          expect(screen.getByTestId('btn-follow-resume')).toBeTruthy()
        })

        fireEvent.click(screen.getByTestId('btn-follow-resume'))
        await waitFor(() => {
          expect(screen.getByTestId('editor-chat-root').getAttribute('data-follow-state')).toBe('on')
          expect(probes.getFollowState()).toBe('on')
        })
      })

      it('CAP-WEBVIEW-016 emits action/edit-resend and action/branch from message context', async () => {
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

      it('CAP-WEBVIEW-017 history search hits update history list without forcing top search-panel', async () => {
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
  })

  describe('verifier-phase1/layer-a-rtl.spec.tsx', () => {
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

      it('CAP-WEBVIEW-018 V-A1: status + messages-empty + composer sticky present on cold start', () => {
        render(<App bridge={bridge} />)
        expect(screen.getByTestId('status')).toBeTruthy()
        expect(screen.getByTestId('messages-empty')).toBeTruthy()
        const composer = screen.getByTestId('composer')
        expect(composer.getAttribute('data-composer-state')).toBeTruthy()
        expect(composer.style.position).toBe('sticky')
        expect(screen.queryByTestId('messages-loading')).toBeNull()
      })

      it('CAP-WEBVIEW-019 V-A2: composer-state matrix changes with panel/state (param variation)', async () => {
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

      it('CAP-WEBVIEW-020 V-A3: messages-loading appears under waiting-host then clears on live empty', async () => {
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

      it('CAP-WEBVIEW-021 V-A4: tabs chrome contract + unread/running badges + select posts ui/tab-select', async () => {
        render(<App bridge={bridge} />)
        // UI-AC[vscode-dsh-usable-loop]-10 / AC[vscode-dsh-usable-loop]-50: chrome height must stay token-driven (≤40px), not a literal.
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

      it('CAP-WEBVIEW-022 V-A5: history panel rows expose title/time/preview ; empty/loading contract', async () => {
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

      it('CAP-WEBVIEW-023 V-A6: status text tracks waiting-interaction / disconnected / generating then idle', async () => {
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

      it('CAP-WEBVIEW-024 V-A7: tokens.css chrome ≤40px + hover/focus rules (static UI- proxy)', () => {
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
  })

  describe('verifier-phase2/layer-a-rtl.spec.tsx', () => {
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

      it('CAP-WEBVIEW-025 V-A1: settle MD sanitizes img-onerror + javascript: href (; not only script)', async () => {
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
        // Escaped as text is OK; must not be executable DOM (AC[vscode-dsh-usable-loop]-21a).
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

      it('CAP-WEBVIEW-026 V-A2: branch gated by turn; different turns emit different payloads ( param)', async () => {
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

      it('CAP-WEBVIEW-027 V-A3: edit-resend cancel emits nothing; two messageIds vary payload', async () => {
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
        await waitFor(() =>{  expect(screen.getByTestId('edit-resend-form')).toBeTruthy() })
        fireEvent.click(screen.getByTestId('btn-edit-resend-cancel'))
        await waitFor(() =>{  expect(screen.queryByTestId('edit-resend-form')).toBeNull() })
        expect(posts.some(p => (p as { type?: string }).type === 'action/edit-resend')).toBe(false)

        const payloads: Array<{ messageId?: string; text?: string }> = []
        for (const [idx, mid, text] of [
          [0, 'u-a', 'edited-a'],
          [1, 'u-b', 'edited-b'],
        ] as const) {
          fireEvent.click(screen.getAllByTestId('btn-edit-resend')[idx]!)
          await waitFor(() =>{  expect(screen.getByTestId('edit-resend-form')).toBeTruthy() })
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

      it('CAP-WEBVIEW-028 V-A4: delete modal cancel never emits ui/delete-request', async () => {
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
        await waitFor(() =>{  expect(screen.getByTestId('delete-confirm-modal')).toBeTruthy() })
        fireEvent.click(screen.getByTestId('btn-delete-cancel'))
        await waitFor(() =>{  expect(screen.queryByTestId('delete-confirm-modal')).toBeNull() })
        expect(posts.some(p => (p as { type?: string }).type === 'ui/delete-request')).toBe(false)
      })

      it('CAP-WEBVIEW-029 V-A5: chrome vs history search origin isolation / flip', async () => {
        render(<App bridge={bridge} />)
        fireEvent.click(screen.getByTestId('btn-search'))
        await waitFor(() =>{  expect(screen.getByTestId('search-panel')).toBeTruthy() })
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
        await waitFor(() =>{  expect(screen.getByTestId('search-hit')).toBeTruthy() })

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

      it('CAP-WEBVIEW-030 V-A6: streaming shows raw text without msg-md; settle promotes Markdown', async () => {
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

      it('CAP-WEBVIEW-031 V-A7: stopping under waiting/error never invents fifth composer state ( R7)', async () => {
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

      it('CAP-WEBVIEW-032 V-A8: history Continue from ⋮ emits history-select ( path)', async () => {
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

      it('CAP-WEBVIEW-033 V-A9: activity / ref / change emit real intents (–32 smoke)', async () => {
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

      it('CAP-WEBVIEW-034 V-A10 Q-6: tab contextmenu → modal cancel then confirm (; independent)', async () => {
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
        await waitFor(() =>{  expect(screen.getByTestId('tab-item')).toBeTruthy() })

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
        await waitFor(() =>{  expect(screen.queryByTestId('delete-confirm-modal')).toBeNull() })
        expect(posts.some(p => (p as { type?: string }).type === 'ui/delete-request')).toBe(false)

        fireEvent.contextMenu(screen.getByTestId('tab-item'))
        await waitFor(() =>{  expect(screen.getByTestId('menu-tab-delete-session')).toBeTruthy() })
        fireEvent.click(screen.getByTestId('menu-tab-delete-session'))
        await waitFor(() =>{  expect(screen.getByTestId('delete-confirm-modal')).toBeTruthy() })
        fireEvent.click(screen.getByTestId('btn-delete-confirm'))
        expect(posts.some(p =>
          (p as { type?: string; sessionId?: string }).type === 'ui/delete-request'
      && (p as { sessionId?: string }).sessionId === 'vfy-active')).toBe(true)
      })

      it('CAP-WEBVIEW-035 V-A11 Q-6 regression: overflow delete still shares DeleteConfirmModal', async () => {
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

      it('CAP-WEBVIEW-036 V-A12 Q-6 Should-Fix: inactive tab contextmenu delete uses inactive sessionId', async () => {
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
        await waitFor(() =>{  expect(screen.queryByTestId('delete-confirm-modal')).toBeNull() })
        expect(posts.some(p => (p as { type?: string }).type === 'ui/delete-request')).toBe(false)

        fireEvent.contextMenu(inactive!)
        await waitFor(() =>{  expect(screen.getByTestId('menu-tab-delete-session')).toBeTruthy() })
        fireEvent.click(screen.getByTestId('menu-tab-delete-session'))
        await waitFor(() =>{  expect(screen.getByTestId('delete-confirm-modal')).toBeTruthy() })
        fireEvent.click(screen.getByTestId('btn-delete-confirm'))

        const deletes = posts.filter(p =>
          (p as { type?: string }).type === 'ui/delete-request') as Array<{ sessionId?: string }>
        expect(deletes.length).toBe(1)
        expect(deletes[0]!.sessionId).toBe('sess-inactive')
        expect(deletes[0]!.sessionId).not.toBe('sess-active')
      })
    })
  })

  describe('ui/compaction-marker + token-meter', () => {
    describe('compaction marker in the message flow / context meter in the status row', () => {
      let bridge: ReturnType<typeof createMessageBridge>

      beforeEach(() => {
        cleanup()
        resetChatUiState()
        bridge = createMessageBridge({
          postToHost: () => {},
          onHostMessage: () => () => {},
        })
      })

      afterEach(() => {
        bridge.dispose()
        cleanup()
      })

      it('CAP-WEBVIEW-037 renders a compaction marker from messages/append and expands its summary', async () => {
        render(<App bridge={bridge} />)
        await act(async () => {
          applyHostFrame({ type: 'panel/state', mode: 'live', sessionId: 's1', tabId: 't1' })
          applyHostFrame({
            type: 'messages/append',
            sessionId: 's1',
            message: {
              id: 'cmp-1',
              role: 'notice',
              kind: 'compaction',
              sessionId: 's1',
              text: '',
              compaction: {
                trigger: 'auto',
                status: 'done',
                shadowedTokenCount: 4200,
                summary: '<compacted-summary>earlier turns were folded</compacted-summary>',
              },
            },
          })
        })
        await waitFor(() => {
          expect(screen.getByTestId('compaction-marker')).toBeTruthy()
        })
        const marker = screen.getByTestId('compaction-marker')
        expect(marker.getAttribute('data-status')).toBe('done')
        expect(marker.getAttribute('data-trigger')).toBe('auto')
        expect(screen.getByTestId('compaction-title').textContent).toBe('上下文已压缩')
        expect(screen.getByTestId('compaction-shadowed').textContent).toBe('释放 4200 tokens')
        // Centered separator, not a left/right chat bubble
        expect(screen.queryByTestId('msg')).toBeNull()
        expect(marker.style.alignSelf).toBe('stretch')
        expect(marker.style.textAlign).toBe('center')

        const summary = screen.getByTestId('compaction-summary')
        expect(summary.querySelector('summary')?.textContent).toBe('查看摘要')
        expect(summary.querySelector('pre')?.textContent).toBe('earlier turns were folded')
        expect(summary.querySelector('compacted-summary')).toBeNull()
        expect(summary.hasAttribute('open')).toBe(false)
        fireEvent.click(summary.querySelector('summary')!)
        await waitFor(() => {
          expect(screen.getByTestId('compaction-summary').hasAttribute('open')).toBe(true)
        })
      })

      it('CAP-WEBVIEW-038 shows the failure copy and omits the released-token segment at zero', async () => {
        render(<App bridge={bridge} />)
        await act(async () => {
          applyHostFrame({ type: 'panel/state', mode: 'live', sessionId: 's1', tabId: 't1' })
          applyHostFrame({
            type: 'messages/append',
            sessionId: 's1',
            message: {
              id: 'cmp-failed',
              role: 'notice',
              kind: 'compaction',
              sessionId: 's1',
              text: '',
              compaction: {
                trigger: 'manual',
                status: 'failed',
                shadowedTokenCount: 0,
                summary: '',
                error: 'summarizer request timed out',
              },
            },
          })
        })
        await waitFor(() => {
          expect(screen.getByTestId('compaction-error')).toBeTruthy()
        })
        const marker = screen.getByTestId('compaction-marker')
        expect(marker.getAttribute('data-status')).toBe('failed')
        expect(marker.getAttribute('data-trigger')).toBe('manual')
        expect(marker.textContent).toContain('手动压缩')
        expect(screen.getByTestId('compaction-error').textContent).toBe('summarizer request timed out')
        expect(screen.getByTestId('compaction-error').style.color).toContain('--dsh-danger')
        expect(screen.queryByTestId('compaction-shadowed')).toBeNull()
        expect(screen.queryByTestId('compaction-summary')).toBeNull()
      })

      it('CAP-WEBVIEW-039 renders the token meter only after token/status and reports counts', async () => {
        render(<App bridge={bridge} />)
        expect(screen.queryByTestId('token-meter')).toBeNull()

        await act(async () => {
          applyHostFrame({ type: 'panel/state', mode: 'live', sessionId: 's1', tabId: 't1' })
          applyHostFrame({
            type: 'token/status',
            sessionId: 's1',
            inputTokens: 9000,
            outputTokens: 3300,
            totalTokens: 12300,
            contextWindow: 128000,
            thresholdRatio: 0.8,
          })
        })
        await waitFor(() => {
          expect(screen.getByTestId('token-meter')).toBeTruthy()
        })
        const meter = screen.getByTestId('token-meter')
        expect(screen.getByTestId('token-meter-text').textContent).toBe('12.3k / 128k · 9.6%')
        expect(screen.getByTestId('token-meter-bar').style.width).toBe('9.6%')
        expect(meter.getAttribute('data-warn')).toBe('false')
        expect(meter.getAttribute('title')).toBe('input 9000 · output 3300')
        // Shares the status row instead of pushing the composer down
        expect(screen.getByTestId('status').contains(meter)).toBe(true)
      })

      it('CAP-WEBVIEW-040 flags the warning token at/over thresholdRatio and clamps the bar at 100%', async () => {
        render(<App bridge={bridge} />)
        await act(async () => {
          applyHostFrame({ type: 'panel/state', mode: 'live', sessionId: 's1', tabId: 't1' })
          applyHostFrame({
            type: 'token/status',
            sessionId: 's1',
            inputTokens: 120000,
            outputTokens: 8000,
            totalTokens: 128000,
            contextWindow: 128000,
            thresholdRatio: 0.8,
          })
        })
        await waitFor(() => {
          expect(screen.getByTestId('token-meter').getAttribute('data-warn')).toBe('true')
        })
        expect(screen.getByTestId('token-meter-bar').style.background).toContain('--dsh-warning')

        await act(async () => {
          applyHostFrame({
            type: 'token/status',
            sessionId: 's1',
            inputTokens: 190000,
            outputTokens: 10000,
            totalTokens: 200000,
            contextWindow: 128000,
            thresholdRatio: 0.8,
          })
        })
        await waitFor(() => {
          expect(screen.getByTestId('token-meter-bar').style.width).toBe('100%')
        })
        expect(screen.getByTestId('token-meter').getAttribute('data-warn')).toBe('true')
      })

      it('CAP-WEBVIEW-041 messages/patch updates compaction status, released tokens, and summary', async () => {
        render(<App bridge={bridge} />)
        await act(async () => {
          applyHostFrame({ type: 'panel/state', mode: 'live', sessionId: 's1', tabId: 't1' })
          applyHostFrame({
            type: 'messages/append',
            sessionId: 's1',
            message: {
              id: 'cmp-patch',
              role: 'notice',
              kind: 'compaction',
              sessionId: 's1',
              text: '',
              compaction: { trigger: 'auto', status: 'running', shadowedTokenCount: 0, summary: '' },
            },
          })
        })
        await waitFor(() => {
          expect(screen.getByTestId('compaction-title').textContent).toBe('上下文已压缩…')
        })
        expect(screen.queryByTestId('compaction-summary')).toBeNull()

        await act(async () => {
          applyHostFrame({
            type: 'messages/patch',
            sessionId: 's1',
            messageId: 'cmp-patch',
            compaction: {
              status: 'done',
              shadowedTokenCount: 3100,
              summary: '<compacted-summary>older context folded</compacted-summary>',
            },
          })
        })
        await waitFor(() => {
          expect(screen.getByTestId('compaction-marker').getAttribute('data-status')).toBe('done')
        })
        expect(screen.getByTestId('compaction-title').textContent).toBe('上下文已压缩')
        expect(screen.getByTestId('compaction-shadowed').textContent).toBe('释放 3100 tokens')
        expect(screen.getByTestId('compaction-summary').textContent).toContain('older context folded')
      })

      it('CAP-WEBVIEW-042 drops a malformed compaction payload instead of rendering a partial marker', async () => {
        render(<App bridge={bridge} />)
        await act(async () => {
          applyHostFrame({ type: 'panel/state', mode: 'live', sessionId: 's1', tabId: 't1' })
          applyHostFrame({
            type: 'messages/append',
            sessionId: 's1',
            message: {
              id: 'bad-compaction',
              role: 'assistant',
              kind: 'text',
              sessionId: 's1',
              text: 'plain reply',
              compaction: {
                trigger: 'auto',
                status: 'half-done',
                shadowedTokenCount: 'many',
                summary: 'ignored',
              },
            },
          })
        })
        await waitFor(() => {
          expect(screen.getByTestId('msg')).toBeTruthy()
        })
        expect(screen.getByTestId('msg').textContent).toContain('plain reply')
        expect(screen.queryByTestId('compaction-marker')).toBeNull()
      })

      it('CAP-WEBVIEW-043 keeps the previous marker when a patch carries an out-of-set status', async () => {
        render(<App bridge={bridge} />)
        await act(async () => {
          applyHostFrame({ type: 'panel/state', mode: 'live', sessionId: 's1', tabId: 't1' })
          applyHostFrame({
            type: 'messages/append',
            sessionId: 's1',
            message: {
              id: 'cmp-keep',
              role: 'notice',
              kind: 'compaction',
              sessionId: 's1',
              text: '',
              compaction: { trigger: 'manual', status: 'running', shadowedTokenCount: 700, summary: '' },
            },
          })
        })
        await waitFor(() => {
          expect(screen.getByTestId('compaction-marker').getAttribute('data-status')).toBe('running')
        })

        await act(async () => {
          applyHostFrame({
            type: 'messages/patch',
            sessionId: 's1',
            messageId: 'cmp-keep',
            compaction: { status: 'half-done', shadowedTokenCount: 999 },
          })
        })
        expect(screen.getByTestId('compaction-marker').getAttribute('data-status')).toBe('running')
        expect(screen.getByTestId('compaction-shadowed').textContent).toBe('释放 700 tokens')
      })
    })
  })

  describe('ui/workflow-run-card', () => {
    describe('workflow run card in the message flow', () => {
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

      it('CAP-WEBVIEW-044 renders a workflow run card from messages/append with name, members, and progress', async () => {
        render(<App bridge={bridge} />)
        await act(async () => {
          applyHostFrame({ type: 'panel/state', mode: 'live', sessionId: 's1', tabId: 't1' })
          applyHostFrame({
            type: 'messages/append',
            sessionId: 's1',
            message: {
              id: 'wf-1',
              role: 'notice',
              kind: 'workflow',
              sessionId: 's1',
              text: '',
              workflow: {
                runId: 'run-7',
                name: 'Release sweep',
                status: 'running',
                members: [
                  { seq: 0, label: '起草方案', phase: 'plan', childId: 'child-a', outcome: 'completed' },
                  { seq: 1, label: '实现', phase: 'impl', childId: 'child-b' },
                  { seq: 2, label: '校验', childId: 'child-c', outcome: 'cancelled' },
                ],
              },
            },
          })
        })
        await waitFor(() => {
          expect(screen.getByTestId('workflow-card')).toBeTruthy()
        })
        const card = screen.getByTestId('workflow-card')
        expect(card.getAttribute('data-status')).toBe('running')
        expect(screen.getByTestId('workflow-title').textContent).toBe('⚙ Release sweep')
        expect(screen.getByTestId('workflow-status').textContent).toBe('运行中')
        expect(screen.getByTestId('workflow-progress').textContent).toBe('已完成 1 / 共 3')

        const members = screen.getAllByTestId('workflow-member')
        expect(members.length).toBe(3)
        expect(members[0]!.getAttribute('data-child-session-id')).toBe('child-a')
        expect(members[0]!.getAttribute('data-outcome')).toBe('completed')
        expect(members[0]!.textContent).toBe('✓ 起草方案 · plan')
        expect(members[1]!.getAttribute('data-outcome')).toBe('pending')
        expect(members[1]!.textContent).toBe('○ 实现 · impl')
        expect(members[2]!.getAttribute('data-outcome')).toBe('cancelled')
        expect(members[2]!.textContent).toBe('⊘ 校验')
        expect(screen.queryByTestId('workflow-empty')).toBeNull()
        expect(screen.queryByTestId('workflow-error')).toBeNull()
        // Card semantics, not a left/right chat bubble
        expect(screen.queryByTestId('msg')).toBeNull()
        expect(card.style.alignSelf).toBe('stretch')
      })

      it('CAP-WEBVIEW-045 clicking a member emits nav/open-subagent for that child session', async () => {
        render(<App bridge={bridge} />)
        await act(async () => {
          applyHostFrame({ type: 'panel/state', mode: 'live', sessionId: 's1', tabId: 't1' })
          applyHostFrame({
            type: 'messages/append',
            sessionId: 's1',
            message: {
              id: 'wf-2',
              role: 'notice',
              kind: 'workflow',
              sessionId: 's1',
              text: '',
              workflow: {
                runId: 'run-8',
                name: 'Fan-out',
                status: 'running',
                members: [
                  { seq: 0, label: 'left', childId: 'child-left', outcome: 'completed' },
                  { seq: 1, label: 'right', childId: 'child-right' },
                ],
              },
            },
          })
        })
        await waitFor(() => {
          expect(screen.getAllByTestId('workflow-member').length).toBe(2)
        })

        const members = screen.getAllByTestId('workflow-member')
        fireEvent.click(members[1]!)
        fireEvent.click(members[0]!)
        const navs = posts.filter(p =>
          (p as { type?: string }).type === 'nav/open-subagent') as Array<{ childSessionId?: string }>
        expect(navs.map(n => n.childSessionId)).toEqual(['child-right', 'child-left'])
      })

      it('CAP-WEBVIEW-046 messages/patch replaces members wholesale and settles the run as done', async () => {
        render(<App bridge={bridge} />)
        await act(async () => {
          applyHostFrame({ type: 'panel/state', mode: 'live', sessionId: 's1', tabId: 't1' })
          applyHostFrame({
            type: 'messages/append',
            sessionId: 's1',
            message: {
              id: 'wf-patch',
              role: 'notice',
              kind: 'workflow',
              sessionId: 's1',
              text: '',
              workflow: {
                runId: 'run-9',
                name: 'Nightly',
                status: 'running',
                members: [{ seq: 0, label: 'build', phase: 'build', childId: 'child-b1' }],
              },
            },
          })
        })
        await waitFor(() => {
          expect(screen.getByTestId('workflow-status').textContent).toBe('运行中')
        })
        expect(screen.getByTestId('workflow-progress').textContent).toBe('已完成 0 / 共 1')

        await act(async () => {
          applyHostFrame({
            type: 'messages/patch',
            sessionId: 's1',
            messageId: 'wf-patch',
            workflow: {
              status: 'done',
              stopReason: 'completed',
              members: [
                { seq: 0, label: 'build', phase: 'build', childId: 'child-b1', outcome: 'completed' },
                { seq: 1, label: 'test', phase: 'test', childId: 'child-b2', outcome: 'failed' },
              ],
            },
          })
        })
        await waitFor(() => {
          expect(screen.getByTestId('workflow-card').getAttribute('data-status')).toBe('done')
        })
        expect(screen.getByTestId('workflow-card').getAttribute('data-stop-reason')).toBe('completed')
        expect(screen.getByTestId('workflow-status').textContent).toBe('已完成')
        expect(screen.getByTestId('workflow-progress').textContent).toBe('已完成 1 / 共 2')
        // Partial patch: run identity survives a members-only replacement
        expect(screen.getByTestId('workflow-title').textContent).toBe('⚙ Nightly')

        const members = screen.getAllByTestId('workflow-member')
        expect(members.length).toBe(2)
        expect(members[1]!.getAttribute('data-child-session-id')).toBe('child-b2')
        expect(members[1]!.getAttribute('data-outcome')).toBe('failed')
        expect(members[1]!.style.color).toContain('--dsh-danger')
        expect(members[0]!.style.color).toContain('--dsh-muted')
      })

      it('CAP-WEBVIEW-047 drops a malformed workflow payload and keeps the previous card on a bad patch', async () => {
        render(<App bridge={bridge} />)
        await act(async () => {
          applyHostFrame({ type: 'panel/state', mode: 'live', sessionId: 's1', tabId: 't1' })
          applyHostFrame({
            type: 'messages/append',
            sessionId: 's1',
            message: {
              id: 'bad-workflow',
              role: 'assistant',
              kind: 'text',
              sessionId: 's1',
              text: 'plain reply',
              workflow: {
                runId: 'run-bad',
                name: 'Broken',
                status: 'running',
                members: 'not-an-array',
              },
            },
          })
        })
        await waitFor(() => {
          expect(screen.getByTestId('msg')).toBeTruthy()
        })
        expect(screen.getByTestId('msg').textContent).toContain('plain reply')
        expect(screen.queryByTestId('workflow-card')).toBeNull()
        expect(getChatUiState().messages[0]?.workflow).toBeUndefined()

        await act(async () => {
          applyHostFrame({
            type: 'messages/append',
            sessionId: 's1',
            message: {
              id: 'wf-keep',
              role: 'notice',
              kind: 'workflow',
              sessionId: 's1',
              text: '',
              workflow: {
                runId: 'run-keep',
                name: 'Keep me',
                status: 'running',
                members: [
                  { seq: 0, label: 'kept', childId: 'child-ok' },
                  { seq: 'one', label: 5, childId: 7 },
                ],
              },
            },
          })
        })
        // A member failing its own checks drops alone; the card still renders
        await waitFor(() => {
          expect(screen.getAllByTestId('workflow-member').length).toBe(1)
        })
        expect(screen.getByTestId('workflow-title').textContent).toBe('⚙ Keep me')

        await act(async () => {
          applyHostFrame({
            type: 'messages/patch',
            sessionId: 's1',
            messageId: 'wf-keep',
            workflow: { status: 'half-done', members: 'nope' },
          })
        })
        expect(screen.getByTestId('workflow-card').getAttribute('data-status')).toBe('running')
        expect(screen.getAllByTestId('workflow-member').length).toBe(1)
        expect(screen.getByTestId('workflow-progress').textContent).toBe('已完成 0 / 共 1')
      })
    })
  })

  describe('ui/settings-page', () => {
    describe('in-panel settings page (model route + compaction policy)', () => {
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

      const modelStateFrame = () => ({
        type: 'model/state',
        providers: [
          {
            id: 'deepseek',
            name: 'DeepSeek',
            models: [
              {
                id: 'deepseek-chat',
                name: 'DeepSeek Chat',
                contextWindow: 128000,
                reasoningEfforts: [{ id: 'low', name: '低' }, { id: 'high', name: '高' }],
              },
              { id: 'deepseek-reasoner', name: 'DeepSeek Reasoner' },
            ],
          },
          { id: 'local', name: 'Local', models: [{ id: 'small', name: 'Small' }] },
        ],
        current: { provider: 'deepseek', model: 'deepseek-chat', reasoningEffort: 'high' },
      })

      const settingsStateFrame = () => ({
        type: 'settings/state',
        namespaces: [
          {
            ns: 'compaction-basic',
            value: { auto: true, thresholdRatio: 0.8, retainRatio: 0.16, maxTokens: 8192 },
            base: { auto: false },
            user: { maxTokens: 4096 },
            revision: 3,
          },
          { ns: 'llm-deepseek', value: {}, revision: 7 },
        ],
      })

      /** One captured `settings/update` intent from the settings page. */
      interface SettingsUpdatePost {
        ns: string
        patch: Record<string, unknown>
        expectedRevision?: number
      }

      const settingsUpdates = (): SettingsUpdatePost[] => posts.filter(p =>
        (p as { type?: string }).type === 'settings/update') as SettingsUpdatePost[]

      it('CAP-WEBVIEW-048 opens the settings page from chrome and closes it without inventing data', async () => {
        render(<App bridge={bridge} />)
        expect(screen.queryByTestId('settings-panel')).toBeNull()

        fireEvent.click(screen.getByTestId('btn-settings'))
        expect(posts.some(p => (p as { type?: string }).type === 'settings/open')).toBe(true)
        await waitFor(() => {
          expect(screen.getByTestId('settings-panel')).toBeTruthy()
        })
        // No pushed state yet: the page waits for the Host instead of fabricating values
        expect(screen.getByTestId('settings-model-unavailable')).toBeTruthy()
        expect(screen.getByTestId('settings-compaction-unavailable')).toBeTruthy()
        expect(screen.queryByTestId('settings-provider')).toBeNull()

        fireEvent.click(screen.getByTestId('settings-close'))
        await waitFor(() => {
          expect(screen.queryByTestId('settings-panel')).toBeNull()
        })
      })

      it('CAP-WEBVIEW-049 seeds both sections from model/state and settings/state', async () => {
        render(<App bridge={bridge} />)
        fireEvent.click(screen.getByTestId('btn-settings'))
        await act(async () => {
          applyHostFrame(modelStateFrame())
          applyHostFrame(settingsStateFrame())
        })
        await waitFor(() => {
          expect(screen.getByTestId('settings-model-select')).toBeTruthy()
        })

        const providerSelect = screen.getByTestId<HTMLSelectElement>('settings-provider')
        expect(providerSelect.value).toBe('deepseek')
        expect([...providerSelect.options].map(o => o.textContent)).toEqual(['DeepSeek', 'Local'])
        const modelSelect = screen.getByTestId<HTMLSelectElement>('settings-model-select')
        expect(modelSelect.value).toBe('deepseek-chat')
        expect([...modelSelect.options].map(o => o.value))
          .toEqual(['deepseek-chat', 'deepseek-reasoner'])
        const effortSelect = screen.getByTestId<HTMLSelectElement>('settings-effort')
        expect(effortSelect.value).toBe('high')
        expect([...effortSelect.options].map(o => o.value)).toEqual(['low', 'high'])
        expect(effortSelect.disabled).toBe(false)

        expect(screen.getByTestId<HTMLInputElement>('settings-compact-auto').checked).toBe(true)
        expect(screen.getByTestId<HTMLInputElement>('settings-threshold').value).toBe('0.8')
        expect(screen.getByTestId<HTMLInputElement>('settings-retain-mode-ratio').checked).toBe(true)
        expect(screen.getByTestId<HTMLInputElement>('settings-retain-ratio').value).toBe('0.16')
        expect(screen.getByTestId<HTMLInputElement>('settings-retain-ratio').disabled).toBe(false)
        expect(screen.getByTestId<HTMLInputElement>('settings-retain-tokens').disabled).toBe(true)
        expect(screen.getByTestId<HTMLInputElement>('settings-max-tokens').value).toBe('8192')
        // Unset cap reads as an empty field — the placeholder carries the meaning
        const cap = screen.getByTestId<HTMLInputElement>('settings-window-cap')
        expect(cap.value).toBe('')
        expect(cap.placeholder).toBe('留空 = 使用模型自身窗口')
        expect(screen.getByTestId('settings-revision').textContent).toBe('3')
        // Only the field the user layer carries is marked as overridden
        expect(screen.getByTestId('settings-user-override').getAttribute('data-field')).toBe('maxTokens')
      })

      it('CAP-WEBVIEW-050 applies only the edited compaction fields with the read revision', async () => {
        render(<App bridge={bridge} />)
        fireEvent.click(screen.getByTestId('btn-settings'))
        await act(async () => {
          applyHostFrame(settingsStateFrame())
        })
        await waitFor(() => {
          expect(screen.getByTestId('settings-apply-compaction')).toBeTruthy()
        })

        fireEvent.change(screen.getByTestId('settings-threshold'), { target: { value: '0.7' } })
        fireEvent.click(screen.getByTestId('settings-apply-compaction'))
        expect(settingsUpdates()).toHaveLength(1)
        expect(settingsUpdates()[0]!.ns).toBe('compaction-basic')
        expect(settingsUpdates()[0]!.patch).toEqual({ thresholdRatio: 0.7 })
        expect(settingsUpdates()[0]!.expectedRevision).toBe(3)

        // Ratio retention is the active form, so the tokens key must stay out
        expect('retainTokens' in settingsUpdates()[0]!.patch).toBe(false)

        fireEvent.click(screen.getByTestId('settings-retain-mode-tokens'))
        fireEvent.change(screen.getByTestId('settings-retain-tokens'), { target: { value: '2048' } })
        fireEvent.click(screen.getByTestId('settings-apply-compaction'))
        expect(settingsUpdates()).toHaveLength(2)
        expect(settingsUpdates()[1]!.patch).toEqual({ thresholdRatio: 0.7, retainTokens: 2048 })
        expect('retainRatio' in settingsUpdates()[1]!.patch).toBe(false)
      })

      it('CAP-WEBVIEW-051 switches the model route and emits action/select-model', async () => {
        render(<App bridge={bridge} />)
        fireEvent.click(screen.getByTestId('btn-settings'))
        await act(async () => {
          applyHostFrame(modelStateFrame())
        })
        await waitFor(() => {
          expect(screen.getByTestId('settings-effort')).toBeTruthy()
        })

        // A route without efforts disables the effort select instead of keeping a stale value
        fireEvent.change(screen.getByTestId('settings-model-select'), { target: { value: 'deepseek-reasoner' } })
        const effortSelect = screen.getByTestId<HTMLSelectElement>('settings-effort')
        expect(effortSelect.disabled).toBe(true)
        expect(effortSelect.textContent).toContain('该模型不支持')

        fireEvent.change(screen.getByTestId('settings-provider'), { target: { value: 'local' } })
        expect(screen.getByTestId<HTMLSelectElement>('settings-model-select').value).toBe('small')
        fireEvent.click(screen.getByTestId('settings-apply-model'))
        const modelIntents = () => posts.filter(p =>
          (p as { type?: string }).type === 'action/select-model')
        expect(modelIntents()).toHaveLength(1)
        expect(modelIntents()[0]).toEqual({ type: 'action/select-model', provider: 'local', model: 'small' })

        // Returning to a supporting route resets the effort to that model's first entry
        fireEvent.change(screen.getByTestId('settings-provider'), { target: { value: 'deepseek' } })
        expect(screen.getByTestId<HTMLSelectElement>('settings-model-select').value).toBe('deepseek-chat')
        expect(screen.getByTestId<HTMLSelectElement>('settings-effort').value).toBe('low')
        fireEvent.click(screen.getByTestId('settings-apply-model'))
        expect(modelIntents()).toHaveLength(2)
        expect(modelIntents()[1]).toEqual({
          type: 'action/select-model',
          provider: 'deepseek',
          model: 'deepseek-chat',
          reasoningEffort: 'low',
        })
      })

      it('CAP-WEBVIEW-052 shows compaction-unavailable without that namespace and drops malformed namespaces', async () => {
        render(<App bridge={bridge} />)
        fireEvent.click(screen.getByTestId('btn-settings'))
        await act(async () => {
          applyHostFrame({
            type: 'settings/state',
            namespaces: [
              { ns: 'llm-deepseek', value: { apiKey: '' }, revision: 2 },
              { ns: '', value: {}, revision: 1 },
              { ns: 'no-revision', value: {} },
              { ns: 'scalar-layer', value: 'nope', revision: 4 },
            ],
          })
        })
        await waitFor(() => {
          expect(screen.getByTestId('settings-compaction-unavailable')).toBeTruthy()
        })
        expect(getChatUiState().settingsState?.namespaces.map(ns => ns.ns)).toEqual(['llm-deepseek'])

        // A frame whose whole list is unusable keeps the previous state
        await act(async () => {
          applyHostFrame({ type: 'settings/state', namespaces: 'nope' })
        })
        expect(getChatUiState().settingsState?.namespaces.map(ns => ns.ns)).toEqual(['llm-deepseek'])
      })
    })
  })

})
