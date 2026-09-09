/**
 * Phase-0 Spike Gate — attribution via meta.diffs + SnapshotStore dry-run
 * (AC-S1 / AC-S2 / AC-S3). Keyless vitest; no product ChangeList UI.
 */

import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { HarnessNotification } from '@deepseek-ai/dsh-sdk-client'
import { TimelineStore } from '../src/timeline-store.ts'
import {
  SNAPSHOT_STORE_SPIKE,
  attributionCandidatesFromMeta,
  attributionPathsForLatestTurn,
  dryRunSnapshotStore,
  simulateUserManualSave,
  snapshotBlobPath,
  snapshotSessionDir,
} from './spike-attribution-helpers.ts'

const dirs: string[] = []

afterEach(async () => {
  while (dirs.length > 0) {
    await rm(dirs.pop()!, { recursive: true, force: true })
  }
})

describe('Spike phase-0 — AC-S1 attribution via meta.diffs', () => {
  it('inject recoverable meta.diffs → attribution candidates non-empty', () => {
    const store = new TimelineStore()
    const sessionId = 'spike-sess-attr'
    store.apply(event(sessionId, 'turn/start', { turn: 0 }))
    store.apply(event(sessionId, 'tool/result', {
      turn: 0,
      message: { callId: 'c-edit', name: 'edit', content: [] },
      meta: {
        diffs: [
          { path: 'src/dsh-edit.ts', oldText: 'a\n', newText: 'b\n' },
        ],
      },
    }))

    const fromMeta = attributionCandidatesFromMeta({
      diffs: [{ path: 'src/dsh-edit.ts', oldText: 'a\n', newText: 'b\n' }],
    })
    expect(fromMeta).toEqual([{
      path: 'src/dsh-edit.ts',
      oldText: 'a\n',
      newText: 'b\n',
      source: 'meta.diffs',
    }])
    expect(attributionPathsForLatestTurn(store, sessionId)).toEqual(['src/dsh-edit.ts'])
  })

  it('write-create style empty diffs → not attributed (GAP-010 / 宁可漏记)', () => {
    const store = new TimelineStore()
    const sessionId = 'spike-sess-create'
    store.apply(event(sessionId, 'turn/start', { turn: 0 }))
    store.apply(event(sessionId, 'tool/result', {
      turn: 0,
      message: { callId: 'c-write', name: 'write', content: [] },
      meta: { diffs: [] },
    }))
    expect(attributionCandidatesFromMeta({ diffs: [] })).toEqual([])
    expect(attributionPathsForLatestTurn(store, sessionId)).toEqual([])
  })

  it('patch-only / missing oldText → reject (not attributed)', () => {
    expect(attributionCandidatesFromMeta({
      diffs: [{ path: 'x.ts', patch: '@@' }],
    })).toEqual([])
    expect(attributionCandidatesFromMeta({
      diffs: [{ path: 'x.ts', newText: 'only' }],
    })).toEqual([])
  })

  it('helpers do not import vscode workspace watch/save APIs for intake', async () => {
    // Guard: Spike helpers must not wire VS Code workspace watch/save APIs.
    const helpersSrc = await import('node:fs/promises').then(fs =>
      fs.readFile(new URL('./spike-attribution-helpers.ts', import.meta.url), 'utf8'),
    )
    expect(helpersSrc).not.toMatch(/from ['"]vscode['"]/)
    expect(helpersSrc).not.toMatch(/workspace\.createFileSystemWatcher/)
    expect(helpersSrc).not.toMatch(/onDidSaveTextDocument/)
  })
})

describe('Spike phase-0 — AC-S2 SnapshotStore dry-run', () => {
  it('write/read/delete blob under changes/<sessionId>/ without touching authority log', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-spike-snap-'))
    dirs.push(root)
    const storageRoot = join(root, 'workspaceStorage')
    const authorityLog = join(root, '.dsh', 'sessions', 'auth.jsonl')
    await mkdir(join(root, '.dsh', 'sessions'), { recursive: true })
    await writeFile(authorityLog, '{"v":1,"kind":"session-log-marker"}\n', 'utf8')

    const sessionId = 'sess-snap-1'
    const snapshotRef = 'ref-abc'
    const expectedPath = snapshotBlobPath(storageRoot, sessionId, snapshotRef)
    expect(expectedPath).toBe(
      join(storageRoot, 'changes', sessionId, `${snapshotRef}.json`),
    )
    expect(snapshotSessionDir(storageRoot, sessionId)).toContain(
      join(...SNAPSHOT_STORE_SPIKE.relativeRootSegments, sessionId),
    )

    const result = await dryRunSnapshotStore(
      storageRoot,
      {
        v: 0,
        sessionId,
        snapshotRef,
        path: 'notes.txt',
        oldText: 'before\n',
        newText: 'after\n',
      },
      authorityLog,
    )

    expect(result.readOk).toBe(true)
    expect(result.deleted).toBe(true)
    expect(result.bytesWritten).toBeGreaterThan(0)
    expect(result.bytesWritten).toBeLessThanOrEqual(SNAPSHOT_STORE_SPIKE.perBlobSoftCap)
    expect(result.touchedAuthorityLog).toBe(false)
    expect(result.blobPath.startsWith(join(storageRoot, 'changes'))).toBe(true)
    expect(result.blobPath.includes('.dsh/sessions')).toBe(false)

    // Metadata-only assertion surface (no plaintext in return value beyond path keys).
    expect(Object.keys(result).sort()).toEqual([
      'blobPath',
      'bytesWritten',
      'deleted',
      'readOk',
      'touchedAuthorityLog',
    ].sort())
  })

  it('documents association keys + prune policy constants', () => {
    expect(SNAPSHOT_STORE_SPIKE.associationKeys).toEqual([
      'sessionId',
      'snapshotRef',
      'sourceMessageId',
      'turn',
    ])
    expect(SNAPSHOT_STORE_SPIKE.byteBudgetSoft).toBe(200 * 1024 * 1024)
    expect(SNAPSHOT_STORE_SPIKE.prunePolicy).toBe('lru-reverted-first-then-oldest-session')
  })
})

describe('Spike phase-0 — AC-S3 false-positive negation (user manual save)', () => {
  it('user manual save near DSH turn window MUST NOT be labeled DSH change', () => {
    const store = new TimelineStore()
    const sessionId = 'spike-sess-fp'
    const dshPath = 'src/dsh-owned.ts'
    const userPath = 'src/user-manual.ts'

    store.apply(event(sessionId, 'turn/start', { turn: 0 }))
    store.apply(event(sessionId, 'tool/result', {
      turn: 0,
      message: { callId: 'c1', name: 'edit', content: [] },
      meta: {
        diffs: [{ path: dshPath, oldText: 'old\n', newText: 'new\n' }],
      },
    }))

    // Set A: DSH inject → attributed
    const setA = new Set(attributionPathsForLatestTurn(store, sessionId))
    expect(setA.has(dshPath)).toBe(true)

    // Set B: user save / format of userPath without meta.diffs (no watch/save intake)
    const save = simulateUserManualSave(userPath)
    expect(save.emittedMetaDiffs).toBe(false)
    // No additional session.event applied — attribution set unchanged
    const setB = new Set(attributionPathsForLatestTurn(store, sessionId))
    expect(setB.has(userPath)).toBe(false)
    expect(setB.has(dshPath)).toBe(true)
    expect([...setB]).toEqual([dshPath])
  })
})

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
