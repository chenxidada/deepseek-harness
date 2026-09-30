/**
 * Per-phase git helpers (AC-40 / AC-41): branch naming, the recreate and
 * switch paths of ensurePhaseBranch, the completePhaseGit commit/merge/delete
 * sequence, and the refusal of blind adds — all over real fixture repos.
 */

import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  completePhaseGit,
  ensurePhaseBranch,
  normalizeExplicitFiles,
  phaseBranchName,
  readCurrentBranch,
} from '@deepseek-ai/dsh-specdev'

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

/** Error code a call throws, or a failure when it does not throw. */
function codeOf(fn: () => unknown): unknown {
  try {
    fn()
  } catch (error: unknown) {
    return (error as { code?: string }).code
  }
  throw new Error('expected the call to throw')
}

function git(cwd: string, args: readonly string[]): string {
  return execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf8' })
}

/** A fixture repository with one commit on the named base branch. */
function gitInit(cwd: string, baseBranch = 'main'): void {
  git(cwd, ['init', '-b', baseBranch])
  git(cwd, ['config', 'user.email', 'specdev@test'])
  git(cwd, ['config', 'user.name', 'SpecDev Test'])
  writeFileSync(join(cwd, 'README.md'), '# fixture\n')
  git(cwd, ['add', 'README.md'])
  git(cwd, ['commit', '-m', 'init'])
}

describe('phaseBranchName', () => {
  it('names the branch after the trimmed phase id', () => {
    expect(phaseBranchName(' phase-1-p0-core ')).toBe('impl-phase-1-p0-core')
  })

  it('refuses empty and path-shaped phase ids', () => {
    for (const phaseId of ['', '   ', 'a/b', 'a..b']) {
      expect(codeOf(() => phaseBranchName(phaseId))).toBe('SPECDEV_GIT_INVALID_PHASE')
    }
  })
})

describe('readCurrentBranch', () => {
  it('reports null outside a repository and on a detached HEAD', () => {
    expect(readCurrentBranch(tempDir('specdev-git-norepo-'))).toBeNull()

    const cwd = tempDir('specdev-git-detached-')
    gitInit(cwd)
    expect(readCurrentBranch(cwd)).toBe('main')
    git(cwd, ['checkout', '--detach'])
    expect(readCurrentBranch(cwd)).toBeNull()
  })
})

describe('ensurePhaseBranch', () => {
  it('refuses a workspace that is not a repository', () => {
    expect(codeOf(() => ensurePhaseBranch('p1', { cwd: tempDir('specdev-git-nonrepo-') })))
      .toBe('SPECDEV_GIT_UNAVAILABLE')
  })

  it('recreates the branch, dropping its previous commits', () => {
    const cwd = tempDir('specdev-git-recreate-')
    gitInit(cwd)
    ensurePhaseBranch('p1', { cwd })
    writeFileSync(join(cwd, 'phase.ts'), 'export const phase = 1\n')
    git(cwd, ['add', 'phase.ts'])
    git(cwd, ['commit', '-m', 'phase work'])

    const recreated = ensurePhaseBranch('p1', { cwd, mode: 'recreate' })
    expect(recreated).toEqual({ branch: 'impl-p1', created: true, stayed: false })
    expect(git(cwd, ['log', '--oneline'])).not.toContain('phase work')
  })

  it('recreates a branch it is not currently on', () => {
    const cwd = tempDir('specdev-git-recreate-elsewhere-')
    gitInit(cwd)
    ensurePhaseBranch('p1', { cwd })
    writeFileSync(join(cwd, 'phase.ts'), 'export const phase = 1\n')
    git(cwd, ['add', 'phase.ts'])
    git(cwd, ['commit', '-m', 'phase work'])
    git(cwd, ['checkout', 'main'])

    const recreated = ensurePhaseBranch('p1', { cwd, mode: 'recreate' })
    expect(recreated).toEqual({ branch: 'impl-p1', created: true, stayed: false })
    expect(git(cwd, ['log', '--oneline'])).not.toContain('phase work')
  })

  it('switches to an existing branch instead of creating a new one', () => {
    const cwd = tempDir('specdev-git-existing-')
    gitInit(cwd)
    ensurePhaseBranch('p1', { cwd })
    git(cwd, ['checkout', 'main'])

    const switched = ensurePhaseBranch('p1', { cwd })
    expect(switched).toEqual({ branch: 'impl-p1', created: false, stayed: false })
    expect(readCurrentBranch(cwd)).toBe('impl-p1')
  })
})

describe('completePhaseGit', () => {
  it('refuses a phase branch that does not exist', () => {
    const cwd = tempDir('specdev-git-nobranch-')
    gitInit(cwd)
    expect(codeOf(() => completePhaseGit({ phaseId: 'p1', files: ['a.ts'] }, { cwd })))
      .toBe('SPECDEV_GIT_BRANCH_MISSING')
  })

  it('switches to the phase branch before committing', () => {
    const cwd = tempDir('specdev-git-switch-')
    gitInit(cwd)
    ensurePhaseBranch('p1', { cwd })
    git(cwd, ['checkout', 'main'])
    writeFileSync(join(cwd, 'a.ts'), 'export const a = 1\n')

    const result = completePhaseGit({ phaseId: 'p1', files: ['a.ts'] }, { cwd })
    expect(result).toEqual({
      branch: 'impl-p1',
      committed: true,
      merged: true,
      deleted: true,
      files: ['a.ts'],
    })
    expect(readCurrentBranch(cwd)).toBe('main')
    expect(existsSync(join(cwd, 'a.ts'))).toBe(true)
  })

  it('merges without a commit when the listed files are already committed', () => {
    const cwd = tempDir('specdev-git-already-')
    gitInit(cwd)
    ensurePhaseBranch('p1', { cwd })
    writeFileSync(join(cwd, 'a.ts'), 'export const a = 1\n')
    git(cwd, ['add', 'a.ts'])
    git(cwd, ['commit', '-m', 'work'])

    const result = completePhaseGit({ phaseId: 'p1', files: ['a.ts'] }, { cwd })
    expect(result.committed).toBe(false)
    expect(result.merged).toBe(true)
  })

  it('detects master as the base branch when main does not exist', () => {
    const cwd = tempDir('specdev-git-master-')
    gitInit(cwd, 'master')
    git(cwd, ['checkout', '-b', 'impl-p1'])
    writeFileSync(join(cwd, 'a.ts'), 'export const a = 1\n')

    const result = completePhaseGit({ phaseId: 'p1', files: ['a.ts'] }, { cwd })
    expect(result.merged).toBe(true)
    expect(readCurrentBranch(cwd)).toBe('master')
  })

  it('refuses a repository with neither main nor master', () => {
    const cwd = tempDir('specdev-git-nobase-')
    gitInit(cwd, 'trunk')
    git(cwd, ['checkout', '-b', 'impl-p1'])
    writeFileSync(join(cwd, 'a.ts'), 'export const a = 1\n')

    expect(codeOf(() => completePhaseGit({ phaseId: 'p1', files: ['a.ts'] }, { cwd })))
      .toBe('SPECDEV_GIT_BASE_MISSING')
  })
})

describe('normalizeExplicitFiles', () => {
  it('trims the listed paths', () => {
    expect(normalizeExplicitFiles([' a.ts ', 'src/b.ts'])).toEqual(['a.ts', 'src/b.ts'])
  })

  it('refuses an empty list and empty or non-string entries', () => {
    expect(codeOf(() => normalizeExplicitFiles([]))).toBe('SPECDEV_GIT_FILES_REQUIRED')
    expect(codeOf(() => normalizeExplicitFiles(['  ']))).toBe('SPECDEV_GIT_FILES_INVALID')
    expect(codeOf(() => normalizeExplicitFiles([7 as unknown as string]))).toBe('SPECDEV_GIT_FILES_INVALID')
    expect(codeOf(() => normalizeExplicitFiles(['a\0b']))).toBe('SPECDEV_GIT_FILES_INVALID')
  })

  it('refuses every blind add pattern', () => {
    for (const pattern of ['.', '-A', '--all', '-u', '--update']) {
      expect(codeOf(() => normalizeExplicitFiles([pattern]))).toBe('SPECDEV_GIT_BLIND_ADD')
    }
  })
})
