/**
 * Extension-side revert write-back (AD-CCD-10 / AC-13…18).
 * Restores from SnapshotStore oldText; never invents pruned bodies.
 * @module @deepseek-ai/dsh-vscode-dsh/change/revert
 */

import type { ChangeStore } from './change-store.ts'
import { hashTextContent, type SnapshotStore } from './snapshot-store.ts'
import type { ChangeRecord } from './types.ts'

/** Confirm / conflict gates before any write (cancel = no disk mutation). */
export type RevertGate =
  | { kind: 'confirm-delete-created'; path: string; changeId: string }
  | { kind: 'confirm-restore-conflict'; path: string; changeId: string }
  | { kind: 'confirm-later-changes'; path: string; changeId: string; laterTurns: number[] }
  | { kind: 'confirm-dirty'; path: string; changeId: string }

/** Duck-typed workspace write surface (document layer when open, else fs). */
export interface RevertWorkspace {
  /**
   * Resolve workspace-relative path to absolute.
   * @param path - ChangeRecord.path.
   */
  resolveAbsolute(path: string): string | undefined
  /**
   * Read authoritative UTF-8 text (prefer open buffer, else disk).
   * @param absPath - absolute path.
   */
  readText(absPath: string): Promise<string | undefined>
  /**
   * Whether the path exists on disk (or as an open untitled — treat as exists).
   * @param absPath - absolute path.
   */
  exists(absPath: string): Promise<boolean>
  /**
   * Open document dirty / text probe for AC-17.
   * @param absPath - absolute path.
   */
  openDocument?(absPath: string): { getText(): string; isDirty: boolean } | undefined
  /**
   * Write text via open document when present, else workspace.fs (AD-CCD-10).
   * @param absPath - absolute path.
   * @param text - full-file restore image.
   */
  writeText(absPath: string, text: string): Promise<void>
  /**
   * Delete a file (created revert).
   * @param absPath - absolute path.
   */
  deleteFile(absPath: string): Promise<void>
}

/** Outcome of one revert attempt. */
export type RevertResult =
  | { ok: true; changeId: string }
  | { ok: false; changeId: string; reason: string; cancelled?: boolean }

/** Dependencies for analyze + execute. */
export interface RevertDeps {
  changeStore: ChangeStore
  snapshotStore: SnapshotStore
  workspace: RevertWorkspace
  /** Optional clock. */
  now?: () => number
}

/**
 * Find unreverted later-turn records for the same path (AD-CCD-10).
 * @param store - ChangeStore.
 * @param record - candidate being reverted.
 */
export function laterUnrevertedSamePath(
  store: ChangeStore,
  record: ChangeRecord,
): ChangeRecord[] {
  return store.list(record.sessionId).filter(r =>
    r.path === record.path
    && r.changeId !== record.changeId
    && r.turn > record.turn
    && r.status !== 'reverted',
  )
}

/**
 * Sort changeIds for batch revert: same path by turn descending (AD-CCD-10).
 * Different paths keep stable relative order by first occurrence.
 * @param store - ChangeStore.
 * @param changeIds - requested ids.
 */
export function orderChangeIdsForBatch(
  store: ChangeStore,
  changeIds: readonly string[],
): string[] {
  const records = changeIds
    .map(id => store.getById(id))
    .filter((r): r is ChangeRecord => r !== undefined)
  // Group by path; within path sort turn DESC; concatenate groups in first-seen path order.
  const pathOrder: string[] = []
  const byPath = new Map<string, ChangeRecord[]>()
  for (const rec of records) {
    let list = byPath.get(rec.path)
    if (list === undefined) {
      list = []
      byPath.set(rec.path, list)
      pathOrder.push(rec.path)
    }
    list.push(rec)
  }
  const ordered: string[] = []
  for (const path of pathOrder) {
    const list = byPath.get(path)!
    list.sort((a, b) => b.turn - a.turn)
    for (const rec of list) ordered.push(rec.changeId)
  }
  // Preserve unknown ids at the end (will fail in execute).
  for (const id of changeIds) {
    if (!ordered.includes(id)) ordered.push(id)
  }
  return ordered
}

/**
 * Collect gates that must be confirmed before writing (AC-14/15/17, AD-CCD-10).
 * Does not mutate disk.
 * @param deps - stores + workspace.
 * @param changeId - target record.
 */
export async function analyzeRevertGates(
  deps: RevertDeps,
  changeId: string,
): Promise<{ record: ChangeRecord; gates: RevertGate[] } | { error: string; changeId: string }> {
  const record = deps.changeStore.getById(changeId)
  if (record === undefined) return { error: 'change-not-found', changeId }
  if (record.status === 'reverted') return { error: 'already-reverted', changeId }

  const gates: RevertGate[] = []
  const later = laterUnrevertedSamePath(deps.changeStore, record)
  if (later.length > 0) {
    gates.push({
      kind: 'confirm-later-changes',
      path: record.path,
      changeId,
      laterTurns: later.map(r => r.turn).sort((a, b) => b - a),
    })
  }

  if (record.kind === 'created') {
    gates.push({ kind: 'confirm-delete-created', path: record.path, changeId })
  }

  const abs = deps.workspace.resolveAbsolute(record.path)
  if (abs === undefined) return { error: 'path-unresolved', changeId }

  if (record.kind === 'deleted') {
    if (await deps.workspace.exists(abs)) {
      gates.push({ kind: 'confirm-restore-conflict', path: record.path, changeId })
    }
  }

  // AC-17 / N-3: content hash vs after-image OR open doc isDirty (never mtime-only).
  if (record.kind !== 'deleted') {
    const open = deps.workspace.openDocument?.(abs)
    const current = open?.getText() ?? await deps.workspace.readText(abs)
    const isDirty = open?.isDirty === true
      || (current !== undefined && hashTextContent(current) !== record.afterContentHash)
    if (isDirty) {
      gates.push({ kind: 'confirm-dirty', path: record.path, changeId })
    }
  } else {
    // Deleted after-image is empty; dirty if path exists with content or open dirty buffer.
    const open = deps.workspace.openDocument?.(abs)
    if (open?.isDirty === true) {
      gates.push({ kind: 'confirm-dirty', path: record.path, changeId })
    }
  }

  return { record, gates }
}

/**
 * Execute a single revert after gates are confirmed (AC-13).
 * On failure, status stays unchanged.
 * @param deps - stores + workspace.
 * @param changeId - target record.
 * @param options - when skipWrite is true, only mark status (tests); default writes.
 */
export async function executeRevert(
  deps: RevertDeps,
  changeId: string,
  options: { skipWrite?: boolean } = {},
): Promise<RevertResult> {
  const record = deps.changeStore.getById(changeId)
  if (record === undefined) return { ok: false, changeId, reason: 'change-not-found' }
  if (record.status === 'reverted') return { ok: false, changeId, reason: 'already-reverted' }

  const abs = deps.workspace.resolveAbsolute(record.path)
  if (abs === undefined) return { ok: false, changeId, reason: 'path-unresolved' }

  if (options.skipWrite !== true) {
    try {
      if (record.kind === 'created') {
        await deps.workspace.deleteFile(abs)
      } else {
        if (record.snapshotRef === undefined) {
          return { ok: false, changeId, reason: 'snapshot-unavailable' }
        }
        const snap = await deps.snapshotStore.read(record.sessionId, record.snapshotRef)
        if (snap === undefined || snap.oldText === null) {
          // deleted/modified need oldText; missing blob → fail without inventing (AC-22/N-4).
          return { ok: false, changeId, reason: 'snapshot-unavailable' }
        }
        await deps.workspace.writeText(abs, snap.oldText)
      }
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error)
      // AC-24: never include snapshot plaintext in the reason surfaced to logs by callers.
      return { ok: false, changeId, reason: `write-failed:${sanitizeReason(reason)}` }
    }
  }

  const now = deps.now?.() ?? Date.now()
  deps.changeStore.upsert({
    ...record,
    status: 'reverted',
    updatedAt: now,
  })
  return { ok: true, changeId }
}

/**
 * Batch revert: order by AD-CCD-10, execute sequentially, per-file results (AC-18).
 * Gate confirmation is the caller's responsibility before each execute (or pre-confirm set).
 * @param deps - stores + workspace.
 * @param changeIds - requested ids.
 * @param options - confirmed gate keys + write control.
 */
export async function executeRevertMany(
  deps: RevertDeps,
  changeIds: readonly string[],
  options: {
    /** Gate keys already confirmed (`${kind}:${changeId}`). */
    confirmedGates: ReadonlySet<string>
    skipWrite?: boolean
    /**
     * Optional interactive confirm for remaining gates.
     * Return false to cancel that change (no write, status unchanged).
     */
    confirmGate?: (gate: RevertGate) => Promise<boolean>
  },
): Promise<RevertResult[]> {
  const ordered = orderChangeIdsForBatch(deps.changeStore, changeIds)
  const results: RevertResult[] = []
  for (const changeId of ordered) {
    const analyzed = await analyzeRevertGates(deps, changeId)
    if ('error' in analyzed) {
      results.push({ ok: false, changeId, reason: analyzed.error })
      continue
    }
    let cancelled = false
    for (const gate of analyzed.gates) {
      const key = gateKey(gate)
      if (options.confirmedGates.has(key)) continue
      if (options.confirmGate !== undefined) {
        const ok = await options.confirmGate(gate)
        if (!ok) {
          cancelled = true
          break
        }
        continue
      }
      cancelled = true
      break
    }
    if (cancelled) {
      results.push({ ok: false, changeId, reason: 'cancelled', cancelled: true })
      continue
    }
    results.push(await executeRevert(deps, changeId, {
      ...(options.skipWrite === undefined ? {} : { skipWrite: options.skipWrite }),
    }))
  }
  return results
}

/**
 * Stable gate key for confirmed-set membership.
 * @param gate - revert gate.
 */
export function gateKey(gate: RevertGate): string {
  return `${gate.kind}:${gate.changeId}`
}

/** Max length for freeform write diagnostics before we drop to a metadata code. */
const MAX_FREEFORM_REASON_LEN = 80

/**
 * Sanitize write-failure reasons so file body fragments never leak (AC-24).
 * Prefer short metadata codes: strip non-printable, collapse whitespace, and
 * reject long / content-like freeform instead of truncating with a content prefix.
 * @param reason - raw Error.message or String(error).
 */
export function sanitizeReason(reason: string): string {
  const cleaned = reason
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '')
    .replace(/\s+/g, ' ')
    .trim()

  if (cleaned.length === 0) return 'unknown'

  // Short opaque codes (kebab / errno-ish) pass through unchanged.
  if (/^[A-Za-z][A-Za-z0-9._:-]{0,63}$/.test(cleaned)) {
    return cleaned.slice(0, 64)
  }

  // Long freeform or content-like text → never surface verbatim body fragments.
  if (cleaned.length > MAX_FREEFORM_REASON_LEN || looksLikeFileContent(cleaned)) {
    return 'io-error'
  }

  return cleaned
}

/**
 * Heuristic: prose / source-body fragments must not appear in failure reasons.
 * @param s - already whitespace-collapsed candidate.
 */
function looksLikeFileContent(s: string): boolean {
  const spaces = (s.match(/ /g) ?? []).length
  if (spaces >= 4) return true
  if (/[{};]|function |const |class |import /.test(s)) return true
  return false
}
