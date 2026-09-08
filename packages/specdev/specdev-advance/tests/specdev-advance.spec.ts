/**
 * SpecDev advance: VP-5 — role subagent completion emits `specdev/advance`.
 */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import AgentRegistry, { Inbox, agentEvents, type Agent, type AgentStatus } from '@deepseek-ai/dsh-agent'
import SessionStore, { SessionId, type Session } from '@deepseek-ai/dsh-session'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import SpecdevService, {
  attachSpecdevMetadata,
  createInitialStatus,
  parseCurrentStatus,
  type CurrentStatusJson,
} from '@deepseek-ai/dsh-specdev'
import SpecdevAdvance, { emitAdvanceForAgent, guidanceForRole } from '@deepseek-ai/dsh-specdev-advance'

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

function stubAgent(session: Session): Agent {
  const inbox = new Inbox(session, { inserted: () => {}, discarded: () => {}, claimed: () => {} })
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
    expect(guidanceForRole('verifier')).toContain('Human Gate 3')
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
    await ctx.plugin(SpecdevAdvance)

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
    expect((data as { snapshot: unknown }).snapshot).toBeNull()
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
      human_gates: { hg1: 'passed', hg2: 'passed', hg3: 'passed' },
      current_stage: 'phase-implementation',
      current_phase: 'phase-1-p0-core',
      phases: {
        'phase-1-p0-core': { implementer: 'pending', reviewer: 'pending', verifier: 'pending' },
      },
    })

    const ctx = new Context()
    await ctx.plugin(SessionStore)
    await ctx.plugin(SessionProjectionRegistry)
    await ctx.plugin(AgentRegistry)
    await ctx.plugin(SpecdevService)
    await ctx.plugin(SpecdevAdvance)

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
    await ctx.plugin(SpecdevAdvance)

    const session = ctx.sessions.create(SessionId('solo'), { meta: { cwd: process.cwd() } })
    const agent = stubAgent(session)
    attachSpecdevMetadata(agent, { role: 'orchestrator', slug: 'x' })
    ctx.agents.register(agent)
    expect(emitAdvanceForAgent(ctx, agent)).toBeNull()
  })
})
