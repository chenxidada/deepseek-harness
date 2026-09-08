/**
 * Integration: prompt → messageId + session.event timeline + post-hoc Diff entry (AC-12/13/23/24/33).
 * Real IdeSessionHost + ConversationController + fake SDK runtime event stream (keyless).
 */

import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { ConversationController } from '../src/conversation-controller.ts'
import { IdeSessionHost } from '../src/session-host.ts'
import { buildDiffOpenArgs, DEFAULT_POST_HOC_DIFF_ONLY } from '../src/diff-entry.ts'

const fakeSdkRuntime = fileURLToPath(new URL('./fixtures/fake-sdk-runtime.mjs', import.meta.url))

describe('timeline + post-hoc Diff integration (AC-12/13/23/24)', () => {
  const dirs: string[] = []

  afterEach(async () => {
    while (dirs.length > 0) {
      await rm(dirs.pop()!, { recursive: true, force: true })
    }
  })

  it('prompt returns messageId and projects turn/tool/assistant for the active session only', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'dsh-ide-timeline-'))
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
        DEEPSEEK_API_KEY: 'keyless-timeline-no-call',
        DSH_TELEMETRY_DISABLED: '1',
        FAKE_EMIT_TURN_EVENTS: '1',
        FAKE_EMIT_WRITE_DIFF: '1',
        FAKE_SUBAGENT: '1',
      },
    })
    expect(host.status).toBe('connected')
    await waitFor(() => host.bridgeConnected(), 3_000)

    const controller = new ConversationController(host)
    const tabA = controller.newConversation('A')
    const tabB = controller.newConversation('B')
    controller.switchConversation(tabA.tabId)

    const receipt = await controller.promptActive('write a note')
    expect(receipt.messageId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    )
    expect(receipt.sessionId).toBe(tabA.sessionId)

    await waitFor(() => {
      const items = controller.timeline.itemsForSessionTree(tabA.sessionId)
      return items.some(item => item.kind === 'assistant')
        && items.some(item => item.kind === 'tool')
        && items.some(item => item.kind === 'turn')
        && items.some(item => item.kind === 'subagent')
    }, 5_000)

    const itemsA = controller.timeline.itemsForSessionTree(tabA.sessionId)
    expect(itemsA.some(item => item.kind === 'assistant')).toBe(true)
    expect(itemsA.some(item => item.kind === 'tool')).toBe(true)
    expect(itemsA.some(item => item.kind === 'subagent')).toBe(true)

    const diffs = controller.timeline.writeDiffsForSessionTree(tabA.sessionId)
    expect(diffs.length).toBeGreaterThanOrEqual(1)
    expect(diffs[0]?.path).toContain('fake-write.txt')
    expect(DEFAULT_POST_HOC_DIFF_ONLY).toBe(true)
    const openArgs = buildDiffOpenArgs(diffs[0]!)
    expect(openArgs.command).toBe('vscode.diff')
    expect(openArgs.leftScheme).toBe('dsh-diff')
    expect(openArgs.path).toContain('fake-write.txt')
    expect(openArgs.rightScheme).toBe('dsh-diff')
    expect(openArgs.leftScheme).toBe('dsh-diff')

    // Tab B timeline stays empty (no cross-talk).
    expect(controller.timeline.itemsForSessionTree(tabB.sessionId)).toHaveLength(0)

    controller.switchConversation(tabB.tabId)
    const receiptB = await controller.promptActive('other tab')
    expect(receiptB.sessionId).toBe(tabB.sessionId)
    await waitFor(() => controller.timeline.itemsForSessionTree(tabB.sessionId).some(i => i.kind === 'assistant'), 5_000)
    expect(
      controller.timeline.itemsForSessionTree(tabB.sessionId).every(
        item => item.sessionId === tabB.sessionId
          || controller.timeline.isDescendantOf(item.sessionId, tabB.sessionId),
      ),
    ).toBe(true)

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
