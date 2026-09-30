/**
 * The `specdev/status` projection fold: which events carry a whole snapshot,
 * how a null snapshot clears (or does not clear) the view, and how the first
 * unparsable snapshot fails the projection closed.
 */

import { describe, expect, it } from 'vitest'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import {
  applySpecdevProjection,
  createInitialStatus,
  snapshotFromStatus,
  type SpecdevSnapshot,
  type SpecdevStatusProjectionState,
} from '@deepseek-ai/dsh-specdev'

const EMPTY: SpecdevStatusProjectionState = { status: null, failure: null }

const SNAPSHOT: SpecdevSnapshot = snapshotFromStatus(createInitialStatus('wf'), { workflow: false, phases: {} })

/** One committed-event stand-in for the fold. */
function event(type: string, data: unknown, seq = 1): SessionEvent {
  return { seq, type, data } as unknown as SessionEvent
}

/** Fold one whole-view event carrying `snapshot`. */
function foldSnapshot(state: SpecdevStatusProjectionState, snapshot: unknown, seq = 1): SpecdevStatusProjectionState {
  return applySpecdevProjection(state, event('specdev/gate-decided', { snapshot }, seq))
}

describe('applySpecdevProjection', () => {
  it('folds a whole snapshot from a whole-view event', () => {
    const folded = foldSnapshot(EMPTY, SNAPSHOT)
    expect(folded.failure).toBeNull()
    expect(folded.status).toEqual(SNAPSHOT)
  })

  it('returns the same state for unrelated and snapshot-less events', () => {
    expect(applySpecdevProjection(EMPTY, event('tool/result', { ok: true }))).toBe(EMPTY)
    expect(applySpecdevProjection(EMPTY, event('specdev/workflow', { active: null }))).toBe(EMPTY)
  })

  it('keeps the last status when an advance carries guidance only (AC-28)', () => {
    const withStatus = foldSnapshot(EMPTY, SNAPSHOT)
    const advanced = applySpecdevProjection(
      withStatus,
      event('specdev/advance', { nextAction: 'keep going', snapshot: null }, 2),
    )
    expect(advanced).toBe(withStatus)
    // The field is absent rather than null, which is the same trust decision.
    expect(applySpecdevProjection(
      withStatus,
      event('specdev/advance', { nextAction: 'keep going' }, 3),
    )).toBe(withStatus)
  })

  it('clears a status on a null snapshot and leaves a cleared state alone', () => {
    const withStatus = foldSnapshot(EMPTY, SNAPSHOT)
    const cleared = foldSnapshot(withStatus, null, 2)
    expect(cleared).toEqual({ status: null, failure: null })
    expect(foldSnapshot(cleared, null, 3)).toBe(cleared)
  })

  it('fails closed on an unparsable snapshot and stops folding afterwards', () => {
    const failed = foldSnapshot(EMPTY, { slug: 'wf' }, 7)
    expect(failed.status).toBeNull()
    expect(failed.failure).toContain('specdev/status replay failed at session event 7')

    const later = foldSnapshot(failed, SNAPSHOT, 8)
    expect(later).toBe(failed)
  })

  it('folds the v4 IDE views and refuses a malformed row', () => {
    const withViews: SpecdevSnapshot = {
      ...SNAPSHOT,
      plan: [{ id: 'p1', dependencies: [], status: 'active' }],
      artifacts: [
        { path: '.specdev/specs/wf/design.md', label: 'design.md', phaseId: null, status: 'ready' },
      ],
    }
    const folded = foldSnapshot(EMPTY, withViews)
    expect(folded.failure).toBeNull()
    expect(folded.status).toEqual(withViews)

    const badStatus = foldSnapshot(EMPTY, {
      ...withViews,
      plan: [{ id: 'p1', dependencies: [], status: 'running' }],
    }, 2)
    expect(badStatus.status).toBeNull()
    expect(badStatus.failure).toContain('specdev/status replay failed at session event 2')

    const badArtifact = foldSnapshot(EMPTY, {
      ...withViews,
      artifacts: [{ path: '', label: 'design.md', phaseId: null, status: 'ready' }],
    }, 3)
    expect(badArtifact.status).toBeNull()
    expect(badArtifact.failure).toContain('specdev/status replay failed at session event 3')
  })
})
