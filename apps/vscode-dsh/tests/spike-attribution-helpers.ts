/**
 * Phase-0 Spike helpers (vscode-dsh-code-context-diff): attribution candidates
 * from recoverable `tool/result.meta.diffs`, plus SnapshotStore dry-run under
 * extension-local storage. Not product ChangeList / ChangeStore UI.
 *
 * @module apps/vscode-dsh/tests/spike-attribution-helpers
 */

import { mkdir, readFile, rm, writeFile, stat } from 'node:fs/promises'
import { join } from 'node:path'
import type { TimelineDiffHunk, TimelineStore } from '../src/timeline-store.ts'
import { recoverableDiffsFromMeta } from '../src/replay-hydrator.ts'

/** One attributed path candidate inside a turn window (Spike Gate). */
export interface AttributionCandidate {
  path: string
  oldText: string | null
  newText: string
  source: 'meta.diffs'
}

/**
 * Narrow opaque tool meta to attribution candidates (AD-CCD-1 / AD-CU-6).
 * Empty or non-recoverable diffs yield no candidates — 宁可漏记.
 * @param meta - `tool/result` meta payload.
 */
export function attributionCandidatesFromMeta(meta: unknown): AttributionCandidate[] {
  return recoverableDiffsFromMeta(meta).map(hunk => ({
    path: hunk.path,
    oldText: hunk.oldText,
    newText: hunk.newText,
    source: 'meta.diffs' as const,
  }))
}

/**
 * Collect unique attribution paths for the latest turn via TimelineStore
 * (same window as AC-30 `changedFilesForLatestTurn`).
 * @param store - live TimelineStore after session.event applies.
 * @param sessionId - root session id.
 */
export function attributionPathsForLatestTurn(
  store: TimelineStore,
  sessionId: string,
): string[] {
  return store.changedFilesForLatestTurn(sessionId)
}

/**
 * Collect recoverable hunks from the latest turn window (tree-local items).
 * @param store - TimelineStore.
 * @param sessionId - session id.
 */
export function attributionHunksForLatestTurn(
  store: TimelineStore,
  sessionId: string,
): TimelineDiffHunk[] {
  const paths = new Set(store.changedFilesForLatestTurn(sessionId))
  const hunks = store.writeDiffsForSession(sessionId)
  return hunks.filter(h => paths.has(h.path))
}

/**
 * Simulate a user manual save / format near a DSH turn: **no** `meta.diffs`
 * event and **no** workspace-wide save/watch intake (AD-CCD-1 forbid).
 * Returns the path that must remain unattributed.
 * @param path - workspace path the user saved.
 */
export function simulateUserManualSave(path: string): { savedPath: string; emittedMetaDiffs: false } {
  return { savedPath: path, emittedMetaDiffs: false }
}

/** Locked Spike constants for SnapshotStore (AC-S2 / AD-CCD-6 / N-4). */
export const SNAPSHOT_STORE_SPIKE = {
  /** Relative segments under workspace `storageUri` (preferred) or `globalStorageUri`. */
  relativeRootSegments: ['changes'] as const,
  /**
   * Association keys:
   * - sessionId: SDK session identity
   * - snapshotRef: opaque id for one ChangeRecord blob (phase-2 mints)
   * - sourceMessageId: projected assistant message id (live UUID; replay prefers SDK id)
   * - turn: top-level turn number from turn/start…turn/end
   */
  associationKeys: ['sessionId', 'snapshotRef', 'sourceMessageId', 'turn'] as const,
  /** Soft byte budget for all blobs under one extension storage root. */
  byteBudgetSoft: 200 * 1024 * 1024,
  /** Hard cap per individual blob (align AD-CCD-8 1 MiB text default with headroom). */
  perBlobSoftCap: 2 * 1024 * 1024,
  /** Prune order: reverted blobs first, then oldest session directory. */
  prunePolicy: 'lru-reverted-first-then-oldest-session' as const,
} as const

/**
 * Resolve SnapshotStore directory for one session (does not create).
 * @param storageRoot - absolute path of `context.storageUri.fsPath` (or global + workspaceKey).
 * @param sessionId - SDK session id.
 */
export function snapshotSessionDir(storageRoot: string, sessionId: string): string {
  return join(storageRoot, ...SNAPSHOT_STORE_SPIKE.relativeRootSegments, sessionId)
}

/**
 * Resolve one snapshot blob path.
 * @param storageRoot - extension storage root.
 * @param sessionId - session id.
 * @param snapshotRef - blob id.
 */
export function snapshotBlobPath(
  storageRoot: string,
  sessionId: string,
  snapshotRef: string,
): string {
  return join(snapshotSessionDir(storageRoot, sessionId), `${snapshotRef}.json`)
}

/** On-disk blob shape (Spike dry-run; phase-2 owns product schema). */
export interface SnapshotBlobV0 {
  v: 0
  sessionId: string
  snapshotRef: string
  path: string
  /** Full-file or hunk-local images — Spike stores whatever was attributed. */
  oldText: string | null
  newText: string
}

/**
 * Write → read → delete one snapshot blob under extension-local storage.
 * Probe logs must never print plaintext; returns metadata only.
 * @param storageRoot - absolute storage root (temp dir in tests).
 * @param blob - snapshot payload.
 * @param authoritySessionLogPath - optional path that must remain untouched.
 */
export async function dryRunSnapshotStore(
  storageRoot: string,
  blob: SnapshotBlobV0,
  authoritySessionLogPath?: string,
): Promise<{
  blobPath: string
  bytesWritten: number
  readOk: boolean
  deleted: boolean
  touchedAuthorityLog: boolean
}> {
  const dir = snapshotSessionDir(storageRoot, blob.sessionId)
  await mkdir(dir, { recursive: true })
  const blobPath = snapshotBlobPath(storageRoot, blob.sessionId, blob.snapshotRef)
  const payload = JSON.stringify(blob)
  let authorityBefore: { mtimeMs: number; size: number } | undefined
  if (authoritySessionLogPath !== undefined) {
    try {
      const s = await stat(authoritySessionLogPath)
      authorityBefore = { mtimeMs: s.mtimeMs, size: s.size }
    } catch {
      authorityBefore = undefined
    }
  }
  await writeFile(blobPath, payload, 'utf8')
  const bytesWritten = Buffer.byteLength(payload, 'utf8')
  const roundTrip = JSON.parse(await readFile(blobPath, 'utf8')) as SnapshotBlobV0
  const readOk =
    roundTrip.sessionId === blob.sessionId
    && roundTrip.snapshotRef === blob.snapshotRef
    && roundTrip.path === blob.path
    && roundTrip.oldText === blob.oldText
    && roundTrip.newText === blob.newText
  await rm(blobPath, { force: true })
  let touchedAuthorityLog = false
  if (authoritySessionLogPath !== undefined && authorityBefore !== undefined) {
    const s = await stat(authoritySessionLogPath)
    touchedAuthorityLog = s.mtimeMs !== authorityBefore.mtimeMs || s.size !== authorityBefore.size
  }
  return {
    blobPath,
    bytesWritten,
    readOk,
    deleted: true,
    touchedAuthorityLog,
  }
}
