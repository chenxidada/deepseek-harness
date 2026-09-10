/**
 * Extension-local SnapshotStore for full-file before/after blobs (AD-CCD-3 / A.3).
 * Never writes plaintext into authority session logs or workspaceState message bodies.
 * @module @deepseek-ai/dsh-vscode-dsh/change/snapshot-store
 */

import { createHash, randomUUID } from 'node:crypto'
import { mkdir, readFile, rm, writeFile, readdir, stat } from 'node:fs/promises'
import { join } from 'node:path'
import type { ChangeSnapshot } from './types.ts'

/** Spike-locked layout + budget constants (SNAPSHOT_STORE_SPIKE). */
export const SNAPSHOT_STORE = {
  relativeRootSegments: ['changes'] as const,
  byteBudgetSoft: 200 * 1024 * 1024,
  perBlobSoftCap: 2 * 1024 * 1024,
} as const

/** On-disk blob envelope (v0). */
interface SnapshotBlobFile {
  v: 0
  sessionId: string
  snapshotRef: string
  sourceMessageId: string
  turn: number
  path: string
  oldText: string | null
  newText: string
}

/** Dependencies for resolving the storage root. */
export interface SnapshotStoreOptions {
  /** Absolute extension storage root (`storageUri.fsPath` or global+workspaceKey). */
  storageRoot: string
}

/**
 * Resolve `<storageRoot>/changes/<sessionId>/`.
 * @param storageRoot - extension storage root.
 * @param sessionId - SDK session id.
 */
export function snapshotSessionDir(storageRoot: string, sessionId: string): string {
  return join(storageRoot, ...SNAPSHOT_STORE.relativeRootSegments, sessionId)
}

/**
 * Resolve one blob path.
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

/**
 * SHA-256 hex of UTF-8 text (after-image hash for ChangeRecord / AC-17 prep).
 * @param text - full-file text.
 */
export function hashTextContent(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex')
}

/**
 * Product SnapshotStore: write / read / prune full-file blobs under extension storage.
 */
export class SnapshotStore {
  /**
   * @param options - storage root configuration.
   */
  constructor(private readonly options: SnapshotStoreOptions) {}

  /** Absolute storage root in use. */
  get storageRoot(): string {
    return this.options.storageRoot
  }

  /**
   * Persist a full-file before/after blob and return its snapshotRef.
   * Soft-caps oversized blobs by refusing write (caller treats as unavailable).
   * @param input - association keys + full-file images.
   */
  async write(input: {
    sessionId: string
    sourceMessageId: string
    turn: number
    path: string
    oldText: string | null
    newText: string
    snapshotRef?: string
  }): Promise<{ snapshotRef: string; bytesWritten: number } | { refused: true; reason: string }> {
    const snapshotRef = input.snapshotRef ?? randomUUID()
    const blob: SnapshotBlobFile = {
      v: 0,
      sessionId: input.sessionId,
      snapshotRef,
      sourceMessageId: input.sourceMessageId,
      turn: input.turn,
      path: input.path,
      oldText: input.oldText,
      newText: input.newText,
    }
    const payload = JSON.stringify(blob)
    const bytesWritten = Buffer.byteLength(payload, 'utf8')
    if (bytesWritten > SNAPSHOT_STORE.perBlobSoftCap) {
      return { refused: true, reason: 'blob-exceeds-soft-cap' }
    }
    const dir = snapshotSessionDir(this.options.storageRoot, input.sessionId)
    await mkdir(dir, { recursive: true })
    await writeFile(snapshotBlobPath(this.options.storageRoot, input.sessionId, snapshotRef), payload, 'utf8')
    return { snapshotRef, bytesWritten }
  }

  /**
   * Read a blob by ref.
   * @param sessionId - session id.
   * @param snapshotRef - blob id.
   */
  async read(sessionId: string, snapshotRef: string): Promise<ChangeSnapshot | undefined> {
    try {
      const raw = await readFile(
        snapshotBlobPath(this.options.storageRoot, sessionId, snapshotRef),
        'utf8',
      )
      const parsed = JSON.parse(raw) as SnapshotBlobFile
      if (parsed.v !== 0 || parsed.snapshotRef !== snapshotRef) return undefined
      return {
        snapshotRef: parsed.snapshotRef,
        path: parsed.path,
        oldText: parsed.oldText,
        newText: parsed.newText,
      }
    } catch {
      return undefined
    }
  }

  /**
   * Delete all blobs for one session (session delete / AD-CCD-6).
   * @param sessionId - session to clear.
   */
  async clearSession(sessionId: string): Promise<void> {
    await rm(snapshotSessionDir(this.options.storageRoot, sessionId), { recursive: true, force: true })
  }

  /**
   * Best-effort soft-budget prune: drop oldest session dirs when total exceeds budget.
   * Reverted-first ordering is phase-3; phase-2 uses oldest-session only.
   */
  async pruneToBudget(): Promise<{ prunedSessions: string[] }> {
    const root = join(this.options.storageRoot, ...SNAPSHOT_STORE.relativeRootSegments)
    let entries: string[]
    try {
      entries = await readdir(root)
    } catch {
      return { prunedSessions: [] }
    }
    const dirs: Array<{ sessionId: string; mtimeMs: number; bytes: number }> = []
    let total = 0
    for (const sessionId of entries) {
      const dir = join(root, sessionId)
      const bytes = await directoryBytes(dir)
      const st = await stat(dir).catch(() => undefined)
      dirs.push({ sessionId, mtimeMs: st?.mtimeMs ?? 0, bytes })
      total += bytes
    }
    dirs.sort((a, b) => a.mtimeMs - b.mtimeMs)
    const prunedSessions: string[] = []
    while (total > SNAPSHOT_STORE.byteBudgetSoft && dirs.length > 0) {
      const victim = dirs.shift()!
      await rm(join(root, victim.sessionId), { recursive: true, force: true })
      total -= victim.bytes
      prunedSessions.push(victim.sessionId)
    }
    return { prunedSessions }
  }
}

async function directoryBytes(dir: string): Promise<number> {
  let total = 0
  let names: string[]
  try {
    names = await readdir(dir)
  } catch {
    return 0
  }
  for (const name of names) {
    const p = join(dir, name)
    try {
      const st = await stat(p)
      if (st.isFile()) total += st.size
    } catch {
      // ignore
    }
  }
  return total
}
