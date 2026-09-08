/**
 * Post-hoc Diff / SCM entry helpers (AD-7 / AC-23/24/25).
 * Default policy is review-after-write — never mid-run per-file confirm.
 * @module @deepseek-ai/dsh-vscode-dsh/diff-entry
 */

import type { TimelineDiffHunk } from './timeline-store.ts'

/**
 * Product default: post-hoc Diff only (AC-24).
 * Mid-run per-file confirmation is out of scope (AC-26 Could).
 */
export const DEFAULT_POST_HOC_DIFF_ONLY = true as const

/** Arguments describing a `vscode.diff` open. */
export interface DiffOpenArgs {
  /** VS Code command id. */
  command: 'vscode.diff'
  /** Virtual document scheme for the left (old) side. */
  leftScheme: 'dsh-diff'
  /** Virtual document scheme for the right (new) side — log snapshot only. */
  rightScheme: 'dsh-diff'
  /** Logical path label (never used as a workspace before/after source). */
  path: string
  /** Diff editor title. */
  title: string
  /** Old text for the left virtual document (from log `oldText`). */
  oldText: string
  /** New text for the right virtual document (from log `newText`). */
  newText: string
}

/** Minimal URI surface used by Diff open. */
export interface DiffUriLike {
  scheme: string
  path: string
  fsPath?: string
  toString(): string
}

/** Duck-typed vscode surface for opening Diff. */
export interface DiffVsCodeLike {
  Uri: {
    parse(value: string): DiffUriLike
    file(path: string): DiffUriLike
  }
  workspace: {
    registerTextDocumentContentProvider?(
      scheme: string,
      provider: { provideTextDocumentContent(uri: DiffUriLike): string },
    ): { dispose(): void }
  }
  commands: {
    executeCommand(command: string, ...args: unknown[]): Promise<unknown>
  }
}

const leftContents = new Map<string, string>()
let providerRegistered = false

/**
 * Build Diff open metadata from a timeline hunk (testable without VS Code).
 * Both sides come from authoritative log snapshots (AD-CU-6) — never workspace files.
 * @param hunk - write/edit diff from tool meta.
 */
export function buildDiffOpenArgs(hunk: TimelineDiffHunk): DiffOpenArgs {
  return {
    command: 'vscode.diff',
    leftScheme: 'dsh-diff',
    rightScheme: 'dsh-diff',
    path: hunk.path,
    title: `DeepSeek Harness: ${hunk.path}`,
    // Create (oldText null) → empty left document; never invent workspace before.
    oldText: hunk.oldText ?? '',
    newText: hunk.newText,
  }
}

/**
 * Whether a Diff hunk is recoverable for replay (AC-76 / AD-CU-6).
 * Requires path + newText + oldText (string|null). Missing oldText key → unavailable.
 * @param hunk - candidate Diff.
 */
export function isRecoverableReplayDiff(hunk: TimelineDiffHunk | undefined): boolean {
  if (hunk === undefined) return false
  if (typeof hunk.path !== 'string' || typeof hunk.newText !== 'string') return false
  return typeof hunk.oldText === 'string' || hunk.oldText === null
}

/**
 * Open a post-hoc Diff for one write/edit hunk (AC-23/25 / AD-CU-6).
 * Both sides are virtual `dsh-diff` documents from the log — never current disk.
 * @param vscode - duck-typed vscode module.
 * @param hunk - structured diff from timeline / tool meta.
 */
export async function openTimelineDiff(vscode: DiffVsCodeLike, hunk: TimelineDiffHunk): Promise<void> {
  if (!isRecoverableReplayDiff(hunk)) {
    throw new Error('Diff unavailable: missing authoritative before/after snapshot')
  }
  ensureDiffProvider(vscode)
  const args = buildDiffOpenArgs(hunk)
  const leftKey = encodeURIComponent(`old:${hunk.path}`)
  const rightKey = encodeURIComponent(`new:${hunk.path}`)
  const leftUri = vscode.Uri.parse(`dsh-diff:${leftKey}`)
  const rightUri = vscode.Uri.parse(`dsh-diff:${rightKey}`)
  leftContents.set(leftUri.toString(), args.oldText)
  leftContents.set(rightUri.toString(), args.newText)
  await vscode.commands.executeCommand(args.command, leftUri, rightUri, args.title)
}

/**
 * Open Diff for the first available write entry, or report none.
 * @param vscode - duck-typed vscode module.
 * @param hunks - write diffs for the active Tab.
 * @returns true when a Diff was opened.
 */
export async function reviewWorkspaceDiffs(
  vscode: DiffVsCodeLike,
  hunks: readonly TimelineDiffHunk[],
): Promise<boolean> {
  const first = hunks[0]
  if (first === undefined) return false
  await openTimelineDiff(vscode, first)
  return true
}

function ensureDiffProvider(vscode: DiffVsCodeLike): void {
  if (providerRegistered) return
  const register = vscode.workspace.registerTextDocumentContentProvider
  if (register === undefined) return
  register('dsh-diff', {
    provideTextDocumentContent(uri: DiffUriLike): string {
      return leftContents.get(uri.toString()) ?? ''
    },
  })
  providerRegistered = true
}

/** Test-only: reset provider registration flag between e2e cases. */
export function resetDiffProviderForTests(): void {
  providerRegistered = false
  leftContents.clear()
}
