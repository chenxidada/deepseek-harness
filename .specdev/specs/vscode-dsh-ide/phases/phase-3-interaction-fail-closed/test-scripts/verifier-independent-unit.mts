/**
 * Verifier-owned unit scenarios for Phase 3 GAP-005..009 debt-fix loop.
 * Assertions updated: former "gap still open" probes now assert gaps CLOSED.
 *
 * V-U1: AC-31 validateBridgeFrame rejects illegal outcomes / answers.
 * V-U2: AC-10 InteractionCoordinator routes two sessionIds to distinct Tabs.
 * V-U3: STUB-001/002 anti-stub — Host outcome/answer varies with UI.
 * V-U4: AC-16 InteractionUi maps QuickPick → legal ApprovalOutcome only.
 * V-U5: GAP-008 CLOSED — empty options → showInputBox custom (not QuickPick skip).
 * V-U6: GAP-006 CLOSED — failClosedAll aborts AbortSignal; createQuickPick.hide().
 * V-U7: GAP-009 CLOSED — closeConversation failClosedSession before dispose.
 * V-U8: GAP-005 CLOSED — extension onError → showErrorMessage('…session error…').
 * V-U9: INDEPENDENT — failClosedSession aborts only matching sessionId (param variation).
 *
 * Run:
 *   PATH="/usr/local/n/versions/node/24.3.0/bin:$PATH" \
 *   ./node_modules/.bin/tsx \
 *   .specdev/specs/vscode-dsh-ide/phases/phase-3-interaction-fail-closed/test-scripts/verifier-independent-unit.mts
 */

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import {
  validateBridgeFrame,
  isApprovalOutcome,
  isAskUserQuestionAnswer,
} from '../../../../../../packages/ide/ide-bridge/src/validate.ts'
import { ConversationRegistry } from '../../../../../../apps/vscode-dsh/src/conversation-registry.ts'
import { InteractionCoordinator } from '../../../../../../apps/vscode-dsh/src/interaction-coordinator.ts'
import {
  createVscodeInteractionUi,
  type InteractionQuickPick,
  type InteractionQuickPickItem,
  type InteractionWindow,
} from '../../../../../../apps/vscode-dsh/src/interaction-ui.ts'
import { ConversationController } from '../../../../../../apps/vscode-dsh/src/conversation-controller.ts'
import type { IdeSessionHost } from '../../../../../../apps/vscode-dsh/src/session-host.ts'

function assert(cond: unknown, message: string): asserts cond {
  if (!cond) throw new Error(`ASSERT: ${message}`)
  console.log(`PASS  ${message}`)
}

const repoRoot = fileURLToPath(new URL('../../../../../../', import.meta.url))

// --- V-U1: AC-31 parameter variation ---
{
  const legal = validateBridgeFrame({
    kind: 'approval/response',
    id: 'a1',
    outcome: 'allowed-once',
  })
  const illegalAllowAll = validateBridgeFrame({
    kind: 'approval/response',
    id: 'a1',
    outcome: 'allow-all',
  })
  const illegalRejectedTypo = validateBridgeFrame({
    kind: 'approval/response',
    id: 'a1',
    outcome: 'reject',
  })
  const legalAnswer = validateBridgeFrame({
    kind: 'user-questions/response',
    id: 'q1',
    answer: { answers: [{ id: 'q1', selected: ['yes'] }] },
  })
  const illegalAnswer = validateBridgeFrame({
    kind: 'user-questions/response',
    id: 'q1',
    answer: { answers: [{ id: 'q1', selected: [1] }] },
  })
  const unknownKind = validateBridgeFrame({ kind: 'approval/allow', id: 'x' })
  assert(legal?.kind === 'approval/response', 'V-U1: legal allowed-once accepted')
  assert(illegalAllowAll === undefined, 'V-U1: allow-all rejected (no silent allow)')
  assert(illegalRejectedTypo === undefined, 'V-U1: typo outcome rejected')
  assert(legalAnswer?.kind === 'user-questions/response', 'V-U1: legal answer accepted')
  assert(illegalAnswer === undefined, 'V-U1: non-string selected rejected')
  assert(unknownKind === undefined, 'V-U1: unknown kind rejected')
  assert(isApprovalOutcome('cancelled') && !isApprovalOutcome('allow-all'), 'V-U1: outcome vocab closed')
  assert(
    isAskUserQuestionAnswer({ answers: [{ id: 'q', selected: [] }] })
      && !isAskUserQuestionAnswer({ answers: [{ id: 'q', selected: null }] }),
    'V-U1: answer shape gate varies with input',
  )
}

// --- V-U2: AC-10 Tab association ---
{
  const registry = new ConversationRegistry()
  const tabA = registry.create('A')
  const tabB = registry.create('B')
  const seen: Array<{ sessionId: string; tabId?: string }> = []
  const coordinator = new InteractionCoordinator()
  coordinator.setRegistry(registry)
  coordinator.setUi({
    async presentApproval(request) {
      seen.push({ sessionId: request.sessionId, tabId: request.tabId })
      return 'rejected'
    },
    async presentQuestions() {
      return { answers: [] }
    },
  })
  const outA = await coordinator.handleApproval({
    id: 'u2-a',
    sessionId: tabA.sessionId,
    toolName: 'bash',
  })
  const outB = await coordinator.handleApproval({
    id: 'u2-b',
    sessionId: tabB.sessionId,
    toolName: 'write',
  })
  assert(outA === 'rejected' && outB === 'rejected', 'V-U2: both approvals settle')
  assert(seen.length === 2, 'V-U2: UI invoked twice')
  assert(seen[0]!.tabId === tabA.tabId && seen[0]!.sessionId === tabA.sessionId, 'V-U2: first → Tab A')
  assert(seen[1]!.tabId === tabB.tabId && seen[1]!.sessionId === tabB.sessionId, 'V-U2: second → Tab B')
  assert(seen[0]!.tabId !== seen[1]!.tabId, 'V-U2: answers do not cross Tabs')
}

// --- V-U3: STUB anti-stub ---
{
  const coordinator = new InteractionCoordinator()
  const outcomes = ['allowed-once', 'rejected', 'cancelled'] as const
  const got: string[] = []
  for (const outcome of outcomes) {
    coordinator.setUi({
      async presentApproval() {
        return outcome
      },
      async presentQuestions() {
        return { answers: [{ id: 'q', selected: [outcome] }] }
      },
    })
    got.push(await coordinator.handleApproval({
      id: `stub-${outcome}`,
      sessionId: 's',
      toolName: 't',
    }))
  }
  assert(got[0] === 'allowed-once' && got[1] === 'rejected' && got[2] === 'cancelled',
    'V-U3: STUB-001 filled — Host outcome varies with UI (not constant unavailable)')
  coordinator.setUi({
    async presentApproval() {
      return 'allowed-once'
    },
    async presentQuestions() {
      return { answers: [{ id: 'q1', selected: ['alpha'] }] }
    },
  })
  const answer = await coordinator.handleQuestions({
    id: 'stub-q',
    sessionId: 's',
    questions: [{ id: 'q1', question: 'ok?' }],
  })
  assert(answer.answers[0]?.selected[0] === 'alpha',
    'V-U3: STUB-002 filled — questions answer varies with UI')
}

// --- V-U4: InteractionUi legal outcome mapping ---
{
  const picks: InteractionQuickPickItem[] = []
  const window: InteractionWindow = {
    async showQuickPick(items) {
      picks.push(...(items as InteractionQuickPickItem[]))
      return items[0] as InteractionQuickPickItem
    },
    async showErrorMessage() {
      return undefined
    },
  }
  const ui = createVscodeInteractionUi(window)
  const outcome = await ui.presentApproval({
    id: '1',
    sessionId: 'sess-long-enough',
    toolName: 'bash',
    tabId: 'tab-long-enough',
  })
  assert(outcome === 'allowed-once', 'V-U4: first QuickPick maps to allowed-once')
  assert(picks.every(item => isApprovalOutcome(item.value)), 'V-U4: all choices are legal outcomes')
  assert(picks.some(item => item.value === 'rejected'), 'V-U4: reject choice present')
}

// --- V-U5: GAP-008 CLOSED — empty options → InputBox custom ---
{
  let quickPickCalls = 0
  let inputPrompt: string | undefined
  const window: InteractionWindow = {
    async showQuickPick() {
      quickPickCalls += 1
      return undefined
    },
    async showInputBox(options) {
      inputPrompt = options.prompt
      return 'free-text-from-verifier'
    },
    async showErrorMessage() {
      return undefined
    },
  }
  const ui = createVscodeInteractionUi(window)
  const answer = await ui.presentQuestions({
    id: 'qf',
    sessionId: 'sess',
    questions: [{ id: 'q1', question: 'type something', options: [] }],
  })
  assert(quickPickCalls === 0, 'V-U5 GAP-008 CLOSED: empty options never opens QuickPick')
  assert(inputPrompt === 'type something', 'V-U5 GAP-008 CLOSED: showInputBox used with question prompt')
  assert(
    answer.answers[0]?.custom === 'free-text-from-verifier'
      && answer.answers[0]?.selected.length === 0,
    'V-U5 GAP-008 CLOSED: custom free-text written; selected empty',
  )

  // Cancel path: blank / undefined → no custom
  const cancelWindow: InteractionWindow = {
    async showQuickPick() {
      throw new Error('QuickPick must not run for empty options')
    },
    async showInputBox() {
      return undefined
    },
    async showErrorMessage() {
      return undefined
    },
  }
  const cancelAnswer = await createVscodeInteractionUi(cancelWindow).presentQuestions({
    id: 'qf2',
    sessionId: 'sess',
    questions: [{ id: 'q2', question: 'cancel me', options: [] }],
  })
  assert(
    cancelAnswer.answers[0]?.selected.length === 0
      && cancelAnswer.answers[0]?.custom === undefined,
    'V-U5 GAP-008 CLOSED: InputBox cancel → selected:[] without custom',
  )
}

// --- V-U6: GAP-006 CLOSED — AbortSignal → createQuickPick.hide() ---
{
  let hideCount = 0
  let hideListener: (() => void) | undefined
  const window: InteractionWindow = {
    async showQuickPick() {
      throw new Error('showQuickPick must not be used when createQuickPick exists')
    },
    createQuickPick(): InteractionQuickPick {
      return {
        items: [],
        selectedItems: [],
        show() {},
        hide() {
          hideCount += 1
          hideListener?.()
        },
        dispose() {},
        onDidAccept() {
          return { dispose() {} }
        },
        onDidHide(listener) {
          hideListener = listener
          return { dispose() {} }
        },
      }
    },
    async showErrorMessage() {
      return undefined
    },
  }
  const ui = createVscodeInteractionUi(window)
  const abort = new AbortController()
  const pending = ui.presentApproval({
    id: 'a1',
    sessionId: 'sess',
    toolName: 'bash',
  }, abort.signal)
  await new Promise(resolve => setTimeout(resolve, 5))
  abort.abort()
  const outcome = await pending
  assert(hideCount >= 1, 'V-U6 GAP-006 CLOSED: createQuickPick.hide() called on abort')
  assert(outcome === 'cancelled', 'V-U6 GAP-006 CLOSED: abort settles UI as cancelled')

  // Coordinator path: failClosedAll aborts signal seen by UI
  const signals: AbortSignal[] = []
  const coordinator = new InteractionCoordinator()
  coordinator.setUi({
    async presentApproval(_request, signal) {
      if (signal !== undefined) signals.push(signal)
      await new Promise(() => {})
      return 'allowed-once'
    },
    async presentQuestions() {
      return { answers: [] }
    },
  })
  const hostPending = coordinator.handleApproval({
    id: 'abort-ui',
    sessionId: 's',
    toolName: 'bash',
  })
  await waitFor(() => coordinator.listPending().some(item => item.id === 'abort-ui'), 1_000)
  coordinator.failClosedAll('probe-death')
  assert(await hostPending === 'unavailable', 'V-U6: failClosedAll settles Host wait as unavailable')
  assert(signals.length === 1 && signals[0]!.aborted === true,
    'V-U6 GAP-006 CLOSED: UI AbortSignal aborted (UI can cancel QuickPick)')
}

// --- V-U7: GAP-009 CLOSED — closeConversation failClosedSession before dispose ---
{
  const order: string[] = []
  const coordinator = new InteractionCoordinator()
  const host = {
    interactions: coordinator,
    async disposeSession(sessionId: string): Promise<void> {
      order.push(`dispose:${sessionId}`)
    },
  } as Pick<IdeSessionHost, 'disposeSession' | 'interactions'> as IdeSessionHost
  const controller = new ConversationController(host)
  const tab = controller.newConversation('close-probe')
  coordinator.setRegistry(controller.registry)
  coordinator.setUi({
    async presentApproval() {
      await new Promise(() => {})
      return 'allowed-once'
    },
    async presentQuestions() {
      return { answers: [] }
    },
  })
  const pending = coordinator.handleApproval({
    id: 'close-pend',
    sessionId: tab.sessionId,
    toolName: 'bash',
  })
  await waitFor(() => coordinator.listPending().length === 1, 1_000)
  await controller.closeConversation(tab.tabId)
  assert(order[0] === `dispose:${tab.sessionId}`, 'V-U7: dispose still runs after failClosed')
  assert(await pending === 'unavailable', 'V-U7 GAP-009 CLOSED: Tab close aborts Host pending as unavailable')
  assert(coordinator.listPending().length === 0, 'V-U7 GAP-009 CLOSED: no leftover pending after close')
  assert(
    (coordinator.getLastError() ?? '').includes('conversation Tab closed'),
    'V-U7 GAP-009 CLOSED: lastError records Tab-close reason',
  )
}

// --- V-U8: GAP-005 CLOSED — extension wires onError → showErrorMessage ---
{
  const extensionSrc = readFileSync(join(repoRoot, 'apps/vscode-dsh/src/extension.ts'), 'utf8')
  const sessionHostSrc = readFileSync(join(repoRoot, 'apps/vscode-dsh/src/session-host.ts'), 'utf8')
  assert(/onError\s*\(/.test(extensionSrc), 'V-U8 GAP-005 CLOSED: extension subscribes onError')
  assert(
    /showErrorMessage\([^)]*session error/i.test(extensionSrc)
      || /DeepSeek Harness session error/.test(extensionSrc),
    'V-U8 GAP-005 CLOSED: showErrorMessage wired with session error prefix',
  )
  assert(/notifyError\(/.test(sessionHostSrc) && /onTransportDeath/.test(sessionHostSrc),
    'V-U8: Host notifyError called from onTransportDeath')
  assert(/this\.notifyError\(this\.errorMessage\)/.test(sessionHostSrc),
    'V-U8: onTransportDeath notifies redacted errorMessage')
}

// --- V-U9: INDEPENDENT — failClosedSession isolates by sessionId ---
{
  const coordinator = new InteractionCoordinator()
  const signals: Array<{ sessionId: string; signal: AbortSignal }> = []
  coordinator.setUi({
    async presentApproval(request, signal) {
      if (signal !== undefined) signals.push({ sessionId: request.sessionId, signal })
      await new Promise(() => {})
      return 'allowed-once'
    },
    async presentQuestions() {
      return { answers: [] }
    },
  })
  const dropPending = coordinator.handleApproval({
    id: 'drop',
    sessionId: 'sess-drop',
    toolName: 'bash',
  })
  const keepPending = coordinator.handleApproval({
    id: 'keep',
    sessionId: 'sess-keep',
    toolName: 'bash',
  })
  await waitFor(() => coordinator.listPending().length === 2 && signals.length === 2, 1_000)
  coordinator.failClosedSession('sess-drop', 'only-drop')
  assert(await dropPending === 'unavailable', 'V-U9: drop session settles unavailable')
  assert(
    coordinator.listPending().some(item => item.sessionId === 'sess-keep')
      && !coordinator.listPending().some(item => item.sessionId === 'sess-drop'),
    'V-U9: keep session still pending; drop cleared',
  )
  const dropSignal = signals.find(s => s.sessionId === 'sess-drop')
  const keepSignal = signals.find(s => s.sessionId === 'sess-keep')
  assert(dropSignal !== undefined && keepSignal !== undefined, 'V-U9: both UI signals captured')
  assert(
    dropSignal.signal.aborted === true && keepSignal.signal.aborted === false,
    'V-U9 INDEPENDENT: only drop session AbortSignal aborted',
  )
  coordinator.failClosedAll('cleanup')
  assert(await keepPending === 'unavailable', 'V-U9: cleanup settles keep')
  assert(keepSignal.signal.aborted === true, 'V-U9: cleanup aborts keep signal')
}

console.log('\nverifier-independent-unit: ALL PASS')

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
      setTimeout(poll, 10)
    }
    poll()
  })
}
