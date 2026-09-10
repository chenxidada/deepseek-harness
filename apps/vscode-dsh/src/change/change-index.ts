/**
 * Durable ChangeRecord metadata index under extension storage (N-4 / A.3).
 * Metadata only — never authority-log / workspaceState snapshot plaintext.
 * @module @deepseek-ai/dsh-vscode-dsh/change/change-index
 */

import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { snapshotSessionDir } from './snapshot-store.ts'
import type { ChangeRecord } from './types.ts'

/** On-disk index envelope (v0). */
interface ChangeIndexFile {
  v: 0
  sessionId: string
  records: ChangeRecord[]
}

/**
 * Path to the session ChangeRecord index file.
 * @param storageRoot - SnapshotStore / extension storage root.
 * @param sessionId - SDK session id.
 */
export function changeIndexPath(storageRoot: string, sessionId: string): string {
  return join(snapshotSessionDir(storageRoot, sessionId), 'index.json')
}

/**
 * Persist ChangeRecord metadata for a session (AC-22 cold hydrate).
 * @param storageRoot - extension storage root.
 * @param sessionId - session id.
 * @param records - full session record list.
 */
export async function writeChangeIndex(
  storageRoot: string,
  sessionId: string,
  records: readonly ChangeRecord[],
): Promise<void> {
  const dir = snapshotSessionDir(storageRoot, sessionId)
  await mkdir(dir, { recursive: true })
  const payload: ChangeIndexFile = {
    v: 0,
    sessionId,
    records: records.map(r => ({ ...r })),
  }
  await writeFile(changeIndexPath(storageRoot, sessionId), JSON.stringify(payload), 'utf8')
}

/**
 * Load ChangeRecord metadata for a session (missing → empty).
 * @param storageRoot - extension storage root.
 * @param sessionId - session id.
 */
export async function readChangeIndex(
  storageRoot: string,
  sessionId: string,
): Promise<ChangeRecord[]> {
  try {
    const raw = await readFile(changeIndexPath(storageRoot, sessionId), 'utf8')
    const parsed = JSON.parse(raw) as ChangeIndexFile
    if (parsed.v !== 0 || parsed.sessionId !== sessionId || !Array.isArray(parsed.records)) {
      return []
    }
    return parsed.records.map(r => ({ ...r }))
  } catch {
    return []
  }
}
