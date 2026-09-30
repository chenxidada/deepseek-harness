/**
 * `readGitBranch` against real repositories: the branch it reports, and the
 * fail-closed `null` for a detached HEAD and for a directory outside any
 * repository (AC-37).
 */

import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { readGitBranch } from '@deepseek-ai/dsh-specdev-guard'

const tempRoots: string[] = []

afterEach(() => {
  while (tempRoots.length > 0) {
    const root = tempRoots.pop()
    if (root !== undefined) rmSync(root, { recursive: true, force: true })
  }
})

function tempDir(prefix: string): string {
  const root = mkdtempSync(join(tmpdir(), prefix))
  tempRoots.push(root)
  return root
}

/** Run one git command in `repo`; commit identity comes from `-c` so no host config decides the outcome. */
function git(repo: string, args: readonly string[]): string {
  return execFileSync('git', [
    '-C', repo,
    '-c', 'user.name=specdev-guard-test',
    '-c', 'user.email=specdev-guard-test@example.invalid',
    '-c', 'commit.gpgsign=false',
    ...args,
  ], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })
}

/** Whether a real git binary is on PATH; the suite self-skips without one. */
function gitAvailable(): boolean {
  try {
    execFileSync('git', ['--version'], { stdio: 'ignore' })
    return true
  } catch {
    return false
  }
}

describe.skipIf(!gitAvailable())('readGitBranch', () => {
  it('reports the checked-out branch of a repository', () => {
    const repo = tempDir('specdev-branch-repo-')
    git(repo, ['init', '--quiet'])
    git(repo, ['symbolic-ref', 'HEAD', 'refs/heads/impl-phase-1-p0-core'])

    expect(readGitBranch(repo)).toBe('impl-phase-1-p0-core')
  })

  it('reports null on a detached HEAD', () => {
    const repo = tempDir('specdev-branch-detached-')
    git(repo, ['init', '--quiet'])
    git(repo, ['commit', '--quiet', '--allow-empty', '-m', 'init'])
    git(repo, ['checkout', '--quiet', '--detach'])

    expect(readGitBranch(repo)).toBeNull()
  })

  it('reports null outside any repository', () => {
    const outside = tempDir('specdev-branch-norepo-')

    expect(readGitBranch(outside)).toBeNull()
  })
})
