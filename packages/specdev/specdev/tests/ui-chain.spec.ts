/**
 * SpecDev visual chain: `ui` declarations in the phase plan, HG-1.5 ordering
 * before HG-2, and the per-phase prototype gate (feature UI line, phase 2).
 */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import SpecdevService, {
  hasPrototypeSection,
  parsePhasePlanDag,
  phaseUiDeclarations,
  phaseUiOf,
  PROTOTYPE_HEADING,
  uiWorkflowOf,
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

/** Write a `phase-plan.md` carrying one `json` fence. */
function writePlan(slugDir: string, phases: readonly Record<string, unknown>[]): void {
  const body = JSON.stringify({ phases }, null, 2)
  writeFileSync(join(slugDir, 'phase-plan.md'), `# Phase Plan\n\n\`\`\`json\n${body}\n\`\`\`\n`)
}

/** Boot the service over a fresh workspace with one active workflow. */
async function uiHarness(prefix: string): Promise<{
  ctx: Context
  session: ReturnType<Context['sessions']['create']>
  workspace: string
  slugDir: string
}> {
  const workspace = tempDir(prefix)
  const ctx = new Context()
  await ctx.plugin(SessionStore)
  await ctx.plugin(SessionProjectionRegistry)
  await ctx.plugin(SpecdevService)
  const session = ctx.sessions.create(SessionId(`specdev-ui-${Math.random()}`), {
    meta: { cwd: workspace },
  })
  await ctx.specdev.ensureLayout({ slug: 'ui-demo', command: 'feature', workspaceRoot: workspace })
  const slugDir = join(workspace, '.specdev', 'specs', 'ui-demo')
  return { ctx, session, workspace, slugDir }
}

describe('phase-plan ui declaration', () => {
  it('parses ui: true and ui: false, and leaves it absent when unsaid', () => {
    const dag = parsePhasePlanDag({
      phases: [
        { id: 'p1', dependencies: [], ui: true },
        { id: 'p2', dependencies: ['p1'], ui: false },
        { id: 'p3', dependencies: ['p2'] },
      ],
    })
    expect(phaseUiOf(dag, 'p1')).toBe(true)
    expect(phaseUiOf(dag, 'p2')).toBe(false)
    expect(phaseUiOf(dag, 'p3')).toBeUndefined()
    expect(phaseUiOf(dag, 'missing')).toBeUndefined()
  })

  it('rejects a ui declaration that is not a boolean', () => {
    expect(() => parsePhasePlanDag({ phases: [{ id: 'p1', dependencies: [], ui: 'yes' }] }))
      .toThrow(/ui must be a boolean/)
  })
})

describe('ui chain declarations', () => {
  it('reads a workflow with a UI phase and its per-phase declarations', () => {
    const slugDir = tempDir('specdev-ui-decl-')
    writePlan(slugDir, [
      { id: 'p1', dependencies: [], ui: false },
      { id: 'p2', dependencies: ['p1'], ui: true },
    ])
    expect(uiWorkflowOf(slugDir)).toBe(true)
    expect(phaseUiDeclarations(slugDir)).toEqual({ p1: false, p2: true })
  })

  it('reports false for a workflow without a plan, and unknown per phase', () => {
    const slugDir = tempDir('specdev-ui-noplan-')
    expect(uiWorkflowOf(slugDir)).toBe(false)
    expect(phaseUiDeclarations(slugDir)).toEqual({})
  })

  it('reports unknown when the plan exists but cannot be parsed', () => {
    const slugDir = tempDir('specdev-ui-broken-')
    writeFileSync(join(slugDir, 'phase-plan.md'), '# Phase Plan\n\nno fence here\n')
    expect(uiWorkflowOf(slugDir)).toBe('unknown')
    expect(phaseUiDeclarations(slugDir)).toEqual({})
  })

  it('reports a phase whose plan omits ui as unknown', () => {
    const slugDir = tempDir('specdev-ui-silent-')
    writePlan(slugDir, [{ id: 'p1', dependencies: [] }])
    expect(uiWorkflowOf(slugDir)).toBe(false)
    expect(phaseUiDeclarations(slugDir)).toEqual({ p1: 'unknown' })
  })

  it('reads the prototype section from the phase implementation', () => {
    const phaseDir = tempDir('specdev-ui-prototype-')
    expect(hasPrototypeSection(phaseDir)).toBe(false)
    writeFileSync(join(phaseDir, 'implementation.md'), '# Phase 1\n\n## Design\n')
    expect(hasPrototypeSection(phaseDir)).toBe(false)
    writeFileSync(join(phaseDir, 'implementation.md'), `# Phase 1\n\n${PROTOTYPE_HEADING}（待确认）\n`)
    expect(hasPrototypeSection(phaseDir)).toBe(true)
  })
})

describe('HG-1.5 and the prototype gate', () => {
  it('orders HG-1.5 before HG-2 once the plan declares a UI phase', async () => {
    const { ctx, session, workspace, slugDir } = await uiHarness('specdev-ui-order-')
    writeFileSync(join(slugDir, 'requirements.md'), '# Requirements\n\nAC-1\n')
    await ctx.specdev.confirmGate(session, { gate: 'hg1', decision: 'pass' }, { cwd: workspace })
    expect(ctx.specdev.snapshot(undefined, { cwd: workspace })?.pendingGate).toBe('hg2')

    writePlan(slugDir, [{ id: 'p1', dependencies: [], ui: true }])
    const snap = ctx.specdev.snapshot(undefined, { cwd: workspace })
    expect(snap?.pendingGate).toBe('hg1_5')
    expect(snap?.ui).toEqual({ workflow: true, phases: { p1: true } })

    writeFileSync(join(slugDir, 'visual-baseline.md'), '# Visual Baseline\n\n## 2. 推荐与选定\n\n候选 B\n')
    const passed = await ctx.specdev.confirmGate(
      session,
      { gate: 'hg1_5', decision: 'pass', note: '候选 B' },
      { cwd: workspace },
    )
    expect(passed.ok).toBe(true)
    expect(passed.snapshot?.gates.hg1_5).toBe('passed')
    expect(passed.snapshot?.pendingGate).toBe('hg2')

    writeFileSync(join(slugDir, 'design.md'), '# Design\n')
    const hg2 = await ctx.specdev.confirmGate(session, { gate: 'hg2', decision: 'pass' }, { cwd: workspace })
    expect(hg2.ok).toBe(true)
    expect(hg2.snapshot?.phase).toBe('p1')
    expect(hg2.snapshot?.steps.p1).toEqual({
      implementer: 'pending',
      reviewer: 'pending',
      verifier: 'pending',
      prototype: 'pending',
    })
  })

  it('refuses HG-1.5 without HG-1, without a UI phase, and without a baseline', async () => {
    const { ctx, session, workspace, slugDir } = await uiHarness('specdev-ui-refuse-')
    mkdirSync(slugDir, { recursive: true })
    writePlan(slugDir, [{ id: 'p1', dependencies: [], ui: true }])
    const early = await ctx.specdev.confirmGate(session, { gate: 'hg1_5', decision: 'pass' }, { cwd: workspace })
    expect(early).toMatchObject({ ok: false, code: 'SPECDEV_GATE_PRECONDITION' })

    writeFileSync(join(slugDir, 'requirements.md'), '# Requirements\n\nAC-1\n')
    await ctx.specdev.confirmGate(session, { gate: 'hg1', decision: 'pass' }, { cwd: workspace })
    const noBaseline = await ctx.specdev.confirmGate(session, { gate: 'hg1_5', decision: 'pass' }, { cwd: workspace })
    expect(noBaseline).toMatchObject({ ok: false, code: 'SPECDEV_GATE_PRECONDITION' })

    writePlan(slugDir, [{ id: 'p1', dependencies: [], ui: false }])
    const noUi = await ctx.specdev.confirmGate(session, { gate: 'hg1_5', decision: 'pass' }, { cwd: workspace })
    expect(noUi).toMatchObject({ ok: false, code: 'SPECDEV_GATE_NOT_APPLICABLE' })
  })

  it('refuses HG-2 while HG-1.5 is pending in a UI workflow', async () => {
    const { ctx, session, workspace, slugDir } = await uiHarness('specdev-ui-hg2-')
    writeFileSync(join(slugDir, 'requirements.md'), '# Requirements\n\nAC-1\n')
    await ctx.specdev.confirmGate(session, { gate: 'hg1', decision: 'pass' }, { cwd: workspace })
    writePlan(slugDir, [{ id: 'p1', dependencies: [], ui: true }])
    writeFileSync(join(slugDir, 'design.md'), '# Design\n')

    const refused = await ctx.specdev.confirmGate(session, { gate: 'hg2', decision: 'pass' }, { cwd: workspace })
    expect(refused).toMatchObject({ ok: false, code: 'SPECDEV_GATE_PRECONDITION' })

    writeFileSync(join(slugDir, 'visual-baseline.md'), '# Visual Baseline\n')
    await ctx.specdev.confirmGate(session, { gate: 'hg1_5', decision: 'pass' }, { cwd: workspace })
    const allowed = await ctx.specdev.confirmGate(session, { gate: 'hg2', decision: 'pass' }, { cwd: workspace })
    expect(allowed.ok).toBe(true)
  })

  it('confirms a prototype only for a UI phase whose implementation shows one', async () => {
    const { ctx, session, workspace, slugDir } = await uiHarness('specdev-ui-prototype-gate-')
    writeFileSync(join(slugDir, 'requirements.md'), '# Requirements\n\nAC-1\n')
    await ctx.specdev.confirmGate(session, { gate: 'hg1', decision: 'pass' }, { cwd: workspace })
    writePlan(slugDir, [{ id: 'p1', dependencies: [], ui: true }])
    writeFileSync(join(slugDir, 'visual-baseline.md'), '# Visual Baseline\n')
    await ctx.specdev.confirmGate(session, { gate: 'hg1_5', decision: 'pass' }, { cwd: workspace })
    writeFileSync(join(slugDir, 'design.md'), '# Design\n')
    await ctx.specdev.confirmGate(session, { gate: 'hg2', decision: 'pass' }, { cwd: workspace })

    const noSection = await ctx.specdev.confirmGate(session, { gate: 'prototype', decision: 'pass' }, { cwd: workspace })
    expect(noSection).toMatchObject({ ok: false, code: 'SPECDEV_GATE_PRECONDITION' })

    const phaseDir = join(slugDir, 'phases', 'p1')
    mkdirSync(phaseDir, { recursive: true })
    writeFileSync(join(phaseDir, 'implementation.md'), `# Phase 1\n\n${PROTOTYPE_HEADING}（待确认）\n`)
    const confirmed = await ctx.specdev.confirmGate(
      session,
      { gate: 'prototype', decision: 'pass', note: '布局可以' },
      { cwd: workspace },
    )
    expect(confirmed.ok).toBe(true)
    expect(confirmed.snapshot?.steps.p1?.prototype).toBe('passed')

    const again = await ctx.specdev.confirmGate(session, { gate: 'prototype', decision: 'pass' }, { cwd: workspace })
    expect(again).toMatchObject({ ok: false, code: 'SPECDEV_GATE_ALREADY_PASSED' })

    const deferred = await ctx.specdev.confirmGate(session, { gate: 'prototype', decision: 'defer' }, { cwd: workspace })
    expect(deferred.ok).toBe(true)
    expect(deferred.snapshot?.steps.p1?.prototype).toBe('passed')

    const bogus = await ctx.specdev.confirmGate(session, { gate: 'prototype', decision: 'resolve' }, { cwd: workspace })
    expect(bogus).toMatchObject({ ok: false, code: 'SPECDEV_INVALID_DECISION' })
  })

  it('refuses the prototype gate for a phase the plan does not declare as UI', async () => {
    const { ctx, session, workspace, slugDir } = await uiHarness('specdev-ui-notdeclared-')
    writeFileSync(join(slugDir, 'requirements.md'), '# Requirements\n\nAC-1\n')
    await ctx.specdev.confirmGate(session, { gate: 'hg1', decision: 'pass' }, { cwd: workspace })
    writePlan(slugDir, [{ id: 'p1', dependencies: [], ui: false }])
    writeFileSync(join(slugDir, 'design.md'), '# Design\n')
    await ctx.specdev.confirmGate(session, { gate: 'hg2', decision: 'pass' }, { cwd: workspace })

    const refused = await ctx.specdev.confirmGate(session, { gate: 'prototype', decision: 'pass' }, { cwd: workspace })
    expect(refused).toMatchObject({ ok: false, code: 'SPECDEV_UI_NOT_DECLARED' })
  })

  it('refuses the prototype gate without a current phase', async () => {
    const { ctx, session, workspace, slugDir } = await uiHarness('specdev-ui-nophase-')
    mkdirSync(slugDir, { recursive: true })
    const refused = await ctx.specdev.confirmGate(session, { gate: 'prototype', decision: 'pass' }, { cwd: workspace })
    expect(refused).toMatchObject({ ok: false, code: 'SPECDEV_PHASE_INVALID' })
  })
})

describe('review merge over the visual chain', () => {
  it('requires review-visual.md only for a phase the plan declares as UI', async () => {
    const { ctx, session, workspace, slugDir } = await uiHarness('specdev-ui-merge-')
    writePlan(slugDir, [
      { id: 'p1', dependencies: [], ui: true },
      { id: 'p2', dependencies: ['p1'], ui: false },
    ])
    const p1 = join(slugDir, 'phases', 'p1')
    const p2 = join(slugDir, 'phases', 'p2')
    for (const phaseDir of [p1, p2]) {
      mkdirSync(phaseDir, { recursive: true })
      writeFileSync(join(phaseDir, 'review-correctness.md'), '## 判决：PASS\nok\n')
      writeFileSync(join(phaseDir, 'review-design.md'), '## 判决：PASS\nok\n')
      writeFileSync(join(phaseDir, 'review-connectivity.md'), '## 判决：PASS\nok\n')
    }
    expect(() => ctx.specdev.mergePhaseReviews(session, 'p1', { cwd: workspace }))
      .toThrow(/review-visual\.md/)
    expect(ctx.specdev.mergePhaseReviews(session, 'p2', { cwd: workspace }).verdict).toBe('PASS')

    writeFileSync(join(p1, 'review-visual.md'), '## 判决：MUST-FIX\nhardcoded #fff\n')
    const merged = ctx.specdev.mergePhaseReviews(session, 'p1', { cwd: workspace })
    expect(merged.verdict).toBe('MUST-FIX')
    expect(merged.perspectives.map(perspective => perspective.name))
      .toEqual(['correctness', 'design', 'connectivity', 'visual'])
  })
})
