/**
 * Phase 3 — mark-reviewed / revert / batch / AC-17 / replay hydrate / AC-24 / AD-CCD-10.
 * L2 fixtures covering AC-11,13–18,22,24 + AD-CCD-10 turn-DESC batch.
 */

import { mkdir, mkdtemp, readFile, rm, writeFile, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  ChatPanelHost,
  FakeWebviewPort,
  buildThinChatHtml,
  parseWebviewToHostMessage,
} from '../src/chat-panel/index.ts'
import { ConversationController } from '../src/conversation-controller.ts'
import {
  CHANGE_STATUS_REVIEWED_LABEL,
  CHANGE_STATUS_REVERTED_LABEL,
  SnapshotStore,
  hashTextContent,
  orderChangeIdsForBatch,
  readChangeIndex,
  sanitizeReason,
  writeChangeIndex,
  type RevertWorkspace,
} from '../src/change/index.ts'
import { IdeSessionHost } from '../src/session-host.ts'
import {
  EXTENSION_INDEX_STATE_KEY,
  type ExtensionIndexSnapshot,
} from '../src/extension-index.ts'
import { deactivate } from '../src/extension.ts'
import type { HarnessNotification } from '@deepseek-ai/dsh-sdk-client'

afterEach(async () => {
  await deactivate()
})

describe('phase-3 review / revert / replay', () => {
  it('AC-11: mark-reviewed updates status without workspace write', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-ccd-p3-review-'))
    const workspace = join(root, 'ws')
    await mkdir(join(workspace, 'src'), { recursive: true })
    const filePath = 'src/a.ts'
    const abs = join(workspace, filePath)
    const after = 'AFTER\n'
    await writeFile(abs, after, 'utf8')
    const beforeHash = hashTextContent(after)

    const { controller, tab } = await settleModified(root, workspace, filePath, 'BEFORE\n', after)
    const rec = controller.changes.list(tab.sessionId)[0]!
    expect(rec.status).toBe('unreviewed')

    const diskBefore = await readFile(abs, 'utf8')
    const result = await controller.markChangeReviewed(rec.changeId)
    expect(result.ok).toBe(true)
    expect(controller.changes.getById(rec.changeId)!.status).toBe('reviewed')
    expect(await readFile(abs, 'utf8')).toBe(diskBefore)
    expect(hashTextContent(await readFile(abs, 'utf8'))).toBe(beforeHash)

    const list = controller.messages.get(tab.sessionId).find(m => m.kind === 'change-list')
    expect(list!.changeList!.changes[0]!.status).toBe('reviewed')
    await rm(root, { recursive: true, force: true })
  })

  it('AC-13: revert restores oldText and sets reverted; failure leaves status', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-ccd-p3-revert-'))
    const workspace = join(root, 'ws')
    await mkdir(join(workspace, 'src'), { recursive: true })
    const filePath = 'src/b.ts'
    const abs = join(workspace, filePath)
    const before = 'line1\nold\n'
    const after = 'line1\nnew\n'
    await writeFile(abs, after, 'utf8')

    const { controller, tab } = await settleModified(root, workspace, filePath, before, after)
    const rec = controller.changes.list(tab.sessionId)[0]!
    installFsWorkspace(controller, workspace)

    const ok = await controller.revertChange(rec.changeId, {
      confirmGate: async () => true,
    })
    expect(ok.ok).toBe(true)
    expect(await readFile(abs, 'utf8')).toBe(before)
    expect(controller.changes.getById(rec.changeId)!.status).toBe('reverted')

    // Failure path: missing snapshot → status unchanged on a fresh record.
    const storageRoot = join(root, 'storage')
    const host = fakeHost()
    const controller2 = new ConversationController(host.host, undefined, '', {
      snapshotStore: new SnapshotStore({ storageRoot }),
      getIgnoreOptions: () => ({ workspaceFolders: [workspace] }),
      readWorkspaceText: async (path) => path === filePath ? after : undefined,
    })
    installFsWorkspace(controller2, workspace)
    const tab2 = controller2.newConversation('live')
    controller2.changes.upsert({
      changeId: 'no-snap',
      sessionId: tab2.sessionId,
      turn: 0,
      sourceMessageId: 'a',
      path: filePath,
      kind: 'modified',
      status: 'unreviewed',
      additions: 1,
      deletions: 1,
      createdAt: 1,
      updatedAt: 1,
      afterContentHash: hashTextContent(after),
      // no snapshotRef
    })
    const fail = await controller2.revertChange('no-snap', { confirmGate: async () => true })
    expect(fail.ok).toBe(false)
    expect(fail.reason).toBe('snapshot-unavailable')
    expect(controller2.changes.getById('no-snap')!.status).toBe('unreviewed')
    await rm(root, { recursive: true, force: true })
  })

  it('AC-14: created revert deletes only after confirm; cancel keeps file', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-ccd-p3-create-'))
    const workspace = join(root, 'ws')
    await mkdir(join(workspace, 'src'), { recursive: true })
    const filePath = 'src/new.ts'
    const abs = join(workspace, filePath)
    const after = 'created\n'
    await writeFile(abs, after, 'utf8')

    const storageRoot = join(root, 'storage')
    const host = fakeHost()
    const controller = new ConversationController(host.host, undefined, '', {
      snapshotStore: new SnapshotStore({ storageRoot }),
      getIgnoreOptions: () => ({ workspaceFolders: [workspace] }),
      readWorkspaceText: async (path) => path === filePath ? after : undefined,
    })
    installFsWorkspace(controller, workspace)
    const tab = controller.newConversation('live')
    controller.seedChangeBefore(tab.sessionId, filePath, null)
    host.notify?.(event(tab.sessionId, 'turn/start', { turn: 0 }))
    host.notify?.(event(tab.sessionId, 'tool/result', {
      turn: 0,
      message: { callId: 'c', name: 'write', content: [] },
      meta: { diffs: [{ path: filePath, oldText: null, newText: after }] },
    }))
    host.notify?.(event(tab.sessionId, 'assistant/message', {
      turn: 0,
      message: {
        id: 'a1',
        role: 'assistant',
        content: [{ type: 'text', text: 'created' }],
        source: { kind: 'model', provider: 'fake', model: 'fake' },
      },
    }))
    await controller.flushChangeSettles(tab.sessionId)
    const rec = controller.changes.list(tab.sessionId)[0]!
    expect(rec.kind).toBe('created')

    const cancelled = await controller.revertChange(rec.changeId, {
      confirmGate: async () => false,
    })
    expect(cancelled.ok).toBe(false)
    expect(cancelled.cancelled).toBe(true)
    expect(await readFile(abs, 'utf8')).toBe(after)
    expect(controller.changes.getById(rec.changeId)!.status).toBe('unreviewed')

    const ok = await controller.revertChange(rec.changeId, {
      confirmGate: async () => true,
    })
    expect(ok.ok).toBe(true)
    await expect(readFile(abs, 'utf8')).rejects.toBeTruthy()
    expect(controller.changes.getById(rec.changeId)!.status).toBe('reverted')
    await rm(root, { recursive: true, force: true })
  })

  it('AC-15: deleted restore conflicts when path exists; confirm overwrites', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-ccd-p3-del-'))
    const workspace = join(root, 'ws')
    await mkdir(join(workspace, 'src'), { recursive: true })
    const filePath = 'src/gone.ts'
    const abs = join(workspace, filePath)
    const before = 'restore-me\n'
    // After delete, settle uses empty newText; recreate conflict file for AC-15.
    const storageRoot = join(root, 'storage')
    const host = fakeHost()
    const files = new Map<string, string>()
    const controller = new ConversationController(host.host, undefined, '', {
      snapshotStore: new SnapshotStore({ storageRoot }),
      getIgnoreOptions: () => ({ workspaceFolders: [workspace] }),
      readWorkspaceText: async (path) => files.get(path),
    })
    installFsWorkspace(controller, workspace)
    const tab = controller.newConversation('live')
    controller.seedChangeBefore(tab.sessionId, filePath, before)
    // Disk empty at settle (deleted).
    host.notify?.(event(tab.sessionId, 'turn/start', { turn: 0 }))
    host.notify?.(event(tab.sessionId, 'tool/result', {
      turn: 0,
      message: { callId: 'c', name: 'edit', content: [] },
      meta: { diffs: [{ path: filePath, oldText: before, newText: '' }] },
    }))
    host.notify?.(event(tab.sessionId, 'assistant/message', {
      turn: 0,
      message: {
        id: 'a1',
        role: 'assistant',
        content: [{ type: 'text', text: 'deleted' }],
        source: { kind: 'model', provider: 'fake', model: 'fake' },
      },
    }))
    await controller.flushChangeSettles(tab.sessionId)
    const rec = controller.changes.list(tab.sessionId)[0]!
    expect(rec.kind).toBe('deleted')

    await writeFile(abs, 'user-recreated\n', 'utf8')
    const analyzed = await controller.analyzeChangeRevertGates(rec.changeId)
    expect('gates' in analyzed).toBe(true)
    if ('gates' in analyzed) {
      expect(analyzed.gates.some(g => g.kind === 'confirm-restore-conflict')).toBe(true)
    }

    const cancelled = await controller.revertChange(rec.changeId, {
      confirmGate: async () => false,
    })
    expect(cancelled.cancelled).toBe(true)
    expect(await readFile(abs, 'utf8')).toBe('user-recreated\n')

    const ok = await controller.revertChange(rec.changeId, {
      confirmGate: async () => true,
    })
    expect(ok.ok).toBe(true)
    expect(await readFile(abs, 'utf8')).toBe(before)
    await rm(root, { recursive: true, force: true })
  })

  it('AC-16: revert then new turn yields a new ChangeRecord', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-ccd-p3-reedit-'))
    const workspace = join(root, 'ws')
    await mkdir(join(workspace, 'src'), { recursive: true })
    const filePath = 'src/c.ts'
    const abs = join(workspace, filePath)
    await writeFile(abs, 'v2\n', 'utf8')
    const { controller, tab, host } = await settleModified(root, workspace, filePath, 'v1\n', 'v2\n')
    installFsWorkspace(controller, workspace)
    const first = controller.changes.list(tab.sessionId)[0]!
    await controller.revertChange(first.changeId, { confirmGate: async () => true })
    expect(controller.changes.getById(first.changeId)!.status).toBe('reverted')

    await writeFile(abs, 'v3\n', 'utf8')
    controller.seedChangeBefore(tab.sessionId, filePath, 'v1\n')
    host.notify?.(event(tab.sessionId, 'turn/start', { turn: 1 }))
    host.notify?.(event(tab.sessionId, 'tool/result', {
      turn: 1,
      message: { callId: 'c2', name: 'edit', content: [] },
      meta: { diffs: [{ path: filePath, oldText: 'v1', newText: 'v3' }] },
    }))
    host.notify?.(event(tab.sessionId, 'assistant/message', {
      turn: 1,
      message: {
        id: 'a2',
        role: 'assistant',
        content: [{ type: 'text', text: 'again' }],
        source: { kind: 'model', provider: 'fake', model: 'fake' },
      },
    }))
    await controller.flushChangeSettles(tab.sessionId)
    const all = controller.changes.list(tab.sessionId)
    expect(all).toHaveLength(2)
    const second = all.find(r => r.turn === 1)!
    expect(second.changeId).not.toBe(first.changeId)
    expect(second.status).toBe('unreviewed')
    expect(controller.changes.getById(first.changeId)!.status).toBe('reverted')
    await rm(root, { recursive: true, force: true })
  })

  it('AC-17: dirty gate cancels without write', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-ccd-p3-dirty-'))
    const workspace = join(root, 'ws')
    await mkdir(join(workspace, 'src'), { recursive: true })
    const filePath = 'src/d.ts'
    const abs = join(workspace, filePath)
    const before = 'base\n'
    const after = 'agent\n'
    await writeFile(abs, after, 'utf8')
    const { controller, tab } = await settleModified(root, workspace, filePath, before, after)
    // User edits disk after settle → hash mismatch vs afterContentHash.
    await writeFile(abs, 'user-dirty\n', 'utf8')
    installFsWorkspace(controller, workspace)
    const rec = controller.changes.list(tab.sessionId)[0]!
    const analyzed = await controller.analyzeChangeRevertGates(rec.changeId)
    expect('gates' in analyzed).toBe(true)
    if ('gates' in analyzed) {
      expect(analyzed.gates.some(g => g.kind === 'confirm-dirty')).toBe(true)
    }
    const cancelled = await controller.revertChange(rec.changeId, {
      confirmGate: async (gate) => gate.kind !== 'confirm-dirty',
    })
    expect(cancelled.cancelled).toBe(true)
    expect(await readFile(abs, 'utf8')).toBe('user-dirty\n')
    expect(controller.changes.getById(rec.changeId)!.status).toBe('unreviewed')
    await rm(root, { recursive: true, force: true })
  })

  it('AC-18 + AD-CCD-10: batch per-file results; same-path turn DESC; later-change gate', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-ccd-p3-batch-'))
    const workspace = join(root, 'ws')
    await mkdir(join(workspace, 'src'), { recursive: true })
    const filePath = 'src/e.ts'
    const abs = join(workspace, filePath)
    await writeFile(abs, 't1\n', 'utf8')

    const storageRoot = join(root, 'storage')
    const host = fakeHost()
    const files = new Map<string, string>([[filePath, 't1\n']])
    const controller = new ConversationController(host.host, undefined, '', {
      snapshotStore: new SnapshotStore({ storageRoot }),
      getIgnoreOptions: () => ({ workspaceFolders: [workspace] }),
      readWorkspaceText: async (path) => files.get(path),
    })
    installFsWorkspace(controller, workspace)
    const tab = controller.newConversation('live')

    // Turn 0
    controller.seedChangeBefore(tab.sessionId, filePath, 't0\n')
    files.set(filePath, 't1\n')
    host.notify?.(event(tab.sessionId, 'turn/start', { turn: 0 }))
    host.notify?.(event(tab.sessionId, 'tool/result', {
      turn: 0,
      message: { callId: 'c0', name: 'edit', content: [] },
      meta: { diffs: [{ path: filePath, oldText: 't0', newText: 't1' }] },
    }))
    host.notify?.(event(tab.sessionId, 'assistant/message', {
      turn: 0,
      message: {
        id: 'a0',
        role: 'assistant',
        content: [{ type: 'text', text: 't0' }],
        source: { kind: 'model', provider: 'fake', model: 'fake' },
      },
    }))
    await controller.flushChangeSettles(tab.sessionId)

    // Turn 1
    controller.seedChangeBefore(tab.sessionId, filePath, 't1\n')
    files.set(filePath, 't2\n')
    await writeFile(abs, 't2\n', 'utf8')
    host.notify?.(event(tab.sessionId, 'turn/start', { turn: 1 }))
    host.notify?.(event(tab.sessionId, 'tool/result', {
      turn: 1,
      message: { callId: 'c1', name: 'edit', content: [] },
      meta: { diffs: [{ path: filePath, oldText: 't1', newText: 't2' }] },
    }))
    host.notify?.(event(tab.sessionId, 'assistant/message', {
      turn: 1,
      message: {
        id: 'a1',
        role: 'assistant',
        content: [{ type: 'text', text: 't1' }],
        source: { kind: 'model', provider: 'fake', model: 'fake' },
      },
    }))
    await controller.flushChangeSettles(tab.sessionId)

    const records = controller.changes.listByPath(tab.sessionId, filePath)
    expect(records).toHaveLength(2)
    const early = records.find(r => r.turn === 0)!
    const late = records.find(r => r.turn === 1)!
    expect(orderChangeIdsForBatch(controller.changes, [early.changeId, late.changeId]))
      .toEqual([late.changeId, early.changeId])

    // Only early selected → later-changes gate.
    const analyzed = await controller.analyzeChangeRevertGates(early.changeId)
    expect('gates' in analyzed).toBe(true)
    if ('gates' in analyzed) {
      expect(analyzed.gates.some(g => g.kind === 'confirm-later-changes')).toBe(true)
    }
    const cancelEarly = await controller.revertChange(early.changeId, {
      confirmGate: async (gate) => gate.kind !== 'confirm-later-changes',
    })
    expect(cancelEarly.cancelled).toBe(true)
    expect(await readFile(abs, 'utf8')).toBe('t2\n')

    // Batch both: later first; one forced failure via cancel on second → per-file results.
    const results = await controller.revertChanges([early.changeId, late.changeId], {
      confirmGate: async (gate) => {
        // Cancel only when reverting the early turn's later-changes gate after late is done,
        // or allow all for success path — here allow all.
        void gate
        return true
      },
    })
    expect(results).toHaveLength(2)
    expect(results.every(r => r.ok)).toBe(true)
    // After both reverted, disk should be t0 (early oldText) because late then early.
    expect(await readFile(abs, 'utf8')).toBe('t0\n')

    // Partial failure: revert-many with one missing id.
    const mixed = await controller.revertChanges(['missing-id', late.changeId], {
      confirmedGates: new Set(),
    })
    expect(mixed.some(r => r.changeId === 'missing-id' && !r.ok)).toBe(true)
    await rm(root, { recursive: true, force: true })
  })

  it('AC-18: same-batch write throw + success → mixed disk/status per-id', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-ccd-p3-writefail-'))
    const workspace = join(root, 'ws')
    await mkdir(join(workspace, 'src'), { recursive: true })
    const pathOk = 'src/ok.ts'
    const pathFail = 'src/fail.ts'
    const absOk = join(workspace, pathOk)
    const absFail = join(workspace, pathFail)
    await writeFile(absOk, 'ok-after\n', 'utf8')
    await writeFile(absFail, 'fail-after\n', 'utf8')

    const { controller, tab } = await settleTwoModified(root, workspace, [
      { path: pathOk, before: 'ok-before\n', after: 'ok-after\n' },
      { path: pathFail, before: 'fail-before\n', after: 'fail-after\n' },
    ])
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
          throw new Error('injected-write-failure')
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
    expect(byId.get(recFail.changeId)?.reason).toMatch(/^write-failed:/)
    expect(await readFile(absOk, 'utf8')).toBe('ok-before\n')
    expect(await readFile(absFail, 'utf8')).toBe('fail-after\n')
    expect(controller.changes.getById(recOk.changeId)!.status).toBe('reverted')
    expect(controller.changes.getById(recFail.changeId)!.status).toBe('unreviewed')
    await rm(root, { recursive: true, force: true })
  })

  it('AC-24 / sanitizeReason: content-like write error must not leak verbatim', async () => {
    const secretBody = [
      'SECRET_FILE_BODY_MUST_NOT_APPEAR',
      'function leak() { return 1 }',
      'x'.repeat(120),
    ].join('\n')
    // Unit: long/content-like input is mapped to a short code — no verbatim prefix leak.
    const sanitized = sanitizeReason(secretBody)
    expect(sanitized).toBe('io-error')
    expect(sanitized).not.toContain('SECRET_FILE_BODY_MUST_NOT_APPEAR')
    expect(sanitized).not.toContain(secretBody.slice(0, 40))
    expect(sanitizeReason('EACCES')).toBe('EACCES')
    expect(sanitizeReason('injected-write-failure')).toBe('injected-write-failure')

    const root = await mkdtemp(join(tmpdir(), 'dsh-ccd-p3-sanitize-'))
    const workspace = join(root, 'ws')
    await mkdir(join(workspace, 'src'), { recursive: true })
    const filePath = 'src/s.ts'
    const abs = join(workspace, filePath)
    await writeFile(abs, 'after\n', 'utf8')
    const { controller, tab } = await settleModified(root, workspace, filePath, 'before\n', 'after\n')
    const rec = controller.changes.list(tab.sessionId)[0]!
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
      async writeText() {
        throw new Error(secretBody)
      },
      async deleteFile(absPath) {
        await rm(absPath, { force: true })
      },
    }
    controller.setRevertWorkspace(ws)
    const fail = await controller.revertChange(rec.changeId, { confirmGate: async () => true })
    expect(fail.ok).toBe(false)
    expect(fail.reason).toBe('write-failed:io-error')
    expect(fail.reason).not.toContain('SECRET_FILE_BODY_MUST_NOT_APPEAR')
    expect(controller.changes.getById(rec.changeId)!.status).toBe('unreviewed')
    expect(await readFile(abs, 'utf8')).toBe('after\n')
    await rm(root, { recursive: true, force: true })
  })

  it('AC-22: cold hydrate shows path+stats; pruned blob get-diff unavailable', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-ccd-p3-replay-'))
    const storageRoot = join(root, 'storage')
    const sessionId = 'sess-replay'
    const record = {
      changeId: 'c-replay',
      sessionId,
      turn: 0,
      sourceMessageId: 'assistant-1',
      path: 'src/f.ts',
      kind: 'modified' as const,
      status: 'unreviewed' as const,
      additions: 2,
      deletions: 1,
      createdAt: 1,
      updatedAt: 1,
      snapshotRef: 'snap-gone',
      afterContentHash: hashTextContent('after'),
    }
    await writeChangeIndex(storageRoot, sessionId, [record])

    const host = fakeHost()
    const controller = new ConversationController(host.host, undefined, '', {
      snapshotStore: new SnapshotStore({ storageRoot }),
    })
    // Simulate openFromHistory message fold (assistant only).
    const tab = controller.registry.create('replay', sessionId, 'replay')
    controller.messages.replace(sessionId, [{
      id: 'assistant-1',
      sessionId,
      role: 'assistant',
      kind: 'text',
      text: 'done',
      turn: 0,
    }])
    await controller.hydrateChangeListsFromIndex(sessionId)

    const msgs = controller.messages.get(sessionId)
    const list = msgs.find(m => m.kind === 'change-list')
    expect(list).toBeDefined()
    expect(list!.changeList!.changes[0]!.path).toBe('src/f.ts')
    expect(list!.changeList!.changes[0]!.additions).toBe(2)
    expect(JSON.stringify(list!.changeList)).not.toContain('SECRET')

    const loaded = controller.changes.getById('c-replay')!
    expect(loaded.snapshotRef).toBe('snap-gone')
    const snap = await controller.getChangeSnapshotStore().read(sessionId, 'snap-gone')
    expect(snap).toBeUndefined()

    // Host get-diff style: unavailable reason, no forged body.
    const port = new FakeWebviewPort()
    const panel = new ChatPanelHost({
      registry: controller.registry,
      messages: controller.messages,
      isHostReady: () => true,
      acceptSend: async () => ({ messageId: 'm', sessionId, tabId: tab.tabId }),
      requestChangeDiff: async (changeId) => {
        const rec = controller.changes.getById(changeId)
        if (rec?.snapshotRef === undefined) {
          return { changeId, available: false, reason: '完整 diff 不可用' }
        }
        const body = await controller.getChangeSnapshotStore().read(rec.sessionId, rec.snapshotRef)
        if (body === undefined) {
          return { changeId, available: false, reason: '完整 diff 不可用' }
        }
        return { changeId, available: true, oldText: body.oldText, newText: body.newText }
      },
    })
    panel.attach(port)
    port.emitFromWebview({ type: 'change/get-diff', changeId: 'c-replay' })
    await waitFor(() => port.receivedFromHost.some(m => m.type === 'change/diff-content'), 1000)
    const diff = port.receivedFromHost.find(m => m.type === 'change/diff-content') as {
      available: boolean
      reason?: string
      oldText?: string
    }
    expect(diff.available).toBe(false)
    expect(diff.reason).toBe('完整 diff 不可用')
    expect(diff.oldText).toBeUndefined()
    await rm(root, { recursive: true, force: true })
  })

  it('AC-22: restoreOpenTabSet cold path injects change-list path+stats', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-ccd-p3-cold-'))
    const storageRoot = join(root, 'storage')
    const workspaceKey = join(root, 'ws-key')
    const sessionId = 'sess-cold'
    const record = {
      changeId: 'c-cold',
      sessionId,
      turn: 0,
      sourceMessageId: 'assistant-cold',
      path: 'src/cold.ts',
      kind: 'modified' as const,
      status: 'unreviewed' as const,
      additions: 5,
      deletions: 3,
      createdAt: 1,
      updatedAt: 1,
      snapshotRef: 'snap-cold',
      afterContentHash: hashTextContent('after-cold'),
    }
    await writeChangeIndex(storageRoot, sessionId, [record])

    const mem = new Map<string, unknown>()
    mem.set(EXTENSION_INDEX_STATE_KEY, {
      workspaceKey,
      sessions: [{ sessionId, title: 'Cold', mtime: 1 }],
      openTabSet: [
        { tabId: 'old-cold', sessionId, mode: 'live', title: 'Cold', liveIntent: true },
      ],
      activeSessionId: sessionId,
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
    const events = [
      {
        type: 'user/message',
        seq: 0,
        data: {
          role: 'user',
          id: 'user-cold',
          content: [{ type: 'text', text: 'please edit' }],
        },
      },
      {
        type: 'assistant/message',
        seq: 1,
        data: {
          message: {
            role: 'assistant',
            id: 'assistant-cold',
            content: [{ type: 'text', text: 'done' }],
          },
        },
      },
    ]

    const restored = await controller.restoreOpenTabSet({
      eventsBySession: new Map([[sessionId, events]]),
    })
    expect(restored.outcome).toBe('restored')
    if (restored.outcome !== 'restored') return
    expect(restored.hydrated).toHaveLength(1)

    const msgs = controller.messages.get(sessionId)
    const list = msgs.find(m => m.kind === 'change-list')
    expect(list).toBeDefined()
    expect(list!.changeList!.changes[0]!.path).toBe('src/cold.ts')
    expect(list!.changeList!.changes[0]!.additions).toBe(5)
    expect(list!.changeList!.changes[0]!.deletions).toBe(3)
    expect(controller.changes.getById('c-cold')).toBeDefined()
    await rm(root, { recursive: true, force: true })
  })

  it('AD-CCD-6: prune prefers reverted; protects open unreverted sessions', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-ccd-p3-prune-'))
    const storageRoot = join(root, 'storage')
    const host = fakeHost()
    const controller = new ConversationController(host.host, undefined, '', {
      snapshotStore: new SnapshotStore({ storageRoot }),
    })
    const openTab = controller.newConversation('live')
    const closedReverted = 'sess-closed-reverted'
    const closedOther = 'sess-closed-other'

    // Seed ChangeStore: open tab unreverted; closed fully reverted; closed other unreverted.
    controller.changes.upsert({
      changeId: 'open-1',
      sessionId: openTab.sessionId,
      turn: 0,
      sourceMessageId: 'a',
      path: 'open.ts',
      kind: 'modified',
      status: 'unreviewed',
      additions: 1,
      deletions: 0,
      createdAt: 1,
      updatedAt: 1,
      afterContentHash: hashTextContent('x'),
      snapshotRef: 's-open',
    })
    controller.changes.upsert({
      changeId: 'rev-1',
      sessionId: closedReverted,
      turn: 0,
      sourceMessageId: 'a',
      path: 'rev.ts',
      kind: 'modified',
      status: 'reverted',
      additions: 1,
      deletions: 0,
      createdAt: 1,
      updatedAt: 1,
      afterContentHash: hashTextContent('x'),
      snapshotRef: 's-rev',
    })
    controller.changes.upsert({
      changeId: 'other-1',
      sessionId: closedOther,
      turn: 0,
      sourceMessageId: 'a',
      path: 'other.ts',
      kind: 'modified',
      status: 'unreviewed',
      additions: 1,
      deletions: 0,
      createdAt: 1,
      updatedAt: 1,
      afterContentHash: hashTextContent('x'),
      snapshotRef: 's-other',
    })

    const payload = JSON.stringify({ v: 0, pad: 'x'.repeat(200) })
    for (const sessionId of [openTab.sessionId, closedReverted, closedOther]) {
      const dir = join(storageRoot, 'changes', sessionId)
      await mkdir(dir, { recursive: true })
      await writeFile(join(dir, `${sessionId}.json`), payload, 'utf8')
    }

    const { prunedSessions } = await controller.pruneChangeSnapshots({
      byteBudgetSoft: 1,
    })
    expect(prunedSessions[0]).toBe(closedReverted)
    expect(prunedSessions).toContain(closedOther)
    expect(prunedSessions.indexOf(closedReverted)).toBeLessThan(prunedSessions.indexOf(closedOther))
    // Open unreverted is last victim (only when budget still exceeded).
    expect(prunedSessions.at(-1)).toBe(openTab.sessionId)
    await rm(root, { recursive: true, force: true })
  })

  it('AC-24: revert diagnostics must not log snapshot plaintext', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-ccd-p3-log-'))
    const workspace = join(root, 'ws')
    await mkdir(workspace, { recursive: true })
    const secret = 'PLAINTEXT_SNAPSHOT_BODY_MUST_NOT_LOG'
    const filePath = 's.ts'
    await writeFile(join(workspace, filePath), 'after\n', 'utf8')
    const { controller, tab } = await settleModified(
      root,
      workspace,
      filePath,
      secret,
      'after\n',
    )
    installFsWorkspace(controller, workspace)
    const rec = controller.changes.list(tab.sessionId)[0]!
    const result = await controller.revertChange(rec.changeId, { confirmGate: async () => true })
    expect(result.ok).toBe(true)
    // Message projection + result reason must not include oldText secret.
    const msgs = JSON.stringify(controller.messages.get(tab.sessionId))
    expect(msgs).not.toContain(secret)
    if (!result.ok) expect(result.reason).not.toContain(secret)
    const index = await readChangeIndex(join(root, 'storage'), tab.sessionId)
    expect(JSON.stringify(index)).not.toContain(secret)
    await rm(root, { recursive: true, force: true })
  })

  it('AC-25 smoke: protocol parse + UI contains mark-reviewed / revert controls', () => {
    expect(parseWebviewToHostMessage({ type: 'change/mark-reviewed', changeId: 'x' }))
      .toEqual({ type: 'change/mark-reviewed', changeId: 'x' })
    expect(parseWebviewToHostMessage({ type: 'change/revert', changeId: 'x' }))
      .toEqual({ type: 'change/revert', changeId: 'x' })
    expect(parseWebviewToHostMessage({ type: 'change/revert-many', changeIds: ['a', 'b'] }))
      .toEqual({ type: 'change/revert-many', changeIds: ['a', 'b'] })
    const html = buildThinChatHtml()
    expect(html).toContain('change/mark-reviewed')
    expect(html).toContain('change/revert')
    expect(html).toContain('change/revert-many')
    expect(CHANGE_STATUS_REVIEWED_LABEL).toBe('已审阅')
    expect(CHANGE_STATUS_REVERTED_LABEL).toBe('已撤销')
  })

  it('session delete clears ChangeStore + SnapshotStore (AD-CCD-6)', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-ccd-p3-del-sess-'))
    const workspace = join(root, 'ws')
    await mkdir(workspace, { recursive: true })
    const filePath = 'z.ts'
    await writeFile(join(workspace, filePath), 'after\n', 'utf8')
    const { controller, tab } = await settleModified(root, workspace, filePath, 'before\n', 'after\n')
    const rec = controller.changes.list(tab.sessionId)[0]!
    const blobPath = join(root, 'storage', 'changes', tab.sessionId, `${rec.snapshotRef}.json`)
    await stat(blobPath)

    const deleted = await controller.deleteConversation(tab.tabId, { confirmed: true })
    expect(deleted.outcome).toBe('deleted')
    expect(controller.changes.list(tab.sessionId)).toHaveLength(0)
    await expect(stat(blobPath)).rejects.toBeTruthy()
    await rm(root, { recursive: true, force: true })
  })

  it('Host mark-reviewed / revert routing', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-ccd-p3-host-'))
    const workspace = join(root, 'ws')
    await mkdir(workspace, { recursive: true })
    const filePath = 'h.ts'
    await writeFile(join(workspace, filePath), 'after\n', 'utf8')
    const { controller, tab } = await settleModified(root, workspace, filePath, 'before\n', 'after\n')
    installFsWorkspace(controller, workspace)
    const rec = controller.changes.list(tab.sessionId)[0]!
    const port = new FakeWebviewPort()
    const panel = new ChatPanelHost({
      registry: controller.registry,
      messages: controller.messages,
      isHostReady: () => true,
      acceptSend: async () => ({ messageId: 'm', sessionId: tab.sessionId, tabId: tab.tabId }),
      requestMarkReviewed: async (changeId) => {
        await controller.markChangeReviewed(changeId)
      },
      requestRevert: async (changeId) => {
        const result = await controller.revertChange(changeId, {
          confirmGate: async () => true,
        })
        return result.ok
          ? { changeId, ok: true }
          : { changeId, ok: false, reason: result.reason }
      },
    })
    panel.attach(port)
    port.emitFromWebview({ type: 'change/mark-reviewed', changeId: rec.changeId })
    await waitFor(() => controller.changes.getById(rec.changeId)?.status === 'reviewed', 1000)

    port.emitFromWebview({ type: 'change/revert', changeId: rec.changeId })
    await waitFor(() => port.receivedFromHost.some(m => m.type === 'change/revert-result'), 2000)
    const frame = port.receivedFromHost.find(m => m.type === 'change/revert-result') as {
      results: Array<{ ok: boolean }>
    }
    expect(frame.results[0]!.ok).toBe(true)
    expect(controller.changes.getById(rec.changeId)!.status).toBe('reverted')
    await rm(root, { recursive: true, force: true })
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
  host: ReturnType<typeof fakeHost>
}> {
  const settled = await settleTwoModified(root, workspace, [{ path: filePath, before, after }])
  return settled
}

async function settleTwoModified(
  root: string,
  workspace: string,
  filesSpec: Array<{ path: string; before: string; after: string }>,
): Promise<{
  controller: ConversationController
  tab: { sessionId: string; tabId: string }
  host: ReturnType<typeof fakeHost>
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
  return { controller, tab, host }
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

async function waitFor(predicate: () => boolean, timeoutMs: number): Promise<void> {
  const start = Date.now()
  while (!predicate()) {
    if (Date.now() - start > timeoutMs) throw new Error('waitFor timeout')
    await new Promise(r => setTimeout(r, 10))
  }
}
