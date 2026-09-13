/**
 * Verifier-independent Phase 4 scenarios (do not trust implementer suites).
 *
 * V-IND-1: Enter child context (no Tab) THEN pin — Tab count invariant on enter,
 *          +1 on pin, parent restored, child Tab pinnedSubagent (implementer split
 *          these across separate cases; this is one continuous e2e path).
 * V-IND-2: Delete child AFTER context enter — nav/back first, then markDeleted,
 *          re-open must refuse (implementer only deleted before first enter).
 * V-IND-3: Continue chrome alignment (DEBT-007 closed) — parent Tab in replay
 *          has continueChromeForTab enabled AND panel/state.continue=enabled.
 * V-IND-4: Param variation — open child-A then child-B; contextSessionId follows
 *          input (stub detection).
 * V-IND-5: readonly-live live projection — child session.event → messages/append
 *          on FakeWebview while still in parent Tab context (no child Tab).
 * V-IND-6: Debt-sweep combined path (implementer split DEBT-007/008/009):
 *          replay Continue chrome enabled on FakeWebview → enter finished child
 *          context → action/continue resumes contextSessionId (not parent) and
 *          promotes child Tab → delete child immediately patches parent card
 *          (no second navigation required).
 */
import { ConversationController } from '../../../../../../apps/vscode-dsh/src/conversation-controller.ts'
import {
  ChatPanelHost,
  FakeWebviewPort,
} from '../../../../../../apps/vscode-dsh/src/chat-panel/index.ts'
import type { IdeSessionHost } from '../../../../../../apps/vscode-dsh/src/session-host.ts'
import { InteractionCoordinator } from '../../../../../../apps/vscode-dsh/src/interaction-coordinator.ts'
import type { HarnessNotification } from '@deepseek-ai/dsh-sdk-client'

let failed = 0

function assert(cond: unknown, msg: string): void {
  if (!cond) {
    failed += 1
    console.error(`FAIL: ${msg}`)
  } else {
    console.log(`PASS: ${msg}`)
  }
}

function stubHost(): IdeSessionHost & {
  promptCalls: number
  emitNotification: (n: HarnessNotification) => void
} {
  const listeners = new Set<(n: HarnessNotification) => void>()
  const host = {
    promptCalls: 0,
    interactions: new InteractionCoordinator(),
    status: 'connected' as const,
    setConversationRegistry(registry?: unknown) {
      if (registry !== undefined) {
        ;(this.interactions as InteractionCoordinator).setRegistry(registry as never)
      }
    },
    onNotification(listener: (n: HarnessNotification) => void) {
      listeners.add(listener)
      return () => { listeners.delete(listener) }
    },
    emitNotification(n: HarnessNotification) {
      for (const listener of listeners) listener(n)
    },
    async prompt(_sessionId: string) {
      this.promptCalls += 1
      return 'msg'
    },
    async disposeSession() {},
    async readSessionLog() { return [] as unknown[] },
    async resumeSession() {},
  }
  return host as unknown as IdeSessionHost & {
    promptCalls: number
    emitNotification: (n: HarnessNotification) => void
  }
}

function harness() {
  const host = stubHost()
  const controller = new ConversationController(host)
  const panel = new ChatPanelHost({
    registry: controller.registry,
    messages: controller.messages,
    isHostReady: () => true,
    acceptSend: (text) => controller.promptActive(text),
    resolveContinueChrome: () => controller.continueChromeForTab(),
    resolveDeferredRestoreCount: () => controller.panelSnapshot().deferredRestoreCount,
    requestOpenSubagent: (childSessionId) => controller.openSubagentContext(childSessionId),
    requestNavBack: () => controller.navBack(),
    requestPinSubagent: (childSessionId) => controller.pinSubagent(childSessionId),
    requestContinue: async () => { await controller.continueConversation() },
    resolvePanelProjection: () => controller.resolvePanelProjection(),
  })
  controller.setPanelHost(panel)
  const fake = new FakeWebviewPort()
  panel.attach(fake)
  return {
    controller,
    panel,
    fake,
    notify: (n: HarnessNotification) => host.emitNotification(n),
  }
}

function subagentStarted(parentSessionId: string, childSessionId: string): HarnessNotification {
  return {
    method: 'subagent.started',
    params: { parentSessionId, childSessionId },
  } as HarnessNotification
}

function subagentFinished(parentSessionId: string, childSessionId: string): HarnessNotification {
  return {
    method: 'subagent.finished',
    params: {
      provider: 'test',
      agentId: childSessionId,
      parentSessionId,
      childSessionId,
      status: 'completed',
      stopReason: 'end_turn',
    },
  } as HarnessNotification
}

function userAssistantEvents(userText: string, assistantText: string) {
  return [
    {
      type: 'user/message',
      seq: 0,
      data: { role: 'user', id: `u-${userText}`, content: [{ type: 'text', text: userText }] },
    },
    {
      type: 'assistant/message',
      seq: 1,
      data: {
        message: {
          role: 'assistant',
          id: `a-${assistantText}`,
          content: [{ type: 'text', text: assistantText }],
        },
      },
    },
  ]
}

async function vInd1EnterThenPin(): Promise<void> {
  const { controller, panel, fake, notify } = harness()
  const parent = controller.newConversation('parent-v1')
  await controller.promptActive('parent prompt')
  const childId = 'vind1-child'
  notify(subagentStarted(parent.sessionId, childId))
  notify(subagentFinished(parent.sessionId, childId))
  controller.installTestHooks({
    eventsBySession: new Map([[childId, userAssistantEvents('cu', 'ca-vind1')]]),
  })

  const tabsBefore = controller.registry.list().length
  fake.receivedFromHost.length = 0
  await panel.handleWebviewMessage({ type: 'nav/open-subagent', childSessionId: childId })

  assert(controller.registry.list().length === tabsBefore, 'V-IND-1: enter does not add Tab')
  assert(controller.panelSnapshot().contextSessionId === childId, 'V-IND-1: contextSessionId=child')
  assert(controller.panelSnapshot().mode === 'replay', 'V-IND-1: ended child opens as replay')
  assert(
    fake.receivedFromHost.some(m =>
      m.type === 'panel/state'
      && m.contextSessionId === childId
      && m.sessionId === childId,
    ),
    'V-IND-1: FakeWebview panel/state projects child',
  )
  assert(
    fake.receivedFromHost.some(m =>
      m.type === 'messages/replace'
      && m.sessionId === childId
      && m.messages.some(msg => msg.role === 'assistant' && msg.text.includes('ca-vind1')),
    ),
    'V-IND-1: FakeWebview messages/replace carries child hydrate',
  )

  await panel.handleWebviewMessage({ type: 'action/pin-subagent', childSessionId: childId })
  assert(controller.registry.list().length === tabsBefore + 1, 'V-IND-1: pin adds exactly one Tab')
  assert(controller.panelSnapshot().contextSessionId === undefined, 'V-IND-1: pin clears context')
  assert(
    controller.registry.getActive()?.sessionId === parent.sessionId,
    'V-IND-1: pin restores parent as active',
  )
  assert(
    controller.registry.getBySessionId(childId) !== undefined,
    'V-IND-1: child Tab exists after pin',
  )
  assert(
    controller.index.read().openTabSet.find(t => t.sessionId === childId)?.pinnedSubagent === true,
    'V-IND-1: openTabSet.pinnedSubagent=true',
  )
}

async function vInd2DeleteChildAfterEnter(): Promise<void> {
  const { controller, panel, notify } = harness()
  const parent = controller.newConversation('parent-v2')
  await controller.promptActive('p')
  const childId = 'vind2-child'
  notify(subagentStarted(parent.sessionId, childId))
  notify(subagentFinished(parent.sessionId, childId))
  controller.installTestHooks({
    eventsBySession: new Map([[childId, userAssistantEvents('cu', 'ca')]]),
  })
  await panel.handleWebviewMessage({ type: 'nav/open-subagent', childSessionId: childId })
  assert(controller.panelSnapshot().contextSessionId === childId, 'V-IND-2: entered child')

  await panel.handleWebviewMessage({ type: 'nav/back' })
  assert(controller.panelSnapshot().contextSessionId === undefined, 'V-IND-2: back to parent')

  controller.index.upsertSession({
    sessionId: childId,
    title: 'child',
    mtime: Date.now(),
    parentSessionId: parent.sessionId,
  })
  controller.index.markDeleted(childId)

  const result = await controller.openSubagentContext(childId)
  assert(result.outcome === 'deleted', 'V-IND-2: re-open after delete → deleted')
  assert(controller.panelSnapshot().contextSessionId === undefined, 'V-IND-2: context not set')
  const card = controller.messages.get(parent.sessionId)
    .find(m => m.kind === 'subagent' && m.childSessionId === childId)
  assert(card?.subagentStatus === 'deleted', 'V-IND-2: card marked deleted')
  assert(card?.text?.includes('子会话已删除') === true, 'V-IND-2: card copy 子会话已删除')

  await panel.handleWebviewMessage({ type: 'nav/open-subagent', childSessionId: childId })
  assert(
    controller.panelSnapshot().contextSessionId === undefined,
    'V-IND-2: Webview nav also refused',
  )
}

async function vInd3ContinueChromeAlignment(): Promise<void> {
  const { controller, panel, fake, notify } = harness()
  const parent = controller.newConversation('parent-v3')
  await controller.promptActive('p')
  // Force parent Tab into replay (Continue eligible).
  controller.registry.setMode(parent.tabId, 'replay')
  controller.index.upsertSession({
    sessionId: parent.sessionId,
    title: 'parent',
    mtime: Date.now(),
    continueCapability: 'same-id',
  })

  const hostChrome = controller.continueChromeForTab(parent.tabId)
  assert(hostChrome.visibility === 'enabled', 'V-IND-3: Host continueChromeForTab=enabled on replay')

  fake.receivedFromHost.length = 0
  panel.pushFullState()
  const state = [...fake.receivedFromHost].reverse().find(m => m.type === 'panel/state')
  assert(state?.type === 'panel/state', 'V-IND-3: got panel/state')
  if (state?.type === 'panel/state') {
    assert(
      state.continue?.visibility === 'enabled',
      'V-IND-3: panel/state.continue=enabled (DEBT-007 closed; must match Host)',
    )
  }

  // Also pin a finished child and switch to it as replay Tab — same hard probe.
  const childId = 'vind3-child'
  notify(subagentStarted(parent.sessionId, childId))
  notify(subagentFinished(parent.sessionId, childId))
  controller.installTestHooks({
    eventsBySession: new Map([[childId, userAssistantEvents('cu', 'ca')]]),
  })
  await panel.handleWebviewMessage({ type: 'nav/open-subagent', childSessionId: childId })
  await panel.handleWebviewMessage({ type: 'action/pin-subagent', childSessionId: childId })
  const childTab = controller.registry.getBySessionId(childId)!
  controller.registry.switchTo(childTab.tabId)
  controller.registry.setMode(childTab.tabId, 'replay')
  controller.index.upsertSession({
    sessionId: childId,
    title: 'child',
    mtime: Date.now(),
    parentSessionId: parent.sessionId,
    continueCapability: 'same-id',
  })
  const childHostChrome = controller.continueChromeForTab(childTab.tabId)
  fake.receivedFromHost.length = 0
  panel.pushFullState()
  const childState = [...fake.receivedFromHost].reverse().find(m => m.type === 'panel/state')
  assert(childHostChrome.visibility === 'enabled', 'V-IND-3: pinned child Host chrome enabled')
  if (childState?.type === 'panel/state') {
    assert(
      childState.continue?.visibility === 'enabled',
      'V-IND-3: pinned child panel/state.continue=enabled (DEBT-007)',
    )
  }
}

async function vInd6DebtSweepCombined(): Promise<void> {
  const resumeCalls: string[] = []
  const { controller, panel, fake, notify } = harness()

  const parent = controller.newConversation('parent-v6')
  await controller.promptActive('p')
  controller.registry.setMode(parent.tabId, 'replay')
  controller.index.upsertSession({
    sessionId: parent.sessionId,
    title: 'parent',
    mtime: Date.now(),
    continueCapability: 'same-id',
  })

  fake.receivedFromHost.length = 0
  panel.pushFullState()
  const parentState = [...fake.receivedFromHost].reverse().find(m => m.type === 'panel/state')
  assert(
    parentState?.type === 'panel/state' && parentState.continue?.visibility === 'enabled',
    'V-IND-6: replay parent panel Continue chrome enabled (DEBT-007)',
  )

  const childId = 'vind6-child'
  notify(subagentStarted(parent.sessionId, childId))
  notify(subagentFinished(parent.sessionId, childId))
  controller.installTestHooks({
    resumeSession: async (sessionId) => { resumeCalls.push(sessionId) },
    eventsBySession: new Map([[childId, userAssistantEvents('cu', 'ca-v6')]]),
  })
  controller.index.upsertSession({
    sessionId: childId,
    title: 'child',
    mtime: Date.now(),
    parentSessionId: parent.sessionId,
    continueCapability: 'same-id',
  })

  await panel.handleWebviewMessage({ type: 'nav/open-subagent', childSessionId: childId })
  assert(controller.panelSnapshot().contextSessionId === childId, 'V-IND-6: entered child context')
  assert(controller.panelSnapshot().mode === 'replay', 'V-IND-6: finished child is replay')
  assert(
    controller.continueChromeForTab().visibility === 'enabled',
    'V-IND-6: Host Continue chrome enabled in child context',
  )

  fake.receivedFromHost.length = 0
  panel.pushFullState()
  const childCtxState = [...fake.receivedFromHost].reverse().find(m => m.type === 'panel/state')
  assert(
    childCtxState?.type === 'panel/state' && childCtxState.continue?.visibility === 'enabled',
    'V-IND-6: context-child panel Continue chrome enabled',
  )

  await panel.handleWebviewMessage({ type: 'action/continue' })
  assert(
    resumeCalls.length === 1 && resumeCalls[0] === childId,
    'V-IND-6: Webview Continue resumes contextSessionId only (DEBT-008)',
  )
  assert(
    controller.registry.getBySessionId(childId)?.mode === 'live',
    'V-IND-6: Continue promotes child Tab to live',
  )

  // DEBT-009: pin another finished child, delete with confirm — parent card patches
  // immediately (no re-open / markDeleted dance like V-IND-2).
  controller.registry.switchTo(parent.tabId)
  const child2 = 'vind6-child-del'
  notify(subagentStarted(parent.sessionId, child2))
  notify(subagentFinished(parent.sessionId, child2))
  controller.installTestHooks({
    eventsBySession: new Map([[child2, userAssistantEvents('cu2', 'ca2')]]),
  })
  await controller.openSubagentContext(child2)
  await controller.pinSubagent(child2)
  const child2Tab = controller.registry.getBySessionId(child2)
  assert(child2Tab !== undefined, 'V-IND-6: child2 Tab after pin')
  const cardBefore = controller.messages.get(parent.sessionId)
    .find(m => m.kind === 'subagent' && m.childSessionId === child2)
  assert(cardBefore?.subagentStatus !== 'deleted', 'V-IND-6: card not deleted before delete')

  await controller.deleteConversation(child2Tab!.tabId, { confirmed: true })

  const cardAfter = controller.messages.get(parent.sessionId)
    .find(m => m.kind === 'subagent' && m.childSessionId === child2)
  assert(cardAfter?.subagentStatus === 'deleted', 'V-IND-6: delete immediately marks parent card deleted (DEBT-009)')
  assert(
    cardAfter?.text?.includes('子会话已删除') === true,
    'V-IND-6: parent card copy 子会话已删除 without re-nav',
  )
  const reopen = await controller.openSubagentContext(child2)
  assert(reopen.outcome === 'deleted', 'V-IND-6: re-open refused after immediate delete')
}

async function vInd4ParamVariation(): Promise<void> {
  const { controller, panel, notify } = harness()
  const parent = controller.newConversation('parent-v4')
  await controller.promptActive('p')
  const childA = 'vind4-a'
  const childB = 'vind4-b'
  notify(subagentStarted(parent.sessionId, childA))
  notify(subagentStarted(parent.sessionId, childB))

  await panel.handleWebviewMessage({ type: 'nav/open-subagent', childSessionId: childA })
  const snapA = controller.panelSnapshot().contextSessionId
  await panel.handleWebviewMessage({ type: 'nav/open-subagent', childSessionId: childB })
  const snapB = controller.panelSnapshot().contextSessionId

  assert(snapA === childA, 'V-IND-4: open(A) → context=A')
  assert(snapB === childB, 'V-IND-4: open(B) → context=B')
  assert(snapA !== snapB, 'V-IND-4: different inputs → different context (not stub)')
  assert(controller.registry.list().length === 1, 'V-IND-4: still single parent Tab')
}

async function vInd5ReadonlyLiveAppend(): Promise<void> {
  const { controller, panel, fake, notify } = harness()
  const parent = controller.newConversation('parent-v5')
  await controller.promptActive('p')
  const childId = 'vind5-child'
  notify(subagentStarted(parent.sessionId, childId))

  await panel.handleWebviewMessage({ type: 'nav/open-subagent', childSessionId: childId })
  assert(controller.panelSnapshot().mode === 'readonly-live', 'V-IND-5: mode=readonly-live')

  fake.receivedFromHost.length = 0
  notify({
    method: 'session.event',
    params: {
      sessionId: childId,
      event: {
        type: 'assistant/message',
        seq: 1,
        data: {
          message: {
            role: 'assistant',
            id: 'a-live-v5',
            content: [{ type: 'text', text: 'live-child-token-v5' }],
          },
        },
      },
    },
  } as HarnessNotification)

  assert(
    controller.messages.get(childId).some(m => m.text.includes('live-child-token-v5')),
    'V-IND-5: MessageStore got child live text',
  )
  assert(
    fake.receivedFromHost.some(m =>
      m.type === 'messages/append'
      && m.sessionId === childId
      && m.message.text.includes('live-child-token-v5'),
    ),
    'V-IND-5: FakeWebview messages/append for child while in context (no child Tab)',
  )

  const rejected = await panel.sendPrompt('nope')
  assert(rejected.ok === false, 'V-IND-5: composer rejected in readonly-live')
}

async function main(): Promise<void> {
  console.log('=== Verifier independent Phase 4 ===')
  await vInd1EnterThenPin()
  await vInd2DeleteChildAfterEnter()
  await vInd3ContinueChromeAlignment()
  await vInd4ParamVariation()
  await vInd5ReadonlyLiveAppend()
  await vInd6DebtSweepCombined()
  console.log(`=== done failed=${failed} ===`)
  if (failed > 0) process.exit(1)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
