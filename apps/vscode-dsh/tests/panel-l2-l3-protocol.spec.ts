/**
 * L2 Host hooks + L3 fake Webview protocol (AC-54/84 / VP-1-send / VP-1-reject).
 */

import { describe, expect, it, afterEach } from 'vitest'
import { ConversationController } from '../src/conversation-controller.ts'
import {
  ChatPanelHost,
  FakeWebviewPort,
} from '../src/chat-panel/index.ts'
import { IdeSessionHost } from '../src/session-host.ts'
import { TimelineStore } from '../src/timeline-store.ts'
import type { HarnessNotification } from '@deepseek-ai/dsh-sdk-client'
import {
  activate,
  deactivate,
  getChatPanelHost,
} from '../src/extension.ts'

describe('L3 fake Webview protocol (VP-1-send / VP-1-reject)', () => {
  it('accepts composer/send on live Tab and rejects empty / no-host', async () => {
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

    expect(fake.receivedFromHost.some(m => m.type === 'panel/state' && m.mode === 'live')).toBe(true)
    expect(fake.receivedFromHost.some(m => m.type === 'messages/replace')).toBe(true)

    panel.clearOutboundLog()
    fake.receivedFromHost.length = 0
    fake.emitFromWebview({ type: 'composer/send', text: '  ' })
    await waitFor(() => panel.getOutboundLog().some(m => m.type === 'ui/reject-send'), 1_000)
    expect(panel.getOutboundLog().find(m => m.type === 'ui/reject-send')).toMatchObject({ reason: 'empty' })
    expect(prompts).toEqual([])

    fake.emitFromWebview({ type: 'composer/send', text: 'hello panel' })
    await waitFor(() => controller.messages.hasContent(tab.sessionId), 1_000)
    expect(prompts).toEqual(['hello panel'])
    expect(controller.messages.get(tab.sessionId)[0]?.text).toBe('hello panel')
    expect(fake.receivedFromHost.some(m => m.type === 'messages/append')).toBe(true)

    ;(registryHost as { status: string }).status = 'disconnected'
    panel.clearOutboundLog()
    const rejected = await panel.sendPrompt('again')
    expect(rejected).toEqual({ ok: false, reason: 'no-host' })
  })

  it('switches Tab with messages/replace and does not cross sessions (AC-18)', async () => {
    const host = {
      status: 'connected' as const,
      interactions: { failClosedSession() {}, listPending() { return [] } },
      setConversationRegistry() {},
      onNotification() { return () => {} },
      async prompt() { return 'm' },
      async disposeSession() {},
    } as unknown as IdeSessionHost
    const controller = new ConversationController(host)
    const a = controller.newConversation('A')
    await controller.promptTab(a.tabId, 'from-a')
    const b = controller.newConversation('B')
    await controller.promptTab(b.tabId, 'from-b')
    const panel = new ChatPanelHost({
      registry: controller.registry,
      messages: controller.messages,
      isHostReady: () => true,
      acceptSend: (text) => controller.promptActive(text),
    })
    controller.setPanelHost(panel)
    const fake = new FakeWebviewPort()
    panel.attach(fake)
    fake.receivedFromHost.length = 0

    controller.switchConversation(a.tabId)
    panel.pushFullState()
    const replace = fake.receivedFromHost.find(m => m.type === 'messages/replace')
    expect(replace).toMatchObject({ type: 'messages/replace', sessionId: a.sessionId })
    if (replace?.type === 'messages/replace') {
      expect(replace.messages.map(m => m.text)).toEqual(['from-a'])
    }
    const state = fake.receivedFromHost.find(m => m.type === 'panel/state')
    expect(state).toMatchObject({ sessionId: a.sessionId, mode: 'live' })
  })

  it('closes last content Tab with messages/replace([]) (AC-2 / AC-24)', async () => {
    const host = {
      status: 'connected' as const,
      interactions: { failClosedSession() {}, listPending() { return [] } },
      setConversationRegistry() {},
      onNotification() { return () => {} },
      async prompt() { return 'm' },
      async disposeSession() {
        throw new Error('close must not dispose')
      },
    } as unknown as IdeSessionHost
    const controller = new ConversationController(host)
    const tab = controller.newConversation('only')
    await controller.promptTab(tab.tabId, 'bubble-to-clear')
    expect(controller.messages.get(tab.sessionId).map(m => m.text)).toEqual(['bubble-to-clear'])

    const panel = new ChatPanelHost({
      registry: controller.registry,
      messages: controller.messages,
      isHostReady: () => true,
      acceptSend: (text) => controller.promptActive(text),
    })
    controller.setPanelHost(panel)
    const fake = new FakeWebviewPort()
    panel.attach(fake)
    expect(fake.receivedFromHost.some(m => m.type === 'messages/replace'
      && m.messages.some(row => row.text === 'bubble-to-clear'))).toBe(true)

    fake.receivedFromHost.length = 0
    panel.clearOutboundLog()
    const closed = await controller.closeConversation(tab.tabId)
    expect(closed.outcome).toBe('closed')
    expect(controller.registry.getActive()).toBeUndefined()

    const types = fake.receivedFromHost.map(m =>
      m.type === 'panel/state' ? `panel/state:${m.mode}`
        : m.type === 'messages/replace' ? `messages/replace(${m.messages.length})`
          : m.type)
    expect(types.some(t => t === 'panel/state:empty')).toBe(true)
    const clearReplace = fake.receivedFromHost.find(
      m => m.type === 'messages/replace' && m.messages.length === 0,
    )
    expect(clearReplace).toMatchObject({ type: 'messages/replace', sessionId: '', messages: [] })
    // Independent repro signal from review: hasReplaceEmpty must be true after live→empty.
    const hasReplaceEmpty = fake.receivedFromHost.some(
      m => m.type === 'messages/replace' && Array.isArray(m.messages) && m.messages.length === 0,
    )
    expect(hasReplaceEmpty).toBe(true)
  })

  it('surfaces waiting-interaction status from listPending (AC-41)', () => {
    const pending = [{ kind: 'approval' as const, id: '1', sessionId: '', abort: new AbortController() }]
    const host = {
      status: 'connected' as const,
      interactions: {
        failClosedSession() {},
        listPending() { return pending },
      },
      setConversationRegistry() {},
      onNotification() { return () => {} },
      async prompt() { return 'm' },
      async disposeSession() {},
    } as unknown as IdeSessionHost
    const controller = new ConversationController(host)
    const tab = controller.newConversation('wait')
    pending[0]!.sessionId = tab.sessionId
    const panel = new ChatPanelHost({
      registry: controller.registry,
      messages: controller.messages,
      interactions: host.interactions,
      isHostReady: () => true,
      acceptSend: (text) => controller.promptActive(text),
    })
    const fake = new FakeWebviewPort()
    panel.attach(fake)
    const status = fake.receivedFromHost.find(m => m.type === 'status/set')
    expect(status).toMatchObject({ type: 'status/set', status: 'waiting-interaction' })
  })
})

describe('Timeline weaken (AC-14/15)', () => {
  it('does not put assistant long body into Timeline description', () => {
    const store = new TimelineStore()
    const long = 'x'.repeat(200)
    store.apply({
      method: 'session.event',
      params: {
        sessionId: 's',
        event: {
          type: 'assistant/message',
          data: {
            message: {
              role: 'assistant',
              content: [{ type: 'text', text: long }],
            },
          },
        },
      },
    } as HarnessNotification)
    const item = store.itemsForSession('s').find(row => row.kind === 'assistant')
    expect(item?.description).toBe('assistant turn')
    expect(item?.description?.includes(long)).toBe(false)
    expect((item?.label.length ?? 0) <= 40).toBe(true)
  })
})

describe('L2 activate hooks smoke (AC-1 / AC-54)', () => {
  const commands = new Map<string, (...args: unknown[]) => unknown>()

  afterEach(async () => {
    await deactivate()
    commands.clear()
  })

  it('registers panel provider + L2 test hooks without Webview', async () => {
    let panelRegistered = false
    const vscode = {
      window: {
        async showErrorMessage() {},
        async showInformationMessage() {},
        registerWebviewViewProvider(viewId: string) {
          expect(viewId).toBe('dsh.chat')
          panelRegistered = true
          return { dispose() {} }
        },
      },
      workspace: {
        workspaceFolders: [{ uri: { fsPath: '/tmp/dsh-l2-smoke' } }],
      },
      commands: {
        registerCommand(command: string, callback: (...args: unknown[]) => unknown) {
          commands.set(command, callback)
          return { dispose() {} }
        },
      },
    }

    activate({
      subscriptions: [],
      extensionPath: '/tmp/dsh-l2-smoke',
      workspaceState: {
        get() { return undefined },
        update() {},
      },
    }, vscode as never)

    expect(panelRegistered).toBe(true)
    expect(getChatPanelHost()).toBeDefined()
    for (const name of [
      'dsh.test.sendPrompt',
      'dsh.test.closeConversation',
      'dsh.test.deleteConversation',
      'dsh.test.panelSnapshot',
      'dsh.test.getIndex',
      'dsh.test.openPanel',
      'dsh.deleteConversation',
    ]) {
      expect(commands.has(name)).toBe(true)
    }

    const open = await commands.get('dsh.test.openPanel')!()
    expect(open).toMatchObject({ ok: true, viewId: 'dsh.chat' })

    const snap = await commands.get('dsh.test.panelSnapshot')!() as { mode: string; messages: unknown[] }
    expect(snap.mode).toBe('waiting-host')
    expect(snap.messages).toEqual([])

    const rejected = await commands.get('dsh.test.sendPrompt')!('hello')
    expect(rejected).toMatchObject({ ok: false, reason: 'no-host' })
  })
})

function waitFor(predicate: () => boolean, timeoutMs: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const deadline = Date.now() + timeoutMs
    const poll = (): void => {
      if (predicate()) {
        resolve()
        return
      }
      if (Date.now() >= deadline) {
        reject(new Error('timed out'))
        return
      }
      setTimeout(poll, 20)
    }
    poll()
  })
}
