import { foldMessages, foldTimeline } from './spike-t0a-replay-hydrator.ts'
import { SpikeMockAdapter, prefixUnchanged, textResponse } from './spike-t0b-continue-helpers.ts'
import { activate, deactivate } from '../src/extension.ts'
import { Context } from '@deepseek-ai/cordis'
import AgentRegistry, { type Agent } from '@deepseek-ai/dsh-agent'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import LlmRuntime, { MessageId, ToolCallId, createToolResultMessage, createUserMessage, freezeMessage } from '@deepseek-ai/dsh-llm'
import SessionStore, { SESSION_FORMAT_VERSION, type SessionEvent, type SessionHeader, SessionId, SessionSeq } from '@deepseek-ai/dsh-session'
import { SessionAlreadyExistsError, type SessionPersistence } from '@deepseek-ai/dsh-session-persistence'
import JsonlSessionPersistence from '@deepseek-ai/dsh-session-persistence-jsonl'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import { readColdSessionLog } from '@deepseek-ai/dsh-session-query'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import { spawnSync } from 'node:child_process'
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, utimesSync, writeFileSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

describe('cap:test-harness — test scripts, drivers, and capability runner', () => {
  describe('artifact-index.spec.ts', () => {
    interface RowOutcome {
      indexPath?: string
      appended: boolean
      row: string
      indexMissing?: boolean
      writeFailed?: boolean
      error?: string
      placeholderReplaced?: boolean
      rowOccurrences?: number
      rowLine?: number | null
      rowInFirstTableBlock?: boolean | null
      headerRowsBeforeRow?: number | null
    }

    type PlanRowWrite = (indexText: string, row: string) => RowOutcome & { next: string }
    type ApplyRowWrite = (indexPath: string, row: string) => RowOutcome
    type DescribeProblem = (outcome: RowOutcome) => string | null

    const require = createRequire(import.meta.url)
    const { planRowWrite, inspectRow, applyRowWrite, describeProblem } = require(
      '../test-scripts/layer-v-support/artifact-index.cjs',
    ) as {
      planRowWrite: PlanRowWrite
      inspectRow: (indexText: string, row: string) => RowOutcome
      applyRowWrite: ApplyRowWrite
      describeProblem: DescribeProblem
    }

    const dirs: string[] = []

    /** The index's real header, table header and separator, so the fixtures are shaped like the artifact. */
    const INDEX_HEAD = [
      '# Layer-V smoke — artifact index',
      '',
      'Run outputs live under `apps/vscode-dsh/test-artifacts/layer-v/`, which is git-ignored.',
      '',
      '## Runs',
      '',
      '| run (UTC) | artifact dir | conclusion | exit | step → files |',
      '|---|---|---|---|---|',
    ]

    /** A row in the shape the smoke script writes. */
    function row(at: string, conclusion = 'PASS', exitCode = 0): string {
      return `| ${at} | \`apps/vscode-dsh/test-artifacts/layer-v/\` | ${conclusion} | ${exitCode} | step-1→step-1-host-started.png |`
    }

    /** An index holding one previous run, with no prose after the table. */
    function indexWithOneRun(): string {
      return [...INDEX_HEAD, row('2026-09-16T11:35:39.060Z')].join('\n') + '\n'
    }

    /** Write `text` to a fresh file and return its path. */
    function writeIndex(text: string): string {
      const dir = mkdtempSync(join(tmpdir(), 'artifact-index-'))
      dirs.push(dir)
      const file = join(dir, 'artifact-index.md')
      writeFileSync(file, text)
      return file
    }

    beforeEach(() => {
      dirs.length = 0
    })

    afterEach(() => {
      while (dirs.length > 0) rmSync(dirs.pop()!, { recursive: true, force: true })
    })

    describe('a correct row is accepted', () => {
      it('CAP-TEST-HARNESS-001 splices the row after the last run and reports where it landed', () => {
        const file = writeIndex(indexWithOneRun())
        const outcome = applyRowWrite(file, row('2026-09-17T01:00:00.000Z'))
        expect(describeProblem(outcome)).toBeNull()
        expect(outcome.rowOccurrences).toBe(1)
        expect(outcome.rowInFirstTableBlock).toBe(true)
        expect(outcome.headerRowsBeforeRow).toBe(1)
        const lines = readFileSync(file, 'utf8').split('\n')
        expect(lines[outcome.rowLine! - 1]).toBe(row('2026-09-17T01:00:00.000Z'))
      })

      it('CAP-TEST-HARNESS-002 replaces the empty-table placeholder rather than appending a second table', () => {
        const text = [...INDEX_HEAD, '| _(no runs yet)_ | | | | |', ''].join('\n')
        const planned = planRowWrite(text, row('2026-09-17T01:00:00.000Z'))
        expect(planned.placeholderReplaced).toBe(true)
        expect(planned.next).not.toContain('_(no runs yet)_')
        expect(planned.rowOccurrences).toBe(1)
        expect(planned.headerRowsBeforeRow).toBe(1)
      })

      it('CAP-TEST-HARNESS-003 splices into the first table block when the index has prose between two blocks', () => {
        // The historical defect: prose used to sit inside the table, so a writer anchored on the last
        // `|` line extended the second block — a table with no header.
        const text = [
          ...INDEX_HEAD,
          row('2026-09-16T11:35:39.060Z'),
          '',
          'Some prose about the runs above.',
          '',
          '| run (UTC) | artifact dir | conclusion | exit | step → files |',
          '|---|---|---|---|---|',
          row('2026-09-16T11:43:55.395Z'),
          '',
        ].join('\n')
        const planned = planRowWrite(text, row('2026-09-17T01:00:00.000Z'))
        const lines = planned.next.split('\n')
        const spliced = lines.indexOf(row('2026-09-17T01:00:00.000Z'))
        const proseAt = lines.indexOf('Some prose about the runs above.')
        expect(spliced).toBeGreaterThan(0)
        expect(spliced).toBeLessThan(proseAt)
        expect(planned.rowInFirstTableBlock).toBe(true)
        // The document already had two headers before the new row; that is the index's business, not
        // this write's, and the row must still land in the first block rather than after the second.
        expect(planned.headerRowsBeforeRow).toBe(1)
      })
    })

    describe('a wrong row is refused', () => {
      it('CAP-TEST-HARNESS-004 refuses a missing index', () => {
        const dir = mkdtempSync(join(tmpdir(), 'artifact-index-'))
        dirs.push(dir)
        const outcome = applyRowWrite(join(dir, 'nope.md'), row('2026-09-17T01:00:00.000Z'))
        expect(outcome.indexMissing).toBe(true)
        expect(describeProblem(outcome)).toContain('does not exist')
      })

      it('CAP-TEST-HARNESS-005 refuses an index it cannot write, instead of reporting a row', () => {
        const dir = mkdtempSync(join(tmpdir(), 'artifact-index-'))
        dirs.push(dir)
        const outcome = applyRowWrite(dir, row('2026-09-17T01:00:00.000Z'))
        expect(outcome.writeFailed).toBe(true)
        expect(describeProblem(outcome)).toContain('could not be written')
      })

      it('CAP-TEST-HARNESS-006 refuses a document where the row would appear twice', () => {
        const duplicate = row('2026-09-16T11:35:39.060Z')
        const text = [...INDEX_HEAD, duplicate].join('\n') + '\n'
        const outcome = { ...applyRowWrite(writeIndex(text), duplicate) }
        expect(outcome.rowOccurrences).toBe(2)
        expect(describeProblem(outcome)).toContain('2 times, not once')
      })

      it('CAP-TEST-HARNESS-007 refuses a document with no run table, where the row would render without a header', () => {
        const file = writeIndex('# Layer-V smoke — artifact index\n\nNo table here yet.\n')
        const outcome = applyRowWrite(file, row('2026-09-17T01:00:00.000Z'))
        expect(outcome.headerRowsBeforeRow).toBe(0)
        expect(describeProblem(outcome)).toContain('renders as 0 run tables')
      })

      it('CAP-TEST-HARNESS-008 refuses a row that landed outside the first table block', () => {
        const text = [...INDEX_HEAD, row('2026-09-16T11:35:39.060Z'), ''].join('\n') + '\n'
        const stray = row('2026-09-17T01:00:00.000Z')
        // A row after the blank line that closed the block: what a hand edit, or a second writer whose
        // anchor was not the block, leaves behind.
        const outcome = inspectRow(`${text}\n${stray}\n`, stray)
        expect(outcome.rowInFirstTableBlock).toBe(false)
        expect(describeProblem({ ...outcome, appended: true, row: stray })).toContain('did not land inside')
      })

      it('CAP-TEST-HARNESS-009 reports an unreadable verdict rather than passing it', () => {
        expect(describeProblem(undefined as unknown as RowOutcome)).toBe('the index write verdict was unreadable')
      })
    })

    describe('the permission-denied path is refused too', () => {
      it('CAP-TEST-HARNESS-010 refuses a read-only directory', () => {
        const dir = mkdtempSync(join(tmpdir(), 'artifact-index-'))
        dirs.push(dir)
        const file = join(dir, 'artifact-index.md')
        writeFileSync(file, indexWithOneRun())
        chmodSync(dir, 0o555)
        try {
          const outcome = applyRowWrite(file, row('2026-09-17T01:00:00.000Z'))
          // Root ignores the permission bits; the case still asserts the shape of the refusal when the
          // platform actually refuses, and that a successful write leaves no problem behind when it does not.
          if (outcome.writeFailed === true) {
            expect(describeProblem(outcome)).toContain('could not be written')
            expect(readFileSync(file, 'utf8')).toBe(indexWithOneRun())
          } else {
            expect(describeProblem(outcome)).toBeNull()
          }
        } finally {
          chmodSync(dir, 0o755)
        }
      })
    })

    describe('a row already inside the block is still counted once', () => {
      it('CAP-TEST-HARNESS-011 counts one occurrence when the same row text appears once', () => {
        const single = row('2026-09-17T01:00:00.000Z')
        const outcome = inspectRow([...INDEX_HEAD, single, ''].join('\n'), single)
        expect(outcome.rowOccurrences).toBe(1)
        expect(outcome.rowLine).toBe(INDEX_HEAD.length + 1)
      })
    })
  })

  describe('display-evidence.spec.ts', () => {
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
      it('CAP-TEST-HARNESS-012 counts the frames of a run whose steps all show the same screen', () => {
        writeFrames(Array.from({ length: 5 }, () => 'one-and-the-same-png'))
        const measurement = measureFrames(artifactDir)
        expect(measurement.ok).toBe(true)
        expect(measurement.frames).toBe(5)
        expect(measurement.distinctMd5).toBe(1)
        expect(measurement.degenerate).toBe(true)
        expect(Object.keys(measurement.md5 ?? {})).toHaveLength(5)
      })

      it('CAP-TEST-HARNESS-013 accepts five distinct frames', () => {
        writeFrames(['a', 'b', 'c', 'd', 'e'])
        const measurement = measureFrames(artifactDir)
        expect(measurement.distinctMd5).toBe(5)
        expect(measurement.degenerate).toBe(false)
      })

      it(`CAP-TEST-HARNESS-014 accepts exactly the adjudicated floor of ${MIN_DISTINCT_MD5} distinct frames`, () => {
        // The floor is a user adjudication (`scope-amendment-02.md` §8.1 item 6), so the number a run
        // is judged against is pinned here: a silent change to it has to break this test, not just
        // move the boundary. Three distinct frames among five is the smallest accepted shape.
        expect(MIN_DISTINCT_MD5).toBe(3)
        writeFrames(['same', 'same', 'same', 'second', 'third'])
        const measurement = measureFrames(artifactDir)
        expect(measurement.distinctMd5).toBe(MIN_DISTINCT_MD5)
        expect(measurement.degenerate).toBe(false)
      })

      it(`CAP-TEST-HARNESS-015 treats ${MIN_DISTINCT_MD5 - 1} distinct frames as degenerate`, () => {
        // The shape the floor was raised to reject, and a real one: the archived reuse run
        // `20260916T170431Z-2270421` is four byte-identical frames and a different fifth. Under the
        // old floor of two this passed; under the adjudicated floor it is a run to be replaced.
        writeFrames(['same', 'same', 'same', 'same', 'different'])
        const measurement = measureFrames(artifactDir)
        expect(measurement.distinctMd5).toBe(MIN_DISTINCT_MD5 - 1)
        expect(measurement.degenerate).toBe(true)
      })

      it('CAP-TEST-HARNESS-016 refuses a run that did not produce five frames', () => {
        writeFrames(['a', 'b', 'c', 'd', null])
        const measurement = measureFrames(artifactDir)
        expect(measurement.ok).toBe(false)
        expect(measurement.frames).toBe(4)
        expect(measurement.problem).toContain('not the 5')
      })

      it('CAP-TEST-HARNESS-017 ignores files that are not one of the link steps frames', () => {
        writeFrames(['a', 'b', 'c', 'd', 'e'])
        writeFileSync(join(artifactDir, 'step-6-host-started.png'), 'stray')
        writeFileSync(join(artifactDir, 'notes.txt'), 'stray')
        const measurement = measureFrames(artifactDir)
        expect(measurement.ok).toBe(true)
        expect(measurement.frames).toBe(5)
        expect(measurement.distinctMd5).toBe(5)
      })

      it('CAP-TEST-HARNESS-018 refuses five frames that do not number the link steps once each', () => {
        writeFrames(['a', 'b', 'c', 'd', 'e'])
        rmSync(join(artifactDir, 'step-4-approval.png'))
        writeFileSync(join(artifactDir, 'step-3-approval.png'), 'a-second-step-3')
        const measurement = measureFrames(artifactDir)
        expect(measurement.ok).toBe(false)
        expect(measurement.frames).toBe(5)
        expect(measurement.problem).toContain('numbered 1,2,3,3,5')
      })

      it('CAP-TEST-HARNESS-019 refuses to treat an unreadable frame as evidence', () => {
        writeFrames(['a', 'b', 'c', 'd', 'e'])
        // A directory named like a frame is the cheapest unreadable frame there is.
        rmSync(join(artifactDir, 'step-3-model-round-trip.png'))
        mkdirSync(join(artifactDir, 'step-3-model-round-trip.png'))
        const measurement = measureFrames(artifactDir)
        expect(measurement.ok).toBe(false)
        expect(measurement.problem).toContain('step-3-model-round-trip.png')
      })

      it('CAP-TEST-HARNESS-020 reports a directory it cannot list instead of claiming an empty measurement', () => {
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

      it('CAP-TEST-HARNESS-021 re-runs under xvfb when a reused display produced identical frames', () => {
        expect(judgeEvidence(degenerate, { mode: 'reuse', forced: false }).action).toBe('retry')
      })

      it('CAP-TEST-HARNESS-022 re-runs the shape the raised floor no longer accepts', () => {
        expect(judgeEvidence(previouslyAcceptable, { mode: 'reuse', forced: false }).action).toBe('retry')
      })

      it('CAP-TEST-HARNESS-023 does not re-run twice: a degenerate xvfb attempt cannot retry again', () => {
        expect(judgeEvidence(degenerate, { mode: 'reuse', forced: true }).action).toBe('skip')
        expect(judgeEvidence(degenerate, { mode: 'xvfb', forced: false }).action).toBe('skip')
      })

      it('CAP-TEST-HARNESS-024 lets a healthy run through on either display', () => {
        expect(judgeEvidence(healthy, { mode: 'reuse', forced: false }).action).toBe('pass')
        expect(judgeEvidence(healthy, { mode: 'xvfb', forced: false }).action).toBe('pass')
      })

      it('CAP-TEST-HARNESS-025 refuses to judge evidence it could not measure', () => {
        const verdict = judgeEvidence(unmeasurable, { mode: 'reuse', forced: false })
        expect(verdict.action).toBe('fail-closed')
        expect(verdict.reason).toContain('4 step frame(s)')
      })

      it('CAP-TEST-HARNESS-026 refuses a degenerate run whose display mode it does not recognise', () => {
        expect(judgeEvidence(degenerate, { mode: '', forced: false }).action).toBe('fail-closed')
        expect(judgeEvidence(degenerate, { mode: 'wayland', forced: false }).action).toBe('fail-closed')
      })

      it('CAP-TEST-HARNESS-027 names the observed count in every reason it gives', () => {
        for (const context of [{ mode: 'reuse', forced: false }, { mode: 'xvfb', forced: false }]) {
          expect(judgeEvidence(degenerate, context).reason).toContain('distinct md5 = 1/5')
        }
        expect(judgeEvidence(healthy, { mode: 'reuse', forced: false }).reason).toContain('distinct md5 = 3/5')
      })
    })
  })

  describe('display-evidence-shell.spec.ts', () => {
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

    describe('the shell consumer of the display-evidence verdict', () => {
      it('CAP-TEST-HARNESS-028 lets a healthy attempt stand, with the action as exactly one word', () => {
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
        expect(outcome.notes.join('\n')).toContain('display-evidence: accepted')
        expect(outcome.notes.join('\n')).toContain('satisfied (distinct md5 = 5/5')
        // The stream that used to carry the log line spliced into the action word.
        expect(outcome.verdictStdout).toBe('')
      })

      it('CAP-TEST-HARNESS-029 re-runs the link on an owned display when a reused one produced degenerate frames (R2.3)', () => {
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
        expect(outcome.verdictStdout).toContain('retrying on an owned display')
        expect(`${outcome.verdictStdout}${outcome.verdictStderr}`).toContain('distinct md5 = 2/5')
      })

      it('CAP-TEST-HARNESS-030 cannot replace the attempt twice: a degenerate owned display is a non-PASS, not another retry', () => {
        const owned = runConsumer({
          frames: ['same', 'same', 'same', 'same', 'different'],
          mode: 'xvfb',
          forced: false,
          driver: 'PASS',
        })
        expect(owned.summary.action).toBe('skip')
        expect(owned.summary.retry).toBe(false)
        expect(owned.failures.join('\n')).toContain('every display this run could use produced degenerate frames')
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

      it('CAP-TEST-HARNESS-031 refuses rather than guesses when the frames or the display mode cannot be judged', () => {
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

    describe('the bookkeeping the consumer owes the run', () => {
      it('CAP-TEST-HARNESS-032 reports this attempt’s verdict through the variables the caller reads', () => {
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
        expect(outcome.summary.reason).toContain('requires the xvfb display instead')
      })

      it('CAP-TEST-HARNESS-033 carries the measurement into the run’s record instead of nulls', () => {
        const outcome = runConsumer({
          frames: ['same', 'same', 'same', 'same', 'different'],
          mode: 'reuse',
          forced: false,
          driver: 'PASS',
        })
        const record = outcome.summary.record
        expect(record?.criterion).toContain('the five step frames of one run must not all share one md5')
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

      it('CAP-TEST-HARNESS-034 keeps both attempts when R2.3 replaced the first one', () => {
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

      it('CAP-TEST-HARNESS-035 records the measurement of a run that reached another conclusion without changing it', () => {
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

      it('CAP-TEST-HARNESS-036 refuses when the floor was never read from the module', () => {
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

    describe('the caller may not re-create the defect', () => {
      const source = readFileSync(smokeScript, 'utf8')
      const lines = source.split('\n')

      it('CAP-TEST-HARNESS-037 sources the consumer and calls it directly rather than through a command substitution', () => {
        expect(lines.some(line => line.trim() === '. "${DISPLAY_EVIDENCE_CONSUMER}"')).toBe(true)
        expect(lines.some(line => line.trim() === 'assert_display_evidence "${driver_conclusion}"')).toBe(true)
        const captured = lines.filter(line => /\([^)]*(display_evidence_verdict|assert_display_evidence)/.test(line))
        expect(captured).toEqual([])
      })

      it('CAP-TEST-HARNESS-038 reads the retry request and gives R2.3 exactly one replacement attempt', () => {
        expect(lines.some(line => line.trim() === 'if [ "${DISPLAY_RETRY_REQUIRED}" = "true" ]; then')).toBe(true)
        expect(lines.some(line => line.trim() === 'DISPLAY_ATTEMPT="$((${DISPLAY_ATTEMPT} + 1))"')).toBe(true)
        expect(lines.some(line => line.trim() === 'if [ "${DISPLAY_ATTEMPT}" -ge 2 ]; then')).toBe(true)
      })
    })
  })

  describe('build-freshness.spec.ts', () => {
    interface SiblingVerdict {
      root: string
      ok: boolean
      reason: string | null
      detail: string
      artifactCount: number
      sourceCount: number
    }

    /** Shape of the verdict the module returns. */
    interface FreshnessVerdict {
      ok: boolean
      reason: string | null
      detail: string
      artifactCount: number
      artifactNewest: { path: string; mtimeMs: number } | null
      entryExists: boolean
      sourceCount: number
      sourceNewest: { path: string; mtimeMs: number } | null
      staleArtifacts: number
      siblings?: {
        compared: number
        failed: number
        artifactCount: number
        sourceCount: number
        failures: SiblingVerdict[]
      }
    }

    type Evaluate = (options: {
      artifactRoot: string
      entry: string
      sourceRoots: string[]
      siblingRoots?: string[]
    }) => FreshnessVerdict

    const require = createRequire(import.meta.url)
    const { evaluateBuildFreshness } = require('../test-scripts/layer-v-support/build-freshness.cjs') as {
      evaluateBuildFreshness: Evaluate
    }

    const repositoryRoot = fileURLToPath(new URL('../../..', import.meta.url))
    /** The script that feeds the comparison, read so the two halves cannot drift apart. */
    const smokeScript = readFileSync(
      fileURLToPath(new URL('../test-scripts/run-layer-v-smoke.sh', import.meta.url)),
      'utf8',
    )
    /** The build's own declaration of what it publishes, read rather than restated. */
    const tsdownConfig = readFileSync(join(repositoryRoot, 'tsdown.config.ts'), 'utf8')
    /** The globs `assert_build_freshness` expands into `--sibling` roots. */
    const COMPARED_GLOBS = ['vendor/*', 'packages/*/*']
    /** Members of the tsdown list that are not compared through those globs: the app half, and `apps/cli`. */
    const OUTSIDE_THE_GLOBS = ['apps/vscode-dsh', 'apps/cli']

    const dirs: string[] = []
    /** A fixed instant; the fixtures place both sides of the comparison relative to it. */
    const BUILT_AT_MS = 1_700_000_000_000
    /** One hour, in milliseconds. */
    const HOUR_MS = 3_600_000

    /**
 * Walk the tsdown `workspace` list: the members `build:lib:host` publishes `<root>/lib` for.
 * @returns the member paths, repository-relative, as the config spells them.
 */
    function tsdownWorkspaceMembers(): string[] {
      const list = /workspace:\s*\[([^\]]*)\]/.exec(tsdownConfig)
      if (list === null) throw new Error('tsdown.config.ts no longer declares a `workspace` array; this probe must be updated')
      return [...list[1]!.matchAll(/['"]([^'"]+)['"]/g)].map(match => match[1]!)
    }

    /**
 * Does a one-segment-wildcard glob cover a path? (`packages/* *` and `vendor/*` are the two shapes
 * the smoke script expands; both wildcards stand for exactly one path segment.)
 * @param pattern - the glob, as written in the smoke script.
 * @param member - the repository-relative path to test.
 * @returns true when the glob matches the whole path.
 */
    function matchesSingleSegmentGlob(pattern: string, member: string): boolean {
      const globParts = pattern.split('/')
      const memberParts = member.split('/')
      if (globParts.length !== memberParts.length) return false
      return globParts.every((part, index) => part === '*' || part === memberParts[index])
    }

    /**
 * Build an app-shaped tree: `src/**` sources and a `lib/**` bundle with an entry.
 * @param options - how far each side sits from {@link BUILT_AT_MS}.
 * @returns absolute paths into the temporary tree.
 */
    function appTree(options: { sourceAgeMs?: number; artifactAgeMs?: number; entry?: boolean; sources?: boolean; artifacts?: boolean }): {
      root: string
      artifactRoot: string
      entry: string
      sourceRoots: string[]
    } {
      const root = mkdtempSync(join(tmpdir(), 'build-freshness-'))
      dirs.push(root)
      const artifactRoot = join(root, 'lib')
      const sourceRoot = join(root, 'src')
      const entry = join(artifactRoot, 'extension.js')
      const sourceAgeMs = options.sourceAgeMs ?? 2 * HOUR_MS
      const artifactAgeMs = options.artifactAgeMs ?? HOUR_MS

      if (options.artifacts !== false) {
        mkdirSync(artifactRoot, { recursive: true })
        writeFileSync(join(artifactRoot, 'extension-chunk.js'), '// chunk\n')
        // Shaped like the real entry (`tsdown` emits a thin re-export whose specifier carries the
        // chunk hash), so the entry-completeness check is exercised by every case below.
        writeFileSync(entry, 'export { activate } from "./extension-chunk.js"\n')
        setAge(join(artifactRoot, 'extension-chunk.js'), artifactAgeMs)
        setAge(entry, artifactAgeMs)
      }
      if (options.sources !== false) {
        mkdirSync(join(sourceRoot, 'nested'), { recursive: true })
        writeFileSync(join(sourceRoot, 'extension.ts'), 'export {}\n')
        writeFileSync(join(sourceRoot, 'nested', 'session-host.ts'), 'export {}\n')
        setAge(join(sourceRoot, 'extension.ts'), sourceAgeMs)
        setAge(join(sourceRoot, 'nested', 'session-host.ts'), sourceAgeMs)
      }
      if (options.entry === false) rmSync(entry, { force: true })
      return { root, artifactRoot, entry, sourceRoots: [sourceRoot] }
    }

    /**
 * Place a file's mtime `ageMs` before {@link BUILT_AT_MS}.
 * @param file - path to touch.
 * @param ageMs - how old the file should look.
 */
    function setAge(file: string, ageMs: number): void {
      const seconds = (BUILT_AT_MS - ageMs) / 1000
      utimesSync(file, seconds, seconds)
    }

    /**
 * A workspace member's tree. It has the same `lib`/`src` shape the app does — that uniformity is
 * what lets `evaluateSiblingFreshness` be one pair of rules rather than one per package — so the
 * app fixture serves as the member fixture and the two halves are compared by the same code.
 * @param options - how far each side sits from {@link BUILT_AT_MS}, and which sides exist.
 * @returns the member root.
 */
    function workspaceRoot(options: { sourceAgeMs?: number; artifactAgeMs?: number; sources?: boolean; artifacts?: boolean }): string {
      return appTree(options).root
    }

    beforeEach(() => {
      dirs.length = 0
    })

    afterEach(() => {
      while (dirs.length > 0) rmSync(dirs.pop()!, { recursive: true, force: true })
    })

    describe('a stale build is refused', () => {
      it('CAP-TEST-HARNESS-039 accepts a build newer than every source', () => {
        const tree = appTree({ sourceAgeMs: 2 * HOUR_MS, artifactAgeMs: HOUR_MS })
        const verdict = evaluateBuildFreshness(tree)
        expect(verdict.ok).toBe(true)
        expect(verdict.reason).toBeNull()
        expect(verdict.sourceCount).toBe(2)
        expect(verdict.artifactCount).toBe(2)
      })

      it('CAP-TEST-HARNESS-040 refuses a source file touched after the build, and names it', () => {
        const tree = appTree({ sourceAgeMs: 2 * HOUR_MS, artifactAgeMs: HOUR_MS })
        const edited = join(tree.sourceRoots[0]!, 'nested', 'session-host.ts')
        setAge(edited, HOUR_MS / 2)
        const verdict = evaluateBuildFreshness(tree)
        expect(verdict.ok).toBe(false)
        expect(verdict.reason).toBe('build-artifacts-stale')
        expect(verdict.detail).toContain(edited)
        expect(verdict.staleArtifacts).toBe(2)
      })

      it('CAP-TEST-HARNESS-041 accepts a build and a source with the same mtime', () => {
        const tree = appTree({ sourceAgeMs: HOUR_MS, artifactAgeMs: HOUR_MS })
        expect(evaluateBuildFreshness(tree).ok).toBe(true)
      })

      it('CAP-TEST-HARNESS-042 compares the newest source, not the first one', () => {
        const tree = appTree({ sourceAgeMs: 2 * HOUR_MS, artifactAgeMs: HOUR_MS })
        setAge(join(tree.sourceRoots[0]!, 'extension.ts'), 4 * HOUR_MS)
        setAge(join(tree.sourceRoots[0]!, 'nested', 'session-host.ts'), HOUR_MS / 4)
        const verdict = evaluateBuildFreshness(tree)
        expect(verdict.ok).toBe(false)
        expect(verdict.sourceNewest?.path).toBe(join(tree.sourceRoots[0]!, 'nested', 'session-host.ts'))
      })
    })

    describe('what cannot be compared is refused, not assumed', () => {
      it('CAP-TEST-HARNESS-043 refuses a missing artifact root rather than calling the build current', () => {
        const tree = appTree({ artifacts: false })
        const verdict = evaluateBuildFreshness(tree)
        expect(verdict.ok).toBe(false)
        expect(verdict.reason).toBe('build-artifacts-absent')
      })

      it('CAP-TEST-HARNESS-044 refuses a missing entry even when chunks exist', () => {
        const tree = appTree({ entry: false })
        const verdict = evaluateBuildFreshness(tree)
        expect(verdict.ok).toBe(false)
        expect(verdict.reason).toBe('build-entry-absent')
        expect(verdict.entryExists).toBe(false)
      })

      it('CAP-TEST-HARNESS-045 refuses an entry that imports a chunk the build never wrote', () => {
        const tree = appTree({})
        writeFileSync(tree.entry, 'export { activate } from "./extension-dangling.js"\n')
        const verdict = evaluateBuildFreshness(tree)
        expect(verdict.ok).toBe(false)
        expect(verdict.reason).toBe('build-entry-incomplete')
        expect(verdict.detail).toContain('extension-dangling.js')
      })

      it('CAP-TEST-HARNESS-046 refuses a missing source root instead of reporting freshness', () => {
        const tree = appTree({ sources: false })
        const verdict = evaluateBuildFreshness(tree)
        expect(verdict.ok).toBe(false)
        expect(verdict.reason).toBe('sources-unreadable')
      })

      it('CAP-TEST-HARNESS-047 refuses an empty source root', () => {
        const tree = appTree({ sources: false })
        mkdirSync(tree.sourceRoots[0]!, { recursive: true })
        const verdict = evaluateBuildFreshness(tree)
        expect(verdict.ok).toBe(false)
        expect(verdict.reason).toBe('sources-unreadable')
      })
    })

    describe('the workspace half is compared too', () => {
      it('CAP-TEST-HARNESS-048 accepts a workspace root built after its own sources, and says how many it compared', () => {
        const app = appTree({})
        const member = workspaceRoot({ sourceAgeMs: 2 * HOUR_MS, artifactAgeMs: HOUR_MS })
        const verdict = evaluateBuildFreshness({ ...app, siblingRoots: [member] })
        expect(verdict.ok).toBe(true)
        expect(verdict.siblings?.compared).toBe(1)
        expect(verdict.siblings?.failed).toBe(0)
        // The count is what makes a PASS readable: "266 roots were compared" is the fact, not silence.
        expect(verdict.siblings?.artifactCount).toBe(2)
        expect(verdict.siblings?.failures).toEqual([])
      })

      it('CAP-TEST-HARNESS-049 refuses a workspace root whose sources were edited after its build', () => {
        const app = appTree({})
        const member = workspaceRoot({ sourceAgeMs: 2 * HOUR_MS, artifactAgeMs: HOUR_MS })
        const edited = join(member, 'src', 'nested', 'session-host.ts')
        setAge(edited, HOUR_MS / 2)
        const verdict = evaluateBuildFreshness({ ...app, siblingRoots: [member] })
        expect(verdict.ok).toBe(false)
        expect(verdict.reason).toBe('workspace-artifacts-stale')
        expect(verdict.detail).toContain(member)
        expect(verdict.siblings?.failed).toBe(1)
        expect(verdict.siblings?.failures[0]?.root).toBe(member)
        expect(verdict.siblings?.failures[0]?.detail).toContain(edited)
      })

      it('CAP-TEST-HARNESS-050 refuses a workspace root the build never published rather than skipping it', () => {
        const app = appTree({})
        const member = workspaceRoot({ artifacts: false })
        const verdict = evaluateBuildFreshness({ ...app, siblingRoots: [member] })
        expect(verdict.ok).toBe(false)
        expect(verdict.reason).toBe('workspace-artifacts-absent')
        expect(verdict.detail).toContain(member)
      })

      it('CAP-TEST-HARNESS-051 refuses a workspace root whose own sources cannot be read', () => {
        const app = appTree({})
        const member = workspaceRoot({ sources: false })
        const verdict = evaluateBuildFreshness({ ...app, siblingRoots: [member] })
        expect(verdict.ok).toBe(false)
        expect(verdict.reason).toBe('workspace-sources-unreadable')
      })

      it('CAP-TEST-HARNESS-052 compares each root against its own sources, not against one global newest source', () => {
        const app = appTree({})
        // `fresh` holds the newest source of the whole comparison and is still fine: its own build is
        // newer. A single global comparison would refuse this tree, which is how a gate gets disabled.
        const fresh = workspaceRoot({ sourceAgeMs: HOUR_MS / 2, artifactAgeMs: HOUR_MS / 4 })
        const quiet = workspaceRoot({ sourceAgeMs: 4 * HOUR_MS, artifactAgeMs: 3 * HOUR_MS })
        const verdict = evaluateBuildFreshness({ ...app, siblingRoots: [fresh, quiet] })
        expect(verdict.ok).toBe(true)
        expect(verdict.siblings?.compared).toBe(2)
        expect(verdict.siblings?.failed).toBe(0)
      })

      it('CAP-TEST-HARNESS-053 names the first failing root and counts the rest', () => {
        const app = appTree({})
        const roots = [
          workspaceRoot({ sourceAgeMs: HOUR_MS / 2 }),
          workspaceRoot({ sourceAgeMs: HOUR_MS / 2 }),
          workspaceRoot({ sourceAgeMs: HOUR_MS / 2 }),
        ]
        const verdict = evaluateBuildFreshness({ ...app, siblingRoots: roots })
        expect(verdict.ok).toBe(false)
        expect(verdict.detail).toContain(roots[0]!)
        // One repair per run is not a report; the size of the problem is part of the verdict.
        expect(verdict.detail).toContain('(and 2 other workspace root(s) of the 3 compared)')
        expect(verdict.siblings?.failed).toBe(3)
      })

      it('CAP-TEST-HARNESS-054 lets neither half vouch for the other', () => {
        const staleApp = appTree({ sourceAgeMs: HOUR_MS / 2, artifactAgeMs: HOUR_MS })
        const currentMember = workspaceRoot({ sourceAgeMs: 2 * HOUR_MS, artifactAgeMs: HOUR_MS })
        const staleHalf = evaluateBuildFreshness({ ...staleApp, siblingRoots: [currentMember] })
        expect(staleHalf.ok).toBe(false)
        // The app half is checked first, so its own reason is the one reported; the member's own row
        // still says it was compared and passed.
        expect(staleHalf.reason).toBe('build-artifacts-stale')
        expect(staleHalf.siblings?.compared).toBe(1)
        expect(staleHalf.siblings?.failed).toBe(0)

        const currentApp = appTree({ sourceAgeMs: 2 * HOUR_MS, artifactAgeMs: HOUR_MS })
        const staleMember = workspaceRoot({ sourceAgeMs: HOUR_MS / 2 })
        const otherHalf = evaluateBuildFreshness({ ...currentApp, siblingRoots: [staleMember] })
        expect(otherHalf.ok).toBe(false)
        expect(otherHalf.reason).toBe('workspace-artifacts-stale')
      })
    })

    describe('the compared workspace set is the built workspace set', () => {
      it('CAP-TEST-HARNESS-055 expands the globs the smoke script actually feeds to the comparison', () => {
        expect(smokeScript).toContain('"${REPO_ROOT}"/packages/*/*')
        expect(smokeScript).toContain('"${REPO_ROOT}"/vendor/*')
        // The app half is the caller's own comparison, so this file has to keep it wired there too.
        expect(smokeScript).toContain('"${APP_DIR}/lib" "${APP_DIR}/lib/extension.cjs" "${APP_DIR}/src"')
      })

      it('CAP-TEST-HARNESS-056 leaves no member of the tsdown workspace list outside the comparison', () => {
        const members = tsdownWorkspaceMembers()
        // Guards the probe itself: if the array is renamed or restructured the list comes back empty
        // and the assertion below would pass vacuously.
        expect(members.length).toBeGreaterThan(3)
        const uncovered = members.filter(
          member => !COMPARED_GLOBS.some(glob => matchesSingleSegmentGlob(glob, member)) && !OUTSIDE_THE_GLOBS.includes(member),
        )
        // A workspace member that `build:lib:host` publishes but nothing compares is a member whose
        // staleness no run can see — the hole DEBT-014 was opened for, one tier over.
        expect(uncovered).toEqual([])
      })

      it('CAP-TEST-HARNESS-057 records why the two members outside those globs are outside them', () => {
        const members = tsdownWorkspaceMembers()
        for (const member of OUTSIDE_THE_GLOBS) expect(members).toContain(member)
        // The app is compared by the caller (asserted above); `apps/cli` is a deliberate exclusion and
        // is documented where the set is built, so a reader does not have to infer it from silence.
        expect(smokeScript).toContain('apps/cli')
      })
    })
  })

  describe('sandbox-clean-state.spec.ts', () => {
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

    describe('staleProductState can fail', () => {
      it('CAP-TEST-HARNESS-058 reports a session file that predates the run', () => {
        const { home, file } = sandboxWithSessionFile(60_000)
        const report = staleProductState(home, RUN_STARTED_AT_MS)
        expect(report.scannedFiles).toBe(1)
        expect(report.offenderCount).toBe(1)
        expect(report.offenders[0]).toMatchObject({ path: file, reason: 'predates-run', runStartedAtMs: RUN_STARTED_AT_MS })
      })

      it('CAP-TEST-HARNESS-059 leaves the run\'s own session file alone', () => {
        const { home } = sandboxWithSessionFile(null)
        const report = staleProductState(home, RUN_STARTED_AT_MS)
        expect(report.scannedFiles).toBe(1)
        expect(report.offenderCount).toBe(0)
      })

      it('CAP-TEST-HARNESS-060 keeps the 5s granularity slack on the boundary', () => {
        const inside = sandboxWithSessionFile(SLACK_MS)
        const outside = sandboxWithSessionFile(SLACK_MS + 1)
        expect(staleProductState(inside.home, RUN_STARTED_AT_MS).offenderCount).toBe(0)
        expect(staleProductState(outside.home, RUN_STARTED_AT_MS).offenderCount).toBe(1)
      })

      it('CAP-TEST-HARNESS-061 reports an entry it cannot stat instead of counting it as clean', () => {
        const { home } = sandboxWithSessionFile(null)
        const dangling = join(home, '.dsh', 'storages', 'gone.json')
        mkdirSync(join(home, '.dsh', 'storages'), { recursive: true })
        symlinkSync(join(home, 'does-not-exist'), dangling)
        const report = staleProductState(home, RUN_STARTED_AT_MS)
        expect(report.offenders.map(offender => offender.reason)).toEqual(['unreadable'])
      })

      it('CAP-TEST-HARNESS-062 scans the storage root as well as the session root', () => {
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

      it('CAP-TEST-HARNESS-063 throws rather than scanning nothing when it is handed no sandbox home', () => {
        // The predicate's own refusal, for a caller that skipped `homeSandboxOf`: scanning no root
        // and reporting zero offenders is the answer this must never give (🟡-1).
        expect(() => staleProductState('', RUN_STARTED_AT_MS)).toThrow(/validated by homeSandboxOf/)
      })
    })

    describe('an unusable run start is refused, never defaulted', () => {
      it('CAP-TEST-HARNESS-064 accepts a positive finite instant', () => {
        expect(runStartedAtMsOf({ runStartedAtMs: RUN_STARTED_AT_MS })).toEqual({ ok: true, value: RUN_STARTED_AT_MS })
      })

      it('CAP-TEST-HARNESS-065 refuses the initialiser the plan used to carry', () => {
        const plan = { runStartedAtMs: 0 }
        const verdict = runStartedAtMsOf(plan)
        expect(verdict.ok).toBe(false)
      })

      it('CAP-TEST-HARNESS-066 refuses a negative instant', () => {
        const plan = { runStartedAtMs: -1 }
        const verdict = runStartedAtMsOf(plan)
        expect(verdict.ok).toBe(false)
      })

      it('CAP-TEST-HARNESS-067 refuses a string', () => {
        const plan = { runStartedAtMs: '1700000000000' }
        const verdict = runStartedAtMsOf(plan)
        expect(verdict.ok).toBe(false)
      })

      it('CAP-TEST-HARNESS-068 refuses null', () => {
        const plan = { runStartedAtMs: null }
        const verdict = runStartedAtMsOf(plan)
        expect(verdict.ok).toBe(false)
      })

      it('CAP-TEST-HARNESS-069 refuses NaN', () => {
        const plan = { runStartedAtMs: Number.NaN }
        const verdict = runStartedAtMsOf(plan)
        expect(verdict.ok).toBe(false)
      })

      it('CAP-TEST-HARNESS-070 refuses Infinity', () => {
        const plan = { runStartedAtMs: Number.POSITIVE_INFINITY }
        const verdict = runStartedAtMsOf(plan)
        expect(verdict.ok).toBe(false)
      })

      it('CAP-TEST-HARNESS-071 refuses a missing field', () => {
        const plan = {}
        const verdict = runStartedAtMsOf(plan)
        expect(verdict.ok).toBe(false)
      })

      it('CAP-TEST-HARNESS-072 refuses a plan that is not an object', () => {
        const plan = null
        const verdict = runStartedAtMsOf(plan)
        expect(verdict.ok).toBe(false)
      })
    })

    describe('🟡-1: an unusable sandbox home is refused, never scanned as empty', () => {
      it('CAP-TEST-HARNESS-073 accepts the sandbox home the shell created', () => {
        const { home } = sandboxWithSessionFile(null)
        expect(homeSandboxOf({ homeSandbox: home })).toEqual({ ok: true, value: home })
      })

      it('CAP-TEST-HARNESS-074 refuses a missing field', () => {
        const plan = {}
        expect(homeSandboxOf(plan).ok).toBe(false)
      })

      it('CAP-TEST-HARNESS-075 refuses an empty string', () => {
        const plan = { homeSandbox: '' }
        expect(homeSandboxOf(plan).ok).toBe(false)
      })

      it('CAP-TEST-HARNESS-076 refuses a path that does not exist', () => {
        const plan = { homeSandbox: join(tmpdir(), 'sandbox-clean-state-absent-home') }
        expect(homeSandboxOf(plan).ok).toBe(false)
      })

      it('CAP-TEST-HARNESS-077 refuses a relative path that resolves to nothing', () => {
        const plan = { homeSandbox: 'sandbox-clean-state-absent-relative-home' }
        expect(homeSandboxOf(plan).ok).toBe(false)
      })

      it('CAP-TEST-HARNESS-078 refuses a number', () => {
        const plan = { homeSandbox: 7 }
        expect(homeSandboxOf(plan).ok).toBe(false)
      })

      it('CAP-TEST-HARNESS-079 refuses null', () => {
        const plan = { homeSandbox: null }
        expect(homeSandboxOf(plan).ok).toBe(false)
      })

      it('CAP-TEST-HARNESS-080 refuses a plan that is not an object', () => {
        const plan = null
        expect(homeSandboxOf(plan).ok).toBe(false)
      })

      it('CAP-TEST-HARNESS-081 refuses a sandbox home that names a file rather than a directory', () => {
        const { file } = sandboxWithSessionFile(null)
        expect(homeSandboxOf({ homeSandbox: file }).ok).toBe(false)
      })

      it('CAP-TEST-HARNESS-082 refuses the empty home instead of reporting a clean sandbox', () => {
        // The expectation this replaced asserted `checkedRoots: []` and `offenderCount: 0` for a plan
        // without a sandbox home — "empty means clean" — which is the degeneration 🟡-1 names.
        const verdict = homeSandboxOf({ homeSandbox: '' })
        expect(verdict.ok).toBe(false)
        expect(verdict.value).toBe('')
      })
    })
  })

  describe('layer-v-capabilities-phase3.spec.ts', () => {
    const manifestPath = join(
      dirname(fileURLToPath(import.meta.url)),
      '..',
      'test-scripts',
      'layer-v-capabilities.json',
    )

    interface ManifestStep {
      kind: string
      step: string
      command?: string
      args?: unknown[]
      expect?: unknown
      timeoutMs?: number
    }

    interface ManifestCapability {
      id: string
      group: string
      title: string
      ac: string[]
      requiresModel: boolean
      steps: ManifestStep[]
    }

    interface Manifest {
      capabilities: ManifestCapability[]
    }

    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as Manifest
    const byId = new Map(manifest.capabilities.map(cap => [cap.id, cap]))

    /** The 14 capabilities this Phase drives (§12.4/12.5/12.6/12.7/12.10/12.11). */
    const TARGET_IDS = [
      'cap-open-subagent-context',
      'cap-pin-subagent-tab',
      'cap-at-path-token',
      'cap-workspace-path-resolve',
      'cap-selection-ask',
      'cap-change-index-store',
      'cap-snapshot-revert',
      'cap-change-diff-render',
      'cap-session-search',
      'cap-tier1-field-match',
      'cap-history-list',
      'cap-open-from-history',
      'cap-interaction-coordinator',
      'cap-interaction-ui',
    ]

    /** Hooks whose presence proves the manifest no longer uses Phase 2 placeholder commands. */
    const PLACEHOLDER_HOOKS = new Set([
      'dsh.test.getStartState',
    ])

    function stepsOf(id: string): ManifestStep[] {
      const cap = byId.get(id)
      if (cap === undefined) throw new Error(`missing manifest capability ${id}`)
      return cap.steps
    }

    function commandsOf(id: string): string[] {
      return stepsOf(id).map(step => step.command).filter((c): c is string => typeof c === 'string')
    }

    /** A model round-trip marker assertion: assistant text carries the marker. */
    function isMarkerExpect(expect: unknown): boolean {
      return typeof expect === 'string'
    && (expect.startsWith('$assistantContains:') || expect.startsWith('$assistantClosed:'))
    }

    describe('Phase 3 manifest: 14 target capabilities are present', () => {
      it('CAP-TEST-HARNESS-084 every target id exists in the manifest', () => {
        for (const id of TARGET_IDS) {
          expect(byId.has(id), `missing ${id}`).toBe(true)
        }
      })

      it('CAP-TEST-HARNESS-085 every target capability has at least one step', () => {
        for (const id of TARGET_IDS) {
          expect(stepsOf(id).length, `${id} has no steps`).toBeGreaterThan(0)
        }
      })
    })

    describe('Phase 3 manifest: no placeholder hooks remain', () => {
      it('CAP-TEST-HARNESS-086 no target step still waits on dsh.test.getStartState', () => {
        for (const id of TARGET_IDS) {
          for (const command of commandsOf(id)) {
            expect(PLACEHOLDER_HOOKS.has(command), `${id} still uses ${command}`).toBe(false)
          }
        }
      })

      it('CAP-TEST-HARNESS-087 no target step drives a fake subagent id or an empty id arg', () => {
        for (const id of TARGET_IDS) {
          for (const step of stepsOf(id)) {
            const args = step.args ?? []
            for (const arg of args) {
              if (typeof arg === 'string') {
                expect(arg, `${id} step ${step.step} passes a placeholder string arg`).not.toBe('__child__')
                expect(arg, `${id} step ${step.step} passes an empty id arg`).not.toBe('')
              }
            }
          }
        }
      })
    })

    describe('Phase 3 manifest: assert steps carry expectations', () => {
      it('CAP-TEST-HARNESS-088 every assert step names an expect, so a stub could not pass silently', () => {
        for (const id of TARGET_IDS) {
          for (const step of stepsOf(id)) {
            if (step.kind === 'assert') {
              expect(step.expect, `${id} step ${step.step} is an assert without expect`).toBeDefined()
            }
          }
        }
      })

      it('CAP-TEST-HARNESS-089 every command-driving step (assert/wait/stream/replay) names the command it drives', () => {
        const commandDriving = new Set(['assert', 'wait', 'stream', 'replay'])
        for (const id of TARGET_IDS) {
          for (const step of stepsOf(id)) {
            if (commandDriving.has(step.kind)) {
              expect(typeof step.command, `${id} step ${step.step} (${step.kind}) has no command`).toBe('string')
            }
          }
        }
      })
    })

    describe('Phase 3 manifest: every prompt is answered by a marker round-trip', () => {
      it('CAP-TEST-HARNESS-090 a sendPrompt step is always followed by a marker wait/stream assertion', () => {
        for (const id of TARGET_IDS) {
          const steps = stepsOf(id)
          for (let i = 0; i < steps.length; i += 1) {
            const step = steps[i]
            if (step.command !== 'dsh.test.sendPrompt') continue
            const hasMarkerAfter = steps.slice(i + 1).some(later =>
              (later.kind === 'wait' || later.kind === 'stream') && isMarkerExpect(later.expect),
            )
            expect(hasMarkerAfter, `${id} step ${step.step} sends a prompt but no marker round-trip follows`).toBe(true)
          }
        }
      })

      it('CAP-TEST-HARNESS-091 no model gate uses $contains, which a user-bubble echo would satisfy', () => {
        for (const id of TARGET_IDS) {
          for (const step of stepsOf(id)) {
            if (step.kind !== 'wait' && step.kind !== 'stream') continue
            if (typeof step.expect === 'string' && step.expect.startsWith('$contains:')) {
              expect(false, `${id} step ${step.step} uses $contains for a model gate`).toBe(true)
            }
          }
        }
      })
    })

    describe('Phase 3 manifest: each group drives its real product surface', () => {
      it('CAP-TEST-HARNESS-092 subagent drives dsh.test.injectSubagent then open/pin', () => {
        expect(commandsOf('cap-open-subagent-context')).toContain('dsh.test.injectSubagent')
        expect(commandsOf('cap-open-subagent-context')).toContain('dsh.test.openSubagent')
        expect(commandsOf('cap-pin-subagent-tab')).toContain('dsh.test.injectSubagent')
        expect(commandsOf('cap-pin-subagent-tab')).toContain('dsh.test.pinSubagent')
      })

      it('CAP-TEST-HARNESS-093 code-context uses dsh.test.resolveAtPath for @path resolution', () => {
        expect(commandsOf('cap-at-path-token')).toContain('dsh.test.resolveAtPath')
        expect(commandsOf('cap-workspace-path-resolve')).toContain('dsh.test.resolveAtPath')
      })

      it('CAP-TEST-HARNESS-094 selection-ask opens an editor selection before asking the model', () => {
        expect(commandsOf('cap-selection-ask')).toContain('dsh.test.openEditorWithSelection')
        expect(commandsOf('cap-selection-ask')).toContain('dsh.test.askAboutSelection')
        expect(commandsOf('cap-selection-ask')).toContain('dsh.test.sendPrompt')
      })

      it('CAP-TEST-HARNESS-095 change-list drives the new revert hooks and diff availability', () => {
        expect(commandsOf('cap-change-index-store')).toContain('dsh.test.listChanges')
        expect(commandsOf('cap-snapshot-revert')).toContain('dsh.test.revertAllChanges')
        expect(commandsOf('cap-change-diff-render')).toContain('dsh.test.diffAvailability')
        expect(commandsOf('cap-change-diff-render')).toContain('dsh.test.changedFileCount')
      })

      it('CAP-TEST-HARNESS-096 search drives dsh.test.searchSessions, not a product QuickPick command', () => {
        expect(commandsOf('cap-session-search')).toContain('dsh.test.searchSessions')
        expect(commandsOf('cap-tier1-field-match')).toContain('dsh.test.searchSessions')
      })

      it('CAP-TEST-HARNESS-097 history drives dsh.test.listHistory, and open-from-history uses a replay step', () => {
        expect(commandsOf('cap-history-list')).toContain('dsh.test.listHistory')
        const reopenSteps = stepsOf('cap-open-from-history')
        const hasReplay = reopenSteps.some(step => step.kind === 'replay')
        expect(hasReplay, 'cap-open-from-history has no replay step').toBe(true)
      })

      it('CAP-TEST-HARNESS-098 interaction drives dsh.test.injectApproval + dsh.test.answerApproval + listPendingInteractions', () => {
        for (const id of ['cap-interaction-coordinator', 'cap-interaction-ui']) {
          const commands = commandsOf(id)
          expect(commands).toContain('dsh.test.injectApproval')
          expect(commands).toContain('dsh.test.answerApproval')
          expect(commands).toContain('dsh.test.listPendingInteractions')
        }
      })
    })
  })

  describe('layer-v-capability-runner.spec.ts', () => {
    const require = createRequire(import.meta.url)
    const runner = require('../test-scripts/layer-v-capability-driver/capability-runner.cjs') as {
      StageError: new (conclusion: string, detail: { reason: string; evidence?: unknown; step?: string }) => Error & {
        conclusion: string
        reason: string
        evidence?: unknown
        step?: string
      }
      linkFailure: (reason: string, evidence?: unknown) => Error
      harnessError: (reason: string, evidence?: unknown) => Error
      skipNoCredentials: (reason: string, evidence?: unknown) => Error
      CONCLUSION_PRECEDENCE: string[]
      safeJson: (value: unknown) => unknown
      unwrap: (value: unknown) => unknown
      resolvePath: (value: unknown, fieldPath: string) => unknown
      deepEqual: (a: unknown, b: unknown) => boolean
      MATCHERS: Record<string, { name: string; test: (value: unknown) => boolean }>
      resolveMatcher: (pred: string) => (value: unknown) => boolean
      typePredicate: (value: unknown, pred: string) => boolean
      assistantText: (snapshot: unknown) => string
      assistantStreamingActive: (snapshot: unknown) => boolean
      matchesExpect: (actual: unknown, expect: unknown) => { ok: boolean; path?: string; expected?: unknown; actual?: unknown }
      selectCapabilities: (manifest: unknown, selector?: { only?: string[] }) => Array<{ id: string; group: string }>
      runManifest: (
        manifest: unknown,
        host: {
          executeCommand: (id: string, ...args: unknown[]) => Promise<unknown>
          capture: (fileName: string) => Promise<unknown>
        },
        options?: { selector?: { only?: string[] }; hasCredential?: boolean; stepTimeoutMs?: number; journal?: (entry: object) => void },
      ) => Promise<{ conclusion: string; capabilities: Array<{ id: string; conclusion: string; steps?: unknown[] }> }>
      overallConclusion: (results: Array<{ conclusion: string }>) => string
      resolveStepArgs: (
        args: unknown,
        stepResults: Map<string, unknown>,
      ) => { ok: true; args: unknown[] } | { ok: false; error: string }
    }

    const {
      matchesExpect,
      selectCapabilities,
      runManifest,
      overallConclusion,
      resolvePath,
      resolveStepArgs,
      deepEqual,
      MATCHERS,
      resolveMatcher,
      typePredicate,
      assistantText,
      assistantStreamingActive,
      linkFailure,
    } = runner

    /** A mock host whose commands answer a fixed map; the capture is a non-degenerate stub PNG. */
    function mockHost(answers: Record<string, unknown>): {
      executeCommand: (id: string, ...args: unknown[]) => Promise<unknown>
      capture: (fileName: string) => Promise<unknown>
    } {
      return {
        executeCommand: async (id, ..._args) => {
          // The runner resets to idle after every executed capability (DEBT-12); the mock
          // answers it as a no-op so the reset does not surface as an unexpected command.
          if (id === 'dsh.test.resetToIdle') {
            return { ok: true, startState: 'idle', clearedContexts: 0, closedChildTabs: 0 }
          }
          if (id in answers) return answers[id]
          throw new Error(`unexpected command ${id}`)
        },
        capture: async () => ({ ok: true, file: 'probe.png', verdict: { ok: true, size: 1024 } }),
      }
    }

    describe('AD-4: matchesExpect distinguishes inputs (anti-stub)', () => {
      it('CAP-TEST-HARNESS-099 accepts a matching literal and rejects a mismatching one', () => {
        expect(matchesExpect({ viewId: 'dsh.editorChat', panelOpen: true }, { panelOpen: true }).ok).toBe(true)
        expect(matchesExpect({ panelOpen: false }, { panelOpen: true }).ok).toBe(false)
      })

      it('CAP-TEST-HARNESS-100 resolves a dotted field path against a nested result', () => {
        expect(matchesExpect({ outer: { inner: 'x' } }, { 'outer.inner': 'x' }).ok).toBe(true)
        expect(matchesExpect({ outer: { inner: 'x' } }, { 'outer.inner': 'y' }).ok).toBe(false)
      })

      it('CAP-TEST-HARNESS-101 applies a $root predicate to the whole result, for bare-array commands', () => {
        expect(matchesExpect([{ id: 'a' }], '$array').ok).toBe(true)
        expect(matchesExpect({ rows: [] }, '$array').ok).toBe(false)
        expect(matchesExpect([1, 2, 3], '$array:2').ok).toBe(true)
        expect(matchesExpect([1], '$array:2').ok).toBe(false)
      })

      it('CAP-TEST-HARNESS-102 applies type predicates to a named field', () => {
        expect(matchesExpect({ state: 'started' }, { state: '$string' }).ok).toBe(true)
        expect(matchesExpect({ state: 7 }, { state: '$string' }).ok).toBe(false)
      })

      it('CAP-TEST-HARNESS-103 names the failing path so the mismatch is diagnosable, not a bare boolean', () => {
        const verdict = matchesExpect({ a: { b: 1 } }, { 'a.b': 2 })
        expect(verdict.ok).toBe(false)
        expect(verdict.path).toBe('a.b')
      })
    })

    describe('AD-3: selectCapabilities drives the manifest', () => {
      const manifest = {
        capabilities: [
          { id: 'cap-1', group: 'react-spa-main' },
          { id: 'cap-2', group: 'react-spa-main' },
          { id: 'cap-3', group: 'editor-panel' },
        ],
      }

      it('CAP-TEST-HARNESS-104 runs everything when no selector is given', () => {
        expect(selectCapabilities(manifest).map(cap => cap.id)).toEqual(['cap-1', 'cap-2', 'cap-3'])
      })

      it('CAP-TEST-HARNESS-105 filters by group', () => {
        expect(selectCapabilities(manifest, { only: ['editor-panel'] }).map(cap => cap.id)).toEqual(['cap-3'])
      })

      it('CAP-TEST-HARNESS-106 filters by exact id', () => {
        expect(selectCapabilities(manifest, { only: ['cap-2'] }).map(cap => cap.id)).toEqual(['cap-2'])
      })
    })

    describe('conclusion aggregation never merges or downgrades', () => {
      it('CAP-TEST-HARNESS-107 returns PASS only when every capability passed', () => {
        expect(overallConclusion([{ conclusion: 'PASS' }, { conclusion: 'PASS' }])).toBe('PASS')
      })

      it('CAP-TEST-HARNESS-108 lets LINK_FAILURE outrank PASS', () => {
        expect(overallConclusion([{ conclusion: 'PASS' }, { conclusion: 'LINK_FAILURE' }])).toBe('LINK_FAILURE')
      })

      it('CAP-TEST-HARNESS-109 lets SKIPPED_NO_CREDENTIALS outrank PASS (fail-closed)', () => {
        expect(overallConclusion([{ conclusion: 'PASS' }, { conclusion: 'SKIPPED_NO_CREDENTIALS' }])).toBe('SKIPPED_NO_CREDENTIALS')
      })

      it('CAP-TEST-HARNESS-110 reports a harness error for an empty selection', () => {
        expect(overallConclusion([])).toBe('HARNESS_ERROR')
      })
    })

    describe('StageError carries its classification', () => {
      it('CAP-TEST-HARNESS-111 classifies a link failure with a reason and evidence', () => {
        const error = linkFailure('the panel did not open', { viewId: null })
        expect(error).toBeInstanceOf(Error)
        expect((error as Error & { conclusion: string }).conclusion).toBe('LINK_FAILURE')
      })
    })

    describe('runManifest end-to-end (manifest → gate → steps → conclusion)', () => {
      it('CAP-TEST-HARNESS-112 fail-closes a model-gated capability when no credential is present', async () => {
        const manifest = {
          capabilities: [
            { id: 'gated', group: 'session', title: 'gated', requiresModel: true, steps: [] },
          ],
        }
        // The host must not be touched for a gated capability, so any command is an error.
        const result = await runManifest(manifest, mockHost({}), { hasCredential: false })
        expect(result.conclusion).toBe('SKIPPED_NO_CREDENTIALS')
        expect(result.capabilities[0].conclusion).toBe('SKIPPED_NO_CREDENTIALS')
      })

      it('CAP-TEST-HARNESS-113 passes a capability whose command + assertion + screenshot all succeed', async () => {
        const manifest = {
          capabilities: [
            {
              id: 'cap-1',
              group: 'react-spa-main',
              title: 'root',
              requiresModel: false,
              steps: [
                { kind: 'command', step: 'open', command: 'dsh.showPanel' },
                { kind: 'assert', step: 'panel-open', command: 'dsh.showPanel', expect: { panelOpen: true } },
                { kind: 'screenshot', step: 'shot', file: 'cap-1.png' },
              ],
            },
          ],
        }
        const result = await runManifest(manifest, mockHost({ 'dsh.showPanel': { viewId: 'dsh.editorChat', panelOpen: true } }), { hasCredential: false })
        expect(result.conclusion).toBe('PASS')
        expect(result.capabilities[0].conclusion).toBe('PASS')
        expect((result.capabilities[0].steps as unknown[]).length).toBe(3)
      })

      it('CAP-TEST-HARNESS-114 classifies a failing assertion as LINK_FAILURE, not a pass', async () => {
        const manifest = {
          capabilities: [
            {
              id: 'cap-1',
              group: 'react-spa-main',
              title: 'root',
              requiresModel: false,
              steps: [{ kind: 'assert', step: 'panel-open', command: 'dsh.showPanel', expect: { panelOpen: true } }],
            },
          ],
        }
        const result = await runManifest(manifest, mockHost({ 'dsh.showPanel': { panelOpen: false } }), { hasCredential: false })
        expect(result.conclusion).toBe('LINK_FAILURE')
        expect(result.capabilities[0].conclusion).toBe('LINK_FAILURE')
      })

      it('CAP-TEST-HARNESS-115 journals every step, including the failure that threw (crash-localisable)', async () => {
        const manifest = {
          capabilities: [
            {
              id: 'cap-1',
              group: 'react-spa-main',
              title: 'root',
              requiresModel: false,
              steps: [
                { kind: 'command', step: 'open', command: 'dsh.showPanel' },
                { kind: 'assert', step: 'panel-open', command: 'dsh.showPanel', expect: { panelOpen: true } },
              ],
            },
          ],
        }
        const entries: Array<Record<string, unknown>> = []
        const result = await runManifest(manifest, mockHost({ 'dsh.showPanel': { panelOpen: false } }), {
          hasCredential: false,
          journal: entry => entries.push(entry as Record<string, unknown>),
        })
        // The PASS command step and the FAILING assert step are both journaled, in order, naming
        // capability + step + verdict — the fields the design contract requires.
        expect(result.conclusion).toBe('LINK_FAILURE')
        expect(entries.map(e => `${e.capability}:${e.step}:${e.verdict}`)).toEqual([
          'cap-1:open:PASS',
          'cap-1:panel-open:LINK_FAILURE',
        ])
      })

      it('CAP-TEST-HARNESS-137 keeps the partial step records of a failed capability', async () => {
        const manifest = {
          capabilities: [
            {
              id: 'cap-partial',
              group: 'session',
              title: 'partial',
              requiresModel: false,
              steps: [
                { kind: 'command', step: 'open', command: 'dsh.showPanel' },
                { kind: 'assert', step: 'panel-open', command: 'dsh.showPanel', expect: { panelOpen: true } },
                { kind: 'screenshot', step: 'shot', file: 'cap-partial.png' },
              ],
            },
          ],
        }
        const result = await runManifest(manifest, mockHost({ 'dsh.showPanel': { panelOpen: false } }), { hasCredential: false })
        expect(result.conclusion).toBe('LINK_FAILURE')
        // The failure must name the steps that ran, not just the one that died: a driver
        // diagnosis reads the ids/values those earlier steps returned.
        const steps = result.capabilities[0].steps as Array<{ step: string; ok: boolean }>
        expect(steps.map(step => [step.step, step.ok])).toEqual([['open', true], ['panel-open', false]])
      })
    })

    describe('$ref step arguments resolve against earlier step results', () => {
      it('CAP-TEST-HARNESS-133 resolves $ref:step.field and $ref:step, keeping literals verbatim', () => {
        const results = new Map<string, unknown>([
          ['new-conversation', { outcome: 'created', sessionId: 'sess-1' }],
          ['list', ['a', 'b']],
        ])
        expect(resolveStepArgs(['$ref:new-conversation.sessionId', 'literal', 7], results))
          .toEqual({ ok: true, args: ['sess-1', 'literal', 7] })
        expect(resolveStepArgs(['$ref:list'], results)).toEqual({ ok: true, args: [['a', 'b']] })
        expect(resolveStepArgs(undefined, results)).toEqual({ ok: true, args: [] })
      })

      it('CAP-TEST-HARNESS-134 rejects an unknown step, a missing field, and a non-array args list', () => {
        const results = new Map<string, unknown>([['new-conversation', { sessionId: 'sess-1' }]])

        const unknownStep = resolveStepArgs(['$ref:missing.sessionId'], results)
        expect(unknownStep.ok).toBe(false)
        if (unknownStep.ok) throw new Error('expected the unknown step to be rejected')
        expect(unknownStep.error).toContain('missing')

        const missingField = resolveStepArgs(['$ref:new-conversation.tabId'], results)
        expect(missingField.ok).toBe(false)
        if (missingField.ok) throw new Error('expected the missing field to be rejected')
        expect(missingField.error).toContain('new-conversation.tabId')

        expect(resolveStepArgs({}, results).ok).toBe(false)
      })

      it('CAP-TEST-HARNESS-135 hands the resolved value to the command and keeps the result addressable', async () => {
        const calls: Array<{ id: string; args: unknown[] }> = []
        const host = {
          executeCommand: async (id: string, ...args: unknown[]) => {
            calls.push({ id, args })
            if (id === 'dsh.test.resetToIdle') return { ok: true, startState: 'idle' }
            if (id === 'dsh.test.newConversation') return { outcome: 'created', sessionId: 'sess-1' }
            if (id === 'dsh.test.sessionLogExists') return { exists: args[0] === 'sess-1' }
            throw new Error(`unexpected command ${id}`)
          },
          capture: async () => ({ ok: true, file: 'probe.png', verdict: { ok: true, size: 1024 } }),
        }
        const manifest = {
          capabilities: [
            {
              id: 'cap-ref',
              group: 'history',
              title: 'ref',
              requiresModel: false,
              steps: [
                { kind: 'assert', step: 'new-conversation', command: 'dsh.test.newConversation', expect: { outcome: 'created' } },
                { kind: 'assert', step: 'log-exists', command: 'dsh.test.sessionLogExists', args: ['$ref:new-conversation.sessionId'], expect: { exists: true } },
              ],
            },
          ],
        }
        const result = await runManifest(manifest, host, { hasCredential: false })
        expect(result.conclusion).toBe('PASS')
        expect(calls.find(call => call.id === 'dsh.test.sessionLogExists')?.args).toEqual(['sess-1'])
      })

      it('CAP-TEST-HARNESS-136 fails the step before running the command when a $ref cannot resolve', async () => {
        const calls: string[] = []
        const host = {
          executeCommand: async (id: string) => {
            calls.push(id)
            if (id === 'dsh.test.resetToIdle') return { ok: true, startState: 'idle' }
            return { exists: false }
          },
          capture: async () => ({ ok: true, file: 'probe.png', verdict: { ok: true, size: 1024 } }),
        }
        const manifest = {
          capabilities: [
            {
              id: 'cap-ref',
              group: 'history',
              title: 'ref',
              requiresModel: false,
              steps: [
                { kind: 'assert', step: 'log-exists', command: 'dsh.test.sessionLogExists', args: ['$ref:missing.sessionId'], expect: { exists: true } },
              ],
            },
          ],
        }
        const result = await runManifest(manifest, host, { hasCredential: false })
        expect(result.conclusion).toBe('LINK_FAILURE')
        expect(calls).not.toContain('dsh.test.sessionLogExists')
      })
    })

    describe('resolvePath / deepEqual / typePredicate primitives', () => {
      it('CAP-TEST-HARNESS-116 resolves a dotted path and $root', () => {
        expect(resolvePath({ a: { b: 3 } }, 'a.b')).toBe(3)
        expect(resolvePath([1, 2], '$root')).toEqual([1, 2])
      })

      it('CAP-TEST-HARNESS-117 deep-equals structurally, not by reference', () => {
        expect(deepEqual({ a: 1 }, { a: 1 })).toBe(true)
        expect(deepEqual({ a: 1 }, { a: 2 })).toBe(false)
      })

      it('CAP-TEST-HARNESS-118 classifies type predicates, including the array-length form', () => {
        expect(typePredicate('x', '$string')).toBe(true)
        expect(typePredicate(1, '$string')).toBe(false)
        expect(typePredicate([1, 2], '$array:2')).toBe(true)
        expect(typePredicate([1], '$array:2')).toBe(false)
      })

      it('CAP-TEST-HARNESS-119 exposes the pluggable matcher registry (the Phase 2/3 extension point)', () => {
        // The shipped matchers are the exact set `matchesExpect` routes through; a future
        // `$selector` / `$visible` matcher is one extra registry entry, not an edit to the core.
        expect(Object.keys(MATCHERS).sort()).toEqual(['$array', '$boolean', '$number', '$object', '$present', '$string'])
        expect(resolveMatcher('$string')('x')).toBe(true)
        expect(resolveMatcher('$array:2')([1, 2])).toBe(true)
        expect(resolveMatcher('$array:2')([1])).toBe(false)
        expect(resolveMatcher('$not-a-matcher')({})).toBe(false)
      })
    })

    describe('marker / streaming helpers (Phase 2 real-model round-trips)', () => {
      it('CAP-TEST-HARNESS-120 $contains matches a substring anywhere in a string', () => {
        expect(matchesExpect('the marker LAYER-V-OK is here', '$contains:LAYER-V-OK').ok).toBe(true)
        expect(matchesExpect('no marker here', '$contains:LAYER-V-OK').ok).toBe(false)
        expect(matchesExpect(12345, '$contains:LAYER-V-OK').ok).toBe(false)
      })

      it('CAP-TEST-HARNESS-121 $assistantContains matches assistant text but never the user bubble echo', () => {
        const snapshot = {
          mode: 'live',
          messages: [
            { role: 'user', text: 'LAYER-V-OK echoed by user' },
            { role: 'assistant', text: 'real reply LAYER-V-OK' },
          ],
        }
        expect(matchesExpect(snapshot, '$assistantContains:LAYER-V-OK').ok).toBe(true)
        const userOnly = { mode: 'live', messages: [{ role: 'user', text: 'LAYER-V-OK in user bubble only' }] }
        expect(matchesExpect(userOnly, '$assistantContains:LAYER-V-OK').ok).toBe(false)
      })

      it('CAP-TEST-HARNESS-122 $assistantClosed gates on a settled turn, rejecting a marker that is still streaming', () => {
        const settled = { mode: 'live', messages: [{ role: 'assistant', text: 'real reply LAYER-V-OK' }] }
        const streaming = { mode: 'live', messages: [{ role: 'assistant', text: 'real reply LAYER-V-OK', streaming: true }] }
        const noMarker = { mode: 'live', messages: [{ role: 'assistant', text: 'other reply' }] }
        expect(matchesExpect(settled, '$assistantClosed:LAYER-V-OK').ok).toBe(true)
        expect(matchesExpect(streaming, '$assistantClosed:LAYER-V-OK').ok).toBe(false)
        expect(matchesExpect(noMarker, '$assistantClosed:LAYER-V-OK').ok).toBe(false)
      })

      it('CAP-TEST-HARNESS-123 assistantText joins assistant bubbles in order and ignores user bubbles', () => {
        expect(assistantText({ messages: [{ role: 'assistant', text: 'a' }, { role: 'user', text: 'u' }, { role: 'assistant', text: 'b' }] })).toBe('ab')
        expect(assistantText({ messages: [{ role: 'user', text: 'u' }] })).toBe('')
        expect(assistantText(null)).toBe('')
      })

      it('CAP-TEST-HARNESS-124 assistantStreamingActive reads the streaming flag off an assistant bubble', () => {
        expect(assistantStreamingActive({ messages: [{ role: 'assistant', text: 'x', streaming: true }] })).toBe(true)
        expect(assistantStreamingActive({ messages: [{ role: 'assistant', text: 'x', streaming: false }] })).toBe(false)
        expect(assistantStreamingActive({ messages: [{ role: 'assistant', text: 'x' }] })).toBe(false)
        expect(assistantStreamingActive({ messages: [] })).toBe(false)
      })
    })

    describe('stream step kind (real streaming increment gate)', () => {
      it('CAP-TEST-HARNESS-125 passes when the marker settles and streaming + growth were both observed', async () => {
        const snapshots = [
          { mode: 'live', messages: [{ role: 'assistant', text: 'par', streaming: true }] },
          { mode: 'live', messages: [{ role: 'assistant', text: 'partial', streaming: true }] },
          { mode: 'live', messages: [{ role: 'assistant', text: 'DONE' }] },
        ]
        let call = 0
        const host = {
          executeCommand: async (id: string) => {
            if (id !== 'dsh.test.panelSnapshot') throw new Error(`unexpected ${id}`)
            return snapshots[Math.min(call++, snapshots.length - 1)]
          },
          capture: async () => ({ ok: true, file: 'p.png' }),
        }
        const manifest = {
          capabilities: [
            {
              id: 'cap-stream',
              group: 'session',
              title: 'stream',
              requiresModel: false,
              steps: [
                { kind: 'stream', step: 's', command: 'dsh.test.panelSnapshot', expect: '$assistantContains:DONE', intervalMs: 5, requireIncrement: true, timeoutMs: 500 },
              ],
            },
          ],
        }
        const result = await runManifest(manifest, host, { hasCredential: false })
        expect(result.conclusion).toBe('PASS')
        expect(result.capabilities[0].conclusion).toBe('PASS')
      })

      it('CAP-TEST-HARNESS-126 fails the increment gate when only the settled marker is seen (no streaming, no growth)', async () => {
        const host = {
          executeCommand: async () => ({ mode: 'live', messages: [{ role: 'assistant', text: 'DONE' }] }),
          capture: async () => ({ ok: true, file: 'p.png' }),
        }
        const manifest = {
          capabilities: [
            {
              id: 'cap-stream',
              group: 'session',
              title: 'stream',
              requiresModel: false,
              steps: [
                { kind: 'stream', step: 's', command: 'dsh.test.panelSnapshot', expect: '$assistantContains:DONE', intervalMs: 5, requireIncrement: true, timeoutMs: 500 },
              ],
            },
          ],
        }
        const result = await runManifest(manifest, host, { hasCredential: false })
        expect(result.conclusion).toBe('LINK_FAILURE')
        expect(result.capabilities[0].conclusion).toBe('LINK_FAILURE')
      })
    })

    describe('replay step kind (continue precondition)', () => {
      it('CAP-TEST-HARNESS-127 reopens the active session as a replay tab', async () => {
        const host = {
          executeCommand: async (id: string) => {
            if (id === 'dsh.test.panelSnapshot') return { sessionId: 'sess-1', mode: 'live' }
            if (id === 'dsh.test.closeConversation') return { outcome: 'closed' }
            if (id === 'dsh.test.openHistory') return { outcome: 'opened', sessionId: 'sess-1', mode: 'replay' }
            throw new Error(`unexpected ${id}`)
          },
          capture: async () => ({ ok: true, file: 'p.png' }),
        }
        const manifest = {
          capabilities: [
            {
              id: 'cap-replay',
              group: 'continue',
              title: 'replay',
              requiresModel: false,
              steps: [{ kind: 'replay', step: 'r', command: 'dsh.test.panelSnapshot', expect: { outcome: 'opened' } }],
            },
          ],
        }
        const result = await runManifest(manifest, host, { hasCredential: false })
        expect(result.conclusion).toBe('PASS')
      })

      it('CAP-TEST-HARNESS-128 link-fails when the snapshot carries no sessionId', async () => {
        const host = {
          executeCommand: async (id: string) => {
            if (id === 'dsh.test.panelSnapshot') return { mode: 'live' }
            throw new Error(`unexpected ${id}`)
          },
          capture: async () => ({ ok: true, file: 'p.png' }),
        }
        const manifest = {
          capabilities: [
            { id: 'cap-replay', group: 'continue', title: 'replay', requiresModel: false, steps: [{ kind: 'replay', step: 'r', command: 'dsh.test.panelSnapshot' }] },
          ],
        }
        const result = await runManifest(manifest, host, { hasCredential: false })
        expect(result.conclusion).toBe('LINK_FAILURE')
      })
    })
  })

  describe('spike-t0a-replay-rebuild.spec.ts', () => {
    const roots: string[] = []

    afterEach(async () => {
      for (const dir of roots.splice(0)) {
        await rm(dir, { recursive: true, force: true })
      }
    })

    describe('Spike T-0a — authoritative log replay rebuild', () => {
      it('CAP-TEST-HARNESS-129 cold-read folds messages + timeline matching fixture order/roles (one-shot)', async () => {
        const { persistence, dispose } = await mountPersistence()
        try {
          const id = SessionId('t0a-balanced-with-diffs')
          const fixture = fixtureWithDiffs()
          await materializeAndRetireWriter(persistence, header(id), fixture)

          const raw = await readRaw(persistence, id)
          expect(raw).toEqual(fixture)

          const cold = await readColdSessionLog(persistence, id)
          expect(cold.events).toEqual(fixture) // balanced → no synthetic closers

          const messages = foldMessages(cold.events)
          expect(messages.map(m => m.role)).toEqual(['user', 'assistant'])
          expect(messages.map(m => m.text)).toEqual(['please edit notes', 'edited notes'])
          expect(messages.every((m, i) => i === 0 || m.seq > messages[i - 1]!.seq)).toBe(true)

          const timeline = foldTimeline(cold.events)
          expect(timeline.filter(r => r.kind === 'turn').map(r => r.label)).toEqual([
            'turn 1 start',
            'turn 1 end:completed',
          ])
          expect(timeline.some(r => r.kind === 'step')).toBe(true)
          expect(timeline.some(r => r.kind === 'tool' && r.callId === 'call-edit')).toBe(true)
          // One-shot: entire fold from a single read(0) — no pagination.
          expect(cold.events.length).toBe(fixture.length)
        } finally {
          await dispose()
        }
      })





      it('CAP-TEST-HARNESS-130 evidence: reopen after writer dispose still lists and stats the session', async () => {
        const { persistence, dispose, root } = await mountPersistence()
        try {
          const id = SessionId('t0a-survive-dispose')
          await materializeAndRetireWriter(persistence, header(id, '/work'), fixtureWithoutDiffs())

          // Simulate a fresh Host process over the same root.
          const ctx2 = new Context()
          const fiber2 = await ctx2.plugin(JsonlSessionPersistence, { root, compression: 'none' })
          try {
            const listed = await ctx2.sessionPersistence.list()
            expect(listed.some(s => s.header.id === id)).toBe(true)
            const st = await ctx2.sessionPersistence.stat(id)
            expect(st?.header.id).toBe(id)
            const cold = await readColdSessionLog(ctx2.sessionPersistence, id)
            expect(foldMessages(cold.events).map(m => m.role)).toEqual(['user', 'assistant'])
          } finally {
            await fiber2.dispose()
          }
        } finally {
          await dispose()
        }
      })
    })

    async function mountPersistence(): Promise<{
      persistence: SessionPersistence
      dispose: () => Promise<void>
      root: string
    }> {
      const root = await mkdtemp(join(tmpdir(), 'dsh-t0a-'))
      roots.push(root)
      const ctx = new Context()
      const fiber = await ctx.plugin(JsonlSessionPersistence, { root, compression: 'none' })
      return {
        persistence: ctx.sessionPersistence,
        root,
        dispose: async () => {
          await fiber.dispose()
        },
      }
    }

    function header(id: SessionId, cwd = '/spike-t0a'): SessionHeader {
      return {
        version: SESSION_FORMAT_VERSION,
        id,
        createdAt: 1_700_000_000_000,
        isSeeded: false,
        cwd,
      }
    }

    /**
 * Append + flush + close write handle — the persistence half of agent dispose
 * (writer gone; materialized log remains).
 */
    async function materializeAndRetireWriter(
      persistence: SessionPersistence,
      meta: SessionHeader,
      events: readonly SessionEvent[],
    ): Promise<void> {
      const handle = await persistence.create(meta)
      try {
        await handle.append([...events])
        await handle.flush()
      } finally {
        await handle.close()
      }
    }

    async function readRaw(
      persistence: SessionPersistence,
      id: SessionId,
    ): Promise<readonly SessionEvent[]> {
      const handle = await persistence.open(id, 'read')
      try {
        return await handle.read(0)
      } finally {
        await handle.close()
      }
    }

    function fixtureWithDiffs(): SessionEvent[] {
      return [
        { type: 'turn/start', seq: SessionSeq(0), time: 1, data: { turn: 1 } },
        {
          type: 'user/message',
          seq: SessionSeq(1),
          time: 2,
          data: freezeMessage({
            id: MessageId('u-with-diff'),
            role: 'user',
            content: [{ type: 'text', text: 'please edit notes' }],
            source: { kind: 'user' },
          }),
          surfaceOp: 'append',
        },
        { type: 'step/start', seq: SessionSeq(2), time: 3, data: { turn: 1, step: 1 } },
        {
          type: 'assistant/message',
          seq: SessionSeq(3),
          time: 4,
          data: {
            turn: 1,
            step: 1,
            message: freezeMessage({
              id: MessageId('a-with-diff'),
              role: 'assistant',
              content: [{ type: 'text', text: 'edited notes' }],
              source: { kind: 'model', provider: 'mock', model: 'mock' },
            }),
          },
          surfaceOp: 'append',
        },
        {
          type: 'tool/call',
          seq: SessionSeq(4),
          time: 5,
          data: {
            turn: 1,
            step: 1,
            callId: ToolCallId('call-edit'),
            name: 'edit',
            arguments: JSON.stringify({ path: 'notes.txt' }),
          },
        },
        {
          type: 'tool/result',
          seq: SessionSeq(5),
          time: 6,
          data: {
            turn: 1,
            step: 1,
            message: createToolResultMessage({
              callId: ToolCallId('call-edit'),
              content: [{ type: 'text', text: 'ok' }],
              isError: false,
            }),
            meta: {
              diffs: [{ path: 'notes.txt', oldText: 'before\n', newText: 'after\n' }],
            },
          },
          surfaceOp: 'append',
        },
        { type: 'step/end', seq: SessionSeq(6), time: 7, data: { turn: 1, step: 1 } },
        {
          type: 'turn/end',
          seq: SessionSeq(7),
          time: 8,
          data: { turn: 1, reason: { kind: 'completed' } },
        },
      ]
    }

    function fixtureWithoutDiffs(): SessionEvent[] {
      return [
        { type: 'turn/start', seq: SessionSeq(0), time: 1, data: { turn: 1 } },
        {
          type: 'user/message',
          seq: SessionSeq(1),
          time: 2,
          data: freezeMessage({
            id: MessageId('u-no-diff'),
            role: 'user',
            content: [{ type: 'text', text: 'hello' }],
            source: { kind: 'user' },
          }),
          surfaceOp: 'append',
        },
        { type: 'step/start', seq: SessionSeq(2), time: 3, data: { turn: 1, step: 1 } },
        {
          type: 'assistant/message',
          seq: SessionSeq(3),
          time: 4,
          data: {
            turn: 1,
            step: 1,
            message: freezeMessage({
              id: MessageId('a-no-diff'),
              role: 'assistant',
              content: [{ type: 'text', text: 'hi' }],
              source: { kind: 'model', provider: 'mock', model: 'mock' },
            }),
          },
          surfaceOp: 'append',
        },
        {
          type: 'tool/call',
          seq: SessionSeq(4),
          time: 5,
          data: {
            turn: 1,
            step: 1,
            callId: ToolCallId('call-bash'),
            name: 'bash',
            arguments: JSON.stringify({ command: 'echo hi' }),
          },
        },
        {
          type: 'tool/result',
          seq: SessionSeq(5),
          time: 6,
          data: {
            turn: 1,
            step: 1,
            message: createToolResultMessage({
              callId: ToolCallId('call-bash'),
              content: [{ type: 'text', text: 'hi' }],
              isError: false,
            }),
            // No meta.diffs — Diff must stay unavailable.
          },
          surfaceOp: 'append',
        },
        { type: 'step/end', seq: SessionSeq(6), time: 7, data: { turn: 1, step: 1 } },
        {
          type: 'turn/end',
          seq: SessionSeq(7),
          time: 8,
          data: { turn: 1, reason: { kind: 'completed' } },
        },
      ]
    }
  })

  describe('spike-t0b-continue-capability.spec.ts', () => {
    const dirs: string[] = []
    afterEach(async () => {
      for (const d of dirs.splice(0)) {
        await rm(d, { recursive: true, force: true })
      }
    })

    describe('Spike T-0b — continue capability (same-id / derive)', () => {
      it('CAP-TEST-HARNESS-131 agents.resume same id appends without rewriting committed prefix', async () => {
        const root = await mkdtemp(join(tmpdir(), 'dsh-t0b-resume-'))
        dirs.push(root)

        // Lifecycle 1: create → completed turn → dispose (writer released; log remains).
        const ctx1 = await mountHarness(root, new SpikeMockAdapter([textResponse('first answer')]))
        const id = SessionId('t0b-same-id-resume')
        const h1 = await ctx1.agents.create({ sessionId: id, meta: { cwd: '/spike-t0b' } })
        h1.agent.followup(userText('first question'))
        await waitForIdle(ctx1, h1.agent)
        await h1.dispose()
        const prefix = await readRaw(ctx1, id)
        expect(prefix.length).toBeGreaterThan(0)
        expect(prefix.some(e => e.type === 'turn/end')).toBe(true)
        await ctx1.fiber.dispose()

        // Lifecycle 2: fresh Context, same root — resume (not create).
        const ctx2 = await mountHarness(root, new SpikeMockAdapter([textResponse('second answer')]))
        await expect(ctx2.agents.create({ sessionId: id, meta: { cwd: '/spike-t0b' } }))
          .rejects.toBeInstanceOf(SessionAlreadyExistsError)

        const h2 = await ctx2.agents.resume({ resumeSessionId: id })
        expect(h2.agent.session.id).toBe(id)
        // Same-id live restore succeeded (AC[vscode-dsh-usable-loop]-32 core path).
        h2.agent.followup(userText('second question'))
        await waitForIdle(ctx2, h2.agent)
        await h2.dispose()

        const after = await readRaw(ctx2, id)
        expect(prefixUnchanged(prefix, after)).toBe(true)
        expect(after.length).toBeGreaterThan(prefix.length)
        const turnStarts = after.filter(e => e.type === 'turn/start')
        expect(turnStarts.map(e => e.type === 'turn/start' && e.data.turn)).toEqual([1, 2])
        await ctx2.fiber.dispose()
      })






    })

    async function mountHarness(root: string, adapter: SpikeMockAdapter): Promise<Context> {
      const ctx = new Context()
      await ctx.plugin(LlmRuntime)
      await ctx.plugin(SessionStore)
      await ctx.plugin(SessionProjectionRegistry)
      await ctx.plugin(SystemPrompt)
      await ctx.plugin(ToolRuntime)
      await ctx.plugin(AgentRegistry)
      await ctx.plugin(JsonlSessionPersistence, { root, compression: 'none' })
      await ctx.plugin(AgentLoop, { agents: [] })
      ctx.llm.registerAdapter(['mock'], adapter)
      return ctx
    }

    function waitForIdle(ctx: Context, agent: Agent): Promise<void> {
      return new Promise((resolve) => {
        const dispose = ctx.on('agent/status', ({ agent: subject, status }) => {
          if (subject === agent && status === 'idle') {
            dispose()
            resolve()
          }
        })
      })
    }

    function userText(text: string) {
      return createUserMessage({ content: [{ type: 'text', text }], source: { kind: 'user' } })
    }

    async function readRaw(ctx: Context, id: SessionId): Promise<readonly SessionEvent[]> {
      const handle = await ctx.sessionPersistence.open(id, 'read')
      try {
        return await handle.read(0)
      } finally {
        await handle.close()
      }
    }
  })

  describe('surface hook vocabulary resolves to registered commands', () => {
    const manifestPath = join(
      dirname(fileURLToPath(import.meta.url)),
      '..',
      'test-scripts',
      'layer-v-capabilities.json',
    )

    /** Hooks the newer user-visible surfaces expose to the Layer-V driver. */
    const SURFACE_HOOKS = [
      'dsh.test.getSettingsState',
      'dsh.test.updateSetting',
      'dsh.test.getModelState',
      'dsh.test.selectModel',
      'dsh.test.sendImagePrompt',
      'dsh.test.sessionLogExists',
      'dsh.test.getTokenStatus',
      'dsh.test.lastAssistantReasoning',
      'dsh.test.lastAssistantText',
      'dsh.test.injectCompaction',
      'dsh.test.injectWorkflow',
      'dsh.test.injectTodo',
      'dsh.test.injectReasoning',
      'dsh.test.interactionsDebug',
      'dsh.test.getTodoItems',
      'dsh.test.lastCompactionMarker',
      'dsh.test.lastWorkflowCard',
    ]

    const commands = new Map<string, (...args: unknown[]) => unknown>()

    afterEach(async () => {
      await deactivate()
      commands.clear()
    })

    it('CAP-TEST-HARNESS-132 every dsh.test.* command the driver names is registered in the test gate', () => {
      activate({
        subscriptions: [],
        extensionPath: '/tmp/dsh-hook-vocabulary',
        workspaceState: {
          get() { return undefined },
          update() {},
        },
      }, {
        window: {
          async showErrorMessage() {},
          async showInformationMessage() {},
          registerWebviewViewProvider() { return { dispose() {} } },
        },
        workspace: {
          workspaceFolders: [{ uri: { fsPath: '/tmp/dsh-hook-vocabulary' } }],
        },
        commands: {
          registerCommand(command: string, callback: (...args: unknown[]) => unknown) {
            commands.set(command, callback)
            return { dispose() {} }
          },
        },
      })

      for (const id of SURFACE_HOOKS) {
        expect(commands.has(id), `missing ${id}`).toBe(true)
      }

      // The manifest is the other half of the driver's contract: a hook it names that
      // no activation registers would fail the run as an unknown command.
      const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as {
        capabilities: Array<{ steps?: Array<{ command?: unknown }> }>
      }
      const manifestHooks = new Set<string>()
      for (const capability of manifest.capabilities) {
        for (const step of capability.steps ?? []) {
          if (typeof step.command === 'string' && step.command.startsWith('dsh.test.')) {
            manifestHooks.add(step.command)
          }
        }
      }
      expect(manifestHooks.size).toBeGreaterThan(0)
      for (const id of manifestHooks) {
        expect(commands.has(id), `manifest names unregistered ${id}`).toBe(true)
      }
    })
  })

})
