/**
 * AD-8 / AC-29 / AC-33: second InteractionUi presenter (not QuickPick) is
 * injectable via IdeSessionHost.setInteractionUi and settles a real Host
 * approval round-trip — without packages/core/agent-loop.
 */

import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { ConversationController } from '../src/conversation-controller.ts'
import type { InteractionUi } from '../src/interaction-coordinator.ts'
import { IdeSessionHost } from '../src/session-host.ts'

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

describe('AD-8 InteractionUi replaceability (AC-27/29/33)', () => {
  const dirs: string[] = []

  afterEach(async () => {
    while (dirs.length > 0) {
      await rm(dirs.pop()!, { recursive: true, force: true })
    }
  })

  it('injects a second presenter and settles approval as rejected over Host bridge', async () => {
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
    const lines = (await readFile(approvalLog, 'utf8')).trim().split('\n').map(line => JSON.parse(line))
    expect(lines.some(line => line.outcome === 'rejected')).toBe(true)

    await host.shutdown()
  })

  it('vscode-dsh package.json does not depend on agent-loop (AC-27/28)', async () => {
    const pkg = JSON.parse(
      await readFile(new URL('../package.json', import.meta.url), 'utf8'),
    ) as { dependencies: Record<string, string> }
    const deps = Object.keys(pkg.dependencies ?? {})
    expect(deps).toContain('@deepseek-ai/dsh-ide-bridge')
    expect(deps.some(name => name.includes('agent-loop'))).toBe(false)
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
