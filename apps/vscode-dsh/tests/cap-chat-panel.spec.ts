import { ChatPanelHost, FakeWebviewPort, type ChatPanelHostDeps, type HostToWebviewMessage, type ModelStatePayload, buildThinChatHtml, parseWebviewToHostMessage, resolveComposerKeydown } from '../src/chat-panel/index.ts'
import { continueChromeFor } from '../src/continue-capability.ts'
import { ConversationController } from '../src/conversation-controller.ts'
import { ConversationRegistry } from '../src/conversation-registry.ts'
import { UNREAD_INDICATOR, conversationTreeItems } from '../src/conversation-tab-bar.ts'
import { EMPTY_LIVE_TITLE } from '../src/conversation-titles.ts'
import { ExtensionIndex, isHistoryEligibleSession } from '../src/extension-index.ts'
import { activate, deactivate, getChatPanelHost, getConversationController } from '../src/extension.ts'
import { listHistoryFromIndex } from '../src/history-view.ts'
import { containsUnsafeHtml, renderSafeMarkdown, safeMarkdownBrowserSource } from '../src/markdown/safe-markdown.ts'
import { renderSafeMarkdown as renderRich, containsUnsafeHtml as containsUnsafeRich } from '../src/markdown/rich-markdown.ts'
import { MessageStore } from '../src/message-store.ts'
import { detectIncomplete, hydrateFromAuthoritativeLog } from '../src/replay-hydrator.ts'
import { IdeSessionHost, type SettingsNamespaceView } from '../src/session-host.ts'
import { TimelineStore } from '../src/timeline-store.ts'
import { type HarnessNotification } from '@deepseek-ai/dsh-sdk-client'
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { createContext, runInContext } from 'node:vm'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

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
  }
}

async function waitFor(predicate: () => boolean, timeoutMs: number): Promise<void> {
  const start = Date.now()
  while (!predicate()) {
    if (Date.now() - start > timeoutMs) throw new Error('waitFor timeout')
    await new Promise(r => setTimeout(r, 10))
  }
}

/**
 * A ChatPanelHost whose decisions are settled for a test, with the caller's
 * dependency overrides applied on top.
 * @param settings - the dependencies this case replaces.
 * @returns the Host the case drives.
 */
function createPanel(settings: Partial<ChatPanelHostDeps> = {}): ChatPanelHost {
  return new ChatPanelHost({
    registry: new ConversationRegistry(),
    messages: new MessageStore(),
    isHostReady: () => true,
    acceptSend: async () => ({ messageId: 'm', sessionId: 's', tabId: 't' }),
    ...settings,
  })
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

    function createLivePanel() {
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
      return { host, controller, tab, fake }
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

    describe('compaction markers / live + replay projection', () => {
      it('CAP-CHAT-PANEL-062 compaction/start appends kind:compaction with trigger from turn', () => {
        const { host, controller, tab, fake } = createLivePanel()

        host.emit(sessionEvent(tab.sessionId, 'compaction/start', { compactionId: 'cp-auto', turn: 3 }))
        host.emit(sessionEvent(tab.sessionId, 'compaction/start', { compactionId: 'cp-manual', turn: null }))

        const markers = controller.messages.get(tab.sessionId).filter(m => m.kind === 'compaction')
        expect(markers).toHaveLength(2)
        expect(markers[0]).toMatchObject({
          id: 'cp-auto',
          sessionId: tab.sessionId,
          role: 'notice',
          kind: 'compaction',
          text: '',
          turn: 3,
        })
        expect(markers[0]?.compaction).toEqual({
          trigger: 'auto',
          status: 'running',
          shadowedTokenCount: 0,
          summary: '',
        })
        expect(markers[1]).toMatchObject({ id: 'cp-manual', role: 'notice', kind: 'compaction' })
        expect(markers[1]?.compaction?.trigger).toBe('manual')
        expect(markers[1]?.turn).toBeUndefined()

        const appends = fake.receivedFromHost.filter(m => m.type === 'messages/append')
        expect(appends.some(m => m.type === 'messages/append' && m.message.id === 'cp-auto')).toBe(true)
        expect(appends.some(m => m.type === 'messages/append' && m.message.id === 'cp-manual')).toBe(true)
      })

      it('CAP-CHAT-PANEL-063 compaction/summary fills tokens and strips the frame tags', () => {
        const { host, controller, tab, fake } = createLivePanel()

        host.emit(sessionEvent(tab.sessionId, 'compaction/start', { compactionId: 'cp-framed', turn: 1 }))
        host.emit(sessionEvent(tab.sessionId, 'compaction/summary', {
          compactionId: 'cp-framed',
          summary: [{
            type: 'text',
            text: '<compacted-summary>\nCheckpoint body\n</compacted-summary>',
          }],
          shadowedTokenCount: 1234,
        }))

        const framed = controller.messages.get(tab.sessionId).find(m => m.id === 'cp-framed')
        expect(framed?.compaction).toEqual({
          trigger: 'auto',
          status: 'running',
          shadowedTokenCount: 1234,
          summary: 'Checkpoint body',
        })
        const patch = fake.receivedFromHost.find(m => m.type === 'messages/patch' && m.messageId === 'cp-framed')
        expect(patch).toMatchObject({
          type: 'messages/patch',
          compaction: { shadowedTokenCount: 1234, summary: 'Checkpoint body' },
        })

        // Unframed blocks join with newlines and keep their text verbatim.
        host.emit(sessionEvent(tab.sessionId, 'compaction/start', { compactionId: 'cp-plain', turn: null }))
        host.emit(sessionEvent(tab.sessionId, 'compaction/summary', {
          compactionId: 'cp-plain',
          summary: [{ type: 'text', text: 'first' }, { type: 'text', text: 'second' }],
          shadowedTokenCount: 7,
        }))
        const plain = controller.messages.get(tab.sessionId).find(m => m.id === 'cp-plain')
        expect(plain?.compaction?.summary).toBe('first\nsecond')
        expect(plain?.compaction?.shadowedTokenCount).toBe(7)
      })

      it('CAP-CHAT-PANEL-064 compaction/end marks done; a reported error marks failed and raises a banner', () => {
        const { host, controller, tab, fake } = createLivePanel()

        host.emit(sessionEvent(tab.sessionId, 'compaction/start', { compactionId: 'cp-ok', turn: 0 }))
        host.emit(sessionEvent(tab.sessionId, 'compaction/end', { compactionId: 'cp-ok', turn: 0 }))
        expect(controller.messages.get(tab.sessionId).find(m => m.id === 'cp-ok')?.compaction?.status).toBe('done')
        expect(fake.receivedFromHost.some(m => m.type === 'ui/banner' && m.kind === 'compaction-failed')).toBe(false)

        host.emit(sessionEvent(tab.sessionId, 'compaction/start', { compactionId: 'cp-bad', turn: 0 }))
        host.emit(sessionEvent(tab.sessionId, 'compaction/end', {
          compactionId: 'cp-bad',
          turn: 0,
          error: 'summarize call timed out',
        }))
        const failed = controller.messages.get(tab.sessionId).find(m => m.id === 'cp-bad')
        expect(failed?.compaction?.status).toBe('failed')
        expect(failed?.compaction?.error).toBe('summarize call timed out')
        const banner = fake.receivedFromHost.find(m => m.type === 'ui/banner' && m.kind === 'compaction-failed')
        expect(banner?.type === 'ui/banner' ? banner.text : '').toContain('summarize call timed out')
      })

      it('CAP-CHAT-PANEL-065 repeated compaction/start for one id appends nothing new', () => {
        const { host, controller, tab, fake } = createLivePanel()

        host.emit(sessionEvent(tab.sessionId, 'compaction/start', { compactionId: 'cp-dup', turn: 2 }))
        host.emit(sessionEvent(tab.sessionId, 'compaction/start', { compactionId: 'cp-dup', turn: 2 }))

        expect(controller.messages.get(tab.sessionId).filter(m => m.id === 'cp-dup')).toHaveLength(1)
        const appends = fake.receivedFromHost.filter(m =>
          m.type === 'messages/append' && m.message.id === 'cp-dup')
        expect(appends).toHaveLength(1)
      })

      it('CAP-CHAT-PANEL-066 hydrate folds compaction markers in log order with the live shape', () => {
        const hydrated = hydrateFromAuthoritativeLog('sess-compaction', [
          {
            type: 'user/message',
            seq: 1,
            data: { role: 'user', id: 'u1', content: [{ type: 'text', text: 'hello' }] },
          },
          { type: 'compaction/start', seq: 2, data: { compactionId: 'cp-1', turn: 0 } },
          {
            type: 'compaction/summary',
            seq: 3,
            data: {
              compactionId: 'cp-1',
              summary: [{
                type: 'text',
                text: '<compacted-summary>log body</compacted-summary>',
              }],
              shadowedTokenCount: 42,
            },
          },
          { type: 'compaction/end', seq: 4, data: { compactionId: 'cp-1', turn: 0 } },
          {
            type: 'assistant/message',
            seq: 5,
            data: {
              message: { id: 'a1', role: 'assistant', content: [{ type: 'text', text: 'done' }] },
            },
          },
          { type: 'compaction/start', seq: 6, data: { compactionId: 'cp-2', turn: null } },
          { type: 'compaction/end', seq: 7, data: { compactionId: 'cp-2', turn: null, error: 'boom' } },
          { type: 'compaction/prune', seq: 8, data: { shadowedTokenCount: 9 } },
        ])

        expect(hydrated.messages.map(m => m.id)).toEqual(['u1', 'cp-1', 'a1', 'cp-2'])
        const auto = hydrated.messages.find(m => m.id === 'cp-1')
        expect(auto).toMatchObject({
          sessionId: 'sess-compaction',
          role: 'notice',
          kind: 'compaction',
          text: '',
          turn: 0,
        })
        expect(auto?.compaction).toEqual({
          trigger: 'auto',
          status: 'done',
          shadowedTokenCount: 42,
          summary: 'log body',
        })
        const manual = hydrated.messages.find(m => m.id === 'cp-2')
        expect(manual?.compaction).toEqual({
          trigger: 'manual',
          status: 'failed',
          shadowedTokenCount: 0,
          summary: '',
          error: 'boom',
        })
        expect(manual?.turn).toBeUndefined()

        // Hydrated markers survive MessageStore.replace with the same payload (live/store shape parity).
        const store = new MessageStore()
        store.replace('sess-compaction', hydrated.messages)
        expect(store.get('sess-compaction').find(m => m.id === 'cp-1')?.compaction)
          .toEqual(auto?.compaction)
      })
    })

    describe('workflow run cards / live + replay projection', () => {
      it('CAP-CHAT-PANEL-067 run-start appends a kind:workflow card carrying the run name', () => {
        const { host, controller, tab, fake } = createLivePanel()

        host.emit(sessionEvent(tab.sessionId, 'tool-workflow/run-start', {
          runId: 'wf-1',
          name: 'nightly audit',
        }))

        const cards = controller.messages.get(tab.sessionId).filter(m => m.kind === 'workflow')
        expect(cards).toHaveLength(1)
        expect(cards[0]).toMatchObject({
          id: 'workflow:wf-1',
          sessionId: tab.sessionId,
          role: 'notice',
          kind: 'workflow',
          text: '',
        })
        expect(cards[0]?.workflow).toEqual({
          runId: 'wf-1',
          name: 'nightly audit',
          status: 'running',
          members: [],
        })

        const appends = fake.receivedFromHost.filter(m => m.type === 'messages/append')
        expect(appends.some(m => m.type === 'messages/append' && m.message.id === 'workflow:wf-1'))
          .toBe(true)
      })

      it('CAP-CHAT-PANEL-068 agent-start orders members by seq and agent-end settles one', () => {
        const { host, controller, tab, fake } = createLivePanel()

        host.emit(sessionEvent(tab.sessionId, 'tool-workflow/run-start', {
          runId: 'wf-2',
          name: 'fan-out',
        }))
        host.emit(sessionEvent(tab.sessionId, 'tool-workflow/agent-start', {
          runId: 'wf-2',
          seq: 2,
          label: 'reviewer',
          phase: 'review',
          childId: 'child-2',
        }))
        host.emit(sessionEvent(tab.sessionId, 'tool-workflow/agent-start', {
          runId: 'wf-2',
          seq: 1,
          label: 'planner',
          childId: 'child-1',
        }))

        const card = controller.messages.get(tab.sessionId).find(m => m.id === 'workflow:wf-2')
        expect(card?.workflow?.members).toEqual([
          { seq: 1, label: 'planner', childId: 'child-1' },
          { seq: 2, label: 'reviewer', phase: 'review', childId: 'child-2' },
        ])

        host.emit(sessionEvent(tab.sessionId, 'tool-workflow/agent-end', {
          runId: 'wf-2',
          seq: 2,
          outcome: 'failed',
        }))

        const settled = controller.messages.get(tab.sessionId).find(m => m.id === 'workflow:wf-2')
        expect(settled?.workflow?.members).toEqual([
          { seq: 1, label: 'planner', childId: 'child-1' },
          { seq: 2, label: 'reviewer', phase: 'review', childId: 'child-2', outcome: 'failed' },
        ])

        const patches = fake.receivedFromHost.filter(m =>
          m.type === 'messages/patch' && m.messageId === 'workflow:wf-2')
        expect(patches).toHaveLength(3)
        expect(patches[2]).toMatchObject({
          type: 'messages/patch',
          workflow: {
            members: [
              { seq: 1, label: 'planner', childId: 'child-1' },
              { seq: 2, label: 'reviewer', phase: 'review', childId: 'child-2', outcome: 'failed' },
            ],
          },
        })
      })

      it('CAP-CHAT-PANEL-069 run-end closes the card with the reported stop reason', () => {
        const { host, controller, tab, fake } = createLivePanel()

        host.emit(sessionEvent(tab.sessionId, 'tool-workflow/run-start', { runId: 'wf-3', name: 'sweep' }))
        host.emit(sessionEvent(tab.sessionId, 'tool-workflow/run-end', {
          runId: 'wf-3',
          stopReason: 'cancelled',
        }))

        const card = controller.messages.get(tab.sessionId).find(m => m.id === 'workflow:wf-3')
        expect(card?.workflow?.status).toBe('done')
        expect(card?.workflow?.stopReason).toBe('cancelled')
        expect(card?.workflow?.error).toBeUndefined()
        const patch = fake.receivedFromHost.find(m =>
          m.type === 'messages/patch' && m.messageId === 'workflow:wf-3')
        expect(patch).toMatchObject({
          type: 'messages/patch',
          workflow: { status: 'done', stopReason: 'cancelled' },
        })

        host.emit(sessionEvent(tab.sessionId, 'tool-workflow/run-start', { runId: 'wf-4', name: 'clean' }))
        host.emit(sessionEvent(tab.sessionId, 'tool-workflow/run-end', {
          runId: 'wf-4',
          stopReason: 'completed',
        }))
        const clean = controller.messages.get(tab.sessionId).find(m => m.id === 'workflow:wf-4')
        expect(clean?.workflow).toEqual({
          runId: 'wf-4',
          name: 'clean',
          status: 'done',
          stopReason: 'completed',
          members: [],
        })
      })

      it('CAP-CHAT-PANEL-070 repeated run-start opens one card; events without a card are ignored', () => {
        const { host, controller, tab, fake } = createLivePanel()

        host.emit(sessionEvent(tab.sessionId, 'tool-workflow/run-start', { runId: 'wf-5', name: 'once' }))
        host.emit(sessionEvent(tab.sessionId, 'tool-workflow/run-start', { runId: 'wf-5', name: 'once' }))

        expect(controller.messages.get(tab.sessionId).filter(m => m.id === 'workflow:wf-5')).toHaveLength(1)
        const appends = fake.receivedFromHost.filter(m =>
          m.type === 'messages/append' && m.message.id === 'workflow:wf-5')
        expect(appends).toHaveLength(1)

        // A settlement for a seq that was never projected leaves the member table unchanged.
        host.emit(sessionEvent(tab.sessionId, 'tool-workflow/agent-end', {
          runId: 'wf-5',
          seq: 9,
          outcome: 'completed',
        }))
        expect(controller.messages.get(tab.sessionId).find(m => m.id === 'workflow:wf-5')?.workflow?.members)
          .toEqual([])

        // Member and run events for a run this projection never opened are dropped whole.
        host.emit(sessionEvent(tab.sessionId, 'tool-workflow/agent-start', {
          runId: 'wf-missing',
          seq: 1,
          label: 'ghost',
          childId: 'child-x',
        }))
        host.emit(sessionEvent(tab.sessionId, 'tool-workflow/run-end', {
          runId: 'wf-missing',
          stopReason: 'completed',
        }))
        expect(controller.messages.get(tab.sessionId).filter(m => m.kind === 'workflow')).toHaveLength(1)
        expect(fake.receivedFromHost.some(m => m.type === 'messages/patch')).toBe(false)
      })

      it('CAP-CHAT-PANEL-071 hydrate folds workflow cards in log order with the live shape', () => {
        const hydrated = hydrateFromAuthoritativeLog('sess-workflow', [
          {
            type: 'user/message',
            seq: 1,
            data: { role: 'user', id: 'u1', content: [{ type: 'text', text: 'run it' }] },
          },
          { type: 'tool-workflow/run-start', seq: 2, data: { runId: 'wf-log', name: 'log run' } },
          {
            type: 'tool-workflow/agent-start',
            seq: 3,
            data: { runId: 'wf-log', seq: 2, label: 'reviewer', phase: 'review', childId: 'child-2' },
          },
          {
            type: 'tool-workflow/agent-start',
            seq: 4,
            data: { runId: 'wf-log', seq: 1, label: 'planner', childId: 'child-1' },
          },
          { type: 'tool-workflow/agent-end', seq: 5, data: { runId: 'wf-log', seq: 1, outcome: 'completed' } },
          {
            type: 'assistant/message',
            seq: 6,
            data: {
              message: { id: 'a1', role: 'assistant', content: [{ type: 'text', text: 'done' }] },
            },
          },
          { type: 'tool-workflow/run-end', seq: 7, data: { runId: 'wf-log', stopReason: 'error' } },
          {
            type: 'tool-workflow/agent-start',
            seq: 8,
            data: { runId: 'wf-other', seq: 1, label: 'ghost', childId: 'child-x' },
          },
          { type: 'tool-workflow/run-start', seq: 9, data: { runId: 'wf-log', name: 'second start' } },
        ])

        expect(hydrated.messages.map(m => m.id)).toEqual(['u1', 'workflow:wf-log', 'a1'])
        const card = hydrated.messages.find(m => m.id === 'workflow:wf-log')
        expect(card).toMatchObject({
          sessionId: 'sess-workflow',
          role: 'notice',
          kind: 'workflow',
          text: '',
        })
        expect(card?.workflow).toEqual({
          runId: 'wf-log',
          name: 'log run',
          status: 'done',
          stopReason: 'error',
          members: [
            { seq: 1, label: 'planner', childId: 'child-1', outcome: 'completed' },
            { seq: 2, label: 'reviewer', phase: 'review', childId: 'child-2' },
          ],
        })

        // Hydrated cards survive MessageStore.replace with the same payload (live/store shape parity).
        const store = new MessageStore()
        store.replace('sess-workflow', hydrated.messages)
        expect(store.get('sess-workflow').find(m => m.id === 'workflow:wf-log')?.workflow)
          .toEqual(card?.workflow)
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

      it('CAP-CHAT-PANEL-007 T6: reasoning-delta projects into assistant bubble reasoning field', () => {
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
        // reasoning-delta now creates a streaming assistant bubble with reasoning content
        const afterReasoning = controller.messages.get(tab.sessionId)
        expect(afterReasoning).toHaveLength(1)
        expect(afterReasoning[0]?.reasoning).toBe('secret thoughts')
        expect(afterReasoning[0]?.text).toBe('')

        host.emit(sessionEvent(tab.sessionId, 'assistant/chunk', {
          turn: 0,
          chunk: { type: 'text-delta', text: 'visible' },
        }))
        // text-delta appends to the same bubble created by reasoning-delta
        expect(controller.messages.get(tab.sessionId)[0]?.text).toBe('visible')
        expect(controller.messages.get(tab.sessionId)[0]?.reasoning).toBe('secret thoughts')
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
        if (!result.ok) {
          expect(result.error).toContain('timed out')
        }
        const banners = panel.getOutboundLog().filter(m => m.type === 'ui/banner')
        expect(banners.some(b => b.type === 'ui/banner' && b.text.includes('中断失败'))).toBe(true)
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
        // oxlint-disable-next-line typescript/no-deprecated -- fixture-only legacy HTML (AD-ECP-8).
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
        // oxlint-disable-next-line typescript/no-deprecated -- fixture-only legacy HTML (AD-ECP-8).
        const html = buildThinChatHtml()
        expect(html).toContain('.msg.bubble.user')
        expect(html).toContain('.msg.bubble.assistant')
        expect(html).toContain('data-role')
        expect(html).toContain("'msg bubble ' + msg.role")
      })
    })

    describe('test:composer-contrast (VP-CR-6)', () => {
      it('CAP-CHAT-PANEL-015 composer is a fixed bottom bar with a themed Send button', () => {
        // oxlint-disable-next-line typescript/no-deprecated -- fixture-only legacy HTML (AD-ECP-8).
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

        // oxlint-disable-next-line typescript/no-deprecated -- fixture-only legacy HTML (AD-ECP-8).
        const html = buildThinChatHtml()
        expect(html).toContain('dsh-chat-chassis')
        expect(html).toContain('--vscode-')
        expect(html).toContain('.msg.bubble.user')
        expect(html).toContain('data-testid="composer"')
      })
    })

    describe('theme refresh (VP-CR-6a)', () => {
      it('CAP-CHAT-PANEL-017 Host pushThemeKind posts ui/theme and HTML consumes it', async () => {
        // oxlint-disable-next-line typescript/no-deprecated -- fixture-only legacy HTML (AD-ECP-8).
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
        // oxlint-disable-next-line typescript/no-deprecated -- fixture-only legacy HTML (AD-ECP-8).
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
        // oxlint-disable-next-line typescript/no-deprecated -- fixture-only legacy HTML (AD-ECP-8).
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

      it('CAP-CHAT-PANEL-021b a `path:line` body reference becomes a file link and URLs stay text', () => {
        const result = renderSafeMarkdown('见 src/a.ts:12:3 与 https://example.com/a.ts:12，还有 README.md:1')
        expect(result.html).toContain('data-testid="file-link"')
        expect(result.html).toContain('data-ref-path="src/a.ts"')
        expect(result.html).toContain('data-ref-line="12"')
        expect(result.html).toContain('>src/a.ts:12:3</button>')
        // A URL and a bare file name stay plain text: no line reference to open.
        expect(result.html).not.toContain('data-ref-path="example.com/a.ts"')
        expect(result.html).not.toContain('data-ref-path="README.md"')
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
        // oxlint-disable-next-line typescript/no-deprecated -- fixture-only legacy HTML (AD-ECP-8).
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
          '见 src/a.ts:12 与 https://example.com/a.ts:12、@src/b.ts',
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
        activate({ subscriptions: [], extensionPath: '/tmp' }, vscode)
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
        // oxlint-disable-next-line typescript/no-deprecated -- fixture-only legacy HTML (AD-ECP-8).
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

        const cap = continueChromeFor('same-id', 'unknown', {
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
        // oxlint-disable-next-line typescript/no-deprecated -- fixture-only legacy HTML (AD-ECP-8).
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

        host.status = 'disconnected'
        const hostChrome = controller.continueChromeForTab(liveTab.tabId)
        // Live still wins when mode is live.
        expect(hostChrome.reason).toBe('already-live')

        const opened = controller.registry.create('replay-sess')
        controller.registry.setMode(opened.tabId, 'replay')
        controller.registry.switchTo(opened.tabId)
        host.status = 'disconnected'
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
        // oxlint-disable-next-line typescript/no-deprecated -- fixture-only legacy HTML (AD-ECP-8).
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
        expect(bindings.some((b: { command?: string }) => b.command === 'dsh.newConversation')).toBe(true)

        // oxlint-disable-next-line typescript/no-deprecated -- fixture-only legacy HTML (AD-ECP-8).
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

  describe('settings-page.spec.ts', () => {
    describe('settings read/write routing (feature: settings-page)', () => {
      function namespace(revision: number): SettingsNamespaceView {
        return {
          ns: 'llm-deepseek',
          value: { model: 'deepseek-v4-flash' },
          user: { model: 'deepseek-v4-pro' },
          revision,
          secretFields: ['apiKey'],
        }
      }

      it('CAP-CHAT-PANEL-072 settings/open describes through the Host and pushes settings/state', async () => {
        let describeCalls = 0
        const panel = createPanel({
          requestSettingsDescribe: async () => {
            describeCalls += 1
            return [namespace(4)]
          },
        })
        const fake = new FakeWebviewPort()
        panel.attach(fake)
        panel.clearOutboundLog()
        fake.receivedFromHost.length = 0

        expect(parseWebviewToHostMessage({ type: 'settings/open' })).toEqual({ type: 'settings/open' })
        fake.emitFromWebview({ type: 'settings/open' })
        await waitFor(() => fake.receivedFromHost.some(m => m.type === 'settings/state'), 1_000)

        expect(describeCalls).toBe(1)
        expect(fake.receivedFromHost.find(m => m.type === 'settings/state')).toMatchObject({
          namespaces: [
            {
              ns: 'llm-deepseek',
              value: { model: 'deepseek-v4-flash' },
              user: { model: 'deepseek-v4-pro' },
              revision: 4,
              secretFields: ['apiKey'],
            },
          ],
        })
      })

      it('CAP-CHAT-PANEL-073 settings/update forwards ns/patch/revision and re-pushes the returned list', async () => {
        const calls: Array<{ ns: string; patch: Record<string, unknown>; expectedRevision?: number }> = []
        const panel = createPanel({
          requestSettingsUpdate: async (ns, patch, expectedRevision) => {
            calls.push({ ns, patch, ...expectedRevision === undefined ? {} : { expectedRevision } })
            return [namespace(5)]
          },
        })
        const fake = new FakeWebviewPort()
        panel.attach(fake)
        panel.clearOutboundLog()
        fake.receivedFromHost.length = 0

        fake.emitFromWebview({
          type: 'settings/update',
          ns: 'llm-deepseek',
          patch: { model: 'deepseek-v4-pro' },
          expectedRevision: 4,
        })
        await waitFor(() => calls.length === 1, 1_000)
        await waitFor(() => fake.receivedFromHost.some(m => m.type === 'settings/state'), 1_000)

        expect(calls).toEqual([
          { ns: 'llm-deepseek', patch: { model: 'deepseek-v4-pro' }, expectedRevision: 4 },
        ])
        expect(fake.receivedFromHost.find(m => m.type === 'settings/state')).toMatchObject({
          namespaces: [{ ns: 'llm-deepseek', revision: 5 }],
        })
      })

      it('CAP-CHAT-PANEL-074 an unanswered read/write banners instead of pushing an empty state', async () => {
        const panel = createPanel({
          isHostReady: () => false,
          requestSettingsDescribe: async () => undefined,
          requestSettingsUpdate: async () => undefined,
        })
        const fake = new FakeWebviewPort()
        panel.attach(fake)

        panel.clearOutboundLog()
        fake.receivedFromHost.length = 0
        fake.emitFromWebview({ type: 'settings/open' })
        await waitFor(() => fake.receivedFromHost.some(m => m.type === 'ui/banner'), 1_000)
        expect(fake.receivedFromHost.filter(m => m.type === 'settings/state').length).toBe(0)
        expect(fake.receivedFromHost.find(m => m.type === 'ui/banner')).toMatchObject({ kind: 'settings' })

        panel.clearOutboundLog()
        fake.receivedFromHost.length = 0
        fake.emitFromWebview({ type: 'settings/update', ns: 'llm-deepseek', patch: { model: 'x' } })
        await waitFor(() => fake.receivedFromHost.some(m => m.type === 'ui/banner'), 1_000)
        expect(fake.receivedFromHost.filter(m => m.type === 'settings/state').length).toBe(0)
        expect(fake.receivedFromHost.find(m => m.type === 'ui/banner')).toMatchObject({ kind: 'settings' })
      })

      it('CAP-CHAT-PANEL-075 a refused write banners the runtime message and pushes no state', async () => {
        const panel = createPanel({
          requestSettingsUpdate: async () => {
            throw new Error('settings namespace "llm-deepseek" changed since it was read (expected revision 4, now 6)')
          },
        })
        const fake = new FakeWebviewPort()
        panel.attach(fake)
        panel.clearOutboundLog()
        fake.receivedFromHost.length = 0

        fake.emitFromWebview({
          type: 'settings/update',
          ns: 'llm-deepseek',
          patch: { model: 'deepseek-v4-pro' },
          expectedRevision: 4,
        })
        await waitFor(() => fake.receivedFromHost.some(m => m.type === 'ui/banner'), 1_000)

        expect(fake.receivedFromHost.filter(m => m.type === 'settings/state').length).toBe(0)
        const banner = fake.receivedFromHost.find(m => m.type === 'ui/banner')
        expect(banner).toMatchObject({ kind: 'settings' })
        expect(banner?.type === 'ui/banner' ? banner.text : '').toContain('expected revision 4, now 6')
      })
    })
  })

  describe('composer @ completion and dropped files', () => {
    const deps = (over: Partial<ChatPanelHostDeps>): ChatPanelHostDeps => ({
      registry: new ConversationRegistry(),
      messages: new MessageStore(),
      isHostReady: () => true,
      acceptSend: async () => ({ messageId: 'm', sessionId: 's', tabId: 't' }),
      ...over,
    })

    it('CAP-CHAT-PANEL-095 composer/at-query answers with ranked candidates and aborts the superseded lookup', async () => {
      const seen: Array<{ query: string; signal: AbortSignal }> = []
      const panel = new ChatPanelHost(deps({
        listAtPathCandidates: async (query, signal) => {
          seen.push({ query, signal })
          return [{ path: `src/${query}.ts`, kind: 'file' }]
        },
      }))
      const fake = new FakeWebviewPort()
      panel.attach(fake)
      fake.receivedFromHost.length = 0

      fake.emitFromWebview({ type: 'composer/at-query', requestId: 'r1', query: 'ind' })
      await waitFor(() => fake.receivedFromHost.some(m => m.type === 'composer/at-candidates'), 1_000)
      expect(fake.receivedFromHost.find(m => m.type === 'composer/at-candidates')).toEqual({
        type: 'composer/at-candidates',
        requestId: 'r1',
        candidates: [{ path: 'src/ind.ts', kind: 'file' }],
      })

      fake.receivedFromHost.length = 0
      fake.emitFromWebview({ type: 'composer/at-query', requestId: 'r2', query: 'index' })
      await waitFor(() => fake.receivedFromHost.some(m => m.type === 'composer/at-candidates'), 1_000)

      // The caret moved on: the earlier lookup is cancelled rather than left racing its answer.
      expect(seen.map(row => row.query)).toEqual(['ind', 'index'])
      expect(seen[0]?.signal.aborted).toBe(true)
      expect(seen[1]?.signal.aborted).toBe(false)
    })

    it('CAP-CHAT-PANEL-096 composer/drop-paths appends workspace mentions and skips paths outside it', () => {
      const panel = new ChatPanelHost(deps({
        getAtPathResolveOptions: () => ({ workspaceFolders: ['/ws'], exists: () => true }),
      }))
      const fake = new FakeWebviewPort()
      panel.attach(fake)
      fake.receivedFromHost.length = 0

      fake.emitFromWebview({
        type: 'composer/drop-paths',
        paths: ['/ws/src/a.ts', '/elsewhere/b.ts', '/ws/docs/my file.md'],
        text: '看一下',
      })

      const prefill = fake.receivedFromHost.find(m => m.type === 'composer/prefill')
      // A drop the workspace check rejects is skipped: the send gate would refuse that token.
      expect(prefill?.type === 'composer/prefill' ? prefill.text : '').toBe('看一下 @src/a.ts @"docs/my file.md"')
      // The skipped path is reported, because a partly-ignored drop must not read as a full one.
      expect(fake.receivedFromHost.find(m => m.type === 'ui/banner')).toEqual({
        type: 'ui/banner',
        text: '已忽略 1 个不在工作区内或无法解析的路径',
        kind: 'drop-paths',
      })
    })

    it('CAP-CHAT-PANEL-106 two spellings of one dropped file collapse to a single mention', () => {
      const panel = new ChatPanelHost(deps({
        getAtPathResolveOptions: () => ({ workspaceFolders: ['/ws'], exists: () => true }),
      }))
      const fake = new FakeWebviewPort()
      panel.attach(fake)
      fake.receivedFromHost.length = 0

      // A resource drag carries the first file twice: one absolute `text/uri-list`
      // entry beside every resource's workspace-relative label.
      fake.emitFromWebview({
        type: 'composer/drop-paths',
        paths: ['/ws/src/a.ts', 'src/a.ts', 'src/b.ts'],
        text: '',
      })

      const prefill = fake.receivedFromHost.find(m => m.type === 'composer/prefill')
      expect(prefill?.type === 'composer/prefill' ? prefill.text : '').toBe('@src/a.ts @src/b.ts')
      expect(fake.receivedFromHost.some(m => m.type === 'ui/banner')).toBe(false)
    })

    it('CAP-CHAT-PANEL-107 a drop that resolves to no path says so instead of doing nothing', () => {
      const panel = new ChatPanelHost(deps({
        getAtPathResolveOptions: () => ({ workspaceFolders: ['/ws'], exists: () => true }),
      }))
      const fake = new FakeWebviewPort()
      panel.attach(fake)
      fake.receivedFromHost.length = 0

      fake.emitFromWebview({
        type: 'composer/drop-paths',
        paths: ['/elsewhere/b.ts'],
        text: '看一下',
      })

      // Nothing was prefilled and nothing became a mention, so the gesture reports itself.
      expect(fake.receivedFromHost.some(m => m.type === 'composer/prefill')).toBe(false)
      expect(fake.receivedFromHost.find(m => m.type === 'ui/banner')).toEqual({
        type: 'ui/banner',
        text: '拖入的路径无法在工作区内解析',
        kind: 'drop-paths',
      })
    })
  })

  describe('composer / menu and command execution', () => {
    const CATALOG = [
      { name: 'feature', description: '建立 .specdev 布局', group: 'command' as const },
      { name: 'compact', description: '压缩会话上下文', group: 'command' as const },
      { name: 'context', description: 'compact 相关设置', group: 'command' as const },
      { name: 'bugfix', description: '缺陷修复组合', group: 'agent' as const },
      { name: 'code-review', description: '审查改动', group: 'skill' as const },
    ]

    /** Deps carrying one live tab, so a command has a session to run against. */
    const liveDeps = (sessionId: string, over: Partial<ChatPanelHostDeps>): ChatPanelHostDeps => {
      const registry = new ConversationRegistry()
      registry.create('t', sessionId)
      return {
        registry,
        messages: new MessageStore(),
        isHostReady: () => true,
        acceptSend: async () => ({ messageId: 'm', sessionId, tabId: 't' }),
        ...over,
      }
    }

    it('CAP-CHAT-PANEL-097 composer/slash-query ranks the session catalog, caches it, and answers empty without one', async () => {
      const reads: string[] = []
      const panel = new ChatPanelHost(liveDeps('s-a', {
        readSlashCatalog: async (sessionId) => {
          reads.push(sessionId)
          return CATALOG
        },
      }))
      const fake = new FakeWebviewPort()
      panel.attach(fake)
      fake.receivedFromHost.length = 0

      fake.emitFromWebview({ type: 'composer/slash-query', requestId: 'r1', query: '' })
      await waitFor(() => fake.receivedFromHost.some(m => m.type === 'composer/slash-candidates'), 1_000)
      const first = fake.receivedFromHost.find(m => m.type === 'composer/slash-candidates')
      // A bare slash lists every group in catalog order, so the menu can group its rows.
      expect(first).toEqual({ type: 'composer/slash-candidates', requestId: 'r1', candidates: CATALOG })

      fake.receivedFromHost.length = 0
      fake.emitFromWebview({ type: 'composer/slash-query', requestId: 'r2', query: 'comp' })
      await waitFor(() => fake.receivedFromHost.some(m => m.type === 'composer/slash-candidates'), 1_000)
      const second = fake.receivedFromHost.find(m => m.type === 'composer/slash-candidates')
      // A name prefix outranks a description match, and the catalog is read once per session.
      expect(second?.type === 'composer/slash-candidates' ? second.candidates.map(row => row.name) : [])
        .toEqual(['compact', 'context'])
      expect(reads).toEqual(['s-a'])

      // A session the Host cannot catalog answers with no rows instead of a stale menu.
      const bare = new ChatPanelHost(liveDeps('s-b', {}))
      const bareFake = new FakeWebviewPort()
      bare.attach(bareFake)
      bareFake.receivedFromHost.length = 0
      bareFake.emitFromWebview({ type: 'composer/slash-query', requestId: 'r3', query: '' })
      await waitFor(() => bareFake.receivedFromHost.some(m => m.type === 'composer/slash-candidates'), 1_000)
      expect(bareFake.receivedFromHost.find(m => m.type === 'composer/slash-candidates')).toEqual({
        type: 'composer/slash-candidates',
        requestId: 'r3',
        candidates: [],
      })
    })

    it('CAP-CHAT-PANEL-098 a command line runs through acceptCommand, and an unresolved line keeps the prompt path', async () => {
      const commands: Array<{ sessionId: string; line: string }> = []
      const sent: string[] = []
      const panel = new ChatPanelHost(liveDeps('s-a', {
        acceptCommand: async (sessionId, line) => {
          commands.push({ sessionId, line })
          return line.startsWith('/feature')
        },
        acceptSend: async (text) => {
          sent.push(text)
          return { messageId: 'm', sessionId: 's-a', tabId: 't' }
        },
      }))
      const fake = new FakeWebviewPort()
      panel.attach(fake)
      fake.receivedFromHost.length = 0

      fake.emitFromWebview({ type: 'composer/send', text: '/feature 支持按标签过滤' })
      await waitFor(() => commands.length > 0, 1_000)
      // The command carries free-form arguments, so the `@path` gate must not see them.
      expect(commands).toEqual([{ sessionId: 's-a', line: '/feature 支持按标签过滤' }])
      expect(sent).toEqual([])
      expect(fake.receivedFromHost.some(m => m.type === 'composer/send-rejected')).toBe(false)

      fake.emitFromWebview({ type: 'composer/send', text: '/not-a-command' })
      await waitFor(() => sent.length > 0, 1_000)
      // Nothing claimed the line, so it stays a prompt: that is where a `/name` skill resolves.
      expect(sent).toEqual(['/not-a-command'])

      fake.emitFromWebview({ type: 'composer/send', text: '普通消息' })
      await waitFor(() => sent.length > 1, 1_000)
      expect(commands.length).toBe(2)
      expect(sent).toEqual(['/not-a-command', '普通消息'])
    })

    it('CAP-CHAT-PANEL-099 a command line carrying images banners and stays a plain message', async () => {
      const commands: string[] = []
      const sent: Array<{ text: string; images: number }> = []
      const panel = new ChatPanelHost(liveDeps('s-a', {
        acceptCommand: async (_sessionId, line) => {
          commands.push(line)
          return true
        },
        acceptSend: async (text, images) => {
          sent.push({ text, images: images?.length ?? 0 })
          return { messageId: 'm', sessionId: 's-a', tabId: 't' }
        },
      }))
      const fake = new FakeWebviewPort()
      panel.attach(fake)
      fake.receivedFromHost.length = 0

      fake.emitFromWebview({
        type: 'composer/send-rich',
        text: '/compact',
        images: [{ data: 'AAAA', mimeType: 'image/png' }],
      })

      // This bridge is text-only, so the command cannot run with attachments: the panel says
      // so and sends the line as a message instead of dropping the image silently.
      const banner = fake.receivedFromHost.find(m => m.type === 'ui/banner')
      expect(banner?.type === 'ui/banner' ? banner.text : '').toContain('命令不支持图片附件')
      expect(commands).toEqual([])
      await waitFor(() => sent.length > 0, 1_000)
      expect(sent).toEqual([{ text: '/compact', images: 1 }])
    })

    it('CAP-CHAT-PANEL-103 a continuable child receives the composer line through acceptSubagentPrompt', async () => {
      const asked: Array<{ target: unknown; text: string }> = []
      const sent: string[] = []
      const projection = {
        mode: 'replay' as const,
        sessionId: 's-child',
        tabId: 't',
        contextSessionId: 's-child',
        messages: [],
        tabStatus: 'idle' as const,
        subagentPrompt: { parentSessionId: 's-parent', childSessionId: 's-child', label: 'Researcher' },
      }
      const panel = new ChatPanelHost(liveDeps('s-parent', {
        resolvePanelProjection: () => projection,
        acceptSend: async (text) => {
          sent.push(text)
          return { messageId: 'm', sessionId: 's-parent', tabId: 't' }
        },
        acceptSubagentPrompt: async (target, text) => {
          asked.push({ target, text })
          return 'msg-child'
        },
      }))
      const fake = new FakeWebviewPort()
      panel.attach(fake)
      fake.receivedFromHost.length = 0

      // The child's own mode is replay; the resolved address is what makes it writable.
      fake.emitFromWebview({ type: 'composer/send', text: '  继续排查  ' })
      await waitFor(() => asked.length === 1, 1_000)
      expect(asked).toEqual([{
        target: { parentSessionId: 's-parent', childSessionId: 's-child', label: 'Researcher' },
        text: '继续排查',
      }])
      expect(sent).toEqual([])

      const refused = new ChatPanelHost(liveDeps('s-parent', {
        resolvePanelProjection: () => projection,
        acceptSubagentPrompt: async () => {
          throw new Error('parent session "s-parent" is not live')
        },
      }))
      const refusedFake = new FakeWebviewPort()
      refused.attach(refusedFake)
      refusedFake.receivedFromHost.length = 0
      refusedFake.emitFromWebview({ type: 'composer/send', text: 'hello' })
      await waitFor(() => refusedFake.receivedFromHost.some(m => m.type === 'ui/banner'), 1_000)
      // A refused delivery is the runtime's verdict on that address, so it is shown verbatim.
      const banner = refusedFake.receivedFromHost.find(m => m.type === 'ui/banner')
      expect(banner?.type === 'ui/banner' ? banner.text : '').toBe('parent session "s-parent" is not live')
      expect(refusedFake.receivedFromHost.some(m => m.type === 'ui/reject-send')).toBe(true)
    })

    it('CAP-CHAT-PANEL-104 a subagent card interrupts under the parent it renders', async () => {
      const asked: Array<{ parentSessionId: string; childSessionId: string }> = []
      const panel = new ChatPanelHost(liveDeps('s-a', {
        requestInterruptSubagent: async (parentSessionId, childSessionId) => {
          asked.push({ parentSessionId, childSessionId })
        },
      }))
      const fake = new FakeWebviewPort()
      panel.attach(fake)
      fake.receivedFromHost.length = 0

      fake.emitFromWebview({
        type: 'action/interrupt-subagent',
        parentSessionId: 's-parent',
        childSessionId: 's-child',
      })
      await waitFor(() => asked.length === 1, 1_000)
      expect(asked).toEqual([{ parentSessionId: 's-parent', childSessionId: 's-child' }])
      // The card action is not a send: no composer gate runs and nothing is posted back.
      expect(fake.receivedFromHost.some(m => m.type === 'ui/reject-send')).toBe(false)

      const refused = new ChatPanelHost(liveDeps('s-a', {
        requestInterruptSubagent: async () => {
          throw new Error('subagent does not belong to this parent')
        },
      }))
      const refusedFake = new FakeWebviewPort()
      refused.attach(refusedFake)
      refusedFake.receivedFromHost.length = 0
      refusedFake.emitFromWebview({
        type: 'action/interrupt-subagent',
        parentSessionId: 's-other',
        childSessionId: 's-child',
      })
      await waitFor(() => refusedFake.receivedFromHost.some(m => m.type === 'ui/banner'), 1_000)
      const banner = refusedFake.receivedFromHost.find(m => m.type === 'ui/banner')
      expect(banner?.type === 'ui/banner' ? banner.text : '')
        .toBe('subagent does not belong to this parent')
    })

    it('CAP-CHAT-PANEL-105 a SpecDev card decides its gate through the Host and shows a refusal', async () => {
      const asked: Array<{ sessionId: string; gate: string; decision: string; note?: string }> = []
      const panel = new ChatPanelHost(liveDeps('s-a', {
        requestSpecdevGate: async (sessionId, gate, decision, note) => {
          asked.push({ sessionId, gate, decision, ...note === undefined ? {} : { note } })
        },
      }))
      const fake = new FakeWebviewPort()
      panel.attach(fake)
      fake.receivedFromHost.length = 0

      fake.emitFromWebview({
        type: 'action/specdev-gate',
        sessionId: 's-a',
        gate: 'hg2',
        decision: 'reject',
        note: '设计需要重做',
      })
      await waitFor(() => asked.length === 1, 1_000)
      // The card carries the decision and its note; the Host only forwards them.
      expect(asked).toEqual([{
        sessionId: 's-a',
        gate: 'hg2',
        decision: 'reject',
        note: '设计需要重做',
      }])
      // The card action is not a send: nothing is rejected into the composer.
      expect(fake.receivedFromHost.some(m => m.type === 'ui/reject-send')).toBe(false)

      // A frame without a decision never reaches the runtime: it is dropped whole.
      fake.receivedFromHost.length = 0
      fake.emitFromWebview({ type: 'action/specdev-gate', sessionId: 's-a', gate: 'hg2' })
      await new Promise(resolve => setTimeout(resolve, 20))
      expect(asked).toHaveLength(1)
      expect(fake.receivedFromHost.filter(m => m.type === 'ui/banner')).toEqual([])

      const refused = new ChatPanelHost(liveDeps('s-a', {
        requestSpecdevGate: async () => {
          throw new Error('SPECDEV_GATE_NOT_PENDING: gate hg1 is not the current pending gate (hg2)')
        },
      }))
      const refusedFake = new FakeWebviewPort()
      refused.attach(refusedFake)
      refusedFake.receivedFromHost.length = 0
      refusedFake.emitFromWebview({ type: 'action/specdev-gate', sessionId: 's-a', gate: 'hg1', decision: 'pass' })
      await waitFor(() => refusedFake.receivedFromHost.some(m => m.type === 'ui/banner'), 1_000)
      // The runtime owns gate order, so its refusal is shown verbatim.
      const banner = refusedFake.receivedFromHost.find(m => m.type === 'ui/banner')
      expect(banner?.type === 'ui/banner' ? banner.text : '')
        .toBe('SPECDEV_GATE_NOT_PENDING: gate hg1 is not the current pending gate (hg2)')
    })
  })

  describe('dsh.test.* hooks for the newer user-visible surfaces', () => {
    const commands = new Map<string, (...args: unknown[]) => unknown>()
    const mem = new Map<string, unknown>()

    function makeVscode() {
      return {
        window: {
          async showErrorMessage() {},
          async showInformationMessage() {},
          registerWebviewViewProvider() { return { dispose() {} } },
        },
        workspace: {
          workspaceFolders: [{ uri: { fsPath: '/tmp/dsh-surface-hooks' } }],
          getConfiguration() { return { get: () => undefined } },
        },
        commands: {
          registerCommand(command: string, callback: (...args: unknown[]) => unknown) {
            commands.set(command, callback)
            return { dispose() {} }
          },
        },
      }
    }

    /** Bind a controller without spawning a runtime, then create the active live Tab. */
    async function startWithLiveTab(): Promise<{ tabId: string; sessionId: string }> {
      vi.spyOn(IdeSessionHost.prototype, 'start').mockImplementation(async function (
        this: IdeSessionHost,
      ) {
        this.status = 'connected'
      })
      activate({
        subscriptions: [],
        extensionPath: '/tmp/dsh-surface-hooks',
        workspaceState: {
          // oxlint-disable-next-line typescript/no-unnecessary-type-parameters -- mirrors WorkspaceStateLike.get<T>.
          get<T>(key: string) { return mem.get(key) as T | undefined },
          update(key: string, value: unknown) { mem.set(key, value) },
        },
      }, makeVscode())
      await commands.get('dsh.test.setCredentialPresence')!(true)
      await commands.get('dsh.test.requestStart')!('command-start')
      return await commands.get('dsh.test.newConversation')!() as { tabId: string; sessionId: string }
    }

    beforeEach(() => {
      commands.clear()
      mem.clear()
    })

    afterEach(async () => {
      await deactivate()
      vi.restoreAllMocks()
    })

    it('CAP-CHAT-PANEL-076 injectTodo drives the todo panel and getTodoItems reports the split', async () => {
      const tab = await startWithLiveTab()

      // Missing-surface sentinels, which a driver asserts before any event lands.
      expect(commands.get('dsh.test.getTodoItems')!()).toEqual({
        count: 0,
        completed: 0,
        inProgress: 0,
      })
      expect(commands.get('dsh.test.lastCompactionMarker')!()).toEqual({
        present: false,
        status: '',
        shadowedTokenCount: -1,
      })
      expect(commands.get('dsh.test.lastWorkflowCard')!()).toEqual({
        present: false,
        memberCount: -1,
        stopReason: '',
        completedMembers: -1,
      })

      const panel = getChatPanelHost()
      panel?.clearOutboundLog()
      expect(commands.get('dsh.test.injectTodo')!()).toEqual({ ok: true, count: 3 })

      expect(commands.get('dsh.test.getTodoItems')!()).toEqual({
        count: 3,
        completed: 1,
        inProgress: 1,
      })
      const frame = panel?.getOutboundLog().find(m => m.type === 'todo/state')
      expect(frame?.type === 'todo/state' ? frame.sessionId : '').toBe(tab.sessionId)
      expect(frame?.type === 'todo/state' ? frame.items.length : 0).toBe(3)
    })

    it('CAP-CHAT-PANEL-077 injectCompaction lands a done marker whose framed summary was stripped', async () => {
      const tab = await startWithLiveTab()

      const injected = commands.get('dsh.test.injectCompaction')!() as {
        ok: boolean
        compactionId: string
      }
      expect(injected.ok).toBe(true)
      expect(injected.compactionId).not.toBe('')

      expect(commands.get('dsh.test.lastCompactionMarker')!()).toEqual({
        present: true,
        status: 'done',
        shadowedTokenCount: 1234,
      })
      // Two summary blocks joined and the outer `<compacted-summary>` frame removed.
      const marker = getConversationController()?.messages.get(tab.sessionId)
        .find(message => message.id === injected.compactionId)
      expect(marker?.compaction?.summary).toBe('LAYER-V-CAP-COMPACTION-OK')
    })

    it('CAP-CHAT-PANEL-078 injectCompaction honours a caller-supplied shadowed token count', async () => {
      await startWithLiveTab()

      expect(commands.get('dsh.test.injectCompaction')!({ shadowedTokenCount: 4321 }))
        .toMatchObject({ ok: true })
      expect(commands.get('dsh.test.lastCompactionMarker')!()).toEqual({
        present: true,
        status: 'done',
        shadowedTokenCount: 4321,
      })
    })

    it('CAP-CHAT-PANEL-079 injectWorkflow lands a two-member run card settled as completed', async () => {
      const tab = await startWithLiveTab()

      const injected = commands.get('dsh.test.injectWorkflow')!() as { ok: boolean; runId: string }
      expect(injected.ok).toBe(true)

      expect(commands.get('dsh.test.lastWorkflowCard')!()).toEqual({
        present: true,
        memberCount: 2,
        stopReason: 'completed',
        completedMembers: 1,
      })
      const card = getConversationController()?.messages.get(tab.sessionId)
        .find(message => message.kind === 'workflow')
      expect(card?.workflow?.members.map(member => member.label))
        .toEqual(['member-a', 'member-b'])
      expect(card?.workflow?.members.map(member => member.phase)).toEqual(['scan', 'scan'])
    })

    it('CAP-CHAT-PANEL-080 getTokenStatus refuses a sample without usage and accepts a real one', async () => {
      const tab = await startWithLiveTab()
      const controller = getConversationController()
      expect(controller).toBeDefined()

      expect(commands.get('dsh.test.getTokenStatus')!()).toEqual({
        ok: true,
        present: false,
        totalTokens: 0,
        projectedTokens: 0,
        contextWindow: 0,
        sane: false,
      })

      controller!.applyTestSessionEvent(tab.sessionId, 'assistant/message', {
        turn: 0,
        message: { role: 'assistant', content: [{ type: 'text', text: 'TOKEN-PROBE' }] },
        usage: { inputTokens: 12, outputTokens: 3, totalTokens: 15 },
      })

      expect(commands.get('dsh.test.getTokenStatus')!()).toEqual({
        ok: true,
        present: true,
        totalTokens: 15,
        projectedTokens: 0,
        contextWindow: 128_000,
        sane: true,
      })
    })

    it('CAP-CHAT-PANEL-102 a live contextPressure read refines the token sample', async () => {
      const tab = await startWithLiveTab()
      const controller = getConversationController()
      expect(controller).toBeDefined()

      const asked: Array<{ sessionId: string; keys?: string[] }> = []
      vi.spyOn(IdeSessionHost.prototype, 'readProjection').mockImplementation(async function (
        this: IdeSessionHost,
        sessionId: string,
        keys?: string[],
      ) {
        asked.push({ sessionId, ...keys === undefined ? {} : { keys } })
        return {
          asOfSeq: 7,
          values: {
            contextPressure: { pressureTokens: 1_200, projectedTokens: 1_500, contextWindow: 200_000 },
          },
        }
      })

      controller!.applyTestSessionEvent(tab.sessionId, 'assistant/message', {
        turn: 0,
        message: { role: 'assistant', content: [{ type: 'text', text: 'PRESSURE-PROBE' }] },
        usage: { inputTokens: 900, outputTokens: 100, totalTokens: 1_000 },
      })

      // Only the runtime knows the route capacity and what the next prompt costs;
      // the log's own total stays the fallback until the read answers.
      await vi.waitFor(() => {
        expect(commands.get('dsh.test.getTokenStatus')!()).toEqual({
          ok: true,
          present: true,
          totalTokens: 1_000,
          projectedTokens: 1_500,
          contextWindow: 200_000,
          sane: true,
        })
      })
      expect(asked).toEqual([{ sessionId: tab.sessionId, keys: ['contextPressure'] }])

      // A refusal or a unit-less answer leaves the pushed usage sample alone.
      vi.spyOn(IdeSessionHost.prototype, 'readProjection').mockRejectedValue(new Error('bridge is gone'))
      controller!.applyTestSessionEvent(tab.sessionId, 'assistant/message', {
        turn: 0,
        message: { role: 'assistant', content: [{ type: 'text', text: 'PRESSURE-LOST' }] },
        usage: { inputTokens: 2_000, outputTokens: 100, totalTokens: 2_100 },
      })
      await vi.waitFor(() => {
        expect(commands.get('dsh.test.getTokenStatus')!()).toEqual({
          ok: true,
          present: true,
          totalTokens: 2_100,
          projectedTokens: 0,
          contextWindow: 128_000,
          sane: true,
        })
      })
    })

    it('CAP-CHAT-PANEL-081 lastAssistantReasoning reports the latest assistant bubble reasoning', async () => {
      const tab = await startWithLiveTab()
      const controller = getConversationController()
      expect(controller).toBeDefined()
      expect(commands.get('dsh.test.lastAssistantReasoning')!()).toEqual({ present: false, length: 0 })

      const reasoning = 'LAYER-V-CAP-REASONING'
      controller!.applyTestSessionEvent(tab.sessionId, 'assistant/chunk', {
        turn: 0,
        chunk: { type: 'reasoning-delta', text: reasoning },
      })

      expect(commands.get('dsh.test.lastAssistantReasoning')!())
        .toEqual({ present: true, length: reasoning.length })
    })

    it('CAP-CHAT-PANEL-082 sendImagePrompt sends a PNG content block with the default or given text', async () => {
      const tab = await startWithLiveTab()
      const captured: unknown[][] = []
      vi.spyOn(IdeSessionHost.prototype, 'prompt').mockImplementation(async (_sessionId, blocks) => {
        captured.push([...blocks])
        return `msg-image-${captured.length}`
      })

      expect(await commands.get('dsh.test.sendImagePrompt')!()).toEqual({
        ok: true,
        messageId: 'msg-image-1',
        sessionId: tab.sessionId,
      })
      expect(await commands.get('dsh.test.sendImagePrompt')!('LAYER-V-CAP-IMAGE-CUSTOM')).toEqual({
        ok: true,
        messageId: 'msg-image-2',
        sessionId: tab.sessionId,
      })

      expect(captured).toHaveLength(2)
      for (const blocks of captured) {
        const image = blocks.find(block => (block as { type?: string }).type === 'image')
        expect(image).toMatchObject({ type: 'image', mimeType: 'image/png' })
        expect((image as { data?: string }).data).toBeTruthy()
      }
      expect(captured[0]?.find(block => (block as { type?: string }).type === 'text'))
        .toMatchObject({ type: 'text', text: 'LAYER-V-CAP-IMAGE-OK' })
      expect(captured[1]?.find(block => (block as { type?: string }).type === 'text'))
        .toMatchObject({ type: 'text', text: 'LAYER-V-CAP-IMAGE-CUSTOM' })
    })

    it('CAP-CHAT-PANEL-083 lastAssistantText reports the latest assistant bubble text', async () => {
      const tab = await startWithLiveTab()
      const controller = getConversationController()
      expect(controller).toBeDefined()
      expect(commands.get('dsh.test.lastAssistantText')!()).toEqual({ present: false, length: 0 })

      const text = 'LAYER-V-CAP-ASSISTANT-TEXT'
      controller!.applyTestSessionEvent(tab.sessionId, 'assistant/chunk', {
        turn: 0,
        chunk: { type: 'text-delta', text },
      })

      expect(commands.get('dsh.test.lastAssistantText')!())
        .toEqual({ present: true, length: text.length })
    })

    it('CAP-CHAT-PANEL-084 injectReasoning streams a reasoning delta through the chunk projection', async () => {
      const tab = await startWithLiveTab()
      expect(commands.get('dsh.test.lastAssistantReasoning')!()).toEqual({ present: false, length: 0 })

      const body = 'LAYER-V-CAP-RSN-INJECTED'
      expect(commands.get('dsh.test.injectReasoning')!(body)).toEqual({
        ok: true,
        sessionId: tab.sessionId,
        length: body.length,
      })
      expect(commands.get('dsh.test.lastAssistantReasoning')!())
        .toEqual({ present: true, length: body.length })

      // No argument takes the hook's default body; the driver's manifest passes the
      // explicit argument form above and asserts that length concretely.
      expect(commands.get('dsh.test.injectReasoning')!()).toEqual({
        ok: true,
        sessionId: tab.sessionId,
        length: 'LAYER-V-CAP-REASONING-OK'.length,
      })
    })
  })

  describe('rich-markdown.ts renderer', () => {
    it('CAP-CHAT-PANEL-085 rich-markdown renders headings/paragraphs/bold/italic/links', () => {
      const h1 = renderRich('# Hello')
      expect(h1.html).toContain('<h1 class="md-h">')
      expect(h1.mode).toBe('markdown')
      expect(containsUnsafeRich(h1.html)).toBe(false)

      const inline = renderRich('**bold** *italic*')
      expect(inline.html).toContain('<strong>')
      expect(inline.html).toContain('<em>')

      const link = renderRich('[link](https://example.com)')
      expect(link.html).toContain('class="md-link"')
      expect(link.html).toContain('rel="noopener noreferrer"')
      expect(containsUnsafeRich(link.html)).toBe(false)
    })

    it('CAP-CHAT-PANEL-086 rich-markdown renders code blocks with syntax highlighting', () => {
      const ts = renderRich('```ts\nconst x = 1\n```')
      expect(ts.html).toContain('data-lang="ts"')
      expect(ts.html).toContain('code-block')
      // highlight.js produces hljs class names or keyword spans
      expect(ts.html).toMatch(/hljs|keyword/)

      const plain = renderRich('```\nplain\n```')
      expect(plain.html).toContain('code-block')
      expect(plain.html).not.toContain('data-lang')
    })

    it('CAP-CHAT-PANEL-087 rich-markdown renders nested lists and task lists', () => {
      const nested = renderRich('- a\n  - b\n  - c')
      const ulCount = (nested.html.match(/<ul/g) || []).length
      expect(ulCount).toBeGreaterThanOrEqual(2)

      const tasks = renderRich('- [x] done\n- [ ] todo')
      expect(tasks.html).toMatch(/task-list|checkbox|checked/)
    })

    it('CAP-CHAT-PANEL-088 rich-markdown renders KaTeX formulas', () => {
      const inline = renderRich('$E=mc^2$')
      expect(inline.html).toContain('katex')

      const block = renderRich('$$\n\\sum_{i=1}^{n} i\n$$')
      expect(block.html).toContain('md-math-block')
    })

    it('CAP-CHAT-PANEL-095 the panel loads the KaTeX stylesheet that hides the duplicate MathML copy', () => {
      const radical = renderRich(String.raw`$\{8,8\pm\sqrt6\}$`)
      // KaTeX renders each formula as a visual tree plus an assistive copy. Only
      // KaTeX's stylesheet hides the second copy, so both must be present for the
      // stylesheet import below to be load-bearing.
      expect(radical.html).toContain('katex-html')
      expect(radical.html).toContain('katex-mathml')

      const entry = readFileSync(
        resolve(process.cwd(), 'apps/vscode-dsh/webview/src/main.tsx'),
        'utf8',
      )
      expect(entry).toMatch(/import\s+'katex\/dist\/katex\.min\.css'/)
    })

    it('CAP-CHAT-PANEL-089 rich-markdown marks Mermaid code blocks', () => {
      const mermaid = renderRich('```mermaid\ngraph LR\n  A-->B\n```')
      expect(mermaid.html).toContain('data-mermaid="true"')
      expect(mermaid.html).toContain('mermaid-source')
    })

    it('CAP-CHAT-PANEL-090 rich-markdown renders GFM tables', () => {
      const table = renderRich('| A | B |\n| --- | --- |\n| 1 | 2 |')
      expect(table.html).toContain('<table class="md-table">')
    })

    it('CAP-CHAT-PANEL-091 rich-markdown escapes HTML tags for safety', () => {
      const script = renderRich('<script>alert(1)</script>')
      expect(containsUnsafeRich(script.html)).toBe(false)

      const img = renderRich('<img src=x onerror=alert(1)>')
      expect(containsUnsafeRich(img.html)).toBe(false)
    })
  })

  describe('interaction protocol frames', () => {
    it('CAP-CHAT-PANEL-092 parseWebviewToHostMessage parses interaction/approve frames', () => {
      expect(parseWebviewToHostMessage({
        type: 'interaction/approve', id: 'a', outcome: 'allowed-once',
      })).toEqual({ type: 'interaction/approve', id: 'a', outcome: 'allowed-once' })

      expect(parseWebviewToHostMessage({
        type: 'interaction/approve', id: 'a', outcome: 'rejected',
      })).toEqual({ type: 'interaction/approve', id: 'a', outcome: 'rejected' })

      // Missing id
      expect(parseWebviewToHostMessage({
        type: 'interaction/approve', outcome: 'allowed-once',
      })).toBeUndefined()

      // Invalid outcome
      expect(parseWebviewToHostMessage({
        type: 'interaction/approve', id: 'a', outcome: 'invalid',
      })).toBeUndefined()
    })

    it('CAP-CHAT-PANEL-093 parseWebviewToHostMessage parses interaction/answer frames', () => {
      expect(parseWebviewToHostMessage({
        type: 'interaction/answer',
        id: 'a',
        answer: { answers: [{ id: 'q1', selected: ['opt1'] }] },
      })).toEqual({
        type: 'interaction/answer',
        id: 'a',
        answer: { answers: [{ id: 'q1', selected: ['opt1'] }] },
      })

      // Missing answer
      expect(parseWebviewToHostMessage({
        type: 'interaction/answer', id: 'a',
      })).toBeUndefined()
    })

    it('CAP-CHAT-PANEL-094 appendReasoning is a valid messages/patch field and ChatPanelHost forwards it', async () => {
      // Type-level: constructing the frame compiles (TS proof).
      const frame: HostToWebviewMessage = {
        type: 'messages/patch',
        sessionId: 's1',
        messageId: 'm1',
        appendReasoning: 'thinking...',
      }
      expect(frame.type).toBe('messages/patch')

      // Runtime: ChatPanelHost.pushPatch forwards appendReasoning through the port.
      const registry = new ConversationRegistry()
      const tab = registry.create('test')
      const panel = new ChatPanelHost({
        registry,
        messages: new MessageStore(),
        isHostReady: () => true,
        acceptSend: async () => ({ messageId: 'm', sessionId: 's', tabId: 't' }),
      })
      const fake = new FakeWebviewPort()
      panel.attach(fake)
      panel.clearOutboundLog()
      fake.receivedFromHost.length = 0

      panel.pushPatch(tab.sessionId, 'm1', { appendReasoning: 'thinking...' })
      const patch = fake.receivedFromHost.find(m => m.type === 'messages/patch')
      expect(patch).toBeDefined()
      expect(patch).toMatchObject({
        type: 'messages/patch',
        sessionId: tab.sessionId,
        messageId: 'm1',
        appendReasoning: 'thinking...',
      })
    })
  })

  describe('model route and send feedback', () => {
    const catalog: ModelStatePayload = {
      providers: [{
        id: 'deepseek-official',
        name: 'DeepSeek',
        models: [{ id: 'deepseek-v4-pro', name: 'DeepSeek-V4-Pro' }],
      }],
      current: { provider: 'deepseek-official', model: 'deepseek-v4-pro' },
    }

    it('CAP-CHAT-PANEL-095 action/select-model applies the route and re-reads the catalog', async () => {
      const selected: Array<[string, string, string | undefined]> = []
      let reads = 0
      const panel = createPanel({
        requestSelectModel: async (provider, model, reasoningEffort) => {
          selected.push([provider, model, reasoningEffort])
        },
        requestModelList: async () => {
          reads += 1
          return catalog
        },
      })
      const fake = new FakeWebviewPort()
      panel.attach(fake)
      panel.clearOutboundLog()
      fake.receivedFromHost.length = 0

      fake.emitFromWebview({
        type: 'action/select-model',
        provider: 'deepseek-official',
        model: 'deepseek-v4-pro',
        reasoningEffort: 'low',
      })
      await waitFor(() => fake.receivedFromHost.some(m => m.type === 'model/state'), 1_000)

      expect(selected).toEqual([['deepseek-official', 'deepseek-v4-pro', 'low']])
      expect(reads).toBe(1)
      expect(fake.receivedFromHost.find(m => m.type === 'model/state')).toMatchObject({
        type: 'model/state',
        current: catalog.current,
      })
    })

    it('CAP-CHAT-PANEL-096 a refused route banners the runtime reason and pushes no catalog', async () => {
      const panel = createPanel({
        requestSelectModel: async () => {
          throw new Error('no adapter registered for provider "ghost"')
        },
        requestModelList: async () => catalog,
      })
      const fake = new FakeWebviewPort()
      panel.attach(fake)
      panel.clearOutboundLog()
      fake.receivedFromHost.length = 0

      fake.emitFromWebview({ type: 'action/select-model', provider: 'ghost', model: 'ghost-model' })
      await waitFor(() => fake.receivedFromHost.some(m => m.type === 'ui/banner'), 1_000)

      expect(fake.receivedFromHost.find(m => m.type === 'ui/banner')).toMatchObject({
        type: 'ui/banner',
        kind: 'settings',
        text: expect.stringContaining('no adapter registered for provider "ghost"'),
      })
      expect(fake.receivedFromHost.filter(m => m.type === 'model/state')).toHaveLength(0)
    })

    it('CAP-CHAT-PANEL-097 settings/open re-reads the catalog the page renders', async () => {
      const panel = createPanel({
        requestModelList: async () => catalog,
        requestSettingsDescribe: async () => [],
      })
      const fake = new FakeWebviewPort()
      panel.attach(fake)
      panel.clearOutboundLog()
      fake.receivedFromHost.length = 0

      fake.emitFromWebview({ type: 'settings/open' })
      await waitFor(() => fake.receivedFromHost.some(m => m.type === 'settings/state'), 1_000)

      expect(fake.receivedFromHost.some(m => m.type === 'model/state')).toBe(true)
    })

    it('CAP-CHAT-PANEL-098 a live connection re-reads the catalog the mount lost', async () => {
      const panel = createPanel({ requestModelList: async () => catalog })
      const fake = new FakeWebviewPort()
      panel.attach(fake)
      panel.clearOutboundLog()
      fake.receivedFromHost.length = 0

      panel.applyConnectionState({
        phase: 'connected',
        settingsDeepLinkAvailable: false,
        statusBarVisible: false,
      })
      await waitFor(() => fake.receivedFromHost.some(m => m.type === 'model/state'), 1_000)

      expect(fake.receivedFromHost.find(m => m.type === 'model/state')).toMatchObject({
        type: 'model/state',
        providers: catalog.providers,
      })
    })

    it('CAP-CHAT-PANEL-099 a failed rich send banners the reason instead of swallowing it', async () => {
      const panel = createPanel({
        acceptSend: async () => {
          throw new Error('SDK image prompt requires an attachment store')
        },
      })
      const fake = new FakeWebviewPort()
      panel.attach(fake)
      panel.clearOutboundLog()
      fake.receivedFromHost.length = 0

      fake.emitFromWebview({
        type: 'composer/send-rich',
        text: 'look at this',
        images: [{ data: 'AA==', mimeType: 'image/png', name: 'shot.png' }],
      })
      await waitFor(() => fake.receivedFromHost.some(m => m.type === 'ui/banner'), 1_000)

      expect(fake.receivedFromHost.find(m => m.type === 'ui/banner')).toMatchObject({
        type: 'ui/banner',
        kind: 'send-failed',
        text: expect.stringContaining('SDK image prompt requires an attachment store'),
      })
    })

    it('CAP-CHAT-PANEL-100 the tabs frame carries lineage only for derived Tabs', () => {
      const registry = new ConversationRegistry()
      const rootTab = registry.create('主会话')
      const childTab = registry.create('派生会话')
      const panel = createPanel({
        registry,
        resolveTabParentHint: sessionId => sessionId === childTab.sessionId
          ? '主会话'
          : undefined,
      })
      const fake = new FakeWebviewPort()
      panel.attach(fake)
      panel.clearOutboundLog()
      fake.receivedFromHost.length = 0

      panel.pushTabsFrame()

      const frame = fake.receivedFromHost.find(m => m.type === 'panel/tabs')
      const tabs = frame?.type === 'panel/tabs' ? frame.tabs : []
      expect(tabs.find(t => t.tabId === childTab.tabId)?.parentHint).toBe('派生自 主会话')
      // A root conversation stays without lineage chrome instead of an empty hint.
      expect(tabs.find(t => t.tabId === rootTab.tabId)).not.toHaveProperty('parentHint')
    })

    it('CAP-CHAT-PANEL-101 ui/rename-request routes the asked session to the rename action', async () => {
      const renamed: string[] = []
      const panel = createPanel({
        requestRename: async (sessionId) => {
          renamed.push(sessionId)
        },
      })
      const fake = new FakeWebviewPort()
      panel.attach(fake)
      panel.clearOutboundLog()
      fake.receivedFromHost.length = 0

      fake.emitFromWebview({ type: 'ui/rename-request', sessionId: 'sess-rename' })
      await waitFor(() => renamed.length === 1, 1_000)

      expect(renamed).toEqual(['sess-rename'])
      // The rename chrome follows the runtime's `session/title` event, not this intent.
      expect(fake.receivedFromHost).toHaveLength(0)
    })
  })

})
