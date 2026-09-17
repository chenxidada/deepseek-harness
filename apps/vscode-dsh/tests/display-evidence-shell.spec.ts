/**
 * DEBT-017 / AC-26(e) / AC-28 R2.3: the *consumer* half of the display-evidence contract.
 *
 * The module half is driven by `display-evidence.spec.ts`. This file exists because the defect
 * that survived four reviewer views and a whole module-level spec lived on the other side of the
 * boundary: `display_evidence_verdict` was called as `action="$(display_evidence_verdict …)"`
 * while its stdout also carried a log line, so the action word was never one word, no `case`
 * branch was reachable, and every run whose driver said PASS — the only run that can pass —
 * left as `HARNESS_ERROR`/4. The same command substitution also stranded
 * `DISPLAY_EVIDENCE_{ACTION,JSON,REASON}` inside a subshell, so the run's record carried no
 * measurement and `DISPLAY_RETRY_REQUIRED` was never set (R2.3's xvfb re-run never happened).
 *
 * These cases therefore drive the shipped shell consumer
 * (`test-scripts/layer-v-support/display-evidence-shell.sh`) with real frames, the real module,
 * and the same reporter interface `run-layer-v-smoke.sh` provides, and they pin what the caller
 * above it may rely on: every one of the four `case` branches is reachable, the action is exactly
 * one word, the verdict reaches the parent shell in variables rather than through stdout, the
 * measurement reaches the run's record, and only `retry` asks for the R2.3 replacement.
 *
 * A last case reads `run-layer-v-smoke.sh` itself: the consumer can only be safe while the caller
 * calls it directly, so a reintroduced `$( … )` around it has to fail here rather than in an
 * archived run nobody re-reads.
 */

import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

const repositoryRoot = fileURLToPath(new URL('../../..', import.meta.url))
const smokeScript = fileURLToPath(new URL('../test-scripts/run-layer-v-smoke.sh', import.meta.url))
const consumerScript = fileURLToPath(
  new URL('../test-scripts/layer-v-support/display-evidence-shell.sh', import.meta.url),
)
const evidenceModule = fileURLToPath(
  new URL('../test-scripts/layer-v-support/display-evidence.cjs', import.meta.url),
)

const require = createRequire(import.meta.url)
const { MIN_DISTINCT_MD5 } = require('../test-scripts/layer-v-support/display-evidence.cjs') as {
  MIN_DISTINCT_MD5: number
}

/** The five step slugs the smoke's link steps capture under, in order. */
const SLUGS = ['host-started', 'new-conversation', 'model-round-trip', 'approval', 'native-diff']

/** The four actions the module can hand this consumer, plus the branch it grows for anything else. */
const ACTIONS = ['pass', 'retry', 'skip', 'fail-closed']

/**
 * The smallest `run-layer-v-smoke.sh` the consumer needs: the sourcing interface its header
 * documents, the reporters it calls, and nothing else. `log` prints to stdout because the shipped
 * script's does — a consumer that writes a verdict through `log` is exactly the defect under test.
 */
const HARNESS = `#!/usr/bin/env bash
set -uo pipefail

log() { echo "$*"; }
note() { echo "$*" >>"\${NOTES_FILE}"; }
fail_harness() { echo "harness $1: $2" >>"\${FAILURES_FILE}"; }
fail_display() { echo "display $1: $2" >>"\${FAILURES_FILE}"; }

. "\${CONSUMER}"

MIN_DISTINCT_MD5=""
DISPLAY_EVIDENCE_JSON="null"
DISPLAY_EVIDENCE_ACTION=""
DISPLAY_EVIDENCE_REASON=""
DISPLAY_EVIDENCE_ATTEMPTS_JSON="[]"
if [ "\${READ_FLOOR}" = "true" ]; then
  read_display_evidence_floor
fi

: >"\${TMP_ROOT}/assert.stdout"
assert_display_evidence "\${DRIVER_CONCLUSION}" >"\${TMP_ROOT}/assert.stdout" 2>"\${TMP_ROOT}/assert.stderr"
assert_rc=$?

if [ -n "\${SECOND_MODE}" ]; then
  DISPLAY_MODE="\${SECOND_MODE}"
  DISPLAY_EVIDENCE_FORCED_XVFB="\${SECOND_FORCED}"
  DISPLAY_ATTEMPT=2
  assert_display_evidence "\${SECOND_DRIVER_CONCLUSION}" >>"\${TMP_ROOT}/assert.stdout" 2>>"\${TMP_ROOT}/assert.stderr"
fi

record="$(display_evidence_record_json)"

"\${NODE_TOOL}" -e '
  const parse = raw => { try { return JSON.parse(raw) } catch { return null } }
  const [rc, action, json, reason, retry, floor, record, stdoutBytes, failureCount, noteCount] = process.argv.slice(1)
  process.stdout.write(JSON.stringify({
    rc: Number(rc),
    action,
    evidence: parse(json),
    reason,
    retry: retry === "true",
    floor,
    record: parse(record),
    verdictStdoutBytes: Number(stdoutBytes),
    failureCount: Number(failureCount),
    noteCount: Number(noteCount),
  }) + "\\n")
' "\${assert_rc}" "\${DISPLAY_EVIDENCE_ACTION}" "\${DISPLAY_EVIDENCE_JSON}" "\${DISPLAY_EVIDENCE_REASON}" \\
  "\${DISPLAY_RETRY_REQUIRED}" "\${MIN_DISTINCT_MD5}" "\${record}" \\
  "$(wc -c <"\${TMP_ROOT}/assert.stdout")" \\
  "$(wc -l <"\${FAILURES_FILE}" 2>/dev/null || printf '0')" \\
  "$(wc -l <"\${NOTES_FILE}" 2>/dev/null || printf '0')" \\
  >"\${TMP_ROOT}/summary.json"
`

/** One measurement of what the consumer did, as the harness reports it. */
interface ConsumerSummary {
  rc: number
  action: string
  evidence: { distinctMd5?: number; frames?: number; degenerate?: boolean } | null
  reason: string
  retry: boolean
  floor: string
  record: {
    minDistinctMd5?: number | null
    distinctMd5?: number | null
    frames?: number | null
    action?: string
    reason?: string
    mode?: string
    forced?: boolean
    attemptCount?: number
    retried?: boolean
    criterion?: string
  } | null
  verdictStdoutBytes: number
  failureCount: number
  noteCount: number
}

interface ConsumerOptions {
  /** One payload per frame, in step order. */
  frames: string[]
  mode: string
  forced: boolean
  driver: string
  /** `false` leaves the floor unread, the state `assert_display_evidence` must refuse. */
  readFloor?: boolean
  /** One frame it cannot read (a directory in its place), so the measurement fails closed. */
  unreadableFrame?: number
  /** A second attempt, so the record's attempt list is exercised the way the retry loop builds it. */
  second?: { mode: string; forced: boolean; driver: string }
}

interface ConsumerOutcome {
  summary: ConsumerSummary
  stdout: string
  stderr: string
  notes: string[]
  failures: string[]
  /** What the consumer wrote while judging: the stream DEBT-017 polluted. */
  verdictStdout: string
  /** Where the module's own words land now (fd 2), so the operator still sees them. */
  verdictStderr: string
}

const dirs: string[] = []

beforeEach(() => {
  dirs.length = 0
})

afterEach(() => {
  while (dirs.length > 0) {
    const dir = dirs.pop()
    if (dir !== undefined) rmSync(dir, { recursive: true, force: true })
  }
})

/**
 * Run the consumer once, in a harness that provides the interface its header lists.
 * @param options - the frames, the display the attempt used, and the driver's conclusion.
 * @returns everything the consumer produced, so a case can assert on either side of the contract.
 */
function runConsumer(options: ConsumerOptions): ConsumerOutcome {
  const runDir = mkdtempSync(join(tmpdir(), 'layer-v-display-evidence-shell-'))
  dirs.push(runDir)
  const harness = join(runDir, 'harness.sh')
  writeFileSync(harness, HARNESS)
  const artifactDir = join(runDir, 'artifacts')
  const tmpRoot = join(runDir, 'tmp')
  mkdirSync(artifactDir, { recursive: true })
  mkdirSync(tmpRoot, { recursive: true })
  SLUGS.forEach((slug, index) => {
    const frame = join(artifactDir, `step-${index + 1}-${slug}.png`)
    if (options.unreadableFrame === index + 1) {
      mkdirSync(frame)
      return
    }
    writeFileSync(frame, options.frames[index] ?? '')
  })
  const notesFile = join(runDir, 'notes.txt')
  const failuresFile = join(runDir, 'failures.txt')
  writeFileSync(notesFile, '')
  writeFileSync(failuresFile, '')

  const result = spawnSync('bash', [harness], {
    cwd: repositoryRoot,
    encoding: 'utf8',
    env: {
      ...process.env,
      CONSUMER: consumerScript,
      NODE_TOOL: process.execPath,
      DISPLAY_EVIDENCE_MODULE: evidenceModule,
      ARTIFACT_DIR: artifactDir,
      TMP_ROOT: tmpRoot,
      NOTES_FILE: notesFile,
      FAILURES_FILE: failuresFile,
      DISPLAY_MODE: options.mode,
      DISPLAY_EVIDENCE_FORCED_XVFB: String(options.forced),
      DISPLAY_ATTEMPT: '1',
      DRIVER_CONCLUSION: options.driver,
      READ_FLOOR: String(options.readFloor ?? true),
      SECOND_MODE: options.second?.mode ?? '',
      SECOND_FORCED: String(options.second?.forced ?? false),
      SECOND_DRIVER_CONCLUSION: options.second?.driver ?? '',
    },
  })
  expect(result.error).toBeUndefined()
  expect(result.status, `${result.stdout}${result.stderr}`).toBe(0)

  const readLines = (path: string): string[] => {
    const text = readFileSync(path, 'utf8')
    return text === '' ? [] : text.split('\n').filter(line => line !== '')
  }
  const summary = JSON.parse(readFileSync(join(tmpRoot, 'summary.json'), 'utf8')) as ConsumerSummary
  return {
    summary,
    stdout: result.stdout,
    stderr: result.stderr,
    notes: readLines(notesFile),
    failures: readLines(failuresFile),
    verdictStdout: readFileSync(join(tmpRoot, 'assert.stdout'), 'utf8'),
    verdictStderr: readFileSync(join(tmpRoot, 'assert.stderr'), 'utf8'),
  }
}

describe('the shell consumer of the display-evidence verdict (DEBT-017)', () => {
  it('lets a healthy attempt stand, with the action as exactly one word', () => {
    const outcome = runConsumer({
      frames: ['a', 'b', 'c', 'd', 'e'],
      mode: 'reuse',
      forced: false,
      driver: 'PASS',
    })
    const { summary } = outcome
    expect(ACTIONS).toContain(summary.action)
    expect(summary.action).toBe('pass')
    expect(summary.evidence?.distinctMd5).toBe(5)
    expect(summary.retry).toBe(false)
    expect(summary.rc).toBe(0)
    expect(outcome.failures).toEqual([])
    expect(outcome.notes.join('\n')).toContain('display-evidence: accepted — AC-26(e) satisfied (distinct md5 = 5/5')
    // The stream that used to carry the log line spliced into the action word.
    expect(outcome.verdictStdout).toBe('')
  })

  it('re-runs the link on an owned display when a reused one produced degenerate frames (R2.3)', () => {
    const outcome = runConsumer({
      // Four identical frames and a different fifth: the shape the raised floor rejects, and a
      // real one (archived reuse run 20260916T170431Z-2270421 had exactly two distinct frames).
      frames: ['same', 'same', 'same', 'same', 'different'],
      mode: 'reuse',
      forced: false,
      driver: 'PASS',
    })
    const { summary } = outcome
    expect(summary.action).toBe('retry')
    // The precondition itself: without this variable `main` never replaces the attempt.
    expect(summary.retry).toBe(true)
    expect(summary.rc).toBe(0)
    expect(outcome.failures).toEqual([])
    // The consumer's own announcement may reach stdout (the caller invokes it directly and never
    // captures it), but the *module's* report must not: pre-fix that report was written through
    // `log` and became the first line of the value the caller captured as the action.
    expect(outcome.verdictStdout).toContain('display-evidence: the reused display produced degenerate evidence')
    expect(outcome.verdictStdout).not.toContain('[layer-v] display evidence (')
    expect(outcome.verdictStderr).toContain('[layer-v] display evidence (reuse forced=false):')
    expect(outcome.verdictStdout).toContain('retrying on an owned display (AC-28 R2.3)')
    expect(`${outcome.verdictStdout}${outcome.verdictStderr}`).toContain('distinct md5 = 2/5')
  })

  it('cannot replace the attempt twice: a degenerate owned display is a non-PASS, not another retry', () => {
    const owned = runConsumer({
      frames: ['same', 'same', 'same', 'same', 'different'],
      mode: 'xvfb',
      forced: false,
      driver: 'PASS',
    })
    expect(owned.summary.action).toBe('skip')
    expect(owned.summary.retry).toBe(false)
    expect(owned.failures.join('\n')).toContain('AC-28 R2.3 / AC-26(e)')
    expect(owned.verdictStdout).toBe('')

    const replaced = runConsumer({
      frames: ['same', 'same', 'same', 'same', 'different'],
      mode: 'reuse',
      forced: true,
      driver: 'PASS',
    })
    expect(replaced.summary.action).toBe('skip')
    expect(replaced.summary.retry).toBe(false)
    expect(replaced.failures.join('\n')).toContain('the xvfb attempt of this run also produced frames below the floor')
  })

  it('refuses rather than guesses when the frames or the display mode cannot be judged', () => {
    const outcome = runConsumer({
      frames: ['same', 'same', 'same', 'same', 'different'],
      mode: 'wayland',
      forced: false,
      driver: 'PASS',
    })
    expect(outcome.summary.action).toBe('fail-closed')
    expect(outcome.summary.retry).toBe(false)
    expect(outcome.failures.join('\n')).toContain("action 'fail-closed'")
    expect(outcome.verdictStdout).toBe('')

    const unmeasurable = runConsumer({
      frames: ['a', 'b', 'c', 'd', 'e'],
      mode: 'reuse',
      forced: false,
      driver: 'PASS',
      unreadableFrame: 3,
    })
    expect(unmeasurable.summary.rc).toBe(0)
    expect(unmeasurable.summary.action).toBe('fail-closed')
    expect(unmeasurable.failures.join('\n')).toContain("action 'fail-closed'")
    expect(unmeasurable.failures.join('\n')).toContain('step-3-model-round-trip.png')
    expect(unmeasurable.verdictStdout).toBe('')
  })
})

describe('the bookkeeping the consumer owes the run (AC-26(e))', () => {
  it('reports this attempt’s verdict through the variables the caller reads', () => {
    const outcome = runConsumer({
      frames: ['same', 'same', 'same', 'same', 'different'],
      mode: 'reuse',
      forced: false,
      driver: 'PASS',
    })
    // Pre-fix these were assigned inside a `$( … )` subshell, so the parent shell kept its
    // initial values: the record said `distinctMd5: null, action: null, reason: ""`.
    expect(outcome.summary.action).toBe('retry')
    expect(outcome.summary.floor).toBe(String(MIN_DISTINCT_MD5))
    expect(outcome.summary.evidence?.frames).toBe(5)
    expect(outcome.summary.evidence?.distinctMd5).toBe(2)
    expect(outcome.summary.reason).toContain('AC-28 R2.3 requires the xvfb display')
  })

  it('carries the measurement into the run’s record instead of nulls', () => {
    const outcome = runConsumer({
      frames: ['same', 'same', 'same', 'same', 'different'],
      mode: 'reuse',
      forced: false,
      driver: 'PASS',
    })
    const record = outcome.summary.record
    expect(record?.criterion).toContain('AC-26(e)')
    expect(record?.minDistinctMd5).toBe(MIN_DISTINCT_MD5)
    expect(record?.distinctMd5).toBe(2)
    expect(record?.frames).toBe(5)
    expect(record?.action).toBe('retry')
    expect(record?.reason).not.toBe('')
    expect(record?.mode).toBe('reuse')
    expect(record?.forced).toBe(false)
    expect(record?.attemptCount).toBe(1)
    expect(record?.retried).toBe(false)
  })

  it('keeps both attempts when R2.3 replaced the first one', () => {
    const outcome = runConsumer({
      frames: ['same', 'same', 'same', 'same', 'different'],
      mode: 'reuse',
      forced: false,
      driver: 'PASS',
      second: { mode: 'xvfb', forced: true, driver: 'PASS' },
    })
    expect(outcome.summary.record?.attemptCount).toBe(2)
    expect(outcome.summary.record?.retried).toBe(true)
    // The attempt that governs the verdict is the last one measured, not the discarded first.
    expect(outcome.summary.record?.mode).toBe('xvfb')
    expect(outcome.summary.record?.forced).toBe(true)
    expect(outcome.summary.record?.action).toBe('skip')
  })

  it('records the measurement of a run that reached another conclusion without changing it', () => {
    const outcome = runConsumer({
      frames: ['same', 'same', 'same', 'same', 'different'],
      mode: 'reuse',
      forced: false,
      driver: 'LINK_FAILURE',
    })
    // One-way rule: rewriting a LINK_FAILURE as a harness error would hide the product finding
    // the run was about, so the measurement is recorded and the conclusion is kept.
    expect(outcome.summary.action).toBe('retry')
    expect(outcome.summary.retry).toBe(false)
    expect(outcome.failures).toEqual([])
    expect(outcome.notes.join('\n')).toContain('the driver concluded LINK_FAILURE')
    expect(outcome.notes.join('\n')).toContain('distinct md5 = 2/5')
    expect(outcome.notes.join('\n')).not.toContain('the module stated no reason')
  })

  it('refuses when the floor was never read from the module', () => {
    const outcome = runConsumer({
      frames: ['a', 'b', 'c', 'd', 'e'],
      mode: 'reuse',
      forced: false,
      driver: 'PASS',
      readFloor: false,
    })
    expect(outcome.summary.floor).toBe('')
    expect(outcome.failures.join('\n')).toContain('the distinct-frame floor was never read from the module')
  })
})

describe('the caller may not re-create the defect (DEBT-017)', () => {
  const source = readFileSync(smokeScript, 'utf8')
  const lines = source.split('\n')

  it('sources the consumer and calls it directly rather than through a command substitution', () => {
    expect(lines.some(line => line.trim() === '. "${DISPLAY_EVIDENCE_CONSUMER}"')).toBe(true)
    expect(lines.some(line => line.trim() === 'assert_display_evidence "${driver_conclusion}"')).toBe(true)
    const captured = lines.filter(line => /\([^)]*(display_evidence_verdict|assert_display_evidence)/.test(line))
    expect(captured).toEqual([])
  })

  it('reads the retry request and gives R2.3 exactly one replacement attempt', () => {
    expect(lines.some(line => line.trim() === 'if [ "${DISPLAY_RETRY_REQUIRED}" = "true" ]; then')).toBe(true)
    expect(lines.some(line => line.trim() === 'DISPLAY_ATTEMPT="$((${DISPLAY_ATTEMPT} + 1))"')).toBe(true)
    expect(lines.some(line => line.trim() === 'if [ "${DISPLAY_ATTEMPT}" -ge 2 ]; then')).toBe(true)
  })
})
