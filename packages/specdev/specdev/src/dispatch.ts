/**
 * Programmatic SpecDev role dispatch: child agent lineage, metadata (AC-24),
 * `specdev/dispatch` emission, and child wake via \`createUserMessage\` +
 * \`agent.followup\` (GAP-002 / AC-23).
 *
 * @module @deepseek-ai/dsh-specdev/dispatch
 */

import { randomUUID } from 'node:crypto'
import { Context } from '@deepseek-ai/cordis'
import { type Agent, type AgentRegistry, type AgentStatus } from '@deepseek-ai/dsh-agent'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { MemoryInbox } from './inbox.ts'
import { SessionId, type SessionStore } from '@deepseek-ai/dsh-session'
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
  /**
   * Task prompt delivered via followup after create (GAP-002).
   * When omitted, a role-default prompt is used. Pass `null` to skip wake.
   */
  readonly prompt?: string | null
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
  /** True when a followup user message was delivered to wake the child. */
  readonly followupSent: boolean
}

/**
 * Map a SpecDev role label to its shipped preset id (`specdev-<role>`).
 * @param role - SpecDev role or preset id.
 */
export function rolePresetId(role: string): string {
  return role.startsWith('specdev-') ? role : `specdev-${role}`
}

/**
 * Default wake prompt for a SpecDev role (GAP-002).
 * @param role - SpecDev role.
 * @param ctx - slug / optional phaseId.
 */
export function defaultRolePrompt(
  role: SpecdevRole,
  ctx: { readonly slug: string; readonly phaseId?: string },
): string {
  const phase = ctx.phaseId === undefined ? '' : ` Current phaseId=\`${ctx.phaseId}\`.`
  switch (role) {
    case 'requirement-analyst':
      return `SpecDev: write requirements.md (EARS ACs) for workflow \`${ctx.slug}\`. Stop for HG-1.`
    case 'plan-generator':
      return `SpecDev: write design.md + phase-plan.md (DAG JSON) for \`${ctx.slug}\`. Stop for HG-2.`
    case 'code-explorer':
      return `SpecDev: write phases/<phase>/repo-exploration.md for \`${ctx.slug}\`.${phase} Read-only.`
    case 'implementer':
      return `SpecDev: implement the current phase for \`${ctx.slug}\` on branch impl-<phase-id>.${phase} Write implementation.md. No git commit.`
    case 'reviewer-correctness':
      return `SpecDev: review correctness for \`${ctx.slug}\`.${phase} Write review-correctness.md.`
    case 'reviewer-design':
      return `SpecDev: review design consistency for \`${ctx.slug}\`.${phase} Write review-design.md.`
    case 'reviewer-connectivity':
      return `SpecDev: review integration connectivity for \`${ctx.slug}\`.${phase} Write review-connectivity.md.`
    case 'reviewer-visual':
      return `SpecDev: review visual consistency against the frozen baseline for \`${ctx.slug}\`.${phase} Write review-visual.md.`
    case 'reviewer':
      return `SpecDev: single-perspective review for \`${ctx.slug}\` (brief).${phase} Write review.md.`
    case 'verifier':
      return `SpecDev: independently verify the phase for \`${ctx.slug}\`.${phase} Write verification.md. A UI phase verifies against visual-baseline.md and review-visual.md too.`
    case 'wiki':
      // Prefer {@link wikiRolePrompt} via dispatchWiki; this fallback is Standalone.
      return [
        `SpecDev wiki (Standalone mode) for workflow \`${ctx.slug}\`.${phase}`,
        'Update workspace `docs/wiki/`. No Knowledge Base / Knownbase sync (AC-55).',
      ].join(' ')
    case 'orchestrator':
      return `SpecDev: orchestrate workflow \`${ctx.slug}\`.${phase}`
    default:
      return `SpecDev role \`${String(role)}\` for workflow \`${ctx.slug}\`.${phase}`
  }
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
 * 5. Wake the child with `createUserMessage` + `agent.followup` (GAP-002) unless `prompt: null`
 *
 * @param ctx - host context (`agents`, optional `agentPresets`, optional `specdev` for snapshot).
 * @param parent - Orchestrator / calling agent.
 * @param request - role / slug / optional phaseId / prompt.
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
    agent = registerLineageFallbackAgent(sessions, agents, parent, childSessionId, cwd, presetId)
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

  let followupSent = false
  if (request.prompt !== null) {
    const text = request.prompt === undefined
      ? defaultRolePrompt(role, {
        slug,
        ...request.phaseId === undefined ? {} : { phaseId: request.phaseId },
      })
      : request.prompt
    if (text.trim().length > 0) {
      const message = createUserMessage({
        content: [{ type: 'text', text }],
        source: { kind: 'user' },
      })
      agent.followup(message)
      followupSent = true
    }
  }

  return {
    childSessionId: String(agent.session.id),
    agent,
    presetId,
    mounted,
    factoryCreated,
    followupSent,
  }
}

/**
 * Register a lightweight child agent with durable parentSession lineage when
 * no agent-loop factory is loaded (command unit tests / minimal hosts).
 */
function registerLineageFallbackAgent(
  sessions: SessionStore,
  agents: AgentRegistry,
  parent: Agent,
  childSessionId: SessionId,
  cwd: string | undefined,
  presetId: string,
): Agent {
  const session = sessions.create(childSessionId, {
    meta: {
      ...cwd === undefined ? {} : { cwd },
      parentSession: parent.session.id,
      origin: 'subagent',
      agentPreset: presetId,
    },
  })
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
  agents.register(agent)
  return agent
}
