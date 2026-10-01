/**
 * SpecDev command surface: real Cordis composition with commands + specdev —
 * the `/feature` layout, the `/spec` design step, `/status` alignment,
 * `/implement` runtime loop, `/wiki` dispatch, and the final-HG-3 wiki
 * auto-dispatch that a panel gate decision now triggers.
 */

import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import AgentRegistry from '@deepseek-ai/dsh-agent'
import type { Agent, AgentStatus } from '@deepseek-ai/dsh-agent'
import CommandRuntime from '@deepseek-ai/dsh-commands'
import SessionStore, { Session, SessionId } from '@deepseek-ai/dsh-session'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import SpecdevService, {
  appendWorkflowLog,
  applySpecdevProjection,
  createInitialStatus,
  formatStatusReport,
  parseCurrentStatus,
  readSpecdevMetadata,
  readWorkflowLog,
  snapshotFromStatus,
  SPECDEV_SCHEMA_VERSION,
  MemoryInbox,
} from '@deepseek-ai/dsh-specdev'
import type { CurrentStatusJson, SpecdevSnapshot } from '@deepseek-ai/dsh-specdev'

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

/**
 * Seed durable workflow state for one slug: append the log event that carries
 * every state field (creating the log when the case has none), then refresh the
 * derived mirror so file readers see the same state.
 */
async function seedWorkflowStatus(path: string, status: CurrentStatusJson): Promise<void> {
  parseCurrentStatus(status)
  const slugDir = dirname(path)
  const logPath = join(slugDir, 'workflow.jsonl')
  if (readWorkflowLog(logPath) === null) {
    await appendWorkflowLog(logPath, 'workflow/init', {
      slug: basename(slugDir),
      command: status.initiating_command ?? status.pipeline_mode ?? 'feature',
      created: status.created,
      ...status.description === undefined ? {} : { description: status.description },
    })
  }
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
  writeFileSync(path, `${JSON.stringify(status, null, 2)}\n`)
}

function stubAgent(ctx: Context, id: string, cwd?: string): { agent: Agent; session: Session } {
  const session = ctx.sessions.create(SessionId(id), cwd === undefined ? {} : { meta: { cwd } })
  const inbox = new MemoryInbox()
  let status: AgentStatus = 'idle'
  const agent: Agent = {
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
    cancel() { status = 'idle' },
    runMaintenance: task => task(new AbortController().signal),
    whenIdle() { return Promise.resolve() },
  }
  return { agent, session }
}

/** Composition with the SpecDev runtime plus a command registry and agent store. */
async function harness(cwd: string) {
  const ctx = new Context()
  await ctx.plugin(SessionStore)
  await ctx.plugin(CommandRuntime)
  await ctx.plugin(AgentRegistry)
  await ctx.plugin(SessionProjectionRegistry)
  await ctx.plugin(SpecdevService)
  const { agent, session } = stubAgent(ctx, `commands-${Math.random()}`, cwd)
  ctx.agents.register(agent)
  // The command surface registers through `ctx.inject(['commands'])`; wait for
  // that fiber instead of assuming the nested load settled with the service.
  await vi.waitFor(() => { expect(ctx.commands.list(agent).length).toBeGreaterThan(0) })
  return { ctx, agent, session }
}

async function run(
  test: Awaited<ReturnType<typeof harness>>,
  line: string,
  agent: Agent = test.agent,
): Promise<NonNullable<Awaited<ReturnType<CommandRuntime['execute']>>>['result']> {
  const execution = await test.ctx.commands.execute(
    agent,
    line,
    [],
    new AbortController().signal,
  )
  if (execution === undefined) throw new Error(`command not registered for line: ${line}`)
  return execution.result
}

/** Run `body` with `process.cwd()` pointed at `dir`. */
async function withProcessCwd<T>(dir: string, body: () => Promise<T>): Promise<T> {
  const spy = vi.spyOn(process, 'cwd').mockReturnValue(dir)
  try {
    return await body()
  } finally {
    spy.mockRestore()
  }
}

describe('@deepseek-ai/dsh-specdev command surface', () => {
  it('registers the converged command set and nothing else', async () => {
    const workspace = tempDir('specdev-cmd-reg-')
    const test = await harness(workspace)
    const names = test.ctx.commands.list(test.agent).map(entry => entry.name)
    for (const expected of ['feature', 'bugfix', 'research', 'spec', 'implement', 'status', 'wiki']) {
      expect(names).toContain(expected)
    }
    for (const removed of ['brief', 'plan', 'specify', 'confirm-gate']) {
      expect(names).not.toContain(removed)
    }
  })

  it('VP-1: /feature creates .specdev layout toward HG-1', async () => {
    const workspace = tempDir('specdev-cmd-feature-')
    const test = await harness(workspace)
    const result = await run(test, '/feature user login flow')
    expect(result.kind).toBe('success')
    expect(result.text).toContain('requirement-analyst')
    expect(result.text).toContain('specdev/dispatch')
    expect(readFileSync(join(workspace, '.specdev', 'active-workflow'), 'utf8').trim()).toBe('user-login-flow')
    expect(readFileSync(join(workspace, '.specdev', 'constitution.md'), 'utf8')).toContain('Constitution')
    expect(readFileSync(
      join(workspace, '.specdev', 'specs', 'user-login-flow', 'tech-debt-registry.md'),
      'utf8',
    )).toContain('Tech Debt Registry')
    const status = test.ctx.specdev.readStatus('user-login-flow', { cwd: workspace })
    expect(status.human_gates.hg1).toBe('pending')
    expect(status.current_stage).toBe('requirement-analysis')

    // AC-24: orchestrator metadata on parent + dispatch event + child lineage
    expect(readSpecdevMetadata(test.agent)).toEqual({
      role: 'orchestrator',
      slug: 'user-login-flow',
    })
    const dispatchEvents = test.session.snapshotEvents().filter(event => event.type === 'specdev/dispatch')
    expect(dispatchEvents).toHaveLength(1)
    expect(dispatchEvents[0]?.data).toMatchObject({
      kind: 'specdev/dispatch',
      role: 'requirement-analyst',
      slug: 'user-login-flow',
    })
    const childSessionId = (dispatchEvents[0]?.data as { childSessionId: string }).childSessionId
    const child = test.ctx.agents.get(SessionId(childSessionId))
    expect(child).toBeDefined()
    if (child === undefined) throw new Error('expected child agent from dispatch')
    expect(child.session.header.parentSession).toBe(test.session.id)
    expect(readSpecdevMetadata(child)).toEqual({
      role: 'requirement-analyst',
      slug: 'user-login-flow',
    })
  })

  it('AC-24: /spec starts requirements, then its design step dispatches plan-generator', async () => {
    const workspace = tempDir('specdev-cmd-spec-')
    const test = await harness(workspace)
    const start = await run(test, '/spec payment retry policy')
    expect(start.kind).toBe('success')
    expect(start.text).toContain('requirement-analyst')
    expect(start.text).toContain('Run /spec again after HG-1')
    const slug = 'payment-retry-policy'
    expect(readFileSync(join(workspace, '.specdev', 'active-workflow'), 'utf8').trim()).toBe(slug)

    const beforeHg1 = await run(test, '/spec')
    expect(beforeHg1.kind).toBe('error')
    expect(beforeHg1.text).toMatch(/HG-1/)

    const slugDir = join(workspace, '.specdev', 'specs', slug)
    writeFileSync(join(slugDir, 'requirements.md'), '# Requirements\n\nenough\n')
    await seedWorkflowStatus(join(slugDir, 'current-status.json'), {
      ...createInitialStatus(slug, 'spec', { initiating_command: 'spec', pipeline_mode: 'spec' }),
      human_gates: { hg1_5: 'pending', hg1: 'passed', hg2: 'pending', hg3: 'pending' },
      current_stage: 'architecture-design',
    })

    const design = await run(test, '/spec')
    expect(design.kind).toBe('success')
    expect(design.text).toContain('plan-generator')
    expect(design.text).toContain('specdev/dispatch')
    expect(readSpecdevMetadata(test.agent).role).toBe('orchestrator')
    const dispatchEvents = test.session.snapshotEvents().filter(event => event.type === 'specdev/dispatch')
    const planDispatch = dispatchEvents.filter(event => (event.data as { role?: string }).role === 'plan-generator')
    expect(planDispatch).toHaveLength(1)
    expect(planDispatch[0]?.data).toMatchObject({
      kind: 'specdev/dispatch',
      role: 'plan-generator',
      slug,
    })
  })

  it('SF-2: /bugfix and /spec persist pipeline_mode on durable status + snapshot', async () => {
    const workspace = tempDir('specdev-cmd-pipeline-')
    const test = await harness(workspace)

    const bugfix = await run(test, '/bugfix fix login crash')
    expect(bugfix.kind).toBe('success')
    const bugfixStatus = test.ctx.specdev.readStatus('fix-login-crash', { cwd: workspace })
    expect(bugfixStatus.pipeline_mode).toBe('bugfix')
    expect(bugfixStatus.initiating_command).toBe('bugfix')
    const bugfixSnap = test.ctx.specdev.snapshot(test.session, { cwd: workspace })
    expect(bugfixSnap?.pipelineMode).toBe('bugfix')
    expect(bugfixSnap?.initiatingCommand).toBe('bugfix')
    expect(bugfixSnap?.schemaVersion).toBe(SPECDEV_SCHEMA_VERSION)

    const specWorkspace = tempDir('specdev-cmd-pipeline-spec-')
    const specTest = await harness(specWorkspace)
    const spec = await run(specTest, '/spec tiny tweak')
    expect(spec.kind).toBe('success')
    const specStatus = specTest.ctx.specdev.readStatus('tiny-tweak', { cwd: specWorkspace })
    expect(specStatus.pipeline_mode).toBe('spec')
    expect(specStatus.initiating_command).toBe('spec')

    const statusReport = await run(specTest, '/status')
    expect(statusReport.kind).toBe('success')
    expect(statusReport.text).toContain('pipelineMode: spec')
    expect(statusReport.text).toContain('initiatingCommand: spec')
  })

  it('research mode creates the workflow without a Human Gate', async () => {
    const workspace = tempDir('specdev-cmd-research-')
    const test = await harness(workspace)
    const result = await run(test, '/research payment module')
    expect(result.kind).toBe('success')
    expect(result.text).toContain('code-explorer')
    expect(result.text).toContain('exploration only')
    const status = test.ctx.specdev.readStatus('payment-module', { cwd: workspace })
    expect(status.initiating_command).toBe('research')
    expect(status.current_stage).toBe('requirement-analysis')
  })

  it('AC-18: /status matches snapshot fields', async () => {
    const workspace = tempDir('specdev-cmd-status-')
    const test = await harness(workspace)
    await run(test, '/feature status check')
    const snap = test.ctx.specdev.snapshot(test.session, { cwd: workspace })
    expect(snap).not.toBeNull()
    const result = await run(test, '/status')
    expect(result.kind).toBe('success')
    expect(result.text).toContain(`slug: ${snap?.slug}`)
    expect(result.text).toContain(`stage: ${snap?.stage}`)
    expect(result.text).toContain(`pendingGate: ${snap?.pendingGate}`)
  })

  it('AC-17: /implement after HG-2 ensures branch and dispatches explorer', async () => {
    const workspace = tempDir('specdev-cmd-implement-')
    // Fixture project git repo (not harness) — git helpers operate here.
    const { execFileSync } = await import('node:child_process')
    execFileSync('git', ['init', '-b', 'main'], { cwd: workspace, stdio: 'ignore' })
    execFileSync('git', ['config', 'user.email', 't@t'], { cwd: workspace, stdio: 'ignore' })
    execFileSync('git', ['config', 'user.name', 't'], { cwd: workspace, stdio: 'ignore' })
    writeFileSync(join(workspace, 'README.md'), '# w\n')
    execFileSync('git', ['add', 'README.md'], { cwd: workspace, stdio: 'ignore' })
    execFileSync('git', ['commit', '-m', 'i'], { cwd: workspace, stdio: 'ignore' })

    const test = await harness(workspace)
    await run(test, '/feature impl loop')
    const slug = 'impl-loop'
    const slugDir = join(workspace, '.specdev', 'specs', slug)
    writeFileSync(join(slugDir, 'phase-plan.md'), `# Plan

\`\`\`json
{
  "phases": [
    { "id": "phase-1-p0-core", "name": "P1", "dependencies": [], "acceptance_criteria": [] }
  ]
}
\`\`\`
`)
    await seedWorkflowStatus(join(slugDir, 'current-status.json'), {
      ...createInitialStatus(slug, 'feature', { initiating_command: 'feature', pipeline_mode: 'feature' }),
      human_gates: { hg1_5: 'pending', hg1: 'passed', hg2: 'passed', hg3: 'pending' },
      current_stage: 'phase-implementation',
      current_phase: 'phase-1-p0-core',
      phases: {
        'phase-1-p0-core': { implementer: 'pending', reviewer: 'pending', verifier: 'pending', prototype: 'pending' },
      },
    })
    const impl = await run(test, '/implement')
    expect(impl.kind).toBe('success')
    expect(impl.text).not.toContain('@STUB(phase-4-phase-runtime)')
    expect(impl.text).toContain('code-explorer')
    expect(impl.text).toContain('impl-phase-1-p0-core')
    expect(impl.text).toMatch(/followup=true/)
  })

  it('AC-20/VP-2: /wiki dispatches wiki role → docs/wiki/ (STUB-002 closed)', async () => {
    const workspace = tempDir('specdev-cmd-wiki-')
    const test = await harness(workspace)
    const noWorkflow = await run(test, '/wiki')
    expect(noWorkflow.kind).toBe('error')
    expect(noWorkflow.text).toContain('No active SpecDev workflow')

    await run(test, '/feature wiki demo')
    const wiki = await run(test, '/wiki')
    expect(wiki.kind).toBe('success')
    expect(wiki.text).not.toContain('@STUB(phase-5-wiki-hardening)')
    expect(wiki.text).toContain('Standalone')
    expect(wiki.text).toContain(join(workspace, 'docs', 'wiki'))
    expect(wiki.text).toMatch(/followup=true/)
    expect(existsSync(join(workspace, 'docs', 'wiki'))).toBe(true)

    const dispatchEvents = test.session.snapshotEvents().filter(event => event.type === 'specdev/dispatch')
    const wikiDispatch = dispatchEvents.filter(event => (event.data as { role?: string }).role === 'wiki')
    expect(wikiDispatch.length).toBeGreaterThanOrEqual(1)
    expect(wikiDispatch[0]?.data).toMatchObject({
      kind: 'specdev/dispatch',
      role: 'wiki',
      slug: 'wiki-demo',
    })
  })

  it('AC-20/AC-56: a panel (direct confirmGate) final HG-3 auto wiki + bridge fold equals snapshot()', async () => {
    const workspace = tempDir('specdev-cmd-wiki-e2e-')
    const slug = 'wiki-e2e'
    const slugDir = join(workspace, '.specdev', 'specs', slug)
    mkdirSync(slugDir, { recursive: true })
    writeFileSync(join(workspace, '.specdev', 'active-workflow'), `${slug}\n`)
    writeFileSync(join(slugDir, 'requirements.md'), '# Requirements\n\nenough\n')
    writeFileSync(join(slugDir, 'design.md'), '# Design\n\nok\n')
    writeFileSync(join(slugDir, 'phase-plan.md'), `# Plan

\`\`\`json
{
  "phases": [
    { "id": "phase-1-p0-core", "name": "P1", "dependencies": [], "acceptance_criteria": [] }
  ]
}
\`\`\`
`)
    writeFileSync(join(slugDir, 'tech-debt-registry.md'), '# Debt\n\n## 活跃债务\n\n## 已解决\n\n')
    await seedWorkflowStatus(join(slugDir, 'current-status.json'), {
      ...createInitialStatus(slug, 'feature', { initiating_command: 'feature', pipeline_mode: 'feature' }),
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

    const test = await harness(workspace)
    const hg3 = await test.ctx.specdev.confirmGate(test.session, { gate: 'hg3', decision: 'pass' })
    expect(hg3.ok).toBe(true)

    const status = test.ctx.specdev.readStatus(slug, { cwd: workspace })
    expect(status.current_phase).toBeNull()
    expect(status.human_gates.hg3).toBe('passed')

    // The gate decision is the only trigger; the runtime owns the wiki dispatch.
    await vi.waitFor(() => {
      expect(test.session.snapshotEvents().filter(
        event => event.type === 'specdev/dispatch'
          && (event.data as { role?: string }).role === 'wiki',
      )).toHaveLength(1)
    })
    expect(existsSync(join(workspace, 'docs', 'wiki'))).toBe(true)
    const wikiDispatch = test.session.snapshotEvents().filter(
      event => event.type === 'specdev/dispatch'
        && (event.data as { role?: string }).role === 'wiki',
    )
    expect(wikiDispatch[0]?.data).toMatchObject({
      kind: 'specdev/dispatch',
      role: 'wiki',
      slug,
    })
    const wikiChild = test.ctx.agents.get(
      SessionId((wikiDispatch[0]?.data as { childSessionId: string }).childSessionId),
    )
    if (wikiChild === undefined) throw new Error('expected the auto-dispatched wiki child agent')
    expect(readSpecdevMetadata(wikiChild)).toEqual({ role: 'wiki', slug })

    // Bridge reconstructability: offline fold of specdev/* events == live snapshot().
    let folded: { status: ReturnType<typeof test.ctx.specdev.snapshot>; failure: string | null } = {
      status: null,
      failure: null,
    }
    for (const event of test.session.snapshotEvents()) {
      if (!event.type.startsWith('specdev/')) continue
      folded = applySpecdevProjection(folded, event)
    }
    const live = test.ctx.specdev.snapshot(test.session, { cwd: workspace })
    expect(live).not.toBeNull()
    expect(folded.failure).toBeNull()
    expect(folded.status).toEqual(live)

    // AC-55: wiki + command sources must not call Knownbase / KB clients.
    const harnessRoot = join(fileURLToPath(new URL('.', import.meta.url)), '..', '..', '..', '..')
    const wikiSrc = readFileSync(
      join(harnessRoot, 'packages/specdev/specdev/src/wiki.ts'),
      'utf8',
    )
    const cmdSrc = readFileSync(
      join(harnessRoot, 'packages/specdev/specdev/src/commands.ts'),
      'utf8',
    )
    for (const src of [wikiSrc, cmdSrc]) {
      expect(src).not.toMatch(/from\s+['"][^'"]*knowledge-base[^'"]*['"]/i)
      expect(src).not.toMatch(/\bsave_document\s*\(/)
      expect(src).not.toMatch(/\bkb-pending\b/)
      expect(src).not.toContain('@STUB(phase-5-wiki-hardening)')
    }
  })

  it('VP-4: /implement blocks on Phase Entry Gate with 🔴 debt', async () => {
    const workspace = tempDir('specdev-cmd-entry-')
    const { execFileSync } = await import('node:child_process')
    execFileSync('git', ['init', '-b', 'main'], { cwd: workspace, stdio: 'ignore' })
    execFileSync('git', ['config', 'user.email', 't@t'], { cwd: workspace, stdio: 'ignore' })
    execFileSync('git', ['config', 'user.name', 't'], { cwd: workspace, stdio: 'ignore' })
    writeFileSync(join(workspace, 'README.md'), '# w\n')
    execFileSync('git', ['add', 'README.md'], { cwd: workspace, stdio: 'ignore' })
    execFileSync('git', ['commit', '-m', 'i'], { cwd: workspace, stdio: 'ignore' })

    const test = await harness(workspace)
    await run(test, '/feature entry gate')
    const slug = 'entry-gate'
    const slugDir = join(workspace, '.specdev', 'specs', slug)
    writeFileSync(join(slugDir, 'phase-plan.md'), `# Plan

\`\`\`json
{
  "phases": [
    { "id": "phase-1-p0-core", "name": "P1", "dependencies": [], "acceptance_criteria": [] },
    { "id": "phase-2-commands", "name": "P2", "dependencies": ["phase-1-p0-core"], "acceptance_criteria": [] }
  ]
}
\`\`\`
`)
    writeFileSync(join(slugDir, 'tech-debt-registry.md'), `# Debt

## 活跃债务

| ID | 源Phase | 模块 | 文件:函数:行号 | 当前行为 | 预期行为 | 类型 | 标签 | 依赖它的模块 | 目标Phase | 阻塞 | 来源 | 注册日期 |
|----|:------:|------|---------------|---------|---------|------|------|-------------|:--------:|:---:|------|---------|
| STUB-X | phase-1-p0-core | m | f:x | cur | exp | 空实现 | module:m, type:stub | x | phase-2-commands | 🔴阻塞 | impl | 2026-09-08 |

## 已解决

| ID | 源Phase | 描述 | 解决Phase | 解决日期 | 验证方式 |
|----|:------:|------|:--------:|---------|---------|
`)
    await seedWorkflowStatus(join(slugDir, 'current-status.json'), {
      ...createInitialStatus(slug, 'feature', { initiating_command: 'feature', pipeline_mode: 'feature' }),
      human_gates: { hg1_5: 'pending', hg1: 'passed', hg2: 'passed', hg3: 'pending' },
      current_stage: 'phase-implementation',
      current_phase: 'phase-2-commands',
      phases: {
        'phase-2-commands': { implementer: 'pending', reviewer: 'pending', verifier: 'pending', prototype: 'pending' },
      },
    })
    const impl = await run(test, '/implement')
    expect(impl.kind).toBe('error')
    expect(impl.text).toContain('Phase Entry Gate')
    expect(impl.text).toContain('STUB-X')
  })
})

describe('@deepseek-ai/dsh-specdev status report formatting', () => {
  it('reports the placeholder line for a snapshot without steps or identity', () => {
    const bare: SpecdevSnapshot = {
      ...snapshotFromStatus(createInitialStatus('bare'), { workflow: false, phases: {} }),
      pendingGate: null,
    }
    const report = formatStatusReport(bare)
    expect(report).toContain('phase: (none)')
    expect(report).toContain('pipelineMode: (none)')
    expect(report).toContain('initiatingCommand: (none)')
    expect(report).toContain('pendingGate: (none)')
    expect(report).toContain('nextAction: (none)')
    expect(report).toContain('tech debt: (not summarized)')
    expect(report).toContain('  (no phase steps yet)')
  })

  it('lists every phase step and the summarized tech debt', () => {
    const status: CurrentStatusJson = {
      ...createInitialStatus('full', 'feature', { initiating_command: 'feature', pipeline_mode: 'feature' }),
      phases: {
        p1: { implementer: 'completed', reviewer: 'in_progress', verifier: 'pending', prototype: 'passed' },
      },
    }
    const report = formatStatusReport({
      ...snapshotFromStatus(status, { workflow: false, phases: { p1: 'unknown' } }, 'hg2'),
      techDebtSummary: { blocking: 2, total: 3 },
      nextAction: 'dispatch the verifier',
    })
    expect(report).toContain('pipelineMode: feature')
    expect(report).toContain('initiatingCommand: feature')
    expect(report).toContain('pendingGate: hg2')
    expect(report).toContain('nextAction: dispatch the verifier')
    expect(report).toContain('tech debt: blocking=2 total=3')
    expect(report).toContain('  p1: implementer=completed reviewer=in_progress verifier=pending prototype=passed')
  })
})

describe('@deepseek-ai/dsh-specdev command fallbacks', () => {
  it('reports the usage line for a workflow command without a description', async () => {
    const test = await harness(tempDir('specdev-cmd-usage-'))
    const result = await run(test, '/feature')
    expect(result.kind).toBe('error')
    expect(result.text).toContain('Usage: /feature <description>')
  })

  it('falls back to a timestamped slug for a description without alphanumerics', async () => {
    const workspace = tempDir('specdev-cmd-slug-')
    const test = await harness(workspace)
    const result = await run(test, '/bugfix !!!')
    expect(result.kind).toBe('success')
    expect(readFileSync(join(workspace, '.specdev', 'active-workflow'), 'utf8').trim())
      .toMatch(/^workflow-[0-9a-z]+$/)
  })

  it('resolves the workspace from the process cwd for a session without one', async () => {
    const workspace = tempDir('specdev-cmd-process-cwd-')
    const test = await harness(workspace)
    const { agent } = stubAgent(test.ctx, `cwdless-${Math.random()}`)
    test.ctx.agents.register(agent)
    const result = await withProcessCwd(workspace, () => run(test, '/feature process cwd', agent))
    expect(result.kind).toBe('success')
    expect(readFileSync(join(workspace, '.specdev', 'active-workflow'), 'utf8').trim()).toBe('process-cwd')
  })

  it('refuses the /spec design step without an active workflow', async () => {
    const test = await harness(tempDir('specdev-cmd-spec-none-'))
    const result = await run(test, '/spec')
    expect(result.kind).toBe('error')
    expect(result.text).toContain('No active SpecDev workflow')
  })

  it('reports an approved design and a missing requirements artifact', async () => {
    const approvedWorkspace = tempDir('specdev-cmd-spec-approved-')
    const approved = await harness(approvedWorkspace)
    await run(approved, '/spec approved design')
    const approvedDir = join(approvedWorkspace, '.specdev', 'specs', 'approved-design')
    await seedWorkflowStatus(join(approvedDir, 'current-status.json'), {
      ...createInitialStatus('approved-design', 'spec', { initiating_command: 'spec', pipeline_mode: 'spec' }),
      human_gates: { hg1_5: 'pending', hg1: 'passed', hg2: 'passed', hg3: 'pending' },
      current_stage: 'phase-implementation',
    })
    const done = await run(approved, '/spec')
    expect(done.kind).toBe('success')
    expect(done.text).toContain('already has an approved design')

    const emptyWorkspace = tempDir('specdev-cmd-spec-noreq-')
    const empty = await harness(emptyWorkspace)
    await run(empty, '/spec missing requirements')
    const emptyDir = join(emptyWorkspace, '.specdev', 'specs', 'missing-requirements')
    await seedWorkflowStatus(join(emptyDir, 'current-status.json'), {
      ...createInitialStatus('missing-requirements', 'spec', { initiating_command: 'spec', pipeline_mode: 'spec' }),
      human_gates: { hg1_5: 'pending', hg1: 'passed', hg2: 'pending', hg3: 'pending' },
      current_stage: 'architecture-design',
    })
    const refused = await run(empty, '/spec')
    expect(refused.kind).toBe('error')
    expect(refused.text).toContain('non-empty requirements.md')
  })
})

describe('@deepseek-ai/dsh-specdev /implement refusals', () => {
  it('refuses /implement without an active workflow', async () => {
    const test = await harness(tempDir('specdev-cmd-impl-none-'))
    const result = await run(test, '/implement')
    expect(result.kind).toBe('error')
    expect(result.text).toContain('No active SpecDev workflow')
  })

  it('refuses /implement before HG-2 and without a current phase', async () => {
    const workspace = tempDir('specdev-cmd-impl-order-')
    const test = await harness(workspace)
    await run(test, '/feature impl order')
    const slugDir = join(workspace, '.specdev', 'specs', 'impl-order')
    await seedWorkflowStatus(join(slugDir, 'current-status.json'), {
      ...createInitialStatus('impl-order', 'feature', { initiating_command: 'feature', pipeline_mode: 'feature' }),
      human_gates: { hg1_5: 'pending', hg1: 'passed', hg2: 'pending', hg3: 'pending' },
    })
    const beforeHg2 = await run(test, '/implement')
    expect(beforeHg2.kind).toBe('error')
    expect(beforeHg2.text).toContain('requires HG-2 passed')

    await seedWorkflowStatus(join(slugDir, 'current-status.json'), {
      ...createInitialStatus('impl-order', 'feature', { initiating_command: 'feature', pipeline_mode: 'feature' }),
      human_gates: { hg1_5: 'pending', hg1: 'passed', hg2: 'passed', hg3: 'pending' },
      current_stage: 'phase-implementation',
      current_phase: null,
    })
    const noPhase = await run(test, '/implement')
    expect(noPhase.kind).toBe('error')
    expect(noPhase.text).toContain('requires current_phase')
  })

  it('refuses /implement when the phase plan is missing or names another phase', async () => {
    const workspace = tempDir('specdev-cmd-impl-plan-')
    const test = await harness(workspace)
    await run(test, '/feature impl plan')
    const slugDir = join(workspace, '.specdev', 'specs', 'impl-plan')
    const status = {
      ...createInitialStatus('impl-plan', 'feature', { initiating_command: 'feature', pipeline_mode: 'feature' }),
      human_gates: { hg1_5: 'pending', hg1: 'passed', hg2: 'passed', hg3: 'pending' } as const,
      current_stage: 'phase-implementation',
      current_phase: 'phase-1-p0-core',
      phases: {
        'phase-1-p0-core': { implementer: 'pending', reviewer: 'pending', verifier: 'pending', prototype: 'pending' } as const,
      },
    }
    await seedWorkflowStatus(join(slugDir, 'current-status.json'), status)
    const noPlan = await run(test, '/implement')
    expect(noPlan.kind).toBe('error')
    expect(noPlan.text).toContain('cannot read phase-plan DAG')

    writeFileSync(join(slugDir, 'phase-plan.md'), `# Plan

\`\`\`json
{
  "phases": [
    { "id": "phase-2-other", "name": "P2", "dependencies": [], "acceptance_criteria": [] }
  ]
}
\`\`\`
`)
    const wrongPhase = await run(test, '/implement')
    expect(wrongPhase.kind).toBe('error')
    expect(wrongPhase.text).toContain('is not a DAG phases[].id')
  })

  it('skips the phase entry gate when nothing blocks and reports a failed branch', async () => {
    const workspace = tempDir('specdev-cmd-impl-entry-')
    const test = await harness(workspace)
    await run(test, '/feature impl entry')
    const slugDir = join(workspace, '.specdev', 'specs', 'impl-entry')
    writeFileSync(join(slugDir, 'phase-plan.md'), `# Plan

\`\`\`json
{
  "phases": [
    { "id": "phase-1-p0-core", "name": "P1", "dependencies": [], "acceptance_criteria": [] },
    { "id": "phase-2-commands", "name": "P2", "dependencies": ["phase-1-p0-core"], "acceptance_criteria": [] }
  ]
}
\`\`\`
`)
    writeFileSync(join(slugDir, 'tech-debt-registry.md'), `# Tech Debt

## 活跃债务

| ID | 源Phase | 模块 | 文件:函数:行号 | 当前行为 | 预期行为 | 类型 | 标签 | 依赖它的模块 | 目标Phase | 阻塞 | 来源 | 注册日期 |
|----|:------:|------|---------------|---------|---------|------|------|-------------|:--------:|:---:|------|---------|

## 已解决

| ID | 源Phase | 描述 | 解决Phase | 解决日期 | 验证方式 |
|----|:------:|------|:--------:|---------|---------|
`)
    await seedWorkflowStatus(join(slugDir, 'current-status.json'), {
      ...createInitialStatus('impl-entry', 'feature', { initiating_command: 'feature', pipeline_mode: 'feature' }),
      human_gates: { hg1_5: 'pending', hg1: 'passed', hg2: 'passed', hg3: 'pending' },
      current_stage: 'phase-implementation',
      current_phase: 'phase-2-commands',
      phases: {
        'phase-2-commands': { implementer: 'pending', reviewer: 'pending', verifier: 'pending', prototype: 'pending' },
      },
    })
    // No git repository: the entry gate clears (no blocking debt) and the
    // branch step is the failure that surfaces.
    const result = await run(test, '/implement')
    expect(result.kind).toBe('error')
    expect(result.text).toContain('ensurePhaseBranch failed')
  })

  it('starts at the implementer once the phase exploration exists', async () => {
    const workspace = tempDir('specdev-cmd-impl-explored-')
    const { execFileSync } = await import('node:child_process')
    execFileSync('git', ['init', '-b', 'main'], { cwd: workspace, stdio: 'ignore' })
    execFileSync('git', ['config', 'user.email', 't@t'], { cwd: workspace, stdio: 'ignore' })
    execFileSync('git', ['config', 'user.name', 't'], { cwd: workspace, stdio: 'ignore' })
    writeFileSync(join(workspace, 'README.md'), '# w\n')
    execFileSync('git', ['add', 'README.md'], { cwd: workspace, stdio: 'ignore' })
    execFileSync('git', ['commit', '-m', 'i'], { cwd: workspace, stdio: 'ignore' })

    const test = await harness(workspace)
    await run(test, '/feature impl explored')
    const slugDir = join(workspace, '.specdev', 'specs', 'impl-explored')
    const phaseDir = join(slugDir, 'phases', 'phase-1-p0-core')
    mkdirSync(phaseDir, { recursive: true })
    writeFileSync(join(phaseDir, 'repo-exploration.md'), '# Exploration\n')
    writeFileSync(join(slugDir, 'phase-plan.md'), `# Plan

\`\`\`json
{
  "phases": [
    { "id": "phase-1-p0-core", "name": "P1", "dependencies": [], "acceptance_criteria": [] }
  ]
}
\`\`\`
`)
    await seedWorkflowStatus(join(slugDir, 'current-status.json'), {
      ...createInitialStatus('impl-explored', 'feature', { initiating_command: 'feature', pipeline_mode: 'feature' }),
      human_gates: { hg1_5: 'pending', hg1: 'passed', hg2: 'passed', hg3: 'pending' },
      current_stage: 'phase-implementation',
      current_phase: 'phase-1-p0-core',
      phases: {
        'phase-1-p0-core': { implementer: 'pending', reviewer: 'pending', verifier: 'pending', prototype: 'pending' },
      },
    })
    const result = await run(test, '/implement')
    expect(result.kind).toBe('success')
    expect(result.text).toContain('Dispatched `implementer`')
    expect(result.text).toContain('repo-exploration.md present — started at implementer')
  })
})

describe('@deepseek-ai/dsh-specdev /wiki and /status fallbacks', () => {
  it('carries the current phase and an operator note into the wiki dispatch', async () => {
    const workspace = tempDir('specdev-cmd-wiki-note-')
    const test = await harness(workspace)
    await run(test, '/feature wiki note')
    const slugDir = join(workspace, '.specdev', 'specs', 'wiki-note')
    await seedWorkflowStatus(join(slugDir, 'current-status.json'), {
      ...createInitialStatus('wiki-note', 'feature', { initiating_command: 'feature', pipeline_mode: 'feature' }),
      human_gates: { hg1_5: 'pending', hg1: 'passed', hg2: 'passed', hg3: 'pending' },
      current_stage: 'phase-implementation',
      current_phase: 'phase-1-p0-core',
    })
    const result = await run(test, '/wiki refresh the theme pages')
    expect(result.kind).toBe('success')
    expect(result.text).toContain('Note: refresh the theme pages')
    const dispatch = test.session.snapshotEvents().filter(
      event => event.type === 'specdev/dispatch' && (event.data as { role?: string }).role === 'wiki',
    )
    expect(dispatch[0]?.data).toMatchObject({ phaseId: 'phase-1-p0-core' })
  })

  it('refuses /status without an active workflow', async () => {
    const test = await harness(tempDir('specdev-cmd-status-none-'))
    const result = await run(test, '/status')
    expect(result.kind).toBe('error')
    expect(result.text).toContain('No active SpecDev workflow')
  })

  it('waits for in-flight command operations when the plugin unloads', async () => {
    const workspace = tempDir('specdev-cmd-dispose-')
    const test = await harness(workspace)
    const result = await run(test, '/feature dispose demo')
    expect(result.kind).toBe('success')
    // The command lifecycle effect drains every operation it saw at unload.
    await expect(test.ctx.fiber.dispose()).resolves.toBeUndefined()
  })
})
