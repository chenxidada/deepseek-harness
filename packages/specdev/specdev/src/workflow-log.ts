/**
 * Append-only workflow log (`workflow.jsonl`) — the SpecDev workflow's source of
 * truth. Each accepted state change appends one line; `current-status.json` is a
 * derived mirror exported after each append and never read as authority.
 *
 * Every line is `{v, seq, at, kind, payload, prev}` where `prev` is the SHA-256
 * of the previous raw line (`genesis` for the first), so hand edits, reordering,
 * or truncation break the chain and are reported instead of silently trusted.
 *
 * The chain cannot verify the *final* line, which has no successor to disagree
 * with it; appended state is therefore cross-checked against the exported
 * `current-status.json` mirror and the session events that record each decision.
 *
 * @module @deepseek-ai/dsh-specdev/workflow-log
 */

import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, openSync, closeSync, readFileSync, statSync, unlinkSync, writeSync } from 'node:fs'
import { dirname } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { createInitialStatus, parseCurrentStatus, SpecdevError } from './status.ts'
import { isSpecdevGateId, type CurrentStatusJson, type SpecdevGateId, type SpecdevStatePatch } from './types.ts'

/** Log format version carried by every line. */
export const WORKFLOW_LOG_VERSION = 1 as const

/** `prev` value of the first line, whose predecessor does not exist. */
export const WORKFLOW_LOG_GENESIS = 'genesis' as const

/** Milliseconds after which an unreleased lock file is treated as abandoned. */
const LOCK_STALE_MS = 10_000

/** Poll interval while another process holds the lock. */
const LOCK_RETRY_MS = 25

/** Total wait before an append gives up on a live lock. */
const LOCK_TIMEOUT_MS = 2_000

/** Payload of the first line: everything needed to build the initial status. */
export interface WorkflowLogInitPayload {
  readonly slug: string
  readonly command: string
  readonly created: string
  readonly description?: string
}

/** Payload of a state change, with the audit reason that produced it. */
export interface WorkflowLogStatePayload {
  /** Machine-readable origin of the change (`gate-decided`, `rerun`, `loop-bump`, `adopt`). */
  readonly reason: string
  readonly patch: SpecdevStatePatch
  readonly gate?: SpecdevGateId
  readonly decision?: string
  readonly note?: string
  /** DAG phase the change targeted, when it targeted one. */
  readonly phaseId?: string
  /** Phase step the change targeted (`implementer` | `reviewer` | `verifier`). */
  readonly step?: string
}

/** Log line kinds understood by {@link foldWorkflowLog}. */
export type WorkflowLogKind = 'workflow/init' | 'workflow/state'

/** One validated log line. */
export interface WorkflowLogEvent {
  readonly v: typeof WORKFLOW_LOG_VERSION
  readonly seq: number
  readonly at: string
  readonly kind: WorkflowLogKind
  readonly payload: WorkflowLogInitPayload | WorkflowLogStatePayload
  readonly prev: string
}

/** A parsed log file: validated events plus the hash the next append chains to. */
export interface WorkflowLogFile {
  readonly events: readonly WorkflowLogEvent[]
  /** SHA-256 of the last raw line, or {@link WORKFLOW_LOG_GENESIS} when empty. */
  readonly tailHash: string
}

/** SHA-256 of one raw log line, excluding its newline. */
function lineHash(line: string): string {
  return createHash('sha256').update(line, 'utf8').digest('hex')
}

/** Narrow an unknown value to a non-null object record. */
function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined
  return value as Record<string, unknown>
}

/** Reject a malformed log with a stable code. */
function invalid(path: string, detail: string): never {
  throw new SpecdevError(`workflow log ${path}: ${detail}`, 'SPECDEV_LOG_INVALID')
}

/** Validate the `phases` patch field. */
function readPhases(value: unknown, path: string): SpecdevStatePatch['phases'] {
  const record = asRecord(value)
  if (record === undefined) invalid(path, 'patch.phases must be an object')
  const phases: Record<string, {
    implementer: string
    reviewer: string
    verifier: string
    prototype: string
  }> = {}
  for (const [phaseId, steps] of Object.entries(record)) {
    const stepRecord = asRecord(steps)
    if (stepRecord === undefined) invalid(path, `patch.phases.${phaseId} must be an object`)
    for (const key of ['implementer', 'reviewer', 'verifier'] as const) {
      const state = stepRecord[key]
      if (state !== 'pending' && state !== 'in_progress' && state !== 'completed' && state !== 'failed') {
        invalid(path, `patch.phases.${phaseId}.${key} must be a step state`)
      }
    }
    const prototype = stepRecord.prototype
    if (prototype !== 'pending' && prototype !== 'passed') {
      invalid(path, `patch.phases.${phaseId}.prototype must be pending|passed`)
    }
    phases[phaseId] = {
      implementer: stepRecord.implementer as string,
      reviewer: stepRecord.reviewer as string,
      verifier: stepRecord.verifier as string,
      prototype: prototype,
    }
  }
  return phases as SpecdevStatePatch['phases']
}

/** Validate one `workflow/state` patch, rejecting unknown fields. */
function readStatePatch(value: unknown, path: string): SpecdevStatePatch {
  const record = asRecord(value)
  if (record === undefined) invalid(path, 'state payload.patch must be an object')
  const patch: Record<string, unknown> = {}
  for (const [key, field] of Object.entries(record)) {
    switch (key) {
      case 'current_stage':
        if (typeof field !== 'string' || field.length === 0) invalid(path, 'patch.current_stage must be a non-empty string')
        patch.current_stage = field
        break
      case 'current_phase':
        if (!(typeof field === 'string' || field === null)) invalid(path, 'patch.current_phase must be a string or null')
        patch.current_phase = field
        break
      case 'loop_count':
        if (typeof field !== 'number' || !Number.isSafeInteger(field) || field < 0) {
          invalid(path, 'patch.loop_count must be a non-negative safe integer')
        }
        patch.loop_count = field
        break
      case 'phases':
        patch.phases = readPhases(field, path)
        break
      case 'human_gates': {
        const gates = asRecord(field)
        if (gates === undefined) invalid(path, 'patch.human_gates must be an object')
        for (const gate of ['hg1', 'hg1_5', 'hg2', 'hg3'] as const) {
          if (gates[gate] !== 'pending' && gates[gate] !== 'passed') {
            invalid(path, `patch.human_gates.${gate} must be pending|passed`)
          }
        }
        patch.human_gates = {
          hg1: gates.hg1,
          hg1_5: gates.hg1_5,
          hg2: gates.hg2,
          hg3: gates.hg3,
        }
        break
      }
      default:
        invalid(path, `patch carries unknown field "${key}"`)
    }
  }
  return patch
}

/** Validate one parsed line and its chain position. */
function readEvent(raw: unknown, index: number, expectedPrev: string, path: string): WorkflowLogEvent {
  const record = asRecord(raw)
  if (record === undefined) invalid(path, `line ${index + 1} must be a JSON object`)
  if (record.v !== WORKFLOW_LOG_VERSION) invalid(path, `line ${index + 1} has unsupported version ${String(record.v)}`)
  if (record.seq !== index + 1) invalid(path, `line ${index + 1} has seq ${String(record.seq)}`)
  if (typeof record.at !== 'string' || record.at.length === 0) invalid(path, `line ${index + 1} needs a timestamp`)
  if (record.prev !== expectedPrev) {
    throw new SpecdevError(
      `workflow log ${path}: line ${index + 1} breaks the hash chain (hand edit or truncation)`,
      'SPECDEV_LOG_TAMPERED',
    )
  }
  const payload = asRecord(record.payload)
  if (payload === undefined) invalid(path, `line ${index + 1} needs an object payload`)
  if (record.kind === 'workflow/init') {
    if (typeof payload.slug !== 'string' || payload.slug.trim().length === 0) invalid(path, 'init payload.slug is required')
    if (typeof payload.command !== 'string' || payload.command.trim().length === 0) {
      invalid(path, 'init payload.command is required')
    }
    if (typeof payload.created !== 'string' || payload.created.length === 0) invalid(path, 'init payload.created is required')
    if (payload.description !== undefined && typeof payload.description !== 'string') {
      invalid(path, 'init payload.description must be a string')
    }
    return {
      v: WORKFLOW_LOG_VERSION,
      seq: record.seq,
      at: record.at,
      kind: 'workflow/init',
      payload: {
        slug: payload.slug.trim(),
        command: payload.command.trim(),
        created: payload.created,
        ...payload.description === undefined ? {} : { description: payload.description },
      },
      prev: expectedPrev,
    }
  }
  if (record.kind === 'workflow/state') {
    if (typeof payload.reason !== 'string' || payload.reason.trim().length === 0) {
      invalid(path, 'state payload.reason is required')
    }
    const gate = payload.gate
    if (gate !== undefined && !isSpecdevGateId(gate)) {
      invalid(path, `state payload.gate is unknown: ${JSON.stringify(gate)}`)
    }
    if (payload.decision !== undefined && typeof payload.decision !== 'string') {
      invalid(path, 'state payload.decision must be a string')
    }
    if (payload.note !== undefined && typeof payload.note !== 'string') {
      invalid(path, 'state payload.note must be a string')
    }
    if (payload.phaseId !== undefined && typeof payload.phaseId !== 'string') {
      invalid(path, 'state payload.phaseId must be a string')
    }
    if (payload.step !== undefined && (typeof payload.step !== 'string' || payload.step.length === 0)) {
      invalid(path, 'state payload.step must be a non-empty string')
    }
    return {
      v: WORKFLOW_LOG_VERSION,
      seq: record.seq,
      at: record.at,
      kind: 'workflow/state',
      payload: {
        reason: payload.reason.trim(),
        patch: readStatePatch(payload.patch, path),
        ...gate === undefined ? {} : { gate: gate },
        ...payload.decision === undefined ? {} : { decision: payload.decision },
        ...payload.note === undefined ? {} : { note: payload.note },
        ...payload.phaseId === undefined ? {} : { phaseId: payload.phaseId },
        ...payload.step === undefined ? {} : { step: payload.step },
      },
      prev: expectedPrev,
    }
  }
  return invalid(path, `line ${index + 1} has unknown kind ${String(record.kind)}`)
}

/**
 * Parse and chain-verify raw log text.
 *
 * A missing trailing newline means a torn write, which is refused rather than
 * completed by the next append.
 *
 * @param text - raw `workflow.jsonl` content.
 * @param path - log path used in error messages.
 * @returns validated events with the tail hash the next append chains to.
 */
export function parseWorkflowLog(text: string, path: string): WorkflowLogFile {
  if (text.length === 0) return { events: [], tailHash: WORKFLOW_LOG_GENESIS }
  if (!text.endsWith('\n')) {
    throw new SpecdevError(`workflow log ${path}: last line is unterminated (torn write)`, 'SPECDEV_LOG_TAMPERED')
  }
  const lines = text.slice(0, -1).split('\n')
  const events: WorkflowLogEvent[] = []
  let prev = WORKFLOW_LOG_GENESIS as string
  for (const [index, line] of lines.entries()) {
    let raw: unknown
    try {
      raw = JSON.parse(line)
    } catch {
      throw new SpecdevError(`workflow log ${path}: line ${index + 1} is not valid JSON`, 'SPECDEV_LOG_INVALID')
    }
    events.push(readEvent(raw, index, prev, path))
    prev = lineHash(line)
  }
  return { events, tailHash: prev }
}

/**
 * Read and verify the log file.
 * @param path - absolute `workflow.jsonl` path.
 * @returns the parsed log, or null when the file does not exist.
 */
export function readWorkflowLog(path: string): WorkflowLogFile | null {
  let text: string
  try {
    text = readFileSync(path, 'utf8')
  } catch (error: unknown) {
    if ((error as NodeJS.ErrnoException | null)?.code === 'ENOENT') return null
    throw error
  }
  return parseWorkflowLog(text, path)
}

/**
 * Fold log events into the durable status they describe.
 * @param events - validated events in append order.
 * @param path - log path used in error messages.
 * @returns the folded durable status.
 */
export function foldWorkflowLog(events: readonly WorkflowLogEvent[], path: string): CurrentStatusJson {
  const first = events[0]
  if (first === undefined || first.kind !== 'workflow/init') {
    invalid(path, 'the first line must be workflow/init')
  }
  const init = first.payload as WorkflowLogInitPayload
  let status: CurrentStatusJson = {
    ...createInitialStatus(init.slug, init.description, {
      initiating_command: init.command,
      pipeline_mode: init.command,
    }),
    created: init.created,
  }
  for (const event of events.slice(1)) {
    if (event.kind !== 'workflow/state') invalid(path, `line ${event.seq} must be workflow/state after init`)
    const payload = event.payload as WorkflowLogStatePayload
    status = { ...status, ...payload.patch, last_update: event.at }
  }
  return parseCurrentStatus(status)
}

/**
 * Read the workflow log and fold it into durable status.
 * @param path - absolute `workflow.jsonl` path.
 * @returns the folded status, or null when no log exists.
 */
export function loadWorkflowState(path: string): CurrentStatusJson | null {
  const file = readWorkflowLog(path)
  if (file === null) return null
  return foldWorkflowLog(file.events, path)
}

/**
 * Run `task` while holding an exclusive lock beside the log file.
 *
 * A lock older than {@link LOCK_STALE_MS} is treated as abandoned (crashed
 * append) and stolen; a live lock is polled up to {@link LOCK_TIMEOUT_MS} so a
 * concurrent session waits instead of interleaving lines.
 *
 * @param path - absolute `workflow.jsonl` path.
 * @param task - critical section appending one line.
 * @returns whatever `task` returns.
 */
async function withLogLock<T>(path: string, task: () => Promise<T> | T): Promise<T> {
  const lockPath = `${path}.lock`
  const deadline = Date.now() + LOCK_TIMEOUT_MS
  for (;;) {
    try {
      const fd = openSync(lockPath, 'wx', 0o644)
      writeSync(fd, `${process.pid}\n`)
      closeSync(fd)
      break
    } catch (error: unknown) {
      if ((error as NodeJS.ErrnoException | null)?.code !== 'EEXIST') throw error
      let stale = false
      try {
        stale = Date.now() - statSync(lockPath).mtimeMs > LOCK_STALE_MS
      } catch {
        /* v8 ignore next -- the holder released the lock between the failed open and this stat. */
        continue
      }
      if (stale) {
        try {
          unlinkSync(lockPath)
        } catch {
          // Another waiter stole the abandoned lock first; retry the open.
        }
        continue
      }
      if (Date.now() >= deadline) {
        throw new SpecdevError(
          `workflow log ${path} is locked by another session (${lockPath}); retry after it settles`,
          'SPECDEV_LOG_LOCKED',
        )
      }
      await delay(LOCK_RETRY_MS)
    }
  }
  try {
    return await task()
  } finally {
    try {
      unlinkSync(lockPath)
    } catch {
      // The lock is already gone; nothing else can be released here.
    }
  }
}

/**
 * Append one event to the workflow log, creating the file on first append.
 *
 * The new line chains to the current tail hash, so a tampered or torn log is
 * refused before anything is written.
 *
 * @param path - absolute `workflow.jsonl` path.
 * @param kind - event kind.
 * @param payload - validated-on-write payload for the kind.
 * @returns the appended event as written.
 */
export async function appendWorkflowLog(
  path: string,
  kind: WorkflowLogKind,
  payload: WorkflowLogInitPayload | WorkflowLogStatePayload,
): Promise<WorkflowLogEvent> {
  if (!existsSync(dirname(path))) mkdirSync(dirname(path), { recursive: true, mode: 0o755 })
  return withLogLock(path, () => {
    const file = readWorkflowLog(path)
    const seq = (file?.events.length ?? 0) + 1
    const prev = file?.tailHash ?? WORKFLOW_LOG_GENESIS
    const event = { v: WORKFLOW_LOG_VERSION, seq, at: new Date().toISOString(), kind, payload, prev }
    const line = JSON.stringify(event)
    const fd = openSync(path, 'a', 0o644)
    try {
      writeSync(fd, `${line}\n`)
    } finally {
      closeSync(fd)
    }
    return readEvent(event, seq - 1, prev, path)
  })
}
