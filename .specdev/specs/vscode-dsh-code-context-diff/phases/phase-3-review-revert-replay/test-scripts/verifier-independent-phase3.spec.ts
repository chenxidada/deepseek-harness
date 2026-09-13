/**
 * Verifier-owned independent scenarios for phase-3-review-revert-replay.
 * Does NOT rubber-stamp implementer tests — new cases only.
 *
 * Focus gaps vs implementer suite (post Should-Fix polish re-verify):
 * - AC-18: same-batch write throw + success; reason must be write-failed:io-error when body leaks
 * - AC-24: sanitizeReason strips control chars / multi-space prose → io-error (not truncate-prefix)
 * - AC-17: isDirty-only gate with matching content hash (implementer only disk-hash dirty)
 * - AC-11: mark-reviewed rejects already-reverted; no SnapshotStore.write
 * - AC-22: cold restore skips sessions without event cache; hydrate idempotent
 * - AC-22/24: toListPayload / change-list JSON never carries oldText/newText
 * - AD-CCD-10: 3-turn same-path orderChangeIdsForBatch DESC
 * - Parameter variation: mark-reviewed / sanitizeReason respond to different inputs
 */
import { mkdir, mkdtemp, readFile, rm, writeFile, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ConversationController } from '../../../../../../apps/vscode-dsh/src/conversation-controller.ts'
import {
  SnapshotStore,
  hashTextContent,
  orderChangeIdsForBatch,
  sanitizeReason,
  writeChangeIndex,
  type RevertWorkspace,
} from '../../../../../../apps/vscode-dsh/src/change/index.ts'
import { IdeSessionHost } from '../../../../../../apps/vscode-dsh/src/session-host.ts'
import {
  EXTENSION_INDEX_STATE_KEY,
  type ExtensionIndexSnapshot,
} from '../../../../../../apps/vscode-dsh/src/extension-index.ts'
import { deactivate } from '../../../../../../apps/vscode-dsh/src/extension.ts'
import type { HarnessNotification } from '@deepseek-ai/dsh-sdk-client'

afterEach(async () => {
  await deactivate()
})

describe('verifier independent — write-fail mix + dirty isDirty + cold restore', () => {
  it('AC-18 independent: batch write throw on one path, success on another', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-v-p3-writefail-'))
    const workspace = join(root, 'ws')
    await mkdir(join(workspace, 'src'), { recursive: true })
    const pathOk = 'src/ok.ts'
    const pathFail = 'src/fail.ts'
    const absOk = join(workspace, pathOk)
    const absFail = join(workspace, pathFail)
    await writeFile(absOk, 'ok-after\n', 'utf8')
    await writeFile(absFail, 'fail-after\n', 'utf8')
    // Content-like Error.message (spaces + tokens) must map to io-error, not leak body.
    const leakMarker = 'VERIFIER_BATCH_SECRET_BODY_FRAGMENT'
    const contentLikeError = [
      leakMarker,
      'function shouldNotLeak() { return true }',
      'const x = 1',
    ].join(' ')

    const { controller, tab } = await settleTwoModified(
      root,
      workspace,
      [
        { path: pathOk, before: 'ok-before\n', after: 'ok-after\n' },
        { path: pathFail, before: 'fail-before\n', after: 'fail-after\n' },
      ],
    )
    const recOk = controller.changes.list(tab.sessionId).find(r => r.path === pathOk)!
    const recFail = controller.changes.list(tab.sessionId).find(r => r.path === pathFail)!

    const ws: RevertWorkspace = {
      resolveAbsolute(path) {
        return path.startsWith('/') ? path : join(workspace, path)
      },
      async readText(absPath) {
        try {
          return await readFile(absPath, 'utf8')
        } catch {
          return undefined
        }
      },
      async exists(absPath) {
        try {
          await stat(absPath)
          return true
        } catch {
          return false
        }
      },
      async writeText(absPath, text) {
        if (absPath === absFail) {
          throw new Error(contentLikeError)
        }
        await mkdir(dirname(absPath), { recursive: true })
        await writeFile(absPath, text, 'utf8')
      },
      async deleteFile(absPath) {
        await rm(absPath, { force: true })
      },
    }
    controller.setRevertWorkspace(ws)

    const results = await controller.revertChanges([recOk.changeId, recFail.changeId], {
      confirmGate: async () => true,
    })
    expect(results).toHaveLength(2)
    const byId = new Map(results.map(r => [r.changeId, r]))
    expect(byId.get(recOk.changeId)?.ok).toBe(true)
    expect(byId.get(recFail.changeId)?.ok).toBe(false)
    expect(byId.get(recFail.changeId)?.reason).toBe('write-failed:io-error')
    expect(byId.get(recFail.changeId)?.reason).not.toContain(leakMarker)
    expect(await readFile(absOk, 'utf8')).toBe('ok-before\n')
    expect(await readFile(absFail, 'utf8')).toBe('fail-after\n')
    expect(controller.changes.getById(recOk.changeId)!.status).toBe('reverted')
    expect(controller.changes.getById(recFail.changeId)!.status).toBe('unreviewed')
    await rm(root, { recursive: true, force: true })
  })

  it('AC-24 independent: sanitizeReason maps content-like / control-char noise to io-error (no prefix leak)', () => {
    // Implementer covers SECRET+function+long-x and write path; this probes control-char
    // stripping + multi-space prose (would leak under truncate-prefix strategies).
    const prose = 'file body line one and two and three and four'
    expect(sanitizeReason(`\u0001\u0007${prose}`)).toBe('io-error')
    expect(sanitizeReason(`\u0001\u0007${prose}`)).not.toContain('file body')

    const withBraces = 'oops { leaked: true }'
    expect(sanitizeReason(withBraces)).toBe('io-error')
    expect(sanitizeReason(withBraces)).not.toContain('leaked')

    // Control-only → unknown (not empty string passthrough).
    expect(sanitizeReason('\u0000\u0001\u0008')).toBe('unknown')

    // Short opaque codes still pass (parameter variation vs content-like).
    expect(sanitizeReason('EACCES')).toBe('EACCES')
    expect(sanitizeReason('write-denied')).toBe('write-denied')

    // Over-length freeform without space heuristic still collapses to io-error.
    const longNoSpace = `SECRETPREFIX${'Z'.repeat(100)}`
    expect(sanitizeReason(longNoSpace)).toBe('io-error')
    expect(sanitizeReason(longNoSpace)).not.toContain('SECRETPREFIX')
  })

  it('AC-17 independent: isDirty alone triggers dirty gate when hash matches', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-v-p3-isdirty-'))
    const workspace = join(root, 'ws')
    await mkdir(join(workspace, 'src'), { recursive: true })
    const filePath = 'src/dirty-buf.ts'
    const abs = join(workspace, filePath)
    const before = 'base\n'
    const after = 'agent\n'
    await writeFile(abs, after, 'utf8')

    const { controller, tab } = await settleModified(root, workspace, filePath, before, after)
    const rec = controller.changes.list(tab.sessionId)[0]!
    expect(hashTextContent(after)).toBe(rec.afterContentHash)

    const ws: RevertWorkspace = {
      resolveAbsolute(path) {
        return path.startsWith('/') ? path : join(workspace, path)
      },
      async readText(absPath) {
        try {
          return await readFile(absPath, 'utf8')
        } catch {
          return undefined
        }
      },
      async exists(absPath) {
        try {
          await stat(absPath)
          return true
        } catch {
          return false
        }
      },
      openDocument(absPath) {
        if (absPath !== abs) return undefined
        // Buffer text matches after-image hash, but editor is dirty.
        return { getText: () => after, isDirty: true }
      },
      async writeText(absPath, text) {
        await writeFile(absPath, text, 'utf8')
      },
      async deleteFile(absPath) {
        await rm(absPath, { force: true })
      },
    }
    controller.setRevertWorkspace(ws)

    const analyzed = await controller.analyzeChangeRevertGates(rec.changeId)
    expect('gates' in analyzed).toBe(true)
    if ('gates' in analyzed) {
      expect(analyzed.gates.some(g => g.kind === 'confirm-dirty')).toBe(true)
    }
    const cancelled = await controller.revertChange(rec.changeId, {
      confirmGate: async (gate) => gate.kind !== 'confirm-dirty',
    })
    expect(cancelled.cancelled).toBe(true)
    expect(await readFile(abs, 'utf8')).toBe(after)
    expect(controller.changes.getById(rec.changeId)!.status).toBe('unreviewed')
    await rm(root, { recursive: true, force: true })
  })

  it('AC-11 independent: mark-reviewed rejects reverted; never SnapshotStore.write', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-v-p3-mark-'))
    const workspace = join(root, 'ws')
    await mkdir(workspace, { recursive: true })
    const filePath = 'm.ts'
    await writeFile(join(workspace, filePath), 'after\n', 'utf8')
    const { controller, tab } = await settleModified(root, workspace, filePath, 'before\n', 'after\n')
    installFsWorkspace(controller, workspace)
    const rec = controller.changes.list(tab.sessionId)[0]!

    const writeSpy = vi.spyOn(controller.getChangeSnapshotStore(), 'write')
    const ok = await controller.markChangeReviewed(rec.changeId)
    expect(ok.ok).toBe(true)
    expect(writeSpy).not.toHaveBeenCalled()

    const reverted = await controller.revertChange(rec.changeId, {
      confirmGate: async () => true,
    })
    expect(reverted.ok).toBe(true)
    writeSpy.mockClear()
    const rejected = await controller.markChangeReviewed(rec.changeId)
    expect(rejected.ok).toBe(false)
    if (!rejected.ok) expect(rejected.reason).toBe('already-reverted')
    expect(writeSpy).not.toHaveBeenCalled()
    expect(controller.changes.getById(rec.changeId)!.status).toBe('reverted')
    writeSpy.mockRestore()
    await rm(root, { recursive: true, force: true })
  })

  it('AC-22 independent: cold restore hydrates only cached sessions; hydrate is idempotent', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-v-p3-cold-'))
    const storageRoot = join(root, 'storage')
    const workspaceKey = join(root, 'ws-key')
    const sessOk = 'sess-ok'
    const sessSkip = 'sess-skip-no-events'

    const recordOk = {
      changeId: 'c-ok',
      sessionId: sessOk,
      turn: 0,
      sourceMessageId: 'assistant-ok',
      path: 'src/ok.ts',
      kind: 'modified' as const,
      status: 'unreviewed' as const,
      additions: 4,
      deletions: 1,
      createdAt: 1,
      updatedAt: 1,
      snapshotRef: 'snap-ok',
      afterContentHash: hashTextContent('after-ok'),
    }
    const recordSkip = {
      ...recordOk,
      changeId: 'c-skip',
      sessionId: sessSkip,
      sourceMessageId: 'assistant-skip',
      path: 'src/skip.ts',
      snapshotRef: 'snap-skip',
    }
    await writeChangeIndex(storageRoot, sessOk, [recordOk])
    await writeChangeIndex(storageRoot, sessSkip, [recordSkip])

    const mem = new Map<string, unknown>()
    mem.set(EXTENSION_INDEX_STATE_KEY, {
      workspaceKey,
      sessions: [
        { sessionId: sessOk, title: 'Ok', mtime: 2 },
        { sessionId: sessSkip, title: 'Skip', mtime: 1 },
      ],
      openTabSet: [
        { tabId: 't-ok', sessionId: sessOk, mode: 'live', title: 'Ok', liveIntent: true },
        { tabId: 't-skip', sessionId: sessSkip, mode: 'live', title: 'Skip', liveIntent: true },
      ],
      activeSessionId: sessOk,
      ui: { restoreUiLimit: 8 },
    } satisfies ExtensionIndexSnapshot)
    const state = {
      get<T>(key: string) { return mem.get(key) as T | undefined },
      update(key: string, value: unknown) { mem.set(key, value) },
    }

    const host = fakeHost()
    const controller = new ConversationController(host.host, state, workspaceKey, {
      snapshotStore: new SnapshotStore({ storageRoot }),
    })
    const eventsOk = [
      {
        type: 'user/message',
        seq: 0,
        data: {
          role: 'user',
          id: 'user-ok',
          content: [{ type: 'text', text: 'edit' }],
        },
      },
      {
        type: 'assistant/message',
        seq: 1,
        data: {
          message: {
            role: 'assistant',
            id: 'assistant-ok',
            content: [{ type: 'text', text: 'done' }],
          },
        },
      },
    ]
    // Only sessOk has events → sessSkip must be skipped (no phantom change-list tab).
    const restored = await controller.restoreOpenTabSet({
      eventsBySession: new Map([[sessOk, eventsOk]]),
    })
    expect(restored.outcome).toBe('restored')
    if (restored.outcome !== 'restored') return
    expect(restored.hydrated.some(h => h.sessionId === sessOk)).toBe(true)
    expect(restored.hydrated.some(h => h.sessionId === sessSkip)).toBe(false)

    const listOk = controller.messages.get(sessOk).filter(m => m.kind === 'change-list')
    expect(listOk).toHaveLength(1)
    expect(listOk[0]!.changeList!.changes[0]!.path).toBe('src/ok.ts')
    expect(listOk[0]!.changeList!.changes[0]!.additions).toBe(4)
    expect(controller.changes.getById('c-ok')).toBeDefined()
    expect(controller.changes.getById('c-skip')).toBeUndefined()

    // Idempotent re-hydrate must not duplicate change-list messages.
    await controller.hydrateChangeListsFromIndex(sessOk)
    expect(controller.messages.get(sessOk).filter(m => m.kind === 'change-list')).toHaveLength(1)
    await rm(root, { recursive: true, force: true })
  })

  it('AC-22/24: toListPayload never embeds oldText/newText; prune get-diff stays unavailable', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-v-p3-payload-'))
    const workspace = join(root, 'ws')
    await mkdir(workspace, { recursive: true })
    const secret = 'VERIFIER_SECRET_BODY_SHOULD_NOT_LEAK'
    const filePath = 'secret.ts'
    await writeFile(join(workspace, filePath), 'after\n', 'utf8')
    const { controller, tab } = await settleModified(root, workspace, filePath, secret, 'after\n')
    const rec = controller.changes.list(tab.sessionId)[0]!
    const payload = controller.changes.toListPayload(tab.sessionId, rec.turn, rec.sourceMessageId)
    const json = JSON.stringify(payload)
    expect(json).not.toContain(secret)
    expect(json).not.toContain('oldText')
    expect(json).not.toContain('newText')
    expect(payload.changes[0]!.path).toBe(filePath)
    expect(typeof payload.changes[0]!.additions).toBe('number')

    // Drop blob → SnapshotStore.read undefined (Host get-diff must not invent body).
    const blobPath = join(root, 'storage', 'changes', tab.sessionId, `${rec.snapshotRef}.json`)
    await rm(blobPath, { force: true })
    const body = await controller.getChangeSnapshotStore().read(tab.sessionId, rec.snapshotRef!)
    expect(body).toBeUndefined()
    await rm(root, { recursive: true, force: true })
  })

  it('AD-CCD-10 independent: 3-turn same-path batch orders turn DESC', () => {
    const host = fakeHost()
    const controller = new ConversationController(host.host)
    const tab = controller.newConversation('live')
    const base = {
      sessionId: tab.sessionId,
      sourceMessageId: 'a',
      path: 'same.ts',
      kind: 'modified' as const,
      status: 'unreviewed' as const,
      additions: 1,
      deletions: 0,
      createdAt: 1,
      updatedAt: 1,
      afterContentHash: hashTextContent('x'),
    }
    controller.changes.upsert({ ...base, changeId: 't0', turn: 0 })
    controller.changes.upsert({ ...base, changeId: 't1', turn: 1 })
    controller.changes.upsert({ ...base, changeId: 't2', turn: 2 })
    // Request out of order: early, late, mid.
    expect(orderChangeIdsForBatch(controller.changes, ['t0', 't2', 't1']))
      .toEqual(['t2', 't1', 't0'])
  })

  it('parameter variation: mark-reviewed missing id vs valid id (not a stub)', async () => {
    const host = fakeHost()
    const controller = new ConversationController(host.host)
    const missing = await controller.markChangeReviewed('no-such-id')
    expect(missing.ok).toBe(false)

    const tab = controller.newConversation('live')
    controller.changes.upsert({
      changeId: 'real',
      sessionId: tab.sessionId,
      turn: 0,
      sourceMessageId: 'a',
      path: 'p.ts',
      kind: 'modified',
      status: 'unreviewed',
      additions: 1,
      deletions: 0,
      createdAt: 1,
      updatedAt: 1,
      afterContentHash: hashTextContent('x'),
    })
    const ok = await controller.markChangeReviewed('real')
    expect(ok.ok).toBe(true)
    expect(controller.changes.getById('real')!.status).toBe('reviewed')
  })
})

async function settleModified(
  root: string,
  workspace: string,
  filePath: string,
  before: string,
  after: string,
): Promise<{
  controller: ConversationController
  tab: { sessionId: string; tabId: string }
}> {
  const settled = await settleTwoModified(root, workspace, [{ path: filePath, before, after }])
  return { controller: settled.controller, tab: settled.tab }
}

async function settleTwoModified(
  root: string,
  workspace: string,
  filesSpec: Array<{ path: string; before: string; after: string }>,
): Promise<{
  controller: ConversationController
  tab: { sessionId: string; tabId: string }
}> {
  const storageRoot = join(root, 'storage')
  const host = fakeHost()
  const files = new Map<string, string>(filesSpec.map(f => [f.path, f.after]))
  const controller = new ConversationController(host.host, undefined, '', {
    snapshotStore: new SnapshotStore({ storageRoot }),
    getIgnoreOptions: () => ({ workspaceFolders: [workspace] }),
    readWorkspaceText: async (path) => files.get(path),
  })
  const tab = controller.newConversation('live')
  for (const f of filesSpec) {
    controller.seedChangeBefore(tab.sessionId, f.path, f.before)
  }
  host.notify?.(event(tab.sessionId, 'turn/start', { turn: 0 }))
  host.notify?.(event(tab.sessionId, 'tool/result', {
    turn: 0,
    message: { callId: 'c', name: 'edit', content: [] },
    meta: {
      diffs: filesSpec.map(f => ({
        path: f.path,
        oldText: f.before.slice(0, 4),
        newText: f.after.slice(0, 4),
      })),
    },
  }))
  host.notify?.(event(tab.sessionId, 'assistant/message', {
    turn: 0,
    message: {
      id: 'a1',
      role: 'assistant',
      content: [{ type: 'text', text: 'edited' }],
      source: { kind: 'model', provider: 'fake', model: 'fake' },
    },
  }))
  await controller.flushChangeSettles(tab.sessionId)
  return { controller, tab }
}

function installFsWorkspace(controller: ConversationController, workspace: string): void {
  const ws: RevertWorkspace = {
    resolveAbsolute(path) {
      return path.startsWith('/') ? path : join(workspace, path)
    },
    async readText(absPath) {
      try {
        return await readFile(absPath, 'utf8')
      } catch {
        return undefined
      }
    },
    async exists(absPath) {
      try {
        await stat(absPath)
        return true
      } catch {
        return false
      }
    },
    async writeText(absPath, text) {
      await mkdir(dirname(absPath), { recursive: true })
      await writeFile(absPath, text, 'utf8')
    },
    async deleteFile(absPath) {
      await rm(absPath, { force: true })
    },
  }
  controller.setRevertWorkspace(ws)
}

function fakeHost(): {
  host: IdeSessionHost
  notify: ((n: HarnessNotification) => void) | undefined
} {
  let notify: ((n: HarnessNotification) => void) | undefined
  const host = {
    status: 'connected' as const,
    interactions: { failClosedSession() {}, listPending() { return [] } },
    setConversationRegistry() {},
    onNotification(listener: (n: HarnessNotification) => void) {
      notify = listener
      return () => { notify = undefined }
    },
    async prompt() { return 'm' },
    async disposeSession() {},
  } as unknown as IdeSessionHost
  return { host, get notify() { return notify } }
}

function event(
  sessionId: string,
  type: string,
  data: Record<string, unknown>,
): HarnessNotification {
  return {
    method: 'session.event',
    params: { sessionId, event: { type, data } },
  }
}
