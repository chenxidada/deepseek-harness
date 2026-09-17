/**
 * DEBT-015: the per-step "sandbox product state is empty" predicate must be able to fail.
 *
 * AD-16 decision 3's guard compares the mtime of every file under the sandbox's
 * `sessions` / `storages` roots against the instant the run began. The version of this
 * predicate that shipped inside `layer-v-driver/extension.cjs` read that instant from the
 * plan with `Number(plan.runStartedAtMs ?? 0)`, and the runner wrote the plan *before*
 * assigning its launch timestamp — so the value was always `0` and the comparison was
 * `mtimeMs + 5000 < 0` for every file. The `predates-run` branch could not be reached by
 * any input, including the state it exists to catch: a previous run's session left in the
 * sandbox, which makes the panel restore `replay` and lets step 3 pass without a model
 * round trip.
 *
 * The same shape was found in the field that *names* those roots (`scope-amendment-02.md`
 * §8.1 🟡-1): a plan without `homeSandbox` made the predicate scan nothing and report zero
 * offenders, i.e. "clean". Both fields are now validated before use, and the cases below
 * assert the refusal rather than the silence.
 *
 * These cases drive the predicate module the driver now requires, so both directions are
 * executable facts: a stale entry is reported, and a missing instant or sandbox home is
 * refused instead of silently degrading to "clean".
 */

import { mkdirSync, mkdtempSync, rmSync, symlinkSync, utimesSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

/** Shape of a scanned entry the predicate reports as an offender. */
interface Offender {
  path: string
  mtimeMs?: number
  runStartedAtMs?: number
  reason: string
}

/** Shape of `staleProductState`'s report. */
interface CleanlinessReport {
  checkedRoots: string[]
  scannedFiles: number
  runStartedAtMs: number
  offenderCount: number
  offenders: Offender[]
}

type StaleProductState = (sandboxHome: string, runStartedAtMs: number) => CleanlinessReport
type RunStartedAtMsOf = (plan: unknown) => { ok: true; value: number } | { ok: false; value: unknown }
type HomeSandboxOf = (plan: unknown) => { ok: true; value: string } | { ok: false; value: unknown }

/**
 * The driver's own predicate, required rather than re-implemented: a copy of the logic here
 * would pass even after the shipped one regressed.
 */
const require = createRequire(import.meta.url)
const predicate = require('../test-scripts/layer-v-driver/sandbox-clean-state.cjs') as {
  runStartedAtMsOf: RunStartedAtMsOf
  homeSandboxOf: HomeSandboxOf
  staleProductState: StaleProductState
}
const { runStartedAtMsOf, homeSandboxOf, staleProductState } = predicate

const dirs: string[] = []
/** A fixed instant so mtimes can be placed on either side of it without depending on wall time. */
const RUN_STARTED_AT_MS = 1_700_000_000_000
/** The predicate's documented tolerance for filesystem timestamp granularity. */
const SLACK_MS = 5000

/**
 * Create a sandbox layout holding one session file.
 * @param ageMs - how far before the run start the file's mtime sits; `null` means "just written".
 * @param name - file name inside the `sessions` root.
 * @returns the sandbox root and the file's path.
 */
function sandboxWithSessionFile(ageMs: number | null, name = 'session.jsonl'): {
  home: string
  file: string
} {
  const home = mkdtempSync(join(tmpdir(), 'sandbox-clean-state-'))
  dirs.push(home)
  const sessions = join(home, '.dsh', 'sessions')
  mkdirSync(sessions, { recursive: true })
  const file = join(sessions, name)
  writeFileSync(file, '{}\n')
  if (ageMs !== null) {
    const seconds = (RUN_STARTED_AT_MS - ageMs) / 1000
    utimesSync(file, seconds, seconds)
  }
  return { home, file }
}

beforeEach(() => {
  dirs.length = 0
})

afterEach(() => {
  while (dirs.length > 0) rmSync(dirs.pop()!, { recursive: true, force: true })
})

describe('DEBT-015: staleProductState can fail', () => {
  it('reports a session file that predates the run', () => {
    const { home, file } = sandboxWithSessionFile(60_000)
    const report = staleProductState(home, RUN_STARTED_AT_MS)
    expect(report.scannedFiles).toBe(1)
    expect(report.offenderCount).toBe(1)
    expect(report.offenders[0]).toMatchObject({ path: file, reason: 'predates-run', runStartedAtMs: RUN_STARTED_AT_MS })
  })

  it('leaves the run\'s own session file alone', () => {
    const { home } = sandboxWithSessionFile(null)
    const report = staleProductState(home, RUN_STARTED_AT_MS)
    expect(report.scannedFiles).toBe(1)
    expect(report.offenderCount).toBe(0)
  })

  it('keeps the 5s granularity slack on the boundary', () => {
    const inside = sandboxWithSessionFile(SLACK_MS)
    const outside = sandboxWithSessionFile(SLACK_MS + 1)
    expect(staleProductState(inside.home, RUN_STARTED_AT_MS).offenderCount).toBe(0)
    expect(staleProductState(outside.home, RUN_STARTED_AT_MS).offenderCount).toBe(1)
  })

  it('reports an entry it cannot stat instead of counting it as clean', () => {
    const { home } = sandboxWithSessionFile(null)
    const dangling = join(home, '.dsh', 'storages', 'gone.json')
    mkdirSync(join(home, '.dsh', 'storages'), { recursive: true })
    symlinkSync(join(home, 'does-not-exist'), dangling)
    const report = staleProductState(home, RUN_STARTED_AT_MS)
    expect(report.offenders.map(offender => offender.reason)).toEqual(['unreadable'])
  })

  it('scans the storage root as well as the session root', () => {
    const { home } = sandboxWithSessionFile(null)
    const storages = join(home, '.dsh', 'storages')
    mkdirSync(storages, { recursive: true })
    const stale = join(storages, 'state.json')
    writeFileSync(stale, '{}')
    const seconds = (RUN_STARTED_AT_MS - 120_000) / 1000
    utimesSync(stale, seconds, seconds)
    const report = staleProductState(home, RUN_STARTED_AT_MS)
    expect(report.checkedRoots).toEqual([join(home, '.dsh', 'sessions'), storages])
    expect(report.offenders.map(offender => offender.path)).toEqual([stale])
  })

  it('throws rather than scanning nothing when it is handed no sandbox home', () => {
    // The predicate's own refusal, for a caller that skipped `homeSandboxOf`: scanning no root
    // and reporting zero offenders is the answer this must never give (🟡-1).
    expect(() => staleProductState('', RUN_STARTED_AT_MS)).toThrow(/validated by homeSandboxOf/)
  })
})

describe('DEBT-015: an unusable run start is refused, never defaulted', () => {
  it('accepts a positive finite instant', () => {
    expect(runStartedAtMsOf({ runStartedAtMs: RUN_STARTED_AT_MS })).toEqual({ ok: true, value: RUN_STARTED_AT_MS })
  })

  it.each([
    ['the initialiser the plan used to carry', { runStartedAtMs: 0 }],
    ['a negative instant', { runStartedAtMs: -1 }],
    ['a string', { runStartedAtMs: '1700000000000' }],
    ['null', { runStartedAtMs: null }],
    ['NaN', { runStartedAtMs: Number.NaN }],
    ['Infinity', { runStartedAtMs: Number.POSITIVE_INFINITY }],
    ['a missing field', {}],
    ['a plan that is not an object', null],
  ])('refuses %s', (_label, plan) => {
    const verdict = runStartedAtMsOf(plan)
    expect(verdict.ok).toBe(false)
  })
})

describe('🟡-1: an unusable sandbox home is refused, never scanned as empty', () => {
  it('accepts the sandbox home the shell created', () => {
    const { home } = sandboxWithSessionFile(null)
    expect(homeSandboxOf({ homeSandbox: home })).toEqual({ ok: true, value: home })
  })

  it.each([
    ['a missing field', {}],
    ['an empty string', { homeSandbox: '' }],
    ['a path that does not exist', { homeSandbox: join(tmpdir(), 'sandbox-clean-state-absent-home') }],
    ['a relative path that resolves to nothing', { homeSandbox: 'sandbox-clean-state-absent-relative-home' }],
    ['a number', { homeSandbox: 7 }],
    ['null', { homeSandbox: null }],
    ['a plan that is not an object', null],
  ])('refuses %s', (_label, plan) => {
    expect(homeSandboxOf(plan).ok).toBe(false)
  })

  it('refuses a sandbox home that names a file rather than a directory', () => {
    const { file } = sandboxWithSessionFile(null)
    expect(homeSandboxOf({ homeSandbox: file }).ok).toBe(false)
  })

  it('refuses the empty home instead of reporting a clean sandbox', () => {
    // The expectation this replaced asserted `checkedRoots: []` and `offenderCount: 0` for a plan
    // without a sandbox home — "empty means clean" — which is the degeneration 🟡-1 names.
    const verdict = homeSandboxOf({ homeSandbox: '' })
    expect(verdict.ok).toBe(false)
    expect(verdict.value).toBe('')
  })
})
