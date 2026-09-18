/**
 * Verifier independent e2e for phase-4 (V-IND-A..E) — 独立于 implementer 的 phase4 spec 与
 * 既有 verifier-independent-phase4.mts。全部走真实 ChatPanelHost 协议层（handleWebviewMessage
 * 驱动 nav/open-subagent / nav/back / action/pin-subagent），用 FakeWebviewPort 捕获 Host 帧。
 *
 * V-IND-A: running + finished 两种子会话通过 nav/open-subagent 进入；panel/state 携带
 *          contextSessionId=child 且 mode ∈ {readonly-live, replay}；Tab 数不变（AC-35/37）。
 * V-IND-B: nav/back 清除 context，恢复父根 live 投影（AC-36）。
 * V-IND-C: running 进入 → composer sendPrompt 拒绝 reason='readonly-live'；finished 事件后
 *          投影翻转为 replay（AC-40/71）。
 * V-IND-D: action/pin-subagent 钉 Tab → +1 Tab + pinnedSubagent + 父恢复 active（AC-38/79）；
 *          再次从父进入 → activated-tab（去重，AC-78）。
 * V-IND-E: 删子 → 父卡 deleted + 再进入返回 deleted（AC-74）；删父 → 子面包屑 parentDeleted +
 *          navBack disabled（AC-75）。
 * V-SF-1: SHOULD-FIX-1 闭合确认 —— 钉 running 子会话的 Tab 投影 readonly-live（不再可写 live 缝隙），
 *          registry 层 mode 仍为 'live'（双层模型），结束才翻 replay。
 */
import { ConversationController } from '../../../../../../apps/vscode-dsh/src/conversation-controller.ts'
import {
  ChatPanelHost,
  FakeWebviewPort,
  parseWebviewToHostMessage,
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
  emitNotification: (n: HarnessNotification) => void
} {
  const listeners = new Set<(n: HarnessNotification) => void>()
  const host = {
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
    async prompt(_sessionId: string) { return 'msg' },
    async disposeSession() {},
    async readSessionLog() { return [] as unknown[] },
    async resumeSession() {},
  }
  return host as unknown as IdeSessionHost & {
    emitNotification: (n: HarnessNotification) => void
  }
}

function harness() {
  const host = stubHost()
  const controller = new ConversationController(host)
  const panel = new ChatPanelHost({
    registry: controller.registry,
    messages: controller.messages,
    isHostReady: () => host.status === 'connected',
    acceptSend: (text) => controller.promptActive(text),
    resolvePanelProjection: () => controller.resolvePanelProjection(),
    requestOpenSubagent: (childSessionId) => controller.openSubagentContext(childSessionId),
    requestNavBack: () => controller.navBack(),
    requestPinSubagent: (childSessionId) => controller.pinSubagent(childSessionId),
    resolveContinueChrome: () => controller.continueChromeForTab(),
    resolveDeferredRestoreCount: () => controller.panelSnapshot().deferredRestoreCount,
  })
  controller.setPanelHost(panel)
  const fake = new FakeWebviewPort()
  panel.attach(fake)
  return { host, controller, panel, fake, notify: (n: HarnessNotification) => host.emitNotification(n) }
}

const started = (parentSessionId: string, childSessionId: string): HarnessNotification =>
  ({ method: 'subagent.started', params: { parentSessionId, childSessionId } }) as HarnessNotification
const finished = (parentSessionId: string, childSessionId: string): HarnessNotification =>
  ({
    method: 'subagent.finished',
    params: {
      provider: 'test',
      agentId: childSessionId,
      parentSessionId,
      childSessionId,
      status: 'completed',
      stopReason: 'end_turn',
    },
  }) as HarnessNotification

async function makeParent(controller: ConversationController, childId: string): Promise<string> {
  const tab = controller.newConversation('Parent')
  await controller.promptTab(tab.tabId, 'parent prompt')
  await controller.applyTestSubagentNotification('started', tab.sessionId, childId)
  return tab.sessionId
}

async function vIndA(): Promise<void> {
  const { controller, panel, fake, notify } = harness()
  const parent = await makeParent(controller, 'child-a')
  const tabsBefore = controller.registry.list().length

  // Running child → readonly-live.
  fake.receivedFromHost.length = 0
  await panel.handleWebviewMessage({ type: 'nav/open-subagent', childSessionId: 'child-a' })
  assert(controller.registry.list().length === tabsBefore, 'V-IND-A: running enter adds no Tab (AC-37)')
  assert(controller.panelSnapshot().contextSessionId === 'child-a', 'V-IND-A: contextSessionId=child')
  assert(controller.panelSnapshot().mode === 'readonly-live', 'V-IND-A: running child projects readonly-live')
  assert(
    fake.receivedFromHost.some(
      (m) => m.type === 'panel/state' && m.contextSessionId === 'child-a' && m.mode === 'readonly-live',
    ),
    'V-IND-A: panel/state carries contextSessionId=child + readonly-live (AC-35/71)',
  )
  await panel.handleWebviewMessage({ type: 'nav/back' })

  // Finished child → replay.
  notify(finished(parent, 'child-a'))
  controller.installTestHooks({
    eventsBySession: new Map([[
      'child-a',
      [
        { type: 'user/message', seq: 0, data: { role: 'user', id: 'u', content: [{ type: 'text', text: 'u' }] } },
        {
          type: 'assistant/message',
          seq: 1,
          data: { message: { role: 'assistant', id: 'a', content: [{ type: 'text', text: 'ca-vinda' }] } },
        },
      ],
    ]]),
  })
  fake.receivedFromHost.length = 0
  await panel.handleWebviewMessage({ type: 'nav/open-subagent', childSessionId: 'child-a' })
  assert(controller.panelSnapshot().mode === 'replay', 'V-IND-A: finished child projects replay (AC-40)')
  assert(
    fake.receivedFromHost.some(
      (m) => m.type === 'messages/replace' && m.sessionId === 'child-a' && m.messages.some((x) => x.text?.includes('ca-vinda')),
    ),
    'V-IND-A: messages/replace carries hydrated child stream (AC-35)',
  )
  assert(controller.registry.list().length === tabsBefore, 'V-IND-A: finished enter also adds no Tab')
}

async function vIndB(): Promise<void> {
  const { controller, panel } = harness()
  const parent = await makeParent(controller, 'child-b')
  await panel.handleWebviewMessage({ type: 'nav/open-subagent', childSessionId: 'child-b' })
  assert(controller.panelSnapshot().contextSessionId === 'child-b', 'V-IND-B: entered child')

  await panel.handleWebviewMessage({ type: 'nav/back' })
  assert(controller.panelSnapshot().contextSessionId === undefined, 'V-IND-B: back clears context (AC-36)')
  const proj = controller.resolvePanelProjection()
  assert(proj?.sessionId === parent, 'V-IND-B: projection restored to parent session')
  assert(proj?.mode === 'live', 'V-IND-B: parent restored to live')
  assert(proj?.breadcrumb === undefined, 'V-IND-B: no breadcrumb at parent root')
}

async function vIndC(): Promise<void> {
  const { controller, panel, notify } = harness()
  const parent = await makeParent(controller, 'child-c')
  await panel.handleWebviewMessage({ type: 'nav/open-subagent', childSessionId: 'child-c' })

  const rejected = await panel.sendPrompt('should be blocked')
  assert(rejected.ok === false, 'V-IND-C: running child rejects send')
  assert(rejected.reason === 'readonly-live', `V-IND-C: reject reason readonly-live (got ${JSON.stringify(rejected)}) (AC-71)`)

  notify(finished(parent, 'child-c'))
  assert(controller.resolvePanelProjection()?.mode === 'replay', 'V-IND-C: finished flips projection to replay (AC-40/71)')
  assert(controller.resolvePanelProjection()?.contextSessionId === 'child-c', 'V-IND-C: context retained after flip')
}

async function vIndD(): Promise<void> {
  const { controller, panel } = harness()
  const parent = await makeParent(controller, 'child-d')
  await panel.handleWebviewMessage({ type: 'nav/open-subagent', childSessionId: 'child-d' })

  const tabsBefore = controller.registry.list().length
  await panel.handleWebviewMessage({ type: 'action/pin-subagent', childSessionId: 'child-d' })
  assert(controller.registry.list().length === tabsBefore + 1, 'V-IND-D: pin adds exactly one Tab (AC-38)')
  const childTab = controller.registry.getBySessionId('child-d')
  assert(childTab?.pinnedSubagent === true, 'V-IND-D: child Tab pinnedSubagent=true')
  assert(controller.registry.getActive()?.sessionId === parent, 'V-IND-D: pin restores parent active (AC-79)')
  assert(controller.panelSnapshot().contextSessionId === undefined, 'V-IND-D: pin clears context')

  // Dedup: re-enter from parent activates existing Tab (AC-78).
  const result = await controller.openSubagentContext('child-d')
  assert(result.outcome === 'activated-tab', `V-IND-D: re-enter activates existing Tab (got ${JSON.stringify(result)}) (AC-78)`)
  assert(controller.registry.getActive()?.sessionId === 'child-d', 'V-IND-D: active is child Tab after activation')
}

async function vIndE(): Promise<void> {
  const { controller, panel } = harness()
  const parent = await makeParent(controller, 'child-e')

  // AC-74: delete child → parent card deleted + re-enter refused.
  await controller.deleteSession('child-e', { confirmed: true })
  const card = controller.messages.get(parent).find((m) => m.kind === 'subagent' && m.childSessionId === 'child-e')
  assert(card?.subagentStatus === 'deleted', 'V-IND-E: delete child marks parent card deleted (AC-74)')
  assert(card?.text === '子会话已删除', 'V-IND-E: card copy 子会话已删除')
  const reopen = await controller.openSubagentContext('child-e')
  assert(reopen.outcome === 'deleted', 'V-IND-E: deleted child not enterable (AC-74)')
  assert(controller.panelSnapshot().contextSessionId === undefined, 'V-IND-E: context not set after refused enter')

  // AC-75: delete parent → child breadcrumb disabled.
  const parent2 = await makeParent(controller, 'child-e2')
  await panel.handleWebviewMessage({ type: 'nav/open-subagent', childSessionId: 'child-e2' })
  await panel.handleWebviewMessage({ type: 'action/pin-subagent', childSessionId: 'child-e2' })
  const childTab = controller.registry.getBySessionId('child-e2')!
  controller.registry.switchTo(childTab.tabId)
  assert(controller.registry.getActive()?.sessionId === 'child-e2', 'V-IND-E: on pinned child Tab')

  await controller.deleteSession(parent2, { confirmed: true })
  const proj = controller.resolvePanelProjection()
  assert(proj?.breadcrumb?.parentDeleted === true, 'V-IND-E: parent deleted → breadcrumb.parentDeleted (AC-75)')
  assert(proj?.breadcrumb?.label === '父会话已删除', 'V-IND-E: breadcrumb label 父会话已删除')
  assert(controller.navBack().outcome === 'disabled', 'V-IND-E: navBack disabled when parent deleted (AC-75)')
}

async function vSf1(): Promise<void> {
  // SHOULD-FIX-1 (fixed): pinning a running child must NOT create a writable live seam —
  // the pinned Tab projects readonly-live (same as the in-panel context path) until finished.
  const { controller, panel } = harness()
  await makeParent(controller, 'child-sf1')
  await panel.handleWebviewMessage({ type: 'nav/open-subagent', childSessionId: 'child-sf1' })
  assert(controller.resolvePanelProjection()?.mode === 'readonly-live', 'V-SF-1: context enter is readonly-live (pre-pin)')

  await panel.handleWebviewMessage({ type: 'action/pin-subagent', childSessionId: 'child-sf1' })
  const childTab = controller.registry.getBySessionId('child-sf1')!
  assert(childTab?.mode === 'live', `V-SF-1: pinned RUNNING child registry mode stays 'live' (two-layer model), got '${childTab?.mode}'`)

  // The pinned child Tab, when active, projects readonly-live (NOT writable live) — SHOULD-FIX-1 已闭合.
  controller.registry.switchTo(childTab.tabId)
  assert(controller.resolvePanelProjection()?.mode === 'readonly-live', 'V-SF-1: pinned running child projects readonly-live — SHOULD-FIX-1 已闭合')
}

async function main(): Promise<void> {
  console.log('=== Verifier independent e2e Phase 4 (V-IND-A..E + V-SF-1) ===')
  // protocol fail-closed sanity (not a scenario, but confirms the parser is wired).
  assert(parseWebviewToHostMessage({ type: 'nav/open-subagent', childSessionId: '' }) === undefined, 'parser: empty childSessionId fails closed')
  assert(parseWebviewToHostMessage({ type: 'nav/open-subagent', childSessionId: 'x' })?.type === 'nav/open-subagent', 'parser: valid frame parsed')
  await vIndA()
  await vIndB()
  await vIndC()
  await vIndD()
  await vIndE()
  await vSf1()
  console.log(`=== done failed=${failed} ===`)
  if (failed > 0) process.exit(1)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
