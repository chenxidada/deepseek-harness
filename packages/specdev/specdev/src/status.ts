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
  type SpecdevSnapshot,
  type SpecdevStepState,
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

/** Validate one durable step triple. */
function parseStep(value: unknown, label: string): {
  implementer: SpecdevStepState
  reviewer: SpecdevStepState
  verifier: SpecdevStepState
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
  return {
    implementer: record.implementer as SpecdevStepState,
    reviewer: record.reviewer as SpecdevStepState,
    verifier: record.verifier as SpecdevStepState,
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
      hg2: gates.hg2 as SpecdevGateState,
      hg3: gates.hg3 as SpecdevGateState,
    },
    phases,
    last_update: record.last_update,
  }
  if (typeof record.description === 'string') {
    return { ...status, description: record.description }
  }
  return status
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
 */
export function inferPendingGate(status: CurrentStatusJson): SpecdevGateId | null {
  if (status.human_gates.hg1 === 'pending') return 'hg1'
  if (status.human_gates.hg2 === 'pending') return 'hg2'
  if (status.human_gates.hg3 === 'pending') return 'hg3'
  return null
}

/**
 * Map durable status into the bridge/projection snapshot shape.
 * @param status - durable status.
 * @param pendingGate - optional override for pending gate.
 */
export function snapshotFromStatus(
  status: CurrentStatusJson,
  pendingGate: SpecdevGateId | null = inferPendingGate(status),
): SpecdevSnapshot {
  return {
    schemaVersion: SPECDEV_SCHEMA_VERSION,
    slug: status.slug,
    stage: status.current_stage,
    phase: status.current_phase,
    gates: { ...status.human_gates },
    steps: { ...status.phases },
    pendingGate,
    loopCount: status.loop_count,
  }
}

/**
 * Build an initial durable status for a new workflow slug.
 * @param slug - workflow slug.
 * @param description - optional human description (often the command name).
 */
export function createInitialStatus(slug: string, description?: string): CurrentStatusJson {
  const now = new Date().toISOString()
  const base: CurrentStatusJson = {
    slug: slug.trim(),
    created: now,
    current_stage: 'requirement-analysis',
    current_phase: null,
    loop_count: 0,
    human_gates: { hg1: 'pending', hg2: 'pending', hg3: 'pending' },
    phases: {},
    last_update: now,
  }
  if (description !== undefined) return { ...base, description }
  return base
}

/**
 * Ensure parent directories exist for a status path.
 * @param dir - directory to create recursively.
 */
export function ensureDirectory(dir: string): void {
  mkdirSync(dir, { recursive: true, mode: 0o755 })
}
