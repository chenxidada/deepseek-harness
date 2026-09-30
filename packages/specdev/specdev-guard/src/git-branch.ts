/**
 * Read the current git branch for SpecDev implementer checks (AC-37).
 * Fail-closed: returns `null` when git is unavailable.
 *
 * @module @deepseek-ai/dsh-specdev-guard/git-branch
 */

import { execFileSync } from 'node:child_process'

/** Reads `git branch --show-current` for a workspace cwd. */
export type GitBranchReader = (cwd: string) => string | null

/**
 * Default reader: `git -C <cwd> branch --show-current`.
 * @param cwd - workspace / project repo root (SpecDev Q-1 root).
 */
export function readGitBranch(cwd: string): string | null {
  try {
    const out = execFileSync('git', ['-C', cwd, 'branch', '--show-current'], {
      encoding: 'utf8',
      timeout: 5_000,
      stdio: ['ignore', 'pipe', 'ignore'],
    })
    const branch = out.trim()
    return branch.length > 0 ? branch : null
  } catch {
    return null
  }
}
