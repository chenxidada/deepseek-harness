/**
 * Plan reference-card open: same multi-root resolve as the send gate + meta lines (AC-4).
 * Does not parse natural-language line ranges from message text.
 * @module @deepseek-ai/dsh-vscode-dsh/code-context/open-reference
 */

import {
  resolveAtPathInWorkspace,
  type AtPathRejectReason,
  type ResolveAtPathOptions,
} from './at-path.ts'
import type { SelectionMetaStore } from './selection-meta.ts'

/** 0-based editor selection range for showTextDocument. */
export interface ReferenceOpenSelection {
  start: { line: number; character: number }
  end: { line: number; character: number }
}

/** Resolved absolute open target for a reference card. */
export type ReferenceOpenPlan =
  | {
    ok: true
    /** Absolute filesystem path to open. */
    abs: string
    /** Workspace-relative path (normalized via resolve). */
    path: string
    /** Meta-driven selection when present (never from NL). */
    selection?: ReferenceOpenSelection
  }
  | { ok: false; raw: string; reason: AtPathRejectReason }

/**
 * Resolve a reference-card path the same way as `validateComposerAtPaths` /
 * `resolveAtPathInWorkspace`, then attach selection from extension-local meta.
 * @param path - path payload from the card (relative or absolute).
 * @param options - workspace folders + preferred root + exists probe.
 * @param metaStore - optional SelectionMetaStore for line numbers.
 */
export function planReferenceOpen(
  path: string,
  options: ResolveAtPathOptions,
  metaStore?: SelectionMetaStore,
): ReferenceOpenPlan {
  const resolved = resolveAtPathInWorkspace(path, options)
  if (!resolved.ok) return resolved
  const meta = metaStore?.get(resolved.path) ?? metaStore?.get(path)
  if (meta === undefined) {
    return { ok: true, abs: resolved.abs, path: resolved.path }
  }
  return {
    ok: true,
    abs: resolved.abs,
    path: resolved.path,
    selection: {
      start: { line: Math.max(0, meta.startLine - 1), character: 0 },
      end: { line: Math.max(0, meta.endLine - 1), character: 0 },
    },
  }
}
