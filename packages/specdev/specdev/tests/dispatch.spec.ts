/**
 * Programmatic SpecDev role dispatch: preset-id and prompt vocabulary, the
 * validation each request must pass, the agent-factory path with preset mount,
 * the no-factory lineage fallback (and the agent it hardens), and the
 * `specdev/dispatch` event the parent session records.
 */

import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import AgentRegistry, {
  type Agent,
  type AgentFactory,
  type AgentHandle,
  type AgentStatus,
} from '@deepseek-ai/dsh-agent'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import SessionStore, { SESSION_FORMAT_VERSION, Session, SessionId } from '@deepseek-ai/dsh-session'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import SpecdevService, {
  attachOrchestratorMetadata,
  defaultRolePrompt,
  dispatchSpecdevRole,
  readSpecdevMetadata,
  rolePresetId,
  SPECDEV_ROLES,
  type SpecdevRole,
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

function stubAgent(session: Session, ctx = new Context()): Agent {
  const inbox = new MemoryInbox()
  let status: AgentStatus = 'idle'
  return {
    id: session.id,
    options: {},
    session,
    inbox,
    ctx,
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

/** Detached session for compositions that load no session store. */
function detachedSession(id: string, cwd?: string): Session {
  return Session.create(SessionId(id), undefined, {
    version: SESSION_FORMAT_VERSION,
    id: SessionId(id),
    createdAt: 0,
    isSeeded: false,
    ...cwd === undefined ? {} : { cwd },
  })
}

/** Composition with sessions, agents, and the SpecDev service over one parent. */
async function harness(prefix: string, cwd?: string) {
  const ctx = new Context()
  await ctx.plugin(SessionStore)
  await ctx.plugin(AgentRegistry)
  await ctx.plugin(SessionProjectionRegistry)
  await ctx.plugin(SpecdevService)
  const dir = cwd ?? tempDir(prefix)
  const session = ctx.sessions.create(SessionId(`dispatch-${Math.random()}`), { meta: { cwd: dir } })
  const parent = stubAgent(session)
  ctx.agents.register(parent)
  return { ctx, parent, session, cwd: dir }
}

function promptMessage(text: string) {
  return createUserMessage({ content: [{ type: 'text', text }], source: { kind: 'user' } })
}

describe('role labels and prompts', () => {
  it('maps a role onto its preset id, keeping an already-prefixed id', () => {
    expect(rolePresetId('implementer')).toBe('specdev-implementer')
    expect(rolePresetId('specdev-wiki')).toBe('specdev-wiki')
  })

  it('describes the wake prompt of every role, with and without a phase', () => {
    // The pre-phase roles stop at a Human Gate before any phase exists.
    const phaseAware = new Set<SpecdevRole>([
      'code-explorer',
      'implementer',
      'reviewer-correctness',
      'reviewer-design',
      'reviewer-connectivity',
      'reviewer-visual',
      'reviewer',
      'verifier',
      'wiki',
      'orchestrator',
    ])
    for (const role of SPECDEV_ROLES) {
      expect(defaultRolePrompt(role, { slug: 'wf' })).toContain('wf')
      const phased = defaultRolePrompt(role, { slug: 'wf', phaseId: 'p1' })
      if (phaseAware.has(role)) expect(phased).toContain('Current phaseId=`p1`')
      else expect(phased).not.toContain('Current phaseId')
    }
    expect(defaultRolePrompt('not-a-role' as SpecdevRole, { slug: 'wf' })).toContain('SpecDev role `not-a-role`')
  })

  it('tags an orchestrator agent without a phase', () => {
    const agent = stubAgent(detachedSession('solo-agent'))
    expect(attachOrchestratorMetadata(agent, 'wf')).toBe(agent)
    expect(readSpecdevMetadata(agent)).toEqual({ role: 'orchestrator', slug: 'wf' })
  })
})

describe('dispatchSpecdevRole request validation', () => {
  it('refuses an unknown role and an empty slug', async () => {
    const { ctx, parent } = await harness('specdev-dispatch-invalid-')
    await expect(ctx.specdev.dispatchRole(parent, { role: 'nope' as SpecdevRole, slug: 'wf' }))
      .rejects.toThrow(/specdev.role must be one of/)
    await expect(ctx.specdev.dispatchRole(parent, { role: 'implementer', slug: '   ' }))
      .rejects.toThrow(/requires a non-empty slug/)
  })

  it('refuses a context without the agent registry', async () => {
    const ctx = new Context()
    const parent = stubAgent(detachedSession('solo-agents'), ctx)
    await expect(dispatchSpecdevRole(ctx, parent, { role: 'implementer', slug: 'wf' }))
      .rejects.toThrow(/requires ctx\.agents/)
  })

  it('refuses a context without the session store', async () => {
    const ctx = new Context()
    await ctx.plugin(AgentRegistry)
    const parent = stubAgent(detachedSession('solo-sessions'), ctx)
    await expect(dispatchSpecdevRole(ctx, parent, { role: 'implementer', slug: 'wf' }))
      .rejects.toThrow(/requires ctx\.sessions/)
  })

  it('rethrows a factory failure that is not a missing factory', async () => {
    const ctx = new Context()
    await ctx.plugin(SessionStore)
    await ctx.plugin(AgentRegistry)
    const session = ctx.sessions.create(SessionId('boom-parent'), { meta: { cwd: tempDir('specdev-dispatch-boom-') } })
    const parent = stubAgent(session)
    ctx.agents.register(parent)
    // A factory may reject with any value; only the missing-factory message is
    // a fallback signal, and the detail must survive a non-Error rejection.
    ctx.agents.setFactory({
      // oxlint-disable-next-line typescript/prefer-promise-reject-errors -- the rethrow path must survive a non-Error factory rejection.
      createAgent: () => Promise.reject('factory exploded'),
      resume: () => Promise.reject(new Error('resume unused')),
    })
    await expect(dispatchSpecdevRole(ctx, parent, { role: 'implementer', slug: 'wf' }))
      .rejects.toBe('factory exploded')
  })
})

describe('dispatchSpecdevRole over the agent factory', () => {
  /** Composition whose factory records the created agent's options. */
  async function factoryHarness(prefix: string) {
    const ctx = new Context()
    await ctx.plugin(SessionStore)
    await ctx.plugin(AgentRegistry)
    const session = ctx.sessions.create(SessionId(`dispatch-factory-${Math.random()}`), {
      meta: { cwd: tempDir(prefix) },
    })
    const parent = stubAgent(session)
    ctx.agents.register(parent)

    const seen: { agentOptions: unknown } = { agentOptions: undefined }
    const factory: AgentFactory = {
      async createAgent(ownerCtx, options): Promise<AgentHandle> {
        seen.agentOptions = options.agentOptions
        const child = ctx.sessions.create(
          options.sessionId,
          options.meta === undefined ? {} : { meta: options.meta },
        )
        const agent = stubAgent(child, ownerCtx)
        await options.setup?.(ctx.extend({ agent }), agent)
        const unregister = ctx.agents.register(agent)
        return { agent, dispose: () => unregister() }
      },
      resume() { return Promise.reject(new Error('resume unused')) },
    }
    ctx.agents.setFactory(factory)
    return { ctx, parent, seen }
  }

  it('creates through the factory, mounts the preset, and forwards provider/model', async () => {
    const { ctx, parent, seen } = await factoryHarness('specdev-dispatch-factory-')
    const mount = vi.fn(async () => {})
    ctx.provide('agentPresets', { mount } as never)
    parent.options.provider = 'deepseek'
    parent.options.model = 'deepseek-chat'

    const result = await dispatchSpecdevRole(ctx, parent, {
      role: 'implementer',
      slug: 'wf',
      phaseId: 'p1',
      prompt: 'implement it',
    })
    expect(result.factoryCreated).toBe(true)
    expect(result.mounted).toBe(true)
    expect(result.followupSent).toBe(true)
    expect(result.presetId).toBe('specdev-implementer')
    expect(mount).toHaveBeenCalledWith(expect.anything(), 'specdev-implementer')
    expect(seen.agentOptions).toEqual({ provider: 'deepseek', model: 'deepseek-chat' })
    expect(readSpecdevMetadata(result.agent)).toEqual({ role: 'implementer', slug: 'wf', phaseId: 'p1' })
    expect(result.agent.session.header.parentSession).toBe(parent.session.id)
    expect(result.agent.session.header.cwd).toBe(parent.session.header.cwd)

    const events = parent.session.snapshotEvents().filter(event => event.type === 'specdev/dispatch')
    expect(events).toHaveLength(1)
    expect(events[0]?.data).toMatchObject({
      kind: 'specdev/dispatch',
      role: 'implementer',
      slug: 'wf',
      phaseId: 'p1',
      childSessionId: result.childSessionId,
      snapshot: null,
    })
  })

  it('skips the followup wake for a null or blank prompt', async () => {
    const { ctx, parent } = await factoryHarness('specdev-dispatch-noprompt-')
    const silent = await dispatchSpecdevRole(ctx, parent, { role: 'verifier', slug: 'wf', prompt: null })
    expect(silent.followupSent).toBe(false)

    const blank = await dispatchSpecdevRole(ctx, parent, { role: 'verifier', slug: 'wf', prompt: '   ' })
    expect(blank.followupSent).toBe(false)
  })
})

describe('dispatchSpecdevRole without an agent factory', () => {
  it('registers a lineage fallback agent and wakes it with the role prompt', async () => {
    const { ctx, parent } = await harness('specdev-dispatch-fallback-')
    const result = await ctx.specdev.dispatchRole(parent, {
      role: 'code-explorer',
      slug: 'wf',
      phaseId: 'p1',
      childSessionId: 'specdev-child-fixed',
    })
    expect(result.factoryCreated).toBe(false)
    expect(result.mounted).toBe(false)
    expect(result.followupSent).toBe(true)
    expect(result.childSessionId).toBe('specdev-child-fixed')
    expect(result.agent.session.header.parentSession).toBe(parent.session.id)
    expect(result.agent.session.header.origin).toBe('subagent')
    expect(result.agent.session.header.agentPreset).toBe('specdev-code-explorer')
    expect(ctx.agents.get(SessionId('specdev-child-fixed'))).toBe(result.agent)
  })

  it('honours the fallback agent lifecycle surface', async () => {
    const { ctx, parent } = await harness('specdev-dispatch-fallback-agent-')
    const result = await ctx.specdev.dispatchRole(parent, { role: 'wiki', slug: 'wf', prompt: null })
    const child = result.agent
    expect(child.status).toBe('idle')

    child.send(promptMessage('ignored'), 'next-step', false)
    child.followup(promptMessage('ignored'))
    child.steer(promptMessage('ignored'))
    await expect(child.runMaintenance(signal => Promise.resolve(signal.aborted))).resolves.toBe(false)
    await expect(child.whenIdle()).resolves.toBeUndefined()

    // Driving the inbox reaches the notifications this agent registers.
    child.inject(promptMessage('queued'))
    expect(child.inbox.nextStep).toHaveLength(1)
    const pending = promptMessage('to replace')
    child.inject(pending)
    expect(child.inbox.replace(pending.id, promptMessage('replacement'))).toBe(true)
    child.cancel({ kind: 'user' })
    expect(child.status).toBe('idle')
  })

  it('carries the parent lineage without a cwd when the parent session has none', async () => {
    const ctx = new Context()
    await ctx.plugin(SessionStore)
    await ctx.plugin(AgentRegistry)
    const session = ctx.sessions.create(SessionId(`dispatch-nocwd-${Math.random()}`))
    const parent = stubAgent(session)
    ctx.agents.register(parent)

    const result = await dispatchSpecdevRole(ctx, parent, { role: 'verifier', slug: 'wf', prompt: null })
    expect(result.agent.session.header.cwd).toBeUndefined()
    expect(result.agent.session.header.parentSession).toBe(parent.session.id)
  })
})
