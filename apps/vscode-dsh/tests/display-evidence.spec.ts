/**
 * AC-26(e) / AC-28 R2.3: a PASS may not rest on five byte-identical screenshots.
 *
 * `run-layer-v-smoke.sh` prefers an already-reachable `DISPLAY` (AC-28) and, measured on this
 * machine, that display sometimes yields five captures of a bare desktop — the frames are valid
 * PNGs, stably named and ignored by git, so every earlier check passed while the evidence showed
 * nothing. `reuse` is now only allowed while it can produce evidence AC-26 accepts, and a
 * degenerate attempt is re-run on a display the script owns (`xvfb`).
 *
 * These cases drive the shipped module (`layer-v-support/display-evidence.cjs`), not a copy of
 * its logic: the degenerate shape must be refused, the floor the user adjudicated must be hit
 * exactly (it was tightened from two distinct frames to three on 2026-09-17, so a run whose
 * frames differ in only one place is now degenerate), and a measurement that cannot be taken at
 * all must be a refusal rather than a default.
 */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

/** Shape of the measurement the module returns. */
interface Measurement {
  ok: boolean
  frames: number
  problem?: string
  md5?: Record<string, string>
  distinctMd5?: number
  degenerate?: boolean
}

/** Shape of the action the module decides. */
interface Verdict {
  action: 'pass' | 'retry' | 'skip' | 'fail-closed'
  reason: string
}

const require = createRequire(import.meta.url)
const { measureFrames, judgeEvidence, MIN_DISTINCT_MD5 } = require(
  '../test-scripts/layer-v-support/display-evidence.cjs',
) as {
  measureFrames: (directory: string) => Measurement
  judgeEvidence: (measurement: Measurement, context: { mode: string; forced: boolean }) => Verdict
  MIN_DISTINCT_MD5: number
}

/** The five step slugs the smoke's link steps capture under, in order. */
const SLUGS = ['host-started', 'new-conversation', 'model-round-trip', 'approval', 'native-diff']

const dirs: string[] = []
let artifactDir = ''

beforeEach(() => {
  artifactDir = mkdtempSync(join(tmpdir(), 'layer-v-display-evidence-'))
  dirs.push(artifactDir)
})

afterEach(() => {
  while (dirs.length > 0) {
    const dir = dirs.pop()
    if (dir !== undefined) rmSync(dir, { recursive: true, force: true })
  }
})

/**
 * Write the five frames, each filled from the bytes named for it.
 * @param contents - one payload per frame, in step order; `null` leaves that frame out.
 */
function writeFrames(contents: (string | null)[]): void {
  contents.forEach((content, index) => {
    if (content === null) return
    writeFileSync(join(artifactDir, `step-${index + 1}-${SLUGS[index]}.png`), content)
  })
}

describe('measureFrames', () => {
  it('counts the frames of a run whose steps all show the same screen', () => {
    writeFrames(Array.from({ length: 5 }, () => 'one-and-the-same-png'))
    const measurement = measureFrames(artifactDir)
    expect(measurement.ok).toBe(true)
    expect(measurement.frames).toBe(5)
    expect(measurement.distinctMd5).toBe(1)
    expect(measurement.degenerate).toBe(true)
    expect(Object.keys(measurement.md5 ?? {})).toHaveLength(5)
  })

  it('accepts five distinct frames', () => {
    writeFrames(['a', 'b', 'c', 'd', 'e'])
    const measurement = measureFrames(artifactDir)
    expect(measurement.distinctMd5).toBe(5)
    expect(measurement.degenerate).toBe(false)
  })

  it(`accepts exactly the adjudicated floor of ${MIN_DISTINCT_MD5} distinct frames`, () => {
    // The floor is a user adjudication (`scope-amendment-02.md` §8.1 item 6), so the number a run
    // is judged against is pinned here: a silent change to it has to break this test, not just
    // move the boundary. Three distinct frames among five is the smallest accepted shape.
    expect(MIN_DISTINCT_MD5).toBe(3)
    writeFrames(['same', 'same', 'same', 'second', 'third'])
    const measurement = measureFrames(artifactDir)
    expect(measurement.distinctMd5).toBe(MIN_DISTINCT_MD5)
    expect(measurement.degenerate).toBe(false)
  })

  it(`treats ${MIN_DISTINCT_MD5 - 1} distinct frames as degenerate`, () => {
    // The shape the floor was raised to reject, and a real one: the archived reuse run
    // `20260916T170431Z-2270421` is four byte-identical frames and a different fifth. Under the
    // old floor of two this passed; under the adjudicated floor it is a run to be replaced.
    writeFrames(['same', 'same', 'same', 'same', 'different'])
    const measurement = measureFrames(artifactDir)
    expect(measurement.distinctMd5).toBe(MIN_DISTINCT_MD5 - 1)
    expect(measurement.degenerate).toBe(true)
  })

  it('refuses a run that did not produce five frames', () => {
    writeFrames(['a', 'b', 'c', 'd', null])
    const measurement = measureFrames(artifactDir)
    expect(measurement.ok).toBe(false)
    expect(measurement.frames).toBe(4)
    expect(measurement.problem).toContain('not the 5')
  })

  it('ignores files that are not one of the link steps frames', () => {
    writeFrames(['a', 'b', 'c', 'd', 'e'])
    writeFileSync(join(artifactDir, 'step-6-host-started.png'), 'stray')
    writeFileSync(join(artifactDir, 'notes.txt'), 'stray')
    const measurement = measureFrames(artifactDir)
    expect(measurement.ok).toBe(true)
    expect(measurement.frames).toBe(5)
    expect(measurement.distinctMd5).toBe(5)
  })

  it('refuses five frames that do not number the link steps once each', () => {
    writeFrames(['a', 'b', 'c', 'd', 'e'])
    rmSync(join(artifactDir, 'step-4-approval.png'))
    writeFileSync(join(artifactDir, 'step-3-approval.png'), 'a-second-step-3')
    const measurement = measureFrames(artifactDir)
    expect(measurement.ok).toBe(false)
    expect(measurement.frames).toBe(5)
    expect(measurement.problem).toContain('numbered 1,2,3,3,5')
  })

  it('refuses to treat an unreadable frame as evidence', () => {
    writeFrames(['a', 'b', 'c', 'd', 'e'])
    // A directory named like a frame is the cheapest unreadable frame there is.
    rmSync(join(artifactDir, 'step-3-model-round-trip.png'))
    mkdirSync(join(artifactDir, 'step-3-model-round-trip.png'))
    const measurement = measureFrames(artifactDir)
    expect(measurement.ok).toBe(false)
    expect(measurement.problem).toContain('step-3-model-round-trip.png')
  })

  it('reports a directory it cannot list instead of claiming an empty measurement', () => {
    const measurement = measureFrames(join(artifactDir, 'does-not-exist'))
    expect(measurement.ok).toBe(false)
    expect(measurement.problem).toContain('could not be listed')
  })
})

describe('judgeEvidence', () => {
  const degenerate: Measurement = { ok: true, frames: 5, distinctMd5: 1, degenerate: true }
  const previouslyAcceptable: Measurement = { ok: true, frames: 5, distinctMd5: 2, degenerate: true }
  const healthy: Measurement = { ok: true, frames: 5, distinctMd5: 3, degenerate: false }
  const unmeasurable: Measurement = { ok: false, frames: 4, problem: '4 step frame(s)' }

  it('re-runs under xvfb when a reused display produced identical frames', () => {
    expect(judgeEvidence(degenerate, { mode: 'reuse', forced: false }).action).toBe('retry')
  })

  it('re-runs the shape the raised floor no longer accepts', () => {
    expect(judgeEvidence(previouslyAcceptable, { mode: 'reuse', forced: false }).action).toBe('retry')
  })

  it('does not re-run twice: a degenerate xvfb attempt cannot retry again', () => {
    expect(judgeEvidence(degenerate, { mode: 'reuse', forced: true }).action).toBe('skip')
    expect(judgeEvidence(degenerate, { mode: 'xvfb', forced: false }).action).toBe('skip')
  })

  it('lets a healthy run through on either display', () => {
    expect(judgeEvidence(healthy, { mode: 'reuse', forced: false }).action).toBe('pass')
    expect(judgeEvidence(healthy, { mode: 'xvfb', forced: false }).action).toBe('pass')
  })

  it('refuses to judge evidence it could not measure', () => {
    const verdict = judgeEvidence(unmeasurable, { mode: 'reuse', forced: false })
    expect(verdict.action).toBe('fail-closed')
    expect(verdict.reason).toContain('4 step frame(s)')
  })

  it('refuses a degenerate run whose display mode it does not recognise', () => {
    expect(judgeEvidence(degenerate, { mode: '', forced: false }).action).toBe('fail-closed')
    expect(judgeEvidence(degenerate, { mode: 'wayland', forced: false }).action).toBe('fail-closed')
  })

  it('names the observed count in every reason it gives', () => {
    for (const context of [{ mode: 'reuse', forced: false }, { mode: 'xvfb', forced: false }]) {
      expect(judgeEvidence(degenerate, context).reason).toContain('distinct md5 = 1/5')
    }
    expect(judgeEvidence(healthy, { mode: 'reuse', forced: false }).reason).toContain('distinct md5 = 3/5')
  })
})
