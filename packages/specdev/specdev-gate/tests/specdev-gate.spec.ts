/**
 * SpecDev gate: VP-1..VP-4 matrix — fail-closed dispatch / authority / loop / branch.
 */

import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import AgentRegistry, { Inbox, agentEvents, type Agent, type AgentStatus } from '@deepseek-ai/dsh-agent'
import { ToolCallId, createUserMessage } from '@deepseek-ai/dsh-llm'
import SessionStore, { SessionId, type Session } from '@deepseek-ai/dsh-session'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import SpecdevService, {
  attachSpecdevMetadata,
  createInitialStatus,
  parseCurrentStatus,
  type CurrentStatusJson,
} from '@deepseek-ai/dsh-specdev'
import SpecdevAdvance, { emitAdvanceForAgent } from '@deepseek-ai/dsh-specdev-advance'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRegistry, { type ToolDefinition } from '@deepseek-ai/dsh-tools'
import SpecdevGate, {
  SpecdevGateDeniedError,
  evaluateRoleDispatch,
  isCurrentStatusPath,
  resolveAuthoritativeStatus,
} from '@deepseek-ai/dsh-specdev-gate'

const tempRoots: string[] = []
const testToolSignal = new AbortController().signal

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

function seedWorkflow(workspace: string, status: CurrentStatusJson): void {
  const layout = join(workspace, '.specdev')
  const slugDir = join(layout, 'specs', status.slug)
  mkdirSync(slugDir, { recursive: true })
  writeFileSync(join(layout, 'active-workflow'), `${status.slug}\n`)
  writeStatusFixture(join(slugDir, 'current-status.json'), status)
  writeFileSync(join(slugDir, 'requirements.md'), '# Requirements\n\n## Goals\n\nenough lines for artifacts\n'.repeat(5))
  writeFileSync(join(slugDir, 'design.md'), '# Design\n\n## Architecture\n\nenough\n'.repeat(5))
  writeFileSync(join(slugDir, 'phase-plan.md'), [
    '# Phase plan',
    '',
    '```json',
    JSON.stringify({
      phases: [{ id: 'phase-1-p0-core', dependencies: [] }],
    }, null, 2),
    '```',
    '',
  ].join('\n'))
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

function writeTool(): ToolDefinition {
  return {
    name: 'write',
    description: 'write file',
    parameters: { type: 'object', properties: { file_path: { type: 'string' }, content: { type: 'string' } } },
    output: {
      schema: { type: 'string' },
      render: (_args, value) => [{ type: 'text', text: value as string }],
    },
    execute: (): Promise<string> => Promise.resolve('wrote'),
  }
}

async function gateHarness(workspace: string, gitBranch: string | null = 'impl-phase-1-p0-core') {
  const ctx = new Context()
  await ctx.plugin(SessionStore)
  await ctx.plugin(SessionProjectionRegistry)
  await ctx.plugin(AgentRegistry)
  await ctx.plugin(SystemPrompt, {})
  await ctx.plugin(ToolRegistry)
  await ctx.plugin(SpecdevService)
  await ctx.plugin(SpecdevGate, { gitBranchReader: () => gitBranch })
  ctx.tools.register(writeTool())
  const session = ctx.sessions.create(SessionId(`gate-${Math.random()}`), { meta: { cwd: workspace } })
  const agent = stubAgent(session)
  ctx.agents.register(agent)
  return { ctx, session, agent }
}

function projectHg2(ctx: Context, session: Session, workspace: string): void {
  const snap = ctx.specdev.snapshot(undefined, { cwd: workspace })!
  session.append('specdev/gate-decided', {
    kind: 'specdev/gate-decided',
    version: 1,
    gate: 'hg2',
    decision: 'pass',
    snapshot: snap,
  })
}

describe('SpecDev gate VP matrix', () => {
  it('VP-1: dispatch implementer with hg2 pending is denied', async () => {
    const workspace = tempDir('specdev-gate-vp1-')
    const status = createInitialStatus('wf-vp1', 'vp1')
    seedWorkflow(workspace, {
      ...status,
      human_gates: { hg1: 'passed', hg2: 'pending', hg3: 'pending' },
      current_stage: 'architecture-design',
    })
    const { ctx, agent } = await gateHarness(workspace)

    await expect(
      ctx.specdev.dispatchRole(agent, { role: 'implementer', slug: 'wf-vp1' }),
    ).rejects.toBeInstanceOf(SpecdevGateDeniedError)

    try {
      await ctx.specdev.dispatchRole(agent, { role: 'implementer', slug: 'wf-vp1' })
    } catch (error: unknown) {
      expect(error).toBeInstanceOf(SpecdevGateDeniedError)
      expect((error as SpecdevGateDeniedError).code).toMatch(/SPECDEV_(HG2_PENDING|STAGE_MISMATCH)/)
    }
  })

  it('VP-2: implementer while on main is denied', async () => {
    const workspace = tempDir('specdev-gate-vp2-')
    const status = createInitialStatus('wf-vp2', 'vp2')
    seedWorkflow(workspace, {
      ...status,
      human_gates: { hg1: 'passed', hg2: 'passed', hg3: 'pending' },
      current_stage: 'phase-implementation',
      current_phase: 'phase-1-p0-core',
      phases: {
        'phase-1-p0-core': { implementer: 'pending', reviewer: 'pending', verifier: 'pending' },
      },
    })
    const { ctx, session, agent } = await gateHarness(workspace, 'main')
    projectHg2(ctx, session, workspace)

    await expect(
      ctx.specdev.dispatchRole(agent, {
        role: 'implementer',
        slug: 'wf-vp2',
        phaseId: 'phase-1-p0-core',
      }),
    ).rejects.toMatchObject({ code: 'SPECDEV_BRANCH_MISMATCH' })
  })

  it('VP-3: flipping hg flags in JSON only is not treated as passed', async () => {
    const workspace = tempDir('specdev-gate-vp3-')
    const status = createInitialStatus('wf-vp3', 'vp3')
    seedWorkflow(workspace, status)
    const { ctx, session, agent } = await gateHarness(workspace)

    const statusPath = join(workspace, '.specdev', 'specs', 'wf-vp3', 'current-status.json')
    const forged: CurrentStatusJson = {
      ...JSON.parse(readFileSync(statusPath, 'utf8')) as CurrentStatusJson,
      human_gates: { hg1: 'passed', hg2: 'passed', hg3: 'passed' },
      current_stage: 'phase-implementation',
      current_phase: 'phase-1-p0-core',
      phases: {
        'phase-1-p0-core': { implementer: 'pending', reviewer: 'pending', verifier: 'pending' },
      },
      last_update: new Date().toISOString(),
    }
    writeStatusFixture(statusPath, forged)

    const fileSnap = ctx.specdev.snapshot(undefined, { cwd: workspace })
    expect(fileSnap?.gates.hg2).toBe('passed')

    const auth = resolveAuthoritativeStatus(ctx, session, { cwd: workspace })
    expect(auth.authority).toBe('fail-closed')
    expect(auth.gates.hg1).toBe('pending')
    expect(auth.gates.hg2).toBe('pending')
    expect(auth.fileHgDiverged).toBe(true)

    const denial = evaluateRoleDispatch('implementer', auth, { gitBranch: 'impl-phase-1-p0-core' })
    expect(denial?.code).toMatch(/SPECDEV_(HG2_PENDING|STAGE_MISMATCH)/)

    await expect(
      ctx.specdev.dispatchRole(agent, { role: 'implementer', slug: 'wf-vp3' }),
    ).rejects.toBeInstanceOf(SpecdevGateDeniedError)

    expect(isCurrentStatusPath(statusPath)).toBe(true)
    const writeResult = await ctx.tools.execute({
      signal: testToolSignal,
      callId: ToolCallId('write-status'),
      name: 'write',
      arguments: { file_path: statusPath, content: '{}' },
      agent,
    })
    expect(writeResult.isError).toBe(true)
    expect(writeResult.content.some(
      block => block.type === 'text' && block.text.includes('confirmGate'),
    )).toBe(true)
  })

  it('VP-3 advance path: forge JSON + emitAdvance must not authorize implementer', async () => {
    const workspace = tempDir('specdev-gate-vp3-adv-')
    const status = createInitialStatus('wf-vp3-adv', 'vp3-adv')
    seedWorkflow(workspace, status)

    const ctx = new Context()
    await ctx.plugin(SessionStore)
    await ctx.plugin(SessionProjectionRegistry)
    await ctx.plugin(AgentRegistry)
    await ctx.plugin(SystemPrompt, {})
    await ctx.plugin(ToolRegistry)
    await ctx.plugin(SpecdevService)
    await ctx.plugin(SpecdevGate, { gitBranchReader: () => 'impl-phase-1-p0-core' })
    await ctx.plugin(SpecdevAdvance)

    const parentSession = ctx.sessions.create(SessionId('orch-vp3-adv'), { meta: { cwd: workspace } })
    const parent = stubAgent(parentSession)
    ctx.agents.register(parent)

    const statusPath = join(workspace, '.specdev', 'specs', 'wf-vp3-adv', 'current-status.json')
    const forged: CurrentStatusJson = {
      ...JSON.parse(readFileSync(statusPath, 'utf8')) as CurrentStatusJson,
      human_gates: { hg1: 'passed', hg2: 'passed', hg3: 'passed' },
      current_stage: 'phase-implementation',
      current_phase: 'phase-1-p0-core',
      phases: {
        'phase-1-p0-core': { implementer: 'pending', reviewer: 'pending', verifier: 'pending' },
      },
      last_update: new Date().toISOString(),
    }
    writeStatusFixture(statusPath, forged)

    const childSession = ctx.sessions.create(SessionId('child-analyst'), {
      meta: { cwd: workspace, parentSession: parentSession.id, origin: 'subagent' },
    })
    const child = stubAgent(childSession)
    attachSpecdevMetadata(child, { role: 'requirement-analyst', slug: 'wf-vp3-adv' })
    ctx.agents.register(child)

    const emitted = emitAdvanceForAgent(ctx, child)
    expect(emitted).not.toBeNull()
    expect(emitted!.snapshot).toBeNull()

    const auth = resolveAuthoritativeStatus(ctx, parentSession, { cwd: workspace })
    expect(auth.authority).toBe('fail-closed')
    expect(auth.gates.hg1).toBe('pending')
    expect(auth.gates.hg2).toBe('pending')
    expect(auth.fileHgDiverged).toBe(true)

    await expect(
      ctx.specdev.dispatchRole(parent, {
        role: 'implementer',
        slug: 'wf-vp3-adv',
        phaseId: 'phase-1-p0-core',
      }),
    ).rejects.toBeInstanceOf(SpecdevGateDeniedError)
  })

  it('VP-3: after confirmGate, forge file + advance keeps projection gates (not file)', async () => {
    const workspace = tempDir('specdev-gate-vp3-proj-')
    const status = createInitialStatus('wf-vp3-proj', 'vp3-proj')
    seedWorkflow(workspace, status)

    const ctx = new Context()
    await ctx.plugin(SessionStore)
    await ctx.plugin(SessionProjectionRegistry)
    await ctx.plugin(AgentRegistry)
    await ctx.plugin(SystemPrompt, {})
    await ctx.plugin(ToolRegistry)
    await ctx.plugin(SpecdevService)
    await ctx.plugin(SpecdevGate, { gitBranchReader: () => 'impl-phase-1-p0-core' })
    await ctx.plugin(SpecdevAdvance)

    const parentSession = ctx.sessions.create(SessionId('orch-vp3-proj'), { meta: { cwd: workspace } })
    const parent = stubAgent(parentSession)
    ctx.agents.register(parent)

    const passed = await ctx.specdev.confirmGate(parentSession, { gate: 'hg1', decision: 'pass' }, { cwd: workspace })
    expect(passed.ok).toBe(true)
    expect(passed.snapshot?.gates.hg1).toBe('passed')
    expect(passed.snapshot?.gates.hg2).toBe('pending')

    const statusPath = join(workspace, '.specdev', 'specs', 'wf-vp3-proj', 'current-status.json')
    const forged: CurrentStatusJson = {
      ...JSON.parse(readFileSync(statusPath, 'utf8')) as CurrentStatusJson,
      human_gates: { hg1: 'passed', hg2: 'passed', hg3: 'passed' },
      current_stage: 'phase-implementation',
      current_phase: 'phase-1-p0-core',
      phases: {
        'phase-1-p0-core': { implementer: 'pending', reviewer: 'pending', verifier: 'pending' },
      },
      last_update: new Date().toISOString(),
    }
    writeStatusFixture(statusPath, forged)

    const childSession = ctx.sessions.create(SessionId('child-plan'), {
      meta: { cwd: workspace, parentSession: parentSession.id, origin: 'subagent' },
    })
    const child = stubAgent(childSession)
    attachSpecdevMetadata(child, { role: 'plan-generator', slug: 'wf-vp3-proj' })
    ctx.agents.register(child)

    const emitted = emitAdvanceForAgent(ctx, child)
    expect(emitted?.snapshot?.gates.hg1).toBe('passed')
    expect(emitted?.snapshot?.gates.hg2).toBe('pending')
    expect(emitted?.snapshot?.gates.hg3).toBe('pending')

    const auth = resolveAuthoritativeStatus(ctx, parentSession, { cwd: workspace })
    expect(auth.authority).toBe('projection')
    expect(auth.gates.hg2).toBe('pending')
    expect(auth.fileHgDiverged).toBe(true)

    await expect(
      ctx.specdev.dispatchRole(parent, {
        role: 'implementer',
        slug: 'wf-vp3-proj',
        phaseId: 'phase-1-p0-core',
      }),
    ).rejects.toBeInstanceOf(SpecdevGateDeniedError)
  })

  it('AC-36: reviewer* and verifier are denied when hg2 pending', async () => {
    const workspace = tempDir('specdev-gate-ac36-')
    const status = createInitialStatus('wf-ac36', 'ac36')
    seedWorkflow(workspace, {
      ...status,
      human_gates: { hg1: 'passed', hg2: 'pending', hg3: 'pending' },
      current_stage: 'architecture-design',
    })
    const { ctx, agent } = await gateHarness(workspace)

    for (const role of [
      'reviewer',
      'reviewer-correctness',
      'reviewer-design',
      'reviewer-connectivity',
      'verifier',
    ] as const) {
      await expect(
        ctx.specdev.dispatchRole(agent, { role, slug: 'wf-ac36' }),
      ).rejects.toBeInstanceOf(SpecdevGateDeniedError)
    }
  })

  it('agent/pre-step rejects implementer when gates not ready', async () => {
    const workspace = tempDir('specdev-gate-prestep-')
    const status = createInitialStatus('wf-pre', 'pre')
    seedWorkflow(workspace, status)
    const { ctx, session, agent } = await gateHarness(workspace)
    attachSpecdevMetadata(agent, { role: 'implementer', slug: 'wf-pre', phaseId: 'phase-1-p0-core' })

    const message = createUserMessage({
      content: [{ type: 'text', text: 'pre-step probe' }],
      source: { kind: 'user' },
    })
    const decision = await agentEvents(ctx, agent).waterfall(
      'agent/pre-step',
      {
        messages: [message],
        turn: 1,
        step: 1,
        signal: testToolSignal,
      },
      () => Promise.resolve({ kind: 'enter' as const, messages: [message] }),
    )
    expect(decision.kind).toBe('reject')
    // session unused except ensuring harness wired projection for same cwd
    expect(session.header.cwd).toBe(workspace)
  })

  it('VP-4: loop_count=2 blocks further auto loops with escalate', async () => {
    const workspace = tempDir('specdev-gate-vp4-')
    const status = createInitialStatus('wf-vp4', 'vp4')
    seedWorkflow(workspace, {
      ...status,
      human_gates: { hg1: 'passed', hg2: 'passed', hg3: 'pending' },
      current_stage: 'phase-implementation',
      current_phase: 'phase-1-p0-core',
      loop_count: 2,
      phases: {
        'phase-1-p0-core': { implementer: 'pending', reviewer: 'pending', verifier: 'pending' },
      },
    })
    const { ctx, session, agent } = await gateHarness(workspace, 'impl-phase-1-p0-core')
    projectHg2(ctx, session, workspace)

    try {
      await ctx.specdev.dispatchRole(agent, {
        role: 'implementer',
        slug: 'wf-vp4',
        phaseId: 'phase-1-p0-core',
      })
      expect.unreachable('expected denial')
    } catch (error: unknown) {
      expect(error).toBeInstanceOf(SpecdevGateDeniedError)
      const denied = error as SpecdevGateDeniedError
      expect(denied.code).toBe('SPECDEV_LOOP_MAX')
      expect(denied.escalate).toBe(true)
      expect(denied.message).toContain('escalate:user')
    }
  })

  it('allows implementer when projection HG-2 passed and branch matches', async () => {
    const workspace = tempDir('specdev-gate-ok-')
    const status = createInitialStatus('wf-ok', 'ok')
    seedWorkflow(workspace, {
      ...status,
      human_gates: { hg1: 'passed', hg2: 'passed', hg3: 'pending' },
      current_stage: 'phase-implementation',
      current_phase: 'phase-1-p0-core',
      loop_count: 0,
      phases: {
        'phase-1-p0-core': { implementer: 'pending', reviewer: 'pending', verifier: 'pending' },
      },
    })
    const { ctx, session, agent } = await gateHarness(workspace, 'impl-phase-1-p0-core')
    projectHg2(ctx, session, workspace)

    const result = await ctx.specdev.dispatchRole(agent, {
      role: 'implementer',
      slug: 'wf-ok',
      phaseId: 'phase-1-p0-core',
    })
    expect(result.presetId).toBe('specdev-implementer')
    expect(result.agent.options['specdev.role']).toBe('implementer')
  })
})
