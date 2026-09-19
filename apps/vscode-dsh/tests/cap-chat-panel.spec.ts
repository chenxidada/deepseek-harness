import { ChatPanelHost, FakeWebviewPort, type HostToWebviewMessage, buildThinChatHtml, parseWebviewToHostMessage, resolveComposerKeydown } from '../src/chat-panel/index.ts'
import { type ContinueCapability, continueChromeFor } from '../src/continue-capability.ts'
import { ConversationController } from '../src/conversation-controller.ts'
import { ConversationRegistry } from '../src/conversation-registry.ts'
import { UNREAD_INDICATOR, conversationTreeItems } from '../src/conversation-tab-bar.ts'
import { EMPTY_LIVE_TITLE } from '../src/conversation-titles.ts'
import { ExtensionIndex, isHistoryEligibleSession } from '../src/extension-index.ts'
import { activate, deactivate, getChatPanelHost } from '../src/extension.ts'
import { listHistoryFromIndex } from '../src/history-view.ts'
import { containsUnsafeHtml, renderSafeMarkdown, safeMarkdownBrowserSource } from '../src/markdown/safe-markdown.ts'
import { detectIncomplete, hydrateFromAuthoritativeLog } from '../src/replay-hydrator.ts'
import { IdeSessionHost } from '../src/session-host.ts'
import { TimelineStore } from '../src/timeline-store.ts'
import { type HarnessNotification } from '@deepseek-ai/dsh-sdk-client'
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { createContext, runInContext } from 'node:vm'
import { afterEach, describe, expect, it } from 'vitest'

function sessionEvent(
  sessionId: string,
  type: string,
  data: Record<string, unknown>,
): HarnessNotification {
  return {
    method: 'session.event',
    params: {
      sessionId,
      event: { type, data },
    },
  } as HarnessNotification
}

async function waitFor(predicate: () => boolean, timeoutMs: number): Promise<void> {
  const start = Date.now()
  while (!predicate()) {
    if (Date.now() - start > timeoutMs) throw new Error('waitFor timeout')
    await new Promise(r => setTimeout(r, 10))
  }
}

describe('cap:chat-panel — activity stream, streaming follow, and chat chassis', () => {
  describe('chat-ux-activity-stream.spec.ts', () => {
    type NotificationListener = (notification: HarnessNotification) => void

    function createEmitHost() {
      const listeners = new Set<NotificationListener>()
      const cancelCalls: string[] = []
      const revertCalls: string[] = []
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
        async cancelSession(sessionId: string) {
          cancelCalls.push(sessionId)
        },
        emit(notification: HarnessNotification) {
          for (const listener of listeners) listener(notification)
        },
        cancelCalls,
        revertCalls,
      }
      return host as unknown as IdeSessionHost & {
        emit: (n: HarnessNotification) => void
        cancelCalls: string[]
        revertCalls: string[]
      }
    }

    describe('layer-B activity stream', () => {
      it('CAP-CHAT-PANEL-001 tool/call without text chunks still projects kind:activity', () => {
        const host = createEmitHost()
        const controller = new ConversationController(host)
        const tab = controller.newConversation('live')
        const panel = new ChatPanelHost({
          registry: controller.registry,
          messages: controller.messages,
          isHostReady: () => true,
          acceptSend: text => controller.promptActive(text),
        })
        controller.setPanelHost(panel)
        const fake = new FakeWebviewPort()
        panel.attach(fake)
        panel.clearOutboundLog()
        fake.receivedFromHost.length = 0

        host.emit(sessionEvent(tab.sessionId, 'tool/call', {
          turn: 0,
          step: 0,
          callId: 'call-bash-1',
          name: 'Bash',
          arguments: '{"command":"ls"}',
        }))

        const msgs = controller.messages.get(tab.sessionId)
        const activities = msgs.filter(m => m.kind === 'activity')
        expect(activities).toHaveLength(1)
        expect(activities[0]?.activity?.status).toBe('running')
        expect(activities[0]?.activity?.toolName).toBe('Bash')
        expect(activities[0]?.activity?.callId).toBe('call-bash-1')
        expect(activities[0]?.activity?.ordinal).toBe(0)
        expect(activities[0]?.activity?.expanded).toBe(false)
        expect(activities[0]?.turn).toBe(0)
        expect(msgs.some(m => m.role === 'assistant' && m.kind === 'text')).toBe(false)

        const appends = fake.receivedFromHost.filter(m => m.type === 'messages/append')
        expect(appends.some(m =>
          m.type === 'messages/append' && m.message.kind === 'activity',
        )).toBe(true)
      })

      it('CAP-CHAT-PANEL-002 tool/result maps done / failed / aborted', () => {
        const host = createEmitHost()
        const controller = new ConversationController(host)
        const tab = controller.newConversation('live')
        const panel = new ChatPanelHost({
          registry: controller.registry,
          messages: controller.messages,
          isHostReady: () => true,
          acceptSend: text => controller.promptActive(text),
        })
        controller.setPanelHost(panel)

        host.emit(sessionEvent(tab.sessionId, 'tool/call', {
          turn: 1,
          callId: 'c-done',
          name: 'Read',
        }))
        host.emit(sessionEvent(tab.sessionId, 'tool/result', {
          turn: 1,
          callId: 'c-done',
          isError: false,
        }))
        expect(
          controller.messages.get(tab.sessionId).find(m => m.activity?.callId === 'c-done')
            ?.activity?.status,
        ).toBe('done')

        host.emit(sessionEvent(tab.sessionId, 'tool/call', {
          turn: 1,
          callId: 'c-fail',
          name: 'Bash',
        }))
        host.emit(sessionEvent(tab.sessionId, 'tool/result', {
          turn: 1,
          callId: 'c-fail',
          isError: true,
        }))
        expect(
          controller.messages.get(tab.sessionId).find(m => m.activity?.callId === 'c-fail')
            ?.activity?.status,
        ).toBe('failed')

        host.emit(sessionEvent(tab.sessionId, 'tool/call', {
          turn: 1,
          callId: 'c-abort',
          name: 'Write',
        }))
        host.emit(sessionEvent(tab.sessionId, 'tool/result', {
          turn: 1,
          callId: 'c-abort',
          isError: true,
          error: { info: { name: 'AbortError', code: 'ABORTED' } },
        }))
        expect(
          controller.messages.get(tab.sessionId).find(m => m.activity?.callId === 'c-abort')
            ?.activity?.status,
        ).toBe('aborted')

        host.emit(sessionEvent(tab.sessionId, 'tool/call', {
          turn: 1,
          callId: 'c-pre',
          name: 'Write',
        }))
        host.emit(sessionEvent(tab.sessionId, 'tool/result', {
          turn: 1,
          callId: 'c-pre',
          isError: true,
          error: { info: { code: 'ABORTED_BEFORE_DISPATCH' } },
        }))
        expect(
          controller.messages.get(tab.sessionId).find(m => m.activity?.callId === 'c-pre')
            ?.activity?.status,
        ).toBe('aborted')
      })

      it('CAP-CHAT-PANEL-003 turn/end aborted converges running activities to aborted without revert', async () => {
        const host = createEmitHost()
        const controller = new ConversationController(host)
        const tab = controller.newConversation('live')
        const panel = new ChatPanelHost({
          registry: controller.registry,
          messages: controller.messages,
          isHostReady: () => true,
          acceptSend: text => controller.promptActive(text),
          requestStop: () => controller.cancelActiveTurn(),
        })
        controller.setPanelHost(panel)
        const fake = new FakeWebviewPort()
        panel.attach(fake)

        host.emit(sessionEvent(tab.sessionId, 'tool/call', {
          turn: 4,
          callId: 'running-1',
          name: 'Bash',
        }))
        host.emit(sessionEvent(tab.sessionId, 'tool/call', {
          turn: 4,
          callId: 'running-2',
          name: 'Read',
        }))
        expect(
          controller.messages.get(tab.sessionId)
            .filter(m => m.kind === 'activity')
            .every(m => m.activity?.status === 'running'),
        ).toBe(true)

        await panel.handleWebviewMessage({ type: 'action/stop' })
        expect(host.cancelCalls).toEqual([tab.sessionId])

        host.emit(sessionEvent(tab.sessionId, 'turn/end', {
          turn: 4,
          reason: { kind: 'aborted', reason: { kind: 'user' } },
        }))

        const activities = controller.messages.get(tab.sessionId).filter(m => m.kind === 'activity')
        expect(activities).toHaveLength(2)
        expect(activities.every(m => m.activity?.status === 'aborted')).toBe(true)
        expect(host.revertCalls).toHaveLength(0)
        // Cancel path must not invent automatic file revert frames.
        expect(fake.receivedFromHost.some(m =>
          m.type === 'change/revert-result',
        )).toBe(false)
      })

      it('CAP-CHAT-PANEL-004 same-turn tools share turn + increasing ordinal', () => {
        const host = createEmitHost()
        const controller = new ConversationController(host)
        const tab = controller.newConversation('live')

        host.emit(sessionEvent(tab.sessionId, 'tool/call', {
          turn: 7,
          callId: 'a',
          name: 'A',
        }))
        host.emit(sessionEvent(tab.sessionId, 'tool/call', {
          turn: 7,
          callId: 'b',
          name: 'B',
        }))
        const acts = controller.messages.get(tab.sessionId).filter(m => m.kind === 'activity')
        expect(acts.map(m => m.activity?.ordinal)).toEqual([0, 1])
        expect(acts.every(m => m.turn === 7)).toBe(true)
      })

      it('CAP-CHAT-PANEL-005 hydrate rebuilds activities; replay mode rejects live send', async () => {
        const hydrated = hydrateFromAuthoritativeLog('sess-replay', [
          {
            type: 'user/message',
            seq: 1,
            data: { role: 'user', id: 'u1', content: [{ type: 'text', text: 'run tools' }] },
          },
          {
            type: 'tool/call',
            seq: 2,
            data: { turn: 0, callId: 't1', name: 'Bash', arguments: '{}' },
          },
          {
            type: 'tool/result',
            seq: 3,
            data: {
              turn: 0,
              callId: 't1',
              isError: false,
              message: { source: { callId: 't1' } },
            },
          },
          {
            type: 'tool/call',
            seq: 4,
            data: { turn: 0, callId: 't2', name: 'Read' },
          },
          {
            type: 'turn/end',
            seq: 5,
            data: { turn: 0, reason: { kind: 'aborted' } },
          },
        ])

        const activities = hydrated.messages.filter(m => m.kind === 'activity')
        expect(activities).toHaveLength(2)
        expect(activities[0]?.activity?.status).toBe('done')
        expect(activities[0]?.activity?.expanded).toBe(false)
        expect(activities[0]?.turn).toBe(0)
        expect(activities[1]?.activity?.status).toBe('aborted')
        expect(activities[1]?.activity?.callId).toBe('t2')

        const host = createEmitHost()
        const controller = new ConversationController(host)
        const tab = controller.newConversation('live')
        controller.registry.setMode(tab.tabId, 'replay')
        const panel = new ChatPanelHost({
          registry: controller.registry,
          messages: controller.messages,
          isHostReady: () => true,
          acceptSend: text => controller.promptActive(text),
        })
        const fake = new FakeWebviewPort()
        panel.attach(fake)
        panel.clearOutboundLog()

        await panel.handleWebviewMessage({ type: 'composer/send', text: 'should reject' })
        const rejects = fake.receivedFromHost.filter(m => m.type === 'ui/reject-send')
        expect(rejects.some(m => m.type === 'ui/reject-send' && m.reason === 'replay')).toBe(true)
      })
    })
  })

  describe('chat-ux-streaming-cancel-follow.spec.ts', () => {
    type NotificationListener = (notification: HarnessNotification) => void

    function createEmitHost(options?: {
      cancelImpl?: (sessionId: string) => Promise<void>
    }) {
      const listeners = new Set<NotificationListener>()
      const cancelCalls: string[] = []
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
        async cancelSession(sessionId: string) {
          cancelCalls.push(sessionId)
          if (options?.cancelImpl) await options.cancelImpl(sessionId)
        },
        emit(notification: HarnessNotification) {
          for (const listener of listeners) listener(notification)
        },
        cancelCalls,
      }
      return host as unknown as IdeSessionHost & {
        emit: (n: HarnessNotification) => void
        cancelCalls: string[]
      }
    }

    describe('layer-B streaming / cancel / incomplete', () => {
      it('CAP-CHAT-PANEL-006 text-delta chunks project via messages/patch with stable id; converge on assistant/message', async () => {
        const host = createEmitHost()
        const controller = new ConversationController(host)
        const tab = controller.newConversation('live')
        const panel = new ChatPanelHost({
          registry: controller.registry,
          messages: controller.messages,
          interactions: host.interactions,
          isHostReady: () => true,
          acceptSend: text => controller.promptActive(text),
        })
        controller.setPanelHost(panel)
        const fake = new FakeWebviewPort()
        panel.attach(fake)
        panel.clearOutboundLog()
        fake.receivedFromHost.length = 0

        host.emit(sessionEvent(tab.sessionId, 'assistant/chunk', {
          turn: 0,
          step: 0,
          chunk: { type: 'text-delta', text: 'Hel' },
        }))
        const afterFirst = controller.messages.get(tab.sessionId)
        expect(afterFirst).toHaveLength(1)
        const messageId = afterFirst[0]!.id
        expect(afterFirst[0]?.text).toBe('Hel')

        // Status→running may pushFullState once; clear then assert chunk path is patch-only.
        panel.clearOutboundLog()
        fake.receivedFromHost.length = 0

        host.emit(sessionEvent(tab.sessionId, 'assistant/chunk', {
          turn: 0,
          step: 0,
          chunk: { type: 'text-delta', text: 'lo' },
        }))

        const msgs = controller.messages.get(tab.sessionId)
        expect(msgs).toHaveLength(1)
        expect(msgs[0]?.id).toBe(messageId)
        expect(msgs[0]?.text).toBe('Hello')
        expect(msgs[0]?.streaming).toBe(true)

        const patches = fake.receivedFromHost.filter(m => m.type === 'messages/patch')
        expect(patches.length).toBeGreaterThanOrEqual(1)
        expect(patches.every(p => p.type === 'messages/patch' && p.messageId === messageId)).toBe(true)
        expect(patches.some(p => p.type === 'messages/patch' && p.appendText === 'lo')).toBe(true)
        // Must not rebuild the list to deliver subsequent chunks (AC[vscode-dsh-usable-loop]-18 / R1).
        expect(fake.receivedFromHost.filter(m => m.type === 'messages/replace').length).toBe(0)
        expect(fake.receivedFromHost.filter(m => m.type === 'messages/append').length).toBe(0)

        host.emit(sessionEvent(tab.sessionId, 'assistant/message', {
          turn: 0,
          message: { content: [{ type: 'text', text: 'Hello world' }] },
        }))
        const after = controller.messages.get(tab.sessionId)
        expect(after).toHaveLength(1)
        expect(after[0]?.id).toBe(messageId)
        expect(after[0]?.text).toBe('Hello world')
        expect(after[0]?.streaming).toBeUndefined()
      })

      it('CAP-CHAT-PANEL-007 T6: reasoning-delta is ignored (no thinking projection)', () => {
        const host = createEmitHost()
        const controller = new ConversationController(host)
        const tab = controller.newConversation('live')
        const panel = new ChatPanelHost({
          registry: controller.registry,
          messages: controller.messages,
          isHostReady: () => true,
          acceptSend: text => controller.promptActive(text),
        })
        controller.setPanelHost(panel)

        host.emit(sessionEvent(tab.sessionId, 'assistant/chunk', {
          turn: 0,
          chunk: { type: 'reasoning-delta', text: 'secret thoughts' },
        }))
        expect(controller.messages.get(tab.sessionId)).toHaveLength(0)

        host.emit(sessionEvent(tab.sessionId, 'assistant/chunk', {
          turn: 0,
          chunk: { type: 'text-delta', text: 'visible' },
        }))
        expect(controller.messages.get(tab.sessionId)[0]?.text).toBe('visible')
      })

      it('CAP-CHAT-PANEL-008 action/stop calls host.cancelSession (I-真)', async () => {
        const host = createEmitHost()
        const controller = new ConversationController(host)
        const tab = controller.newConversation('live')
        const panel = new ChatPanelHost({
          registry: controller.registry,
          messages: controller.messages,
          isHostReady: () => true,
          acceptSend: text => controller.promptActive(text),
          requestStop: () => controller.cancelActiveTurn(),
        })
        controller.setPanelHost(panel)
        const fake = new FakeWebviewPort()
        panel.attach(fake)

        host.emit(sessionEvent(tab.sessionId, 'assistant/chunk', {
          turn: 0,
          chunk: { type: 'text-delta', text: 'partial' },
        }))

        await panel.handleWebviewMessage({ type: 'action/stop' })
        expect(host.cancelCalls).toEqual([tab.sessionId])
      })

      it('CAP-CHAT-PANEL-009 turn/end aborted marks incomplete and keeps partial text', () => {
        const host = createEmitHost()
        const controller = new ConversationController(host)
        const tab = controller.newConversation('live')
        const panel = new ChatPanelHost({
          registry: controller.registry,
          messages: controller.messages,
          isHostReady: () => true,
          acceptSend: text => controller.promptActive(text),
        })
        controller.setPanelHost(panel)

        host.emit(sessionEvent(tab.sessionId, 'assistant/chunk', {
          turn: 1,
          chunk: { type: 'text-delta', text: 'half' },
        }))
        host.emit(sessionEvent(tab.sessionId, 'turn/end', {
          turn: 1,
          reason: { kind: 'aborted', reason: { kind: 'user' } },
        }))

        const msgs = controller.messages.get(tab.sessionId)
        const assistant = msgs.find(m => m.role === 'assistant')
        expect(assistant?.text).toBe('half')
        expect(assistant?.incomplete).toBe(true)
        expect(assistant?.streaming).toBeUndefined()
        expect(msgs.some(m => m.text === '已停止/未完成')).toBe(true)
      })

      it('CAP-CHAT-PANEL-010 cancel failure is fail-closed with banner; no incomplete claim', async () => {
        const host = createEmitHost({
          cancelImpl: async () => {
            throw new Error('session/cancel timed out after 5000ms')
          },
        })
        const controller = new ConversationController(host)
        const tab = controller.newConversation('live')
        const panel = new ChatPanelHost({
          registry: controller.registry,
          messages: controller.messages,
          isHostReady: () => true,
          acceptSend: text => controller.promptActive(text),
          requestStop: () => controller.cancelActiveTurn(),
        })
        controller.setPanelHost(panel)
        const fake = new FakeWebviewPort()
        panel.attach(fake)
        panel.clearOutboundLog()

        host.emit(sessionEvent(tab.sessionId, 'assistant/chunk', {
          turn: 0,
          chunk: { type: 'text-delta', text: 'still going' },
        }))

        const result = await controller.cancelActiveTurn()
        expect(result.ok).toBe(false)
        if (result.ok === false) {
          expect(result.error).toContain('timed out')
        }
        const banners = panel.getOutboundLog().filter(m => m.type === 'ui/banner')
        expect(banners.some(b => b.type === 'ui/banner' && String(b.text).includes('中断失败'))).toBe(true)
        // Must not pretend stop succeeded.
        const assistant = controller.messages.get(tab.sessionId).find(m => m.role === 'assistant')
        expect(assistant?.incomplete).not.toBe(true)
        expect(assistant?.text).toBe('still going')
      })

      it('CAP-CHAT-PANEL-011 hydrate: detectIncomplete recognizes aborted', () => {
        expect(detectIncomplete([
          { type: 'turn/start', data: { turn: 0 } },
          { type: 'assistant/message', data: { turn: 0, message: { content: [{ type: 'text', text: 'x' }] } } },
          { type: 'turn/end', data: { turn: 0, reason: { kind: 'aborted', reason: { kind: 'user' } } } },
        ])).toBe(true)
        expect(detectIncomplete([
          { type: 'turn/start', data: { turn: 0 } },
          { type: 'turn/end', data: { turn: 0, reason: { kind: 'interrupted' } } },
        ])).toBe(true)
        expect(detectIncomplete([
          { type: 'turn/start', data: { turn: 0 } },
          { type: 'turn/end', data: { turn: 0, reason: { kind: 'completed' } } },
        ])).toBe(false)
      })

      it('CAP-CHAT-PANEL-012 Host disconnect fail-closes streaming', () => {
        const statusListeners = new Set<(status: string) => void>()
        const listeners = new Set<NotificationListener>()
        const host = {
          status: 'connected' as string,
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
          onStatusChange(listener: (status: string) => void) {
            statusListeners.add(listener)
            return () => { statusListeners.delete(listener) }
          },
          async prompt() { return 'm' },
          async disposeSession() {},
          async cancelSession() {},
          emit(n: HarnessNotification) {
            for (const l of listeners) l(n)
          },
          setStatus(next: string) {
            this.status = next
            for (const l of statusListeners) l(next)
          },
        } as unknown as IdeSessionHost & {
          emit: (n: HarnessNotification) => void
          setStatus: (s: string) => void
        }

        const controller = new ConversationController(host)
        const tab = controller.newConversation('live')
        const panel = new ChatPanelHost({
          registry: controller.registry,
          messages: controller.messages,
          isHostReady: () => host.status === 'connected',
          acceptSend: text => controller.promptActive(text),
        })
        controller.setPanelHost(panel)
        const fake = new FakeWebviewPort()
        panel.attach(fake)
        panel.clearOutboundLog()

        host.emit(sessionEvent(tab.sessionId, 'assistant/chunk', {
          turn: 0,
          chunk: { type: 'text-delta', text: 'cut' },
        }))
        expect(controller.messages.get(tab.sessionId)[0]?.streaming).toBe(true)

        host.setStatus('error')
        expect(controller.messages.get(tab.sessionId)[0]?.streaming).toBeUndefined()
        expect(panel.getOutboundLog().some(m => m.type === 'ui/banner')).toBe(true)
      })
    })
  })

  describe('phase3-chat-ui-chassis.spec.ts', () => {
    afterEach(async () => {
      await deactivate()
    })

    describe('test:theme-tokens (VP-CR-6)', () => {
      it('CAP-CHAT-PANEL-013 HTML/CSS is driven by --vscode-* tokens, not a bare gray-box background', () => {
        const html = buildThinChatHtml('vscode-csp')
        expect(html).toContain('--vscode-')
        expect(html).toContain('var(--vscode-sideBar-background')
        expect(html).toContain('var(--vscode-button-background)')
        expect(html).toContain('dsh-chat-chassis')
        // Must not rely on a single hardcoded gray as the sole body background.
        expect(html).not.toMatch(/body\s*\{[^}]*background:\s*#(?:ccc|ddd|eee|f5f5f5)/i)
      })
    })

    describe('test:bubble-layers (VP-CR-6)', () => {
      it('CAP-CHAT-PANEL-014 user and assistant bubbles use distinguishable classes', () => {
        const html = buildThinChatHtml()
        expect(html).toContain('.msg.bubble.user')
        expect(html).toContain('.msg.bubble.assistant')
        expect(html).toContain('data-role')
        expect(html).toContain("'msg bubble ' + msg.role")
      })
    })

    describe('test:composer-contrast (VP-CR-6)', () => {
      it('CAP-CHAT-PANEL-015 composer is a fixed bottom bar with a themed Send button', () => {
        const html = buildThinChatHtml()
        expect(html).toContain('data-testid="composer"')
        expect(html).toContain('position: sticky')
        expect(html).toContain('bottom: 0')
        expect(html).toContain('#composer')
        expect(html).toContain('var(--vscode-button-background)')
        expect(html).toContain('data-testid="send"')
      })
    })

    describe('test:visual-evidence-chain (VP-CR-6)', () => {
      it('CAP-CHAT-PANEL-016 documents L2/L3 primary evidence plus L4 screenshot assist paths', () => {
        // L2/L3 primary: this suite + sibling cases; L4 assist = README path convention (PNGs optional).
        const screenshotsDir = resolve(
          process.cwd(),
          'apps/vscode-dsh/tests/fixtures/screenshots',
        )
        const readme = resolve(screenshotsDir, 'README.md')
        expect(existsSync(readme)).toBe(true)

        const html = buildThinChatHtml()
        expect(html).toContain('dsh-chat-chassis')
        expect(html).toContain('--vscode-')
        expect(html).toContain('.msg.bubble.user')
        expect(html).toContain('data-testid="composer"')
      })
    })

    describe('theme refresh (VP-CR-6a)', () => {
      it('CAP-CHAT-PANEL-017 Host pushThemeKind posts ui/theme and HTML consumes it', async () => {
        const html = buildThinChatHtml()
        expect(html).toContain("msg.type === 'ui/theme'")
        expect(html).toContain('applyThemeKind')

        const registry = new ConversationRegistry()
        const messages = new ConversationController({
          status: 'connected',
          interactions: { failClosedSession() {}, listPending() { return [] } },
          setConversationRegistry() {},
          onNotification() { return () => {} },
          async prompt() { return 'm' },
          async disposeSession() {},
        } as unknown as IdeSessionHost).messages
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
        panel.pushThemeKind('light')
        expect(fake.receivedFromHost.some(m => m.type === 'ui/theme' && m.themeKind === 'light')).toBe(true)
      })
    })

    describe('generating indicator', () => {
      it('CAP-CHAT-PANEL-018 status/set generating shows Generating…; idle clears', async () => {
        const html = buildThinChatHtml()
        expect(html).toContain('Generating…')
        expect(html).toContain('is-generating')

        const host = {
          status: 'connected' as const,
          interactions: { failClosedSession() {}, listPending() { return [] } },
          setConversationRegistry() {},
          onNotification() { return () => {} },
          async prompt() { return 'm' },
          async disposeSession() {},
        } as unknown as IdeSessionHost
        const controller = new ConversationController(host)
        const tab = controller.newConversation(EMPTY_LIVE_TITLE)
        const panel = new ChatPanelHost({
          registry: controller.registry,
          messages: controller.messages,
          interactions: host.interactions,
          isHostReady: () => true,
          acceptSend: text => controller.promptActive(text),
        })
        controller.setPanelHost(panel)
        const fake = new FakeWebviewPort()
        panel.attach(fake)
        controller.registry.setStatus(tab.tabId, 'running')
        panel.pushStatus()
        expect(panel.getOutboundLog().some(m => m.type === 'status/set' && m.status === 'generating')).toBe(true)
        controller.registry.setStatus(tab.tabId, 'idle')
        panel.pushStatus()
        const idle = [...panel.getOutboundLog()].reverse().find(m => m.type === 'status/set')
        expect(idle).toMatchObject({ status: 'idle' })
      })
    })

    describe('Enter / Shift+Enter (L3 runtime)', () => {
      it('CAP-CHAT-PANEL-019 resolveComposerKeydown: Enter sends non-empty; Shift+Enter is newline', () => {
        expect(resolveComposerKeydown({ key: 'Enter', shiftKey: false, text: 'hi' })).toBe('send')
        expect(resolveComposerKeydown({ key: 'Enter', shiftKey: true, text: 'hi' })).toBe('newline')
        expect(resolveComposerKeydown({ key: 'Enter', shiftKey: false, text: '  ' })).toBe('none')
        expect(resolveComposerKeydown({ key: 'Enter', shiftKey: false, text: 'hi', isComposing: true })).toBe('none')
        expect(resolveComposerKeydown({ key: 'a', shiftKey: false, text: 'hi' })).toBe('none')
      })

      it('CAP-CHAT-PANEL-020 HTML wires keydown to resolveComposerKeydown and only posts send on Enter', () => {
        const html = buildThinChatHtml()
        expect(html).toContain('resolveComposerKeydown')
        expect(html).toContain("action === 'send'")
        expect(html).toContain('keydown')
        expect(html).toContain("type: 'composer/send'")
      })
    })

    describe('safe Markdown', () => {
      it('CAP-CHAT-PANEL-021 renders headings, lists, and fenced code', () => {
        const md = [
          '# Title',
          '',
          '- one',
          '- two',
          '',
          '```ts',
          'const x = 1',
          '```',
        ].join('\n')
        const result = renderSafeMarkdown(md)
        expect(result.mode).toBe('markdown')
        expect(result.html).toContain('<h1 class="md-h">Title</h1>')
        expect(result.html).toContain('<ul class="md-list">')
        expect(result.html).toContain('<li>one</li>')
        expect(result.html).toContain('class="md-code"')
        expect(result.html).toContain('const x = 1')
        expect(result.html).toContain('copy-code')
        expect(containsUnsafeHtml(result.html)).toBe(false)
      })

      it('CAP-CHAT-PANEL-022 escapes malicious HTML/script and never loads external resources', () => {
        const evil = [
          '<script>alert(1)</script>',
          '<img src="https://evil.example/x.png" onerror="alert(1)">',
          'Hello <b onclick="x()">bold</b>',
        ].join('\n')
        const result = renderSafeMarkdown(evil)
        expect(containsUnsafeHtml(result.html)).toBe(false)
        expect(result.html.toLowerCase()).not.toContain('<script')
        expect(result.html.toLowerCase()).not.toMatch(/<img\b/)
        expect(result.html).toContain('&lt;script&gt;')
        // URL may appear as escaped plain text; must not appear as a live src/href attribute.
        expect(result.html).not.toMatch(/<[^>]+src\s*=\s*["']?\s*https:\/\/evil\.example/i)
      })

      it('CAP-CHAT-PANEL-023 Webview HTML embeds safeMarkdownBrowserSource helpers ( sync)', () => {
        const html = buildThinChatHtml('csp')
        const src = safeMarkdownBrowserSource()
        expect(html).toContain('function escapeHtml')
        expect(html).toContain('function renderSafeMarkdown')
        // Embedded browser source must appear in the HTML shell (drift guard).
        expect(html.includes(src.slice(0, 40).trim()) || html.includes('function escapeHtml')).toBe(true)
        expect(html).toContain('innerHTML')
      })

      it('CAP-CHAT-PANEL-024 browser-embedded MD source matches TS renderSafeMarkdown on shared fixtures', () => {
        const fixtures = [
          '# H\n\n- a\n- b\n\n```js\nalert(1)\n```',
          '<script>alert(1)</script>\n<img src="https://evil.example/x.png">',
          'plain only',
          '## Mid\n\n1. one\n2. two',
          '```\nunclosed fence still code',
        ]
        for (const f of fixtures) {
          const ts = renderSafeMarkdown(f)
          const br = renderViaBrowserSource(f)
          expect(br.html).toBe(ts.html)
          expect(br.mode).toBe(ts.mode)
          expect(containsUnsafeHtml(ts.html)).toBe(false)
          expect(containsUnsafeHtml(br.html)).toBe(false)
        }
        const a = renderSafeMarkdown('# A')
        const b = renderSafeMarkdown('# B')
        expect(a.html).not.toBe(b.html)
      })
    })

    describe('copy-code → dsh.copyToClipboard', () => {
      it('CAP-CHAT-PANEL-025 parses action/copy-code and Host invokes requestCopyCode', async () => {
        const parsed = parseWebviewToHostMessage({ type: 'action/copy-code', text: 'abc' })
        expect(parsed).toEqual({ type: 'action/copy-code', text: 'abc' })

        const copied: string[] = []
        const registry = new ConversationRegistry()
        const messages = new ConversationController({
          status: 'connected',
          interactions: { failClosedSession() {}, listPending() { return [] } },
          setConversationRegistry() {},
          onNotification() { return () => {} },
          async prompt() { return 'm' },
          async disposeSession() {},
        } as unknown as IdeSessionHost).messages
        const panel = new ChatPanelHost({
          registry,
          messages,
          isHostReady: () => true,
          acceptSend: async () => ({ messageId: 'm', sessionId: 's', tabId: 't' }),
          requestCopyCode: async (text) => { copied.push(text) },
        })
        const fake = new FakeWebviewPort()
        panel.attach(fake)
        fake.emitFromWebview({ type: 'action/copy-code', text: 'const x = 1' })
        await waitFor(() => copied.length === 1, 1_000)
        expect(copied).toEqual(['const x = 1'])
      })

      it('CAP-CHAT-PANEL-026 L2: executeCommand dsh.copyToClipboard writes clipboard', async () => {
        const writes: string[] = []
        const commands = new Map<string, (...args: unknown[]) => unknown>()
        const vscode = {
          window: {
            showErrorMessage: async () => undefined,
            showInformationMessage: async () => undefined,
            activeColorTheme: { kind: 2 },
            onDidChangeActiveColorTheme() { return { dispose() {} } },
          },
          workspace: { workspaceFolders: [{ uri: { fsPath: '/tmp/dsh-p3' } }] },
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
        const result = await vscode.commands.executeCommand('dsh.copyToClipboard', 'fenced-body')
        expect(result).toEqual({ ok: true })
        expect(writes).toEqual(['fenced-body'])
        expect(getChatPanelHost()).toBeDefined()
      })
    })

    describe('Conversations + History IA', () => {
      it('CAP-CHAT-PANEL-027 empty registry has no Start Session command-title stack; empty live shows 新对话', () => {
        const empty = conversationTreeItems({ tabs: [], activeTabId: undefined })
        expect(empty).toEqual([])
        expect(empty.every(i => i.label !== 'Start IDE Session…')).toBe(true)

        const registry = new ConversationRegistry()
        registry.create(EMPTY_LIVE_TITLE)
        const items = conversationTreeItems(registry.snapshot())
        expect(items).toHaveLength(1)
        expect(items[0]?.label).toBe(EMPTY_LIVE_TITLE)
      })

      it('CAP-CHAT-PANEL-028 History excludes empty-Tab placeholders', () => {
        expect(isHistoryEligibleSession({ title: EMPTY_LIVE_TITLE })).toBe(false)
        expect(isHistoryEligibleSession({ title: 'New conversation' })).toBe(false)
        expect(isHistoryEligibleSession({ title: EMPTY_LIVE_TITLE, firstUserPreview: 'hi' })).toBe(true)
        expect(isHistoryEligibleSession({ title: 'Real chat' })).toBe(true)

        const index = new ExtensionIndex('/ws')
        index.upsertSession({ sessionId: 'empty', title: EMPTY_LIVE_TITLE, mtime: 2 })
        index.upsertSession({ sessionId: 'real', title: 'Real', mtime: 1, firstUserPreview: 'hello' })
        const rows = listHistoryFromIndex(index)
        expect(rows.map(r => r.sessionId)).toEqual(['real'])
      })
    })

    describe('regression smoke', () => {
      it('CAP-CHAT-PANEL-029 composer/send still accepted on live Tab (send path)', async () => {
        const prompts: string[] = []
        const host = {
          status: 'connected' as const,
          interactions: { failClosedSession() {}, listPending() { return [] } },
          setConversationRegistry() {},
          onNotification() { return () => {} },
          async prompt(_sessionId: string, blocks: { text?: string }[]) {
            prompts.push(blocks[0]?.text ?? '')
            return 'msg-1'
          },
          async disposeSession() {},
        } as unknown as IdeSessionHost
        const controller = new ConversationController(host)
        const tab = controller.newConversation('live')
        const panel = new ChatPanelHost({
          registry: controller.registry,
          messages: controller.messages,
          interactions: host.interactions,
          isHostReady: () => true,
          acceptSend: text => controller.promptActive(text),
        })
        controller.setPanelHost(panel)
        const fake = new FakeWebviewPort()
        panel.attach(fake)
        fake.emitFromWebview({ type: 'composer/send', text: 'hello chassis' })
        await waitFor(() => controller.messages.hasContent(tab.sessionId), 1_000)
        expect(prompts).toEqual(['hello chassis'])
      })

      it('CAP-CHAT-PANEL-030 openFromHistory non-empty → mode=replay and rejects composer/send', async () => {
        const host = {
          status: 'connected' as const,
          interactions: { failClosedSession() {}, listPending() { return [] } },
          setConversationRegistry() {},
          onNotification() { return () => {} },
          async prompt() { return 'm' },
          async disposeSession() {},
        } as unknown as IdeSessionHost
        const controller = new ConversationController(host)
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
        const opened = await controller.openFromHistory('sess-p3-hist', { events })
        expect(opened.outcome).toBe('opened')
        if (opened.outcome !== 'opened') return
        expect(opened.mode).toBe('replay')
        expect(opened.messageCount).toBe(2)

        const panel = new ChatPanelHost({
          registry: controller.registry,
          messages: controller.messages,
          isHostReady: () => true,
          acceptSend: text => controller.promptActive(text),
        })
        controller.setPanelHost(panel)
        const fake = new FakeWebviewPort()
        panel.attach(fake)
        expect(fake.receivedFromHost.some(m => m.type === 'panel/state' && m.mode === 'replay')).toBe(true)

        panel.clearOutboundLog()
        fake.emitFromWebview({ type: 'composer/send', text: 'blocked' })
        await waitFor(() => panel.getOutboundLog().some(m => m.type === 'ui/reject-send'), 1_500)
        expect(panel.getOutboundLog().find(m => m.type === 'ui/reject-send')).toMatchObject({
          reason: 'replay',
        })
      })
    })

    describe('Host authority unchanged', () => {
      it('CAP-CHAT-PANEL-031 HTML does not invent local mode/session decisions beyond panel/state', () => {
        const html = buildThinChatHtml()
        expect(html).toContain("msg.type === 'panel/state'")
        expect(html).toContain('mode = msg.mode')
        // No secondary framework / React mount.
        expect(html).not.toContain('createRoot')
        expect(html).not.toContain('ReactDOM')
      })
    })

    /** Run the Webview-embedded MD source in vm (parity with TS module). */
    function renderViaBrowserSource(source: string): { html: string; mode: string } {
      const ctx = createContext({ encodeURIComponent, String })
      runInContext(`${safeMarkdownBrowserSource()}; this.__out = renderSafeMarkdown;`, ctx)
      const fn = (ctx as { __out: (s: string) => { html: string; mode: string } }).__out
      return fn(source)
    }
  })

  describe('phase5-should-polish.spec.ts', () => {
    afterEach(async () => {
      await deactivate()
    })

    describe('VP-CR-14a / safe Markdown table or link', () => {
      it('CAP-CHAT-PANEL-032 renders Markdown links readably; XSS probes stay blocked', () => {
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

      it('CAP-CHAT-PANEL-033 render failure falls back to safe plain text', () => {
        const broken = Object.create(null) as string
        const result = renderSafeMarkdown(broken)
        expect(result.mode).toBe('plain')
        expect(result.html).toContain('md-plain')
        expect(containsUnsafeHtml(result.html)).toBe(false)
      })

      it('CAP-CHAT-PANEL-034 browser-embedded MD source matches TS for link fixtures', () => {
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

    describe('VP-CR-14d / fenced language label', () => {
      it('CAP-CHAT-PANEL-035 shows visible language label when fence specifies lang; never invents', () => {
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

    describe('VP-CR-14b / Continue grey-state reason', () => {
      it('CAP-CHAT-PANEL-036 disabled chrome carries distinguishable reason tokens + adjacent copy', () => {
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

      it('CAP-CHAT-PANEL-037 L3 HTML shows continueReason beside Continue control', () => {
        const html = buildThinChatHtml()
        expect(html).toContain('id="continueReason"')
        expect(html).toContain('continueReason')
        expect(html).toMatch(/cont\.reasonText|reasonText/)
      })

      it('CAP-CHAT-PANEL-038 L2: controller maps live / unknown / host-not-ready to distinct reasons', () => {
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

    describe('VP-CR-14c / turn file-change entry', () => {
      it('CAP-CHAT-PANEL-039 counts unique files for latest turn; projects diff-summary only when N>0', () => {
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

      it('CAP-CHAT-PANEL-040 L2: assistant turn with diffs appends 「本回合改了 N 个文件」; zero diffs forges none', async () => {
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
        await controller.flushChangeSettles(tab.sessionId)
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
        await controller.flushChangeSettles(tab.sessionId)

        const msgs = controller.messages.get(tab.sessionId)
        const summary = msgs.find(m => m.kind === 'diff-summary')
        expect(summary).toBeDefined()
        expect(summary?.text).toMatch(/本回合改了\s*1\s*个文件/)
        expect(summary?.role).toBe('notice')
      })

      it('CAP-CHAT-PANEL-041 L3: diff-summary renders entry; reveal-change-list parses and reaches Host', async () => {
        const html = buildThinChatHtml()
        expect(html).toContain('diff-summary')
        expect(html).toContain('action/reveal-change-list')

        expect(parseWebviewToHostMessage({ type: 'action/reveal-change-list' })).toEqual({
          type: 'action/reveal-change-list',
        })
        // Secondary Timeline path remains parseable.
        expect(parseWebviewToHostMessage({ type: 'action/open-workspace-diffs' })).toEqual({
          type: 'action/open-workspace-diffs',
        })

        const revealed: string[] = []
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
        const panel = new ChatPanelHost({
          registry,
          messages: controller.messages,
          isHostReady: () => true,
          acceptSend: async () => ({ messageId: 'm', sessionId: tab.sessionId, tabId: tab.tabId }),
          requestRevealChangeList: async () => { revealed.push('reveal') },
          requestOpenWorkspaceDiffs: async () => { revealed.push('timeline') },
        })
        const fake = new FakeWebviewPort()
        panel.attach(fake)
        fake.emitFromWebview({ type: 'action/reveal-change-list' })
        await waitFor(() => revealed.length === 1, 1_000)
        expect(revealed).toEqual(['reveal'])
      })
    })

    describe('VP-CR-14e / unread discoverability', () => {
      it('CAP-CHAT-PANEL-042 unread mark is enhanced vs phase-3 baseline ●; clear-on-activate unchanged', () => {
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

    describe('VP-CR-13 / keybindings ≡ newConversation', () => {
      it('CAP-CHAT-PANEL-043 package.json contributes keybindings for dsh.newConversation; chrome button remains', async () => {
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

  })

  describe('layer-a/protocol-decision-smoke.spec.ts', () => {
    describe('layer-B panel/state decision authority', () => {
      it('CAP-CHAT-PANEL-061 FakeWebview mirrors Host mode only; empty send is Host-rejected', async () => {
        const prompts: string[] = []
        const registryHost = {
          status: 'connected' as const,
          interactions: { failClosedSession() {}, listPending() { return [] } },
          setConversationRegistry() {},
          onNotification() { return () => {} },
          async prompt(_sessionId: string, blocks: { text?: string }[]) {
            prompts.push(blocks[0]?.text ?? '')
            return 'msg-1'
          },
          async disposeSession() {},
        } as unknown as IdeSessionHost

        const controller = new ConversationController(registryHost)
        const tab = controller.newConversation('live')
        const panel = new ChatPanelHost({
          registry: controller.registry,
          messages: controller.messages,
          interactions: registryHost.interactions,
          isHostReady: () => registryHost.status === 'connected',
          acceptSend: text => controller.promptActive(text),
        })
        controller.setPanelHost(panel)
        const fake = new FakeWebviewPort()
        panel.attach(fake)

        expect(
          fake.receivedFromHost.some(m => m.type === 'panel/state' && m.mode === 'live'),
        ).toBe(true)
        expect(fake.receivedFromHost.some(m => m.type === 'messages/replace')).toBe(true)

        panel.clearOutboundLog()
        fake.receivedFromHost.length = 0
        fake.emitFromWebview({ type: 'composer/send', text: '  ' })
        await waitFor(() => panel.getOutboundLog().some(m => m.type === 'ui/reject-send'), 1_000)
        expect(panel.getOutboundLog().find(m => m.type === 'ui/reject-send')).toMatchObject({
          reason: 'empty',
        })
        expect(prompts).toEqual([])
        expect(tab.mode).toBe('live')

        // Optional Host-mirror probe seats are valid protocol fields (Webview must not invent).
        const probeFrame: HostToWebviewMessage = {
          type: 'panel/state',
          mode: 'replay',
          sessionId: tab.sessionId,
          probes: { parentReadonly: true, continueSealed: true },
        }
        fake.postMessage(probeFrame)
        const last = fake.receivedFromHost[fake.receivedFromHost.length - 1]
        expect(last).toMatchObject({
          type: 'panel/state',
          mode: 'replay',
          probes: { parentReadonly: true, continueSealed: true },
        })
      })
    })
  })

})
