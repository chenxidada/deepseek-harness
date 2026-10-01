/**
 * `SpecdevService` branches: workspace resolution without an explicit cwd, the
 * layout bootstrap and its validation, the phase-runtime pass-throughs, the
 * two snapshot sources, and every confirmGate refusal / progression path that
 * the integration specs do not reach.
 */

import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import AgentRegistry, { type Agent, type AgentStatus } from '@deepseek-ai/dsh-agent'
import SessionStore, { SessionId, type Session } from '@deepseek-ai/dsh-session'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import SpecdevService, {
  appendWorkflowLog,
  attachSpecdevMetadata,
  createInitialStatus,
  emitAdvanceForAgent,
  readSpecdevMetadata,
  type CurrentStatusJson,
  type SpecdevGateId,
  MemoryInbox,
} from '@deepseek-ai/dsh-specdev'

const tempRoots: string[] = []

afterEach(() => {
  vi.restoreAllMocks()
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

/** Run `body` with `process.cwd()` inside a directory that has no `.specdev`. */
async function withoutRepoLayout<T>(body: () => T | Promise<T>): Promise<T> {
  const spy = vi.spyOn(process, 'cwd').mockReturnValue(tempDir('specdev-no-layout-'))
  try {
    return await body()
  } finally {
    spy.mockRestore()
  }
}

function stubAgent(session: Session): Agent {
  const inbox = new MemoryInbox()
  const status: AgentStatus = 'idle'
  return {
    id: session.id,
    options: {},
    session,
    inbox,
    ctx: new Context(),
    get status() { return status },
    send: () => {},
    followup: () => {},
    steer: () => {},
    inject(input) { inbox.append('next-step', input) },
    cancel() {},
    runMaintenance: task => task(new AbortController().signal),
    whenIdle() { return Promise.resolve() },
  }
}

/** Durable status of a workflow with the given overrides. */
function statusWith(slug: string, overrides: Partial<CurrentStatusJson> = {}): CurrentStatusJson {
  return {
    ...createInitialStatus(slug, 'feature', { initiating_command: 'feature', pipeline_mode: 'feature' }),
    ...overrides,
  }
}

/** Append the log lines and the derived mirror for one durable status. */
async function seedWorkflow(slugDir: string, status: CurrentStatusJson): Promise<void> {
  const logPath = join(slugDir, 'workflow.jsonl')
  await appendWorkflowLog(logPath, 'workflow/init', {
    slug: basename(slugDir),
    command: status.initiating_command ?? 'feature',
    created: status.created,
  })
  await appendWorkflowLog(logPath, 'workflow/state', {
    reason: 'test-seed',
    patch: {
      current_stage: status.current_stage,
      current_phase: status.current_phase,
      loop_count: status.loop_count,
      phases: status.phases,
      human_gates: status.human_gates,
    },
  })
  writeFileSync(join(slugDir, 'current-status.json'), `${JSON.stringify(status, null, 2)}\n`)
}

interface Fixture {
  readonly ctx: Context
  readonly session: Session
  readonly agent: Agent
  readonly workspace: string
  readonly slug: string
  readonly slugDir: string
}

/** Seeded workflow plus a live service; `sessionCwd: false` models a cwd-less session. */
async function fixture(
  prefix: string,
  status: CurrentStatusJson,
  files: Record<string, string> = {},
  sessionCwd = true,
): Promise<Fixture> {
  const workspace = tempDir(prefix)
  const slugDir = join(workspace, '.specdev', 'specs', status.slug)
  mkdirSync(slugDir, { recursive: true })
  writeFileSync(join(workspace, '.specdev', 'active-workflow'), `${status.slug}\n`)
  for (const [name, body] of Object.entries(files)) writeFileSync(join(slugDir, name), body)
  await seedWorkflow(slugDir, status)

  const ctx = new Context()
  await ctx.plugin(SessionStore)
  await ctx.plugin(AgentRegistry)
  await ctx.plugin(SessionProjectionRegistry)
  await ctx.plugin(SpecdevService)
  const session = ctx.sessions.create(SessionId(`svc-${Math.random()}`), sessionCwd ? { meta: { cwd: workspace } } : {})
  const agent = stubAgent(session)
  ctx.agents.register(agent)
  return { ctx, session, agent, workspace, slug: status.slug, slugDir }
}

function phasePlan(...phases: { id: string; dependencies: string[]; ui?: boolean }[]): string {
  return `# Plan\n\n\`\`\`json\n${JSON.stringify({ phases }, null, 2)}\n\`\`\`\n`
}

/** Gates passed through HG-2, stopped at the given phase. */
function atPhase(slug: string, phaseId: string, phases: CurrentStatusJson['phases']): CurrentStatusJson {
  return statusWith(slug, {
    human_gates: { hg1_5: 'passed', hg1: 'passed', hg2: 'passed', hg3: 'pending' },
    current_stage: 'phase-implementation',
    current_phase: phaseId,
    phases,
  })
}

const COMPLETED_PHASE = { implementer: 'completed', reviewer: 'completed', verifier: 'completed', prototype: 'pending' } as const
const PENDING_PHASE = { implementer: 'pending', reviewer: 'pending', verifier: 'pending', prototype: 'pending' } as const
const DEBT_ROW = '| STUB-A | phase-1 | m | f:a | current | expected | 空实现 | module:m | x | phase-2 | 🔴阻塞 | impl | 2026-09-08 |'
const DEBT_REGISTRY = `# Tech Debt\n\n## 活跃债务\n\n| ID | 源Phase | 模块 | 文件:函数:行号 | 当前行为 | 预期行为 | 类型 | 标签 | 依赖它的模块 | 目标Phase | 阻塞 | 来源 | 注册日期 |\n|----|:------:|------|---------------|---------|---------|------|------|-------------|:--------:|:---:|------|---------|\n${DEBT_ROW}\n\n## 已解决\n\n| ID | 源Phase | 描述 | 解决Phase | 解决日期 | 验证方式 |\n|----|:------:|------|:--------:|---------|---------|\n`

describe('SpecdevService workspace resolution', () => {
  it('resolves the active workflow and status from folders without a cwd', async () => {
    const { ctx, workspace, slug } = await fixture('specdev-svc-folders-', statusWith('folded'))
    await withoutRepoLayout(() => {
      expect(ctx.specdev.active({ folders: [workspace] })?.slug).toBe(slug)
      expect(ctx.specdev.readStatus(slug, { folders: [workspace] }).slug).toBe(slug)
    })
  })

  it('refuses an empty slug or command when creating a layout', async () => {
    const { ctx } = await fixture('specdev-svc-invalid-', statusWith('invalid'))
    await expect(ctx.specdev.ensureLayout({ slug: '  ', command: 'feature' }))
      .rejects.toMatchObject({ code: 'SPECDEV_INVALID_SLUG' })
    await expect(ctx.specdev.ensureLayout({ slug: 'wf', command: '' }))
      .rejects.toMatchObject({ code: 'SPECDEV_INVALID_COMMAND' })
  })

  it('keeps an existing template and creates the layout from folders alone', async () => {
    const workspace = tempDir('specdev-svc-ensure-')
    const ctx = new Context()
    await ctx.plugin(SessionStore)
    await ctx.plugin(SessionProjectionRegistry)
    await ctx.plugin(SpecdevService)

    await withoutRepoLayout(() => ctx.specdev.ensureLayout({
      slug: 'from-folders',
      command: 'feature',
      folders: [workspace],
    }))
    const constitution = join(workspace, '.specdev', 'constitution.md')
    expect(existsSync(constitution)).toBe(true)
    writeFileSync(constitution, '# Project Constitution\n\nlocal edit\n')
    await ctx.specdev.ensureLayout({ slug: 'from-folders', command: 'feature', workspaceRoot: workspace })
    expect(readFileSync(constitution, 'utf8')).toContain('local edit')
    expect(ctx.specdev.active({ cwd: workspace })?.slug).toBe('from-folders')
  })

  it('propagates a status read failure that is not a SpecDevError', async () => {
    const workspace = tempDir('specdev-svc-eisdir-')
    const slugDir = join(workspace, '.specdev', 'specs', 'broken')
    mkdirSync(join(slugDir, 'current-status.json'), { recursive: true })
    const ctx = new Context()
    await ctx.plugin(SessionStore)
    await ctx.plugin(SessionProjectionRegistry)
    await ctx.plugin(SpecdevService)
    await expect(ctx.specdev.ensureLayout({ slug: 'broken', command: 'feature', workspaceRoot: workspace }))
      .rejects.toMatchObject({ code: 'EISDIR' })
  })

  it('reports no active workflow for an empty active-workflow file', async () => {
    const workspace = tempDir('specdev-svc-empty-active-')
    mkdirSync(join(workspace, '.specdev'), { recursive: true })
    writeFileSync(join(workspace, '.specdev', 'active-workflow'), '\n')
    const ctx = new Context()
    await ctx.plugin(SessionStore)
    await ctx.plugin(SessionProjectionRegistry)
    await ctx.plugin(SpecdevService)
    expect(ctx.specdev.active({ cwd: workspace })).toBeNull()
    expect(ctx.specdev.snapshot(undefined, { cwd: workspace })).toBeNull()
  })
})

describe('SpecdevService pass-through helpers', () => {
  it('attaches orchestrator metadata through the service', async () => {
    const { ctx, agent, slug } = await fixture('specdev-svc-orchestrator-', statusWith('orch'))
    ctx.specdev.attachOrchestratorMetadata(agent, slug)
    expect(readSpecdevMetadata(agent)).toEqual({ role: 'orchestrator', slug })
  })

  it('completes a phase through the service', async () => {
    const workspace = tempDir('specdev-svc-git-')
    execFileSync('git', ['init', '-b', 'main'], { cwd: workspace, stdio: 'ignore' })
    execFileSync('git', ['config', 'user.email', 'specdev@test'], { cwd: workspace, stdio: 'ignore' })
    execFileSync('git', ['config', 'user.name', 'SpecDev Test'], { cwd: workspace, stdio: 'ignore' })
    writeFileSync(join(workspace, 'README.md'), '# fixture\n')
    execFileSync('git', ['add', 'README.md'], { cwd: workspace, stdio: 'ignore' })
    execFileSync('git', ['commit', '-m', 'init'], { cwd: workspace, stdio: 'ignore' })

    const { ctx } = await fixture('specdev-svc-git-fixture-', statusWith('git-wf'))
    ctx.specdev.ensurePhaseBranch('p1', { cwd: workspace })
    writeFileSync(join(workspace, 'a.ts'), 'export const a = 1\n')
    const result = ctx.specdev.completePhaseGit({ phaseId: 'p1', files: ['a.ts'] }, { cwd: workspace })
    expect(result).toMatchObject({ branch: 'impl-p1', committed: true, merged: true, deleted: true })
  })

  it('reads the tech-debt registry for an explicit slug', async () => {
    const { ctx, workspace, slug } = await fixture(
      'specdev-svc-debt-',
      statusWith('debt-wf'),
      { 'tech-debt-registry.md': DEBT_REGISTRY },
    )
    expect(ctx.specdev.readTechDebt({ slug, cwd: workspace }).active.map(item => item.id)).toEqual(['STUB-A'])
    await withoutRepoLayout(() => {
      expect(ctx.specdev.readTechDebt({ slug, folders: [workspace] }).active.map(item => item.id))
        .toEqual(['STUB-A'])
    })
  })

  it('resets a step through prepareRerun for the implementer', async () => {
    const { ctx, workspace, slugDir } = await fixture(
      'specdev-svc-rerun-',
      atPhase('rerun-wf', 'p1', { p1: COMPLETED_PHASE }),
      { 'phase-plan.md': phasePlan({ id: 'p1', dependencies: [] }) },
    )
    const next = await ctx.specdev.prepareRerun('p1', 'implementer', { cwd: workspace })
    expect(next.phases.p1).toEqual({
      implementer: 'pending',
      reviewer: 'pending',
      verifier: 'pending',
      prototype: 'pending',
    })
    expect(existsSync(join(slugDir, 'workflow.jsonl'))).toBe(true)
  })

  it('requires an active workflow to merge reviews', async () => {
    const { ctx, workspace, slug, slugDir } = await fixture(
      'specdev-svc-merge-',
      atPhase('merge-wf', 'p1', { p1: COMPLETED_PHASE }),
      { 'phase-plan.md': phasePlan({ id: 'p1', dependencies: [] }) },
    )
    mkdirSync(join(slugDir, 'phases', 'p1'), { recursive: true })
    for (const name of ['correctness', 'design', 'connectivity']) {
      writeFileSync(join(slugDir, 'phases', 'p1', `review-${name}.md`), '## 判决：PASS\nok\n')
    }
    // The cwd-less session resolves the workspace from the folder list.
    const cwdless = ctx.sessions.create(SessionId('merge-cwdless'))
    await withoutRepoLayout(() => {
      expect(ctx.specdev.mergePhaseReviews(cwdless, 'p1', { folders: [workspace] }).verdict).toBe('PASS')
    })
    expect(readFileSync(join(slugDir, 'phases', 'p1', 'review.md'), 'utf8')).toContain('## 判决：PASS')
    expect(codeOf(() => ctx.specdev.mergePhaseReviews(cwdless, 'p1', { cwd: tempDir('specdev-svc-merge-empty-') })))
      .toBe('SPECDEV_NO_ACTIVE_WORKFLOW')
    expect(slug).toBe('merge-wf')
  })
})

describe('SpecdevService snapshot sources', () => {
  it('resolves the snapshot cwd from the session or the process', async () => {
    const { ctx, session, workspace } = await fixture('specdev-svc-snapshot-', statusWith('snap-wf'))
    expect(ctx.specdev.snapshot(session, { cwd: workspace })?.slug).toBe('snap-wf')
    const cwdless = ctx.sessions.create(SessionId('snapshot-cwdless'))
    await withoutRepoLayout(() => {
      expect(ctx.specdev.snapshot()).toBeNull()
      expect(ctx.specdev.snapshot(cwdless)).toBeNull()
      expect(ctx.specdev.snapshot(undefined, { folders: [workspace] })?.slug).toBe('snap-wf')
    })
  })

  it('takes nextAction and the debt summary from the session projection', async () => {
    const { ctx, session, slug, workspace, slugDir } = await fixture(
      'specdev-svc-projection-',
      statusWith('proj-wf', { current_stage: 'requirement-analysis' }),
      { 'requirements.md': '# Requirements\n\nAC-1\n', 'tech-debt-registry.md': DEBT_REGISTRY },
    )
    const childSession = ctx.sessions.create(SessionId('proj-child'), {
      meta: { cwd: workspace, parentSession: session.id, origin: 'subagent' },
    })
    const child = stubAgent(childSession)
    attachSpecdevMetadata(child, { role: 'implementer', slug })
    ctx.agents.register(child)

    await ctx.specdev.confirmGate(session, { gate: 'hg1', decision: 'pass' }, { cwd: workspace })
    emitAdvanceForAgent(ctx, child)
    expect(ctx.specdev.snapshot(session, { cwd: workspace })?.nextAction).toContain('implementer completed')

    // The mirror carries no debt summary once the registry is gone, while the
    // projection still holds the one the gate decision recorded.
    rmSync(join(slugDir, 'tech-debt-registry.md'))
    const snap = ctx.specdev.snapshot(session, { cwd: workspace })
    expect(snap?.techDebtSummary).toEqual({ blocking: 1, total: 1 })
  })
})

describe('confirmGate refusals', () => {
  it('refuses an unknown gate and an empty decision', async () => {
    const { ctx, session, workspace } = await fixture('specdev-svc-gate-invalid-', statusWith('gate-wf'))
    const unknown = await ctx.specdev.confirmGate(
      session,
      { gate: 'hg9' as SpecdevGateId, decision: 'pass' },
      { cwd: workspace },
    )
    expect(unknown).toMatchObject({ ok: false, code: 'SPECDEV_INVALID_GATE' })
    const empty = await ctx.specdev.confirmGate(session, { gate: 'hg1', decision: '   ' }, { cwd: workspace })
    expect(empty).toMatchObject({ ok: false, code: 'SPECDEV_INVALID_DECISION' })
  })

  it('refuses a decision without an active workflow', async () => {
    const { ctx, session } = await fixture('specdev-svc-gate-none-', statusWith('gate-none'))
    const emptyDir = tempDir('specdev-svc-gate-empty-')
    const result = await ctx.specdev.confirmGate(session, { gate: 'hg1', decision: 'pass' }, { cwd: emptyDir })
    expect(result).toMatchObject({ ok: false, code: 'SPECDEV_NO_ACTIVE_WORKFLOW' })
  })

  it('reports a durable status failure and rethrows an unreadable mirror', async () => {
    const missing = await fixture('specdev-svc-gate-missing-', statusWith('gone'))
    rmSync(missing.slugDir, { recursive: true, force: true })
    const result = await missing.ctx.specdev.confirmGate(
      missing.session,
      { gate: 'hg1', decision: 'pass' },
      { cwd: missing.workspace },
    )
    expect(result).toMatchObject({ ok: false, code: 'SPECDEV_STATUS_MISSING' })

    const broken = await fixture('specdev-svc-gate-broken-', statusWith('broken-mirror'))
    rmSync(broken.slugDir, { recursive: true, force: true })
    mkdirSync(join(broken.slugDir, 'current-status.json'), { recursive: true })
    await expect(broken.ctx.specdev.confirmGate(
      broken.session,
      { gate: 'hg1', decision: 'pass' },
      { cwd: broken.workspace },
    )).rejects.toMatchObject({ code: 'EISDIR' })
  })

  it('resolves the gate workspace from folders for a cwd-less session', async () => {
    const { ctx, session, workspace, slug } = await fixture(
      'specdev-svc-gate-folders-',
      statusWith('folder-gate'),
      { 'requirements.md': '# Requirements\n\nAC-1\n' },
      false,
    )
    await withoutRepoLayout(async () => {
      const result = await ctx.specdev.confirmGate(
        session,
        { gate: 'hg1', decision: 'pass' },
        { folders: [workspace] },
      )
      expect(result.ok).toBe(true)
      expect(result.snapshot?.slug).toBe(slug)
    })
  })
})

describe('confirmGate gate paths', () => {
  it('refuses the prototype gate for a phase the plan never declares', async () => {
    const { ctx, session, workspace } = await fixture(
      'specdev-svc-prototype-unknown-',
      atPhase('proto-wf', 'p1', { p1: PENDING_PHASE }),
    )
    const result = await ctx.specdev.confirmGate(session, { gate: 'prototype', decision: 'pass' }, { cwd: workspace })
    expect(result).toMatchObject({ ok: false, code: 'SPECDEV_UI_NOT_DECLARED' })
    expect(result.message).toContain('ui: unknown')
  })

  it('refuses a phase-entry decision outside the allowed set', async () => {
    const { ctx, session, workspace } = await fixture(
      'specdev-svc-entry-decision-',
      atPhase('entry-wf', 'p2', { p2: PENDING_PHASE }),
      { 'phase-plan.md': phasePlan({ id: 'p1', dependencies: [] }, { id: 'p2', dependencies: ['p1'] }) },
    )
    const result = await ctx.specdev.confirmGate(
      session,
      { gate: 'phase-entry', decision: 'reject', phaseEntry: [{ itemIds: ['STUB-A'], disposition: 'resolve' }] },
      { cwd: workspace },
    )
    expect(result).toMatchObject({ ok: false, code: 'SPECDEV_INVALID_DECISION' })
  })

  it('accepts a phase-entry decision that lists no items', async () => {
    const { ctx, session, workspace } = await fixture(
      'specdev-svc-entry-empty-',
      atPhase('entry-empty-wf', 'p2', { p2: PENDING_PHASE }),
    )
    const result = await ctx.specdev.confirmGate(
      session,
      { gate: 'phase-entry', decision: 'resolve' },
      { cwd: workspace },
    )
    expect(result.ok).toBe(true)
  })

  it('refuses a decision when no gate is pending', async () => {
    const { ctx, session, workspace } = await fixture(
      'specdev-svc-gate-none-pending-',
      statusWith('none-pending-wf', {
        human_gates: { hg1_5: 'passed', hg1: 'passed', hg2: 'passed', hg3: 'passed' },
        current_stage: 'phase-implementation',
        current_phase: null,
      }),
    )
    const result = await ctx.specdev.confirmGate(session, { gate: 'hg1', decision: 'reject' }, { cwd: workspace })
    expect(result).toMatchObject({ ok: false, code: 'SPECDEV_GATE_NOT_PENDING' })
    expect(result.message).toContain('(none)')
  })

  it('drops a resolved debt row recorded on the phase-entry decision', async () => {
    const { ctx, session, workspace, slugDir } = await fixture(
      'specdev-svc-entry-resolve-',
      atPhase('resolve-wf', 'p2', { p2: PENDING_PHASE }),
      { 'phase-plan.md': phasePlan({ id: 'p1', dependencies: [] }, { id: 'p2', dependencies: ['p1'] }), 'tech-debt-registry.md': DEBT_REGISTRY },
    )
    const result = await ctx.specdev.confirmGate(
      session,
      { gate: 'phase-entry', decision: 'resolve', phaseEntry: [{ itemIds: ['STUB-A'], disposition: 'resolve' }] },
      { cwd: workspace },
    )
    expect(result.ok).toBe(true)
    expect(ctx.specdev.readTechDebt({ slug: 'resolve-wf', cwd: workspace }).active).toEqual([])
    expect(readFileSync(join(slugDir, 'tech-debt-registry.md'), 'utf8')).not.toContain('STUB-A')
  })

  it('rewrites the target phase of a deferred debt row', async () => {
    const { ctx, session, workspace } = await fixture(
      'specdev-svc-entry-defer-',
      atPhase('defer-wf', 'p2', { p2: PENDING_PHASE }),
      { 'phase-plan.md': phasePlan({ id: 'p1', dependencies: [] }, { id: 'p2', dependencies: ['p1'] }), 'tech-debt-registry.md': DEBT_REGISTRY },
    )
    const result = await ctx.specdev.confirmGate(
      session,
      {
        gate: 'phase-entry',
        decision: 'defer',
        phaseEntry: [{ itemIds: ['STUB-A'], disposition: 'defer', deferredTargetPhase: 'phase-9' }],
      },
      { cwd: workspace },
    )
    expect(result.ok).toBe(true)
    expect(ctx.specdev.readTechDebt({ slug: 'defer-wf', cwd: workspace }).active[0]?.targetPhase).toBe('phase-9')
  })

  it('reports a missing registry and rethrows a malformed defer target', async () => {
    const missingRegistry = await fixture(
      'specdev-svc-entry-noregistry-',
      atPhase('noreg-wf', 'p2', { p2: PENDING_PHASE }),
    )
    const missing = await missingRegistry.ctx.specdev.confirmGate(
      missingRegistry.session,
      { gate: 'phase-entry', decision: 'resolve', phaseEntry: [{ itemIds: ['STUB-A'], disposition: 'resolve' }] },
      { cwd: missingRegistry.workspace },
    )
    expect(missing).toMatchObject({ ok: false, code: 'SPECDEV_DEBT_MISSING' })

    const malformed = await fixture(
      'specdev-svc-entry-malformed-',
      atPhase('malformed-wf', 'p2', { p2: PENDING_PHASE }),
      { 'tech-debt-registry.md': DEBT_REGISTRY },
    )
    await expect(malformed.ctx.specdev.confirmGate(
      malformed.session,
      {
        gate: 'phase-entry',
        decision: 'defer',
        phaseEntry: [{ itemIds: ['STUB-A'], disposition: 'defer', deferredTargetPhase: 7 as unknown as string }],
      },
      { cwd: malformed.workspace },
    )).rejects.toThrow(TypeError)
  })

  it('refuses a gate that is already passed', async () => {
    const { ctx, session, workspace } = await fixture(
      'specdev-svc-gate-passed-',
      statusWith('passed-wf', { human_gates: { hg1_5: 'pending', hg1: 'passed', hg2: 'pending', hg3: 'pending' } }),
      { 'requirements.md': '# Requirements\n\nAC-1\n' },
    )
    const result = await ctx.specdev.confirmGate(session, { gate: 'hg1', decision: 'pass' }, { cwd: workspace })
    expect(result).toMatchObject({ ok: false, code: 'SPECDEV_GATE_ALREADY_PASSED' })
  })

  it('refuses an HG-3 pass on a workflow that already completed', async () => {
    const { ctx, session, workspace } = await fixture(
      'specdev-svc-gate-complete-',
      statusWith('complete-wf', {
        human_gates: { hg1_5: 'passed', hg1: 'passed', hg2: 'passed', hg3: 'passed' },
        current_stage: 'phase-implementation',
        current_phase: null,
      }),
    )
    const result = await ctx.specdev.confirmGate(session, { gate: 'hg3', decision: 'pass' }, { cwd: workspace })
    expect(result).toMatchObject({ ok: false, code: 'SPECDEV_GATE_ALREADY_PASSED' })
  })

  it('refuses HG-3 while HG-2 is pending', async () => {
    const { ctx, session, workspace } = await fixture(
      'specdev-svc-hg3-order-',
      statusWith('order-wf', {
        human_gates: { hg1_5: 'passed', hg1: 'passed', hg2: 'pending', hg3: 'pending' },
        current_phase: 'p1',
      }),
      { 'phase-plan.md': phasePlan({ id: 'p1', dependencies: [] }) },
    )
    const result = await ctx.specdev.confirmGate(session, { gate: 'hg3', decision: 'pass' }, { cwd: workspace })
    expect(result).toMatchObject({ ok: false, code: 'SPECDEV_GATE_PRECONDITION' })
  })

  it('refuses HG-2 without design.md or phase-plan.md', async () => {
    const noDesign = await fixture(
      'specdev-svc-hg2-design-',
      statusWith('design-wf', { human_gates: { hg1_5: 'pending', hg1: 'passed', hg2: 'pending', hg3: 'pending' } }),
      { 'requirements.md': '# Requirements\n\nAC-1\n' },
    )
    expect(await noDesign.ctx.specdev.confirmGate(noDesign.session, { gate: 'hg2', decision: 'pass' }, { cwd: noDesign.workspace }))
      .toMatchObject({ ok: false, code: 'SPECDEV_GATE_PRECONDITION' })

    const noPlan = await fixture(
      'specdev-svc-hg2-plan-',
      statusWith('plan-wf', { human_gates: { hg1_5: 'pending', hg1: 'passed', hg2: 'pending', hg3: 'pending' } }),
      { 'requirements.md': '# Requirements\n\nAC-1\n', 'design.md': '# Design\n' },
    )
    expect(await noPlan.ctx.specdev.confirmGate(noPlan.session, { gate: 'hg2', decision: 'pass' }, { cwd: noPlan.workspace }))
      .toMatchObject({ ok: false, code: 'SPECDEV_GATE_PRECONDITION' })
  })

  it('refuses HG-2 when the phase plan declares no phase', async () => {
    const { ctx, session, workspace } = await fixture(
      'specdev-svc-hg2-empty-',
      statusWith('empty-plan-wf', { human_gates: { hg1_5: 'pending', hg1: 'passed', hg2: 'pending', hg3: 'pending' } }),
      {
        'requirements.md': '# Requirements\n\nAC-1\n',
        'design.md': '# Design\n',
        'phase-plan.md': '# Plan\n\n```json\n{"phases":[]}\n```\n',
      },
    )
    const result = await ctx.specdev.confirmGate(session, { gate: 'hg2', decision: 'pass' }, { cwd: workspace })
    expect(result).toMatchObject({ ok: false, code: 'SPECDEV_PHASE_PLAN_INVALID' })
  })

  it('refuses HG-2 when the phase plan cannot be parsed', async () => {
    const { ctx, session, workspace } = await fixture(
      'specdev-svc-hg2-unparsable-',
      statusWith('bad-plan-wf', { human_gates: { hg1_5: 'pending', hg1: 'passed', hg2: 'pending', hg3: 'pending' } }),
      {
        'requirements.md': '# Requirements\n\nAC-1\n',
        'design.md': '# Design\n',
        'phase-plan.md': '# Plan\n\nno fence here\n',
      },
    )
    const result = await ctx.specdev.confirmGate(session, { gate: 'hg2', decision: 'pass' }, { cwd: workspace })
    expect(result).toMatchObject({ ok: false, code: 'SPECDEV_PHASE_PLAN_INVALID' })
  })

  it('refuses HG-3 without a current phase or without a readable plan', async () => {
    const noPhase = await fixture(
      'specdev-svc-hg3-nophase-',
      statusWith('nophase-wf', {
        human_gates: { hg1_5: 'passed', hg1: 'passed', hg2: 'passed', hg3: 'pending' },
        current_stage: 'phase-implementation',
        current_phase: null,
      }),
      { 'phase-plan.md': phasePlan({ id: 'p1', dependencies: [] }) },
    )
    expect(await noPhase.ctx.specdev.confirmGate(noPhase.session, { gate: 'hg3', decision: 'pass' }, { cwd: noPhase.workspace }))
      .toMatchObject({ ok: false, code: 'SPECDEV_PHASE_INVALID' })

    const noPlan = await fixture(
      'specdev-svc-hg3-noplan-',
      atPhase('noplan-wf', 'p1', { p1: COMPLETED_PHASE }),
    )
    expect(await noPlan.ctx.specdev.confirmGate(noPlan.session, { gate: 'hg3', decision: 'pass' }, { cwd: noPlan.workspace }))
      .toMatchObject({ ok: false, code: 'SPECDEV_PHASE_PLAN_MISSING' })
  })

  it('surfaces a phase plan that cannot be read at all', async () => {
    const { ctx, session, workspace, slugDir } = await fixture(
      'specdev-svc-hg3-unreadable-',
      atPhase('unreadable-wf', 'p1', { p1: COMPLETED_PHASE }),
    )
    mkdirSync(join(slugDir, 'phase-plan.md'))
    await expect(ctx.specdev.confirmGate(session, { gate: 'hg3', decision: 'pass' }, { cwd: workspace }))
      .rejects.toMatchObject({ code: 'EISDIR' })
  })

  it('advances HG-3 to the next ready phase and keeps its predecessor completed', async () => {
    const { ctx, session, workspace } = await fixture(
      'specdev-svc-hg3-next-',
      atPhase('next-wf', 'p1', {
        p1: COMPLETED_PHASE,
        p2: PENDING_PHASE,
      }),
      { 'phase-plan.md': phasePlan({ id: 'p1', dependencies: [] }, { id: 'p2', dependencies: ['p1'] }) },
    )
    const result = await ctx.specdev.confirmGate(session, { gate: 'hg3', decision: 'pass' }, { cwd: workspace })
    expect(result.ok).toBe(true)
    expect(result.snapshot?.phase).toBe('p2')
    expect(result.snapshot?.steps.p1).toEqual(COMPLETED_PHASE)
    expect(result.snapshot?.gates.hg3).toBe('pending')
  })

  it('defers inherited debt to the next ready phase when no target is given', async () => {
    const { ctx, session, workspace } = await fixture(
      'specdev-svc-defer-next-',
      statusWith('defer-next-wf', {
        current_phase: null,
        loop_count: 0,
        phases: { p1: PENDING_PHASE },
      }),
      {
        'phase-plan.md': phasePlan({ id: 'p1', dependencies: [] }, { id: 'p2', dependencies: ['p1'] }),
        'tech-debt-registry.md': DEBT_REGISTRY,
      },
    )
    const result = await ctx.specdev.confirmGate(
      session,
      { gate: 'phase-entry', decision: 'defer', phaseEntry: [{ itemIds: ['STUB-A'], disposition: 'defer' }] },
      { cwd: workspace },
    )
    expect(result.ok).toBe(true)
    expect(ctx.specdev.readTechDebt({ slug: 'defer-next-wf', cwd: workspace }).active[0]?.targetPhase).toBe('p1')
  })

  it('defers the whole gate without item dispositions', async () => {
    const { ctx, session, workspace } = await fixture(
      'specdev-svc-defer-bare-',
      statusWith('defer-bare-wf', {
        current_phase: null,
        loop_count: 0,
        phases: { p1: PENDING_PHASE },
      }),
      {
        'phase-plan.md': phasePlan({ id: 'p1', dependencies: [] }, { id: 'p2', dependencies: ['p1'] }),
        'tech-debt-registry.md': DEBT_REGISTRY,
      },
    )
    const result = await ctx.specdev.confirmGate(
      session,
      { gate: 'phase-entry', decision: 'defer' },
      { cwd: workspace },
    )
    expect(result.ok).toBe(true)
    // No disposition named a row, so the registry is rewritten unchanged.
    expect(ctx.specdev.readTechDebt({ slug: 'defer-bare-wf', cwd: workspace }).active.map(item => item.id))
      .toEqual(['STUB-A'])
  })
})
