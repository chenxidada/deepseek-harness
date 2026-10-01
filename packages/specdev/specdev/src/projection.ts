/**
 * Projection unit for key `specdev/status`: folds SpecDev session events into
 * a schema-validatable whole-status view.
 *
 * @module @deepseek-ai/dsh-specdev/projection
 */

import { z as zod } from 'zod'
import type { ZodType } from 'zod'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import type { ProjectionDefinition } from '@deepseek-ai/dsh-session-projection'
import type {
  SpecdevGateId,
  SpecdevGateState,
  SpecdevSnapshot,
  SpecdevStatusProjectionState,
  SpecdevStepState,
} from './types.ts'

const gateStateSchema = zod.union([zod.literal('pending'), zod.literal('passed')])
const stepStateSchema = zod.union([
  zod.literal('pending'),
  zod.literal('in_progress'),
  zod.literal('completed'),
  zod.literal('failed'),
])
const gateIdSchema = zod.union([
  zod.literal('hg1'),
  zod.literal('hg1_5'),
  zod.literal('hg2'),
  zod.literal('hg3'),
  zod.literal('phase-entry'),
  zod.literal('prototype'),
])

const stepsSchema: ZodType<SpecdevSnapshot['steps']> = zod.record(
  zod.string().min(1),
  zod.object({
    implementer: stepStateSchema,
    reviewer: stepStateSchema,
    verifier: stepStateSchema,
    prototype: gateStateSchema,
  }).strict(),
)

/** Visual chain declarations a snapshot carries (schema v3). */
const uiViewSchema = zod.object({
  workflow: zod.boolean(),
  phases: zod.record(
    zod.string().min(1),
    zod.union([zod.boolean(), zod.literal('unknown')]),
  ),
}).strict()

/** One ordered phase-plan row a snapshot carries (schema v4). */
const planRowSchema = zod.object({
  id: zod.string().min(1),
  dependencies: zod.array(zod.string().min(1)),
  status: zod.union([zod.literal('done'), zod.literal('active'), zod.literal('todo')]),
}).strict()

/** One artifact row a snapshot carries (schema v4). */
const artifactRowSchema = zod.object({
  path: zod.string().min(1),
  label: zod.string().min(1),
  phaseId: zod.string().min(1).nullable(),
  status: zod.union([zod.literal('ready'), zod.literal('missing')]),
}).strict()

/** Wire / fold schema for one SpecDev snapshot. */
export const specdevSnapshotSchema: ZodType<SpecdevSnapshot> = zod.object({
  schemaVersion: zod.number().int().positive(),
  slug: zod.string().min(1),
  stage: zod.string().min(1),
  phase: zod.string().min(1).nullable(),
  gates: zod.object({
    hg1: gateStateSchema,
    hg1_5: gateStateSchema,
    hg2: gateStateSchema,
    hg3: gateStateSchema,
  }).strict(),
  steps: stepsSchema,
  pendingGate: gateIdSchema.nullable(),
  loopCount: zod.number().int().nonnegative(),
  ui: uiViewSchema,
  nextAction: zod.string().min(1).optional(),
  techDebtSummary: zod.object({
    blocking: zod.number().int().nonnegative(),
    total: zod.number().int().nonnegative(),
  }).strict().optional(),
  // Schema v2 additive fields; optional because a workflow may not record them.
  initiatingCommand: zod.string().min(1).optional(),
  pipelineMode: zod.string().min(1).optional(),
  // Schema v4 additive IDE views; optional because a plan may not be readable.
  plan: zod.array(planRowSchema).optional(),
  artifacts: zod.array(artifactRowSchema).optional(),
}).strict() as ZodType<SpecdevSnapshot>

const projectionStateSchema: ZodType<SpecdevStatusProjectionState> = zod.object({
  status: specdevSnapshotSchema.nullable(),
  failure: zod.string().min(1).nullable(),
}).strict()

/** SpecDev event types that carry a whole `snapshot` field. */
const SNAPSHOT_EVENT_TYPES = new Set([
  'specdev/workflow',
  'specdev/gate-pending',
  'specdev/gate-decided',
  'specdev/phase',
  'specdev/dispatch',
  'specdev/review-verdict',
  'specdev/advance',
])

/**
 * Extract the whole post-change snapshot from a SpecDev event, when present.
 *
 * For `specdev/advance`, `snapshot: null` means guidance-only and must **not**
 * clear an existing projection (AC-28): forged file HG must never become
 * authoritative via an advance fold side-effect.
 *
 * @param event - committed session event.
 */
function snapshotFromEvent(event: SessionEvent): SpecdevSnapshot | null | undefined {
  if (!SNAPSHOT_EVENT_TYPES.has(event.type)) return undefined
  const data = event.data as { snapshot?: SpecdevSnapshot | null }
  if (!('snapshot' in data)) return undefined
  if (event.type === 'specdev/advance' && data.snapshot === null) {
    return undefined
  }
  return data.snapshot ?? null
}

/**
 * Fold SpecDev events into the `specdev/status` projection state.
 * Unrelated events return the same state reference.
 * @param state - prior projection state.
 * @param event - next committed session event.
 */
export function applySpecdevProjection(
  state: SpecdevStatusProjectionState,
  event: SessionEvent,
): SpecdevStatusProjectionState {
  if (state.failure !== null) return state
  const next = snapshotFromEvent(event)
  if (next === undefined) return state
  if (next === null) {
    if (state.status === null) return state
    return { status: null, failure: null }
  }
  const parsed = specdevSnapshotSchema.safeParse(next)
  if (!parsed.success) {
    return {
      ...state,
      failure: `specdev/status replay failed at session event ${event.seq}: ${parsed.error.message}`,
    }
  }
  return { status: parsed.data, failure: null }
}

/** Projection definition registered by {@link SpecdevService}. */
export const specdevStatusProjectionDefinition = {
  key: 'specdev/status',
  stateSchema: projectionStateSchema,
  init: (): SpecdevStatusProjectionState => ({ status: null, failure: null }),
  apply: applySpecdevProjection,
  wire: {
    viewSchema: specdevSnapshotSchema.nullable(),
    view: state => state.status,
  },
  stateVersion: 1,
} satisfies ProjectionDefinition<'specdev/status', SpecdevStatusProjectionState>

/** Re-export gate id / state aliases used by tests. */
export type { SpecdevGateId, SpecdevGateState, SpecdevStepState }
