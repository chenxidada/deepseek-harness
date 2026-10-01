/**
 * Gate-decision progression: the runtime owns what follows a final Feature
 * HG-3 pass, so the same decision from the panel, the IDE bridge, or a direct
 * `confirmGate` call reaches the same wiki dispatch — and a dispatch failure
 * is logged rather than lost.
 */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import AgentRegistry, { type Agent, type AgentStatus } from '@deepseek-ai/dsh-agent'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import SpecdevService, {
  createInitialStatus,
  snapshotFromStatus,
  type CurrentStatusJson,
  type SpecdevSnapshot,
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

function stubAgent(session: ReturnType<Context['sessions']['create']>): Agent {
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

/** Snapshot of a workflow whose final phase is already complete. */
function finalSnapshot(slug: string): SpecdevSnapshot {
  const status: CurrentStatusJson = {
    ...createInitialStatus(slug, 'feature'),
    human_gates: { hg1_5: 'passed', hg1: 'passed', hg2: 'passed', hg3: 'passed' },
    current_phase: null,
  }
  return snapshotFromStatus(status, { workflow: false, phases: {} })
}

/** Final-HG-3 decision as `confirmGate` would append it. */
function finalHg3Event(slug: string, phase: string | null) {
  return {
    kind: 'specdev/gate-decided',
    version: 1,
    gate: 'hg3',
    decision: 'pass',
    snapshot: { ...finalSnapshot(slug), phase },
  } as const
}

/** Fixture workflow whose HG-3 can be confirmed for real. */
function writeCompletableWorkflow(workspace: string, slug: string): void {
  const slugDir = join(workspace, '.specdev', 'specs', slug)
  mkdirSync(slugDir, { recursive: true })
  writeFileSync(join(workspace, '.specdev', 'active-workflow'), `${slug}\n`)
  writeFileSync(join(slugDir, 'requirements.md'), '# Requirements\n\nAC-1: demo\n')
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
}

describe('gate progression after a final HG-3 pass', () => {
  it('ignores a decision whose session owns no agent', async () => {
    const workspace = tempDir('specdev-progression-noagent-')
    writeCompletableWorkflow(workspace, 'wf')

    const ctx = new Context()
    await ctx.plugin(SessionStore)
    await ctx.plugin(SessionProjectionRegistry)
    await ctx.plugin(AgentRegistry)
    await ctx.plugin(SpecdevService)

    const session = ctx.sessions.create(SessionId('no-agent'), { meta: { cwd: workspace } })
    session.append('specdev/gate-decided', finalHg3Event('wf', null))
    await Promise.resolve()
    expect(session.snapshotEvents().filter(event => event.type === 'specdev/dispatch')).toHaveLength(0)
  })

  it('logs a failed wiki auto-dispatch instead of failing the gate decision', async () => {
    const workspace = tempDir('specdev-progression-failed-')
    writeCompletableWorkflow(workspace, 'wf')

    const ctx = new Context()
    await ctx.plugin(SessionStore)
    await ctx.plugin(SessionProjectionRegistry)
    await ctx.plugin(AgentRegistry)
    await ctx.plugin(SpecdevService)
    await ctx.specdev.ensureLayout({ slug: 'wf', command: 'feature', workspaceRoot: workspace })

    // A session without a cwd cannot resolve the workspace wiki root, so the
    // auto-dispatch rejects while the gate decision itself still succeeds.
    const session = ctx.sessions.create(SessionId('no-cwd-session'))
    ctx.agents.register(stubAgent(session))
    await ctx.specdev.confirmGate(session, { gate: 'hg1', decision: 'pass' }, { cwd: workspace })
    await ctx.specdev.confirmGate(session, { gate: 'hg2', decision: 'pass' }, { cwd: workspace })

    const warn = vi.spyOn(ctx.logger, 'warn').mockImplementation(() => undefined)
    const result = await ctx.specdev.confirmGate(
      session,
      { gate: 'hg3', decision: 'pass' },
      { cwd: workspace },
    )
    expect(result.ok).toBe(true)
    expect(result.snapshot?.phase).toBeNull()
    await vi.waitFor(() => {
      expect(warn).toHaveBeenCalledWith(expect.stringContaining('wiki auto-dispatch failed'))
    })
  })
})

describe('gate progression logging', () => {
  it('surfaces a non-Error auto-dispatch rejection in the warning', async () => {
    const workspace = tempDir('specdev-progression-string-')
    writeCompletableWorkflow(workspace, 'wf')

    const ctx = new Context()
    await ctx.plugin(SessionStore)
    await ctx.plugin(SessionProjectionRegistry)
    await ctx.plugin(AgentRegistry)
    await ctx.plugin(SpecdevService)
    await ctx.specdev.ensureLayout({ slug: 'wf', command: 'feature', workspaceRoot: workspace })
    ctx.agents.setFactory({
      // oxlint-disable-next-line typescript/prefer-promise-reject-errors -- the warning path must survive a non-Error factory rejection.
      createAgent: () => Promise.reject('wiki factory refused'),
      resume: () => Promise.reject(new Error('resume unused')),
    })

    const session = ctx.sessions.create(SessionId('string-session'), { meta: { cwd: workspace } })
    ctx.agents.register(stubAgent(session))
    await ctx.specdev.confirmGate(session, { gate: 'hg1', decision: 'pass' }, { cwd: workspace })
    await ctx.specdev.confirmGate(session, { gate: 'hg2', decision: 'pass' }, { cwd: workspace })

    const warn = vi.spyOn(ctx.logger, 'warn').mockImplementation(() => undefined)
    await ctx.specdev.confirmGate(session, { gate: 'hg3', decision: 'pass' }, { cwd: workspace })
    await vi.waitFor(() => {
      expect(warn).toHaveBeenCalledWith(expect.stringContaining('wiki factory refused'))
    })
  })
})
