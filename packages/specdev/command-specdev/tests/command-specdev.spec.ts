/**
 * SpecDev command integration: real Cordis composition with commands +
 * specdev — \`/feature\` layout, ambiguous confirm refusal, \`/plan\` before
 * HG-1 refusal, \`/status\` aligned with snapshot().
 */

import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import AgentRegistry, { Inbox } from '@deepseek-ai/dsh-agent'
import type { Agent, AgentStatus } from '@deepseek-ai/dsh-agent'
import CommandRuntime from '@deepseek-ai/dsh-commands'
import SessionStore, { Session, SessionId } from '@deepseek-ai/dsh-session'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import SpecdevService, {
  createInitialStatus,
  interpretGateReply,
  parseCurrentStatus,
  readSpecdevMetadata,
} from '@deepseek-ai/dsh-specdev'
import type { CurrentStatusJson } from '@deepseek-ai/dsh-specdev'
import * as commandSpecdev from '@deepseek-ai/dsh-command-specdev'

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
  parseCurrentStatus(status)
  writeFileSync(path, `${JSON.stringify(status, null, 2)}\n`)
}

function stubAgent(ctx: Context, id: string, cwd: string): { agent: Agent; session: Session } {
  const session = ctx.sessions.create(SessionId(id), { meta: { cwd } })
  const inbox = new Inbox(session, { inserted: () => {}, discarded: () => {}, claimed: () => {} })
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

async function harness(cwd: string) {
  const ctx = new Context()
  await ctx.plugin(SessionStore)
  await ctx.plugin(CommandRuntime)
  await ctx.plugin(AgentRegistry)
  await ctx.plugin(SessionProjectionRegistry)
  await ctx.plugin(SpecdevService)
  const plugin = await ctx.plugin(commandSpecdev)
  const { agent, session } = stubAgent(ctx, `command-specdev-${Math.random()}`, cwd)
  ctx.agents.register(agent)
  return { ctx, agent, session, plugin }
}

async function run(
  test: Awaited<ReturnType<typeof harness>>,
  line: string,
): Promise<NonNullable<Awaited<ReturnType<CommandRuntime['execute']>>>['result']> {
  const execution = await test.ctx.commands.execute(
    test.agent,
    line,
    [],
    new AbortController().signal,
  )
  if (execution === undefined) throw new Error(`command not registered for line: ${line}`)
  return execution.result
}

describe('@deepseek-ai/dsh-command-specdev', () => {
  it('registers SpecDev commands with Loader-safe exports', async () => {
    const workspace = tempDir('cmd-specdev-reg-')
    const test = await harness(workspace)
    expect(commandSpecdev.name).toBe('command-specdev')
    expect(commandSpecdev.inject).toEqual(['commands', 'specdev'])
    expect('default' in commandSpecdev).toBe(false)
    const loader = Object.create(Loader.prototype) as Loader
    expect(loader.unwrapExports(commandSpecdev)).toBe(commandSpecdev)

    const names = test.ctx.commands.list(test.agent).map(entry => entry.name)
    for (const expected of [
      'feature', 'bugfix', 'brief', 'research', 'specify',
      'plan', 'implement', 'status', 'wiki', 'confirm-gate',
    ]) {
      expect(names).toContain(expected)
    }
  })

  it('VP-1: /feature creates .specdev layout toward HG-1', async () => {
    const workspace = tempDir('cmd-specdev-feature-')
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

  it('AC-24: /plan dispatches plan-generator with metadata + dispatch event', async () => {
    const workspace = tempDir('cmd-specdev-plan-dispatch-')
    const slug = 'plan-dispatch'
    const slugDir = join(workspace, '.specdev', 'specs', slug)
    mkdirSync(slugDir, { recursive: true })
    writeStatusFixture(join(slugDir, 'current-status.json'), {
      ...createInitialStatus(slug),
      human_gates: { hg1: 'passed', hg2: 'pending', hg3: 'pending' },
      current_stage: 'architecture-design',
    })
    writeFileSync(join(workspace, '.specdev', 'active-workflow'), `${slug}\n`)
    writeFileSync(join(slugDir, 'requirements.md'), '# Requirements\n\nenough\n')

    const test = await harness(workspace)
    const result = await run(test, '/plan')
    expect(result.kind).toBe('success')
    expect(result.text).toContain('plan-generator')
    expect(result.text).toContain('specdev/dispatch')
    expect(readSpecdevMetadata(test.agent).role).toBe('orchestrator')
    const dispatchEvents = test.session.snapshotEvents().filter(event => event.type === 'specdev/dispatch')
    expect(dispatchEvents).toHaveLength(1)
    expect(dispatchEvents[0]?.data).toMatchObject({
      kind: 'specdev/dispatch',
      role: 'plan-generator',
      slug,
    })
  })

  it('VP-2/AC-26: ambiguous confirm-gate reply does not pass HG-1', async () => {
    const workspace = tempDir('cmd-specdev-ok-')
    const slugDir = join(workspace, '.specdev', 'specs', 'demo')
    mkdirSync(slugDir, { recursive: true })
    writeStatusFixture(join(slugDir, 'current-status.json'), createInitialStatus('demo'))
    writeFileSync(join(workspace, '.specdev', 'active-workflow'), 'demo\n')
    writeFileSync(join(slugDir, 'requirements.md'), '# Requirements\n\nok\n')

    expect(interpretGateReply('ok')).toBe('ambiguous')
    expect(interpretGateReply('好的')).toBe('ambiguous')
    expect(interpretGateReply('确认')).toBe('pass')
    expect(interpretGateReply('defer')).toBe('defer')
    expect(interpretGateReply('推迟')).toBe('defer')

    const test = await harness(workspace)
    const ambiguous = await run(test, '/confirm-gate hg1 ok')
    expect(ambiguous.kind).toBe('error')
    expect(ambiguous.text).toContain('Ambiguous')
    expect(test.ctx.specdev.readStatus('demo', { cwd: workspace }).human_gates.hg1).toBe('pending')

    const passed = await run(test, '/confirm-gate hg1 确认')
    expect(passed.kind).toBe('success')
    expect(test.ctx.specdev.readStatus('demo', { cwd: workspace }).human_gates.hg1).toBe('passed')
  })

  it('SF-1: defer/推迟 passes decision=defer to confirmGate (not reject)', async () => {
    const workspace = tempDir('cmd-specdev-defer-')
    const slugDir = join(workspace, '.specdev', 'specs', 'defer-demo')
    mkdirSync(slugDir, { recursive: true })
    writeStatusFixture(join(slugDir, 'current-status.json'), createInitialStatus('defer-demo'))
    writeFileSync(join(workspace, '.specdev', 'active-workflow'), 'defer-demo\n')
    writeFileSync(join(slugDir, 'requirements.md'), '# Requirements\n\nok\n')

    const test = await harness(workspace)
    const deferred = await run(test, '/confirm-gate hg1 defer')
    expect(deferred.kind).toBe('success')
    expect(deferred.text).toContain('decision=defer')
    expect(test.ctx.specdev.readStatus('defer-demo', { cwd: workspace }).human_gates.hg1).toBe('pending')

    const events = test.session.snapshotEvents().filter(event => event.type === 'specdev/gate-decided')
    expect(events).toHaveLength(1)
    expect(events[0]?.data).toMatchObject({
      kind: 'specdev/gate-decided',
      gate: 'hg1',
      decision: 'defer',
    })

    const deferredZh = await run(test, '/confirm-gate hg1 推迟')
    expect(deferredZh.kind).toBe('success')
    expect(deferredZh.text).toContain('decision=defer')
    expect(test.ctx.specdev.readStatus('defer-demo', { cwd: workspace }).human_gates.hg1).toBe('pending')
  })

  it('AC-33: /confirm-gate phase-entry defer passes phaseEntry + later target', async () => {
    const workspace = tempDir('cmd-specdev-phase-entry-')
    const slugDir = join(workspace, '.specdev', 'specs', 'pe')
    mkdirSync(slugDir, { recursive: true })
    writeFileSync(join(workspace, '.specdev', 'active-workflow'), 'pe\n')
    writeFileSync(join(slugDir, 'phase-plan.md'), `# Plan

\`\`\`json
{
  "phases": [
    { "id": "phase-1-p0-core", "name": "P1", "dependencies": [], "acceptance_criteria": [] },
    { "id": "phase-2-commands", "name": "P2", "dependencies": ["phase-1-p0-core"], "acceptance_criteria": [] },
    { "id": "phase-5-wiki", "name": "P5", "dependencies": ["phase-2-commands"], "acceptance_criteria": [] }
  ]
}
\`\`\`
`)
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
      ...createInitialStatus('pe'),
      human_gates: { hg1: 'passed', hg2: 'passed', hg3: 'pending' },
      current_stage: 'phase-implementation',
      current_phase: 'phase-2-commands',
      phases: {
        'phase-1-p0-core': { implementer: 'completed', reviewer: 'completed', verifier: 'completed' },
        'phase-2-commands': { implementer: 'pending', reviewer: 'pending', verifier: 'pending' },
      },
    })

    const test = await harness(workspace)
    expect(test.ctx.specdev.listPhaseEntryDebt('phase-2-commands', { cwd: workspace }).map(i => i.id))
      .toEqual(['STUB-A'])

    const result = await run(
      test,
      '/confirm-gate phase-entry defer STUB-A to phase-5-wiki',
    )
    expect(result.kind).toBe('success')
    expect(result.text).toContain('decision=defer')
    expect(result.text).toContain('items=STUB-A')
    expect(result.text).toContain('deferredTarget=phase-5-wiki')
    expect(test.ctx.specdev.listPhaseEntryDebt('phase-2-commands', { cwd: workspace })).toEqual([])
  })

  it('SF-2: /bugfix and /brief persist pipeline_mode on durable status + snapshot', async () => {
    const workspace = tempDir('cmd-specdev-pipeline-')
    const test = await harness(workspace)

    const bugfix = await run(test, '/bugfix fix login crash')
    expect(bugfix.kind).toBe('success')
    const bugfixStatus = test.ctx.specdev.readStatus('fix-login-crash', { cwd: workspace })
    expect(bugfixStatus.pipeline_mode).toBe('bugfix')
    expect(bugfixStatus.initiating_command).toBe('bugfix')
    const bugfixSnap = test.ctx.specdev.snapshot(test.session, { cwd: workspace })
    expect(bugfixSnap?.pipelineMode).toBe('bugfix')
    expect(bugfixSnap?.initiatingCommand).toBe('bugfix')
    expect(bugfixSnap?.schemaVersion).toBe(2)

    const briefWorkspace = tempDir('cmd-specdev-brief-')
    const briefTest = await harness(briefWorkspace)
    const brief = await run(briefTest, '/brief tiny tweak')
    expect(brief.kind).toBe('success')
    const briefStatus = briefTest.ctx.specdev.readStatus('tiny-tweak', { cwd: briefWorkspace })
    expect(briefStatus.pipeline_mode).toBe('brief')
    expect(briefStatus.initiating_command).toBe('brief')

    const statusReport = await run(briefTest, '/status')
    expect(statusReport.kind).toBe('success')
    expect(statusReport.text).toContain('pipelineMode: brief')
    expect(statusReport.text).toContain('initiatingCommand: brief')
  })

  it('VP-4/AC-16: /plan before HG-1 is refused', async () => {
    const workspace = tempDir('cmd-specdev-plan-')
    const test = await harness(workspace)
    await run(test, '/feature early plan')
    const result = await run(test, '/plan')
    expect(result.kind).toBe('error')
    expect(result.text).toMatch(/HG-1/)
  })

  it('AC-18: /status matches snapshot fields', async () => {
    const workspace = tempDir('cmd-specdev-status-')
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
    const workspace = tempDir('cmd-specdev-implement-')
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
    writeStatusFixture(join(slugDir, 'current-status.json'), {
      ...createInitialStatus(slug, 'feature', { initiating_command: 'feature', pipeline_mode: 'feature' }),
      human_gates: { hg1: 'passed', hg2: 'passed', hg3: 'pending' },
      current_stage: 'phase-implementation',
      current_phase: 'phase-1-p0-core',
      phases: {
        'phase-1-p0-core': { implementer: 'pending', reviewer: 'pending', verifier: 'pending' },
      },
    })
    const impl = await run(test, '/implement')
    expect(impl.kind).toBe('success')
    expect(impl.text).not.toContain('@STUB(phase-4-phase-runtime)')
    expect(impl.text).toContain('code-explorer')
    expect(impl.text).toContain('impl-phase-1-p0-core')
    expect(impl.text).toMatch(/followup=true/)
  })

  it('registers /wiki stub only (STUB-002 remains Phase 5)', async () => {
    const workspace = tempDir('cmd-specdev-wiki-stub-')
    const test = await harness(workspace)
    const wiki = await run(test, '/wiki')
    expect(wiki.kind).toBe('error')
    expect(wiki.text).toContain('@STUB(phase-5-wiki-hardening)')
  })

  it('VP-4: /implement blocks on Phase Entry Gate with 🔴 debt', async () => {
    const workspace = tempDir('cmd-specdev-entry-')
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
    writeStatusFixture(join(slugDir, 'current-status.json'), {
      ...createInitialStatus(slug, 'feature', { initiating_command: 'feature', pipeline_mode: 'feature' }),
      human_gates: { hg1: 'passed', hg2: 'passed', hg3: 'pending' },
      current_stage: 'phase-implementation',
      current_phase: 'phase-2-commands',
      phases: {
        'phase-2-commands': { implementer: 'pending', reviewer: 'pending', verifier: 'pending' },
      },
    })
    const impl = await run(test, '/implement')
    expect(impl.kind).toBe('error')
    expect(impl.text).toContain('Phase Entry Gate')
    expect(impl.text).toContain('STUB-X')
  })
})
