/**
 * Verifier-owned independent scenarios for phase-0 Spike Gate.
 * Does NOT duplicate implementer happy-paths; focuses on:
 * - multi-path / oldText:null attribution
 * - disk-confirmed snapshot delete + session isolation
 * - parameter-variation stub probe on attributionCandidatesFromMeta
 * - format-equivalent false-positive (AC-S3 sibling)
 * - authority log absent edge
 */

import { access, mkdir, mkdtemp, readFile, rm, writeFile, constants as fsConstants } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { HarnessNotification } from '@deepseek-ai/dsh-sdk-client'
import { TimelineStore } from '../../../../../../apps/vscode-dsh/src/timeline-store.ts'
import {
  SNAPSHOT_STORE_SPIKE,
  attributionCandidatesFromMeta,
  attributionPathsForLatestTurn,
  dryRunSnapshotStore,
  simulateUserManualSave,
  snapshotBlobPath,
} from '../../../../../../apps/vscode-dsh/tests/spike-attribution-helpers.ts'

const dirs: string[] = []

afterEach(async () => {
  while (dirs.length > 0) {
    await rm(dirs.pop()!, { recursive: true, force: true })
  }
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

describe('Verifier independent — AC-S1 attribution edges', () => {
  it('multi-path recoverable meta in one turn → both paths attributed', () => {
    const store = new TimelineStore()
    const sessionId = 'ver-multi'
    store.apply(event(sessionId, 'turn/start', { turn: 1 }))
    store.apply(event(sessionId, 'tool/result', {
      turn: 1,
      message: { callId: 'c-multi', name: 'edit', content: [] },
      meta: {
        diffs: [
          { path: 'a.ts', oldText: '1\n', newText: '2\n' },
          { path: 'b.ts', oldText: 'x\n', newText: 'y\n' },
        ],
      },
    }))
    const paths = attributionPathsForLatestTurn(store, sessionId).sort()
    expect(paths).toEqual(['a.ts', 'b.ts'])
  })

  it('oldText:null recoverable hunk → attributed (AD-CU-6)', () => {
    const candidates = attributionCandidatesFromMeta({
      diffs: [{ path: 'new-file.ts', oldText: null, newText: 'created\n' }],
    })
    expect(candidates).toEqual([{
      path: 'new-file.ts',
      oldText: null,
      newText: 'created\n',
      source: 'meta.diffs',
    }])

    const store = new TimelineStore()
    const sessionId = 'ver-null-old'
    store.apply(event(sessionId, 'turn/start', { turn: 0 }))
    store.apply(event(sessionId, 'tool/result', {
      turn: 0,
      message: { callId: 'c-null', name: 'write', content: [] },
      meta: { diffs: [{ path: 'new-file.ts', oldText: null, newText: 'created\n' }] },
    }))
    expect(attributionPathsForLatestTurn(store, sessionId)).toEqual(['new-file.ts'])
  })

  it('parameter variation: different meta inputs yield different outputs (not a stub)', () => {
    const empty = attributionCandidatesFromMeta({ diffs: [] })
    const one = attributionCandidatesFromMeta({
      diffs: [{ path: 'p1.ts', oldText: 'a', newText: 'b' }],
    })
    const two = attributionCandidatesFromMeta({
      diffs: [
        { path: 'p1.ts', oldText: 'a', newText: 'b' },
        { path: 'p2.ts', oldText: 'c', newText: 'd' },
      ],
    })
    const reject = attributionCandidatesFromMeta({
      diffs: [{ path: 'bad.ts', newText: 'only' }],
    })
    expect(empty).toEqual([])
    expect(one.map(c => c.path)).toEqual(['p1.ts'])
    expect(two.map(c => c.path).sort()).toEqual(['p1.ts', 'p2.ts'])
    expect(reject).toEqual([])
    expect(JSON.stringify(empty) === JSON.stringify(one)).toBe(false)
    expect(JSON.stringify(one) === JSON.stringify(two)).toBe(false)
  })
})

describe('Verifier independent — AC-S2 SnapshotStore edges', () => {
  it('dry-run deletes blob on disk and isolates sessions', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-ver-snap-'))
    dirs.push(root)
    const storageRoot = join(root, 'workspaceStorage')

    const blobA = {
      v: 0 as const,
      sessionId: 'sess-A',
      snapshotRef: 'ref-A',
      path: 'a.txt',
      oldText: 'old-A',
      newText: 'new-A',
    }
    const pathA = snapshotBlobPath(storageRoot, blobA.sessionId, blobA.snapshotRef)
    const pathBSibling = snapshotBlobPath(storageRoot, 'sess-B', 'ref-B')

    const result = await dryRunSnapshotStore(storageRoot, blobA)
    expect(result.readOk).toBe(true)
    expect(result.deleted).toBe(true)
    expect(result.blobPath).toBe(pathA)
    expect(result.bytesWritten).toBeLessThanOrEqual(SNAPSHOT_STORE_SPIKE.perBlobSoftCap)

    await expect(access(pathA, fsConstants.F_OK)).rejects.toThrow()
    expect(pathA.includes(join('changes', 'sess-A'))).toBe(true)
    expect(pathA.includes(join('changes', 'sess-B'))).toBe(false)
    expect(pathBSibling).not.toBe(pathA)
  })

  it('missing authority log path → touchedAuthorityLog stays false (no false positive)', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-ver-auth-miss-'))
    dirs.push(root)
    const storageRoot = join(root, 'workspaceStorage')
    const missingAuthority = join(root, '.dsh', 'sessions', 'missing.jsonl')

    const result = await dryRunSnapshotStore(
      storageRoot,
      {
        v: 0,
        sessionId: 'sess-miss',
        snapshotRef: 'r1',
        path: 'x.txt',
        oldText: null,
        newText: 'n',
      },
      missingAuthority,
    )
    expect(result.touchedAuthorityLog).toBe(false)
    expect(result.readOk).toBe(true)
  })

  it('existing authority marker bytes unchanged after dry-run', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-ver-auth-'))
    dirs.push(root)
    const storageRoot = join(root, 'workspaceStorage')
    const authorityLog = join(root, '.dsh', 'sessions', 'auth.jsonl')
    await mkdir(join(root, '.dsh', 'sessions'), { recursive: true })
    const marker = '{"v":1,"kind":"verifier-authority-marker"}\n'
    await writeFile(authorityLog, marker, 'utf8')

    await dryRunSnapshotStore(
      storageRoot,
      {
        v: 0,
        sessionId: 'sess-auth',
        snapshotRef: 'r2',
        path: 'y.txt',
        oldText: 'o',
        newText: 'n',
      },
      authorityLog,
    )

    const after = await readFile(authorityLog, 'utf8')
    expect(after).toBe(marker)
  })
})

describe('Verifier independent — AC-S3 format-equivalent false positive', () => {
  it('format-equivalent save of second path MUST NOT enter attribution set', () => {
    const store = new TimelineStore()
    const sessionId = 'ver-fp-format'
    const dshPath = 'lib/owned.ts'
    const formatPath = 'lib/formatted.ts'

    store.apply(event(sessionId, 'turn/start', { turn: 2 }))
    store.apply(event(sessionId, 'tool/result', {
      turn: 2,
      message: { callId: 'c-fmt', name: 'edit', content: [] },
      meta: {
        diffs: [{ path: dshPath, oldText: 'raw\n', newText: 'edited\n' }],
      },
    }))

    const before = attributionPathsForLatestTurn(store, sessionId)
    expect(before).toEqual([dshPath])

    const save = simulateUserManualSave(formatPath)
    expect(save.emittedMetaDiffs).toBe(false)
    expect(save.savedPath).toBe(formatPath)

    const after = attributionPathsForLatestTurn(store, sessionId)
    expect(after).toEqual([dshPath])
    expect(after.includes(formatPath)).toBe(false)
  })
})
