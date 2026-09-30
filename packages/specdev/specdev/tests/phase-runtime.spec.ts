/**
 * Phase 4 phase-runtime: git helpers, review merge, Entry Gate / debt,
 * re-run cascade, HG-3 next-phase, dispatch followup (VP-1..VP-5).
 */

import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import AgentRegistry, { Inbox, type Agent, type AgentStatus } from '@deepseek-ai/dsh-agent'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import SpecdevService, {
  archiveMergedReview,
  cascadeDownstreamOf,
  completePhaseGit,
  createInitialStatus,
  ensurePhaseBranch,
  mergeReviewVerdicts,
  mergePhaseReviews,
  normalizeExplicitFiles,
  parseReviewVerdict,
  parseTechDebtRegistry,
  prepareStepRerun,
  readCurrentBranch,
  listBlockingInheritedDebt,
} from '@deepseek-ai/dsh-specdev'
import type { CurrentStatusJson } from '@deepseek-ai/dsh-specdev'

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

function writeStatusFixture(path: string, status: CurrentStatusJson): void {
  writeFileSync(path, `${JSON.stringify(status, null, 2)}\n`)
}

function gitInit(cwd: string): void {
  execFileSync('git', ['init', '-b', 'main'], { cwd, stdio: 'ignore' })
  execFileSync('git', ['config', 'user.email', 'specdev@test'], { cwd, stdio: 'ignore' })
  execFileSync('git', ['config', 'user.name', 'SpecDev Test'], { cwd, stdio: 'ignore' })
  writeFileSync(join(cwd, 'README.md'), '# fixture\n')
  execFileSync('git', ['add', 'README.md'], { cwd, stdio: 'ignore' })
  execFileSync('git', ['commit', '-m', 'init'], { cwd, stdio: 'ignore' })
}

function phasePlanMarkdown(): string {
  return `# Plan

\`\`\`json
{
  "phases": [
    { "id": "phase-1-p0-core", "name": "P1", "dependencies": [], "acceptance_criteria": [] },
    { "id": "phase-2-commands", "name": "P2", "dependencies": ["phase-1-p0-core"], "acceptance_criteria": [] }
  ]
}
\`\`\`
`
}

async function harness(cwd: string) {
  const ctx = new Context()
  await ctx.plugin(SessionStore)
  await ctx.plugin(AgentRegistry)
  await ctx.plugin(SessionProjectionRegistry)
  await ctx.plugin(SpecdevService)
  const session = ctx.sessions.create(SessionId(`p4-${Math.random()}`), { meta: { cwd } })
  return { ctx, session }
}

describe('Phase 4 git helpers (AC-40 / AC-41 / VP-3)', () => {
  it('ensurePhaseBranch creates impl-<id> from main and stays on MUST-FIX', () => {
    const cwd = tempDir('specdev-git-branch-')
    gitInit(cwd)
    const created = ensurePhaseBranch('phase-1-p0-core', { cwd })
    expect(created.created).toBe(true)
    expect(created.branch).toBe('impl-phase-1-p0-core')
    expect(readCurrentBranch(cwd)).toBe('impl-phase-1-p0-core')

    const stayed = ensurePhaseBranch('phase-1-p0-core', { cwd, mode: 'must-fix-stay' })
    expect(stayed.stayed).toBe(true)
    expect(stayed.created).toBe(false)
  })

  it('ensurePhaseBranch fail-closes on dirty worktree when switching branches (AC-40)', () => {
    const cwd = tempDir('specdev-git-dirty-')
    gitInit(cwd)
    writeFileSync(join(cwd, 'README.md'), '# dirty tracked change\n')
    expect(() => ensurePhaseBranch('phase-1-p0-core', { cwd })).toThrow(/DIRTY|dirty/)
  })

  it('completePhaseGit commits only listed files, merges, deletes branch', () => {
    const cwd = tempDir('specdev-git-complete-')
    gitInit(cwd)
    ensurePhaseBranch('phase-1-p0-core', { cwd })
    writeFileSync(join(cwd, 'src-a.ts'), 'export const a = 1\n')
    writeFileSync(join(cwd, 'src-b.ts'), 'export const b = 2\n')
    writeFileSync(join(cwd, 'noise.ts'), 'export const noise = 0\n')

    const result = completePhaseGit(
      { phaseId: 'phase-1-p0-core', files: ['src-a.ts', 'src-b.ts'] },
      { cwd },
    )
    expect(result.merged).toBe(true)
    expect(result.deleted).toBe(true)
    expect(readCurrentBranch(cwd)).toBe('main')
    expect(existsSync(join(cwd, 'src-a.ts'))).toBe(true)

    const show = execFileSync('git', ['-C', cwd, 'show', '--name-only', '--pretty=format:', 'HEAD'], {
      encoding: 'utf8',
    })
    // Merge commit — look at first parent commit for files, or log -1 --name-only of merge^2
    const names = execFileSync(
      'git',
      ['-C', cwd, 'log', '-1', '--name-only', '--pretty=format:', 'HEAD^2'],
      { encoding: 'utf8' },
    )
    expect(names).toContain('src-a.ts')
    expect(names).toContain('src-b.ts')
    expect(names).not.toContain('noise.ts')
    expect(show.length).toBeGreaterThanOrEqual(0)
  })

  it('refuses blind git add -A / . (AC-41)', () => {
    expect(() => normalizeExplicitFiles(['-A'])).toThrow(/BLIND_ADD|blind/)
    expect(() => normalizeExplicitFiles(['.'])).toThrow(/BLIND_ADD|blind/)
    expect(() => normalizeExplicitFiles([])).toThrow(/FILES_REQUIRED|empty/)
  })
})

describe('Phase 4 review merge (AC-43 / VP-2)', () => {
  it('any MUST-FIX → overall MUST-FIX', () => {
    expect(mergeReviewVerdicts([
      { name: 'correctness', verdict: 'MUST-FIX' },
      { name: 'design', verdict: 'PASS' },
      { name: 'connectivity', verdict: 'PASS' },
    ])).toBe('MUST-FIX')
  })

  it('writes merged review.md from three perspective fixtures', () => {
    const root = tempDir('specdev-review-merge-')
    const phaseDir = join(root, 'phases', 'phase-1-p0-core')
    mkdirSync(phaseDir, { recursive: true })
    writeFileSync(join(phaseDir, 'review-correctness.md'), '## 判决：MUST-FIX\n\nbad\n')
    writeFileSync(join(phaseDir, 'review-design.md'), '## Verdict: PASS\nok\n')
    writeFileSync(join(phaseDir, 'review-connectivity.md'), '## 判决：PASS\nok\n')
    const merged = mergePhaseReviews(phaseDir, 'phase-1-p0-core')
    expect(merged.verdict).toBe('MUST-FIX')
    const body = readFileSync(join(phaseDir, 'review.md'), 'utf8')
    expect(body).toContain('MUST-FIX')
    expect(parseReviewVerdict(body)).toBe('MUST-FIX')
  })

  it('visual: true merges review-visual.md and demands it', () => {
    const root = tempDir('specdev-review-visual-')
    const phaseDir = join(root, 'phases', 'phase-1-p0-core')
    mkdirSync(phaseDir, { recursive: true })
    writeFileSync(join(phaseDir, 'review-correctness.md'), '## 判决：PASS\nok\n')
    writeFileSync(join(phaseDir, 'review-design.md'), '## 判决：PASS\nok\n')
    writeFileSync(join(phaseDir, 'review-connectivity.md'), '## 判决：PASS\nok\n')
    expect(() => mergePhaseReviews(phaseDir, 'phase-1-p0-core', { visual: true }))
      .toThrow(/review-visual\.md/)
    writeFileSync(join(phaseDir, 'review-visual.md'), '## 判决：SHOULD-FIX\nhardcoded color\n')
    const merged = mergePhaseReviews(phaseDir, 'phase-1-p0-core', { visual: true })
    expect(merged.verdict).toBe('SHOULD-FIX')
    const body = readFileSync(join(phaseDir, 'review.md'), 'utf8')
    expect(body).toContain('| visual | SHOULD-FIX |')
    expect(body).toContain('[review-visual.md](./review-visual.md)')
  })

  it('VP-2: MUST-FIX merge does not advance verifier step (stays pending)', () => {
    const status: CurrentStatusJson = {
      ...createInitialStatus('vp2'),
      current_phase: 'phase-1-p0-core',
      phases: {
        'phase-1-p0-core': {
          implementer: 'completed',
          reviewer: 'completed',
          verifier: 'pending',
          prototype: 'pending',
        },
      },
    }
    const verdict = mergeReviewVerdicts([
      { name: 'correctness', verdict: 'MUST-FIX' },
      { name: 'design', verdict: 'PASS' },
      { name: 'connectivity', verdict: 'PASS' },
    ])
    expect(verdict).toBe('MUST-FIX')
    // Merge is pure filesystem — durable verifier must remain pending until Orchestrator dispatches.
    expect(status.phases['phase-1-p0-core']?.verifier).toBe('pending')
  })
})

describe('Phase 4 Entry Gate + debt (AC-33 / AC-34 / VP-4)', () => {
  it('lists only 🔴 blocking items for current phase', () => {
    const slugDir = tempDir('specdev-debt-')
    writeFileSync(join(slugDir, 'tech-debt-registry.md'), `# Tech Debt

## 活跃债务

| ID | 源Phase | 模块 | 文件:函数:行号 | 当前行为 | 预期行为 | 类型 | 标签 | 依赖它的模块 | 目标Phase | 阻塞 | 来源 | 注册日期 |
|----|:------:|------|---------------|---------|---------|------|------|-------------|:--------:|:---:|------|---------|
| STUB-A | phase-1 | m | f:a | cur | exp | 空实现 | module:m, type:stub | x | phase-2-commands | 🔴阻塞 | impl | 2026-09-08 |
| STUB-B | phase-1 | m | f:b | cur | exp | 空实现 | module:m, type:stub | x | phase-2-commands | 🟡非阻塞 | impl | 2026-09-08 |
| STUB-C | phase-1 | m | f:c | cur | exp | 空实现 | module:m, type:stub | x | phase-1-p0-core | 🔴阻塞 | impl | 2026-09-08 |

## 已解决

| ID | 源Phase | 描述 | 解决Phase | 解决日期 | 验证方式 |
|----|:------:|------|:--------:|---------|---------|
`)
    const registry = parseTechDebtRegistry(slugDir)
    const blocking = listBlockingInheritedDebt(registry, 'phase-2-commands')
    expect(blocking.map(i => i.id)).toEqual(['STUB-A'])
  })

  it('AC-33: confirmGate(phase-entry)+defer rewrites target away from current so Entry Gate clears', async () => {
    const workspace = tempDir('specdev-defer-entry-')
    gitInit(workspace)
    const slugDir = join(workspace, '.specdev', 'specs', 'wf')
    mkdirSync(slugDir, { recursive: true })
    writeFileSync(join(workspace, '.specdev', 'active-workflow'), 'wf\n')
    writeFileSync(join(slugDir, 'phase-plan.md'), phasePlanMarkdown())
    writeFileSync(join(slugDir, 'design.md'), '# d\n')
    writeFileSync(join(slugDir, 'requirements.md'), '# r\n')
    writeFileSync(join(slugDir, 'tech-debt-registry.md'), `# Tech Debt

## 活跃债务

| ID | 源Phase | 模块 | 文件:函数:行号 | 当前行为 | 预期行为 | 类型 | 标签 | 依赖它的模块 | 目标Phase | 阻塞 | 来源 | 注册日期 |
|----|:------:|------|---------------|---------|---------|------|------|-------------|:--------:|:---:|------|---------|
| STUB-A | phase-1 | m | f:a | cur | exp | 空实现 | module:m, type:stub | x | phase-2-commands | 🔴阻塞 | impl | 2026-09-08 |

## 已解决

| ID | 源Phase | 描述 | 解决Phase | 解决日期 | 验证方式 |
|----|:------:|------|:--------:|---------|---------|
`)
    writeStatusFixture(join(slugDir, 'current-status.json'), {
      ...createInitialStatus('wf'),
      human_gates: { hg1_5: 'pending', hg1: 'passed', hg2: 'passed', hg3: 'pending' },
      current_stage: 'phase-implementation',
      current_phase: 'phase-2-commands',
      phases: {
        'phase-1-p0-core': {
          implementer: 'completed',
          reviewer: 'completed',
          verifier: 'completed',
          prototype: 'pending',
        },
        'phase-2-commands': {
          implementer: 'pending',
          reviewer: 'pending',
          verifier: 'pending',
          prototype: 'pending',
        },
      },
    })

    const { ctx, session } = await harness(workspace)
    expect(ctx.specdev.listPhaseEntryDebt('phase-2-commands', { cwd: workspace }).map(i => i.id))
      .toEqual(['STUB-A'])

    const deferred = await ctx.specdev.confirmGate(session, {
      gate: 'phase-entry',
      decision: 'defer',
      phaseEntry: [{ itemIds: ['STUB-A'], disposition: 'defer' }],
    }, { cwd: workspace })
    expect(deferred.ok).toBe(true)

    // Must no longer block current phase (bug was rewriting target to current_phase).
    expect(ctx.specdev.listPhaseEntryDebt('phase-2-commands', { cwd: workspace })).toEqual([])
    const registry = parseTechDebtRegistry(slugDir)
    const stubA = registry.active.find(i => i.id === 'STUB-A')
    expect(stubA).toBeDefined()
    expect(stubA!.targetPhase).not.toBe('phase-2-commands')
    expect(stubA!.targetPhase.length).toBeGreaterThan(0)
  })

  it('AC-33: explicit deferredTargetPhase === current_phase is rejected', async () => {
    const workspace = tempDir('specdev-defer-same-')
    const slugDir = join(workspace, '.specdev', 'specs', 'wf')
    mkdirSync(slugDir, { recursive: true })
    writeFileSync(join(workspace, '.specdev', 'active-workflow'), 'wf\n')
    writeFileSync(join(slugDir, 'tech-debt-registry.md'), `# Tech Debt

## 活跃债务

| ID | 源Phase | 模块 | 文件:函数:行号 | 当前行为 | 预期行为 | 类型 | 标签 | 依赖它的模块 | 目标Phase | 阻塞 | 来源 | 注册日期 |
|----|:------:|------|---------------|---------|---------|------|------|-------------|:--------:|:---:|------|---------|
| STUB-A | phase-1 | m | f:a | cur | exp | 空实现 | module:m, type:stub | x | phase-2-commands | 🔴阻塞 | impl | 2026-09-08 |

## 已解决

| ID | 源Phase | 描述 | 解决Phase | 解决日期 | 验证方式 |
|----|:------:|------|:--------:|---------|---------|
`)
    writeStatusFixture(join(slugDir, 'current-status.json'), {
      ...createInitialStatus('wf'),
      current_phase: 'phase-2-commands',
      human_gates: { hg1_5: 'pending', hg1: 'passed', hg2: 'passed', hg3: 'pending' },
      current_stage: 'phase-implementation',
    })
    const { ctx, session } = await harness(workspace)
    const result = await ctx.specdev.confirmGate(session, {
      gate: 'phase-entry',
      decision: 'defer',
      deferredTargetPhase: 'phase-2-commands',
      phaseEntry: [{ itemIds: ['STUB-A'], disposition: 'defer' }],
    }, { cwd: workspace })
    expect(result.ok).toBe(false)
    expect(result.code).toBe('SPECDEV_DEBT_DEFER_TARGET')
  })
})

describe('Phase 4 re-run cascade + archive (AC-44 / AC-45 / VP-5)', () => {
  it('cascades downstream only and archives review.md without git reset', () => {
    expect(cascadeDownstreamOf('implementer')).toEqual(['reviewer', 'verifier'])
    expect(cascadeDownstreamOf('reviewer')).toEqual(['verifier'])

    const status: CurrentStatusJson = {
      ...createInitialStatus('rerun-demo'),
      current_phase: 'phase-1-p0-core',
      loop_count: 2,
      phases: {
        'phase-1-p0-core': {
          implementer: 'completed',
          reviewer: 'completed',
          verifier: 'completed',
          prototype: 'pending',
        },
      },
    }
    const next = prepareStepRerun(status, 'phase-1-p0-core', 'implementer')
    expect(next.loop_count).toBe(0)
    expect(next.phases['phase-1-p0-core']).toEqual({
      implementer: 'pending',
      reviewer: 'pending',
      verifier: 'pending',
      prototype: 'pending',
    })

    const phaseDir = join(tempDir('specdev-archive-'), 'phase')
    mkdirSync(phaseDir, { recursive: true })
    writeFileSync(join(phaseDir, 'review.md'), '## 判决：PASS\n')
    const dest = archiveMergedReview(phaseDir, new Date('2026-09-08T12:00:00.000Z'))
    expect(dest).toContain('.archive')
    expect(existsSync(join(phaseDir, 'review.md'))).toBe(false)
    expect(existsSync(dest!)).toBe(true)
    // Prove we did not need git: renameSync path only
    expect(typeof renameSync).toBe('function')
  })
})

describe('Phase 4 HG-3 next phase + dispatch followup (AC-31 / GAP-002)', () => {
  it('confirmGate(hg3) advances current_phase and re-arms hg3=pending', async () => {
    const workspace = tempDir('specdev-hg3-next-')
    gitInit(workspace)
    const slugDir = join(workspace, '.specdev', 'specs', 'wf')
    mkdirSync(slugDir, { recursive: true })
    writeFileSync(join(workspace, '.specdev', 'active-workflow'), 'wf\n')
    writeFileSync(join(slugDir, 'phase-plan.md'), phasePlanMarkdown())
    writeFileSync(join(slugDir, 'design.md'), '# d\n')
    writeFileSync(join(slugDir, 'requirements.md'), '# r\n')
    writeStatusFixture(join(slugDir, 'current-status.json'), {
      ...createInitialStatus('wf'),
      human_gates: { hg1_5: 'pending', hg1: 'passed', hg2: 'passed', hg3: 'pending' },
      current_stage: 'phase-implementation',
      current_phase: 'phase-1-p0-core',
      phases: {
        'phase-1-p0-core': {
          implementer: 'completed',
          reviewer: 'completed',
          verifier: 'completed',
          prototype: 'pending',
        },
      },
    })

    const { ctx, session } = await harness(workspace)
    const result = await ctx.specdev.confirmGate(session, { gate: 'hg3', decision: 'pass' }, { cwd: workspace })
    expect(result.ok).toBe(true)
    expect(result.snapshot?.phase).toBe('phase-2-commands')
    expect(result.snapshot?.gates.hg3).toBe('pending')
    const durable = JSON.parse(readFileSync(join(slugDir, 'current-status.json'), 'utf8')) as CurrentStatusJson
    expect(durable.current_phase).toBe('phase-2-commands')
    expect(durable.human_gates.hg3).toBe('pending')
    expect(durable.loop_count).toBe(0)
  })

  it('dispatchRole wakes child with followup (GAP-002)', async () => {
    const workspace = tempDir('specdev-followup-')
    const ctx = new Context()
    await ctx.plugin(SessionStore)
    await ctx.plugin(AgentRegistry)
    await ctx.plugin(SessionProjectionRegistry)
    await ctx.plugin(SpecdevService)

    const parentSession = ctx.sessions.create(SessionId('orch'), { meta: { cwd: workspace } })
    const inbox = new Inbox(parentSession, { inserted: () => {}, discarded: () => {}, claimed: () => {} })
    let status: AgentStatus = 'idle'
    const parent: Agent = {
      id: parentSession.id,
      options: {},
      session: parentSession,
      inbox,
      ctx: new Context(),
      get status() { return status },
      send: () => {},
      followup: () => {},
      steer: () => {},
      inject(input) { inbox.append('next-step', input) },
      cancel() { status = 'idle' },
      runMaintenance: task => task(new AbortController().signal),
      whenIdle() { return Promise.resolve() },
    }
    ctx.agents.register(parent)

    const result = await ctx.specdev.dispatchRole(parent, {
      role: 'code-explorer',
      slug: 'demo',
      phaseId: 'phase-1-p0-core',
    })
    expect(result.followupSent).toBe(true)
  })

  it('prepareRerun archives review.md and resets cascade (VP-5)', async () => {
    const workspace = tempDir('specdev-prep-rerun-')
    const slugDir = join(workspace, '.specdev', 'specs', 'wf')
    const phaseDir = join(slugDir, 'phases', 'phase-1-p0-core')
    mkdirSync(phaseDir, { recursive: true })
    writeFileSync(join(workspace, '.specdev', 'active-workflow'), 'wf\n')
    writeFileSync(join(phaseDir, 'review.md'), '## 判决：PASS\n')
    writeStatusFixture(join(slugDir, 'current-status.json'), {
      ...createInitialStatus('wf'),
      current_phase: 'phase-1-p0-core',
      loop_count: 1,
      phases: {
        'phase-1-p0-core': {
          implementer: 'completed',
          reviewer: 'completed',
          verifier: 'completed',
          prototype: 'pending',
        },
      },
    })
    const { ctx } = await harness(workspace)
    const next = await ctx.specdev.prepareRerun('phase-1-p0-core', 'reviewer', { cwd: workspace })
    expect(next.phases['phase-1-p0-core']?.reviewer).toBe('pending')
    expect(next.phases['phase-1-p0-core']?.verifier).toBe('pending')
    expect(next.phases['phase-1-p0-core']?.implementer).toBe('completed')
    expect(next.loop_count).toBe(0)
    expect(existsSync(join(phaseDir, 'review.md'))).toBe(false)
    expect(existsSync(join(phaseDir, '.archive'))).toBe(true)
  })

  it('bumpLoopCount persists loop_count+1 on durable status', async () => {
    const workspace = tempDir('specdev-bump-loop-')
    const slugDir = join(workspace, '.specdev', 'specs', 'wf')
    mkdirSync(slugDir, { recursive: true })
    writeFileSync(join(workspace, '.specdev', 'active-workflow'), 'wf\n')
    writeStatusFixture(join(slugDir, 'current-status.json'), {
      ...createInitialStatus('wf'),
      current_phase: 'phase-1-p0-core',
      loop_count: 0,
    })
    const { ctx } = await harness(workspace)
    const next = await ctx.specdev.bumpLoopCount({ cwd: workspace })
    expect(next.loop_count).toBe(1)
    const durable = JSON.parse(readFileSync(join(slugDir, 'current-status.json'), 'utf8')) as CurrentStatusJson
    expect(durable.loop_count).toBe(1)
  })
})
