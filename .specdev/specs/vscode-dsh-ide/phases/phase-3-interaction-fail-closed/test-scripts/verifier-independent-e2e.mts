/**
 * Verifier-owned independent e2e for Phase 3 GAP-005..009 debt-fix loop.
 *
 * V-E2E-1: questions Host→UI→response with wrong-active-Tab (AC-17 / AC-10) — GAP-007.
 * V-E2E-2: approval Host round-trip via fake runtime (AC-16 / AC-10).
 * V-E2E-3: permission list/select via Host bridge only (AC-21 / AC-22).
 * V-E2E-4: child exit → failClosed + status error + onError notify (AC-30 / GAP-005).
 * V-E2E-5: ide-bridge waterfall approval without next() + illegal outcome discarded.
 * V-E2E-6: INDEPENDENT — transport death aborts open QuickPick via AbortSignal (GAP-006 e2e).
 *
 * Run:
 *   PATH="/usr/local/n/versions/node/24.3.0/bin:$PATH" \
 *   ./node_modules/.bin/tsx \
 *   .specdev/specs/vscode-dsh-ide/phases/phase-3-interaction-fail-closed/test-scripts/verifier-independent-e2e.mts
 */

import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Context } from '@deepseek-ai/cordis'
import {
  apply,
  IDE_BRIDGE_SOCK_ENV,
  IdeBridgeHostServer,
  parseBridgeFrame,
  type BridgeFrame,
} from '@deepseek-ai/dsh-ide-bridge'
import { ConversationController } from '../../../../../../apps/vscode-dsh/src/conversation-controller.ts'
import { IdeSessionHost } from '../../../../../../apps/vscode-dsh/src/session-host.ts'
import {
  createVscodeInteractionUi,
  type InteractionQuickPick,
  type InteractionWindow,
} from '../../../../../../apps/vscode-dsh/src/interaction-ui.ts'

const fakeSdkRuntime = fileURLToPath(
  new URL('../../../../../../apps/vscode-dsh/tests/fixtures/fake-sdk-runtime.mjs', import.meta.url),
)

function assert(cond: unknown, message: string): asserts cond {
  if (!cond) throw new Error(`ASSERT: ${message}`)
  console.log(`PASS  ${message}`)
}

function waitFor(
  predicate: (() => boolean) | (() => Promise<boolean>),
  timeoutMs: number,
  label: string,
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
          reject(new Error(`timed out: ${label}`))
          return
        }
        setTimeout(poll, 20)
      }, reject)
    }
    poll()
  })
}

const dirs: string[] = []
async function tempDir(prefix: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), prefix))
  dirs.push(dir)
  return dir
}

try {
  // --- V-E2E-1: questions Extension Host integration (GAP-007) ---
  {
    const dir = await tempDir('dsh-v-e2e-questions-')
    const questionsLog = join(dir, 'questions.ndjson')
    const host = new IdeSessionHost()
    const controller = new ConversationController(host)
    const tabA = controller.newConversation('A')
    const tabB = controller.newConversation('B')
    controller.switchConversation(tabA.tabId) // active Tab deliberately NOT the target

    const seen: Array<{ tabId?: string; sessionId: string }> = []
    host.setInteractionUi({
      async presentApproval() {
        throw new Error('unexpected approval in questions e2e')
      },
      async presentQuestions(request) {
        seen.push({ tabId: request.tabId, sessionId: request.sessionId })
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
        DEEPSEEK_API_KEY: 'keyless-verifier-questions',
        DSH_TELEMETRY_DISABLED: '1',
        FAKE_EMIT_QUESTIONS_SESSION: tabB.sessionId,
        FAKE_QUESTIONS_LOG: questionsLog,
      },
    })
    await waitFor(() => host.bridgeConnected(), 3_000, 'questions bridge hello')
    await waitFor(async () => {
      try {
        const text = await readFile(questionsLog, 'utf8')
        return text.includes('"selected":["yes"]')
      } catch {
        return false
      }
    }, 5_000, 'questions response logged')

    assert(seen.length === 1, 'V-E2E-1: questions UI presented once')
    assert(seen[0]!.sessionId === tabB.sessionId, 'V-E2E-1: request bound to tabB sessionId')
    assert(seen[0]!.tabId === tabB.tabId, 'V-E2E-1: UI received tabB (not active tabA)')
    assert(seen[0]!.tabId !== tabA.tabId, 'V-E2E-1: answer not attributed to wrong Tab')
    const lines = (await readFile(questionsLog, 'utf8')).trim().split('\n').map(line => JSON.parse(line))
    assert(
      lines.some(line => line.answer?.answers?.[0]?.selected?.[0] === 'yes'),
      'V-E2E-1: Host→runtime user-questions/response carries legal answer',
    )
    await host.shutdown()
  }

  // --- V-E2E-2: approval round-trip with Tab binding ---
  {
    const dir = await tempDir('dsh-v-e2e-approval-')
    const approvalLog = join(dir, 'approval.ndjson')
    const host = new IdeSessionHost()
    const controller = new ConversationController(host)
    const tab = controller.newConversation('appr')
    host.setInteractionUi({
      async presentApproval(request) {
        assert(request.tabId === tab.tabId, 'V-E2E-2 mid: tabId matches')
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
        DEEPSEEK_API_KEY: 'keyless-verifier-approval',
        DSH_TELEMETRY_DISABLED: '1',
        FAKE_EMIT_APPROVAL_SESSION: tab.sessionId,
        FAKE_APPROVAL_LOG: approvalLog,
      },
    })
    await waitFor(() => host.bridgeConnected(), 3_000, 'approval bridge')
    await waitFor(async () => {
      try {
        return (await readFile(approvalLog, 'utf8')).includes('allowed-once')
      } catch {
        return false
      }
    }, 5_000, 'approval logged')
    assert(true, 'V-E2E-2: approval Host round-trip logged allowed-once')
    await host.shutdown()
  }

  // --- V-E2E-3: permission-presets only ---
  {
    const dir = await tempDir('dsh-v-e2e-perm-')
    const permissionLog = join(dir, 'permission.ndjson')
    const host = new IdeSessionHost()
    await host.start({
      cwd: dir,
      dshHome: join(dir, '.dsh'),
      bridgeSockPath: join(dir, 'bridge.sock'),
      dshBin: fakeSdkRuntime,
      initializeTimeoutMs: 5_000,
      credentials: {
        DEEPSEEK_API_KEY: 'keyless-verifier-perm',
        DSH_TELEMETRY_DISABLED: '1',
        FAKE_PERMISSION_LOG: permissionLog,
      },
    })
    await waitFor(() => host.bridgeConnected(), 3_000, 'perm bridge')
    const controller = new ConversationController(host)
    controller.newConversation('perm')
    const listed = await controller.listPermissionPresets()
    assert(listed.presets.includes('workspace-write'), 'V-E2E-3: list via Host RPC')
    const applied = await controller.selectPermissionPreset('danger-full-access')
    assert(applied.preset === 'danger-full-access', 'V-E2E-3: select via Host RPC')
    const log = await readFile(permissionLog, 'utf8')
    assert(log.includes('"kind":"list"') && log.includes('"kind":"select"'),
      'V-E2E-3: runtime saw permission frames (sole authority path)')
    await host.shutdown()
  }

  // --- V-E2E-4: child exit fail-closed + GAP-005 onError ---
  {
    const dir = await tempDir('dsh-v-e2e-exit-')
    const host = new IdeSessionHost()
    const controller = new ConversationController(host)
    const tab = controller.newConversation('exit')
    const errors: string[] = []
    host.onError(message => {
      errors.push(message)
    })
    host.setInteractionUi({
      async presentApproval() {
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
        DEEPSEEK_API_KEY: 'keyless-verifier-exit',
        DSH_TELEMETRY_DISABLED: '1',
        FAKE_EMIT_APPROVAL_SESSION: tab.sessionId,
        FAKE_EXIT_AFTER_MS: '200',
      },
    })
    await waitFor(() => host.bridgeConnected(), 3_000, 'exit bridge')
    await waitFor(
      () => host.interactions.getLastError() !== undefined || host.status === 'error',
      5_000,
      'transport death',
    )
    await waitFor(() => errors.length >= 1, 2_000, 'onError notified')
    assert(host.interactions.listPending().length === 0, 'V-E2E-4: pending cleared after child death')
    assert(host.interactions.getLastError() !== undefined || host.status === 'error',
      'V-E2E-4: error state / lastError recorded (AC-30 core)')
    assert(errors.length >= 1, 'V-E2E-4 GAP-005 CLOSED: onError listener fired on transport death')
    assert(
      errors.some(msg => /transport|exited|closed/i.test(msg)),
      'V-E2E-4 GAP-005 CLOSED: error message describes transport/child death',
    )
    try {
      await host.shutdown()
    } catch {
      // Child already gone.
    }
  }

  // --- V-E2E-5: ide-bridge waterfall + illegal frame discard ---
  {
    const dir = await tempDir('dsh-v-e2e-bridge-')
    const path = join(dir, 'bridge.sock')
    const host = new IdeBridgeHostServer()
    let illegalSeen = false
    host.onFrame((frame, connection) => {
      if (frame.kind !== 'approval/request') return
      connection.send({ kind: 'approval/response', id: frame.id, outcome: 'allow-all' } as BridgeFrame)
      illegalSeen = true
      setTimeout(() => {
        connection.send({ kind: 'approval/response', id: frame.id, outcome: 'rejected' })
      }, 30)
    })
    await host.listen(path)
    const previous = process.env[IDE_BRIDGE_SOCK_ENV]
    process.env[IDE_BRIDGE_SOCK_ENV] = path
    const ctx = new Context()
    apply(ctx, { interactionTimeoutMs: 5_000 })
    await waitFor(() => host.connectionCount() >= 1, 3_000, 'ide-bridge connect')

    let nextCalled = false
    const outcome = await ctx.waterfall(
      'approval/request',
      { agent: { id: 'a', session: { id: 'sess-v' } }, toolName: 'bash' },
      () => {
        nextCalled = true
        return Promise.resolve('allowed-once' as const)
      },
    )
    assert(illegalSeen, 'V-E2E-5: Host attempted illegal allow-all')
    assert(parseBridgeFrame(JSON.stringify({
      kind: 'approval/response',
      id: 'x',
      outcome: 'allow-all',
    })) === undefined, 'V-E2E-5: parseBridgeFrame drops illegal outcome')
    assert(outcome === 'rejected', 'V-E2E-5: legal rejected wins; no silent allow-all')
    assert(nextCalled === false, 'V-E2E-5: terminal answerer never calls next()')
    await ctx.fiber.dispose()
    await host.close()
    if (previous === undefined) delete process.env[IDE_BRIDGE_SOCK_ENV]
    else process.env[IDE_BRIDGE_SOCK_ENV] = previous
  }

  // --- V-E2E-6: INDEPENDENT — child exit hides open QuickPick (GAP-006 e2e) ---
  {
    const dir = await tempDir('dsh-v-e2e-hide-')
    const host = new IdeSessionHost()
    const controller = new ConversationController(host)
    const tab = controller.newConversation('hide')
    let hideCount = 0
    let hideListener: (() => void) | undefined
    const window: InteractionWindow = {
      async showQuickPick() {
        throw new Error('must use createQuickPick')
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
    host.setInteractionUi(createVscodeInteractionUi(window))
    await host.start({
      cwd: dir,
      dshHome: join(dir, '.dsh'),
      bridgeSockPath: join(dir, 'bridge.sock'),
      dshBin: fakeSdkRuntime,
      initializeTimeoutMs: 5_000,
      credentials: {
        DEEPSEEK_API_KEY: 'keyless-verifier-hide',
        DSH_TELEMETRY_DISABLED: '1',
        FAKE_EMIT_APPROVAL_SESSION: tab.sessionId,
        FAKE_EXIT_AFTER_MS: '250',
      },
    })
    await waitFor(() => host.bridgeConnected(), 3_000, 'hide bridge')
    // Wait until approval UI is open (pending) then child exits.
    await waitFor(() => host.interactions.listPending().length >= 1, 3_000, 'approval pending open')
    await waitFor(
      () => host.status === 'error' || host.interactions.getLastError() !== undefined,
      5_000,
      'child exit after QuickPick open',
    )
    await waitFor(() => hideCount >= 1, 2_000, 'QuickPick hide after failClosed')
    assert(hideCount >= 1, 'V-E2E-6 INDEPENDENT GAP-006: QuickPick hide() on transport death')
    assert(host.interactions.listPending().length === 0, 'V-E2E-6: pending cleared after hide path')
    try {
      await host.shutdown()
    } catch {
      // Child already gone.
    }
  }

  console.log('\nverifier-independent-e2e: ALL PASS')
} finally {
  while (dirs.length > 0) {
    await rm(dirs.pop()!, { recursive: true, force: true })
  }
}
