import { ConversationController } from '../src/conversation-controller.ts'
import { ConversationRegistry } from '../src/conversation-registry.ts'
import { InteractionCoordinator, readInteractionExpiry, type InteractionUi } from '../src/interaction-coordinator.ts'
import { type InteractionQuickPick, type InteractionWindow, createVscodeInteractionUi, pickPermissionPreset, pickSpecdevGateDecision } from '../src/interaction-ui.ts'
import { IdeSessionHost } from '../src/session-host.ts'
import { type ApprovalOutcome } from '@deepseek-ai/dsh-ide-bridge'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'

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

describe('cap:interaction — approval resolution and fail-closed interaction UI', () => {
  describe('interaction-approval-resolution.spec.ts', () => {
    describe('InteractionCoordinator.resolveApproval (AD-12)', () => {
      /** A coordinator with a popup that stays open until the test answers it. */
      function coordinatorWithOpenPopup(): {
        coordinator: InteractionCoordinator
        presented: string[]
        signals: AbortSignal[]
      } {
        const coordinator = new InteractionCoordinator()
        const presented: string[] = []
        const signals: AbortSignal[] = []
        const open = new Map<string, (outcome: ApprovalOutcome) => void>()
        coordinator.setUi({
          presentApproval(request, signal) {
            presented.push(request.id)
            if (signal !== undefined) signals.push(signal)
            return new Promise<ApprovalOutcome>((resolve) => {
              open.set(request.id, resolve)
            })
          },
          async presentQuestions() {
            return { answers: [] }
          },
        })
        return { coordinator, presented, signals }
      }

      it('CAP-INTERACTION-001 answers the approval the id names, and leaves the other wait pending', async () => {
        const { coordinator } = coordinatorWithOpenPopup()
        const first = coordinator.handleApproval({ id: 'a', sessionId: 's1', toolName: 'bash' })
        const second = coordinator.handleApproval({ id: 'b', sessionId: 's1', toolName: 'write' })
        // Let the pump present `a`, so `b` is the queued one — answering a queued
        // approval by id has to work, not only a popup that is already on screen.
        await Promise.resolve()

        const resolution = coordinator.resolveApproval('b', 'allowed-once')
        await expect(second).resolves.toBe('allowed-once')
        expect(resolution).toEqual({ ok: true, id: 'b', outcome: 'allowed-once' })
        expect(coordinator.listPending().map(entry => entry.id)).toEqual(['a'])
        expect(coordinator.hasPendingForSession('s1')).toBe(true)

        coordinator.resolveApproval('a', 'rejected')
        await expect(first).resolves.toBe('rejected')
        expect(coordinator.listPending()).toEqual([])
        expect(coordinator.hasPendingForSession('s1')).toBe(false)
      })

      it('CAP-INTERACTION-002 refuses an id it does not hold, and settles nothing', async () => {
        const { coordinator } = coordinatorWithOpenPopup()
        const wait = coordinator.handleApproval({ id: 'a', sessionId: 's1', toolName: 'bash' })
        await Promise.resolve()

        expect(coordinator.resolveApproval('no-such-id', 'allowed-once')).toEqual({
          ok: false,
          reason: 'unknown-id',
        })
        expect(coordinator.listPending().map(entry => entry.id)).toEqual(['a'])
        coordinator.resolveApproval('a', 'cancelled')
        await expect(wait).resolves.toBe('cancelled')
      })

      it('CAP-INTERACTION-003 refuses an outcome outside the vocabulary and leaves the wait answerable', async () => {
        const { coordinator } = coordinatorWithOpenPopup()
        const wait = coordinator.handleApproval({ id: 'a', sessionId: 's1', toolName: 'bash' })
        await Promise.resolve()

        // A driver that passes the wrong string must not consume the wait: the legal
        // vocabulary is the bridge's, and `unavailable` is not an answer the driver
        // gets to invent here.
        expect(coordinator.resolveApproval('a', 'allow-once')).toEqual({
          ok: false,
          reason: 'invalid-outcome',
        })
        expect(coordinator.resolveApproval('a', undefined)).toEqual({
          ok: false,
          reason: 'invalid-outcome',
        })
        expect(coordinator.listPending().map(entry => entry.id)).toEqual(['a'])

        coordinator.resolveApproval('a', 'allowed-once')
        await expect(wait).resolves.toBe('allowed-once')
      })

      it('CAP-INTERACTION-021 reports the queue and the last drain through debugSnapshot', async () => {
        const { coordinator } = coordinatorWithOpenPopup()
        const wait = coordinator.handleApproval({ id: 'a', sessionId: 's1', toolName: 'bash' })
        await Promise.resolve()

        const before = coordinator.debugSnapshot()
        expect(before.queue.map(entry => [entry.id, entry.state, entry.settled]))
          .toEqual([['a', 'presented', false]])
        expect(before.lastFailClosed).toBeUndefined()

        // A drain for another session must leave this wait alone, and must be visible as a
        // zero-match drain — that is the fact a "queue outlived its Tab" diagnosis reads.
        coordinator.failClosedSession('s2', 'other session')
        expect(coordinator.debugSnapshot().lastFailClosed).toEqual({
          instanceId: coordinator.instanceId,
          sessionId: 's2',
          matched: 0,
          queueLength: 1,
        })
        expect(coordinator.listPending().map(entry => entry.id)).toEqual(['a'])

        coordinator.failClosedSession('s1', 'tab closed')
        expect(coordinator.debugSnapshot().lastFailClosed).toEqual({
          instanceId: coordinator.instanceId,
          sessionId: 's1',
          matched: 1,
          queueLength: 1,
        })
        expect(coordinator.debugSnapshot().queue).toEqual([])
        await expect(wait).resolves.toBe('unavailable')
      })

      it('CAP-INTERACTION-004 dismisses an open popup without answering the runtime a second time', async () => {
        const { coordinator, presented, signals } = coordinatorWithOpenPopup()
        const wait = coordinator.handleApproval({ id: 'a', sessionId: 's1', toolName: 'bash' })
        await Promise.resolve()
        expect(presented).toEqual(['a'])
        expect(signals[0]?.aborted).toBe(false)

        coordinator.resolveApproval('a', 'allowed-once')
        // The UI path must see the popup hide (its abort signal) rather than race to
        // its own `unavailable` answer.
        expect(signals[0]?.aborted).toBe(true)
        await expect(wait).resolves.toBe('allowed-once')
        expect(coordinator.listPending()).toEqual([])
      })

      it('CAP-INTERACTION-005 has nothing to answer once the wait failed closed', async () => {
        const { coordinator } = coordinatorWithOpenPopup()
        const wait = coordinator.handleApproval({ id: 'a', sessionId: 's1', toolName: 'bash' })
        await Promise.resolve()

        coordinator.failClosedAll('SDK transport closed')
        await expect(wait).resolves.toBe('unavailable')
        // An aborted wait is not "still answerable a little later" — saying so would
        // let a driver believe it answered an approval the runtime already abandoned.
        expect(coordinator.resolveApproval('a', 'allowed-once')).toEqual({
          ok: false,
          reason: 'unknown-id',
        })
        expect(coordinator.listPending()).toEqual([])
      })

      it('CAP-INTERACTION-006 does not treat a questions wait as an approvable id', async () => {
        const { coordinator } = coordinatorWithOpenPopup()
        const questions = coordinator.handleQuestions({
          id: 'q1',
          sessionId: 's1',
          questions: [{ id: 'q1', question: 'pick one' }],
        })
        await Promise.resolve()
        expect(coordinator.listPending().map(entry => entry.id)).toEqual(['q1'])

        expect(coordinator.resolveApproval('q1', 'allowed-once')).toEqual({
          ok: false,
          reason: 'unknown-id',
        })
        expect(coordinator.listPending().map(entry => entry.id)).toEqual(['q1'])
        coordinator.failClosedSession('s1', 'tab closed')
        await expect(questions).rejects.toThrow('tab closed')
      })
    })
  })

  describe('interaction-fail-closed.e2e.spec.ts', () => {
    const fakeSdkRuntime = fileURLToPath(new URL('./fixtures/fake-sdk-runtime.mjs', import.meta.url))

    describe('permission preset e2e', () => {
      const dirs: string[] = []

      afterEach(async () => {
        while (dirs.length > 0) {
          await rm(dirs.pop()!, { recursive: true, force: true })
        }
      })

      it('CAP-INTERACTION-007 lists and selects presets only via Host bridge permission-presets RPC', async () => {
        const dir = await mkdtemp(join(tmpdir(), 'dsh-ide-perm-e2e-'))
        dirs.push(dir)
        const permissionLog = join(dir, 'permission.ndjson')
        const host = new IdeSessionHost()
        await host.start({
          cwd: dir,
          dshHome: join(dir, '.dsh'),
          bridgeSockPath: join(dir, 'bridge.sock'),
          dshBin: fakeSdkRuntime,
          initializeTimeoutMs: 5_000,
          credentials: {
            DEEPSEEK_API_KEY: 'keyless-perm-no-call',
            DSH_TELEMETRY_DISABLED: '1',
            FAKE_PERMISSION_LOG: permissionLog,
          },
        })
        await waitFor(() => host.bridgeConnected(), 3_000)

        const controller = new ConversationController(host)
        controller.newConversation('perm')
        const listed = await controller.listPermissionPresets()
        // The list carries the preset table's own labels and descriptions, so the
        // QuickPick never renders raw keys in place of product copy.
        expect(listed.options).toEqual([
          { value: 'workspace-write', name: 'Workspace write', description: '写入工作区，越界操作先询问' },
          { value: 'danger-full-access', name: 'Full access', description: '不询问，允许全部操作' },
        ])
        expect(listed.current).toBe('workspace-write')

        const applied = await controller.selectPermissionPreset('danger-full-access')
        expect(applied.preset).toBe('danger-full-access')

        const lines = (await readFile(permissionLog, 'utf8')).trim().split('\n').map(line => JSON.parse(line) as { kind: string; preset?: string })
        expect(lines.some(line => line.kind === 'list')).toBe(true)
        expect(lines.some(line => line.kind === 'select' && line.preset === 'danger-full-access')).toBe(true)

        await host.shutdown()
      })

      it('CAP-INTERACTION-025 reads and switches the session approval policy only through the bridge', async () => {
        const dir = await mkdtemp(join(tmpdir(), 'dsh-ide-policy-e2e-'))
        dirs.push(dir)
        const policyLog = join(dir, 'policy.ndjson')
        const host = new IdeSessionHost()
        await host.start({
          cwd: dir,
          dshHome: join(dir, '.dsh'),
          bridgeSockPath: join(dir, 'bridge.sock'),
          dshBin: fakeSdkRuntime,
          initializeTimeoutMs: 5_000,
          credentials: {
            DEEPSEEK_API_KEY: 'keyless-policy-no-call',
            DSH_TELEMETRY_DISABLED: '1',
            FAKE_APPROVAL_POLICY_LOG: policyLog,
          },
        })
        await waitFor(() => host.bridgeConnected(), 3_000)

        const controller = new ConversationController(host)
        const tab = controller.newConversation('policy')
        // The composed default answers until a switch, and the read states it as chrome.
        expect(await controller.readApprovalPolicy()).toEqual({ sessionId: tab.sessionId, policy: 'ask' })

        expect(await host.setApprovalPolicy(tab.sessionId, 'never')).toBe('never')
        expect(await host.readApprovalPolicy(tab.sessionId)).toBe('never')

        const lines = (await readFile(policyLog, 'utf8')).trim().split('\n')
          .map(line => JSON.parse(line) as { kind: string; sessionId: string; policy?: string })
        expect(lines).toEqual([
          { kind: 'read', sessionId: tab.sessionId },
          { kind: 'set', sessionId: tab.sessionId, policy: 'never' },
          { kind: 'read', sessionId: tab.sessionId },
        ])

        await host.shutdown()
      })
    })

    describe('child-exit fail-closed e2e', () => {
      const dirs: string[] = []

      afterEach(async () => {
        while (dirs.length > 0) {
          await rm(dirs.pop()!, { recursive: true, force: true })
        }
      })

      it('CAP-INTERACTION-008 terminates Host UI wait when the child process exits', async () => {
        const dir = await mkdtemp(join(tmpdir(), 'dsh-ide-exit-e2e-'))
        dirs.push(dir)
        const host = new IdeSessionHost()
        const controller = new ConversationController(host)
        const tab = controller.newConversation('exit')

        host.setInteractionUi({
          async presentApproval() {
            // Hang until Host abort race settles (child exit → failClosedAll).
            await new Promise(() => {})
            return 'allowed-once'
          },
          async presentQuestions() {
            return { answers: [] }
          },
        })

        await host.start({
          cwd: dir,
          dshHome: join(dir, '.dsh'),
          bridgeSockPath: join(dir, 'bridge.sock'),
          dshBin: fakeSdkRuntime,
          initializeTimeoutMs: 5_000,
          credentials: {
            DEEPSEEK_API_KEY: 'keyless-exit-no-call',
            DSH_TELEMETRY_DISABLED: '1',
            FAKE_EMIT_APPROVAL_SESSION: tab.sessionId,
            FAKE_EXIT_AFTER_MS: '200',
          },
        })
        await waitFor(() => host.bridgeConnected(), 3_000)

        await waitFor(() => host.interactions.getLastError() !== undefined || host.status === 'error', 5_000)
        const approvalSettled = host.interactions.getLastError()
        expect(approvalSettled).toBeTruthy()
        expect(host.interactions.listPending()).toHaveLength(0)

        // Shutdown may already be partially done by transport death; tolerate errors.
        try {
          await host.shutdown()
        } catch {
          // Child already exited.
        }
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
  })

  describe('interaction-fail-closed.integration.spec.ts', () => {
    const fakeSdkRuntime = fileURLToPath(new URL('./fixtures/fake-sdk-runtime.mjs', import.meta.url))

    describe('InteractionCoordinator Tab association', () => {
      it('CAP-INTERACTION-009 binds approval to the Tab that owns the sessionId', async () => {
        const registry = new ConversationRegistry()
        const tabA = registry.create('A')
        const tabB = registry.create('B')
        const seen: string[] = []
        const coordinator = new InteractionCoordinator()
        coordinator.setRegistry(registry)
        coordinator.setUi({
          async presentApproval(request) {
            seen.push(request.tabId ?? 'missing')
            expect(request.sessionId).toBe(tabB.sessionId)
            return 'allowed-once'
          },
          async presentQuestions() {
            return { answers: [] }
          },
        })

        const outcome = await coordinator.handleApproval({
          id: '1',
          sessionId: tabB.sessionId,
          toolName: 'bash',
        })
        expect(outcome).toBe('allowed-once')
        expect(seen).toEqual([tabB.tabId])
        expect(seen[0]).not.toBe(tabA.tabId)
      })

    })

    describe('InteractionCoordinator abort-aware fail-closed', () => {
      it('CAP-INTERACTION-010 returns unavailable when failClosedAll aborts the in-flight approval', async () => {
        const coordinator = new InteractionCoordinator()
        coordinator.setUi({
          async presentApproval() {
            // Never resolves; abort race in the coordinator settles the wait.
            await new Promise(() => {})
            return 'allowed-once'
          },
          async presentQuestions() {
            return { answers: [] }
          },
        })

        const pending = coordinator.handleApproval({
          id: 'abort-1',
          sessionId: 'sess',
          toolName: 'bash',
        })
        await waitFor(() => coordinator.listPending().some(item => item.id === 'abort-1'), 1_000)
        coordinator.failClosedAll('child exited')
        expect(await pending).toBe('unavailable')
        expect(coordinator.getLastError()).toBe('child exited')
      })
    })

    describe('IdeSessionHost interaction integration', () => {
      const dirs: string[] = []

      afterEach(async () => {
        while (dirs.length > 0) {
          await rm(dirs.pop()!, { recursive: true, force: true })
        }
      })

      it('CAP-INTERACTION-011 routes fake-runtime approval to the owning Tab and returns allowed-once', async () => {
        const dir = await mkdtemp(join(tmpdir(), 'dsh-ide-interaction-'))
        dirs.push(dir)
        const approvalLog = join(dir, 'approval.ndjson')

        // Pre-create Tab session id so FAKE_EMIT_APPROVAL_SESSION can target it.
        const host = new IdeSessionHost()
        const controller = new ConversationController(host)
        const tab = controller.newConversation('target')

        host.setInteractionUi({
          async presentApproval(request) {
            expect(request.tabId).toBe(tab.tabId)
            expect(request.sessionId).toBe(tab.sessionId)
            return 'allowed-once'
          },
          async presentQuestions() {
            throw new Error('unexpected questions')
          },
        })

        await host.start({
          cwd: dir,
          dshHome: join(dir, '.dsh'),
          bridgeSockPath: join(dir, 'bridge.sock'),
          dshBin: fakeSdkRuntime,
          initializeTimeoutMs: 5_000,
          credentials: {
            DEEPSEEK_API_KEY: 'keyless-interaction-no-call',
            DSH_TELEMETRY_DISABLED: '1',
            FAKE_EMIT_APPROVAL_SESSION: tab.sessionId,
            FAKE_APPROVAL_LOG: approvalLog,
          },
        })
        await waitFor(() => host.bridgeConnected(), 3_000)
        await waitFor(async () => {
          try {
            const text = await readFile(approvalLog, 'utf8')
            return text.includes('"outcome":"allowed-once"')
          } catch {
            return false
          }
        }, 5_000)

        const lines = (await readFile(approvalLog, 'utf8')).trim().split('\n').map(line => JSON.parse(line) as { outcome: string })
        expect(lines.some(line => line.outcome === 'allowed-once')).toBe(true)

        await host.shutdown()
      })
    })

  })

  describe('replaceability-interaction-ui.spec.ts', () => {
    const fakeSdkRuntime = fileURLToPath(new URL('./fixtures/fake-sdk-runtime.mjs', import.meta.url))

    /**
 * Explicit second presenter (AD-8 proof): auto-rejects with a distinct
 * legal outcome so tests can tell it apart from the default QuickPick UI.
 */
    function createRejectOncePresenter(log: string[]): InteractionUi {
      return {
        async presentApproval(request) {
          log.push(`reject-once:${request.sessionId}:${request.toolName}`)
          return 'rejected'
        },
        async presentQuestions(request) {
          log.push(`questions:${request.sessionId}`)
          return { answers: request.questions.map(q => ({ id: q.id, selected: [] })) }
        },
      }
    }

    describe('AD-8 InteractionUi replaceability', () => {
      const dirs: string[] = []

      afterEach(async () => {
        while (dirs.length > 0) {
          await rm(dirs.pop()!, { recursive: true, force: true })
        }
      })

      it('CAP-INTERACTION-012 injects a second presenter and settles approval as rejected over Host bridge', async () => {
        const dir = await mkdtemp(join(tmpdir(), 'dsh-ide-replace-ui-'))
        dirs.push(dir)
        const approvalLog = join(dir, 'approval.ndjson')
        const presenterLog: string[] = []

        const host = new IdeSessionHost()
        const controller = new ConversationController(host)
        const tab = controller.newConversation('replace-ui')

        host.setInteractionUi(createRejectOncePresenter(presenterLog))

        await host.start({
          cwd: dir,
          dshHome: join(dir, '.dsh'),
          bridgeSockPath: join(dir, 'bridge.sock'),
          dshBin: fakeSdkRuntime,
          initializeTimeoutMs: 5_000,
          credentials: {
            DEEPSEEK_API_KEY: 'keyless-replace-ui-no-call',
            DSH_TELEMETRY_DISABLED: '1',
            FAKE_EMIT_APPROVAL_SESSION: tab.sessionId,
            FAKE_APPROVAL_LOG: approvalLog,
          },
        })
        await waitFor(() => host.bridgeConnected(), 3_000)
        await waitFor(async () => {
          try {
            const text = await readFile(approvalLog, 'utf8')
            return text.includes('"outcome":"rejected"')
          } catch {
            return false
          }
        }, 5_000)

        expect(presenterLog.some(line => line.startsWith(`reject-once:${tab.sessionId}:`))).toBe(true)
        const lines = (await readFile(approvalLog, 'utf8')).trim().split('\n').map(line => JSON.parse(line) as { outcome: string })
        expect(lines.some(line => line.outcome === 'rejected')).toBe(true)

        await host.shutdown()
      })

      it('CAP-INTERACTION-013 vscode-dsh package.json does not depend on agent-loop', async () => {
        const pkg = JSON.parse(
          await readFile(new URL('../package.json', import.meta.url), 'utf8'),
        ) as { dependencies?: Record<string, string>; devDependencies?: Record<string, string> }
        const declared = Object.keys({ ...pkg.dependencies, ...pkg.devDependencies })
        // tsdown bundles these into the VSIX, so they are build-time dependencies and the packaged
        // extension ships no runtime dependency for vsce to resolve.
        expect(declared).toContain('@deepseek-ai/dsh-ide-bridge')
        expect(Object.keys(pkg.dependencies ?? {})).toEqual([])
        expect(declared.some(name => name.includes('agent-loop'))).toBe(false)
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
          })
        }
        poll()
      })
    }
  })

  describe('gap-005-009-debt-fix.spec.ts', () => {
    const fakeSdkRuntime = fileURLToPath(new URL('./fixtures/fake-sdk-runtime.mjs', import.meta.url))

    describe('transport death shows errorMessage to user', () => {
      it('CAP-INTERACTION-014 notifies onError listeners when onTransportDeath fires', async () => {
        const host = new IdeSessionHost()
        const seen: string[] = []
        host.onError((message) => {
          seen.push(message)
        })
        // Force connected so onTransportDeath applies. The handler is private, and a
        // real death needs a live runtime, so this reaches it off the prototype the
        // way the transport watcher calls it.
        host.status = 'connected'
        const onTransportDeath = Object.getOwnPropertyDescriptor(IdeSessionHost.prototype, 'onTransportDeath')?.value as
          ((this: IdeSessionHost, error: unknown) => Promise<void>) | undefined
        if (onTransportDeath === undefined) throw new Error('IdeSessionHost#onTransportDeath is missing')
        await onTransportDeath.call(host, 'SDK transport closed or child process exited')

        expect(host.status).toBe('error')
        expect(host.errorMessage).toContain('transport closed')
        expect(seen).toEqual([host.errorMessage])
      })


    })

    describe('failClosedAll cancels open QuickPick', () => {
      it('CAP-INTERACTION-015 hides createQuickPick when AbortSignal aborts', async () => {
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

      it('CAP-INTERACTION-016 coordinator failClosedAll aborts signal seen by UI', async () => {
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

      it('CAP-INTERACTION-029 answers a remembered session without presenting, and presents again once forgotten', async () => {
        const presented: string[] = []
        const coordinator = new InteractionCoordinator()
        coordinator.setUi({
          async presentApproval(request) {
            presented.push(request.id)
            return 'rejected'
          },
          async presentQuestions() {
            return { answers: [] }
          },
        })

        expect(coordinator.hasAutoApproval('sess-remembered')).toBe(false)
        coordinator.rememberAutoApproval('sess-remembered')
        expect(coordinator.hasAutoApproval('sess-remembered')).toBe(true)
        // A remembered session grants without a queue entry, so no card is ever shown.
        expect(await coordinator.handleApproval({
          id: 'auto-1',
          sessionId: 'sess-remembered',
          toolName: 'bash',
        })).toBe('allowed-once')
        expect(presented).toEqual([])
        expect(coordinator.listPending()).toEqual([])

        // Another session is unaffected.
        const other = coordinator.handleApproval({ id: 'other-1', sessionId: 'sess-other', toolName: 'bash' })
        await waitFor(() => presented.includes('other-1'), 1_000)
        expect(await other).toBe('rejected')

        // Forgetting the grant restores presentation for that session.
        coordinator.forgetAutoApproval('sess-remembered')
        expect(coordinator.hasAutoApproval('sess-remembered')).toBe(false)
        const rememberedAgain = coordinator.handleApproval({
          id: 'auto-2',
          sessionId: 'sess-remembered',
          toolName: 'bash',
        })
        await waitFor(() => presented.includes('auto-2'), 1_000)
        expect(await rememberedAgain).toBe('rejected')
      })

      it('CAP-INTERACTION-030 grants the session of one pending approval, and nothing for an unknown id', async () => {
        const coordinator = new InteractionCoordinator()
        let answer: (() => void) | undefined
        coordinator.setUi({
          async presentApproval() {
            // The card stays open until the test answers it, so the entry is still
            // the Host's to decide when the grant is recorded.
            await new Promise<void>((resolve) => {
              answer = resolve
            })
            return 'rejected'
          },
          async presentQuestions() {
            return { answers: [] }
          },
        })

        // An id that never existed grants nothing, so a stale card cannot widen the grant.
        expect(coordinator.grantSessionOfApproval('absent')).toBeUndefined()
        expect(coordinator.hasAutoApproval('sess-granted')).toBe(false)

        const pending = coordinator.handleApproval({
          id: 'grant-1',
          sessionId: 'sess-granted',
          toolName: 'bash',
        })
        await waitFor(() => answer !== undefined, 1_000)
        expect(coordinator.grantSessionOfApproval('grant-1')).toBe('sess-granted')
        expect(coordinator.hasAutoApproval('sess-granted')).toBe(true)
        // The granted session answers itself, and the ask the card already shows is
        // still the user's to answer.
        answer?.()
        expect(await pending).toBe('rejected')
      })
    })

    describe('free-text questions use InputBox', () => {
      it('CAP-INTERACTION-017 collects custom via showInputBox when options are empty', async () => {
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

      it('CAP-INTERACTION-018 omits custom when InputBox is cancelled', async () => {
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

    describe('approval policy chrome', () => {
      /** A window that replays the approve choice whose label matches, recording what it was offered. */
      function windowChoosing(
        label: string,
        offered: string[],
        warnings: string[],
        infos: string[] = [],
      ): InteractionWindow {
        return {
          async showQuickPick(items) {
            offered.push(...items.map(item => item.label))
            return items.find(item => item.label === label)
          },
          async showErrorMessage() {},
          async showWarningMessage(message) {
            warnings.push(message)
          },
          async showInformationMessage(message) {
            infos.push(message)
          },
        }
      }

      it('CAP-INTERACTION-022 the remember choice grants once, stops this session asking again, and only exists with a hook', async () => {
        const offered: string[] = []
        const warnings: string[] = []
        const infos: string[] = []
        const remembered: string[] = []
        const ui = createVscodeInteractionUi(
          windowChoosing('允许并不再询问', offered, warnings, infos),
          { rememberApproval: async (sessionId) => { remembered.push(sessionId) } },
        )

        const outcome = await ui.presentApproval({ id: 'a1', sessionId: 'sess-policy', toolName: 'bash' })
        expect(outcome).toBe('allowed-once')
        expect(remembered).toEqual(['sess-policy'])
        // The same four decisions the panel card lists, in the same order.
        expect(offered).toEqual(['允许一次', '允许并不再询问', '拒绝', '取消'])
        expect(warnings).toEqual([])
        expect(infos).toEqual(['本会话后续审批将自动允许，不再弹出询问。'])

        // Without the Host action the choice is never offered, so a pick cannot silently do nothing.
        const bare: string[] = []
        const bareUi = createVscodeInteractionUi(windowChoosing('允许一次', bare, warnings))
        expect(await bareUi.presentApproval({ id: 'a2', sessionId: 'sess-policy', toolName: 'bash' }))
          .toBe('allowed-once')
        expect(bare).toEqual(['允许一次', '拒绝', '取消'])
      })

      it('CAP-INTERACTION-023 a refused remember action keeps the grant and says so', async () => {
        const warnings: string[] = []
        const ui = createVscodeInteractionUi(
          windowChoosing('允许并不再询问', [], warnings),
          {
            rememberApproval: async () => {
              throw new Error('approval service is not available')
            },
          },
        )

        expect(await ui.presentApproval({ id: 'a1', sessionId: 'sess-policy', toolName: 'bash' }))
          .toBe('allowed-once')
        expect(warnings).toEqual(['本会话的「不再询问」未能生效：approval service is not available'])
      })

      it('CAP-INTERACTION-024 the permission picker states the effective policy it was given', async () => {
        const titles: string[] = []
        const policyWindow: InteractionWindow = {
          async showQuickPick(_items, options) {
            titles.push(options?.title ?? '')
            return undefined
          },
          async showErrorMessage() {},
        }
        const options = [
          { value: 'workspace-write', name: 'Workspace write', description: '写入工作区，越界操作先询问' },
        ]
        await pickPermissionPreset(policyWindow, options, 'custom', 'never')
        await pickPermissionPreset(policyWindow, options, 'workspace-write')
        expect(titles).toEqual([
          'DeepSeek Harness 权限 · 本会话审批：自动拒绝',
          // A picker without a policy read keeps its plain title instead of an empty claim.
          'DeepSeek Harness 权限',
        ])
      })

      it('CAP-INTERACTION-025 the SpecDev gate picker collects a decision and its note', async () => {
        const offered: string[][] = []
        const asked: string[] = []
        const gateWindow: InteractionWindow = {
          async showQuickPick(items) {
            offered.push(items.map(item => item.label))
            return items.find(item => item.value === 'reject')
          },
          async showInputBox() {
            asked.push('note')
            return '  reviews missing  '
          },
          async showErrorMessage() {},
        }
        expect(await pickSpecdevGateDecision(gateWindow, 'hg2')).toEqual({
          decision: 'reject',
          note: 'reviews missing',
        })
        expect(offered).toEqual([['通过 (Pass)', '驳回 (Reject)', '推迟 (Defer)']])

        // Passing needs no note, so the InputBox is not opened again for it.
        const askedBefore = asked.length
        const passWindow: InteractionWindow = {
          async showQuickPick(items) {
            return items.find(item => item.value === 'pass')
          },
          async showInputBox() {
            asked.push('note')
            return undefined
          },
          async showErrorMessage() {},
        }
        expect(await pickSpecdevGateDecision(passWindow, 'hg1')).toEqual({ decision: 'pass' })
        expect(asked.length).toBe(askedBefore)

        // A blank note is not recorded on the decision.
        const blankWindow: InteractionWindow = {
          async showQuickPick(items) {
            return items.find(item => item.value === 'defer')
          },
          async showInputBox() {
            return '   '
          },
          async showErrorMessage() {},
        }
        expect(await pickSpecdevGateDecision(blankWindow, 'hg3')).toEqual({ decision: 'defer' })

        // A rejection without a note decides nothing: the write never happens.
        const warnings: string[] = []
        const rejectBlankWindow: InteractionWindow = {
          async showQuickPick(items) {
            return items.find(item => item.value === 'reject')
          },
          async showInputBox() {
            return '   '
          },
          async showErrorMessage() {},
          async showWarningMessage(message: string) {
            warnings.push(message)
          },
        }
        expect(await pickSpecdevGateDecision(rejectBlankWindow, 'hg2')).toBeUndefined()
        expect(warnings).toEqual(['打回修改必须填写备注，未写入任何决定。'])

        // A cancelled pick decides nothing.
        const cancelWindow: InteractionWindow = {
          async showQuickPick() {
            return undefined
          },
          async showErrorMessage() {},
        }
        expect(await pickSpecdevGateDecision(cancelWindow, 'hg2')).toBeUndefined()
      })
    })

    describe('closeConversation fail-closes session Host UI without dispose', () => {
      it('CAP-INTERACTION-019 aborts only the closed session pending interactions and does not dispose', async () => {
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
        const host = Object.assign(new IdeSessionHost(), {
          status: 'connected',
          interactions: coordinator,
          setConversationRegistry() {},
          onNotification() {
            return () => {}
          },
          async disposeSession(sessionId: string): Promise<void> {
            order.push(`dispose:${sessionId}`)
          },
        })
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

    describe('questions Host→UI→response integration (symmetric to approval)', () => {
      const dirs: string[] = []

      afterEach(async () => {
        while (dirs.length > 0) {
          await rm(dirs.pop()!, { recursive: true, force: true })
        }
      })

      it('CAP-INTERACTION-020 routes fake-runtime questions to the owning Tab and returns selected answer', async () => {
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

        const lines = (await readFile(questionsLog, 'utf8')).trim().split('\n').map(line => JSON.parse(line) as { answer?: { answers?: Array<{ selected?: string[] }> } })
        expect(lines.some(line => line.answer?.answers?.[0]?.selected?.[0] === 'yes')).toBe(true)

        await host.shutdown()
      })
    })

  })

  describe('interaction expiry (runtime gave up on the wait)', () => {
    /**
     * A coordinator whose question popup stays open, recording the expiry code
     * each wait's abort signal carries.
     * @returns the coordinator and the recorded codes.
     */
    function coordinatorWithOpenQuestion(): {
      coordinator: InteractionCoordinator
      expired: Array<string | undefined>
    } {
      const coordinator = new InteractionCoordinator()
      const expired: Array<string | undefined> = []
      coordinator.setUi({
        async presentApproval() {
          return 'unavailable'
        },
        presentQuestions(_request, signal) {
          if (signal !== undefined) {
            signal.addEventListener('abort', () => { expired.push(readInteractionExpiry(signal)) }, { once: true })
          }
          return new Promise(() => {})
        },
      })
      return { coordinator, expired }
    }

    it('CAP-INTERACTION-026 retires an expired wait and hands the presenter the reason', async () => {
      const { coordinator, expired } = coordinatorWithOpenQuestion()
      const wait = coordinator.handleQuestions({
        id: 'q',
        sessionId: 's1',
        questions: [{ id: 'q1', question: 'Continue?' }],
      })
      await Promise.resolve()

      expect(coordinator.expire('q', 'timeout')).toBe(true)
      // The wait settles without an answer, so a click on the retired card cannot
      // reach the wire, and the presenter learns why it was retired.
      await expect(wait).rejects.toThrow('interaction expired: timeout')
      expect(expired).toEqual(['timeout'])
      expect(coordinator.listPending()).toEqual([])
      expect(coordinator.hasPendingForSession('s1')).toBe(false)
    })

    it('CAP-INTERACTION-027 refuses an id it does not hold and never retires one twice', async () => {
      const { coordinator, expired } = coordinatorWithOpenQuestion()
      const wait = coordinator.handleQuestions({
        id: 'q',
        sessionId: 's1',
        questions: [{ id: 'q1', question: 'Continue?' }],
      })
      await Promise.resolve()

      expect(coordinator.expire('no-such-id', 'timeout')).toBe(false)
      expect(coordinator.expire('q', 'timeout')).toBe(true)
      await expect(wait).rejects.toThrow('interaction expired: timeout')
      // The entry is gone, so a second notice for the same id changes nothing.
      expect(coordinator.expire('q', 'timeout')).toBe(false)
      expect(expired).toEqual(['timeout'])
    })

    it('CAP-INTERACTION-028 an answered wait carries no expiry code on its signal', async () => {
      const { coordinator, expired } = coordinatorWithOpenQuestion()
      const wait = coordinator.handleQuestions({
        id: 'q',
        sessionId: 's1',
        questions: [{ id: 'q1', question: 'Continue?' }],
      })
      await Promise.resolve()

      expect(coordinator.resolveQuestions('q', { answers: [{ id: 'q1', selected: ['yes'] }] })).toBe(true)
      await expect(wait).resolves.toEqual({ answers: [{ id: 'q1', selected: ['yes'] }] })
      // An answer closes the card the ordinary way, so the presenter removes it
      // rather than replacing it with the retired form.
      expect(expired).toEqual([undefined])
    })
  })

})
