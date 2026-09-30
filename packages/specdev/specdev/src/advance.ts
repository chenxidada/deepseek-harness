/**
 * SpecDev pipeline-advance: emit `specdev/advance` when a role child completes.
 *
 * Primary signal: SpecDev role child `agent/status` → `idle` (role dispatch uses
 * `agents.create`, so `subagent/end` may never fire). Secondary: `subagent/end`.
 * Never calls `confirmGate` and never flips Human Gates.
 *
 * @module @deepseek-ai/dsh-specdev/advance
 */

import type { Agent, AgentStatus } from '@deepseek-ai/dsh-agent'
import type { Context } from '@deepseek-ai/cordis'
import type { Session } from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-session-projection'
import type {} from '@deepseek-ai/dsh-subagent'
import { readSpecdevMetadata } from './metadata.ts'
import type { SpecdevAdvanceEvent, SpecdevRole } from './types.ts'

/** Roles that emit advancement guidance when they finish. */
export const ADVANCE_ROLES: ReadonlySet<SpecdevRole> = new Set([
  'requirement-analyst',
  'plan-generator',
  'code-explorer',
  'implementer',
  'reviewer',
  'reviewer-correctness',
  'reviewer-design',
  'reviewer-connectivity',
  'reviewer-visual',
  'verifier',
  'wiki',
])

/**
 * Build Orchestrator-facing nextAction guidance for a completed role.
 * @param role - SpecDev role that just went idle / ended.
 * @returns the guidance text appended as the advance event's `nextAction`.
 */
export function guidanceForRole(role: SpecdevRole): string {
  switch (role) {
    case 'requirement-analyst':
      return [
        '📋 requirement-analyst completed → requirements.md',
        '⏸️ Human Gate 1 — present requirements to the user.',
        'Wait for the IDE gate card decision; the panel calls ctx.specdev.confirmGate({ gate: "hg1", decision: "pass" }).',
        'Do not auto-continue. Do not flip human_gates in JSON by hand.',
      ].join('\n')

    case 'plan-generator':
      return [
        '🏗️ plan-generator completed → design.md + phase-plan.md',
        '⏸️ Human Gate 2 — present the design to the user.',
        'A workflow whose phase plan declares `ui: true` stops at HG-1.5 first: the user picks the candidate style, and the panel calls ctx.specdev.confirmGate({ gate: "hg1_5", decision: "pass", note: <their choice> }).',
        'Wait for the IDE gate card decision; the panel calls ctx.specdev.confirmGate({ gate: "hg2", decision: "pass" }).',
        'Do not auto-continue. Do not flip human_gates in JSON by hand.',
      ].join('\n')

    case 'implementer':
      return [
        '💻 implementer completed → phases/<phase>/implementation.md',
        'A UI phase stops here: present the static prototype to the user, wait for the prototype gate, then dispatch the reviewers.',
        'Next: dispatch reviewer-correctness, reviewer-design, and reviewer-connectivity in parallel,',
        'plus reviewer-visual when the phase declares `ui: true`,',
        'then call ctx.specdev.mergePhaseReviews(session, phaseId) to write review.md.',
        'On MUST-FIX, call ctx.specdev.bumpLoopCount() then re-dispatch implementer (max 2).',
      ].join('\n')

    case 'reviewer-correctness':
      return '🔍 reviewer-correctness completed. Wait for every other report this phase needs (design, connectivity, plus visual in a UI phase), then ctx.specdev.mergePhaseReviews.'

    case 'reviewer-design':
      return '🔍 reviewer-design completed. Check whether every review report this phase needs is ready, then ctx.specdev.mergePhaseReviews.'

    case 'reviewer-connectivity':
      return '🔍 reviewer-connectivity completed. Check whether every review report this phase needs is ready, then ctx.specdev.mergePhaseReviews.'

    case 'reviewer-visual':
      return '🎨 reviewer-visual completed → review-visual.md. Check whether every review report this phase needs is ready, then ctx.specdev.mergePhaseReviews.'

    case 'reviewer':
      return [
        '🔍 reviewer completed → review.md',
        'PASS / SHOULD-FIX → dispatch verifier. MUST-FIX → ctx.specdev.bumpLoopCount() then dispatch implementer.',
      ].join('\n')

    case 'verifier':
      return [
        '✅ verifier completed → verification.md',
        'In a UI phase, verification.md must independently cover visual-baseline.md sections (baseline comparison, breakpoints, states, a11y, copy) — do not repeat review-visual.md verdicts.',
        '⏸️ Human Gate 3 — present verification to the user.',
        'Record the completed phaseId NOW (confirmGate will advance current_phase).',
        'Wait for the IDE gate card decision; the panel calls ctx.specdev.confirmGate({ gate: "hg3", decision: "pass" }).',
        'After the gate decision, call ctx.specdev.completePhaseGit({ phaseId: <recorded>, files }) with an explicit file list.',
        'If this was the final Feature phase (snapshot.phase === null / no remaining dependent phase):',
        '  the runtime auto-dispatches the wiki role (Pipeline) → docs/wiki/.',
        'Do not auto-merge git or flip hg3 in JSON by hand. No Knowledge Base sync.',
      ].join('\n')

    case 'code-explorer':
      return '🔎 code-explorer completed → repo-exploration.md. Next: ensure impl-<phase> branch, then dispatch implementer.'

    case 'wiki':
      return [
        '📚 wiki agent completed. Review docs/wiki/ updates and changelog.',
        'No Knowledge Base / Knownbase sync (AC-55).',
      ].join('\n')

    case 'orchestrator':
      return 'Orchestrator idle — no SpecDev advance action.'

    default:
      return `SpecDev role ${String(role)} completed. Review outputs; do not auto-pass Human Gates.`
  }
}

/**
 * Append `specdev/advance` on the parent (Orchestrator) session.
 *
 * Snapshot payload is **projection-only** (AC-28 / VP-3): never embed the
 * durable status, which would let a forged mirror poison `specdev/status` via
 * the fold. Fail-closed (no confirmed projection) → `snapshot: null`.
 *
 * @param ctx - host context.
 * @param agent - completed SpecDev role child.
 * @returns the appended event, or null when the agent carries no advancing role.
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
 * Install the advance listeners on the root context.
 *
 * Registered on `ctx.root` so the agent-scoped `agentEvents` fan-out reaches
 * this plugin even when Cordis mounts the service inside an inject fork.
 *
 * @param ctx - host context that owns the SpecDev service.
 */
export function installAdvanceListeners(ctx: Context): void {
  /** Last observed status per agent — only emit on running→idle. */
  const lastStatus = new WeakMap<Agent, AgentStatus>()
  /** Dedupe advance emissions per agent completion wave. */
  const emittedIdle = new WeakSet<Agent>()

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
 * Gate-safe snapshot for advance events: the existing `specdev/status`
 * projection only, never durable status.
 *
 * @param ctx - host context.
 * @param session - parent session that owns the projection.
 * @param nextAction - guidance text merged onto the projected view when present.
 * @returns the projected view with `nextAction`, or null without a projection.
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
 * @returns the parent session, or undefined for a root session.
 */
function parentSessionOf(ctx: Context, session: Session): Session | undefined {
  const parentId = session.header.parentSession
  if (parentId === undefined) return undefined
  return ctx.get('sessions')?.get(parentId)
}
