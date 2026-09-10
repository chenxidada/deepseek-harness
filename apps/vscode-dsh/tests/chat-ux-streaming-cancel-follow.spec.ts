/**
 * Layer B — streaming chunk projection + I-真 cancel + fail-closed (phase-2).
 * Uses real ConversationController + MessageStore + ChatPanelHost (FakeWebviewPort).
 */

import { describe, expect, it } from 'vitest'
import { ConversationController } from '../src/conversation-controller.ts'
import {
  ChatPanelHost,
  FakeWebviewPort,
} from '../src/chat-panel/index.ts'
import { IdeSessionHost } from '../src/session-host.ts'
import type { HarnessNotification } from '@deepseek-ai/dsh-sdk-client'
import { detectIncomplete } from '../src/replay-hydrator.ts'

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

describe('layer-B streaming / cancel / incomplete (AC-10–13d / AC-19)', () => {
  it('AC-10/12/18: text-delta chunks project via messages/patch with stable id; converge on assistant/message', async () => {
    const host = createEmitHost()
    const controller = new ConversationController(host)
    const tab = controller.newConversation('live')
    const panel = new ChatPanelHost({
      registry: controller.registry,
      messages: controller.messages,
      interactions: host.interactions,
      isHostReady: () => true,
      acceptSend: (text) => controller.promptActive(text),
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
    // Must not rebuild the list to deliver subsequent chunks (AC-18 / R1).
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

  it('AC-11/T6: reasoning-delta is ignored (no thinking projection)', () => {
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

  it('AC-13: action/stop calls host.cancelSession (I-真)', async () => {
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

    host.emit(sessionEvent(tab.sessionId, 'assistant/chunk', {
      turn: 0,
      chunk: { type: 'text-delta', text: 'partial' },
    }))

    await panel.handleWebviewMessage({ type: 'action/stop' })
    expect(host.cancelCalls).toEqual([tab.sessionId])
  })

  it('AC-13b: turn/end aborted marks incomplete and keeps partial text', () => {
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

  it('AC-13d: cancel failure is fail-closed with banner; no incomplete claim', async () => {
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
      acceptSend: (text) => controller.promptActive(text),
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

  it('AC-13b hydrate: detectIncomplete recognizes aborted', () => {
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

  it('AC-19: Host disconnect fail-closes streaming', () => {
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
      acceptSend: (text) => controller.promptActive(text),
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
