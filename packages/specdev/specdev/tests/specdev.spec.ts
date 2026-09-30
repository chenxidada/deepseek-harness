/**
 * SpecDev runtime integration: fixture `.specdev` → resolveRoot / confirmGate
 * → durable file + session event + `specdev/status` projection (real Cordis
 * composition, no mocks of the SpecDev data path).
 */

import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import AgentRegistry, { Inbox, type Agent, type AgentStatus } from '@deepseek-ai/dsh-agent'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import SpecdevService, {
  attachSpecdevMetadata,
  createInitialStatus,
  hasSpecdevLayout,
  inferPendingGate,
  parseCurrentStatus,
  readSpecdevMetadata,
  resolveWorkspaceRoot,
  SPECDEV_ROLES,
  SPECDEV_SCHEMA_VERSION,
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

/** Fixture helper — does not use the removed public writeCurrentStatusFile export. */
function writeStatusFixture(path: string, status: CurrentStatusJson): void {
  parseCurrentStatus(status)
  writeFileSync(path, `${JSON.stringify(status, null, 2)}\n`)
}

async function harness(cwd: string) {
  const ctx = new Context()
  await ctx.plugin(SessionStore)
  await ctx.plugin(SessionProjectionRegistry)
  await ctx.plugin(SpecdevService)
  const session = ctx.sessions.create(SessionId(`specdev-${Math.random()}`), {
    meta: { cwd },
  })
  return { ctx, session }
}

describe('SpecDev Q-1 workspace root resolution', () => {
  it('prefers a secondary folder that already contains .specdev over primary', () => {
    const root = tempDir('specdev-q1-')
    const primary = join(root, 'primary')
    const secondary = join(root, 'secondary')
    mkdirSync(primary, { recursive: true })
    mkdirSync(join(secondary, '.specdev'), { recursive: true })

    const resolved = resolveWorkspaceRoot({
      cwd: primary,
      folders: [primary, secondary],
    })
    expect(resolved).toBe(secondary)
    expect(hasSpecdevLayout(resolved)).toBe(true)
  })

  it('falls back to primary when no candidate has .specdev', () => {
    const root = tempDir('specdev-q1-empty-')
    const primary = join(root, 'a')
    const other = join(root, 'b')
    mkdirSync(primary, { recursive: true })
    mkdirSync(other, { recursive: true })
    expect(resolveWorkspaceRoot({ folders: [primary, other], cwd: other })).toBe(primary)
  })
})

describe('SpecDev confirmGate → file + event + projection', () => {
  it('passes HG-1 on a fixture workflow and clears pendingGate in projection', async () => {
    const workspace = tempDir('specdev-hg1-')
    const layout = join(workspace, '.specdev')
    const slugDir = join(layout, 'specs', 'demo-feature')
    mkdirSync(slugDir, { recursive: true })
    const status = createInitialStatus('demo-feature', 'feature')
    writeStatusFixture(join(slugDir, 'current-status.json'), status)
    writeFileSync(join(layout, 'active-workflow'), 'demo-feature\n')
    writeFileSync(join(slugDir, 'requirements.md'), '# Requirements\n\nAC-1: demo\n')

    const { ctx, session } = await harness(workspace)
    expect(ctx.specdev.active({ cwd: workspace })?.slug).toBe('demo-feature')

    const before = ctx.specdev.snapshot(session, { cwd: workspace })
    expect(before?.gates.hg1).toBe('pending')
    expect(before?.pendingGate).toBe('hg1')

    const result = await ctx.specdev.confirmGate(session, {
      gate: 'hg1',
      decision: 'pass',
      note: 'HG-1 confirmed in integration test',
    }, { cwd: workspace })

    expect(result.ok).toBe(true)
    expect(result.snapshot?.gates.hg1).toBe('passed')
    expect(result.snapshot?.pendingGate).toBe('hg2')
    expect(result.snapshot?.stage).toBe('architecture-design')

    const durable = JSON.parse(readFileSync(join(slugDir, 'current-status.json'), 'utf8')) as {
      human_gates: { hg1: string }
      current_stage: string
    }
    expect(durable.human_gates.hg1).toBe('passed')
    expect(durable.current_stage).toBe('architecture-design')

    const events = session.snapshotEvents().filter(event => event.type === 'specdev/gate-decided')
    expect(events).toHaveLength(1)
    expect(events[0]?.data).toMatchObject({
      kind: 'specdev/gate-decided',
      gate: 'hg1',
      decision: 'pass',
      snapshot: { gates: { hg1: 'passed' }, pendingGate: 'hg2' },
    })

    const projected = ctx.sessionProjections.stateOf(session, 'specdev/status')
    expect(projected?.failure).toBeNull()
    expect(projected?.status?.gates.hg1).toBe('passed')
    expect(projected?.status?.pendingGate).toBe('hg2')
    const wire = ctx.sessionProjections.snapshot(session, ['specdev/status'])
    expect(wire.values['specdev/status']).toMatchObject({ gates: { hg1: 'passed' }, pendingGate: 'hg2' })
  })

  it('rejects ambiguous decisions without mutating gates', async () => {
    const workspace = tempDir('specdev-reject-')
    await (async () => {
      const layout = join(workspace, '.specdev', 'specs', 'x')
      mkdirSync(layout, { recursive: true })
      writeStatusFixture(join(layout, 'current-status.json'), createInitialStatus('x'))
      writeFileSync(join(workspace, '.specdev', 'active-workflow'), 'x\n')
    })()

    const { ctx, session } = await harness(workspace)
    const result = await ctx.specdev.confirmGate(session, {
      gate: 'hg1',
      decision: 'maybe',
    }, { cwd: workspace })
    expect(result.ok).toBe(false)
    expect(result.code).toBe('SPECDEV_INVALID_DECISION')
    const durable = JSON.parse(
      readFileSync(join(workspace, '.specdev', 'specs', 'x', 'current-status.json'), 'utf8'),
    ) as { human_gates: { hg1: string } }
    expect(durable.human_gates.hg1).toBe('pending')
    expect(session.snapshotEvents()).toHaveLength(0)
  })

  it('refuses HG-2 before HG-1', async () => {
    const workspace = tempDir('specdev-order-')
    const layout = join(workspace, '.specdev', 'specs', 'ordered')
    mkdirSync(layout, { recursive: true })
    writeStatusFixture(join(layout, 'current-status.json'), createInitialStatus('ordered'))
    writeFileSync(join(workspace, '.specdev', 'active-workflow'), 'ordered\n')

    const { ctx, session } = await harness(workspace)
    const result = await ctx.specdev.confirmGate(session, {
      gate: 'hg2',
      decision: 'pass',
    }, { cwd: workspace })
    expect(result.ok).toBe(false)
    expect(result.code).toBe('SPECDEV_GATE_PRECONDITION')
  })

  it('rejects non-current gate without forking pendingGate (GAP-001)', async () => {
    const workspace = tempDir('specdev-gap001-')
    const slugDir = join(workspace, '.specdev', 'specs', 'fork-fix')
    mkdirSync(slugDir, { recursive: true })
    writeStatusFixture(join(slugDir, 'current-status.json'), createInitialStatus('fork-fix'))
    writeFileSync(join(workspace, '.specdev', 'active-workflow'), 'fork-fix\n')
    const before = readFileSync(join(slugDir, 'current-status.json'), 'utf8')

    const { ctx, session } = await harness(workspace)
    // HG-1 still pending — reject hg2 must fail (not write pendingGate=hg2 into projection).
    const result = await ctx.specdev.confirmGate(
      session,
      { gate: 'hg2', decision: 'reject', note: 'GAP-001 regression' },
      { cwd: workspace },
    )
    expect(result.ok).toBe(false)
    expect(result.code).toBe('SPECDEV_GATE_NOT_PENDING')
    expect(readFileSync(join(slugDir, 'current-status.json'), 'utf8')).toBe(before)
    expect(session.snapshotEvents()).toHaveLength(0)

    const durable = JSON.parse(before) as Parameters<typeof inferPendingGate>[0]
    expect(inferPendingGate(durable, false)).toBe('hg1')
    const snap = ctx.specdev.snapshot(session, { cwd: workspace })
    expect(snap?.pendingGate).toBe('hg1')
    // Failed request must not leave projection pendingGate=hg2 (GAP-001 fork).
    const projected = ctx.sessionProjections.stateOf(session, 'specdev/status')
    expect(projected?.status?.pendingGate).not.toBe('hg2')
  })

  it('reject of current pending gate keeps pendingGate aligned with durable', async () => {
    const workspace = tempDir('specdev-reject-current-')
    const slugDir = join(workspace, '.specdev', 'specs', 'reject-ok')
    mkdirSync(slugDir, { recursive: true })
    writeStatusFixture(join(slugDir, 'current-status.json'), createInitialStatus('reject-ok'))
    writeFileSync(join(workspace, '.specdev', 'active-workflow'), 'reject-ok\n')

    const { ctx, session } = await harness(workspace)
    const result = await ctx.specdev.confirmGate(
      session,
      { gate: 'hg1', decision: 'reject' },
      { cwd: workspace },
    )
    expect(result.ok).toBe(true)
    expect(result.snapshot?.pendingGate).toBe('hg1')
    expect(result.snapshot?.gates.hg1).toBe('pending')

    const durable = JSON.parse(readFileSync(join(slugDir, 'current-status.json'), 'utf8')) as Parameters<
      typeof inferPendingGate
    >[0]
    expect(inferPendingGate(durable, false)).toBe('hg1')
    const projected = ctx.sessionProjections.stateOf(session, 'specdev/status')
    expect(projected?.status?.pendingGate).toBe('hg1')
    const snap = ctx.specdev.snapshot(session, { cwd: workspace })
    expect(snap?.pendingGate).toBe(inferPendingGate(durable, false))
  })

  it('does not re-export writeCurrentStatusFile from the package root (DEBT-001)', async () => {
    const mod = await import('@deepseek-ai/dsh-specdev')
    expect('writeCurrentStatusFile' in mod).toBe(false)
  })

  it('ensureLayout creates real layout and active-workflow', async () => {
    const workspace = tempDir('specdev-layout-')
    const { ctx } = await harness(workspace)
    const active = await ctx.specdev.ensureLayout({
      slug: 'new-feature',
      command: 'feature',
      workspaceRoot: workspace,
    })
    expect(active.slug).toBe('new-feature')
    expect(hasSpecdevLayout(workspace)).toBe(true)
    expect(readFileSync(join(workspace, '.specdev', 'active-workflow'), 'utf8').trim()).toBe('new-feature')
    expect(readFileSync(join(workspace, '.specdev', 'constitution.md'), 'utf8')).toContain('Constitution')
    expect(readFileSync(join(workspace, '.specdev', 'specs', 'new-feature', 'tech-debt-registry.md'), 'utf8'))
      .toContain('Tech Debt Registry')
    expect(ctx.specdev.readStatus('new-feature', { cwd: workspace }).human_gates.hg1).toBe('pending')
    const created = ctx.specdev.readStatus('new-feature', { cwd: workspace })
    expect(created.pipeline_mode).toBe('feature')
    expect(created.initiating_command).toBe('feature')
    const snap = ctx.specdev.snapshot(undefined, { cwd: workspace })
    expect(snap?.schemaVersion).toBe(SPECDEV_SCHEMA_VERSION)
    expect(snap?.pipelineMode).toBe('feature')
    expect(snap?.initiatingCommand).toBe('feature')
  })

  it('refuses HG-1 pass without requirements.md (AC-32)', async () => {
    const workspace = tempDir('specdev-hg1-req-')
    const slugDir = join(workspace, '.specdev', 'specs', 'no-req')
    mkdirSync(slugDir, { recursive: true })
    writeStatusFixture(join(slugDir, 'current-status.json'), createInitialStatus('no-req'))
    writeFileSync(join(workspace, '.specdev', 'active-workflow'), 'no-req\n')
    const { ctx, session } = await harness(workspace)
    const result = await ctx.specdev.confirmGate(session, { gate: 'hg1', decision: 'pass' }, { cwd: workspace })
    expect(result.ok).toBe(false)
    expect(result.code).toBe('SPECDEV_GATE_PRECONDITION')
  })

  it('sets current_phase from phase-plan DAG on HG-2 pass (AC-30)', async () => {
    const workspace = tempDir('specdev-hg2-phase-')
    const slugDir = join(workspace, '.specdev', 'specs', 'dag-demo')
    mkdirSync(slugDir, { recursive: true })
    const status = {
      ...createInitialStatus('dag-demo'),
      human_gates: { hg1_5: 'pending' as const, hg1: 'passed' as const, hg2: 'pending' as const, hg3: 'pending' as const },
      current_stage: 'architecture-design',
    }
    writeStatusFixture(join(slugDir, 'current-status.json'), status)
    writeFileSync(join(workspace, '.specdev', 'active-workflow'), 'dag-demo\n')
    writeFileSync(join(slugDir, 'requirements.md'), '# Requirements\n\nok\n')
    writeFileSync(join(slugDir, 'design.md'), '# Design\n\nok\n')
    writeFileSync(join(slugDir, 'phase-plan.md'), `# Plan

\`\`\`json
{
  "phases": [
    { "id": "phase-1-runtime-contract", "name": "P1", "dependencies": [], "acceptance_criteria": [] },
    { "id": "phase-2-commands-orchestrator", "name": "P2", "dependencies": ["phase-1-runtime-contract"], "acceptance_criteria": [] }
  ]
}
\`\`\`
`)
    const { ctx, session } = await harness(workspace)
    const result = await ctx.specdev.confirmGate(session, { gate: 'hg2', decision: 'pass' }, { cwd: workspace })
    expect(result.ok).toBe(true)
    expect(result.snapshot?.phase).toBe('phase-1-runtime-contract')
    expect(result.snapshot?.stage).toBe('phase-implementation')
    const durable = JSON.parse(readFileSync(join(slugDir, 'current-status.json'), 'utf8')) as {
      current_phase: string | null
    }
    expect(durable.current_phase).toBe('phase-1-runtime-contract')
  })
})

describe('SpecDev metadata + dependency contract', () => {
  it('attaches specdev.role / slug / phaseId on AgentOptions', () => {
    const agent = { options: {} as Record<string, unknown> } as unknown as Agent
    attachSpecdevMetadata(agent, {
      role: 'implementer',
      slug: 'demo',
      phaseId: 'phase-1-runtime-contract',
    })
    expect(readSpecdevMetadata(agent)).toEqual({
      role: 'implementer',
      slug: 'demo',
      phaseId: 'phase-1-runtime-contract',
    })
    expect(SPECDEV_ROLES).toContain('orchestrator')
  })

  it('dispatchRole writes metadata, parentSession lineage, and specdev/dispatch', async () => {
    const workspace = tempDir('specdev-dispatch-')
    const ctx = new Context()
    await ctx.plugin(SessionStore)
    await ctx.plugin(AgentRegistry)
    await ctx.plugin(SessionProjectionRegistry)
    await ctx.plugin(SpecdevService)

    const parentSession = ctx.sessions.create(SessionId('orch-parent'), { meta: { cwd: workspace } })
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
      role: 'requirement-analyst',
      slug: 'dispatch-demo',
    })
    expect(result.factoryCreated).toBe(false)
    expect(result.presetId).toBe('specdev-requirement-analyst')
    expect(readSpecdevMetadata(result.agent)).toEqual({
      role: 'requirement-analyst',
      slug: 'dispatch-demo',
    })
    expect(result.agent.session.header.parentSession).toBe(parentSession.id)
    const events = parentSession.snapshotEvents().filter(event => event.type === 'specdev/dispatch')
    expect(events).toHaveLength(1)
    expect(events[0]?.data).toMatchObject({
      kind: 'specdev/dispatch',
      role: 'requirement-analyst',
      slug: 'dispatch-demo',
      childSessionId: result.childSessionId,
    })
  })

  it('declares no ACP or SDK protocol package dependencies', () => {
    const pkgPath = fileURLToPath(new URL('../package.json', import.meta.url))
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf8')) as {
      dependencies?: Record<string, string>
      peerDependencies?: Record<string, string>
      devDependencies?: Record<string, string>
    }
    const all = {
      ...pkg.dependencies,
      ...pkg.peerDependencies,
      ...pkg.devDependencies,
    }
    for (const name of Object.keys(all)) {
      expect(name.includes('acp')).toBe(false)
      expect(name.includes('sdk-protocol')).toBe(false)
      expect(name.includes('sdk-jsonrpc')).toBe(false)
    }
  })
})

describe('SpecDev workflow log authority', () => {
  it('adopts a legacy status file into the log and keeps its state', async () => {
    const workspace = tempDir('specdev-adopt-')
    const layout = join(workspace, '.specdev')
    const slugDir = join(layout, 'specs', 'legacy-demo')
    mkdirSync(slugDir, { recursive: true })
    const legacy: CurrentStatusJson = {
      ...createInitialStatus('legacy-demo', 'feature', { initiating_command: 'feature', pipeline_mode: 'feature' }),
      human_gates: { hg1_5: 'pending', hg1: 'passed', hg2: 'passed', hg3: 'pending' },
      current_stage: 'phase-implementation',
      current_phase: 'p1',
      phases: { p1: { implementer: 'completed', reviewer: 'pending', verifier: 'pending', prototype: 'pending' } },
    }
    writeStatusFixture(join(slugDir, 'current-status.json'), legacy)

    const { ctx } = await harness(workspace)
    const active = await ctx.specdev.ensureLayout({ slug: 'legacy-demo', command: 'feature', workspaceRoot: workspace })
    expect(active.slug).toBe('legacy-demo')
    expect(existsSync(join(slugDir, 'workflow.jsonl'))).toBe(true)

    const status = ctx.specdev.readStatus('legacy-demo', { cwd: workspace })
    expect(status.current_stage).toBe('phase-implementation')
    expect(status.current_phase).toBe('p1')
    expect(status.human_gates).toEqual({ hg1: 'passed', hg1_5: 'pending', hg2: 'passed', hg3: 'pending' })
    expect(status.phases).toEqual(legacy.phases)
    expect(status.initiating_command).toBe('feature')

    // The mirror is refreshed from the folded log, never the other way around.
    const mirrored = JSON.parse(readFileSync(join(slugDir, 'current-status.json'), 'utf8')) as CurrentStatusJson
    expect(mirrored.human_gates).toEqual(status.human_gates)
    expect(mirrored.current_phase).toBe('p1')
  })

  it('keeps the log authoritative when the mirror is hand-edited', async () => {
    const workspace = tempDir('specdev-mirror-')
    const layout = join(workspace, '.specdev')
    const slugDir = join(layout, 'specs', 'mirror-demo')
    const { ctx, session } = await harness(workspace)
    await ctx.specdev.ensureLayout({ slug: 'mirror-demo', command: 'feature', workspaceRoot: workspace })
    writeFileSync(join(slugDir, 'requirements.md'), '# Requirements\n\nAC-1: demo\n')
    const passed = await ctx.specdev.confirmGate(session, { gate: 'hg1', decision: 'pass' }, { cwd: workspace })
    expect(passed.ok).toBe(true)

    const mirrorPath = join(slugDir, 'current-status.json')
    const forged = JSON.parse(readFileSync(mirrorPath, 'utf8')) as CurrentStatusJson
    writeStatusFixture(mirrorPath, {
      ...forged,
      human_gates: { hg1_5: 'passed', hg1: 'passed', hg2: 'passed', hg3: 'passed' },
    })

    // Authority ignores the hand-edited mirror; the mirror still reports the flip
    // so gate code can raise it as a tamper signal.
    expect(ctx.specdev.readStatus('mirror-demo', { cwd: workspace }).human_gates).toEqual({
      hg1: 'passed',
      hg1_5: 'pending',
      hg2: 'pending',
      hg3: 'pending',
    })
    expect(ctx.specdev.mirrorSnapshot({ cwd: workspace })?.gates).toEqual({
      hg1: 'passed',
      hg1_5: 'passed',
      hg2: 'passed',
      hg3: 'passed',
    })
  })

  it('refuses authority reads when the log chain is broken', async () => {
    const workspace = tempDir('specdev-tamper-')
    const layout = join(workspace, '.specdev')
    const slugDir = join(layout, 'specs', 'tamper-demo')
    const { ctx, session } = await harness(workspace)
    await ctx.specdev.ensureLayout({ slug: 'tamper-demo', command: 'feature', workspaceRoot: workspace })
    writeFileSync(join(slugDir, 'requirements.md'), '# Requirements\n\nAC-1: demo\n')
    await ctx.specdev.confirmGate(session, { gate: 'hg1', decision: 'pass' }, { cwd: workspace })

    const logPath = join(slugDir, 'workflow.jsonl')
    const lines = readFileSync(logPath, 'utf8').slice(0, -1).split('\n')
    const first = JSON.parse(lines[0] ?? '{}') as { payload: { slug?: string } }
    first.payload.slug = 'forged'
    writeFileSync(logPath, `${JSON.stringify(first)}\n${lines.slice(1).join('\n')}\n`)

    let code = ''
    try {
      ctx.specdev.readStatus('tamper-demo', { cwd: workspace })
    } catch (error: unknown) {
      code = (error as { code?: string }).code ?? ''
    }
    expect(code).toBe('SPECDEV_LOG_TAMPERED')
    expect(() => ctx.specdev.snapshot(session, { cwd: workspace })).toThrow(/hash chain/)
  })

  it('reports no mirror snapshot without an active workflow or readable mirror', async () => {
    const workspace = tempDir('specdev-mirror-none-')
    const { ctx } = await harness(workspace)
    expect(ctx.specdev.mirrorSnapshot({ cwd: workspace })).toBeNull()

    const layout = join(workspace, '.specdev')
    const slugDir = join(layout, 'specs', 'no-mirror')
    mkdirSync(slugDir, { recursive: true })
    writeFileSync(join(layout, 'active-workflow'), 'no-mirror\n')
    expect(ctx.specdev.mirrorSnapshot({ cwd: workspace })).toBeNull()
  })
})
