/**
 * Programmatic SpecDev role dispatch: child agent lineage, metadata (AC-24),
 * and `specdev/dispatch` emission. Used by command-specdev (`/feature`, `/plan`)
 * and available as a host helper for Orchestrator tooling.
 *
 * @module @deepseek-ai/dsh-specdev/dispatch
 */

import { randomUUID } from 'node:crypto'
import { Context } from '@deepseek-ai/cordis'
import { Inbox, type Agent, type AgentStatus } from '@deepseek-ai/dsh-agent'
import { SessionId } from '@deepseek-ai/dsh-session'
import { attachSpecdevMetadata, parseSpecdevRole } from './metadata.ts'
import type {
  SpecdevDispatchEvent,
  SpecdevRole,
  SpecdevSnapshot,
} from './types.ts'

/** Optional agent-presets surface (soft dependency — may be absent). */
interface AgentPresetsLike {
  readonly defaultId?: string
  mount(agentCtx: Context, id?: string): Promise<unknown>
}

/** Request to spawn / register a SpecDev role child under a parent agent. */
export interface DispatchSpecdevRoleRequest {
  readonly role: SpecdevRole
  readonly slug: string
  readonly phaseId?: string
  /** Optional stable child session id (tests). */
  readonly childSessionId?: string
}

/** Result of a SpecDev role dispatch. */
export interface DispatchSpecdevRoleResult {
  readonly childSessionId: string
  readonly agent: Agent
  readonly presetId: string
  /** True when `agentPresets.mount` ran during `agents.create` setup. */
  readonly mounted: boolean
  /** True when the child was created via the agent factory (vs register fallback). */
  readonly factoryCreated: boolean
}

/**
 * Map a SpecDev role label to its shipped preset id (`specdev-<role>`).
 * @param role - SpecDev role or preset id.
 */
export function rolePresetId(role: string): string {
  return role.startsWith('specdev-') ? role : `specdev-${role}`
}

/**
 * Attach orchestrator metadata onto the main-session agent (AC-22 / AC-24).
 * @param agent - Orchestrator (or main) agent.
 * @param slug - active workflow slug (or provisional sdk slug).
 */
export function attachOrchestratorMetadata(agent: Agent, slug: string): Agent {
  return attachSpecdevMetadata(agent, { role: 'orchestrator', slug })
}

/**
 * Emit a whole-view `specdev/dispatch` event on the parent session.
 * @param parent - parent (Orchestrator) agent whose session receives the event.
 * @param payload - dispatch fields without kind/version.
 */
export function emitSpecdevDispatch(
  parent: Agent,
  payload: {
    readonly role: SpecdevRole
    readonly slug: string
    readonly phaseId?: string
    readonly childSessionId: string
    readonly snapshot: SpecdevSnapshot | null
  },
): SpecdevDispatchEvent {
  const event: SpecdevDispatchEvent = {
    kind: 'specdev/dispatch',
    version: 1,
    role: payload.role,
    slug: payload.slug,
    childSessionId: payload.childSessionId,
    snapshot: payload.snapshot,
    ...payload.phaseId === undefined ? {} : { phaseId: payload.phaseId },
  }
  parent.session.append('specdev/dispatch', event)
  return event
}

/**
 * Dispatch a SpecDev role child under `parent`:
 * 1. Prefer `ctx.agents.create` with `parentSession` + optional preset mount
 * 2. Fallback: create a lineage session + register a lightweight agent (hosts/tests without agent-loop)
 * 3. `attachSpecdevMetadata` on the child
 * 4. Emit `specdev/dispatch` on the parent session
 *
 * @param ctx - host context (`agents`, optional `agentPresets`, optional `specdev` for snapshot).
 * @param parent - Orchestrator / calling agent.
 * @param request - role / slug / optional phaseId.
 */
export async function dispatchSpecdevRole(
  ctx: Context,
  parent: Agent,
  request: DispatchSpecdevRoleRequest,
): Promise<DispatchSpecdevRoleResult> {
  const role = parseSpecdevRole(request.role)
  if (typeof request.slug !== 'string' || request.slug.trim().length === 0) {
    throw new TypeError('dispatchSpecdevRole requires a non-empty slug')
  }
  const slug = request.slug.trim()
  const presetId = rolePresetId(role)
  const childSessionId = SessionId(
    request.childSessionId?.trim() || `specdev-${role}-${randomUUID()}`,
  )
  const cwd = parent.session.header.cwd
  const presets = ctx.get('agentPresets') as AgentPresetsLike | undefined
  const agents = ctx.get('agents')
  const sessions = ctx.get('sessions')
  if (agents === undefined) {
    throw new Error('dispatchSpecdevRole requires ctx.agents (load @deepseek-ai/dsh-agent)')
  }
  if (sessions === undefined) {
    throw new Error('dispatchSpecdevRole requires ctx.sessions (load @deepseek-ai/dsh-session)')
  }

  let mounted = false
  let factoryCreated = false
  let agent: Agent

  const setup = presets === undefined
    ? undefined
    : async (agentCtx: Context): Promise<void> => {
      await presets.mount(agentCtx, presetId)
      mounted = true
    }

  try {
    const handle = await agents.create({
      sessionId: childSessionId,
      meta: {
        ...cwd === undefined ? {} : { cwd },
        parentSession: parent.session.id,
        origin: 'subagent',
        agentPreset: presetId,
      },
      agentOptions: {
        ...typeof parent.options.provider === 'string' ? { provider: parent.options.provider } : {},
        ...typeof parent.options.model === 'string' ? { model: parent.options.model } : {},
      },
      ...setup === undefined ? {} : { setup },
    })
    agent = handle.agent
    factoryCreated = true
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error)
    if (!message.includes('no agent factory')) throw error
    agent = registerLineageFallbackAgent(ctx, parent, childSessionId, cwd, presetId)
    factoryCreated = false
    mounted = false
  }

  attachSpecdevMetadata(agent, {
    role,
    slug,
    ...request.phaseId === undefined ? {} : { phaseId: request.phaseId },
  })

  const snapshot = ctx.get('specdev')?.snapshot(parent.session, {
    ...cwd === undefined ? {} : { cwd },
  }) ?? null

  emitSpecdevDispatch(parent, {
    role,
    slug,
    childSessionId: String(agent.session.id),
    snapshot,
    ...request.phaseId === undefined ? {} : { phaseId: request.phaseId },
  })

  return {
    childSessionId: String(agent.session.id),
    agent,
    presetId,
    mounted,
    factoryCreated,
  }
}

/**
 * Register a lightweight child agent with durable parentSession lineage when
 * no agent-loop factory is loaded (command unit tests / minimal hosts).
 */
function registerLineageFallbackAgent(
  ctx: Context,
  parent: Agent,
  childSessionId: SessionId,
  cwd: string | undefined,
  presetId: string,
): Agent {
  const sessions = ctx.get('sessions')
  const agents = ctx.get('agents')
  if (sessions === undefined || agents === undefined) {
    throw new Error('dispatchSpecdevRole fallback requires ctx.sessions and ctx.agents')
  }
  const session = sessions.create(childSessionId, {
    meta: {
      ...cwd === undefined ? {} : { cwd },
      parentSession: parent.session.id,
      origin: 'subagent',
      agentPreset: presetId,
    },
  })
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
  agents.register(agent)
  return agent
}
