/**
 * Integration: approval/questions Tab association + fail-closed Host paths (AC-10/19/30/33).
 */

import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { ConversationController } from '../src/conversation-controller.ts'
import { InteractionCoordinator } from '../src/interaction-coordinator.ts'
import { ConversationRegistry } from '../src/conversation-registry.ts'
import { IdeSessionHost } from '../src/session-host.ts'
import { fileURLToPath } from 'node:url'

const fakeSdkRuntime = fileURLToPath(new URL('./fixtures/fake-sdk-runtime.mjs', import.meta.url))

describe('InteractionCoordinator Tab association (AC-10)', () => {
  it('binds approval to the Tab that owns the sessionId', async () => {
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
  it('returns unavailable when failClosedAll aborts the in-flight approval', async () => {
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

describe('IdeSessionHost interaction integration (AC-16/10/33)', () => {
  const dirs: string[] = []

  afterEach(async () => {
    while (dirs.length > 0) {
      await rm(dirs.pop()!, { recursive: true, force: true })
    }
  })

  it('routes fake-runtime approval to the owning Tab and returns allowed-once', async () => {
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

    const lines = (await readFile(approvalLog, 'utf8')).trim().split('\n').map(line => JSON.parse(line))
    expect(lines.some(line => line.outcome === 'allowed-once')).toBe(true)

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
