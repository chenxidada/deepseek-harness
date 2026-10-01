/**
 * SpecDev guard: VP-1..VP-4 matrix — fail-closed dispatch / authority / loop /
 * branch — plus the role dispatch matrix and the guard pipeline stages.
 */

import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import AgentRegistry, { agentEvents, type Agent, type AgentStatus } from '@deepseek-ai/dsh-agent'
import { ToolCallId, createUserMessage } from '@deepseek-ai/dsh-llm'
import SessionStore, { SessionId, type Session } from '@deepseek-ai/dsh-session'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import SpecdevService, {
  attachSpecdevMetadata,
  createInitialStatus,
  emitAdvanceForAgent,
  parseCurrentStatus,
  type CurrentStatusJson,
  MemoryInbox,
} from '@deepseek-ai/dsh-specdev'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRegistry, { type ToolDefinition } from '@deepseek-ai/dsh-tools'
import SpecdevGuard, {
  SpecdevGateDeniedError,
  evaluateRoleDispatch,
  isCurrentStatusPath,
  resolveAuthoritativeStatus,
  toolFilePath,
  type AuthoritativeSpecdevStatus,
} from '@deepseek-ai/dsh-specdev-guard'

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

async function gateHarness(
  workspace: string,
  gitBranch: string | null = 'impl-phase-1-p0-core',
  onBranchRead?: (cwd: string) => void,
) {
  const ctx = new Context()
  await ctx.plugin(SessionStore)
  await ctx.plugin(SessionProjectionRegistry)
  await ctx.plugin(AgentRegistry)
  await ctx.plugin(SystemPrompt, {})
  await ctx.plugin(ToolRegistry)
  await ctx.plugin(SpecdevService)
  await ctx.plugin(SpecdevGuard, {
    gitBranchReader: (cwd) => {
      onBranchRead?.(cwd)
      return gitBranch
    },
  })
  ctx.tools.register(writeTool())
  const session = ctx.sessions.create(SessionId(`gate-${Math.random()}`), { meta: { cwd: workspace } })
  const agent = stubAgent(session)
  ctx.agents.register(agent)
  return { ctx, session, agent }
}

/**
 * A composition whose earlier `tools/pre-execute` policy approves every call
 * without consulting the rest of the chain, leaving the monotonic guard as the
 * only stage that can still deny.
 */
async function guardOnlyHarness(workspace: string) {
  const ctx = new Context()
  await ctx.plugin(SessionStore)
  await ctx.plugin(SessionProjectionRegistry)
  await ctx.plugin(AgentRegistry)
  await ctx.plugin(SystemPrompt, {})
  await ctx.plugin(ToolRegistry)
  await ctx.plugin(SpecdevService)
  ctx.on('tools/pre-execute', async () => ({ kind: 'allow' as const }))
  await ctx.plugin(SpecdevGuard, { gitBranchReader: () => null })
  ctx.tools.register(writeTool())
  const session = ctx.sessions.create(SessionId(`guard-only-${Math.random()}`), { meta: { cwd: workspace } })
  const agent = stubAgent(session)
  ctx.agents.register(agent)
  return { ctx, session, agent }
}

/** The text blocks of a tool result, joined for containment checks. */
function textOf(result: { readonly content: readonly { readonly type: string; readonly text?: string }[] }): string {
  return result.content
    .filter(block => block.type === 'text')
    .map(block => block.text ?? '')
    .join('\n')
}

/** Run one tool call of `agent` through the guarded pipeline. */
async function callTool(
  ctx: Context,
  agent: Agent,
  name: string,
  args: Readonly<Record<string, unknown>>,
  callId: string,
) {
  return ctx.tools.execute({
    signal: testToolSignal,
    callId: ToolCallId(callId),
    name,
    arguments: args,
    agent,
  })
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
      human_gates: { hg1_5: 'pending', hg1: 'passed', hg2: 'pending', hg3: 'pending' },
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
      human_gates: { hg1_5: 'pending', hg1: 'passed', hg2: 'passed', hg3: 'pending' },
      current_stage: 'phase-implementation',
      current_phase: 'phase-1-p0-core',
      phases: {
        'phase-1-p0-core': { implementer: 'pending', reviewer: 'pending', verifier: 'pending', prototype: 'pending' },
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
      human_gates: { hg1_5: 'pending', hg1: 'passed', hg2: 'passed', hg3: 'passed' },
      current_stage: 'phase-implementation',
      current_phase: 'phase-1-p0-core',
      phases: {
        'phase-1-p0-core': { implementer: 'pending', reviewer: 'pending', verifier: 'pending', prototype: 'pending' },
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
    await ctx.plugin(SpecdevGuard, { gitBranchReader: () => 'impl-phase-1-p0-core' })

    const parentSession = ctx.sessions.create(SessionId('orch-vp3-adv'), { meta: { cwd: workspace } })
    const parent = stubAgent(parentSession)
    ctx.agents.register(parent)

    const statusPath = join(workspace, '.specdev', 'specs', 'wf-vp3-adv', 'current-status.json')
    const forged: CurrentStatusJson = {
      ...JSON.parse(readFileSync(statusPath, 'utf8')) as CurrentStatusJson,
      human_gates: { hg1_5: 'pending', hg1: 'passed', hg2: 'passed', hg3: 'passed' },
      current_stage: 'phase-implementation',
      current_phase: 'phase-1-p0-core',
      phases: {
        'phase-1-p0-core': { implementer: 'pending', reviewer: 'pending', verifier: 'pending', prototype: 'pending' },
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
    await ctx.plugin(SpecdevGuard, { gitBranchReader: () => 'impl-phase-1-p0-core' })

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
      human_gates: { hg1_5: 'pending', hg1: 'passed', hg2: 'passed', hg3: 'passed' },
      current_stage: 'phase-implementation',
      current_phase: 'phase-1-p0-core',
      phases: {
        'phase-1-p0-core': { implementer: 'pending', reviewer: 'pending', verifier: 'pending', prototype: 'pending' },
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
      human_gates: { hg1_5: 'pending', hg1: 'passed', hg2: 'pending', hg3: 'pending' },
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
      human_gates: { hg1_5: 'pending', hg1: 'passed', hg2: 'passed', hg3: 'pending' },
      current_stage: 'phase-implementation',
      current_phase: 'phase-1-p0-core',
      loop_count: 2,
      phases: {
        'phase-1-p0-core': { implementer: 'pending', reviewer: 'pending', verifier: 'pending', prototype: 'pending' },
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
      human_gates: { hg1_5: 'pending', hg1: 'passed', hg2: 'passed', hg3: 'pending' },
      current_stage: 'phase-implementation',
      current_phase: 'phase-1-p0-core',
      loop_count: 0,
      phases: {
        'phase-1-p0-core': { implementer: 'pending', reviewer: 'pending', verifier: 'pending', prototype: 'pending' },
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

describe('SpecDev visual chain gates', () => {
  /**
   * Seed a workflow whose plan declares one phase, optionally as a UI phase.
   * `phase` names the current phase, which a plan that does not list it leaves
   * without a UI declaration.
   */
  function seedUiWorkflow(
    workspace: string,
    options: { readonly ui?: boolean; readonly prototype?: 'pending' | 'passed'; readonly phase?: string },
  ): void {
    const phase = options.phase ?? 'phase-1-p0-core'
    const status = createInitialStatus('wf-ui', 'ui')
    seedWorkflow(workspace, {
      ...status,
      human_gates: { hg1_5: 'passed', hg1: 'passed', hg2: 'passed', hg3: 'pending' },
      current_stage: 'phase-implementation',
      current_phase: phase,
      phases: {
        [phase]: {
          implementer: 'completed',
          reviewer: 'pending',
          verifier: 'pending',
          prototype: options.prototype ?? 'pending',
        },
      },
    })
    writeFileSync(join(workspace, '.specdev', 'specs', 'wf-ui', 'phase-plan.md'), [
      '# Phase plan',
      '',
      '```json',
      JSON.stringify({
        phases: [{
          id: 'phase-1-p0-core',
          dependencies: [],
          ...options.ui === undefined ? {} : { ui: options.ui },
        }],
      }, null, 2),
      '```',
      '',
    ].join('\n'))
  }

  /** Put the durable snapshot in the session projection, as confirmGate does. */
  function projectSnapshot(ctx: Context, session: Session, workspace: string): void {
    const snapshot = ctx.specdev.snapshot(undefined, { cwd: workspace })
    if (snapshot === null) throw new Error('the seeded workflow projected no snapshot')
    session.append('specdev/gate-decided', {
      kind: 'specdev/gate-decided',
      version: 1,
      gate: 'hg2',
      decision: 'pass',
      snapshot,
    })
  }

  it('denies a reviewer while the UI phase prototype is unconfirmed', async () => {
    const workspace = tempDir('specdev-ui-unconfirmed-')
    seedUiWorkflow(workspace, { ui: true })
    const { ctx, session, agent } = await gateHarness(workspace)
    projectSnapshot(ctx, session, workspace)

    try {
      await ctx.specdev.dispatchRole(agent, { role: 'reviewer-correctness', slug: 'wf-ui' })
      expect.unreachable('expected denial')
    } catch (error: unknown) {
      expect(error).toBeInstanceOf(SpecdevGateDeniedError)
      const denied = error as SpecdevGateDeniedError
      expect(denied.code).toBe('SPECDEV_PROTOTYPE_PENDING')
      expect(denied.message).toContain('prototype is not confirmed')
    }
  })

  it('denies a verifier while the UI phase prototype is unconfirmed', async () => {
    const workspace = tempDir('specdev-ui-verifier-')
    seedUiWorkflow(workspace, { ui: true })
    const { ctx, session, agent } = await gateHarness(workspace)
    projectSnapshot(ctx, session, workspace)

    await expect(
      ctx.specdev.dispatchRole(agent, { role: 'verifier', slug: 'wf-ui' }),
    ).rejects.toMatchObject({ code: 'SPECDEV_PROTOTYPE_PENDING' })
  })

  it('allows the reviewers once the prototype is confirmed', async () => {
    const workspace = tempDir('specdev-ui-confirmed-')
    seedUiWorkflow(workspace, { ui: true, prototype: 'passed' })
    const { ctx, session, agent } = await gateHarness(workspace)
    projectSnapshot(ctx, session, workspace)

    const reviewer = await ctx.specdev.dispatchRole(agent, { role: 'reviewer-correctness', slug: 'wf-ui' })
    const visual = await ctx.specdev.dispatchRole(agent, { role: 'reviewer-visual', slug: 'wf-ui' })

    expect(reviewer.presetId).toBe('specdev-reviewer-correctness')
    expect(visual.presetId).toBe('specdev-reviewer-visual')
  })

  it('denies a reviewer when the plan does not declare ui for the phase', async () => {
    const workspace = tempDir('specdev-ui-unknown-')
    seedUiWorkflow(workspace, {})
    const { ctx, session, agent } = await gateHarness(workspace)
    projectSnapshot(ctx, session, workspace)

    try {
      await ctx.specdev.dispatchRole(agent, { role: 'reviewer-correctness', slug: 'wf-ui' })
      expect.unreachable('expected denial')
    } catch (error: unknown) {
      expect(error).toBeInstanceOf(SpecdevGateDeniedError)
      const denied = error as SpecdevGateDeniedError
      expect(denied.code).toBe('SPECDEV_UI_UNKNOWN')
      expect(denied.message).toContain('does not declare ui')
    }
  })

  it('denies the visual reviewer on a phase that declares ui: false', async () => {
    const workspace = tempDir('specdev-ui-notvisual-')
    seedUiWorkflow(workspace, { ui: false })
    const { ctx, session, agent } = await gateHarness(workspace)
    projectSnapshot(ctx, session, workspace)

    await expect(
      ctx.specdev.dispatchRole(agent, { role: 'reviewer-visual', slug: 'wf-ui' }),
    ).rejects.toMatchObject({ code: 'SPECDEV_UI_NOT_DECLARED' })
  })

  it('leaves a non-UI phase without a prototype requirement', async () => {
    const workspace = tempDir('specdev-ui-plain-')
    seedUiWorkflow(workspace, { ui: false })
    const { ctx, session, agent } = await gateHarness(workspace)
    projectSnapshot(ctx, session, workspace)

    const reviewer = await ctx.specdev.dispatchRole(agent, { role: 'reviewer-design', slug: 'wf-ui' })
    expect(reviewer.presetId).toBe('specdev-reviewer-design')
  })

  it('denies review roles when no projection can answer the UI question', async () => {
    const workspace = tempDir('specdev-ui-noprojection-')
    seedUiWorkflow(workspace, { ui: true, prototype: 'passed' })
    const { ctx, agent } = await gateHarness(workspace)

    await expect(
      ctx.specdev.dispatchRole(agent, { role: 'verifier', slug: 'wf-ui' }),
    ).rejects.toMatchObject({ code: 'SPECDEV_STAGE_MISMATCH' })
  })

  it('fails closed when the phase plan does not declare the current phase', async () => {
    const workspace = tempDir('specdev-ui-undeclaredphase-')
    seedUiWorkflow(workspace, { ui: true, prototype: 'passed', phase: 'phase-2-not-in-plan' })
    const { ctx, session, agent } = await gateHarness(workspace)
    projectSnapshot(ctx, session, workspace)

    try {
      await ctx.specdev.dispatchRole(agent, { role: 'verifier', slug: 'wf-ui' })
      expect.unreachable('expected denial')
    } catch (error: unknown) {
      expect(error).toBeInstanceOf(SpecdevGateDeniedError)
      const denied = error as SpecdevGateDeniedError
      expect(denied.code).toBe('SPECDEV_UI_UNKNOWN')
      expect(denied.message).toContain('does not declare ui')
    }
  })
})

describe('SpecDev role dispatch matrix', () => {
  /** The authoritative status a real projection hands the gates. */
  function authStatus(overrides: Partial<AuthoritativeSpecdevStatus> = {}): AuthoritativeSpecdevStatus {
    return {
      slug: 'wf-matrix',
      stage: 'phase-implementation',
      phase: 'phase-1-p0-core',
      gates: { hg1: 'passed', hg1_5: 'pending', hg2: 'passed', hg3: 'pending' },
      pendingGate: null,
      loopCount: 0,
      authority: 'projection',
      fileHgDiverged: false,
      snapshot: null,
      ...overrides,
    }
  }

  const NO_GATE_PASSED = { hg1: 'pending', hg1_5: 'pending', hg2: 'pending', hg3: 'pending' } as const
  const HG2_PENDING = { hg1: 'passed', hg1_5: 'pending', hg2: 'pending', hg3: 'pending' } as const

  it('holds plan-generator until Human Gate 1 passed', () => {
    expect(evaluateRoleDispatch('plan-generator', authStatus({ gates: NO_GATE_PASSED }), {})?.code)
      .toBe('SPECDEV_HG1_PENDING')
    expect(evaluateRoleDispatch('plan-generator', authStatus(), {})).toBeUndefined()
  })

  it('holds the reviewers and the verifier until Human Gate 2 passed', () => {
    for (const role of [
      'reviewer',
      'reviewer-correctness',
      'reviewer-design',
      'reviewer-connectivity',
      'verifier',
    ] as const) {
      expect(evaluateRoleDispatch(role, authStatus({ gates: HG2_PENDING }), {})?.code)
        .toBe('SPECDEV_HG2_PENDING')
    }
  })

  it('requires a current phase for the reviewers and the verifier', () => {
    for (const role of ['reviewer', 'verifier'] as const) {
      expect(evaluateRoleDispatch(role, authStatus({ phase: null }), {})?.code).toBe('SPECDEV_PHASE_MISSING')
      expect(evaluateRoleDispatch(role, authStatus({ phase: '' }), {})?.code).toBe('SPECDEV_PHASE_MISSING')
      expect(evaluateRoleDispatch(role, authStatus(), {})).toBeUndefined()
    }
  })

  it('holds the implementer on the gates, the phase, and the branch', () => {
    expect(evaluateRoleDispatch('implementer', authStatus({ gates: HG2_PENDING }), { gitBranch: 'impl-phase-1-p0-core' })?.code)
      .toBe('SPECDEV_HG2_PENDING')
    expect(evaluateRoleDispatch('implementer', authStatus({ phase: null }), { gitBranch: 'impl-phase-1-p0-core' })?.code)
      .toBe('SPECDEV_PHASE_MISSING')
    expect(evaluateRoleDispatch('implementer', authStatus(), {})?.code).toBe('SPECDEV_BRANCH_UNKNOWN')
    expect(evaluateRoleDispatch('implementer', authStatus(), { gitBranch: null })?.code).toBe('SPECDEV_BRANCH_UNKNOWN')
    expect(evaluateRoleDispatch('implementer', authStatus(), { gitBranch: '' })?.code).toBe('SPECDEV_BRANCH_UNKNOWN')
    expect(evaluateRoleDispatch('implementer', authStatus(), { gitBranch: 'main' })?.code).toBe('SPECDEV_BRANCH_MISMATCH')
    expect(evaluateRoleDispatch('implementer', authStatus(), { gitBranch: 'impl-phase-1-p0-core' })).toBeUndefined()
  })

  it('takes the first non-empty path argument of a write call', () => {
    expect(toolFilePath({ file_path: 'a.ts' })).toBe('a.ts')
    expect(toolFilePath({ path: 'b.ts' })).toBe('b.ts')
    expect(toolFilePath({ filePath: 'c.ts' })).toBe('c.ts')
    expect(toolFilePath({ file_path: 7, path: '' })).toBeUndefined()
    expect(toolFilePath({})).toBeUndefined()
  })
})

describe('SpecDev gate authority resolution', () => {
  /** The services authority resolution reads: sessions, the projection registry, and SpecDev itself. */
  async function authorityHarness(): Promise<Context> {
    const ctx = new Context()
    await ctx.plugin(SessionStore)
    await ctx.plugin(SessionProjectionRegistry)
    await ctx.plugin(SpecdevService)
    return ctx
  }

  it('resolves the workspace from the session when the caller names none', async () => {
    const workspace = tempDir('specdev-authority-sessioncwd-')
    const ctx = await authorityHarness()
    const session = ctx.sessions.create(SessionId(`authority-${Math.random()}`), { meta: { cwd: workspace } })

    const fromSession = resolveAuthoritativeStatus(ctx, session)
    const explicit = resolveAuthoritativeStatus(ctx, session, { cwd: workspace })

    expect(fromSession).toEqual(explicit)
    expect(fromSession.authority).toBe('fail-closed')
  })

  it('resolves the workspace from the process cwd when nothing names one', async () => {
    const ctx = await authorityHarness()
    const session = ctx.sessions.create(SessionId(`authority-nocwd-${Math.random()}`), {})

    const fromProcess = resolveAuthoritativeStatus(ctx, session)
    const explicit = resolveAuthoritativeStatus(ctx, session, { cwd: process.cwd() })

    expect(fromProcess).toEqual(explicit)
  })

  it('keeps projected authority when the workspace carries no status mirror', async () => {
    const workspace = tempDir('specdev-authority-workspace-')
    const mirrorless = tempDir('specdev-authority-mirrorless-')
    seedWorkflow(workspace, {
      ...createInitialStatus('wf-authority', 'authority'),
      human_gates: { hg1_5: 'pending', hg1: 'passed', hg2: 'passed', hg3: 'pending' },
      current_stage: 'phase-implementation',
      current_phase: 'phase-1-p0-core',
      loop_count: 1,
      phases: {
        'phase-1-p0-core': { implementer: 'pending', reviewer: 'pending', verifier: 'pending', prototype: 'pending' },
      },
    })
    const ctx = await authorityHarness()
    const session = ctx.sessions.create(SessionId(`authority-mirror-${Math.random()}`), { meta: { cwd: workspace } })
    projectHg2(ctx, session, workspace)

    const auth = resolveAuthoritativeStatus(ctx, session, { cwd: mirrorless })

    expect(auth.authority).toBe('projection')
    expect(auth.snapshot?.slug).toBe('wf-authority')
    expect(auth.loopCount).toBe(1)
    expect(auth.fileHgDiverged).toBe(false)
  })
})

describe('SpecDev guard pipeline stages', () => {
  /** Wake one agent through the `agent/pre-step` waterfall. */
  function preStep(ctx: Context, agent: Agent) {
    const message = createUserMessage({
      content: [{ type: 'text', text: 'pre-step probe' }],
      source: { kind: 'user' },
    })
    return agentEvents(ctx, agent).waterfall(
      'agent/pre-step',
      { messages: [message], turn: 1, step: 1, signal: testToolSignal },
      () => Promise.resolve({ kind: 'enter' as const, messages: [message] }),
    )
  }

  it('lets a step through when the waking agent holds no SpecDev role', async () => {
    const { ctx, agent } = await gateHarness(tempDir('specdev-pipeline-norole-'))

    expect((await preStep(ctx, agent)).kind).toBe('enter')
  })

  it('denies a gated role agent its tool call through tools/pre-execute', async () => {
    const workspace = tempDir('specdev-pipeline-roletool-')
    const { ctx, agent } = await gateHarness(workspace)
    attachSpecdevMetadata(agent, { role: 'verifier', slug: 'wf-pipeline' })

    const result = await callTool(
      ctx,
      agent,
      'write',
      { file_path: join(workspace, 'src/a.ts'), content: 'x' },
      'pipeline-roletool',
    )

    expect(result.isError).toBe(true)
    expect(textOf(result)).toContain('[code=SPECDEV_STAGE_MISMATCH]')
  })

  it('falls back to the process cwd when the dispatching session names no workspace', async () => {
    const readCwds: string[] = []
    const { ctx } = await gateHarness(
      tempDir('specdev-pipeline-dispatchcwd-'),
      'impl-phase-1-p0-core',
      cwd => readCwds.push(cwd),
    )
    const session = ctx.sessions.create(SessionId('pipeline-dispatchcwd'), {})
    const agent = stubAgent(session)
    ctx.agents.register(agent)

    await expect(
      ctx.specdev.dispatchRole(agent, { role: 'implementer', slug: 'wf-pipeline' }),
    ).rejects.toBeInstanceOf(SpecdevGateDeniedError)

    expect(readCwds).toEqual([process.cwd()])
  })

  it('evaluates a role child against the tree root workspace when the child names none', async () => {
    const workspace = tempDir('specdev-pipeline-parentcwd-')
    const readCwds: string[] = []
    const { ctx } = await gateHarness(workspace, 'impl-phase-1-p0-core', cwd => readCwds.push(cwd))
    const parentSession = ctx.sessions.create(SessionId('pipeline-parentcwd-root'), { meta: { cwd: workspace } })
    ctx.agents.register(stubAgent(parentSession))
    const childSession = ctx.sessions.create(SessionId('pipeline-parentcwd-child'), {
      meta: { parentSession: parentSession.id, origin: 'subagent' },
    })
    const child = stubAgent(childSession)
    attachSpecdevMetadata(child, { role: 'implementer', slug: 'wf-pipeline', phaseId: 'phase-1-p0-core' })
    ctx.agents.register(child)

    const decision = await preStep(ctx, child)

    expect(decision.kind).toBe('reject')
    expect(readCwds).toEqual([workspace])
  })

  it('evaluates a role session with no workspace anywhere against the process cwd', async () => {
    const readCwds: string[] = []
    const { ctx } = await gateHarness(
      tempDir('specdev-pipeline-nowhere-'),
      'impl-phase-1-p0-core',
      cwd => readCwds.push(cwd),
    )
    const session = ctx.sessions.create(SessionId('pipeline-nowhere'), {})
    const agent = stubAgent(session)
    attachSpecdevMetadata(agent, { role: 'implementer', slug: 'wf-pipeline', phaseId: 'phase-1-p0-core' })
    ctx.agents.register(agent)

    const decision = await preStep(ctx, agent)

    expect(decision.kind).toBe('reject')
    expect(readCwds).toEqual([process.cwd()])
  })

  it('guards the durable status file even when an earlier policy allows the call', async () => {
    const workspace = tempDir('specdev-pipeline-statusfile-')
    const { ctx, agent } = await guardOnlyHarness(workspace)

    const result = await callTool(
      ctx,
      agent,
      'write',
      { file_path: join(workspace, 'current-status.json'), content: '{}' },
      'pipeline-statusfile',
    )

    expect(result.isError).toBe(true)
    expect(textOf(result)).toContain('confirmGate')
  })

  it('guards a gated role agent even when an earlier policy allows the call', async () => {
    const workspace = tempDir('specdev-pipeline-rolebackstop-')
    const { ctx, agent } = await guardOnlyHarness(workspace)
    attachSpecdevMetadata(agent, { role: 'implementer', slug: 'wf-pipeline', phaseId: 'phase-1-p0-core' })

    const result = await callTool(
      ctx,
      agent,
      'write',
      { file_path: join(workspace, 'src/a.ts'), content: 'x' },
      'pipeline-rolebackstop',
    )

    expect(result.isError).toBe(true)
    expect(textOf(result)).toContain('[code=SPECDEV_STAGE_MISMATCH]')
  })
})
