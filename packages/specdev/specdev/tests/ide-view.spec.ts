/**
 * SpecDev snapshot IDE views: the ordered plan rows with their progress and the
 * artifact rows with their workspace-relative paths and ready/missing state.
 */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import SessionStore from '@deepseek-ai/dsh-session'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import SpecdevService, {
  createInitialStatus,
  SPECDEV_SCHEMA_VERSION,
  type CurrentStatusJson,
  type SpecdevArtifactRow,
  type SpecdevSnapshot,
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

/** Boot the service; these workspaces carry no workflow log, so the mirror is the SoT. */
async function harness(): Promise<Context> {
  const ctx = new Context()
  await ctx.plugin(SessionStore)
  await ctx.plugin(SessionProjectionRegistry)
  await ctx.plugin(SpecdevService)
  return ctx
}

/** Seed `.specdev/active-workflow` plus one durable status, and return the slug dir. */
function seedWorkflow(workspace: string, slug: string, status: CurrentStatusJson): string {
  const slugDir = join(workspace, '.specdev', 'specs', slug)
  mkdirSync(slugDir, { recursive: true })
  writeFileSync(join(workspace, '.specdev', 'active-workflow'), `${slug}\n`)
  writeFileSync(join(slugDir, 'current-status.json'), `${JSON.stringify(status, null, 2)}\n`)
  return slugDir
}

/** Write a `phase-plan.md` carrying one `json` fence. */
function writePlan(slugDir: string, phases: readonly Record<string, unknown>[]): void {
  const body = JSON.stringify({ phases }, null, 2)
  writeFileSync(join(slugDir, 'phase-plan.md'), `# Phase Plan\n\n\`\`\`json\n${body}\n\`\`\`\n`)
}

/** Whether a snapshot carries the plan rows at all. */
function hasPlan(snapshot: SpecdevSnapshot | null): boolean {
  return snapshot !== null && 'plan' in snapshot
}

/** One phase's artifacts, keyed by label. */
function phaseArtifacts(
  rows: readonly SpecdevArtifactRow[],
  phaseId: string,
): Readonly<Record<string, string>> {
  return Object.fromEntries(
    rows.filter(row => row.phaseId === phaseId).map(row => [row.label, row.status]),
  )
}

/** The phase ids of an artifact listing, in row order. */
function artifactPhaseIds(snapshot: SpecdevSnapshot | null): readonly (string | null)[] {
  return (snapshot?.artifacts ?? []).map(row => row.phaseId)
}

describe('snapshot plan rows', () => {
  it('orders the plan and marks done / active / todo against the durable status', async () => {
    const workspace = tempDir('specdev-plan-')
    const slugDir = seedWorkflow(workspace, 'plan-demo', {
      ...createInitialStatus('plan-demo', 'feature', { initiating_command: 'feature' }),
      current_stage: 'phase-implementation',
      current_phase: 'p2',
      phases: {
        p1: { implementer: 'completed', reviewer: 'completed', verifier: 'completed', prototype: 'pending' },
        p2: { implementer: 'in_progress', reviewer: 'pending', verifier: 'pending', prototype: 'pending' },
      },
    })
    writePlan(slugDir, [
      { id: 'p1', dependencies: [] },
      { id: 'p2', dependencies: ['p1'] },
      { id: 'p3', dependencies: ['p2'] },
    ])

    const ctx = await harness()
    const snapshot = ctx.specdev.snapshot(undefined, { cwd: workspace })
    expect(snapshot?.schemaVersion).toBe(SPECDEV_SCHEMA_VERSION)
    expect(snapshot?.plan).toEqual([
      { id: 'p1', dependencies: [], status: 'done' },
      { id: 'p2', dependencies: ['p1'], status: 'active' },
      { id: 'p3', dependencies: ['p2'], status: 'todo' },
    ])
    // A phase whose steps are all complete is done even once it is no longer current.
    expect(snapshot?.phase).toBe('p2')
  })

  it('omits plan when the plan is missing or does not parse, and keeps the artifacts', async () => {
    const workspace = tempDir('specdev-plan-absent-')
    const slugDir = seedWorkflow(workspace, 'no-plan', {
      ...createInitialStatus('no-plan'),
      current_stage: 'phase-implementation',
      current_phase: 'p1',
      phases: {
        p2: { implementer: 'pending', reviewer: 'pending', verifier: 'pending', prototype: 'pending' },
        p1: { implementer: 'in_progress', reviewer: 'pending', verifier: 'pending', prototype: 'pending' },
      },
    })

    const ctx = await harness()
    const missing = ctx.specdev.snapshot(undefined, { cwd: workspace })
    expect(hasPlan(missing)).toBe(false)
    // Without a plan the phase rows follow the durable status's own key order.
    const phaseIds = artifactPhaseIds(missing)
    expect(phaseIds.slice(0, 3)).toEqual([null, null, null])
    expect(phaseIds.slice(3, 10).every(id => id === 'p2')).toBe(true)
    expect(phaseIds.slice(10).every(id => id === 'p1')).toBe(true)

    writeFileSync(join(slugDir, 'phase-plan.md'), '# Phase Plan\n\nno fence here\n')
    expect(hasPlan(ctx.specdev.snapshot(undefined, { cwd: workspace }))).toBe(false)
  })
})

describe('snapshot artifact rows', () => {
  it('reports workspace-relative POSIX paths with ready / missing state', async () => {
    const workspace = tempDir('specdev-artifacts-')
    const slugDir = seedWorkflow(workspace, 'artifact-demo', {
      ...createInitialStatus('artifact-demo'),
      current_stage: 'phase-implementation',
      current_phase: 'p1',
      phases: {
        p1: { implementer: 'in_progress', reviewer: 'pending', verifier: 'pending', prototype: 'pending' },
      },
    })
    writePlan(slugDir, [{ id: 'p1', dependencies: [] }])
    writeFileSync(join(slugDir, 'requirements.md'), '# Requirements\n\nAC-1\n')
    // Whitespace alone is not an artifact the workflow wrote.
    writeFileSync(join(slugDir, 'design.md'), '   \n')
    mkdirSync(join(slugDir, 'phases', 'p1'), { recursive: true })
    writeFileSync(join(slugDir, 'phases', 'p1', 'implementation.md'), '# Implementation\n')

    const ctx = await harness()
    const snapshot = ctx.specdev.snapshot(undefined, { cwd: workspace })
    const rows = snapshot?.artifacts ?? []
    const byPath = new Map(rows.map(row => [row.path, row]))

    expect(byPath.get('.specdev/specs/artifact-demo/requirements.md')).toEqual({
      path: '.specdev/specs/artifact-demo/requirements.md',
      label: 'requirements.md',
      phaseId: null,
      status: 'ready',
    })
    expect(byPath.get('.specdev/specs/artifact-demo/design.md')?.status).toBe('missing')
    expect(byPath.get('.specdev/specs/artifact-demo/phase-plan.md')?.status).toBe('ready')
    expect(byPath.get('.specdev/specs/artifact-demo/phases/p1/implementation.md')).toEqual({
      path: '.specdev/specs/artifact-demo/phases/p1/implementation.md',
      label: 'implementation.md',
      phaseId: 'p1',
      status: 'ready',
    })
    expect(byPath.get('.specdev/specs/artifact-demo/phases/p1/verification.md')?.status).toBe('missing')
    // Every workflow-level row precedes the phase rows, which keep plan order.
    expect(rows.slice(0, 3).map(row => row.phaseId)).toEqual([null, null, null])
    expect(rows.slice(3).every(row => row.phaseId === 'p1')).toBe(true)
  })

  it('lists visual-baseline.md only for a UI workflow and review-visual.md only for a UI phase', async () => {
    const uiWorkspace = tempDir('specdev-artifacts-ui-')
    const uiSlugDir = seedWorkflow(uiWorkspace, 'ui-demo', {
      ...createInitialStatus('ui-demo'),
      current_stage: 'phase-implementation',
      current_phase: 'p1',
      phases: {
        p1: { implementer: 'in_progress', reviewer: 'pending', verifier: 'pending', prototype: 'pending' },
        p2: { implementer: 'pending', reviewer: 'pending', verifier: 'pending', prototype: 'pending' },
      },
    })
    writePlan(uiSlugDir, [
      { id: 'p1', dependencies: [], ui: false },
      { id: 'p2', dependencies: ['p1'], ui: true },
    ])

    const uiCtx = await harness()
    const uiSnapshot = uiCtx.specdev.snapshot(undefined, { cwd: uiWorkspace })
    const uiRows = uiSnapshot?.artifacts ?? []
    expect(uiSnapshot?.ui).toEqual({ workflow: true, phases: { p1: false, p2: true } })
    expect(uiRows.find(row => row.label === 'visual-baseline.md')?.phaseId).toBeNull()
    expect(phaseArtifacts(uiRows, 'p1')).not.toHaveProperty('review-visual.md')
    expect(phaseArtifacts(uiRows, 'p2')).toHaveProperty('review-visual.md', 'missing')

    const plainWorkspace = tempDir('specdev-artifacts-plain-')
    const plainSlugDir = seedWorkflow(plainWorkspace, 'plain-demo', {
      ...createInitialStatus('plain-demo'),
      current_stage: 'phase-implementation',
      current_phase: 'p1',
      phases: {
        p1: { implementer: 'in_progress', reviewer: 'pending', verifier: 'pending', prototype: 'pending' },
      },
    })
    writePlan(plainSlugDir, [{ id: 'p1', dependencies: [], ui: false }])

    const plainCtx = await harness()
    const plainSnapshot = plainCtx.specdev.snapshot(undefined, { cwd: plainWorkspace })
    expect(plainSnapshot?.ui).toEqual({ workflow: false, phases: { p1: false } })
    expect(plainSnapshot?.artifacts?.map(row => row.label)).not.toContain('visual-baseline.md')
    expect(plainSnapshot?.artifacts?.map(row => row.label)).not.toContain('review-visual.md')
  })
})
