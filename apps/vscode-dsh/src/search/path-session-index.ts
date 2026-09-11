/**
 * Tier-2 path→session reverse index (AD-CUX-9 / AC-51).
 * Derived from ChangeRecord metadata only — never message bodies or JSONL.
 * @module @deepseek-ai/dsh-vscode-dsh/search/path-session-index
 */

import type { WorkspaceStateLike } from '../extension-index.ts'

/** One durable reverse-index row (design PathSessionIndexEntry). */
export interface PathSessionIndexEntry {
  /** Workspace-relative normalized path. */
  path: string
  /** Sessions that recorded a ChangeRecord for this path. */
  sessionIds: string[]
  /** Latest update time for this path row. */
  mtime: number
}

/** Durable snapshot written to workspaceState. */
export interface PathSessionIndexSnapshot {
  workspaceKey: string
  entries: PathSessionIndexEntry[]
}

/** Storage key for the path→session index in workspaceState. */
export const PATH_SESSION_INDEX_STATE_KEY = 'dsh.pathSessionIndex'

/**
 * Normalize a workspace-relative path for index keys / queries.
 * Aligns with ChangeRecord.path writers (slash-normalized, no leading ./).
 * @param path - raw path from ChangeRecord or user query.
 */
export function normalizeSearchPath(path: string): string {
  let next = path.replace(/\\/g, '/').trim()
  while (next.startsWith('./')) next = next.slice(2)
  return next.replace(/\/+/g, '/')
}

/**
 * In-memory + workspaceState path→session reverse index.
 * Does not store file contents or chat bodies.
 */
export class PathSessionIndex {
  private snapshot: PathSessionIndexSnapshot
  private writeCount = 0

  /**
   * @param workspaceKey - workspace identity.
   * @param state - optional workspaceState Memento.
   */
  constructor(
    workspaceKey = '',
    private readonly state?: WorkspaceStateLike,
  ) {
    const loaded = this.state?.get<PathSessionIndexSnapshot>(PATH_SESSION_INDEX_STATE_KEY)
    this.snapshot = loaded === undefined
      ? emptySnapshot(workspaceKey)
      : sanitizeLoaded(loaded, workspaceKey)
  }

  /**
   * Current snapshot copy (metadata only).
   * @returns durable entries.
   */
  read(): PathSessionIndexSnapshot {
    return cloneSnapshot(this.snapshot)
  }

  /**
   * How many persist calls completed (L2 probes).
   * @returns monotonic write counter.
   */
  getWriteCount(): number {
    return this.writeCount
  }

  /**
   * Replace all path associations for one session from ChangeRecord paths.
   * Removes the session from paths it no longer touches; drops empty path rows.
   * @param sessionId - session identity.
   * @param paths - workspace-relative paths from Change metadata.
   * @param mtime - optional stamp (defaults to now).
   */
  replaceSessionPaths(
    sessionId: string,
    paths: readonly string[],
    mtime = Date.now(),
  ): void {
    const normalized = uniqueNormalized(paths)
    const wanted = new Set(normalized)
    const byPath = new Map<string, PathSessionIndexEntry>()
    for (const entry of this.snapshot.entries) {
      byPath.set(entry.path, {
        path: entry.path,
        sessionIds: [...entry.sessionIds],
        mtime: entry.mtime,
      })
    }

    // Drop this session from paths it no longer owns.
    for (const [path, entry] of byPath) {
      if (wanted.has(path)) continue
      const nextIds = entry.sessionIds.filter(id => id !== sessionId)
      if (nextIds.length === 0) byPath.delete(path)
      else byPath.set(path, { ...entry, sessionIds: nextIds, mtime })
    }

    // Ensure this session is listed on each current path.
    for (const path of wanted) {
      const existing = byPath.get(path)
      if (existing === undefined) {
        byPath.set(path, { path, sessionIds: [sessionId], mtime })
        continue
      }
      if (!existing.sessionIds.includes(sessionId)) {
        byPath.set(path, {
          path,
          sessionIds: [...existing.sessionIds, sessionId],
          mtime,
        })
      } else {
        byPath.set(path, { ...existing, mtime })
      }
    }

    this.snapshot = {
      workspaceKey: this.snapshot.workspaceKey,
      entries: [...byPath.values()].sort((a, b) => a.path.localeCompare(b.path)),
    }
    this.writeImmediate()
  }

  /**
   * Remove a session from every path row (delete / tombstone).
   * @param sessionId - session to drop.
   */
  removeSession(sessionId: string): void {
    const entries = this.snapshot.entries
      .map(entry => ({
        path: entry.path,
        sessionIds: entry.sessionIds.filter(id => id !== sessionId),
        mtime: entry.mtime,
      }))
      .filter(entry => entry.sessionIds.length > 0)
    this.snapshot = { workspaceKey: this.snapshot.workspaceKey, entries }
    this.writeImmediate()
  }

  /**
   * Query sessions that touched a path (substring / suffix match on normalized path).
   * @param pathQuery - user path fragment (normalized before match).
   * @returns matching entries with intersecting sessionIds.
   */
  queryByPath(pathQuery: string): PathSessionIndexEntry[] {
    const needle = normalizeSearchPath(pathQuery).toLowerCase()
    if (needle === '') return []
    return this.snapshot.entries
      .filter(entry => {
        const hay = entry.path.toLowerCase()
        return hay === needle || hay.endsWith(`/${needle}`) || hay.includes(needle)
      })
      .map(entry => ({
        path: entry.path,
        sessionIds: [...entry.sessionIds],
        mtime: entry.mtime,
      }))
  }

  /**
   * Persist the current snapshot immediately.
   */
  writeImmediate(): void {
    this.writeCount += 1
    const payload = cloneSnapshot(this.snapshot)
    void this.state?.update(PATH_SESSION_INDEX_STATE_KEY, payload)
  }
}

function uniqueNormalized(paths: readonly string[]): string[] {
  const out: string[] = []
  const seen = new Set<string>()
  for (const raw of paths) {
    const path = normalizeSearchPath(raw)
    if (path === '' || seen.has(path)) continue
    seen.add(path)
    out.push(path)
  }
  return out
}

function emptySnapshot(workspaceKey: string): PathSessionIndexSnapshot {
  return { workspaceKey, entries: [] }
}

function sanitizeLoaded(
  loaded: PathSessionIndexSnapshot,
  workspaceKey: string,
): PathSessionIndexSnapshot {
  const entries = Array.isArray(loaded.entries)
    ? loaded.entries
      .filter(row =>
        typeof row?.path === 'string'
        && Array.isArray(row.sessionIds)
        && typeof row.mtime === 'number')
      .map(row => ({
        path: normalizeSearchPath(row.path),
        sessionIds: row.sessionIds.filter((id): id is string => typeof id === 'string' && id !== ''),
        mtime: row.mtime,
      }))
      .filter(row => row.path !== '' && row.sessionIds.length > 0)
    : []
  return {
    workspaceKey: typeof loaded.workspaceKey === 'string' ? loaded.workspaceKey : workspaceKey,
    entries,
  }
}

function cloneSnapshot(snapshot: PathSessionIndexSnapshot): PathSessionIndexSnapshot {
  return {
    workspaceKey: snapshot.workspaceKey,
    entries: snapshot.entries.map(entry => ({
      path: entry.path,
      sessionIds: [...entry.sessionIds],
      mtime: entry.mtime,
    })),
  }
}
