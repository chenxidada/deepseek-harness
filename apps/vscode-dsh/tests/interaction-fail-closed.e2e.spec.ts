/**
 * E2E: permission preset RPC + child-exit fail-closed (AC-21/22/30/33).
 */

import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { ConversationController } from '../src/conversation-controller.ts'
import { IdeSessionHost } from '../src/session-host.ts'

const fakeSdkRuntime = fileURLToPath(new URL('./fixtures/fake-sdk-runtime.mjs', import.meta.url))

describe('permission preset e2e (AC-21/22)', () => {
  const dirs: string[] = []

  afterEach(async () => {
    while (dirs.length > 0) {
      await rm(dirs.pop()!, { recursive: true, force: true })
    }
  })

  it('lists and selects presets only via Host bridge permission-presets RPC', async () => {
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
    expect(listed.presets).toEqual(['workspace-write', 'danger-full-access'])
    expect(listed.current).toBe('workspace-write')

    const applied = await controller.selectPermissionPreset('danger-full-access')
    expect(applied.preset).toBe('danger-full-access')

    const lines = (await readFile(permissionLog, 'utf8')).trim().split('\n').map(line => JSON.parse(line))
    expect(lines.some(line => line.kind === 'list')).toBe(true)
    expect(lines.some(line => line.kind === 'select' && line.preset === 'danger-full-access')).toBe(true)

    await host.shutdown()
  })
})

describe('child-exit fail-closed e2e (AC-30)', () => {
  const dirs: string[] = []

  afterEach(async () => {
    while (dirs.length > 0) {
      await rm(dirs.pop()!, { recursive: true, force: true })
    }
  })

  it('terminates Host UI wait when the child process exits', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'dsh-ide-exit-e2e-'))
    dirs.push(dir)
    const host = new IdeSessionHost()
    const controller = new ConversationController(host)
    const tab = controller.newConversation('exit')

    let approvalSettled: string | undefined
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
    approvalSettled = host.interactions.getLastError()
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
