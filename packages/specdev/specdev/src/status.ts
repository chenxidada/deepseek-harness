/**
 * Durable `current-status.json` read / write helpers for SpecDev.
 *
 * @module @deepseek-ai/dsh-specdev/status
 */

import { mkdirSync, readFileSync } from 'node:fs'
import { writeFileAtomic } from '@deepseek-ai/dsh-atomic-write'
import {
  SPECDEV_SCHEMA_VERSION,
  type CurrentStatusJson,
  type SpecdevGateId,
  type SpecdevGateState,
  type SpecdevPhaseSteps,
  type SpecdevSnapshot,
  type SpecdevStatePatch,
  type SpecdevStepState,
  type SpecdevUiView,
} from './types.ts'

const STEP_STATES: ReadonlySet<string> = new Set(['pending', 'in_progress', 'completed', 'failed'])
const GATE_STATES: ReadonlySet<string> = new Set(['pending', 'passed'])

/** SpecDev domain error with a stable machine code. */
export class SpecdevError extends Error {
  readonly code: string

  constructor(message: string, code: string) {
    super(message)
    this.name = 'SpecdevError'
    this.code = code
  }
}

/** Narrow an unknown value to a non-null object record. */
function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined
  return value as Record<string, unknown>
}

/** Validate one durable step triple plus its prototype state. */
function parseStep(value: unknown, label: string): {
  implementer: SpecdevStepState
  reviewer: SpecdevStepState
  verifier: SpecdevStepState
  prototype: SpecdevGateState
} {
  const record = asRecord(value)
  if (record === undefined) {
    throw new SpecdevError(`current-status phases.${label} must be an object`, 'SPECDEV_STATUS_INVALID')
  }
  for (const key of ['implementer', 'reviewer', 'verifier'] as const) {
    const state = record[key]
    if (typeof state !== 'string' || !STEP_STATES.has(state)) {
      throw new SpecdevError(
        `current-status phases.${label}.${key} must be a step state`,
        'SPECDEV_STATUS_INVALID',
      )
    }
  }
  const prototype = record.prototype
  if (prototype !== undefined && (typeof prototype !== 'string' || !GATE_STATES.has(prototype))) {
    throw new SpecdevError(
      `current-status phases.${label}.prototype must be pending|passed`,
      'SPECDEV_STATUS_INVALID',
    )
  }
  return {
    implementer: record.implementer as SpecdevStepState,
    reviewer: record.reviewer as SpecdevStepState,
    verifier: record.verifier as SpecdevStepState,
    // A phase written before the visual chain has no prototype state: nobody
    // confirmed one, so it is pending.
    prototype: (prototype as SpecdevGateState | undefined) ?? 'pending',
  }
}

/**
 * Parse and validate durable `current-status.json` content.
 * @param raw - JSON-parsed unknown value.
 */
export function parseCurrentStatus(raw: unknown): CurrentStatusJson {
  const record = asRecord(raw)
  if (record === undefined) {
    throw new SpecdevError('current-status.json must be a JSON object', 'SPECDEV_STATUS_INVALID')
  }
  if (typeof record.slug !== 'string' || record.slug.trim().length === 0) {
    throw new SpecdevError('current-status.slug must be a non-empty string', 'SPECDEV_STATUS_INVALID')
  }
  if (typeof record.created !== 'string' || record.created.length === 0) {
    throw new SpecdevError('current-status.created must be a non-empty string', 'SPECDEV_STATUS_INVALID')
  }
  if (typeof record.current_stage !== 'string' || record.current_stage.length === 0) {
    throw new SpecdevError('current-status.current_stage must be a non-empty string', 'SPECDEV_STATUS_INVALID')
  }
  if (!(typeof record.current_phase === 'string' || record.current_phase === null)) {
    throw new SpecdevError('current-status.current_phase must be a string or null', 'SPECDEV_STATUS_INVALID')
  }
  if (typeof record.loop_count !== 'number' || !Number.isSafeInteger(record.loop_count) || record.loop_count < 0) {
    throw new SpecdevError('current-status.loop_count must be a non-negative safe integer', 'SPECDEV_STATUS_INVALID')
  }
  if (typeof record.last_update !== 'string' || record.last_update.length === 0) {
    throw new SpecdevError('current-status.last_update must be a non-empty string', 'SPECDEV_STATUS_INVALID')
  }
  const gates = asRecord(record.human_gates)
  if (gates === undefined) {
    throw new SpecdevError('current-status.human_gates must be an object', 'SPECDEV_STATUS_INVALID')
  }
  for (const key of ['hg1', 'hg2', 'hg3'] as const) {
    const state = gates[key]
    if (typeof state !== 'string' || !GATE_STATES.has(state)) {
      throw new SpecdevError(`current-status.human_gates.${key} must be pending|passed`, 'SPECDEV_STATUS_INVALID')
    }
  }
  const hg1_5 = gates.hg1_5
  if (hg1_5 !== undefined && (typeof hg1_5 !== 'string' || !GATE_STATES.has(hg1_5))) {
    throw new SpecdevError('current-status.human_gates.hg1_5 must be pending|passed', 'SPECDEV_STATUS_INVALID')
  }
  const phasesRaw = asRecord(record.phases)
  if (phasesRaw === undefined) {
    throw new SpecdevError('current-status.phases must be an object', 'SPECDEV_STATUS_INVALID')
  }
  const phases: CurrentStatusJson['phases'] = {}
  for (const [phaseId, step] of Object.entries(phasesRaw)) {
    ;(phases as Record<string, ReturnType<typeof parseStep>>)[phaseId] = parseStep(step, phaseId)
  }

  const status: CurrentStatusJson = {
    slug: record.slug.trim(),
    created: record.created,
    current_stage: record.current_stage,
    current_phase: record.current_phase,
    loop_count: record.loop_count,
    human_gates: {
      hg1: gates.hg1 as SpecdevGateState,
      // A status written before the visual chain carries no HG-1.5: nobody
      // released a visual baseline, and only a UI workflow ever waits on one.
      hg1_5: (hg1_5 as SpecdevGateState | undefined) ?? 'pending',
      hg2: gates.hg2 as SpecdevGateState,
      hg3: gates.hg3 as SpecdevGateState,
    },
    phases,
    last_update: record.last_update,
  }
  let withOptional: CurrentStatusJson = status
  if (typeof record.description === 'string') {
    withOptional = { ...withOptional, description: record.description }
  }
  if (typeof record.initiating_command === 'string' && record.initiating_command.trim().length > 0) {
    withOptional = { ...withOptional, initiating_command: record.initiating_command.trim() }
  }
  if (typeof record.pipeline_mode === 'string' && record.pipeline_mode.trim().length > 0) {
    withOptional = { ...withOptional, pipeline_mode: record.pipeline_mode.trim() }
  }
  return withOptional
}

/**
 * Read durable status from disk.
 * @param path - absolute path to `current-status.json`.
 */
export function readCurrentStatusFile(path: string): CurrentStatusJson {
  let text: string
  try {
    text = readFileSync(path, 'utf8')
  } catch (error: unknown) {
    const code = (error as NodeJS.ErrnoException | null)?.code
    if (code === 'ENOENT') {
      throw new SpecdevError(`current-status.json not found at ${path}`, 'SPECDEV_STATUS_MISSING')
    }
    throw error
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    throw new SpecdevError(`current-status.json is not valid JSON at ${path}`, 'SPECDEV_STATUS_INVALID')
  }
  return parseCurrentStatus(parsed)
}

/**
 * Atomically write durable status.
 * @param path - absolute path to `current-status.json`.
 * @param status - validated status object.
 */
export async function writeCurrentStatusFile(path: string, status: CurrentStatusJson): Promise<void> {
  parseCurrentStatus(status)
  await writeFileAtomic(path, `${JSON.stringify(status, null, 2)}\n`, { mode: 0o644, dirMode: 0o755 })
}

/**
 * Infer the pending Human Gate from durable gate flags and stage.
 * @param status - durable status.
 * @param uiWorkflow - whether the phase plan declares a UI phase, which orders HG-1.5 before HG-2.
 */
export function inferPendingGate(status: CurrentStatusJson, uiWorkflow: boolean): SpecdevGateId | null {
  if (status.human_gates.hg1 === 'pending') return 'hg1'
  if (uiWorkflow && status.human_gates.hg1_5 === 'pending') return 'hg1_5'
  if (status.human_gates.hg2 === 'pending') return 'hg2'
  if (status.human_gates.hg3 === 'pending') return 'hg3'
  return null
}

/**
 * Map durable status into the bridge/projection snapshot shape.
 * @param status - durable status.
 * @param ui - visual chain declarations read from the phase plan.
 * @param pendingGate - optional override for pending gate.
 */
export function snapshotFromStatus(
  status: CurrentStatusJson,
  ui: SpecdevUiView,
  pendingGate: SpecdevGateId | null = inferPendingGate(status, ui.workflow),
): SpecdevSnapshot {
  const snap: SpecdevSnapshot = {
    schemaVersion: SPECDEV_SCHEMA_VERSION,
    slug: status.slug,
    stage: status.current_stage,
    phase: status.current_phase,
    gates: { ...status.human_gates },
    steps: { ...status.phases },
    pendingGate,
    loopCount: status.loop_count,
    ui,
  }
  if (status.initiating_command !== undefined) {
    return {
      ...snap,
      initiatingCommand: status.initiating_command,
      ...(status.pipeline_mode === undefined ? {} : { pipelineMode: status.pipeline_mode }),
    }
  }
  if (status.pipeline_mode !== undefined) {
    return { ...snap, pipelineMode: status.pipeline_mode }
  }
  return snap
}

/**
 * Build an initial durable status for a new workflow slug.
 * @param slug - workflow slug.
 * @param description - optional human description (often the command name).
 * @param pipeline - optional initiating command / pipeline mode for schema v2.
 */
export function createInitialStatus(
  slug: string,
  description?: string,
  pipeline?: {
    readonly initiating_command?: string
    readonly pipeline_mode?: string
  },
): CurrentStatusJson {
  const now = new Date().toISOString()
  const base: CurrentStatusJson = {
    slug: slug.trim(),
    created: now,
    current_stage: 'requirement-analysis',
    current_phase: null,
    loop_count: 0,
    human_gates: { hg1: 'pending', hg1_5: 'pending', hg2: 'pending', hg3: 'pending' },
    phases: {},
    last_update: now,
  }
  let status: CurrentStatusJson = base
  if (description !== undefined) status = { ...status, description }
  if (pipeline?.initiating_command !== undefined && pipeline.initiating_command.trim().length > 0) {
    status = { ...status, initiating_command: pipeline.initiating_command.trim() }
  }
  if (pipeline?.pipeline_mode !== undefined && pipeline.pipeline_mode.trim().length > 0) {
    status = { ...status, pipeline_mode: pipeline.pipeline_mode.trim() }
  }
  return status
}

/**
 * The durable step record of one phase, defaulting every field for a phase the
 * status does not carry yet.
 * @param status - durable status.
 * @param phaseId - DAG phase id.
 */
export function phaseStepsOf(
  status: CurrentStatusJson,
  phaseId: string,
): SpecdevPhaseSteps {
  return status.phases[phaseId]
    ?? { implementer: 'pending', reviewer: 'pending', verifier: 'pending', prototype: 'pending' }
}

/**
 * Ensure parent directories exist for a status path.
 * @param dir - directory to create recursively.
 */
export function ensureDirectory(dir: string): void {
  mkdirSync(dir, { recursive: true, mode: 0o755 })
}

/** State fields a workflow-log patch compares. */
const STATE_PATCH_FIELDS = ['current_stage', 'current_phase', 'loop_count', 'phases', 'human_gates'] as const

/**
 * Diff two durable statuses into the log patch that reproduces the change.
 *
 * Locked to the fields a transition may move: the workflow identity lives in
 * the log's init line, and `last_update` follows the appended event timestamp,
 * so a diff that only moved `last_update` yields an empty patch.
 *
 * @param before - status before the change.
 * @param after - status after the change.
 * @returns the patch to append; empty when only `last_update` moved.
 */
export function statusStatePatch(before: CurrentStatusJson, after: CurrentStatusJson): SpecdevStatePatch {
  const patch: Record<string, unknown> = {}
  for (const field of STATE_PATCH_FIELDS) {
    if (JSON.stringify(before[field]) !== JSON.stringify(after[field])) patch[field] = after[field]
  }
  return patch
}
