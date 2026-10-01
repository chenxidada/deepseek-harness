/**
 * SpecDev advance: VP-5 — role subagent completion emits `specdev/advance`.
 */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import AgentRegistry, { agentEvents, type Agent, type AgentStatus } from '@deepseek-ai/dsh-agent'
import SessionStore, { SessionId, type Session } from '@deepseek-ai/dsh-session'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import type { SubagentRunEndInfo, SubagentRunId } from '@deepseek-ai/dsh-subagent'
import SpecdevService, {
  ADVANCE_ROLES,
  attachSpecdevMetadata,
  createInitialStatus,
  emitAdvanceForAgent,
  guidanceForRole,
  parseCurrentStatus,
  type CurrentStatusJson,
  MemoryInbox,
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

function writeStatusFixture(path: string, status: CurrentStatusJson): void {
  parseCurrentStatus(status)
  writeFileSync(path, `${JSON.stringify(status, null, 2)}\n`)
}

/**
 * A `subagent/end` payload for a child this fixture never started: the runtime
 * listener reads only `info.id`, while the run identity belongs to the provider.
 */
function subagentEnd(id: SessionId): SubagentRunEndInfo {
  return {
    runId: 'run-fixture' as SubagentRunId,
    provider: 'inproc',
    id,
    local: true,
    stopReason: 'completed',
  }
}

function stubAgent(session: Session): Agent {
  const inbox = new MemoryInbox()
  let status: AgentStatus = 'idle'
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
    cancel() { status = 'idle' },
    runMaintenance: task => task(new AbortController().signal),
    whenIdle() { return Promise.resolve() },
  }
}

describe('SpecDev advance VP-5', () => {
  it('guidanceForRole mirrors pipeline-advance Human Gate pauses', () => {
    expect(guidanceForRole('requirement-analyst')).toContain('Human Gate 1')
    expect(guidanceForRole('implementer')).toContain('reviewer-correctness')
    expect(guidanceForRole('implementer')).toContain('mergePhaseReviews')
    expect(guidanceForRole('implementer')).toContain('bumpLoopCount')
    expect(guidanceForRole('verifier')).toContain('Human Gate 3')
    expect(guidanceForRole('verifier')).toContain('completePhaseGit')
    expect(guidanceForRole('verifier')).toContain('phaseId')
  })

  it('VP-5: mock role subagent running→idle emits specdev/advance on parent', async () => {
    const workspace = tempDir('specdev-advance-vp5-')
    const layout = join(workspace, '.specdev')
    const slug = 'wf-adv'
    mkdirSync(join(layout, 'specs', slug), { recursive: true })
    writeFileSync(join(layout, 'active-workflow'), `${slug}\n`)
    writeStatusFixture(
      join(layout, 'specs', slug, 'current-status.json'),
      createInitialStatus(slug, 'advance'),
    )

    const ctx = new Context()
    await ctx.plugin(SessionStore)
    await ctx.plugin(SessionProjectionRegistry)
    await ctx.plugin(AgentRegistry)
    await ctx.plugin(SpecdevService)

    const parentSession = ctx.sessions.create(SessionId('orch-adv'), { meta: { cwd: workspace } })
    const parent = stubAgent(parentSession)
    ctx.agents.register(parent)

    const childSession = ctx.sessions.create(SessionId('child-impl'), {
      meta: {
        cwd: workspace,
        parentSession: parentSession.id,
        origin: 'subagent',
      },
    })
    const child = stubAgent(childSession)
    attachSpecdevMetadata(child, { role: 'implementer', slug, phaseId: 'phase-1-p0-core' })
    ctx.agents.register(child)

    // Simulate agent-loop transitions: idle → running → idle (primary AC-39 path).
    agentEvents(ctx, child).emit('agent/status', { status: 'running' })
    agentEvents(ctx, child).emit('agent/status', { status: 'idle' })

    const events = parentSession.snapshotEvents().filter(event => event.type === 'specdev/advance')
    expect(events.length).toBe(1)
    const data = events[0]!.data as { nextAction: string; kind: string; version: number }
    expect(data.kind).toBe('specdev/advance')
    expect(data.version).toBe(1)
    expect(data.nextAction).toContain('implementer completed')
    expect(data.nextAction).toContain('reviewer-correctness')
    // No confirmGate / projection yet → advance must not embed file snapshot (AC-28).
    expect((data as unknown as { snapshot: unknown }).snapshot).toBeNull()
  })

  it('AC-28: forge file HG + emitAdvance leaves fail-closed projection (snapshot null)', async () => {
    const workspace = tempDir('specdev-advance-ac28-')
    const layout = join(workspace, '.specdev')
    const slug = 'wf-forge'
    mkdirSync(join(layout, 'specs', slug), { recursive: true })
    writeFileSync(join(layout, 'active-workflow'), `${slug}\n`)
    const statusPath = join(layout, 'specs', slug, 'current-status.json')
    writeStatusFixture(statusPath, createInitialStatus(slug, 'forge'))
    writeStatusFixture(statusPath, {
      ...createInitialStatus(slug, 'forge'),
      human_gates: { hg1_5: 'pending', hg1: 'passed', hg2: 'passed', hg3: 'passed' },
      current_stage: 'phase-implementation',
      current_phase: 'phase-1-p0-core',
      phases: {
        'phase-1-p0-core': { implementer: 'pending', reviewer: 'pending', verifier: 'pending', prototype: 'pending' },
      },
    })

    const ctx = new Context()
    await ctx.plugin(SessionStore)
    await ctx.plugin(SessionProjectionRegistry)
    await ctx.plugin(AgentRegistry)
    await ctx.plugin(SpecdevService)

    const parentSession = ctx.sessions.create(SessionId('orch-forge'), { meta: { cwd: workspace } })
    const childSession = ctx.sessions.create(SessionId('child-forge'), {
      meta: { cwd: workspace, parentSession: parentSession.id, origin: 'subagent' },
    })
    const child = stubAgent(childSession)
    attachSpecdevMetadata(child, { role: 'plan-generator', slug })
    ctx.agents.register(child)

    const event = emitAdvanceForAgent(ctx, child)
    expect(event?.snapshot).toBeNull()

    const projected = ctx.sessionProjections.stateOf(parentSession, 'specdev/status')
    expect(projected?.status).toBeNull()
    expect(ctx.specdev.snapshot(undefined, { cwd: workspace })?.gates.hg2).toBe('passed')
  })

  it('emitAdvanceForAgent is a no-op for orchestrator / missing role', async () => {
    const ctx = new Context()
    await ctx.plugin(SessionStore)
    await ctx.plugin(SessionProjectionRegistry)
    await ctx.plugin(AgentRegistry)
    await ctx.plugin(SpecdevService)

    const session = ctx.sessions.create(SessionId('solo'), { meta: { cwd: process.cwd() } })
    const agent = stubAgent(session)
    attachSpecdevMetadata(agent, { role: 'orchestrator', slug: 'x' })
    ctx.agents.register(agent)
    expect(emitAdvanceForAgent(ctx, agent)).toBeNull()
  })
})

describe('SpecDev advance guidance and completion signals', () => {
  it('states the next action of every role that can advance', () => {
    expect([...ADVANCE_ROLES]).not.toContain('orchestrator')
    expect(guidanceForRole('reviewer-correctness')).toContain('ctx.specdev.mergePhaseReviews')
    expect(guidanceForRole('reviewer-design')).toContain('ctx.specdev.mergePhaseReviews')
    expect(guidanceForRole('reviewer-connectivity')).toContain('ctx.specdev.mergePhaseReviews')
    expect(guidanceForRole('reviewer-visual')).toContain('review-visual.md')
    expect(guidanceForRole('reviewer')).toContain('dispatch verifier')
    expect(guidanceForRole('code-explorer')).toContain('impl-<phase> branch')
    expect(guidanceForRole('wiki')).toContain('No Knowledge Base / Knownbase sync')
    expect(guidanceForRole('orchestrator')).toContain('no SpecDev advance action')
    expect(guidanceForRole('not-a-role' as never)).toContain('SpecDev role not-a-role completed')
  })

  /** Composition whose parent owns one registered role child. */
  async function signalHarness(prefix: string, parentSession?: SessionId | null) {
    const workspace = tempDir(prefix)
    const ctx = new Context()
    await ctx.plugin(SessionStore)
    await ctx.plugin(SessionProjectionRegistry)
    await ctx.plugin(AgentRegistry)
    await ctx.plugin(SpecdevService)

    const parentSessionId = ctx.sessions.create(SessionId(`orch-${Math.random()}`), { meta: { cwd: workspace } }).id
    const parent = stubAgent(ctx.sessions.get(parentSessionId) as Session)
    ctx.agents.register(parent)

    const lineage = parentSession === undefined ? parentSessionId : parentSession
    const childSession = ctx.sessions.create(SessionId(`child-${Math.random()}`), {
      meta: {
        cwd: workspace,
        ...lineage === null ? {} : { parentSession: lineage },
        origin: 'subagent',
      },
    })
    const child = stubAgent(childSession)
    attachSpecdevMetadata(child, { role: 'implementer', slug: 'wf-signal' })
    ctx.agents.register(child)
    return { ctx, parent, child, childSession }
  }

  it('ignores an idle that was never running and keeps one advance per completion', async () => {
    const { ctx, parent, child } = await signalHarness('specdev-advance-signal-')
    // First observation is already idle: no transition, no advance.
    agentEvents(ctx, child).emit('agent/status', { status: 'idle' })
    expect(parent.session.snapshotEvents().filter(event => event.type === 'specdev/advance')).toHaveLength(0)

    agentEvents(ctx, child).emit('agent/status', { status: 'running' })
    agentEvents(ctx, child).emit('agent/status', { status: 'idle' })
    expect(parent.session.snapshotEvents().filter(event => event.type === 'specdev/advance')).toHaveLength(1)
  })

  it('emits on the child session when the child has no parent session', async () => {
    const { ctx, child, childSession } = await signalHarness('specdev-advance-orphan-', null)
    agentEvents(ctx, child).emit('agent/status', { status: 'running' })
    agentEvents(ctx, child).emit('agent/status', { status: 'idle' })
    expect(childSession.snapshotEvents().filter(event => event.type === 'specdev/advance')).toHaveLength(1)
  })

  it('emits on the child session when the recorded parent session is gone', async () => {
    const { ctx, child, childSession } = await signalHarness(
      'specdev-advance-detached-',
      SessionId('orch-never-registered'),
    )
    agentEvents(ctx, child).emit('agent/status', { status: 'running' })
    agentEvents(ctx, child).emit('agent/status', { status: 'idle' })
    expect(childSession.snapshotEvents().filter(event => event.type === 'specdev/advance')).toHaveLength(1)
  })

  it('accepts subagent/end as the completion signal when status was missed', async () => {
    const { ctx, parent, child } = await signalHarness('specdev-advance-subagent-')
    ctx.emit('subagent/end', subagentEnd(child.session.id))
    expect(parent.session.snapshotEvents().filter(event => event.type === 'specdev/advance')).toHaveLength(1)
  })

  it('dedupes a subagent/end whose completion the status signal already reported', async () => {
    const { ctx, parent, child } = await signalHarness('specdev-advance-subagent-dedupe-')
    agentEvents(ctx, child).emit('agent/status', { status: 'running' })
    agentEvents(ctx, child).emit('agent/status', { status: 'idle' })
    ctx.emit('subagent/end', subagentEnd(child.session.id))
    expect(parent.session.snapshotEvents().filter(event => event.type === 'specdev/advance')).toHaveLength(1)
  })

  it('dedupes a status transition that lands after the fallback reported completion', async () => {
    const { ctx, parent, child } = await signalHarness('specdev-advance-subagent-late-')
    agentEvents(ctx, child).emit('agent/status', { status: 'running' })
    // The fallback reports the completion before the idle transition arrives.
    ctx.emit('subagent/end', subagentEnd(child.session.id))
    agentEvents(ctx, child).emit('agent/status', { status: 'idle' })
    expect(parent.session.snapshotEvents().filter(event => event.type === 'specdev/advance')).toHaveLength(1)
  })

  it('ignores a subagent/end for an unknown child id', async () => {
    const { ctx, parent } = await signalHarness('specdev-advance-unknown-')
    ctx.emit('subagent/end', subagentEnd(SessionId('never-registered')))
    expect(parent.session.snapshotEvents().filter(event => event.type === 'specdev/advance')).toHaveLength(0)
  })
})
