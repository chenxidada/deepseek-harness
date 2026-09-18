/**
 * Phase 4 L2/L3: subagent enter in-panel, pin to Tab, parent-child deleted navigation.
 * Covers AC-35/36/37/38/39/40/71/74/75/78/79/84.
 */

import { describe, expect, it } from 'vitest'
import { ConversationController } from '../src/conversation-controller.ts'
import {
  ChatPanelHost,
  FakeWebviewPort,
  parseWebviewToHostMessage,
} from '../src/chat-panel/index.ts'
import { IdeSessionHost } from '../src/session-host.ts'
import { InteractionCoordinator } from '../src/interaction-coordinator.ts'

interface Harness {
  host: StubHost
  controller: ConversationController
  panel: ChatPanelHost
  fake: FakeWebviewPort
}

interface StubHost extends IdeSessionHost {
  emitNotification: (notification: { method: string; params: Record<string, unknown> }) => void
}

function stubHost(): StubHost {
  const statusListeners = new Set<(status: string) => void>()
  const notificationListeners = new Set<(notification: { method: string; params: Record<string, unknown> }) => void>()
  let status: 'idle' | 'starting' | 'connected' | 'error' | 'disconnected' = 'connected'
  const host = {
    interactions: new InteractionCoordinator(),
    get status() { return status },
    set status(value: typeof status) {
      if (status === value) return
      status = value
      for (const listener of statusListeners) listener(value)
    },
    onStatusChange(listener: (next: typeof status) => void) {
      statusListeners.add(listener)
      return () => { statusListeners.delete(listener) }
    },
    setConversationRegistry(registry?: unknown) {
      if (registry !== undefined) {
        ;(this.interactions as InteractionCoordinator).setRegistry(registry as never)
      }
    },
    onNotification(listener: (notification: { method: string; params: Record<string, unknown> }) => void) {
      notificationListeners.add(listener)
      return () => { notificationListeners.delete(listener) }
    },
    emitNotification(notification: { method: string; params: Record<string, unknown> }) {
      for (const listener of notificationListeners) listener(notification)
    },
    async prompt() { return 'msg' },
    async disposeSession() {},
    async readSessionLog() { return [] as unknown[] },
    async resumeSession() {},
  }
  return host as unknown as StubHost
}

/** Fresh controller + panel + fake port with Host projection wired to the controller. */
function setup(): Harness {
  const host = stubHost()
  const controller = new ConversationController(host)
  const panel = new ChatPanelHost({
    registry: controller.registry,
    messages: controller.messages,
    isHostReady: () => host.status === 'connected',
    acceptSend: text => controller.promptActive(text),
    resolvePanelProjection: () => controller.resolvePanelProjection(),
    requestOpenSubagent: childSessionId => controller.openSubagentContext(childSessionId),
    requestNavBack: () => controller.navBack(),
    requestPinSubagent: childSessionId => controller.pinSubagent(childSessionId),
    resolveContinueChrome: () => controller.continueChromeForTab(),
  })
  controller.setPanelHost(panel)
  const fake = new FakeWebviewPort()
  panel.attach(fake)
  return { host, controller, panel, fake }
}

/**
 * Create a live parent Tab with content (so it lands in the index), then inject a running child.
 * A real subagent only spawns from a prompted parent, so the parent always has an index row.
 */
async function parentWithRunningChild(controller: ConversationController, childId: string): Promise<string> {
  const tab = controller.newConversation('Parent')
  await controller.promptTab(tab.tabId, 'parent prompt')
  await controller.applyTestSubagentNotification('started', tab.sessionId, childId)
  return tab.sessionId
}

describe('VP-4-subagent: enter in-panel / pin / deleted navigation', () => {
  it('enters running child as readonly-live context without minting a Tab (AC-35/37/39)', async () => {
    const { controller, fake } = setup()
    const parentSessionId = await parentWithRunningChild(controller, 'child-1')

    // AC-39: started child projects a running card in the parent stream.
    const cards = controller.messages.get(parentSessionId).filter(m => m.kind === 'subagent')
    expect(cards.some(c => c.childSessionId === 'child-1' && c.subagentStatus === 'running')).toBe(true)

    const before = controller.registry.list().length
    const result = await controller.openSubagentContext('child-1')
    expect(result).toMatchObject({
      outcome: 'opened-context',
      childSessionId: 'child-1',
      mode: 'readonly-live',
    })
    // AC-37: default enter does not mint a new Tab.
    expect(controller.registry.list().length).toBe(before)
    expect(controller.registry.getActive()?.contextSessionId).toBe('child-1')

    // Host projection mirrors readonly-live + breadcrumb (Host owns decision state).
    const projection = controller.resolvePanelProjection()
    expect(projection?.mode).toBe('readonly-live')
    expect(projection?.sessionId).toBe('child-1')
    expect(projection?.contextSessionId).toBe('child-1')
    expect(projection?.breadcrumb?.parentSessionId).toBe(parentSessionId)

    // Pushed panel/state carries readonly-live.
    expect(fake.receivedFromHost.some(m => m.type === 'panel/state' && m.mode === 'readonly-live')).toBe(true)
  })

  it('readonly-live rejects send; finished child flips to replay (AC-71/40)', async () => {
    const { controller, panel } = setup()
    const parentSessionId = await parentWithRunningChild(controller, 'child-1')
    await controller.openSubagentContext('child-1')

    // AC-71: running child is read-only live — composer send is rejected.
    const send = await panel.sendPrompt('hello')
    expect(send).toMatchObject({ ok: false, reason: 'readonly-live' })

    // AC-40: after finish, re-entering (or the open context) projects replay.
    await controller.applyTestSubagentNotification('finished', parentSessionId, 'child-1')
    expect(controller.resolvePanelProjection()?.mode).toBe('replay')
    expect(controller.resolvePanelProjection()?.contextSessionId).toBe('child-1')

    // AC-39/40: card transitions running → ended.
    const card = controller.messages.get(parentSessionId)
      .find(m => m.kind === 'subagent' && m.childSessionId === 'child-1')
    expect(card?.subagentStatus).toBe('ended')
  })

  it('navBack leaves context and restores the parent root (AC-36)', async () => {
    const { controller } = setup()
    const parentSessionId = await parentWithRunningChild(controller, 'child-1')
    await controller.openSubagentContext('child-1')
    expect(controller.registry.getActive()?.contextSessionId).toBe('child-1')

    expect(controller.navBack()).toEqual({ outcome: 'restored' })
    expect(controller.registry.getActive()?.contextSessionId).toBeUndefined()
    expect(controller.resolvePanelProjection()?.mode).toBe('live')
    expect(controller.resolvePanelProjection()?.sessionId).toBe(parentSessionId)
  })

  it('pinSubagent promotes child to a Tab and restores the parent active (AC-38/79)', async () => {
    const { controller } = setup()
    const parentSessionId = await parentWithRunningChild(controller, 'child-1')
    await controller.openSubagentContext('child-1')

    const result = await controller.pinSubagent()
    expect(result).toMatchObject({ outcome: 'pinned', childSessionId: 'child-1' })
    if (result.outcome !== 'pinned') return

    const childTab = controller.registry.getBySessionId('child-1')
    expect(childTab).toBeDefined()
    expect(childTab?.pinnedSubagent).toBe(true)
    // AC-79: parent restored as active, its context cleared.
    expect(controller.registry.getActive()?.sessionId).toBe(parentSessionId)
    expect(controller.registry.getActive()?.contextSessionId).toBeUndefined()
  })

  it('openSubagentContext activates an already-pinned Tab (AC-78)', async () => {
    const { controller } = setup()
    await parentWithRunningChild(controller, 'child-1')
    await controller.openSubagentContext('child-1')
    await controller.pinSubagent()

    const result = await controller.openSubagentContext('child-1')
    expect(result).toMatchObject({ outcome: 'activated-tab', childSessionId: 'child-1' })
    expect(controller.registry.getActive()?.sessionId).toBe('child-1')
  })

  it('pinned running child Tab projects readonly-live and rejects send until finished (AD-CU-11)', async () => {
    const { controller, panel } = setup()
    const parentSessionId = await parentWithRunningChild(controller, 'child-1')
    await controller.openSubagentContext('child-1')
    const pin = await controller.pinSubagent()
    if (pin.outcome !== 'pinned') throw new Error('pin failed')

    // Activate the pinned child Tab (re-enter from parent).
    const enter = await controller.openSubagentContext('child-1')
    expect(enter).toMatchObject({ outcome: 'activated-tab', childSessionId: 'child-1' })
    expect(controller.registry.getActive()?.sessionId).toBe('child-1')

    // A running pinned child projects readonly-live, not a writable live seam.
    const projection = controller.resolvePanelProjection()
    expect(projection?.mode).toBe('readonly-live')
    expect(projection?.sessionId).toBe('child-1')

    // sendPrompt rejects the running pinned child.
    const send = await panel.sendPrompt('hello')
    expect(send).toMatchObject({ ok: false, reason: 'readonly-live' })

    // Child finish flips the pinned Tab to replay (send then rejects as replay).
    await controller.applyTestSubagentNotification('finished', parentSessionId, 'child-1')
    expect(controller.resolvePanelProjection()?.mode).toBe('replay')
    const afterFinish = await panel.sendPrompt('hello')
    expect(afterFinish).toMatchObject({ ok: false, reason: 'replay' })
  })

  it('deleting a child marks its parent subagent card deleted (AC-74)', async () => {
    const { controller } = setup()
    const parentSessionId = await parentWithRunningChild(controller, 'child-1')

    await controller.deleteSession('child-1', { confirmed: true })

    const card = controller.messages.get(parentSessionId)
      .find(m => m.kind === 'subagent' && m.childSessionId === 'child-1')
    expect(card?.subagentStatus).toBe('deleted')
    expect(card?.text).toBe('子会话已删除')
  })

  it('deleting a parent disables back nav on a pinned child Tab (AC-75)', async () => {
    const { controller } = setup()
    const parentSessionId = await parentWithRunningChild(controller, 'child-1')
    await controller.openSubagentContext('child-1')
    const pin = await controller.pinSubagent()
    if (pin.outcome !== 'pinned') throw new Error('pin failed')

    controller.switchConversation(pin.tabId)
    expect(controller.registry.getActive()?.sessionId).toBe('child-1')

    await controller.deleteSession(parentSessionId, { confirmed: true })

    const projection = controller.resolvePanelProjection()
    expect(projection?.breadcrumb?.parentDeleted).toBe(true)
    expect(projection?.breadcrumb?.label).toBe('父会话已删除')
    expect(controller.navBack()).toEqual({ outcome: 'disabled' })
  })

  it('deleted child is not enterable; card flips deleted and open returns deleted (AC-74)', async () => {
    const { controller } = setup()
    const parentSessionId = await parentWithRunningChild(controller, 'child-1')
    await controller.deleteSession('child-1', { confirmed: true })

    const result = await controller.openSubagentContext('child-1')
    expect(result).toEqual({ outcome: 'deleted', childSessionId: 'child-1' })
    expect(controller.registry.getActive()?.contextSessionId).toBeUndefined()
    const card = controller.messages.get(parentSessionId)
      .find(m => m.kind === 'subagent' && m.childSessionId === 'child-1')
    expect(card?.subagentStatus).toBe('deleted')
  })
})

describe('VP-4-subagent: protocol fail-closed + Host routing (AC-84)', () => {
  it('parseWebviewToHostMessage fails closed on subagent nav frames', () => {
    expect(parseWebviewToHostMessage({ type: 'nav/open-subagent', childSessionId: '' })).toBeUndefined()
    expect(parseWebviewToHostMessage({ type: 'nav/open-subagent' })).toBeUndefined()
    expect(parseWebviewToHostMessage({ type: 'action/pin-subagent', childSessionId: 42 })).toBeUndefined()
    expect(parseWebviewToHostMessage({ type: 'action/pin-subagent' })).toBeUndefined()
    expect(parseWebviewToHostMessage({ type: 'nav/open-subagent', childSessionId: 'child-9' }))
      .toEqual({ type: 'nav/open-subagent', childSessionId: 'child-9' })
    expect(parseWebviewToHostMessage({ type: 'action/pin-subagent', childSessionId: 'child-9' }))
      .toEqual({ type: 'action/pin-subagent', childSessionId: 'child-9' })
    expect(parseWebviewToHostMessage({ type: 'nav/back' })).toEqual({ type: 'nav/back' })
    expect(parseWebviewToHostMessage({ type: 'unknown-frame' })).toBeUndefined()
  })

  it('Host routes nav/open-subagent → nav/back → action/pin-subagent (AC-84)', async () => {
    const { controller, panel } = setup()
    await parentWithRunningChild(controller, 'child-1')

    await panel.handleWebviewMessage({ type: 'nav/open-subagent', childSessionId: 'child-1' })
    expect(controller.registry.getActive()?.contextSessionId).toBe('child-1')

    await panel.handleWebviewMessage({ type: 'nav/back' })
    expect(controller.registry.getActive()?.contextSessionId).toBeUndefined()

    await panel.handleWebviewMessage({ type: 'nav/open-subagent', childSessionId: 'child-1' })
    await panel.handleWebviewMessage({ type: 'action/pin-subagent', childSessionId: 'child-1' })
    expect(controller.registry.getBySessionId('child-1')?.pinnedSubagent).toBe(true)
  })

  it('onSdkNotification routes subagent.started / finished (AC-39)', async () => {
    const { controller, host } = setup()
    const tab = controller.newConversation('Parent')
    const parentSessionId = tab.sessionId

    host.emitNotification({
      method: 'subagent.started',
      params: { parentSessionId, childSessionId: 'child-sdk' },
    })
    const card = controller.messages.get(parentSessionId)
      .find(m => m.kind === 'subagent' && m.childSessionId === 'child-sdk')
    expect(card?.subagentStatus).toBe('running')

    host.emitNotification({
      method: 'subagent.finished',
      params: { parentSessionId, childSessionId: 'child-sdk' },
    })
    // finished is dispatched async; yield so its projection settles.
    await Promise.resolve()
    const ended = controller.messages.get(parentSessionId)
      .find(m => m.kind === 'subagent' && m.childSessionId === 'child-sdk')
    expect(ended?.subagentStatus).toBe('ended')
  })
})
