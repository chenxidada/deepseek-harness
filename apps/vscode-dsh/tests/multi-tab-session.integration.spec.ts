/**
 * Integration: ≥2 Tabs route prompts to distinct sessionIds without cross-talk (AC-7/9/33).
 * Uses the real IdeSessionHost + fake SDK runtime (no agent-loop in the Extension process).
 */

import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { ConversationController } from '../src/conversation-controller.ts'
import { IdeSessionHost } from '../src/session-host.ts'

const fakeSdkRuntime = fileURLToPath(new URL('./fixtures/fake-sdk-runtime.mjs', import.meta.url))

describe('ConversationController multi-Tab prompt routing (AC-7/9)', () => {
  const dirs: string[] = []

  afterEach(async () => {
    while (dirs.length > 0) {
      await rm(dirs.pop()!, { recursive: true, force: true })
    }
  })

  it('switches Tabs and prompts the active sessionId only', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'dsh-ide-tabs-'))
    dirs.push(dir)
    const promptLog = join(dir, 'prompts.ndjson')
    const host = new IdeSessionHost()
    await host.start({
      cwd: dir,
      dshHome: join(dir, '.dsh'),
      bridgeSockPath: join(dir, 'bridge.sock'),
      dshBin: fakeSdkRuntime,
      initializeTimeoutMs: 5_000,
      disposeTimeoutMs: 5_000,
      credentials: {
        DEEPSEEK_API_KEY: 'keyless-tabs-no-call',
        DSH_TELEMETRY_DISABLED: '1',
        FAKE_PROMPT_LOG: promptLog,
      },
    })
    expect(host.status).toBe('connected')

    // Wait briefly for fake runtime bridge hello (dispose path needs it later).
    await viWaitFor(() => host.bridgeConnected(), 3_000)

    const controller = new ConversationController(host)
    const tabA = controller.newConversation()
    const tabB = controller.newConversation()
    expect(tabA.sessionId).not.toBe(tabB.sessionId)
    expect(controller.snapshot().tabs).toHaveLength(2)

    controller.switchConversation(tabA.tabId)
    const first = await controller.promptActive('message-for-A')
    expect(first.sessionId).toBe(tabA.sessionId)

    controller.switchConversation(tabB.tabId)
    const second = await controller.promptActive('message-for-B')
    expect(second.sessionId).toBe(tabB.sessionId)
    expect(second.sessionId).not.toBe(first.sessionId)

    const lines = (await readFile(promptLog, 'utf8')).trim().split('\n').map(line => JSON.parse(line))
    expect(lines).toHaveLength(2)
    expect(lines[0].sessionId).toBe(tabA.sessionId)
    expect(lines[1].sessionId).toBe(tabB.sessionId)
    expect(lines[0].contentBlocks[0].text).toBe('message-for-A')
    expect(lines[1].contentBlocks[0].text).toBe('message-for-B')

    // Titles from first messages (AC-11).
    expect(controller.registry.get(tabA.tabId)?.title).toBe('message-for-A')
    expect(controller.registry.get(tabB.tabId)?.title).toBe('message-for-B')

    await host.shutdown()
  })
})

async function viWaitFor(predicate: () => boolean, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (!predicate()) {
    if (Date.now() >= deadline) throw new Error('timed out waiting for bridge hello')
    await new Promise(resolve => setTimeout(resolve, 20))
  }
}
