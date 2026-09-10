/**
 * Extension-local selection line metadata for reference-card open (AC-4).
 * Authority user text stays pointer-only; line numbers are never parsed from NL.
 * @module @deepseek-ai/dsh-vscode-dsh/code-context/selection-meta
 */

import { normalizePathKey } from './at-path.ts'

/** Line range captured at prefill time (1-based inclusive). */
export interface SelectionLineMeta {
  /** Workspace-relative path (normalized). */
  path: string
  /** Inclusive start line (1-based). */
  startLine: number
  /** Inclusive end line (1-based). */
  endLine: number
}

/**
 * In-memory store of selection line metadata keyed by normalized path.
 * Not written to the authoritative session log (AD-CCD-3 / AC-4).
 */
export class SelectionMetaStore {
  private readonly byPath = new Map<string, SelectionLineMeta>()

  /**
   * Record meta for a path (overwrites prior entry for the same path).
   * @param meta - selection line meta from the editor.
   */
  set(meta: SelectionLineMeta): void {
    const path = normalizePathKey(meta.path)
    this.byPath.set(path, {
      path,
      startLine: meta.startLine,
      endLine: meta.endLine,
    })
  }

  /**
   * Look up meta for a path.
   * @param path - workspace-relative or raw path key.
   */
  get(path: string): SelectionLineMeta | undefined {
    return this.byPath.get(normalizePathKey(path))
  }

  /** Drop all meta (tests / deactivation). */
  clear(): void {
    this.byPath.clear()
  }
}
