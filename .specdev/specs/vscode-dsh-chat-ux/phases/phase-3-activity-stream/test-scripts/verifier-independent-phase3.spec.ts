/**
 * Verifier-owned independent scenarios for phase-3-activity-stream.
 * Does NOT rubber-stamp implementer suites — covers Should-Fix gaps + new cases:
 * - Host outbound messages/patch.activityStatus (tool/result + cancel abort)
 * - openFromHistory hydrate → pushFullState messages/replace + reject-send (one path)
 * - activityStatusFromToolResult parameter variation (error.code vs info.code)
 * - Host append → layer-A DOM [data-kind=activity] + probes (joined E2E)
 * - Timeline is not the sole activity surface (MessageStore kind:activity present)
 * - product HTML embeds activityDom helpers / patch.activityStatus handler
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
  activityStatusFromToolResult,
} from '../../../../../../apps/vscode-dsh/src/chat-panel/index.ts'
import { IdeSessionHost } from '../../../../../../apps/vscode-dsh/src/session-host.ts'
import {
  mountActivityMessage,
} from '../../../../../../apps/vscode-dsh/src/chat-panel/render/activity-dom.ts'
import { createChatUxProbeStore } from '../../../../../../apps/vscode-dsh/src/chat-panel/probes.ts'
import { buildThinChatHtml } from '../../../../../../apps/vscode-dsh/src/chat-panel/chat-panel-provider.ts'
import type { HarnessNotification } from '@deepseek-ai/dsh-sdk-client'
import type { ChatMessage } from '../../../../../../apps/vscode-dsh/src/message-store.ts'

type NotificationListener = (notification: HarnessNotification) => void

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = join(HERE, '../../../../../../')

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

describe('verifier independent - phase-3 activity stream', () => {
  let messagesEl: HTMLElement
  let probes: ReturnType<typeof createChatUxProbeStore>

  beforeEach(() => {
    document.body.innerHTML = ''
    messagesEl = document.createElement('div')
    messagesEl.id = 'messages'
    document.body.appendChild(messagesEl)
    probes = createChatUxProbeStore()
  })

  it('Should-Fix: Host outbound messages/patch.activityStatus on tool/result', () => {
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
      turn: 2,
      callId: 'patch-me',
      name: 'Bash',
    }))
    const activity = controller.messages.get(tab.sessionId).find(m => m.kind === 'activity')
    expect(activity?.id).toBeTruthy()
    const activityId = activity!.id

    host.emit(sessionEvent(tab.sessionId, 'tool/result', {
      turn: 2,
      callId: 'patch-me',
      isError: false,
    }))

    const statusPatches = fake.receivedFromHost.filter(
      (m): m is Extract<typeof m, { type: 'messages/patch' }> =>
        m.type === 'messages/patch'
        && 'activityStatus' in m
        && (m as { activityStatus?: string }).activityStatus !== undefined,
    )
    expect(statusPatches.length).toBeGreaterThanOrEqual(1)
    expect(statusPatches.some(p =>
      p.messageId === activityId && p.activityStatus === 'done',
    )).toBe(true)
  })

  it('Should-Fix: cancel/turn-end emits Host patch activityStatus=aborted (no revert)', async () => {
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
      turn: 9,
      callId: 'still-running',
      name: 'Write',
    }))
    const activityId = controller.messages.get(tab.sessionId)
      .find(m => m.activity?.callId === 'still-running')!.id

    panel.clearOutboundLog()
    fake.receivedFromHost.length = 0

    await panel.handleWebviewMessage({ type: 'action/stop' })
    host.emit(sessionEvent(tab.sessionId, 'turn/end', {
      turn: 9,
      reason: { kind: 'aborted', reason: { kind: 'user' } },
    }))

    const abortPatches = fake.receivedFromHost.filter(m =>
      m.type === 'messages/patch'
      && (m as { activityStatus?: string }).activityStatus === 'aborted'
      && (m as { messageId?: string }).messageId === activityId,
    )
    expect(abortPatches.length).toBeGreaterThanOrEqual(1)
    expect(host.revertCalls).toHaveLength(0)
    expect(fake.receivedFromHost.some(m => m.type === 'change/revert-result')).toBe(false)
  })

  it('Should-Fix: openFromHistory hydrate → pushFullState replace includes activity + reject-send', async () => {
    const host = createEmitHost()
    const controller = new ConversationController(host)
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

    const sessionId = 'sess-verifier-hydrate-activity'
    const events = [
      {
        type: 'user/message',
        seq: 1,
        data: {
          id: 'u1',
          role: 'user',
          content: [{ type: 'text', text: 'do tools' }],
        },
      },
      {
        type: 'tool/call',
        seq: 2,
        data: { turn: 0, callId: 'hv-1', name: 'Bash', arguments: '{}' },
      },
      {
        type: 'tool/result',
        seq: 3,
        data: { turn: 0, callId: 'hv-1', isError: false },
      },
      {
        type: 'tool/call',
        seq: 4,
        data: { turn: 0, callId: 'hv-2', name: 'Read' },
      },
      {
        type: 'turn/end',
        seq: 5,
        data: { turn: 0, reason: { kind: 'aborted' } },
      },
    ]

    const opened = await controller.openFromHistory(sessionId, { events })
    expect(opened.outcome).toBe('opened')
    if (opened.outcome !== 'opened') return
    expect(opened.mode).toBe('replay')

    const storeActs = controller.messages.get(sessionId).filter(m => m.kind === 'activity')
    expect(storeActs).toHaveLength(2)
    expect(storeActs[0]?.activity?.status).toBe('done')
    expect(storeActs[1]?.activity?.status).toBe('aborted')

    const replaces = fake.receivedFromHost.filter(m => m.type === 'messages/replace')
    expect(replaces.length).toBeGreaterThanOrEqual(1)
    const lastReplace = replaces[replaces.length - 1] as {
      type: 'messages/replace'
      messages: ChatMessage[]
    }
    const replaceActs = lastReplace.messages.filter(m => m.kind === 'activity')
    expect(replaceActs).toHaveLength(2)
    expect(replaceActs.map(m => m.activity?.callId)).toEqual(['hv-1', 'hv-2'])

    const panelStates = fake.receivedFromHost.filter(m => m.type === 'panel/state')
    expect(panelStates.some(m =>
      m.type === 'panel/state' && (m as { mode?: string }).mode === 'replay',
    )).toBe(true)

    panel.clearOutboundLog()
    fake.receivedFromHost.length = 0
    await panel.handleWebviewMessage({ type: 'composer/send', text: 'must reject' })
    expect(fake.receivedFromHost.some(m =>
      m.type === 'ui/reject-send' && (m as { reason?: string }).reason === 'replay',
    )).toBe(true)
  })

  it('independent: activityStatusFromToolResult parameter variation', () => {
    expect(activityStatusFromToolResult({ isError: false })).toBe('done')
    expect(activityStatusFromToolResult({ isError: true })).toBe('failed')
    expect(activityStatusFromToolResult({
      isError: true,
      error: { info: { code: 'ABORTED' } },
    })).toBe('aborted')
    expect(activityStatusFromToolResult({
      isError: true,
      error: { info: { code: 'ABORTED_BEFORE_DISPATCH' } },
    })).toBe('aborted')
    // Alternate shape: top-level error.code (not only info.code)
    expect(activityStatusFromToolResult({
      isError: true,
      error: { code: 'ABORTED' },
    })).toBe('aborted')
    expect(activityStatusFromToolResult({
      isError: true,
      message: { content: [{ isError: true }] },
    })).toBe('failed')
    // Different inputs → different outputs (not a stub)
    expect(activityStatusFromToolResult({ isError: false }))
      .not.toBe(activityStatusFromToolResult({ isError: true }))
  })

  it('independent E2E: Host append activity → DOM data-kind=activity + probes', () => {
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
      turn: 3,
      callId: 'dom-join',
      name: 'Grep',
    }))

    const append = fake.receivedFromHost.find(m =>
      m.type === 'messages/append'
      && (m as { message?: ChatMessage }).message?.kind === 'activity',
    ) as { type: 'messages/append'; message: ChatMessage } | undefined
    expect(append).toBeTruthy()
    const msg = append!.message
    expect(msg.activity?.status).toBe('running')
    expect(msg.activity?.expanded).toBe(false)

    // Join Host projection to layer-A DOM (constitution extract path).
    const el = mountActivityMessage(messagesEl, msg, probes)
    expect(el.getAttribute('data-kind')).toBe('activity')
    expect(el.getAttribute('data-status')).toBe('running')
    expect(el.getAttribute('data-expanded')).toBe('false')
    expect(el.getAttribute('data-turn')).toBe('3')
    expect(probes.get().activity?.[msg.id]).toEqual({
      status: 'running',
      expanded: false,
    })

    // Timeline must not be the only surface: MessageStore activity exists.
    expect(controller.messages.get(tab.sessionId).some(m => m.kind === 'activity')).toBe(true)
  })

  it('independent: product HTML embeds activity patch + activityDom helpers', () => {
    const html = buildThinChatHtml('')
    expect(html).toMatch(/activityStatus/)
    expect(html).toMatch(/applyActivityStatus|renderActivityBubble|data-kind.*activity/)
    expect(html).toMatch(/setActivity/)

    const providerSrc = readFileSync(
      join(REPO_ROOT, 'apps/vscode-dsh/src/chat-panel/chat-panel-provider.ts'),
      'utf8',
    )
    expect(providerSrc).toContain('activityDomBrowserSource')
    expect(providerSrc).toContain("msg.kind === 'activity'")
  })

  it('independent: ABORTED_BEFORE_DISPATCH via live Host patch (not only Store)', () => {
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

    host.emit(sessionEvent(tab.sessionId, 'tool/call', {
      turn: 1,
      callId: 'pre-dispatch',
      name: 'Write',
    }))
    panel.clearOutboundLog()
    fake.receivedFromHost.length = 0

    host.emit(sessionEvent(tab.sessionId, 'tool/result', {
      turn: 1,
      callId: 'pre-dispatch',
      isError: true,
      error: { info: { code: 'ABORTED_BEFORE_DISPATCH' } },
    }))

    expect(
      controller.messages.get(tab.sessionId)
        .find(m => m.activity?.callId === 'pre-dispatch')
        ?.activity?.status,
    ).toBe('aborted')
    expect(fake.receivedFromHost.some(m =>
      m.type === 'messages/patch'
      && (m as { activityStatus?: string }).activityStatus === 'aborted',
    )).toBe(true)
  })
})
