/**
 * Verifier-independent Phase 1 scenarios (do not trust implementer suites).
 *
 * V-IND-1: Close last content Tab → FakeWebview replace([]) + authority retained + no dispose;
 *          then create+delete → dispose + authority cleared (close≠dispose vs delete contrast).
 * V-IND-2: Thin-panel sendPrompt reject matrix (empty / no-active / no-host) — param variation.
 * V-IND-3: Timeline weaken keeps tool Diff entry while assistant body stays short label.
 * V-IND-4: L2 hooks via activate — openPanel / sendPrompt / closeConversation / panelSnapshot empty.
 * V-IND-5: Two Tabs both running — FakeWebview status/set only for active session (AC-21).
 */
import { ConversationController } from '../../../../../../apps/vscode-dsh/src/conversation-controller.ts'
import {
  ChatPanelHost,
  FakeWebviewPort,
} from '../../../../../../apps/vscode-dsh/src/chat-panel/index.ts'
import { IdeSessionHost } from '../../../../../../apps/vscode-dsh/src/session-host.ts'
import { TimelineStore } from '../../../../../../apps/vscode-dsh/src/timeline-store.ts'
import type { HarnessNotification } from '@deepseek-ai/dsh-sdk-client'
import {
  activate,
  deactivate,
} from '../../../../../../apps/vscode-dsh/src/extension.ts'

let failed = 0

function assert(cond: unknown, msg: string): void {
  if (!cond) {
    failed += 1
    console.error(`FAIL: ${msg}`)
  } else {
    console.log(`PASS: ${msg}`)
  }
}

function hasReplaceEmpty(frames: { type: string; messages?: unknown[] }[]): boolean {
  return frames.some(
    m => m.type === 'messages/replace' && Array.isArray(m.messages) && m.messages.length === 0,
  )
}

async function vInd1CloseLastVsDelete(): Promise<void> {
  console.log('\n== V-IND-1 close-last clear vs delete ==')
  const disposed: string[] = []
  const host = {
    status: 'connected' as const,
    interactions: { failClosedSession() {}, listPending() { return [] } },
    setConversationRegistry() {},
    onNotification() { return () => {} },
    async prompt() { return 'mid' },
    async disposeSession(sessionId: string) {
      disposed.push(sessionId)
    },
  } as unknown as IdeSessionHost

  const controller = new ConversationController(host)
  const only = controller.newConversation('only-tab')
  await controller.promptTab(only.tabId, 'authority-bubble')

  const panel = new ChatPanelHost({
    registry: controller.registry,
    messages: controller.messages,
    isHostReady: () => true,
    acceptSend: (text) => controller.promptActive(text),
  })
  controller.setPanelHost(panel)
  const fake = new FakeWebviewPort()
  panel.attach(fake)

  // Thin panel send (not only controller.promptTab) — independent of implementer L3 send case shape.
  fake.receivedFromHost.length = 0
  panel.clearOutboundLog()
  fake.emitFromWebview({ type: 'composer/send', text: 'from-thin-panel' })
  await waitFor(() => controller.messages.get(only.sessionId).some(m => m.text === 'from-thin-panel'), 1_000)
  assert(
    controller.messages.get(only.sessionId).map(m => m.text).includes('from-thin-panel'),
    'V-IND-1 thin panel composer/send projects user text',
  )

  fake.receivedFromHost.length = 0
  panel.clearOutboundLog()
  const closed = await controller.closeConversation(only.tabId)
  assert(closed.outcome === 'closed', 'V-IND-1 close last Tab outcome=closed')
  assert(disposed.length === 0, 'V-IND-1 close last Tab must NOT dispose')
  assert(controller.registry.getActive() === undefined, 'V-IND-1 registry empty after last close')
  assert(
    controller.messages.hasContent(only.sessionId) === true,
    'V-IND-1 MessageStore authority retained after close (not wipe)',
  )
  assert(
    fake.receivedFromHost.some(m => m.type === 'panel/state' && m.mode === 'empty'),
    'V-IND-1 FakeWebview got panel/state:empty',
  )
  assert(hasReplaceEmpty(fake.receivedFromHost), 'V-IND-1 hasReplaceEmpty === true (messages/replace([]))')
  const clearFrame = fake.receivedFromHost.find(
    m => m.type === 'messages/replace' && m.messages.length === 0,
  )
  assert(
    clearFrame !== undefined
      && clearFrame.type === 'messages/replace'
      && clearFrame.sessionId === '',
    'V-IND-1 clear frame sessionId === \'\' sentinel',
  )

  // Contrast: delete path on a fresh content Tab must dispose + clear authority.
  const doomed = controller.newConversation('doomed')
  await controller.promptTab(doomed.tabId, 'will-delete')
  const needs = await controller.deleteConversation(doomed.tabId)
  assert(needs.outcome === 'needs-confirm', 'V-IND-1 delete without confirm asks first')
  assert(disposed.length === 0, 'V-IND-1 delete confirm-gate does not dispose yet')
  const deleted = await controller.deleteConversation(doomed.tabId, { confirmed: true })
  assert(deleted.outcome === 'deleted', 'V-IND-1 delete confirmed → deleted')
  assert(disposed.includes(doomed.sessionId), 'V-IND-1 delete calls disposeSession')
  assert(
    controller.messages.hasContent(doomed.sessionId) === false,
    'V-IND-1 delete clears MessageStore authority',
  )
  // Closed-only session still recoverable in MessageStore (contrast).
  assert(
    controller.messages.hasContent(only.sessionId) === true,
    'V-IND-1 previously closed (not deleted) session still has authority',
  )
}

async function vInd2RejectMatrix(): Promise<void> {
  console.log('\n== V-IND-2 sendPrompt reject param variation ==')
  const prompts: string[] = []
  const host = {
    status: 'connected' as const,
    interactions: { failClosedSession() {}, listPending() { return [] } },
    setConversationRegistry() {},
    onNotification() { return () => {} },
    async prompt(_s: string, blocks: { text?: string }[]) {
      prompts.push(blocks[0]?.text ?? '')
      return 'm'
    },
    async disposeSession() {},
  } as unknown as IdeSessionHost
  const controller = new ConversationController(host)
  const panel = new ChatPanelHost({
    registry: controller.registry,
    messages: controller.messages,
    isHostReady: () => host.status === 'connected',
    acceptSend: (text) => controller.promptActive(text),
  })
  const fake = new FakeWebviewPort()
  panel.attach(fake)

  // No active Tab → no-active
  panel.clearOutboundLog()
  const r1 = await panel.sendPrompt('x')
  assert(r1.ok === false && r1.reason === 'no-active', 'V-IND-2 reject no-active')
  assert(
    panel.getOutboundLog().some(m => m.type === 'ui/reject-send' && m.reason === 'no-active'),
    'V-IND-2 ui/reject-send no-active posted',
  )

  const tab = controller.newConversation('live')
  panel.pushFullState()
  panel.clearOutboundLog()
  const r2 = await panel.sendPrompt('   ')
  assert(r2.ok === false && r2.reason === 'empty', 'V-IND-2 reject empty')
  assert(prompts.length === 0, 'V-IND-2 empty does not call prompt')

  ;(host as { status: string }).status = 'disconnected'
  panel.clearOutboundLog()
  const r3 = await panel.sendPrompt('hello')
  assert(r3.ok === false && r3.reason === 'no-host', 'V-IND-2 reject no-host')
  assert(prompts.length === 0, 'V-IND-2 no-host does not call prompt')

  // Different reject reasons ⇒ not a stub that always returns the same reason.
  assert(
    r1.reason !== r2.reason && r2.reason !== r3.reason,
    'V-IND-2 reject reasons vary with inputs (not stub)',
  )
  void tab
}

function vInd3TimelineWeaken(): void {
  console.log('\n== V-IND-3 Timeline weaken + Diff ==')
  const store = new TimelineStore()
  const long = 'ASSISTANT_BODY_' + 'z'.repeat(120)
  store.apply({
    method: 'session.event',
    params: {
      sessionId: 's1',
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
  store.apply({
    method: 'session.event',
    params: {
      sessionId: 's1',
      event: {
        type: 'tool/result',
        data: {
          name: 'Write',
          toolCallId: 'tc1',
          meta: {
            diffs: [{ path: '/tmp/a.ts', oldText: 'a', newText: 'b' }],
          },
        },
      },
    },
  } as HarnessNotification)

  const assistant = store.itemsForSession('s1').find(r => r.kind === 'assistant')
  assert(assistant !== undefined, 'V-IND-3 assistant timeline row exists')
  assert(
    assistant?.description === 'assistant turn' || !(assistant?.description ?? '').includes(long),
    'V-IND-3 assistant description is not long body',
  )
  assert(!(assistant?.label ?? '').includes(long), 'V-IND-3 assistant label excludes long body')

  const tool = store.itemsForSession('s1').find(r => r.kind === 'tool' || (r.diffs?.length ?? 0) > 0)
  const withDiff = store.itemsForSession('s1').find(r => (r.diffs?.length ?? 0) > 0)
  assert(withDiff !== undefined || tool !== undefined, 'V-IND-3 tool/Diff entry retained')
  if (withDiff) {
    assert((withDiff.diffs?.length ?? 0) >= 1, 'V-IND-3 Diff hunk present on timeline item')
  }
}

async function vInd5DualRunningActiveOnly(): Promise<void> {
  console.log('\n== V-IND-5 AC-21 dual running → active status only ==')
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
  const b = controller.newConversation('B')
  controller.registry.setStatus(a.tabId, 'running')
  controller.registry.setStatus(b.tabId, 'running')
  controller.switchConversation(a.tabId)

  const panel = new ChatPanelHost({
    registry: controller.registry,
    messages: controller.messages,
    interactions: host.interactions,
    isHostReady: () => true,
    acceptSend: (text) => controller.promptActive(text),
  })
  const fake = new FakeWebviewPort()
  panel.attach(fake)
  fake.receivedFromHost.length = 0
  panel.pushFullState()

  const statusA = fake.receivedFromHost.find(m => m.type === 'status/set')
  assert(
    statusA?.type === 'status/set'
      && statusA.sessionId === a.sessionId
      && statusA.status === 'generating',
    'V-IND-5 active Tab A status=generating',
  )
  assert(
    !fake.receivedFromHost.some(
      m => m.type === 'status/set' && m.sessionId === b.sessionId,
    ),
    'V-IND-5 inactive Tab B status not pushed (no cross-talk)',
  )

  fake.receivedFromHost.length = 0
  controller.switchConversation(b.tabId)
  panel.pushFullState()
  const statusB = fake.receivedFromHost.find(m => m.type === 'status/set')
  assert(
    statusB?.type === 'status/set'
      && statusB.sessionId === b.sessionId
      && statusB.status === 'generating',
    'V-IND-5 after switch, active B status=generating',
  )
  assert(
    !fake.receivedFromHost.some(
      m => m.type === 'status/set' && m.sessionId === a.sessionId,
    ),
    'V-IND-5 after switch, A status not pushed',
  )
}

async function vInd4L2HooksActivate(): Promise<void> {
  console.log('\n== V-IND-4 L2 hooks via activate ==')
  const commands = new Map<string, (...args: unknown[]) => unknown>()
  try {
    activate({
      subscriptions: [],
      extensionPath: '/tmp/dsh-v-ind4',
      workspaceState: {
        get() { return undefined },
        update() {},
      },
    }, {
      window: {
        async showErrorMessage() {},
        async showInformationMessage() { return undefined },
        async showWarningMessage() { return undefined },
        createTreeView() {
          return { dispose() {}, reveal() {} }
        },
        registerWebviewViewProvider(viewId: string) {
          assert(viewId === 'dsh.chat', 'V-IND-4 registers dsh.chat provider')
          return { dispose() {} }
        },
        createQuickPick() {
          return {
            items: [],
            onDidAccept() { return { dispose() {} } },
            onDidHide() { return { dispose() {} } },
            show() {},
            hide() {},
            dispose() {},
          }
        },
        createInputBox() {
          return {
            onDidAccept() { return { dispose() {} } },
            onDidHide() { return { dispose() {} } },
            show() {},
            hide() {},
            dispose() {},
          }
        },
      },
      workspace: {
        workspaceFolders: [{ uri: { fsPath: '/tmp/dsh-v-ind4' } }],
      },
      commands: {
        registerCommand(command: string, callback: (...args: unknown[]) => unknown) {
          commands.set(command, callback)
          return { dispose() {} }
        },
      },
    } as never)

    for (const name of [
      'dsh.test.sendPrompt',
      'dsh.test.closeConversation',
      'dsh.test.deleteConversation',
      'dsh.test.panelSnapshot',
      'dsh.test.getIndex',
      'dsh.test.openPanel',
      'dsh.deleteConversation',
      'dsh.closeConversation',
    ]) {
      assert(commands.has(name), `V-IND-4 hook registered: ${name}`)
    }

    const open = await commands.get('dsh.test.openPanel')!()
    assert(
      open !== null && typeof open === 'object' && (open as { ok?: boolean }).ok === true,
      'V-IND-4 dsh.test.openPanel ok',
    )

    const snap0 = await commands.get('dsh.test.panelSnapshot')!() as {
      mode: string
      messages: unknown[]
    }
    assert(
      snap0.mode === 'waiting-host' || snap0.mode === 'empty',
      `V-IND-4 initial snapshot mode empty/waiting-host (got ${snap0.mode})`,
    )
    assert(Array.isArray(snap0.messages) && snap0.messages.length === 0, 'V-IND-4 initial messages []')

    const rejected = await commands.get('dsh.test.sendPrompt')!('ping')
    assert(
      rejected !== null
        && typeof rejected === 'object'
        && (rejected as { ok?: boolean }).ok === false,
      'V-IND-4 sendPrompt without host rejects',
    )
  } finally {
    await deactivate()
  }
}

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

async function main(): Promise<void> {
  console.log('Verifier independent Phase 1 scenarios')
  await vInd1CloseLastVsDelete()
  await vInd2RejectMatrix()
  vInd3TimelineWeaken()
  await vInd5DualRunningActiveOnly()
  await vInd4L2HooksActivate()
  console.log(`\n== Summary: failed=${failed} ==`)
  if (failed > 0) {
    process.exitCode = 1
  } else {
    console.log('ALL VERIFIER-INDEPENDENT PHASE-1 STEPS OK')
  }
}

main().catch((err) => {
  console.error(err)
  process.exitCode = 1
})
