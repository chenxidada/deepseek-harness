/**
 * ChangeAttributor: meta.diffs intake + full-file SnapshotStore capture (AD-CCD-1/5/8).
 *
 * Product policy (phase-2 / 宁可漏记):
 * - Attribute only recoverable `tool/result.meta.diffs` inside a top-level turn.
 * - create / identical write (`diffs: []`) and str_replace_editor (no presentationMeta)
 *   are permanent misses — never watcher intake (GAP-CCD-010 / GAP-CCD-011).
 * - meta.diffs are DIFF_CONTEXT hunks (signal + path set); blobs store full-file
 *   before/after via tool/call-bound before-cache + workspace after-read (DEBT-CCD-001).
 *   When before-cache misses, settle omits the blob (available=false) — never writes
 *   hunk firstOld as SnapshotStore oldText.
 *
 * @module @deepseek-ai/dsh-vscode-dsh/change/change-attributor
 */

import { randomUUID } from 'node:crypto'
import { recoverableDiffsFromMeta } from '../replay-hydrator.ts'
import { shouldIgnoreChangePath, type IgnoreRulesOptions } from './change-ignore.ts'
import type { ChangeStore } from './change-store.ts'
import { hashTextContent, type SnapshotStore } from './snapshot-store.ts'
import type { AttributionHunk, ChangeKind, ChangeRecord } from './types.ts'

/** Pending same-path merge buffer for one turn. */
interface PathMergeState {
  firstOld: string | null
  lastNew: string
}

/** Dependencies for full-file capture without authority-log plaintext. */
export interface ChangeAttributorDeps {
  changeStore: ChangeStore
  snapshotStore: SnapshotStore
  /** Workspace roots for AD-CCD-8 outside-workspace checks. */
  getIgnoreOptions: () => IgnoreRulesOptions
  /**
   * Read current workspace UTF-8 text for a path (after-image).
   * Returns undefined when missing / unreadable / binary.
   */
  readWorkspaceText: (path: string) => Promise<string | undefined>
  /** Optional clock for tests. */
  now?: () => number
}

/**
 * Live attribution pipeline bound to one ConversationController.
 */
export class ChangeAttributor {
  /** sessionId → path → before text captured at tool/call. */
  private readonly beforeCache = new Map<string, Map<string, string | null>>()
  /** sessionId → turn → path → merge state from meta.diffs. */
  private readonly pending = new Map<string, Map<number, Map<string, PathMergeState>>>()
  /** sessionId → last assistant message id in the open turn. */
  private readonly lastAssistantId = new Map<string, string>()
  /** sessionId → latest turn number seen. */
  private readonly latestTurn = new Map<string, number>()
  /** sessionId → turns already settled (avoid duplicate lists). */
  private readonly settledTurns = new Map<string, Set<number>>()

  /**
   * @param deps - stores + workspace readers.
   */
  constructor(private readonly deps: ChangeAttributorDeps) {}

  /**
   * Capture before-image at tool/call boundary (controlled; not a bare watcher).
   * @param sessionId - session id.
   * @param argsJson - tool arguments JSON (file_path / path).
   */
  async noteToolCall(sessionId: string, argsJson: string | undefined): Promise<void> {
    const path = filePathFromArgs(argsJson)
    if (path === undefined) return
    const ignore = this.deps.getIgnoreOptions()
    if (shouldIgnoreChangePath(path, ignore)) return
    const existing = await this.deps.readWorkspaceText(path)
    let map = this.beforeCache.get(sessionId)
    if (map === undefined) {
      map = new Map()
      this.beforeCache.set(sessionId, map)
    }
    // null = file did not exist before call (create candidate); still only attributed
    // when meta.diffs later recover — create with empty diffs remains a documented miss.
    map.set(path, existing === undefined ? null : existing)
  }

  /**
   * Ingest recoverable meta.diffs from a tool/result (signal only).
   * @param sessionId - session id.
   * @param turn - top-level turn number.
   * @param meta - tool/result meta payload.
   */
  ingestToolResult(sessionId: string, turn: number, meta: unknown): void {
    this.latestTurn.set(sessionId, turn)
    const hunks = recoverableDiffsFromMeta(meta) as AttributionHunk[]
    if (hunks.length === 0) return
    const ignore = this.deps.getIgnoreOptions()
    let turnMap = this.pending.get(sessionId)
    if (turnMap === undefined) {
      turnMap = new Map()
      this.pending.set(sessionId, turnMap)
    }
    let pathMap = turnMap.get(turn)
    if (pathMap === undefined) {
      pathMap = new Map()
      turnMap.set(turn, pathMap)
    }
    for (const hunk of hunks) {
      if (shouldIgnoreChangePath(hunk.path, ignore, hunk.newText)) continue
      if (shouldIgnoreChangePath(hunk.path, ignore, hunk.oldText)) continue
      const prev = pathMap.get(hunk.path)
      if (prev === undefined) {
        pathMap.set(hunk.path, { firstOld: hunk.oldText, lastNew: hunk.newText })
      } else {
        pathMap.set(hunk.path, { firstOld: prev.firstOld, lastNew: hunk.newText })
      }
    }
  }

  /**
   * Remember the latest assistant projection id for N-2 anchoring.
   * @param sessionId - session id.
   * @param messageId - Host-projected assistant id.
   * @param turn - optional turn index.
   */
  noteAssistant(sessionId: string, messageId: string, turn?: number): void {
    this.lastAssistantId.set(sessionId, messageId)
    if (turn !== undefined) this.latestTurn.set(sessionId, turn)
  }

  /**
   * Whether a turn already has a settled change-list.
   * @param sessionId - session id.
   * @param turn - turn number.
   */
  isSettled(sessionId: string, turn: number): boolean {
    return this.settledTurns.get(sessionId)?.has(turn) === true
  }

  /**
   * Clear settled marker so a later assistant in the same turn can re-anchor (N-2 last).
   * @param sessionId - session id.
   * @param turn - turn number.
   */
  clearSettled(sessionId: string, turn: number): void {
    this.settledTurns.get(sessionId)?.delete(turn)
  }

  /**
   * Materialize ChangeRecords + SnapshotStore blobs for a turn and return the list payload.
   * @param sessionId - session id.
   * @param sourceMessageId - last assistant message id (N-2).
   * @param turn - turn number.
   */
  async settleTurn(
    sessionId: string,
    sourceMessageId: string,
    turn: number,
  ): Promise<{ changeCount: number; records: readonly ChangeRecord[] }> {
    const pathMap = this.pending.get(sessionId)?.get(turn) ?? new Map<string, PathMergeState>()
    const now = this.deps.now?.() ?? Date.now()
    const ignore = this.deps.getIgnoreOptions()
    const beforeMap = this.beforeCache.get(sessionId)
    const records: ChangeRecord[] = []

    // N-2 re-anchor: pending already flushed on first settle — update sourceMessageId only.
    if (pathMap.size === 0) {
      const existing = this.deps.changeStore.listForTurn(sessionId, turn)
      for (const rec of existing) {
        if (rec.sourceMessageId === sourceMessageId) {
          records.push(rec)
          continue
        }
        const updated: ChangeRecord = {
          ...rec,
          sourceMessageId,
          updatedAt: now,
        }
        this.deps.changeStore.upsert(updated)
        records.push(updated)
      }
      let settledEmpty = this.settledTurns.get(sessionId)
      if (settledEmpty === undefined) {
        settledEmpty = new Set()
        this.settledTurns.set(sessionId, settledEmpty)
      }
      settledEmpty.add(turn)
      return { changeCount: records.length, records }
    }

    for (const [path, merge] of pathMap) {
      const afterFromDisk = await this.deps.readWorkspaceText(path)
      // Prefer workspace after-image; fall back to last hunk newText only when disk unavailable (L2).
      const newText = afterFromDisk ?? merge.lastNew
      const cachedBefore = beforeMap?.get(path)
      // Full-file before only: tool/call cache, or null create when hunk firstOld is null.
      // Never write DIFF_CONTEXT hunk firstOld as SnapshotStore oldText (A.2 / DEBT-001).
      let oldText: string | null | undefined
      if (cachedBefore !== undefined) oldText = cachedBefore
      else if (merge.firstOld === null) oldText = null
      else oldText = undefined

      if (shouldIgnoreChangePath(path, ignore, newText)) continue
      if (oldText !== null && oldText !== undefined && shouldIgnoreChangePath(path, ignore, oldText)) {
        continue
      }

      // Display kind/stats: use full-file when available; else hunk signal (metadata only).
      const kindOld = oldText !== undefined ? oldText : merge.firstOld
      const kind = classifyKind(kindOld, newText)
      const { additions, deletions } = countLineDelta(kindOld, newText)

      let snapshotRef: string | undefined
      if (oldText !== undefined) {
        const written = await this.deps.snapshotStore.write({
          sessionId,
          sourceMessageId,
          turn,
          path,
          oldText,
          newText,
        })
        snapshotRef = 'refused' in written ? undefined : written.snapshotRef
      }
      const changeId = randomUUID()
      const record: ChangeRecord = {
        changeId,
        sessionId,
        turn,
        sourceMessageId,
        path,
        kind,
        status: 'unreviewed',
        additions,
        deletions,
        createdAt: now,
        updatedAt: now,
        ...snapshotRef === undefined ? {} : { snapshotRef },
        afterContentHash: hashTextContent(newText),
      }
      this.deps.changeStore.upsert(record)
      records.push(record)
      beforeMap?.delete(path)
    }

    this.pending.get(sessionId)?.delete(turn)
    let settled = this.settledTurns.get(sessionId)
    if (settled === undefined) {
      settled = new Set()
      this.settledTurns.set(sessionId, settled)
    }
    settled.add(turn)

    return { changeCount: records.length, records }
  }

  /**
   * Drop session state (Tab close / delete).
   * @param sessionId - session id.
   */
  clearSession(sessionId: string): void {
    this.beforeCache.delete(sessionId)
    this.pending.delete(sessionId)
    this.lastAssistantId.delete(sessionId)
    this.latestTurn.delete(sessionId)
    this.settledTurns.delete(sessionId)
    this.deps.changeStore.clearSession(sessionId)
  }

  /** Last noted assistant id for a session. */
  getLastAssistantId(sessionId: string): string | undefined {
    return this.lastAssistantId.get(sessionId)
  }

  /** Latest turn number observed. */
  getLatestTurn(sessionId: string): number | undefined {
    return this.latestTurn.get(sessionId)
  }

  /**
   * L2 helper: seed a full-file before cache without a tool/call event.
   * @param sessionId - session id.
   * @param path - workspace path.
   * @param before - full-file before text (null = missing).
   */
  seedBeforeCache(sessionId: string, path: string, before: string | null): void {
    let map = this.beforeCache.get(sessionId)
    if (map === undefined) {
      map = new Map()
      this.beforeCache.set(sessionId, map)
    }
    map.set(path, before)
  }
}

function classifyKind(oldText: string | null, newText: string): ChangeKind {
  if (oldText === null) return 'created'
  if (newText === '') return 'deleted'
  return 'modified'
}

function countLineDelta(oldText: string | null, newText: string): { additions: number; deletions: number } {
  const oldLines = oldText === null ? [] : oldText.split('\n')
  const newLines = newText.split('\n')
  // Lightweight line-count delta (display stats; not a full LCS diff).
  const deletions = Math.max(0, oldLines.length - newLines.length)
  const additions = Math.max(0, newLines.length - oldLines.length)
  if (oldText !== null && oldText !== newText && additions === 0 && deletions === 0) {
    return { additions: 1, deletions: 1 }
  }
  return { additions, deletions }
}

function filePathFromArgs(argumentsJson: string | undefined): string | undefined {
  if (argumentsJson === undefined || argumentsJson === '') return undefined
  let parsed: unknown
  try {
    parsed = JSON.parse(argumentsJson)
  } catch {
    return undefined
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return undefined
  const record = parsed as Record<string, unknown>
  const path = record.file_path ?? record.path
  return typeof path === 'string' && path !== '' ? path : undefined
}
