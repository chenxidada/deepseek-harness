/**
 * SpecDev re-run / cascade / step-state helpers (AC-44 / AC-45).
 * Scheduler resets durable step flags; agents archive their own artifacts.
 * Never uses git reset/clean/restore to clear artifacts.
 *
 * @module @deepseek-ai/dsh-specdev/rerun
 */

import type { CurrentStatusJson, SpecdevStepState } from './types.ts'
import { SpecdevError } from './status.ts'

/** Pipeline steps in dependency order. */
export type PhaseStepName = 'implementer' | 'reviewer' | 'verifier'

/** Downstream cascade map (AC-B6): only downstream, never upstream. */
const CASCADE: Readonly<Record<PhaseStepName, readonly PhaseStepName[]>> = {
  implementer: ['reviewer', 'verifier'],
  reviewer: ['verifier'],
  verifier: [],
}

/**
 * Reset a step to pending, zero loop_count, and cascade downstream to pending (AC-44).
 * Does not touch upstream steps. Does not touch the filesystem / git.
 *
 * @param status - durable status.
 * @param phaseId - DAG phase id.
 * @param step - step being re-run.
 */
export function prepareStepRerun(
  status: CurrentStatusJson,
  phaseId: string,
  step: PhaseStepName,
): CurrentStatusJson {
  const phase = status.phases[phaseId]
  if (phase === undefined) {
    throw new SpecdevError(`phase ${phaseId} missing from current-status.phases`, 'SPECDEV_RERUN_PHASE_MISSING')
  }
  const nextSteps: Record<PhaseStepName, SpecdevStepState> = {
    implementer: phase.implementer,
    reviewer: phase.reviewer,
    verifier: phase.verifier,
  }
  nextSteps[step] = 'pending'
  for (const down of CASCADE[step]) {
    nextSteps[down] = 'pending'
  }
  return {
    ...status,
    loop_count: 0,
    phases: {
      ...status.phases,
      [phaseId]: { ...phase, ...nextSteps, prototype: 'pending' },
    },
    last_update: new Date().toISOString(),
  }
}

/**
 * List cascade targets for a re-run step (for tests / guidance).
 * @param step - step being re-run.
 */
export function cascadeDownstreamOf(step: PhaseStepName): readonly PhaseStepName[] {
  return CASCADE[step]
}

/**
 * Set a single step state without cascading (normal progress updates).
 */
export function setPhaseStepState(
  status: CurrentStatusJson,
  phaseId: string,
  step: PhaseStepName,
  state: SpecdevStepState,
): CurrentStatusJson {
  const phase = status.phases[phaseId] ?? {
    implementer: 'pending' as const,
    reviewer: 'pending' as const,
    verifier: 'pending' as const,
    prototype: 'pending' as const,
  }
  return {
    ...status,
    phases: {
      ...status.phases,
      [phaseId]: { ...phase, [step]: state },
    },
    last_update: new Date().toISOString(),
  }
}

/**
 * Increment loop_count after a MUST-FIX re-dispatch of implementer.
 */
export function bumpLoopCount(status: CurrentStatusJson): CurrentStatusJson {
  return {
    ...status,
    loop_count: status.loop_count + 1,
    last_update: new Date().toISOString(),
  }
}
