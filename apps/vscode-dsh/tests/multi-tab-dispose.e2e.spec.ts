/**
 * E2E: close Tab unloads UI without dispose; remaining Tab still prompts (AD-CU-3).
 * Real IdeSessionHost + fake SDK runtime.
 */

import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { ConversationController } from '../src/conversation-controller.ts'
import { IdeSessionHost } from '../src/session-host.ts'

const fakeSdkRuntime = fileURLToPath(new URL('./fixtures/fake-sdk-runtime.mjs', import.meta.url))

describe('close Tab recoverable e2e (AD-CU-3)', () => {
  const dirs: string[] = []

  afterEach(async () => {
    while (dirs.length > 0) {
      await rm(dirs.pop()!, { recursive: true, force: true })
    }
  })

  it('closes without dispose and keeps the other Tab promptable', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'dsh-ide-dispose-'))
    dirs.push(dir)
    const host = new IdeSessionHost()
    await host.start({
      cwd: dir,
      dshHome: join(dir, '.dsh'),
      bridgeSockPath: join(dir, 'bridge.sock'),
      dshBin: fakeSdkRuntime,
      initializeTimeoutMs: 5_000,
      disposeTimeoutMs: 5_000,
      credentials: {
        DEEPSEEK_API_KEY: 'keyless-dispose-no-call',
        DSH_TELEMETRY_DISABLED: '1',
      },
    })
    await waitFor(() => host.bridgeConnected(), 3_000)

    const disposed: string[] = []
    const originalDispose = host.disposeSession.bind(host)
    host.disposeSession = async (sessionId: string) => {
      disposed.push(sessionId)
      return originalDispose(sessionId)
    }

    const controller = new ConversationController(host)
    const keep = controller.newConversation('keep')
    const drop = controller.newConversation('drop')
    controller.switchConversation(drop.tabId)
    await controller.promptActive('about to close')

    await controller.closeConversation(drop.tabId)
    expect(controller.snapshot().tabs).toHaveLength(1)
    expect(controller.registry.getActive()?.tabId).toBe(keep.tabId)
    expect(controller.registry.getBySessionId(drop.sessionId)).toBeUndefined()
    expect(disposed).toEqual([])

    controller.switchConversation(keep.tabId)
    const result = await controller.promptActive('still alive')
    expect(result.sessionId).toBe(keep.sessionId)

    await host.shutdown()
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
