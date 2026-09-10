/**
 * Layer B protocol smoke for Host decision authority (AC-1).
 * FakeWebviewPort never invents mode — only Host panel/state frames apply.
 */
import { describe, expect, it } from 'vitest'
import {
  ChatPanelHost,
  FakeWebviewPort,
  type HostToWebviewMessage,
} from '../../src/chat-panel/index.ts'
import { ConversationController } from '../../src/conversation-controller.ts'
import type { IdeSessionHost } from '../../src/session-host.ts'

async function waitFor(predicate: () => boolean, timeoutMs: number): Promise<void> {
  const start = Date.now()
  while (!predicate()) {
    if (Date.now() - start > timeoutMs) throw new Error('waitFor timeout')
    await new Promise((r) => setTimeout(r, 10))
  }
}

describe('layer-B panel/state decision authority (AC-1)', () => {
  it('FakeWebview mirrors Host mode only; empty send is Host-rejected', async () => {
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
      acceptSend: (text) => controller.promptActive(text),
    })
    controller.setPanelHost(panel)
    const fake = new FakeWebviewPort()
    panel.attach(fake)

    expect(
      fake.receivedFromHost.some((m) => m.type === 'panel/state' && m.mode === 'live'),
    ).toBe(true)
    expect(fake.receivedFromHost.some((m) => m.type === 'messages/replace')).toBe(true)

    panel.clearOutboundLog()
    fake.receivedFromHost.length = 0
    fake.emitFromWebview({ type: 'composer/send', text: '  ' })
    await waitFor(() => panel.getOutboundLog().some((m) => m.type === 'ui/reject-send'), 1_000)
    expect(panel.getOutboundLog().find((m) => m.type === 'ui/reject-send')).toMatchObject({
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
