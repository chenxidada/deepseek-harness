/**
 * SpecDev re-run step state: the downstream-only cascade (AC-44), the
 * single-step setter used by normal progress updates, and the loop counter.
 */

import { describe, expect, it } from 'vitest'
import {
  bumpLoopCount,
  cascadeDownstreamOf,
  createInitialStatus,
  prepareStepRerun,
  setPhaseStepState,
  type CurrentStatusJson,
} from '@deepseek-ai/dsh-specdev'

/** Status whose single phase has finished every step. */
function completedPhase(): CurrentStatusJson {
  return {
    ...createInitialStatus('rerun'),
    current_phase: 'p1',
    loop_count: 2,
    phases: {
      p1: { implementer: 'completed', reviewer: 'completed', verifier: 'completed', prototype: 'passed' },
    },
  }
}

describe('cascadeDownstreamOf', () => {
  it('cascades only downstream steps', () => {
    expect(cascadeDownstreamOf('implementer')).toEqual(['reviewer', 'verifier'])
    expect(cascadeDownstreamOf('reviewer')).toEqual(['verifier'])
    expect(cascadeDownstreamOf('verifier')).toEqual([])
  })
})

describe('prepareStepRerun', () => {
  it('refuses a phase the status does not carry', () => {
    expect(() => prepareStepRerun(createInitialStatus('rerun'), 'p9', 'reviewer'))
      .toThrow(/phase p9 missing from current-status.phases/)
  })

  it('resets the re-run step and its downstream, leaving upstream alone', () => {
    const reviewer = prepareStepRerun(completedPhase(), 'p1', 'reviewer')
    expect(reviewer.loop_count).toBe(0)
    expect(reviewer.phases.p1).toEqual({
      implementer: 'completed',
      reviewer: 'pending',
      verifier: 'pending',
      prototype: 'pending',
    })

    const verifier = prepareStepRerun(completedPhase(), 'p1', 'verifier')
    expect(verifier.phases.p1).toEqual({
      implementer: 'completed',
      reviewer: 'completed',
      verifier: 'pending',
      prototype: 'pending',
    })
  })
})

describe('setPhaseStepState', () => {
  it('updates one step of an existing phase without cascading', () => {
    const next = setPhaseStepState(completedPhase(), 'p1', 'implementer', 'in_progress')
    expect(next.phases.p1).toEqual({
      implementer: 'in_progress',
      reviewer: 'completed',
      verifier: 'completed',
      prototype: 'passed',
    })
    expect(next.loop_count).toBe(2)
  })

  it('carries a phase the status does not know yet', () => {
    const next = setPhaseStepState(createInitialStatus('rerun'), 'p2', 'reviewer', 'failed')
    expect(next.phases.p2).toEqual({
      implementer: 'pending',
      reviewer: 'failed',
      verifier: 'pending',
      prototype: 'pending',
    })
  })
})

describe('bumpLoopCount', () => {
  it('increments the counter and leaves the phases alone', () => {
    const next = bumpLoopCount(completedPhase())
    expect(next.loop_count).toBe(3)
    expect(next.phases).toEqual(completedPhase().phases)
  })
})
