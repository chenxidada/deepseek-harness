/**
 * Debt-fix coverage for GAP-005..009 (Phase 3 interaction fail-closed).
 */

import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { activate, deactivate } from '../src/extension.ts'
import { ConversationController } from '../src/conversation-controller.ts'
import { InteractionCoordinator } from '../src/interaction-coordinator.ts'
import {
  createVscodeInteractionUi,
  type InteractionQuickPick,
  type InteractionWindow,
} from '../src/interaction-ui.ts'
import { IdeSessionHost } from '../src/session-host.ts'
import type { IdeSessionHost as IdeSessionHostType } from '../src/session-host.ts'

const fakeSdkRuntime = fileURLToPath(new URL('./fixtures/fake-sdk-runtime.mjs', import.meta.url))

describe('GAP-005: transport death shows errorMessage to user', () => {
  it('notifies onError listeners when onTransportDeath fires', async () => {
    const host = new IdeSessionHost()
    const seen: string[] = []
    host.onError(message => {
      seen.push(message)
    })
    // Force connected so onTransportDeath applies.
    ;(host as unknown as { status: string }).status = 'connected'
    await (host as unknown as {
      onTransportDeath(reason: string): Promise<void>
    }).onTransportDeath('SDK transport closed or child process exited')

    expect(host.status).toBe('error')
    expect(host.errorMessage).toContain('transport closed')
    expect(seen).toEqual([host.errorMessage])
  })

  it('extension startSession wires onError to showErrorMessage (AC-30 UI)', async () => {
    const commands = new Map<string, (...args: unknown[]) => unknown>()
    const vscode = {
      window: {
        async showErrorMessage(_message: string) {},
        async showInformationMessage() {},
        async showQuickPick() {
          return undefined
        },
      },
      workspace: {
        workspaceFolders: [{ uri: { fsPath: '/tmp/gap005-ws' } }],
      },
      commands: {
        registerCommand(command: string, callback: (...args: unknown[]) => unknown) {
          commands.set(command, callback)
          return { dispose() {} }
        },
      },
    }
    activate({ subscriptions: [], extensionPath: '/tmp' }, vscode)

    const extensionSrc = await readFile(
      fileURLToPath(new URL('../src/extension.ts', import.meta.url)),
      'utf8',
    )
    expect(extensionSrc).toMatch(/onError\s*\(/)
    expect(extensionSrc).toMatch(/showErrorMessage\([^)]*session error/)
    expect(extensionSrc).toMatch(/DeepSeek Harness session error/)

    await deactivate()
    expect(commands.has('dsh.startSession')).toBe(true)
  })
})

describe('GAP-006: failClosedAll cancels open QuickPick', () => {
  it('hides createQuickPick when AbortSignal aborts', async () => {
    let hideCount = 0
    let hideListener: (() => void) | undefined
    const window: InteractionWindow = {
      async showQuickPick() {
        throw new Error('showQuickPick must not be used when createQuickPick exists')
      },
      createQuickPick(): InteractionQuickPick {
        const qp: InteractionQuickPick = {
          items: [],
          selectedItems: [],
          show() {},
          hide() {
            hideCount += 1
            hideListener?.()
          },
          dispose() {},
          onDidAccept(listener) {
            void listener
            return { dispose() {} }
          },
          onDidHide(listener) {
            hideListener = listener
            return { dispose() {} }
          },
        }
        return qp
      },
      async showErrorMessage() {},
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
    expect(hideCount).toBeGreaterThanOrEqual(1)
    expect(outcome).toBe('cancelled')
  })

  it('coordinator failClosedAll aborts signal seen by UI', async () => {
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
    const pending = coordinator.handleApproval({
      id: 'abort-ui',
      sessionId: 'sess',
      toolName: 'bash',
    })
    await waitFor(() => coordinator.listPending().some(item => item.id === 'abort-ui'), 1_000)
    coordinator.failClosedAll('child exited')
    expect(await pending).toBe('unavailable')
    expect(signals).toHaveLength(1)
    expect(signals[0]!.aborted).toBe(true)
  })
})

describe('GAP-008: free-text questions use InputBox', () => {
  it('collects custom via showInputBox when options are empty', async () => {
    const prompts: string[] = []
    const window: InteractionWindow = {
      async showQuickPick() {
        throw new Error('QuickPick must not be used for empty-option free text')
      },
      async showInputBox(options) {
        prompts.push(options.prompt ?? '')
        return 'typed-answer'
      },
      async showErrorMessage() {},
    }
    const ui = createVscodeInteractionUi(window)
    const answer = await ui.presentQuestions({
      id: 'qreq',
      sessionId: 'sess',
      questions: [{ id: 'q1', question: 'What is your name?', options: [] }],
    })
    expect(prompts).toEqual(['What is your name?'])
    expect(answer).toEqual({
      answers: [{ id: 'q1', selected: [], custom: 'typed-answer' }],
    })
  })

  it('omits custom when InputBox is cancelled', async () => {
    const window: InteractionWindow = {
      async showQuickPick() {
        return undefined
      },
      async showInputBox() {
        return undefined
      },
      async showErrorMessage() {},
    }
    const ui = createVscodeInteractionUi(window)
    const answer = await ui.presentQuestions({
      id: 'qreq',
      sessionId: 'sess',
      questions: [{ id: 'q1', question: 'Anything?', options: [] }],
    })
    expect(answer).toEqual({ answers: [{ id: 'q1', selected: [] }] })
  })
})

describe('GAP-009: closeConversation fail-closes session Host UI without dispose', () => {
  it('aborts only the closed session pending interactions and does not dispose', async () => {
    const order: string[] = []
    const coordinator = new InteractionCoordinator()
    coordinator.setUi({
      async presentApproval() {
        await new Promise(() => {})
        return 'allowed-once'
      },
      async presentQuestions() {
        return { answers: [] }
      },
    })
    const host = {
      status: 'connected',
      interactions: coordinator,
      setConversationRegistry() {},
      onNotification() {
        return () => {}
      },
      async disposeSession(sessionId: string): Promise<void> {
        order.push(`dispose:${sessionId}`)
      },
    } as unknown as IdeSessionHostType
    const controller = new ConversationController(host)
    const keep = controller.newConversation('keep')
    const drop = controller.newConversation('drop')

    const pendingDrop = coordinator.handleApproval({
      id: 'drop-approval',
      sessionId: drop.sessionId,
      toolName: 'bash',
    })
    const pendingKeep = coordinator.handleApproval({
      id: 'keep-approval',
      sessionId: keep.sessionId,
      toolName: 'bash',
    })
    await waitFor(() => coordinator.listPending().length === 2, 1_000)

    await controller.closeConversation(drop.tabId)

    expect(await pendingDrop).toBe('unavailable')
    expect(coordinator.getLastError()).toContain('conversation Tab closed')
    expect(coordinator.listPending().some(item => item.sessionId === drop.sessionId)).toBe(false)
    expect(coordinator.listPending().some(item => item.sessionId === keep.sessionId)).toBe(true)
    expect(order).toEqual([])
    expect(controller.registry.get(drop.tabId)).toBeUndefined()

    coordinator.failClosedAll('cleanup')
    expect(await pendingKeep).toBe('unavailable')
  })
})

describe('GAP-007: questions Host→UI→response integration (symmetric to approval)', () => {
  const dirs: string[] = []

  afterEach(async () => {
    while (dirs.length > 0) {
      await rm(dirs.pop()!, { recursive: true, force: true })
    }
  })

  it('routes fake-runtime questions to the owning Tab and returns selected answer', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'dsh-ide-questions-'))
    dirs.push(dir)
    const questionsLog = join(dir, 'questions.ndjson')

    const host = new IdeSessionHost()
    const controller = new ConversationController(host)
    const tab = controller.newConversation('questions-target')

    host.setInteractionUi({
      async presentApproval() {
        throw new Error('unexpected approval')
      },
      async presentQuestions(request) {
        expect(request.tabId).toBe(tab.tabId)
        expect(request.sessionId).toBe(tab.sessionId)
        expect(request.questions[0]?.id).toBe('q1')
        return { answers: [{ id: 'q1', selected: ['yes'] }] }
      },
    })

    await host.start({
      cwd: dir,
      dshHome: join(dir, '.dsh'),
      bridgeSockPath: join(dir, 'bridge.sock'),
      dshBin: fakeSdkRuntime,
      initializeTimeoutMs: 5_000,
      credentials: {
        DEEPSEEK_API_KEY: 'keyless-questions-no-call',
        DSH_TELEMETRY_DISABLED: '1',
        FAKE_EMIT_QUESTIONS_SESSION: tab.sessionId,
        FAKE_QUESTIONS_LOG: questionsLog,
      },
    })
    await waitFor(() => host.bridgeConnected(), 3_000)
    await waitFor(async () => {
      try {
        const text = await readFile(questionsLog, 'utf8')
        return text.includes('"selected":["yes"]')
      } catch {
        return false
      }
    }, 5_000)

    const lines = (await readFile(questionsLog, 'utf8')).trim().split('\n').map(line => JSON.parse(line))
    expect(lines.some(line => line.answer?.answers?.[0]?.selected?.[0] === 'yes')).toBe(true)

    await host.shutdown()
  })
})

function waitFor(
  predicate: (() => boolean) | (() => Promise<boolean>),
  timeoutMs: number,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const deadline = Date.now() + timeoutMs
    const poll = (): void => {
      void Promise.resolve(predicate()).then((ok) => {
        if (ok) {
          resolve()
          return
        }
        if (Date.now() >= deadline) {
          reject(new Error('timed out'))
          return
        }
        setTimeout(poll, 20)
      }, reject)
    }
    poll()
  })
}
