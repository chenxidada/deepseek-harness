/**
 * SpecDev per-phase git helpers (AC-40 / AC-41 / AC-31).
 * Operate on the **target project repo** under workspace root (Q-1), not the
 * harness monorepo. Orchestrator / commands call these; gate only denies.
 *
 * @module @deepseek-ai/dsh-specdev/git
 */

import { execFileSync } from 'node:child_process'
import { SpecdevError } from './status.ts'

/** Options shared by git helpers. */
export interface SpecdevGitOptions {
  /** Absolute cwd of the project git repository (SpecDev workspace root). */
  readonly cwd: string
}

/** Result of {@link ensurePhaseBranch}. */
export interface EnsurePhaseBranchResult {
  readonly branch: string
  readonly created: boolean
  readonly stayed: boolean
}

/** Result of {@link completePhaseGit}. */
export interface CompletePhaseGitResult {
  readonly branch: string
  readonly committed: boolean
  readonly merged: boolean
  readonly deleted: boolean
  readonly files: readonly string[]
}

/**
 * Validate that `phaseId` looks like a DAG id (non-empty, no path separators).
 * @param phaseId - DAG `phases[].id`.
 */
export function phaseBranchName(phaseId: string): string {
  const id = phaseId.trim()
  if (id.length === 0 || id.includes('/') || id.includes('..')) {
    throw new SpecdevError(`invalid phaseId for git branch: ${JSON.stringify(phaseId)}`, 'SPECDEV_GIT_INVALID_PHASE')
  }
  return `impl-${id}`
}

/**
 * Read current branch (`git branch --show-current`). Fail-closed → `null`.
 * @param cwd - project repo root.
 */
export function readCurrentBranch(cwd: string): string | null {
  try {
    const out = git(cwd, ['branch', '--show-current'])
    const branch = out.trim()
    return branch.length > 0 ? branch : null
  } catch {
    return null
  }
}

/**
 * Ensure worktree is on `impl-<phaseId>` (AC-40 / AC-42).
 *
 * - Already on expected branch → stay (MUST-FIX loop); dirty tree allowed.
 * - Otherwise: **fail-closed on dirty worktree** (no auto-stash), then
 *   checkout `main` (or `master`), then `checkout -b impl-<id>` unless the
 *   branch already exists (then checkout it).
 * - `mode: 'recreate'` deletes and recreates the branch (directional MUST-FIX).
 *
 * @param phaseId - DAG phase id.
 * @param options - cwd + optional mode.
 */
export function ensurePhaseBranch(
  phaseId: string,
  options: SpecdevGitOptions & {
    readonly mode?: 'create' | 'must-fix-stay' | 'recreate'
  },
): EnsurePhaseBranchResult {
  const expected = phaseBranchName(phaseId)
  const cwd = options.cwd
  assertGitRepo(cwd)
  const current = readCurrentBranch(cwd)
  const mode = options.mode ?? 'create'

  if (current === expected && mode !== 'recreate') {
    return { branch: expected, created: false, stayed: true }
  }

  // Switching / recreating requires a clean tree — never silent stash (AC-40).
  assertCleanWorktree(cwd)

  if (mode === 'recreate' && branchExists(cwd, expected)) {
    // Directional reset: leave expected first if needed, then delete.
    if (current === expected) {
      checkoutBase(cwd)
    }
    git(cwd, ['branch', '-D', expected])
  }

  if (branchExists(cwd, expected)) {
    git(cwd, ['checkout', expected])
    return { branch: expected, created: false, stayed: false }
  }

  checkoutBase(cwd)
  git(cwd, ['checkout', '-b', expected])
  return { branch: expected, created: true, stayed: false }
}

/**
 * HG-3 git complete: commit **only** listed files, merge to base, delete branch (AC-41).
 * Never accepts empty list or paths that imply `git add -A` / `.`.
 *
 * @param request - phaseId + explicit file list.
 * @param options - cwd.
 */
export function completePhaseGit(
  request: { readonly phaseId: string; readonly files: readonly string[] },
  options: SpecdevGitOptions,
): CompletePhaseGitResult {
  const cwd = options.cwd
  assertGitRepo(cwd)
  const branch = phaseBranchName(request.phaseId)
  const files = normalizeExplicitFiles(request.files)

  const current = readCurrentBranch(cwd)
  if (current !== branch) {
    if (!branchExists(cwd, branch)) {
      throw new SpecdevError(`phase branch missing: ${branch}`, 'SPECDEV_GIT_BRANCH_MISSING')
    }
    git(cwd, ['checkout', branch])
  }

  git(cwd, ['add', '--', ...files])
  // Allow empty commit only when nothing staged? Prefer fail if nothing to commit
  // after add — use --allow-empty only when status is clean after add (already committed).
  const staged = git(cwd, ['diff', '--cached', '--name-only']).trim()
  if (staged.length === 0) {
    // If files were already committed, still allow merge/delete path.
  } else {
    git(cwd, ['commit', '-m', `Phase ${request.phaseId}: SpecDev HG-3 complete`])
  }

  const base = detectBaseBranch(cwd)
  git(cwd, ['checkout', base])
  git(cwd, ['merge', '--no-ff', '-m', `Merge ${branch}`, branch])
  git(cwd, ['branch', '-d', branch])

  return {
    branch,
    committed: staged.length > 0,
    merged: true,
    deleted: true,
    files,
  }
}

/**
 * Reject empty lists and blind add patterns (AC-41 / AC-45: never `-A` / `.`).
 * @param files - caller-provided paths.
 */
export function normalizeExplicitFiles(files: readonly string[]): string[] {
  if (!Array.isArray(files) || files.length === 0) {
    throw new SpecdevError('completePhaseGit requires a non-empty explicit file list', 'SPECDEV_GIT_FILES_REQUIRED')
  }
  const out: string[] = []
  for (const raw of files) {
    if (typeof raw !== 'string' || raw.trim().length === 0) {
      throw new SpecdevError('completePhaseGit file paths must be non-empty strings', 'SPECDEV_GIT_FILES_INVALID')
    }
    const path = raw.trim()
    if (path === '.' || path === '-A' || path === '--all' || path === '-u' || path === '--update') {
      throw new SpecdevError(
        `completePhaseGit refuses blind add pattern ${JSON.stringify(path)} (AC-41)`,
        'SPECDEV_GIT_BLIND_ADD',
      )
    }
    if (path.includes('\0')) {
      throw new SpecdevError('completePhaseGit file path contains NUL', 'SPECDEV_GIT_FILES_INVALID')
    }
    out.push(path)
  }
  return out
}

/** Run `git -C <cwd> …` and return stdout. */
function git(cwd: string, args: readonly string[]): string {
  try {
    return execFileSync('git', ['-C', cwd, ...args], {
      encoding: 'utf8',
      timeout: 30_000,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
  } catch (error: unknown) {
    throw new SpecdevError(
      `git ${args.join(' ')} failed: ${failureDetail(error)}`,
      'SPECDEV_GIT_FAILED',
    )
  }
}

/**
 * Detail text for one failed git invocation: its stderr when git wrote any,
 * else the thrown error's message.
 * @param error - the value `execFileSync` threw.
 */
function failureDetail(error: unknown): string {
  const stderr = (error as { stderr?: string } | undefined)?.stderr
  if (typeof stderr === 'string' && stderr.trim().length > 0) return stderr.trim()
  /* v8 ignore next -- execFileSync reports failures as Error subclasses. */
  return error instanceof Error ? error.message : String(error)
}

function assertGitRepo(cwd: string): void {
  try {
    git(cwd, ['rev-parse', '--is-inside-work-tree'])
  } catch {
    throw new SpecdevError(`not a git repository: ${cwd}`, 'SPECDEV_GIT_UNAVAILABLE')
  }
}

/** Fail-closed when tracked files differ from HEAD (AC-40). Untracked files (e.g. `.specdev/`) are allowed. */
function assertCleanWorktree(cwd: string): void {
  try {
    git(cwd, ['diff', '--quiet', 'HEAD'])
    git(cwd, ['diff', '--cached', '--quiet'])
  } catch {
    throw new SpecdevError(
      'ensurePhaseBranch refuses dirty worktree (tracked changes); stash or commit first (AC-40)',
      'SPECDEV_GIT_DIRTY',
    )
  }
}

function branchExists(cwd: string, name: string): boolean {
  try {
    git(cwd, ['show-ref', '--verify', '--quiet', `refs/heads/${name}`])
    return true
  } catch {
    return false
  }
}

function detectBaseBranch(cwd: string): string {
  if (branchExists(cwd, 'main')) return 'main'
  if (branchExists(cwd, 'master')) return 'master'
  throw new SpecdevError('neither main nor master branch exists', 'SPECDEV_GIT_BASE_MISSING')
}

function checkoutBase(cwd: string): void {
  git(cwd, ['checkout', detectBaseBranch(cwd)])
}
