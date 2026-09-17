/**
 * L2: recoverable close ≠ dispose; delete → dispose; empty Tab / immediate index (VP-1-*).
 */

import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { ConversationController } from '../src/conversation-controller.ts'
import { IdeSessionHost } from '../src/session-host.ts'
import { SnapshotStore } from '../src/change/snapshot-store.ts'
import type { WorkspaceStateLike } from '../src/extension-index.ts'

const fakeSdkRuntime = fileURLToPath(new URL('./fixtures/fake-sdk-runtime.mjs', import.meta.url))

describe('recoverable close vs delete (AC-23/26 / VP-1-close / VP-1-delete)', () => {
  const dirs: string[] = []

  afterEach(async () => {
    while (dirs.length > 0) {
      await rm(dirs.pop()!, { recursive: true, force: true })
    }
  })

  it('close with content does not dispose; delete disposes (VP-1-close / VP-1-delete)', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'dsh-ide-close-'))
    dirs.push(dir)
    const writes: unknown[] = []
    const state: WorkspaceStateLike = {
      get() { return undefined },
      update(_key, value) { writes.push(value) },
    }
    const host = new IdeSessionHost()
    await host.start({
      cwd: dir,
      dshHome: join(dir, '.dsh'),
      bridgeSockPath: join(dir, 'bridge.sock'),
      dshBin: fakeSdkRuntime,
      initializeTimeoutMs: 5_000,
      disposeTimeoutMs: 5_000,
      credentials: {
        DEEPSEEK_API_KEY: 'keyless-close-no-call',
        DSH_TELEMETRY_DISABLED: '1',
        FAKE_EMIT_TURN_EVENTS: '1',
      },
    })
    await waitFor(() => host.bridgeConnected(), 3_000)

    const disposed: string[] = []
    const originalDispose = host.disposeSession.bind(host)
    host.disposeSession = async (sessionId: string) => {
      disposed.push(sessionId)
      return originalDispose(sessionId)
    }

    const controller = new ConversationController(host, state, dir)
    const keep = controller.newConversation('keep')
    const drop = controller.newConversation('drop')
    controller.switchConversation(drop.tabId)
    await controller.promptActive('about to close')
    await waitFor(() => controller.messages.get(drop.sessionId).some(m => m.role === 'assistant'), 3_000)

    const beforeWrites = writes.length
    const closed = await controller.closeConversation(drop.tabId)
    expect(closed.outcome).toBe('closed')
    expect(disposed).toEqual([])
    expect(controller.registry.get(drop.tabId)).toBeUndefined()
    expect(controller.registry.getActive()?.tabId).toBe(keep.tabId)
    // Content Tab was in openTabSet while open; after close it is removed; authority messages remain.
    expect(controller.messages.hasContent(drop.sessionId)).toBe(true)
    expect(writes.length).toBeGreaterThan(beforeWrites)
    const indexAfterClose = controller.index.read()
    expect(indexAfterClose.openTabSet.some(t => t.sessionId === drop.sessionId)).toBe(false)

    // Remaining Tab still prompts.
    controller.switchConversation(keep.tabId)
    const result = await controller.promptActive('still alive')
    expect(result.sessionId).toBe(keep.sessionId)

    // Delete the keep Tab → dispose.
    const needs = await controller.deleteConversation(keep.tabId)
    expect(needs.outcome).toBe('needs-confirm')
    const deleted = await controller.deleteConversation(keep.tabId, { confirmed: true })
    expect(deleted.outcome).toBe('deleted')
    expect(disposed).toContain(keep.sessionId)
    expect(controller.index.isDeleted(keep.sessionId)).toBe(true)
    expect(controller.messages.hasContent(keep.sessionId)).toBe(false)

    await host.shutdown()
  })

  it('delete during a settling turn leaves no projections for the deleted session (AC-36b)', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'dsh-ide-delete-race-'))
    dirs.push(dir)
    const disposed: string[] = []
    const host = {
      status: 'connected',
      interactions: { failClosedSession() {}, listPending() { return [] } },
      setConversationRegistry() {},
      onNotification() { return () => {} },
      async disposeSession(sessionId: string) { disposed.push(sessionId) },
      async prompt() { return 'mid' },
    } as unknown as IdeSessionHost
    // Fast clear keeps the delete's awaits microtask-only while the settle below still has a
    // change-index write in flight, so the interleaving under test is deterministic rather
    // than dependent on relative I/O timing.
    const snapshotStore = new SnapshotStore({ storageRoot: join(dir, 'changes') })
    snapshotStore.clearSession = async () => {}
    const controller = new ConversationController(host, undefined, dir, { snapshotStore })
    const tab = controller.newConversation('race')
    await controller.promptTab(tab.tabId, 'hi')

    // Turn settling (detached `enqueueSettle`) while the user deletes the conversation.
    controller.injectAssistantMessage(tab.sessionId, 'reply')
    const deleted = await controller.deleteConversation(tab.tabId, { confirmed: true })
    expect(deleted.outcome).toBe('deleted')
    expect(disposed).toContain(tab.sessionId)

    await controller.flushChangeSettles(tab.sessionId)
    expect(controller.index.isDeleted(tab.sessionId)).toBe(true)
    expect(controller.messages.hasContent(tab.sessionId)).toBe(false)
  })

  it('empty Tab close skips openTabSet and dispose (VP-1-empty)', async () => {
    const writes: Array<{ openTabSet: unknown[] }> = []
    const state: WorkspaceStateLike = {
      get() { return undefined },
      update(_key, value) {
        writes.push(value as { openTabSet: unknown[] })
      },
    }
    const host = {
      status: 'connected',
      interactions: { failClosedSession() {}, listPending() { return [] } },
      setConversationRegistry() {},
      onNotification() { return () => {} },
      async disposeSession() {
        throw new Error('dispose must not run for empty close')
      },
      async prompt() { return 'mid' },
    } as unknown as IdeSessionHost

    const controller = new ConversationController(host, state, '/ws')
    const empty = controller.newConversation('empty')
    expect(controller.messages.hasContent(empty.sessionId)).toBe(false)
    // Creating empty Tab may persist activeSessionId but openTabSet must stay empty.
    expect(controller.index.read().openTabSet).toEqual([])

    const closed = await controller.closeConversation(empty.tabId)
    expect(closed.outcome).toBe('closed')
    if (closed.outcome === 'closed') expect(closed.empty).toBe(true)
    expect(controller.registry.get(empty.tabId)).toBeUndefined()
    for (const snap of writes) {
      expect(snap.openTabSet.some((t: { sessionId?: string }) => t.sessionId === empty.sessionId)).toBe(false)
    }
  })

  it('running close requires confirm; cancel leaves Tab; confirmStopClose unloads without dispose', async () => {
    const disposed: string[] = []
    const host = {
      status: 'connected',
      interactions: { failClosedSession() {}, listPending() { return [] } },
      setConversationRegistry() {},
      onNotification() { return () => {} },
      async disposeSession(sessionId: string) { disposed.push(sessionId) },
      async prompt() { return 'mid' },
    } as unknown as IdeSessionHost
    const controller = new ConversationController(host)
    const tab = controller.newConversation('run')
    controller.registry.setStatus(tab.tabId, 'running')

    const needs = await controller.closeConversation(tab.tabId)
    expect(needs.outcome).toBe('needs-confirm-running')
    expect(controller.registry.get(tab.tabId)).toBeDefined()
    expect(disposed).toEqual([])

    const closed = await controller.closeConversation(tab.tabId, { confirmStopClose: true })
    expect(closed.outcome).toBe('closed')
    expect(controller.registry.get(tab.tabId)).toBeUndefined()
    expect(disposed).toEqual([])
  })

  it('delete without confirm does not dispose; host-not-ready blocks delete (AC-72/73)', async () => {
    const disposed: string[] = []
    const host = {
      status: 'connected',
      interactions: { failClosedSession() {}, listPending() { return [] } },
      setConversationRegistry() {},
      onNotification() { return () => {} },
      async disposeSession(sessionId: string) { disposed.push(sessionId) },
    } as unknown as IdeSessionHost
    const controller = new ConversationController(host)
    const tab = controller.newConversation('del')
    controller.registry.setStatus(tab.tabId, 'running')

    const needs = await controller.deleteConversation(tab.tabId)
    expect(needs.outcome).toBe('needs-confirm')
    expect(disposed).toEqual([])
    expect(controller.registry.get(tab.tabId)).toBeDefined()

    ;(host as { status: string }).status = 'disconnected'
    const blocked = await controller.deleteConversation(tab.tabId, { confirmed: true })
    expect(blocked.outcome).toBe('host-not-ready')
    expect(disposed).toEqual([])
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
