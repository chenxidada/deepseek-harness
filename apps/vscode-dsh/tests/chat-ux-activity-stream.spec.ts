/**
 * Layer B — conversation activity projection, cancel→aborted, replay rebuild (phase-3).
 * Real ConversationController + MessageStore + ChatPanelHost (FakeWebviewPort).
 */

import { describe, expect, it } from 'vitest'
import { ConversationController } from '../src/conversation-controller.ts'
import {
  ChatPanelHost,
  FakeWebviewPort,
} from '../src/chat-panel/index.ts'
import { IdeSessionHost } from '../src/session-host.ts'
import type { HarnessNotification } from '@deepseek-ai/dsh-sdk-client'
import { hydrateFromAuthoritativeLog } from '../src/replay-hydrator.ts'

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

describe('layer-B activity stream (AC-13c / AC-20/24/27/28)', () => {
  it('AC-20/24: tool/call without text chunks still projects kind:activity', () => {
    const host = createEmitHost()
    const controller = new ConversationController(host)
    const tab = controller.newConversation('live')
    const panel = new ChatPanelHost({
      registry: controller.registry,
      messages: controller.messages,
      isHostReady: () => true,
      acceptSend: (text) => controller.promptActive(text),
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

  it('AC-27: tool/result maps done / failed / aborted', () => {
    const host = createEmitHost()
    const controller = new ConversationController(host)
    const tab = controller.newConversation('live')
    const panel = new ChatPanelHost({
      registry: controller.registry,
      messages: controller.messages,
      isHostReady: () => true,
      acceptSend: (text) => controller.promptActive(text),
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

  it('AC-13c: turn/end aborted converges running activities to aborted without revert', async () => {
    const host = createEmitHost()
    const controller = new ConversationController(host)
    const tab = controller.newConversation('live')
    const panel = new ChatPanelHost({
      registry: controller.registry,
      messages: controller.messages,
      isHostReady: () => true,
      acceptSend: (text) => controller.promptActive(text),
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

  it('AC-23: same-turn tools share turn + increasing ordinal', () => {
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

  it('AC-28: hydrate rebuilds activities; replay mode rejects live send', async () => {
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
      acceptSend: (text) => controller.promptActive(text),
    })
    const fake = new FakeWebviewPort()
    panel.attach(fake)
    panel.clearOutboundLog()

    await panel.handleWebviewMessage({ type: 'composer/send', text: 'should reject' })
    const rejects = fake.receivedFromHost.filter(m => m.type === 'ui/reject-send')
    expect(rejects.some(m => m.type === 'ui/reject-send' && m.reason === 'replay')).toBe(true)
  })
})
