/**
 * Verifier independent re-run for phase-4 SHOULD-FIX-1/2 closure (不信任 implementer/reviewer 结论).
 *
 * V-FIX-1 (SHOULD-FIX-1): 钉「运行中」子会话 Tab 投影 readonly-live（与上下文进入路径口径统一）——
 *   全协议链路：nav/open-subagent(上下文) → action/pin-subagent(钉) → nav/open-subagent(激活已有 Tab)
 *   → resolvePanelProjection().mode === 'readonly-live'（修复后） → composer/send（真实协议帧）
 *   被 reject('readonly-live') 且 FakeWebview 收到 ui/reject-send 帧 → subagent.finished
 *   → 投影翻转为 replay → 再发送 reject('replay')。同时断言 registry mode 仍为 'live'（双层模型：
 *   投影层 readonly-live，registry OpenTabMode 不扩展），证明修复落在投影层而非注册表层。
 *
 * V-FIX-2 (SHOULD-FIX-2): 删除 TimelineStore.childrenOf() 后，私有 children map 相关边仍工作——
 *   getParent 面包屑族谱 / clearSession 级联删除 / collectTree(itemsForSessionTree) / isDescendantOf
 *   均不回归；并断言实例上已无 childrenOf 方法（运行时确认死 API 已删除，非仅静态 grep）。
 */
import { ConversationController } from '../../../../../../apps/vscode-dsh/src/conversation-controller.ts'
import {
  ChatPanelHost,
  FakeWebviewPort,
  parseWebviewToHostMessage,
} from '../../../../../../apps/vscode-dsh/src/chat-panel/index.ts'
import type { IdeSessionHost } from '../../../../../../apps/vscode-dsh/src/session-host.ts'
import { InteractionCoordinator } from '../../../../../../apps/vscode-dsh/src/interaction-coordinator.ts'
import { TimelineStore } from '../../../../../../apps/vscode-dsh/src/timeline-store.ts'
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

function flush(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0))
}

function stubHost(): IdeSessionHost & { emitNotification: (n: HarnessNotification) => void } {
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
  return host as unknown as IdeSessionHost & { emitNotification: (n: HarnessNotification) => void }
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

async function vFix1(): Promise<void> {
  const { controller, panel, fake, notify } = harness()
  const parent = await makeParent(controller, 'child-fix1')

  // 1) 上下文进入（不钉）→ readonly-live。
  await panel.handleWebviewMessage({ type: 'nav/open-subagent', childSessionId: 'child-fix1' })
  assert(controller.resolvePanelProjection()?.mode === 'readonly-live', 'V-FIX-1: context enter = readonly-live')

  // 2) 钉成 Tab → 恢复父 active。
  await panel.handleWebviewMessage({ type: 'action/pin-subagent', childSessionId: 'child-fix1' })
  const childTab = controller.registry.getBySessionId('child-fix1')
  assert(childTab !== undefined, 'V-FIX-1: pin minted a child Tab')
  assert(childTab?.pinnedSubagent === true, 'V-FIX-1: child Tab pinnedSubagent=true')
  assert(controller.registry.getActive()?.sessionId === parent, 'V-FIX-1: pin restores parent active')

  // 3) 重新进入已钉 Tab（激活）。
  const enter = await controller.openSubagentContext('child-fix1')
  assert(enter.outcome === 'activated-tab', `V-FIX-1: re-enter activates pinned Tab (got ${JSON.stringify(enter)})`)
  assert(controller.registry.getActive()?.sessionId === 'child-fix1', 'V-FIX-1: active is pinned child Tab')

  // 4) 修复后核心断言：钉运行中子 Tab 投影 readonly-live（不再可写 live 缝隙）。
  const proj = controller.resolvePanelProjection()
  assert(proj?.mode === 'readonly-live', `V-FIX-1: pinned RUNNING child projects readonly-live (got ${proj?.mode}) (SHOULD-FIX-1 fixed)`)
  assert(proj?.sessionId === 'child-fix1', 'V-FIX-1: projection sessionId = child')

  // 双层模型：registry 层 mode 仍为 'live'（OpenTabMode 不扩展 readonly-live）。
  assert(childTab?.mode === 'live', `V-FIX-1: registry mode stays 'live' (two-layer model), got ${childTab?.mode}`)

  // 5) 真实协议帧 composer/send → reject('readonly-live')，FakeWebview 收到 ui/reject-send。
  fake.receivedFromHost.length = 0
  await panel.handleWebviewMessage({ type: 'composer/send', text: 'should be blocked' })
  assert(
    fake.receivedFromHost.some((m) => m.type === 'ui/reject-send' && m.reason === 'readonly-live'),
    'V-FIX-1: composer/send posts ui/reject-send reason=readonly-live (real protocol path)',
  )
  const send = await panel.sendPrompt('blocked again')
  assert(send.ok === false && send.reason === 'readonly-live', `V-FIX-1: sendPrompt reject readonly-live (got ${JSON.stringify(send)})`)

  // 6) 结束 → 投影翻转 replay，registry mode 翻 replay，再发送 reject('replay')。
  notify(finished(parent, 'child-fix1'))
  await flush()
  await flush()
  assert(controller.resolvePanelProjection()?.mode === 'replay', 'V-FIX-1: finished flips pinned Tab projection to replay')
  const childTabAfter = controller.registry.getBySessionId('child-fix1')
  assert(childTabAfter?.mode === 'replay', `V-FIX-1: finished flips registry mode to replay (got ${childTabAfter?.mode})`)
  const afterFinish = await panel.sendPrompt('still blocked')
  assert(afterFinish.ok === false && afterFinish.reason === 'replay', `V-FIX-1: after finish reject reason=replay (got ${JSON.stringify(afterFinish)})`)

  // 7) 与上下文进入路径口径一致：同一 running 子，context 路径与钉 Tab 路径均为 readonly-live。
  //    （已由第 1 步与第 4 步共同证明，两条路径无口径分裂。）
}

async function vFix2(): Promise<void> {
  const store = new TimelineStore()
  const parent = 'tl-parent'
  const child = 'tl-child'
  const grandchild = 'tl-grandchild'

  // 运行时确认 dead API 已删除（非仅静态 grep）。
  assert((store as unknown as Record<string, unknown>).childrenOf === undefined, 'V-FIX-2: childrenOf method removed at runtime')

  // 建立父子 + 孙边。
  store.apply({ method: 'subagent.started', params: { parentSessionId: parent, childSessionId: child } } as HarnessNotification)
  store.apply({ method: 'subagent.started', params: { parentSessionId: child, childSessionId: grandchild } } as HarnessNotification)

  assert(store.getParent(child) === parent, 'V-FIX-2: getParent(child) === parent (面包屑族谱)')
  assert(store.getParent(grandchild) === child, 'V-FIX-2: getParent(grandchild) === child')
  assert(store.isDescendantOf(grandchild, parent) === true, 'V-FIX-2: isDescendantOf(grandchild, parent) === true')

  // 私有 children map 驱动 collectTree → itemsForSessionTree 覆盖三代。
  store.apply({ method: 'session.status', params: { sessionId: parent, status: 'idle' } } as HarnessNotification)
  store.apply({ method: 'session.status', params: { sessionId: child, status: 'idle' } } as HarnessNotification)
  store.apply({ method: 'session.status', params: { sessionId: grandchild, status: 'idle' } } as HarnessNotification)
  const tree = store.itemsForSessionTree(parent)
  const treeSessionIds = new Set(tree.map((i) => i.sessionId))
  assert(
    treeSessionIds.has(parent) && treeSessionIds.has(child) && treeSessionIds.has(grandchild),
    `V-FIX-2: itemsForSessionTree reaches 3 generations via private children map (sessions: ${[...treeSessionIds].join(',')})`,
  )

  // clearSession 级联删除：删父 → 子/孙的 parent 边与可达性一并清除。
  store.clearSession(parent)
  assert(store.getParent(child) === undefined, 'V-FIX-2: clearSession(parent) cascades — getParent(child) cleared')
  assert(store.getParent(grandchild) === undefined, 'V-FIX-2: clearSession(parent) cascades — getParent(grandchild) cleared')
  assert(store.isDescendantOf(child, parent) === false, 'V-FIX-2: isDescendantOf(child, parent) false after cascade clear')
  assert(store.itemsForSessionTree(parent).length === 0, 'V-FIX-2: tree empty after cascade clear')
}

async function main(): Promise<void> {
  console.log('=== Verifier independent SHOULD-FIX re-run (V-FIX-1/2) ===')
  // 协议 fail-closed 基线（parser 仍正确接线）。
  assert(parseWebviewToHostMessage({ type: 'nav/open-subagent', childSessionId: '' }) === undefined, 'parser: empty childSessionId fails closed')
  assert(parseWebviewToHostMessage({ type: 'action/pin-subagent', childSessionId: 'x' })?.type === 'action/pin-subagent', 'parser: valid pin frame parsed')
  await vFix1()
  await vFix2()
  console.log(`=== done failed=${failed} ===`)
  if (failed > 0) process.exit(1)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
