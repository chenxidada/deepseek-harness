/**
 * SpecDev pipeline-advance plugin: emit `specdev/advance` on role completion.
 *
 * Primary signal: SpecDev role child `agent/status` → `idle` (Phase 2 dispatch
 * uses `agents.create`, so `subagent/end` may never fire). Secondary: `subagent/end`.
 * Never calls `confirmGate` / never flips Human Gates.
 *
 * @module @deepseek-ai/dsh-specdev-advance
 */

import type { Context } from '@deepseek-ai/cordis'
import type { Agent, AgentStatus } from '@deepseek-ai/dsh-agent'
import type { Session } from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-session-projection'
import {
  readSpecdevMetadata,
  type SpecdevAdvanceEvent,
  type SpecdevRole,
} from '@deepseek-ai/dsh-specdev'
import type {} from '@deepseek-ai/dsh-specdev'
import type {} from '@deepseek-ai/dsh-subagent'
import { guidanceForRole } from './guidance.ts'

export const name = 'specdev-advance'
export const inject = ['specdev', 'agents']

export { guidanceForRole } from './guidance.ts'

/** Roles that emit advancement guidance when they finish. */
const ADVANCE_ROLES: ReadonlySet<SpecdevRole> = new Set([
  'requirement-analyst',
  'plan-generator',
  'code-explorer',
  'implementer',
  'reviewer',
  'reviewer-correctness',
  'reviewer-design',
  'reviewer-connectivity',
  'verifier',
  'wiki',
])

/**
 * Install advance listeners.
 * @param ctx - host context.
 */
export function apply(ctx: Context): void {
  /** Last observed status per agent — only emit on running→idle. */
  const lastStatus = new WeakMap<Agent, AgentStatus>()
  /** Dedupe advance emissions per agent completion wave. */
  const emittedIdle = new WeakSet<Agent>()

  // Register on root so agent-scoped `agentEvents` fan-out reaches this plugin
  // even when Cordis mounts us in an inject fork (same pattern as sdk-server).
  const host = ctx.root

  host.on('agent/status', ({ agent, status }) => {
    const previous = lastStatus.get(agent)
    lastStatus.set(agent, status)
    if (status !== 'idle') {
      emittedIdle.delete(agent)
      return
    }
    // Initial idle (never ran) or duplicate idle — skip.
    if (previous !== 'running') return
    if (emittedIdle.has(agent)) return
    emittedIdle.add(agent)
    emitAdvanceForAgent(ctx, agent)
  })

  host.on('subagent/end', (info) => {
    const child = ctx.get('agents')?.get(info.id)
    if (child === undefined) return
    // Prefer agent/status path; subagent/end is a fallback when status was missed.
    if (emittedIdle.has(child)) return
    emittedIdle.add(child)
    emitAdvanceForAgent(ctx, child)
  })
}

/**
 * Append `specdev/advance` on the parent (Orchestrator) session.
 *
 * Snapshot payload is **projection-only** (AC-28 / VP-3): never embed
 * `ctx.specdev.snapshot()` file-preferring gates, which would let a forged
 * `current-status.json` poison `specdev/status` via fold. Fail-closed
 * (no confirmed projection) → `snapshot: null`.
 *
 * @param ctx - host context.
 * @param agent - completed SpecDev role child.
 */
export function emitAdvanceForAgent(ctx: Context, agent: Agent): SpecdevAdvanceEvent | null {
  const meta = readSpecdevMetadata(agent)
  if (meta.role === undefined || !ADVANCE_ROLES.has(meta.role)) return null

  const target = parentSessionOf(ctx, agent.session) ?? agent.session
  const nextAction = guidanceForRole(meta.role)
  const snapshot = projectionSnapshotForAdvance(ctx, target, nextAction)
  const event: SpecdevAdvanceEvent = {
    kind: 'specdev/advance',
    version: 1,
    nextAction,
    snapshot,
  }
  target.append('specdev/advance', event)
  return event
}

/**
 * Gate-safe snapshot for advance events: existing `specdev/status` projection
 * only. Never reads durable file Human Gates into a foldable payload.
 *
 * @param ctx - host context.
 * @param session - parent session that owns the projection.
 * @param nextAction - guidance text merged onto the projected view when present.
 */
function projectionSnapshotForAdvance(
  ctx: Context,
  session: Session,
  nextAction: string,
): SpecdevAdvanceEvent['snapshot'] {
  const projected = ctx.get('sessionProjections')?.stateOf(session, 'specdev/status')
  if (projected === undefined || projected.failure !== null || projected.status === null) {
    return null
  }
  return { ...projected.status, nextAction }
}

/**
 * Resolve the parent Orchestrator session for advance emission.
 * @param ctx - host context.
 * @param session - child session.
 */
function parentSessionOf(ctx: Context, session: Session): Session | undefined {
  const parentId = session.header.parentSession
  if (parentId === undefined) return undefined
  return ctx.get('sessions')?.get(parentId)
}

export default { name, inject, apply }
