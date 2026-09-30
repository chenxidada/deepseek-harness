/**
 * SpecDev workspace-root resolution (Q-1) and the `.specdev` path helpers:
 * candidate preference and dedupe, plus the validation each helper applies to
 * untrusted roots and slugs.
 */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  activeWorkflowPath,
  currentStatusPath,
  hasSpecdevLayout,
  layoutRootOf,
  resolveWorkspaceRoot,
  specsSlugDir,
  workflowLogPath,
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

describe('resolveWorkspaceRoot candidates', () => {
  it('refuses a call with neither cwd nor folders', () => {
    expect(() => resolveWorkspaceRoot()).toThrow(/without cwd or folders/)
    expect(() => resolveWorkspaceRoot({ folders: [] })).toThrow(/without cwd or folders/)
  })

  it('dedupes repeated folders and accepts a cwd that repeats one', () => {
    const root = tempDir('specdev-paths-dedupe-')
    expect(resolveWorkspaceRoot({ cwd: root, folders: [root, root] })).toBe(root)
  })

  it('prefers the layout folder without a cwd', () => {
    const root = tempDir('specdev-paths-nocwd-')
    const withLayout = join(root, 'has-layout')
    mkdirSync(join(withLayout, '.specdev'), { recursive: true })
    expect(resolveWorkspaceRoot({ folders: [withLayout] })).toBe(withLayout)
  })

  it('falls back to cwd when no candidate carries a layout', () => {
    const root = tempDir('specdev-paths-cwd-')
    const layout = join(root, 'with-layout')
    mkdirSync(join(layout, '.specdev'), { recursive: true })
    expect(resolveWorkspaceRoot({ cwd: layout })).toBe(layout)
  })

  it('resolves a relative candidate against the process cwd', () => {
    expect(resolveWorkspaceRoot({ cwd: 'relative-specdev-root' })).toBe(resolve('relative-specdev-root'))
  })

  it('rejects empty and non-string candidates', () => {
    expect(() => resolveWorkspaceRoot({ cwd: '   ' })).toThrow(/non-empty string/)
    expect(() => resolveWorkspaceRoot({ folders: [''] })).toThrow(TypeError)
    expect(() => resolveWorkspaceRoot({ cwd: 42 as unknown as string })).toThrow(TypeError)
  })
})

describe('.specdev path helpers', () => {
  it('joins the layout root and every workflow path', () => {
    const workspace = tempDir('specdev-paths-join-')
    const layout = layoutRootOf(workspace)
    expect(layout).toBe(join(workspace, '.specdev'))
    expect(activeWorkflowPath(layout)).toBe(join(layout, 'active-workflow'))
    expect(currentStatusPath(layout, 'wf')).toBe(join(layout, 'specs', 'wf', 'current-status.json'))
    expect(workflowLogPath(layout, 'wf')).toBe(join(layout, 'specs', 'wf', 'workflow.jsonl'))
    expect(specsSlugDir(layout, ' wf ')).toBe(join(layout, 'specs', 'wf'))
  })

  it('rejects empty and non-string slugs', () => {
    const layout = layoutRootOf(tempDir('specdev-paths-slug-'))
    const builders = [currentStatusPath, workflowLogPath, specsSlugDir]
    for (const build of builders) {
      expect(() => build(layout, '   ')).toThrow(/non-empty string/)
      expect(() => build(layout, 7 as unknown as string)).toThrow(/non-empty string/)
    }
  })

  it('rejects an empty workspace root', () => {
    expect(() => layoutRootOf('')).toThrow(/non-empty string/)
  })

  it('detects a .specdev directory and nothing else', () => {
    const root = tempDir('specdev-paths-layout-')
    expect(hasSpecdevLayout(root)).toBe(false)
    writeFileSync(join(root, '.specdev'), 'not a directory\n')
    expect(hasSpecdevLayout(root)).toBe(false)
    rmSync(join(root, '.specdev'))
    mkdirSync(join(root, '.specdev'))
    expect(hasSpecdevLayout(root)).toBe(true)
  })
})
