/**
 * Verifier-owned independent scenarios for phase-2-streaming-cancel-follow.
 * Does NOT rubber-stamp implementer suites — new cases only.
 *
 * Gaps vs implementer:
 * - E2E Host outbound append/patch -> real DOM same-node identity (A+B joined)
 * - AC-13b outbound messages/patch { incomplete:true } (connectivity test seam)
 * - live turn/end interrupted (implementer live only aborted; interrupted only hydrate)
 * - cancel ok then aborted sequence
 * - P2-2: after streaming false (cancel/disconnect), follow stays off when takeover
 * - MessageStore + pushPatch XOR rejection (parameter variation)
 * - interleaved reasoning-delta noise between text deltas
 * - product HTML embeds Stop / patch / follow-resume
 * - server keepInbox pin (source assert)
 *
 * Bridge cancel param variation covered by re-running ide-bridge.spec + static-checks.sh
 */
// @vitest-environment jsdom

import { describe, expect, it, beforeEach } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { ConversationController } from '../../../../../../apps/vscode-dsh/src/conversation-controller.ts'
import {
  ChatPanelHost,
  FakeWebviewPort,
} from '../../../../../../apps/vscode-dsh/src/chat-panel/index.ts'
import { IdeSessionHost } from '../../../../../../apps/vscode-dsh/src/session-host.ts'
import { MessageStore } from '../../../../../../apps/vscode-dsh/src/message-store.ts'
import {
  appendMessage,
  patchMessageDom,
} from '../../../../../../apps/vscode-dsh/src/chat-panel/render/message-dom.ts'
import {
  applyFollowState,
  decideFollowState,
} from '../../../../../../apps/vscode-dsh/src/chat-panel/render/follow-state.ts'
import {
  applyStreamingStatus,
  syncFollowPresentation,
} from '../../../../../../apps/vscode-dsh/src/chat-panel/render/sync-chrome.ts'
import { createChatUxProbeStore } from '../../../../../../apps/vscode-dsh/src/chat-panel/probes.ts'
import { buildThinChatHtml } from '../../../../../../apps/vscode-dsh/src/chat-panel/chat-panel-provider.ts'
import type { HarnessNotification } from '@deepseek-ai/dsh-sdk-client'

type NotificationListener = (notification: HarnessNotification) => void

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = join(HERE, '../../../../../../')

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

describe('verifier independent - phase-2 streaming/cancel/follow', () => {
  let root: HTMLElement
  let messages: HTMLElement
  let status: HTMLElement

  beforeEach(() => {
    document.body.innerHTML = ''
    root = document.createElement('div')
    root.className = 'dsh-chat-chassis'
    root.setAttribute('data-testid', 'chat-chassis')
    messages = document.createElement('div')
    messages.id = 'messages'
    status = document.createElement('div')
    status.id = 'status'
    root.appendChild(messages)
    root.appendChild(status)
    document.body.appendChild(root)
  })

  it('E2E (independent): Host chunk outbound -> DOM patch keeps same data-message-id node', () => {
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
      chunk: { type: 'text-delta', text: 'Aa' },
    }))
    const messageId = controller.messages.get(tab.sessionId)[0]!.id
    const firstFrames = [...fake.receivedFromHost]
    expect(firstFrames.some(m => m.type === 'messages/append' && m.message?.id === messageId)).toBe(true)

    // Clear status noise; subsequent text-deltas must be patch-only (AC-18).
    panel.clearOutboundLog()
    fake.receivedFromHost.length = 0
    host.emit(sessionEvent(tab.sessionId, 'assistant/chunk', {
      turn: 0,
      chunk: { type: 'text-delta', text: 'Bb' },
    }))
    host.emit(sessionEvent(tab.sessionId, 'assistant/chunk', {
      turn: 0,
      chunk: { type: 'text-delta', text: 'Cc' },
    }))

    expect(controller.messages.get(tab.sessionId)[0]!.text).toBe('AaBbCc')
    const later = [...fake.receivedFromHost]
    expect(later.filter(m => m.type === 'messages/patch').length).toBeGreaterThanOrEqual(2)
    expect(later.filter(m => m.type === 'messages/replace')).toHaveLength(0)
    expect(later.filter(m => m.type === 'messages/append')).toHaveLength(0)
    expect(later.every(m => m.type !== 'messages/patch' || m.messageId === messageId)).toBe(true)

    // Join Host frames onto real DOM: first append then patches.
    for (const frame of firstFrames) {
      if (frame.type === 'messages/append' && frame.message) {
        appendMessage(messages, {
          id: frame.message.id,
          role: frame.message.role,
          text: frame.message.text,
        })
      }
    }
    const bubble = messages.querySelector(`[data-message-id="${messageId}"]`) as HTMLElement
    expect(bubble).toBeTruthy()
    for (const frame of later) {
      if (frame.type === 'messages/patch') {
        const same = patchMessageDom(messages, frame.messageId, {
          ...frame.appendText !== undefined ? { appendText: frame.appendText } : {},
          ...frame.streaming !== undefined ? { streaming: frame.streaming } : {},
        })
        expect(same).toBe(bubble)
      }
    }
    expect(bubble.textContent).toBe('AaBbCc')
    expect(messages.querySelectorAll(`[data-message-id="${messageId}"]`).length).toBe(1)
  })

  it('AC-13b seam (independent): live aborted pushes outbound incomplete patch + notice', () => {
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

    host.emit(sessionEvent(tab.sessionId, 'assistant/chunk', {
      turn: 2,
      chunk: { type: 'text-delta', text: 'half-cut' },
    }))
    const messageId = controller.messages.get(tab.sessionId)[0]!.id
    panel.clearOutboundLog()
    fake.receivedFromHost.length = 0

    host.emit(sessionEvent(tab.sessionId, 'turn/end', {
      turn: 2,
      reason: { kind: 'aborted', reason: { kind: 'user' } },
    }))

    const incompletePatches = fake.receivedFromHost.filter(
      m => m.type === 'messages/patch'
        && m.messageId === messageId
        && m.incomplete === true
        && m.streaming === false,
    )
    expect(incompletePatches.length).toBeGreaterThanOrEqual(1)
    expect(fake.receivedFromHost.some(
      m => m.type === 'messages/append' && m.message?.text === '已停止/未完成',
    )).toBe(true)
    expect(controller.messages.get(tab.sessionId).find(m => m.id === messageId)?.text).toBe('half-cut')
  })

  it('AC-13b (independent): live interrupted also marks incomplete (not only aborted)', () => {
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
      turn: 3,
      chunk: { type: 'text-delta', text: 'interrupted-partial' },
    }))
    host.emit(sessionEvent(tab.sessionId, 'turn/end', {
      turn: 3,
      reason: { kind: 'interrupted' },
    }))

    const assistant = controller.messages.get(tab.sessionId).find(m => m.role === 'assistant')
    expect(assistant?.text).toBe('interrupted-partial')
    expect(assistant?.incomplete).toBe(true)
    expect(assistant?.streaming).toBeUndefined()
  })

  it('AC-13 sequence (independent): cancel ok does not invent incomplete; aborted then settles', async () => {
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

    host.emit(sessionEvent(tab.sessionId, 'assistant/chunk', {
      turn: 0,
      chunk: { type: 'text-delta', text: 'running...' },
    }))
    await panel.handleWebviewMessage({ type: 'action/stop' })
    expect(host.cancelCalls).toEqual([tab.sessionId])
    const mid = controller.messages.get(tab.sessionId).find(m => m.role === 'assistant')
    expect(mid?.incomplete).not.toBe(true)
    expect(mid?.streaming).toBe(true)

    host.emit(sessionEvent(tab.sessionId, 'turn/end', {
      turn: 0,
      reason: { kind: 'aborted', reason: { kind: 'user' } },
    }))
    expect(mid?.text).toBe('running...')
    expect(controller.messages.get(tab.sessionId).find(m => m.id === mid!.id)?.incomplete).toBe(true)
  })

  it('P2-2 (independent): streaming false after disconnect does not force follow back on', () => {
    const probes = createChatUxProbeStore({ followState: 'off', streaming: true })
    syncFollowPresentation(root, 'off', probes)
    applyStreamingStatus(status, 'generating', probes)
    expect(probes.get().streaming).toBe(true)
    expect(root.getAttribute('data-follow-state')).toBe('off')

    applyStreamingStatus(status, 'idle', probes)
    expect(probes.get().streaming).toBe(false)
    const afterDisconnect = decideFollowState({
      followState: 'off',
      atBottom: false,
      userTookOver: true,
      explicitResume: false,
      streaming: false,
    })
    expect(afterDisconnect).toBe('off')
    syncFollowPresentation(root, afterDisconnect, probes)
    expect(root.getAttribute('data-follow-state')).toBe('off')
    expect(probes.get().followState).toBe('off')
  })

  it('P2-2 (independent): follow off survives cancel settle (streaming false)', () => {
    applyFollowState(root, 'off')
    const stay = decideFollowState({
      followState: 'off',
      atBottom: false,
      userTookOver: true,
      explicitResume: false,
      streaming: false,
    })
    expect(stay).toBe('off')
  })

  it('AD-CUX-10 (independent): MessageStore + pushPatch reject text XOR appendText dual write', () => {
    const store = new MessageStore()
    store.append('s1', {
      id: 'm1',
      sessionId: 's1',
      role: 'assistant',
      kind: 'text',
      text: 'base',
      streaming: true,
    })
    expect(store.patch('s1', 'm1', { text: 'x', appendText: 'y' })).toBeUndefined()
    expect(store.get('s1')[0]!.text).toBe('base')

    expect(store.patch('s1', 'm1', { appendText: '!' })?.text).toBe('base!')
    expect(store.patch('s1', 'm1', { text: 'final', streaming: false })?.text).toBe('final')
    expect(store.get('s1')[0]!.streaming).toBeUndefined()

    const host = createEmitHost()
    const controller = new ConversationController(host)
    const tab = controller.newConversation('live')
    const panel = new ChatPanelHost({
      registry: controller.registry,
      messages: controller.messages,
      isHostReady: () => true,
      acceptSend: (text) => controller.promptActive(text),
    })
    const fake = new FakeWebviewPort()
    panel.attach(fake)
    panel.clearOutboundLog()
    panel.pushPatch(tab.sessionId, 'ghost', { text: 'a', appendText: 'b' })
    expect(fake.receivedFromHost.filter(m => m.type === 'messages/patch')).toHaveLength(0)
  })

  it('T6 (independent): interleaved reasoning-delta does not alter text stream', () => {
    const host = createEmitHost()
    const controller = new ConversationController(host)
    const tab = controller.newConversation('live')
    controller.setPanelHost(new ChatPanelHost({
      registry: controller.registry,
      messages: controller.messages,
      isHostReady: () => true,
      acceptSend: (text) => controller.promptActive(text),
    }))

    const feed = [
      { type: 'reasoning-delta', text: 'think-1' },
      { type: 'text-delta', text: 'Hi' },
      { type: 'reasoning-delta', text: 'think-2' },
      { type: 'text-delta', text: '!' },
      { type: 'reasoning-delta', text: 'think-3' },
    ] as const
    for (const chunk of feed) {
      host.emit(sessionEvent(tab.sessionId, 'assistant/chunk', { turn: 0, chunk }))
    }
    const msgs = controller.messages.get(tab.sessionId)
    expect(msgs).toHaveLength(1)
    expect(msgs[0]!.text).toBe('Hi!')
    expect(JSON.stringify(msgs)).not.toMatch(/think-|reasoning/i)
  })

  it('product HTML (independent): embeds Stop, messages/patch handler, follow resume', () => {
    const html = buildThinChatHtml('')
    expect(html).toContain('action/stop')
    expect(html).toContain('stopBtn')
    expect(html).toContain("msg.type === 'messages/patch'")
    expect(html).toContain('followResumeBtn')
    expect(html).toContain('initFollowOnStreamStart')
    expect(html).toContain('keepBottomIfFollowing')
    expect(html.toLowerCase()).not.toContain('data-kind="thinking"')
  })

  it('server keepInbox (independent): source pins Agent.cancel options', () => {
    const src = readFileSync(join(REPO_ROOT, 'packages/sdk/server/src/server.ts'), 'utf8')
    expect(src).toMatch(/agent\.cancel\(\{\s*kind:\s*'user'\s*\},\s*\{\s*keepInbox:\s*true\s*\}\)/)
  })
})
