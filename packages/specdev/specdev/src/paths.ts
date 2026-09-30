/**
 * Q-1 workspace-root resolution for SpecDev: prefer a folder that already
 * contains `.specdev/`, else the primary workspace folder / session cwd.
 * Never uses `$DSH_HOME` as the SpecDev layout root.
 *
 * @module @deepseek-ai/dsh-specdev/paths
 */

import { existsSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'
import type { ResolveWorkspaceRootOptions } from './types.ts'

/** Whether `root` contains a `.specdev` directory (not a file). */
export function hasSpecdevLayout(root: string): boolean {
  const layout = join(root, '.specdev')
  try {
    return existsSync(layout) && statSync(layout).isDirectory()
  } catch {
    /* v8 ignore next -- only the existsSync/statSync race reaches this arm. */
    return false
  }
}

/**
 * Resolve one candidate path to absolute form; reject an empty value.
 * @param value - candidate path from cwd or folder list.
 * @returns the absolute path (a relative value resolves against the process cwd).
 */
function assertAbsolute(value: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new TypeError('SpecDev workspace path must be a non-empty string')
  }
  return resolve(value.trim())
}

/**
 * Resolve the user workspace root that owns `.specdev` (Q-1).
 *
 * Preference order:
 * 1. Among candidates (folders ∪ cwd), any folder that already has `.specdev/`
 *    — if several match, prefer the one equal to `cwd`, else the first listed.
 * 2. Else the first folder (primary), or `cwd` when folders are empty.
 *
 * @param options - session cwd and optional multi-root folder list.
 * @returns absolute workspace root (never `$DSH_HOME`).
 */
export function resolveWorkspaceRoot(options: ResolveWorkspaceRootOptions = {}): string {
  const cwd = options.cwd === undefined ? undefined : assertAbsolute(options.cwd)
  const folders = (options.folders ?? []).map(assertAbsolute)
  const candidates: string[] = []
  for (const folder of folders) {
    if (!candidates.includes(folder)) candidates.push(folder)
  }
  if (cwd !== undefined && !candidates.includes(cwd)) candidates.push(cwd)
  if (candidates.length === 0) {
    throw new Error('SpecDev cannot resolve a workspace root without cwd or folders')
  }

  const withLayout = candidates.filter(hasSpecdevLayout)
  if (withLayout.length > 0) {
    if (cwd !== undefined) {
      const matchingCwd = withLayout.find(root => root === cwd)
      if (matchingCwd !== undefined) return matchingCwd
    }
    const preferred = withLayout[0]
    /* v8 ignore next 3 -- withLayout was checked non-empty, so its first entry exists. */
    if (preferred === undefined) {
      throw new Error('SpecDev invariant: withLayout was non-empty but first entry missing')
    }
    return preferred
  }

  const fallback = folders[0] ?? cwd
  /* v8 ignore next 3 -- candidates was checked non-empty, so it holds a folder or cwd. */
  if (fallback === undefined) {
    throw new Error('SpecDev cannot resolve a workspace root without cwd or folders')
  }
  return fallback
}

/**
 * SpecDev layout root under a resolved workspace: `<workspace>/.specdev`.
 * @param workspaceRoot - absolute workspace root.
 */
export function layoutRootOf(workspaceRoot: string): string {
  return join(assertAbsolute(workspaceRoot), '.specdev')
}

/**
 * Path to `.specdev/active-workflow` (single-line slug).
 * @param layoutRoot - absolute `.specdev` directory.
 */
export function activeWorkflowPath(layoutRoot: string): string {
  return join(layoutRoot, 'active-workflow')
}

/**
 * Path to `.specdev/specs/<slug>/current-status.json`.
 * @param layoutRoot - absolute `.specdev` directory.
 * @param slug - workflow slug.
 */
export function currentStatusPath(layoutRoot: string, slug: string): string {
  if (typeof slug !== 'string' || slug.trim().length === 0) {
    throw new TypeError('SpecDev slug must be a non-empty string')
  }
  return join(layoutRoot, 'specs', slug.trim(), 'current-status.json')
}

/**
 * Path to `.specdev/specs/<slug>/workflow.jsonl` — the append-only workflow
 * log that is the workflow's source of truth.
 * @param layoutRoot - absolute `.specdev` directory.
 * @param slug - workflow slug.
 */
export function workflowLogPath(layoutRoot: string, slug: string): string {
  if (typeof slug !== 'string' || slug.trim().length === 0) {
    throw new TypeError('SpecDev slug must be a non-empty string')
  }
  return join(layoutRoot, 'specs', slug.trim(), 'workflow.jsonl')
}

/**
 * Path to `.specdev/specs/<slug>/`.
 * @param layoutRoot - absolute `.specdev` directory.
 * @param slug - workflow slug.
 */
export function specsSlugDir(layoutRoot: string, slug: string): string {
  if (typeof slug !== 'string' || slug.trim().length === 0) {
    throw new TypeError('SpecDev slug must be a non-empty string')
  }
  return join(layoutRoot, 'specs', slug.trim())
}
